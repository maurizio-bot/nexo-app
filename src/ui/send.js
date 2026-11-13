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
import { _failStatus } from './ble_helpers.js';
import { blobMailboxEligible, MAILBOX_MAX_BYTES as BLOB_MAILBOX_MAX_BYTES } from '../net/blob_mailbox.js'; // Fase C (2971): adjuntos de grupo por referencia
import { t } from './i18n.js';


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
// Fase C (2971): con internet propio, una foto/vídeo/archivo al grupo se sube UNA vez al buzón de archivos (hasta 5 MB) y cada
// miembro recibe un puntero dentro del sobre; por debajo de este tamaño sigue yendo dentro del sobre (más barato que los relés).
var GROUP_BLOB_MIN_CHARS = 60000;
export function _groupBlobCap() {
  var bi = window.bleInterface, ack = bi && bi.ackSystem, net = bi && bi.net;
  if (!ack || typeof ack.stageBlobFor !== 'function' || !net || typeof net.online !== 'function' || !net.online() || (typeof net.gwOnly === 'function' && net.gwOnly()) || window.NEXO_BLOB_MAILBOX === false) return 0;
  return BLOB_MAILBOX_MAX_BYTES;
}

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
    var viaBlob = (type === 'image' || type === 'video' || type === 'file') && _groupBlobCap() > 0 && (gstr.length > GROUP_BLOB_MIN_CHARS || !!(meta && meta.blobPtr)) && blobMailboxEligible(payload, meta);
    if (!viaBlob && gstr.length > GROUP_MAX_CHARS) {
      _showPermissionError(t('chat_too_big_group', 'Demasiado grande para un grupo (') + (gstr.length * 3 / 4 / 1048576).toFixed(1) + t('chat_max_mb', ' MB). Máximo ~') + (GROUP_MAX_CHARS * 3 / 4 / 1048576).toFixed(1) + t('chat_mb_for_now', ' MB por ahora.'));
      return;
    }
    if (showHere) _renderMessage(localMsg, true);
    try { if (window.vaultAppendMessage) vaultAppendMessage(contactId, localMsg); } catch (e) {}
    if (viaBlob) {
      // Fase C (2971): se cifra y sube UNA vez al buzón de archivos; cada miembro recibe dentro del sobre un puntero chiquito
      // (antes: el archivo entero dentro del sobre, una vez POR MIEMBRO, tope ~1 MB). Un adjunto con puntero vigente (reenvío)
      // va por referencia: 0 subidas. Si no hay relés, lo que cabe en el sobre va como siempre; lo demás, ✗ con aviso.
      var ackB = window.bleInterface.ackSystem, gObj = gsA.get(contactId), gMe = typeof gsA._me === 'function' ? gsA._me() : null;
      var gMembers = ((gObj && gObj.members) || []).filter(function(m) { return m !== gMe; });
      var gMeta = Object.assign({ type: type }, meta || {}); delete gMeta.to;
      ackB.stageBlobFor(msgId, payload, gMeta, gMembers).then(function(ptr) {
        try { vaultSetMessageFields(contactId, msgId, { metaMerge: { blobPtr: ptr } }).catch(function() {}); } catch (e) {}
        var wireMeta = Object.assign({}, gMeta, { ptr: 1, size: ptr.raw }); delete wireMeta.blobPtr;
        gsA.sendText(contactId, JSON.stringify({ type: 'attachment', attachmentType: type, payload: 'ptr', meta: wireMeta, ptr: ptr }), msgId);
      }).catch(function(e) {
        console.warn('[BLOB] grupo ' + msgId + ': ' + (e && e.message) + (gstr.length <= GROUP_MAX_CHARS ? ' → va dentro del sobre como siempre' : ' → no se pudo subir'));
        if (gstr.length <= GROUP_MAX_CHARS) { gsA.sendText(contactId, gstr, msgId); return; }
        _updateMessageStatus(msgId, 'failed'); _updateMessageStorageStatus(msgId, 'failed', contactId);
        _showPermissionError(t('chat_group_blob_fail', 'No se pudo subir el archivo al grupo (sin relés): probá de nuevo con internet'));
      });
      return msgId;
    }
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

  // 3015 (dueño 12-11, diagnósticos S24 + S23): la nota de voz también va como ARCHIVO (binario, trozos grandes, Wi-Fi/Wi-Fi Direct
  // si se puede). Como texto troceado una de 22 s eran 1761 trozos de 360 letras: minutos por Bluetooth, tapaba el enlace y cada
  // reintento la cifraba de nuevo y el otro tiraba lo recibido. (La ubicación y lo pequeño siguen como texto.)
  if ((type === 'image' || type === 'video' || type === 'file' || type === 'audio') && window.bleInterface && window.bleInterface.sendFile) {
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
    _showPermissionError(t('chat_file_prep_fail', 'Archivo: no se pudo preparar (') + ((e && e.message) || t('chat_error_lc', 'error')) + ')');
  });
  return msgId;
}

// v9.9.42: envío de un adjunto ya guardado (también lo reusa el vídeo cuando falla Wi-Fi Direct)
export function _sendFileFor(contactId, msgId, type, payload, meta, opts) {
  // Marcar como sending de forma inmediata
  _updateMessageStatus(msgId, 'sending');
  _updateMessageStorageStatus(msgId, 'sending', contactId);

  // 2995: avisa al que espera (reenviar un adjunto grande a varios chats, de a uno) cuando este envío termina o queda pendiente
  var _settle = function() { var f = opts && opts.onSettled; if (typeof f === 'function') { opts.onSettled = null; try { f(); } catch (e) {} } };
  // 3004: freno de bucle de arranque — un envío grande se anota antes de empezar y se borra al terminar sin morir
  var bigTry = typeof payload === 'string' && payload.length > 2000000 && typeof window.vaultBigSendBegin === 'function';
  var endTry = function() { if (bigTry && typeof window.vaultBigSendEnd === 'function') window.vaultBigSendEnd(msgId).catch(function() {}); };
  (bigTry ? window.vaultBigSendBegin(msgId).catch(function() {}) : Promise.resolve())
    .then(function() { return window.bleInterface.sendFile(contactId, msgId, payload, Object.assign({}, meta, { type: type })); })
    .then(function(v) { endTry(); return v; }, function(err) { endTry(); throw err; })
    .then(function() {
      _settle();
      // Solo subir a 'sent' si aún no ha llegado un ack superior
      var current = _getDomMessageStatus(msgId);
      if (_canUpgradeStatus(current, 'sent')) {
        _updateMessageStatus(msgId, 'sent');
        _updateMessageStorageStatus(msgId, 'sent', contactId);
      }
    })
    .catch(function(err) {
      _settle();
      var msg = (err && err.message) ? err.message : String(err || '');
      console.warn('[ATTACH] sendFile rejected:', msg);
      // v9.9.42: Wi-Fi Direct falló y no cabe por Bluetooth: el vídeo sigue como previa + HD; un archivo
      // queda fallido con aviso (antes se quedaba "enviando" en 1 % para siempre)
      if (err && err.code === 'WD_FAILED') {
        if (opts && typeof opts.onWdFail === 'function') { opts.onWdFail(msgId); return; }
        // #dueño 02-11 (diagnóstico coche): un archivo que no cabe por el camino de ahora (Wi-Fi caído → solo Bluetooth
        // MTU chico) NO se marca ✗ ni se pierde: queda PENDIENTE (⏳) y resumeOutgoingTransfers lo reenvía cuando vuelva
        // Wi-Fi/internet (el registro sigue en el vault). Antes se marcaba 'failed' con un aviso de «demasiado grande».
        console.log('[ATTACH] Archivo no cabe por el camino actual — queda pendiente (se reenvía al volver Wi-Fi/internet)');
        _updateMessageStatus(msgId, 'pending');
        _updateMessageStorageStatus(msgId, 'pending', contactId);
        return;
      }

      // No marcar failed ante errores transitorios / timeouts leves (incl. #dueño 02-11: cola BLE llena / max window
      // retries / «no cabe» → el archivo queda pendiente y lo reenvía resumeOutgoingTransfers, no se pierde)
      var isTransient =
        /timeout|abort|network|disconnected|not ready|busy|interrupted|temporary|no disponible|window retries|cola de escritura|no cabe/i.test(msg) ||
        (err && (err.code === 'BLE_BUSY' || err.code === 'PEER_ABSENT' || err.code === 'NO_KEY'));

      if (isTransient) {
        // Dejar en 'sending' o 'sent' y dejar que el ackSystem / resumeOutgoingTransfers
        // se encargue. Nunca poner "!" por una interrupción leve.
        console.log('[ATTACH] Rechazo transitorio — no se marca failed');
        // Parte 3 del puente (13-11; regla del dueño 07-11: «esperando» ⏳ pronto, no ○ clavado): «Contacto no disponible: queda
        // pendiente» (p. ej. un archivo grande sin internet propio, que no pasa por un puente) se muestra ⏳ y lo reenvían los pendientes
        if (err && err.code === 'PEER_ABSENT') { _updateMessageStatus(msgId, 'pending'); _updateMessageStorageStatus(msgId, 'pending', contactId); }
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
    var st = _failStatus(err); // ronda 2767: también con el Wi-Fi cortado (se espera a que vuelva): pendiente
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
