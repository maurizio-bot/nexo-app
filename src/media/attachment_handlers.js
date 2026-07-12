// attachment_handlers.js — Handler de attachments con render local en burbuja
// Instalación: npm install @capacitor/camera && npx cap sync

(function() {
  'use strict';

  const attachToggle = document.getElementById('attach-toggle');
  const attachMenu   = document.getElementById('attach-menu');

  // ── Toggle menú (igual) ──
  if (attachToggle && attachMenu) {
    attachToggle.addEventListener('click', function(e) {
      e.preventDefault();
      e.stopPropagation();
      const isVisible = attachMenu.style.display === 'block';
      attachMenu.style.display = isVisible ? 'none' : 'block';
    });

    document.addEventListener('click', function(e) {
      if (!attachMenu.contains(e.target) && e.target !== attachToggle) {
        attachMenu.style.display = 'none';
      }
    });
  }

  // ── Helpers para renderizar burbuja ──
  function getMessagesContainer() {
    return document.querySelector('.chat-messages') ||
           document.querySelector('#chat-messages') ||
           document.querySelector('.messages') ||
           document.querySelector('.chat-body');
  }

  function scrollToBottom() {
    const c = getMessagesContainer();
    if (c) c.scrollTop = c.scrollHeight;
  }

  function renderOwnBubble(htmlContent, typeLabel) {
    const container = getMessagesContainer();
    if (!container) {
      console.error('[Attach] No se encontró contenedor de chat');
      return;
    }
    const bubble = document.createElement('div');
    bubble.className = 'message own message-attachment';
    bubble.style.cssText = `
      align-self: flex-end;
      max-width: 75%;
      margin: 6px 16px 6px auto;
      padding: 8px;
      border-radius: 18px;
      background: linear-gradient(135deg, #0082FC, #6B4EFF);
      color: #E5E5E5;
      font-size: 14px;
      word-break: break-word;
      box-shadow: 0 2px 8px rgba(0,0,0,0.3);
      display: flex;
      flex-direction: column;
      gap: 6px;
    `;
    bubble.innerHTML = htmlContent + `<div style="font-size:10px;opacity:0.7;text-align:right;margin-top:4px;">${typeLabel}</div>`;
    container.appendChild(bubble);
    scrollToBottom();
  }

  // ── 1. FOTO ──
  const btnFoto = document.getElementById('attach-photo');
  if (btnFoto) {
    btnFoto.addEventListener('click', async function(e) {
      e.preventDefault();
      e.stopPropagation();
      if (attachMenu) attachMenu.style.display = 'none';

      try {
        if (!window.Capacitor || !window.Capacitor.Plugins || !window.Capacitor.Plugins.Camera) {
          alert('Plugin Camera no disponible');
          return;
        }

        const { Camera, CameraSource, CameraResultType } = window.Capacitor.Plugins.Camera;

        const image = await Camera.getPhoto({
          quality: 90,
          allowEditing: false,
          resultType: CameraResultType.Base64,
          source: CameraSource.Prompt,
          saveToGallery: false
        });

        if (image && image.base64String) {
          const dataUrl = 'data:image/jpeg;base64,' + image.base64String;
          const html = `
            <div style="border-radius:12px;overflow:hidden;background:#000;">
              <img src="${dataUrl}" style="max-width:240px;max-height:300px;width:100%;height:auto;display:block;object-fit:cover;" alt="Foto">
            </div>
          `;
          renderOwnBubble(html, '📷 Foto');

          // Guardar payload para cuando se active envío BLE
          window._lastAttachmentPayload = {
            type: 'image',
            data: dataUrl,
            width: image.width,
            height: image.height
          };
        }
      } catch (err) {
        console.error('[FOTO] Error:', err);
        if (err.message && !err.message.includes('cancelled') && !err.message.includes('User cancelled')) {
          alert('Error foto: ' + err.message);
        }
      }
    });
  }

  // ── 2. VIDEO ──
  const btnVideo = document.getElementById('attach-video');
  if (btnVideo) {
    btnVideo.addEventListener('click', function(e) {
      e.preventDefault();
      e.stopPropagation();
      if (attachMenu) attachMenu.style.display = 'none';

      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'video/*';
      input.style.display = 'none';
      input.onchange = function(ev) {
        const file = ev.target.files[0];
        if (!file) return;
        const url = URL.createObjectURL(file);
        const html = `
          <div style="border-radius:12px;overflow:hidden;background:#000;">
            <video src="${url}" style="max-width:240px;max-height:200px;width:100%;display:block;" controls preload="metadata"></video>
          </div>
        `;
        renderOwnBubble(html, '🎬 Video');
        window._lastAttachmentPayload = { type: 'video', file: file, url: url };
      };
      document.body.appendChild(input);
      input.click();
      setTimeout(() => input.remove(), 5000);
    });
  }

  // ── 3. ARCHIVO ──
  const btnArchivo = document.getElementById('attach-file');
  if (btnArchivo) {
    btnArchivo.addEventListener('click', function(e) {
      e.preventDefault();
      e.stopPropagation();
      if (attachMenu) attachMenu.style.display = 'none';

      const input = document.createElement('input');
      input.type = 'file';
      input.style.display = 'none';
      input.onchange = function(ev) {
        const file = ev.target.files[0];
        if (!file) return;
        const sizeStr = file.size > 1024*1024
          ? (file.size/(1024*1024)).toFixed(1) + ' MB'
          : (file.size/1024).toFixed(0) + ' KB';
        const html = `
          <div style="display:flex;align-items:center;gap:10px;padding:8px;background:rgba(0,0,0,0.2);border-radius:10px;">
            <div style="font-size:24px;">📄</div>
            <div style="overflow:hidden;">
              <div style="font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:160px;">${file.name}</div>
              <div style="font-size:11px;opacity:0.7;">${sizeStr}</div>
            </div>
          </div>
        `;
        renderOwnBubble(html, '📎 Archivo');
        window._lastAttachmentPayload = { type: 'file', file: file };
      };
      document.body.appendChild(input);
      input.click();
      setTimeout(() => input.remove(), 5000);
    });
  }

  // ── 4. UBICACIÓN ──
  const btnUbicacion = document.getElementById('attach-location');
  if (btnUbicacion) {
    btnUbicacion.addEventListener('click', function(e) {
      e.preventDefault();
      e.stopPropagation();
      if (attachMenu) attachMenu.style.display = 'none';

      if (!navigator.geolocation) {
        alert('Geolocalización no disponible');
        return;
      }
      navigator.geolocation.getCurrentPosition(function(pos) {
        const { latitude, longitude } = pos.coords;
        const mapsUrl = `https://www.google.com/maps?q=${latitude},${longitude}`;
        const html = `
          <a href="${mapsUrl}" target="_blank" style="text-decoration:none;color:inherit;">
            <div style="background:rgba(0,0,0,0.2);border-radius:10px;padding:10px;display:flex;align-items:center;gap:10px;">
              <div style="font-size:28px;">📍</div>
              <div>
                <div style="font-weight:600;">Mi ubicación</div>
                <div style="font-size:11px;opacity:0.8;">${latitude.toFixed(4)}, ${longitude.toFixed(4)}</div>
              </div>
            </div>
          </a>
        `;
        renderOwnBubble(html, '🌍 Ubicación');
        window._lastAttachmentPayload = { type: 'location', lat: latitude, lng: longitude };
      }, function(err) {
        alert('Error ubicación: ' + err.message);
      }, { enableHighAccuracy: true, timeout: 10000 });
    });
  }

  console.log('[attachment_handlers] Cargado — render local activo');
})();
