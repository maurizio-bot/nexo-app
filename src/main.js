
/**
 * src/main.js - Punto de entrada NEXO v9.2-ARMORED
 * NAP 2.0 Certified - BLE Soberano P2P
 * v9.2-ARMORED: Protocolo anti-crash aplicado. Validaciones defensivas.
 * Build #1273 compatible. NO toca nativo.
 */

// ─── CONFIG PRIMERO ───
import { NEXO_CONFIG } from './core/nexo_config.js';
import './styles/critical.css';
import { NEXO_DIAG } from './core/nap.js';
import { NexoApp, DEBUG } from './app/nexo_app.js';
import { rem } from './ui/rem.js';
import { ensureBLEPermissions, getPermissionShim } from './core/NexoPermissionShim.js';

// ─── ASSERTS DE ARRANQUE ───
try {
  NEXO_CONFIG.assert(typeof NEXO_DIAG !== 'undefined', 'NEXO_DIAG debe estar importado');
  NEXO_CONFIG.assert(typeof NexoApp !== 'undefined', 'NexoApp debe estar importado');
  NEXO_CONFIG.assert(typeof rem !== 'undefined', 'rem debe estar importado');
} catch (assertErr) {
  console.error('[MAIN] Assert de arranque fallo:', assertErr);
}

window.NEXO = {
  app: null,
  rem: null,
  diag: null,
  version: (NEXO_CONFIG && NEXO_CONFIG.VERSION) ? NEXO_CONFIG.VERSION.toString() : 'unknown',
  initialized: false
};

window.NEXO_REM = rem;
window.NEXO_DIAG = NEXO_DIAG;

var SAFETY_TIMEOUT = setTimeout(function() {
  try {
    if (NEXO_DIAG && typeof NEXO_DIAG.isSplashVisible === 'function' && NEXO_DIAG.isSplashVisible()) {
      rem.warn('Timeout de seguridad - forzando continuar', 'INIT_TIMEOUT');
      NEXO_DIAG.hideSplash();
      document.body.classList.add('nexo-force-ready');
    }
  } catch (e) {
    console.warn('[MAIN] Safety timeout error:', e);
  }
}, (NEXO_CONFIG && NEXO_CONFIG.TIMEOUTS && NEXO_CONFIG.TIMEOUTS.SPLASH_HIDE ? NEXO_CONFIG.TIMEOUTS.SPLASH_HIDE : 3000) + 12000);

document.addEventListener('DOMContentLoaded', async function() {
  try {
    console.log('[MAIN] NEXO v9.2-FIXED iniciando...');
    console.log('[MAIN] Storage keys disponibles:', Object.keys(localStorage).filter(function(k) { return k.indexOf('nexo') === 0; }));
    NEXO_DIAG.init();
    window.NEXO.diag = NEXO_DIAG;
    _ensureDOMStructure();

    window.NEXO.rem = rem;
    rem.init();
    rem.info('REM v2.1 NAP 2.0 initialized', 'REM_INIT');

    // ─── SHIM INTEGRATION v9.2 ───
    rem.info('[Shim] Verificando permisos BLE...', 'SHIM_CHECK');

    var permissionsGranted = false;
    try {
      var permPromise = ensureBLEPermissions();
      var permTimeout = new Promise(function(_, reject) {
        setTimeout(function() { reject(new Error('PERM_TIMEOUT')); }, (NEXO_CONFIG && NEXO_CONFIG.TIMEOUTS && NEXO_CONFIG.TIMEOUTS.SCAN) ? NEXO_CONFIG.TIMEOUTS.SCAN : 10000);
      });
      permissionsGranted = await Promise.race([permPromise, permTimeout]);
    } catch (permErr) {
      rem.warn('[Shim] Permisos timeout/error: ' + (permErr.message || 'unknown'), 'SHIM_WARN');
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
    window.addEventListener('nexo-permissions-granted', async function(e) {
      try {
        if (!window.NEXO.initialized) {
          var source = (e && e.detail && e.detail.source) ? e.detail.source : 'event';
          rem.success('[Shim] Permisos concedidos via ' + source, 'SHIM_EVENT_OK');
          _hidePermissionOverlay();
          await initializeNexoApp();
        }
      } catch (eventErr) {
        console.error('[MAIN] Error en nexo-permissions-granted:', eventErr);
      }
    }, { once: true });

  } catch (error) {
    console.error('Error fatal en inicializacion:', error);
    clearTimeout(SAFETY_TIMEOUT);
    try {
      NEXO_DIAG.error('INIT_FATAL', error.message || 'unknown');
      rem.error('Error fatal: ' + (error.message || 'unknown'), 'INIT_FATAL');
      NEXO_DIAG.hideSplash();
    } catch (diagErr) {}
    _forceHideSplash();
    _enableFallbackMode();
  }
});

// ─── Permission Overlay (reemplaza SetupWizard) ───
function _showPermissionOverlay() {
  try {
    if (document.getElementById('nexo-perm-overlay')) return;

    var overlay = document.createElement('div');
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
    var style = document.createElement('style');
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

    var btnGrant = document.getElementById('perm-btn-grant');
    var btnSettings = document.getElementById('perm-btn-settings');
    var btnSkip = document.getElementById('perm-btn-skip');

    if (btnGrant) {
      btnGrant.addEventListener('click', async function() {
        rem.info('[Shim] Usuario solicito permisos desde overlay', 'SHIM_USER_REQ');
        try {
          var shim = getPermissionShim();
          var granted = await shim.request();
          if (granted) {
            _hidePermissionOverlay();
            await initializeNexoApp();
          } else {
            rem.warn('[Shim] Permisos denegados desde overlay', 'SHIM_USER_DENY');
          }
        } catch (e) {
          rem.error('[Shim] Error en request: ' + (e.message || 'unknown'), 'SHIM_USER_ERR');
        }
      });
    }

    if (btnSettings) {
      btnSettings.addEventListener('click', function() {
        rem.info('[Shim] Abriendo ajustes del sistema...', 'SHIM_SETTINGS');
        try {
          if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App && window.Capacitor.Plugins.App.openUrl) {
            window.Capacitor.Plugins.App.openUrl({ url: 'app-settings:' });
          } else {
            window.location.href = 'app-settings:';
          }
        } catch (e) {
          alert('Ve a Configuración > Aplicaciones > NEXO > Permisos\nActiva "Dispositivos cercanos" y "Bluetooth"');
        }
      });
    }

    if (btnSkip) {
      btnSkip.addEventListener('click', async function() {
        rem.warn('[Shim] Usuario continuo sin BLE', 'SHIM_SKIP');
        _hidePermissionOverlay();
        await initializeNexoApp();
      });
    }
  } catch (overlayErr) {
    console.error('[MAIN] Error creando permission overlay:', overlayErr);
  }
}

function _hidePermissionOverlay() {
  try {
    var overlay = document.getElementById('nexo-perm-overlay');
    if (overlay) {
      overlay.style.opacity = '0';
      setTimeout(function() { overlay.remove(); }, 300);
    }
    var styles = document.getElementById('perm-overlay-styles');
    if (styles) styles.remove();
  } catch (e) {}
}

// ─── NexoApp Initialization (ARMORED) ───
async function initializeNexoApp() {
  try {
    NEXO_CONFIG.assert(typeof NexoApp === 'function', 'NexoApp debe ser una clase valida');

    var nexoConfig = {
      relayUrls: ['wss://relay.nexo.local:8080', 'wss://backup.nexo.local:8081'],
      bleTimeout: (NEXO_CONFIG && NEXO_CONFIG.TIMEOUTS && NEXO_CONFIG.TIMEOUTS.BLE) ? NEXO_CONFIG.TIMEOUTS.BLE : 30000,
      enableGestures: true,
      enableMesh: true,
      onMessage: function(msg) {
        console.log('Mensaje:', msg);
        _renderMessage(msg);
      },
      onStatusChange: function(mode) {
        console.log('Modo:', mode);
        rem.updateMode(mode);
      },
      onError: function(err) {
        console.error('App error:', err);
        rem.error(err.message || 'unknown', 'APP_ERR');
      },
      onVaultStateChange: function(isOpen) { _toggleVaultUI(isOpen); },
      actionCallbacks: {
        onReact: function(id) { rem.success('Reacción añadida', 'REACT_OK'); },
        onReply: function(id) { _focusInput(id ? ('@' + id.substr(0,8) + ' ') : ''); },
        onForward: function(id) { rem.info('Listo para reenviar', 'FORWARD_READY'); }
      }
    };

    rem.info('[NEXO] App instance v5.0.7-ARMORED', 'NEXO_INIT');
    window.NEXO.app = new NexoApp(nexoConfig);
    rem.info('[init] ===== INICIANDO NEXO v5.0.7-ARMORED =====', 'INIT_START');

    var initPromise = window.NEXO.app.init();
    var timeoutPromise = new Promise(function(_, reject) {
      setTimeout(function() { reject(new Error('INIT_TIMEOUT')); }, (NEXO_CONFIG && NEXO_CONFIG.TIMEOUTS && NEXO_CONFIG.TIMEOUTS.CONNECT) ? NEXO_CONFIG.TIMEOUTS.CONNECT + 3000 : 13000);
    });

    try {
      await Promise.race([initPromise, timeoutPromise]);
      rem.success('==== INICIALIZACION NAP 2.0 COMPLETADA ====', 'INIT_OK');
    } catch (timeoutErr) {
      rem.warn('Init timeout - continuando con funcionalidad limitada', 'INIT_WARN');
      rem.info('BLE puede no estar disponible, verifica permisos', 'INIT_FALLBACK');
    }

    window.NEXO.initialized = true;
    clearTimeout(SAFETY_TIMEOUT);
    /* FIX: Log de diagnóstico BLE */
    try {
      if (window.NEXO.app && window.NEXO.app.bleInterface) {
        var bi = window.NEXO.app.bleInterface;
        console.log('[MAIN] BLE Interface estado:', {
          localUUID: bi.localDeviceUUID,
          localMAC: bi.localDeviceAddress,
          activeChatMAC: bi._activeChatMAC,
          activeChatId: bi._activeChatDeviceId,
          mapSize: bi._uuidToMacMap ? bi._uuidToMacMap.size : 0,
          contacts: bi._getBLEContacts ? bi._getBLEContacts().length : 0
        });
      }
    } catch (logErr) { console.warn('[MAIN] Log BLE error:', logErr); }

    _setupMessageInput();
    _setupVaultToggle();
    _setupChatHeader();
    _setupKeyboardShortcuts();

    NEXO_DIAG.hideSplash();
    _forceHideSplash();
    rem.success('NEXO ' + window.NEXO.version + ' Listo', 'INIT_OK');
    console.log('NEXO ' + window.NEXO.version + ' Inicializado');

    try {
      var status = window.NEXO.app.getStatus ? window.NEXO.app.getStatus() : null;
      if (status) console.log('[NEXO STATUS]', status);
    } catch (statusErr) {}

  } catch (error) {
    console.error('Error en NexoApp:', error);
    clearTimeout(SAFETY_TIMEOUT);
    try {
      NEXO_DIAG.error('APP_INIT_ERROR', error.message || 'unknown');
      rem.error('Error al iniciar app: ' + (error.message || 'unknown'), 'APP_ERR');
      NEXO_DIAG.hideSplash();
    } catch (diagErr) {}
    _forceHideSplash();
    _enableFallbackMode();
  }
}

// ─── Helper Functions (ARMORED) ───
function _ensureDOMStructure() {
  try {
    var stream = document.getElementById('nexo-stream') || document.querySelector('.stream-container');
    var vault = document.getElementById('nexo-vault') || document.querySelector('.vault-panel');
    if (stream && !stream.id) stream.id = 'nexo-stream';
    if (vault && !vault.id) vault.id = 'nexo-vault';

    if (!document.getElementById('messages-container')) {
      var msgContainer = document.createElement('div');
      msgContainer.id = 'messages-container';
      msgContainer.className = 'messages-container';
      (stream || document.body).appendChild(msgContainer);
    }
  } catch (e) {
    console.warn('[MAIN] _ensureDOMStructure error:', e);
  }
}

function _setupMessageInput() {
  try {
    var input = document.getElementById('message-input');
    var btn = document.getElementById('send-btn');
    if (!input || !btn || !window.NEXO.app) return;

    var send = async function() {
      var text = input.value.trim();
      if (!text) return;
      input.value = '';
      input.focus();

      try {
        if (!window.NEXO.app) {
          rem.error('NEXO.app no disponible', 'MSG_ERR');
          return;
        }
        var sent = await window.NEXO.app.sendMessage({ content: text });
        if (sent) rem.success('Enviado', 'MSG_SENT');
        else rem.info('En cola (offline)', 'MSG_QUEUED');
      } catch (e) {
        rem.error('Error al enviar', 'MSG_ERR');
      }
    };

    btn.addEventListener('click', send);
    input.addEventListener('keypress', function(e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        send();
      }
    });
    input.focus();
  } catch (e) {
    console.warn('[MAIN] _setupMessageInput error:', e);
  }
}

function _setupVaultToggle() {
  try {
    var vault = document.getElementById('vault-panel');
    if (vault) vault.classList.add('vault-hidden');
  } catch (e) {}
}

function _setupChatHeader() {
  try {
    var nameInput = document.getElementById('chat-contact-name');
    if (!nameInput) return;

    var saveName = function() {
      try {
        var newName = nameInput.value.trim();
        if (!newName) {
          nameInput.value = (window.NEXO.app && window.NEXO.app.activeContact && window.NEXO.app.activeContact.name) ? window.NEXO.app.activeContact.name : 'NEXO';
          return;
        }
        if (window.NEXO.app && window.NEXO.app.activeContact) {
          window.NEXO.app.activeContact.name = newName;
        }
        try {
          var contacts = JSON.parse(localStorage.getItem('nexo_ble_contacts_v2') || '[]');
          var activeId = window.NEXO.app && window.NEXO.app.activeContact ? window.NEXO.app.activeContact.id : null;
          if (activeId) {
            var idx = contacts.findIndex(function(c) { return (c.id || c.address) === activeId; });
            if (idx >= 0) {
              contacts[idx].name = newName;
              localStorage.setItem('nexo_ble_contacts_v1', JSON.stringify(contacts));
              rem.info('Contacto renombrado: ' + newName, 'CONTACT_RENAME');
            }
          }
        } catch (e) {}
      } catch (saveErr) {
        console.warn('[main] Error guardando nombre editado:', saveErr);
      }
    };

    nameInput.addEventListener('blur', saveName);
    nameInput.addEventListener('keypress', function(e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        nameInput.blur();
      }
    });
  } catch (e) {
    console.warn('[MAIN] _setupChatHeader error:', e);
  }
}

function _setupKeyboardShortcuts() {
  try {
    document.addEventListener('keydown', function(e) {
      try {
        if (e.ctrlKey && e.shiftKey && e.key === 'V') {
          e.preventDefault();
          var vault = document.getElementById('vault-panel');
          if (vault) {
            var isHidden = vault.classList.contains('vault-hidden');
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
      } catch (shortcutErr) {}
    });
  } catch (e) {
    console.warn('[MAIN] _setupKeyboardShortcuts error:', e);
  }
}

function _renderMessage(msg) {
  try {
    if (!msg) return;
    var container = document.getElementById('messages-container');
    if (!container) return;

    var div = document.createElement('div');
    div.className = 'message ' + (msg._own ? 'own' : 'other');

    var sourceBadge = msg._source ? _getSourceIcon(msg._source) : '';

    div.innerHTML = `
      <div class="msg-content">${msg.content || msg.text || ''}</div>
      <div class="msg-meta">
        <span class="msg-time">${new Date(msg.timestamp || Date.now()).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'})}</span>
        ${sourceBadge}
      </div>
    `;

    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
  } catch (e) {
    console.warn('[MAIN] _renderMessage error:', e);
  }
}

function _getSourceIcon(source) {
  try {
    var icons = {
      'ble_nordic': '🔷',
      'ble_hybrid': '📡',
      'relay': '🌐',
      'self': '✓'
    };
    return icons[source] || '•';
  } catch (e) { return '•'; }
}

function _toggleVaultUI(isOpen) {
  try {
    var vault = document.getElementById('vault-panel');
    var stream = document.getElementById('nexo-stream');

    if (vault) {
      vault.classList.toggle('vault-hidden', !isOpen);
      vault.classList.toggle('vault-visible', isOpen);
      rem.info(isOpen ? '[VAULT] Abierto' : '[VAULT] Cerrado', 'VAULT_TOGGLE');
    }
    if (stream) {
      stream.style.transform = isOpen ? 'translateX(-20%)' : 'translateX(0)';
    }
  } catch (e) {
    console.warn('[MAIN] _toggleVaultUI error:', e);
  }
}

function _focusInput(text) {
  try {
    var input = document.getElementById('message-input');
    if (input) {
      input.focus();
      if (text) input.value = text;
    }
  } catch (e) {}
}

function _forceHideSplash() {
  try {
    var selectors = ['#splash-native', '#splash', '.splash-screen', '[id*="splash"]', '#nexo-setup'];
    for (var i = 0; i < selectors.length; i++) {
      var el = document.querySelector(selectors[i]);
      if (el) {
        el.style.opacity = '0';
        el.style.pointerEvents = 'none';
        setTimeout(function(element) { return function() { element.remove(); }; }(el), 500);
      }
    }
  } catch (e) {
    console.warn('[MAIN] _forceHideSplash error:', e);
  }
}

function _enableFallbackMode() {
  try {
    console.warn('[NEXO] Activando modo fallback');
    var body = document.body;
    body.classList.add('nexo-fallback-mode');

    var msg = document.createElement('div');
    msg.className = 'fallback-notice';
    msg.innerHTML = `
      <h3>⚠️ Error de Inicialización</h3>
      <p>La app no pudo iniciar completamente.</p>
    `;
    body.appendChild(msg);
  } catch (e) {
    console.error('[MAIN] _enableFallbackMode error:', e);
  }
}

if (module && module.hot) module.hot.accept();
