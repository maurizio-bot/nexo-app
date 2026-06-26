/**
 * BLE Interface v5.0.5-FIX
 * FIX: openChat() agrega chat-view-active al body en lugar de togglePanel()
 * FIX: togglePanel() remueve chat-view-active al cerrar
 * Base: v5.0.4-ACK-ANTI-LOOP-ES5
 */
export function initBLEInterface(bleMesh) {
  var instance = new BLEInterface(bleMesh).init();
  window.bleInterface = instance;
  return instance;
}

var BLE_CONTACTS_STORAGE_KEY = 'nexo_ble_contacts_v2';
var BLE_UUID_STORAGE_KEY = 'nexo_device_uuid';
var BLE_MAC_MAP_STORAGE_KEY = 'nexo_ble_mac_map_v2';
var BLE_UUID_MAP_STORAGE_KEY = 'nexo_ble_uuid_map_v2';
var BLE_ACTIVE_CHAT_MAC_KEY = 'nexo_active_chat_mac';

function _saveMacMaps(uuidToMacMap, macToUuidMap) {
  try {
    var u2m = {};
    uuidToMacMap.forEach(function(v, k) { u2m[k] = v; });
    var m2u = {};
    macToUuidMap.forEach(function(v, k) { m2u[k] = v; });
    localStorage.setItem(BLE_MAC_MAP_STORAGE_KEY, JSON.stringify(u2m));
    localStorage.setItem(BLE_UUID_MAP_STORAGE_KEY, JSON.stringify(m2u));
  } catch (e) {
    console.warn('[BLEInterface] No se pudieron guardar MAC maps:', e.message);
  }
}

function _loadMacMaps() {
  try {
    var u2mRaw = localStorage.getItem(BLE_MAC_MAP_STORAGE_KEY);
    var m2uRaw = localStorage.getItem(BLE_UUID_MAP_STORAGE_KEY);
    return {
      uuidToMac: u2mRaw ? JSON.parse(u2mRaw) : {},
      macToUuid: m2uRaw ? JSON.parse(m2uRaw) : {}
    };
  } catch (e) {
    return { uuidToMac: {}, macToUuid: {} };
  }
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
  var m = _normId(mac);
  if (!m) return '';
  m = m.replace(/[:\.\-]/g, '');
  if (!/^[0-9a-f]{12}$/.test(m)) return '';
  return m;
}

function _macWithColons(mac) {
  var m = _normMac(mac);
  if (!m) return '';
  return m.match(/.{2}/g).join(':').toLowerCase();
}

function _isValidMAC(mac) {
  return _normMac(mac).length === 12;
}

function _getBLEContacts() {
  try {
    var raw = localStorage.getItem(BLE_CONTACTS_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) { return []; }
}

function _saveBLEContacts(contacts) {
  try {
    localStorage.setItem(BLE_CONTACTS_STORAGE_KEY, JSON.stringify(contacts));
  } catch (e) {
    console.warn('[BLEInterface] No se pudo guardar contactos:', e.message);
  }
}

function _addBLEContact(contact) {
  var contacts = _getBLEContacts();
  var uuid = _normId(contact.deviceUUID);
  if (!uuid) return false;
  var existingIdx = contacts.findIndex(function(c) {
    return _normId(c.deviceUUID) === uuid;
  });
  var macNorm = _normMac(contact.macAddress);
  if (existingIdx >= 0) {
    contacts[existingIdx].name = contact.name || contacts[existingIdx].name || 'NEXO Peer';
    if (macNorm) contacts[existingIdx].macAddress = macNorm;
    contacts[existingIdx].lastSeen = Date.now();
    contacts[existingIdx].online = true;
    _saveBLEContacts(contacts);
    return true;
  }
  contacts.push({
    deviceUUID: uuid,
    name: contact.name || 'NEXO Peer',
    macAddress: macNorm || null,
    addedAt: Date.now(),
    lastSeen: Date.now(),
    online: true
  });
  _saveBLEContacts(contacts);
  return true;
}

function _removeBLEContact(deviceUUID) {
  var uuid = _normId(deviceUUID);
  var contacts = _getBLEContacts().filter(function(c) {
    return _normId(c.deviceUUID) !== uuid;
  });
  _saveBLEContacts(contacts);
}

function _isBLEContact(deviceUUID) {
  return _getBLEContacts().some(function(c) {
    return _normId(c.deviceUUID) === _normId(deviceUUID);
  });
}

function _getContactByUUID(deviceUUID) {
  var uuid = _normId(deviceUUID);
  return _getBLEContacts().find(function(c) {
    return _normId(c.deviceUUID) === uuid;
  });
}

var BLE_STATES = {
  DISCONNECTED: 'disconnected',
  CONNECTING: 'connecting',
  DISCOVERING_SERVICES: 'discovering_services',
  NOTIFICATIONS_READY: 'notifications_ready',
  READY_TO_CHAT: 'ready_to_chat',
  ERROR: 'error',
  RECONNECTING: 'reconnecting'
};

function _hasNativeMethod(plugin, method) {
  return plugin && typeof plugin[method] === 'function';
}

function _safeNativeCall(plugin, method, args) {
  return new Promise(function(resolve, reject) {
    if (!plugin) { reject(new Error('Plugin nativo no disponible')); return; }
    if (typeof plugin[method] !== 'function') { reject(new Error('Metodo ' + method + ' no disponible')); return; }
    try {
      var result;
      if (args && typeof args === 'object' && !Array.isArray(args)) {
        result = plugin[method](args);
      } else {
        var callArgs = Array.isArray(args) ? args : (args ? [args] : []);
        result = plugin[method].apply(plugin, callArgs);
      }
      if (result && typeof result.then === 'function') {
        result.then(resolve).catch(reject);
      } else { resolve(result); }
    } catch (e) { reject(e); }
  });
}

function _safeDispatchEvent(eventName, detail) {
  try {
    window.dispatchEvent(new CustomEvent(eventName, { detail: detail }));
  } catch (e) {
    console.warn('[BLEInterface] Error dispatching ' + eventName + ':', e.message);
  }
}

function _clearStaleCache() {
  try {
    var now = Date.now();
    var CACHE_MAX_AGE_MS = 5 * 60 * 1000;
    var lastClear = localStorage.getItem('nexo_ble_lastCacheClear');
    if (!lastClear || (now - parseInt(lastClear, 10)) > CACHE_MAX_AGE_MS) {
      var validContacts = [];
      var contactsRaw = localStorage.getItem(BLE_CONTACTS_STORAGE_KEY);
      if (contactsRaw) {
        try {
          var contacts = JSON.parse(contactsRaw);
          validContacts = contacts.filter(function(c) {
            return c && c.macAddress && _normMac(c.macAddress).length >= 6;
          });
        } catch(e) {}
      }
      localStorage.removeItem(BLE_MAC_MAP_STORAGE_KEY);
      localStorage.removeItem(BLE_UUID_MAP_STORAGE_KEY);
      localStorage.removeItem(BLE_ACTIVE_CHAT_MAC_KEY);
      if (validContacts.length > 0) {
        localStorage.setItem(BLE_CONTACTS_STORAGE_KEY, JSON.stringify(validContacts));
      } else {
        localStorage.removeItem(BLE_CONTACTS_STORAGE_KEY);
      }
      localStorage.setItem('nexo_ble_lastCacheClear', String(now));
      console.log('[BLE] Cache limpiado automaticamente');
    }
  } catch(e) {
    console.warn('[BLE] Error limpiando cache:', e);
  }
}

function _isControlPacket(content) {
  if (!content || typeof content !== 'string') return false;
  if (content.indexOf('"type":"ack"') !== -1) return true;
  if (content.indexOf('"type":"read_receipt"') !== -1) return true;
  return false;
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
    this._renderedDeviceIds = new Set();
    this.nativePlugin = (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.NexoBLE) || null;
    this.isDummyMode = !bleMesh && !this.nativePlugin;
    this.meshType = this._detectMeshType();
    this.isAdvertising = false;
    this.canAdvertise = false;
    this.localDeviceName = 'NEXO Device';
    this.localDeviceAddress = null;
    this.localDeviceUUID = _getDeviceUUID();
    this._activeChatDeviceId = null;
    this._activeChatMAC = null;
    this._deviceStates = new Map();
    this._receivedMessageIds = new Set();
    this._maxMessageIds = 1000;
    this._pendingMessageQueue = new Map();
    this._macToUuidMap = new Map();
    this._uuidToMacMap = new Map();
    var loadedMaps = _loadMacMaps();
    for (var k in loadedMaps.uuidToMac) {
      if (loadedMaps.uuidToMac.hasOwnProperty(k)) {
        var loadedMac = _normMac(loadedMaps.uuidToMac[k]);
        if (loadedMac) this._uuidToMacMap.set(k, loadedMac);
      }
    }
    for (var k in loadedMaps.macToUuid) {
      if (loadedMaps.macToUuid.hasOwnProperty(k)) {
        var loadedMacKey = _normMac(k);
        if (loadedMacKey) this._macToUuidMap.set(loadedMacKey, loadedMaps.macToUuid[k]);
      }
    }
    this._readyResolvers = new Map();
    this._notificationFallbackTimers = new Map();
    console.log('[BLEInterface] DUAL GATT v5.0.5-FIX iniciado. MAC maps:', this._uuidToMacMap.size, 'entradas');
  }

  _detectMeshType() {
    if (!this.bleMesh) return 'none';
    if (typeof this.bleMesh.getState === 'function') return 'nordic';
    if (typeof this.bleMesh.getStatus === 'function') return 'hybrid';
    return 'unknown';
  }

  init() {
    _clearStaleCache();
    this.createDOM();
    this.injectStyles();
    this.setupEventListeners();
    if (!this.nativePlugin) {
      this.nativePlugin = (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.NexoBLE) || null;
      if (this.nativePlugin) {
        this.isDummyMode = !this.bleMesh && !this.nativePlugin;
        this.showToast('[BLE JS] Plugin nativo detectado', 'info', 2000);
      }
    }
    if (this.isDummyMode) {
      this.showToast('[BLE JS] MODO DUMMY', 'warning', 3000);
      this.updateStatus('OFFLINE (Dummy)');
    } else {
      this.updateStatus();
      this._setupNativeScanListeners();
      this._setupNativeConnectionListeners();
      this._setupNativePayloadListener();
      this._setupNativeStateListeners();
      this._setupNativeServerReadyListener();
      this._loadLocalDeviceInfo();
      this._rebuildMacMaps();
      this._autoStartAdvertising();
    }
    console.log('[BLEInterface] UUID local:', this.localDeviceUUID);
    return this;
  }

  _rebuildMacMaps() {
    var self = this;
    var contacts = _getBLEContacts();
    contacts.forEach(function(contact) {
      var uuid = _normId(contact.deviceUUID);
      var mac = _normMac(contact.macAddress);
      if (uuid && mac) {
        self._macToUuidMap.set(mac, uuid);
        self._uuidToMacMap.set(uuid, mac);
      }
    });
  }

  _autoStartAdvertising() {
    var self = this;
    if (self.isDummyMode || !self.nativePlugin) {
      self.showToast('[BLE JS] Auto-advertise: dummy/sin plugin', 'warning', 2000);
      return Promise.resolve();
    }
    if (!_hasNativeMethod(self.nativePlugin, 'isBluetoothEnabled')) {
      self.showToast('[BLE JS] Auto-advertise: sin isBluetoothEnabled', 'warning', 2000);
      return Promise.resolve();
    }
    self.showToast('[BLE JS] Auto-advertise iniciando...', 'info', 2000);
    return _safeNativeCall(self.nativePlugin, 'isBluetoothEnabled', {})
      .then(function(btState) {
        var canAdv = btState && btState.canAdvertise;
        var serverReady = btState && btState.serverReady;
        if ((canAdv || serverReady) && _hasNativeMethod(self.nativePlugin, 'startAdvertising')) {
          self.showToast('[BLE JS] Auto-advertise: iniciando...', 'info', 2000);
          return _safeNativeCall(self.nativePlugin, 'startAdvertising', {})
            .then(function() {
              self.isAdvertising = true;
              self.canAdvertise = true;
              self.updateVisibilityButton();
              self.showToast('[BLE JS] Auto-advertise OK', 'success', 2000);
            })
            .catch(function(e) {
              self.showToast('[BLE JS] Auto-advertise fallo: ' + e.message, 'error', 3000);
            });
        } else {
          self.showToast('[BLE JS] Auto-advertise: no disponible', 'warning', 2000);
        }
      })
      .catch(function(e) {
        self.showToast('[BLE JS] Auto-advertise fallo: ' + e.message, 'error', 3000);
        console.warn('[BLEInterface] Auto-advertise fallo:', e.message);
      });
  }

  _loadLocalDeviceInfo() {
    var self = this;
    if (!self.nativePlugin || !_hasNativeMethod(self.nativePlugin, 'getLocalDeviceInfo')) return Promise.resolve();
    return _safeNativeCall(self.nativePlugin, 'getLocalDeviceInfo', {})
      .then(function(info) {
        self.localDeviceName = (info && info.deviceName) || 'NEXO Device';
        self.localDeviceAddress = _normMac((info && info.deviceAddress) || '');
      })
      .catch(function() {});
  }

  _setupNativeScanListeners() {
    if (!this.nativePlugin) return;
    if (!_hasNativeMethod(this.nativePlugin, 'addListener')) return;
    var self = this;
    this._nativeDeviceFoundListener = this.nativePlugin.addListener('onDeviceFound', function(data) {
      try {
        var mac = _normMac(data.deviceId);
        var name = data.name || 'NEXO Device';
        self.showToast('[BLE JS] onDeviceFound: ' + name + ' (' + mac + ')', 'info', 2000);
        if (!mac) return;
        self.onDeviceFound({ id: mac, address: mac, name: name, rssi: data.rssi });
      } catch (e) {
        console.warn('[BLEInterface] Error onDeviceFound:', e.message);
      }
    });
    this._nativeScanFailedListener = this.nativePlugin.addListener('onScanFailed', function(data) {
      try {
        self.isScanning = false;
        self.updateScanButton();
        self.showToast('[BLE JS] Scan FAILED', 'error', 3000);
      } catch (e) {}
    });
  }

  _setupNativeServerReadyListener() {
    if (!this.nativePlugin) return;
    if (!_hasNativeMethod(this.nativePlugin, 'addListener')) return;
    var self = this;
    this._nativeServerReadyListener = this.nativePlugin.addListener('onServerReady', function(data) {
      try {
        self.showToast('[BLE JS] Server READY', 'success', 2000);
        console.log('[BLEInterface] onServerReady:', data);
      } catch (e) {}
    });
  }

  _setupNativeConnectionListeners() {
    if (!this.nativePlugin) return;
    if (!_hasNativeMethod(this.nativePlugin, 'addListener')) return;
    var self = this;
    this._nativeDeviceConnectedListener = this.nativePlugin.addListener('onDeviceConnected', function(data) {
      try {
        var mac = _normMac(data.deviceId);
        self.showToast('[BLE JS] Device CONNECTED: ' + mac, 'success', 2000);
        if (!mac) return;
        var peerUUID = self._macToUuidMap.get(mac);
        var contact = peerUUID ? _getContactByUUID(peerUUID) : null;
        var displayName = data.name || (contact ? contact.name : null) || 'NEXO Peer';
        self.connectedDevices.set(mac, {
          id: mac, address: mac, name: displayName,
          direction: data.direction || 'outgoing',
          role: data.role || 'client',
          servicesReady: data.servicesReady || false,
          deviceUUID: peerUUID
        });
        self._setDeviceState(mac, data.role === 'server' ? BLE_STATES.READY_TO_CHAT : BLE_STATES.CONNECTING, {
          direction: data.direction, role: data.role, deviceUUID: peerUUID
        });
        if (peerUUID) {
          var contacts = _getBLEContacts();
          var idx = contacts.findIndex(function(c) { return _normId(c.deviceUUID) === _normId(peerUUID); });
          if (idx >= 0) {
            contacts[idx].online = true;
            contacts[idx].lastSeen = Date.now();
            contacts[idx].macAddress = mac;
            _saveBLEContacts(contacts);
            self.renderContactsList();
          }
        }
        _safeDispatchEvent('nexo:ble:deviceConnected', { deviceId: mac, deviceUUID: peerUUID, name: displayName });
      } catch (e) {
        console.warn('[BLEInterface] Error onDeviceConnected:', e.message);
      }
    });
    this._nativeDeviceDisconnectedListener = this.nativePlugin.addListener('onDeviceDisconnected', function(data) {
      try {
        var mac = _normMac(data.deviceId);
        self.showToast('[BLE JS] Device DISCONNECTED: ' + mac, 'warning', 2000);
        if (!mac) return;
        var peerUUID = self._macToUuidMap.get(mac);
        self.connectedDevices.delete(mac);
        self._setDeviceState(mac, BLE_STATES.DISCONNECTED);
        if (peerUUID) {
          var contacts = _getBLEContacts();
          var idx = contacts.findIndex(function(c) { return _normId(c.deviceUUID) === _normId(peerUUID); });
          if (idx >= 0) {
            contacts[idx].online = false;
            _saveBLEContacts(contacts);
            self.renderContactsList();
          }
        }
        _safeDispatchEvent('nexo:ble:deviceDisconnected', { deviceId: mac, deviceUUID: peerUUID });
        if (self.isAdvertising && self.nativePlugin && _hasNativeMethod(self.nativePlugin, 'startAdvertising')) {
          self.showToast('[BLE JS] Reanudando advertising...', 'info', 2000);
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
        var mac = _normMac(data.deviceId);
        self.showToast('[BLE JS] Services READY: ' + mac, 'info', 2000);
        if (!mac) return;
        self._setDeviceState(mac, BLE_STATES.DISCOVERING_SERVICES, { servicesReady: true });
        var device = self.connectedDevices.get(mac);
        if (device) { device.servicesReady = true; self.connectedDevices.set(mac, device); }
        var fallbackTimer = setTimeout(function() {
          var st = self._getDeviceState(mac);
          if (st.state === BLE_STATES.DISCOVERING_SERVICES) {
            self._setDeviceState(mac, BLE_STATES.READY_TO_CHAT);
            self._resolveReadyToChat(mac);
          }
        }, 3000);
        self._notificationFallbackTimers.set(mac, fallbackTimer);
      } catch (e) {}
    });
    this._nativeNotificationsListener = this.nativePlugin.addListener('onNotificationsEnabled', function(data) {
      try {
        var mac = _normMac(data.deviceId);
        self.showToast('[BLE JS] Notifications ENABLED: ' + mac, 'success', 2000);
        if (!mac) return;
        var ft = self._notificationFallbackTimers.get(mac);
        if (ft) { clearTimeout(ft); self._notificationFallbackTimers.delete(mac); }
        var peerUUID = self._macToUuidMap.get(mac);
        self._setDeviceState(mac, BLE_STATES.READY_TO_CHAT, { notificationsEnabled: true, deviceUUID: peerUUID });
        self._resolveReadyToChat(mac);
        self._processPendingMessages(mac);
      } catch (e) {}
    });
    this._nativeConnectionFailedListener = this.nativePlugin.addListener('onConnectionFailed', function(data) {
      try {
        var mac = _normMac(data.deviceId);
        self.showToast('[BLE JS] Connection FAILED: ' + mac + ' reason=' + (data.reason || 'unknown'), 'error', 3000);
        if (!mac) return;
        var ft = self._notificationFallbackTimers.get(mac);
        if (ft) { clearTimeout(ft); self._notificationFallbackTimers.delete(mac); }
        self._setDeviceState(mac, BLE_STATES.ERROR, { lastError: data.reason });
      } catch (e) {}
    });
  }

  _setDeviceState(deviceMAC, state, meta) {
    meta = meta || {};
    var macNorm = _normMac(deviceMAC);
    if (!macNorm) return;
    var stateObj = Object.assign({}, meta, { state: state, timestamp: Date.now() });
    this._deviceStates.set(macNorm, stateObj);
  }

  _getDeviceState(deviceMAC) {
    var macNorm = _normMac(deviceMAC);
    if (!macNorm) return { state: BLE_STATES.DISCONNECTED };
    return this._deviceStates.get(macNorm) || { state: BLE_STATES.DISCONNECTED };
  }

  _setupNativePayloadListener() {
    if (!this.nativePlugin) return;
    if (!_hasNativeMethod(this.nativePlugin, 'addListener')) return;
    if (this._nativePayloadListener) {
      try { this._nativePayloadListener.remove(); } catch (e) {}
    }
    var self = this;
    this._nativePayloadListener = this.nativePlugin.addListener('onPayloadReceived', function(data) {
      try {
        var mac = _normMac(data.deviceId);
        self.showToast('[BLE JS] Payload recibido de ' + mac, 'info', 2000);
        if (!mac) return;
        var source = data.source || 'unknown';
        if (source !== 'gatt_server' && source !== 'gatt_client' && source !== 'broadcast') {
          source = 'gatt_client';
        }
        var messageId = null;
        var senderName = null;
        var senderUUID = null;
        var content = data.content || data.data || '';

        var isControl = _isControlPacket(content);
        if (isControl) {
          try {
            var ctrl = JSON.parse(content);
            messageId = ctrl.messageId;
            senderUUID = ctrl.deviceUUID || self._macToUuidMap.get(mac);
            senderName = ctrl.senderName || 'NEXO Peer';
            _safeDispatchEvent('nexo:ble:messageReceived', {
              deviceId: mac,
              deviceUUID: senderUUID,
              macAddress: mac,
              content: content,
              senderName: senderName,
              messageId: messageId,
              source: source,
              timestamp: data.timestamp || Date.now(),
              isControl: true
            });
            return;
          } catch (ctrlErr) {}
        }

        if (content.charAt(0) === '{' || (data.data && data.data.charAt(0) === '{')) {
          try {
            var json = JSON.parse(data.data || content || '{}');
            if (json.messageId) messageId = json.messageId;
            if (json.senderName) senderName = json.senderName;
            if (json.deviceName) senderName = json.deviceName;
            if (json.deviceUUID) senderUUID = json.deviceUUID;
            if (json.content) content = json.content;
          } catch (e) {}
        }
        if (!senderUUID) senderUUID = self._macToUuidMap.get(mac);
        if (senderUUID) {
          self._macToUuidMap.set(mac, senderUUID);
          self._uuidToMacMap.set(senderUUID, mac);
        }
        if (!senderName || senderName === 'NEXO Peer') {
          var contact = _getContactByUUID(senderUUID);
          var cname = contact ? contact.name : null;
          senderName = cname
            || (self.connectedDevices.get(mac) && self.connectedDevices.get(mac).name)
            || (self.foundDevices.get(mac) && self.foundDevices.get(mac).name)
            || 'NEXO Peer';
        }
        if (senderUUID && senderName && senderName !== 'NEXO Peer') {
          var existingUUIDForMac = self._macToUuidMap.get(mac);
          if (existingUUIDForMac && existingUUIDForMac !== senderUUID) {
            var contacts = _getBLEContacts();
            var idx = contacts.findIndex(function(c) { return _normId(c.deviceUUID) === _normId(existingUUIDForMac); });
            if (idx >= 0) {
              contacts[idx].deviceUUID = senderUUID;
              contacts[idx].name = senderName;
              contacts[idx].macAddress = mac;
              contacts[idx].online = true;
              contacts[idx].lastSeen = Date.now();
              _saveBLEContacts(contacts);
            }
            self._macToUuidMap.set(mac, senderUUID);
            self._uuidToMacMap.delete(existingUUIDForMac);
            self._uuidToMacMap.set(senderUUID, mac);
            _saveMacMaps(self._uuidToMacMap, self._macToUuidMap);
            self.renderContactsList();
          } else if (!_isBLEContact(senderUUID)) {
            self._macToUuidMap.set(mac, senderUUID);
            self._uuidToMacMap.set(senderUUID, mac);
            _saveMacMaps(self._uuidToMacMap, self._macToUuidMap);
            _addBLEContact({ deviceUUID: senderUUID, name: senderName, macAddress: mac });
            self.renderContactsList();
          } else {
            var contacts2 = _getBLEContacts();
            var idx2 = contacts2.findIndex(function(c) { return _normId(c.deviceUUID) === _normId(senderUUID); });
            if (idx2 >= 0) {
              contacts2[idx2].online = true;
              contacts2[idx2].lastSeen = Date.now();
              contacts2[idx2].macAddress = mac;
              _saveBLEContacts(contacts2);
              self.renderContactsList();
            }
          }
        }
        if (messageId && self._receivedMessageIds.has(messageId)) {
          self.showToast('Mensaje duplicado ignorado de ' + senderName, 'warning');
          return;
        }
        if (messageId) {
          self._receivedMessageIds.add(messageId);
          if (self._receivedMessageIds.size > self._maxMessageIds) {
            var first = self._receivedMessageIds.values().next().value;
            self._receivedMessageIds.delete(first);
          }
        }
        var stableId = senderUUID || mac;
        _safeDispatchEvent('nexo:ble:messageReceived', {
          deviceId: stableId,
          deviceUUID: senderUUID,
          macAddress: mac,
          content: content,
          senderName: senderName,
          messageId: messageId,
          source: source,
          timestamp: data.timestamp || Date.now()
        });
        var activeUUID = self._activeChatDeviceId;
        if (activeUUID && activeUUID === senderUUID) {
          self.showToast('Mensaje recibido de ' + senderName, 'info');
          return;
        }
        self.showToast('Mensaje nuevo de ' + senderName, 'info');
        self.newDevicesCount++;
        self.updateBadge();
      } catch (e) {
        console.warn('[BLEInterface] Error onPayloadReceived:', e.message);
        self.showToast('Error al recibir mensaje: ' + (e.message || 'desconocido'), 'error');
      }
    });
  }

  _processPendingMessages(deviceMAC) {
    var self = this;
    var macNorm = _normMac(deviceMAC);
    if (!macNorm) {
      this.showToast('Error interno: MAC invalida en cola', 'error');
      return Promise.resolve();
    }
    var queue = this._pendingMessageQueue.get(macNorm);
    if (!queue || queue.length === 0) return Promise.resolve();
    this._pendingMessageQueue.delete(macNorm);
    var failed = 0;
    var processNext = function(idx) {
      if (idx >= queue.length) {
        if (failed > 0) {
          self.showToast(failed + ' mensaje(s) pendiente(s) no se pudieron enviar', 'error');
        }
        return Promise.resolve();
      }
      var item = queue[idx];
      return self._sendMessageNative(macNorm, item.content, item.messageId)
        .then(function() {
          item.resolve();
          return processNext(idx + 1);
        })
        .catch(function(e) {
          failed++;
          item.reject(e);
          return processNext(idx + 1);
        });
    };
    return processNext(0);
  }

  _sendMessageNative(deviceMAC, content, messageId) {
    var self = this;
    self.showToast('[BLE JS] _sendMessageNative: ' + deviceMAC, 'info', 2000);
    return new Promise(function(resolve, reject) {
      try {
        if (!self.nativePlugin) {
          self.showToast('[BLE JS] Plugin no disponible', 'error', 2000);
          reject(new Error('Plugin no disponible'));
          return;
        }
        var macNorm = _normMac(deviceMAC);
        if (!macNorm) {
          self.showToast('MAC invalida', 'error');
          reject(new Error('MAC invalida'));
          return;
        }
        var targetId = _macWithColons(macNorm);

        var isCtrl = _isControlPacket(content);
        var enrichedPayload;
        if (isCtrl) {
          enrichedPayload = content;
        } else {
          enrichedPayload = JSON.stringify({
            deviceUUID: self.localDeviceUUID,
            senderName: self.localDeviceName,
            content: content,
            messageId: messageId || ('msg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9)),
            timestamp: Date.now()
          });
        }

        if (_hasNativeMethod(self.nativePlugin, 'sendMessage')) {
          self.showToast('[BLE JS] Llamando sendMessage nativo...', 'info', 2000);
          _safeNativeCall(self.nativePlugin, 'sendMessage', { deviceId: targetId, message: enrichedPayload })
            .then(function() {
              self.showToast('Mensaje enviado por BLE', 'success');
              resolve();
            })
            .catch(function(e) {
              self.showToast('Fallo al enviar: ' + (e.message || 'Error'), 'error');
              reject(e);
            });
        } else {
          self.showToast('sendMessage no disponible', 'error');
          reject(new Error('sendMessage no disponible'));
        }
      } catch (e) {
        self.showToast('Fallo al enviar: ' + (e.message || 'Error'), 'error');
        reject(e);
      }
    });
  }

  sendChatMessage(deviceUUID, content, messageId) {
    var self = this;
    self.showToast('[BLE JS] sendChatMessage: ' + deviceUUID, 'info', 2000);
    return new Promise(function(resolve, reject) {
      try {
        var uuid = _normId(deviceUUID);
        if (!uuid) {
          self.showToast('Error: ID vacio', 'error');
          reject(new Error('deviceUUID vacio'));
          return;
        }
        if (!content || typeof content !== 'string' || content.trim() === '') {
          self.showToast('Error: Mensaje vacio', 'warning');
          reject(new Error('Mensaje vacio'));
          return;
        }
        var mac = self._uuidToMacMap.get(uuid);
        if (!mac && self._activeChatMAC && self._activeChatDeviceId === uuid) {
          mac = self._activeChatMAC;
        }
        var contact = _getContactByUUID(uuid);
        if (!mac && contact && contact.macAddress) {
          mac = _normMac(contact.macAddress);
        }
        if (!mac) {
          self.foundDevices.forEach(function(d, m) {
            if (!mac && _normId(d.deviceUUID) === uuid) mac = m;
          });
          self.connectedDevices.forEach(function(d, m) {
            if (!mac && _normId(d.deviceUUID) === uuid) mac = m;
          });
        }
        if (!mac) {
          var allContacts = _getBLEContacts();
          for (var i = 0; i < allContacts.length; i++) {
            if (_normId(allContacts[i].deviceUUID) === uuid && allContacts[i].macAddress) {
              mac = _normMac(allContacts[i].macAddress);
              break;
            }
          }
        }
        if (!mac) {
          var loaded = _loadMacMaps();
          if (loaded.uuidToMac[uuid]) {
            mac = _normMac(loaded.uuidToMac[uuid]);
          }
        }
        if (!mac) {
          try {
            var storedMac = localStorage.getItem(BLE_ACTIVE_CHAT_MAC_KEY);
            if (storedMac) mac = _normMac(storedMac);
          } catch (e) {}
        }
        if (!mac) {
          console.error('[BLEInterface] sendChatMessage: No MAC para UUID', uuid);
          self.showToast('[BLE JS] No MAC para UUID', 'error', 4000);
          reject(new Error('Dispositivo no encontrado'));
          return;
        }
        mac = _normMac(mac);
        if (contact && !self._uuidToMacMap.get(uuid)) {
          self._uuidToMacMap.set(uuid, mac);
          self._macToUuidMap.set(mac, uuid);
          _saveMacMaps(self._uuidToMacMap, self._macToUuidMap);
        }
        var state = self._getDeviceState(mac);
        var isReady = state.state === BLE_STATES.READY_TO_CHAT || state.state === BLE_STATES.NOTIFICATIONS_READY;
        var isConnecting = state.state === BLE_STATES.CONNECTING || state.state === BLE_STATES.DISCOVERING_SERVICES;
        function doSend() {
          self._sendMessageNative(mac, content, messageId).then(function() {
            resolve();
          }).catch(function(err) {
            reject(err);
          });
        }
        if (!isReady && !isConnecting && self.nativePlugin && _hasNativeMethod(self.nativePlugin, 'connectToDevice')) {
          self.showToast('[BLE JS] Conectando GATT...', 'info', 2000);
          _safeNativeCall(self.nativePlugin, 'connectToDevice', { deviceId: _macWithColons(mac) })
            .then(function(connResult) {
              if (connResult && (connResult.connected || connResult.alreadyConnected)) {
                return self._waitForReadyToChat(mac, 12000);
              }
              throw new Error('No se pudo conectar');
            })
            .then(function() {
              doSend();
            })
            .catch(function(err) {
              reject(err);
            });
          return;
        }
        if (!isReady && isConnecting) {
          self._waitForReadyToChat(mac, 12000)
            .then(function() {
              doSend();
            })
            .catch(function(err) {
              reject(err);
            });
          return;
        }
        if (!isReady) {
          console.warn('[BLEInterface] Canal no listo para ' + mac + ', intentando envio directo');
          doSend();
          return;
        }
        doSend();
      } catch (fatal) {
        self.showToast('Error critico: ' + (fatal.message || 'desconocido'), 'error', 4000);
        reject(fatal);
      }
    });
  }

  _waitForReadyToChat(mac, timeoutMs) {
    var self = this;
    return new Promise(function(resolve, reject) {
      var macNorm = _normMac(mac);
      if (!macNorm) { reject(new Error('MAC invalida')); return; }
      var state = self._getDeviceState(macNorm);
      if (state.state === BLE_STATES.READY_TO_CHAT || state.state === BLE_STATES.NOTIFICATIONS_READY) {
        resolve();
        return;
      }
      var timer = setTimeout(function() {
        self._readyResolvers.delete(macNorm);
        reject(new Error('Timeout esperando READY_TO_CHAT'));
      }, timeoutMs || 3000);
      self._readyResolvers.set(macNorm, { resolve: resolve, timer: timer });
    });
  }

  _resolveReadyToChat(mac) {
    var macNorm = _normMac(mac);
    if (!macNorm) return;
    var resolver = this._readyResolvers.get(macNorm);
    if (resolver) {
      clearTimeout(resolver.timer);
      resolver.resolve();
      this._readyResolvers.delete(macNorm);
    }
  }

  /* ============================================================
     FIX v5.0.5: openChat() muestra chat via chat-view-active
     ============================================================ */
  openChat(deviceUUID) {
    var self = this;
    self.showToast('[BLE JS] openChat: ' + deviceUUID, 'info', 2000);
    return new Promise(function(resolve, reject) {
      try {
        var uuid = _normId(deviceUUID);
        if (!uuid) {
          self.showToast('[BLE JS] openChat: ID invalido', 'warning', 2000);
          reject(new Error('ID invalido'));
          return;
        }
        var contact = _getContactByUUID(uuid);
        var mac = self._uuidToMacMap.get(uuid) || _normMac(contact && contact.macAddress);
        if (!mac && contact) {
          self.foundDevices.forEach(function(d, m) {
            if (!mac && _normId(d.deviceUUID) === uuid) mac = m;
          });
          self.connectedDevices.forEach(function(d, m) {
            if (!mac && _normId(d.deviceUUID) === uuid) mac = m;
          });
        }
        var displayName = (contact && contact.name) || 'NEXO Peer';
        if (!_isValidMAC(mac)) {
          self.showToast('Dispositivo no disponible', 'warning');
          reject(new Error('MAC invalida'));
          return;
        }
        mac = _normMac(mac);
        self._activeChatDeviceId = uuid;
        self._activeChatMAC = mac;
        try {
          localStorage.setItem(BLE_ACTIVE_CHAT_MAC_KEY, mac);
        } catch (e) {}
        self.newDevicesCount = 0;
        self.updateBadge();
        _saveMacMaps(self._uuidToMacMap, self._macToUuidMap);
        var state = self._getDeviceState(mac);
        var isFullyReady = state.state === BLE_STATES.READY_TO_CHAT || state.state === BLE_STATES.NOTIFICATIONS_READY;
        var isConnecting = state.state === BLE_STATES.CONNECTING || state.state === BLE_STATES.DISCOVERING_SERVICES;
        function finishOpenChat() {
          var appContainer = document.getElementById('app');
          if (appContainer) appContainer.classList.remove('hidden');
          var nameInput = document.getElementById('chat-contact-name');
          var subtitle = document.getElementById('chat-contact-subtitle');
          if (nameInput) nameInput.value = displayName;
          if (subtitle) subtitle.textContent = 'BLUETOOTH';
          _safeDispatchEvent('nexo:ble:openChat', {
            contactId: uuid,
            name: displayName,
            address: mac,
            transport: 'ble',
            source: 'ble_interface'
          });
          /* FIX v5.0.5: Mostrar chat en lugar de togglePanel */
          document.body.classList.add('chat-view-active');
          self.showToast('Chat con ' + displayName + ' listo', 'success');
          resolve();
        }
        if (!isFullyReady && self.nativePlugin && _hasNativeMethod(self.nativePlugin, 'connectToDevice')) {
          self.showToast('[BLE JS] openChat: conectando GATT...', 'info', 2000);
          if (!isConnecting) {
            _safeNativeCall(self.nativePlugin, 'connectToDevice', { deviceId: _macWithColons(mac) })
              .then(function(connResult) {
                if (connResult && (connResult.connected || connResult.alreadyConnected)) {
                  return self._waitForReadyToChat(mac, 15000);
                }
                throw new Error('No se pudo conectar');
              })
              .then(function() {
                finishOpenChat();
              })
              .catch(function(e) {
                self.showToast('Canal aun no listo. Intente enviar en unos segundos.', 'warning');
                finishOpenChat();
              });
          } else {
            self._waitForReadyToChat(mac, 15000)
              .then(function() {
                finishOpenChat();
              })
              .catch(function(e) {
                self.showToast('Canal aun no listo. Intente enviar en unos segundos.', 'warning');
                finishOpenChat();
              });
          }
        } else {
          finishOpenChat();
        }
      } catch (fatalErr) {
        console.error('[BLEInterface] FATAL openChat:', fatalErr);
        self.showToast('Error al abrir chat: ' + (fatalErr.message || 'desconocido'), 'error');
        reject(fatalErr);
      }
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
            return _safeNativeCall(self.nativePlugin, 'isAdvertising', {})
              .then(function(adState) {
                self.isAdvertising = adState && adState.isAdvertising === true;
                self.updateVisibilityButton();
                self._setupNativeAdvertisingListeners();
              });
          } else {
            self.updateVisibilityButton();
            self._setupNativeAdvertisingListeners();
          }
        })
        .catch(function(err) {
          console.error('[BLEInterface] Error consultando estado:', err);
        });
    }
    return Promise.resolve();
  }

  _setupNativeAdvertisingListeners() {
    if (!this.nativePlugin) return;
    if (!_hasNativeMethod(this.nativePlugin, 'addListener')) return;
    var self = this;
    this._nativeAdStartedListener = this.nativePlugin.addListener('onAdvertiseStarted', function() {
      try { self.isAdvertising = true; self.updateVisibilityButton(); self.showToast('[BLE JS] Advertising STARTED', 'success', 2000); } catch (e) {}
    });
    this._nativeAdFailedListener = this.nativePlugin.addListener('onAdvertiseFailed', function() {
      try { self.isAdvertising = false; self.updateVisibilityButton(); self.showToast('[BLE JS] Advertising FAILED', 'error', 3000); } catch (e) {}
    });
  }

  updateVisibilityButton() {
    var btn = this.elements.visibilityBtn;
    if (!btn) return;
    if (this.isAdvertising) {
      btn.classList.add('active');
      btn.style.background = '#0082FC';
      btn.style.color = '#fff';
    } else {
      btn.classList.remove('active');
      btn.style.background = 'rgba(255,255,255,0.1)';
      btn.style.color = '#888';
    }
  }

  updateScanButton() {
    var btn = this.elements.scanBtn;
    if (!btn) return;
    if (this.isScanning) btn.classList.add('scanning');
    else btn.classList.remove('scanning');
  }

  toggleVisibility() {
    var self = this;
    if (self.isDummyMode) return Promise.resolve();
    var permsReady = false;
    if (window.ensureBLEPermissions) {
      return window.ensureBLEPermissions()
        .then(function(result) {
          permsReady = result;
        })
        .catch(function() {
          permsReady = true;
        })
        .then(function() {
          if (!permsReady) {
            self.showToast('Permisos BLE requeridos', 'warning', 5000);
            return Promise.resolve();
          }
          if (!self.nativePlugin) return Promise.resolve();
          var promise;
          if (self.isAdvertising) {
            self.showToast('[BLE JS] Stopping advertising...', 'info', 2000);
            if (_hasNativeMethod(self.nativePlugin, 'stopAdvertising')) {
              promise = _safeNativeCall(self.nativePlugin, 'stopAdvertising', {});
            } else { promise = Promise.resolve(); }
            if (promise) {
              return promise.then(function() {
                self.isAdvertising = false;
                self.updateVisibilityButton();
                self.showToast('[BLE JS] Advertising STOPPED', 'info', 2000);
              });
            }
            self.isAdvertising = false;
          } else {
            self.showToast('[BLE JS] Starting advertising...', 'info', 2000);
            if (_hasNativeMethod(self.nativePlugin, 'startAdvertising')) {
              promise = _safeNativeCall(self.nativePlugin, 'startAdvertising', {});
            } else { promise = Promise.resolve(); }
            if (promise) {
              return promise.then(function() {
                self.isAdvertising = true;
                self.updateVisibilityButton();
                self.showToast('[BLE JS] Advertising STARTED', 'success', 2000);
              });
            }
            self.isAdvertising = true;
          }
          self.updateVisibilityButton();
          return Promise.resolve();
        })
        .catch(function(err) {
          self.showToast('Error: ' + (err.message || 'desconocido'), 'error');
        });
    } else {
      permsReady = true;
    }
    if (!permsReady) {
      self.showToast('Permisos BLE requeridos', 'warning', 5000);
      return Promise.resolve();
    }
    if (!self.nativePlugin) return Promise.resolve();
    var promise;
    if (self.isAdvertising) {
      if (_hasNativeMethod(self.nativePlugin, 'stopAdvertising')) {
        promise = _safeNativeCall(self.nativePlugin, 'stopAdvertising', {});
      }
      if (promise) {
        return promise.then(function() {
          self.isAdvertising = false;
          self.updateVisibilityButton();
        });
      }
      self.isAdvertising = false;
    } else {
      if (_hasNativeMethod(self.nativePlugin, 'startAdvertising')) {
        promise = _safeNativeCall(self.nativePlugin, 'startAdvertising', {});
      }
      if (promise) {
        return promise.then(function() {
          self.isAdvertising = true;
          self.updateVisibilityButton();
        });
      }
      self.isAdvertising = true;
    }
    self.updateVisibilityButton();
    return Promise.resolve();
  }

  createDOM() {
    var tab = document.createElement('div');
    tab.id = 'ble-tab';
    tab.innerHTML = '<div class="ble-tab-icon">BLE</div><div class="ble-tab-badge" id="ble-tab-badge" style="display:none">0</div>';
    document.body.appendChild(tab);
    this.elements.tab = tab;
    var panel = document.createElement('div');
    panel.id = 'ble-panel';
    panel.innerHTML = '<div class="ble-header"> <button id="ble-back" class="ble-btn-back">&larr;</button> <h3>BLE Mesh</h3> <button id="ble-visibility-btn" class="ble-btn-visibility-round"></button> </div> <div class="ble-status-bar"> <span id="ble-status" class="ble-status-offline">OFFLINE</span> </div> <div id="ble-contacts-list" class="ble-contacts-list"> <div class="ble-empty">No hay contactos. Presiona Descubrir para encontrar dispositivos.</div> </div> <div class="ble-bottom-bar"> <div id="ble-new-device" class="ble-new-device" style="display:none"> <span id="ble-new-device-name"></span> <button id="ble-add-btn" class="ble-btn-add-small">+</button> </div> <button id="ble-scan-btn" class="ble-btn-scan-round"></button> </div>';
    document.body.appendChild(panel);
    this.elements.panel = panel;
    var overlay = document.createElement('div');
    overlay.id = 'ble-overlay';
    document.body.appendChild(overlay);
    this.elements.overlay = overlay;
    this.elements.backBtn = document.getElementById('ble-back');
    this.elements.visibilityBtn = document.getElementById('ble-visibility-btn');
    this.elements.scanBtn = document.getElementById('ble-scan-btn');
    this.elements.contactsList = document.getElementById('ble-contacts-list');
    this.elements.status = document.getElementById('ble-status');
    this.elements.newDeviceBar = document.getElementById('ble-new-device');
    this.elements.newDeviceName = document.getElementById('ble-new-device-name');
    this.elements.addBtn = document.getElementById('ble-add-btn');
  }

  injectStyles() {
    if (document.getElementById('ble-styles-v4')) return;
    var style = document.createElement('style');
    style.id = 'ble-styles-v4';
    style.textContent = "#ble-tab { position: fixed; left: 0; top: 50%; transform: translateY(-50%); width: 44px; height: 100px; background: #0082FC; border-radius: 0 12px 12px 0; display: flex; flex-direction: column; align-items: center; justify-content: center; cursor: pointer; z-index: 2147483644; color: #fff; font-weight: bold; } .ble-tab-badge { position: absolute; top: 5px; right: -5px; background: #ff4444; color: white; width: 18px; height: 18px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 10px; animation: pulse 2s infinite; } @keyframes pulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.1); } } #ble-panel { position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: #000000; transform: translateX(-100%); transition: transform 0.3s ease; z-index: 2147483645; color: #fff; display: flex; flex-direction: column; } #ble-panel.active { transform: translateX(0); } #ble-overlay { position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.6); display: none; z-index: 2147483644; backdrop-filter: blur(4px); } #ble-overlay.active { display: block; } .ble-header { display: flex; align-items: center; justify-content: space-between; padding: 16px 20px; border-bottom: 1px solid #333; } .ble-header h3 { margin: 0; font-size: 18px; color: #fff; flex: 1; text-align: center; } .ble-btn-back { background: none; border: none; color: #4169E1; font-size: 24px; cursor: pointer; padding: 0; width: 40px; height: 40px; display: flex; align-items: center; justify-content: center; } .ble-btn-visibility-round { width: 44px; height: 44px; border-radius: 50%; border: 2px solid #4169E1; background: rgba(255,255,255,0.1); color: #888; cursor: pointer; font-size: 12px; display: flex; align-items: center; justify-content: center; transition: all 0.3s; } .ble-btn-visibility-round.active { background: #4169E1; color: #000; border-color: #4169E1; box-shadow: 0 0 12px rgba(65,105,225,0.4); } .ble-btn-visibility-round::before { content: 'EYE'; font-size: 10px; font-weight: bold; } .ble-status-bar { padding: 8px 20px; } .ble-status-offline { font-size: 12px; color: #888; } .ble-status-online { font-size: 12px; color: #4169E1; } .ble-status-scanning { font-size: 12px; color: #ffaa00; animation: blink 1s infinite; } @keyframes blink { 0%,50% { opacity: 1; } 51%,100% { opacity: 0.7; } } .ble-contacts-list { flex: 1; overflow-y: auto; padding: 0 20px; } .ble-contact-item { display: flex; align-items: center; justify-content: space-between; padding: 14px 16px; background: rgba(255,255,255,0.05); border: 1px solid #333; border-radius: 12px; margin-bottom: 10px; cursor: pointer; transition: all 0.2s; } .ble-contact-item:hover { background: rgba(65,105,225,0.1); border-color: #4169E1; } .ble-contact-item.online { border-left: 3px solid #4169E1; } .ble-contact-item.offline { border-left: 3px solid #666; } .ble-contact-info { display: flex; flex-direction: column; flex: 1; min-width: 0; } .ble-contact-name { font-weight: 600; font-size: 15px; color: #fff; } .ble-contact-status { font-size: 11px; color: #888; margin-top: 2px; } .ble-contact-actions { display: flex; gap: 8px; } .ble-btn-chat { padding: 8px 16px; background: #4169E1; color: #000; border: none; border-radius: 8px; cursor: pointer; font-size: 12px; font-weight: bold; } .ble-btn-remove { padding: 8px 12px; background: #ff4444; color: #fff; border: none; border-radius: 8px; cursor: pointer; font-size: 12px; } .ble-empty { text-align: center; color: #666; padding: 40px 20px; font-style: italic; } .ble-bottom-bar { display: flex; align-items: center; justify-content: space-between; padding: 16px 20px; border-top: 1px solid #333; gap: 12px; } .ble-new-device { display: flex; align-items: center; gap: 10px; flex: 1; background: rgba(65,105,225,0.1); border: 1px solid #4169E1; border-radius: 12px; padding: 10px 14px; } .ble-new-device span { color: #fff; font-size: 14px; flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; } .ble-btn-add-small { width: 36px; height: 36px; border-radius: 50%; background: #4169E1; color: #000; border: none; font-size: 20px; font-weight: bold; cursor: pointer; display: flex; align-items: center; justify-content: center; flex-shrink: 0; } .ble-btn-scan-round { width: 56px; height: 56px; border-radius: 50%; background: linear-gradient(135deg, #4169E1, #191970); color: #000; border: none; font-size: 14px; font-weight: bold; cursor: pointer; display: flex; align-items: center; justify-content: center; flex-shrink: 0; box-shadow: 0 4px 15px rgba(65,105,255,0.3); transition: all 0.3s; } .ble-btn-scan-round.scanning { background: linear-gradient(135deg, #ff4444, #cc0000); color: #fff; animation: pulse-red 1.5s infinite; } .ble-btn-scan-round.scanning::before { content: 'STOP'; } .ble-btn-scan-round::before { content: 'SCAN'; font-size: 10px; } @keyframes pulse-red { 0%,100% { box-shadow: 0 0 0 0 rgba(255,68,68,0.4); } 50% { box-shadow: 0 0 0 10px rgba(255,68,68,0); } } .ble-toast { position: fixed; bottom: 100px; left: 50%; transform: translateX(-50%); padding: 12px 24px; border-radius: 8px; color: #fff; font-weight: bold; z-index: 2147483646; animation: fadeInUp 0.3s ease; } .ble-toast.success { background: #4169E1; color: #000; } .ble-toast.error { background: #ff4444; } .ble-toast.warning { background: #ffaa00; color: #000; } .ble-toast.info { background: #444; } @keyframes fadeInUp { from { opacity: 0; transform: translateX(-50%) translateY(20px); } to { opacity: 1; transform: translateX(-50%) translateY(0); } }";
    document.head.appendChild(style);
  }

  setupEventListeners() {
    var self = this;
    this.elements.tab.addEventListener('click', function() { self.togglePanel(); });
    this.elements.backBtn.addEventListener('click', function() { self.togglePanel(); });
    this.elements.overlay.addEventListener('click', function() { self.togglePanel(); });
    this.elements.visibilityBtn.addEventListener('click', function() { self.toggleVisibility(); });
    this.elements.scanBtn.addEventListener('click', function() { self.toggleScan(); });
    this.elements.addBtn.addEventListener('click', function() { self._addNewDevice(); });
    window.addEventListener('nexo:ble:closeChat', function() {
      var tab = document.getElementById('ble-tab');
      if (tab) tab.style.display = '';
      self._activeChatDeviceId = null;
      self._activeChatMAC = null;
      try { localStorage.removeItem(BLE_ACTIVE_CHAT_MAC_KEY); } catch(e) {}
      self.updateBadge();
    });
    window.addEventListener('nexo:ble:openChat', function() {
      var tab = document.getElementById('ble-tab');
      if (tab) tab.style.display = 'none';
    });
  }

  /* ============================================================
     FIX v5.0.5: togglePanel() cierra chat si esta abierto
     ============================================================ */
  togglePanel() {
    this.elements.panel.classList.toggle('active');
    this.elements.overlay.classList.toggle('active');
    if (this.elements.panel.classList.contains('active')) {
      this.newDevicesCount = 0;
      this.updateBadge();
      this.renderContactsList();
    } else {
      /* FIX v5.0.5: Al cerrar panel, salir del chat tambien */
      document.body.classList.remove('chat-view-active');
    }
  }

  toggleScan() {
    var self = this;
    if (self.isDummyMode) return Promise.resolve();
    var permsReady = false;
    if (window.ensureBLEPermissions) {
      return window.ensureBLEPermissions()
        .then(function(result) {
          permsReady = result;
        })
        .catch(function() {
          permsReady = true;
        })
        .then(function() {
          if (!permsReady) {
            self.showToast('Permisos BLE requeridos', 'warning', 5000);
            return Promise.resolve();
          }
          if (self.isScanning) {
            self.showToast('[BLE JS] Stopping scan...', 'info', 2000);
            if (_hasNativeMethod(self.nativePlugin, 'stopScan')) {
              return _safeNativeCall(self.nativePlugin, 'stopScan', {})
                .then(function() {
                  self.isScanning = false;
                  self.updateScanButton();
                  self.updateStatus();
                  self.showToast('[BLE JS] Scan STOPPED', 'info', 2000);
                });
            }
            self.isScanning = false;
            self.updateScanButton();
            self.updateStatus();
            return Promise.resolve();
          } else {
            self.showToast('[BLE JS] Starting scan...', 'info', 2000);
            self.foundDevices.clear();
            self._renderedDeviceIds.clear();
            self.renderContactsList();
            self.renderNewDeviceBar();
            if (_hasNativeMethod(self.nativePlugin, 'startScan')) {
              return _safeNativeCall(self.nativePlugin, 'startScan', {})
                .then(function() {
                  self.isScanning = true;
                  self.updateScanButton();
                  self.elements.status.textContent = 'ESCANEANDO...';
                  self.elements.status.className = 'ble-status-scanning';
                  self.showToast('[BLE JS] Scan STARTED', 'success', 2000);
                });
            }
            self.isScanning = true;
            self.updateScanButton();
            self.elements.status.textContent = 'ESCANEANDO...';
            self.elements.status.className = 'ble-status-scanning';
            return Promise.resolve();
          }
        })
        .catch(function(err) {
          self.isScanning = false;
          self.updateScanButton();
        });
    } else {
      permsReady = true;
    }
    if (!permsReady) {
      self.showToast('Permisos BLE requeridos', 'warning', 5000);
      return Promise.resolve();
    }
    if (self.isScanning) {
      if (_hasNativeMethod(self.nativePlugin, 'stopScan')) {
        return _safeNativeCall(self.nativePlugin, 'stopScan', {})
          .then(function() {
            self.isScanning = false;
            self.updateScanButton();
            self.updateStatus();
          });
      }
      self.isScanning = false;
      self.updateScanButton();
      self.updateStatus();
    } else {
      self.foundDevices.clear();
      self._renderedDeviceIds.clear();
      self.renderContactsList();
      self.renderNewDeviceBar();
      if (_hasNativeMethod(self.nativePlugin, 'startScan')) {
        return _safeNativeCall(self.nativePlugin, 'startScan', {})
          .then(function() {
            self.isScanning = true;
            self.updateScanButton();
            self.elements.status.textContent = 'ESCANEANDO...';
            self.elements.status.className = 'ble-status-scanning';
          });
      }
      self.isScanning = true;
      self.updateScanButton();
      self.elements.status.textContent = 'ESCANEANDO...';
      self.elements.status.className = 'ble-status-scanning';
    }
    return Promise.resolve();
  }

  onDeviceFound(device) {
    var mac = _normMac(device.id || device.address);
    this.showToast('[BLE JS] onDeviceFound: ' + (device.name || 'Unknown') + ' mac=' + mac, 'info', 2000);
    if (!mac) return;
    if (this.localDeviceAddress && mac === this.localDeviceAddress) return;
    var knownUUID = this._macToUuidMap.get(mac);
    if (knownUUID && _isBLEContact(knownUUID)) {
      var contacts = _getBLEContacts();
      var idx = contacts.findIndex(function(c) { return _normId(c.deviceUUID) === _normId(knownUUID); });
      if (idx >= 0) {
        contacts[idx].online = true;
        contacts[idx].lastSeen = Date.now();
        contacts[idx].macAddress = mac;
        _saveBLEContacts(contacts);
      }
      this.renderContactsList();
      return;
    }
    if (this.foundDevices.has(mac)) {
      var existing = this.foundDevices.get(mac);
      existing.rssi = device.rssi;
      existing.name = device.name || existing.name;
      existing.lastSeen = Date.now();
      this.foundDevices.set(mac, existing);
      this.renderNewDeviceBar();
      return;
    }
    device.lastSeen = Date.now();
    this.foundDevices.set(mac, device);
    this.newDevicesCount++;
    this.updateBadge();
    this.renderNewDeviceBar();
  }

  renderContactsList() {
    var self = this;
    var list = this.elements.contactsList;
    if (!list) return;
    list.innerHTML = '';
    var contacts = _getBLEContacts();
    if (contacts.length === 0) {
      list.innerHTML = '<div class="ble-empty">No hay contactos. Presiona Descubrir para encontrar dispositivos.</div>';
      return;
    }
    contacts.forEach(function(contact) {
      var uuid = _normId(contact.deviceUUID);
      var mac = self._uuidToMacMap.get(uuid) || _normMac(contact.macAddress);
      var isOnline = contact.online && (Date.now() - (contact.lastSeen || 0)) < 60000;
      var item = document.createElement('div');
      item.className = 'ble-contact-item ' + (isOnline ? 'online' : 'offline');
      var infoDiv = document.createElement('div');
      infoDiv.className = 'ble-contact-info';
      infoDiv.innerHTML = '<div class="ble-contact-name">' + (contact.name || 'NEXO Peer') + '</div><div class="ble-contact-status">' + (isOnline ? 'En linea' : 'Offline') + '</div>';
      item.appendChild(infoDiv);
      var actionsDiv = document.createElement('div');
      actionsDiv.className = 'ble-contact-actions';
      var chatBtn = document.createElement('button');
      chatBtn.className = 'ble-btn-chat';
      chatBtn.textContent = 'Chat';
      chatBtn.addEventListener('click', function() { self.openChat(uuid); });
      actionsDiv.appendChild(chatBtn);
      var removeBtn = document.createElement('button');
      removeBtn.className = 'ble-btn-remove';
      removeBtn.textContent = 'X';
      removeBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        self.removeContact(uuid);
      });
      actionsDiv.appendChild(removeBtn);
      item.appendChild(actionsDiv);
      list.appendChild(item);
    });
  }

  renderNewDeviceBar() {
    var bar = this.elements.newDeviceBar;
    var nameSpan = this.elements.newDeviceName;
    var newDevice = null;
    var newMac = null;
    this.foundDevices.forEach(function(device, mac) {
      var uuid = device.deviceUUID || this._macToUuidMap.get(mac);
      if (!uuid || !_isBLEContact(uuid)) {
        newDevice = device;
        newMac = mac;
      }
    }.bind(this));
    if (newDevice && newMac) {
      nameSpan.textContent = newDevice.name || 'NEXO Device';
      bar.style.display = 'flex';
      bar.dataset.mac = newMac;
    } else {
      bar.style.display = 'none';
      bar.dataset.mac = '';
    }
  }

  _addNewDevice() {
    this.showToast('[BLE JS] _addNewDevice iniciado', 'info', 2000);
    var bar = this.elements.newDeviceBar;
    var mac = _normMac(bar.dataset.mac);
    if (!mac) { this.showToast('[BLE JS] AddNewDevice: MAC invalida', 'error', 2000); return; }
    var device = this.foundDevices.get(mac);
    if (!device) { this.showToast('[BLE JS] AddNewDevice: device not found', 'error', 2000); return; }
    var name = device.name || 'NEXO Peer';
    var existingUUID = this._macToUuidMap.get(mac);
    var existingContact = existingUUID ? _getContactByUUID(existingUUID) : null;
    if (existingContact) {
      this.showToast('Contacto ya existe: ' + existingContact.name, 'warning', 2000);
      existingContact.online = true;
      existingContact.lastSeen = Date.now();
      existingContact.macAddress = mac;
      var contacts = _getBLEContacts();
      var idx = contacts.findIndex(function(c) { return _normId(c.deviceUUID) === _normId(existingUUID); });
      if (idx >= 0) {
        contacts[idx] = existingContact;
        _saveBLEContacts(contacts);
      }
      try { localStorage.setItem(BLE_ACTIVE_CHAT_MAC_KEY, mac); } catch (e) {}
      this._autoConnectGATT(mac, device);
      this.foundDevices.delete(mac);
      this.renderContactsList();
      this.renderNewDeviceBar();
      return;
    }
    var tempUUID = 'mac-' + mac;
    this._macToUuidMap.set(mac, tempUUID);
    this._uuidToMacMap.set(tempUUID, mac);
    _saveMacMaps(this._uuidToMacMap, this._macToUuidMap);
    _addBLEContact({ deviceUUID: tempUUID, name: name, macAddress: mac });
    try {
      localStorage.setItem(BLE_ACTIVE_CHAT_MAC_KEY, mac);
    } catch (e) {}
    this._autoConnectGATT(mac, device);
    this.foundDevices.delete(mac);
    this.renderContactsList();
    this.renderNewDeviceBar();
    this.showToast('Agregado: ' + name, 'success');
  }

  _autoConnectGATT(mac, device) {
    var self = this;
    self.showToast('[BLE JS] AutoConnectGATT: ' + mac, 'info', 2000);
    if (!self.nativePlugin || !_hasNativeMethod(self.nativePlugin, 'connectToDevice')) {
      self.showToast('[BLE JS] AutoConnect: plugin sin connectToDevice', 'error', 2000);
      console.warn('[BLEInterface] Plugin no tiene connectToDevice');
      return Promise.resolve();
    }
    var macNorm = _normMac(mac);
    if (!macNorm) return Promise.resolve();
    var state = self._getDeviceState(macNorm);
    if (state.state === BLE_STATES.READY_TO_CHAT || state.state === BLE_STATES.NOTIFICATIONS_READY || state.state === BLE_STATES.CONNECTING) {
      return Promise.resolve();
    }
    self._setDeviceState(macNorm, BLE_STATES.CONNECTING, { direction: 'outgoing', role: 'client', auto: true });
    self.connectedDevices.set(macNorm, {
      id: macNorm, address: macNorm, name: (device && device.name) || 'NEXO Peer',
      direction: 'outgoing', servicesReady: false, deviceUUID: self._macToUuidMap.get(macNorm)
    });
    console.log('[BLEInterface] Auto-connect GATT a', macNorm);
    return _safeNativeCall(self.nativePlugin, 'connectToDevice', { deviceId: _macWithColons(macNorm) })
      .then(function(result) {
        self.showToast('[BLE JS] AutoConnect result: ' + JSON.stringify(result), 'info', 2000);
        console.log('[BLEInterface] Auto-connect resultado:', result);
        if (result && (result.connected || result.alreadyConnected)) {
          return self._waitForReadyToChat(macNorm, 8000)
            .then(function() {
              console.log('[BLEInterface] Auto-connect exitoso para', macNorm);
            });
        } else {
          self._setDeviceState(macNorm, BLE_STATES.DISCONNECTED);
        }
      })
      .catch(function(e) {
        self.showToast('[BLE JS] AutoConnect FAILED: ' + e.message, 'error', 3000);
        console.warn('[BLEInterface] Auto-connect GATT fallo:', e.message);
        self._setDeviceState(macNorm, BLE_STATES.DISCONNECTED);
      });
  }

  removeContact(deviceUUID) {
    try {
      _removeBLEContact(deviceUUID);
      this.showToast('Eliminado', 'info');
      this.renderContactsList();
      this.renderNewDeviceBar();
    } catch (e) {
      this.showToast('Error al eliminar: ' + (e.message || 'desconocido'), 'error');
    }
  }

  disconnect(deviceMAC) {
    var self = this;
    if (self.isDummyMode) return Promise.resolve();
    var macNorm = _normMac(deviceMAC);
    if (!macNorm) return Promise.resolve();
    if (_hasNativeMethod(self.nativePlugin, 'disconnectDevice')) {
      return _safeNativeCall(self.nativePlugin, 'disconnectDevice', { deviceId: _macWithColons(macNorm) })
        .then(function() {
          var uuid = self._macToUuidMap.get(macNorm);
          if (self._activeChatDeviceId === uuid || self._activeChatMAC === macNorm) {
            self._activeChatDeviceId = null;
            self._activeChatMAC = null;
            try { localStorage.removeItem(BLE_ACTIVE_CHAT_MAC_KEY); } catch(e) {}
            self.updateBadge();
          }
        })
        .catch(function(err) {
          self.showToast('Error al desconectar: ' + (err.message || 'desconocido'), 'error');
        });
    }
    return Promise.resolve();
  }

  updateBadge() {
    var badge = document.getElementById('ble-tab-badge');
    if (!badge) return;
    if (this._activeChat
    return Promise.resolve();
  }

  updateBadge() {
    var badge = document.getElementById('ble-tab-badge');
    if (!badge) return;
    if (this._activeChatDeviceId) {
      badge.style.display = 'none';
      return;
    }
    if (this.newDevicesCount > 0) {
      badge.textContent = this.newDevicesCount;
      badge.style.display = 'flex';
    } else {
      badge.style.display = 'none';
    }
  }

  updateStatus(customStatus) {
    var self = this;
    if (!self.elements.status) return Promise.resolve();
    if (customStatus) {
      self.elements.status.textContent = customStatus;
      self.elements.status.className = 'ble-status-offline';
      return Promise.resolve();
    }
    if (self.isDummyMode) {
      self.elements.status.textContent = 'OFFLINE (Dummy)';
      self.elements.status.className = 'ble-status-offline';
      return Promise.resolve();
    }
    if (self.nativePlugin && _hasNativeMethod(self.nativePlugin, 'isBluetoothEnabled')) {
      return _safeNativeCall(self.nativePlugin, 'isBluetoothEnabled', {})
        .then(function(state) {
          if (state && state.enabled) {
            self.elements.status.textContent = 'ONLINE';
            self.elements.status.className = 'ble-status-online';
          } else {
            self.elements.status.textContent = 'OFFLINE';
            self.elements.status.className = 'ble-status-offline';
          }
        })
        .catch(function(err) {
          console.error('[BLEInterface] Error consultando estado:', err);
          self.elements.status.textContent = 'ERROR';
          self.elements.status.className = 'ble-status-offline';
        });
    }
    self.elements.status.textContent = 'OFFLINE';
    self.elements.status.className = 'ble-status-offline';
    return Promise.resolve();
  }

  showToast(message, type, duration) {
    type = type || 'info';
    duration = duration || 3000;
    var toast = document.createElement('div');
    toast.className = 'ble-toast ' + type;
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(function() {
      if (toast.parentNode) toast.parentNode.removeChild(toast);
    }, duration);
  }
}
