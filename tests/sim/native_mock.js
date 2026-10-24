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

// Ronda 2753: trozos binarios (BinFrame.kt): 0x01 | largo cabecera (2) | largo datos (4) | cabecera | datos
const BIN = {
  encode(header, data) {
    const h = Buffer.from(header, 'utf8');
    const out = Buffer.alloc(7 + h.length + data.length);
    out[0] = 1; out.writeUInt16BE(h.length, 1); out.writeUInt32BE(data.length, 3);
    h.copy(out, 7); data.copy(out, 7 + h.length);
    return out;
  },
  split(frame, size) { const n = Math.max(size, 7), out = []; for (let i = 0; i < frame.length; i += n) out.push(frame.subarray(i, i + n)); return out; },
};
// Como BinAssembler (Kotlin): junta las escrituras por teléfono; lo que no es binario sale como texto
class BinAssembler {
  constructor(timeoutMs = 4000) { this.timeoutMs = timeoutMs; this.states = new Map(); }
  reset(key) { this.states.delete(key); }
  feed(key, bytes, now) {
    const frames = []; let dropped = 0;
    let st = this.states.get(key);
    if (st && now - st.last > this.timeoutMs) { this.states.delete(key); st = null; dropped++; }
    // Se perdió el final de un trozo: lo que llega empieza otro trozo o un mensaje de texto
    const has = (at, p) => bytes.length >= at + p.length && bytes.toString('latin1', at, at + p.length) === p;
    if (st && ((bytes[0] === 1 && has(7, '{"v":')) || has(0, '{"v":') || has(0, '{"type":'))) { this.states.delete(key); st = null; dropped++; }
    let b = bytes;
    while (b.length) {
      if (!st) {
        if (b[0] !== 1) return { frames, text: b, dropped };
        if (b.length < 7) { dropped++; break; }
        const h = b.readUInt16BE(1), d = b.readUInt32BE(3);
        if (h <= 0 || h > 4096 || d > 65536) { dropped++; break; }
        st = { hLen: h, total: 7 + h + d, buf: Buffer.alloc(7 + h + d), got: 0, last: now };
        this.states.set(key, st);
      }
      const take = Math.min(st.total - st.got, b.length);
      b.copy(st.buf, st.got, 0, take); st.got += take; st.last = now; b = b.subarray(take);
      if (st.got === st.total) {
        this.states.delete(key);
        frames.push({ header: st.buf.toString('utf8', 7, 7 + st.hLen), data: st.buf.subarray(7 + st.hLen) });
        st = null;
      }
    }
    return { frames, text: null, dropped };
  }
}

// ID rotativo (RidToken.kt / ble_rid.js, ronda 2755): lo que el teléfono anuncia ahora mismo
const nodeCrypto = require('crypto');
function ridToken(keyHex, epoch) {
  const h = nodeCrypto.createHmac('sha256', Buffer.from(keyHex, 'hex')).update('nexo-rid|' + epoch).digest();
  const B32 = 'abcdefghijklmnopqrstuvwxyz234567';
  let out = 'R', acc = 0, bits = 0, i = 0;
  while (out.length < 10) { acc = (acc << 8) | h[i++]; bits += 8; while (bits >= 5 && out.length < 10) { bits -= 5; out += B32[(acc >> bits) & 31]; } acc &= (1 << bits) - 1; }
  return out;
}

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
      x.buffers.delete(norm(y.address)); x.buffers.delete(norm(y.initAddress)); x.bin.reset(norm(y.address)); x.bin.reset(norm(y.initAddress));
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
    this.notifications = new Map(); // chatId -> { name, ids, base, text } (notificaciones de mensajes)
    this.notifLog = [];
    this.advertisingId = null;
    this.serviceRunning = false;
    this.clients = new Map(); // macNorm -> { state, peer }
    this.serverConnected = new Map(); // macNorm -> peer
    this.serverNotif = new Map(); // macNorm -> bool
    this.mtu = new Map(); // macNorm -> mtu
    this.buffers = new Map(); // macNorm -> string (processReceivedChunk)
    this.bin = new BinAssembler(); // trozos binarios (processReceivedBytes)
    this.pendingQueue = new Map(); // macNorm -> [msg] (Kotlin pendingMessageQueue)
    this.sent = []; // registro de lo que salió por el aire
    this.calls = []; // registro de llamadas JS -> nativo
    this.stats = { saves: 0, saveBytes: 0, maxSave: 0 }; // coste de persistencia (cruza el bridge)
  }

  emit(event, data) {
    // Algunos teléfonos (el Vivo del dueño) congelan la app en segundo plano: lo que llega espera a que vuelva
    if (this.jsFrozen) { (this.frozenQ = this.frozenQ || []).push([event, data]); return; }
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
    const deliver = () => cbs.forEach((cb) => { try { cb(JSON.parse(JSON.stringify(data))); } catch (e) { this.radio.log(this.name, 'listener error', event, e.message); } });
    // opts.bridgeMs: en el teléfono cada evento es un evaluateJavascript en el hilo de la interfaz, uno detrás de
    // otro; cada uno cuesta (ms). Sin esto, entrega inmediata.
    if (!this.opts.bridgeMs) { setTimeout(deliver, 0); return; }
    this.stats.bridgeEvents = (this.stats.bridgeEvents || 0) + 1;
    const tq = Date.now();
    this._bq = (this._bq || Promise.resolve()).then(() => new Promise((done) => setTimeout(() => {
      this.stats.bridgeWaitMax = Math.max(this.stats.bridgeWaitMax || 0, Date.now() - tq);
      deliver(); done();
    }, this.opts.bridgeMs)));
  }

  // ---- ciclo de vida de la actividad (cerrar / reabrir la app) ----
  // handleOnDestroy de Kotlin: cleanupAllConnections + stopGattServer. El BleService (foreground) sigue
  // anunciando con el último NEXO ID. Los demás ven caer sus conexiones con este teléfono.
  destroyActivity() {
    this.destroyed = true;
    this.listeners = new Map();
    this.retained = new Map();
    // Kotlin handleOnDestroy: lanStopAll (el Wi-Fi de la misma red se cierra; los demás ven caer la conexión)
    if (this.lanConns) Array.from(this.lanConns.keys()).forEach((nx) => this._lanClose(nx, false));
    this.lan = null;
    // Kotlin 2758 (BgInbox.kt): con el servidor en marcha, el Bluetooth sigue recibiendo con la app cerrada (sin
    // escanear); opts.noClosedRx = Kotlin anterior (se cierra todo)
    if (!this.opts.noClosedRx && this.serverUp !== false) {
      this.closedMode = true; this.scanningUntil = 0;
      if (this.tor) { const me = this.tor.nx; this.tor.conns.forEach((p) => { if (p.tor) { p.tor.conns.delete(me); p.emit('onTorDown', { nx: me }); } }); this.tor = null; }
      return;
    }
    this.serverUp = false;
    const meAdv = norm(this.address), meInit = norm(this.initAddress);
    this.radio.phones.forEach((p) => {
      if (p === this) return;
      // Radio real: el otro no se entera hasta que vence el supervision timeout (opts.supervisionMs);
      // mientras, sus escrituras "salen" bien pero se pierden (ver _processReceivedChunk).
      p._dropLinkLater(meAdv, this.address, meInit, this.initAddress);
      this.clients.delete(norm(p.address)); this.serverConnected.delete(norm(p.initAddress)); this.serverNotif.delete(norm(p.initAddress));
    });
    this.pendingQueue.clear(); this.buffers.clear(); this.writeQ = new Map();
    // Kotlin handleOnDestroy: torStopAll (se cierra el servicio oculto)
    if (this.tor) { const me = this.tor.nx; this.tor.conns.forEach((p) => { if (p.tor) { p.tor.conns.delete(me); p.emit('onTorDown', { nx: me }); } }); this.tor = null; }
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
  setFrozen(on) {
    this.jsFrozen = !!on;
    if (!on && this.frozenQ) { const q = this.frozenQ; this.frozenQ = []; q.forEach(([e, d]) => this.emit(e, d)); }
  }
  setAppActive(active) {
    this.appActive = !!active;
    if (this.opts.appStateEvents) this.emit('onAppStateChange', { isActive: !!active });
  }

  // ---- ciclo de vida (Kotlin load(): autoStartGattServerAndAdvertising) ----
  load() {
    // Kotlin 2758 takeOverFromClosed: la instancia vieja suelta sus conexiones; lo guardado llega a la app (retenido)
    if (this.closedMode) {
      this.closedMode = false;
      const meAdv = norm(this.address), meInit = norm(this.initAddress);
      this.radio.phones.forEach((p) => {
        if (p === this) return;
        p._dropLinkLater(meAdv, this.address, meInit, this.initAddress);
        this.clients.delete(norm(p.address)); this.serverConnected.delete(norm(p.initAddress)); this.serverNotif.delete(norm(p.initAddress));
      });
      this.pendingQueue.clear(); this.buffers.clear(); this.writeQ = new Map();
      const box = this.bgInbox || []; this.bgInbox = [];
      if (!this.retained) this.retained = new Map();
      if (box.length) this.retained.set('onPayloadReceived', (this.retained.get('onPayloadReceived') || []).concat(box.map((x) => ({ deviceId: x.d, content: x.c, data: x.c, source: 'closed', timestamp: Date.now(), reassembled: true }))));
      this.stats.closedDelivered = (this.stats.closedDelivered || 0) + box.length;
    }
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

  // ---- Wi-Fi normal (modelo de LanHub + NSD) ----
  get wifiNet() { return this._wifiNet === undefined ? (this.opts.wifi || null) : this._wifiNet; }
  setWifi(net) {
    const prev = this.wifiNet;
    this._wifiNet = net || null;
    if (prev && prev !== this._wifiNet && this.lanConns) Array.from(this.lanConns.keys()).forEach((nx) => this._lanClose(nx, !!this.opts.lanSilent));
    if (this._wifiNet) setTimeout(() => this._lanAnnounce(), 30);
  }
  // Descubrimiento: anuncio mDNS (opts.lanNoMdns: el router no lo deja pasar, como muchos repetidores y mallas) y,
  // desde la 2733, escaneo activo de la red (LanBeacon; opts.lanNoScan = Kotlin anterior, sin escaneo)
  _lanAnnounce() {
    if (!this.lan || !this.wifiNet) return;
    this.radio.phones.forEach((p) => {
      if (p === this || !p.lan || p.wifiNet !== this.wifiNet) return;
      // Escaneo: hace falta que los dos lo tengan (uno pregunta, el otro escucha y contesta)
      const src = (!this.opts.lanNoMdns && !p.opts.lanNoMdns) ? 'mdns' : (!this.opts.lanNoScan && !p.opts.lanNoScan ? 'scan' : null);
      if (!src) return;
      this.emit('onLanPeer', { token: p.lan.token, host: p.name, port: p.lan.port, src });
      p.emit('onLanPeer', { token: this.lan.token, host: this.name, port: this.lan.port, src });
    });
  }
  _lanLink(t) {
    if (!this.lanConns) this.lanConns = new Map();
    if (!t.lanConns) t.lanConns = new Map();
    if (this.lanConns.get(t.lan.nx) === t && t.lanConns.get(this.lan.nx) === this) return;
    this.lanConns.set(t.lan.nx, t); t.lanConns.set(this.lan.nx, this);
    if (this.lanStale) delete this.lanStale[t.lan.nx]; if (t.lanStale) delete t.lanStale[this.lan.nx];
    this.emit('onLanUp', { nx: t.lan.nx }); t.emit('onLanUp', { nx: this.lan.nx });
  }
  // silent: el otro no se entera (cable cortado / Wi-Fi perdido sin cierre limpio)
  _lanClose(nx, silent) {
    const peer = this.lanConns && this.lanConns.get(nx);
    if (!peer) return;
    this.lanConns.delete(nx);
    this.emit('onLanDown', { nx });
    if (!peer.lanConns || !this.lan || peer.lanConns.get(this.lan.nx) !== this) return;
    const me = this.lan.nx;
    if (!silent) { peer.lanConns.delete(me); peer.emit('onLanDown', { nx: me }); return; }
    // Sin aviso: el otro sigue creyendo que hay conexión hasta que su latido nativo no recibe nada en 30 s
    peer.lanStale = peer.lanStale || {}; peer.lanStale[me] = Date.now();
    setTimeout(() => {
      if (peer.lanConns && peer.lanConns.get(me) === this && !(this.lanConns && this.lanConns.get(peer.lan && peer.lan.nx) === peer)) {
        peer.lanConns.delete(me); delete peer.lanStale[me]; peer.emit('onLanDown', { nx: me });
      }
    }, 30000);
  }

  // ---- envío al aire ----
  // tag = { mid, last }: trozo de qué mensaje (para la cola: no partir mensajes).
  // opts.busyFail = probabilidad de que Android rechace una escritura por estar ocupado (ERROR_GATT_WRITE_REQUEST_BUSY,
  // frecuente en teléfonos reales con la radio cargada). Kotlin hasta la 2722 (opts.kotlin2722): 3 intentos y
  // descarta ESE trozo (el mensaje llega mutilado). Desde la 2723: reintenta con espera creciente y, si no puede,
  // descarta el resto del mensaje entero (nunca un trozo del medio).
  _air(fromAddress, toPhone, bytes, source, tag) {
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
    if (this.opts.kotlin2722 && q.items.length >= 500) { this.stats.dropped = (this.stats.dropped || 0) + 1; return; }
    const item = () => toPhone._processReceivedChunk(fromAddress, bytes, source);
    item.tag = tag || {}; item.tries = 0;
    q.items.push(item);
    this.stats.maxQueue = Math.max(this.stats.maxQueue || 0, q.items.length);
    if (Buffer.isBuffer(bytes)) { this.stats.binWrites = (this.stats.binWrites || 0) + 1; this.stats.airBytes = (this.stats.airBytes || 0) + bytes.length; }
    else this.stats.airBytes = (this.stats.airBytes || 0) + Buffer.byteLength(bytes, 'utf8');
    this.stats.airWrites = (this.stats.airWrites || 0) + 1;
    if (Buffer.isBuffer(bytes)) { if (bytes[0] === 1) this.stats.binChunksOut = (this.stats.binChunksOut || 0) + 1; } else if (/"t":"ba"/.test(bytes)) this.stats.acksOut = (this.stats.acksOut || 0) + 1; else if (/"t":"f"/.test(bytes)) this.stats.chunksOut = (this.stats.chunksOut || 0) + 1;
    const pump = () => {
      if (!q.items.length) { q.busy = false; return; }
      q.busy = true;
      const fn = q.items[0];
      if (this.opts.busyFail && Math.random() < this.opts.busyFail) {
        fn.tries++;
        this.stats.busy = (this.stats.busy || 0) + 1;
        if (this.opts.kotlin2722) {
          if (fn.tries >= 3) { q.items.shift(); this.stats.droppedMid = (this.stats.droppedMid || 0) + 1; }
          setTimeout(pump, 15);
        } else if (fn.tries >= 40) { // como el Kotlin 2723: 15 ms las 4 primeras, luego 50 ms; a los 40, fuera el mensaje
          // No se puede escribir en ~5 s: fuera el resto de ESE mensaje (nunca un trozo suelto del medio)
          const mid = fn.tag.mid;
          const before = q.items.length;
          q.items = q.items.filter((x) => !(mid && x.tag.mid === mid)); if (!mid) q.items.shift();
          this.stats.droppedMsgs = (this.stats.droppedMsgs || 0) + 1; this.stats.droppedChunks = (this.stats.droppedChunks || 0) + before - q.items.length;
          setTimeout(pump, 15);
        } else setTimeout(pump, fn.tries < 5 ? 15 : 50);
        return;
      }
      q.items.shift();
      // Un error al entregar no debe dejar la cola de ese enlace parada para siempre
      setTimeout(() => { try { fn(); } catch (e) { this.radio.log(this.name, 'ERROR entregando', e && e.stack); (this.stats.deliverErrors = (this.stats.deliverErrors || 0) + 1); } setTimeout(pump, delay); }, 10);
    };
    if (!q.busy) pump();
  }

  _sendSingleChunk(macNorm, chunk, tag) {
    // 1. Servidor (notify) si el otro está conectado a nosotros como cliente y activó notificaciones
    const srvPeer = this.serverConnected.get(macNorm);
    if (srvPeer && this.serverNotif.get(macNorm)) {
      this.sent.push({ to: macNorm, chunk, mode: 'gatt_server' });
      this._remLog('INFO', 'SEND', 'GATT Server chunk sent to ' + macNorm + ' len=' + chunk.length);
      this._air(this.address, srvPeer, chunk, 'gatt_client', tag); // notify: el cliente nos ve por la dirección de anuncio
      return { sent: true, mode: 'gatt_server' };
    }
    // 2. Cliente (write) si estamos conectados como cliente
    const cl = this.clients.get(macNorm);
    if (cl && cl.state === 'connected' && cl.rxReady) {
      this.sent.push({ to: macNorm, chunk, mode: 'gatt_client' });
      this._remLog('INFO', 'SEND', 'GATT Client chunk sent (NO_RESPONSE) to ' + macNorm + ' len=' + chunk.length);
      this._air(this.initAddress, cl.peer, chunk, 'gatt_server', tag); // write: el servidor nos ve por la de iniciador
      return { sent: true, mode: 'gatt_client' };
    }
    return { sent: false, mode: '' };
  }

  _sendChunkedOrSingle(macNorm, message) {
    const mtu = this.mtu.get(macNorm) || 23;
    const mid = (this._mid = (this._mid || 0) + 1);
    // Kotlin 2757 (Utf8Split): por bytes reales, MTU - 3 (máx. 512), sin cortar caracteres; opts.kotlin2756: como
    // antes (caracteres, MTU - 13)
    const chunks = [];
    if (this.opts.kotlin2756) { const size = Math.max(mtu - 3 - 10, 20); for (let i = 0; i < message.length; i += size) chunks.push(message.substring(i, i + size)); }
    else {
      const max = Math.min(Math.max(mtu - 3, 20), 512);
      let start = 0, bytes = 0, i = 0;
      while (i < message.length) {
        const c = message.charCodeAt(i), n = message.charCodeAt(i + 1);
        const len = (c >= 0xD800 && c <= 0xDBFF && n >= 0xDC00 && n <= 0xDFFF) ? 4 : c < 0x80 ? 1 : c < 0x800 ? 2 : 3;
        if (bytes + len > max && i > start) { chunks.push(message.substring(start, i)); start = i; bytes = 0; }
        bytes += len; i += len === 4 ? 2 : 1;
      }
      if (start < message.length) chunks.push(message.substring(start));
    }
    // Kotlin 2725: el mensaje entra entero o no entra (con la cola llena espera; antes se partía)
    if (!this.opts.kotlin2722) {
      const peerAddr = (this.serverConnected.get(macNorm) || (this.clients.get(macNorm) || {}).peer || {}).address;
      const q = peerAddr && this.writeQ && this.writeQ.get(norm(peerAddr));
      if (q && q.items.length > 0 && q.items.length + chunks.length > 500) { this.stats.queueFullMsgs = (this.stats.queueFullMsgs || 0) + 1; return { sent: false, mode: '', full: true }; }
    }
    if (chunks.length <= 1) return this._sendSingleChunk(macNorm, message, { mid, last: true });
    const first = this._sendSingleChunk(macNorm, chunks[0], { mid, last: chunks.length === 1 });
    if (!first.sent) return { sent: false, mode: '' };
    // opts.dropMidEvery = N: cada N mensajes de varios trozos se pierde uno del medio (prueba la resincronización)
    const lose = this.opts.dropMidEvery && chunks.length >= 3 && mid % this.opts.dropMidEvery === 0 ? 1 : -1;
    if (lose > 0) this.stats.mutilated = (this.stats.mutilated || 0) + 1;
    chunks.slice(1).forEach((c, k) => { if (k + 1 !== lose) this._sendSingleChunk(macNorm, c, { mid, last: k === chunks.length - 2 }); });
    return { sent: true, mode: first.mode };
  }

  // ---- recepción (Kotlin processReceivedChunk + tryExtractCompleteJson) ----
  _processReceivedChunk(fromAddress, chunk, source) {
    const sender = this.radio.phones.find((p) => norm(p.address) === norm(fromAddress) || norm(p.initAddress) === norm(fromAddress));
    if (this.offline || this.serverUp === false || (sender && sender.offline) || (sender && !this.radio.inRange(this, sender))) { this.stats.voidWrites = (this.stats.voidWrites || 0) + 1; return; }
    const mac = norm(fromAddress);
    this._remLog('INFO', source === 'gatt_client' ? 'GATT_CLIENT_CB' : 'GATT_SERVER', 'RX chunk from ' + mac + ': len=' + chunk.length);
    // Kotlin processReceivedBytes: por la radio llegan bytes; un trozo binario se junta aparte
    if (!this.opts.noBinNative) {
      const out = this.bin.feed(mac, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, 'utf8'), Date.now());
      if (out.dropped) this.stats.binDropped = (this.stats.binDropped || 0) + out.dropped;
      out.frames.forEach((f) => {
        this.stats.binChunksIn = (this.stats.binChunksIn || 0) + 1;
        if (this.closedMode) { this._closedReceive(fromAddress, f.header); return; }
        this._bgNotify(f.header);
        this.emit('onPayloadReceived', { deviceId: fromAddress, content: f.header, data: f.header, bin: f.data.toString('base64'), source, timestamp: Date.now(), reassembled: true });
      });
      if (!out.text) return;
      chunk = out.text.toString('utf8');
    } else if (Buffer.isBuffer(chunk)) chunk = chunk.toString('utf8'); // Kotlin anterior: todo a texto
    // Como el Kotlin: el búfer se limpia tras 5 s SIN trozos nuevos; desde la 2723 además si lo pendiente lleva
    // más de 10 s sin formar un mensaje (mutilado: se perdió un trozo)
    if (!this.bufTimers) this.bufTimers = new Map();
    if (!this.bufSince) this.bufSince = new Map();
    clearTimeout(this.bufTimers.get(mac));
    if (!this.opts.kotlin2722 && this.buffers.get(mac) && Date.now() - (this.bufSince.get(mac) || Date.now()) > 10000) {
      this.buffers.delete(mac); this.stats.resyncs = (this.stats.resyncs || 0) + 1;
    }
    if (!this.buffers.get(mac)) this.bufSince.set(mac, Date.now());
    let buf = (this.buffers.get(mac) || '') + chunk;
    for (;;) {
      const ex = extractJson(buf);
      if (!ex) break;
      this.radio.log(this.name, 'RX de', fromAddress, ex.json.substring(0, 90));
      if (!this.closedMode) this._bgNotify(ex.json);
      if (this.closedMode) this._closedReceive(fromAddress, ex.json);
      else this.emit('onPayloadReceived', { deviceId: fromAddress, content: ex.json, data: ex.json, source, timestamp: Date.now(), reassembled: true });
      buf = ex.rest;
      this.bufSince.set(mac, Date.now());
    }
    if (buf) {
      this.buffers.set(mac, buf);
      this.bufTimers.set(mac, setTimeout(() => { this.buffers.delete(mac); this.stats.bufTimeouts = (this.stats.bufTimeouts || 0) + 1; }, 5000));
    } else this.buffers.delete(mac);
  }

  // ---- app cerrada (Kotlin closedReceive + BgInbox.classify; probado en tests/kotlin/BgInboxTest) ----
  // me: mi NEXO ID (Kotlin 2760: lo que llega por Jump para mí → solo aviso)
  static classifyClosed(json, me) {
    let o; try { o = JSON.parse(json); } catch (e) { return { kind: 'IGNORE' }; }
    const NX = /^nx[0-9a-z]{8}$/;
    const from = String(o.from || o.fr || '').toLowerCase();
    me = String(me || '').toLowerCase(); const mine = NX.test(me);
    const what = () => (o.t === 'c' ? (o.cl === 1 ? 'call' : 'text') : (o.tp || 'file'));
    if (o.type === 'chat' && o.msgId && NX.test(from) && !o.to) return { kind: 'MESSAGE', from, msgId: o.msgId, quiet: o.q === 1, call: o.cl === 1, group: /^gr[0-9a-z]{8}$/.test(String(o.g || '').toLowerCase()) ? String(o.g).toLowerCase() : '' };
    if (mine && o.type === 'chat' && o.msgId && NX.test(from) && String(o.to).toLowerCase() === me) return { kind: 'NOTIFY_ONLY', from, msgId: o.msgId, quiet: o.q === 1, what: 'text' };
    if (mine && o.type === 'sx' && o.msgId && String(o.to).toLowerCase() === me) return { kind: 'NOTIFY_ONLY', from: '', msgId: o.msgId, what: 'text' };
    if (mine && (o.t === 'c' || o.t === 'f') && o.i === 0 && String(o.dt || '').toLowerCase() === me) return { kind: 'NOTIFY_ONLY', from: NX.test(from) ? from : '', msgId: o.m, quiet: o.q === 1, what: what() };
    if ((o.type === 'ack' || o.type === 'read_receipt') && o.msgId && !o.to) return { kind: 'RECEIPT', from, msgId: o.msgId };
    if ((o.t === 'c' || o.t === 'f') && o.i === 0 && NX.test(from) && !o.dt) return { kind: 'NOTIFY_ONLY', from, msgId: o.m, quiet: o.q === 1, what: what(), group: /^gr[0-9a-z]{8}$/.test(String(o.g || '').toLowerCase()) ? String(o.g).toLowerCase() : '' };
    return { kind: 'IGNORE' };
  }
  // MsgNotifier.message + UnreadBook (Kotlin): un aviso por chat; el mismo msgId no avisa dos veces; si ya se avisó en
  // otro chat (el nativo, con quien lo manda) pasa a este (el grupo). flags: { closed, bg }
  _postNotif(chatId, name, msgId, text, flags) {
    const id = String(chatId || '').toLowerCase(), mid = String(msgId);
    if (!this.msgChat) this.msgChat = new Map();
    const prev = this.msgChat.get(mid);
    if (prev && prev !== id) {
      const o = this.notifications.get(prev);
      if (o && o.ids.delete(mid) && o.base + o.ids.size <= 0) this.notifications.delete(prev);
    }
    const n = this.notifications.get(id) || { name, ids: new Set(), base: 0, text: '' };
    if (n.ids.has(mid)) { // UnreadBook.refreshText: la app cambia el texto del aviso nativo, sin sonar
      if (text && n.text !== text) { n.text = text; this.notifLog.push(Object.assign({ t: Date.now(), chatId: id, name: n.name, text, count: n.base + n.ids.size, update: true }, flags || {})); }
      return n.base + n.ids.size;
    }
    n.ids.add(mid); n.name = name || n.name; n.text = text || ''; n.posts = (n.posts || 0) + 1;
    this.notifications.set(id, n); this.msgChat.set(mid, id);
    this.notifLog.push(Object.assign({ t: Date.now(), chatId: id, name: n.name, text: text || '', count: n.base + n.ids.size }, flags || {}));
    return n.base + n.ids.size;
  }
  // Kotlin 2763 groupName: nombre del grupo (nexo_groups.json)
  _groupName(gid) { if (!gid) return null; try { const g = (JSON.parse(this.files.get('nexo_groups.json') || '{}').groups || {})[gid]; return (g && g.name) || null; } catch (e) { return null; } }
  // Kotlin 2763 notifyMessage: en un grupo, en el chat del grupo con su nombre
  _notifyMsg(info, flags) {
    const gname = this._groupName(info.group), who = this._notifName(info.from);
    if (gname) this._postNotif(info.group, gname, info.msgId, who !== 'NEXO' ? who + ': Mensaje nuevo' : '', flags);
    else this._postNotif(info.from, who, info.msgId, '', flags);
  }
  _notifName(nx) { const c = this.netBg && (this.netBg.contacts || []).find((x) => String(x.nx || '').toLowerCase() === nx); return (c && c.name) || 'NEXO'; }
  static whatText(w) { return ({ image: '📷 Foto', video: '🎥 Vídeo', audio: '🎤 Nota de voz', call: '📞 Llamada entrante', text: '' })[w] ?? '📎 Archivo'; }
  // Kotlin 2760 backgroundNotify: app en segundo plano (puede estar congelada): si a los 4 s la app no avisó, avisa el nativo
  _bgNotify(json) {
    if (this.appActive !== false || this.closedMode || this.opts.noBgNotify) return;
    const info = NativePhone.classifyClosed(json, this.advertisingId);
    if (!info.msgId || info.quiet || (info.kind !== 'MESSAGE' && info.kind !== 'NOTIFY_ONLY')) return;
    setTimeout(() => {
      if (this.appActive !== false || this.closedMode || (this.msgChat && this.msgChat.has(String(info.msgId)))) return;
      if (info.kind === 'MESSAGE') this._notifyMsg(info, { bg: true });
      else if (this._groupName(info.group)) { const who = this._notifName(info.from), w = NativePhone.whatText(info.what); this._postNotif(info.group, this._groupName(info.group), info.msgId, who !== 'NEXO' ? who + ': ' + (w || 'Mensaje nuevo') : w, { bg: true }); }
      else this._postNotif(info.from || 'nexo_jump', info.from ? this._notifName(info.from) : 'NEXO', info.msgId, NativePhone.whatText(info.what), { bg: true });
    }, 4000);
  }
  _closedReceive(fromAddress, json) {
    const info = NativePhone.classifyClosed(json, this.advertisingId);
    this.stats.closedRx = (this.stats.closedRx || 0) + 1;
    if (!this.bgInbox) this.bgInbox = [];
    const notify = (text) => {
      if (info.quiet) return;
      this._postNotif(info.from || 'nexo_jump', info.from ? this._notifName(info.from) : 'NEXO', info.msgId, text, { closed: true });
    };
    if (info.kind === 'MESSAGE') {
      this.bgInbox.push({ d: fromAddress, c: json });
      const me = String(this.advertisingId || '').toLowerCase();
      if (me) this._sendChunkedOrSingle(norm(fromAddress), JSON.stringify({ v: 1, type: 'ack', msgId: info.msgId, from: me, ts: Date.now() }));
      if (info.call) { this.callNotif = { from: info.from, video: false }; this.notifLog.push({ t: Date.now(), chatId: info.from, name: this._notifName(info.from), text: '📞 Llamada entrante', call: true, closed: true }); }
      else if (!info.quiet) this._notifyMsg(info, { closed: true });
    } else if (info.kind === 'RECEIPT') this.bgInbox.push({ d: fromAddress, c: json });
    else if (info.kind === 'NOTIFY_ONLY' && info.what === 'call') { this.callNotif = { from: info.from, video: false }; this.notifLog.push({ t: Date.now(), chatId: info.from, name: this._notifName(info.from), text: '📞 Llamada entrante', call: true, closed: true }); }
    else if (info.kind === 'NOTIFY_ONLY' && this._groupName(info.group)) { const who = this._notifName(info.from), w = NativePhone.whatText(info.what); this._postNotif(info.group, this._groupName(info.group), info.msgId, who !== 'NEXO' ? who + ': ' + (w || 'Mensaje nuevo') : w, { closed: true }); }
    else if (info.kind === 'NOTIFY_ONLY') notify(NativePhone.whatText(info.what));
  }

  // ---- fuera de alcance (simula alejarse) ----
  setOffline(off) {
    this.offline = off;
    if (!off) return;
    this.radio.phones.forEach((p) => {
      if (p === this) return;
      const drop = (holder, otherAddr) => { holder.emit('onDeviceDisconnected', { deviceId: otherAddr }); holder.buffers.delete(norm(otherAddr)); holder.bin.reset(norm(otherAddr)); };
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

  // Paso de un archivo grande de disco a disco (bytes/s) con avisos de progreso; alive() falso = se corta
  _bigPush(peer, b, id, bps, alive, call, extra, code) {
    const total = b.parts.reduce((n, x) => n + x.length, 0) + b.parts.length * 33;
    const t0 = Date.now();
    peer.big = peer.big || new Map();
    const tick = () => {
      const sent = Math.min(total, Math.round((Date.now() - t0) / 1000 * bps));
      if (!alive()) {
        peer.emit('onBigDone', { id, dir: 'in', ok: false, error: 'conexión cortada (' + sent + ' de ' + total + ' bytes)' });
        this.emit('onBigDone', { id, dir: 'out', ok: false, error: 'Broken pipe' });
        return call.reject('Envío fallido: Broken pipe', code || 'BIG_SEND');
      }
      this.emit('onBigProgress', { id, dir: 'out', bytes: sent, total });
      peer.emit('onBigProgress', { id, dir: 'in', bytes: sent, total });
      if (sent < total) return setTimeout(tick, 400);
      peer.big.set(id, { key: b.key, parts: b.parts, done: true });
      this.stats.bigSent = (this.stats.bigSent || 0) + total;
      peer.emit('onBigDone', { id, dir: 'in', ok: true, error: '' });
      this.emit('onBigDone', { id, dir: 'out', ok: true, error: '' });
      call.resolve(Object.assign({ ok: true, bytes: total }, extra || {}));
    };
    setTimeout(tick, 50);
  }

  advertisedVisible() { return !this.ridKey || Date.now() < (this.ridVisibleUntil || 0); }
  advertised() {
    if (!this.advertisingId) return null;
    if (this.advertisedVisible()) return this.advertisingId;
    return ridToken(this.ridKey, Math.floor(Date.now() / 1000 / this.ridEpochS));
  }

  _resolveMac(raw) {
    const t = classify(raw);
    if (t === 'nxid') {
      // Kotlin quickScanForNexoId: solo lo encuentra si anuncia su NEXO ID ahora (no con código rotativo)
      const p = this.radio.phones.find((x) => x !== this && x.advertised() && x.advertised().toLowerCase() === String(raw).trim().toLowerCase());
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
      setAdvertisingData: wrap('setAdvertisingData', (c, a) => {
        const id = c.getString('nexoId'); if (!id) return c.reject('nexoId requerido');
        self.advertisingId = id; self.serviceRunning = true;
        // Kotlin 2755: clave del código rotativo, hasta cuándo se anuncia el NEXO ID y la época (opts.noRid: build anterior)
        const rk = c.getString('ridKey');
        if (!self.opts.noRid && rk && /^[0-9a-f]{64}$/.test(rk)) { self.ridKey = rk; self.ridVisibleUntil = Number(a.visibleUntil) || 0; self.ridEpochS = Math.max(1, Number(a.epochS) || 900); }
        else if (rk != null) self.ridKey = null;
        self.advLog = self.advLog || []; self.advLog.push({ t: Date.now(), visible: self.advertisedVisible() });
        c.resolve({ set: true, nexoId: id });
      }),
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
          // El nombre del teléfono va en la respuesta al escaneo solo si es visible (Kotlin 2755)
          const adv = p.advertised();
          (self.radio.airAds = self.radio.airAds || []).push({ by: p.name, adv, visible: p.advertisedVisible(), t: Date.now() });
          self.emit('onDeviceFound', { deviceId: p.address, name: p.advertisedVisible() ? p.name : '', rssi: -50, nexoId: adv });
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
      sendBinary: wrap('sendBinary', (c) => {
        if (self.opts.noBinNative) return c.reject('"NexoBle.sendBinary()" is not implemented on android', 'UNIMPLEMENTED');
        const raw = c.getString('deviceId') || '', header = c.getString('header') || '', data = c.getString('data');
        if (!raw || !header || data == null) return c.reject('deviceId, header y data requeridos');
        if (classify(raw) === 'invalid') return c.reject('ID invalido: no es NXID ni MAC', 'INVALID_DEVICE_ID');
        setTimeout(() => {
          const mac = self._resolveMac(raw);
          if (!mac) return c.reject('NXID no resuelto a MAC: ' + raw, 'NXID_UNRESOLVED');
          const mtu = self.mtu.get(mac) || 23;
          const writes = BIN.split(BIN.encode(header, Buffer.from(data, 'base64')), Math.min(Math.max(mtu - 3, 20), 512));
          // Android 13+: una escritura o notificación de más de 512 bytes (máximo de un atributo) lanza
          // IllegalArgumentException; el Kotlin reintenta ~1,8 s y descarta el mensaje entero (ya respondió "en cola")
          if (writes.some((w) => w.length > 512)) { self.stats.tooLongDropped = (self.stats.tooLongDropped || 0) + 1; return c.resolve({ sent: true, mode: 'queued', deviceId: raw, mtu }); }
          const peerAddr = (self.serverConnected.get(mac) || (self.clients.get(mac) || {}).peer || {}).address;
          const q = peerAddr && self.writeQ && self.writeQ.get(norm(peerAddr));
          if (q && q.items.length > 0 && q.items.length + writes.length > 500) return c.reject('Cola de escritura llena', 'BLE_BUSY');
          const mid = (self._mid = (self._mid || 0) + 1);
          const first = self._sendSingleChunk(mac, writes[0], { mid, last: writes.length === 1 });
          if (!first.sent) return c.reject('Sin enlace con ' + mac, 'BLE_BUSY');
          writes.slice(1).forEach((w, k) => self._sendSingleChunk(mac, w, { mid, last: k === writes.length - 2 }));
          c.resolve({ sent: true, mode: 'queued', deviceId: raw, mtu });
        }, 0);
      }),
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
          // Kotlin 2729: cola llena (lo único que da sent:false con enlace) → "ocupado", la app reintenta
          else if (!self.opts.kotlin2722 && r.full) c.reject('Cola de escritura llena', 'BLE_BUSY');
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
        self.radio.wdGroups.set(ssid, { host: self, pass, port, id: a.transferId, bigToken: a.bigToken || null });
        self.stats.wdGroups = (self.stats.wdGroups || 0) + 1;
        setTimeout(() => c.resolve({ ssid, passphrase: pass, port }), 1500);
        setTimeout(() => { if (self.radio.wdGroups.get(ssid)) { self.radio.wdGroups.delete(ssid); if (a.bigToken) self.emit('onBigDone', { id: a.transferId, dir: 'in', ok: false, error: 'Accept timed out' }); else self.emit('onWifiDirectReceived', { transferId: a.transferId, error: 'Accept timed out' }); } }, 90000);
      }),
      wifiDirectSend: wrap('wifiDirectSend', (c, a) => {
        if (!self.opts.wifiDirect || self.opts.wdNoPerm) return c.reject('Wi-Fi Direct no disponible', 'WD_UNAVAILABLE');
        const g = self.radio.wdGroups && self.radio.wdGroups.get(a.ssid);
        const data = String(a.data || '');
        if (!g || g.pass !== a.passphrase || g.port !== a.port || g.id !== a.transferId || !self.radio.inRange(self, g.host) || self.opts.wdFail || g.host.opts.wdFail) {
          return setTimeout(() => c.reject('No se pudo conectar (2)', 'WD_CONNECT'), 3000);
        }
        if (a.bigToken) {
          const b = self.big && self.big.get(a.transferId);
          if (!b || !b.done) return c.reject('Nada que enviar', 'BIG_NONE');
          if (g.bigToken !== a.bigToken) return setTimeout(() => c.reject('Envío fallido: sin confirmación', 'WD_SEND'), 2000);
          self.radio.wdGroups.delete(a.ssid);
          return setTimeout(() => self._bigPush(g.host, b, a.transferId, 2e6, () => self.radio.inRange(self, g.host) && !self.offline && !g.host.offline, c, { joinMs: 2000 }, 'WD_SEND'), 2000);
        }
        const ms = 2000 + Math.round(data.length / 2000);
        setTimeout(() => {
          self.radio.wdGroups.delete(a.ssid);
          self.stats.wdBytes = (self.stats.wdBytes || 0) + data.length;
          g.host.emit('onWifiDirectReceived', { transferId: a.transferId, data, bytes: data.length, readMs: ms - 2000, ts: Date.now() });
          c.resolve({ ok: true, ms, bytes: data.length, joinMs: 2000, xferMs: ms - 2000, bridgeMs: 0 });
        }, ms);
      }),
      // ===== Archivos grandes (Kotlin BigFile.kt, ronda 2756): "cifrado" a disco por trozos y paso de disco a disco.
      // Aquí se guardan los trozos en claro junto con la clave (bigOpen comprueba que la clave es la del emisor).
      // Mismo Wi-Fi ~20 MB/s, Wi-Fi Direct ~2 MB/s; se corta si el otro sale de la red / de alcance.
      bigBegin: wrap('bigBegin', (c, a) => {
        if (!/^[0-9a-f]{64}$/.test(String(a.key || ''))) return c.reject('clave no válida');
        self.big = self.big || new Map();
        self.big.set(a.id, { key: a.key, parts: [], done: false });
        c.resolve({ ok: true });
      }),
      bigAppend: wrap('bigAppend', (c, a) => {
        const b = self.big && self.big.get(a.id);
        if (!b || b.done) return c.reject('sin preparar', 'BIG_NONE');
        b.parts.push(Buffer.from(String(a.data || ''), 'base64'));
        if (a.last) b.done = true;
        const bytes = b.parts.reduce((n, x) => n + x.length, 0);
        self.stats.bigAppends = (self.stats.bigAppends || 0) + 1;
        self.stats.bigMaxSlice = Math.max(self.stats.bigMaxSlice || 0, String(a.data || '').length);
        c.resolve({ bytes, enc: bytes + b.parts.length * 33 });
      }),
      bigStatus: wrap('bigStatus', (c, a) => {
        const b = self.big && self.big.get(a.id);
        c.resolve({ have: !!(b && b.done), bytes: b ? b.parts.reduce((n, x) => n + x.length, 0) + b.parts.length * 33 : 0 });
      }),
      bigDelete: wrap('bigDelete', (c, a) => { if (self.big) self.big.delete(a.id); c.resolve({ ok: true }); }),
      bigServe: wrap('bigServe', (c, a) => {
        if (!a.id || String(a.token || '').length < 16) return c.reject('id y token requeridos');
        self.radio.bigServers = self.radio.bigServers || new Map();
        const port = 30000 + Math.floor(Math.random() * 20000);
        self.radio.bigServers.set(port, { host: self, id: a.id, token: a.token });
        c.resolve({ port });
        setTimeout(() => { if (self.radio.bigServers.get(port)) { self.radio.bigServers.delete(port); self.emit('onBigDone', { id: a.id, dir: 'in', ok: false, error: 'Accept timed out' }); } }, 60000);
      }),
      bigSendLan: wrap('bigSendLan', (c, a) => {
        const peer = self.lanConns && self.lanConns.get(String(a.nx || '').toLowerCase());
        const srv = self.radio.bigServers && self.radio.bigServers.get(a.port);
        const b = self.big && self.big.get(a.id);
        if (!peer || !self.wifiNet || peer.wifiNet !== self.wifiNet) return c.reject('Sin Wi-Fi con ' + a.nx, 'LAN_DOWN');
        if (!b || !b.done) return c.reject('Nada que enviar', 'BIG_NONE');
        if (!srv || srv.host !== peer || srv.id !== a.id || srv.token !== a.token) return setTimeout(() => c.reject('Envío fallido: Connection refused', 'BIG_SEND'), 500);
        self.radio.bigServers.delete(a.port);
        self._bigPush(peer, b, a.id, 20e6, () => peer.wifiNet === self.wifiNet && !!self.wifiNet, c);
      }),
      // ===== Archivos grandes por Bluetooth L2CAP (Kotlin bigServeL2 / bigSendL2, ronda 2758): canal de flujo sobre la
      // conexión Bluetooth (Android 10+; opts.noL2 = teléfono anterior). ~100 KB/s (opts.l2Bps); se corta si se alejan.
      // Llamadas de voz (Kotlin callAudio, ronda 2758): solo se anota el modo
      callAudio: wrap('callAudio', (c, a) => { self.callAudioOn = a.on === true; self.callSpeaker = a.on === true && a.speaker === true; c.resolve({ mode: a.on ? 3 : 0, speakerOn: self.callSpeaker, device: a.on ? (self.callSpeaker ? 'altavoz' : 'auricular') : 'ninguno', volCall: '5/7', volMedia: '9/15' }); }),
      l2Info: wrap('l2Info', (c) => c.resolve({ ok: !self.opts.noL2, sdk: self.opts.noL2 ? 28 : 33 })),
      bigServeL2: wrap('bigServeL2', (c, a) => {
        if (self.opts.noL2) return c.reject('L2CAP no disponible (Android 10+ y Bluetooth activo)', 'L2_NONE');
        if (!a.id || String(a.token || '').length < 16) return c.reject('id y token requeridos');
        self.radio.l2Servers = self.radio.l2Servers || new Map();
        const psm = 0x80 + Math.floor(Math.random() * 0x7f);
        self.radio.l2Servers.set(psm, { host: self, id: a.id, token: a.token });
        c.resolve({ psm });
        setTimeout(() => { if (self.radio.l2Servers.get(psm) && self.radio.l2Servers.get(psm).id === a.id) { self.radio.l2Servers.delete(psm); self.emit('onBigDone', { id: a.id, dir: 'in', ok: false, error: 'L2CAP: Accept timed out' }); } }, 60000);
      }),
      bigSendL2: wrap('bigSendL2', (c, a) => {
        if (self.opts.noL2) return c.reject('L2CAP no disponible', 'L2_NONE');
        const mac = norm(a.deviceId || '');
        const peer = self.radio.phones.find((p) => p !== self && (norm(p.address) === mac || norm(p.initAddress) === mac));
        const b = self.big && self.big.get(a.id);
        if (!b || !b.done) return c.reject('Nada que enviar', 'BIG_NONE');
        const srv = self.radio.l2Servers && self.radio.l2Servers.get(a.psm);
        if (!peer || !srv || srv.host !== peer || srv.id !== a.id || srv.token !== a.token || !self.radio.inRange(self, peer) || peer.offline || self.offline) {
          self.emit('onBigDone', { id: a.id, dir: 'out', ok: false, error: 'L2CAP: read failed, socket might closed or timeout' });
          return setTimeout(() => c.reject('Envío fallido: read failed, socket might closed or timeout', 'BIG_SEND'), 1500);
        }
        self.radio.l2Servers.delete(a.psm);
        self.stats.l2Sends = (self.stats.l2Sends || 0) + 1;
        setTimeout(() => self._bigPush(peer, b, a.id, self.opts.l2Bps || 100e3, () => self.radio.inRange(self, peer) && !peer.offline && !self.offline, c, { l2: true }), 300);
      }),
      bigOpen: wrap('bigOpen', (c, a) => {
        const b = self.big && self.big.get(a.id);
        if (!b || !b.done) return c.resolve({ opened: false, reason: 'missing' });
        if (a.key !== b.key) return c.reject('No se pudo abrir: archivo dañado o clave incorrecta', 'BIG_OPEN');
        const all = Buffer.concat(b.parts);
        self.opened = self.opened || [];
        self.opened.push({ name: a.name, mime: a.mime, bytes: all.length, sha: nodeCrypto.createHash('sha256').update(all).digest('hex'), big: true });
        c.resolve({ opened: true });
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
      saveToFile: wrap('saveToFile', (c) => { const f = c.getString('filename'); const t = c.getString('content'); if (f == null) return c.reject('filename requerido'); if (t == null) return c.reject('content requerido'); if (self.moveFrozen) { self.stats.frozenSaves = (self.stats.frozenSaves || 0) + 1; return c.resolve({ success: true, frozen: true }); } self.files.set(f, t); self.stats.saves++; self.stats.saveBytes += t.length; self.stats.maxSave = Math.max(self.stats.maxSave, t.length); self._io(() => c.resolve({ success: true, path: '/data/' + f })); }),
      loadFromFile: wrap('loadFromFile', (c) => { const f = c.getString('filename'); if (f == null) return c.reject('filename requerido'); if (!self.files.has(f)) return self._io(() => c.resolve({ exists: false, content: '' })); const content = self.files.get(f); self._io(() => c.resolve({ exists: true, content, path: '/data/' + f })); }),
      deleteFile: wrap('deleteFile', (c) => { if (self.moveFrozen) return c.resolve({ deleted: false, frozen: true }); c.resolve({ deleted: self.files.delete(c.getString('filename')) }); }),
      // ===== Pasar la cuenta a un teléfono nuevo (Kotlin moveReceive / moveSend + AccountMove.kt, ronda 2759; probado en
      // tests/kotlin/AccountMoveTest). Mismo Wi-Fi; ~5 MB/s. El nuevo guarda antes de confirmar; el viejo borra lo suyo al
      // confirmarse; los dos piden reiniciarse (self.restartWanted: la prueba los vuelve a arrancar)
      moveReceive: wrap('moveReceive', (c) => {
        if (!self.wifiNet) return c.reject('Conecta este teléfono a un Wi-Fi (el mismo que el otro)', 'NO_WIFI');
        self.radio.moveServers = self.radio.moveServers || new Map();
        const port = 40000 + Math.floor(Math.random() * 20000), hex = (n) => nodeCrypto.randomBytes(n).toString('hex');
        const srv = { host: self, id: 'move' + hex(6), token: hex(16), key: hex(32) };
        self.radio.moveServers.set(port, srv);
        c.resolve({ ip: '192.168.1.' + (10 + self.radio.phones.indexOf(self)), port, id: srv.id, token: srv.token, key: srv.key });
      }),
      moveSend: wrap('moveSend', (c, a) => {
        const srv = self.radio.moveServers && self.radio.moveServers.get(a.port);
        if (!srv || !self.wifiNet || srv.host.wifiNet !== self.wifiNet || srv.id !== a.id || srv.token !== a.token || srv.key !== a.key || !String(a.ip).startsWith('192.168.1.')) {
          return setTimeout(() => { self.emit('onMoveDone', { dir: 'out', ok: false, error: 'Connection refused' }); c.reject('No se pudo pasar la cuenta: Connection refused', 'MOVE_SEND'); }, 500);
        }
        const peer = srv.host, travels = (n) => /^nexo_/.test(n) && !/^nexo_diag|^nexo_bg_inbox|\.nxtmp$/.test(n);
        self.moveFrozen = true;
        const pack = Array.from(self.files.entries()).filter(([n]) => travels(n));
        const bytes = pack.reduce((t, [, v]) => t + String(v).length, 0);
        self.stats.moveFiles = pack.length; self.stats.moveBytes = bytes;
        const ms = 300 + Math.round(bytes / 5000);
        self.emit('onMoveProgress', { dir: 'out', bytes: Math.round(bytes / 2), total: bytes }); peer.emit('onMoveProgress', { dir: 'in', bytes: Math.round(bytes / 2), total: bytes });
        setTimeout(() => {
          self.radio.moveServers.delete(a.port);
          peer.moveFrozen = true;
          Array.from(peer.files.keys()).filter(travels).forEach((n) => peer.files.delete(n));
          pack.forEach(([n, v]) => peer.files.set(n, v));
          peer.big = new Map(self.big || []);
          peer.restartWanted = true;
          peer.emit('onMoveDone', { dir: 'in', ok: true, files: pack.length, bytes });
          // Viejo: deja de anunciarse, suelta las conexiones y borra lo suyo
          self.advertisingId = null;
          Array.from(self.files.keys()).filter(travels).forEach((n) => self.files.delete(n));
          self.big = new Map();
          self.restartWanted = true;
          self.emit('onMoveDone', { dir: 'out', ok: true, files: pack.length, bytes });
          c.resolve({ ok: true, files: pack.length, bytes });
        }, ms);
      }),
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
      // Wi-Fi normal (Kotlin: LanHub + NSD). opts.wifi = nombre de la red (o null). Mismo nombre = misma red: se
      // descubren (onLanPeer con la marca del otro), conectan (onLanUp en los dos) y se mandan mensajes en orden
      // (~20 MB/s). setWifi(red|null) en la prueba: salir de la red cierra sus conexiones; el otro solo se entera
      // si opts.lanSilent es falso (con TCP real, a veces no se entera: lo detecta la app por falta de latido).
      // peers: calidad que mide el latido nativo (opts.lanRtt = ida y vuelta simulada; un otro que se fue sin cerrar
      // deja de contestar: "idle" crece y a los 30 s el nativo cierra)
      lanStatus: wrap('lanStatus', (c) => {
        const now = Date.now(), peers = [];
        if (self.lanConns) self.lanConns.forEach((p, nx) => {
          const alive = p.wifiNet && p.wifiNet === self.wifiNet && p.lanConns && self.lan && p.lanConns.get(self.lan.nx) === self;
          peers.push({ nx, rtt: alive ? (self.opts.lanRtt || 5) : -1, idle: alive ? 0 : now - ((self.lanStale && self.lanStale[nx]) || now) });
        });
        c.resolve({ supported: true, wifi: !!self.wifiNet, running: !!self.lan, port: self.lan ? self.lan.port : 0, peers });
      }),
      lanStart: wrap('lanStart', (c, a) => {
        const nx = String(a.nexoId || '').toLowerCase(), token = a.token;
        if (!nx || !token) return c.reject('nexoId y token requeridos');
        self.lan = Object.assign(self.lan || { port: 40000 + Math.floor(Math.random() * 20000) }, { nx, token });
        self.stats.lanStarts = (self.stats.lanStarts || 0) + 1;
        c.resolve({ port: self.lan.port, wifi: !!self.wifiNet });
        setTimeout(() => self._lanAnnounce(), 30);
      }),
      lanConnect: wrap('lanConnect', (c, a) => {
        c.resolve({ connecting: true });
        setTimeout(() => {
          const t = self.radio.phones.find((p) => p.name === a.host && p.lan && p.lan.port === a.port);
          if (!t || !self.lan || !self.wifiNet || t.wifiNet !== self.wifiNet) return;
          self._lanLink(t);
        }, 20);
      }),
      lanSend: wrap('lanSend', (c, a) => {
        const peer = self.lanConns && self.lanConns.get(String(a.nx || '').toLowerCase());
        const content = String(a.content || '');
        if (!peer || !self.wifiNet) return c.reject('Sin conexión Wi-Fi con ' + a.nx, 'LAN_DOWN');
        self.stats.lanOut = (self.stats.lanOut || 0) + 1; self.stats.lanOutBytes = (self.stats.lanOutBytes || 0) + content.length;
        const from = self.lan.nx;
        self._lanQ = (self._lanQ || Promise.resolve()).then(() => new Promise((done) => setTimeout(() => {
          // Llega solo si los dos siguen en la misma red y el otro aún tiene la conexión
          if (peer.wifiNet && peer.wifiNet === self.wifiNet && peer.lanConns && peer.lanConns.get(from) === self) { peer._bgNotify(content); peer.emit('onLanMessage', { nx: from, content }); }
          else self.stats.lanLost = (self.stats.lanLost || 0) + 1;
          done();
        }, 2 + content.length / ((self.opts.lanBps || 20e6) / 1000))));
        c.resolve({ sent: true });
      }),
      lanDrop: wrap('lanDrop', (c, a) => { self._lanClose(String(a.nx || '').toLowerCase(), false); c.resolve({ dropped: true }); }),
      lanStop: wrap('lanStop', (c) => { if (self.lanConns) Array.from(self.lanConns.keys()).forEach((nx) => self._lanClose(nx, false)); self.lan = null; c.resolve({ stopped: true }); }),
      // Tor (Kotlin: TorService + servicio oculto + LanHub por SOCKS). Modelo: torStart tarda opts.torBootMs y da una
      // dirección .onion; torConnect a la .onion de otro teléfono con Tor lo conecta (onTorUp en los dos, con el NEXO ID
      // que cada uno dice tener: un impostor puede decir otro); torSend llega en orden con latencia (opts.torLatency,
      // por defecto 300 ms) y ~opts.torBps (50 KB/s). opts.noTor: Tor no arranca.
      torStatus: wrap('torStatus', (c) => c.resolve({ supported: true, running: !!self.tor, onion: self.tor ? self.tor.onion : '', port: 9878, peers: [] })),
      torStart: wrap('torStart', (c, a) => {
        c.resolve({ starting: true });
        self.stats.torStarts = (self.stats.torStarts || 0) + 1;
        setTimeout(() => {
          if (self.opts.noTor) { self.emit('onTorReady', { error: 'Tor no terminó de arrancar' }); return; }
          const base = 'abcdefghijklmnopqrstuvwxyz234567';
          let onion = ''; for (let i = 0; i < 56; i++) onion += base[(self.name.charCodeAt(0) * 7 + i * 13 + self.name.length) % 32];
          self.tor = { onion: onion + '.onion', nx: String(a.nexoId || '').toLowerCase(), conns: new Map() };
          self.emit('onTorReady', { onion: self.tor.onion, port: 9878 });
        }, self.opts.torBootMs || 1500);
      }),
      torConnect: wrap('torConnect', (c, a) => {
        if (!self.tor) return c.reject('Tor no listo', 'TOR_DOWN');
        c.resolve({ connecting: true });
        setTimeout(() => {
          const t = self.radio.phones.find((p) => p.tor && p.tor.onion === a.host && !p.offline);
          if (!t || !self.tor || t === self) return;
          self.tor.conns.set(t.tor.nx, t); t.tor.conns.set(self.tor.nx, self);
          self.emit('onTorUp', { nx: t.tor.nx }); t.emit('onTorUp', { nx: self.tor.nx });
        }, self.opts.torLatency || 300);
      }),
      torSend: wrap('torSend', (c, a) => {
        const peer = self.tor && self.tor.conns.get(String(a.nx || '').toLowerCase());
        if (!peer || peer.offline || !peer.tor) return c.reject('Sin conexión Tor con ' + a.nx, 'TOR_DOWN');
        const content = String(a.content || ''), from = self.tor.nx;
        self.stats.torOut = (self.stats.torOut || 0) + 1;
        // Una conexión TCP: los paquetes van seguidos (la latencia no se suma por paquete); llegan en orden
        const now = Date.now(), lat = self.opts.torLatency || 300, xfer = content.length / ((self.opts.torBps || 50000) / 1000);
        self._torFree = Math.max(self._torFree || 0, now) + xfer;
        const at = Math.max(self._torFree + lat, self._torLast || 0);
        self._torLast = at;
        setTimeout(() => { if (peer.tor && peer.tor.conns.get(from) === self) peer.emit('onTorMessage', { nx: from, content }); }, at - now);
        c.resolve({ sent: true });
      }),
      torDrop: wrap('torDrop', (c, a) => {
        const nx = String(a.nx || '').toLowerCase(), peer = self.tor && self.tor.conns.get(nx);
        if (peer) { self.tor.conns.delete(nx); self.emit('onTorDown', { nx }); if (peer.tor) { peer.tor.conns.delete(self.tor.nx); peer.emit('onTorDown', { nx: self.tor.nx }); } }
        c.resolve({ dropped: true });
      }),
      torStop: wrap('torStop', (c) => { if (self.tor) self.tor.conns.forEach((p, nx) => { if (p.tor) { p.tor.conns.delete(self.tor.nx); p.emit('onTorDown', { nx: self.tor.nx }); } }); self.tor = null; c.resolve({ stopped: true }); }),
      // Notificaciones de mensajes (MsgNotifier.kt): una por chat con su número; el icono de la app suma los números
      notifyMessage: wrap('notifyMessage', (c, a) => { c.resolve({ count: self._postNotif(a.chatId, a.name, a.msgId, a.text, {}) }); }),
      // Ronda 2763 (MsgNotifier.incomingCall): aviso de llamada con tono; Contestar / Rechazar quedan en pendingAnswer / pendingDecline
      notifyCall: wrap('notifyCall', (c, a) => { self.callNotif = { from: String(a.chatId || '').toLowerCase(), video: !!a.video }; self.notifLog.push({ t: Date.now(), chatId: self.callNotif.from, name: a.name, text: '📞 Llamada entrante', call: true }); c.resolve({}); }),
      clearCall: wrap('clearCall', (c) => { self.callNotif = null; c.resolve({}); }),
      callAction: wrap('callAction', (c) => { const o = {}; if (self.pendingAnswer) o.answer = self.pendingAnswer; if (self.pendingDecline) o.declined = self.pendingDecline; self.pendingAnswer = null; self.pendingDecline = null; c.resolve(o); }),
      // Escucha nativa de internet en segundo plano (NetBg.kt; probada en tests/kotlin/NetBgTest): se guarda la configuración
      netBgConfig: wrap('netBgConfig', (c, a) => { self.netBg = a; self.netBgCalls = (self.netBgCalls || 0) + 1; c.resolve({ contacts: (a.contacts || []).length, running: false }); }),
      ensureNotificationPermission: wrap('ensureNotificationPermission', (c) => { self.notifPermAsked = (self.notifPermAsked || 0) + 1; c.resolve({ granted: !self.opts.noNotifPerm }); }),
      clearChatNotification: wrap('clearChatNotification', (c, a) => { self.notifications.delete(String(a.chatId || '').toLowerCase()); c.resolve({}); }),
      syncUnread: wrap('syncUnread', (c, a) => {
        const want = new Map((a.chats || []).map((x) => [String(x.chatId).toLowerCase(), x.count || 0]));
        for (const [id, n] of self.notifications) { const k = want.get(id) || 0; if (!k) self.notifications.delete(id); else { n.base = k; n.ids.clear(); } }
        c.resolve({});
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
  // Internet: sin relés salvo que la prueba ponga los suyos (en GitHub hay salida a internet y los "teléfonos"
  // se conectaban a los relés públicos de verdad)
  if (!win.NEXO_NET_RELAYS) win.NEXO_NET_RELAYS = [];
  const wc = require('crypto').webcrypto;
  Object.defineProperty(win, 'crypto', { configurable: true, value: wc });
  const util = require('util');
  if (!win.TextEncoder) win.TextEncoder = util.TextEncoder;
  if (!win.TextDecoder) win.TextDecoder = util.TextDecoder;
}

module.exports = { Radio, NativePhone, norm, installWebCrypto };
