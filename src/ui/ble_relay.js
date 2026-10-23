/**
 * ble_relay.js v2.2 — Jump: mensajes de varios saltos (A → B → C) por cualquier teléfono NEXO a alcance.
 *
 * v2.0 (bajo demanda, cualquier teléfono NEXO): cada teléfono anota los NEXO que ve al escanear
 * (contactos o no). Si un mensaje no tiene camino, pregunta a los cercanos ('rq': ¿quién llega a X?,
 * máx. MAX_HOPS saltos); quien lo ha visto hace poco o tiene ruta contesta ('rp') y la ruta queda puesta
 * por el camino de vuelta. Con desconocidos solo se conecta cuando hace falta (máx. MAX_TRANSIENT a la
 * vez) y se desconecta tras TRANSIENT_IDLE_MS sin uso; no se agregan como contacto ni se muestran.
 * Batería: con menos de LOW_BATTERY_PCT % sin cargar o en ahorro de energía, el teléfono no hace de
 * puente (no contesta 'rq', retira sus rutas y no da custodia); sus propios mensajes sí salen.
 * Selector de camino (plan): textos → directo, luego Jump; archivos → directo, luego Jump avisando del
 * tiempo estimado. Aquí se añadirán Wi-Fi Direct, Wi-Fi y datos (último recurso: cuestan dinero).
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
 * v2.2: hasta 8 saltos (antes 4): más alcance encadenando teléfonos. Una build anterior en medio sigue
 * descartando lo que llega con más de 4.
 * El contenido va cifrado para el destino (e2e_crypto). v2.1: con remitente sellado ('sx', ble_interface) los puentes
 * solo ven a quién va y los ids, no quién lo manda; el camino de una búsqueda lleva huellas, no NEXO IDs. El primer
 * puente sí sabe qué vecino le entregó el paquete (inevitable en una red de saltos).
 */
var MAX_HOPS = 8;
var AD_INTERVAL_MS = 30000;
var ROUTE_TTL_MS = 95000;
var QUEUE_FILE = 'nexo_relay_queue.json';
var QUEUE_MAX_AGE_MS = 86400000;
var QUEUE_MAX = 200;
var QUEUE_MAX_BYTES = 30000000; // lo guardado de paso para otros (fotos, textos largos) no pasa de ~30 MB
var SEEN_TTL_MS = 3600000;
var NEARBY_TTL_MS = 120000;       // un NEXO visto al escanear cuenta como cercano 2 min
var NEARBY_FRESH_MS = 30000;      // para decir "llego a X" o ir directo hay que haberlo visto hace <30 s
var DISCOVER_THROTTLE_MS = 45000; // como mucho una búsqueda de camino por destino cada 45 s
var DISCOVER_WAIT_MS = 60000;     // una búsqueda vale 60 s
var SCAN_FRESH_MS = 30000;        // si se escaneó hace menos, no se vuelve a escanear para buscar camino
var SCAN_MS = 6500;
var MAX_TRANSIENT = 3;            // conexiones a la vez con teléfonos que no son contactos
var TRANSIENT_IDLE_MS = 60000;
var LOW_BATTERY_PCT = 15;
var DEFAULT_HOP_BPS = 4400;       // velocidad útil medida en los teléfonos del dueño (2695), por salto

function _nid(id) { return (id || '').toString().toLowerCase().trim(); }
function _mac(m) { return (m || '').toString().toLowerCase().replace(/[:-]/g, '').trim(); }
function _isNx(id) { return /^nx[0-9a-z]{8}$/.test(_nid(id)); }
// v2.1: el camino de una búsqueda ('rq') no lleva NEXO IDs sino huellas con sal (el id de la búsqueda): sirve para
// no volver a preguntar a quien ya está en él, sin decir a toda la cadena quién busca. Builds anteriores ponían el
// NEXO ID: se aceptan los dos.
function _pathTag(id, nx) {
  var s = String(id) + '|' + _nid(nx), h = 0x811c9dc5;
  for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return 'h' + h.toString(36);
}
function _inPath(path, id, nx) { return path.indexOf(_nid(nx)) >= 0 || path.indexOf(_pathTag(id, nx)) >= 0; }
function _plugin() { return (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.NexoBLE) || null; }

export class BleRelay {
  constructor(ble) {
    this.ble = ble;
    this.routes = new Map();     // destino → { via, hops, ts }
    this.neighbors = new Map();  // nexoId vecino → deviceId (enlace listo)
    this.queue = [];             // { id, kind: 'pkt'|'chat'|'file', dst, origin, data|ref, meta, prev, ts, tries }
    this.seen = new Map();       // id → ts (no reenviar dos veces lo mismo)
    this.capable = new Set();    // vecinos que entienden Jump (kx con j:1 o ya mandaron 'rt')
    this.nearby = new Map();     // nexoId → { deviceId, ts, rssi } (visto al escanear)
    this.transient = new Map();  // nexoId → { deviceId, since, lastUse } (conexiones de paso, no contactos)
    this.discoveries = new Map();// id → { dst, ts, sent: Set } (búsquedas propias)
    this._discoverAt = new Map();// dst → ts
    this._discoverWait = new Map();// dst → espera actual (crece mientras no aparezca camino)
    this.rqFrom = new Map();     // id → { deviceId, ts } (por dónde volver con la respuesta)
    this.power = { level: 100, charging: true, powerSave: false, ts: 0 };
    this.hopBps = DEFAULT_HOP_BPS;
    this._lastScanAt = 0;
    this._withdrawn = false;
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
    self._refreshPower();
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
    // Un enlace de paso que cae deja de contar (si no, no se volvía a conectar)
    prev.forEach(function(dev, nx) { if (!self.neighbors.has(nx)) { changed = true; self.transient.delete(nx); } });
    self.neighbors.forEach(function(dev, nx) {
      if (prev.has(nx)) return;
      changed = true;
      // Vecino (de nuevo) conectado que entiende Jump: preguntarle por las búsquedas pendientes
      if (self.capable.has(nx)) self.discoveries.forEach(function(d, id) { self._sendRq(id, d, nx, dev); });
    });
    // Rutas por un vecino que ya no está
    self.routes.forEach(function(r, d) { if (!self.neighbors.has(r.via)) { self.routes.delete(d); changed = true; } });
    if (changed) {
      self._scheduleAdvertise(300);
      self._onReachChanged();
    }
  }

  markCapable(nexoId) {
    var self = this;
    var nx = _nid(nexoId);
    if (!_isNx(nx) || self.capable.has(nx)) return;
    self.capable.add(nx);
    self._scheduleAdvertise(300);
    // Búsquedas pendientes: preguntarle también a este vecino nuevo
    var dev = self._computeNeighbors().get(nx);
    if (dev) self.discoveries.forEach(function(d, id) { self._sendRq(id, d, nx, dev); });
  }

  _scheduleAdvertise(ms) {
    var self = this;
    if (self._adTimer) return;
    self._adTimer = setTimeout(function() { self._adTimer = null; self._advertise(); }, ms || 1000);
  }

  _advertise() {
    var self = this, me = self.me();
    if (!me || !self.ble || typeof self.ble._sendMessageNative !== 'function') return;
    var relayOk = self.canRelay();
    self.neighbors.forEach(function(devX, x) {
      if (!self.capable.has(x)) return;
      var r = {};
      // Batería baja: no se ofrece como puente (anuncio vacío: los vecinos retiran las rutas por aquí)
      if (!relayOk) {
        self.ble._sendMessageNative(devX, JSON.stringify({ v: 1, type: 'rt', from: me, r: r, ts: Date.now() }), null).catch(function() {});
        return;
      }
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
    if (rt.nearby) return null; // a la vista pero sin conectar: _connectNearby
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
    self._refreshPower();
    self.neighbors = self._computeNeighbors();
    self.nearby.forEach(function(n, nx) { if (now - n.ts > NEARBY_TTL_MS) self.nearby.delete(nx); });
    self.discoveries.forEach(function(d, id) { if (now - d.ts > DISCOVER_WAIT_MS) self.discoveries.delete(id); });
    self.rqFrom.forEach(function(r, id) { if (now - r.ts > DISCOVER_WAIT_MS) self.rqFrom.delete(id); });
    self._closeIdleTransient();
    // Mensajes propios esperando sin camino: volver a buscar (con la espera creciente de discover)
    if (self.ble && typeof self.ble._lostPeersWithPending === 'function') {
      self.ble._lostPeersWithPending().then(function(list) { list.forEach(function(nx) { self.discover(nx); }); }).catch(function() {});
    }
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
    if (p.type === 'rq') { self._handleRq(p, deviceId); return true; }
    if (p.type === 'rp') { self._handleRp(p, deviceId); return true; }
    var to = _nid(p.to);
    if (!to || to === me || !_isNx(to)) return false;
    self._touch(deviceId);
    // Batería baja: no hace de puente para mensajes nuevos (sin custodia: el emisor buscará otro camino)
    var isMsg = p.type === 'chat' || p.type === 'sx'; // 'sx': sobre sellado (remitente oculto)
    if (isMsg && !self.canRelay()) { console.warn('[JUMP] Batería baja: no hago de puente para ' + p.msgId); return true; }
    // Paquete para otro teléfono: hacer de puente
    var hp = (Number(p.hp) || 0) + 1;
    var id = p.msgId || (p.type + ':' + (p.from || '') + ':' + (p.ts || ''));
    if (p.type === 'ack' || p.type === 'read_receipt') {
      // Un ack que pasa por aquí también confirma el salto que este teléfono hizo (custodia entregada)
      if (p.type === 'ack' && self.ble.ackSystem) self.ble.ackSystem.resolveHopQuiet(p.msgId);
    }
    if (hp > MAX_HOPS) { console.warn('[JUMP] Descartado (demasiados saltos): ' + id); return true; }
    var isChat = isMsg;
    if (isChat) self._sendCustody(deviceId, p.msgId);
    var key = p.type + ':' + id;
    if (self.seen.has(key)) return true;
    self.seen.set(key, Date.now());
    p.hp = hp;
    var item = { id: id, kind: 'pkt', reliable: isChat, dst: to, origin: _nid(p.from), data: JSON.stringify(p), prev: _mac(deviceId), ts: Date.now(), tries: 0 };
    console.log('[JUMP] Puente: ' + p.type + ' ' + id + (item.origin ? ' de ' + item.origin : '') + ' para ' + to + ' (salto ' + hp + ')');
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
    var sealed = String(meta.fr || '').indexOf('sx:') === 0;
    var item = { id: msgId, kind: kind, dst: to, origin: sealed ? '' : _nid(meta.fr), meta: m, ref: 'nexo_relay_' + String(msgId).replace(/[^A-Za-z0-9_]/g, '') + '.dat', prev: _mac(deviceId), ts: Date.now(), tries: 0 };
    console.log('[JUMP] Puente: ' + kind + ' ' + msgId + ' (' + Math.round(data.length / 1024) + ' KB)' + (item.origin ? ' de ' + item.origin : '') + ' para ' + to + ' (salto ' + hp + ')');
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
    // Sin camino: si está a la vista, conectar; si no, buscarlo (con espera creciente) y reintentar
    if (!hop) {
      if (self._seenRecently(item.dst)) self._connectNearby(item.dst);
      else if (item.origin === self.me() || self.canRelay()) self.discover(item.dst);
      return;
    }
    // Nunca de vuelta al teléfono del que llegó (evita bucles con rutas viejas)
    if (item.prev && _mac(hop.deviceId) === item.prev) return;
    self._touch(hop.deviceId);
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

  // ---------- vecindario (escaneo, sin conectarse) ----------
  noteSeen(nexoId, deviceId, rssi) {
    var nx = _nid(nexoId);
    if (!_isNx(nx) || nx === this.me() || !deviceId) return;
    var had = this.nearby.has(nx);
    this.nearby.set(nx, { deviceId: deviceId, ts: Date.now(), rssi: typeof rssi === 'number' ? rssi : -100 });
    // ¿Alguien esperaba camino hacia este teléfono?
    if (!had) this._connectNearbyIfWanted(nx);
  }

  _seenRecently(nx, maxAge) {
    var n = this.nearby.get(_nid(nx));
    return (n && Date.now() - n.ts < (maxAge || NEARBY_TTL_MS)) ? n : null;
  }

  _isContact(nx) {
    var cs = (this.ble && typeof this.ble.getBLEContacts === 'function') ? this.ble.getBLEContacts() : [];
    nx = _nid(nx);
    return cs.some(function(c) { return _nid(c.nexoId || c.deviceUUID) === nx; });
  }

  // Escaneo corto (filtrado a NEXO con la pantalla apagada). Resuelve al terminar.
  _scan() {
    var self = this, ble = self.ble;
    if (Date.now() - self._lastScanAt < SCAN_FRESH_MS) return Promise.resolve(false);
    self._lastScanAt = Date.now();
    if (!ble || typeof ble._autoScanForKnownContacts !== 'function') return Promise.resolve(false);
    var hidden = typeof document !== 'undefined' && document.visibilityState === 'hidden';
    ble._relayScan = true;
    ble._autoScanForKnownContacts({ filtered: hidden });
    return new Promise(function(r) { setTimeout(function() { ble._relayScan = false; r(true); }, SCAN_MS); });
  }

  // ---------- conexiones de paso (teléfonos que no son contactos) ----------
  _connect(nx, deviceId) {
    var self = this, ble = self.ble;
    if (!deviceId || !ble || !ble.nativePlugin) return false;
    if (self._isReady(deviceId) || self.neighbors.has(nx)) return true;
    var isContact = self._isContact(nx);
    if (!isContact) {
      var t = self.transient.get(nx);
      if (t && Date.now() - t.since < 15000) return true; // conectando
      if (t) self.transient.delete(nx);
      if (self.transient.size >= MAX_TRANSIENT) self._closeIdleTransient(true);
      if (self.transient.size >= MAX_TRANSIENT) return false;
      self.transient.set(nx, { deviceId: deviceId, since: Date.now(), lastUse: Date.now() });
    }
    console.log('[JUMP] Conectando con ' + nx + (isContact ? '' : ' (no es contacto, de paso)'));
    var pl = ble.nativePlugin;
    if (pl && typeof pl.connectToDevice === 'function') pl.connectToDevice({ deviceId: deviceId }).catch(function() {});
    return true;
  }

  _touch(deviceId) {
    var nx = _nid(this.ble && this.ble._macToNexoId && this.ble._macToNexoId.get(_mac(deviceId)));
    var t = nx && this.transient.get(nx);
    if (t) t.lastUse = Date.now();
  }

  _closeIdleTransient(force) {
    var self = this, now = Date.now(), pl = self.ble && self.ble.nativePlugin;
    var list = Array.from(self.transient.entries()).sort(function(a, b) { return a[1].lastUse - b[1].lastUse; });
    list.forEach(function(e) {
      var nx = e[0], t = e[1];
      if (now - t.lastUse < TRANSIENT_IDLE_MS && !(force && self.transient.size >= MAX_TRANSIENT && now - t.lastUse > 10000)) return;
      // Si algo de la cola va por él, se mantiene
      var busy = self.queue.some(function(q) { var r = self.routes.get(q.dst); return q.dst === nx || (r && r.via === nx); });
      if (busy && !force) return;
      self.transient.delete(nx);
      console.log('[JUMP] Cierro conexión de paso con ' + nx + ' (sin uso)');
      if (pl && typeof pl.disconnectDevice === 'function') pl.disconnectDevice({ deviceId: t.deviceId }).catch(function() {});
    });
  }

  _connectNearby(dst) {
    var nx = _nid(dst);
    var n = this._seenRecently(nx);
    if (n) this._connect(nx, n.deviceId);
  }

  _connectNearbyIfWanted(nx) {
    var self = this;
    var wanted = self.queue.some(function(q) { return q.dst === nx; });
    self.discoveries.forEach(function(d) { if (d.dst === nx) wanted = true; });
    if (wanted) self._connectNearby(nx);
  }

  // ---------- batería ----------
  _refreshPower() {
    var self = this, pl = _plugin();
    if (!pl || typeof pl.getPowerStatus !== 'function' || Date.now() - self.power.ts < 60000) return;
    self.power.ts = Date.now();
    pl.getPowerStatus().then(function(r) {
      if (!r) return;
      var was = self.canRelay();
      self.power = { level: Number(r.level), charging: !!r.charging, powerSave: !!r.powerSave, ts: Date.now() };
      var now = self.canRelay();
      if (was !== now) {
        console.log('[JUMP] ' + (now ? 'Vuelvo a hacer de puente' : 'Batería baja (' + r.level + ' %' + (r.powerSave ? ', ahorro' : '') + '): dejo de hacer de puente'));
        self._advertise();
      }
    }).catch(function() {});
  }

  canRelay() {
    var p = this.power;
    if (p.powerSave) return false;
    return p.charging || !(p.level >= 0) || p.level >= LOW_BATTERY_PCT;
  }

  // ---------- búsqueda de camino bajo demanda ----------
  // Llamar cuando un mensaje propio no tiene enlace directo ni ruta
  discover(dst, force) {
    var self = this, d = _nid(dst), now = Date.now();
    if (!_isNx(d) || d === self.me()) return;
    if (self.nextHop(d)) return;
    // Visto hace nada: lo más cercano es ir directo; si en 8 s no hay enlace, se busca puente
    if (!force && self._seenRecently(d, NEARBY_FRESH_MS)) {
      self._connectNearby(d);
      if (!self._directTry) self._directTry = {};
      if (!self._directTry[d]) {
        self._directTry[d] = setTimeout(function() { delete self._directTry[d]; if (!self.nextHop(d)) self.discover(d, true); }, 8000);
      }
      return;
    }
    var wait = self._discoverWait.get(d) || DISCOVER_THROTTLE_MS;
    if (now - (self._discoverAt.get(d) || 0) < wait) return;
    self._discoverAt.set(d, now);
    // Espera creciente mientras no aparezca camino (45 s, 90 s, 3 min… máx. 10 min): no gastar batería
    self._discoverWait.set(d, Math.min(600000, wait * 2));
    var id = 'q' + now.toString(36) + Math.random().toString(36).substr(2, 5);
    var disc = { dst: d, ts: now, sent: new Set(), ttl: MAX_HOPS - 1, path: [_pathTag(id, self.me())] };
    self.discoveries.set(id, disc);
    self.seen.set('rq:' + id, now);
    console.log('[JUMP] Buscando camino hacia ' + d);
    self._scan().then(function() { self._spreadRq(id, disc); });
    // Vecinos ya conectados: sin esperar al escaneo
    self._spreadRq(id, disc, true);
  }

  // Pregunta a vecinos conectados que entienden Jump y, si hace falta, conecta con cercanos
  _spreadRq(id, disc, connectedOnly) {
    var self = this;
    if (!self.discoveries.has(id) && !self.rqFrom.has(id)) return;
    // ¿El destino está a la vista? Conectar directo (no hace falta puente)
    if (self._seenRecently(disc.dst)) { self._connectNearby(disc.dst); }
    self.neighbors = self._computeNeighbors();
    self.neighbors.forEach(function(dev, nx) { if (!_inPath(disc.path, id, nx)) self._sendRq(id, disc, nx, dev); });
    if (connectedOnly) return;
    var cands = [];
    self.nearby.forEach(function(n, nx) {
      if (nx === disc.dst || _inPath(disc.path, id, nx) || self.neighbors.has(nx) || Date.now() - n.ts > NEARBY_TTL_MS) return;
      cands.push({ nx: nx, n: n });
    });
    cands.sort(function(a, b) { return b.n.rssi - a.n.rssi; });
    cands.slice(0, MAX_TRANSIENT).forEach(function(c) { self._connect(c.nx, c.n.deviceId); });
  }

  _sendRq(id, disc, nx, dev) {
    var self = this;
    if (!self.capable.has(nx) || disc.sent.has(nx) || nx === disc.dst || _inPath(disc.path, id, nx)) return;
    disc.sent.add(nx);
    self._touch(dev);
    var pkt = { v: 1, type: 'rq', id: id, from: self.me(), dst: disc.dst, ttl: disc.ttl, path: disc.path };
    self.ble._sendMessageNative(dev, JSON.stringify(pkt), null).catch(function() {});
  }

  _handleRq(p, deviceId) {
    var self = this, me = self.me(), now = Date.now();
    var id = String(p.id || ''), d = _nid(p.dst), from = _nid(p.from);
    if (!id || !_isNx(d) || self.seen.has('rq:' + id)) return;
    self.seen.set('rq:' + id, now);
    self._touch(deviceId);
    if (from) self.capable.add(from);
    if (d !== me && !self.canRelay()) return; // batería baja: no hago de puente
    self.rqFrom.set(id, { deviceId: deviceId, ts: now });
    var hops = self._distanceTo(d);
    if (hops !== null) { self._sendRp(id, d, hops, deviceId); return; }
    var ttl = Number(p.ttl) || 0;
    if (ttl <= 1) return;
    var path = (Array.isArray(p.path) ? p.path : []).map(_nid).concat([_pathTag(id, me)]).slice(0, MAX_HOPS + 1);
    var disc = { dst: d, ts: now, sent: new Set(), ttl: ttl - 1, path: path };
    // Escanear (si hace falta) por si el destino está cerca de aquí; si no, preguntar más allá
    self._scan().then(function() {
      var h = self._distanceTo(d);
      if (h !== null) { self._sendRp(id, d, h, deviceId); return; }
      self.discoveries.set(id, disc);
      self._spreadRq(id, disc);
    });
    self.discoveries.set(id, disc);
    self._spreadRq(id, disc, true);
  }

  // Saltos desde aquí hasta d (null si no se sabe)
  _distanceTo(d) {
    var me = this.me();
    if (d === me) return 0;
    var h = this.nextHop(d);
    if (h) return h.hops;
    if (this._seenRecently(d, NEARBY_FRESH_MS)) {
      // A la vista hace nada: ruta "cercana" (se conecta al usarla)
      this.routes.set(d, { via: d, hops: 1, ts: Date.now(), nearby: true });
      return 1;
    }
    return null;
  }

  _sendRp(id, d, hops, deviceId) {
    var pkt = { v: 1, type: 'rp', id: id, from: this.me(), dst: d, hops: hops };
    this._touch(deviceId);
    this.ble._sendMessageNative(deviceId, JSON.stringify(pkt), null).catch(function() {});
  }

  _handleRp(p, deviceId) {
    var self = this, now = Date.now();
    var id = String(p.id || ''), d = _nid(p.dst), via = _nid(p.from), hops = (Number(p.hops) || 0) + 1;
    if (!id || !_isNx(d) || !_isNx(via) || hops > MAX_HOPS) return;
    self._touch(deviceId);
    self.capable.add(via);
    self.neighbors = self._computeNeighbors();
    if (!self.neighbors.has(via)) return;
    var cur = self.routes.get(d);
    if (!cur || cur.nearby || hops < cur.hops || now - cur.ts > ROUTE_TTL_MS) self.routes.set(d, { via: via, hops: hops, ts: now });
    var back = self.rqFrom.get(id);
    if (self.discoveries.has(id) && !back) {
      console.log('[JUMP] Camino hacia ' + d + ': por ' + via + ' (' + hops + ' saltos)');
      self._discoverWait.delete(d);
      self.discoveries.delete(id);
      self._scheduleAdvertise(300);
      self._onReachChanged([d]);
      return;
    }
    self.discoveries.delete(id);
    if (back) { self.rqFrom.delete(id); self._sendRp(id, d, hops, back.deviceId); }
  }

  // ---------- selector de camino ----------
  // Reglas del dueño: lo más cercano primero (menos exposición a terceros), con sentido común por
  // velocidad. Textos: directo → Jump. Archivos: directo → (Wi-Fi Direct / Wi-Fi, futuros) → Jump. Datos
  // móviles, último recurso (cuestan dinero). Devuelve { via: 'direct'|'jump'|'none', hops, etaS }.
  plan(dst, kind, bytes) {
    var h = this.nextHop(dst);
    if (h && h.direct) return { via: 'direct', hops: 1, etaS: Math.round((bytes || 0) / this.hopBps) };
    if (h) {
      var eta = Math.round((bytes || 0) / this.hopBps * h.hops);
      if (kind !== 'text' && eta > 120) console.log('[JUMP] ' + kind + ' por Jump (' + h.hops + ' saltos): ~' + Math.round(eta / 60) + ' min (no hay otro camino)');
      return { via: 'jump', hops: h.hops, etaS: eta };
    }
    return { via: 'none', hops: 0, etaS: null };
  }

  // Velocidad medida de un flujo terminado (bytes por segundo en un salto)
  noteSpeed(bytes, ms) {
    if (!(bytes > 20000) || !(ms > 0)) return;
    var bps = bytes * 1000 / ms;
    this.hopBps = Math.round(this.hopBps * 0.7 + bps * 0.3);
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
