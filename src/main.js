/**
 * src/main.js - NEXO v10.0-IDENTITY
 * Orquestador principal: 3 vistas (conversaciones, chat, crear-grupo)
 * DEDUP DEFINITIVO: unico punto de renderizado via TheStream
 * NAP 2.0 Certified
 */

import './styles/critical.css';
import { NEXO_DIAG } from './core/nap.js';
import { NexoApp, DEBUG } from './app/nexo_app.js';
import { rem } from './ui/rem.js';
import { ensureBLEPermissions, getPermissionShim, getShimStatus } from './core/NexoPermissionShim.js';

window.NEXO = {
  app: null, rem: null, diag: null,
  version: '10.0-IDENTITY',
  initialized: false, sessionStart: Date.now(),
  healthStatus: 'healthy',
  // v4.0: Estado de navegacion
  currentView: 'conversations',
  activeConversationId: null,
  conversations: new Map() // conversationId -> {name, type, messages[], lastMessage, unread, participants[]}
};

window.NEXO_REM = rem;
window.NEXO_DIAG = NEXO_DIAG;

const SESSION_STORAGE_KEY = 'nexo_last_session';
const FRESHNESS_THRESHOLD_MS = 1800000;
const HEALTH_CHECK_INTERVAL_MS = 120000;
const CONVERSATIONS_KEY = 'nexo_conversations_v4';

const SAFETY_TIMEOUT = setTimeout(() => {
  if (NEXO_DIAG.isSplashVisible && NEXO_DIAG.isSplashVisible()) {
    rem.warn('Timeout seguridad (20s) - forzando continuar', 'INIT_TIMEOUT');
    NEXO_DIAG.hideSplash();
    document.body.classList.add('nexo-force-ready');
  }
}, 20000);

// ==================== FRESHNESS ====================
function _checkAppFreshness() {
  try {
    const lastSession = localStorage.getItem(SESSION_STORAGE_KEY);
    const now = Date.now();
    if (lastSession) {
      const delta = now - parseInt(lastSession, 10);
      if (delta > FRESHNESS_THRESHOLD_MS) {
        rem.warn(`[HEALTH] Reapertura tras ${Math.round(delta/60000)}min. Limpiando estado.`, 'FRESHNESS');
        localStorage.removeItem('nexo_shim_v2_state');
        localStorage.removeItem('nexo_ble_prefs');
        const shim = getPermissionShim();
        if (shim) { shim.state.checked = false; shim.state.granted = false; shim._cache.clear(); }
        return { isFresh: false };
      }
    }
    localStorage.setItem(SESSION_STORAGE_KEY, now.toString());
    return { isFresh: true };
  } catch (e) { return { isFresh: true }; }
}

setInterval(() => {
  try { localStorage.setItem(SESSION_STORAGE_KEY, Date.now().toString()); } catch (e) {}
}, 30000);

// ==================== PERSISTENCIA DE CONVERSACIONES ====================
function _loadConversations() {
  try {
    const raw = localStorage.getItem(CONVERSATIONS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      window.NEXO.conversations = new Map(Object.entries(parsed));
      _renderConversationsList();
    }
  } catch (e) { console.warn('[main] Error cargando conversaciones:', e); }
}

function _saveConversations() {
  try {
    const obj = Object.fromEntries(window.NEXO.conversations);
    localStorage.setItem(CONVERSATIONS_KEY, JSON.stringify(obj));
  } catch (e) { console.warn('[main] Error guardando conversaciones:', e); }
}

function _getOrCreateConversation(id, name, type, participants) {
  const convId = _normId(id);
  if (!window.NEXO.conversations.has(convId)) {
    window.NEXO.conversations.set(convId, {
      id: convId, name: name || 'NEXO Peer', type: type || 'individual',
      messages: [], lastMessage: null, unread: 0,
      participants: participants || [convId], createdAt: Date.now()
    });
    _saveConversations();
    _renderConversationsList();
  }
  return window.NEXO.conversations.get(convId);
}

function _updateConversationLastMessage(convId, content, timestamp, isMe) {
  const conv = window.NEXO.conversations.get(convId);
  if (!conv) return;
  conv.lastMessage = { content: content.substring(0, 50), timestamp, isMe };
  if (!isMe && window.NEXO.currentView !== 'chat' && window.NEXO.activeConversationId !== convId) {
    conv.unread = (conv.unread || 0) + 1;
  }
  _saveConversations();
  _renderConversationsList();
}

function _normId(id) {
  if (!id) return '';
  return id.toString().toLowerCase().replace(/[:-]/g, '').trim();
}

// ==================== RENDER LISTA DE CONVERSACIONES ====================
function _renderConversationsList() {
  const list = document.getElementById('conversations-list');
  if (!list) return;

  const conversations = Array.from(window.NEXO.conversations.values())
    .sort((a, b) => (b.lastMessage?.timestamp || b.createdAt) - (a.lastMessage?.timestamp || a.createdAt));

  if (conversations.length === 0) {
    list.innerHTML = '<div class="conversation-empty">No hay conversaciones. Conecta un dispositivo BLE para empezar.</div>';
    return;
  }

  list.innerHTML = '';
  conversations.forEach(conv => {
    const item = document.createElement('div');
    item.className = 'conversation-item' + (conv.unread > 0 ? ' unread' : '');
    item.dataset.convId = conv.id;

    const typeIcon = conv.type === 'group' ? '👥' : '👤';
    const lastMsg = conv.lastMessage ? conv.lastMessage.content : 'Sin mensajes';
    const time = conv.lastMessage ? _formatTime(conv.lastMessage.timestamp) : '';
    const unreadBadge = conv.unread > 0 ? `<span class="unread-badge">${conv.unread}</span>` : '';

    item.innerHTML = `
      <div class="conv-avatar">${typeIcon}</div>
      <div class="conv-info">
        <div class="conv-name">${conv.name}</div>
        <div class="conv-preview">${lastMsg}</div>
      </div>
      <div class="conv-meta">
        <span class="conv-time">${time}</span>
        ${unreadBadge}
      </div>
    `;

    item.addEventListener('click', () => _openChat(conv.id, conv.name, conv.type));
    list.appendChild(item);
  });
}

function _formatTime(timestamp) {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  const now = new Date();
  const diff = now - date;
  if (diff < 60000) return 'ahora';
  if (diff < 3600000) return `${Math.floor(diff/60000)}m`;
  if (diff < 86400000) return `${Math.floor(diff/3600000)}h`;
  return date.toLocaleDateString();
}

// ==================== NAVEGACION DE VISTAS ====================
function _showView(viewName) {
  window.NEXO.currentView = viewName;
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  const view = document.getElementById('view-' + viewName);
  if (view) view.classList.add('active');

  if (viewName === 'conversations') {
    _renderConversationsList();
    window.NEXO.activeConversationId = null;
  }
}

function _openChat(convId, name, type) {
  const normalizedId = _normId(convId);
  const conv = _getOrCreateConversation(normalizedId, name, type);
  window.NEXO.activeConversationId = normalizedId;

  // Reset unread
  if (conv.unread > 0) {
    conv.unread = 0;
    _saveConversations();
    _renderConversationsList();
  }

  // Actualizar header
  const nameInput = document.getElementById('chat-contact-name');
  const subtitle = document.getElementById('chat-contact-subtitle');
  if (nameInput) nameInput.value = conv.name;
  if (subtitle) subtitle.textContent = type === 'group' ? `${conv.participants.length} participantes` : 'BLUETOOTH';

  // Limpiar y cargar mensajes de esta conversacion
  if (window.NEXO.app && window.NEXO.app.stream) {
    window.NEXO.app.stream.clear();
    // Cargar mensajes previos de la conversacion
    conv.messages.forEach(msg => {
      window.NEXO.app.stream.appendItems([msg], { scroll: false });
    });
  }

  _showView('chat');
}

function _createGroup(name, participantIds) {
  const groupId = 'group_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
  const participants = participantIds.map(_normId);
  const conv = _getOrCreateConversation(groupId, name, 'group', participants);
  _saveConversations();
  _renderConversationsList();
  _openChat(groupId, name, 'group');
}

// ==================== INICIALIZACION ====================
document.addEventListener('DOMContentLoaded', async () => {
  try {
    _checkAppFreshness();
    NEXO_DIAG.init();
    window.NEXO.diag = NEXO_DIAG;
    _ensureDOMStructure();

    window.NEXO.rem = rem;
    rem.init();
    rem.info('REM v2.1 NAP 2.0 initialized', 'REM_INIT');

    // Cargar conversaciones persistidas
    _loadConversations();

    // Setup navegacion
    _setupNavigation();

    rem.info('[Shim] Verificando permisos BLE...', 'SHIM_CHECK');

    let permissionsGranted = false;
    try {
      const permPromise = ensureBLEPermissions();
      const permTimeout = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('PERM_TIMEOUT')), 12000)
      );
      permissionsGranted = await Promise.race([permPromise, permTimeout]);
    } catch (permErr) {
      rem.warn(`[Shim] Permisos timeout: ${permErr.message}`, 'SHIM_WARN');
      permissionsGranted = false;
    }

    if (permissionsGranted) {
      rem.success('[Shim] Permisos BLE concedidos', 'SHIM_OK');
      await initializeNexoApp();
    } else {
      rem.warn('[Shim] Permisos BLE pendientes', 'SHIM_REQUIRED');
      NEXO_DIAG.hideSplash();
      _showPermissionOverlay();
      _startPermissionPolling();
    }

    window.addEventListener('nexo-permissions-granted', async (e) => {
      if (!window.NEXO.initialized) {
        const shimSource = (e.detail && e.detail.source) || 'event';
        rem.success(`[Shim] Permisos via ${shimSource}`, 'SHIM_EVENT_OK');
        _stopPermissionPolling();
        _hidePermissionOverlay();
        await initializeNexoApp();
      }
    });

    _startHealthMonitor();

  } catch (error) {
    console.error('Error fatal:', error);
    clearTimeout(SAFETY_TIMEOUT);
    NEXO_DIAG.hideSplash();
    _forceHideSplash();
  }
});

// ==================== NAVEGACION EVENT LISTENERS ====================
function _setupNavigation() {
  // Boton volver al chat
  const btnBack = document.getElementById('btn-back');
  if (btnBack) {
    btnBack.addEventListener('click', () => {
      window.NEXO.activeConversationId = null;
      _showView('conversations');
    });
  }

  // Boton nuevo grupo
  const btnNewGroup = document.getElementById('btn-new-group');
  if (btnNewGroup) {
    btnNewGroup.addEventListener('click', () => {
      _showView('create-group');
      _renderGroupContacts();
    });
  }

  // Boton volver de crear grupo
  const btnGroupBack = document.getElementById('btn-group-back');
  if (btnGroupBack) {
    btnGroupBack.addEventListener('click', () => _showView('conversations'));
  }

  // Boton crear grupo confirmar
  const btnCreateConfirm = document.getElementById('btn-create-group-confirm');
  if (btnCreateConfirm) {
    btnCreateConfirm.addEventListener('click', () => {
      const nameInput = document.getElementById('group-name-input');
      const name = nameInput ? nameInput.value.trim() : '';
      if (!name) {
        rem.warn('Nombre de grupo requerido', 'GROUP_NAME_EMPTY');
        return;
      }
      const selected = [];
      document.querySelectorAll('.group-contact-checkbox:checked').forEach(cb => {
        selected.push(cb.dataset.contactId);
      });
      if (selected.length === 0) {
        rem.warn('Selecciona al menos un contacto', 'GROUP_NO_CONTACTS');
        return;
      }
      _createGroup(name, selected);
      if (nameInput) nameInput.value = '';
      _showView('conversations');
    });
  }

  // Botones de chat (llamada, video, adjuntar, sticker)
  const btnCall = document.getElementById('btn-call');
  if (btnCall) btnCall.addEventListener('click', () => rem.info('Llamada - proximamente', 'CALL_PLACEHOLDER'));

  const btnVideo = document.getElementById('btn-video');
  if (btnVideo) btnVideo.addEventListener('click', () => rem.info('Videollamada - proximamente', 'VIDEO_PLACEHOLDER'));

  const btnAttach = document.getElementById('btn-attach');
  if (btnAttach) {
    btnAttach.addEventListener('click', () => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '*/*';
      input.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        rem.info(`Archivo seleccionado: ${file.name}`, 'FILE_SELECTED');
        // TODO: Implementar envio de archivo
      };
      input.click();
    });
  }

  const btnSticker = document.getElementById('btn-sticker');
  if (btnSticker) btnSticker.addEventListener('click', () => rem.info('Stickers - proximamente', 'STICKER_PLACEHOLDER'));

  // Boton BLE panel
  const btnBlePanel = document.getElementById('btn-ble-panel');
  if (btnBlePanel) {
    btnBlePanel.addEventListener('click', () => {
      if (window.NEXO.app && window.NEXO.app.bleInterface) {
        window.NEXO.app.bleInterface.togglePanel();
      }
    });
  }
}

function _renderGroupContacts() {
  const container = document.getElementById('group-available-contacts');
  if (!container) return;

  const contacts = [];
  try {
    const stored = JSON.parse(localStorage.getItem('nexo_ble_contacts_v1') || '[]');
    stored.forEach(c => contacts.push({ id: _normId(c.id || c.address), name: c.name || 'NEXO Device' }));
  } catch (e) {}

  // Tambien agregar dispositivos conectados
  if (window.NEXO.app && window.NEXO.app.bleInterface) {
    const ble = window.NEXO.app.bleInterface;
    if (ble.connectedDevices) {
      ble.connectedDevices.forEach((device, id) => {
        if (!contacts.find(c => c.id === _normId(id))) {
          contacts.push({ id: _normId(id), name: device.name || 'NEXO Peer' });
        }
      });
    }
  }

  if (contacts.length === 0) {
    container.innerHTML = '<div class="group-empty">No hay contactos disponibles. Conecta dispositivos BLE primero.</div>';
    return;
  }

  container.innerHTML = '';
  contacts.forEach(contact => {
    const label = document.createElement('label');
    label.className = 'group-contact-item';
    label.innerHTML = `
      <input type="checkbox" class="group-contact-checkbox" data-contact-id="${contact.id}">
      <span class="group-contact-name">${contact.name}</span>
    `;
    container.appendChild(label);
  });
}

// ==================== NexoApp Initialization ====================
async function initializeNexoApp() {
  try {
    const nexoConfig = {
      relayUrls: ['wss://relay.nexo.local:8080', 'wss://backup.nexo.local:8081'],
      bleTimeout: 10000, enableGestures: true, enableMesh: true,

      // v4.0: UNICO punto de entrada para mensajes - TheStream renderiza TODO
      onMessage: (msg) => {
        const contentPreview = (msg.content && msg.content.substring) ? msg.content.substring(0, 30) : '';
        console.log('Mensaje:', msg.senderName || msg.sender, contentPreview);

        // Determinar conversationId
        let convId = msg.conversationId;
        if (!convId && msg.sender) convId = _normId(msg.sender);
        if (!convId && msg.deviceId) convId = _normId(msg.deviceId);

        if (!convId) {
          console.warn('[main] Mensaje sin conversationId, ignorando');
          return;
        }

        // Crear/obtener conversacion
        const conv = _getOrCreateConversation(convId, msg.senderName || msg.sender || 'NEXO Peer', 'individual');

        // Guardar mensaje en conversacion
        const messageObj = {
          id: msg.messageId || `msg_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
          content: msg.content || msg.text || '',
          sender: msg.sender || msg.deviceId || 'unknown',
          senderName: msg.senderName || msg.sender || 'NEXO Peer',
          conversationId: convId,
          timestamp: msg.timestamp || Date.now(),
          isMe: msg._own || msg.isMe || false,
          fingerprint: msg.fingerprint || null,
          type: 'message'
        };

        conv.messages.push(messageObj);
        if (conv.messages.length > 500) conv.messages = conv.messages.slice(-500); // limitar

        // Actualizar preview
        _updateConversationLastMessage(convId, messageObj.content, messageObj.timestamp, messageObj.isMe);

        // Renderizar SOLO si estamos en esta conversacion
        if (window.NEXO.currentView === 'chat' && window.NEXO.activeConversationId === convId) {
          if (window.NEXO.app && window.NEXO.app.stream) {
            window.NEXO.app.stream.appendItems([messageObj], { scroll: true });
          }
        } else if (!messageObj.isMe) {
          // Incrementar unread si no estamos en esta conversacion
          conv.unread = (conv.unread || 0) + 1;
          _saveConversations();
          _renderConversationsList();
        }

        _saveConversations();
      },

      onStatusChange: (mode) => {
        console.log('Modo:', mode);
        rem.updateMode(mode);
        _updateBLEBadge();
      },
      onError: (err) => {
        console.error('App error:', err);
        rem.error(err.message, 'APP_ERR');
      },
      onVaultStateChange: (isOpen) => _toggleVaultUI(isOpen),
      actionCallbacks: {
        onReact: (id) => rem.success('Reaccion añadida', 'REACT_OK'),
        onReply: (id) => { const rid = (id && id.substr) ? id.substr(0, 8) : ''; _focusInput('@' + rid + ' '); },
        onForward: (id) => rem.info('Listo para reenviar', 'FORWARD_READY')
      }
    };

    rem.info('NEXO App v5.1.1-HEALTH-FIX', 'NEXO_INIT');
    window.N
