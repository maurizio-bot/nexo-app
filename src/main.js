/**
 * main.js - NEXO v9.3.0-CRASH-FIX
 * Orquestador principal. 0 optional chaining. 0 async class methods.
 * Compatible con WebView Chromium 74+
 */

var NEXO = {
  version: '9.3.0-CRASH-FIX',
  initialized: false,
  activeConversationId: null,
  conversations: new Map(),
  app: null,
  bleInterface: null
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
    splash.style.pointerEvents = 'none';
    setTimeout(function() {
      splash.style.display = 'none';
      if (app) app.classList.remove('hidden');
    }, 500);
  } else if (app) {
    app.classList.remove('hidden');
  }
}

// ==================== NEXO APP ====================
function NexoApp() {
  this.bleInterface = null;
  this.activeContact = null;
  this.initialized = false;
  this._sentMessages = new Map();
}

NexoApp.prototype.init = function() {
  var self = this;

  // Inicializar BLE Interface
  try {
    if (typeof BLEInterface === 'function') {
      self.bleInterface = new BLEInterface(null);
      self.bleInterface.init();
      window.bleInterface = self.bleInterface;
    }
  } catch (e) {
    console.error('[APP] Error inicializando BLEInterface:', e);
  }

  // Escuchar mensajes recibidos por BLE
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

  // Escuchar apertura de chat desde BLE panel
  window.addEventListener('nexo:ble:openChat', function(e) {
    var d = e.detail;
    self.setActiveContact(d.contactId || d.address, d.name);
  });

  self.initialized = true;
  console.log('[APP] Inicializado');
  return self;
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
        alert('Primero conecta un dispositivo BLE desde el panel BLE (🔷)');
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

  // Splash agresivo - múltiples intentos
  setTimeout(hideSplash, 100);
  setTimeout(hideSplash, 500);
  setTimeout(hideSplash, 1000);
  setTimeout(hideSplash, 2000);

  loadConversations();

  NEXO.app = new NexoApp();
  NEXO.app.init();

  setupUI();

  hideSplash();
  console.log('[NEXO] Listo');
});

window.NEXO = NEXO;
