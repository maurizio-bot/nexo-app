/**
 * nexo_app.js - NEXO App v5.1.0-FINAL-FIX 06/20
 * 0 optional chaining. 0 async class methods. ES5 compatible.
 */

function normId(id) {
  if (!id) return '';
  return id.toString().toLowerCase().replace(/[:-]/g, '').trim();
}

export function NexoApp(config) {
  this.config = config || {};
  this.bleInterface = null;
  this.activeContact = null;
  this.initialized = false;
  this.stream = null;
}

NexoApp.prototype.init = function() {
  var self = this;
  if (window.bleInterface) {
    this.bleInterface = window.bleInterface;
  } else if (window.initBLEInterface) {
    this.bleInterface = window.initBLEInterface();
  }

  window.addEventListener('nexo:ble:messageReceived', function(e) {
    var d = e.detail;
    if (self.config.onMessage) {
      self.config.onMessage({
        content: d.content,
        sender: d.deviceId,
        senderName: d.senderName,
        messageId: d.messageId,
        timestamp: d.timestamp,
        isMe: false
      });
    }
  });

  this.initialized = true;
  return Promise.resolve(this);
};

NexoApp.prototype.sendMessage = function(msg) {
  var content = typeof msg === 'string' ? msg : (msg.content || msg.text || '');
  var targetId = this.activeContact ? this.activeContact.id : (msg.recipient || '');

  if (!targetId) {
    console.warn('[NexoApp] No target');
    return Promise.resolve(false);
  }

  var messageId = 'msg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);

  if (this.config.onMessage) {
    this.config.onMessage({
      content: content,
      sender: 'me',
      senderName: 'Tu',
      messageId: messageId,
      timestamp: Date.now(),
      isMe: true
    });
  }

  var self = this;
  if (this.bleInterface && this.bleInterface.nativePlugin) {
    var payload = JSON.stringify({
      content: content,
      senderName: self.bleInterface.localDeviceName || 'NEXO Device',
      messageId: messageId
    });
    return this.bleInterface.sendMessage(targetId, payload).then(function() {
      console.log('[NexoApp] Enviado por BLE');
      return true;
    }).catch(function(e) {
      console.error('[NexoApp] Send error:', e);
      return false;
    });
  }

  return Promise.resolve(true);
};

NexoApp.prototype.setActiveContact = function(id, name) {
  this.activeContact = { id: normId(id), name: name || 'NEXO Peer' };
};

NexoApp.prototype.getStatus = function() {
  return {
    initialized: this.initialized,
    mode: this.bleInterface ? 'p2p_ble' : 'offline',
    activeContact: this.activeContact
  };
};

export default NexoApp;
