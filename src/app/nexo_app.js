/**
 * nexo_app.js - NEXO App v5.1.0-FINAL
 */

export class NexoApp {
  constructor(config) {
    this.config = config || {};
    this.bleInterface = null;
    this.activeContact = null;
    this.initialized = false;
    this.stream = null;
  }

  async init() {
    if (window.bleInterface) {
      this.bleInterface = window.bleInterface;
    } else if (window.initBLEInterface) {
      this.bleInterface = window.initBLEInterface();
    }

    const self = this;

    window.addEventListener('nexo:ble:messageReceived', function(e) {
      const d = e.detail;
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
    return this;
  }

  async sendMessage(msg) {
    const content = typeof msg === 'string' ? msg : (msg.content || msg.text || '');
    const targetId = this.activeContact ? this.activeContact.id : (msg.recipient || '');

    if (!targetId) {
      console.warn('[NexoApp] No target');
      return false;
    }

    const messageId = 'msg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);

    if (this.config.onMessage) {
      this.config.onMessage({
        content: content,
        sender: 'me',
        senderName: 'Tú',
        messageId: messageId,
        timestamp: Date.now(),
        isMe: true
      });
    }

    if (this.bleInterface && this.bleInterface.nativePlugin) {
      try {
        const payload = JSON.stringify({
          content: content,
          senderName: this.bleInterface.localDeviceName || 'NEXO Device',
          messageId: messageId
        });
        await this.bleInterface.sendMessage(targetId, payload);
      } catch (e) {
        console.error('[NexoApp] Send error:', e);
      }
    }

    return true;
  }

  setActiveContact(id, name) {
    this.activeContact = { id: id, name: name || 'NEXO Peer' };
  }

  getStatus() {
    return {
      initialized: this.initialized,
      mode: this.bleInterface ? 'p2p_ble' : 'offline',
      activeContact: this.activeContact
    };
  }
}

export default NexoApp;
