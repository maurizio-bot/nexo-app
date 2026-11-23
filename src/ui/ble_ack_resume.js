import { _normId, RESUME_SCAN_GAP_MS, _isFenixTx, RESUME_FAIL_MAX_MS, RESUME_FAIL_BASE_MS, MAX_RESUME_CONCURRENT, BLE_FILE_MAX_CHARS, _isLanDevice, _isNetDevice, _isStatusTx, _assemblyTimeoutFor, NET_BIG_MIN_CHUNKS, NET_BIG_IDLE_MS } from './ble_ack_shared.js';
import { e2eAnyEncrypted, e2eOpenText, e2eOpenToB64 } from '../vault/e2e_proto.js';
// Métodos de BleAckSystem: REANUDAR y limpiar: transferencias pendientes y entregadas, avisos de progreso, limpieza periódica.
// Reestructuración 15-11: movidos TAL CUAL desde ble_ack.js; ble_ack.js los une a la clase (como métodos normales).
export const ackResume = {
  cancelFileSend(fileId) {
    var tx = this.outgoingStreams.get(fileId) || this.pendingOutgoingTransfers.get(fileId);
    if (tx && tx.contactNexoId && window.vaultSetOutgoingStatus) window.vaultSetOutgoingStatus(tx.contactNexoId, fileId, 'cancelled').catch(function(){});
    this.outgoingStreams.delete(fileId);
    this.pendingOutgoingTransfers.delete(fileId);
    this.pendingOutgoingFiles.delete(fileId);
    this._dispatchFileProgress(fileId, 0, 0, 'cancelled');
  },
  // deviceId (opcional, 3038): el enlace de ESE contacto está listo (el reenvío de sus pendientes llama con él): sus transferencias se
  // reanudan aunque estén en espera por haberse rendido antes; las de los demás respetan su espera.
  resumeOutgoingTransfers(deviceId) {
    var self = this;
    if (!window.vaultGetPendingOutgoingTransfers) return;
    if (deviceId) { var hx = self._resolveNexoId(deviceId); if (hx) self._resumeHint.add(_normId(hx)); }
    // 3003 (diagnóstico automático S24 build 3001, 11-11 03:42: la app arrancó 3 veces en 1 min con un APK de 25 MB pendiente para tres
    // contactos): cada «Reenviando pending para X» y cada evento de enlace llamaba aquí, y esto recorre TODOS los contactos leyendo el
    // almacén de transferencias (trozos base64 de los archivos grandes, ~450–750 ms cada lectura): N reenvíos × 21 contactos en segundos →
    // memoria del WebView → reinicio. Se juntan las llamadas: como mucho un escaneo a la vez y como mínimo RESUME_SCAN_GAP_MS entre
    // escaneos; las llamadas intermedias se reducen a UN escaneo pendiente que corre al final (nada se pierde, solo se agrupa).
    var nowS = Date.now();
    var gap = RESUME_SCAN_GAP_MS - (nowS - (self._resumeScanAt || 0));
    if (self._resumeScanBusy || gap > 0) {
      if (!self._resumeScanTimer) {
        self._resumeScanTimer = setTimeout(function() { self._resumeScanTimer = null; self.resumeOutgoingTransfers(); }, Math.max(gap, 250));
      }
      return;
    }
    self._resumeScanAt = nowS;
    self._resumeScanBusy = true;
    var hints = self._resumeHint; self._resumeHint = new Set();
    var scans = [];
    var contacts = (self.ble && typeof self.ble.getBLEContacts === 'function') ? self.ble.getBLEContacts() : [];
    contacts.forEach(function(contact) {
      var cid = _normId(contact.nexoId);
      if (!cid) return;
      scans.push(window.vaultGetPendingOutgoingTransfers(cid).then(function(list) {
        if (!list || list.length === 0) return;
        return self._dropDeliveredTransfers(cid, list);
      }).then(function(list) {
        if (!list || list.length === 0) return;
        console.log('[BleAckSystem] Resume:', list.length, 'outgoing para', cid);
        // #CRASH 02-11: NO arrancar todas a la vez — encolar y reanudar como mucho MAX_RESUME_CONCURRENT a la vez.
        list.forEach(function(tx) {
          if (tx.status !== 'sending' && tx.status !== 'pending') return;
          // 3026: los respaldos Fénix guardados por builds anteriores se borran sin reenviarlos (Fénix los reintenta por su cuenta)
          if (_isFenixTx(tx.meta) || tx.type === 'fenix') {
            if (window.vaultRemoveOutgoingTransfer) window.vaultRemoveOutgoingTransfer(cid, tx.transferId).catch(function(){});
            return;
          }
          // 3030 (diagnóstico A55 12-11 11:36): un archivo que YA va por el buzón de archivos de este contacto (subiendo, o con el
          // puntero en su buzón) no se reanuda por otro camino: antes salía a la vez por el buzón y por un Bluetooth recién
          // aparecido (MTU 23, 1421 trozos, «Max window retries»). Con el puntero ya entregado al buzón, el registro sobra.
          var viaBlob = self._blobBusyFor(tx.transferId, cid);
          if (viaBlob) {
            console.log('[BleAckSystem] ' + tx.transferId + ' ya va por el buzón de archivos de ' + cid + ' (' + viaBlob + '): no se reanuda por otro camino');
            if (viaBlob === 'en su buzón' && window.vaultRemoveOutgoingTransfer) window.vaultRemoveOutgoingTransfer(cid, tx.transferId).catch(function(){});
            return;
          }
          // dedup: si ya está en vuelo (un ChatStream real) o ya encolada, no la metas otra vez (resumeOutgoingTransfers
          // se llama en cada evento de enlace; sin esto se recreaba el enjambre en cada reconexión)
          if (self.outgoingStreams.has(tx.transferId) || self._resumeSeen.has(tx.transferId)) return;
          // 3038 (diagnóstico S24 13-11 19:04–20:42: un texto largo para …ab2f, AUSENTE, arrancaba cada 15–30 s en cada reenvío de OTRO
          // contacto, iba por un Bluetooth que el nativo ya había soltado y se rendía a los 10 s; así casi 2 h, y cada arranque además
          // «protegía» el enlace del vigilante): tras rendirse espera 15 s, 30 s… hasta 10 min, salvo que su propio enlace esté listo.
          var rf = self._resumeFail.get(tx.transferId);
          if (rf && !hints.has(cid) && nowS - rf.at < Math.min(RESUME_FAIL_MAX_MS, RESUME_FAIL_BASE_MS * Math.pow(2, rf.n - 1))) return;
          // 3058 (la tablet del diagnóstico 07:28): un contacto que no confirmó NADA en la última vuelta de pendientes (en espera de
          // reenvío) no recibe reanudaciones en cada evento de enlace (cada ~2,5 s un texto de 37 trozos): primero la prueba de la
          // vuelta de pendientes; en cuanto confirma algo se quita la espera y esto sigue (ble_messages, vuelta de prueba)
          var zb = self.ble && self.ble._resendBackoff && self.ble._resendBackoff.get(cid);
          if (zb && zb.n >= 1 && !hints.has(cid)) return;
          self._resumeSeen.add(tx.transferId);
          self._resumeQueue.push({ cid: cid, tx: tx, contactDeviceId: contact.deviceId });
        });
        self._pumpResume();
      }).catch(function(){}));
    });
    Promise.all(scans).then(function() { self._resumeScanBusy = false; }, function() { self._resumeScanBusy = false; });
  },
  // #CRASH 02-11: arrancar hasta MAX_RESUME_CONCURRENT reanudaciones a la vez; al terminar una, entra la siguiente.
  _pumpResume() {
    var self = this;
    var max = (typeof window !== 'undefined' && Number(window.NEXO_MAX_RESUME)) || MAX_RESUME_CONCURRENT;
    while (self._resumeActive < max && self._resumeQueue.length > 0) {
      var job = self._resumeQueue.shift();
      self._resumeActive++;
      (function(j) {
        var done = function() {
          self._resumeActive--;
          self._resumeSeen.delete(j.tx.transferId);
          self._pumpResume();
        };
        var p;
        try { p = self._resumeRunOne(j); } catch (e) { p = null; }
        // 3038: salió → se olvida su cuenta; se rindió → la siguiente reanudación espera más (ver resumeOutgoingTransfers)
        var ok = function() { self._resumeFail.delete(j.tx.transferId); done(); };
        var fail = function() {
          var f = self._resumeFail.get(j.tx.transferId) || { n: 0 };
          f.n++; f.at = Date.now(); self._resumeFail.set(j.tx.transferId, f);
          if (self._resumeFail.size > 500) self._resumeFail.delete(self._resumeFail.keys().next().value);
          done();
        };
        if (p && typeof p.then === 'function') p.then(ok, fail); else done();
      })(job);
    }
  },
  // #dueño 07-11 (lentitud BT): ¿aplazar AHORA un respaldo de fondo (Fénix)? Sí si el usuario tiene la radio (app en PRIMER
  // PLANO) o si el enlace del destino está atascado/muerto (_bleCongested). Así un respaldo no compite con el usuario ni
  // martilla un enlace malo, ni siquiera al REANUDAR. No aplica a lo del usuario (texto/foto/archivo). En el simulador y si
  // falta la señal de primer plano, _foreground es undefined → no aplaza (el respaldo corre).
  _fenixDeferNow(deviceId) {
    var ble = this.ble;
    if (!ble) return false;
    if (ble._foreground === true) return true;
    if (typeof ble._callUsesBle === 'function' ? ble._callUsesBle() : (typeof ble._callBusy === 'function' && ble._callBusy())) return true; // 3058/3097: en llamada POR Bluetooth, la radio es de la llamada
    return !!(typeof ble._bleCongested === 'function' && ble._bleCongested(deviceId));
  },
  // Reanuda UNA transferencia: resuelve el mejor camino de AHORA y reconstruye el contenido perezosamente (no todas de
  // golpe). Devuelve la promesa del envío (o null si no hay camino). El registro se borra al entregarse.
  _resumeRunOne(job) {
    var self = this, cid = job.cid, tx = job.tx, contactDeviceId = job.contactDeviceId;
    if (self._blobBusyFor(tx.transferId, cid)) return null;   // 3030: pudo pasar al buzón de archivos mientras esperaba en la cola
    // v3.10.0: por el mejor camino de ahora (Wi-Fi, Bluetooth); el guardado puede ser un Wi-Fi que ya no está
    var content = tx.chunks.map(function(c) { return (typeof c === 'string') ? c : (c.data || c.d || ''); }).join('');
    var isFileTx = tx.type === 'file';   // FIX: respetar tx.type (una foto/vídeo interrumpido no se reenvía como texto plano)
    // #dueño 06-11: un archivo grande (> tope de Bluetooth) prefiere internet/Wi-Fi antes que un Bluetooth listo (si no,
    // se arrastra por BT y no llega: un APK de 25 MB = 148 mil trozos). preferNet solo para archivos grandes.
    var bigFile = isFileTx && content.length > BLE_FILE_MAX_CHARS;
    var best = (self.ble && typeof self.ble._resolveDeviceIdForNexoId === 'function') ? self.ble._resolveDeviceIdForNexoId(cid, bigFile) : null;
    var devId = best || tx.deviceId || contactDeviceId;
    if (_isLanDevice(devId) && !(self.ble && self.ble.lan && self.ble.lan.canReach(cid))) devId = contactDeviceId;
    // Por internet: texto/medios en línea; archivos por Tor/Wi-Fi (filesOk) o al buzón de los relés (mailboxOk)
    var net = self.ble && self.ble.net;
    // 2970: un archivo por internet solo con el contacto EN LÍNEA (canReach); el buzón de relés no sirve para un flujo con
    // ventanas de confirmación (ver _sendFileBest). Los ≤ 5 MB a un ausente van por el buzón de archivos desde el reenvío de pendientes.
    if (_isNetDevice(devId) && !(net && typeof net.canReach === 'function' && net.canReach(cid) && (tx.type === 'file' ? (net.filesOk(cid) || net.mailboxFilesOk(cid)) : true))) devId = contactDeviceId;
    if (!devId) return null;
    // #dueño 09-11 (diagnóstico S24 12:15, APK de 35 MB a la tablet por Bluetooth): un archivo que NO cabe por Bluetooth y cuyo
    // único camino de AHORA es un Bluetooth queda ⏳ SIN sellarlo ni partirlo (antes: sendFile lo sellaba entero para que
    // ChatStream lo aplazara igual, en CADA reanudación → memoria y CPU en cada vuelta). Lo re-rutea el evento de enlace
    // (Wi-Fi/internet) como hasta ahora; un puente Jump (fwd) no aplica (ChatStream tampoco lo aplaza).
    if (bigFile && !_isNetDevice(devId) && !_isLanDevice(devId) && !(tx.meta && tx.meta.fwd)) { console.log('[BleAckSystem] ' + tx.transferId + ': archivo grande, no cabe por Bluetooth: espera Wi-Fi/internet (sin sellar ni partir)'); return null; }
    // #dueño 07-11 (lentitud BT): NO reanudar un respaldo de fondo (Fénix) si el usuario tiene la radio (app en primer plano)
    // o si el enlace del destino está atascado/muerto. Se queda PENDIENTE (como «sin camino») y se reintenta cuando convenga; la
    // redundancia de Fénix cubre el respaldo. Tapa el hueco del diagnóstico: la REANUDACIÓN saltaba el freno que el respaldo ya
    // respeta al elegir (2951/2952). Solo afecta a Fénix: lo del usuario (texto/foto/archivo) se reanuda siempre.
    if ((tx.type === 'fenix' || (tx.meta && tx.meta.type === 'fenix')) && self._fenixDeferNow(devId)) return null;
    // 3083 (diagnóstico S24 14-11 08:09, resumeciego.js): un envío directo por Bluetooth a un contacto SIN enlace listo (la tablet,
    // ausente desde ayer, en su dirección guardada) arrancaba en cada vuelta de reenvío de OTRO contacto: 13 escrituras a ciegas, «Write
    // fallo ~6 s… descartado» en el nativo y «se rinde» a los 10 s, mientras lo del otro esperaba. Ahora espera sin escribir: lo reanuda
    // su propio enlace al quedar listo (el reenvío de sus pendientes llama con él) o un camino de internet/Wi-Fi.
    if (!_isNetDevice(devId) && !_isLanDevice(devId) && !(tx.meta && (tx.meta.dst || tx.meta.fwd)) && self.ble && typeof self.ble._bleReadyFor === 'function' && !self.ble._bleReadyFor(cid)) {
      self._resumeWaitLog = self._resumeWaitLog || new Map();
      var lw = self._resumeWaitLog.get(tx.transferId) || 0;
      if (Date.now() - lw > 600000) {
        self._resumeWaitLog.set(tx.transferId, Date.now());
        if (self._resumeWaitLog.size > 500) self._resumeWaitLog.delete(self._resumeWaitLog.keys().next().value);
        console.log('[BleAckSystem] ' + tx.transferId + ': ' + cid + ' sin enlace Bluetooth ahora: espera a que vuelva (no se escribe a ciegas)'); // i18n-ok: registro para el diagnóstico
      }
      return null;
    }
    // 3058: en llamada, una reanudación por Bluetooth espera a colgar (la radio es de la llamada; ble_messages._callRadioHold)
    if (!_isNetDevice(devId) && !_isLanDevice(devId) && self.ble && typeof self.ble._callRadioHold === 'function' && self.ble._callRadioHold(cid, 'la reanudación de ' + tx.transferId)) return null;
    // Ronda 2766: a quién va (es su chat): si la conexión resulta ser de otro, no sale por ella
    var txMeta = Object.assign({}, tx.meta || {}, (tx.meta && tx.meta.dst) ? {} : { to: cid });
    var resumePromise = isFileTx
      ? self.sendFile(devId, tx.transferId, content, txMeta)
      : self.sendChunkedMessage(devId, content, txMeta, tx.transferId, (tx.meta && tx.meta.seq));
    return resumePromise.then(function() {
      if (window.vaultRemoveOutgoingTransfer) window.vaultRemoveOutgoingTransfer(cid, tx.transferId).catch(function(){});
    });
  },
  // v3.4.0: hasta la 2701 el registro de una transferencia terminada no se borraba y al abrir la app o
  // reconectar se volvían a enviar textos largos, fotos y vídeos ya entregados (hasta 50). Los que ya
  // constan como entregados en el historial (o HD enviado) se borran aquí sin reenviarlos.
  _dropDeliveredTransfers(cid, list) {
    var self = this;
    if (!window.vaultLoadMessages) return Promise.resolve(list);
    return window.vaultLoadMessages(cid).catch(function() { return []; }).then(function(msgs) {
      var byId = {};
      (msgs || []).forEach(function(m) { var id = m.msgId || m.messageId || m.id; if (id) byId[id] = m; });
      return list.filter(function(tx) {
        var isHd = /_hd$/.test(tx.transferId);
        var m = byId[isHd ? tx.transferId.replace(/_hd$/, '') : tx.transferId];
        var done = !!m && (isHd ? m.hdStatus === 'sent' : (m.status === 'delivered' || m.status === 'read'));
        // 3033: una acción oculta que se reanuda va callada (sin «mensaje nuevo» en el otro; ver ble_messages._markHiddenQuiet)
        if (!done && m && m.hidden === true && self.ble && typeof self.ble._markHiddenQuiet === 'function') self.ble._markHiddenQuiet([m]);
        // 3033: la transferencia guardada de una copia vieja de un estado (foto dentro, 424–779 trozos) se borra sin reanudarla
        if (!done && m && !isHd && m.hidden === true && typeof window.NEXO_staleStatusCopy === 'function' && window.NEXO_staleStatusCopy(m, cid)) done = true;
        // 3041 (diagnóstico Honor …c1ee 13-11 21:25: «Resume: 2/3/4 outgoing» de 766 trozos a 5 contactos en cada arranque, el
        // Bluetooth atascado): la copia vieja del estado ya se había borrado del historial (3033) pero su transferencia quedó
        // HUÉRFANA y, sin mensaje con qué compararla, se reanudaba siempre. Una transferencia de un estado sin su mensaje se borra.
        if (!done && !m && !isHd && _isStatusTx(tx)) { console.log('[ESTADO] Transferencia huérfana de un estado para ' + cid + ' (' + tx.transferId + '): se borra sin reanudar'); done = true; }
        if (done && window.vaultRemoveOutgoingTransfer) window.vaultRemoveOutgoingTransfer(cid, tx.transferId).catch(function(){});
        return !done;
      });
    });
  },
  // done(ok): ronda 2767, si se pudo leer (la confirmación final espera a esto)
  // wasE2e: ronda 2768, el texto ya viene descifrado (llegó cifrado de extremo a extremo)
  _dispatchChunkedMessageComplete(senderId, content, meta, deviceId, msgId, done, wasE2e) {
    var self = this;
    if (e2eAnyEncrypted(content)) {
      var from = meta.fr || senderId;
      e2eOpenText(from, content, self._inAd(from, msgId)).then(function(r) {
        if (done) done(true);
        if (r.dup) return;
        var go = function() { self._dispatchChunkedMessageComplete(senderId, r.text, meta, deviceId, msgId, null, true); };
        var v = self._checkSender(from, r);
        if (v === 'drop') return;
        if (v === 'hold') { self._hold(from, go, msgId); return; }
        go();
      }).catch(function(e) {
        if (e && e.code === 'DUP') { if (done) done(true); return; }
        console.warn('[E2E] No se pudo descifrar el mensaje ' + msgId + ':', e && e.message);
        // 3069: desatasco (resync.js): apuntarlo para pedirlo otra vez (y, si era de una sesión ya hecha, puede ser un atasco)
        if (typeof window.NEXO_resyncNote === 'function' && e && (e.code === 'DESYNC' || (e.code === 'BAD' && /^E2:[^:.]+\.[^:.]+\.[^:.]+:/.test(content)))) window.NEXO_resyncNote(from, msgId, e.code);
        if (done) done(false);
      });
      return;
    }
    if (done) done(true);
    // Ronda 2768 (seguridad): sin cifrar y dice ser de un contacto: lo escribió otro (ver ble_messages._prePayload)
    if (!wasE2e && self._plainFromContact(meta.fr || senderId)) { console.warn('[E2E] Texto largo sin cifrar que dice ser de ' + _normId(meta.fr || senderId) + ': descartado'); return; }
    // 3177 (prueba de ciudad 17-11): un PUNTERO al buzón de archivos (foto de grupo: su sobre es largo y por Bluetooth llega por trozos)
    // se baja antes de guardarse, igual que por el camino corto (ble_receive._routeBlobPointer). Antes se guardaba la foto rota ('ptr').
    var bi = self.ble, fromP = meta.fr || senderId, midP = msgId || meta.msgId, viaHop = Number(meta.hp) > 0;
    if (bi && typeof bi._routeBlobPointer === 'function' && deviceId && typeof content === 'string' && content.indexOf('ptr') >= 0) {
      var dataP = { deviceId: deviceId, source: 'ble', timestamp: meta.rxTs || meta.ts || Date.now() };
      if (viaHop) { dataP.viaRelay = true; dataP.relayOrigin = _normId(fromP); }
      if (bi._routeBlobPointer(deviceId, fromP, midP, content, null, dataP, viaHop ? _normId(fromP) : null)) return;
    }
    try {
      window.dispatchEvent(new CustomEvent('nexo:ble:messageReceived', {
        detail: {
          deviceId: meta.hp > 0 ? null : deviceId, deviceUUID: meta.fr || senderId,
          content: content, senderName: meta.f || 'NEXO',
          senderNexoId: meta.fr || senderId, messageId: msgId || meta.msgId,
          source: 'ble', timestamp: meta.rxTs || meta.ts || Date.now(), seq: meta.seq || 0, e2e: !!wasE2e
          // FIX v3.2.13: sin fromVault; con fromVault main.js no lo guardaba y se perdía si el chat estaba cerrado
        }
      }));
    } catch (e) {}
  },
  _dispatchStatus(msgId, status) {
    if (msgId && (status === 'delivered' || status === 'read')) {
      this._done.set(msgId, Date.now());
      if (this._done.size > 3000) this._done.delete(this._done.keys().next().value);
    }
    try { window.dispatchEvent(new CustomEvent('nexo:ble:ackStatus', { detail: { msgId: msgId, status: status } })); } catch (e) {}
  },
  // Ronda 2767: ya confirmado en esta sesión (un reenvío que arrancó antes no lo vuelve a mandar)
  isDone(msgId) { return !!msgId && this._done.has(msgId); },
  // P6 (dueño 01-11): el MISMO mensaje llegó ENTERO por otro camino (internet/Jump/BLE corto). Cierra un reensamblado BLE
  // que quedó a medias con ese msgId para que NO caduque a los 120 s con un «Assembly timeout» (y un falso «fallo» de un
  // mensaje que SÍ llegó). Lo llama ble_messages.onPayloadReceived al recibir/deduplicar un mensaje completo. Devuelve true
  // si había un reensamblado que cerrar.
  dropAssembly(msgId) {
    if (!msgId) return false;
    var buf = this.incomingBuffers.get(msgId);
    if (!buf) return false;
    if (buf.assemblyTimer) clearTimeout(buf.assemblyTimer);
    if (buf.ackTimer) clearTimeout(buf.ackTimer);
    this.incomingBuffers.delete(msgId);
    console.log('[BleAckSystem] reensamblado de ' + msgId + ' cerrado: el mensaje llegó entero por otro camino');
    return true;
  },
  _dispatchFileProgress(fileId, sent, total, status, percent, extra) {
    try { window.dispatchEvent(new CustomEvent('nexo:ble:fileProgress', { detail: Object.assign({ fileId: fileId, sent: sent, total: total, status: status, percent: percent || 0, direction: 'out' }, extra || {}) })); } catch (e) {}
  },
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
  },
  // Ronda 2768: ¿algo sin cifrar que dice ser de un contacto? (lo suyo siempre llega cifrado: lo escribió otro)
  _plainFromContact(fr) {
    return !!(this.ble && typeof this.ble._isKnownSender === 'function' && this.ble._isKnownSender(fr));
  },
  // wasE2e: ronda 2768, el archivo ya viene descifrado
  _dispatchFileComplete(fileId, data, meta, done, wasE2e) {
    var self = this;
    if (e2eAnyEncrypted(data)) {
      var dm = Object.assign({}, meta || {});
      var from = dm.fr || dm.senderNexoId || dm.fromNexoId;
      Promise.all([
        e2eOpenToB64(from, data, self._inAd(from, fileId)),
        e2eAnyEncrypted(dm.thumb) ? e2eOpenToB64(from, dm.thumb, self._inAd(from, fileId + '#t')).then(function(t) { return t.b64; }, function() { return null; }) : dm.thumb,
        e2eAnyEncrypted(dm.name) ? e2eOpenText(from, dm.name, self._inAd(from, fileId + '#n')).then(function(t) { return t.text; }, function() { return null; }) : dm.name,
        e2eAnyEncrypted(dm.xs) ? e2eOpenText(from, dm.xs, self._inAd(from, fileId + '#x')).then(function(t) { return t.text; }, function() { return null; }) : null
      ]).then(function(r) {
        if (done) done(true);
        if (r[0].dup) return;
        dm.thumb = r[1] || null;
        dm.name = r[2] || undefined;
        // 4A (23-11): comentario y «ver una vez» sellados (lo de la cabecera en claro, si lo hubiera, se ignora)
        if (r[3]) { try { var xo = JSON.parse(r[3]); dm.caption = (typeof xo.cp === 'string' && xo.cp) ? xo.cp.substring(0, 1000) : undefined; dm.once = xo.o1 === 1; } catch (e) {} }
        else if (dm.xs) dm.once = true; // no se pudo abrir: por si era «ver una vez», se trata como tal (nunca al revés)
        delete dm.xs;
        var go = function() { self._dispatchFileComplete(fileId, r[0].b64, dm, null, true); };
        var v = self._checkSender(from, r[0]);
        if (v === 'drop') return;
        if (v === 'hold') { self._hold(from, go, fileId); return; }
        go();
      }).catch(function(e) {
        if (e && e.code === 'DUP') { if (done) done(true); return; }
        console.warn('[E2E] No se pudo descifrar el archivo ' + fileId + ':', e && e.message);
        if (done) done(false);
      });
      return;
    }
    if (done) done(true);
    try {
      var m = meta || {};
      var sender = m.senderNexoId || m.fromNexoId || m.fr || null;
      if (!wasE2e && self._plainFromContact(sender)) { console.warn('[E2E] Archivo sin cifrar que dice ser de ' + _normId(sender) + ': descartado'); return; }
      // Fénix: fragmentos y respuestas de recuperación (no son mensajes del chat)
      if (m.type === 'fenix') { if (self.ble && self.ble.fenix) self.ble.fenix.onFile(fileId, data, m, sender); return; }
      // 3032: la media grande de un ESTADO (la pidió este teléfono con «sm»): a estados.js, nunca al chat
      if (m.type === 'stmedia') { try { if (typeof window.NEXO_statusMediaIn === 'function') window.NEXO_statusMediaIn(sender, m, data); } catch (e) {} return; }
      if (self.ble && typeof self.ble._citaResolved === 'function') self.ble._citaResolved(fileId); // Fase D (2972): si había un marcador de cita, se cumplió
      window.dispatchEvent(new CustomEvent('nexo:ble:fileComplete', {
        detail: {
          fileId: fileId,
          data: data,
          meta: m,
          senderNexoId: sender
        }
      }));
    } catch (e) {}
  },
  _startCleanupInterval() {
    var self = this;
    setInterval(function() {
      var now = Date.now();
      self.incomingBuffers.forEach(function(buf, msgId) {
        if (now - buf.lastActivity > Math.max(self.maxFragmentAge, _assemblyTimeoutFor(_isNetDevice(buf.deviceId), buf.isChat, buf.total))) {
          if (buf.assemblyTimer) clearTimeout(buf.assemblyTimer);
          self.incomingBuffers.delete(msgId);
        }
      });
      // Ronda 2767 (revisión): por inactividad (10 min sin confirmaciones), no por el tiempo desde el principio: un vídeo
      // HD o un archivo grande por un Bluetooth lento se cortaba a los 10 min aunque avanzara (se quedaba en "○ 44%")
      self.outgoingStreams.forEach(function(stream, msgId) {
        var idleMax = (stream.type === 'file' && _isNetDevice(stream.deviceId) && stream.total >= NET_BIG_MIN_CHUNKS) ? NET_BIG_IDLE_MS : self.maxFragmentAge * 2; // 3005
        if (now - (stream.lastAckAt || stream.startTime) > idleMax) { stream.abort(); self.outgoingStreams.delete(msgId); }
      });
      self.pendingAcks.forEach(function(entry, msgId) {
        if (now - entry.sentAt > self.maxFragmentAge) { clearTimeout(entry.timer); self.pendingAcks.delete(msgId); try { entry.reject(new Error('Timeout global')); } catch(e) {} }
      });
      self.completedMessages.forEach(function(data, msgId) {
        if (now > data.expireAt) self.completedMessages.delete(msgId);
      });
    }, 30000);
  },
};
