import { schnorr } from '@noble/curves/secp256k1.js';
import { _event, BLOB_KIND, _relaySafe, _relayHost, _rnd, SEND_SILENT_MS, MAX_RELAY_FRAME } from './net_link_shared.js';
import { bytesToHex } from '@noble/hashes/utils.js';
// Métodos de NetLink: PUBLICAR y BAJAR: eventos en los relés, buzón de archivos, publicar en varios y bajar por id.
// Reestructuración 15-11: movidos TAL CUAL desde net_link.js, que los une a la clase (como métodos normales).

// 3348 (diag. del dueño 26-11 14:47–17:11, builds 3156/3159: «rate-limited: too many gift wraps from this address» → «banned: too many
// rate-limit violations»; otro relé: «Policy violated and pubkey is not in our web of trust»). Cada sobre más a un relé que ya limita
// es otra infracción y lleva al castigo (y con 3 teléfonos en la misma Wi-Fi, la misma dirección: castigo para todos). Un relé que dice
// que limita, castiga o no nos deja publicar queda EN PAUSA para publicar (se sigue leyendo de él) y lo que salga va a los demás; si
// todos están en pausa, el envío queda pendiente al momento SIN mandar nada (no cuenta como otra infracción). En pausa cuenta como caído
// para la reserva (_spareCheck): entra otro relé. Tras la pausa, el siguiente envío lo prueba otra vez; si vuelve a decir que no, la
// pausa se dobla. Y mientras dure la calma tras un límite, lo PESADO (trozos de un mensaje grande, historial de grupo, respaldos) sale
// con un respiro entre evento y evento; lo pequeño (textos, confirmaciones, saludos) sale sin esperar.
var RATE_COOL_MS = 20000, RATE_COOL_MAX_MS = 600000;       // «rate-limited / slow down / too many»: 20 s, 40 s … 10 min
var BAN_COOL_MS = 600000, BAN_COOL_MAX_MS = 7200000;       // «banned»: 10 min, 20 min … 2 h
var POLICY_COOL_MS = 6 * 3600000;                          // no nos deja publicar (web of trust, pago, prueba de trabajo…): 6 h
var LIMIT_FORGET_MS = 1800000;                             // sin otro «no» en 30 min, la pausa vuelve a empezar desde abajo
var LIMIT_CALM_MS = 300000, BULK_EV_CHARS = 4000, BULK_GAP_MS = 1200; // tras un límite, 5 min con un respiro de 1,2 s entre eventos pesados
export function relayLimitKind(msg) {
  var m = String(msg || '');
  if (/^(duplicate|invalid|auth-required|error):/i.test(m)) return '';
  // (la clave de cada sobre es nueva cada vez: «pubkey is not in our web of trust» no se arregla nunca con ese relé)
  if (/web of trust|not in our|policy|pubkey is not|whitelist|allowlist|paid|payment|^pow:/i.test(m)) return 'policy';
  if (/banned|^restricted:|^blocked:/i.test(m)) return 'ban';
  if (/rate.?limit|slow down|too many|too fast/i.test(m)) return 'rate';
  return '';
}
// Pura (prueba relelimita.js): la pausa que toca para el n-ésimo «no» seguido de ese tipo
export function relayCoolMs(kind, n) {
  n = Math.max(1, n || 1);
  if (kind === 'policy') return POLICY_COOL_MS;
  if (kind === 'ban') return Math.min(BAN_COOL_MS * Math.pow(2, n - 1), BAN_COOL_MAX_MS);
  if (kind === 'rate') return Math.min(RATE_COOL_MS * Math.pow(2, n - 1), RATE_COOL_MAX_MS);
  return 0;
}
export const netPublish = {
  // 3348: ¿este relé está en pausa para publicar?
  relayCooling(r, now) { return !!(r && !r.gw && r.coolUntil && r.coolUntil > (now || Date.now())); },
  // 3348: un relé dijo que no: si es por límite o castigo, en pausa (y quizá entra uno de reserva)
  _relayLimitNote(url, r, msg) {
    if (!r || r.gw) return;
    var kind = relayLimitKind(msg); if (!kind) return;
    var now = Date.now();
    r.limitN = (r.limitKind === kind && now - (r.limitAt || 0) < LIMIT_FORGET_MS) ? (r.limitN || 0) + 1 : 1;
    r.limitKind = kind; r.limitAt = now; this._limitAt = now;
    var ms = relayCoolMs(kind, r.limitN);
    r.coolUntil = now + ms;
    console.log('[NET] Relé ' + _relayHost(url) + ' limita («' + String(msg || '').substring(0, 90) + '»): en pausa ' + Math.round(ms / 1000) + ' s para publicar (' + r.limitN + '.ª vez); lo de ahora va a los demás'); // i18n-ok: registro
    try { if (typeof this._spareCheck === 'function') this._spareCheck(); } catch (e) {}
  },
  // 3348: tras un límite, cuánto debe esperar este evento PESADO (0: sale ya). Reserva su turno.
  _bulkWait(ev) {
    if (!ev || typeof ev.content !== 'string' || ev.content.length < BULK_EV_CHARS) return 0;
    var now = Date.now();
    if (now - (this._limitAt || 0) > LIMIT_CALM_MS) return 0;
    var at = Math.max(now, this._bulkNextAt || 0);
    this._bulkNextAt = at + BULK_GAP_MS;
    return at - now;
  },
  // 3348: el motivo para dejar pendiente un envío con todos los relés en pausa (lo reconoce ble_ack _relayLimited)
  _allCoolingErr(open) {
    var now = Date.now(), soon = Math.min.apply(null, open.map(function(r) { return r.coolUntil || now; }));
    return Object.assign(new Error('Rechazado por los relés: rate-limited (todos en pausa ' + Math.max(1, Math.round((soon - now) / 1000)) + ' s más)'), { code: 'NET_REJECTED' }); // i18n-ok: error interno
  },

  // ---------- Fase B (build 2969): BUZÓN DE ARCHIVOS (src/net/blob_mailbox.js) ----------
  // Los trozos de un archivo cifrado van como eventos BLOB_KIND SIN etiqueta p (se bajan por id: el relé no correlaciona
  // quién baja qué), con caducidad; se publican en TODOS los relés abiertos (réplica) y se piden a UN relé por id.
  randomKey() { return schnorr.utils.randomSecretKey(); },
  // Sin relés propios, los relés de verdad a los que llego por los puentes (parte 3: fotos pequeñas por el puente)
  openRelayUrls() {
    var out = [];
    this.relays.forEach(function(r, u) { if (r.open && !r.gw) out.push(u); });
    if (!out.length) this.relays.forEach(function(r) { if (r.open && r.gw && r.realUrl && out.indexOf(r.realUrl) < 0) out.push(r.realUrl); });
    return out;
  },
  // El relé (propio o por un puente) con el que hablar para esta URL de relé de verdad
  _relayFor(url) {
    var r = this.relays.get(url);
    if (r && r.open) return r;
    var g = null;
    this.relays.forEach(function(x) { if (!g && x.gw && x.open && x.realUrl === url) g = x; });
    var f = this.fetchRelays && this.fetchRelays.get(url); // T-R1: relé de un puntero, «solo bajar por id»
    return g || (f && f.open ? f : null) || r || null;
  },
  // ---------- Auditoría 23-11 (T-R1): relés de un PUNTERO de archivo, «solo bajar por id» ----------
  // Un contacto pone en su puntero los relés que quiera. Antes se abrían como uno más de los míos (ensureRelay → _connect): se
  // quedaban en mi lista y recibían mi suscripción con TODAS mis etiquetas de buzón, mi AUTH (NIP-42) y lo que publico, además de
  // mi IP de forma duradera. Ahora un relé que NO es de los míos se abre aparte, solo para pedir esos trozos por id (sin
  // suscripción, sin AUTH, sin publicar nada; lo demás que diga se ignora) y se cierra al terminar la bajada.
  isMyRelay(url) { return this.relays.has(url) || (this.gwOnly() && this.openRelayUrls().indexOf(url) >= 0); },
  fetchOnlyOpen(url, waitMs) {
    var self = this;
    if (!_relaySafe(url) || self.gwOnly()) return Promise.resolve(false);
    if (!self.fetchRelays) self.fetchRelays = new Map();
    var f = self.fetchRelays.get(url);
    if (f && f.open) return Promise.resolve(true);
    if (!f) {
      f = { url: url, fetchOnly: true, open: false, fetches: new Map(), waits: new Map(), ws: null };
      var ws;
      try { ws = typeof self._newSocket === 'function' ? self._newSocket(url) : new WebSocket(url); } catch (e) { return Promise.resolve(false); }
      if (!ws) return Promise.resolve(false);
      f.ws = ws;
      self.fetchRelays.set(url, f);
      ws.onopen = function() { f.open = true; f.rxAt = Date.now(); };
      ws.onmessage = function(ev) { f.rxAt = Date.now(); self._onFetchOnlyMsg(f, ev.data); };
      ws.onclose = function() { f.open = false; f.ws = null; if (self.fetchRelays.get(url) === f) self.fetchRelays.delete(url); f.fetches.forEach(function(x) { try { x.done(); } catch (e) {} }); };
      ws.onerror = function() {};
      console.log('[NET] Relé ' + _relayHost(url) + ' (de un puntero de archivo, no es de los míos): lo abro solo para bajar por id'); // i18n-ok: registro
    }
    return new Promise(function(resolve) {
      var t0 = Date.now(), iv = setInterval(function() {
        if (f.open) { clearInterval(iv); resolve(true); }
        else if (!f.ws || Date.now() - t0 > (waitMs || 6000)) { clearInterval(iv); self.fetchOnlyClose(url); resolve(false); }
      }, 100);
    });
  },
  fetchOnlyClose(url) {
    var f = this.fetchRelays && this.fetchRelays.get(url);
    if (!f) return;
    this.fetchRelays.delete(url);
    var ws = f.ws; f.open = false; f.ws = null;
    if (ws) { ws.onopen = null; ws.onmessage = null; ws.onclose = null; try { ws.close(); } catch (e) {} }
    f.fetches.forEach(function(x) { try { x.done(); } catch (e) {} });
  },
  // Lo que dice un relé «solo bajar por id»: solo las respuestas a una bajada; nada de AUTH, sobres ni nada más
  _onFetchOnlyMsg(f, data) {
    if (typeof data !== 'string' || data.length > MAX_RELAY_FRAME) return;
    var m; try { m = JSON.parse(data); } catch (e) { return; }
    if (!Array.isArray(m) || typeof m[1] !== 'string' || !f.fetches.has(m[1])) return;
    var fj = f.fetches.get(m[1]);
    if (m[0] === 'EVENT' && m[2]) fj.onEvent(m[2]);
    else if (m[0] === 'EOSE' || m[0] === 'CLOSED') fj.done();
  },
  blobEvent(sk, contentB64, expiresSec) { return _event(sk, BLOB_KIND, [['expiration', String(expiresSec)]], contentB64); },
  // NIP-09: pedir el borrado de los trozos (firmado con la clave del blob) al confirmar; best-effort (la caducidad es la garantía)
  blobDeleteEvent(sk, ids) { return _event(sk, 5, (ids || []).map(function(id) { return ['e', id]; }), ''); },
  // Conectar a demanda a un relé del puntero que no tengamos (solo wss:// o localhost); resuelve true si quedó abierto
  // force (3073, diagnóstico S24 14-11 18:41: un audio del S23 «faltan 5 de 5 trozos» una y otra vez): para bajar un archivo cuyo
  // único relé está apartado por inestable o esperando su reintento, se intenta igual una vez (si no, el archivo no baja nunca
  // mientras dure el apartado: 5 min)
  ensureRelay(url, waitMs, force) {
    var self = this;
    if (!_relaySafe(url)) return Promise.resolve(false);
    var r = self._relayFor(url);
    if (r && r.open) return Promise.resolve(true);
    if (self.gwOnly()) return Promise.resolve(false); // sin internet propio no se puede abrir otro relé (solo los de los puentes)
    r = self.relays.get(url);
    if (force && r && !r.ws && r.retryAt > Date.now()) { console.log('[NET] Relé ' + _relayHost(url) + ' apartado, pero tiene un archivo que hace falta: lo abro igual'); r.retryAt = 0; } // i18n-ok
    if (!r || (!r.ws && (!r.retryAt || r.retryAt <= Date.now()))) { try { self._connect(url); } catch (e) { return Promise.resolve(false); } }
    return new Promise(function(resolve) {
      var t0 = Date.now(), iv = setInterval(function() {
        var rr = self.relays.get(url);
        if (rr && rr.open) { clearInterval(iv); resolve(true); }
        else if (Date.now() - t0 > (waitMs || 6000)) { clearInterval(iv); resolve(false); }
      }, 100);
    });
  },
  // Publica en TODOS los relés abiertos y devuelve los que dijeron OK (acá importa la RÉPLICA, no «al menos uno»)
  // opts (3042, dueño 13-11: un GIF de 4,6 MB tardaba ~6 min en subir al buzón de archivos): { enough, graceMs } — con
  // `enough` relés que ya dijeron OK se espera como mucho graceMs más a los demás y se sigue (antes, un relé abierto pero
  // muerto hacía esperar el tope entero, 10 s, a CADA tanda de trozos). only (3151): solo a esos relés (el propio)
  // graceX (3193, datos móviles: 2 copias): el margen para los demás es al menos lo que tardó el primero (× graceX); con la subida lenta
  // de los datos las dos copias tardan parecido y un margen fijo de 1,5 s daba por perdida la segunda y subía una tercera
  publishEach(ev, timeoutMs, opts) {
    var self = this, only = opts && opts.only, t0 = Date.now();
    return new Promise(function(resolve) {
      var open = [], now0 = Date.now();
      self.relays.forEach(function(r, u) { if (r.open && !r.gw && (!only || only.indexOf(u) >= 0) && !self.relayCooling(r, now0)) open.push({ r: r, u: u }); }); // 3348: no a los que están en pausa
      // Sin relés propios: un trozo del buzón de archivos sale por los puentes (parte 3; el puente lo acota por bytes). Lo demás
      // (borrados, el canal de diagnósticos…) no pasa por un puente. Se informa la URL del relé de verdad (va en el puntero).
      var viaGw = false;
      if (!open.length && ev && ev.kind === BLOB_KIND && !only) {
        viaGw = true;
        self.relays.forEach(function(r) { if (r.open && r.gw && r.realUrl && !open.some(function(o) { return o.u === r.realUrl; }) && (!self.gw || typeof self.gw.blobRelayOk !== 'function' || self.gw.blobRelayOk(r))) open.push({ r: r, u: r.realUrl }); });
      }
      if (!open.length) { resolve([]); return; }
      var oks = [], left = open.length, done = false, grace = null;
      var enough = opts && opts.enough ? Math.min(opts.enough, open.length) : open.length;
      if (viaGw && opts && opts.enough) enough = 1; // puente parte 4: un relé (por cualquier puente) ya lo tiene; los demás, con margen
      var finish = function() { if (done) return; done = true; clearTimeout(timer); clearTimeout(grace); open.forEach(function(o) { o.r.waits.delete(ev.id); }); resolve(oks); };
      var timer = setTimeout(finish, timeoutMs || 10000);
      open.forEach(function(o) {
        o.r.waits.set(ev.id, function(ok, msg) {
          if (ok && oks.indexOf(o.u) < 0) oks.push(o.u);
          if (--left === 0) { finish(); return; }
          if (oks.length >= enough && !grace) grace = setTimeout(finish, Math.max((opts && opts.graceMs) || 1500, opts && opts.graceX ? (Date.now() - t0) * opts.graceX : 0));
        });
        if (!self._send(o.r, ['EVENT', ev])) { o.r.waits.delete(ev.id); if (--left === 0) finish(); }
      });
    });
  },
  // Pide eventos por id a UN relé (REQ con filtro ids) y devuelve los que llegaron hasta el EOSE o el tope de tiempo
  fetchEvents(url, ids, timeoutMs) {
    var self = this, r = self._relayFor(url);
    if (!r || !r.open || !ids || !ids.length) return Promise.resolve([]);
    return new Promise(function(resolve) {
      var sub = 'bf' + bytesToHex(_rnd(6)), got = [], done = false;
      if (!r.fetches) r.fetches = new Map();
      var finish = function() { if (done) return; done = true; clearTimeout(timer); r.fetches.delete(sub); try { self._send(r, ['CLOSE', sub]); } catch (e) {} resolve(got); };
      var timer = setTimeout(finish, timeoutMs || 15000);
      // Por un puente (parte 4) el tope es SIN PROGRESO: por Bluetooth cada trozo tarda segundos en llegar y no hay que cortar
      // una bajada que avanza
      r.fetches.set(sub, { onEvent: function(ev) {
        if (ev && typeof ev.id === 'string' && ids.indexOf(ev.id) >= 0) { got.push(ev); if (got.length >= ids.length) { finish(); return; } }
        if (r.gw && !done) { clearTimeout(timer); timer = setTimeout(finish, timeoutMs || 15000); }
      }, done: finish });
      if (!self._send(r, ['REQ', sub, { ids: ids }])) finish();
    });
  },

  // only (3151): solo a esos relés (lo pesado al relé propio, net_own.js); sin only, a todos los abiertos como siempre
  // 3348: tras un límite, lo pesado espera su turno (lo pequeño sale ya)
  _publish(ev, only) {
    var self = this, wait = only ? 0 : self._bulkWait(ev); // al relé propio (only) no: no limita
    if (wait > 0) return new Promise(function(res) { setTimeout(res, wait); }).then(function() { return self._publishNow(ev, only); });
    return self._publishNow(ev, only);
  },
  _publishNow(ev, only) {
    var self = this;
    return new Promise(function(resolve, reject) {
      var open = [], cooling = [], now0 = Date.now();
      self.relays.forEach(function(r, u) { if (r.open && (!only || only.indexOf(u) >= 0)) { if (self.relayCooling(r, now0)) cooling.push(r); else open.push(r); } });
      // 3348: todos los abiertos en pausa → pendiente ya, sin mandarles nada (cada sobre más sería otra infracción)
      if (!open.length && cooling.length) { reject(self._allCoolingErr(cooling)); return; }
      if (!open.length) { reject(Object.assign(new Error('Sin relés'), { code: 'NET_DOWN' })); return; }
      var left = open.length, done = false, why = '';
      // L3 (auditoría 28-10): al cerrar la promesa (OK, rechazo o timeout) se quita ev.id de TODOS los relés abiertos;
      // antes solo lo borraba el que contestaba OK, y con un relé que acepta pero nunca manda OK, r.waits crecía toda la
      // conexión (fuga lenta).
      var cleanup = function() { open.forEach(function(r) { r.waits.delete(ev.id); }); };
      var tSent = Date.now(), early = null;
      // 3011: sin respuesta de NINGÚN relé → los que no dijeron nada desde el envío están muertos: se reconectan (el reintento va por una conexión nueva)
      var timer = setTimeout(function() { if (!done) { done = true; clearTimeout(early); cleanup(); self._dropSilent(tSent, 'sin respuesta a un envío', only); reject(Object.assign(new Error('Los relés no respondieron'), { code: 'NET_DOWN' })); } }, 12000);
      // 3174 (dueño 17-11, diagnóstico S24 19:49:38: datos móviles trabados, «Texto entregado en 14085 ms»): si en SEND_SILENT_MS no
      // dijo NADA ningún relé (ni su OK ni otra cosa) se les pregunta lo mínimo; si tampoco contestan, el problema es la conexión
      // del teléfono: se reconectan ya (≈5 s, antes 12) y el envío se reintenta por las conexiones nuevas. Con que uno conteste algo
      // (van lentos), se espera como siempre. No por un puente Bluetooth (sus tiempos son otros).
      if (!open.some(function(r) { return r.gw; })) early = setTimeout(function() {
        if (done || open.some(function(r) { return (r.rxAt || 0) >= tSent; })) return;
        self._sendProbe(open, tSent, function(alive) {
          if (done || alive) return;
          done = true; clearTimeout(timer); cleanup();
          self._dropSilent(tSent, 'sin respuesta a un envío ni a una comprobación en ' + Math.round((Date.now() - tSent) / 1000) + ' s', only);
          reject(Object.assign(new Error('Los relés no respondieron'), { code: 'NET_DOWN' }));
        });
      }, SEND_SILENT_MS);
      open.forEach(function(r) {
        r.waits.set(ev.id, function(ok, msg) {
          if (done) return;
          if (done) return;
          if (ok) { done = true; clearTimeout(timer); clearTimeout(early); cleanup(); resolve(true); return; }
          why = msg || why;
          if (--left === 0) { done = true; clearTimeout(timer); clearTimeout(early); cleanup(); reject(Object.assign(new Error('Rechazado por los relés: ' + why), { code: 'NET_REJECTED' })); }
        });
        if (!self._send(r, ['EVENT', ev])) { r.waits.delete(ev.id); if (--left === 0 && !done) { done = true; clearTimeout(timer); clearTimeout(early); cleanup(); reject(Object.assign(new Error('Sin relés'), { code: 'NET_DOWN' })); } }
      });
    });
  },
};
