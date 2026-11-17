import { _normId, _vaultLoadMessages, _vaultAppendMessage, _safeDispatchEvent, _netNx, BLE_STATES, BT_FILE_MAX_CHARS, _isPathDev, _hasNativeMethod, _safeNativeCall } from './ble_helpers.js';
import { pointerReusable, blobMailboxEligible, validatePointer, loadBlobSeen, _b64Bytes as _blobB64Bytes, saveBlobSeen, MAX_CONCURRENT as BLOB_MAX_CONCURRENT, fetchBlob, _fetchRetryDelay, loadCitaOut, loadCitaIn, MAILBOX_MAX_BYTES as BLOB_MAILBOX_MAX_BYTES, saveCitaOut, validateCita, saveCitaIn } from '../net/blob_mailbox.js';
import { NET_MAX_B64_BYTES } from './media_limits.js';
// Métodos de BLE_MESSAGE_METHODS: ARCHIVOS: buzón de archivos en relés, citas para bajarlos y el envío de archivos.
// Reestructuración 15-11: movidos TAL CUAL desde ble_messages.js, que los une en BLE_MESSAGE_METHODS.
export const BLE_BLOB_METHODS = {

  // Fase B/C: archivo a un contacto AUSENTE (ni Bluetooth listo, ni Wi-Fi, ni en línea por internet) teniendo yo internet →
  // BUZÓN DE ARCHIVOS (≤ 5 MB; no Jump): cifrado una vez en los relés + puntero E2E en su buzón. Fase C: si el adjunto trae un
  // puntero VIGENTE (meta.blobPtr: ya vive en los relés —reenvío de algo recibido o enviado por el buzón—) va POR REFERENCIA
  // también a un contacto EN LÍNEA solo por internet (0 subidas); con Bluetooth/Wi-Fi listos sigue el camino local directo.
  // Devuelve la promesa del envío (✓ al guardarse el puntero) o null si no aplica.
  _fileToBlobMailbox(nexoId, fileId, base64Data, meta, online) {
    var self = this, nx = _normId(nexoId), net = self.net;
    if (!nx || !net || !self.ackSystem || typeof self.ackSystem._sendFileViaBlobMailbox !== 'function') return null;
    if (self.lan && typeof self.lan.canReach === 'function' && self.lan.canReach(nx)) return null;
    if (typeof self._bleReadyFor === 'function' && self._bleReadyFor(nx)) return null;
    var byRef = pointerReusable(meta && meta.blobPtr);
    var bridged = typeof net.viaBridge === 'function' && net.viaBridge(nx); // puente parte 4: en línea, pero por un puente
    // 3128: EN LÍNEA solo por los relés (sin Tor directo) también va al buzón de archivos (ver _blobOnlineOk)
    var relaysOnline = !!online && self._blobOnlineOk(nx);
    if (!byRef && !bridged && !relaysOnline && (typeof net.canReach !== 'function' || net.canReach(nx))) return null;
    if (!net.mailboxFilesOk(nx, base64Data && base64Data.length) || !blobMailboxEligible(base64Data, meta)) return null; // por un puente: solo lo pequeño (parte 3)
    return self.ackSystem._sendFileViaBlobMailbox(nx, fileId, base64Data, meta);
  },
  // 3128 (diagnóstico S24 3067 15-11 08:41, «Velocidad de hoy»: archivos por internet 2,1 KB/s de media; por el buzón de archivos
  // 116 KB/s al subir y 54 KB/s al bajar): una foto o nota de voz a un contacto EN LÍNEA solo por los relés iba como flujo por
  // trozos (cada ventana espera la confirmación del otro a través de los relés y, con su app dormida, no avanza: una nota de voz
  // de 53 s = 1,2 MB a ~2 KB/s son ~10 min) y cada trozo le llegaba repetido por cada relé. Ahora va al buzón de archivos: se
  // cifra una vez, se sube en trozos de 40 KB sin esperar a nadie y el otro baja cada trozo de UN relé, por su id. Por Tor
  // directo (una conexión entre los dos, sin relés) sigue el flujo por trozos. Perilla de pruebas: NEXO_BLOB_ONLINE = false.
  _blobOnlineOk(nx) {
    var net = this.net;
    if (typeof window !== 'undefined' && window.NEXO_BLOB_ONLINE === false) return false;
    if (!net || typeof net.canReach !== 'function' || !net.canReach(nx)) return false;
    return !(typeof net.via === 'function' && net.via(nx) === 'tor');
  },
  // ===== Fase B/C: llegó un PUNTERO a un archivo del buzón de relés (1-a-1 o dentro de un sobre de GRUPO) =====
  // Orden obligatorio: techos anti-DoS (validatePointer, sin reservar nada) → ¿ya tengo este blob? (dedup local por huella,
  // Fase C) → si no, bajar por id de los relés del puntero → verificar cada trozo por su id → armar → huella → descifrar (GCM)
  // → recién entonces guardar, mostrar, avisar y confirmar (✓✓), reinyectando el adjunto completo por el mismo camino que un
  // adjunto normal (mismo msgId, mismo sobre E2E; en grupo, el mismo sobre nexo_grp con el adjunto entero). El puntero se
  // guarda en el mensaje (meta.blobPtr): un reenvío va por referencia. Dedup: un puntero repetido solo re-confirma. Si la
  // bajada falla, reintento con freno (30 s → 2 m → 8 m → 30 m…) hasta que caduque; máximo BLOB_MAX_CONCURRENT bajadas a la vez.
  _blobPointerReceived(deviceId, senderUUID, messageId, att, data, ackTo, genv) {
    var self = this;
    if (self._receivedMessageIds.has(messageId)) { if (self.ackSystem) self.ackSystem.sendAck(deviceId, messageId, ackTo); return; }
    var why = validatePointer(att.ptr);
    if (why) { console.warn('[BLOB] Puntero de ' + senderUUID + ' rechazado (' + why + '): no se baja nada'); return; }
    if (!self._blobIn) self._blobIn = new Map();
    if (self._blobIn.has(messageId)) return; // ya bajando / en cola
    var job = { deviceId: deviceId, senderUUID: senderUUID, messageId: messageId, att: att, data: data, ackTo: ackTo, genv: genv || null, tries: 0, running: false, timer: null, t0: Date.now() };
    self._blobIn.set(messageId, job);
    console.log('[BLOB] Puntero de ' + senderUUID + (genv ? ' (grupo ' + genv.g + ')' : '') + ' (' + att.attachmentType + ', ' + att.ptr.chunks.length + ' trozos, ' + Math.round(att.ptr.raw / 1024) + ' KB): bajo del buzón de archivos');
    self._blobRunQueue();
  },
  _blobSeenMap() { if (!this._blobSeen) this._blobSeen = loadBlobSeen(); return this._blobSeen; },
  // Fase C (dedup local por huella): ¿ya tengo este mismo blob (misma huella y misma llave) en algún chat? → su contenido, sin bajar
  _blobTryLocal(j) {
    var self = this, ptr = j.att.ptr, seen = self._blobSeenMap().get(ptr.hash);
    if (!seen || seen.k !== ptr.k || typeof window === 'undefined' || !window.vaultLoadMessages) return Promise.resolve(null);
    return window.vaultLoadMessages(seen.chat).then(function(list) {
      var m = (list || []).find(function(x) { return (x.messageId || x.msgId) === seen.msgId && x.attachmentType && !x.deleted; });
      if (!m) return null;
      if (m.attachmentPayload && typeof m.attachmentPayload === 'string' && m.attachmentPayload.length > 16) return m.attachmentPayload;
      return (m.attachmentRef && window.vaultLoadFile) ? window.vaultLoadFile(m.attachmentRef) : null;
    }).then(function(b64) { return (typeof b64 === 'string' && _blobB64Bytes(b64) === ptr.raw) ? b64 : null; }).catch(function() { return null; });
  },
  _blobComplete(j, b64, how) {
    var self = this;
    self._blobIn.delete(j.messageId);
    // 3081: velocidad de bajada del buzón de archivos (desde que llegó el puntero; incluye esperas y reintentos)
    try { if (j.t0 && typeof window.NEXO_noteSpeed === 'function') window.NEXO_noteSpeed('buzon', 'in', _blobB64Bytes(b64), Date.now() - j.t0); } catch (e) {}
    var meta = Object.assign({}, j.att.meta || {}); delete meta.ptr; meta.blobPtr = j.att.ptr; // Fase C: un reenvío va por referencia
    var full = { type: 'attachment', attachmentType: j.att.attachmentType, payload: b64, meta: meta };
    var chat = j.genv ? _normId(j.genv.g) : _normId(j.senderUUID);
    try { var seen = self._blobSeenMap(); seen.set(j.att.ptr.hash, { k: j.att.ptr.k, chat: chat, msgId: j.messageId, at: Date.now() }); saveBlobSeen(seen); } catch (e) {}
    var text = j.genv ? JSON.stringify(Object.assign({}, j.genv, { c: JSON.stringify(full) })) : JSON.stringify(full);
    var env = { v: 1, type: 'chat', from: j.senderUUID, msgId: j.messageId, ts: j.data.timestamp || Date.now(), payload: { text: text, e2e: true, senderNexoId: j.senderUUID } };
    if (!j.genv) env.payload.attachment = full;
    var wire = JSON.stringify(env);
    console.log('[BLOB] ' + j.messageId + ' ' + how + ' (' + Math.round(_blobB64Bytes(b64) / 1024) + ' KB): se guarda y se confirma');
    self._handlePayload(Object.assign({}, j.data, { content: wire, data: wire, reassembled: true, _blobResolved: true }));
    self._blobRunQueue();
  },
  _blobRunQueue() {
    var self = this;
    if (!self._blobIn) return;
    var running = 0;
    self._blobIn.forEach(function(j) { if (j.running) running++; });
    self._blobIn.forEach(function(j) {
      if (running >= BLOB_MAX_CONCURRENT || j.running || j.timer) return;
      running++; j.running = true; j.tries++;
      var viaGw = !!(self.net && typeof self.net.gwOnly === 'function' && self.net.gwOnly()); // 3179: este intento va por un puente
      self._blobTryLocal(j).then(function(local) {
        if (local) { j.t0 = 0; return self._blobComplete(j, local, 'ya lo tenía (mismo archivo, no se baja nada)'); }
        return fetchBlob(self.net, j.att.ptr, { log: function(s) { console.log(s); } }).then(function(res) {
          self._blobComplete(j, res.b64, 'bajado y verificado (' + res.relays + ' relés, ' + res.bad + ' trozos malos descartados)');
        });
      }).catch(function(e) {
        j.running = false;
        var expMs = (j.att.ptr.expires || 0) * 1000;
        if (e && (e.code === 'BLOB_PTR' || e.code === 'BLOB_GCM' || e.code === 'BLOB_HASH')) { console.warn('[BLOB] ' + j.messageId + ' descartado: ' + e.message); self._blobIn.delete(j.messageId); self._blobRunQueue(); return; }
        if (Date.now() + 30000 > expMs) { console.warn('[BLOB] ' + j.messageId + ' caducó sin poder bajarse (' + (e && e.message) + ')'); self._blobIn.delete(j.messageId); self._blobRunQueue(); return; }
        var wait = _fetchRetryDelay(j.tries);
        // 3179: el intento iba por un puente y mientras tanto volvió el internet PROPIO: se reintenta ya por él (no a su turno)
        if (viaGw && self.net && typeof self.net._realOpenCount === 'function' && self.net._realOpenCount() > 0) wait = 1000;
        console.warn('[BLOB] ' + j.messageId + ' no se pudo bajar (' + (e && e.message) + '): reintento en ' + Math.round(wait / 1000) + ' s');
        j.timer = setTimeout(function() { j.timer = null; self._blobRunQueue(); }, wait);
        self._blobRunQueue();
      });
    });
  },
  // ===== Fase D (2972): la «CITA» para archivos > 5 MB (no caben en el buzón de archivos) a un contacto AUSENTE =====
  // Emisor: deja en su buzón un aviso chiquito (nombre, tamaño, id) UNA vez por archivo; el archivo queda ⏳ y entra al toque FCM
  // por pendientes (Fase A). Receptor: marcador «esperando» en el chat, contesta «ya estoy» (+ toque FCM al emisor) y entra al
  // toque mutuo; cuando coinciden, el flujo directo de siempre lo entrega y el marcador se vuelve el archivo (mismo id).
  _citaOutMap() { if (!this._citaOut) this._citaOut = loadCitaOut(); return this._citaOut; },
  _citaInMap() { if (!this._citaIn) this._citaIn = loadCitaIn(); return this._citaIn; },
  _fileCita(nexoId, fileId, base64Data, meta) {
    var bytes = (typeof base64Data === 'string') ? Math.floor(base64Data.length * 3 / 4) : Number(base64Data) || 0;
    return this._fileCitaBytes(nexoId, fileId, bytes, meta);
  },
  _fileCitaBytes(nexoId, fileId, bytes, meta) {
    var self = this, nx = _normId(nexoId), net = self.net, type = (meta && meta.type) || 'file';
    if (!nx || !fileId || !net || !bytes || bytes <= BLOB_MAILBOX_MAX_BYTES) return false; // ≤ 5 MB: eso es el buzón de archivos
    // 3163: ni un «ver una vez» (el vídeo original > 5 MB): su aviso sería una burbuja «una vez» sin vídeo que se gastaría al tocarla;
    // queda ⏳ y sale directo (con la marca) cuando coincidan
    if (meta && (meta.dst || meta.fwd || meta.big || meta.hdFor || meta.once)) return false;
    if (type !== 'image' && type !== 'video' && type !== 'file') return false;
    if (typeof net.canReach !== 'function' || net.canReach(nx) || typeof net.mailboxFilesOk !== 'function' || !net.mailboxFilesOk(nx)) return false;
    if (self.lan && typeof self.lan.canReach === 'function' && self.lan.canReach(nx)) return false;
    if (typeof self._bleReadyFor === 'function' && self._bleReadyFor(nx)) return false;
    var out = self._citaOutMap(), prev = out.get(String(fileId));
    self._noteWakePending(nx); // el archivo grande pendiente entra al toque por pendientes (Fase A)
    if (prev && prev.cid === nx) return true; // ya avisado
    var metaWire = Object.assign({}, meta || {}); delete metaWire.to; delete metaWire.blobPtr; delete metaWire.thumb;
    var att = { type: 'attachment', attachmentType: type, payload: 'cita', meta: Object.assign({}, metaWire, { cita: 1, size: bytes }),
      cita: { v: 1, id: String(fileId), bytes: bytes, name: metaWire.name ? String(metaWire.name).substring(0, 200) : undefined, mime: metaWire.mime ? String(metaWire.mime).substring(0, 100) : undefined } };
    out.set(String(fileId), { cid: nx, at: Date.now(), bytes: bytes }); saveCitaOut(out);
    console.log('[CITA] ' + fileId + ' (' + Math.round(bytes / 1048576) + ' MB) a ' + nx + ' ausente: le dejo el aviso en su buzón; el archivo queda ⏳ hasta coincidir');
    if (self.ackSystem && typeof self.ackSystem._dispatchStatus === 'function') self.ackSystem._dispatchStatus(String(fileId), 'pending'); // ⏳ «esperando que se conecte» visible (contratos §7), nunca ✗
    self._sendViaNetMailbox(nx, JSON.stringify(att), String(fileId) + '_c').catch(function(e) { out.delete(String(fileId)); saveCitaOut(out); console.warn('[CITA] el aviso de ' + fileId + ' no salió: ' + (e && e.message)); });
    return true;
  },
  _fileCitaFromMsg(nexoId, m) {
    var t = m.attachmentType, mm = m.attachmentMeta || {}, p = m.attachmentPayload;
    var bytes = (typeof p === 'string' && p.length > 16) ? Math.floor(p.length * 3 / 4) : Number(mm.size) || 0;
    if (!t || mm.big) return false;
    return this._fileCitaBytes(nexoId, m.messageId || m.msgId || m.id, bytes, Object.assign({ type: t }, mm));
  },
  _citaReceived(deviceId, senderUUID, messageId, att, data, ackTo) {
    var self = this, why = validateCita(att.cita);
    if (self.ackSystem && messageId) self.ackSystem.sendAck(deviceId, messageId, ackTo);
    if (why) { console.warn('[CITA] aviso de ' + senderUUID + ' rechazado (' + why + ')'); return; }
    if (messageId && self._receivedMessageIds.has(messageId)) return;
    if (messageId) self._receivedMessageIds.add(messageId);
    var fileId = att.cita.id, nx = _normId(senderUUID), inMap = self._citaInMap();
    if (inMap.has(fileId)) { self._citaReply(nx, fileId); return; }
    inMap.set(fileId, { from: nx, bytes: att.cita.bytes, at: Date.now() }); saveCitaIn(inMap);
    var meta = Object.assign({}, att.meta || {}); delete meta.ptr;
    meta.cita = { bytes: att.cita.bytes, from: nx, at: Date.now(), realType: att.attachmentType };
    if (att.cita.name && !meta.name) meta.name = att.cita.name;
    if (att.cita.mime && !meta.mime) meta.mime = att.cita.mime;
    if (!meta.size) meta.size = att.cita.bytes;
    var marker = { type: 'attachment', attachmentType: 'file', payload: 'cita', meta: meta };
    var ts = data.timestamp || Date.now();
    var vaultMsg = { messageId: fileId, content: JSON.stringify(marker), _own: false, status: 'delivered', timestamp: ts, senderName: '', senderNexoId: nx, seq: 0,
      attachmentType: 'file', attachmentPayload: null, attachmentMeta: meta };
    console.log('[CITA] ' + nx + ' tiene un archivo de ' + Math.round(att.cita.bytes / 1048576) + ' MB para mí (' + fileId + '): marcador en el chat, le aviso que ya estoy y lo toco si hace falta');
    _vaultLoadMessages(nx).then(function(list) {
      var cur = (list || []).find(function(x) { return (x.messageId || x.msgId) === fileId; });
      if (cur && (cur.attachmentPayload || cur.attachmentRef)) { inMap.delete(fileId); saveCitaIn(inMap); return; } // ya lo tengo
      if (!cur) _vaultAppendMessage(nx, vaultMsg, false);
      self.noteContactMessage(nx, '📦 ' + (meta.name || 'archivo'), ts, fileId); // 3183: con su id
      _safeDispatchEvent('nexo:ble:messageReceived', { deviceId: deviceId, deviceUUID: nx, content: vaultMsg.content, messageId: fileId, senderName: '', senderNexoId: nx, seq: 0, timestamp: ts, attachmentType: 'file', attachmentPayload: null, attachmentMeta: meta });
    }).catch(function() {});
    self._noteWakePending(nx); // toque MUTUO (Fase A): si el que tiene el archivo duerme, lo despierto yo con freno creciente
    self._citaReply(nx, fileId);
  },
  _citaReply(nx, fileId) {
    var self = this;
    if (!self.net || typeof self.net.mailboxOk !== 'function' || !self.net.mailboxOk(nx)) return;
    var wire = JSON.stringify({ type: 'nexo_cita', id: String(fileId), ok: 1 });
    self._sendViaNetMailbox(nx, wire, 'cr' + String(fileId).replace(/[^A-Za-z0-9]/g, '').substring(0, 40) + Date.now().toString(36)).catch(function() {});
  },
  _onCitaReply(from, sig) {
    var self = this, nx = _normId(from);
    console.log('[CITA] ' + nx + ' ya está (espera ' + (sig && sig.id) + '): saludo y reenvío lo pendiente en cuanto lo vea en línea');
    try { if (self.net && typeof self.net.greet === 'function') self.net.greet(); } catch (e) {}
    setTimeout(function() { try { self._resendPendingMessages(nx); } catch (e) {} }, 2500);
    setTimeout(function() { try { self._resendPendingMessages(nx); } catch (e) {} }, 15000);
  },
  _citaResolved(fileId) {
    if (!fileId) return;
    var m = this._citaInMap();
    if (!m.has(fileId)) return;
    m.delete(fileId); saveCitaIn(m);
    console.log('[CITA] ' + fileId + ' llegó: marcador cumplido');
  },
  // ¿Sigo esperando un archivo grande de este contacto? (mantiene el toque mutuo de la Fase A)
  _citaPendingFrom(nx) {
    var m = this._citaInMap(), any = false; nx = _normId(nx);
    m.forEach(function(v) { if (v && _normId(v.from) === nx) any = true; });
    return any;
  },
  // Volvió internet / un relé: reintentar ya lo que esperaba su turno
  _blobRetryNow() {
    var self = this;
    if (!self._blobIn || !self._blobIn.size) return;
    self._blobIn.forEach(function(j) { if (j.timer) { clearTimeout(j.timer); j.timer = null; } });
    self._blobRunQueue();
  },

  sendFile(deviceUUID, fileId, base64Data, meta) {
    var self = this;
    // 3197 (hallazgo del ayudante de la 3193, 17-11): en vuelo desde ya hasta que lo toma el sistema de envío (flujo por trozos o buzón
    // de archivos, que tienen su propia marca) o falla. Antes, en el margen de 0,5 s de abajo el reenvío de pendientes lo mandaba por
    // trozos y este envío lo subía además al buzón de archivos
    var held = self._holdOut(fileId);
    var out = new Promise(function(resolve, reject) {
      try {
        var uuid = _normId(deviceUUID);
        if (!uuid) { reject(new Error('deviceUUID vacio')); return; }
        if (!base64Data) { reject(new Error('base64Data vacio')); return; }
        // 3197: al buzón de archivos, si aplica; desde que lo toma lo marca su subida (_blobOutRunning)
        var toBlob = function(online) { var v = self._fileToBlobMailbox(uuid, fileId, base64Data, meta, online); if (v) held(); return v; };

        var deviceId = self._resolveDeviceIdForNexoId(uuid);
        if (!deviceId) {
          // Último intento: active chat (ronda 2766: no si esa dirección consta como de otro contacto)
          if (self._activeChatDeviceId === uuid && self._activeChatDeviceIdNative && !self._macOfOther(self._activeChatDeviceIdNative, uuid)) {
            deviceId = self._activeChatDeviceIdNative;
          }
        }
        if (!deviceId && self.relay && self.relay.relayHop(uuid)) deviceId = uuid;
        if (!deviceId) {
          // Fase B (build 2969): contacto AUSENTE por todos los caminos pero con internet propio → BUZÓN DE ARCHIVOS (≤ 5 MB):
          // el archivo llega aunque los dos nunca coincidan en línea. Antes: PEER_ABSENT → ⏳ hasta coincidir.
          var viaBlob0 = toBlob();
          if (viaBlob0) { viaBlob0.then(resolve, reject); return; }
          self._fileCita(uuid, fileId, base64Data, meta); // Fase D (2972): > 5 MB a un ausente → aviso chiquito en su buzón (el archivo queda ⏳)
          // v6.1.11: contacto aún no visto: el adjunto queda pendiente y se reenvía al encontrarlo
          self._markPeerLost(uuid);
          if (self.relay) self.relay.discover(uuid);
          var eNf = new Error('Contacto no disponible: queda pendiente');
          eNf.code = 'PEER_ABSENT';
          reject(eNf);
          return;
        }

        if (!self.ackSystem || typeof self.ackSystem.sendFile !== 'function') {
          reject(new Error('AckSystem no disponible'));
          return;
        }

        function startTransfer() {
          console.log('[BLEInterface] sendFile START fileId=' + fileId + ' deviceId=' + deviceId + ' b64len=' + base64Data.length);
          // Ronda 2766: a quién va (se cifra para él y solo sale por una conexión suya)
          var m2 = (meta && meta.dst) ? meta : Object.assign({}, meta || {}, { to: uuid });
          self.ackSystem.sendFile(deviceId, fileId, base64Data, m2)
            .then(function() { resolve(); })
            .catch(function(err) { reject(err); });
          held(); // 3197: ya lo tiene el sistema de envío (cifrando, flujo o cola del Bluetooth: sus marcas)
        }

        // v6.1.9: el dispositivo se resuelve en cada intento (el otro puede volver con otra dirección).
        // Si en 8 s no hay enlace listo con ese contacto: PEER_ABSENT; el adjunto queda pendiente y se
        // reenvía al reconectar. Antes esperaba ~40 s a la dirección vieja y el vídeo se perdía.
        function ensureReadyThenSend() {
          var deadline = Date.now() + 8000;
          var nudged = false;
          (function check() {
            var dev = self._resolveDeviceIdForNexoId(uuid) || (self._macOfOther(deviceId, uuid) ? null : deviceId);
            // Fase C (2971): el adjunto ya vive en los relés (puntero vigente: reenvío de algo recibido/enviado por el buzón) y el
            // contacto está solo por internet → va POR REFERENCIA (0 subidas) aunque esté en línea; con Bluetooth/Wi-Fi, directo
            if (_netNx(dev) && meta && meta.blobPtr) { var viaRef = toBlob(); if (viaRef) { viaRef.then(resolve, reject); return; } }
            // Puente parte 4: por internet con un puente de por medio (yo o él), al buzón de archivos (paquete por Wi-Fi Direct al puente)
            if (_netNx(dev) && self.net && typeof self.net.viaBridge === 'function' && self.net.viaBridge(uuid)) { var viaGw = toBlob(); if (viaGw) { viaGw.then(resolve, reject); return; } }
            // 3128: en línea solo por los relés → buzón de archivos (rápido y sin esperar a que su app conteste); > 5 MB, flujo por trozos
            if (_netNx(dev)) { var viaOn = toBlob(true); if (viaOn) { viaOn.then(resolve, reject); return; } }
            // Ronda 2780 (pedido del dueño): fotos y archivos medianos SIEMPRE se pueden mandar por internet. Si el otro
            // está en línea van por Tor directo/Wi-Fi (filesOk); si no, al buzón de los relés (mailboxOk) y llegan cuando
            // abre, igual que los textos. Bajo un tope (~6 MB de archivo): los más grandes son la fase 2 (Tor). Antes solo
            // salían con los dos en Wi-Fi; por eso una foto a un contacto lejano/desconectado no llegaba.
            var netMediaOk = self.net && (self.net.filesOk(uuid) || (self.net.mailboxFilesOk(uuid, base64Data.length) && base64Data.length <= NET_MAX_B64_BYTES)); // por un puente: solo lo pequeño (parte 3)
            var netNo = !!_netNx(dev) && !netMediaOk;
            if (netNo) dev = self._bleReadyFor(uuid) || dev;
            var st = self._getDeviceState(dev);
            if ((!netNo || !_netNx(dev)) && (st.state === BLE_STATES.READY_TO_CHAT || st.state === BLE_STATES.NOTIFICATIONS_READY)) {
              deviceId = dev;
              startTransfer();
              return;
            }
            // v6.3.0 Jump: por otro teléfono si hay ruta
            var rh = self.relay && self.relay.relayHop(uuid, { files: true });
            // Fase C (2971): un puente por INTERNET (2 saltos cargando a otro teléfono, con su dato) no le gana al buzón de archivos
            // (una copia en los relés + toque FCM) si el archivo puede ir por ahí; con puntero vigente va por referencia (0 bytes).
            // Un puente por Bluetooth (local, gratis) sí va primero.
            if (rh && _netNx(rh.deviceId)) { var viaBlobJ = toBlob(); if (viaBlobJ) { viaBlobJ.then(resolve, reject); return; } }
            // 3053 (diagnóstico del vivo 12-11 22:00): un archivo que no cabe por Bluetooth no sale por Jump, aunque el primer tramo
            // sea Wi-Fi: algún tramo siguiente es Bluetooth (el puente no tiene Wi-Fi ni internet con él, si no iría directo)
            if (rh && typeof base64Data === 'string' && base64Data.length > BT_FILE_MAX_CHARS && !(meta && meta.big)) {
              console.log('[JUMP] ' + fileId + ' (' + Math.round(base64Data.length * 3 / 4 / 1024) + ' KB) no cabe por Bluetooth: no va por el puente ' + rh.via + ', espera Wi-Fi/internet con ' + uuid);
              rh = null;
            }
            if (rh) {
              deviceId = rh.deviceId;
              meta = Object.assign({}, meta || {}, { dst: uuid });
              console.log('[JUMP] Adjunto ' + fileId + ' a ' + uuid + ' por ' + rh.via);
              self._noteRelayedOut(fileId, uuid);
              self.relay.plan(uuid, (meta && meta.type) || 'file', base64Data.length);
              startTransfer();
              return;
            }
            // Fase B (build 2969): sin enlace listo ni ruta Jump, nada conectándose y el contacto AUSENTE por internet → al
            // BUZÓN DE ARCHIVOS ya (no se esperan los 8 s: no hay nada que esperar). Si algo se está conectando, se le da
            // el plazo; al vencer, también va al buzón de archivos antes que quedar ⏳.
            var busy = st.state === BLE_STATES.CONNECTING || st.state === BLE_STATES.DISCOVERING_SERVICES;
            if (!busy || Date.now() >= deadline) {
              var viaBlob = toBlob();
              if (viaBlob) { viaBlob.then(resolve, reject); return; }
              self._fileCita(uuid, fileId, base64Data, meta); // Fase D (2972): > 5 MB → aviso chiquito (una vez); el archivo queda ⏳
            }
            if (!nudged) {
              nudged = true;
              console.log('[BLEInterface] sendFile: contacto no listo (' + (st.state || '?') + '), buscando…');
              self._markPeerLost(uuid);
              // 3084: ni a quien no está cerca por Bluetooth
              if (dev && !_isPathDev(dev) && typeof self._btNearby === 'function' && !self._btNearby(uuid)) self._btFarSkip(uuid, 'al mandar un archivo');
              else if (dev && !_isPathDev(dev) && !(typeof self._btPaused === 'function' && self._btPaused(uuid)) && self.nativePlugin && _hasNativeMethod(self.nativePlugin, 'connectToDevice') && st.state !== BLE_STATES.CONNECTING) {
                _safeNativeCall(self.nativePlugin, 'connectToDevice', { deviceId: dev }).catch(function() {});
              }
            }
            if (Date.now() >= deadline) {
              if (self.relay) self.relay.discover(uuid);
              var e = new Error('Contacto no disponible: queda pendiente');
              e.code = 'PEER_ABSENT';
              reject(e);
              return;
            }
            setTimeout(check, 500);
          })();
        }

        // Flujo post-cámara
        var afterCamera = function() {
          // Pequeño margen para estabilizar radio
          setTimeout(ensureReadyThenSend, 500);
        };

        if (self._cameraBlePaused) {
          self._waitIfCameraPaused()
            .then(afterCamera)
            .catch(reject);
        } else {
          afterCamera();
        }
      } catch (fatal) { reject(fatal); }
    });
    out.then(held, held);
    return out;
  },
};
