/**
 * BLE Interface v4.1.0-UI-UUID
 * Ubicacion: src/ui/ble_interface.js
 * UI: Sin tabs, lista contactos + barra inferior nuevos
 * UUID: Agregar conecta GATT en background, recibe UUID real, guarda
 * Anti-duplicado: Por UUID, no por MAC
 */

export function initBLEInterface(bleMesh) {
  var instance = new BLEInterface(bleMesh).init();
  window.bleInterface = instance;
  return instance;
}

var BLE_CONTACTS_STORAGE_KEY = 'nexo_ble_contacts_v2';
var BLE_UUID_STORAGE_KEY = 'nexo_device_uuid';

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

function _getBLEContacts() {
  try {
    var raw = localStorage.getItem(BLE_CONTACTS_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) { return []; }
}

function _saveBLEContacts(contacts) {
  localStorage.setItem(BLE_CONTACTS_STORAGE_KEY, JSON.stringify(contacts));
}

function _addBLEContact(contact) {
  var contacts = _getBLEContacts();
  var uuid = _normId(contact.deviceUUID);
  
  if (!uuid) return false;
  
  // Buscar por UUID
  var existingIdx = contacts.findIndex(function(c) {
    return _normId(c.deviceUUID) === uuid;
  });
  
  if (existingIdx >= 0) {
    contacts[existingIdx].name = contact.name || contacts[existingIdx].name || 'NEXO Peer';
    contacts[existingIdx].macAddress = contact.macAddress || contacts[existingIdx].macAddress;
    contacts[existingIdx].lastSeen = Date.now();
    contacts[existingIdx].online = true;
    _saveBLEContacts(contacts);
    return true;
  }
  
  // Nuevo contacto
  contacts.push({
    deviceUUID: uuid,
    name: contact.name || 'NEXO Peer',
    macAddress: contact.macAddress || null,
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

function _getContactByName(name) {
  var n = (name || '').trim().toLowerCase();
  return _getBLEContacts().find(function(c) {
    return (c.name || '').trim().toLowerCase() === n;
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
    this._reconnectTimers = new Map();
    this._serverReady = false;
    this._macToUuidMap = new Map();
    this._uuidToMacMap = new Map();
    this._pendingAdds = new Map();
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
      this.nativePlugin = (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.NexoBLE) || null;
      if (this.nativePlugin) this.isDummyMode = !this.bleMesh && !this.nativePlugin;
    }
    if (this.isDummyMode) {
      this.updateStatus('OFFLINE (Dummy)');
    } else {
      this.updateStatus();
      this._loadConnectedDevices();
      this._initVisibility();
      this._setupNativeScanListeners();
      this._setupNativeConnectionListeners();
      this._setupNativePayloadListener();
      this._setupNativeStateListeners();
      this._setupNativeServerReadyListener();
      this._loadLocalDeviceInfo();
      this._autoStartAdvertising();
    }
    console.log('[BLEInterface] UUID local:', this.localDeviceUUID);
    return this;
  }

  async _autoStartAdvertising() {
    if (this.isDummyMode || !this.nativePlugin) return;
    try {
      var btState = await this.nativePlugin.isBluetoothEnabled();
      if (btState.canAdvertise) {
        await this.nativePlugin.startAdvertising();
        this.isAdvertising = true;
        this.updateVisibilityButton();
      }
    } catch (e) {
      console.warn('[BLEInterface] Auto-advertise fallo:', e.message);
    }
  }

  async _loadLocalDeviceInfo() {
    if (!this.nativePlugin || !this.nativePlugin.getLocalDeviceInfo) return;
    try {
      var info = await this.nativePlugin.getLocalDeviceInfo();
      this.localDeviceName = info.deviceName || 'NEXO Device';
      this.localDeviceAddress = _normId(info.deviceAddress || '');
    } catch (e) {}
  }

  _setupNativeScanListeners() {
    if (!this.nativePlugin) return;
    if (this._nativeDeviceFoundListener) this._nativeDeviceFoundListener.remove();
    if (this._nativeScanFailedListener) this._nativeScanFailedListener.remove();
    var self = this;
    this._nativeDeviceFoundListener = this.nativePlugin.addListener('onDeviceFound', function(data) {
      var mac = _normId(data.deviceId);
      var name = data.name || 'NEXO Device';
      self.onDeviceFound({ id: mac, address: mac, name: name, rssi: data.rssi });
    });
    this._nativeScanFailedListener = this.nativePlugin.addListener('onScanFailed', function(data) {
      self.isScanning = false;
      self.updateScanButton();
      self.showToast('Error al escanear', 'error');
    });
  }

  _setupNativeServerReadyListener() {
    if (!this.nativePlugin) return;
    if (this._nativeServerReadyListener) this._nativeServerReadyListener.remove();
    var self = this;
    this._nativeServerReadyListener = this.nativePlugin.addListener('onServerReady', function(data) {
      console.log('[BLEInterface] onServerReady recibido:', data);
      self._serverReady = true;
    });
  }

  _setupNativeConnectionListeners() {
    if (!this.nativePlugin) return;
    if (this._nativeDeviceConnectedListener) this._nativeDeviceConnectedListener.remove();
    if (this._nativeDeviceDisconnectedListener) this._nativeDeviceDisconnectedListener.remove();
    var self = this;

    this._nativeDeviceConnectedListener = this.nativePlugin.addListener('onDeviceConnected', function(data) {
      var mac = _normId(data.deviceId);
      var attempt = data.attempt || 0;
      self._cancelReconnect(mac);
      
      var peerUUID = self._macToUuidMap.get(mac);
      var displayName = data.name || (peerUUID ? _getContactByUUID(peerUUID)?.name : null) || 'NEXO Peer';
      
      if (data.direction === 'incoming') {
        self._setDeviceState(mac, BLE_STATES.READY_TO_CHAT, { direction: 'incoming', role: 'peer_connected', deviceUUID: peerUUID });
        self.connectedDevices.set(mac, { id: mac, address: mac, name: displayName, direction: 'incoming', servicesReady: true, deviceUUID: peerUUID });
      } else {
        self._setDeviceState(mac, BLE_STATES.CONNECTING, { direction: 'outgoing', attempt: attempt, role: 'client', deviceUUID: peerUUID });
        self.connectedDevices.set(mac, { id: mac, address: mac, name: displayName, direction: 'outgoing', servicesReady: false, deviceUUID: peerUUID });
      }
      
      // Si hay un agregar pendiente para este MAC, procesarlo
      self._processPendingAdd(mac);
    });

    this._nativeDeviceDisconnectedListener = this.nativePlugin.addListener('onDeviceDisconnected', function(data) {
      var mac = _normId(data.deviceId);
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
      // Esperar a que el canal este listo para recibir UUID
      await this._waitForReadyToChat(mac, 10000);
      
      // Si ya tenemos UUID del payload, usarlo. Si no, usar MAC como fallback temporal
      var uuid = this._macToUuidMap.get(mac);
      if (!uuid) {
        uuid = 'mac-' + mac.replace(/:/g, '');
        this._macToUuidMap.set(mac, uuid);
        this._uuidToMacMap.set(uuid, mac);
      }
      
      var contactName = pending.name || 'NEXO Peer';
      _addBLEContact({ deviceUUID: uuid, name: contactName, macAddress: mac });
      
      this.showToast('Agregado: ' + contactName, 'success');
      this.renderContactsList();
      this.renderNewDeviceBar();
    } catch (e) {
      console.warn('[BLEInterface] Pending add fallo:', e.message);
      this.showToast('No se pudo agregar contacto', 'warning');
    }
  }

  async _waitForReadyToChat(mac, timeoutMs) {
    var self = this;
    return new Promise(function(resolve, reject) {
      var timer = setTimeout(function() { reject(new Error('Timeout')); }, timeoutMs);
      var check = function() {
        var s = self._getDeviceState(mac);
        if (s.state === BLE_STATES.READY_TO_CHAT || s.state === BLE_STATES.NOTIFICATIONS_READY) {
          clearTimeout(timer);
          resolve();
        } else {
          setTimeout(check, 300);
        }
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
        await self.nativePlugin.forceReconnect({ deviceId: deviceMAC });
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
  }

  _setupNativeStateListeners() {
    if (!this.nativePlugin) return;
    var self = this;
    this._nativeServicesReadyListener = this.nativePlugin.addListener('onServicesReady', function(data) {
      var mac = _normId(data.deviceId);
      self._setDeviceState(mac, BLE_STATES.DISCOVERING_SERVICES, { servicesReady: true });
      var device = self.connectedDevices.get(mac);
      if (device) { device.servicesReady = true; self.connectedDevices.set(mac, device); }
    });
    this._nativeNotificationsListener = this.nativePlugin.addListener('onNotificationsEnabled', function(data) {
      var mac = _normId(data.deviceId);
      var peerUUID = self._macToUuidMap.get(mac);
      self._setDeviceState(mac, BLE_STATES.READY_TO_CHAT, { notificationsEnabled: true, deviceUUID: peerUUID });
      self._processPendingMessages(mac);
    });
    this._nativeConnectionFailedListener = this.nativePlugin.addListener('onConnectionFailed', function(data) {
      var mac = _normId(data.deviceId);
      if (data.recoverable !== false && data.attempt < (data.maxAttempts || 3)) {
        self._setDeviceState(mac, BLE_STATES.CONNECTING, { attempt: data.attempt, message: 'Reintentando...' });
      } else {
        self._setDeviceState(mac, BLE_STATES.ERROR, { lastError: data.reason });
      }
    });
  }

  _setDeviceState(deviceMAC, state, meta) {
    meta = meta || {};
    var nid = _normId(deviceMAC);
    this._deviceStates.set(nid, { state: state, ...meta, timestamp: Date.now() });
  }

  _getDeviceState(deviceMAC) {
    return this._deviceStates.get(_normId(deviceMAC)) || { state: BLE_STATES.DISCONNECTED };
  }

  _setupNativePayloadListener() {
    if (!this.nativePlugin) return;
    if (this._nativePayloadListener) this._nativePayloadListener.remove();
    var self = this;
    this._nativePayloadListener = this.nativePlugin.addListener('onPayloadReceived', function(data) {
      var mac = _normId(data.deviceId);
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
        senderName = _getContactByUUID(senderUUID)?.name
          || self.connectedDevices.get(mac)?.name
          || self.foundDevices.get(mac)?.name
          || 'NEXO Peer';
      }
      
      if (senderUUID && !_isBLEContact(senderUUID) && senderName && senderName !== 'NEXO Peer') {
        _addBLEContact({ deviceUUID: senderUUID, name: senderName, macAddress: mac });
        self.renderContactsList();
      }
      
      if (messageId && self._receivedMessageIds.has(messageId)) return;
      if (messageId) {
        self._receivedMessageIds.add(messageId);
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

  async _processPendingMessages(deviceMAC) {
    var nid = _normId(deviceMAC);
    var queue = this._pendingMessageQueue.get(nid);
    if (!queue || queue.length === 0) return;
    this._pendingMessageQueue.delete(nid);
    for (var i = 0; i < queue.length; i++) {
      var item = queue[i];
      try { await this._sendMessageNative(nid, item.content); item.resolve(); }
      catch (e) { item.reject(e); }
    }
  }

  async _sendMessageNative(deviceMAC, content) {
    if (!this.nativePlugin) throw new Error('Plugin no disponible');
    var device = this.connectedDevices.get(_normId(deviceMAC));
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
      var btState = await this.nativePlugin.isBluetoothEnabled();
      this.canAdvertise = btState.canAdvertise || false;
      this._serverReady = btState.serverReady || false;
      var adState = await this.nativePlugin.isAdvertising();
      this.isAdvertising = adState.isAdvertising === true;
      this.updateVisibilityButton();
      this._setupNativeAdvertisingListeners();
    } catch (err) {
      console.error('[BLEInterface] Error consultando estado:', err);
    }
  }

  _setupNativeAdvertisingListeners() {
    if (!this.nativePlugin) return;
    if (this._nativeAdStartedListener) this._nativeAdStartedListener.remove();
    if (this._nativeAdFailedListener) this._nativeAdFailedListener.remove();
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
      if (window.ensureBLEPermissions) {
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
        await this.nativePlugin.initializeBLE({
          userId: (window.currentUser && window.currentUser.id) || '',
          userName: (window.currentUser && window.currentUser.name) || 'NEXO User'
        });
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
        await this.nativePlugin.stopAdvertising();
        this.isAdvertising = false;
      } else {
        await this.nativePlugin.startAdvertising();
        this.isAdvertising = true;
      }
      this.updateVisibilityButton();
    } catch (err) {
      this.showToast('Error: ' + err.message, 'error');
    }
  }

  createDOM() {
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
      if (window.ensureBLEPermissions) {
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
        if (this.nativePlugin) await this.nativePlugin.stopScan();
        this.isScanning = false;
        this.updateScanButton();
        this.updateStatus();
      } else {
        this.foundDevices.clear();
        this._renderedDeviceIds.clear();
        this.renderContactsList();
        this.renderNewDeviceBar();
        if (this.nativePlugin) await this.nativePlugin.startScan();
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
    var mac = _normId(device.id || device.address);
    if (!mac || mac === 'null' || mac === 'undefined') return;
    if (this.localDeviceAddress && mac === this.localDeviceAddress) return;
    
    // Si ya es contacto conocido, solo actualizar online status
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
    
    // Si ya esta en foundDevices, actualizar
    if (this.foundDevices.has(mac)) {
      var existing = this.foundDevices.get(mac);
      existing.rssi = device.rssi;
      existing.name = device.name || existing.name;
      existing.lastSeen = Date.now();
      this.foundDevices.set(mac, existing);
      this.renderNewDeviceBar();
      return;
    }
    
    // Nuevo dispositivo encontrado
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
    
    // Buscar el primer dispositivo no agregado
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

  async _addNewDevice() {
    var bar = this.elements.newDeviceBar;
    var mac = bar.dataset.mac;
    if (!mac) return;
    
    var device = this.foundDevices.get(mac);
    if (!device) return;
    
    var name = device.name || 'NEXO Peer';
    
    // Verificar si ya existe por nombre
    var existingByName = _getContactByName(name);
    if (existingByName && name !== 'NEXO Peer' && name !== 'NEXO Device') {
      this.showToast('Ya tienes un contacto con ese nombre', 'warning');
      return;
    }
    
    // Marcar como agregando
    bar.style.opacity = '0.5';
    
    // Conectar en background para obtener UUID real
    this._pendingAdds.set(mac, { name: name, mac: mac });
    
    try {
      await this.nativePlugin.connectToDevice({ deviceId: mac });
      // La conexion disparara _processPendingAdd cuando reciba UUID
      this.showToast('Conectando para agregar...', 'info');
    } catch (e) {
      // Si falla conexion, agregar con MAC temporal
      console.warn('[BLEInterface] Conexion fallo para agregar, usando MAC temporal:', e.message);
      var tempUUID = 'mac-' + mac.replace(/:/g, '');
      this._macToUuidMap.set(mac, tempUUID);
      this._uuidToMacMap.set(tempUUID, mac);
      _addBLEContact({ deviceUUID: tempUUID, name: name, macAddress: mac });
      this.foundDevices.delete(mac);
      this.renderContactsList();
      this.renderNewDeviceBar();
      this.showToast('Agregado: ' + name, 'success');
      bar.style.opacity = '1';
    }
  }

  async openChat(deviceUUID) {
    var uuid = _normId(deviceUUID);
    var contact = _getContactByUUID(uuid);
    var mac = this._uuidToMacMap.get(uuid) || (contact && contact.macAddress);
    
    if (!mac && contact) {
      this.foundDevices.forEach(function(d, m) {
        if (!mac && d.deviceUUID === uuid) mac = m;
      });
      this.connectedDevices.forEach(function(d, m) {
        if (!mac && d.deviceUUID === uuid) mac = m;
      });
    }
    
    var displayName = (contact && contact.name) || 'NEXO Peer';
    
    this._activeChatDeviceId = uuid;
    this._activeChatMAC = mac;
    this.newDevicesCount = 0;
    this.updateBadge();
    
    if (!mac) {
      this.showToast('Dispositivo no disponible para conectar', 'warning');
      return;
    }
    
    var state = this._getDeviceState(mac);
    var isReady = state.state === BLE_STATES.READY_TO_CHAT || state.state === BLE_STATES.NOTIFICATIONS_READY;
    
    if (!isReady && this.nativePlugin) {
      try {
        await this.nativePlugin.connectToDevice({ deviceId: mac });
        await this._waitForReadyToChat(mac, 15000);
      } catch (e) {
        this.showToast('Conectando... intenta enviar en unos segundos', 'warning');
      }
    }
    
    var appContainer = document.getElementById('app');
    if (appContainer) appContainer.classList.remove('hidden');
    var nameInput = document.getElementById('chat-contact-name');
    var subtitle = document.getElementById('chat-contact-subtitle');
    if (nameInput) nameInput.value = displayName;
    if (subtitle) subtitle.textContent = 'BLUETOOTH';
    
    window.dispatchEvent(new CustomEvent('nexo:ble:openChat', {
      detail: { contactId: uuid, name: displayName, address: mac, transport: 'ble', source: 'ble_interface' }
    }));
    
    this.togglePanel();
  }

  async removeContact(deviceUUID) {
    _removeBLEContact(deviceUUID);
    this.showToast('Eliminado', 'info');
    this.renderContactsList();
    this.renderNewDeviceBar();
  }

  async disconnect(deviceMAC) {
    if (this.isDummyMode) return;
    var mac = _normId(deviceMAC);
    try {
      this._cancelReconnect(mac);
      var device = this.connectedDevices.get(mac);
      var targetId = (device && device.id) || (device && device.address) || deviceMAC;
      if (this.nativePlugin) await this.nativePlugin.disconnectDevice({ deviceId: targetId });
      var uuid = this._macToUuidMap.get(mac);
      if (this._activeChatDeviceId === uuid || this._activeChatMAC === mac) {
        this._activeChatDeviceId = null;
        this._activeChatMAC = null;
        this.updateBadge();
      }
    } catch (err) {}
  }

  updateBadge() {
    // Badge ya no usado en esta UI, pero mantener compatibilidad
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
      if (this.nativePlugin && this.nativePlugin.isBluetoothEnabled) {
        var btState = await this.nativePlugin.isBluetoothEnabled();
        state = btState.enabled ? 'poweredOn' : 'poweredOff';
        this._serverReady = btState.serverReady || false;
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
    if (this._nativeAdStartedListener) this._nativeAdStartedListener.remove();
    if (this._nativeAdFailedListener) this._nativeAdFailedListener.remove();
    if (this._nativeDeviceFoundListener) this._nativeDeviceFoundListener.remove();
    if (this._nativeScanFailedListener) this._nativeScanFailedListener.remove();
    if (this._nativeDeviceConnectedListener) this._nativeDeviceConnectedListener.remove();
    if (this._nativeDeviceDisconnectedListener) this._nativeDeviceDisconnectedListener.remove();
    if (this._nativePayloadListener) this._nativePayloadListener.remove();
    if (this._nativeServicesReadyListener) this._nativeServicesReadyListener.remove();
    if (this._nativeNotificationsListener) this._nativeNotificationsListener.remove();
    if (this._nativeConnectionFailedListener) this._nativeConnectionFailedListener.remove();
    if (this._nativeServerReadyListener) this._nativeServerReadyListener.remove();
    if (this.isScanning) this.toggleScan();
  }
}

window.bleInterface = null;
