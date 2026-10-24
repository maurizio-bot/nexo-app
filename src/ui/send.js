/**
 * NEXO — Enviar mensajes (sacado de main.js en la ronda 2752, sin cambios en su código): texto a cualquier chat,
 * adjuntos (foto, vídeo, audio, ubicación, contacto, archivo) por el mejor camino, esperar al Bluetooth tras la
 * cámara y anotar el último mensaje de cada chat.
 */
import { MAX_BLE_FILE_BYTES, _maxB64For, _tooBigMessage } from './media_limits.js';
import { _PREVIEW_BY_TYPE, _canUpgradeStatus, _cut, _getCurrentContactId, _getDomMessageStatus, _normId } from './chat_format.js';
import { _msgContactMap } from './chat_state.js';
import { _renderMessage, _updateMessageStatus, _updateMessageStorageStatus } from './render.js';
import { _showPermissionError } from './ui_bits.js';
import { vaultAppendMessage, vaultSetMessageFields } from '../vault/vault_manager.js';
import { bigToGroup } from './group_media.js';


/**
 * Espera robusta a que BLE esté listo tras cerrar la cámara.
 * Evita race conditions que provocaban failed prematuro.
 */
export function _waitForBLEReady(maxMs) {
  maxMs = maxMs || 8000;
  return new Promise(function(resolve) {
    var start = Date.now();
    function check() {
      var ble = window.bleInterface || (window.NEXO && window.NEXO.app && window.NEXO.app.bleInterface);
      var ready = false;
      try {
        if (ble) {
          // Criterios de "listo" (compatibles con distintas implementaciones)
          if (typeof ble.isReadyToChat === 'function') ready = ble.isReadyToChat();
          else if (ble._state === 'READY_TO_CHAT' || ble.state === 'READY_TO_CHAT') ready = true;
          else if (ble._activeChatDeviceId || ble.activeChatDeviceId) ready = true;
          else if (typeof ble.isConnected === 'function' && ble.isConnected()) ready = true;
        }
      } catch (e) {}
      if (ready || (Date.now() - start) >= maxMs) {
        resolve(ready);
        return;
      }
      setTimeout(check, 120);
    }
    check();
  });
}

// Ronda 2758: tope de un adjunto en un grupo (va una vez a cada miembro dentro del sobre, como texto largo)
var GROUP_MAX_CHARS = 1400000;
export var GROUP_MAX_BYTES = Math.floor(GROUP_MAX_CHARS * 3 / 4) - 4096; // lo que cabe en el sobre (con su JSON)

export function _sendAttachment(type, payload, meta, opts) {
  // FIX v9.9.26: meta.type llega con el MIME del archivo ('image/jpeg', 'text/plain'...) y pisaba
  // el tipo de adjunto en Object.assign({type}, meta): el receptor no sabía dibujarlo.
  // El tipo de adjunto va en meta.type y el MIME en meta.mime.
  meta = Object.assign({}, meta || {});
  if (meta.type && meta.type !== type) {
    if (!meta.mime && meta.type.indexOf('/') > 0) meta.mime = meta.type;
    meta.type = type;
  }
  // v9.9.45: opts.contactId = otro chat (reenviar): se guarda y envía allí sin dibujarlo en el abierto
  var contactId = (opts && opts.contactId) || _getCurrentContactId();
  if (!contactId) {
    console.log('[ATTACH] No hay contacto seleccionado');
    return;
  }
  var showHere = _normId(contactId) === _normId(_getCurrentContactId());
  if (!payload || (typeof payload === 'string' && payload.length === 0)) {
    console.warn('[ATTACH] Payload vacío, no se envía');
    return;
  }

  // Ronda 2758: en un grupo va dentro del sobre a cada miembro (groups.js); id 'gm…' para juntar las confirmaciones
  var gsA = window.bleInterface && window.bleInterface.groups, inGroup = !!(gsA && gsA.isGroup(contactId));
  var msgId = (inGroup ? 'gm' : 'msg') + Date.now() + Math.random().toString(36).substr(2, 5);
  _msgContactMap[msgId] = contactId;
  _noteContactMessage(contactId, type, Date.now());

  var attachmentData = {
    type: 'attachment',
    attachmentType: type,
    payload: payload,
    meta: meta || {}
  };

  var localMsg = {
    msgId: msgId,
    messageId: msgId,
    content: JSON.stringify(attachmentData),
    _own: true,
    status: 'pending',
    timestamp: Date.now(),
    attachmentType: type,
    attachmentPayload: payload,
    attachmentMeta: meta || {}
  };

  if (inGroup) {
    var gstr = JSON.stringify(attachmentData);
    if (gstr.length > GROUP_MAX_CHARS) {
      _showPermissionError('Demasiado grande para un grupo (' + (gstr.length * 3 / 4 / 1048576).toFixed(1) + ' MB). Máximo ~' + (GROUP_MAX_CHARS * 3 / 4 / 1048576).toFixed(1) + ' MB por ahora.');
      return;
    }
    if (showHere) _renderMessage(localMsg, true);
    try { if (window.vaultAppendMessage) vaultAppendMessage(contactId, localMsg); } catch (e) {}
    gsA.sendText(contactId, gstr, msgId);
    return msgId;
  }

  // Tope BLE: video/archivo/imagen grandes → failed limpio (sin romper flujo)
  if ((type === 'video' || type === 'file' || type === 'image') && typeof payload === 'string' && payload.length > _maxB64For(contactId)) {
    console.warn('[ATTACH] Payload demasiado grande para BLE:', type, payload.length);
    localMsg.status = 'failed';
    if (showHere) _renderMessage(localMsg, true);
    try {
      if (window.vaultAppendMessage) vaultAppendMessage(contactId, localMsg);
    } catch (e) {}
    _showPermissionError(_tooBigMessage(Math.floor(payload.length * 3 / 4), contactId));
    return;
  }

  // v9.9.30: el vídeo con HD se ve en el propio teléfono en calidad original (se envía la previa)
  var shownMsg = (opts && (opts.displayPayload || opts.displayUrl))
    ? Object.assign({}, localMsg, { attachmentPayload: opts.displayPayload || localMsg.attachmentPayload, attachmentDisplayUrl: opts.displayUrl || null, attachmentMeta: Object.assign({}, meta || {}, { mime: opts.displayMime || (meta && meta.mime) }), hdStatus: 'pending' })
    : localMsg;
  if (showHere) _renderMessage(shownMsg, true);
  try {
    if (window.vaultAppendMessage) vaultAppendMessage(contactId, localMsg);
  } catch (e) {}

  if ((type === 'image' || type === 'video' || type === 'file') && window.bleInterface && window.bleInterface.sendFile) {
    _sendFileFor(contactId, msgId, type, payload, meta, opts);
    return msgId;
  }

  // Ruta de mensajes de texto / location / audio (JSON)
  var payloadStr = JSON.stringify(attachmentData);
  if (window.bleInterface && window.bleInterface.sendChatMessage) {
    _updateMessageStatus(msgId, 'sending');
    _updateMessageStorageStatus(msgId, 'sending', contactId);

    window.bleInterface.sendChatMessage(contactId, payloadStr, msgId)
      .then(function() {
        var current = _getDomMessageStatus(msgId);
        if (_canUpgradeStatus(current, 'sent')) {
          _updateMessageStatus(msgId, 'sent');
          _updateMessageStorageStatus(msgId, 'sent', contactId);
        }
      })
      .catch(function(err) {
        console.warn('[ATTACH] sendChatMessage failed:', err && err.message);
        _updateMessageStatus(msgId, 'failed');
        _updateMessageStorageStatus(msgId, 'failed', contactId);
      });
  } else if (window.NEXO.app && window.NEXO.app.sendMessage) {
    window.NEXO.app.sendMessage({ content: payloadStr });
  } else {
    console.log('[ATTACH] Sistema de mensajes no disponible');
  }
}

// Ronda 2756: archivo grande (big_file.js). Se cifra a disco por trozos, luego va un mensaje normal con nombre,
// tamaño y la clave del archivo, y el archivo cifrado sigue por el mismo Wi-Fi o Wi-Fi Direct (la tarjeta enseña el %)
// Ronda 2764: en un grupo el mensaje va en el sobre del grupo (con quién lo manda, big.from: a él se le pide) y el
// archivo a cada miembro (group_media.js)
export function _sendBigFile(contactId, file, mime) {
  var bi = window.bleInterface, bigs = bi && bi.bigFiles;
  if (!bigs || !contactId) return null;
  var gs = bi.groups, inGroup = !!(gs && gs.isGroup(contactId));
  var msgId = (inGroup ? 'gm' : 'msg') + Date.now() + Math.random().toString(36).substr(2, 5);
  _msgContactMap[msgId] = contactId;
  _noteContactMessage(contactId, 'file', Date.now());
  var meta = { name: file.name, size: file.size, type: 'file', mime: mime, big: { id: msgId, size: file.size } };
  if (inGroup) meta.big.from = _normId(bi.localNexoId);
  var localMsg = { msgId: msgId, messageId: msgId, content: JSON.stringify({ type: 'attachment', attachmentType: 'file', payload: 'big', meta: meta }),
    _own: true, status: 'sending', timestamp: Date.now(), attachmentType: 'file', attachmentPayload: 'big', attachmentMeta: meta };
  if (_normId(contactId) === _normId(_getCurrentContactId())) _renderMessage(localMsg, true);
  try { vaultAppendMessage(contactId, localMsg); } catch (e) {}
  console.log('[BIG] Archivo grande ' + msgId + ': ' + Math.round(file.size / 1048576) + ' MB a ' + contactId);
  bigs.prepare(file, msgId).then(function(key) {
    meta.big.key = key;
    vaultSetMessageFields(contactId, msgId, { metaMerge: { big: meta.big } }).catch(function() {});
    var wire = JSON.stringify({ type: 'attachment', attachmentType: 'file', payload: 'big', meta: meta });
    if (inGroup) { gs.sendText(contactId, wire, msgId); return; }
    return bi.sendChatMessage(contactId, wire, msgId).then(function() {
      var current = _getDomMessageStatus(msgId);
      if (_canUpgradeStatus(current, 'sent')) { _updateMessageStatus(msgId, 'sent'); _updateMessageStorageStatus(msgId, 'sent', contactId); }
    }, function(err) { console.warn('[BIG] Mensaje de ' + msgId + ' no enviado aún: ' + (err && err.message)); });
  }).then(function() {
    if (inGroup) return bigToGroup(contactId, msgId);
    return bigs.transfer(contactId, msgId).catch(function() {}); // la tarjeta dice "Toca para reintentar"
  }).catch(function(e) {
    console.warn('[BIG] ' + msgId + ': ' + (e && e.message));
    _updateMessageStatus(msgId, 'failed'); _updateMessageStorageStatus(msgId, 'failed', contactId);
    _showPermissionError('Archivo: no se pudo preparar (' + ((e && e.message) || 'error') + ')');
  });
  return msgId;
}

// v9.9.42: envío de un adjunto ya guardado (también lo reusa el vídeo cuando falla Wi-Fi Direct)
export function _sendFileFor(contactId, msgId, type, payload, meta, opts) {
  // Marcar como sending de forma inmediata
  _updateMessageStatus(msgId, 'sending');
  _updateMessageStorageStatus(msgId, 'sending', contactId);

  window.bleInterface.sendFile(contactId, msgId, payload, Object.assign({}, meta, { type: type }))
    .then(function() {
      // Solo subir a 'sent' si aún no ha llegado un ack superior
      var current = _getDomMessageStatus(msgId);
      if (_canUpgradeStatus(current, 'sent')) {
        _updateMessageStatus(msgId, 'sent');
        _updateMessageStorageStatus(msgId, 'sent', contactId);
      }
    })
    .catch(function(err) {
      var msg = (err && err.message) ? err.message : String(err || '');
      console.warn('[ATTACH] sendFile rejected:', msg);
      // v9.9.42: Wi-Fi Direct falló y no cabe por Bluetooth: el vídeo sigue como previa + HD; un archivo
      // queda fallido con aviso (antes se quedaba "enviando" en 1 % para siempre)
      if (err && err.code === 'WD_FAILED') {
        if (opts && typeof opts.onWdFail === 'function') { opts.onWdFail(msgId); return; }
        _updateMessageStatus(msgId, 'failed');
        _updateMessageStorageStatus(msgId, 'failed', contactId);
        _showPermissionError('No se pudo enviar por Wi-Fi Direct y es demasiado grande para Bluetooth (' + (Math.floor(String(payload).length * 3 / 4) / 1048576).toFixed(1) + ' MB). Máximo ~' + (MAX_BLE_FILE_BYTES / 1048576).toFixed(1) + ' MB.');
        return;
      }

      // No marcar failed ante errores transitorios / timeouts leves
      var isTransient =
        /timeout|abort|network|disconnected|not ready|busy|interrupted|temporary|no disponible/i.test(msg) ||
        (err && (err.code === 'BLE_BUSY' || err.code === 'PEER_ABSENT' || err.code === 'NO_KEY'));

      if (isTransient) {
        // Dejar en 'sending' o 'sent' y dejar que el ackSystem / resumeOutgoingTransfers
        // se encargue. Nunca poner "!" por una interrupción leve.
        console.log('[ATTACH] Rechazo transitorio — no se marca failed');
        return;
      }

      // Error definitivo → failed
      _updateMessageStatus(msgId, 'failed');
      _updateMessageStorageStatus(msgId, 'failed', contactId);
    });
}

// Texto a cualquier chat (el abierto u otro). hidden: acción del chat (no se muestra ni cuenta como último)
export function _sendTextTo(cid, wire, plain, hidden) {
  var bi = window.bleInterface;
  if (!cid || !bi || typeof bi.sendChatMessage !== 'function') return null;
  var msgId = 'msg' + Date.now() + '' + Math.random().toString(36).substr(2, 9);
  var seq = typeof bi.getNextSeq === 'function' ? bi.getNextSeq() : 0;
  _msgContactMap[msgId] = cid;
  var vm = { msgId: msgId, messageId: msgId, contactNexoId: cid, content: wire, _own: true, status: 'sending', timestamp: Date.now(), seq: seq };
  if (hidden) vm.hidden = true;
  // v9.9.52: una acción (borrar para todos) no es un mensaje nuevo: sin notificación en el otro teléfono
  if (hidden) { bi._quietOut = bi._quietOut || new Set(); bi._quietOut.add(msgId); }
  if (!hidden && _normId(cid) === _normId(_getCurrentContactId())) _renderMessage(vm);
  else vaultAppendMessage(cid, vm).catch(function() {});
  if (!hidden) _noteContactMessage(cid, plain, vm.timestamp);
  bi.sendChatMessage(cid, wire, msgId, seq).then(function() {
    if (_canUpgradeStatus(_getDomMessageStatus(msgId), 'sent')) _updateMessageStatus(msgId, 'sent');
    _updateMessageStorageStatus(msgId, 'sent', cid);
  }).catch(function(err) {
    var st = (err && (err.code === 'NO_KEY' || err.code === 'PEER_ABSENT')) ? 'pending' : 'failed';
    _updateMessageStatus(msgId, st);
    _updateMessageStorageStatus(msgId, st, cid);
  });
  return msgId;
}

export function _noteContactMessage(contactId, textOrType, ts) {
  var bi = window.bleInterface || (window.NEXO && window.NEXO.app && window.NEXO.app.bleInterface);
  if (!contactId || !bi || typeof bi.noteContactMessage !== 'function') return;
  bi.noteContactMessage(contactId, _PREVIEW_BY_TYPE[textOrType] || _cut(textOrType, 50), ts);
}
