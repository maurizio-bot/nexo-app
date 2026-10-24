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
var OFFER_MAX_AGE_MS = 60000;

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
    if (op === 'offer') { ble._callOut = ble._callOut || new Set(); ble._callOut.add(mid); }
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
    return self._importKey(key).then(function(k) {
      if (!self.call || self.call.id !== id) return;
      self.call.cryptoKey = k;
      return self._signal(nx, 'offer', video ? { k: key, co: 'opus,ulaw', v: 1 } : { k: key, co: 'opus,ulaw' });
    });
  }

  // Contestar la llamada entrante
  accept() {
    var self = this, c = self.call;
    if (!c || c.dir !== 'in' || c.state !== 'ringing') return;
    clearTimeout(self._ringTimer);
    self._signal(c.nx, 'accept');
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

  mute(on) { var c = this.call; if (!c) return; c.muted = !!on; if (c.media && c.media.mute) c.media.mute(!!on); _emit('nexo:call', this.state()); }

  // La llamada empieza: micrófono y altavoz
  _begin() {
    var self = this, c = self.call;
    if (!c) return;
    c.startedAt = Date.now(); c.lastRx = Date.now();
    self._set({ state: 'active', startedAt: c.startedAt });
    console.log('[CALL] En llamada con ' + c.nx + ' (' + c.id + ')');
    var media;
    try {
      media = self.mediaFactory({ onPacket: function(bytes) { self._sendPacket(bytes); }, codecs: c.peerCodecs || 'opus,ulaw',
        video: !!c.video, onVideoPacket: function(bytes) { self._sendPacket(bytes, 'v'); } });
    } catch (e) { console.warn('[CALL] Sin audio: ' + (e && e.message)); }
    c.media = media || null;
    if (media && media.start) Promise.resolve(media.start()).then(function(info) {
      if (info && info.codec) {
        console.log('[CALL] Audio: ' + info.codec + (c.video ? ', vídeo: ' + (info.video ? 'VP8' : 'no') : ''));
        self._set(c.video ? { codec: info.codec, videoOk: !!info.video } : { codec: info.codec });
      }
    }).catch(function(e) { console.warn('[CALL] Micrófono: ' + (e && e.message)); self._set({ micError: (e && e.message) || 'sin micrófono' }); });
    self._silenceTimer = setInterval(function() {
      var cc = self.call;
      if (!cc || cc.id !== c.id) return;
      if (Date.now() - (cc.lastRx || 0) > SILENCE_MS) { self._signal(cc.nx, 'end'); self._finish('lost', false); }
    }, 1000);
  }

  _sendPacket(bytes, kind) {
    var self = this, c = self.call;
    if (!c || c.state !== 'active' || !c.cryptoKey) return;
    var link = self._link(c.nx, c.lastRx && Date.now() - c.lastRx > 3000);
    if (!link) {
      // Se fue el Wi-Fi y aún no hay Bluetooth: buscarlo ya (sin esperar al margen de espera del Wi-Fi de lan.js)
      if (!c.seeking && self.ble && typeof self.ble._markPeerLost === 'function') { c.seeking = true; console.log('[CALL] Sin enlace: buscando por Bluetooth'); self.ble._markPeerLost(c.nx); }
      return;
    }
    c.seeking = false;
    if (kind === 'v' && link.indexOf('lan:') !== 0) return; // vídeo solo por Wi-Fi
    var seq = kind === 'v' ? c.vSeq++ : kind === 'e' ? 0 : c.sendSeq++;
    var iv = crypto.getRandomValues(new Uint8Array(12));
    var ad = new TextEncoder().encode(c.id + '|' + (c.dir === 'out' ? 'o' : 'i') + '|' + (kind === 'v' || kind === 'e' ? kind : '') + seq);
    crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv, additionalData: ad }, c.cryptoKey, bytes).then(function(ct) {
      var out = new Uint8Array(12 + ct.byteLength); out.set(iv, 0); out.set(new Uint8Array(ct), 12);
      self.stats.sent++;
      var pk = { type: 'vf', c: c.id, s: seq, d: _b64(out) };
      if (kind === 'v' || kind === 'e') pk.k = kind;
      return self.ble._sendMessageNative(link, JSON.stringify(pk), null);
    }).catch(function() {});
  }

  // Paquete de voz recibido (ble_messages.js)
  onFrame(p) {
    var self = this, c = self.call;
    if (!c || c.state !== 'active' || p.c !== c.id || !c.cryptoKey || typeof p.d !== 'string') return;
    var raw;
    try { raw = _unb64(p.d); } catch (e) { return; }
    if (raw.length < 29) return;
    var vid = p.k === 'v', fin = p.k === 'e';
    var ad = new TextEncoder().encode(c.id + '|' + (c.dir === 'out' ? 'i' : 'o') + '|' + (vid || fin ? p.k : '') + p.s);
    crypto.subtle.decrypt({ name: 'AES-GCM', iv: raw.subarray(0, 12), additionalData: ad }, c.cryptoKey, raw.subarray(12)).then(function(pt) {
      var cc = self.call;
      if (!cc || cc.id !== c.id) return;
      cc.lastRx = Date.now();
      if (fin) { self._finish('ended', false); return; } // el otro colgó (aviso por el canal de la voz)
      if (vid) { self.stats.gotV = (self.stats.gotV || 0) + 1; if (cc.media && cc.media.playVideo) cc.media.playVideo(new Uint8Array(pt)); return; }
      self.stats.got++;
      if (cc.media && cc.media.play) cc.media.play(new Uint8Array(pt), p.s);
    }).catch(function() { self.stats.bad++; });
  }

  // Señal recibida (ble_messages.js / main.js)
  onSignal(fromNexoId, o) {
    var self = this, nx = _nid(fromNexoId), c = self.call;
    if (o.op === 'offer') {
      if (Date.now() - (o.ts || 0) > OFFER_MAX_AGE_MS) { self._log(nx, 'missed', 0, false); return; } // vieja (app cerrada)
      if (c && c.id === o.id) return;
      if (c) { self._signal(nx, 'busy', { id: o.id }); self._log(nx, 'missed', 0, false); return; }
      if (typeof o.k !== 'string' || !/^[0-9a-f]{64}$/.test(o.k)) return;
      self.call = { id: o.id, nx: nx, dir: 'in', state: 'ringing', key: o.k, createdAt: Date.now(), sendSeq: 0, vSeq: 0, lastRx: 0, peerCodecs: o.co || 'ulaw', video: o.v === 1 };
      self._importKey(o.k).then(function(k) { if (self.call && self.call.id === o.id) self.call.cryptoKey = k; });
      console.log('[CALL] Llamada entrante de ' + nx + ' (' + o.id + ')');
      _emit('nexo:call', self.state());
      self._ringTimer = setTimeout(function() { if (self.call && self.call.id === o.id && self.call.state === 'ringing') self._finish('missed', true); }, window.NEXO_CALL_RING_MS || RING_MS);
      return;
    }
    if (!c || c.id !== o.id || c.nx !== nx) return;
    if (o.op === 'accept' && c.dir === 'out' && c.state === 'calling') { clearTimeout(self._ringTimer); self._begin(); return; }
    if (o.op === 'reject') { self._finish('rejected', false); return; }
    if (o.op === 'busy') { self._finish('busy', false); return; }
    if (o.op === 'end') { self._finish(c.state === 'active' ? 'ended' : (c.dir === 'in' ? 'missed' : 'cancelled'), false); }
  }

  _finish(reason, notifyPeer) {
    var self = this, c = self.call;
    if (!c) return;
    clearTimeout(self._ringTimer); clearInterval(self._silenceTimer);
    if (notifyPeer) self._signal(c.nx, 'end');
    if (c.media && c.media.stop) { try { c.media.stop(); } catch (e) {} }
    var secs = c.startedAt ? Math.round((Date.now() - c.startedAt) / 1000) : 0;
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
