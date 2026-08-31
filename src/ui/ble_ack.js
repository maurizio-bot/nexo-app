/**
 * ble_ack.js — Sistema ACK real + fragmentación unificada + Block ACK bidireccional (D2+D3)
 * v1.5.1-D3: Receptor Block ACK
 * FIX: Bug 3 — chat_meta usa _sendMessageNative directo (sin ACK)
 * FIX: Bug 5b — vaultAppendChunk recibe totalChunks + meta
 * FIX: Bug 6 — fallback desde memoria si vaultCompleteTransfer retorna null
 * v1.4.0-D2: Block ACK emisor. Reenvío selectivo de chunks faltantes. Persistencia outgoing en vault.
 * v1.3.1-FIX: Buffer huérfano para chat_chunk cuando chat_meta se pierde en el aire
 * v1.3.0-FIX: Unificación chat/archivos. Mensajes largos usan chat_chunk (mismo mecanismo que file_chunk).
 * v1.2.3-FIX: ackTimeoutMs 6000→10000, dispatch 'sending' en envío y reintento
 * v1.2.2-FIX: Reintento de batch reenvía solo chunks fallidos (no todo el batch)
 * v1.2.1-ACKFIX: Fix chunk_ prefix + self->this + fromName en meta
 * v1.2.0-ACKFIX: sendReadReceipt + read_receipt support + ACK inmediato
 * v1.1.0: sendFile robusto con batches de 5 chunks + reenvío de batch + progreso
 */

function _normMac(mac) {
  return (mac || '').toString().toLowerCase().replace(/[:-]/g, '').trim();
}

export class BleAckSystem {
  constructor(bleInterface) {
    this.ble = bleInterface;
    this.pendingAcks = new Map();
    this.ackTimeoutMs = 10000;
    this.maxRetries = 3;
    this.receivedAcks = new Set();
    this.maxReceivedAcks = 500;
    this.chunkSize = 400;
    this.chatChunkPayloadSize = 120; // conservador para cualquier MTU
    this.pendingFragments = new Map();
    this.maxFragmentAge = 300000;
    this.pendingOutgoingFiles = new Map(); // legacy, mantener compat
    this.pendingOutgoingTransfers = new Map(); // D2: unificado chat+file
    this.outgoingBlockAckTimeoutMs = 8000;
    this.blockAckTimers = new Map();

    // D3: Receptor Block ACK
    this._pendingBlockAcks = new Map(); // transferId -> { deviceId, ts }
    this._blockAckFlushInterval = null;

    this._startCleanupInterval();
    this._startBlockAckFlushTimer();
  }

  // ========== D2: RESUMEN DE TRANSFERENCIAS ROTAS AL INICIAR ==========
  resumeOutgoingTransfers() {
    var self = this;
    if (!window.vaultGetPendingOutgoingTransfers) return;
    var contacts = (window.vaultLoadContacts && window.vaultLoadContacts()) || [];
    contacts.forEach(function(contact) {
      var nx = (contact.nexoId || '').toString().trim();
      if (!nx) return;
      window.vaultGetPendingOutgoingTransfers(nx).then(function(list) {
        if (!list || list.length === 0) return;
        list.forEach(function(tx) {
          if (tx.status === 'complete' || tx.status === 'failed') return;
          console.log('[BleAckSystem] Retomando outgoing transfer:', tx.transferId, tx.type);
          var sentArr = (tx.sentMask || '').split('').map(function(c){return c==='1';});
          var ackArr = (tx.ackMask || '').split('').map(function(c){return c==='1';});
          self.pendingOutgoingTransfers.set(tx.transferId, {
            transferId: tx.transferId,
            deviceId: tx.deviceId,
            type: tx.type,
            chunks: tx.chunks || [],
            total: tx.totalChunks,
            sentMask: sentArr,
            ackMask: ackArr,
            meta: tx.meta || {},
            contactNexoId: nx,
            status: tx.status || 'sending',
            resolve: function(){},
            reject: function(){},
            startTime: tx.createdAt,
            blockAckTimeouts: tx.blockAckTimeouts || 0,
            legacy: true
          });
          setTimeout(function() {
            self._resendAllMissing(tx.transferId);
          }, 2000);
        });
      }).catch(function(e){});
    });
  }

  // ========== D3: TIMER BLOCK ACK RECEPTOR ==========
  _startBlockAckFlushTimer() {
    var self = this;
    if (self._blockAckFlushInterval) clearInterval(self._blockAckFlushInterval);
    self._blockAckFlushInterval = setInterval(function() {
      self._flushBlockAcks();
    }, 2000);
  }

  _scheduleBlockAck(transferId, deviceId) {
    this._pendingBlockAcks.set(transferId, { deviceId: deviceId, ts: Date.now() });
  }

  _sendBlockAck(deviceId, transferId, mask, count) {
    var payload = JSON.stringify({
      v: 1,
      type: 'block_ack',
      transferId: transferId,
      receivedMask: mask,
      receivedCount: count,
      ts: Date.now()
    });
    if (this.ble && typeof this.ble._sendMessageNative === 'function') {
      this.ble._sendMessageNative(deviceId, payload, null).catch(function(){});
    }
  }

  _flushBlockAcks() {
    var self = this;
    if (self._pendingBlockAcks.size === 0) return;
    self._pendingBlockAcks.forEach(function(info, transferId) {
      var buf = self.pendingFragments.get(transferId);
      if (!buf) {
        self._pendingBlockAcks.delete(transferId);
        return;
      }
      var maskArr = [];
      for (var i = 0; i < buf.total; i++) {
        maskArr.push(buf.chunks.has(i) ? '1' : '0');
      }
      self._sendBlockAck(info.deviceId, transferId, maskArr.join(''), buf.received);
    });
    self._pendingBlockAcks.clear();
  }

  _completeIncomingTransfer(contactNexoId, transferId, type, deviceId, totalChunks) {
    var self = this;
    if (!window.vaultCompleteTransfer) return;
    window.vaultCompleteTransfer(contactNexoId, transferId).then(function(msg) {
      if (!msg) {
        // FIX v1.5.1: Fallback — ensamblar desde pendingFragments en memoria
        var buf = self.pendingFragments.get(transferId);
        if (buf && buf.received >= buf.total) {
          var assembled = '';
          for (var i = 0; i < buf.total; i++) {
            assembled += buf.chunks.has(i) ? buf.chunks.get(i) : '';
          }
          if (type === 'chat') {
            self._dispatchChunkedMessageComplete(transferId, assembled, buf.meta, deviceId);
          } else if (type === 'file') {
            self._dispatchFileComplete(transferId, assembled, buf.meta);
            self._dispatchFileProgress(transferId, totalChunks, totalChunks, 'received', 100);
          }
          self.pendingFragments.delete(transferId);
          self._pendingBlockAcks.delete(transferId);
        }
        return;
      }
      if (type === 'chat') {
        try {
          window.dispatchEvent(new CustomEvent('nexo:ble:messageReceived', {
            detail: {
              deviceId: deviceId,
              deviceUUID: msg.senderNexoId,
              content: msg.content,
              senderName: msg.senderName,
              senderNexoId: msg.senderNexoId,
              messageId: msg.msgId,
              source: 'ble',
              timestamp: msg.timestamp,
              seq: msg.seq
            }
          }));
        } catch (e) {}
      } else if (type === 'file') {
        self._dispatchFileComplete(transferId, msg.attachmentPayload, msg.attachmentMeta);
        self._dispatchFileProgress(transferId, totalChunks, totalChunks, 'received', 100);
      }
    }).catch(function(e) {
      console.error('[BleAckSystem] Error completando transferencia vault:', e);
    });
  }

  // ========== ACK SIMPLE (mensajes cortos) ==========

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
      self._dispatchStatus(msgId, 'sending');
      self._doSend(entry);
    });
  }

  _doSend(entry) {
    var self = this;
    self._dispatchStatus(entry.msgId, 'sending');
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

  // ========== D2: OUTGOING TRANSFER UNIFICADO (chat + file) ==========

  _resolveNexoId(deviceId) {
    if (!this.ble) return null;
    var nd = _normMac(deviceId);
    return this.ble._macToNexoId.get(nd) || null;
  }

  _resolveDeviceId(nexoId) {
    if (!this.ble) return null;
    return this.ble._nexoIdToMac.get(nexoId.toLowerCase().trim()) || null;
  }

  _startOutgoingTransfer(deviceId, transferId, type, content, meta, chunkSize, batchSize) {
    var self = this;
    return new Promise(function(resolve, reject) {
      var chunks = self._splitIntoChunks(content, chunkSize);
      var total = chunks.length;
      if (total === 0) { reject(new Error('Contenido vacio')); return; }
      if (total === 1 && type === 'chat') {
        self.sendWithRetry(deviceId, content, transferId).then(resolve).catch(reject);
        return;
      }

      var msgId = transferId || ('msg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6));
      var senderId = (self.ble && self.ble.localNexoId) ? self.ble.localNexoId : ((self.ble && self.ble.localDeviceUUID) ? self.ble.localDeviceUUID : 'unknown');
      var finalMeta = Object.assign({}, meta || {}, {
        fromName: (self.ble && self.ble.localDeviceName) ? self.ble.localDeviceName : 'NEXO',
        from: senderId,
        ts: Date.now()
      });

      var contactNexoId = self._resolveNexoId(deviceId);
      if (contactNexoId && window.vaultCreateOutgoingTransfer) {
        window.vaultCreateOutgoingTransfer(contactNexoId, msgId, type, total, chunks, finalMeta, deviceId).catch(function(e){});
      }

      var tx = {
        transferId: msgId,
        deviceId: deviceId,
        type: type,
        chunks: chunks,
        total: total,
        sentMask: new Array(total).fill(false),
        ackMask: new Array(total).fill(false),
        meta: finalMeta,
        contactNexoId: contactNexoId,
        senderId: senderId,
        status: 'sending',
        resolve: resolve,
        reject: reject,
        startTime: Date.now(),
        blockAckTimeouts: 0,
        blockAckTimer: null,
        legacy: false
      };
      self.pendingOutgoingTransfers.set(msgId, tx);
      if (type === 'file') self.pendingOutgoingFiles.set(msgId, { deviceId: deviceId, chunks: chunks, total: total, sent: 0, meta: finalMeta, senderId: senderId, startTime: Date.now() });

      var metaPayload = type === 'chat' ? {
        v: 1, type: 'chat_meta', msgId: msgId, totalChunks: total, meta: finalMeta, from: senderId, ts: Date.now()
      } : {
        v: 1, type: 'file_meta', fileId: msgId, totalChunks: total, meta: finalMeta, from: senderId, ts: Date.now()
      };

      var metaStr = JSON.stringify(metaPayload);
      var metaMsgId = 'meta_' + msgId;
      function trySendMeta(attempt) {
        self.ble._sendMessageNative(deviceId, metaStr, metaMsgId)
          .then(function() {
            self._dispatchFileProgress(msgId, 0, total, 'sending', 0);
            self._sendNextBatch(msgId);
          })
          .catch(function(err) {
            if (attempt < 2) {
              setTimeout(function() { trySendMeta(attempt + 1); }, 1000 * (attempt + 1));
            } else {
              self.pendingOutgoingTransfers.delete(msgId);
              self.pendingOutgoingFiles.delete(msgId);
              if (contactNexoId && window.vaultSetOutgoingStatus) {
                window.vaultSetOutgoingStatus(contactNexoId, msgId, 'failed').catch(function(){});
              }
              reject(err);
            }
          });
      }
      trySendMeta(0);
    });
  }

  _sendNextBatch(transferId) {
    var self = this;
    var tx = self.pendingOutgoingTransfers.get(transferId);
    if (!tx || tx.status === 'complete') return;

    var batchSize = tx.type === 'chat' ? 3 : 5;
    var start = -1;
    for (var i = 0; i < tx.total; i++) {
      if (!tx.sentMask[i]) { start = i; break; }
    }
    if (start === -1) {
      self._startBlockAckTimer(transferId, true);
      return;
    }

    var end = Math.min(start + batchSize, tx.total);
    var indicesToSend = [];
    for (var i = start; i < end; i++) {
      if (!tx.sentMask[i]) {
        tx.sentMask[i] = true;
        indicesToSend.push(i);
      }
    }
    self._persistOutgoingMask(tx);

    var sendOne = function(idx) {
      var payload = tx.type === 'chat' ? {
        v: 1, type: 'chat_chunk', msgId: transferId, idx: idx, total: tx.total,
        data: tx.chunks[idx], from: tx.senderId
      } : {
        v: 1, type: 'file_chunk', fileId: transferId, idx: idx, total: tx.total,
        data: tx.chunks[idx], from: tx.senderId
      };
      return self.ble._sendMessageNative(tx.deviceId, JSON.stringify(payload), transferId + '_' + idx);
    };

    var p = indicesToSend.map(function(idx) { return sendOne(idx); });
    Promise.all(p).then(function() {
      tx.lastBatchEnd = end - 1;
      self._startBlockAckTimer(transferId, false);
      if (end < tx.total) {
        setTimeout(function() { self._sendNextBatch(transferId); }, 100);
      } else {
        self._startBlockAckTimer(transferId, true);
      }
    }).catch(function(err) {
      indicesToSend.forEach(function(idx) { tx.sentMask[idx] = false; });
      self._persistOutgoingMask(tx);
      setTimeout(function() { self._sendNextBatch(transferId); }, 1000);
    });
  }

  _startBlockAckTimer(transferId, isFinal) {
    var self = this;
    var tx = self.pendingOutgoingTransfers.get(transferId);
    if (!tx) return;
    if (tx.blockAckTimer) clearTimeout(tx.blockAckTimer);
    var timeout = isFinal ? 10000 : 6000;
    tx.blockAckTimer = setTimeout(function() {
      self._onBlockAckTimeout(transferId);
    }, timeout);
  }

  _onBlockAckTimeout(transferId) {
    var self = this;
    var tx = self.pendingOutgoingTransfers.get(transferId);
    if (!tx) return;

    var allAcked = tx.ackMask.every(function(v) { return v; });
    if (allAcked) {
      self._completeOutgoingTransfer(transferId);
      return;
    }

    tx.blockAckTimeouts = (tx.blockAckTimeouts || 0) + 1;

    if (tx.blockAckTimeouts >= 3) {
      console.warn('[BleAckSystem] Receptor sin block_ack (legacy). Resolviendo transfer:', transferId);
      self._completeOutgoingTransfer(transferId);
      return;
    }

    if (tx.contactNexoId && window.vaultIncrementOutgoingTimeout) {
      window.vaultIncrementOutgoingTimeout(tx.contactNexoId, transferId).catch(function(){});
    }

    var missing = [];
    for (var i = 0; i < tx.total; i++) {
      if (!tx.ackMask[i]) missing.push(i);
    }

    if (missing.length === 0) {
      self._completeOutgoingTransfer(transferId);
      return;
    }

    console.log('[BleAckSystem] Block ACK timeout #' + tx.blockAckTimeouts + ', reenviando ' + missing.length + ' chunks:', transferId);
    self._sendMissingChunks(transferId, missing);
  }

  _sendMissingChunks(transferId, indices) {
    var self = this;
    var tx = self.pendingOutgoingTransfers.get(transferId);
    if (!tx) return;
    var batchSize = 3;
    var current = 0;

    function sendNext() {
      if (current >= indices.length) {
        self._startBlockAckTimer(transferId, true);
        return;
      }
      var batch = indices.slice(current, current + batchSize);
      var promises = batch.map(function(idx) {
        tx.sentMask[idx] = true;
        var payload = tx.type === 'chat' ? {
          v: 1, type: 'chat_chunk', msgId: transferId, idx: idx, total: tx.total,
          data: tx.chunks[idx], from: tx.senderId
        } : {
          v: 1, type: 'file_chunk', fileId: transferId, idx: idx, total: tx.total,
          data: tx.chunks[idx], from: tx.senderId
        };
        return self.ble._sendMessageNative(tx.deviceId, JSON.stringify(payload), transferId + '_' + idx);
      });
      self._persistOutgoingMask(tx);
      Promise.all(promises).then(function() {
        current += batchSize;
        setTimeout(sendNext, 50);
      }).catch(function() {
        setTimeout(sendNext, 500);
      });
    }
    sendNext();
  }

  _resendAllMissing(transferId) {
    var tx = this.pendingOutgoingTransfers.get(transferId);
    if (!tx) return;
    var missing = [];
    for (var i = 0; i < tx.total; i++) {
      if (!tx.ackMask[i]) missing.push(i);
    }
    if (missing.length > 0) this._sendMissingChunks(transferId, missing);
    else this._completeOutgoingTransfer(transferId);
  }

  _processBlockAck(msg) {
    var self = this;
    var transferId = msg.transferId;
    var tx = self.pendingOutgoingTransfers.get(transferId);
    if (!tx) {
      console.log('[BleAckSystem] Block ACK para transfer desconocida o ya completada:', transferId);
      return;
    }

    var mask = msg.receivedMask || '';
    var count = msg.receivedCount || 0;

    for (var i = 0; i < Math.min(mask.length, tx.total); i++) {
      tx.ackMask[i] = mask.charAt(i) === '1';
    }
    self._persistOutgoingMask(tx);

    if (tx.blockAckTimer) {
      clearTimeout(tx.blockAckTimer);
      tx.blockAckTimer = null;
    }

    if (count >= tx.total || tx.ackMask.every(function(v){return v;})) {
      console.log('[BleAckSystem] Block ACK completo para', transferId);
      self._completeOutgoingTransfer(transferId);
      return;
    }

    console.log('[BleAckSystem] Block ACK parcial:', count + '/' + tx.total, 'faltan', tx.total - count);

    var missing = [];
    for (var i = 0; i < tx.total; i++) {
      if (!tx.ackMask[i]) missing.push(i);
    }
    if (missing.length > 0) {
      for (var i = 0; i < tx.total; i++) {
        if (!tx.ackMask[i]) tx.sentMask[i] = false;
      }
      self._persistOutgoingMask(tx);
      self._sendMissingChunks(transferId, missing);
    }
  }

  _completeOutgoingTransfer(transferId) {
    var self = this;
    var tx = self.pendingOutgoingTransfers.get(transferId);
    if (!tx) return;

    if (tx.blockAckTimer) clearTimeout(tx.blockAckTimer);
    tx.status = 'complete';
    self.pendingOutgoingTransfers.delete(transferId);
    self.pendingOutgoingFiles.delete(transferId);

    if (tx.contactNexoId && window.vaultRemoveOutgoingTransfer) {
      window.vaultRemoveOutgoingTransfer(tx.contactNexoId, transferId).catch(function(){});
    }

    if (tx.type === 'file') {
      self._dispatchFileProgress(transferId, tx.total, tx.total, 'sent', 100);
    }

    if (!tx.legacy) {
      tx.resolve();
      self._dispatchStatus(transferId, 'delivered');
    }
  }

  _persistOutgoingMask(tx) {
    if (!tx.contactNexoId || !window.vaultSetOutgoingChunkAcked) return;
    var sentStr = tx.sentMask.map(function(v){return v?'1':'0';}).join('');
    var ackStr = tx.ackMask.map(function(v){return v?'1':'0';}).join('');
    window.vaultSetOutgoingChunkAcked(tx.contactNexoId, tx.transferId, sentStr, ackStr).catch(function(e){});
  }

  // ========== API PÚBLICA: CHAT CHUNKED ==========

  sendChunkedMessage(deviceId, content, meta, messageId) {
    return this._startOutgoingTransfer(deviceId, messageId, 'chat', content, meta, this.chatChunkPayloadSize, 3);
  }

  // ========== API PÚBLICA: ENVÍO DE ARCHIVOS ==========

  sendFile(deviceId, fileId, base64Data, meta) {
    return this._startOutgoingTransfer(deviceId, fileId, 'file', base64Data, meta, this.chunkSize, 5);
  }

  cancelFileSend(fileId) {
    var tx = this.pendingOutgoingTransfers.get(fileId);
    if (tx && tx.contactNexoId && window.vaultSetOutgoingStatus) {
      window.vaultSetOutgoingStatus(tx.contactNexoId, fileId, 'cancelled').catch(function(){});
    }
    this.pendingOutgoingTransfers.delete(fileId);
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

  // ========== RECEPTOR: D3 Block ACK ==========

  processIncomingFragment(dataObj) {
    try {
      var deviceId = dataObj.deviceId;
      var content = dataObj.content;
      var msg = JSON.parse(content);

      // D2: Block ACK desde el receptor (emisor lo procesa)
      if (msg.type === 'block_ack') {
        this._processBlockAck(msg);
        return true;
      }

      // D3: CHAT META
      if (msg.type === 'chat_meta') {
        this.pendingFragments.set(msg.msgId, {
          chunks: new Map(),
          total: msg.totalChunks,
          received: 0,
          meta: msg.meta || {},
          lastActivity: Date.now(),
          isChat: true
        });
        var senderId = msg.from || (msg.meta && msg.meta.from) || 'unknown';
        if (window.vaultCreateTransfer) {
          window.vaultCreateTransfer(senderId, msg.msgId, 'chat', msg.totalChunks, msg.meta).catch(function(){});
        }
        this._scheduleBlockAck(msg.msgId, deviceId);
        return true;
      }

      // D3: CHAT CHUNK
      if (msg.type === 'chat_chunk') {
        var buf = this.pendingFragments.get(msg.msgId);
        if (!buf) {
          this.pendingFragments.set(msg.msgId, {
            chunks: new Map(),
            total: msg.total,
            received: 0,
            meta: { fromName: 'NEXO', from: msg.from || 'unknown' },
            lastActivity: Date.now(),
            isChat: true
          });
          buf = this.pendingFragments.get(msg.msgId);
        }
        if (!buf.chunks.has(msg.idx)) {
          buf.chunks.set(msg.idx, msg.data);
          buf.received++;
          buf.lastActivity = Date.now();
        }

        var senderId = msg.from || (buf.meta && buf.meta.from) || 'unknown';
        var self = this;

        if (window.vaultAppendChunk) {
          window.vaultAppendChunk(senderId, msg.msgId, msg.idx, msg.data, msg.total, buf.meta).then(function() {
            if (buf.received >= buf.total) {
              var maskArr = [];
              for (var i = 0; i < buf.total; i++) maskArr.push(buf.chunks.has(i) ? '1' : '0');
              self._sendBlockAck(deviceId, msg.msgId, maskArr.join(''), buf.received);
              self._completeIncomingTransfer(senderId, msg.msgId, 'chat', deviceId, buf.total);
              self.pendingFragments.delete(msg.msgId);
              self._pendingBlockAcks.delete(msg.msgId);
            } else {
              self._scheduleBlockAck(msg.msgId, deviceId);
            }
          }).catch(function(e){});
        } else {
          // Legacy sin vault
          if ((msg.idx + 1) % 3 === 0 || msg.idx === msg.total - 1) {
            this.sendAck(deviceId, msg.msgId + '_' + msg.idx);
          }
          if (buf.received >= buf.total) {
            var assembled = '';
            for (var i = 0; i < buf.total; i++) assembled += buf.chunks.has(i) ? buf.chunks.get(i) : '';
            this.pendingFragments.delete(msg.msgId);
            this._dispatchChunkedMessageComplete(msg.msgId, assembled, buf.meta, deviceId);
          }
        }
        return true;
      }

      // D3: FILE META
      if (msg.type === 'file_meta') {
        this.pendingFragments.set(msg.fileId, {
          chunks: new Map(),
          total: msg.totalChunks,
          received: 0,
          meta: msg.meta || {},
          lastActivity: Date.now()
        });
        var senderId = msg.from || (msg.meta && msg.meta.from) || 'unknown';
        if (window.vaultCreateTransfer) {
          window.vaultCreateTransfer(senderId, msg.fileId, 'file', msg.totalChunks, msg.meta).catch(function(){});
        }
        this._scheduleBlockAck(msg.fileId, deviceId);
        this._dispatchFileProgress(msg.fileId, 0, msg.totalChunks, 'receiving');
        return true;
      }

      // D3: FILE CHUNK
      if (msg.type === 'file_chunk') {
        var buf = this.pendingFragments.get(msg.fileId);
        if (!buf) {
          this._requestResume(deviceId, msg.fileId);
          return true;
        }
        if (!buf.chunks.has(msg.idx)) {
          buf.chunks.set(msg.idx, msg.data);
          buf.received++;
          buf.lastActivity = Date.now();
        }

        var senderId = msg.from || (buf.meta && buf.meta.from) || 'unknown';
        var self = this;
        var progress = Math.floor((buf.received / buf.total) * 100);
        this._dispatchFileProgress(msg.fileId, buf.received, buf.total, 'receiving', progress);

        if (window.vaultAppendChunk) {
          window.vaultAppendChunk(senderId, msg.fileId, msg.idx, msg.data, buf.total, buf.meta).then(function() {
            if (buf.received >= buf.total) {
              var maskArr = [];
              for (var i = 0; i < buf.total; i++) maskArr.push(buf.chunks.has(i) ? '1' : '0');
              self._sendBlockAck(deviceId, msg.fileId, maskArr.join(''), buf.received);
              self._completeIncomingTransfer(senderId, msg.fileId, 'file', deviceId, buf.total);
              self.pendingFragments.delete(msg.fileId);
              self._pendingBlockAcks.delete(msg.fileId);
            } else {
              self._scheduleBlockAck(msg.fileId, deviceId);
            }
          }).catch(function(e){});
        } else {
          // Legacy sin vault
          if ((msg.idx + 1) % 5 === 0 || msg.idx === msg.total - 1) {
            this.sendAck(deviceId, msg.fileId + '_' + msg.idx);
          }
          if (buf.received >= buf.total) {
            var assembled = '';
            for (var i = 0; i < buf.total; i++) assembled += buf.chunks.has(i) ? buf.chunks.get(i) : '';
            this.pendingFragments.delete(msg.fileId);
            this._dispatchFileComplete(msg.fileId, assembled, buf.meta);
            this._dispatchFileProgress(msg.fileId, buf.total, buf.total, 'received', 100);
          }
        }
        return true;
      }

      if (msg.type === 'file_resume') {
        var track = this.pendingOutgoingFiles.get(msg.fileId);
        if (track) {
          console.log('[BleAckSystem] Reanudando archivo', msg.fileId);
          this.sendFile(deviceId, msg.fileId, track.chunks.join(''), track.meta)
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

  _dispatchChunkedMessageComplete(msgId, content, meta, deviceId) {
    var senderName = meta.fromName || 'NEXO';
    var senderId = meta.from || 'unknown';
    var vaultMsg = {
      messageId: msgId,
      content: content,
      _own: false,
      status: 'delivered',
      timestamp: Date.now(),
      senderName: senderName,
      senderNexoId: senderId,
      seq: 0
    };
    try {
      if (window.vaultAppendMessage) {
        window.vaultAppendMessage(senderId, vaultMsg, false).catch(function() {});
      }
    } catch (e) {}
    try {
      window.dispatchEvent(new CustomEvent('nexo:ble:messageReceived', {
        detail: {
          deviceId: deviceId,
          deviceUUID: senderId,
          content: content,
          senderName: senderName,
          senderNexoId: senderId,
          messageId: msgId,
          source: 'ble',
          timestamp: Date.now(),
          seq: 0
        }
      }));
    } catch (e) {}
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
      self.pendingOutgoingFiles.forEach(function(track, fileId) {
        if (now - track.startTime > self.maxFragmentAge) {
          self.pendingOutgoingFiles.delete(fileId);
        }
      });
      self.pendingOutgoingTransfers.forEach(function(tx, id) {
        if (now - tx.startTime > self.maxFragmentAge * 2) {
          if (tx.blockAckTimer) clearTimeout(tx.blockAckTimer);
          self.pendingOutgoingTransfers.delete(id);
          if (tx.contactNexoId && window.vaultSetOutgoingStatus) {
            window.vaultSetOutgoingStatus(tx.contactNexoId, id, 'failed').catch(function(){});
          }
          if (!tx.legacy) tx.reject(new Error('Timeout global transferencia'));
        }
      });
    }, 30000);
  }
}

export function createAckSystem(bleInterface) {
  return new BleAckSystem(bleInterface);
}
