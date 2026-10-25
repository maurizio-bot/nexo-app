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
var RING_MS = 45000;
var SILENCE_MS = 12000;
// Ronda 2768: solo para ofertas muy viejas; si una reciente sigue viva lo dice el que llama al recibir 'ring' (antes, con
// el reloj del otro más de 60 s adelantado, nunca sonaba)
var OFFER_MAX_AGE_MS = 600000;
var DEAD_MS = 180000;

var DIAG_EVERY_MS = 5000;

function _nid(id) { return (id || '').toString().toLowerCase().trim(); }
function _emit(name, detail) { try { window.dispatchEvent(new CustomEvent(name, { detail: detail })); } catch (e) {} }
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
    return bt;
  }
  canCall(nexoId) { return !!this._link(_nid(nexoId)); }
  canVideo(nexoId) { var l = this._link(_nid(nexoId)); return !!l && l.indexOf('lan:') === 0; }
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
    return ble.sendChatMessage(nx, JSON.stringify(o), mid).catch(function(e) { console.warn('[CALL] Señal ' + op + ' no enviada: ' + (e && e.message)); });
  }

  _importKey(hex) { return crypto.subtle.importKey('raw', _fromHex(hex), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']); }

  // Llamar a un contacto (video: videollamada)
  start(nexoId, video) {
    var self = this, nx = _nid(nexoId);
    if (self.call) return Promise.reject(new Error('Ya hay una llamada'));
    if (!self._link(nx)) return Promise.reject(new Error('Para llamar hace falta tener al contacto cerca (Bluetooth) o en el mismo Wi-Fi'));
    if (video && !self.canVideo(nx)) return Promise.reject(new Error('Para una videollamada hace falta estar en el mismo Wi-Fi (por Bluetooth solo voz)'));
    var id = 'cl' + Date.now().toString(36) + _hex(4), key = _hex(32);
    self.call = { id: id, nx: nx, dir: 'out', state: 'calling', key: key, createdAt: Date.now(), sendSeq: 0, vSeq: 0, lastRx: 0, video: !!video };
    _emit('nexo:call', self.state());
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
    return c.media.flip().then(function(f) { if (self.call === c) self._set({ facing: f }); return f; });
  }

  mute(on) { var c = this.call; if (!c) return; c.muted = !!on; if (c.media && c.media.mute) c.media.mute(!!on); _emit('nexo:call', this.state()); }

  // La llamada empieza: micrófono y altavoz
  _begin() {
    var self = this, c = self.call;
    if (!c) return;
    c.startedAt = Date.now(); c.lastRx = Date.now();
    self.stats = { sent: 0, got: 0, bad: 0 }; // por llamada (el diagnóstico de cada una)
    self._set({ state: 'active', startedAt: c.startedAt });
    console.log('[CALL] En llamada con ' + c.nx + ' (' + c.id + ')');
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
      if (Date.now() - (cc.lastRx || 0) > SILENCE_MS) { self._signal(cc.nx, 'end'); self._finish('lost', false); return; }
      if (Date.now() - (cc.diagAt || cc.startedAt) >= DIAG_EVERY_MS) { cc.diagAt = Date.now(); self._diag(cc, ''); }
      // Ronda 2769: el estado se repite cada 5 s (un aviso perdido no deja al otro con lo de antes)
      if (cc.camState && Date.now() - (cc.stateAt || 0) >= DIAG_EVERY_MS) self._sendState(cc);
    }, 1000);
  }

  // Ronda 2769: mi cámara y mi micrófono, para la pantalla del otro ('c', cifrado como la voz)
  _sendState(c) {
    c.stateAt = Date.now();
    this._sendPacket(new TextEncoder().encode(JSON.stringify({ cam: c.camState || 'none', mic: c.micState || 'on' })), 'c');
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
        ' pico ' + pct(m.micPeak) + ', audio ' + m.ctx + ', ' + m.codec + (c.peerCodecs ? ' (el otro: ' + c.peerCodecs + ')' : '') : ', sin audio') +
      ', por ' + (link ? (link.indexOf('lan:') === 0 ? 'Wi-Fi' : 'Bluetooth') : 'ningún camino'));
    // Ronda 2769: pistas y vídeo de los dos sentidos (para ver en el diagnóstico por qué no se ve o no se oye)
    if (m && (m.micTrack || m.video)) {
      var v = m.video;
      // (ronda 2771: "Estado", para no confundirla con los avisos "[CALL] Micrófono: <error>")
      console.log('[CALL] Estado: micrófono con pista ' + m.micTrack + (m.micErr ? ' (' + m.micErr + ')' : '') + (m.micReopens ? ', reabierto ' + m.micReopens : '') +
        (v ? '; cámara ' + v.cam + ', pista ' + v.track + (v.err ? ' (' + v.err + ')' : '') + ', imagen local ' + v.local + ', codificador ' + v.enc +
          ', imágenes ' + v.frames + ' (completas ' + v.keys + ')' + (v.reopens ? ', reabierta ' + v.reopens : '') + (v.encErr ? ', fallos al codificar ' + v.encErr : '') +
          '; del otro: decodificadas ' + v.decoded + ', decodificador ' + v.dec + (v.decErr ? ', fallos ' + v.decErr : '') + (v.keyReq ? ', pedidas completas ' + v.keyReq : '') +
          (c.peerCam ? ', su cámara ' + c.peerCam : '') + (c.peerMic && c.peerMic !== 'on' ? ', su micrófono ' + c.peerMic : '') : ''));
    }
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
    if (kind === 'v' && link.indexOf('lan:') !== 0) return; // vídeo solo por Wi-Fi
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
        if (s2 && (okv(s2.cam) !== cc.peerCam || okv(s2.mic) !== cc.peerMic)) { cc.peerCam = okv(s2.cam); cc.peerMic = okv(s2.mic); _emit('nexo:call', self.state()); }
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
    self._markDead(c.id);
    self._dropOffer(c.offerMid);
    clearTimeout(self._ringTimer); clearInterval(self._silenceTimer);
    if (notifyPeer) self._signal(c.nx, 'end');
    var secs = c.startedAt ? Math.round((Date.now() - c.startedAt) / 1000) : 0;
    if (c.startedAt) try { self._diag(c, 'Al colgar (' + secs + ' s)'); } catch (e) {}
    if (c.media && c.media.stop) { try { c.media.stop(); } catch (e) {} }
    self.call = null;
    console.log('[CALL] Fin (' + reason + ', ' + secs + ' s; voz enviada ' + self.stats.sent + ', recibida ' + self.stats.got + ')');
    _emit('nexo:call', { id: c.id, nx: c.nx, dir: c.dir, state: 'ended', reason: reason, seconds: secs });
    self._log(c.nx, reason, secs, c.dir === 'out', c.video);
  }

  // Línea en el chat (solo en este teléfono)
  _log(nx, reason, secs, own, video) {
    var w = video ? '🎥 Videollamada' : '📞 Llamada', ic = video ? '🎥' : '📞';
    var t = secs > 0 ? w + ' · ' + Math.floor(secs / 60) + ':' + ('0' + (secs % 60)).slice(-2)
      : reason === 'missed' ? w + ' perdida'
      : reason === 'busy' ? ic + ' Ocupado'
      : reason === 'rejected' || reason === 'rejected_by_me' ? w + ' rechazada'
      : reason === 'unanswered' ? ic + ' Sin respuesta'
      : w + ' cancelada';
    _emit('nexo:callLog', { nx: nx, text: t, own: !!own, missed: reason === 'missed' });
  }
}

export function createCalls(ble, mediaFactory) { return new Calls(ble, mediaFactory); }
