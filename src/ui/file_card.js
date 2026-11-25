/**
 * NEXO — Archivos en el chat (sacado de main.js en la ronda 2752, sin cambios): tarjeta de archivo (icono, tamaño,
 * miniatura de PDF), abrir el archivo, miniaturas de vídeo y PDF, y ver fotos/vídeos a pantalla completa.
 */
import { _extOf, _fileIcon, _fmtSize, _isPdf, _mimeOf, _pdfThumb } from './file_tools.js';
import { _getCurrentContactId } from './chat_format.js';
import { _makeVideoThumb } from './video_tools.js';
import { _msgContactMap } from './chat_state.js';
import { _releaseMedia, _showPermissionError, _showInfoToast } from './ui_bits.js';
import { haptic } from './haptics.js'; // 3129: el botón de guardar vibra al terminar
import { vaultLoadFile, vaultSetMessageFields } from '../vault/vault_manager.js';
import { isGroupId } from './groups.js';
import { bigToGroup } from './group_media.js';
import { t } from './i18n.js';
import { isStoreBuild, isApkFile, displayFileName } from './store_flag.js'; // COLA 26: en Google Play no se instalan APK
import { blobForUrl } from './blob_registry.js'; // 3162: el vídeo se guarda sin fetch de su blob: (la CSP no lo deja)
import { viewerGestures, viewerSlide } from './media_swipe.js';   // 3159: deslizar entre fotos y para cerrar


export function _closeFullscreenMedia() {
  var ov = document.getElementById('fullscreen-media-overlay');
  if (!ov) return;
  var onClose = ov.__nexoOnClose; ov.__nexoOnClose = null;
  _releaseMedia(ov);
  ov.remove();
  if (typeof onClose === 'function') { try { onClose(); } catch (e) {} }
}

// 3159 (dueño 16-11): `fromEl` = la burbuja desde la que se abrió (render.js); con ella, el visor se desliza de lado entre las fotos
// y vídeos del chat (media_swipe.js). Sin ella («ver una vez», foto de un contacto) solo se cierra.
// 3163: onClose = se llama al cerrar el visor (por donde sea: deslizar, tocar fuera, «atrás» u otro visor); el vídeo «ver una vez»
// libera ahí su URL.
export function _openFullscreenMedia(src, type, noSave, fromEl, onClose) {
  _closeFullscreenMedia();
  if (!src) { console.warn('[VIDEO] Sin fuente para el visor'); if (typeof onClose === 'function') { try { onClose(); } catch (e) {} } return; }
  var overlay = document.createElement('div');
  overlay.id = 'fullscreen-media-overlay';
  if (typeof onClose === 'function') overlay.__nexoOnClose = onClose;
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.95);z-index:5000;overflow:hidden;touch-action:none;';
  // 3159 (dueño 16-11: «para salir de las fotos y regresar al chat con deslizar hacia arriba, ya quita la x»): ya no hay X. Se cierra
  // deslizando hacia arriba (o abajo), tocando fuera de la foto o con el «atrás» de Android (chat_nav.js → __nexoCloseMedia).
  // v9.9.31: no revocar src: es la misma URL que usa la burbuja (después no se podía volver a ver);
  // se liberan al salir del chat (_cleanupObjectURLs)
  // Ronda 2801 (pedido del dueño #92): guardar en la galería. NO en «ver una vez» (noSave): se consumen, no se guardan.
  // 3159: un botón por cada foto/vídeo que se ve (guarda la que se ve; al volver a una, su botón conserva si ya se guardó).
  var saveBtn = null, saveBtns = new Map();
  var leave = function() { if (saveBtn) { saveBtn.remove(); saveBtn = null; } };
  var show = function(slide, s, ty, el) {
    _releaseMedia(slide);
    slide.textContent = '';
    if (ty === 'image') slide.appendChild(_viewerImage(s));
    else if (ty === 'video') slide.appendChild(_viewerVideo(s, noSave));
    if (noSave) return;
    leave();
    var key = el || overlay, had = saveBtns.get(key);
    saveBtn = (had && had.src === s) ? had.btn : _viewerSaveBtn(s, ty);
    saveBtns.set(key, { src: s, btn: saveBtn });
    overlay.appendChild(saveBtn);
  };
  var slide = viewerSlide();
  overlay.appendChild(slide);
  show(slide, src, type, fromEl);
  overlay.addEventListener('click', function(e) {
    var tg = e.target;
    if (tg === overlay || (tg && tg.classList && tg.classList.contains('fs-slide'))) _closeFullscreenMedia();   // fuera de la foto
  });
  document.body.appendChild(overlay);
  viewerGestures(overlay, { slide: slide, el: (!noSave && fromEl) || null, show: show, leave: leave, close: _closeFullscreenMedia });
}
// 3159 (dueño 16-11: «quiero que lo muevas a la esquina baja a la derecha por una cuestión ergonómica»): el botón de guardar va ABAJO a la
// DERECHA, al alcance del pulgar. En un vídeo, por ENCIMA de la barra del reproductor: el vídeo mide como mucho 85vh centrado (su borde
// de abajo queda a ≥ 7,5vh del borde de la pantalla) y la barra mide ~48 px, así que a 7,5vh + 64 px nunca la tapa.
function _viewerSaveBtn(src, type) {
  var dlBtn = document.createElement('button');
  dlBtn.className = 'fs-save-btn';
  dlBtn.setAttribute('data-state', 'idle');
  dlBtn.innerHTML = _ICON_DL;
  dlBtn.title = t('media_save_gallery', 'Guardar en galería');
  var bottom = type === 'video' ? 'max(calc(7.5vh + 64px), calc(20px + env(safe-area-inset-bottom,0px)))' : 'calc(20px + env(safe-area-inset-bottom,0px))';
  dlBtn.style.cssText = 'position:absolute;bottom:' + bottom + ';right:calc(18px + env(safe-area-inset-right,0px));width:42px;height:42px;border-radius:50%;background:rgba(255,255,255,0.1);border:1px solid rgba(255,255,255,0.08);cursor:pointer;display:flex;align-items:center;justify-content:center;z-index:5001;padding:0;';
  dlBtn.onclick = function(e) { if (e) e.stopPropagation(); _saveMediaToGallery(src, type, dlBtn); };
  return dlBtn;
}
function _viewerImage(src) {
  var img = document.createElement('img');
  img.src = src;
  img.style.cssText = 'max-width:95vw;max-height:85vh;object-fit:contain;border-radius:8px;transition:transform 0.15s ease;cursor:zoom-in;transform-origin:center center;touch-action:none;';
  // Ronda 2783 (pedido del dueño): ampliar la foto con DOS DEDOS (pellizco: se abren = acercar, se juntan = alejar) o
  // con DOBLE TOQUE (alterna normal / 2,5x). Con la foto ampliada, un dedo la arrastra para ver el resto. Un toque
  // solo no hace nada (para cerrar: fuera de la foto, deslizar arriba o «atrás»).
  var zScale = 1, ztx = 0, zty = 0, pinch0 = 0, pinchScale0 = 1, panX0 = 0, panY0 = 0, lastTapV = 0, zMoved = false, sx0 = 0, sy0 = 0;
  var zApply = function(anim) {
    // Ronda 2784 (pedido del dueño): el arrastre no pasa del borde de la foto (su borde se pega al de la pantalla;
    // nunca se ve negro más allá). El máximo de desplazamiento es la mitad de lo que sobresale la imagen ampliada.
    var maxX = Math.max(0, (img.offsetWidth * zScale - window.innerWidth) / 2);
    var maxY = Math.max(0, (img.offsetHeight * zScale - window.innerHeight) / 2);
    ztx = Math.max(-maxX, Math.min(maxX, ztx));
    zty = Math.max(-maxY, Math.min(maxY, zty));
    img.style.transition = anim ? 'transform 0.15s ease' : 'none';
    img.style.transform = 'translate(' + ztx + 'px,' + zty + 'px) scale(' + zScale + ')';
    img.style.cursor = zScale > 1 ? 'zoom-out' : 'zoom-in';
    img.dataset.zoom = String(zScale);   // 3159: con la foto ampliada, el visor no desliza ni cierra (media_swipe.js)
  };
  var zDist = function(t) { var dx = t[0].clientX - t[1].clientX, dy = t[0].clientY - t[1].clientY; return Math.sqrt(dx * dx + dy * dy); };
  var zClamp = function(v, a, b) { return Math.max(a, Math.min(b, v)); };
  img.addEventListener('touchstart', function(e) {
    var t = e.touches || [];
    zMoved = false;
    if (t.length >= 2) { pinch0 = zDist(t) || 1; pinchScale0 = zScale; }
    else if (t.length === 1) { panX0 = t[0].clientX - ztx; panY0 = t[0].clientY - zty; sx0 = t[0].clientX; sy0 = t[0].clientY; }
    if (e.cancelable) e.preventDefault();
  }, { passive: false });
  img.addEventListener('touchmove', function(e) {
    var t = e.touches || [];
    if (t.length >= 2) {
      zMoved = true;
      zScale = zClamp(pinchScale0 * (zDist(t) / pinch0), 1, 5);
      zApply(false);
      if (e.cancelable) e.preventDefault();
    } else if (t.length === 1 && zScale > 1) {
      zMoved = true;
      ztx = t[0].clientX - panX0; zty = t[0].clientY - panY0;
      zApply(false);
      if (e.cancelable) e.preventDefault();
    } else if (t.length === 1 && Math.abs(t[0].clientX - sx0) + Math.abs(t[0].clientY - sy0) > 10) {
      zMoved = true;   // 3159: deslizar (cambiar de foto o cerrar) no cuenta como toque para el doble toque
    }
  }, { passive: false });
  img.addEventListener('touchend', function(e) {
    if ((e.touches && e.touches.length) || 0) return;   // aún queda un dedo en la pantalla
    if (zScale <= 1.02) { zScale = 1; ztx = 0; zty = 0; zApply(true); }
    if (!zMoved) {                                       // doble toque (sin pellizco ni arrastre): alternar
      var now = Date.now();
      if (now - lastTapV < 320) { lastTapV = 0; if (zScale > 1) { zScale = 1; ztx = 0; zty = 0; } else { zScale = 2.5; } zApply(true); }
      else lastTapV = now;
    }
  }, { passive: false });
  return img;
}
function _viewerVideo(src, noSave) {
  var video = document.createElement('video');
  video.src = src;
  video.controls = true;
  video.autoplay = true;
  video.playsInline = true;
  // 3244 (dueño 18-11: «al reproducir un vídeo aparece un momento el cuadro gris con el triángulo de play»): un póster transparente (como en
  // los estados desde la 3230) tapa ese cuadro del sistema mientras llega el primer fotograma
  video.setAttribute('poster', 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7');
  if (noSave) {
    // 3163: vídeo «ver una vez»: el reproductor tampoco ofrece descargarlo ni sacarlo a una ventana flotante
    video.setAttribute('controlsList', 'nodownload noremoteplayback');
    video.setAttribute('disablepictureinpicture', '');
    try { video.disablePictureInPicture = true; } catch (e) {}
    video.addEventListener('contextmenu', function(e) { e.preventDefault(); });
  }
  video.style.cssText = 'max-width:95vw;max-height:85vh;border-radius:8px;background:#000;';
  video.onerror = function() { console.warn('[VIDEO] El visor no pudo reproducir: código ' + (video.error && video.error.code)); };
  return video;
}
// Ronda 2801 (#92): guardar la foto/vídeo que se está viendo en la GALERÍA del teléfono (plugin nativo saveToGallery).
// El visor tiene data: URL (foto) o blob: URL (vídeo); de ahí sacamos los bytes en base64 para el nativo.
function _extForMime(mime) {
  mime = String(mime || '');
  if (/png/.test(mime)) return 'png'; if (/webp/.test(mime)) return 'webp'; if (/gif/.test(mime)) return 'gif';
  if (/mp4/.test(mime)) return 'mp4'; if (/webm/.test(mime)) return 'webm'; if (/3gpp?/.test(mime)) return '3gp';
  if (/quicktime|mov/.test(mime)) return 'mov';
  return mime.indexOf('video') === 0 ? 'mp4' : 'jpg';
}
function _blobToB64(blob) {
  return new Promise(function(resolve, reject) {
    var r = new FileReader();
    r.onload = function() { var s = String(r.result || ''); var i = s.indexOf(','); resolve(i >= 0 ? s.substring(i + 1) : ''); };
    r.onerror = function() { reject(new Error('lectura')); };
    r.readAsDataURL(blob);
  });
}
// 3129 (dueño 15-11: «la flechita para la descarga no tiene ningún tipo de retroalimentación para que el usuario sepa que sí la
// bajó»): antes solo se aclaraba el botón y, al terminar, salía un aviso ROJO (el de los errores) igual para «guardado» que para
// «falló». Ahora el propio botón cuenta lo que pasa: gira mientras guarda; al terminar se pone VERDE con una palomita (y vibra) y un
// aviso azul dice dónde quedó; si falla, ROJO con el motivo. Otra vez el mismo botón: «ya está en tu galería» (no se duplica).
// Si el teléfono no contesta en 20 s, cuenta como fallo (perilla de pruebas: NEXO_SAVE_TIMEOUT_MS).
var _ICON_DL = '<svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="#fff" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg>';
var _ICON_OK = '<svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="#fff" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
var _ICON_FAIL = '<svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="#fff" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 7v7M12 17.5v.5"/></svg>';
var _ICON_SPIN = '<span style="width:22px;height:22px;border-radius:50%;border:3px solid rgba(255,255,255,.35);border-top-color:#fff;display:block;animation:nxspin .8s linear infinite;"></span>';
function _saveBtnState(btn, st) {
  if (!btn) return;
  btn.setAttribute('data-state', st);
  if (!document.getElementById('nx-spin-style')) { var stl = document.createElement('style'); stl.id = 'nx-spin-style'; stl.textContent = '@keyframes nxspin{to{transform:rotate(360deg)}}'; document.head.appendChild(stl); }
  btn.innerHTML = st === 'saving' ? _ICON_SPIN : st === 'ok' ? _ICON_OK : st === 'fail' ? _ICON_FAIL : _ICON_DL;
  btn.style.background = st === 'ok' ? 'rgba(34,197,94,0.95)' : st === 'fail' ? 'rgba(239,68,68,0.95)' : 'rgba(255,255,255,0.1)';
  btn.style.opacity = '1';
  btn.title = st === 'ok' ? t('media_saved_ok', 'Guardada en tu galería') : t('media_save_gallery', 'Guardar en galería');
}
export function _saveMediaToGallery(src, type, btn) {
  var pl = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.NexoBLE;
  if (!pl || typeof pl.saveToGallery !== 'function') { _showPermissionError(t('media_save_unsupported', 'Guardar: esta versión no puede guardar en la galería')); return; }
  var st = btn && btn.getAttribute('data-state');
  if (st === 'saving') return;
  if (st === 'ok') { _showInfoToast(t('media_saved_already', 'Ya está en tu galería (carpeta NEXO)'), 2500); haptic('tick'); return; }
  _saveBtnState(btn, 'saving');
  var finished = false;
  var limit = (typeof window.NEXO_SAVE_TIMEOUT_MS === 'number') ? window.NEXO_SAVE_TIMEOUT_MS : 20000;
  var timer = setTimeout(function() { done(false); }, limit);
  var done = function(ok) {
    if (finished) return;
    finished = true; clearTimeout(timer);
    if (ok) {
      _saveBtnState(btn, 'ok'); haptic('confirm');
      _showInfoToast(type === 'video' ? t('media_saved_ok_video', 'Vídeo guardado en tu galería (carpeta NEXO)') : t('media_saved_ok', 'Guardada en tu galería'), 3000);
    } else {
      _saveBtnState(btn, 'fail'); haptic('reject');
      _showPermissionError(t('media_saved_fail', 'No se pudo guardar en la galería'));
      setTimeout(function() { if (btn && btn.getAttribute('data-state') === 'fail') _saveBtnState(btn, 'idle'); }, 3500);
    }
  };
  var send = function(b64, mime) {
    if (!b64) { done(false); return; }
    pl.saveToGallery({ base64: b64, name: 'NEXO_' + Date.now() + '.' + _extForMime(mime), mime: mime })
      .then(function(r) { done(!!(r && r.saved)); }).catch(function() { done(false); });
  };
  try {
    if (typeof src === 'string' && src.indexOf('data:') === 0) {
      var meta = src.substring(5, src.indexOf(','));           // p. ej. "image/jpeg;base64"
      var mime = (meta.split(';')[0]) || (type === 'video' ? 'video/mp4' : 'image/jpeg');
      send(src.substring(src.indexOf(',') + 1), mime);
    } else {
      var known = blobForUrl(src);
      (known ? Promise.resolve(known) : fetch(src).then(function(r) { return r.blob(); })).then(function(blob) {
        return _blobToB64(blob).then(function(b64) { send(b64, blob.type || (type === 'video' ? 'video/mp4' : 'image/jpeg')); });
      }).catch(function() { done(false); });
    }
  } catch (e) { done(false); }
}

// Para la prueba del simulador (zoom de la foto): abrir el visor sin tener que mandar una imagen por la radio
if (typeof window !== 'undefined') { window.__nexoOpenMedia = _openFullscreenMedia; window.__nexoCloseMedia = _closeFullscreenMedia; window.__nexoOpenFile = _openAttachmentFile; window.NEXO_saveMedia = _saveMediaToGallery; }

export var _thumbsInProgress = {};

export function _buildFileCard(msg, attachment, mime) {
  var m = attachment.meta || {};
  var name = String(m.name || 'archivo');
  mime = _mimeOf(mime, name);
  // I-S1/T-A1: si el nombre (saneado como en el nativo) es de APK, se muestra y se trata como APK diga lo que diga el tipo
  if (isApkFile(name, mime)) mime = 'application/vnd.android.package-archive';
  var card = document.createElement('div');
  card.className = 'file-attachment';
  card.style.cssText = 'width:220px;max-width:100%;background:rgba(255,255,255,0.12);border-radius:12px;overflow:hidden;cursor:pointer;'; // 3140: superficie clara, sin la caja oscura
  if (_isPdf(mime, name)) {
    var img = document.createElement('img');
    img.className = 'file-thumb';
    img.alt = '';
    img.style.cssText = 'display:none;width:100%;max-height:260px;object-fit:cover;object-position:top;background:#fff;';
    if (m.thumb) { img.src = 'data:image/jpeg;base64,' + m.thumb; img.style.display = 'block'; }
    else if (!m.thumbFailed) _ensurePdfThumb(msg, attachment, img);   // 2988: un PDF que ya falló no se reintenta en cada apertura
    card.appendChild(img);
  }
  var row = document.createElement('div');
  row.style.cssText = 'display:flex;align-items:center;gap:10px;padding:8px 12px;';
  var ic = document.createElement('div');
  ic.style.cssText = 'width:40px;height:40px;border-radius:50%;background:rgba(255,255,255,0.18);display:flex;align-items:center;justify-content:center;font-size:20px;line-height:1;flex-shrink:0;'; // 3140: en un círculo, como en Contactos
  ic.textContent = _fileIcon(mime);
  var txt = document.createElement('div');
  txt.style.cssText = 'min-width:0;flex:1;';
  var nm = document.createElement('div');
  nm.className = 'file-name';
  nm.style.cssText = 'font-size:14px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
  nm.textContent = displayFileName(name);   // T-A1: sin control ni RTL («fdp.apk» no se ve como «kpa.pdf»)
  var sub = document.createElement('div');
  sub.className = 'file-sub';
  sub.style.cssText = 'font-size:11px;opacity:0.7;';
  var size = Number(m.size) || (attachment.payload ? Math.floor(attachment.payload.length * 3 / 4) : 0);
  var parts = [];
  if (m.pages) parts.push(m.pages + (m.pages == 1 ? t('media_page_sing', ' página') : t('media_page_plur', ' páginas')));
  if (size) parts.push(_fmtSize(size));
  var bigId = m.big && /^[A-Za-z0-9_-]{1,64}$/.test(String(m.big.id || '')) ? String(m.big.id) : '';
  // Fase D (2972): marcador de una «cita» (archivo > 5 MB que llegará cuando los dos estén en línea): sin archivo todavía
  var citaWait = !!(m.cita && (!attachment.payload || attachment.payload === 'cita'));
  if (bigId) { card.dataset.bigId = bigId; card.dataset.bigOwn = msg && msg._own ? '1' : ''; card.dataset.bigSize = _fmtSize(size); _bigWatch(); }
  else if (citaWait) { card.dataset.cita = '1'; parts.push(t('media_cita_waiting', 'Esperando que los dos estén en línea para bajarlo')); }
  else parts.push(t('media_tap_open', 'Toca para abrir'));
  sub.textContent = parts.join(' · ');
  txt.appendChild(nm);
  txt.appendChild(sub);
  row.appendChild(ic);
  row.appendChild(txt);
  card.appendChild(row);
  if (bigId) _bigSub(card);
  card.onclick = function(e) {
    e.stopPropagation();
    if (citaWait) { _showPermissionError(t('media_cita_tap', 'Llega solo cuando los dos estén en línea; ya le avisé que estoy')); return; } // Fase D
    if (bigId) { _bigTap(msg, m.big, name, mime); return; }
    // 2988: el archivo no se leyó al abrir el chat (payload 'L'): se carga ahora, al tocar
    if (m.lazyRef) { vaultLoadFile(m.lazyRef).then(function(b64) { _openAttachmentFile(b64, name, mime); }).catch(function() { _openAttachmentFile(null, name, mime); }); return; }
    _openAttachmentFile(attachment.payload, name, mime);
  };
  return card;
}

// ===== Archivos grandes (ronda 2756, big_file.js): la tarjeta enseña en qué va y qué pasa al tocarla =====
function _bigs() { return window.bleInterface && window.bleInterface.bigFiles; }
function _bigText(card) {
  var b = _bigs(), id = card.dataset.bigId, own = card.dataset.bigOwn === '1', size = card.dataset.bigSize || '';
  var s = b && b.state(id);
  var pct = s && s.total ? Math.min(100, Math.floor((s.bytes || 0) * 100 / s.total)) : 0;
  var head = size ? size + ' · ' : '';
  if (!s) return head + (own ? t('media_tap_open', 'Toca para abrir') : t('media_waiting_file', 'Esperando el archivo · Toca para pedirlo'));
  if (s.state === 'preparing') return head + t('media_preparing', 'Preparando ') + pct + ' %';
  var via = ({ wd: ' (Wi-Fi Direct)', lan: ' (Wi-Fi)', l2: ' (Bluetooth)' })[s.via] || '';
  // 3260: ya enviado, la tarjeta dice por dónde fue y a qué velocidad (el envío por Wi-Fi Direct dura segundos y la etiqueta de «Enviando» casi no se veía)
  if (s.state === 'done' && s.dir !== 'in' && s.via) return head + t('media_tap_open', 'Toca para abrir') + ' · ' + ({ wd: 'Wi-Fi Direct', lan: 'Wi-Fi', l2: 'Bluetooth' })[s.via] + (s.mbps > 0 ? ' · ' + String(s.mbps).replace('.', ',') + ' MB/s' : '');
  if (s.state === 'sending') return head + t('media_sending', 'Enviando ') + pct + ' %' + via;
  if (s.state === 'receiving') return head + t('media_receiving', 'Recibiendo ') + pct + ' %' + via;
  if (s.state === 'waiting') return head + t('media_requested_again', 'Pedido otra vez…');
  if (s.state === 'failed') return head + (s.dir === 'out' ? t('media_send_fail_retry', 'No se pudo enviar · Toca para reintentar') : t('media_incomplete_file', 'No llegó entero · Toca para pedirlo'));
  return head + t('media_tap_open', 'Toca para abrir');
}
function _bigSub(card) { var sub = card.querySelector('.file-sub'); if (sub) sub.textContent = _bigText(card); }
var _bigWatching = false;
function _bigWatch() {
  if (_bigWatching) return;
  _bigWatching = true;
  window.addEventListener('nexo:big', function(ev) {
    var id = ev && ev.detail && ev.detail.id;
    if (!id) return;
    document.querySelectorAll('.file-attachment[data-big-id="' + id + '"]').forEach(_bigSub);
  });
}
function _bigTap(msg, big, name, mime) {
  var b = _bigs(), id = String(big.id), cid = (msg && (_msgContactMap[msg.msgId || msg.messageId] || msg.contactNexoId)) || _getCurrentContactId();
  if (!b) { _showPermissionError(t('media_file_cant_open_ver', 'Archivo: esta versión no puede abrirlo')); return; }
  var s = b.state(id) || {};
  var own = !!(msg && msg._own);
  if (s.state === 'preparing' || s.state === 'sending' || s.state === 'receiving' || s.state === 'waiting') return;
  // Ronda 2764: en un grupo, reintentar es mandarlo a quien falte y pedirlo es pedírselo a quien lo mandó
  var inGroup = isGroupId(cid);
  if (s.state === 'failed' && s.dir === 'out') { if (inGroup) bigToGroup(cid, id); else b.transfer(cid, id).catch(function() {}); return; }
  if (!own && inGroup) cid = (msg && msg.senderNexoId) || big.from || cid;
  if (!own && s.state !== 'done') {
    if (!b.request(cid, id)) _showPermissionError(t('media_bigfile_need_wifi', 'Archivo grande: hace falta estar en el mismo Wi-Fi que el contacto o con Wi-Fi Direct'));
    return;
  }
  if (!big.key) { _showPermissionError(t('media_file_not_ready', 'Archivo: todavía no está listo')); return; }
  if (isStoreBuild() && isApkFile(name, mime)) { _showPermissionError(t('media_file_apk_store', 'Archivo: esta versión de NEXO no instala apps. Guárdalo y ábrelo desde tus archivos.')); return; }
  if (_openingFile) return;
  _openingFile = true;
  console.log('[BIG] Abrir ' + id + ' (' + _extOf(name) + ')');
  b.open(id, big.key, name, mime).then(function(r) {
    if (r && r.opened === false) {
      if (r.reason === 'install_permission') _showPermissionError(t('media_file_install_perm', 'Archivo: permite a NEXO instalar apps y vuelve a tocar la APK'));
      else if (r.reason === 'store_apk') _showPermissionError(t('media_file_apk_store', 'Archivo: esta versión de NEXO no instala apps. Guárdalo y ábrelo desde tus archivos.'));
      else if (r.reason === 'missing') _showPermissionError(t('media_file_gone', 'Archivo: ya no está en este teléfono') + (own ? '' : t('media_tap_request_again', ' · Toca otra vez para pedirlo')));
      else _showPermissionError(t('media_file_no_app', 'Archivo: no hay ninguna app en el teléfono para abrir este tipo de archivo'));
      if (r.reason === 'missing' && !own) { b.saved[id] = undefined; b._set(id, { dir: 'in', state: 'failed' }); }
    }
  }).catch(function(e) { _showPermissionError(t('media_file_open_fail_a', 'Archivo: no se pudo abrir (') + ((e && e.message) || 'error') + ')'); })
    .then(function() { _openingFile = false; });
}

export var _openingFile = false;

export function _openAttachmentFile(b64, name, mime) {
  var pl = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.NexoBLE;
  if (!b64) { _showPermissionError(t('media_file_not_available', 'Archivo: todavía no está disponible')); return; }
  if (!pl || typeof pl.openFile !== 'function') { _showPermissionError(t('media_file_cant_open_ver', 'Archivo: esta versión no puede abrirlo')); return; }
  if (isStoreBuild() && isApkFile(name, mime)) { _showPermissionError(t('media_file_apk_store', 'Archivo: esta versión de NEXO no instala apps. Guárdalo y ábrelo desde tus archivos.')); return; }
  if (_openingFile) return;
  _openingFile = true;
  console.log('[ATTACH] Abrir archivo ' + _extOf(name) + ' (' + mime + ')');
  // store: el nativo tampoco instala una APK en la versión de tienda (I-S1), aunque esta comprobación de arriba fallara
  pl.openFile({ base64: b64, name: name, mime: mime, store: isStoreBuild() }).then(function(r) {
    if (r && r.opened === false) {
      console.warn('[ATTACH] No abierto: ' + r.reason);
      if (r.reason === 'install_permission') _showPermissionError(t('media_file_install_perm', 'Archivo: permite a NEXO instalar apps y vuelve a tocar la APK'));
      else if (r.reason === 'store_apk') _showPermissionError(t('media_file_apk_store', 'Archivo: esta versión de NEXO no instala apps. Guárdalo y ábrelo desde tus archivos.'));
      else _showPermissionError(t('media_file_no_app', 'Archivo: no hay ninguna app en el teléfono para abrir este tipo de archivo'));
    }
  }).catch(function(e) {
    console.warn('[ATTACH] Error abriendo archivo: ' + (e && e.message));
    _showPermissionError(t('media_file_open_fail_a', 'Archivo: no se pudo abrir (') + ((e && e.message) || 'error') + ')');
  }).then(function() { _openingFile = false; });
}

// Receptor (o mensajes antiguos): si el PDF llegó sin miniatura, se genera aquí y se guarda
export function _ensurePdfThumb(msg, attachment, img) {
  var mid = msg.msgId || msg.messageId;
  if (!attachment.payload || !mid || _thumbsInProgress[mid]) return;
  _thumbsInProgress[mid] = true;
  _pdfThumb(attachment.payload).then(function(t) {
    delete _thumbsInProgress[mid];
    if (!t || !t.thumb) {
      // 2988: PDF «no legible» (o sin lector): se anota para no volver a leerlo y probarlo en cada apertura del chat
      var cid0 = msg._own ? (msg.contactNexoId || _msgContactMap[mid] || _getCurrentContactId()) : (msg.senderNexoId || _getCurrentContactId());
      vaultSetMessageFields(cid0 || null, mid, { metaMerge: { thumbFailed: 1 } });
      return;
    }
    img.src = 'data:image/jpeg;base64,' + t.thumb;
    img.style.display = 'block';
    var cid = msg._own ? (msg.contactNexoId || _msgContactMap[mid] || _getCurrentContactId()) : (msg.senderNexoId || _getCurrentContactId());
    vaultSetMessageFields(cid || null, mid, { metaMerge: { thumb: t.thumb, pages: t.pages } });
  });
}

export function _ensureVideoThumb(msg, attachment, src, img) {
  var mid = msg.msgId || msg.messageId;
  if (!src || !mid || _thumbsInProgress[mid]) return;
  _thumbsInProgress[mid] = true;
  _makeVideoThumb(src, 320).then(function(t) {
    delete _thumbsInProgress[mid];
    if (!t) return;
    img.src = 'data:image/jpeg;base64,' + t;
    img.style.display = 'block';
    var cid = msg._own ? (msg.contactNexoId || _msgContactMap[mid] || _getCurrentContactId()) : (msg.senderNexoId || _getCurrentContactId());
    vaultSetMessageFields(cid || null, mid, { metaMerge: { thumb: t } });
  });
}
