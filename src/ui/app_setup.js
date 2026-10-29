/**
 * NEXO — Preparar la interfaz (sacado de main.js en la ronda 2752, sin cambios en su código): cuadro de texto y botón de
 * enviar (con respuesta y micrófono), cabecera del chat, menú de adjuntar, atajos, botones, pantalla de permisos,
 * pantalla de carga y modo de emergencia. initializeNexoApp lo da main.js con appSetupUse().
 */
import { _bindCameraPreviewHandlers, _handleCamera } from './camera.js';
import { _cancelReply, _cancelEdit, _editForAll, _editing, _replyTo } from './chat_actions.js';
import { _closeAttachMenu, _toggleAttachMenu } from './ui_bits.js';
import { _getCurrentContactId, _peerUnderstands } from './chat_format.js';
import { _handleFile, _handleGallery } from './pickers.js';
import { _handleLocation } from './location.js';
import { _handleCobro } from './cobro.js';
import { _handleShareContacts } from './share_contacts.js';
import { _handleVoiceToggle } from './voice.js';
import { _msgContactMap } from './chat_state.js';
import { _noteContactMessage } from './send.js';
import { _renderMessage, _updateMessageStatus, _updateMessageStorageStatus } from './render.js';
import { _failStatus } from './ble_helpers.js';
import { openStickerPicker } from './stickers.js';
import { openTttForContact } from './ttt.js';
import { getPermissionShim } from '../core/NexoPermissionShim.js';
import { rem } from './rem.js';
import { vaultFindContactByNexoId, vaultSaveContact } from '../vault/vault_manager.js';

// [pegamento] Lo que usa del resto de la app (main.js lo da al arrancar)
var initializeNexoApp;
export function appSetupUse(d) { initializeNexoApp = d.initializeNexoApp; } // [/pegamento]


// Stickers (2829): manda un sticker como mensaje VISIBLE normal — por el cable va solo el ID
// ({type:'nexo_sticker', s:id}); el dibujo es un SVG incorporado (stickers.js). Mismo camino que _doSend (texto),
// sin adjuntos ni base64. En grupo va a cada miembro con una vista previa «🎟️ Sticker».
export async function _sendStickerTo(cid, id) {
  var chatContactId = cid || _getCurrentContactId();
  if (!chatContactId || !id) return;
  var wire = JSON.stringify({ type: 'nexo_sticker', s: String(id) });
  var msgId = 'msg' + Date.now() + '' + Math.random().toString(36).substr(2, 9);
  var seq = (window.bleInterface && typeof window.bleInterface.getNextSeq === 'function') ? window.bleInterface.getNextSeq() : 0;
  _msgContactMap[msgId] = chatContactId;
  var gsx = window.bleInterface && window.bleInterface.groups;
  if (gsx && gsx.isGroup(chatContactId) && typeof window.NEXO_sendGroupText === 'function') {
    window.NEXO_sendGroupText(chatContactId, wire, '🎟️ Sticker', 'gm' + msgId.substring(3));
    return;
  }
  var vaultMsg = { msgId: msgId, messageId: msgId, contactNexoId: chatContactId, content: wire, _own: true, status: 'sending', timestamp: Date.now(), seq: seq };
  _renderMessage(vaultMsg);
  _noteContactMessage(chatContactId, '🎟️ Sticker', vaultMsg.timestamp);
  _updateMessageStatus(msgId, 'sending');
  _updateMessageStorageStatus(msgId, 'sending');
  try {
    await window.NEXO.app.sendMessage({ content: wire, msgId: msgId, messageId: msgId, seq: seq });
    window._sentFallbackTimers = window._sentFallbackTimers || {};
    window._sentFallbackTimers[msgId] = setTimeout(function() {
      _updateMessageStatus(msgId, 'sent');
      _updateMessageStorageStatus(msgId, 'sent');
      delete window._sentFallbackTimers[msgId];
    }, 12000);
  } catch (e) {
    if (window._sentFallbackTimers && window._sentFallbackTimers[msgId]) {
      clearTimeout(window._sentFallbackTimers[msgId]);
      delete window._sentFallbackTimers[msgId];
    }
    var st = _failStatus(e);
    _updateMessageStatus(msgId, st);
    _updateMessageStorageStatus(msgId, st);
  }
}
// Gancho de pruebas (tests/sim/stickers.js) y acceso directo del selector.
try { if (typeof window !== 'undefined') window.__nexoSendSticker = _sendStickerTo; } catch (e) {}


export function _bindAttachmentHandlers() {
  _bindCameraPreviewHandlers();
  var attachBtn = document.getElementById('attach-btn');
  var menuItems = document.querySelectorAll('.attach-menu-item');
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
      else if (type === 'file') _handleFile();
      else if (type === 'location') _handleLocation();
      else if (type === 'cobro') _handleCobro();
      else if (type === 'contact') _handleShareContacts();
      else if (type === 'sticker') { _closeAttachMenu(); openStickerPicker(_getCurrentContactId(), _sendStickerTo); }
      else if (type === 'ttt') { _closeAttachMenu(); openTttForContact(_getCurrentContactId()); }
    });
  });
  document.addEventListener('click', function(e) {
    var menu = document.getElementById('attach-menu');
    var attachBtn = document.getElementById('attach-btn');
    if (menu && !menu.classList.contains('hidden') &&
        !menu.contains(e.target) &&
        e.target !== attachBtn &&
        !attachBtn.contains(e.target)) {
      _closeAttachMenu();
    }
  });
}

export function _showPermissionOverlay() {
  try {
    if (document.getElementById('nexo-perm-overlay')) return;
    var overlay = document.createElement('div');
    overlay.id = 'nexo-perm-overlay';
    overlay.innerHTML = '<div class="perm-overlay-content"> <h2>Permisos necesarios</h2> <p>NEXO necesita el Bluetooth y «Dispositivos cercanos» para hablar con otros teléfonos sin internet.</p> <p class="perm-sub">Si ya los diste en Ajustes, la app seguirá sola.</p> <button id="perm-btn-grant" class="perm-btn-primary">Dar permisos</button> <button id="perm-btn-settings" class="perm-btn-secondary">Abrir Ajustes</button> <button id="perm-btn-skip" class="perm-btn-ghost">Seguir sin Bluetooth</button> </div>';
    document.body.appendChild(overlay);
    var style = document.createElement('style');
    style.id = 'perm-overlay-styles';
    style.textContent = '#nexo-perm-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.92); z-index: 2147483647; display: flex; align-items: center; justify-content: center; backdrop-filter: blur(8px); } .perm-overlay-content { background: #0a0a15; border: 1px solid #00d4ff; border-radius: 16px; padding: 32px; max-width: 360px; width: 90%; text-align: center; color: #fff; box-shadow: 0 0 40px rgba(0,212,255,0.15); } .perm-overlay-content h2 { margin: 0 0 12px; font-size: 20px; color: #00d4ff; } .perm-overlay-content p { margin: 0 0 8px; font-size: 14px; color: #ccc; line-height: 1.5; } .perm-sub { font-size: 12px !important; color: #888 !important; font-style: italic; } .perm-btn-primary { display: block; width: 100%; margin: 16px 0 8px; padding: 14px; background: linear-gradient(135deg,#00d4ff,#0099cc); color: #000; border: none; border-radius: 10px; font-weight: 700; font-size: 15px; cursor: pointer; } .perm-btn-secondary { display: block; width: 100%; margin: 0 0 8px; padding: 12px; background: transparent; color: #00d4ff; border: 1px solid #00d4ff; border-radius: 10px; font-weight: 600; font-size: 14px; cursor: pointer; } .perm-btn-ghost { display: block; width: 100%; margin: 0; padding: 10px; background: transparent; color: #666; border: none; font-size: 13px; cursor: pointer; } .perm-btn-primary:hover { box-shadow: 0 0 20px rgba(0,212,255,0.3); }';
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
          alert('Ve a Ajustes > Aplicaciones > NEXO > Permisos\nActiva «Dispositivos cercanos» y «Bluetooth»');
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

export function _hidePermissionOverlay() {
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

export function _ensureDOMStructure() {
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

export function _fixLogoPath() {
  try {
    var logo = document.getElementById('main-logo');
    if (logo) {
      logo.style.backgroundImage = 'url(\"./assets/nexo_logo.png\")';
      logo.style.backgroundSize = 'contain';
      logo.style.backgroundRepeat = 'no-repeat';
      logo.style.backgroundPosition = 'center';
    }
  } catch (e) {
    console.warn('[MAIN] _fixLogoPath error:', e);
  }
}

export function _setupMessageInput() {
  try {
    var input = document.getElementById('message-input');
    var btn = document.getElementById('send-btn');
    if (!input || !btn || !window.NEXO.app) return;
    var _isComposing = false;
    var _longPressTimer = null;
    var _isLongPress = false;
    var LONG_PRESS_MS = 600;

    var charCounter = document.getElementById('char-counter');
    if (!charCounter && input.parentNode) {
      charCounter = document.createElement('span');
      charCounter.id = 'char-counter';
      charCounter.style.cssText = 'position:absolute;right:60px;bottom:6px;font-size:11px;color:#888;pointer-events:none;transition:color 0.2s;';
      input.parentNode.style.position = 'relative';
      input.parentNode.appendChild(charCounter);
    }

    function _updateBtnState() {
      var hasText = input.value.trim().length > 0;
      btn.classList.toggle('mic-mode', !hasText);
      if (charCounter) {
        var len = input.value.length;
        charCounter.textContent = len > 0 ? len + ' chars' : '';
        charCounter.style.color = len > 180 ? '#FFC107' : '#888';
      }
    }
    _updateBtnState();

    var _doSend = async function() {
      var text = input.value.trim();
      if (!text) return;
      input.value = '';
      _updateBtnState();
      input.focus();
      // Ronda 2782: si estamos editando un mensaje, mandar la edición en vez de crear uno nuevo
      if (_editing && _editing.id) { _editForAll(_editing.cid, _editing.id, text); _cancelEdit(); return; }
      var msgId = 'msg' + Date.now() + '' + Math.random().toString(36).substr(2, 9);
      var seq = (window.bleInterface && typeof window.bleInterface.getNextSeq === 'function') ? window.bleInterface.getNextSeq() : 0;
      // FIX v9.9.26: sin contactNexoId el mensaje propio no se guardaba en el vault (desaparecía al
      // reabrir el chat y la cola de reenvío no lo veía).
      var chatContactId = _getCurrentContactId();
      if (chatContactId) _msgContactMap[msgId] = chatContactId;
      // Ronda 2758: en un grupo, a cada miembro (groups_ui.js)
      var gsx = window.bleInterface && window.bleInterface.groups;
      if (gsx && gsx.isGroup(chatContactId) && typeof window.NEXO_sendGroupText === 'function') {
        var gwire = _replyTo ? JSON.stringify({ type: 'nexo_txt', t: text, rp: _replyTo }) : text;
        _cancelReply();
        window.NEXO_sendGroupText(chatContactId, gwire, text, 'gm' + msgId.substring(3));
        return;
      }
      // v9.9.45: respuesta a una burbuja (solo si el otro la entiende; si no, va el texto solo)
      var wire = text;
      if (_replyTo && _peerUnderstands(chatContactId)) wire = JSON.stringify({ type: 'nexo_txt', t: text, rp: _replyTo });
      _cancelReply();
      var vaultMsg = {
        msgId: msgId,
        messageId: msgId,
        contactNexoId: chatContactId,
        content: wire,
        _own: true,
        status: 'sending',
        timestamp: Date.now(),
        seq: seq
      };
      _renderMessage(vaultMsg);
      _noteContactMessage(chatContactId, text, vaultMsg.timestamp);
      _updateMessageStatus(msgId, 'sending');
      _updateMessageStorageStatus(msgId, 'sending');
      try {
        await window.NEXO.app.sendMessage({ content: wire, msgId: msgId, messageId: msgId, seq: seq });
        window._sentFallbackTimers = window._sentFallbackTimers || {};
        window._sentFallbackTimers[msgId] = setTimeout(function() {
          _updateMessageStatus(msgId, 'sent');
          _updateMessageStorageStatus(msgId, 'sent');
          delete window._sentFallbackTimers[msgId];
        }, 12000);
      } catch (e) {
        console.warn('[MAIN] sendMessage failed:', e.message);
        if (window._sentFallbackTimers && window._sentFallbackTimers[msgId]) {
          clearTimeout(window._sentFallbackTimers[msgId]);
          delete window._sentFallbackTimers[msgId];
        }
        // Ronda 2767: si se espera a un camino (sin clave aún, contacto ausente, Wi-Fi cortado) queda pendiente, sin "!"
        var st = _failStatus(e);
        _updateMessageStatus(msgId, st);
        _updateMessageStorageStatus(msgId, st);
      }
    };

    input.addEventListener('input', _updateBtnState);
    input.addEventListener('keyup', _updateBtnState);
    input.addEventListener('paste', function() { requestAnimationFrame(_updateBtnState); });
    input.addEventListener('cut', function() { requestAnimationFrame(_updateBtnState); });
    input.addEventListener('compositionstart', function() { _isComposing = true; });
    input.addEventListener('compositionend', function() {
      _isComposing = false;
      _updateBtnState();
    });
    input.addEventListener('keydown', function(e) {
      if (e.key === 'Enter' && !_isComposing) {
        e.preventDefault();
        _doSend();
      }
    });
    btn.addEventListener('click', function(e) {
      if (_isLongPress) {
        _isLongPress = false;
        return;
      }
      var text = input.value.trim();
      if (text) {
        e.preventDefault();
        e.stopPropagation();
        _doSend();
      } else {
        e.preventDefault();
        e.stopPropagation();
        _handleVoiceToggle();
      }
    });
    btn.addEventListener('touchstart', function(e) {
      if (!btn.classList.contains('mic-mode')) return;
      _isLongPress = false;
      _longPressTimer = setTimeout(function() {
        _isLongPress = true;
        _handleVoiceToggle();
      }, LONG_PRESS_MS);
    }, { passive: true });
    btn.addEventListener('touchend', function() {
      if (_longPressTimer) { clearTimeout(_longPressTimer); _longPressTimer = null; }
    });
    btn.addEventListener('touchcancel', function() {
      if (_longPressTimer) { clearTimeout(_longPressTimer); _longPressTimer = null; }
    });
    window.addEventListener('resize', function() {
      var s = document.getElementById('messages-container');
      if (s) requestAnimationFrame(function() { s.scrollTop = s.scrollHeight; });
    });
    input.focus();
  } catch (e) {
    console.warn('[MAIN] _setupMessageInput error:', e);
  }
}

export function _setupVaultToggle() {
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

export function _setupChatHeader() {
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
          window.NEXO.app.activeContact.displayName = newName;
        }
        try {
          var activeId = window.NEXO.app && window.NEXO.app.activeContact ? window.NEXO.app.activeContact.nexoId : null;
          var gsn = window.bleInterface && window.bleInterface.groups;
          if (activeId && gsn && gsn.isGroup(activeId)) { gsn.rename(activeId, newName); activeId = null; } // ronda 2758
          if (activeId) {
            var c = vaultFindContactByNexoId(activeId);
            if (c) {
              c.displayName = newName;
              c.name = newName;
              vaultSaveContact(c);
            }
          }
        } catch (e) {}
      } catch (saveErr) {
        console.warn('[main] Error guardando nombre editado:', saveErr);
      }
    };
    nameInput.addEventListener('blur', saveName);
    // El nombre es un <textarea> (puede ir en 2 líneas); Enter NO mete salto de línea: confirma y sale (rename).
    nameInput.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        nameInput.blur();
      }
    });
  } catch (e) {
    console.warn('[MAIN] _setupChatHeader error:', e);
  }
}

export function _setupKeyboardShortcuts() {
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

export function _setupJumpButton() {
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

export function _setupFABButton() {
  try {
    // ble_interface.js ya crea #ble-fab-btn y enlaza togglePanel.
    // NO añadir otro click aquí: provoca doble toggle.
    var fabBtn = document.getElementById('ble-fab-btn');
    if (!fabBtn) return;
  } catch (e) {
    console.warn('[MAIN] _setupFABButton error:', e);
  }
}

export function _toggleVaultUI(isOpen) {
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

export function _focusInput(text) {
  try {
    var input = document.getElementById('message-input');
    if (input) {
      input.focus();
      if (text) input.value = text;
    }
  } catch (e) {}
}

export function _forceHideSplash() {
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

export function _enableFallbackMode() {
  try {
    console.warn('[NEXO] Activando modo fallback');
    var body = document.body;
    body.classList.add('nexo-fallback-mode');
    var msg = document.createElement('div');
    msg.className = 'fallback-notice';
    msg.innerHTML = '<h3>⚠ Error de Inicializacion</h3> <p>La app no pudo iniciar completamente.</p>';
    body.appendChild(msg);
  } catch (e) {
    console.error('[MAIN] _enableFallbackMode error:', e);
  }
}
