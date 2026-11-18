/**
 * NEXO — Elegir foto de la galería o un archivo (sacado de main.js en la ronda 2752, sin cambios en su código): selector
 * del sistema, lectura, compresión de fotos, miniatura de PDF y límites de tamaño. _sendAttachment lo da main.js.
 */
import { _closeAttachMenu, _hideInfoToast, _showInfoToast, _showPermissionError } from './ui_bits.js';
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
import { _openGalleryReview } from './gallery_review.js';

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
    // 3160 (dueño 16-11: «al mandar varias también puedes elegir cuáles de una sola vista»): si hay alguna foto (aunque sea UNA),
    // antes de mandar sale la revisión con las miniaturas y el ojo «ver una vez» en la esquina de cada foto (gallery_review.js); al
    // «Enviar (N)» sale todo como siempre, con once en las marcadas. También en grupos: el «una vez» viaja en el sobre del grupo
    // (meta.once) y la burbuja del miembro la consume igual (como la foto de la cámara). 3163 (dueño 16-11: «hay que aplicar lo de
    // una sola vista a vídeos también»): los vídeos también llevan ojo, así que la revisión sale siempre (aunque solo haya vídeos).
    if (!picked.send.length) return;
    // 3199 (diagnóstico automático del Motorola edge 40 neo, build 3086, 17-11 08:35 y 08:48): desde la 3160 la foto se LEÍA al tocar
    // «Enviar», segundos después de elegirla, y Android ya no la dejaba leer (NotReadableError: el archivo cambió desde que se eligió
    // —Google Fotos, la nube o el selector de fotos dan primero un marcador— o se perdió el permiso temporal): la foto no salía. Ahora
    // se copia a memoria AL ELEGIRLA, antes de la revisión, y la vista previa, el ojo y el envío usan esa copia.
    var cid = _getCurrentContactId();
    _copyPicked(picked.send).then(function(ready) {
      if (!ready.length) return;
      if (_getCurrentContactId() !== cid) { console.log('[ATTACH] Galería: ya no estás en ese chat, no se abre la revisión'); return; }
      _reviewAndSendPhotos(ready);
    });
  }, true);
}

// 3199: la copia en memoria de lo elegido en la Galería. Se lee en partes de hasta 4 MB (nunca un búfer enorme de golpe) y con topes:
// las fotos que se pueden mandar (≤ 5 MB, hasta GALLERY_MAX) siempre; un vídeo solo si pesa ≤ COPY_VIDEO_MAX y cabe en lo que queda de
// COPY_TOTAL_MAX (un vídeo de hasta un minuto puede pasar de 100 MB: copiarlo entero a memoria podría tumbar el WebView). Al vídeo
// grande no se le hace copia: se comprueba al elegirlo que se puede leer (sus primeros 64 KB) y sigue con el original, como antes.
var COPY_CHUNK = 4 * 1024 * 1024;
var COPY_VIDEO_MAX = 24 * 1024 * 1024;   // ~ el mayor vídeo que sale entero (Wi-Fi Direct); los más grandes se recodifican
var COPY_TOTAL_MAX = 64 * 1024 * 1024;   // toda la tanda (10 fotos de 5 MB caben)
var COPY_PROBE = 64 * 1024;
var COPY_RETRY_MS = 500;
var COPY_SLOW_MS = 400;                  // si tarda más (fotos en la nube), un aviso breve mientras se abren

function _isVideoFile(f) { return String((f && f.type) || '').indexOf('video') === 0; }
function _readBuf(b) {
  if (typeof b.arrayBuffer === 'function') return b.arrayBuffer();
  return new Promise(function(resolve, reject) {
    var fr = new FileReader();
    fr.onload = function() { resolve(fr.result); };
    fr.onerror = function() { reject(fr.error || new Error('error de lectura')); };
    fr.readAsArrayBuffer(b);
  });
}
async function _copyFile(file) {
  var n = file.size || 0, parts = [], off = 0;
  if (n <= COPY_CHUNK) parts.push(new Blob([await _readBuf(file)]));
  else {
    while (off < n) {
      var buf = await _readBuf(file.slice(off, Math.min(n, off + COPY_CHUNK)));
      if (!buf.byteLength) break;
      parts.push(new Blob([buf]));
      off += buf.byteLength;
    }
  }
  var copy = new File(parts, file.name, { type: file.type, lastModified: file.lastModified });
  if (!copy.size || (n && copy.size !== n)) throw new Error('copia incompleta (' + copy.size + ' de ' + n + ' bytes)');
  return copy;
}
function _errTxt(e) { return ((e && e.name) || 'Error') + ': ' + ((e && e.message) || e); }
function _copyLabel(f, i, n) { return (_isVideoFile(f) ? 'vídeo ' : 'foto ') + (i + 1) + ' de ' + n + ' (' + _extOf(f.name) + ', ' + Math.round(f.size / 1024) + ' KB)'; }

// Una: { file } (la copia, o el original si no se copia) o null si no se pudo abrir ni al reintentar.
async function _copyOne(f, full, label) {
  for (var round = 0; round < 2; round++) {
    try {
      if (!full) { await _readBuf(f.slice(0, Math.min(f.size || COPY_PROBE, COPY_PROBE))); return { file: f, copied: false }; }
      var copy = await _copyFile(f);
      try { await _readBuf(copy.slice(copy.size - 1)); } catch (e2) {
        // la copia no se puede leer de vuelta (memoria llena): mejor el original que nada
        console.warn('[ATTACH] Galería: la copia de ' + label + ' no se puede leer (' + _errTxt(e2) + '): sigue el original');
        return { file: f, copied: false };
      }
      return { file: copy, copied: true };
    } catch (e) {
      if (round === 0) { console.warn('[ATTACH] Galería: no se pudo leer ' + label + ' al elegir (' + _errTxt(e) + '): reintento en ' + COPY_RETRY_MS + ' ms'); await new Promise(function(r) { setTimeout(r, COPY_RETRY_MS); }); }
      else { console.warn('[ATTACH] Galería: ' + label + ' no se pudo abrir (' + _errTxt(e) + '): no se manda'); }
    }
  }
  return null;
}

// El aviso claro cuando algo elegido no se pudo abrir
function _openFailText(failed) {
  if (failed.length > 1) return t('grev_open_fail_n', 'No se pudieron abrir {n} de las que elegiste. Si están en la nube, ábrelas antes en tu galería y vuelve a elegirlas.').replace('{n}', failed.length);
  return _isVideoFile(failed[0]) ? t('grev_open_fail_video', 'No se pudo abrir ese vídeo. Si está en la nube, ábrelo antes en tu galería y vuelve a elegirlo.')
    : t('grev_open_fail', 'No se pudo abrir esa foto. Si está en la nube, ábrela antes en tu galería y vuelve a elegirla.');
}

// Copia lo elegido EN ORDEN, de a uno (sin bloquear la pantalla: cada lectura es asíncrona). Devuelve lo que se pudo abrir, en el mismo
// orden; lo que no, se avisa y no se manda (ni deja un mensaje en el chat).
async function _copyPicked(files) {
  var t0 = Date.now(), out = [], failed = [], nCopied = 0, bytes = 0, kept = 0, slowShown = false;
  var left = COPY_TOTAL_MAX;
  files.forEach(function(f) { if (!_isVideoFile(f) && !_photoTooBig(f)) left -= f.size || 0; });
  var slow = setTimeout(function() { slowShown = true; try { _showInfoToast(t('grev_opening', 'Abriendo lo que elegiste…'), 15000); } catch (e) {} }, COPY_SLOW_MS);
  for (var i = 0; i < files.length; i++) {
    var f = files[i];
    // Una foto de más de 5 MB no se lee: al mandar sale su aviso de siempre
    if (!_isVideoFile(f) && _photoTooBig(f)) { out.push(f); kept++; continue; }
    var full = !_isVideoFile(f) || ((f.size || 0) <= COPY_VIDEO_MAX && (f.size || 0) <= left);
    if (_isVideoFile(f) && full) left -= f.size || 0;
    if (!full) console.log('[ATTACH] Galería: ' + _copyLabel(f, i, files.length) + ' sin copiar (grande): se lee al mandarlo');
    var r = await _copyOne(f, full, _copyLabel(f, i, files.length));
    if (!r) { failed.push(f); continue; }
    out.push(r.file);
    if (r.copied) { nCopied++; bytes += r.file.size; } else kept++;
  }
  clearTimeout(slow);
  if (slowShown) try { _hideInfoToast(); } catch (e) {}
  var extra = (kept ? ', ' + kept + ' con el original' : '') + (failed.length ? ', ' + failed.length + ' no se pudieron abrir' : ''); // i18n-ok (registro)
  console.log('[ATTACH] Galería: copiadas ' + nCopied + ' (' + Math.round(bytes / 1024) + ' KB) en ' + (Date.now() - t0) + ' ms' + extra);
  if (failed.length) try { _showPermissionError(_openFailText(failed), 7000); } catch (e) {}
  return out;
}

// La revisión «Antes de enviar» (con el ojo «ver una vez») y el envío de lo elegido, de a una. 3171 (dueño 17-11: «las fotos se ven
// mal»; opción A): la foto tomada con la cámara del propio teléfono (camera.js, _handleCamera) entra por aquí igual que una de la
// galería: misma revisión, mismo tamaño por camino (_photoTarget), mismo tope de 5 MB y misma miniatura.
export function _reviewAndSendPhotos(files) {
  return _openGalleryReview(files, { eyes: true }, function(once, cap) { _sendGalleryItems(files, 0, once, cap); });
}

// Build 2961: mandar las fotos elegidas DE A UNA por dentro — leer → comprimir → mandar la actual, y recién ENTONCES la
// siguiente. Es a propósito: así nunca hay 10 fotos enteras en memoria a la vez (evita el tipo de crash de archivos
// enormes, #2941) ni se tapa la radio de golpe; la base ya pacea el envío. Cada foto va como su propio mensaje (como
// WhatsApp). Los vídeos de la tanda se mandan con _sendVideo (con un respiro entre ellos porque recodificar es pesado).
// 3160: once[i] === true → esa foto (3163: o ese vídeo) va «ver una vez» (lo marcado en la revisión); sin once, como siempre.
// 3199: lo de la galería llega aquí ya copiado a memoria (_copyPicked: Blob, hasta COPY_TOTAL_MAX); lo pesado (base64, decodificar y
// comprimir) sigue siendo de a una.
function _sendGalleryItems(files, i, once, cap) {
  if (!files || i >= files.length) return;
  var file = files[i];
  var next = function() { _sendGalleryItems(files, i + 1, once, cap); };
  var capHere = (cap && i === 0) ? cap : ''; // 3242: el comentario va con la primera de la tanda
  var isVideo = (file.type || '').indexOf('video') === 0;
  if (isVideo) {
    // v9.9.30: el vídeo no se lee entero: se recodifica una previa y el original va como HD si cabe
    var vMeta = { name: file.name, size: file.size, mime: file.type };
    if (capHere) vMeta.caption = capHere;
    if (once && once[i]) vMeta.once = true; // 3163: vídeo «ver una vez», marcado con el ojo en la revisión
    try { _sendVideo(file, vMeta); } catch (e) { console.warn('[ATTACH] vídeo galería: ' + (e && e.message)); }
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
      var meta = {
        name: file.name,
        size: res.base64.length,
        type: 'image/jpeg',
        format: res.format || 'jpeg',
        width: res.width,
        height: res.height
      };
      if (capHere) meta.caption = capHere;
      if (once && once[i]) meta.once = true; // #94 «ver una vez», marcado con el ojo en la revisión (3160)
      _sendAttachment('image', res.base64, meta);
    });
  }).catch(function(err) {
    // 3199: si aun así no se puede leer (la copia no se pudo hacer y Android ya no deja leer el original), el aviso claro
    if (err && (err.name === 'NotReadableError' || err.name === 'NotFoundError')) {
      console.warn('[ATTACH] Galería: foto ' + (i + 1) + ' no se pudo leer al mandarla (' + _errTxt(err) + ')');
      _showPermissionError(_openFailText([file]), 7000);
    } else _readFailed(err);
  }).then(next, next); // seguir con la siguiente pase lo que pase con esta
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

// 3242 (dueño 18-11): antes de mandar un archivo, la revisión con un comentario opcional
function _fileChosen(file) {
  _openGalleryReview([file], { eyes: false, file: true }, function(once, cap) { _fileChosenSend(file, cap); });
}
function _fileChosenSend(file, cap) {
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
      if (cap) meta.caption = cap;
      return (_isPdf(mime, file.name) ? _pdfThumb(base64) : Promise.resolve(null)).then(function(tr) {
        if (tr && tr.thumb) { meta.thumb = tr.thumb; meta.pages = tr.pages; }
        _sendAttachment('file', base64, meta);
        console.log('[ATTACH] Archivo:', _extOf(file.name), mime, tr && tr.thumb ? 'con miniatura' : '');
      });
    }).catch(_readFailed);
}
