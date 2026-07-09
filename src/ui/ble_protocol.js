/**
 * BLE Protocol — Mensajes v2, ACK, Heartbeat, Deduplicación
 * v5.2.1-split-protocol
 * Importa: ble_base.js
 */
import { BLEInterface } from './ble_base.js';

Object.assign(BLEInterface.prototype, {

  init() {
    var self = this;
    this.createDOM();
    this.setupEventListeners();
    if (!this.nativePlugin) {
      this.nativePlugin = (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.NexoBLE) || null;
      if (this.nativePlugin) this.isDummyMode = !this.bleMesh && !this.nativePlugin;
    }
    this._loadContactsAndInit();
    this._startCleanupTimer();
    return this;
  },

  _startCleanupTimer() {
    var self = this;
    this._cleanupSeenMsgsTimer = setInterval(function() {
      self._cleanupSeenMsgs();
    }, 30000);
  },

  _cleanupSeenMsgs() {
    var now = Date.now();
    var cutoff = now - 60000;
    for (var it = this._seenMsgs.entries(), entry = it.next(); !entry.done; entry = it.next()) {
      if (entry.value[1] < cutoff) { this._seenMsgs.delete(entry.value[0]); }
    }
  },

  _isDuplicate(msgId, path) {
    if (!msgId) return false;
    if (this._seenMsgs.has(msgId)) return true;
    var pathKey = msgId + '|' + (path || []).slice(0, 4).join(',');
    if (this._seenMsgs.has(pathKey)) return true;
    this._seenMsgs.set(msgId, Date.now());
    this._seenMsgs.set(pathKey, Date.now());
    return false;
  },

  _getTimeoutForHops(hops) {
    return 5000 + ((hops || 0) * 2000);
  },

  _sendACK(deviceId, msgRef, ackType) {
    var self = this;
    if (!deviceId || !msgRef) return Promise.resolve();
    var ackPayload = JSON.stringify({
      v: 2,
      type: 'ack',
      msgId: 'ack' + Date.now(),
      msgRef: msgRef,
      from: self.localNexoId || self.localDeviceUUID,
      ts: Date.now(),
      ackType: ackType || 'delivered',
      jump: { ttl: 3, hops: 0, path: [] }
    });
    return _safeNativeCall(self.nativePlugin, 'sendMessage', { deviceId: deviceId, message: ackPayload });
  },

  _startHeartbeat(deviceId) {
    var self = this;
    if (!deviceId) return;
    self._stopHeartbeat(deviceId);
    var timer = setInterval(function() {
      var state = self._getDeviceState(deviceId);
      if (state.state !== BLE_STATES.READY_TO_CHAT && state.state !== BLE_STATES.NOTIFICATIONS_READY) {
        self._stopHeartbeat(deviceId);
        return;
      }
      var hbPayload = JSON.stringify({
        v: 2,
        type: 'ping',
        msgId: 'hb' + Date.now(),
        from: self.localNexoId || self.localDeviceUUID,
        ts: Date.now(),
        jump: { ttl: 2, hops: 0, path: [] }
      });
      if (_hasNativeMethod(self.nativePlugin, 'sendMessage')) {
        _safeNativeCall(self.nativePlugin, 'sendMessage', { deviceId: deviceId, message: hbPayload }).catch(function(e) {});
      }
      var rec = self._heartbeatTimers.get(deviceId);
      if (rec) {
        rec.missed = (rec.missed || 0) + 1;
        if (rec.missed >= 3) {
          console.warn('[BLEInterface] Heartbeat failed 3x, disconnecting:', deviceId);
          self._stopHeartbeat(deviceId);
          if (_hasNativeMethod(self.nativePlugin, 'disconnectDevice')) {
            _safeNativeCall(self.nativePlugin, 'disconnectDevice', { deviceId: deviceId }).catch(function(e) {});
          }
        }
        self._heartbeatTimers.set(deviceId, rec);
      }
    }, self._heartbeatInterval);
    self._heartbeatTimers.set(deviceId, { intervalId: timer, lastPong: Date.now(), missed: 0 });
  },

  _stopHeartbeat(deviceId) {
    if (!deviceId) return;
    var rec = this._heartbeatTimers.get(deviceId);
    if (rec && rec.intervalId) { clearInterval(rec.intervalId); }
    this._heartbeatTimers.delete(deviceId);
  },

  _handlePong(deviceId) {
    var rec = this._heartbeatTimers.get(deviceId);
    if (rec) { rec.lastPong = Date.now(); rec.missed = 0; this._heartbeatTimers.set(deviceId, rec); }
  },

  _setupNativePayloadListener() {
    if (!this.nativePlugin) return;
    if (!_hasNativeMethod(this.nativePlugin, 'addListener')) return;
    if (this._nativePayloadListener) { try { this._nativePayloadListener.remove(); } catch (e) {} }
    var self = this;
    this._nativePayloadListener = this.nativePlugin.addListener('onPayloadReceived', function(data) {
      try {
        var deviceId = data.deviceId || '';
        if (!deviceId) return;
        var source = data.source || 'unknown';
        if (source !== 'gatt_server' && source !== 'gatt_client' && source !== 'broadcast') source = 'gatt_client';
        var content = data.content || data.data || '';
        var isControl = _isControlPacket(content);
        if (isControl) {
          try {
            var ctrl = JSON.parse(content);
            if (ctrl.type === 'ping') {
              var pongPayload = JSON.stringify({
                v: 2,
                type: 'pong',
                msgId: 'pong' + Date.now(),
                msgRef: ctrl.msgId,
                from: self.localNexoId || self.localDeviceUUID,
                ts: Date.now(),
                jump: { ttl: 2, hops: 0, path: [] }
              });
              if (_hasNativeMethod(self.nativePlugin, 'sendMessage')) {
                _safeNativeCall(self.nativePlugin, 'sendMessage', { deviceId: deviceId, message: pongPayload }).catch(function(e) {});
              }
              return;
            }
            if (ctrl.type === 'pong') {
              self._handlePong(deviceId);
              return;
            }
            if (ctrl.type === 'ack') {
              var pending = self._pendingACKs.get(ctrl.msgRef);
              if (pending) {
                clearTimeout(pending.timer);
                self._pendingACKs.delete(ctrl.msgRef);
                _safeDispatchEvent('nexo:ble:ackReceived', { msgId: ctrl.msgRef, ackType: ctrl.ackType, from: ctrl.from, deviceId: deviceId });
              }
              return;
            }
            if (ctrl.type === 'read_receipt') {
              _safeDispatchEvent('nexo:ble:readReceipt', { msgId: ctrl.messageId, deviceId: deviceId });
              return;
            }
          } catch (ctrlErr) {}
        }
        var messageId = null, senderName = null, senderUUID = null, msgType = 'chat';
        var text = content;
        var jump = { ttl: 5, hops: 0, path: [] };
        if (content.charAt(0) === '{' || (data.data && data.data.charAt(0) === '{')) {
          try {
            var json = JSON.parse(data.data || content || '{}');
            if (json.msgId) messageId = json.msgId;
            if (json.messageId) messageId = json.messageId;
            if (json.type) msgType = json.type;
            if (json.from) senderUUID = json.from;
            if (json.jump) jump = json.jump;
            if (json.payload) {
              if (json.payload.senderName) senderName = json.payload.senderName;
              if (json.payload.text) text = json.payload.text;
              if (json.payload.senderNexoId) senderUUID = json.payload.senderNexoId;
            }
            if (json.senderName) senderName = json.senderName;
            if (json.deviceName) senderName = json.deviceName;
            if (json.deviceUUID) senderUUID = json.deviceUUID;
            if (json.content) text = json.content;
          } catch (e) {}
        }
        if (self._isDuplicate(messageId, jump.path)) return;
        if (msgType === 'msg' || msgType === 'chat') {
          self._sendACK(deviceId, messageId, 'delivered').catch(function(e) {});
        }
        if (!senderUUID) {
          var contactByDevice = _getContactByDeviceId(deviceId);
          if (contactByDevice) senderUUID = contactByDevice.deviceUUID;
        }
        if (!senderName || senderName === '') {
          var contact = _getContactByUUID(senderUUID);
          var cname = contact ? contact.name : null;
          senderName = cname || (self.connectedDevices.get(deviceId) && self.connectedDevices.get(deviceId).name) || (self.foundDevices.get(deviceId) && self.foundDevices.get(deviceId).name) || '';
        }
        if (senderUUID && senderName && senderName !== '') {
          if (!_isBLEContact(senderUUID)) {
            _addBLEContact({ deviceUUID: senderUUID, name: senderName, deviceId: deviceId });
            self.renderContactsList(); self.renderOnlineStrip();
          } else {
            var contacts2 = _getBLEContacts();
            var idx2 = contacts2.findIndex(function(c) { return _normId(c.deviceUUID) === _normId(senderUUID); });
            if (idx2 >= 0) {
              contacts2[idx2].online = true; contacts2[idx2].lastSeen = Date.now(); contacts2[idx2].deviceId = deviceId;
              if (text && !isControl) contacts2[idx2].lastMessage = text.substring(0, 50);
              _saveBLEContacts(contacts2); self.renderContactsList(); self.renderOnlineStrip();
            }
          }
        }
        if (messageId && self._receivedMessageIds.has(messageId)) return;
        if (messageId) {
          self._receivedMessageIds.add(messageId);
          if (self._receivedMessageIds.size > self._maxMessageIds) {
            var first = self._receivedMessageIds.values().next().value;
            self._receivedMessageIds.delete(first);
          }
        }
        var activeUUID = self._activeChatDeviceId;
        if (activeUUID && activeUUID === senderUUID) return;
        if (senderUUID && !isControl) {
          var contacts3 = _getBLEContacts();
          var idx3 = contacts3.findIndex(function(c) { return _normId(c.deviceUUID) === _normId(senderUUID); });
          if (idx3 >= 0) {
            contacts3[idx3].unreadCount = (contacts3[idx3].unreadCount || 0) + 1;
            contacts3[idx3].lastMessage = text.substring(0, 50);
            contacts3[idx3].lastSeen = Date.now();
            _saveBLEContacts(contacts3); self.renderContactsList(); self.renderOnlineStrip();
          }
        }
        self.newDevicesCount++; self.updateBadge();
        var stableId = senderUUID || deviceId;
        _safeDispatchEvent('nexo:ble:messageReceived', {
          deviceId: stableId, deviceUUID: senderUUID, content: text,
          senderName: senderName, messageId: messageId, source: source,
          timestamp: data.timestamp || Date.now()
        });
      } catch (e) { console.warn('[BLEInterface] Error onPayloadReceived:', e.message); }
    });
  },

  _processPendingMessages(deviceId) {
    var self = this;
    if (!deviceId) return Promise.resolve();
    var queue = this._pendingMessageQueue.get(deviceId);
    if (!queue || queue.length === 0) return Promise.resolve();
    this._pendingMessageQueue.delete(deviceId);
    var processNext = function(idx) {
      if (idx >= queue.length) return Promise.resolve();
      var item = queue[idx];
      return self._sendMessageNative(deviceId, item.content, item.messageId)
        .then(function() { item.resolve(); return processNext(idx + 1); })
        .catch(function(e) { item.reject(e); return processNext(idx + 1); });
    };
    return processNext(0);
  },

  _sendMessageNative(deviceId, content, messageId) {
    var self = this;
    return new Promise(function(resolve, reject) {
      try {
        if (!self.nativePlugin) { reject(new Error('Plugin no disponible')); return; }
        if (!deviceId) { reject(new Error('deviceId invalido')); return; }
        var isCtrl = _isControlPacket(content);
        var enrichedPayload;
        if (isCtrl) { enrichedPayload = content; }
        else {
          var senderId = self.localNexoId || self.localDeviceUUID;
          var msgId = messageId || ('msg' + Date.now() + '*' + Math.random().toString(36).substr(2, 9));
          var contact = _getContactByDeviceId(deviceId);
          var targetId = contact ? contact.deviceUUID : '';
          enrichedPayload = JSON.stringify({
            v: 2,
            type: 'msg',
            msgId: msgId,
            from: senderId,
            to: targetId,
            ts: Date.now(),
            payload: {
              text: content,
              senderNexoId: senderId,
              senderName: self.localDeviceName,
              timestamp: Date.now()
            },
            jump: { ttl: 5, hops: 0, path: [] }
          });
        }
        if (_hasNativeMethod(self.nativePlugin, 'sendMessage')) {
          _safeNativeCall(self.nativePlugin, 'sendMessage', { deviceId: deviceId, message: enrichedPayload })
            .then(function() { resolve(); }).catch(function(e) { reject(e); });
        } else { reject(new Error('sendMessage no disponible')); }
      } catch (e) { reject(e); }
    });
  },

  sendChatMessage(deviceUUID, content, messageId) {
    var self = this;
    return new Promise(function(resolve, reject) {
      try {
        var uuid = _normId(deviceUUID);
        if (!uuid) { reject(new Error('deviceUUID vacio')); return; }
        if (!content || typeof content !== 'string' || content.trim() === '') { reject(new Error('Mensaje vacio')); return; }
        var contact = _getContactByUUID(uuid);
        var deviceId = contact ? contact.deviceId : null;
        if (!deviceId && self._activeChatDeviceId === uuid) deviceId = self._activeChatDeviceIdNative;
        if (!deviceId) {
          self.foundDevices.forEach(function(d) { if (!deviceId && _normId(d.deviceUUID) === uuid) deviceId = d.id; });
          self.connectedDevices.forEach(function(d) { if (!deviceId && _normId(d.deviceUUID) === uuid) deviceId = d.id; });
        }
        if (!deviceId) {
          var allContacts = _getBLEContacts();
          for (var i = 0; i < allContacts.length; i++) {
            if (_normId(allContacts[i].deviceUUID) === uuid && allContacts[i].deviceId) { deviceId = allContacts[i].deviceId; break; }
          }
        }
        if (!deviceId) { console.error('[BLEInterface] sendChatMessage: No deviceId para UUID', uuid); reject(new Error('Dispositivo no encontrado')); return; }
        if (contact && !contact.deviceId) { contact.deviceId = deviceId; _saveBLEContacts(_getBLEContacts()); }
        var state = self._getDeviceState(deviceId);
        var isReady = state.state === BLE_STATES.READY_TO_CHAT || state.state === BLE_STATES.NOTIFICATIONS_READY;
        var isConnecting = state.state === BLE_STATES.CONNECTING || state.state === BLE_STATES.DISCOVERING_SERVICES;
        var msgId = messageId || ('msg' + Date.now() + '*' + Math.random().toString(36).substr(2, 9));
        function doSend() {
          self._sendMessageNative(deviceId, content, msgId).then(function() {
            var timeoutMs = self._getTimeoutForHops(0);
            var ackTimer = setTimeout(function retryTimeout() {
              var pending = self._pendingACKs.get(msgId);
              if (pending) {
                if (pending.retries < 2) {
                  pending.retries++;
                  console.log('[BLEInterface] Reintentando mensaje:', msgId, 'intento', pending.retries);
                  self._sendMessageNative(deviceId, content, msgId).then(function() {
                    pending.timer = setTimeout(retryTimeout, timeoutMs);
                  }).catch(function() {
                    self._pendingACKs.delete(msgId);
                    _safeDispatchEvent('nexo:ble:messageFailed', { msgId: msgId, deviceId: deviceId, reason: 'timeout' });
                  });
                } else {
                  self._pendingACKs.delete(msgId);
                  _safeDispatchEvent('nexo:ble:messageFailed', { msgId: msgId, deviceId: deviceId, reason: 'timeout' });
                }
              }
            }, timeoutMs);
            self._pendingACKs.set(msgId, { resolve: resolve, reject: reject, timer: ackTimer, retries: 0, sentAt: Date.now(), deviceId: deviceId });
          }).catch(function(err) { reject(err); });
        }
        function enqueueMsg() {
          var queue = self._pendingMessageQueue.get(deviceId) || [];
          queue.push({ content: content, messageId: msgId, resolve: resolve, reject: reject });
          self._pendingMessageQueue.set(deviceId, queue);
        }
        if (isReady) { doSend(); return; }
        enqueueMsg();
        if (!isConnecting && self.nativePlugin && _hasNativeMethod(self.nativePlugin, 'connectToDevice')) {
          _safeNativeCall(self.nativePlugin, 'connectToDevice', { deviceId: deviceId }).catch(function(e) {});
        }
      } catch (fatal) { reject(fatal); }
    });
  },

  _waitForReadyToChat(deviceId, timeoutMs) {
    var self = this;
    return new Promise(function(resolve, reject) {
      if (!deviceId) { reject(new Error('deviceId invalido')); return; }
      var state = self._getDeviceState(deviceId);
      if (state.state === BLE_STATES.READY_TO_CHAT || state.state === BLE_STATES.NOTIFICATIONS_READY) { resolve(); return; }
      var timer = setTimeout(function() {
        self._readyResolvers.delete(deviceId);
        reject(new Error('Timeout esperando READY_TO_CHAT'));
      }, timeoutMs || 3000);
      self._readyResolvers.set(deviceId, { resolve: resolve, timer: timer });
    });
  },

  _resolveReadyToChat(deviceId) {
    if (!deviceId) return;
    var resolver = this._readyResolvers.get(deviceId);
    if (resolver) { clearTimeout(resolver.timer); resolver.resolve(); this._readyResolvers.delete(deviceId); }
    this._processPendingMessages(deviceId);
  }

});
