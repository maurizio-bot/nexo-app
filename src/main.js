/**
 * src/main.js - Punto de entrada NEXO v9.9.34-NEXO
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
  vaultSetMessageFields, vaultReplaceAttachment, vaultSaveFile, vaultLoadFile, vaultHdFileName
} from './vault/vault_manager.js';
import { initBLEInterface } from './ui/ble_interface.js';

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

// ===================== v9.9.32: registro de diagnóstico =====================
// Últimas líneas de la consola (también de la sesión anterior) para verlas en Perfil → Diagnóstico y
// copiarlas: lo que pasa en el teléfono real sin necesidad de un PC.
var DIAG_MAX = 800, DIAG_KEY_MAX = 700, DIAG_FILE = 'nexo_diag_log.txt';
var _diagLines = [], _diagKey = [], _diagDirty = false, _diagPrev = '';
// Eventos clave: se guardan aparte para que el detalle de una transferencia larga no los borre
var DIAG_KEY_RE = /\[VIDEO\]|\[ATTACH\]|\[CAMERA\]|sendFile|Reenvi|peerReady|Peer ready|App de vuelta|Re-búsqueda|desconect|Disconnect|GLOBAL TIMEOUT|Assembly timeout|Archivo recibido|^\S+ [WE] /;
(function() {
  function fmt(a) {
    if (typeof a === 'string') return a;
    if (a && a.message) return a.message;
    try { return JSON.stringify(a, function(k, v) { return (typeof v === 'string' && v.length > 120) ? v.substring(0, 120) + '…' : v; }); } catch (e) { return String(a); }
  }
  ['log', 'info', 'warn', 'error'].forEach(function(level) {
    var orig = console[level] ? console[level].bind(console) : function() {};
    console[level] = function() {
      try {
        var parts = [];
        for (var i = 0; i < arguments.length; i++) parts.push(fmt(arguments[i]));
        var d = new Date();
        var ts = ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2) + ':' + ('0' + d.getSeconds()).slice(-2) + '.' + ('00' + d.getMilliseconds()).slice(-3);
        var line = ts + (level === 'warn' ? ' W ' : level === 'error' ? ' E ' : ' ') + parts.join(' ').substring(0, 300);
        _diagLines.push(line);
        if (_diagLines.length > DIAG_MAX) _diagLines.splice(0, _diagLines.length - DIAG_MAX);
        if (DIAG_KEY_RE.test(line)) { _diagKey.push(line); if (_diagKey.length > DIAG_KEY_MAX) _diagKey.splice(0, _diagKey.length - DIAG_KEY_MAX); }
        _diagDirty = true;
      } catch (e) {}
      return orig.apply(null, arguments);
    };
  });
  window.addEventListener('error', function(e) { console.error('[ERROR] ' + (e && e.message) + ' @' + (e && e.filename) + ':' + (e && e.lineno)); });
  window.addEventListener('unhandledrejection', function(e) { console.warn('[PROMESA] ' + (e && e.reason && (e.reason.message || e.reason))); });
  function plugin() { return window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.NexoBLE; }
  setTimeout(function() {
    var pl = plugin();
    if (!pl || typeof pl.loadFromFile !== 'function') return;
    pl.loadFromFile({ filename: DIAG_FILE }).then(function(r) { if (r && r.exists && r.content) _diagPrev = r.content; }).catch(function() {});
  }, 500);
  setInterval(function() {
    var pl = plugin();
    if (!_diagDirty || !pl || typeof pl.saveToFile !== 'function') return;
    _diagDirty = false;
    pl.saveToFile({ filename: DIAG_FILE, content: _diagSessionText() }).catch(function() {});
  }, 20000);
})();

function _diagSessionText() {
  return '--- eventos clave ---\n' + _diagKey.join('\n') + '\n--- últimas líneas ---\n' + _diagLines.slice(-400).join('\n');
}

function _diagnosticText() {
  var bi = window.bleInterface || {};
  var head = 'NEXO diagnóstico ' + new Date().toISOString() + '\nNEXO ID: ' + (bi.localNexoId || '?') + '\nUA: ' + navigator.userAgent + '\n';
  return head + (_diagPrev ? '\n===== SESIÓN ANTERIOR =====\n' + _diagPrev + '\n' : '') +
    '\n===== SESIÓN ACTUAL =====\n' + _diagSessionText();
}

function _openProfileSheet() {
  var old = document.getElementById('nexo-profile-sheet');
  if (old) old.remove();
  var bi = window.bleInterface || {};
  var sheet = document.createElement('div');
  sheet.id = 'nexo-profile-sheet';
  sheet.style.cssText = 'position:fixed;inset:0;z-index:2147483646;background:#0a0a15;color:#fff;display:flex;flex-direction:column;padding:16px;box-sizing:border-box;font-family:inherit;';
  sheet.innerHTML = '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">' +
    '<div style="font-size:20px;font-weight:700;">Perfil</div><button id="nexo-profile-close" style="background:rgba(255,255,255,0.12);color:#fff;border:none;border-radius:18px;padding:8px 14px;font-size:14px;">Cerrar</button></div>' +
    '<div style="font-size:14px;opacity:0.85;margin-bottom:12px;">Mi NEXO ID: <b id="nexo-profile-id"></b></div>' +
    '<div style="font-size:16px;font-weight:600;margin:8px 0;">Diagnóstico</div>' +
    '<div style="font-size:12px;opacity:0.7;margin-bottom:8px;">Registro de lo que hace la app (incluye la sesión anterior). Cópialo y pégalo para revisar un fallo.</div>' +
    '<button id="nexo-diag-copy" style="background:linear-gradient(135deg,#00c8ff,#a855f7);color:#fff;border:none;border-radius:12px;padding:12px;font-size:15px;font-weight:600;margin-bottom:8px;">Copiar diagnóstico</button>' +
    '<textarea id="nexo-diag-text" readonly style="flex:1;width:100%;box-sizing:border-box;background:#000;color:#9fe;border:1px solid #234;border-radius:8px;font-size:10px;font-family:monospace;padding:8px;"></textarea>';
  document.body.appendChild(sheet);
  sheet.querySelector('#nexo-profile-id').textContent = bi.localNexoId || '?';
  var ta = sheet.querySelector('#nexo-diag-text');
  ta.value = _diagnosticText();
  ta.scrollTop = ta.scrollHeight;
  sheet.querySelector('#nexo-profile-close').onclick = function() { sheet.remove(); };
  sheet.querySelector('#nexo-diag-copy').onclick = function() {
    var btn = this, txt = ta.value;
    var ok = function() { btn.textContent = 'Copiado ✓'; setTimeout(function() { btn.textContent = 'Copiar diagnóstico'; }, 2000); };
    var fallback = function() { try { ta.focus(); ta.select(); document.execCommand('copy'); ok(); } catch (e) { btn.textContent = 'Selecciona el texto y cópialo'; } };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).then(ok).catch(fallback);
    else fallback();
  };
}
window.addEventListener('nexo:ui:profile', _openProfileSheet);
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

var _mediaRecorder = null;
var _lastLocationSent = 0;
var _LOCATION_DEBOUNCE_MS = 3000;
var _audioChunks = [];
var _isRecording = false;
var _voiceStartTime = 0;
var _voiceTimerInterval = null;
var _isGettingLocation = false;
var _cameraActiveStream = null;
var _cameraPreviewMode = 'photo';
var _cameraPreviewRecording = false;
var _cameraPreviewMediaRecorder = null;
var _cameraPreviewVideoChunks = [];
var _cameraVideoStartTime = 0;
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
function _tooBigMessage(bytes) {
  return 'Archivo demasiado grande para Bluetooth (' + (bytes / 1048576).toFixed(1) + ' MB). Máximo ~' + (MAX_BLE_FILE_BYTES / 1048576).toFixed(1) + ' MB.';
}

var _STATUS_RANK = {
  pending: 1, queued: 2, sending: 3, sent: 4, delivered: 5, read: 6, failed: 0
};

function _statusRank(s) {
  return _STATUS_RANK[s] || 0;
}

function _canUpgradeStatus(fromStatus, toStatus) {
  if (!toStatus) return false;
  if (toStatus === 'failed') return true; // failed siempre se permite (es terminal)
  if (!fromStatus) return true;
  // Nunca degradar delivered/read a sent/sending/pending/failed
  return _statusRank(toStatus) >= _statusRank(fromStatus);
}

function _getDomMessageStatus(messageId) {
  try {
    var el = document.querySelector('.msg-status[data-msg-id="' + messageId + '"]');
    if (!el) return null;
    var cls = el.className || '';
    var m = cls.match(/status-(pending|queued|sending|sent|delivered|read|failed)/);
    return m ? m[1] : null;
  } catch (e) { return null; }
}

function _compressImageBase64(base64, maxDim, quality) {
  return new Promise(function(resolve) {
    maxDim = maxDim || 480;
    quality = quality || 0.5;
    try {
      var img = new Image();
      img.onload = function() {
        try {
          var w = img.naturalWidth || img.width;
          var h = img.naturalHeight || img.height;
          var scale = 1;
          if (w > maxDim || h > maxDim) {
            scale = Math.min(maxDim / w, maxDim / h);
          }
          var tw = Math.max(1, Math.round(w * scale));
          var th = Math.max(1, Math.round(h * scale));
          var canvas = document.createElement('canvas');
          canvas.width = tw;
          canvas.height = th;
          var ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, tw, th);
          var out = canvas.toDataURL('image/jpeg', quality);
          var b64 = out.split(',')[1] || '';
          console.log('[ATTACH] compress image', w + 'x' + h, '->', tw + 'x' + th, 'b64', base64.length, '->', b64.length);
          resolve({ base64: b64, width: tw, height: th, format: 'jpeg' });
        } catch (e) {
          console.warn('[ATTACH] compress fail, using original', e.message);
          resolve({ base64: base64, width: 0, height: 0, format: 'jpeg' });
        }
      };
      img.onerror = function() {
        resolve({ base64: base64, width: 0, height: 0, format: 'jpeg' });
      };
      img.src = 'data:image/jpeg;base64,' + base64;
    } catch (e) {
      resolve({ base64: base64, width: 0, height: 0, format: 'jpeg' });
    }
  });
}
function _fmtTime(sec) {
  var m = Math.floor(sec / 60);
  var s = sec % 60;
  return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
}
function _normId(id) {
  return (id || '').toString().toLowerCase().trim();
}
function _getAttachmentPlugins() {
  var Plugins = window.Capacitor ? window.Capacitor.Plugins : null;
  return {
    Camera: Plugins ? Plugins.Camera : null,
    Filesystem: Plugins ? Plugins.Filesystem : null,
    Geolocation: Plugins ? Plugins.Geolocation : null
  };
}
function _getCurrentContactId() {
  if (window.NEXO.app && window.NEXO.app.activeContact) {
    return window.NEXO.app.activeContact.nexoId || window.NEXO.app.activeContact.id;
  }
  return null;
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
  var contactId = _getCurrentContactId();
  if (!contactId) {
    console.log('[ATTACH] No hay contacto seleccionado');
    return;
  }
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
  if ((type === 'video' || type === 'file' || type === 'image') && typeof payload === 'string' && payload.length > MAX_BLE_B64_BYTES) {
    console.warn('[ATTACH] Payload demasiado grande para BLE:', type, payload.length);
    localMsg.status = 'failed';
    _renderMessage(localMsg);
    try {
      if (window.vaultAppendMessage) vaultAppendMessage(contactId, localMsg);
    } catch (e) {}
    _showPermissionError(_tooBigMessage(Math.floor(payload.length * 3 / 4)));
    return;
  }

  // v9.9.30: el vídeo con HD se ve en el propio teléfono en calidad original (se envía la previa)
  var shownMsg = (opts && opts.displayPayload)
    ? Object.assign({}, localMsg, { attachmentPayload: opts.displayPayload, attachmentMeta: Object.assign({}, meta || {}, { mime: opts.displayMime || (meta && meta.mime) }), hdStatus: 'pending' })
    : localMsg;
  _renderMessage(shownMsg, true);
  try {
    if (window.vaultAppendMessage) vaultAppendMessage(contactId, localMsg);
  } catch (e) {}

  if ((type === 'image' || type === 'video' || type === 'file') && window.bleInterface && window.bleInterface.sendFile) {
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

        // No marcar failed ante errores transitorios / timeouts leves
        var isTransient =
          /timeout|abort|network|disconnected|not ready|busy|interrupted|temporary|no disponible/i.test(msg) ||
          (err && (err.code === 'BLE_BUSY' || err.code === 'PEER_ABSENT'));

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

function _toggleAttachMenu() {
  var menu = document.getElementById('attach-menu');
  if (menu) {
    menu.classList.toggle('hidden');
    menu.classList.toggle('visible');
  }
}

// ===================== v9.9.33: compartir contactos =====================
function _contactsStyles() {
  if (document.getElementById('nexo-share-styles')) return;
  var st = document.createElement('style');
  st.id = 'nexo-share-styles';
  st.textContent = '@keyframes nexoNewContact{0%,100%{background:rgba(0,200,255,0.05);box-shadow:none}50%{background:rgba(0,200,255,0.25);box-shadow:0 0 12px rgba(0,200,255,0.6)}}' +
    '.ble-contact-new{animation:nexoNewContact 1.2s ease-in-out infinite;border-radius:12px}' +
    '.nexo-pick-row{display:flex;align-items:center;gap:12px;padding:12px 8px;border-bottom:1px solid rgba(255,255,255,0.08);cursor:pointer}' +
    '.nexo-pick-row input{width:22px;height:22px;accent-color:#00c8ff;flex-shrink:0}' +
    '.nexo-card-row{display:flex;align-items:center;gap:8px;padding:6px 0;border-top:1px solid rgba(255,255,255,0.1)}';
  document.head.appendChild(st);
}

function _handleShareContacts() {
  _closeAttachMenu();
  _contactsStyles();
  var current = _normId(_getCurrentContactId());
  var all = (vaultLoadContacts() || []).filter(function(c) {
    var id = _normId(c.nexoId || c.deviceUUID);
    return id && id !== current && /^nx[0-9a-z]{8}$/.test(id);
  });
  var old = document.getElementById('nexo-share-sheet');
  if (old) old.remove();
  var sheet = document.createElement('div');
  sheet.id = 'nexo-share-sheet';
  sheet.style.cssText = 'position:fixed;inset:0;z-index:2147483646;background:#0a0a15;color:#fff;display:flex;flex-direction:column;padding:16px;box-sizing:border-box;';
  sheet.innerHTML = '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">' +
    '<button id="nexo-share-cancel" style="background:rgba(255,255,255,0.12);color:#fff;border:none;border-radius:18px;padding:8px 14px;font-size:14px;">Cancelar</button>' +
    '<div style="font-size:18px;font-weight:700;">Enviar contactos</div><div style="width:70px"></div></div>' +
    '<input id="nexo-share-search" placeholder="Buscar..." style="background:rgba(255,255,255,0.08);border:none;border-radius:10px;padding:10px 12px;color:#fff;font-size:15px;margin-bottom:8px;">' +
    '<div id="nexo-share-list" style="flex:1;overflow-y:auto;"></div>' +
    '<button id="nexo-share-send" disabled style="background:linear-gradient(135deg,#00c8ff,#a855f7);color:#fff;border:none;border-radius:12px;padding:14px;font-size:16px;font-weight:600;margin-top:8px;opacity:0.5;">Enviar</button>';
  document.body.appendChild(sheet);
  var listEl = sheet.querySelector('#nexo-share-list');
  var sendBtn = sheet.querySelector('#nexo-share-send');
  var chosen = {};
  function refreshBtn() {
    var n = Object.keys(chosen).length;
    sendBtn.disabled = n === 0;
    sendBtn.style.opacity = n ? '1' : '0.5';
    sendBtn.textContent = n ? 'Enviar (' + n + ')' : 'Enviar';
  }
  function render(filter) {
    listEl.innerHTML = '';
    var f = String(filter || '').toLowerCase();
    var shown = all.filter(function(c) { return !f || String(c.name || '').toLowerCase().indexOf(f) >= 0 || _normId(c.nexoId || c.deviceUUID).indexOf(f) >= 0; });
    if (!shown.length) {
      var empty = document.createElement('div');
      empty.style.cssText = 'opacity:0.6;padding:24px;text-align:center;';
      empty.textContent = all.length ? 'Sin resultados' : 'No tienes otros contactos para enviar';
      listEl.appendChild(empty);
    }
    shown.forEach(function(c) {
      var id = _normId(c.nexoId || c.deviceUUID);
      var row = document.createElement('label');
      row.className = 'nexo-pick-row';
      var cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = !!chosen[id];
      cb.onchange = function() { if (cb.checked) chosen[id] = { nexoId: id.toUpperCase(), name: c.name || '' }; else delete chosen[id]; refreshBtn(); };
      var txt = document.createElement('div');
      var nm = document.createElement('div'); nm.style.cssText = 'font-size:16px;'; nm.textContent = c.name || id.toUpperCase();
      var sub = document.createElement('div'); sub.style.cssText = 'font-size:12px;opacity:0.6;'; sub.textContent = id.toUpperCase();
      txt.appendChild(nm); txt.appendChild(sub);
      row.appendChild(cb); row.appendChild(txt);
      listEl.appendChild(row);
    });
  }
  render('');
  sheet.querySelector('#nexo-share-search').oninput = function() { render(this.value); };
  sheet.querySelector('#nexo-share-cancel').onclick = function() { sheet.remove(); };
  sendBtn.onclick = function() {
    var list = Object.keys(chosen).map(function(k) { return chosen[k]; });
    if (!list.length) return;
    sheet.remove();
    console.log('[ATTACH] Compartiendo ' + list.length + ' contacto(s)');
    _sendAttachment('contact', String(list.length), { contacts: list });
  };
}

// Tarjeta de contactos compartidos en la burbuja (todo como texto: los datos vienen de otro teléfono)
function _renderContactCard(container, meta, msg) {
  _contactsStyles();
  var list = Array.isArray(meta.contacts) ? meta.contacts.filter(function(c) { return c && /^NX[0-9A-Z]{8}$/i.test(String(c.nexoId || '')); }) : [];
  var card = document.createElement('div');
  card.className = 'contact-card';
  card.style.cssText = 'min-width:200px;max-width:260px;padding:10px 12px;';
  var title = document.createElement('div');
  title.style.cssText = 'font-weight:700;margin-bottom:6px;';
  title.textContent = '👤 ' + (list.length === 1 ? 'Contacto' : list.length + ' contactos');
  card.appendChild(title);
  var bi = window.bleInterface || (window.NEXO.app && window.NEXO.app.bleInterface);
  function isMine(id) { return (vaultLoadContacts() || []).some(function(c) { return _normId(c.nexoId || c.deviceUUID) === _normId(id); }); }
  function isMe(id) { return bi && _normId(bi.localNexoId) === _normId(id); }
  var rows = [];
  list.forEach(function(c) {
    var row = document.createElement('div');
    row.className = 'nexo-card-row';
    var txt = document.createElement('div');
    txt.style.cssText = 'flex:1;min-width:0;';
    var nm = document.createElement('div'); nm.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;'; nm.textContent = String(c.name || '').substring(0, 40) || String(c.nexoId).toUpperCase();
    var sub = document.createElement('div'); sub.style.cssText = 'font-size:11px;opacity:0.6;'; sub.textContent = String(c.nexoId).toUpperCase();
    txt.appendChild(nm); txt.appendChild(sub);
    var go = document.createElement('button');
    go.className = 'contact-card-write';
    go.style.cssText = 'background:rgba(0,200,255,0.25);color:#fff;border:none;border-radius:8px;padding:4px 8px;font-size:12px;';
    go.textContent = 'Escribir';
    go.onclick = function(e) { e.stopPropagation(); if (bi && bi.openChat) bi.openChat(_normId(c.nexoId)).catch(function() {}); };
    row.appendChild(txt); row.appendChild(go);
    card.appendChild(row);
    rows.push({ c: c, go: go });
  });
  function refresh() { rows.forEach(function(r) { r.go.style.display = (!isMe(r.c.nexoId) && isMine(r.c.nexoId)) ? 'inline-block' : 'none'; }); }
  refresh();
  if (!msg._own && list.length) {
    var addBtn = document.createElement('button');
    addBtn.className = 'contact-card-add';
    addBtn.style.cssText = 'width:100%;margin-top:8px;background:linear-gradient(135deg,#00c8ff,#a855f7);color:#fff;border:none;border-radius:10px;padding:8px;font-size:14px;font-weight:600;';
    var pending = list.filter(function(c) { return !isMine(c.nexoId) && !isMe(c.nexoId); }).length;
    addBtn.textContent = pending ? 'Agregar a contactos' : 'Ya en tus contactos ✓';
    var doAdd = function(e) {
      if (e) e.stopPropagation();
      if (!bi || typeof bi.addSharedContacts !== 'function') return;
      var r = bi.addSharedContacts(list, msg.senderNexoId);
      addBtn.textContent = r.added.length ? ('Agregados: ' + r.added.length + ' ✓') : 'Ya en tus contactos ✓';
      refresh();
    };
    addBtn.onclick = doAdd;
    card.onclick = doAdd; // pulsar la tarjeta también los agrega
    card.appendChild(addBtn);
  }
  container.appendChild(card);
}

function _closeAttachMenu() {
  var menu = document.getElementById('attach-menu');
  if (menu) {
    menu.classList.add('hidden');
    menu.classList.remove('visible');
  }
}

function _showCameraPreviewOverlay() {
  var overlay = document.getElementById('camera-preview-overlay');
  if (!overlay) return;
  overlay.classList.remove('hidden');
  _cameraPreviewMode = 'photo';
  _cameraPreviewRecording = false;
  _cameraPreviewVideoChunks = [];
  _cameraVideoStartTime = 0;
  _updateCameraPreviewUI();
}

function _hideCameraPreviewOverlay() {
  var overlay = document.getElementById('camera-preview-overlay');
  if (overlay) overlay.classList.add('hidden');
  _stopCameraPreview();
  var ble = window.bleInterface || (window.NEXO && window.NEXO.app && window.NEXO.app.bleInterface);
  if (ble && typeof ble.resumeBLEAfterCamera === 'function') {
    // Llamada inmediata + espera posterior controlada en el caller
    setTimeout(function() {
      ble.resumeBLEAfterCamera();
    }, 400);
  }
}

// v9.9.32: liberar el reproductor de verdad (en Android quitarlo del DOM no suelta el decodificador)
function _releaseMedia(root) {
  if (!root) return;
  Array.prototype.forEach.call(root.querySelectorAll('video,audio'), function(m) {
    try { m.pause(); } catch (e) {}
    try { m.removeAttribute('src'); m.load(); } catch (e) {}
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

function _updateCameraPreviewUI() {
  var captureBtn = document.getElementById('camera-btn-capture');
  var status = document.getElementById('camera-preview-status');
  var modeBtn = document.getElementById('camera-btn-mode');
  if (!captureBtn) return;
  if (_cameraPreviewMode === 'video') {
    captureBtn.classList.add('recording');
    if (status) status.textContent = _cameraPreviewRecording ? 'Grabando... toca para detener' : 'Toca para grabar video';
    if (modeBtn) modeBtn.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" fill="#fff"><path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"/></svg>';
  } else {
    captureBtn.classList.remove('recording');
    if (status) status.textContent = '';
    if (modeBtn) modeBtn.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" fill="#fff"><path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z"/></svg>';
  }
}

function _setupVideoRecorder(stream) {
  var mimeType = '';
  var candidates = [
    'video/mp4',
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm;codecs=h264,opus',
    'video/webm',
    'video/mp4;codecs=avc1.42E01E,mp4a.40.2'
  ];
  for (var i = 0; i < candidates.length; i++) {
    if (MediaRecorder.isTypeSupported(candidates[i])) {
      mimeType = candidates[i];
      console.log('[CAMERA] MediaRecorder mimeType seleccionado:', mimeType);
      break;
    }
  }
  try {
    var options = mimeType ? { mimeType: mimeType } : {};
    options.videoBitsPerSecond = CAMERA_HD_BPS; // v9.9.30: 720p a 1,5 Mbps (el HD tarda menos)
    _cameraPreviewMediaRecorder = new MediaRecorder(stream, options);
    _cameraPreviewVideoChunks = [];
    _cameraPreviewMediaRecorder.ondataavailable = function(e) {
      if (e.data && e.data.size > 0) _cameraPreviewVideoChunks.push(e.data);
    };
    _cameraPreviewMediaRecorder.onstop = function() {
      console.log('[CAMERA] Grabacion detenida, procesando...');
    };
    _cameraPreviewMediaRecorder.onerror = function(e) {
      console.log('[CAMERA] MediaRecorder error:', e.message);
      _cameraPreviewRecording = false;
      _updateCameraPreviewUI();
    };
  } catch (recErr) {
    console.log('[CAMERA] MediaRecorder init error:', recErr.message);
    var status = document.getElementById('camera-preview-status');
    if (status) status.textContent = 'Error: grabacion no soportada';
  }
}

function _startCameraPreview() {
  var container = document.getElementById('camera-preview-container');
  if (!container) return;
  var overlay = document.getElementById('camera-preview-overlay');
  if (overlay && overlay.classList.contains('hidden')) {
    overlay.classList.remove('hidden');
  }
  var facing = container.dataset.facing || 'environment';
  var needAudio = _cameraPreviewMode === 'video';
  var isFront = facing === 'user';
  var constraints = {
    video: isFront ? { facingMode: { exact: 'user' } } : { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
    audio: needAudio
  };
  function _onStreamSuccess(stream) {
    _cameraActiveStream = stream;
    var video = document.createElement('video');
    video.autoplay = true;
    video.playsInline = true;
    video.muted = true;
    video.style.width = '100%';
    video.style.height = '100%';
    video.style.objectFit = 'cover';
    video.srcObject = stream;
    container.innerHTML = '';
    container.appendChild(video);
    video.play().catch(function(e) { console.log('[CAMERA] play error:', e.message); });
    container.dataset.stream = 'active';
    if (_cameraPreviewMode === 'video') {
      _setupVideoRecorder(stream);
    }
  }
  function _onStreamError(err) {
    console.log('[CAMERA] Error getUserMedia:', err.name, err.message);
    var fallbackConstraints = {
      video: isFront ? { facingMode: 'user' } : { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: needAudio
    };
    navigator.mediaDevices.getUserMedia(fallbackConstraints)
      .then(_onStreamSuccess)
      .catch(function(err2) {
        console.log('[CAMERA] Fallback error:', err2.name, err2.message);
        var status = document.getElementById('camera-preview-status');
        if (status) status.textContent = 'Error camara: ' + err2.message;
      });
  }
  navigator.mediaDevices.getUserMedia(constraints)
    .then(_onStreamSuccess)
    .catch(_onStreamError);
}

function _stopCameraPreview() {
  var wasRecording = _cameraPreviewMediaRecorder && _cameraPreviewMediaRecorder.state === 'recording';
  if (wasRecording) {
    try { _cameraPreviewMediaRecorder.stop(); } catch (e) {}
  }
  var container = document.getElementById('camera-preview-container');
  if (container) {
    var oldVideo = container.querySelector('video');
    if (oldVideo && oldVideo.srcObject) {
      var tracks = oldVideo.srcObject.getTracks();
      tracks.forEach(function(t) { t.stop(); });
    }
    container.innerHTML = '';
  }
  if (_cameraActiveStream) {
    var tracks = _cameraActiveStream.getTracks();
    tracks.forEach(function(t) { t.stop(); });
    _cameraActiveStream = null;
  }
  _cameraPreviewRecording = false;
  _cameraPreviewMediaRecorder = null;
  _cameraPreviewVideoChunks = [];
  _cameraVideoStartTime = 0;
}

function _flipCamera() {
  var container = document.getElementById('camera-preview-container');
  if (!container) return;
  var currentFacing = container.dataset.facing || 'environment';
  var newFacing = currentFacing === 'environment' ? 'user' : 'environment';
  container.dataset.facing = newFacing;
  _stopCameraPreview();
  var needAudio = _cameraPreviewMode === 'video';
  var isFront = newFacing === 'user';
  var constraints = {
    video: isFront ? { facingMode: { exact: 'user' } } : { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
    audio: needAudio
  };
  function _onStreamSuccess(stream) {
    _cameraActiveStream = stream;
    var video = document.createElement('video');
    video.autoplay = true;
    video.playsInline = true;
    video.muted = true;
    video.style.width = '100%';
    video.style.height = '100%';
    video.style.objectFit = 'cover';
    video.srcObject = stream;
    container.innerHTML = '';
    container.appendChild(video);
    video.play().catch(function(e) { console.log('[CAMERA] play error:', e.message); });
    container.dataset.stream = 'active';
    if (_cameraPreviewMode === 'video') {
      _setupVideoRecorder(stream);
    }
  }
  function _onStreamError(err) {
    console.log('[CAMERA] Error flip ideal:', err.name, err.message);
    var fallbackConstraints = {
      video: isFront ? { facingMode: 'user' } : { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: needAudio
    };
    navigator.mediaDevices.getUserMedia(fallbackConstraints)
      .then(_onStreamSuccess)
      .catch(function(err2) {
        console.log('[CAMERA] Error flip fallback:', err2.name, err2.message);
        var status = document.getElementById('camera-preview-status');
        if (status) status.textContent = 'Error camara: ' + err2.message;
      });
  }
  setTimeout(function() {
    navigator.mediaDevices.getUserMedia(constraints)
      .then(_onStreamSuccess)
      .catch(_onStreamError);
  }, 300);
}

function _toggleCameraMode() {
  _cameraPreviewMode = _cameraPreviewMode === 'photo' ? 'video' : 'photo';
  _updateCameraPreviewUI();
  _stopCameraPreview();
  _startCameraPreview();
}

function _capturePhoto() {
  var container = document.getElementById('camera-preview-container');
  if (!container) return;
  var video = container.querySelector('video');
  if (!video) return;
  var canvas = document.createElement('canvas');
  var vw = video.videoWidth || 1280;
  var vh = video.videoHeight || 720;
  var maxDim = 480;
  var scale = 1;
  if (vw > maxDim || vh > maxDim) scale = Math.min(maxDim / vw, maxDim / vh);
  canvas.width = Math.max(1, Math.round(vw * scale));
  canvas.height = Math.max(1, Math.round(vh * scale));
  var ctx = canvas.getContext('2d');
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  var base64 = canvas.toDataURL('image/jpeg', 0.5).split(',')[1];
  console.log('[CAMERA] Foto capturada', canvas.width + 'x' + canvas.height, 'b64len=' + base64.length);

  // Cerrar cámara y reanudar BLE
  _hideCameraPreviewOverlay();

  // Esperar a que BLE esté realmente listo antes de enviar (evita race → !)
  _waitForBLEReady(4500).then(function() {
    _sendAttachment('image', base64, { format: 'jpeg', width: canvas.width, height: canvas.height });
  });
}

function _handleCameraCapture() {
  if (_cameraPreviewMode === 'photo') {
    _capturePhoto();
  } else {
    if (!_cameraPreviewRecording) {
      if (_cameraPreviewMediaRecorder && _cameraPreviewMediaRecorder.state === 'inactive') {
        _cameraPreviewVideoChunks = [];
        _cameraVideoStartTime = Date.now();
        try {
          try {
            _cameraPreviewMediaRecorder.start(100);
          } catch (tsErr) {
            console.log('[CAMERA] Timeslice no soportado, usando sin timeslice');
            _cameraPreviewMediaRecorder.start();
          }
          _cameraPreviewRecording = true;
          _updateCameraPreviewUI();
          console.log('[CAMERA] Grabacion iniciada');
        } catch (startErr) {
          console.log('[CAMERA] Error al iniciar grabacion:', startErr.message);
          _cameraPreviewRecording = false;
        }
      }
    } else {
      if (_cameraPreviewMediaRecorder && _cameraPreviewMediaRecorder.state === 'recording') {
        try { _cameraPreviewMediaRecorder.requestData(); } catch (e) {}
        setTimeout(function() {
          try {
            if (_cameraPreviewMediaRecorder && _cameraPreviewMediaRecorder.state === 'recording') {
              _cameraPreviewMediaRecorder.stop();
            }
          } catch (e) {}
          setTimeout(function() {
            var duration = 0;
            if (_cameraVideoStartTime > 0) {
              duration = Math.round((Date.now() - _cameraVideoStartTime) / 1000);
            }
            var mimeType = (_cameraPreviewMediaRecorder && _cameraPreviewMediaRecorder.mimeType) || 'video/webm';
            var blob = new Blob(_cameraPreviewVideoChunks, { type: mimeType.split(';')[0] });
            if (blob.size === 0) {
              console.log('[CAMERA] Video blob vacio, grabacion fallo');
              var status = document.getElementById('camera-preview-status');
              if (status) status.textContent = 'Error: video vacio';
              _cameraPreviewRecording = false;
              _updateCameraPreviewUI();
              return;
            }
            console.log('[CAMERA] Video listo ' + Math.round(blob.size / 1024) + ' KB dur=' + duration);
            _hideCameraPreviewOverlay();
            // v9.9.30: previa rápida + HD automático
            _waitForBLEReady(4500).then(function() {
              _sendVideo(blob, { format: _videoFormat(mimeType), duration: duration });
            });
          }, 1200);
          _cameraPreviewRecording = false;
          _updateCameraPreviewUI();
        }, 1500);
      }
    }
  }
}

function _bindCameraPreviewHandlers() {
  var closeBtn = document.getElementById('camera-btn-close');
  var flipBtn = document.getElementById('camera-btn-flip');
  var captureBtn = document.getElementById('camera-btn-capture');
  var modeBtn = document.getElementById('camera-btn-mode');
  if (closeBtn) closeBtn.addEventListener('click', _hideCameraPreviewOverlay);
  if (flipBtn) flipBtn.addEventListener('click', _flipCamera);
  if (captureBtn) captureBtn.addEventListener('click', _handleCameraCapture);
  if (modeBtn) modeBtn.addEventListener('click', _toggleCameraMode);
}

async function _handleCamera() {
  _closeAttachMenu();
  var ble = window.bleInterface || (window.NEXO && window.NEXO.app && window.NEXO.app.bleInterface);
  if (ble && typeof ble.pauseBLEForCamera === 'function') {
    ble.pauseBLEForCamera();
  }
  await new Promise(function(r) { setTimeout(r, 200); });
  _showCameraPreviewOverlay();
  _startCameraPreview();
}

async function _handleGallery() {
  _closeAttachMenu();
  _hideCameraPreviewOverlay();
  _stopCameraPreview();
  await new Promise(function(r) { setTimeout(r, 150); });
  var input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*,video/*';
  input.style.cssText = 'position:fixed;top:-1000px;left:-1000px;opacity:0;pointer-events:none;width:1px;height:1px;';
  input.onchange = function(e) {
    var file = e.target.files[0];
    if (!file) { input.remove(); return; }
    var isVideo = file.type.indexOf('video') === 0;
    // v9.9.30: el vídeo no se lee entero: se recodifica una previa y el original va como HD si cabe
    if (isVideo) {
      _sendVideo(file, { name: file.name, size: file.size, mime: file.type });
      input.remove();
      return;
    }
    var reader = new FileReader();
    reader.onload = function(evt) {
      var base64 = evt.target.result.split(',')[1];
      {
        _compressImageBase64(base64, 480, 0.5).then(function(res) {
          _sendAttachment('image', res.base64, {
            name: file.name,
            size: res.base64.length,
            type: 'image/jpeg',
            format: res.format || 'jpeg',
            width: res.width,
            height: res.height
          });
          input.remove();
        });
      }
    };
    reader.onerror = function() {
      console.log('[ATTACH] Error leyendo archivo');
      input.remove();
    };
    reader.readAsDataURL(file);
  };
  document.body.appendChild(input);
  input.click();
  setTimeout(function() { if (input.parentNode) input.remove(); }, 30000);
}

function _handleFile() {
  _closeAttachMenu();
  var input = document.createElement('input');
  input.type = 'file';
  input.accept = '*/*';
  input.style.cssText = 'position:fixed;top:-1000px;left:-1000px;opacity:0;pointer-events:none;width:1px;height:1px;';
  input.onchange = function(e) {
    var file = e.target.files[0];
    if (!file) { input.remove(); return; }
    // Comprobar antes de leer: leer un archivo enorme ya congela el WebView
    if (file.size > MAX_BLE_FILE_BYTES) { _showPermissionError(_tooBigMessage(file.size)); input.remove(); return; }
    var reader = new FileReader();
    reader.onload = function(evt) {
      var base64 = evt.target.result.split(',')[1];
      if (base64 && base64.length > MAX_BLE_B64_BYTES) {
        console.warn('[ATTACH] Archivo demasiado grande:', base64.length);
        _showPermissionError(_tooBigMessage(Math.floor(base64.length * 3 / 4)));
        input.remove();
        return;
      }
      _sendAttachment('file', base64, { name: file.name, size: file.size, type: file.type });
      console.log('[ATTACH] Archivo:', file.name);
      input.remove();
    };
    reader.onerror = function() {
      console.log('[ATTACH] Error leyendo archivo');
      input.remove();
    };
    reader.readAsDataURL(file);
  };
  document.body.appendChild(input);
  input.click();
  setTimeout(function() { if (input.parentNode) input.remove(); }, 30000);
}

function _showPermissionError(permName) {
  var existing = document.getElementById('perm-error-toast');
  if (existing) existing.remove();
  var toast = document.createElement('div');
  toast.id = 'perm-error-toast';
  toast.style.cssText = 'position:fixed;top:20px;left:50%;transform:translateX(-50%);background:rgba(255,59,48,0.95);color:#fff;padding:12px 20px;border-radius:12px;font-size:13px;font-weight:600;z-index:10000;backdrop-filter:blur(4px);box-shadow:0 4px 20px rgba(0,0,0,0.4);max-width:90vw;text-align:center;';
  // Si el mensaje ya es descriptivo (tamaño), no añadir el prefijo de permiso
  if (permName && (permName.indexOf('Archivo') === 0 || permName.indexOf('Video') === 0 || permName.indexOf('demasiado') > -1)) {
    toast.innerHTML = permName;
  } else {
    toast.innerHTML = 'Permiso de ' + permName + ' denegado.<span style="font-size:11px;opacity:0.8;font-weight:400;">Ve a Ajustes > Aplicaciones > NEXO > Permisos</span>';
  }
  document.body.appendChild(toast);
  setTimeout(function() {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 0.5s';
    setTimeout(function() { toast.remove(); }, 500);
  }, 4000);
}

async function _handleLocation() {
  if (_isGettingLocation) return;
  _isGettingLocation = true;
  _closeAttachMenu();
  var plugins = _getAttachmentPlugins();
  var sent = false;
  var safetyTimer = setTimeout(function() {
    _isGettingLocation = false;
  }, 25000);
  try {
    if (plugins.Geolocation &&
        typeof plugins.Geolocation.checkPermissions === 'function' &&
        typeof plugins.Geolocation.requestPermissions === 'function' &&
        typeof plugins.Geolocation.getCurrentPosition === 'function') {
      try {
        var perm = await plugins.Geolocation.checkPermissions();
        if (perm.location !== 'granted') {
          var req = await plugins.Geolocation.requestPermissions();
          if (req.location !== 'granted') throw new Error('Permiso denegado');
        }
        var pos = await plugins.Geolocation.getCurrentPosition({ enableHighAccuracy: true, timeout: 15000 });
        _sendLocation(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy);
        sent = true;
      } catch (pluginErr) {
        console.log('[ATTACH:LOCATION] Plugin fallo:', pluginErr.message);
        if (pluginErr.message && pluginErr.message.indexOf('denied') > -1) {
          _showPermissionError('Ubicacion');
          return;
        }
      }
    }
    if (!sent) {
      _handleLocationFallback();
    }
  } finally {
    clearTimeout(safetyTimer);
    _isGettingLocation = false;
  }
}

function _sendLocation(lat, lng, accuracy) {
  var now = Date.now();
  if (now - _lastLocationSent < _LOCATION_DEBOUNCE_MS) {
    console.log('[ATTACH:LOCATION] Ignorado por debounce');
    return;
  }
  _lastLocationSent = now;
  var payload = JSON.stringify({ lat: lat, lng: lng, accuracy: accuracy || 0 });
  _sendAttachment('location', payload, { lat: lat, lng: lng, accuracy: accuracy || 0 });
  console.log('[ATTACH] Ubicacion enviada');
}

function _handleLocationFallback() {
  try {
    if (!navigator.geolocation) {
      console.log('[ATTACH] Geolocation API no disponible');
      _showPermissionError('Ubicacion');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      function(pos) {
        _sendLocation(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy);
      },
      function(err) {
        console.log('[ATTACH:LOCATION] Fallback error:', err.code, err.message);
        if (err.code === 1) {
          _showPermissionError('Ubicacion');
        }
      },
      { enableHighAccuracy: false, timeout: 20000, maximumAge: 120000 }
    );
  } catch (e) {
    console.log('[ATTACH:LOCATION] Fallback fallo:', e.message);
  }
}

async function _handleVoiceToggle() {
  var timerEl = document.getElementById('voice-timer');
  if (!timerEl) {
    timerEl = document.createElement('div');
    timerEl.id = 'voice-timer';
    timerEl.style.cssText = 'position:fixed;bottom:70px;left:50%;transform:translateX(-50%);background:rgba(255,59,48,0.9);color:#fff;padding:6px 16px;border-radius:20px;font-size:14px;font-weight:600;z-index:300;display:none;pointer-events:none;backdrop-filter:blur(4px);';
    document.body.appendChild(timerEl);
  }
  if (!_isRecording) {
    try {
      var stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      var audioMimeType = '';
      var audioCandidates = [
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/mp4',
        'audio/ogg;codecs=opus',
        'audio/wav'
      ];
      for (var ai = 0; ai < audioCandidates.length; ai++) {
        if (MediaRecorder.isTypeSupported(audioCandidates[ai])) {
          audioMimeType = audioCandidates[ai];
          console.log('[VOICE] MimeType seleccionado:', audioMimeType);
          break;
        }
      }
      var audioOptions = audioMimeType ? { mimeType: audioMimeType } : {};
      _mediaRecorder = new MediaRecorder(stream, audioOptions);
      _audioChunks = [];
      _voiceStartTime = Date.now();
      timerEl.style.display = 'block';
      timerEl.textContent = '00:00';
      _voiceTimerInterval = setInterval(function() {
        var elapsed = Math.round((Date.now() - _voiceStartTime) / 1000);
        timerEl.textContent = _fmtTime(elapsed);
      }, 1000);
      _mediaRecorder.ondataavailable = function(e) {
        if (e.data && e.data.size > 0) _audioChunks.push(e.data);
      };
      _mediaRecorder.onstop = function() {
        if (_voiceTimerInterval) { clearInterval(_voiceTimerInterval); _voiceTimerInterval = null; }
        timerEl.style.display = 'none';
        var duration = 0;
        if (_voiceStartTime > 0) duration = Math.round((Date.now() - _voiceStartTime) / 1000);
        var blobType = audioMimeType || 'audio/webm';
        var blob = new Blob(_audioChunks, { type: blobType });
        if (blob.size === 0) {
          console.log('[ATTACH] Audio blob vacio');
          return;
        }
        var reader = new FileReader();
        reader.onloadend = function() {
          var base64 = reader.result.split(',')[1];
          var fmt = (audioMimeType || 'webm').split('/')[1];
          if (fmt.indexOf(';') > -1) fmt = fmt.split(';')[0];
          _sendAttachment('audio', base64, { format: fmt, duration: duration, mimeType: audioMimeType || 'audio/webm' });
          console.log('[ATTACH] Audio enviado, duracion:', duration);
        };
        reader.readAsDataURL(blob);
        stream.getTracks().forEach(function(t) { t.stop(); });
      };
      _mediaRecorder.onerror = function(e) {
        console.log('[ATTACH:VOICE] MediaRecorder error:', e.message);
        _isRecording = false;
        _updateMicIcon(false);
        timerEl.style.display = 'none';
      };
      try {
        _mediaRecorder.start(100);
      } catch (tsErr) {
        _mediaRecorder.start();
      }
      _isRecording = true;
      _updateMicIcon(true);
      console.log('[ATTACH] Grabando voz...');
    } catch (err) {
      console.log('[ATTACH:VOICE] Error:', err.name, err.message);
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        _showPermissionError('Microfono');
      } else if (err.name === 'NotFoundError') {
        _showPermissionError('Microfono no encontrado');
      }
      _isRecording = false;
      _updateMicIcon(false);
      timerEl.style.display = 'none';
    }
  } else {
    if (_mediaRecorder && _mediaRecorder.state !== 'inactive') {
      try { _mediaRecorder.requestData(); } catch (e) {}
      setTimeout(function() {
        try { _mediaRecorder.stop(); } catch (e) {}
      }, 300);
    }
    _isRecording = false;
    _updateMicIcon(false);
    if (_voiceTimerInterval) {
      clearInterval(_voiceTimerInterval);
      _voiceTimerInterval = null;
    }
    timerEl.style.display = 'none';
  }
}

function _updateMicIcon(recording) {
  var micBtn = document.getElementById('send-btn');
  if (!micBtn) return;
  var visibleSvg = micBtn.querySelector('.mic-icon') || micBtn.querySelector('.send-icon') || micBtn.querySelector('svg');
  if (visibleSvg) {
    visibleSvg.setAttribute('fill', recording ? '#FF3B30' : '#fff');
  }
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
              protoCheck.type === 'read_receipt' || protoCheck.type === 'ping' ||
              protoCheck.type === 'pong' ||
              protoCheck.t === 'c' || protoCheck.t === 'f' || protoCheck.t === 'n' ||
              protoCheck.t === 'a' || protoCheck.t === 'ba' || protoCheck.t === 'ss' || protoCheck.t === 'sr') {
            console.warn('[MAIN] Protocol JSON defensively dropped:', protoCheck.type || protoCheck.t);
            return;
          }
        } catch (e) {}
      }
    }
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
    var activeId = _getCurrentContactId();
    var senderId = msg.senderNexoId || msg.sender || '';
    var msgId = msg.messageId || msg.msgId || '';
    if (activeId && senderId && msgId && _normId(activeId) === _normId(senderId)) {
      setTimeout(function() {
        window.dispatchEvent(new CustomEvent('nexo:ble:sendReadReceipt', {
          detail: { nexoId: senderId, msgId: msgId }
        }));
      }, 400);
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
          var activeId = _getCurrentContactId();
          if (activeId && _normId(activeId) === nx) {
            var subtitle = document.getElementById('chat-contact-subtitle');
            if (subtitle) subtitle.textContent = 'En linea';
          }
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
      var vaultMsg = {
        msgId: msgId,
        messageId: msgId,
        contactNexoId: chatContactId,
        content: text,
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
        await window.NEXO.app.sendMessage({ content: text, msgId: msgId, messageId: msgId, seq: seq });
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
        _updateMessageStatus(msgId, 'failed');
        _updateMessageStorageStatus(msgId, 'failed');
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
var _olderMessages = [], _olderContactId = null, _loadingOlder = false, _suppressAutoScroll = false;

// Al acercarse arriba del todo se dibujan los 60 anteriores sin que la vista salte
function _bindOlderMessagesScroll() {
  var mc = document.getElementById('messages-container');
  if (!mc || mc._olderBound) return;
  mc._olderBound = true;
  mc.addEventListener('scroll', function() {
    if (mc.scrollTop < 150 && _olderMessages.length && !_loadingOlder) _loadOlderMessages();
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
  } catch (e) {
    console.warn('[MAIN] _loadPersistedMessages error:', e);
  }
}

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
        var vSrc = '';
        try { vSrc = URL.createObjectURL(_b64ToBlob(attachment.payload, vMime)); _objectURLRegistry.push(vSrc); } catch (vErr) { console.warn('[VIDEO] No se pudo preparar el vídeo:', vErr && vErr.message); }
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
          contentDiv.innerHTML = '<div style="padding:8px 12px;background:rgba(0,0,0,0.3);border-radius:10px;">📎 <b>Archivo</b><span style="font-size:12px;opacity:0.7;">' + (attachment.meta.name || 'archivo') + '</span></div>';
        }
      } else if (attachment.type === 'location') {
        var loc = attachment.meta;
        var lat = (loc && loc.lat) ? loc.lat : 0;
        var lng = (loc && loc.lng) ? loc.lng : 0;
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
      contentDiv.textContent = msg.content || msg.text || '';
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

// ===================== v9.9.30: vídeo previa + HD =====================
var PREVIEW_MAX_SIDE = 426;          // 240p
var PREVIEW_MAX_SECONDS = 60;
var MAX_HD_B64_BYTES = 8000000;      // original de hasta ~6 MB (en segundo plano)
var CAMERA_HD_BPS = 1500000;         // grabación 720p a 1,5 Mbps (antes ~2,5 por defecto)
var _hdOutbox = {};                  // msgId -> { cid, mime, b64 } (emisor, en memoria)
var _hdInFlight = {};

function _videoFormat(mime) { return /mp4/i.test(mime || '') ? 'mp4' : 'webm'; }
function _blobToB64(blob) {
  return new Promise(function(resolve, reject) {
    var r = new FileReader();
    r.onload = function() { resolve(String(r.result).split(',')[1] || ''); };
    r.onerror = function() { reject(new Error('lectura')); };
    r.readAsDataURL(blob);
  });
}

// Recodifica a 240p y bitrate bajo reproduciendo el vídeo en un canvas (sin sonido audible: el audio
// va por WebAudio solo a la grabación). Devuelve un Blob (con .thumb = miniatura JPEG en base64) o null
// si el teléfono no puede; nunca se queda colgada (vigilante general).
// v9.9.32: vídeo temporal dentro de la pantalla (Android no decodifica vídeos ocultos), AudioContext
// reanudado o sin audio si sigue suspendido, vigilante de atascos y registro [VIDEO] de cada paso.
function _makeVideoPreview(blob, knownDuration) {
  return new Promise(function(resolve) {
    var done = false, cleanup = [], t0 = Date.now();
    function log(m) { console.log('[VIDEO] ' + m + ' (' + Math.round((Date.now() - t0) / 100) / 10 + ' s)'); }
    function finish(res, why) {
      if (done) return; done = true;
      if (!res || res.tooLong) log('Previa no generada: ' + (why || (res && res.tooLong ? 'demasiado largo' : '?')));
      cleanup.forEach(function(f) { try { f(); } catch (e) {} });
      resolve(res);
    }
    try {
      if (typeof MediaRecorder === 'undefined' || !window.HTMLCanvasElement || !HTMLCanvasElement.prototype.captureStream) return finish(null, 'sin MediaRecorder/captureStream');
      log('Previa: inicio, original ' + Math.round(blob.size / 1024) + ' KB ' + (blob.type || '?'));
      var url = URL.createObjectURL(blob);
      cleanup.push(function() { URL.revokeObjectURL(url); });
      var v = document.createElement('video');
      v.playsInline = true; v.preload = 'auto';
      v.style.cssText = 'position:fixed;right:0;bottom:0;width:2px;height:2px;opacity:0.01;pointer-events:none;z-index:-1;';
      document.body.appendChild(v);
      cleanup.push(function() { v.pause(); v.removeAttribute('src'); v.load(); v.remove(); });
      var watchdog = setTimeout(function() { finish(null, 'sin metadatos en 15 s'); }, 15000);
      cleanup.push(function() { clearTimeout(watchdog); });
      v.onerror = function() { finish(null, 'el teléfono no puede leer el vídeo (código ' + (v.error && v.error.code) + ')'); };
      v.onloadedmetadata = function() {
        clearTimeout(watchdog);
        var dur = isFinite(v.duration) && v.duration > 0 ? v.duration : (knownDuration || 0);
        log('Previa: metadatos ' + v.videoWidth + 'x' + v.videoHeight + ' dur=' + (Math.round(dur * 10) / 10));
        if (dur > PREVIEW_MAX_SECONDS) return finish({ tooLong: true, duration: dur });
        // Vigilante general: nunca más de la duración + 25 s
        watchdog = setTimeout(function() { finish(null, 'tiempo agotado'); }, ((dur || PREVIEW_MAX_SECONDS) + 25) * 1000);
        var w = v.videoWidth || 640, h = v.videoHeight || 360;
        var scale = Math.min(1, PREVIEW_MAX_SIDE / Math.max(w, h));
        var cw = Math.max(2, Math.round(w * scale / 2) * 2), ch = Math.max(2, Math.round(h * scale / 2) * 2);
        var canvas = document.createElement('canvas');
        canvas.width = cw; canvas.height = ch;
        var ctx = canvas.getContext('2d');
        var tracks = canvas.captureStream(24).getVideoTracks().slice();
        _previewAudioTracks(v, cleanup).then(function(audioTracks) {
          if (done) return;
          audioTracks.forEach(function(t) { tracks.push(t); });
          if (!audioTracks.length) v.muted = true;
          log('Previa: audio ' + (audioTracks.length ? 'sí' : 'no'));
          var mime = ['video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'].filter(function(m) { return MediaRecorder.isTypeSupported(m); })[0] || '';
          // ~250 KB de previa como objetivo, entre 60 y 200 kbps de vídeo
          var vbps = Math.max(60000, Math.min(200000, Math.round(250000 * 8 / Math.max(dur || 10, 1)) - 24000));
          var rec;
          try { rec = new MediaRecorder(new MediaStream(tracks), Object.assign(mime ? { mimeType: mime } : {}, { videoBitsPerSecond: vbps, audioBitsPerSecond: 24000 })); }
          catch (e) { return finish(null, 'MediaRecorder: ' + e.message); }
          var parts = [], thumb = null, frames = 0, lastT = -1, stuck = 0;
          rec.ondataavailable = function(e) { if (e.data && e.data.size) parts.push(e.data); };
          rec.onerror = function(e) { finish(null, 'error del grabador'); };
          rec.onstop = function() {
            var out = new Blob(parts, { type: (rec.mimeType || mime || 'video/webm').split(';')[0] });
            log('Previa ' + cw + 'x' + ch + ' ' + Math.round(out.size / 1024) + ' KB (original ' + Math.round(blob.size / 1024) + ' KB), miniatura ' + (thumb ? 'sí' : 'no'));
            if (out.size > 0 && out.size < blob.size * 0.8) { out.thumb = thumb; finish(out); } else finish(null, 'la previa no es más pequeña (' + Math.round(out.size / 1024) + ' KB)');
          };
          var stop = function(why) {
            log('Previa: fin (' + why + ')');
            try { if (rec.state !== 'inactive') rec.stop(); else finish(null, 'grabador inactivo'); } catch (e) { finish(null, 'stop: ' + e.message); }
          };
          var draw = setInterval(function() {
            try {
              ctx.drawImage(v, 0, 0, cw, ch);
              // Miniatura (poster) para la burbuja: un fotograma a ~0,3 s
              if (!thumb && ++frames === 8) thumb = canvas.toDataURL('image/jpeg', 0.6).split(',')[1] || null;
            } catch (e) {}
            // Atasco: el vídeo no avanza en 5 s
            if (v.currentTime === lastT) { if (++stuck > 120) { clearInterval(draw); stop('reproducción atascada en ' + Math.round(v.currentTime * 10) / 10 + ' s'); } }
            else { stuck = 0; lastT = v.currentTime; }
          }, 42);
          cleanup.push(function() { clearInterval(draw); });
          v.onended = function() { stop('vídeo terminado'); };
          rec.start(500);
          var pp = v.play();
          if (pp && pp.catch) pp.catch(function(e) { finish(null, 'play() rechazado: ' + (e && e.message)); });
        });
      };
      v.src = url;
    } catch (e) { finish(null, 'excepción: ' + (e && e.message)); }
  });
}

// Pista de audio del vídeo para la grabación, por WebAudio (no suena). Si el AudioContext no arranca
// (Android sin gesto del usuario) se devuelve [] y la previa va sin sonido en vez de colgarse.
function _previewAudioTracks(v, cleanup) {
  return new Promise(function(resolve) {
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return resolve([]);
      var ac = new AC();
      cleanup.push(function() { try { ac.close(); } catch (e) {} });
      var ready = function() {
        try {
          var dest = ac.createMediaStreamDestination();
          ac.createMediaElementSource(v).connect(dest);
          resolve(dest.stream.getAudioTracks());
        } catch (e) { resolve([]); }
      };
      if (ac.state === 'running') return ready();
      var p = ac.resume ? ac.resume() : null;
      var t = setTimeout(function() { resolve([]); }, 800);
      if (p && p.then) p.then(function() { if (ac.state === 'running') { clearTimeout(t); ready(); } }).catch(function() {});
    } catch (e) { resolve([]); }
  });
}

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
    var withHd = Math.ceil(blob.size / 3) * 4 <= MAX_HD_B64_BYTES;
    var thumbP = preview.thumb ? Promise.resolve(preview.thumb) : _makeVideoThumb(blob, 320);
    return Promise.all([_blobToB64(preview), withHd ? _blobToB64(blob) : Promise.resolve(null), thumbP]).then(function(r) {
      preview.thumb = r[2] || null;
      var msgId = _sendAttachment('video', r[0], Object.assign({}, meta, { mime: pMime, format: _videoFormat(pMime), preview: !!r[1], hdSize: r[1] ? blob.size : 0, thumb: preview.thumb || null }),
        r[1] ? { displayPayload: r[1], displayMime: mime } : null);
      if (msgId && r[1]) _registerHd(contactId, msgId, r[1], mime);
    });
  }).catch(function(e) {
    _showOwnPreparing(false);
    console.warn('[VIDEO] Error preparando vídeo:', e && e.message);
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

function _b64ToBlob(b64, mime) {
  var bin = atob(b64 || ''), arr = new Uint8Array(bin.length);
  for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime || 'application/octet-stream' });
}

// Miniatura JPEG (base64) de un vídeo (Blob o URL): primer fotograma. null si no se puede.
// El <video> temporal va dentro de la pantalla (1 px): Android no decodifica vídeos ocultos.
function _makeVideoThumb(srcOrBlob, maxSide) {
  return new Promise(function(resolve) {
    var done = false, url = null, v = null;
    function finish(r) {
      if (done) return; done = true;
      try { if (v) { v.pause(); v.removeAttribute('src'); v.load(); v.remove(); } } catch (e) {}
      if (url) { try { URL.revokeObjectURL(url); } catch (e) {} }
      resolve(r);
    }
    try {
      url = (typeof srcOrBlob === 'string') ? null : URL.createObjectURL(srcOrBlob);
      v = document.createElement('video');
      v.muted = true; v.playsInline = true; v.preload = 'auto';
      v.style.cssText = 'position:fixed;right:0;bottom:0;width:1px;height:1px;opacity:0.01;pointer-events:none;z-index:-1;';
      document.body.appendChild(v);
      var timer = setTimeout(function() { finish(null); }, 6000);
      var grab = function() {
        try {
          var w = v.videoWidth, h = v.videoHeight;
          if (!w || !h) return;
          var sc = Math.min(1, (maxSide || 320) / Math.max(w, h));
          var c = document.createElement('canvas');
          c.width = Math.round(w * sc); c.height = Math.round(h * sc);
          c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
          clearTimeout(timer);
          finish(c.toDataURL('image/jpeg', 0.6).split(',')[1] || null);
        } catch (e) { clearTimeout(timer); finish(null); }
      };
      v.onloadeddata = function() { setTimeout(grab, 120); };
      v.onerror = function() { clearTimeout(timer); finish(null); };
      v.src = url || srcOrBlob;
    } catch (e) { finish(null); }
  });
}

var _thumbsInProgress = {};
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

// v9.9.29: la lista de contactos se ordena por el último mensaje enviado o recibido
var _PREVIEW_BY_TYPE = { contact: '👤 Contacto', image: '📷 Foto', video: '🎬 Vídeo', audio: '🎤 Audio', voice: '🎤 Audio', location: '📍 Ubicación', file: '📎 Archivo' };
function _noteContactMessage(contactId, textOrType, ts) {
  var bi = window.bleInterface || (window.NEXO && window.NEXO.app && window.NEXO.app.bleInterface);
  if (!contactId || !bi || typeof bi.noteContactMessage !== 'function') return;
  bi.noteContactMessage(contactId, _PREVIEW_BY_TYPE[textOrType] || String(textOrType || '').substring(0, 50), ts);
}

function _removeIncomingPlaceholder(fileId) {
  var ph = document.querySelector('[data-progress-id="' + fileId + '"]');
  if (ph && ph.parentNode) ph.parentNode.removeChild(ph);
}

// v9.9.27: progreso de transferencias de archivos (eventos 'nexo:ble:fileProgress' de ble_ack.js)
function _onFileProgress(d) {
  if (!d || !d.fileId) return;
  var pct = Math.max(0, Math.min(99, d.percent || 0));
  // v9.9.30: progreso del HD dentro de la burbuja del vídeo (emisor: fileId '<msgId>_hd')
  var hdBase = d.hdFor || (/_hd$/.test(d.fileId) ? d.fileId.replace(/_hd$/, '') : null);
  if (hdBase) { if (d.status !== 'failed') _setHdBadge(hdBase, 'HD ' + pct + '%'); return; }
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
