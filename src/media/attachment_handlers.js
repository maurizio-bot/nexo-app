/**
 * attachment_handlers.js v2.4 — NEXOFileTransfer + NEXOPhotos
 *
 * IMPORTANTE:
 * - No crea burbujas de envío propias.
 * - No procesa recepción de archivos/fotos/audio.
 * - La recepción única la controla main.js mediante fileComplete.
 * - El estado de los mensajes de envío lo controla main.js.
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
  console.log('[attachment_handlers v2.4] Recepcion delegada exclusivamente a main.js');
})();
