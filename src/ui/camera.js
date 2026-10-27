/**
 * NEXO — Cámara (sacada de main.js en la ronda 2752, sin cambios en su código): vista previa, foto y vídeo, linterna,
 * temporizador de grabación, revisión antes de enviar y pausa del Bluetooth mientras la cámara está abierta.
 * Lo que usa del resto de la app (enviar, galería…) se lo da main.js al arrancar con cameraUse().
 */
import { PREVIEW_MAX_SECONDS, _videoFormat } from './video_tools.js';
import { _getCurrentContactId } from './chat_format.js';

// [pegamento] Lo que la cámara usa del resto de la app: main.js lo da al arrancar (cameraUse), antes de que se abra la cámara
var _wdReach, _waitForBLEReady, _sendAttachment, _closeAttachMenu, _releaseMedia, _handleGallery, _sendVideo;
export function cameraUse(d) {
  _wdReach = d._wdReach; _waitForBLEReady = d._waitForBLEReady; _sendAttachment = d._sendAttachment;
  _closeAttachMenu = d._closeAttachMenu; _releaseMedia = d._releaseMedia; _handleGallery = d._handleGallery; _sendVideo = d._sendVideo;
} // [/pegamento]


export var _cameraActiveStream = null;

export var _cameraPreviewMode = 'photo';

export var _cameraPreviewRecording = false;

export var _cameraPreviewMediaRecorder = null;

export var _cameraPreviewVideoChunks = [];

export var _cameraVideoStartTime = 0;

export var _cameraTimer = null;      // v9.9.46: contador de grabación

export var _cameraTorchOn = false;

export var _cameraReview = null;     // { type: 'photo'|'video', b64, w, h, blob, url, mime, duration }
var _cameraReviewOnce = false;       // #94 «ver una vez»: la foto en revisión se marcó para verse una sola vez

export function _showCameraPreviewOverlay() {
  var overlay = document.getElementById('camera-preview-overlay');
  if (!overlay) return;
  overlay.classList.remove('hidden');
  _cameraPreviewMode = 'photo';
  _cameraPreviewRecording = false;
  _cameraPreviewVideoChunks = [];
  _cameraVideoStartTime = 0;
  _closeReview();
  _updateCameraPreviewUI();
}

export function _hideCameraPreviewOverlay() {
  var overlay = document.getElementById('camera-preview-overlay');
  if (overlay) overlay.classList.add('hidden');
  _closeReview();
  _stopCameraPreview();
  var ble = window.bleInterface || (window.NEXO && window.NEXO.app && window.NEXO.app.bleInterface);
  if (ble && typeof ble.resumeBLEAfterCamera === 'function') {
    // Llamada inmediata + espera posterior controlada en el caller
    setTimeout(function() {
      ble.resumeBLEAfterCamera();
    }, 400);
  }
}

// Ronda 2801/#101: el «atrás» de Android (MainActivity) cierra la cámara con su limpieza (para la cámara, reanuda BLE).
if (typeof window !== 'undefined') window.__nexoHideCamera = _hideCameraPreviewOverlay;

// ===================== v9.9.46: cámara tipo WhatsApp =====================
// Pestañas VÍDEO / FOTO, disparador grande (rojo en vídeo; cuadrado mientras graba), contador, linterna,
// girar, acceso a la galería y revisión antes de enviar (Repetir / Enviar). Cámara frontal en espejo, como
// un espejo de verdad; la foto sale igual que se ve. Foto con más resolución (más aún si hay Wi-Fi Direct).
export function _photoTarget(cid) { return _wdReach(cid) ? { max: 1600, q: 0.85 } : { max: 800, q: 0.65 }; }

export function _videoLimitSec(cid) { return _wdReach(cid) ? 110 : PREVIEW_MAX_SECONDS; }

export function _updateCameraPreviewUI() {
  var captureBtn = document.getElementById('camera-btn-capture');
  var status = document.getElementById('camera-preview-status');
  if (!captureBtn) return;
  var isVideo = _cameraPreviewMode === 'video';
  captureBtn.classList.toggle('video-mode', isVideo);
  captureBtn.classList.toggle('recording', isVideo && _cameraPreviewRecording);
  ['video', 'photo'].forEach(function(m) {
    var b = document.getElementById('cam-mode-' + m);
    if (b) b.classList.toggle('active', _cameraPreviewMode === m);
  });
  var modes = document.querySelector('#camera-preview-overlay .cam-modes');
  if (modes) modes.style.visibility = _cameraPreviewRecording ? 'hidden' : 'visible';
  var timer = document.getElementById('cam-timer');
  if (timer) timer.classList.toggle('hidden', !_cameraPreviewRecording);
  var flip = document.getElementById('camera-btn-flip');
  if (flip) flip.style.visibility = _cameraPreviewRecording ? 'hidden' : 'visible';
  var gal = document.getElementById('camera-btn-gallery');
  if (gal) gal.style.visibility = _cameraPreviewRecording ? 'hidden' : 'visible';
  if (status && !status.dataset.error) status.textContent = '';
}

export function _cameraError(text) {
  var status = document.getElementById('camera-preview-status');
  if (!status) return;
  status.dataset.error = text ? '1' : '';
  status.textContent = text || '';
}

export function _setupVideoRecorder(stream) {
  var mimeType = '';
  var candidates = [
    'video/mp4',
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm;codecs=h264,opus',
    'video/webm',
    'video/mp4;codecs=avc1.42E01E,mp4a.40.2'
  ];
  if (typeof MediaRecorder === 'undefined') { _cameraError('Este teléfono no permite grabar vídeo aquí'); return; }
  for (var i = 0; i < candidates.length; i++) {
    if (MediaRecorder.isTypeSupported(candidates[i])) { mimeType = candidates[i]; break; }
  }
  try {
    var options = mimeType ? { mimeType: mimeType } : {};
    options.videoBitsPerSecond = CAMERA_HD_BPS; // v9.9.30: 720p a 1,5 Mbps (el HD tarda menos)
    _cameraPreviewMediaRecorder = new MediaRecorder(stream, options);
    _cameraPreviewVideoChunks = [];
    _cameraPreviewMediaRecorder.ondataavailable = function(e) {
      if (e.data && e.data.size > 0) _cameraPreviewVideoChunks.push(e.data);
    };
    _cameraPreviewMediaRecorder.onerror = function(e) {
      console.log('[CAMERA] MediaRecorder error:', e.message);
      _cameraPreviewRecording = false;
      _stopCameraTimer();
      _updateCameraPreviewUI();
    };
  } catch (recErr) {
    console.log('[CAMERA] MediaRecorder init error:', recErr.message);
    _cameraError('Error: grabación no soportada');
  }
}

export function _startCameraPreview() {
  var container = document.getElementById('camera-preview-container');
  if (!container) return;
  var overlay = document.getElementById('camera-preview-overlay');
  if (overlay && overlay.classList.contains('hidden')) overlay.classList.remove('hidden');
  _cameraError('');
  var facing = container.dataset.facing || 'environment';
  var needAudio = _cameraPreviewMode === 'video';
  var isFront = facing === 'user';
  // Foto: la mayor resolución que dé la cámara (hasta 1080p); vídeo: 720p (lo que se envía)
  var size = _cameraPreviewMode === 'photo' ? { width: { ideal: 1920 }, height: { ideal: 1080 } } : { width: { ideal: 1280 }, height: { ideal: 720 } };
  var constraints = {
    video: Object.assign({ facingMode: isFront ? { exact: 'user' } : { ideal: 'environment' } }, size),
    audio: needAudio
  };
  var token = _cameraStartToken = (_cameraStartToken || 0) + 1;
  function _onStreamSuccess(stream) {
    if (token !== _cameraStartToken) { stream.getTracks().forEach(function(t) { t.stop(); }); return; }
    _cameraActiveStream = stream;
    var video = document.createElement('video');
    video.autoplay = true;
    video.playsInline = true;
    video.muted = true;
    video.srcObject = stream;
    container.innerHTML = '';
    container.classList.toggle('mirror', isFront);
    container.appendChild(video);
    video.play().catch(function(e) { console.log('[CAMERA] play error:', e.message); });
    container.dataset.stream = 'active';
    // Linterna (solo si la cámara la tiene)
    _cameraTorchOn = false;
    var torch = document.getElementById('camera-btn-torch');
    var track = stream.getVideoTracks && stream.getVideoTracks()[0];
    var caps = (track && typeof track.getCapabilities === 'function') ? track.getCapabilities() : {};
    if (torch) { torch.classList.toggle('hidden', !(caps && caps.torch)); torch.classList.remove('on'); }
    if (_cameraPreviewMode === 'video') _setupVideoRecorder(stream);
  }
  function _onStreamError(err) {
    console.log('[CAMERA] Error getUserMedia:', err.name, err.message);
    var fallback = { video: isFront ? { facingMode: 'user' } : { facingMode: 'environment' }, audio: needAudio };
    navigator.mediaDevices.getUserMedia(fallback).then(_onStreamSuccess).catch(function(err2) {
      console.log('[CAMERA] Fallback error:', err2.name, err2.message);
      _cameraError('No se pudo abrir la cámara: ' + err2.message);
    });
  }
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { _cameraError('Cámara no disponible'); return; }
  navigator.mediaDevices.getUserMedia(constraints).then(_onStreamSuccess).catch(_onStreamError);
}

export var _cameraStartToken = 0;

export function _stopCameraPreview() {
  var wasRecording = _cameraPreviewMediaRecorder && _cameraPreviewMediaRecorder.state === 'recording';
  if (wasRecording) {
    try { _cameraPreviewMediaRecorder.stop(); } catch (e) {}
  }
  _cameraStartToken++;
  var container = document.getElementById('camera-preview-container');
  if (container) {
    var oldVideo = container.querySelector('video');
    if (oldVideo && oldVideo.srcObject) {
      oldVideo.srcObject.getTracks().forEach(function(t) { t.stop(); });
    }
    container.innerHTML = '';
  }
  if (_cameraActiveStream) {
    _cameraActiveStream.getTracks().forEach(function(t) { t.stop(); });
    _cameraActiveStream = null;
  }
  _stopCameraTimer();
  _cameraPreviewRecording = false;
  _cameraPreviewMediaRecorder = null;
  _cameraPreviewVideoChunks = [];
  _cameraVideoStartTime = 0;
}

export function _flipCamera() {
  var container = document.getElementById('camera-preview-container');
  if (!container || _cameraPreviewRecording) return;
  container.dataset.facing = (container.dataset.facing || 'environment') === 'environment' ? 'user' : 'environment';
  _stopCameraPreview();
  setTimeout(_startCameraPreview, 300);
}

export function _setCameraMode(mode) {
  if (_cameraPreviewRecording || _cameraPreviewMode === mode) return;
  _cameraPreviewMode = mode;
  _updateCameraPreviewUI();
  _stopCameraPreview();
  _startCameraPreview();
}

export function _toggleCameraMode() { _setCameraMode(_cameraPreviewMode === 'photo' ? 'video' : 'photo'); }

export function _toggleTorch() {
  var track = _cameraActiveStream && _cameraActiveStream.getVideoTracks()[0];
  if (!track || typeof track.applyConstraints !== 'function') return;
  var on = !_cameraTorchOn;
  track.applyConstraints({ advanced: [{ torch: on }] }).then(function() {
    _cameraTorchOn = on;
    var b = document.getElementById('camera-btn-torch');
    if (b) b.classList.toggle('on', on);
  }).catch(function(e) { console.log('[CAMERA] Linterna:', e && e.message); });
}

export function _startCameraTimer(limitSec) {
  _stopCameraTimer();
  var txt = document.getElementById('cam-timer-text');
  var tick = function() {
    var sec = Math.floor((Date.now() - _cameraVideoStartTime) / 1000);
    if (txt) txt.textContent = ('0' + Math.floor(sec / 60)).slice(-2) + ':' + ('0' + (sec % 60)).slice(-2) + (limitSec - sec <= 10 ? ' (' + Math.max(0, limitSec - sec) + ')' : '');
    if (sec >= limitSec && _cameraPreviewRecording) _handleCameraCapture(); // límite: se para sola
  };
  tick();
  _cameraTimer = setInterval(tick, 500);
}

export function _stopCameraTimer() { if (_cameraTimer) { clearInterval(_cameraTimer); _cameraTimer = null; } }

export function _capturePhoto() {
  var container = document.getElementById('camera-preview-container');
  if (!container) return;
  var video = container.querySelector('video');
  if (!video || !video.videoWidth) { _cameraError('La cámara aún no está lista'); return; }
  var cid = _getCurrentContactId();
  var target = _photoTarget(cid);
  var vw = video.videoWidth, vh = video.videoHeight;
  var scale = Math.min(1, target.max / Math.max(vw, vh));
  var canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(vw * scale));
  canvas.height = Math.max(1, Math.round(vh * scale));
  var ctx = canvas.getContext('2d');
  var mirror = container.classList.contains('mirror');
  if (mirror) { ctx.translate(canvas.width, 0); ctx.scale(-1, 1); } // igual que se ve (espejo)
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  var base64 = canvas.toDataURL('image/jpeg', target.q).split(',')[1];
  console.log('[CAMERA] Foto ' + canvas.width + 'x' + canvas.height + ' ' + Math.round(base64.length * 3 / 4 / 1024) + ' KB' + (mirror ? ' (espejo)' : ''));
  _stopCameraPreview();
  _resumeBleFromCamera();
  _showReview({ type: 'photo', b64: base64, w: canvas.width, h: canvas.height });
}

export function _handleCameraCapture() {
  if (_cameraReview) return;
  if (_cameraPreviewMode === 'photo') { _capturePhoto(); return; }
  var rec = _cameraPreviewMediaRecorder;
  if (!_cameraPreviewRecording) {
    if (!rec || rec.state !== 'inactive') return;
    _cameraPreviewVideoChunks = [];
    _cameraVideoStartTime = Date.now();
    try {
      try { rec.start(100); } catch (tsErr) { rec.start(); }
      _cameraPreviewRecording = true;
      _startCameraTimer(_videoLimitSec(_getCurrentContactId()));
      _updateCameraPreviewUI();
      console.log('[CAMERA] Grabación iniciada');
    } catch (startErr) {
      console.log('[CAMERA] Error al iniciar grabación:', startErr.message);
      _cameraPreviewRecording = false;
    }
    return;
  }
  // Parar: se juntan los trozos y se pasa a revisar
  if (!rec || rec.state !== 'recording') return;
  _cameraPreviewRecording = false;
  _stopCameraTimer();
  _updateCameraPreviewUI();
  var duration = Math.max(1, Math.round((Date.now() - _cameraVideoStartTime) / 1000));
  var mimeType = (rec.mimeType || 'video/webm').split(';')[0];
  rec.onstop = function() {
    var blob = new Blob(_cameraPreviewVideoChunks, { type: mimeType });
    if (!blob.size) { _cameraError('Error: el vídeo quedó vacío'); return; }
    console.log('[CAMERA] Vídeo listo ' + Math.round(blob.size / 1024) + ' KB dur=' + duration);
    _stopCameraPreview();
    _resumeBleFromCamera();
    _showReview({ type: 'video', blob: blob, mime: mimeType, duration: duration });
  };
  try { rec.requestData(); } catch (e) {}
  try { rec.stop(); } catch (e) { rec.onstop(); }
}

export function _resumeBleFromCamera() {
  var ble = window.bleInterface || (window.NEXO && window.NEXO.app && window.NEXO.app.bleInterface);
  if (ble && typeof ble.resumeBLEAfterCamera === 'function') setTimeout(function() { ble.resumeBLEAfterCamera(); }, 300);
}

export function _pauseBleForCamera() {
  var ble = window.bleInterface || (window.NEXO && window.NEXO.app && window.NEXO.app.bleInterface);
  if (ble && typeof ble.pauseBLEForCamera === 'function') ble.pauseBLEForCamera();
}

// Revisión antes de enviar
export function _showReview(r) {
  _cameraReview = r;
  // #94: cada revisión empieza sin «una vez»; el toggle solo para fotos (el vídeo de una vez queda para más adelante)
  _cameraReviewOnce = false;
  var onceBtn = document.getElementById('cam-review-once');
  if (onceBtn) { onceBtn.style.display = (r.type === 'photo') ? 'inline-flex' : 'none'; onceBtn.classList.remove('active'); }
  var box = document.getElementById('cam-review'), media = document.getElementById('cam-review-media');
  if (!box || !media) return;
  media.innerHTML = '';
  if (r.type === 'photo') {
    var img = document.createElement('img');
    img.src = 'data:image/jpeg;base64,' + r.b64;
    media.appendChild(img);
  } else {
    r.url = URL.createObjectURL(r.blob);
    var v = document.createElement('video');
    v.src = r.url; v.controls = true; v.autoplay = true; v.loop = true; v.playsInline = true;
    media.appendChild(v);
  }
  box.classList.remove('hidden');
}

export function _closeReview() {
  var r = _cameraReview;
  _cameraReview = null;
  var box = document.getElementById('cam-review'), media = document.getElementById('cam-review-media');
  if (media) { _releaseMedia(media); media.innerHTML = ''; }
  if (box) box.classList.add('hidden');
  if (r && r.url) { try { URL.revokeObjectURL(r.url); } catch (e) {} }
}

export function _retakeReview() {
  _closeReview();
  _pauseBleForCamera();
  setTimeout(_startCameraPreview, 200);
}

export function _sendReview() {
  var r = _cameraReview;
  if (!r) return;
  var once = _cameraReviewOnce && r.type === 'photo'; // #94: «ver una vez» solo para fotos por ahora
  _cameraReview = null; // la URL del vídeo se libera al cerrar; el blob sigue vivo para enviarlo
  _cameraReviewOnce = false;
  var url = r.url;
  _hideCameraPreviewOverlay();
  if (url) { try { URL.revokeObjectURL(url); } catch (e) {} }
  _waitForBLEReady(4500).then(function() {
    if (r.type === 'photo') _sendAttachment('image', r.b64, { format: 'jpeg', width: r.w, height: r.h, once: once });
    else _sendVideo(r.blob, { format: _videoFormat(r.mime), duration: r.duration });
  });
}

// #94: alternar «ver una vez» en la revisión de la foto (👁). Se ata en _bindCameraPreviewHandlers.
function _toggleReviewOnce() {
  _cameraReviewOnce = !_cameraReviewOnce;
  var b = document.getElementById('cam-review-once');
  if (b) b.classList.toggle('active', _cameraReviewOnce);
}

export function _bindCameraPreviewHandlers() {
  var on = function(id, fn) { var el = document.getElementById(id); if (el) el.addEventListener('click', function(e) { e.stopPropagation(); fn(); }); };
  on('camera-btn-close', _hideCameraPreviewOverlay);
  on('camera-btn-flip', _flipCamera);
  on('camera-btn-capture', _handleCameraCapture);
  on('camera-btn-torch', _toggleTorch);
  on('camera-btn-gallery', function() { _hideCameraPreviewOverlay(); _handleGallery(); });
  on('cam-mode-video', function() { _setCameraMode('video'); });
  on('cam-mode-photo', function() { _setCameraMode('photo'); });
  on('cam-review-retake', _retakeReview);
  on('cam-review-once', _toggleReviewOnce);
  on('cam-review-send', _sendReview);
}

export async function _handleCamera() {
  _closeAttachMenu();
  _pauseBleForCamera();
  await new Promise(function(r) { setTimeout(r, 200); });
  _showCameraPreviewOverlay();
  _startCameraPreview();
}

export var CAMERA_HD_BPS = 1500000;         // grabación 720p a 1,5 Mbps (antes ~2,5 por defecto)
