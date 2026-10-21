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
  constructor() { this.phones = []; this.trace = []; }
  add(p) { this.phones.push(p); p.radio = this; }
  byNorm(mac) { return this.phones.find((p) => norm(p.address) === norm(mac)); }
  log(...a) { this.trace.push(a.join(' ')); }
}

class NativePhone {
  // opts.readsContentFallback: true si el Kotlin incluye `?: call.getString("content")`
  constructor(name, address, opts = {}) {
    this.name = name;
    this.address = address; // dirección que ven los demás (formato Android 'AA:BB:..')
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
    // Capacitor entrega eventos de forma asíncrona por el bridge
    setTimeout(() => cbs.forEach((cb) => { try { cb(JSON.parse(JSON.stringify(data))); } catch (e) { this.radio.log(this.name, 'listener error', event, e.message); } }), 0);
  }

  // ---- ciclo de vida (Kotlin load(): autoStartGattServerAndAdvertising) ----
  load() { this.serviceRunning = true; }

  // ---- envío al aire ----
  _air(fromPeerMac, toPhone, bytes, source) {
    // Cola por enlace como processWriteQueue de Kotlin: una escritura cada 40 ms (cliente) u 80 ms
    // (notify de servidor). Con opts.realTiming=false entrega casi inmediata.
    const delay = this.opts.realTiming === false ? 1 : (source === 'gatt_client' ? 80 : 40);
    if (!this.writeQ) this.writeQ = new Map();
    const key = norm(toPhone.address);
    if (!this.writeQ.has(key)) this.writeQ.set(key, { items: [], busy: false });
    const q = this.writeQ.get(key);
    // Pérdida simulada (radio real): se pierde la escritura entera
    if (this.opts.loss && Math.random() < this.opts.loss) { this.stats.lost = (this.stats.lost || 0) + 1; return; }
    // Kotlin MAX_QUEUE_SIZE = 500: con la cola llena descarta
    if (q.items.length >= 500) { this.stats.dropped = (this.stats.dropped || 0) + 1; return; }
    q.items.push(() => toPhone._processReceivedChunk(this.address, bytes, source));
    this.stats.maxQueue = Math.max(this.stats.maxQueue || 0, q.items.length);
    if (/"t":"ba"/.test(bytes)) this.stats.acksOut = (this.stats.acksOut || 0) + 1; else if (/"t":"f"/.test(bytes)) this.stats.chunksOut = (this.stats.chunksOut || 0) + 1;
    const pump = () => {
      if (!q.items.length) { q.busy = false; return; }
      q.busy = true;
      const fn = q.items.shift();
      setTimeout(() => { fn(); setTimeout(pump, delay); }, 10);
    };
    if (!q.busy) pump();
  }

  _sendSingleChunk(macNorm, chunk) {
    // 1. Servidor (notify) si el otro está conectado a nosotros como cliente y activó notificaciones
    const srvPeer = this.serverConnected.get(macNorm);
    if (srvPeer && this.serverNotif.get(macNorm)) {
      this.sent.push({ to: macNorm, chunk, mode: 'gatt_server' });
      this._air(macNorm, srvPeer, chunk, 'gatt_client');
      return { sent: true, mode: 'gatt_server' };
    }
    // 2. Cliente (write) si estamos conectados como cliente
    const cl = this.clients.get(macNorm);
    if (cl && cl.state === 'connected' && cl.rxReady) {
      this.sent.push({ to: macNorm, chunk, mode: 'gatt_client' });
      this._air(macNorm, cl.peer, chunk, 'gatt_server');
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
    const mac = norm(fromAddress);
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
      const me = norm(this.address), them = norm(p.address);
      const drop = (holder, otherAddr, mac) => { holder.emit('onDeviceDisconnected', { deviceId: otherAddr }); holder.buffers.delete(mac); };
      if (p.clients.has(me)) { p.clients.delete(me); drop(p, this.address, me); }
      if (p.serverConnected.has(me)) { p.serverConnected.delete(me); p.serverNotif.delete(me); drop(p, this.address, me); }
      if (this.clients.has(them)) { this.clients.delete(them); drop(this, p.address, them); }
      if (this.serverConnected.has(them)) { this.serverConnected.delete(them); this.serverNotif.delete(them); drop(this, p.address, them); }
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
      // Lado servidor del otro teléfono
      peer.serverConnected.set(norm(this.address), this);
      peer.emit('onDeviceConnected', { deviceId: this.address, direction: 'incoming', role: 'server', servicesReady: true });
      // onServicesDiscovered -> requestMtu + escritura CCCD
      setTimeout(() => {
        cl.rxReady = true;
        this.emit('onServicesReady', { deviceId: peer.address, servicesReady: true });
        this._flushPending(macNorm);
        setTimeout(() => {
          const mtu = this.opts.mtu || 512;
          this.mtu.set(macNorm, mtu); peer.mtu.set(norm(this.address), mtu);
          peer.serverNotif.set(norm(this.address), true);
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
    const wrap = (name, fn) => (args = {}) => {
      self.calls.push({ name, args: JSON.parse(JSON.stringify(args || {})) });
      return new Promise((resolve, reject) => {
        const call = { resolve, reject: (msg, code) => { const e = new Error(msg); e.code = code; reject(e); }, getString: (k) => (args && typeof args[k] === 'string' ? args[k] : null) };
        try { fn(call, args || {}); } catch (e) { reject(e); }
      });
    };
    const api = {
      addListener(event, cb) {
        if (!self.listeners.has(event)) self.listeners.set(event, []);
        self.listeners.get(event).push(cb);
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
      startScan: wrap('startScan', (c) => {
        c.resolve({ started: true });
        setTimeout(() => self.radio.phones.forEach((p) => {
          if (p === self || p.offline || !p.serviceRunning || !p.advertisingId) return;
          self.emit('onDeviceFound', { deviceId: p.address, name: p.name, rssi: -50, nexoId: p.advertisingId });
        }), 80);
      }),
      stopScan: wrap('stopScan', (c) => c.resolve({ stopped: true })),
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
        if (!peer || peer.offline || self.offline) { setTimeout(() => { c.resolve({ connected: false, deviceId: raw, error: 'Connection error 133' }); }, 200); return; }
        self._connectClient(peer, c);
      }),
      disconnectDevice: wrap('disconnectDevice', (c) => {
        const raw = c.getString('deviceId') || '';
        if (!raw) return c.reject('deviceId requerido');
        const mac = self._resolveMac(raw) || raw.toLowerCase();
        const cl = self.clients.get(mac);
        if (cl) { self.clients.delete(mac); cl.peer.serverConnected.delete(norm(self.address)); cl.peer.serverNotif.delete(norm(self.address)); cl.peer.emit('onDeviceDisconnected', { deviceId: self.address }); }
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
          const r = self._sendChunkedOrSingle(mac, message);
          const mtu = self.mtu.get(mac) || 23;
          if (r.sent) c.resolve({ sent: true, mode: r.mode, deviceId: raw, mtu });
          else { if (!self.pendingQueue.has(mac)) self.pendingQueue.set(mac, []); self.pendingQueue.get(mac).push(message); c.resolve({ sent: false, queued: true, mode: 'pending', deviceId: raw, mtu }); }
        }, 0);
      }),
      getConnectedDevices: wrap('getConnectedDevices', (c) => c.resolve({ devices: [] })),
      saveToFile: wrap('saveToFile', (c) => { const f = c.getString('filename'); const t = c.getString('content'); if (f == null) return c.reject('filename requerido'); if (t == null) return c.reject('content requerido'); self.files.set(f, t); self.stats.saves++; self.stats.saveBytes += t.length; self.stats.maxSave = Math.max(self.stats.maxSave, t.length); c.resolve({ success: true, path: '/data/' + f }); }),
      loadFromFile: wrap('loadFromFile', (c) => { const f = c.getString('filename'); if (f == null) return c.reject('filename requerido'); if (!self.files.has(f)) return c.resolve({ exists: false, content: '' }); c.resolve({ exists: true, content: self.files.get(f), path: '/data/' + f }); }),
      deleteFile: wrap('deleteFile', (c) => { c.resolve({ deleted: self.files.delete(c.getString('filename')) }); }),
      listFiles: wrap('listFiles', (c) => c.resolve({ files: Array.from(self.files.keys()) })),
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

module.exports = { Radio, NativePhone, norm };
