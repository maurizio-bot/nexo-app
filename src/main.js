/**
 * src/main.js - Punto de entrada NEXO v9.9-FIX
 * FIX: chat-view-active agregado/quitado en body para mostrar messages-container e input-area
 * FIX v9.9.1: FAB = botón agregar contacto (+) → panel BLE + auto-scan
 * FIX v9.9.2: Logo path corregido al iniciar
 * Build #1605+ compatible. NO toca nativo.
 */

import { NEXO_CONFIG } from './core/nexo_config.js';
import './styles/critical.css';
import { NEXO_DIAG } from './core/nap.js';
import { NexoApp, DEBUG } from './app/nexo_app.js';
import { rem } from './ui/rem.js';
import { ensureBLEPermissions, getPermissionShim } from './core/NexoPermissionShim.js';

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
      NEXO_DIAG.hideSplash();
      document.body.classList.add('nexo-force-ready');
    }
  } catch (e) {
    console.warn('[MAIN] Safety timeout error:', e);
  }
}, (NEXO_CONFIG && NEXO_CONFIG.TIMEOUTS && NEXO_CONFIG.TIMEOUTS.SPLASH_HIDE ? NEXO_CONFIG.TIMEOUTS.SPLASH_HIDE : 3000) + 12000);

document.addEventListener('DOMContentLoaded', async function() {
  try {
    console.log('[MAIN] NEXO v9.9-FIX iniciando...');
    console.log('[MAIN] Storage keys disponibles:', Object.keys(localStorage).filter(function(k) { return k.indexOf('nexo') === 0; }));
    NEXO_DIAG.init();
    window.NEXO.diag = NEXO_DIAG;
    _ensureDOMStructure();

    /* FIX LOGO: Corregir ruta del logo en header principal */
    _fixLogoPath();

    window.NEXO.rem = rem;
    rem.init();

    var permissionsGranted = false;
    try {
      var permPromise = ensureBLEPermissions();
      var permTimeout = new Promise(function(_, reject) {
        setTimeout(function() { reject(new Error('PERM_TIMEOUT')); }, (NEXO_CONFIG && NEXO_CONFIG.TIMEOUTS && NEXO_CONFIG.TIMEOUTS.SCAN) ? NEXO_CONFIG.TIMEOUTS.SCAN : 10000);
      });
      permissionsGranted = await Promise.race([permPromise, permTimeout]);
    } catch (permErr) {
      permissionsGranted = false;
    }

    if (permissionsGranted) {
      await initializeNexoApp();
    } else {
      NEXO_DIAG.hideSplash();
      _showPermissionOverlay();
    }

    window.addEventListener('nexo-permissions-granted', async function(e) {
      try {
        if (!window.NEXO.initialized) {
          var source = (e && e.detail && e.detail.source) ? e.detail.source : 'event';
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
      NEXO_DIAG.hideSplash();
    } catch (diagErr) {}
    _forceHideSplash();
    _enableFallbackMode();
  }
});

function _showPermissionOverlay() {
  try {
    if (document.getElementById('nexo-perm-overlay')) return;
    var overlay = document.createElement('div');
    overlay.id = 'nexo-perm-overlay';
    overlay.innerHTML = `
      <div class="perm-overlay-content">
        <h2>🔐#128272; Permisos BLE Requeridos</h2>
        <p>NEXO necesita acceso a Bluetooth y Dispositivos Cercanos para comunicación P2P.</p>
        <p class="perm-sub">Si ya los concediste en Ajustes, la app continuará automáticamente.</p>
        <button id="perm-btn-grant" class="perm-btn-primary">Conceder Permisos</button>
        <button id="perm-btn-settings" class="perm-btn-secondary">Abrir Ajustes</button>
        <button id="perm-btn-skip" class="perm-btn-ghost">Continuar sin BLE</button>
      </div>
    `;
    document.body.appendChild(overlay);
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
        try {
          var shim = getPermissionShim();
          var granted = await shim.request();
          if (granted) {
            _hidePermissionOverlay();
            await initializeNexoApp();
          } else {
          }
        } catch (e) {
        }
      });
    }
    if (btnSettings) {
      btnSettings.addEventListener('click', function() {
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
      },
      onError: function(err) {
        console.error('App error:', err);
      },
      onVaultStateChange: function(isOpen) { _toggleVaultUI(isOpen); },
      actionCallbacks: {
        onReact: function(id) { rem.success('Reacción añadida', 'REACT_OK'); },
        onReply: function(id) { _focusInput(id ? ('@' + id.substr(0,8) + ' ') : ''); },
        onForward: function(id) { rem.info('Listo para reenviar', 'FORWARD_READY'); }
      }
    };

    window.NEXO.app = new NexoApp(nexoConfig);

    var initPromise = window.NEXO.app.init();
    var timeoutPromise = new Promise(function(_, reject) {
      setTimeout(function() { reject(new Error('INIT_TIMEOUT')); }, (NEXO_CONFIG && NEXO_CONFIG.TIMEOUTS && NEXO_CONFIG.TIMEOUTS.CONNECT) ? NEXO_CONFIG.TIMEOUTS.CONNECT + 3000 : 13000);
    });

    try {
      await Promise.race([initPromise, timeoutPromise]);
    } catch (timeoutErr) {
    }

    window.NEXO.initialized = true;
    clearTimeout(SAFETY_TIMEOUT);

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
    _setupJumpButton();
    _setupBackButton();
    /* FIX v9.9.1: Setup FAB para abrir scan */
    _setupFABButton();

    _loadPersistedMessages();

    NEXO_DIAG.hideSplash();
    _forceHideSplash();
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
      NEXO_DIAG.hideSplash();
    } catch (diagErr) {}
    _forceHideSplash();
    _enableFallbackMode();
  }
}

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

/* FIX LOGO: Corregir ruta del logo en header principal */
function _fixLogoPath() {
  try {
    var logo = document.getElementById('main-logo');
    if (logo) {
      logo.style.backgroundImage = 'url("./assets/nexo_logo.png")';
      logo.style.backgroundSize = 'contain';
      logo.style.backgroundRepeat = 'no-repeat';
      logo.style.backgroundPosition = 'center';
    }
  } catch (e) {
    console.warn('[MAIN] _fixLogoPath error:', e);
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
          return;
        }
        var sent = await window.NEXO.app.sendMessage({ content: text });
        if (!sent) {
        }
      } catch (e) {
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

    window.addEventListener('resize', function() {
      var s = document.getElementById('messages-container');
      if (s) requestAnimationFrame(function() { s.scrollTop = s.scrollHeight; });
    });


  } catch (e) {
    console.warn('[MAIN] _setupMessageInput error:', e);
  }
}

/* FIX: vault-panel oculto al inicio - pantalla principal es la default */
function _setupVaultToggle() {
  try {
    var vault = document.getElementById('vault-panel');
    if (vault) {
      vault.classList.add('vault-hidden');
      vault.classList.remove('vault-visible');
      vault.style.setProperty('display', 'none', 'important');
      vault.style.setProperty('visibility', 'hidden', 'important');
      vault.style.setProperty('opacity', '0', 'important');
      vault.style.setProperty('pointer-events', 'none', 'important');
    }
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
            var idx = contacts.findIndex(function(c) { return (c.deviceUUID || c.id || c.address) === activeId; });
            if (idx >= 0) {
              contacts[idx].name = newName;
              localStorage.setItem('nexo_ble_contacts_v2', JSON.stringify(contacts));
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

function _setupJumpButton() {
  try {
    var stream = document.getElementById('nexo-stream');
    var jumpBtn = document.getElementById('jump-to-bottom');
    if (!stream || !jumpBtn) return;

    var threshold = 150;

    stream.addEventListener('scroll', function() {
      var scrollBottom = stream.scrollHeight - stream.scrollTop - stream.clientHeight;
      if (scrollBottom > threshold) {
        jumpBtn.classList.add('visible');
      } else {
        jumpBtn.classList.remove('visible');
      }
    });

    jumpBtn.addEventListener('click', function() {
      stream.scrollTo({ top: stream.scrollHeight, behavior: 'smooth' });
      jumpBtn.classList.remove('visible');
    });
  } catch (e) {
    console.warn('[MAIN] _setupJumpButton error:', e);
  }
}

/* FIX v9.9.1: FAB = botón agregar contacto (+) → panel BLE + auto-scan */
function _setupFABButton() {
  try {
    var fabBtn = document.getElementById('ble-fab-btn');
    if (!fabBtn) return;
    
    /* Cambiar icono a (+) */
    fabBtn.innerHTML = '<svg viewBox="0 0 24 24" width="28" height="28" fill="#fff"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>';
    
    /* Remover listeners anteriores clonando */
    var newFab = fabBtn.cloneNode(true);
    fabBtn.parentNode.replaceChild(newFab, fabBtn);
    
    newFab.addEventListener('click', function() {
      /* Abrir panel BLE (pantalla scan) */
      if (window.bleInterface && window.bleInterface.elements) {
        var panel = window.bleInterface.elements.panel;
        var overlay = window.bleInterface.elements.overlay;
        if (panel) panel.classList.add('active');
        if (overlay) overlay.classList.add('active');
      }
      /* Iniciar scan automático */
      if (window.bleInterface && typeof window.bleInterface.toggleScan === 'function') {
        window.bleInterface.toggleScan();
      }
    });
  } catch (e) {
    console.warn('[MAIN] _setupFABButton error:', e);
  }
}

function _getContactStorageKey() {
  var contactId = 'default';
  try {
    if (window.NEXO.app && window.NEXO.app.activeContact && window.NEXO.app.activeContact.id) {
      contactId = window.NEXO.app.activeContact.id;
    } else if (window.NEXO.app && window.NEXO.app.bleInterface && window.NEXO.app.bleInterface._activeChatMAC) {
      contactId = window.NEXO.app.bleInterface._activeChatMAC;
    }
  } catch (e) {}
  return 'nexo_messages_' + contactId;
}

function _saveMessageToStorage(msg) {
  try {
    if (!msg || !msg.messageId) return;
    var key = _getContactStorageKey();
    var messages = JSON.parse(localStorage.getItem(key) || '[]');
    var exists = messages.some(function(m) { return m.messageId === msg.messageId; });
    if (!exists) {
      messages.push(msg);
      if (messages.length > 500) messages = messages.slice(-500);
      localStorage.setItem(key, JSON.stringify(messages));
    }
  } catch (e) {
    console.warn('[MAIN] _saveMessageToStorage error:', e);
  }
}

function _updateMessageStorageStatus(messageId, status) {
  try {
    if (!messageId) return;
    var key = _getContactStorageKey();
    var messages = JSON.parse(localStorage.getItem(key) || '[]');
    var idx = messages.findIndex(function(m) { return m.messageId === messageId; });
    if (idx >= 0) {
      messages[idx].status = status;
      localStorage.setItem(key, JSON.stringify(messages));
    }
  } catch (e) {
    console.warn('[MAIN] _updateMessageStorageStatus error:', e);
  }
}

function _loadPersistedMessages() {
  try {
    var key = _getContactStorageKey();
    var messages = JSON.parse(localStorage.getItem(key) || '[]');
    if (messages.length === 0) return;
    messages.forEach(function(msg) {
      _renderMessage(msg, true);
    });
  } catch (e) {
    console.warn('[MAIN] _loadPersistedMessages error:', e);
  }
}

function _renderMessage(msg, skipSave) {
  try {
    if (!msg) return;
    var container = document.getElementById('messages-container');
    if (!container) return;

    var msgId = msg.messageId || msg._id || msg.id || '';
    if (!msgId) {
      msgId = 'msg_' + (msg.timestamp || Date.now()) + '_' + Math.random().toString(36).substr(2, 5);
      msg.messageId = msgId;
    }

    var existing = document.querySelector('[data-msg-id="' + msgId + '"]');
    if (existing) {
      if (msg.status) {
        _updateMessageStatus(msgId, msg.status);
        if (!skipSave) _updateMessageStorageStatus(msgId, msg.status);
      }
      return;
    }

    if (!msg._own && msg.content) {
      var recentMessages = container.querySelectorAll('.message.other');
      for (var i = recentMessages.length - 1; i >= Math.max(0, recentMessages.length - 5); i--) {
        var existingContent = recentMessages[i].querySelector('.msg-content');
        if (existingContent && existingContent.textContent === msg.content) {
          return;
        }
      }
    }

    var div = document.createElement('div');
    var isOwn = !!msg._own;
    div.className = 'message ' + (isOwn ? 'own' : 'other');

    if (isOwn) {
      div.classList.add('status-' + (msg.status || 'pending'));
    }

    div.dataset.msgId = msgId;

    /* FIX: Crear elementos con createElement/textContent en vez de innerHTML */
    var contentDiv = document.createElement('div');
    contentDiv.className = 'msg-content';
    contentDiv.textContent = msg.content || msg.text || '';
    div.appendChild(contentDiv);

    var metaDiv = document.createElement('div');
    metaDiv.className = 'msg-meta';

    var timeSpan = document.createElement('span');
    timeSpan.className = 'msg-time';
    timeSpan.textContent = new Date(msg.timestamp || Date.now()).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'});
    metaDiv.appendChild(timeSpan);

    if (isOwn) {
      var statusClass = 'status-pending';
      var statusIcon = '○';
      if (msg.status === 'sent') { statusClass = 'status-sent'; statusIcon = '✓'; }
      else if (msg.status === 'delivered') { statusClass = 'status-delivered'; statusIcon = '✓✓'; }
      else if (msg.status === 'read') { statusClass = 'status-read'; statusIcon = '✓✓'; }
      var statusSpan = document.createElement('span');
      statusSpan.className = 'msg-status ' + statusClass;
      statusSpan.dataset.msgId = msgId;
      statusSpan.textContent = statusIcon;
      metaDiv.appendChild(statusSpan);
    }

    div.appendChild(metaDiv);
    /* FIN FIX */

    container.appendChild(div);

    var msgContainer = document.getElementById('messages-container');
    if (msgContainer) {
      requestAnimationFrame(function() {
        msgContainer.scrollTop = msgContainer.scrollHeight;
      });
    }

    if (!skipSave) {
      _saveMessageToStorage(msg);
    }
  } catch (e) {
    console.warn('[MAIN] _renderMessage error:', e);
  }
}

function _updateMessageStatus(messageId, status) {
  try {
    if (!messageId) return;
    var statusEl = document.querySelector('.msg-status[data-msg-id="' + messageId + '"]');
    if (!statusEl) return;

    statusEl.classList.remove('status-pending', 'status-sent', 'status-delivered', 'status-read');
    statusEl.classList.add('status-' + status);
    if (status === 'sent') statusEl.textContent = '✓';
    else if (status === 'delivered') statusEl.textContent = '✓✓';
    else if (status === 'read') statusEl.textContent = '✓✓';

    var msgDiv = statusEl.closest('.message');
    if (msgDiv) {
      msgDiv.classList.remove('status-pending', 'status-sent', 'status-delivered', 'status-read');
      msgDiv.classList.add('status-' + status);
    }
  } catch (e) {
    console.warn('[MAIN] _updateMessageStatus error:', e);
  }
}

/* FIX: setProperty con !important para sobreescribir CSS inline del HTML */
function _toggleVaultUI(isOpen) {
  try {
    var vault = document.getElementById('vault-panel');
    var stream = document.getElementById('nexo-stream');
    if (vault) {
      vault.classList.toggle('vault-hidden', !isOpen);
      vault.classList.toggle('vault-visible', isOpen);
      if (isOpen) {
        vault.style.setProperty('display', 'flex', 'important');
        vault.style.setProperty('visibility', 'visible', 'important');
        vault.style.setProperty('opacity', '1', 'important');
        vault.style.setProperty('pointer-events', 'auto', 'important');
        vault.style.setProperty('position', 'relative', 'important');
        vault.style.setProperty('z-index', '1', 'important');
      } else {
        vault.style.setProperty('display', 'none', 'important');
        vault.style.setProperty('visibility', 'hidden', 'important');
        vault.style.setProperty('opacity', '0', 'important');
        vault.style.setProperty('pointer-events', 'none', 'important');
        vault.style.setProperty('position', 'absolute', 'important');
        vault.style.setProperty('z-index', '-9999', 'important');
      }
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

/* =================================================================
   FIX v9.9: chat-view-active agregado/quitado en body
   FIX v9.9.1: back button limpia header correctamente
   ================================================================= */
function _setupBackButton() {
  try {
    var backBtn = document.getElementById('chat-back-btn');
    if (!backBtn) return;

    window.addEventListener('nexo:ble:openChat', function() {
      backBtn.classList.add('visible');
      document.body.classList.add('chat-view-active');
    });

    window.addEventListener('nexo:ble:closeChat', function() {
      backBtn.classList.remove('visible');
      document.body.classList.remove('chat-view-active');
    });

    backBtn.addEventListener('click', function() {
      backBtn.classList.remove('visible');
      document.body.classList.remove('chat-view-active');
      
      /* FIX v9.9.1: Limpiar header del chat al regresar */
      var nameInput = document.getElementById('chat-contact-name');
      var subtitle = document.getElementById('chat-contact-subtitle');
      if (nameInput) nameInput.value = 'NEXO';
      if (subtitle) subtitle.textContent = '';
      
      if (window.bleInterface && typeof window.bleInterface.togglePanel === 'function') {
        window.bleInterface.togglePanel();
      }
      
      if (window.NEXO.app) {
        window.NEXO.app.activeContact = null;
      }
      if (window.NEXO.app && window.NEXO.app.bleInterface) {
        window.NEXO.app.bleInterface._activeChatDeviceId = null;
        window.NEXO.app.bleInterface._activeChatMAC = null;
      }
    });
  } catch (e) {
    console.warn('[MAIN] _setupBackButton error:', e);
  }
}

window.NEXO_updateMessageStatus = _updateMessageStatus;

if (module && module.hot) module.hot.accept();
