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
import './styles/nexo_theme.css'; // ronda 2763: estilo NEXO en toda la app
import './styles/estados.css'; // 3169: pantalla Estados (estados_screen.js)
import './styles/links.css'; // 3161: enlaces y «Enviar a…» (aquí y no en links.js/share_in.js: las pruebas cargan esos módulos con Node, que no lee .css)
import './styles/chat_tools.css'; // 3219: silenciar, destacados y fijados (chat_mute/chat_star/chat_pin/chat_menu)
import { NEXO_DIAG } from './core/nap.js';
import { NexoApp, DEBUG } from './app/nexo_app.js';
import { rem } from './ui/rem.js';
import { ensureBLEPermissions, getPermissionShim } from './core/NexoPermissionShim.js';
import { createAckSystem } from './ui/ble_ack.js';
import {
  initVault,
  vaultLoadContacts, vaultSaveContacts, vaultSaveContact, vaultLoadMessages, vaultLoadRecent, vaultSaveMessages,
  vaultAppendMessage, vaultUpdateMessageStatus, vaultPatchMessage, vaultGetOrCreateContact, vaultFindContactByNexoId,
  vaultCreateTransfer, vaultAppendChunk, vaultGetTransfer, vaultCompleteTransfer,
  vaultGetIncompleteTransfers, vaultGetPendingOutgoingTransfers, vaultCreateOutgoingTransfer,
  vaultSetOutgoingChunkAcked, vaultIncrementOutgoingTimeout, vaultRemoveOutgoingTransfer,
  vaultSetOutgoingStatus, vaultHydrateAttachments, vaultBigSendBegin, vaultBigSendEnd, vaultBigSendBlockedIds,
  vaultBigxInit, vaultBigxOutHas, vaultBigxOutPut, vaultBigxOutGet, vaultBigxOutDrop, vaultBigxInIndex, vaultBigxInPutBlock, vaultBigxInGetBlock, vaultBigxInDrop,
  vaultSetMessageFields, vaultReplaceAttachment, vaultSaveFile, vaultLoadFile, vaultHdFileName,
  vaultDeleteMessage, vaultBlankMessage, vaultFlushAll
} from './vault/vault_manager.js';
import { initBLEInterface } from './ui/ble_interface.js';
import { initAppLock, securitySectionHtml, renderSecuritySection, lockEnabled } from './ui/app_lock.js';
import { applyStaticI18n, syncNativeLang, t as _t } from './ui/i18n.js'; // #132 idioma: traducir el HTML estático + textos de estado
import { initPerf } from './ui/perf.js';
import { initPress } from './ui/press.js'; // NEXO Touch (build 2968): un motor de presionado + háptica del sistema
import { batteryGuard } from './ui/battery_prompt.js';
import { welcomeGuide } from './ui/welcome_guide.js'; // #dueño 05-11: guía de bienvenida la primera vez (antes del aviso de batería)
import { nameGate, loadDisplayName, applyDisplayName } from './ui/display_name.js'; // #dueño 06-11: nombre fijo (pedido 1 vez, no se cambia)
import { createNotifier } from './ui/notify.js';
import { isPreviewHidden, loadHidePreview } from './ui/chat_hide_preview.js';
import { loadApariencia } from './ui/apariencia.js'; // cola 33: color de burbujas y letra elegidos en Ajustes → Apariencia
import { isMuted, loadMuted } from './ui/chat_mute.js'; // 3219: silenciar un chat o grupo
import { loadPins } from './ui/chat_pin.js'; // 3219: mensajes fijados arriba del chat
import { installChatMenu } from './ui/chat_menu.js'; // 3219: opciones del chat (tocar el círculo de la cabecera)
import { initE2E } from './vault/e2e_crypto.js';
import { ratchetInit, ratchetSafetyNumber, ratchetPeerBundle, ratchetSessionPq } from './vault/e2e_ratchet.js';
import { safetyQrPayload, checkSafetyQr, showSafetyQr, openQrScanner } from './ui/qr_verify.js';
import { PREVIEW_MAX_SIDE, PREVIEW_MAX_SECONDS, HD_DIRECT_MAX_BYTES, HD_MAX_SIDE, HD_REENCODE_BPS, _videoFormat, _blobToB64, _makeVideoPreview, _previewAudioTracks, _b64ToBlob, _makeVideoThumb } from './ui/video_tools.js';
import { _extOf, _compressImageBase64, _fmtTime, _readFileBase64, _isPdf, _MIME_BY_EXT, _mimeOf, _pdfThumb, _FILE_ICONS, _fileIcon, _fmtSize } from './ui/file_tools.js';
import { groupAttachment, isGroupId, parseGroupEnvelope } from './ui/groups.js';
import { isGroupWire, startGroupMedia } from './ui/group_media.js';
import { avatarInit, paintAvatar, sendAvatarTo } from './ui/avatar.js';
import { _getGradientForUUID, _getInitials } from './ui/ble_helpers.js';
import { usageInit } from './ui/usage_stats.js'; // 2989: resumen diario de uso (solo números)
import { updaterInit } from './ui/updater.js'; // 2986: actualizador automático del APK de probadores
import { autoDiagInit, autoDiagReceived } from './ui/autodiag.js'; // 2974: diagnóstico automático al desarrollador
import { resyncInit } from './ui/resync.js'; // 3069: desatasco automático del cifrado
import { profileInit } from './ui/profile_data.js';
import { profileShareInit, sendProfileTo } from './ui/profile_share.js';
import { psiInit } from './ui/psi.js';
import { gameStatsInit } from './ui/game_stats.js';
import { wallpaperInit, wallpaperUse, installWallpaperGesture, setListWallpaper, clearListWallpaper, setChatWallpaper, clearChatWallpaper, wallpaperRefresh, wallpaperApplied, setChatWallpaperFor, clearChatWallpaperFor, chatWallpaperFor, hasChatWallpaper, hasChatWallpaperFor, shareChatWallpaper, applyChatWallpaper } from './ui/wallpaper.js';
import { estadosInit, sendStatusTo } from './ui/estados.js';
import { loadBlocked } from './ui/bloqueo.js'; // bloquear contacto (24-11)
import { parseCallSignal } from './ui/calls.js';
import { parseGroupCallSignal } from './ui/group_call.js';
import { installCallsUi } from './ui/calls_ui.js';
import { installGroupCallUi } from './ui/groupcall_ui.js';
import { installCalls2Ui } from './ui/calls2_ui.js';
import { installSearchUi } from './ui/search_ui.js';
import './ui/keyboard_media.js'; // 3035: GIF y stickers del teclado (NexoWebView.java)
import { groupSubtitle, installGroupButton, openGroupChat, openGroupMenu, sendGroupText } from './ui/groups_ui.js';
import { _STATUS_RANK, _statusRank, _canUpgradeStatus, _getDomMessageStatus, _normId, _getCurrentContactId, _chatKind, _plainText, _myNexoId, _contactName, _peerUnderstands, _cut, _msgSummary, _findMessage, _PREVIEW_BY_TYPE } from './ui/chat_format.js';
import { cameraUse, _cameraActiveStream, _cameraPreviewMode, _cameraPreviewRecording, _cameraPreviewMediaRecorder, _cameraPreviewVideoChunks, _cameraVideoStartTime, _cameraTimer, _cameraTorchOn, _cameraReview, _showCameraPreviewOverlay, _hideCameraPreviewOverlay, _photoTarget, _videoLimitSec, _updateCameraPreviewUI, _cameraError, _setupVideoRecorder, _startCameraPreview, _cameraStartToken, _stopCameraPreview, _flipCamera, _setCameraMode, _toggleCameraMode, _toggleTorch, _startCameraTimer, _stopCameraTimer, _capturePhoto, _handleCameraCapture, _resumeBleFromCamera, _pauseBleForCamera, _showReview, _closeReview, _retakeReview, _sendReview, _bindCameraPreviewHandlers, _handleCamera, CAMERA_HD_BPS } from './ui/camera.js';
import { _diagnosticText } from './ui/diag.js';
if (typeof window !== 'undefined') window.NEXO_diagText = function() { return _diagnosticText(); }; // 3081: para las pruebas (velocidad.js)
import { profileUse, installProfileButton } from './ui/profile.js';
import { _wdReach, _getAttachmentPlugins, _toggleAttachMenu, _closeAttachMenu, _releaseMedia, _showPermissionError, _showInfoToast, _hideInfoToast } from './ui/ui_bits.js';
import { shareContactsUse, _contactsStyles, _handleShareContacts, _renderContactCard } from './ui/share_contacts.js';
shareContactsUse({ /* [pegamento] */ _sendAttachment: _sendAttachment });
import { locationUse, _lastLocationSent, _LOCATION_DEBOUNCE_MS, _isGettingLocation, _handleLocation, _sendLocation, _browserPosition } from './ui/location.js';
locationUse({ /* [pegamento] */ _sendAttachment: _sendAttachment });
import { cobroUse, _handleCobro, _sendCobro } from './ui/cobro.js';
cobroUse({ /* [pegamento] */ _sendAttachment: _sendAttachment });
import { voiceUse, _mediaRecorder, _audioChunks, _isRecording, _voiceStartTime, _voiceTimerInterval, _handleVoiceToggle, _updateMicIcon } from './ui/voice.js';
import { chatActionsUse, _renderedMessageIds, _replyTo, DELETE_ALL_MS, _fillTextBubble, _scrollToMessage, _setupMessageActions, _openMsgMenu, _startReply, _cancelReply, _renderReplyBar, _copyText, _openForwardSheet, _forwardTo, _refreshChatPreview, _deleteForMe, _deleteForAll, _rerenderBlank, _applyChatAction } from './ui/chat_actions.js';
import { _objectURLRegistry, MAX_BLE_B64_BYTES, MAX_BLE_FILE_BYTES, WD_MAX_B64_BYTES, _maxB64For, _tooBigMessage, _cleanupObjectURLs } from './ui/media_limits.js';
import { videoSendUse, MAX_HD_B64_BYTES, _videoTimes, _hdOutbox, _hdInFlight, _showOwnPreparing, _sendVideo, _videoViaBle, _registerHd, _startHd, _onHdSent, _resumeHdForMsg, _resumeHdTransfers, _applyHdUpgrade, _swapVideoInBubble, _setHdBadge } from './ui/video_send.js';
import { _renderE2EBanner, _onSafetyQr } from './ui/e2e_banner.js';
import { _msgContactMap, readReceiptsOn } from './ui/chat_state.js';
import { _closeFullscreenMedia, _openFullscreenMedia, _thumbsInProgress, _buildFileCard, _openingFile, _openAttachmentFile, _ensurePdfThumb, _ensureVideoThumb } from './ui/file_card.js';
import { _clearMessageContainer, _setupBackButton, _setupSwipeBack, _chatNavToken, _doChatBack } from './ui/chat_nav.js';
import { pickersUse, _pendingPicker, _pickFile, _readFailed, _handleGallery, _handleFile, _reviewAndSendPhotos } from './ui/pickers.js';
import { _renderedMessageCount, _getContactStorageKey, _saveMessageToStorage, _updateMessageStorageStatus, HISTORY_PAGE, _olderMessages, _olderContactId, _loadingOlder, _suppressAutoScroll, _olderArmed, _bindOlderMessagesScroll, _loadOlderMessages, _loadPersistedMessages, _scrollPending, _scheduleScrollToBottom, _renderMessage, _removeIncomingPlaceholder, _hdProgress, _onFileProgress, _updateMessageStatus } from './ui/render.js';
import { _waitForBLEReady, _sendAttachment, _sendFileFor, _sendTextTo, _noteContactMessage, _sendBigFile, _photoFast, _photoBridgeOnly } from './ui/send.js';
import { appSetupUse, _bindAttachmentHandlers, _showPermissionOverlay, _hidePermissionOverlay, _ensureDOMStructure, _fixLogoPath, _setupMessageInput, _setupVaultToggle, _setupChatHeader, _setupKeyboardShortcuts, _setupJumpButton, _setupFABButton, _toggleVaultUI, _focusInput, _forceHideSplash, _enableFallbackMode } from './ui/app_setup.js';
import { _handleIncomingMessage, initializeNexoApp } from './main_chats.js'; // reestructuración 15-11
import { bgLimitInstall } from './ui/bg_limit.js'; // 3247: NEXO limitado por el ahorro de batería
try { bgLimitInstall(); } catch (e) {}
import { phoneSleepInstall } from './ui/phone_sleep.js'; // COLA 22: «tu teléfono duerme a NEXO»
try { phoneSleepInstall(); } catch (e) {}
import { silencedInstall } from './ui/silenced.js'; // COLA 22: «tu teléfono silencia a NEXO» (canal de avisos apagado, No molestar)
try { silencedInstall(); } catch (e) {}
appSetupUse({ /* [pegamento] */ initializeNexoApp: initializeNexoApp });
pickersUse({ /* [pegamento] */ _sendAttachment: _sendAttachment, _sendBigFile: _sendBigFile });
videoSendUse({ /* [pegamento] */ _handleIncomingMessage: _handleIncomingMessage, _sendAttachment: _sendAttachment, _sendFileFor: _sendFileFor, _updateMessageStatus: _updateMessageStatus, _updateMessageStorageStatus: _updateMessageStorageStatus });
chatActionsUse({ /* [pegamento] */ _renderMessage: _renderMessage, _sendAttachment: _sendAttachment, _sendTextTo: _sendTextTo });
voiceUse({ /* [pegamento] */ _sendAttachment: _sendAttachment });
profileUse({ /* [pegamento] */ _showInfoToast: _showInfoToast });
wallpaperUse({ /* [pegamento] */ _showInfoToast: _showInfoToast }); // ronda 2890: aviso del fondo por chat
cameraUse({ /* [pegamento] */ _wdReach: _wdReach, _photoFast: _photoFast, _photoBridgeOnly: _photoBridgeOnly, _waitForBLEReady: _waitForBLEReady, _sendAttachment: _sendAttachment, _closeAttachMenu: _closeAttachMenu, _releaseMedia: _releaseMedia, _handleGallery: _handleGallery, _sendVideo: _sendVideo, _reviewAndSendPhotos: _reviewAndSendPhotos });

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
initPress(); // NEXO Touch (build 2968, dueño 09-11): hundirse/onda/pulso + tick háptico + áreas de toque
initPerf(); // ronda 2808: medición de rendimiento (pasiva: escucha eventos ya existentes)
// v9.9.52: mensajes sin leer y notificaciones (todas las vías de llegada pasan por _handleIncomingMessage)
loadHidePreview(); // opción por chat «Ocultar el texto en los avisos»
loadApariencia(); loadMuted(); loadPins(); // 3219: chats silenciados (también para la parte nativa) y mensajes fijados
loadBlocked(); // bloqueo (24-11): la lista también para la parte nativa (app cerrada o congelada)
// Al DESBLOQUEAR, se le manda otra vez lo mío (foto, estados, datos) y el saludo de internet (vuelve a verme en línea)
window.addEventListener('nexo:block', function(e) {
  var d = (e && e.detail) || {};
  if (!d.id || d.blocked) return;
  try { sendAvatarTo(d.id, true); } catch (er) {}
  try { sendStatusTo(d.id, true); } catch (er) {}
  try { sendProfileTo(d.id); } catch (er) {}
  try { var bi = window.bleInterface; if (bi && bi.net && typeof bi.net.probe === 'function') bi.net.probe(d.id, 'Desbloqueado'); } catch (er) {}
});
var _notifier = createNotifier({
  ble: function() { return window.bleInterface || (window.NEXO && window.NEXO.app && window.NEXO.app.bleInterface) || null; },
  // El chat abierto según ble_interface (lo pone openChat y lo quita cualquier cierre del chat)
  currentChat: function() { var b = window.bleInterface || (window.NEXO && window.NEXO.app && window.NEXO.app.bleInterface); return b ? b._activeChatDeviceId : _getCurrentContactId(); },
  hidePreview: function(cid) { return lockEnabled() || isPreviewHidden(cid); }, // + opción por chat «Ocultar el texto en los avisos»
  muted: function(cid) { var gs = window.bleInterface && window.bleInterface.groups; return isMuted(cid) || !!(gs && typeof gs.isInvited === 'function' && gs.isInvited(cid)); }, // + invitación a grupo sin aceptar (24-11) // 3219: chat silenciado: sin aviso (las llamadas van aparte y sí suenan)
  sendRead: function(nexoId, msgId) {
    // Build 2835 (pedido del dueño): si apagaste las confirmaciones de lectura en Ajustes, no se manda el acuse (el
    // otro no ve el ✓✓ azul). El "entregado" gris no se toca.
    if (!readReceiptsOn()) return;
    if (/#cita$/.test(String(msgId || ''))) return; // 3004: la tarjeta de cita no se confirma como leída (ver incoming)
    // Ronda 2758: en un grupo el "leído" va a quien escribió el mensaje
    var gs = window.bleInterface && window.bleInterface.groups;
    if (gs && gs.isGroup(nexoId)) { nexoId = gs.senderOf(msgId); if (!nexoId) return; }
    setTimeout(function() { window.dispatchEvent(new CustomEvent('nexo:ble:sendReadReceipt', { detail: { nexoId: nexoId, msgId: msgId } })); }, 400);
  }
});
window.NEXO_notifier = _notifier; // 3069: para el diagnóstico y las pruebas (no leídos por chat)
// 3073 (dueño 14-11): despertar al otro ANTES de mandar algo pesado (al abrir «adjuntar» o al empezar a grabar un audio). En un
// grupo, a cada miembro (el toque tiene freno de 8 s por contacto).
window.NEXO_prewake = function(why) {
  try {
    var bi = window.bleInterface, cid = _getCurrentContactId();
    if (!bi || !cid || typeof bi._wakeSleepingPeer !== 'function') return;
    var gs = bi.groups;
    if (gs && gs.isGroup && gs.isGroup(cid)) {
      var g = gs.get(cid), me = _normId(bi.localNexoId);
      ((g && g.members) || []).forEach(function(m) { if (_normId(m) !== me) bi._wakeSleepingPeer(m, why); });
      return;
    }
    bi._wakeSleepingPeer(cid, why);
  } catch (e) {}
};

initE2E().then(function() { return ratchetInit(); }).catch(function(e) { console.warn('[E2E] init:', e && e.message); });

// Ronda 2826 (pedido del dueño 29-10): el transporte del chat (Wi-Fi / Internet / Bluetooth) se muestra como SÍMBOLO
// en vez de la palabra — se ve mejor y ocupa menos, dejando sitio al nombre. Iconos dibujados (SVG, color del subtítulo
// por currentColor; iguales en claro/oscuro). El SVG es SIEMPRE estático (nunca lleva datos del remitente) → seguro.
var _VIA_ICON = {
  wifi: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M4 11a13 13 0 0 1 16 0"/><path d="M7.5 14.5a8 8 0 0 1 9 0"/><circle cx="12" cy="18.6" r="1.1" fill="currentColor" stroke="none"/></svg>',
  internet: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c3 2.5 3 14.5 0 17M12 3.5c-3 2.5-3 14.5 0 17"/></svg>',
  bluetooth: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"><path d="M8 8l8 8-4 3V5l4 3-8 8"/></svg>'
};
// 24-11 (dueño): Jump (de teléfono en teléfono) y el internet que presta un NEXO cercano por Bluetooth también con su símbolo (provisionales:
// el dueño elige). Jump = tres puntos unidos por saltos; prestado = Bluetooth con un globo pequeño.
_VIA_ICON.jump = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="4" cy="17" r="2"/><circle cx="12" cy="17" r="2"/><circle cx="20" cy="17" r="2"/><path d="M5 13.5a4 4 0 0 1 6 0M13 13.5a4 4 0 0 1 6 0"/><path d="M17.5 11.5l1.5 2-2.4.4"/></svg>';
_VIA_ICON.gw = '<svg viewBox="0 0 30 24" width="16" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"><path d="M4 8l8 8-4 3V5l4 3-8 8"/><circle cx="22" cy="12" r="6.5" stroke-width="1.7"/><path d="M15.5 12h13M22 5.5c2 2 2 11 0 13M22 5.5c-2 2-2 11 0 13" stroke-width="1.4"/></svg>';
var _VIA_WORD = { wifi: 'Wi-Fi', internet: 'Internet', bluetooth: 'Bluetooth', jump: 'Jump', gw: 'Internet · por puente' };
// Subtítulo del chat 1:1: {ico, note, html, text}. ico = el símbolo del camino (va entre la foto y el nombre, 24-11); note = lo que queda
// escrito debajo del nombre (señal débil, «Conectando…»); sin «En línea» (dueño 24-11: el símbolo ya lo dice). text = en palabras
// (tooltip accesible). html = ico + note (gancho de pruebas). mtu<60 por Bluetooth marca «señal débil» (ronda 2798).
function _subtitleFor(via, mtu) {
  // P2 (dueño 01-11): contacto dormido al que acabamos de mandar el «toque» FCM al abrir el chat; mientras llega su presencia, «Conectando…»
  if (via === 'waking') { var cn = _t('st_connecting', 'Conectando…'); return { ico: '', note: cn, html: cn, text: cn }; }
  if (!_VIA_ICON[via]) return { ico: '', note: '', html: '', text: '' };
  var weak = via === 'bluetooth' && mtu > 0 && mtu < 60, weakTxt = _t('st_weak_signal', 'señal débil');
  var ico = '<span class="via-ico" role="img" aria-label="' + _VIA_WORD[via] + '">' + _VIA_ICON[via] + '</span>';
  var note = weak ? '<span class="via-weak">⚠ ' + weakTxt + '</span>' : '';
  return { ico: ico, note: note, html: ico + note, text: _VIA_WORD[via] + (weak ? ' · ' + weakTxt : '') };
}
try { if (typeof window !== 'undefined') window.__nexoViaSubtitle = _subtitleFor; } catch (e) {} // gancho de pruebas (puro)

// v9.9.48: por dónde va el contacto del chat abierto (Wi-Fi de la misma red, Bluetooth, Jump, internet o internet prestado)
function _viaSlot(html, text) {
  var hd = document.getElementById('chat-header');
  var el = document.getElementById('chat-via-ico');
  if (!html) { if (el) el.remove(); if (hd) hd.classList.remove('has-via'); return; }
  if (!el && hd) { el = document.createElement('div'); el.id = 'chat-via-ico'; hd.appendChild(el); }
  if (!el) return;
  el.innerHTML = html; el.title = text || ''; // SVG estático (sin datos del remitente)
  hd.classList.add('has-via');
}
function _refreshLinkSubtitle() {
  var sub = document.getElementById('chat-contact-subtitle');
  var bi = window.bleInterface, cid = _getCurrentContactId();
  if (sub && bi && bi.groups && bi.groups.isGroup(cid)) { _viaSlot(''); sub.textContent = groupSubtitle(bi.groups.get(cid)); return; } // ronda 2758
  if (!sub || !bi || typeof bi.linkOf !== 'function' || !cid) { _viaSlot(''); return; }
  var via = bi.linkOf(cid);
  // P2: sin enlace todavía pero despertando al contacto → «Conectando…» (al formarse el enlace, el via real manda)
  if (via === 'none' && typeof bi.isWaking === 'function' && bi.isWaking(cid)) via = 'waking';
  if (via === 'internet' && bi.net && typeof bi.net.gwOnly === 'function' && bi.net.gwOnly()) via = 'gw'; // parte 3 del puente
  var mtu = (via === 'bluetooth' && typeof bi.getMtu === 'function' && bi._activeChatDeviceId) ? bi.getMtu(bi._activeChatDeviceId) : 0;
  var r = _subtitleFor(via, mtu);
  _viaSlot(r.ico, r.text);
  sub.innerHTML = r.note;       // solo texto fijo (sin datos del remitente)
  sub.title = r.text;           // tooltip accesible con la palabra completa (Wi-Fi/Internet/Bluetooth)
}
// Ronda 2826 (pedido del dueño): un nombre de contacto largo se parte en DOS líneas en vez de cortarse. El nombre es un
// <textarea> (editable); aquí se ajusta su alto real a 1–2 líneas (el CSS lo acota a 2). Se llama al abrir el chat y al
// escribir.
function _fitContactName() {
  try {
    var el = document.getElementById('chat-contact-name');
    if (!el || el.tagName !== 'TEXTAREA') return;
    var cs = window.getComputedStyle ? getComputedStyle(el) : null;
    // 22-11 (cola 32): con letra al 160 % en 320 px, «Maximiliano» solo ya no cabía en 2 líneas y se cortaba. Si a 2 líneas no cabe,
    // se baja el tamaño de letra del nombre de 1 en 1 px (mínimo 13 px, legible) hasta que quepa SIN partir ninguna palabra; solo si una
    // palabra no cabe ni al mínimo se vuelve a partir por letras (CSS: overflow-wrap:anywhere). Antes de medir se deshace lo que puso
    // la llamada anterior (si el tamaño en línea sigue siendo el nuestro), para que al volver la letra normal el nombre recupere su tamaño.
    if (el.__fitSize != null) {
      if (el.style.getPropertyValue('font-size') === el.__fitSize) {
        if (el.__fitOrig) el.style.setProperty('font-size', el.__fitOrig[0], el.__fitOrig[1]); else el.style.removeProperty('font-size');
      }
      el.style.removeProperty('overflow-wrap'); el.__fitSize = null; el.__fitOrig = null;
    }
    el.style.height = 'auto';
    // 21-11 (Redmi Note 11 Pro 5G con letra grande): el tope era 48 px fijos, pensado para letra normal (2 × 23 px); con la
    // letra del sistema más grande cada línea mide 30–37 px y la segunda salía cortada a la mitad. El tope se mide ahora con
    // la línea REAL del teléfono: 2 líneas completas + relleno.
    var medir = function() {
      var c = window.getComputedStyle ? getComputedStyle(el) : null;
      var lh = c ? parseFloat(c.lineHeight) : 0;
      if (!(lh > 0)) lh = (c ? parseFloat(c.fontSize) * 1.15 : 0) || 23;
      var pad = c ? (parseFloat(c.paddingTop) || 0) + (parseFloat(c.paddingBottom) || 0) : 0;
      return { lh: lh, pad: pad, max: Math.ceil(2 * lh + pad) };
    };
    var m = medir();
    var h = el.scrollHeight || 0;
    var cabe = function() { var q = medir(); return el.scrollHeight <= q.max + 1 && el.scrollWidth <= el.clientWidth + 1; };
    var size = cs ? parseFloat(cs.fontSize) : 0;
    if (h && size > 13 && el.value && el.clientWidth > 0) {
      el.__fitOrig = [el.style.getPropertyValue('font-size'), el.style.getPropertyPriority('font-size')];
      el.style.setProperty('overflow-wrap', 'normal', 'important');   // medir sin partir palabras
      el.style.height = 'auto';
      if (!cabe()) {
        var s0 = size;
        while (size > 13) {
          size = Math.max(13, size - 1);
          el.style.setProperty('font-size', size + 'px', 'important'); el.style.height = 'auto';
          if (cabe()) break;
        }
        if (!cabe()) el.style.removeProperty('overflow-wrap');          // ni a 13 px cabe una palabra: se parte por letras
        el.__fitSize = el.style.getPropertyValue('font-size');
      } else { el.style.removeProperty('overflow-wrap'); el.__fitOrig = null; }
      el.style.height = 'auto';
      m = medir(); h = el.scrollHeight || 0;
    }
    el.style.height = (h ? Math.min(h, m.max) : Math.ceil(m.lh + m.pad)) + 'px';
  } catch (e) {}
}
window.addEventListener('nexo:ble:closeChat', function() { _viaSlot(''); }); // 24-11: el símbolo del camino se va con el chat
['nexo:ble:linkChange', 'nexo:ble:deviceDisconnected', 'nexo:ble:openChat'].forEach(function(ev) {
  window.addEventListener(ev, function() { setTimeout(function() { _refreshLinkSubtitle(); _fitContactName(); }, 50); });
});
// 3140 (dueño 16-11: «como mi pantalla de Contactos»): el círculo de color del contacto (o del grupo) en la cabecera del chat,
// el mismo de la lista (degradado según el NEXO ID, iniciales y, si tiene, su foto; un grupo nunca lleva foto)
var _chatAvId = '';
function _paintChatAvatar(d) {
  try {
    var el = document.getElementById('chat-contact-avatar');
    if (!el) return;
    d = d || {};
    var c = d.contact || {};
    var id = _normId(d.contactId || c.nexoId || c.deviceUUID || '');
    var name = d.name || c.name || '';
    var group = d.transport === 'group' || (id && isGroupId(id));
    _chatAvId = group ? '' : id;
    el.className = 'ble-contact-avatar ' + _getGradientForUUID(id || String(name));
    el.style.backgroundImage = '';
    el.textContent = _getInitials(name || id);
    if (!group && id) paintAvatar(el, id);
    var gph = group && window.NEXO_groupPhoto ? window.NEXO_groupPhoto(id) : null; // 22-11 (COLA 4b, G6): foto del grupo
    if (gph) { el.style.backgroundImage = 'url("' + gph + '")'; el.style.backgroundSize = 'cover'; el.textContent = ''; }
  } catch (e) {}
}
window.addEventListener('nexo:ble:openChat', function(e) { _paintChatAvatar(e && e.detail); });
// Si cambia la foto del contacto del chat abierto, se repinta
window.addEventListener('nexo:avatar', function(e) {
  var nx = _normId(e && e.detail && e.detail.nx);
  if (!nx || nx !== _chatAvId) return;
  var n = document.getElementById('chat-contact-name');
  _paintChatAvatar({ contactId: nx, name: (n && n.value) || '' });
});
function installContactNameAutosize() {
  var n = document.getElementById('chat-contact-name');
  if (!n) return;
  n.addEventListener('input', _fitContactName);
  _fitContactName();
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', installContactNameAutosize); else installContactNameAutosize();

// Ronda 2758: chats de grupo (groups.js / groups_ui.js)
// Ronda 2765: una vez, pedir que el ahorro de batería no congele NEXO (el Vivo del dueño la congelaba y los avisos
// llegaban tarde); el resto de ajustes, en Perfil → Avisos con la pantalla apagada
function _askBackgroundOnce() {
  var pl = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.NexoBLE;
  if (!pl || typeof pl.alertSettings !== 'function') return;
  pl.alertSettings().then(function(r) {
    if (!r) return; // 3153: con las notificaciones denegadas también se pide lo de la batería (Honor: ambas faltaban y no salía nada)
    // Lo fundamental para recibir en segundo plano: que el ahorro de batería no congele NEXO. Ronda 2811 (pedido del
    // dueño): ya no se salta en mudo al ajuste del sistema, sino una pantalla clara COMO UN PERMISO (battery_prompt.js)
    // que explica por qué y, en los teléfonos agresivos (Vivo, Samsung…), guía además al inicio automático.
    if (r.battery === false) {
      console.log('[NOTIF] Se muestra el aviso de ahorro de batería (como un permiso)');
      batteryGuard({ plugin: pl, settings: r });
      return; // una sola pantalla de ajustes por arranque; lo que falte se pide en el siguiente
    }
    // Batería ya exenta: que no vuelva a salir el aviso nunca.
    try { if (localStorage.getItem('nexo_bat_prompt_done') !== '1') localStorage.setItem('nexo_bat_prompt_done', '1'); } catch (e) {}
    // Ronda 2784 (#81): pantalla completa de llamadas/videollamadas en Android 14 — se pide una vez si no está concedida
    // (sin ella la llamada entra solo como aviso, no con los botones Contestar/Rechazar a pantalla completa). Como la
    // batería ya suele estar concedida (como en el teléfono del dueño), aquí es donde entra este aviso.
    var fsAsked = false; try { fsAsked = localStorage.getItem('nexo_fs_asked') === '1'; } catch (e) {}
    if (r.fullScreen === false && !fsAsked) {
      try { localStorage.setItem('nexo_fs_asked', '1'); } catch (e) {}
      console.log('[NOTIF] Se pide el permiso de pantalla completa para llamadas');
      pl.openAlertSetting({ what: 'fullScreen' }).catch(function() {});
    }
  }).catch(function() {});
}
window.NEXO_openGroupChat = openGroupChat;
window.NEXO_sendGroupText = sendGroupText;
window.NEXO_openGroupMenu = openGroupMenu;
window.addEventListener('nexo:groups', function() {
  var b = window.bleInterface;
  if (b && typeof b.renderContactsList === 'function') b.renderContactsList();
  _refreshLinkSubtitle();
});
// 3067/3069: desatasco automático del cifrado (avisar al otro, pedir y reenviar lo que no se pudo leer): resync.js
resyncInit();
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', installGroupButton); else installGroupButton();
// Ronda 2759: botón 👤 (Perfil) en la cabecera
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', installProfileButton); else installProfileButton();
// ronda 2890: botón 🖼️ en la cabecera del chat (fondo por chat, opción A)
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', installWallpaperGesture); else installWallpaperGesture();
// Ronda 2758: llamadas de voz (calls.js / calls_ui.js)
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', installCallsUi); else installCallsUi();
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', installGroupCallUi); else installGroupCallUi();
// #220 fase 2 (dueño 15-11): la segunda llamada 1-a-1 a la vez (calls2_ui.js)
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', installCalls2Ui); else installCalls2Ui();
// Buscar dentro del chat (lupa en la cabecera, barra debajo): rápido de A_LA_PAR, pedido del dueño
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', installSearchUi); else installSearchUi();
// 3219: opciones del chat al tocar el círculo de la cabecera (buscar, destacados, silenciar) y el altavoz tachado
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', installChatMenu); else installChatMenu();
// #132 idioma: traducir el HTML estático marcado con data-i18n (pestañas, cámara, placeholders…). Al cambiar idioma la
// app recarga, así que basta con aplicarlo al arrancar.
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function() { applyStaticI18n(); }); else applyStaticI18n();
try { syncNativeLang(); } catch (e) {} // 3122: avisos del teléfono en el idioma de la app

window.vaultSaveContact = vaultSaveContact;
// ronda 2894 (auditoría): expuestos para tests/sim/vaultdurable.js (durabilidad del vault)
window.vaultSaveFile = vaultSaveFile; window.vaultLoadFile = vaultLoadFile; window.vaultFlushAll = vaultFlushAll;
// FIX v9.9.29: ble_interface guarda los contactos con window.vaultSaveContacts; no estaba expuesto y
// el último mensaje / no leídos nunca llegaban a disco
window.vaultSaveContacts = vaultSaveContacts;
window.vaultLoadMessages = vaultLoadMessages;
window.vaultLoadRecent = vaultLoadRecent;
// ronda 2889: fondo de pantalla (lo usa Ajustes y el simulador tests/sim/fondo.js)
window.setListWallpaper = setListWallpaper; window.clearListWallpaper = clearListWallpaper;
window.setChatWallpaper = setChatWallpaper; window.clearChatWallpaper = clearChatWallpaper; window.wallpaperRefresh = wallpaperRefresh;
window.wallpaperApplied = wallpaperApplied;
// ronda 2890: fondo por chat concreto + compartir (lo usa tests/sim/fondo2.js)
window.setChatWallpaperFor = setChatWallpaperFor; window.clearChatWallpaperFor = clearChatWallpaperFor;
window.chatWallpaperFor = chatWallpaperFor; window.hasChatWallpaperFor = hasChatWallpaperFor;
window.shareChatWallpaper = shareChatWallpaper; window.applyChatWallpaper = applyChatWallpaper;
window.hasChatWallpaper = hasChatWallpaper; window.hasChatWallpaperFor = hasChatWallpaperFor;
window.vaultSaveMessages = vaultSaveMessages;
window.vaultAppendMessage = vaultAppendMessage;
window.vaultDeleteMessage = vaultDeleteMessage; // gancho de pruebas (tests/sim/chatthumbs.js)
window.vaultUpdateMessageStatus = vaultUpdateMessageStatus;
window.vaultPatchMessage = vaultPatchMessage; // 3038
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
window.vaultBigSendBegin = vaultBigSendBegin;   // 3004: freno de bucle de arranque con archivos grandes
// 3007 (dueño 11-11, «(a)»): archivo grande por internet que sigue donde iba (trozos en el teléfono, ver vault_manager.js)
window.vaultBigxOutHas = vaultBigxOutHas; window.vaultBigxOutPut = vaultBigxOutPut; window.vaultBigxOutGet = vaultBigxOutGet; window.vaultBigxOutDrop = vaultBigxOutDrop;
window.vaultBigxInIndex = vaultBigxInIndex; window.vaultBigxInPutBlock = vaultBigxInPutBlock; window.vaultBigxInGetBlock = vaultBigxInGetBlock; window.vaultBigxInDrop = vaultBigxInDrop;
try { vaultBigxInit().catch(function() {}); } catch (e) {}
window.vaultBigSendEnd = vaultBigSendEnd;
window.vaultBigSendBlockedIds = vaultBigSendBlockedIds;

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
window.NEXO_sendAttachment = _sendAttachment; // pruebas (tests/sim/once.js: foto de una vez)
if (typeof module !== 'undefined' && module && module.hot) module.hot.accept();
// Para main_chats.js (reestructuración 15-11)
export { _notifier, _autoScan, _refreshLinkSubtitle, _askBackgroundOnce, SAFETY_TIMEOUT };
