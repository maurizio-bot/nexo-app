/**
 * src/main.js - Punto de entrada NEXO v9.9-FIX
 * FIX v10.12: Video graba 0s — requestData() antes de stop() + duracion real
 * FIX v10.13: Galeria cierra overlay de camara antes de abrir input file
 * FIX v10.14: Comentarios limpios, solo ultimos 3 fixes visibles
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
// Camera preview state
var _cameraPreviewMode = 'photo';
var _cameraPreviewRecording = false;
var _cameraPreviewMediaRecorder = null;
var _cameraPreviewVideoChunks = [];
var _cameraActiveStream = null;
var _cameraVideoStartTime = 0;
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
// FIX v10.12: requestData() antes de stop() + duracion real
function _setupVideoRecorder(stream) {
var mimeType = 'video/webm;codecs=vp9,opus';
if (!MediaRecorder.isTypeSupported(mimeType)) {
mimeType = 'video/webm;codecs=vp8,opus';
if (!MediaRecorder.isTypeSupported(mimeType)) {
mimeType = 'video/webm';
if (!MediaRecorder.isTypeSupported(mimeType)) {
mimeType = 'video/mp4';
}
}
}
try {
_cameraPreviewMediaRecorder = new MediaRecorder(stream, { mimeType: mimeType });
_cameraPreviewVideoChunks = [];
_cameraPreviewMediaRecorder.ondataavailable = function(e) {
if (e.data && e.data.size > 0) _cameraPreviewVideoChunks.push(e.data);
};
_cameraPreviewMediaRecorder.onstop = function() {
var duration = 0;
if (_cameraVideoStartTime > 0) {
duration = Math.round((Date.now() - _cameraVideoStartTime) / 1000);
}
var blob = new Blob(_cameraPreviewVideoChunks, { type: mimeType.split(';')[0] || 'video/webm' });
if (blob.size === 0) {
console.log('[CAMERA] Video blob vacio, grabacion fallo');
var status = document.getElementById('camera-preview-status');
if (status) status.textContent = 'Error: video vacio';
return;
}
var reader = new FileReader();
reader.onloadend = function() {
var base64 = reader.result.split(',')[1];
_sendAttachment('video', base64, { format: (mimeType.split(';')[0] || 'video/webm').split('/')[1] || 'webm', duration: duration });
_hideCameraPreviewOverlay();
};
reader.readAsDataURL(blob);
};
_cameraPreviewMediaRecorder.onerror = function(e) {
console.log('[CAMERA] MediaRecorder error:', e.message);
};
} catch (recErr) {
console.log('[CAMERA] MediaRecorder init error:', recErr.message);
}
}
