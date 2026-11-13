/**
 * calls.js v1.0 (ronda 2758, plan del dueño punto 16) — Llamadas de voz.
 * Solo con enlace directo: el mismo Wi-Fi / Wi-Fi Direct (enlace lan:) o Bluetooth a alcance (no por Jump ni por
 * internet: el retraso no sirve para hablar).
 *  - Señalización por el chat (cifrada de extremo a extremo como cualquier mensaje, no se guarda ni se muestra):
 *      { type:'nexo_call', op:'offer'|'accept'|'reject'|'busy'|'end', id, ts, k (solo en offer: clave de la llamada), co }
 *  - Voz: paquetes de ~100 ms (call_media.js: Opus con WebCodecs, o μ-law si el teléfono no tiene Opus), cifrados con la
 *    clave de esa llamada (AES-GCM; datos asociados: id|sentido|nº) y enviados directos como paquete de control:
 *      { type:'vf', c:id, s:nº, d:base64(iv + cifrado) }
 *  - Llamada sin contestar en 45 s: perdida. Sin voz del otro durante 12 s: se corta.
 * Al terminar queda una línea en el chat ("📞 Llamada · 1:23", "📞 Llamada perdida").
 * Videollamada (plan punto 17): la misma llamada con v:1 en la oferta y, además de la voz, vídeo VP8 (call_media.js)
 * en paquetes { type:'vf', k:'v', … } solo por el mismo Wi-Fi (por Bluetooth no cabe); si el Wi-Fi se pierde en plena
 * videollamada, el vídeo se para y la voz sigue por Bluetooth.
 */
import { t } from './i18n.js';

var RING_MS = 45000;
var SILENCE_MS = 12000;
// #dueño (internet): en una llamada activa, 15 s sin recibir nada → se corta; antes de eso, aviso de «Reconectando…».
var RECONNECT_MS = 15000;
var WEAK_MS = 4000;
// Ronda 2768: solo para ofertas muy viejas; si una reciente sigue viva lo dice el que llama al recibir 'ring' (antes, con
// el reloj del otro más de 60 s adelantado, nunca sonaba)
var OFFER_MAX_AGE_MS = 600000;
var DEAD_MS = 180000;

var DIAG_EVERY_MS = 5000;

function _nid(id) { return (id || '').toString().toLowerCase().trim(); }
function _emit(name, detail) { try { window.dispatchEvent(new CustomEvent(name, { detail: detail })); } catch (e) {} }
// #dueño 01-11: avisar al nativo que hay (o dejó de haber) una VIDEOLLAMADA activa, para que al irse de la app con el
// gesto de inicio entre en Picture-in-Picture (miniatura flotante) sin cortar audio/vídeo.
function _plug() { return (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.NexoBLE) || null; }
var SCREEN_LONG = 960, SCREEN_FPS = 5; // compartir pantalla: lado largo de la imagen (las letras se leen) y como mucho 5 por segundo
function _pipActive(on) { try { var p = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.NexoBLE; if (p && typeof p.setPipActive === 'function') p.setPipActive({ on: !!on }); } catch (e) {} }
// #dueño 02-11 (ConnectionService parte 2): avisar al nativo del ciclo de vida de la llamada SALIENTE para que Telecom la
// trate como una llamada real (convivencia con una llamada del teléfono, mandos del coche/auriculares/reloj, foco de
// audio). op: 'out' al empezar a llamar, 'active' cuando el otro contesta, 'end' al terminar. Best-effort: si el nativo
// no está o Telecom falla, NEXO llama EXACTAMENTE igual que hasta ahora. La ENTRANTE la registra el nativo sola (parte 1).
function _telecom(op, extra) { try { var p = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.NexoBLE; if (p && typeof p.telecom === 'function') p.telecom(Object.assign({ op: op }, extra || {})).catch(function () {}); } catch (e) {} }
function _hex(n) { var a = new Uint8Array(n); crypto.getRandomValues(a); return Array.from(a).map(function(b) { return ('0' + b.toString(16)).slice(-2); }).join(''); }
function _fromHex(h) { var a = new Uint8Array(h.length / 2); for (var i = 0; i < a.length; i++) a[i] = parseInt(h.substr(i * 2, 2), 16); return a; }
function _b64(u8) { var s = ''; for (var i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); }
function _unb64(s) { var b = atob(s), a = new Uint8Array(b.length); for (var i = 0; i < b.length; i++) a[i] = b.charCodeAt(i); return a; }

export function parseCallSignal(content) {
  if (typeof content !== 'string' || content.indexOf('"nexo_call"') < 0) return null;
  try { var o = JSON.parse(content); return o && o.type === 'nexo_call' && typeof o.id === 'string' && /^[a-z0-9]{6,40}$/.test(o.id) ? o : null; } catch (e) { return null; }
}

export class Calls {
  constructor(ble, mediaFactory) {
    this.ble = ble;
    this.mediaFactory = mediaFactory;   // (opts) => media (call_media.js); se puede cambiar (pruebas)
    this.call = null;                   // { id, nx, dir:'out'|'in', state, key, startedAt, ... }
    this.stats = { sent: 0, got: 0, bad: 0 };
    this._dead = new Map(); // ronda 2768: ids de llamadas ya terminadas (aquí o según el otro): no vuelven a sonar
  }
  _markDead(id) { var now = Date.now(), d = this._dead; d.set(id, now); d.forEach(function(t, k) { if (now - t > DEAD_MS) d.delete(k); }); }
  _ignored(nx, why) { _emit('nexo:callIgnored', { nx: nx, why: why }); }
  // Ronda 2768: la oferta de una llamada que terminó no sigue saliendo (en cola, a medias o reintentándose). Antes podía
  // llegar más tarde, incluso tras reiniciar la app: "Llamada perdida" y un "Mensaje nuevo" que no existía
  _dropOffer(mid) {
    var ble = this.ble, ack = ble && ble.ackSystem;
    if (!mid || !ble) return;
    if (ble._pendingMessageQueue) ble._pendingMessageQueue.forEach(function(q, k) { var f = q.filter(function(it) { return it.messageId !== mid; }); if (f.length !== q.length) ble._pendingMessageQueue.set(k, f); });
    if (!ack) return;
    var st = ack.outgoingStreams && ack.outgoingStreams.get(mid);
    if (st && !st.aborted) { st.abort(); ack.outgoingStreams.delete(mid); }
    var pa = ack.pendingAcks && ack.pendingAcks.get(mid);
    if (pa) { clearTimeout(pa.timer); ack.pendingAcks.delete(mid); }
  }

  // ¿Se puede llamar ahora? Devuelve el id del enlace directo (lan:nx o la dirección Bluetooth) o null
  // Wi-Fi solo si el enlace está arriba ahora (para los mensajes lan.js lo mantiene un rato tras un corte esperando a que
  // vuelva; en una llamada eso es silencio). preferBle: la voz del otro dejó de llegar por Wi-Fi → Bluetooth si está listo
  _link(nx, preferBle) {
    var ble = this.ble;
    if (!ble) return null;
    var bt = typeof ble._bleReadyFor === 'function' ? ble._bleReadyFor(nx) : null; // conexión Bluetooth lista (no lan:/net:)
    var q = ble.lan && typeof ble.lan.quality === 'function' ? ble.lan.quality(nx) : null;
    var wifi = ble.lan && typeof ble.lan.canReach === 'function' && ble.lan.canReach(nx) && q && q.up;
    if (wifi && !(preferBle && bt)) return 'lan:' + nx;
    if (bt) return bt;
    // #dueño: sin enlace directo, por INTERNET (relés). Así la llamada/videollamada funciona aunque no estén cerca ni en
    // el mismo Wi-Fi, y una llamada en curso se mantiene si se cae el Bluetooth/Wi-Fi (failover: _sendFrame reelige cada vez).
    if (ble.net && typeof ble.net.canReach === 'function' && ble.net.canReach(nx)) return 'net:' + nx;
    return null;
  }
  canCall(nexoId) { return !!this._link(_nid(nexoId)); }
  // Vídeo por Wi-Fi o por internet (por Bluetooth no cabe: solo voz). Permisivo para PODER iniciar la videollamada por
  // internet; los fotogramas de vídeo solo salen cuando el camino los soporta (_videoLinkOk): el audio va enseguida y el
  // vídeo aparece al establecerse Tor directo.
  canVideo(nexoId) { var l = this._link(_nid(nexoId)); return !!l && (l.indexOf('lan:') === 0 || l.indexOf('net:') === 0); }
  // #dueño 01-11 (P1): ¿por este enlace pueden ir los FOTOGRAMAS de vídeo? Wi-Fi (lan:) siempre; internet (net:) solo si es
  // Tor DIRECTO (net.via==='tor'); por relés (15 fps los inundaría, segundos de retraso) o Bluetooth, no.
  _videoLinkOk(link, nexoId) {
    if (!link) return false;
    if (link.indexOf('lan:') === 0) return true;
    if (link.indexOf('net:') === 0) { var n = this.ble && this.ble.net; return !!(n && typeof n.via === 'function' && n.via(_nid(nexoId)) === 'tor'); }
    return false;
  }
  state() { return this.call ? Object.assign({}, this.call, { key: undefined, cryptoKey: undefined, media: undefined }) : null; }

  _set(o) {
    if (!this.call) return;
    Object.assign(this.call, o);
    _emit('nexo:call', this.state());
  }

  _signal(nx, op, extra) {
    var ble = this.ble, c = this.call;
    var o = Object.assign({ type: 'nexo_call', op: op, id: (c && c.id) || (extra && extra.id), ts: Date.now() }, extra || {});
    if (!ble || typeof ble.sendChatMessage !== 'function') return Promise.resolve();
    var mid = 'cs' + _hex(6);
    if (op === 'offer') { ble._callOut = ble._callOut || new Set(); ble._callOut.add(mid); if (c) c.offerMid = mid; }
    // Ronda 2760: las señales (salvo la llamada entrante) no son mensajes: sin aviso en el otro teléfono
    if (op !== 'offer') { ble._quietOut = ble._quietOut || new Set(); ble._quietOut.add(mid); }
    var p = ble.sendChatMessage(nx, JSON.stringify(o), mid).catch(function(e) { console.warn('[CALL] Señal ' + op + ' no enviada: ' + (e && e.message)); });
    // Build 2837 (pedido del dueño): una llamada/videollamada tiene que SONAR aunque el otro esté dormido en ahorro de
    // batería. Además del envío local (Bluetooth/Wi-Fi), la OFERTA se publica YA en el buzón de relés, que dispara el
    // «toque» FCM de alta prioridad (net_link._newMsgId reconoce la oferta). Inmediato (no los ~10 s de la red de
    // seguridad: una llamada no puede esperar). Mismo id → el otro deduplica la oferta (CallDedupe nativo). Solo si hay
    // internet + token del contacto; si no, queda el camino local de siempre.
    // Build 2874 (#dueño 01-11: «cuando cuelgo en un teléfono, el otro sigue sonando»): las señales que CAMBIAN el estado
    // de sonar/activo (end/reject/busy/accept), igual que la oferta, se dejan TAMBIÉN en el buzón de relés cuando hay
    // internet. Si el enlace vivo (p. ej. Bluetooth con MTU 23 congestionado) se traga la señal, el otro la recibe igual
    // por el buzón y deja de sonar. Mismo id (y la misma máquina de estados con guardas) → procesarla dos veces no hace
    // daño. ring/hold/unhold NO van al buzón (son handshake frecuente, no cambian «sonar»).
    var viaMailbox = op === 'offer' || op === 'end' || op === 'reject' || op === 'busy' || op === 'accept';
    if (viaMailbox && ble.net && typeof ble.net.mailboxOk === 'function' && ble.net.mailboxOk(nx) && typeof ble._sendViaNetMailbox === 'function') {
      ble._sendViaNetMailbox(nx, JSON.stringify(o), mid).catch(function() {});
    }
    return p;
  }

  _importKey(hex) { return crypto.subtle.importKey('raw', _fromHex(hex), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']); }

  // Llamar a un contacto (video: videollamada)
  start(nexoId, video) {
    var self = this, nx = _nid(nexoId);
    if (self.call) return Promise.reject(new Error(t('call_err_already', 'Ya hay una llamada')));
    if (!self._link(nx)) return Promise.reject(new Error(t('call_err_need_near', 'Para llamar hace falta Bluetooth, Wi-Fi o internet con el contacto')));
    if (video && !self.canVideo(nx)) return Promise.reject(new Error(t('call_err_need_wifi_video', 'Para una videollamada hace falta Wi-Fi o internet (por Bluetooth solo voz)')));
    // Si la llamada va por INTERNET, el único camino en tiempo real es Tor directo (los relés tienen segundos de retraso).
    // Tor ya no corre por defecto (#dueño 01-11: más lento para lo normal); se enciende AQUÍ, bajo demanda, para la llamada.
    var startLink = self._link(nx);
    if (startLink && startLink.indexOf('net:') === 0 && self.ble && self.ble.net && typeof self.ble.net.ensureTor === 'function') self.ble.net.ensureTor();
    var id = 'cl' + Date.now().toString(36) + _hex(4), key = _hex(32);
    self.call = { id: id, nx: nx, dir: 'out', state: 'calling', key: key, createdAt: Date.now(), sendSeq: 0, vSeq: 0, lastRx: 0, video: !!video };
    _emit('nexo:call', self.state());
    _telecom('out', { to: nx, video: !!video });  // parte 2: la saliente aparece como llamada real del sistema
    console.log('[CALL] Llamando a ' + nx + ' (' + id + ')');
    self._ringTimer = setTimeout(function() { if (self.call && self.call.id === id && self.call.state === 'calling') self._finish('unanswered', true); }, window.NEXO_CALL_RING_MS || RING_MS);
    return Promise.all([self._importKey(key), self._codecs()]).then(function(r) {
      if (!self.call || self.call.id !== id) return;
      self.call.cryptoKey = r[0];
      return self._signal(nx, 'offer', video ? { k: key, co: r[1], v: 1 } : { k: key, co: r[1] });
    });
  }

  // Ronda 2761: lo que este teléfono puede recibir (antes la oferta decía Opus siempre y la respuesta no decía nada)
  _codecs() {
    var f = this.mediaFactory && this.mediaFactory.codecs;
    return typeof f === 'function' ? Promise.resolve(f()).catch(function() { return 'opus,ulaw'; }) : Promise.resolve('opus,ulaw');
  }

  // Contestar la llamada entrante
  accept() {
    var self = this, c = self.call;
    if (!c || c.dir !== 'in' || c.state !== 'ringing') return;
    clearTimeout(self._ringTimer);
    // Llamada entrante por INTERNET: encender Tor directo bajo demanda para el audio/vídeo en tiempo real (#dueño 01-11).
    var acLink = self._link(c.nx);
    if (acLink && acLink.indexOf('net:') === 0 && self.ble && self.ble.net && typeof self.ble.net.ensureTor === 'function') self.ble.net.ensureTor();
    self._codecs().then(function(co) { if (self.call === c) self._signal(c.nx, 'accept', { co: co }); });
    self._begin();
  }

  reject() {
    var c = this.call;
    if (!c) return;
    if (c.dir === 'in' && c.state === 'ringing') { this._signal(c.nx, 'reject'); this._finish('rejected_by_me', false); }
    else this.hangup();
  }

  hangup() {
    var c = this.call;
    if (!c) return;
    this._signal(c.nx, 'end');
    // También por el canal de la voz (cifrado): si el chat va por un camino que ya no sirve, el otro se entera igual
    if (c.state === 'active') this._sendPacket(new TextEncoder().encode('END'), 'e');
    this._finish(c.state === 'active' ? 'ended' : 'cancelled', false);
  }

  // Imagen propia y del otro (videollamada) para la pantalla
  videoViews() { var m = this.call && this.call.media; return m ? { local: m.localVideo || null, remote: m.remoteCanvas || null } : { local: null, remote: null }; }

  // Cámara apagada / encendida en una videollamada
  camera(on) { var c = this.call; if (!c) return; c.cameraOff = !on; if (c.media && c.media.camera) c.media.camera(!!on); _emit('nexo:call', this.state()); }

  // Ronda 2762: girar la cámara (videollamada)
  flipCamera() {
    var self = this, c = this.call;
    if (!c || !c.media || typeof c.media.flip !== 'function') return Promise.resolve(null);
    // (ronda 2772: el otro sabe enseguida si es la de delante, para ponerla en espejo o no)
    return c.media.flip().then(function(f) { if (self.call === c) { self._set({ facing: f }); if (c.camState) self._sendState(c); } return f; });
  }

  // Dueño 13-11: COMPARTIR PANTALLA en la videollamada (parte 1: 1-a-1). El nativo pide el permiso de Android (aviso del
  // sistema, cada vez) y captura la pantalla a ~5 imágenes por segundo (MediaProjection, ScreenShare.kt); cada imagen llega
  // aquí (onScreenFrame) y la videollamada la manda EN LUGAR de la cámara (call_media.screen/screenFrame), por el mismo
  // camino cifrado. El otro sabe que es una pantalla (estado 'c' con scr) para verla entera y sin espejo.
  shareScreen(on) {
    var self = this, c = this.call, pl = _plug();
    if (!c || c.state !== 'active' || !c.video) return Promise.resolve(false);
    if (!on) { self._screenStop(c, 'detenido'); return Promise.resolve(false); }
    if (c.screen) return Promise.resolve(true);
    if (!pl || typeof pl.screenShareStart !== 'function') return Promise.reject(Object.assign(new Error('Este teléfono no puede compartir la pantalla'), { code: 'SCREEN_NA' }));
    self._screenHooks(pl);
    return pl.screenShareStart({ maxLong: SCREEN_LONG, fps: SCREEN_FPS }).then(function(r) {
      if (!r || !r.granted) return false;
      if (self.call !== c || c.state !== 'active') { try { pl.screenShareStop(); } catch (e) {} return false; }
      c.screen = true;
      if (c.media && typeof c.media.screen === 'function') c.media.screen(true);
      console.log('[CALL] Compartiendo la pantalla con ' + c.nx);
      self._set({ screen: true }); self._sendState(c);
      return true;
    });
  }
  _screenHooks(pl) {
    var self = this;
    if (self._scrHooked || !pl || typeof pl.addListener !== 'function') return;
    self._scrHooked = true;
    pl.addListener('onScreenFrame', function(ev) { var c = self.call; if (c && c.screen && c.media && typeof c.media.screenFrame === 'function' && ev && typeof ev.d === 'string') c.media.screenFrame(ev.d, Number(ev.w) || 0, Number(ev.h) || 0); });
    // Android paró la captura (el usuario la detuvo desde el aviso del sistema, o se bloqueó el teléfono)
    pl.addListener('onScreenShareStopped', function() { var c = self.call; if (c && c.screen) self._screenStop(c, 'parada por el sistema', true); });
  }
  _screenStop(c, why, byNative) {
    if (!c || !c.screen) return;
    c.screen = false;
    var pl = _plug();
    if (!byNative && pl && typeof pl.screenShareStop === 'function') { try { pl.screenShareStop(); } catch (e) {} }
    if (c.media && typeof c.media.screen === 'function') c.media.screen(false);
    console.log('[CALL] Dejo de compartir la pantalla (' + why + ')');
    if (this.call === c) { this._set({ screen: false }); this._sendState(c); }
  }

  mute(on) { var c = this.call; if (!c) return; c.muted = !!on; if (c.media && c.media.mute) c.media.mute(!!on); _emit('nexo:call', this.state()); }

  // #dueño 01-11 (GRAVE): entró/salió una llamada TELEFÓNICA (el nativo lo avisa por el foco de audio, onCallInterruption).
  // RETENER la llamada NEXO sin cortarla: al perder el foco (paused=true) silenciar el micro, avisar al otro «en pausa»
  // (hold) para que NINGUNO corte por silencio, y NO pelear por el audio; al volver el foco (paused=false, p.ej. se rechazó
  // o colgó la telefónica) reanudar: micro, reiniciar el vigilante y avisar «sigo» (unhold). La llamada nunca se cae.
  _onInterruption(paused) {
    var self = this, c = self.call;
    if (!c || c.state !== 'active') return;
    if (paused) {
      if (c.held) return;
      c.held = true;
      c._mutedBefore = !!c.muted;                 // recordar el silencio MANUAL del usuario (para restaurarlo al volver)
      if (c.media && c.media.mute) try { c.media.mute(true); } catch (e) {}
      self._signal(c.nx, 'hold');
      self._set({ held: true });
      console.log('[CALL] En pausa por llamada telefónica (retenida, sin cortar)');
    } else {
      if (!c.held) return;
      c.held = false;
      c.lastRx = Date.now();                       // vigilante limpio: no contar el tiempo en pausa
      if (c.media && c.media.mute) try { c.media.mute(!!c._mutedBefore); } catch (e) {}
      if (c.media && typeof c.media.wake === 'function') try { c.media.wake(); } catch (e) {} // re-tomar micro/cámara/audio
      self._signal(c.nx, 'unhold');
      self._set({ held: false });
      console.log('[CALL] Reanudada tras la llamada telefónica');
    }
  }

  // La llamada empieza: micrófono y altavoz
  _begin() {
    var self = this, c = self.call;
    if (!c) return;
    c.startedAt = Date.now(); c.lastRx = Date.now();
    self.stats = { sent: 0, got: 0, bad: 0 }; // por llamada (el diagnóstico de cada una)
    self._set({ state: 'active', startedAt: c.startedAt });
    _telecom('active');  // parte 2: la saliente por Telecom pasa a activa (la entrante no pasa por aquí: no-op)
    console.log('[CALL] En llamada con ' + c.nx + ' (' + c.id + ')');
    if (c.video) _pipActive(true); // videollamada → habilitar la miniatura (PiP) al irse de la app
    var media;
    try {
      media = self.mediaFactory({ onPacket: function(bytes) { self._sendPacket(bytes); }, codecs: c.peerCodecs || 'opus,ulaw',
        video: !!c.video, onVideoPacket: function(bytes) { self._sendPacket(bytes, 'v'); },
        // Ronda 2769: la imagen del otro se paró: que mande una completa ('k'); estado de mi cámara y micrófono ('c')
        onNeedKey: function() { if (self.call === c) self._sendPacket(new Uint8Array([1]), 'k'); },
        onState: function(s) {
          if (self.call !== c || !s) return;
          c.camState = s.cam; c.micState = s.mic;
          self._set({ camState: s.cam, micState: s.mic, micError: s.mic === 'none' ? (s.micErr || 'sin micrófono') : '' });
          self._sendState(c);
        } });
    } catch (e) { console.warn('[CALL] Sin audio: ' + (e && e.message)); }
    c.media = media || null;
    if (media && media.start) Promise.resolve(media.start()).then(function(info) {
      if (info && info.codec) {
        console.log('[CALL] Audio: ' + info.codec + (info.mic === false ? ' (sin micrófono por ahora: ' + info.micError + ')' : '') + (c.video ? ', vídeo: ' + (info.video ? 'VP8' : 'no por ahora') : ''));
        self._set(c.video ? { codec: info.codec, videoOk: !!info.video } : { codec: info.codec });
      }
    }).catch(function(e) { console.warn('[CALL] Micrófono: ' + (e && e.message)); self._set({ micError: (e && e.message) || 'sin micrófono' }); });
    // Ronda 2769: al volver a la app (la cámara se pierde en segundo plano), cámara y audio otra vez ya
    if (!self._wakeHook && typeof document !== 'undefined') {
      self._wakeHook = true;
      document.addEventListener('visibilitychange', function() { var cc = self.call; if (document.visibilityState === 'visible' && cc && cc.media && typeof cc.media.wake === 'function') cc.media.wake(); });
    }
    self._silenceTimer = setInterval(function() {
      var cc = self.call;
      if (!cc || cc.id !== c.id) return;
      // #dueño (internet): mala conexión → aviso «Reconectando…»; si no se restablece en 15 s, se corta.
      var rmax = (typeof window !== 'undefined' && window.NEXO_CALL_RECONNECT_MS) || RECONNECT_MS;
      var wmin = (typeof window !== 'undefined' && window.NEXO_CALL_WEAK_MS) || WEAK_MS;
      // #dueño 01-11 (GRAVE): si una llamada TELEFÓNICA interrumpió (held) o el otro avisó que está en pausa (peerHeld),
      // NO contar el silencio ni cortar: la llamada NEXO queda RETENIDA. Se reinicia el reloj del vigilante en cada vuelta
      // para que al reanudar no cuente el tiempo que estuvo en pausa (ni marque «Reconectando…»).
      if (cc.held || cc.peerHeld) { cc.lastRx = Date.now(); if (cc.reconnecting) self._set({ reconnecting: false }); return; }
      var gap = Date.now() - (cc.lastRx || cc.startedAt || Date.now());
      if (gap > rmax) { self._signal(cc.nx, 'end'); self._finish('lost', false); return; }
      var recon = gap > wmin;
      if (recon !== !!cc.reconnecting) self._set({ reconnecting: recon });
      if (Date.now() - (cc.diagAt || cc.startedAt) >= DIAG_EVERY_MS) { cc.diagAt = Date.now(); self._diag(cc, ''); }
      // Ronda 2769: el estado se repite cada 5 s (un aviso perdido no deja al otro con lo de antes)
      if (cc.camState && Date.now() - (cc.stateAt || 0) >= DIAG_EVERY_MS) self._sendState(cc);
    }, 1000);
  }

  // Ronda 2769: mi cámara y mi micrófono, para la pantalla del otro ('c', cifrado como la voz)
  _sendState(c) {
    c.stateAt = Date.now();
    // (ronda 2772: front = cámara de delante: el otro la ve en espejo, si lo tiene puesto)
    // (13-11: scr = estoy compartiendo la pantalla; las versiones anteriores lo ignoran)
    this._sendPacket(new TextEncoder().encode(JSON.stringify({ cam: c.camState || 'none', mic: c.micState || 'on', front: (c.facing || 'user') === 'user', scr: !!c.screen })), 'c');
  }

  // ¿Se ve la imagen del otro? (si no, la pantalla muestra su foto y el motivo en vez de negro)
  remoteVideoLive() { var m = this.call && this.call.media; return !m || typeof m.remoteLive !== 'function' || m.remoteLive(); }

  // Ronda 2761 (informe del dueño: en una videollamada un teléfono no oía nada): al diagnóstico cada 5 s y al colgar,
  // para ver dónde se pierde la voz: enviada / recibida / reproducida, nivel del micrófono, camino y estado del audio
  _diag(c, prefix) {
    var m = c.media && typeof c.media.stats === 'function' ? c.media.stats() : null, st = this.stats;
    var link = this._link(c.nx), pct = function(x) { return Math.round((x || 0) * 1000) / 10 + ' %'; };
    console.log('[CALL] ' + (prefix || Math.round((Date.now() - c.startedAt) / 1000) + ' s') + ': voz enviada ' + st.sent + ', recibida ' + st.got +
      (st.bad ? ' (' + st.bad + ' ilegibles)' : '') + (st.sentKeep || st.gotKeep ? ', sin voz ("sigo aquí") enviados ' + (st.sentKeep || 0) + ' / recibidos ' + (st.gotKeep || 0) : '') + (c.video ? ', vídeo enviado ' + (st.sentV || 0) + ' / recibido ' + (st.gotV || 0) : '') +
      (m ? ', reproducido ' + Math.round(m.playedS) + ' s (nivel ' + pct(m.playedLevel) + '), micrófono ' + (m.mic ? 'activo' : 'NO') + ' nivel ' + pct(m.micLevel) +
        ' pico ' + pct(m.micPeak) + ', audio ' + m.ctx + ', ' + m.codec + (c.peerCodecs ? ' (el otro: ' + c.peerCodecs + ')' : '') +
        // ronda 2772: filtros de voz: tiempo con el micrófono bajado por la voz del otro, hablando los dos, en silencio; eco medido
        (m.fx ? ', filtros: bajado ' + pct(m.fx.duck) + ', los dos ' + pct(m.fx.dt) + ', silencio ' + pct(m.fx.gate) + ', eco ' + Math.round(20 * Math.log10(m.fx.echo || 1e-3)) + ' dB' + (m.fx.delayMs >= 0 ? ' a ' + m.fx.delayMs + ' ms' : '') + (m.fx.headset ? ', con cascos' : '') : '') +
        (m.aec ? ', cancelador de eco ' + m.aec : '') + (m.opus ? ', Opus ' + m.opus : '') : ', sin audio') +
      ', por ' + this._linkLabel(link, c.nx));
    // Ronda 2769: pistas y vídeo de los dos sentidos (para ver en el diagnóstico por qué no se ve o no se oye)
    if (m && (m.micTrack || m.video)) {
      var v = m.video;
      // (ronda 2771: "Estado", para no confundirla con los avisos "[CALL] Micrófono: <error>")
      console.log('[CALL] Estado: micrófono con pista ' + m.micTrack + (m.micErr ? ' (' + m.micErr + ')' : '') + (m.micReopens ? ', reabierto ' + m.micReopens : '') +
        (v ? '; cámara ' + v.cam + ', pista ' + v.track + (v.err ? ' (' + v.err + ')' : '') + ', imagen local ' + v.local + ', codificador ' + v.enc +
          ', imágenes ' + v.frames + ' (completas ' + v.keys + ')' + (v.size ? ' de ' + v.size + (v.camSize ? ' (cámara ' + v.camSize + ')' : '') : '') + (v.reopens ? ', reabierta ' + v.reopens : '') + (v.encErr ? ', fallos al codificar ' + v.encErr : '') +
          '; del otro: decodificadas ' + v.decoded + (v.rxSize ? ' de ' + v.rxSize : '') + ', decodificador ' + v.dec + (v.decErr ? ', fallos ' + v.decErr : '') + (v.keyReq ? ', pedidas completas ' + v.keyReq : '') +
          (c.peerCam ? ', su cámara ' + c.peerCam : '') + (c.peerMic && c.peerMic !== 'on' ? ', su micrófono ' + c.peerMic : '') : ''));
    }
  }

  // 3044 (diagnóstico S24 APK 3033 13-11: videollamada por internet con «vídeo enviado 0» que el registro llamaba «por Bluetooth»):
  // nombre del camino para el diagnóstico. Por internet dice si va por relés (el vídeo no sale: _videoLinkOk) o por Tor
  // directo, y en qué está Tor (para ver en el próximo diagnóstico por qué no hubo imagen).
  _linkLabel(link, nx) {
    if (!link) return 'ningún camino';
    if (link.indexOf('lan:') === 0) return 'Wi-Fi';
    if (link.indexOf('net:') !== 0) return 'Bluetooth';
    var n = this.ble && this.ble.net;
    if (n && typeof n.via === 'function' && n.via(_nid(nx)) === 'tor') return 'internet (Tor directo)';
    var p = n && n.peers && typeof n.peers.get === 'function' ? n.peers.get(_nid(nx)) : null;
    var ts = n && typeof n.torState === 'function' ? n.torState() : (n && n.tor && n.tor.ready ? 'listo' : 'sin arrancar');
    return 'internet (relés: el vídeo no sale; Tor ' + ts + (p && p.torUp ? ', enlace con él abierto sin confirmar' : '') + ')';
  }

  _sendPacket(bytes, kind) {
    var self = this, c = self.call;
    if (!c || c.state !== 'active' || !c.cryptoKey) return;
    var link = self._link(c.nx, (c.lastRx && Date.now() - c.lastRx > 3000) || (c.rxBleAt && Date.now() - c.rxBleAt < 2000));
    if (!link) {
      // Se fue el Wi-Fi y aún no hay Bluetooth: buscarlo ya (sin esperar al margen de espera del Wi-Fi de lan.js)
      if (!c.seeking && self.ble && typeof self.ble._markPeerLost === 'function') { c.seeking = true; console.log('[CALL] Sin enlace: buscando por Bluetooth'); self.ble._markPeerLost(c.nx); }
      return;
    }
    c.seeking = false;
    // #dueño 01-11 (P1): el VÍDEO va por Wi-Fi (lan:) y por INTERNET cuando es Tor DIRECTO (net.via==='tor'). Por relés NO
    // (15 fps los inundaría y llegaría con segundos de retraso = inservible) ni por Bluetooth (no cabe). El audio sigue por
    // cualquier camino. Antes el vídeo solo salía por lan: → la videollamada por internet conectaba pero no mandaba imagen.
    if (kind === 'v' && !self._videoLinkOk(link, c.nx)) return;
    // Ronda 2769: 'k' (pide imagen completa) y 'c' (estado de cámara y micrófono) con su propia numeración
    var seq = kind === 'v' ? c.vSeq++ : kind === 'e' ? 0 : (kind === 'k' || kind === 'c') ? (c.cSeq = (c.cSeq || 0) + 1) : c.sendSeq++;
    var iv = crypto.getRandomValues(new Uint8Array(12));
    var ad = new TextEncoder().encode(c.id + '|' + (c.dir === 'out' ? 'o' : 'i') + '|' + (kind || '') + seq);
    crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv, additionalData: ad }, c.cryptoKey, bytes).then(function(ct) {
      var out = new Uint8Array(12 + ct.byteLength); out.set(iv, 0); out.set(new Uint8Array(ct), 12);
      // (ronda 2769: los "sigo aquí" sin voz, de 2 bytes, aparte: si no, el diagnóstico los daba por voz)
      if (kind === 'v') self.stats.sentV = (self.stats.sentV || 0) + 1; else if (!kind && bytes.length <= 2) self.stats.sentKeep = (self.stats.sentKeep || 0) + 1; else if (kind !== 'k' && kind !== 'c') self.stats.sent++;
      var pk = { type: 'vf', c: c.id, s: seq, d: _b64(out) };
      if (kind) pk.k = kind;
      return self.ble._sendMessageNative(link, JSON.stringify(pk), null);
    }).catch(function() {});
  }

  // Paquete de voz recibido (ble_messages.js)
  onFrame(p, via) {
    var self = this, c = self.call;
    if (!c || c.state !== 'active' || p.c !== c.id || !c.cryptoKey || typeof p.d !== 'string') return;
    var raw;
    try { raw = _unb64(p.d); } catch (e) { return; }
    if (raw.length < 29) return;
    var k = p.k || '';
    if (k && !/^[veck]$/.test(k)) return;
    var vid = k === 'v', fin = k === 'e';
    var ad = new TextEncoder().encode(c.id + '|' + (c.dir === 'out' ? 'i' : 'o') + '|' + k + p.s);
    crypto.subtle.decrypt({ name: 'AES-GCM', iv: raw.subarray(0, 12), additionalData: ad }, c.cryptoKey, raw.subarray(12)).then(function(pt) {
      var cc = self.call;
      if (!cc || cc.id !== c.id) return;
      // Ronda 2768: un paquete ya oído no se vuelve a reproducir (se podían repetir paquetes grabados del aire)
      var seenKey = (p.k || 'a') + p.s;
      cc.seen = cc.seen || new Set();
      if (cc.seen.has(seenKey)) return;
      cc.seen.add(seenKey);
      if (cc.seen.size > 1000) cc.seen.delete(cc.seen.values().next().value);
      cc.lastRx = Date.now();
      // Ronda 2768: se sigue el camino por el que llega la voz del otro (si se le cayó el Wi-Fi sin cierre limpio, aquí
      // aún parecía arriba y la voz seguía saliendo por él: el otro dejaba de oír y cortaba a los 12 s)
      if (via && !/^(lan|net)/i.test(String(via))) cc.rxBleAt = Date.now(); else if (via) cc.rxBleAt = 0;
      if (fin) { self._finish('ended', false); return; } // el otro colgó (aviso por el canal de la voz)
      // Ronda 2769: el otro no tiene mi imagen (manda una completa) / estado de su cámara y su micrófono
      if (k === 'k') { if (cc.media && typeof cc.media.requestKey === 'function') cc.media.requestKey(); return; }
      if (k === 'c') {
        var s2 = null;
        try { s2 = JSON.parse(new TextDecoder().decode(new Uint8Array(pt))); } catch (e) {}
        var okv = function(v) { return /^(on|off|retry|none)$/.test(String(v)) ? v : null; };
        var front = s2 && typeof s2.front === 'boolean' ? s2.front : null; // ronda 2772 (las versiones anteriores no lo mandan)
        var scr = !!(s2 && s2.scr === true); // 13-11: el otro comparte su pantalla
        if (s2 && (okv(s2.cam) !== cc.peerCam || okv(s2.mic) !== cc.peerMic || front !== cc.peerFront || scr !== !!cc.peerScreen)) {
          if (scr !== !!cc.peerScreen) console.log('[CALL] ' + cc.nx + (scr ? ' comparte su pantalla' : ' dejó de compartir su pantalla'));
          cc.peerCam = okv(s2.cam); cc.peerMic = okv(s2.mic); cc.peerFront = front; cc.peerScreen = scr; _emit('nexo:call', self.state());
        }
        return;
      }
      if (vid) { self.stats.gotV = (self.stats.gotV || 0) + 1; if (cc.media && cc.media.playVideo) cc.media.playVideo(new Uint8Array(pt)); return; }
      if (pt.byteLength <= 2) { self.stats.gotKeep = (self.stats.gotKeep || 0) + 1; return; } // ronda 2769: "sigo aquí" del otro (sin voz que mandar)
      self.stats.got++;
      if (cc.media && cc.media.play) cc.media.play(new Uint8Array(pt), p.s);
    }).catch(function() { self.stats.bad++; });
  }

  // Señal recibida (ble_messages.js / main.js)
  // mid: id del mensaje que la trajo (ronda 2768: el aviso nativo y lo tocado en él se atan a esa oferta)
  onSignal(fromNexoId, o, mid) {
    var self = this, nx = _nid(fromNexoId), c = self.call;
    if (o.op === 'offer') {
      if (self._dead.has(o.id)) { self._ignored(nx, 'terminada'); return; } // ya terminó (el 'end' llegó antes)
      if (Date.now() - (o.ts || 0) > OFFER_MAX_AGE_MS) { self._log(nx, 'missed', 0, false); self._ignored(nx, 'vieja'); return; }
      if (c && c.id === o.id) return;
      // Los dos se llaman a la vez: gana el id menor; el otro deja la suya y contesta la que gana
      if (c && c.nx === nx && c.dir === 'out' && c.state === 'calling') {
        if (o.id > c.id) { self._ignored(nx, 'cruce'); return; } // la mía gana: el otro contestará la mía
        if (typeof o.k !== 'string' || !/^[0-9a-f]{64}$/.test(o.k)) return;
        clearTimeout(self._ringTimer); self._signal(nx, 'end'); self._markDead(c.id);
        self.call = { id: o.id, nx: nx, dir: 'in', state: 'ringing', key: o.k, createdAt: Date.now(), sendSeq: 0, vSeq: 0, lastRx: 0, peerCodecs: o.co || 'ulaw', video: o.v === 1, offerMid: mid || '' };
        return self._importKey(o.k).then(function(k) { if (self.call && self.call.id === o.id) { self.call.cryptoKey = k; console.log('[CALL] Cruce de llamadas con ' + nx + ': se contesta la suya'); self.accept(); } });
      }
      // Del mismo contacto con otra llamada en curso: el otro la dejó (p.ej. reinició la app): fuera la vieja
      if (c && c.nx === nx) { self._finish(c.state === 'active' ? 'lost' : 'missed', false); c = null; }
      if (c) { self._signal(nx, 'busy', { id: o.id }); self._log(nx, 'missed', 0, false); self._ignored(nx, 'ocupado'); return; }
      if (typeof o.k !== 'string' || !/^[0-9a-f]{64}$/.test(o.k)) return;
      self.call = { id: o.id, nx: nx, dir: 'in', state: 'ringing', key: o.k, createdAt: Date.now(), sendSeq: 0, vSeq: 0, lastRx: 0, peerCodecs: o.co || 'ulaw', video: o.v === 1, offerMid: mid || '' };
      self._importKey(o.k).then(function(k) { if (self.call && self.call.id === o.id) self.call.cryptoKey = k; });
      // #dueño 01-11 (diagnóstico vídeo): una llamada entrante por INTERNET solo va en tiempo real por Tor directo (el
      // vídeo SOLO por Tor), y la conexión onion entre los dos tarda en enlazar. Encender Tor YA, al LLEGAR la oferta
      // (mientras suena), no al aceptar: así la 1ª videollamada enlaza antes y el vídeo aparece sin tener que rellamar.
      var inLink = self._link(nx);
      if (inLink && inLink.indexOf('net:') === 0 && self.ble && self.ble.net && typeof self.ble.net.ensureTor === 'function') self.ble.net.ensureTor();
      console.log('[CALL] Llamada entrante de ' + nx + ' (' + o.id + ')');
      _emit('nexo:call', self.state());
      self._signal(nx, 'ring'); // ¿sigue llamando? (si no, contesta 'end' y deja de sonar)
      self._ringTimer = setTimeout(function() { if (self.call && self.call.id === o.id && self.call.state === 'ringing') self._finish('missed', true); }, window.NEXO_CALL_RING_MS || RING_MS);
      return;
    }
    if (!c || c.id !== o.id || c.nx !== nx) {
      // De una llamada que aquí ya no existe: se apunta y, si el otro la cree viva, se le dice que terminó
      if (o.op !== 'end') { self._markDead(o.id); if (o.op === 'accept' || o.op === 'ring') self._signal(nx, 'end', { id: o.id }); }
      else self._markDead(o.id);
      return;
    }
    if (o.op === 'ring') return;
    // #dueño 01-11 (GRAVE): el otro entró/salió de una llamada telefónica y retuvo la suya. Marcar peerHeld para que
    // NUESTRO vigilante tampoco corte por silencio mientras él está en pausa; al volver (unhold) reiniciar el reloj.
    if (o.op === 'hold' || o.op === 'unhold') {
      c.peerHeld = (o.op === 'hold');
      if (!c.peerHeld) c.lastRx = Date.now();
      self._set({ peerHeld: c.peerHeld });
      return;
    }
    if (o.op === 'accept' && c.dir === 'out' && c.state === 'calling') {
      clearTimeout(self._ringTimer);
      if (typeof o.co === 'string' && /^[a-z,]{1,40}$/.test(o.co)) c.peerCodecs = o.co; // (una build anterior no lo dice)
      self._begin(); return;
    }
    if (o.op === 'reject') { self._finish('rejected', false); return; }
    if (o.op === 'busy') { self._finish('busy', false); return; }
    if (o.op === 'end') { self._finish(c.state === 'active' ? 'ended' : (c.dir === 'in' ? 'missed' : 'cancelled'), false); }
  }

  _finish(reason, notifyPeer) {
    var self = this, c = self.call;
    if (!c) return;
    _telecom('end');  // parte 2: cerrar la llamada Telecom saliente (idempotente; no-op si no había)
    self._markDead(c.id);
    self._dropOffer(c.offerMid);
    clearTimeout(self._ringTimer); clearInterval(self._silenceTimer);
    _pipActive(false); // llamada terminada → ya no entrar en miniatura
    if (c.screen) this._screenStop(c, 'colgó'); // 13-11: la captura de pantalla no sigue tras colgar
    if (notifyPeer) self._signal(c.nx, 'end');
    var secs = c.startedAt ? Math.round((Date.now() - c.startedAt) / 1000) : 0;
    if (c.startedAt) try { self._diag(c, 'Al colgar (' + secs + ' s)'); } catch (e) {}
    if (c.media && c.media.stop) { try { c.media.stop(); } catch (e) {} }
    self.call = null;
    console.log('[CALL] Fin (' + reason + ', ' + secs + ' s; voz enviada ' + self.stats.sent + ', recibida ' + self.stats.got + ')');
    _emit('nexo:call', { id: c.id, nx: c.nx, dir: c.dir, state: 'ended', reason: reason, seconds: secs, video: !!c.video });
    self._log(c.nx, reason, secs, c.dir === 'out', c.video);
  }

  // Línea en el chat (solo en este teléfono)
  _log(nx, reason, secs, own, video) {
    var w = video ? t('call_log_video', '🎥 Videollamada') : t('call_log_voice', '📞 Llamada'), ic = video ? '🎥' : '📞';
    var txt = secs > 0 ? w + ' · ' + Math.floor(secs / 60) + ':' + ('0' + (secs % 60)).slice(-2)
      : reason === 'missed' ? w + t('call_log_missed', ' perdida')
      : reason === 'busy' ? ic + t('call_log_busy', ' Ocupado')
      : reason === 'rejected' || reason === 'rejected_by_me' ? w + t('call_log_rejected', ' rechazada')
      : reason === 'unanswered' ? ic + t('call_log_no_answer', ' Sin respuesta')
      : w + t('call_log_cancelled', ' cancelada');
    _emit('nexo:callLog', { nx: nx, text: txt, own: !!own, missed: reason === 'missed' });
  }
}

export function createCalls(ble, mediaFactory) { return new Calls(ble, mediaFactory); }
