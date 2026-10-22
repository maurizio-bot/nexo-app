/**
 * fenix.js v1.0 — Protocolo Fénix, fase 1: la cuenta (diseño y decisiones del dueño en docs/FENIX.md).
 *
 * Dueño: al tener CFG.min contactos con Fénix (kx con fx:1 y protocolo 2), crea la clave maestra K, cifra la
 * cuenta (NEXO ID, claves y contactos) con AES-256-GCM y parte K con Shamir (CFG.t de CFG.n). Cada contacto
 * recibe su trozo de K + la copia cifrada (archivo meta.type 'fenix', fx 'put', cifrado de extremo a extremo).
 * Con CFG.mirror contactos, cada trozo en 2 contactos. Pingeo diario ('fp' → 'fo': prueba de que lo sigue
 * teniendo); sin prueba en CFG.lostMs se da por perdido y su trozo pasa a otro contacto ('fd': bórralo).
 * Nodo: guarda lo recibido (no puede leerlo: le falta K) y responde al pingeo.
 * Recuperación: un teléfono nuevo pide ('fq'); cada contacto confirma en pantalla quién es y le envía su trozo
 * cifrado para ese teléfono (fx 'rec'). Con CFG.t trozos se recompone K, se descifra la cuenta, se escriben
 * NEXO ID, identidad, claves y contactos y la app se reinicia como el usuario de siempre.
 */
import { ShardCrypto } from './shard_crypto.js';
import { e2eEncryptB64, e2eMyPublicKey } from '../vault/e2e_crypto.js';

var STATE_FILE = 'nexo_fenix.json';        // dueño: K, trozos, copia y nodos
var STORE_FILE = 'nexo_fenix_store.json';  // nodo: lo que guarda de otros
var IDENTITY_FILE = 'nexo_e2e_identity.json';
var RATCHET_FILE = 'nexo_ratchet.json';
var NEXO_ID_FILE = 'nexo_advertising_id.json';
var DAY = 86400000;
var CFG = { n: 10, t: 6, min: 10, mirror: 20, pingMs: DAY, lostMs: 7 * DAY, tickMs: 60000, rebuildMs: 600000,
  maxOwners: 50, maxBlob: 400000, resetMs: 7 * DAY };

function _plugin() { return (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.NexoBLE) || null; }
function _nid(id) { return (id || '').toString().toLowerCase().trim(); }
function _isNx(nx) { return /^nx[0-9a-z]{8}$/.test(nx || ''); }
function _subtle() { return window.crypto && window.crypto.subtle; }
function _rand(n) { return window.crypto.getRandomValues(new Uint8Array(n)); }
function _hex(b) { return Array.prototype.map.call(b, function(x) { return ('0' + x.toString(16)).slice(-2); }).join(''); }
function _unhex(h) { var o = new Uint8Array(h.length / 2); for (var i = 0; i < o.length; i++) o[i] = parseInt(h.substr(i * 2, 2), 16); return o; }
function _b64(bytes) { var s = ''; for (var i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(s); }
function _unb64(b) { var s = atob(b), o = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) o[i] = s.charCodeAt(i); return o; }
function _utf8(s) { return new TextEncoder().encode(s); }
function _jsonB64(o) { return _b64(_utf8(JSON.stringify(o))); }
function _b64Json(b) { return JSON.parse(new TextDecoder().decode(_unb64(b))); }
function _sha(str) { return _subtle().digest('SHA-256', _utf8(str)).then(function(h) { return _hex(new Uint8Array(h)); }); }
function _aad(owner, ep) { return _utf8('NEXO-FENIX|v1|' + _nid(owner) + '|' + ep); }
function _load(name) {
  var pl = _plugin();
  if (!pl || typeof pl.loadFromFile !== 'function') return Promise.resolve(null);
  return pl.loadFromFile({ filename: name }).then(function(r) { return (r && r.exists && r.content) ? r.content : null; }).catch(function() { return null; });
}
function _save(name, content) {
  var pl = _plugin();
  if (!pl || typeof pl.saveToFile !== 'function') return Promise.resolve();
  return pl.saveToFile({ filename: name, content: content }).catch(function() {});
}

export class Fenix {
  constructor(ble) {
    this.ble = ble;
    this.cfg = Object.assign({}, CFG, (typeof window !== 'undefined' && window.NEXO_FENIX_TEST) || {});
    this.state = null;             // dueño
    this.store = { owners: {} };   // nodo
    this.peers = new Set();        // nexoIds que anunciaron fx:1 (en esta sesión)
    this.pings = new Map();        // nonce → { nx, idx, at }
    this.inflight = new Set();     // nexoIds con una entrega en curso
    this.requests = new Map();     // rid → petición de recuperación recibida (nodo)
    this.recovery = null;          // recuperación en curso (teléfono nuevo)
    this._busy = false;
    this._timer = null;
    this.ready = null;
  }

  init() {
    var self = this;
    if (self.ready) return self.ready;
    self.ready = Promise.all([_load(STATE_FILE), _load(STORE_FILE)]).then(function(r) {
      try { if (r[0]) self.state = JSON.parse(r[0]); } catch (e) {}
      try { if (r[1]) self.store = JSON.parse(r[1]) || { owners: {} }; } catch (e) {}
      if (!self.store.owners) self.store.owners = {};
      if (self.state) console.log('[FENIX] Activo: copia v' + self.state.ep + ', ' + Object.keys(self.state.nodes || {}).length + ' nodos');
      var n = Object.keys(self.store.owners).length;
      if (n) console.log('[FENIX] Guardo fragmentos de ' + n + ' contacto(s)');
      if (!self._timer) self._timer = setInterval(function() { self.tick(); }, self.cfg.tickMs);
      setTimeout(function() { self.tick(); }, 5000);
    });
    return self.ready;
  }

  me() { return _nid(this.ble && this.ble.localNexoId); }
  _contacts() { return (this.ble && typeof this.ble.getBLEContacts === 'function') ? this.ble.getBLEContacts() : []; }
  _readyDevice(nx) {
    var ble = this.ble;
    if (!ble || typeof ble._resolveDeviceIdForNexoId !== 'function') return null;
    var dev = ble._resolveDeviceIdForNexoId(nx);
    var st = dev && ble._getDeviceState(dev);
    return (st && (st.state === 'ready_to_chat' || st.state === 'notifications_ready')) ? dev : null;
  }
  _ctl(dev, obj) {
    obj.v = 1;
    obj.from = this.me();
    return this.ble._sendMessageNative(dev, JSON.stringify(obj), null).catch(function() {});
  }
  _saveState() { return _save(STATE_FILE, JSON.stringify(this.state)); }
  _saveStore() { return _save(STORE_FILE, JSON.stringify(this.store)); }

  // Para el kx: 'rs' durante unos días tras recuperar (los contactos empiezan sesiones nuevas del protocolo 2)
  resetMark() { var s = this.state; return (s && s.restoredAt && Date.now() - s.restoredAt < this.cfg.resetMs) ? s.restoredAt : 0; }

  // kx con fx:1 de un teléfono conectado
  markPeer(nexoId, deviceId) {
    var self = this, nx = _nid(nexoId);
    if (!_isNx(nx)) return;
    self.peers.add(nx);
    if (self.recovery) self._askForRecovery(nx, deviceId);
    setTimeout(function() { self.tick(); }, 1500);
  }

  // ---------- dueño ----------
  _eligible() {
    return this._contacts().filter(function(c) {
      return c && c.publicKey && !c.pendingKey && c.proto === 2 && c.fx && _isNx(_nid(c.nexoId || c.deviceUUID));
    }).sort(function(a, b) { return (b.lastMessageAt || 0) - (a.lastMessageAt || 0); });
  }

  status() {
    var s = this.state, el = this._eligible().length;
    if (!s) return { active: false, eligible: el, min: this.cfg.min };
    var nodes = Object.keys(s.nodes || {}).map(function(k) { return s.nodes[k]; });
    return { active: true, eligible: el, ep: s.ep, n: s.n, t: s.t,
      copies: el >= this.cfg.mirror ? 2 : 1,
      delivered: nodes.filter(function(x) { return !x.lost && x.ep === s.ep; }).length,
      lost: nodes.filter(function(x) { return x.lost; }).length, guarding: Object.keys(this.store.owners).length };
  }

  tick() {
    var self = this;
    if (self._busy || !self.me()) return Promise.resolve();
    self._busy = true;
    return self.init().then(function() { return self._ownerTick(); })
      .catch(function(e) { console.warn('[FENIX] ' + (e && e.message)); })
      .then(function() { self._busy = false; });
  }

  async _ownerTick() {
    var el = this._eligible();
    if (!this.state) {
      if (el.length < this.cfg.min) return;
      await this._start();
    }
    var s = this.state, now = Date.now(), changed = false;
    if (await this._maybeBackup()) changed = true;
    var elSet = {};
    el.forEach(function(c) { elSet[_nid(c.nexoId || c.deviceUUID)] = true; });
    // Perdidos: sin prueba en lostMs, o ya no son contactos válidos
    var self = this;
    Object.keys(s.nodes).forEach(function(nx) {
      var n = s.nodes[nx];
      if (n.lost) return;
      var last = Math.max(n.lastProof || 0, n.assignedAt || 0);
      if (!elSet[nx] || now - last > self.cfg.lostMs) {
        n.lost = true; n.lostAt = now; changed = true;
        console.warn('[FENIX] Nodo ' + nx + ' perdido (' + (!elSet[nx] ? 'ya no es contacto válido' : 'sin pingeo') + '): su fragmento ' + n.idx + ' pasa a otro contacto');
      }
    });
    if (this._assign(el)) changed = true;
    if (changed) await this._saveState();
    // Entregas, pingeos y aviso a los perdidos que vuelven
    var list = Object.keys(s.nodes);
    for (var i = 0; i < list.length; i++) {
      var nx = list[i], node = s.nodes[nx], dev = this._readyDevice(nx);
      if (!dev || !this.peers.has(nx)) continue;
      if (node.lost) {
        this._ctl(dev, { type: 'fd', o: this.me() });
        delete s.nodes[nx];
        console.log('[FENIX] ' + nx + ' volvió tras darse por perdido: le pido que borre su fragmento');
        await this._saveState();
      } else if (node.ep !== s.ep) {
        await this._put(nx, dev, node);
      } else if (now - (node.lastPing || 0) > this.cfg.pingMs) {
        this._ping(nx, dev, node);
      }
    }
  }

  async _start() {
    var sc = new ShardCrypto();
    sc.n = this.cfg.n; sc.k = this.cfg.t;
    var K = _rand(32);
    var shares = sc.splitSecret(K).map(function(x) { return String(x.value).toLowerCase(); }); // ya en hexadecimal
    this.state = { v: 1, k: _hex(K), n: this.cfg.n, t: this.cfg.t, shares: shares, ep: 0, nodes: {}, startedAt: Date.now() };
    console.log('[FENIX] Activado: clave maestra creada y partida en ' + this.cfg.n + ' fragmentos (' + this.cfg.t + ' para recuperar)');
    await this._saveState();
  }

  // Elige contactos para cada fragmento: 1 copia; con cfg.mirror contactos, 2 (gemelos en contactos distintos)
  _assign(el) {
    var s = this.state, copies = el.length >= this.cfg.mirror ? 2 : 1, changed = false, now = Date.now();
    var used = {};
    Object.keys(s.nodes).forEach(function(nx) { used[nx] = true; });
    var free = el.map(function(c) { return _nid(c.nexoId || c.deviceUUID); }).filter(function(nx) { return !used[nx]; });
    for (var idx = 1; idx <= s.n; idx++) {
      var holders = Object.keys(s.nodes).filter(function(nx) { return s.nodes[nx].idx === idx && !s.nodes[nx].lost; }).length;
      while (holders < copies && free.length) {
        var nx = free.shift();
        s.nodes[nx] = { idx: idx, assignedAt: now, ep: -1, lastPing: 0, lastProof: 0 };
        holders++; changed = true;
        console.log('[FENIX] Fragmento ' + idx + ' → ' + nx + (copies > 1 ? ' (copia ' + holders + ')' : ''));
      }
    }
    return changed;
  }

  async _account() {
    var ble = this.ble;
    var id = await _load(IDENTITY_FILE), rat = null;
    try { var r = JSON.parse(await _load(RATCHET_FILE) || 'null'); if (r) rat = { ik: r.ik, sign: r.sign, spks: r.spks }; } catch (e) {}
    var contacts = this._contacts().filter(function(c) { return c && (c.nexoId || c.deviceUUID); }).map(function(c) {
      return { nexoId: _nid(c.nexoId || c.deviceUUID), name: c.name || '', publicKey: c.publicKey || '', proto: c.proto || 0,
        proto2At: c.proto2At || 0, fx: c.fx || 0, verified: c.verified || null, addedAt: c.addedAt || 0 };
    }).sort(function(a, b) { return a.nexoId < b.nexoId ? -1 : 1; });
    return { v: 1, nexoId: String(ble.localNexoId || ''), name: ble.localDeviceName || '', identity: id, ratchet: rat, contacts: contacts };
  }

  // Rehace la copia si la cuenta cambió (contactos, claves). true si hay versión nueva
  async _maybeBackup() {
    var s = this.state, now = Date.now();
    if (s.blob && now - (s.backupAt || 0) < this.cfg.rebuildMs) return false;
    var acc = await this._account();
    if (!acc.identity) return false;
    var h = await _sha(JSON.stringify(acc));
    if (h === s.accHash && s.blob) return false;
    var nodes = {};
    Object.keys(s.nodes).forEach(function(nx) { if (!s.nodes[nx].lost) nodes[nx] = s.nodes[nx].idx; });
    acc.nodes = nodes; acc.n = s.n; acc.t = s.t; acc.ts = now;
    var ep = (s.ep || 0) + 1;
    var key = await _subtle().importKey('raw', _unhex(s.k), 'AES-GCM', false, ['encrypt']);
    var iv = _rand(12);
    var ct = new Uint8Array(await _subtle().encrypt({ name: 'AES-GCM', iv: iv, additionalData: _aad(this.me(), ep) }, key, _utf8(JSON.stringify(acc))));
    var blob = new Uint8Array(12 + ct.length); blob.set(iv); blob.set(ct, 12);
    s.blob = _b64(blob); s.bh = await _sha(s.blob); s.ep = ep; s.accHash = h; s.backupAt = now;
    console.log('[FENIX] Copia de la cuenta v' + ep + ' (' + Math.round(blob.length / 1024) + ' KB, ' + acc.contacts.length + ' contactos)');
    await this._saveState();
    return true;
  }

  async _put(nx, dev, node) {
    var self = this, s = self.state;
    if (self.inflight.has(nx) || !self.ble.ackSystem) return;
    self.inflight.add(nx);
    var ep = s.ep;
    var payload = { v: 1, k: 'put', o: self.me(), name: self.ble.localDeviceName || '', ep: ep, n: s.n, t: s.t, idx: node.idx,
      share: s.shares[node.idx - 1], blob: s.blob, bh: s.bh };
    var id = 'fx_' + Date.now() + '_' + _hex(_rand(3));
    try {
      await self.ble.ackSystem.sendFile(dev, id, _jsonB64(payload), { type: 'fenix', fx: 'put' });
      if (s.nodes[nx] === node) { node.ep = ep; node.lastProof = Date.now(); node.lastPing = Date.now(); }
      console.log('[FENIX] Fragmento ' + node.idx + ' (copia v' + ep + ') entregado a ' + nx);
      await self._saveState();
    } catch (e) {
      console.warn('[FENIX] Entrega a ' + nx + ' fallida: ' + (e && e.message));
    } finally { self.inflight.delete(nx); }
  }

  _ping(nx, dev, node) {
    var nonce = _hex(_rand(12));
    this.pings.set(nonce, { nx: nx, idx: node.idx, at: Date.now() });
    node.lastPing = Date.now();
    this._ctl(dev, { type: 'fp', n: nonce });
  }

  // ---------- paquetes de control ('fp', 'fo', 'fq', 'fd'). true si era de Fénix ----------
  handle(p, deviceId) {
    var self = this;
    if (!p || !/^f[poqd]$/.test(p.type || '')) return false;
    var from = _nid(p.from);
    if (!_isNx(from)) return true;
    self.init().then(function() {
      if (p.type === 'fp') return self._onPing(p, from, deviceId);
      if (p.type === 'fo') return self._onPong(p, from);
      if (p.type === 'fd') return self._onDelete(from);
      if (p.type === 'fq') return self._onRecoveryRequest(p, from, deviceId);
    }).catch(function(e) { console.warn('[FENIX] ' + (e && e.message)); });
    return true;
  }

  async _onPing(p, from, deviceId) {
    var rec = this.store.owners[from];
    if (!rec) { this._ctl(deviceId, { type: 'fo', n: String(p.n || ''), miss: 1 }); return; }
    rec.lastPing = Date.now();
    var proof = await _sha(String(p.n || '') + '|' + rec.share + '|' + rec.bh);
    this._ctl(deviceId, { type: 'fo', n: String(p.n || ''), pr: proof, ep: rec.ep });
    this._saveStore();
  }

  async _onPong(p, from) {
    var s = this.state, ping = this.pings.get(p.n);
    if (!s || !ping || ping.nx !== from) return;
    this.pings.delete(p.n);
    var node = s.nodes[from];
    if (!node) return;
    var expect = await _sha(p.n + '|' + s.shares[node.idx - 1] + '|' + s.bh);
    if (!p.miss && p.pr === expect) {
      node.lastProof = Date.now();
      console.log('[FENIX] Pingeo: ' + from + ' conserva el fragmento ' + node.idx);
    } else {
      node.ep = -1; // no lo tiene (o es de otra versión): se le vuelve a entregar
      console.warn('[FENIX] Pingeo: ' + from + ' no tiene el fragmento ' + node.idx + ': se reenvía');
    }
    await this._saveState();
  }

  async _onDelete(from) {
    if (!this.store.owners[from]) return;
    delete this.store.owners[from];
    console.log('[FENIX] ' + from + ' me pidió borrar su fragmento');
    await this._saveStore();
  }

  // ---------- archivos de Fénix (ya descifrados por ble_ack) ----------
  onFile(fileId, b64, meta, fromId) {
    var self = this;
    var from = _nid(fromId);
    self.init().then(function() {
      var p = _b64Json(b64);
      // El tipo va dentro del contenido cifrado (la cabecera del flujo solo lleva campos conocidos)
      if (p && p.k === 'put') return self._onPut(p, from);
      if (p && p.k === 'rec') return self._onRecoveryPiece(p, from);
    }).catch(function(e) { console.warn('[FENIX] Archivo no válido: ' + (e && e.message)); });
  }

  async _onPut(p, from) {
    var cur = this.store.owners[from];
    // Solo el propio dueño entrega lo suyo; trozo de 32 bytes; copia de tamaño razonable
    if (!p || _nid(p.o) !== from || !/^[0-9a-f]{64}$/.test(p.share || '') || typeof p.blob !== 'string' || p.blob.length > this.cfg.maxBlob || !(p.ep > 0)) {
      console.warn('[FENIX] Fragmento de ' + from + ' rechazado (no válido)');
      return;
    }
    if (cur && cur.ep > p.ep) return;
    if (!cur && Object.keys(this.store.owners).length >= this.cfg.maxOwners) { console.warn('[FENIX] Límite de contactos guardados'); return; }
    this.store.owners[from] = { idx: p.idx, share: p.share, blob: p.blob, bh: p.bh, ep: p.ep, n: p.n, t: p.t,
      name: String(p.name || '').substring(0, 40), ts: Date.now(), lastPing: Date.now() };
    console.log('[FENIX] Guardo el fragmento ' + p.idx + ' de ' + from + ' (copia v' + p.ep + '; no puedo leerlo)');
    await this._saveStore();
  }

  // ---------- recuperación: lado del contacto ----------
  _onRecoveryRequest(p, from, deviceId) {
    var owners = this.store.owners, list = Object.keys(owners);
    var rid = String(p.rid || '');
    if (!list.length || !rid || this.requests.has(rid)) return;
    // Un aviso a la vez: otra petición mientras hay una sin contestar (de hace <20 s) se ignora
    var now = Date.now(), busy = false;
    this.requests.forEach(function(q) { if (!q.answered && now - q.ts < 20000) busy = true; });
    if (busy) return;
    if (typeof p.pk !== 'string' || !/^[A-Za-z0-9+/=]{80,100}$/.test(p.pk)) return;
    var contacts = this._contacts();
    var choices = list.map(function(nx) {
      var c = contacts.find(function(x) { return _nid(x.nexoId || x.deviceUUID) === nx; });
      return { nx: nx, name: (c && c.name) || owners[nx].name || nx.toUpperCase() };
    });
    this.requests.set(rid, { from: from, deviceId: deviceId, pk: p.pk, ts: Date.now(), answered: false });
    console.log('[FENIX] Un teléfono nuevo (' + from + ') pide recuperar una cuenta: pregunto al usuario');
    try { window.dispatchEvent(new CustomEvent('nexo:fenix:request', { detail: { rid: rid, from: from, name: String(p.nm || '').substring(0, 40), choices: choices } })); } catch (e) {}
  }

  // El usuario confirmó quién es (ownerNx) o lo rechazó (null)
  async answerRecovery(rid, ownerNx) {
    var req = this.requests.get(rid);
    if (!req || req.answered) return false;
    req.answered = true;
    var o = _nid(ownerNx), rec = o && this.store.owners[o];
    if (!rec) { console.log('[FENIX] Petición de recuperación rechazada por el usuario'); return false; }
    var payload = { v: 1, k: 'rec', o: o, ep: rec.ep, n: rec.n, t: rec.t, idx: rec.idx, share: rec.share, blob: rec.blob, bh: rec.bh, by: this.me() };
    var data = await e2eEncryptB64(req.pk, _jsonB64(payload)); // solo lo abre ese teléfono
    var dev = await this._ensureLink(req.from, req.deviceId);
    if (!dev) { console.warn('[FENIX] No llego al teléfono nuevo para enviarle el fragmento'); req.answered = false; return false; }
    try {
      await this.ble.ackSystem.sendFile(dev, 'fxr_' + rid + '_' + this.me(), data, { type: 'fenix', fx: 'rec' });
      console.log('[FENIX] Fragmento ' + rec.idx + ' de ' + o + ' enviado al teléfono nuevo');
      return true;
    } catch (e) { req.answered = false; console.warn('[FENIX] Envío al teléfono nuevo fallido: ' + (e && e.message)); return false; }
  }

  // Conexión directa (de paso si no es contacto), esperando hasta 20 s
  async _ensureLink(nx, deviceId) {
    var ble = this.ble, relay = ble.relay;
    var ready = function() { var st = deviceId && ble._getDeviceState(deviceId); return st && (st.state === 'ready_to_chat' || st.state === 'notifications_ready'); };
    if (ready()) return deviceId;
    if (relay && typeof relay._connect === 'function') relay._connect(nx, deviceId);
    for (var i = 0; i < 40; i++) {
      await new Promise(function(r) { setTimeout(r, 500); });
      if (ready()) return deviceId;
    }
    return null;
  }

  // ---------- recuperación: teléfono nuevo ----------
  startRecovery(name) {
    var self = this;
    if (self.recovery) return;
    self.recovery = { rid: _hex(_rand(8)), name: String(name || '').substring(0, 40), asked: {}, pieces: {}, startedAt: Date.now(), done: false };
    console.log('[FENIX] Recuperación iniciada: busco contactos cerca');
    self._recoveryEvent('searching');
    var relay = self.ble.relay;
    var loop = function() {
      if (!self.recovery || self.recovery.done) return;
      if (relay && typeof relay._scan === 'function') relay._scan();
      // Conectar de paso con los NEXO vistos (de 3 en 3; la relay cierra los que no se usan)
      if (relay && relay.nearby) relay.nearby.forEach(function(n, nx) {
        if (self.recovery.asked[nx] || Date.now() - n.ts > 120000) return;
        if (self._readyDevice(nx) || (relay._isReady && relay._isReady(n.deviceId))) {
          if (self.peers.has(nx)) self._askForRecovery(nx, n.deviceId);
        } else relay._connect(nx, n.deviceId);
      });
      // Mantener abiertas las conexiones con quien ya preguntamos (le toca confirmar a una persona)
      Object.keys(self.recovery.asked).forEach(function(nx) { var t = relay && relay.transient.get(nx); if (t) t.lastUse = Date.now(); });
      self.recovery.timer = setTimeout(loop, 4000);
    };
    loop();
  }

  cancelRecovery() {
    if (!this.recovery) return;
    clearTimeout(this.recovery.timer);
    this.recovery = null;
    this._recoveryEvent('cancelled');
  }

  _askForRecovery(nx, deviceId) {
    var r = this.recovery;
    if (!r || r.done || r.asked[nx] || !deviceId) return;
    var pk = e2eMyPublicKey();
    if (!pk) return;
    r.asked[nx] = Date.now();
    this._ctl(deviceId, { type: 'fq', rid: r.rid, pk: pk, nm: r.name });
    console.log('[FENIX] Pido ayuda para recuperar a ' + nx);
    this._recoveryEvent('asking');
  }

  _recoveryEvent(state, extra) {
    var r = this.recovery;
    var counts = {};
    if (r) Object.keys(r.pieces).forEach(function(o) { counts[o] = Object.keys(r.pieces[o]).length; });
    var best = Object.keys(counts).sort(function(a, b) { return counts[b] - counts[a]; })[0];
    try { window.dispatchEvent(new CustomEvent('nexo:fenix:recovery', { detail: Object.assign({ state: state, asked: r ? Object.keys(r.asked).length : 0,
      got: best ? counts[best] : 0, need: best && r.pieces[best] ? r.pieces[best][Object.keys(r.pieces[best])[0]].t : this.cfg.t }, extra || {}) })); } catch (e) {}
  }

  async _onRecoveryPiece(p, from) {
    var r = this.recovery;
    if (!r || r.done || !p || !_isNx(_nid(p.o)) || !/^[0-9a-f]{64}$/.test(p.share || '') || !(p.idx >= 1 && p.idx <= 255)) return;
    var o = _nid(p.o);
    r.pieces[o] = r.pieces[o] || {};
    r.pieces[o][p.idx] = { idx: p.idx, share: p.share, blob: p.blob, ep: p.ep, n: p.n, t: p.t, by: from };
    var got = Object.keys(r.pieces[o]).length;
    console.log('[FENIX] Recibido el fragmento ' + p.idx + ' de la cuenta ' + o + ' (' + got + ' de ' + p.t + ')');
    this._recoveryEvent('progress');
    if (got >= p.t) await this._tryRestore(o);
  }

  // GF(256): valor en x del polinomio que pasa por los puntos (Lagrange). x=0 → la clave
  _interp(sc, points, x) {
    var out = new Uint8Array(32);
    for (var b = 0; b < 32; b++) {
      var acc = 0;
      for (var i = 0; i < points.length; i++) {
        var num = 1, den = 1;
        for (var j = 0; j < points.length; j++) {
          if (i === j) continue;
          num = sc._gfMul(num, x ^ points[j].x);
          den = sc._gfMul(den, points[i].x ^ points[j].x);
        }
        acc ^= sc._gfMul(points[i].y[b], sc._gfMul(num, sc._gfInv(den)));
      }
      out[b] = acc;
    }
    return out;
  }

  async _tryRestore(o) {
    var r = this.recovery, pieces = r.pieces[o], list = Object.keys(pieces).map(function(k) { return pieces[k]; });
    var t = list[0].t, sc = new ShardCrypto();
    var pts = list.slice(0, t).map(function(x) { return { x: x.idx, y: _unhex(x.share) }; });
    var K = this._interp(sc, pts, 0);
    var key = await _subtle().importKey('raw', K, 'AES-GCM', false, ['decrypt']);
    // La copia más reciente que se descifre (AES-GCM comprueba que trozos y copia son buenos)
    var blobs = list.slice().sort(function(a, b) { return b.ep - a.ep; });
    var acc = null, ep = 0;
    for (var i = 0; i < blobs.length && !acc; i++) {
      try {
        var raw = _unb64(blobs[i].blob);
        var pt = await _subtle().decrypt({ name: 'AES-GCM', iv: raw.subarray(0, 12), additionalData: _aad(o, blobs[i].ep) }, key, raw.subarray(12));
        acc = JSON.parse(new TextDecoder().decode(new Uint8Array(pt))); ep = blobs[i].ep;
      } catch (e) {}
    }
    if (!acc || _nid(acc.nexoId) !== o) {
      console.warn('[FENIX] Con estos ' + list.length + ' fragmentos la cuenta no se descifra; espero más');
      return;
    }
    r.done = true;
    clearTimeout(r.timer);
    // Todos los trozos del mismo polinomio (para seguir cuidando la cuenta)
    var shares = [];
    for (var x = 1; x <= acc.n; x++) shares.push(_hex(this._interp(sc, pts, x)));
    await this._restore(acc, K, shares, ep, list);
  }

  async _restore(acc, K, shares, ep, pieces) {
    var now = Date.now();
    console.log('[FENIX] Cuenta ' + acc.nexoId + ' recuperada (' + acc.contacts.length + ' contactos): escribiendo y reiniciando');
    await _save(NEXO_ID_FILE, JSON.stringify({ nexoId: acc.nexoId, createdAt: now, restored: true }));
    await _save(IDENTITY_FILE, acc.identity);
    if (acc.ratchet && acc.ratchet.ik) await _save(RATCHET_FILE, JSON.stringify({ v: 1, ik: acc.ratchet.ik, sign: acc.ratchet.sign, spks: acc.ratchet.spks, peers: {}, sessions: {}, seenEk: {} }));
    var contacts = acc.contacts.map(function(c) {
      return { nexoId: c.nexoId, deviceUUID: c.nexoId, name: c.name, publicKey: c.publicKey, proto: c.proto || undefined, proto2At: c.proto2At || undefined,
        fx: c.fx || undefined, verified: c.verified || undefined, addedAt: c.addedAt || now, deviceId: null, lastSeen: 0, online: false, unreadCount: 0, lastMessage: '' };
    });
    if (typeof window.vaultSaveContacts === 'function') window.vaultSaveContacts(contacts);
    var nodes = {};
    Object.keys(acc.nodes || {}).forEach(function(nx) { nodes[nx] = { idx: acc.nodes[nx], assignedAt: now, ep: ep, lastPing: 0, lastProof: 0 }; });
    pieces.forEach(function(p) { if (nodes[p.by]) nodes[p.by].lastProof = now; });
    this.state = { v: 1, k: _hex(K), n: acc.n, t: acc.t, shares: shares, ep: ep, nodes: nodes, startedAt: now, restoredAt: now };
    await this._saveState();
    try { window.dispatchEvent(new CustomEvent('nexo:fenix:restored', { detail: { nexoId: acc.nexoId, contacts: contacts.length } })); } catch (e) {}
  }
}

export function createFenix(ble) { return new Fenix(ble); }
