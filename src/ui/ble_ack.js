/**
 * ble_ack.js — Sistema ACK real + fragmentación para NEXO
 * v1.0
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
      if (ack.type !== 'ack' || !ack.msgId) return false;
      var entry = this.pendingAcks.get(ack.msgId);
      if (entry) {
        clearTimeout(entry.timer);
        this.pendingAcks.delete(ack.msgId);
        entry.resolve();
        this._dispatchStatus(ack.msgId, 'delivered');
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

  sendFile(deviceId, fileId, base64Data, meta) {
    var self = this;
    return new Promise(function(resolve, reject) {
      var chunks = self._splitIntoChunks(base64Data, self.chunkSize);
      var total = chunks.length;
      var fileMeta = {
        v: 1,
        type: 'file_meta',
        fileId: fileId,
        totalChunks: total,
        meta: meta || {},
        from: (self.ble && self.ble.localNexoId) ? self.ble.localNexoId : ((self.ble && self.ble.localDeviceUUID) ? self.ble.localDeviceUUID : 'unknown'),
        ts: Date.now()
      };
      self.sendWithRetry(deviceId, JSON.stringify(fileMeta), 'meta_' + fileId)
        .then(function() {
          var sent = 0;
          function sendNext() {
            if (sent >= total) {
              resolve();
              return;
            }
            var chunkPayload = {
              v: 1,
              type: 'file_chunk',
              fileId: fileId,
              idx: sent,
              total: total,
              data: chunks[sent],
              from: (self.ble && self.ble.localNexoId) ? self.ble.localNexoId : ((self.ble && self.ble.localDeviceUUID) ? self.ble.localDeviceUUID : 'unknown')
            };
            var isBatchEnd = ((sent + 1) % 5 === 0) || (sent === total - 1);
            var msgId = 'chunk_' + fileId + '_' + sent;
            if (isBatchEnd) {
              self.sendWithRetry(deviceId, JSON.stringify(chunkPayload), msgId)
                .then(function() { sent++; sendNext(); })
                .catch(function(err) { reject(err); });
            } else {
              if (self.ble && typeof self.ble._sendMessageNative === 'function') {
                self.ble._sendMessageNative(deviceId, JSON.stringify(chunkPayload), msgId)
                  .then(function() { sent++; sendNext(); })
                  .catch(function(err) { reject(err); });
              } else {
                reject(new Error('BLE interface no disponible'));
              }
            }
          }
          sendNext();
        })
        .catch(function(err) { reject(err); });
    });
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
        return true;
      }
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
        if ((msg.idx + 1) % 5 === 0 || msg.idx === msg.total - 1) {
          this.sendAck(deviceId, msg.fileId + '_' + msg.idx);
        }
        if (buf.received >= buf.total) {
          var assembled = '';
          for (var i = 0; i < buf.total; i++) {
            assembled += buf.chunks.has(i) ? buf.chunks.get(i) : '';
          }
          this.pendingFragments.delete(msg.fileId);
          this._dispatchFileComplete(msg.fileId, assembled, buf.meta);
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

  _dispatchFileComplete(fileId, data, meta) {
    try {
      window.dispatchEvent(new CustomEvent('nexo:ble:fileComplete', { detail: { fileId: fileId, data: data, meta: meta } }));
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
    }, 30000);
  }
}

export function createAckSystem(bleInterface) {
  return new BleAckSystem(bleInterface);
}
