/**
 * BLE Interface v5.3.1-RECONNECTFIX
 * FIX: Cola pending usa NXID como clave estable (no MAC efímera)
 * FIX: _processPendingMessages resuelve MAC→NXID para encontrar cola
 * FIX: _resendPendingMessages verifica READY antes de reenviar
 * FIX: _resolveReadyToChat dispara reenvío de vault pending al ponerse READY
 * FASE4: Hooks vault contactos + mensajes, autoscan conectar/desconectar.
 * SUPERVISOR v1.0: Connection health monitoring + ping/pong + auto-reconnect.
 */
var BLE_NEXO_ID_VAULT_FILE = 'nexo_advertising_id.json';
var BLE_PINNED_VAULT_FILE = 'nexo_ble_pinned.json';
var BLE_UUID_VAULT_FILE = 'nexo_device_uuid.json';
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
  var existingIdx = contacts.findIndex(function(c) { return _normId(c.nexoId || c.deviceUUID) === uuid; });
  if (existingIdx >= 0) {
    contacts[existingIdx].name = contact.name || contacts[existingIdx].name || '';
    contacts[existingIdx].lastSeen = Date.now();
    contacts[existingIdx].online = true;
    if (contact.deviceId) contacts[existingIdx].deviceId = contact.deviceId;
    _saveBLEContacts(contacts);
    return true;
  }
  contacts.push({
    nexoId: uuid,
    deviceUUID: uuid,
    name: contact.name || '',
    deviceId: contact.deviceId || null,
    addedAt: Date.now(),
    lastSeen: Date.now(),
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
  return _getBLEContacts().some(function(c) { return _normId(c.nexoId || c.deviceUUID) === _normId(deviceUUID); });
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
              if (data.pinned && Array.isArray(data.pinned)) {
                _blePinnedCache = data.pinned;
              }
            } catch (e) {}
          }
          resolve();
        }).catch(function() { resolve(); });
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
  if (!content || typeof content !== 'string') return false;
  if (content.indexOf('"type":"ack"') !== -1) return true;
  if (content.indexOf('"type":"read_receipt"') !== -1) return true;
  if (content.indexOf('"type":"ping"') !== -1) return true;
  if (content.indexOf('"type":"pong"') !== -1) return true;
  return false;
}

// === HELPERS VAULT (delegan a vault_manager.js, sin fallback localStorage) ===
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
function _vaultLoadMessages(nexoId) {
  try {
    if (window.vaultLoadMessages && typeof window.vaultLoadMessages === 'function') {
      return window.vaultLoadMessages(nexoId);
    }
  } catch (e) {}
  return Promise.resolve([]);
}

// === HELPERS AUTOSCAN (fallback seguro) ===
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
    // === SUPERVISOR v1.0 ===
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
    console.log('[BLEInterface] v5.3.1-RECONNECTFIX iniciado');
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
    var contacts = _getBLEContacts();
    if (contacts && contacts.length > 0) {
      contacts.forEach(function(c) {
        if (c.deviceId && (c.nexoId || c.deviceUUID)) {
          var nd = _normMac(c.deviceId);
          var nx = _normId(c.nexoId || c.deviceUUID);
          if (nd && nx) {
            self._nexoIdToMac.set(nx, nd);
            self._macToNexoId.set(nd, nx);
          }
        }
      });
    }
    _loadPinnedFromVault().then(function() {
      self._continueInit();
    }).catch(function() {
      self._continueInit();
    });
  }
  _continueInit() {
    var self = this;
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
    _loadDeviceUUID().then(function(uuid) {
      self.localDeviceUUID = uuid;
    }).catch(function() {
      self.localDeviceUUID = _generateUUID();
    });
    this._cleanupStaleStates();
    this._startConnectionSupervisor();
    this._setupAppStateListener();
    this.elements.panel.classList.remove('active');
    this.elements.overlay.classList.remove('active');
    this.renderContactsList();
    this.renderOnlineStrip();
    setTimeout(function() {
      if (!self.isDummyMode && self.nativePlugin) {
        self._autoScanForKnownContacts();
      }
    }, 500);
  }
  // === FIX 2: Cleanup stale states ===
  _cleanupStaleStates() {
    var self = this;
    var now = Date.now();
    var keysToDelete = [];
    self._deviceStates.forEach(function(state, deviceId) {
      if (now - (state.timestamp || 0) > 10000) {
        keysToDelete.push(deviceId);
      }
    });
    keysToDelete.forEach(function(deviceId) {
      self._deviceStates.delete(deviceId);
      self.connectedDevices.delete(deviceId);
      self._supervisorStates.delete(deviceId);
      self._lastPongTime.delete(deviceId);
      self._pingFailCount.delete(deviceId);
    });
    if (keysToDelete.length > 0) {
      console.log('[BLEInterface] Cleanup stale states:', keysToDelete.length, 'devices purgados');
    }
  }
  // === SUPERVISOR v1.0 ===
  _startConnectionSupervisor() {
    var self = this;
    if (self._supervisorTimer) {
      clearInterval(self._supervisorTimer);
      self._supervisorTimer = null;
    }
    self._supervisorTimer = setInterval(function() {
      self._runSupervisorCycle();
    }, self._supervisorIntervalMs);
    console.log('[BLEInterface] Connection Supervisor iniciado');
  }
  _stopConnectionSupervisor() {
    if (this._supervisorTimer) {
      clearInterval(this._supervisorTimer);
      this._supervisorTimer = null;
    }
    this._pendingPings.forEach(function(p) { clearTimeout(p.timer); });
    this._pendingPings.clear();
    this._backoffTimers.forEach(function(t) { clearTimeout(t); });
    this._backoffTimers.clear();
  }
  _runSupervisorCycle() {
    var self = this;
    if (!self._activeChatDeviceId && self.connectedDevices.size === 0) return;
    self.connectedDevices.forEach(function(device, deviceId) {
      var state = self._getDeviceState(deviceId);
      if (state.state !== BLE_STATES.READY_TO_CHAT && state.state !== BLE_STATES.NOTIFICATIONS_READY) return;
      var lastPong = self._lastPongTime.get(deviceId) || 0;
      var timeSincePong = Date.now() - lastPong;
      if (lastPong === 0 || timeSincePong > 16000) {
        self._pingDevice(deviceId).then(function(result) {
          self._pingFailCount.set(deviceId, 0);
          self._supervisorStates.set(deviceId, { state: SUPERVISOR_STATES.HEALTHY, since: Date.now(), rtt: result.rtt });
        }).catch(function(err) {
          var fails = (self._pingFailCount.get(deviceId) || 0) + 1;
          self._pingFailCount.set(deviceId, fails);
          console.warn('[BLEInterface] Ping fallo #' + fails + ' para', deviceId, ':', err.message);
          if (fails >= self._pingMaxFails) {
            console.error('[BLEInterface] Conexion ZOMBIE detectada para', deviceId, '— forzando disconnect + reconnect');
            self._supervisorStates.set(deviceId, { state: SUPERVISOR_STATES.ZOMBIE, since: Date.now() });
            self._forceDisconnectAndReconnect(deviceId);
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
      if (state.state !== BLE_STATES.READY_TO_CHAT && state.state !== BLE_STATES.NOTIFICATIONS_READY) {
        reject(new Error('Device not ready for ping'));
        return;
      }
      var pingId = 'ping_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4);
      var payload = JSON.stringify({
        v: 1,
        type: 'ping',
        pingId: pingId,
        ts: Date.now(),
        fromNexoId: self.localNexoId || self.localDeviceUUID
      });
      var timer = setTimeout(function() {
        var p = self._pendingPings.get(pingId);
        if (p) {
          self._pendingPings.delete(pingId);
          reject(new Error('Ping timeout (' + self._pingTimeoutMs + 'ms)'));
        }
      }, self._pingTimeoutMs);
      self._pendingPings.set(pingId, {
        resolve: resolve,
        reject: reject,
        timer: timer,
        ts: Date.now()
      });
      self._sendMessageNative(deviceId, payload, pingId).catch(function(e) {
        var p = self._pendingPings.get(pingId);
        if (p) {
          clearTimeout(p.timer);
          self._pendingPings.delete(pingId);
          reject(e);
        }
      });
    });
  }
  _forceDisconnectAndReconnect(deviceId) {
    var self = this;
    console.log('[BLEInterface] _forceDisconnectAndReconnect para', deviceId);
    self._setDeviceState(deviceId, BLE_STATES.DISCONNECTED);
    self.connectedDevices.delete(deviceId);
    self._supervisorStates.set(deviceId, { state: SUPERVISOR_STATES.RECONNECTING, since: Date.now() });
    var oldTimer = self._backoffTimers.get(deviceId);
    if (oldTimer) { clearTimeout(oldTimer); self._backoffTimers.delete(deviceId); }
    if (self.nativePlugin && _hasNativeMethod(self.nativePlugin, 'disconnectDevice')) {
      _safeNativeCall(self.nativePlugin, 'disconnectDevice', { deviceId: deviceId })
        .catch(function(e) { console.warn('[BLEInterface] disconnectDevice fallo:', e.message); })
        .finally(function() {
          setTimeout(function() { self._attemptAutoReconnect(deviceId); }, 500);
        });
    } else {
      setTimeout(function() { self._attemptAutoReconnect(deviceId); }, 500);
    }
    var nx = self._macToNexoId.get(_normMac(deviceId));
    _safeDispatchEvent('nexo:ble:deviceDisconnected', {
      deviceId: deviceId,
      deviceUUID: nx,
      reason: 'supervisor_zombie_detected'
    });
  }
  _attemptAutoReconnect(deviceId) {
    var self = this;
    var nx = self._macToNexoId.get(_normMac(deviceId));
    console.log('[BLEInterface] _attemptAutoReconnect para', deviceId, 'NXID=', nx);
    self._autoScanForKnownContacts();
    if (nx) {
      var contact = _getContactByUUID(nx);
      if (contact && contact.deviceId) {
        setTimeout(function() {
          self._autoConnectGATT(contact.deviceId, { name: contact.name, deviceUUID: nx });
        }, 800);
      }
    }
    var attempt = self._reconnectAttempts.get(deviceId) || 0;
    var delay = Math.min(2000 * Math.pow(2, attempt), 30000);
    self._reconnectAttempts.set(deviceId, attempt + 1);
    var timer = setTimeout(function() {
      self._reconnectAttempts.delete(deviceId);
      var currentState = self._getDeviceState(deviceId);
      if (currentState.state === BLE_STATES.DISCONNECTED || currentState.state === BLE_STATES.ERROR) {
        self._attemptAutoReconnect(deviceId);
      }
    }, delay);
    self._backoffTimers.set(deviceId, timer);
  }
  _resolveDeviceIdForNexoId(nexoId) {
    var nx = _normId(nexoId);
    var mappedMac = this._nexoIdToMac.get(nx);
    if (mappedMac) return mappedMac;
    var contact = _getContactByUUID(nx);
    if (contact && contact.deviceId) return _normMac(contact.deviceId);
    var found = null;
    this.connectedDevices.forEach(function(d) { if (!found && _normId(d.deviceUUID) === nx) found = d.id; });
    this.foundDevices.forEach(function(d) { if (!found && _normId(d.deviceUUID) === nx) found = d.id; });
    return found;
  }
  // === FIN SUPERVISOR ===
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
              self._cleanupStaleStates();
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
        var nd = _normMac(deviceId);
        var nx = _normId(nexoId);
        if (nd && nx) {
          self._nexoIdToMac.set(nx, nd);
          self._macToNexoId.set(nd, nx);
        }
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
        self.connectedDevices.set(deviceId, {
          id: deviceId, name: displayName,
          direction: data.direction || 'outgoing', role: data.role || 'client',
          servicesReady: data.servicesReady || false, deviceUUID: peerUUID
        });
        self._setDeviceState(deviceId, data.role === 'server' ? BLE_STATES.READY_TO_CHAT : BLE_STATES.CONNECTING, {
          direction: data.direction, role: data.role, deviceUUID: peerUUID
        });
        if (peerUUID && nd) {
          var nx = _normId(peerUUID);
          self._nexoIdToMac.set(nx, nd);
          self._macToNexoId.set(nd, nx);
        }
        if (peerUUID) {
          var contacts = _getBLEContacts();
          var idx = contacts.findIndex(function(c) { return _normId(c.nexoId || c.deviceUUID) === _normId(peerUUID); });
          if (idx >= 0) {
            contacts[idx].online = true; contacts[idx].lastSeen = Date.now(); contacts[idx].deviceId = deviceId;
            _saveBLEContacts(contacts); self.renderContactsList(); self.renderOnlineStrip();
          }
          _autoScanUnregister(peerUUID);
        }
        self._pingFailCount.set(deviceId, 0);
        self._supervisorStates.set(deviceId, { state: SUPERVISOR_STATES.HEALTHY, since: Date.now() });
        _safeDispatchEvent('nexo:ble:deviceConnected', { deviceId: deviceId, deviceUUID: peerUUID, name: displayName });
      } catch (e) {}
    });
    this._nativeDeviceDisconnectedListener = this.nativePlugin.addListener('onDeviceDisconnected', function(data) {
      try {
        var deviceId = data.deviceId || '';
        if (!deviceId) return;
        var peerUUID = null;
        var contact = _getContactByDeviceId(deviceId);
        if (contact) peerUUID = contact.nexoId || contact.deviceUUID;
        self.connectedDevices.delete(deviceId);
        self._setDeviceState(deviceId, BLE_STATES.DISCONNECTED);
        self._supervisorStates.set(deviceId, { state: SUPERVISOR_STATES.OFFLINE, since: Date.now() });
        self._lastPongTime.delete(deviceId);
        self._pingFailCount.delete(deviceId);
        if (peerUUID) {
          var contacts = _getBLEContacts();
          var idx = contacts.findIndex(function(c) { return _normId(c.nexoId || c.deviceUUID) === _normId(peerUUID); });
          if (idx >= 0) { contacts[idx].online = false; _saveBLEContacts(contacts); self.renderContactsList(); self.renderOnlineStrip(); }
          _autoScanRegister(peerUUID);
          _autoScanStart();
        }
        _safeDispatchEvent('nexo:ble:deviceDisconnected', { deviceId: deviceId, deviceUUID: peerUUID });
        if (self.isAdvertising && self.nativePlugin && _hasNativeMethod(self.nativePlugin, 'startAdvertising')) {
          _safeNativeCall(self.nativePlugin, 'startAdvertising', {}).catch(function(e) {});
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
        if (nxFlush) {
          setTimeout(function() { self._resendPendingMessages(nxFlush); }, 300);
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
    this._deviceStates.set(deviceId, stateObj);
  }
  _getDeviceState(deviceId) {
    if (!deviceId) return { state: BLE_STATES.DISCONNECTED };
    return this._deviceStates.get(deviceId) || { state: BLE_STATES.DISCONNECTED };
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
        var source = data.source || 'unknown';
        if (source !== 'gatt_server' && source !== 'gatt_client' && source !== 'broadcast') source = 'gatt_client';
        var messageId = null, senderName = null, senderUUID = null;
        var content = data.content || data.data || data.message || '';
        var stableId = null;
        if (self.ackSystem) {
          var fragmentHandled = self.ackSystem.processIncomingFragment({ deviceId: deviceId, content: content });
          if (fragmentHandled) return;
        }
        var isControl = _isControlPacket(content);
        if (isControl && self.ackSystem) {
          self.ackSystem.processIncomingAck(content);
        }
        // === PING/PONG ===
        var ctrl = null;
        try {
          if (content && content.charAt(0) === '{') ctrl = JSON.parse(content);
        } catch (e) { ctrl = null; }
        if (ctrl && ctrl.type === 'ping') {
          var pongPayload = JSON.stringify({
            v: 1, type: 'pong', pingId: ctrl.pingId,
            ts: Date.now(),
            fromNexoId: self.localNexoId || self.localDeviceUUID
          });
          self._sendMessageNative(deviceId, pongPayload, 'pong_' + ctrl.pingId).catch(function(e) {});
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
        // === FIN PING/PONG ===
        if (content.charAt(0) === '{' || (data.data && data.data.charAt(0) === '{')) {
          try {
            var json = JSON.parse(data.data || content || '{}');
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
            if (!messageId && json.payload && json.payload.messageId) messageId = json.payload.messageId;
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
            if (idx2 >= 0) { contacts2[idx2].online = true; contacts2[idx2].lastSeen = Date.now(); contacts2[idx2].deviceId = deviceId; if (content && !isControl) contacts2[idx2].lastMessage = content.substring(0, 50); _saveBLEContacts(contacts2); self.renderContactsList(); self.renderOnlineStrip(); }
          }
          _vaultGetOrCreateContact(senderUUID, senderName, self.connectedDevices.get(deviceId) && self.connectedDevices.get(deviceId).name);
        }
        if (messageId && self._receivedMessageIds.has(messageId)) {
          if (!isControl && self.ackSystem) {
            self.ackSystem.sendAck(deviceId, messageId);
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
        if (!isControl && messageId && self.ackSystem) {
          self.ackSystem.sendAck(deviceId, messageId);
        }
        stableId = senderUUID || deviceId;
        if (!isControl && senderUUID) {
          var vaultMsg = {
            messageId: messageId || ('recv_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5)),
            content: content,
            _own: false,
            status: 'delivered',
            timestamp: data.timestamp || Date.now(),
            senderName: senderName
          };
          _vaultAppendMessage(senderUUID, vaultMsg, false);
        }
        var activeUUID = self._activeChatDeviceId;
        if (activeUUID && activeUUID === senderUUID) {
          _safeDispatchEvent('nexo:ble:messageReceived', {
            deviceId: stableId, deviceUUID: senderUUID, content: content,
            senderName: senderName, messageId: messageId, source: source,
            timestamp: data.timestamp || Date.now()
          });
          return;
        }
        if (senderUUID && !isControl) {
          var contacts3 = _getBLEContacts();
          var idx3 = contacts3.findIndex(function(c) { return _normId(c.nexoId || c.deviceUUID) === _normId(senderUUID); });
          if (idx3 >= 0) { contacts3[idx3].unreadCount = (contacts3[idx3].unreadCount || 0) + 1; contacts3[idx3].lastMessage = content.substring(0, 50); contacts3[idx3].lastSeen = Date.now(); _saveBLEContacts(contacts3); self.renderContactsList(); self.renderOnlineStrip(); }
        }
        self.newDevicesCount++; self.updateBadge();
        _safeDispatchEvent('nexo:ble:messageReceived', {
          deviceId: stableId, deviceUUID: senderUUID, content: content,
          senderName: senderName, messageId: messageId, source: source,
          timestamp: data.timestamp || Date.now()
        });
      } catch (e) { console.warn('[BLEInterface] Error onPayloadReceived:', e.message); }
    });
  }
  _processPendingMessages(deviceId) {
    var self = this;
    if (!deviceId) return Promise.resolve();
    var macNorm = _normMac(deviceId);
    var nxidNorm = self._macToNexoId.get(macNorm);
    // FIX: buscar cola por NXID primero (diseño actual), luego fallback por MAC (compatibilidad)
    var queue = null;
    if (nxidNorm) queue = self._pendingMessageQueue.get(nxidNorm);
    if (!queue) queue = self._pendingMessageQueue.get(macNorm);
    if (!queue) queue = self._pendingMessageQueue.get(deviceId);
    if (!queue || queue.length === 0) return Promise.resolve();
    // FIX: limpiar todas las claves posibles para evitar huérfanos
    if (nxidNorm) self._pendingMessageQueue.delete(nxidNorm);
    self._pendingMessageQueue.delete(macNorm);
    self._pendingMessageQueue.delete(deviceId);
    var processNext = function(idx) {
      if (idx >= queue.length) return Promise.resolve();
      var item = queue[idx];
      if (self.ackSystem) {
        return self.ackSystem.sendWithRetry(deviceId, item.content, item.messageId)
          .then(function() { item.resolve(); return processNext(idx + 1); })
          .catch(function(e) { item.reject(e); return processNext(idx + 1); });
      } else {
        return self._sendMessageNative(deviceId, item.content, item.messageId)
          .then(function() { item.resolve(); return processNext(idx + 1); })
          .catch(function(e) { item.reject(e); return processNext(idx + 1); });
      }
    };
    return processNext(0);
  }
  _sendMessageNative(deviceId, content, messageId) {
    var self = this;
    return new Promise(function(resolve, reject) {
      try {
        if (!self.nativePlugin) { reject(new Error('Plugin nativo no disponible')); return; }
        if (!deviceId) { reject(new Error('deviceId invalido')); return; }
        var targetId = deviceId;
        var normDev = _normId(deviceId);
        var knownMac = self._nexoIdToMac.get(normDev);
        if (knownMac) {
          targetId = knownMac;
          console.log('[BLEInterface] _sendMessageNative: NXID->MAC resolved', normDev, '->', knownMac);
        } else {
          var cleanMac = _normMac(normDev);
          var looksLikeMac = /^[0-9a-f]{12}$/.test(cleanMac);
          if (!looksLikeMac) {
            console.error('[BLEInterface] _sendMessageNative: No MAC mapping for', normDev, '- cannot send');
            reject(new Error('No MAC mapping for NXID ' + normDev));
            return;
          }
          targetId = cleanMac;
        }
        var isCtrl = _isControlPacket(content);
        var enrichedPayload;
        if (isCtrl) { enrichedPayload = content; }
        else {
          var senderId = self.localNexoId || self.localDeviceUUID;
          var msgId = messageId || ('msg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9));
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
            .then(function() { resolve(); }).catch(function(e) { reject(e); });
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
        var contact = _getContactByUUID(uuid);
        var deviceId = contact ? contact.deviceId : null;
        if (!deviceId && self._activeChatDeviceId === uuid) deviceId = self._activeChatDeviceIdNative;
        if (!deviceId) {
          self.foundDevices.forEach(function(d) { if (!deviceId && _normId(d.deviceUUID) === uuid) deviceId = d.id; });
          self.connectedDevices.forEach(function(d) { if (!deviceId && _normId(d.deviceUUID) === uuid) deviceId = d.id; });
        }
        if (!deviceId) {
          var allContacts = _getBLEContacts();
          for (var i = 0; i < allContacts.length; i++) {
            if (_normId(allContacts[i].nexoId || allContacts[i].deviceUUID) === uuid && allContacts[i].deviceId) { deviceId = allContacts[i].deviceId; break; }
          }
        }
        if (!deviceId) {
          var mappedMac = self._nexoIdToMac.get(uuid);
          if (mappedMac) {
            deviceId = mappedMac;
            console.log('[BLEInterface] sendChatMessage: fallback mappedMac', uuid, '->', mappedMac);
          }
        }
        if (!deviceId) { console.error('[BLEInterface] sendChatMessage: No deviceId para UUID', uuid); reject(new Error('Dispositivo no encontrado')); return; }
        if (contact && !contact.deviceId) { contact.deviceId = deviceId; _saveBLEContacts(_getBLEContacts()); }
        var msgId = messageId || ('msg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5));
        var ownMsg = {
          msgId: msgId,
          messageId: msgId,
          content: content,
          _own: true,
          status: 'pending',
          timestamp: Date.now()
        };
        _vaultAppendMessage(uuid, ownMsg, true);
        var state = self._getDeviceState(deviceId);
        var supState = self._supervisorStates.get(deviceId);
        var isReady = state.state === BLE_STATES.READY_TO_CHAT || state.state === BLE_STATES.NOTIFICATIONS_READY;
        var isConnecting = state.state === BLE_STATES.CONNECTING || state.state === BLE_STATES.DISCOVERING_SERVICES;
        var isZombie = supState && supState.state === SUPERVISOR_STATES.ZOMBIE;
        if (isZombie || (!isReady && !isConnecting)) {
          console.log('[BLEInterface] sendChatMessage: stale/zombie detectado, forzando reconnect para', deviceId);
          self._forceDisconnectAndReconnect(deviceId);
          var queueKey = uuid; // FIX: NXID es la clave estable de cola
          var queue = self._pendingMessageQueue.get(queueKey) || [];
          queue.push({ content: content, messageId: msgId, resolve: resolve, reject: reject });
          self._pendingMessageQueue.set(queueKey, queue);
          return;
        }
        function doSend() {
          if (self.ackSystem) {
            self.ackSystem.sendWithRetry(deviceId, content, msgId)
              .then(function() { resolve(); }).catch(function(err) { reject(err); });
          } else {
            self._sendMessageNative(deviceId, content, msgId)
              .then(function() { resolve(); }).catch(function(err) { reject(err); });
          }
        }
        function enqueueMsg() {
          var queueKey = uuid; // FIX: NXID es la clave estable de cola
          var queue = self._pendingMessageQueue.get(queueKey) || [];
          queue.push({ content: content, messageId: msgId, resolve: resolve, reject: reject });
          self._pendingMessageQueue.set(queueKey, queue);
        }
        if (isReady) { doSend(); return; }
        enqueueMsg();
        if (!isConnecting && self.nativePlugin && _hasNativeMethod(self.nativePlugin, 'connectToDevice')) {
          console.log('[BLEInterface] sendChatMessage: forcing connectToDevice for', deviceId);
          _safeNativeCall(self.nativePlugin, 'connectToDevice', { deviceId: deviceId })
            .catch(function(e) {});
        }
      } catch (fatal) { reject(fatal); }
    });
  }

  sendFile(deviceUUID, fileId, base64Data, meta) {
    var self = this;
    return new Promise(function(resolve, reject) {
      try {
        var uuid = _normId(deviceUUID);
        if (!uuid) { reject(new Error('deviceUUID vacio')); return; }
        var contact = _getContactByUUID(uuid);
        var deviceId = contact ? contact.deviceId : null;
        if (!deviceId && self._activeChatDeviceId === uuid) deviceId = self._activeChatDeviceIdNative;
        if (!deviceId) {
          var mappedMac = self._nexoIdToMac.get(uuid);
          if (mappedMac) deviceId = mappedMac;
        }
        if (!deviceId) { reject(new Error('Dispositivo no encontrado')); return; }
        if (!self.ackSystem || typeof self.ackSystem.sendFile !== 'function') {
          reject(new Error('AckSystem no disponible para envio de archivos'));
          return;
        }
        self.ackSystem.sendFile(deviceId, fileId, base64Data, meta)
          .then(function() { resolve(); })
          .catch(function(err) { reject(err); });
      } catch (fatal) { reject(fatal); }
    });
  }

  _waitForReadyToChat(deviceId, timeoutMs) {
    var self = this;
    return new Promise(function(resolve, reject) {
      if (!deviceId) { reject(new Error('deviceId invalido')); return; }
      var state = self._getDeviceState(deviceId);
      if (state.state === BLE_STATES.READY_TO_CHAT || state.state === BLE_STATES.NOTIFICATIONS_READY) { resolve(); return; }
      var timer = setTimeout(function() { self._readyResolvers.delete(deviceId); reject(new Error('Timeout esperando READY_TO_CHAT')); }, timeoutMs || 3000);
      self._readyResolvers.set(deviceId, { resolve: resolve, timer: timer });
    });
  }
  _resolveReadyToChat(deviceId) {
    if (!deviceId) return;
    var self = this;
    var resolver = this._readyResolvers.get(deviceId);
    if (resolver) { clearTimeout(resolver.timer); resolver.resolve(); this._readyResolvers.delete(deviceId); }
    this._processPendingMessages(deviceId);
    // FIX: también reenviar mensajes pending del vault cuando el pipeline se pone listo
    var nx = this._macToNexoId.get(_normMac(deviceId));
    if (nx) {
      setTimeout(function() { self._resendPendingMessages(nx); }, 100);
    }
  }
  openChat(deviceUUID) {
    var self = this;
    return new Promise(function(resolve, reject) {
      try {
        var uuid = _normId(deviceUUID);
        if (!uuid) { reject(new Error('ID invalido')); return; }
        var contact = _getContactByUUID(uuid);
        var deviceId = contact ? contact.deviceId : null;
        if (!deviceId && contact) {
          self.foundDevices.forEach(function(d) { if (!deviceId && _normId(d.deviceUUID) === uuid) deviceId = d.id; });
          self.connectedDevices.forEach(function(d) { if (!deviceId && _normId(d.deviceUUID) === uuid) deviceId = d.id; });
        }
        if (!deviceId) {
          var mappedMac = self._nexoIdToMac.get(uuid);
          if (mappedMac) {
            deviceId = mappedMac;
            console.log('[BLEInterface] openChat: using mapped MAC', mappedMac);
          }
        }
        if (!deviceId) { reject(new Error('Dispositivo no conectado')); return; }
        self._activeChatDeviceId = uuid; self._activeChatDeviceIdNative = deviceId;
        self.newDevicesCount = 0; self.updateBadge();
        if (contact) {
          contact.unreadCount = 0; var contacts = _getBLEContacts();
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
          self.elements.panel.classList.remove('active'); self.elements.overlay.classList.remove('active');
        }
        finishOpenChat();
        // FIX: no reenviar pending del vault inmediatamente si el pipeline no está listo
        var deviceIdForResend = self._resolveDeviceIdForNexoId(uuid);
        if (deviceIdForResend) {
          var st = self._getDeviceState(deviceIdForResend);
          if (st.state === BLE_STATES.READY_TO_CHAT || st.state === BLE_STATES.NOTIFICATIONS_READY) {
            self._resendPendingMessages(uuid);
          } else {
            console.log('[BLEInterface] openChat: reenvio pending pospuesto hasta READY_TO_CHAT');
          }
        }
        _vaultLoadMessages(uuid).then(function(messages) {
          if (messages && messages.length > 0) {
            _safeDispatchEvent('nexo:vault:messagesLoaded', { contactId: uuid, messages: messages });
          }
        }).catch(function() {});
        resolve();
        if (!isFullyReady && self.nativePlugin && _hasNativeMethod(self.nativePlugin, 'connectToDevice')) {
          if (!isConnecting) {
            console.log('[BLEInterface] openChat: forcing connectToDevice for', deviceId);
            _safeNativeCall(self.nativePlugin, 'connectToDevice', { deviceId: deviceId })
              .catch(function(e) {});
          }
        }
      } catch (fatalErr) { console.error('[BLEInterface] FATAL openChat:', fatalErr); reject(fatalErr); }
    });
  }
  _resendPendingMessages(nexoId) {
    var self = this;
    if (!nexoId) return;
    _vaultLoadMessages(nexoId).then(function(messages) {
      if (!messages || messages.length === 0) return;
      var pending = messages.filter(function(m) { return m._own === true && m.status === 'pending'; });
      if (pending.length === 0) return;
      var deviceId = self._resolveDeviceIdForNexoId(nexoId);
      if (!deviceId) {
        console.warn('[BLEInterface] No deviceId resuelto para reenvio pending de', nexoId);
        return;
      }
      // FIX: solo reenviar si el pipeline está READY
      var st = self._getDeviceState(deviceId);
      if (st.state !== BLE_STATES.READY_TO_CHAT && st.state !== BLE_STATES.NOTIFICATIONS_READY) {
        console.log('[BLEInterface] Reenvio pending pospuesto para', nexoId, '— pipeline no listo:', st.state);
        return;
      }
      console.log('[BLEInterface] Reenviando', pending.length, 'mensajes pending para', nexoId);
      pending.forEach(function(msg) {
        var mid = msg.msgId || msg.messageId || msg.id;
        if (!mid) return;
        if (self.ackSystem) {
          self.ackSystem.sendWithRetry(deviceId, msg.content || msg.text || '', mid)
            .then(function() {
              console.log('[BLEInterface] Pending reenviado OK:', mid);
              _vaultUpdateMessageStatus(nexoId, mid, 'sent');
            })
            .catch(function(e) {
              console.warn('[BLEInterface] Pending reenvio fallo:', mid, e.message);
            });
        } else {
          self._sendMessageNative(deviceId, msg.content || msg.text || '', mid)
            .then(function() {
              _vaultUpdateMessageStatus(nexoId, mid, 'sent');
            })
            .catch(function(e) {});
        }
      });
    }).catch(function(e) {
      console.warn('[BLEInterface] Error cargando pending para reenvio:', e.message);
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
    if (this.isScanning) btn.classList.add('scanning'); else btn.classList.remove('scanning');
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
        self.updateVisibilityButton(); return Promise.resolve();
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
    self.updateVisibilityButton(); return Promise.resolve();
  }
  _autoScanForKnownContacts() {
    var self = this;
    if (self.isScanning) return;
    if (!self.nativePlugin || !_hasNativeMethod(self.nativePlugin, 'startScan')) return;
    console.log('[BLEInterface] Auto-scan iniciado');
    self.foundDevices.clear();
    _safeNativeCall(self.nativePlugin, 'startScan', {})
      .then(function() {
        self.isScanning = true;
        self.updateScanButton();
        setTimeout(function() {
          if (self.isScanning && _hasNativeMethod(self.nativePlugin, 'stopScan')) {
            _safeNativeCall(self.nativePlugin, 'stopScan', {}).then(function() {
              self.isScanning = false;
              self.updateScanButton();
              console.log('[BLEInterface] Auto-scan completado');
            }).catch(function() {
              self.isScanning = false;
              self.updateScanButton();
            });
          }
        }, 6000);
      })
      .catch(function(e) {
        console.warn('[BLEInterface] Auto-scan fallo:', e.message);
      });
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
      '<div style="text-align:center;">' +
      '<div class="contacts-title">Agregar contactos</div>' +
      '</div>' +
      '</div>' +
      '<div class="ble-search-bar">' +
      '<svg viewBox="0 0 24 24"><path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0016 9.5 6.5 6.5 0 109.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/></svg>' +
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
      });
    }
    var navItems = this.elements.bottomNav.querySelectorAll('.ble-nav-item');
    navItems.forEach(function(item) {
      item.addEventListener('click', function() {
        navItems.forEach(function(n) { n.classList.remove('active'); });
        item.classList.add('active');
        var tab = item.dataset.tab;
        if (tab === 'people') self.togglePanel();
        else if (tab === 'chats') {
          self.elements.panel.classList.remove('active');
          self.elements.overlay.classList.remove('active');
        }
      });
    });
    window.addEventListener('nexo:ble:closeChat', function() {
      self._activeChatDeviceId = null; self._activeChatDeviceIdNative = null;
      self._stopPingInterval();
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
  _stopPingInterval() {
    if (this._pingInterval) {
      clearInterval(this._pingInterval);
      this._pingInterval = null;
    }
    this._pendingPings.forEach(function(p) { clearTimeout(p.timer); });
    this._pendingPings.clear();
  }
  togglePanel() {
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
        return _safeNativeCall(self.nativePlugin, 'stopScan', {}).then(function() { self.isScanning = false; self.updateScanButton(); self.updateStatus(); });
      }
      self.isScanning = false; self.updateScanButton(); self.updateStatus(); return Promise.resolve();
    } else {
      self.foundDevices.clear(); self.renderContactsList(); self.renderNewDeviceBar(); self.renderOnlineStrip();
      if (_hasNativeMethod(self.nativePlugin, 'startScan')) {
        return _safeNativeCall(self.nativePlugin, 'startScan', {}).then(function() { self.isScanning = true; self.updateScanButton(); });
      }
      self.isScanning = true; self.updateScanButton(); return Promise.resolve();
    }
  }
  _doToggleScan() {
    var self = this;
    var permsReady = false;
    if (window.ensureBLEPermissions) {
      return window.ensureBLEPermissions().then(function(result) { permsReady = result; }).catch(function() { permsReady = true; }).then(function() {
        if (!permsReady) return Promise.resolve();
        return self._executeToggleScan();
      }).catch(function(err) { self.isScanning = false; self.updateScanButton(); });
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
            _showToast('Bluetooth apagado. Activalo para buscar contactos.', 'warn');
            self.updateStatusBar('BLE OFF - Activa Bluetooth');
            return Promise.resolve();
          }
          return self._doToggleScan();
        })
        .catch(function() { return self._doToggleScan(); });
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
      var idx = contacts.findIndex(function(c) { return _normId(c.nexoId || c.deviceUUID) === _normId(nexoId); });
      if (idx >= 0) {
        contacts[idx].online = true;
        contacts[idx].lastSeen = Date.now();
        contacts[idx].deviceId = deviceId;
        _saveBLEContacts(contacts);
      }
      this.renderContactsList();
      this.renderOnlineStrip();
      var state = this._getDeviceState(deviceId);
      if (state.state === BLE_STATES.DISCONNECTED) {
        console.log('[BLEInterface] Auto-reconnect a contacto conocido:', nexoId);
        this._autoConnectGATT(deviceId, device);
      }
      return;
    }
    if (!this.foundDevices.has(deviceId)) {
      device.lastSeen = Date.now();
      device.deviceUUID = nexoId;
      this.foundDevices.set(deviceId, device);
      this.newDevicesCount++;
      this.updateBadge();
      this.renderNewDeviceBar();
    } else {
      var existing = this.foundDevices.get(deviceId);
      existing.rssi = device.rssi;
      existing.lastSeen = Date.now();
      existing.deviceUUID = nexoId;
      this.foundDevices.set(deviceId, existing);
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
      var initials = _getInitials(contact.name);
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
      menuBtn.addEventListener('click', function(e) { e.stopPropagation(); self._toggleContactMenu(uuid, menuBtn); });
      row.appendChild(menuBtn);
      list.appendChild(row);
      if (index < contacts.length - 1) { var divider = document.createElement('div'); divider.className = 'ble-divider'; list.appendChild(divider); }
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
      document.addEventListener('click', function closeMenu(e) { if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener('click', closeMenu); } });
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
  _addNewDevice(deviceId) {
    var self = this;
    if (!deviceId) {
      var bar = this.elements.newDeviceBar;
      if (bar && bar.dataset) deviceId = bar.dataset.deviceId || '';
    }
    var device = this.foundDevices.get(deviceId);
    if (!device) return;
    var name = device.name || device.deviceUUID || 'Nexo Device';
    var nexoId = device.deviceUUID || '';
    if (!nexoId || nexoId.length !== 10 || nexoId.indexOf('NX') !== 0) {
      console.warn('[BLEInterface] No se puede agregar: dispositivo sin NEXO ID');
      return;
    }
    _addBLEContact({ deviceUUID: nexoId, name: name, deviceId: deviceId });
    _vaultGetOrCreateContact(nexoId, name, device.name);
    this._autoConnectGATT(deviceId, device);
    this.foundDevices.delete(deviceId);
    this._closePanelAndRefresh();
  }
  _closePanelAndRefresh() {
    this.elements.panel.classList.remove('active');
    this.elements.overlay.classList.remove('active');
    this.renderContactsList();
    this.renderOnlineStrip();
    this.renderNewDeviceBar();
  }
  _autoConnectGATT(deviceId, device) {
    var self = this;
    if (!self.nativePlugin || !_hasNativeMethod(self.nativePlugin, 'connectToDevice')) return Promise.resolve();
    if (!deviceId) return Promise.resolve();
    var state = self._getDeviceState(deviceId);
    if (state.state === BLE_STATES.CONNECTING && state.timestamp && (Date.now() - state.timestamp > 8000)) {
      console.log('[BLEInterface] _autoConnectGATT: timeout >8s en CONNECTING, forzando reconnect para', deviceId);
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
      .then(function(result) { if (result && (result.connected || result.alreadyConnected)) { return self._waitForReadyToChat(deviceId, 8000).then(function() {}); } else { self._setDeviceState(deviceId, BLE_STATES.DISCONNECTED); } })
      .catch(function(e) { self._setDeviceState(deviceId, BLE_STATES.DISCONNECTED); });
  }
  removeContact(deviceUUID) {
    try { _removeBLEContact(deviceUUID); this.renderContactsList(); this.renderNewDeviceBar(); this.renderOnlineStrip(); } catch (e) {}
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
            self._activeChatDeviceId = null; self._activeChatDeviceIdNative = null;
            self.updateBadge();
          }
        }).catch(function(err) {});
    }
    return Promise.resolve();
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
  getContacts() {
    return _getBLEContacts();
  }
  getContactByUUID(deviceUUID) {
    return _getContactByUUID(deviceUUID);
  }
  destroy() {
    var self = this;
    console.log('[BLEInterface] destroy() — limpiando supervisor y listeners');
    self._stopConnectionSupervisor();
    self._stopPingInterval();
    self._backoffTimers.forEach(function(t) { clearTimeout(t); });
    self._backoffTimers.clear();
    self._reconnectAttempts.clear();
    if (self._nativePayloadListener) { try { self._nativePayloadListener.remove(); } catch(e) {} self._nativePayloadListener = null; }
    if (self._nativeDeviceConnectedListener) { try { self._nativeDeviceConnectedListener.remove(); } catch(e) {} self._nativeDeviceConnectedListener = null; }
    if (self._nativeDeviceDisconnectedListener) { try { self._nativeDeviceDisconnectedListener.remove(); } catch(e) {} self._nativeDeviceDisconnectedListener = null; }
    if (self._nativeServicesReadyListener) { try { self._nativeServicesReadyListener.remove(); } catch(e) {} self._nativeServicesReadyListener = null; }
    if (self._nativeNotificationsListener) { try { self._nativeNotificationsListener.remove(); } catch(e) {} self._nativeNotificationsListener = null; }
    if (self._nativeConnectionFailedListener) { try { self._nativeConnectionFailedListener.remove(); } catch(e) {} self._nativeConnectionFailedListener = null; }
    if (self._nativeScanFailedListener) { try { self._nativeScanFailedListener.remove(); } catch(e) {} self._nativeScanFailedListener = null; }
    if (self._nativeServerReadyListener) { try { self._nativeServerReadyListener.remove(); } catch(e) {} self._nativeServerReadyListener = null; }
    if (self._nativeAdStartedListener) { try { self._nativeAdStartedListener.remove(); } catch(e) {} self._nativeAdStartedListener = null; }
    if (self._nativeAdFailedListener) { try { self._nativeAdFailedListener.remove(); } catch(e) {} self._nativeAdFailedListener = null; }
    self._notificationFallbackTimers.forEach(function(t) { clearTimeout(t); });
    self._notificationFallbackTimers.clear();
    self._readyResolvers.forEach(function(r) { clearTimeout(r.timer); try { r.reject(new Error('Interface destroyed')); } catch(e) {} });
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
  }
}
export function initBLEInterface(bleMesh) {
  var instance = new BLEInterface(bleMesh).init();
  window.bleInterface = instance;
  return instance;
}
