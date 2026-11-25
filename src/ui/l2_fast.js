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
 * Cuándo: cuando Wi-Fi Direct no puede con ese archivo (Wi-Fi apagado, el otro no lo tiene, falló hace poco) o acaba de fallar.
 * Wi-Fi Direct sigue yendo primero cuando puede (decisión del dueño 12-11); lo decide ble_ack_files._sendFileL2OrJS.
 * Si CUALQUIER paso falla o tarda, el archivo va en trozos como siempre y con ese contacto no se vuelve a probar en 10 min:
 * nunca se queda sin mandar por culpa de este atajo.
 * El contenido ya va cifrado de punta a punta; el canal no añade ni quita seguridad (como el de los archivos grandes).
 */
import { e2eAnyEncrypted } from '../vault/e2e_proto.js';

export var L2P_MIN_CHARS = 60000;        // ~45 KB de archivo: por debajo, los trozos de siempre tardan menos que abrir el canal
// COLA 13 (Vivo Y03, Katy: enlaces a MTU 23): a MTU mínimo cada escritura lleva ~20 bytes (≈ 25 veces menos que a 517) y una nota
// de voz o una foto chica tardan decenas de segundos en trozos; abrir el canal (1–2 s) ya compensa desde ~6 KB de archivo.
export var L2P_MIN_CHARS_MTU23 = 8000;
export var L2P_MAX_CHARS = 3100000;      // el tope de un archivo por Bluetooth (más grande: «archivo grande», de disco a disco)
var OFFER_TIMEOUT_MS = 6000;             // lo que se espera a que el otro abra el canal
var FAIL_PAUSE_MS = 10 * 60000;          // tras un fallo, con ese contacto se va por lo de siempre este rato
var HOST_BACKSTOP_MS = 30000;            // quien recibe: si el nativo no avisa, se libera solo
export var ACK_WAIT_MS = 20000;          // T-E1: lo que quien recibe tiene el canal abierto esperando a descifrarlo (nativo: L2_ACK_WAIT_MS)
function _token() { var a = new Uint8Array(16); crypto.getRandomValues(a); return Array.from(a).map(function(b) { return ('0' + b.toString(16)).slice(-2); }).join(''); }

function _nid(id) { return (id || '').toString().toLowerCase().trim(); }
function _mac(m) { return (m || '').toString().toLowerCase().replace(/[:-]/g, '').trim(); }
function _plugin() { return (typeof window !== 'undefined' && window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.NexoBLE) || null; }
function _note(kind, d) { try { if (typeof window.NEXO_noteL2 === 'function') window.NEXO_noteL2(kind, d || {}); } catch (e) {} }

// 3289 (dueño 23-11: «ok solo si me aseguras que es más rápido»): ¿el canal rápido va ANTES que Wi-Fi Direct? Solo con MEDIDAS
// reales de hoy en este teléfono de los dos caminos (KB/s de principio a fin: ya llevan dentro abrir el canal o montar el grupo y
// unirse), y solo si el canal rápido gana con margen. Sin medida de alguno de los dos: no (Wi-Fi Direct primero, decisión 12-11).
export var L2_WD_MARGIN = 1.2;
export function l2BeatsWd(l2Kbps, wdKbps) {
  return l2Kbps > 0 && wdKbps > 0 && l2Kbps >= wdKbps * L2_WD_MARGIN;
}

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
  // Auditoría 23-11 (T-E1): una respuesta ('la'/'ln') solo vale si llega por el MISMO enlace al que se ofreció (la misma dirección o,
  // si el Bluetooth la ve por el otro lado de la conexión, la del mismo contacto). Antes cualquier enlace podía contestar por otro.
  _sameLink(a, b) {
    if (_mac(a) && _mac(a) === _mac(b)) return true;
    var na = this._nexoOf(a);
    return !!na && na === this._nexoOf(b);
  }

  _minChars(deviceId) {
    var m = this.ble && this.ble._mtuByDevice && this.ble._mtuByDevice.get(_mac(deviceId));
    return (typeof m === 'number' && m <= 23) ? L2P_MIN_CHARS_MTU23 : L2P_MIN_CHARS;
  }

  // ¿Este archivo, a este enlace Bluetooth, puede ir por el canal rápido ahora?
  eligible(deviceId, chars) {
    if (!this.ok || this.busy || !(chars >= this._minChars(deviceId)) || chars > L2P_MAX_CHARS) return false;
    var nx = this._nexoOf(deviceId);
    if (!nx || !this.peers.has(nx)) return false;
    return !(this.failUntil[nx] > Date.now());
  }

  // ¿Hoy, en este teléfono, el canal rápido mide más rápido que Wi-Fi Direct? (l2BeatsWd con las velocidades del día)
  fasterThanWd() {
    try {
      var f = typeof window !== 'undefined' && window.NEXO_recentSpeed;
      if (typeof f !== 'function') return false;
      var l2 = f('l2', 'out'), wd = f('wifi-direct', 'out');
      var yes = l2BeatsWd(l2, wd);
      if (yes) console.log('[L2] Canal rápido antes que Wi-Fi Direct: hoy mide ' + l2 + ' KB/s contra ' + wd + ' KB/s');
      return yes;
    } catch (e) { return false; }
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
        deviceId: deviceId,
        onNo: function(why) { offered = false; clearTimeout(timer); self.out.delete(fileId); reject(new Error('el otro no puede (' + (why || '?') + ')')); }, // i18n-ok: registro
        onAccept: function(psm, tk) {
          clearTimeout(timer); self.out.delete(fileId);
          if (!(psm > 0)) { reject(new Error('canal no válido')); return; }
          var sendTimer = null;
          // Tope: abrir el canal (~10 s como mucho) + el contenido a 20 KB/s como mínimo (más lento que eso, mejor lo de siempre)
          // + ACK_WAIT_MS: T-E1, el otro confirma cuando ya lo pudo descifrar (no al tener los bytes)
          Promise.race([
            _plugin().l2PayloadSend({ deviceId: deviceId, psm: psm, transferId: fileId, data: data, token: tk }),
            new Promise(function(res, rej) { sendTimer = setTimeout(function() { rej(new Error('envío sin terminar')); }, 12000 + ACK_WAIT_MS + Math.round(data.length / 20)); })
          ]).then(function(r) { clearTimeout(sendTimer); resolve(r); }, function(e) { clearTimeout(sendTimer); reject(e); });
        }
      });
      offered = true;
      self._ctl(deviceId, { type: 'lq', id: fileId, size: data.length, meta: (function(w) { if (w.xs) { delete w.caption; delete w.once; } return w; })(Object.assign({}, meta)) }) /* 4A (23-11) */.catch(function(e) { offered = false; clearTimeout(timer); self.out.delete(fileId); reject(e); });
    }).then(function(r) {
      self.busy = false;
      self.stats.sent++;
      var ms = Date.now() - t0;
      console.log('[L2] ' + fileId + ' entregado por el canal rápido de Bluetooth: ' + Math.round(data.length / 1024) + ' KB en ' + Math.round(ms / 100) / 10 + ' s' +
        (r && r.connectMs >= 0 ? ' (abrir el canal ' + Math.round(r.connectMs / 100) / 10 + ' s)' : ''));
      _note('ok', { chars: data.length, ms: ms });
      try { if (typeof window.NEXO_noteSpeed === 'function') window.NEXO_noteSpeed('l2', 'out', Math.round(data.length * 3 / 4), ms); } catch (e) {}
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
    if ((p.type === 'la' || p.type === 'ln') && st && !self._sameLink(st.deviceId, deviceId)) { console.warn('[L2] ' + id + ': respuesta por otro enlace: ignorada'); return true; }
    if (p.type === 'la') { if (st && st.onAccept) st.onAccept(Number(p.psm) || 0, typeof p.tk === 'string' ? p.tk : ''); return true; }
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
    // T-L1: el canal solo acepta a quien traiga este token en la cabecera (va en 'la' por el enlace del contacto)
    var tk = _token();
    _plugin().l2PayloadHost({ transferId: id, size: p.size, token: tk }).then(function(r) {
      if (!r || !(r.psm > 0)) throw new Error('sin canal');
      var timer = setTimeout(function() { if (self.incoming.has(id)) { self._nativeCancel(id); self._free(id); } }, HOST_BACKSTOP_MS + Math.round(p.size / 20));
      self.incoming.set(id, { meta: p.meta || {}, deviceId: deviceId, from: from, ts: Date.now(), timer: timer });
      return self._ctl(deviceId, { type: 'la', id: id, psm: r.psm, tk: tk });
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

  // T-E1: el nativo tiene el canal abierto esperando esto: ok = ya se descifró (manda el byte de «recibido» = ✓✓ de quien envía);
  // no = no se pudo leer (cierra sin confirmar: quien envía sigue por trozos, no lo da por entregado)
  _nativeAck(id, ok) {
    var pl = _plugin();
    if (pl && typeof pl.l2PayloadCancel === 'function') { try { pl.l2PayloadCancel({ transferId: id, ack: ok ? 1 : 0 }).catch(function() {}); } catch (e) {} }
  }

  _onReceived(ev) {
    var self = this, id = ev && ev.transferId, inc = id && self.incoming.get(id);
    if (!inc) return;
    self._free(id);
    if (ev.error || !ev.data || !e2eAnyEncrypted(ev.data)) {
      if (!ev.error) self._nativeAck(id, false);
      console.warn('[L2] Recepción de ' + id + ' fallida: ' + (ev.error || 'contenido no válido') + ' (quien envía sigue por el camino de siempre)');
      return;
    }
    self.stats.received++;
    console.log('[L2] Recibido ' + id + ' por el canal rápido de Bluetooth (' + Math.round(ev.data.length / 1024) + ' KB' + (ev.readMs ? ', lectura ' + Math.round(ev.readMs / 100) / 10 + ' s' : '') + ')');
    try { if (typeof window.NEXO_noteSpeed === 'function' && ev.readMs > 0) window.NEXO_noteSpeed('l2', 'in', Math.round(ev.data.length * 3 / 4), ev.readMs); } catch (e) {}
    var ack = self.ble.ackSystem;
    if (!ack) { self._nativeAck(id, false); return; }
    // T-E1 (como los trozos desde la 2767): completo y confirmado SOLO tras descifrarlo bien. Antes se marcaba completo y el byte de
    // «recibido» salía al tener los bytes: si no se podía leer (desfase de claves) se perdía en silencio con ✓✓ en quien envía.
    var m = Object.assign({}, inc.meta, { fr: inc.meta.fr || inc.from, senderNexoId: inc.meta.fr || inc.from, fromNexoId: inc.meta.fr || inc.from });
    var called = false;
    ack._dispatchFileComplete(id, ev.data, m, function(ok) {
      if (called) return; called = true;
      // Como un flujo terminado: si luego llega también en trozos, se descarta (solo si se pudo leer: si no, los trozos sí valen)
      if (ok && ack.completedMessages) ack.completedMessages.set(id, { total: 1, expireAt: Date.now() + 600000 });
      if (!ok) console.warn('[L2] ' + id + ': llegó pero no se pudo descifrar: sin confirmar (quien envía sigue por trozos)');
      self._nativeAck(id, ok);
    });
  }
}

export function createL2Fast(ble) { return new L2Fast(ble); }
