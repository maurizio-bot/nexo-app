/**
 * NEXO Attachment Handlers
 * Plugins: @capacitor/camera, @capacitor/filesystem, @capacitor/geolocation
 * Audio: Web Audio API nativa (MediaRecorder)
 * Se carga via <script> en index.html
 */

(function() {
  'use strict';

  const Plugins = window.Capacitor ? window.Capacitor.Plugins : null;
  const Camera = Plugins ? Plugins.Camera : null;
  const Filesystem = Plugins ? Plugins.Filesystem : null;
  const Geolocation = Plugins ? Plugins.Geolocation : null;

  let mediaRecorder = null;
  let audioChunks = [];
  let isRecording = false;

  function _log(tag, msg) {
    console.log('[ATTACH:' + tag + ']', msg);
  }

  function _showToast(msg) {
    if (window.NexoApp && window.NexoApp.showToast) {
      window.NexoApp.showToast(msg);
    } else {
      alert(msg);
    }
  }

  function _getCurrentContactId() {
    if (window.NexoApp && window.NexoApp.currentContact) {
      return window.NexoApp.currentContact.nexoId || window.NexoApp.currentContact.id;
    }
    return null;
  }

  function _sendAttachment(type, payload, meta) {
    const contactId = _getCurrentContactId();
    if (!contactId) {
      _showToast('No hay contacto seleccionado');
      return;
    }
    if (window.BLEInterface && window.BLEInterface.sendAttachment) {
      window.BLEInterface.sendAttachment(contactId, type, payload, meta);
    } else if (window.NexoApp && window.NexoApp.sendMessage) {
      const msg = {
        type: 'attachment',
        attachmentType: type,
        payload: payload,
        meta: meta,
        timestamp: Date.now()
      };
      window.NexoApp.sendMessage(contactId, JSON.stringify(msg));
    } else {
      _showToast('Sistema de mensajes no disponible');
    }
  }

  // --- FOTO ---
  async function handlePhoto() {
    if (!Camera) {
      _showToast('Plugin Camera no disponible');
      return;
    }
    try {
      const photo = await Camera.getPhoto({
        quality: 85,
        allowEditing: false,
        resultType: 'base64',
        source: 'prompt',
        saveToGallery: false
      });
      if (photo.base64String) {
        _sendAttachment('image', photo.base64String, {
          format: photo.format || 'jpeg',
          width: photo.width,
          height: photo.height
        });
        _showToast('Foto preparada para enviar');
      }
    } catch (err) {
      _log('PHOTO', 'Cancelado o error: ' + err.message);
    }
  }

  // --- VIDEO ---
  async function handleVideo() {
    if (!Camera) {
      _showToast('Plugin Camera no disponible');
      return;
    }
    try {
      const video = await Camera.getPhoto({
        quality: 80,
        allowEditing: false,
        resultType: 'uri',
        source: 'prompt',
        saveToGallery: false
      });
      if (video.path || video.webPath) {
        const uri = video.path || video.webPath;
        if (Filesystem) {
          const file = await Filesystem.readFile({ path: uri });
          _sendAttachment('video', file.data, { format: 'mp4', uri: uri });
        } else {
          _sendAttachment('video', uri, { format: 'mp4', uri: uri });
        }
        _showToast('Video preparado para enviar');
      }
    } catch (err) {
      _log('VIDEO', 'Cancelado o error: ' + err.message);
    }
  }

  // --- ARCHIVO ---
  function handleFile() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '*/*';
    input.style.display = 'none';
    input.onchange = function(e) {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = function(evt) {
        const base64 = evt.target.result.split(',')[1];
        _sendAttachment('file', base64, {
          name: file.name,
          size: file.size,
          type: file.type
        });
        _showToast('Archivo: ' + file.name);
      };
      reader.readAsDataURL(file);
    };
    document.body.appendChild(input);
    input.click();
    setTimeout(function() { input.remove(); }, 1000);
  }

  // --- UBICACION ---
  async function handleLocation() {
    if (!Geolocation) {
      _showToast('Plugin Geolocation no disponible');
      return;
    }
    try {
      const pos = await Geolocation.getCurrentPosition({
        enableHighAccuracy: true,
        timeout: 10000
      });
      const payload = JSON.stringify({
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracy: pos.coords.accuracy
      });
      _sendAttachment('location', payload, {
        lat: pos.coords.latitude,
        lng: pos.coords.longitude
      });
      _showToast('Ubicacion enviada');
    } catch (err) {
      _log('LOCATION', 'Error: ' + err.message);
      _showToast('No se pudo obtener ubicacion');
    }
  }

  // --- VOZ (Web Audio API) ---
  async function handleVoiceToggle() {
    if (!isRecording) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaRecorder = new MediaRecorder(stream);
        audioChunks = [];
        mediaRecorder.ondataavailable = function(e) {
          if (e.data.size > 0) audioChunks.push(e.data);
        };
        mediaRecorder.onstop = function() {
          const blob = new Blob(audioChunks, { type: 'audio/webm' });
          const reader = new FileReader();
          reader.onloadend = function() {
            const base64 = reader.result.split(',')[1];
            _sendAttachment('audio', base64, { format: 'webm', duration: 0 });
            _showToast('Audio enviado');
          };
          reader.readAsDataURL(blob);
          stream.getTracks().forEach(function(t) { t.stop(); });
        };
        mediaRecorder.start();
        isRecording = true;
        _updateMicIcon(true);
        _showToast('Grabando...');
      } catch (err) {
        _log('VOICE', 'Error permiso microfono: ' + err.message);
        _showToast('Permiso de microfono denegado');
      }
    } else {
      if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();
      }
      isRecording = false;
      _updateMicIcon(false);
    }
  }

  function _updateMicIcon(recording) {
    const micBtn = document.getElementById('chat-mic-btn');
    if (micBtn) {
      micBtn.style.color = recording ? '#FF3B30' : '';
      micBtn.textContent = recording ? '⏹' : '🎤';
    }
  }

  // --- CAMARA RAPIDA ---
  async function handleQuickCamera() {
    if (!Camera) {
      _showToast('Plugin Camera no disponible');
      return;
    }
    try {
      const photo = await Camera.getPhoto({
        quality: 80,
        allowEditing: false,
        resultType: 'base64',
        source: 'camera',
        saveToGallery: false
      });
      if (photo.base64String) {
        _sendAttachment('image', photo.base64String, { format: photo.format || 'jpeg' });
        _showToast('Foto enviada');
      }
    } catch (err) {
      _log('QUICK_CAM', 'Cancelado o error: ' + err.message);
    }
  }

  // --- Bindings ---
  function bindAttachmentMenu() {
    const btnPhoto = document.getElementById('attach-photo');
    const btnVideo = document.getElementById('attach-video');
    const btnFile = document.getElementById('attach-file');
    const btnLocation = document.getElementById('attach-location');
    const btnMic = document.getElementById('chat-mic-btn');
    const btnCamera = document.getElementById('chat-camera-btn');

    if (btnPhoto) btnPhoto.addEventListener('click', handlePhoto);
    if (btnVideo) btnVideo.addEventListener('click', handleVideo);
    if (btnFile) btnFile.addEventListener('click', handleFile);
    if (btnLocation) btnLocation.addEventListener('click', handleLocation);
    if (btnMic) btnMic.addEventListener('click', handleVoiceToggle);
    if (btnCamera) btnCamera.addEventListener('click', handleQuickCamera);

    _log('INIT', 'Handlers vinculados');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindAttachmentMenu);
  } else {
    bindAttachmentMenu();
  }

  window.NexoAttachmentHandlers = {
    bind: bindAttachmentMenu,
    photo: handlePhoto,
    video: handleVideo,
    file: handleFile,
    location: handleLocation,
    voice: handleVoiceToggle,
    quickCamera: handleQuickCamera
  };

})();
