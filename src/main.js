/**
 * main.js - NEXO v9.3.0-CRASH-FIX
 * Un solo archivo. 0 imports. 0 exports. 0 clases.
 * Compatible con index.html actual.
 */

var NEXO = {
  version: '9.3.0-CRASH-FIX',
  initialized: false,
  activeConversationId: null,
  conversations: new Map(),
  ble: {
    plugin: null,
    isScanning: false,
    isAdvertising: false,
    foundDevices: new Map(),
    connectedDevices: new Map(),
    receivedIds: new Set(),
    peerNames: {},
    localName: 'NEXO Device'
  }
};

// ==================== UTILIDADES ====================
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
  if (!ts) return 'ahora';
  var d = new Date(ts);
  var now = new Date();
  var diff = (now - d) / 1000;
  if (diff < 60) return 'ahora';
  if (diff < 3600) return Math.floor(diff / 60) + 'm';
  if (diff < 86400) return Math.floor(diff / 3600) + 'h';
  return d.toLocaleDateString();
}

// ==================== CONVERSACIONES ====================
function getConv(id, name) {
  var nid = normId(id);
  if (!NEXO.conversations.has(nid)) {
    NEXO.conversations.set(nid, {
      id: nid,
      name: name || 'NEXO Peer',
      messages: [],
      lastMessage: null,
      unread: 0
    });
  }
  return NEXO.conversations.get(nid);
}

function saveConvs() {
  try {
    var obj = {};
    NEXO.conversations.forEach(function(v, k) { obj[k] = v; });
    localStorage.setItem('nexo_conversations_v4', JSON.stringify(obj));
  } catch (e) {}
}

function loadConvs() {
  try {
    var raw = localStorage.getItem('nexo_conversations_v4');
    if (!raw) return;
    var parsed = JSON.parse(raw);
    Object.keys(parsed).forEach(function(k) {
      NEXO.conversations.set(k, parsed[k]);
    });
  } catch (e) {}
}

// ==================== RENDER CHAT ====================
function renderMsg(msg) {
  var container = document.getElementById('messages-container');
  if (!container) return;
  var isMe = msg.isMe === true;
  var bubble = document.createElement('div');
  bubble.className = 'msg-bubble ' + (isMe ? 'msg-me' : 'msg-them');
  bubble.dataset.mid = msg.messageId || '';

  var sender = escapeHtml(msg.senderName || msg.sender || 'NEXO Peer');
  var content = escapeHtml(msg.content || msg.text || '');
  var time = formatTime(msg.timestamp);

  bubble.innerHTML =
    '<div class="msg-sender">' + sender + '</div>' +
    '<div class="msg-text">' + content + '</div>' +
    '<div class="msg-time">' + time + '</div>';

  container.appendChild(bubble);
  container.scrollTop = container.scrollHeight;
}

function clearChat() {
  var c = document.getElementById('messages-container');
  if (c) c.innerHTML = '';
}

function loadChat(convId) {
  clearChat();
  var conv = NEXO.conversations.get(normId(convId));
  if (conv && conv.messages) {
    conv.messages.forEach(function(m) { renderMsg(m); });
  }
}

// ==================== SPLASH ====================
function hideSplash() {
  try {
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
  } catch (e) {}
}

// ==================== PLUGIN NATIVO ====================
function getPlugin() {
  try {
    if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.NexoBLE) {
      return window.Capacitor.Plugins.NexoBLE;
    }
  } catch (e) {}
  return null;
}

// ==================== BLE ====================
function initBLE() {
  NEXO.ble.plugin = getPlugin();
  if (!NEXO.ble.plugin) {
    console.log('[BLE] Plugin no disponible');
    updateStatus('OFFLINE (Dummy)');
    return;
  }

  var p = NEXO.ble.plugin;

  // Listeners nativos
  try {
    p.addListener('onDeviceFound', function(data) {
      var id = normId(data.deviceId);
      if (!id) return;
      NEXO.ble.foundDevices.set(id, {
        id: id,
        name: data.name || 'NEXO Device',
        rssi: data.rssi,
        lastSeen: Date.now()
      });
      renderDeviceList();
    });
  } catch (e) {}

  try {
    p.addListener('onDeviceConnected', function(data) {
      var id = normId(data.deviceId);
      NEXO.ble.connectedDevices.set(id, {
        id: id,
        name: data.name || 'NEXO Peer',
        direction: data.direction || 'unknown'
      });
      updateStatus('CONECTADO');
      renderDeviceList();
    });
  } catch (e) {}

  try {
    p.addListener('onDeviceDisconnected', function(data) {
      NEXO.ble.connectedDevices.delete(normId(data.deviceId));
      updateStatus('ENCENDIDO');
      renderDeviceList();
    });
  } catch (e) {}

  try {
    p.addListener('onPayloadReceived', function(data) {
      var id = normId(data.deviceId);
      var raw = data.content || data.data || '';
      if (!raw) return;

      var parsed = null;
      try {
        var t = raw.trim();
        if (t.charAt(0) === '{' && t.charAt(t.length - 1) === '}') {
          parsed = JSON.parse(t);
        }
      } catch (e) {}

      // Handshake
      if (parsed && parsed._t === 'hs') {
        NEXO.ble.peerNames[id] = parsed._n || 'NEXO Device';
        return;
      }

      var content = raw;
      var senderName = NEXO.ble.peerNames[id] || data.senderName || 'NEXO Peer';
      var messageId = null;

      if (parsed && parsed.content) {
        content = parsed.content;
        if (parsed.senderName) senderName = parsed.senderName;
        if (parsed.messageId) messageId = parsed.messageId;
      }

      if (messageId && NEXO.ble.receivedIds.has(messageId)) return;
      if (messageId) NEXO.ble.receivedIds.add(messageId);

      // Guardar conversacion
      var conv = getConv(id, senderName);
      var msg = {
        messageId: messageId || 'msg_' + Date.now(),
        content: content,
        sender: id,
        senderName: senderName,
        timestamp: Date.now(),
        isMe: false
      };
      conv.messages.push(msg);
      if (conv.messages.length > 500) conv.messages = conv.messages.slice(-500);
      conv.lastMessage = msg;
      saveConvs();

      // Render si es la conversacion activa
      if (NEXO.activeConversationId === id) {
        renderMsg(msg);
      }

      // Actualizar nombre en header si es activo
      var nameInput = document.getElementById('chat-contact-name');
      if (nameInput && NEXO.activeConversationId === id) {
        nameInput.value = senderName;
      }
    });
  } catch (e) {}

  // Estado inicial
  try {
    p.isBluetoothEnabled().then(function(state) {
      updateStatus(state.enabled ? 'ENCENDIDO' : 'APAGADO');
    }).catch(function() {
      updateStatus('ERROR');
    });
  } catch (e) {
    updateStatus('ERROR');
  }

  // Nombre local
  try {
    var ua = navigator.userAgent;
    if (ua.indexOf('SM-S928') !== -1) NEXO.ble.localName = 'Galaxy S24 Ultra';
    else if (ua.indexOf('SM-S918') !== -1) NEXO.ble.localName = 'Galaxy S23 Ultra';
  } catch (e) {}
}

function toggleScan() {
  var btn = document.getElementById('btn-scan');
  if (NEXO.ble.isScanning) {
    // Detener
    if (NEXO.ble.plugin) {
      try {
        NEXO.ble.plugin.stopScan().then(function() {
          NEXO.ble.isScanning = false;
          NEXO.ble.foundDevices.clear();
          if (btn) { btn.classList.remove('active'); btn.textContent = 'Buscar'; }
          updateStatus('ENCENDIDO');
          renderDeviceList();
        }).catch(function() {});
      } catch (e) {}
    } else {
      NEXO.ble.isScanning = false;
      if (btn) { btn.classList.remove('active'); btn.textContent = 'Buscar'; }
    }
  } else {
    // Iniciar
    NEXO.ble.foundDevices.clear();
    if (NEXO.ble.plugin) {
      try {
        NEXO.ble.plugin.startScan().then(function() {
          NEXO.ble.isScanning = true;
          if (btn) { btn.classList.add('active'); btn.textContent = 'Detener'; }
          updateStatus('ESCANEANDO...');
          setTimeout(function() { if (NEXO.ble.isScanning) toggleScan(); }, 15000);
        }).catch(function(e) {
          console.error('[BLE] Scan error:', e);
        });
      } catch (e) {}
    } else {
      NEXO.ble.isScanning = true;
      if (btn) { btn.classList.add('active'); btn.textContent = 'Detener'; }
      setTimeout(function() { if (NEXO.ble.isScanning) toggleScan(); }, 15000);
    }
  }
}

function toggleVisibility() {
  var btn = document.getElementById('btn-visibility');
  if (!NEXO.ble.plugin) {
    alert('BLE no disponible');
    return;
  }
  if (NEXO.ble.isAdvertising) {
    try {
      NEXO.ble.plugin.stopAdvertising().then(function() {
        NEXO.ble.isAdvertising = false;
        if (btn) { btn.classList.remove('active'); btn.textContent = 'Visible'; }
      }).catch(function() {});
    } catch (e) {}
  } else {
    try {
      NEXO.ble.plugin.startAdvertising().then(function() {
        NEXO.ble.isAdvertising = true;
        if (btn) { btn.classList.add('active'); btn.textContent = 'Visible ✓'; }
      }).catch(function(e) {
        console.error('[BLE] Advertising error:', e);
      });
    } catch (e) {}
  }
}

function toggleDeviceList() {
  var list = document.getElementById('device-list');
  if (!list) return;
  list.classList.toggle('visible');
  if (list.classList.contains('visible')) {
    renderDeviceList();
  }
}

function renderDeviceList() {
  var content = document.getElementById('device-list-content');
  if (!content) return;

  var html = '';
  NEXO.ble.foundDevices.forEach(function(dev, id) {
    html += '<div class="device-item" onclick="selectDevice(\'' + id + '\')">' +
      '<div class="device-name">' + escapeHtml(dev.name || 'NEXO Device') + '</div>' +
      '<div class="device-id">' + id.substring(0, 8) + '...</div>' +
      '<div class="device-rssi">📶 ' + (dev.rssi || '?') + ' dBm</div>' +
      '</div>';
  });

  if (NEXO.ble.foundDevices.size === 0) {
    html = '<div style="padding:20px;text-align:center;color:#666">No hay dispositivos</div>';
  }

  content.innerHTML = html;
}

function selectDevice(deviceId) {
  var dev = NEXO.ble.foundDevices.get(normId(deviceId));
  if (!dev) return;

  NEXO.activeConversationId = normId(deviceId);

  var nameInput = document.getElementById('chat-contact-name');
  var subtitle = document.getElementById('chat-contact-subtitle');
  if (nameInput) nameInput.value = dev.name || 'NEXO Peer';
  if (subtitle) subtitle.textContent = 'BLUETOOTH';

  // Ocultar lista
  var list = document.getElementById('device-list');
  if (list) list.classList.remove('visible');

  // Cargar chat previo
  loadChat(deviceId);

  // Conectar si hay plugin
  if (NEXO.ble.plugin) {
    try {
      NEXO.ble.plugin.connectToDevice({ deviceId: normId(deviceId) }).catch(function(e) {
        console.warn('[BLE] Connect error:', e);
      });
    } catch (e) {}
  }
}

function updateStatus(text) {
  var subtitle = document.getElementById('chat-contact-subtitle');
  if (subtitle) subtitle.textContent = text || 'OFFLINE';
}

// ==================== ENVIO MENSAJE ====================
function sendMessage() {
  var input = document.getElementById('message-input');
  if (!input) return;
  var text = input.value.trim();
  if (!text) return;
  input.value = '';

  if (!NEXO.activeConversationId) {
    alert('Primero selecciona un dispositivo BLE');
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
    isMe: true
  };

  var conv = getConv(targetId, null);
  conv.messages.push(msg);
  conv.lastMessage = msg;
  saveConvs();

  renderMsg(msg);

  if (NEXO.ble.plugin) {
    try {
      var payload = JSON.stringify({
        content: text,
        senderName: NEXO.ble.localName,
        messageId: messageId
      });
      NEXO.ble.plugin.sendMessage({ deviceId: targetId, message: payload }).then(function() {
        console.log('[APP] Enviado por BLE');
      }).catch(function(e) {
        console.error('[APP] Error enviando:', e);
      });
    } catch (e) {}
  }
}

// ==================== INICIALIZACION ====================
function initUI() {
  var btnScan = document.getElementById('btn-scan');
  var btnVis = document.getElementById('btn-visibility');
  var btnDev = document.getElementById('btn-devices');
  var btnSend = document.getElementById('send-btn');
  var input = document.getElementById('message-input');

  if (btnScan) btnScan.addEventListener('click', toggleScan);
  if (btnVis) btnVis.addEventListener('click', toggleVisibility);
  if (btnDev) btnDev.addEventListener('click', toggleDeviceList);
  if (btnSend) btnSend.addEventListener('click', sendMessage);
  if (input) {
    input.addEventListener('keydown', function(e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });
  }
}

document.addEventListener('DOMContentLoaded', function() {
  console.log('[NEXO] Iniciando v' + NEXO.version);

  // Splash agresivo
  setTimeout(hideSplash, 100);
  setTimeout(hideSplash, 500);
  setTimeout(hideSplash, 1000);
  setTimeout(hideSplash, 2000);

  loadConvs();
  initBLE();
  initUI();

  hideSplash();
  console.log('[NEXO] Listo');
});
