/**
 * fenix.js v2.0 — Protocolo Fénix, fase 1: la cuenta; fase 2: los mensajes (docs/FENIX.md).
 *
 * Fase 2 (mensajes de texto): los mensajes nuevos se juntan en segmentos (≤ CFG.segBytes) cifrados con la misma
 * clave maestra K; cada segmento se guarda en 2 contactos distintos con Fénix 2 (kx fx:2): "dualidad de piezas".
 * El pingeo diario pide también prueba de los segmentos ('fp' con sg → 'fo' con sp); si falta, se reenvía; si el
 * contacto se pierde, el segmento pasa a otro. Tras recuperar la cuenta, el teléfono pide los segmentos a cada
 * contacto que se conecta ('fq' con m:1; las builds anteriores lo ignoran) y rehace el historial. Los nodos no
 * pueden leerlos (les falta K).
 *
 * Fase 3 (ronda 2757, plan del dueño punto 9: fotos, notas de voz, previas de vídeo y archivos de hasta ~1 MB): cada
 * uno es un "segmento de medio" (id 'd…', cifrado con K) guardado en 2 contactos con Fénix 3 (kx fx:3), en un archivo
 * aparte (no dentro del JSON). Los de más de medBleMax solo se entregan por el mismo Wi-Fi (por Bluetooth tardarían
 * minutos). El pingeo los prueba igual que los de texto. Al recuperar, vuelven con los mensajes y cada contenido vuelve
 * a su mensaje (vaultReplaceAttachment). No van: el vídeo HD ni los archivos grandes (big_file.js). Límites: medMax
 * del dueño, nodeMedCap por contacto en quien guarda.
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
import { vaultLoadFile, vaultReplaceAttachment } from '../vault/vault_manager.js';

var STATE_FILE = 'nexo_fenix.json';        // dueño: K, trozos, copia y nodos
var STORE_FILE = 'nexo_fenix_store.json';  // nodo: lo que guarda de otros
var MSGS_FILE = 'nexo_fenix_msgs.json';    // dueño: segmentos de mensajes (cifrados) y quién los guarda
var IDENTITY_FILE = 'nexo_e2e_identity.json';
var RATCHET_FILE = 'nexo_ratchet.json';
var NEXO_ID_FILE = 'nexo_advertising_id.json';
var DAY = 86400000;
var CFG = { n: 10, t: 6, min: 10, mirror: 20, pingMs: DAY, lostMs: 7 * DAY, tickMs: 60000, rebuildMs: 600000,
  maxOwners: 50, maxBlob: 400000, resetMs: 7 * DAY,
  // Fase 2: segmento con ≥ segMin mensajes nuevos o con alguno de hace > segMaxMs; tamaño y límites
  segMin: 20, segMaxMs: DAY, segBytes: 48000, msgsMax: 2000000, nodeSegCap: 2500000, segCopies: 2,
  // Fase 3: un medio de hasta medItemMax (base64), entre todos medMax; quien guarda, hasta nodeMedCap por contacto
  medItemMax: 1500000, medMax: 30000000, nodeMedCap: 20000000, medBleMax: 300000 };
var MED_TYPES = { image: 1, video: 1, audio: 1, file: 1 };
function _medFile(id) { return 'nexo_fenix_d_' + String(id).replace(/[^A-Za-z0-9_-]/g, '_') + '.b64'; }
function _nodeMedFile(owner, id) { return 'nexo_fenix_n_' + _nid(owner) + '_' + String(id).replace(/[^A-Za-z0-9_-]/g, '_') + '.b64'; }
function _del(name) { var pl = _plugin(); if (pl && typeof pl.deleteFile === 'function') pl.deleteFile({ filename: name }).catch(function() {}); }

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
    this.msgs = null;              // fase 2, dueño: { lastTs, recent, segs: [{ id, ts, n, blob, bh, holders }] }
    this.levels = new Map();       // nexoId → nivel de Fénix que anunció (fx del kx)
    this.askedSegs = {};           // tras recuperar: a quién ya se le pidieron los segmentos
    this._busy = false;
    this._timer = null;
    this.ready = null;
  }

  init() {
    var self = this;
    if (self.ready) return self.ready;
    self.ready = Promise.all([_load(STATE_FILE), _load(STORE_FILE), _load(MSGS_FILE)]).then(function(r) {
      try { if (r[0]) self.state = JSON.parse(r[0]); } catch (e) {}
      try { if (r[1]) self.store = JSON.parse(r[1]) || { owners: {} }; } catch (e) {}
      try { if (r[2]) self.msgs = JSON.parse(r[2]); } catch (e) {}
      if (!self.store.owners) self.store.owners = {};
      if (!self.store.segs) self.store.segs = {}; // fase 2, nodo: dueño → { id: { blob, bh, ts } }
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
  _saveMsgs() { return _save(MSGS_FILE, JSON.stringify(this.msgs)); }

  // Para el kx: 'rs' durante unos días tras recuperar (los contactos empiezan sesiones nuevas del protocolo 2)
  resetMark() { var s = this.state; return (s && s.restoredAt && Date.now() - s.restoredAt < this.cfg.resetMs) ? s.restoredAt : 0; }

  // kx con fx:1 de un teléfono conectado
  markPeer(nexoId, deviceId, level) {
    var self = this, nx = _nid(nexoId);
    if (!_isNx(nx)) return;
    self.peers.add(nx);
    self.levels.set(nx, Number(level) || 1);
    if (self.recovery) self._askForRecovery(nx, deviceId);
    // Cuenta recién recuperada: pedirle los segmentos de mensajes que guarde (una vez por contacto)
    if (self.resetMark() && (Number(level) || 1) >= 2 && !self.askedSegs[nx] && deviceId) {
      self.askedSegs[nx] = Date.now();
      self._ctl(deviceId, { type: 'fq', m: 1 });
      console.log('[FENIX] Pido a ' + nx + ' los mensajes que guarde');
    }
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
    var segs = (this.msgs && this.msgs.segs) || [];
    var copies = this.cfg.segCopies;
    return { active: true, eligible: el, ep: s.ep, n: s.n, t: s.t,
      copies: el >= this.cfg.mirror ? 2 : 1,
      delivered: nodes.filter(function(x) { return !x.lost && x.ep === s.ep; }).length,
      lost: nodes.filter(function(x) { return x.lost; }).length,
      guarding: Object.keys(this.store.owners).length + Object.keys(this.store.segs || {}).filter(function(o) { return !this.store.owners[o]; }, this).length,
      msgs: segs.reduce(function(a, g) { return a + (g.n || 0); }, 0), segs: segs.length,
      segsSafe: segs.filter(function(g) { return Object.keys(g.holders || {}).filter(function(h) { return g.holders[h].ok; }).length >= copies; }).length };
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
    await this._msgTick(el);
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
    var pkt = { type: 'fp', n: nonce };
    var sg = this._segsOf(nx).map(function(g) { return g.id; });
    if (sg.length) pkt.sg = sg; // fase 2: prueba también de estos segmentos
    this._ctl(dev, pkt);
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
      if (p.type === 'fq' && p.m) return self._onSegsRequest(from, deviceId);
      if (p.type === 'fq') return self._onRecoveryRequest(p, from, deviceId);
    }).catch(function(e) { console.warn('[FENIX] ' + (e && e.message)); });
    return true;
  }

  async _onPing(p, from, deviceId) {
    var rec = this.store.owners[from];
    var out = { type: 'fo', n: String(p.n || '') };
    if (!rec) out.miss = 1;
    else {
      rec.lastPing = Date.now();
      out.pr = await _sha(String(p.n || '') + '|' + rec.share + '|' + rec.bh);
      out.ep = rec.ep;
    }
    // Fase 2: prueba de los segmentos que el dueño cree que guardo (y cuáles me faltan)
    if (Array.isArray(p.sg) && p.sg.length) {
      var mine = this.store.segs[from] || {}, have = [], miss = [];
      p.sg.slice(0, 500).forEach(function(id) { if (mine[id]) have.push(mine[id].bh); else miss.push(String(id)); });
      out.sp = await _sha(String(p.n || '') + '|' + have.join('|'));
      if (miss.length) out.sm = miss;
    }
    this._ctl(deviceId, out);
    this._saveStore();
  }

  async _onPong(p, from) {
    var s = this.state, ping = this.pings.get(p.n);
    if (!s || !ping || ping.nx !== from) return;
    this.pings.delete(p.n);
    await this._onSegProof(p, from, ping);
    if (ping.segOnly) return;
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
    // (solo el fragmento de la cuenta: los segmentos de mensajes se quedan; el dueño los reparte aparte)
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
      if (p && p.k === 'seg') return self._onSeg(p, from);
      if (p && p.k === 'segs') return self._onSegsBack(p, from);
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

  // ---------- fase 2: mensajes (dueño) ----------
  _segsOf(nx) { return ((this.msgs && this.msgs.segs) || []).filter(function(g) { return g.holders && g.holders[nx]; }); }

  // Lo de un mensaje que se respalda: texto y datos del chat; de un adjunto solo tipo y nombre (no el contenido)
  _slim(m) {
    var o = { msgId: m.msgId, content: m.content || m.text || '', timestamp: m.timestamp || 0, seq: m.seq || 0, _own: !!m._own,
      senderNexoId: m.senderNexoId || '', senderName: m.senderName || '', status: m.status || '', type: m.type || 'text' };
    if (m.attachmentType) {
      o.attachmentType = m.attachmentType;
      var meta = m.attachmentMeta || {};
      o.attachmentMeta = { name: meta.name || '', mime: meta.mime || '', size: meta.size || 0 };
    }
    ['replyTo', 'replyText', 'forwarded', 'deleted', 'edited'].forEach(function(k) { if (m[k] != null && typeof m[k] !== 'object') o[k] = m[k]; });
    return o;
  }

  async _msgTick(el) {
    var cfg = this.cfg, now = Date.now(), self = this;
    if (!this.msgs) this.msgs = { v: 1, lastTs: 0, recent: [], segs: [], lastSegAt: now };
    var M = this.msgs, changed = false;
    // 1. Mensajes nuevos desde el último segmento (margen de 10 min para los que llegan con hora anterior)
    if (now - (M.checkedAt || 0) >= cfg.rebuildMs && typeof window.vaultLoadMessages === 'function') {
      M.checkedAt = now;
      var since = Math.max(0, (M.lastTs || 0) - 600000), recent = {};
      (M.recent || []).forEach(function(id) { recent[id] = true; });
      var fresh = [], medFresh = [];
      var contacts = this._contacts();
      for (var i = 0; i < contacts.length; i++) {
        var cnx = _nid(contacts[i].nexoId || contacts[i].deviceUUID);
        if (!_isNx(cnx)) continue;
        var list = await window.vaultLoadMessages(cnx);
        list.forEach(function(m) {
          var ts = m.timestamp || 0;
          // Fase 3: el contenido (foto, voz, previa de vídeo, archivo pequeño) va aparte de los textos: cada uno una vez
          // (medDone), de los últimos 30 días; si aún no está en disco, se mira en la próxima vuelta
          if (m.msgId && MED_TYPES[m.attachmentType] && !(m.attachmentMeta && m.attachmentMeta.big) && (m.attachmentRef || m.attachmentPayload) &&
            !(M.medDone && M.medDone[m.msgId]) && ts > now - 30 * DAY) medFresh.push({ c: cnx, m: m });
          if (!m.msgId || ts <= since || recent[m.msgId] || (!m.content && !m.text && !m.attachmentType)) return;
          fresh.push({ c: cnx, m: self._slim(m) });
        });
      }
      if (fresh.length && (fresh.length >= cfg.segMin || now - (M.lastSegAt || 0) > cfg.segMaxMs)) {
        fresh.sort(function(a, b) { return a.m.timestamp - b.m.timestamp; });
        while (fresh.length) {
          var part = [], size = 2;
          while (fresh.length && (size + JSON.stringify(fresh[0]).length < cfg.segBytes || !part.length)) { var f = fresh.shift(); size += JSON.stringify(f).length + 1; part.push(f); }
          await this._newSeg(part);
        }
        changed = true;
      }
      for (var mi = 0; mi < medFresh.length; mi++) {
        if (await this._newMed(medFresh[mi].c, medFresh[mi].m)) changed = true;
      }
    }
    // 2. Quién guarda cada segmento: segCopies contactos distintos con Fénix 2, que no se hayan perdido
    var el2 = el.filter(function(c) { return (c.fx || 0) >= 2; }).map(function(c) { return _nid(c.nexoId || c.deviceUUID); });
    var el3 = el.filter(function(c) { return (c.fx || 0) >= 3; }).map(function(c) { return _nid(c.nexoId || c.deviceUUID); });
    var load = {};
    el2.forEach(function(nx) { load[nx] = self._segsOf(nx).length; });
    M.segs.forEach(function(g) {
      var pool = g.med ? el3 : el2;
      Object.keys(g.holders).forEach(function(nx) {
        var h = g.holders[nx], last = Math.max(h.proofAt || 0, h.at || 0);
        if (pool.indexOf(nx) < 0 || now - last > cfg.lostMs) { delete g.holders[nx]; changed = true; console.warn('[FENIX] Segmento ' + g.id + ': ' + nx + ' perdido, pasa a otro contacto'); }
      });
      while (Object.keys(g.holders).length < cfg.segCopies) {
        var cand = pool.filter(function(nx) { return !g.holders[nx]; }).sort(function(a, b) { return (load[a] || 0) - (load[b] || 0); })[0];
        if (!cand) break;
        g.holders[cand] = { at: now, ok: false };
        load[cand]++; changed = true;
      }
    });
    if (changed) await this._saveMsgs();
    // 3. Entregas y pingeo de los que solo guardan segmentos (los del fragmento de la cuenta ya tienen pingeo)
    var nodes = (this.state && this.state.nodes) || {};
    for (var j = 0; j < el2.length; j++) {
      var nx = el2[j], dev = this._readyDevice(nx);
      if (!dev || !this.peers.has(nx) || (this.levels.get(nx) || 1) < 2) continue;
      // Fase 3: un medio grande solo por el mismo Wi-Fi: si ahora no hay, primero lo demás
      var lanOk = !!(this.ble.lan && this.ble.lan.canReach(nx));
      var pend = this._segsOf(nx).filter(function(g) { return !g.holders[nx].ok && (!g.med || (g.size || 0) <= cfg.medBleMax || lanOk) && (!g.med || (self.levels.get(nx) || 1) >= 3); });
      if (pend.length) { await this._putSeg(nx, pend[0].med && (pend[0].size || 0) > cfg.medBleMax ? 'lan:' + nx : dev, pend[0]); continue; }
      var hs = this._segsOf(nx);
      if (hs.length && !nodes[nx] && now - Math.max.apply(null, hs.map(function(g) { return g.holders[nx].pingAt || 0; })) > cfg.pingMs) {
        hs.forEach(function(g) { g.holders[nx].pingAt = now; });
        var nonce = _hex(_rand(12));
        this.pings.set(nonce, { nx: nx, idx: 0, at: now, segOnly: true });
        this._ctl(dev, { type: 'fp', n: nonce, sg: hs.map(function(g) { return g.id; }) });
      }
    }
  }

  async _newSeg(part) {
    var M = this.msgs, now = Date.now();
    var id = 's' + now.toString(36) + _hex(_rand(3));
    var plain = { v: 1, o: this.me(), id: id, ts: now, items: part };
    var key = await _subtle().importKey('raw', _unhex(this.state.k), 'AES-GCM', false, ['encrypt']);
    var iv = _rand(12);
    var ct = new Uint8Array(await _subtle().encrypt({ name: 'AES-GCM', iv: iv, additionalData: _aad(this.me(), 'seg:' + id) }, key, _utf8(JSON.stringify(plain))));
    var blob = new Uint8Array(12 + ct.length); blob.set(iv); blob.set(ct, 12);
    var b64 = _b64(blob);
    M.segs.push({ id: id, ts: now, n: part.length, blob: b64, bh: await _sha(b64), holders: {} });
    var maxTs = Math.max.apply(null, part.map(function(x) { return x.m.timestamp || 0; }));
    M.lastTs = Math.max(M.lastTs || 0, maxTs);
    M.recent = part.filter(function(x) { return (x.m.timestamp || 0) > M.lastTs - 600000; }).map(function(x) { return x.m.msgId; }).concat(M.recent || []).slice(0, 500);
    M.lastSegAt = now;
    // Límite: los más antiguos salen (los nodos también tienen el suyo)
    // (solo los de texto: los medios tienen su propio límite, medMax)
    var texts = M.segs.filter(function(g) { return !g.med; });
    var total = texts.reduce(function(a, g) { return a + g.blob.length; }, 0);
    while (total > this.cfg.msgsMax && texts.length > 1) { var old = texts.shift(); total -= old.blob.length; M.segs.splice(M.segs.indexOf(old), 1); }
    console.log('[FENIX] Segmento de mensajes ' + id + ': ' + part.length + ' mensaje(s), ' + Math.round(blob.length / 1024) + ' KB');
  }

  // Fase 3: el contenido de un mensaje (cifrado con K) como segmento de medio, en un archivo propio
  async _newMed(c, m) {
    var M = this.msgs, cfg = this.cfg, now = Date.now();
    M.medDone = M.medDone || {};
    if (M.medDone[m.msgId]) return false;
    var payload = m.attachmentPayload || (m.attachmentRef ? await vaultLoadFile(m.attachmentRef) : null);
    if (!payload || typeof payload !== 'string' || payload.length <= 4) return false; // aún no está (o es un archivo grande)
    M.medDone[m.msgId] = now;
    var ids = Object.keys(M.medDone);
    if (ids.length > 6000) ids.sort(function(a, b) { return M.medDone[a] - M.medDone[b]; }).slice(0, ids.length - 5000).forEach(function(k) { delete M.medDone[k]; });
    if (payload.length > cfg.medItemMax) { console.log('[FENIX] ' + m.msgId + ': demasiado grande para respaldarlo (' + Math.round(payload.length / 1024) + ' KB)'); return true; }
    var meta = m.attachmentMeta || {}, keep = {};
    ['name', 'mime', 'size', 'type', 'format', 'width', 'height', 'duration', 'pages', 'thumb'].forEach(function(k) { if (meta[k] != null && (k !== 'thumb' || String(meta[k]).length < 60000)) keep[k] = meta[k]; });
    var id = 'd' + now.toString(36) + _hex(_rand(3));
    var plain = { v: 1, kind: 'med', o: this.me(), id: id, c: c, msgId: m.msgId, type: m.attachmentType, meta: keep, payload: payload };
    var key = await _subtle().importKey('raw', _unhex(this.state.k), 'AES-GCM', false, ['encrypt']);
    var iv = _rand(12);
    var ct = new Uint8Array(await _subtle().encrypt({ name: 'AES-GCM', iv: iv, additionalData: _aad(this.me(), 'seg:' + id) }, key, _utf8(JSON.stringify(plain))));
    var blob = new Uint8Array(12 + ct.length); blob.set(iv); blob.set(ct, 12);
    var b64 = _b64(blob);
    await _save(_medFile(id), b64);
    M.segs.push({ id: id, ts: now, n: 1, med: 1, ref: _medFile(id), size: b64.length, bh: await _sha(b64), holders: {} });
    // Límite: fuera los medios más antiguos
    var meds = M.segs.filter(function(g) { return g.med; }), total = meds.reduce(function(a, g) { return a + (g.size || 0); }, 0);
    while (total > cfg.medMax && meds.length > 1) { var old = meds.shift(); total -= old.size || 0; M.segs.splice(M.segs.indexOf(old), 1); _del(old.ref); }
    console.log('[FENIX] Medio ' + id + ' (' + m.attachmentType + '): ' + Math.round(b64.length / 1024) + ' KB');
    return true;
  }

  async _putSeg(nx, dev, g) {
    var self = this;
    if (self.inflight.has(nx) || !self.ble.ackSystem) return;
    var blob = g.med ? await _load(g.ref) : g.blob;
    if (!blob) { console.warn('[FENIX] ' + g.id + ': ya no está en este teléfono'); return; }
    self.inflight.add(nx);
    var payload = { v: 1, k: 'seg', o: self.me(), id: g.id, ts: g.ts, blob: blob, bh: g.bh };
    if (g.med) payload.med = 1;
    try {
      await self.ble.ackSystem.sendFile(dev, 'fxs_' + g.id + '_' + _hex(_rand(2)), _jsonB64(payload), { type: 'fenix', fx: 'put' });
      if (g.holders[nx]) { g.holders[nx].ok = true; g.holders[nx].proofAt = Date.now(); }
      console.log('[FENIX] Segmento ' + g.id + ' entregado a ' + nx);
      await self._saveMsgs();
    } catch (e) {
      console.warn('[FENIX] Entrega del segmento a ' + nx + ' fallida: ' + (e && e.message));
    } finally { self.inflight.delete(nx); }
  }

  // Respuesta del pingeo con prueba de segmentos
  async _onSegProof(p, from, ping) {
    var hs = this._segsOf(from);
    if (!hs.length || !ping || ping.nx !== from) return;
    var miss = Array.isArray(p.sm) ? p.sm.map(String) : [];
    var have = hs.filter(function(g) { return miss.indexOf(g.id) < 0; });
    var ok = typeof p.sp === 'string' && p.sp === await _sha(p.n + '|' + have.map(function(g) { return g.bh; }).join('|'));
    var now = Date.now();
    hs.forEach(function(g) {
      var h = g.holders[from];
      if (ok && miss.indexOf(g.id) < 0) h.proofAt = now;
      else h.ok = false; // le falta (o no lo prueba): se le vuelve a entregar
    });
    if (typeof p.sp === 'string') console.log('[FENIX] Pingeo: ' + from + ' conserva ' + (ok ? hs.length - miss.length : 0) + ' de ' + hs.length + ' segmentos de mensajes');
    await this._saveMsgs();
  }

  // ---------- fase 2: mensajes (nodo) ----------
  async _onSeg(p, from) {
    var med = p && p.med === 1;
    var okId = med ? /^d[0-9a-z]{6,20}$/ : /^s[0-9a-z]{6,20}$/;
    var maxLen = med ? Math.ceil(this.cfg.medItemMax * 1.5) + 4096 : this.cfg.segBytes * 3;
    if (!p || _nid(p.o) !== from || !okId.test(String(p.id || '')) || typeof p.blob !== 'string' || p.blob.length > maxLen) {
      console.warn('[FENIX] Segmento de ' + from + ' rechazado (no válido)');
      return;
    }
    var segs = this.store.segs;
    if (!segs[from] && Object.keys(segs).length >= this.cfg.maxOwners) { console.warn('[FENIX] Límite de contactos guardados'); return; }
    var mine = segs[from] = segs[from] || {};
    if (med) {
      // Fase 3: el medio en un archivo propio; en el JSON solo su huella
      var ref = _nodeMedFile(from, p.id);
      await _save(ref, p.blob);
      mine[p.id] = { ref: ref, size: p.blob.length, bh: await _sha(p.blob), ts: Number(p.ts) || Date.now() };
    } else mine[p.id] = { blob: p.blob, bh: await _sha(p.blob), ts: Number(p.ts) || Date.now() };
    // Límite por contacto (textos y medios por separado): fuera los más antiguos
    var ids = Object.keys(mine).filter(function(id) { return !!mine[id].ref === med; }).sort(function(a, b) { return mine[a].ts - mine[b].ts; });
    var sz = function(id) { return med ? (mine[id].size || 0) : mine[id].blob.length; };
    var total = ids.reduce(function(a, id) { return a + sz(id); }, 0), cap = med ? this.cfg.nodeMedCap : this.cfg.nodeSegCap;
    while (total > cap && ids.length > 1) { var old = ids.shift(); total -= sz(old); if (mine[old].ref) _del(mine[old].ref); delete mine[old]; }
    console.log('[FENIX] Guardo el ' + (med ? 'medio ' : 'segmento ') + p.id + ' de ' + from + ' (' + (med ? Math.round(p.blob.length / 1024) + ' KB, ' : '') + 'cifrado; no puedo leerlo)');
    await this._saveStore();
  }

  // El dueño (con la cuenta recuperada en otro teléfono) pide sus segmentos: se le envían cifrados para él
  async _onSegsRequest(from, deviceId) {
    var mine = this.store.segs[from];
    if (!mine || !this.ble.ackSystem) return;
    var ids = Object.keys(mine).sort(function(a, b) { return mine[a].ts - mine[b].ts; });
    if (!ids.length) return;
    // En lotes de ~300 KB (cada lote, un archivo cifrado para el dueño)
    var batches = [], cur = [], size = 0, sent = 0;
    for (var k = 0; k < ids.length; k++) {
      var g = mine[ids[k]], blob = g.ref ? await _load(g.ref) : g.blob;
      if (!blob) continue;
      if (cur.length && size + blob.length > 300000) { batches.push(cur); cur = []; size = 0; }
      cur.push({ id: ids[k], blob: blob, ts: g.ts }); size += blob.length;
    }
    if (cur.length) batches.push(cur);
    for (var i = 0; i < batches.length; i++) {
      try {
        await this.ble.ackSystem.sendFile(deviceId, 'fxm_' + Date.now() + '_' + _hex(_rand(2)), _jsonB64({ v: 1, k: 'segs', o: from, list: batches[i] }), { type: 'fenix', fx: 'rec' });
        sent += batches[i].length;
      } catch (e) { console.warn('[FENIX] Envío de segmentos a ' + from + ' fallido: ' + (e && e.message)); return; }
    }
    console.log('[FENIX] ' + from + ' recuperó su cuenta: le devuelvo ' + sent + ' segmento(s) de mensajes');
  }

  // ---------- fase 2: el dueño recibe sus segmentos tras recuperar ----------
  async _onSegsBack(p, from) {
    if (!this.state || !this.state.k || _nid(p.o) !== this.me() || !Array.isArray(p.list)) return;
    var key = await _subtle().importKey('raw', _unhex(this.state.k), 'AES-GCM', false, ['decrypt']);
    if (!this.msgs) this.msgs = { v: 1, lastTs: 0, recent: [], segs: [], lastSegAt: Date.now() };
    var M = this.msgs, byChat = {}, nSegs = 0, meds = [];
    for (var i = 0; i < p.list.length; i++) {
      var it = p.list[i];
      if (!it || typeof it.blob !== 'string' || !/^[sd][0-9a-z]{6,20}$/.test(String(it.id || ''))) continue;
      var plain = null;
      try {
        var raw = _unb64(it.blob);
        var pt = await _subtle().decrypt({ name: 'AES-GCM', iv: raw.subarray(0, 12), additionalData: _aad(this.me(), 'seg:' + it.id) }, key, raw.subarray(12));
        plain = JSON.parse(new TextDecoder().decode(new Uint8Array(pt)));
      } catch (e) { console.warn('[FENIX] Segmento ' + it.id + ' de ' + from + ' no se descifra: descartado'); continue; }
      if (plain && plain.id === it.id && plain.kind === 'med' && it.id.charAt(0) === 'd') {
        // Fase 3: el contenido de un mensaje; vuelve a su mensaje cuando los textos ya estén
        meds.push(plain);
        var gm = M.segs.filter(function(s) { return s.id === it.id; })[0];
        if (!gm) { await _save(_medFile(it.id), it.blob); gm = { id: it.id, ts: Number(it.ts) || Date.now(), n: 1, med: 1, ref: _medFile(it.id), size: it.blob.length, bh: await _sha(it.blob), holders: {} }; M.segs.push(gm); }
        gm.holders[from] = { at: Date.now(), ok: true, proofAt: Date.now() };
        (M.medDone = M.medDone || {})[plain.msgId] = Date.now();
        continue;
      }
      if (!plain || plain.id !== it.id || !Array.isArray(plain.items)) continue;
      nSegs++;
      plain.items.forEach(function(x) { if (x && _isNx(_nid(x.c)) && x.m && x.m.msgId) (byChat[_nid(x.c)] = byChat[_nid(x.c)] || []).push(x.m); });
      // Se sigue cuidando: el que lo devolvió lo tiene
      var g = M.segs.filter(function(s) { return s.id === it.id; })[0];
      if (!g) { g = { id: it.id, ts: Number(it.ts) || Date.now(), n: plain.items.length, blob: it.blob, bh: await _sha(it.blob), holders: {} }; M.segs.push(g); }
      g.holders[from] = { at: Date.now(), ok: true, proofAt: Date.now() };
      M.lastTs = Math.max(M.lastTs || 0, Math.max.apply(null, plain.items.map(function(x) { return (x.m && x.m.timestamp) || 0; })));
    }
    M.segs.sort(function(a, b) { return a.ts - b.ts; });
    var added = 0;
    var chats = Object.keys(byChat);
    for (var c = 0; c < chats.length; c++) {
      var cur = await window.vaultLoadMessages(chats[c]), have = {};
      cur.forEach(function(m) { have[m.msgId] = true; });
      var add = byChat[chats[c]].filter(function(m) { if (have[m.msgId]) return false; have[m.msgId] = true; return true; });
      if (!add.length) continue;
      add.forEach(function(m) { m.messageId = m.msgId; m.text = m.content; m.fenix = 1; });
      var merged = cur.concat(add).sort(function(a, b) { return (a.timestamp || 0) - (b.timestamp || 0); });
      await window.vaultSaveMessages(chats[c], merged);
      added += add.length;
    }
    // Fase 3: cada contenido a su mensaje (si el mensaje aún no está, se guarda para cuando llegue)
    M.pendMed = (M.pendMed || []).concat(meds.map(function(x) { return { c: x.c, msgId: x.msgId, id: x.id }; }));
    var medsOk = await this._applyMeds();
    await this._saveMsgs();
    console.log('[FENIX] ' + from + ' me devolvió ' + nSegs + ' segmento(s): ' + added + ' mensaje(s) recuperados' + (meds.length ? ', ' + meds.length + ' foto(s)/archivo(s)' : '') + (medsOk ? ' (' + medsOk + ' en su mensaje)' : ''));
    if (added || medsOk) try { window.dispatchEvent(new CustomEvent('nexo:fenix:messages', { detail: { added: added, media: medsOk, chats: chats.length } })); } catch (e) {}
  }

  // Fase 3: pone el contenido recuperado en su mensaje (los que aún no tienen mensaje esperan)
  async _applyMeds() {
    var M = this.msgs, left = [], done = 0;
    if (!M || !M.pendMed || !M.pendMed.length) return 0;
    var key = await _subtle().importKey('raw', _unhex(this.state.k), 'AES-GCM', false, ['decrypt']);
    for (var i = 0; i < M.pendMed.length; i++) {
      var x = M.pendMed[i], g = M.segs.filter(function(s) { return s.id === x.id; })[0], blob = g && await _load(g.ref);
      if (!blob) { console.warn('[FENIX] Medio ' + x.id + ': no está guardado'); continue; }
      var plain = null;
      try {
        var raw = _unb64(blob);
        var pt = await _subtle().decrypt({ name: 'AES-GCM', iv: raw.subarray(0, 12), additionalData: _aad(this.me(), 'seg:' + x.id) }, key, raw.subarray(12));
        plain = JSON.parse(new TextDecoder().decode(new Uint8Array(pt)));
      } catch (e) { console.warn('[FENIX] Medio ' + x.id + ': no se descifra'); continue; }
      if (!plain || !plain.payload || !_isNx(_nid(plain.c))) continue;
      if (await vaultReplaceAttachment(plain.c, plain.msgId, plain.payload, plain.meta || {})) done++;
      else {
        console.log('[FENIX] Medio ' + x.id + ': su mensaje aún no ha vuelto (espera)');
        if (Date.now() - (x.at || (x.at = Date.now())) < 7 * DAY) left.push(x);
      }
    }
    M.pendMed = left;
    return done;
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
      // Ronda 2755: los contactos ya no anuncian su NEXO ID (código rotativo que este teléfono nuevo no reconoce):
      // se conecta de paso con los NEXO anónimos y al conectar se sabe quién es
      if (relay && relay.anon && typeof relay._connectAnon === 'function') relay.anon.forEach(function(a) {
        if (Date.now() - a.ts <= 120000) relay._connectAnon(a.deviceId);
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
