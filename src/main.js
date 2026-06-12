/**
 * main.js - NEXO v9.2.0-FINAL
 * Orquestador principal. Sin imports externos. Todo en un archivo.
 */

const NEXO = {
  version: '9.2.0-FINAL',
  initialized: false,
  activeConversationId: null,
  conversations: new Map(),
  app: null
};

// ==================== UTILIDADES ====================
function normId(id) {
  if (!id) return '';
  return id.toString().toLowerCase().replace(/[:-]/g, '').trim();
}

function formatTime(ts) {
  if (!ts) return 'ahora';
  const d = new Date(ts);
  const now = new Date();
  const diff = (now - d) / 1000;
  if (diff < 60) return 'ahora';
  if (diff < 3600) return Math.floor(diff / 60) + 'm';
  if (diff < 86400) return Math.floor(diff / 3600) + 'h';
  return d.toLocaleDateString();
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ==================== CONVERSACIONES ====================
function getOrCreateConversation(id, name) {
  const nid = normId(id);
  if (!NEXO.conversations.has(nid)) {
    NEXO.conversations.set(nid, {
      id: nid,
      name: name || 'NEXO Peer',
      messages: [],
      lastMessage: null,
      unread: 0,
      createdAt: Date.now()
    });
  }
  return NEXO.conversations.get(nid);
}

function saveConversations() {
  try {
    const obj = Object.fromEntries(NEXO.conversations);
    localStorage.setItem('nexo_conversations_v4', JSON.stringify(obj));
  } catch (e) {}
}

function loadConversations() {
  try {
    const raw = localStorage.getItem('nexo_conversations_v4');
    if (raw) {
      const parsed = JSON.parse(raw);
      NEXO.conversations = new Map(Object.entries(parsed));
    }
  } catch (e) {}
}

// ==================== RENDER CHAT ====================
function renderMessage(msg) {
  const container = document.getElementById('messages-container');
  if (!container) return;

  const isMe = msg.isMe || msg._own || false;
  const bubble = document.createElement('div');
  bubble.className = 'msg-bubble ' + (isMe ? 'msg-me' : 'msg-them');
  bubble.dataset.messageId = msg.messageId || msg.id || '';

  const senderName = escapeHtml(msg.senderName || msg.sender || 'NEXO Peer');
  const content = escapeHtml(msg.content || msg.text || '');
  const time = formatTime(msg.timestamp);

  bubble.innerHTML =
    '<div class="msg-sender">' + senderName + '</div>' +
    '<div class="msg-text">' + content + '</div>' +
    '<div class="msg-time">' + time + '</div>';

  container.appendChild(bubble);
  container.scrollTop = container.scrollHeight;
}

function clearChat() {
  const container = document.getElementById('messages-container');
  if (container) container.innerHTML = '';
}

function loadChatMessages(convId) {
  clearChat();
  const conv = NEXO.conversations.get(normId(convId));
  if (conv && conv.messages) {
    conv.messages.forEach(m => renderMessage(m));
  }
}

// ==================== SPLASH ====================
function hideSplash() {
  const splash = document.getElementById('splash-native');
  const app = document.getElementById('app');
  if (splash) {
    splash.style.opacity = '0';
    setTimeout(() => {
      splash.style.display = 'none';
      if (app) app.classList.remove('hidden');
    }, 500);
  } else if (app) {
    app.classList.remove('hidden');
  }
}

// ==================== PLUGIN NATIVO ====================
function getNativePlugin() {
  if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.NexoBLE) {
    return window.Capacitor.Plugins.NexoBLE;
  }
  return null;
}

// ==================== BLE INTERFACE ====================
class BLEInterface {
  constructor() {
    this.nativePlugin = getNativePlugin();
    this.foundDevices = new Map();
    this.connectedDevices = new Map();
    this.isScanning = false;
    this.isAdvertising = false;
    this.localDeviceName = 'NEXO Device';
    this._receivedIds = new Set();
    this._peerNames = {};
    this._listeners = [];
  }

  async init() {
    this.nativePlugin = getNativePlugin();
    if (!this.nativePlugin) {
      console.log('[BLE] Plugin no disponible - modo dummy');
      return this;
    }
    this._setupListeners();
    this._loadLocalName();
    return this;
  }

  _setupListeners() {
    const plugin = this.nativePlugin;
    if (!plugin) return;

    const self = this;

    const l1 = plugin.addListener('onDeviceFound', function(data) {
      const id = normId(data.deviceId);
      if (!id) return;
      self.foundDevices.set(id, {
        id: id,
        name: data.name || 'NEXO Device',
        rssi: data.rssi,
        lastSeen: Date.now()
      });
      console.log('[BLE] Encontrado:', data.name, id.substring(0, 8));
    });
    this._listeners.push(l1);

    const l2 = plugin.addListener('onDeviceConnected', function(data) {
      const id = normId(data.deviceId);
      self.connectedDevices.set(id, {
        id: id,
        name: data.name || 'NEXO Peer',
        direction: data.direction || 'unknown'
      });
      console.log('[BLE] Conectado:', id.substring(0, 8));
    });
    this._listeners.push(l2);

    const l3 = plugin.addListener('onDeviceDisconnected', function(data) {
      const id = normId(data.deviceId);
      self.connectedDevices.delete(id);
      console.log('[BLE] Desconectado:', id.substring(0, 8));
    });
    this._listeners.push(l3);

    const l4 = plugin.addListener('onPayloadReceived', function(data) {
      const id = normId(data.deviceId);
      const raw = data.content || data.data || '';
      console.log('[BLE] Payload recibido de', id.substring(0, 8), ':', raw.substring(0, 50));

      let parsed = null;
      try {
        const t = raw.trim();
        if (t.charAt(0) === '{' && t.charAt(t.length - 1) === '}') {
          parsed = JSON.parse(t);
        }
      } catch (e) {}

      if (parsed && parsed._t === 'hs') {
        self._peerNames[id] = parsed._n || 'NEXO Device';
        console.log('[BLE] Handshake de', parsed._n);
        return;
      }

      let content = raw;
      let senderName = self._peerNames[id] || data.senderName || 'NEXO Peer';
      let messageId = null;

      if (parsed && parsed.content) {
        content = parsed.content;
        if (parsed.senderName) senderName = parsed.senderName;
        if (parsed.messageId) messageId = parsed.messageId;
      }

      if (messageId && self._receivedIds.has(messageId)) return;
      if (messageId) self._receivedIds.add(messageId);

      window.dispatchEvent(new CustomEvent('nexo:ble:messageReceived', {
        detail: {
          deviceId: id,
          content: content,
          senderName: senderName,
          messageId: messageId || 'msg_' + Date.now(),
          timestamp: Date.now()
        }
      }));
    });
    this._listeners.push(l4);

    const l5 = plugin.addListener('onAdvertiseStarted', function() {
      self.isAdvertising = true;
      console.log('[BLE] Advertising iniciado');
    });
    this._listeners.push(l5);
  }

  async _loadLocalName() {
    try {
      const info = await this.nativePlugin.getLocalDeviceInfo();
      this.localDeviceName = info.deviceName || 'NEXO Device';
    } catch (e) {
      const ua = navigator.userAgent;
      if (ua.indexOf('SM-S928') !== -1) this.localDeviceName = 'Galaxy S24 Ultra';
      else if (ua.indexOf('SM-S918') !== -1) this.localDeviceName = 'Galaxy S23 Ultra';
    }
  }

  async startScan() {
    if (!this.nativePlugin) return;
    this.foundDevices.clear();
    try {
      await this.nativePlugin.startScan();
      this.isScanning = true;
      setTimeout(() => this.stopScan(), 15000);
    } catch (e) {
      console.error('[BLE] Scan error:', e);
    }
  }

  async stopScan() {
    if (!this.nativePlugin) return;
    try {
      await this.nativePlugin.stopScan();
      this.isScanning = false;
    } catch (e) {}
  }

  async connect(deviceId) {
    if (!this.nativePlugin) return;
    try {
      await this.nativePlugin.connectToDevice({ deviceId: normId(deviceId) });
    } catch (e) {
      console.error('[BLE] Connect error:', e);
    }
  }

  async sendMessage(deviceId, content) {
    if (!this.nativePlugin) throw new Error('Plugin no disponible');
    const messageStr = typeof content === 'string' ? content : JSON.stringify(content);
    await this.nativePlugin.sendMessage({ deviceId: normId(deviceId), message: messageStr });
  }

  async toggleAdvertising() {
    if (!this.nativePlugin) return;
    try {
      if (this.isAdvertising) {
        await this.nativePlugin.stopAdvertising();
        this.isAdvertising = false;
      } else {
        await this.nativePlugin.startAdvertising();
      }
    } catch (e) {
      console.error('[BLE] Advertising error:', e);
    }
  }
}

// ==================== NEXO APP ====================
class NexoApp {
  constructor() {
    this.bleInterface = null;
    this.activeContact = null;
    this.initialized = false;
    this._sentMessages = new Map();
  }

  async init() {
    this.bleInterface = new BLEInterface();
    await this.bleInterface.init();

    const self = this;

    window.addEventListener('nexo:ble:messageReceived', function(e) {
      const d = e.detail;
      console.log('[APP] Mensaje recibido:', d.senderName, d.content.substring(0, 30));

      const conv = getOrCreateConversation(d.deviceId, d.senderName);
      const msg = {
        messageId: d.messageId,
        content: d.content,
        sender: d.deviceId,
        senderName: d.senderName,
        timestamp: d.timestamp,
        isMe: false
      };
      conv.messages.push(msg);
      if (conv.messages.length > 500) conv.messages = conv.messages.slice(-500);
      conv.lastMessage = msg;
      saveConversations();

      if (NEXO.activeConversationId === d.deviceId) {
        renderMessage(msg);
      }

      const nameInput = document.getElementById('chat-contact-name');
      if (nameInput && NEXO.activeConversationId === d.deviceId) {
        nameInput.value = d.senderName;
      }
    });

    this.initialized = true;
    console.log('[APP] Inicializado');
    return this;
  }

  async sendMessage(content) {
    if (!this.activeContact) {
      console.warn('[APP] No hay contacto activo');
      return false;
    }

    const targetId = this.activeContact.id;
    const messageId = 'msg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);

    const msg = {
      messageId: messageId,
      content: content,
      sender: 'me',
      senderName: 'Tú',
      timestamp: Date.now(),
      isMe: true
    };

    const conv = getOrCreateConversation(targetId, this.activeContact.name);
    conv.messages.push(msg);
    conv.lastMessage = msg;
    saveConversations();

    renderMessage(msg);

    if (this.bleInterface && this.bleInterface.nativePlugin) {
      try {
        const payload = JSON.stringify({
          content: content,
          senderName: this.bleInterface.localDeviceName,
          messageId: messageId
        });
        await this.bleInterface.sendMessage(targetId, payload);
        console.log('[APP] Enviado por BLE');
      } catch (e) {
        console.error('[APP] Error enviando:', e);
      }
    }

    return true;
  }

  setActiveContact(id, name) {
    this.activeContact = { id: normId(id), name: name || 'NEXO Peer' };
    NEXO.activeConversationId = normId(id);

    const nameInput = document.getElementById('chat-contact-name');
    const subtitle = document.getElementById('chat-contact-subtitle');
    if (nameInput) nameInput.value = this.activeContact.name;
    if (subtitle) subtitle.textContent = 'BLUETOOTH';

    loadChatMessages(id);
  }

  getStatus() {
    return {
      initialized: this.initialized,
      hasBLE: !!(this.bleInterface && this.bleInterface.nativePlugin),
      activeContact: this.activeContact
    };
  }
}

// ==================== UI CONTROLES ====================
function setupUI() {
  const sendBtn = document.getElementById('send-btn');
  const msgInput = document.getElementById('message-input');

  if (sendBtn && msgInput) {
    sendBtn.addEventListener('click', async function() {
      const text = msgInput.value.trim();
      if (!text) return;
      msgInput.value = '';

      if (!NEXO.app || !NEXO.app.activeContact) {
        alert('Primero conecta un dispositivo BLE');
        return;
      }

      await NEXO.app.sendMessage(text);
    });

    msgInput.addEventListener('keydown', function(e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendBtn.click();
      }
    });
  }
}

// ==================== INICIALIZACION ====================
document.addEventListener('DOMContentLoaded', async function() {
  console.log('[NEXO] Iniciando v' + NEXO.version);

  loadConversations();

  NEXO.app = new NexoApp();
  await NEXO.app.init();

  setupUI();

  hideSplash();

  console.log('[NEXO] Listo');
});

window.NEXO = NEXO;
