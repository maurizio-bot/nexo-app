/**
 * src/main.js - Punto de entrada NEXO v10.0-SHIM-NEXO
 * FIX: Conversaciones separadas, mensajes filtrados por contacto activo,
 *      dedup centralizado. Paleta NEXO v10: fondo #000, texto #B0B0B0.
 */

import { NEXO_DIAG } from './core/nap.js';

// ============================================================
// CONFIGURACION
// ============================================================
const CONFIG = {
  APP_NAME: 'NEXO',
  VERSION: '10.0.0-SHIM',
  BUILD: 'NEXO-v10.0-20260614',
  SPLASH_TIMEOUT: 4000,
  RECONNECT_INTERVAL: 5000,
  MESSAGE_MAX_LEN: 2000,
  DEBOUNCE_MS: 300,
  DEDUP_TTL_MS: 30000,
};

// ============================================================
// ESTADO GLOBAL
// ============================================================
const STATE = {
  initialized: false,
  splashHidden: false,
  activeContact: null,
  contacts: new Map(),
  conversations: new Map(),
  seenMessageIds: new Set(),
  bleInterface: null,
  nexoApp: null,
  pendingSends: new Map(),
  lastRenderTime: 0,
};

// ============================================================
// UTILIDADES
// ============================================================
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
}

function hashPayload(sender, content, timestamp) {
  let h = 0;
  const str = (sender || '') + '|' + (content || '') + '|' + (timestamp || Date.now());
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) - h) + str.charCodeAt(i);
    h |= 0;
  }
  return 'h' + Math.abs(h).toString(36);
}

function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

function formatTime(ts) {
  const d = new Date(ts);
  return d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
}

// ============================================================
// SPLASH SCREEN
// ============================================================
function _forceHideSplash() {
  const splash = document.getElementById('splash-native');
  if (!splash) return;
  splash.style.opacity = '0';
  splash.style.pointerEvents = 'none';
  splash.style.transform = 'scale(1.05)';
  setTimeout(() => {
    splash.style.display = 'none';
    STATE.splashHidden = true;
  }, 500);
}

// ============================================================
// INICIALIZACION BLE (Permission Shim)
// ============================================================
async function initBLEWithShim() {
  try {
    const plugin = Capacitor?.Plugins?.NexoBLE;
    if (!plugin) {
      console.warn('[NEXO] Plugin NexoBLE no disponible');
      return false;
    }

    const status = await plugin.checkBLEStatus();
    console.log('[NEXO] BLE status:', status);

    if (!status?.allGranted) {
      console.log('[NEXO] Solicitando permisos BLE...');
      await plugin.initializeBLE();
    }

    return true;
  } catch (err) {
    console.error('[NEXO] Error init BLE:', err);
    return false;
  }
}

// ============================================================
// THE STREAM (Renderizado de mensajes)
// ============================================================
function getTheStream() {
  if (window.TheStream && typeof window.TheStream.appendItems === 'function') {
    return window.TheStream;
  }
  return null;
}

function renderMessageToDOM(msg) {
  const container = document.getElementById('messages-container');
  if (!container) return;

  const isOwn = msg.sender === 'Tú' || msg.sender === STATE.myName || msg.own;
  const div = document.createElement('div');
  div.className = `message ${isOwn ? 'own' : 'other'}`;
  div.dataset.msgId = msg.id || msg.messageId;

  div.innerHTML = `
    <div class="message-content">${escapeHtml(msg.content || msg.text || '')}</div>
    <div class="message-meta">
      <span>${escapeHtml(msg.sender || 'Desconocido')}</span>
      <span>${formatTime(msg.timestamp || msg.time || Date.now())}</span>
    </div>
  `;

  container.appendChild(div);
  scrollToBottom();
}

function scrollToBottom() {
  const container = document.getElementById('messages-container');
  if (!container) return;
  const nearBottom = (container.scrollHeight - container.scrollTop - container.clientHeight) < 120;
  if (nearBottom) {
    container.scrollTop = container.scrollHeight;
  }
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ============================================================
// CONVERSACIONES
// ============================================================
function getConversationKey(contactName) {
  return contactName?.toLowerCase()?.trim() || 'default';
}

function ensureConversation(contactName) {
  const key = getConversationKey(contactName);
  if (!STATE.conversations.has(key)) {
    STATE.conversations.set(key, []);
  }
  return STATE.conversations.get(key);
}

function addMessageToConversation(contactName, msg) {
  const conv = ensureConversation(contactName);
  const msgId = msg.id || msg.messageId || hashPayload(msg.sender, msg.content, msg.timestamp);

  // DEDUP: Verificar si ya existe
  if (STATE.seenMessageIds.has(msgId)) {
    console.log('[NEXO] DEDUP: mensaje duplicado ignorado', msgId);
    return false;
  }
  STATE.seenMessageIds.add(msgId);
  setTimeout(() => STATE.seenMessageIds.delete(msgId), CONFIG.DEDUP_TTL_MS);

  conv.push({ ...msg, id: msgId, conversationId: contactName });
  return true;
}

function renderConversation(contactName) {
  const key = getConversationKey(contactName);
  const msgs = STATE.conversations.get(key) || [];
  const container = document.getElementById('messages-container');
  if (!container) return;

  container.innerHTML = '';
  msgs.forEach(msg => renderMessageToDOM(msg));

  // Actualizar header
  const headerName = document.getElementById('chat-contact-name');
  if (headerName) headerName.textContent = contactName || 'NEXO Chat';
}

// ============================================================
// CONTACTOS
// ============================================================
function addContact(name, deviceId, mac) {
  const key = name?.toLowerCase()?.trim();
  if (!key || STATE.contacts.has(key)) return false;

  STATE.contacts.set(key, {
    name: name,
    deviceId: deviceId,
    mac: mac,
    lastSeen: Date.now(),
  });
  return true;
}

function getContactList() {
  return Array.from(STATE.contacts.values());
}

function setActiveContact(name) {
  STATE.activeContact = name;
  renderConversation(name);

  const headerName = document.getElementById('chat-contact-name');
  const headerSub = document.getElementById('chat-contact-subtitle');
  if (headerName) headerName.textContent = name || 'NEXO Chat';
  if (headerSub) headerSub.textContent = name ? 'En línea via BLE' : 'Selecciona un contacto';
}

// ============================================================
// ENVIO DE MENSAJES
// ============================================================
async function sendMessage(content) {
  if (!content?.trim()) return;
  if (!STATE.activeContact) {
    showToast('Selecciona un contacto primero', 'warning');
    return;
  }

  const msg = {
    id: generateId(),
    content: content.trim(),
    sender: 'Tú',
    timestamp: Date.now(),
    own: true,
    conversationId: STATE.activeContact,
  };

  // Guardar en conversacion propia
  addMessageToConversation(STATE.activeContact, msg);

  // Renderizar solo si es la conversacion activa
  if (STATE.activeContact === msg.conversationId) {
    renderMessageToDOM(msg);
  }

  // Enviar via BLE si disponible
  try {
    if (STATE.bleInterface && typeof STATE.bleInterface.sendMessage === 'function') {
      await STATE.bleInterface.sendMessage({
        content: msg.content,
        to: STATE.activeContact,
      });
    } else if (Capacitor?.Plugins?.NexoBLE) {
      await Capacitor.Plugins.NexoBLE.sendMessage({
        content: msg.content,
        recipient: STATE.activeContact,
      });
    }
  } catch (err) {
    console.error('[NEXO] Error enviando:', err);
    showToast('Error al enviar', 'error');
  }

  // Limpiar input
  const input = document.getElementById('message-input');
  if (input) input.value = '';
}

// ============================================================
// RECEPCION DE MENSAJES (Callback BLE)
// ============================================================
function onMessageReceived(payload) {
  const content = payload?.content || payload?.text || payload?.message || '';
  const sender = payload?.sender || payload?.from || payload?.deviceName || 'Desconocido';
  const timestamp = payload?.timestamp || payload?.time || Date.now();

  const msg = {
    id: payload?.id || payload?.messageId || hashPayload(sender, content, timestamp),
    content: content,
    sender: sender,
    timestamp: timestamp,
    own: false,
    conversationId: sender,
  };

  // Siempre guardar en conversacion del remitente
  const isNew = addMessageToConversation(sender, msg);

  // Renderizar solo si es la conversacion activa
  if (isNew && STATE.activeContact === sender) {
    renderMessageToDOM(msg);
  } else if (isNew && STATE.activeContact !== sender) {
    // Notificacion sutil de nuevo mensaje
    showToast(`Nuevo mensaje de ${sender}`, 'info');
  }
}

// ============================================================
// BLE INTERFACE WRAPPER
// ============================================================
function initBLEInterface() {
  if (window.BLEInterface) {
    STATE.bleInterface = window.BLEInterface;

    // Sobreescribir callback para usar nuestro handler
    const originalOnMessage = STATE.bleInterface.onMessage;
    STATE.bleInterface.onMessage = (payload) => {
      onMessageReceived(payload);
      if (typeof originalOnMessage === 'function') originalOnMessage(payload);
    };
  }
}

// ============================================================
// UI EVENTS
// ============================================================
function setupUIEvents() {
  const sendBtn = document.getElementById('send-btn');
  const input = document.getElementById('message-input');

  if (sendBtn) {
    sendBtn.addEventListener('click', () => {
      if (input) sendMessage(input.value);
    });
  }

  if (input) {
    input.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') sendMessage(input.value);
    });
  }

  // Vault toggle
  const vaultBtn = document.getElementById('vault-btn');
  const vaultPanel = document.getElementById('vault-panel');
  if (vaultBtn && vaultPanel) {
    vaultBtn.addEventListener('click', () => {
      vaultPanel.classList.toggle('vault-visible');
    });
  }
}

// ============================================================
// TOASTS
// ============================================================
function showToast(message, type = 'info') {
  const colors = {
    info: '#1E6FD9',
    success: '#10B981',
    warning: '#F59E0B',
    error: '#EF4444',
  };

  const toast = document.createElement('div');
  toast.style.cssText = `
    position: fixed;
    bottom: 80px;
    left: 50%;
    transform: translateX(-50%);
    background: ${colors[type] || colors.info};
    color: #000;
    padding: 10px 20px;
    border-radius: 20px;
    font-size: 13px;
    font-weight: 600;
    z-index: 99999;
    animation: slideIn 0.3s ease;
  `;
  toast.textContent = message;
  document.body.appendChild(toast);

  setTimeout(() => {
    toast.style.animation = 'slideOut 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// ============================================================
// INICIALIZACION PRINCIPAL
// ============================================================
async function initializeNexoApp() {
  if (STATE.initialized) return;
  console.log(`[NEXO] Iniciando ${CONFIG.APP_NAME} v${CONFIG.VERSION}`);

  // Diagnostico
  if (typeof NEXO_DIAG !== 'undefined') {
    NEXO_DIAG.log('NEXO v10.0 iniciando...');
  }

  // Inicializar BLE
  await initBLEWithShim();

  // Setup UI
  setupUIEvents();
  initBLEInterface();

  // Ocultar splash
  setTimeout(() => {
    _forceHideSplash();
  }, CONFIG.SPLASH_TIMEOUT);

  STATE.initialized = true;
  console.log('[NEXO] Inicializado correctamente');
}

// ============================================================
// BOOT
// ============================================================
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeNexoApp);
} else {
  initializeNexoApp();
}

// Safety timeout
setTimeout(() => {
  if (!STATE.splashHidden) _forceHideSplash();
}, 10000);

// Exports para compatibilidad
window.NEXO_MAIN = {
  sendMessage,
  setActiveContact,
  addContact,
  getContactList,
  onMessageReceived,
  STATE,
  CONFIG,
};
