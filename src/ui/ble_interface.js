/**
 * BLE Interface v4.0.0-UUID-FIX
 * Ubicacion: src/ui/ble_interface.js
 * FIX v4.0.0-UUID: Identificacion estable por deviceUUID, no MAC address.
 *  - Genera deviceUUID persistente en localStorage
 *  - Incluye deviceUUID + deviceName en cada payload enviado
 *  - Extrae deviceUUID del payload recibido para identificar remitente
 *  - Elimina duplicados por MAC rotativa de Android
 */

export function initBLEInterface(bleMesh) {
  var instance = new BLEInterface(bleMesh).init();
  window.bleInterface = instance;
  return instance;
}

var BLE_CONTACTS_STORAGE_KEY = 'nexo_ble_contacts_v1';
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

function _addBLEContact(contact) {
  var contacts = _getBLEContacts();
  var uuid = _normId(contact.deviceUUID);
  if (!uuid) return false;
  
  // Buscar por UUID (identidad estable)
  var existingIdx = contacts.findIndex(function(c) {
    return _normId(c.deviceUUID) === uuid;
  });
  
  if (existingIdx >= 0) {
    // Actualizar nombre si cambió
    contacts[existingIdx].name = contact.name || contacts[existingIdx].name || 'NEXO Peer';
    contacts[existingIdx].macAddress = contact.macAddress || contacts[existingIdx].macAddress;
    contacts[existingIdx].lastSeen = Date.now();
    localStorage.setItem(BLE_CONTACTS_STORAGE_KEY, JSON.stringify(contacts));
    return true;
  }
  
  // Nuevo contacto
  contacts.push({
    deviceUUID: uuid,
    name: contact.name || 'NEXO Peer',
    macAddress: contact.macAddress || null,
    addedAt: Date.now(),
    lastSeen: Date.now()
  });
  localStorage.setItem(BLE_CONTACTS_STORAGE_KEY, JSON.stringify(contacts));
  return true;
}

function _removeBLEContact(deviceUUID) {
  var uuid = _normId(deviceUUID);
  var contacts = _getBLEContacts().filter(function(c) {
    return _normId(c.deviceUUID) !== uuid;
  });
  localStorage.setItem(BLE_CONTACTS_STORAGE_KEY, JSON.stringify(contacts));
}

function _isBLEContact(deviceUUID) {
  return _getBLEContacts().some(function(c) {
    return _normId(c.deviceUUID) === _normId(deviceUUID);
  });
}

function _getContactName(deviceUUID) {
  var uuid = _normId(deviceUUID);
  var c = _getBLEContacts().find(function(c) {
    return _normId(c.deviceUUID) === uuid;
  });
  return c ? c.name : null;
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

export class BLEInterface {
  constructor(bleMesh) {
    this.bleMesh = bleMesh;
    this.isScanning = false;
    this.foundDevices = new Map();      // key = MAC (temporal, solo para conexion)
    this.connectedDevices = new Map();   // key = MAC (temporal)
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
    this._activeChatDeviceId = null;     // Ahora es UUID, no MAC
    this._activeChatMAC = null;          // MAC para conexion nativa
    this._deviceStates = new Map();
    this._receivedMessageIds = new Set();
    this._maxMessageIds = 1000;
    this._pendingMessageQueue = new Map();
    this._reconnectTimers = new Map();
    this._serverReady = false;
    this._uuidToMacMap = new Map();      // UUID -> MAC actual
    this._macToUuidMap = new Map();      // MAC -> UUID conocido
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
    }
    console.log('[BLEInterface] UUID local:', this.localDeviceUUID);
    return this;
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
      // Intentar extraer UUID del advertisement si existe
      var peerUUID = data.deviceUUID || data.uuid || null;
      if (peerUUID) {
        self._macToUuidMap.set(mac, peerUUID);
        self._uuidToMacMap.set(peerUUID, mac);
      }
      self.onDeviceFound({ id: mac, address: mac, name: name, rssi: data.rssi, deviceUUID: peerUUID });
    });
    this._nativeScanFailedListener = this.nativePlugin.addListener('onScanFailed', function(data) {
      self.isScanning = false;
      self.onScanStateChanged(false);
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
      self.showToast('Servidor BLE listo', 'success');
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
      
      // Resolver nombre y UUID
      var peerUUID = self._macToUuidMap.get(mac);
      var contactName = peerUUID ? _getContactName(peerUUID) : null;
      var displayName = data.name || contactName || 'NEXO Peer';
      
      if (data.direction === 'incoming') {
        self._setDeviceState(mac, BLE_STATES.READY_TO_CHAT, { direction: 'incoming', role: 'peer_connected', deviceUUID: peerUUID });
        self.connectedDevices.set(mac, { id: mac, address: mac, name: displayName, direction: 'incoming', servicesReady: true, deviceUUID: peerUUID });
        self.showToast('Peer conectado: ' + self._formatId(mac), 'success');
      } else {
        self._setDeviceState(mac, BLE_STATES.CONNECTING, { direction: 'outgoing', attempt: attempt, role: 'client', deviceUUID: peerUUID });
        self.connectedDevices.set(mac, { id: mac, address: mac, name: displayName, direction: 'outgoing', servicesReady: false, deviceUUID: peerUUID });
      }
      self.onDeviceConnected({ id: mac, address: mac, name: displayName, direction: data.direction || 'unknown', servicesReady: data.servicesReady === true, attempt: attempt, deviceUUID: peerUUID });
    });

    this._nativeDeviceDisconnectedListener = this.nativePlugin.addListener('onDeviceDisconnected', function(data) {
      var mac = _normId(data.deviceId);
      self._setDeviceState(mac, BLE_STATES.DISCONNECTED);
      self.connectedDevices.delete(mac);
      self.onDeviceDisconnected({ id: mac, address: mac });
      // Si el chat activo usaba este MAC, reconectar
      if (self._activeChatMAC === mac) {
        self.showToast('Conexion BLE perdida. Reconectando...', 'warning');
        self._startReconnect(mac);
      }
    });
  }

  _startReconnect(deviceMAC) {
    this._cancelReconnect(deviceMAC);
    this._setDeviceState(deviceMAC, BLE_STATES.RECONNECTING, { message: 'Reconectando...' });
    var self = this;
    var attemptReconnect = async function() {
      if (self._activeChatMAC !== deviceMAC) return;
      try {
        console.log('[BLEInterface] Force reconnect a', deviceMAC, '...');
        await self.nativePlugin.forceReconnect({ deviceId: deviceMAC });
      } catch (e) {
        console.warn('[BLEInterface] Force reconnect fallo:', e.message);
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
      self._setDeviceState(mac, BLE_STATES.READY_TO_CHAT, { notificationsEnabled: true, direction: (self._getDeviceState(mac).direction || 'unknown'), deviceUUID: peerUUID });
      self._processPendingMessages(mac);
    });
    this._nativeConnectionFailedListener = this.nativePlugin.addListener('onConnectionFailed', function(data) {
      var mac = _normId(data.deviceId);
      if (data.recoverable !== false && data.attempt < (data.maxAttempts || 3)) {
        self._setDeviceState(mac, BLE_STATES.CONNECTING, { attempt: data.attempt, message: 'Reintentando...' });
      } else {
        self._setDeviceState(mac, BLE_STATES.ERROR, { lastError: data.reason });
        self.showToast('Conexion fallada: ' + data.reason, 'error');
      }
    });
  }

  _setDeviceState(deviceMAC, state, meta) {
    meta = meta || {};
    var nid = _normId(deviceMAC);
    this._deviceStates.set(nid, { state: state, ...meta, timestamp: Date.now() });
    this.renderConnectedList();
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
      
      // Parsear payload JSON
      try {
        var json = JSON.parse(data.data || '{}');
        if (json.messageId) messageId = json.messageId;
        if (json.senderName) senderName = json.senderName;
        if (json.deviceUUID) senderUUID = json.deviceUUID;
        if (json.content) content = json.content;
      } catch (e) {
        // Payload no es JSON, usar como texto plano
      }
      
      // Si no hay UUID en payload, intentar del mapeo MAC->UUID
      if (!senderUUID) {
        senderUUID = self._macToUuidMap.get(mac);
      }
      
      // Si descubrimos UUID nuevo, guardar mapeo
      if (senderUUID) {
        self._macToUuidMap.set(mac, senderUUID);
        self._uuidToMacMap.set(senderUUID, mac);
      }
      
      // Resolver nombre final
      if (!senderName || senderName === 'NEXO Peer') {
        senderName = _getContactName(senderUUID)
          || (self.connectedDevices.get(mac) && self.connectedDevices.get(mac).name)
          || (self.foundDevices.get(mac) && self.foundDevices.get(mac).name)
          || 'NEXO Peer';
      }
      
      // Auto-registrar contacto si es nuevo y tenemos UUID
      if (senderUUID && !_isBLEContact(senderUUID) && senderName && senderName !== 'NEXO Peer') {
        _addBLEContact({ deviceUUID: senderUUID, name: senderName, macAddress: mac });
      }
      
      // Dedup por messageId
      if (messageId && self._receivedMessageIds.has(messageId)) return;
      if (messageId) {
        self._receivedMessageIds.add(messageId);
        if (self._receivedMessageIds.size > self._maxMessageIds) {
          var first = self._receivedMessageIds.values().next().value;
          self._receivedMessageIds.delete(first);
        }
      }
      
      // Usar UUID como deviceId para el evento (identidad estable)
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
      
      // Si chat activo con este UUID, no mostrar toast
      var activeUUID = self._activeChatDeviceId;
      if (activeUUID && activeUUID === senderUUID) {
        return;
      }
      
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
    
    // Enriquecer payload con UUID y nombre local
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
      self.showToast('Visibilidad activada', 'success');
    });
    this._nativeAdFailedListener = this.nativePlugin.addListener('onAdvertiseFailed', function() {
      self.isAdvertising = false;
      self.updateVisibilityButton();
      self.showToast('Error al activar visibilidad', 'error');
    });
  }

  updateVisibilityButton() {
    var btn = this.elements.visibilityBtn;
    if (!btn) return;
    var icon = btn.querySelector('.btn-icon');
    var text = btn.querySelector('span:last-child');
    if (!this.canAdvertise) {
      btn.className = 'ble-btn-visibility btn-visibility-warning';
      if (icon) icon.textContent = 'WARN';
      if (text) text.textContent = 'Visibilidad desactivada';
    } else if (!this.isAdvertising) {
      btn.className = 'ble-btn-visibility btn-visibility-off';
      if (icon) icon.textContent = 'EYE';
      if (text) text.textContent = 'Visibilidad';
    } else {
      btn.className = 'ble-btn-visibility btn-visibility-on';
      if (icon) icon.textContent = 'EYE';
      if (text) text.textContent = 'Visible';
    }
  }

  async toggleVisibility() {
    if (this.isDummyMode) return;

    var permsReady = false;
    try {
      var shim = window.permissionShim || (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.NexoBLE);
      if (window.ensureBLEPermissions) {
        permsReady = await window.ensureBLEPermissions();
      } else if (shim && shim.ensure) {
        permsReady = await shim.ensure();
      } else {
        permsReady = true;
      }
    } catch (e) {
      console.warn('[BLEInterface] Shim no disponible para permisos, continuando...');
      permsReady = true;
    }

    if (!permsReady) {
      this.showToast('Permisos BLE requeridos. Concede los permisos en Ajustes.', 'warning', 5000);
      return;
    }

    if (!this._serverReady) {
      try {
        this.showToast('Inicializando servidor BLE...', 'info');
        await this.nativePlugin.initializeBLE({
          userId: (window.currentUser && window.currentUser.id) || '',
          userName: (window.currentUser && window.currentUser.name) || 'NEXO User'
        });
        await new Promise(function(resolve, reject) {
          var timeout = setTimeout(function() {
            reject(new Error('Timeout esperando servidor BLE'));
          }, 8000);
          var check = function() {
            if (this._serverReady) { clearTimeout(timeout); resolve(); }
            else { setTimeout(check, 200); }
          }.bind(this);
          check();
        }.bind(this));
      } catch (e) {
        console.error('[BLEInterface] Error inicializando servidor:', e.message);
        this.showToast('No se pudo inicializar servidor BLE: ' + e.message, 'error', 5000);
        return;
      }
    }

    try {
      var btState = await this.nativePlugin.isBluetoothEnabled();
      this.canAdvertise = btState.canAdvertise || false;
    } catch (e) {}

    if (!this.canAdvertise) {
      this.showToast('Sin permiso de advertising', 'warning');
      return;
    }

    try {
      if (this.isAdvertising) {
        await this.nativePlugin.stopAdvertising();
        this.isAdvertising = false;
      } else {
        await this.nativePlugin.startAdvertising();
      }
      this.updateVisibilityButton();
    } catch (err) {
      this.showToast('Error: ' + err.message, 'error');
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
    panel.innerHTML = '<div class="ble-header"><h3>BLE Mesh</h3><button id="ble-close">X</button></div><div class="ble-tabs"><button class="ble-tab-btn active" data-tab="devices">Dispositivos</button><button class="ble-tab-btn" data-tab="added">Contactos</button><button class="ble-tab-btn" data-tab="connected">Conectados</button></div><div class="ble-main-controls"><button id="ble-visibility-btn" class="ble-btn-visibility btn-visibility-off"><span class="btn-icon">EYE</span><span>Visibilidad</span></button><button id="ble-scan-btn" class="ble-btn-discover"><span id="text-discover">Descubrir</span></button></div><div class="ble-secondary-controls"><span id="ble-status" class="ble-status-offline">OFFLINE</span></div><div id="tab-devices" class="ble-tab-content active"><div id="ble-devices-list" class="ble-list"><div class="ble-empty">Presiona Descubrir para encontrar dispositivos cercanos</div></div></div><div id="tab-added" class="ble-tab-content"><div id="ble-added-list" class="ble-list"><div class="ble-empty">No hay contactos agregados</div></div></div><div id="tab-connected" class="ble-tab-content"><div id="ble-connected-list" class="ble-list"><div class="ble-empty">No hay dispositivos conectados</div></div></div>';
    document.body.appendChild(panel);
    this.elements.panel = panel;

    var overlay = document.createElement('div');
    overlay.id = 'ble-overlay';
    document.body.appendChild(overlay);
    this.elements.overlay = overlay;

    this.elements.visibilityBtn = document.getElementById('ble-visibility-btn');
    this.elements.scanBtn = document.getElementById('ble-scan-btn');
    this.elements.closeBtn = document.getElementById('ble-close');
    this.elements.devicesList = document.getElementById('ble-devices-list');
    this.elements.addedList = document.getElementById('ble-added-list');
    this.elements.connectedList = document.getElementById('ble-connected-list');
    this.elements.status = document.getElementById('ble-status');
    this.elements.badge = document.getElementById('ble-tab-badge');
  }

  injectStyles() {
    if (document.getElementById('ble-styles')) return;
    var style = document.createElement('style');
    style.id = 'ble-styles';
    style.textContent = `
      #ble-tab { position: fixed; left: 0; top: 50%; transform: translateY(-50%); width: 44px; height: 100px; background: linear-gradient(180deg, #00d4ff, #0099cc); border-radius: 0 12px 12px 0; display: flex; flex-direction: column; align-items: center; justify-content: center; cursor: pointer; z-index: 2147483644; color: #000; font-weight: bold; }
      .ble-tab-badge { position: absolute; top: 5px; right: -5px; background: #ff4444; color: white; width: 18px; height: 18px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 10px; animation: pulse 2s infinite; }
      @keyframes pulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.1); } }
      #ble-panel { position: fixed; top: 0; left: 0; width: 85vw; max-width: 400px; height: 100vh; background: rgba(10,10,15,0.98); transform: translateX(-100%); transition: transform 0.3s ease; z-index: 2147483645; color: #fff; padding: 20px; overflow-y: auto; }
      #ble-panel.active { transform: translateX(0); }
      #ble-overlay { position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.6); display: none; z-index: 2147483644; backdrop-filter: blur(4px); }
      #ble-overlay.active { display: block; }
      .ble-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px; border-bottom: 1px solid #333; padding-bottom: 10px; }
      .ble-tabs { display: flex; gap: 8px; margin-bottom: 15px; }
      .ble-tab-btn { flex: 1; padding: 10px 4px; background: #222; border: 1px solid #333; border-radius: 6px; color: #888; cursor: pointer; font-size: 11px; }
      .ble-tab-btn.active { background: linear-gradient(135deg, #00d4ff, #0099cc); color: #000; font-weight: bold; border-color: #00d4ff; }
      .ble-tab-content { display: none; }
      .ble-tab-content.active { display: block; }
      .ble-main-controls { display: flex; gap: 12px; justify-content: center; align-items: center; margin-bottom: 10px; }
      .ble-secondary-controls { margin-bottom: 15px; display: flex; justify-content: space-between; align-items: center; }
      .ble-btn-visibility { flex: 1; max-width: 140px; height: 48px; border-radius: 12px; border: none; font-weight: 600; font-size: 13px; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 6px; transition: all 0.3s ease; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .ble-btn-visibility.btn-visibility-warning { background: #4A3A00 !important; color: #FFCC00 !important; border: 1px solid #FFCC00 !important; }
      .ble-btn-visibility.btn-visibility-off { background: #3A3A3A; color: #888888; }
      .ble-btn-visibility.btn-visibility-on { background: #00D9FF; color: #000000; box-shadow: 0 0 12px rgba(0, 217, 255, 0.4); }
      .ble-btn-discover { flex: 1.2; height: 56px; border-radius: 14px; border: none; font-weight: 700; font-size: 15px; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 8px; background: linear-gradient(135deg, #00d4ff, #0099cc); color: #000; box-shadow: 0 4px 15px rgba(0, 212, 255, 0.3); transition: all 0.3s ease; }
      .ble-btn-discover.scanning { background: linear-gradient(135deg, #ff4444, #cc0000); color: #fff; animation: pulse-red 1.5s infinite; }
      @keyframes pulse-red { 0%, 100% { box-shadow: 0 0 0 0 rgba(255, 68, 68, 0.4); } 50% { box-shadow: 0 0 0 10px rgba(255, 68, 68, 0); } }
      #ble-status { font-size: 12px; padding: 4px 8px; border-radius: 4px; }
      .ble-status-offline { background: #333; color: #888; }
      .ble-status-online { background: #00d4ff; color: #000; }
      .ble-status-scanning { background: #ffaa00; color: #000; animation: blink 1s infinite; }
      @keyframes blink { 0%, 50% { opacity: 1; } 51%, 100% { opacity: 0.7; } }
      .ble-list { display: flex; flex-direction: column; gap: 8px; max-height: calc(100vh - 300px); overflow-y: auto; }
      .ble-empty { text-align: center; color: #666; padding: 20px; font-style: italic; }
      .ble-device-item { display: flex; align-items: center; justify-content: space-between; padding: 12px; background: rgba(255,255,255,0.05); border: 1px solid #333; border-radius: 8px; cursor: pointer; transition: all 0.2s; }
      .ble-device-item:hover { background: rgba(0,212,255,0.1); border-color: #00d4ff; }
      .ble-device-item.new { border-left: 3px solid #00d4ff; animation: slideIn 0.3s ease; }
      @keyframes slideIn { from { opacity: 0; transform: translateX(-10px); } to { opacity: 1; transform: translateX(0); } }
      .ble-device-info { display: flex; flex-direction: column; flex: 1; min-width: 0; }
      .ble-device-name { font-weight: bold; color: #fff; }
      .ble-device-id { font-size: 11px; color: #888; }
      .ble-device-rssi { font-size: 12px; color: #00d4ff; }
      .ble-device-actions { display: flex; gap: 8px; align-items: center; flex-shrink: 0; }
      .ble-btn-add { padding: 8px 16px; background: #00ff88; color: #000; border: none; border-radius: 6px; cursor: pointer; font-size: 12px; font-weight: bold; }
      .ble-btn-write { padding: 8px 16px; background: #00d4ff; color: #000; border: none; border-radius: 6px; cursor: pointer; font-size: 12px; font-weight: bold; }
      .ble-btn-write:disabled { background: #555; color: #aaa; cursor: not-allowed; }
      .ble-btn-disconnect { padding: 6px 12px; background: #ff4444; color: #fff; border: none; border-radius: 4px; cursor: pointer; font-size: 12px; }
      .ble-toast { position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%); padding: 12px 24px; border-radius: 8px; color: #fff; font-weight: bold; z-index: 2147483646; animation: fadeInUp 0.3s ease; }
      .ble-toast.success { background: #00d4ff; color: #000; }
      .ble-toast.error { background: #ff4444; }
      .ble-toast.warning { background: #ffaa00; color: #000; }
      .ble-toast.info { background: #444; }
      @keyframes fadeInUp { from { opacity: 0; transform: translateX(-50%) translateY(20px); } to { opacity: 1; transform: translateX(-50%) translateY(0); } }
      .ble-state-connecting { color: #ffaa00; font-size: 11px; }
      .ble-state-ready { color: #00ff88; font-size: 11px; }
      .ble-state-error { color: #ff4444; font-size: 11px; }
      .ble-state-reconnecting { color: #ffaa00; font-size: 11px; animation: blink 1s infinite; }
    `;
    document.head.appendChild(style);
  }

  setupEventListeners() {
    var self = this;
    this.elements.tab.addEventListener('click', function() { self.togglePanel(); });
    this.elements.closeBtn.addEventListener('click', function() { self.togglePanel(); });
    this.elements.overlay.addEventListener('click', function() { self.togglePanel(); });
    this.elements.visibilityBtn.addEventListener('click', function() { self.toggleVisibility(); });
    this.elements.scanBtn.addEventListener('click', function() { self.toggleScan(); });
    document.querySelectorAll('.ble-tab-btn').forEach(function(btn) {
      btn.addEventListener('click', function(e) { self.switchTab(e.target.dataset.tab); });
    });
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
      this._loadConnectedDevices();
      this.renderAddedList();
    }
  }

  switchTab(tabName) {
    document.querySelectorAll('.ble-tab-btn').forEach(function(btn) { btn.classList.remove('active'); });
    document.querySelectorAll('.ble-tab-content').forEach(function(content) { content.classList.remove('active'); });
    document.querySelector('[data-tab="' + tabName + '"]').classList.add('active');
    document.getElementById('tab-' + tabName).classList.add('active');
    if (tabName === 'added') this.renderAddedList();
  }

  async toggleScan() {
    if (this.isDummyMode) return;

    var permsReady = false;
    try {
      if (window.ensureBLEPermissions) {
        permsReady = await window.ensureBLEPermissions();
      } else if (window.permissionShim && window.permissionShim.ensureBLEPermissions) {
        permsReady = await window.permissionShim.ensureBLEPermissions();
      } else {
        permsReady = true;
      }
    } catch (e) {
      console.warn('[BLEInterface] Shim no disponible para scan, continuing...');
      permsReady = true;
    }

    if (!permsReady) {
      this.showToast('Permisos BLE requeridos. Concede los permisos en Ajustes.', 'warning', 5000);
      return;
    }

    try {
      if (this.isScanning) {
        if (this.nativePlugin) await this.nativePlugin.stopScan();
        this.isScanning = false;
        this.onScanStateChanged(false);
      } else {
        this.foundDevices.clear();
        this._renderedDeviceIds.clear();
        this.renderDevicesList();
        if (this.nativePlugin) await this.nativePlugin.startScan();
        this.isScanning = true;
        this.onScanStateChanged(true);
      }
    } catch (err) {
      this.isScanning = false;
      this.onScanStateChanged(false);
    }
  }

  onScanStateChanged(isScanning) {
    this.isScanning = isScanning;
    var btn = this.elements.scanBtn;
    var text = document.getElementById('text-discover');
    if (isScanning) {
      btn.classList.add('scanning');
      if (text) text.textContent = 'Detener';
      this.elements.status.textContent = 'ESCANEANDO...';
      this.elements.status.className = 'ble-status-scanning';
      this.showToast('Buscando dispositivos...', 'info');
    } else {
      btn.classList.remove('scanning');
      if (text) text.textContent = 'Descubrir';
      this.updateStatus();
    }
  }

  onDeviceFound(device) {
    var mac = _normId(device.id || device.address);
    if (!mac || mac === 'null' || mac === 'undefined') return;
    if (this.localDeviceAddress && mac === this.localDeviceAddress) return;

    // Guardar mapeo UUID->MAC si lo tenemos
    if (device.deviceUUID) {
      this._macToUuidMap.set(mac, device.deviceUUID);
      this._uuidToMacMap.set(device.deviceUUID, mac);
    }

    if (this.foundDevices.has(mac)) {
      var existing = this.foundDevices.get(mac);
      existing.rssi = device.rssi;
      existing.name = device.name || existing.name;
      existing.deviceUUID = device.deviceUUID || existing.deviceUUID;
      existing.lastSeen = Date.now();
      this.foundDevices.set(mac, existing);
      this.renderDevicesList();
      return;
    }
    device.lastSeen = Date.now();
    this.foundDevices.set(mac, device);
    this.newDevicesCount++;
    this.updateBadge();
    this.renderDevicesList();
  }

  onDeviceConnected(device) {
    var mac = _normId(device.id || device.address);
    this.connectedDevices.set(mac, device);
    this.renderConnectedList();
    this.showToast('Conectado: ' + (device.name || 'Dispositivo'), 'success');
  }

  onDeviceDisconnected(device) {
    var mac = _normId(device.id || device.address);
    this.connectedDevices.delete(mac);
    this.renderConnectedList();
    this.showToast('Desconectado', 'info');
  }

  async _loadConnectedDevices() {
    if (this.isDummyMode) return;
    try {
      var devices = [];
      if (this.nativePlugin && this.nativePlugin.getConnectedDevices) {
        var result = await this.nativePlugin.getConnectedDevices();
        devices = result.devices || [];
      }
      this.connectedDevices.clear();
      devices.forEach(function(d) {
        var mac = _normId(d.id || d.address || d.deviceId);
        this.connectedDevices.set(mac, { ...d, id: mac, address: mac });
      }.bind(this));
      this.renderConnectedList();
    } catch (err) {}
  }

  async addContact(deviceMAC) {
    var mac = _normId(deviceMAC);
    var device = this.foundDevices.get(mac) || this.connectedDevices.get(mac);
    if (!device) { this.showToast('Dispositivo no encontrado', 'error'); return; }
    
    var uuid = device.deviceUUID || this._macToUuidMap.get(mac);
    if (!uuid) {
      // Si no tenemos UUID, generar uno derivado del MAC (fallback)
      uuid = 'mac-' + mac.replace(/:/g, '');
      this._macToUuidMap.set(mac, uuid);
      this._uuidToMacMap.set(uuid, mac);
    }
    
    if (_addBLEContact({ deviceUUID: uuid, name: device.name || 'NEXO Peer', macAddress: mac })) {
      this.showToast('Agregado a contactos', 'success');
      this.renderDevicesList();
    } else {
      this.showToast('Ya esta en contactos', 'warning');
    }
  }

  async removeContact(deviceUUID) {
    _removeBLEContact(deviceUUID);
    this.showToast('Eliminado', 'info');
    this.renderAddedList();
    this.renderDevicesList();
  }

  async openChat(deviceMAC) {
    var mac = _normId(deviceMAC);
    var device = this.foundDevices.get(mac) || this.connectedDevices.get(mac);
    var contact = _getContactByUUID(deviceMAC); // Puede ser UUID directo
    
    // Resolver UUID y nombre
    var uuid = device ? (device.deviceUUID || this._macToUuidMap.get(mac)) : deviceMAC;
    var displayName = (contact && contact.name) || (device && device.name) || 'NEXO Peer';
    
    if (!uuid) {
      // Fallback: usar MAC como UUID si no hay otro
      uuid = 'mac-' + mac.replace(/:/g, '');
      this._macToUuidMap.set(mac, uuid);
      this._uuidToMacMap.set(uuid, mac);
    }
    
    this._activeChatDeviceId = uuid;
    this._activeChatMAC = mac;
    this.newDevicesCount = 0;
    this.updateBadge();

    var state = this._getDeviceState(mac);
    var isFullyReady = state.state === BLE_STATES.READY_TO_CHAT || state.state === BLE_STATES.NOTIFICATIONS_READY;
    var isConnecting = state.state === BLE_STATES.CONNECTING || state.state === BLE_STATES.DISCOVERING_SERVICES;

    if (!isFullyReady && isConnecting && this.nativePlugin) {
      this.showToast('Conexion en progreso, esperando canal...', 'info');
      try {
        await new Promise(function(resolve, reject) {
          var timeout = setTimeout(function() { reject(new Error('Timeout')); }, 15000);
          var checkReady = function() {
            var s = this._getDeviceState(mac);
            if (s.state === BLE_STATES.NOTIFICATIONS_READY || s.state === BLE_STATES.READY_TO_CHAT) {
              clearTimeout(timeout);
              resolve();
            } else {
              setTimeout(checkReady, 300);
            }
          }.bind(this);
          checkReady();
        }.bind(this));
      } catch (e) {
        this.showToast('Canal aun no listo. Intente enviar en unos segundos.', 'warning');
      }
    }

    if (!isFullyReady && !isConnecting && this.nativePlugin) {
      var permsReady = false;
      try {
        if (window.ensureBLEPermissions) permsReady = await window.ensureBLEPermissions();
        else permsReady = true;
      } catch (e) { permsReady = true; }

      if (!permsReady) {
        this.showToast('Permisos BLE requeridos para conectar', 'warning', 5000);
        return;
      }

      try {
        console.log('[BLEInterface] Conectando a', mac, '...');
        var connResult = await this.nativePlugin.connectToDevice({ deviceId: device.id || device.address || mac });
        console.log('[BLEInterface] connectToDevice result:', connResult);
        if (connResult && connResult.connected && !connResult.alreadyConnected) {
          this.showToast('Conectando canal BLE...', 'info');
          await new Promise(function(resolve, reject) {
            var timeout = setTimeout(function() { reject(new Error('Timeout')); }, 15000);
            var checkReady = function() {
              var s = this._getDeviceState(mac);
              if (s.state === BLE_STATES.NOTIFICATIONS_READY || s.state === BLE_STATES.READY_TO_CHAT) {
                clearTimeout(timeout);
                resolve();
              } else {
                setTimeout(checkReady, 300);
              }
            }.bind(this);
            checkReady();
          }.bind(this));
        }
      } catch (e) {
        console.warn('[BLEInterface] Conexion/timeout:', e.message);
        this.showToast('Canal aun no listo. Intente enviar en unos segundos.', 'warning');
      }
    }

    var appContainer = document.getElementById('app');
    if (appContainer) appContainer.classList.remove('hidden');
    var nameInput = document.getElementById('chat-contact-name');
    var subtitle = document.getElementById('chat-contact-subtitle');
    if (nameInput) nameInput.value = displayName;
    if (subtitle) subtitle.textContent = 'BLUETOOTH';

    window.dispatchEvent(new CustomEvent('nexo:ble:openChat', {
      detail: { contactId: uuid, name: displayName, address: mac, transport: 'ble', rssi: device ? device.rssi : null, source: 'ble_interface' }
    }));

    this.elements.panel.classList.remove('active');
    this.elements.overlay.classList.remove('active');
  }

  renderDevicesList() {
    var list = this.elements.devicesList;
    if (this.foundDevices.size === 0) {
      list.innerHTML = '<div class="ble-empty">Presiona Descubrir para encontrar dispositivos cercanos</div>';
      return;
    }
    list.innerHTML = '';
    var self = this;
    this.foundDevices.forEach(function(device, mac) {
      var uuid = device.deviceUUID || self._macToUuidMap.get(mac);
      var isAdded = uuid ? _isBLEContact(uuid) : false;
      var isNew = !self._renderedDeviceIds.has(mac);
      if (isNew) self._renderedDeviceIds.add(mac);
      var item = document.createElement('div');
      item.className = 'ble-device-item' + (isNew ? ' new' : '');
      
      var infoDiv = document.createElement('div');
      infoDiv.className = 'ble-device-info';
      infoDiv.innerHTML = '<div class="ble-device-name">' + (device.name || 'NEXO Device') + '</div><div class="ble-device-id">' + self._formatId(mac) + '</div><div class="ble-device-rssi">RSSI: ' + (device.rssi || '?') + ' dBm</div>';
      item.appendChild(infoDiv);
      
      var actionsDiv = document.createElement('div');
      actionsDiv.className = 'ble-device-actions';
      if (!isAdded) {
        var addBtn = document.createElement('button');
        addBtn.className = 'ble-btn-add';
        addBtn.textContent = '+';
        addBtn.addEventListener('click', function() { self.addContact(mac); });
        actionsDiv.appendChild(addBtn);
      }
      var chatBtn = document.createElement('button');
      chatBtn.className = 'ble-btn-write';
      chatBtn.textContent = 'Chat';
      chatBtn.addEventListener('click', function() { self.openChat(mac); });
      actionsDiv.appendChild(chatBtn);
      item.appendChild(actionsDiv);
      
      list.appendChild(item);
    });
  }

  renderAddedList() {
    var list = this.elements.addedList;
    var contacts = _getBLEContacts();
    if (contacts.length === 0) {
      list.innerHTML = '<div class="ble-empty">No hay contactos agregados</div>';
      return;
    }
    list.innerHTML = '';
    var self = this;
    contacts.forEach(function(contact) {
      var uuid = _normId(contact.deviceUUID);
      var item = document.createElement('div');
      item.className = 'ble-device-item';
      
      var infoDiv = document.createElement('div');
      infoDiv.className = 'ble-device-info';
      infoDiv.innerHTML = '<div class="ble-device-name">' + (contact.name || 'NEXO Device') + '</div><div class="ble-device-id">' + self._formatId(uuid) + '</div>';
      item.appendChild(infoDiv);
      
      var actionsDiv = document.createElement('div');
      actionsDiv.className = 'ble-device-actions';
      var chatBtn = document.createElement('button');
      chatBtn.className = 'ble-btn-write';
      chatBtn.textContent = 'Chat';
      chatBtn.addEventListener('click', function() { self.openChat(uuid); });
      actionsDiv.appendChild(chatBtn);
      var removeBtn = document.createElement('button');
      removeBtn.className = 'ble-btn-disconnect';
      removeBtn.textContent = 'X';
      removeBtn.addEventListener('click', function() { self.removeContact(uuid); });
      actionsDiv.appendChild(removeBtn);
      item.appendChild(actionsDiv);
      
      list.appendChild(item);
    });
  }

  renderConnectedList() {
    var list = this.elements.connectedList;
    if (this.connectedDevices.size === 0) {
      list.innerHTML = '<div class="ble-empty">No hay dispositivos conectados</div>';
      return;
    }
    list.innerHTML = '';
    var self = this;
    this.connectedDevices.forEach(function(device, mac) {
      var state = self._getDeviceState(mac);
      var stateLabel = self._renderStateLabel(state);
      var isReady = state.state === BLE_STATES.NOTIFICATIONS_READY || state.state === BLE_STATES.READY_TO_CHAT;
      var item = document.createElement('div');
      item.className = 'ble-device-item';
      
      var infoDiv = document.createElement('div');
      infoDiv.className = 'ble-device-info';
      infoDiv.innerHTML = '<div class="ble-device-name">' + (device.name || 'NEXO Peer') + '</div><div class="ble-device-id">' + self._formatId(mac) + '</div><div class="ble-device-rssi">* ' + (device.direction || 'Conectado') + ' ' + stateLabel + '</div>';
      item.appendChild(infoDiv);
      
      var actionsDiv = document.createElement('div');
      actionsDiv.className = 'ble-device-actions';
      var chatBtn = document.createElement('button');
      chatBtn.className = 'ble-btn-write';
      chatBtn.textContent = 'Chat';
      chatBtn.disabled = !isReady;
      chatBtn.addEventListener('click', function() { self.openChat(mac); });
      actionsDiv.appendChild(chatBtn);
      var disconnectBtn = document.createElement('button');
      disconnectBtn.className = 'ble-btn-disconnect';
      disconnectBtn.textContent = 'Desconectar';
      disconnectBtn.addEventListener('click', function() { self.disconnect(mac); });
      actionsDiv.appendChild(disconnectBtn);
      item.appendChild(actionsDiv);
      
      list.appendChild(item);
    });
  }

  _renderStateLabel(state) {
    if (!state || !state.state) return '';
    switch (state.state) {
      case BLE_STATES.CONNECTING: return 'WAIT ' + (state.message || 'Conectando...');
      case BLE_STATES.DISCOVERING_SERVICES: return 'FIND Descubriendo...';
      case BLE_STATES.NOTIFICATIONS_READY: return 'OK Canal listo';
      case BLE_STATES.READY_TO_CHAT: return 'OK Listo';
      case BLE_STATES.ERROR: return 'ERR ' + (state.lastError || 'Error');
      case BLE_STATES.RECONNECTING: return 'SYNC ' + (state.message || 'Reconectando...');
      default: return '';
    }
  }

  async connect(deviceId) {
    if (this.isDummyMode) return;
    try {
      if (this.nativePlugin) await this.nativePlugin.connectToDevice({ deviceId: deviceId });
    } catch (err) { this.showToast('Error al conectar', 'error'); }
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
    var badge = this.elements.badge;
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

  _formatId(id) {
    if (!id) return '??';
    return id.substring(0, 8) + '...' + id.substring(id.length - 4);
  }

  destroy() {
    var styles = document.getElementById('ble-styles');
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
