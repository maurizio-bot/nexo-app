import { SHORT_MSG_TIMEOUT_MS, SHORT_MSG_MAX_RETRIES, CHAT_CHUNK_SIZE, CHAT_WINDOW_SIZE, CHAT_WINDOW_TIMEOUT_MS, _normMac, _normId, _isLanDevice, _isNetDevice, _isFenixTx, UPGRADE_COOLDOWN_MS, UPGRADE_MIN_LEFT, UPGRADE_MEASURE_MS, UPGRADE_NET_RATE, XFER_STUCK_MS, LONG_TEXT_TINY_BLE, TINY_MTU, _newMsgId, NET_TEXT_ONE, _nxOf, BLE_HD_MAX_CHARS, BLE_FILE_MAX_CHARS, NET_BIG_MIN_CHUNKS, SHORT_MSG_BACKOFF_DELAYS, _ackRe, _ctEq, _readTooEarly } from './ble_ack_shared.js';
import { NET_MAX_B64_BYTES } from './media_limits.js';
import { e2eAvailable, e2eAckTag } from '../vault/e2e_crypto.js';
import { e2eAnyEncrypted, e2eSealText, e2eSealB64, e2eOuterAd } from '../vault/e2e_proto.js';
import { ChatStream } from './chat_stream.js';
import { ratchetCanEncrypt } from '../vault/e2e_ratchet.js';
import { ackFiles } from './ble_ack_files.js';
import { ackIncoming } from './ble_ack_incoming.js';
import { ackResume } from './ble_ack_resume.js';
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
// 3178: acuses que no salieron (ver _rcptNote): por contacto como mucho, intentos de cada uno, vida, pausa entre vueltas por eventos
// de enlace, y espera tras una vuelta que no salió (sin evento de enlace)
var RCPT_MAX = 300, RCPT_TRIES = 8, RCPT_TTL_MS = 6 * 3600000, RCPT_GAP_MS = 4000;
var RCPT_WAIT_MS = [3000, 15000, 45000, 120000, 300000, 600000];
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
    // 3007: transferencias grandes por internet a medias guardadas en el teléfono (msgId → { a, total, meta, blocks })
    this._bigxIn = new Map();
    this._bigxLoadIndex(0);
    this.preparing = new Set(); // ids cifrándose (aún sin ack pendiente ni flujo): cuentan como en vuelo
    // #129 parte 2 (dueño 01-11): tope de transferencias de ARCHIVO simultáneas por enlace Bluetooth (MTU 23 se
    // inunda si arrancan muchas a la vez; los textos/acks/control quedaban atrás → mensajes en ○). Las que no caben
    // esperan en esta cola y arrancan al liberarse un hueco. net:/lan:/Wi-Fi Direct NO se limitan.
    this._fileStartQueue = new Map(); // fileId -> { deviceId, data, meta, at, waiters:[{resolve,reject}] }
    this._maxBleFilesPerLink = 1;
    this._chatPrep = new Map(); // id → envío de un texto en curso (cifrándose, en flujo o esperando ✓✓): no sale dos veces a la vez
    this._mtuDeferSince = new Map(); // #B2: msgId → cuándo se aplazó por 1ª vez (MTU mínimo + archivo grande); tras un rato se intenta igual
    // #CRASH 02-11: cola global para reanudar transferencias pendientes sin saturar (ver MAX_RESUME_CONCURRENT)
    this._resumeQueue = [];          // trabajos pendientes de reanudar { cid, tx, contactDeviceId }
    this._resumeActive = 0;          // transferencias reanudadas en vuelo ahora mismo
    this._resumeSeen = new Set();    // transferId ya en cola o en vuelo (no encolar dos veces)
    this._resumeFail = new Map();    // 3038: transferId → { n, at } reanudaciones seguidas que se rindieron
    this._resumeHint = new Set();    // 3038: contactos cuyo enlace acaba de servir (sus transferencias se reanudan sin esperar)
    this._done = new Map();     // id → cuándo se confirmó (entregado o leído): no se reenvía
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
  // Ronda 2760: ¿hay un archivo o texto largo yendo o viniendo con ese teléfono? (el vigilante de la conexión no la
  // corta mientras tanto; lo preguntaba desde siempre pero no existía y cortaba enlaces a mitad de una foto)
  // 3080 (dueño 14-11: «el Bluetooth es la emergencia… siempre el camino más rápido»; diagnóstico S23→Redmi 21:46: un vídeo HD de
  // 2,9 MB salió por Bluetooth a ~0,4 KB/s porque al empezar no había otro camino, y siguió así aunque un minuto después el Wi-Fi
  // de los dos quedó comprobado). Un archivo que va por Bluetooth con un contacto pasa al camino rápido en cuanto está listo:
  //  - Wi-Fi local: siempre (es el más rápido de todos); se rehace a su medida (segundos para megas).
  //  - internet: solo si el archivo cabe por internet (las mismas reglas que _sendFileBest) y el Bluetooth, medido en ESTE envío,
  //    va más lento que lo que da internet por los relés (UPGRADE_NET_RATE); si el Bluetooth va bien, cambiar lo haría más lento.
  // No se mueve lo que ya casi terminó (UPGRADE_MIN_LEFT), lo de Jump/puente, los respaldos Fénix, ni dos veces seguidas el mismo
  // envío en UPGRADE_COOLDOWN_MS (si el camino nuevo se cae, relink lo devuelve al Bluetooth y no se rebota sin parar).
  upgradeLinks(nexoId, why) {
    var self = this, nx = _normId(nexoId), ble = self.ble, now = Date.now(), moved = 0;
    if (!nx || !ble) return 0;
    var lanOk = !!(ble.lan && typeof ble.lan.canReach === 'function' && ble.lan.canReach(nx));
    var net = ble.net, netOk = !lanOk && !!(net && typeof net.canReach === 'function' && net.canReach(nx));
    if (!lanOk && !netOk) return 0;
    self._upgradedAt = self._upgradedAt || new Map();
    self.outgoingStreams.forEach(function(st, id) {
      if (!st || st.aborted || st.type !== 'file' || _isLanDevice(st.deviceId) || _isNetDevice(st.deviceId)) return;
      if (st.meta && (st.meta.dst || st.meta.fwd || _isFenixTx(st.meta))) return;
      if (_normId(st._dn || self._resolveNexoId(st.deviceId)) !== nx) return;
      if (now - (self._upgradedAt.get(id) || 0) < UPGRADE_COOLDOWN_MS) return;
      var len = String(st.content || '').length, done = Math.min(len, (st.windowStart || 0) * (st.chunkSize || 0)), left = len - done;
      if (left < UPGRADE_MIN_LEFT) return;
      var next, rateTxt = '';
      if (lanOk) next = 'lan:' + nx;
      else {
        var fits = (typeof net.filesOk === 'function' && net.filesOk(nx)) ||
          (typeof net.mailboxFilesOk === 'function' && net.mailboxFilesOk(nx, len) && len <= NET_MAX_B64_BYTES);
        if (!fits) return;
        var el = now - (st.startTime || now), rate = el > 0 ? done / (el / 1000) : 0;
        if (el < UPGRADE_MEASURE_MS || rate >= UPGRADE_NET_RATE) return;
        rateTxt = ', Bluetooth a ' + Math.round(rate / 1365 * 10) / 10 + ' KB/s';
        next = 'net:' + nx;
      }
      self._upgradedAt.set(id, now);
      if (self._upgradedAt.size > 200) self._upgradedAt.delete(self._upgradedAt.keys().next().value);
      console.log('[ChatStream] ' + id + ': ' + (lanOk ? 'Wi-Fi' : 'internet') + ' listo con ' + nx + ' (' + (why || 'repaso') + rateTxt +
        '): el archivo deja el Bluetooth y sigue por ' + (lanOk ? 'el Wi-Fi' : 'internet') + ' (' + Math.round(left / 1365) + ' KB por mandar)'); // i18n-ok: registro para el diagnóstico
      self._restartStream(st, id, next);
      moved++;
    });
    return moved + self._upgradeQueued(nx, lanOk, why); // 3180: y lo que esperaba en la cola del Bluetooth ocupado
  }
  // 3080: el repaso del vigilante (cada ~6 s) mira los archivos que van por Bluetooth (el camino rápido pudo quedar listo sin
  // aviso, o el Bluetooth se volvió lento a mitad)
  upgradeAll(why) {
    var self = this, seen = new Set();
    self.outgoingStreams.forEach(function(st) {
      if (!st || st.aborted || st.type !== 'file' || _isLanDevice(st.deviceId) || _isNetDevice(st.deviceId)) return;
      var nx = _normId(st._dn || self._resolveNexoId(st.deviceId));
      if (nx && /^nx[0-9a-z]{8}$/.test(nx)) seen.add(nx);
    });
    // 3180: también los contactos con algo en la cola del Bluetooth ocupado, y la cola se repasa por si quedó un hueco sin aviso
    self._fileStartQueue.forEach(function(it) { var nx = _normId(self._resolveNexoId(it.deviceId)); if (/^nx[0-9a-z]{8}$/.test(nx)) seen.add(nx); });
    var n = 0;
    seen.forEach(function(nx) { n += self.upgradeLinks(nx, why); });
    self._pumpFileQueue();
    return n;
  }
  hasActiveTransfer(deviceId) {
    var nx = this._resolveNexoId(deviceId), now = Date.now(), self = this, busy = false;
    var same = function(d) { return d && (_normMac(d) === _normMac(deviceId) || self._resolveNexoId(d) === nx); };
    // #dueño 09-11 (diagnóstico S24 12:15, tablet zombi por Bluetooth): un flujo saliente que lleva > XFER_STUCK_MS sin NINGÚN
    // ACK no «protege» el enlace. Antes el vigilante saltaba el ping/zombie PARA SIEMPRE («transferencia activa») mientras cada
    // pendiente se arrastraba 8 reintentos de ventana sobre un enlace muerto y, al abortar, arrancaba el siguiente sobre el
    // mismo. Atascado → se pinga; sin pong, zombi → se rehace el enlace y lo pendiente se reanuda por el nuevo (como siempre).
    // 3037 (dueño 13-11, S24 3030 con el Vivo …db61, 19:03–19:45): un texto largo pendiente se REANUDABA cada 10–30 s y cada flujo
    // nuevo trae su propia hora de inicio: contado solo desde ella, nunca pasaba de 20 s y el vigilante se saltó el ping/zombie
    // 40 min con un enlace que no confirmaba nada. Ahora también cuenta cuándo se oyó por última vez CUALQUIER cosa de ese teléfono
    // (_lastPongTime, cada paquete recibido): si lleva > XFER_STUCK_MS callado, un flujo sin ACK propio no protege el enlace.
    var heard = 0, ble = this.ble;
    try { if (ble && ble._lastPongTime) ble._lastPongTime.forEach(function(t, k) { if (t > heard && same(k)) heard = t; }); } catch (e) {}
    this.outgoingStreams.forEach(function(s) {
      if (busy || !s || s.aborted || !same(s.deviceId)) return;
      if (s.lastAckAt) { if (now - s.lastAckAt < XFER_STUCK_MS) busy = true; return; }
      if (now - (s.startTime || now) < XFER_STUCK_MS && (!heard || now - heard < XFER_STUCK_MS)) busy = true;
    });
    this.incomingBuffers.forEach(function(b) { if (!busy && b && now - (b.lastActivity || 0) < 30000 && same(b.deviceId)) busy = true; });
    return busy;
  }
  // 2975: ¿hay un archivo/texto largo yendo o viniendo por ESE enlace exacto (p. ej. "lan:nx…")? Lo usa el latido del Wi-Fi para
  // no tomar por mala señal la ida y vuelta inflada por la propia carga (una transferencia por Bluetooth con el mismo contacto
  // no carga el Wi-Fi: por eso aquí no se resuelve al contacto como en hasActiveTransfer).
  hasActiveTransferOn(deviceId) {
    var id = _normMac(deviceId), now = Date.now(), busy = false;
    this.outgoingStreams.forEach(function(s) { if (!busy && s && !s.aborted && _normMac(s.deviceId) === id && now - (s.lastAckAt || s.startTime || now) < XFER_STUCK_MS) busy = true; });
    this.incomingBuffers.forEach(function(b) { if (!busy && b && _normMac(b.deviceId) === id && now - (b.lastActivity || 0) < 30000) busy = true; });
    return busy;
  }
  // 2993 (diagnóstico automático del dueño, vivo 10-11 16:46: un mensaje de grupo al tablet, por el puente del S24, agotó sus 8 reintentos —31 s—
  // y quedó ✗ mientras una foto de 212 KB salía por ese mismo Bluetooth): ¿hay OTRO envío avanzando ahora (ACKs en los últimos 8 s)?
  // Mientras sí, un texto que espera no gasta reintentos (la radio está ocupada, no muerta).
  _otherProgressing(excludeMsgId) {
    var now = Date.now(), busy = false;
    this.outgoingStreams.forEach(function(st, id) {
      if (busy || id === excludeMsgId || !st || st.aborted) return;
      if (st.lastAckAt && now - st.lastAckAt < 8000) busy = true;
    });
    return busy;
  }
  // #dueño 05-11: ¿hay un envío INTERACTIVO (texto/foto/sticker, no un archivo grande) activo AHORA? Si sí, un archivo
  // grande le cede la radio para que lo chico salga ya. Los streams terminados ya no están en outgoingStreams.
  _interactiveActive(excludeMsgId) {
    var active = false;
    this.outgoingStreams.forEach(function(s, id) {
      if (active || id === excludeMsgId || !s || s.aborted || s._bulk) return;
      active = true;
    });
    return active;
  }
  // _fromPrep: llamada interna con el texto ya cifrado por este mismo envío
  // 3032 (diagnóstico vivo 3018 12-11 13:45 y regla del dueño 04-11 «internet antes que Bluetooth»): un texto LARGO a un
  // contacto cuyo Bluetooth está al MÍNIMO (MTU 23: ~20 bytes por escritura, cientos de trozos) y que está EN LÍNEA por internet
  // va por internet. Antes un diagnóstico de 57 KB salió por un Bluetooth MTU 23 en 288 trozos con el otro en línea por datos.
  // Solo con el MTU conocido y mínimo; un puente Jump (dst/fwd) no se toca.
  _avoidTinyBleText(deviceId, content, meta) {
    if (!deviceId || !content || content.length < LONG_TEXT_TINY_BLE || _isNetDevice(deviceId) || _isLanDevice(deviceId) || (meta && (meta.dst || meta.fwd))) return deviceId;
    var ble = this.ble, net = ble && ble.net;
    if (!net || typeof net.canReach !== 'function' || typeof ble.getMtu !== 'function') return deviceId;
    var mtu = ble.getMtu(deviceId);
    if (!mtu || mtu > TINY_MTU) return deviceId;
    var cid = _normId((meta && meta.to) || (ble._macToNexoId && ble._macToNexoId.get(_normMac(deviceId))) || '');
    if (!cid || !net.canReach(cid)) return deviceId;
    console.log('[ChatStream] Texto largo (' + Math.round(content.length / 1024) + ' KB) con el Bluetooth al mínimo (MTU ' + mtu + ') y ' + cid + ' en línea por internet: va por internet');
    return 'net:' + cid;
  }
  sendChunkedMessage(deviceId, content, meta, messageId, seq, _fromPrep) {
    var self = this;
    deviceId = self._avoidTinyBleText(deviceId, content, meta);
    var dst = meta && meta.dst, to = meta && meta.to;
    // Ronda 2767 (revisión): el mismo texto largo no sale dos veces a la vez. Al reconectar arrancaban varios reenvíos
    // de lo pendiente y cada uno lo cifraba otra vez (distinto): el otro mezclaba los trozos de los dos, no lo podía
    // descifrar y se perdía, mientras aquí constaba como entregado
    if (messageId) {
      var running = self.outgoingStreams.get(messageId);
      if (running && !running.aborted && running._promise) return running._promise;
      if (!_fromPrep && self._chatPrep.has(messageId)) return self._chatPrep.get(messageId);
    }
    if (e2eAvailable() && content && !e2eAnyEncrypted(content)) {
      if (content.length <= 150) return self.sendWithRetry(deviceId, content, messageId, seq, { dst: dst, to: to });
      var cid = messageId || _newMsgId();
      var p = self._preparingFor(cid, self._ensurePeerKey(deviceId, dst, to)
        .then(function(t) { return e2eSealText(t, content, self._outAd(t, cid)); }))
        .then(function(enc) { return self.sendChunkedMessage(deviceId, enc, meta, cid, seq, true); });
      self._chatPrep.set(cid, p);
      var clear = function() { if (self._chatPrep.get(cid) === p) self._chatPrep.delete(cid); };
      p.then(clear, clear);
      return p;
    }
    // v3.12.0: por internet un texto va en un solo paquete: sirve de buzón (el otro puede no estar en línea; un flujo
    // por trozos esperaría confirmaciones que no llegan)
    if (_isNetDevice(deviceId) && !dst && content.length <= NET_TEXT_ONE && (!e2eAvailable() || e2eAnyEncrypted(content))) {
      return self._sendWithRetryRaw(deviceId, content, messageId || _newMsgId(), seq);
    }
    if (dst && content.length > 150 && !(meta && 'sealedFrom' in meta)) {
      return self._withSealedFrom(Object.assign({}, meta)).then(function(m2) { return self.sendChunkedMessage(deviceId, content, m2, messageId, seq, _fromPrep); });
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
        self.sendWithRetry(deviceId, content, msgId, seq, { dst: dst, to: to }).then(resolve).catch(reject);
        return;
      }
      var stream = new ChatStream(self, deviceId, msgId, content, finalMeta, 'chat');
      self.outgoingStreams.set(msgId, stream);
      stream._promise = stream.start();
      stream._promise.then(function() {
        if (self.outgoingStreams.get(msgId) === stream) self.outgoingStreams.delete(msgId);
        resolve();
      }).catch(function(err) {
        if (self.outgoingStreams.get(msgId) === stream) self.outgoingStreams.delete(msgId);
        reject(err);
      });
    });
  }
  sendFile(deviceId, fileId, base64Data, meta) {
    var self = this;
    var running = self.outgoingStreams.get(fileId);
    if (running && !running.aborted && running._promise) return running._promise;
    // 3007: hay un envío GRANDE guardado a medias para este archivo y el camino para archivos grandes es internet → se sigue con
    // lo guardado (mismo contenido cifrado, misma marca 'a'): el receptor reconoce lo que ya tiene y el envío salta hasta ahí.
    if (!(meta && (meta._noBigx || meta.fwd)) && typeof window !== 'undefined' && typeof window.vaultBigxOutHas === 'function' && window.vaultBigxOutHas(fileId)) {
      var cidR = (meta && (meta.dst || meta.to)) ? _nxOf(meta.dst || meta.to) : self._resolveNexoId(deviceId);
      var bestR = (cidR && self.ble && typeof self.ble._resolveDeviceIdForNexoId === 'function') ? self.ble._resolveDeviceIdForNexoId(cidR, true) : null;
      var netR = _isNetDevice(deviceId) ? deviceId : ((bestR && _isNetDevice(bestR)) ? bestR : null);
      if (netR) {
        return self._preparingFor(fileId, window.vaultBigxOutGet(fileId).then(function(x) {
          if (!x) {
            if (base64Data) return self.sendFile(deviceId, fileId, base64Data, Object.assign({}, meta || {}, { _noBigx: true }));
            throw Object.assign(new Error('Contacto no disponible: queda pendiente'), { code: 'PEER_ABSENT' });
          }
          console.log('[BleAckSystem] ' + fileId + ': sigo el archivo grande donde iba (guardado en el teléfono; sin volver a leerlo ni cifrarlo)');
          var m2 = Object.assign({}, x.rec.meta || {}, { _att: x.rec.att, _bigxResumed: true });
          if (meta && meta.to && !m2.dst) m2.to = meta.to;
          return self._sendFileBest(netR, fileId, x.content, m2);
        }));
      }
      // Sin internet para archivos grandes ahora (p. ej. Wi-Fi local): sale como siempre, con el adjunto
      if (!base64Data) return Promise.reject(Object.assign(new Error('Contacto no disponible: queda pendiente'), { code: 'PEER_ABSENT' }));
    }
    // 3007: null = «seguir con lo guardado» y ya no hay nada guardado → queda ⏳ y la siguiente vuelta carga el adjunto
    if (base64Data === null) return Promise.reject(Object.assign(new Error('Contacto no disponible: queda pendiente'), { code: 'PEER_ABSENT' }));
    if (e2eAvailable() && base64Data && !e2eAnyEncrypted(base64Data)) {
      // También el nombre y la miniatura del vídeo, que van en la cabecera
      var m = meta || {};
      return self._preparingFor(fileId, self._ensurePeerKey(deviceId, m.dst, m.to).then(function(t) {
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
  relink(oldId, next, opts) {
    var self = this, nd = _normMac(oldId);
    self.pendingAcks.forEach(function(e) { if (next && _normMac(e.deviceId) === nd) e.deviceId = next; });
    self.outgoingStreams.forEach(function(st, id) {
      if (!st || _normMac(st.deviceId) !== nd) return;
      if (opts && opts.textsOnly && st.type === 'file') return; // 3022: el archivo espera el margen del Wi-Fi
      var limit = (st.meta && st.meta.hdFor) ? BLE_HD_MAX_CHARS : BLE_FILE_MAX_CHARS;
      var tooBig = st.type === 'file' && ((st.meta && st.meta.wdOnly) || String(st.content || '').length > limit);
      // 2975 (diagnóstico del dueño 13:35): Wi-Fi DEGRADADO (no caído) con un archivo grande en vuelo: el enlace sigue arriba y
      // el archivo no cabe por el camino nuevo → se queda donde está (antes se abortaba a ⏳ y el siguiente intento empezaba de cero)
      if (tooBig && opts && opts.keepTooBig) return;
      // 3006 (diagnóstico S24 11-11 07:48: el APK de 25 MB a un contacto se abortó en el instante en que éste salió «ya no está
      // en línea por internet» → ⏳ y el siguiente intento, de cero): un archivo GRANDE por internet sin otro camino NO se aborta
      // al caerse el contacto; el envío queda vivo esperando (rama «enlace caído» de _onWindowTimeout: sin reenviar, con el toque
      // de despertador) hasta NET_BIG_IDLE_MS sin confirmaciones, y al volver el contacto sigue donde iba (el receptor guarda lo
      // recibido ese mismo rato).
      if (!next && st.type === 'file' && _isNetDevice(st.deviceId) && st.total >= NET_BIG_MIN_CHUNKS) {
        console.log('[ChatStream] ' + id + ': el contacto salió de internet; el archivo grande espera a que vuelva (sigue donde iba)');
        try { self._dispatchStatus(id, 'pending'); } catch (e2) {}
        return;
      }
      if (next && !tooBig) {
        if (st.tooBigFor(next)) self._restartStream(st, id, next); else st.useLink(next);
        return;
      }
      // #dueño 02-11: al caerse el Wi-Fi, solo el VÍDEO ORIGINAL (wdOnly) va por su camino aparte (previa + HD → WD_FAILED).
      // Un archivo/foto grande NO se marca ✗: queda PENDIENTE (PEER_ABSENT, ⏳) y resumeOutgoingTransfers lo reenvía
      // cuando vuelva Wi-Fi/internet (el registro sigue en el vault). Antes todo lo «tooBig» caía a 'failed' y parecía perdido.
      var videoWd = tooBig && st.meta && st.meta.wdOnly;
      var e = new Error(videoWd ? 'Wi-Fi caído y no cabe por Bluetooth' : 'Contacto no disponible: queda pendiente');
      e.code = videoWd ? 'WD_FAILED' : 'PEER_ABSENT';
      var rej = st.reject; st.reject = null;
      st.abort();
      self.outgoingStreams.delete(id);
      if (st.type === 'file') self._dispatchFileProgress(id, 0, 1, videoWd ? 'failed' : 'sending', 0);
      if (rej) rej(e);
    });
  }
  // Ronda 2767 (revisión): el envío sigue por otro enlace en el que sus trozos no caben (trozos de Wi-Fi de 24 KB por
  // un Bluetooth de MTU 23: cada uno tarda más de lo que el nativo del otro espera a completarlo y lo descarta; la foto
  // no terminaba nunca). Se vuelve a empezar por el enlace nuevo, el mismo contenido en trozos a su medida (el otro
  // ve otro intento y empieza de nuevo); quien lo mandó sigue esperando la misma promesa
  _restartStream(st, id, next) {
    var self = this, res = st.resolve, rej = st.reject;
    st.resolve = null; st.reject = null;
    st.abort();
    if (self.outgoingStreams.get(id) === st) self.outgoingStreams.delete(id);
    console.log('[ChatStream] ' + id + ': sus trozos no caben por el enlace nuevo: se vuelve a empezar con trozos a su medida');
    var ns = new ChatStream(self, next, id, st.content, st.meta, st.type);
    ns._restart = true; // 3080: su primer trozo lleva rs:1 → el receptor suelta YA lo del intento anterior (no espera 4 s)
    self.outgoingStreams.set(id, ns);
    ns._promise = ns.start();
    ns._promise.then(function() {
      if (self.outgoingStreams.get(id) === ns) self.outgoingStreams.delete(id);
      if (res) res();
    }, function(e) {
      if (self.outgoingStreams.get(id) === ns) self.outgoingStreams.delete(id);
      if (rej) rej(e);
    });
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
  // Destino para cifrar; si falta su clave (o su paquete del protocolo 2) se pide (kx) y se espera hasta 5 s.
  // to: el contacto al que va (directo). Ronda 2766 (revisión: el arreglo de la 2764 no bastaba): se cifra para él y
  // solo si la conexión es suya; si resulta ser de otro, ni se cifra ni se manda (queda pendiente). Antes se cifraba
  // para quien dijera la conexión: un archivo para el S24 salía cifrado para el Vivo y el Vivo lo leía.
  _ensurePeerKey(deviceId, dst, to) {
    to = _nxOf(to) || null; // solo un NEXO ID (no una dirección)
    var self = this, who = dst || to || null;
    if (to && !dst && self.ble && typeof self.ble._destNx === 'function') {
      var owner = self.ble._destNx(deviceId);
      if (owner && owner !== _normId(to)) {
        console.warn('[SEND] No se cifra para ' + _normId(to) + ' por la conexión de ' + owner + ': queda pendiente');
        var ew = new Error('La conexión es de otro contacto: queda pendiente'); ew.code = 'PEER_ABSENT';
        return Promise.reject(ew);
      }
    }
    var k = self._target(deviceId, who);
    if (k) return Promise.resolve(k);
    var c = self._contactOf(deviceId, who);
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
        var key = self._target(deviceId, who);
        if (key) return resolve(key);
        if (Date.now() - t0 > 5000) {
          var e = new Error('Sin clave de cifrado del contacto');
          e.code = 'NO_KEY';
          console.warn('[E2E] Sin clave pública de ' + (who || self._resolveNexoId(deviceId)) + ': el mensaje queda pendiente');
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
    var dst = opts && opts.dst, to = opts && opts.to;
    if (content && content.length > 150 && !e2eAnyEncrypted(content)) {
      return self.sendChunkedMessage(deviceId, content, dst ? { dst: dst } : (to ? { to: to } : {}), messageId, seq);
    }
    var mid = messageId || _newMsgId();
    // Ronda 2766: a quién va (el 'dn' del paquete), fijado desde ya para este id
    if (_nxOf(to) && !dst && self.ble) { self.ble._msgDest = self.ble._msgDest || new Map(); self.ble._msgDest.set(mid, _nxOf(to)); }
    if (!e2eAvailable() || e2eAnyEncrypted(content)) return self._sendWithRetryRaw(deviceId, content, mid, seq, dst);
    // Ronda 2767: si ya se está mandando (cifrándose o esperando su confirmación), se espera con ese envío
    if (self._chatPrep.has(mid)) return self._chatPrep.get(mid);
    var pend = self.pendingAcks.get(mid);
    if (pend && !pend.raw) return self._sendWithRetryRaw(deviceId, content, mid, seq, dst);
    var t0 = Date.now();
    var p = self._preparingFor(mid, self._ensurePeerKey(deviceId, dst, to)
      .then(function(t) { return e2eSealText(t, content, self._outAd(t, mid)); }))
      .then(function(enc) { return self._sendWithRetryRaw(deviceId, enc, mid, seq, dst, { t0: t0, seal: Date.now() - t0 }); });
    self._chatPrep.set(mid, p);
    var clear = function() { if (self._chatPrep.get(mid) === p) self._chatPrep.delete(mid); };
    p.then(clear, clear);
    return p;
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
      // Ronda 2767 (revisión): si ese mismo mensaje ya está esperando su confirmación, se espera con él. Antes se
      // pisaba su entrada sin parar su temporizador: los reintentos se gastaban el doble de rápido y quien lo mandó
      // primero se quedaba esperando para siempre (y con él el resto de su lista de pendientes)
      var prev = self.pendingAcks.get(msgId);
      if (prev && !prev.raw) {
        var r0 = prev.resolve, j0 = prev.reject;
        prev.resolve = function(v) { r0(v); resolve(v); };
        prev.reject = function(e) { j0(e); reject(e); };
        return;
      }
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
        // Medición de caminos (dueño 13-11, 3050): el Wi-Fi se cayó justo al mandar (el texto se resolvió por el Wi-Fi un
        // instante antes de que se supiera del corte, y el traspaso de lo «en vuelo» ya había pasado): se reintentaba 5 veces
        // por el Wi-Fi caído (~8 s) y después quedaba ⏳ otros ~12 s (20 s en total). Ahora va ya por el camino listo.
        if (err && err.code === 'LAN_DOWN' && _isLanDevice(entry.deviceId) && self.ble && typeof self.ble._resolveDeviceIdForNexoId === 'function') {
          var lnx = String(entry.deviceId).toLowerCase().replace(/^lan:?/, ''), nextDev = self.ble._resolveDeviceIdForNexoId(lnx);
          if (nextDev && !_isLanDevice(nextDev)) {
            console.log('[BleAckSystem] ' + entry.msgId + ': el Wi-Fi con ' + lnx + ' se cayó al mandar → sigue por ' + (_isNetDevice(nextDev) ? 'internet' : 'Bluetooth'));
            entry.deviceId = nextDev;
            self._doSend(entry);
            return;
          }
        }
        if (entry.retries < self.maxRetries) {
          entry.retries++;
          console.warn('[BleAckSystem] Envio nativo fallo msgId=' + entry.msgId + ', reintento ' + entry.retries + '/' + self.maxRetries);
          setTimeout(function() { self._doSend(entry); }, delay);
        } else {
          self.pendingAcks.delete(entry.msgId);
          entry.reject(err);
          // Ronda 2767: si es que se espera a un camino (Wi-Fi cortado, contacto ausente), pendiente y no "!"
          var waiting = err && (err.code === 'LAN_DOWN' || err.code === 'PEER_ABSENT' || err.code === 'NO_KEY');
          if (!entry.quiet) self._dispatchStatus(entry.msgId, waiting ? 'pending' : 'failed');
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
      // 3211: ya salió por el buzón de internet (red de seguridad): está en camino (✓), no fallido (✗); su confirmación llega por ahí
      var inBox = !!(this.ble && this.ble._netSafeOut && this.ble._netSafeOut.has(msgId));
      entry.reject(Object.assign(new Error(inBox ? 'En el buzón de internet' : 'ACK timeout'), inBox ? { code: 'IN_MAILBOX' } : {})); // i18n-ok: motivo interno
      if (!entry.quiet) this._dispatchStatus(msgId, inBox ? 'sent' : 'failed');
    }
  }
  processIncomingAck(content) {
    var self = this;
    var ack;
    try { ack = JSON.parse(content); } catch (e) { return false; }
    var ackMsgId = ack.msgId || ack.messageId || ack.id || null;
    if (!ackMsgId) return false;
    if (ack.type !== 'ack' && ack.type !== 'read_receipt') return false;
    // Auditoría C1 (ronda 2777): con un contacto moderno (protocolo 2) se exige que la confirmación venga firmada con
    // el secreto de la pareja; una confirmación sin firma válida (falsa) se ignora para no marcar "entregado"/"leído"
    // algo que quizá no llegó (si no, un tercero que supiera el msgId paraba los reintentos y el mensaje se perdía con
    // ✓✓). Con contactos de protocolo 1 o desconocidos se mantiene el comportamiento de antes (compatibilidad).
    var acker = _normId(ack.from);
    var c = this._contactOf(null, acker);
    if (c && c.proto === 2 && c.publicKey && !c.pendingKey && _ackRe.test(acker)) {
      // 3215 (Marcos 17-11 16:13:41): al ARRANCAR, lo que llegó con la app cerrada se procesaba antes de cargar el NEXO ID propio y la
      // firma se comprobaba contra «…|» → «sin firma válida» con confirmaciones buenas (y el mensaje se volvía a mandar). Se espera al ID.
      this._whenMyNx().then(function(me) {
        return e2eAckTag(c.publicKey, ack.type + '|' + ackMsgId + '|' + acker + '|' + _normId(me));
      }).then(function(exp) {
        if (ack.a && exp && _ctEq(String(ack.a), exp)) self._applyAck(ack, ackMsgId);
        else console.warn('[BleAckSystem] Confirmación sin firma válida de ' + acker + ' (' + ackMsgId + '): ignorada');
      }).catch(function() {});
      return true;
    }
    return this._applyAck(ack, ackMsgId);
  }
  // 3215: el NEXO ID propio; al arrancar se espera a que se cargue del almacén (unos ms) en vez de usar «» o «unknown»
  _whenMyNx() {
    var ble = this.ble;
    if (!ble || ble.localNexoId) return Promise.resolve(ble ? ble.localNexoId : null);
    var p = ble._nexoIdP;
    if (!p || typeof p.then !== 'function') return Promise.resolve(null);
    return p.then(function() { return ble.localNexoId; }, function() { return ble.localNexoId; });
  }
  // Aplica una confirmación ya aceptada (firmada, o de un contacto antiguo): dedup y marcar entregado/leído
  _applyAck(ack, ackMsgId) {
    try {
      // 3016: una confirmación del contacto quita la espera de reenvíos sin confirmar (ble_messages `_resendBackoff`)
      var bmap = this.ble && this.ble._resendBackoff, bnx = _normId(ack.from);
      // 3020: la confirmación de un mensaje oculto de PROTOCOLO (el pedido de diagnóstico emparejado) no prueba que lo
      // atascado ya pase: no quita la espera (si no, cada pedido daba una vuelta de reenvío de más; resendloop.js)
      var nbk = this.ble && this.ble._noBackoffAckIds, nbHit = !!(nbk && nbk.has(ackMsgId));
      if (nbHit) nbk.delete(ackMsgId);
      if (bmap && bnx && bmap.has(bnx) && !nbHit) { var bb = bmap.get(bnx), bble = this.ble; if (bb && bb.timer) clearTimeout(bb.timer); bmap.delete(bnx); setTimeout(function() { try { bble._resendPendingMessages(bnx); } catch (e) {} }, 300); }
      // FIX v3.2.13: dedup por tipo+id; antes el 'ack' de un mensaje hacía descartar su 'read_receipt'
      var ackKey = ack.type + (ack.got === 1 ? ':got' : '') + ':' + ackMsgId; // 3075: el «ya lo bajé» no se descarta por repetido
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
      // 3096: el ✓✓ de un texto que aún va en trozos (lo da el nativo del otro con su app dormida): sin reenvíos rápidos (ver PEER_SAFE_*)
      var osSafe = this.outgoingStreams && this.outgoingStreams.get(ackMsgId);
      if (osSafe && !osSafe.aborted && osSafe.type === 'chat' && !osSafe.peerSafeAt) {
        osSafe.peerSafeAt = Date.now();
        console.log('[ChatStream] ' + ackMsgId + ': el teléfono del otro ya lo tiene (✓✓) aunque su app no ha confirmado los trozos: no se reenvía mientras duerme');
      }
      // Fase B/C: el archivo ya está en el otro teléfono (en grupo, en ESE miembro) → se borran sus trozos de los relés.
      // 3075 (S23→S24 14-11 18:34: «Faltan 5 de 5 trozos»): NO con el ✓✓ a secas, que lo da el nativo en segundo plano al llegar el
      // aviso SIN haber bajado nada; solo con el «ya lo bajé» de su app (got) o con su «leído». Si no llega ninguno, caducan solos.
      if (this._blobOut && this._blobOut.size && ((status === 'delivered' && ack.got === 1) || status === 'read')) this._blobCleanup(ackMsgId, ack.from);
      // 3004 (investigación 11-11): un «leído» de un ARCHIVO propio que todavía no se entregó es el de su tarjeta de cita (mismo id;
      // los teléfonos con versiones anteriores lo siguen mandando): no lo da por leído ni por hecho. Antes lo marcaba ✓✓, dejaba de
      // reenviarse y, si la app se reiniciaba antes de entregarlo, se perdía en silencio.
      if (status === 'read' && !entry && !this._done.has(ackMsgId) && ack.from && typeof window.vaultLoadMessages === 'function') {
        var selfR = this;
        window.vaultLoadMessages(_normId(ack.from)).then(function(msgs) {
          var m = (msgs || []).find(function(x) { return (x.msgId || x.messageId || x.id) === ackMsgId; });
          if (m && m._own && (m.attachmentType || m.attachmentRef) && _readTooEarly(m.status)) {
            console.log('[BleAckSystem] «Leído» de ' + ackMsgId + ' ignorado: el archivo aún no se entregó (es el de su tarjeta de cita)');
            return;
          }
          selfR._dispatchStatus(ackMsgId, status);
        }).catch(function() { selfR._dispatchStatus(ackMsgId, status); });
        return true;
      }
      if (entry) {
        clearTimeout(entry.timer);
        this.pendingAcks.delete(ackMsgId);
        entry.resolve();
        if (!entry.quiet) this._dispatchStatus(ackMsgId, status);
        if (!entry.quiet && !entry.raw && entry.t0) {
          // 3096 (wifivuelve): el camino de verdad (antes decía «Bluetooth» siempre, también por Wi-Fi o internet: confundía el diagnóstico)
          var dvia = String(entry.deviceId || '').toLowerCase();
          dvia = /^lan:?nx/.test(dvia) ? 'Wi-Fi' : /^net:?nx/.test(dvia) ? 'internet' : /^wd:?nx/.test(dvia) ? 'Wi-Fi Direct' : 'Bluetooth';
          console.log('[SEND] Texto entregado en ' + (Date.now() - entry.t0) + ' ms (cifrar ' + entry.seal + ' ms, salir por ' + dvia + ' ' +
            entry.outMs + ' ms, reintentos ' + entry.retries + ')');
        }
      } else {
        this._dispatchStatus(ackMsgId, status);
      }
      return true;
    } catch (e) { return false; }
  }
  // routeTo: origen de un mensaje que llegó por otro teléfono (Jump): el ack vuelve dirigido a él
  // extra (3075): { got: 1 } = «ya BAJÉ el archivo del buzón» (lo manda la app al terminar; el ✓✓ del nativo en segundo plano no lo lleva)
  sendAck(deviceId, msgId, routeTo, extra) { return this._sendReceipt('ack', deviceId, msgId, routeTo, extra); }
  sendReadReceipt(deviceId, msgId, routeTo) { return this._sendReceipt('read_receipt', deviceId, msgId, routeTo); }
  // Auditoría C1 (ronda 2777): la confirmación se firma con el secreto de la pareja (si el contacto es proto 2 y hay
  // clave) para que el emisor pueda comprobar que es de verdad. `a` es un campo más: los contactos antiguos lo ignoran.
  // 3178: resuelve true si SALIÓ (ver _rcptNote); si no, queda apuntada y se reintenta por el camino que haya.
  _sendReceipt(type, deviceId, msgId, routeTo, extra, waited) {
    var self = this;
    // 3215: al arrancar, una confirmación antes de tener el NEXO ID propio salía como «unknown» y con la firma de «unknown»: se espera
    if (!waited && !(this.ble && this.ble.localNexoId)) return this._whenMyNx().then(function() { return self._sendReceipt(type, deviceId, msgId, routeTo, extra, true); });
    var myNx = (this.ble && this.ble.localNexoId) || 'unknown';
    var obj = { v: 1, type: type, msgId: msgId, from: myNx, ts: Date.now() };
    if (extra && extra.got === 1) obj.got = 1;
    var target = _normId(routeTo) || _normId(this._resolveNexoId(deviceId));
    // 3178: por Bluetooth solo «sale» con el enlace listo: con el otro lejos el nativo la acepta igual y la deja en una cola que solo
    // se vacía si vuelven a conectar por Bluetooth (si después se ven por internet, nunca llegaba)
    var btReady = !!routeTo || _isLanDevice(deviceId) || _isNetDevice(deviceId) || this._rcptLinkReady(deviceId);
    var out = function() {
      if (routeTo) { obj.to = String(routeTo).toLowerCase(); self._sendRouted(obj, deviceId); return Promise.resolve(true); } // queda en la cola de Jump
      if (!deviceId || !self.ble || !self.ble._sendMessageNative) return Promise.resolve(false);
      return self.ble._sendMessageNative(deviceId, JSON.stringify(obj), null).then(function(r) { return btReady && !(r && r.sent === false); }, function() { return false; });
    };
    var c = this._contactOf(deviceId, routeTo);
    var p = (c && c.proto === 2 && c.publicKey && !c.pendingKey && _ackRe.test(target))
      ? e2eAckTag(c.publicKey, type + '|' + msgId + '|' + _normId(myNx) + '|' + target).then(function(a) { if (a) obj.a = a; return out(); }, out)
      : out();
    return p.then(function(ok) { self._rcptNote(target, type, msgId, extra, ok); return ok; }, function() { self._rcptNote(target, type, msgId, extra, false); return false; });
  }
  // ===== 3178 (ciudad 17-11: 41 «leído» que no volvían y grupos en ✓ con todos los miembros servidos) =====
  // Un acuse (entregado/leído) es un paquete de UN intento y el emisor no reintenta lo que ya dejó en un relé (✓) ni lo ya entregado
  // (✓✓ gris): si el acuse no salía (sin internet justo al leer, relés que no contestan o lo rechazan, el puente en su tope, enlace
  // caído) se perdía para siempre. Ahora el que no sale queda apuntado y vuelve a salir por el camino que haya (Wi-Fi, internet en
  // línea, Bluetooth listo, su buzón de internet o Jump): a los 3 s, 15 s, 45 s, 2, 5 y 10 min, y antes si aparece un camino NUEVO
  // con ese contacto (cada evento de enlace llama a _resendPendingMessages; por el mismo camino espera su turno, sin inundar). Con
  // tope: RCPT_TRIES intentos, RCPT_MAX por contacto, RCPT_TTL_MS de vida. Un acuse repetido no hace daño (el emisor deduplica por
  // tipo+id). Formato y firma (C1) iguales.
  _rcptLinkReady(deviceId) {
    var st = (deviceId && this.ble && typeof this.ble._getDeviceState === 'function') ? this.ble._getDeviceState(deviceId) : null;
    return !!st && (st.state === 'ready_to_chat' || st.state === 'notifications_ready'); // BLE_STATES.READY_TO_CHAT / NOTIFICATIONS_READY
  }
  _rcptState(nx) {
    if (!this._rcptSt) this._rcptSt = new Map();
    var s = this._rcptSt.get(nx);
    if (!s) { s = { timer: null, n: 0, at: 0, next: 0, via: null }; this._rcptSt.set(nx, s); }
    return s;
  }
  _rcptNote(nx, type, msgId, extra, ok) {
    if (!/^nx[0-9a-z]{8}$/.test(nx || '') || !msgId) return;
    var key = type + ':' + msgId, m = this._rcpt && this._rcpt.get(nx);
    if (ok) {
      if (m && m.delete(key) && !m.size) { this._rcpt.delete(nx); this._rcptReset(nx); }
      return;
    }
    if (!this._rcpt) this._rcpt = new Map();
    if (!m) { m = new Map(); this._rcpt.set(nx, m); }
    if (!m.has(key)) {
      m.set(key, { type: type, msgId: msgId, extra: extra && extra.got === 1 ? { got: 1 } : null, tries: 0, at: Date.now() });
      while (m.size > RCPT_MAX) m.delete(m.keys().next().value);
    }
    this._rcptArm(nx);
  }
  _rcptArm(nx) {
    var self = this, s = this._rcptState(nx);
    if (s.timer) return;
    var wait = RCPT_WAIT_MS[Math.min(s.n, RCPT_WAIT_MS.length - 1)];
    s.n++; s.next = Date.now() + wait;
    s.timer = setTimeout(function() { s.timer = null; self.flushReceipts(nx, 'reintento', true); }, wait);
  }
  _rcptReset(nx) { var s = this._rcptState(nx); clearTimeout(s.timer); s.timer = null; s.n = 0; s.next = 0; s.via = null; }
  // El camino de AHORA para un acuse: el más rápido directo; si no, su buzón de internet (queda guardado en el relé); si no, Jump
  _rcptPath(nx) {
    var b = this.ble;
    if (!b) return null;
    if (b.lan && typeof b.lan.canReach === 'function' && b.lan.canReach(nx)) return { dev: 'lan:' + nx, via: 'Wi-Fi' };
    var net = b.net;
    if (net && typeof net.canReach === 'function' && net.canReach(nx)) return { dev: 'net:' + nx, via: 'internet' };
    var bt = typeof b._bleReadyFor === 'function' ? b._bleReadyFor(nx) : null;
    if (bt) return { dev: bt, via: 'Bluetooth' };
    if (net && typeof net.mailboxOk === 'function' && net.mailboxOk(nx)) return { dev: 'net:' + nx, via: 'su buzón de internet' }; // i18n-ok: registro
    if (b.relay && typeof b.relay.relayHop === 'function' && b.relay.relayHop(nx)) return { dev: null, route: true, via: 'Jump' };
    return null;
  }
  // Un acuse sin enlace listo al momento (p. ej. el «leído» al abrir el chat): sale ya por el camino que haya o queda apuntado
  queueReceipt(type, nexoId, msgId, extra) {
    var nx = _normId(nexoId);
    if (!/^nx[0-9a-z]{8}$/.test(nx) || !msgId) return;
    var path = this._rcptPath(nx);
    if (!path) { this._rcptNote(nx, type, msgId, extra, false); return; }
    return type === 'read_receipt' ? this.sendReadReceipt(path.dev, msgId, path.route ? nx : undefined) : this.sendAck(path.dev, msgId, path.route ? nx : undefined, extra);
  }
  // Volver a mandar los acuses de ese contacto que no salieron (lo pide cada evento de enlace; force: el temporizador)
  flushReceipts(nexoId, why, force) {
    var self = this, nx = _normId(nexoId), m = this._rcpt && this._rcpt.get(nx);
    if (!m || !m.size) return 0;
    var now = Date.now(), s = this._rcptState(nx);
    if (!force && now - s.at < RCPT_GAP_MS) return 0;
    var path = this._rcptPath(nx);
    if (!path) return 0; // sin camino: espera al próximo evento de enlace
    if (!force && path.via === s.via && now < s.next) return 0; // por el mismo camino que ya falló: espera su turno
    s.at = now; s.via = path.via;
    var list = [], dropped = 0;
    m.forEach(function(e, k) { if (++e.tries > RCPT_TRIES || now - e.at > RCPT_TTL_MS) { m.delete(k); dropped++; } else list.push(e); });
    if (dropped) console.warn('[ACUSE] ' + dropped + ' confirmación(es) para ' + nx + ' no salieron tras ' + RCPT_TRIES + ' intentos: se dejan');
    if (!m.size) { this._rcpt.delete(nx); this._rcptReset(nx); }
    if (!list.length) return 0;
    console.log('[ACUSE] ' + list.length + ' confirmación(es) para ' + nx + ' que no salieron: van ahora por ' + path.via + ' (' + why + ')');
    list.forEach(function(e) {
      if (e.type === 'read_receipt') self.sendReadReceipt(path.dev, e.msgId, path.route ? nx : undefined);
      else self.sendAck(path.dev, e.msgId, path.route ? nx : undefined, e.extra);
    });
    return list.length;
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
    // 3180: un reenvío de Jump ocupa el hueco de archivos de ese enlace: al terminar, la cola del Bluetooth ocupado sigue (antes no avisaba)
    return stream._promise.then(function() { self.outgoingStreams.delete(msgId); self._pumpFileQueue(); },
      function(err) { self.outgoingStreams.delete(msgId); self._pumpFileQueue(); throw err; });
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
}

// Reestructuración 15-11: los métodos de BleAckSystem están repartidos en ble_ack_files.js (envío de archivos), ble_ack_incoming.js
// (recepción) y ble_ack_resume.js (reanudar y limpiar). Se unen a la clase como sus métodos normales (no enumerables).
function _mixAck(o) { Object.getOwnPropertyNames(o).forEach(function(k) { Object.defineProperty(BleAckSystem.prototype, k, { value: o[k], writable: true, configurable: true, enumerable: false }); }); }
_mixAck(ackFiles); _mixAck(ackIncoming); _mixAck(ackResume);
export function createAckSystem(bleInterface) {
return new BleAckSystem(bleInterface);
}

// Lo que otros archivos y las pruebas importan de aquí (ahora en ble_ack_shared.js)
export { _isBusyErr, _busyBackoffMs, _fenixYieldBle, _readTooEarly, _netFileAutoRetry, _bigxFullBlock, _assemblyTimeoutFor } from './ble_ack_shared.js';
