// attachment_handlers.js — Handler de attachments con render local en burbuja
// FIX: IDs alineados con index.html (attach-btn, attach-menu con class visible/hidden)

(function() {
  'use strict';

  var attachBtn = document.getElementById('attach-btn');
  var attachMenu = document.getElementById('attach-menu');

  function getMessagesContainer() {
    return document.getElementById('messages-container');
  }

  function scrollToBottom() {
    var c = getMessagesContainer();
    if (c) c.scrollTop = c.scrollHeight;
  }

  function renderOwnBubble(htmlContent, typeLabel) {
    var container = getMessagesContainer();
    if (!container) {
      console.error('[Attach] No se encontró contenedor de chat');
      return;
    }
    var bubble = document.createElement('div');
    bubble.className = 'message own message-attachment';
    bubble.style.cssText = 'align-self:flex-end;max-width:75%;margin:6px 16px 6px auto;padding:8px;border-radius:18px;background:linear-gradient(135deg,#0082FC,#6B4EFF);color:#E5E5E5;font-size:14px;word-break:break-word;box-shadow:0 2px 8px rgba(0,0,0,0.3);display:flex;flex-direction:column;gap:6px;';
    bubble.innerHTML = htmlContent + '<div style="font-size:10px;opacity:0.7;text-align:right;margin-top:4px;">' + typeLabel + '</div>';
    container.appendChild(bubble);
    scrollToBottom();
  }

  // ── 1. FOTO ──
  var btnFoto = document.querySelector('[data-type="photo"]');
  if (btnFoto) {
    btnFoto.addEventListener('click', async function(e) {
      e.preventDefault();
      e.stopPropagation();
      if (attachMenu) {
        attachMenu.classList.remove('visible');
        attachMenu.classList.add('hidden');
      }
      try {
        if (!window.Capacitor || !window.Capacitor.Plugins || !window.Capacitor.Plugins.Camera) {
          alert('Plugin Camera no disponible');
          return;
        }
        var Camera = window.Capacitor.Plugins.Camera;
        var image = await Camera.getPhoto({
          quality: 90,
          allowEditing: false,
          resultType: Camera.CameraResultType.Base64,
          source: Camera.CameraSource.Prompt,
          saveToGallery: false
        });
        if (image && image.base64String) {
          var dataUrl = 'data:image/jpeg;base64,' + image.base64String;
          var html = '<div style="border-radius:12px;overflow:hidden;background:#000;"><img src="' + dataUrl + '" style="max-width:240px;max-height:300px;width:100%;height:auto;display:block;object-fit:cover;" alt="Foto"></div>';
          renderOwnBubble(html, '📷 Foto');
          window._lastAttachmentPayload = { type: 'image', data: dataUrl, width: image.width, height: image.height };
        }
      } catch (err) {
        console.error('[FOTO] Error:', err);
        if (err.message && err.message.indexOf('cancelled') === -1 && err.message.indexOf('User cancelled') === -1) {
          alert('Error foto: ' + err.message);
        }
      }
    });
  }

  // ── 2. VIDEO ──
  var btnVideo = document.querySelector('[data-type="video"]');
  if (btnVideo) {
    btnVideo.addEventListener('click', function(e) {
      e.preventDefault();
      e.stopPropagation();
      if (attachMenu) {
        attachMenu.classList.remove('visible');
        attachMenu.classList.add('hidden');
      }
      var input = document.createElement('input');
      input.type = 'file';
      input.accept = 'video/*';
      input.style.display = 'none';
      input.onchange = function(ev) {
        var file = ev.target.files[0];
        if (!file) return;
        var url = URL.createObjectURL(file);
        var html = '<div style="border-radius:12px;overflow:hidden;background:#000;"><video src="' + url + '" style="max-width:240px;max-height:200px;width:100%;display:block;" controls preload="metadata"></video></div>';
        renderOwnBubble(html, '🎬 Video');
        window._lastAttachmentPayload = { type: 'video', file: file, url: url };
      };
      document.body.appendChild(input);
      input.click();
      setTimeout(function() { input.remove(); }, 5000);
    });
  }

  // ── 3. ARCHIVO ──
  var btnArchivo = document.querySelector('[data-type="file"]');
  if (btnArchivo) {
    btnArchivo.addEventListener('click', function(e) {
      e.preventDefault();
      e.stopPropagation();
      if (attachMenu) {
        attachMenu.classList.remove('visible');
        attachMenu.classList.add('hidden');
      }
      var input = document.createElement('input');
      input.type = 'file';
      input.style.display = 'none';
      input.onchange = function(ev) {
        var file = ev.target.files[0];
        if (!file) return;
        var sizeStr = file.size > 1024*1024
          ? (file.size/(1024*1024)).toFixed(1) + ' MB'
          : (file.size/1024).toFixed(0) + ' KB';
        var html = '<div style="display:flex;align-items:center;gap:10px;padding:8px;background:rgba(0,0,0,0.2);border-radius:10px;"><div style="font-size:24px;">📄</div><div style="overflow:hidden;"><div style="font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:160px;">' + file.name + '</div><div style="font-size:11px;opacity:0.7;">' + sizeStr + '</div></div></div>';
        renderOwnBubble(html, '📎 Archivo');
        window._lastAttachmentPayload = { type: 'file', file: file };
      };
      document.body.appendChild(input);
      input.click();
      setTimeout(function() { input.remove(); }, 5000);
    });
  }

  // ── 4. UBICACIÓN — ELIMINADO: manejado por main.js (_handleLocation) ──

  console.log('[attachment_handlers] Cargado — render local activo');
})();
