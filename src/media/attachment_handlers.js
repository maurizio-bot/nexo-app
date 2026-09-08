// attachment_handlers.js — Cableado real a NEXOFileTransfer / NEXOPhotos / BLEInterface
(function() {
  'use strict';

  var attachBtn   = document.getElementById('attach-btn');
  var attachMenu  = document.getElementById('attach-menu');

  function getActiveContactId() {
    // 1) Desde NEXO app
    if (window.NEXO && window.NEXO.app && window.NEXO.app.activeContact) {
      return window.NEXO.app.activeContact.nexoId || window.NEXO.app.activeContact.deviceUUID;
    }
    // 2) Desde bleInterface
    if (window.bleInterface) {
      return window.bleInterface._activeChatDeviceId;
    }
    return null;
  }

  function resolveDeviceId(nexoId) {
    if (!window.bleInterface) return null;
    // Intentar por contacto
    var c = window.bleInterface.getContactByUUID && window.bleInterface.getContactByUUID(nexoId);
    if (c && c.deviceId) return c.deviceId;
    // Intentar por mapeo interno
    if (window.bleInterface._resolveDeviceIdForNexoId) {
      return window.bleInterface._resolveDeviceIdForNexoId(nexoId);
    }
    return nexoId;
  }

  function getMessagesContainer() {
    return document.getElementById('messages-container');
  }

  function scrollToBottom() {
    var c = getMessagesContainer();
    if (c) c.scrollTop = c.scrollHeight;
  }

  function renderAttachmentBubble(htmlContent, typeLabel, msgId) {
    var container = getMessagesContainer();
    if (!container) return null;
    var bubble = document.createElement('div');
    bubble.className = 'message own message-attachment';
    bubble.id = 'attach-' + (msgId || Date.now());
    bubble.style.cssText = 'align-self:flex-end;max-width:75%;margin:6px 16px 6px auto;padding:8px;border-radius:18px;background:linear-gradient(135deg,#0082FC,#6B4EFF);color:#E5E5E5;font-size:14px;word-break:break-word;box-shadow:0 2px 8px rgba(0,0,0,0.3);display:flex;flex-direction:column;gap:6px;';
    bubble.innerHTML = htmlContent +
      '<div class="attach-status" style="font-size:10px;opacity:0.7;text-align:right;margin-top:4px;">' + typeLabel + ' · Enviando...</div>';
    container.appendChild(bubble);
    scrollToBottom();
    return bubble;
  }

  function updateBubbleStatus(msgId, text) {
    var bubble = document.getElementById('attach-' + msgId);
    if (!bubble) return;
    var status = bubble.querySelector('.attach-status');
    if (status) status.textContent = text;
  }

  // ── 1. CÁMARA ──
  var btnCamera = document.querySelector('[data-type="camera"]');
  if (btnCamera) {
    btnCamera.addEventListener('click', function(e) {
      e.preventDefault(); e.stopPropagation();
      if (attachMenu) { attachMenu.classList.remove('visible'); attachMenu.classList.add('hidden'); }

      var contactId = getActiveContactId();
      var deviceId  = contactId ? resolveDeviceId(contactId) : null;
      if (!deviceId) { alert('No hay contacto activo'); return; }

      if (typeof window.NEXOPhotos === 'undefined') {
        alert('NEXOPhotos no cargado'); return;
      }

      window.NEXOPhotos.sendPhoto(deviceId, 'camera', {
        onThumbnail: function(msgId, data) {
          // Mostrar thumbnail inmediatamente
        },
        onProgress: function(msgId, progress) {
          updateBubbleStatus(msgId, '📷 Foto · ' + Math.round(progress) + '%');
        },
        onComplete: function(msgId, success, error) {
          updateBubbleStatus(msgId, success ? '📷 Foto · Enviada' : '📷 Foto · Error');
        }
      }).then(function(msgId) {
        renderAttachmentBubble('<div style="padding:8px;">📷 Foto</div>', '📷 Foto', msgId);
      }).catch(function(err) {
        console.error('[Attach] Cámara:', err);
        alert('Error foto: ' + err.message);
      });
    });
  }

  // ── 2. GALERÍA ──
  var btnGallery = document.querySelector('[data-type="gallery"]');
  if (btnGallery) {
    btnGallery.addEventListener('click', function(e) {
      e.preventDefault(); e.stopPropagation();
      if (attachMenu) { attachMenu.classList.remove('visible'); attachMenu.classList.add('hidden'); }

      var contactId = getActiveContactId();
      var deviceId  = contactId ? resolveDeviceId(contactId) : null;
      if (!deviceId) { alert('No hay contacto activo'); return; }

      if (typeof window.NEXOPhotos === 'undefined') {
        alert('NEXOPhotos no cargado'); return;
      }

      window.NEXOPhotos.sendPhoto(deviceId, 'gallery', {
        onProgress: function(msgId, progress) {
          updateBubbleStatus(msgId, '🖼️ Galería · ' + Math.round(progress) + '%');
        },
        onComplete: function(msgId, success, error) {
          updateBubbleStatus(msgId, success ? '🖼️ Galería · Enviada' : '🖼️ Galería · Error');
        }
      }).then(function(msgId) {
        renderAttachmentBubble('<div style="padding:8px;">🖼️ Foto</div>', '🖼️ Galería', msgId);
      }).catch(function(err) {
        console.error('[Attach] Galería:', err);
        alert('Error galería: ' + err.message);
      });
    });
  }

  // ── 3. ARCHIVO ──
  var btnFile = document.querySelector('[data-type="file"]');
  if (btnFile) {
    btnFile.addEventListener('click', function(e) {
      e.preventDefault(); e.stopPropagation();
      if (attachMenu) { attachMenu.classList.remove('visible'); attachMenu.classList.add('hidden'); }

      var contactId = getActiveContactId();
      var deviceId  = contactId ? resolveDeviceId(contactId) : null;
      if (!deviceId) { alert('No hay contacto activo'); return; }

      if (typeof window.NEXOFileTransfer === 'undefined') {
        alert('NEXOFileTransfer no cargado'); return;
      }

      var input = document.createElement('input');
      input.type = 'file';
      input.style.display = 'none';
      input.onchange = function(ev) {
        var file = ev.target.files[0];
        if (!file) return;
        if (file.size > 5242880) { alert('Máximo 5MB'); return; }

        var sizeStr = file.size > 1024*1024
          ? (file.size/(1024*1024)).toFixed(1) + ' MB'
          : (file.size/1024).toFixed(0) + ' KB';

        window.NEXOFileTransfer.sendFile(deviceId, file, {
          onProgress: function(msgId, progress) {
            updateBubbleStatus(msgId, '📎 ' + file.name + ' · ' + Math.round(progress) + '%');
          },
          onComplete: function(msgId, success, error) {
            updateBubbleStatus(msgId, success ? '📎 ' + file.name + ' · Enviado' : '📎 ' + file.name + ' · Error');
          }
        }).then(function(msgId) {
          var html = '<div style="display:flex;align-items:center;gap:10px;padding:8px;background:rgba(0,0,0,0.2);border-radius:10px;">' +
            '<div style="font-size:24px;">📄</div>' +
            '<div style="overflow:hidden;"><div style="font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:160px;">' + file.name + '</div>' +
            '<div style="font-size:11px;opacity:0.7;">' + sizeStr + '</div></div></div>';
          renderAttachmentBubble(html, '📎 Archivo', msgId);
        }).catch(function(err) {
          console.error('[Attach] Archivo:', err);
          alert('Error archivo: ' + err.message);
        });

        setTimeout(function() { if (input.parentNode) input.remove(); }, 5000);
      };
      document.body.appendChild(input);
      input.click();
    });
  }

  console.log('[attachment_handlers] Cableado real activo');
})();
