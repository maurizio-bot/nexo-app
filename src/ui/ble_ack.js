import { e2eAvailable } from '../vault/e2e_crypto.js';
import { e2eAnyEncrypted, e2eOuterAd, e2eSealText, e2eSealB64, e2eOpenText, e2eOpenToB64 } from '../vault/e2e_proto.js';
import { ratchetCanEncrypt } from '../vault/e2e_ratchet.js';
/**
* v3.14.0: el mismo mensaje troceado distinto por otro camino (puente cortado y reenvío directo) ya no se queda sin completar
* v3.13.0: trozos de archivo en binario por Bluetooth (BinFrame.kt; sin el 33 % del base64) con quien lo anuncia
*         ('bf' en kx, pings y acks); con builds anteriores, el JSON de siempre.
* v3.12.1: el registro de arranque dice la versión real (decía v3.2.12).
* v3.12.0: internet: enlace "net:" (trozos de 8-16 KB; archivos solo si los dos están en Wi-Fi).
* v3.11.0: remitente sellado por Jump: el nombre y el NEXO ID de quien manda un flujo van en un sobre para el destino
*         (meta.sealedFrom → fr "sx:…"); las confirmaciones dirigidas también (ble._sealObj).
* v3.10.0: Wi-Fi normal (lan.js): por un enlace "lan:<NEXO ID>" van trozos grandes y los archivos sin Wi-Fi Direct;
*         si el Wi-Fi se cae a mitad, el envío sigue por Bluetooth (useLink).
* v3.9.0: cada trozo lleva su comprobación (k): uno dañado por el camino se vuelve a pedir en vez de aceptarse
*         (la foto acababa sin poder descifrarse). Tiempos de cada texto en el diagnóstico ([SEND]).
* v3.8.0: Fénix: los archivos con meta.type 'fenix' van a fenix.onFile (no al chat ni a su progreso).
* v3.7.1: Wi-Fi Direct fallido: WD_FAILED si no cabe por Bluetooth (antes quedaba pendiente para siempre);
*         el HD de un vídeo (hasta BLE_HD_MAX_CHARS) sigue por Bluetooth como antes de Wi-Fi Direct.
* v3.7.0: Protocolo 2 de cifrado (e2e_ratchet.js, como Signal) con los contactos que lo tienen; el 1 con builds
*         anteriores (e2e_proto.js elige). Los datos del sobre (emisor|destino|id) van atados al cifrado: el id
*         se fija antes de cifrar. Nombre y miniatura de un archivo: ids "<id>#n" y "<id>#t". Un reintento de
*         algo ya descifrado (DUP) no se muestra otra vez.
* v3.6.0: Wi-Fi Direct (wifi_direct.js): los archivos grandes van primero por Wi-Fi Direct si el contacto
*         está a alcance y también lo tiene; si falla, por Bluetooth como siempre (_sendFileBest).
* v3.5.0: Jump (ble_relay.js): envío a un destino por otro teléfono (opts.dst / meta.dst: se cifra
*         para el destino; trozos con 'dt' y 'hp'), custodia 'rk', reenvío de flujos en un puente
*         (forwardStream) y ack de extremo a extremo dirigido al origen.
* v3.4.0: Cifrado de extremo a extremo: textos (cortos y largos) y adjuntos se cifran aquí con la
*         clave pública del destinatario (nunca salen en claro; sin clave → NO_KEY y queda pendiente)
*         y se descifran al llegar (también nombre y miniatura del archivo). Una transferencia entregada se borra del registro de salientes
*         (antes se reenviaba entera al abrir la app o reconectar).
* v3.3.4: Miniatura del vídeo ('th') en la cabecera.
* v3.3.3: Vídeo HD: cabecera 'hf' (mensaje que mejora), tiempo máximo según tamaño y sin
*         transferencias duplicadas al reanudar una que sigue en curso.
* v3.3.2: Eventos de progreso de envío y recepción de archivos (cada 5 %).
* v3.3.1: Sincronización de sesión con el seq correcto (solo mensajes recibidos del otro) y reenvío de
 *         lo propio sin confirmar.
 * v3.3.0: Transferencias sin tormenta de retransmisiones: NACK solo de huecos reales, ack agrupado
 *         (cada 4 trozos o 150 ms), sin reenvío por ack parcial, la ventana avanza al confirmarse,
 *         trozos de 360, ventana 8, sin persistir cada trozo recibido (se escribía y nunca se leía).
 * FIX v3.2.13: read_receipt ya no se descarta tras el ack del mismo mensaje; mensajes largos
 *             reensamblados se guardan (sin fromVault); el MIME viaja en 'mt'.
 * FIX v3.2.12: resumeOutgoingTransfers respeta tx.type — antes reenviaba SIEMPRE
 *             vía sendChunkedMessage (tipo 'chat'), corrompiendo fotos/videos
 *             interrumpidos (llegaban como texto plano en vez de adjunto)
 * FIX v3.2.12: width/height de imagen ahora viajan en el chunk 0 (se descartaban)
 * FIX v3.2.12: eliminado ChatStream.handlePartialAck (código muerto, nunca se
 *             invocaba; _handleBlockAck ya tiene la lógica real inline)
 * FIX: Transferencia de archivos/fotos fiable — chunk 60, ventana 3, pacing 40ms
 * FIX: Timeout global de archivos 10 min (escala con nº de chunks)
 * FIX: Assembly timeout 120s (fotos grandes)
 * FIX: Emisor ya NO dispara fileComplete con data=null (solo receptor)
 * FIX: Meta de recepción incluye type/format/sender de forma consistente
 * FIX: firstChunkMax 40 para archivos (respeta MTU BLE)
 * FIX: restaurado _normMac/_normId (rompían envío de archivos)
 * FIX: getBLEContacts vía this.ble (resumeOutgoingTransfers y _resolveNexoId)
 * Base: v3.2.11-NEXO
 */
const PROTOCOL_VERSION = 2;
// v3.3.0: trozos de 360 caracteres (con la cabecera JSON caben en una escritura con MTU 512;
// con MTU menor el nativo los parte y los reensambla). Antes 80-90 => 4-5x más paquetes.
const CHAT_CHUNK_SIZE = 360;
const CHAT_WINDOW_SIZE = 8;
const CHAT_WINDOW_TIMEOUT_MS = 3000;
const CHAT_PACING_DELAY_MS = 2;
const FILE_CHUNK_SIZE = 360;
// Ronda 2757: con MTU pequeño (20 bytes por escritura) un trozo de 60 era 60 de datos + 90 de cabecera: el 60 % de la
// radio en cabeceras. Medido (MTU 23, foto 45 KB): 60 → 191 s, 240 → 95 s; con 2 % de pérdidas 240 → 423 s, 360 → 567 s
function SMALL_MTU_MIN_CHUNK() { return (typeof window !== 'undefined' && Number(window.NEXO_SMALL_CHUNK)) || 240; }
const FILE_WINDOW_SIZE = 12;
// Receptor: confirma cada ACK_EVERY trozos o tras ACK_DEBOUNCE_MS sin más trozos (antes, uno por trozo)
const ACK_EVERY = 4;
const ACK_DEBOUNCE_MS = 150;
const NACK_INTERVAL_MS = 1500;
const FILE_WINDOW_TIMEOUT_MS = 8000;
const FILE_PACING_DELAY_MS = 2; // el nativo ya regula el ritmo (control de flujo por callback)
const MAX_WINDOW_RETRIES = 8;
// v3.10.0: Wi-Fi normal (lan.js): trozos grandes por la misma red
const LAN_FILE_CHUNK = 24000;
const LAN_CHAT_CHUNK = 8000;
const LAN_PSEUDO_MTU = 65535;
// v3.12.0: enlace por internet (relés públicos, net_link.js): "net:<NEXO ID>" (normalizado "netnx…")
function _isNetDevice(deviceId) { var d = (deviceId || '').toString().toLowerCase(); return d.indexOf('net:') === 0 || /^netnx[0-9a-z]{8}$/.test(d); }
const NET_FILE_CHUNK = 16000;   // un evento de relé admite ~64 KB (con cifrado y base64)
const NET_CHAT_CHUNK = 8000;
const NET_TEXT_ONE = 20000;     // un texto (ya cifrado) hasta este tamaño va en un solo paquete (buzón)
function _isLanDevice(deviceId) { var d = (deviceId || '').toString().toLowerCase(); return d.indexOf('lan:') === 0 || /^lannx[0-9a-z]{8}$/.test(d); }
const BLE_FILE_MAX_CHARS = 3100000; // tope por Bluetooth (main.js MAX_BLE_B64_BYTES + cabecera de cifrado)
const BLE_HD_MAX_CHARS = 9500000;   // HD de vídeo (main.js MAX_HD_B64_BYTES + relleno y cabecera de cifrado)
const ASSEMBLY_TIMEOUT_MS = 120000;
const COMPLETED_TTL_MS = 60000;
const GLOBAL_TIMEOUT_MS = 180000;
const FILE_GLOBAL_TIMEOUT_MS = 600000;
const SHORT_MSG_TIMEOUT_MS = 1000;
const SHORT_MSG_MAX_RETRIES = 5;
const SHORT_MSG_BACKOFF_DELAYS = [1000, 1000, 1500, 2000, 2500, 3000];
function _normMac(mac) {
  return (mac || '').toString().toLowerCase().replace(/[:-]/g, '').trim();
}
// v3.13.0 (ronda 2753): trozos de archivo en binario por Bluetooth (BinFrame.kt). Un trozo va así si es base64
// canónico (al llegar, el nativo lo vuelve a poner en base64 y debe salir el mismo texto) y el otro teléfono avisó
// con 'bf' de que lo entiende; si no, el trozo JSON de siempre. Se ahorra el 33 % del base64 por la radio.
var _B64_RE = /^[A-Za-z0-9+/]+={0,2}$/;
function _binOk(s) {
  if (!s || s.length % 4 || !_B64_RE.test(s)) return false;
  try { return btoa(atob(s)) === s; } catch (e) { return false; }
}
// Dónde empiezan los datos en base64 (tras la cabecera del cifrado "E2:…:"): los trozos se alinean a partir de ahí
function _b64BodyStart(str) {
  for (var i = Math.min(str.length, 16384) - 1; i >= 0; i--) {
    var c = str.charCodeAt(i);
    if (!((c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 43 || c === 47 || c === 61)) return i + 1;
  }
  return 0;
}
function _newMsgId() { return 'msg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6); }
// v3.9.0: comprobación de cada trozo (FNV-1a de 32 bits de lo que importa). Si por Bluetooth se pierde un
// pedazo de un paquete, lo que queda puede seguir siendo un JSON válido con los datos más cortos: el receptor lo
// aceptaba y la foto entera acababa sin poder descifrarse (perdida en silencio). Builds anteriores no la mandan.
function _chunkCheck(o) {
  var s = [o.m, o.i, o.n, o.d, o.th || '', o.fn || ''].join('|');
  var h = 0x811c9dc5;
  for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(36);
}
function _normId(id) {
  return (id || '').toString().toLowerCase().trim();
}
// Mayor seq de los mensajes RECIBIDOS del otro (su contador); los propios usan nuestro contador
function _maxSeqFromPeer(msgs) {
  var max = 0;
  (msgs || []).forEach(function(m) { if (!m._own && typeof m.seq === 'number' && m.seq > max) max = m.seq; });
  return max;
}
function _compressRanges(indices) {
  if (!indices || indices.length === 0) return '';
  var result = [];
  var start = indices[0];
  var prev = indices[0];
  for (var i = 1; i <= indices.length; i++) {
    if (i < indices.length && indices[i] === prev + 1) {
      prev = indices[i];
    } else {
      result.push(start === prev ? start.toString() : start + '-' + prev);
      if (i < indices.length) { start = indices[i]; prev = indices[i]; }
    }
  }
  return result.join(',');
}
function _decompressRanges(str) {
  var result = [];
  if (!str) return result;
  var parts = str.split(',');
  for (var i = 0; i < parts.length; i++) {
    var part = parts[i].trim();
    if (!part) continue;
    var dash = part.indexOf('-');
    if (dash >= 0) {
      var s = parseInt(part.substring(0, dash), 10);
      var e = parseInt(part.substring(dash + 1), 10);
      if (isNaN(s) || isNaN(e)) continue;
      for (var j = s; j <= e; j++) result.push(j);
    } else {
      var n = parseInt(part, 10);
      if (!isNaN(n)) result.push(n);
    }
  }
  return result;
}
export class BleAckSystem {
  constructor(bleInterface) {
    this.ble = bleInterface;
    this.pendingAcks = new Map();
    this.ackTimeoutMs = SHORT_MSG_TIMEOUT_MS;
    this.maxRetries = SHORT_MSG_MAX_RETRIES;
    this.receivedAcks = new Set();
    this.maxReceivedAcks = 500;
    this.chunkSize = CHAT_CHUNK_SIZE;
    this.windowSize = CHAT_WINDOW_SIZE;
    this.windowTimeoutMs = CHAT_WINDOW_TIMEOUT_MS;
    this.outgoingStreams = new Map();
    this.preparing = new Set(); // ids cifrándose (aún sin ack pendiente ni flujo): cuentan como en vuelo
    this.incomingBuffers = new Map();
    this.pendingFragments = new Map();
    this.maxFragmentAge = 300000;
    this.pendingOutgoingFiles = new Map();
    this.pendingOutgoingTransfers = new Map();
    this.blockAckTimers = new Map();
    this.completedMessages = new Map();
    this._startCleanupInterval();
    console.log('[BleAckSystem] v3.14.0-NEXO iniciado');
  }
  _resolveNexoId(deviceId) {
    // Enlaces Wi-Fi e internet: el NEXO ID va en el propio identificador ("lan:nx…", "net:nx…")
    var v = (deviceId || '').toString().toLowerCase().match(/^(?:lan|net):?(nx[0-9a-z]{8})$/);
    if (v) return v[1];
    var mac = _normMac(deviceId);
    if (this.ble && this.ble._macToNexoId) {
      var nx = this.ble._macToNexoId.get(mac);
      if (nx) return nx;
    }
    var contacts = (this.ble && typeof this.ble.getBLEContacts === 'function') ? this.ble.getBLEContacts() : [];
    for (var i = 0; i < contacts.length; i++) {
      if (_normMac(contacts[i].deviceId) === mac) return _normId(contacts[i].nexoId);
    }
    return mac;
  }
  sendChunkedMessage(deviceId, content, meta, messageId, seq) {
    var self = this;
    var dst = meta && meta.dst;
    if (e2eAvailable() && content && !e2eAnyEncrypted(content)) {
      if (content.length <= 150) return self.sendWithRetry(deviceId, content, messageId, seq, dst ? { dst: dst } : undefined);
      var cid = messageId || _newMsgId();
      return self._preparingFor(cid, self._ensurePeerKey(deviceId, dst)
        .then(function(t) { return e2eSealText(t, content, self._outAd(t, cid)); }))
        .then(function(enc) { return self.sendChunkedMessage(deviceId, enc, meta, cid, seq); });
    }
    // v3.12.0: por internet un texto va en un solo paquete: sirve de buzón (el otro puede no estar en línea; un flujo
    // por trozos esperaría confirmaciones que no llegan)
    if (_isNetDevice(deviceId) && !dst && content.length <= NET_TEXT_ONE && (!e2eAvailable() || e2eAnyEncrypted(content))) {
      return self._sendWithRetryRaw(deviceId, content, messageId || _newMsgId(), seq);
    }
    if (dst && content.length > 150 && !(meta && 'sealedFrom' in meta)) {
      return self._withSealedFrom(Object.assign({}, meta)).then(function(m2) { return self.sendChunkedMessage(deviceId, content, m2, messageId, seq); });
    }
    return new Promise(function(resolve, reject) {
      var msgId = messageId || ('msg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6));
      var senderId = (self.ble && self.ble.localNexoId) || ((self.ble && self.ble.localDeviceUUID) ? self.ble.localDeviceUUID : 'unknown');
      var fromName = (self.ble && self.ble.localDeviceName) || 'NEXO';
      var ts = Date.now();
      if (meta && meta.sealedFrom) { senderId = meta.sealedFrom; fromName = ''; }
      var finalMeta = Object.assign({}, meta || {}, { f: fromName, fr: senderId, ts: ts });
      if (typeof seq !== 'number') {
        seq = (self.ble && typeof self.ble.getNextSeq === 'function') ? self.ble.getNextSeq() : 0;
      }
      finalMeta.seq = seq;
      if (content.length <= 150) {
        self.sendWithRetry(deviceId, content, msgId, seq, dst ? { dst: dst } : undefined).then(resolve).catch(reject);
        return;
      }
      var stream = new ChatStream(self, deviceId, msgId, content, finalMeta, 'chat');
      self.outgoingStreams.set(msgId, stream);
      stream.start().then(function() {
        self.outgoingStreams.delete(msgId);
        resolve();
      }).catch(function(err) {
        self.outgoingStreams.delete(msgId);
        reject(err);
      });
    });
  }
  sendFile(deviceId, fileId, base64Data, meta) {
    var self = this;
    var running = self.outgoingStreams.get(fileId);
    if (running && !running.aborted && running._promise) return running._promise;
    if (e2eAvailable() && base64Data && !e2eAnyEncrypted(base64Data)) {
      // También el nombre y la miniatura del vídeo, que van en la cabecera
      var m = meta || {};
      return self._preparingFor(fileId, self._ensurePeerKey(deviceId, m.dst).then(function(t) {
        return Promise.all([
          e2eSealB64(t, base64Data, self._outAd(t, fileId)),
          (m.thumb && !e2eAnyEncrypted(m.thumb)) ? e2eSealB64(t, m.thumb, self._outAd(t, fileId + '#t')) : m.thumb,
          (m.name && !e2eAnyEncrypted(m.name)) ? e2eSealText(t, m.name, self._outAd(t, fileId + '#n')) : m.name
        ]);
      })).then(function(r) {
        var em = Object.assign({}, m);
        if (r[1]) em.thumb = r[1];
        if (r[2]) em.name = r[2];
        return self._withSealedFrom(em).then(function(em2) { return self._sendFileBest(deviceId, fileId, r[0], em2); });
      });
    }
    return self._sendFileBest(deviceId, fileId, base64Data, meta);
  }
  // v3.11.0: por Jump (meta.dst) a un contacto que entiende el remitente sellado: nombre y NEXO ID en sobre
  _withSealedFrom(meta) {
    var self = this, ble = self.ble;
    if (!meta || !meta.dst || meta.sealedFrom || !ble || typeof ble.sealedFrom !== 'function') return Promise.resolve(meta || {});
    return ble.sealedFrom(meta.dst, ble.localDeviceName || 'NEXO', ble.localNexoId).then(function(sf) {
      meta.sealedFrom = sf || null;
      return meta;
    }).catch(function() { meta.sealedFrom = null; return meta; });
  }
  // Receptor: el remitente de un flujo llegó sellado ("sx:…"): se abre (una vez) y se pone en la cabecera
  _unsealFrom(buf) {
    var self = this, fr = buf && buf.meta && buf.meta.fr;
    if (!fr || String(fr).indexOf('sx:') !== 0 || !self.ble || typeof self.ble.openSealedFrom !== 'function') return Promise.resolve(buf);
    if (!buf._unsealing) {
      buf._unsealing = self.ble.openSealedFrom(fr).then(function(o) {
        buf.meta.fr = buf.meta.senderNexoId = buf.meta.fromNexoId = o.fr;
        if (o.f) buf.meta.f = o.f;
        return buf;
      }).catch(function(e) { console.warn('[JUMP] Remitente sellado ilegible: ' + (e && e.message)); buf.meta.badSeal = true; return buf; });
    }
    return buf._unsealing;
  }
  // v3.10.0: se cayó el Wi-Fi con un contacto (oldId "lan:<nx>"). Lo que iba por él sigue por `next` (Bluetooth);
  // lo que no cabe por Bluetooth (vídeo original, archivo grande) o si no hay Bluetooth, se para con WD_FAILED /
  // PEER_ABSENT y quien lo mandó decide (vídeo: previa + HD; lo demás: pendiente hasta que vuelva un camino).
  relink(oldId, next) {
    var self = this, nd = _normMac(oldId);
    self.pendingAcks.forEach(function(e) { if (next && _normMac(e.deviceId) === nd) e.deviceId = next; });
    self.outgoingStreams.forEach(function(st, id) {
      if (!st || _normMac(st.deviceId) !== nd) return;
      var limit = (st.meta && st.meta.hdFor) ? BLE_HD_MAX_CHARS : BLE_FILE_MAX_CHARS;
      var tooBig = st.type === 'file' && ((st.meta && st.meta.wdOnly) || String(st.content || '').length > limit);
      if (next && !tooBig) { st.useLink(next); return; }
      var e = new Error(tooBig ? 'Wi-Fi caído y no cabe por Bluetooth' : 'Contacto no disponible: queda pendiente');
      e.code = tooBig ? 'WD_FAILED' : 'PEER_ABSENT';
      var rej = st.reject; st.reject = null;
      st.abort();
      self.outgoingStreams.delete(id);
      if (st.type === 'file') self._dispatchFileProgress(id, 0, 1, tooBig ? 'failed' : 'sending', 0);
      if (rej) rej(e);
    });
  }
  // v3.13.0: el otro teléfono entiende trozos binarios (lo dice con 'bf' en sus acks y pings)
  markBin(deviceId, off) {
    if (!deviceId || _isLanDevice(deviceId) || _isNetDevice(deviceId)) return;
    if (!this._binPeers) this._binPeers = new Set();
    var nx = this._resolveNexoId(deviceId), keys = [_normMac(deviceId)];
    if (nx) keys.push(_normId(nx));
    var set = this._binPeers;
    keys.forEach(function(k) { if (off) set.delete(k); else set.add(k); });
  }
  peerBin(deviceId) {
    if (!this._binPeers || !deviceId || _isLanDevice(deviceId) || _isNetDevice(deviceId)) return false;
    if (this._binPeers.has(_normMac(deviceId))) return true;
    var nx = this._resolveNexoId(deviceId);
    return !!(nx && this._binPeers.has(_normId(nx)));
  }
  // Datos de cabecera de un archivo (los mismos por Bluetooth y por Wi-Fi Direct)
  _fileMeta(meta, size) {
    var senderId = (this.ble && this.ble.localNexoId) || ((this.ble && this.ble.localDeviceUUID) ? this.ble.localDeviceUUID : 'unknown');
    var fromName = (this.ble && this.ble.localDeviceName) || 'NEXO';
    var seq = (this.ble && typeof this.ble.getNextSeq === 'function') ? this.ble.getNextSeq() : 0;
    // v3.11.0: por Jump con remitente sellado, el nombre y el NEXO ID van en el sobre (meta.sealedFrom)
    if (meta && meta.sealedFrom) { fromName = ''; senderId = meta.sealedFrom; }
    return Object.assign({}, meta || {}, {
      f: fromName,
      fr: senderId,
      senderNexoId: senderId,
      ts: Date.now(),
      seq: seq,
      file: true,
      type: (meta && meta.type) ? meta.type : 'file',
      size: (meta && meta.size) ? meta.size : size
    });
  }
  // v3.6.0: Wi-Fi Direct primero si se puede (mucho más rápido); si falla, Bluetooth
  _sendFileBest(deviceId, fileId, data, meta) {
    var self = this, wd = self.ble && self.ble.wifiDirect;
    // v3.10.0: misma red Wi-Fi: por ahí directamente (rápido, sin montar grupo; también el vídeo original)
    if (_isNetDevice(deviceId)) {
      // Por internet, archivos solo con los dos en Wi-Fi (con datos móviles cuestan dinero): si no, queda pendiente
      var net = self.ble && self.ble.net;
      if (!net || !net.filesOk(self._resolveNexoId(deviceId))) {
        var en = new Error('Contacto no disponible: queda pendiente'); en.code = 'PEER_ABSENT';
        return Promise.reject(en);
      }
      return self._sendFileJS(deviceId, fileId, data, meta);
    }
    if (_isLanDevice(deviceId)) return self._sendFileJS(deviceId, fileId, data, meta);
    if (!data || !wd || (meta && meta.dst) || !wd.eligible(deviceId, data.length)) {
      // Vídeo original pensado para Wi-Fi Direct que ya no puede ir por ahí: la app lo manda como previa + HD
      if (meta && meta.wdOnly) { var e0 = new Error('Wi-Fi Direct no disponible'); e0.code = 'WD_FAILED'; return Promise.reject(e0); }
      return self._sendFileJS(deviceId, fileId, data, meta);
    }
    var running = self.outgoingStreams.get(fileId);
    if (running && !running.aborted && running._promise) return running._promise;
    self._dispatchFileProgress(fileId, 0, 1, 'sending', 1);
    return wd.send(deviceId, fileId, data, self._fileMeta(meta, data.length)).then(function() {
      self._dispatchStatus(fileId, 'delivered');
      self._dispatchFileProgress(fileId, 1, 1, 'delivered', 100);
    }, function(err) {
      // v3.7.1: falló Wi-Fi Direct. Si no cabe por Bluetooth (o es el vídeo original, que la app manda por
      // otro camino) → WD_FAILED: quien llama decide (vídeo: previa + HD por Bluetooth; archivo: fallido con
      // aviso). Hasta la 2712 quedaba "pendiente" para siempre (1 % en el emisor). El HD sí va por Bluetooth.
      var limit = (meta && meta.hdFor) ? BLE_HD_MAX_CHARS : BLE_FILE_MAX_CHARS;
      if ((meta && meta.wdOnly) || data.length > limit) {
        var e = new Error('Wi-Fi Direct falló (' + (err && err.message) + ')');
        e.code = 'WD_FAILED';
        self._dispatchFileProgress(fileId, 0, 1, 'failed', 0);
        throw e;
      }
      return self._sendFileJS(deviceId, fileId, data, meta);
    });
  }
  _sendFileJS(deviceId, fileId, base64Data, meta) {
    var self = this;
    return new Promise(function(resolve, reject) {
      if (!base64Data || typeof base64Data !== 'string' || base64Data.length === 0) {
        reject(new Error('Datos de archivo vacios'));
        return;
      }
      var finalMeta = self._fileMeta(meta, base64Data.length);
      // v3.3.3: reanudar (resumeOutgoingTransfers) una transferencia que sigue en curso creaba un segundo
      // flujo con el mismo id que pisaba al primero
      var running = self.outgoingStreams.get(fileId);
      if (running && !running.aborted && running._promise) {
        console.log('[BleAckSystem] sendFile ya en curso fileId=' + fileId);
        running._promise.then(resolve, reject);
        return;
      }
      console.log('[BleAckSystem] sendFile START fileId=' + fileId + ' type=' + finalMeta.type + ' bytes(b64)=' + base64Data.length + ' to=' + deviceId);
      if (self.ble && typeof self.ble._stopAutoScan === 'function') self.ble._stopAutoScan();
      var stream = new ChatStream(self, deviceId, fileId, base64Data, finalMeta, 'file');
      self.outgoingStreams.set(fileId, stream);
      stream._promise = stream.start();
      stream._promise.then(function() {
        self.outgoingStreams.delete(fileId);
        console.log('[BleAckSystem] sendFile OK fileId=' + fileId);
        resolve();
      }).catch(function(err) {
        self.outgoingStreams.delete(fileId);
        console.warn('[BleAckSystem] sendFile FAIL fileId=' + fileId, err && err.message);
        reject(err);
      });
    });
  }
  processIncomingFragment(dataObj) {
    try {
      var deviceId = dataObj.deviceId;
      var content = dataObj.content;
      var msg = JSON.parse(content);
      var type = msg.t || msg.type;
      if (type === 'ba' || type === 'block_ack') { this._handleBlockAck(msg); return true; }
      if (type === 'ack' || type === 'read_receipt') { this.processIncomingAck(content); return true; }
      if (type === 'ping' || type === 'pong') { if (msg.bf) this.markBin(deviceId); return false; } // 'bf': entiende trozos binarios
      if (type === 'n') { this._handleNack(msg); return true; }
      if (type === 'a') { this._handleLegacyChunkAck(msg); return true; }
      if (type === 'ss') { this._handleSessionSync(deviceId, msg); return true; }
      if (type === 'sr') { this._handleSessionSyncResponse(deviceId, msg); return true; }
      if (type === 'c' || type === 'f') {
        this._handleIncomingChunk(deviceId, msg, type);
        return true;
      }
      if (type === 'fm' || type === 'fd') {
        console.warn('[BleAckSystem] Ignorando chunk nativo obsoleto:', type);
        return true;
      }
      return false;
    } catch (e) {
      return false;
    }
  }
  _handleIncomingChunk(deviceId, msg, type) {
    var self = this;
    var msgId = msg.m || msg.msgId;
    var idx = (typeof msg.i === 'number') ? msg.i : msg.idx;
    var total = (typeof msg.n === 'number') ? msg.n : msg.total;
    var data = msg.d || msg.data;
    var from = msg.fr || msg.from;
    var seq = (typeof msg.seq === 'number') ? msg.seq : 0;
    if (!msgId || typeof idx !== 'number' || typeof total !== 'number') return;
    if (total <= 0 || idx < 0 || idx >= total) return;
    // Trozo dañado por el camino: se ignora (queda como hueco y se vuelve a pedir)
    if (msg.k !== undefined && msg.k !== _chunkCheck(msg)) {
      self.stats = self.stats || {}; self.stats.badChunks = (self.stats.badChunks || 0) + 1;
      console.warn('[BleAckSystem] Trozo ' + idx + ' de ' + msgId + ' dañado: se vuelve a pedir');
      // Se pide ya (sin esperar a notar el hueco): el emisor lo reenvía enseguida
      if (!self.completedMessages.get(msgId)) self._sendNack(deviceId, msgId, [idx]);
      return;
    }
    var completed = self.completedMessages.get(msgId);
    if (completed) {
      self._sendFinalAck(deviceId, msgId, total);
      return;
    }
    var buf = self.incomingBuffers.get(msgId);
    // Ronda 2758: el mismo mensaje llega por otro camino troceado distinto (el puente Jump lo empezó y se cortó, y el
    // emisor lo manda directo): si lo que había a medias está parado, se empieza con el nuevo (antes se mezclaban los
    // trozos y no se completaba nunca); si los dos siguen activos, se sigue con el primero
    if (buf && buf.total !== total) {
      if (Date.now() - (buf.lastActivity || 0) < 4000) return;
      console.warn('[BleAckSystem] ' + msgId + ' llega troceado distinto (' + buf.total + ' → ' + total + ' trozos): se empieza de nuevo');
      if (buf.assemblyTimer) clearTimeout(buf.assemblyTimer);
      self.incomingBuffers.delete(msgId);
      buf = null;
    }
    if (!buf && idx !== 0) {
      var missing = [];
      for (var i = 0; i <= Math.min(idx, total - 1); i++) missing.push(i);
      self._sendNack(deviceId, msgId, missing);
      return;
    }
    if (!buf) {
      var resolvedType = msg.tp || msg.type || (type === 'f' ? 'file' : null);
      var resolvedFrom = from || msg.fr || 'unknown';
      buf = {
        chunks: new Map(), total: total,
        meta: {
          f: msg.f || 'NEXO',
          fr: resolvedFrom,
          senderNexoId: resolvedFrom,
          fromNexoId: resolvedFrom,
          ts: msg.ts || Date.now(),
          seq: seq,
          type: resolvedType,
          name: msg.fn || msg.name,
          mime: msg.mt || msg.mime,
          size: msg.fs || msg.size,
          format: msg.ft || msg.format,
          width: msg.w || msg.width,
          height: msg.h || msg.height,
          hdFor: msg.hf || null,
          preview: msg.pv === 1,
          thumb: msg.th || null,
          pages: msg.pg || null,
          dst: msg.dt || null,
          hp: msg.hp || 0
        },
        received: 0, deviceId: deviceId, lastActivity: Date.now(),
        isChat: type === 'c', nackSent: false
      };
      self.incomingBuffers.set(msgId, buf);
      if (!buf.isChat && self.ble && typeof self.ble._stopAutoScan === 'function') self.ble._stopAutoScan();
      buf.assemblyTimer = setTimeout(function() {
        if (self.incomingBuffers.has(msgId)) {
          console.warn('[BleAckSystem] Assembly timeout msgId=' + msgId);
          self._reportIncomingProgress(msgId, self.incomingBuffers.get(msgId), 'failed');
          self.incomingBuffers.delete(msgId);
        }
      }, ASSEMBLY_TIMEOUT_MS);
    }
    if (!buf.chunks.has(idx)) {
      buf.chunks.set(idx, data || '');
      buf.received++;
      if (typeof buf.maxIdx !== 'number' || idx > buf.maxIdx) buf.maxIdx = idx;
      buf.lastActivity = Date.now();
      if (buf.assemblyTimer) clearTimeout(buf.assemblyTimer);
      buf.assemblyTimer = setTimeout(function() {
        if (self.incomingBuffers.has(msgId)) {
          console.warn('[BleAckSystem] Assembly timeout msgId=' + msgId);
          self._reportIncomingProgress(msgId, self.incomingBuffers.get(msgId), 'failed');
          self.incomingBuffers.delete(msgId);
        }
      }, ASSEMBLY_TIMEOUT_MS);
    }
    var senderId = from || (buf.meta && buf.meta.fr) || 'unknown';
    if (buf.received >= buf.total) {
      if (buf.assemblyTimer) clearTimeout(buf.assemblyTimer);
      if (buf.ackTimer) { clearTimeout(buf.ackTimer); buf.ackTimer = null; }
      self._assembleAndDispatch(buf, deviceId, senderId, msgId);
      return;
    }
    // v3.3.0: ack agrupado (antes uno por trozo: saturaba la cola nativa de 80 ms por notify)
    self._scheduleBlockAck(deviceId, msgId, buf);
    self._reportIncomingProgress(msgId, buf);
    // v3.3.0: NACK solo de huecos reales (por debajo del mayor índice recibido). Antes incluía todos
    // los trozos futuros ("2-767") y el emisor los reenviaba todos: tormenta de retransmisiones.
    var gaps = self._findGaps(buf);
    var now = Date.now();
    if (gaps.length > 0 && (!buf.lastNackAt || now - buf.lastNackAt > NACK_INTERVAL_MS)) {
      buf.lastNackAt = now;
      self._sendNack(deviceId, msgId, gaps);
    }
  }
  _findGaps(buf) {
    var gaps = [];
    for (var i = 0; i < buf.maxIdx; i++) {
      if (!buf.chunks.has(i)) gaps.push(i);
    }
    return gaps;
  }
  _scheduleBlockAck(deviceId, msgId, buf) {
    var self = this;
    if (buf.received % ACK_EVERY === 0) {
      if (buf.ackTimer) { clearTimeout(buf.ackTimer); buf.ackTimer = null; }
      self._sendBlockAck(deviceId, msgId, buf);
      return;
    }
    if (buf.ackTimer) return;
    buf.ackTimer = setTimeout(function() {
      buf.ackTimer = null;
      if (self.incomingBuffers.get(msgId) === buf) self._sendBlockAck(deviceId, msgId, buf);
    }, ACK_DEBOUNCE_MS);
  }
  _findMissing(buf) {
    var missing = [];
    for (var i = 0; i < buf.total; i++) {
      if (!buf.chunks.has(i)) missing.push(i);
    }
    return missing;
  }
  _assembleAndDispatch(buf, deviceId, senderId, msgId) {
    var self = this;
    var assembled = '';
    for (var i = 0; i < buf.total; i++) {
      assembled += buf.chunks.has(i) ? buf.chunks.get(i) : '';
    }
    self._sendFinalAck(deviceId, msgId, buf.total);
    self.completedMessages.set(msgId, { total: buf.total, expireAt: Date.now() + COMPLETED_TTL_MS });
    self.incomingBuffers.delete(msgId);
    // Jump: va para otro teléfono → hacer de puente (no se muestra ni se descifra aquí)
    var relay = self.ble && self.ble.relay;
    if (relay && buf.meta.dst && relay.onStreamComplete(buf.isChat ? 'chat' : 'file', msgId, assembled, buf.meta, deviceId)) return;
    // v3.11.0: remitente sellado: abrir antes de seguir
    if (String(buf.meta.fr || '').indexOf('sx:') === 0) {
      self._unsealFrom(buf).then(function() {
        if (buf.meta.badSeal) return;
        self._finishAssembly(buf, deviceId, buf.meta.fr, msgId, assembled);
      });
      return;
    }
    self._finishAssembly(buf, deviceId, senderId, msgId, assembled);
  }
  _finishAssembly(buf, deviceId, senderId, msgId, assembled) {
    var self = this;
    // Llegó por otro teléfono: confirmación de extremo a extremo al origen
    if (buf.meta.hp > 0 && buf.meta.fr) self.sendAck(deviceId, msgId, buf.meta.fr);
    if (buf.isChat) {
      self._dispatchChunkedMessageComplete(senderId, assembled, buf.meta, deviceId, msgId);
    } else {
      self._dispatchFileComplete(msgId, assembled, buf.meta);
      self._dispatchFileProgress(msgId, buf.total, buf.total, 'received', 100);
    }
  }
  _sendNack(deviceId, msgId, indices) {
    var ranges = _compressRanges(indices);
    var payload = JSON.stringify({ v: PROTOCOL_VERSION, t: 'n', m: msgId, r: ranges, bf: 1 });
    if (this.ble && this.ble._sendMessageNative) {
      this.ble._sendMessageNative(deviceId, payload, null).catch(function(){});
    }
  }
  _sendBlockAck(deviceId, msgId, buf) {
    var received = [];
    for (var i = 0; i < buf.total; i++) {
      if (buf.chunks.has(i)) received.push(i);
    }
    var ranges = _compressRanges(received);
    var payload = JSON.stringify({ v: PROTOCOL_VERSION, t: 'ba', m: msgId, r: ranges, n: buf.total, bf: 1 });
    if (this.ble && this.ble._sendMessageNative) {
      this.ble._sendMessageNative(deviceId, payload, null).catch(function(){});
    }
  }
  _sendFinalAck(deviceId, msgId, total) {
    var ranges = (total <= 1) ? '0' : '0-' + (total - 1);
    var payload = JSON.stringify({ v: PROTOCOL_VERSION, t: 'ba', m: msgId, r: ranges, n: total, f: 1, bf: 1 });
    if (this.ble && this.ble._sendMessageNative) {
      this.ble._sendMessageNative(deviceId, payload, null).catch(function(){});
    }
  }
  _handleNack(msg) {
    var msgId = msg.m;
    var indices = [];
    if (msg.r) {
      indices = _decompressRanges(msg.r);
    } else {
      indices = msg.k || [];
    }
    var stream = this.outgoingStreams.get(msgId);
    if (stream && msg.bf) this.markBin(stream.deviceId);
    if (stream) stream.handleNack(indices);
  }
  _handleBlockAck(msg) {
    var msgId = msg.m || msg.msgId;
    var total = msg.n || 0;
    var isFinal = msg.f === 1;
    var stream = this.outgoingStreams.get(msgId);
    if (!stream) return;
    if (msg.bf) this.markBin(stream.deviceId);
    stream.lastAckAt = Date.now();
    if (isFinal) {
      console.log('[BleAckSystem] handleFinalAck msgId=' + msgId);
      stream.handleFinalAck();
      return;
    }
    var ackedIndices = [];
    if (msg.r) {
      ackedIndices = _decompressRanges(msg.r);
    } else if (typeof msg.b === 'string' && msg.b.length > 0) {
      for (var i = 0; i < Math.min(msg.b.length, stream.total); i++) {
        if (msg.b.charAt(i) === '1') ackedIndices.push(i);
      }
    } else if (typeof msg.b === 'number') {
      var bitmap = msg.b;
      for (var i = 0; i < stream.total; i++) {
        if (bitmap & (1 << i)) ackedIndices.push(i);
      }
    }
    for (var i = 0; i < ackedIndices.length; i++) {
      var idx = ackedIndices[i];
      if (idx >= 0 && idx < stream.total) stream.ackedMask[idx] = true;
    }
    var oldWindowStart = stream.windowStart;
    while (stream.windowStart < stream.total && stream.ackedMask[stream.windowStart]) {
      stream.windowStart++;
    }
    if (stream.windowStart !== oldWindowStart) {
      console.log('[BleAckSystem] windowStart avanzo: ' + oldWindowStart + ' -> ' + stream.windowStart);
      // v3.3.2: progreso de envío (cada 5 %) para la burbuja propia
      var pctOut = Math.floor(stream.windowStart * 100 / stream.total);
      if (stream.type === 'file' && !stream.meta.fwd && pctOut < 100 && (typeof stream._lastPct !== 'number' || pctOut - stream._lastPct >= 5)) {
        stream._lastPct = pctOut;
        this._dispatchFileProgress(msgId, stream.windowStart, stream.total, 'sending', pctOut);
      }
    }
    if (stream.windowStart < stream.total) {
      var windowEnd = Math.min(stream.windowStart + stream.windowSize, stream.total);
      var missingInWindow = [];
      for (var i = stream.windowStart; i < windowEnd; i++) {
        if (!stream.ackedMask[i]) missingInWindow.push(i);
      }
      // v3.3.0: lo no confirmado de la ventana suele seguir en vuelo; los huecos reales llegan por
      // NACK y las pérdidas por timeout de ventana. Antes se reenviaba aquí: retransmisiones espurias.
    }
    var sentAllAcked = stream._windowResolve && stream._windowEndAtSend > stream._windowStartAtSend;
    for (var w = stream._windowStartAtSend; sentAllAcked && w < stream._windowEndAtSend; w++) {
      if (!stream.ackedMask[w]) sentAllAcked = false;
    }
    if (sentAllAcked && stream.windowStart < stream.total) {
      // v3.3.0: ventana confirmada => seguir ya (antes esperaba al timeout de 3-8 s por ventana)
      if (stream.timer) { clearTimeout(stream.timer); stream.timer = null; }
      var res = stream._windowResolve;
      stream._windowResolve = null;
      stream._windowReject = null;
      res();
    }
    if (stream.windowStart >= stream.total) {
      console.log('[BleAckSystem] Mensaje completo, finalizando msgId=' + msgId);
      if (stream.timer) clearTimeout(stream.timer);
      stream._finish();
    }
  }
  _handleLegacyChunkAck(msg) {
    var msgId = msg.m;
    var isFinal = msg.f === 1;
    var stream = this.outgoingStreams.get(msgId);
    if (!stream) return;
    if (isFinal) {
      stream.handleFinalAck();
      return;
    }
    var mask = msg.r || '';
    for (var i = 0; i < Math.min(mask.length, stream.total); i++) {
      if (mask.charAt(i) === '1') stream.ackedMask[i] = true;
    }
    while (stream.windowStart < stream.total && stream.ackedMask[stream.windowStart]) {
      stream.windowStart++;
    }
    if (stream.timer) clearTimeout(stream.timer);
    if (stream.windowStart >= stream.total) {
      stream._finish();
    } else if (stream._windowResolve) {
      stream._windowResolve();
      stream._windowResolve = null;
      stream._windowReject = null;
    }
  }
  _handleSessionSync(deviceId, msg) {
    var self = this;
    var peerLastSeq = msg.l || 0;
    var peerNexoId = msg.fr || msg.from;
    var myLastSeq = 0;
    if (window.vaultLoadMessages && peerNexoId) {
      window.vaultLoadMessages(peerNexoId).then(function(msgs) {
        if (msgs && msgs.length > 0) {
          myLastSeq = _maxSeqFromPeer(msgs);
        }
        var resp = JSON.stringify({ v: PROTOCOL_VERSION, t: 'sr', fr: (self.ble && self.ble.localNexoId) || 'unknown', l: myLastSeq });
        if (self.ble && self.ble._sendMessageNative) {
          self.ble._sendMessageNative(deviceId, resp, null).catch(function(){});
        }
      }).catch(function(){});
    }
  }
  _handleSessionSyncResponse(deviceId, msg) {
    var self = this;
    var peerLastSeq = msg.l || 0;
    var peerNexoId = msg.fr || msg.from;
    if (!peerNexoId || !window.vaultLoadMessages) return;
    window.vaultLoadMessages(peerNexoId).then(function(msgs) {
      if (!msgs) return;
      // v3.3.1: peerLastSeq es el mayor seq NUESTRO que el otro tiene (antes mezclaba los contadores de
      // ambos teléfonos y dejaba sin reenviar). Se reenvía lo propio sin confirmar: pendiente/fallido
      // siempre; 'sent' (sin ack) si su seq es mayor que lo que el otro tiene. Máx. 7 días y 50 mensajes.
      var cutoff = Date.now() - 7 * 86400000;
      var pending = msgs.filter(function(m) {
        if (m._own !== true || m.attachmentType || (m.timestamp || 0) < cutoff) return false;
        var mid = m.msgId || m.messageId;
        if (self.ble && typeof self.ble._isMsgInFlight === 'function' && self.ble._isMsgInFlight(mid)) return false;
        if (m.status === 'pending' || m.status === 'sending' || m.status === 'queued' || m.status === 'failed') return true;
        return m.status === 'sent' && (m.seq || 0) > peerLastSeq;
      }).slice(-50);
      if (pending.length === 0) return;
      console.log('[BleAckSystem] Sync: reenviando', pending.length, 'mensajes faltantes a', peerNexoId);
      var idx = 0;
      function sendNext() {
        if (idx >= pending.length) return;
        var m = pending[idx++];
        var txt = m.content || m.text || '';
        if (txt.length <= 150) {
          self.sendWithRetry(deviceId, txt, m.msgId, m.seq).then(sendNext).catch(sendNext);
        } else {
          self.sendChunkedMessage(deviceId, txt, {}, m.msgId, m.seq).then(sendNext).catch(sendNext);
        }
      }
      sendNext();
    }).catch(function(){});
  }
  sendSessionSync(deviceId, peerNexoId) {
    var self = this;
    var myLastSeq = 0;
    if (window.vaultLoadMessages) {
      window.vaultLoadMessages(peerNexoId).then(function(msgs) {
        myLastSeq = _maxSeqFromPeer(msgs);
        var payload = JSON.stringify({ v: PROTOCOL_VERSION, t: 'ss', fr: (self.ble && self.ble.localNexoId) || 'unknown', l: myLastSeq });
        if (self.ble && self.ble._sendMessageNative) {
          self.ble._sendMessageNative(deviceId, payload, null).catch(function(){});
        }
      }).catch(function(){});
    }
  }
  // ===== v3.4.0: E2E =====
  _contactOf(deviceId, dst) {
    var nx = _normId(dst || this._resolveNexoId(deviceId));
    var cs = (this.ble && typeof this.ble.getBLEContacts === 'function') ? this.ble.getBLEContacts() : [];
    for (var i = 0; i < cs.length; i++) if (_normId(cs[i].nexoId || cs[i].deviceUUID) === nx) return cs[i];
    return null;
  }
  // Clave para cifrar a este contacto (null si no hay, o si cambió y el usuario aún no la aceptó)
  _peerKey(deviceId, dst) {
    var c = this._contactOf(deviceId, dst);
    return (c && c.publicKey && !c.pendingKey) ? c.publicKey : null;
  }
  // Con qué cifrar para este contacto: { nx, key, proto } o null. Con protocolo 2 hace falta su paquete de
  // claves (o una sesión); nunca se vuelve al 1 con quien ya tiene el 2.
  _target(deviceId, dst) {
    var c = this._contactOf(deviceId, dst);
    if (!c || !c.publicKey || c.pendingKey) return null;
    var nx = _normId(c.nexoId || c.deviceUUID);
    if (c.proto === 2) return ratchetCanEncrypt(nx, c.publicKey) ? { nx: nx, key: c.publicKey, proto: 2 } : null;
    return { nx: nx, key: c.publicKey, proto: 1 };
  }
  _outAd(t, id) { return e2eOuterAd(this.ble && this.ble.localNexoId, t.nx, id); }
  _inAd(from, id) { return e2eOuterAd(from, this.ble && this.ble.localNexoId, id); }
  // Destino para cifrar; si falta su clave (o su paquete del protocolo 2) se pide (kx) y se espera hasta 5 s
  _ensurePeerKey(deviceId, dst) {
    var self = this;
    var k = self._target(deviceId, dst);
    if (k) return Promise.resolve(k);
    var c = self._contactOf(deviceId, dst);
    if (c && c.pendingKey) {
      // Clave cambiada sin aceptar: no se cifra para la nueva (podría ser un impostor) ni para la vieja
      var ek = new Error('La clave del contacto cambió: acéptala en el chat para enviar');
      ek.code = 'NO_KEY';
      return Promise.reject(ek);
    }
    // Destino por otro teléfono: la clave se pide de extremo a extremo (kx dirigido), no al puente
    if (dst && self.ble && typeof self.ble._sendKxRouted === 'function') self.ble._sendKxRouted(dst, true);
    else if (self.ble && typeof self.ble._sendKx === 'function') self.ble._sendKx(deviceId, true);
    return new Promise(function(resolve, reject) {
      var t0 = Date.now();
      (function poll() {
        var key = self._target(deviceId, dst);
        if (key) return resolve(key);
        if (Date.now() - t0 > 5000) {
          var e = new Error('Sin clave de cifrado del contacto');
          e.code = 'NO_KEY';
          console.warn('[E2E] Sin clave pública de ' + (dst || self._resolveNexoId(deviceId)) + ': el mensaje queda pendiente');
          return reject(e);
        }
        setTimeout(poll, 250);
      })();
    });
  }
  // Mientras se espera la clave y se cifra, el id cuenta como en vuelo (si no, un reenvío simultáneo lo
  // mandaba otra vez)
  _preparingFor(id, promise) {
    var self = this;
    if (!id) return promise;
    self.preparing.add(id);
    var done = function() { self.preparing.delete(id); };
    promise.then(done, done);
    return promise;
  }
  // 'ok' | 'hold' (clave distinta de la del contacto: retener hasta que el usuario decida) | 'drop'
  // (protocolo 1 de quien ya usa el 2)
  _checkSender(nexoId, r) {
    if (this.ble && typeof this.ble._checkSender === 'function') return this.ble._checkSender(nexoId, r.senderKey, r.proto);
    return 'ok';
  }
  _hold(nexoId, release, id) {
    if (this.ble && typeof this.ble._quarantine === 'function') this.ble._quarantine(nexoId, release, id);
  }
  // opts.dst: destino final (Jump) si deviceId es un puente
  sendWithRetry(deviceId, content, messageId, seq, opts) {
    var self = this;
    var dst = opts && opts.dst;
    if (content && content.length > 150 && !e2eAnyEncrypted(content)) {
      return self.sendChunkedMessage(deviceId, content, dst ? { dst: dst } : {}, messageId, seq);
    }
    if (!e2eAvailable() || e2eAnyEncrypted(content)) return self._sendWithRetryRaw(deviceId, content, messageId, seq, dst);
    var mid = messageId || _newMsgId();
    var t0 = Date.now();
    return self._preparingFor(mid, self._ensurePeerKey(deviceId, dst)
      .then(function(t) { return e2eSealText(t, content, self._outAd(t, mid)); }))
      .then(function(enc) { return self._sendWithRetryRaw(deviceId, enc, mid, seq, dst, { t0: t0, seal: Date.now() - t0 }); });
  }
  // Jump: un puente reenvía un paquete tal cual y espera la confirmación del siguiente salto
  sendRawWithRetry(deviceId, packet, msgId) {
    var self = this;
    return new Promise(function(resolve, reject) {
      var entry = { msgId: msgId, deviceId: deviceId, content: packet, raw: true, quiet: true,
        resolve: resolve, reject: reject, retries: 0, timer: null, sentAt: Date.now() };
      var prev = self.pendingAcks.get(msgId);
      if (prev) { clearTimeout(prev.timer); prev.reject(new Error('reemplazado')); }
      self.pendingAcks.set(msgId, entry);
      self._doSend(entry);
    });
  }
  // 'rk': el puente guardó el mensaje (✓ enviado; ✓✓ cuando confirme el destino)
  handleCustody(msgId) {
    var entry = msgId && this.pendingAcks.get(msgId);
    if (!entry) return;
    clearTimeout(entry.timer);
    this.pendingAcks.delete(msgId);
    entry.resolve();
    if (!entry.quiet) this._dispatchStatus(msgId, 'sent');
  }
  // Un ack de extremo a extremo que pasa por este puente confirma también su salto
  resolveHopQuiet(msgId) {
    var entry = msgId && this.pendingAcks.get(msgId);
    if (!entry || !entry.quiet) return;
    clearTimeout(entry.timer);
    this.pendingAcks.delete(msgId);
    entry.resolve();
  }
  // timing: { t0, seal } para el diagnóstico (cuánto tarda cada texto y en qué)
  _sendWithRetryRaw(deviceId, content, messageId, seq, dst, timing) {
    var self = this;
    return new Promise(function(resolve, reject) {
      var msgId = messageId || ('msg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6));
      var entry = {
        msgId: msgId, deviceId: deviceId, content: content, dst: dst || null,
        resolve: resolve, reject: reject, retries: 0, timer: null, sentAt: Date.now(),
        t0: (timing && timing.t0) || Date.now(), seal: (timing && timing.seal) || 0, outMs: 0
      };
      self.pendingAcks.set(msgId, entry);
      self._dispatchStatus(msgId, 'sending');
      self._doSend(entry);
    });
  }
  _doSend(entry) {
    var self = this;
    if (!entry.quiet) self._dispatchStatus(entry.msgId, 'sending');
    if (!self.ble || typeof self.ble._sendMessageNative !== 'function') {
      entry.reject(new Error('BLE no disponible'));
      self.pendingAcks.delete(entry.msgId);
      return;
    }
    var delay = SHORT_MSG_BACKOFF_DELAYS[Math.min(entry.retries, SHORT_MSG_BACKOFF_DELAYS.length - 1)];
    var sendP = entry.raw ? self.ble._sendRawNative(entry.deviceId, entry.content)
      : self.ble._sendMessageNative(entry.deviceId, entry.content, entry.msgId, undefined, entry.dst);
    var tOut = Date.now();
    sendP
      .then(function() {
        if (!entry.outMs) entry.outMs = Date.now() - tOut;
        entry.timer = setTimeout(function() { self._onAckTimeout(entry.msgId); }, delay);
      })
      .catch(function(err) {
        if (entry.retries < self.maxRetries) {
          entry.retries++;
          console.warn('[BleAckSystem] Envio nativo fallo msgId=' + entry.msgId + ', reintento ' + entry.retries + '/' + self.maxRetries);
          setTimeout(function() { self._doSend(entry); }, delay);
        } else {
          self.pendingAcks.delete(entry.msgId);
          entry.reject(err);
          if (!entry.quiet) self._dispatchStatus(entry.msgId, 'failed');
        }
      });
  }
  _onAckTimeout(msgId) {
    var entry = this.pendingAcks.get(msgId);
    if (!entry) return;
    if (entry.retries < this.maxRetries) {
      entry.retries++;
      console.log('[BleAckSystem] ACK timeout msgId=' + msgId + ' reintento ' + entry.retries + '/' + this.maxRetries);
      this._doSend(entry);
    } else {
      this.pendingAcks.delete(msgId);
      entry.reject(new Error('ACK timeout'));
      if (!entry.quiet) this._dispatchStatus(msgId, 'failed');
    }
  }
  processIncomingAck(content) {
    try {
      var ack = JSON.parse(content);
      var ackMsgId = ack.msgId || ack.messageId || ack.id || null;
      if (!ackMsgId) return false;
      if (ack.type !== 'ack' && ack.type !== 'read_receipt') return false;
      // FIX v3.2.13: dedup por tipo+id; antes el 'ack' de un mensaje hacía descartar su 'read_receipt'
      var ackKey = ack.type + ':' + ackMsgId;
      var entry = this.pendingAcks.get(ackMsgId);
      // v3.4.0: un ack repetido también resuelve un reenvío que lo espera (antes se descartaba y el
      // mensaje, ya entregado, acababa en rojo tras 5 reintentos)
      if (this.receivedAcks.has(ackKey) && !entry) return true;
      this.receivedAcks.add(ackKey);
      if (this.receivedAcks.size > this.maxReceivedAcks) {
        var first = this.receivedAcks.values().next().value;
        this.receivedAcks.delete(first);
      }
      var status = ack.type === 'read_receipt' ? 'read' : 'delivered';
      if (entry) {
        clearTimeout(entry.timer);
        this.pendingAcks.delete(ackMsgId);
        entry.resolve();
        if (!entry.quiet) this._dispatchStatus(ackMsgId, status);
        if (!entry.quiet && !entry.raw && entry.t0) {
          console.log('[SEND] Texto entregado en ' + (Date.now() - entry.t0) + ' ms (cifrar ' + entry.seal + ' ms, salir por Bluetooth ' +
            entry.outMs + ' ms, reintentos ' + entry.retries + ')');
        }
      } else {
        this._dispatchStatus(ackMsgId, status);
      }
      return true;
    } catch (e) { return false; }
  }
  // routeTo: origen de un mensaje que llegó por otro teléfono (Jump): el ack vuelve dirigido a él
  sendAck(deviceId, msgId, routeTo) {
    var obj = { v: 1, type: 'ack', msgId: msgId, from: (this.ble && this.ble.localNexoId) || 'unknown', ts: Date.now() };
    if (routeTo) { obj.to = String(routeTo).toLowerCase(); this._sendRouted(obj, deviceId); return; }
    if (this.ble && this.ble._sendMessageNative) this.ble._sendMessageNative(deviceId, JSON.stringify(obj), null).catch(function(){});
  }
  sendReadReceipt(deviceId, msgId, routeTo) {
    var obj = { v: 1, type: 'read_receipt', msgId: msgId, from: (this.ble && this.ble.localNexoId) || 'unknown', ts: Date.now() };
    if (routeTo) { obj.to = String(routeTo).toLowerCase(); this._sendRouted(obj, deviceId); return; }
    if (this.ble && this.ble._sendMessageNative) this.ble._sendMessageNative(deviceId, JSON.stringify(obj), null).catch(function(){});
  }
  _sendRouted(obj, fallbackDeviceId) {
    var relay = this.ble && this.ble.relay;
    // v3.11.0: en sobre sellado para el destino si lo entiende (el puente no ve de quién es la confirmación)
    if (relay && this.ble && typeof this.ble._sealObj === 'function') {
      this.ble._sealObj(obj.to, obj).then(function(o) { relay.sendRouted(o); }).catch(function() { relay.sendRouted(obj); });
      return;
    }
    if (relay) { relay.sendRouted(obj); return; }
    if (fallbackDeviceId && this.ble && this.ble._sendMessageNative) this.ble._sendMessageNative(fallbackDeviceId, JSON.stringify(obj), null).catch(function(){});
  }
  // Jump: un puente reenvía un flujo completo (texto largo o archivo) tal cual hacia el siguiente salto
  forwardStream(deviceId, msgId, data, meta, kind) {
    var self = this;
    var running = self.outgoingStreams.get(msgId);
    if (running && !running.aborted && running._promise) return running._promise;
    var fm = Object.assign({}, meta, { fwd: true });
    if (typeof fm.seq !== 'number') fm.seq = 0;
    var stream = new ChatStream(self, deviceId, msgId, data, fm, kind === 'chat' ? 'chat' : 'file');
    self.outgoingStreams.set(msgId, stream);
    stream._promise = stream.start();
    return stream._promise.then(function() { self.outgoingStreams.delete(msgId); },
      function(err) { self.outgoingStreams.delete(msgId); throw err; });
  }
  _processBlockAck(msg) {
    var transferId = msg.transferId;
    var tx = this.pendingOutgoingTransfers.get(transferId);
    if (!tx) return;
    var mask = msg.receivedMask || '';
    for (var i = 0; i < Math.min(mask.length, tx.total); i++) { tx.ackMask[i] = mask.charAt(i) === '1'; }
    if (tx.ackMask.every(function(v){return v;})) { this._completeLegacyTransfer(transferId); }
  }
  _completeLegacyTransfer(transferId) {
    var tx = this.pendingOutgoingTransfers.get(transferId);
    if (!tx) return;
    this.pendingOutgoingTransfers.delete(transferId);
    if (!tx.legacy) { tx.resolve(); this._dispatchStatus(transferId, 'delivered'); }
  }
  cancelFileSend(fileId) {
    var tx = this.outgoingStreams.get(fileId) || this.pendingOutgoingTransfers.get(fileId);
    if (tx && tx.contactNexoId && window.vaultSetOutgoingStatus) window.vaultSetOutgoingStatus(tx.contactNexoId, fileId, 'cancelled').catch(function(){});
    this.outgoingStreams.delete(fileId);
    this.pendingOutgoingTransfers.delete(fileId);
    this.pendingOutgoingFiles.delete(fileId);
    this._dispatchFileProgress(fileId, 0, 0, 'cancelled');
  }
  resumeOutgoingTransfers() {
    var self = this;
    if (!window.vaultGetPendingOutgoingTransfers) return;
    var contacts = (self.ble && typeof self.ble.getBLEContacts === 'function') ? self.ble.getBLEContacts() : [];
    contacts.forEach(function(contact) {
      var cid = _normId(contact.nexoId);
      if (!cid) return;
      window.vaultGetPendingOutgoingTransfers(cid).then(function(list) {
        if (!list || list.length === 0) return;
        return self._dropDeliveredTransfers(cid, list);
      }).then(function(list) {
        if (!list || list.length === 0) return;
        console.log('[BleAckSystem] Resume:', list.length, 'outgoing para', cid);
        list.forEach(function(tx) {
          if (tx.status !== 'sending' && tx.status !== 'pending') return;
          var content = tx.chunks.map(function(c) { return (typeof c === 'string') ? c : (c.data || c.d || ''); }).join('');
          // v3.10.0: por el mejor camino de ahora (Wi-Fi, Bluetooth); el guardado puede ser un Wi-Fi que ya no está
          var best = (self.ble && typeof self.ble._resolveDeviceIdForNexoId === 'function') ? self.ble._resolveDeviceIdForNexoId(cid) : null;
          var devId = best || tx.deviceId || contact.deviceId;
          if (_isLanDevice(devId) && !(self.ble && self.ble.lan && self.ble.lan.canReach(cid))) devId = contact.deviceId;
          // Por internet: solo en línea, y archivos solo con los dos en Wi-Fi
          var net = self.ble && self.ble.net;
          if (_isNetDevice(devId) && !(net && (tx.type === 'file' ? net.filesOk(cid) : net.canReach(cid)))) devId = contact.deviceId;
          if (!devId) return;
          // FIX: respetar tx.type. Antes SIEMPRE se llamaba a sendChunkedMessage (tipo 'chat'),
          // así que una foto/video interrumpido se reenviaba como texto (t:'c') y el receptor
          // lo entregaba como mensaje de texto plano en vez de adjunto.
          var isFileTx = tx.type === 'file';
          var resumePromise = isFileTx
            ? self.sendFile(devId, tx.transferId, content, tx.meta || {})
            : self.sendChunkedMessage(devId, content, tx.meta, tx.transferId, (tx.meta && tx.meta.seq));
          resumePromise
            .then(function() {
              if (window.vaultRemoveOutgoingTransfer) window.vaultRemoveOutgoingTransfer(cid, tx.transferId).catch(function(){});
            })
            .catch(function(){});
        });
      }).catch(function(){});
    });
  }
  // v3.4.0: hasta la 2701 el registro de una transferencia terminada no se borraba y al abrir la app o
  // reconectar se volvían a enviar textos largos, fotos y vídeos ya entregados (hasta 50). Los que ya
  // constan como entregados en el historial (o HD enviado) se borran aquí sin reenviarlos.
  _dropDeliveredTransfers(cid, list) {
    if (!window.vaultLoadMessages) return Promise.resolve(list);
    return window.vaultLoadMessages(cid).catch(function() { return []; }).then(function(msgs) {
      var byId = {};
      (msgs || []).forEach(function(m) { var id = m.msgId || m.messageId || m.id; if (id) byId[id] = m; });
      return list.filter(function(tx) {
        var isHd = /_hd$/.test(tx.transferId);
        var m = byId[isHd ? tx.transferId.replace(/_hd$/, '') : tx.transferId];
        var done = !!m && (isHd ? m.hdStatus === 'sent' : (m.status === 'delivered' || m.status === 'read'));
        if (done && window.vaultRemoveOutgoingTransfer) window.vaultRemoveOutgoingTransfer(cid, tx.transferId).catch(function(){});
        return !done;
      });
    });
  }
  _dispatchChunkedMessageComplete(senderId, content, meta, deviceId, msgId) {
    var self = this;
    if (e2eAnyEncrypted(content)) {
      var from = meta.fr || senderId;
      e2eOpenText(from, content, self._inAd(from, msgId)).then(function(r) {
        if (r.dup) return;
        var go = function() { self._dispatchChunkedMessageComplete(senderId, r.text, meta, deviceId, msgId); };
        var v = self._checkSender(from, r);
        if (v === 'drop') return;
        if (v === 'hold') { self._hold(from, go, msgId); return; }
        go();
      }).catch(function(e) { if (!e || e.code !== 'DUP') console.warn('[E2E] No se pudo descifrar el mensaje ' + msgId + ':', e && e.message); });
      return;
    }
    try {
      window.dispatchEvent(new CustomEvent('nexo:ble:messageReceived', {
        detail: {
          deviceId: meta.hp > 0 ? null : deviceId, deviceUUID: meta.fr || senderId,
          content: content, senderName: meta.f || 'NEXO',
          senderNexoId: meta.fr || senderId, messageId: msgId || meta.msgId,
          source: 'ble', timestamp: meta.ts || Date.now(), seq: meta.seq || 0
          // FIX v3.2.13: sin fromVault; con fromVault main.js no lo guardaba y se perdía si el chat estaba cerrado
        }
      }));
    } catch (e) {}
  }
  _dispatchStatus(msgId, status) {
    try { window.dispatchEvent(new CustomEvent('nexo:ble:ackStatus', { detail: { msgId: msgId, status: status } })); } catch (e) {}
  }
  _dispatchFileProgress(fileId, sent, total, status, percent, extra) {
    try { window.dispatchEvent(new CustomEvent('nexo:ble:fileProgress', { detail: Object.assign({ fileId: fileId, sent: sent, total: total, status: status, percent: percent || 0, direction: 'out' }, extra || {}) })); } catch (e) {}
  }
  // v3.3.2: progreso de recepción (cada 5 %) para mostrar "Recibiendo foto… N%" mientras llega
  _reportIncomingProgress(msgId, buf, status) {
    if (buf.isChat || buf.meta.type === 'fenix') return;
    if (String(buf.meta.fr || '').indexOf('sx:') === 0) { this._unsealFrom(buf); return; } // aún sellado: se abre
    var me = _normId(this.ble && this.ble.localNexoId);
    if (buf.meta.dst && _normId(buf.meta.dst) !== me) return; // de paso (Jump): no es para este teléfono
    var pct = status === 'failed' ? 0 : Math.floor(buf.received * 100 / buf.total);
    if (status !== 'failed' && (pct >= 100 || (typeof buf.lastPct === 'number' && pct - buf.lastPct < 5))) return;
    buf.lastPct = pct;
    this._dispatchFileProgress(msgId, buf.received, buf.total, status || 'receiving', pct, {
      direction: 'in', senderNexoId: buf.meta.fr, fileType: buf.meta.type, mime: buf.meta.mime,
      name: e2eAnyEncrypted(buf.meta.name) ? undefined : buf.meta.name, hdFor: buf.meta.hdFor
    });
  }
  _dispatchFileComplete(fileId, data, meta) {
    var self = this;
    if (e2eAnyEncrypted(data)) {
      var dm = Object.assign({}, meta || {});
      var from = dm.fr || dm.senderNexoId || dm.fromNexoId;
      Promise.all([
        e2eOpenToB64(from, data, self._inAd(from, fileId)),
        e2eAnyEncrypted(dm.thumb) ? e2eOpenToB64(from, dm.thumb, self._inAd(from, fileId + '#t')).then(function(t) { return t.b64; }, function() { return null; }) : dm.thumb,
        e2eAnyEncrypted(dm.name) ? e2eOpenText(from, dm.name, self._inAd(from, fileId + '#n')).then(function(t) { return t.text; }, function() { return null; }) : dm.name
      ]).then(function(r) {
        if (r[0].dup) return;
        dm.thumb = r[1] || null;
        dm.name = r[2] || undefined;
        var go = function() { self._dispatchFileComplete(fileId, r[0].b64, dm); };
        var v = self._checkSender(from, r[0]);
        if (v === 'drop') return;
        if (v === 'hold') { self._hold(from, go, fileId); return; }
        go();
      }).catch(function(e) { if (!e || e.code !== 'DUP') console.warn('[E2E] No se pudo descifrar el archivo ' + fileId + ':', e && e.message); });
      return;
    }
    try {
      var m = meta || {};
      var sender = m.senderNexoId || m.fromNexoId || m.fr || null;
      // Fénix: fragmentos y respuestas de recuperación (no son mensajes del chat)
      if (m.type === 'fenix') { if (self.ble && self.ble.fenix) self.ble.fenix.onFile(fileId, data, m, sender); return; }
      window.dispatchEvent(new CustomEvent('nexo:ble:fileComplete', {
        detail: {
          fileId: fileId,
          data: data,
          meta: m,
          senderNexoId: sender
        }
      }));
    } catch (e) {}
  }
  _startCleanupInterval() {
    var self = this;
    setInterval(function() {
      var now = Date.now();
      self.incomingBuffers.forEach(function(buf, msgId) {
        if (now - buf.lastActivity > self.maxFragmentAge) {
          if (buf.assemblyTimer) clearTimeout(buf.assemblyTimer);
          self.incomingBuffers.delete(msgId);
        }
      });
      self.outgoingStreams.forEach(function(stream, msgId) {
        if (now - stream.startTime > self.maxFragmentAge * 2) { stream.abort(); self.outgoingStreams.delete(msgId); }
      });
      self.pendingAcks.forEach(function(entry, msgId) {
        if (now - entry.sentAt > self.maxFragmentAge) { clearTimeout(entry.timer); self.pendingAcks.delete(msgId); try { entry.reject(new Error('Timeout global')); } catch(e) {} }
      });
      self.completedMessages.forEach(function(data, msgId) {
        if (now > data.expireAt) self.completedMessages.delete(msgId);
      });
    }, 30000);
  }
}
function ChatStream(ackSystem, deviceId, msgId, content, meta, type) {
  this.ackSystem = ackSystem;
  this.ble = ackSystem.ble;
  this.deviceId = deviceId;
  this.msgId = msgId;
  this.content = content;
  this.meta = meta;
  var isFile = type === 'file';
  this.chunkSize = isFile ? FILE_CHUNK_SIZE : CHAT_CHUNK_SIZE;
  this.windowSize = isFile ? FILE_WINDOW_SIZE : CHAT_WINDOW_SIZE;
  this.windowTimeoutMs = isFile ? FILE_WINDOW_TIMEOUT_MS : CHAT_WINDOW_TIMEOUT_MS;
  // v3.3.0: ajustar al MTU negociado. El nativo escribe trozos de (MTU-13) caracteres, uno cada
  // 40-80 ms; con MTU pequeño un paquete grande ocupa muchas escrituras y la ventana debe ser menor
  // y esperar más (si no, timeouts espurios y la cola nativa de 500 se llena y descarta).
  var mtu = (this.ble && typeof this.ble.getMtu === 'function') ? this.ble.getMtu(deviceId) : 0;
  // v3.10.0: por Wi-Fi (misma red) trozos grandes: no hay MTU ni escrituras de 20-500 bytes
  if (_isLanDevice(deviceId) || _isNetDevice(deviceId)) mtu = LAN_PSEUDO_MTU;
  // v3.14.0 (ronda 2757): el nativo escribe (MTU - 3) bytes reales por escritura (máx. 512), no MTU - 13 caracteres
  var perWrite = mtu ? Math.min(Math.max(mtu - 3, 20), 512) : 0;
  var overhead = 90; // cabecera JSON de un trozo ('v','t','m','i','n','d')
  if (_isLanDevice(deviceId)) { this.chunkSize = isFile ? LAN_FILE_CHUNK : LAN_CHAT_CHUNK; perWrite = this.chunkSize + overhead; }
  if (_isNetDevice(deviceId)) { this.chunkSize = isFile ? NET_FILE_CHUNK : NET_CHAT_CHUNK; perWrite = this.chunkSize + overhead; }
  // Trozos grandes aunque ocupen 2-3 escrituras (menos paquetes y acks); solo se reducen si un
  // paquete necesitaría más de 3 escrituras (MTU pequeño). Medido: MTU 247 => 18 s/foto con 360
  // frente a 27 s ajustando a una sola escritura.
  if (!perWrite) this.chunkSize = Math.min(this.chunkSize, 200);
  else if (Math.ceil((this.chunkSize + overhead) / perWrite) > 3) this.chunkSize = Math.max(SMALL_MTU_MIN_CHUNK(), 3 * perWrite - overhead);
  this.writesPerPacket = perWrite ? Math.ceil((this.chunkSize + overhead) / perWrite) : 2;
  if (this.writesPerPacket > 2) this.windowSize = Math.min(this.windowSize, 4);
  this.windowTimeoutMs = Math.max(this.windowTimeoutMs, this.windowSize * this.writesPerPacket * 100 + 3000);
  // v3.13.0: en binario caben 4/3 más caracteres de base64 en las mismas escrituras (múltiplo de 4)
  this.bin = isFile && perWrite > 0 && !(meta && meta.dst) && ackSystem.peerBin(deviceId) && !!(this.ble && typeof this.ble._sendBinaryNative === 'function');
  if (this.bin) this.chunkSize = Math.max(60, Math.floor((this.writesPerPacket * perWrite - overhead - 7) * 4 / 3 / 4) * 4);
  if (this.bin) console.log('[BIN] ' + msgId + ' en binario: MTU ' + mtu + ', trozos de ' + this.chunkSize + ' caracteres');
  this.pacingDelayMs = isFile ? FILE_PACING_DELAY_MS : CHAT_PACING_DELAY_MS;
  this.baseTimeoutMs = isFile ? GLOBAL_TIMEOUT_MS : 45000;
  this.type = type || 'chat';
  this.chunks = [];
  this.total = 0;
  this.sentMask = [];
  this.ackedMask = [];
  this.windowStart = 0;
  this.resolve = null;
  this.reject = null;
  this.timer = null;
  this.startTime = Date.now();
  this.aborted = false;
  this.windowRetryCount = 0;
  this.maxWindowRetries = MAX_WINDOW_RETRIES;
  this.globalTimeout = null;
  this.globalTimeoutMs = this.baseTimeoutMs;
  this._windowResolve = null;
  this._windowReject = null;
  this._windowStartAtSend = 0;
  this._windowEndAtSend = 0;
  if (isFile) {
    console.log('[ChatStream] MODO ARCHIVO. chunk=' + this.chunkSize + ' window=' + this.windowSize + ' pacing=' + this.pacingDelayMs + 'ms');
  }
}
// v3.10.0: el enlace cambió a mitad (Wi-Fi caído → Bluetooth): los trozos ya están hechos (el receptor espera esos),
// así que se adapta el ritmo: ventana pequeña y esperas largas (un trozo de Wi-Fi son muchas escrituras Bluetooth)
ChatStream.prototype.useLink = function(deviceId) {
  this.deviceId = deviceId;
  if (_isLanDevice(deviceId) || _isNetDevice(deviceId)) return;
  var mtu = (this.ble && typeof this.ble.getMtu === 'function') ? this.ble.getMtu(deviceId) : 0;
  var perWrite = mtu ? Math.min(Math.max(mtu - 3, 20), 512) : 20;
  this.writesPerPacket = Math.ceil((this.chunkSize + 90) / perWrite);
  if (this.writesPerPacket > 3) {
    this.windowSize = Math.max(1, Math.min(this.windowSize, Math.floor(300 / this.writesPerPacket) || 1)); // cola nativa: 500
    this.windowTimeoutMs = Math.max(this.windowTimeoutMs, this.windowSize * this.writesPerPacket * 60 + 5000);
  }
  console.log('[ChatStream] ' + this.msgId + ' sigue por Bluetooth: ventana ' + this.windowSize + ', espera ' + this.windowTimeoutMs + ' ms');
};
ChatStream.prototype.start = function() {
  var self = this;
  return new Promise(function(resolve, reject) {
    self.resolve = resolve;
    self.reject = reject;
    self.lastAckAt = Date.now();
    self._splitChunks();
    if (self.total === 0) { reject(new Error('Vacio')); return; }
    var estimatedWindows = Math.ceil(self.total / self.windowSize);
    var timeoutPerWindow = self.windowTimeoutMs * (MAX_WINDOW_RETRIES + 2);
    var baseTo = (self.type === 'file') ? FILE_GLOBAL_TIMEOUT_MS : self.baseTimeoutMs;
    self.globalTimeoutMs = Math.max(baseTo, estimatedWindows * timeoutPerWindow);
    // Cap razonable: 15 min max; archivos grandes (vídeo HD) hasta 60 min a un mínimo de ~1,5 KB/s
    var cap = (self.type === 'file') ? Math.min(3600000, Math.max(900000, Math.round(self.content.length / 1.5))) : 900000;
    if (self.globalTimeoutMs > cap) self.globalTimeoutMs = cap;
    console.log('[ChatStream] START msgId=' + self.msgId + ' type=' + self.type + ' totalChunks=' + self.total + ' totalWindows=' + estimatedWindows + ' timeout=' + self.globalTimeoutMs + 'ms');
    if (window.vaultCreateOutgoingTransfer && !self.meta.fwd) {
      var cid = self.meta.dst || self.ackSystem._resolveNexoId(self.deviceId);
      window.vaultCreateOutgoingTransfer(cid, self.msgId, self.type, self.total, self.chunks, self.meta, self.deviceId).catch(function(){});
    }
    self.globalTimeout = setTimeout(function() {
      if (!self.aborted) {
        console.error('[ChatStream] GLOBAL TIMEOUT msgId=' + self.msgId);
        self.abort();
        reject(new Error('Timeout global ' + (self.type === 'file' ? '3min+' : '45s+')));
        self.ackSystem._dispatchStatus(self.msgId, 'failed');
      }
    }, self.globalTimeoutMs);
    self._runWindowLoop();
  });
};
ChatStream.prototype._runWindowLoop = function() {
  var self = this;
  function next() {
    if (self.aborted) {
      console.log('[ChatStream] _runWindowLoop abortado msgId=' + self.msgId);
      return;
    }
    if (self.windowStart >= self.total) {
      console.log('[ChatStream] _runWindowLoop: windowStart >= total, finalizando msgId=' + self.msgId);
      self._finish();
      return;
    }
    console.log('[ChatStream] _runWindowLoop: enviando ventana. windowStart=' + self.windowStart + ' msgId=' + self.msgId);
    self._sendWindow().then(function() {
      console.log('[ChatStream] _sendWindow RESUELTA. windowStart ahora=' + self.windowStart + ' msgId=' + self.msgId);
      self.windowRetryCount = 0;
      setTimeout(next, self.pacingDelayMs);
    }).catch(function(err) {
      console.warn('[ChatStream] _sendWindow RECHAZADA. retry=' + self.windowRetryCount + ' msgId=' + self.msgId);
      self.windowRetryCount++;
      if (self.windowRetryCount > self.maxWindowRetries) {
        self.abort();
        self.ackSystem._dispatchStatus(self.msgId, 'failed');
        if (self.reject) self.reject(new Error('Max window retries'));
        return;
      }
      console.log('[ChatStream] Ventana fallo, reintentando. retry=' + self.windowRetryCount);
      setTimeout(next, 500 * self.windowRetryCount);
    });
  }
  next();
};
ChatStream.prototype._splitChunks = function() {
  var str = this.content;
  var size = this.chunkSize;
  var arr = [];
  var i = 0;
  // Chunk 0 lleva meta (fr, type, format…): limitar datos para no reventar MTU
  var firstChunkMax = (this.type === 'file') ? Math.min(size, 120) : Math.min(size, 200);
  // v3.13.0: en binario, un trozo termina justo donde empiezan los datos en base64 y los siguientes van alineados
  var body = this.bin ? _b64BodyStart(str) : -1;
  while (i < str.length) {
    var remaining = str.length - i;
    var chunkSize = (arr.length === 0) ? Math.min(firstChunkMax, remaining) : Math.min(size, remaining);
    var end = i + chunkSize;
    if (body > i && body < end) end = body;
    if (end < str.length &&
        str.charCodeAt(end - 1) >= 0xD800 && str.charCodeAt(end - 1) <= 0xDBFF &&
        str.charCodeAt(end) >= 0xDC00 && str.charCodeAt(end) <= 0xDFFF) {
      end--;
    }
    arr.push(str.substring(i, end));
    i = end;
  }
  this.chunks = arr;
  this.total = arr.length;
  this.sentMask = new Array(this.total).fill(false);
  this.ackedMask = new Array(this.total).fill(false);
  console.log('[ChatStream] _splitChunks: ' + this.total + ' chunks. chunk0=' + (this.chunks[0] ? this.chunks[0].length : 0) + ' chars, chunkN=' + (this.chunks[1] ? this.chunks[1].length : 0) + ' chars');
};
ChatStream.prototype._sendWindow = function() {
  var self = this;
  return new Promise(function(resolve, reject) {
    self._windowResolve = resolve;
    self._windowReject = reject;
    self._windowStartAtSend = self.windowStart;
    self._windowEndAtSend = Math.min(self.windowStart + self.windowSize, self.total);
    var end = self._windowEndAtSend;
    var myStart = self._windowStartAtSend;
    function sendNext(idx) {
      // v3.3.0: si la ventana ya se cerró por ack (y empezó otra), este envío termina aquí
      if (self._windowStartAtSend !== myStart) return;
      if (idx >= end || self.aborted) {
        var allAcked = true;
        for (var i = self._windowStartAtSend; i < self._windowEndAtSend; i++) {
          if (!self.ackedMask[i]) { allAcked = false; break; }
        }
        if (allAcked) {
          if (self.timer) clearTimeout(self.timer);
          console.log('[ChatStream] _sendWindow RESOLVIENDO (ventana completa) msgId=' + self.msgId);
          resolve();
        } else {
          console.log('[ChatStream] _sendWindow iniciando timer (esperando ACKs) msgId=' + self.msgId);
          self._startWindowTimer();
        }
        return;
      }
      if (self.ackedMask[idx]) {
        console.log('[ChatStream] Chunk ' + idx + ' ya acked, saltando msgId=' + self.msgId);
        setTimeout(function() { sendNext(idx + 1); }, self.pacingDelayMs);
        return;
      }
      self.sentMask[idx] = true;
      self._sendChunk(idx)
        .then(function() {
          self._nativeFails = 0;
          setTimeout(function() { sendNext(idx + 1); }, self.pacingDelayMs);
        })
        .catch(function(err) {
          if (self.aborted) return;
          var fails = self._nativeFails = (self._nativeFails || 0) + 1;
          if (fails === 1 || fails % 20 === 0) console.warn('[ChatStream] Envio nativo fallo chunk', idx, err.message, '(' + fails + ')');
          // v3.10.0: el enlace ya no sirve (p. ej. Wi-Fi caído): seguir por el mejor camino de ahora. Antes se
          // reintentaba para siempre cada 200 ms por el mismo enlace.
          var bi = self.ble, nx = self.ackSystem._resolveNexoId(self.deviceId);
          var best = (fails >= 3 && bi && typeof bi._resolveDeviceIdForNexoId === 'function') ? bi._resolveDeviceIdForNexoId(nx) : null;
          if (best && _normMac(best) !== _normMac(self.deviceId)) self.useLink(best);
          if (fails > 120) {
            // ~2 min sin poder enviar: queda pendiente y se reanuda al volver a haber camino
            var e = new Error('Contacto no disponible: queda pendiente'); e.code = 'PEER_ABSENT';
            var rej = self.reject; self.reject = null;
            self.abort();
            self.ackSystem.outgoingStreams.delete(self.msgId);
            if (rej) rej(e);
            return;
          }
          setTimeout(function() { sendNext(idx); }, fails > 10 ? 1000 : 200);
        });
    }
    sendNext(self.windowStart);
  });
};
// v3.13.0: binario si se puede (no el trozo 0, que lleva los datos del archivo y la miniatura); si no, JSON
ChatStream.prototype._sendChunk = function(idx) {
  var d = this.chunks[idx];
  if (this.bin && idx > 0 && this.ackSystem.peerBin(this.deviceId) && _binOk(d)) {
    var head = JSON.parse(this._buildChunk(idx));
    delete head.d;
    var self = this;
    return this.ble._sendBinaryNative(this.deviceId, JSON.stringify(head), d).catch(function(e) {
      if (!e || e.code !== 'UNIMPLEMENTED') throw e;
      self.bin = false; // nativo sin trozos binarios: el resto como siempre
      return self.ble._sendMessageNative(self.deviceId, self._buildChunk(idx), self.msgId + '_' + idx);
    });
  }
  return this.ble._sendMessageNative(this.deviceId, this._buildChunk(idx), this.msgId + '_' + idx);
};
ChatStream.prototype._buildChunk = function(idx) {
  var isFirst = idx === 0;
  var obj = {
    v: PROTOCOL_VERSION,
    t: this.type === 'chat' ? 'c' : 'f',
    m: this.msgId,
    i: idx,
    n: this.total,
    d: this.chunks[idx]
  };
  if (isFirst) {
    obj.f = (this.meta.f || 'NEXO').substring(0, 12);
    obj.fr = this.meta.fr || 'unknown';
    obj.ts = this.meta.ts || Date.now();
    if (typeof this.meta.seq === 'number') obj.seq = this.meta.seq;
    if (this.meta.type) obj.tp = this.meta.type;
    if (this.meta.name) obj.fn = this.meta.name;
    if (this.meta.mime) obj.mt = this.meta.mime;
    if (this.meta.size) obj.fs = this.meta.size;
    if (this.meta.format) obj.ft = this.meta.format;
    // FIX: width/height se perdían (nunca se empaquetaban), quedaban null en el receptor
    if (this.meta.width) obj.w = this.meta.width;
    if (this.meta.height) obj.h = this.meta.height;
    if (this.meta.hdFor) obj.hf = this.meta.hdFor;
    if (this.meta.preview) obj.pv = 1;
    if (this.meta.thumb) obj.th = this.meta.thumb; // miniatura JPEG del vídeo (poster) o 1.ª página del PDF
    if (this.meta.pages) obj.pg = this.meta.pages;
    if (this.meta.dst) obj.dt = this.meta.dst;
    if (this.meta.hp) obj.hp = this.meta.hp;
  }
  obj.k = _chunkCheck(obj);
  return JSON.stringify(obj);
};
ChatStream.prototype._startWindowTimer = function() {
  var self = this;
  if (self.timer) clearTimeout(self.timer);
  console.log('[ChatStream] Timer iniciado (' + self.windowTimeoutMs + 'ms) msgId=' + self.msgId);
  self.timer = setTimeout(function() {
    self._onWindowTimeout();
  }, self.windowTimeoutMs);
};
ChatStream.prototype._onWindowTimeout = function() {
  var self = this;
  if (self.aborted) return;
  var allAcked = true;
  for (var i = self._windowStartAtSend; i < self._windowEndAtSend; i++) {
    if (!self.ackedMask[i]) { allAcked = false; break; }
  }
  console.log('[ChatStream] _onWindowTimeout. ventanaOriginal=[' + self._windowStartAtSend + ',' + self._windowEndAtSend + ') allAcked=' + allAcked + ' windowStartActual=' + self.windowStart + ' msgId=' + self.msgId);
  if (allAcked) {
    console.log('[ChatStream] Ventana original completa por ACKs tardios. Resolviendo. msgId=' + self.msgId);
    self.windowRetryCount = 0;
    if (self._windowResolve) {
      self._windowResolve();
      self._windowResolve = null;
      self._windowReject = null;
    }
  } else {
    self.windowRetryCount++;
    if (self.windowRetryCount > self.maxWindowRetries) {
      console.warn('[ChatStream] Max window retries alcanzado para', self.msgId);
      self.abort();
      if (self._windowReject) {
        self._windowReject(new Error('Max window retries'));
        self._windowReject = null;
        self._windowResolve = null;
      }
      self.ackSystem._dispatchStatus(self.msgId, 'failed');
      return;
    }
    console.log('[ChatStream] Window timeout, reenviando ventana desde', self.windowStart, 'retry', self.windowRetryCount, 'msgId=' + self.msgId);
    self._retransmitWindow();
  }
};
ChatStream.prototype._retransmitWindow = function() {
  var self = this;
  var end = Math.min(self.windowStart + self.windowSize, self.total);
  console.log('[ChatStream] _retransmitWindow: [' + self.windowStart + ',' + end + ') msgId=' + self.msgId);
  function sendNext(idx) {
    if (idx >= end || self.aborted) {
      self._startWindowTimer();
      return;
    }
    if (self.ackedMask[idx]) {
      setTimeout(function() { sendNext(idx + 1); }, self.pacingDelayMs);
      return;
    }
    self._sendChunk(idx)
      .then(function() {
        setTimeout(function() { sendNext(idx + 1); }, self.pacingDelayMs);
      })
      .catch(function(err) {
        setTimeout(function() { sendNext(idx); }, 200);
      });
  }
  sendNext(self.windowStart);
};
ChatStream.prototype.handleNack = function(indices) {
  var self = this;
  console.log('[ChatStream] handleNack: ' + indices.join(',') + ' msgId=' + self.msgId);
  if (self.timer) clearTimeout(self.timer);
  var promises = [];
  indices.forEach(function(idx) {
    if (idx >= 0 && idx < self.total) {
      self.sentMask[idx] = true;
      promises.push(self._sendChunk(idx));
    }
  });
  Promise.all(promises).then(function() {
    self._startWindowTimer();
  }).catch(function() {
    setTimeout(function() { self._retransmitWindow(); }, 500);
  });
};
ChatStream.prototype.handleFinalAck = function() {
  console.log('[ChatStream] handleFinalAck msgId=' + this.msgId);
  if (this.timer) clearTimeout(this.timer);
  this._finish();
};
ChatStream.prototype._finish = function() {
  if (this.aborted) return;
  console.log('[ChatStream] _finish msgId=' + this.msgId);
  this.aborted = true;
  if (this.timer) clearTimeout(this.timer);
  if (this.globalTimeout) clearTimeout(this.globalTimeout);
  // Velocidad real por salto (la usa el selector de camino de Jump)
  var relay = this.ackSystem.ble && this.ackSystem.ble.relay;
  if (relay && this.type === 'file') relay.noteSpeed(this.content.length, Date.now() - this.startTime);
  // Jump: el ack final de un puente es custodia (✓); el ✓✓ llega con el ack del destino
  if (!this.meta.fwd) this.ackSystem._dispatchStatus(this.msgId, this.meta.dst ? 'sent' : 'delivered');
  // v3.4.0: entregado → fuera del registro de salientes (si no, se reenviaba al abrir la app o reconectar)
  if (window.vaultRemoveOutgoingTransfer && !this.meta.fwd) {
    window.vaultRemoveOutgoingTransfer(this.meta.dst || this.ackSystem._resolveNexoId(this.deviceId), this.msgId).catch(function(){});
  }
  // NO disparar fileComplete en el emisor: el receptor lo emite al ensamblar.
  // Antes se enviaba data=null y podía interferir con listeners.
  if (this.type === 'file' && !this.meta.fwd) {
    this.ackSystem._dispatchFileProgress(this.msgId, this.total, this.total, this.meta.dst ? 'sent' : 'delivered', 100);
  }
  if (this.resolve) {
    this.resolve();
    this.resolve = null;
    this.reject = null;
  }
};
ChatStream.prototype.abort = function() {
  console.log('[ChatStream] abort msgId=' + this.msgId);
  this.aborted = true;
  if (this.timer) clearTimeout(this.timer);
  if (this.globalTimeout) clearTimeout(this.globalTimeout);
  if (this._windowResolve) {
    this._windowResolve();
    this._windowResolve = null;
    this._windowReject = null;
  }
  if (this.reject) this.reject(new Error('Abortado'));
};
export function createAckSystem(bleInterface) {
return new BleAckSystem(bleInterface);
}
