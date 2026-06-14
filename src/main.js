/**
 * main.js - NEXO v10.0
 * WhatsApp 2026 style. 0 exports. 0 imports.
 */

var NEXO = {
  version: '10.0',
  initialized: false,
  activeConversationId: null,
  conversations: new Map(),
  app: null,
  bleInterface: null
};

// ==================== UTILS ====================
function normId(id) {
  if (!id) return '';
  return id.toString().toLowerCase().replace(/[:-]/g, '').trim();
}

function escapeHtml(text) {
  if (typeof text !== 'string') return '';
  var div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function formatTime(ts) {
  if (!ts) return '';
  var d = new Date(ts);
  var h = d.getHours();
  var m = d.getMinutes();
  return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m;
}

function avatarColor(name) {
  var colors = ['#00d4ff', '#00ff88', '#ffaa00', '#ff6b6b', '#c084fc', '#f472b6'];
  var hash = 0;
  for (var i = 0; i < (name || '').length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
}

function avatarInitial(name) {
  return (name || '?').charAt(0).toUpperCase();
}

// ==================== CONVERSATIONS ====================
function getConv(id, name) {
  var nid = normId(id);
  if (!NEXO.conversations.has(nid)) {
    NEXO.conversations.set(nid, {
      id: nid,
      name: name || 'NEXO Peer',
      messages: [],
      lastMessage: null,
      unread: 0,
      avatarColor: avatarColor(name || 'NEXO')
    });
  }
  return NEXO.conversations.get(nid);
}

function saveConvs() {
  try {
    var obj = {};
    NEXO.conversations.forEach(function(v, k) { obj[k] = v; });
    localStorage.setItem('nexo_conversations_v10', JSON.stringify(obj));
  } catch (e) {}
}

function loadConvs() {
  try {
    var raw = localStorage.getItem('nexo_conversations_v10');
    if (!raw) return;
    var parsed = JSON.parse(raw);
    Object.keys(parsed).forEach(function(k) {
      NEXO.conversations.set(k, parsed[k]);
    });
  } catch (e) {}
}

// ==================== RENDER ====================
function renderConversations() {
  var list = document.getElementById('conversations-list');
  if (!list) return;

  if (NEXO.conversations.size === 0) {
    list.innerHTML = '<div class="empty-state">No hay conversaciones</div>';
    return;
  }

  list.innerHTML = '';
  var sorted = [];
  NEXO.conversations.forEach(function(conv) {
    sorted.push(conv);
  });
  sorted.sort(function(a, b) {
    var ta = (a.lastMessage && a.lastMessage.timestamp) || a.createdAt || 0;
    var tb = (b.lastMessage && b.lastMessage.timestamp) || b.createdAt || 0;
    return tb - ta;
  });

  sorted.forEach(function(conv) {
    var item = document.createElement('div');
    item.className = 'conv-item';
    item.onclick = function() { openChat(conv.id); };

    var lastMsg = conv.lastMessage;
    var preview = lastMsg ? (lastMsg.content || '').substring(0, 40) : 'Sin mensajes';
    var time = lastMsg ? formatTime(lastMsg.timestamp) : '';
    var unread = conv.unread || 0;

    item.innerHTML =
      '<div class="conv-avatar" style="background:' + (conv.avatarColor || avatarColor(conv.name)) + '">' +
        avatarInitial(conv.name) +
      '</div>' +
      '<div class="conv-info">' +
        '<div class="conv-name">' + escapeHtml(conv.name) + '</div>' +
        '<div class="conv-preview">' + escapeHtml(preview) + '</div>' +
      '</div>' +
      '<div class="conv-meta">' +
        '<div class="conv-time">' + time + '</div>' +
        (unread > 0 ? '<div class="conv-badge">' + unread + '</div>' : '') +
      '</div>';

    list.appendChild(item);
  });
}

function renderMessage(msg) {
  var container = document.getElementById('chat-messages');
  if (!container) return;

  var isMe = msg.isMe === true;
  var row = document.createElement('div');
  row.className = 'msg-row ' + (isMe ? 'me' : 'them');

  var bubble = document.createElement('div');
  bubble.className = 'msg-bubble ' + (isMe ? 'me' : 'them');
  bubble.dataset.mid = msg.messageId || '';

  var checks = isMe ? '<span class="msg-check ' + (msg.read ? 'read' : '') + '">✓✓</span>' : '';

  bubble.innerHTML =
    '<div class="msg-text">' + escapeHtml(msg.content || '') + '</div>' +
    '<div class="msg-meta">' +
      '<span class="msg-time">' + formatTime(msg.timestamp) + '</span>' +
      checks +
    '</div>';

  row.appendChild(bubble);
  container.appendChild(row);
  container.scrollTop = container.scrollHeight;
}

function clearChat() {
  var c = document.getElementById('chat-messages');
  if (c) c.innerHTML = '';
}

function loadChatMessages(convId) {
  clearChat();
  var conv = NEXO.conversations.get(normId(convId));
  if (conv && conv.messages) {
    conv.messages.forEach(function(m) { renderMessage(m); });
  }
}

// ==================== NAVIGATION ====================
function openChat(convId) {
  var conv = getConv(convId);
  NEXO.activeConversationId = normId(convId);

  var nameEl = document.getElementById('chat-name');
  var statusEl = document.getElementById('chat-status');
  if (nameEl) nameEl.textContent = conv.name;
  if (statusEl) statusEl.textContent = 'BLUETOOTH';

  loadChatMessages(convId);

  document.getElementById('app').classList.add('hidden');
  document.getElementById('chat-view').classList.remove('hidden');

  // Reset unread
  conv.unread = 0;
  saveConvs();
  renderConversations();
}

function closeChat() {
  document.getElementById('chat-view').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');
  NEXO.activeConversationId = null;
  renderConversations();
}

function switchTab(tabName) {
  document.querySelectorAll('.tab-btn').forEach(function(btn) {
    btn.classList.toggle('active', btn.dataset.tab === tabName);
  });
  document.querySelectorAll('.tab-content').forEach(function(content) {
    content.classList.toggle('active', content.id === 'tab-' + tabName);
  });
  if (tabName === 'chats') renderConversations();
}

// ==================== BLE INTEGRATION ====================
function initBLE() {
  try {
    if (typeof BLEInterface === 'function') {
      NEXO.bleInterface = new BLEInterface(null);
      NEXO.bleInterface.init();
      window.bleInterface = NEXO.bleInterface;
    }
  } catch (e) {
    console.error('[APP] BLE init error:', e);
  }

  // Listen BLE messages
  window.addEventListener('nexo:ble:messageReceived', function(e) {
    var d = e.detail;
    var conv = getConv(d.deviceId, d.senderName);
    var msg = {
      messageId: d.messageId || 'msg_' + Date.now(),
      content: d.content,
      sender: d.deviceId,
      senderName: d.senderName,
      timestamp: d.timestamp || Date.now(),
      isMe: false
    };
    conv.messages.push(msg);
    if (conv.messages.length > 500) conv.messages = conv.messages.slice(-500);
    conv.lastMessage = msg;
    if (NEXO.activeConversationId !== normId(d.deviceId)) {
      conv.unread = (conv.unread || 0) + 1;
    }
    saveConvs();

    if (NEXO.activeConversationId === normId(d.deviceId)) {
      renderMessage(msg);
    }
    renderConversations();
  });

  // Listen BLE open chat
  window.addEventListener('nexo:ble:openChat', function(e) {
    var d = e.detail;
    openChat(d.contactId || d.address);
  });
}

// ==================== SEND MESSAGE ====================
function sendMessage() {
  var input = document.getElementById('message-input');
  if (!input) return;
  var text = input.value.trim();
  if (!text) return;
  input.value = '';

  if (!NEXO.activeConversationId) {
    alert('Selecciona una conversación');
    return;
  }

  var targetId = NEXO.activeConversationId;
  var messageId = 'msg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);

  var msg = {
    messageId: messageId,
    content: text,
    sender: 'me',
    senderName: 'Tu',
    timestamp: Date.now(),
    isMe: true,
    read: false
  };

  var conv = getConv(targetId);
  conv.messages.push(msg);
  conv.lastMessage = msg;
  saveConvs();

  renderMessage(msg);

  if (NEXO.bleInterface && NEXO.bleInterface.nativePlugin) {
    try {
      var payload = JSON.stringify({
        content: text,
        senderName: NEXO.bleInterface.localDeviceName || 'NEXO Device',
        messageId: messageId
      });
      NEXO.bleInterface.sendMessage(targetId, payload).catch(function(e) {
        console.error('[APP] Send error:', e);
      });
    } catch (e) {}
  }
}

// ==================== BLUETOOTH BANNER ====================
function checkBluetooth() {
  var banner = document.getElementById('bt-banner');
  if (!banner) return;

  try {
    if (NEXO.bleInterface && NEXO.bleInterface.nativePlugin) {
      NEXO.bleInterface.nativePlugin.isBluetoothEnabled().then(function(state) {
        if (state.enabled) {
          banner.classList.add('hidden');
        } else {
          banner.classList.remove('hidden');
        }
      }).catch(function() {
        banner.classList.remove('hidden');
      });
    } else {
      banner.classList.remove('hidden');
    }
  } catch (e) {
    banner.classList.remove('hidden');
  }
}

// ==================== UI SETUP ====================
function setupUI() {
  // Tabs
  document.querySelectorAll('.tab-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      switchTab(btn.dataset.tab);
    });
  });

  // Chat back
  var backBtn = document.getElementById('chat-back');
  if (backBtn) backBtn.addEventListener('click', closeChat);

  // Send
  var sendBtn = document.getElementById('btn-send');
  var msgInput = document.getElementById('message-input');
  if (sendBtn) sendBtn.addEventListener('click', sendMessage);
  if (msgInput) {
    msgInput.addEventListener('keydown', function(e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });
  }

  // BLE buttons
  var btnScan = document.getElementById('btn-scan');
  var btnVis = document.getElementById('btn-visibility');
  if (btnScan) {
    btnScan.addEventListener('click', function() {
      if (NEXO.bleInterface) NEXO.bleInterface.toggleScan();
    });
  }
  if (btnVis) {
    btnVis.addEventListener('click', function() {
      if (NEXO.bleInterface) NEXO.bleInterface.toggleVisibility();
    });
  }

  // BT banner action
  var btAction = document.querySelector('.bt-action');
  if (btAction) {
    btAction.addEventListener('click', function() {
      try {
        if (NEXO.bleInterface && NEXO.bleInterface.nativePlugin) {
          NEXO.bleInterface.nativePlugin.requestBluetoothEnable();
        }
      } catch (e) {}
    });
  }

  // Check BT status periodically
  setInterval(checkBluetooth, 5000);
  checkBluetooth();
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

// ==================== INIT ====================
document.addEventListener('DOMContentLoaded', function() {
  console.log('[NEXO] v' + NEXO.version);

  setTimeout(hideSplash, 100);
  setTimeout(hideSplash, 500);
  setTimeout(hideSplash, 1000);
  setTimeout(hideSplash, 2000);

  loadConvs();
  initBLE();
  setupUI();
  renderConversations();

  hideSplash();
  console.log('[NEXO] Ready');
});

window.NEXO = NEXO;
