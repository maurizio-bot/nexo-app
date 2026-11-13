/**
 * NEXO — Elegir foto de la galería o un archivo (sacado de main.js en la ronda 2752, sin cambios en su código): selector
 * del sistema, lectura, compresión de fotos, miniatura de PDF y límites de tamaño. _sendAttachment lo da main.js.
 */
import { _closeAttachMenu, _showInfoToast, _showPermissionError } from './ui_bits.js';
import { _capAttachments, _photoTooBig, GALLERY_MAX } from './attach_cap.js';
import { _compressImageBase64, _extOf, _isPdf, _mimeOf, _pdfThumb, _readFileBase64 } from './file_tools.js';
import { _getCurrentContactId } from './chat_format.js';
import { _hideCameraPreviewOverlay, _photoTarget, _stopCameraPreview } from './camera.js';
import { _maxB64For, _tooBigMessage, MAX_BLE_FILE_BYTES } from './media_limits.js';
import { _sendVideo } from './video_send.js';
import { BIG_MAX_BYTES } from './big_file.js';
import { groupBigRoute } from './group_media.js';
import { isGroupId } from './groups.js';
import { GROUP_MAX_BYTES, _groupBlobCap } from './send.js';
import { t } from './i18n.js';

// [pegamento] Lo que usa del resto de la app (main.js lo da al arrancar)
var _sendAttachment, _sendBigFile;
export function pickersUse(d) { _sendAttachment = d._sendAttachment; _sendBigFile = d._sendBigFile; } // [/pegamento]


// v9.9.37: selector de archivos. Antes el <input> se quitaba a los 30 s aunque el usuario siguiera
// eligiendo en el selector de Android (buscar una APK en Descargas o un vídeo en la galería lleva más):
// lo elegido después no hacía nada y sin aviso. Ahora vive hasta que se elige algo (o se abre otro).
export var _pendingPicker = null;

// Build 2961 (#dueño 08-11): `multiple` para elegir varias fotos de una. Con multiple, onFile recibe un ARRAY de files;
// sin multiple sigue igual (un solo file), así _handleFile y el resto no cambian.
export function _pickFile(accept, label, onFile, multiple) {
  if (_pendingPicker && _pendingPicker.parentNode) _pendingPicker.remove();
  var input = document.createElement('input');
  input.type = 'file';
  input.accept = accept;
  if (multiple) input.multiple = true;
  input.style.cssText = 'position:fixed;top:-1000px;left:-1000px;opacity:0;pointer-events:none;width:1px;height:1px;';
  input.onchange = function(e) {
    var files = e.target.files;
    if (_pendingPicker === input) _pendingPicker = null;
    input.remove();
    if (!files || !files.length) { console.log('[ATTACH] ' + label + ': nada elegido'); return; }
    if (multiple) {
      var arr = Array.prototype.slice.call(files);
      console.log('[ATTACH] ' + label + ' elegidos: ' + arr.length);
      onFile(arr);
      return;
    }
    var file = files[0];
    console.log('[ATTACH] ' + label + ' elegido: ' + _extOf(file.name) + ' ' + Math.round(file.size / 1024) + ' KB ' + (file.type || 'sin tipo'));
    onFile(file);
  };
  _pendingPicker = input;
  document.body.appendChild(input);
  console.log('[ATTACH] Selector abierto: ' + label);
  input.click();
}

export function _readFailed(err) {
  var m = (err && (err.message || err.name)) || t('misc_read_error', 'error de lectura');
  console.warn('[ATTACH] No se pudo leer el archivo: ' + m);
  _showPermissionError(t('misc_file_read_fail', 'Archivo: no se pudo leer (') + m + ')');
}

export async function _handleGallery() {
  _closeAttachMenu();
  _hideCameraPreviewOverlay();
  _stopCameraPreview();
  await new Promise(function(r) { setTimeout(r, 150); });
  // Build 2961 (#dueño 08-11): elegir VARIAS fotos (hasta GALLERY_MAX) y mandarlas todas, cada una como su mensaje.
  _pickFile('image/*,video/*', 'Galería', function(files) {
    var picked = _capAttachments(files, GALLERY_MAX);
    if (picked.dropped > 0) {
      console.log('[ATTACH] Galería: ' + (picked.send.length + picked.dropped) + ' elegidas, mando ' + picked.send.length + ' (tope ' + GALLERY_MAX + ')');
      try { _showInfoToast(t('misc_gallery_cap', 'Hasta {n} a la vez: mando las primeras {n}.').replace(/\{n\}/g, GALLERY_MAX), 4500); } catch (e) {}
    }
    _sendGalleryItems(picked.send, 0);
  }, true);
}

// Build 2961: mandar las fotos elegidas DE A UNA por dentro — leer → comprimir → mandar la actual, y recién ENTONCES la
// siguiente. Es a propósito: así nunca hay 10 fotos enteras en memoria a la vez (evita el tipo de crash de archivos
// enormes, #2941) ni se tapa la radio de golpe; la base ya pacea el envío. Cada foto va como su propio mensaje (como
// WhatsApp). Los vídeos de la tanda se mandan con _sendVideo (con un respiro entre ellos porque recodificar es pesado).
function _sendGalleryItems(files, i) {
  if (!files || i >= files.length) return;
  var file = files[i];
  var next = function() { _sendGalleryItems(files, i + 1); };
  var isVideo = (file.type || '').indexOf('video') === 0;
  if (isVideo) {
    // v9.9.30: el vídeo no se lee entero: se recodifica una previa y el original va como HD si cabe
    try { _sendVideo(file, { name: file.name, size: file.size, mime: file.type }); } catch (e) { console.warn('[ATTACH] vídeo galería: ' + (e && e.message)); }
    setTimeout(next, 500);
    return;
  }
  if (_photoTooBig(file)) {
    console.log('[ATTACH] Foto de ' + (file.size / 1048576).toFixed(1) + ' MB: más de 5 MB, no se manda');
    try { _showInfoToast(t('chat_photo_big', 'La foto pesa más de 5 MB: elige una más pequeña'), 4500); } catch (e) {}
    next();
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
  }).catch(_readFailed).then(next, next); // seguir con la siguiente pase lo que pase con esta
}

// 13-11 (dueño, S24 → vivo 02:10, APK de 25 MB: «nunca se activó Wi-Fi Direct»): al volver del selector, la app da por
// viejos los estados de enlace con > 10 s (_cleanupStaleStates) y los rehace un momento después («Conexión existente
// recuperada al arrancar», ~70 ms); el archivo elegido caía en ese hueco → «sin camino local para archivos grandes» → se
// leía entero como adjunto y quedaba ⏳ «esperan Wi-Fi/internet», aunque Wi-Fi Direct funcionaba. Si ANTES de abrir el
// selector había camino (Wi-Fi, Wi-Fi Direct o Bluetooth L2CAP) y justo ahora no, se espera a que vuelva (hasta 4 s).
var BIG_ROUTE_WAIT_MS = 4000;
function _bigRoute(cid) { var bigs = window.bleInterface && window.bleInterface.bigFiles; try { return bigs && cid ? bigs.route(cid) : null; } catch (e) { return null; } }
function _waitBigRoute(cid, ms) {
  return new Promise(function(resolve) {
    var t0 = Date.now();
    (function poll() { var r = _bigRoute(cid); if (r || Date.now() - t0 >= ms) { resolve(r); return; } setTimeout(poll, 150); })();
  });
}

export function _handleFile() {
  _closeAttachMenu();
  var cid0 = _getCurrentContactId(), route0 = cid0 && !isGroupId(cid0) ? _bigRoute(cid0) : null;
  _pickFile('*/*', 'Archivo', function(file) {
    var cidW = _getCurrentContactId();
    if (route0 && cidW === cid0 && file && file.size > MAX_BLE_FILE_BYTES && !_bigRoute(cidW)) {
      console.log('[ATTACH] Al volver del selector el enlace con ' + cidW + ' se está rehaciendo (antes: ' + route0 + '): espero para mandarlo como archivo grande');
      _waitBigRoute(cidW, BIG_ROUTE_WAIT_MS).then(function(r) {
        console.log(r ? '[ATTACH] Camino para el archivo grande: ' + r : '[ATTACH] El camino local no volvió en ' + (BIG_ROUTE_WAIT_MS / 1000) + ' s: se decide sin él');
        _fileChosen(file);
      });
      return;
    }
    _fileChosen(file);
  });
}

function _fileChosen(file) {
    // Comprobar antes de leer: leer un archivo enorme ya congela el WebView
    var cidF = _getCurrentContactId();
    var maxB64 = _maxB64For(cidF);
    // Ronda 2764: en un grupo, lo que no cabe en el sobre (~1 MB) va como archivo grande a cada miembro
    var inGroup = isGroupId(cidF);
    // Fase C (2971): en un grupo con internet propio, hasta 5 MB van por el buzón de archivos (una subida, un puntero por miembro)
    var groupBlob = inGroup ? _groupBlobCap() : 0;
    if (groupBlob && file.size <= groupBlob) maxB64 = Math.max(maxB64, Math.ceil(groupBlob * 4 / 3) + 8);
    if (file.size > Math.floor(maxB64 * 3 / 4) || (inGroup && file.size > GROUP_MAX_BYTES && !(groupBlob && file.size <= groupBlob))) {
      // Ronda 2756: más grande que lo de siempre: como archivo grande (a disco por trozos) si hay Wi-Fi con el contacto
      var bigs = window.bleInterface && window.bleInterface.bigFiles;
      if (file.size <= BIG_MAX_BYTES && bigs && (inGroup ? groupBigRoute(cidF) : bigs.route(cidF)) && typeof _sendBigFile === 'function') {
        _sendBigFile(cidF, file, _mimeOf(file.type, file.name));
        return;
      }
      console.warn('[ATTACH] Archivo demasiado grande: ' + file.size);
      _showPermissionError(file.size > BIG_MAX_BYTES ? t('misc_file_too_big_a', 'Archivo demasiado grande (') + (file.size / 1048576).toFixed(0) + t('misc_file_too_big_b', ' MB). Máximo 1 GB.')
        : (inGroup ? t('misc_big_group_a', 'Demasiado grande para mandarlo por Bluetooth al grupo (') + (file.size / 1048576).toFixed(1) + t('misc_big_group_b', ' MB).') : _tooBigMessage(file.size, cidF)) +
          t('misc_upto_1gb_a', ' Hasta 1 GB con ') + (inGroup ? t('misc_someone_group', 'alguien del grupo') : t('misc_the_contact', 'el contacto')) + t('misc_upto_1gb_b', ' en el mismo Wi-Fi, con Wi-Fi Direct o cerca por Bluetooth (Android 10 o más; ') + (inGroup ? t('misc_with', 'con') : t('misc_both_with', 'los dos con')) + t('misc_upto_1gb_c', ' NEXO actualizado).'), 8000);
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
      return (_isPdf(mime, file.name) ? _pdfThumb(base64) : Promise.resolve(null)).then(function(tr) {
        if (tr && tr.thumb) { meta.thumb = tr.thumb; meta.pages = tr.pages; }
        _sendAttachment('file', base64, meta);
        console.log('[ATTACH] Archivo:', _extOf(file.name), mime, tr && tr.thumb ? 'con miniatura' : '');
      });
    }).catch(_readFailed);
}
