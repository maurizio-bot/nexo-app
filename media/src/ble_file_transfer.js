/**
 * NEXO Turbo File Transfer JS API v2
 * API pública para envío de archivos, fotos, audio por BLE
 * Compresión progresiva: thumbnail → preview → original
 * Integración con plugin nativo NexoBLE
 * ES5 compatible
   */
var NEXOFileTransfer = (function() {
'use strict';
// === CONFIG ===
var CONFIG = {
THUMB_MAX_SIZE: 5120,        // 5 KB
THUMB_DIMENSIONS: 150,       // 150x150
PREVIEW_MAX_SIZE: 61440,     // 60 KB
PREVIEW_DIMENSIONS: 640,     // 640px ancho máximo
MAX_FILE_SIZE: 5242880,      // 5 MB
CHUNK_SIZE: 243,             // Debe coincidir con Kotlin
AUDIO_FORMAT: 'audio/webm;codecs=opus',
AUDIO_FALLBACK: 'audio/wav'
};
// === ESTADO ===
var _callbacks = {
onProgress: null,
onComplete: null,
onReceived: null,
onThumbnail: null,
onPreview: null
};
var _activeTransfers = {};
var _mediaRecorder = null;
var _audioChunks = [];
// === UTILIDADES ===
function _generateMsgId() {
return 'ft-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
}
function _normId(id) {
return (id || '').toString().toLowerCase().trim();
}
function _safeNativeCall(plugin, method, args) {
return new Promise(function(resolve, reject) {
if (!plugin || typeof plugin[method] !== 'function') {
reject(new Error('Plugin nativo no disponible'));
return;
}
try {
var result = pluginmethod;
if (result && typeof result.then === 'function') {
result.then(resolve).catch(reject);
} else {
resolve(result);
}
} catch (e) {
reject(e);
}
});
}
function _getNativePlugin() {
return (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.NexoBLE) || null;
}
// === COMPRESION DE IMAGEN ===
/**
 * Comprime una imagen a WebP/JPEG con dimensiones y calidad objetivo
 * @param {File|Blob} file - Archivo de imagen
 * @param {Number} maxDimension - Ancho/alto máximo
 * @param {Number} quality - Calidad 0-1
 * @param {String} format - 'image/webp' o 'image/jpeg'
 * @returns {Promise<Blob>}
   */
   function _compressImage(file, maxDimension, quality, format) {
   return new Promise(function(resolve, reject) {
   var reader = new FileReader();
   reader.onload = function(e) {
   var img = new Image();
   img.onload = function() {
   var canvas = document.createElement('canvas');
   var ctx = canvas.getContext('2d');
   var width = img.width;
   var height = img.height;
   if (width > height) {
   if (width > maxDimension) {
   height = Math.round(height * (maxDimension / width));
   width = maxDimension;
   }
   } else {
   if (height > maxDimension) {
   width = Math.round(width * (maxDimension / height));
   height = maxDimension;
   }
   }
   canvas.width = width;
   canvas.height = height;
   ctx.drawImage(img, 0, 0, width, height);
   canvas.toBlob(function(blob) {
   if (blob) resolve(blob);
   else reject(new Error('Canvas toBlob fallo'));
   }, format, quality);
   };
   img.onerror = function() { reject(new Error('Error cargando imagen')); };
   img.src = e.target.result;
   };
   reader.onerror = function() { reject(new Error('Error leyendo archivo')); };
   reader.readAsDataURL(file);
   });
   }
/**
 * Genera las 3 capas de compresión progresiva
 * @param {File} file - Archivo original
 * @returns {Promise<Object>} { thumbnail, preview, original }
   */
   function _generateProgressiveLayers(file) {
   return new Promise(function(resolve, reject) {
   var layers = { thumbnail: null, preview: null, original: file };
   var format = 'image/webp';
   var fallbackFormat = 'image/jpeg';
   // Thumbnail: 150x150, calidad 50%, WebP
   _compressImage(file, CONFIG.THUMB_DIMENSIONS, 0.5, format)
   .then(function(thumb) {
   layers.thumbnail = thumb;
   // Preview: 640px max, calidad 60%, WebP
   return _compressImage(file, CONFIG.PREVIEW_DIMENSIONS, 0.6, format);
   })
   .then(function(preview) {
   layers.preview = preview;
   resolve(layers);
   })
   .catch(function(err) {
   // Fallback a JPEG si WebP no funciona
   _compressImage(file, CONFIG.THUMB_DIMENSIONS, 0.5, fallbackFormat)
   .then(function(thumb) {
   layers.thumbnail = thumb;
   return _compressImage(file, CONFIG.PREVIEW_DIMENSIONS, 0.6, fallbackFormat);
   })
   .then(function(preview) {
   layers.preview = preview;
   resolve(layers);
   })
   .catch(reject);
   });
   });
   }
// === AUDIO: GRABACION ===
function _startVoiceRecording() {
return new Promise(function(resolve, reject) {
if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
reject(new Error('MediaDevices no disponible'));
return;
}
navigator.mediaDevices.getUserMedia({ audio: true })
.then(function(stream) {
var mimeType = CONFIG.AUDIO_FORMAT;
var options = {};
if (MediaRecorder.isTypeSupported(mimeType)) {
options.mimeType = mimeType;
} else if (MediaRecorder.isTypeSupported(CONFIG.AUDIO_FALLBACK)) {
options.mimeType = CONFIG.AUDIO_FALLBACK;
}
_mediaRecorder = new MediaRecorder(stream, options);
_audioChunks = [];
_mediaRecorder.ondataavailable = function(e) {
if (e.data && e.data.size > 0) _audioChunks.push(e.data);
};
_mediaRecorder.onstop = function() {
stream.getTracks().forEach(function(track) { track.stop(); });
};
_mediaRecorder.start(100); // Collect data every 100ms
resolve();
})
.catch(reject);
});
}
function _stopVoiceRecording() {
return new Promise(function(resolve, reject) {
if (!_mediaRecorder) {
reject(new Error('No hay grabación activa'));
return;
}
_mediaRecorder.onstop = function() {
var blob = new Blob(_audioChunks, { type: _mediaRecorder.mimeType || 'audio/webm' });
_mediaRecorder = null;
_audioChunks = [];
resolve(blob);
};
_mediaRecorder.stop();
});
}
// === ENVIO DE ARCHIVO ===
/**
 * Envía un archivo por BLE con compresión progresiva
 * @param {String} deviceId - UUID o deviceId del destinatario
 * @param {File|Blob} file - Archivo a enviar
 * @param {Object} options - { fileName, mimeType, onProgress, onComplete }
 * @returns {Promise<String>} msgId
   */
   function sendFile(deviceId, file, options) {
   options = options || {};
   return new Promise(function(resolve, reject) {
   var msgId = _generateMsgId();
   var plugin = _getNativePlugin();
   if (!plugin) {
   reject(new Error('Plugin NexoBLE no disponible'));
   return;
   }
   if (file.size > CONFIG.MAX_FILE_SIZE) {
   reject(new Error('Archivo excede 5MB'));
   return;
   }
   _activeTransfers[msgId] = {
   deviceId: _normId(deviceId),
   fileName: options.fileName || file.name || 'archivo',
   mimeType: options.mimeType || file.type || 'application/octet-stream',
   fileSize: file.size,
   state: 'compressing',
   progress: 0,
   startTime: Date.now()
   };
   // Si es imagen, generar capas progresivas
   var isImage = file.type && file.type.indexOf('image/') === 0;
   var sendPromise;
   if (isImage) {
   sendPromise = _sendImageProgressive(deviceId, file, msgId, options);
   } else {
   sendPromise = _sendRawFile(deviceId, file, msgId, options);
   }
   sendPromise.then(function() {
   resolve(msgId);
   }).catch(function(err) {
   _activeTransfers[msgId].state = 'error';
   reject(err);
   });
   });
   }
function _sendImageProgressive(deviceId, file, msgId, options) {
return new Promise(function(resolve, reject) {
var transfer = _activeTransfers[msgId];
// Paso 1: Comprimir
_generateProgressiveLayers(file)
.then(function(layers) {
transfer.state = 'sending_thumbnail';
transfer.thumbnailSize = layers.thumbnail ? layers.thumbnail.size : 0;
transfer.previewSize = layers.preview ? layers.preview.size : 0;
// Notificar progreso de compresión
if (options.onProgress) options.onProgress(msgId, 5, 0, transfer.fileSize);
// Enviar metadata al nativo
return _sendFileMeta(deviceId, msgId, transfer.fileName, transfer.fileSize, transfer.mimeType, layers);
})
.then(function() {
// Paso 2: Enviar thumbnail (instantáneo, BLE directo)
var thumb = _activeTransfers[msgId].thumbnailBlob;
if (thumb) {
return _sendBlobAsChunks(deviceId, msgId, thumb, 'thumbnail');
}
return Promise.resolve();
})
.then(function() {
transfer.state = 'sending_preview';
if (options.onProgress) options.onProgress(msgId, 15, transfer.thumbnailSize || 0, transfer.fileSize);
// Paso 3: Enviar preview
var preview = _activeTransfers[msgId].previewBlob;
if (preview) {
return _sendBlobAsChunks(deviceId, msgId, preview, 'preview');
}
return Promise.resolve();
})
.then(function() {
transfer.state = 'sending_original';
if (options.onProgress) options.onProgress(msgId, 30, (transfer.thumbnailSize || 0) + (transfer.previewSize || 0), transfer.fileSize);
// Paso 4: Enviar original (chunking largo)
return _sendBlobAsChunks(deviceId, msgId, file, 'original');
})
.then(function() {
transfer.state = 'completed';
transfer.progress = 100;
if (options.onComplete) options.onComplete(msgId, true);
if (_callbacks.onComplete) _callbacks.onComplete(msgId, true);
resolve();
})
.catch(reject);
});
}
function _sendRawFile(deviceId, file, msgId, options) {
return new Promise(function(resolve, reject) {
var transfer = _activeTransfers[msgId];
transfer.state = 'sending';
_sendFileMeta(deviceId, msgId, transfer.fileName, transfer.fileSize, transfer.mimeType, null)
.then(function() {
return _sendBlobAsChunks(deviceId, msgId, file, 'original');
})
.then(function() {
transfer.state = 'completed';
transfer.progress = 100;
if (options.onComplete) options.onComplete(msgId, true);
if (_callbacks.onComplete) _callbacks.onComplete(msgId, true);
resolve();
})
.catch(reject);
});
}
// === ENVIAR METADATA ===
function _sendFileMeta(deviceId, msgId, fileName, fileSize, mimeType, layers) {
return new Promise(function(resolve, reject) {
var plugin = _getNativePlugin();
if (!plugin) { reject(new Error('Plugin no disponible')); return; }
var meta = {
v: 1,
type: 'file_meta',
msgId: msgId,
from: '', // El nativo lo llena
ts: Date.now(),
payload: {
fileName: fileName,
fileSize: fileSize,
mimeType: mimeType,
totalChunks: Math.ceil(fileSize / CONFIG.CHUNK_SIZE),
hasThumbnail: !!(layers && layers.thumbnail),
hasPreview: !!(layers && layers.preview),
checksum: '', // TODO: calcular en JS o dejar al nativo
compression: 'none'
}
};
if (layers && layers.thumbnail) {
_activeTransfers[msgId].thumbnailBlob = layers.thumbnail;
}
if (layers && layers.preview) {
_activeTransfers[msgId].previewBlob = layers.preview;
}
_safeNativeCall(plugin, 'sendFileMeta', {
deviceId: deviceId,
msgId: msgId,
meta: JSON.stringify(meta)
}).then(resolve).catch(reject);
});
}
// === ENVIAR BLOB COMO CHUNKS ===
function _sendBlobAsChunks(deviceId, msgId, blob, layerType) {
return new Promise(function(resolve, reject) {
var reader = new FileReader();
reader.onload = function(e) {
var arrayBuffer = e.target.result;
var plugin = _getNativePlugin();
if (!plugin) { reject(new Error('Plugin no disponible')); return; }
// Enviar al nativo como ArrayBuffer, el nativo hace chunking
_safeNativeCall(plugin, 'sendFileData', {
deviceId: deviceId,
msgId: msgId,
layerType: layerType, // 'thumbnail', 'preview', 'original'
data: arrayBuffer
}).then(resolve).catch(reject);
};
reader.onerror = function() { reject(new Error('Error leyendo blob')); };
reader.readAsArrayBuffer(blob);
});
}
// === ENVIAR AUDIO ===
/**
 * Inicia grabación de voz
   */
   function startVoiceRecording() {
   return _startVoiceRecording();
   }
/**
 * Detiene grabación y envía el audio
 * @param {String} deviceId - Destinatario
 * @param {Object} options - { onProgress, onComplete }
   */
   function sendVoice(deviceId, options) {
   options = options || {};
   return new Promise(function(resolve, reject) {
   _stopVoiceRecording()
   .then(function(blob) {
   var fileName = 'voice-' + Date.now() + '.webm';
   return sendFile(deviceId, blob, {
   fileName: fileName,
   mimeType: blob.type || 'audio/webm',
   onProgress: options.onProgress,
   onComplete: options.onComplete
   });
   })
   .then(resolve)
   .catch(reject);
   });
   }
// === CANCELAR ===
function cancelTransfer(msgId) {
var plugin = _getNativePlugin();
if (!plugin) return Promise.reject(new Error('Plugin no disponible'));
return _safeNativeCall(plugin, 'cancelFileTransfer', { msgId: msgId });
}
// === CALLBACKS ===
function onProgress(callback) {
_callbacks.onProgress = callback;
}
function onComplete(callback) {
_callbacks.onComplete = callback;
}
function onReceived(callback) {
_callbacks.onReceived = callback;
}
function onThumbnail(callback) {
_callbacks.onThumbnail = callback;
}
function onPreview(callback) {
_callbacks.onPreview = callback;
}
// === EVENTOS NATIVOS ===
// El plugin nativo dispara eventos que capturamos aquí
function _setupNativeListeners() {
var plugin = _getNativePlugin();
if (!plugin || !plugin.addListener) return;
plugin.addListener('onFileProgress', function(data) {
var msgId = data.msgId;
var progress = data.progress || 0;
var bytesSent = data.bytesSent || 0;
var totalBytes = data.totalBytes || 0;
if (_activeTransfers[msgId]) {
_activeTransfers[msgId].progress = progress;
}
if (_callbacks.onProgress) {
_callbacks.onProgress(msgId, progress, bytesSent, totalBytes);
}
});
plugin.addListener('onFileComplete', function(data) {
var msgId = data.msgId;
var success = data.success || false;
if (_activeTransfers[msgId]) {
_activeTransfers[msgId].state = success ? 'completed' : 'error';
}
if (_callbacks.onComplete) {
_callbacks.onComplete(msgId, success, data.error);
}
});
plugin.addListener('onFileReceived', function(data) {
if (_callbacks.onReceived) {
_callbacks.onReceived(data);
}
});
plugin.addListener('onThumbnailReceived', function(data) {
if (_callbacks.onThumbnail) {
_callbacks.onThumbnail(data.msgId, data.data);
}
});
plugin.addListener('onPreviewReceived', function(data) {
if (_callbacks.onPreview) {
_callbacks.onPreview(data.msgId, data.data);
}
});
}
// Setup listeners al cargar
if (document.readyState === 'loading') {
document.addEventListener('DOMContentLoaded', _setupNativeListeners);
} else {
_setupNativeListeners();
}
// === API PUBLICA ===
return {
sendFile: sendFile,
sendVoice: sendVoice,
startVoiceRecording: startVoiceRecording,
cancelTransfer: cancelTransfer,
onProgress: onProgress,
onComplete: onComplete,
onReceived: onReceived,
onThumbnail: onThumbnail,
onPreview: onPreview,
getTransfer: function(msgId) { return _activeTransfers[msgId] || null; },
getAllTransfers: function() { return Object.assign({}, _activeTransfers); },
CONFIG: CONFIG
};
})();
// === EXPORT ===
if (typeof module !== 'undefined' && module.exports) {
module.exports = { NEXOFileTransfer: NEXOFileTransfer };
}
if (typeof window !== 'undefined') {
window.NEXOFileTransfer = NEXOFileTransfer;
}
