import { _isLanDevice, _isNetDevice, _normMac, _normId, BLE_FILE_MAX_CHARS, NET_TOR_PREFER_BYTES, BLE_HD_MAX_CHARS, PTR_ONE_MAX, _isBulkFileData, BIGX_MIN_CHARS, _bigxUserId } from './ble_ack_shared.js';
import { NET_MAX_B64_BYTES } from './media_limits.js';
import { loadBlobOut, pointerReusable, saveBlobOut, stageBlob, _b64ToBytes as _blobB64ToBytes } from '../net/blob_mailbox.js';
import { ChatStream } from './chat_stream.js';
// Métodos de BleAckSystem: ENVÍO de archivos: Wi-Fi Direct, buzón de archivos en relés, cola de archivos por Bluetooth.
// Reestructuración 15-11: movidos TAL CUAL desde ble_ack.js; ble_ack.js los une a la clase (como métodos normales).
export const ackFiles = {
  // v3.13.0: el otro teléfono entiende trozos binarios (lo dice con 'bf' en sus acks y pings)
  markBin(deviceId, off) {
    if (!deviceId || _isLanDevice(deviceId) || _isNetDevice(deviceId)) return;
    if (!this._binPeers) this._binPeers = new Set();
    var nx = this._resolveNexoId(deviceId), keys = [_normMac(deviceId)];
    if (nx) keys.push(_normId(nx));
    var set = this._binPeers;
    keys.forEach(function(k) { if (off) set.delete(k); else set.add(k); });
  },
  peerBin(deviceId) {
    if (!this._binPeers || !deviceId || _isLanDevice(deviceId) || _isNetDevice(deviceId)) return false;
    if (this._binPeers.has(_normMac(deviceId))) return true;
    var nx = this._resolveNexoId(deviceId);
    return !!(nx && this._binPeers.has(_normId(nx)));
  },
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
  },
  // v3.6.0: Wi-Fi Direct primero si se puede (mucho más rápido); si falla, Bluetooth
  _sendFileBest(deviceId, fileId, data, meta) {
    var self = this, wd = self.ble && self.ble.wifiDirect;
    // #dueño 07-11 (REGLA ÚNICA de caminos, en el ÚNICO embudo por el que pasan TODOS los envíos de archivo): un archivo
    // PESADO (> tope de Bluetooth) nunca se arrastra por Bluetooth si hay algo mejor. Aunque el que llama ya haya resuelto
    // un enlace Bluetooth sin pedir «preferir internet» (p. ej. el reintento de pendientes, _resendPendingMessages, que
    // resolvía Bluetooth sin preferNet), aquí se RE-RESUELVE con preferNet para un archivo grande en un envío DIRECTO (no
    // Jump/puente): si el contacto tiene Wi-Fi de la misma red o internet, se va por ahí; si no, el propio flujo de abajo
    // prueba Wi-Fi Direct antes que Bluetooth crudo. Así NINGÚN camino puede saltarse la regla (antes cada uno decidía suelto).
    if (data && data.length > BLE_FILE_MAX_CHARS && !_isNetDevice(deviceId) && !_isLanDevice(deviceId) &&
        !(meta && (meta.dst || meta.fwd)) && self.ble && typeof self.ble._resolveDeviceIdForNexoId === 'function') {
      try {
        var cidHeavy = (meta && meta.to) || self._resolveNexoId(deviceId);
        if (cidHeavy) {
          var better = self.ble._resolveDeviceIdForNexoId(cidHeavy, true);
          if (better && (_isNetDevice(better) || _isLanDevice(better))) {
            console.log('[BleAckSystem] archivo grande re-ruteado de Bluetooth a ' + (_isLanDevice(better) ? 'Wi-Fi' : 'internet') + ' (regla única de caminos) fileId=' + fileId);
            deviceId = better;
          }
        }
      } catch (e) {}
    }
    // v3.10.0: misma red Wi-Fi: por ahí directamente (rápido, sin montar grupo; también el vídeo original)
    if (_isNetDevice(deviceId)) {
      // Ronda 2780 (pedido del dueño): fotos y archivos medianos SIEMPRE por internet: por Tor directo/Wi-Fi si está en
      // línea (filesOk), o al buzón de los relés si no (mailboxOk), bajo el tope. Si ni eso, queda pendiente y se reintenta.
      var net = self.ble && self.ble.net, cid = self._resolveNexoId(deviceId);
      // #dueño 06-11: un archivo GRANDE por internet (> ~12 MB) prefiere Tor DIRECTO (los relés no aguantan 25 MB). Se
      // marca al contacto y se arranca Tor a demanda (no hace nada si el usuario apagó Tor). Lo chico/mediano sigue por
      // relés (rápido). Con el latido (2930/2931) manteniendo despiertos a los dos, se forma el Tor directo y el archivo va por ahí.
      var torBig = (typeof window !== 'undefined' && Number(window.NEXO_NET_TOR_PREFER_BYTES)) || NET_TOR_PREFER_BYTES;
      if (net && typeof net.preferTorFor === 'function' && cid && data && data.length > torBig) net.preferTorFor(cid);
      // 2970 (diagnóstico del dueño S24 09-11): acá `data` YA viene SELLADO de extremo a extremo (sendFile sella antes de
      // elegir camino), así que el buzón de archivos (Fase B) NO se decide aquí: se decide ANTES de sellar, en el embudo
      // bleInterface.sendFile y en el reenvío de pendientes (ble_messages.js). El enganche que estaba acá mandaba al buzón
      // de archivos contenido sellado y hasta segmentos de Fénix (reanudaciones) → «atob … not correctly encoded».
      // Y un flujo por relés a un contacto AUSENTE no sirve de nada (la ventana espera confirmaciones EN VIVO: se quedaba
      // «Ventana sin ACK con el enlace caído» con el archivo entero en memoria): por internet solo si el contacto está EN
      // LÍNEA (canReach); si no, queda ⏳ pendiente y lo reanuda _netUp/_netOnline (los ≤ 5 MB ya fueron al buzón de archivos).
      var netOk = net && typeof net.canReach === 'function' && net.canReach(cid) && (net.filesOk(cid) || (net.mailboxFilesOk(cid, data && data.length) && data && data.length <= NET_MAX_B64_BYTES));
      if (!netOk) {
        var en = new Error('Contacto no disponible: queda pendiente'); en.code = 'PEER_ABSENT';
        return Promise.reject(en);
      }
      return self._sendFileJS(deviceId, fileId, data, meta);
    }
    if (_isLanDevice(deviceId)) return self._sendFileJS(deviceId, fileId, data, meta);
    try { if (data && wd && !(meta && meta.dst) && typeof wd.noteChoice === 'function') wd.noteChoice(deviceId, data.length); } catch (e) {} // 3258: por qué sí/no Wi-Fi Direct (contador del día)
    // 3261 (diseño del dueño 20-11): este intento por Wi-Fi Direct viene del PLAN POR TIEMPO (el contacto está en línea por internet y
    // cerca por Bluetooth: ble_blobs.sendFile). Si Wi-Fi Direct no sale, el archivo NO se arrastra por Bluetooth: vuelve a internet.
    var planned = !!(self._wdPlan && self._wdPlan.has(fileId));
    if (planned) self._wdPlan.delete(fileId);
    var planFail = function(why) { var ep = new Error('Wi-Fi Direct no salió (' + why + ')'); ep.code = 'WD_PLAN_FAILED'; return ep; };
    if (planned && (!data || !wd || !wd.eligible(deviceId, data.length))) return Promise.reject(planFail('no disponible'));
    if (!data || !wd || (meta && meta.dst) || !wd.eligible(deviceId, data.length)) {
      // Vídeo original pensado para Wi-Fi Direct que ya no puede ir por ahí: la app lo manda como previa + HD
      if (meta && meta.wdOnly) { var e0 = new Error('Wi-Fi Direct no disponible'); e0.code = 'WD_FAILED'; return Promise.reject(e0); }
      return self._sendFileL2OrJS(deviceId, fileId, data, meta);
    }
    var running = self.outgoingStreams.get(fileId);
    if (running && !running.aborted && running._promise) return running._promise;
    self._dispatchFileProgress(fileId, 0, 1, 'sending', 1);
    return wd.send(deviceId, fileId, data, self._fileMeta(meta, data.length)).then(function() {
      self._dispatchStatus(fileId, 'delivered');
      self._dispatchFileProgress(fileId, 1, 1, 'delivered', 100);
    }, function(err) {
      if (planned) throw planFail((err && err.message) || 'error'); // 3261: de vuelta a internet (lo decide ble_blobs.sendFile)
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
      return self._sendFileL2OrJS(deviceId, fileId, data, meta);
    });
  },
  // 3288 (COLA 14): por Bluetooth, cuando Wi-Fi Direct no puede (Wi-Fi apagado, el otro no lo tiene, falló hace poco: lo normal en un
  // vagón o un festival) o acaba de fallar, lo MEDIANO va por el canal rápido del Bluetooth (L2CAP, ~1 MB/s contra ~17 KB/s en trozos)
  // si los dos lo tienen (l2_fast.js). Si no sale —por lo que sea— va en trozos como siempre: este atajo nunca frena un envío.
  // Wi-Fi Direct sigue yendo primero cuando puede (decisión del dueño 12-11).
  _sendFileL2OrJS(deviceId, fileId, data, meta) {
    var self = this, l2 = self.ble && self.ble.l2Fast;
    // (un reintento del mismo archivo mientras el canal rápido lo está mandando espera a ese mismo envío: no sale dos veces)
    if (self._l2Pending && self._l2Pending.has(fileId)) return self._l2Pending.get(fileId);
    if (!data || !l2 || (meta && (meta.dst || meta.wdOnly)) || (self._l2Tried && self._l2Tried.has(fileId)) || !l2.eligible(deviceId, data.length)) return self._sendFileJS(deviceId, fileId, data, meta);
    var running = self.outgoingStreams.get(fileId);
    if (running && !running.aborted && running._promise) return running._promise;
    (self._l2Tried || (self._l2Tried = new Set())).add(fileId);
    if (self._l2Tried.size > 200) self._l2Tried.delete(self._l2Tried.values().next().value);
    self._dispatchFileProgress(fileId, 0, 1, 'sending', 1);
    var p = l2.send(deviceId, fileId, data, self._fileMeta(meta, data.length)).then(function() {
      self._l2Pending.delete(fileId);
      self._dispatchStatus(fileId, 'delivered');
      self._dispatchFileProgress(fileId, 1, 1, 'delivered', 100);
    }, function() { self._l2Pending.delete(fileId); return self._sendFileJS(deviceId, fileId, data, meta); });
    (self._l2Pending || (self._l2Pending = new Map())).set(fileId, p);
    return p;
  },
  // ===== Fase B/C (2969/2971): BUZÓN DE ARCHIVOS en relés — ver src/net/blob_mailbox.js =====
  // Registro de blobs salientes: fileId → { expires, rec (sk, ids, relays), ptr, to: { cid: 'sent'|'delivered' }, byRef, group }.
  // Fase C: UN archivo se cifra y sube UNA sola vez; varios destinatarios (grupo, varios chats, reenvíos) comparten el mismo
  // blob y reciben solo el puntero. Un puntero VIGENTE guardado en el mensaje de origen (meta.blobPtr) se reenvía POR REFERENCIA.
  _blobRecord(fileId) {
    if (!this._blobOut) this._blobOut = loadBlobOut();
    var r = this._blobOut.get(fileId);
    return (r && r.expires > Date.now()) ? r : null;
  },
  // 3030: ¿este archivo ya va por el buzón de archivos de este contacto? 'subiendo' | 'en su buzón' | ''
  _blobBusyFor(fileId, cid) {
    if (!fileId) return '';
    if (this._blobOutRunning && this._blobOutRunning.has(fileId)) return 'subiendo';
    var r = this._blobRecord(fileId), k = _normId(cid);
    return (r && r.to && k && r.to[k]) ? 'en su buzón' : '';
  },
  _stageBlobOnce(fileId, data, meta) {
    var self = this, net = self.ble && self.ble.net;
    var live = self._blobRecord(fileId);
    if (live && live.ptr) return Promise.resolve(live);
    // 3281: el teléfono (bandeja de salida nativa) lo tenía a su cargo con la app dormida: si ya subió todos los trozos, se sigue con eso
    // (no se vuelve a subir nada); si no, se olvida y lo sube la app de cero
    if (live && live.natPtr) return self._blobNatTake(fileId, live).then(function(rec) { return rec || self._stageBlobOnce(fileId, data, meta); });
    var ref = meta && meta.blobPtr;
    if (pointerReusable(ref)) {
      var recRef = { expires: ref.expires * 1000, rec: null, ptr: ref, to: {}, byRef: true };
      self._blobOut.set(fileId, recRef); saveBlobOut(self._blobOut);
      console.log('[BLOB] ' + fileId + ' va POR REFERENCIA (el mismo archivo ya está en los relés, huella ' + String(ref.hash).substring(0, 12) + '…): no se vuelve a subir nada');
      return Promise.resolve(recRef);
    }
    if (!self._blobOutRunning) self._blobOutRunning = new Map();
    if (self._blobOutRunning.has(fileId)) return self._blobOutRunning.get(fileId);
    var type = (meta && meta.type) || 'file';
    self._dispatchFileProgress(fileId, 0, 1, 'sending', 1);
    console.log('[BLOB] ' + fileId + ' (' + type + ', ' + Math.round(data.length * 3 / 4 / 1024) + ' KB) → buzón de archivos: cifro una vez y subo trozos a los relés');
    var tUp = Date.now(); // 3081: velocidad de subida al buzón de archivos
    var p = stageBlob(net, data, { onProgress: function(i, n) { self._dispatchFileProgress(fileId, i, n, 'sending', Math.max(1, Math.round(95 * i / n))); } }).then(function(res) {
      try { if (typeof window.NEXO_noteSpeed === 'function') window.NEXO_noteSpeed('buzon', 'out', Math.round(data.length * 3 / 4), Date.now() - tUp); } catch (e) {}
      var rec = { expires: res.pointer.expires * 1000, rec: res.outRecord, ptr: res.pointer, to: {} };
      self._blobOut.set(fileId, rec); saveBlobOut(self._blobOut);
      console.log('[BLOB] ' + fileId + ': ' + res.pointer.chunks.length + ' trozos en ' + res.pointer.relays.length + ' relés (réplica mínima ' + res.replication + ')');
      return rec;
    });
    self._blobOutRunning.set(fileId, p);
    var clear = function() { self._blobOutRunning.delete(fileId); };
    p.then(clear, clear);
    return p;
  },
  // 3281: ¿qué hizo el nativo con el archivo que se le dejó (ble_outbox._outboxFileItem)? Resuelve con el registro ya «en los relés»
  // (y, si también dejó el aviso en el buzón, anotado como mandado a ese contacto) o con null (no terminó: se olvida y lo retira).
  _blobNatTake(fileId, live) {
    var self = this, ble = self.ble, pl = ble && ble.nativePlugin;
    var drop = function(why) {
      if (self._blobOut.get(fileId) === live) { self._blobOut.delete(fileId); saveBlobOut(self._blobOut); }
      try { if (ble && typeof ble._outboxDrop === 'function') ble._outboxDrop(fileId, true); } catch (e) {}
      console.log('[BLOB] ' + fileId + ': el teléfono no terminó de subirlo con la app dormida (' + why + '): lo sube la app');
      return null;
    };
    if (!pl || typeof pl.netOutboxList !== 'function') return Promise.resolve(drop('sin bandeja nativa'));
    return Promise.resolve().then(function() { return pl.netOutboxList({}); }).then(function(r) {
      var x = ((r && r.items) || []).filter(function(y) { return y && y.id === fileId; })[0];
      if (!x || !(x.ck > 0) || x.up < x.ck) return drop(x ? (x.up + ' de ' + x.ck + ' trozos') : 'ya no lo tiene'); // i18n-ok: registro
      live.ptr = live.natPtr; delete live.natPtr;
      if (x.ok && live.nat) { live.to = live.to || {}; if (!live.to[live.nat]) live.to[live.nat] = 'sent'; }
      saveBlobOut(self._blobOut);
      console.log('[BLOB] ' + fileId + ': el teléfono ya subió sus ' + x.ck + ' trozo(s) con la app dormida' + (x.ok ? ' y dejó el aviso en el buzón' : '') + ': no se vuelve a subir');
      try { if (ble && typeof ble._outboxDrop === 'function') ble._outboxDrop(fileId, true); } catch (e) {} // desde aquí sigue la app (el aviso, la ✓✓)
      return live;
    }).catch(function() { return drop('no contestó'); });
  },
  // El puntero (chiquito, E2E) a UN destinatario por su buzón normal; se anota a quién fue (la limpieza espera a TODOS)
  _sendBlobPointer(cid, fileId, rec, meta) {
    var self = this, type = (meta && meta.type) || 'file';
    var metaWire = Object.assign({}, meta || {}); delete metaWire.to; delete metaWire.dst; delete metaWire.fwd; delete metaWire.blobPtr;
    var att = { type: 'attachment', attachmentType: type, payload: 'ptr', meta: Object.assign({}, metaWire, { ptr: 1, size: rec.ptr.raw }), ptr: rec.ptr };
    // 3031 (diagnóstico S24 3021 12-11): el puntero tiene que caber en UN paquete del buzón (NET_TEXT_ONE, ya cifrado). Con la
    // miniatura de un vídeo dentro (~24 KB) no cabía: salía por trozos esperando confirmaciones de un contacto AUSENTE y al volver
    // la app se abortaba y se volvía a subir. La miniatura grande no viaja en el puntero: el que recibe la hace al bajar el vídeo.
    if (JSON.stringify(att).length > PTR_ONE_MAX && att.meta.thumb) {
      console.log('[BLOB] ' + fileId + ': la miniatura grande no va en el puntero (' + Math.round(String(att.meta.thumb).length / 1024) + ' KB): el puntero cabe en un paquete');
      delete att.meta.thumb;
    }
    console.log('[BLOB] ' + fileId + ': mando el puntero al buzón de ' + cid);
    return self.ble._sendViaNetMailbox(cid, JSON.stringify(att), fileId).then(function() {
      var cur = self._blobOut.get(fileId);
      if (cur) { cur.to = cur.to || {}; if (cur.to[cid] !== 'delivered') cur.to[cid] = 'sent'; saveBlobOut(self._blobOut); }
      self._dispatchStatus(fileId, 'sent'); // ✓ «en el buzón» (el icono limpio, no «✓ 99 %» de progreso)
    });
  },
  // Un reenvío futuro de este mensaje va por referencia: el puntero se guarda en el propio mensaje (meta.blobPtr)
  _rememberBlobPtr(chatId, fileId, ptr) {
    try { if (typeof window !== 'undefined' && window.vaultSetMessageFields) window.vaultSetMessageFields(chatId, fileId, { metaMerge: { blobPtr: ptr } }).catch(function() {}); } catch (e) {}
  },
  // Archivo a UN contacto (ausente, o en línea solo por internet con puntero reutilizable): resuelve con ✓ al guardarse el
  // puntero en un relé; el ✓✓ llega con el ack del receptor cuando bajó, verificó y descifró. Un puntero ya mandado a ese
  // contacto no se vuelve a mandar (reenvíos de pendientes).
  _sendFileViaBlobMailbox(cid, fileId, data, meta) {
    var self = this;
    var live = self._blobRecord(fileId);
    if (live && live.to && live.to[cid]) { console.log('[BLOB] ' + fileId + ' ya está en el buzón de ' + cid + ' (puntero vigente hasta ' + new Date(live.expires).toISOString() + '): no se vuelve a mandar'); return Promise.resolve(); }
    return self._stageBlobOnce(fileId, data, meta).then(function(rec) {
      self._rememberBlobPtr(cid, fileId, rec.ptr);
      // 3281: el nativo ya dejó también el aviso en su buzón con la app dormida: ✓ y nada más que mandar
      if (rec.to && rec.to[cid]) { self._dispatchStatus(fileId, 'sent'); return; }
      return self._sendBlobPointer(cid, fileId, rec, meta);
    }).catch(function(e) {
      // «⏳, nunca ✗» (contratos §7): si ningún relé guardó un trozo o se cayó internet a mitad, el archivo queda PENDIENTE y
      // se reintenta al volver internet (_netOnline → _resendPendingMessages → buzón de archivos); jamás se marca fallido
      console.warn('[BLOB] ' + fileId + ' no pudo subirse al buzón de archivos (' + ((e && e.message) || 'sin relés') + '): queda pendiente');
      self._dispatchStatus(fileId, 'pending');
      var en = new Error('Buzón de archivos no disponible: queda pendiente'); en.code = 'PEER_ABSENT';
      throw en;
    });
  },
  // Fase C: adjunto de GRUPO por referencia — se sube UNA vez y cada miembro recibe el puntero dentro del sobre del grupo
  // (groups.sendText). Devuelve el puntero. `members` = a quién se le manda (se espera a TODOS antes de borrar los trozos).
  stageBlobFor(msgId, data, meta, members) {
    var self = this;
    return self._stageBlobOnce(msgId, data, meta).then(function(rec) {
      rec.to = rec.to || {}; (members || []).forEach(function(nx) { var k = _normId(nx); if (k && !rec.to[k]) rec.to[k] = 'sent'; });
      rec.group = true; saveBlobOut(self._blobOut);
      return rec.ptr;
    });
  },
  // Al confirmar un receptor (✓✓) se anota; cuando confirmaron TODOS se pide a los relés que borren los trozos (NIP-09,
  // best-effort; la caducidad de 7 días es la garantía). Por referencia (los trozos son de otro envío) solo se olvida el registro.
  _blobCleanup(ackMsgId, acker) {
    var self = this;
    if (!self._blobOut || !self._blobOut.size) return;
    var key = self._blobOut.has(ackMsgId) ? ackMsgId : String(ackMsgId).split('_')[0]; // grupo: wid = gm…_<sufijo del miembro>
    var rec = self._blobOut.get(key);
    if (!rec) return;
    var who = _normId(acker || '');
    if (!who && rec.group) { var mm = /_([0-9a-z]{8})$/.exec(String(ackMsgId)); if (mm) who = 'nx' + mm[1]; }
    rec.to = rec.to || {};
    if (who) rec.to[who] = 'delivered'; else Object.keys(rec.to).forEach(function(k) { rec.to[k] = 'delivered'; });
    var left = Object.keys(rec.to).filter(function(k) { return rec.to[k] !== 'delivered'; });
    if (left.length) { saveBlobOut(self._blobOut); console.log('[BLOB] ' + key + ' confirmado por ' + (who || '?') + '; faltan ' + left.length + ' destinatario(s)'); return; }
    self._blobOut.delete(key); saveBlobOut(self._blobOut);
    var net = self.ble && self.ble.net;
    if (rec.byRef || !net || !rec.rec || !rec.rec.sk || typeof net.blobDeleteEvent !== 'function') { console.log('[BLOB] ' + key + ' confirmado por todos' + (rec.byRef ? ' (por referencia: los trozos son de otro envío y caducan solos)' : '')); return; }
    try {
      var ev = net.blobDeleteEvent(_blobB64ToBytes(rec.rec.sk), rec.rec.ids);
      net.publishEach(ev, 8000).then(function(ok) { console.log('[BLOB] ' + key + ' confirmado por todos: pedí borrar sus ' + rec.rec.ids.length + ' trozos (' + ok.length + ' relés aceptaron; igual caducan solos)'); });
    } catch (e) {}
  },
  _sendFileJS(deviceId, fileId, base64Data, meta) {
    var self = this;
    return new Promise(function(resolve, reject) {
      if (!base64Data || typeof base64Data !== 'string' || base64Data.length === 0) {
        reject(new Error('Datos de archivo vacios'));
        return;
      }
      // v3.3.3: reanudar (resumeOutgoingTransfers) una transferencia que sigue en curso creaba un segundo
      // flujo con el mismo id que pisaba al primero
      var running = self.outgoingStreams.get(fileId);
      if (running && !running.aborted && running._promise) {
        console.log('[BleAckSystem] sendFile ya en curso fileId=' + fileId);
        running._promise.then(resolve, reject);
        return;
      }
      // #129 parte 2: si ya está esperando en la cola de arranque (otro reenvío pidió lo mismo), no duplicar
      var isBle = !_isNetDevice(deviceId) && !_isLanDevice(deviceId);
      var q = self._fileStartQueue.get(fileId);
      if (q) {
        // 3180 (ciudad 17-11: fotos ⏳ toda la fase final con «Reenviando ADJUNTO» y ningún «sendFile START»): un reenvío por OTRO
        // camino (Wi-Fi, internet) o con hueco en el Bluetooth sale YA; antes solo se sumaba a la espera de la cola del Bluetooth
        if (isBle && self._bleFileSlots(deviceId, _isBulkFileData(base64Data)) >= self._maxBleFilesPerLink) {
          q.waiters.push({ resolve: resolve, reject: reject });
          q.deviceId = deviceId; q.data = base64Data; q.meta = meta; // espera con lo del último intento (su enlace y su sobre)
          return;
        }
        self._fileStartQueue.delete(fileId);
        console.log('[BleAckSystem] sendFile ' + fileId + ' esperaba en la cola del Bluetooth ocupado: sale ya por ' + (isBle ? 'Bluetooth (hay hueco)' : _isLanDevice(deviceId) ? 'Wi-Fi' : 'internet'));
        self._startQueued(deviceId, fileId, base64Data, meta, q.waiters.concat([{ resolve: resolve, reject: reject }]));
        return;
      }
      // #129 parte 2 (dueño 01-11): no inundar un enlace BLUETOOTH (MTU 23) arrancando muchas transferencias de
      // archivo a la vez. Máximo _maxBleFilesPerLink por enlace Bluetooth; las demás esperan en cola y arrancan al
      // liberarse un hueco, así los textos/acks/control (que NO se limitan) tienen aire y no se quedan en ○ detrás de
      // miles de trozos. net:/lan:/Wi-Fi Direct no tienen la cola nativa de Bluetooth → no se limitan.
      // #dueño 05-11: cupo POR CLASE. Un archivo GRANDE hace cola detrás de otro grande; uno CHICO (foto/sticker) hace
      // cola detrás de otro chico — PERO un chico arranca YA aunque haya un grande en curso (son clases distintas) → la
      // foto no espera a que termine el archivo grande, y a la vez NO se inunda el enlace con muchos (máx. 1 por clase, #129).
      if (isBle && self._bleFileSlots(deviceId, _isBulkFileData(base64Data)) >= self._maxBleFilesPerLink) {
        self._fileStartQueue.set(fileId, { deviceId: deviceId, data: base64Data, meta: meta, at: Date.now(), waiters: [{ resolve: resolve, reject: reject }] });
        console.log('[BleAckSystem] sendFile EN COLA (enlace Bluetooth ocupado) fileId=' + fileId + ' to=' + deviceId + ' cola=' + self._fileStartQueue.size);
        return;
      }
      self._startFileStream(deviceId, fileId, base64Data, meta, resolve, reject);
    });
  },
  // #129 parte 2: nº de transferencias de ARCHIVO activas hacia ese enlace Bluetooth (mismo teléfono; net:/lan: no cuentan)
  _bleFileSlots(deviceId, bulk) {
    var self = this, n = 0, mac = _normMac(deviceId), nx = self._resolveNexoId(deviceId);
    self.outgoingStreams.forEach(function(s) {
      if (!s || s.aborted || s.type !== 'file' || (!!s._bulk !== !!bulk)) return;   // #dueño 05-11: cupo POR CLASE (grandes con grandes, chicos con chicos) → 1 grande + 1 chico a la vez; muchos de la misma clase hacen cola (sigue sin inundar, #129)
      if (_isNetDevice(s.deviceId) || _isLanDevice(s.deviceId)) return;
      if (_normMac(s.deviceId) === mac || self._resolveNexoId(s.deviceId) === nx) n++;
    });
    return n;
  },
  _startFileStream(deviceId, fileId, base64Data, meta, resolve, reject) {
    var self = this;
    var finalMeta = self._fileMeta(meta, base64Data.length);
    console.log('[BleAckSystem] sendFile START fileId=' + fileId + ' type=' + finalMeta.type + ' bytes(b64)=' + base64Data.length + ' to=' + deviceId);
    // #129 (dueño 31-10): un respaldo FÉNIX de fondo NO debe parar el escaneo de contactos (sí lo hace una foto/archivo que el usuario espera).
    if (self.ble && typeof self.ble._stopAutoScan === 'function' && finalMeta.type !== 'fenix' && !_isNetDevice(deviceId)) self.ble._stopAutoScan();   // 3016: por internet no usa la radio
    var stream = new ChatStream(self, deviceId, fileId, base64Data, finalMeta, 'file');
    self.outgoingStreams.set(fileId, stream);
    // 3007: archivo grande del usuario por internet → se guarda (cifrado) para poder seguir donde iba; se borra al entregarse
    var bigx = _isNetDevice(deviceId) && base64Data.length >= BIGX_MIN_CHARS && _bigxUserId(fileId) && !(meta && meta.fwd) && typeof window !== 'undefined' && typeof window.vaultBigxOutPut === 'function';
    if (bigx && !finalMeta._bigxResumed) {
      var metaX = Object.assign({}, meta || {}); delete metaX._att; delete metaX._bigxResumed; delete metaX._noBigx;
      try { window.vaultBigxOutPut(fileId, { att: stream.att, cid: self._resolveNexoId(deviceId), meta: metaX }, base64Data).catch(function() {}); } catch (e) {}
    }
    stream._promise = stream.start();
    stream._promise.then(function() {
      self.outgoingStreams.delete(fileId);
      if (bigx || finalMeta._bigxResumed) { try { window.vaultBigxOutDrop(fileId).catch(function() {}); } catch (e) {} }
      console.log('[BleAckSystem] sendFile OK fileId=' + fileId);
      resolve();
      self._pumpFileQueue();
    }).catch(function(err) {
      self.outgoingStreams.delete(fileId);
      console.warn('[BleAckSystem] sendFile FAIL fileId=' + fileId, err && err.message);
      reject(err);
      self._pumpFileQueue();
    });
  },
  // #129 parte 2: al liberarse un hueco, arrancar la siguiente transferencia de archivo en cola que lo tenga (de su clase, grande/chico)
  // 3180 (ciudad 17-11): se mira TODA la cola, no solo el enlace que avisó: un hueco que se abrió sin aviso (un reenvío de Jump que
  // terminó —forwardStream no avisaba—, un enlace con otra dirección) dejaba el archivo esperando para siempre. Lo llama también el
  // repaso del vigilante (upgradeAll), por si acaso.
  _pumpFileQueue() {
    var self = this;
    if (!self._fileStartQueue || self._fileStartQueue.size === 0) return;
    Array.from(self._fileStartQueue.entries()).forEach(function(kv) {
      var id = kv[0], it = kv[1];
      if (self._fileStartQueue.get(id) !== it || _isNetDevice(it.deviceId) || _isLanDevice(it.deviceId)) return;
      if (self._bleFileSlots(it.deviceId, _isBulkFileData(it.data)) >= self._maxBleFilesPerLink) return;
      self._fileStartQueue.delete(id);
      self._startQueued(it.deviceId, id, it.data, it.meta, it.waiters);
    });
  },
  // Arranca un archivo que esperaba en la cola; avisa a todos los que lo esperaban
  _startQueued(deviceId, fileId, data, meta, waiters) {
    var ws = waiters || [];
    this._startFileStream(deviceId, fileId, data, meta,
      function() { ws.forEach(function(w) { try { w.resolve(); } catch (e) {} }); },
      function(err) { ws.forEach(function(w) { try { w.reject(err); } catch (e) {} }); });
  },
  // 3180: Wi-Fi o internet listo con nx (upgradeLinks): lo que esperaba en la cola del Bluetooth ocupado para él sale ya por ahí (no
  // lo de Jump/puente ni los respaldos Fénix; por internet, con las mismas reglas que _sendFileBest). Devuelve cuántos salieron.
  _upgradeQueued(nx, lanOk, why) {
    var self = this, ble = self.ble, net = ble && ble.net, moved = 0;
    if (!self._fileStartQueue || !self._fileStartQueue.size) return 0;
    Array.from(self._fileStartQueue.entries()).forEach(function(kv) {
      var id = kv[0], it = kv[1], len = String(it.data || '').length;
      if (_isNetDevice(it.deviceId) || _isLanDevice(it.deviceId)) return;
      if (it.meta && (it.meta.dst || it.meta.fwd || it.meta.type === 'fenix')) return;
      if (_normId(self._resolveNexoId(it.deviceId)) !== nx) return;
      if (!lanOk && !((typeof net.filesOk === 'function' && net.filesOk(nx)) || (typeof net.mailboxFilesOk === 'function' && net.mailboxFilesOk(nx, len) && len <= NET_MAX_B64_BYTES))) return;
      self._fileStartQueue.delete(id);
      console.log('[BleAckSystem] sendFile ' + id + ' esperaba en la cola del Bluetooth ocupado: ' + (lanOk ? 'Wi-Fi' : 'internet') + ' listo con ' + nx + ' (' + (why || 'repaso') + '): sale ya por ahí');
      self._startQueued((lanOk ? 'lan:' : 'net:') + nx, id, it.data, it.meta, it.waiters);
      moved++;
    });
    return moved;
  },
};
