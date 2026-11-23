import { MAX_CHUNKS, MAX_CHUNK_CHARS, MAX_BUF_CHARS, MAX_BUFS_PER_DEVICE, _chunkCheck, _isNetDevice, _assemblyTimeoutFor, NACK_INTERVAL_MS, BIGX_BLOCK, BIGX_MIN_CHUNKS, _bigxUserId, _bigxFullBlock, ACK_EVERY, ACK_DEBOUNCE_MS, NET_TOR_PREFER_CHUNKS, COMPLETED_TTL_MS, _isFenixTx, _isLanDevice, _compressRanges, PROTOCOL_VERSION, _decompressRanges, _normId, _maxSeqFromPeer } from './ble_ack_shared.js';
// Métodos de BleAckSystem: RECEPCIÓN: trozos que llegan, armado, NACK y ack de bloque, sincronía de sesión.
// Reestructuración 15-11: movidos TAL CUAL desde ble_ack.js; ble_ack.js los une a la clase (como métodos normales).
export const ackIncoming = {
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
        this._handleIncomingChunk(deviceId, msg, type, dataObj.ts);
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
  },
  // rxTs: cuándo llegó este trozo (con la app cerrada, cuándo lo guardó la parte nativa)
  _handleIncomingChunk(deviceId, msg, type, rxTs) {
    var self = this;
    var msgId = msg.m || msg.msgId;
    var idx = (typeof msg.i === 'number') ? msg.i : msg.idx;
    var total = (typeof msg.n === 'number') ? msg.n : msg.total;
    var data = msg.d || msg.data;
    var from = msg.fr || msg.from;
    var seq = (typeof msg.seq === 'number') ? msg.seq : 0;
    if (!msgId || !Number.isInteger(idx) || !Number.isInteger(total)) return; // revisión 24-11: enteros (no 1.5, NaN ni Infinity)
    if (data != null && typeof data !== 'string') return;                    // revisión 24-11: el trozo es texto
    if (data && data.length > MAX_CHUNK_CHARS) return;                        // revisión 24-11: ningún trozo legítimo es tan grande
    if (!/^[A-Za-z0-9_.:-]{1,80}$/.test(String(msgId))) return; // auditoría 23-11 (I-X1): id elegido por quien manda
    if (total <= 0 || idx < 0 || idx >= total) return;
    // Robustez (auditoría 2804): un 'n' (total) desproporcionado haría que el block-ack / NACK recorrieran miles de
    // millones de índices en el hilo principal (congelación de la interfaz → ANR). Por encima de MAX_CHUNKS es un
    // ataque: se ignora. Esto también acota idx (idx<total), así que corta el array de huecos de más abajo.
    if (total > MAX_CHUNKS) return;
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
      // Ronda 2767: mientras se descifra no se confirma (si no se puede descifrar, el emisor no lo da por entregado)
      if (!completed.pending) self._sendFinalAck(deviceId, msgId, total);
      return;
    }
    // P6 (dueño 01-11): el MISMO mensaje ya llegó ENTERO por otro camino (internet/Jump/BLE corto; dedup central
    // _receivedMessageIds). No reabrir un reensamblado BLE con trozos tardíos que nunca completaría: acusar recibo (que el
    // emisor pare) y salir. Cubre el orden «internet antes, trozos BLE después»; el buffer ya a medias lo cierra dropAssembly.
    if (self.ble && self.ble._receivedMessageIds && self.ble._receivedMessageIds.has(msgId)) {
      self._sendFinalAck(deviceId, msgId, total);
      return;
    }
    var buf = self.incomingBuffers.get(msgId);
    if (buf && buf._loading) return;   // 3007: se está trayendo del teléfono lo ya recibido para juntarlo
    // 3007: archivo grande por internet a medias guardado en el teléfono (p. ej. tras reiniciarse la app) → seguir donde iba
    if (!buf && type !== 'c' && _isNetDevice(deviceId)) buf = self._bigxRestore(deviceId, msgId, msg, total);
    // Ronda 2767: otro intento del mismo mensaje (marca 'a' distinta: cifrado otra vez, distinto). Sus trozos no se
    // mezclan con los del anterior (antes salía ilegible y se perdía): si el anterior está parado, se empieza de nuevo
    if (buf && (msg.a || '') !== (buf.a || '')) {
      if (Date.now() - (buf.lastActivity || 0) < 4000 && msg.rs !== 1) return;
      console.warn('[BleAckSystem] ' + msgId + ': llega otro intento: se empieza de nuevo');
      if (buf.assemblyTimer) clearTimeout(buf.assemblyTimer);
      if (buf.ackTimer) clearTimeout(buf.ackTimer);
      self.incomingBuffers.delete(msgId);
      self._bigxForget(msgId);   // 3007: lo guardado era de otro intento
      buf = null;
    }
    // Ronda 2758: el mismo mensaje llega por otro camino troceado distinto (el puente Jump lo empezó y se cortó, y el
    // emisor lo manda directo): si lo que había a medias está parado, se empieza con el nuevo (antes se mezclaban los
    // trozos y no se completaba nunca); si los dos siguen activos, se sigue con el primero
    if (buf && buf.total !== total) {
      // 3080: rs:1 = el emisor dejó el intento anterior a propósito (cambio de camino): no hay dos envíos vivos, se empieza ya
      if (Date.now() - (buf.lastActivity || 0) < 4000 && msg.rs !== 1) return;
      console.warn('[BleAckSystem] ' + msgId + ' llega troceado distinto (' + buf.total + ' → ' + total + ' trozos): se empieza de nuevo');
      if (buf.assemblyTimer) clearTimeout(buf.assemblyTimer);
      self.incomingBuffers.delete(msgId);
      self._bigxForget(msgId);   // 3007
      buf = null;
    }
    if (!buf && idx !== 0) {
      var missing = [];
      for (var i = 0; i <= Math.min(idx, total - 1); i++) missing.push(i);
      self._sendNack(deviceId, msgId, missing);
      return;
    }
    if (!buf) {
      // Revisión 24-11: de un mismo enlace, como mucho MAX_BUFS_PER_DEVICE mensajes a medias a la vez (el resto se vuelve a pedir después)
      var open = 0; self.incomingBuffers.forEach(function(b) { if (b && b.deviceId === deviceId) open++; });
      if (open >= MAX_BUFS_PER_DEVICE) {
        if (!self._tooManySaid || Date.now() - self._tooManySaid > 60000) { self._tooManySaid = Date.now(); console.warn('[BleAckSystem] Demasiados mensajes a medias desde un mismo enlace: se ignoran los nuevos por ahora'); }
        return;
      }
      var resolvedType = msg.tp || msg.type || (type === 'f' ? 'file' : null);
      var resolvedFrom = from || msg.fr || 'unknown';
      buf = {
        chunks: new Map(), total: total, t0: Date.now(), // 3081: t0 = llegó el primer trozo (velocidad de recepción)
        meta: {
          f: msg.f || 'NEXO',
          fr: resolvedFrom,
          senderNexoId: resolvedFrom,
          fromNexoId: resolvedFrom,
          ts: msg.ts || Date.now(),
          // Ronda 2767 (revisión): la hora del mensaje en este teléfono es la de su llegada (la del primer trozo), como la
          // de un texto corto. Antes un texto largo o un archivo llevaba la hora del otro teléfono al mandarlo: con los
          // relojes desfasados (lo normal sin red) o al reenviarse, salían desordenados con los textos cortos
          rxTs: (typeof rxTs === 'number' && rxTs > 0) ? rxTs : Date.now(),
          seq: seq,
          type: resolvedType,
          name: msg.fn || msg.name,
          mime: msg.mt || msg.mime,
          size: msg.fs || msg.size,
          format: msg.ft || msg.format,
          duration: (typeof msg.du === 'number' && msg.du > 0 && msg.du < 86400) ? msg.du : undefined, // 3015: nota de voz
          mimeType: (typeof msg.am === 'string' && /^audio\/[a-z0-9.+-]+(;[ a-z0-9=.,"-]*)?$/i.test(msg.am) && msg.am.length < 80) ? msg.am : undefined,
          width: msg.w || msg.width,
          height: msg.h || msg.height,
          hdFor: msg.hf || null,
          preview: msg.pv === 1,
          once: msg.o1 === 1, // #94 «ver una vez»

          thumb: msg.th || null,
          pages: msg.pg || null,
          caption: (typeof msg.cp === 'string' && msg.cp) ? msg.cp.substring(0, 1000) : undefined, // 3242: comentario
          xs: (typeof msg.xs === 'string' && msg.xs.length < 4000) ? msg.xs : undefined, // 4A (23-11): comentario y «ver una vez», sellados
          dst: msg.dt || null,
          hp: msg.hp || 0
        },
        received: 0, deviceId: deviceId, lastActivity: Date.now(),
        isChat: type === 'c', nackSent: false, a: msg.a || ''
      };
      self.incomingBuffers.set(msgId, buf);
      // #129 (dueño 31-10): recibir un respaldo FÉNIX de fondo tampoco debe parar el escaneo de contactos.
      if (!buf.isChat && buf.meta.type !== 'fenix' && !_isNetDevice(deviceId) && self.ble && typeof self.ble._stopAutoScan === 'function') self.ble._stopAutoScan();
      buf.assemblyTimer = setTimeout(function() {
        if (self.incomingBuffers.has(msgId)) {
          console.warn('[BleAckSystem] Assembly timeout msgId=' + msgId);
          self._reportIncomingProgress(msgId, self.incomingBuffers.get(msgId), 'failed');
          self.incomingBuffers.delete(msgId);
        }
      }, _assemblyTimeoutFor(_isNetDevice(deviceId), buf.isChat, buf.total));
    }
    if (!buf.chunks.has(idx)) {
      // Revisión 24-11: tope de lo que un mismo mensaje guarda en memoria; pasarlo = ataque: se tira el mensaje entero
      buf.mem = (buf.mem || 0) + (data ? data.length : 0);
      if (buf.mem > MAX_BUF_CHARS) {
        console.warn('[BleAckSystem] ' + msgId + ': pasa del tope de memoria por mensaje: se descarta');
        if (buf.assemblyTimer) clearTimeout(buf.assemblyTimer);
        if (buf.ackTimer) clearTimeout(buf.ackTimer);
        self.incomingBuffers.delete(msgId);
        self._bigxForget(msgId);
        return;
      }
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
      }, _assemblyTimeoutFor(_isNetDevice(deviceId), buf.isChat, buf.total));
    }
    self._bigxMaybeSave(deviceId, msgId, buf, idx);   // 3007
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
  },
  // ── 3007: recepción de archivos grandes por internet que sigue donde iba (bloques en el teléfono) ──
  _bigxLoadIndex(n) {
    var self = this;
    try {
      if (typeof window !== 'undefined' && typeof window.vaultBigxInIndex === 'function') {
        window.vaultBigxInIndex().then(function(m) { Object.keys(m || {}).forEach(function(k) { if (!self._bigxIn.has(k)) self._bigxIn.set(k, m[k]); }); }).catch(function() {});
      } else if (n < 20) setTimeout(function() { self._bigxLoadIndex(n + 1); }, 500);   // main.js aún no lo expuso
    } catch (e) {}
  },
  _bigxForget(msgId) {
    var had = this._bigxIn.has(msgId);
    this._bigxIn.delete(msgId);
    try { if (typeof window !== 'undefined' && typeof window.vaultBigxInDrop === 'function') window.vaultBigxInDrop(msgId).catch(function() {}); } catch (e) {}
    return had;
  },
  // Rehace el buffer de un archivo grande a medias desde lo guardado (sus bloques quedan como «en el teléfono»: valor null)
  _bigxRestore(deviceId, msgId, msg, total) {
    var self = this, rec = self._bigxIn.get(msgId);
    if (!rec) return null;
    if (rec.a !== (msg.a || '') || rec.total !== total) {
      console.log('[BleAckSystem] ' + msgId + ': llega otro intento del archivo grande: lo guardado de antes no sirve, se empieza de nuevo');
      self._bigxForget(msgId);
      return null;
    }
    var buf = { chunks: new Map(), total: total, meta: rec.meta || {}, received: 0, deviceId: deviceId, lastActivity: Date.now(), isChat: false, nackSent: false, a: rec.a, diskBlocks: new Set(), bigx: true };
    (rec.blocks || []).forEach(function(k) {
      var s0 = k * BIGX_BLOCK, e0 = Math.min(total, s0 + BIGX_BLOCK);
      for (var i = s0; i < e0; i++) { if (!buf.chunks.has(i)) { buf.chunks.set(i, null); buf.received++; if (typeof buf.maxIdx !== 'number' || i > buf.maxIdx) buf.maxIdx = i; } }
      buf.diskBlocks.add(k);
    });
    if (!buf.diskBlocks.size) return null;
    buf.assemblyTimer = setTimeout(function() {
      if (self.incomingBuffers.get(msgId) === buf) {
        console.warn('[BleAckSystem] Assembly timeout msgId=' + msgId);
        self._reportIncomingProgress(msgId, buf, 'failed');
        self.incomingBuffers.delete(msgId);
      }
    }, _assemblyTimeoutFor(true, false, total));
    self.incomingBuffers.set(msgId, buf);
    if (!_isNetDevice(buf.deviceId) && self.ble && typeof self.ble._stopAutoScan === 'function') self.ble._stopAutoScan();
    console.log('[BleAckSystem] ' + msgId + ': sigo recibiendo el archivo grande donde iba (' + buf.received + ' de ' + total + ' trozos guardados en el teléfono)');
    return buf;
  },
  // Guarda en el teléfono el bloque de idx si ya está completo (y libera esa memoria: queda como «en el teléfono»)
  _bigxMaybeSave(deviceId, msgId, buf, idx) {
    if (!buf || buf.isChat || buf.total < BIGX_MIN_CHUNKS || !_isNetDevice(deviceId) || !_bigxUserId(msgId)) return;
    if (typeof window === 'undefined' || typeof window.vaultBigxInPutBlock !== 'function') return;
    var k = Math.floor(idx / BIGX_BLOCK);
    buf.diskBlocks = buf.diskBlocks || new Set(); buf._bigxSaving = buf._bigxSaving || new Set();
    if (buf.diskBlocks.has(k) || buf._bigxSaving.has(k)) return;
    var arr = _bigxFullBlock(buf.chunks, k, buf.total);
    if (!arr) return;
    var self = this, s0 = k * BIGX_BLOCK, e0 = s0 + BIGX_BLOCK;
    buf.bigx = true; buf._bigxSaving.add(k);
    window.vaultBigxInPutBlock(msgId, k, arr, { a: buf.a || '', total: buf.total, meta: buf.meta, from: buf.meta && buf.meta.fr }).then(function(ok) {
      buf._bigxSaving.delete(k);
      if (!ok || buf._assembled || buf._loading || self.incomingBuffers.get(msgId) !== buf) return;   // juntándose: se queda en memoria
      buf.diskBlocks.add(k);
      for (var j = s0; j < e0; j++) { var cj = buf.chunks.get(j); if (typeof cj === 'string') { buf.mem = Math.max(0, (buf.mem || 0) - cj.length); buf.chunks.set(j, null); } }
      var rec = self._bigxIn.get(msgId);
      if (!rec || rec.a !== (buf.a || '') || rec.total !== buf.total) { rec = { a: buf.a || '', total: buf.total, meta: buf.meta, blocks: [] }; self._bigxIn.set(msgId, rec); }
      if (rec.blocks.indexOf(k) < 0) rec.blocks.push(k);
    }, function() { buf._bigxSaving.delete(k); });
  },
  // Trae del teléfono los bloques guardados (de uno en uno) y junta; si falta alguno, se piden de nuevo esos trozos
  _bigxLoadThenAssemble(buf, deviceId, senderId, msgId) {
    var self = this;
    buf._loading = true;
    var ks = [], bad = [];   // los bloques que están solo en el teléfono (trozos con valor null)
    for (var iq = 0; iq < buf.total; iq++) { if (buf.chunks.get(iq) === null) { var kq = Math.floor(iq / BIGX_BLOCK); if (ks.indexOf(kq) < 0) ks.push(kq); } }
    var step = function(i) {
      if (i >= ks.length) return Promise.resolve();
      var k = ks[i];
      return Promise.resolve(window.vaultBigxInGetBlock(msgId, k)).then(function(arr) {
        var s0 = k * BIGX_BLOCK, e0 = Math.min(buf.total, s0 + BIGX_BLOCK);
        if (!arr || arr.length !== e0 - s0) bad.push(k);
        else for (var j = s0; j < e0; j++) { if (buf.chunks.get(j) === null) buf.chunks.set(j, arr[j - s0]); }
        return step(i + 1);
      });
    };
    step(0).then(function() {
      buf._loading = false;
      if (bad.length) {
        bad.forEach(function(k) {
          buf.diskBlocks.delete(k);
          var s0 = k * BIGX_BLOCK, e0 = Math.min(buf.total, s0 + BIGX_BLOCK);
          for (var j = s0; j < e0; j++) { if (buf.chunks.get(j) === null) { buf.chunks.delete(j); buf.received--; } }
        });
        console.warn('[BleAckSystem] ' + msgId + ': faltan ' + bad.length + ' bloque(s) guardados en el teléfono: se piden de nuevo');
        buf.lastActivity = Date.now();
        self._sendNack(deviceId, msgId, self._findMissing(buf));
        return;
      }
      self._assembleAndDispatch(buf, deviceId, senderId, msgId);
    }, function() { buf._loading = false; });
  },
  _findGaps(buf) {
    var gaps = [];
    for (var i = 0; i < buf.maxIdx; i++) {
      if (!buf.chunks.has(i)) gaps.push(i);
    }
    return gaps;
  },
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
  },
  _findMissing(buf) {
    var missing = [];
    for (var i = 0; i < buf.total; i++) {
      if (!buf.chunks.has(i)) missing.push(i);
    }
    return missing;
  },
  _assembleAndDispatch(buf, deviceId, senderId, msgId) {
    var self = this;
    // 3007: parte de lo recibido está en el teléfono (bloques guardados) → traerlo primero (de bloque en bloque) y juntar después
    if (buf && buf.diskBlocks && buf.diskBlocks.size) {
      for (var iz = 0; iz < buf.total; iz++) { if (buf.chunks.get(iz) === null) { self._bigxLoadThenAssemble(buf, deviceId, senderId, msgId); return; } }
    }
    if (buf) buf._assembled = true;
    if (buf && (buf.bigx || self._bigxIn.has(msgId))) self._bigxForget(msgId);
    // #dueño 06-11 (paso 2b): archivo GRANDE por internet COMPLETO → suelto el «mantenerme despierto» (lo había tomado
    // _sendBlockAck). Si por algo no llegáramos acá (transferencia muerta), el nativo lo suelta igual por su tope duro.
    try { if (buf && !buf.isChat && _isNetDevice(deviceId) && buf.total > NET_TOR_PREFER_CHUNKS && self.ble && self.ble.net && typeof self.ble.net.xferKeepAwake === 'function') self.ble.net.xferKeepAwake(false); } catch (e) {}
    var assembled = '';
    for (var i = 0; i < buf.total; i++) {
      assembled += buf.chunks.has(i) ? buf.chunks.get(i) : '';
    }
    self.incomingBuffers.delete(msgId);
    // Ronda 2767 (revisión): la confirmación final sale cuando ya se ha podido descifrar. Antes salía al juntar los
    // trozos: si no se podía descifrar, se perdía y el emisor lo daba por entregado. Mientras se descifra, los trozos
    // repetidos no se confirman; si no se puede, se olvida y el emisor lo reintenta (o lo marca como no enviado)
    var entry = { total: buf.total, expireAt: Date.now() + COMPLETED_TTL_MS, pending: true };
    self.completedMessages.set(msgId, entry);
    var finalAck = function(ok) {
      if (self.completedMessages.get(msgId) !== entry) return;
      if (!ok) { self.completedMessages.delete(msgId); return; }
      entry.pending = false;
      self._sendFinalAck(deviceId, msgId, buf.total);
    };
    // Jump: va para otro teléfono → hacer de puente (no se muestra ni se descifra aquí)
    var relay = self.ble && self.ble.relay;
    if (relay && buf.meta.dst && relay.onStreamComplete(buf.isChat ? 'chat' : 'file', msgId, assembled, buf.meta, deviceId)) { finalAck(true); return; }
    // v3.11.0: remitente sellado: abrir antes de seguir
    if (String(buf.meta.fr || '').indexOf('sx:') === 0) {
      self._unsealFrom(buf).then(function() {
        if (buf.meta.badSeal) { finalAck(true); return; }
        self._finishAssembly(buf, deviceId, buf.meta.fr, msgId, assembled, finalAck);
      }, function() { finalAck(false); });
      return;
    }
    self._finishAssembly(buf, deviceId, senderId, msgId, assembled, finalAck);
  },
  _finishAssembly(buf, deviceId, senderId, msgId, assembled, finalAck) {
    var self = this, called = false;
    var done = function(ok) {
      if (called) return; // una sola vez (un fallo después de leerlo no lo deshace)
      called = true;
      if (finalAck) finalAck(ok);
      // Llegó por otro teléfono: confirmación de extremo a extremo al origen (ronda 2767: cuando ya se pudo leer)
      if (ok && buf.meta.hp > 0 && buf.meta.fr) self.sendAck(deviceId, msgId, buf.meta.fr);
    };
    if (buf.isChat) {
      self._dispatchChunkedMessageComplete(senderId, assembled, buf.meta, deviceId, msgId, done);
    } else {
      // 3081: velocidad real de esta recepción (desde el primer trozo hasta tenerlo entero)
      if (buf.t0 && !(buf.meta && (buf.meta.hp > 0 || _isFenixTx(buf.meta))) && typeof window.NEXO_noteSpeed === 'function') {
        try { window.NEXO_noteSpeed(_isLanDevice(deviceId) ? 'wifi' : (_isNetDevice(deviceId) ? 'internet' : 'bluetooth'), 'in', Math.round(String(assembled || '').length * 3 / 4), Date.now() - buf.t0); } catch (e) {}
      }
      self._dispatchFileComplete(msgId, assembled, buf.meta, done);
      self._dispatchFileProgress(msgId, buf.total, buf.total, 'received', 100);
    }
  },
  _sendNack(deviceId, msgId, indices) {
    var ranges = _compressRanges(indices);
    var payload = JSON.stringify({ v: PROTOCOL_VERSION, t: 'n', m: msgId, r: ranges, bf: 1 });
    if (this.ble && this.ble._sendMessageNative) {
      this.ble._sendMessageNative(deviceId, payload, null).catch(function(){});
    }
  },
  _sendBlockAck(deviceId, msgId, buf) {
    // #dueño 06-11 (LATIDO de vuelta): si estoy RECIBIENDO un archivo por internet, al confirmar un bloque le devuelvo el
    // «toque» FCM al que ENVÍA para que su app tampoco se duerma a mitad del envío → los dos se mantienen despiertos
    // hasta terminar. net_link lo throttlea a 1 cada 15 s (bucket propio), así que es barato aunque confirme muchos
    // bloques; en un envío sano (los dos despiertos) el toque extra es inofensivo. Solo archivos por net (no textos/BT).
    if (buf && !buf.isChat && _isNetDevice(deviceId) && this.ble && this.ble.net && typeof this.ble.net.wakeKeepAlive === 'function') {
      try { var _nxKa = this._resolveNexoId(deviceId); if (_nxKa) this.ble.net.wakeKeepAlive(_nxKa); } catch (e) {}
      // #dueño 06-11: si lo que recibo es un archivo GRANDE por internet, arranco Tor a demanda (no hace nada si lo apagué)
      // para que se forme el Tor directo con el que envía (él también lo prefiere) → los 25 MB viajan por Tor, no por relés.
      try { if (buf.total > NET_TOR_PREFER_CHUNKS && typeof this.ble.net.ensureTor === 'function') this.ble.net.ensureTor(); } catch (e) {}
      // #dueño 06-11 (paso 2b): y le pido al nativo que me mantenga despierto de corrido (wakelock + Wi-Fi) mientras dura
      // el envío largo, para no dormirme con la pantalla apagada. Se re-toma en cada bloque (se renueva); se suelta al
      // completar el archivo (_assembleAndDispatch) y, por las dudas, el nativo tiene un tope duro de seguridad.
      try { if (buf.total > NET_TOR_PREFER_CHUNKS && typeof this.ble.net.xferKeepAwake === 'function') this.ble.net.xferKeepAwake(true); } catch (e) {}
    }
    var received = [];
    for (var i = 0; i < buf.total; i++) {
      if (buf.chunks.has(i)) received.push(i);
    }
    var ranges = _compressRanges(received);
    var payload = JSON.stringify({ v: PROTOCOL_VERSION, t: 'ba', m: msgId, r: ranges, n: buf.total, bf: 1 });
    if (this.ble && this.ble._sendMessageNative) {
      this.ble._sendMessageNative(deviceId, payload, null).catch(function(){});
    }
  },
  _sendFinalAck(deviceId, msgId, total) {
    var ranges = (total <= 1) ? '0' : '0-' + (total - 1);
    var payload = JSON.stringify({ v: PROTOCOL_VERSION, t: 'ba', m: msgId, r: ranges, n: total, f: 1, bf: 1 });
    if (this.ble && this.ble._sendMessageNative) {
      this.ble._sendMessageNative(deviceId, payload, null).catch(function(){});
    }
  },
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
  },
  _handleBlockAck(msg) {
    var msgId = msg.m || msg.msgId;
    var total = msg.n || 0;
    var isFinal = msg.f === 1;
    var stream = this.outgoingStreams.get(msgId);
    if (!stream) return;
    // 3080 (upgrade.js: al pasar un archivo del Bluetooth al Wi-Fi, las confirmaciones que seguían llegando del intento por
    // Bluetooth —otro troceado: 1400 trozos frente a 35— daban por recibidos los 35 nuevos y el envío «terminaba» sin que el otro
    // tuviera nada). Una confirmación parcial de OTRO troceado (n distinto) no es de este intento; la final sí vale (lo tiene entero).
    if (!isFinal && total && stream.total && total !== stream.total) return;
    if (msg.bf) this.markBin(stream.deviceId);
    stream.lastAckAt = Date.now(); stream._downWaitMs = 0;
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
    // 3005: el otro volvió a confirmar durante el «sondeo» → ritmo normal ya (no esperar al minuto del sondeo)
    if (stream._probing) {
      stream._probing = false; stream.windowRetryCount = 0; stream._sleepSince = 0; // 3124: también el sondeo de una app dormida
      console.log('[BleAckSystem] El otro volvió a confirmar: sigo al ritmo normal msgId=' + msgId);
      if (!stream.aborted && stream._windowResolve && stream.windowStart < stream.total) {
        if (stream.timer) { clearTimeout(stream.timer); stream.timer = null; }
        stream._retransmitWindow();
      }
    }
    if (stream.windowStart >= stream.total) {
      console.log('[BleAckSystem] Mensaje completo, finalizando msgId=' + msgId);
      if (stream.timer) clearTimeout(stream.timer);
      stream._finish();
    }
  },
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
  },
  // Auditoría M6 (2998): «ss»/«sr» llegan SIN firmar. Una «ss» falsa de un desconocido hacía reenviar los propios mensajes (ya cifrados) y
  // revelaba el último número de secuencia. Ahora solo se atiende si el NEXO ID que dice ser coincide con el DUEÑO CONOCIDO de ese enlace
  // (el que ya resolvió el flujo de enlace: Wi-Fi/internet por su id, Bluetooth por el mapa MAC→NEXO ID); si no, se ignora.
  _syncFromLinkOwner(deviceId, claimed) {
    var linkNx = this._resolveNexoId(deviceId);
    var ok = !!claimed && /^nx[0-9a-z]{8}$/.test(String(linkNx || '')) && _normId(claimed) === _normId(linkNx);
    if (!ok) console.log('[BleAckSystem] Sync ignorado: quien lo manda (' + (claimed || '?') + ') no es el dueño conocido de este enlace');
    return ok;
  },
  _handleSessionSync(deviceId, msg) {
    var self = this;
    var peerLastSeq = msg.l || 0;
    var peerNexoId = msg.fr || msg.from;
    if (!self._syncFromLinkOwner(deviceId, peerNexoId)) return;
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
  },
  _handleSessionSyncResponse(deviceId, msg) {
    var self = this;
    var peerLastSeq = msg.l || 0;
    var peerNexoId = msg.fr || msg.from;
    if (!peerNexoId || !window.vaultLoadMessages) return;
    if (!self._syncFromLinkOwner(deviceId, peerNexoId)) return;
    window.vaultLoadMessages(peerNexoId).then(function(msgs) {
      if (!msgs) return;
      // v3.3.1: peerLastSeq es el mayor seq NUESTRO que el otro tiene (antes mezclaba los contadores de
      // ambos teléfonos y dejaba sin reenviar). Se reenvía lo propio sin confirmar: pendiente/fallido
      // siempre; 'sent' (sin ack) si su seq es mayor que lo que el otro tiene. Máx. 7 días y 50 mensajes.
      var cutoff = Date.now() - 7 * 86400000;
      // Ronda 2767: lo pendiente lo manda la vuelta de reenvíos del contacto (una sola a la vez y en orden); antes esta
      // lista lo mandaba también, a la vez que ella. Aquí solo lo que salió (✓) y el otro dice no tener
      var bi = self.ble;
      if (bi && typeof bi._resendPendingMessages === 'function') bi._resendPendingMessages(peerNexoId);
      var pending = msgs.filter(function(m) {
        if (m._own !== true || m.attachmentType || (m.timestamp || 0) < cutoff) return false;
        var mid = m.msgId || m.messageId;
        if (bi && typeof bi._isMsgInFlight === 'function' && bi._isMsgInFlight(mid)) return false;
        if (self.isDone(mid)) return false;
        return m.status === 'sent' && (m.seq || 0) > peerLastSeq;
      }).slice(-50);
      if (pending.length === 0) return;
      console.log('[BleAckSystem] Sync: reenviando', pending.length, 'mensajes faltantes a', peerNexoId);
      var idx = 0;
      function sendNext() {
        if (idx >= pending.length) return;
        var m = pending[idx++];
        var txt = m.content || m.text || '';
        // Ronda 2766: son mensajes del chat de ese contacto: van a él (si la conexión es de otro, no salen)
        if (txt.length <= 150) {
          self.sendWithRetry(deviceId, txt, m.msgId, m.seq, { to: peerNexoId }).then(sendNext).catch(sendNext);
        } else {
          self.sendChunkedMessage(deviceId, txt, { to: peerNexoId }, m.msgId, m.seq).then(sendNext).catch(sendNext);
        }
      }
      sendNext();
    }).catch(function(){});
  },
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
  },
};
