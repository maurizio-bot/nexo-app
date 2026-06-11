/**
 * src/main.js - NEXO v9.1.1-961-FIX
 * Orquestador principal para build #961
 * FIX v9.1.1: Botón BLE restaurado en header
 */

import './styles/critical.css';
import { NEXO_DIAG } from './core/nap.js';
import { NexoApp, DEBUG } from './app/nexo_app.js';
import { rem } from './ui/rem.js';

window.NEXO = {
  app: null, rem: null, diag: null,
  version: '9.1.1-961-FIX',
  initialized: false, sessionStart: Date.now(),
  healthStatus: 'healthy',
  currentView: 'conversations',
  activeConversationId: null,
  conversations: new Map()
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

function _checkAppFreshness() {
  try {
    const lastSession = localStorage.getItem(SESSION_STORAGE_KEY);
    const now = Date.now();
    if (lastSession) {
      const delta = now - parseInt(lastSession, 10);
      if (delta > FRESHNESS_THRESHOLD_MS) {
        rem.warn(`[HEALTH] Reapertura tras ${Math.round(delta/60000)}min. Limpiando estado.`, 'FRESHNESS');
        localStorage.removeItem('nexo_ble_prefs');
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

  if (conv.unread > 0) {
    conv.unread = 0;
    _saveConversations();
    _renderConversationsList();
  }

  const nameInput = document.getElementById('chat-contact-name');
  const subtitle = document.getElementById('chat-contact-subtitle');
  if (nameInput) nameInput.value = conv.name;
  if (subtitle) subtitle.textContent = type === 'group' ? `${conv.participants.length} participantes` : 'BLUETOOTH';

  if (window.NEXO.app && window.NEXO.app.stream) {
    window.NEXO.app.stream.clear();
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

// ==================== BOTON BLE ====================
function _ensureBLEButton() {
  let btn = document.getElementById('btn-ble-panel');
  if (btn) return;

  const header = document.querySelector('.conversations-header') || document.querySelector('.app-header') || document.getElementById('conversations-header');
  if (!header) return;

  btn = document.createElement('button');
  btn.id = 'btn-ble-panel';
  btn.className = 'header-btn ble-btn';
  btn.innerHTML = '🔷';
  btn.title = 'BLE Mesh';
  btn.style.cssText = 'background:none;border:none;color:#00d4ff;font-size:24px;cursor:pointer;padding:8px;margin-left:auto;';
  btn.addEventListener('click', () => {
    if (window.NEXO.app && window.NEXO.app.bleInterface) {
      window.NEXO.app.bleInterface.togglePanel();
    } else if (window.bleInterface) {
      window.bleInterface.togglePanel();
    }
  });
  header.appendChild(btn);
}

// ==================== INICIALIZACION ====================
document.addEventListener('DOMContentLoaded', async () => {
  try {
    _checkAppFreshness();
    NEXO_DIAG.init();
    window.NEXO.diag = NEXO_DIAG;
    _ensureDOMStructure();
    _ensureBLEButton();

    window.NEXO.rem = rem;
    rem.init();
    rem.info('REM v2.1 initialized', 'REM_INIT');

    _loadConversations();
    _setupNavigation();

    rem.info('[BLE] Verificando permisos via plugin nativo...', 'BLE_PERM_CHECK');

    let permissionsGranted = false;
    try {
      const plugin = window.Capacitor?.Plugins?.NexoBLE;
      if (plugin && plugin.checkBLEStatus) {
        const status = await plugin.checkBLEStatus();
        if (status && status.allGranted) {
          permissionsGranted = true;
          rem.success('[BLE] Permisos ya concedidos', 'BLE_PERM_OK');
        } else {
          rem.info('[BLE] Solicitando permisos...', 'BLE_PERM_REQ');
          await plugin.initializeBLE();
          permissionsGranted = await new Promise((resolve) => {
            const handler = (e) => {
              window.removeEventListener('nexo-permissions-granted', handler);
              resolve(true);
            };
            window.addEventListener('nexo-permissions-granted', handler);
            setTimeout(() => {
              window.removeEventListener('nexo-permissions-granted', handler);
              resolve(false);
            }, 10000);
          });
        }
      } else {
        rem.warn('[BLE] Plugin nativo no disponible, continuando sin BLE', 'BLE_NO_PLUGIN');
        permissionsGranted = true;
      }
    } catch (permErr) {
      rem.warn(`[BLE] Error permisos: ${permErr.message}`, 'BLE_PERM_ERR');
      permissionsGranted = false;
    }

    if (permissionsGranted) {
      await initializeNexoApp();
    } else {
      rem.warn('[BLE] Permisos pendientes - mostrando overlay', 'BLE_PERM_PENDING');
      NEXO_DIAG.hideSplash();
      _forceHideSplash();
      _showPermissionOverlay();
    }

    window.addEventListener('nexo-permissions-granted', async (e) => {
      if (!window.NEXO.initialized) {
        rem.success('[BLE] Permisos concedidos via evento', 'BLE_PERM_EVENT');
        _hidePermissionOverlay();
        await initializeNexoApp();
      }
    });

    window.addEventListener('nexo:ble:openChat', (e) => {
      const detail = e.detail || {};
      const contactId = detail.contactId || detail.address || '';
      const name = detail.name || 'NEXO Peer';
      const type = detail.type || 'individual';
      if (contactId) {
        _openChat(contactId, name, type);
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

function _setupNavigation() {
  const btnBack = document.getElementById('btn-back');
  if (btnBack) {
    btnBack.addEventListener('click', () => {
      window.NEXO.activeConversationId = null;
      _showView('conversations');
    });
  }

  const btnNewGroup = document.getElementById('btn-new-group');
  if (btnNewGroup) {
    btnNewGroup.addEventListener('click', () => {
      _showView('create-group');
      _renderGroupContacts();
    });
  }

  const btnGroupBack = document.getElementById('btn-group-back');
  if (btnGroupBack) {
    btnGroupBack.addEventListener('click', () => _showView('conversations'));
  }

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
      };
      input.click();
    });
  }

  const btnSticker = document.getElementById('btn-sticker');
  if (btnSticker) btnSticker.addEventListener('click', () => rem.info('Stickers - proximamente', 'STICKER_PLACEHOLDER'));

  const btnBlePanel = document.getElementById('btn-ble-panel');
  if (btnBlePanel) {
    btnBlePanel.addEventListener('click', () => {
      if (window.NEXO.app && window.NEXO.app.bleInterface) {
        window.NEXO.app.bleInterface.togglePanel();
      } else if (window.bleInterface) {
        window.bleInterface.togglePanel();
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

async function initializeNexoApp() {
  try {
    const nexoConfig = {
      relayUrls: ['wss://relay.nexo.local:8080', 'wss://backup.nexo.local:8081'],
      bleTimeout: 10000, enableGestures: true, enableMesh: true,

      onMessage: (msg) => {
        const contentPreview = (msg.content && msg.content.substring) ? msg.content.substring(0, 30) : '';
        console.log('Mensaje:', msg.senderName || msg.sender, contentPreview);

        let convId = msg.conversationId;
        if (!convId && msg.sender) convId = _normId(msg.sender);
        if (!convId && msg.deviceId) convId = _normId(msg.deviceId);

        if (!convId) {
          console.warn('[main] Mensaje sin conversationId, ignorando');
          return;
        }

        const conv = _getOrCreateConversation(convId, msg.senderName || msg.sender || 'NEXO Peer', 'individual');

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
        if (conv.messages.length > 500) conv.messages = conv.messages.slice(-500);

        _updateConversationLastMessage(convId, messageObj.content, messageObj.timestamp, messageObj.isMe);

        if (window.NEXO.currentView === 'chat' && window.NEXO.activeConversationId === convId) {
          if (window.NEXO.app && window.NEXO.app.stream) {
            window.NEXO.app.stream.appendItems([messageObj], { scroll: true });
          }
        } else if (!messageObj.isMe) {
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

    rem.info('NEXO App v5.0.3-ARCH', 'NEXO_INIT');

    window.NEXO.app = new NexoApp(nexoConfig);
    await window.NEXO.app.init();
    window.NEXO.initialized = true;

    if (window.NEXO.app.stream) {
      window.NEXO.app.stream.setConversationId(window.NEXO.activeConversationId);
    }

    const sendBtn = document.getElementById('send-btn');
    const msgInput = document.getElementById('message-input');
    if (sendBtn && msgInput) {
      sendBtn.addEventListener('click', async () => {
        const content = msgInput.value.trim();
        if (!content) return;
        msgInput.value = '';
        const convId = window.NEXO.activeConversationId;
        if (!convId) {
          rem.warn('Selecciona una conversacion primero', 'NO_CONV');
          return;
        }
        await window.NEXO.app.sendMessage({
          content: content,
          recipient: convId,
          conversationId: convId
        });
      });
      msgInput.addEventListener('keydown', async (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          sendBtn.click();
        }
      });
    }

    rem.success('NEXO v9.1.1-961-FIX Ready', 'INIT_OK');
    NEXO_DIAG.hideSplash();
    _forceHideSplash();
    _showView('conversations');

  } catch (error) {
    console.error('Error fatal en inicializacion:', error);
    clearTimeout(SAFETY_TIMEOUT);
    NEXO_DIAG.hideSplash();
    _forceHideSplash();
    rem.error('Error fatal: ' + error.message, 'FATAL_INIT');
  }
}

function _forceHideSplash() {
  const splash = document.getElementById('splash-native');
  if (splash) {
    splash.style.opacity = '0';
    splash.style.transform = 'scale(1.1)';
    setTimeout(() => {
      splash.style.display = 'none';
    }, 500);
  }
}

function _toggleVaultUI(isOpen) {
  const vault = document.getElementById('vault-panel');
  if (vault) {
    if (isOpen) vault.classList.add('vault-visible');
    else vault.classList.remove('vault-visible');
  }
}

function _updateBLEBadge() {
  const indicator = document.getElementById('status-indicator');
  if (indicator && window.NEXO && window.NEXO.app) {
    const status = window.NEXO.app.getStatus();
    if (status.mode === 'p2p_ble' || status.mode === 'P2P_BLE') {
      indicator.className = 'online';
      indicator.textContent = 'BLE';
    } else if (status.mode === 'offline' || status.mode === 'OFFLINE') {
      indicator.className = 'offline';
      indicator.textContent = 'OFF';
    } else {
      indicator.className = 'online';
      indicator.textContent = status.mode;
    }
  }
}

function _focusInput(text) {
  const input = document.getElementById('message-input');
  if (input) {
    input.value = text || '';
    input.focus();
  }
}

function _showPermissionOverlay() {
  console.log('[main] Permisos pendientes');
}

function _hidePermissionOverlay() {
  const overlay = document.getElementById('nexo-perm-overlay');
  if (overlay) overlay.style.display = 'none';
}

function _startHealthMonitor() {
  setInterval(() => {
    try {
      if (window.NEXO && window.NEXO.app && window.NEXO.app.getStatus) {
        const status = window.NEXO.app.getStatus();
        if (status.initialized) {
          window.NEXO.healthStatus = 'healthy';
        }
      }
    } catch (e) {
      console.warn('[HEALTH] Check failed:', e.message);
    }
  }, HEALTH_CHECK_INTERVAL_MS);
}

function _ensureDOMStructure() {
  const requiredIds = ['view-conversations', 'view-chat', 'view-create-group', 'nexo-stream', 'messages-container'];
  const missing = requiredIds.filter(id => !document.getElementById(id));
  if (missing.length > 0) {
    console.warn('[main] DOM elements missing:', missing.join(', '));
  }
}

export { NEXO_DIAG, DEBUG };
