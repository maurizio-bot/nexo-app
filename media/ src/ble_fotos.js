/**
 * NEXO Photos Module v2
 * Picker de cámara/galería, compresión WebP progresiva,
 * integración con NEXOFileTransfer para envío BLE
 * ES5 compatible
   */
var NEXOPhotos = (function() {
'use strict';
// === CONFIG ===
var CONFIG = {
THUMB_DIMENSIONS: 150,
PREVIEW_DIMENSIONS: 640,
THUMB_QUALITY: 0.5,
PREVIEW_QUALITY: 0.6,
ORIGINAL_QUALITY: 0.85,
MAX_FILE_SIZE: 5242880, // 5MB
ACCEPT_TYPES: 'image/*',
CAPTURE: 'environment' // 'user' para frontal
};
// === ESTADO ===
var _callbacks = {
onPhotoSelected: null,
onPhotoCompressed: null,
onPhotoSent: null,
onPhotoReceived: null,
onError: null
};
// === UTILIDADES ===
function _generateId() {
return 'photo-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
}
// === COMPRESION DE IMAGEN ===
/**
 * Comprime imagen a dimensiones/calidad objetivo
 * @param {File|Blob|String} source - Archivo, blob o dataURL
 * @param {Number} maxDimension - Ancho/alto máximo
 * @param {Number} quality - Calidad 0-1
 * @param {String} format - 'image/webp' o 'image/jpeg'
 * @returns {Promise<Blob>}
   */
   function compressImage(source, maxDimension, quality, format) {
   return new Promise(function(resolve, reject) {
   var img = new Image();
   img.onload = function() {
   var canvas = document.createElement('canvas');
   var ctx = canvas.getContext('2d');
   var width = img.width;
   var height = img.height;
   // Calcular nuevas dimensiones manteniendo ratio
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
   // Fondo negro para transparencias
   ctx.fillStyle = '#000000';
   ctx.fillRect(0, 0, width, height);
   ctx.drawImage(img, 0, 0, width, height);
   canvas.toBlob(function(blob) {
   if (blob) {
   resolve(blob);
   } else {
   reject(new Error('Canvas toBlob fallo'));
   }
   }, format, quality);
   };
   img.onerror = function() {
   reject(new Error('Error cargando imagen'));
   };
   if (typeof source === 'string') {
   img.src = source;
   } else if (source instanceof File || source instanceof Blob) {
   var reader = new FileReader();
   reader.onload = function(e) {
   img.src = e.target.result;
   };
   reader.onerror = function() {
   reject(new Error('Error leyendo archivo'));
   };
   reader.readAsDataURL(source);
   } else {
   reject(new Error('Tipo de fuente no soportado'));
   }
   });
   }
/**
 * Genera las 3 capas progresivas: thumbnail, preview, original
 * @param {File} file - Archivo original
 * @returns {Promise<Object>} { id, thumbnail, preview, original, metadata }
   */
   function generateProgressiveLayers(file) {
   return new Promise(function(resolve, reject) {
   var id = _generateId();
   var layers = {
   id: id,
   thumbnail: null,
   preview: null,
   original: file,
   metadata: {
   originalName: file.name,
   originalSize: file.size,
   originalType: file.type,
   createdAt: Date.now()
   }
   };
   // Thumbnail: 150x150, calidad 50%, WebP
   compressImage(file, CONFIG.THUMB_DIMENSIONS, CONFIG.THUMB_QUALITY, 'image/webp')
   .then(function(thumbBlob) {
   layers.thumbnail = thumbBlob;
   layers.metadata.thumbnailSize = thumbBlob.size;
   layers.metadata.thumbnailDimensions = CONFIG.THUMB_DIMENSIONS + 'x' + CONFIG.THUMB_DIMENSIONS;
   // Preview: 640px max, calidad 60%, WebP
   return compressImage(file, CONFIG.PREVIEW_DIMENSIONS, CONFIG.PREVIEW_QUALITY, 'image/webp');
   })
   .then(function(previewBlob) {
   layers.preview = previewBlob;
   layers.metadata.previewSize = previewBlob.size;
   layers.metadata.previewDimensions = CONFIG.PREVIEW_DIMENSIONS + 'px max';
   resolve(layers);
   })
   .catch(function(err) {
   // Fallback a JPEG si WebP falla
   compressImage(file, CONFIG.THUMB_DIMENSIONS, CONFIG.THUMB_QUALITY, 'image/jpeg')
   .then(function(thumbBlob) {
   layers.thumbnail = thumbBlob;
   layers.metadata.thumbnailSize = thumbBlob.size;
   return compressImage(file, CONFIG.PREVIEW_DIMENSIONS, CONFIG.PREVIEW_QUALITY, 'image/jpeg');
   })
   .then(function(previewBlob) {
   layers.preview = previewBlob;
   layers.metadata.previewSize = previewBlob.size;
   layers.metadata.fallbackFormat = 'image/jpeg';
   resolve(layers);
   })
   .catch(reject);
   });
   });
   }
// === PICKER: GALERIA ===
/**
 * Abre selector de galería
 * @param {Object} options - { multiple: false, onSelect }
 * @returns {Promise<File[]>}
   */
   function pickFromGallery(options) {
   options = options || {};
   return new Promise(function(resolve, reject) {
   var input = document.createElement('input');
   input.type = 'file';
   input.accept = CONFIG.ACCEPT_TYPES;
   input.multiple = options.multiple === true;
   input.onchange = function(e) {
   var files = Array.prototype.slice.call(e.target.files || []);
   if (files.length === 0) {
   reject(new Error('No se seleccionaron archivos'));
   return;
   }
   // Validar tamaño
   var validFiles = files.filter(function(f) {
   return f.size <= CONFIG.MAX_FILE_SIZE;
   });
   if (validFiles.length === 0) {
   reject(new Error('Todos los archivos exceden 5MB'));
   return;
   }
   if (options.onSelect) options.onSelect(validFiles);
   resolve(validFiles);
   };
   input.onerror = function() {
   reject(new Error('Error en selector de galería'));
   };
   // Click programático
   input.style.display = 'none';
   document.body.appendChild(input);
   input.click();
   // Cleanup
   setTimeout(function() {
   if (input.parentNode) input.parentNode.removeChild(input);
   }, 1000);
   });
   }
// === PICKER: CAMARA ===
/**
 * Abre cámara nativa
 * @param {Object} options - { facing: 'environment', onCapture }
 * @returns {Promise<File>}
   */
   function pickFromCamera(options) {
   options = options || {};
   return new Promise(function(resolve, reject) {
   var input = document.createElement('input');
   input.type = 'file';
   input.accept = 'image/*';
   input.capture = options.facing || CONFIG.CAPTURE;
   input.onchange = function(e) {
   var files = e.target.files;
   if (!files || files.length === 0) {
   reject(new Error('No se capturó foto'));
   return;
   }
   var file = files[0];
   if (file.size > CONFIG.MAX_FILE_SIZE) {
   reject(new Error('Foto excede 5MB'));
   return;
   }
   if (options.onCapture) options.onCapture(file);
   resolve(file);
   };
   input.onerror = function() {
   reject(new Error('Error en cámara'));
   };
   input.style.display = 'none';
   document.body.appendChild(input);
   input.click();
   setTimeout(function() {
   if (input.parentNode) input.parentNode.removeChild(input);
   }, 1000);
   });
   }
// === ENVIO DE FOTO ===
/**
 * Selecciona, comprime y envía una foto
 * @param {String} deviceId - Destinatario
 * @param {String} source - 'camera' | 'gallery'
 * @param {Object} options - { onProgress, onComplete, onThumbnail, onPreview }
 * @returns {Promise<String>} msgId
   */
   function sendPhoto(deviceId, source, options) {
   options = options || {};
   return new Promise(function(resolve, reject) {
   var pickPromise;
   if (source === 'camera') {
   pickPromise = pickFromCamera();
   } else {
   pickPromise = pickFromGallery();
   }
   pickPromise
   .then(function(files) {
   var file = Array.isArray(files) ? files[0] : files;
   if (_callbacks.onPhotoSelected) {
   _callbacks.onPhotoSelected(file);
   }
   // Generar capas progresivas
   return generateProgressiveLayers(file);
   })
   .then(function(layers) {
   if (_callbacks.onPhotoCompressed) {
   _callbacks.onPhotoCompressed(layers);
   }
   // Usar NEXOFileTransfer para enviar
   if (typeof window.NEXOFileTransfer === 'undefined') {
   reject(new Error('NEXOFileTransfer no cargado'));
   return;
   }
   var transfer = window.NEXOFileTransfer;
   // Callbacks de progreso
   transfer.onProgress(function(msgId, progress, bytesSent, totalBytes) {
   if (options.onProgress) options.onProgress(msgId, progress, bytesSent, totalBytes);
   });
   transfer.onThumbnail(function(msgId, data) {
   if (options.onThumbnail) options.onThumbnail(msgId, data);
   });
   transfer.onPreview(function(msgId, data) {
   if (options.onPreview) options.onPreview(msgId, data);
   });
   transfer.onComplete(function(msgId, success, error) {
   if (options.onComplete) options.onComplete(msgId, success, error);
   if (_callbacks.onPhotoSent) {
   _callbacks.onPhotoSent(msgId, success, layers);
   }
   });
   // Enviar
   return transfer.sendFile(deviceId, layers.original, {
   fileName: layers.metadata.originalName,
   mimeType: layers.metadata.originalType,
   onProgress: options.onProgress,
   onComplete: options.onComplete
   });
   })
   .then(function(msgId) {
   resolve(msgId);
   })
   .catch(function(err) {
   if (_callbacks.onError) _callbacks.onError(err);
   reject(err);
   });
   });
   }
// === RENDERIZAR FOTO EN BURBUJA ===
/**
 * Crea elemento DOM para foto en burbuja de chat
 * @param {Object} photoData - { msgId, thumbnailUrl, previewUrl, originalUrl, status, progress }
 * @returns {HTMLElement}
   */
   function createPhotoBubble(photoData) {
   photoData = photoData || {};
   var container = document.createElement('div');
   container.className = 'nexo-photo-bubble';
   container.dataset.msgId = photoData.msgId || '';
var img = document.createElement('img');
img.className = 'nexo-photo-img';
img.alt = 'Foto';
img.style.cssText = 'max-width:240px;max-height:320px;border-radius:12px;object-fit:cover;display:block;';
// Mostrar thumbnail mientras carga
if (photoData.thumbnailUrl) {
img.src = photoData.thumbnailUrl;
img.style.filter = 'blur(2px)';
}
// Cuando preview esté listo, mostrarla
if (photoData.previewUrl) {
var previewImg = new Image();
previewImg.onload = function() {
img.src = photoData.previewUrl;
img.style.filter = 'none';
};
previewImg.src = photoData.previewUrl;
}
// Cuando original esté listo, mostrarlo
if (photoData.originalUrl) {
var originalImg = new Image();
originalImg.onload = function() {
img.src = photoData.originalUrl;
};
originalImg.src = photoData.originalUrl;
}
container.appendChild(img);
// Barra de progreso
if (photoData.progress !== undefined && photoData.progress < 100) {
var progressBar = document.createElement('div');
progressBar.className = 'nexo-photo-progress';
progressBar.style.cssText = 'position:absolute;bottom:8px;left:8px;right:8px;height:3px;background:rgba(255,255,255,0.2);border-radius:2px;overflow:hidden;';
var progressFill = document.createElement('div');
progressFill.style.cssText = 'height:100%;width:' + photoData.progress + '%;background:#00c8ff;transition:width 0.3s ease;';
progressBar.appendChild(progressFill);
container.appendChild(progressBar);
container.style.position = 'relative';
}
// Estado
if (photoData.status) {
var statusEl = document.createElement('span');
statusEl.className = 'nexo-photo-status';
statusEl.textContent = photoData.status;
statusEl.style.cssText = 'position:absolute;bottom:8px;right:8px;font-size:10px;color:#fff;background:rgba(0,0,0,0.5);padding:2px 6px;border-radius:4px;';
container.appendChild(statusEl);
container.style.position = 'relative';
}
return container;
}
// === CONVERTIR BLOB A DATA URL ===
function blobToDataURL(blob) {
return new Promise(function(resolve, reject) {
var reader = new FileReader();
reader.onload = function(e) {
resolve(e.target.result);
};
reader.onerror = reject;
reader.readAsDataURL(blob);
});
}
// === CALLBACKS ===
function onPhotoSelected(callback) { _callbacks.onPhotoSelected = callback; }
function onPhotoCompressed(callback) { _callbacks.onPhotoCompressed = callback; }
function onPhotoSent(callback) { _callbacks.onPhotoSent = callback; }
function onPhotoReceived(callback) { _callbacks.onPhotoReceived = callback; }
function onError(callback) { _callbacks.onError = callback; }
// === API PUBLICA ===
return {
// Picker
pickFromGallery: pickFromGallery,
pickFromCamera: pickFromCamera,
// Compresión
compressImage: compressImage,
generateProgressiveLayers: generateProgressiveLayers,
// Envío
sendPhoto: sendPhoto,
// UI
createPhotoBubble: createPhotoBubble,
blobToDataURL: blobToDataURL,
// Callbacks
onPhotoSelected: onPhotoSelected,
onPhotoCompressed: onPhotoCompressed,
onPhotoSent: onPhotoSent,
onPhotoReceived: onPhotoReceived,
onError: onError,
// Config
CONFIG: CONFIG
};
})();
// === EXPORT ===
if (typeof module !== 'undefined' && module.exports) {
module.exports = { NEXOPhotos: NEXOPhotos };
}
if (typeof window !== 'undefined') {
window.NEXOPhotos = NEXOPhotos;
}
