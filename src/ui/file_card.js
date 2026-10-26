/**
 * NEXO — Archivos en el chat (sacado de main.js en la ronda 2752, sin cambios): tarjeta de archivo (icono, tamaño,
 * miniatura de PDF), abrir el archivo, miniaturas de vídeo y PDF, y ver fotos/vídeos a pantalla completa.
 */
import { _extOf, _fileIcon, _fmtSize, _isPdf, _mimeOf, _pdfThumb } from './file_tools.js';
import { _getCurrentContactId } from './chat_format.js';
import { _makeVideoThumb } from './video_tools.js';
import { _msgContactMap } from './chat_state.js';
import { _releaseMedia, _showPermissionError } from './ui_bits.js';
import { vaultSetMessageFields } from '../vault/vault_manager.js';
import { isGroupId } from './groups.js';
import { bigToGroup } from './group_media.js';


export function _closeFullscreenMedia() {
  var ov = document.getElementById('fullscreen-media-overlay');
  if (!ov) return;
  _releaseMedia(ov);
  ov.remove();
}

export function _openFullscreenMedia(src, type) {
  _closeFullscreenMedia();
  if (!src) { console.warn('[VIDEO] Sin fuente para el visor'); return; }
  var overlay = document.createElement('div');
  overlay.id = 'fullscreen-media-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.95);z-index:5000;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:16px;';
  var closeBtn = document.createElement('button');
  closeBtn.innerHTML = '<svg viewBox="0 0 24 24" width="28" height="28" fill="#fff"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>';
  closeBtn.style.cssText = 'position:absolute;top:16px;right:16px;width:44px;height:44px;border-radius:50%;background:rgba(255,255,255,0.15);border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;z-index:5001;';
  // v9.9.31: no revocar src: es la misma URL que usa la burbuja (después no se podía volver a ver);
  // se liberan al salir del chat (_cleanupObjectURLs)
  closeBtn.onclick = function(e) { if (e) e.stopPropagation(); _closeFullscreenMedia(); };
  overlay.appendChild(closeBtn);
  if (type === 'image') {
    var img = document.createElement('img');
    img.src = src;
    img.style.cssText = 'max-width:95vw;max-height:85vh;object-fit:contain;border-radius:8px;transition:transform 0.15s ease;cursor:zoom-in;transform-origin:center center;touch-action:none;';
    // Ronda 2783 (pedido del dueño): ampliar la foto con DOS DEDOS (pellizco: se abren = acercar, se juntan = alejar) o
    // con DOBLE TOQUE (alterna normal / 2,5x). Con la foto ampliada, un dedo la arrastra para ver el resto. Un toque
    // solo no hace nada (para cerrar: fuera de la foto o la X).
    var zScale = 1, ztx = 0, zty = 0, pinch0 = 0, pinchScale0 = 1, panX0 = 0, panY0 = 0, lastTapV = 0, zMoved = false;
    var zApply = function(anim) {
      img.style.transition = anim ? 'transform 0.15s ease' : 'none';
      img.style.transform = 'translate(' + ztx + 'px,' + zty + 'px) scale(' + zScale + ')';
      img.style.cursor = zScale > 1 ? 'zoom-out' : 'zoom-in';
    };
    var zDist = function(t) { var dx = t[0].clientX - t[1].clientX, dy = t[0].clientY - t[1].clientY; return Math.sqrt(dx * dx + dy * dy); };
    var zClamp = function(v, a, b) { return Math.max(a, Math.min(b, v)); };
    img.addEventListener('touchstart', function(e) {
      var t = e.touches || [];
      zMoved = false;
      if (t.length >= 2) { pinch0 = zDist(t) || 1; pinchScale0 = zScale; }
      else if (t.length === 1) { panX0 = t[0].clientX - ztx; panY0 = t[0].clientY - zty; }
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
    overlay.appendChild(img);
  } else if (type === 'video') {
    var video = document.createElement('video');
    video.src = src;
    video.controls = true;
    video.autoplay = true;
    video.playsInline = true;
    video.style.cssText = 'max-width:95vw;max-height:85vh;border-radius:8px;background:#000;';
    video.onerror = function() { console.warn('[VIDEO] El visor no pudo reproducir: código ' + (video.error && video.error.code)); };
    overlay.appendChild(video);
  }
  overlay.addEventListener('click', function(e) {
    if (e.target === overlay) _closeFullscreenMedia();
  });
  document.body.appendChild(overlay);
}
// Para la prueba del simulador (zoom de la foto): abrir el visor sin tener que mandar una imagen por la radio
if (typeof window !== 'undefined') window.__nexoOpenMedia = _openFullscreenMedia;

export var _thumbsInProgress = {};

export function _buildFileCard(msg, attachment, mime) {
  var m = attachment.meta || {};
  var name = String(m.name || 'archivo');
  mime = _mimeOf(mime, name);
  var card = document.createElement('div');
  card.className = 'file-attachment';
  card.style.cssText = 'width:220px;max-width:100%;background:rgba(0,0,0,0.3);border-radius:10px;overflow:hidden;cursor:pointer;';
  if (_isPdf(mime, name)) {
    var img = document.createElement('img');
    img.className = 'file-thumb';
    img.alt = '';
    img.style.cssText = 'display:none;width:100%;max-height:260px;object-fit:cover;object-position:top;background:#fff;';
    if (m.thumb) { img.src = 'data:image/jpeg;base64,' + m.thumb; img.style.display = 'block'; }
    else _ensurePdfThumb(msg, attachment, img);
    card.appendChild(img);
  }
  var row = document.createElement('div');
  row.style.cssText = 'display:flex;align-items:center;gap:10px;padding:8px 12px;';
  var ic = document.createElement('div');
  ic.style.cssText = 'font-size:26px;line-height:1;';
  ic.textContent = _fileIcon(mime);
  var txt = document.createElement('div');
  txt.style.cssText = 'min-width:0;flex:1;';
  var nm = document.createElement('div');
  nm.className = 'file-name';
  nm.style.cssText = 'font-size:14px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
  nm.textContent = name;
  var sub = document.createElement('div');
  sub.className = 'file-sub';
  sub.style.cssText = 'font-size:11px;opacity:0.7;';
  var size = Number(m.size) || (attachment.payload ? Math.floor(attachment.payload.length * 3 / 4) : 0);
  var parts = [];
  if (m.pages) parts.push(m.pages + (m.pages == 1 ? ' página' : ' páginas'));
  if (size) parts.push(_fmtSize(size));
  var bigId = m.big && /^[A-Za-z0-9_-]{1,64}$/.test(String(m.big.id || '')) ? String(m.big.id) : '';
  if (bigId) { card.dataset.bigId = bigId; card.dataset.bigOwn = msg && msg._own ? '1' : ''; card.dataset.bigSize = _fmtSize(size); _bigWatch(); }
  else parts.push('Toca para abrir');
  sub.textContent = parts.join(' · ');
  txt.appendChild(nm);
  txt.appendChild(sub);
  row.appendChild(ic);
  row.appendChild(txt);
  card.appendChild(row);
  if (bigId) _bigSub(card);
  card.onclick = function(e) {
    e.stopPropagation();
    if (bigId) { _bigTap(msg, m.big, name, mime); return; }
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
  if (!s) return head + (own ? 'Toca para abrir' : 'Esperando el archivo · Toca para pedirlo');
  if (s.state === 'preparing') return head + 'Preparando ' + pct + ' %';
  var via = ({ wd: ' (Wi-Fi Direct)', lan: ' (Wi-Fi)', l2: ' (Bluetooth)' })[s.via] || '';
  if (s.state === 'sending') return head + 'Enviando ' + pct + ' %' + via;
  if (s.state === 'receiving') return head + 'Recibiendo ' + pct + ' %' + via;
  if (s.state === 'waiting') return head + 'Pedido otra vez…';
  if (s.state === 'failed') return head + (s.dir === 'out' ? 'No se pudo enviar · Toca para reintentar' : 'No llegó entero · Toca para pedirlo');
  return head + 'Toca para abrir';
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
  if (!b) { _showPermissionError('Archivo: esta versión no puede abrirlo'); return; }
  var s = b.state(id) || {};
  var own = !!(msg && msg._own);
  if (s.state === 'preparing' || s.state === 'sending' || s.state === 'receiving' || s.state === 'waiting') return;
  // Ronda 2764: en un grupo, reintentar es mandarlo a quien falte y pedirlo es pedírselo a quien lo mandó
  var inGroup = isGroupId(cid);
  if (s.state === 'failed' && s.dir === 'out') { if (inGroup) bigToGroup(cid, id); else b.transfer(cid, id).catch(function() {}); return; }
  if (!own && inGroup) cid = (msg && msg.senderNexoId) || big.from || cid;
  if (!own && s.state !== 'done') {
    if (!b.request(cid, id)) _showPermissionError('Archivo grande: hace falta estar en el mismo Wi-Fi que el contacto o con Wi-Fi Direct');
    return;
  }
  if (!big.key) { _showPermissionError('Archivo: todavía no está listo'); return; }
  if (_openingFile) return;
  _openingFile = true;
  console.log('[BIG] Abrir ' + id + ' (' + _extOf(name) + ')');
  b.open(id, big.key, name, mime).then(function(r) {
    if (r && r.opened === false) {
      if (r.reason === 'install_permission') _showPermissionError('Archivo: permite a NEXO instalar apps y vuelve a tocar la APK');
      else if (r.reason === 'missing') _showPermissionError('Archivo: ya no está en este teléfono' + (own ? '' : ' · Toca otra vez para pedirlo'));
      else _showPermissionError('Archivo: no hay ninguna app en el teléfono para abrir este tipo de archivo');
      if (r.reason === 'missing' && !own) { b.saved[id] = undefined; b._set(id, { dir: 'in', state: 'failed' }); }
    }
  }).catch(function(e) { _showPermissionError('Archivo: no se pudo abrir (' + ((e && e.message) || 'error') + ')'); })
    .then(function() { _openingFile = false; });
}

export var _openingFile = false;

export function _openAttachmentFile(b64, name, mime) {
  var pl = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.NexoBLE;
  if (!b64) { _showPermissionError('Archivo: todavía no está disponible'); return; }
  if (!pl || typeof pl.openFile !== 'function') { _showPermissionError('Archivo: esta versión no puede abrirlo'); return; }
  if (_openingFile) return;
  _openingFile = true;
  console.log('[ATTACH] Abrir archivo ' + _extOf(name) + ' (' + mime + ')');
  pl.openFile({ base64: b64, name: name, mime: mime }).then(function(r) {
    if (r && r.opened === false) {
      console.warn('[ATTACH] No abierto: ' + r.reason);
      if (r.reason === 'install_permission') _showPermissionError('Archivo: permite a NEXO instalar apps y vuelve a tocar la APK');
      else _showPermissionError('Archivo: no hay ninguna app en el teléfono para abrir este tipo de archivo');
    }
  }).catch(function(e) {
    console.warn('[ATTACH] Error abriendo archivo: ' + (e && e.message));
    _showPermissionError('Archivo: no se pudo abrir (' + ((e && e.message) || 'error') + ')');
  }).then(function() { _openingFile = false; });
}

// Receptor (o mensajes antiguos): si el PDF llegó sin miniatura, se genera aquí y se guarda
export function _ensurePdfThumb(msg, attachment, img) {
  var mid = msg.msgId || msg.messageId;
  if (!attachment.payload || !mid || _thumbsInProgress[mid]) return;
  _thumbsInProgress[mid] = true;
  _pdfThumb(attachment.payload).then(function(t) {
    delete _thumbsInProgress[mid];
    if (!t || !t.thumb) return;
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
