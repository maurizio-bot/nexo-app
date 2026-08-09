// ═══════════════════════════════════════════════════════════════════════════════
// PARTE 1: CONSTANTES, STORAGE KEYS Y HELPERS BASE
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * BLE Interface v5.2.8-NXID-PURO-MAC-NORMALIZADA
 * FIX: MAC normalizada (lowercase, sin separadores) en contactos y búsquedas.
 * FIX: _getContactByDeviceId compara MACs normalizadas.
 * FIX: sendChatMessage timeout texto corregido a 20s.
 * FIX: _sendMessageNative detecta MAC vs NXID y pasa formato correcto al plugin.
 * FIX: Listeners nativos normalizan deviceId antes de buscar en mapas/contactos.
 */
var BLE_UUID_STORAGE_KEY = 'nexo_device_uuid';
var BLE_PINNED_CONTACTS_KEY = 'nexo_ble_pinned_contacts';
var BLE_NEXO_ID_STORAGE_KEY = 'nexo_ble_advertising_id';
var BLE_NEXO_ID_VAULT_FILE = 'nexo_advertising_id.json';
var GRADIENTS = [
  'ble-gradient-1', 'ble-gradient-2', 'ble-gradient-3', 'ble-gradient-4',
  'ble-gradient-5', 'ble-gradient-6', 'ble-gradient-7', 'ble-gradient-8'
];
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
function _getDeviceUUID() {
  var stored = localStorage.getItem(BLE_UUID_STORAGE_KEY);
  if (stored) return stored;
  var newUUID = _generateUUID();
  localStorage.setItem(BLE_UUID_STORAGE_KEY, newUUID);
  return newUUID;
}
function _normId(id) {
  return (id || '').toString().toLowerCase().trim();
}
function _normMac(mac) {
  return (mac || '').toString().toLowerCase().replace(/[:.\-]/g, '');
}

// ═══════════════════════════════════════════════════════════════════════════════
// PARTE 2: NEXO ID PROPIO
// ═══════════════════════════════════════════════════════════════════════════════

function _generateNexoId() {
  var now = new Date();
  var seconds = now.getSeconds();
  var secBase36 = seconds.toString(36).toUpperCase().padStart(2, '0');
  var uuidPart = _generateUUID().replace(/-/g, '').substring(0, 6).toUpperCase();
  return 'NX' + secBase36 + uuidPart;
}
function _saveNexoIdToVault(nexoId) {
  return new Promise(function(resolve) {
    try { localStorage.setItem(BLE_NEXO_ID_STORAGE_KEY, nexoId); } catch (e) {}
    if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.NexoBLE) {
      _safeNativeCall(window.Capacitor.Plugins.NexoBLE, 'saveToFile', {
        filename: BLE_NEXO_ID_VAULT_FILE,
        content: JSON.stringify({ nexoId: nexoId, createdAt: Date.now() })
      }).then(function() { resolve(nexoId); }).catch(function() { resolve(nexoId); });
    } else { resolve(nexoId); }
  });
}
function _loadNexoIdFromVault() {
  return new Promise(function(resolve) {
    var cached = null;
    try { cached = localStorage.getItem(BLE_NEXO_ID_STORAGE_KEY); } catch (e) {}
    if (cached && cached.length === 10 && cached.indexOf('NX') === 0) { resolve(cached); return; }
    if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.NexoBLE) {
      _safeNativeCall(window.Capacitor.Plugins.NexoBLE, 'loadFromFile', {
        filename: BLE_NEXO_ID_VAULT_FILE
      }).then(function(result) {
        if (result && result.exists && result.content) {
          try {
            var data = JSON.parse(result.content);
            if (data.nexoId && data.nexoId.length === 10 && data.nexoId.indexOf('NX') === 0) {
              try { localStorage.setItem(BLE_NEXO_ID_STORAGE_KEY, data.nexoId); } catch (e) {}
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

// ═══════════════════════════════════════════════════════════════════════════════
// PARTE 3: CONTACTOS BLE - CRUD via vault_manager.js (UNIFICADO)
// ═══════════════════════════════════════════════════════════════════════════════

function _getBLEContacts() {
  if (window.vaultLoadContactsSync && typeof window.vaultLoadContactsSync === 'function') {
    return window.vaultLoadContactsSync();
  }
  try { var raw = localStorage.getItem('nexo_vault_contacts_v2'); return raw ? JSON.parse(raw) : []; }
  catch (e) { return []; }
}
function _saveBLEContacts(contacts) {
  if (window.vaultSaveContact && typeof window.vaultSaveContact === 'function') {
    try { localStorage.setItem('nexo_vault_contacts_v2', JSON.stringify(contacts)); } catch (e) {}
    return;
  }
  try { localStorage.setItem('nexo_vault_contacts_v2', JSON.stringify(contacts)); } catch (e) {}
}
function _addBLEContact(contact) {
  var contacts = _getBLEContacts();
  var uuid = _normId(contact.deviceUUID || contact.nexoId);
  if (!uuid) return false;
  var existingIdx = contacts.findIndex(function(c) { return _normId(c.nexoId || c.deviceUUID) === uuid; });
  if (existingIdx >= 0) {
    contacts[existingIdx].displayName = contact.name || contact.displayName || contacts[existingIdx].displayName || '';
    contacts[existingIdx].lastSeen = Date.now();
    contacts[existingIdx].online = true;
    if (contact.deviceId) contacts[existingIdx].deviceId = _normMac(contact.deviceId);
    _saveBLEContacts(contacts);
    return true;
  }
  contacts.push({
    nexoId: uuid,
    displayName: contact.name || contact.displayName || '',
    deviceId: contact.deviceId ? _normMac(contact.deviceId) : null,
    createdAt: Date.now(),
    lastSeen: Date.now(),
    online: true,
    unreadCount: 0,
    lastMessage: '',
    avatarColor: contact.avatarColor || ''
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
  return _getBLEContacts().some(function(c) { return _normId(c.nexoId || c.deviceUUID) === _normId(deviceUUID); });
}
function _getContactByUUID(deviceUUID) {
  var uuid = _normId(deviceUUID);
  return _getBLEContacts().find(function(c) { return _normId(c.nexoId || c.deviceUUID) === uuid; });
}
function _getContactByDeviceId(deviceId) {
  if (!deviceId) return null;
  var norm = _normMac(deviceId);
  return _getBLEContacts().find(function(c) {
    if (!c.deviceId) return false;
    return _normMac(c.deviceId) === norm;
  });
}
function _getPinnedContacts() {
  try { var raw = localStorage.getItem(BLE_PINNED_CONTACTS_KEY); return raw ? JSON.parse(raw) : []; }
  catch (e) { return []; }
}
function _togglePinnedContact(deviceUUID) {
  var uuid = _normId(deviceUUID);
  var pinned = _getPinnedContacts();
  var idx = pinned.indexOf(uuid);
  if (idx >= 0) pinned.splice(idx, 1); else pinned.push(uuid);
  try { localStorage.setItem(BLE_PINNED_CONTACTS_KEY, JSON.stringify(pinned)); } catch (e) {}
  return idx < 0;
}
function _isPinned(deviceUUID) {
  return _getPinnedContacts().indexOf(_normId(deviceUUID)) >= 0;
}

// ═══════════════════════════════════════════════════════════════════════════════
// PARTE 4: ESTADOS BLE Y UTILIDADES NATIVAS
// ═══════════════════════════════════════════════════════════════════════════════

var BLE_STATES = {
  DISCONNECTED: 'disconnected', CONNECTING: 'connecting',
  DISCOVERING_SERVICES: 'discovering_services', NOTIFICATIONS_READY: 'notifications_ready',
  READY_TO_CHAT: 'ready_to_chat', ERROR: 'error', RECONNECTING: 'reconnecting'
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
  if (!content || typeof content !== 'string') return false;
  if (content.length > 5000) return false;
  var fc = content.charAt(0);
  if (fc !== '{' && fc !== '[') return false;
  try {
    var json = JSON.parse(content);
    if (json && (json.type === 'ack' || json.type === 'read_receipt' || json.type === 'ping' || json.type === 'pong')) return true;
  } catch (e) {}
  return false;
}

// ═══════════════════════════════════════════════════════════════════════════════
// PARTE 5: VAULT FASE 4 - Eliminado. Usamos vault_manager.js directamente.
// ═══════════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════════
// PARTE 6: AUTOSCAN
// ═══════════════════════════════════════════════════════════════════════════════

function _autoScanRegister(nexoId) {
  try {
    if (window.autoScan && typeof window.autoScan.register === 'function') {
      window.autoScan.register(nexoId);
    }
  } catch (e) {}
}
function _autoScanUnregister(nexoId) {
  try {
    if (window.autoScan && typeof window.autoScan.unregister === 'function') {
      window.autoScan.unregister(nexoId);
    }
  } catch (e) {}
}
function _autoScanStart() {
  try {
    if (window.autoScan && typeof window.autoScan.start === 'function') {
      window.autoScan.start();
    }
  } catch (e) {}
}

// ═══════════════════════════════════════════════════════════════════════════════
// PARTE 7: CLASE BLEInterface - Constructor e Inicialización
// ═══════════════════════════════════════════════════════════════════════════════

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
    this.localDeviceUUID = _getDeviceUUID();
    this.localNexoId = null;
    this._activeChatDeviceId = null;
    this._activeChatDeviceIdNative = null;
    this._deviceStates = new Map();
    this._receivedMessageIds = new Set();
    this._maxMessageIds = 1000;
    this._pendingMessageQueue = new Map();
    this._readyResolvers = new Map();
    this._notificationFallbackTimers = new Map();
    this.ackSystem = null;
    this._scanCycleTimer = null;
    this._scanCycleInterval = 30000;
    this._scanCycleDuration = 6000;
    this._advRestartTimer = null;
    this._macToNexoId = new Map();
    this._nexoIdToMac = new Map();
    this._connectCooldowns = new Map();
    console.log('[BLEInterface] v5.2.8-NXID-PURO-MAC-NORMALIZADA iniciado');
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
  getBLEContacts() {
    return _getBLEContacts();
  }
  _loadContactsAndInit() {
    var self = this;
    self._continueInit();
  }
  _continueInit() {
    if (this.isDummyMode) {
      this.updateStatus('OFFLINE (Dummy)');
    } else {
      this.updateStatus();
      this._setupNativeScanListeners();
      this._setupNativeConnectionListeners();
      this._setupNativePayloadListener();
      this._setupNativeStateListeners();
      this._setupNativeServerReadyListener();
      this._loadLocalDeviceInfo();
      this._initVisibility();
      this._initNexoId();
      this._autoStartAdvertising();
    }
    this._setupAppStateListener();
    this.elements.panel.classList.remove('active');
    this.elements.overlay.classList.remove('active');
    this.renderContactsList();
    this.renderOnlineStrip();
    var self = this;
    setTimeout(function() {
      if (!self.isDummyMode && self.nativePlugin && !self.isScanning) {
        self._autoScanForKnownContacts();
      }
    }, 500);
  }
  _initNexoId() {
    var self = this;
    _getOrCreateNexoId().then(function(nexoId) {
      self.localNexoId = nexoId;
      console.log('[BLEInterface] NEXO ID:', nexoId);
      if (self.nativePlugin && _hasNativeMethod(self.nativePlugin, 'setAdvertisingData')) {
        _safeNativeCall(self.nativePlugin, 'setAdvertisingData', { nexoId: nexoId }).catch(function(e) {});
      }
    });
  }
  _setupAppStateListener() {
    var self = this;
    if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App) {
      var appPlugin = window.Capacitor.Plugins.App;
      if (_hasNativeMethod(appPlugin, 'addListener')) {
        appPlugin.addListener('appStateChange', function(state) {
          try {
            if (state && state.isActive === true) {
              self._stopScanCycle();
              self.renderContactsList(); self.renderOnlineStrip();
              setTimeout(function() {
                if (!self.isDummyMode && self.nativePlugin && !self.isScanning) {
                  console.log('[BLEInterface] Re-link scan al volver de background');
                  self._autoScanForKnownContacts();
                }
              }, 500);
              if (!self.isAdvertising && self.nativePlugin && _hasNativeMethod(self.nativePlugin, 'startAdvertising')) {
                _safeNativeCall(self.nativePlugin, 'startAdvertising', {})
                .then(function() { self.isAdvertising = true; self.updateVisibilityButton(); })
                .catch(function(e) {});
              }
            } else {
              self._stopScanCycle();
              if (self.isAdvertising && self.nativePlugin && _hasNativeMethod(self.nativePlugin, 'stopAdvertising')) {
                _safeNativeCall(self.nativePlugin, 'stopAdvertising', {}).catch(function(){});
                self.isAdvertising = false;
              }
            }
          } catch (e) {}
        });
      }
    }
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
        return _safeNativeCall(self.nativePlugin, 'startAdvertising', {})
        .then(function() { self.isAdvertising = true; self.canAdvertise = true; self.updateVisibilityButton(); })
        .catch(function(e) {});
      }
    })
    .catch(function(e) {});
  }
  _loadLocalDeviceInfo() {
    var self = this;
    if (!self.nativePlugin || !_hasNativeMethod(self.nativePlugin, 'getLocalDeviceInfo')) return Promise.resolve();
    return _safeNativeCall(self.nativePlugin, 'getLocalDeviceInfo', {})
    .then(function(info) {
      self.localDeviceName = (info && info.deviceName) || '';
    })
    .catch(function() {});
  }

// ═══════════════════════════════════════════════════════════════════════════════
// PARTE 8: LISTENERS NATIVOS - Scan, Conexión, Estado y Payload
// FIX: deviceId normalizado antes de buscar en mapas/contactos
// ═══════════════════════════════════════════════════════════════════════════════

  _setupNativeScanListeners() {
    if (!this.nativePlugin) return;
    if (!_hasNativeMethod(this.nativePlugin, 'addListener')) return;
    if (this._nativeDeviceFoundListener) { try { this._nativeDeviceFoundListener.remove(); } catch (e) {} }
    if (this._nativeScanFailedListener) { try { this._nativeScanFailedListener.remove(); } catch (e) {} }
    var self = this;
    this._nativeDeviceFoundListener = this.nativePlugin.addListener('onDeviceFound', function(data) {
      try {
        var deviceId = data.deviceId || '';
        var name = data.name || '';
        var nexoId = data.nexoId || '';
        if (!deviceId) return;
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
    if (this._nativeServerReadyListener) { try { this._nativeServerReadyListener.remove(); } catch (e) {} }
    var self = this;
    this._nativeServerReadyListener = this.nativePlugin.addListener('onServerReady', function(data) {
      try { console.log('[BLEInterface] onServerReady:', data); } catch (e) {}
    });
  }
  _setupNativeConnectionListeners() {
    if (!this.nativePlugin) return;
    if (!_hasNativeMethod(this.nativePlugin, 'addListener')) return;
    if (this._nativeDeviceConnectedListener) { try { this._nativeDeviceConnectedListener.remove(); } catch (e) {} }
    if (this._nativeDeviceDisconnectedListener) { try { this._nativeDeviceDisconnectedListener.remove(); } catch (e) {} }
    var self = this;
    this._nativeDeviceConnectedListener = this.nativePlugin.addListener('onDeviceConnected', function(data) {
      try {
        var deviceId = data.deviceId || '';
        var nexoId = data.nexoId || '';
        if (!deviceId) return;
        var normMac = _normMac(deviceId);
        if (!nexoId && deviceId) {
          var contactByMac = _getContactByDeviceId(deviceId);
          if (contactByMac) {
            nexoId = contactByMac.nexoId || contactByMac.deviceUUID;
          }
        }
        if (deviceId && nexoId) {
          self._macToNexoId.set(normMac, _normId(nexoId));
          self._nexoIdToMac.set(_normId(nexoId), normMac);
        }
        var peerUUID = nexoId ? _normId(nexoId) : null;
        var contactByDevice = null;
        if (!peerUUID && deviceId) {
          contactByDevice = _getContactByDeviceId(deviceId);
          if (contactByDevice) peerUUID = _normId(contactByDevice.nexoId || contactByDevice.deviceUUID);
        }
        if (!contactByDevice && deviceId) {
          contactByDevice = _getContactByDeviceId(deviceId);
        }
        var displayName = data.name || (contactByDevice ? contactByDevice.displayName : null) || '';
        self.connectedDevices.set(normMac, {
          id: deviceId, name: displayName,
          direction: data.direction || 'outgoing', role: data.role || 'client',
          servicesReady: data.servicesReady || false, deviceUUID: peerUUID
        });
        var stateKey = peerUUID || normMac;
        self._setDeviceState(stateKey, data.role === 'server' ? BLE_STATES.READY_TO_CHAT : BLE_STATES.CONNECTING, {
          direction: data.direction, role: data.role, deviceUUID: peerUUID
        });
        if (peerUUID) {
          var contacts = _getBLEContacts();
          var idx = contacts.findIndex(function(c) { return _normId(c.nexoId || c.deviceUUID) === peerUUID; });
          if (idx >= 0) {
            contacts[idx].online = true; contacts[idx].lastSeen = Date.now(); contacts[idx].deviceId = normMac;
            _saveBLEContacts(contacts); self.renderContactsList(); self.renderOnlineStrip();
          }
          _autoScanUnregister(peerUUID);
        }
        _safeDispatchEvent('nexo:ble:deviceConnected', { deviceId: deviceId, deviceUUID: peerUUID, name: displayName });
      } catch (e) {}
    });
    this._nativeDeviceDisconnectedListener = this.nativePlugin.addListener('onDeviceDisconnected', function(data) {
      try {
        var deviceId = data.deviceId || '';
        if (!deviceId) return;
        var normMac = _normMac(deviceId);
        var peerUUID = self._macToNexoId.get(normMac);
        if (!peerUUID) {
          var contact = _getContactByDeviceId(deviceId);
          if (contact) peerUUID = _normId(contact.nexoId || contact.deviceUUID);
        }
        self.connectedDevices.delete(normMac);
        if (peerUUID) {
          self._macToNexoId.delete(normMac);
          self._nexoIdToMac.delete(peerUUID);
        }
        var stateKey = peerUUID || normMac;
        self._setDeviceState(stateKey, BLE_STATES.DISCONNECTED);
        if (peerUUID) {
          var contacts = _getBLEContacts();
          var idx = contacts.findIndex(function(c) { return _normId(c.nexoId || c.deviceUUID) === peerUUID; });
          if (idx >= 0) { contacts[idx].online = false; _saveBLEContacts(contacts); self.renderContactsList(); self.renderOnlineStrip(); }
          _autoScanRegister(peerUUID);
          _autoScanStart();
        }
        _safeDispatchEvent('nexo:ble:deviceDisconnected', { deviceId: deviceId, deviceUUID: peerUUID });
        if (self.isAdvertising && self.nativePlugin && _hasNativeMethod(self.nativePlugin, 'startAdvertising')) {
          if (self._advRestartTimer) clearTimeout(self._advRestartTimer);
          self._advRestartTimer = setTimeout(function() {
            _safeNativeCall(self.nativePlugin, 'startAdvertising', {}).catch(function(e) {});
          }, 2000);
        }
      } catch (e) {}
    });
  }
  _setupNativeStateListeners() {
    if (!this.nativePlugin) return;
    if (!_hasNativeMethod(this.nativePlugin, 'addListener')) return;
    if (this._nativeServicesReadyListener) { try { this._nativeServicesReadyListener.remove(); } catch (e) {} }
    if (this._nativeNotificationsListener) { try { this._nativeNotificationsListener.remove(); } catch (e) {} }
    if (this._nativeConnectionFailedListener) { try { this._nativeConnectionFailedListener.remove(); } catch (e) {} }
    var self = this;
    this._nativeServicesReadyListener = this.nativePlugin.addListener('onServicesReady', function(data) {
      try {
        var deviceId = data.deviceId || '';
        if (!deviceId) return;
        var normMac = _normMac(deviceId);
        var existingTimer = self._notificationFallbackTimers.get(normMac);
        if (existingTimer) clearTimeout(existingTimer);
        var stateKey = self._macToNexoId.get(normMac) || normMac;
        self._setDeviceState(stateKey, BLE_STATES.DISCOVERING_SERVICES, { servicesReady: true });
        var device = self.connectedDevices.get(normMac);
        if (device) { device.servicesReady = true; self.connectedDevices.set(normMac, device); }
        var fallbackTimer = setTimeout(function() {
          var st = self._getDeviceState(stateKey);
          if (st.state === BLE_STATES.DISCOVERING_SERVICES) {
            self._setDeviceState(stateKey, BLE_STATES.READY_TO_CHAT);
            self._resolveReadyToChat(stateKey);
          }
        }, 3000);
        self._notificationFallbackTimers.set(normMac, fallbackTimer);
      } catch (e) {}
    });
    this._nativeNotificationsListener = this.nativePlugin.addListener('onNotificationsEnabled', function(data) {
      try {
        var deviceId = data.deviceId || '';
        if (!deviceId) return;
        var normMac = _normMac(deviceId);
        var ft = self._notificationFallbackTimers.get(normMac);
        if (ft) { clearTimeout(ft); self._notificationFallbackTimers.delete(normMac); }
        var nxid = self._macToNexoId.get(normMac);
        if (!nxid) {
          var c = _getContactByDeviceId(deviceId);
          if (c) {
            nxid = _normId(c.nexoId || c.deviceUUID);
            self._macToNexoId.set(normMac, nxid);
            self._nexoIdToMac.set(nxid, normMac);
          }
        }
        var stateKey = nxid || normMac;
        self._setDeviceState(stateKey, BLE_STATES.READY_TO_CHAT, { notificationsEnabled: true, deviceUUID: nxid });
        self._resolveReadyToChat(stateKey);
        self._processPendingMessages(stateKey);
      } catch (e) {}
    });
    this._nativeConnectionFailedListener = this.nativePlugin.addListener('onConnectionFailed', function(data) {
      try {
        var deviceId = data.deviceId || '';
        if (!deviceId) return;
        var normMac = _normMac(deviceId);
        var ft = self._notificationFallbackTimers.get(normMac);
        if (ft) { clearTimeout(ft); self._notificationFallbackTimers.delete(normMac); }
        var stateKey = self._macToNexoId.get(normMac) || normMac;
        self.connectedDevices.delete(normMac);
        self._setDeviceState(stateKey, BLE_STATES.ERROR, { lastError: data.reason });
      } catch (e) {}
    });
  }
  _setDeviceState(key, state, meta) {
    meta = meta || {};
    if (!key) return;
    var nxid = this._macToNexoId.get(key);
    if (!nxid) {
      var c = _getContactByDeviceId(key);
      if (c) {
        nxid = _normId(c.nexoId || c.deviceUUID);
        this._macToNexoId.set(_normMac(key), nxid);
        this._nexoIdToMac.set(nxid, _normMac(key));
      }
    }
    var normalizedKey = nxid || _normId(key);
    var stateObj = Object.assign({}, meta, { state: state, timestamp: Date.now() });
    this._deviceStates.set(normalizedKey, stateObj);
    if (state === BLE_STATES.DISCONNECTED || state === BLE_STATES.ERROR) {
      var queue = this._pendingMessageQueue.get(normalizedKey);
      if (queue && queue.length > 0) {
        this._pendingMessageQueue.delete(normalizedKey);
        queue.forEach(function(item) {
          if (item.timeoutId) clearTimeout(item.timeoutId);
          if (item.reject) item.reject(new Error('Dispositivo desconectado'));
        });
      }
    }
  }
  _getDeviceState(key) {
    if (!key) return { state: BLE_STATES.DISCONNECTED };
    var nxid = this._macToNexoId.get(_normMac(key));
    if (!nxid) {
      var c = _getContactByDeviceId(key);
      if (c) {
        nxid = _normId(c.nexoId || c.deviceUUID);
        this._macToNexoId.set(_normMac(key), nxid);
        this._nexoIdToMac.set(nxid, _normMac(key));
      }
    }
    var normalizedKey = nxid || _normId(key);
    var direct = this._deviceStates.get(normalizedKey);
    if (direct) return direct;
    return { state: BLE_STATES.DISCONNECTED };
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
        var normMac = _normMac(deviceId);
        var source = data.source || 'unknown';
        if (source !== 'gatt_server' && source !== 'gatt_client' && source !== 'broadcast') source = 'gatt_client';
        var messageId = null, senderName = null, senderUUID = null;
        var rawContent = data.content || data.data || '';
        var content = rawContent;
        var stableId = null;
        if (self.ackSystem && self.ackSystem.processIncomingFragment) {
          var fragmentHandled = self.ackSystem.processIncomingFragment({ deviceId: normMac, content: rawContent });
          if (fragmentHandled) return;
        }
        var isControl = _isControlPacket(rawContent);
        if (isControl) {
          if (self.ackSystem && self.ackSystem.processIncomingAck) {
            self.ackSystem.processIncomingAck(rawContent);
          }
          return;
        }
        var payloadStr = data.data || rawContent || '';
        if (payloadStr.length > 50000) { console.warn('[BLEInterface] Payload muy grande, ignorado'); return; }
        if (payloadStr.charAt(0) === '{') {
          try {
            var json = JSON.parse(payloadStr);
            if (json.msgId) messageId = json.msgId;
            if (json.messageId) messageId = json.messageId;
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
          } catch (e) {}
        }
        if (senderUUID) senderUUID = _normId(senderUUID);
        if (typeof content === 'string' && (content.indexOf('"type":"ack"') !== -1 || content.indexOf('"type":"read_receipt"') !== -1)) {
          try {
            var ackPayload = JSON.parse(content);
            if (ackPayload.type === 'ack' || ackPayload.type === 'read_receipt') {
              if (self.ackSystem && self.ackSystem.processIncomingAck) {
                self.ackSystem.processIncomingAck(content);
              }
              return;
            }
          } catch (e) {}
        }
        if (!senderUUID) {
          var contactByDevice = _getContactByDeviceId(deviceId);
          if (contactByDevice) senderUUID = _normId(contactByDevice.nexoId || contactByDevice.deviceUUID);
        }
        if (!senderName || senderName === '') {
          var contact = _getContactByUUID(senderUUID);
          var cname = contact ? contact.displayName : null;
          senderName = cname || (self.connectedDevices.get(normMac) && self.connectedDevices.get(normMac).name) || (self.foundDevices.get(normMac) && self.foundDevices.get(normMac).name) || '';
        }
        if (senderUUID && deviceId) {
          var contactsAdopt = _getBLEContacts();
          var idxAdopt = contactsAdopt.findIndex(function(c) { return _normId(c.nexoId || c.deviceUUID) === senderUUID; });
          if (idxAdopt >= 0 && !contactsAdopt[idxAdopt].deviceId) {
            contactsAdopt[idxAdopt].deviceId = normMac;
            _saveBLEContacts(contactsAdopt);
          }
        }
        if (senderUUID && deviceId) {
          self._macToNexoId.set(normMac, senderUUID);
          self._nexoIdToMac.set(senderUUID, normMac);
        }
        if (senderUUID && senderName && senderName !== '') {
          if (!_isBLEContact(senderUUID)) {
            _addBLEContact({ deviceUUID: senderUUID, name: senderName, deviceId: deviceId });
          } else {
            var contacts = _getBLEContacts();
            var idx = contacts.findIndex(function(c) { return _normId(c.nexoId || c.deviceUUID) === senderUUID; });
            if (idx >= 0) {
              contacts[idx].online = true;
              contacts[idx].lastSeen = Date.now();
              contacts[idx].deviceId = normMac;
              if (content && typeof content === 'string') contacts[idx].lastMessage = content.substring(0, 50);
              _saveBLEContacts(contacts);
            }
          }
          if (window.vaultGetOrCreateContact) {
            window.vaultGetOrCreateContact(senderUUID, senderName, normMac);
          }
          self.renderContactsList();
          self.renderOnlineStrip();
        }
        if (messageId && self._receivedMessageIds.has(messageId)) {
          if (self.ackSystem && self.ackSystem.sendAck) {
            self.ackSystem.sendAck(normMac, messageId);
          }
          return;
        }
        if (messageId) {
          self._receivedMessageIds.add(messageId);
          if (self._receivedMessageIds.size > self._maxMessageIds) {
            var first = self._receivedMessageIds.values().next().value;
            self._receivedMessageIds.delete(first);
          }
        }
        if (messageId && self.ackSystem && self.ackSystem.sendAck) {
          self.ackSystem.sendAck(normMac, messageId);
        }
        stableId = senderUUID || normMac;
        if (senderUUID) {
          var vaultMsg = {
            messageId: messageId || ('recv_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5)),
            content: content,
            _own: false,
            status: 'delivered',
            timestamp: data.timestamp || Date.now(),
            senderName: senderName
          };
          if (window.vaultAppendMessage) {
            window.vaultAppendMessage(senderUUID, vaultMsg, false);
          }
        }
        var activeUUID = self._activeChatDeviceId;
        if (activeUUID && activeUUID === senderUUID) {
          _safeDispatchEvent('nexo:ble:messageReceived', {
            deviceId: stableId, deviceUUID: senderUUID, content: content,
            senderName: senderName, messageId: messageId, source: source,
            timestamp: data.timestamp || Date.now(),
            senderNexoId: senderUUID
          });
          return;
        }
        if (senderUUID) {
          var contactsUnread = _getBLEContacts();
          var idxUnread = contactsUnread.findIndex(function(c) { return _normId(c.nexoId || c.deviceUUID) === senderUUID; });
          if (idxUnread >= 0) {
            contactsUnread[idxUnread].unreadCount = (contactsUnread[idxUnread].unreadCount || 0) + 1;
            if (content && typeof content === 'string') contactsUnread[idxUnread].lastMessage = content.substring(0, 50);
            contactsUnread[idxUnread].lastSeen = Date.now();
            _saveBLEContacts(contactsUnread);
            self.renderContactsList();
            self.renderOnlineStrip();
          }
        }
        _safeDispatchEvent('nexo:ble:messageReceived', {
          deviceId: stableId, deviceUUID: senderUUID, content: content,
          senderName: senderName, messageId: messageId, source: source,
          timestamp: data.timestamp || Date.now(),
          senderNexoId: senderUUID
        });
      } catch (e) { console.warn('[BLEInterface] Error onPayloadReceived:', e.message); }
    });
  }

// ═══════════════════════════════════════════════════════════════════════════════
// PARTE 9: ENVÍO DE MENSAJES - Native, Chat, Cola y ACK
// FIX: _sendMessageNative detecta MAC vs NXID y pasa formato correcto
// FIX: sendChatMessage timeout texto 20s
// ═══════════════════════════════════════════════════════════════════════════════

  _processPendingMessages(deviceId) {
    var self = this;
    if (!deviceId) return Promise.resolve();
    var queue = this._pendingMessageQueue.get(deviceId);
    if (!queue || queue.length === 0) return Promise.resolve();
    this._pendingMessageQueue.delete(deviceId);
    var processNext = function(idx) {
      if (idx >= queue.length) return Promise.resolve();
      var item = queue[idx];
      if (item.timeoutId) clearTimeout(item.timeoutId);
      if (self.ackSystem) {
        return self.ackSystem.sendWithRetry(deviceId, item.content, item.messageId)
          .then(function() {
            _safeDispatchEvent('nexo:ble:messageSent', { deviceUUID: item.deviceUUID, messageId: item.messageId, status: 'sent', deviceId: deviceId });
            item.resolve();
            return processNext(idx + 1);
          })
          .catch(function(e) {
            _safeDispatchEvent('nexo:ble:messageSent', { deviceUUID: item.deviceUUID, messageId: item.messageId, status: 'error', deviceId: deviceId });
            item.reject(e);
            return processNext(idx + 1);
          });
      } else {
        return self._sendMessageNative(deviceId, item.content, item.messageId)
          .then(function() {
            _safeDispatchEvent('nexo:ble:messageSent', { deviceUUID: item.deviceUUID, messageId: item.messageId, status: 'sent', deviceId: deviceId });
            item.resolve();
            return processNext(idx + 1);
          })
          .catch(function(e) {
            _safeDispatchEvent('nexo:ble:messageSent', { deviceUUID: item.deviceUUID, messageId: item.messageId, status: 'error', deviceId: deviceId });
            item.reject(e);
            return processNext(idx + 1);
          });
      }
    };
    return processNext(0);
  }
  _sendMessageNative(deviceId, content, messageId) {
    var self = this;
    return new Promise(function(resolve, reject) {
      try {
        if (!self.nativePlugin) { reject(new Error('Plugin no disponible')); return; }
        if (!deviceId) { reject(new Error('deviceId invalido')); return; }
        var targetId = deviceId;
        if (targetId.length === 17 && targetId.indexOf(':') > 0) {
          targetId = _normMac(targetId);
        } else {
          targetId = _normId(targetId).toUpperCase();
        }
        var isCtrl = _isControlPacket(content);
        var enrichedPayload;
        if (isCtrl) { enrichedPayload = content; }
        else {
          var senderId = self.localNexoId || self.localDeviceUUID;
          var msgId = messageId || ('msg' + Date.now() + '*' + Math.random().toString(36).substr(2, 9));
          var payloadObj = {
            text: content,
            senderNexoId: senderId,
            senderName: self.localDeviceName || 'Nexo Device',
            timestamp: Date.now()
          };
          if (content && content.charAt(0) === '{') {
            try {
              var parsedContent = JSON.parse(content);
              if (parsedContent && parsedContent.type === 'attachment') {
                payloadObj.attachment = parsedContent;
              }
            } catch (e) {}
          }
          enrichedPayload = JSON.stringify({
            v: 1,
            type: 'chat',
            from: senderId,
            to: '',
            ts: Date.now(),
            msgId: msgId,
            payload: payloadObj,
            jump: { ttl: 5, hops: 0, path: [] }
          });
        }
        if (_hasNativeMethod(self.nativePlugin, 'sendMessage')) {
          _safeNativeCall(self.nativePlugin, 'sendMessage', { deviceId: targetId, message: enrichedPayload })
          .then(function(result) {
            if (result && (result.sent === true || result.queued === true)) {
              resolve();
            } else {
              reject(new Error('Plugin no envio: ' + (result ? JSON.stringify(result) : 'null')));
            }
          }).catch(function(e) { reject(e); });
        } else { reject(new Error('sendMessage no disponible')); }
      } catch (e) { reject(e); }
    });
  }
  sendChatMessage(deviceUUID, content, messageId) {
    var self = this;
    return new Promise(function(resolve, reject) {
      try {
        var uuid = _normId(deviceUUID);
        if (!uuid) { reject(new Error('deviceUUID vacio')); return; }
        if (!content || typeof content !== 'string' || content.trim() === '') { reject(new Error('Mensaje vacio')); return; }
        var msgId = messageId || ('msg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5));
        var ownMsg = {
          messageId: msgId,
          content: content,
          _own: true,
          status: 'pending',
          timestamp: Date.now()
        };
        if (window.vaultAppendMessage) {
          window.vaultAppendMessage(uuid, ownMsg, true);
        }
        function doSend() {
          if (self.ackSystem) {
            self.ackSystem.sendWithRetry(uuid, content, msgId)
              .then(function() {
                _safeDispatchEvent('nexo:ble:messageSent', { deviceUUID: uuid, messageId: msgId, status: 'sent' });
                resolve();
              }).catch(function(err) {
                _safeDispatchEvent('nexo:ble:messageSent', { deviceUUID: uuid, messageId: msgId, status: 'error' });
                reject(err);
              });
          } else {
            self._sendMessageNative(uuid, content, msgId)
              .then(function() {
                _safeDispatchEvent('nexo:ble:messageSent', { deviceUUID: uuid, messageId: msgId, status: 'sent' });
                resolve();
              }).catch(function(err) {
                _safeDispatchEvent('nexo:ble:messageSent', { deviceUUID: uuid, messageId: msgId, status: 'error' });
                reject(err);
              });
          }
        }
        var state = self._getDeviceState(uuid);
        var isReady = state.state === BLE_STATES.READY_TO_CHAT || state.state === BLE_STATES.NOTIFICATIONS_READY;
        var isConnecting = state.state === BLE_STATES.CONNECTING || state.state === BLE_STATES.DISCOVERING_SERVICES;
        if (isReady) { doSend(); return; }
        var existingQueue = self._pendingMessageQueue.get(uuid) || [];
        var alreadyQueued = existingQueue.some(function(item) { return item.messageId === msgId; });
        if (alreadyQueued) { resolve(); return; }
        var timeoutId = setTimeout(function() {
          var q = self._pendingMessageQueue.get(uuid) || [];
          var idx = q.findIndex(function(item) { return item.messageId === msgId; });
          if (idx >= 0) {
            q.splice(idx, 1);
            self._pendingMessageQueue.set(uuid, q);
          }
          _safeDispatchEvent('nexo:ble:messageSent', { deviceUUID: uuid, messageId: msgId, status: 'error' });
          reject(new Error('Timeout: mensaje no enviado en 20s'));
        }, 20000);
        existingQueue.push({ content: content, messageId: msgId, resolve: resolve, reject: reject, timeoutId: timeoutId, deviceUUID: uuid });
        self._pendingMessageQueue.set(uuid, existingQueue);
        if (!isConnecting && self.nativePlugin && _hasNativeMethod(self.nativePlugin, 'connectToDevice')) {
          var lastAttempt = self._connectCooldowns.get(uuid) || 0;
          if (Date.now() - lastAttempt >= 5000) {
            self._connectCooldowns.set(uuid, Date.now());
            var targetId = uuid.toUpperCase();
            _safeNativeCall(self.nativePlugin, 'connectToDevice', { deviceId: targetId })
              .catch(function(e) {});
          }
        }
      } catch (fatal) { reject(fatal); }
    });
  }
  _waitForReadyToChat(deviceId, timeoutMs) {
    var self = this;
    return new Promise(function(resolve, reject) {
      if (!deviceId) { reject(new Error('deviceId invalido')); return; }
      var nxid = self._macToNexoId.get(_normMac(deviceId));
      if (!nxid) {
        var c = _getContactByDeviceId(deviceId);
        if (c) {
          nxid = _normId(c.nexoId || c.deviceUUID);
          self._macToNexoId.set(_normMac(deviceId), nxid);
          self._nexoIdToMac.set(nxid, _normMac(deviceId));
        }
      }
      var key = nxid || _normId(deviceId);
      var state = self._getDeviceState(key);
      if (state.state === BLE_STATES.READY_TO_CHAT || state.state === BLE_STATES.NOTIFICATIONS_READY) { resolve(); return; }
      var existing = self._readyResolvers.get(key);
      if (existing) { clearTimeout(existing.timer); }
      var timer = setTimeout(function() { self._readyResolvers.delete(key); reject(new Error('Timeout esperando READY_TO_CHAT')); }, timeoutMs || 15000);
      self._readyResolvers.set(key, { resolve: resolve, timer: timer });
    });
  }
  _resolveReadyToChat(deviceId) {
    if (!deviceId) return;
    var nxid = this._macToNexoId.get(_normMac(deviceId));
    if (!nxid) {
      var c = _getContactByDeviceId(deviceId);
      if (c) {
        nxid = _normId(c.nexoId || c.deviceUUID);
        this._macToNexoId.set(_normMac(deviceId), nxid);
        this._nexoIdToMac.set(nxid, _normMac(deviceId));
      }
    }
    var normalizedId = nxid || _normId(deviceId);
    var resolver = this._readyResolvers.get(normalizedId);
    if (resolver) { clearTimeout(resolver.timer); resolver.resolve(); this._readyResolvers.delete(normalizedId); }
    this._processPendingMessages(normalizedId);
  }

// ═══════════════════════════════════════════════════════════════════════════════
// PARTE 10: APERTURA DE CHAT Y VISIBILIDAD BLE
// ═══════════════════════════════════════════════════════════════════════════════

  openChat(deviceUUID) {
    var self = this;
    return new Promise(function(resolve, reject) {
      try {
        var uuid = _normId(deviceUUID);
        if (!uuid) { reject(new Error('ID invalido')); return; }
        var contact = _getContactByUUID(uuid);
        self._activeChatDeviceId = uuid;
        self._activeChatDeviceIdNative = contact ? contact.deviceId : null;
        self.newDevicesCount = 0; self.updateBadge();
        if (contact) {
          contact.unreadCount = 0; var contacts = _getBLEContacts();
          var idx = contacts.findIndex(function(c) { return _normId(c.nexoId || c.deviceUUID) === uuid; });
          if (idx >= 0) { contacts[idx].unreadCount = 0; _saveBLEContacts(contacts); self.renderContactsList(); self.renderOnlineStrip(); }
        }
        var appContainer = document.getElementById('app');
        if (appContainer) appContainer.classList.remove('hidden');
        var nameInput = document.getElementById('chat-contact-name');
        var subtitle = document.getElementById('chat-contact-subtitle');
        var displayName = (contact && contact.displayName) || (contact && contact.name) || 'NEXO';
        if (nameInput) nameInput.value = displayName;
        if (subtitle) subtitle.textContent = '';
        self.elements.panel.classList.remove('active');
        self.elements.overlay.classList.remove('active');
        var msgContainer = document.getElementById('messages-container');
        if (msgContainer) msgContainer.innerHTML = '';
        _safeDispatchEvent('nexo:ble:openChat', { contact: { id: uuid, name: displayName, deviceUUID: uuid, deviceId: contact ? contact.deviceId : null }, transport: 'ble', source: 'ble_interface' });
        if (window.vaultLoadMessages) {
          window.vaultLoadMessages(uuid).then(function(messages) {
            if (messages && messages.length > 0) {
              _safeDispatchEvent('nexo:vault:messagesLoaded', { contactId: uuid, messages: messages });
            }
          }).catch(function() {});
        }
        resolve();
        var state = self._getDeviceState(uuid);
        var isFullyReady = state.state === BLE_STATES.READY_TO_CHAT || state.state === BLE_STATES.NOTIFICATIONS_READY;
        var isConnecting = state.state === BLE_STATES.CONNECTING || state.state === BLE_STATES.DISCOVERING_SERVICES;
        if (!isFullyReady && self.nativePlugin && _hasNativeMethod(self.nativePlugin, 'connectToDevice')) {
          if (!isConnecting) {
            var lastAttempt = self._connectCooldowns.get(uuid) || 0;
            if (Date.now() - lastAttempt >= 5000) {
              self._connectCooldowns.set(uuid, Date.now());
              var targetId = uuid.toUpperCase();
              _safeNativeCall(self.nativePlugin, 'connectToDevice', { deviceId: targetId })
                .catch(function(e) {});
            }
          }
        }
      } catch (fatalErr) { console.error('[BLEInterface] FATAL openChat:', fatalErr); reject(fatalErr); }
    });
  }
  _initVisibility() {
    var self = this;
    if (self.isDummyMode) return Promise.resolve();
    if (_hasNativeMethod(self.nativePlugin, 'isBluetoothEnabled')) {
      return _safeNativeCall(self.nativePlugin, 'isBluetoothEnabled', {})
        .then(function(btState) {
          self.canAdvertise = (btState && btState.canAdvertise) || false;
          if (_hasNativeMethod(self.nativePlugin, 'isAdvertising')) {
            return _safeNativeCall(self.nativePlugin, 'isAdvertising', {}).then(function(adState) {
              self.isAdvertising = adState && adState.isAdvertising === true; self.updateVisibilityButton(); self._setupNativeAdvertisingListeners();
            });
          } else { self.updateVisibilityButton(); self._setupNativeAdvertisingListeners(); }
        })
        .catch(function(err) { console.error('[BLEInterface] Error consultando estado:', err); });
    }
    return Promise.resolve();
  }
  _setupNativeAdvertisingListeners() {
    if (!this.nativePlugin) return;
    if (!_hasNativeMethod(this.nativePlugin, 'addListener')) return;
    if (this._nativeAdStartedListener) { try { this._nativeAdStartedListener.remove(); } catch (e) {} }
    if (this._nativeAdFailedListener) { try { this._nativeAdFailedListener.remove(); } catch (e) {} }
    var self = this;
    this._nativeAdStartedListener = this.nativePlugin.addListener('onAdvertiseStarted', function() {
      self.isAdvertising = true;
      self.updateVisibilityButton();
    });
    this._nativeAdFailedListener = this.nativePlugin.addListener('onAdvertiseFailed', function() {
      self.isAdvertising = false;
      self.updateVisibilityButton();
    });
  }
  updateVisibilityButton() {
    var btn = this.elements.visibilityBtn;
    if (!btn) return;
    if (this.isAdvertising) btn.classList.add('active'); else btn.classList.remove('active');
  }
  updateScanButton() {
    var btn = this.elements.scanBtn;
    if (!btn) return;
    if (this.isScanning) btn.classList.add('scanning'); else btn.classList.remove('scanning');
  }
  toggleVisibility() {
    var self = this;
    if (self.isDummyMode) return Promise.resolve();
    function doToggle() {
      if (!self.nativePlugin) return Promise.resolve();
      var promise = null;
      if (self.isAdvertising) {
        if (_hasNativeMethod(self.nativePlugin, 'stopAdvertising')) {
          promise = _safeNativeCall(self.nativePlugin, 'stopAdvertising', {});
        }
      } else {
        if (_hasNativeMethod(self.nativePlugin, 'startAdvertising')) {
          promise = _safeNativeCall(self.nativePlugin, 'startAdvertising', {});
        }
      }
      if (promise && typeof promise.then === 'function') {
        return promise.then(function() {
          self.isAdvertising = !self.isAdvertising;
          self.updateVisibilityButton();
        }).catch(function(err) {
          console.error('[BLEInterface] toggleVisibility nativo error:', err);
          if (_hasNativeMethod(self.nativePlugin, 'isAdvertising')) {
            return _safeNativeCall(self.nativePlugin, 'isAdvertising', {}).then(function(adState) {
              self.isAdvertising = !!(adState && adState.isAdvertising);
              self.updateVisibilityButton();
            }).catch(function() {});
          }
        });
      }
      self.isAdvertising = !self.isAdvertising;
      self.updateVisibilityButton();
      return Promise.resolve();
    }
    if (window.ensureBLEPermissions) {
      return window.ensureBLEPermissions().then(function(result) {
        if (!result) return Promise.resolve();
        return doToggle();
      }).catch(function() {
        return doToggle();
      });
    }
    return doToggle();
  }
  _autoScanForKnownContacts() {
    var self = this;
    self._stopScanCycle();
    if (!self.nativePlugin || !_hasNativeMethod(self.nativePlugin, 'startScan')) return;
    function doCycle() {
      if (self.isScanning) return;
      var hasPendingConnection = false;
      self._deviceStates.forEach(function(v) {
        if (v.state === BLE_STATES.CONNECTING || v.state === BLE_STATES.DISCOVERING_SERVICES) hasPendingConnection = true;
      });
      if (hasPendingConnection) {
        self._scanCycleTimer = setTimeout(doCycle, self._scanCycleInterval);
        return;
      }
      self.foundDevices.clear();
      _safeNativeCall(self.nativePlugin, 'startScan', {})
        .then(function() {
          self.isScanning = true;
          self.updateScanButton();
          self._scanCycleTimer = setTimeout(function() {
            if (self.isScanning && _hasNativeMethod(self.nativePlugin, 'stopScan')) {
              _safeNativeCall(self.nativePlugin, 'stopScan', {}).then(function() {
                self.isScanning = false;
                self.updateScanButton();
              }).catch(function() { self.isScanning = false; self.updateScanButton(); });
            } else { self.isScanning = false; self.updateScanButton(); }
            self._scanCycleTimer = setTimeout(doCycle, self._scanCycleInterval);
          }, self._scanCycleDuration);
        })
        .catch(function(e) {
          self.isScanning = false;
          self.updateScanButton();
          self._scanCycleTimer = setTimeout(doCycle, self._scanCycleInterval);
        });
    }
    doCycle();
  }
  _stopScanCycle() {
    if (this._scanCycleTimer) { clearTimeout(this._scanCycleTimer); this._scanCycleTimer = null; }
    if (this.isScanning && this.nativePlugin && _hasNativeMethod(this.nativePlugin, 'stopScan')) {
      _safeNativeCall(this.nativePlugin, 'stopScan', {}).catch(function(){});
    }
    this.isScanning = false;
    this.updateScanButton();
  }

// ═══════════════════════════════════════════════════════════════════════════════
// PARTE 11: UI / DOM - Creación de interfaz
// ═══════════════════════════════════════════════════════════════════════════════

  createDOM() {
    var self = this;
    var existingPanel = document.getElementById('ble-panel');
    if (existingPanel) {
      existingPanel.remove();
      var existingOverlay = document.getElementById('ble-overlay');
      if (existingOverlay) existingOverlay.remove();
      var existingNav = document.getElementById('ble-bottom-nav');
      if (existingNav) existingNav.remove();
      var existingFab = document.getElementById('ble-fab-btn');
      if (existingFab) existingFab.remove();
    }
    var panel = document.createElement('div');
    panel.id = 'ble-panel';
    panel.innerHTML =
      '<div class="ble-header" style="position:relative;display:flex;align-items:center;justify-content:center;padding:10px 20px 14px;">' +
      '<button id="ble-panel-back" style="position:absolute;left:12px;top:50%;transform:translateY(-50%);width:38px;height:38px;border-radius:50%;background:linear-gradient(135deg,#00c8ff,#a855f7);border:none;color:#fff;cursor:pointer;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 8px rgba(0,200,255,0.3);transition:transform 0.15s ease;z-index:2;">' +
      '<svg viewBox="0 0 24 24" width="16" height="16" fill="#fff"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" transform="scale(-1,1) translate(-24,0)"/></svg>' +
      '</button>' +
      '<div style="text-align:center;">' +
      '<div class="contacts-title">Agregar contactos</div>' +
      '</div>' +
      '<button id="ble-visibility-btn" style="position:absolute;right:12px;top:50%;transform:translateY(-50%);width:38px;height:38px;border-radius:50%;background:rgba(255,255,255,0.1);border:2px solid #00c8ff;color:#00c8ff;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:16px;z-index:2;">&#x1F4E1;</button>' +
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
    var overlay = document.createElement('div');
    overlay.id = 'ble-overlay';
    document.body.appendChild(overlay);
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
    var fabBtn = document.createElement('button');
    fabBtn.id = 'ble-fab-btn';
    fabBtn.innerHTML = '<svg viewBox="0 0 24 24" width="24" height="24" fill="#fff"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/></svg>';
    fabBtn.style.cssText = 'position:fixed;bottom:80px;right:16px;width:56px;height:56px;border-radius:50%;background:linear-gradient(135deg,#00c8ff,#a855f7);border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;z-index:2147483643;box-shadow:0 4px 15px rgba(0,200,255,0.3);transition:transform 0.15s ease;';
    fabBtn.addEventListener('mousedown', function() { this.style.transform = 'scale(0.92)'; });
    fabBtn.addEventListener('mouseup', function() { this.style.transform = 'scale(1)'; });
    fabBtn.addEventListener('touchstart', function() { this.style.transform = 'scale(0.92)'; });
    fabBtn.addEventListener('touchend', function() { this.style.transform = 'scale(1)'; });
    document.body.appendChild(fabBtn);
    this.elements.panel = document.getElementById('ble-panel');
    this.elements.overlay = document.getElementById('ble-overlay');
    this.elements.bottomNav = document.getElementById('ble-bottom-nav');
    this.elements.fabBtn = document.getElementById('ble-fab-btn');
    this.elements.scanBtn = document.getElementById('ble-scan-btn');
    this.elements.contactsList = document.getElementById('ble-contacts-list');
    this.elements.onlineStrip = document.getElementById('ble-online-strip');
    this.elements.newDeviceBar = document.getElementById('ble-new-device');
    this.elements.newDeviceName = document.getElementById('ble-new-device-name');
    this.elements.addBtn = document.getElementById('ble-add-btn');
    this.elements.statusBar = document.getElementById('ble-status-bar');
    this.elements.statusText = document.getElementById('ble-status-text');
    this.elements.visibilityBtn = document.getElementById('ble-visibility-btn');
    this.elements.mainContactsList = document.getElementById('main-contacts-list');
    this.elements.mainOnlineStrip = document.getElementById('main-contacts-online-strip');
    this.elements.mainEmptyMsg = document.getElementById('main-contacts-empty-msg');
  }

// ═══════════════════════════════════════════════════════════════════════════════
// PARTE 12: EVENT LISTENERS Y TOGGLES DE UI
// ═══════════════════════════════════════════════════════════════════════════════

  setupEventListeners() {
    var self = this;
    if (self.elements.overlay) {
      self.elements.overlay.addEventListener('click', function() { self.togglePanel(); });
    }
    if (self.elements.scanBtn) {
      self.elements.scanBtn.addEventListener('click', function() { self.toggleScan(); });
    }
    if (self.elements.addBtn) {
      self.elements.addBtn.addEventListener('click', function() { self._addNewDevice(); });
    }
    var backBtn = document.getElementById('ble-panel-back');
    if (backBtn) {
      backBtn.addEventListener('click', function() {
        if (self.elements.panel) self.elements.panel.classList.remove('active');
        if (self.elements.overlay) self.elements.overlay.classList.remove('active');
      });
    }
    if (self.elements.bottomNav) {
      var navItems = self.elements.bottomNav.querySelectorAll('.ble-nav-item');
      navItems.forEach(function(item) {
        item.addEventListener('click', function() {
          navItems.forEach(function(n) { n.classList.remove('active'); });
          item.classList.add('active');
          var tab = item.dataset.tab;
          if (tab === 'people') self.togglePanel();
          else if (tab === 'chats') {
            if (self.elements.panel) self.elements.panel.classList.remove('active');
            if (self.elements.overlay) self.elements.overlay.classList.remove('active');
          }
        });
      });
    }
    window.addEventListener('nexo:ble:closeChat', function() {
      self._activeChatDeviceId = null; self._activeChatDeviceIdNative = null;
      self.updateBadge();
      if (self.elements.fabBtn) self.elements.fabBtn.style.display = 'flex';
      if (self.elements.bottomNav) self.elements.bottomNav.style.display = 'flex';
      if (self.elements.panel) self.elements.panel.classList.remove('active');
      if (self.elements.overlay) self.elements.overlay.classList.remove('active');
      self.renderContactsList(); self.renderOnlineStrip();
    });
    window.addEventListener('nexo:ble:openChat', function() {
      if (self.elements.fabBtn) self.elements.fabBtn.style.display = 'none';
      if (self.elements.bottomNav) self.elements.bottomNav.style.display = 'none';
    });
  }
  togglePanel() {
    if (!this.elements.panel || !this.elements.overlay) return;
    this.elements.panel.classList.toggle('active');
    this.elements.overlay.classList.toggle('active');
    if (this.elements.panel.classList.contains('active')) {
      this.newDevicesCount = 0; this.updateBadge(); this.renderContactsList(); this.renderOnlineStrip();
      var self = this;
      setTimeout(function() {
        if (!self.isDummyMode && self.nativePlugin && !self.isScanning) {
          self._autoScanForKnownContacts();
        }
      }, 300);
    }
  }
  _executeToggleScan() {
    var self = this;
    if (self.isScanning) {
      if (_hasNativeMethod(self.nativePlugin, 'stopScan')) {
        return _safeNativeCall(self.nativePlugin, 'stopScan', {})
          .then(function() { self.isScanning = false; self.updateScanButton(); self.updateStatus(); })
          .catch(function(e) { self.isScanning = false; self.updateScanButton(); self.updateStatus(); });
      }
      self.isScanning = false; self.updateScanButton(); self.updateStatus();
      return Promise.resolve();
    } else {
      self.foundDevices.clear(); self.renderContactsList(); self.renderNewDeviceBar(); self.renderOnlineStrip();
      if (_hasNativeMethod(self.nativePlugin, 'startScan')) {
        return _safeNativeCall(self.nativePlugin, 'startScan', {})
          .then(function() { self.isScanning = true; self.updateScanButton(); })
          .catch(function(e) { self.isScanning = false; self.updateScanButton(); });
      }
      return Promise.resolve();
    }
  }
  _doToggleScan() {
    var self = this;
    var permsReady = false;
    if (window.ensureBLEPermissions) {
      return window.ensureBLEPermissions()
        .then(function(result) { permsReady = result; })
        .catch(function() { permsReady = true; })
        .then(function() {
          if (!permsReady) return Promise.resolve();
          return self._executeToggleScan();
        })
        .catch(function(err) { self.isScanning = false; self.updateScanButton(); });
    } else { permsReady = true; }
    if (!permsReady) return Promise.resolve();
    return self._executeToggleScan().catch(function(err) {
      self.isScanning = false; self.updateScanButton();
    });
  }
  toggleScan() {
    var self = this;
    if (self.isDummyMode) return Promise.resolve();
    if (self.nativePlugin && _hasNativeMethod(self.nativePlugin, 'isBluetoothEnabled')) {
      return _safeNativeCall(self.nativePlugin, 'isBluetoothEnabled', {})
        .then(function(btState) {
          if (!btState || !btState.enabled) {
            _showToast('Bluetooth apagado. Activalo para buscar contactos.', 'warn');
            self.updateStatusBar('BLE OFF - Activa Bluetooth');
            return Promise.resolve();
          }
          return self._doToggleScan();
        })
        .catch(function() { return self._doToggleScan(); })
        .catch(function(err) { self.isScanning = false; self.updateScanButton(); });
    }
    return self._doToggleScan().catch(function(err) {
      self.isScanning = false; self.updateScanButton();
    });
  }

// ═══════════════════════════════════════════════════════════════════════════════
// PARTE 13: DISCOVERY Y GESTIÓN DE DISPOSITIVOS
// FIX: onDeviceFound guarda MAC normalizada en contacto
// FIX: Solo una conexión a la vez
// ═══════════════════════════════════════════════════════════════════════════════

  onDeviceFound(device) {
    var self = this;
    var deviceId = device.id || '';
    if (!deviceId) return;
    var nexoId = device.nexoId || '';
    if (!nexoId || nexoId.length !== 10 || nexoId.indexOf('NX') !== 0) {
      return;
    }
    nexoId = _normId(nexoId);
    var normMac = _normMac(deviceId);
    var isContact = _isBLEContact(nexoId);
    if (isContact) {
      var contacts = _getBLEContacts();
      var idx = contacts.findIndex(function(c) { return _normId(c.nexoId || c.deviceUUID) === _normId(nexoId); });
      if (idx >= 0) {
        contacts[idx].online = true;
        contacts[idx].lastSeen = Date.now();
        contacts[idx].deviceId = normMac;
        _saveBLEContacts(contacts);
      }
      self._macToNexoId.set(normMac, nexoId);
      self._nexoIdToMac.set(nexoId, normMac);
      this.renderContactsList();
      this.renderOnlineStrip();
      console.log('[BLEInterface] Contacto conocido en scan:', nexoId, '- online=true, sin auto-connect');
      return;
    }
    if (!this.foundDevices.has(normMac)) {
      device.lastSeen = Date.now();
      device.deviceUUID = nexoId;
      this.foundDevices.set(normMac, device);
      this.newDevicesCount++;
      this.updateBadge();
      this.renderNewDeviceBar();
    } else {
      var existing = this.foundDevices.get(normMac);
      existing.rssi = device.rssi;
      existing.lastSeen = Date.now();
      existing.deviceUUID = nexoId;
      this.foundDevices.set(normMac, existing);
      this.renderNewDeviceBar();
    }
  }
  _addNewDevice(deviceId) {
    var self = this;
    if (!deviceId) {
      var bar = this.elements.newDeviceBar;
      if (bar && bar.dataset) deviceId = bar.dataset.deviceId || '';
    }
    var device = this.foundDevices.get(_normMac(deviceId));
    if (!device) return;
    var name = device.name || device.deviceUUID || 'Nexo Device';
    var nexoId = device.deviceUUID || '';
    if (!nexoId || nexoId.length !== 10 || nexoId.indexOf('NX') !== 0) {
      console.warn('[BLEInterface] No se puede agregar: dispositivo sin NEXO ID');
      return;
    }
    _addBLEContact({ deviceUUID: nexoId, name: name, deviceId: device.id });
    if (window.vaultGetOrCreateContact) {
      window.vaultGetOrCreateContact(nexoId, name, _normMac(device.id));
    }
    this._autoConnectGATT(nexoId, device);
    this.foundDevices.delete(_normMac(deviceId));
    this._closePanelAndRefresh();
  }
  _closePanelAndRefresh() {
    if (this.elements.panel) this.elements.panel.classList.remove('active');
    if (this.elements.overlay) this.elements.overlay.classList.remove('active');
    this.renderContactsList();
    this.renderOnlineStrip();
    this.renderNewDeviceBar();
  }
  _autoConnectGATT(nexoId, device) {
    var self = this;
    if (!self.nativePlugin || !_hasNativeMethod(self.nativePlugin, 'connectToDevice')) return Promise.resolve();
    if (!nexoId) return Promise.resolve();
    var normNexo = _normId(nexoId);
    var state = self._getDeviceState(normNexo);
    if (state.state === BLE_STATES.READY_TO_CHAT || state.state === BLE_STATES.NOTIFICATIONS_READY || state.state === BLE_STATES.CONNECTING) return Promise.resolve();
    var lastAttempt = self._connectCooldowns.get(normNexo) || 0;
    if (Date.now() - lastAttempt < 5000) return Promise.resolve();
    self._connectCooldowns.set(normNexo, Date.now());
    if (self.isScanning) self._stopScanCycle();
    self._setDeviceState(normNexo, BLE_STATES.CONNECTING, { direction: 'outgoing', role: 'client', auto: true });
    self.connectedDevices.set(_normMac(device.id || normNexo), { id: device.id || normNexo, name: (device && device.name) || '', direction: 'outgoing', servicesReady: false, deviceUUID: normNexo });
    var targetId = normNexo.toUpperCase();
    return _safeNativeCall(self.nativePlugin, 'connectToDevice', { deviceId: targetId })
      .then(function(result) {
        if (result && (result.connected || result.alreadyConnected)) {
          return self._waitForReadyToChat(normNexo, 15000).then(function() {});
        } else {
          self.connectedDevices.delete(_normMac(device.id || normNexo));
          self._deviceStates.delete(normNexo);
          self._setDeviceState(normNexo, BLE_STATES.DISCONNECTED);
          return Promise.resolve();
        }
      })
      .catch(function(e) {
        self.connectedDevices.delete(_normMac(device.id || normNexo));
        self._deviceStates.delete(normNexo);
        self._setDeviceState(normNexo, BLE_STATES.DISCONNECTED);
        return Promise.reject(e);
      });
  }
  removeContact(deviceUUID) {
    try {
      _removeBLEContact(deviceUUID);
      this.renderContactsList();
      this.renderNewDeviceBar();
      this.renderOnlineStrip();
    } catch (e) {
      console.warn('[BLEInterface] removeContact error:', e);
    }
  }
  disconnect(deviceId) {
    var self = this;
    if (self.isDummyMode) return Promise.resolve();
    if (!deviceId) return Promise.resolve();
    var normMac = _normMac(deviceId);
    self.connectedDevices.delete(normMac);
    self._setDeviceState(deviceId, BLE_STATES.DISCONNECTED);
    if (_hasNativeMethod(self.nativePlugin, 'disconnectDevice')) {
      return _safeNativeCall(self.nativePlugin, 'disconnectDevice', { deviceId: deviceId })
        .then(function() {
          if (self._activeChatDeviceId) {
            self._activeChatDeviceId = null; self._activeChatDeviceIdNative = null;
            self.updateBadge();
          }
        }).catch(function(err) {
          console.warn('[BLEInterface] disconnect nativo error:', err);
        });
    }
    return Promise.resolve();
  }

// ═══════════════════════════════════════════════════════════════════════════════
// PARTE 14: RENDERIZADO DE CONTACTOS, MENÚS Y BADGE
// FIX: Deduplicación copia deviceId normalizado del contacto más reciente
// ═══════════════════════════════════════════════════════════════════════════════

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
      var initials = _getInitials(contact.displayName || contact.name);
      var gradClass = _getGradientForUUID(uuid);
      item.innerHTML = '<div class="ble-online-avatar ' + gradClass + '">' + initials + '<div class="ble-online-dot"></div></div><span class="ble-online-name">' + (contact.displayName || contact.name || '') + '</span>';
      item.addEventListener('click', function() { self.openChat(uuid); });
      strip.appendChild(item);
    });
  }
  renderContactsList() {
    var self = this;
    var list = this.elements.mainContactsList;
    if (!list) return;
    list.innerHTML = '';
    var contacts = _getBLEContacts();
    var seenNexoIds = {};
    var deduped = [];
    contacts.forEach(function(c) {
      var nid = _normId(c.nexoId || c.deviceUUID);
      if (!nid) return;
      if (!seenNexoIds[nid]) {
        seenNexoIds[nid] = true;
        deduped.push(c);
      } else {
        var existing = deduped.find(function(d) { return _normId(d.nexoId || d.deviceUUID) === nid; });
        if (existing && (c.lastSeen || 0) > (existing.lastSeen || 0)) {
          existing.displayName = c.displayName || existing.displayName || existing.name;
          existing.name = c.name || existing.name;
          existing.lastSeen = c.lastSeen;
          existing.online = c.online;
          existing.lastMessage = c.lastMessage || existing.lastMessage;
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
      return (b.lastSeen || 0) - (a.lastSeen || 0);
    });
    contacts.forEach(function(contact, index) {
      var uuid = _normId(contact.nexoId || contact.deviceUUID);
      var isOnline = contact.online && (Date.now() - (contact.lastSeen || 0)) < 60000;
      var initials = _getInitials(contact.displayName || contact.name);
      var gradClass = _getGradientForUUID(uuid);
      var lastMsg = contact.lastMessage || (isOnline ? 'En linea' : 'Offline');
      var timeStr = _formatTime(contact.lastSeen);
      var unread = contact.unreadCount || 0;
      var row = document.createElement('div');
      row.className = 'ble-contact-row';
      row.addEventListener('click', function(e) { if (e.target.closest('.ble-contact-menu') || e.target.closest('.ble-btn-menu')) return; self.openChat(uuid); });
      var avatar = document.createElement('div');
      avatar.className = 'ble-contact-avatar ' + gradClass;
      avatar.textContent = initials;
      row.appendChild(avatar);
      var info = document.createElement('div');
      info.className = 'ble-contact-info';
      info.innerHTML = '<div class="ble-contact-name">' + (contact.displayName || contact.name || '') + '</div><div class="ble-contact-msg">' + lastMsg + '</div>';
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
      menuBtn.addEventListener('click', function(e) { e.stopPropagation(); self._toggleContactMenu(uuid, menuBtn); });
      row.appendChild(menuBtn);
      list.appendChild(row);
      if (index < contacts.length - 1) { var divider = document.createElement('div'); divider.className = 'ble-divider'; list.appendChild(divider); }
    });
    this.renderOnlineStrip();
  }
  _toggleContactMenu(uuid, btn) {
    var self = this;
    if (!uuid || !btn) return;
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
    var closeMenu = function(e) {
      if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener('click', closeMenu); }
    };
    menu.addEventListener('click', function(e) {
      var target = e.target.closest ? e.target.closest('[data-action]') : e.target;
      var action = target ? target.dataset.action : null;
      if (action === 'pin') { _togglePinnedContact(uuid); self.renderContactsList(); }
      else if (action === 'delete') { self.removeContact(uuid); }
      else if (action === 'profile') { _safeDispatchEvent('nexo:ble:goToProfile', { deviceUUID: uuid }); }
      menu.remove();
      document.removeEventListener('click', closeMenu);
    });
    setTimeout(function() {
      document.addEventListener('click', closeMenu);
    }, 10);
  }
  renderNewDeviceBar() {
    var bar = this.elements.newDeviceBar;
    if (!bar) return;
    var self = this;
    var newDevices = [];
    this.foundDevices.forEach(function(device, deviceId) {
      var uuid = device.deviceUUID;
      if (uuid && !_isBLEContact(uuid)) {
        newDevices.push({ deviceId: deviceId, device: device });
      }
    });
    if (newDevices.length === 0) {
      bar.style.display = 'none';
      bar.innerHTML = '';
      return;
    }
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
  updateBadge() {
    var fabBtn = this.elements.fabBtn;
    if (!fabBtn) return;
    if (this._activeChatDeviceId) { fabBtn.style.display = 'none'; return; }
    fabBtn.style.display = 'flex';
    if (this.newDevicesCount > 0) { fabBtn.innerHTML = '<span style="color:#fff;font-size:14px;font-weight:700;">' + this.newDevicesCount + '</span>'; }
    else { fabBtn.innerHTML = '<svg viewBox="0 0 24 24" width="24" height="24" fill="#fff"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/></svg>'; }
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
          if (state && state.enabled) { var connCount = self.connectedDevices ? self.connectedDevices.size : 0; self.updateStatusBar('BLE ON | ' + connCount + ' conectados'); }
          else { self.updateStatusBar('BLE OFF'); }
        }).catch(function(err) { self.updateStatusBar(''); });
    }
    self.updateStatusBar('');
    return Promise.resolve();
  }

// ═══════════════════════════════════════════════════════════════════════════════
// PARTE 15: GETTERS Y EXPORT
// ═══════════════════════════════════════════════════════════════════════════════

  getContacts() {
    return _getBLEContacts();
  }
  getContactByUUID(deviceUUID) {
    return _getContactByUUID(deviceUUID);
  }
}

export function initBLEInterface(bleMesh) {
  try {
    var instance = new BLEInterface(bleMesh).init();
    if (typeof window !== 'undefined') window.bleInterface = instance;
    return instance;
  } catch (e) {
    console.error('[BLEInterface] initBLEInterface fatal:', e);
    return null;
  }
}
