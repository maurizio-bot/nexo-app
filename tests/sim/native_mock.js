// Simulador de NexoBlePlugin.kt (plugins/nexo-ble) para pruebas virtuales con dos "teléfonos".
// Replica la semántica del Kotlin: campos que lee cada método, chunking por MTU,
// reensamblado de JSON en processReceivedChunk y orden/forma de los eventos.
'use strict';

const norm = (mac) => String(mac || '').replace(/[:\-.]/g, '').toLowerCase();
const classify = (id) => {
  const t = String(id || '').trim();
  if (!t) return 'empty';
  if (t.length === 10 && /^nx/i.test(t) && /^[a-z0-9]+$/i.test(t.substring(2))) return 'nxid';
  const c = norm(t);
  if (c.length === 12 && /^[0-9a-f]+$/.test(c)) return 'mac';
  return 'invalid';
};

class Radio {
  constructor() { this.phones = []; this.trace = []; this.blocked = new Set(); }
  add(p) { this.phones.push(p); p.radio = this; }
  // Alcance (jump): por defecto todos se ven; block(a, b) los deja fuera de alcance entre sí (cae la
  // conexión que tuvieran, no se ven al escanear, no conectan y lo escrito se pierde)
  _key(a, b) { return [a.name, b.name].sort().join('|'); }
  inRange(a, b) { return !a || !b || !this.blocked.has(this._key(a, b)); }
  block(a, b) {
    this.blocked.add(this._key(a, b));
    [[a, b], [b, a]].forEach(([x, y]) => {
      if (x.clients.has(norm(y.address))) { x.clients.delete(norm(y.address)); x.emit('onDeviceDisconnected', { deviceId: y.address }); }
      if (x.serverConnected.has(norm(y.initAddress))) { x.serverConnected.delete(norm(y.initAddress)); x.serverNotif.delete(norm(y.initAddress)); x.emit('onDeviceDisconnected', { deviceId: y.initAddress }); }
      x.buffers.delete(norm(y.address)); x.buffers.delete(norm(y.initAddress));
    });
  }
  unblock(a, b) { this.blocked.delete(this._key(a, b)); }
  byNorm(mac) { return this.phones.find((p) => norm(p.address) === norm(mac)); }
  log(...a) { this.trace.push(a.join(' ')); }
}

class NativePhone {
  // opts.readsContentFallback: true si el Kotlin incluye `?: call.getString("content")`
  constructor(name, address, opts = {}) {
    this.name = name;
    this.address = address; // dirección de anuncio: la que se ve al escanear y a la que se conectan
    // Dirección con la que ESTE teléfono aparece cuando se conecta como cliente a otro. En Android real
    // suele ser distinta de la de anuncio (direcciones aleatorias por conjunto de anuncio).
    this.initAddress = opts.asymmetric ? address.replace(/..$/, (b) => ((parseInt(b, 16) ^ 0x80).toString(16).toUpperCase().padStart(2, '0'))) : address;
    this.opts = opts;
    this.listeners = new Map();
    this.files = new Map();
    this.advertisingId = null;
    this.serviceRunning = false;
    this.clients = new Map(); // macNorm -> { state, peer }
    this.serverConnected = new Map(); // macNorm -> peer
    this.serverNotif = new Map(); // macNorm -> bool
    this.mtu = new Map(); // macNorm -> mtu
    this.buffers = new Map(); // macNorm -> string (processReceivedChunk)
    this.pendingQueue = new Map(); // macNorm -> [msg] (Kotlin pendingMessageQueue)
    this.sent = []; // registro de lo que salió por el aire
    this.calls = []; // registro de llamadas JS -> nativo
    this.stats = { saves: 0, saveBytes: 0, maxSave: 0 }; // coste de persistencia (cruza el bridge)
  }

  emit(event, data) {
    const cbs = this.listeners.get(event) || [];
    // Capacitor (Plugin.notifyListeners): sin listener JS el evento se DESCARTA, salvo que el nativo lo
    // emita con retainUntilConsumed=true (opts.retain = lista de eventos que el Kotlin retiene).
    if (!cbs.length) {
      this.stats.droppedEvents = (this.stats.droppedEvents || 0) + (this.opts.retain && this.opts.retain.includes(event) ? 0 : 1);
      if (this.opts.retain && this.opts.retain.includes(event)) {
        if (!this.retained) this.retained = new Map();
        if (!this.retained.has(event)) this.retained.set(event, []);
        this.retained.get(event).push(data);
      } else if (event === 'onPayloadReceived') this.radio.log(this.name, 'EVENTO PERDIDO sin listener', event, String(data.content).substring(0, 60));
      return;
    }
    // Capacitor entrega eventos de forma asíncrona por el bridge
    setTimeout(() => cbs.forEach((cb) => { try { cb(JSON.parse(JSON.stringify(data))); } catch (e) { this.radio.log(this.name, 'listener error', event, e.message); } }), 0);
  }

  // ---- ciclo de vida de la actividad (cerrar / reabrir la app) ----
  // handleOnDestroy de Kotlin: cleanupAllConnections + stopGattServer. El BleService (foreground) sigue
  // anunciando con el último NEXO ID. Los demás ven caer sus conexiones con este teléfono.
  destroyActivity() {
    this.destroyed = true;
    this.serverUp = false;
    this.listeners = new Map();
    this.retained = new Map();
    const meAdv = norm(this.address), meInit = norm(this.initAddress);
    this.radio.phones.forEach((p) => {
      if (p === this) return;
      // Radio real: el otro no se entera hasta que vence el supervision timeout (opts.supervisionMs);
      // mientras, sus escrituras "salen" bien pero se pierden (ver _processReceivedChunk).
      p._dropLinkLater(meAdv, this.address, meInit, this.initAddress);
      this.clients.delete(norm(p.address)); this.serverConnected.delete(norm(p.initAddress)); this.serverNotif.delete(norm(p.initAddress));
    });
    this.pendingQueue.clear(); this.buffers.clear(); this.writeQ = new Map();
  }

  // Lectura/escritura de archivo: el Kotlin la hace en el hilo del plugin (en orden de llamada) y la
  // respuesta vuelve por el bridge unos ms después (opts.ioDelay). Con 0 responde al instante.
  _io(fn) { if (this.opts.ioDelay) setTimeout(fn, this.opts.ioDelay); else fn(); }

  _dropLinkLater(advNorm, advAddr, initNorm, initAddr) {
    const drop = () => {
      if (this.clients.has(advNorm)) { this.clients.delete(advNorm); this.emit('onDeviceDisconnected', { deviceId: advAddr }); }
      if (this.serverConnected.has(initNorm)) { this.serverConnected.delete(initNorm); this.serverNotif.delete(initNorm); this.emit('onDeviceDisconnected', { deviceId: initAddr }); }
    };
    if (this.opts.supervisionMs) setTimeout(drop, this.opts.supervisionMs); else drop();
  }

  // Volver a la app / pasar a segundo plano (Activity onResume/onPause). Solo el Kotlin nuevo lo avisa
  // al JS (opts.appStateEvents); el JS ve además visibilitychange si el WebView lo emite.
  setAppActive(active) {
    this.appActive = !!active;
    if (this.opts.appStateEvents) this.emit('onAppStateChange', { isActive: !!active });
  }

  // ---- ciclo de vida (Kotlin load(): autoStartGattServerAndAdvertising) ----
  load() {
    // Android reinicia el anuncio al reabrir la app: dirección aleatoria nueva (opts.rotateOnRestart)
    if (this.destroyed && this.opts.rotateOnRestart) {
      this.restarts = (this.restarts || 0) + 1;
      const hex = (n) => n.toString(16).toUpperCase().padStart(2, '0');
      this.address = this.address.replace(/..:..$/, hex(0x40 + this.restarts) + ':' + hex(0x10 + this.restarts));
      this.initAddress = this.opts.asymmetric ? this.address.replace(/..$/, (b) => hex(parseInt(b, 16) ^ 0x80)) : this.address;
    }
    this.destroyed = false;
    this.serviceRunning = true; this.serverUp = true;
  }

  // Kotlin remLog(): se registra cada trozo enviado y recibido y cada sendMessage. Hasta la 2722 todos hacían
  // notifyListeners("onRemLog") (opts.remLogAll); desde la 2723 solo AT_REST y FILE_IO. Con un listener en JS,
  // cada aviso cruza el puente al WebView.
  _remLog(level, tag, message) {
    this.stats.remLogs = (this.stats.remLogs || 0) + 1;
    if (!this.opts.remLogAll && tag !== 'AT_REST' && tag !== 'FILE_IO') return;
    if ((this.listeners.get('onRemLog') || []).length) { this.stats.remLogsToJs = (this.stats.remLogsToJs || 0) + 1; this.emit('onRemLog', { level, tag, message, timestamp: Date.now() }); }
  }

  // ---- envío al aire ----
  _air(fromAddress, toPhone, bytes, source) {
    // Cola por enlace como processWriteQueue de Kotlin: una escritura cada 40 ms (cliente) u 80 ms
    // (notify de servidor). Con opts.realTiming=false entrega casi inmediata.
    // opts.pace = [ms por write de cliente, ms por notify de servidor]. Por defecto el Kotlin antiguo
    // (40/80 fijos); con control de flujo por callback el ritmo lo marca la radio (p.ej. 15/15).
    const pace = this.opts.pace || [40, 80];
    let delay = this.opts.realTiming === false ? 1 : (source === 'gatt_client' ? pace[1] : pace[0]);
    // Radio real: escanear comparte el tiempo de radio con las conexiones (opts.scanPenalty, p.ej. 1.6)
    if (this.opts.scanPenalty && (this.scanningUntil || 0) > Date.now()) { delay = Math.round(delay * this.opts.scanPenalty); this.stats.slowWrites = (this.stats.slowWrites || 0) + 1; }
    if (!this.writeQ) this.writeQ = new Map();
    const key = norm(toPhone.address);
    if (!this.writeQ.has(key)) this.writeQ.set(key, { items: [], busy: false });
    const q = this.writeQ.get(key);
    // Pérdida simulada (radio real): se pierde la escritura entera
    if (this.opts.loss && Math.random() < this.opts.loss) { this.stats.lost = (this.stats.lost || 0) + 1; return; }
    // Kotlin MAX_QUEUE_SIZE = 500: con la cola llena descarta
    if (q.items.length >= 500) { this.stats.dropped = (this.stats.dropped || 0) + 1; return; }
    q.items.push(() => toPhone._processReceivedChunk(fromAddress, bytes, source));
    this.stats.maxQueue = Math.max(this.stats.maxQueue || 0, q.items.length);
    if (/"t":"ba"/.test(bytes)) this.stats.acksOut = (this.stats.acksOut || 0) + 1; else if (/"t":"f"/.test(bytes)) this.stats.chunksOut = (this.stats.chunksOut || 0) + 1;
    const pump = () => {
      if (!q.items.length) { q.busy = false; return; }
      q.busy = true;
      const fn = q.items.shift();
      // Un error al entregar no debe dejar la cola de ese enlace parada para siempre
      setTimeout(() => { try { fn(); } catch (e) { this.radio.log(this.name, 'ERROR entregando', e && e.stack); (this.stats.deliverErrors = (this.stats.deliverErrors || 0) + 1); } setTimeout(pump, delay); }, 10);
    };
    if (!q.busy) pump();
  }

  _sendSingleChunk(macNorm, chunk) {
    // 1. Servidor (notify) si el otro está conectado a nosotros como cliente y activó notificaciones
    const srvPeer = this.serverConnected.get(macNorm);
    if (srvPeer && this.serverNotif.get(macNorm)) {
      this.sent.push({ to: macNorm, chunk, mode: 'gatt_server' });
      this._remLog('INFO', 'SEND', 'GATT Server chunk sent to ' + macNorm + ' len=' + chunk.length);
      this._air(this.address, srvPeer, chunk, 'gatt_client'); // notify: el cliente nos ve por la dirección de anuncio
      return { sent: true, mode: 'gatt_server' };
    }
    // 2. Cliente (write) si estamos conectados como cliente
    const cl = this.clients.get(macNorm);
    if (cl && cl.state === 'connected' && cl.rxReady) {
      this.sent.push({ to: macNorm, chunk, mode: 'gatt_client' });
      this._remLog('INFO', 'SEND', 'GATT Client chunk sent (NO_RESPONSE) to ' + macNorm + ' len=' + chunk.length);
      this._air(this.initAddress, cl.peer, chunk, 'gatt_server'); // write: el servidor nos ve por la de iniciador
      return { sent: true, mode: 'gatt_client' };
    }
    return { sent: false, mode: '' };
  }

  _sendChunkedOrSingle(macNorm, message) {
    const mtu = this.mtu.get(macNorm) || 23;
    const size = Math.max(mtu - 3 - 10, 20);
    if (message.length <= size) return this._sendSingleChunk(macNorm, message);
    const chunks = [];
    for (let i = 0; i < message.length; i += size) chunks.push(message.substring(i, i + size));
    const first = this._sendSingleChunk(macNorm, chunks[0]);
    if (!first.sent) return { sent: false, mode: '' };
    chunks.slice(1).forEach((c) => this._sendSingleChunk(macNorm, c));
    return { sent: true, mode: first.mode };
  }

  // ---- recepción (Kotlin processReceivedChunk + tryExtractCompleteJson) ----
  _processReceivedChunk(fromAddress, chunk, source) {
    const sender = this.radio.phones.find((p) => norm(p.address) === norm(fromAddress) || norm(p.initAddress) === norm(fromAddress));
    if (this.offline || this.serverUp === false || (sender && sender.offline) || (sender && !this.radio.inRange(this, sender))) { this.stats.voidWrites = (this.stats.voidWrites || 0) + 1; return; }
    const mac = norm(fromAddress);
    this._remLog('INFO', source === 'gatt_client' ? 'GATT_CLIENT_CB' : 'GATT_SERVER', 'RX chunk from ' + mac + ': len=' + chunk.length);
    let buf = (this.buffers.get(mac) || '') + chunk;
    for (;;) {
      const ex = extractJson(buf);
      if (!ex) break;
      this.radio.log(this.name, 'RX de', fromAddress, ex.json.substring(0, 90));
      this.emit('onPayloadReceived', { deviceId: fromAddress, content: ex.json, data: ex.json, source, timestamp: Date.now(), reassembled: true });
      buf = ex.rest;
    }
    if (buf) this.buffers.set(mac, buf); else this.buffers.delete(mac);
  }

  // ---- fuera de alcance (simula alejarse) ----
  setOffline(off) {
    this.offline = off;
    if (!off) return;
    this.radio.phones.forEach((p) => {
      if (p === this) return;
      const drop = (holder, otherAddr) => { holder.emit('onDeviceDisconnected', { deviceId: otherAddr }); holder.buffers.delete(norm(otherAddr)); };
      p._dropLinkLater(norm(this.address), this.address, norm(this.initAddress), this.initAddress);
      if (this.clients.has(norm(p.address))) { this.clients.delete(norm(p.address)); drop(this, p.address); }
      if (this.serverConnected.has(norm(p.initAddress))) { this.serverConnected.delete(norm(p.initAddress)); this.serverNotif.delete(norm(p.initAddress)); drop(this, p.initAddress); }
    });
  }

  // ---- conexión ----
  _connectClient(peer, call) {
    const macNorm = norm(peer.address);
    this.clients.set(macNorm, { state: 'connecting', peer, rxReady: false });
    setTimeout(() => {
      const cl = this.clients.get(macNorm);
      if (!cl) return;
      cl.state = 'connected';
      if (call) call.resolve({ connected: true, alreadyConnected: false, deviceId: peer.address });
      this.emit('onDeviceConnected', { deviceId: peer.address, direction: 'outgoing', role: 'client', servicesReady: false });
      // Lado servidor del otro teléfono (solo si su servidor GATT está abierto)
      if (peer.serverUp !== false) {
        peer.serverConnected.set(norm(this.initAddress), this);
        peer.emit('onDeviceConnected', { deviceId: this.initAddress, direction: 'incoming', role: 'server', servicesReady: true });
      }
      // onServicesDiscovered -> requestMtu + escritura CCCD
      setTimeout(() => {
        if (peer.serverUp === false) {
          // Kotlin: "NEXO service not found" -> onConnectionFailed; la conexión GATT queda abierta sin rx
          // (salvo que el Kotlin la cierre: opts.closeOnNoService)
          this.emit('onConnectionFailed', { deviceId: peer.address, reason: 'NEXO service not found' });
          if (this.opts.closeOnNoService) {
            this.clients.delete(macNorm); peer.serverConnected.delete(norm(this.initAddress));
            this.emit('onDeviceDisconnected', { deviceId: peer.address });
          }
          return;
        }
        cl.rxReady = true;
        this.emit('onServicesReady', { deviceId: peer.address, servicesReady: true });
        this._flushPending(macNorm);
        setTimeout(() => {
          const mtu = this.opts.mtu || 512;
          this.mtu.set(macNorm, mtu); peer.mtu.set(norm(this.initAddress), mtu);
          peer.serverNotif.set(norm(this.initAddress), true);
          this.emit('onNotificationsEnabled', { deviceId: peer.address, notificationsEnabled: true });
        }, 40);
      }, 40);
    }, 60);
  }

  _flushPending(macNorm) {
    const q = this.pendingQueue.get(macNorm);
    if (!q) return;
    this.pendingQueue.delete(macNorm);
    q.forEach((m) => this._sendChunkedOrSingle(macNorm, m));
  }

  _resolveMac(raw) {
    const t = classify(raw);
    if (t === 'nxid') {
      const p = this.radio.phones.find((x) => x !== this && x.advertisingId && x.advertisingId.toLowerCase() === String(raw).trim().toLowerCase());
      return p ? norm(p.address) : null;
    }
    return norm(raw);
  }

  // ---- API del plugin (nombres = @PluginMethod de Kotlin) ----
  plugin() {
    const self = this;
    // opts.pluginThread = ms por MB: como Capacitor, todas las llamadas en UN hilo y en fila; guardar/leer un
    // archivo lo ocupa según su tamaño (en el teléfono: escribir/leer + cifrar). opts.ioOffThread: Kotlin 2721+,
    // los archivos van en sus propios hilos (adjuntos aparte) y no hacen esperar a sendMessage.
    const FILE_OPS = { saveToFile: 1, loadFromFile: 1, deleteFile: 1 };
    const lane = (name, args) => {
      if (!FILE_OPS[name] || !self.opts.ioOffThread) return 'plugin';
      return /^nexo_(att|relay)_/.test(String(args.filename || '')) ? 'io_big' : 'io_small';
    };
    const cost = (name, args) => {
      if (!FILE_OPS[name]) return 0;
      const len = name === 'saveToFile' ? String(args.content || '').length : String(self.files.get(args.filename) || '').length;
      return 1 + (len / 1e6) * self.opts.pluginThread;
    };
    self.lanes = self.lanes || {};
    const wrap = (name, fn) => (args = {}) => {
      self.calls.push({ name, args: JSON.parse(JSON.stringify(args || {})) });
      const run = (resolve, reject) => {
        const call = { resolve, reject: (msg, code) => { const e = new Error(msg); e.code = code; reject(e); }, getString: (k) => (args && typeof args[k] === 'string' ? args[k] : null) };
        try { fn(call, args || {}); } catch (e) { reject(e); }
      };
      if (!self.opts.pluginThread) return new Promise(run);
      return new Promise((resolve, reject) => {
        const l = lane(name, args || {}), t0 = Date.now();
        self.lanes[l] = (self.lanes[l] || Promise.resolve()).then(() => new Promise((done) => {
          if (name === 'sendMessage') { const w = Date.now() - t0; self.stats.sendWaits = self.stats.sendWaits || []; self.stats.sendWaits.push(w); }
          setTimeout(() => { run(resolve, reject); done(); }, cost(name, args || {}));
        }));
      });
    };
    const api = {
      addListener(event, cb) {
        if (!self.listeners.has(event)) self.listeners.set(event, []);
        self.listeners.get(event).push(cb);
        // sendRetainedArgumentsForEvent: al llegar el primer listener se entregan los retenidos
        const ret = self.retained && self.retained.get(event);
        if (ret && ret.length) { self.retained.delete(event); ret.forEach((d) => self.emit(event, d)); }
        const handle = { remove: () => { const l = self.listeners.get(event) || []; const i = l.indexOf(cb); if (i >= 0) l.splice(i, 1); return Promise.resolve(); } };
        const p = Promise.resolve(handle);
        p.remove = handle.remove;
        return p;
      },
      checkBLEStatus: wrap('checkBLEStatus', (c) => c.resolve({ allGranted: true, scanGranted: true, connectGranted: true, advertiseGranted: true, locationGranted: true, notificationsGranted: true, foregroundConnectedGranted: true, serverReady: true })),
      initializeBLE: wrap('initializeBLE', (c) => { self.emit('onServerReady', { ready: true, source: 'permissions_already_granted' }); c.resolve({ granted: true }); }),
      isBluetoothEnabled: wrap('isBluetoothEnabled', (c) => c.resolve({ enabled: true, canAdvertise: self.serviceRunning, serverReady: true })),
      isAdvertising: wrap('isAdvertising', (c) => c.resolve({ isAdvertising: self.serviceRunning })),
      startAdvertising: wrap('startAdvertising', (c) => { self.serviceRunning = true; c.resolve({ started: true }); }),
      stopAdvertising: wrap('stopAdvertising', (c) => { self.serviceRunning = false; c.resolve({ stopped: true }); }),
      setAdvertisingData: wrap('setAdvertisingData', (c, a) => { const id = c.getString('nexoId'); if (!id) return c.reject('nexoId requerido'); self.advertisingId = id; self.serviceRunning = true; c.resolve({ set: true, nexoId: id }); }),
      getLocalDeviceInfo: wrap('getLocalDeviceInfo', (c) => c.resolve({ deviceName: self.name, deviceAddress: '' })),
      startScan: wrap('startScan', (c, a) => {
        c.resolve({ started: true });
        // Android 8.1+: con la pantalla apagada un escaneo sin filtro no entrega resultados
        if (self.appActive === false && !(a && a.filtered)) { self.stats.screenOffScans = (self.stats.screenOffScans || 0) + 1; return; }
        // Android: más de 5 startScan en 30 s => el sistema no entrega resultados (sin error)
        const now = Date.now();
        self.scanStarts = (self.scanStarts || []).filter((t) => now - t < 30000);
        self.scanStarts.push(now);
        self.stats.scans = (self.stats.scans || 0) + 1;
        self.scanningUntil = now + 6000;
        if (self.opts.scanThrottle && self.scanStarts.length > 5) { self.stats.throttledScans = (self.stats.throttledScans || 0) + 1; return; }
        setTimeout(() => self.radio.phones.forEach((p) => {
          if (p === self || p.offline || !p.serviceRunning || !p.advertisingId || !self.radio.inRange(self, p)) return;
          if (self.opts.scanMiss && Math.random() < self.opts.scanMiss) { self.stats.scanMisses = (self.stats.scanMisses || 0) + 1; return; }
          self.emit('onDeviceFound', { deviceId: p.address, name: p.name, rssi: -50, nexoId: p.advertisingId });
        }), 80);
      }),
      stopScan: wrap('stopScan', (c) => { self.scanningUntil = 0; c.resolve({ stopped: true }); }),
      connectToDevice: wrap('connectToDevice', (c) => {
        const raw = c.getString('deviceId') || c.getString('address') || '';
        if (!raw) return c.reject('deviceId requerido', 'INVALID_DEVICE_ID');
        if (classify(raw) === 'invalid') return c.reject('ID invalido: no es NXID ni MAC', 'INVALID_DEVICE_ID');
        const mac = self._resolveMac(raw);
        if (!mac) return c.reject('NXID no resuelto a MAC: ' + raw, 'NXID_UNRESOLVED');
        const cl = self.clients.get(mac);
        if (cl && cl.state === 'connecting') return c.resolve({ connected: false, error: 'Connection already in progress', deviceId: raw });
        if (cl && cl.state === 'connected') return c.resolve({ connected: true, alreadyConnected: true, deviceId: raw });
        const peer = self.radio.byNorm(mac);
        if (!peer || peer.offline || self.offline || !self.radio.inRange(self, peer)) { setTimeout(() => { c.resolve({ connected: false, deviceId: raw, error: 'Connection error 133' }); }, 200); return; }
        self._connectClient(peer, c);
      }),
      disconnectDevice: wrap('disconnectDevice', (c) => {
        const raw = c.getString('deviceId') || '';
        if (!raw) return c.reject('deviceId requerido');
        const mac = self._resolveMac(raw) || raw.toLowerCase();
        const cl = self.clients.get(mac);
        if (cl) { self.clients.delete(mac); cl.peer.serverConnected.delete(norm(self.initAddress)); cl.peer.serverNotif.delete(norm(self.initAddress)); cl.peer.emit('onDeviceDisconnected', { deviceId: self.initAddress }); }
        self.pendingQueue.delete(mac);
        self.emit('onDeviceDisconnected', { deviceId: raw });
        c.resolve({ disconnected: true });
      }),
      forceReconnect: wrap('forceReconnect', (c) => c.resolve({ reconnecting: true })),
      reconnectDevice: wrap('reconnectDevice', (c) => c.resolve({ reconnecting: true })),
      sendMessage: wrap('sendMessage', (c) => {
        const raw = c.getString('deviceId') || '';
        let message = c.getString('message');
        if (message == null && self.opts.readsContentFallback) message = c.getString('content');
        if (message == null) message = '';
        if (!raw) return c.reject('deviceId requerido');
        if (classify(raw) === 'invalid') return c.reject('ID invalido: no es NXID ni MAC', 'INVALID_DEVICE_ID');
        setTimeout(() => { // mainHandler.post
          const mac = self._resolveMac(raw);
          if (!mac) return c.reject('NXID no resuelto a MAC: ' + raw, 'NXID_UNRESOLVED');
          self._remLog('INFO', 'SEND', 'sendMessage MAC=\'' + mac + '\' len=' + message.length);
          const r = self._sendChunkedOrSingle(mac, message);
          const mtu = self.mtu.get(mac) || 23;
          if (r.sent) c.resolve({ sent: true, mode: r.mode, deviceId: raw, mtu });
          else { if (!self.pendingQueue.has(mac)) self.pendingQueue.set(mac, []); self.pendingQueue.get(mac).push(message); c.resolve({ sent: false, queued: true, mode: 'pending', deviceId: raw, mtu }); }
        }, 0);
      }),
      getConnectedDevices: wrap('getConnectedDevices', (c) => {
        const devices = [];
        self.clients.forEach((cl) => { if (cl.state === 'connected') devices.push({ id: cl.peer.address, address: cl.peer.address, direction: 'outgoing', role: 'client', ready: !!cl.rxReady }); });
        self.serverConnected.forEach((peer, mac) => devices.push({ id: peer.initAddress, address: peer.initAddress, direction: 'incoming', role: 'server', ready: !!self.serverNotif.get(mac) }));
        c.resolve({ devices });
      }),
      // Wi-Fi Direct (opts.wifiDirect: lo tiene; opts.wdFail: unirse al grupo falla). El receptor crea el
      // grupo con credenciales; el emisor solo se une con ellas y a alcance; ~2 MB/s.
      // opts.wdNoPerm: sin permiso (la 2711 no declaraba NEARBY_WIFI_DEVICES: Android 13+ lo deniega sin preguntar)
      wifiDirectStatus: wrap('wifiDirectStatus', (c) => c.resolve({ supported: !!self.opts.wifiDirect, granted: !self.opts.wdNoPerm, wifiOn: true })),
      requestWifiDirectPermission: wrap('requestWifiDirectPermission', (c) => { self.stats.wdPermAsked = (self.stats.wdPermAsked || 0) + 1; c.resolve({ granted: !self.opts.wdNoPerm }); }),
      wifiDirectHost: wrap('wifiDirectHost', (c, a) => {
        if (!self.opts.wifiDirect || self.opts.wdNoPerm) return c.reject('Wi-Fi Direct no disponible', 'WD_UNAVAILABLE');
        const rnd = (n) => Array.from({ length: n }, () => 'abcdefghjkmnpqrstuvwxyz23456789'[Math.floor(Math.random() * 31)]).join('');
        const ssid = 'DIRECT-' + rnd(2) + '-NEXO', pass = rnd(16), port = 40000 + Math.floor(Math.random() * 20000);
        self.radio.wdGroups = self.radio.wdGroups || new Map();
        self.radio.wdGroups.set(ssid, { host: self, pass, port, id: a.transferId });
        self.stats.wdGroups = (self.stats.wdGroups || 0) + 1;
        setTimeout(() => c.resolve({ ssid, passphrase: pass, port }), 1500);
        setTimeout(() => { if (self.radio.wdGroups.get(ssid)) { self.radio.wdGroups.delete(ssid); self.emit('onWifiDirectReceived', { transferId: a.transferId, error: 'Accept timed out' }); } }, 90000);
      }),
      wifiDirectSend: wrap('wifiDirectSend', (c, a) => {
        if (!self.opts.wifiDirect || self.opts.wdNoPerm) return c.reject('Wi-Fi Direct no disponible', 'WD_UNAVAILABLE');
        const g = self.radio.wdGroups && self.radio.wdGroups.get(a.ssid);
        const data = String(a.data || '');
        if (!g || g.pass !== a.passphrase || g.port !== a.port || g.id !== a.transferId || !self.radio.inRange(self, g.host) || self.opts.wdFail || g.host.opts.wdFail) {
          return setTimeout(() => c.reject('No se pudo conectar (2)', 'WD_CONNECT'), 3000);
        }
        const ms = 2000 + Math.round(data.length / 2000);
        setTimeout(() => {
          self.radio.wdGroups.delete(a.ssid);
          self.stats.wdBytes = (self.stats.wdBytes || 0) + data.length;
          g.host.emit('onWifiDirectReceived', { transferId: a.transferId, data, bytes: data.length, readMs: ms - 2000, ts: Date.now() });
          c.resolve({ ok: true, ms, bytes: data.length, joinMs: 2000, xferMs: ms - 2000, bridgeMs: 0 });
        }, ms);
      }),
      // Batería (opts.battery = { level, charging, powerSave }; por defecto 80 %, sin cargar)
      getPowerStatus: wrap('getPowerStatus', (c) => { const b = self.battery || self.opts.battery || { level: 80, charging: false, powerSave: false }; c.resolve({ level: b.level, charging: !!b.charging, powerSave: !!b.powerSave }); }),
      // Archivos (Kotlin: FileProvider + ACTION_VIEW; PdfRenderer). Aquí se registran las llamadas.
      openFile: wrap('openFile', (c) => {
        const b64 = c.getString('base64'); if (!b64) return c.reject('base64 requerido');
        self.opened = self.opened || [];
        self.opened.push({ name: c.getString('name'), mime: c.getString('mime'), bytes: Buffer.from(b64, 'base64').length, b64 });
        c.resolve({ opened: true });
      }),
      pdfThumbnail: wrap('pdfThumbnail', (c) => {
        const b64 = c.getString('base64'); if (!b64) return c.reject('base64 requerido');
        const head = Buffer.from(b64.substring(0, 16), 'base64').toString('latin1');
        if (head.indexOf('%PDF') !== 0) return c.reject('PDF no legible: no es un PDF');
        const m = Buffer.from(b64, 'base64').toString('latin1').match(/\/Count (\d+)/);
        c.resolve({ thumb: Buffer.from('JPEG-1a-pagina').toString('base64'), pages: m ? Number(m[1]) : 1 });
      }),
      saveToFile: wrap('saveToFile', (c) => { const f = c.getString('filename'); const t = c.getString('content'); if (f == null) return c.reject('filename requerido'); if (t == null) return c.reject('content requerido'); self.files.set(f, t); self.stats.saves++; self.stats.saveBytes += t.length; self.stats.maxSave = Math.max(self.stats.maxSave, t.length); self._io(() => c.resolve({ success: true, path: '/data/' + f })); }),
      loadFromFile: wrap('loadFromFile', (c) => { const f = c.getString('filename'); if (f == null) return c.reject('filename requerido'); if (!self.files.has(f)) return self._io(() => c.resolve({ exists: false, content: '' })); const content = self.files.get(f); self._io(() => c.resolve({ exists: true, content, path: '/data/' + f })); }),
      deleteFile: wrap('deleteFile', (c) => { c.resolve({ deleted: self.files.delete(c.getString('filename')) }); }),
      listFiles: wrap('listFiles', (c) => c.resolve({ files: Array.from(self.files.keys()) })),
      // Seguridad fase 3 (Kotlin: AtRestStore + Keystore, BiometricPrompt, FLAG_SECURE). Aquí los archivos ya se
      // guardan "cifrados" de forma transparente. opts.noBiometric: el teléfono no tiene huella ni PIN.
      // self.bioAnswer: lo que responde el diálogo de huella (true = huella correcta; por defecto true).
      atRestStatus: wrap('atRestStatus', (c) => c.resolve({ active: true, migration: '0 archivo(s) cifrados ahora (3 ms)' })),
      biometricStatus: wrap('biometricStatus', (c) => c.resolve({ available: !self.opts.noBiometric, code: self.opts.noBiometric ? 11 : 0 })),
      biometricAuth: wrap('biometricAuth', (c) => {
        self.stats.bioAsked = (self.stats.bioAsked || 0) + 1;
        if (self.opts.noBiometric) return c.resolve({ ok: false, reason: 'sin huella', code: 11 });
        const ok = self.bioAnswer === undefined ? true : !!self.bioAnswer;
        // self.bioDuring(): lo que pasa mientras se pide (con el PIN, Android abre otra pantalla: la app "se va" y "vuelve")
        if (typeof self.bioDuring === 'function') self.bioDuring();
        setTimeout(() => c.resolve(ok ? { ok: true } : { ok: false, reason: 'Cancelado', code: 13 }), 50);
      }),
      setSecureScreen: wrap('setSecureScreen', (c, a) => { self.secureScreen = a.on === true; c.resolve({ on: self.secureScreen }); }),
      startListeningMessages: wrap('startListeningMessages', (c) => c.resolve({ listening: true })),
    };
    return api;
  }
}

function extractJson(buffer) {
  let i = 0;
  while (i < buffer.length) {
    while (i < buffer.length && buffer[i] !== '{') i++;
    if (i >= buffer.length) return null;
    const start = i; let depth = 0, inStr = false, esc = false, j = i;
    for (; j < buffer.length; j++) {
      const ch = buffer[j];
      if (esc) { esc = false; continue; }
      if (ch === '\\') { esc = true; continue; }
      if (ch === '"') { inStr = !inStr; continue; }
      if (inStr) continue;
      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) {
          const cand = buffer.substring(start, j + 1);
          try { JSON.parse(cand); return { json: cand, rest: buffer.substring(j + 1) }; } catch (e) { i = start + 1; break; }
        }
      }
    }
    if (j >= buffer.length) return null;
  }
  return null;
}

// WebCrypto real (la de Node) en la ventana de jsdom: el cifrado E2E de la app funciona igual que en
// el teléfono (sin esto e2eAvailable() es falso y la app no cifraría nada en las pruebas)
function installWebCrypto(win) {
  const wc = require('crypto').webcrypto;
  Object.defineProperty(win, 'crypto', { configurable: true, value: wc });
  const util = require('util');
  if (!win.TextEncoder) win.TextEncoder = util.TextEncoder;
  if (!win.TextDecoder) win.TextDecoder = util.TextDecoder;
}

module.exports = { Radio, NativePhone, norm, installWebCrypto };
