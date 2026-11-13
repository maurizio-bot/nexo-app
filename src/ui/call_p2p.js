/**
 * call_p2p.js — LLAMADAS Y VIDEOLLAMADAS POR INTERNET DIRECTAS entre los dos teléfonos (dueño 13-11: «no me gusta que solo
 * con Tor se habilite el vídeo; debería de ser siempre» → «sí, hazlo así, directo por defecto»).
 *
 * Por internet la llamada iba por los relés (buzones públicos: retraso de segundos, sin vídeo) o por Tor directo (lento, y
 * estaba apagado en el S24). Ahora, en cuanto empieza una llamada con alguien que está por internet, los dos teléfonos
 * buscan un camino DIRECTO (WebRTC, como las llamadas de WhatsApp): un servidor público de ayuda (STUN) solo les dice su
 * dirección de internet; se la intercambian por la señal de la llamada (cifrada como siempre) y abren un canal de datos
 * directo entre ellos. Por ese canal van los MISMOS paquetes de siempre (voz, vídeo, estado), cifrados con la clave de la
 * llamada: el canal no ve nada. Voz y vídeo con calidad de Wi-Fi, sin servidor nuestro.
 * Si la red no deja la conexión directa (algunas redes de empresa/datos móviles), no pasa nada: sigue por los relés (voz e
 * imágenes pequeñas, 3055/3056).
 * Privacidad: con la conexión directa el otro puede ver tu dirección de internet (IP), como en WhatsApp. Quien no lo quiera
 * activa «Usar Tor siempre» en Ajustes (state.tor === true): entonces no hay conexión directa.
 *
 * Señal: op 'rtc' de la llamada, { t: 'offer'|'answer', sdp } (sin candidatos sueltos: se espera a reunirlos, ≤ GATHER_MS).
 */

var STUN = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] }];
var GATHER_MS = 4000;     // como mucho esto juntando direcciones antes de mandar la oferta/respuesta
var OPEN_MS = 20000;      // si el canal no abre en esto, la red no deja la conexión directa: sigue por los relés
var MAX_BUFFER = 1000000; // el canal va lleno: se descarta (tiempo real: mejor perder un paquete que acumular retraso)

function _RTC() { return (typeof window !== 'undefined' && window.RTCPeerConnection) || null; }

export class CallP2P {
  // opts: { signal(nx, o), onMessage(nx, str), onOpen(nx), onDown(nx, why), privacy() }
  constructor(opts) { this.opts = opts || {}; this.peers = new Map(); this.stats = { opened: 0, failed: 0 }; }

  // ¿Se puede intentar? (WebView con WebRTC y sin «Usar Tor siempre»)
  enabled() { return !!_RTC() && !(typeof this.opts.privacy === 'function' && this.opts.privacy()); }
  ready(nx) { var p = this.peers.get(nx); return !!(p && p.open && p.dc && p.dc.readyState === 'open'); }
  trying(nx) { var p = this.peers.get(nx); return !!(p && !p.open); }

  // El que llama abre: canal + oferta
  start(nx) {
    if (!this.enabled() || this.peers.has(nx)) return false;
    var self = this, p = this._make(nx, 'offer');
    if (!p) return false;
    try { p.dc = p.pc.createDataChannel('nexo', { ordered: false, maxRetransmits: 0 }); } catch (e) { this._fail(nx, p, 'canal: ' + (e && e.message)); return false; }
    this._wire(nx, p, p.dc);
    console.log('[P2P] Busco conexión directa por internet con ' + nx);
    p.pc.createOffer().then(function(o) { return p.pc.setLocalDescription(o); }).then(function() { return self._gathered(p); }).then(function() {
      if (self.peers.get(nx) !== p) return;
      self.opts.signal(nx, { t: 'offer', sdp: p.pc.localDescription.sdp });
    }).catch(function(e) { self._fail(nx, p, 'oferta: ' + (e && e.message)); });
    return true;
  }

  // Señal 'rtc' del otro
  onSignal(nx, o) {
    var self = this;
    if (!o || typeof o.sdp !== 'string' || o.sdp.length > 20000) return;
    if (o.t === 'offer') {
      if (!this.enabled()) { console.log('[P2P] ' + nx + ' propone conexión directa; aquí está «Usar Tor siempre»: sigue por los relés'); return; }
      this.close(nx);
      var p = this._make(nx, 'answer');
      if (!p) return;
      p.pc.ondatachannel = function(ev) { if (self.peers.get(nx) !== p) return; p.dc = ev.channel; self._wire(nx, p, p.dc); };
      p.pc.setRemoteDescription({ type: 'offer', sdp: o.sdp }).then(function() { return p.pc.createAnswer(); })
        .then(function(a) { return p.pc.setLocalDescription(a); }).then(function() { return self._gathered(p); })
        .then(function() { if (self.peers.get(nx) === p) self.opts.signal(nx, { t: 'answer', sdp: p.pc.localDescription.sdp }); })
        .catch(function(e) { self._fail(nx, p, 'respuesta: ' + (e && e.message)); });
    } else if (o.t === 'answer') {
      var q = this.peers.get(nx);
      if (!q || q.role !== 'offer' || q.answered) return;
      q.answered = true;
      q.pc.setRemoteDescription({ type: 'answer', sdp: o.sdp }).catch(function(e) { self._fail(nx, q, 'respuesta del otro: ' + (e && e.message)); });
    }
  }

  _make(nx, role) {
    var R = _RTC();
    if (!R) return null;
    var pc;
    try { pc = new R({ iceServers: STUN }); } catch (e) { console.warn('[P2P] No se pudo preparar la conexión directa: ' + (e && e.message)); return null; }
    var self = this, p = { pc: pc, dc: null, open: false, role: role, t0: Date.now() };
    this.peers.set(nx, p);
    p.timer = setTimeout(function() { if (!p.open) self._fail(nx, p, 'no conectó en ' + Math.round(OPEN_MS / 1000) + ' s (la red no deja la conexión directa)'); }, OPEN_MS); // i18n-ok: diagnóstico
    pc.onconnectionstatechange = function() { var s = pc.connectionState; if ((s === 'failed' || s === 'closed') && self.peers.get(nx) === p) self._fail(nx, p, 'conexión ' + s); };
    return p;
  }

  // Esperar a tener las direcciones (sin mandarlas sueltas): como mucho GATHER_MS
  _gathered(p) {
    var pc = p.pc;
    if (pc.iceGatheringState === 'complete') return Promise.resolve();
    return new Promise(function(res) {
      var done = false, fin = function() { if (!done) { done = true; res(); } };
      pc.onicegatheringstatechange = function() { if (pc.iceGatheringState === 'complete') fin(); };
      pc.onicecandidate = function(ev) { if (!ev || !ev.candidate) fin(); };
      setTimeout(fin, GATHER_MS);
    });
  }

  _wire(nx, p, dc) {
    var self = this;
    dc.onopen = function() {
      if (self.peers.get(nx) !== p || p.open) return;
      p.open = true; clearTimeout(p.timer); self.stats.opened++;
      console.log('[P2P] Conexión DIRECTA por internet con ' + nx + ' en ' + ((Date.now() - p.t0) / 1000).toFixed(1) + ' s: voz y vídeo directos');
      if (typeof self.opts.onOpen === 'function') self.opts.onOpen(nx);
    };
    dc.onclose = function() { if (self.peers.get(nx) === p) self._fail(nx, p, 'se cerró'); };
    dc.onmessage = function(ev) { if (typeof ev.data === 'string' && ev.data.length < 400000) self.opts.onMessage(nx, ev.data); };
  }

  send(nx, str) {
    var p = this.peers.get(nx);
    if (!p || !p.open || !p.dc || p.dc.readyState !== 'open') return false;
    try { if (p.dc.bufferedAmount > MAX_BUFFER) return true; p.dc.send(str); return true; } catch (e) { return false; }
  }

  _fail(nx, p, why) {
    if (this.peers.get(nx) !== p) return;
    var was = p.open;
    this.stats.failed++;
    console.warn('[P2P] ' + (was ? 'Se cortó la conexión directa' : 'Sin conexión directa') + ' con ' + nx + ': ' + why + ' → sigue por los relés');
    this.close(nx);
    if (typeof this.opts.onDown === 'function') this.opts.onDown(nx, why, was);
  }

  close(nx) {
    var p = this.peers.get(nx);
    if (!p) return;
    this.peers.delete(nx); clearTimeout(p.timer);
    try { if (p.dc) p.dc.close(); } catch (e) {}
    try { p.pc.close(); } catch (e) {}
  }
}

export function createCallP2P(opts) { return new CallP2P(opts); }
