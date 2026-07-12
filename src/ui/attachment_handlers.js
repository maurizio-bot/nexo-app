/**
 * Attachment Handlers — Menú (+) input bar v2
 * APIs web nativas, sin plugins adicionales.
 * Se integra con cualquier función de envío global disponible.
   */
(function() {
'use strict';
// ── Config ──
const CONFIG = {
maxFileSizeMB: 5,
geoTimeout: 10000,
geoHighAccuracy: true
};
// ── Init ──
function init() {
const menu = document.getElementById('attachMenu');
if (!menu) {
console.warn('[Attach] #attachMenu no encontrado');
return;
}
menu.querySelectorAll('.attach-btn').forEach(btn => {
btn.addEventListener('click', onAttachBtnClick);
});
console.log('[Attach] Handlers activos');
}
function onAttachBtnClick(e) {
const btn = e.currentTarget;
const type = btn.dataset.type || btn.getAttribute('data-type');
if (!type) return;
// Cerrar menú
const menu = document.getElementById('attachMenu');
if (menu) menu.classList.remove('active');
switch (type) {
case 'photo':  pickMedia({ accept: 'image/*', capture: 'environment', label: '📷 Foto' }); break;
case 'video':  pickMedia({ accept: 'video/*', capture: 'camcorder',   label: '🎥 Video' }); break;
case 'file':   pickMedia({ accept: '*/*',                              label: '📎 Archivo' }); break;
case 'location': shareLocation(); break;
default: console.warn('[Attach] Tipo desconocido:', type);
}
}
// ── Media picker (foto/video/archivo) ──
function pickMedia(opts) {
const input = document.createElement('input');
input.type = 'file';
input.accept = opts.accept || '*/*';
if (opts.capture) input.capture = opts.capture;
input.style.display = 'none';
document.body.appendChild(input);
input.addEventListener('change', (e) => {
const file = e.target.files ? e.target.files[0] : null;
if (file) {
if (file.size > CONFIG.maxFileSizeMB * 1024 * 1024) {
alert('Archivo demasiado grande. Máximo ' + CONFIG.maxFileSizeMB + ' MB.');
} else {
processFile(file, opts.label);
}
}
document.body.removeChild(input);
});
// iOS/Capacitor necesita timeout para click programático
setTimeout(() => input.click(), 50);
}
function processFile(file, label) {
const meta = label + ' ' + file.name + ' (' + formatBytes(file.size) + ')';
// Por ahora: enviar metadata como mensaje de texto.
// Transferencia real de binarios requiere Turbo File Transfer v2 (BLE MTU limitado).
dispatchMessage(meta, 'file');
}
function formatBytes(bytes) {
if (bytes === 0) return '0 B';
const k = 1024;
const sizes = ['B','KB','MB','GB'];
const i = Math.floor(Math.log(bytes) / Math.log(k));
return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}
// ── Location ──
function shareLocation() {
if (!navigator.geolocation) {
alert('Geolocalización no disponible en este dispositivo.');
return;
}
navigator.geolocation.getCurrentPosition(
(pos) => {
const { latitude, longitude, accuracy } = pos.coords;
const text = '📍 Ubicación: ' + latitude.toFixed(6) + ', ' + longitude.toFixed(6) +
(accuracy ? ' (±' + Math.round(accuracy) + 'm)' : '');
dispatchMessage(text, 'location');
},
(err) => {
console.error('[Attach] Geolocation error:', err.code, err.message);
let msg = 'No se pudo obtener la ubicación.';
if (err.code === 1) msg = 'Permiso de ubicación denegado.';
if (err.code === 2) msg = 'Ubicación no disponible.';
if (err.code === 3) msg = 'Timeout obteniendo ubicación.';
alert(msg);
},
{ enableHighAccuracy: CONFIG.geoHighAccuracy, timeout: CONFIG.geoTimeout, maximumAge: 0 }
);
}
// ── Dispatch message (integración con app existente) ──
function dispatchMessage(text, type) {
// Orden de preferencia: app global → BLEInterface → UI local
if (window.app && typeof window.app.sendMessage === 'function') {
window.app.sendMessage(text);
return;
}
if (window.BLEInterface && typeof window.BLEInterface.sendMessage === 'function') {
window.BLEInterface.sendMessage(text);
return;
}
if (window.nexoApp && typeof window.nexoApp.sendMessage === 'function') {
window.nexoApp.sendMessage(text);
return;
}
// Fallback: render local solo en UI
if (window.appendMessageToUI && typeof window.appendMessageToUI === 'function') {
window.appendMessageToUI({ text: text, own: true, type: type || 'text' });
} else {
console.log('[Attach] No dispatch disponible. Msg:', text);
}
}
// ── Bootstrap ──
if (document.readyState === 'loading') {
document.addEventListener('DOMContentLoaded', init);
} else {
init();
}
})();
