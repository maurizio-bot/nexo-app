/**
 * NEXO — Elegir foto de la galería o un archivo (sacado de main.js en la ronda 2752, sin cambios en su código): selector
 * del sistema, lectura, compresión de fotos, miniatura de PDF y límites de tamaño. _sendAttachment lo da main.js.
 */
import { _closeAttachMenu, _showPermissionError } from './ui_bits.js';
import { _compressImageBase64, _extOf, _isPdf, _mimeOf, _pdfThumb, _readFileBase64 } from './file_tools.js';
import { _getCurrentContactId } from './chat_format.js';
import { _hideCameraPreviewOverlay, _photoTarget, _stopCameraPreview } from './camera.js';
import { _maxB64For, _tooBigMessage } from './media_limits.js';
import { _sendVideo } from './video_send.js';
import { BIG_MAX_BYTES } from './big_file.js';
import { groupBigRoute } from './group_media.js';
import { isGroupId } from './groups.js';
import { GROUP_MAX_BYTES } from './send.js';

// [pegamento] Lo que usa del resto de la app (main.js lo da al arrancar)
var _sendAttachment, _sendBigFile;
export function pickersUse(d) { _sendAttachment = d._sendAttachment; _sendBigFile = d._sendBigFile; } // [/pegamento]


// v9.9.37: selector de archivos. Antes el <input> se quitaba a los 30 s aunque el usuario siguiera
// eligiendo en el selector de Android (buscar una APK en Descargas o un vídeo en la galería lleva más):
// lo elegido después no hacía nada y sin aviso. Ahora vive hasta que se elige algo (o se abre otro).
export var _pendingPicker = null;

export function _pickFile(accept, label, onFile) {
  if (_pendingPicker && _pendingPicker.parentNode) _pendingPicker.remove();
  var input = document.createElement('input');
  input.type = 'file';
  input.accept = accept;
  input.style.cssText = 'position:fixed;top:-1000px;left:-1000px;opacity:0;pointer-events:none;width:1px;height:1px;';
  input.onchange = function(e) {
    var file = e.target.files && e.target.files[0];
    if (_pendingPicker === input) _pendingPicker = null;
    input.remove();
    if (!file) { console.log('[ATTACH] ' + label + ': nada elegido'); return; }
    console.log('[ATTACH] ' + label + ' elegido: ' + _extOf(file.name) + ' ' + Math.round(file.size / 1024) + ' KB ' + (file.type || 'sin tipo'));
    onFile(file);
  };
  _pendingPicker = input;
  document.body.appendChild(input);
  console.log('[ATTACH] Selector abierto: ' + label);
  input.click();
}

export function _readFailed(err) {
  var m = (err && (err.message || err.name)) || 'error de lectura';
  console.warn('[ATTACH] No se pudo leer el archivo: ' + m);
  _showPermissionError('Archivo: no se pudo leer (' + m + ')');
}

export async function _handleGallery() {
  _closeAttachMenu();
  _hideCameraPreviewOverlay();
  _stopCameraPreview();
  await new Promise(function(r) { setTimeout(r, 150); });
  _pickFile('image/*,video/*', 'Galería', function(file) {
    var isVideo = file.type.indexOf('video') === 0;
    // v9.9.30: el vídeo no se lee entero: se recodifica una previa y el original va como HD si cabe
    if (isVideo) {
      _sendVideo(file, { name: file.name, size: file.size, mime: file.type });
      return;
    }
    _readFileBase64(file).then(function(base64) {
      var pt = _photoTarget(_getCurrentContactId());
      return _compressImageBase64(base64, pt.max, pt.q).then(function(res) {
        _sendAttachment('image', res.base64, {
          name: file.name,
          size: res.base64.length,
          type: 'image/jpeg',
          format: res.format || 'jpeg',
          width: res.width,
          height: res.height
        });
      });
    }).catch(_readFailed);
  });
}

export function _handleFile() {
  _closeAttachMenu();
  _pickFile('*/*', 'Archivo', function(file) {
    // Comprobar antes de leer: leer un archivo enorme ya congela el WebView
    var cidF = _getCurrentContactId();
    var maxB64 = _maxB64For(cidF);
    // Ronda 2764: en un grupo, lo que no cabe en el sobre (~1 MB) va como archivo grande a cada miembro
    var inGroup = isGroupId(cidF);
    if (file.size > Math.floor(maxB64 * 3 / 4) || (inGroup && file.size > GROUP_MAX_BYTES)) {
      // Ronda 2756: más grande que lo de siempre: como archivo grande (a disco por trozos) si hay Wi-Fi con el contacto
      var bigs = window.bleInterface && window.bleInterface.bigFiles;
      if (file.size <= BIG_MAX_BYTES && bigs && (inGroup ? groupBigRoute(cidF) : bigs.route(cidF)) && typeof _sendBigFile === 'function') {
        _sendBigFile(cidF, file, _mimeOf(file.type, file.name));
        return;
      }
      console.warn('[ATTACH] Archivo demasiado grande: ' + file.size);
      _showPermissionError(file.size > BIG_MAX_BYTES ? 'Archivo demasiado grande (' + (file.size / 1048576).toFixed(0) + ' MB). Máximo 1 GB.'
        : (inGroup ? 'Demasiado grande para mandarlo por Bluetooth al grupo (' + (file.size / 1048576).toFixed(1) + ' MB).' : _tooBigMessage(file.size, cidF)) +
          ' Hasta 1 GB con ' + (inGroup ? 'alguien del grupo' : 'el contacto') + ' en el mismo Wi-Fi, con Wi-Fi Direct o cerca por Bluetooth (Android 10 o más; ' + (inGroup ? 'con' : 'los dos con') + ' NEXO actualizado).', 8000);
      return;
    }
    _readFileBase64(file).then(function(base64) {
      if (base64.length > maxB64) {
        console.warn('[ATTACH] Archivo demasiado grande:', base64.length);
        _showPermissionError(_tooBigMessage(Math.floor(base64.length * 3 / 4), cidF));
        return;
      }
      var mime = _mimeOf(file.type, file.name);
      var meta = { name: file.name, size: file.size, type: mime, mime: mime };
      return (_isPdf(mime, file.name) ? _pdfThumb(base64) : Promise.resolve(null)).then(function(t) {
        if (t && t.thumb) { meta.thumb = t.thumb; meta.pages = t.pages; }
        _sendAttachment('file', base64, meta);
        console.log('[ATTACH] Archivo:', _extOf(file.name), mime, t && t.thumb ? 'con miniatura' : '');
      });
    }).catch(_readFailed);
  });
}
