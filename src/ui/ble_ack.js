/**
 * ble_ack.js — Sistema ACK real + fragmentación de archivos para NEXO
 * v1.2.0-ACKFIX: sendReadReceipt + read_receipt support + ACK inmediato
 * v1.1.0: sendFile robusto con batches de 5 chunks + reenvío de batch + progreso
 */
export class BleAckSystem {
  constructor(bleInterface) {
    this.ble = bleInterface;
    this.pendingAcks = new Map();
    this.ackTimeoutMs = 6000;
    this.maxRetries = 3;
    this.receivedAcks = new Set();
    this.maxReceivedAcks = 500;
    this.chunkSize = 400;
    this.pendingFragments = new Map();
    this.maxFragmentAge = 300000;
    // v1.1.0: trackeo de envíos de archivos activos
    this.pendingOutgoingFiles = new Map();
    this._startCleanupInterval();
  }

  sendWithRetry(deviceId, content, messageId) {
    var self = this;
    return new Promise(function(resolve, reject) {
      var msgId = messageId || ('msg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6));
      var entry = {
        msgId: msgId,
        deviceId: deviceId,
        content: content,
        resolve: resolve,
        reject: reject,
        retries: 0,
        timer: null,
        sentAt: Date.now()
      };
      self.pendingAcks.set(msgId, entry);
      self._doSend(entry);
    });
  }

  _doSend(entry) {
    var self = this;
    if (!self.ble || typeof self.ble._sendMessageNative !== 'function') {
      entry.reject(new Error('BLE interface no disponible'));
      self.pendingAcks.delete(entry.msgId);
      return;
    }
    self.ble._sendMessageNative(entry.deviceId, entry.content, entry.msgId)
      .then(function() {
        entry.timer = setTimeout(function() {
          self._onAckTimeout(entry.msgId);
        }, self.ackTimeoutMs);
      })
      .catch(function(err) {
        if (entry.retries < self.maxRetries) {
          entry.retries++;
          setTimeout(function() { self._doSend(entry); }, 1000 * entry.retries);
        } else {
          self.pendingAcks.delete(entry.msgId);
          entry.reject(err);
          self._dispatchStatus(entry.msgId, 'failed');
        }
      });
  }

  _onAckTimeout(msgId) {
    var entry = this.pendingAcks.get(msgId);
    if (!entry) return;
    if (entry.retries < this.maxRetries) {
      entry.retries++;
      this._doSend(entry);
    } else {
      this.pendingAcks.delete(msgId);
      entry.reject(new Error('ACK timeout'));
      this._dispatchStatus(msgId, 'failed');
    }
  }

  processIncomingAck(content) {
    try {
      var ack = JSON.parse(content);
      var ackMsgId = ack.msgId || ack.messageId || ack.id || null;
      if (!ackMsgId) return false;
      if (ack.type !== 'ack' && ack.type !== 'read_receipt') return false;
      if (this.receivedAcks.has(ackMsgId)) return true;
      this.receivedAcks.add(ackMsgId);
      if (this.receivedAcks.size > this.maxReceivedAcks) {
        var first = this.receivedAcks.values().next().value;
        this.receivedAcks.delete(first);
      }
      var entry = this.pendingAcks.get(ackMsgId);
      var status = ack.type === 'read_receipt' ? 'read' : 'delivered';
      if (entry) {
        clearTimeout(entry.timer);
        this.pendingAcks.delete(ackMsgId);
        entry.resolve();
        this._dispatchStatus(ackMsgId, status);
      } else {
        // Notificar UI aunque no sea nuestro ACK pendiente (read receipt entrante)
        this._dispatchStatus(ackMsgId, status);
      }
      return true;
    } catch (e) {
      return false;
    }
  }

  sendAck(deviceId, msgId) {
    var ackPayload = JSON.stringify({
      v: 1,
      type: 'ack',
      msgId: msgId,
      from: (this.ble && this.ble.localNexoId) ? this.ble.localNexoId : ((this.ble && this.ble.localDeviceUUID) ? this.ble.localDeviceUUID : 'unknown'),
      ts: Date.now()
    });
    if (this.ble && typeof this.ble._sendMessageNative === 'function') {
      this.ble._sendMessageNative(deviceId, ackPayload, null).catch(function() {});
    }
  }

  sendReadReceipt(deviceId, msgId) {
    var receiptPayload = JSON.stringify({
      v: 1,
      type: 'read_receipt',
      msgId: msgId,
      from: (this.ble && this.ble.localNexoId) ? this.ble.localNexoId : ((this.ble && this.ble.localDeviceUUID) ? this.ble.localDeviceUUID : 'unknown'),
      ts: Date.now()
    });
    if (this.ble && typeof this.ble._sendMessageNative === 'function') {
      this.ble._sendMessageNative(deviceId, receiptPayload, null).catch(function() {});
    }
  }

  // ========== v1.1.0: ENVÍO DE ARCHIVOS ROBUSTO ==========

  sendFile(deviceId, fileId, base64Data, meta) {
    var self = this;
    return new Promise(function(resolve, reject) {
      var chunks = self._splitIntoChunks(base64Data, self.chunkSize);
      var total = chunks.length;
      if (total === 0) { reject(new Error('Archivo vacio')); return; }

      var senderId = (self.ble && self.ble.localNexoId) ? self.ble.localNexoId : ((self.ble && self.ble.localDeviceUUID) ? self.ble.localDeviceUUID : 'unknown');

      // Registrar envío activo para posible reanudación
      self.pendingOutgoingFiles.set(fileId, {
        deviceId: deviceId,
        chunks: chunks,
        total: total,
        sent: 0,
        meta: meta || {},
        senderId: senderId,
        startTime: Date.now()
      });

      var fileMeta = {
        v: 1,
        type: 'file_meta',
        fileId: fileId,
        totalChunks: total,
        meta: meta || {},
        from: senderId,
        ts: Date.now()
      };

      // Enviar meta con ACK
      self.sendWithRetry(deviceId, JSON.stringify(fileMeta), 'meta_' + fileId)
        .then(function() {
          self._dispatchFileProgress(fileId, 0, total, 'sending');
          // Enviar por batches de 5 chunks
          var batchSize = 5;
          var currentBatch = 0;

          function sendBatch() {
            var start = currentBatch * batchSize;
            if (start >= total) {
              // Terminado
              self.pendingOutgoingFiles.delete(fileId);
              self._dispatchFileProgress(fileId, total, total, 'sent');
              resolve();
              return;
            }
            var end = Math.min(start + batchSize, total);
            var batchChunks = [];
            for (var i = start; i < end; i++) {
              batchChunks.push({
                v: 1,
                type: 'file_chunk',
                fileId: fileId,
                idx: i,
                total: total,
                data: chunks[i],
                from: senderId
              });
            }
            // Enviar todos los chunks del batch directo
            var sendPromises = [];
            for (var j = 0; j < batchChunks.length - 1; j++) {
              (function(chunkPayload) {
                sendPromises.push(
                  self.ble._sendMessageNative(deviceId, JSON.stringify(chunkPayload), 'chunk_' + fileId + '_' + chunkPayload.idx)
                    .catch(function(e) { return { failed: true, error: e }; })
                );
              })(batchChunks[j]);
            }
            // El último chunk del batch va con ACK (sendWithRetry)
            var lastChunk = batchChunks[batchChunks.length - 1];
            var lastMsgId = 'chunk_' + fileId + '_' + lastChunk.idx;

            // Esperar a que todos los chunks directos se envíen
            Promise.all(sendPromises).then(function(results) {
              var anyFailed = results.some(function(r) { return r && r.failed; });
              if (anyFailed) {
                // Algun chunk directo falló, reintentar todo el batch
                console.warn('[BleAckSystem] Batch fallo, reintentando batch', currentBatch);
                setTimeout(function() { sendBatch(); }, 1000);
                return;
              }
              // Enviar último chunk con ACK
              self.sendWithRetry(deviceId, JSON.stringify(lastChunk), lastMsgId)
                .then(function() {
                  currentBatch++;
                  var sentCount = Math.min(currentBatch * batchSize, total);
                  var progress = Math.floor((sentCount / total) * 100);
                  self._dispatchFileProgress(fileId, sentCount, total, 'sending', progress);
                  // Actualizar tracking
                  var track = self.pendingOutgoingFiles.get(fileId);
                  if (track) track.sent = sentCount;
                  setTimeout(function() { sendBatch(); }, 50);
                })
                .catch(function(err) {
                  // ACK del batch no llegó, reintentar batch completo
                  console.warn('[BleAckSystem] ACK batch no recibido, reintentando batch', currentBatch);
                  setTimeout(function() { sendBatch(); }, 1000);
                });
            });
          }

          sendBatch();
        })
        .catch(function(err) {
          self.pendingOutgoingFiles.delete(fileId);
          self._dispatchFileProgress(fileId, 0, total, 'failed');
          reject(err);
        });
    });
  }

  cancelFileSend(fileId) {
    this.pendingOutgoingFiles.delete(fileId);
    this._dispatchFileProgress(fileId, 0, 0, 'cancelled');
  }

  _splitIntoChunks(str, size) {
    var chunks = [];
    for (var i = 0; i < str.length; i += size) {
      chunks.push(str.substring(i, i + size));
    }
    return chunks;
  }

  processIncomingFragment(dataObj) {
    try {
      var deviceId = dataObj.deviceId;
      var content = dataObj.content;
      var msg = JSON.parse(content);

      if (msg.type === 'file_meta') {
        this.pendingFragments.set(msg.fileId, {
          chunks: new Map(),
          total: msg.totalChunks,
          received: 0,
          meta: msg.meta || {},
          lastActivity: Date.now()
        });
        this.sendAck(deviceId, msg.fileId);
        this._dispatchFileProgress(msg.fileId, 0, msg.totalChunks, 'receiving');
        return true;
      }

      if (msg.type === 'file_chunk') {
        var buf = this.pendingFragments.get(msg.fileId);
        if (!buf) {
          // No tenemos el meta, pedir reanudación
          this._requestResume(deviceId, msg.fileId);
          return true;
        }
        if (!buf.chunks.has(msg.idx)) {
          buf.chunks.set(msg.idx, msg.data);
          buf.received++;
          buf.lastActivity = Date.now();
        }
        // ACK cada 5 chunks o al final
        if ((msg.idx + 1) % 5 === 0 || msg.idx === msg.total - 1) {
          this.sendAck(deviceId, msg.fileId + '_' + msg.idx);
        }
        var progress = Math.floor((buf.received / buf.total) * 100);
        this._dispatchFileProgress(msg.fileId, buf.received, buf.total, 'receiving', progress);
        if (buf.received >= buf.total) {
          var assembled = '';
          for (var i = 0; i < buf.total; i++) {
            assembled += buf.chunks.has(i) ? buf.chunks.get(i) : '';
          }
          this.pendingFragments.delete(msg.fileId);
          this._dispatchFileComplete(msg.fileId, assembled, buf.meta);
          this._dispatchFileProgress(msg.fileId, buf.total, buf.total, 'received', 100);
        }
        return true;
      }

      if (msg.type === 'file_resume') {
        // El receptor pide reanudación — reenviar desde el chunk 0
        // (simplificación: reenviamos todo el archivo)
        var track = this.pendingOutgoingFiles.get(msg.fileId);
        if (track) {
          console.log('[BleAckSystem] Reanudando archivo', msg.fileId);
          // Reconstruir y reenviar
          self.sendFile(deviceId, msg.fileId, track.chunks.join(''), track.meta)
            .catch(function() {});
        }
        return true;
      }

      return false;
    } catch (e) {
      return false;
    }
  }

  _requestResume(deviceId, fileId) {
    var resume = JSON.stringify({
      v: 1,
      type: 'file_resume',
      fileId: fileId,
      ts: Date.now()
    });
    if (this.ble && typeof this.ble._sendMessageNative === 'function') {
      this.ble._sendMessageNative(deviceId, resume, null).catch(function() {});
    }
  }

  _dispatchStatus(msgId, status) {
    try {
      window.dispatchEvent(new CustomEvent('nexo:ble:ackStatus', { detail: { msgId: msgId, status: status } }));
    } catch (e) {}
  }

  _dispatchFileProgress(fileId, sent, total, status, percent) {
    try {
      window.dispatchEvent(new CustomEvent('nexo:ble:fileProgress', {
        detail: { fileId: fileId, sent: sent, total: total, status: status, percent: percent || 0 }
      }));
    } catch (e) {}
  }

  _dispatchFileComplete(fileId, data, meta) {
    try {
      window.dispatchEvent(new CustomEvent('nexo:ble:fileComplete', {
        detail: { fileId: fileId, data: data, meta: meta }
      }));
    } catch (e) {}
  }

  _startCleanupInterval() {
    var self = this;
    setInterval(function() {
      var now = Date.now();
      self.pendingFragments.forEach(function(buf, fileId) {
        if (now - buf.lastActivity > self.maxFragmentAge) {
          self.pendingFragments.delete(fileId);
        }
      });
      self.pendingAcks.forEach(function(entry, msgId) {
        if (now - entry.sentAt > self.maxFragmentAge) {
          clearTimeout(entry.timer);
          self.pendingAcks.delete(msgId);
          try { entry.reject(new Error('Timeout global')); } catch(e) {}
        }
      });
      // v1.1.0: limpiar envíos de archivo viejos
      self.pendingOutgoingFiles.forEach(function(track, fileId) {
        if (now - track.startTime > self.maxFragmentAge) {
          self.pendingOutgoingFiles.delete(fileId);
        }
      });
    }, 30000);
  }
}

export function createAckSystem(bleInterface) {
  return new BleAckSystem(bleInterface);
}
