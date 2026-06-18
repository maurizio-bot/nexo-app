/**
 * src/main.js - Punto de entrada NEXO v9.3.1-FIX
 * Pipeline: NexoApp._handleMessage() -> config.onMessage(msg) -> _renderMessage(msg) -> DOM append
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
  version: '9.3.1-FIX',
  initialized: false
};

window.NEXO_REM = rem;
window.NEXO_DIAG = NEXO_DIAG;

const SAFETY_TIMEOUT = setTimeout(() => {
  if (NEXO_DIAG.isSplashVisible && NEXO_DIAG.isSplashVisible()) {
    rem.warn('Timeout de seguridad - forzando continuar', 'INIT_TIMEOUT');
  }
  NEXO_DIAG.hideSplash();
  _forceHideSplash();
  document.body.classList.add('nexo-force-ready');
}, 10000);

document.addEventListener('DOMContentLoaded', async () => {
  try {
    NEXO_DIAG.init();
    window.NEXO.diag = NEXO_DIAG;
    _ensureDOMStructure();
    _injectCriticalCSS();

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
      rem.warn('[Shim] Permisos timeout/error: ' + permErr.message, 'SHIM_WARN');
      permissionsGranted = false;
    }

    if (permissionsGranted) {
      rem.success('[Shim] Permisos BLE concedidos', 'SHIM_OK');
      await initializeNexoApp();
    } else {
      rem.warn('[Shim] Permisos BLE pendientes', 'SHIM_REQUIRED');
      NEXO_DIAG.hideSplash();
      _forceHideSplash();
      _showPermissionOverlay();
    }

    window.addEventListener('nexo-permissions-granted', async (e) => {
      if (!window.NEXO.initialized) {
        rem.success('[Shim] Permisos concedidos via ' + (e.detail && e.detail.source ? e.detail.source : 'event'), 'SHIM_EVENT_OK');
        _hidePermissionOverlay();
        await initializeNexoApp();
      }
    }, { once: true });

  } catch (error) {
    console.error('Error fatal en inicializacion:', error);
    clearTimeout(SAFETY_TIMEOUT);
    NEXO_DIAG.error('INIT_FATAL', error.message);
    rem.error('Error fatal: ' + error.message, 'INIT_FATAL');
    NEXO_DIAG.hideSplash();
    _forceHideSplash();
    _enableFallbackMode();
  }
});

function _injectCriticalCSS() {
  if (document.getElementById('nexo-critical-css')) return;

  var style = document.createElement('style');
  style.id = 'nexo-critical-css';
  style.textContent = `
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { background: #0a0a0a; color: #fff; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
    #splash-native { position: fixed; inset: 0; background: #0a0a0a; display: flex; flex-direction: column; align-items: center; justify-content: center; z-index: 99999; transition: opacity 0.5s ease; }
    #splash-native.hidden { opacity: 0; pointer-events: none; }
    #app { display: flex; flex-direction: column; height: 100vh; background: #0a0a0a; }
    #app.hidden { display: none !important; }
    #chat-header { position: fixed; top: 0; left: 0; right: 0; height: 56px; background: rgba(10,10,10,0.95); backdrop-filter: blur(10px); z-index: 50; display: flex; flex-direction: column; align-items: center; justify-content: center; border-bottom: 1px solid rgba(255,255,255,0.08); }
    #chat-contact-name { background: transparent; border: none; border-bottom: 1px solid transparent; color: #fff; font-size: 17px; font-weight: 600; text-align: center; width: 80%; outline: none; padding: 2px 8px; }
    #chat-contact-name:focus { border-bottom-color: #00d4ff; }
    #chat-contact-subtitle { font-size: 11px; color: #64748b; margin-top: 2px; text-transform: uppercase; letter-spacing: 1px; }
    #nexo-stream { flex: 1; overflow-y: auto; padding: 76px 20px 100px 20px; }
    #messages-container { display: flex; flex-direction: column; gap: 10px; }
    .message { max-width: 80%; padding: 12px 16px; border-radius: 16px; font-size: 14px; line-height: 1.4; }
    .message.own { align-self: flex-end; background: #0066cc; color: white; border-bottom-right-radius: 4px; }
    .message.other { align-self: flex-start; background: #1f2937; color: #e5e7eb; border-bottom-left-radius: 4px; }
    .msg-sender { font-weight: 600; font-size: 12px; margin-bottom: 4px; opacity: 0.8; }
    .msg-content { word-break: break-word; }
    .msg-meta { margin-top: 4px; font-size: 11px; opacity: 0.6; display: flex; gap: 8px; }
    #input-area { position: fixed; bottom: 0; left: 0; right: 0; padding: 12px 16px; background: rgba(10,10,10,0.95); backdrop-filter: blur(10px); display: flex; gap: 10px; border-top: 1px solid rgba(255,255,255,0.1); }
    #message-input { flex: 1; background: #1f2937; border: none; border-radius: 28px; padding: 12px 20px; color: white; font-size: 16px; outline: none; }
    #send-btn { width: 52px; height: 52px; border-radius: 50%; border: none; background: #0066cc; color: white; font-size: 22px; cursor: pointer; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
    #vault-panel { position: fixed; top: 0; right: 0; width: 85%; height: 100%; background: #1a1a1a; z-index: 1000; transform: translateX(100%); transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1); box-shadow: -5px 0 25px rgba(0,0,0,0.5); }
    #vault-panel.vault-visible { transform: translateX(0); }
    .vault-hidden { transform: translateX(100%) !important; }
  `;
  document.head.appendChild(style);
}

function _showPermissionOverlay() {
  if (document.getElementById('nexo-perm-overlay')) return;

  const overlay = document.createElement('div');
  overlay.id = 'nexo-perm-overlay';
  overlay.innerHTML = `
    <div class="perm-overlay-content">
      <h2>Permisos BLE Requeridos</h2>
      <p>NEXO necesita acceso a Bluetooth y Dispositivos Cercanos para comunicacion P2P.</p>
      <p class="perm-sub">Si ya los concediste en Ajustes, la app continuara automaticamente.</p>
      <button id="perm-btn-grant" class="perm-btn-primary">Conceder Permisos</button>
      <button id="perm-btn-settings" class="perm-btn-secondary">Abrir Ajustes</button>
      <button id="perm-btn-skip" class="perm-btn-ghost">Continuar sin BLE</button>
    </div>
  `;
  document.body.appendChild(overlay);

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
    rem.info('[Shim] Usuario solicito permisos desde overlay', 'SHIM_USER_REQ');
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
      rem.error('[Shim] Error en request: ' + e.message, 'SHIM_USER_ERR');
    }
  });

  document.getElementById('perm-btn-settings').addEventListener('click', () => {
    rem.info('[Shim] Abriendo ajustes del sistema...', 'SHIM_SETTINGS');
    try {
      if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App && window.Capacitor.Plugins.App.openUrl) {
        window.Capacitor.Plugins.App.openUrl({ url: 'app-settings:' });
      } else {
        window.location.href = 'app-settings:';
      }
    } catch (e) {
      alert('Ve a Configuracion > Aplicaciones > NEXO > Permisos\nActiva "Dispositivos cercanos" y "Bluetooth"');
    }
  });

  document.getElementById('perm-btn-skip').addEventListener('click', async () => {
    rem.warn('[Shim] Usuario continuo sin BLE', 'SHIM_SKIP');
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

async function initializeNexoApp() {
  try {
    const nexoConfig = {
      relayUrls: ['wss://relay.nexo.local:8080', 'wss://backup.nexo.local:8081'],
      bleTimeout: 10000,
      enableGestures: true,
      enableMesh: true,
      onMessage: (msg) => {
        console.log('Mensaje recibido:', msg);
        _renderMessage(msg);
      },
      onStatusChange: (mode) => {
        console.log('Modo:', mode);
        rem.updateMode(mode);
        _updateConnectionStatus(mode);
      },
      onError: (err) => {
        console.error('App error:', err);
        rem.error(err.message, 'APP_ERR');
      },
      onVaultStateChange: (isOpen) => _toggleVaultUI(isOpen),
      actionCallbacks: {
        onReact: (id) => rem.success('Reaccion anadida', 'REACT_OK'),
        onReply: (id) => _focusInput('@' + (id ? id.substr(0,8) : '') + ' '),
        onForward: (id) => rem.info('Listo para reenviar', 'FORWARD_READY')
      }
    };

    rem.info('[NEXO] App instance v5.1.5-FIX-1', 'NEXO_INIT');
    window.NEXO.app = new NexoApp(nexoConfig);
    rem.info('[init] ===== INICIANDO NEXO v9.3.1-FIX =====', 'INIT_START');

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
    _setupBLEStatusIndicator();

    NEXO_DIAG.hideSplash();
    _forceHideSplash();
    setTimeout(_forceHideSplash, 500);
    setTimeout(_forceHideSplash, 1500);
    rem.success('NEXO v9.3.1-FIX Listo', 'INIT_OK');
    console.log('NEXO v9.3.1-FIX Inicializado');

    const status = window.NEXO.app.getStatus && window.NEXO.app.getStatus();
    if (status) console.log('[NEXO STATUS]', status);

  } catch (error) {
    console.error('Error en NexoApp:', error);
    clearTimeout(SAFETY_TIMEOUT);
    NEXO_DIAG.error('APP_INIT_ERROR', error.message);
    rem.error('Error al iniciar app: ' + error.message, 'APP_ERR');
    NEXO_DIAG.hideSplash();
    _forceHideSplash();
    _enableFallbackMode();
  }
}

function _setupBLEStatusIndicator() {
  const header = document.getElementById('chat-header');
  if (!header) return;

  let indicator = document.getElementById('ble-status-indicator');
  if (!indicator) {
    indicator = document.createElement('div');
    indicator.id = 'ble-status-indicator';
    indicator.style.cssText = 'width:8px;height:8px;border-radius:50%;background:#666;margin-left:8px;display:inline-block;transition:background 0.3s;';
    const subtitle = document.getElementById('chat-contact-subtitle');
    if (subtitle) subtitle.parentNode.insertBefore(indicator, subtitle.nextSibling);
  }

  setInterval(() => {
    const app = window.NEXO.app;
    if (!app || !app.bleInterface) {
      indicator.style.background = '#666';
      return;
    }
    const activeMAC = app.bleInterface._activeChatMAC;
    if (!activeMAC) {
      indicator.style.background = '#666';
      return;
    }
    const state = app.bleInterface._getDeviceState && app.bleInterface._getDeviceState(activeMAC);
    if (state && (state.state === 'ready_to_chat' || state.state === 'notifications_ready')) {
      indicator.style.background = '#00ff88';
    } else if (state && (state.state === 'connecting' || state.state === 'reconnecting')) {
      indicator.style.background = '#ffaa00';
    } else {
      indicator.style.background = '#ff4444';
    }
  }, 3000);
}

function _updateConnectionStatus(mode) {
  const subtitle = document.getElementById('chat-contact-subtitle');
  if (!subtitle) return;

  const statusMap = {
    'P2P_BLE': 'BLUETOOTH',
    'RELAY': 'RELAY',
    'OFFLINE': 'OFFLINE',
    'CHAT:': 'BLUETOOTH'
  };

  for (const key in statusMap) {
    if (mode && mode.startsWith && mode.startsWith(key)) {
      subtitle.textContent = statusMap[key];
      return;
    }
  }
  subtitle.textContent = mode || 'OFFLINE';
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
      nameInput.value = (window.NEXO.app && window.NEXO.app.activeContact && window.NEXO.app.activeContact.name) || 'NEXO';
      return;
    }
    if (window.NEXO.app && window.NEXO.app.activeContact) {
      window.NEXO.app.activeContact.name = newName;
    }
    try {
      const contacts = JSON.parse(localStorage.getItem('nexo_ble_contacts_v3') || '[]');
      const activeId = window.NEXO.app && window.NEXO.app.activeContact && window.NEXO.app.activeContact.id;
      if (activeId) {
        const idx = contacts.findIndex(c => (c.id || c.deviceUUID) === activeId);
        if (idx >= 0) {
          contacts[idx].name = newName;
          localStorage.setItem('nexo_ble_contacts_v3', JSON.stringify(contacts));
          rem.info('Contacto renombrado: ' + newName, 'CONTACT_RENAME');
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
      if (rem.toggle) rem.toggle();
    }
    if (e.ctrlKey && e.shiftKey && e.key === 'H') {
      e.preventDefault();
      if (rem.showHistory) rem.showHistory();
    }
  });
}

function _renderMessage(msg) {
  const container = document.getElementById('messages-container');
  if (!container) return;

  const msgId = msg.messageId || msg._id;
  if (msgId) {
    const existing = container.querySelector('[data-msg-id="' + msgId + '"]');
    if (existing) return;
  }

  // FIX: Intentar TheStream pero NO retornar, siempre hacer fallback manual
  if (window.NEXO.app && window.NEXO.app.stream && typeof window.NEXO.app.stream.appendItems === 'function') {
    try {
      window.NEXO.app.stream.appendItems([msg], { scroll: true });
    } catch (e) {
      console.warn('[main] TheStream.appendItems failed, using fallback', e);
    }
  }

  const div = document.createElement('div');
  div.className = 'message ' + (msg._own ? 'own' : 'other');
  if (msgId) div.setAttribute('data-msg-id', msgId);

  const senderName = msg.senderName || (msg._own ? 'Tu' : 'NEXO Peer');
  const sourceBadge = msg._source ? _getSourceIcon(msg._source) : '';

  div.innerHTML = `
    <div class="msg-sender">${senderName}</div>
    <div class="msg-content">${msg.content || msg.text || ''}</div>
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
    'ble_nordic': 'BLE',
    'ble_hybrid': 'HYB',
    'ble_direct': 'DIR',
    'relay': 'REL',
    'self': 'YOU'
  };
  return icons[source] || '';
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

function _focusInput(text) {
  const input = document.getElementById('message-input');
  if (input) {
    input.focus();
    if (text) input.value = text;
  }
}

// FIX: _forceHideSplash más agresivo - limpia TODOS los splash posibles
function _forceHideSplash() {
  const selectors = ['#splash-native', '#splash', '.splash-screen', '[id*="splash"]', '#nexo-setup', '.setup-wizard', '#setup-overlay', '[class*="setup"]'];
  selectors.forEach(sel => {
    const els = document.querySelectorAll(sel);
    els.forEach(el => {
      el.style.opacity = '0';
      el.style.pointerEvents = 'none';
      el.style.transition = 'opacity 0.3s ease';
      setTimeout(() => {
        el.style.display = 'none';
        el.remove();
      }, 500);
    });
  });

  const app = document.getElementById('app');
  if (app) {
    app.classList.remove('hidden');
    app.style.display = 'flex';
    app.style.visibility = 'visible';
    app.style.opacity = '1';
  }

  document.body.classList.add('nexo-ready');
  document.body.style.overflow = 'auto';
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

if (module.hot) module.hot.accept();
