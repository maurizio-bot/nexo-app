/**
 * src/main.js - Punto de entrada NEXO v9.2.1-FIX
 * FIX: Bloque BLE en setTimeout para no bloquear inicio de app
 */

import './styles/critical.css';
import { NEXO_DIAG } from './core/nap.js';
import { NexoApp, DEBUG } from './app/nexo_app.js';
import { rem } from './ui/rem.js';

window.NEXO = {
  app: null,
  rem: null,
  diag: null,
  version: '9.2.1-FIX',
  initialized: false
};

window.NEXO_REM = rem;
window.NEXO_DIAG = NEXO_DIAG;

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
    
    await initializeNexoApp();
  } catch (error) {
    console.error('💥 Error fatal en inicialización:', error);
    clearTimeout(SAFETY_TIMEOUT);
    NEXO_DIAG.error('INIT_FATAL', error.message);
    rem.error(`Error fatal: ${error.message}`, 'INIT_FATAL');
    NEXO_DIAG.hideSplash();
    _forceHideSplash();
    _enableFallbackMode();
  }
});

async function initializeNexoApp() {
  try {
    const nexoConfig = {
      relayUrls: ['wss://relay.nexo.local:8080', 'wss://backup.nexo.local:8081'],
      bleTimeout: 10000,
      enableGestures: true,
      enableMesh: true,
      onMessage: (msg) => {
        console.log('📨 Mensaje:', msg);
        _renderMessage(msg);
      },
      onStatusChange: (mode) => {
        console.log('🌐 Modo:', mode);
        rem.updateMode(mode);
      },
      onError: (err) => {
        console.error('App error:', err);
        rem.error(err.message, 'APP_ERR');
      },
      onVaultStateChange: (isOpen) => _toggleVaultUI(isOpen),
      actionCallbacks: {
        onReact: (id) => rem.success('Reacción añadida', 'REACT_OK'),
        onReply: (id) => _focusInput(`@${id?.substr(0,8)} `),
        onForward: (id) => rem.info('Listo para reenviar', 'FORWARD_READY')
      }
    };
    
    rem.info('🚀 [NEXO] App instance v9.2.1-FIX', 'NEXO_INIT');
    window.NEXO.app = new NexoApp(nexoConfig);
    rem.info('[init] ===== INICIANDO NEXO v9.2.1-FIX =====', 'INIT_START');
    
    const initPromise = window.NEXO.app.init();
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('INIT_TIMEOUT')), 12000)
    );
    
    try {
      await Promise.race([initPromise, timeoutPromise]);
      rem.success('==== INICIALIZACIÓN NAP 2.0 COMPLETADA ====', 'INIT_OK');
    } catch (timeoutErr) {
      rem.warn('Init timeout - continuando con funcionalidad limitada', 'INIT_WARN');
      rem.info('BLE puede no estar disponible, verifica permisos', 'INIT_FALLBACK');
    }
    
    // FIX v9.2.1: Inicializar BLE con setTimeout para no bloquear hilo principal
    setTimeout(async () => {
      const plugin = window.Capacitor?.Plugins?.NexoBLE;
      if (plugin) {
        try {
          const status = await plugin.checkBLEStatus();
          rem.info(`[BLE] Status: allGranted=${status.allGranted}`, 'BLE_STATUS');
          if (!status.allGranted) {
            rem.info('[BLE] Solicitando permisos...', 'BLE_PERM_REQ');
            await plugin.initializeBLE();
            rem.success('[BLE] Permisos concedidos', 'BLE_PERM_OK');
          }
        } catch (bleErr) {
          rem.warn(`[BLE] Error: ${bleErr.message}`, 'BLE_WARN');
        }
      } else {
        rem.warn('[BLE] Plugin nativo no disponible', 'BLE_NO_PLUGIN');
      }
    }, 3000);
    
    window.NEXO.initialized = true;
    clearTimeout(SAFETY_TIMEOUT);
    
    _setupMessageInput();
    _setupVaultToggle();
    _setupChatHeader();
    _setupKeyboardShortcuts();
    
    NEXO_DIAG.hideSplash();
    _forceHideSplash();
    rem.success('NEXO v9.2.1-FIX Listo', 'INIT_OK');
    console.log('✅ NEXO v9.2.1-FIX Inicializado');
    
    const status = window.NEXO.app.getStatus?.();
    if (status) console.log('[NEXO STATUS]', status);
    
  } catch (error) {
    console.error('💥 Error en NexoApp:', error);
    clearTimeout(SAFETY_TIMEOUT);
    NEXO_DIAG.error('APP_INIT_ERROR', error.message);
    rem.error(`Error al iniciar app: ${error.message}`, 'APP_ERR');
    NEXO_DIAG.hideSplash();
    _forceHideSplash();
    _enableFallbackMode();
  }
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
    try {
      const contacts = JSON.parse(localStorage.getItem('nexo_ble_contacts_v1') || '[]');
      const activeId = window.NEXO.app?.activeContact?.id;
      if (activeId) {
        const idx = contacts.findIndex(c => (c.id || c.address) === activeId);
        if (idx >= 0) {
          contacts[idx].name = newName;
          localStorage.setItem('nexo_ble_contacts_v1', JSON.stringify(contacts));
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

function _renderMessage(msg) {
  const container = document.getElementById('messages-container');
  if (!container) return;
  
  const div = document.createElement('div');
  div.className = `message ${msg._own ? 'own' : 'other'}`;
  
  const sourceBadge = msg._source ? 
    `<span class="msg-source" title="${msg._source}">${_getSourceIcon(msg._source)}</span>` : '';
  
  div.innerHTML = `
    <div class="message-content">${msg.content || msg.text}</div>
    <div class="message-meta">
      <span>${new Date(msg.timestamp || Date.now()).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'})}</span>
      ${sourceBadge}
    </div>
  `;
  
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

function _getSourceIcon(source) {
  const icons = {
    'ble_nordic': '🔷',
    'ble_hybrid': '📡',
    'relay': '🌐',
    'self': '✓'
  };
  return icons[source] || '•';
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
    <div style="position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); 
                background: #ff4444; color: white; padding: 20px; border-radius: 8px; z-index: 99999;">
      <h3>⚠️ Error de Inicialización</h3>
      <p>La app no pudo iniciar completamente.</p>
      <button onclick="location.reload()" style="padding: 10px 20px; margin-top: 10px;">Reintentar</button>
    </div>
  `;
  body.appendChild(msg);
}

if (module.hot) module.hot.accept();
