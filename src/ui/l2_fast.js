/**
 * l2_fast.js (3288, 23-11; COLA 14 «Bluetooth ≈ 17 KB/s para archivos medianos sin Wi-Fi») — Fotos, notas de voz y archivos
 * MEDIANOS por el canal rápido del Bluetooth (L2CAP), el mismo que ya usaban los archivos grandes (big_file.js).
 *
 * Qué pasaba: con solo Bluetooth (un vagón, un festival, sin datos) todo lo que no era «archivo grande» (más de ~2 MB) iba en
 * trozos por el enlace normal (GATT): ~17 KB/s medidos; una foto de 300 KB, ~18 s; un archivo de 2 MB, ~2 min. El canal L2CAP
 * mide ~1 MB/s en los mismos teléfonos, pero solo se abría para los grandes.
 *
 * Ahora: desde L2P_MIN_CHARS, si los dos teléfonos lo anuncian («l2p» en el kx) y hay enlace Bluetooth listo, el contenido (el
 * mismo texto cifrado que iría en trozos) viaja por un canal L2CAP:
 *   A → B   'lq' { id, size, meta }      (oferta, por el enlace Bluetooth normal)
 *   B → A   'la' { id, psm }  |  'ln' { id, why }   (B abre el canal y dice en qué número escucha)
 *   A abre el canal y manda; B lo recibe y lo entrega como un archivo terminado (igual que al llegar por Wi-Fi Direct).
 *   A → B   'lx' { id }                  (A no pudo: B cierra el canal ya)
 * Si CUALQUIER paso falla o tarda, el archivo sigue por el camino de siempre (lo decide ble_ack_files.js: Wi-Fi Direct o
 * trozos por Bluetooth) y con ese contacto no se vuelve a probar en 10 min: nunca se queda sin mandar por culpa de este atajo.
 * El contenido ya va cifrado de punta a punta; el canal no añade ni quita seguridad (como el de los archivos grandes).
 */
import { e2eAnyEncrypted } from '../vault/e2e_proto.js';

export var L2P_MIN_CHARS = 60000;        // ~45 KB de archivo: por debajo, los trozos de siempre tardan menos que abrir el canal
export var L2P_MAX_CHARS = 3100000;      // el tope de un archivo por Bluetooth (más grande: «archivo grande», de disco a disco)
var OFFER_TIMEOUT_MS = 6000;             // lo que se espera a que el otro abra el canal
var FAIL_PAUSE_MS = 10 * 60000;          // tras un fallo, con ese contacto se va por lo de siempre este rato
var HOST_BACKSTOP_MS = 30000;            // quien recibe: si el nativo no avisa, se libera solo

function _nid(id) { return (id || '').toString().toLowerCase().trim(); }
function _mac(m) { return (m || '').toString().toLowerCase().replace(/[:-]/g, '').trim(); }
function _plugin() { return (typeof window !== 'undefined' && window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.NexoBLE) || null; }
function _note(kind, d) { try { if (typeof window.NEXO_noteL2 === 'function') window.NEXO_noteL2(kind, d || {}); } catch (e) {} }

export class L2Fast {
  constructor(ble) {
    this.ble = ble;
    this.ok = false;            // este teléfono puede (Android 10+, nativo con l2PayloadHost)
    this.peers = new Set();     // NEXO ID que lo anuncian ('l2p' en el kx)
    this.busy = false;
    this.out = new Map();       // id → { onAccept, onNo }
    this.incoming = new Map();  // id → { meta, deviceId, from, ts, timer }
    this.failUntil = {};        // nexoId → hasta cuándo no se prueba
    this.stats = { sent: 0, failed: 0, received: 0 };
    var self = this, pl = _plugin();
    if (pl && typeof pl.l2PayloadHost === 'function' && typeof pl.l2Info === 'function') {
      try {
        pl.l2Info().then(function(r) { self.ok = !!(r && r.ok && r.payload); }, function() {});
        if (typeof pl.addListener === 'function') pl.addListener('onL2PayloadReceived', function(ev) { self._onReceived(ev); });
      } catch (e) {}
    }
  }

  supported() { return this.ok; }
  markPeer(nx, on) { if (!nx) return; if (on) this.peers.add(_nid(nx)); else this.peers.delete(_nid(nx)); }
  _nexoOf(deviceId) { return _nid(this.ble && this.ble._macToNexoId && this.ble._macToNexoId.get(_mac(deviceId))); }

  // ¿Este archivo, a este enlace Bluetooth, puede ir por el canal rápido ahora?
  eligible(deviceId, chars) {
    if (!this.ok || this.busy || !(chars >= L2P_MIN_CHARS) || chars > L2P_MAX_CHARS) return false;
    var nx = this._nexoOf(deviceId);
    if (!nx || !this.peers.has(nx)) return false;
    return !(this.failUntil[nx] > Date.now());
  }

  _ctl(deviceId, obj) {
    obj.v = 1;
    obj.from = _nid(this.ble.localNexoId);
    return this.ble._sendMessageNative(deviceId, JSON.stringify(obj), null);
  }

  // Resuelve cuando el otro lo tiene; rechaza si hay que ir por el camino de siempre
  send(deviceId, fileId, data, meta) {
    var self = this, peer = self._nexoOf(deviceId), offered = false, t0 = Date.now();
    self.busy = true;
    return new Promise(function(resolve, reject) {
      var timer = setTimeout(function() { self.out.delete(fileId); reject(new Error('sin respuesta')); }, OFFER_TIMEOUT_MS);
      self.out.set(fileId, {
        onNo: function(why) { offered = false; clearTimeout(timer); self.out.delete(fileId); reject(new Error('el otro no puede (' + (why || '?') + ')')); },
        onAccept: function(psm) {
          clearTimeout(timer); self.out.delete(fileId);
          if (!(psm > 0)) { reject(new Error('canal no válido')); return; }
          var sendTimer = null;
          // Tope: abrir el canal (~10 s como mucho) + el contenido a 20 KB/s como mínimo (más lento que eso, mejor lo de siempre)
          Promise.race([
            _plugin().l2PayloadSend({ deviceId: deviceId, psm: psm, transferId: fileId, data: data }),
            new Promise(function(res, rej) { sendTimer = setTimeout(function() { rej(new Error('envío sin terminar')); }, 12000 + Math.round(data.length / 20)); })
          ]).then(function(r) { clearTimeout(sendTimer); resolve(r); }, function(e) { clearTimeout(sendTimer); reject(e); });
        }
      });
      offered = true;
      self._ctl(deviceId, { type: 'lq', id: fileId, size: data.length, meta: Object.assign({}, meta) }).catch(function(e) { offered = false; clearTimeout(timer); self.out.delete(fileId); reject(e); });
    }).then(function(r) {
      self.busy = false;
      self.stats.sent++;
      var ms = Date.now() - t0;
      console.log('[L2] ' + fileId + ' entregado por el canal rápido de Bluetooth: ' + Math.round(data.length / 1024) + ' KB en ' + Math.round(ms / 100) / 10 + ' s' +
        (r && r.connectMs >= 0 ? ' (abrir el canal ' + Math.round(r.connectMs / 100) / 10 + ' s)' : ''));
      _note('ok', { chars: data.length, ms: ms });
      try { if (typeof window.NEXO_noteSpeed === 'function') window.NEXO_noteSpeed('ble', 'out', Math.round(data.length * 3 / 4), ms); } catch (e) {}
    }, function(e) {
      self.busy = false;
      self.stats.failed++;
      if (offered) self._ctl(deviceId, { type: 'lx', id: fileId }).catch(function() {});
      if (peer) self.failUntil[peer] = Date.now() + FAIL_PAUSE_MS;
      console.warn('[L2] ' + fileId + ': ' + (e && e.message) + ' → por el camino de siempre (con ' + (peer || '?') + ' no se prueba en 10 min)');
      _note('fail', { why: String((e && e.message) || 'error').substring(0, 40) });
      throw e;
    });
  }

  // Paquetes de control (llegan por Bluetooth). true si era de aquí.
  handle(p, deviceId) {
    var self = this;
    if (!p || !/^l[qanx]$/.test(p.type || '')) return false;
    var id = String(p.id || '');
    if (!id) return true;
    var st = self.out.get(id);
    if (p.type === 'la') { if (st && st.onAccept) st.onAccept(Number(p.psm) || 0); return true; }
    if (p.type === 'ln') { if (st && st.onNo) st.onNo(p.why); return true; }
    if (p.type === 'lx') {
      var inc0 = self.incoming.get(id);
      if (inc0 && inc0.deviceId === deviceId) { console.log('[L2] ' + id + ': quien envía canceló: cierro el canal'); self._nativeCancel(id); self._free(id); }
      return true;
    }
    // 'lq': nos ofrecen un archivo mediano
    var from = _nid(p.from);
    var no = function(why) { self._ctl(deviceId, { type: 'ln', id: id, why: why }).catch(function() {}); };
    if (!self.ok) { no('no soportado'); return true; }
    if (self.busy || self.incoming.size) { no('ocupado'); return true; }
    if (!(p.size >= 1) || p.size > L2P_MAX_CHARS) { no('tamaño'); return true; }
    // solo de quien es ese enlace (el NEXO ID que dice el paquete tiene que ser el del enlace por el que llega)
    if (!from || self._nexoOf(deviceId) !== from) { no('enlace'); return true; }
    self.busy = true;
    _plugin().l2PayloadHost({ transferId: id, size: p.size }).then(function(r) {
      if (!r || !(r.psm > 0)) throw new Error('sin canal');
      var timer = setTimeout(function() { if (self.incoming.has(id)) { self._nativeCancel(id); self._free(id); } }, HOST_BACKSTOP_MS + Math.round(p.size / 20));
      self.incoming.set(id, { meta: p.meta || {}, deviceId: deviceId, from: from, ts: Date.now(), timer: timer });
      return self._ctl(deviceId, { type: 'la', id: id, psm: r.psm });
    }).catch(function(e) {
      self._nativeCancel(id); self._free(id);
      console.warn('[L2] No puedo recibir ' + id + ' por el canal rápido: ' + (e && e.message));
      no((e && e.message) || 'error');
    });
    return true;
  }

  _nativeCancel(id) {
    var pl = _plugin();
    if (pl && typeof pl.l2PayloadCancel === 'function') { try { pl.l2PayloadCancel({ transferId: id }).catch(function() {}); } catch (e) {} }
  }
  _free(id) {
    var inc = this.incoming.get(id);
    if (inc && inc.timer) clearTimeout(inc.timer);
    this.incoming.delete(id);
    this.busy = false;
  }

  _onReceived(ev) {
    var self = this, id = ev && ev.transferId, inc = id && self.incoming.get(id);
    if (!inc) return;
    self._free(id);
    if (ev.error || !ev.data || !e2eAnyEncrypted(ev.data)) {
      console.warn('[L2] Recepción de ' + id + ' fallida: ' + (ev.error || 'contenido no válido') + ' (quien envía sigue por el camino de siempre)');
      return;
    }
    self.stats.received++;
    console.log('[L2] Recibido ' + id + ' por el canal rápido de Bluetooth (' + Math.round(ev.data.length / 1024) + ' KB' + (ev.readMs ? ', lectura ' + Math.round(ev.readMs / 100) / 10 + ' s' : '') + ')');
    try { if (typeof window.NEXO_noteSpeed === 'function' && ev.readMs > 0) window.NEXO_noteSpeed('ble', 'in', Math.round(ev.data.length * 3 / 4), ev.readMs); } catch (e) {}
    var ack = self.ble.ackSystem;
    if (ack) {
      // Como un flujo terminado: si luego llega también en trozos, se descarta
      if (ack.completedMessages) ack.completedMessages.set(id, { total: 1, expireAt: Date.now() + 600000 });
      var m = Object.assign({}, inc.meta, { fr: inc.meta.fr || inc.from, senderNexoId: inc.meta.fr || inc.from, fromNexoId: inc.meta.fr || inc.from });
      ack._dispatchFileComplete(id, ev.data, m);
    }
  }
}

export function createL2Fast(ble) { return new L2Fast(ble); }
