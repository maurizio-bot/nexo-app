/**
 * src/main.js - Punto de entrada NEXO v9.9.2-FASE4
 * FIX: _cameraActiveStream declarado explícitamente
 * FIX: _stopCameraPreview limpia tracks incluso si estaba grabando
 * FIX: _setupFABButton NO clona nodo, reutiliza listener existente
 * FIX: ObjectURLs revocados al cerrar fullscreen
 * FIX: _getContactStorageKey usa nexoId cuando está disponible
 * FASE4: Vault persistencia contactos + mensajes + AutoScan hooks
 */

import { NEXO_CONFIG } from './core/nexo_config.js';
import './styles/critical.css';
import { NEXO_DIAG } from './core/nap.js';
import { NexoApp, DEBUG } from './app/nexo_app.js';
import { rem } from './ui/rem.js';
import { ensureBLEPermissions, getPermissionShim } from './core/NexoPermissionShim.js';
import { createAckSystem } from './ui/ble_ack.js';
import { vaultLoadContacts, vaultSaveContact, vaultLoadMessages, vaultSaveMessage, vaultAppendMessage, vaultUpdateMessageStatus, vaultGetOrCreateContact, vaultFindContactByNexoId } from './vault/vault_manager.js';
import { createAutoScan } from './ui/autoscan.js';
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
window.vaultLoadContacts = vaultLoadContacts;
window.vaultSaveContact = vaultSaveContact;
window.vaultLoadMessages = vaultLoadMessages;
window.vaultSaveMessage = vaultSaveMessages;
window.vaultAppendMessage = vaultAppendMessage;
window.vaultUpdateMessageStatus = vaultUpdateMessageStatus;
window.vaultGetOrCreateContact = vaultGetOrCreateContact;
window.vaultFindContactByNexoId = vaultFindContactByNexoId;
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

// === ATTACHMENT HANDLERS GLOBALES ===
var _mediaRecorder = null;
var _lastLocationSent = 0;
var _LOCATION_DEBOUNCE_MS = 3000;
var _audioChunks = [];
var _isRecording = false;
var _voiceStartTime = 0;
var _voiceTimerInterval = null;
var _isGettingLocation = false;
var _cameraActiveStream = null; // FIX: declarado explícitamente
var _cameraPreviewMode = 'photo';
var _cameraPreviewRecording = false;
var _cameraPreviewMediaRecorder = null;
var _cameraPreviewVideoChunks = [];
var _cameraVideoStartTime = 0;
var _objectURLRegistry = []; // FIX: registro para revocar ObjectURLs
var _autoScan = null; // Fase 4: AutoScanManager

function _fmtTime(sec) {
  var m = Math.floor(sec / 60);
  var s = sec % 60;
  return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
}
function _getAttachmentPlugins() {
  var Plugins = window.Capacitor ? window.Capacitor.Plugins : null;
  return {
    Camera: Plugins ? Plugins.Camera : null,
    Filesystem: Plugins ? Plugins.Filesystem : null,
    Geolocation: Plugins ? Plugins.Geolocation : null
  };
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
    console.log('[ATTACH] No hay contacto seleccionado');
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
  _renderMessage(localMsg);
  var payloadStr = JSON.stringify(attachmentData);
  if (window.bleInterface && window.bleInterface.sendChatMessage) {
    window.bleInterface.sendChatMessage(contactId, payloadStr);
  } else if (window.NEXO.app && window.NEXO.app.sendMessage) {
    window.NEXO.app.sendMessage({ content: payloadStr });
  } else {
    console.log('[ATTACH] Sistema de mensajes no disponible');
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
function _showCameraPreviewOverlay() {
  var overlay = document.getElementById('camera-preview-overlay');
  if (!overlay) return;
  overlay.classList.remove('hidden');
  _cameraPreviewMode = 'photo';
  _cameraPreviewRecording = false;
  _cameraPreviewVideoChunks = [];
  _cameraVideoStartTime = 0;
  _updateCameraPreviewUI();
}
function _hideCameraPreviewOverlay() {
  var overlay = document.getElementById('camera-preview-overlay');
  if (overlay) overlay.classList.add('hidden');
  _stopCameraPreview();
}
function _openFullscreenMedia(src, type) {
  var existing = document.getElementById('fullscreen-media-overlay');
  if (existing) existing.remove();
  var overlay = document.createElement('div');
  overlay.id = 'fullscreen-media-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.95);z-index:5000;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:16px;';
  var closeBtn = document.createElement('button');
  closeBtn.innerHTML = '<svg viewBox="0 0 24 24" width="28" height="28" fill="#fff"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>';
  closeBtn.style.cssText = 'position:absolute;top:16px;right:16px;width:44px;height:44px;border-radius:50%;background:rgba(255,255,255,0.15);border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;z-index:5001;';
  closeBtn.onclick = function() {
    // FIX: revocar ObjectURL al cerrar
    if (src && src.indexOf('blob:') === 0) {
      try { URL.revokeObjectURL(src); } catch(e) {}
    }
    overlay.remove();
  };
  overlay.appendChild(closeBtn);
  if (type === 'image') {
    var img = document.createElement('img');
    img.src = src;
    img.style.cssText = 'max-width:95vw;max-height:85vh;object-fit:contain;border-radius:8px;';
    overlay.appendChild(img);
  } else if (type === 'video') {
    var video = document.createElement('video');
    video.src = src;
    video.controls = true;
    video.autoplay = true;
    video.playsInline = true;
    video.style.cssText = 'max-width:95vw;max-height:85vh;border-radius:8px;background:#000;';
    overlay.appendChild(video);
  }
  overlay.addEventListener('click', function(e) {
    if (e.target === overlay) {
      if (src && src.indexOf('blob:') === 0) {
        try { URL.revokeObjectURL(src); } catch(e) {}
      }
      overlay.remove();
    }
  });
  document.body.appendChild(overlay);
}
function _updateCameraPreviewUI() {
  var captureBtn = document.getElementById('camera-btn-capture');
  var status = document.getElementById('camera-preview-status');
  var modeBtn = document.getElementById('camera-btn-mode');
  if (!captureBtn) return;
  if (_cameraPreviewMode === 'video') {
    captureBtn.classList.add('recording');
    if (status) status.textContent = _cameraPreviewRecording ? 'Grabando... toca para detener' : 'Toca para grabar video';
    if (modeBtn) modeBtn.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" fill="#fff"><path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"/></svg>';
  } else {
    captureBtn.classList.remove('recording');
    if (status) status.textContent = '';
    if (modeBtn) modeBtn.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" fill="#fff"><path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z"/></svg>';
  }
}
function _setupVideoRecorder(stream) {
  var mimeType = '';
  var candidates = [
    'video/mp4',
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm;codecs=h264,opus',
    'video/webm',
    'video/mp4;codecs=avc1.42E01E,mp4a.40.2'
  ];
  for (var i = 0; i < candidates.length; i++) {
    if (MediaRecorder.isTypeSupported(candidates[i])) {
      mimeType = candidates[i];
      console.log('[CAMERA] MediaRecorder mimeType seleccionado:', mimeType);
      break;
    }
  }
  try {
    var options = mimeType ? { mimeType: mimeType } : {};
    _cameraPreviewMediaRecorder = new MediaRecorder(stream, options);
    _cameraPreviewVideoChunks = [];
    _cameraPreviewMediaRecorder.ondataavailable = function(e) {
      if (e.data && e.data.size > 0) _cameraPreviewVideoChunks.push(e.data);
    };
    _cameraPreviewMediaRecorder.onstop = function() {
      console.log('[CAMERA] Grabacion detenida, procesando...');
    };
    _cameraPreviewMediaRecorder.onerror = function(e) {
      console.log('[CAMERA] MediaRecorder error:', e.message);
      _cameraPreviewRecording = false;
      _updateCameraPreviewUI();
    };
  } catch (recErr) {
    console.log('[CAMERA] MediaRecorder init error:', recErr.message);
    var status = document.getElementById('camera-preview-status');
    if (status) status.textContent = 'Error: grabacion no soportada';
  }
}
function _startCameraPreview() {
  var container = document.getElementById('camera-preview-container');
  if (!container) return;
  var overlay = document.getElementById('camera-preview-overlay');
  if (overlay && overlay.classList.contains('hidden')) {
    overlay.classList.remove('hidden');
  }
  var facing = container.dataset.facing || 'environment';
  var needAudio = _cameraPreviewMode === 'video';
  var isFront = facing === 'user';
  var constraints = {
    video: isFront ? { facingMode: { exact: 'user' } } : { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
    audio: needAudio
  };
  function _onStreamSuccess(stream) {
    _cameraActiveStream = stream;
    var video = document.createElement('video');
    video.autoplay = true;
    video.playsInline = true;
    video.muted = true;
    video.style.width = '100%';
    video.style.height = '100%';
    video.style.objectFit = 'cover';
    video.srcObject = stream;
    container.innerHTML = '';
    container.appendChild(video);
    video.play().catch(function(e) { console.log('[CAMERA] play error:', e.message); });
    container.dataset.stream = 'active';
    if (_cameraPreviewMode === 'video') {
      _setupVideoRecorder(stream);
    }
  }
  function _onStreamError(err) {
    console.log('[CAMERA] Error getUserMedia:', err.name, err.message);
    var fallbackConstraints = {
      video: isFront ? { facingMode: 'user' } : { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: needAudio
    };
    navigator.mediaDevices.getUserMedia(fallbackConstraints)
      .then(_onStreamSuccess)
      .catch(function(err2) {
        console.log('[CAMERA] Fallback error:', err2.name, err2.message);
        var status = document.getElementById('camera-preview-status');
        if (status) status.textContent = 'Error camara: ' + err2.message;
      });
  }
  navigator.mediaDevices.getUserMedia(constraints)
    .then(_onStreamSuccess)
    .catch(_onStreamError);
}
// FIX v9.9.1: Limpia tracks SIEMPRE, incluso si estaba grabando
function _stopCameraPreview() {
  var wasRecording = _cameraPreviewMediaRecorder && _cameraPreviewMediaRecorder.state === 'recording';
  if (wasRecording) {
    try { _cameraPreviewMediaRecorder.stop(); } catch (e) {}
    // FIX: no retornar prematuramente, limpiar stream después
  }
  var container = document.getElementById('camera-preview-container');
  if (container) {
    var oldVideo = container.querySelector('video');
    if (oldVideo && oldVideo.srcObject) {
      var tracks = oldVideo.srcObject.getTracks();
      tracks.forEach(function(t) { t.stop(); });
    }
    container.innerHTML = '';
  }
  if (_cameraActiveStream) {
    var tracks = _cameraActiveStream.getTracks();
    tracks.forEach(function(t) { t.stop(); });
    _cameraActiveStream = null;
  }
  _cameraPreviewRecording = false;
  _cameraPreviewMediaRecorder = null;
  _cameraPreviewVideoChunks = [];
  _cameraVideoStartTime = 0;
}
function _flipCamera() {
  var container = document.getElementById('camera-preview-container');
  if (!container) return;
  var currentFacing = container.dataset.facing || 'environment';
  var newFacing = currentFacing === 'environment' ? 'user' : 'environment';
  container.dataset.facing = newFacing;
  _stopCameraPreview();
  var needAudio = _cameraPreviewMode === 'video';
  var isFront = newFacing === 'user';
  var constraints = {
    video: isFront ? { facingMode: { exact: 'user' } } : { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
    audio: needAudio
  };
  function _onStreamSuccess(stream) {
    _cameraActiveStream = stream;
    var video = document.createElement('video');
    video.autoplay = true;
    video.playsInline = true;
    video.muted = true;
    video.style.width = '100%';
    video.style.height = '100%';
    video.style.objectFit = 'cover';
    video.srcObject = stream;
    container.innerHTML = '';
    container.appendChild(video);
    video.play().catch(function(e) { console.log('[CAMERA] play error:', e.message); });
    container.dataset.stream = 'active';
    if (_cameraPreviewMode === 'video') {
      _setupVideoRecorder(stream);
    }
  }
  function _onStreamError(err) {
    console.log('[CAMERA] Error flip ideal:', err.name, err.message);
    var fallbackConstraints = {
      video: isFront ? { facingMode: 'user' } : { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: needAudio
    };
    navigator.mediaDevices.getUserMedia(fallbackConstraints)
      .then(_onStreamSuccess)
      .catch(function(err2) {
        console.log('[CAMERA] Error flip fallback:', err2.name, err2.message);
        var status = document.getElementById('camera-preview-status');
        if (status) status.textContent = 'Error camara: ' + err2.message;
      });
  }
  setTimeout(function() {
    navigator.mediaDevices.getUserMedia(constraints)
      .then(_onStreamSuccess)
      .catch(_onStreamError);
  }, 300);
}
function _toggleCameraMode() {
  _cameraPreviewMode = _cameraPreviewMode === 'photo' ? 'video' : 'photo';
  _updateCameraPreviewUI();
  _stopCameraPreview();
  _startCameraPreview();
}
function _capturePhoto() {
  var container = document.getElementById('camera-preview-container');
  if (!container) return;
  var video = container.querySelector('video');
  if (!video) return;
  var canvas = document.createElement('canvas');
  canvas.width = video.videoWidth || 1280;
  canvas.height = video.videoHeight || 720;
  var ctx = canvas.getContext('2d');
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  var base64 = canvas.toDataURL('image/jpeg', 0.85).split(',')[1];
  _sendAttachment('image', base64, { format: 'jpeg', width: canvas.width, height: canvas.height });
  _hideCameraPreviewOverlay();
}
function _handleCameraCapture() {
  if (_cameraPreviewMode === 'photo') {
    _capturePhoto();
  } else {
    if (!_cameraPreviewRecording) {
      if (_cameraPreviewMediaRecorder && _cameraPreviewMediaRecorder.state === 'inactive') {
        _cameraPreviewVideoChunks = [];
        _cameraVideoStartTime = Date.now();
        try {
          try {
            _cameraPreviewMediaRecorder.start(100);
          } catch (tsErr) {
            console.log('[CAMERA] Timeslice no soportado, usando sin timeslice');
            _cameraPreviewMediaRecorder.start();
          }
          _cameraPreviewRecording = true;
          _updateCameraPreviewUI();
          console.log('[CAMERA] Grabacion iniciada');
        } catch (startErr) {
          console.log('[CAMERA] Error al iniciar grabacion:', startErr.message);
          _cameraPreviewRecording = false;
        }
      }
    } else {
      if (_cameraPreviewMediaRecorder && _cameraPreviewMediaRecorder.state === 'recording') {
        try { _cameraPreviewMediaRecorder.requestData(); } catch (e) {}
        setTimeout(function() {
          try {
            if (_cameraPreviewMediaRecorder && _cameraPreviewMediaRecorder.state === 'recording') {
              _cameraPreviewMediaRecorder.stop();
            }
          } catch(e) {}
          setTimeout(function() {
            var duration = 0;
            if (_cameraVideoStartTime > 0) {
              duration = Math.round((Date.now() - _cameraVideoStartTime) / 1000);
            }
            var mimeType = 'video/webm';
            var blob = new Blob(_cameraPreviewVideoChunks, { type: mimeType });
            if (blob.size === 0) {
              console.log('[CAMERA] Video blob vacio, grabacion fallo');
              var status = document.getElementById('camera-preview-status');
              if (status) status.textContent = 'Error: video vacio';
              _cameraPreviewRecording = false;
              _updateCameraPreviewUI();
              return;
            }
            var reader = new FileReader();
            reader.onloadend = function() {
              var base64 = reader.result.split(',')[1];
              _sendAttachment('video', base64, { format: 'webm', duration: duration });
              _hideCameraPreviewOverlay();
            };
            reader.onerror = function() {
              console.log('[CAMERA] Error leyendo video');
              _cameraPreviewRecording = false;
              _updateCameraPreviewUI();
            };
            reader.readAsDataURL(blob);
          }, 1200);
          _cameraPreviewRecording = false;
          _updateCameraPreviewUI();
        }, 1500);
      }
    }
  }
}
function _bindCameraPreviewHandlers() {
  var closeBtn = document.getElementById('camera-btn-close');
  var flipBtn = document.getElementById('camera-btn-flip');
  var captureBtn = document.getElementById('camera-btn-capture');
  var modeBtn = document.getElementById('camera-btn-mode');
  if (closeBtn) closeBtn.addEventListener('click', _hideCameraPreviewOverlay);
  if (flipBtn) flipBtn.addEventListener('click', _flipCamera);
  if (captureBtn) captureBtn.addEventListener('click', _handleCameraCapture);
  if (modeBtn) modeBtn.addEventListener('click', _toggleCameraMode);
}
async function _handleCamera() {
  _closeAttachMenu();
  _showCameraPreviewOverlay();
  _startCameraPreview();
}
async function _handleGallery() {
  _closeAttachMenu();
  _hideCameraPreviewOverlay();
  _stopCameraPreview();
  await new Promise(function(r) { setTimeout(r, 150); });
  var input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*,video/*';
  input.style.cssText = 'position:fixed;top:-1000px;left:-1000px;opacity:0;pointer-events:none;width:1px;height:1px;';
  input.onchange = function(e) {
    var file = e.target.files[0];
    if (!file) { input.remove(); return; }
    var isVideo = file.type.indexOf('video') === 0;
    var reader = new FileReader();
    reader.onload = function(evt) {
      var base64 = evt.target.result.split(',')[1];
      if (isVideo) {
        _sendAttachment('video', base64, { name: file.name, size: file.size, type: file.type });
      } else {
        _sendAttachment('image', base64, { name: file.name, size: file.size, type: file.type, format: file.type.split('/')[1] || 'jpeg' });
      }
      input.remove();
    };
    reader.onerror = function() {
      console.log('[ATTACH] Error leyendo archivo');
      input.remove();
    };
    reader.readAsDataURL(file);
  };
  document.body.appendChild(input);
  input.click();
  setTimeout(function() { if (input.parentNode) input.remove(); }, 30000);
}
function _handleFile() {
  _closeAttachMenu();
  var input = document.createElement('input');
  input.type = 'file';
  input.accept = '*/*';
  input.style.cssText = 'position:fixed;top:-1000px;left:-1000px;opacity:0;pointer-events:none;width:1px;height:1px;';
  input.onchange = function(e) {
    var file = e.target.files[0];
    if (!file) { input.remove(); return; }
    var reader = new FileReader();
    reader.onload = function(evt) {
      var base64 = evt.target.result.split(',')[1];
      _sendAttachment('file', base64, { name: file.name, size: file.size, type: file.type });
      console.log('[ATTACH] Archivo:', file.name);
      input.remove();
    };
    reader.onerror = function() {
      console.log('[ATTACH] Error leyendo archivo');
      input.remove();
    };
    reader.readAsDataURL(file);
  };
  document.body.appendChild(input);
  input.click();
  setTimeout(function() { if (input.parentNode) input.remove(); }, 30000);
}
function _showPermissionError(permName) {
  var existing = document.getElementById('perm-error-toast');
  if (existing) existing.remove();
  var toast = document.createElement('div');
  toast.id = 'perm-error-toast';
  toast.style.cssText = 'position:fixed;top:20px;left:50%;transform:translateX(-50%);background:rgba(255,59,48,0.95);color:#fff;padding:12px 20px;border-radius:12px;font-size:13px;font-weight:600;z-index:10000;backdrop-filter:blur(4px);box-shadow:0 4px 20px rgba(0,0,0,0.4);max-width:90vw;text-align:center;';
  toast.innerHTML = 'Permiso de ' + permName + ' denegado.<br><span style="font-size:11px;opacity:0.8;font-weight:400;">Ve a Ajustes > Aplicaciones > NEXO > Permisos</span>';
  document.body.appendChild(toast);
  setTimeout(function() { toast.style.opacity = '0'; toast.style.transition = 'opacity 0.5s'; setTimeout(function() { toast.remove(); }, 500); }, 4000);
}
async function _handleLocation() {
  if (_isGettingLocation) return;
  _isGettingLocation = true;
  _closeAttachMenu();
  var plugins = _getAttachmentPlugins();
  var sent = false;
  var safetyTimer = setTimeout(function() {
    _isGettingLocation = false;
  }, 25000);
  try {
    if (plugins.Geolocation &&
        typeof plugins.Geolocation.checkPermissions === 'function' &&
        typeof plugins.Geolocation.requestPermissions === 'function' &&
        typeof plugins.Geolocation.getCurrentPosition === 'function') {
      try {
        var perm = await plugins.Geolocation.checkPermissions();
        if (perm.location !== 'granted') {
          var req = await plugins.Geolocation.requestPermissions();
          if (req.location !== 'granted') throw new Error('Permiso denegado');
        }
        var pos = await plugins.Geolocation.getCurrentPosition({ enableHighAccuracy: true, timeout: 15000 });
        _sendLocation(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy);
        sent = true;
      } catch (pluginErr) {
        console.log('[ATTACH:LOCATION] Plugin fallo:', pluginErr.message);
        if (pluginErr.message && pluginErr.message.indexOf('denied') > -1) {
          _showPermissionError('Ubicacion');
          return;
        }
      }
    }
    if (!sent) {
      _handleLocationFallback();
    }
  } finally {
    clearTimeout(safetyTimer);
    _isGettingLocation = false;
  }
}
function _sendLocation(lat, lng, accuracy) {
  var now = Date.now();
  if (now - _lastLocationSent < _LOCATION_DEBOUNCE_MS) {
    console.log('[ATTACH:LOCATION] Ignorado por debounce');
    return;
  }
  _lastLocationSent = now;
  var payload = JSON.stringify({ lat: lat, lng: lng, accuracy: accuracy || 0 });
  _sendAttachment('location', payload, { lat: lat, lng: lng, accuracy: accuracy || 0 });
  console.log('[ATTACH] Ubicacion enviada');
}
function _handleLocationFallback() {
  try {
    if (!navigator.geolocation) {
      console.log('[ATTACH] Geolocation API no disponible');
      _showPermissionError('Ubicacion');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      function(pos) {
        _sendLocation(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy);
      },
      function(err) {
        console.log('[ATTACH:LOCATION] Fallback error:', err.code, err.message);
        if (err.code === 1) {
          _showPermissionError('Ubicacion');
        }
      },
      { enableHighAccuracy: false, timeout: 20000, maximumAge: 120000 }
    );
  } catch (e) {
    console.log('[ATTACH:LOCATION] Fallback fallo:', e.message);
  }
}
async function _handleVoiceToggle() {
  var timerEl = document.getElementById('voice-timer');
  if (!timerEl) {
    timerEl = document.createElement('div');
    timerEl.id = 'voice-timer';
    timerEl.style.cssText = 'position:fixed;bottom:70px;left:50%;transform:translateX(-50%);background:rgba(255,59,48,0.9);color:#fff;padding:6px 16px;border-radius:20px;font-size:14px;font-weight:600;z-index:300;display:none;pointer-events:none;backdrop-filter:blur(4px);';
    document.body.appendChild(timerEl);
  }
  if (!_isRecording) {
    try {
      var stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      var audioMimeType = '';
      var audioCandidates = [
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/mp4',
        'audio/ogg;codecs=opus',
        'audio/wav'
      ];
      for (var ai = 0; ai < audioCandidates.length; ai++) {
        if (MediaRecorder.isTypeSupported(audioCandidates[ai])) {
          audioMimeType = audioCandidates[ai];
          console.log('[VOICE] MimeType seleccionado:', audioMimeType);
          break;
        }
      }
      var audioOptions = audioMimeType ? { mimeType: audioMimeType } : {};
      _mediaRecorder = new MediaRecorder(stream, audioOptions);
      _audioChunks = [];
      _voiceStartTime = Date.now();
      timerEl.style.display = 'block';
      timerEl.textContent = '00:00';
      _voiceTimerInterval = setInterval(function() {
        var elapsed = Math.round((Date.now() - _voiceStartTime) / 1000);
        timerEl.textContent = _fmtTime(elapsed);
      }, 1000);
      _mediaRecorder.ondataavailable = function(e) {
        if (e.data && e.data.size > 0) _audioChunks.push(e.data);
      };
      _mediaRecorder.onstop = function() {
        if (_voiceTimerInterval) { clearInterval(_voiceTimerInterval); _voiceTimerInterval = null; }
        timerEl.style.display = 'none';
        var duration = 0;
        if (_voiceStartTime > 0) duration = Math.round((Date.now() - _voiceStartTime) / 1000);
        var blobType = audioMimeType || 'audio/webm';
        var blob = new Blob(_audioChunks, { type: blobType });
        if (blob.size === 0) {
          console.log('[ATTACH] Audio blob vacio');
          return;
        }
        var reader = new FileReader();
        reader.onloadend = function() {
          var base64 = reader.result.split(',')[1];
          var fmt = (audioMimeType || 'webm').split('/')[1];
          if (fmt.indexOf(';') > -1) fmt = fmt.split(';')[0];
          _sendAttachment('audio', base64, { format: fmt, duration: duration, mimeType: audioMimeType || 'audio/webm' });
          console.log('[ATTACH] Audio enviado, duracion:', duration);
        };
        reader.readAsDataURL(blob);
        stream.getTracks().forEach(function(t) { t.stop(); });
      };
      _mediaRecorder.onerror = function(e) {
        console.log('[ATTACH:VOICE] MediaRecorder error:', e.message);
        _isRecording = false;
        _updateMicIcon(false);
        timerEl.style.display = 'none';
      };
      try {
        _mediaRecorder.start(100);
      } catch (tsErr) {
        _mediaRecorder.start();
      }
      _isRecording = true;
      _updateMicIcon(true);
      console.log('[ATTACH] Grabando voz...');
    } catch (err) {
      console.log('[ATTACH:VOICE] Error:', err.name, err.message);
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        _showPermissionError('Microfono');
      } else if (err.name === 'NotFoundError') {
        _showPermissionError('Microfono no encontrado');
      }
      _isRecording = false;
      _updateMicIcon(false);
      timerEl.style.display = 'none';
    }
  } else {
    if (_mediaRecorder && _mediaRecorder.state !== 'inactive') {
      try { _mediaRecorder.requestData(); } catch (e) {}
      setTimeout(function() {
        try { _mediaRecorder.stop(); } catch (e) {}
      }, 300);
    }
    _isRecording = false;
    _updateMicIcon(false);
    if (_voiceTimerInterval) {
      clearInterval(_voiceTimerInterval);
      _voiceTimerInterval = null;
    }
    timerEl.style.display = 'none';
  }
}
function _updateMicIcon(recording) {
  var micBtn = document.getElementById('send-btn');
  if (!micBtn) return;
  var visibleSvg = micBtn.querySelector('.mic-icon') || micBtn.querySelector('.send-icon') || micBtn.querySelector('svg');
  if (visibleSvg) {
    visibleSvg.setAttribute('fill', recording ? '#FF3B30' : '#fff');
  }
}
function _bindAttachmentHandlers() {
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
      else if (type === 'contact') {
        console.log('[ATTACH] Compartir contacto - pendiente');
        _closeAttachMenu();
      }
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
document.addEventListener('DOMContentLoaded', async function() {
  _bindAttachmentHandlers();
  try {
    console.log('[MAIN] NEXO v9.9.2-FASE4 iniciando...');
    console.log('[MAIN] Storage keys disponibles:', Object.keys(localStorage).filter(function(k) { return k.indexOf('nexo') === 0; }));
    NEXO_DIAG.init();
    window.NEXO.diag = NEXO_DIAG;
    _ensureDOMStructure();
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
    overlay.innerHTML = '<div class="perm-overlay-content"> <h2>Permisos BLE Requeridos</h2> <p>NEXO necesita acceso a Bluetooth y Dispositivos Cercanos para comunicacion P2P.</p> <p class="perm-sub">Si ya los concediste en Ajustes, la app continuara automaticamente.</p> <button id="perm-btn-grant" class="perm-btn-primary">Conceder Permisos</button> <button id="perm-btn-settings" class="perm-btn-secondary">Abrir Ajustes</button> <button id="perm-btn-skip" class="perm-btn-ghost">Continuar sin BLE</button> </div>';
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
          alert('Ve a Configuracion > Aplicaciones > NEXO > Permisos\nActiva "Dispositivos cercanos" y "Bluetooth"');
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
function _openChatFromNotification(deviceId) {
  try {
    if (!window.NEXO.app) return;
    var contact = vaultFindContactByNexoId(deviceId);
    if (!contact) {
      contact = { nexoId: deviceId, displayName: 'NEXO' };
      vaultSaveContact(contact);
    }
    if (!contact.name) contact.name = contact.displayName || 'NEXO';
    window.NEXO.app.activeContact = contact;
    if (window.NEXO.app.bleInterface) {
      window.NEXO.app.bleInterface._activeChatDeviceId = deviceId;
    }
    window.dispatchEvent(new CustomEvent('nexo:ble:openChat', { detail: { contact: contact } }));
    document.body.classList.add('chat-view-active');
    var backBtn = document.getElementById('chat-back-btn');
    if (backBtn) backBtn.classList.add('visible');
    var nameInput = document.getElementById('chat-contact-name');
    if (nameInput) nameInput.value = contact.name || 'NEXO';
    _loadPersistedMessages();
    console.log('[MAIN] Chat abierto desde notificacion:', deviceId);
  } catch (e) {
    console.warn('[MAIN] _openChatFromNotification error:', e);
  }
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
        if (msg && msg.senderNexoId) {
          vaultGetOrCreateContact(msg.senderNexoId, msg.senderName || 'NEXO');
        }
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
        onReact: function(id) { rem.success('Reaccion anadida', 'REACT_OK'); },
        onReply: function(id) { _focusInput(id ? ('@' + id.substr(0,8) + ' ') : ''); },
        onForward: function(id) { rem.info('Listo para reenviar', 'FORWARD_READY'); }
      }
    };
    window.NEXO.app = new NexoApp(nexoConfig);
    try {
      if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.NexoBLE) {
        window.Capacitor.Plugins.NexoBLE.addListener('onNotificationOpened', function(event) {
          if (event && event.deviceId) {
            setTimeout(function() {
              _openChatFromNotification(event.deviceId);
            }, 500);
          }
        });
      }
    } catch (notifErr) {
      console.log('[MAIN] Notificacion listener no disponible:', notifErr);
    }
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
          contacts: bi.getBLEContacts ? bi.getBLEContacts().length : 0
        });
      }
    } catch (logErr) { console.warn('[MAIN] Log BLE error:', logErr); }
    try {
      if (window.NEXO.app && window.NEXO.app.bleInterface) {
        var ack = createAckSystem(window.NEXO.app.bleInterface);
        window.NEXO.app.bleInterface.setAckSystem(ack);
        console.log('[MAIN] BleAckSystem vinculado OK');
      }
    } catch (ackErr) {
      console.warn('[MAIN] AckSystem no vinculado:', ackErr);
    }
    _setupMessageInput();
    _setupVaultToggle();
    _setupChatHeader();
    _setupKeyboardShortcuts();
    _setupJumpButton();
    _setupFABButton();
    _setupBackButton();
    _loadPersistedMessages();
    try {
      _autoScan = createAutoScan(window.NEXO.app.bleInterface);
      window.addEventListener('nexo:ble:deviceConnected', function(e) {
        if (e && e.detail && e.detail.deviceId) {
          _autoScan.unregisterDevice(e.detail.deviceId);
        }
      });
      window.addEventListener('nexo:ble:deviceDisconnected', function(e) {
        if (e && e.detail && e.detail.deviceId) {
          var nid = e.detail.nexoId || e.detail.deviceId;
          _autoScan.registerKnownDevice(e.detail.deviceId, nid);
          _autoScan.start();
        }
      });
      window.addEventListener('nexo:vault:messagesLoaded', function(e) {
        if (e && e.detail && Array.isArray(e.detail.messages)) {
          e.detail.messages.forEach(function(msg) {
            _renderMessage(msg, true);
          });
        }
      });
      window.addEventListener('nexo:ble:messageReceived', function(e) {
        if (e && e.detail) {
          var msg = e.detail;
          if (msg.senderNexoId) {
            vaultGetOrCreateContact(msg.senderNexoId, msg.senderName || 'NEXO');
          }
          _renderMessage(msg);
          if (window.NEXO.app && typeof window.NEXO.app.onMessage === 'function') {
            try { window.NEXO.app.onMessage(msg); } catch(omErr) {}
          }
        }
      });
      console.log('[MAIN] Fase 4 hooks OK');
    } catch (f4Err) {
      console.warn('[MAIN] Fase 4 init warn:', f4Err);
    }
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

    var _isComposing = false;
    var _longPressTimer = null;
    var _isLongPress = false;
    var LONG_PRESS_MS = 600;

    function _updateBtnState() {
      var hasText = input.value.trim().length > 0;
      btn.classList.toggle('mic-mode', !hasText);
    }

    _updateBtnState();

    var _doSend = async function() {
      var text = input.value.trim();
      if (!text) return;
      input.value = '';
      _updateBtnState();
      input.focus();
      try {
        await window.NEXO.app.sendMessage({ content: text });
      } catch (e) {}
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
          window.NEXO.app.activeContact.displayName = newName;
        }
        try {
          var activeId = window.NEXO.app && window.NEXO.app.activeContact ? window.NEXO.app.activeContact.nexoId : null;
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
// FIX: No interferir con ble_interface.js que ya maneja el FAB.
// Agregar listener extra causaba doble toggle: abria y cerraba el panel.
function _setupFABButton() {
  try {
    var fabBtn = document.getElementById('ble-fab-btn');
    if (!fabBtn) return;
    var hasBLE = window.bleInterface || (window.NEXO.app && window.NEXO.app.bleInterface);
    if (hasBLE) {
      return;
    }
    fabBtn.innerHTML = '<svg viewBox="0 0 24 24" width="28" height="28" fill="#fff"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>';
    if (!fabBtn._nexoFabBound) {
      fabBtn.addEventListener('click', function() {
        if (window.bleInterface && typeof window.bleInterface.togglePanel === 'function') {
          window.bleInterface.togglePanel();
        }
      });
      fabBtn._nexoFabBound = true;
    }
  } catch (e) {
    console.warn('[MAIN] _setupFABButton error:', e);
  }
}
// FIX v9.9.1: Usar nexoId para key de storage cuando está disponible
function _getContactStorageKey() {
  var contactId = 'default';
  try {
    if (window.NEXO.app && window.NEXO.app.activeContact) {
      contactId = window.NEXO.app.activeContact.nexoId || window.NEXO.app.activeContact.id || 'default';
    } else if (window.NEXO.app && window.NEXO.app.bleInterface && window.NEXO.app.bleInterface._activeChatDeviceId) {
      contactId = window.NEXO.app.bleInterface._activeChatDeviceId;
    }
  } catch (e) {}
  return 'nexo_messages_' + contactId;
}
function _saveMessageToStorage(msg) {
  try {
    if (!msg || !msg.messageId) return;
    var contactId = _getCurrentContactId();
    if (contactId) {
      vaultAppendMessage(contactId, msg);
    }
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
    var contactId = _getCurrentContactId();
    if (contactId) {
      vaultUpdateMessageStatus(contactId, messageId, status);
    }
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
    var contactId = _getCurrentContactId();
    if (!contactId) return;
    var vaultMessages = vaultLoadMessages(contactId);
    if (vaultMessages && vaultMessages.length > 0) {
      vaultMessages.forEach(function(msg) {
        _renderMessage(msg, true);
      });
      return;
    }
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
    contentDiv.style.borderRadius = '12px';
    contentDiv.style.overflow = 'hidden';
    if (attachment) {
      if (attachment.type === 'image') {
        var img = document.createElement('img');
        img.src = 'data:image/' + (attachment.meta.format || 'jpeg') + ';base64,' + attachment.payload;
        img.style.maxWidth = '220px';
        img.style.maxHeight = '280px';
        img.style.display = 'block';
        img.style.cursor = 'pointer';
        img.dataset.fullscreenSrc = img.src;
        img.dataset.fullscreenType = 'image';
        img.onclick = function(e) {
          e.stopPropagation();
          _openFullscreenMedia(img.dataset.fullscreenSrc, 'image');
        };
        img.onload = function() {
          var mc = document.getElementById('messages-container');
          if (mc) mc.scrollTop = mc.scrollHeight;
        };
        contentDiv.appendChild(img);
      } else if (attachment.type === 'video') {
        var videoWrapper = document.createElement('div');
        videoWrapper.className = 'video-attachment';
        videoWrapper.style.cssText = 'position:relative;max-width:220px;max-height:280px;overflow:hidden;background:#000;cursor:pointer;';
        var video = document.createElement('video');
        var vFmt = attachment.meta.format || 'webm';
        var vMime = 'video/' + vFmt;
        var vByteChars = atob(attachment.payload);
        var vByteNums = new Array(vByteChars.length);
        for (var vi = 0; vi < vByteChars.length; vi++) {
          vByteNums[vi] = vByteChars.charCodeAt(vi);
        }
        var vByteArray = new Uint8Array(vByteNums);
        var vBlob = new Blob([vByteArray], { type: vMime });
        var vSrc = URL.createObjectURL(vBlob);
        _objectURLRegistry.push(vSrc); // FIX: trackear para cleanup
        video.src = vSrc;
        video.style.cssText = 'width:100%;height:auto;max-height:280px;display:block;';
        video.playsInline = true;
        video.muted = true;
        video.preload = 'metadata';
        video.dataset.fullscreenSrc = vSrc;
        video.dataset.fullscreenType = 'video';
        var playOverlay = document.createElement('div');
        playOverlay.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.3);pointer-events:none;';
        playOverlay.innerHTML = '<svg viewBox="0 0 24 24" width="40" height="40" fill="#fff" style="opacity:0.9;"><path d="M8 5v14l11-7z"/></svg>';
        videoWrapper.appendChild(video);
        videoWrapper.appendChild(playOverlay);
        videoWrapper.onclick = function(e) {
          e.stopPropagation();
          _openFullscreenMedia(video.dataset.fullscreenSrc, 'video');
        };
        contentDiv.appendChild(videoWrapper);
      } else if (attachment.type === 'file') {
        var fileType = (attachment.meta.type || '').toLowerCase();
        var isImageFile = fileType.indexOf('image') === 0;
        var isVideoFile = fileType.indexOf('video') === 0;
        if (isImageFile || isVideoFile) {
          var mediaWrapper = document.createElement('div');
          mediaWrapper.style.cssText = 'position:relative;max-width:220px;max-height:280px;overflow:hidden;background:#000;cursor:pointer;';
          if (isImageFile) {
            var fimg = document.createElement('img');
            fimg.src = 'data:' + attachment.meta.type + ';base64,' + attachment.payload;
            fimg.style.cssText = 'width:100%;height:auto;max-height:280px;display:block;';
            fimg.dataset.fullscreenSrc = fimg.src;
            fimg.dataset.fullscreenType = 'image';
            mediaWrapper.appendChild(fimg);
          } else {
            var fvideo = document.createElement('video');
            var fvByteChars = atob(attachment.payload);
            var fvByteNums = new Array(fvByteChars.length);
            for (var fvi = 0; fvi < fvByteChars.length; fvi++) {
              fvByteNums[fvi] = fvByteChars.charCodeAt(fvi);
            }
            var fvByteArray = new Uint8Array(fvByteNums);
            var fvBlob = new Blob([fvByteArray], { type: attachment.meta.type });
            var fvSrc = URL.createObjectURL(fvBlob);
            _objectURLRegistry.push(fvSrc); // FIX: trackear para cleanup
            fvideo.src = fvSrc;
            fvideo.style.cssText = 'width:100%;height:auto;max-height:280px;display:block;';
            fvideo.playsInline = true;
            fvideo.muted = true;
            fvideo.preload = 'metadata';
            fvideo.dataset.fullscreenSrc = fvSrc;
            fvideo.dataset.fullscreenType = 'video';
            var fplayOverlay = document.createElement('div');
            fplayOverlay.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.3);pointer-events:none;';
            fplayOverlay.innerHTML = '<svg viewBox="0 0 24 24" width="40" height="40" fill="#fff" style="opacity:0.9;"><path d="M8 5v14l11-7z"/></svg>';
            mediaWrapper.appendChild(fvideo);
            mediaWrapper.appendChild(fplayOverlay);
          }
          mediaWrapper.onclick = function(e) {
            e.stopPropagation();
            var src = isImageFile ? fimg.dataset.fullscreenSrc : fvideo.dataset.fullscreenSrc;
            var type = isImageFile ? 'image' : 'video';
            _openFullscreenMedia(src, type);
          };
          contentDiv.appendChild(mediaWrapper);
        } else {
          contentDiv.innerHTML = '<div style="padding:8px 12px;background:rgba(0,0,0,0.3);border-radius:10px;">📎 <b>Archivo</b><span style="font-size:12px;opacity:0.7;">' + (attachment.meta.name || 'archivo') + '</span></div>';
        }
      } else if (attachment.type === 'location') {
        var loc = attachment.meta;
        var lat = (loc && loc.lat) ? loc.lat : 0;
        var lng = (loc && loc.lng) ? loc.lng : 0;
        var mapsUrl = 'https://www.google.com/maps/search/?api=1&query=' + lat + ',' + lng;
        var wazeUrl = 'https://waze.com/ul?ll=' + lat + ',' + lng + '&navigate=yes';
        var osmUrl = 'https://static-maps.openstreetmap.de/staticmap.php?center=' + lat + ',' + lng + '&zoom=15&size=300x150&markers=' + lat + ',' + lng + ',red-pushpin';
        var locHtml = '<div style="border-radius:12px;overflow:hidden;background:rgba(0,0,0,0.3);max-width:260px;">';
        locHtml += '<div style="position:relative;width:100%;height:120px;background:linear-gradient(135deg,#1a1a2e,#0f3460);overflow:hidden;">';
        locHtml += '<img src="' + osmUrl + '" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block;z-index:1;" onerror="this.style.display=\'none\'">';
        locHtml += '<div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;z-index:0;">';
        locHtml += '<svg viewBox="0 0 24 24" width="32" height="32" fill="#FF3B30"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/></svg>';
        locHtml += '<span style="font-size:11px;color:#aaa;">' + lat.toFixed(4) + ', ' + lng.toFixed(4) + '</span>';
        locHtml += '</div></div>';
        locHtml += '<div style="padding:8px 12px;"> <b>Ubicacion</b><span style="font-size:12px;opacity:0.7;">' + lat.toFixed(4) + ', ' + lng.toFixed(4) + '</span></div>';
        locHtml += '<div style="display:flex;gap:8px;padding:0 12px 10px;">';
        locHtml += '<a href="' + mapsUrl + '" target="_blank" style="flex:1;text-align:center;padding:6px;background:rgba(0,130,252,0.3);border-radius:6px;color:#fff;text-decoration:none;font-size:12px;">Maps</a>';
        locHtml += '<a href="' + wazeUrl + '" target="_blank" style="flex:1;text-align:center;padding:6px;background:rgba(107,78,255,0.3);border-radius:6px;color:#fff;text-decoration:none;font-size:12px;">Waze</a>';
        locHtml += '</div></div>';
        contentDiv.innerHTML = locHtml;
      } else if (attachment.type === 'audio') {
        var dur = (attachment.meta && attachment.meta.duration) ? attachment.meta.duration : 0;
        var durStr = _fmtTime(dur);
        var audioId = 'audio_' + msgId;
        var fmt = (attachment.meta && attachment.meta.format) ? attachment.meta.format : 'webm';
        var mime = (attachment.meta && attachment.meta.mimeType) ? attachment.meta.mimeType : ('audio/' + fmt);
        var byteChars = atob(attachment.payload);
        var byteNums = new Array(byteChars.length);
        for (var i = 0; i < byteChars.length; i++) {
          byteNums[i] = byteChars.charCodeAt(i);
        }
        var byteArray = new Uint8Array(byteNums);
        var audioBlob = new Blob([byteArray], { type: mime });
        var audioSrc = URL.createObjectURL(audioBlob);
        _objectURLRegistry.push(audioSrc); // FIX: trackear para cleanup
        var audioHtml = '<div style="display:flex;align-items:center;gap:10px;padding:8px 12px;min-width:200px;" id="' + audioId + '_wrap">';
        audioHtml += '<button id="' + audioId + '_play" style="width:36px;height:36px;border-radius:50%;background:rgba(255,255,255,0.15);border:none;color:#fff;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:14px;flex-shrink:0;">▶</button>';
        audioHtml += '<div style="flex:1;min-width:0;">';
        audioHtml += '<div id="' + audioId + '_wave" style="height:24px;display:flex;align-items:flex-end;gap:2px;opacity:0.6;">';
        for (var w = 0; w < 24; w++) {
          var h = 4 + Math.random() * 16;
          audioHtml += '<div class="wave-bar" data-idx="' + w + '" style="width:3px;height:' + h + 'px;background:#fff;border-radius:1px;flex-shrink:0;transition:height 0.15s ease;"></div>';
        }
        audioHtml += '</div>';
        audioHtml += '<div id="' + audioId + '_time" style="font-size:11px;color:#aaa;margin-top:3px;">00:00 / ' + durStr + '</div>';
        audioHtml += '</div></div>';
        contentDiv.innerHTML = audioHtml;
        setTimeout(function() {
          var btn = document.getElementById(audioId + '_play');
          var timeEl = document.getElementById(audioId + '_time');
          var waveEl = document.getElementById(audioId + '_wave');
          if (!btn) return;
          var audioEl = new Audio(audioSrc);
          var playing = false;
          var progressInterval = null;
          var animInterval = null;
          function _updateTime() {
            if (!timeEl || !audioEl) return;
            var cur = Math.floor(audioEl.currentTime || 0);
            timeEl.textContent = _fmtTime(cur) + ' / ' + durStr;
          }
          function _animateWave() {
            if (!waveEl) return;
            var bars = waveEl.querySelectorAll('.wave-bar');
            for (var b = 0; b < bars.length; b++) {
              var nh = 4 + Math.random() * 16;
              bars[b].style.height = nh + 'px';
            }
          }
          function _pausePlayback() {
            playing = false;
            btn.innerHTML = '▶';
            if (progressInterval) { clearInterval(progressInterval); progressInterval = null; }
            if (animInterval) { clearInterval(animInterval); animInterval = null; }
            if (audioEl) {
              audioEl.pause();
            }
            if (waveEl) {
              var bars = waveEl.querySelectorAll('.wave-bar');
              for (var b = 0; b < bars.length; b++) {
                bars[b].style.height = (4 + Math.random() * 8) + 'px';
              }
            }
          }
          function _stopPlayback() {
            _pausePlayback();
            if (audioEl) {
              audioEl.currentTime = 0;
            }
            _updateTime();
          }
          audioEl.onended = function() { _stopPlayback(); };
          audioEl.onerror = function(e) {
            console.log('[AUDIO] Error reproduciendo:', e);
            _stopPlayback();
            if (timeEl) timeEl.textContent = 'Error';
          };
          btn.onclick = function(e) {
            e.stopPropagation();
            if (!playing) {
              audioEl.play().then(function() {
                btn.innerHTML = '⏸';
                playing = true;
                progressInterval = setInterval(_updateTime, 500);
                animInterval = setInterval(_animateWave, 200);
              }).catch(function(err) {
                console.log('[AUDIO] Play error:', err.message);
                _stopPlayback();
              });
            } else {
              _pausePlayback();
            }
          };
        }, 0);
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
    msg.innerHTML = '<h3>⚠ Error de Inicializacion</h3> <p>La app no pudo iniciar completamente.</p>';
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
    var app = document.getElementById('app');
    var contactsView = document.getElementById('contacts-view');
    var backBtn = document.getElementById('chat-back-btn');
    
    if (app) {
      app.style.transition = 'transform 0.3s ease, opacity 0.3s ease';
      app.style.transform = 'translateX(100%)';
      app.style.opacity = '0';
    }
    
    if (contactsView) {
      contactsView.style.display = 'flex';
      contactsView.style.opacity = '0';
      contactsView.style.transform = 'translateX(-20%)';
      contactsView.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
      void contactsView.offsetWidth;
      contactsView.style.opacity = '1';
      contactsView.style.transform = 'translateX(0)';
    }
    
    setTimeout(function() {
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
      
      if (app) {
        app.style.transition = '';
        app.style.transform = '';
        app.style.opacity = '';
      }
      if (contactsView) {
        contactsView.style.transition = '';
        contactsView.style.transform = '';
        contactsView.style.opacity = '';
      }
    }, 300);
    
  } catch (e) {
    console.warn('[MAIN] _doChatBack error:', e);
  }
}
window.NEXO_updateMessageStatus = _updateMessageStatus;
if (typeof module !== 'undefined' && module && module.hot) module.hot.accept();
