/**
 * src/main.js - Punto de entrada NEXO v9.9.52-NEXO
 * v9.9.52: mensajes sin leer y notificaciones del teléfono (src/ui/notify.js) por todas las vías de llegada.
 * v9.9.51: internet por relés públicos (src/net/net_link.js): la cabecera del chat dice "En línea · Internet".
 * v9.9.50: Fénix fase 2: el estado dice cuántos mensajes están protegidos; aviso al recuperarlos.
 * v9.9.49: número de seguridad también por QR (src/ui/qr_verify.js): "Mostrar mi QR" / "Escanear su QR" en el
 *   aviso de cifrado del chat; si coincide queda verificado, si no avisa de posible impostor. El aviso dice si la
 *   sesión es poscuántica (e2e_ratchet v1.1). Las tarjetas de contacto llevan ss (remitente sellado).
 * v9.9.48: Wi-Fi normal (lan.js): fotos y vídeos grandes también por la misma red; la cabecera del chat dice por
 *   dónde va el contacto (Wi-Fi / Bluetooth / Jump). Avisos nativos de archivos en el diagnóstico.
 * v9.9.47: seguridad fase 3 — Perfil → Seguridad: bloqueo opcional con huella/PIN y bloquear capturas
 *   (src/ui/app_lock.js); los archivos de NEXO se cifran en el teléfono (Kotlin, AtRestStore + Keystore).
 * v9.9.46: cámara tipo WhatsApp (VÍDEO/FOTO, disparador grande, contador, linterna, galería, revisar antes
 *          de enviar); cámara frontal en espejo y foto igual que se ve; fotos a 800 px (1600 con Wi-Fi Direct).
 * v9.9.45: chat tipo WhatsApp: mantener pulsado → Responder / Reenviar / Copiar / Eliminar para mí / para
 *          todos; deslizar una burbuja a la derecha = responder (cita tocable); reenviar a uno o varios chats.
 * v9.9.44: Protocolo Fénix (fase 1, la cuenta): estado y "Recuperar mi cuenta" en el Perfil; aviso en el teléfono
 *          de un contacto para confirmar quién pide recuperar; reinicio al recuperar.
 * v9.9.43: ubicación: aviso mientras se busca, GPS → última conocida/red → aviso claro (antes, sin señal,
 *          no pasaba nada visible); coordenadas recibidas tratadas como números.
 * v9.9.42: Wi-Fi Direct fallido: el vídeo enviado como original pasa a previa + HD por Bluetooth (el mismo
 *          mensaje); un archivo que no cabe por Bluetooth queda fallido con aviso (antes: 1 % para siempre).
 * v9.9.41: seguridad fase 2: protocolo 2 (e2e_ratchet.js) iniciado al arrancar; aviso del chat con el número de
 *          seguridad de 60 cifras y "Marcar como verificado"; las tarjetas de contacto llevan su paquete de claves.
 * v9.9.40: seguridad: clave de un contacto cambiada → aviso con huellas (anterior y nueva) y botones Aceptar /
 *          Rechazar; registros sin contenido de mensajes ni nombres de archivo (archivo de registro nuevo).
 * v9.9.39: Wi-Fi Direct: con el contacto a alcance (y con Wi-Fi Direct) el límite de archivo sube a
 *          ~22 MB y el vídeo va original sin previa; líneas [WIFI-DIRECT] en el diagnóstico.
 * v9.9.38: Jump: líneas [JUMP] en el diagnóstico; rt/rk son paquetes de protocolo.
 * v9.9.37: archivos: burbuja con miniatura (PDF), nombre como texto, tamaño y abrir al tocar (openFile);
 *          el tipo (mime) viaja al otro teléfono; el selector ya no se cierra solo a los 30 s.
 * v9.9.36: cifrado de extremo a extremo: aviso en el chat (pulsar: huellas), NO_KEY deja el mensaje
 *          pendiente, al compartir contactos va su clave pública; líneas [E2E] en el diagnóstico.
 * v9.9.34: rendimiento: inserción de burbujas desde el final (antes O(n²) al abrir un chat), un solo
 *          scroll por fotograma; "atrás" + abrir otro chat rápido ya no deja el chat nuevo sin contacto.
 * v9.9.33: Compartir contactos (botón contacto del menú de adjuntos): selección múltiple, tarjeta en
 *          el chat y, al pulsarla en el otro teléfono, se agregan y parpadean en la lista.
 * FIX v9.9.32: burbuja de vídeo con miniatura (sin reproductor: en Android cada <video> retiene un
 *             decodificador y el visor dejaba de reproducir); el visor libera su reproductor al cerrar;
 *             miniatura también sin previa (y generada al recibir si falta); previa robusta (nunca se
 *             cuelga, sin audio si el AudioContext no arranca); registro de diagnóstico en Perfil.
 * FIX v9.9.31: vídeo/archivo a un contacto ausente queda pendiente y se reenvía al reconectar (antes
 *             se perdía); el vídeo recibido se puede ver más de una vez (cerrar el visor destruía su
 *             URL, y cada 50 mensajes se destruían todas); miniatura (poster) en la burbuja del vídeo.
 * v9.9.30: Vídeo en dos pasos: previa 240p recodificada en el teléfono (llega rápido) y el original
 *          (HD) automático después, en segundo plano; sustituye a la previa en el otro teléfono.
 *          Si no se puede recodificar, se envía el original como antes.
 * FIX v9.9.29: la lista de contactos se ordena por el último mensaje (también los enviados y los
 *             archivos recibidos); window.vaultSaveContacts expuesto (los contactos no se guardaban).
 * FIX v9.9.28: no se descartan mensajes recibidos con el mismo texto que otros recientes.
 * FIX v9.9.27: Progreso visible de archivos: "○ 45%" en la burbuja propia y "Recibiendo foto… N%"
 *             en el chat del receptor mientras llega.
 * FIX v9.9.26: AckSystem se vincula de verdad (antes NEXO.app.bleInterface era null en ese punto):
 *             vuelven entregado/leído y el envío de fotos/archivos.
 *             Mensajes propios de texto se guardan en el vault (contactNexoId).
 *             Tipo de adjunto en meta.type y MIME en meta.mime (galería/archivos se dibujan bien).
 *             Límite de archivo ~2,2 MB comprobado ANTES de leerlo (leer uno enorme congelaba la app).
 * FIX v9.9.25: Eliminado el "!" prematuro en envíos de archivo/imagen/vídeo.
 *             - Espera robusta post-cámara (polling READY_TO_CHAT + timeout).
 *             - sendFile ya no marca failed ante rechazos transitorios.
 *             - Tope MAX_BLE_B64_BYTES aplicado de forma uniforme y limpia.
 *             - Protección anti-degradación de status reforzada.
 * FIX v9.9.24: Tope MAX_BLE_B64_BYTES ahora también aplica a 'image'.
 * FIX: Unificado el flujo de recepción de adjuntos con el flujo de mensajes de texto.
 *      'nexo:ble:fileComplete' ya NO construye/guarda/renderiza su propio mensaje por
 *      separado: ahora delega en _handleIncomingMessage().
 * FIX: Eliminado tapón artificial de 255 chars — chunking de ble_ack.js maneja mensajes largos automáticamente
 * FIX: Sync bidireccional en BLEInterface (aplicado en v6.0.8)
 * FIX: Limpieza de container al abrir chat nuevo / desde notificación / al cargar del vault
 * FIX: Inserción ordenada SIEMPRE incluso con skipSave=true
 * FIX: No renderizar mensajes entrantes si no hay chat abierto (evita mezcla en background)
 * FIX: attachmentData estaba undefined → ReferenceError al enviar location/audio
 * FIX: _updateMessageStorageStatus ahora resuelve contactId vía _msgContactMap
 * FIX: fileComplete resuelve remitente vía meta.fr (ble_ack)
 * FIX: Compresión de imagen antes de BLE (480px / q0.5)
 * FIX: Cámara cierra y resume BLE antes de sendFile
 * FIX v9.9.23: No degradar status delivered/read → sent (sendFile.then vs ackStatus)
 * FIX v9.9.23: Tope de tamaño BLE para video/archivo (evita pending eterno / !)
 * FIX v9.9.23: _setupFABButton no añade segundo click (ble_interface ya enlaza togglePanel)
 * FIX v9.9.23: sendFile valida payload no vacío antes de transferir
 * Base: v9.9.22-NEXO
 */
import { NEXO_CONFIG } from './core/nexo_config.js';
import './styles/critical.css';
import { NEXO_DIAG } from './core/nap.js';
import { NexoApp, DEBUG } from './app/nexo_app.js';
import { rem } from './ui/rem.js';
import { ensureBLEPermissions, getPermissionShim } from './core/NexoPermissionShim.js';
import { createAckSystem } from './ui/ble_ack.js';
import {
  initVault,
  vaultLoadContacts, vaultSaveContacts, vaultSaveContact, vaultLoadMessages, vaultSaveMessages,
  vaultAppendMessage, vaultUpdateMessageStatus, vaultGetOrCreateContact, vaultFindContactByNexoId,
  vaultCreateTransfer, vaultAppendChunk, vaultGetTransfer, vaultCompleteTransfer,
  vaultGetIncompleteTransfers, vaultGetPendingOutgoingTransfers, vaultCreateOutgoingTransfer,
  vaultSetOutgoingChunkAcked, vaultIncrementOutgoingTimeout, vaultRemoveOutgoingTransfer,
  vaultSetOutgoingStatus, vaultHydrateAttachments,
  vaultSetMessageFields, vaultReplaceAttachment, vaultSaveFile, vaultLoadFile, vaultHdFileName,
  vaultDeleteMessage, vaultBlankMessage
} from './vault/vault_manager.js';
import { initBLEInterface } from './ui/ble_interface.js';
import { initAppLock, securitySectionHtml, renderSecuritySection, lockEnabled } from './ui/app_lock.js';
import { createNotifier } from './ui/notify.js';
import { initE2E } from './vault/e2e_crypto.js';
import { ratchetInit, ratchetSafetyNumber, ratchetPeerBundle, ratchetSessionPq } from './vault/e2e_ratchet.js';
import { safetyQrPayload, checkSafetyQr, showSafetyQr, openQrScanner } from './ui/qr_verify.js';
import { PREVIEW_MAX_SIDE, PREVIEW_MAX_SECONDS, HD_DIRECT_MAX_BYTES, HD_MAX_SIDE, HD_REENCODE_BPS, _videoFormat, _blobToB64, _makeVideoPreview, _previewAudioTracks, _b64ToBlob, _makeVideoThumb } from './ui/video_tools.js';
import { _extOf, _compressImageBase64, _fmtTime, _readFileBase64, _isPdf, _MIME_BY_EXT, _mimeOf, _pdfThumb, _FILE_ICONS, _fileIcon, _fmtSize } from './ui/file_tools.js';
import { _STATUS_RANK, _statusRank, _canUpgradeStatus, _getDomMessageStatus, _normId, _getCurrentContactId, _chatKind, _plainText, _myNexoId, _contactName, _peerUnderstands, _cut, _msgSummary, _findMessage, _PREVIEW_BY_TYPE } from './ui/chat_format.js';
import { cameraUse, _cameraActiveStream, _cameraPreviewMode, _cameraPreviewRecording, _cameraPreviewMediaRecorder, _cameraPreviewVideoChunks, _cameraVideoStartTime, _cameraTimer, _cameraTorchOn, _cameraReview, _showCameraPreviewOverlay, _hideCameraPreviewOverlay, _photoTarget, _videoLimitSec, _updateCameraPreviewUI, _cameraError, _setupVideoRecorder, _startCameraPreview, _cameraStartToken, _stopCameraPreview, _flipCamera, _setCameraMode, _toggleCameraMode, _toggleTorch, _startCameraTimer, _stopCameraTimer, _capturePhoto, _handleCameraCapture, _resumeBleFromCamera, _pauseBleForCamera, _showReview, _closeReview, _retakeReview, _sendReview, _bindCameraPreviewHandlers, _handleCamera, CAMERA_HD_BPS } from './ui/camera.js';
import { _diagnosticText } from './ui/diag.js';
import { profileUse } from './ui/profile.js';
import { _wdReach, _getAttachmentPlugins, _toggleAttachMenu, _closeAttachMenu, _releaseMedia, _showPermissionError, _showInfoToast, _hideInfoToast } from './ui/ui_bits.js';
import { shareContactsUse, _contactsStyles, _handleShareContacts, _renderContactCard } from './ui/share_contacts.js';
shareContactsUse({ /* [pegamento] */ _sendAttachment: _sendAttachment });
import { locationUse, _lastLocationSent, _LOCATION_DEBOUNCE_MS, _isGettingLocation, _handleLocation, _sendLocation, _browserPosition } from './ui/location.js';
locationUse({ /* [pegamento] */ _sendAttachment: _sendAttachment });
import { voiceUse, _mediaRecorder, _audioChunks, _isRecording, _voiceStartTime, _voiceTimerInterval, _handleVoiceToggle, _updateMicIcon } from './ui/voice.js';
voiceUse({ /* [pegamento] */ _sendAttachment: _sendAttachment });
profileUse({ /* [pegamento] */ _showInfoToast: _showInfoToast });
cameraUse({ /* [pegamento] */ _wdReach: _wdReach, _waitForBLEReady: _waitForBLEReady, _sendAttachment: _sendAttachment, _closeAttachMenu: _closeAttachMenu, _releaseMedia: _releaseMedia, _handleGallery: _handleGallery, _sendVideo: _sendVideo });

try {
  NEXO_CONFIG.assert(typeof NEXO_DIAG !== 'undefined', 'NEXO_DIAG debe estar importado');
  NEXO_CONFIG.assert(typeof NexoApp !== 'undefined', 'NexoApp debe estar importado');
  NEXO_CONFIG.assert(typeof rem !== 'undefined', 'rem debe estar importado');
} catch (assertErr) {
  console.error('[MAIN] Assert de arranque fallo:', assertErr);
}

window.NEXO = {
  app: null,
  rem: null,
  diag: null,
  version: (NEXO_CONFIG && NEXO_CONFIG.VERSION) ? NEXO_CONFIG.VERSION.toString() : 'unknown',
  initialized: false
};
window.NEXO_REM = rem;
window.NEXO_DIAG = NEXO_DIAG;
window.vaultLoadContacts = vaultLoadContacts;
// v9.9.36: identidad de cifrado de extremo a extremo (se crea la primera vez)
// v9.9.41: y la del protocolo 2 (como Signal: claves que cambian con cada mensaje)
// v9.9.47 (seguridad fase 3): bloqueo con huella y capturas (Perfil → Seguridad)
initAppLock({ toast: function(t, ms) { _showInfoToast(t, ms); } });
// v9.9.52: mensajes sin leer y notificaciones (todas las vías de llegada pasan por _handleIncomingMessage)
var _notifier = createNotifier({
  ble: function() { return window.bleInterface || (window.NEXO && window.NEXO.app && window.NEXO.app.bleInterface) || null; },
  // El chat abierto según ble_interface (lo pone openChat y lo quita cualquier cierre del chat)
  currentChat: function() { var b = window.bleInterface || (window.NEXO && window.NEXO.app && window.NEXO.app.bleInterface); return b ? b._activeChatDeviceId : _getCurrentContactId(); },
  hidePreview: function() { return lockEnabled(); },
  sendRead: function(nexoId, msgId) {
    setTimeout(function() { window.dispatchEvent(new CustomEvent('nexo:ble:sendReadReceipt', { detail: { nexoId: nexoId, msgId: msgId } })); }, 400);
  }
});
initE2E().then(function() { return ratchetInit(); }).catch(function(e) { console.warn('[E2E] init:', e && e.message); });

// v9.9.48: por dónde va el contacto del chat abierto (Wi-Fi de la misma red, Bluetooth, Jump)
function _refreshLinkSubtitle() {
  var sub = document.getElementById('chat-contact-subtitle');
  var bi = window.bleInterface, cid = _getCurrentContactId();
  if (!sub || !bi || typeof bi.linkOf !== 'function' || !cid) return;
  var via = bi.linkOf(cid);
  sub.textContent = via === 'wifi' ? 'En línea · Wi-Fi' : via === 'internet' ? 'En línea · Internet' : via === 'bluetooth' ? 'En línea · Bluetooth' : via === 'jump' ? 'Por Jump' : '';
}
['nexo:ble:linkChange', 'nexo:ble:deviceDisconnected', 'nexo:ble:openChat'].forEach(function(ev) {
  window.addEventListener(ev, function() { setTimeout(_refreshLinkSubtitle, 50); });
});

window.vaultSaveContact = vaultSaveContact;
// FIX v9.9.29: ble_interface guarda los contactos con window.vaultSaveContacts; no estaba expuesto y
// el último mensaje / no leídos nunca llegaban a disco
window.vaultSaveContacts = vaultSaveContacts;
window.vaultLoadMessages = vaultLoadMessages;
window.vaultSaveMessages = vaultSaveMessages;
window.vaultAppendMessage = vaultAppendMessage;
window.vaultUpdateMessageStatus = vaultUpdateMessageStatus;
window.vaultGetOrCreateContact = vaultGetOrCreateContact;
window.vaultFindContactByNexoId = vaultFindContactByNexoId;
window.vaultCreateTransfer = vaultCreateTransfer;
window.vaultAppendChunk = vaultAppendChunk;
window.vaultGetTransfer = vaultGetTransfer;
window.vaultCompleteTransfer = vaultCompleteTransfer;
window.vaultGetIncompleteTransfers = vaultGetIncompleteTransfers;
window.vaultGetPendingOutgoingTransfers = vaultGetPendingOutgoingTransfers;
window.vaultCreateOutgoingTransfer = vaultCreateOutgoingTransfer;
window.vaultSetOutgoingChunkAcked = vaultSetOutgoingChunkAcked;
window.vaultIncrementOutgoingTimeout = vaultIncrementOutgoingTimeout;
window.vaultRemoveOutgoingTransfer = vaultRemoveOutgoingTransfer;
window.vaultSetOutgoingStatus = vaultSetOutgoingStatus;
window.vaultHydrateAttachments = vaultHydrateAttachments;

var SAFETY_TIMEOUT = setTimeout(function() {
  try {
    if (NEXO_DIAG && typeof NEXO_DIAG.isSplashVisible === 'function' && NEXO_DIAG.isSplashVisible()) {
      NEXO_DIAG.hideSplash();
      document.body.classList.add('nexo-force-ready');
    }
  } catch (e) {
    console.warn('[MAIN] Safety timeout error:', e);
  }
}, (NEXO_CONFIG && NEXO_CONFIG.TIMEOUTS && NEXO_CONFIG.TIMEOUTS.SPLASH_HIDE ? NEXO_CONFIG.TIMEOUTS.SPLASH_HIDE : 3000) + 12000);

var _objectURLRegistry = [];
var _renderedMessageCount = 0;
var _renderedMessageIds = new Set();
var _autoScan = null;
var _msgContactMap = {};

/** Tope base64 para BLE (aprox. \~250KB binario). Fotos comprimidas suelen quedar bajo esto. */
// v9.9.26: ~3 MB en base64 (~2,2 MB de archivo). A la velocidad real de BLE (unos KB/s) 8 MB eran
// más de 20 minutos y bloqueaban la app; por encima de esto no se envía.
var MAX_BLE_B64_BYTES = 3000000;
var MAX_BLE_FILE_BYTES = Math.floor(MAX_BLE_B64_BYTES * 3 / 4);
// v9.9.39: con Wi-Fi Direct (contacto a alcance que también lo tiene) el límite sube a ~22 MB
var WD_MAX_B64_BYTES = 30000000;
function _maxB64For(contactId) { return _wdReach(contactId) ? WD_MAX_B64_BYTES : MAX_BLE_B64_BYTES; }
function _tooBigMessage(bytes, contactId) {
  if (_wdReach(contactId)) return 'Archivo demasiado grande (' + (bytes / 1048576).toFixed(1) + ' MB). Máximo ~' + (WD_MAX_B64_BYTES * 3 / 4 / 1048576).toFixed(0) + ' MB.';
  var bi = window.bleInterface;
  var hint = (bi && bi.wifiDirect && bi.wifiDirect.supported()) ? ' Con Wi-Fi Direct (los dos con NEXO actualizado y cerca) se pueden enviar hasta ~22 MB.' : '';
  return 'Archivo demasiado grande para Bluetooth (' + (bytes / 1048576).toFixed(1) + ' MB). Máximo ~' + (MAX_BLE_FILE_BYTES / 1048576).toFixed(1) + ' MB.' + hint;
}





/**
 * Espera robusta a que BLE esté listo tras cerrar la cámara.
 * Evita race conditions que provocaban failed prematuro.
 */
function _waitForBLEReady(maxMs) {
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

function _sendAttachment(type, payload, meta, opts) {
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

  var msgId = 'msg' + Date.now() + Math.random().toString(36).substr(2, 5);
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

// v9.9.42: envío de un adjunto ya guardado (también lo reusa el vídeo cuando falla Wi-Fi Direct)
function _sendFileFor(contactId, msgId, type, payload, meta, opts) {
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

// ===================== v9.9.45: chat tipo WhatsApp: responder, reenviar, eliminar, copiar =====================
// Mantener pulsada una burbuja (o clic derecho) abre el menú; deslizarla a la derecha responde.
// Formato (solo con contactos 2715+, que lo entienden; a los demás va el texto solo):
//   texto con respuesta o reenviado: {"type":"nexo_txt","t":texto,"rp":{id,a,s,k},"fw":1}
//   eliminar para todos:              {"type":"nexo_act","act":"del","id":msgId}  (no se muestra)
var _replyTo = null;               // { id, a: autor (NEXO ID), s: resumen, k: tipo }
var DELETE_ALL_MS = 24 * 3600000;  // "eliminar para todos" hasta 24 h después de enviarlo


// Burbuja de texto: eliminado, reenviado, respuesta citada (todo como texto: viene de otro teléfono)
function _fillTextBubble(contentDiv, msg, isOwn) {
  if (msg.deleted) {
    contentDiv.classList.add('msg-deleted');
    contentDiv.style.fontStyle = 'italic';
    contentDiv.style.opacity = '0.7';
    contentDiv.textContent = isOwn ? '🚫 Eliminaste este mensaje' : '🚫 Se eliminó este mensaje';
    return;
  }
  var raw = msg.content || msg.text || '';
  var k = _chatKind(raw);
  if (!k || k.type !== 'nexo_txt') { contentDiv.textContent = raw; return; }
  if (k.fw) {
    var fw = document.createElement('div');
    fw.className = 'msg-forwarded';
    fw.style.cssText = 'font-size:11px;font-style:italic;opacity:0.7;margin-bottom:2px;';
    fw.textContent = '↪ Reenviado';
    contentDiv.appendChild(fw);
  }
  if (k.rp && k.rp.id) {
    var q = document.createElement('div');
    q.className = 'msg-quote';
    q.style.cssText = 'border-left:3px solid #00c8ff;background:rgba(0,0,0,0.25);border-radius:6px;padding:4px 8px;margin-bottom:4px;cursor:pointer;font-size:12px;';
    var who = document.createElement('div');
    who.style.cssText = 'color:#00c8ff;font-weight:600;';
    who.textContent = _normId(k.rp.a) === _myNexoId() ? 'Tú' : _contactName(k.rp.a);
    var what = document.createElement('div');
    what.style.cssText = 'opacity:0.8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:220px;';
    what.textContent = String(k.rp.s || '');
    q.appendChild(who); q.appendChild(what);
    q.onclick = function(e) { e.stopPropagation(); _scrollToMessage(k.rp.id); };
    contentDiv.appendChild(q);
  }
  var t = document.createElement('span');
  t.className = 'msg-text';
  t.textContent = String(k.t || '');
  contentDiv.appendChild(t);
}

function _scrollToMessage(id) {
  var el = document.querySelector('.message[data-msg-id="' + id + '"]');
  if (!el) { _showInfoToast('El mensaje citado ya no está en el chat', 2500); return; }
  try { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e) {}
  el.classList.add('msg-highlight');
  el.style.transition = 'background 0.4s';
  el.style.background = 'rgba(0,200,255,0.25)';
  setTimeout(function() { el.style.background = ''; el.classList.remove('msg-highlight'); }, 1400);
}

function _setupMessageActions() {
  var mc = document.getElementById('messages-container');
  if (!mc || mc._nexoActions) return;
  mc._nexoActions = true;
  mc.style.touchAction = 'pan-y';
  var timer = null, startX = 0, startY = 0, target = null, swiping = false, fired = false;
  var bubbleOf = function(e) {
    var m = e.target && e.target.closest ? e.target.closest('.message') : null;
    return (m && m.dataset.msgId && !m.classList.contains('progress-placeholder')) ? m : null;
  };
  mc.addEventListener('pointerdown', function(e) {
    var m = bubbleOf(e);
    if (!m) return;
    target = m; startX = e.clientX; startY = e.clientY; swiping = false; fired = false;
    clearTimeout(timer);
    timer = setTimeout(function() { fired = true; _openMsgMenu(m); }, 500);
  });
  mc.addEventListener('pointermove', function(e) {
    if (!target) return;
    var dx = e.clientX - startX, dy = e.clientY - startY;
    if (Math.abs(dx) > 10 || Math.abs(dy) > 10) clearTimeout(timer);
    // Deslizar a la derecha = responder (lejos del borde izquierdo, que es "volver")
    if (startX > 40 && dx > 12 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      swiping = true;
      target.style.transform = 'translateX(' + Math.min(dx, 80) + 'px)';
    }
  });
  var end = function(e) {
    clearTimeout(timer);
    if (!target) return;
    var t = target, dx = (typeof e.clientX === 'number' ? e.clientX : startX) - startX;
    target = null;
    if (swiping) {
      swiping = false;
      t.style.transition = 'transform 0.15s';
      t.style.transform = '';
      setTimeout(function() { t.style.transition = ''; }, 200);
      if (dx > 60) _startReply(t.dataset.msgId);
    }
  };
  mc.addEventListener('pointerup', end);
  mc.addEventListener('pointercancel', end);
  mc.addEventListener('contextmenu', function(e) {
    var m = bubbleOf(e);
    if (!m) return;
    e.preventDefault();
    if (!fired) _openMsgMenu(m);
  });
  // Tras abrir el menú con una pulsación larga no se abre además la foto o el vídeo
  mc.addEventListener('click', function(e) { if (fired) { fired = false; e.stopPropagation(); e.preventDefault(); } }, true);
}

function _openMsgMenu(div) {
  var id = div && div.dataset.msgId, cid = _getCurrentContactId();
  if (!id || !cid) return;
  _findMessage(cid, id).then(function(msg) {
    if (!msg) return;
    var old = document.getElementById('nexo-msg-menu');
    if (old) old.remove();
    var isOwn = !!msg._own, deleted = !!msg.deleted;
    var box = document.createElement('div');
    box.id = 'nexo-msg-menu';
    box.style.cssText = 'position:fixed;inset:0;z-index:6000;background:rgba(0,0,0,0.45);display:flex;align-items:flex-end;justify-content:center;';
    var sheet = document.createElement('div');
    sheet.style.cssText = 'background:#14152a;color:#fff;width:100%;max-width:480px;border-radius:16px 16px 0 0;padding:8px 0 14px;';
    var close = function() { box.remove(); div.style.background = ''; };
    var add = function(label, cls, fn, danger) {
      var b = document.createElement('button');
      b.className = 'mm-item ' + cls;
      b.textContent = label;
      b.style.cssText = 'display:block;width:100%;text-align:left;padding:14px 20px;background:none;border:none;font-size:16px;color:' + (danger ? '#ff6b6b' : '#fff') + ';';
      b.onclick = function(e) { e.stopPropagation(); close(); fn(); };
      sheet.appendChild(b);
    };
    if (!deleted) add('↩  Responder', 'mm-reply', function() { _startReply(id, msg); });
    if (!deleted) add('↪  Reenviar', 'mm-forward', function() { _openForwardSheet(msg); });
    if (!deleted && !msg.attachmentType) add('⧉  Copiar', 'mm-copy', function() { _copyText(_plainText(msg.content)); });
    add('🗑  Eliminar para mí', 'mm-del-me', function() { _deleteForMe(cid, id); }, true);
    if (isOwn && !deleted && Date.now() - (msg.timestamp || 0) < DELETE_ALL_MS && _peerUnderstands(cid)) {
      add('🗑  Eliminar para todos', 'mm-del-all', function() { _deleteForAll(cid, msg); }, true);
    }
    add('Cancelar', 'mm-cancel', function() {});
    box.onclick = function(e) { if (e.target === box) close(); };
    box.appendChild(sheet);
    div.style.background = 'rgba(0,200,255,0.12)';
    document.body.appendChild(box);
  });
}

function _startReply(id, msg) {
  var cid = _getCurrentContactId();
  if (!id || !cid) return;
  (msg ? Promise.resolve(msg) : _findMessage(cid, id)).then(function(m) {
    if (!m || m.deleted) return;
    var sum = _msgSummary(m);
    _replyTo = { id: id, a: m._own ? _myNexoId() : _normId(m.senderNexoId || cid), s: sum.s, k: sum.k };
    _renderReplyBar();
    var input = document.getElementById('message-input');
    if (input) input.focus();
  });
}
function _cancelReply() { _replyTo = null; _renderReplyBar(); }
function _renderReplyBar() {
  var old = document.getElementById('reply-bar');
  if (old) old.remove();
  if (!_replyTo) return;
  var area = document.getElementById('input-area');
  if (!area || !area.parentNode) return;
  var bar = document.createElement('div');
  bar.id = 'reply-bar';
  bar.style.cssText = 'display:flex;align-items:center;gap:8px;margin:0 10px 4px;padding:6px 10px;border-left:3px solid #00c8ff;background:rgba(255,255,255,0.08);border-radius:8px;color:#fff;font-size:13px;';
  var txt = document.createElement('div');
  txt.style.cssText = 'flex:1;min-width:0;';
  var who = document.createElement('div');
  who.style.cssText = 'color:#00c8ff;font-weight:600;';
  who.textContent = 'Respondiendo a ' + (_replyTo.a === _myNexoId() ? 'ti' : _contactName(_replyTo.a));
  var what = document.createElement('div');
  what.style.cssText = 'opacity:0.8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
  what.textContent = _replyTo.s;
  txt.appendChild(who); txt.appendChild(what);
  var x = document.createElement('button');
  x.className = 'reply-cancel';
  x.textContent = '✕';
  x.style.cssText = 'background:none;border:none;color:#fff;font-size:18px;padding:4px 8px;';
  x.onclick = _cancelReply;
  bar.appendChild(txt); bar.appendChild(x);
  area.parentNode.insertBefore(bar, area);
}

function _copyText(text) {
  var ok = function() { _showInfoToast('Copiado', 1500); };
  var fallback = function() {
    try { var ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); ok(); } catch (e) {}
  };
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(ok).catch(fallback);
  else fallback();
}

// Texto a cualquier chat (el abierto u otro). hidden: acción del chat (no se muestra ni cuenta como último)
function _sendTextTo(cid, wire, plain, hidden) {
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

function _openForwardSheet(msg) {
  var old = document.getElementById('nexo-forward-sheet');
  if (old) old.remove();
  var all = (vaultLoadContacts() || []).filter(function(c) { return c && (c.nexoId || c.deviceUUID); });
  var chosen = {};
  var box = document.createElement('div');
  box.id = 'nexo-forward-sheet';
  box.style.cssText = 'position:fixed;inset:0;z-index:6000;background:#0a0a15;color:#fff;display:flex;flex-direction:column;padding:16px;box-sizing:border-box;';
  var head = document.createElement('div');
  head.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;';
  var title = document.createElement('div');
  title.style.cssText = 'font-size:18px;font-weight:700;';
  title.textContent = 'Reenviar a…';
  var cancel = document.createElement('button');
  cancel.textContent = 'Cancelar';
  cancel.style.cssText = 'background:rgba(255,255,255,0.12);color:#fff;border:none;border-radius:16px;padding:8px 14px;';
  cancel.onclick = function() { box.remove(); };
  head.appendChild(title); head.appendChild(cancel);
  var list = document.createElement('div');
  list.style.cssText = 'flex:1;overflow-y:auto;';
  var send = document.createElement('button');
  send.className = 'fw-send';
  send.style.cssText = 'margin-top:12px;padding:12px;border:none;border-radius:12px;background:linear-gradient(135deg,#00c8ff,#a855f7);color:#fff;font-size:15px;font-weight:600;';
  var refresh = function() { var n = Object.keys(chosen).length; send.textContent = n ? 'Reenviar (' + n + ')' : 'Elige uno o más chats'; send.disabled = !n; };
  all.forEach(function(c) {
    var id = _normId(c.nexoId || c.deviceUUID);
    var row = document.createElement('label');
    row.className = 'fw-row';
    row.style.cssText = 'display:flex;align-items:center;gap:12px;padding:10px 4px;border-bottom:1px solid rgba(255,255,255,0.06);';
    var cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.onchange = function() { if (cb.checked) chosen[id] = true; else delete chosen[id]; refresh(); };
    var nm = document.createElement('span');
    nm.className = 'fw-name';
    nm.textContent = c.name || id.toUpperCase();
    row.appendChild(cb); row.appendChild(nm);
    list.appendChild(row);
  });
  send.onclick = function() {
    var ids = Object.keys(chosen);
    if (!ids.length) return;
    box.remove();
    Promise.all(ids.map(function(cid) { return _forwardTo(cid, msg); })).then(function() {
      _showInfoToast('Reenviado a ' + ids.length + (ids.length === 1 ? ' chat' : ' chats'), 2000);
    });
  };
  refresh();
  box.appendChild(head); box.appendChild(list); box.appendChild(send);
  document.body.appendChild(box);
}

async function _forwardTo(cid, msg) {
  if (msg.attachmentType) {
    var payload = msg.attachmentPayload;
    if (!payload && msg.attachmentRef) payload = await vaultLoadFile(msg.attachmentRef);
    var meta = Object.assign({}, msg.attachmentMeta || {});
    // Vídeo propio: el original (HD) si está guardado
    if (msg.attachmentType === 'video' && msg.hdRef) {
      var hd = await vaultLoadFile(msg.hdRef);
      if (hd) { payload = hd; if (msg.hdMime) { meta.mime = msg.hdMime; meta.format = _videoFormat(msg.hdMime); } }
    }
    ['preview', 'hdSize', 'hdFor', 'hd', 'wdOnly', 'fwd'].forEach(function(k) { delete meta[k]; });
    if (!payload) { _showInfoToast('No se pudo reenviar: el archivo ya no está', 2500); return; }
    console.log('[ATTACH] Reenviando ' + msg.attachmentType + ' a ' + cid);
    _sendAttachment(msg.attachmentType, payload, meta, { contactId: cid });
    return;
  }
  var text = _plainText(msg.content);
  var wire = _peerUnderstands(cid) ? JSON.stringify({ type: 'nexo_txt', t: text, fw: 1 }) : text;
  _sendTextTo(cid, wire, text);
}

// Vista previa de la lista de chats según el último mensaje que queda (lo eliminado no se ve ahí)
function _refreshChatPreview(cid) {
  return vaultLoadMessages(cid).then(function(list) {
    var last = null;
    (list || []).forEach(function(m) { if (!m.hidden && (!last || (m.timestamp || 0) >= (last.timestamp || 0))) last = m; });
    var contacts = vaultLoadContacts() || [];
    var c = contacts.find(function(x) { return _normId(x.nexoId || x.deviceUUID) === _normId(cid); });
    if (!c) return;
    c.lastMessage = !last ? '' : last.deleted ? '🚫 Mensaje eliminado' : last.attachmentType ? (_PREVIEW_BY_TYPE[last.attachmentType] || '📎 Archivo') : _cut(_plainText(last.content), 50);
    vaultSaveContacts(contacts);
    var bi = window.bleInterface;
    if (bi && typeof bi.renderContactsList === 'function') bi.renderContactsList();
  }).catch(function() {});
}

function _deleteForMe(cid, id) {
  var el = document.querySelector('.message[data-msg-id="' + id + '"]');
  if (el) el.remove();
  _renderedMessageIds.delete(id);
  if (_replyTo && _replyTo.id === id) _cancelReply();
  vaultDeleteMessage(cid, id).then(function() { return _refreshChatPreview(cid); }).catch(function() {});
  console.log('[CHAT] Mensaje eliminado para mí');
}

function _deleteForAll(cid, msg) {
  var id = msg.msgId || msg.messageId;
  _sendTextTo(cid, JSON.stringify({ type: 'nexo_act', act: 'del', id: id }), '', true);
  vaultBlankMessage(cid, id).then(function() { _rerenderBlank(id, msg); return _refreshChatPreview(cid); }).catch(function() {});
  console.log('[CHAT] Mensaje eliminado para todos');
}

function _rerenderBlank(id, msg) {
  var el = document.querySelector('.message[data-msg-id="' + id + '"]');
  if (!el) return;
  el.remove();
  _renderedMessageIds.delete(id);
  _renderMessage(Object.assign({}, msg, { deleted: true, content: '', attachmentType: null, attachmentPayload: null, attachmentRef: null, attachmentMeta: null }), true);
}

// Recibido: el contacto eliminó para todos uno de SUS mensajes
function _applyChatAction(senderId, act) {
  if (!act || act.act !== 'del' || !act.id) return;
  var cid = _normId(senderId);
  _findMessage(cid, act.id).then(function(m) {
    if (!m || m._own || m.deleted) return; // solo mensajes que escribió quien lo pide
    console.log('[CHAT] ' + cid + ' eliminó un mensaje para todos');
    return vaultBlankMessage(cid, act.id).then(function() {
      if (_normId(_getCurrentContactId()) === cid) _rerenderBlank(act.id, m);
      return _refreshChatPreview(cid);
    });
  });
}








function _closeFullscreenMedia() {
  var ov = document.getElementById('fullscreen-media-overlay');
  if (!ov) return;
  _releaseMedia(ov);
  ov.remove();
}

function _openFullscreenMedia(src, type) {
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
    img.style.cssText = 'max-width:95vw;max-height:85vh;object-fit:contain;border-radius:8px;';
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

















// v9.9.37: selector de archivos. Antes el <input> se quitaba a los 30 s aunque el usuario siguiera
// eligiendo en el selector de Android (buscar una APK en Descargas o un vídeo en la galería lleva más):
// lo elegido después no hacía nada y sin aviso. Ahora vive hasta que se elige algo (o se abre otro).
var _pendingPicker = null;
function _pickFile(accept, label, onFile) {
  if (_pendingPicker && _pendingPicker.parentNode) _pendingPicker.remove();
  var input = document.createElement('input');
  input.type = 'file';
  input.accept = accept;
  input.style.cssText = 'position:fixed;top:-1000px;left:-1000px;opacity:0;pointer-events:none;width:1px;height:1px;';
  input.onchange = function(e) {
    var file = e.target.files && e.target.files[0];
    if (_pendingPicker === input) _pendingPicker = null;
    input.remove();
    if (!file) { console.log('[ATTACH] ' + label + ': nada elegido'); return; }
    console.log('[ATTACH] ' + label + ' elegido: ' + _extOf(file.name) + ' ' + Math.round(file.size / 1024) + ' KB ' + (file.type || 'sin tipo'));
    onFile(file);
  };
  _pendingPicker = input;
  document.body.appendChild(input);
  console.log('[ATTACH] Selector abierto: ' + label);
  input.click();
}


function _readFailed(err) {
  var m = (err && (err.message || err.name)) || 'error de lectura';
  console.warn('[ATTACH] No se pudo leer el archivo: ' + m);
  _showPermissionError('Archivo: no se pudo leer (' + m + ')');
}

async function _handleGallery() {
  _closeAttachMenu();
  _hideCameraPreviewOverlay();
  _stopCameraPreview();
  await new Promise(function(r) { setTimeout(r, 150); });
  _pickFile('image/*,video/*', 'Galería', function(file) {
    var isVideo = file.type.indexOf('video') === 0;
    // v9.9.30: el vídeo no se lee entero: se recodifica una previa y el original va como HD si cabe
    if (isVideo) {
      _sendVideo(file, { name: file.name, size: file.size, mime: file.type });
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
    }).catch(_readFailed);
  });
}



function _handleFile() {
  _closeAttachMenu();
  _pickFile('*/*', 'Archivo', function(file) {
    // Comprobar antes de leer: leer un archivo enorme ya congela el WebView
    var cidF = _getCurrentContactId();
    var maxB64 = _maxB64For(cidF);
    if (file.size > Math.floor(maxB64 * 3 / 4)) {
      console.warn('[ATTACH] Archivo demasiado grande: ' + file.size);
      _showPermissionError(_tooBigMessage(file.size, cidF));
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
      return (_isPdf(mime, file.name) ? _pdfThumb(base64) : Promise.resolve(null)).then(function(t) {
        if (t && t.thumb) { meta.thumb = t.thumb; meta.pages = t.pages; }
        _sendAttachment('file', base64, meta);
        console.log('[ATTACH] Archivo:', _extOf(file.name), mime, t && t.thumb ? 'con miniatura' : '');
      });
    }).catch(_readFailed);
  });
}








function _bindAttachmentHandlers() {
  _bindCameraPreviewHandlers();
  var attachBtn = document.getElementById('attach-btn');
  var menuItems = document.querySelectorAll('.attach-menu-item');
  if (attachBtn) {
    attachBtn.addEventListener('click', function(e) {
      e.preventDefault();
      e.stopPropagation();
      _toggleAttachMenu();
    });
  }
  menuItems.forEach(function(item) {
    item.addEventListener('click', function(e) {
      e.preventDefault();
      e.stopPropagation();
      var type = item.getAttribute('data-type');
      if (type === 'camera') _handleCamera();
      else if (type === 'gallery') _handleGallery();
      else if (type === 'file') _handleFile();
      else if (type === 'location') _handleLocation();
      else if (type === 'contact') _handleShareContacts();
    });
  });
  document.addEventListener('click', function(e) {
    var menu = document.getElementById('attach-menu');
    var attachBtn = document.getElementById('attach-btn');
    if (menu && !menu.classList.contains('hidden') &&
        !menu.contains(e.target) &&
        e.target !== attachBtn &&
        !attachBtn.contains(e.target)) {
      _closeAttachMenu();
    }
  });
}

document.addEventListener('DOMContentLoaded', async function() {
  _bindAttachmentHandlers();
  try {
    console.log('[MAIN] NEXO v9.9.26-NEXO iniciando...');
    console.log('[MAIN] Vault-only mode: localStorage eliminado, persistencia nativa activa.');
    NEXO_DIAG.init();
    window.NEXO.diag = NEXO_DIAG;
    _ensureDOMStructure();
    _fixLogoPath();
    window.NEXO.rem = rem;
    rem.init();
    var permissionsGranted = false;
    try {
      var permPromise = ensureBLEPermissions();
      var permTimeout = new Promise(function(resolve, reject) {
        setTimeout(function() { reject(new Error('PERM_TIMEOUT')); }, (NEXO_CONFIG && NEXO_CONFIG.TIMEOUTS && NEXO_CONFIG.TIMEOUTS.SCAN) ? NEXO_CONFIG.TIMEOUTS.SCAN : 10000);
      });
      permissionsGranted = await Promise.race([permPromise, permTimeout]);
    } catch (permErr) {
      permissionsGranted = false;
    }
    if (permissionsGranted) {
      await initializeNexoApp();
    } else {
      NEXO_DIAG.hideSplash();
      _showPermissionOverlay();
    }
    window.addEventListener('nexo-permissions-granted', async function(e) {
      try {
        if (!window.NEXO.initialized) {
          var source = (e && e.detail && e.detail.source) ? e.detail.source : 'event';
          _hidePermissionOverlay();
          await initializeNexoApp();
        }
      } catch (eventErr) {
        console.error('[MAIN] Error en nexo-permissions-granted:', eventErr);
      }
    }, { once: true });
  } catch (error) {
    console.error('Error fatal en inicializacion:', error);
    clearTimeout(SAFETY_TIMEOUT);
    try {
      NEXO_DIAG.error('INIT_FATAL', error.message || 'unknown');
      NEXO_DIAG.hideSplash();
    } catch (diagErr) {}
    _forceHideSplash();
    _enableFallbackMode();
  }
});

function _showPermissionOverlay() {
  try {
    if (document.getElementById('nexo-perm-overlay')) return;
    var overlay = document.createElement('div');
    overlay.id = 'nexo-perm-overlay';
    overlay.innerHTML = '<div class="perm-overlay-content"> <h2>Permisos BLE Requeridos</h2> <p>NEXO necesita acceso a Bluetooth y Dispositivos Cercanos para comunicacion P2P.</p> <p class="perm-sub">Si ya los concediste en Ajustes, la app continuara automaticamente.</p> <button id="perm-btn-grant" class="perm-btn-primary">Conceder Permisos</button> <button id="perm-btn-settings" class="perm-btn-secondary">Abrir Ajustes</button> <button id="perm-btn-skip" class="perm-btn-ghost">Continuar sin BLE</button> </div>';
    document.body.appendChild(overlay);
    var style = document.createElement('style');
    style.id = 'perm-overlay-styles';
    style.textContent = '#nexo-perm-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.92); z-index: 2147483647; display: flex; align-items: center; justify-content: center; backdrop-filter: blur(8px); } .perm-overlay-content { background: #0a0a15; border: 1px solid #00d4ff; border-radius: 16px; padding: 32px; max-width: 360px; width: 90%; text-align: center; color: #fff; box-shadow: 0 0 40px rgba(0,212,255,0.15); } .perm-overlay-content h2 { margin: 0 0 12px; font-size: 20px; color: #00d4ff; } .perm-overlay-content p { margin: 0 0 8px; font-size: 14px; color: #ccc; line-height: 1.5; } .perm-sub { font-size: 12px !important; color: #888 !important; font-style: italic; } .perm-btn-primary { display: block; width: 100%; margin: 16px 0 8px; padding: 14px; background: linear-gradient(135deg,#00d4ff,#0099cc); color: #000; border: none; border-radius: 10px; font-weight: 700; font-size: 15px; cursor: pointer; } .perm-btn-secondary { display: block; width: 100%; margin: 0 0 8px; padding: 12px; background: transparent; color: #00d4ff; border: 1px solid #00d4ff; border-radius: 10px; font-weight: 600; font-size: 14px; cursor: pointer; } .perm-btn-ghost { display: block; width: 100%; margin: 0; padding: 10px; background: transparent; color: #666; border: none; font-size: 13px; cursor: pointer; } .perm-btn-primary:hover { box-shadow: 0 0 20px rgba(0,212,255,0.3); }';
    document.head.appendChild(style);
    var btnGrant = document.getElementById('perm-btn-grant');
    var btnSettings = document.getElementById('perm-btn-settings');
    var btnSkip = document.getElementById('perm-btn-skip');
    if (btnGrant) {
      btnGrant.addEventListener('click', async function() {
        try {
          var shim = getPermissionShim();
          var granted = await shim.request();
          if (granted) {
            _hidePermissionOverlay();
            await initializeNexoApp();
          }
        } catch (e) {}
      });
    }
    if (btnSettings) {
      btnSettings.addEventListener('click', function() {
        try {
          if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App && window.Capacitor.Plugins.App.openUrl) {
            window.Capacitor.Plugins.App.openUrl({ url: 'app-settings:' });
          } else {
            window.location.href = 'app-settings:';
          }
        } catch (e) {
          alert('Ve a Configuracion > Aplicaciones > NEXO > Permisos\nActiva "Dispositivos cercanos" y "Bluetooth"');
        }
      });
    }
    if (btnSkip) {
      btnSkip.addEventListener('click', async function() {
        _hidePermissionOverlay();
        await initializeNexoApp();
      });
    }
  } catch (overlayErr) {
    console.error('[MAIN] Error creando permission overlay:', overlayErr);
  }
}

function _hidePermissionOverlay() {
  try {
    var overlay = document.getElementById('nexo-perm-overlay');
    if (overlay) {
      overlay.style.opacity = '0';
      setTimeout(function() { overlay.remove(); }, 300);
    }
    var styles = document.getElementById('perm-overlay-styles');
    if (styles) styles.remove();
  } catch (e) {}
}

function _openChatFromNotification(deviceId) {
  try {
    if (!window.NEXO.app) return;
    _clearMessageContainer();
    var contact = vaultFindContactByNexoId(deviceId);
    if (!contact) {
      contact = { nexoId: deviceId, displayName: 'NEXO' };
      vaultSaveContact(contact);
    }
    if (!contact.name) contact.name = contact.displayName || 'NEXO';
    // v9.9.52: por openChat (pone a 0 los no leídos y quita la notificación)
    var obi = window.NEXO.app.bleInterface;
    if (obi && typeof obi.openChat === 'function') { obi.openChat(_normId(deviceId)).catch(function() {}); return; }
    window.NEXO.app.activeContact = contact;
    if (window.NEXO.app.bleInterface) {
      window.NEXO.app.bleInterface._activeChatDeviceId = deviceId;
    }
    window.dispatchEvent(new CustomEvent('nexo:ble:openChat', { detail: { contact: contact } }));
    document.body.classList.add('chat-view-active');
    var backBtn = document.getElementById('chat-back-btn');
    if (backBtn) backBtn.classList.add('visible');
    var nameInput = document.getElementById('chat-contact-name');
    if (nameInput) nameInput.value = contact.name || 'NEXO';
    _loadPersistedMessages();
    console.log('[MAIN] Chat abierto desde notificacion:', deviceId);
  } catch (e) {
    console.warn('[MAIN] _openChatFromNotification error:', e);
  }
}

function _handleIncomingMessage(msg) {
  try {
    if (!msg) return;
    if (msg.fromVault === true) {
      _renderMessage(msg, true);
      return;
    }
    if (msg.content && typeof msg.content === 'string') {
      var trimmed = msg.content.trim();
      if (trimmed.charAt(0) === '{') {
        try {
          var protoCheck = JSON.parse(trimmed);
          if (protoCheck.jump && typeof protoCheck.jump.ttl === 'number') {
            console.warn('[MAIN] Protocol wrapper v1 con jump descartado:', protoCheck.msgId);
            return;
          }
          if (protoCheck.type === 'chat_meta' || protoCheck.type === 'chat_chunk' ||
              protoCheck.type === 'file_meta' || protoCheck.type === 'file_chunk' ||
              protoCheck.type === 'file_resume' || protoCheck.type === 'ack' ||
              protoCheck.type === 'read_receipt' || protoCheck.type === 'ping' || protoCheck.type === 'kx' ||
              protoCheck.type === 'rt' || protoCheck.type === 'rk' || protoCheck.type === 'rq' || protoCheck.type === 'rp' ||
              /^w[qanf]$/.test(protoCheck.type || '') || /^f[poqd]$/.test(protoCheck.type || '') ||
              protoCheck.type === 'pong' ||
              protoCheck.t === 'c' || protoCheck.t === 'f' || protoCheck.t === 'n' ||
              protoCheck.t === 'a' || protoCheck.t === 'ba' || protoCheck.t === 'ss' || protoCheck.t === 'sr') {
            console.warn('[MAIN] Protocol JSON defensively dropped:', protoCheck.type || protoCheck.t);
            return;
          }
        } catch (e) {}
      }
    }
    // v9.9.45: acción del chat (eliminar para todos): se aplica, no se muestra
    var chatAct = _chatKind(msg.content);
    if (chatAct && chatAct.type === 'nexo_act') { _applyChatAction(msg.senderNexoId || msg.deviceUUID, chatAct); return; }
    var bi = window.NEXO.app && window.NEXO.app.bleInterface;
    var localUUID = (bi && bi.localNexoId) || (bi && bi.localDeviceUUID) || '';
    var senderUUID = msg.senderNexoId || msg.deviceUUID || '';
    if (senderUUID && localUUID && _normId(senderUUID) === _normId(localUUID)) {
      console.log('[MAIN] Mensaje propio ignorado');
      return;
    }
    if (msg.senderNexoId) {
      vaultGetOrCreateContact(msg.senderNexoId, msg.senderName || 'NEXO');
    }
    _renderMessage(msg);
    if (window.NEXO.app && typeof window.NEXO.app.onMessage === 'function') {
      try { window.NEXO.app.onMessage(msg); } catch (omErr) {}
    }
    // v9.9.52: no leídos, notificación y confirmación de leído (solo con el chat abierto y la app a la vista)
    var senderId = msg.senderNexoId || msg.sender || '';
    var msgId = msg.messageId || msg.msgId || '';
    if (senderId) {
      var sc = vaultFindContactByNexoId(senderId);
      _notifier.incoming({
        cid: senderId, msgId: msgId, name: (sc && (sc.name || sc.displayName)) || msg.senderName || 'NEXO',
        preview: msg.attachmentType ? (_PREVIEW_BY_TYPE[msg.attachmentType] || '📎 Archivo') : _cut(_plainText(msg.content), 80)
      });
    }
  } catch (err) {
    console.warn('[MAIN] _handleIncomingMessage error:', err && err.message);
  }
}

function _registerCriticalListeners() {
  try {
    window.addEventListener('nexo:ble:deviceConnected', function(e) {
      if (e && e.detail && e.detail.deviceId) {
        if (_autoScan) _autoScan.unregisterDevice(e.detail.deviceId);
      }
    });
    window.addEventListener('nexo:ble:peerReady', function(e) {
      try {
        if (e && e.detail && e.detail.nexoId) {
          var nx = _normId(e.detail.nexoId);
          console.log('[MAIN] peerReady:', nx);
          if (window.NEXO.app && window.NEXO.app.bleInterface) {
            window.NEXO.app.bleInterface._resendPendingMessages(nx);
          }
          // v9.9.30: vídeos HD que quedaron pendientes o a medias
          setTimeout(function() { _resumeHdTransfers(nx); }, 3000);
          _refreshLinkSubtitle();
        }
      } catch (err) {
        console.warn('[MAIN] peerReady handler error:', err.message);
      }
    });
    window.addEventListener('nexo:ble:deviceDisconnected', function(e) {
      if (e && e.detail && e.detail.deviceId) {
        var nid = e.detail.nexoId || e.detail.deviceId;
        if (_autoScan) {
          _autoScan.registerKnownDevice(e.detail.deviceId, nid);
          _autoScan.start();
        }
      }
    });
    // v9.9.34: al abrir un chat se dibuja solo la última página (ver _loadPersistedMessages)
    window.addEventListener('nexo:vault:messagesLoaded', function(e) {
      var d = (e && e.detail) || {};
      if (d.contactId && _normId(d.contactId) === _normId(_getCurrentContactId())) _loadPersistedMessages();
    });
    window.addEventListener('nexo:ble:messageReceived', function(e) {
      if (e && e.detail) {
        _handleIncomingMessage(e.detail);
      }
    });
    window.addEventListener('nexo:ble:fileComplete', function(e) {
      try {
        var d = e.detail || {};
        if (!d.fileId || !d.data) {
          console.warn('[MAIN] fileComplete ignorado: falta fileId o data', d && d.fileId, !!(d && d.data));
          return;
        }
        var meta = d.meta || {};
        if (meta.hdFor) {
          _applyHdUpgrade(meta.senderNexoId || meta.fromNexoId || meta.fr || d.senderNexoId, meta.hdFor, d.data, meta);
          return;
        }
        _removeIncomingPlaceholder(d.fileId);
        _noteContactMessage(meta.senderNexoId || meta.fromNexoId || meta.fr || d.senderNexoId, meta.type || meta.tp || 'file', Date.now());
        console.log('[MAIN] Archivo recibido via fileComplete:', d.fileId, 'type=', meta.type, 'fr=', meta.fr, 'len=', (d.data || '').length);
        var senderId = meta.senderNexoId || meta.fromNexoId || meta.fromId || meta.fr || d.senderNexoId || null;
        var recvMsg = {
          msgId: d.fileId,
          messageId: d.fileId,
          attachmentType: meta.type || meta.tp || 'file',
          attachmentPayload: d.data,
          attachmentMeta: meta,
          senderNexoId: senderId,
          senderName: meta.fromName || meta.f || 'NEXO',
          _own: false,
          status: 'delivered',
          timestamp: meta.ts || Date.now()
        };
        _handleIncomingMessage(recvMsg);
      } catch (err) {
        console.warn('[MAIN] Error en fileComplete handler:', err && err.message);
      }
    });
    window.addEventListener('nexo:ble:fileProgress', function(e) {
      try { _onFileProgress(e && e.detail); } catch (err) {}
    });
    window.addEventListener('nexo:ble:ackStatus', function(e) {
      try {
        if (e && e.detail && e.detail.msgId) {
          if (window._sentFallbackTimers && window._sentFallbackTimers[e.detail.msgId]) {
            clearTimeout(window._sentFallbackTimers[e.detail.msgId]);
            delete window._sentFallbackTimers[e.detail.msgId];
          }
          var sid = e.detail.msgId, st = e.detail.status;
          if (/_hd$/.test(sid)) {
            if (st === 'delivered' || st === 'read') { var base = sid.replace(/_hd$/, ''); _onHdSent(_msgContactMap[base] || (_hdOutbox[base] && _hdOutbox[base].cid), base); }
            return;
          }
          _updateMessageStatus(sid, st);
          _updateMessageStorageStatus(sid, st);
          if (st === 'delivered' || st === 'read') {
            if (_videoTimes[sid] && !_videoTimes[sid].previewS) {
              _videoTimes[sid].previewS = Math.round((Date.now() - _videoTimes[sid].t0) / 1000);
              console.log('[VIDEO] Previa entregada en ' + _videoTimes[sid].previewS + ' s (' + _videoTimes[sid].previewKB + ' KB)');
            }
            if (_hdOutbox[sid]) _startHd(_hdOutbox[sid].cid, sid);
            else _resumeHdForMsg(sid);
          }
        }
      } catch (err) {
        console.warn('[MAIN] Error en ackStatus handler:', err.message);
      }
    });
    console.log('[MAIN] Critical listeners registered early');
  } catch (err) {
    console.warn('[MAIN] _registerCriticalListeners error:', err);
  }
}

async function initializeNexoApp() {
  try {
    await initVault();
    NEXO_CONFIG.assert(typeof NexoApp === 'function', 'NexoApp debe ser una clase valida');
    _registerCriticalListeners();
    var nexoConfig = {
      relayUrls: ['wss://relay.nexo.local:8080', 'wss://backup.nexo.local:8081'],
      bleTimeout: (NEXO_CONFIG && NEXO_CONFIG.TIMEOUTS && NEXO_CONFIG.TIMEOUTS.BLE) ? NEXO_CONFIG.TIMEOUTS.BLE : 30000,
      enableGestures: true,
      enableMesh: true,
      onMessage: function(msg) {
        console.log('[NEXO] Mensaje recibido:', msg.msgId || msg.messageId);
      },
      onStatusChange: function(mode) {
        console.log('Modo:', mode);
      },
      onError: function(err) {
        console.error('App error:', err);
      },
      onVaultStateChange: function(isOpen) { _toggleVaultUI(isOpen); },
      actionCallbacks: {
        onReact: function(id) { rem.success('Reaccion anadida', 'REACT_OK'); },
        onReply: function(id) { _focusInput(id ? ('@' + id.substr(0, 8) + ' ') : ''); },
        onForward: function(id) { rem.info('Listo para reenviar', 'FORWARD_READY'); }
      }
    };
    window.NEXO.app = new NexoApp(nexoConfig);
    try {
      if (!window.bleInterface) {
        initBLEInterface();
      }
    } catch (bleInitErr) {
      console.warn('[MAIN] initBLEInterface error:', bleInitErr);
    }
    try {
      // FIX v9.9.26: NEXO.app.bleInterface se asigna en NEXO.app.init() (más abajo), así que aquí
      // seguía en null y el AckSystem nunca se vinculaba (sin entregado/leído, sendFile rechazado).
      var biEarly = (window.NEXO.app && window.NEXO.app.bleInterface) || window.bleInterface;
      if (biEarly) {
        var ackEarly = createAckSystem(biEarly);
        biEarly.setAckSystem(ackEarly);
        console.log('[MAIN] BleAckSystem vinculado EARLY');
      } else {
        console.warn('[MAIN] BleAckSystem NO vinculado: bleInterface no disponible');
      }
    } catch (ackEarlyErr) {
      console.warn('[MAIN] AckSystem early vinculo fallo:', ackEarlyErr);
    }
    setTimeout(function() {
      var bi = window.NEXO.app && window.NEXO.app.bleInterface;
      var ack = bi && bi.ackSystem;
      if (ack && typeof ack.resumeOutgoingTransfers === 'function') {
        ack.resumeOutgoingTransfers();
      }
    }, 3000);
    try {
      if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.NexoBLE) {
        window.Capacitor.Plugins.NexoBLE.addListener('onNotificationOpened', function(event) {
          if (event && event.deviceId) {
            setTimeout(function() {
              _openChatFromNotification(event.deviceId);
            }, 500);
          }
        });
      }
    } catch (notifErr) {
      console.log('[MAIN] Notificacion listener no disponible:', notifErr);
    }
    // Al arrancar, los contadores de la app mandan sobre las notificaciones que hubiera en el teléfono
    setTimeout(function() { _notifier.syncNative(); _notifier.ensurePermission(); }, 4000);
    var initPromise = window.NEXO.app.init();
    var timeoutPromise = new Promise(function(resolve, reject) {
      setTimeout(function() { reject(new Error('INIT_TIMEOUT')); }, (NEXO_CONFIG && NEXO_CONFIG.TIMEOUTS && NEXO_CONFIG.TIMEOUTS.CONNECT) ? NEXO_CONFIG.TIMEOUTS.CONNECT + 3000 : 13000);
    });
    try {
      await Promise.race([initPromise, timeoutPromise]);
    } catch (timeoutErr) {}
    window.NEXO.initialized = true;
    clearTimeout(SAFETY_TIMEOUT);
    try {
      if (window.NEXO.app && window.NEXO.app.bleInterface) {
        var bi = window.NEXO.app.bleInterface;
        console.log('[MAIN] BLE Interface estado:', {
          localUUID: bi.localDeviceUUID,
          activeChatId: bi._activeChatDeviceId,
          contacts: bi.getBLEContacts ? bi.getBLEContacts().length : 0
        });
      }
    } catch (logErr) { console.warn('[MAIN] Log BLE error:', logErr); }
    _setupMessageInput();
    _setupMessageActions();
    _setupVaultToggle();
    _setupChatHeader();
    _setupKeyboardShortcuts();
    _setupJumpButton();
    _setupBackButton();
    await _loadPersistedMessages();
    console.log('[MAIN] Fase 4 hooks OK');
    NEXO_DIAG.hideSplash();
    _forceHideSplash();
    console.log('NEXO ' + window.NEXO.version + ' Inicializado');
    try {
      var status = window.NEXO.app.getStatus ? window.NEXO.app.getStatus() : null;
      if (status) console.log('[NEXO STATUS]', status);
    } catch (statusErr) {}
  } catch (error) {
    console.error('Error en NexoApp:', error);
    clearTimeout(SAFETY_TIMEOUT);
    try {
      NEXO_DIAG.error('APP_INIT_ERROR', error.message || 'unknown');
      NEXO_DIAG.hideSplash();
    } catch (diagErr) {}
    _forceHideSplash();
    _enableFallbackMode();
  }
}

function _ensureDOMStructure() {
  try {
    var stream = document.getElementById('nexo-stream') || document.querySelector('.stream-container');
    var vault = document.getElementById('nexo-vault') || document.querySelector('.vault-panel');
    if (stream && !stream.id) stream.id = 'nexo-stream';
    if (vault && !vault.id) vault.id = 'nexo-vault';
    if (!document.getElementById('messages-container')) {
      var msgContainer = document.createElement('div');
      msgContainer.id = 'messages-container';
      msgContainer.className = 'messages-container';
      (stream || document.body).appendChild(msgContainer);
    }
  } catch (e) {
    console.warn('[MAIN] _ensureDOMStructure error:', e);
  }
}

function _fixLogoPath() {
  try {
    var logo = document.getElementById('main-logo');
    if (logo) {
      logo.style.backgroundImage = 'url(\"./assets/nexo_logo.png\")';
      logo.style.backgroundSize = 'contain';
      logo.style.backgroundRepeat = 'no-repeat';
      logo.style.backgroundPosition = 'center';
    }
  } catch (e) {
    console.warn('[MAIN] _fixLogoPath error:', e);
  }
}

function _setupMessageInput() {
  try {
    var input = document.getElementById('message-input');
    var btn = document.getElementById('send-btn');
    if (!input || !btn || !window.NEXO.app) return;
    var _isComposing = false;
    var _longPressTimer = null;
    var _isLongPress = false;
    var LONG_PRESS_MS = 600;

    var charCounter = document.getElementById('char-counter');
    if (!charCounter && input.parentNode) {
      charCounter = document.createElement('span');
      charCounter.id = 'char-counter';
      charCounter.style.cssText = 'position:absolute;right:60px;bottom:6px;font-size:11px;color:#888;pointer-events:none;transition:color 0.2s;';
      input.parentNode.style.position = 'relative';
      input.parentNode.appendChild(charCounter);
    }

    function _updateBtnState() {
      var hasText = input.value.trim().length > 0;
      btn.classList.toggle('mic-mode', !hasText);
      if (charCounter) {
        var len = input.value.length;
        charCounter.textContent = len > 0 ? len + ' chars' : '';
        charCounter.style.color = len > 180 ? '#FFC107' : '#888';
      }
    }
    _updateBtnState();

    var _doSend = async function() {
      var text = input.value.trim();
      if (!text) return;
      input.value = '';
      _updateBtnState();
      input.focus();
      var msgId = 'msg' + Date.now() + '' + Math.random().toString(36).substr(2, 9);
      var seq = (window.bleInterface && typeof window.bleInterface.getNextSeq === 'function') ? window.bleInterface.getNextSeq() : 0;
      // FIX v9.9.26: sin contactNexoId el mensaje propio no se guardaba en el vault (desaparecía al
      // reabrir el chat y la cola de reenvío no lo veía).
      var chatContactId = _getCurrentContactId();
      if (chatContactId) _msgContactMap[msgId] = chatContactId;
      // v9.9.45: respuesta a una burbuja (solo si el otro la entiende; si no, va el texto solo)
      var wire = text;
      if (_replyTo && _peerUnderstands(chatContactId)) wire = JSON.stringify({ type: 'nexo_txt', t: text, rp: _replyTo });
      _cancelReply();
      var vaultMsg = {
        msgId: msgId,
        messageId: msgId,
        contactNexoId: chatContactId,
        content: wire,
        _own: true,
        status: 'sending',
        timestamp: Date.now(),
        seq: seq
      };
      _renderMessage(vaultMsg);
      _noteContactMessage(chatContactId, text, vaultMsg.timestamp);
      _updateMessageStatus(msgId, 'sending');
      _updateMessageStorageStatus(msgId, 'sending');
      try {
        await window.NEXO.app.sendMessage({ content: wire, msgId: msgId, messageId: msgId, seq: seq });
        window._sentFallbackTimers = window._sentFallbackTimers || {};
        window._sentFallbackTimers[msgId] = setTimeout(function() {
          _updateMessageStatus(msgId, 'sent');
          _updateMessageStorageStatus(msgId, 'sent');
          delete window._sentFallbackTimers[msgId];
        }, 12000);
      } catch (e) {
        console.warn('[MAIN] sendMessage failed:', e.message);
        if (window._sentFallbackTimers && window._sentFallbackTimers[msgId]) {
          clearTimeout(window._sentFallbackTimers[msgId]);
          delete window._sentFallbackTimers[msgId];
        }
        var st = (e && e.code === 'NO_KEY') ? 'pending' : 'failed';
        _updateMessageStatus(msgId, st);
        _updateMessageStorageStatus(msgId, st);
      }
    };

    input.addEventListener('input', _updateBtnState);
    input.addEventListener('keyup', _updateBtnState);
    input.addEventListener('paste', function() { requestAnimationFrame(_updateBtnState); });
    input.addEventListener('cut', function() { requestAnimationFrame(_updateBtnState); });
    input.addEventListener('compositionstart', function() { _isComposing = true; });
    input.addEventListener('compositionend', function() {
      _isComposing = false;
      _updateBtnState();
    });
    input.addEventListener('keydown', function(e) {
      if (e.key === 'Enter' && !_isComposing) {
        e.preventDefault();
        _doSend();
      }
    });
    btn.addEventListener('click', function(e) {
      if (_isLongPress) {
        _isLongPress = false;
        return;
      }
      var text = input.value.trim();
      if (text) {
        e.preventDefault();
        e.stopPropagation();
        _doSend();
      } else {
        e.preventDefault();
        e.stopPropagation();
        _handleVoiceToggle();
      }
    });
    btn.addEventListener('touchstart', function(e) {
      if (!btn.classList.contains('mic-mode')) return;
      _isLongPress = false;
      _longPressTimer = setTimeout(function() {
        _isLongPress = true;
        _handleVoiceToggle();
      }, LONG_PRESS_MS);
    }, { passive: true });
    btn.addEventListener('touchend', function() {
      if (_longPressTimer) { clearTimeout(_longPressTimer); _longPressTimer = null; }
    });
    btn.addEventListener('touchcancel', function() {
      if (_longPressTimer) { clearTimeout(_longPressTimer); _longPressTimer = null; }
    });
    window.addEventListener('resize', function() {
      var s = document.getElementById('messages-container');
      if (s) requestAnimationFrame(function() { s.scrollTop = s.scrollHeight; });
    });
    input.focus();
  } catch (e) {
    console.warn('[MAIN] _setupMessageInput error:', e);
  }
}

function _setupVaultToggle() {
  try {
    var vault = document.getElementById('vault-panel');
    if (vault) {
      vault.classList.add('vault-hidden');
      vault.classList.remove('vault-visible');
      vault.style.setProperty('display', 'none', 'important');
      vault.style.setProperty('visibility', 'hidden', 'important');
      vault.style.setProperty('opacity', '0', 'important');
      vault.style.setProperty('pointer-events', 'none', 'important');
    }
  } catch (e) {}
}

function _setupChatHeader() {
  try {
    var nameInput = document.getElementById('chat-contact-name');
    if (!nameInput) return;
    var saveName = function() {
      try {
        var newName = nameInput.value.trim();
        if (!newName) {
          nameInput.value = (window.NEXO.app && window.NEXO.app.activeContact && window.NEXO.app.activeContact.name) ? window.NEXO.app.activeContact.name : 'NEXO';
          return;
        }
        if (window.NEXO.app && window.NEXO.app.activeContact) {
          window.NEXO.app.activeContact.name = newName;
          window.NEXO.app.activeContact.displayName = newName;
        }
        try {
          var activeId = window.NEXO.app && window.NEXO.app.activeContact ? window.NEXO.app.activeContact.nexoId : null;
          if (activeId) {
            var c = vaultFindContactByNexoId(activeId);
            if (c) {
              c.displayName = newName;
              c.name = newName;
              vaultSaveContact(c);
            }
          }
        } catch (e) {}
      } catch (saveErr) {
        console.warn('[main] Error guardando nombre editado:', saveErr);
      }
    };
    nameInput.addEventListener('blur', saveName);
    nameInput.addEventListener('keypress', function(e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        nameInput.blur();
      }
    });
  } catch (e) {
    console.warn('[MAIN] _setupChatHeader error:', e);
  }
}

function _setupKeyboardShortcuts() {
  try {
    document.addEventListener('keydown', function(e) {
      try {
        if (e.ctrlKey && e.shiftKey && e.key === 'V') {
          e.preventDefault();
          var vault = document.getElementById('vault-panel');
          if (vault) {
            var isHidden = vault.classList.contains('vault-hidden');
            _toggleVaultUI(!isHidden);
          }
        }
        if (e.ctrlKey && e.shiftKey && e.key === 'L') {
          e.preventDefault();
          if (rem.toggle) rem.toggle();
        }
        if (e.ctrlKey && e.shiftKey && e.key === 'H') {
          e.preventDefault();
          if (rem.showHistory) rem.showHistory();
        }
      } catch (shortcutErr) {}
    });
  } catch (e) {
    console.warn('[MAIN] _setupKeyboardShortcuts error:', e);
  }
}

function _setupJumpButton() {
  try {
    var stream = document.getElementById('nexo-stream');
    var jumpBtn = document.getElementById('jump-to-bottom');
    if (!stream || !jumpBtn) return;
    var threshold = 150;
    stream.addEventListener('scroll', function() {
      var scrollBottom = stream.scrollHeight - stream.scrollTop - stream.clientHeight;
      if (scrollBottom > threshold) {
        jumpBtn.classList.add('visible');
      } else {
        jumpBtn.classList.remove('visible');
      }
    });
    jumpBtn.addEventListener('click', function() {
      stream.scrollTo({ top: stream.scrollHeight, behavior: 'smooth' });
      jumpBtn.classList.remove('visible');
    });
  } catch (e) {
    console.warn('[MAIN] _setupJumpButton error:', e);
  }
}

function _setupFABButton() {
  try {
    // ble_interface.js ya crea #ble-fab-btn y enlaza togglePanel.
    // NO añadir otro click aquí: provoca doble toggle.
    var fabBtn = document.getElementById('ble-fab-btn');
    if (!fabBtn) return;
  } catch (e) {
    console.warn('[MAIN] _setupFABButton error:', e);
  }
}

function _getContactStorageKey() {
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

function _saveMessageToStorage(msg, contactId) {
  try {
    if (!msg) return;
    var msgId = msg.msgId || msg.messageId || msg.id || ('msg' + Date.now() + '' + Math.random().toString(36).substr(2, 5));
    msg.msgId = msgId;
    msg.messageId = msgId;
    if (!contactId) {
      if (msg._own) {
        contactId = msg.contactNexoId || msg.contactId || null;
      } else {
        contactId = msg.senderNexoId || msg.from || msg.sender || null;
      }
    }
    if (contactId) {
      vaultAppendMessage(contactId, msg).catch(function(e) {});
    }
  } catch (e) {
    console.warn('[MAIN] _saveMessageToStorage error:', e);
  }
}

function _updateMessageStorageStatus(messageId, status, contactId) {
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

var HISTORY_PAGE = 60;
var _olderMessages = [], _olderContactId = null, _loadingOlder = false, _suppressAutoScroll = false, _olderArmed = false;

// Al acercarse arriba del todo se dibujan los 60 anteriores sin que la vista salte
function _bindOlderMessagesScroll() {
  var mc = document.getElementById('messages-container');
  if (!mc || mc._olderBound) return;
  mc._olderBound = true;
  mc.addEventListener('scroll', function() {
    // Solo cuando el usuario sube (no por el scroll inicial, con el chat aún arriba del todo)
    if (_olderArmed && mc.scrollTop < 150 && _olderMessages.length && !_loadingOlder) _loadOlderMessages();
  }, { passive: true });
}
async function _loadOlderMessages() {
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
    for (var i = batch.length - 1; i >= 0; i--) _renderMessage(batch[i], true);
    _suppressAutoScroll = false;
    mc.scrollTop = t0 + (mc.scrollHeight - h0);
  } catch (e) {
    _suppressAutoScroll = false;
    console.warn('[MAIN] Error cargando mensajes anteriores:', e && e.message);
  } finally { _loadingOlder = false; }
}

async function _loadPersistedMessages() {
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

// v9.9.36: aviso de cifrado al principio del chat (pulsar: huellas para comparar en persona)
function _renderE2EBanner() {
  var mc = document.getElementById('messages-container');
  var cid = _normId(_getCurrentContactId());
  if (!mc || !cid) return;
  var c = (vaultLoadContacts() || []).find(function(x) { return _normId(x.nexoId || x.deviceUUID) === cid; }) || {};
  var name = c.name || cid.toUpperCase();
  var b = document.getElementById('e2e-banner');
  if (!b) {
    b = document.createElement('div');
    b.id = 'e2e-banner';
    mc.insertBefore(b, mc.firstChild);
  }
  b.innerHTML = '';
  b.style.cssText = 'margin:8px auto 12px;max-width:300px;padding:8px 12px;border-radius:10px;font-size:12px;text-align:center;cursor:pointer;white-space:pre-line;' +
    (c.pendingKey ? 'background:rgba(255,59,48,0.15);color:#ff8a80;' : 'background:rgba(255,200,0,0.12);color:#ffd76a;');
  var bi = window.bleInterface;
  var txt;
  if (c.pendingKey) {
    // v9.9.40 (seguridad): clave nueva sin aceptar: puede ser un reinstalación o un impostor
    var held = (bi && typeof bi.heldCount === 'function') ? bi.heldCount(cid) : 0;
    txt = '⚠️ La clave de seguridad de ' + name + ' cambió (' + new Date(c.keyChangedAt || Date.now()).toLocaleString() + ').' +
      (held ? ' ' + held + (held === 1 ? ' mensaje retenido.' : ' mensajes retenidos.') : '') +
      ' Hasta que la aceptes no se muestran sus mensajes nuevos ni se le envía nada.' +
      ' Si no reinstaló NEXO, puede ser un impostor: comparad las huellas en persona.';
  } else if (c.publicKey && c.verified === c.publicKey) txt = '🔒✔ Cifrado de extremo a extremo. Verificaste el número de seguridad de ' + name + '.';
  else if (c.publicKey && c.keyAcceptedAt) txt = '🔒 Cifrado de extremo a extremo. Aceptaste una clave nueva de ' + name + ' (' + new Date(c.keyAcceptedAt).toLocaleString() + '). Toca para verificar.';
  else if (c.publicKey) txt = '🔒 Mensajes cifrados de extremo a extremo. Nadie fuera de este chat puede leerlos. Toca para verificar.';
  else txt = '⏳ Esperando la clave de cifrado de ' + name + ': tus mensajes saldrán cifrados en cuanto conecte.';
  // v9.9.49: sesión empezada con el acuerdo poscuántico (ML-KEM): protegida también ante ordenadores cuánticos
  if (c.publicKey && !c.pendingKey && ratchetSessionPq(cid, c.publicKey)) txt += ' Protección poscuántica activa.';
  var t = document.createElement('div');
  t.className = 'e2e-text';
  t.textContent = txt;
  b.appendChild(t);
  var fp = document.createElement('div');
  fp.className = 'e2e-fp';
  fp.style.cssText = 'margin-top:6px;font-family:monospace;';
  b.appendChild(fp);
  // v9.9.41: número de seguridad de 60 cifras (como Signal): el mismo en los dos teléfonos; comparadlo en persona
  var me = _normId(window.bleInterface && window.bleInterface.localNexoId);
  var showFp = function() {
    if (fp.dataset.shown) return;
    fp.dataset.shown = '1';
    fp.textContent = 'Calculando…';
    Promise.all([c.publicKey ? ratchetSafetyNumber(me, cid, c.publicKey) : Promise.resolve(''), c.pendingKey ? ratchetSafetyNumber(me, cid, c.pendingKey) : Promise.resolve('')]).then(function(n) {
      var fmt = function(x) { var g = x.split(' '); return g.slice(0, 4).join(' ') + '\n' + g.slice(4, 8).join(' ') + '\n' + g.slice(8).join(' '); };
      fp.textContent = c.pendingKey
        ? 'Número de seguridad con la clave anterior:\n' + (n[0] ? fmt(n[0]) : '—') + '\nCon la clave NUEVA:\n' + fmt(n[1])
        : (n[0] ? 'Número de seguridad (debe ser idéntico en el teléfono de ' + name + '):\n' + fmt(n[0]) : 'Sin clave aún');
      if (!c.pendingKey && c.publicKey && bi && typeof bi.setContactVerified === 'function') {
        var on = c.verified === c.publicKey;
        var vb = document.createElement('button');
        vb.className = 'e2e-verify';
        vb.textContent = on ? 'Quitar verificado' : 'Marcar como verificado';
        vb.style.cssText = 'display:block;margin:8px auto 0;padding:6px 10px;border-radius:8px;border:none;font-size:12px;cursor:pointer;background:' + (on ? 'rgba(255,255,255,0.15)' : '#00c8ff') + ';color:#fff;';
        vb.onclick = function(ev) { ev.stopPropagation(); bi.setContactVerified(cid, !on); };
        fp.appendChild(vb);
        // v9.9.49: o por QR (como Signal): uno lo muestra y el otro lo escanea desde este mismo chat
        var qrow = document.createElement('div');
        qrow.style.cssText = 'display:flex;gap:8px;justify-content:center;margin-top:8px;';
        var qb = function(label, cls, fn) {
          var x = document.createElement('button');
          x.className = cls;
          x.textContent = label;
          x.style.cssText = 'padding:6px 10px;border-radius:8px;border:none;font-size:12px;cursor:pointer;background:rgba(255,255,255,0.15);color:#fff;';
          x.onclick = function(ev) { ev.stopPropagation(); fn(); };
          qrow.appendChild(x);
        };
        qb('Mostrar mi QR', 'e2e-qr-show', function() {
          showSafetyQr(safetyQrPayload(me, cid, n[0]), 'Que ' + name + ' lo escanee desde su chat contigo\n(Escanear su QR)');
        });
        qb('Escanear su QR', 'e2e-qr-scan', function() { openQrScanner(function(text) { _onSafetyQr(cid, name, text); }, 'Apunta al QR que muestra ' + name); });
        fp.appendChild(qrow);
      }
    }).catch(function() { fp.textContent = ''; delete fp.dataset.shown; });
  };
  b.onclick = showFp;
  if (c.pendingKey) {
    showFp();
    var row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:8px;justify-content:center;margin-top:8px;';
    var mk = function(label, cls, fn) {
      var btn = document.createElement('button');
      btn.className = cls;
      btn.textContent = label;
      btn.style.cssText = 'padding:6px 10px;border-radius:8px;border:none;font-size:12px;cursor:pointer;' + (cls === 'e2e-accept' ? 'background:#00c8ff;color:#fff;' : 'background:rgba(255,255,255,0.15);color:#fff;');
      btn.onclick = function(ev) { ev.stopPropagation(); fn(); };
      return btn;
    };
    row.appendChild(mk('Aceptar clave nueva', 'e2e-accept', function() { if (bi && bi.acceptContactKey) bi.acceptContactKey(cid); }));
    row.appendChild(mk('Rechazar', 'e2e-reject', function() { if (bi && bi.rejectContactKey) bi.rejectContactKey(cid); }));
    b.appendChild(row);
  }
}
// Lo escaneado se compara con el número que calcula ESTE teléfono ahora (con la clave guardada en este momento)
function _onSafetyQr(cid, name, text) {
  var bi = window.bleInterface;
  var me = _normId(bi && bi.localNexoId);
  var c = (vaultLoadContacts() || []).find(function(x) { return _normId(x.nexoId || x.deviceUUID) === cid; });
  if (!c || !c.publicKey || c.pendingKey) { _showInfoToast('Primero acepta o rechaza la clave nueva de ' + name, 3500); return; }
  ratchetSafetyNumber(me, cid, c.publicKey).then(function(num) {
    var r = checkSafetyQr(text, me, cid, num);
    console.log('[E2E] QR del número de seguridad de ' + cid + ': ' + r);
    if (r === 'ok') {
      if (bi && typeof bi.setContactVerified === 'function') bi.setContactVerified(cid, true);
      _showInfoToast('✔ Número de seguridad verificado: ' + name + ' es quien dice ser', 3500);
    } else if (r === 'mismatch') {
      _showInfoToast('⚠️ El número NO coincide: la clave de ' + name + ' no es la que tienes guardada. Puede haber un impostor: no lo marques como verificado.', 7000);
    } else if (r === 'other') _showInfoToast('Ese QR es de otro contacto, no de ' + name, 3500);
    else if (r === 'notme') _showInfoToast('Ese QR es para otra persona: pide a ' + name + ' que lo abra en su chat contigo', 4000);
    else _showInfoToast('No es un QR de número de seguridad de NEXO', 3000);
  }).catch(function() { _showInfoToast('No se pudo calcular el número de seguridad', 3000); });
}
window.addEventListener('nexo:e2e:key', function(e) {
  var d = (e && e.detail) || {};
  if (d.nexoId && d.nexoId === _normId(_getCurrentContactId())) _renderE2EBanner();
});
window.addEventListener('nexo:e2e:held', function(e) {
  var d = (e && e.detail) || {};
  if (d.nexoId && d.nexoId === _normId(_getCurrentContactId())) _renderE2EBanner();
  // En la lista de chats: aviso en el último mensaje del contacto
  if (d.nexoId) _noteContactMessage(d.nexoId, '⚠️ Mensaje retenido: clave cambiada', Date.now());
});

function _clearMessageContainer() {
  var container = document.getElementById('messages-container');
  if (container) container.innerHTML = '';
  _renderedMessageIds.clear();
}

// v9.9.34: un solo ajuste de scroll por fotograma (leer scrollHeight recalcula la maquetación de todo
// el chat; antes se hacía una vez por mensaje dibujado)
var _scrollPending = false;
function _scheduleScrollToBottom() {
  if (_scrollPending) return;
  _scrollPending = true;
  requestAnimationFrame(function() {
    _scrollPending = false;
    var mc = document.getElementById('messages-container');
    if (mc) mc.scrollTop = mc.scrollHeight;
  });
}

function _renderMessage(msg, skipSave) {
  try {
    if (!msg) return;
    var msgIdDedup = msg.msgId || msg.messageId || msg.id || '';
    if (msg.hidden) return; // v9.9.45: acciones del chat (eliminar para todos) guardadas para reenviarse
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
      var senderId = msg.senderNexoId || msg.from || msg.sender || '';
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
        if (isImageFile || isVideoFile) {
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

var MAX_HD_B64_BYTES = 8000000;      // original de hasta ~6 MB (en segundo plano)
var _videoTimes = {};                // msgId -> tiempos de previa/HD (registro de diagnóstico)
var _hdOutbox = {};                  // msgId -> { cid, mime, b64 } (emisor, en memoria)
var _hdInFlight = {};




function _showOwnPreparing(show) {
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
function _sendVideo(blob, meta) {
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
function _videoViaBle(cid, msgId, blob, meta, mime, makePreview, tStart) {
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

function _registerHd(cid, msgId, hdB64, mime) {
  var ref = vaultHdFileName(msgId);
  _hdOutbox[msgId] = { cid: cid, mime: mime, b64: hdB64 };
  vaultSaveFile(ref, hdB64);
  vaultSetMessageFields(cid, msgId, { hdRef: ref, hdStatus: 'pending', hdMime: mime });
  _setHdBadge(msgId, 'HD en espera');
}

// Emisor: manda el original cuando la previa ya llegó (o al reconectar si quedó a medias)
function _startHd(cid, msgId) {
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

function _onHdSent(cid, msgId) {
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
function _resumeHdForMsg(msgId) {
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

function _resumeHdTransfers(cid) {
  if (!cid) return;
  vaultLoadMessages(cid).then(function(msgs) {
    (msgs || []).forEach(function(m) {
      if (m._own && m.hdRef && (m.hdStatus === 'pending' || m.hdStatus === 'sending') &&
          (m.status === 'delivered' || m.status === 'read')) _startHd(cid, m.msgId);
    });
  }).catch(function() {});
}

// Receptor: el HD sustituye a la previa del mismo mensaje
function _applyHdUpgrade(cid, msgId, payload, meta) {
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

function _swapVideoInBubble(msgId, payload, mime) {
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



var _thumbsInProgress = {};
function _buildFileCard(msg, attachment, mime) {
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
  parts.push('Toca para abrir');
  sub.textContent = parts.join(' · ');
  txt.appendChild(nm);
  txt.appendChild(sub);
  row.appendChild(ic);
  row.appendChild(txt);
  card.appendChild(row);
  card.onclick = function(e) {
    e.stopPropagation();
    _openAttachmentFile(attachment.payload, name, mime);
  };
  return card;
}

var _openingFile = false;
function _openAttachmentFile(b64, name, mime) {
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
function _ensurePdfThumb(msg, attachment, img) {
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

function _ensureVideoThumb(msg, attachment, src, img) {
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

function _setHdBadge(msgId, text) {
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

function _noteContactMessage(contactId, textOrType, ts) {
  var bi = window.bleInterface || (window.NEXO && window.NEXO.app && window.NEXO.app.bleInterface);
  if (!contactId || !bi || typeof bi.noteContactMessage !== 'function') return;
  bi.noteContactMessage(contactId, _PREVIEW_BY_TYPE[textOrType] || _cut(textOrType, 50), ts);
}

function _removeIncomingPlaceholder(fileId) {
  var ph = document.querySelector('[data-progress-id="' + fileId + '"]');
  if (ph && ph.parentNode) ph.parentNode.removeChild(ph);
}

// v9.9.27: progreso de transferencias de archivos (eventos 'nexo:ble:fileProgress' de ble_ack.js)
var _hdProgress = {};
function _onFileProgress(d) {
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

function _updateMessageStatus(messageId, status) {
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

function _cleanupObjectURLs() {
  try {
    _objectURLRegistry.forEach(function(url) {
      try { URL.revokeObjectURL(url); } catch (e) {}
    });
    _objectURLRegistry = [];
    console.log('[MAIN] ObjectURLs limpiados');
  } catch (e) {
    console.warn('[MAIN] _cleanupObjectURLs error:', e);
  }
}

function _toggleVaultUI(isOpen) {
  try {
    var vault = document.getElementById('vault-panel');
    var stream = document.getElementById('nexo-stream');
    if (vault) {
      vault.classList.toggle('vault-hidden', !isOpen);
      vault.classList.toggle('vault-visible', isOpen);
      if (isOpen) {
        vault.style.setProperty('display', 'flex', 'important');
        vault.style.setProperty('visibility', 'visible', 'important');
        vault.style.setProperty('opacity', '1', 'important');
        vault.style.setProperty('pointer-events', 'auto', 'important');
        vault.style.setProperty('position', 'relative', 'important');
        vault.style.setProperty('z-index', '1', 'important');
      } else {
        vault.style.setProperty('display', 'none', 'important');
        vault.style.setProperty('visibility', 'hidden', 'important');
        vault.style.setProperty('opacity', '0', 'important');
        vault.style.setProperty('pointer-events', 'none', 'important');
        vault.style.setProperty('position', 'absolute', 'important');
        vault.style.setProperty('z-index', '-9999', 'important');
      }
    }
    if (stream) {
      stream.style.transform = isOpen ? 'translateX(-20%)' : 'translateX(0)';
    }
  } catch (e) {
    console.warn('[MAIN] _toggleVaultUI error:', e);
  }
}

function _focusInput(text) {
  try {
    var input = document.getElementById('message-input');
    if (input) {
      input.focus();
      if (text) input.value = text;
    }
  } catch (e) {}
}

function _forceHideSplash() {
  try {
    var selectors = ['#splash-native', '#splash', '.splash-screen', '[id*="splash"]', '#nexo-setup'];
    for (var i = 0; i < selectors.length; i++) {
      var el = document.querySelector(selectors[i]);
      if (el) {
        el.style.opacity = '0';
        el.style.pointerEvents = 'none';
        setTimeout(function(element) { return function() { element.remove(); }; }(el), 500);
      }
    }
  } catch (e) {
    console.warn('[MAIN] _forceHideSplash error:', e);
  }
}

function _enableFallbackMode() {
  try {
    console.warn('[NEXO] Activando modo fallback');
    var body = document.body;
    body.classList.add('nexo-fallback-mode');
    var msg = document.createElement('div');
    msg.className = 'fallback-notice';
    msg.innerHTML = '<h3>⚠ Error de Inicializacion</h3> <p>La app no pudo iniciar completamente.</p>';
    body.appendChild(msg);
  } catch (e) {
    console.error('[MAIN] _enableFallbackMode error:', e);
  }
}

function _setupBackButton() {
  try {
    var backBtn = document.getElementById('chat-back-btn');
    if (!backBtn) return;
    window.addEventListener('nexo:ble:openChat', function(e) {
      _chatNavToken++;
      backBtn.classList.add('visible');
      document.body.classList.add('chat-view-active');
      _clearMessageContainer();
      var detail = e.detail || {};
      if (detail.contactId && window.NEXO.app && !window.NEXO.app.activeContact) {
        window.NEXO.app.activeContact = { nexoId: detail.contactId, name: detail.name || 'NEXO' };
      }
    });
    window.addEventListener('nexo:ble:closeChat', function() {
      backBtn.classList.remove('visible');
      document.body.classList.remove('chat-view-active');
    });
    backBtn.addEventListener('click', function() {
      _doChatBack();
    });
    _setupSwipeBack();
  } catch (e) {
    console.warn('[MAIN] _setupBackButton error:', e);
  }
}

function _setupSwipeBack() {
  try {
    var SWIPE_EDGE_WIDTH = 40;
    var SWIPE_THRESHOLD = 0.30;
    var startX = 0;
    var startY = 0;
    var currentX = 0;
    var isDragging = false;
    var isHorizontal = false;
    var winWidth = window.innerWidth;
    var app = document.getElementById('app');
    if (!app) return;
    function onTouchStart(e) {
      if (!document.body.classList.contains('chat-view-active')) return;
      var touch = e.touches[0];
      if (touch.clientX > SWIPE_EDGE_WIDTH) return;
      startX = touch.clientX;
      startY = touch.clientY;
      currentX = startX;
      isDragging = true;
      isHorizontal = false;
      winWidth = window.innerWidth;
    }
    function onTouchMove(e) {
      if (!isDragging) return;
      var touch = e.touches[0];
      currentX = touch.clientX;
      var deltaX = currentX - startX;
      var deltaY = touch.clientY - startY;
      if (!isHorizontal) {
        if (Math.abs(deltaX) > Math.abs(deltaY) && deltaX > 10) {
          isHorizontal = true;
          document.body.classList.add('chat-swipe-dragging');
          e.preventDefault();
        } else if (Math.abs(deltaY) > 10) {
          isDragging = false;
          return;
        }
      }
      if (!isHorizontal) return;
      var translateX = Math.max(0, Math.min(deltaX, winWidth));
      var progress = translateX / winWidth;
      if (progress > 0.5) {
        translateX = winWidth * 0.5 + (translateX - winWidth * 0.5) * 0.4;
      }
      app.style.transform = 'translateX(' + translateX + 'px)';
      app.style.opacity = Math.max(0.4, 1 - (progress * 0.5));
      var contactsView = document.getElementById('contacts-view');
      if (contactsView) {
        contactsView.style.display = 'flex';
        contactsView.style.opacity = Math.min(1, progress * 2);
        contactsView.style.transform = 'translateX(' + (-20 + progress * 20) + '%)';
      }
      e.preventDefault();
    }
    function onTouchEnd(e) {
      if (!isDragging || !isHorizontal) {
        isDragging = false;
        isHorizontal = false;
        return;
      }
      var deltaX = currentX - startX;
      var progress = deltaX / winWidth;
      var threshold = winWidth * SWIPE_THRESHOLD;
      document.body.classList.remove('chat-swipe-dragging');
      if (deltaX > threshold) {
        document.body.classList.add('chat-swipe-complete');
        document.body.classList.add('chat-swipe-transition');
        setTimeout(function() {
          _doChatBack();
          app.style.transform = '';
          app.style.opacity = '';
          document.body.classList.remove('chat-swipe-complete');
          document.body.classList.remove('chat-swipe-transition');
          var contactsView = document.getElementById('contacts-view');
          if (contactsView) {
            contactsView.style.transform = '';
            contactsView.style.opacity = '';
          }
        }, 350);
      } else {
        document.body.classList.add('chat-swipe-rebound');
        document.body.classList.add('chat-swipe-transition');
        setTimeout(function() {
          document.body.classList.remove('chat-swipe-rebound');
          document.body.classList.remove('chat-swipe-transition');
          app.style.transform = '';
          app.style.opacity = '';
          var contactsView = document.getElementById('contacts-view');
          if (contactsView) {
            contactsView.style.transform = '';
            contactsView.style.opacity = '';
          }
        }, 250);
      }
      isDragging = false;
      isHorizontal = false;
    }
    function onTouchCancel(e) {
      if (!isDragging) return;
      isDragging = false;
      isHorizontal = false;
      document.body.classList.remove('chat-swipe-dragging');
      app.style.transform = '';
      app.style.opacity = '';
      var contactsView = document.getElementById('contacts-view');
      if (contactsView) {
        contactsView.style.transform = '';
        contactsView.style.opacity = '';
      }
    }
    document.addEventListener('touchstart', onTouchStart, { passive: true });
    document.addEventListener('touchmove', onTouchMove, { passive: false });
    document.addEventListener('touchend', onTouchEnd, { passive: true });
    document.addEventListener('touchcancel', onTouchCancel, { passive: true });
  } catch (e) {
    console.warn('[MAIN] _setupSwipeBack error:', e);
  }
}

// v9.9.34: cada apertura de chat incrementa este contador; el cierre diferido de "atrás" solo limpia
// el estado si no se abrió otro chat mientras tanto (antes, atrás + otro chat en <300 ms dejaba el
// chat nuevo sin contacto activo: los mensajes se pintaban pero no se enviaban)
var _chatNavToken = 0;
function _doChatBack() {
  try {
    var navToken = ++_chatNavToken;
    _cancelReply();
    _cleanupObjectURLs();
    var app = document.getElementById('app');
    var contactsView = document.getElementById('contacts-view');
    var backBtn = document.getElementById('chat-back-btn');
    if (app) {
      app.style.transition = 'transform 0.3s ease, opacity 0.3s ease';
      app.style.transform = 'translateX(100%)';
      app.style.opacity = '0';
    }
    if (contactsView) {
      contactsView.style.display = 'flex';
      contactsView.style.opacity = '0';
      contactsView.style.transform = 'translateX(-20%)';
      contactsView.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
      void contactsView.offsetWidth;
      contactsView.style.opacity = '1';
      contactsView.style.transform = 'translateX(0)';
    }
    setTimeout(function() {
      if (navToken !== _chatNavToken) {
        // Se abrió otro chat durante la animación: solo deshacer los estilos de la animación
        if (app) { app.style.transition = ''; app.style.transform = ''; app.style.opacity = ''; }
        if (contactsView) { contactsView.style.transition = ''; contactsView.style.transform = ''; contactsView.style.opacity = ''; contactsView.style.display = ''; }
        return;
      }
      if (backBtn) backBtn.classList.remove('visible');
      document.body.classList.remove('chat-view-active');
      var nameInput = document.getElementById('chat-contact-name');
      var subtitle = document.getElementById('chat-contact-subtitle');
      if (nameInput) nameInput.value = 'NEXO';
      if (subtitle) subtitle.textContent = '';
      var blePanel = document.getElementById('ble-panel');
      var bleOverlay = document.getElementById('ble-overlay');
      if (blePanel) blePanel.classList.remove('active');
      if (bleOverlay) bleOverlay.classList.remove('active');
      try {
        window.dispatchEvent(new CustomEvent('nexo:ble:closeChat', { detail: {} }));
      } catch (e) {}
      if (window.NEXO.app) {
        window.NEXO.app.activeContact = null;
      }
      if (window.NEXO.app && window.NEXO.app.bleInterface) {
        window.NEXO.app.bleInterface._activeChatDeviceId = null;
      }
      if (app) {
        app.style.transition = '';
        app.style.transform = '';
        app.style.opacity = '';
      }
      if (contactsView) {
        contactsView.style.transition = '';
        contactsView.style.transform = '';
        contactsView.style.opacity = '';
      }
    }, 300);
  } catch (e) {
    console.warn('[MAIN] _doChatBack error:', e);
  }
}

window.NEXO_updateMessageStatus = _updateMessageStatus;
window.NEXO_sendVideo = _sendVideo; // pruebas (tests/sim/video.js)
if (typeof module !== 'undefined' && module && module.hot) module.hot.accept();
