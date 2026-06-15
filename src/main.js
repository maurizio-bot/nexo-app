/**
 * main.js - NEXO v10.2-ID-FIX
 * Punto de entrada. Unifica contactos con ble_interface.js via eventos.
 * FIX: Escucha nexo:ble:openChat y nexo:ble:messageReceived.
 * FIX: sendMessage delega a nexoApp.sendMessage() con deviceUUID correcto.
 * FIX: No registra listeners nativos duplicados.
 */

// ============================================================
// CONFIG
// ============================================================
const CFG = {
  APP_NAME: 'NEXO',
  VERSION: '10.2.0',
  SPLASH_MS: 2500,
  DEDUP_TTL: 30000,
};
// ============================================================
// ESTADO
// ============================================================
const ST = {
  initialized: false,
  splashHidden: false,
  view: 'chat-list',
  activeContact: null,
  contacts: new Map(),
  conversations: new Map(),
  seenIds: new Set(),
  blePlugin: null,
  isScanning: false,
};
// ============================================================
// UTILS
// ============================================================
const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);
function gid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}
function hashMsg(sender, content, ts) {
  let h = 0;
  const str = (sender || '') + '|' + (content || '') + '|' + (ts || Date.now());
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) - h) + str.charCodeAt(i);
    h |= 0;
  }
  return 'h' + Math.abs(h).toString(36);
}
function fmtTime(ts) {
  const d = new Date(ts || Date.now());
  return d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
}
function escHtml(t) {
  const d = document.createElement('div');
  d.textContent = t || '';
  return d.innerHTML;
}
// ============================================================
// VISTAS
// ============================================================
function showView(name) {
  ST.view = name;
  $$('.view').forEach(v => v.classList.remove('active'));
  const views = {
    'chat-list': 'chat-list-view',
    'chat': 'chat-view',
    'ble': 'ble-view',
  };
  const el = document.getElementById(views[name]);
  if (el) el.classList.add('active');
  const title = $('#header-title');
  const sub = $('#header-subtitle');
  const action = $('#header-action');
  const scanCont = $('#scan-container');
  if (name === 'chat-list') {
    if (title) { title.textContent = 'NEXO'; title.style.textAlign = 'center'; }
    if (sub) { sub.textContent = 'v10.0'; sub.style.display = 'block'; }
    if (action) { action.style.display = 'flex'; action.innerHTML = '&#9673;'; }
    if (scanCont) scanCont.style.display = 'block';
  } else if (name === 'chat') {
    if (title) { title.textContent = ST.activeContact ? ST.activeContact.name : 'Chat'; title.style.textAlign = 'left'; }
    if (sub) { sub.style.display = 'none'; }
    if (action) { action.style.display = 'none'; }
    if (scanCont) scanCont.style.display = 'none';
  } else if (name === 'ble') {
    if (title) { title.textContent = 'BLE Mesh'; title.style.textAlign = 'center'; }
    if (sub) { sub.style.display = 'none'; }
    if (action) { action.style.display = 'none'; }
    if (scanCont) scanCont.style.display = 'none';
  }
}
// ============================================================
// SPLASH
// ============================================================
function hideSplash() {
  const s = $('#splash-native');
  if (!s || ST.splashHidden) return;
  s.classList.add('hidden');
  ST.splashHidden = true;
  setTimeout(() => { s.style.display = 'none'; }, 500);
}
// ============================================================
// TOAST
// ============================================================
function toast(msg, type) {
  const t = $('#toast');
  if (!t) return;
  t.textContent = msg;
  t.className = 'toast ' + (type || '');
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 3000);
}
// ============================================================
// CONTACTOS (unificado con ble_interface.js)
// ============================================================
function addOrUpdateContact(contactData) {
  const uuid = (contactData.deviceUUID || contactData.id || '').toString().toLowerCase().trim();
  const name = contactData.name || 'NEXO Peer';
  const mac = contactData.macAddress || contactData.mac || contactData.address || '';
  if (!uuid) return;
  const key = uuid;
  const existing = ST.contacts.get(key);
  if (existing) {
    existing.name = name;
    existing.mac = mac || existing.mac;
    existing.lastSeen = Date.now();
    existing.online = true;
  } else {
    ST.contacts.set(key, {
      id: uuid,
      name: name,
      mac: mac,
      deviceUUID: uuid,
      addedAt: Date.now(),
      lastSeen: Date.now(),
      online: true
    });
  }
  renderChatList();
}
function removeContact(uuid) {
  const key = uuid.toString().toLowerCase().trim();
  ST.contacts.delete(key);
  ST.conversations.delete(key);
  renderChatList();
}
// ============================================================
// CHAT LIST
// ============================================================
function renderChatList() {
  const container = $('#chat-list-container');
  const empty = $('#chat-empty');
  if (!container) return;
  container.innerHTML = '';
  const contacts = Array.from(ST.contacts.values());
  if (contacts.length === 0) {
    if (empty) empty.style.display = 'flex';
    return;
  }
  if (empty) empty.style.display = 'none';
  contacts.forEach(c => {
    const key = c.id;
    const conv = ST.conversations.get(key) || [];
    const lastMsg = conv[conv.length - 1];
    const unread = conv.filter(m => !m.read).length;
    const item = document.createElement('div');
    item.className = 'chat-item';
    item.dataset.uuid = c.id;
    const avatarLetter = (c.name && c.name[0]) ? c.name[0].toUpperCase() : '?';
    const lastContent = (lastMsg && lastMsg.content) ? lastMsg.content : 'Sin mensajes';
    const lastTime = lastMsg ? fmtTime(lastMsg.timestamp) : '';
    const badgeHtml = unread > 0 ? '<div class="chat-badge">' + unread + '</div>' : '';
    item.innerHTML = '<div class="chat-avatar">' + escHtml(avatarLetter) + '</div>' +
      '<div class="chat-info">' +
      '<div class="chat-name">' + escHtml(c.name) + '</div>' +
      '<div class="chat-preview">' + escHtml(lastContent) + '</div>' +
      '</div>' +
      '<div class="chat-meta">' +
      '<div class="chat-time">' + lastTime + '</div>' +
      badgeHtml +
      '</div>';
    item.addEventListener('click', () => openChat(c.id, c.name, c.mac));
    container.appendChild(item);
  });
}
// ============================================================
// CHAT
// ============================================================
function openChat(contactId, name, mac) {
  const key = contactId.toString().toLowerCase().trim();
  const contact = ST.contacts.get(key);
  const displayName = contact ? contact.name : (name || 'NEXO Peer');
  const deviceMac = contact ? contact.mac : (mac || '');
  ST.activeContact = {
    id: key,
    name: displayName,
    mac: deviceMac,
    deviceUUID: key
  };
  // Marcar como leidos
  const conv = ST.conversations.get(key) || [];
  conv.forEach(m => m.read = true);
  // Actualizar header
  const hName = $('#chat-header-name');
  const hStatus = $('#chat-header-status');
  const hDot = $('#chat-status-dot');
  if (hName) hName.textContent = displayName;
  if (hStatus) hStatus.textContent = 'BLUETOOTH';
  if (hDot) hDot.style.display = 'inline-block';
  // Sincronizar con nexoApp
  if (window.nexoApp) {
    window.nexoApp.activeContact = ST.activeContact;
  }
  // Renderizar mensajes
  renderMessages(key);
  showView('chat');
}
function renderMessages(contactKey) {
  const container = $('#messages-container');
  if (!container) return;
  container.innerHTML = '';
  const key = (contactKey || '').toString().toLowerCase().trim();
  const msgs = ST.conversations.get(key) || [];
  msgs.forEach(m => {
    const isOwn = m.own === true || m.sender === 'Tu' || m._own === true;
    const div = document.createElement('div');
    div.className = 'msg ' + (isOwn ? 'sent' : 'rcvd');
    div.innerHTML = escHtml(m.content) + ' <span class="msg-time">' + fmtTime(m.timestamp) + (isOwn ? ' &#10003;' : '') + '</span>';
    container.appendChild(div);
  });
  scrollChat();
}
function scrollChat() {
  const area = $('#messages-area');
  if (area) area.scrollTop = area.scrollHeight;
}
function sendMessage() {
  const input = $('#message-input');
  const content = (input && input.value) ? input.value.trim() : '';
  if (!content) return;
  if (!ST.activeContact) {
    toast('Selecciona un contacto primero', 'err');
    return;
  }
  const msg = {
    id: gid(),
    content: content,
    sender: 'Tu',
    timestamp: Date.now(),
    own: true,
    read: true,
  };
  const key = ST.activeContact.id;
  if (!ST.conversations.has(key)) ST.conversations.set(key, []);
  ST.conversations.get(key).push(msg);
  renderMessages(key);
  if (input) input.value = '';
  // Delegar envio a nexoApp si existe
  if (window.nexoApp && window.nexoApp.sendMessage) {
    window.nexoApp.sendMessage({
      content: content,
      recipient: ST.activeContact.id,
      messageId: msg.id,
      senderName: 'Tu'
    }).catch(function(e) {
      console.warn('[NEXO] nexoApp.sendMessage error:', e);
    });
  } else {
    // Fallback directo al plugin
    try {
      const cap = (typeof Capacitor !== 'undefined') ? Capacitor : null;
      const plugin = (cap && cap.Plugins && cap.Plugins.NexoBLE) ? cap.Plugins.NexoBLE : null;
      if (plugin && plugin.sendMessage) {
        plugin.sendMessage({ deviceId: ST.activeContact.mac || ST.activeContact.id, message: content });
      }
    } catch (e) {
      console.error('[NEXO] Send error:', e);
    }
  }
  renderChatList();
}
function onMessageReceived(payload) {
  const content = (payload && payload.content) || (payload && payload.text) || (payload && payload.message) || '';
  const senderUUID = (payload && payload.sender) || (payload && payload.deviceUUID) || (payload && payload.from) || 'desconocido';
  const senderName = (payload && payload.senderName) || senderUUID;
  const ts = (payload && payload.timestamp) || Date.now();
  const id = (payload && payload.messageId) || (payload && payload.id) || hashMsg(senderUUID, content, ts);
  if (ST.seenIds.has(id)) return;
  ST.seenIds.add(id);
  setTimeout(() => ST.seenIds.delete(id), CFG.DEDUP_TTL);
  // Agregar contacto si es nuevo
  const sKey = senderUUID.toString().toLowerCase().trim();
  if (!ST.contacts.has(sKey)) {
    ST.contacts.set(sKey, {
      id: sKey,
      name: senderName,
      deviceUUID: sKey,
      mac: (payload && payload.macAddress) || '',
      addedAt: Date.now(),
      lastSeen: Date.now(),
      online: true
    });
  } else {
    const c = ST.contacts.get(sKey);
    c.lastSeen = Date.now();
    c.online = true;
  }
  // Guardar mensaje
  if (!ST.conversations.has(sKey)) ST.conversations.set(sKey, []);
  ST.conversations.get(sKey).push({ id: id, content: content, sender: senderName, timestamp: ts, own: false, read: false });
  // Renderizar si es chat activo
  if (ST.view === 'chat' && ST.activeContact && ST.activeContact.id === sKey) {
    renderMessages(sKey);
  } else {
    toast('Nuevo mensaje de ' + senderName, 'ok');
    renderChatList();
  }
}
// ============================================================
// BLE SCAN (delegado a ble_interface.js, solo UI en main.js)
// ============================================================
function toggleScan() {
  if (window.bleInterface && window.bleInterface.toggleScan) {
    window.bleInterface.toggleScan();
  } else {
    toast('BLE Interface no disponible', 'err');
  }
}
// ============================================================
// EVENTOS DE BLE_INTERFACE (unificacion)
// ============================================================
function setupBLEEvents() {
  // Contacto agregado desde ble_interface.js
  window.addEventListener('nexo:contact:added', function(e) {
    if (e.detail && e.detail.contact) {
      addOrUpdateContact(e.detail.contact);
    }
  });
  // Contacto actualizado
  window.addEventListener('nexo:contact:updated', function(e) {
    if (e.detail && e.detail.contact) {
      addOrUpdateContact(e.detail.contact);
    }
  });
  // Contacto eliminado
  window.addEventListener('nexo:contact:removed', function(e) {
    if (e.detail && e.detail.deviceUUID) {
      removeContact(e.detail.deviceUUID);
    }
  });
  // Abrir chat desde ble_interface.js
  window.addEventListener('nexo:ble:openChat', function(e) {
    if (e.detail) {
      const d = e.detail;
      addOrUpdateContact({
        deviceUUID: d.contactId,
        name: d.name,
        macAddress: d.address
      });
      openChat(d.contactId, d.name, d.address);
    }
  });
  // Mensaje recibido desde ble_interface.js
  window.addEventListener('nexo:ble:messageReceived', function(e) {
    if (e.detail) {
      onMessageReceived(e.detail);
    }
  });
}
// ============================================================
// EVENTS
// ============================================================
function bindEvents() {
  // Header BLE button -> abrir vista BLE
  const bleBtn = $('#header-action');
  if (bleBtn) {
    bleBtn.addEventListener('click', () => {
      if (window.bleInterface && window.bleInterface.togglePanel) {
        window.bleInterface.togglePanel();
      } else {
        showView('ble');
      }
    });
  }
  // BLE back button -> volver a chat-list
  const bleBack = $('#ble-back');
  if (bleBack) {
    bleBack.addEventListener('click', () => {
      showView('chat-list');
    });
  }
  // Chat back button
  const backBtn = $('#chat-back');
  if (backBtn) {
    backBtn.addEventListener('click', () => {
      showView('chat-list');
    });
  }
  // Scan button
  const scanBtn = $('#scan-btn');
  if (scanBtn) {
    scanBtn.addEventListener('click', toggleScan);
  }
  // Send button
  const sendBtn = $('#send-btn');
  if (sendBtn) {
    sendBtn.addEventListener('click', sendMessage);
  }
  // Enter key
  const input = $('#message-input');
  if (input) {
    input.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') sendMessage();
    });
  }
}
// ============================================================
// BOOT
// ============================================================
async function boot() {
  console.log('[NEXO] Boot ' + CFG.APP_NAME + ' v' + CFG.VERSION);
  setupBLEEvents();
  bindEvents();
  renderChatList();
  showView('chat-list');
  setTimeout(hideSplash, CFG.SPLASH_MS);
  // Safety timeout
  setTimeout(() => {
    if (!ST.splashHidden) hideSplash();
  }, 8000);
}
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
// Exports
window.NEXO = {
  sendMessage: sendMessage,
  openChat: openChat,
  showView: showView,
  toast: toast,
  ST: ST
};
