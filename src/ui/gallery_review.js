/**
 * NEXO — Revisión de lo elegido en la galería antes de mandarlo (3160, dueño 16-11: «cuando subo varias fotos, tienen el puntito
 * para palomear varias, quiero que apliques ese concepto en la esquina puesta con el "ojo", o sea que al mandar varias también
 * puedes elegir cuáles de una sola vista»). Al volver del selector del sistema (pickers.js, con `multiple`) sale una cuadrícula con
 * las miniaturas de lo elegido y, en la ESQUINA de cada FOTO, un círculo con el ojo (el mismo concepto que el puntito del selector):
 * tocarlo marca o desmarca esa foto como «ver una vez» (#94, como el 👁 de la revisión de la cámara). 3163 (dueño 16-11: «hay que
 * aplicar lo de una sola vista a vídeos también»): los VÍDEOS también llevan su ojo (además de su indicador de vídeo) y la revisión
 * sale aunque solo se elijan vídeos. «Enviar (N)» devuelve cuáles van de una vez y
 * pickers.js manda todo como siempre (mismo orden, de a una, mismos topes); la ✕ «Cancelar» o el atrás de Android (chat_nav.js,
 * por __nexoClose) cierran sin mandar nada. Las miniaturas son URL de objeto del propio archivo (no se lee ni se copia la foto
 * entera en memoria) y se liberan al cerrar. El aspecto vive en nexo_theme.css (.nx-grev…).
 */
import { t } from './i18n.js';
import { _releaseMedia } from './ui_bits.js';
import { SHEET_CLOSE_SVG } from './share_contacts.js';

var EYE_SVG = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/><circle cx="12" cy="12" r="3"/></svg>';
var PLAY_SVG = '<svg viewBox="0 0 24 24" width="14" height="14" fill="#fff" aria-hidden="true"><path d="M8 5.5v13l10.5-6.5z"/></svg>';

function _isVideo(f) { return !!f && String(f.type || '').indexOf('video') === 0; }
function _objUrl(f) { try { return URL.createObjectURL(f); } catch (e) { return ''; } }

// files: lo elegido (ya con el tope GALLERY_MAX). opts.eyes === false: sin ojos (solo revisar y mandar). onSend(once): once[i] es
// true si la foto o el vídeo i va «ver una vez». Cancelar no llama a nada.
export function _openGalleryReview(files, opts, onSend) {
  var old = document.getElementById('nexo-gallery-review');
  if (old) { if (typeof old.__nexoClose === 'function') old.__nexoClose(); else old.remove(); }
  var eyes = !(opts && opts.eyes === false);
  var once = files.map(function() { return false; });
  var urls = [], closed = false;
  var nPhotos = files.filter(function(f) { return !_isVideo(f); }).length;
  var ov = document.createElement('div');
  ov.id = 'nexo-gallery-review';
  ov.className = 'nx-grev' + (files.length === 1 ? ' nx-grev-one' : files.length === 2 ? ' nx-grev-two' : '');
  ov.setAttribute('role', 'dialog');
  var cancelTxt = t('media_cancel', 'Cancelar');
  ov.innerHTML = '<div class="nx-page-head"><div class="nx-page-title">' + t('grev_title', 'Antes de enviar') + '</div>' +
    '<button id="nexo-grev-cancel" class="nx-round-btn" type="button" aria-label="' + cancelTxt + '" title="' + cancelTxt + '">' + SHEET_CLOSE_SVG + '</button></div>' +
    (eyes ? '<div class="nx-grev-hint">' + EYE_SVG + '<span>' + t('grev_hint', 'Toca el ojo de una foto o un vídeo para que se vea una sola vez') + '</span></div>' : '') +
    '<div class="nx-grev-grid"></div>' +
    '<div class="nx-grev-bar"><button id="nexo-grev-send" class="nx-grev-send" type="button"></button></div>';
  var grid = ov.querySelector('.nx-grev-grid');
  files.forEach(function(f, i) {
    var video = _isVideo(f), url = _objUrl(f), m;
    if (url) urls.push(url);
    var cell = document.createElement('div');
    cell.className = 'nx-grev-item' + (video ? ' is-video' : '');
    cell.dataset.i = String(i);
    if (video) {
      // Solo los metadatos (y el primer cuadro, #t=0.1): el vídeo no se carga entero
      m = document.createElement('video');
      m.muted = true; m.playsInline = true; m.preload = 'metadata';
      m.setAttribute('muted', ''); m.setAttribute('playsinline', '');
      if (url) m.src = url + '#t=0.1';
    } else {
      m = document.createElement('img');
      m.alt = ''; m.decoding = 'async';
      if (url) m.src = url;
    }
    m.className = 'nx-grev-media';
    cell.appendChild(m);
    if (video) {
      var vb = document.createElement('span');
      vb.className = 'nx-grev-vid';
      vb.setAttribute('aria-label', t('grev_video', 'Vídeo'));
      vb.innerHTML = PLAY_SVG;
      cell.appendChild(vb);
    }
    if (eyes) {
      var eye = document.createElement('button');
      eye.type = 'button';
      eye.className = 'nx-grev-eye';
      eye.title = t('view_once', 'Ver una vez');
      eye.setAttribute('aria-label', eye.title);
      eye.setAttribute('aria-pressed', 'false');
      eye.innerHTML = '<span class="nx-grev-dot">' + EYE_SVG + '</span>';
      eye.addEventListener('click', function(e) {
        e.stopPropagation();
        once[i] = !once[i];
        eye.classList.toggle('active', once[i]);
        cell.classList.toggle('is-once', once[i]);
        eye.setAttribute('aria-pressed', once[i] ? 'true' : 'false');
      });
      cell.appendChild(eye);
    }
    grid.appendChild(cell);
  });
  var sendBtn = ov.querySelector('#nexo-grev-send');
  sendBtn.textContent = t('media_send_count', 'Enviar (') + files.length + ')';
  function close() {
    if (closed) return;
    closed = true;
    _releaseMedia(ov);
    urls.forEach(function(u) { try { URL.revokeObjectURL(u); } catch (e) {} });
    urls = [];
    if (ov.parentNode) ov.remove();
  }
  ov.__nexoClose = function() { if (!closed) console.log('[ATTACH] Galería: revisión cancelada, no se manda nada'); close(); };
  ov.querySelector('#nexo-grev-cancel').addEventListener('click', function(e) { e.stopPropagation(); ov.__nexoClose(); });
  sendBtn.addEventListener('click', function(e) {
    e.stopPropagation();
    if (closed) return;
    var res = once.slice();
    close();
    console.log('[ATTACH] Galería: envío ' + files.length + ' (' + res.filter(Boolean).length + ' «ver una vez»)');
    try { onSend(res); } catch (err) { console.warn('[ATTACH] Galería: ' + (err && err.message)); }
  });
  document.body.appendChild(ov);
  console.log('[ATTACH] Galería: revisión de ' + files.length + ' (' + nPhotos + ' fotos)' + (eyes ? '' : ' sin «ver una vez»'));
  return ov;
}
