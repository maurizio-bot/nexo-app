/**
 * wifi_direct.js v1.2 — Fotos, vídeos y archivos por Wi-Fi Direct con un contacto a alcance.
 * v1.3: entregado en cuanto el receptor confirma por el propio socket (tiene todos los bytes): antes se esperaba
 *       además 'wf' por Bluetooth y, si tardaba >45 s, se daba por fallido y el vídeo se volvía a mandar como
 *       previa + HD por Bluetooth aunque ya hubiera llegado. Tiempos por fase en el diagnóstico.
 * v1.2: si falla con un contacto, no se vuelve a intentar con él durante FAIL_COOLDOWN_MS (todo va por
 *       Bluetooth); sin permiso en este teléfono deja de anunciarse y de usarse; esperas acotadas (permiso
 *       y envío). Hasta la 2712 el permiso de Android 13+ no estaba declarado y nunca se concedía.
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
 * v1.4 (ronda 2756): archivos grandes (big_file.js): 'wq' con big:1; el receptor abre el socket con un token (va en
 *       las credenciales cifradas) y lo recibido va a disco (BigFile.kt), no a la app; el emisor manda desde el disco.
 */
import { e2eEncryptText, e2eDecryptText, e2eMyPublicKey } from '../vault/e2e_crypto.js';
import { e2eAnyEncrypted } from '../vault/e2e_proto.js';

export var WD_MIN_BYTES = 150000;    // ~35 s por Bluetooth a la velocidad medida; montar el grupo son ~5 s
export var WD_MAX_BYTES = 30000000;  // contenido cifrado en base64 (~22 MB de archivo)
var OFFER_TIMEOUT_MS = 25000;
var PERM_TIMEOUT_MS = 60000;
var FAIL_COOLDOWN_MS = 10 * 60000;

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
    this.denied = false;         // el permiso se pidió y no se concedió
    this.failUntil = {};         // nexoId → hasta cuándo no se intenta (falló)
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
      if (st && st.granted) self.denied = false;
      if (st && st.supported) console.log('[WIFI-DIRECT] Disponible' + (st.granted ? '' : ' (falta permiso)') + (st.wifiOn ? '' : ', Wi-Fi apagado'));
      return st;
    }).catch(function() { return null; });
  }

  supported() { return !!(this.status && this.status.supported) && !this.denied; }
  // Falló con este contacto: un rato todo por Bluetooth (no se deja nada esperando a Wi-Fi Direct)
  noteFail(nexoId) {
    var nx = _nid(nexoId);
    if (!nx) return;
    this.failUntil[nx] = Date.now() + FAIL_COOLDOWN_MS;
    console.warn('[WIFI-DIRECT] Con ' + nx + ' no funcionó: por Bluetooth durante ' + Math.round(FAIL_COOLDOWN_MS / 60000) + ' min');
  }
  _cooling(nx) { return (this.failUntil[nx] || 0) > Date.now(); }
  unmarkPeer(nexoId) { var nx = _nid(nexoId); if (nx && this.peers.delete(nx)) console.log('[WIFI-DIRECT] ' + nx + ' ya no lo tiene disponible'); }
  markPeer(nexoId) { var nx = _nid(nexoId); if (nx && !this.peers.has(nx)) { this.peers.add(nx); console.log('[WIFI-DIRECT] ' + nx + ' también lo tiene'); } }

  _nexoOf(deviceId) { return _nid(this.ble && this.ble._macToNexoId && this.ble._macToNexoId.get(_mac(deviceId))); }

  _directReady(deviceId) {
    var st = this.ble && typeof this.ble._getDeviceState === 'function' ? this.ble._getDeviceState(deviceId) : null;
    return !!(st && (st.state === 'ready_to_chat' || st.state === 'notifications_ready'));
  }

  // ¿Se puede usar con este contacto ahora? (los dos lo tienen y hay enlace Bluetooth directo)
  canReach(nexoId) {
    var nx = _nid(nexoId);
    if (!this.supported() || !this.peers.has(nx) || this._cooling(nx) || !this.ble) return false;
    var dev = typeof this.ble._resolveDeviceIdForNexoId === 'function' ? this.ble._resolveDeviceIdForNexoId(nx) : null;
    return !!dev && this._directReady(dev);
  }

  eligible(deviceId, bytes) {
    if (this.busy || !this.supported() || bytes < WD_MIN_BYTES || bytes > WD_MAX_BYTES) return false;
    var nx = this._nexoOf(deviceId);
    return this.peers.has(nx) && !this._cooling(nx) && this._directReady(deviceId);
  }

  _ensurePermission() {
    var self = this, pl = _plugin();
    if (self.status && self.status.granted) return Promise.resolve(true);
    if (!pl || typeof pl.requestWifiDirectPermission !== 'function' || self._asked) return Promise.resolve(false);
    self._asked = true;
    var timer = null;
    return Promise.race([
      pl.requestWifiDirectPermission().then(function(r) { return !!(r && r.granted); }).catch(function() { return false; }),
      new Promise(function(res) { timer = setTimeout(function() { res(null); }, PERM_TIMEOUT_MS); })
    ]).then(function(ok) {
      clearTimeout(timer);
      if (ok === null) { self._asked = false; return false; } // sin respuesta: se puede volver a pedir
      if (self.status) self.status.granted = ok;
      if (!ok) { self.denied = true; console.warn('[WIFI-DIRECT] Permiso no concedido: todo por Bluetooth'); }
      return ok;
    });
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
          var tCreds = Date.now();
          st.onDone = function() {}; // 'wf' llega después; la entrega ya la confirmó el socket
          e2eDecryptText(c).then(function(r) {
            var cr = JSON.parse(r.text);
            console.log('[WIFI-DIRECT] Enviando ' + fileId + ' (' + Math.round(data.length / 1024) + ' KB) a ' + peer);
            // Tope: unirse al grupo (~20 s) + el contenido a 100 KB/s como mínimo
            var sendTimer = null;
            return Promise.race([
              _plugin().wifiDirectSend({ ssid: cr.s, passphrase: cr.p, port: cr.o, transferId: fileId, data: data, jsTs: Date.now() }),
              new Promise(function(res, rej) { sendTimer = setTimeout(function() { rej(new Error('envío sin terminar')); }, 30000 + Math.round(data.length / 100)); })
            ]).then(function(v) { clearTimeout(sendTimer); return v; }, function(e) { clearTimeout(sendTimer); throw e; });
          }).then(function(res) {
            var sec = function(ms) { return Math.round((ms || 0) / 100) / 10 + ' s'; };
            // Fases: oferta→credenciales (el otro crea el grupo), paso de datos a Android, unirse al grupo, envío
            console.log('[WIFI-DIRECT] ' + fileId + ' fases: grupo del otro ' + sec(tCreds - t0) + ', a Android ' + sec(res && res.bridgeMs) +
              ', unirse ' + sec(res && res.joinMs) + ', envío ' + sec(res && res.xferMs) + ' (' + Math.round((data.length / 1024) / Math.max(0.1, ((res && res.xferMs) || 1) / 1000)) + ' KB/s)');
            self.out.delete(fileId);
            resolve();
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
      self.noteFail(peer);
      throw e;
    });
  }

  // Archivo grande ya cifrado en disco (big_file.js): misma negociación; el contenido va de disco a disco
  sendBig(deviceId, fileId, size) {
    var self = this, peer = self._nexoOf(deviceId);
    if (self.busy) return Promise.reject(new Error('Wi-Fi Direct ocupado'));
    self.busy = true;
    return self._ensurePermission().then(function(ok) {
      if (!ok) throw new Error('sin permiso de Wi-Fi Direct');
      return new Promise(function(resolve, reject) {
        var st = {};
        var offerTimer = setTimeout(function() { self.out.delete(fileId); reject(new Error('sin respuesta')); }, OFFER_TIMEOUT_MS);
        st.onNo = function(why) { clearTimeout(offerTimer); self.out.delete(fileId); reject(new Error('el otro no puede (' + (why || '?') + ')')); };
        st.onCreds = function(c) {
          clearTimeout(offerTimer);
          st.onDone = function() {};
          e2eDecryptText(c).then(function(r) {
            var cr = JSON.parse(r.text);
            if (!cr.t) throw new Error('sin token');
            return _plugin().wifiDirectSend({ ssid: cr.s, passphrase: cr.p, port: cr.o, transferId: fileId, bigToken: cr.t, jsTs: Date.now() });
          }).then(function(res) { self.out.delete(fileId); resolve(res); }, function(e) { self.out.delete(fileId); reject(e); });
        };
        self.out.set(fileId, st);
        self._ctl(deviceId, { type: 'wq', id: fileId, size: size, big: 1, meta: {}, pk: e2eMyPublicKey() }).catch(function(e) { clearTimeout(offerTimer); self.out.delete(fileId); reject(e); });
      });
    }).then(function(r) { self.busy = false; return r; }, function(e) {
      self.busy = false;
      console.warn('[WIFI-DIRECT] Archivo grande ' + fileId + ': ' + (e && e.message));
      // Cortado a mitad (WD_SEND: se alejó, se apagó…): Wi-Fi Direct sí funciona con él; se puede reintentar ya
      if (!(e && e.code === 'WD_SEND')) self.noteFail(peer);
      throw e;
    });
  }

  // Fin de un archivo grande recibido (lo avisa big_file.js): libera Wi-Fi Direct para otra transferencia
  bigFinished(id) { if (this.incoming.delete(id)) this.busy = false; }

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
    var big = p.big === 1 && self.ble.bigFiles;
    if (!(p.size > 0) || p.size > (big ? 1.1 * 1024 * 1024 * 1024 : WD_MAX_BYTES)) { no('tamaño'); return true; }
    // Clave para cifrar las credenciales: la guardada del contacto o, si aún no es contacto, la que trae la
    // oferta (las credenciales solo sirven para mandarnos datos, que igualmente deben venir cifrados)
    var key = (self.ble.ackSystem && self.ble.ackSystem._peerKey(deviceId, from)) ||
      ((typeof p.pk === 'string' && /^[A-Za-z0-9+/=]{80,100}$/.test(p.pk)) ? p.pk : null);
    if (!key) { no('sin clave'); return true; }
    self.busy = true;
    var bigToken = big ? Array.from(crypto.getRandomValues(new Uint8Array(16))).map(function(b) { return ('0' + b.toString(16)).slice(-2); }).join('') : null;
    self._ensurePermission().then(function(ok) {
      if (!ok) throw new Error('sin permiso');  // (denied ya marcado: el próximo kx no lo anuncia)
      var args = { transferId: id, size: p.size };
      if (big) args.bigToken = bigToken;
      return _plugin().wifiDirectHost(args);
    }).then(function(cr) {
      self.incoming.set(id, { meta: p.meta || {}, deviceId: deviceId, from: from, ts: Date.now(), big: !!big });
      // Un archivo grande puede tardar: el tope lo pone el propio socket (sin datos 60 s → error → bigFinished)
      if (big) self.ble.bigFiles._set(id, { dir: 'in', state: 'receiving', bytes: 0, total: p.size, nx: from });
      else setTimeout(function() { if (self.incoming.delete(id)) self.busy = false; }, 120000);
      var creds = { s: cr.ssid, p: cr.passphrase, o: cr.port };
      if (big) creds.t = bigToken;
      return e2eEncryptText(key, JSON.stringify(creds));
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
    console.log('[WIFI-DIRECT] Recibido ' + id + ' (' + Math.round(ev.data.length / 1024) + ' KB)' +
      (ev.ts ? ', de Android a la app ' + Math.round((Date.now() - ev.ts) / 100) / 10 + ' s' : '') + (ev.readMs ? ', lectura ' + Math.round(ev.readMs / 100) / 10 + ' s' : ''));
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
