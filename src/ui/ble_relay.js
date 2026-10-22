/**
 * ble_relay.js v1.0 — Jump: mensajes de varios saltos (A → B → C) entre teléfonos NEXO conectados.
 *
 * Rutas (vector de distancias): cada teléfono anuncia a sus vecinos conectados ('rt') a quién alcanza y
 * en cuántos saltos (máx. MAX_HOPS); no devuelve a un vecino las rutas aprendidas de él. Las rutas se
 * renuevan cada AD_INTERVAL_MS y caducan si no (ROUTE_TTL_MS) o si cae el enlace con el vecino.
 *
 * Solo se anuncian rutas a vecinos que entienden Jump (su kx lleva j:1): una build anterior mostraría
 * el paquete 'rt' como un mensaje de texto.
 *
 * Entrega: lo que va a otro teléfono lleva su destino ('to' en paquetes, 'dt' en trozos de flujo) y el
 * número de saltos ('hp'). El puente confirma que lo guarda (custodia: 'rk' o el ack final del flujo),
 * lo apunta en una cola persistente y lo reenvía hacia el destino; si no hay ruta, espera (hasta 24 h).
 * El destino confirma de extremo a extremo con un ack dirigido al origen, que vuelve por las rutas.
 * El contenido va cifrado para el destino (e2e_crypto): los puentes solo ven quién, a quién y los ids.
 */
var MAX_HOPS = 4;
var AD_INTERVAL_MS = 30000;
var ROUTE_TTL_MS = 95000;
var QUEUE_FILE = 'nexo_relay_queue.json';
var QUEUE_MAX_AGE_MS = 86400000;
var QUEUE_MAX = 200;
var QUEUE_MAX_BYTES = 30000000; // lo guardado de paso para otros (fotos, textos largos) no pasa de ~30 MB
var SEEN_TTL_MS = 3600000;

function _nid(id) { return (id || '').toString().toLowerCase().trim(); }
function _mac(m) { return (m || '').toString().toLowerCase().replace(/[:-]/g, '').trim(); }
function _isNx(id) { return /^nx[0-9a-z]{8}$/.test(_nid(id)); }
function _plugin() { return (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.NexoBLE) || null; }

export class BleRelay {
  constructor(ble) {
    this.ble = ble;
    this.routes = new Map();     // destino → { via, hops, ts }
    this.neighbors = new Map();  // nexoId vecino → deviceId (enlace listo)
    this.queue = [];             // { id, kind: 'pkt'|'chat'|'file', dst, origin, data|ref, meta, prev, ts, tries }
    this.seen = new Map();       // id → ts (no reenviar dos veces lo mismo)
    this.capable = new Set();    // vecinos que entienden Jump (kx con j:1 o ya mandaron 'rt')
    this._sending = new Set();
    this._loaded = false;
    this._adTimer = null;
    this._tick = null;
  }

  me() { return _nid(this.ble && this.ble.localNexoId); }

  start() {
    var self = this;
    if (self._tick) return;
    self._loadQueue();
    self._tick = setInterval(function() { self._periodic(); }, AD_INTERVAL_MS);
  }

  // ---------- vecinos y rutas ----------
  _isReady(deviceId) {
    var ble = this.ble;
    if (!deviceId || !ble || typeof ble._getDeviceState !== 'function') return false;
    var st = ble._getDeviceState(deviceId);
    return st && (st.state === 'ready_to_chat' || st.state === 'notifications_ready');
  }

  _computeNeighbors() {
    var ble = this.ble, me = this.me(), out = new Map();
    if (!ble || !ble._deviceStates) return out;
    ble._deviceStates.forEach(function(st, key) {
      if (st.state !== 'ready_to_chat' && st.state !== 'notifications_ready') return;
      var nx = _nid(ble._macToNexoId && ble._macToNexoId.get(_mac(key)));
      if (_isNx(nx) && nx !== me && !out.has(nx)) out.set(nx, key);
    });
    return out;
  }

  // Llamar cuando un enlace queda listo o cae
  onLinkChange() {
    var self = this;
    var prev = self.neighbors;
    self.neighbors = self._computeNeighbors();
    var changed = prev.size !== self.neighbors.size;
    prev.forEach(function(dev, nx) { if (!self.neighbors.has(nx)) changed = true; });
    self.neighbors.forEach(function(dev, nx) { if (!prev.has(nx)) changed = true; });
    // Rutas por un vecino que ya no está
    self.routes.forEach(function(r, d) { if (!self.neighbors.has(r.via)) { self.routes.delete(d); changed = true; } });
    if (changed) {
      self._scheduleAdvertise(300);
      self._onReachChanged();
    }
  }

  markCapable(nexoId) {
    var nx = _nid(nexoId);
    if (!_isNx(nx) || this.capable.has(nx)) return;
    this.capable.add(nx);
    this._scheduleAdvertise(300);
  }

  _scheduleAdvertise(ms) {
    var self = this;
    if (self._adTimer) return;
    self._adTimer = setTimeout(function() { self._adTimer = null; self._advertise(); }, ms || 1000);
  }

  _advertise() {
    var self = this, me = self.me();
    if (!me || !self.ble || typeof self.ble._sendMessageNative !== 'function') return;
    self.neighbors.forEach(function(devX, x) {
      if (!self.capable.has(x)) return;
      var r = {};
      self.neighbors.forEach(function(dev, y) { if (y !== x) r[y] = 1; });
      self.routes.forEach(function(rt, d) {
        if (d === x || rt.via === x || self.neighbors.has(d) || rt.hops >= MAX_HOPS) return;
        if (!r[d] || rt.hops < r[d]) r[d] = rt.hops;
      });
      var pkt = JSON.stringify({ v: 1, type: 'rt', from: me, r: r, ts: Date.now() });
      self.ble._sendMessageNative(devX, pkt, null).catch(function() {});
    });
  }

  _handleRouteAd(p, deviceId) {
    var self = this, me = self.me(), x = _nid(p.from), now = Date.now();
    if (!_isNx(x) || x === me) return;
    this.capable.add(x);
    // Solo de un vecino con enlace listo con esa dirección
    if (_nid(self.ble._macToNexoId && self.ble._macToNexoId.get(_mac(deviceId))) !== x) return;
    if (!self.neighbors.has(x)) self.neighbors = self._computeNeighbors();
    if (!self.neighbors.has(x)) return;
    var r = (p.r && typeof p.r === 'object') ? p.r : {};
    var changed = false, added = [];
    self.routes.forEach(function(rt, d) { if (rt.via === x && !Object.prototype.hasOwnProperty.call(r, d)) { self.routes.delete(d); changed = true; } });
    Object.keys(r).forEach(function(d0) {
      var d = _nid(d0), h = Number(r[d0]) + 1;
      if (!_isNx(d) || d === me || d === x || !(h >= 2) || h > MAX_HOPS) return;
      var cur = self.routes.get(d);
      if (!cur || h < cur.hops || cur.via === x || now - cur.ts > ROUTE_TTL_MS) {
        if (!cur || cur.via !== x || cur.hops !== h) { changed = true; added.push(d); }
        self.routes.set(d, { via: x, hops: h, ts: now });
      }
    });
    if (changed) {
      console.log('[JUMP] Rutas: ' + self.describe());
      self._scheduleAdvertise(1000);
      self._onReachChanged(added);
    }
  }

  describe() {
    var parts = [];
    this.routes.forEach(function(r, d) { parts.push(d + ' por ' + r.via + ' (' + r.hops + ')'); });
    return parts.join(', ') || 'ninguna';
  }

  // Siguiente salto hacia un destino: enlace directo si existe; si no, el vecino de la ruta
  nextHop(dst) {
    var d = _nid(dst);
    if (!d) return null;
    var ble = this.ble;
    var direct = ble && typeof ble._resolveDeviceIdForNexoId === 'function' ? ble._resolveDeviceIdForNexoId(d) : null;
    if (direct && this._isReady(direct)) return { deviceId: direct, direct: true, hops: 1 };
    var rt = this.routes.get(d);
    if (!rt || Date.now() - rt.ts > ROUTE_TTL_MS) return null;
    var dev = this.neighbors.get(rt.via);
    if (!dev || !this._isReady(dev)) return null;
    return { deviceId: dev, direct: false, via: rt.via, hops: rt.hops };
  }

  // Ruta por otro teléfono (null si hay enlace directo o no hay ruta)
  relayHop(dst) {
    var h = this.nextHop(dst);
    return (h && !h.direct) ? h : null;
  }

  _periodic() {
    var self = this, now = Date.now();
    self.neighbors = self._computeNeighbors();
    self.routes.forEach(function(r, d) { if (now - r.ts > ROUTE_TTL_MS || !self.neighbors.has(r.via)) self.routes.delete(d); });
    self.seen.forEach(function(ts, id) { if (now - ts > SEEN_TTL_MS) self.seen.delete(id); });
    if (self.neighbors.size) self._advertise();
    self._flushQueue();
  }

  _onReachChanged(dests) {
    var self = this;
    self._flushQueue();
    // Lo pendiente propio para esos destinos sale ahora por la ruta nueva
    var list = dests || Array.from(self.routes.keys());
    list.forEach(function(d) {
      if (self.ble && typeof self.ble._flushPendingViaRelay === 'function') self.ble._flushPendingViaRelay(d);
    });
  }

  // ---------- recepción ----------
  // Devuelve true si el paquete era de jump y ya se atendió aquí (no sigue al resto de la app)
  intercept(p, raw, deviceId) {
    var self = this, me = self.me();
    if (!p || typeof p !== 'object') return false;
    if (p.type === 'rt') { self._handleRouteAd(p, deviceId); return true; }
    if (p.type === 'rk') { if (self.ble.ackSystem) self.ble.ackSystem.handleCustody(p.msgId); return true; }
    var to = _nid(p.to);
    if (!to || to === me || !_isNx(to)) return false;
    // Paquete para otro teléfono: hacer de puente
    var hp = (Number(p.hp) || 0) + 1;
    var id = p.msgId || (p.type + ':' + (p.from || '') + ':' + (p.ts || ''));
    if (p.type === 'ack' || p.type === 'read_receipt') {
      // Un ack que pasa por aquí también confirma el salto que este teléfono hizo (custodia entregada)
      if (p.type === 'ack' && self.ble.ackSystem) self.ble.ackSystem.resolveHopQuiet(p.msgId);
    }
    if (hp > MAX_HOPS) { console.warn('[JUMP] Descartado (demasiados saltos): ' + id); return true; }
    var isChat = p.type === 'chat';
    if (isChat) self._sendCustody(deviceId, p.msgId);
    var key = p.type + ':' + id;
    if (self.seen.has(key)) return true;
    self.seen.set(key, Date.now());
    p.hp = hp;
    var item = { id: id, kind: 'pkt', reliable: isChat, dst: to, origin: _nid(p.from), data: JSON.stringify(p), prev: _mac(deviceId), ts: Date.now(), tries: 0 };
    console.log('[JUMP] Puente: ' + p.type + ' ' + id + ' de ' + item.origin + ' para ' + to + ' (salto ' + hp + ')');
    self._enqueue(item);
    return true;
  }

  _sendCustody(deviceId, msgId) {
    if (!msgId || !this.ble) return;
    var pkt = JSON.stringify({ v: 1, type: 'rk', msgId: msgId, from: this.me() });
    this.ble._sendMessageNative(deviceId, pkt, null).catch(function() {});
  }

  // Flujo (texto largo o archivo) completo que va para otro teléfono. true si se atendió aquí.
  onStreamComplete(kind, msgId, data, meta, deviceId) {
    var self = this, me = self.me();
    var to = _nid(meta && meta.dst);
    if (!to || to === me) return false;
    var hp = (Number(meta.hp) || 0) + 1;
    if (hp > MAX_HOPS) { console.warn('[JUMP] Descartado (demasiados saltos): ' + msgId); return true; }
    var key = kind + ':' + msgId;
    if (self.seen.has(key)) return true;
    self.seen.set(key, Date.now());
    var m = {};
    ['f', 'fr', 'ts', 'type', 'name', 'mime', 'size', 'format', 'width', 'height', 'hdFor', 'preview', 'thumb', 'pages'].forEach(function(k) {
      if (meta[k] !== undefined && meta[k] !== null) m[k] = meta[k];
    });
    m.dst = to;
    m.hp = hp;
    var item = { id: msgId, kind: kind, dst: to, origin: _nid(meta.fr), meta: m, ref: 'nexo_relay_' + String(msgId).replace(/[^A-Za-z0-9_]/g, '') + '.dat', prev: _mac(deviceId), ts: Date.now(), tries: 0 };
    console.log('[JUMP] Puente: ' + kind + ' ' + msgId + ' (' + Math.round(data.length / 1024) + ' KB) de ' + item.origin + ' para ' + to + ' (salto ' + hp + ')');
    item._data = data;
    item.size = data.length;
    var pl = _plugin();
    if (pl && typeof pl.saveToFile === 'function') pl.saveToFile({ filename: item.ref, content: data }).catch(function() {});
    self._enqueue(item);
    return true;
  }

  // ---------- envío dirigido (ack/kx de extremo a extremo) ----------
  sendRouted(obj) {
    var to = _nid(obj.to);
    if (!to) return;
    obj.to = to;
    var id = obj.msgId || (obj.type + ':' + Date.now());
    this._enqueue({ id: id, kind: 'pkt', reliable: false, dst: to, origin: this.me(), data: JSON.stringify(obj), prev: '', ts: Date.now(), tries: 0 });
  }

  // ---------- cola persistente ----------
  _enqueue(item) {
    var self = this;
    self.queue = self.queue.filter(function(q) { return !(q.id === item.id && q.kind === item.kind && q.dst === item.dst); });
    self.queue.push(item);
    if (self.queue.length > QUEUE_MAX) self._drop(self.queue.shift());
    var bytes = 0;
    self.queue.forEach(function(q) { bytes += q.size || 0; });
    while (bytes > QUEUE_MAX_BYTES) {
      var old = self.queue.find(function(q) { return q.size; });
      if (!old || old === item) break;
      console.warn('[JUMP] Cola de puente llena: se descarta ' + old.id);
      bytes -= old.size;
      self.queue.splice(self.queue.indexOf(old), 1);
      self._drop(old);
    }
    self._saveQueue();
    self._trySend(item);
  }

  _drop(item) {
    if (!item) return;
    if (item.ref) { var pl = _plugin(); if (pl && typeof pl.deleteFile === 'function') pl.deleteFile({ filename: item.ref }).catch(function() {}); }
  }

  _remove(item) {
    this.queue = this.queue.filter(function(q) { return q !== item; });
    this._drop(item);
    this._saveQueue();
  }

  _flushQueue() {
    var self = this, now = Date.now();
    self.queue.slice().forEach(function(item) {
      if (now - item.ts > QUEUE_MAX_AGE_MS) { console.warn('[JUMP] Caducado sin entregar: ' + item.id); self._remove(item); return; }
      self._trySend(item);
    });
  }

  _trySend(item) {
    var self = this;
    var ack = self.ble && self.ble.ackSystem;
    var sk = item.kind + ':' + item.id + ':' + item.dst;
    if (self._sending.has(sk) || !ack) return;
    var hop = self.nextHop(item.dst);
    // Nunca de vuelta al teléfono del que llegó (evita bucles con rutas viejas)
    if (!hop || (item.prev && _mac(hop.deviceId) === item.prev)) return;
    self._sending.add(sk);
    item.tries++;
    var p;
    if (item.kind === 'pkt') {
      p = item.reliable ? ack.sendRawWithRetry(hop.deviceId, item.data, item.id)
        : self.ble._sendMessageNative(hop.deviceId, item.data, null);
    } else {
      p = self._loadData(item).then(function(data) {
        if (!data) throw new Error('datos perdidos');
        return ack.forwardStream(hop.deviceId, item.id, data, item.meta, item.kind);
      });
    }
    p.then(function() {
      self._sending.delete(sk);
      console.log('[JUMP] Reenviado ' + item.kind + ' ' + item.id + ' hacia ' + item.dst + (hop.direct ? ' (directo)' : ' por ' + hop.via));
      self._remove(item);
    }).catch(function(e) {
      self._sending.delete(sk);
      if (e && e.message === 'datos perdidos') { self._remove(item); return; }
      console.warn('[JUMP] No se pudo reenviar ' + item.id + ': ' + (e && e.message) + ' (queda en espera)');
    });
  }

  _loadData(item) {
    if (item._data) return Promise.resolve(item._data);
    var pl = _plugin();
    if (!pl || typeof pl.loadFromFile !== 'function') return Promise.resolve(null);
    return pl.loadFromFile({ filename: item.ref }).then(function(r) { return (r && r.exists && r.content) || null; }).catch(function() { return null; });
  }

  _saveQueue() {
    var pl = _plugin();
    if (!pl || typeof pl.saveToFile !== 'function') return;
    var list = this.queue.map(function(q) {
      var c = Object.assign({}, q);
      delete c._data;
      return c;
    });
    pl.saveToFile({ filename: QUEUE_FILE, content: JSON.stringify({ v: 1, queue: list }) }).catch(function() {});
  }

  _loadQueue() {
    var self = this, pl = _plugin();
    if (self._loaded || !pl || typeof pl.loadFromFile !== 'function') return;
    self._loaded = true;
    pl.loadFromFile({ filename: QUEUE_FILE }).then(function(r) {
      if (!r || !r.exists || !r.content) return;
      var data = JSON.parse(r.content);
      var list = (data && Array.isArray(data.queue)) ? data.queue : [];
      list.forEach(function(q) { if (q && q.id && q.dst) { q.tries = 0; self.queue.push(q); } });
      if (list.length) console.log('[JUMP] Cola de puente cargada: ' + list.length);
    }).catch(function() {});
  }
}

export function createRelay(ble) { return new BleRelay(ble); }
export var RELAY_MAX_HOPS = MAX_HOPS;
