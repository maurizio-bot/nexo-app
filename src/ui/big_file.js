/**
 * big_file.js v1.1 (ronda 2756; 2758: también por Bluetooth L2CAP) — Archivos grandes (más de ~22 MB, hasta 1 GB) por
 * el mismo Wi-Fi, Wi-Fi Direct o, sin ninguno de los dos, por un canal L2CAP del Bluetooth (plan del dueño punto 13).
 * Pedido del dueño: un APK de 24 MB no salía. Antes todo archivo pasaba entero por la memoria de la app (en base64,
 * cifrado y copiado varias veces): con más de ~22 MB el teléfono se colgaba, así que se rechazaba.
 * Ahora (como Signal/WhatsApp):
 *  1. La app lee el archivo a trozos de 512 KB y la parte nativa los cifra a disco (BigFile.kt) con una clave al azar
 *     propia del archivo.
 *  2. Un mensaje normal (cifrado de extremo a extremo, por cualquier camino) lleva nombre, tamaño y esa clave.
 *  3. El archivo cifrado va de disco a disco por un socket nativo:
 *       mismo Wi-Fi:  A → B 'gq' { id, size, via:'lan' }   B abre un puerto → 'ga' { id, port, token }   A lo manda
 *       Wi-Fi Direct: como wifi_direct.js ('wq' con big:1), B guarda en disco en vez de pasarlo a la app
 *     Bluetooth:    como el mismo Wi-Fi con via:'l2': B abre un canal L2CAP → 'ga' { id, psm, token } (Android 10+,
 *                   los dos con 'l2' en el kx; un flujo directo, sin GATT ni base64; más lento que el Wi-Fi)
 *     B → A 'gf' { id } al tenerlo entero. 'gn' = no puede; 'gr' { id } = B lo pide otra vez (si se cortó).
 *  4. Al tocarlo, la parte nativa lo descifra a un archivo temporal y lo abre (un APK se instala).
 * Solo con quien lo anuncia ('bg' en el kx); el estado de cada archivo se ve en su tarjeta del chat.
 */
import { WD_MAX_BYTES } from './wifi_direct.js';

export var BIG_SLICE = 512 * 1024;
export var BIG_MAX_BYTES = 1024 * 1024 * 1024;
// Por encima de esto un archivo va como "grande" (por debajo, como siempre: Wi-Fi Direct / Wi-Fi / Bluetooth)
export var BIG_MIN_BYTES = Math.floor(WD_MAX_BYTES * 3 / 4);
var STATE_FILE = 'nexo_big_state.json';
var OFFER_TIMEOUT_MS = 30000;

function _nid(id) { return (id || '').toString().toLowerCase().trim(); }
function _plugin() { return (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.NexoBLE) || null; }
function _hex(n) { var a = new Uint8Array(n); crypto.getRandomValues(a); return Array.from(a).map(function(b) { return ('0' + b.toString(16)).slice(-2); }).join(''); }
function _sliceB64(file, start, end) {
  return new Promise(function(resolve, reject) {
    var r = new FileReader();
    r.onload = function() { var s = String(r.result || ''); resolve(s.substring(s.indexOf(',') + 1)); };
    r.onerror = function() { reject(r.error || new Error('no se pudo leer')); };
    r.readAsDataURL(file.slice(start, end));
  });
}

export class BigFiles {
  constructor(ble) {
    this.ble = ble;
    this.peers = new Set();     // NEXO ID que entienden archivos grandes (kx con bg:1)
    this.st = {};               // id → { dir:'out'|'in', state, bytes, total, nx } (en memoria) + persistente: done/failed
    this.saved = {};            // id → 'sent' | 'got' (persistente)
    this.out = new Map();       // id → { onAccept, onNo } (ofertas propias por el mismo Wi-Fi / L2CAP)
    this.l2Ok = false;          // este teléfono puede usar L2CAP (Android 10+; nativo 2758)
    this.l2Peers = new Set();   // NEXO ID que lo anuncian ('l2' en el kx)
    this._init();
  }

  _init() {
    var self = this, pl = _plugin();
    if (!pl || typeof pl.addListener !== 'function') return;
    pl.addListener('onBigProgress', function(ev) { self._progress(ev); });
    pl.addListener('onBigDone', function(ev) { self._done(ev); });
    if (typeof pl.l2Info === 'function') pl.l2Info().then(function(r) { self.l2Ok = !!(r && r.ok); }).catch(function() {});
    if (typeof pl.loadFromFile === 'function') pl.loadFromFile({ filename: STATE_FILE }).then(function(r) {
      if (r && r.exists && r.content) try { self.saved = Object.assign(JSON.parse(r.content) || {}, self.saved); } catch (e) {}
    }).catch(function() {});
  }
  _save() { var pl = _plugin(); if (pl && typeof pl.saveToFile === 'function') pl.saveToFile({ filename: STATE_FILE, content: JSON.stringify(this.saved) }).catch(function() {}); }

  markPeer(nx) { if (nx) this.peers.add(_nid(nx)); }
  unmarkPeer(nx) { if (nx) this.peers.delete(_nid(nx)); }
  markL2(nx, on) { if (!nx) return; if (on) this.l2Peers.add(_nid(nx)); else this.l2Peers.delete(_nid(nx)); }

  // Conexión Bluetooth lista con ese contacto (no lan:/net:, que también resuelve _resolveDeviceIdForNexoId)
  _bleReady(nx) { var ble = this.ble; return ble && typeof ble._bleReadyFor === 'function' ? ble._bleReadyFor(nx) : null; }

  // Camino para un archivo grande con este contacto ahora: 'lan' (prioridad, reglas del dueño), 'wd', 'l2' o null
  route(nexoId) {
    var nx = _nid(nexoId), ble = this.ble;
    if (!this.peers.has(nx) || !ble) return null;
    if (ble.lan && ble.lan.canReach(nx)) return 'lan';
    if (ble.wifiDirect && ble.wifiDirect.canReach(nx)) return 'wd';
    if (this.l2Ok && this.l2Peers.has(nx) && this._bleReady(nx)) return 'l2';
    return null;
  }

  // Estado para la tarjeta del chat
  state(id) {
    var s = this.st[id];
    if (s) return s;
    if (this.saved[id] === 'sent' || this.saved[id] === 'got') return { state: 'done', dir: this.saved[id] === 'sent' ? 'out' : 'in' };
    return null;
  }

  _emit(id) {
    try { window.dispatchEvent(new CustomEvent('nexo:big', { detail: Object.assign({ id: id }, this.state(id) || {}) })); } catch (e) {}
  }
  _set(id, o) { this.st[id] = Object.assign(this.st[id] || {}, o); this._emit(id); }

  // 1. Cifrar a disco por trozos (la app nunca tiene el archivo entero). Devuelve la clave.
  prepare(file, id) {
    var self = this, pl = _plugin(), key = _hex(32);
    if (!pl || typeof pl.bigBegin !== 'function') return Promise.reject(new Error('esta versión no puede'));
    self._set(id, { dir: 'out', state: 'preparing', bytes: 0, total: file.size });
    return pl.bigBegin({ id: id, key: key }).then(function() {
      var pos = 0;
      var next = function() {
        var end = Math.min(pos + BIG_SLICE, file.size);
        return _sliceB64(file, pos, end).then(function(b64) {
          return pl.bigAppend({ id: id, data: b64, last: end >= file.size });
        }).then(function() {
          pos = end;
          self._set(id, { bytes: pos });
          if (pos < file.size) return next();
        });
      };
      return next();
    }).then(function() {
      console.log('[BIG] ' + id + ' preparado (' + Math.round(file.size / 1048576) + ' MB)');
      return key;
    }, function(e) {
      self._set(id, { state: 'failed', error: e && e.message });
      throw e;
    });
  }

  _dev(nx, via) {
    if (via === 'lan') return 'lan:' + _nid(nx);
    if (via === 'l2') return this._bleReady(_nid(nx));
    var ble = this.ble;
    return ble && typeof ble._resolveDeviceIdForNexoId === 'function' ? ble._resolveDeviceIdForNexoId(nx) : null;
  }
  _ctl(dev, obj) {
    obj.v = 1; obj.from = _nid(this.ble && this.ble.localNexoId);
    return this.ble._sendMessageNative(dev, JSON.stringify(obj), null);
  }

  // 3. Mandar el archivo ya cifrado (también para reintentar). Resuelve cuando el otro lo tiene.
  transfer(nexoId, id) {
    var self = this, nx = _nid(nexoId), via = self.route(nx), pl = _plugin();
    if (!via) { self._set(id, { dir: 'out', state: 'failed', error: 'sin camino con el contacto' }); return Promise.reject(new Error('sin camino con el contacto')); }
    return pl.bigStatus({ id: id }).then(function(s) {
      if (!s || !s.have) throw new Error('ya no está en este teléfono');
      self._set(id, { dir: 'out', state: 'sending', bytes: 0, total: s.bytes, nx: nx, via: via });
      console.log('[BIG] Enviando ' + id + ' a ' + nx + ' por ' + ({ lan: 'Wi-Fi', wd: 'Wi-Fi Direct', l2: 'Bluetooth (L2CAP)' })[via] + ' (' + Math.round(s.bytes / 1048576) + ' MB)');
      if (via === 'wd') return self.ble.wifiDirect.sendBig(self._dev(nx, 'wd'), id, s.bytes);
      return new Promise(function(resolve, reject) {
        var t = setTimeout(function() { self.out.delete(id); reject(new Error('sin respuesta')); }, OFFER_TIMEOUT_MS);
        self.out.set(id, {
          onNo: function(why) { clearTimeout(t); self.out.delete(id); reject(new Error('el otro no puede (' + (why || '?') + ')')); },
          onAccept: function(p) {
            clearTimeout(t); self.out.delete(id);
            if (via === 'l2') {
              if (!(p.psm > 0)) { reject(new Error('el otro no abrió el canal')); return; }
              pl.bigSendL2({ id: id, deviceId: self._dev(nx, 'l2'), psm: p.psm, token: p.token }).then(resolve, reject);
            } else pl.bigSendLan({ id: id, nx: nx, port: p.port, token: p.token }).then(resolve, reject);
          }
        });
        self._ctl(self._dev(nx, via), { type: 'gq', id: id, size: s.bytes, via: via }).catch(function(e) { clearTimeout(t); self.out.delete(id); reject(e); });
      });
    }).then(function() {
      // El socket confirmó que el otro tiene todos los bytes
      self.saved[id] = 'sent'; self._save();
      self._set(id, { state: 'done' });
      console.log('[BIG] ' + id + ' entregado');
    }, function(e) {
      self._set(id, { dir: 'out', state: 'failed', error: e && e.message });
      console.warn('[BIG] ' + id + ' no se pudo enviar: ' + (e && e.message));
      throw e;
    });
  }

  // Paquetes de control ('g?'); true si era de archivos grandes
  handle(p, deviceId) {
    var self = this, pl = _plugin();
    if (!p || !/^g[qanfr]$/.test(p.type || '')) return false;
    var id = String(p.id || ''), from = _nid(p.from);
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) return true;
    var o = self.out.get(id);
    if (p.type === 'ga') { if (o && o.onAccept && (p.port > 0 || p.psm > 0) && typeof p.token === 'string') o.onAccept(p); return true; }
    if (p.type === 'gn') { if (o && o.onNo) o.onNo(p.why); return true; }
    if (p.type === 'gf') return true;
    if (p.type === 'gr') {
      // El otro lo pide otra vez (se cortó): solo si es nuestro y aún lo tenemos
      if (from && !(self.st[id] && self.st[id].state === 'sending')) self.transfer(from, id).catch(function() {});
      return true;
    }
    // 'gq': nos ofrecen un archivo grande por el mismo Wi-Fi o (via 'l2') por un canal L2CAP del Bluetooth
    var no = function(why) { self._ctl(deviceId, { type: 'gn', id: id, why: why }).catch(function() {}); };
    var l2 = p.via === 'l2';
    if (!pl || typeof (l2 ? pl.bigServeL2 : pl.bigServe) !== 'function' || (l2 && !self.l2Ok)) { no('no soportado'); return true; }
    if (!(p.size > 0) || p.size > BIG_MAX_BYTES * 1.1) { no('tamaño'); return true; }
    if (!l2 && (!self.ble.lan || !self.ble.lan.canReach(from))) { no('sin Wi-Fi'); return true; }
    var token = _hex(16);
    self._set(id, { dir: 'in', state: 'receiving', bytes: 0, total: p.size, nx: from, via: l2 ? 'l2' : 'lan' });
    (l2 ? pl.bigServeL2({ id: id, token: token }) : pl.bigServe({ id: id, token: token })).then(function(r) {
      return self._ctl(deviceId, l2 ? { type: 'ga', id: id, psm: r.psm, token: token } : { type: 'ga', id: id, port: r.port, token: token });
    }).catch(function(e) { self._set(id, { state: 'failed', error: e && e.message }); no(e && e.message); });
    return true;
  }

  // Receptor: pedirlo otra vez (tarjeta "Toca para pedirlo")
  request(nexoId, id) {
    var nx = _nid(nexoId), via = this.route(nx);
    if (!via) return false;
    this._set(id, { dir: 'in', state: 'waiting' });
    this._ctl(this._dev(nx, via), { type: 'gr', id: id }).catch(function() {});
    return true;
  }

  _progress(ev) {
    if (!ev || !ev.id) return;
    var s = this.st[ev.id] || {};
    this._set(ev.id, { dir: ev.dir, bytes: ev.bytes, total: ev.total, state: s.state === 'done' ? 'done' : (ev.dir === 'in' ? 'receiving' : 'sending') });
  }

  _done(ev) {
    if (!ev || !ev.id) return;
    if (ev.dir === 'in' && this.ble && this.ble.wifiDirect && typeof this.ble.wifiDirect.bigFinished === 'function') this.ble.wifiDirect.bigFinished(ev.id);
    if (ev.dir === 'in') {
      if (ev.ok) {
        this.saved[ev.id] = 'got'; this._save();
        this._set(ev.id, { dir: 'in', state: 'done' });
        console.log('[BIG] Recibido ' + ev.id);
        var s = this.st[ev.id];
        if (s && s.nx) { var dev = this._dev(s.nx, this.route(s.nx) || 'wd'); if (dev) this._ctl(dev, { type: 'gf', id: ev.id }).catch(function() {}); }
      } else {
        this._set(ev.id, { dir: 'in', state: 'failed', error: ev.error });
        console.warn('[BIG] Recepción de ' + ev.id + ' fallida: ' + ev.error);
      }
    }
    // dir 'out': lo resuelve la promesa de transfer (bigSendLan / wifiDirectSend)
  }

  open(id, key, name, mime) {
    var pl = _plugin();
    if (!pl || typeof pl.bigOpen !== 'function') return Promise.reject(new Error('esta versión no puede abrirlo'));
    return pl.bigOpen({ id: id, key: key, name: name, mime: mime });
  }
}

export function createBigFiles(ble) { return new BigFiles(ble); }
