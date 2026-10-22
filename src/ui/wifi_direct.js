/**
 * wifi_direct.js v1.1 — Fotos, vídeos y archivos por Wi-Fi Direct con un contacto a alcance.
 *
 * Bluetooth es el canal de control; Wi-Fi Direct solo lleva el contenido (ya cifrado de extremo a extremo):
 *   A → B  'wq' { id, size, meta }        ¿recibes por Wi-Fi Direct?
 *   B      crea un grupo (nombre y contraseña aleatorios, nuevos en cada envío) y abre un socket
 *   B → A  'wa' { id, c: E1(credenciales) } (cifradas para A) — o 'wn' si no puede
 *   A      se une al grupo y manda el contenido; B confirma por el socket, lo entrega a la app y
 *   B → A  'wf' { id }                     entregado (✓✓)
 * Si algo falla, el archivo sigue por Bluetooth como siempre. Solo con teléfonos que anuncian que lo
 * tienen (kx con wd:1, Android 10+) y para contenidos de más de WD_MIN_BYTES (para poco no compensa
 * montar el grupo). Una transferencia a la vez.
 */
import { e2eEncryptText, e2eDecryptText, e2eMyPublicKey } from '../vault/e2e_crypto.js';
import { e2eAnyEncrypted } from '../vault/e2e_proto.js';

export var WD_MIN_BYTES = 150000;    // ~35 s por Bluetooth a la velocidad medida; montar el grupo son ~5 s
export var WD_MAX_BYTES = 30000000;  // contenido cifrado en base64 (~22 MB de archivo)
var OFFER_TIMEOUT_MS = 25000;
var DONE_TIMEOUT_MS = 45000;

function _nid(id) { return (id || '').toString().toLowerCase().trim(); }
function _mac(m) { return (m || '').toString().toLowerCase().replace(/[:-]/g, '').trim(); }
function _plugin() { return (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.NexoBLE) || null; }

export class WifiDirect {
  constructor(ble) {
    this.ble = ble;
    this.status = null;          // { supported, granted, wifiOn }
    this.peers = new Set();      // nexoIds que anunciaron wd:1
    this.out = new Map();        // id → { onCreds, onDone, reject }
    this.incoming = new Map();   // id → { meta, deviceId, from, ts }
    this.busy = false;
    this._asked = false;
    this._listener = null;
  }

  init() {
    var self = this, pl = _plugin();
    if (!pl || typeof pl.wifiDirectStatus !== 'function') return Promise.resolve(null);
    if (!self._listener && typeof pl.addListener === 'function') {
      self._listener = pl.addListener('onWifiDirectReceived', function(ev) { self._onReceived(ev); });
    }
    return pl.wifiDirectStatus().then(function(st) {
      self.status = st || null;
      if (st && st.supported) console.log('[WIFI-DIRECT] Disponible' + (st.granted ? '' : ' (falta permiso)') + (st.wifiOn ? '' : ', Wi-Fi apagado'));
      return st;
    }).catch(function() { return null; });
  }

  supported() { return !!(this.status && this.status.supported); }
  markPeer(nexoId) { var nx = _nid(nexoId); if (nx && !this.peers.has(nx)) { this.peers.add(nx); console.log('[WIFI-DIRECT] ' + nx + ' también lo tiene'); } }

  _nexoOf(deviceId) { return _nid(this.ble && this.ble._macToNexoId && this.ble._macToNexoId.get(_mac(deviceId))); }

  _directReady(deviceId) {
    var st = this.ble && typeof this.ble._getDeviceState === 'function' ? this.ble._getDeviceState(deviceId) : null;
    return !!(st && (st.state === 'ready_to_chat' || st.state === 'notifications_ready'));
  }

  // ¿Se puede usar con este contacto ahora? (los dos lo tienen y hay enlace Bluetooth directo)
  canReach(nexoId) {
    var nx = _nid(nexoId);
    if (!this.supported() || !this.peers.has(nx) || !this.ble) return false;
    var dev = typeof this.ble._resolveDeviceIdForNexoId === 'function' ? this.ble._resolveDeviceIdForNexoId(nx) : null;
    return !!dev && this._directReady(dev);
  }

  eligible(deviceId, bytes) {
    if (this.busy || !this.supported() || bytes < WD_MIN_BYTES || bytes > WD_MAX_BYTES) return false;
    return this.peers.has(this._nexoOf(deviceId)) && this._directReady(deviceId);
  }

  _ensurePermission() {
    var self = this, pl = _plugin();
    if (self.status && self.status.granted) return Promise.resolve(true);
    if (!pl || typeof pl.requestWifiDirectPermission !== 'function' || self._asked) return Promise.resolve(false);
    self._asked = true;
    return pl.requestWifiDirectPermission().then(function(r) {
      var ok = !!(r && r.granted);
      if (self.status) self.status.granted = ok;
      return ok;
    }).catch(function() { return false; });
  }

  _ctl(deviceId, obj) {
    obj.v = 1;
    obj.from = _nid(this.ble.localNexoId);
    return this.ble._sendMessageNative(deviceId, JSON.stringify(obj), null);
  }

  // Envío: resuelve cuando el otro confirma que lo tiene; rechaza si hay que ir por Bluetooth
  send(deviceId, fileId, data, meta) {
    var self = this;
    var peer = self._nexoOf(deviceId);
    self.busy = true;
    var t0 = Date.now();
    return self._ensurePermission().then(function(ok) {
      if (!ok) throw new Error('sin permiso de Wi-Fi Direct');
      return new Promise(function(resolve, reject) {
        var st = { reject: reject };
        var offerTimer = setTimeout(function() { self.out.delete(fileId); reject(new Error('sin respuesta')); }, OFFER_TIMEOUT_MS);
        st.onNo = function(why) { clearTimeout(offerTimer); self.out.delete(fileId); reject(new Error('el otro no puede (' + (why || '?') + ')')); };
        st.onCreds = function(c) {
          clearTimeout(offerTimer);
          var doneTimer = null;
          st.onDone = function() { clearTimeout(doneTimer); self.out.delete(fileId); resolve(); };
          e2eDecryptText(c).then(function(r) {
            var cr = JSON.parse(r.text);
            console.log('[WIFI-DIRECT] Enviando ' + fileId + ' (' + Math.round(data.length / 1024) + ' KB) a ' + peer);
            return _plugin().wifiDirectSend({ ssid: cr.s, passphrase: cr.p, port: cr.o, transferId: fileId, data: data });
          }).then(function(res) {
            console.log('[WIFI-DIRECT] ' + fileId + ' transferido en ' + Math.round((res && res.ms || 0) / 100) / 10 + ' s');
            doneTimer = setTimeout(function() { self.out.delete(fileId); reject(new Error('sin confirmación de entrega')); }, DONE_TIMEOUT_MS);
          }).catch(function(e) { self.out.delete(fileId); reject(e); });
        };
        self.out.set(fileId, st);
        var wire = Object.assign({}, meta);
        self._ctl(deviceId, { type: 'wq', id: fileId, size: data.length, meta: wire, pk: e2eMyPublicKey() }).catch(function(e) { clearTimeout(offerTimer); self.out.delete(fileId); reject(e); });
      });
    }).then(function() {
      self.busy = false;
      console.log('[WIFI-DIRECT] ' + fileId + ' entregado en ' + Math.round((Date.now() - t0) / 100) / 10 + ' s');
    }, function(e) {
      self.busy = false;
      console.warn('[WIFI-DIRECT] ' + fileId + ': ' + (e && e.message) + ' → por Bluetooth');
      throw e;
    });
  }

  // Paquetes de control (llegan por Bluetooth). true si era de Wi-Fi Direct.
  handle(p, deviceId) {
    var self = this;
    if (!p || !/^w[qanf]$/.test(p.type || '')) return false;
    var id = String(p.id || '');
    if (!id) return true;
    var st = self.out.get(id);
    if (p.type === 'wa') { if (st && st.onCreds) st.onCreds(p.c); return true; }
    if (p.type === 'wn') { if (st && st.onNo) st.onNo(p.why); return true; }
    if (p.type === 'wf') { if (st && st.onDone) st.onDone(); return true; }
    // 'wq': nos ofrecen un archivo
    var from = _nid(p.from);
    var no = function(why) { self._ctl(deviceId, { type: 'wn', id: id, why: why }).catch(function() {}); };
    if (!self.supported()) { no('no soportado'); return true; }
    if (self.busy || self.incoming.size) { no('ocupado'); return true; }
    if (!(p.size > 0) || p.size > WD_MAX_BYTES) { no('tamaño'); return true; }
    // Clave para cifrar las credenciales: la guardada del contacto o, si aún no es contacto, la que trae la
    // oferta (las credenciales solo sirven para mandarnos datos, que igualmente deben venir cifrados)
    var key = (self.ble.ackSystem && self.ble.ackSystem._peerKey(deviceId, from)) ||
      ((typeof p.pk === 'string' && /^[A-Za-z0-9+/=]{80,100}$/.test(p.pk)) ? p.pk : null);
    if (!key) { no('sin clave'); return true; }
    self.busy = true;
    self._ensurePermission().then(function(ok) {
      if (!ok) throw new Error('sin permiso');
      return _plugin().wifiDirectHost({ transferId: id, size: p.size });
    }).then(function(cr) {
      self.incoming.set(id, { meta: p.meta || {}, deviceId: deviceId, from: from, ts: Date.now() });
      setTimeout(function() { if (self.incoming.delete(id)) self.busy = false; }, 120000);
      return e2eEncryptText(key, JSON.stringify({ s: cr.ssid, p: cr.passphrase, o: cr.port }));
    }).then(function(c) {
      return self._ctl(deviceId, { type: 'wa', id: id, c: c });
    }).catch(function(e) {
      self.busy = false;
      self.incoming.delete(id);
      console.warn('[WIFI-DIRECT] No puedo recibir ' + id + ': ' + (e && e.message));
      no(e && e.message);
    });
    return true;
  }

  _onReceived(ev) {
    var self = this;
    var id = ev && ev.transferId;
    var inc = id && self.incoming.get(id);
    self.incoming.delete(id);
    self.busy = false;
    if (!inc) return;
    if (ev.error || !ev.data || !e2eAnyEncrypted(ev.data)) {
      console.warn('[WIFI-DIRECT] Recepción de ' + id + ' fallida: ' + (ev.error || 'contenido no válido'));
      return;
    }
    console.log('[WIFI-DIRECT] Recibido ' + id + ' (' + Math.round(ev.data.length / 1024) + ' KB)');
    var ack = self.ble.ackSystem;
    if (ack) {
      // Como un flujo terminado: si luego llega también por Bluetooth, se descarta
      if (ack.completedMessages) ack.completedMessages.set(id, { total: 1, expireAt: Date.now() + 600000 });
      var m = Object.assign({}, inc.meta, { fr: inc.meta.fr || inc.from, senderNexoId: inc.meta.fr || inc.from, fromNexoId: inc.meta.fr || inc.from });
      ack._dispatchFileComplete(id, ev.data, m);
    }
    self._ctl(inc.deviceId, { type: 'wf', id: id }).catch(function() {});
  }
}

export function createWifiDirect(ble) { return new WifiDirect(ble); }
