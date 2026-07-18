/**
 * src/main.js - Punto de entrada NEXO v9.9-FIX
 * FIX 2026-07-17:
 * 1. Video: burbuja visible con play icon + duracion
 * 2. Ubicacion: preview mapa Yandex + fallback visual + botones Maps/Waze
 * FIX 2026-07-18: Panel adjuntos inferior horizontal + icono compartir contacto
 */
import { NEXO_CONFIG } from './core/nexo_config.js';
import './styles/critical.css';
import { NEXO_DIAG } from './core/nap.js';
import { NexoApp, DEBUG } from './app/nexo_app.js';
import { rem } from './ui/rem.js';
import { ensureBLEPermissions, getPermissionShim } from './core/NexoPermissionShim.js';
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
var _audioChunks = [];
var _isRecording = false;
var _voiceStartTime = 0;
var _voiceTimerInterval = null;
// Camera preview state
var _cameraPreviewMode = 'photo';
var _cameraPreviewRecording = false;
var _cameraPreviewMediaRecorder = null;
var _cameraPreviewVideoChunks = [];
var _cameraActiveStream = null;
var _cameraVideoStartTime = 0;
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
// FIX 2026-07-18: Panel adjuntos inferior horizontal
function _toggleAttachMenu() {
var menu = document.getElementById('attach-menu');
var input = document.getElementById('message-input');
if (!menu) return;
if (menu.classList.contains('visible')) {
menu.classList.remove('visible');
menu.style.display = '';
} else {
if (input) input.blur();
menu.classList.add('visible');
menu.style.display = 'flex';
}
}
function _closeAttachMenu() {
var menu = document.getElementById('attach-menu');
if (menu) menu.classList.remove('visible');
}
// Camera overlay
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
closeBtn.onclick = function() { overlay.remove(); };
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
if (e.target === overlay) overlay.remove();
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
// FIX: onstop procesa y envia el video automaticamente
_cameraPreviewMediaRecorder.onstop = function() {
console.log('[CAMERA] Grabacion detenida, procesando...');
_processAndSendVideo();
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
function _stopCameraPreview() {
var wasRecording = _cameraPreviewMediaRecorder && _cameraPreviewMediaRecorder.state === 'recording';
if (wasRecording) {
try { _cameraPreviewMediaRecorder.stop(); } catch (e) {}
return;
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
// FIX: Video grabar -> detener -> enviar (mismo flujo que foto)
function _handleCameraCapture() {
if (_cameraPreviewMode === 'photo') {
_capturePhoto();
return;
}
// Modo video
if (!_cameraPreviewRecording) {
// INICIAR grabacion
if (!_cameraPreviewMediaRecorder || _cameraPreviewMediaRecorder.state !== 'inactive') {
console.log('[CAMERA] MediaRecorder no listo');
return;
}
_cameraPreviewVideoChunks = [];
_cameraVideoStartTime = Date.now();
try {
try {
_cameraPreviewMediaRecorder.start(100);
} catch (tsErr) {
_cameraPreviewMediaRecorder.start();
}
_cameraPreviewRecording = true;
_updateCameraPreviewUI();
console.log('[CAMERA] Grabacion iniciada');
} catch (startErr) {
console.log('[CAMERA] Error al iniciar grabacion:', startErr.message);
_cameraPreviewRecording = false;
}
} else {
// DETENER grabacion — FIX: solo stop(), onstop se encarga del resto
if (_cameraPreviewMediaRecorder && _cameraPreviewMediaRecorder.state === 'recording') {
try {
_cameraPreviewMediaRecorder.stop();
} catch (e) {
console.log('[CAMERA] Error al detener grabacion:', e.message);
_cameraPreviewRecording = false;
_updateCameraPreviewUI();
}
}
}
}
// FIX: onstop del MediaRecorder procesa y envia el video
function _processAndSendVideo() {
var duration = 0;
if (_cameraVideoStartTime > 0) {
duration = Math.round((Date.now() - _cameraVideoStartTime) / 1000);
}
var mimeType = (_cameraPreviewMediaRecorder && _cameraPreviewMediaRecorder.mimeType) ? _cameraPreviewMediaRecorder.mimeType : 'video/webm';
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
_sendAttachment('video', base64, { format: mimeType.split('/')[1] || 'webm', duration: duration, mimeType: mimeType });
_hideCameraPreviewOverlay();
};
reader.onerror = function() {
console.log('[CAMERA] Error leyendo video');
_cameraPreviewRecording = false;
_updateCameraPreviewUI();
};
reader.readAsDataURL(blob);
_cameraPreviewRecording = false;
_updateCameraPreviewUI();
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
// ELIMINADO: _handleVideo() — ya no existe boton de video en menu
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
// FIX: Si el plugin existe, usarlo. Si falla, NO hacer fallback (evita doble envio)
async function _handleLocation() {
_closeAttachMenu();
var plugins = _getAttachmentPlugins();
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
return;
} catch (pluginErr) {
console.log('[ATTACH:LOCATION] Plugin fallo:', pluginErr.message);
if (pluginErr.message && pluginErr.message.indexOf('denied') > -1) {
_showPermissionError('Ubicacion');
return;
}
_showPermissionError('Ubicacion: ' + (pluginErr.message || 'timeout'));
return;
}
}
_handleLocationFallback();
}
function _sendLocation(lat, lng, accuracy) {
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
// FIX 2026-07-18: Compartir contacto
function _handleContactShare() {
_closeAttachMenu();
console.log('[ATTACH] Compartir contacto - pendiente implementacion');
}
// FIX: Audio — pulsar graba, soltar detiene y envia
async function _handleVoiceToggle() {
var timerEl = document.getElementById('voice-timer');
if (!timerEl) {
timerEl = document.createElement('div');
timerEl.id = 'voice-timer';
timerEl.style.cssText = 'position:fixed;bottom:70px;left:50%;transform:translateX(-50%);background:rgba(255,59,48,0.9);color:#fff;padding:6px 16px;border-radius:20px;font-size:14px;font-weight:600;z-index:300;display:none;pointer-events:none;backdrop-filter:blur(4px);';
document.body.appendChild(timerEl);
}
if (!_isRecording) {
// INICIAR grabacion
try {
var stream = await navigator.mediaDevices.getUserMedia({ audio: true });
_mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
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
// Limpiar timer
if (_voiceTimerInterval) {
clearInterval(_voiceTimerInterval);
_voiceTimerInterval = null;
}
timerEl.style.display = 'none';
// Calcular duracion
var duration = 0;
if (_voiceStartTime > 0) {
duration = Math.round((Date.now() - _voiceStartTime) / 1000);
}
// Crear blob y enviar
var blob = new Blob(_audioChunks, { type: 'audio/webm' });
if (blob.size === 0) {
console.log('[ATTACH] Audio blob vacio');
_isRecording = false;
_updateMicIcon(false);
return;
}
var reader = new FileReader();
reader.onloadend = function() {
var base64 = reader.result.split(',')[1];
_sendAttachment('audio', base64, { format: 'webm', duration: duration });
console.log('[ATTACH] Audio enviado, duracion:', duration);
_isRecording = false;
_updateMicIcon(false);
};
reader.readAsDataURL(blob);
// Detener tracks
stream.getTracks().forEach(function(t) { t.stop(); });
};
_mediaRecorder.onerror = function(e) {
console.log('[ATTACH:VOICE] MediaRecorder error:', e.message);
_isRecording = false;
_updateMicIcon(false);
timerEl.style.display = 'none';
if (_voiceTimerInterval) {
clearInterval(_voiceTimerInterval);
_voiceTimerInterval = null;
}
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
// DETENER grabacion
_isRecording = false;
_updateMicIcon(false);
if (_voiceTimerInterval) {
clearInterval(_voiceTimerInterval);
_voiceTimerInterval = null;
}
timerEl.style.display = 'none';
_voiceStartTime = 0;
if (_mediaRecorder && _mediaRecorder.state !== 'inactive') {
try { _mediaRecorder.stop(); } catch (e) {}
}
}
}
function _updateMicIcon(recording) {
var micBtn = document.getElementById('send-btn');
if (micBtn) {
micBtn.style.color = recording ? '#FF3B30' : '';
if (recording) {
micBtn.innerHTML = '<svg viewBox="0 0 24 24" width="24" height="24" fill="#FF3B30"><path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/><path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/></svg>';
} else {
micBtn.innerHTML = '<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/><path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/></svg>';
}
}
}
function _bindAttachmentHandlers() {
_bindCameraPreviewHandlers();
var attachBtn = document.getElementById('attach-btn');
var sendBtn = document.getElementById('send-btn');
var menuItems = document.querySelectorAll('.attach-menu-item');
var input = document.getElementById('message-input');
if (attachBtn) {
attachBtn.addEventListener('click', function(e) {
e.preventDefault();
e.stopPropagation();
if (_isRecording) {
_handleVoiceToggle();
attachBtn.classList.remove('voice-active');
} else {
_toggleAttachMenu();
}
});
var longPressTimer = null;
var isLongPress = false;
attachBtn.addEventListener('touchstart', function(e) {
isLongPress = false;
longPressTimer = setTimeout(function() {
isLongPress = true;
attachBtn.classList.add('voice-active');
_handleVoiceToggle();
}, 800);
}, { passive: true });
attachBtn.addEventListener('touchend', function(e) {
clearTimeout(longPressTimer);
if (isLongPress && _isRecording) {
setTimeout(function() {
_handleVoiceToggle();
attachBtn.classList.remove('voice-active');
}, 50);
}
});
attachBtn.addEventListener('touchcancel', function(e) {
clearTimeout(longPressTimer);
if (_isRecording) {
_handleVoiceToggle();
attachBtn.classList.remove('voice-active');
}
});
}
// FIX 2026-07-18: menuItems incluye contacto
menuItems.forEach(function(item) {
item.addEventListener('click', function(e) {
e.preventDefault();
e.stopPropagation();
var type = item.getAttribute('data-type');
if (type === 'camera') _handleCamera();
else if (type === 'gallery') _handleGallery();
else if (type === 'file') _handleFile();
else if (type === 'location') _handleLocation();
else if (type === 'contact') _handleContactShare();
});
});
if (sendBtn) {
sendBtn.addEventListener('click', function(e) {
var text = input ? input.value.trim() : '';
if (text) {
e.preventDefault();
e.stopPropagation();
var contactId = _getCurrentContactId();
if (contactId && window.NEXO.app && window.NEXO.app.sendMessage) {
window.NEXO.app.sendMessage({ content: text });
input.value = '';
input.focus();
}
} else {
e.preventDefault();
e.stopPropagation();
_handleVoiceToggle();
}
});
}
// FIX 2026-07-18: Cierre panel adjuntos con click fuera
document.addEventListener('click', function(e) {
var menu = document.getElementById('attach-menu');
var attachBtn = document.getElementById('attach-btn');
if (menu && menu.classList.contains('visible') &&
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
console.log('[MAIN] NEXO v9.9-FIX iniciando...');
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
contacts: bi._getBLEContacts ? bi._getBLEContacts().length : 0
});
}
} catch (logErr) { console.warn('[MAIN] Log BLE error:', logErr); }
_setupMessageInput();
_setupVaultToggle();
_setupChatHeader();
_setupKeyboardShortcuts();
_setupJumpButton();
_setupFABButton();
_setupBackButton();
_loadPersistedMessages();
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
var send = async function() {
var text = input.value.trim();
if (!text) return;
input.value = '';
input.focus();
try {
if (!window.NEXO.app) return;
var sent = await window.NEXO.app.sendMessage({ content: text });
} catch (e) {}
};
btn.addEventListener('click', function(e) {
var text = input.value.trim();
if (text) {
send();
} else {
e.preventDefault();
e.stopPropagation();
_handleVoiceToggle();
}
});
input.addEventListener('keypress', function(e) {
if (e.key === 'Enter') {
e.preventDefault();
send();
}
});
input.focus();
window.addEventListener('resize', function() {
var s = document.getElementById('messages-container');
if (s) requestAnimationFrame(function() { s.scrollTop = s.scrollHeight; });
});
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
}
try {
var contacts = JSON.parse(localStorage.getItem('nexo_ble_contacts_v2') || '[]');
var activeId = window.NEXO.app && window.NEXO.app.activeContact ? window.NEXO.app.activeContact.id : null;
if (activeId) {
var idx = contacts.findIndex(function(c) { return (c.deviceUUID || c.id || c.address) === activeId; });
if (idx >= 0) {
contacts[idx].name = newName;
localStorage.setItem('nexo_ble_contacts_v2', JSON.stringify(contacts));
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
function _setupFABButton() {
try {
var fabBtn = document.getElementById('ble-fab-btn');
if (!fabBtn) return;
fabBtn.innerHTML = '<svg viewBox="0 0 24 24" width="28" height="28" fill="#fff"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>';
var newFab = fabBtn.cloneNode(true);
fabBtn.parentNode.replaceChild(newFab, fabBtn);
newFab.addEventListener('click', function() {
if (window.bleInterface && window.bleInterface.elements) {
var panel = window.bleInterface.elements.panel;
var overlay = window.bleInterface.elements.overlay;
if (panel) panel.classList.add('active');
if (overlay) overlay.classList.add('active');
}
if (window.bleInterface && typeof window.bleInterface.toggleScan === 'function') {
window.bleInterface.toggleScan();
}
});
} catch (e) {
console.warn('[MAIN] _setupFABButton error:', e);
}
}
function _getContactStorageKey() {
var contactId = 'default';
try {
if (window.NEXO.app && window.NEXO.app.activeContact && window.NEXO.app.activeContact.id) {
contactId = window.NEXO.app.activeContact.id;
} else if (window.NEXO.app && window.NEXO.app.bleInterface && window.NEXO.app.bleInterface._activeChatDeviceId) {
contactId = window.NEXO.app.bleInterface._activeChatDeviceId;
}
} catch (e) {}
return 'nexo_messages_' + contactId;
}
function _saveMessageToStorage(msg) {
try {
if (!msg || !msg.messageId) return;
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
// FIX v10.30: Video burbuja siempre visible con play icon + duracion
var videoWrapper = document.createElement('div');
videoWrapper.className = 'video-attachment';
videoWrapper.style.cssText = 'position:relative;width:220px;min-height:140px;overflow:hidden;background:#1a1a2e;border-radius:12px;cursor:pointer;display:flex;align-items:center;justify-content:center;';
var video = document.createElement('video');
var videoMime = (attachment.meta && attachment.meta.mimeType) ? attachment.meta.mimeType : ('video/' + (attachment.meta.format || 'webm'));
video.src = 'data:' + videoMime + ';base64,' + attachment.payload;
video.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block;';
video.playsInline = true;
video.muted = true;
video.preload = 'metadata';
video.dataset.fullscreenSrc = video.src;
video.dataset.fullscreenType = 'video';
var playOverlay = document.createElement('div');
playOverlay.style.cssText = 'position:relative;z-index:2;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;pointer-events:none;';
var durText = (attachment.meta && attachment.meta.duration) ? _fmtTime(attachment.meta.duration) : '';
playOverlay.innerHTML = '<svg viewBox="0 0 24 24" width="48" height="48" fill="#fff" style="opacity:0.95;filter:drop-shadow(0 2px 4px rgba(0,0,0,0.6));"><circle cx="12" cy="12" r="11" fill="rgba(0,0,0,0.4)"/><path d="M9 7l10 5-10 5z"/></svg>' + 
  (durText ? '<span style="color:#fff;font-size:12px;font-weight:600;background:rgba(0,0,0,0.5);padding:2px 8px;border-radius:4px;">' + durText + '</span>' : '');
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
fvideo.src = 'data:' + attachment.meta.type + ';base64,' + attachment.payload;
fvideo.style.cssText = 'width:100%;height:auto;max-height:280px;display:block;';
fvideo.playsInline = true;
fvideo.muted = true;
fvideo.preload = 'metadata';
fvideo.dataset.fullscreenSrc = fvideo.src;
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
contentDiv.innerHTML = '<div style="padding:8px 12px;background:rgba(0,0,0,0.3);border-radius:10px;">&#128206; <b>Archivo</b><span style="font-size:12px;opacity:0.7;">' + (attachment.meta.name || 'archivo') + '</span></div>';
}
} else if (attachment.type === 'location') {
// FIX v10.31: Preview mapa Yandex + fallback visual + botones Maps/Waze
var loc = attachment.meta;
var lat = (loc && loc.lat) ? loc.lat : 0;
var lng = (loc && loc.lng) ? loc.lng : 0;
var mapsUrl = 'https://www.google.com/maps/search/?api=1&query=' + lat + ',' + lng;
var wazeUrl = 'https://waze.com/ul?ll=' + lat + ',' + lng + '&navigate=yes';
var locWrapper = document.createElement('div');
locWrapper.className = 'location-attachment';
locWrapper.style.cssText = 'max-width:220px;border-radius:12px;overflow:hidden;background:linear-gradient(135deg,#1a2a3a,#0d1a1a);border:1px solid rgba(0,200,255,0.3);display:block;';
var mapContainer = document.createElement('div');
mapContainer.style.cssText = 'position:relative;width:100%;height:120px;overflow:hidden;';
var mapImg = document.createElement('img');
mapImg.src = 'https://static-maps.yandex.ru/1.x/?ll=' + lng + ',' + lat + '&z=15&l=map&size=300,150&pt=' + lng + ',' + lat + ',pm2rdl';
mapImg.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;';
mapImg.onerror = function() {
  this.style.display = 'none';
  var fb = this.parentNode.querySelector('.loc-fallback');
  if (fb) fb.style.display = 'flex';
};
var mapFallback = document.createElement('div');
mapFallback.className = 'loc-fallback';
mapFallback.style.cssText = 'display:none;position:absolute;inset:0;flex-direction:column;align-items:center;justify-content:center;background:linear-gradient(135deg,#1a2a3a,#0d1a1a);gap:6px;';
mapFallback.innerHTML = '<svg viewBox="0 0 24 24" width="36" height="36" fill="#ff6b35"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/></svg><span style="font-size:11px;color:#888;">' + lat.toFixed(4) + ', ' + lng.toFixed(4) + '</span>';
mapContainer.appendChild(mapImg);
mapContainer.appendChild(mapFallback);
var locInfo = document.createElement('div');
locInfo.className = 'location-info';
locInfo.style.cssText = 'padding:8px 12px;';
locInfo.innerHTML = '<div style="font-weight:600;font-size:13px;color:#fff;">Ubicación</div><div style="font-size:11px;color:#888;">' + lat.toFixed(5) + ', ' + lng.toFixed(5) + '</div>';
var locActions = document.createElement('div');
locActions.className = 'location-actions';
locActions.style.cssText = 'display:flex;gap:8px;padding:0 12px 10px;';
locActions.innerHTML = '<a href="' + mapsUrl + '" target="_blank" style="flex:1;text-align:center;padding:8px;background:rgba(0,130,252,0.2);border-radius:8px;color:#fff;text-decoration:none;font-size:12px;font-weight:500;border:1px solid rgba(0,130,252,0.3);">Google Maps</a>' +
  '<a href="' + wazeUrl + '" target="_blank" style="flex:1;text-align:center;padding:8px;background:rgba(107,78,255,0.2);border-radius:8px;color:#fff;text-decoration:none;font-size:12px;font-weight:500;border:1px solid rgba(107,78,255,0.3);">Waze</a>';
locWrapper.appendChild(mapContainer);
locWrapper.appendChild(locInfo);
locWrapper.appendChild(locActions);
contentDiv.appendChild(locWrapper);
} else if (attachment.type === 'audio') {
var dur = (attachment.meta && attachment.meta.duration) ? attachment.meta.duration : 0;
var durStr = _fmtTime(dur);
var safeMsgId = (msgId || '').replace(/[^a-zA-Z0-9]/g, '_');
var audioId = 'audio_' + safeMsgId;
var audioHtml = '<div style="display:flex;align-items:center;gap:10px;padding:8px 12px;min-width:180px;">';
audioHtml += '<button id="' + audioId + '_play" style="width:36px;height:36px;border-radius:50%;background:rgba(255,255,255,0.15);border:none;color:#fff;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:14px;">▶</button>';
audioHtml += '<div style="flex:1;">';
audioHtml += '<div style="height:20px;display:flex;align-items:flex-end;gap:2px;opacity:0.6;">';
for (var w = 0; w < 20; w++) {
var h = 4 + Math.random() * 14;
audioHtml += '<div style="width:3px;height:' + h + 'px;background:#fff;border-radius:1px;flex-shrink:0;"></div>';
}
audioHtml += '</div>';
audioHtml += '<div style="font-size:11px;color:#aaa;margin-top:2px;">' + durStr + '</div>';
audioHtml += '</div></div>';
contentDiv.innerHTML = audioHtml;
setTimeout(function() {
var btn = document.getElementById(audioId + '_play');
if (!btn) return;
var playing = false;
var audioEl = null;
btn.onclick = function(e) {
e.stopPropagation();
if (!playing) {
audioEl = new Audio('data:audio/' + ((attachment.meta && attachment.meta.format) ? attachment.meta.format : 'webm') + ';base64,' + attachment.payload);
audioEl.play().catch(function(err) { 
    console.log('[AUDIO] Play error:', err.message);
    btn.innerHTML = '▶';
    playing = false;
    audioEl = null;
});
btn.innerHTML = '⏸';
playing = true;
audioEl.onended = function() { btn.innerHTML = '▶'; playing = false; audioEl = null; };
} else {
if (audioEl) { audioEl.pause(); audioEl = null; }
btn.innerHTML = '▶';
playing = false;
}
};
}, 0);
} else {
contentDiv.textContent = msg.content || msg.text || '';
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
var backBtn = document.getElementById('chat-back-btn');
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
} catch (e) {
console.warn('[MAIN] _doChatBack error:', e);
}
}
window.NEXO_updateMessageStatus = _updateMessageStatus;
if (typeof module !== 'undefined' && module && module.hot) module.hot.accept();
