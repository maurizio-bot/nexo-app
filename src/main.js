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
import { groupAttachment, parseGroupEnvelope } from './ui/groups.js';
import { parseCallSignal } from './ui/calls.js';
import { installCallsUi } from './ui/calls_ui.js';
import { groupSubtitle, installGroupButton, openGroupChat, openGroupMenu, sendGroupText } from './ui/groups_ui.js';
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
import { chatActionsUse, _renderedMessageIds, _replyTo, DELETE_ALL_MS, _fillTextBubble, _scrollToMessage, _setupMessageActions, _openMsgMenu, _startReply, _cancelReply, _renderReplyBar, _copyText, _openForwardSheet, _forwardTo, _refreshChatPreview, _deleteForMe, _deleteForAll, _rerenderBlank, _applyChatAction } from './ui/chat_actions.js';
import { _objectURLRegistry, MAX_BLE_B64_BYTES, MAX_BLE_FILE_BYTES, WD_MAX_B64_BYTES, _maxB64For, _tooBigMessage, _cleanupObjectURLs } from './ui/media_limits.js';
import { videoSendUse, MAX_HD_B64_BYTES, _videoTimes, _hdOutbox, _hdInFlight, _showOwnPreparing, _sendVideo, _videoViaBle, _registerHd, _startHd, _onHdSent, _resumeHdForMsg, _resumeHdTransfers, _applyHdUpgrade, _swapVideoInBubble, _setHdBadge } from './ui/video_send.js';
import { _renderE2EBanner, _onSafetyQr } from './ui/e2e_banner.js';
import { _msgContactMap } from './ui/chat_state.js';
import { _closeFullscreenMedia, _openFullscreenMedia, _thumbsInProgress, _buildFileCard, _openingFile, _openAttachmentFile, _ensurePdfThumb, _ensureVideoThumb } from './ui/file_card.js';
import { _clearMessageContainer, _setupBackButton, _setupSwipeBack, _chatNavToken, _doChatBack } from './ui/chat_nav.js';
import { pickersUse, _pendingPicker, _pickFile, _readFailed, _handleGallery, _handleFile } from './ui/pickers.js';
import { _renderedMessageCount, _getContactStorageKey, _saveMessageToStorage, _updateMessageStorageStatus, HISTORY_PAGE, _olderMessages, _olderContactId, _loadingOlder, _suppressAutoScroll, _olderArmed, _bindOlderMessagesScroll, _loadOlderMessages, _loadPersistedMessages, _scrollPending, _scheduleScrollToBottom, _renderMessage, _removeIncomingPlaceholder, _hdProgress, _onFileProgress, _updateMessageStatus } from './ui/render.js';
import { _waitForBLEReady, _sendAttachment, _sendFileFor, _sendTextTo, _noteContactMessage, _sendBigFile } from './ui/send.js';
import { appSetupUse, _bindAttachmentHandlers, _showPermissionOverlay, _hidePermissionOverlay, _ensureDOMStructure, _fixLogoPath, _setupMessageInput, _setupVaultToggle, _setupChatHeader, _setupKeyboardShortcuts, _setupJumpButton, _setupFABButton, _toggleVaultUI, _focusInput, _forceHideSplash, _enableFallbackMode } from './ui/app_setup.js';
appSetupUse({ /* [pegamento] */ initializeNexoApp: initializeNexoApp });
pickersUse({ /* [pegamento] */ _sendAttachment: _sendAttachment, _sendBigFile: _sendBigFile });
videoSendUse({ /* [pegamento] */ _handleIncomingMessage: _handleIncomingMessage, _sendAttachment: _sendAttachment, _sendFileFor: _sendFileFor, _updateMessageStatus: _updateMessageStatus, _updateMessageStorageStatus: _updateMessageStorageStatus });
chatActionsUse({ /* [pegamento] */ _renderMessage: _renderMessage, _sendAttachment: _sendAttachment, _sendTextTo: _sendTextTo });
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
    // Ronda 2758: en un grupo el "leído" va a quien escribió el mensaje
    var gs = window.bleInterface && window.bleInterface.groups;
    if (gs && gs.isGroup(nexoId)) { nexoId = gs.senderOf(msgId); if (!nexoId) return; }
    setTimeout(function() { window.dispatchEvent(new CustomEvent('nexo:ble:sendReadReceipt', { detail: { nexoId: nexoId, msgId: msgId } })); }, 400);
  }
});
initE2E().then(function() { return ratchetInit(); }).catch(function(e) { console.warn('[E2E] init:', e && e.message); });

// v9.9.48: por dónde va el contacto del chat abierto (Wi-Fi de la misma red, Bluetooth, Jump)
function _refreshLinkSubtitle() {
  var sub = document.getElementById('chat-contact-subtitle');
  var bi = window.bleInterface, cid = _getCurrentContactId();
  if (sub && bi && bi.groups && bi.groups.isGroup(cid)) { sub.textContent = groupSubtitle(bi.groups.get(cid)); return; } // ronda 2758
  if (!sub || !bi || typeof bi.linkOf !== 'function' || !cid) return;
  var via = bi.linkOf(cid);
  sub.textContent = via === 'wifi' ? 'En línea · Wi-Fi' : via === 'internet' ? 'En línea · Internet' : via === 'bluetooth' ? 'En línea · Bluetooth' : via === 'jump' ? 'Por Jump' : '';
}
['nexo:ble:linkChange', 'nexo:ble:deviceDisconnected', 'nexo:ble:openChat'].forEach(function(ev) {
  window.addEventListener(ev, function() { setTimeout(_refreshLinkSubtitle, 50); });
});

// Ronda 2758: chats de grupo (groups.js / groups_ui.js)
window.NEXO_openGroupChat = openGroupChat;
window.NEXO_sendGroupText = sendGroupText;
window.NEXO_openGroupMenu = openGroupMenu;
window.addEventListener('nexo:groups', function() {
  var b = window.bleInterface;
  if (b && typeof b.renderContactsList === 'function') b.renderContactsList();
  _refreshLinkSubtitle();
});
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', installGroupButton); else installGroupButton();
// Ronda 2758: llamadas de voz (calls.js / calls_ui.js)
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', installCallsUi); else installCallsUi();

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

var _autoScan = null;

































































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
    // Ronda 2758: señal de llamada que llegó por el camino de los textos largos
    var csg = !msg.groupId ? parseCallSignal(msg.content) : null;
    if (csg) { var bcs = window.bleInterface && window.bleInterface.calls; if (bcs) bcs.onSignal(msg.senderNexoId || msg.deviceUUID, csg); return; }
    // Ronda 2758: mensaje de grupo que llegó por el camino de los textos largos (los cortos ya vienen con groupId)
    var bgs = window.bleInterface && window.bleInterface.groups;
    if (!msg.groupId) {
      var genv = parseGroupEnvelope(msg.content);
      if (genv) {
        var gr = bgs ? bgs.receive(genv, msg.senderNexoId || msg.deviceUUID, msg.messageId || msg.msgId) : null;
        if (!gr) return;
        msg.groupId = gr.gid; msg.content = gr.content;
        var gat = groupAttachment(gr.content);
        if (gat) { msg.attachmentType = gat.attachmentType; msg.attachmentPayload = gat.payload; msg.attachmentMeta = gat.meta || {}; }
        var gpv = gat ? (_PREVIEW_BY_TYPE[gat.attachmentType] || '📎 Archivo') : _cut(_plainText(gr.content), 50);
        bgs.noteMessage(gr.gid, bgs.memberName(msg.senderNexoId) + ': ' + gpv, msg.timestamp || Date.now());
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
      var who = (sc && (sc.name || sc.displayName)) || msg.senderName || 'NEXO';
      var pvw = msg.attachmentType ? (_PREVIEW_BY_TYPE[msg.attachmentType] || '📎 Archivo') : _cut(_plainText(msg.content), 80);
      var grpN = msg.groupId && bgs ? bgs.get(msg.groupId) : null;
      _notifier.incoming(grpN ? { cid: grpN.id, msgId: msgId, name: grpN.name, preview: who + ': ' + pvw }
        : { cid: senderId, msgId: msgId, name: who, preview: pvw });
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
    // Ronda 2758: estado de un mensaje de grupo (el menor de los de cada miembro, groups.js)
    window.addEventListener('nexo:groups:status', function(e) {
      var d = (e && e.detail) || {};
      if (!d.msgId || !d.status) return;
      _updateMessageStatus(d.msgId, d.status);
      _updateMessageStorageStatus(d.msgId, d.status, d.gid);
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





































window.NEXO_updateMessageStatus = _updateMessageStatus;
window.NEXO_sendVideo = _sendVideo; // pruebas (tests/sim/video.js)
if (typeof module !== 'undefined' && module && module.hot) module.hot.accept();
