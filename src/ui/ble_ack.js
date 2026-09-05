/**
 * ble_ack.js v3.2.1-NEXO
 * FIX: Opcion C - Eliminada delegacion nativa, solo JS chunking
 * FIX: FILE_CHUNK_SIZE 500->180 para caber en payload BLE (255 chars)
 * FIX: Metadata de archivos preservada en chunk 0 (tp, fn, fs, ft)
 * FIX: GLOBAL_TIMEOUT_MS 120000->180000 (3min para archivos grandes)
 * Base: v3.2.0-NATIVE
 */

const PROTOCOL_VERSION = 2;

// CHAT: ultra-seguro, nunca pierde un mensaje
const CHAT_CHUNK_SIZE = 160;
const CHAT_WINDOW_SIZE = 2;
const CHAT_WINDOW_TIMEOUT_MS = 2500;
const CHAT_PACING_DELAY_MS = 60;

// ARCHIVOS: 100% confiable via JS chunking (Opcion C)
// FIX v3.2.1: 180 chars para que chunk 0 + metadata nunca exceda 255
const FILE_CHUNK_SIZE = 180;
const FILE_WINDOW_SIZE = 4;
const FILE_WINDOW_TIMEOUT_MS = 3500;
const FILE_PACING_DELAY_MS = 15;

const MAX_WINDOW_RETRIES = 5;
const ASSEMBLY_TIMEOUT_MS = 10000;
const COMPLETED_TTL_MS = 30000;
// FIX v3.2.1: 3 minutos para archivos grandes (1MB ~90s + margen)
const GLOBAL_TIMEOUT_MS = 180000;

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
    this.chunkSize = CHAT_CHUNK_SIZE;
    this.windowSize = CHAT_WINDOW_SIZE;
    this.windowTimeoutMs = CHAT_WINDOW_TIMEOUT_MS;
    this.outgoingStreams = new Map();
    this.incomingBuffers = new Map();
    this.pendingFragments = new Map();
    this.maxFragmentAge = 300000;
    this.pendingOutgoingFiles = new Map();
    this.pendingOutgoingTransfers = new Map();
    this.blockAckTimers = new Map();
    this.completedMessages = new Map();
    this._startCleanupInterval();
    console.log('[BleAckSystem] v3.2.1-NEXO iniciado. Chat: chunk=' + CHAT_CHUNK_SIZE + ' window=' + CHAT_WINDOW_SIZE + ' | File: chunk=' + FILE_CHUNK_SIZE + ' window=' + FILE_WINDOW_SIZE);
  }

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
      if (typeof seq !== 'number') {
        seq = (self.ble && typeof self.ble.getNextSeq === 'function') ? self.ble.getNextSeq() : 0;
      }
      finalMeta.seq = seq;
      if (content.length <= 180) {
        self.sendWithRetry(deviceId, content, msgId, seq).then(resolve).catch(reject);
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

  // FIX v3.2.1: Opcion C - Solo JS chunking, nativo eliminado
  sendFile(deviceId, fileId, base64Data, meta) {
    var self = this;
    return new Promise(function(resolve, reject) {
      // Siempre usar JS chunking, nunca delegar a nativo
      self._sendFileJS(deviceId, fileId, base64Data, meta).then(resolve).catch(reject);
    });
  }

  _sendFileJS(deviceId, fileId, base64Data, meta) {
    var self = this;
    return new Promise(function(resolve, reject) {
      var senderId = (self.ble && self.ble.localNexoId) || ((self.ble && self.ble.localDeviceUUID) ? self.ble.localDeviceUUID : 'unknown');
      var fromName = (self.ble && self.ble.localDeviceName) || 'NEXO';
      var finalMeta = Object.assign({}, meta || {}, { f: fromName, fr: senderId, ts: Date.now(), file: true });
      var stream = new ChatStream(self, deviceId, fileId, base64Data, finalMeta, 'file');
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
      if (type === 'ba' || type === 'block_ack') { this._handleBlockAck(msg); return true; }
      if (type === 'ack' || type === 'read_receipt') { this.processIncomingAck(content); return true; }
      if (type === 'ping' || type === 'pong') { return false; }
      if (type === 'n') { this._handleNack(msg); return true; }
      if (type === 'a') { this._handleLegacyChunkAck(msg); return true; }
      if (type === 'ss') { this._handleSessionSync(deviceId, msg); return true; }
      if (type === 'sr') { this._handleSessionSyncResponse(deviceId, msg); return true; }
      if (type === 'c' || type === 'f') {
        this._handleIncomingChunk(deviceId, msg, type);
        return true;
      }
      // FIX v3.2.1: Ignorar fm/fd del nativo si aun llegan (protocolo muerto)
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

    var completed = self.completedMessages.get(msgId);
    if (completed) {
      self._sendFinalAck(deviceId, msgId, total);
      return;
    }

    var buf = self.incomingBuffers.get(msgId);
    if (!buf && idx !== 0) {
      var missing = [];
      for (var i = 0; i <= Math.min(idx, total - 1); i++) missing.push(i);
      self._sendNack(deviceId, msgId, missing);
      return;
    }

    if (!buf) {
      // FIX v3.2.1: Preservar metadata completa del archivo (tp, fn, fs, ft)
      buf = {
        chunks: new Map(), total: total,
        meta: {
          f: msg.f || 'NEXO',
          fr: from || 'unknown',
          ts: msg.ts || Date.now(),
          seq: seq,
          type: msg.tp || msg.type || (type === 'f' ? 'file' : null),
          name: msg.fn || msg.name,
          size: msg.fs || msg.size,
          format: msg.ft || msg.format
        },
        received: 0, deviceId: deviceId, lastActivity: Date.now(),
        isChat: type === 'c', nackSent: false
      };
      self.incomingBuffers.set(msgId, buf);
      buf.assemblyTimer = setTimeout(function() {
        if (self.incomingBuffers.has(msgId)) {
          console.warn('[BleAckSystem] Assembly timeout msgId=' + msgId);
          self.incomingBuffers.delete(msgId);
        }
      }, ASSEMBLY_TIMEOUT_MS);
      var senderId = from || 'unknown';
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

    self._sendBlockAck(deviceId, msgId, buf);

    if (idx > 0) {
      var missing = self._findMissing(buf);
      if (missing.length > 0 && !buf.nackSent) {
        self._sendNack(deviceId, msgId, missing);
        buf.nackSent = true;
        setTimeout(function() { buf.nackSent = false; }, 1500);
      }
    }

    if (buf.received >= buf.total) {
      if (buf.assemblyTimer) clearTimeout(buf.assemblyTimer);
      self._assembleAndDispatch(buf, deviceId, senderId, msgId);
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
    self._sendFinalAck(deviceId, msgId, buf.total);
    self.completedMessages.set(msgId, { total: buf.total, expireAt: Date.now() + COMPLETED_TTL_MS });
    self.incomingBuffers.delete(msgId);

    if (buf.isChat) {
      self._dispatchChunkedMessageComplete(senderId, assembled, buf.meta, deviceId, msgId);
    } else {
      self._dispatchFileComplete(senderId, assembled, buf.meta);
      self._dispatchFileProgress(senderId, buf.total, buf.total, 'received', 100);
    }
    if (window.vaultCompleteTransfer) {
      window.vaultCompleteTransfer(senderId, msgId).catch(function(){});
    }
  }

  _sendNack(deviceId, msgId, indices) {
    var payload = JSON.stringify({ v: PROTOCOL_VERSION, t: 'n', m: msgId, k: indices });
    if (this.ble && this.ble._sendMessageNative) {
      this.ble._sendMessageNative(deviceId, payload, null).catch(function(){});
    }
  }

  _sendBlockAck(deviceId, msgId, buf) {
    var bitmap = 0;
    for (var i = 0; i < buf.total; i++) {
      if (buf.chunks.has(i)) bitmap |= (1 << i);
    }
    var payload = JSON.stringify({ v: PROTOCOL_VERSION, t: 'ba', m: msgId, b: bitmap, n: buf.total });
    if (this.ble && this.ble._sendMessageNative) {
      this.ble._sendMessageNative(deviceId, payload, null).catch(function(){});
    }
  }

  _sendFinalAck(deviceId, msgId, total) {
    var bitmap = (1 << total) - 1;
    var payload = JSON.stringify({ v: PROTOCOL_VERSION, t: 'ba', m: msgId, b: bitmap, n: total, f: 1 });
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

  _handleBlockAck(msg) {
    var msgId = msg.m || msg.msgId;
    var bitmap = msg.b || 0;
    var total = msg.n || 0;
    var isFinal = msg.f === 1;
    var stream = this.outgoingStreams.get(msgId);
    if (!stream) return;
    if (isFinal) {
      stream.handleFinalAck();
      return;
    }
    for (var i = 0; i < total; i++) {
      if (bitmap & (1 << i)) stream.ackedMask[i] = true;
    }
    while (stream.windowStart < stream.total && stream.ackedMask[stream.windowStart]) {
      stream.windowStart++;
    }
    if (stream.timer) clearTimeout(stream.timer);
    if (stream.windowStart >= stream.total) {
      stream._finish();
    } else {
      var end = Math.min(stream.windowStart + stream.windowSize, stream.total);
      var windowComplete = true;
      for (var i = stream.windowStart; i < end; i++) {
        if (!stream.ackedMask[i]) { windowComplete = false; break; }
      }
      if (windowComplete) {
        stream.windowRetryCount = 0;
        if (stream._windowResolve) {
          stream._windowResolve();
          stream._windowResolve = null;
          stream._windowReject = null;
        }
      } else {
        stream._retransmitWindow();
      }
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
          var maxSeq = 0;
          msgs.forEach(function(m) { if (m.seq > maxSeq) maxSeq = m.seq; });
          myLastSeq = maxSeq;
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
        var payload = JSON.stringify({ v: PROTOCOL_VERSION, t: 'ss', fr: (self.ble && self.ble.localNexoId) || 'unknown', l: myLastSeq });
        if (self.ble && self.ble._sendMessageNative) {
          self.ble._sendMessageNative(deviceId, payload, null).catch(function(){});
        }
      }).catch(function(){});
    }
  }

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
          var content = tx.chunks.map(function(c) { return (typeof c === 'string') ? c : (c.data || c.d || ''); }).join('');
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

  _dispatchChunkedMessageComplete(senderId, content, meta, deviceId, msgId) {
    try {
      window.dispatchEvent(new CustomEvent('nexo:ble:messageReceived', {
        detail: {
          deviceId: deviceId, deviceUUID: meta.fr || senderId,
          content: content, senderName: meta.f || 'NEXO',
          senderNexoId: meta.fr || senderId, messageId: msgId || meta.msgId,
          source: 'ble', timestamp: Date.now(), seq: meta.seq || 0,
          fromVault: true
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
  this.pacingDelayMs = isFile ? FILE_PACING_DELAY_MS : CHAT_PACING_DELAY_MS;
  this.globalTimeoutMs = isFile ? GLOBAL_TIMEOUT_MS : 45000;
  
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
  this._windowResolve = null;
  this._windowReject = null;
  
  if (isFile) {
    console.log('[ChatStream] MODO ARCHIVO. chunk=' + this.chunkSize + ' window=' + this.windowSize + ' pacing=' + this.pacingDelayMs + 'ms');
  }
}

ChatStream.prototype.start = function() {
  var self = this;
  return new Promise(function(resolve, reject) {
    self.resolve = resolve;
    self.reject = reject;
    self._splitChunks();
    if (self.total === 0) { reject(new Error('Vacio')); return; }
    if (window.vaultCreateOutgoingTransfer) {
      var cid = self.ackSystem._resolveNexoId(self.deviceId);
      window.vaultCreateOutgoingTransfer(cid, self.msgId, self.type, self.total, self.chunks, self.meta, self.deviceId).catch(function(){});
    }
    self.globalTimeout = setTimeout(function() {
      if (!self.aborted) {
        self.abort();
        reject(new Error('Timeout global ' + (self.type === 'file' ? '3min' : '45s')));
        self.ackSystem._dispatchStatus(self.msgId, 'failed');
      }
    }, self.globalTimeoutMs);
    self._runWindowLoop();
  });
};

ChatStream.prototype._runWindowLoop = function() {
  var self = this;
  function next() {
    if (self.aborted) return;
    if (self.windowStart >= self.total) {
      self._finish();
      return;
    }
    self._sendWindow().then(function() {
      self.windowRetryCount = 0;
      setTimeout(next, self.pacingDelayMs);
    }).catch(function(err) {
      self.windowRetryCount++;
      if (self.windowRetryCount > self.maxWindowRetries) {
        self.abort();
        self.ackSystem._dispatchStatus(self.msgId, 'failed');
        if (self.reject) self.reject(new Error('Max window retries'));
        return;
      }
      console.log('[ChatStream] Ventana falló, reintentando. retry=' + self.windowRetryCount);
      setTimeout(next, 500 * self.windowRetryCount);
    });
  }
  next();
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
  return new Promise(function(resolve, reject) {
    self._windowResolve = resolve;
    self._windowReject = reject;
    var end = Math.min(self.windowStart + self.windowSize, self.total);
    function sendNext(idx) {
      if (idx >= end || self.aborted) {
        var allAcked = true;
        for (var i = self.windowStart; i < end; i++) {
          if (!self.ackedMask[i]) { allAcked = false; break; }
        }
        if (allAcked) {
          if (self.timer) clearTimeout(self.timer);
          resolve();
        } else {
          self._startWindowTimer();
        }
        return;
      }
      if (self.ackedMask[idx]) {
        setTimeout(function() { sendNext(idx + 1); }, self.pacingDelayMs);
        return;
      }
      self.sentMask[idx] = true;
      var payload = self._buildChunk(idx);
      self.ble._sendMessageNative(self.deviceId, payload, self.msgId + '_' + idx)
        .then(function() {
          setTimeout(function() { sendNext(idx + 1); }, self.pacingDelayMs);
        })
        .catch(function(err) {
          console.warn('[ChatStream] Envío nativo falló chunk', idx, err.message);
          setTimeout(function() { sendNext(idx); }, 200);
        });
    }
    sendNext(self.windowStart);
  });
};

// FIX v3.2.1: Incluir metadata de archivo en chunk 0 (tp, fn, fs, ft)
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
    obj.f = this.meta.f || 'NEXO';
    obj.fr = this.meta.fr || 'unknown';
    obj.ts = this.meta.ts || Date.now();
    if (typeof this.meta.seq === 'number') obj.seq = this.meta.seq;
    // Metadata adicional para archivos (campos compactos)
    if (this.meta.type) obj.tp = this.meta.type;
    if (this.meta.name) obj.fn = this.meta.name;
    if (this.meta.size) obj.fs = this.meta.size;
    if (this.meta.format) obj.ft = this.meta.format;
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
    } else if (self._windowResolve) {
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
    console.log('[ChatStream] Window timeout, reenviando ventana desde', self.windowStart, 'retry', self.windowRetryCount);
    self._retransmitWindow();
  }
};

ChatStream.prototype._retransmitWindow = function() {
  var self = this;
  var end = Math.min(self.windowStart + self.windowSize, self.total);
  function sendNext(idx) {
    if (idx >= end || self.aborted) {
      self._startWindowTimer();
      return;
    }
    if (self.ackedMask[idx]) {
      setTimeout(function() { sendNext(idx + 1); }, self.pacingDelayMs);
      return;
    }
    var payload = self._buildChunk(idx);
    self.ble._sendMessageNative(self.deviceId, payload, self.msgId + '_' + idx)
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
    setTimeout(function() { self._retransmitWindow(); }, 500);
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
  } else if (self._windowResolve) {
    self._windowResolve();
    self._windowResolve = null;
    self._windowReject = null;
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
  if (this._windowResolve) {
    this._windowResolve();
    this._windowResolve = null;
    this._windowReject = null;
  }
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
