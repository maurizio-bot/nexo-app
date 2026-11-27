import { schnorr } from '@noble/curves/secp256k1.js';
import { _event, BLOB_KIND, _relaySafe, _relayHost, _rnd, SEND_SILENT_MS, MAX_RELAY_FRAME } from './net_link_shared.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { tipoLimite, pausaMs, anotarLimite, juntarPausas, lecturasDe, destinos } from '../core/ruta/politica_reles.js';
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
// Fase 1 (28-11): las pausas y el tipo de «no» vienen de la política común app/nativo (src/core/ruta/politica_reles.js; mismos vectores
// que RelayPolicy.kt). Los valores no cambian: 20 s→10 min por límite, 10 min→2 h por castigo, 6 h por política, se olvida a los 30 min.
var LIMIT_CALM_MS = 300000, BULK_EV_CHARS = 4000, BULK_GAP_MS = 1200; // tras un límite, 5 min con un respiro de 1,2 s entre eventos pesados
// 3357 (dueño 27-11, docs/ENRUTADO_27-11.md §4: «cupo por relé: contar sobres/min y no acercarse al límite; lo pesado repartido»): diag. S24
// 21:53 y 23:33, Fénix y archivos subían decenas de sobres de golpe y los relés limitaban/castigaban. Se cuentan los sobres que salen
// (cada uno va a todos los relés abiertos: es la cuenta de cada relé); con QUOTA_PER_MIN en el último minuto, lo PESADO espera su turno
// repartido (uno cada 60/cupo s). Los textos y señales nunca esperan (cuentan, pero salen ya). Tras un límite (5 min) el cupo baja a
// QUOTA_CALM_PER_MIN; sin límites, QUOTA_PER_MIN (≈ el ritmo que ya tenía un archivo grande: no se frena lo normal).
// CI 3164: con 90/min un archivo de 12 MB por internet (~300 trozos) tardaba minutos y se iba por Bluetooth: sin límites recientes el cupo
// solo frena una ráfaga desbocada (600/min = 10 por segundo); tras un límite, 30/min (lo que de verdad cuida a los relés).
var QUOTA_PER_MIN = 600, QUOTA_CALM_PER_MIN = 30, QUOTA_WIN_MS = 60000;
export { tipoLimite as relayLimitKind, pausaMs as relayCoolMs };
export const netPublish = {
  // 3350: ¿algún relé limitó o castigó hace poco? (lo de fondo, como Fénix, cede internet mientras tanto)
  relayLimitedRecently(ms) { return !!this._limitAt && Date.now() - this._limitAt < (ms || LIMIT_CALM_MS); },
  // ---------- Fase 1 (28-11, contrato B.5): «dónde leo» ----------
  // Los relés donde escucho de verdad (la app y, desde la fase 1, también la parte nativa: la misma lista). Va en mi saludo cifrado.
  myReads() {
    var self = this, out = [];
    this.relays.forEach(function(r, u) { if (!r.gw && !r.fetchOnly && (typeof self._subWanted !== 'function' || self._subWanted(r))) out.push(u); });
    return out.slice(0, 12);
  },
  // Los relés que conozco (los de siempre, los de reserva y el propio): solo de esos se acepta un anuncio (politica_reles.lecturasDe)
  _relayPool() {
    var out = [];
    [this._pubRelayUrls(), this._ownList(), this._sparePool(), this.relayUrls()].forEach(function(l) { (l || []).forEach(function(u) { if (out.indexOf(u) < 0) out.push(u); }); });
    return out;
  },
  // Dónde lee este contacto (su último anuncio, si sigue vigente y cruza con lo mío) o null (= no lo sé: a todos los míos, como hasta la 3167)
  peerReads(nx) {
    var a = this.state && this.state.peerLee && this.state.peerLee[nx];
    return a ? lecturasDe(a, this._relayPool(), Date.now()) : null;
  },
  // Llegó su anuncio (saludo de su app o de su parte nativa): se guarda (sobrevive al reinicio; caduca a las 24 h)
  _notePeerReads(nx, lee, t) {
    if (!Array.isArray(lee) || !(t > 0)) return;
    var list = lee.filter(function(u) { return typeof u === 'string' && u.length < 200; }).slice(0, 12);
    if (!this.state.peerLee) this.state.peerLee = {};
    var prev = this.state.peerLee[nx];
    if (prev && prev.at >= t) return;
    var same = prev && prev.lee.join() === list.join();
    this.state.peerLee[nx] = { lee: list, at: t };
    if (!same) {
      var mine = lecturasDe({ lee: list, at: t }, this._relayPool(), Date.now());
      console.log('[RUTA] ' + nx + ' lee en ' + list.length + ' relé(s)' + (mine ? ' (' + mine.map(_relayHost).join(', ') + '): le publico solo ahí' : ' que no son de los míos: le publico en los míos')); // i18n-ok: registro
      this._saveState();
    }
  },
  // Una línea [RUTA] (con freno: una por contacto y motivo cada 60 s) cuando no se publica por no tener libre ninguno de sus relés
  _routeNote(nx, motivo, lee) {
    var k = nx + '|' + motivo, now = Date.now(), m = this._routeSaid || (this._routeSaid = new Map());
    if (now - (m.get(k) || 0) < 60000) return;
    m.set(k, now);
    console.log('[RUTA] ' + nx + ': ' + (motivo === 'en_pausa' ? 'sus relés (' + lee.map(_relayHost).join(', ') + ') están en pausa' : 'ninguno de sus relés (' + lee.map(_relayHost).join(', ') + ') está abierto') + ': queda pendiente sin mandar (sin ✓ en uno que no lee)'); // i18n-ok: registro
  },
  // Pausas compartidas con la parte nativa: las mías ({url: {kind,n,at,hasta}}) y juntar las que trae el nativo al volver la app
  relayPauses() {
    var out = {}, now = Date.now();
    this.relays.forEach(function(r, u) { if (!r.gw && r.limitKind && r.coolUntil) out[u] = { kind: r.limitKind, n: r.limitN || 1, at: r.limitAt || 0, hasta: r.coolUntil }; });
    return juntarPausas(out, {}, now);
  },
  mergeRelayPauses(theirs) {
    var self = this, now = Date.now(), j = juntarPausas(this.relayPauses(), theirs || {}, now), n = 0;
    Object.keys(j).forEach(function(u) {
      var r = self.relays.get(u), x = j[u]; if (!r || r.gw) return;
      if ((r.coolUntil || 0) < x.hasta) { r.coolUntil = x.hasta; r.limitKind = x.kind; r.limitN = x.n; r.limitAt = x.at; if (x.hasta > now) n++; }
    });
    if (n) { this._limitAt = Math.max(this._limitAt || 0, now); console.log('[NET] La parte nativa dejó ' + n + ' relé(s) en pausa para publicar: los respeto'); } // i18n-ok: registro
    return n;
  },
  // 3348: ¿este relé está en pausa para publicar?
  relayCooling(r, now) { return !!(r && !r.gw && r.coolUntil && r.coolUntil > (now || Date.now())); },
  // 3348: un relé dijo que no: si es por límite o castigo, en pausa (y quizá entra uno de reserva)
  _relayLimitNote(url, r, msg) {
    if (!r || r.gw) return;
    var now = Date.now(), st = anotarLimite(r.limitKind ? { kind: r.limitKind, n: r.limitN, at: r.limitAt, hasta: r.coolUntil } : null, msg, now);
    if (!st) return;
    r.limitN = st.n; r.limitKind = st.kind; r.limitAt = st.at; this._limitAt = now;
    var ms = st.hasta - now;
    r.coolUntil = st.hasta;
    console.log('[NET] Relé ' + _relayHost(url) + ' limita («' + String(msg || '').substring(0, 90) + '»): en pausa ' + Math.round(ms / 1000) + ' s para publicar (' + r.limitN + '.ª vez); lo de ahora va a los demás'); // i18n-ok: registro
    try { if (typeof this._spareCheck === 'function') this._spareCheck(); } catch (e) {}
  },
  // 3348: tras un límite, cuánto debe esperar este evento PESADO (0: sale ya). Reserva su turno.
  _isBulkEv(ev) { return !!ev && (ev.kind === BLOB_KIND || (typeof ev.content === 'string' && ev.content.length >= BULK_EV_CHARS)); },
  // Diag. S24 3165 05:07 (audio de 69 KB al S23 tardó 94 s: «45 sobres en el último minuto»): se contaban TODOS los sobres (saludos a 27
  // contactos al volver a la app, acuses, textos) y lo pesado esperaba casi un minuto. Solo cuenta lo PESADO: el cupo es para no tirar
  // ráfagas de trozos, no para frenar el audio del usuario detrás de los saludos.
  _quotaNote(ev) {
    if (ev && !this._isBulkEv(ev)) return;
    var now = Date.now(), t = this._pubTimes || (this._pubTimes = []);
    t.push(now);
    while (t.length && now - t[0] > QUOTA_WIN_MS) t.shift();
  },
  // 3357: cuánto debe esperar un sobre PESADO para no pasar de QUOTA_PER_MIN por minuto (0 = sale ya)
  _quotaWait(ev) {
    if (!this._isBulkEv(ev)) return 0;
    var now = Date.now(), t = this._pubTimes || [];
    while (t.length && now - t[0] > QUOTA_WIN_MS) t.shift();
    var cap = this.relayLimitedRecently() ? QUOTA_CALM_PER_MIN : QUOTA_PER_MIN, gap = QUOTA_WIN_MS / cap;
    if (t.length < cap && now >= (this._quotaNextAt || 0)) return 0;
    var at = Math.max(now, this._quotaNextAt || 0, t.length >= cap ? t[t.length - cap] + QUOTA_WIN_MS : 0);
    this._quotaNextAt = at + gap;
    if (!this._quotaSaid || now - this._quotaSaid > 30000) { this._quotaSaid = now; console.log('[NET] Cupo de los relés: ' + t.length + ' sobres en el último minuto; lo pesado sale repartido (uno cada ' + Math.round(gap / 100) / 10 + ' s)'); } // i18n-ok: registro
    return at - now;
  },
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
    var self = this, qw = (opts && opts.only && self._ownList && self._ownList().length && opts.only.every(function(u) { return self._isOwn && self._isOwn(u); })) ? 0 : self._quotaWait(ev); // 3357: al relé propio no
    if (qw > 0) return new Promise(function(res) { setTimeout(res, qw); }).then(function() { return self._publishEachNow(ev, timeoutMs, opts); });
    return self._publishEachNow(ev, timeoutMs, opts);
  },
  _publishEachNow(ev, timeoutMs, opts) {
    var self = this, only = opts && opts.only, t0 = Date.now();
    return new Promise(function(resolve) {
      var open = [], now0 = Date.now();
      self.relays.forEach(function(r, u) { if (r.open && !r.gw && !r.lo && (!only || only.indexOf(u) >= 0) && !self.relayCooling(r, now0)) open.push({ r: r, u: u }); }); // 3348: no a los que están en pausa; 3355: ni a los de solo escucha
      // Sin relés propios: un trozo del buzón de archivos sale por los puentes (parte 3; el puente lo acota por bytes). Lo demás
      // (borrados, el canal de diagnósticos…) no pasa por un puente. Se informa la URL del relé de verdad (va en el puntero).
      var viaGw = false;
      if (!open.length && ev && ev.kind === BLOB_KIND && !only) {
        viaGw = true;
        self.relays.forEach(function(r) { if (r.open && r.gw && r.realUrl && !open.some(function(o) { return o.u === r.realUrl; }) && (!self.gw || typeof self.gw.blobRelayOk !== 'function' || self.gw.blobRelayOk(r))) open.push({ r: r, u: r.realUrl }); });
      }
      if (!open.length) { resolve([]); return; }
      self._quotaNote(ev);
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
  // nx (fase 1, 28-11): el sobre es para ese contacto: va solo a los relés que él lee (si los anunció; política común destinos())
  _publish(ev, only, nx) {
    var self = this, wait = only ? 0 : Math.max(self._bulkWait(ev), self._quotaWait(ev)); // al relé propio (only) no: no limita; 3357: cupo
    if (wait > 0) return new Promise(function(res) { setTimeout(res, wait); }).then(function() { return self._publishNow(ev, only, nx); });
    return self._publishNow(ev, only, nx);
  },
  _publishNow(ev, only, nx) {
    var self = this;
    return new Promise(function(resolve, reject) {
      var open = [], cooling = [], now0 = Date.now();
      var lee = (nx && !only && !self.gwOnly()) ? self.peerReads(nx) : null;
      if (lee) {
        // Fase 1 (contrato B.5.2, caso S24→S23 27-11 21:53): con su anuncio de «dónde leo», solo a los suyos que tengo abiertos (también una
        // reserva que yo solo escucho) y el ✓ sale solo de ellos. Ninguno suyo libre: pendiente sin mandar (un ✓ en otro relé mentiría).
        var vista = [];
        self.relays.forEach(function(r, u) { if (!r.fetchOnly) vista.push({ url: u, abierto: !!(r.open && r.ws), hasta: r.coolUntil || 0, soloLeer: !!r.lo, puente: !!r.gw }); });
        var d = destinos(vista, lee, now0);
        d.publicar.forEach(function(u) { open.push(self.relays.get(u)); });
        if (!open.length) {
          self._routeNote(nx, d.motivo, lee);
          if (d.motivo === 'en_pausa') { reject(self._allCoolingErr(d.pausados.map(function(u) { return self.relays.get(u); }))); return; }
          reject(Object.assign(new Error('Rechazado por los relés: en espera (ninguno de los relés que lee ' + nx + ' está abierto ahora)'), { code: 'NET_REJECTED' })); // i18n-ok: error interno
          return;
        }
      } else self.relays.forEach(function(r, u) { if (r.open && !r.lo && (!only || only.indexOf(u) >= 0)) { if (self.relayCooling(r, now0)) cooling.push(r); else open.push(r); } }); // 3355: los de solo escucha no publican
      // 3348: todos los abiertos en pausa → pendiente ya, sin mandarles nada (cada sobre más sería otra infracción)
      if (!open.length && cooling.length) { reject(self._allCoolingErr(cooling)); return; }
      if (!open.length) { reject(Object.assign(new Error('Sin relés'), { code: 'NET_DOWN' })); return; }
      self._quotaNote(ev);
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
