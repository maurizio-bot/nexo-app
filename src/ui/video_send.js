/**
 * NEXO — Enviar vídeos (sacado de main.js en la ronda 2752, sin cambios en su código): previa 240p primero y el HD
 * después (Wi-Fi Direct o Bluetooth), insignia de progreso del HD, reanudar el HD pendiente y cambiar la previa por
 * el HD cuando llega. Lo que usa del resto de la app se lo da main.js con videoSendUse().
 */
import { MAX_BLE_FILE_BYTES, WD_MAX_B64_BYTES, _objectURLRegistry, _tooBigMessage } from './media_limits.js';
import { PREVIEW_MAX_SECONDS, _b64ToBlob, _blobToB64, _makeVideoPreview, _makeVideoThumb, _videoFormat } from './video_tools.js';
import { _getCurrentContactId, _normId } from './chat_format.js';
import { _showPermissionError, _wdReach } from './ui_bits.js';
import { vaultHdFileName, vaultLoadContacts, vaultLoadFile, vaultLoadMessages, vaultReplaceAttachment, vaultSaveFile, vaultSetMessageFields } from '../vault/vault_manager.js';

// [pegamento] Lo que usa del resto de la app (main.js lo da al arrancar)
var _handleIncomingMessage, _sendAttachment, _sendFileFor, _updateMessageStatus, _updateMessageStorageStatus;
export function videoSendUse(d) { _handleIncomingMessage = d._handleIncomingMessage; _sendAttachment = d._sendAttachment; _sendFileFor = d._sendFileFor; _updateMessageStatus = d._updateMessageStatus; _updateMessageStorageStatus = d._updateMessageStorageStatus; } // [/pegamento]


export var MAX_HD_B64_BYTES = 8000000;      // original de hasta ~6 MB (en segundo plano)

export var _videoTimes = {};                // msgId -> tiempos de previa/HD (registro de diagnóstico)

export var _hdOutbox = {};                  // msgId -> { cid, mime, b64 } (emisor, en memoria)

export var _hdInFlight = {};

export function _showOwnPreparing(show) {
  var container = document.getElementById('messages-container');
  var ph = document.getElementById('video-preparing');
  if (!show) { if (ph) ph.remove(); return; }
  if (!container || ph) return;
  ph = document.createElement('div');
  ph.id = 'video-preparing';
  ph.className = 'message own progress-placeholder';
  ph.innerHTML = '<div class="msg-content">🎬 Preparando vídeo…</div>';
  container.appendChild(ph);
}

// Envía un vídeo: previa rápida + HD automático (o el original si no se puede recodificar)
export function _sendVideo(blob, meta) {
  var contactId = _getCurrentContactId();
  if (!contactId || !blob) return;
  meta = Object.assign({}, meta || {});
  var mime = (blob.type || meta.mime || 'video/webm').split(';')[0];
  _showOwnPreparing(true);
  var makePreview = (typeof window.NEXO_makeVideoPreview === 'function') ? window.NEXO_makeVideoPreview : _makeVideoPreview;
  console.log('[VIDEO] Enviar vídeo ' + Math.round(blob.size / 1024) + ' KB ' + mime + ' dur=' + (meta.duration || '?'));
  var tStart = Date.now();
  // v9.9.39: con Wi-Fi Direct el original va directo en segundos (sin previa ni HD aparte)
  // v9.9.42: si Wi-Fi Direct falla, el mismo mensaje sigue como previa + HD por Bluetooth (_videoViaBle)
  if (_wdReach(contactId) && Math.ceil(blob.size / 3) * 4 <= WD_MAX_B64_BYTES) {
    console.log('[VIDEO] Original por Wi-Fi Direct (' + Math.round(blob.size / 1024) + ' KB)');
    return Promise.all([_blobToB64(blob), _makeVideoThumb(blob, 320)]).then(function(r) {
      _showOwnPreparing(false);
      _sendAttachment('video', r[0], Object.assign({}, meta, { mime: mime, format: _videoFormat(mime), thumb: r[1] || null, wdOnly: true }), {
        onWdFail: function(msgId) { _videoViaBle(contactId, msgId, blob, meta, mime, makePreview, tStart); }
      });
    }).catch(function(e) { _showOwnPreparing(false); console.warn('[VIDEO] Error preparando vídeo:', e && e.message); });
  }
  return makePreview(blob, meta.duration).then(function(preview) {
    _showOwnPreparing(false);
    if (preview && preview.tooLong) {
      _showPermissionError('Vídeo demasiado largo para Bluetooth (' + Math.round(preview.duration) + ' s). Máximo ' + PREVIEW_MAX_SECONDS + ' s.');
      return;
    }
    if (!preview) {
      // Sin previa: se envía el original (como antes), con miniatura si se puede
      if (blob.size > MAX_BLE_FILE_BYTES) { _showPermissionError(_tooBigMessage(blob.size)); return; }
      console.log('[VIDEO] Enviando el original sin previa (' + Math.round(blob.size / 1024) + ' KB)');
      return Promise.all([_blobToB64(blob), _makeVideoThumb(blob, 320)]).then(function(r) {
        _sendAttachment('video', r[0], Object.assign({}, meta, { mime: mime, format: _videoFormat(mime), thumb: r[1] || null }));
      });
    }
    var pMime = (preview.type || 'video/webm').split(';')[0];
    // HD: el recodificado a 720p si el original era grande; si no, el original
    var hdBlob = preview.hd || blob;
    var hdMime = (hdBlob.type || mime).split(';')[0];
    var withHd = Math.ceil(hdBlob.size / 3) * 4 <= MAX_HD_B64_BYTES;
    if (!withHd) console.log('[VIDEO] Sin HD: ' + Math.round(hdBlob.size / 1024) + ' KB supera el límite');
    var thumbP = preview.thumb ? Promise.resolve(preview.thumb) : _makeVideoThumb(blob, 320);
    return Promise.all([_blobToB64(preview), withHd ? _blobToB64(hdBlob) : Promise.resolve(null), thumbP]).then(function(r) {
      preview.thumb = r[2] || null;
      // v9.9.35: la burbuja propia se pinta desde una URL del archivo (antes decodificaba el base64 del
      // original en el hilo de la interfaz: ~1 s bloqueado al enviar)
      var displayUrl = null;
      try { displayUrl = URL.createObjectURL(hdBlob); _objectURLRegistry.push(displayUrl); } catch (e) {}
      var msgId = _sendAttachment('video', r[0], Object.assign({}, meta, { mime: pMime, format: _videoFormat(pMime), preview: !!r[1], hdSize: r[1] ? hdBlob.size : 0, thumb: preview.thumb || null }),
        r[1] ? { displayUrl: displayUrl, displayMime: hdMime } : null);
      if (msgId && r[1]) {
        _videoTimes[msgId] = { t0: tStart, previewKB: Math.round(preview.size / 1024), hdKB: Math.round(hdBlob.size / 1024) };
        _registerHd(contactId, msgId, r[1], hdMime);
      }
    });
  }).catch(function(e) {
    _showOwnPreparing(false);
    console.warn('[VIDEO] Error preparando vídeo:', e && e.message);
  });
}

// v9.9.42: el original no pudo ir por Wi-Fi Direct: el mensaje ya mostrado pasa a previa + HD por Bluetooth
export function _videoViaBle(cid, msgId, blob, meta, mime, makePreview, tStart) {
  console.log('[VIDEO] Wi-Fi Direct no funcionó: previa + HD por Bluetooth');
  var fail = function(txt) {
    _updateMessageStatus(msgId, 'failed');
    _updateMessageStorageStatus(msgId, 'failed', cid);
    if (txt) _showPermissionError(txt);
  };
  makePreview(blob, meta.duration).then(function(preview) {
    if (preview && preview.tooLong) { fail('Vídeo demasiado largo para Bluetooth (' + Math.round(preview.duration) + ' s). Máximo ' + PREVIEW_MAX_SECONDS + ' s.'); return; }
    if (!preview) {
      if (blob.size > MAX_BLE_FILE_BYTES) { fail(_tooBigMessage(blob.size)); return; }
      return _blobToB64(blob).then(function(b64) {
        var m0 = Object.assign({}, meta, { mime: mime, format: _videoFormat(mime), wdOnly: false });
        _sendFileFor(cid, msgId, 'video', b64, m0);
      });
    }
    var pMime = (preview.type || 'video/webm').split(';')[0];
    var hdBlob = preview.hd || blob;
    var hdMime = (hdBlob.type || mime).split(';')[0];
    var withHd = Math.ceil(hdBlob.size / 3) * 4 <= MAX_HD_B64_BYTES;
    var thumbP = preview.thumb ? Promise.resolve(preview.thumb) : _makeVideoThumb(blob, 320);
    return Promise.all([_blobToB64(preview), withHd ? _blobToB64(hdBlob) : Promise.resolve(null), thumbP]).then(function(r) {
      var pm = Object.assign({}, meta, { mime: pMime, format: _videoFormat(pMime), preview: !!r[1], hdSize: r[1] ? hdBlob.size : 0, thumb: r[2] || null, wdOnly: false });
      return vaultReplaceAttachment(cid, msgId, r[0], pm).then(function() {
        _sendFileFor(cid, msgId, 'video', r[0], pm);
        if (r[1]) {
          _videoTimes[msgId] = { t0: tStart, previewKB: Math.round(preview.size / 1024), hdKB: Math.round(hdBlob.size / 1024) };
          _registerHd(cid, msgId, r[1], hdMime);
        }
      });
    });
  }).catch(function(e) {
    console.warn('[VIDEO] Error preparando la previa:', e && e.message);
    fail(null);
  });
}

export function _registerHd(cid, msgId, hdB64, mime) {
  var ref = vaultHdFileName(msgId);
  _hdOutbox[msgId] = { cid: cid, mime: mime, b64: hdB64 };
  vaultSaveFile(ref, hdB64);
  vaultSetMessageFields(cid, msgId, { hdRef: ref, hdStatus: 'pending', hdMime: mime });
  _setHdBadge(msgId, 'HD en espera');
}

// Emisor: manda el original cuando la previa ya llegó (o al reconectar si quedó a medias)
export function _startHd(cid, msgId) {
  var bi = window.bleInterface || (window.NEXO.app && window.NEXO.app.bleInterface);
  if (!cid || !msgId || _hdInFlight[msgId] || !bi || typeof bi.sendFile !== 'function') return;
  _hdInFlight[msgId] = true;
  var entry = _hdOutbox[msgId] || {};
  var getB64 = entry.b64 ? Promise.resolve(entry.b64) : vaultLoadFile(vaultHdFileName(msgId));
  getB64.then(function(b64) {
    if (!b64) { delete _hdInFlight[msgId]; return; }
    var mime = entry.mime || 'video/webm';
    console.log('[VIDEO] Enviando HD de ' + msgId + ' (' + Math.round(b64.length / 1024) + ' KB)');
    vaultSetMessageFields(cid, msgId, { hdStatus: 'sending' });
    if (_videoTimes[msgId]) _videoTimes[msgId].hdStart = Date.now();
    _setHdBadge(msgId, 'HD 0%');
    return bi.sendFile(cid, msgId + '_hd', b64, { type: 'video', hdFor: msgId, mime: mime, format: _videoFormat(mime), size: b64.length })
      .then(function() { _onHdSent(cid, msgId); })
      .catch(function(err) {
        delete _hdInFlight[msgId];
        console.warn('[VIDEO] HD interrumpido, se reintenta al reconectar:', err && err.message);
        vaultSetMessageFields(cid, msgId, { hdStatus: 'pending' });
        _setHdBadge(msgId, 'HD en espera');
      });
  }).catch(function() { delete _hdInFlight[msgId]; });
}

export function _onHdSent(cid, msgId) {
  var vt = _videoTimes[msgId];
  if (vt && vt.hdStart && !vt.done) {
    vt.done = true;
    var hdS = Math.max(1, Math.round((Date.now() - vt.hdStart) / 1000));
    console.log('[VIDEO] HD entregado en ' + hdS + ' s (' + vt.hdKB + ' KB, ' + Math.round(vt.hdKB * 4 / 3 / hdS * 10) / 10 + ' KB/s por radio); total ' + Math.round((Date.now() - vt.t0) / 1000) + ' s');
  }
  delete _hdInFlight[msgId];
  if (_hdOutbox[msgId]) delete _hdOutbox[msgId];
  vaultSetMessageFields(cid, msgId, { hdStatus: 'sent' });
  _setHdBadge(msgId, 'HD ✓');
}

// La previa se entregó por un reenvío (p.ej. tras reabrir la app): buscar si tiene HD pendiente
export function _resumeHdForMsg(msgId) {
  if (_hdInFlight[msgId]) return;
  var contacts = (typeof vaultLoadContacts === 'function') ? vaultLoadContacts() : [];
  (contacts || []).forEach(function(c) {
    var cid = _normId(c.nexoId || c.deviceUUID);
    if (!cid) return;
    vaultLoadMessages(cid).then(function(msgs) {
      var m = (msgs || []).find(function(x) { return x.msgId === msgId; });
      if (m && m._own && m.hdRef && m.hdStatus !== 'sent') _startHd(cid, msgId);
    }).catch(function() {});
  });
}

export function _resumeHdTransfers(cid) {
  if (!cid) return;
  vaultLoadMessages(cid).then(function(msgs) {
    (msgs || []).forEach(function(m) {
      if (m._own && m.hdRef && (m.hdStatus === 'pending' || m.hdStatus === 'sending') &&
          (m.status === 'delivered' || m.status === 'read')) _startHd(cid, m.msgId);
    });
  }).catch(function() {});
}

// Receptor: el HD sustituye a la previa del mismo mensaje
export function _applyHdUpgrade(cid, msgId, payload, meta) {
  var mime = (meta.mime || 'video/webm').split(';')[0];
  vaultReplaceAttachment(cid, msgId, payload, { mime: mime, format: _videoFormat(mime), hd: true, preview: false }).then(function(ok) {
    if (!ok) {
      // Sin la previa guardada: se guarda como vídeo normal
      _handleIncomingMessage({ msgId: msgId, messageId: msgId, attachmentType: 'video', attachmentPayload: payload,
        attachmentMeta: Object.assign({}, meta, { mime: mime, format: _videoFormat(mime), hd: true, hdFor: null }),
        senderNexoId: cid, senderName: meta.f || 'NEXO', _own: false, status: 'delivered', timestamp: meta.ts || Date.now() });
      return;
    }
    console.log('[VIDEO] HD recibido para ' + msgId);
    _swapVideoInBubble(msgId, payload, mime);
    _setHdBadge(msgId, 'HD');
  });
}

export function _swapVideoInBubble(msgId, payload, mime) {
  var bubble = document.querySelector('.message[data-msg-id="' + msgId + '"]');
  var wrap = bubble && bubble.querySelector('.video-attachment');
  if (!wrap) return;
  try {
    var src = URL.createObjectURL(_b64ToBlob(payload, mime));
    _objectURLRegistry.push(src);
    wrap.dataset.src = src;
    wrap.dataset.fullscreenSrc = src;
  } catch (e) { console.warn('[VIDEO] No se pudo poner el HD en la burbuja:', e && e.message); }
}

export function _setHdBadge(msgId, text) {
  var bubble = document.querySelector('.message[data-msg-id="' + msgId + '"]');
  var wrap = bubble && bubble.querySelector('.video-attachment');
  if (!wrap) return;
  var b = wrap.querySelector('.hd-badge');
  if (!b) {
    b = document.createElement('span');
    b.className = 'hd-badge';
    b.style.cssText = 'position:absolute;top:6px;left:6px;padding:2px 6px;border-radius:8px;background:rgba(0,0,0,0.6);color:#fff;font-size:11px;pointer-events:none;';
    wrap.appendChild(b);
  }
  b.textContent = text;
}
