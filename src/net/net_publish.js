import { schnorr } from '@noble/curves/secp256k1.js';
import { _event, BLOB_KIND, _relaySafe, _relayHost, _rnd } from './net_link_shared.js';
import { bytesToHex } from '@noble/hashes/utils.js';
// Métodos de NetLink: PUBLICAR y BAJAR: eventos en los relés, buzón de archivos, publicar en varios y bajar por id.
// Reestructuración 15-11: movidos TAL CUAL desde net_link.js, que los une a la clase (como métodos normales).
export const netPublish = {

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
    return g || r || null;
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
  publishEach(ev, timeoutMs, opts) {
    var self = this, only = opts && opts.only;
    return new Promise(function(resolve) {
      var open = [];
      self.relays.forEach(function(r, u) { if (r.open && !r.gw && (!only || only.indexOf(u) >= 0)) open.push({ r: r, u: u }); });
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
        o.r.waits.set(ev.id, function(ok) {
          if (ok && oks.indexOf(o.u) < 0) oks.push(o.u);
          if (--left === 0) { finish(); return; }
          if (oks.length >= enough && !grace) grace = setTimeout(finish, (opts && opts.graceMs) || 1500);
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
  _publish(ev, only) {
    var self = this;
    return new Promise(function(resolve, reject) {
      var open = [];
      self.relays.forEach(function(r, u) { if (r.open && (!only || only.indexOf(u) >= 0)) open.push(r); });
      if (!open.length) { reject(Object.assign(new Error('Sin relés'), { code: 'NET_DOWN' })); return; }
      var left = open.length, done = false, why = '';
      // L3 (auditoría 28-10): al cerrar la promesa (OK, rechazo o timeout) se quita ev.id de TODOS los relés abiertos;
      // antes solo lo borraba el que contestaba OK, y con un relé que acepta pero nunca manda OK, r.waits crecía toda la
      // conexión (fuga lenta).
      var cleanup = function() { open.forEach(function(r) { r.waits.delete(ev.id); }); };
      var tSent = Date.now();
      // 3011: sin respuesta de NINGÚN relé → los que no dijeron nada desde el envío están muertos: se reconectan (el reintento va por una conexión nueva)
      var timer = setTimeout(function() { if (!done) { done = true; cleanup(); self._dropSilent(tSent, 'sin respuesta a un envío', only); reject(Object.assign(new Error('Los relés no respondieron'), { code: 'NET_DOWN' })); } }, 12000);
      open.forEach(function(r) {
        r.waits.set(ev.id, function(ok, msg) {
          if (done) return;
          if (ok) { done = true; clearTimeout(timer); cleanup(); resolve(true); return; }
          why = msg || why;
          if (--left === 0) { done = true; clearTimeout(timer); cleanup(); reject(Object.assign(new Error('Rechazado por los relés: ' + why), { code: 'NET_REJECTED' })); }
        });
        if (!self._send(r, ['EVENT', ev])) { r.waits.delete(ev.id); if (--left === 0 && !done) { done = true; clearTimeout(timer); cleanup(); reject(Object.assign(new Error('Sin relés'), { code: 'NET_DOWN' })); } }
      });
    });
  },
};
