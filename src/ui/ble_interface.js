/**
 * BLE Interface v6.1.10-NEXO
 * v6.1.10: la pestaña Perfil abre el registro de diagnóstico.
 * FIX v6.1.9: Cola de mensajes por contacto (antes por dirección Bluetooth: al reabrir la app el otro
 *             cambia de dirección y la cola vieja no salía nunca). sendFile sin el otro presente ya no
 *             espera ~40 s a una dirección concreta: falla rápido (PEER_ABSENT) y el adjunto queda para
 *             el reenvío al reconectar (antes se perdía). Adjuntos 'sending' sin transferencia viva se
 *             reenvían.
 * FIX v6.1.8: Lista de contactos ordenada por el último mensaje enviado o recibido (lastMessageAt);
 *             antes por lastSeen, que cambia con cada ping/escaneo y hacía saltar la lista. La hora y
 *             el texto de la fila son los del último mensaje. Redibujado agrupado (máx. cada 300 ms).
 * FIX v6.1.7: Al volver a la app (aviso nativo o visibilitychange) se reconecta, se sincroniza y se
 *             vacía la cola (dependía de @capacitor/app, no instalado). Re-búsqueda sin el tope de
 *             10 min, también con la app oculta (escaneo filtrado), y búsqueda de 2 min al abrir/volver.
 * FIX v6.1.6: Mensajes que no aparecían al reabrir la app: cola de pendientes con ack y reintentos;
 *             reenvío inmediato al recibir cualquier paquete del otro; conexiones abiertas por el
 *             nativo antes del JS se recuperan (getConnectedDevices); reconexión también desde ERROR;
 *             se prefiere un enlace listo aunque su dirección no sea la del escaneo.
 * FIX v6.1.5: textos cortos con confirmación y reintentos (sendWithRetry); guarda el MTU que devuelve
 *             el nativo (getMtu) para que ble_ack ajuste el tamaño de los trozos.
 * FIX v6.1.4: Tras reiniciar la app, los mensajes que quedaron en 'sending' se reenvían.
 * FIX v6.1.4: Re-búsqueda automática (cada 15s, máx ~10 min) de contactos desconectados o con
 *             mensajes en cola; antes nadie re-escaneaba y la cola no salía hasta abrir "Gente".
 *             Conexión entrante (rol servidor) también vacía la cola de pendientes.
 * FIX v6.1.3: Estados, cola de pendientes y esperas READY usan MAC normalizada como clave.
 *             El mapeo NXID->MAC devuelve 'aabbcc..' y los eventos nativos 'AA:BB:CC..';
 *             el envío nunca veía el dispositivo como listo y los mensajes se quedaban en cola.
 * FIX v6.1.2: _sendMessageNative envía "message" (no "content") con sobre v1 chat;
 *             desde v6.1.1 todos los envíos llegaban vacíos al nativo.
 * FIX v6.1.1: Espera post-cámara 100% bloqueante + reintento automático.
 *             Resolución de deviceId reforzada (evita MAC nulo/obsoleto).
 *             Supervisor no fuerza reconexión destructiva mientras hay
 *             transferencia de archivo activa (consulta ackSystem).
 * FIX v6.1.0: resumeBLEAfterCamera reconecta ACTIVAMENTE a los dispositivos
 *             que pauseBLEForCamera desconectó.
 * FIX: pauseBLEForCamera realmente bloquea envíos hasta resume
 * FIX: sendFile espera a que la cámara libere BLE si estaba pausado
 * FIX: Eliminado sendFileNative y listeners de archivo nativo (Opcion C)
 * FIX: Sync bidireccional — ambos lados envían sessionSync al conectar
 * FIX: Filtro de protocolo v3 (block_ack 'ba') para ble_ack.js v3.x
 * Base: v6.0.9-NEXO
 */
var BLE_NEXO_ID_VAULT_FILE = 'nexo_advertising_id.json';
var BLE_PINNED_VAULT_FILE = 'nexo_ble_pinned.json';
var BLE_UUID_VAULT_FILE = 'nexo_device_uuid.json';
var BLE_SEQ_COUNTER_FILE = 'nexo_seq_counter.json';
var GRADIENTS = [
  'ble-gradient-1', 'ble-gradient-2', 'ble-gradient-3', 'ble-gradient-4',
  'ble-gradient-5', 'ble-gradient-6', 'ble-gradient-7', 'ble-gradient-8'
];
var _blePinnedCache = [];
var _bleUUIDCache = null;

function _getGradientForUUID(uuid) {
  var hash = 0;
  for (var i = 0; i < uuid.length; i++) {
    hash = ((hash << 5) - hash) + uuid.charCodeAt(i);
    hash |= 0;
  }
  return GRADIENTS[Math.abs(hash) % GRADIENTS.length];
}

function _getInitials(name) {
  name = (name || '').toString().trim();
  if (!name) return '?';
  var parts = name.split(/\s+/);
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}

function _generateNexoId() {
  var now = new Date();
  var seconds = now.getSeconds();
  var secBase36 = seconds.toString(36).toUpperCase().padStart(2, '0');
  var uuidPart = _generateUUID().replace(/-/g, '').substring(0, 6).toUpperCase();
  return 'NX' + secBase36 + uuidPart;
}

function _saveNexoIdToVault(nexoId) {
  return new Promise(function(resolve) {
    var plugin = (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.NexoBLE) || null;
    if (plugin && typeof plugin.saveToFile === 'function') {
      _safeNativeCall(plugin, 'saveToFile', {
        filename: BLE_NEXO_ID_VAULT_FILE,
        content: JSON.stringify({ nexoId: nexoId, createdAt: Date.now() })
      }).then(function() { resolve(nexoId); }).catch(function() { resolve(nexoId); });
    } else { resolve(nexoId); }
  });
}

function _loadNexoIdFromVault() {
  return new Promise(function(resolve) {
    var plugin = (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.NexoBLE) || null;
    if (plugin && typeof plugin.loadFromFile === 'function') {
      _safeNativeCall(plugin, 'loadFromFile', { filename: BLE_NEXO_ID_VAULT_FILE })
        .then(function(result) {
          if (result && result.exists && result.content) {
            try {
              var data = JSON.parse(result.content);
              if (data.nexoId && data.nexoId.length === 10 && data.nexoId.indexOf('NX') === 0) {
                resolve(data.nexoId); return;
              }
            } catch (e) {}
          }
          resolve(null);
        }).catch(function() { resolve(null); });
    } else { resolve(null); }
  });
}

function _getOrCreateNexoId() {
  return new Promise(function(resolve) {
    _loadNexoIdFromVault().then(function(existingId) {
      if (existingId) { resolve(existingId); return; }
      var newId = _generateNexoId();
      _saveNexoIdToVault(newId).then(function(id) { resolve(id); });
    });
  });
}

// Texto corto del último mensaje para la lista de contactos
function _messagePreview(content, attachmentType) {
  var t = attachmentType;
  if (!t && typeof content === 'string' && content.charAt(0) === '{') {
    try { var p = JSON.parse(content); if (p && p.attachmentType) t = p.attachmentType; } catch (e) {}
  }
  if (t === 'image') return '📷 Foto';
  if (t === 'video') return '🎬 Vídeo';
  if (t === 'audio' || t === 'voice') return '🎤 Audio';
  if (t === 'location') return '📍 Ubicación';
  if (t) return '📎 Archivo';
  return String(content || '').substring(0, 50);
}

function _formatTime(ts) {
  if (!ts) return '';
  var now = Date.now();
  var diff = now - ts;
  if (diff < 60000) return 'Ahora';
  if (diff < 3600000) return Math.floor(diff / 60000) + 'm';
  if (diff < 86400000) {
    var d = new Date(ts);
    return d.getHours().toString().padStart(2, '0') + ':' + d.getMinutes().toString().padStart(2, '0');
  }
  if (diff < 172800000) return 'Ayer';
  var days = ['Dom', 'Lun', 'Mar', 'Mie', 'Jue', 'Vie', 'Sab'];
  return days[new Date(ts).getDay()];
}

function _generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    var r = Math.random() * 16 | 0;
    var v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

function _loadDeviceUUID() {
  return new Promise(function(resolve) {
    if (_bleUUIDCache) { resolve(_bleUUIDCache); return; }
    var plugin = (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.NexoBLE) || null;
    if (plugin && typeof plugin.loadFromFile === 'function') {
      _safeNativeCall(plugin, 'loadFromFile', { filename: BLE_UUID_VAULT_FILE })
        .then(function(result) {
          if (result && result.exists && result.content) {
            try {
              var data = JSON.parse(result.content);
              if (data.uuid) { _bleUUIDCache = data.uuid; resolve(data.uuid); return; }
            } catch (e) {}
          }
          var newUUID = _generateUUID();
          _bleUUIDCache = newUUID;
          _safeNativeCall(plugin, 'saveToFile', {
            filename: BLE_UUID_VAULT_FILE,
            content: JSON.stringify({ uuid: newUUID, createdAt: Date.now() })
          }).catch(function() {});
          resolve(newUUID);
        }).catch(function() {
          var newUUID = _generateUUID();
          _bleUUIDCache = newUUID;
          resolve(newUUID);
        });
    } else {
      var newUUID = _generateUUID();
      _bleUUIDCache = newUUID;
      resolve(newUUID);
    }
  });
}

function _normId(id) {
  return (id || '').toString().toLowerCase().trim();
}

function _normMac(mac) {
  return (mac || '').toString().toLowerCase().replace(/[:-]/g, '').trim();
}

function _getBLEContacts() {
  if (window.vaultLoadContacts && typeof window.vaultLoadContacts === 'function') {
    return window.vaultLoadContacts();
  }
  return [];
}

function _saveBLEContacts(contacts) {
  if (window.vaultSaveContacts && typeof window.vaultSaveContacts === 'function') {
    window.vaultSaveContacts(contacts);
  }
}

function _addBLEContact(contact) {
  var uuid = _normId(contact.deviceUUID || contact.nexoId);
  if (!uuid) return false;
  var contacts = _getBLEContacts();
  var now = Date.now();
  var existingIdx = contacts.findIndex(function(c) {
    return _normId(c.nexoId || c.deviceUUID) === uuid;
  });
  if (existingIdx >= 0) {
    var existing = contacts[existingIdx];
    existing.nexoId = uuid;
    existing.deviceUUID = uuid;
    if (contact.name) existing.name = contact.name;
    existing.lastSeen = now;
    existing.online = true;
    if (contact.deviceId) existing.deviceId = contact.deviceId;
    _saveBLEContacts(contacts);
    return true;
  }
  contacts.push({
    nexoId: uuid,
    deviceUUID: uuid,
    name: contact.name || '',
    deviceId: contact.deviceId || null,
    addedAt: now,
    lastSeen: now,
    online: true,
    unreadCount: 0,
    lastMessage: ''
  });
  _saveBLEContacts(contacts);
  return true;
}

function _removeBLEContact(deviceUUID) {
  var uuid = _normId(deviceUUID);
  var contacts = _getBLEContacts().filter(function(c) { return _normId(c.nexoId || c.deviceUUID) !== uuid; });
  _saveBLEContacts(contacts);
}

function _isBLEContact(deviceUUID) {
  var uuid = _normId(deviceUUID);
  if (!uuid) return false;
  return _getBLEContacts().some(function(c) {
    return _normId(c.nexoId || c.deviceUUID) === uuid;
  });
}

function _getContactByUUID(deviceUUID) {
  var uuid = _normId(deviceUUID);
  return _getBLEContacts().find(function(c) { return _normId(c.nexoId || c.deviceUUID) === uuid; });
}

function _getContactByDeviceId(deviceId) {
  if (!deviceId) return null;
  var nd = _normMac(deviceId);
  return _getBLEContacts().find(function(c) { return _normMac(c.deviceId) === nd; });
}

function _getPinnedContacts() {
  return _blePinnedCache || [];
}

function _togglePinnedContact(deviceUUID) {
  var uuid = _normId(deviceUUID);
  var pinned = _getPinnedContacts();
  var idx = pinned.indexOf(uuid);
  if (idx >= 0) pinned.splice(idx, 1); else pinned.push(uuid);
  _blePinnedCache = pinned;
  var plugin = (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.NexoBLE) || null;
  if (plugin && typeof plugin.saveToFile === 'function') {
    _safeNativeCall(plugin, 'saveToFile', {
      filename: BLE_PINNED_VAULT_FILE,
      content: JSON.stringify({ pinned: pinned, savedAt: Date.now() })
    }).catch(function() {});
  }
  return idx < 0;
}

function _loadPinnedFromVault() {
  return new Promise(function(resolve) {
    var plugin = (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.NexoBLE) || null;
    if (plugin && typeof plugin.loadFromFile === 'function') {
      _safeNativeCall(plugin, 'loadFromFile', { filename: BLE_PINNED_VAULT_FILE })
        .then(function(result) {
          if (result && result.exists && result.content) {
            try {
              var data = JSON.parse(result.content);
              if (data.pinned && Array.isArray(data.pinned)) { _blePinnedCache = data.pinned; }
            } catch (e) {}
          }
          resolve();
        }).catch(function() { resolve(); });
    } else { resolve(); }
  });
}

function _loadSeqCounter() {
  return new Promise(function(resolve) {
    var plugin = (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.NexoBLE) || null;
    if (plugin && typeof plugin.loadFromFile === 'function') {
      _safeNativeCall(plugin, 'loadFromFile', { filename: BLE_SEQ_COUNTER_FILE })
        .then(function(result) {
          if (result && result.exists && result.content) {
            try { var data = JSON.parse(result.content); if (typeof data.seq === 'number') { resolve(data.seq); return; } } catch (e) {}
          }
          resolve(0);
        }).catch(function() { resolve(0); });
    } else { resolve(0); }
  });
}

function _saveSeqCounter(seq) {
  return new Promise(function(resolve) {
    var plugin = (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.NexoBLE) || null;
    if (plugin && typeof plugin.saveToFile === 'function') {
      _safeNativeCall(plugin, 'saveToFile', {
        filename: BLE_SEQ_COUNTER_FILE,
        content: JSON.stringify({ seq: seq, updatedAt: Date.now() })
      }).then(function() { resolve(); }).catch(function() { resolve(); });
    } else { resolve(); }
  });
}

function _isPinned(deviceUUID) {
  return _getPinnedContacts().indexOf(_normId(deviceUUID)) >= 0;
}

var BLE_STATES = {
  DISCONNECTED: 'disconnected', CONNECTING: 'connecting',
  DISCOVERING_SERVICES: 'discovering_services', NOTIFICATIONS_READY: 'notifications_ready',
  READY_TO_CHAT: 'ready_to_chat', ERROR: 'error', RECONNECTING: 'reconnecting'
};

var SUPERVISOR_STATES = {
  UNKNOWN: 'unknown', HEALTHY: 'healthy', CHECKING: 'checking',
  DEGRADED: 'degraded', ZOMBIE: 'zombie', RECONNECTING: 'reconnecting', OFFLINE: 'offline'
};

function _hasNativeMethod(plugin, method) {
  return plugin && typeof plugin[method] === 'function';
}

function _safeNativeCall(plugin, method, args) {
  return new Promise(function(resolve, reject) {
    if (!plugin) { reject(new Error('Plugin nativo no disponible')); return; }
    if (typeof plugin[method] !== 'function') { reject(new Error('Metodo ' + method + ' no disponible')); return; }
    try {
      var result = plugin[method](args);
      if (result && typeof result.then === 'function') {
        result.then(resolve).catch(reject);
      } else { resolve(result); }
    } catch (e) { reject(e); }
  });
}

function _safeDispatchEvent(eventName, detail) {
  try { window.dispatchEvent(new CustomEvent(eventName, { detail: detail })); } catch (e) {}
}

function _showToast(message, type) {
  type = type || 'info';
  var colors = { info: '#0082FC', warn: '#FFC107', error: '#FF5252', success: '#4CAF50' };
  var toast = document.createElement('div');
  toast.textContent = message;
  toast.style.cssText = 'position:fixed;top:24px;left:50%;transform:translateX(-50%);padding:12px 20px;border-radius:10px;background:' + (colors[type] || colors.info) + ';color:' + (type === 'warn' ? '#000' : '#fff') + ';font-size:14px;font-weight:600;z-index:2147483647;box-shadow:0 4px 16px rgba(0,0,0,0.4);opacity:0;transition:opacity 0.3s ease;pointer-events:none;max-width:80%;text-align:center;';
  document.body.appendChild(toast);
  requestAnimationFrame(function() { toast.style.opacity = '1'; });
  setTimeout(function() { toast.style.opacity = '0'; setTimeout(function() { if (toast.parentNode) toast.remove(); }, 300); }, 3500);
}

function _isControlPacket(content) {
  if (!content || typeof content !== 'string' || content.charAt(0) !== '{') return false;
  try {
    var obj = JSON.parse(content);
    if (obj.type === 'ack' || obj.type === 'read_receipt' || obj.type === 'ping' || obj.type === 'pong' ||
        obj.type === 'chat_meta' || obj.type === 'chat_chunk' || obj.type === 'block_ack' ||
        obj.type === 'file_meta' || obj.type === 'file_chunk' || obj.type === 'file_resume') return true;
    if (obj.t === 'c' || obj.t === 'f' || obj.t === 'n' || obj.t === 'a' || obj.t === 'ba' || obj.t === 'ss' || obj.t === 'sr') return true;
    return false;
  } catch (e) { return false; }
}

// Mensajes propios que deben reenviarse. Incluye 'sending'/'queued': tras cerrar la app ya no hay
// nada en vuelo y antes se quedaban así para siempre. Adjuntos en 'sending' los reanuda
// resumeOutgoingTransfers (ble_ack), no aquí, para no duplicar la transferencia.
function _isResendable(m) {
  if (!m || m._own !== true) return false;
  if (m.status === 'pending' || m.status === 'failed') return true;
  // v6.1.9: también adjuntos. Si la transferencia sigue viva, _isMsgInFlight la excluye y
  // ble_ack.sendFile reutiliza la que esté en curso con el mismo id (no se duplica).
  if (m.status === 'sending' || m.status === 'queued') return true;
  return false;
}

function _vaultUpdateMessageStatus(nexoId, msgId, status) {
  try {
    if (window.vaultUpdateMessageStatus && typeof window.vaultUpdateMessageStatus === 'function') {
      return window.vaultUpdateMessageStatus(nexoId, msgId, status);
    }
  } catch (e) {}
  return Promise.resolve();
}

function _vaultGetOrCreateContact(nexoId, displayName, deviceName) {
  try {
    if (window.vaultGetOrCreateContact && typeof window.vaultGetOrCreateContact === 'function') {
      return window.vaultGetOrCreateContact(nexoId, displayName || deviceName);
    }
  } catch (e) {}
  return Promise.resolve();
}

function _vaultAppendMessage(nexoId, msg, isOwn) {
  try {
    if (window.vaultAppendMessage && typeof window.vaultAppendMessage === 'function') {
      return window.vaultAppendMessage(nexoId, msg, isOwn);
    }
  } catch (e) {}
  return Promise.resolve();
}

function _hydrateAttachments(msgs) {
  try {
    if (window.vaultHydrateAttachments && typeof window.vaultHydrateAttachments === 'function') return window.vaultHydrateAttachments(msgs);
  } catch (e) {}
  return Promise.resolve(msgs);
}

function _vaultLoadMessages(nexoId) {
  try {
    if (window.vaultLoadMessages && typeof window.vaultLoadMessages === 'function') {
      return window.vaultLoadMessages(nexoId);
    }
  } catch (e) {}
  return Promise.resolve([]);
}

function _autoScanRegister(nexoId) {
  try { if (window.autoScan && typeof window.autoScan.register === 'function') window.autoScan.register(nexoId); } catch (e) {}
}

function _autoScanUnregister(nexoId) {
  try { if (window.autoScan && typeof window.autoScan.unregister === 'function') window.autoScan.unregister(nexoId); } catch (e) {}
}

function _autoScanStart() {
  try { if (window.autoScan && typeof window.autoScan.start === 'function') window.autoScan.start(); } catch (e) {}
}

export class BLEInterface {
  constructor(bleMesh) {
    this.bleMesh = bleMesh;
    this.isScanning = false;
    this.foundDevices = new Map();
    this.connectedDevices = new Map();
    this.isVisible = false;
    this.elements = {};
    this.newDevicesCount = 0;
    this.nativePlugin = (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.NexoBLE) || null;
    this.isDummyMode = !bleMesh && !this.nativePlugin;
    this.meshType = this._detectMeshType();
    this.isAdvertising = false;
    this.canAdvertise = false;
    this.localDeviceName = '';
    this.localDeviceUUID = null;
    this.localNexoId = null;
    this._activeChatDeviceId = null;
    this._activeChatDeviceIdNative = null;
    this._deviceStates = new Map();
    this._nexoIdToMac = new Map();
    this._macToNexoId = new Map();
    this._receivedMessageIds = new Set();
    this._maxMessageIds = 1000;
    this._dedupTTL = 300000;
    this._pendingMessageQueue = new Map();
    this._readyResolvers = new Map();
    this._notificationFallbackTimers = new Map();
    this.ackSystem = null;
    this._localSeqCounter = 0;
    this._seqCounterLoaded = false;
    this._pendingPings = new Map();
    this._lastPongTime = new Map();
    this._pingInterval = null;
    this._pingIntervalMs = 8000;
    this._pingTimeoutMs = 3000;
    this._pingMaxFails = 2;
    this._pingFailCount = new Map();
    this._supervisorStates = new Map();
    this._supervisorTimer = null;
    this._supervisorIntervalMs = 6000;
    this._backoffTimers = new Map();
    this._reconnectAttempts = new Map();
    this._notifiedPeers = new Set();
    this._cameraBlePaused = false;
    this._cameraBleResumeWaiters = [];
    this._cameraBlePausedDevices = [];
    this._cameraBleWasAdvertising = false;
    this._lostPeers = new Set();
    this._mtuByDevice = new Map(); // MAC normalizada -> MTU negociado (lo devuelve sendMessage nativo)
    this._reconnectScanTimer = null;
    this._reconnectScanAttempts = 0;
    console.log('[BLEInterface] v6.1.1-NEXO iniciado');
  }

  _detectMeshType() {
    if (!this.bleMesh) return 'none';
    if (typeof this.bleMesh.getState === 'function') return 'nordic';
    if (typeof this.bleMesh.getStatus === 'function') return 'hybrid';
    return 'unknown';
  }

  init() {
    var self = this;
    this.createDOM();
    this.setupEventListeners();
    if (!this.nativePlugin) {
      this.nativePlugin = (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.NexoBLE) || null;
      if (this.nativePlugin) this.isDummyMode = !this.bleMesh && !this.nativePlugin;
    }
    this._loadContactsAndInit();
    return this;
  }

  setAckSystem(ackSystem) {
    this.ackSystem = ackSystem;
    console.log('[BLEInterface] AckSystem vinculado');
  }

  getBLEContacts() { return _getBLEContacts(); }

  _loadContactsAndInit() {
    var self = this;
    var contacts = _getBLEContacts();
    if (contacts && contacts.length > 0) {
      contacts.forEach(function(c) {
        if (c.deviceId && (c.nexoId || c.deviceUUID)) {
          var nd = _normMac(c.deviceId);
          var nx = _normId(c.nexoId || c.deviceUUID);
          if (nd && nx) { self._nexoIdToMac.set(nx, nd); self._macToNexoId.set(nd, nx); }
        }
      });
    }
    _loadPinnedFromVault().then(function() { self._continueInit(); }).catch(function() { self._continueInit(); });
  }

  _continueInit() {
    var self = this;
    var selfSeq = this;
    _loadSeqCounter().then(function(seq) { selfSeq._localSeqCounter = seq; selfSeq._seqCounterLoaded = true; }).catch(function() { selfSeq._localSeqCounter = 0; selfSeq._seqCounterLoaded = true; });
    if (this.isDummyMode) { this.updateStatus('OFFLINE (Dummy)'); }
    else {
      this.updateStatus();
      this._setupNativeScanListeners();
      this._setupNativeConnectionListeners();
      this._setupNativePayloadListener();
      this._setupNativeStateListeners();
      this._setupNativeServerReadyListener();
      setTimeout(function() { self._seedNativeConnections(); }, 300);
      this._loadLocalDeviceInfo();
      this._initVisibility();
      this._initNexoId();
      this._autoStartAdvertising();
    }
    _loadDeviceUUID().then(function(uuid) { self.localDeviceUUID = uuid; }).catch(function() { self.localDeviceUUID = _generateUUID(); });
    this._cleanupStaleStates();
    this._startConnectionSupervisor();
    this._setupAppStateListener();
    this.elements.panel.classList.remove('active');
    this.elements.overlay.classList.remove('active');
    this.renderContactsList();
    this.renderOnlineStrip();
    setTimeout(function() { if (!self.isDummyMode && self.nativePlugin) self._autoScanForKnownContacts(); }, 500);
    setTimeout(function() { self._flushAllPendingMessages(); }, 3000);
    // v6.1.7: antes un solo escaneo de 6 s al abrir; si no veía al otro, nadie volvía a buscar
    setTimeout(function() { if (!self.isDummyMode && self.nativePlugin) self._startPresenceSearch(120000); }, 7000);
    setTimeout(function() { self._backfillLastMessageAt(); }, 1500);
  }

  _cleanupStaleStates() {
    var self = this;
    var now = Date.now();
    var keysToDelete = [];
    self._deviceStates.forEach(function(state, deviceId) { if (now - (state.timestamp || 0) > 10000) keysToDelete.push(deviceId); });
    keysToDelete.forEach(function(key) {
      self._deviceStates.delete(key);
      // connectedDevices y supervisor usan el deviceId nativo (con ':'), no la clave normalizada
      self.connectedDevices.forEach(function(d, deviceId) {
        if (_normMac(deviceId) !== key) return;
        self.connectedDevices.delete(deviceId);
        self._supervisorStates.delete(deviceId); self._lastPongTime.delete(deviceId); self._pingFailCount.delete(deviceId);
      });
    });
    if (keysToDelete.length > 0) console.log('[BLEInterface] Cleanup stale states:', keysToDelete.length);
  }

  _flushAllPendingMessages() {
    var self = this;
    console.log('[BLEInterface] Flush global pending...');
    var contacts = _getBLEContacts();
    if (!contacts || contacts.length === 0) { console.log('[BLEInterface] No contactos'); return; }
    contacts.forEach(function(contact) {
      var nx = _normId(contact.nexoId || contact.deviceUUID);
      if (!nx) return;
      var getPending = (window.vaultGetPendingMessages && typeof window.vaultGetPendingMessages === 'function')
        ? window.vaultGetPendingMessages(nx)
        : _vaultLoadMessages(nx).then(function(msgs) { return msgs.filter(_isResendable); });
      getPending.then(function(pending) {
        if (!pending || pending.length === 0) return;
        console.log('[BLEInterface]', nx, 'tiene', pending.length, 'pending');
        var deviceId = contact.deviceId || self._resolveDeviceIdForNexoId(nx);
        if (deviceId) {
          var state = self._getDeviceState(deviceId);
          var isReady = state.state === BLE_STATES.READY_TO_CHAT || state.state === BLE_STATES.NOTIFICATIONS_READY;
          if (isReady) { self._resendPendingMessages(nx); }
          else {
            self._markPeerLost(nx);
            if (state.state !== BLE_STATES.CONNECTING && state.state !== BLE_STATES.DISCOVERING_SERVICES) {
              self._autoConnectGATT(deviceId, { name: contact.name, deviceUUID: nx });
            }
          }
        } else { self._markPeerLost(nx); self._autoScanForKnownContacts(); }
      }).catch(function(e) { console.warn('[BLEInterface] Error flush', nx, e.message); });
    });
  }

  _startConnectionSupervisor() {
    var self = this;
    if (self._supervisorTimer) { clearInterval(self._supervisorTimer); self._supervisorTimer = null; }
    self._supervisorTimer = setInterval(function() { self._runSupervisorCycle(); }, self._supervisorIntervalMs);
    console.log('[BLEInterface] Supervisor iniciado');
  }

  _stopConnectionSupervisor() {
    if (this._supervisorTimer) { clearInterval(this._supervisorTimer); this._supervisorTimer = null; }
    this._pendingPings.forEach(function(p) { clearTimeout(p.timer); });
    this._pendingPings.clear();
    this._backoffTimers.forEach(function(t) { clearTimeout(t); });
    this._backoffTimers.clear();
  }

  /**
   * v6.1.1: No forzar reconexión destructiva si hay transferencia de archivo activa.
   */
  _hasActiveFileTransfer(deviceId) {
    try {
      if (!this.ackSystem) return false;
      if (typeof this.ackSystem.hasActiveTransfer === 'function') {
        return this.ackSystem.hasActiveTransfer(deviceId);
      }
      // Fallback: mirar si hay outgoing transfers pendientes
      if (typeof this.ackSystem.getOutgoingTransfers === 'function') {
        var outs = this.ackSystem.getOutgoingTransfers(deviceId);
        return outs && outs.length > 0;
      }
    } catch (e) {}
    return false;
  }

  _runSupervisorCycle() {
    var self = this;
    if (self._cameraBlePaused) return;
    if (!self._activeChatDeviceId && self.connectedDevices.size === 0) return;
    self.connectedDevices.forEach(function(device, deviceId) {
      var state = self._getDeviceState(deviceId);
      if (state.state !== BLE_STATES.READY_TO_CHAT && state.state !== BLE_STATES.NOTIFICATIONS_READY) return;

      // Protección: no matar la conexión mientras se envía un archivo
      if (self._hasActiveFileTransfer(deviceId)) {
        console.log('[BLEInterface] Supervisor: transferencia activa, skip ping/zombie para', deviceId);
        return;
      }

      var lastPong = self._lastPongTime.get(deviceId) || 0;
      var timeSincePong = Date.now() - lastPong;
      if (lastPong === 0 || timeSincePong > 16000) {
        self._pingDevice(deviceId).then(function(result) {
          self._pingFailCount.set(deviceId, 0);
          var prevState = self._supervisorStates.get(deviceId);
          if (prevState && prevState.state === SUPERVISOR_STATES.ZOMBIE) {
            var nx = self._macToNexoId.get(_normMac(deviceId));
            if (nx && self.ackSystem && self.ackSystem.sendSessionSync) {
              console.log('[BLEInterface] Zombie recovery, enviando session sync a', nx);
              self.ackSystem.sendSessionSync(deviceId, nx);
            }
          }
          self._supervisorStates.set(deviceId, { state: SUPERVISOR_STATES.HEALTHY, since: Date.now(), rtt: result.rtt });
        }).catch(function(err) {
          var fails = (self._pingFailCount.get(deviceId) || 0) + 1;
          self._pingFailCount.set(deviceId, fails);
          if (fails >= self._pingMaxFails) {
            // Solo forzar si NO hay transferencia activa
            if (!self._hasActiveFileTransfer(deviceId)) {
              self._supervisorStates.set(deviceId, { state: SUPERVISOR_STATES.ZOMBIE, since: Date.now() });
              self._forceDisconnectAndReconnect(deviceId);
            } else {
              console.log('[BLEInterface] Supervisor: zombie detectado pero transferencia activa → no reconectar');
            }
          } else {
            self._supervisorStates.set(deviceId, { state: SUPERVISOR_STATES.DEGRADED, since: Date.now(), failCount: fails });
          }
        });
      }
    });
  }

  _pingDevice(deviceId) {
    var self = this;
    return new Promise(function(resolve, reject) {
      if (!deviceId) { reject(new Error('No deviceId')); return; }
      var state = self._getDeviceState(deviceId);
      if (state.state !== BLE_STATES.READY_TO_CHAT && state.state !== BLE_STATES.NOTIFICATIONS_READY) { reject(new Error('Not ready')); return; }
      var pingId = 'ping_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4);
      var payload = JSON.stringify({ v: 1, type: 'ping', pingId: pingId, ts: Date.now(), fromNexoId: self.localNexoId || self.localDeviceUUID });
      var timer = setTimeout(function() {
        var p = self._pendingPings.get(pingId);
        if (p) { self._pendingPings.delete(pingId); reject(new Error('Ping timeout')); }
      }, self._pingTimeoutMs);
      self._pendingPings.set(pingId, { resolve: resolve, reject: reject, timer: timer, ts: Date.now() });
      self._sendMessageNative(deviceId, payload, pingId).catch(function(e) {
        var p = self._pendingPings.get(pingId);
        if (p) { clearTimeout(p.timer); self._pendingPings.delete(pingId); reject(e); }
      });
    });
  }

  _forceDisconnectAndReconnect(deviceId) {
    var self = this;
    self._setDeviceState(deviceId, BLE_STATES.DISCONNECTED);
    self.connectedDevices.delete(deviceId);
    self._supervisorStates.set(deviceId, { state: SUPERVISOR_STATES.RECONNECTING, since: Date.now() });
    var oldTimer = self._backoffTimers.get(deviceId);
    if (oldTimer) { clearTimeout(oldTimer); self._backoffTimers.delete(deviceId); }
    if (self.nativePlugin && _hasNativeMethod(self.nativePlugin, 'disconnectDevice')) {
      _safeNativeCall(self.nativePlugin, 'disconnectDevice', { deviceId: deviceId })
        .catch(function() {}).finally(function() { setTimeout(function() { self._attemptAutoReconnect(deviceId); }, 500); });
    } else { setTimeout(function() { self._attemptAutoReconnect(deviceId); }, 500); }
    var nx = self._macToNexoId.get(_normMac(deviceId));
    _safeDispatchEvent('nexo:ble:deviceDisconnected', { deviceId: deviceId, deviceUUID: nx, reason: 'supervisor_zombie' });
  }

  _attemptAutoReconnect(deviceId) {
    var self = this;
    var nx = self._macToNexoId.get(_normMac(deviceId));
    self._autoScanForKnownContacts();
    if (nx) {
      var contact = _getContactByUUID(nx);
      if (contact && contact.deviceId) setTimeout(function() { self._autoConnectGATT(contact.deviceId, { name: contact.name, deviceUUID: nx }); }, 800);
    }
    var attempt = self._reconnectAttempts.get(deviceId) || 0;
    var delay = Math.min(2000 * Math.pow(2, attempt), 30000);
    self._reconnectAttempts.set(deviceId, attempt + 1);
    var timer = setTimeout(function() {
      self._reconnectAttempts.delete(deviceId);
      var currentState = self._getDeviceState(deviceId);
      if (currentState.state === BLE_STATES.DISCONNECTED || currentState.state === BLE_STATES.ERROR) self._attemptAutoReconnect(deviceId);
    }, delay);
    self._backoffTimers.set(deviceId, timer);
  }

  /**
   * v6.1.1: Resolución robusta de deviceId.
   * Prioridad: mapeo actualizado → contact.deviceId → connectedDevices → foundDevices.
   */
  _resolveDeviceIdForNexoId(nexoId) {
    var nx = _normId(nexoId);
    if (!nx) return null;

    // 0. v6.1.6: preferir un enlace YA LISTO con ese NEXO ID. Android usa direcciones distintas para
    // anunciarse y para conectarse como cliente: el otro puede estar conectado por una dirección
    // distinta de la del escaneo.
    var self = this;
    var ready = null;
    this._deviceStates.forEach(function(st, key) {
      if (ready || (st.state !== BLE_STATES.READY_TO_CHAT && st.state !== BLE_STATES.NOTIFICATIONS_READY)) return;
      if (_normId(self._macToNexoId.get(key)) === nx) ready = key;
    });
    if (ready) return ready;

    // 1. Mapeo vivo
    var mappedMac = this._nexoIdToMac.get(nx);
    if (mappedMac) return mappedMac;

    // 2. Contacto en vault
    var contact = _getContactByUUID(nx);
    if (contact && contact.deviceId) {
      var nd = _normMac(contact.deviceId);
      if (nd) {
        this._nexoIdToMac.set(nx, nd);
        this._macToNexoId.set(nd, nx);
        return nd;
      }
    }

    // 3. Dispositivos conectados
    var found = null;
    this.connectedDevices.forEach(function(d) {
      if (!found && _normId(d.deviceUUID) === nx) found = d.id;
    });
    if (found) return found;

    // 4. Dispositivos encontrados en scan
    this.foundDevices.forEach(function(d) {
      if (!found && _normId(d.deviceUUID) === nx) found = d.id;
    });
    return found;
  }

  getMtu(deviceId) {
    var m = this._mtuByDevice.get(_normMac(deviceId));
    if (m) return m;
    var nx = this._macToNexoId.get(_normMac(deviceId));
    var mapped = nx ? this._nexoIdToMac.get(nx) : null;
    return (mapped && this._mtuByDevice.get(mapped)) || 0;
  }

  _isMsgInFlight(msgId) {
    if (!msgId) return false;
    var found = false;
    this._pendingMessageQueue.forEach(function(q) { q.forEach(function(it) { if (it.messageId === msgId) found = true; }); });
    if (found) return true;
    var ack = this.ackSystem;
    if (ack && ack.pendingAcks && ack.pendingAcks.has(msgId)) return true;
    if (ack && ack.outgoingStreams && ack.outgoingStreams.has(msgId)) return true;
    return false;
  }

  // v6.1.6: el nativo puede tener conexiones abiertas desde antes de que el JS escuchara (app recién
  // abierta): sus eventos onDeviceConnected se perdieron. Se consultan y se dan por listas.
  _seedNativeConnections() {
    var self = this;
    if (!self.nativePlugin || !_hasNativeMethod(self.nativePlugin, 'getConnectedDevices')) return;
    _safeNativeCall(self.nativePlugin, 'getConnectedDevices', {}).then(function(res) {
      var list = (res && res.devices) || [];
      list.forEach(function(d) {
        var deviceId = d.id || d.address;
        if (!deviceId || !d.ready) return;
        var st = self._getDeviceState(deviceId);
        if (st.state === BLE_STATES.READY_TO_CHAT || st.state === BLE_STATES.NOTIFICATIONS_READY) return;
        var contact = _getContactByDeviceId(deviceId);
        var nx = self._macToNexoId.get(_normMac(deviceId)) || (contact ? _normId(contact.nexoId || contact.deviceUUID) : null);
        self.connectedDevices.set(deviceId, { id: deviceId, name: d.name || '', direction: d.direction, role: d.role, servicesReady: true, deviceUUID: nx });
        self._setDeviceState(deviceId, BLE_STATES.READY_TO_CHAT, { role: d.role, seeded: true });
        console.log('[BLEInterface] Conexión existente recuperada al arrancar:', deviceId, nx || '(sin id)');
        if (nx) {
          self._notifyPeerReady(deviceId, nx);
          if (self.ackSystem && self.ackSystem.sendSessionSync) self.ackSystem.sendSessionSync(deviceId, nx);
          self._resendPendingMessages(nx);
        }
      });
    }).catch(function() {});
  }

  // v6.1.6: cualquier paquete del otro prueba que su app está viva: reenviar lo pendiente ya
  // (antes se esperaba a timeouts o a la siguiente reconexión). Máx. una vez cada 4 s por contacto.
  _kickPeer(deviceId, nexoId) {
    var nx = _normId(nexoId);
    if (!nx || !deviceId) return;
    var nd = _normMac(deviceId);
    if (!this._macToNexoId.get(nd)) this._macToNexoId.set(nd, nx);
    if (!this._nexoIdToMac.get(nx)) this._nexoIdToMac.set(nx, nd);
    if (!this._lastKick) this._lastKick = new Map();
    var now = Date.now();
    if (now - (this._lastKick.get(nx) || 0) < 4000) return;
    this._lastKick.set(nx, now);
    var st = this._getDeviceState(deviceId);
    if (st.state === BLE_STATES.READY_TO_CHAT || st.state === BLE_STATES.NOTIFICATIONS_READY) {
      this._processPendingMessages(deviceId);
      this._resendPendingMessages(nx);
    }
  }

  _markPeerLost(nexoId) {
    var nx = _normId(nexoId);
    if (!nx) return;
    this._lostPeers.add(nx);
    this._startReconnectScanLoop();
  }

  // v6.1.7: re-búsqueda sin rendirse mientras haya algo que entregar. Antes: máx. 40 intentos (10 min)
  // y nada con la app oculta; si el otro volvía después, nadie reconectaba.
  //  - visible: cada 15 s los 2 primeros minutos, luego cada 60 s
  //  - oculta: cada 60 s con escaneo filtrado (sin filtro Android no da resultados con pantalla apagada)
  //  - pasados 30 min solo sigue (cada 5 min) si quedan mensajes pendientes para un contacto perdido
  //  - además, al abrir/volver a la app se busca 2 min a todo contacto no conectado (puede tener
  //    mensajes para nosotros)
  _startReconnectScanLoop() {
    var self = this;
    if (self._reconnectScanTimer || self.isDummyMode || !self.nativePlugin) return;
    self._reconnectScanAttempts = 0;
    self._reconnectLoopStart = Date.now();
    function schedule(ms) { self._reconnectScanTimer = setTimeout(tick, ms); }
    function tick() {
      self._reconnectScanTimer = null;
      var now = Date.now();
      var presence = now < (self._presenceUntil || 0) && self._hasUnreadyContacts();
      if (self._lostPeers.size === 0 && !presence) { self._reconnectScanAttempts = 0; return; }
      var elapsed = now - self._reconnectLoopStart;
      var hidden = typeof document !== 'undefined' && document.visibilityState === 'hidden';
      var interval = hidden ? 60000 : (self._reconnectScanAttempts < 8 ? 15000 : 60000);
      var go = function() {
        if (!self._cameraBlePaused && !self.isScanning) {
          self._reconnectScanAttempts++;
          console.log('[BLEInterface] Re-búsqueda de contactos', Array.from(self._lostPeers), presence ? '(+presencia)' : '', 'intento', self._reconnectScanAttempts, hidden ? 'oculta' : '');
          self._autoScanForKnownContacts({ filtered: hidden });
        }
      };
      if (elapsed < 1800000 || presence) { go(); schedule(interval); return; }
      self._lostPeersWithPending().then(function(withPending) {
        if (withPending.length === 0) { self._reconnectScanAttempts = 0; return; }
        go(); schedule(300000);
      }).catch(function() { schedule(300000); });
    }
    schedule(2000);
  }

  _hasUnreadyContacts() {
    var self = this;
    return (_getBLEContacts() || []).some(function(c) {
      var nx = _normId(c.nexoId || c.deviceUUID);
      if (!nx) return false;
      var dev = self._resolveDeviceIdForNexoId(nx);
      if (!dev) return true;
      var st = self._getDeviceState(dev).state;
      return st !== BLE_STATES.READY_TO_CHAT && st !== BLE_STATES.NOTIFICATIONS_READY;
    });
  }

  _lostPeersWithPending() {
    var peers = Array.from(this._lostPeers);
    return Promise.all(peers.map(function(nx) {
      return _vaultLoadMessages(nx).then(function(msgs) { return (msgs || []).some(_isResendable) ? nx : null; }).catch(function() { return null; });
    })).then(function(r) { return r.filter(Boolean); });
  }

  // v6.1.7: al abrir la app o volver a ella, buscar un rato a los contactos no conectados
  _startPresenceSearch(ms) {
    this._presenceUntil = Date.now() + (ms || 120000);
    if (this._reconnectScanTimer) { clearTimeout(this._reconnectScanTimer); this._reconnectScanTimer = null; }
    this._startReconnectScanLoop();
  }

  _notifyPeerReady(deviceId, nexoId) {
    if (!deviceId || !nexoId) return;
    this._lostPeers.delete(_normId(nexoId));
    var ndPeer = _normMac(deviceId);
    if (!this._macToNexoId.get(ndPeer)) this._macToNexoId.set(ndPeer, _normId(nexoId));
    this._processPendingMessages(deviceId);
    var key = _normMac(deviceId) + ':' + _normId(nexoId);
    if (this._notifiedPeers.has(key)) { console.log('[BLEInterface] Peer ready dup ignorado:', nexoId); return; }
    this._notifiedPeers.add(key);
    console.log('[BLEInterface] Peer ready:', nexoId);
    _safeDispatchEvent('nexo:ble:peerReady', { deviceId: deviceId, nexoId: nexoId });
  }

  getNextSeq() {
    this._localSeqCounter = (this._localSeqCounter + 1) >>> 0;
    _saveSeqCounter(this._localSeqCounter);
    return this._localSeqCounter;
  }

  _initNexoId() {
    var self = this;
    _getOrCreateNexoId().then(function(nexoId) {
      self.localNexoId = nexoId;
      console.log('[BLEInterface] NEXO ID:', nexoId);
      if (self.nativePlugin && _hasNativeMethod(self.nativePlugin, 'setAdvertisingData')) {
        _safeNativeCall(self.nativePlugin, 'setAdvertisingData', { nexoId: nexoId }).catch(function() {});
      }
    });
  }

  _setupAppStateListener() {
    var self = this;
    // v6.1.7: @capacitor/app no está instalado: el bloque de abajo nunca se activaba y al volver a la app
    // no se reconectaba ni se vaciaba la cola. Ahora avisan el nativo (onAppStateChange) y el WebView
    // (visibilitychange); se usa el primero que llegue.
    if (self.nativePlugin && _hasNativeMethod(self.nativePlugin, 'addListener')) {
      self.nativePlugin.addListener('onAppStateChange', function(st) {
        if (st && st.isActive) self._onAppResumed('nativo');
      });
    }
    if (typeof document !== 'undefined' && document.addEventListener) {
      document.addEventListener('visibilitychange', function() {
        if (document.visibilityState === 'visible') self._onAppResumed('visibilidad');
      });
    }
    if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App) {
      var appPlugin = window.Capacitor.Plugins.App;
      if (_hasNativeMethod(appPlugin, 'addListener')) {
        appPlugin.addListener('appStateChange', function(state) {
          try {
            if (state && state.isActive === true) {
              self.renderContactsList(); self.renderOnlineStrip();
              setTimeout(function() { if (!self.isDummyMode && self.nativePlugin && !self.isScanning) self._autoScanForKnownContacts(); }, 500);
              if (!self.isAdvertising && self.nativePlugin && _hasNativeMethod(self.nativePlugin, 'startAdvertising')) {
                _safeNativeCall(self.nativePlugin, 'startAdvertising', {}).then(function() { self.isAdvertising = true; self.updateVisibilityButton(); }).catch(function() {});
              }
              self._cleanupStaleStates();
              setTimeout(function() { self._flushAllPendingMessages(); }, 2000);
            }
          } catch (e) {}
        });
      }
    }
  }

  _onAppResumed(source) {
    var self = this;
    var now = Date.now();
    if (now - (self._lastResumeAt || 0) < 2000) return;
    self._lastResumeAt = now;
    if (self.isDummyMode || !self.nativePlugin) return;
    console.log('[BLEInterface] App de vuelta en primer plano (' + source + ')');
    try { self.renderContactsList(); self.renderOnlineStrip(); } catch (e) {}
    self._cleanupStaleStates();
    // Conexiones que siguieron vivas: pedir al otro lo que nos falte y reenviar lo nuestro
    self._seedNativeConnections();
    self._deviceStates.forEach(function(st, key) {
      if (st.state !== BLE_STATES.READY_TO_CHAT && st.state !== BLE_STATES.NOTIFICATIONS_READY) return;
      var nx = self._macToNexoId.get(key);
      if (!nx) return;
      if (self.ackSystem && self.ackSystem.sendSessionSync) self.ackSystem.sendSessionSync(key, nx);
      self._resendPendingMessages(nx);
    });
    self._startPresenceSearch(120000);
    setTimeout(function() { self._flushAllPendingMessages(); }, 1500);
  }

  _autoStartAdvertising() {
    var self = this;
    if (self.isDummyMode || !self.nativePlugin) return Promise.resolve();
    if (!_hasNativeMethod(self.nativePlugin, 'isBluetoothEnabled')) return Promise.resolve();
    return _safeNativeCall(self.nativePlugin, 'isBluetoothEnabled', {})
      .then(function(btState) {
        var canAdv = btState && btState.canAdvertise;
        var serverReady = btState && btState.serverReady;
        if ((canAdv || serverReady) && _hasNativeMethod(self.nativePlugin, 'startAdvertising')) {
          return _safeNativeCall(self.nativePlugin, 'startAdvertising', {}).then(function() { self.isAdvertising = true; self.canAdvertise = true; self.updateVisibilityButton(); }).catch(function() {});
        }
      }).catch(function() {});
  }

  _loadLocalDeviceInfo() {
    var self = this;
    if (!self.nativePlugin || !_hasNativeMethod(self.nativePlugin, 'getLocalDeviceInfo')) return Promise.resolve();
    return _safeNativeCall(self.nativePlugin, 'getLocalDeviceInfo', {}).then(function(info) { self.localDeviceName = (info && info.deviceName) || ''; }).catch(function() {});
  }

  _setupNativeScanListeners() {
    if (!this.nativePlugin) return;
    if (!_hasNativeMethod(this.nativePlugin, 'addListener')) return;
    var self = this;
    this._nativeDeviceFoundListener = this.nativePlugin.addListener('onDeviceFound', function(data) {
      try {
        var deviceId = data.deviceId || '';
        var name = data.name || '';
        var nexoId = data.nexoId || '';
        if (!deviceId) return;
        if (self._cameraBlePaused) {
          console.log('[BLEInterface] Scan event ignorado (cámara pausada):', deviceId);
          return;
        }
        var nd = _normMac(deviceId);
        var nx = _normId(nexoId);
        if (nd && nx) { self._nexoIdToMac.set(nx, nd); self._macToNexoId.set(nd, nx); }
        self.onDeviceFound({ id: deviceId, name: name, rssi: data.rssi, nexoId: nexoId });
      } catch (e) {}
    });
    this._nativeScanFailedListener = this.nativePlugin.addListener('onScanFailed', function(data) {
      try { self.isScanning = false; self.updateScanButton(); } catch (e) {}
    });
  }

  _setupNativeServerReadyListener() {
    if (!this.nativePlugin) return;
    if (!_hasNativeMethod(this.nativePlugin, 'addListener')) return;
    var self = this;
    this._nativeServerReadyListener = this.nativePlugin.addListener('onServerReady', function(data) {
      try { console.log('[BLEInterface] onServerReady:', data); } catch (e) {}
    });
  }

  _setupNativeConnectionListeners() {
    if (!this.nativePlugin) return;
    if (!_hasNativeMethod(this.nativePlugin, 'addListener')) return;
    var self = this;
    this._nativeDeviceConnectedListener = this.nativePlugin.addListener('onDeviceConnected', function(data) {
      try {
        var deviceId = data.deviceId || '';
        if (!deviceId) return;
        var nd = _normMac(deviceId);
        var peerUUID = null;
        var contact = _getContactByDeviceId(deviceId);
        if (contact) peerUUID = contact.nexoId || contact.deviceUUID;
        var displayName = data.name || (contact ? contact.name : null) || '';
        self.connectedDevices.set(deviceId, { id: deviceId, name: displayName, direction: data.direction || 'outgoing', role: data.role || 'client', servicesReady: data.servicesReady || false, deviceUUID: peerUUID });
        self._setDeviceState(deviceId, data.role === 'server' ? BLE_STATES.READY_TO_CHAT : BLE_STATES.CONNECTING, { direction: data.direction, role: data.role, deviceUUID: peerUUID });
        if (peerUUID && nd) { var nx = _normId(peerUUID); self._nexoIdToMac.set(nx, nd); self._macToNexoId.set(nd, nx); }
        if (peerUUID) {
          var contacts = _getBLEContacts();
          var idx = contacts.findIndex(function(c) { return _normId(c.nexoId || c.deviceUUID) === _normId(peerUUID); });
          if (idx >= 0) { contacts[idx].online = true; contacts[idx].lastSeen = Date.now(); contacts[idx].deviceId = deviceId; _saveBLEContacts(contacts); self.renderContactsList(); self.renderOnlineStrip(); }
          _autoScanUnregister(peerUUID);
        }
        self._pingFailCount.set(deviceId, 0);
        self._supervisorStates.set(deviceId, { state: SUPERVISOR_STATES.HEALTHY, since: Date.now() });
        _safeDispatchEvent('nexo:ble:deviceConnected', { deviceId: deviceId, deviceUUID: peerUUID, name: displayName });
        if (peerUUID) {
          setTimeout(function() {
            var st = self._getDeviceState(deviceId);
            if (st.state === BLE_STATES.READY_TO_CHAT || st.state === BLE_STATES.NOTIFICATIONS_READY) {
              self._notifyPeerReady(deviceId, peerUUID);
              self._processPendingMessages(deviceId);
              self._resendPendingMessages(peerUUID);
            }
          }, 1500);
        }
        setTimeout(function() {
          if (self.ackSystem && self.ackSystem.sendSessionSync && peerUUID) {
            self.ackSystem.sendSessionSync(deviceId, peerUUID);
          }
        }, 2000);
      } catch (e) {}
    });

    this._nativeDeviceDisconnectedListener = this.nativePlugin.addListener('onDeviceDisconnected', function(data) {
      try {
        var deviceId = data.deviceId || '';
        if (!deviceId) return;
        // Si la desconexión es por pausa de cámara, no limpiar mapeos ni lanzar eventos de "offline"
        if (self._cameraBlePaused) {
          console.log('[BLEInterface] Desconexión causada por pausa de cámara:', deviceId);
          self.connectedDevices.delete(deviceId);
          self._setDeviceState(deviceId, BLE_STATES.DISCONNECTED);
          return;
        }
        var peerUUID = null;
        var contact = _getContactByDeviceId(deviceId);
        if (contact) peerUUID = contact.nexoId || contact.deviceUUID;
        self.connectedDevices.delete(deviceId);
        self._setDeviceState(deviceId, BLE_STATES.DISCONNECTED);
        self._supervisorStates.set(deviceId, { state: SUPERVISOR_STATES.OFFLINE, since: Date.now() });
        self._lastPongTime.delete(deviceId);
        self._pingFailCount.delete(deviceId);
        if (peerUUID) { var key = _normMac(deviceId) + ':' + _normId(peerUUID); self._notifiedPeers.delete(key); }
        if (peerUUID) {
          var contacts = _getBLEContacts();
          var idx = contacts.findIndex(function(c) { return _normId(c.nexoId || c.deviceUUID) === _normId(peerUUID); });
          if (idx >= 0) { contacts[idx].online = false; _saveBLEContacts(contacts); self.renderContactsList(); self.renderOnlineStrip(); }
          self._markPeerLost(peerUUID);
          _autoScanRegister(peerUUID);
          _autoScanStart();
        }
        _safeDispatchEvent('nexo:ble:deviceDisconnected', { deviceId: deviceId, deviceUUID: peerUUID });
        if (self.isAdvertising && self.nativePlugin && _hasNativeMethod(self.nativePlugin, 'startAdvertising')) {
          _safeNativeCall(self.nativePlugin, 'startAdvertising', {}).catch(function() {});
        }
      } catch (e) {}
    });
  }

  _setupNativeStateListeners() {
    if (!this.nativePlugin) return;
    if (!_hasNativeMethod(this.nativePlugin, 'addListener')) return;
    var self = this;
    this._nativeServicesReadyListener = this.nativePlugin.addListener('onServicesReady', function(data) {
      try {
        var deviceId = data.deviceId || '';
        if (!deviceId) return;
        self._setDeviceState(deviceId, BLE_STATES.DISCOVERING_SERVICES, { servicesReady: true });
        var device = self.connectedDevices.get(deviceId);
        if (device) { device.servicesReady = true; self.connectedDevices.set(deviceId, device); }
        var fallbackTimer = setTimeout(function() {
          var st = self._getDeviceState(deviceId);
          if (st.state === BLE_STATES.DISCOVERING_SERVICES) {
            self._setDeviceState(deviceId, BLE_STATES.READY_TO_CHAT);
            self._resolveReadyToChat(deviceId);
            var nxFb = self._macToNexoId.get(_normMac(deviceId));
            if (nxFb) self._notifyPeerReady(deviceId, nxFb);
          }
        }, 3000);
        self._notificationFallbackTimers.set(deviceId, fallbackTimer);
      } catch (e) {}
    });

    this._nativeNotificationsListener = this.nativePlugin.addListener('onNotificationsEnabled', function(data) {
      try {
        var deviceId = data.deviceId || '';
        if (!deviceId) return;
        var ft = self._notificationFallbackTimers.get(deviceId);
        if (ft) { clearTimeout(ft); self._notificationFallbackTimers.delete(deviceId); }
        var peerUUID = null;
        var contact = _getContactByDeviceId(deviceId);
        if (contact) peerUUID = contact.nexoId || contact.deviceUUID;
        self._setDeviceState(deviceId, BLE_STATES.READY_TO_CHAT, { notificationsEnabled: true, deviceUUID: peerUUID });
        self._resolveReadyToChat(deviceId);
        self._processPendingMessages(deviceId);
        var nxFlush = self._macToNexoId.get(_normMac(deviceId));
        if (!nxFlush && contact) nxFlush = contact.nexoId || contact.deviceUUID;
        if (nxFlush) {
          self._notifyPeerReady(deviceId, nxFlush);
          if (self.ackSystem && self.ackSystem.sendSessionSync) {
            setTimeout(function() { self.ackSystem.sendSessionSync(deviceId, nxFlush); }, 300);
          }
          setTimeout(function() { self._resendPendingMessages(nxFlush); }, 500);
        }
        self._pingFailCount.set(deviceId, 0);
        self._lastPongTime.set(deviceId, Date.now());
        self._supervisorStates.set(deviceId, { state: SUPERVISOR_STATES.HEALTHY, since: Date.now() });
      } catch (e) {}
    });

    this._nativeConnectionFailedListener = this.nativePlugin.addListener('onConnectionFailed', function(data) {
      try {
        var deviceId = data.deviceId || '';
        if (!deviceId) return;
        var ft = self._notificationFallbackTimers.get(deviceId);
        if (ft) { clearTimeout(ft); self._notificationFallbackTimers.delete(deviceId); }
        self._setDeviceState(deviceId, BLE_STATES.ERROR, { lastError: data.reason });
        self._supervisorStates.set(deviceId, { state: SUPERVISOR_STATES.OFFLINE, since: Date.now(), error: data.reason });
      } catch (e) {}
    });
  }

  _setDeviceState(deviceId, state, meta) {
    meta = meta || {};
    if (!deviceId) return;
    var stateObj = Object.assign({}, meta, { state: state, timestamp: Date.now() });
    // FIX v6.1.3: clave normalizada; los eventos nativos traen 'AA:BB:..' y el mapeo NXID->MAC 'aabb..'
    this._deviceStates.set(_normMac(deviceId), stateObj);
  }

  _getDeviceState(deviceId) {
    if (!deviceId) return { state: BLE_STATES.DISCONNECTED };
    return this._deviceStates.get(_normMac(deviceId)) || { state: BLE_STATES.DISCONNECTED };
  }

  _setupNativePayloadListener() {
    if (!this.nativePlugin) return;
    if (!_hasNativeMethod(this.nativePlugin, 'addListener')) return;
    if (this._nativePayloadListener) { try { this._nativePayloadListener.remove(); } catch (e) {} }
    var self = this;
    this._nativePayloadListener = this.nativePlugin.addListener('onPayloadReceived', function(data) {
      try {
        var deviceId = data.deviceId || '';
        if (!deviceId) return;
        self._lastPongTime.set(deviceId, Date.now());
        self._pingFailCount.set(deviceId, 0);
        try {
          var raw0 = (data.content || data.data || '').trim();
          if (raw0.charAt(0) === '{') {
            var p0 = JSON.parse(raw0);
            var from0 = p0.fr || p0.fromNexoId || p0.from || (p0.payload && p0.payload.senderNexoId) || '';
            if (/^nx[0-9a-z]{8}$/i.test(from0)) self._kickPeer(deviceId, from0);
          }
        } catch (kickErr) {}
        var source = data.source || 'unknown';
        if (source !== 'gatt_server' && source !== 'gatt_client' && source !== 'broadcast') source = 'gatt_client';
        var messageId = null, senderName = null, senderUUID = null;
        var content = data.content || data.data || data.message || '';
        var trimmedContent = (content || '').trim();
        var isProtocol = false;
        try {
          if (trimmedContent.charAt(0) === '{') {
            var protoCheck = JSON.parse(trimmedContent);
            if (protoCheck.type === 'chat_meta' || protoCheck.type === 'chat_chunk' || protoCheck.type === 'file_meta' ||
                protoCheck.type === 'file_chunk' || protoCheck.type === 'file_resume' || protoCheck.type === 'ack' ||
                protoCheck.type === 'read_receipt' || protoCheck.type === 'ping' ||
                protoCheck.type === 'pong' || protoCheck.type === 'block_ack') isProtocol = true;
            if (protoCheck.t === 'c' || protoCheck.t === 'f' || protoCheck.t === 'n' || protoCheck.t === 'a' || protoCheck.t === 'ba' || protoCheck.t === 'ss' || protoCheck.t === 'sr') isProtocol = true;
          }
        } catch (e) {}
        if (isProtocol) {
          if (self.ackSystem) {
            var fragmentHandled = self.ackSystem.processIncomingFragment({ deviceId: deviceId, content: trimmedContent });
            if (fragmentHandled) return;
          }
          return;
        }
        if (self.ackSystem) {
          var fragmentHandled = self.ackSystem.processIncomingFragment({ deviceId: deviceId, content: content });
          if (fragmentHandled) return;
        }
        var ctrl = null;
        try { if (content && content.charAt(0) === '{') ctrl = JSON.parse(content); } catch (e) { ctrl = null; }

        var isControl = !!(ctrl && (
          ctrl.type === 'ack' || ctrl.type === 'read_receipt' || ctrl.type === 'ping' || ctrl.type === 'pong' ||
          ctrl.type === 'chat_meta' || ctrl.type === 'chat_chunk' || ctrl.type === 'block_ack' ||
          ctrl.type === 'file_meta' || ctrl.type === 'file_chunk' || ctrl.type === 'file_resume' ||
          ctrl.t === 'ba'
        ));
        if (ctrl && (ctrl.type === 'ack' || ctrl.type === 'read_receipt')) {
          if (self.ackSystem) self.ackSystem.processIncomingAck(content);
          return;
        }
        if (ctrl && ctrl.type === 'ping') {
          var pongPayload = JSON.stringify({ v: 1, type: 'pong', pingId: ctrl.pingId, ts: Date.now(), fromNexoId: self.localNexoId || self.localDeviceUUID });
          self._sendMessageNative(deviceId, pongPayload, 'pong_' + ctrl.pingId).catch(function() {});
          return;
        }
        if (ctrl && ctrl.type === 'pong') {
          var pending = self._pendingPings.get(ctrl.pingId);
          if (pending) {
            clearTimeout(pending.timer);
            self._pendingPings.delete(ctrl.pingId);
            var rtt = Date.now() - pending.ts;
            self._lastPongTime.set(deviceId, Date.now());
            self._pingFailCount.set(deviceId, 0);
            self._supervisorStates.set(deviceId, { state: SUPERVISOR_STATES.HEALTHY, since: Date.now(), rtt: rtt });
            pending.resolve({ rtt: rtt });
          }
          return;
        }
        var msgSeq = 0;
        if (content.charAt(0) === '{' || (data.data && data.data.charAt(0) === '{')) {
          try {
            var json = JSON.parse(data.data || content || '{}');
            if (json.msgId) messageId = json.msgId;
            if (json.messageId) messageId = json.messageId;
            if (typeof json.seq === 'number') msgSeq = json.seq;

            if (json.v === 1 && json.type === 'chat' && json.payload) {
              if (typeof json.payload.text === 'string') content = json.payload.text;
              if (json.payload.senderName) senderName = json.payload.senderName;
              if (json.payload.senderNexoId) senderUUID = json.payload.senderNexoId;
              if (!messageId && json.msgId) messageId = json.msgId;
            } else {
              if (json.payload) {
                if (json.payload.senderName) senderName = json.payload.senderName;
                if (json.payload.text) content = json.payload.text;
                if (json.payload.senderNexoId) senderUUID = json.payload.senderNexoId;
              }
              if (json.senderName) senderName = json.senderName;
              if (json.deviceName) senderName = json.deviceName;
              if (json.deviceUUID) senderUUID = json.deviceUUID;
              if (json.content) content = json.content;
              if (json.from && !senderUUID) senderUUID = json.from;
              if (!messageId && json.payload && json.payload.messageId) messageId = json.payload.messageId;
            }
          } catch (e) {}
        }
        if (!senderUUID) {
          var nd = _normMac(deviceId);
          senderUUID = self._macToNexoId.get(nd) || null;
        }
        if (!senderUUID) {
          var contactByDevice = _getContactByDeviceId(deviceId);
          if (contactByDevice) senderUUID = contactByDevice.nexoId || contactByDevice.deviceUUID;
        }
        if (!senderName || senderName === '') {
          var contact = _getContactByUUID(senderUUID);
          var cname = contact ? contact.name : null;
          senderName = cname || (self.connectedDevices.get(deviceId) && self.connectedDevices.get(deviceId).name) || (self.foundDevices.get(deviceId) && self.foundDevices.get(deviceId).name) || '';
        }
        if (senderUUID && senderName && senderName !== '') {
          if (!_isBLEContact(senderUUID)) {
            _addBLEContact({ deviceUUID: senderUUID, name: senderName, deviceId: deviceId });
            self.renderContactsList(); self.renderOnlineStrip();
          } else {
            var contacts2 = _getBLEContacts();
            var idx2 = contacts2.findIndex(function(c) { return _normId(c.nexoId || c.deviceUUID) === _normId(senderUUID); });
            if (idx2 >= 0) { contacts2[idx2].online = true; contacts2[idx2].lastSeen = Date.now(); contacts2[idx2].deviceId = deviceId; _saveBLEContacts(contacts2); self.renderContactsList(); self.renderOnlineStrip(); }
          }
          _vaultGetOrCreateContact(senderUUID, senderName, self.connectedDevices.get(deviceId) && self.connectedDevices.get(deviceId).name);
        }
        if (messageId && self._receivedMessageIds.has(messageId)) {
          if (!isControl && self.ackSystem) self.ackSystem.sendAck(deviceId, messageId);
          return;
        }
        if (messageId) {
          self._receivedMessageIds.add(messageId);
          if (self._receivedMessageIds.size > self._maxMessageIds) {
            var first = self._receivedMessageIds.values().next().value;
            self._receivedMessageIds.delete(first);
          }
          if (!isControl && self.ackSystem) self.ackSystem.sendAck(deviceId, messageId);
        }
        var attachmentData = null;
        if (ctrl && ctrl.payload && ctrl.payload.attachment) attachmentData = ctrl.payload.attachment;
        var msgContent = attachmentData ? JSON.stringify(attachmentData) : content;
        if (!isControl && senderUUID) {
          var vaultMsg = {
            messageId: messageId || ('recv_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5)),
            content: msgContent, _own: false, status: 'delivered', timestamp: data.timestamp || Date.now(),
            senderName: senderName, senderNexoId: senderUUID, seq: msgSeq || 0,
            attachmentType: attachmentData ? attachmentData.attachmentType : null,
            attachmentPayload: attachmentData ? attachmentData.payload : null,
            attachmentMeta: attachmentData ? attachmentData.meta : null
          };
          _vaultAppendMessage(senderUUID, vaultMsg, false);
        }
        var activeUUID = self._activeChatDeviceId;
        var isChatActive = activeUUID && activeUUID === senderUUID;
        if (senderUUID && !isControl && !isChatActive) {
          var contacts3 = _getBLEContacts();
          var idx3 = contacts3.findIndex(function(c) { return _normId(c.nexoId || c.deviceUUID) === _normId(senderUUID); });
          if (idx3 >= 0) { contacts3[idx3].unreadCount = (contacts3[idx3].unreadCount || 0) + 1; contacts3[idx3].lastSeen = Date.now(); _saveBLEContacts(contacts3); }
        }
        if (senderUUID && !isControl) self.noteContactMessage(senderUUID, _messagePreview(content, attachmentData && attachmentData.attachmentType), data.timestamp || Date.now());
        _safeDispatchEvent('nexo:ble:messageReceived', {
          deviceId: deviceId,
          deviceUUID: senderUUID,
          content: msgContent,
          messageId: messageId,
          senderName: senderName,
          senderNexoId: senderUUID,
          seq: msgSeq || 0,
          timestamp: data.timestamp || Date.now(),
          attachmentType: attachmentData ? attachmentData.attachmentType : null,
          attachmentPayload: attachmentData ? attachmentData.payload : null,
          attachmentMeta: attachmentData ? attachmentData.meta : null
        });
      } catch (e) {
        console.warn('[BLEInterface] onPayloadReceived error:', e && e.message);
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Cámara: pause / resume
  // ---------------------------------------------------------------------------

  pauseBLEForCamera() {
    var self = this;
    if (self._cameraBlePaused) return;
    console.log('[BLEInterface] pauseBLEForCamera');
    self._cameraBlePaused = true;
    self._cameraBlePausedDevices = [];
    self._cameraBleWasAdvertising = self.isAdvertising;

    // Detener scan
    if (self.isScanning && self.nativePlugin && _hasNativeMethod(self.nativePlugin, 'stopScan')) {
      _safeNativeCall(self.nativePlugin, 'stopScan', {}).catch(function() {});
      self.isScanning = false;
      self.updateScanButton();
    }

    // Guardar dispositivos conectados y desconectarlos
    self.connectedDevices.forEach(function(device, deviceId) {
      self._cameraBlePausedDevices.push({
        deviceId: deviceId,
        deviceUUID: device.deviceUUID || self._macToNexoId.get(_normMac(deviceId)),
        name: device.name
      });
      if (self.nativePlugin && _hasNativeMethod(self.nativePlugin, 'disconnectDevice')) {
        _safeNativeCall(self.nativePlugin, 'disconnectDevice', { deviceId: deviceId }).catch(function() {});
      }
      self.connectedDevices.delete(deviceId);
      self._setDeviceState(deviceId, BLE_STATES.DISCONNECTED);
    });

    // Parar advertising
    if (self.isAdvertising && self.nativePlugin && _hasNativeMethod(self.nativePlugin, 'stopAdvertising')) {
      _safeNativeCall(self.nativePlugin, 'stopAdvertising', {}).catch(function() {});
      self.isAdvertising = false;
      self.updateVisibilityButton();
    }
  }

  resumeBLEAfterCamera() {
    var self = this;
    if (!self._cameraBlePaused) return Promise.resolve();
    console.log('[BLEInterface] resumeBLEAfterCamera — reconectando', self._cameraBlePausedDevices.length, 'dispositivos');

    self._cameraBlePaused = false;

    // Notificar a todos los waiters
    var waiters = self._cameraBleResumeWaiters.slice();
    self._cameraBleResumeWaiters = [];
    waiters.forEach(function(w) { try { w.resolve(); } catch (e) {} });

    // Restaurar advertising
    if (self._cameraBleWasAdvertising && self.nativePlugin && _hasNativeMethod(self.nativePlugin, 'startAdvertising')) {
      _safeNativeCall(self.nativePlugin, 'startAdvertising', {}).then(function() {
        self.isAdvertising = true;
        self.updateVisibilityButton();
      }).catch(function() {});
    }

    // Reconexión ACTIVA de los dispositivos que se desconectaron
    var devices = self._cameraBlePausedDevices.slice();
    self._cameraBlePausedDevices = [];

    var reconnectPromises = devices.map(function(d) {
      return new Promise(function(resolve) {
        setTimeout(function() {
          if (d.deviceId) {
            self._autoConnectGATT(d.deviceId, { name: d.name, deviceUUID: d.deviceUUID })
              .then(function() { resolve(); })
              .catch(function() { resolve(); });
          } else {
            resolve();
          }
        }, 300 + Math.random() * 400);
      });
    });

    return Promise.all(reconnectPromises).then(function() {
      // Auto-scan de seguridad
      setTimeout(function() {
        if (!self.isDummyMode && self.nativePlugin) self._autoScanForKnownContacts();
      }, 800);
    });
  }

  _waitIfCameraPaused() {
    var self = this;
    return new Promise(function(resolve, reject) {
      if (!self._cameraBlePaused) {
        resolve();
        return;
      }
      console.log('[BLEInterface] Esperando a que se reanude BLE tras cámara…');
      var timer = setTimeout(function() {
        // Timeout de seguridad: forzar resume
        console.warn('[BLEInterface] Timeout esperando resume de cámara — forzando');
        self._cameraBlePaused = false;
        var waiters = self._cameraBleResumeWaiters.slice();
        self._cameraBleResumeWaiters = [];
        waiters.forEach(function(w) { try { w.resolve(); } catch (e) {} });
        resolve();
      }, 8000);
      self._cameraBleResumeWaiters.push({
        resolve: function() { clearTimeout(timer); resolve(); },
        reject: function(err) { clearTimeout(timer); reject(err); }
      });
    });
  }

  // ---------------------------------------------------------------------------
  // Envío de mensajes y archivos
  // ---------------------------------------------------------------------------

  _sendMessageNative(deviceId, content, messageId, seq) {
    var self = this;
    return new Promise(function(resolve, reject) {
      if (!self.nativePlugin || !_hasNativeMethod(self.nativePlugin, 'sendMessage')) {
        reject(new Error('sendMessage nativo no disponible'));
        return;
      }
      // FIX v6.1.2: el nativo lee 'message' (no 'content'); desde v6.1.1 se enviaba vacío.
      // Mensajes normales viajan en el sobre v1 'chat' con datos del remitente (como en v6.1.0);
      // los paquetes de control (ack, ping, chunks, sync) van tal cual.
      var targetId = deviceId;
      var knownMac = self._nexoIdToMac.get(_normId(deviceId));
      if (knownMac) targetId = knownMac;
      var outgoing = content;
      if (!_isControlPacket(content)) {
        var senderId = self.localNexoId || self.localDeviceUUID;
        var msgId = messageId || ('msg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9));
        var msgSeq = (typeof seq === 'number') ? seq : self.getNextSeq();
        var payloadObj = { text: content, senderNexoId: senderId, senderName: self.localDeviceName || 'Nexo Device', timestamp: Date.now() };
        if (content && content.charAt(0) === '{') {
          try {
            var parsedContent = JSON.parse(content);
            if (parsedContent && parsedContent.type === 'attachment') payloadObj.attachment = parsedContent;
          } catch (e) {}
        }
        outgoing = JSON.stringify({ v: 1, type: 'chat', from: senderId, to: '', ts: Date.now(), seq: msgSeq, msgId: msgId, payload: payloadObj });
      }
      _safeNativeCall(self.nativePlugin, 'sendMessage', { deviceId: targetId, message: outgoing })
        .then(function(r) {
          if (r && typeof r.mtu === 'number' && r.mtu >= 23) self._mtuByDevice.set(_normMac(targetId), r.mtu);
          resolve(r);
        })
        .catch(reject);
    });
  }

  _processPendingMessages(deviceId) {
    var self = this;
    // v6.1.9: cola por contacto ('nx:<id>') + la antigua por dirección
    var keys = [_normMac(deviceId)];
    var nxQ = self._macToNexoId.get(_normMac(deviceId));
    if (nxQ) keys.push('nx:' + _normId(nxQ));
    var queue = [];
    keys.forEach(function(k) {
      var q = self._pendingMessageQueue.get(k);
      if (q && q.length) { queue = queue.concat(q); self._pendingMessageQueue.delete(k); }
    });
    if (queue.length === 0) return;
    queue.forEach(function(item) {
      // v6.1.6: con confirmación y reintentos. Antes salía una sola vez sin ack: si el otro teléfono
      // acababa de abrir la app y su JS aún no escuchaba, se perdía mostrando ✓.
      var send = (self.ackSystem && typeof self.ackSystem.sendWithRetry === 'function')
        ? self.ackSystem.sendWithRetry(deviceId, item.content, item.messageId, item.seq)
        : self._sendMessageNative(deviceId, item.content, item.messageId, item.seq);
      send.then(function() { if (item.resolve) item.resolve(); })
        .catch(function(err) { if (item.reject) item.reject(err); });
    });
  }

  sendChatMessage(deviceUUID, content, messageId, seq) {
    var self = this;
    return new Promise(function(resolve, reject) {
      try {
        var uuid = _normId(deviceUUID);
        if (!uuid) { reject(new Error('deviceUUID vacio')); return; }
        var msgId = messageId || ('msg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5));
        var msgSeq = (typeof seq === 'number') ? seq : self.getNextSeq();

        var deviceId = self._resolveDeviceIdForNexoId(uuid);
        if (!deviceId) {
          reject(new Error('Dispositivo no encontrado'));
          return;
        }

        var state = self._getDeviceState(deviceId);
        var isReady = state.state === BLE_STATES.READY_TO_CHAT || state.state === BLE_STATES.NOTIFICATIONS_READY;
        var isConnecting = state.state === BLE_STATES.CONNECTING || state.state === BLE_STATES.DISCOVERING_SERVICES;

        if (self._cameraBlePaused) {
          self._waitIfCameraPaused().then(function() {
            self.sendChatMessage(deviceUUID, content, msgId, msgSeq).then(resolve).catch(reject);
          }).catch(reject);
          return;
        }

        function doSend() {
          var isLong = content.length > 180;
          if (isLong && self.ackSystem && typeof self.ackSystem.sendChunkedMessage === 'function') {
            self.ackSystem.sendChunkedMessage(deviceId, content, {}, msgId, msgSeq)
              .then(function() { _vaultUpdateMessageStatus(uuid, msgId, 'sent'); resolve(); })
              .catch(function(err) { _vaultUpdateMessageStatus(uuid, msgId, 'failed'); reject(err); });
            return;
          } else if (self.ackSystem && typeof self.ackSystem.sendWithRetry === 'function') {
            // v6.1.5: con confirmación y reintentos; antes un paquete perdido en el aire se perdía
            // para siempre aunque mostrara ✓ (el receptor descarta duplicados por id)
            self.ackSystem.sendWithRetry(deviceId, content, msgId, msgSeq)
              .then(function() { _vaultUpdateMessageStatus(uuid, msgId, 'sent'); resolve(); })
              .catch(function(err) { _vaultUpdateMessageStatus(uuid, msgId, 'failed'); reject(err); });
          } else {
            self._sendMessageNative(deviceId, content, msgId, msgSeq)
              .then(function() { _vaultUpdateMessageStatus(uuid, msgId, 'sent'); resolve(); })
              .catch(function(err) { _vaultUpdateMessageStatus(uuid, msgId, 'failed'); reject(err); });
          }
        }

        function enqueueMsg() {
          var qKey = 'nx:' + uuid;
          var queue = self._pendingMessageQueue.get(qKey) || [];
          queue.push({ content: content, messageId: msgId, seq: msgSeq, resolve: resolve, reject: reject });
          self._pendingMessageQueue.set(qKey, queue);
        }

        if (isReady) { doSend(); return; }
        enqueueMsg();
        self._markPeerLost(uuid);
        if (!isConnecting && self.nativePlugin && _hasNativeMethod(self.nativePlugin, 'connectToDevice')) {
          console.log('[BLEInterface] sendChatMessage: forcing connectToDevice for', deviceId);
          _safeNativeCall(self.nativePlugin, 'connectToDevice', { deviceId: deviceId }).catch(function() {});
        }
      } catch (fatal) { reject(fatal); }
    });
  }

  /**
   * v6.1.1: sendFile con espera post-cámara bloqueante + reintento READY.
   */
  sendFile(deviceUUID, fileId, base64Data, meta) {
    var self = this;
    return new Promise(function(resolve, reject) {
      try {
        var uuid = _normId(deviceUUID);
        if (!uuid) { reject(new Error('deviceUUID vacio')); return; }
        if (!base64Data) { reject(new Error('base64Data vacio')); return; }

        var deviceId = self._resolveDeviceIdForNexoId(uuid);
        if (!deviceId) {
          // Último intento: active chat
          if (self._activeChatDeviceId === uuid && self._activeChatDeviceIdNative) {
            deviceId = self._activeChatDeviceIdNative;
          }
        }
        if (!deviceId) {
          reject(new Error('Dispositivo no encontrado'));
          return;
        }

        if (!self.ackSystem || typeof self.ackSystem.sendFile !== 'function') {
          reject(new Error('AckSystem no disponible'));
          return;
        }

        function startTransfer() {
          console.log('[BLEInterface] sendFile START fileId=' + fileId + ' deviceId=' + deviceId + ' b64len=' + base64Data.length);
          self.ackSystem.sendFile(deviceId, fileId, base64Data, meta || {})
            .then(function() { resolve(); })
            .catch(function(err) { reject(err); });
        }

        // v6.1.9: el dispositivo se resuelve en cada intento (el otro puede volver con otra dirección).
        // Si en 8 s no hay enlace listo con ese contacto: PEER_ABSENT; el adjunto queda pendiente y se
        // reenvía al reconectar. Antes esperaba ~40 s a la dirección vieja y el vídeo se perdía.
        function ensureReadyThenSend() {
          var deadline = Date.now() + 8000;
          var nudged = false;
          (function check() {
            var dev = self._resolveDeviceIdForNexoId(uuid) || deviceId;
            var st = self._getDeviceState(dev);
            if (st.state === BLE_STATES.READY_TO_CHAT || st.state === BLE_STATES.NOTIFICATIONS_READY) {
              deviceId = dev;
              startTransfer();
              return;
            }
            if (!nudged) {
              nudged = true;
              console.log('[BLEInterface] sendFile: contacto no listo (' + (st.state || '?') + '), buscando…');
              self._markPeerLost(uuid);
              if (self.nativePlugin && _hasNativeMethod(self.nativePlugin, 'connectToDevice') && st.state !== BLE_STATES.CONNECTING) {
                _safeNativeCall(self.nativePlugin, 'connectToDevice', { deviceId: dev }).catch(function() {});
              }
            }
            if (Date.now() >= deadline) {
              var e = new Error('Contacto no disponible: queda pendiente');
              e.code = 'PEER_ABSENT';
              reject(e);
              return;
            }
            setTimeout(check, 500);
          })();
        }

        // Flujo post-cámara
        var afterCamera = function() {
          // Pequeño margen para estabilizar radio
          setTimeout(ensureReadyThenSend, 500);
        };

        if (self._cameraBlePaused) {
          self._waitIfCameraPaused()
            .then(afterCamera)
            .catch(reject);
        } else {
          afterCamera();
        }
      } catch (fatal) { reject(fatal); }
    });
  }

  _waitForReadyToChat(deviceId, timeoutMs) {
    var self = this;
    return new Promise(function(resolve, reject) {
      if (!deviceId) { reject(new Error('deviceId invalido')); return; }
      var state = self._getDeviceState(deviceId);
      if (state.state === BLE_STATES.READY_TO_CHAT || state.state === BLE_STATES.NOTIFICATIONS_READY) {
        resolve();
        return;
      }
      var timer = setTimeout(function() {
        self._readyResolvers.delete(_normMac(deviceId));
        reject(new Error('Timeout esperando READY_TO_CHAT'));
      }, timeoutMs || 12000);
      self._readyResolvers.set(_normMac(deviceId), { resolve: resolve, timer: timer });
    });
  }

  _resolveReadyToChat(deviceId) {
    if (!deviceId) return;
    var resolver = this._readyResolvers.get(_normMac(deviceId));
    if (resolver) {
      clearTimeout(resolver.timer);
      resolver.resolve();
      this._readyResolvers.delete(_normMac(deviceId));
    }
    this._processPendingMessages(deviceId);
  }

  openChat(deviceUUID) {
    var self = this;
    return new Promise(function(resolve, reject) {
      try {
        var uuid = _normId(deviceUUID);
        if (!uuid) { reject(new Error('ID invalido')); return; }
        var contact = _getContactByUUID(uuid);
        var deviceId = contact ? contact.deviceId : null;
        if (!deviceId) {
          deviceId = self._resolveDeviceIdForNexoId(uuid);
        }
        if (!deviceId) { reject(new Error('Dispositivo no conectado')); return; }
        self._activeChatDeviceId = uuid;
        self._activeChatDeviceIdNative = deviceId;
        if (window.NEXO && window.NEXO.app) {
          window.NEXO.app.activeContact = contact || { nexoId: uuid, name: (contact && contact.name) || 'NEXO', displayName: (contact && contact.name) || 'NEXO' };
        }
        self.newDevicesCount = 0;
        self.updateBadge();
        if (contact) {
          contact.unreadCount = 0;
          var contacts = _getBLEContacts();
          var idx = contacts.findIndex(function(c) { return _normId(c.nexoId || c.deviceUUID) === uuid; });
          if (idx >= 0) { contacts[idx].unreadCount = 0; _saveBLEContacts(contacts); self.renderContactsList(); self.renderOnlineStrip(); }
        }
        var state = self._getDeviceState(deviceId);
        var isFullyReady = state.state === BLE_STATES.READY_TO_CHAT || state.state === BLE_STATES.NOTIFICATIONS_READY;
        var isConnecting = state.state === BLE_STATES.CONNECTING || state.state === BLE_STATES.DISCOVERING_SERVICES;

        function finishOpenChat() {
          var appContainer = document.getElementById('app');
          if (appContainer) appContainer.classList.remove('hidden');
          var nameInput = document.getElementById('chat-contact-name');
          var subtitle = document.getElementById('chat-contact-subtitle');
          var displayName = (contact && contact.name) || 'NEXO';
          if (nameInput) nameInput.value = displayName;
          if (subtitle) subtitle.textContent = '';
          _safeDispatchEvent('nexo:ble:openChat', { contactId: uuid, name: displayName, deviceId: deviceId, transport: 'ble', source: 'ble_interface' });
          self.elements.panel.classList.remove('active');
          self.elements.overlay.classList.remove('active');
        }
        finishOpenChat();
        self._resendPendingMessages(uuid);
        _vaultLoadMessages(uuid).then(_hydrateAttachments).then(function(messages) {
          if (messages && messages.length > 0) _safeDispatchEvent('nexo:vault:messagesLoaded', { contactId: uuid, messages: messages });
        }).catch(function() {});
        resolve();
        if (!isFullyReady && self.nativePlugin && _hasNativeMethod(self.nativePlugin, 'connectToDevice')) {
          if (!isConnecting) {
            console.log('[BLEInterface] openChat: forcing connectToDevice for', deviceId);
            _safeNativeCall(self.nativePlugin, 'connectToDevice', { deviceId: deviceId }).catch(function() {});
          }
        }
      } catch (fatalErr) {
        console.error('[BLEInterface] FATAL openChat:', fatalErr);
        reject(fatalErr);
      }
    });
  }

  _resendPendingMessages(nexoId) {
    var self = this;
    if (!nexoId) return;
    var getPending = (window.vaultGetPendingMessages && typeof window.vaultGetPendingMessages === 'function')
      ? window.vaultGetPendingMessages(nexoId)
      : _vaultLoadMessages(nexoId).then(function(msgs) {
          return msgs.filter(_isResendable);
        });
    getPending = getPending.then(_hydrateAttachments);
    getPending.then(function(pending) {
      // No reenviar lo que sigue en vuelo en esta sesión (cola JS, ACK pendiente o stream activo)
      pending = (pending || []).filter(function(m) { return !self._isMsgInFlight(m.msgId || m.messageId || m.id); });
      if (pending.length === 0) return;
      console.log('[BLEInterface] Reenviando', pending.length, 'pending para', nexoId);
      var deviceId = self._resolveDeviceIdForNexoId(nexoId);
      if (!deviceId) {
        console.warn('[BLEInterface] No deviceId para reenvio', nexoId);
        return;
      }
      var st = self._getDeviceState(deviceId);
      if (st.state !== BLE_STATES.READY_TO_CHAT && st.state !== BLE_STATES.NOTIFICATIONS_READY) {
        console.log('[BLEInterface] Device no listo para reenvio, dejando en pending');
        return;
      }
      if (self.ackSystem && typeof self.ackSystem.resumeOutgoingTransfers === 'function') {
        try { self.ackSystem.resumeOutgoingTransfers(deviceId); } catch (e) {}
      }
      var idx = 0;
      function sendNext() {
        if (idx >= pending.length) return;
        var msg = pending[idx++];
        var mid = msg.msgId || msg.messageId || msg.id;
        if (!mid) {
          sendNext();
          return;
        }
        _vaultUpdateMessageStatus(nexoId, mid, 'sending');
        try {
          if (window.NEXO_updateMessageStatus) {
            window.NEXO_updateMessageStatus(mid, 'sending');
          }
        } catch (e) {}

        var attachmentType = msg.attachmentType || null;
        var attachmentPayload = msg.attachmentPayload || null;
        var attachmentMeta = msg.attachmentMeta || null;

        if (!attachmentType && msg.content && typeof msg.content === 'string') {
          try {
            var parsed = JSON.parse(msg.content);
            if (parsed && parsed.type === 'attachment') {
              attachmentType = parsed.attachmentType || null;
              attachmentPayload = parsed.payload || null;
              attachmentMeta = parsed.meta || null;
            }
          } catch (e) {}
        }

        var msgSeq = (typeof msg.seq === 'number') ? msg.seq : undefined;
        var doSend;

        if (
          attachmentType &&
          attachmentPayload &&
          (attachmentType === 'image' ||
           attachmentType === 'video' ||
           attachmentType === 'file')
        ) {
          if (!self.ackSystem || typeof self.ackSystem.sendFile !== 'function') {
            console.warn('[BLEInterface] AckSystem sin sendFile para pending:', mid);
            _vaultUpdateMessageStatus(nexoId, mid, 'failed');
            try {
              if (window.NEXO_updateMessageStatus) {
                window.NEXO_updateMessageStatus(mid, 'failed');
              }
            } catch (e2) {}
            sendNext();
            return;
          }
          var fileMeta = Object.assign(
            { type: attachmentType },
            attachmentMeta || {}
          );
          doSend = function() {
            return self.ackSystem.sendFile(
              deviceId,
              mid,
              attachmentPayload,
              fileMeta
            );
          };
          console.log('[BLEInterface] Reenviando ADJUNTO:', attachmentType, mid);
        } else {
          var txt = msg.content || msg.text || '';
          if (
            txt.length > 180 &&
            self.ackSystem &&
            typeof self.ackSystem.sendChunkedMessage === 'function'
          ) {
            doSend = function() {
              return self.ackSystem.sendChunkedMessage(
                deviceId,
                txt,
                {},
                mid,
                msgSeq
              );
            };
          } else if (self.ackSystem) {
            doSend = function() {
              return self.ackSystem.sendWithRetry(
                deviceId,
                txt,
                mid,
                msgSeq
              );
            };
          } else {
            doSend = function() {
              return self._sendMessageNative(
                deviceId,
                txt,
                mid,
                msgSeq
              );
            };
          }
        }

        doSend()
          .then(function() {
            console.log('[BLEInterface] Pending OK:', mid);
            _vaultUpdateMessageStatus(nexoId, mid, 'sent');
            try {
              if (window.NEXO_updateMessageStatus) {
                window.NEXO_updateMessageStatus(mid, 'sent');
              }
            } catch (e) {}
            sendNext();
          })
          .catch(function(e) {
            console.warn('[BLEInterface] Pending fallo:', mid, e.message);
            // No marcar failed de forma agresiva si es transitorio
            var isTransient = /timeout|abort|network|disconnected|not ready|busy|interrupted|temporary/i.test(e.message || '');
            if (!isTransient) {
              _vaultUpdateMessageStatus(nexoId, mid, 'failed');
              try {
                if (window.NEXO_updateMessageStatus) {
                  window.NEXO_updateMessageStatus(mid, 'failed');
                }
              } catch (e2) {}
            }
            sendNext();
          });
      }
      sendNext();
    }).catch(function(e) {
      console.warn('[BLEInterface] Error cargando pending:', e.message);
    });
  }

  // ---------------------------------------------------------------------------
  // Visibility / Scan / DOM
  // ---------------------------------------------------------------------------

  _initVisibility() {
    var self = this;
    if (self.isDummyMode) return Promise.resolve();
    if (_hasNativeMethod(self.nativePlugin, 'isBluetoothEnabled')) {
      return _safeNativeCall(self.nativePlugin, 'isBluetoothEnabled', {})
        .then(function(btState) {
          self.canAdvertise = (btState && btState.canAdvertise) || false;
          if (_hasNativeMethod(self.nativePlugin, 'isAdvertising')) {
            return _safeNativeCall(self.nativePlugin, 'isAdvertising', {}).then(function(adState) {
              self.isAdvertising = adState && adState.isAdvertising === true;
              self.updateVisibilityButton();
              self._setupNativeAdvertisingListeners();
            });
          } else {
            self.updateVisibilityButton();
            self._setupNativeAdvertisingListeners();
          }
        }).catch(function(err) { console.error('[BLEInterface] Error estado:', err); });
    }
    self.updateVisibilityButton('');
    return Promise.resolve();
  }
  _setupNativeAdvertisingListeners() {
    if (!this.nativePlugin) return;
    if (!_hasNativeMethod(this.nativePlugin, 'addListener')) return;
    var self = this;
    this._nativeAdStartedListener = this.nativePlugin.addListener('onAdvertiseStarted', function() {});
    this._nativeAdFailedListener = this.nativePlugin.addListener('onAdvertiseFailed', function() {});
  }
  updateVisibilityButton() {
    var btn = this.elements.visibilityBtn;
    if (!btn) return;
    if (this.isAdvertising) btn.classList.add('active'); else btn.classList.remove('active');
  }
  updateScanButton() {
    var btn = this.elements.scanBtn;
    if (!btn) return;
    var panelActive = this.elements.panel && this.elements.panel.classList.contains('active');
    btn.style.display = panelActive ? 'flex' : 'none';
    if (this.isScanning) btn.classList.add('scanning');
    else btn.classList.remove('scanning');
  }
  toggleVisibility() {
    var self = this;
    if (self.isDummyMode) return Promise.resolve();
    var permsReady = false;
    if (window.ensureBLEPermissions) {
      return window.ensureBLEPermissions().then(function(result) { permsReady = result; }).catch(function() { permsReady = true; }).then(function() {
        if (!permsReady) return Promise.resolve();
        if (!self.nativePlugin) return Promise.resolve();
        var promise;
        if (self.isAdvertising) {
          if (_hasNativeMethod(self.nativePlugin, 'stopAdvertising')) promise = _safeNativeCall(self.nativePlugin, 'stopAdvertising', {}); else promise = Promise.resolve();
          if (promise) return promise.then(function() { self.isAdvertising = false; self.updateVisibilityButton(); });
          self.isAdvertising = false;
        } else {
          if (_hasNativeMethod(self.nativePlugin, 'startAdvertising')) promise = _safeNativeCall(self.nativePlugin, 'startAdvertising', {}); else promise = Promise.resolve();
          if (promise) return promise.then(function() { self.isAdvertising = true; self.updateVisibilityButton(); });
          self.isAdvertising = true;
        }
        self.updateVisibilityButton();
        return Promise.resolve();
      }).catch(function(err) {});
    } else { permsReady = true; }
    if (!permsReady) return Promise.resolve();
    if (!self.nativePlugin) return Promise.resolve();
    var promise;
    if (self.isAdvertising) {
      if (_hasNativeMethod(self.nativePlugin, 'stopAdvertising')) promise = _safeNativeCall(self.nativePlugin, 'stopAdvertising', {});
      if (promise) return promise.then(function() { self.isAdvertising = false; self.updateVisibilityButton(); });
      self.isAdvertising = false;
    } else {
      if (_hasNativeMethod(self.nativePlugin, 'startAdvertising')) promise = _safeNativeCall(self.nativePlugin, 'startAdvertising', {});
      if (promise) return promise.then(function() { self.isAdvertising = true; self.updateVisibilityButton(); });
      self.isAdvertising = true;
    }
    self.updateVisibilityButton();
    return Promise.resolve();
  }
  _autoScanForKnownContacts(opts) {
    var self = this;
    if (self._cameraBlePaused) return;
    if (self.isScanning) return;
    if (!self.nativePlugin || !_hasNativeMethod(self.nativePlugin, 'startScan')) return;
    console.log('[BLEInterface] Auto-scan iniciado');
    self.foundDevices.clear();
    _safeNativeCall(self.nativePlugin, 'startScan', { filtered: !!(opts && opts.filtered) })
      .then(function() {
        self.isScanning = true;
        self.updateScanButton();
        setTimeout(function() {
          if (self.isScanning && _hasNativeMethod(self.nativePlugin, 'stopScan')) {
            _safeNativeCall(self.nativePlugin, 'stopScan', {}).then(function() {
              self.isScanning = false;
              self.updateScanButton();
            }).catch(function() {
              self.isScanning = false;
              self.updateScanButton();
            });
          }
        }, 6000);
      }).catch(function(e) { console.warn('[BLEInterface] Auto-scan fallo:', e.message); });
  }
  createDOM() {
    var self = this;
    var panel = document.createElement('div');
    panel.id = 'ble-panel';
    panel.innerHTML =
      '<div class="ble-header" style="position:relative;display:flex;align-items:center;justify-content:center;padding:10px 20px 14px;">' +
      '<button id="ble-panel-back" style="position:absolute;left:12px;top:50%;transform:translateY(-50%);width:38px;height:38px;border-radius:50%;background:linear-gradient(135deg,#00c8ff,#a855f7);border:none;color:#fff;cursor:pointer;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 8px rgba(0,200,255,0.3);transition:transform 0.15s ease;z-index:2;">' +
      '<svg viewBox="0 0 24 24" width="16" height="16" fill="#fff"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" transform="scale(-1,1) translate(-24,0)"/></svg>' +
      '</button>' +
      '<div style="text-align:center;"><div class="contacts-title">Agregar contactos</div></div>' +
      '</div>' +
      '<div class="ble-search-bar">' +
      '<svg viewBox="0 0 24 24"><path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0016 9.5 6.5 6.5 0 109.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/></svg>' +
      '<span>Buscar contacto...</span>' +
      '</div>' +
      '<div class="ble-section-label">En linea ahora</div>' +
      '<div id="ble-online-strip" class="ble-online-strip"></div>' +
      '<div class="ble-section-label">Recientes</div>' +
      '<div id="ble-contacts-list" class="ble-contacts-list">' +
      '<div class="ble-empty">No hay contactos. Presiona Buscar para encontrar dispositivos.</div>' +
      '</div>' +
      '<div class="ble-bottom-bar">' +
      '<div id="ble-new-device" class="ble-new-device" style="display:none">' +
      '<span id="ble-new-device-name"></span>' +
      '<button id="ble-add-btn" class="ble-btn-add-small">+</button>' +
      '</div>' +
      '<button id="ble-scan-btn" class="ble-btn-scan-round"></button>' +
      '</div>' +
      '<div id="ble-status-bar" class="ble-status-bar"><span id="ble-status-text"></span></div>';
    document.body.appendChild(panel);
    this.elements.panel = panel;
    var overlay = document.createElement('div');
    overlay.id = 'ble-overlay';
    document.body.appendChild(overlay);
    this.elements.overlay = overlay;
    var bottomNav = document.createElement('div');
    bottomNav.id = 'ble-bottom-nav';
    bottomNav.className = 'ble-bottom-nav';
    bottomNav.innerHTML =
      '<div class="ble-nav-item active" data-tab="chats">' +
      '<svg viewBox="0 0 24 24"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/></svg>' +
      '<span>Chats</span>' +
      '</div>' +
      '<div class="ble-nav-item" data-tab="people">' +
      '<svg viewBox="0 0 24 24"><path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/></svg>' +
      '<span>Gente</span>' +
      '</div>' +
      '<div class="ble-nav-item" data-tab="map">' +
      '<svg viewBox="0 0 24 24"><path d="M20.5 3l-.16.03L15 5.1 9 3 3.36 4.9c-.21.07-.36.25-.36.48V20.5c0 .28.22.5.5.5l.16-.03L9 18.9l6 2.1 5.64-1.9c.21-.07.36-.25.36-.48V3.5c0-.28-.22-.5-.5-.5zM15 19l-6-2.11V5l6 2.11V19z"/></svg>' +
      '<span>Mapa</span>' +
      '</div>' +
      '<div class="ble-nav-item" data-tab="profile">' +
      '<svg viewBox="0 0 24 24"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>' +
      '<span>Perfil</span>' +
      '</div>';
    document.body.appendChild(bottomNav);
    this.elements.bottomNav = bottomNav;
    this.elements.visibilityBtn = document.getElementById('ble-visibility-btn');
    this.elements.scanBtn = document.getElementById('ble-scan-btn');
    this.elements.contactsList = document.getElementById('ble-contacts-list');
    this.elements.onlineStrip = document.getElementById('ble-online-strip');
    this.elements.newDeviceBar = document.getElementById('ble-new-device');
    this.elements.newDeviceName = document.getElementById('ble-new-device-name');
    this.elements.addBtn = document.getElementById('ble-add-btn');
    this.elements.statusBar = document.getElementById('ble-status-bar');
    this.elements.statusText = document.getElementById('ble-status-text');
    this.elements.mainContactsList = document.getElementById('main-contacts-list');
    this.elements.mainOnlineStrip = document.getElementById('main-contacts-online-strip');
    this.elements.mainEmptyMsg = document.getElementById('main-contacts-empty-msg');
    var fabBtn = document.createElement('button');
    fabBtn.id = 'ble-fab-btn';
    fabBtn.innerHTML = '<svg viewBox="0 0 24 24" width="24" height="24" fill="#fff"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/></svg>';
    fabBtn.style.cssText = 'position:fixed;bottom:80px;right:16px;width:56px;height:56px;border-radius:50%;background:linear-gradient(135deg,#00c8ff,#a855f7);border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;z-index:2147483643;box-shadow:0 4px 15px rgba(0,200,255,0.3);transition:transform 0.15s ease;';
    fabBtn.addEventListener('click', function() { self.togglePanel(); });
    fabBtn.addEventListener('mousedown', function() { this.style.transform = 'scale(0.92)'; });
    fabBtn.addEventListener('mouseup', function() { this.style.transform = 'scale(1)'; });
    fabBtn.addEventListener('touchstart', function() { this.style.transform = 'scale(0.92)'; });
    fabBtn.addEventListener('touchend', function() { this.style.transform = 'scale(1)'; });
    document.body.appendChild(fabBtn);
    this.elements.fabBtn = fabBtn;
  }
  setupEventListeners() {
    var self = this;
    this.elements.overlay.addEventListener('click', function() { self.togglePanel(); });
    this.elements.scanBtn.addEventListener('click', function() { self.toggleScan(); });
    this.elements.addBtn.addEventListener('click', function() { self._addNewDevice(); });
    var backBtn = document.getElementById('ble-panel-back');
    if (backBtn) {
      backBtn.addEventListener('click', function() {
        self.elements.panel.classList.remove('active');
        self.elements.overlay.classList.remove('active');
        self.updateScanButton();
      });
    }
    var navItems = this.elements.bottomNav.querySelectorAll('.ble-nav-item');
    navItems.forEach(function(item) {
      item.addEventListener('click', function() {
        navItems.forEach(function(n) { n.classList.remove('active'); });
        item.classList.add('active');
        var tab = item.dataset.tab;
        if (tab === 'people') self.togglePanel();
        else if (tab === 'profile') {
          // v6.1.10: Perfil con el registro de diagnóstico (main.js)
          _safeDispatchEvent('nexo:ui:profile', {});
          navItems.forEach(function(n) { n.classList.toggle('active', n.dataset.tab === 'chats'); });
        }
        else if (tab === 'chats') {
          self.elements.panel.classList.remove('active');
          self.elements.overlay.classList.remove('active');
        }
      });
    });
    window.addEventListener('nexo:ble:sendReadReceipt', function(e) {
      try {
        var d = e.detail || {};
        if (!d.nexoId || !d.msgId) return;
        var devId = self._resolveDeviceIdForNexoId(d.nexoId);
        if (!devId) return;
        if (self.ackSystem && self.ackSystem.sendReadReceipt) self.ackSystem.sendReadReceipt(devId, d.msgId);
      } catch (err) {}
    });
    window.addEventListener('nexo:ble:closeChat', function() {
      self._activeChatDeviceId = null;
      self._activeChatDeviceIdNative = null;
      self._stopPingInterval();
      self.updateBadge();
      if (self.elements.fabBtn) self.elements.fabBtn.style.display = 'flex';
      if (self.elements.bottomNav) self.elements.bottomNav.style.display = 'flex';
      if (self.elements.panel) self.elements.panel.classList.remove('active');
      if (self.elements.overlay) self.elements.overlay.classList.remove('active');
      self.renderContactsList();
      self.renderOnlineStrip();
    });
    window.addEventListener('nexo:ble:openChat', function() {
      if (self.elements.fabBtn) self.elements.fabBtn.style.display = 'none';
      if (self.elements.bottomNav) self.elements.bottomNav.style.display = 'none';
    });
  }
  _stopPingInterval() {
    if (this._pingInterval) { clearInterval(this._pingInterval); this._pingInterval = null; }
    this._pendingPings.forEach(function(p) { clearTimeout(p.timer); });
    this._pendingPings.clear();
  }
  togglePanel() {
    this.elements.panel.classList.toggle('active');
    this.elements.overlay.classList.toggle('active');
    if (this.elements.panel.classList.contains('active')) {
      this.newDevicesCount = 0;
      this.updateBadge();
      this.renderContactsList();
      this.renderOnlineStrip();
      var self = this;
      setTimeout(function() {
        if (!self.isDummyMode && self.nativePlugin && !self.isScanning) self._autoScanForKnownContacts();
      }, 300);
    }
    this.updateScanButton();
  }
  _executeToggleScan() {
    var self = this;
    if (self.isScanning) {
      if (_hasNativeMethod(self.nativePlugin, 'stopScan')) {
        return _safeNativeCall(self.nativePlugin, 'stopScan', {}).then(function() {
          self.isScanning = false;
          self.updateScanButton();
          self.updateStatus();
        });
      }
      self.isScanning = false;
      self.updateScanButton();
      self.updateStatus();
      return Promise.resolve();
    } else {
      self.foundDevices.clear();
      self.renderContactsList();
      self.renderNewDeviceBar();
      self.renderOnlineStrip();
      if (_hasNativeMethod(self.nativePlugin, 'startScan')) {
        return _safeNativeCall(self.nativePlugin, 'startScan', {}).then(function() {
          self.isScanning = true;
          self.updateScanButton();
        });
      }
      self.isScanning = true;
      self.updateScanButton();
      return Promise.resolve();
    }
  }
  _doToggleScan() {
    var self = this;
    var permsReady = false;
    if (window.ensureBLEPermissions) {
      return window.ensureBLEPermissions().then(function(result) { permsReady = result; }).catch(function() { permsReady = true; }).then(function() {
        if (!permsReady) return Promise.resolve();
        return self._executeToggleScan();
      }).catch(function(err) {
        self.isScanning = false;
        self.updateScanButton();
      });
    } else { permsReady = true; }
    if (!permsReady) return Promise.resolve();
    return self._executeToggleScan();
  }
  toggleScan() {
    var self = this;
    if (self.isDummyMode) return Promise.resolve();
    if (self.nativePlugin && _hasNativeMethod(self.nativePlugin, 'isBluetoothEnabled')) {
      return _safeNativeCall(self.nativePlugin, 'isBluetoothEnabled', {})
        .then(function(btState) {
          if (!btState || !btState.enabled) {
            _showToast('Bluetooth apagado. Activalo.', 'warn');
            self.updateStatusBar('BLE OFF');
            return Promise.resolve();
          }
          return self._doToggleScan();
        }).catch(function() { return self._doToggleScan(); });
    }
    return self._doToggleScan();
  }

  onDeviceFound(device) {
    var deviceId = device.id || '';
    if (!deviceId) return;
    var nexoId = device.nexoId || '';
    if (!nexoId || nexoId.length !== 10 || nexoId.indexOf('NX') !== 0) {
      return;
    }
    var nd = _normMac(deviceId);
    var nx = _normId(nexoId);
    if (nd && nx) {
      this._nexoIdToMac.set(nx, nd);
      this._macToNexoId.set(nd, nx);
    }
    var isContact = _isBLEContact(nexoId);
    if (isContact) {
      var contacts = _getBLEContacts();
      var idx = contacts.findIndex(function(c) {
        return _normId(c.nexoId || c.deviceUUID) === nx;
      });
      if (idx >= 0) {
        contacts[idx].online = true;
        contacts[idx].lastSeen = Date.now();
        contacts[idx].deviceId = deviceId;
        if (device.name && !contacts[idx].name) {
          contacts[idx].name = device.name;
        }
        _saveBLEContacts(contacts);
      }
      this.renderContactsList();
      this.renderOnlineStrip();
      var state = this._getDeviceState(deviceId);
      // v6.1.6: también desde ERROR (p.ej. se conectó cuando el otro tenía la app cerrada)
      if (state.state === BLE_STATES.DISCONNECTED || state.state === BLE_STATES.ERROR) {
        this._autoConnectGATT(deviceId, device);
      }
      return;
    }
    var existing = this.foundDevices.get(nx);
    if (!existing) {
      device.lastSeen = Date.now();
      device.deviceUUID = nexoId;
      this.foundDevices.set(nx, device);
      this.newDevicesCount++;
      this.updateBadge();
      this.renderNewDeviceBar();
    } else {
      existing.id = deviceId;
      existing.name = device.name || existing.name || '';
      existing.rssi = device.rssi;
      existing.lastSeen = Date.now();
      existing.deviceUUID = nexoId;
      this.foundDevices.set(nx, existing);
      this.renderNewDeviceBar();
    }
  }
  renderOnlineStrip() {
    var self = this;
    var strip = this.elements.mainOnlineStrip;
    if (!strip) return;
    strip.innerHTML = '';
    var contacts = _getBLEContacts();
    var onlineContacts = contacts.filter(function(c) { return c.online && (Date.now() - (c.lastSeen || 0)) < 60000; });
    if (onlineContacts.length === 0) { strip.style.display = 'none'; return; }
    strip.style.display = 'flex';
    onlineContacts.forEach(function(contact) {
      var uuid = _normId(contact.nexoId || contact.deviceUUID);
      var item = document.createElement('div');
      item.className = 'ble-online-item';
      var initials = _getInitials(contact.name);
      var gradClass = _getGradientForUUID(uuid);
      item.innerHTML = '<div class="ble-online-avatar ' + gradClass + '">' + initials + '<div class="ble-online-dot"></div></div><span class="ble-online-name">' + (contact.name || '') + '</span>';
      item.addEventListener('click', function() { self.openChat(uuid); });
      strip.appendChild(item);
    });
  }
  // v6.1.8: se llamaba con cada paquete recibido (pings, trozos de foto) y reconstruía toda la lista
  renderContactsList() {
    var self = this;
    var now = Date.now();
    if (self._contactsRenderTimer) return;
    var wait = 300 - (now - (self._lastContactsRender || 0));
    if (wait <= 0) { self._renderContactsListNow(); return; }
    self._contactsRenderTimer = setTimeout(function() { self._contactsRenderTimer = null; self._renderContactsListNow(); }, wait);
  }

  // v6.1.8: único punto que actualiza el último mensaje de un contacto (enviado o recibido)
  noteContactMessage(nexoId, preview, ts) {
    var nx = _normId(nexoId);
    if (!nx) return;
    var contacts = _getBLEContacts();
    var c = contacts.find(function(x) { return _normId(x.nexoId || x.deviceUUID) === nx; });
    if (!c) return;
    var t = ts || Date.now();
    if ((c.lastMessageAt || 0) > t) return;
    c.lastMessageAt = t;
    if (preview) c.lastMessage = preview;
    _saveBLEContacts(contacts);
    this.renderContactsList();
  }

  // v6.1.8: contactos guardados antes de lastMessageAt: se toma del historial
  _backfillLastMessageAt() {
    var self = this;
    var contacts = _getBLEContacts().filter(function(c) { return !c.lastMessageAt && (c.nexoId || c.deviceUUID); });
    if (!contacts.length) return;
    Promise.all(contacts.map(function(c) {
      var nx = _normId(c.nexoId || c.deviceUUID);
      return _vaultLoadMessages(nx).then(function(msgs) {
        var last = (msgs || []).reduce(function(m, x) { return (x.timestamp || 0) > ((m && m.timestamp) || 0) ? x : m; }, null);
        if (last) self.noteContactMessage(nx, _messagePreview(last.content || last.text, last.attachmentType), last.timestamp);
      }).catch(function() {});
    }));
  }

  _renderContactsListNow() {
    var self = this;
    self._lastContactsRender = Date.now();
    var list = this.elements.mainContactsList;
    if (!list) return;
    list.innerHTML = '';
    var contacts = _getBLEContacts();
    var seenNexoIds = {};
    var deduped = [];
    contacts.forEach(function(c) {
      var nid = _normId(c.nexoId || c.deviceUUID);
      if (!nid) return;
      if (!seenNexoIds[nid]) { seenNexoIds[nid] = true; deduped.push(c); }
      else {
        var existing = deduped.find(function(d) { return _normId(d.nexoId || d.deviceUUID) === nid; });
        if (existing && (c.lastSeen || 0) > (existing.lastSeen || 0)) {
          existing.name = c.name || existing.name;
          existing.lastSeen = c.lastSeen;
          existing.online = c.online;
          existing.lastMessage = c.lastMessage || existing.lastMessage;
          existing.lastMessageAt = Math.max(existing.lastMessageAt || 0, c.lastMessageAt || 0);
          existing.unreadCount = Math.max(existing.unreadCount || 0, c.unreadCount || 0);
          existing.deviceId = c.deviceId || existing.deviceId;
        }
      }
    });
    contacts = deduped;
    if (contacts.length === 0) {
      list.innerHTML = '';
      if (this.elements.mainEmptyMsg) this.elements.mainEmptyMsg.classList.add('visible');
      this.renderOnlineStrip();
      return;
    }
    if (this.elements.mainEmptyMsg) this.elements.mainEmptyMsg.classList.remove('visible');
    var pinned = _getPinnedContacts();
    contacts.sort(function(a, b) {
      var aPinned = pinned.indexOf(_normId(a.nexoId || a.deviceUUID)) >= 0 ? 1 : 0;
      var bPinned = pinned.indexOf(_normId(b.nexoId || b.deviceUUID)) >= 0 ? 1 : 0;
      if (aPinned !== bPinned) return bPinned - aPinned;
      // v6.1.8: por último mensaje; sin mensajes, por fecha de alta (estable)
      var d = (b.lastMessageAt || 0) - (a.lastMessageAt || 0);
      if (d !== 0) return d;
      d = (b.addedAt || 0) - (a.addedAt || 0);
      if (d !== 0) return d;
      return String(a.name || '').localeCompare(String(b.name || ''));
    });
    contacts.forEach(function(contact, index) {
      var uuid = _normId(contact.nexoId || contact.deviceUUID);
      var isOnline = contact.online && (Date.now() - (contact.lastSeen || 0)) < 60000;
      var initials = _getInitials(contact.name);
      var gradClass = _getGradientForUUID(uuid);
      var lastMsg = contact.lastMessage || (isOnline ? 'En linea' : 'Offline');
      var timeStr = _formatTime(contact.lastMessageAt);
      var unread = contact.unreadCount || 0;
      var row = document.createElement('div');
      row.className = 'ble-contact-row';
      row.addEventListener('click', function(e) {
        if (e.target.closest('.ble-contact-menu') || e.target.closest('.ble-btn-menu')) return;
        self.openChat(uuid);
      });
      var avatar = document.createElement('div');
      avatar.className = 'ble-contact-avatar ' + gradClass;
      avatar.textContent = initials;
      row.appendChild(avatar);
      var info = document.createElement('div');
      info.className = 'ble-contact-info';
      info.innerHTML = '<div class="ble-contact-name">' + (contact.name || '') + '</div><div class="ble-contact-msg">' + lastMsg + '</div>';
      row.appendChild(info);
      var meta = document.createElement('div');
      meta.className = 'ble-contact-meta';
      var metaHtml = '<span class="ble-contact-time">' + timeStr + '</span>';
      if (unread > 0) metaHtml += '<div class="ble-unread-badge">' + unread + '</div>';
      meta.innerHTML = metaHtml;
      row.appendChild(meta);
      var menuBtn = document.createElement('button');
      menuBtn.className = 'ble-btn-menu';
      menuBtn.innerHTML = '&#x22EE;';
      menuBtn.style.cssText = 'width:36px;height:36px;border-radius:50%;background:rgba(255,255,255,0.1);color:#fff;border:none;cursor:pointer;font-size:18px;display:flex;align-items:center;justify-content:center;transition:all 0.2s;flex-shrink:0;margin-left:8px;';
      menuBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        self._toggleContactMenu(uuid, menuBtn);
      });
      row.appendChild(menuBtn);
      list.appendChild(row);
      if (index < contacts.length - 1) {
        var divider = document.createElement('div');
        divider.className = 'ble-divider';
        list.appendChild(divider);
      }
    });
    this.renderOnlineStrip();
  }
  _toggleContactMenu(uuid, btn) {
    var self = this;
    var existing = document.querySelector('.ble-contact-menu');
    if (existing) { existing.remove(); return; }
    var menu = document.createElement('div');
    menu.className = 'ble-contact-menu';
    var isPinned = _isPinned(uuid);
    menu.innerHTML = '<div class="ble-menu-item" data-action="pin">' + (isPinned ? '&#x2606; Desfijar' : '&#x2605; Fijar') + '</div><div class="ble-menu-item" data-action="profile">&#x1F464; Perfil</div><div class="ble-menu-item ble-menu-delete" data-action="delete">&#x1F5D1; Eliminar</div>';
    var rect = btn.getBoundingClientRect();
    menu.style.top = (rect.bottom + 4) + 'px';
    menu.style.right = (window.innerWidth - rect.right) + 'px';
    document.body.appendChild(menu);
    menu.addEventListener('click', function(e) {
      var action = e.target.dataset.action;
      if (action === 'pin') { _togglePinnedContact(uuid); self.renderContactsList(); }
      else if (action === 'delete') { self.removeContact(uuid); }
      else if (action === 'profile') { _safeDispatchEvent('nexo:ble:goToProfile', { deviceUUID: uuid }); }
      menu.remove();
    });
    setTimeout(function() {
      document.addEventListener('click', function closeMenu(e) {
        if (!menu.contains(e.target)) {
          menu.remove();
          document.removeEventListener('click', closeMenu);
        }
      });
    }, 10);
  }
  renderNewDeviceBar() {
    var bar = this.elements.newDeviceBar;
    if (!bar) return;
    var self = this;
    var newDevices = [];
    this.foundDevices.forEach(function(device, deviceId) {
      var uuid = device.deviceUUID;
      if (uuid && !_isBLEContact(uuid)) newDevices.push({ deviceId: deviceId, device: device });
    });
    if (newDevices.length === 0) { bar.style.display = 'none'; bar.innerHTML = ''; return; }
    bar.style.display = 'flex';
    bar.style.flexDirection = 'column';
    bar.style.gap = '8px';
    bar.innerHTML = '';
    newDevices.forEach(function(item) {
      var device = item.device;
      var deviceId = item.deviceId;
      var displayName = device.name || device.deviceUUID || 'Nexo Device';
      var row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;justify-content:space-between;width:100%;padding:12px 20px;border:2px solid #00c8ff;border-radius:16px;background:rgba(0,20,40,0.9);box-sizing:border-box;';
      var nameSpan = document.createElement('span');
      nameSpan.textContent = displayName;
      nameSpan.style.cssText = 'color:#fff;font-size:16px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;margin-right:12px;';
      var addBtn = document.createElement('button');
      addBtn.textContent = '+';
      addBtn.style.cssText = 'width:40px;height:40px;border-radius:50%;background:#00c8ff;border:none;color:#fff;font-size:20px;font-weight:700;cursor:pointer;flex-shrink:0;display:flex;align-items:center;justify-content:center;';
      addBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        self._addNewDevice(deviceId);
      });
      row.appendChild(nameSpan);
      row.appendChild(addBtn);
      bar.appendChild(row);
    });
  }
  _addNewDevice(deviceId) {
    var self = this;
    if (!deviceId) {
      var bar = this.elements.newDeviceBar;
      if (bar && bar.dataset) {
        deviceId = bar.dataset.deviceId || '';
      }
    }
    var device = this.foundDevices.get(deviceId);
    if (!device) return;
    var name = device.name || device.deviceUUID || 'Nexo Device';
    var nexoId = device.deviceUUID || '';
    if (!nexoId || nexoId.length !== 10 || nexoId.indexOf('NX') !== 0) {
      console.warn('[BLEInterface] Sin NEXO ID');
      return;
    }
    if (!_isBLEContact(nexoId)) {
      _addBLEContact({
        deviceUUID: nexoId,
        name: name,
        deviceId: device.id || null
      });
      _vaultGetOrCreateContact(nexoId, name, device.name);
    } else {
      var contacts = _getBLEContacts();
      var idx = contacts.findIndex(function(c) {
        return _normId(c.nexoId || c.deviceUUID) === _normId(nexoId);
      });
      if (idx >= 0) {
        contacts[idx].deviceId = device.id || contacts[idx].deviceId;
        contacts[idx].lastSeen = Date.now();
        contacts[idx].online = true;
        _saveBLEContacts(contacts);
      }
    }
    this._autoConnectGATT(device.id || deviceId, device);
    this.foundDevices.delete(deviceId);
    this.renderNewDeviceBar();
    this.renderContactsList();
    this.renderOnlineStrip();
    this.togglePanel();
  }
  _autoConnectGATT(deviceId, device) {
    var self = this;
    if (!self.nativePlugin || !_hasNativeMethod(self.nativePlugin, 'connectToDevice')) return Promise.resolve();
    if (!deviceId) return Promise.resolve();
    var state = self._getDeviceState(deviceId);
    if (state.state === BLE_STATES.CONNECTING && state.timestamp && (Date.now() - state.timestamp > 8000)) {
      self._forceDisconnectAndReconnect(deviceId);
      return Promise.resolve();
    }
    if (state.state === BLE_STATES.READY_TO_CHAT || state.state === BLE_STATES.NOTIFICATIONS_READY || state.state === BLE_STATES.CONNECTING) return Promise.resolve();
    self._setDeviceState(deviceId, BLE_STATES.CONNECTING, { direction: 'outgoing', role: 'client', auto: true });
    self.connectedDevices.set(deviceId, { id: deviceId, name: (device && device.name) || '', direction: 'outgoing', servicesReady: false, deviceUUID: device && device.deviceUUID });
    var connTarget = deviceId;
    var normTarget = _normMac(deviceId);
    if (!/^[0-9a-f]{12}$/.test(normTarget)) {
      var mapped = self._nexoIdToMac.get(_normId(deviceId));
      if (mapped) connTarget = mapped;
    }
    return _safeNativeCall(self.nativePlugin, 'connectToDevice', { deviceId: connTarget })
      .then(function(result) {
        if (result && (result.connected || result.alreadyConnected)) {
          return self._waitForReadyToChat(deviceId, 8000).then(function() {});
        } else {
          self._setDeviceState(deviceId, BLE_STATES.DISCONNECTED);
        }
      })
      .catch(function(e) {
        self._setDeviceState(deviceId, BLE_STATES.DISCONNECTED);
      });
  }
  removeContact(deviceUUID) {
    try {
      _removeBLEContact(deviceUUID);
      this.renderContactsList();
      this.renderNewDeviceBar();
      this.renderOnlineStrip();
    } catch (e) {}
  }
  disconnect(deviceId) {
    var self = this;
    if (self.isDummyMode) return Promise.resolve();
    if (!deviceId) return Promise.resolve();
    var bt = self._backoffTimers.get(deviceId);
    if (bt) { clearTimeout(bt); self._backoffTimers.delete(deviceId); }
    self._reconnectAttempts.delete(deviceId);
    if (_hasNativeMethod(self.nativePlugin, 'disconnectDevice')) {
      return _safeNativeCall(self.nativePlugin, 'disconnectDevice', { deviceId: deviceId })
        .then(function() {
          if (self._activeChatDeviceId) {
            self._activeChatDeviceId = null;
            self._activeChatDeviceIdNative = null;
            self.updateBadge();
          }
        }).catch(function() {});
    }
    return Promise.resolve();
  }
  updateBadge() {
    var fabBtn = this.elements.fabBtn;
    if (!fabBtn) return;
    if (this._activeChatDeviceId) { fabBtn.style.display = 'none'; return; }
    fabBtn.style.display = 'flex';
    if (this.newDevicesCount > 0) fabBtn.innerHTML = '<span style="color:#fff;font-size:14px;font-weight:700;">' + this.newDevicesCount + '</span>';
    else fabBtn.innerHTML = '<svg viewBox="0 0 24 24" width="24" height="24" fill="#fff"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/></svg>';
  }

  updateStatusBar(text) {
    if (this.elements.statusText) this.elements.statusText.textContent = text || '';
  }
  updateStatus(customStatus) {
    var self = this;
    if (customStatus) { self.updateStatusBar(customStatus); return Promise.resolve(); }
    if (self.isDummyMode) { self.updateStatusBar('OFFLINE (Dummy)'); return Promise.resolve(); }
    if (self.nativePlugin && _hasNativeMethod(self.nativePlugin, 'isBluetoothEnabled')) {
      return _safeNativeCall(self.nativePlugin, 'isBluetoothEnabled', {})
        .then(function(state) {
          if (state && state.enabled) {
            var connCount = self.connectedDevices ? self.connectedDevices.size : 0;
            self.updateStatusBar('BLE ON | ' + connCount + ' conectados');
          } else {
            self.updateStatusBar('BLE OFF');
          }
        })
        .catch(function() { self.updateStatusBar(''); });
    }
    self.updateStatusBar('');
    return Promise.resolve();
  }
  getContacts() { return _getBLEContacts(); }
  getContactByUUID(deviceUUID) { return _getContactByUUID(deviceUUID); }
  destroy() {
    var self = this;
    console.log('[BLEInterface] destroy()');
    self._stopConnectionSupervisor();
    self._stopPingInterval();
    if (self._reconnectScanTimer) { clearTimeout(self._reconnectScanTimer); self._reconnectScanTimer = null; }
    self._lostPeers.clear();
    self._backoffTimers.forEach(function(t) { clearTimeout(t); });
    self._backoffTimers.clear();
    self._reconnectAttempts.clear();
    ['_nativePayloadListener', '_nativeDeviceConnectedListener', '_nativeDeviceDisconnectedListener',
     '_nativeServicesReadyListener', '_nativeNotificationsListener', '_nativeConnectionFailedListener',
     '_nativeScanFailedListener', '_nativeServerReadyListener', '_nativeAdStartedListener',
     '_nativeAdFailedListener'].forEach(function(prop) {
      if (self[prop]) { try { self[prop].remove(); } catch (e) {} self[prop] = null; }
    });
    self._notificationFallbackTimers.forEach(function(t) { clearTimeout(t); });
    self._notificationFallbackTimers.clear();
    self._readyResolvers.forEach(function(r) {
      clearTimeout(r.timer);
      try { r.reject(new Error('Interface destroyed')); } catch (e) {}
    });
    self._readyResolvers.clear();
    self._pendingPings.forEach(function(p) { clearTimeout(p.timer); });
    self._pendingPings.clear();
    self._pendingMessageQueue.clear();
    self.connectedDevices.clear();
    self.foundDevices.clear();
    self._deviceStates.clear();
    self._supervisorStates.clear();
    self._lastPongTime.clear();
    self._pingFailCount.clear();
    self._nexoIdToMac.clear();
    self._macToNexoId.clear();
    self._receivedMessageIds.clear();
    self._notifiedPeers.clear();
  }
}
export function initBLEInterface(bleMesh) {
  var instance = new BLEInterface(bleMesh).init();
  window.bleInterface = instance;
  return instance;
}
