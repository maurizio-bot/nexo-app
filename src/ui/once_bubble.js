/**
 * NEXO — Burbuja «ver una vez» (#94; sacada de render.js en la 3163, que ya rozaba el tope de líneas).
 * El emisor ve «Foto/Vídeo de una vez · enviada/o» (sin previa, como en WhatsApp). El receptor ve «Toca para ver · una vez»
 * (sin miniatura); al tocarla el medio se CONSUME al instante (se borra del disco y se marca onceSeen; la vista de ahora usa la
 * copia en memoria) y la burbuja queda «Abierta»/«Abierto». No entra en el deslizar entre fotos del visor (no registra fuente ni
 * se abre con burbuja de origen) y el visor no tiene botón de guardar.
 * 3163 (dueño 16-11: «hay que aplicar lo de una sola vista a vídeos también»): también VÍDEOS. Al tocar se lee el vídeo de AHORA
 * del teléfono (si el HD ya sustituyó a la previa, el HD), se consume y se reproduce en el visor; al cerrarlo se libera su URL.
 * Un HD que llega después de abrirlo no lo revive (vaultReplaceAttachment no lo guarda; video_send.js lo descarta).
 */
import { _b64ToBlob } from './video_tools.js';
import { _openFullscreenMedia } from './file_card.js';
import { _getCurrentContactId } from './chat_format.js';
import { _objectURLRegistry } from './media_limits.js';
import { vaultConsumeOnceMessage, vaultLoadFile, vaultLoadMessages } from '../vault/vault_manager.js';
import { t } from './i18n.js';

var ROW = 'display:flex;align-items:center;gap:8px;padding:10px 12px;';
function _onceEye() {
  return '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-3px;flex-shrink:0;"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/><circle cx="12" cy="12" r="3"/></svg>';
}
// ¿Es el medio de verdad? (no los marcadores 'L' de carga perezosa, 'cita', 'ptr' ni 'big')
function _realPayload(p) { return typeof p === 'string' && p.length > 16 ? p : null; }
function _opened(contentDiv, isVideo) {
  contentDiv.innerHTML = '<div style="' + ROW + 'opacity:0.6;">' + _onceEye() + '<span style="font-style:italic;">' +
    (isVideo ? t('chat_once_opened_video', 'Abierto') : t('chat_once_opened', 'Abierta')) + '</span></div>';
}
function _videoMime(meta) {
  var m = meta && meta.mime;
  return (m && String(m).indexOf('video/') === 0) ? String(m).split(';')[0] : 'video/' + ((meta && meta.format) || 'webm');
}
// 3163: el vídeo de ahora en el teléfono (el HD si ya llegó y sustituyó a la previa); si no, el de la burbuja. null = ya no hay
// nada que ver (se abrió en otro momento o se borró): entonces NO se consume ni se abre nada.
function _onceVideoNow(cid, mid, attachment, msg) {
  var mem = _realPayload(attachment.payload) || _realPayload(msg.attachmentPayload);
  return vaultLoadMessages(cid).then(function(list) {
    var m = (list || []).find(function(x) { return (x.msgId || x.messageId) === mid; });
    if (!m) return mem;
    if (m.onceSeen) return null;
    if (m.attachmentRef) return vaultLoadFile(m.attachmentRef).then(function(b64) { return _realPayload(b64) || _realPayload(m.attachmentPayload) || mem; });
    return _realPayload(m.attachmentPayload) || mem;
  }).catch(function() { return mem; });
}

export function _renderOnceBubble(contentDiv, msg, attachment, isOwn) {
  var isVideo = attachment.type === 'video';
  var seen = !!(msg.onceSeen || (attachment.meta && attachment.meta.onceSeen));
  contentDiv.style.minWidth = '150px';
  if (isOwn) {
    contentDiv.innerHTML = '<div style="' + ROW + 'opacity:0.92;">' + _onceEye() + '<span>' +
      (isVideo ? t('chat_once_video_sent', 'Vídeo de una vez · enviado') : t('chat_once_photo_sent', 'Foto de una vez · enviada')) + '</span></div>';
    return;
  }
  if (seen) { _opened(contentDiv, isVideo); return; }
  var wrap = document.createElement('div');
  wrap.className = 'msg-once-tap';
  wrap.dataset.onceType = isVideo ? 'video' : 'image';
  wrap.style.cssText = ROW + 'cursor:pointer;color:#00d4ff;font-weight:600;';
  wrap.innerHTML = _onceEye() + '<span>' + t('chat_once_tap', 'Toca para ver · una vez') + '</span>';
  var mid = msg.msgId || msg.messageId, busy = false;
  // Consumir YA (aunque cierren la app): borra el blob y marca visto; la vista de ahora usa la copia en memoria
  var consume = function(cid) {
    try { vaultConsumeOnceMessage(cid, mid); } catch (err) {}
    msg.onceSeen = true; msg.attachmentPayload = null; attachment.payload = null;
    _opened(contentDiv, isVideo);
  };
  wrap.addEventListener('click', function(e) {
    e.stopPropagation();
    if (busy) return;
    var cid = _getCurrentContactId();
    if (!isVideo) {
      var payload = _realPayload(attachment.payload) || _realPayload(msg.attachmentPayload);
      if (!payload) return;
      var src = 'data:image/' + ((attachment.meta && attachment.meta.format) || 'jpeg') + ';base64,' + payload;
      consume(cid);
      _openFullscreenMedia(src, 'image', true);   // noSave: una foto «de una vez» se consume, no se guarda en galería
      return;
    }
    busy = true; wrap.style.opacity = '0.6';
    _onceVideoNow(cid, mid, attachment, msg).then(function(b64) {
      busy = false; wrap.style.opacity = '';
      if (!b64) { console.warn('[VIDEO] «ver una vez» ' + mid + ': ya no hay vídeo que ver'); return; }
      var url = null;
      try { url = URL.createObjectURL(_b64ToBlob(b64, _videoMime(attachment.meta))); _objectURLRegistry.push(url); } catch (vErr) { console.warn('[VIDEO] No se pudo preparar el vídeo:', vErr && vErr.message); return; }
      consume(cid);
      console.log('[VIDEO] «ver una vez» ' + mid + ': se abre y queda consumido (' + Math.round(b64.length * 3 / 4 / 1024) + ' KB)');
      // noSave: sin botón de guardar; al cerrar el visor se libera la URL (el vídeo ya no existe en el teléfono)
      _openFullscreenMedia(url, 'video', true, null, function() { try { URL.revokeObjectURL(url); } catch (rErr) {} });
    });
  });
  contentDiv.appendChild(wrap);
}
