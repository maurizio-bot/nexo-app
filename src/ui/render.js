/**
 * NEXO — Dibujar los mensajes del chat (sacado de main.js en la ronda 2752, sin cambios en su código): burbuja de cada
 * mensaje (texto, foto, vídeo, audio, ubicación, archivo, contacto), estados ✓/✓✓, historial por páginas, progreso
 * de archivos que llegan y guardar el estado de cada mensaje. Lo que usa del resto de la app se lo da main.js.
 */
import { _b64ToBlob } from './video_tools.js';
import { _buildFileCard, _ensureVideoThumb, _openFullscreenMedia } from './file_card.js';
import { _canUpgradeStatus, _getCurrentContactId, _normId } from './chat_format.js';
import { _clearMessageContainer } from './chat_nav.js';
import { _fillTextBubble, _renderedMessageIds } from './chat_actions.js';
import { _fmtTime } from './file_tools.js';
import { _msgContactMap } from './chat_state.js';
import { _objectURLRegistry } from './media_limits.js';
import { _renderContactCard } from './share_contacts.js';
import { _renderE2EBanner } from './e2e_banner.js';
import { _setHdBadge } from './video_send.js';
import { isGroupId } from './groups.js';
import { vaultAppendMessage, vaultHydrateAttachments, vaultLoadMessages, vaultUpdateMessageStatus } from '../vault/vault_manager.js';


export var _renderedMessageCount = 0;

export function _getContactStorageKey() {
  var contactId = 'default';
  try {
    if (window.NEXO.app && window.NEXO.app.activeContact) {
      contactId = window.NEXO.app.activeContact.nexoId || window.NEXO.app.activeContact.id;
    } else if (window.NEXO.app && window.NEXO.app.bleInterface && window.NEXO.app.bleInterface.activeChatDeviceId) {
      contactId = window.NEXO.app.bleInterface.activeChatDeviceId;
    }
  } catch (e) {}
  return 'nexo_messages' + contactId;
}

export function _saveMessageToStorage(msg, contactId) {
  try {
    if (!msg) return;
    var msgId = msg.msgId || msg.messageId || msg.id || ('msg' + Date.now() + '' + Math.random().toString(36).substr(2, 5));
    msg.msgId = msgId;
    msg.messageId = msgId;
    if (!contactId) {
      if (msg._own) {
        contactId = msg.contactNexoId || msg.contactId || null;
      } else {
        contactId = msg.groupId || msg.senderNexoId || msg.from || msg.sender || null;
      }
    }
    if (contactId) {
      vaultAppendMessage(contactId, msg).catch(function(e) {});
    }
  } catch (e) {
    console.warn('[MAIN] _saveMessageToStorage error:', e);
  }
}

export function _updateMessageStorageStatus(messageId, status, contactId) {
  try {
    if (!messageId || !status) return;
    if (!contactId) {
      contactId = _msgContactMap[messageId] || _getCurrentContactId();
    }
    // FIX v9.9.26: sin contacto (chat cerrado o app reiniciada) vaultUpdateMessageStatus busca el
    // mensaje en todos los contactos; antes se descartaba el 'entregado'/'leído'.
    vaultUpdateMessageStatus(contactId || null, messageId, status).catch(function(e) {});
  } catch (e) {
    console.warn('[MAIN] _updateMessageStorageStatus error:', e);
  }
}

export var HISTORY_PAGE = 60;

export var _olderMessages = [], _olderContactId = null, _loadingOlder = false, _suppressAutoScroll = false, _olderArmed = false;

// Al acercarse arriba del todo se dibujan los 60 anteriores sin que la vista salte
export function _bindOlderMessagesScroll() {
  var mc = document.getElementById('messages-container');
  if (!mc || mc._olderBound) return;
  mc._olderBound = true;
  mc.addEventListener('scroll', function() {
    // Solo cuando el usuario sube (no por el scroll inicial, con el chat aún arriba del todo)
    if (_olderArmed && mc.scrollTop < 150 && _olderMessages.length && !_loadingOlder) _loadOlderMessages();
  }, { passive: true });
}

export async function _loadOlderMessages() {
  var mc = document.getElementById('messages-container');
  var cid = _getCurrentContactId();
  if (!mc || !cid || cid !== _olderContactId) return;
  _loadingOlder = true;
  try {
    var batch = _olderMessages.splice(Math.max(0, _olderMessages.length - HISTORY_PAGE));
    batch = await vaultHydrateAttachments(batch, { preferHd: true });
    if (_getCurrentContactId() !== cid) return;
    var h0 = mc.scrollHeight, t0 = mc.scrollTop;
    _suppressAutoScroll = true;
    for (var i = batch.length - 1; i >= 0; i--) { if (isGroupId(cid)) batch[i].groupId = cid; _renderMessage(batch[i], true); }
    _suppressAutoScroll = false;
    mc.scrollTop = t0 + (mc.scrollHeight - h0);
  } catch (e) {
    _suppressAutoScroll = false;
    console.warn('[MAIN] Error cargando mensajes anteriores:', e && e.message);
  } finally { _loadingOlder = false; }
}

export async function _loadPersistedMessages() {
  try {
    _clearMessageContainer();
    var contactId = _getCurrentContactId();
    if (!contactId) return;
    // v9.9.34: solo los últimos HISTORY_PAGE mensajes; los anteriores al subir (antes se dibujaba todo
    // el historial: con cientos de mensajes abrir el chat congelaba la app y cada mensaje nuevo
    // recalculaba la maquetación de todas las burbujas)
    var all = await vaultLoadMessages(contactId);
    if (_normId(_getCurrentContactId()) !== _normId(contactId)) return;
    _olderArmed = false;
    _olderMessages = all.slice(0, Math.max(0, all.length - HISTORY_PAGE));
    _olderContactId = contactId;
    var vaultMessages = await vaultHydrateAttachments(all.slice(-HISTORY_PAGE), { preferHd: true });
    if (_normId(_getCurrentContactId()) !== _normId(contactId)) return;
    vaultMessages.forEach(function(msg) {
      var mid = msg.msgId || msg.messageId || msg.id || ('msg' + (msg.timestamp || Date.now()));
      msg.msgId = mid;
      msg.messageId = mid;
      if (isGroupId(contactId)) msg.groupId = contactId; // ronda 2758: historial de un grupo
      _renderMessage(msg, true);
    });
    _bindOlderMessagesScroll();
    _renderE2EBanner();
    // Armar la carga de anteriores cuando el chat ya está abajo (tras el scroll inicial)
    setTimeout(function() { _olderArmed = true; }, 600);
  } catch (e) {
    console.warn('[MAIN] _loadPersistedMessages error:', e);
  }
}

// v9.9.34: un solo ajuste de scroll por fotograma (leer scrollHeight recalcula la maquetación de todo
// el chat; antes se hacía una vez por mensaje dibujado)
export var _scrollPending = false;

export function _scheduleScrollToBottom() {
  if (_scrollPending) return;
  _scrollPending = true;
  requestAnimationFrame(function() {
    _scrollPending = false;
    var mc = document.getElementById('messages-container');
    if (mc) mc.scrollTop = mc.scrollHeight;
  });
}

export function _renderMessage(msg, skipSave) {
  try {
    if (!msg) return;
    var msgIdDedup = msg.msgId || msg.messageId || msg.id || '';
    if (msg.hidden) return; // v9.9.45: acciones del chat (eliminar para todos) guardadas para reenviarse
    // Ronda 2758: las copias propias de acciones y de mensajes de grupo tampoco (guardadas antes sin la marca)
    if (msg._own && typeof msg.content === 'string' && /^\{"type":"nexo_(act|grp)"/.test(msg.content)) return;
    if (msgIdDedup && _renderedMessageIds.has(msgIdDedup)) {
      if (msg.status) _updateMessageStatus(msgIdDedup, msg.status);
      return;
    }
    if (msgIdDedup) _renderedMessageIds.add(msgIdDedup);

    if (msg.type === 'ack' || msg.ackType || (msg.content && typeof msg.content === 'string' && msg.content.indexOf('"type":"ack"') !== -1)) {
      console.warn('[MAIN] ACK filtrado en renderMessage:', msg.msgId || msg.messageId || msg.id || '');
      return;
    }
    if (!msg._own) {
      var activeId = _getCurrentContactId();
      // Ronda 2758: un mensaje de grupo va al chat del grupo
      var senderId = msg.groupId || msg.senderNexoId || msg.from || msg.sender || '';
      if (activeId && senderId && _normId(activeId) !== _normId(senderId)) {
        if (!skipSave) _saveMessageToStorage(msg);
        return;
      }
      if (!activeId) {
        if (!skipSave) _saveMessageToStorage(msg);
        return;
      }
    }
    var container = document.getElementById('messages-container');
    if (!container) return;
    var msgId = msg.msgId || msg.messageId || msg.id || '';
    if (!msgId) {
      msgId = 'msg' + (msg.timestamp || Date.now()) + '' + Math.random().toString(36).substr(2, 5);
      msg.msgId = msgId;
      msg.messageId = msgId;
    }
    var existing = document.querySelector('[data-msg-id="' + msgId + '"]');
    if (existing) {
      if (msg.status) {
        _updateMessageStatus(msgId, msg.status);
        if (!skipSave) _updateMessageStorageStatus(msgId, msg.status);
      }
      return;
    }
    var attachment = null;
    if (msg.attachmentType && msg.attachmentPayload) {
      attachment = {
        type: msg.attachmentType,
        payload: msg.attachmentPayload,
        meta: msg.attachmentMeta || {}
      };
    } else if (msg.content && msg.content.indexOf('"attachmentType"') > -1) {
      try {
        var parsed = JSON.parse(msg.content);
        if (parsed && parsed.type === 'attachment' && parsed.attachmentType) {
          attachment = {
            type: parsed.attachmentType,
            payload: parsed.payload,
            meta: parsed.meta || {}
          };
        }
      } catch (e) {}
    }
    if (msg.deleted) attachment = null;
    // FIX v9.9.28: antes se descartaba un mensaje recibido si su texto era igual a uno de los 5 últimos
    // ("ok", "si", "hola"...): no se veía aunque el otro recibía ✓✓. Los duplicados reales ya se
    // filtran por id (_renderedMessageIds y data-msg-id).
    var div = document.createElement('div');
    var isOwn = !!msg._own;
    div.className = 'message ' + (isOwn ? 'own' : 'other');
    if (isOwn) div.classList.add('status-' + (msg.status || 'pending'));
    div.dataset.msgId = msgId;
    div.dataset.timestamp = msg.timestamp || Date.now();
    div.dataset.seq = (typeof msg.seq === 'number') ? msg.seq : 0;
    var contentDiv = document.createElement('div');
    contentDiv.className = 'msg-content';
    contentDiv.style.borderRadius = '12px';
    contentDiv.style.overflow = 'hidden';
    if (attachment) {
      if (attachment.type === 'image') {
        var img = document.createElement('img');
        img.src = 'data:image/' + (attachment.meta.format || 'jpeg') + ';base64,' + attachment.payload;
        img.style.maxWidth = '220px';
        img.style.maxHeight = '280px';
        img.style.display = 'block';
        img.style.cursor = 'pointer';
        img.dataset.fullscreenSrc = img.src;
        img.dataset.fullscreenType = 'image';
        img.onclick = function(e) {
          e.stopPropagation();
          _openFullscreenMedia(img.dataset.fullscreenSrc, 'image');
        };
        img.onload = function() {
          var mc = document.getElementById('messages-container');
          if (mc) mc.scrollTop = mc.scrollHeight;
        };
        contentDiv.appendChild(img);
      } else if (attachment.type === 'video') {
        // v9.9.32: la burbuja NO crea un reproductor <video> (en Android cada uno retiene un
        // decodificador de hardware y tras el primero el visor ya no podía reproducir). Muestra la
        // miniatura; el reproductor solo existe en el visor y se libera al cerrarlo.
        var videoWrapper = document.createElement('div');
        videoWrapper.className = 'video-attachment';
        videoWrapper.style.cssText = 'position:relative;width:220px;min-height:124px;max-height:280px;overflow:hidden;background:#111;cursor:pointer;';
        var vFmt = attachment.meta.format || 'webm';
        var vMime = (attachment.meta.mime && attachment.meta.mime.indexOf('video/') === 0) ? attachment.meta.mime.split(';')[0] : 'video/' + vFmt;
        var vSrc = msg.attachmentDisplayUrl || '';
        if (!vSrc) {
          try { vSrc = URL.createObjectURL(_b64ToBlob(attachment.payload, vMime)); _objectURLRegistry.push(vSrc); } catch (vErr) { console.warn('[VIDEO] No se pudo preparar el vídeo:', vErr && vErr.message); }
        }
        videoWrapper.dataset.src = vSrc;
        videoWrapper.dataset.fullscreenSrc = vSrc;
        videoWrapper.dataset.fullscreenType = 'video';
        var thumbImg = document.createElement('img');
        thumbImg.className = 'video-thumb';
        thumbImg.alt = '';
        thumbImg.style.cssText = 'width:100%;height:auto;max-height:280px;display:block;';
        if (attachment.meta.thumb) thumbImg.src = 'data:image/jpeg;base64,' + attachment.meta.thumb;
        else {
          thumbImg.style.display = 'none';
          // Sin miniatura (vídeo antiguo o previa fallida): se saca una aquí, una sola vez, y se guarda
          _ensureVideoThumb(msg, attachment, vSrc, thumbImg);
        }
        var playOverlay = document.createElement('div');
        playOverlay.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.25);pointer-events:none;';
        playOverlay.innerHTML = '<svg viewBox="0 0 24 24" width="44" height="44" fill="#fff" style="opacity:0.95;"><path d="M8 5v14l11-7z"/></svg>';
        videoWrapper.appendChild(thumbImg);
        videoWrapper.appendChild(playOverlay);
        // v9.9.30: estado del HD (propio: hdStatus; recibido: previa o HD)
        var hdText = msg._own
          ? (msg.hdStatus === 'sent' ? 'HD ✓' : (msg.hdStatus ? 'HD en espera' : ''))
          : (attachment.meta.hd ? 'HD' : (attachment.meta.preview ? 'Previa · HD en camino' : ''));
        if (hdText) {
          var hdBadge = document.createElement('span');
          hdBadge.className = 'hd-badge';
          hdBadge.style.cssText = 'position:absolute;top:6px;left:6px;padding:2px 6px;border-radius:8px;background:rgba(0,0,0,0.6);color:#fff;font-size:11px;pointer-events:none;';
          hdBadge.textContent = hdText;
          videoWrapper.appendChild(hdBadge);
        }
        videoWrapper.onclick = function(e) {
          e.stopPropagation();
          _openFullscreenMedia(videoWrapper.dataset.src, 'video');
        };
        contentDiv.appendChild(videoWrapper);
      } else if (attachment.type === 'file') {
        var fileMime = attachment.meta.mime || (String(attachment.meta.type || '').indexOf('/') > 0 ? attachment.meta.type : '');
        var fileType = fileMime.toLowerCase();
        var isImageFile = fileType.indexOf('image') === 0;
        var isVideoFile = fileType.indexOf('video') === 0;
        // Ronda 2756: un archivo grande (meta.big) no viene en el mensaje: siempre tarjeta
        if ((isImageFile || isVideoFile) && !attachment.meta.big) {
          var mediaWrapper = document.createElement('div');
          mediaWrapper.style.cssText = 'position:relative;max-width:220px;max-height:280px;overflow:hidden;background:#000;cursor:pointer;';
          if (isImageFile) {
            var fimg = document.createElement('img');
            fimg.src = 'data:' + fileMime + ';base64,' + attachment.payload;
            fimg.style.cssText = 'width:100%;height:auto;max-height:280px;display:block;';
            fimg.dataset.fullscreenSrc = fimg.src;
            fimg.dataset.fullscreenType = 'image';
            mediaWrapper.appendChild(fimg);
          } else {
            var fvideo = document.createElement('video');
            var fvByteChars = atob(attachment.payload);
            var fvByteNums = new Array(fvByteChars.length);
            for (var fvi = 0; fvi < fvByteChars.length; fvi++) {
              fvByteNums[fvi] = fvByteChars.charCodeAt(fvi);
            }
            var fvByteArray = new Uint8Array(fvByteNums);
            var fvBlob = new Blob([fvByteArray], { type: fileMime });
            var fvSrc = URL.createObjectURL(fvBlob);
            _objectURLRegistry.push(fvSrc);
            fvideo.src = fvSrc;
            fvideo.style.cssText = 'width:100%;height:auto;max-height:280px;display:block;';
            fvideo.playsInline = true;
            fvideo.muted = true;
            fvideo.preload = 'metadata';
            fvideo.dataset.fullscreenSrc = fvSrc;
            fvideo.dataset.fullscreenType = 'video';
            var fplayOverlay = document.createElement('div');
            fplayOverlay.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.3);pointer-events:none;';
            fplayOverlay.innerHTML = '<svg viewBox="0 0 24 24" width="40" height="40" fill="#fff" style="opacity:0.9;"><path d="M8 5v14l11-7z"/></svg>';
            mediaWrapper.appendChild(fvideo);
            mediaWrapper.appendChild(fplayOverlay);
          }
          mediaWrapper.onclick = function(e) {
            e.stopPropagation();
            var src = isImageFile ? fimg.dataset.fullscreenSrc : fvideo.dataset.fullscreenSrc;
            var type = isImageFile ? 'image' : 'video';
            _openFullscreenMedia(src, type);
          };
          contentDiv.appendChild(mediaWrapper);
        } else {
          contentDiv.appendChild(_buildFileCard(msg, attachment, fileMime));
        }
      } else if (attachment.type === 'location') {
        var loc = attachment.meta;
        // Números siempre (vienen de otro teléfono y van dentro del HTML)
        var lat = Number(loc && loc.lat) || 0;
        var lng = Number(loc && loc.lng) || 0;
        var mapsUrl = 'https://www.google.com/maps/search/?api=1&query=' + lat + ',' + lng;
        var wazeUrl = 'https://waze.com/ul?ll=' + lat + ',' + lng + '&navigate=yes';
        var osmUrl = 'https://static-maps.openstreetmap.de/staticmap.php?center=' + lat + ',' + lng + '&zoom=15&size=300x150&markers=' + lat + ',' + lng + ',red-pushpin';
        var locHtml = '<div style="border-radius:12px;overflow:hidden;background:rgba(0,0,0,0.3);max-width:260px;">';
        locHtml += '<div style="position:relative;width:100%;height:120px;background:linear-gradient(135deg,#1a1a2e,#0f3460);overflow:hidden;">';
        locHtml += '<img src="' + osmUrl + '" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block;z-index:1;" onerror="this.style.display=\'none\'">';
        locHtml += '<div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;z-index:0;">';
        locHtml += '<svg viewBox="0 0 24 24" width="32" height="32" fill="#FF3B30"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/></svg>';
        locHtml += '<span style="font-size:11px;color:#aaa;">' + lat.toFixed(4) + ', ' + lng.toFixed(4) + '</span>';
        locHtml += '</div></div>';
        locHtml += '<div style="padding:8px 12px;"> <b>Ubicacion</b><span style="font-size:12px;opacity:0.7;">' + lat.toFixed(4) + ', ' + lng.toFixed(4) + '</span></div>';
        locHtml += '<div style="display:flex;gap:8px;padding:0 12px 10px;">';
        locHtml += '<a href="' + mapsUrl + '" target="_blank" style="flex:1;text-align:center;padding:6px;background:rgba(0,130,252,0.3);border-radius:6px;color:#fff;text-decoration:none;font-size:12px;">Maps</a>';
        locHtml += '<a href="' + wazeUrl + '" target="_blank" style="flex:1;text-align:center;padding:6px;background:rgba(107,78,255,0.3);border-radius:6px;color:#fff;text-decoration:none;font-size:12px;">Waze</a>';
        locHtml += '</div></div>';
        contentDiv.innerHTML = locHtml;
      } else if (attachment.type === 'contact') {
        _renderContactCard(contentDiv, attachment.meta || {}, msg);
      } else if (attachment.type === 'audio') {
        var dur = (attachment.meta && attachment.meta.duration) ? attachment.meta.duration : 0;
        var durStr = _fmtTime(dur);
        var audioId = 'audio' + msgId;
        var fmt = (attachment.meta && attachment.meta.format) ? attachment.meta.format : 'webm';
        var mime = (attachment.meta && attachment.meta.mimeType) ? attachment.meta.mimeType : ('audio/' + fmt);
        var byteChars = atob(attachment.payload);
        var byteNums = new Array(byteChars.length);
        for (var i = 0; i < byteChars.length; i++) {
          byteNums[i] = byteChars.charCodeAt(i);
        }
        var byteArray = new Uint8Array(byteNums);
        var audioBlob = new Blob([byteArray], { type: mime });
        var audioSrc = URL.createObjectURL(audioBlob);
        _objectURLRegistry.push(audioSrc);
        var audioHtml = '<div style="display:flex;align-items:center;gap:10px;padding:8px 12px;min-width:200px;" id="' + audioId + '_wrap">';
        audioHtml += '<button id="' + audioId + '_play" style="width:36px;height:36px;border-radius:50%;background:rgba(255,255,255,0.15);border:none;color:#fff;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:14px;flex-shrink:0;">▶</button>';
        audioHtml += '<div style="flex:1;min-width:0;">';
        audioHtml += '<div id="' + audioId + '_wave" style="height:24px;display:flex;align-items:flex-end;gap:2px;opacity:0.6;">';
        for (var w = 0; w < 24; w++) {
          var h = 4 + Math.random() * 16;
          audioHtml += '<div class="wave-bar" data-idx="' + w + '" style="width:3px;height:' + h + 'px;background:#fff;border-radius:1px;flex-shrink:0;transition:height 0.15s ease;"></div>';
        }
        audioHtml += '</div>';
        audioHtml += '<div id="' + audioId + '_time" style="font-size:11px;color:#aaa;margin-top:3px;">00:00 / ' + durStr + '</div>';
        audioHtml += '</div></div>';
        contentDiv.innerHTML = audioHtml;
        setTimeout(function() {
          var btn = document.getElementById(audioId + '_play');
          var timeEl = document.getElementById(audioId + '_time');
          var waveEl = document.getElementById(audioId + '_wave');
          if (!btn) return;
          var audioEl = new Audio(audioSrc);
          var playing = false;
          var progressInterval = null;
          var animInterval = null;
          function _updateTime() {
            if (!timeEl || !audioEl) return;
            var cur = Math.floor(audioEl.currentTime || 0);
            timeEl.textContent = _fmtTime(cur) + ' / ' + durStr;
          }
          function _animateWave() {
            if (!waveEl) return;
            var bars = waveEl.querySelectorAll('.wave-bar');
            for (var b = 0; b < bars.length; b++) {
              var nh = 4 + Math.random() * 16;
              bars[b].style.height = nh + 'px';
            }
          }
          function _pausePlayback() {
            playing = false;
            btn.innerHTML = '▶';
            if (progressInterval) { clearInterval(progressInterval); progressInterval = null; }
            if (animInterval) { clearInterval(animInterval); animInterval = null; }
            if (audioEl) {
              audioEl.pause();
            }
            if (waveEl) {
              var bars = waveEl.querySelectorAll('.wave-bar');
              for (var b = 0; b < bars.length; b++) {
                bars[b].style.height = (4 + Math.random() * 8) + 'px';
              }
            }
          }
          function _stopPlayback() {
            _pausePlayback();
            if (audioEl) {
              audioEl.currentTime = 0;
            }
            _updateTime();
          }
          audioEl.onended = function() { _stopPlayback(); };
          audioEl.onerror = function(e) {
            console.log('[AUDIO] Error reproduciendo:', e);
            _stopPlayback();
            if (timeEl) timeEl.textContent = 'Error';
          };
          btn.onclick = function(e) {
            e.stopPropagation();
            if (!playing) {
              audioEl.play().then(function() {
                btn.innerHTML = '⏸';
                playing = true;
                progressInterval = setInterval(_updateTime, 500);
                animInterval = setInterval(_animateWave, 200);
              }).catch(function(err) {
                console.log('[AUDIO] Play error:', err.message);
                _stopPlayback();
              });
            } else {
              _pausePlayback();
            }
          };
        }, 0);
      }
    } else {
      _fillTextBubble(contentDiv, msg, isOwn);
    }
    // Ronda 2758: en un grupo, quién lo escribió
    if (!isOwn && isGroupId(_getCurrentContactId())) {
      var who = document.createElement('div');
      who.className = 'msg-group-sender';
      who.style.cssText = 'font-size:12px;font-weight:600;color:#00c8ff;margin:0 0 2px 4px;';
      var gs = window.bleInterface && window.bleInterface.groups;
      who.textContent = gs ? gs.memberName(msg.senderNexoId) : (msg.senderName || '');
      div.appendChild(who);
    }
    div.appendChild(contentDiv);
    var metaDiv = document.createElement('div');
    metaDiv.className = 'msg-meta';
    var timeSpan = document.createElement('span');
    timeSpan.className = 'msg-time';
    timeSpan.textContent = new Date(msg.timestamp || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    metaDiv.appendChild(timeSpan);
    if (isOwn) {
      var statusClass = 'status-pending';
      var statusIcon = '○';
      if (msg.status === 'queued') { statusClass = 'status-queued'; statusIcon = '°'; }
      else if (msg.status === 'sending') { statusClass = 'status-sending'; statusIcon = '○'; }
      else if (msg.status === 'sent') { statusClass = 'status-sent'; statusIcon = '✓'; }
      else if (msg.status === 'delivered') { statusClass = 'status-delivered'; statusIcon = '✓'; }
      else if (msg.status === 'read') { statusClass = 'status-read'; statusIcon = '✓✓'; }
      else if (msg.status === 'failed') { statusClass = 'status-failed'; statusIcon = '!'; }
      var statusSpan = document.createElement('span');
      statusSpan.className = 'msg-status ' + statusClass;
      statusSpan.dataset.msgId = msgId;
      statusSpan.textContent = statusIcon;
      metaDiv.appendChild(statusSpan);
    }
    div.appendChild(metaDiv);
    // v9.9.34: se busca la posición desde el final (un mensaje nuevo casi siempre va al final). Antes
    // se recorrían TODAS las burbujas por cada mensaje: abrir un chat de 400 mensajes = ~100.000
    // lecturas del DOM. Mismo orden: delante del primer mensaje posterior (los marcadores sin fecha se
    // ignoran).
    var msgTs = msg.timestamp || Date.now();
    var msgSeq = (typeof msg.seq === 'number') ? msg.seq : 0;
    var before = null;
    // Anterior a todo lo dibujado (cargar mensajes antiguos al subir): directamente al principio
    var firstReal = container.firstElementChild;
    while (firstReal && !(firstReal.dataset && firstReal.dataset.timestamp)) firstReal = firstReal.nextElementSibling;
    if (firstReal) {
      var fTs = parseInt(firstReal.dataset.timestamp, 10), fSeq = parseInt(firstReal.dataset.seq || '0', 10);
      if (msgTs < fTs || (msgTs === fTs && msgSeq < fSeq)) before = firstReal;
    }
    for (var child = before ? null : container.lastElementChild; child; child = child.previousElementSibling) {
      if (!child.dataset || !child.dataset.timestamp) continue;
      var childTs = parseInt(child.dataset.timestamp, 10);
      var childSeq = parseInt(child.dataset.seq || '0', 10);
      var childId = child.dataset.msgId || '';
      if (msgTs < childTs ||
          (msgTs === childTs && msgSeq < childSeq) ||
          (msgTs === childTs && msgSeq === childSeq && msgId.localeCompare(childId) < 0)) {
        before = child;
      } else break;
    }
    if (before) container.insertBefore(div, before);
    else container.appendChild(div);
    if (!_suppressAutoScroll) _scheduleScrollToBottom();
    if (!skipSave) _saveMessageToStorage(msg);
    _renderedMessageCount++;
    // v9.9.31: antes cada 50 mensajes se revocaban TODAS las URL (vídeos/archivos visibles dejaban de
    // funcionar); se liberan al salir del chat
  } catch (e) {
    console.warn('[MAIN] _renderMessage error:', e);
  }
}

export function _removeIncomingPlaceholder(fileId) {
  var ph = document.querySelector('[data-progress-id="' + fileId + '"]');
  if (ph && ph.parentNode) ph.parentNode.removeChild(ph);
}

// v9.9.27: progreso de transferencias de archivos (eventos 'nexo:ble:fileProgress' de ble_ack.js)
export var _hdProgress = {};

export function _onFileProgress(d) {
  if (!d || !d.fileId) return;
  var pct = Math.max(0, Math.min(99, d.percent || 0));
  // v9.9.30: progreso del HD dentro de la burbuja del vídeo (emisor: fileId '<msgId>_hd')
  var hdBase = d.hdFor || (/_hd$/.test(d.fileId) ? d.fileId.replace(/_hd$/, '') : null);
  if (hdBase) {
    if (d.status === 'failed') return;
    // v9.9.35: tiempo restante estimado (el HD tarda minutos por Bluetooth: que se vea que avanza)
    var pr = _hdProgress[hdBase] || (_hdProgress[hdBase] = { t0: Date.now(), p0: pct });
    var eta = '';
    if (pct - pr.p0 >= 5) {
      var left = (Date.now() - pr.t0) / (pct - pr.p0) * (100 - pct) / 1000;
      eta = left >= 90 ? ' · ~' + Math.round(left / 60) + ' min' : ' · ~' + Math.max(5, Math.round(left / 5) * 5) + ' s';
    }
    _setHdBadge(hdBase, 'HD ' + pct + '%' + eta);
    if (pct >= 99) delete _hdProgress[hdBase];
    return;
  }
  if (d.direction === 'in') {
    if (d.status === 'failed') { _removeIncomingPlaceholder(d.fileId); return; }
    var activeId = _getCurrentContactId();
    if (!activeId || !d.senderNexoId || _normId(activeId) !== _normId(d.senderNexoId)) return;
    if (_renderedMessageIds.has(d.fileId)) return;
    var container = document.getElementById('messages-container');
    if (!container) return;
    var kind = String(d.mime || '').split('/')[0];
    var label = (d.fileType === 'image' || kind === 'image') ? '📷 Recibiendo foto'
      : (d.fileType === 'video' || kind === 'video') ? '🎬 Recibiendo vídeo'
      : (d.fileType === 'audio' || d.fileType === 'voice' || kind === 'audio') ? '🎤 Recibiendo audio'
      : '📄 Recibiendo ' + (d.name || 'archivo');
    var ph = document.querySelector('[data-progress-id="' + d.fileId + '"]');
    if (!ph) {
      ph = document.createElement('div');
      ph.className = 'message other progress-placeholder';
      ph.dataset.progressId = d.fileId;
      var c = document.createElement('div');
      c.className = 'msg-content';
      ph.appendChild(c);
      container.appendChild(ph);
      requestAnimationFrame(function() { container.scrollTop = container.scrollHeight; });
    }
    ph.firstChild.textContent = label + '… ' + pct + '%';
    return;
  }
  var statusEl = document.querySelector('.msg-status[data-msg-id="' + d.fileId + '"]');
  if (!statusEl) return;
  var m = (statusEl.className || '').match(/status-(pending|queued|sending|sent)\b/);
  if (!m) return;
  statusEl.textContent = (m[1] === 'sent' ? '✓' : '○') + ' ' + pct + '%';
}

export function _updateMessageStatus(messageId, status) {
  try {
    if (!messageId || !status) return;
    var statusEl = document.querySelector('.msg-status[data-msg-id="' + messageId + '"]');
    if (!statusEl) return;
    var current = null;
    var cls = statusEl.className || '';
    var m = cls.match(/status-(pending|queued|sending|sent|delivered|read|failed)/);
    if (m) current = m[1];
    if (!_canUpgradeStatus(current, status)) {
      return;
    }
    statusEl.classList.remove('status-pending', 'status-queued', 'status-sending', 'status-sent', 'status-delivered', 'status-read', 'status-failed');
    statusEl.classList.add('status-' + status);
    if (status === 'queued') statusEl.textContent = '°';
    else if (status === 'sending') statusEl.textContent = '○';
    else if (status === 'sent') statusEl.textContent = '✓';
    else if (status === 'delivered') statusEl.textContent = '✓';
    else if (status === 'read') statusEl.textContent = '✓✓';
    else if (status === 'failed') statusEl.textContent = '!';
    var msgDiv = statusEl.closest('.message');
    if (msgDiv) {
      msgDiv.classList.remove('status-pending', 'status-queued', 'status-sending', 'status-sent', 'status-delivered', 'status-read', 'status-failed');
      msgDiv.classList.add('status-' + status);
    }
  } catch (e) {
    console.warn('[MAIN] _updateMessageStatus error:', e);
  }
}
