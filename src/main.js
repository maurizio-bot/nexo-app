/**
 * src/main.js - Punto de entrada NEXO v9.1-SHIM
 * NAP 2.0 Certified - BLE Soberano P2P
 * v9.1-SHIM: SetupManager/SetupWizard eliminados. Permission Shim integrado.
 * Build #961 compatible. NO toca nativo.
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
  version: '9.1-SHIM',
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

    // ─── SHIM INTEGRATION v9.1 ───
    rem.info('[Shim] Verificando permisos BLE...', 'SHIM_CHECK');

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

    // Escuchar evento del Shim para auto-continuar cuando el usuario conceda desde Settings
    window.addEventListener('nexo-permissions-granted', async (e) => {
      if (!window.NEXO.initialized) {
        rem.success(`[Shim] Permisos concedidos via ${e.detail?.source || 'event'}`, 'SHIM_EVENT_OK');
        _hidePermissionOverlay();
        await initializeNexoApp();
      }
    }, { once: true });

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

// ─── Permission Overlay (reemplaza SetupWizard) ───
function _showPermissionOverlay() {
  if (document.getElementById('nexo-perm-overlay')) return;

  const overlay = document.createElement('div');
  overlay.id = 'nexo-perm-overlay';
  overlay.innerHTML = `
    <div class="perm-overlay-content">
      <h2>🔐 Permisos BLE Requeridos</h2>
      <p>NEXO necesita acceso a Bluetooth y Dispositivos Cercanos para comunicación P2P.</p>
      <p class="perm-sub">Si ya los concediste en Ajustes, la app continuará automáticamente.</p>
      <button id="perm-btn-grant" class="perm-btn-primary">Conceder Permisos</button>
      <button id="perm-btn-settings" class="perm-btn-secondary">Abrir Ajustes</button>
      <button id="perm-btn-skip" class="perm-btn-ghost">Continuar sin BLE</button>
    </div>
  `;
  document.body.appendChild(overlay);

  // Styles inline para no depender de CSS externo
  const style = document.createElement('style');
  style.id = 'perm-overlay-styles';
  style.textContent = `
    #nexo-perm-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.92); z-index: 2147483647; display: flex; align-items: center; justify-content: center; backdrop-filter: blur(8px); }
    .perm-overlay-content { background: #0a0a15; border: 1px solid #00d4ff; border-radius: 16px; padding: 32px; max-width: 360px; width: 90%; text-align: center; color: #fff; box-shadow: 0 0 40px rgba(0,212,255,0.15); }
    .perm-overlay-content h2 { margin: 0 0 12px; font-size: 20px; color: #00d4ff; }
    .perm-overlay-content p { margin: 0 0 8px; font-size: 14px; color: #ccc; line-height: 1.5; }
    .perm-sub { font-size: 12px !important; color: #888 !important; font-style: italic; }
    .perm-btn-primary { display: block; width: 100%; margin: 16px 0 8px; padding: 14px; background: linear-gradient(135deg,#00d4ff,#0099cc); color: #000; border: none; border-radius: 10px; font-weight: 700; font-size: 15px; cursor: pointer; }
    .perm-btn-secondary { display: block; width: 100%; margin: 0 0 8px; padding: 12px; background: transparent; color: #00d4ff; border: 1px solid #00d4ff; border-radius: 10px; font-weight: 600; font-size: 14px; cursor: pointer; }
    .perm-btn-ghost { display: block; width: 100%; margin: 0; padding: 10px; background: transparent; color: #666; border: none; font-size: 13px; cursor: pointer; }
    .perm-btn-primary:hover { box-shadow: 0 0 20px rgba(0,212,255,0.3); }
  `;
  document.head.appendChild(style);

  document.getElementById('perm-btn-grant').addEventListener('click', async () => {
    rem.info('[Shim] Usuario solicitó permisos desde overlay', 'SHIM_USER_REQ');
    try {
      const shim = getPermissionShim();
      const granted = await shim.request();
      if (granted) {
        _hidePermissionOverlay();
        await initializeNexoApp();
      } else {
        rem.warn('[Shim] Permisos denegados desde overlay', 'SHIM_USER_DENY');
      }
    } catch (e) {
      rem.error(`[Shim] Error en request: ${e.message}`, 'SHIM_USER_ERR');
    }
  });

  document.getElementById('perm-btn-settings').addEventListener('click', () => {
    rem.info('[Shim] Abriendo ajustes del sistema...', 'SHIM_SETTINGS');
    try {
      if (window.Capacitor?.Plugins?.App?.openUrl) {
        window.Capacitor.Plugins.App.openUrl({ url: 'app-settings:' });
      } else {
        window.location.href = 'app-settings:';
      }
    } catch (e) {
      alert('Ve a Configuración > Aplicaciones > NEXO > Permisos\nActiva "Dispositivos cercanos" y "Bluetooth"');
    }
  });

  document.getElementById('perm-btn-skip').addEventListener('click', async () => {
    rem.warn('[Shim] Usuario continuó sin BLE', 'SHIM_SKIP');
    _hidePermissionOverlay();
    await initializeNexoApp();
  });
}

function _hidePermissionOverlay() {
  const overlay = document.getElementById('nexo-perm-overlay');
  if (overlay) {
    overlay.style.opacity = '0';
    setTimeout(() => overlay.remove(), 300);
  }
  const styles = document.getElementById('perm-overlay-styles');
  if (styles) styles.remove();
}

// ─── NexoApp Initialization (INTACTO v9.0) ───
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

    rem.info('🚀 [NEXO] App instance v3.3.0-NAP', 'NEXO_INIT');
    window.NEXO.app = new NexoApp(nexoConfig);
    rem.info('[init] ===== INICIANDO NEXO v3.3.0-NAP =====', 'INIT_START');

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

    window.NEXO.initialized = true;
    clearTimeout(SAFETY_TIMEOUT);

    _setupMessageInput();
    _setupVaultToggle();
    _setupChatHeader();
    _setupKeyboardShortcuts();

    NEXO_DIAG.hideSplash();
    _forceHideSplash();
    rem.success('NEXO v9.1-SHIM Listo', 'INIT_OK');
    console.log('✅ NEXO v9.1-SHIM Inicializado');

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

// ─── Helper Functions (INTACTOS v9.0) ───
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
    `${_getSourceIcon(msg._source)}` : '';

  div.innerHTML = `
    <div class="msg-content">${msg.content || msg.text}</div>
    <div class="msg-meta">
      <span class="msg-time">${new Date(msg.timestamp || Date.now()).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'})}</span>
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
    <h3>⚠️ Error de Inicialización</h3>
    <p>La app no pudo iniciar completamente.</p>
  `;
  body.appendChild(msg);
}

if (module.hot) module.hot.accept();
