/**
 * BLE Interface v4.2.4-ANTI-CRASH
 * Interfaz con plugin nativo Capacitor NexoBLE
 */

export function initBLEInterface(bleMesh) {
  var instance = new BLEInterface(bleMesh).init();
  window.bleInterface = instance;
  return instance;
}

var BLE_CONTACTS_STORAGE_KEY = 'nexo_ble_contacts_v3';
var BLE_UUID_STORAGE_KEY = 'nexo_device_uuid';
var BLE_MAC_CACHE_KEY = 'nexo_mac_cache';

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

function _normMAC(mac) {
  if (!mac) return '';
  return mac.toString().toLowerCase().trim().replace(/[^0-9a-f]/g, '');
}

function _formatMAC(mac) {
  var norm = _normMAC(mac);
  if (norm.length !== 12) return mac;
  return norm.match(/.{2}/g).join(':');
}

function _getBLEContacts() {
  try {
    var raw = localStorage.getItem(BLE_CONTACTS_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) { return []; }
}

function _saveBLEContacts(contacts) {
  localStorage.setItem(BLE_CONTACTS_STORAGE_KEY, JSON.stringify(contacts));
}

function _getMACCache() {
  try {
    var raw = localStorage.getItem(BLE_MAC_CACHE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (e) { return {}; }
}

function _saveMACCache(cache) {
  localStorage.setItem(BLE_MAC_CACHE_KEY, JSON.stringify(cache));
}

function _findContactByMACOrName(mac, name) {
  var contacts = _getBLEContacts();
  var normMac = _normMAC(mac);
  var normName = _normId(name);
  
  if (normMac) {
    var byMac = contacts.find(function(c) {
      return _normMAC(c.macAddress) === normMac;
    });
    if (byMac) return byMac;
  }
  
  if (normName && normName !== 'nexo peer' && normName !== 'nexo device') {
    var byName = contacts.find(function(c) {
      return _normId(c.name) === normName;
    });
    if (byName) return byName;
  }
  
  if (normName && normName.length > 3 && 
      normName !== 'nexo peer' && normName !== 'nexo device') {
    var byFuzzy = contacts.find(function(c) {
      var cname = _normId(c.name);
      return cname.includes(normName) || normName.includes(cname);
    });
    if (byFuzzy) return byFuzzy;
  }
  
  return null;
}

function _getContactByMAC(mac) {
  var normMac = _normMAC(mac);
  if (!normMac) return null;
  return _getBLEContacts().find(function(c) {
    return _normMAC(c.macAddress) === normMac;
  });
}

function _getContactByUUID(deviceUUID) {
  var uuid = _normId(deviceUUID);
  return _getBLEContacts().find(function(c) {
    return _normId(c.deviceUUID) === uuid;
  });
}

function _addBLEContact(contact) {
  var contacts = _getBLEContacts();
  var mac = _normMAC(contact.macAddress);
  var name = (contact.name || 'NEXO Peer').trim();
  var uuid = contact.deviceUUID || _generateUUID();
  
  if (!mac) {
    console.warn('[BLEInterface] No MAC provided for contact');
    return false;
  }
  
  var existingIdx = contacts.findIndex(function(c) {
    return _normMAC(c.macAddress) === mac;
  });
  
  if (existingIdx >= 0) {
    contacts[existingIdx].name = name || contacts[existingIdx].name || 'NEXO Peer';
    contacts[existingIdx].deviceUUID = uuid;
    contacts[existingIdx].lastSeen = Date.now();
    contacts[existingIdx].online = true;
    contacts[existingIdx].macAddress = _formatMAC(mac);
    _saveBLEContacts(contacts);
    return { updated: true, contact: contacts[existingIdx] };
  }
  
  var newContact = {
    deviceUUID: uuid,
    name: name,
    macAddress: _formatMAC(mac),
    addedAt: Date.now(),
    lastSeen: Date.now(),
    online: true
  };
  contacts.push(newContact);
  _saveBLEContacts(contacts);
  return { updated: false, contact: newContact };
}

function _updateContactMAC(oldMAC, newMAC, name) {
  var contacts = _getBLEContacts();
  var oldNorm = _normMAC(oldMAC);
  var newNorm = _normMAC(newMAC);
  
  var idx = contacts.findIndex(function(c) {
    return _normMAC(c.macAddress) === oldNorm;
  });
  
  if (idx >= 0) {
    contacts[idx].macAddress = _formatMAC(newMAC);
    contacts[idx].lastSeen = Date.now();
    contacts[idx].online = true;
    if (name) contacts[idx].name = name;
    _saveBLEContacts(contacts);
    
    var cache = _getMACCache();
    cache[newNorm] = { oldMAC: oldNorm, updatedAt: Date.now() };
    _saveMACCache(cache);
    
    return true;
  }
  return false;
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

var BLE_STATES = {
  DISCONNECTED: 'disconnected',
  CONNECTING: 'connecting',
  DISCOVERING_SERVICES: 'discovering_services',
  NOTIFICATIONS_READY: 'notifications_ready',
  READY_TO_CHAT: 'ready_to_chat',
  CONNECTED: 'connected',
  ERROR: 'error',
  RECONNECTING: 'reconnecting'
};

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
    this.nativePlugin = null;
    if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.NexoBLE) {
      this.nativePlugin = window.Capacitor.Plugins.NexoBLE;
    }
    this.isDummyMode = !bleMesh && !this.nativePlugin;
    this.meshType = this._detectMeshType();
    this.isAdvertising = false;
    this.canAdvertise = false;
    this.localDeviceName = 'NEXO Device';
    this.localDeviceAddress = null;
    this.localDeviceUUID = _getDeviceUUID();
    this._isOpeningChat = false;
    this._activeChatDeviceId = null;
    this._activeChatMAC = null;
    this._deviceStates = new Map();
    this._receivedMessageIds = new Set();
    this._maxMessageIds = 1000;
    this._pendingMessageQueue = new Map();
    this._reconnectTimers = new Map();
    this._serverReady = false;
    this._macToUuidMap = new Map();
    this._uuidToMacMap = new Map();
    this._pendingAdds = new Map();
    this._messageQueue = new Map();
    this._sendRetryCount = new Map();
    this._macChangeDetection = new Map();
    this._waitTimers = new Map();
  }

  _detectMeshType() {
    if (!this.bleMesh) return 'none';
    if (typeof this.bleMesh.getState === 'function') return 'nordic';
    if (typeof this.bleMesh.getStatus === 'function') return 'hybrid';
    return 'unknown';
  }

  init() {
    this.createDOM();
    this.injectStyles();
    this.setupEventListeners();
    if (!this.nativePlugin) {
      if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.NexoBLE) {
        this.nativePlugin = window.Capacitor.Plugins.NexoBLE;
      }
      if (this.nativePlugin) this.isDummyMode = !this.bleMesh && !this.nativePlugin;
    }
    if (this.isDummyMode) {
      this.updateStatus('OFFLINE (Dummy)');
    } else {
      this.updateStatus();
      this._initVisibility();
      this._setupNativeScanListeners();
      this._setupNativeConnectionListeners();
      this._setupNativePayloadListener();
      this._setupNativeStateListeners();
      this._setupNativeServerReadyListener();
      this._loadLocalDeviceInfo();
      this._autoStartAdvertising();
      this._loadExistingContacts();
    }
    console.log('[BLEInterface] UUID local:', this.localDeviceUUID);
    return this;
  }

  _loadExistingContacts() {
    var contacts = _getBLEContacts();
    var self = this;
    contacts.forEach(function(c) {
      if (c.macAddress) {
        var mac = _normMAC(c.macAddress);
        self._macToUuidMap.set(mac, c.deviceUUID);
        self._uuidToMacMap.set(c.deviceUUID, mac);
      }
    });
  }

  async _autoStartAdvertising() {
    if (this.isDummyMode || !this.nativePlugin) return;
    try {
      var btState = await this.nativePlugin.isBluetoothEnabled();
      if (btState && btState.canAdvertise) {
        await this.nativePlugin.startAdvertising();
        this.isAdvertising = true;
        this.updateVisibilityButton();
      }
    } catch (e) {
      console.warn('[BLEInterface] Auto-advertise fallo:', e.message || e);
    }
  }

  async _loadLocalDeviceInfo() {
    if (!this.nativePlugin) return;
    if (typeof this.nativePlugin.getLocalDeviceInfo !== 'function') return;
    try {
      var info = await this.nativePlugin.getLocalDeviceInfo();
      if (info) {
        this.localDeviceName = info.deviceName || 'NEXO Device';
        this.localDeviceAddress = _normMAC(info.deviceAddress || '');
      }
    } catch (e) {}
  }

  _setupNativeScanListeners() {
    if (!this.nativePlugin) return;
    if (this._nativeDeviceFoundListener && typeof this._nativeDeviceFoundListener.remove === 'function') {
      this._nativeDeviceFoundListener.remove();
    }
    if (this._nativeScanFailedListener && typeof this._nativeScanFailedListener.remove === 'function') {
      this._nativeScanFailedListener.remove();
    }
    var self = this;
    this._nativeDeviceFoundListener = this.nativePlugin.addListener('onDeviceFound', function(data) {
      var mac = _normMAC(data.deviceId);
      var name = data.name || 'NEXO Device';
      var rssi = data.rssi || -100;
      
      var existingContact = _findContactByMACOrName(mac, name);
      if (existingContact && _normMAC(existingContact.macAddress) !== mac) {
        var oldMAC = existingContact.macAddress;
        _updateContactMAC(oldMAC, mac, name);
        self._macToUuidMap.delete(_normMAC(oldMAC));
        self._macToUuidMap.set(mac, existingContact.deviceUUID);
        self._uuidToMacMap.set(existingContact.deviceUUID, mac);
        console.log('[BLEInterface] MAC actualizada:', oldMAC, '->', mac);
      }
      
      self.onDeviceFound({ id: mac, address: mac, name: name, rssi: rssi });
    });
    this._nativeScanFailedListener = this.nativePlugin.addListener('onScanFailed', function(data) {
      self.isScanning = false;
      self.updateScanButton();
      self.showToast('Error al escanear', 'error');
    });
  }

  _setupNativeServerReadyListener() {
    if (!this.nativePlugin) return;
    if (this._nativeServerReadyListener && typeof this._nativeServerReadyListener.remove === 'function') {
      this._nativeServerReadyListener.remove();
    }
    var self = this;
    this._nativeServerReadyListener = this.nativePlugin.addListener('onServerReady', function(data) {
      console.log('[BLEInterface] onServerReady recibido:', data);
      self._serverReady = true;
    });
  }

  _setupNativeConnectionListeners() {
    if (!this.nativePlugin) return;
    if (this._nativeDeviceConnectedListener && typeof this._nativeDeviceConnectedListener.remove === 'function') {
      this._nativeDeviceConnectedListener.remove();
    }
    if (this._nativeDeviceDisconnectedListener && typeof this._nativeDeviceDisconnectedListener.remove === 'function') {
      this._nativeDeviceDisconnectedListener.remove();
    }
    var self = this;

    this._nativeDeviceConnectedListener = this.nativePlugin.addListener('onDeviceConnected', function(data) {
      var mac = _normMAC(data.deviceId);
      var attempt = data.attempt || 0;
      self._cancelReconnect(mac);
      
      var peerUUID = self._macToUuidMap.get(mac);
      var contact = peerUUID ? _getContactByUUID(peerUUID) : null;
      var displayName = data.name || (contact && contact.name) || 'NEXO Peer';
      
      if (data.direction === 'incoming') {
        self._setDeviceState(mac, BLE_STATES.READY_TO_CHAT, { direction: 'incoming', role: 'peer_connected', deviceUUID: peerUUID });
        self.connectedDevices.set(mac, { id: mac, address: mac, name: displayName, direction: 'incoming', servicesReady: true, deviceUUID: peerUUID });
      } else {
        self._setDeviceState(mac, BLE_STATES.CONNECTING, { direction: 'outgoing', attempt: attempt, role: 'client', deviceUUID: peerUUID });
        self.connectedDevices.set(mac, { id: mac, address: mac, name: displayName, direction: 'outgoing', servicesReady: false, deviceUUID: peerUUID });
      }
      
      self._processPendingAdd(mac);
      self._drainMessageQueue(mac);
    });

    this._nativeDeviceDisconnectedListener = this.nativePlugin.addListener('onDeviceDisconnected', function(data) {
      var mac = _normMAC(data.deviceId);
      self._setDeviceState(mac, BLE_STATES.DISCONNECTED);
      self.connectedDevices.delete(mac);
      if (self._activeChatMAC === mac) {
        self._startReconnect(mac);
      }
    });
  }

  async _processPendingAdd(mac) {
    var pending = this._pendingAdds.get(mac);
    if (!pending) return;
    this._pendingAdds.delete(mac);
    
    try {
      await this._waitForReadyToChat(mac, 10000);
      
      var uuid = this._macToUuidMap.get(mac);
      if (!uuid) {
        uuid = 'mac-' + mac;
        this._macToUuidMap.set(mac, uuid);
        this._uuidToMacMap.set(uuid, mac);
      }
      
      var contactName = pending.name || 'NEXO Peer';
      var result = _addBLEContact({ deviceUUID: uuid, name: contactName, macAddress: mac });
      
      this.showToast('Agregado: ' + contactName, 'success');
      this.renderContactsList();
      this.renderNewDeviceBar();
    } catch (e) {
      console.warn('[BLEInterface] Pending add fallo:', e.message || e);
      this.showToast('No se pudo agregar contacto', 'warning');
    }
  }

  async _waitForReadyToChat(mac, timeoutMs) {
    var self = this;
    return new Promise(function(resolve, reject) {
      var normMac = _normMAC(mac);
      var timer = setTimeout(function() { 
        self._waitTimers.delete(normMac);
        reject(new Error('Timeout')); 
      }, timeoutMs);
      self._waitTimers.set(normMac, timer);
      
      var check = function() {
        var s = self._getDeviceState(mac);
        if (s.state === BLE_STATES.READY_TO_CHAT || s.state === BLE_STATES.NOTIFICATIONS_READY || s.state === BLE_STATES.CONNECTED) {
          clearTimeout(timer);
          self._waitTimers.delete(normMac);
          resolve();
        } else {
          setTimeout(check, 300);
        }
      };
      check();
    });
  }

  async _connectToDevice(mac) {
    if (!this.nativePlugin) {
      console.warn('[BLEInterface] Plugin BLE no disponible');
      return false;
    }
    
    var normMac = _normMAC(mac);
    
    var currentState = this._getDeviceState(normMac);
    if (currentState.state === BLE_STATES.READY_TO_CHAT || 
        currentState.state === BLE_STATES.NOTIFICATIONS_READY ||
        currentState.state === BLE_STATES.CONNECTED) {
      console.log('[BLEInterface] Dispositivo ya conectado:', normMac);
      return true;
    }
    
    if (currentState.state === BLE_STATES.CONNECTING) {
      console.log('[BLEInterface] Conexion en progreso, esperando...');
      try {
        await this._waitForConnectionState(normMac, BLE_STATES.READY_TO_CHAT, 8000);
        return true;
      } catch (e) {
        console.warn('[BLEInterface] Timeout esperando conexion existente');
        return false;
      }
    }
    
    console.log('[BLEInterface] Conectando a:', normMac);
    this._setDeviceState(normMac, BLE_STATES.CONNECTING, { message: 'Conectando...' });
    
    try {
      if (typeof this.nativePlugin.connectToDevice === 'function') {
        await this.nativePlugin.connectToDevice({ deviceId: normMac });
      } else {
        console.warn('[BLEInterface] connectToDevice no disponible en plugin');
        return false;
      }
      
      try {
        await this._waitForConnectionState(normMac, BLE_STATES.READY_TO_CHAT, 8000);
        console.log('[BLEInterface] Conexion establecida:', normMac);
        return true;
      } catch (e) {
        console.warn('[BLEInterface] No llego READY_TO_CHAT, pero device esta conectado');
        var finalState = this._getDeviceState(normMac);
        if (finalState.state === BLE_STATES.CONNECTED || finalState.state === BLE_STATES.CONNECTING) {
          this._setDeviceState(normMac, BLE_STATES.READY_TO_CHAT, { forced: true });
          return true;
        }
        return false;
      }
      
    } catch (e) {
      this._setDeviceState(normMac, BLE_STATES.ERROR, { lastError: e.message || e });
      console.error('[BLEInterface] Fallo conexion:', e.message || e);
      return false;
    }
  }

  async _waitForConnectionState(mac, targetState, timeoutMs) {
    var self = this;
    return new Promise(function(resolve, reject) {
      var normMac = _normMAC(mac);
      var elapsed = 0;
      var interval = 200;
      var timer = null;
      
      var cleanup = function() {
        if (timer) clearTimeout(timer);
        self._waitTimers.delete(normMac + '_conn');
      };
      
      timer = setTimeout(function() { 
        cleanup();
        reject(new Error('Timeout esperando estado')); 
      }, timeoutMs);
      self._waitTimers.set(normMac + '_conn', timer);
      
      var check = function() {
        var state = self._getDeviceState(normMac);
        
        if (targetState === BLE_STATES.READY_TO_CHAT) {
          if (state.state === BLE_STATES.READY_TO_CHAT || 
              state.state === BLE_STATES.NOTIFICATIONS_READY ||
              state.state === BLE_STATES.CONNECTED) {
            cleanup();
            resolve();
            return;
          }
        } else if (state.state === targetState) {
          cleanup();
          resolve();
          return;
        }
        
        if (state.state === BLE_STATES.ERROR) {
          cleanup();
          reject(new Error('Conexion en error: ' + (state.lastError || 'Unknown')));
          return;
        }
        
        elapsed += interval;
        if (elapsed >= timeoutMs) {
          cleanup();
          reject(new Error('Timeout esperando estado ' + targetState));
          return;
        }
        
        setTimeout(check, interval);
      };
      
      check();
    });
  }

  _startReconnect(deviceMAC) {
    this._cancelReconnect(deviceMAC);
    this._setDeviceState(deviceMAC, BLE_STATES.RECONNECTING, { message: 'Reconectando...' });
    var self = this;
    var attemptReconnect = async function() {
      if (self._activeChatMAC !== deviceMAC) return;
      try {
        if (self.nativePlugin && typeof self.nativePlugin.forceReconnect === 'function') {
          await self.nativePlugin.forceReconnect({ deviceId: deviceMAC });
        } else if (self.nativePlugin && typeof self.nativePlugin.connectToDevice === 'function') {
          await self.nativePlugin.connectToDevice({ deviceId: deviceMAC });
        }
      } catch (e) {
        var timer = setTimeout(attemptReconnect, 3000);
        self._reconnectTimers.set(deviceMAC, timer);
      }
    };
    attemptReconnect();
  }

  _cancelReconnect(deviceMAC) {
    var timer = this._reconnectTimers.get(deviceMAC);
    if (timer) {
      clearTimeout(timer);
      this._reconnectTimers.delete(deviceMAC);
    }
    var waitTimer = this._waitTimers.get(deviceMAC);
    if (waitTimer) {
      clearTimeout(waitTimer);
      this._waitTimers.delete(deviceMAC);
    }
    var waitTimerConn = this._waitTimers.get(deviceMAC + '_conn');
    if (waitTimerConn) {
      clearTimeout(waitTimerConn);
      this._waitTimers.delete(deviceMAC + '_conn');
    }
  }

  _setupNativeStateListeners() {
    if (!this.nativePlugin) return;
    var self = this;
    
    this._nativeServicesReadyListener = this.nativePlugin.addListener('onServicesReady', function(data) {
      var mac = _normMAC(data.deviceId);
      self._setDeviceState(mac, BLE_STATES.DISCOVERING_SERVICES, { servicesReady: true });
      var device = self.connectedDevices.get(mac);
      if (device) { device.servicesReady = true; self.connectedDevices.set(mac, device); }
    });
    
    this._nativeNotificationsListener = this.nativePlugin.addListener('onNotificationsEnabled', function(data) {
      var mac = _normMAC(data.deviceId);
      var peerUUID = self._macToUuidMap.get(mac);
      self._setDeviceState(mac, BLE_STATES.READY_TO_CHAT, { notificationsEnabled: true, deviceUUID: peerUUID });
      self._drainMessageQueue(mac);
    });
    
    this._nativeConnectionFailedListener = this.nativePlugin.addListener('onConnectionFailed', function(data) {
      var mac = _normMAC(data.deviceId);
      if (data.recoverable !== false && data.attempt < (data.maxAttempts || 3)) {
        self._setDeviceState(mac, BLE_STATES.CONNECTING, { attempt: data.attempt, message: 'Reintentando...' });
      } else {
        self._setDeviceState(mac, BLE_STATES.ERROR, { lastError: data.reason });
      }
    });
  }

  _setDeviceState(deviceMAC, state, meta) {
    meta = meta || {};
    var nid = _normMAC(deviceMAC);
    var record = { state: state, timestamp: Date.now() };
    for (var key in meta) {
      if (meta.hasOwnProperty(key)) record[key] = meta[key];
    }
    this._deviceStates.set(nid, record);
  }

  _getDeviceState(deviceMAC) {
    return this._deviceStates.get(_normMAC(deviceMAC)) || { state: BLE_STATES.DISCONNECTED };
  }

  _setupNativePayloadListener() {
    if (!this.nativePlugin) return;
    
    if (this._nativePayloadListener && typeof this._nativePayloadListener.remove === 'function') {
      this._nativePayloadListener.remove();
    }
    
    var self = this;
    
    this._nativePayloadListener = this.nativePlugin.addListener('onPayloadReceived', function(data) {
      var mac = _normMAC(data.deviceId);
      var messageId = null;
      var senderName = null;
      var senderUUID = null;
      var content = data.content || data.data || '';
      
      try {
        var json = JSON.parse(data.data || '{}');
        if (json.messageId) messageId = json.messageId;
        if (json.senderName) senderName = json.senderName;
        if (json.deviceUUID) senderUUID = json.deviceUUID;
        if (json.content) content = json.content;
      } catch (e) {}
      
      if (!senderUUID) senderUUID = self._macToUuidMap.get(mac);
      if (senderUUID) {
        self._macToUuidMap.set(mac, senderUUID);
        self._uuidToMacMap.set(senderUUID, mac);
      }
      
      if (!senderName || senderName === 'NEXO Peer') {
        var contactByMac = _getContactByMAC(mac);
        if (contactByMac && contactByMac.name) {
          senderName = contactByMac.name;
        } else {
          var connected = self.connectedDevices.get(mac);
          var found = self.foundDevices.get(mac);
          senderName = (connected && connected.name) || (found && found.name) || 'NEXO Peer';
        }
      }
      
      if (senderUUID && !_isBLEContact(senderUUID) && senderName && senderName !== 'NEXO Peer') {
        _addBLEContact({ deviceUUID: senderUUID, name: senderName, macAddress: mac });
        self._macToUuidMap.set(mac, senderUUID);
        self._uuidToMacMap.set(senderUUID, mac);
        self.renderContactsList();
      }
      
      var dedupKey = (messageId || '') + ':' + mac;
      if (messageId && self._receivedMessageIds.has(dedupKey)) return;
      if (messageId) {
        self._receivedMessageIds.add(dedupKey);
        if (self._receivedMessageIds.size > self._maxMessageIds) {
          var first = self._receivedMessageIds.values().next().value;
          self._receivedMessageIds.delete(first);
        }
      }
      
      var stableId = senderUUID || mac;
      
      window.dispatchEvent(new CustomEvent('nexo:ble:messageReceived', {
        detail: {
          deviceId: stableId,
          deviceUUID: senderUUID,
          macAddress: mac,
          content: content,
          senderName: senderName,
          messageId: messageId,
          source: data.source || 'unknown',
          timestamp: data.timestamp || Date.now()
        }
      }));
      
      var activeUUID = self._activeChatDeviceId;
      if (activeUUID && activeUUID === senderUUID) return;
      
      self.showToast('Mensaje de ' + senderName, 'info');
      self.newDevicesCount++;
      self.updateBadge();
    });
  }

  _enqueueMessage(mac, content) {
    var queue = this._messageQueue.get(mac) || [];
    queue.push({ content: content, timestamp: Date.now(), attempts: 0 });
    this._messageQueue.set(mac, queue);
    this.showToast('Mensaje en cola - conectando...', 'info', 2000);
  }

  async _drainMessageQueue(mac) {
    var queue = this._messageQueue.get(mac);
    if (!queue || queue.length === 0) return;
    this._messageQueue.delete(mac);
    
    var self = this;
    for (var i = 0; i < queue.length; i++) {
      var item = queue[i];
      try {
        await self._sendMessageNative(mac, item.content);
        console.log('[BLEInterface] Mensaje encolado enviado');
      } catch (e) {
        console.warn('[BLEInterface] Fallo envio mensaje encolado:', e.message || e);
      }
    }
  }

  async _sendMessageNative(deviceMAC, content) {
    if (!this.nativePlugin) throw new Error('Plugin no disponible');
    if (typeof this.nativePlugin.sendMessage !== 'function') throw new Error('sendMessage no disponible');
    
    var device = this.connectedDevices.get(_normMAC(deviceMAC));
    var targetId = (device && device.id) || (device && device.address) || deviceMAC;
    
    var enrichedPayload = JSON.stringify({
      deviceUUID: this.localDeviceUUID,
      deviceName: this.localDeviceName,
      content: content,
      messageId: 'msg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
      timestamp: Date.now()
    });
    
    await this.nativePlugin.sendMessage({ deviceId: targetId, message: enrichedPayload });
  }

  async _initVisibility() {
    if (this.isDummyMode) return;
    try {
      if (!this.nativePlugin || typeof this.nativePlugin.isBluetoothEnabled !== 'function') return;
      var btState = await this.nativePlugin.isBluetoothEnabled();
      if (btState) {
        this.canAdvertise = btState.canAdvertise || false;
        this._serverReady = btState.serverReady || false;
      }
      if (this.nativePlugin && typeof this.nativePlugin.isAdvertising === 'function') {
        var adState = await this.nativePlugin.isAdvertising();
        this.isAdvertising = adState && adState.isAdvertising === true;
      }
      this.updateVisibilityButton();
      this._setupNativeAdvertisingListeners();
    } catch (err) {
      console.error('[BLEInterface] Error consultando estado:', err);
    }
  }

  _setupNativeAdvertisingListeners() {
    if (!this.nativePlugin) return;
    if (this._nativeAdStartedListener && typeof this._nativeAdStartedListener.remove === 'function') {
      this._nativeAdStartedListener.remove();
    }
    if (this._nativeAdFailedListener && typeof this._nativeAdFailedListener.remove === 'function') {
      this._nativeAdFailedListener.remove();
    }
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
    if (this.isAdvertising) {
      btn.classList.add('active');
      btn.style.background = '#00D9FF';
      btn.style.color = '#000';
    } else {
      btn.classList.remove('active');
      btn.style.background = 'rgba(255,255,255,0.1)';
      btn.style.color = '#888';
    }
  }

  updateScanButton() {
    var btn = this.elements.scanBtn;
    if (!btn) return;
    if (this.isScanning) {
      btn.classList.add('scanning');
    } else {
      btn.classList.remove('scanning');
    }
  }

  async toggleVisibility() {
    if (this.isDummyMode) return;
    
    var permsReady = false;
    try {
      if (window.ensureBLEPermissions && typeof window.ensureBLEPermissions === 'function') {
        permsReady = await window.ensureBLEPermissions();
      } else {
        permsReady = true;
      }
    } catch (e) { permsReady = true; }
    
    if (!permsReady) {
      this.showToast('Permisos BLE requeridos', 'warning', 5000);
      return;
    }
    
    if (!this._serverReady) {
      try {
        if (this.nativePlugin && typeof this.nativePlugin.initializeBLE === 'function') {
          await this.nativePlugin.initializeBLE({
            userId: (window.currentUser && window.currentUser.id) || '',
            userName: (window.currentUser && window.currentUser.name) || 'NEXO User'
          });
        }
        await new Promise(function(resolve, reject) {
          var timeout = setTimeout(function() { reject(new Error('Timeout')); }, 8000);
          var check = function() {
            if (this._serverReady) { clearTimeout(timeout); resolve(); }
            else { setTimeout(check, 200); }
          }.bind(this);
          check();
        }.bind(this));
      } catch (e) {
        this.showToast('No se pudo inicializar servidor', 'error', 5000);
        return;
      }
    }
    
    try {
      if (this.isAdvertising) {
        if (this.nativePlugin && typeof this.nativePlugin.stopAdvertising === 'function') {
          await this.nativePlugin.stopAdvertising();
        }
        this.isAdvertising = false;
      } else {
        if (this.nativePlugin && typeof this.nativePlugin.startAdvertising === 'function') {
          await this.nativePlugin.startAdvertising();
        }
        this.isAdvertising = true;
      }
      this.updateVisibilityButton();
    } catch (err) {
      this.showToast('Error: ' + (err.message || err), 'error');
    }
  }

  createDOM() {
    var tab = document.createElement('div');
    tab.id = 'ble-tab';
    tab.innerHTML = '<div class="ble-tab-icon">BLE</div><div class="ble-tab-label">BLE</div><div class="ble-tab-badge" id="ble-tab-badge" style="display:none">0</div>';
    document.body.appendChild(tab);
    this.elements.tab = tab;
    
    var panel = document.createElement('div');
    panel.id = 'ble-panel';
    panel.innerHTML = `
      <div class="ble-header">
        <button id="ble-back" class="ble-btn-back">&larr;</button>
        <h3>BLE Mesh</h3>
        <button id="ble-visibility-btn" class="ble-btn-visibility-round"></button>
      </div>
      <div class="ble-status-bar">
        <span id="ble-status" class="ble-status-offline">OFFLINE</span>
      </div>
      <div id="ble-contacts-list" class="ble-contacts-list">
        <div class="ble-empty">No hay contactos. Presiona Descubrir para encontrar dispositivos.</div>
      </div>
      <div class="ble-bottom-bar">
        <div id="ble-new-device" class="ble-new-device" style="display:none">
          <span id="ble-new-device-name"></span>
          <button id="ble-add-btn" class="ble-btn-add-small">+</button>
        </div>
        <button id="ble-scan-btn" class="ble-btn-scan-round"></button>
      </div>
    `;
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
    style.textContent = `
      #ble-tab { position: fixed; left: 0; top: 50%; transform: translateY(-50%); width: 44px; height: 100px; background: linear-gradient(180deg, #00d4ff, #0099cc); border-radius: 0 12px 12px 0; display: flex; flex-direction: column; align-items: center; justify-content: center; cursor: pointer; z-index: 2147483644; color: #000; font-weight: bold; }
      .ble-tab-badge { position: absolute; top: 5px; right: -5px; background: #ff4444; color: white; width: 18px; height: 18px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 10px; animation: pulse 2s infinite; }
      @keyframes pulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.1); } }
      
      #ble-panel { position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: #0a0a15; transform: translateX(-100%); transition: transform 0.3s ease; z-index: 2147483645; color: #fff; display: flex; flex-direction: column; }
      #ble-panel.active { transform: translateX(0); }
      #ble-overlay { position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.6); display: none; z-index: 2147483644; backdrop-filter: blur(4px); }
      #ble-overlay.active { display: block; }
      
      .ble-header { display: flex; align-items: center; justify-content: space-between; padding: 16px 20px; border-bottom: 1px solid #333; }
      .ble-header h3 { margin: 0; font-size: 18px; color: #fff; flex: 1; text-align: center; }
      .ble-btn-back { background: none; border: none; color: #00d4ff; font-size: 24px; cursor: pointer; padding: 0; width: 40px; height: 40px; display: flex; align-items: center; justify-content: center; }
      .ble-btn-visibility-round { width: 44px; height: 44px; border-radius: 50%; border: 2px solid #00d4ff; background: rgba(255,255,255,0.1); color: #888; cursor: pointer; font-size: 12px; display: flex; align-items: center; justify-content: center; transition: all 0.3s; }
      .ble-btn-visibility-round.active { background: #00D9FF; color: #000; border-color: #00D9FF; box-shadow: 0 0 12px rgba(0,217,255,0.4); }
      .ble-btn-visibility-round::before { content: 'EYE'; font-size: 10px; font-weight: bold; }
      
      .ble-status-bar { padding: 8px 20px; }
      .ble-status-offline { font-size: 12px; color: #888; }
      .ble-status-online { font-size: 12px; color: #00d4ff; }
      .ble-status-scanning { font-size: 12px; color: #ffaa00; animation: blink 1s infinite; }
      @keyframes blink { 0%,50% { opacity: 1; } 51%,100% { opacity: 0.7; } }
      
      .ble-contacts-list { flex: 1; overflow-y: auto; padding: 0 20px; }
      .ble-contact-item { display: flex; align-items: center; justify-content: space-between; padding: 14px 16px; background: rgba(255,255,255,0.05); border: 1px solid #333; border-radius: 12px; margin-bottom: 10px; cursor: pointer; transition: all 0.2s; }
      .ble-contact-item:hover { background: rgba(0,212,255,0.1); border-color: #00d4ff; }
      .ble-contact-item.online { border-left: 3px solid #00ff88; }
      .ble-contact-item.offline { border-left: 3px solid #666; }
      .ble-contact-info { display: flex; flex-direction: column; flex: 1; min-width: 0; }
      .ble-contact-name { font-weight: 600; font-size: 15px; color: #fff; }
      .ble-contact-mac { font-size: 10px; color: #666; font-family: monospace; margin-top: 2px; }
      .ble-contact-status { font-size: 11px; color: #888; margin-top: 2px; }
      .ble-contact-actions { display: flex; gap: 8px; }
      .ble-btn-chat { padding: 8px 16px; background: #00d4ff; color: #000; border: none; border-radius: 8px; cursor: pointer; font-size: 12px; font-weight: bold; }
      .ble-btn-remove { padding: 8px 12px; background: #ff4444; color: #fff; border: none; border-radius: 8px; cursor: pointer; font-size: 12px; }
      
      .ble-empty { text-align: center; color: #666; padding: 40px 20px; font-style: italic; }
      
      .ble-bottom-bar { display: flex; align-items: center; justify-content: space-between; padding: 16px 20px; border-top: 1px solid #333; gap: 12px; }
      .ble-new-device { display: flex; align-items: center; gap: 10px; flex: 1; background: rgba(0,212,255,0.1); border: 1px solid #00d4ff; border-radius: 12px; padding: 10px 14px; }
      .ble-new-device span { color: #fff; font-size: 14px; flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .ble-btn-add-small { width: 36px; height: 36px; border-radius: 50%; background: #00ff88; color: #000; border: none; font-size: 20px; font-weight: bold; cursor: pointer; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
      .ble-btn-scan-round { width: 56px; height: 56px; border-radius: 50%; background: linear-gradient(135deg, #00d4ff, #0099cc); color: #000; border: none; font-size: 14px; font-weight: bold; cursor: pointer; display: flex; align-items: center; justify-content: center; flex-shrink: 0; box-shadow: 0 4px 15px rgba(0,212,255,0.3); transition: all 0.3s; }
      .ble-btn-scan-round.scanning { background: linear-gradient(135deg, #ff4444, #cc0000); color: #fff; animation: pulse-red 1.5s infinite; }
      .ble-btn-scan-round::before { content: 'SCAN'; font-size: 10px; }
      .ble-btn-scan-round.scanning::before { content: 'STOP'; }
      @keyframes pulse-red { 0%,100% { box-shadow: 0 0 0 0 rgba(255,68,68,0.4); } 50% { box-shadow: 0 0 0 10px rgba(255,68,68,0); } }
      
      .ble-toast { position: fixed; bottom: 100px; left: 50%; transform: translateX(-50%); padding: 12px 24px; border-radius: 8px; color: #fff; font-weight: bold; z-index: 2147483646; animation: fadeInUp 0.3s ease; }
      .ble-toast.success { background: #00d4ff; color: #000; }
      .ble-toast.error { background: #ff4444; }
      .ble-toast.warning { background: #ffaa00; color: #000; }
      .ble-toast.info { background: #444; }
      @keyframes fadeInUp { from { opacity: 0; transform: translateX(-50%) translateY(20px); } to { opacity: 1; transform: translateX(-50%) translateY(0); } }
    `;
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
      self._activeChatDeviceId = null;
      self._activeChatMAC = null;
      self.updateBadge();
    });
  }

  togglePanel() {
    this.elements.panel.classList.toggle('active');
    this.elements.overlay.classList.toggle('active');
    if (this.elements.panel.classList.contains('active')) {
      this.newDevicesCount = 0;
      this.updateBadge();
      this.renderContactsList();
    }
  }

  async toggleScan() {
    if (this.isDummyMode) return;
    
    var permsReady = false;
    try {
      if (window.ensureBLEPermissions && typeof window.ensureBLEPermissions === 'function') {
        permsReady = await window.ensureBLEPermissions();
      } else {
        permsReady = true;
      }
    } catch (e) { permsReady = true; }
    
    if (!permsReady) {
      this.showToast('Permisos BLE requeridos', 'warning', 5000);
      return;
    }
    
    try {
      if (this.isScanning) {
        if (this.nativePlugin && typeof this.nativePlugin.stopScan === 'function') {
          await this.nativePlugin.stopScan();
        }
        this.isScanning = false;
        this.updateScanButton();
        this.updateStatus();
      } else {
        this.foundDevices.clear();
        this._renderedDeviceIds.clear();
        this.renderContactsList();
        this.renderNewDeviceBar();
        if (this.nativePlugin && typeof this.nativePlugin.startScan === 'function') {
          await this.nativePlugin.startScan();
        }
        this.isScanning = true;
        this.updateScanButton();
        this.elements.status.textContent = 'ESCANEANDO...';
        this.elements.status.className = 'ble-status-scanning';
      }
    } catch (err) {
      this.isScanning = false;
      this.updateScanButton();
    }
  }

  onDeviceFound(device) {
    var mac = _normMAC(device.id || device.address);
    if (!mac || mac === 'null' || mac === 'undefined') return;
    if (this.localDeviceAddress && mac === this.localDeviceAddress) return;
    
    var existingContact = _findContactByMACOrName(mac, device.name);
    if (existingContact && _normMAC(existingContact.macAddress) !== mac) {
      var oldMAC = existingContact.macAddress;
      _updateContactMAC(oldMAC, mac, device.name);
      this._macToUuidMap.delete(_normMAC(oldMAC));
      this._macToUuidMap.set(mac, existingContact.deviceUUID);
      this._uuidToMacMap.set(existingContact.deviceUUID, mac);
      this.showToast('Contacto actualizado: ' + existingContact.name, 'info', 2000);
      this.renderContactsList();
      return;
    }
    
    var knownUUID = this._macToUuidMap.get(mac);
    if (knownUUID && _isBLEContact(knownUUID)) {
      var contacts = _getBLEContacts();
      var idx = contacts.findIndex(function(c) { return _normId(c.deviceUUID) === _normId(knownUUID); });
      if (idx >= 0) {
        contacts[idx].online = true;
        contacts[idx].lastSeen = Date.now();
        contacts[idx].macAddress = _formatMAC(mac);
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
    var list = this.elements.contactsList;
    var contacts = _getBLEContacts();
    if (contacts.length === 0) {
      list.innerHTML = '<div class="ble-empty">No hay contactos. Presiona Descubrir para encontrar dispositivos.</div>';
      return;
    }
    list.innerHTML = '';
    var self = this;
    contacts.forEach(function(contact) {
      var uuid = _normId(contact.deviceUUID);
      var mac = self._uuidToMacMap.get(uuid) || contact.macAddress;
      var isOnline = contact.online && (Date.now() - (contact.lastSeen || 0)) < 60000;
      
      var item = document.createElement('div');
      item.className = 'ble-contact-item ' + (isOnline ? 'online' : 'offline');
      
      var infoDiv = document.createElement('div');
      infoDiv.className = 'ble-contact-info';
      infoDiv.innerHTML = '<div class="ble-contact-name">' + (contact.name || 'NEXO Peer') + '</div>' +
        '<div class="ble-contact-mac">' + (mac ? _formatMAC(mac) : 'Sin MAC') + '</div>' +
        '<div class="ble-contact-status">' + (isOnline ? 'En linea' : 'Offline') + '</div>';
      item.appendChild(infoDiv);
      
      var actionsDiv = document.createElement('div');
      actionsDiv.className = 'ble-contact-actions';
      
      var chatBtn = document.createElement('button');
      chatBtn.className = 'ble-btn-chat';
      chatBtn.textContent = 'Chat';
      chatBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        if (self._isOpeningChat) {
          self.showToast('Conectando...', 'info', 1500);
          return;
        }
        self.openChat(uuid).catch(function(err) {
          console.error('[BLEInterface] openChat error:', err);
          self.showToast('Error al abrir chat', 'error');
        });
      });
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
    var bar = this.elements.newDeviceBar;
    var mac = bar.dataset.mac;
    if (!mac) return;
    
    var device = this.foundDevices.get(mac);
    if (!device) return;
    
    var name = device.name || 'NEXO Peer';
    
    var existingByName = _getBLEContacts().find(function(c) {
      return _normId(c.name) === _normId(name);
    });
    if (existingByName && name !== 'NEXO Peer' && name !== 'NEXO Device') {
      this.showToast('Ya tienes un contacto con ese nombre', 'warning');
      return;
    }
    
    var tempUUID = 'mac-' + mac;
    this._macToUuidMap.set(mac, tempUUID);
    this._uuidToMacMap.set(tempUUID, mac);
    
    _addBLEContact({ deviceUUID: tempUUID, name: name, macAddress: mac });
    
    this.foundDevices.delete(mac);
    
    this.renderContactsList();
    this.renderNewDeviceBar();
    
    this.showToast('Agregado: ' + name, 'success');
  }

  async openChat(deviceUUID) {
    if (this._isOpeningChat) {
      this.showToast('Conectando...', 'info', 1500);
      return;
    }
    
    this._isOpeningChat = true;
    
    var uuid = _normId(deviceUUID);
    var contact = _getContactByUUID(uuid);
    var mac = this._uuidToMacMap.get(uuid) || (contact && _normMAC(contact.macAddress));
    
    if (!mac && contact) {
      this.foundDevices.forEach(function(d, m) {
        if (!mac && d.deviceUUID === uuid) mac = m;
      });
      this.connectedDevices.forEach(function(d, m) {
        if (!mac && d.deviceUUID === uuid) mac = m;
      });
    }
    
    var displayName = (contact && contact.name) || 'NEXO Peer';
    
    if (!mac) {
      this.showToast('Dispositivo no disponible para conectar', 'warning');
      this._isOpeningChat = false;
      return;
    }
    
    this._activeChatDeviceId = uuid;
    this._activeChatMAC = mac;
    this.newDevicesCount = 0;
    this.updateBadge();
    
    var appContainer = document.getElementById('app');
    if (appContainer) appContainer.classList.remove('hidden');
    var nameInput = document.getElementById('chat-contact-name');
    var subtitle = document.getElementById('chat-contact-subtitle');
    if (nameInput) nameInput.value = displayName;
    if (subtitle) subtitle.textContent = 'BLUETOOTH \u25cf';
    
    window.dispatchEvent(new CustomEvent('nexo:ble:openChat', {
      detail: { 
        contactId: uuid, 
        name: displayName, 
        address: mac, 
        transport: 'ble', 
        source: 'ble_interface',
        macAddress: mac
      }
    }));
    
    this.togglePanel();
    
    try {
      var connected = await this._connectToDevice(mac);
      
      if (!connected) {
        this.showToast('No se pudo conectar a ' + displayName + '. Reintentando...', 'warning', 5000);
        this._startReconnect(mac);
      } else {
        this.showToast('Conectado a ' + displayName, 'success', 2000);
      }
    } catch (e) {
      console.error('[BLEInterface] openChat conexion fallo:', e);
      this.showToast('Error de conexion: ' + (e.message || e), 'error', 3000);
    } finally {
      this._isOpeningChat = false;
    }
  }

  async sendMessageToActiveChat(content) {
    if (!this._activeChatMAC) {
      this.showToast('No hay chat activo', 'error');
      return false;
    }
    
    var mac = this._activeChatMAC;
    var state = this._getDeviceState(mac);
    
    if (state.state !== BLE_STATES.READY_TO_CHAT && 
        state.state !== BLE_STATES.NOTIFICATIONS_READY &&
        state.state !== BLE_STATES.CONNECTED) {
      this.showToast('Reconectando...', 'info', 2000);
      
      try {
        var reconnected = await this._connectToDevice(mac);
        if (!reconnected) {
          this._enqueueMessage(mac, content);
          this.showToast('Mensaje en cola - reconectando...', 'info', 3000);
          return false;
        }
      } catch (e) {
        this._enqueueMessage(mac, content);
        this.showToast('Mensaje en cola - reconectando...', 'info', 3000);
        return false;
      }
    }
    
    state = this._getDeviceState(mac);
    if (state.state !== BLE_STATES.READY_TO_CHAT && 
        state.state !== BLE_STATES.NOTIFICATIONS_READY &&
        state.state !== BLE_STATES.CONNECTED) {
      this._enqueueMessage(mac, content);
      this.showToast('Mensaje en cola - esperando conexion', 'info', 3000);
      return false;
    }
    
    try {
      await this._sendMessageNative(mac, content);
      return true;
    } catch (e) {
      console.warn('[BLEInterface] Envio fallo:', e.message || e);
      
      var retryCount = this._sendRetryCount.get(mac) || 0;
      if (retryCount < 3) {
        this._sendRetryCount.set(mac, retryCount + 1);
        this.showToast('Reintentando... (' + (retryCount + 1) + '/3)', 'warning', 2000);
        
        try {
          await this._connectToDevice(mac);
          await this._sendMessageNative(mac, content);
          this._sendRetryCount.delete(mac);
          return true;
        } catch (e2) {
          this.showToast('Fallo despues de reintento', 'error');
        }
      }
      
      this._sendRetryCount.delete(mac);
      this._enqueueMessage(mac, content);
      return false;
    }
  }

  async _attemptReconnectWithScan(mac) {
    if (!this.nativePlugin) throw new Error('Plugin no disponible');
    
    try {
      if (typeof this.nativePlugin.startScan === 'function') {
        await this.nativePlugin.startScan();
      }
      await new Promise(function(resolve) { setTimeout(resolve, 5000); });
      if (typeof this.nativePlugin.stopScan === 'function') {
        await this.nativePlugin.stopScan();
      }
    } catch (e) {}
    
    var contact = _getContactByMAC(mac);
    if (contact) {
      var newMac = this._findNewMACForContact(contact);
      if (newMac && newMac !== mac) {
        _updateContactMAC(mac, newMac, contact.name);
        this._activeChatMAC = newMac;
        mac = newMac;
      }
    }
    
    try {
      if (this.nativePlugin && typeof this.nativePlugin.forceReconnect === 'function') {
        await this.nativePlugin.forceReconnect({ deviceId: mac });
      } else if (this.nativePlugin && typeof this.nativePlugin.connectToDevice === 'function') {
        await this.nativePlugin.connectToDevice({ deviceId: mac });
      }
      await this._waitForReadyToChat(mac, 8000);
    } catch (e) {
      throw e;
    }
  }

  _findNewMACForContact(contact) {
    var self = this;
    var foundMac = null;
    this.foundDevices.forEach(function(device, mac) {
      if (!foundMac && _normId(device.name) === _normId(contact.name)) {
        foundMac = mac;
      }
    });
    return foundMac;
  }

  async removeContact(deviceUUID) {
    _removeBLEContact(deviceUUID);
    this.showToast('Eliminado', 'info');
    this.renderContactsList();
    this.renderNewDeviceBar();
  }

  async disconnect(deviceMAC) {
    if (this.isDummyMode) return;
    var mac = _normMAC(deviceMAC);
    try {
      this._cancelReconnect(mac);
      var device = this.connectedDevices.get(mac);
      var targetId = (device && device.id) || (device && device.address) || deviceMAC;
      if (this.nativePlugin && typeof this.nativePlugin.disconnectDevice === 'function') {
        await this.nativePlugin.disconnectDevice({ deviceId: targetId });
      }
      var uuid = this._macToUuidMap.get(mac);
      if (this._activeChatDeviceId === uuid || this._activeChatMAC === mac) {
        this._activeChatDeviceId = null;
        this._activeChatMAC = null;
        this.updateBadge();
      }
    } catch (err) {}
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

  async updateStatus(customStatus) {
    if (customStatus) {
      this.elements.status.textContent = customStatus;
      this.elements.status.className = 'ble-status-offline';
      return;
    }
    if (this.isDummyMode) return;
    try {
      var state = 'UNKNOWN';
      if (this.nativePlugin && typeof this.nativePlugin.isBluetoothEnabled === 'function') {
        var btState = await this.nativePlugin.isBluetoothEnabled();
        if (btState) {
          state = btState.enabled ? 'poweredOn' : 'poweredOff';
          this._serverReady = btState.serverReady || false;
        }
      }
      var stateMap = { 'poweredon': 'ENCENDIDO', 'poweredoff': 'APAGADO', 'unknown': 'DESCONOCIDO' };
      var normalizedState = (state || '').toString().toLowerCase();
      this.elements.status.textContent = stateMap[normalizedState] || state.toUpperCase();
      this.elements.status.className = state === 'poweredOn' ? 'ble-status-online' : 'ble-status-offline';
    } catch (err) {
      this.elements.status.textContent = 'ERROR';
    }
  }

  showToast(message, type, duration) {
    type = type || 'info';
    duration = duration || 3000;
    var existing = document.querySelector('.ble-toast');
    if (existing) existing.remove();
    var toast = document.createElement('div');
    toast.className = 'ble-toast ' + type;
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(function() {
      toast.style.opacity = '0';
      setTimeout(function() { toast.remove(); }, 300);
    }, duration);
  }

  destroy() {
    var styles = document.getElementById('ble-styles-v4');
    if (styles) styles.remove();
    
    this._reconnectTimers.forEach(function(timer) { clearTimeout(timer); });
    this._reconnectTimers.clear();
    
    this._waitTimers.forEach(function(timer) { clearTimeout(timer); });
    this._waitTimers.clear();
    
    if (this._nativeAdStartedListener && typeof this._nativeAdStartedListener.remove === 'function') {
      this._nativeAdStartedListener.remove();
    }
    if (this._nativeAdFailedListener && typeof this._nativeAdFailedListener.remove === 'function') {
      this._nativeAdFailedListener.remove();
    }
    if (this._nativeDeviceFoundListener && typeof this._nativeDeviceFoundListener.remove === 'function') {
      this._nativeDeviceFoundListener.remove();
    }
    if (this._nativeScanFailedListener && typeof this._nativeScanFailedListener.remove === 'function') {
      this._nativeScanFailedListener.remove();
    }
    if (this._nativeDeviceConnectedListener && typeof this._nativeDeviceConnectedListener.remove === 'function') {
      this._nativeDeviceConnectedListener.remove();
    }
    if (this._nativeDeviceDisconnectedListener && typeof this._nativeDeviceDisconnectedListener.remove === 'function') {
      this._nativeDeviceDisconnectedListener.remove();
    }
    if (this._nativePayloadListener && typeof this._nativePayloadListener.remove === 'function') {
      this._nativePayloadListener.remove();
    }
    if (this._nativeServicesReadyListener && typeof this._nativeServicesReadyListener.remove === 'function') {
      this._nativeServicesReadyListener.remove();
    }
    if (this._nativeNotificationsListener && typeof this._nativeNotificationsListener.remove === 'function') {
      this._nativeNotificationsListener.remove();
    }
    if (this._nativeConnectionFailedListener && typeof this._nativeConnectionFailedListener.remove === 'function') {
      this._nativeConnectionFailedListener.remove();
    }
    if (this._nativeServerReadyListener && typeof this._nativeServerReadyListener.remove === 'function') {
      this._nativeServerReadyListener.remove();
    }
    if (this.isScanning) this.toggleScan();
  }
}

window.bleInterface = null;
