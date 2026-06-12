/**
 * main.js - NEXO v9.2.1-FINAL-FIX
 * Orquestador principal. 0 optional chaining. 0 async class methods.
 * Compatible con WebView Chromium 74+
 */

var NEXO = {
  version: '9.2.1-FINAL-FIX',
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
  var d = new Date(ts);
  var now = new Date();
  var diff = (now - d) / 1000;
  if (diff < 60) return 'ahora';
  if (diff < 3600) return Math.floor(diff / 60) + 'm';
  if (diff < 86400) return Math.floor(diff / 3600) + 'h';
  return d.toLocaleDateString();
}

function escapeHtml(text) {
  if (typeof text !== 'string') return '';
  var div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ==================== CONVERSACIONES ====================
function getOrCreateConversation(id, name) {
  var nid = normId(id);
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
    var obj = {};
    NEXO.conversations.forEach(function(val, key) {
      obj[key] = val;
    });
    localStorage.setItem('nexo_conversations_v4', JSON.stringify(obj));
  } catch (e) {}
}

function loadConversations() {
  try {
    var raw = localStorage.getItem('nexo_conversations_v4');
    if (raw) {
      var parsed = JSON.parse(raw);
      Object.keys(parsed).forEach(function(key) {
        NEXO.conversations.set(key, parsed[key]);
      });
    }
  } catch (e) {}
}

// ==================== RENDER CHAT ====================
function renderMessage(msg) {
  var container = document.getElementById('messages-container');
  if (!container) return;

  var isMe = msg.isMe || msg._own || false;
  var bubble = document.createElement('div');
  bubble.className = 'msg-bubble ' + (isMe ? 'msg-me' : 'msg-them');
  bubble.dataset.messageId = msg.messageId || msg.id || '';

  var senderName = escapeHtml(msg.senderName || msg.sender || 'NEXO Peer');
  var content = escapeHtml(msg.content || msg.text || '');
  var time = formatTime(msg.timestamp);

  bubble.innerHTML =
    '<div class="msg-sender">' + senderName + '</div>' +
    '<div class="msg-text">' + content + '</div>' +
    '<div class="msg-time">' + time + '</div>';

  container.appendChild(bubble);
  container.scrollTop = container.scrollHeight;
}

function clearChat() {
  var container = document.getElementById('messages-container');
  if (container) container.innerHTML = '';
}

function loadChatMessages(convId) {
  clearChat();
  var conv = NEXO.conversations.get(normId(convId));
  if (conv && conv.messages) {
    conv.messages.forEach(function(m) { renderMessage(m); });
  }
}

// ==================== SPLASH ====================
function hideSplash() {
  var splash = document.getElementById('splash-native');
  var app = document.getElementById('app');
  if (splash) {
    splash.style.opacity = '0';
    setTimeout(function() {
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
function BLEInterface() {
  this.nativePlugin = null;
  this.foundDevices = new Map();
  this.connectedDevices = new Map();
  this.isScanning = false;
  this.isAdvertising = false;
  this.localDeviceName = 'NEXO Device';
  this._receivedIds = new Set();
  this._peerNames = {};
  this._listeners = [];
}

BLEInterface.prototype.init = function() {
  this.nativePlugin = getNativePlugin();
  if (!this.nativePlugin) {
    console.log('[BLE] Plugin no disponible - modo dummy');
    return Promise.resolve(this);
  }
  this._setupListeners();
  this._loadLocalName();
  return Promise.resolve(this);
};

BLEInterface.prototype._setupListeners = function() {
  var plugin = this.nativePlugin;
  if (!plugin) return;
  var self = this;

  var l1 = plugin.addListener('onDeviceFound', function(data) {
    var id = normId(data.deviceId);
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

  var l2 = plugin.addListener('onDeviceConnected', function(data) {
    var id = normId(data.deviceId);
    self.connectedDevices.set(id, {
      id: id,
      name: data.name || 'NEXO Peer',
      direction: data.direction || 'unknown'
    });
    console.log('[BLE] Conectado:', id.substring(0, 8));
  });
  this._listeners.push(l2);

  var l3 = plugin.addListener('onDeviceDisconnected', function(data) {
    self.connectedDevices.delete(normId(data.deviceId));
    console.log('[BLE] Desconectado');
  });
  this._listeners.push(l3);

  var l4 = plugin.addListener('onPayloadReceived', function(data) {
    var id = normId(data.deviceId);
    var raw = data.content || data.data || '';
    console.log('[BLE] Payload de', id.substring(0, 8), ':', raw.substring(0, 50));

    var parsed = null;
    try {
      var t = raw.trim();
      if (t.charAt(0) === '{' && t.charAt(t.length - 1) === '}') {
        parsed = JSON.parse(t);
      }
    } catch (e) {}

    if (parsed && parsed._t === 'hs') {
      self._peerNames[id] = parsed._n || 'NEXO Device';
      console.log('[BLE] Handshake de', parsed._n);
      return;
    }

    var content = raw;
    var senderName = self._peerNames[id] || data.senderName || 'NEXO Peer';
    var messageId = null;

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

  var l5 = plugin.addListener('onAdvertiseStarted', function() {
    self.isAdvertising = true;
    console.log('[BLE] Advertising iniciado');
  });
  this._listeners.push(l5);
};

BLEInterface.prototype._loadLocalName = function() {
  var self = this;
  if (!this.nativePlugin || !this.nativePlugin.getLocalDeviceInfo) {
    var ua = navigator.userAgent;
    if (ua.indexOf('SM-S928') !== -1) self.localDeviceName = 'Galaxy S24 Ultra';
    else if (ua.indexOf('SM-S918') !== -1) self.localDeviceName = 'Galaxy S23 Ultra';
    return Promise.resolve();
  }
  return this.nativePlugin.getLocalDeviceInfo().then(function(info) {
    self.localDeviceName = info.deviceName || 'NEXO Device';
  }).catch(function() {
    var ua = navigator.userAgent;
    if (ua.indexOf('SM-S928') !== -1) self.localDeviceName = 'Galaxy S24 Ultra';
    else if (ua.indexOf('SM-S918') !== -1) self.localDeviceName = 'Galaxy S23 Ultra';
  });
};

BLEInterface.prototype.startScan = function() {
  if (!this.nativePlugin) return Promise.resolve();
  this.foundDevices.clear();
  var self = this;
  return this.nativePlugin.startScan().then(function() {
    self.isScanning = true;
    setTimeout(function() { self.stopScan(); }, 15000);
  }).catch(function(e) {
    console.error('[BLE] Scan error:', e);
  });
};

BLEInterface.prototype.stopScan = function() {
  if (!this.nativePlugin) return Promise.resolve();
  var self = this;
  return this.nativePlugin.stopScan().then(function() {
    self.isScanning = false;
  }).catch(function() {});
};

BLEInterface.prototype.connect = function(deviceId) {
  if (!this.nativePlugin) return Promise.resolve();
  return this.nativePlugin.connectToDevice({ deviceId: normId(deviceId) }).catch(function(e) {
    console.error('[BLE] Connect error:', e);
  });
};

BLEInterface.prototype.sendMessage = function(deviceId, content) {
  if (!this.nativePlugin) return Promise.reject(new Error('Plugin no disponible'));
  var msg = typeof content === 'string' ? content : JSON.stringify(content);
  return this.nativePlugin.sendMessage({ deviceId: normId(deviceId), message: msg });
};

BLEInterface.prototype.toggleAdvertising = function() {
  if (!this.nativePlugin) return Promise.resolve();
  var self = this;
  if (this.isAdvertising) {
    return this.nativePlugin.stopAdvertising().then(function() {
      self.isAdvertising = false;
    }).catch(function(e) {
      console.error('[BLE] Advertising error:', e);
    });
  } else {
    return this.nativePlugin.startAdvertising().then(function() {
      self.isAdvertising = true;
    }).catch(function(e) {
      console.error('[BLE] Advertising error:', e);
    });
  }
};

// ==================== NEXO APP ====================
function NexoApp() {
  this.bleInterface = null;
  this.activeContact = null;
  this.initialized = false;
  this._sentMessages = new Map();
}

NexoApp.prototype.init = function() {
  var self = this;
  this.bleInterface = new BLEInterface();
  return this.bleInterface.init().then(function() {
    window.addEventListener('nexo:ble:messageReceived', function(e) {
      var d = e.detail;
      console.log('[APP] Mensaje recibido:', d.senderName, d.content.substring(0, 30));

      var conv = getOrCreateConversation(d.deviceId, d.senderName);
      var msg = {
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

      var nameInput = document.getElementById('chat-contact-name');
      if (nameInput && NEXO.activeConversationId === d.deviceId) {
        nameInput.value = d.senderName;
      }
    });

    self.initialized = true;
    console.log('[APP] Inicializado');
    return self;
  });
};

NexoApp.prototype.sendMessage = function(content) {
  if (!this.activeContact) {
    console.warn('[APP] No hay contacto activo');
    return Promise.resolve(false);
  }

  var targetId = this.activeContact.id;
  var messageId = 'msg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);

  var msg = {
    messageId: messageId,
    content: content,
    sender: 'me',
    senderName: 'Tu',
    timestamp: Date.now(),
    isMe: true
  };

  var conv = getOrCreateConversation(targetId, this.activeContact.name);
  conv.messages.push(msg);
  conv.lastMessage = msg;
  saveConversations();

  renderMessage(msg);

  var self = this;
  if (this.bleInterface && this.bleInterface.nativePlugin) {
    var payload = JSON.stringify({
      content: content,
      senderName: self.bleInterface.localDeviceName || 'NEXO Device',
      messageId: messageId
    });
    return this.bleInterface.sendMessage(targetId, payload).then(function() {
      console.log('[APP] Enviado por BLE');
      return true;
    }).catch(function(e) {
      console.error('[APP] Error enviando:', e);
      return false;
    });
  }

  return Promise.resolve(true);
};

NexoApp.prototype.setActiveContact = function(id, name) {
  this.activeContact = { id: normId(id), name: name || 'NEXO Peer' };
  NEXO.activeConversationId = normId(id);

  var nameInput = document.getElementById('chat-contact-name');
  var subtitle = document.getElementById('chat-contact-subtitle');
  if (nameInput) nameInput.value = this.activeContact.name;
  if (subtitle) subtitle.textContent = 'BLUETOOTH';

  loadChatMessages(id);
};

NexoApp.prototype.getStatus = function() {
  return {
    initialized: this.initialized,
    hasBLE: !!(this.bleInterface && this.bleInterface.nativePlugin),
    activeContact: this.activeContact
  };
};

// ==================== UI CONTROLES ====================
function setupUI() {
  var sendBtn = document.getElementById('send-btn');
  var msgInput = document.getElementById('message-input');

  if (sendBtn && msgInput) {
    sendBtn.addEventListener('click', function() {
      var text = msgInput.value.trim();
      if (!text) return;
      msgInput.value = '';

      if (!NEXO.app || !NEXO.app.activeContact) {
        alert('Primero conecta un dispositivo BLE');
        return;
      }

      NEXO.app.sendMessage(text);
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
document.addEventListener('DOMContentLoaded', function() {
  console.log('[NEXO] Iniciando v' + NEXO.version);

  loadConversations();

  NEXO.app = new NexoApp();
  NEXO.app.init().then(function() {
    setupUI();
    hideSplash();
    console.log('[NEXO] Listo');
  }).catch(function(err) {
    console.error('[NEXO] Error init:', err);
    hideSplash();
  });
});

window.NEXO = NEXO;
