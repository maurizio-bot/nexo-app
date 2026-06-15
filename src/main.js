/** main.js v10.0-SHIM-NEXO con paleta v10 **/

main_js_v10 = r'''/**
 * src/main.js - Punto de entrada NEXO v10.0-SHIM-NEXO
 * FIX: Conversaciones separadas, mensajes filtrados por contacto activo,
 *      dedup centralizado. Paleta NEXO v10: fondo #000, texto #B0B0B0.
 */

import './styles/critical.css';
import { NEXO_DIAG } from './core/nap.js';
import { NexoApp, DEBUG } from './app/nexo_app.js';
import { rem } from './ui/rem.js';
import { ensureBLEPermissions, getPermissionShim } from './core/NexoPermissionShim.js';

window.NEXO = {
  app: null,
  rem: null,
  diag: null,
  version: '10.0-SHIM-NEXO',
  initialized: false
};

window.NEXO_REM = rem;
window.NEXO_DIAG = NEXO_DIAG;

const _conversations = new Map();
let _activeConversationId = null;

const SAFETY_TIMEOUT = setTimeout(() => {
  if (NEXO_DIAG.isSplashVisible?.()) {
    rem.warn('Timeout de seguridad - forzando continuar', 'INIT_TIMEOUT');
    NEXO_DIAG.hideSplash();
    document.body.classList.add('nexo-force-ready');
  }
}, 15000);

document.addEventListener('DOMContentLoaded', async () => {
  try {
    NEXO_DIAG.init();
    window.NEXO.diag = NEXO_DIAG;
    _ensureDOMStructure();

    window.NEXO.rem = rem;
    rem.init();
    rem.info('REM v2.1 NAP 2.0 initialized', 'REM_INIT');

    let permissionsGranted = false;
    try {
      const permPromise = ensureBLEPermissions();
      const permTimeout = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('PERM_TIMEOUT')), 10000)
      );
      permissionsGranted = await Promise.race([permPromise, permTimeout]);
    } catch (permErr) {
      rem.warn(`[Shim] Permisos timeout/error: ${permErr.message}`, 'SHIM_WARN');
      permissionsGranted = false;
    }

    if (permissionsGranted) {
      rem.success('[Shim] Permisos BLE concedidos', 'SHIM_OK');
      await initializeNexoApp();
    } else {
      rem.warn('[Shim] Permisos BLE pendientes', 'SHIM_REQUIRED');
      NEXO_DIAG.hideSplash();
      _showPermissionOverlay();
    }

    window.addEventListener('nexo-permissions-granted', async (e) => {
      if (!window.NEXO.initialized) {
        rem.success(`[Shim] Permisos concedidos via ${e.detail?.source || 'event'}`, 'SHIM_EVENT_OK');
        _hidePermissionOverlay();
        await initializeNexoApp();
      }
    }, { once: true });

  } catch (error) {
    console.error('Error fatal en inicializacion:', error);
    clearTimeout(SAFETY_TIMEOUT);
    NEXO_DIAG.error('INIT_FATAL', error.message);
    rem.error(`Error fatal: ${error.message}`, 'INIT_FATAL');
    NEXO_DIAG.hideSplash();
    _forceHideSplash();
    _enableFallbackMode();
  }
});

function _showView(viewId) {
  const views = ['conversations-view', 'app'];
  views.forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      if (id === viewId) {
        el.classList.remove('hidden');
        el.classList.add('active');
      } else {
        el.classList.add('hidden');
        el.classList.remove('active');
      }
    }
  });
}

function _showConversations() {
  _activeConversationId = null;
  if (window.NEXO.app) window.NEXO.app.activeContact = null;
  _renderConversationsList();
  _showView('conversations-view');
}

function _showChat(contactId, name, address, transport) {
  _activeConversationId = contactId;
  if (window.NEXO.app) {
    window.NEXO.app.activeContact = { id: contactId, name, address, transport };
  }
  const nameInput = document.getElementById('chat-contact-name');
  const subtitle = document.getElementById('chat-contact-subtitle');
  if (nameInput) nameInput.value = name || 'NEXO';
  if (subtitle) subtitle.textContent = transport === 'ble' ? 'BLUETOOTH' : 'NEXO MESH';
  _renderMessagesForConversation(contactId);
  _showView('app');
}

function _renderConversationsList() {
  const list = document.getElementById('conversations-list');
  if (!list) return;

  if (_conversations.size === 0) {
    list.innerHTML = '<div class="conv-empty">No hay conversaciones</div>';
    return;
  }

  list.innerHTML = '';
  const sorted = Array.from(_conversations.entries()).sort((a, b) => {
    const ta = b[1].lastMessage?.timestamp || 0;
    const tb = a[1].lastMessage?.timestamp || 0;
    return tb - ta;
  });

  sorted.forEach(([convId, conv]) => {
    const item = document.createElement('div');
    item.className = 'conversation-item';
    const initial = (conv.name || 'N').charAt(0).toUpperCase();
    const preview = conv.lastMessage ? (conv.lastMessage.content || '').substring(0, 40) : 'Sin mensajes';
    const time = conv.lastMessage ? _formatTime(conv.lastMessage.timestamp) : '';
    const unread = conv.unread || 0;

    item.innerHTML = `
      <div class="conv-avatar">${initial}</div>
      <div class="conv-info">
        <div class="conv-name">${conv.name || 'NEXO Peer'}</div>
        <div class="conv-preview">${preview}</div>
      </div>
      <div class="conv-meta">
        <div class="conv-time">${time}</div>
        ${unread > 0 ? `<div class="conv-badge">${unread}</div>` : ''}
      </div>
    `;
    item.addEventListener('click', () => {
      conv.unread = 0;
      _showChat(convId, conv.name, conv.address, conv.transport || 'ble');
    });
    list.appendChild(item);
  });
}

function _formatTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function _getOrCreateConversation(convId, name, address, transport) {
  if (!_conversations.has(convId)) {
    _conversations.set(convId, {
      id: convId,
      name: name || 'NEXO Peer',
      address: address || '',
      transport: transport || 'ble',
      messages: [],
      unread: 0,
      lastMessage: null
    });
  }
  return _conversations.get(convId);
}

function _renderMessagesForConversation(convId) {
  const container = document.getElementById('messages-container');
  if (!container) return;
  container.innerHTML = '';

  const conv = _conversations.get(convId);
  if (!conv || !conv.messages.length) return;

  conv.messages.forEach(msg => _renderMessageToDOM(msg));
  container.scrollTop = container.scrollHeight;
}

function _renderMessageToDOM(msg) {
  const container = document.getElementById('messages-container');
  if (!container) return;

  const div = document.createElement('div');
  div.className = `message ${msg._own ? 'own' : 'other'}`;
  div.dataset.messageId = msg.messageId || '';

  const senderHtml = !msg._own && msg.senderName
    ? `<span class="message-sender">${msg.senderName}</span>`
    : '';

  const checkIcon = msg._own
    ? (msg.pending ? '<span class="message-check sent">&#10003;</span>'
       : '<span class="message-check delivered">&#10003;&#10003;</span>')
    : '';

  div.innerHTML = `
    ${senderHtml}
    <div class="msg-content">${msg.content || msg.text || ''}</div>
    <div class="message-meta">
      <span class="msg-time">${new Date(msg.timestamp || Date.now()).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'})}</span>
      ${checkIcon}
    </div>
  `;
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

function _renderMessage(msg) {
  let convId = msg.conversationId;
  if (!convId) {
    if (msg._own && msg.recipient) convId = msg.recipient;
    else if (!msg._own && msg.sender) convId = msg.sender;
    else convId = 'general';
  }

  const conv = _getOrCreateConversation(
    convId,
    msg.senderName || msg.sender || 'NEXO Peer',
    msg.address || '',
    msg.transport || 'ble'
  );

  const exists = conv.messages.some(m => m.messageId && msg.messageId && m.messageId === msg.messageId);
  if (exists) return;

  conv.messages.push(msg);
  conv.lastMessage = msg;

  if (!msg._own && convId !== _activeConversationId) {
    conv.unread = (conv.unread || 0) + 1;
  }

  if (convId === _activeConversationId) {
    _renderMessageToDOM(msg);
  } else if (!msg._own) {
    _renderConversationsList();
  }

  if (msg._own && convId !== _activeConversationId) {
    _renderConversationsList();
  }
}

async function initializeNexoApp() {
  try {
    const nexoConfig = {
      relayUrls: ['wss://relay.nexo.local:8080', 'wss://backup.nexo.local:8081'],
      bleTimeout: 10000,
      enableGestures: true,
      enableMesh: true,
      onMessage: (msg) => {
        console.log('Mensaje:', msg);
        _renderMessage(msg);
      },
      onStatusChange: (mode) => {
        console.log('Modo:', mode);
        rem.updateMode(mode);
      },
      onError: (err) => {
        console.error('App error:', err);
        rem.error(err.message, 'APP_ERR');
      },
      onVaultStateChange: (isOpen) => _toggleVaultUI(isOpen),
      actionCallbacks: {
        onReact: (id) => rem.success('Reaccion anadida', 'REACT_OK'),
        onReply: (id) => _focusInput(`@${id?.substr(0,8)} `),
        onForward: (id) => rem.info('Listo para reenviar', 'FORWARD_READY')
      }
    };

    rem.info('[NEXO] App instance v10.0-SHIM-NEXO', 'NEXO_INIT');
    window.NEXO.app = new NexoApp(nexoConfig);
    rem.info('[init] ===== INICIANDO NEXO v10.0-SHIM-NEXO =====', 'INIT_START');

    const initPromise = window.NEXO.app.init();
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('INIT_TIMEOUT')), 12000)
    );

    try {
      await Promise.race([initPromise, timeoutPromise]);
      rem.success('==== INICIALIZACION NAP 2.0 COMPLETADA ====', 'INIT_OK');
    } catch (timeoutErr) {
      rem.warn('Init timeout - continuando con funcionalidad limitada', 'INIT_WARN');
      rem.info('BLE puede no estar disponible, verifica permisos', 'INIT_FALLBACK');
    }

    window.NEXO.initialized = true;
    clearTimeout(SAFETY_TIMEOUT);

    _setupMessageInput();
    _setupVaultToggle();
    _setupChatHeader();
    _setupKeyboardShortcuts();

    NEXO_DIAG.hideSplash();
    _forceHideSplash();
    rem.success('NEXO v10.0-SHIM-NEXO Listo', 'INIT_OK');
    console.log('NEXO v10.0-SHIM-NEXO Inicializado');

    const status = window.NEXO.app.getStatus?.();
    if (status) console.log('[NEXO STATUS]', status);

  } catch (error) {
    console.error('Error en NexoApp:', error);
    clearTimeout(SAFETY_TIMEOUT);
    NEXO_DIAG.error('APP_INIT_ERROR', error.message);
    rem.error(`Error al iniciar app: ${error.message}`, 'APP_ERR');
    NEXO_DIAG.hideSplash();
    _forceHideSplash();
    _enableFallbackMode();
  }
}

function _setupMessageInput() {
  const input = document.getElementById('message-input');
  const btn = document.getElementById('send-btn');
  if (!input || !btn || !window.NEXO.app) return;

  const send = async () => {
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    input.focus();

    try {
      const sent = await window.NEXO.app.sendMessage({ content: text });
      if (sent) rem.success('Enviado', 'MSG_SENT');
      else rem.info('En cola (offline)', 'MSG_QUEUED');
    } catch (e) {
      rem.error('Error al enviar', 'MSG_ERR');
    }
  };

  btn.addEventListener('click', send);
  input.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      send();
    }
  });
  input.focus();
}

function _setupVaultToggle() {
  const vault = document.getElementById('vault-panel');
  if (vault) vault.classList.add('vault-hidden');
}

function _setupChatHeader() {
  const nameInput = document.getElementById('chat-contact-name');
  if (!nameInput) return;

  const saveName = () => {
    const newName = nameInput.value.trim();
    if (!newName) {
      nameInput.value = window.NEXO.app?.activeContact?.name || 'NEXO';
      return;
    }
    if (window.NEXO.app?.activeContact) {
      window.NEXO.app.activeContact.name = newName;
    }
    if (_activeConversationId && _conversations.has(_activeConversationId)) {
      _conversations.get(_activeConversationId).name = newName;
    }
    try {
      const contacts = JSON.parse(localStorage.getItem('nexo_ble_contacts_v2') || '[]');
      const activeId = window.NEXO.app?.activeContact?.id;
      if (activeId) {
        const idx = contacts.findIndex(c => _normId(c.deviceUUID) === _normId(activeId));
        if (idx >= 0) {
          contacts[idx].name = newName;
          localStorage.setItem('nexo_ble_contacts_v2', JSON.stringify(contacts));
          rem.info(`Contacto renombrado: ${newName}`, 'CONTACT_RENAME');
        }
      }
    } catch (e) {
      console.warn('[main] Error guardando nombre editado:', e);
    }
  };

  nameInput.addEventListener('blur', saveName);
  nameInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      nameInput.blur();
    }
  });
}

function _setupKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.shiftKey && e.key === 'V') {
      e.preventDefault();
      const vault = document.getElementById('vault-panel');
      if (vault) {
        const isHidden = vault.classList.contains('vault-hidden');
        _toggleVaultUI(!isHidden);
      }
    }
    if (e.ctrlKey && e.shiftKey && e.key === 'L') {
      e.preventDefault();
      rem.toggle?.();
    }
    if (e.ctrlKey && e.shiftKey && e.key === 'H') {
      e.preventDefault();
      rem.showHistory?.();
    }
  });
}

function _ensureDOMStructure() {
  const stream = document.getElementById('nexo-stream') || document.querySelector('.stream-container');
  const vault = document.getElementById('nexo-vault') || document.querySelector('.vault-panel');
  if (stream && !stream.id) stream.id = 'nexo-stream';
  if (vault && !vault.id) vault.id = 'nexo-vault';

  if (!document.getElementById('messages-container')) {
    const msgContainer = document.createElement('div');
    msgContainer.id = 'messages-container';
    msgContainer.className = 'messages-container';
    (stream || document.body).appendChild(msgContainer);
  }
}

function _toggleVaultUI(isOpen) {
  const vault = document.getElementById('vault-panel');
  const stream = document.getElementById('nexo-stream');

  if (vault) {
    vault.classList.toggle('vault-hidden', !isOpen);
    vault.classList.toggle('vault-visible', isOpen);
    rem.info(isOpen ? '[VAULT] Abierto' : '[VAULT] Cerrado', 'VAULT_TOGGLE');
  }
  if (stream) {
    stream.style.transform = isOpen ? 'translateX(-20%)' : 'translateX(0)';
  }
}

function _focusInput(text = '') {
  const input = document.getElementById('message-input');
  if (input) {
    input.focus();
    if (text) input.value = text;
  }
}

function _forceHideSplash() {
  const selectors = ['#splash-native', '#splash', '.splash-screen', '[id*="splash"]', '#nexo-setup'];
  selectors.forEach(sel => {
    const el = document.querySelector(sel);
    if (el) {
      el.style.opacity = '0';
      el.style.pointerEvents = 'none';
      setTimeout(() => el.remove(), 500);
    }
  });
}

function _enableFallbackMode() {
  console.warn('[NEXO] Activando modo fallback');
  const body = document.body;
  body.classList.add('nexo-fallback-mode');

  const msg = document.createElement('div');
  msg.className = 'fallback-notice';
  msg.innerHTML = `
    <h3>Error de Inicializacion</h3>
    <p>La app no pudo iniciar completamente.</p>
  `;
  body.appendChild(msg);
}

function _normId(id) {
  return (id || '').toString().toLowerCase().trim();
}

if (module.hot) module.hot.accept();
'''

with open('/mnt/agents/output/main.js', 'w') as f:
    f.write(main_js_v10)
print(f"main.js: {len(main_js_v10)} chars - OK")
