/**
 * ble_ack.js v2.1.1-FIX
 * FIX: sendWithRetry acepta y preserva seq en reintentos de mensajes largos
 * FIX: sendChunkedMessage genera seq defensivamente si no viene
 * FIX: ChatStream._buildChunk incluye seq directo en payload chunk 0
 * FIX: _dispatchChunkedMessageComplete ya NO duplica vaultAppendMessage (main.js lo maneja)
 * Base: v2.1.0-TURBO-FIX2
 */

function _normMac(mac) {
  return (mac || '').toString().toLowerCase().replace(/[:-]/g, '').trim();
}

function _normId(id) {
  return (id || '').toString().toLowerCase().trim();
}

export class BleAckSystem {
  constructor(bleInterface) {
    this.ble = bleInterface;
    this.pendingAcks = new Map();
    this.ackTimeoutMs = 8000;
    this.maxRetries = 3;
    this.receivedAcks = new Set();
    this.maxReceivedAcks = 500;

    // FIX v2.1.0: chunkSize dinámico por plataforma
    var platform = (window.Capacitor && window.Capacitor.getPlatform) ? window.Capacitor.getPlatform() : 'android';
    this.chunkSize = (platform === 'ios') ? 130 : 400;
    this.windowSize = 3;
    this.windowTimeoutMs = 4000;

    this.outgoingStreams = new Map();
    this.incomingBuffers = new Map();

    this.pendingFragments = new Map();
    this.maxFragmentAge = 300000;
    this.pendingOutgoingFiles = new Map();
    this.pendingOutgoingTransfers = new Map();
    this.blockAckTimers = new Map();

    this._startCleanupInterval();
  }

  // FIX v2.1.0: Resolver nexoId desde deviceId (MAC)
  _resolveNexoId(deviceId) {
    var mac = _normMac(deviceId);
    if (this.ble && this.ble._macToNexoId) {
      var nx = this.ble._macToNexoId.get(mac);
      if (nx) return nx;
    }
    var contacts = (typeof _getBLEContacts === 'function') ? _getBLEContacts() : [];
    for (var i = 0; i < contacts.length; i++) {
      if (_normMac(contacts[i].deviceId) === mac) return _normId(contacts[i].nexoId);
    }
    return mac;
  }

  sendChunkedMessage(deviceId, content, meta, messageId, seq) {
    var self = this;
    return new Promise(function(resolve, reject) {
      var msgId = messageId || ('msg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6));
      var senderId = (self.ble && self.ble.localNexoId) || ((self.ble && self.ble.localDeviceUUID) ? self.ble.localDeviceUUID : 'unknown');
      var fromName = (self.ble && self.ble.localDeviceName) || 'NEXO';
      var ts = Date.now();
      var finalMeta = Object.assign({}, meta || {}, { f: fromName, fr: senderId, ts: ts });

      // FIX v2.1.1: Generar seq defensivamente si no viene
      if (typeof seq !== 'number') {
        seq = (self.ble && typeof self.ble.getNextSeq === 'function') ? self.ble.getNextSeq() : 0;
      }
      finalMeta.seq = seq;

      if (content.length <= 180) {
        self.sendWithRetry(deviceId, content, msgId, seq).then(resolve).catch(reject);
        return;
      }
      var stream = new ChatStream(self, deviceId, msgId, content, finalMeta, self.chunkSize, self.windowSize, self.windowTimeoutMs);
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
    return new Promise(function(resolve, reject) {
      var senderId = (self.ble && self.ble.localNexoId) || ((self.ble && self.ble.localDeviceUUID) ? self.ble.localDeviceUUID : 'unknown');
      var fromName = (self.ble && self.ble.localDeviceName) || 'NEXO';
      var finalMeta = Object.assign({}, meta || {}, { f: fromName, fr: senderId, ts: Date.now(), file: true });
      var stream = new ChatStream(self, deviceId, fileId, base64Data, finalMeta, self.chunkSize, self.windowSize, self.windowTimeoutMs, 'file');
      self.outgoingStreams.set(fileId, stream);
      stream.start().then(function() {
        self.outgoingStreams.delete(fileId);
        resolve();
      }).catch(function(err) {
        self.outgoingStreams.delete(fileId);
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

      if (type === 'block_ack') { this._processBlockAck(msg); return true; }
      if (type === 'ack' || type === 'read_receipt') { this.processIncomingAck(content); return true; }
      if (type === 'ping' || type === 'pong') { return false; }
      if (type === 'n') { this._handleNack(msg); return true; }
      if (type === 'a') { this._handleChunkAck(msg); return true; }
      if (type === 'ss') { this._handleSessionSync(deviceId, msg); return true; }
      if (type === 'sr') { this._handleSessionSyncResponse(deviceId, msg); return true; }
      if (type === 'c' || type === 'f') {
        this._handleIncomingChunk(deviceId, msg, type);
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
    var seq = (typeof msg.seq === 'number') ? msg.seq : ((msg.meta && typeof msg.meta.seq === 'number') ? msg.meta.seq : 0);

    if (!msgId || typeof idx !== 'number' || typeof total !== 'number') return;

    var buf = self.incomingBuffers.get(msgId);
    if (!buf) {
      buf = {
        chunks: new Map(), total: total,
        meta: msg.meta || { f: msg.f || 'NEXO', fr: from || 'unknown', ts: msg.ts || Date.now(), seq: seq },
        received: 0, deviceId: deviceId, lastActivity: Date.now(),
        isChat: type === 'c', nackSent: false
      };
      self.incomingBuffers.set(msgId, buf);
      var senderId = from || (buf.meta && buf.meta.fr) || 'unknown';
      if (window.vaultCreateTransfer) {
        window.vaultCreateTransfer(senderId, msgId, type === 'c' ? 'chat' : 'file', total, buf.meta).catch(function(){});
      }
    }

    if (!buf.chunks.has(idx)) {
      buf.chunks.set(idx, data || '');
      buf.received++;
      buf.lastActivity = Date.now();
    }

    var senderId = from || (buf.meta && buf.meta.fr) || 'unknown';
    if (window.vaultAppendChunk) {
      window.vaultAppendChunk(senderId, msgId, idx, data || '', total, buf.meta).catch(function(){});
    }

    if (idx > 0 && !buf.chunks.has(idx - 1) && !buf.nackSent) {
      var missing = self._findMissing(buf);
      if (missing.length > 0) {
        self._sendNack(deviceId, msgId, missing);
        buf.nackSent = true;
        setTimeout(function() { buf.nackSent = false; }, 2000);
      }
    }

    if (buf.received >= buf.total) {
      self._assembleAndDispatch(buf, deviceId, senderId, msgId);
      return;
    }

    if ((idx + 1) % self.windowSize === 0 || idx === total - 1) {
      var ackMask = [];
      for (var i = 0; i < total; i++) ackMask.push(buf.chunks.has(i) ? '1' : '0');
      self._sendChunkAck(deviceId, msgId, ackMask.join(''), buf.received, false);
    }
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

    self._sendChunkAck(deviceId, msgId, null, buf.total, true);

    if (buf.isChat) {
      self._dispatchChunkedMessageComplete(senderId, assembled, buf.meta, deviceId, msgId);
    } else {
      self._dispatchFileComplete(senderId, assembled, buf.meta);
      self._dispatchFileProgress(senderId, buf.total, buf.total, 'received', 100);
    }

    self.incomingBuffers.delete(msgId);

    if (window.vaultCompleteTransfer) {
      window.vaultCompleteTransfer(senderId, msgId).catch(function(){});
    }
  }

  _sendNack(deviceId, msgId, indices) {
    var payload = JSON.stringify({ t: 'n', m: msgId, k: indices });
    if (this.ble && this.ble._sendMessageNative) {
      this.ble._sendMessageNative(deviceId, payload, null).catch(function(){});
    }
  }

  _sendChunkAck(deviceId, msgId, mask, count, isFinal) {
    var payload = JSON.stringify({ t: 'a', m: msgId, r: mask, c: count, f: isFinal ? 1 : 0 });
    if (this.ble && this.ble._sendMessageNative) {
      this.ble._sendMessageNative(deviceId, payload, null).catch(function(){});
    }
  }

  _handleNack(msg) {
    var msgId = msg.m;
    var indices = msg.k || [];
    var stream = this.outgoingStreams.get(msgId);
    if (stream) stream.handleNack(indices);
  }

  _handleChunkAck(msg) {
    var msgId = msg.m;
    var isFinal = msg.f === 1;
    var stream = this.outgoingStreams.get(msgId);
    if (stream) {
      if (isFinal) stream.handleFinalAck();
      else stream.handlePartialAck(msg.r, msg.c);
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
          var maxSeq = 0;
          msgs.forEach(function(m) { if (m.seq > maxSeq) maxSeq = m.seq; });
          myLastSeq = maxSeq;
        }
        var resp = JSON.stringify({ t: 'sr', fr: (self.ble && self.ble.localNexoId) || 'unknown', l: myLastSeq });
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
      var pending = msgs.filter(function(m) {
        return m._own === true && m.seq > peerLastSeq && (m.status === 'pending' || m.status === 'sent' || m.status === 'delivered');
      });
      if (pending.length === 0) return;
      console.log('[BleAckSystem] Sync: reenviando', pending.length, 'mensajes faltantes a', peerNexoId);
      var idx = 0;
      function sendNext() {
        if (idx >= pending.length) return;
        var m = pending[idx++];
        var txt = m.content || m.text || '';
        if (txt.length <= 180) {
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
        if (msgs && msgs.length > 0) {
          msgs.forEach(function(m) { if (m.seq > myLastSeq) myLastSeq = m.seq; });
        }
        var payload = JSON.stringify({ t: 'ss', fr: (self.ble && self.ble.localNexoId) || 'unknown', l: myLastSeq });
        if (self.ble && self.ble._sendMessageNative) {
          self.ble._sendMessageNative(deviceId, payload, null).catch(function(){});
        }
      }).catch(function(){});
    }
  }

  // FIX v2.1.1: sendWithRetry acepta seq y lo preserva en chunking
  sendWithRetry(deviceId, content, messageId, seq) {
    var self = this;
    if (content && content.length > 180) {
      return self.sendChunkedMessage(deviceId, content, {}, messageId, seq);
    }
    return new Promise(function(resolve, reject) {
      var msgId = messageId || ('msg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6));
      var entry = {
        msgId: msgId, deviceId: deviceId, content: content,
        resolve: resolve, reject: reject, retries: 0, timer: null, sentAt: Date.now()
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
      entry.reject(new Error('BLE no disponible'));
      self.pendingAcks.delete(entry.msgId);
      return;
    }
    self.ble._sendMessageNative(entry.deviceId, entry.content, entry.msgId)
      .then(function() {
        entry.timer = setTimeout(function() { self._onAckTimeout(entry.msgId); }, self.ackTimeoutMs);
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
    } catch (e) { return false; }
  }

  sendAck(deviceId, msgId) {
    var ackPayload = JSON.stringify({ v: 1, type: 'ack', msgId: msgId, from: (this.ble && this.ble.localNexoId) || 'unknown', ts: Date.now() });
    if (this.ble && this.ble._sendMessageNative) this.ble._sendMessageNative(deviceId, ackPayload, null).catch(function(){});
  }

  sendReadReceipt(deviceId, msgId) {
    var payload = JSON.stringify({ v: 1, type: 'read_receipt', msgId: msgId, from: (this.ble && this.ble.localNexoId) || 'unknown', ts: Date.now() });
    if (this.ble && this.ble._sendMessageNative) this.ble._sendMessageNative(deviceId, payload, null).catch(function(){});
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

  // FIX v2.1.0: Reanudar envíos rotos al iniciar
  resumeOutgoingTransfers() {
    var self = this;
    if (!window.vaultGetPendingOutgoingTransfers) return;
    var contacts = (typeof _getBLEContacts === 'function') ? _getBLEContacts() : [];
    contacts.forEach(function(contact) {
      var cid = _normId(contact.nexoId);
      if (!cid) return;
      window.vaultGetPendingOutgoingTransfers(cid).then(function(list) {
        if (!list || list.length === 0) return;
        console.log('[BleAckSystem] Resume:', list.length, 'outgoing para', cid);
        list.forEach(function(tx) {
          if (tx.status !== 'sending' && tx.status !== 'pending') return;
          var content = tx.chunks.map(function(c) { return c.data || ''; }).join('');
          var devId = tx.deviceId || contact.deviceId;
          if (!devId) return;
          self.sendChunkedMessage(devId, content, tx.meta, tx.transferId, (tx.meta && tx.meta.seq))
            .then(function() {
              if (window.vaultRemoveOutgoingTransfer) window.vaultRemoveOutgoingTransfer(cid, tx.transferId).catch(function(){});
            })
            .catch(function(){});
        });
      }).catch(function(){});
    });
  }

  // FIX v2.1.1: Ya NO llama vaultAppendMessage — main.js lo maneja via messageReceived
  _dispatchChunkedMessageComplete(senderId, content, meta, deviceId, msgId) {
    try {
      window.dispatchEvent(new CustomEvent('nexo:ble:messageReceived', {
        detail: {
          deviceId: deviceId, deviceUUID: meta.fr || senderId,
          content: content, senderName: meta.f || 'NEXO',
          senderNexoId: meta.fr || senderId, messageId: msgId || meta.msgId,
          source: 'ble', timestamp: Date.now(), seq: meta.seq || 0
        }
      }));
    } catch (e) {}
  }

  _dispatchStatus(msgId, status) {
    try { window.dispatchEvent(new CustomEvent('nexo:ble:ackStatus', { detail: { msgId: msgId, status: status } })); } catch (e) {}
  }

  _dispatchFileProgress(fileId, sent, total, status, percent) {
    try { window.dispatchEvent(new CustomEvent('nexo:ble:fileProgress', { detail: { fileId: fileId, sent: sent, total: total, status: status, percent: percent || 0 } })); } catch (e) {}
  }

  _dispatchFileComplete(fileId, data, meta) {
    try { window.dispatchEvent(new CustomEvent('nexo:ble:fileComplete', { detail: { fileId: fileId, data: data, meta: meta } })); } catch (e) {}
  }

  _startCleanupInterval() {
    var self = this;
    setInterval(function() {
      var now = Date.now();
      self.incomingBuffers.forEach(function(buf, msgId) {
        if (now - buf.lastActivity > self.maxFragmentAge) self.incomingBuffers.delete(msgId);
      });
      self.outgoingStreams.forEach(function(stream, msgId) {
        if (now - stream.startTime > self.maxFragmentAge * 2) { stream.abort(); self.outgoingStreams.delete(msgId); }
      });
      self.pendingAcks.forEach(function(entry, msgId) {
        if (now - entry.sentAt > self.maxFragmentAge) { clearTimeout(entry.timer); self.pendingAcks.delete(msgId); try { entry.reject(new Error('Timeout global')); } catch(e) {} }
      });
    }, 30000);
  }
}

function ChatStream(ackSystem, deviceId, msgId, content, meta, chunkSize, windowSize, windowTimeoutMs, type) {
  this.ackSystem = ackSystem;
  this.ble = ackSystem.ble;
  this.deviceId = deviceId;
  this.msgId = msgId;
  this.content = content;
  this.meta = meta;
  this.chunkSize = chunkSize;
  this.windowSize = windowSize;
  this.windowTimeoutMs = windowTimeoutMs;
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
  this.maxWindowRetries = 5;
  this.globalTimeout = null;
}

ChatStream.prototype.start = function() {
  var self = this;
  return new Promise(function(resolve, reject) {
    self.resolve = resolve;
    self.reject = reject;
    self._splitChunks();
    if (self.total === 0) { reject(new Error('Vacio')); return; }

    // FIX v2.1.0: Persistir outgoing en vault para reanudación
    if (window.vaultCreateOutgoingTransfer) {
      var cid = self.ackSystem._resolveNexoId(self.deviceId);
      window.vaultCreateOutgoingTransfer(cid, self.msgId, self.type, self.total, self.chunks, self.meta, self.deviceId).catch(function(){});
    }

    // Timeout global de 45s
    self.globalTimeout = setTimeout(function() {
      if (!self.aborted) {
        self.aborted = true;
        if (self.timer) clearTimeout(self.timer);
        self.reject(new Error('Timeout global 45s'));
        self.ackSystem._dispatchStatus(self.msgId, 'failed');
      }
    }, 45000);

    self._sendWindow();
  });
};

ChatStream.prototype._splitChunks = function() {
  var str = this.content;
  var size = this.chunkSize;
  var arr = [];
  for (var i = 0; i < str.length; i += size) {
    arr.push(str.substring(i, i + size));
  }
  this.chunks = arr;
  this.total = arr.length;
  this.sentMask = new Array(this.total).fill(false);
  this.ackedMask = new Array(this.total).fill(false);
};

ChatStream.prototype._sendWindow = function() {
  var self = this;
  if (self.aborted) return;
  var end = Math.min(self.windowStart + self.windowSize, self.total);
  var promises = [];
  for (var i = self.windowStart; i < end; i++) {
    if (!self.sentMask[i] || !self.ackedMask[i]) {
      self.sentMask[i] = true;
      var payload = self._buildChunk(i);
      promises.push(self.ble._sendMessageNative(self.deviceId, payload, self.msgId + '_' + i));
    }
  }
  Promise.all(promises).then(function() {
    self._startWindowTimer();
  }).catch(function(err) {
    setTimeout(function() { self._sendWindow(); }, 500);
  });
};

// FIX v2.1.1: seq incluido directo en payload del chunk 0 para robustez
ChatStream.prototype._buildChunk = function(idx) {
  var isFirst = idx === 0;
  var obj = {
    t: this.type === 'chat' ? 'c' : 'f',
    m: this.msgId,
    i: idx,
    n: this.total,
    d: this.chunks[idx]
  };
  if (isFirst) {
    obj.f = this.meta.f || 'NEXO';
    obj.fr = this.meta.fr || 'unknown';
    obj.ts = this.meta.ts || Date.now();
    obj.meta = this.meta;
    if (typeof this.meta.seq === 'number') obj.seq = this.meta.seq;
  }
  return JSON.stringify(obj);
};

ChatStream.prototype._startWindowTimer = function() {
  var self = this;
  if (self.timer) clearTimeout(self.timer);
  self.timer = setTimeout(function() {
    self._onWindowTimeout();
  }, self.windowTimeoutMs);
};

ChatStream.prototype._onWindowTimeout = function() {
  var self = this;
  if (self.aborted) return;
  var end = Math.min(self.windowStart + self.windowSize, self.total);
  var allAcked = true;
  for (var i = self.windowStart; i < end; i++) {
    if (!self.ackedMask[i]) { allAcked = false; break; }
  }
  if (allAcked) {
    self.windowStart = end;
    self.windowRetryCount = 0;
    if (self.windowStart >= self.total) {
      self._finish();
    } else {
      self._sendWindow();
    }
  } else {
    self.windowRetryCount++;
    if (self.windowRetryCount > self.maxWindowRetries) {
      console.warn('[ChatStream] Max window retries alcanzado para', self.msgId);
      self.abort();
      self.reject(new Error('Max window retries'));
      self.ackSystem._dispatchStatus(self.msgId, 'failed');
      return;
    }
    console.log('[ChatStream] Window timeout, reenviando ventana desde', self.windowStart, 'retry', self.windowRetryCount);
    self._sendWindow();
  }
};

ChatStream.prototype.handleNack = function(indices) {
  var self = this;
  if (self.timer) clearTimeout(self.timer);
  var promises = [];
  indices.forEach(function(idx) {
    if (idx >= 0 && idx < self.total) {
      self.sentMask[idx] = true;
      var payload = self._buildChunk(idx);
      promises.push(self.ble._sendMessageNative(self.deviceId, payload, self.msgId + '_' + idx));
    }
  });
  Promise.all(promises).then(function() {
    self._startWindowTimer();
  }).catch(function() {
    setTimeout(function() { self._sendWindow(); }, 500);
  });
};

ChatStream.prototype.handlePartialAck = function(mask, count) {
  var self = this;
  if (!mask) return;
  for (var i = 0; i < Math.min(mask.length, self.total); i++) {
    if (mask.charAt(i) === '1') self.ackedMask[i] = true;
  }
  while (self.windowStart < self.total && self.ackedMask[self.windowStart]) {
    self.windowStart++;
  }
  if (self.timer) clearTimeout(self.timer);
  if (self.windowStart >= self.total) {
    self._finish();
  } else {
    self._sendWindow();
  }
};

ChatStream.prototype.handleFinalAck = function() {
  if (this.timer) clearTimeout(this.timer);
  this._finish();
};

ChatStream.prototype._finish = function() {
  if (this.aborted) return;
  this.aborted = true;
  if (this.timer) clearTimeout(this.timer);
  if (this.globalTimeout) clearTimeout(this.globalTimeout);

  // FIX v2.1.0: Limpiar outgoing de vault al completar
  if (window.vaultRemoveOutgoingTransfer) {
    var cid = this.ackSystem._resolveNexoId(this.deviceId);
    window.vaultRemoveOutgoingTransfer(cid, this.msgId).catch(function(){});
  }

  this.resolve();
  this.ackSystem._dispatchStatus(this.msgId, 'delivered');
};

ChatStream.prototype.abort = function() {
  this.aborted = true;
  if (this.timer) clearTimeout(this.timer);
  if (this.globalTimeout) clearTimeout(this.globalTimeout);
  if (this.reject) this.reject(new Error('Abortado'));
};

export function createAckSystem(bleInterface) {
  return new BleAckSystem(bleInterface);
}
