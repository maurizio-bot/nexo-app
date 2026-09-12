/**
 * attachment_handlers.js v2.3 — NEXOFileTransfer + NEXOPhotos + RECEPCION
 *
 * IMPORTANTE:
 * - No crea burbujas de envío propias.
 * - El estado de los mensajes de envío lo controla main.js.
 * - Mantiene recepción de archivos/fotos/audio y Vault.
 */
(function() {
  'use strict';
  var attachBtn = document.getElementById('attach-btn');
  var attachMenu = document.getElementById('attach-menu');
  function getActiveContactId() {
    if (window.NEXO && window.NEXO.app && window.NEXO.app.activeContact) {
      return window.NEXO.app.activeContact.nexoId || window.NEXO.app.activeContact.deviceUUID;
    }
    if (window.bleInterface) {
      return window.bleInterface._activeChatDeviceId;
    }
    return null;
  }
  function resolveDeviceId(nexoId) {
    if (!window.bleInterface) return null;
    var c = window.bleInterface.getContactByUUID && window.bleInterface.getContactByUUID(nexoId);
    if (c && c.deviceId) return c.deviceId;
    if (window.bleInterface._resolveDeviceIdForNexoId) return window.bleInterface._resolveDeviceIdForNexoId(nexoId);
    return nexoId;
  }
  function getMessagesContainer() {
    return document.getElementById('messages-container');
  }
  function scrollToBottom() {
    var c = getMessagesContainer();
    if (c) c.scrollTop = c.scrollHeight;
  }
  function escapeHtml(value) {
    return String(value || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');
  }
  function renderIncomingAttachment(rec) {
    var container = getMessagesContainer();
    if (!container || !rec || !rec.blobUrl) return;
    var bubble = document.createElement('div');
    bubble.className = 'message incoming message-attachment';
    bubble.style.cssText = 'align-self:flex-start;max-width:75%;margin:6px auto 6px 16px;padding:8px;border-radius:18px;background:rgba(255,255,255,0.08);color:#E5E5E5;box-shadow:0 2px 8px rgba(0,0,0,0.3);display:flex;flex-direction:column;gap:6px;';
    var isImage = (rec.mimeType || '').indexOf('image/') === 0;
    var isAudio = (rec.mimeType || '').indexOf('audio/') === 0;
    var safeName = escapeHtml(rec.fileName || 'archivo');
    if (isImage) {
      bubble.innerHTML = '<img src="' + rec.blobUrl + '" style="max-width:240px;max-height:320px;border-radius:12px;object-fit:cover;display:block;" alt="Foto"><a href="' + rec.blobUrl + '" download="' + safeName + '" style="font-size:11px;color:#00c8ff;text-align:right;">Descargar</a><div class="attach-status" style="font-size:10px;opacity:0.7;text-align:right;">🖼️ Foto recibida' + (rec.layer === 'preview' ? ' (preview)' : '') + '</div>';
    } else if (isAudio) {
      bubble.innerHTML = '<audio controls src="' + rec.blobUrl + '" style="max-width:240px;"></audio><div class="attach-status" style="font-size:10px;opacity:0.7;text-align:right;">🎵 Audio recibido</div>';
    } else {
      var sizeStr = rec.size > 1048576 ? (rec.size / 1048576).toFixed(1) + ' MB' : (rec.size / 1024).toFixed(0) + ' KB';
      bubble.innerHTML = '<a href="' + rec.blobUrl + '" download="' + safeName + '" style="display:flex;align-items:center;gap:10px;padding:8px;background:rgba(0,0,0,0.2);border-radius:10px;text-decoration:none;color:#E5E5E5;"><div style="font-size:24px;">📄</div><div style="overflow:hidden;"><div style="font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:160px;">' + safeName + '</div><div style="font-size:11px;opacity:0.7;">' + sizeStr + ' · tocar para descargar</div></div></a>';
    }
    container.appendChild(bubble);
    scrollToBottom();
  }
  function saveIncomingToVault(rec) {
    if (!window.vaultAppendMessage || !rec.senderId) return;
    var isImage = (rec.mimeType || '').indexOf('image/') === 0;
    window.vaultAppendMessage(rec.senderId, {
      msgId: rec.msgId,
      senderNexoId: rec.senderId,
      senderName: (rec.meta && rec.meta.f) || 'NEXO',
      timestamp: rec.timestamp,
      status: 'delivered',
      _own: false,
      type: isImage ? 'image' : 'file',
      text: isImage ? '[Foto]' : '[Archivo: ' + rec.fileName + ']',
      content: isImage ? '[Foto]' : '[Archivo: ' + rec.fileName + ']',
      attachmentType: isImage ? 'image' : 'file',
      attachmentPayload: 'data:' + rec.mimeType + ';base64,' + rec.base64,
      attachmentMeta: { fileName: rec.fileName, mimeType: rec.mimeType, totalSize: rec.size, layer: rec.layer }
    }).catch(function() {});
  }
  function handleIncoming(rec) {
    if (!rec || !rec.blobUrl) return;
    renderIncomingAttachment(rec);
    saveIncomingToVault(rec);
  }
  if (typeof window.NEXOFileTransfer !== 'undefined') {
    window.NEXOFileTransfer.onReceived(handleIncoming);
  }
  var btnCamera = document.querySelector('[data-type="camera"]');
  if (btnCamera) {
    btnCamera.addEventListener('click', function(e) {
      e.preventDefault();
      e.stopPropagation();
      if (attachMenu) {
        attachMenu.classList.remove('visible');
        attachMenu.classList.add('hidden');
      }
      var contactId = getActiveContactId();
      var deviceId = contactId ? resolveDeviceId(contactId) : null;
      if (!deviceId) {
        alert('No hay contacto activo');
        return;
      }
      if (typeof window.NEXOPhotos === 'undefined') {
        alert('NEXOPhotos no cargado');
        return;
      }
      window.NEXOPhotos.sendPhoto(deviceId, 'camera', {
        onProgress: function(msgId, progress) {
          console.log('[Attach] Camara progreso:', msgId, Math.round(progress) + '%');
        },
        onComplete: function(msgId, success, error) {
          if (success) {
            console.log('[Attach] Camara enviada:', msgId);
          } else {
            console.warn('[Attach] Camara error:', error || 'Error desconocido');
          }
        }
      }).catch(function(err) {
        console.error('[Attach] Camara:', err);
      });
    });
  }
  var btnGallery = document.querySelector('[data-type="gallery"]');
  if (btnGallery) {
    btnGallery.addEventListener('click', function(e) {
      e.preventDefault();
      e.stopPropagation();
      if (attachMenu) {
        attachMenu.classList.remove('visible');
        attachMenu.classList.add('hidden');
      }
      var contactId = getActiveContactId();
      var deviceId = contactId ? resolveDeviceId(contactId) : null;
      if (!deviceId) {
        alert('No hay contacto activo');
        return;
      }
      if (typeof window.NEXOPhotos === 'undefined') {
        alert('NEXOPhotos no cargado');
        return;
      }
      window.NEXOPhotos.sendPhoto(deviceId, 'gallery', {
        onProgress: function(msgId, progress) {
          console.log('[Attach] Galeria progreso:', msgId, Math.round(progress) + '%');
        },
        onComplete: function(msgId, success, error) {
          if (success) {
            console.log('[Attach] Galeria enviada:', msgId);
          } else {
            console.warn('[Attach] Galeria error:', error || 'Error desconocido');
          }
        }
      }).catch(function(err) {
        console.error('[Attach] Galeria:', err);
      });
    });
  }
  var btnFile = document.querySelector('[data-type="file"]');
  if (btnFile) {
    btnFile.addEventListener('click', function(e) {
      e.preventDefault();
      e.stopPropagation();
      if (attachMenu) {
        attachMenu.classList.remove('visible');
        attachMenu.classList.add('hidden');
      }
      var contactId = getActiveContactId();
      var deviceId = contactId ? resolveDeviceId(contactId) : null;
      if (!deviceId) {
        alert('No hay contacto activo');
        return;
      }
      if (typeof window.NEXOFileTransfer === 'undefined') {
        alert('NEXOFileTransfer no cargado');
        return;
      }
      var input = document.createElement('input');
      input.type = 'file';
      input.style.display = 'none';
      input.onchange = function(ev) {
        var file = ev.target.files[0];
        if (!file) return;
        if (file.size > 5242880) {
          alert('Maximo 5MB');
          if (input.parentNode) input.remove();
          return;
        }
        window.NEXOFileTransfer.sendFile(deviceId, file, {
          onProgress: function(msgId, progress) {
            console.log('[Attach] Archivo progreso:', msgId, Math.round(progress) + '%');
          },
          onComplete: function(msgId, success, error) {
            if (success) {
              console.log('[Attach] Archivo enviado:', msgId, file.name);
            } else {
              console.warn('[Attach] Archivo error:', error || 'Error desconocido');
            }
          }
        }).catch(function(err) {
          console.error('[Attach] Archivo:', err);
        });
        setTimeout(function() {
          if (input.parentNode) input.remove();
        }, 5000);
      };
      document.body.appendChild(input);
      input.click();
    });
  }
  console.log('[attachment_handlers v2.3] Recepcion activa; sin burbujas de envio duplicadas');
})();
