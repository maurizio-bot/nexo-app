/**
 * big_file.js v1.2 (ronda 2756; 2758: también por Bluetooth L2CAP; 2764: en grupos, a cada miembro en cola) — Archivos grandes (más de ~22 MB, hasta 1 GB) por
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
import { t } from './i18n.js';
import { isStoreBuild } from './store_flag.js';

export var BIG_SLICE = 512 * 1024;
export var BIG_MAX_BYTES = 1024 * 1024 * 1024;
var STATE_FILE = 'nexo_big_state.json';
var OFFER_TIMEOUT_MS = 30000;
var BIG_IN_MAX = 2; // auditoría 23-11 (T-D1): archivos grandes recibiéndose a la vez

function _nid(id) { return (id || '').toString().toLowerCase().trim(); }
function _plugin() { return (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.NexoBLE) || null; }
function _hex(n) { var a = new Uint8Array(n); crypto.getRandomValues(a); return Array.from(a).map(function(b) { return ('0' + b.toString(16)).slice(-2); }).join(''); }
function _sliceB64(file, start, end) {
  return new Promise(function(resolve, reject) {
    var r = new FileReader();
    r.onload = function() { var s = String(r.result || ''); resolve(s.substring(s.indexOf(',') + 1)); };
    r.onerror = function() { reject(r.error || new Error(t('misc_big_read_fail', 'no se pudo leer'))); };
    r.readAsDataURL(file.slice(start, end));
  });
}

var WIFI_OFF_RE = /wi-?fi apagado|^el otro no puede \(.*wi-?fi/i; // i18n-ok: mensaje interno de wifi_direct.js
var WAIT_RETRY_MS = 15000;          // cada cuánto se reintenta un archivo que espera el Wi-Fi del otro
var WAIT_MAX_MS = 6 * 3600000;      // y hasta cuándo (luego «No se pudo enviar · Toca para reintentar»)

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

  // 3260 (dueño 20-11: «por arriba de 5 MB sí o sí tiene que entrar el Wi-Fi Direct»): al elegir camino para un archivo grande se anota
  // si salió por Wi-Fi Direct y, si no, POR QUÉ no (el diagnóstico lo suma en «Wi-Fi Direct en archivos…»)
  _noteRoute(nx, via, bytes) {
    try {
      var wd = this.ble && this.ble.wifiDirect, note = (typeof window !== 'undefined') && window.NEXO_noteWd;
      if (!wd || typeof note !== 'function') return;
      if (via === 'wd') { note('use', { why: 'archivo grande' }); return; }
      var dev = typeof this._dev === 'function' ? this._dev(nx, 'wd') : null, w = (dev && typeof wd._whyNot === 'function') ? wd._whyNot(dev, bytes, true) : null;
      var por = (w && (w.no || 'sí podía')) || 'sin dato';
      note('no', { why: 'archivo grande por ' + (via === 'lan' ? 'el mismo Wi-Fi' : via === 'l2' ? 'Bluetooth L2CAP' : 'ningún camino') + ': ' + por });
    } catch (e) {}
  }

  // Camino para un archivo grande con este contacto ahora: 'lan' (prioridad, reglas del dueño), 'wd', 'l2' o null
  route(nexoId) {
    var nx = _nid(nexoId), ble = this.ble;
    if (!this.peers.has(nx) || !ble) return null;
    if (ble.lan && ble.lan.canReach(nx)) return 'lan';
    if (ble.wifiDirect && ble.wifiDirect.canReach(nx, true)) return 'wd'; // 3260: aunque haya fallado hace poco (no hay otro camino para esto)
    if (this.l2Ok && this.l2Peers.has(nx) && this._bleReady(nx)) return 'l2';
    return null;
  }

  // 24-11 (dueño, 3b): el contacto entiende archivos grandes y está cerca por Bluetooth, pero ahora no hay camino rápido (su Wi-Fi
  // apagado…): el archivo SÍ se acepta y espera («Esperando el Wi-Fi del otro»)
  waitsWifi(nexoId) {
    var nx = _nid(nexoId);
    if (!nx || !this.peers.has(nx)) return false;
    try { return !!this._bleReady(nx) || !!(this.ble && this.ble.wifiDirect && this.ble.wifiDirect.peers && this.ble.wifiDirect.peers.has(nx)); } catch (e) { return false; }
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
    if (!pl || typeof pl.bigBegin !== 'function') return Promise.reject(new Error(t('misc_big_version_cannot', 'esta versión no puede')));
    self._set(id, { dir: 'out', state: 'preparing', bytes: 0, total: file.size });
    var tPrep = Date.now(); // 3258: cuánto tarda cifrar a disco (diagnóstico del dueño 20-11: 153 MB tardaron ~30 s en prepararse y 6 s en viajar por Wi-Fi Direct)
    return pl.bigBegin({ id: id, key: key }).then(function() {
      // 3317 (COLA 3, Wi-Fi Direct: preparar era el cuello de botella, ~5 MB/s): se lee el pedazo SIGUIENTE mientras el nativo cifra
      // el anterior (antes: leer, esperar al nativo, leer…). Un solo pedazo en el nativo a la vez y en orden: antes de mandar uno se
      // espera al anterior, así que el archivo cifrado queda igual y un fallo para todo.
      var pos = 0, pending = null;
      var step = function() {
        if (pos >= file.size) return pending || Promise.resolve();
        var start = pos, end = Math.min(pos + BIG_SLICE, file.size);
        pos = end;
        return _sliceB64(file, start, end).then(function(b64) {
          return (pending || Promise.resolve()).then(function() {
            pending = pl.bigAppend({ id: id, data: b64, last: end >= file.size }).then(function() { self._set(id, { bytes: end }); });
            pending.catch(function() {}); // se atiende al esperar el siguiente (o al final)
            return step();
          });
        });
      };
      return step();
    }).then(function() {
      var secsP = Math.max(0.1, (Date.now() - tPrep) / 1000);
      console.log('[BIG] ' + id + ' preparado (' + Math.round(file.size / 1048576) + ' MB) en ' + (Math.round(secsP * 10) / 10).toString().replace('.', ',') + ' s = ' + (Math.round(file.size / 1048576 / secsP * 10) / 10).toString().replace('.', ',') + ' MB/s'); // i18n-ok: texto para el desarrollador
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
  // Ronda 2764 (grupos): el mismo archivo a varios, uno tras otro (una oferta a la vez por id)
  transfer(nexoId, id) {
    var self = this;
    self._q = self._q || {};
    var p = (self._q[id] || Promise.resolve()).catch(function() {}).then(function() { return self._transfer(nexoId, id); });
    self._q[id] = p;
    p.catch(function() {}).then(function() { if (self._q[id] === p) delete self._q[id]; });
    return p;
  }
  _transfer(nexoId, id) {
    var self = this, nx = _nid(nexoId), via = self.route(nx), pl = _plugin();
    // #99: un archivo muy grande (>~22 MB) por ahora solo va por un camino local (mismo Wi-Fi, Wi-Fi Direct o Bluetooth).
    // Por internet todavía no (Fase B: canal directo por Tor). Antes el fallo decía «sin camino» y no se entendía; ahora
    // queda claro y la tarjeta del chat lo muestra (nunca «enviada» sin enviarse).
    // 24-11 (dueño, 3b): con el contacto que SÍ entiende archivos grandes pero sin camino ahora (su Wi-Fi apagado, o el mío), el
    // archivo NO falla: espera («Esperando el Wi-Fi del otro») y se reintenta solo; así no se manda varias veces a mano.
    if (!via && self.peers.has(nx)) {
      self._esperaWifi(nx, id, 'sin camino ahora'); // i18n-ok: registro
      return Promise.reject(Object.assign(new Error('esperando el Wi-Fi'), { code: 'BIG_WAIT' }));
    }
    if (!via) {
      var msg = t('misc_big_toobig_a', 'Archivo muy grande (') + Math.round((((this.st[id] || {}).total) || 0) / 1048576) + t('misc_big_toobig_b', ' MB): por ahora solo se envía con el contacto cerca (mismo Wi-Fi, Wi-Fi Direct o Bluetooth); por internet todavía no.');
      self._set(id, { dir: 'out', state: 'failed', error: msg });
      return Promise.reject(Object.assign(new Error(msg), { code: 'BIG_NO_NET' }));
    }
    var tSend = 0, sendBytes = 0;
    return pl.bigStatus({ id: id }).then(function(s) {
      if (!s || !s.have) throw new Error(t('misc_big_gone', 'ya no está en este teléfono'));
      tSend = Date.now(); sendBytes = s.bytes;
      self._noteRoute(nx, via, s.bytes);
      // en un reintento por «esperando el Wi-Fi» la tarjeta no parpadea a «Enviando»: sigue esperando hasta que haya progreso real
      if (self._wait && self._wait[id]) self._set(id, { dir: 'out', total: s.bytes, nx: nx, via: via });
      else self._set(id, { dir: 'out', state: 'sending', bytes: 0, total: s.bytes, nx: nx, via: via });
      console.log('[BIG] Enviando ' + id + ' a ' + nx + ' por ' + ({ lan: 'Wi-Fi', wd: 'Wi-Fi Direct', l2: 'Bluetooth (L2CAP)' })[via] + ' (' + Math.round(s.bytes / 1048576) + ' MB)');
      if (via === 'wd') return self.ble.wifiDirect.sendBig(self._dev(nx, 'wd'), id, s.bytes);
      return new Promise(function(resolve, reject) {
        var tmr = setTimeout(function() { self.out.delete(id); reject(new Error(t('misc_big_no_response', 'sin respuesta'))); }, OFFER_TIMEOUT_MS);
        self.out.set(id, {
          onNo: function(why) { clearTimeout(tmr); self.out.delete(id); reject(new Error(t('misc_big_other_cannot', 'el otro no puede (') + (why || '?') + ')')); },
          onAccept: function(p) {
            clearTimeout(tmr); self.out.delete(id);
            if (via === 'l2') {
              if (!(p.psm > 0)) { reject(new Error(t('misc_big_other_no_channel', 'el otro no abrió el canal'))); return; }
              pl.bigSendL2({ id: id, deviceId: self._dev(nx, 'l2'), psm: p.psm, token: p.token }).then(resolve, reject);
            } else pl.bigSendLan({ id: id, nx: nx, port: p.port, token: p.token }).then(resolve, reject);
          }
        });
        self._ctl(self._dev(nx, via), { type: 'gq', id: id, size: s.bytes, via: via }).catch(function(e) { clearTimeout(tmr); self.out.delete(id); reject(e); });
      });
    }).then(function() {
      // El socket confirmó que el otro tiene todos los bytes
      if (self._wait) delete self._wait[id];
      self.saved[id] = 'sent'; self._save();
      var secsT = tSend ? Math.max(0.1, (Date.now() - tSend) / 1000) : 0; // 3260: la tarjeta termina diciendo por dónde fue y a qué velocidad
      self._set(id, { state: 'done', via: via, mbps: secsT && sendBytes ? Math.round(sendBytes / 1048576 / secsT * 10) / 10 : 0 });
      console.log('[BIG] ' + id + ' entregado');
      if (typeof self.onSent === 'function') self.onSent(nx, id); // grupos (group_media.js)
    }, function(e) {
      // Wi-Fi apagado (aquí o en el otro) o sin camino por ahora: queda esperando y se reintenta solo (no «No se pudo enviar»)
      if ((e && (e.wifiOff || e.code === 'WD_WIFI_OFF' || WIFI_OFF_RE.test(String(e.message || ''))))) {
        self._esperaWifi(nx, id, e && e.message);
        throw e;
      }
      self._set(id, { dir: 'out', state: 'failed', error: e && e.message });
      console.warn('[BIG] ' + id + ' no se pudo enviar: ' + (e && e.message));
      throw e;
    });
  }

  // Espera del Wi-Fi del otro (dueño 24-11, 3b): la tarjeta pasa a «waitwifi» y se reintenta cada WAIT_RETRY_MS (cualquier camino que
  // sirva: mismo Wi-Fi, Wi-Fi Direct, L2CAP) hasta WAIT_MAX_MS; pasado ese tiempo queda «No se pudo enviar · Toca para reintentar».
  _esperaWifi(nx, id, why) {
    var self = this, s = self.st[id] || {};
    self._wait = self._wait || {};
    var w = self._wait[id] || (self._wait[id] = { since: Date.now(), timer: null });
    if (w.timer) { clearTimeout(w.timer); w.timer = null; }
    if (Date.now() - w.since > WAIT_MAX_MS) {
      delete self._wait[id];
      self._set(id, { dir: 'out', state: 'failed', error: why });
      console.warn('[BIG] ' + id + ' sigue sin camino tras ' + Math.round(WAIT_MAX_MS / 60000) + ' min: queda fallido'); // i18n-ok: registro
      return;
    }
    self._set(id, { dir: 'out', state: 'waitwifi', nx: nx, bytes: 0, total: s.total, error: why });
    console.log('[BIG] ' + id + ' espera el Wi-Fi de ' + nx + ' (' + why + '): se reintenta solo'); // i18n-ok: registro
    var ms = (typeof window !== 'undefined' && window.NEXO_BIG_WAIT_MS > 0) ? window.NEXO_BIG_WAIT_MS : WAIT_RETRY_MS;
    w.timer = setTimeout(function() {
      w.timer = null;
      var cur = self.st[id];
      if (!cur || cur.state !== 'waitwifi') { delete self._wait[id]; return; }
      self.transfer(nx, id).then(function() { delete self._wait[id]; }, function() {});
    }, ms);
  }
  // Un toque en la tarjeta: reintentar ya (sin esperar al reloj)
  retryNow(nx, id) {
    var w = this._wait && this._wait[id];
    if (w && w.timer) { clearTimeout(w.timer); w.timer = null; }
    return this.transfer(nx, id).catch(function() {});
  }

  // Paquetes de control ('g?'); true si era de archivos grandes
  handle(p, deviceId) {
    var self = this, pl = _plugin();
    if (!p || !/^g[qanfr]$/.test(p.type || '')) return false;
    var id = String(p.id || ''), from = _nid(p.from);
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) return true;
    var o = self.out.get(id);
    if (p.type === 'ga') { if (o && o.onAccept && (p.port > 0 || p.psm > 0) && typeof p.token === 'string' && self.st[id] && (deviceId === self._dev(self.st[id].nx, self.st[id].via) || _nid(self.ble && self.ble._macToNexoId && self.ble._macToNexoId.get(String(deviceId || '').toLowerCase().replace(/[:-]/g, ''))) === _nid(self.st[id].nx))) o.onAccept(p); return true; } // T-E1: solo del enlace ofrecido
    if (p.type === 'gn') { if (o && o.onNo && self.st[id] && (deviceId === self._dev(self.st[id].nx, self.st[id].via) || _nid(self.ble && self.ble._macToNexoId && self.ble._macToNexoId.get(String(deviceId || '').toLowerCase().replace(/[:-]/g, ''))) === _nid(self.st[id].nx))) o.onNo(p.why); return true; }
    if (p.type === 'gf') return true;
    if (p.type === 'gr') {
      // El otro lo pide otra vez (se cortó) o, en un grupo, lo pide quien no tenía camino: solo si es nuestro y aún lo
      // tenemos; si ya va hacia él, nada (si va hacia otro miembro, se pone en cola)
      if (from && !(self.st[id] && self.st[id].state === 'sending' && self.st[id].nx === from)) self.transfer(from, id).catch(function() {});
      return true;
    }
    // 'gq': nos ofrecen un archivo grande por el mismo Wi-Fi o (via 'l2') por un canal L2CAP del Bluetooth
    var no = function(why) { self._ctl(deviceId, { type: 'gn', id: id, why: why }).catch(function() {}); };
    var l2 = p.via === 'l2';
    if (!pl || typeof (l2 ? pl.bigServeL2 : pl.bigServe) !== 'function' || (l2 && !self.l2Ok)) { no('no soportado'); return true; }
    if (!(p.size > 0) || p.size > BIG_MAX_BYTES * 1.1) { no('tamaño'); return true; }
    // Auditoría 23-11 (T-D1): cualquiera cerca podía ofrecer un «archivo grande» (hasta 1,1 GB por id, un canal y un hilo por oferta)
    // y llenar el disco. Ahora: solo de un contacto con clave; uno a la vez de cada contacto y como mucho BIG_IN_MAX a la vez; y un
    // archivo ya recibido no se vuelve a escribir encima.
    var bigKeyOk = from && self.ble && typeof self.ble._contactKey === 'function' && self.ble._contactKey(from);
    if (!bigKeyOk) { console.warn('[BIG] Oferta de ' + (from || '?') + ' (no es contacto): rechazada'); no('no es contacto'); return true; }
    if (self.saved[id] === 'got') { no('ya lo tengo'); return true; }
    var nIn = 0, fromBusy = false;
    Object.keys(self.st).forEach(function(k) { var x = self.st[k]; if (x && x.dir === 'in' && x.state === 'receiving' && k !== id) { nIn++; if (x.nx === from) fromBusy = true; } });
    if (fromBusy || nIn >= BIG_IN_MAX) { no('ocupado'); return true; }
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
    if (ev.dir === 'in' && this.ble && this.ble.wifiDirect && typeof this.ble.wifiDirect.bigFinished === 'function') this.ble.wifiDirect.bigFinished(ev.id, ev.ok, ev.error);
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
    if (!pl || typeof pl.bigOpen !== 'function') return Promise.reject(new Error(t('misc_big_version_cannot_open', 'esta versión no puede abrirlo')));
    return pl.bigOpen({ id: id, key: key, name: name, mime: mime, store: isStoreBuild() }); // I-S1 (23-11): el nativo también sabe si es la versión de tienda
  }
}

export function createBigFiles(ble) { return new BigFiles(ble); }
