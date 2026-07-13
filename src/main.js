/**
 * src/main.js - Punto de entrada NEXO v9.9-FIX
 * FIX: chat-view-active agregado/quitado en body para mostrar messages-container e input-area
 * FIX v9.9.1: FAB = boton agregar contacto (+) → panel BLE + auto-scan
 * FIX v9.9.2: Logo path corregido al iniciar
 * FIX v10.0: Swipe back con animacion desde borde izquierdo
 * FIX v10.1: Attachment handlers registrados inmediatamente en DOMContentLoaded
 * FIX v10.2: _sendAttachment renderiza localmente + _renderMessage soporta imagenes
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

// === ATTACHMENT HANDLERS GLOBALES (registran inmediatamente) ===
var _mediaRecorder = null;
var _audioChunks = [];
var _isRecording = false;

function _getAttachmentPlugins() {
  var Plugins = window.Capacitor ? window.Capacitor.Plugins : null;
  return {
    Camera: Plugins ? Plugins.Camera : null,
    Filesystem: Plugins ? Plugins.Filesystem : null,
    Geolocation: Plugins ? Plugins.Geolocation : null
  };
}

function _showAttachmentToast(msg) {
  if (window.NexoApp && window.NexoApp.showToast) {
    window.NexoApp.showToast(msg);
  } else {
    alert(msg);
  }
}

function _getCurrentContactId() {
  if (window.NEXO.app && window.NEXO.app.activeContact) {
    return window.NEXO.app.activeContact.nexoId || window.NEXO.app.activeContact.id;
  }
  return null;
}

function _sendAttachment(type, payload, meta) {
  var contactId = _getCurrentContactId();
  if (!contactId) {
    _showAttachmentToast('No hay contacto seleccionado');
    return;
  }

  var attachmentData = {
    type: 'attachment',
    attachmentType: type,
    payload: payload,
    meta: meta,
    timestamp: Date.now()
  };

  var msgId = 'att_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
  var localMsg = {
    messageId: msgId,
    content: JSON.stringify(attachmentData),
    _own: true,
    status: 'pending',
    timestamp: Date.now(),
    attachmentType: type,
    attachmentPayload: payload,
    attachmentMeta: meta
  };

  // Renderizar localmente INMEDIATAMENTE
  _renderMessage(localMsg);

  // Enviar via BLE
  var payloadStr = JSON.stringify(attachmentData);
  if (window.bleInterface && window.bleInterface.sendChatMessage) {
    window.bleInterface.sendChatMessage(contactId, payloadStr);
  } else if (window.NEXO.app && window.NEXO.app.sendMessage) {
    window.NEXO.app.sendMessage({ content: payloadStr });
  } else {
    _showAttachmentToast('Sistema de mensajes no disponible');
  }
}

function _toggleAttachMenu() {
  var menu = document.getElementById('attach-menu');
  if (menu) menu.classList.toggle('hidden');
}

function _closeAttachMenu() {
  var menu = document.getElementById('attach-menu');
  if (menu) menu.classList.add('hidden');
}

async function _handleCamera() {
  _closeAttachMenu();
  var plugins = _getAttachmentPlugins();
  if (!plugins.Camera) { _showAttachmentToast('Plugin Camera no disponible'); return; }
  try {
    var photo = await plugins.Camera.getPhoto({ quality: 85, allowEditing: false, resultType: 'base64', source: 'CAMERA', saveToGallery: false });
    if (photo.base64String) {
      _sendAttachment('image', photo.base64String, { format: photo.format || 'jpeg', width: photo.width, height: photo.height });
      _showAttachmentToast('Foto preparada');
    }
  } catch (err) { console.log('[ATTACH:CAMERA]', err.message); }
}

async function _handleGallery() {
  _closeAttachMenu();
  var plugins = _getAttachmentPlugins();
  if (!plugins.Camera) { _showAttachmentToast('Plugin Camera no disponible'); return; }
  try {
    var photo = await plugins.Camera.getPhoto({ quality: 85, allowEditing: false, resultType: 'base64', source: 'PHOTOS', saveToGallery: false });
    if (photo.base64String) {
      _sendAttachment('image', photo.base64String, { format: photo.format || 'jpeg', width: photo.width, height: photo.height });
      _showAttachmentToast('Foto preparada');
    }
  } catch (err) { console.log('[ATTACH:GALLERY]', err.message); }
}

async function _handleVideo() {
  _closeAttachMenu();
  var plugins = _getAttachmentPlugins();
  if (!plugins.Camera) { _showAttachmentToast('Plugin Camera no disponible'); return; }
  try {
    var video = await plugins.Camera.getPhoto({ quality: 80, allowEditing: false, resultType: 'uri', source: 'prompt', saveToGallery: false });
    if (video.path || video.webPath) {
      var uri = video.path || video.webPath;
      if (plugins.Filesystem) {
        var file = await plugins.Filesystem.readFile({ path: uri });
        _sendAttachment('video', file.data, { format: 'mp4', uri: uri });
      } else {
        _sendAttachment('video', uri, { format: 'mp4', uri: uri });
      }
      _showAttachmentToast('Video preparado');
    }
  } catch (err) { console.log('[ATTACH:VIDEO]', err.message); }
}

function _handleFile() {
  _closeAttachMenu();
  var input = document.createElement('input');
  input.type = 'file';
  input.accept = '*/*';
  input.style.display = 'none';
  input.onchange = function(e) {
    var file = e.target.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function(evt) {
      var base64 = evt.target.result.split(',')[1];
      _sendAttachment('file', base64, { name: file.name, size: file.size, type: file.type });
      _showAttachmentToast('Archivo: ' + file.name);
    };
    reader.readAsDataURL(file);
  };
  document.body.appendChild(input);
  input.click();
  setTimeout(function() { input.remove(); }, 1000);
}

async function _handleLocation() {
  _closeAttachMenu();
  var plugins = _getAttachmentPlugins();
  if (!plugins.Geolocation) { _showAttachmentToast('Plugin Geolocation no disponible'); return; }
  try {
    var pos = await plugins.Geolocation.getCurrentPosition({ enableHighAccuracy: true, timeout: 10000 });
    var payload = JSON.stringify({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy });
    _sendAttachment('location', payload, { lat: pos.coords.latitude, lng: pos.coords.longitude });
    _showAttachmentToast('Ubicacion enviada');
  } catch (err) { console.log('[ATTACH:LOCATION]', err.message); _showAttachmentToast('No se pudo obtener ubicacion'); }
}

async function _handleVoiceToggle() {
  if (!_isRecording) {
    try {
      var stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      _mediaRecorder = new MediaRecorder(stream);
      _audioChunks = [];
      _mediaRecorder.ondataavailable = function(e) { if (e.data.size > 0) _audioChunks.push(e.data); };
      _mediaRecorder.onstop = function() {
        var blob = new Blob(_audioChunks, { type: 'audio/webm' });
        var reader = new FileReader();
        reader.onloadend = function() {
          var base64 = reader.result.split(',')[1];
          _sendAttachment('audio', base64, { format: 'webm', duration: 0 });
          _showAttachmentToast('Audio enviado');
        };
        reader.readAsDataURL(blob);
        stream.getTracks().forEach(function(t) { t.stop(); });
      };
      _mediaRecorder.start();
      _isRecording = true;
      _updateMicIcon(true);
      _showAttachmentToast('Grabando...');
    } catch (err) { console.log('[ATTACH:VOICE]', err.message); _showAttachmentToast('Permiso de microfono denegado'); }
  } else {
    if (_mediaRecorder && _mediaRecorder.state !== 'inactive') _mediaRecorder.stop();
    _isRecording = false;
    _updateMicIcon(false);
  }
}

function _updateMicIcon(recording) {
  var micBtn = document.getElementById('send-btn');
  if (micBtn) micBtn.style.color = recording ? '#FF3B30' : '';
}

function _bindAttachmentHandlers() {
  var attachBtn = document.getElementById('attach-btn');
  var sendBtn = document.getElementById('send-btn');
  var menuItems = document.querySelectorAll('.attach-menu-item');
  var input = document.getElementById('message-input');

  if (attachBtn) {
    attachBtn.addEventListener('click', function(e) {
      e.preventDefault();
      e.stopPropagation();
      _toggleAttachMenu();
    });
  }

  menuItems.forEach(function(item) {
    item.addEventListener('click', function(e) {
      e.preventDefault();
      e.stopPropagation();
      var type = item.getAttribute('data-type');
      if (type === 'camera') _handleCamera();
      else if (type === 'gallery') _handleGallery();
      else if (type === 'video') _handleVideo();
      else if (type === 'file') _handleFile();
      else if (type === 'location') _handleLocation();
    });
  });

  if (sendBtn) {
    sendBtn.addEventListener('click', function(e) {
      var text = input ? input.value.trim() : '';
      if (!text && sendBtn.classList.contains('mic-mode')) {
        e.preventDefault();
        e.stopPropagation();
        _handleVoiceToggle();
      }
    });
  }
}
// === FIN ATTACHMENT HANDLERS ===

document.addEventListener('DOMContentLoaded', async function() {
  // Bind attachment handlers INMEDIATAMENTE, no esperar a initializeNexoApp
  _bindAttachmentHandlers();

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
        <h2>🔐 Permisos BLE Requeridos</h2>
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
          }
        } catch (e) {}
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
    } catch (timeoutErr) {}

    window.NEXO.initialized = true;
    clearTimeout(SAFETY_TIMEOUT);

    try {
      if (window.NEXO.app && window.NEXO.app.bleInterface) {
        var bi = window.NEXO.app.bleInterface;
        console.log('[MAIN] BLE Interface estado:', {
          localUUID: bi.localDeviceUUID,
          activeChatId: bi._activeChatDeviceId,
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

    // Send text message
    var send = async function() {
      var text = input.value.trim();
      if (!text) return;
      input.value = '';
      input.focus();
      try {
        if (!window.NEXO.app) return;
        var sent = await window.NEXO.app.sendMessage({ content: text });
      } catch (e) {}
    };

    btn.addEventListener('click', function(e) {
      var text = input.value.trim();
      if (!text && btn.classList.contains('mic-mode')) {
        e.preventDefault();
        e.stopPropagation();
        _handleVoiceToggle();
      } else {
        send();
      }
    });

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

function _setupFABButton() {
  try {
    var fabBtn = document.getElementById('ble-fab-btn');
    if (!fabBtn) return;

    fabBtn.innerHTML = '<svg viewBox="0 0 24 24" width="28" height="28" fill="#fff"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>';

    var newFab = fabBtn.cloneNode(true);
    fabBtn.parentNode.replaceChild(newFab, fabBtn);

    newFab.addEventListener('click', function() {
      if (window.bleInterface && window.bleInterface.elements) {
        var panel = window.bleInterface.elements.panel;
        var overlay = window.bleInterface.elements.overlay;
        if (panel) panel.classList.add('active');
        if (overlay) overlay.classList.add('active');
      }
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
    } else if (window.NEXO.app && window.NEXO.app.bleInterface && window.NEXO.app.bleInterface._activeChatDeviceId) {
      contactId = window.NEXO.app.bleInterface._activeChatDeviceId;
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

    // Detectar attachment en msg directo o en content JSON
    var attachment = null;
    if (msg.attachmentType && msg.attachmentPayload) {
      attachment = {
        type: msg.attachmentType,
        payload: msg.attachmentPayload,
        meta: msg.attachmentMeta || {}
      };
    } else if (msg.content && msg.content.indexOf('"attachmentType"') > -1) {
      try {
        var parsed = JSON.parse(msg.content);
        if (parsed && parsed.type === 'attachment' && parsed.attachmentType) {
          attachment = {
            type: parsed.attachmentType,
            payload: parsed.payload,
            meta: parsed.meta || {}
          };
        }
      } catch (e) {}
    }

    if (!msg._own && msg.content && !attachment) {
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
    if (isOwn) div.classList.add('status-' + (msg.status || 'pending'));
    div.dataset.msgId = msgId;

    var contentDiv = document.createElement('div');
    contentDiv.className = 'msg-content';

    if (attachment) {
      // Renderizar attachment
      if (attachment.type === 'image') {
        var img = document.createElement('img');
        img.src = 'data:image/' + (attachment.meta.format || 'jpeg') + ';base64,' + attachment.payload;
        img.style.maxWidth = '220px';
        img.style.maxHeight = '280px';
        img.style.borderRadius = '12px';
        img.style.display = 'block';
        img.onload = function() {
          var mc = document.getElementById('messages-container');
          if (mc) mc.scrollTop = mc.scrollHeight;
        };
        contentDiv.appendChild(img);
      } else if (attachment.type === 'video') {
        contentDiv.innerHTML = '<div style="padding:8px 12px;background:rgba(0,0,0,0.3);border-radius:10px;">🎬 <b>Video</b><br><span style="font-size:12px;opacity:0.7;">' + (attachment.meta.name || 'video.mp4') + '</span></div>';
      } else if (attachment.type === 'file') {
        contentDiv.innerHTML = '<div style="padding:8px 12px;background:rgba(0,0,0,0.3);border-radius:10px;">📎 <b>Archivo</b><br><span style="font-size:12px;opacity:0.7;">' + (attachment.meta.name || 'archivo') + '</span></div>';
      } else if (attachment.type === 'location') {
        var loc = attachment.meta;
        contentDiv.innerHTML = '<div style="padding:8px 12px;background:rgba(0,0,0,0.3);border-radius:10px;">📍 <b>Ubicación</b><br><span style="font-size:12px;opacity:0.7;">' + (loc.lat ? loc.lat.toFixed(4) : '?') + ', ' + (loc.lng ? loc.lng.toFixed(4) : '?') + '</span></div>';
      } else if (attachment.type === 'audio') {
        contentDiv.innerHTML = '<div style="padding:8px 12px;background:rgba(0,0,0,0.3);border-radius:10px;">🎤 <b>Audio</b></div>';
      } else {
        contentDiv.textContent = msg.content || msg.text || '';
      }
    } else {
      contentDiv.textContent = msg.content || msg.text || '';
    }
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
    container.appendChild(div);

    var msgContainer = document.getElementById('messages-container');
    if (msgContainer) {
      requestAnimationFrame(function() {
        msgContainer.scrollTop = msgContainer.scrollHeight;
      });
    }

    if (!skipSave) _saveMessageToStorage(msg);
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
      _doChatBack();
    });

    _setupSwipeBack();

  } catch (e) {
    console.warn('[MAIN] _setupBackButton error:', e);
  }
}

function _setupSwipeBack() {
  try {
    var SWIPE_EDGE_WIDTH = 40;
    var SWIPE_THRESHOLD = 0.30;
    var startX = 0;
    var startY = 0;
    var currentX = 0;
    var isDragging = false;
    var isHorizontal = false;
    var winWidth = window.innerWidth;

    var app = document.getElementById('app');
    if (!app) return;

    function onTouchStart(e) {
      if (!document.body.classList.contains('chat-view-active')) return;
      var touch = e.touches[0];
      if (touch.clientX > SWIPE_EDGE_WIDTH) return;
      startX = touch.clientX;
      startY = touch.clientY;
      currentX = startX;
      isDragging = true;
      isHorizontal = false;
      winWidth = window.innerWidth;
    }

    function onTouchMove(e) {
      if (!isDragging) return;
      var touch = e.touches[0];
      currentX = touch.clientX;
      var deltaX = currentX - startX;
      var deltaY = touch.clientY - startY;

      if (!isHorizontal) {
        if (Math.abs(deltaX) > Math.abs(deltaY) && deltaX > 10) {
          isHorizontal = true;
          document.body.classList.add('chat-swipe-dragging');
          e.preventDefault();
        } else if (Math.abs(deltaY) > 10) {
          isDragging = false;
          return;
        }
      }

      if (!isHorizontal) return;

      var translateX = Math.max(0, Math.min(deltaX, winWidth));
      var progress = translateX / winWidth;

      if (progress > 0.5) {
        translateX = winWidth * 0.5 + (translateX - winWidth * 0.5) * 0.4;
      }

      app.style.transform = 'translateX(' + translateX + 'px)';
      app.style.opacity = Math.max(0.4, 1 - (progress * 0.5));

      var contactsView = document.getElementById('contacts-view');
      if (contactsView) {
        contactsView.style.display = 'flex';
        contactsView.style.opacity = Math.min(1, progress * 2);
        contactsView.style.transform = 'translateX(' + (-20 + progress * 20) + '%)';
      }

      e.preventDefault();
    }

    function onTouchEnd(e) {
      if (!isDragging || !isHorizontal) {
        isDragging = false;
        isHorizontal = false;
        return;
      }

      var deltaX = currentX - startX;
      var progress = deltaX / winWidth;
      var threshold = winWidth * SWIPE_THRESHOLD;

      document.body.classList.remove('chat-swipe-dragging');

      if (deltaX > threshold) {
        document.body.classList.add('chat-swipe-complete');
        document.body.classList.add('chat-swipe-transition');

        setTimeout(function() {
          _doChatBack();
          app.style.transform = '';
          app.style.opacity = '';
          document.body.classList.remove('chat-swipe-complete');
          document.body.classList.remove('chat-swipe-transition');
          var contactsView = document.getElementById('contacts-view');
          if (contactsView) {
            contactsView.style.transform = '';
            contactsView.style.opacity = '';
          }
        }, 350);
      } else {
        document.body.classList.add('chat-swipe-rebound');
        document.body.classList.add('chat-swipe-transition');

        setTimeout(function() {
          document.body.classList.remove('chat-swipe-rebound');
          document.body.classList.remove('chat-swipe-transition');
          app.style.transform = '';
          app.style.opacity = '';
          var contactsView = document.getElementById('contacts-view');
          if (contactsView) {
            contactsView.style.transform = '';
            contactsView.style.opacity = '';
          }
        }, 250);
      }

      isDragging = false;
      isHorizontal = false;
    }

    function onTouchCancel(e) {
      if (!isDragging) return;
      isDragging = false;
      isHorizontal = false;
      document.body.classList.remove('chat-swipe-dragging');
      app.style.transform = '';
      app.style.opacity = '';
      var contactsView = document.getElementById('contacts-view');
      if (contactsView) {
        contactsView.style.transform = '';
        contactsView.style.opacity = '';
      }
    }

    document.addEventListener('touchstart', onTouchStart, { passive: true });
    document.addEventListener('touchmove', onTouchMove, { passive: false });
    document.addEventListener('touchend', onTouchEnd, { passive: true });
    document.addEventListener('touchcancel', onTouchCancel, { passive: true });

  } catch (e) {
    console.warn('[MAIN] _setupSwipeBack error:', e);
  }
}

function _doChatBack() {
  try {
    var backBtn = document.getElementById('chat-back-btn');
    if (backBtn) backBtn.classList.remove('visible');
    document.body.classList.remove('chat-view-active');

    var nameInput = document.getElementById('chat-contact-name');
    var subtitle = document.getElementById('chat-contact-subtitle');
    if (nameInput) nameInput.value = 'NEXO';
    if (subtitle) subtitle.textContent = '';

    var blePanel = document.getElementById('ble-panel');
    var bleOverlay = document.getElementById('ble-overlay');
    if (blePanel) blePanel.classList.remove('active');
    if (bleOverlay) bleOverlay.classList.remove('active');

    try {
      window.dispatchEvent(new CustomEvent('nexo:ble:closeChat', { detail: {} }));
    } catch(e) {}

    if (window.NEXO.app) {
      window.NEXO.app.activeContact = null;
    }
    if (window.NEXO.app && window.NEXO.app.bleInterface) {
      window.NEXO.app.bleInterface._activeChatDeviceId = null;
    }
  } catch (e) {
    console.warn('[MAIN] _doChatBack error:', e);
  }
}

window.NEXO_updateMessageStatus = _updateMessageStatus;

if (module && module.hot) module.hot.accept();
