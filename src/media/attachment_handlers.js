// attachment_handlers.js — Handler de Foto con @capacitor/camera
// Instalación: npm install @capacitor/camera && npx cap sync

(function() {
  'use strict';

  const attachToggle = document.getElementById('attach-toggle');
  const attachMenu   = document.getElementById('attach-menu');

  // Toggle menú
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

  // Handler Foto
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
          const payload = {
            type: 'image',
            data: 'data:image/jpeg;base64,' + image.base64String,
            width: image.width,
            height: image.height
          };

          if (typeof window.sendAttachment === 'function') {
            window.sendAttachment(payload);
          } else {
            console.log('[FOTO] Payload:', payload);
            alert('Foto: ' + image.width + 'x' + image.height);
          }
        }
      } catch (err) {
        console.error('[FOTO] Error:', err);
        if (err.message && !err.message.includes('cancelled') && !err.message.includes('User cancelled')) {
          alert('Error foto: ' + err.message);
        }
      }
    });
  }

  // Placeholders (sin funcionalidad)
  const btnVideo = document.getElementById('attach-video');
  if (btnVideo) {
    btnVideo.addEventListener('click', function(e) {
      e.preventDefault();
      if (attachMenu) attachMenu.style.display = 'none';
      alert('Video — pendiente');
    });
  }

  const btnArchivo = document.getElementById('attach-file');
  if (btnArchivo) {
    btnArchivo.addEventListener('click', function(e) {
      e.preventDefault();
      if (attachMenu) attachMenu.style.display = 'none';
      alert('Archivo — pendiente');
    });
  }

  const btnUbicacion = document.getElementById('attach-location');
  if (btnUbicacion) {
    btnUbicacion.addEventListener('click', function(e) {
      e.preventDefault();
      if (attachMenu) attachMenu.style.display = 'none';
      alert('Ubicación — pendiente');
    });
  }

  console.log('[attachment_handlers] Foto cargado');
})();
