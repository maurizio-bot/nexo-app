/**
 * BLE Interface v5.1.3-DEDUP
 * FIX: Deduplicación de contactos por MAC + elimina contactos temporales mac-xxx al recibir UUID real
 * FIX: Botón back en panel BLE para volver a pantalla NEXO
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
   var BLE_PINNED_CONTACTS_KEY = 'nexo_ble_pinned_contacts';
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
   function _saveMacMaps(uuidToMacMap, macToUuidMap) {
   try {
   var u2m = {};
   uuidToMacMap.forEach(function(v, k) { u2m[k] = v; });
   var m2u = {};
   macToUuidMap.forEach(function(v, k) { m2u[k] = v; });
   localStorage.setItem(BLE_MAC_MAP_STORAGE_KEY, JSON.stringify(u2m));
   localStorage.setItem(BLE_UUID_MAP_STORAGE_KEY, JSON.stringify(m2u));
   } catch (e) {}
   }
   function _loadMacMaps() {
   try {
   var u2mRaw = localStorage.getItem(BLE_MAC_MAP_STORAGE_KEY);
   var m2uRaw = localStorage.getItem(BLE_UUID_MAP_STORAGE_KEY);
   return {
   uuidToMac: u2mRaw ? JSON.parse(u2mRaw) : {},
   macToUuid: m2uRaw ? JSON.parse(m2uRaw) : {}
   };
   } catch (e) { return { uuidToMac: {}, macToUuid: {} }; }
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
   m = m.replace(/[:.-]/g, '');
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
   try { var raw = localStorage.getItem(BLE_CONTACTS_STORAGE_KEY); return raw ? JSON.parse(raw) : []; }
   catch (e) { return []; }
   }
   function _saveBLEContacts(contacts) {
   try { localStorage.setItem(BLE_CONTACTS_STORAGE_KEY, JSON.stringify(contacts)); } catch (e) {}
   }
   function _addBLEContact(contact) {
   var contacts = _getBLEContacts();
   var uuid = _normId(contact.deviceUUID);
   if (!uuid) return false;
   var existingIdx = contacts.findIndex(function(c) { return _normId(c.deviceUUID) === uuid; });
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
   deviceUUID: uuid, name: contact.name || 'NEXO Peer', macAddress: macNorm || null,
   addedAt: Date.now(), lastSeen: Date.now(), online: true, unreadCount: 0, lastMessage: ''
   });
   _saveBLEContacts(contacts);
   return true;
   }
   function _removeBLEContact(deviceUUID) {
   var uuid = _normId(deviceUUID);
   var contacts = _getBLEContacts().filter(function(c) { return _normId(c.deviceUUID) !== uuid; });
   _saveBLEContacts(contacts);
   }
   function _isBLEContact(deviceUUID) {
   return _getBLEContacts().some(function(c) { return _normId(c.deviceUUID) === _normId(deviceUUID); });
   }
   function _getContactByUUID(deviceUUID) {
   var uuid = _normId(deviceUUID);
   return _getBLEContacts().find(function(c) { return _normId(c.deviceUUID) === uuid; });
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
   var result;
   if (args && typeof args === 'object' && !Array.isArray(args)) {
   result = pluginmethod;
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
   try { window.dispatchEvent(new CustomEvent(eventName, { detail: detail })); } catch (e) {}
   }
   function _clearStaleCache() {
   try {
   var now = Date.now();
   var lastClear = localStorage.getItem('nexo_ble_lastCacheClear');
   if (!lastClear || (now - parseInt(lastClear, 10)) > 300000) {
   var validContacts = [];
   var contactsRaw = localStorage.getItem(BLE_CONTACTS_STORAGE_KEY);
   if (contactsRaw) {
   try {
   var contacts = JSON.parse(contactsRaw);
   validContacts = contacts.filter(function(c) { return c && c.macAddress && _normMac(c.macAddress).length >= 6; });
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
   }
   } catch(e) {}
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
   console.log('[BLEInterface] GALA v5.1.3-DEDUP iniciado');
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
   this.setupEventListeners();
   if (!this.nativePlugin) {
   this.nativePlugin = (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.NexoBLE) || null;
   if (this.nativePlugin) this.isDummyMode = !this.bleMesh && !this.nativePlugin;
   }
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
   this._rebuildMacMaps();
   this._initVisibility();
   this._autoStartAdvertising();
   }
   this._setupAppStateListener();
   /* FIX: Pantalla NEXO al arrancar, NO panel de contactos */
   this.elements.panel.classList.remove('active');
   this.elements.overlay.classList.remove('active');
   this.renderContactsList();
   this.renderOnlineStrip();
   /* Forzar FAB visible en pantalla principal al inicio */
   if (this.elements.fabBtn) this.elements.fabBtn.style.display = 'flex';
   console.log('[BLEInterface] UUID local:', this.localDeviceUUID);
   return this;
   }
   _setupAppStateListener() {
   var self = this;
   if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App) {
   var appPlugin = window.Capacitor.Plugins.App;
   if (_hasNativeMethod(appPlugin, 'addListener')) {
   appPlugin.addListener('appStateChange', function(state) {
   try {
   if (state && state.isActive === true) {
   console.log('[BLEInterface] App volvio a primer plano');
   if (!self.isAdvertising && self.nativePlugin && _hasNativeMethod(self.nativePlugin, 'startAdvertising')) {
   _safeNativeCall(self.nativePlugin, 'startAdvertising', {})
   .then(function() { self.isAdvertising = true; self.updateVisibilityButton(); })
   .catch(function(e) { console.warn('[BLEInterface] Fallo reactivar EYE:', e.message); });
   }
   }
   } catch (e) {}
   });
   }
   }
   }
   _rebuildMacMaps() {
   var self = this;
   var contacts = _getBLEContacts();
   contacts.forEach(function(contact) {
   var uuid = _normId(contact.deviceUUID);
   var mac = _normMac(contact.macAddress);
   if (uuid && mac) { self._macToUuidMap.set(mac, uuid); self._uuidToMacMap.set(uuid, mac); }
   });
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
   .catch(function(e) { console.warn('[BLEInterface] Auto-advertise fallo:', e.message); });
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
   if (!mac) return;
   self.onDeviceFound({ id: mac, address: mac, name: name, rssi: data.rssi });
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
   var mac = _normMac(data.deviceId);
   if (!mac) return;
   var peerUUID = self._macToUuidMap.get(mac);
   var contact = peerUUID ? _getContactByUUID(peerUUID) : null;
   var displayName = data.name || (contact ? contact.name : null) || 'NEXO Peer';
   self.connectedDevices.set(mac, {
   id: mac, address: mac, name: displayName,
   direction: data.direction || 'outgoing', role: data.role || 'client',
   servicesReady: data.servicesReady || false, deviceUUID: peerUUID
   });
   self._setDeviceState(mac, data.role === 'server' ? BLE_STATES.READY_TO_CHAT : BLE_STATES.CONNECTING, {
   direction: data.direction, role: data.role, deviceUUID: peerUUID
   });
   if (peerUUID) {
   var contacts = _getBLEContacts();
   var idx = contacts.findIndex(function(c) { return _normId(c.deviceUUID) === _normId(peerUUID); });
   if (idx >= 0) {
   contacts[idx].online = true; contacts[idx].lastSeen = Date.now(); contacts[idx].macAddress = mac;
   _saveBLEContacts(contacts); self.renderContactsList(); self.renderOnlineStrip();
   }
   }
   _safeDispatchEvent('nexo:ble:deviceConnected', { deviceId: mac, deviceUUID: peerUUID, name: displayName });
   } catch (e) {}
   });
   this._nativeDeviceDisconnectedListener = this.nativePlugin.addListener('onDeviceDisconnected', function(data) {
   try {
   var mac = _normMac(data.deviceId);
   if (!mac) return;
   var peerUUID = self._macToUuidMap.get(mac);
   self.connectedDevices.delete(mac);
   self._setDeviceState(mac, BLE_STATES.DISCONNECTED);
   if (peerUUID) {
   var contacts = _getBLEContacts();
   var idx = contacts.findIndex(function(c) { return _normId(c.deviceUUID) === _normId(peerUUID); });
   if (idx >= 0) { contacts[idx].online = false; _saveBLEContacts(contacts); self.renderContactsList(); self.renderOnlineStrip(); }
   }
   _safeDispatchEvent('nexo:ble:deviceDisconnected', { deviceId: mac, deviceUUID: peerUUID });
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
   var mac = _normMac(data.deviceId);
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
   if (this._nativePayloadListener) { try { this._nativePayloadListener.remove(); } catch (e) {} }
   var self = this;
   this._nativePayloadListener = this.nativePlugin.addListener('onPayloadReceived', function(data) {
   try {
   var mac = _normMac(data.deviceId);
   if (!mac) return;
   var source = data.source || 'unknown';
   if (source !== 'gatt_server' && source !== 'gatt_client' && source !== 'broadcast') source = 'gatt_client';
   var messageId = null, senderName = null, senderUUID = null;
   var content = data.content || data.data || '';
   var isControl = _isControlPacket(content);
   if (isControl) {
   try {
   var ctrl = JSON.parse(content);
   messageId = ctrl.messageId; senderUUID = ctrl.deviceUUID || self._macToUuidMap.get(mac); senderName = ctrl.senderName || 'NEXO Peer';
   _safeDispatchEvent('nexo:ble:messageReceived', { deviceId: mac, deviceUUID: senderUUID, macAddress: mac, content: content, senderName: senderName, messageId: messageId, source: source, timestamp: data.timestamp || Date.now(), isControl: true });
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
   if (senderUUID) { self._macToUuidMap.set(mac, senderUUID); self._uuidToMacMap.set(senderUUID, mac); }
   if (!senderName || senderName === 'NEXO Peer') {
   var contact = _getContactByUUID(senderUUID);
   var cname = contact ? contact.name : null;
   senderName = cname || (self.connectedDevices.get(mac) && self.connectedDevices.get(mac).name) || (self.foundDevices.get(mac) && self.foundDevices.get(mac).name) || 'NEXO Peer';
   }
   if (senderUUID && senderName && senderName !== 'NEXO Peer') {
   var existingUUIDForMac = self._macToUuidMap.get(mac);
   if (existingUUIDForMac && existingUUIDForMac !== senderUUID) {
   var contacts = _getBLEContacts();
   /* FIX v5.1.3: Eliminar contacto temporal mac-xxx si existe */
   var tempIdx = contacts.findIndex(function(c) {
   return _normId(c.deviceUUID) === _normId(existingUUIDForMac) && _normId(c.deviceUUID).indexOf('mac-') === 0;
   });
   if (tempIdx >= 0) contacts.splice(tempIdx, 1);
   var idx = contacts.findIndex(function(c) { return _normId(c.deviceUUID) === _normId(existingUUIDForMac); });
   if (idx >= 0) { contacts[idx].deviceUUID = senderUUID; contacts[idx].name = senderName; contacts[idx].macAddress = mac; contacts[idx].online = true; contacts[idx].lastSeen = Date.now(); _saveBLEContacts(contacts); }
   self._macToUuidMap.set(mac, senderUUID); self._uuidToMacMap.delete(existingUUIDForMac); self._uuidToMacMap.set(senderUUID, mac);
   _saveMacMaps(self._uuidToMacMap, self._macToUuidMap); self.renderContactsList(); self.renderOnlineStrip();
   } else if (!_isBLEContact(senderUUID)) {
   /* FIX v5.1.3: Eliminar contacto temporal con esta MAC antes de crear el real */
   var contacts2 = _getBLEContacts();
   var tempIdx2 = contacts2.findIndex(function(c) {
   return _normMac(c.macAddress) === mac && _normId(c.deviceUUID).indexOf('mac-') === 0;
   });
   if (tempIdx2 >= 0) contacts2.splice(tempIdx2, 1);
   if (tempIdx2 >= 0) _saveBLEContacts(contacts2);
   self._macToUuidMap.set(mac, senderUUID); self._uuidToMacMap.set(senderUUID, mac);
   _saveMacMaps(self._uuidToMacMap, self._macToUuidMap); _addBLEContact({ deviceUUID: senderUUID, name: senderName, macAddress: mac });
   self.renderContactsList(); self.renderOnlineStrip();
   } else {
   var contacts2 = _getBLEContacts();
   var idx2 = contacts2.findIndex(function(c) { return _normId(c.deviceUUID) === _normId(senderUUID); });
   if (idx2 >= 0) { contacts2[idx2].online = true; contacts2[idx2].lastSeen = Date.now(); contacts2[idx2].macAddress = mac; if (content && !isControl) contacts2[idx2].lastMessage = content.substring(0, 50); _saveBLEContacts(contacts2); self.renderContactsList(); self.renderOnlineStrip(); }
   }
   }
   if (messageId && self._receivedMessageIds.has(messageId)) return;
   if (messageId) { self._receivedMessageIds.add(messageId); if (self._receivedMessageIds.size > self._maxMessageIds) { var first = self._receivedMessageIds.values().next().value; self._receivedMessageIds.delete(first); } }
   var activeUUID = self._activeChatDeviceId;
   if (activeUUID && activeUUID === senderUUID) return;
   if (senderUUID && !isControl) {
   var contacts3 = _getBLEContacts();
   var idx3 = contacts3.findIndex(function(c) { return _normId(c.deviceUUID) === _normId(senderUUID); });
   if (idx3 >= 0) { contacts3[idx3].unreadCount = (contacts3[idx3].unreadCount || 0) + 1; contacts3[idx3].lastMessage = content.substring(0, 50); contacts3[idx3].lastSeen = Date.now(); _saveBLEContacts(contacts3); self.renderContactsList(); self.renderOnlineStrip(); }
   }
   self.newDevicesCount++; self.updateBadge();
   var stableId = senderUUID || mac;
   _safeDispatchEvent('nexo:ble:messageReceived', { deviceId: stableId, deviceUUID: senderUUID, macAddress: mac, content: content, senderName: senderName, messageId: messageId, messageId: messageId, source: source, timestamp: data.timestamp || Date.now() });
   } catch (e) { console.warn('[BLEInterface] Error onPayloadReceived:', e.message); }
   });
   }
   _processPendingMessages(deviceMAC) {
   var self = this;
   var macNorm = _normMac(deviceMAC);
   if (!macNorm) return Promise.resolve();
   var queue = this._pendingMessageQueue.get(macNorm);
   if (!queue || queue.length === 0) return Promise.resolve();
   this._pendingMessageQueue.delete(macNorm);
   var processNext = function(idx) {
   if (idx >= queue.length) return Promise.resolve();
   var item = queue[idx];
   return self._sendMessageNative(macNorm, item.content, item.messageId)
   .then(function() { item.resolve(); return processNext(idx + 1); })
   .catch(function(e) { item.reject(e); return processNext(idx + 1); });
   };
   return processNext(0);
   }
   _sendMessageNative(deviceMAC, content, messageId) {
   var self = this;
   return new Promise(function(resolve, reject) {
   try {
   if (!self.nativePlugin) { reject(new Error('Plugin no disponible')); return; }
   var macNorm = _normMac(deviceMAC);
   if (!macNorm) { reject(new Error('MAC invalida')); return; }
   var targetId = _macWithColons(macNorm);
   var isCtrl = _isControlPacket(content);
   var enrichedPayload;
   if (isCtrl) { enrichedPayload = content; }
   else {
   enrichedPayload = JSON.stringify({
   deviceUUID: self.localDeviceUUID, senderName: self.localDeviceName, content: content,
   messageId: messageId || ('msg' + Date.now() + '*' + Math.random().toString(36).substr(2, 9)), timestamp: Date.now()
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
   var mac = self._uuidToMacMap.get(uuid);
   if (!mac && self._activeChatMAC && self._activeChatDeviceId === uuid) mac = self._activeChatMAC;
   var contact = _getContactByUUID(uuid);
   if (!mac && contact && contact.macAddress) mac = _normMac(contact.macAddress);
   if (!mac) {
   self.foundDevices.forEach(function(d, m) { if (!mac && _normId(d.deviceUUID) === uuid) mac = m; });
   self.connectedDevices.forEach(function(d, m) { if (!mac && _normId(d.deviceUUID) === uuid) mac = m; });
   }
   if (!mac) {
   var allContacts = _getBLEContacts();
   for (var i = 0; i < allContacts.length; i++) {
   if (_normId(allContacts[i].deviceUUID) === uuid && allContacts[i].macAddress) { mac = _normMac(allContacts[i].macAddress); break; }
   }
   }
   if (!mac) { var loaded = _loadMacMaps(); if (loaded.uuidToMac[uuid]) mac = _normMac(loaded.uuidToMac[uuid]); }
   if (!mac) { try { var storedMac = localStorage.getItem(BLE_ACTIVE_CHAT_MAC_KEY); if (storedMac) mac = _normMac(storedMac); } catch (e) {} }
   if (!mac) { console.error('[BLEInterface] sendChatMessage: No MAC para UUID', uuid); reject(new Error('Dispositivo no encontrado. Intenta re-escanear.')); return; }
   mac = _normMac(mac);
   if (contact && !self._uuidToMacMap.get(uuid)) { self._uuidToMacMap.set(uuid, mac); self._macToUuidMap.set(mac, uuid); _saveMacMaps(self._uuidToMacMap, self._macToUuidMap); }
   var state = self._getDeviceState(mac);
   var isReady = state.state === BLE_STATES.READY_TO_CHAT || state.state === BLE_STATES.NOTIFICATIONS_READY;
   var isConnecting = state.state === BLE_STATES.CONNECTING || state.state === BLE_STATES.DISCOVERING_SERVICES;
   function doSend() {
   self._sendMessageNative(mac, content, messageId).then(function() { resolve(); }).catch(function(err) { reject(err); });
   }
   if (!isReady && !isConnecting && self.nativePlugin && _hasNativeMethod(self.nativePlugin, 'connectToDevice')) {
   _safeNativeCall(self.nativePlugin, 'connectToDevice', { deviceId: _macWithColons(mac) })
   .then(function(connResult) { if (connResult && (connResult.connected || connResult.alreadyConnected)) { return self._waitForReadyToChat(mac, 12000); } throw new Error('No se pudo conectar'); })
   .then(function() { doSend(); }).catch(function(err) { reject(err); });
   return;
   }
   if (!isReady && isConnecting) {
   self._waitForReadyToChat(mac, 12000).then(function() { doSend(); }).catch(function(err) { reject(err); });
   return;
   }
   if (!isReady) { console.warn('[BLEInterface] Canal no listo para ' + mac + ', intentando envio directo'); doSend(); return; }
   doSend();
   } catch (fatal) { reject(fatal); }
   });
   }
   _waitForReadyToChat(mac, timeoutMs) {
   var self = this;
   return new Promise(function(resolve, reject) {
   var macNorm = _normMac(mac);
   if (!macNorm) { reject(new Error('MAC invalida')); return; }
   var state = self._getDeviceState(macNorm);
   if (state.state === BLE_STATES.READY_TO_CHAT || state.state === BLE_STATES.NOTIFICATIONS_READY) { resolve(); return; }
   var timer = setTimeout(function() { self._readyResolvers.delete(macNorm); reject(new Error('Timeout esperando READY_TO_CHAT')); }, timeoutMs || 3000);
   self._readyResolvers.set(macNorm, { resolve: resolve, timer: timer });
   });
   }
   _resolveReadyToChat(mac) {
   var macNorm = _normMac(mac);
   if (!macNorm) return;
   var resolver = this._readyResolvers.get(macNorm);
   if (resolver) { clearTimeout(resolver.timer); resolver.resolve(); this._readyResolvers.delete(macNorm); }
   }
   openChat(deviceUUID) {
   var self = this;
   return new Promise(function(resolve, reject) {
   try {
   var uuid = _normId(deviceUUID);
   if (!uuid) { reject(new Error('ID invalido')); return; }
   var contact = _getContactByUUID(uuid);
   var mac = self._uuidToMacMap.get(uuid) || _normMac(contact && contact.macAddress);
   if (!mac && contact) {
   self.foundDevices.forEach(function(d, m) { if (!mac && _normId(d.deviceUUID) === uuid) mac = m; });
   self.connectedDevices.forEach(function(d, m) { if (!mac && _normId(d.deviceUUID) === uuid) mac = m; });
   }
   var displayName = (contact && contact.name) || 'NEXO Peer';
   /* FIX: Buscar MAC en más lugares antes de bloquear */
   if (!_isValidMAC(mac)) {
   var allContacts = _getBLEContacts();
   for (var i = 0; i < allContacts.length; i++) {
   if (_normId(allContacts[i].deviceUUID) === uuid && allContacts[i].macAddress) {
   mac = _normMac(allContacts[i].macAddress); break;
   }
   }
   }
   if (!_isValidMAC(mac)) {
   try { var storedMac = localStorage.getItem(BLE_ACTIVE_CHAT_MAC_KEY); if (storedMac) mac = _normMac(storedMac); } catch (e) {}
   }
   if (!_isValidMAC(mac)) {
   console.warn('[BLEInterface] openChat: MAC no encontrada para UUID ' + uuid + ' — abriendo chat igual');
   mac = null;
   } else {
   mac = _normMac(mac);
   }
   self._activeChatDeviceId = uuid; self._activeChatMAC = mac;
   if (mac) { try { localStorage.setItem(BLE_ACTIVE_CHAT_MAC_KEY, mac); } catch (e) {} }
   self.newDevicesCount = 0; self.updateBadge(); _saveMacMaps(self._uuidToMacMap, self._macToUuidMap);
   if (contact) {
   contact.unreadCount = 0; var contacts = _getBLEContacts();
   var idx = contacts.findIndex(function(c) { return _normId(c.deviceUUID) === uuid; });
   if (idx >= 0) { contacts[idx].unreadCount = 0; _saveBLEContacts(contacts); self.renderContactsList(); self.renderOnlineStrip(); }
   }
   var state = self._getDeviceState(mac);
   var isFullyReady = state.state === BLE_STATES.READY_TO_CHAT || state.state === BLE_STATES.NOTIFICATIONS_READY;
   var isConnecting = state.state === BLE_STATES.CONNECTING || state.state === BLE_STATES.DISCOVERING_SERVICES;
   function finishOpenChat() {
   var appContainer = document.getElementById('app');
   if (appContainer) appContainer.classList.remove('hidden');
   var nameInput = document.getElementById('chat-contact-name');
   var subtitle = document.getElementById('chat-contact-subtitle');
   if (nameInput) nameInput.value = displayName;
   if (subtitle) subtitle.textContent = '';
   _safeDispatchEvent('nexo:ble:openChat', { contactId: uuid, name: displayName, address: mac, transport: 'ble', source: 'ble_interface' });
   self.elements.panel.classList.remove('active'); self.elements.overlay.classList.remove('active');
   resolve();
   }
   if (mac && !isFullyReady && self.nativePlugin && _hasNativeMethod(self.nativePlugin, 'connectToDevice')) {
   if (!isConnecting) {
   _safeNativeCall(self.nativePlugin, 'connectToDevice', { deviceId: _macWithColons(mac) })
   .then(function(connResult) { if (connResult && (connResult.connected || connResult.alreadyConnected)) { return self._waitForReadyToChat(mac, 15000); } throw new Error('No se pudo conectar'); })
   .then(function() { finishOpenChat(); }).catch(function(e) { finishOpenChat(); });
   } else {
   self._waitForReadyToChat(mac, 15000).then(function() { finishOpenChat(); }).catch(function(e) { finishOpenChat(); });
   }
   } else { finishOpenChat(); }
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
   }).catch(function(err) { console.error('[BLEInterface] Error consultando estado:', err); });
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
   createDOM() {
   var self = this;
   var panel = document.createElement('div');
   panel.id = 'ble-panel';
   panel.innerHTML =
   /* FIX: Botón back en header del panel BLE */
   '<div class="ble-header" style="position:relative;display:flex;align-items:center;justify-content:center;padding:10px 20px 14px;">' +
   '<button id="ble-panel-back" style="position:absolute;left:12px;top:50%;transform:translateY(-50%);width:38px;height:38px;border-radius:50%;background:linear-gradient(135deg,#00c8ff,#a855f7);border:none;color:#fff;cursor:pointer;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 8px rgba(0,200,255,0.3);transition:transform 0.15s ease;z-index:2;">' +
   '<svg viewBox="0 0 24 24" width="16" height="16" fill="#fff"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" transform="scale(-1,1) translate(-24,0)"/></svg>' +
   '</button>' +
   '<div style="text-align:center;">' +
   '<div class="contacts-title">Mensajes</div>' +
   '<div class="contacts-subtitle">NEXO · Comunicacion P2P cifrada</div>' +
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
   '<button id="ble-add-btn" class="ble-btn-add-small" type="button" aria-label="Agregar contacto" style="display:flex !important;visibility:visible !important;opacity:1 !important;">+</button>' +
   '<button id="ble-scan-btn" class="ble-btn-scan-round" type="button" aria-label="Scan"></button>' +
   '</div>' +
   '<div id="ble-status-bar" class="ble-status-bar"><span id="ble-status-text">NEXO BLE</span></div>';
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
   var fabBtn = document.createElement('button');
   fabBtn.id = 'ble-fab-btn';
   fabBtn.innerHTML = '<svg viewBox="0 0 24 24" width="28" height="28" fill="#fff"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>';
   fabBtn.style.cssText = 'position:fixed;bottom:80px;right:16px;width:56px;height:56px;border-radius:50%;background:linear-gradient(135deg,#00c8ff,#a855f7);border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;z-index:2147483643;box-shadow:0 4px 15px rgba(0,200,255,0.3);transition:transform 0.15s ease;';
   fabBtn.addEventListener('click', function() { self.togglePanel(); self.toggleScan(); });
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
   this.elements.scanBtn.addEventListener('touchstart', function(e) { e.preventDefault(); this.style.transform = 'scale(0.92)'; }, {passive:false});
   this.elements.scanBtn.addEventListener('touchend', function(e) { e.preventDefault(); this.style.transform = 'scale(1)'; self.toggleScan(); }, {passive:false});
   this.elements.addBtn.addEventListener('click', function() { self._addNewDevice(); });
   this.elements.addBtn.addEventListener('touchstart', function(e) { e.preventDefault(); this.style.transform = 'scale(0.92)'; }, {passive:false});
   this.elements.addBtn.addEventListener('touchend', function(e) { e.preventDefault(); this.style.transform = 'scale(1)'; self._addNewDevice(); }, {passive:false});
   /* FIX: Botón back en panel BLE - cerrar panel y volver a NEXO */
   var backBtn = document.getElementById('ble-panel-back');
   if (backBtn) {
   backBtn.addEventListener('click', function() {
   self.elements.panel.classList.remove('active');
   self.elements.overlay.classList.remove('active');
   /* Mostrar FAB al volver a pantalla principal */
   if (self.elements.fabBtn) self.elements.fabBtn.style.display = 'flex';
   });
   }
   var navItems = this.elements.bottomNav.querySelectorAll('.ble-nav-item');
   navItems.forEach(function(item) {
   item.addEventListener('click', function() {
   navItems.forEach(function(n) { n.classList.remove('active'); });
   item.classList.add('active');
   var tab = item.dataset.tab;
   if (tab === 'people') self.togglePanel();
   });
   });
   window.addEventListener('nexo:ble:closeChat', function() {
   self._activeChatDeviceId = null; self._activeChatMAC = null;
   try { localStorage.removeItem(BLE_ACTIVE_CHAT_MAC_KEY); } catch(e) {}
   self.updateBadge();
   if (self.elements.fabBtn) self.elements.fabBtn.style.display = 'flex';
   if (self.elements.bottomNav) self.elements.bottomNav.style.display = 'flex';
   /* FIX: Al cerrar chat, NO abrir panel BLE automáticamente. Solo mostrar FAB en pantalla principal */
   self.renderContactsList(); self.renderOnlineStrip();
   });
   window.addEventListener('nexo:ble:openChat', function() {
   if (self.elements.fabBtn) self.elements.fabBtn.style.display = 'none';
   if (self.elements.bottomNav) self.elements.bottomNav.style.display = 'none';
   });
   }
   togglePanel() {
   this.elements.panel.classList.toggle('active');
   this.elements.overlay.classList.toggle('active');
   if (this.elements.panel.classList.contains('active')) {
   this.newDevicesCount = 0; this.updateBadge(); this.renderContactsList(); this.renderOnlineStrip();
   /* Ocultar FAB cuando se abre el panel BLE */
   if (this.elements.fabBtn) self.elements.fabBtn.style.display = 'none';
   } else {
   /* Mostrar FAB cuando se cierra el panel BLE (volver a pantalla principal) */
   if (this.elements.fabBtn) self.elements.fabBtn.style.display = 'flex';
   }
   }
   toggleScan() {
   var self = this;
   if (self.isDummyMode) return Promise.resolve();
   var permsReady = false;
   if (window.ensureBLEPermissions) {
   return window.ensureBLEPermissions().then(function(result) { permsReady = result; }).catch(function() { permsReady = true; }).then(function() {
   if (!permsReady) return Promise.resolve();
   if (self.isScanning) {
   if (_hasNativeMethod(self.nativePlugin, 'stopScan')) {
   return _safeNativeCall(self.nativePlugin, 'stopScan', {}).then(function() { self.isScanning = false; self.updateScanButton(); self.updateStatus(); });
   }
   self.isScanning = false; self.updateScanButton(); self.updateStatus(); return Promise.resolve();
   } else {
   self.foundDevices.clear(); self._renderedDeviceIds.clear(); self.renderContactsList(); self.renderNewDeviceBar(); self.renderOnlineStrip();
   if (_hasNativeMethod(self.nativePlugin, 'startScan')) {
   return _safeNativeCall(self.nativePlugin, 'startScan', {}).then(function() { self.isScanning = true; self.updateScanButton(); });
   }
   self.isScanning = true; self.updateScanButton(); return Promise.resolve();
   }
   }).catch(function(err) { self.isScanning = false; self.updateScanButton(); });
   } else { permsReady = true; }
   if (!permsReady) return Promise.resolve();
   if (self.isScanning) {
   if (_hasNativeMethod(self.nativePlugin, 'stopScan')) {
   return _safeNativeCall(self.nativePlugin, 'stopScan', {}).then(function() { self.isScanning = false; self.updateScanButton(); self.updateStatus(); });
   }
   self.isScanning = false; self.updateScanButton(); self.updateStatus();
   } else {
   self.foundDevices.clear(); self._renderedDeviceIds.clear(); self.renderContactsList(); self.renderNewDeviceBar(); self.renderOnlineStrip();
   if (_hasNativeMethod(self.nativePlugin, 'startScan')) {
   return _safeNativeCall(self.nativePlugin, 'startScan', {}).then(function() { self.isScanning = true; self.updateScanButton(); });
   }
   self.isScanning = true; self.updateScanButton();
   }
   return Promise.resolve();
   }
   onDeviceFound(device) {
   var mac = _normMac(device.id || device.address);
   if (!mac) return;
   if (this.localDeviceAddress && mac === this.localDeviceAddress) return;
   var knownUUID = this._macToUuidMap.get(mac);
   if (knownUUID && _isBLEContact(knownUUID)) {
   var contacts = _getBLEContacts();
   var idx = contacts.findIndex(function(c) { return _normId(c.deviceUUID) === _normId(knownUUID); });
   if (idx >= 0) { contacts[idx].online = true; contacts[idx].lastSeen = Date.now(); contacts[idx].macAddress = mac; _saveBLEContacts(contacts); }
   this.renderContactsList(); this.renderOnlineStrip(); return;
   }
   if (this.foundDevices.has(mac)) {
   var existing = this.foundDevices.get(mac);
   existing.rssi = device.rssi; existing.name = device.name || existing.name; existing.lastSeen = Date.now();
   this.foundDevices.set(mac, existing); this.renderNewDeviceBar(); return;
   }
   device.lastSeen = Date.now(); this.foundDevices.set(mac, device);
   this.newDevicesCount++; this.updateBadge(); this.renderNewDeviceBar();
   }
   renderOnlineStrip() {
   var self = this;
   var strip = this.elements.onlineStrip;
   if (!strip) return;
   strip.innerHTML = '';
   var contacts = _getBLEContacts();
   var onlineContacts = contacts.filter(function(c) { return c.online && (Date.now() - (c.lastSeen || 0)) < 60000; });
   if (onlineContacts.length === 0) { strip.style.display = 'none'; return; }
   strip.style.display = 'flex';
   onlineContacts.forEach(function(contact) {
   var uuid = _normId(contact.deviceUUID);
   var item = document.createElement('div');
   item.className = 'ble-online-item';
   var initials = _getInitials(contact.name);
   var gradClass = _getGradientForUUID(uuid);
   item.innerHTML = '<div class="ble-online-avatar ' + gradClass + '">' + initials + '<div class="ble-online-dot"></div></div><span class="ble-online-name">' + (contact.name || 'NEXO') + '</span>';
   item.addEventListener('click', function() { self.openChat(uuid); });
   strip.appendChild(item);
   });
   }
   renderContactsList() {
   var self = this;
   var list = this.elements.contactsList;
   if (!list) return;
   list.innerHTML = '';
   var contacts = _getBLEContacts();
   /* FIX v5.1.3: Deduplicar contactos por MAC antes de renderizar */
   var seenMacs = {};
   var deduped = [];
   contacts.forEach(function(c) {
   var mac = _normMac(c.macAddress);
   if (!mac) {
   var uuid = _normId(c.deviceUUID);
   if (!seenMacs[uuid]) { seenMacs[uuid] = true; deduped.push(c); }
   return;
   }
   if (!seenMacs[mac]) {
   seenMacs[mac] = true;
   deduped.push(c);
   } else {
   var existing = deduped.find(function(d) { return _normMac(d.macAddress) === mac; });
   if (existing && (c.lastSeen || 0) > (existing.lastSeen || 0)) {
   existing.name = c.name || existing.name;
   existing.lastSeen = c.lastSeen;
   existing.online = c.online;
   existing.lastMessage = c.lastMessage || existing.lastMessage;
   existing.unreadCount = Math.max(existing.unreadCount || 0, c.unreadCount || 0);
   existing.deviceUUID = c.deviceUUID;
   }
   }
   });
   contacts = deduped;
   if (contacts.length === 0) { list.innerHTML = '<div class="ble-empty">No hay contactos. Presiona Buscar para encontrar dispositivos.</div>'; this.renderOnlineStrip(); return; }
   var pinned = _getPinnedContacts();
   contacts.sort(function(a, b) {
   var aPinned = pinned.indexOf(_normId(a.deviceUUID)) >= 0 ? 1 : 0;
   var bPinned = pinned.indexOf(_normId(b.deviceUUID)) >= 0 ? 1 : 0;
   if (aPinned !== bPinned) return bPinned - aPinned;
   return (b.lastSeen || 0) - (a.lastSeen || 0);
   });
   contacts.forEach(function(contact, index) {
   var uuid = _normId(contact.deviceUUID);
   var isOnline = contact.online && (Date.now() - (contact.lastSeen || 0)) < 60000;
   var initials = _getInitials(contact.name);
   var gradClass = _getGradientForUUID(uuid);
   var lastMsg = contact.lastMessage || (isOnline ? 'En linea' : 'Offline');
   var timeStr = _formatTime(contact.lastSeen);
   var unread = contact.unreadCount || 0;
   var row = document.createElement('div');
   row.className = 'ble-contact-row';
   row.addEventListener('click', function(e) { if (e.target.closest('.ble-contact-menu') || e.target.closest('.ble-btn-menu')) return; self.openChat(uuid).catch(function(err) { console.error('[BLEInterface] openChat failed:', err.message); }); });
   var avatar = document.createElement('div');
   avatar.className = 'ble-contact-avatar ' + gradClass;
   avatar.textContent = initials;
   row.appendChild(avatar);
   var info = document.createElement('div');
   info.className = 'ble-contact-info';
   info.innerHTML = '<div class="ble-contact-name">' + (contact.name || 'NEXO Peer') + '</div><div class="ble-contact-msg">' + lastMsg + '</div>';
   row.appendChild(info);
   var meta = document.createElement('div');
   meta.className = 'ble-contact-meta';
   var metaHtml = '<span class="ble-contact-time">' + timeStr + '</span>';
   if (unread > 0) metaHtml += '<div class="ble-unread-badge">' + unread + '</div>';
   meta.innerHTML = metaHtml;
   row.appendChild(meta);
   var menuBtn = document.createElement('button');
   menuBtn.className = 'ble-btn-menu';
   menuBtn.innerHTML = '⋮';
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
   menu.innerHTML = '<div class="ble-menu-item" data-action="pin">' + (isPinned ? '☆ Desfijar' : '★ Fijar') + '</div><div class="ble-menu-item" data-action="profile">👤 Perfil</div><div class="ble-menu-item ble-menu-delete" data-action="delete">🗑 Eliminar</div>';
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
   var nameSpan = this.elements.newDeviceName;
   var newDevice = null, newMac = null;
   this.foundDevices.forEach(function(device, mac) {
   var uuid = device.deviceUUID || this._macToUuidMap.get(mac);
   if (!uuid || !_isBLEContact(uuid)) { newDevice = device; newMac = mac; }
   }.bind(this));
   if (newDevice && newMac) { nameSpan.textContent = newDevice.name || 'NEXO Device'; bar.style.display = 'flex'; bar.dataset.mac = newMac; }
   else { bar.style.display = 'none'; bar.dataset.mac = ''; }
   }
   _addNewDevice() {
   var bar = this.elements.newDeviceBar;
   var mac = _normMac(bar.dataset.mac);
   var device = this.foundDevices.get(mac);
   if (!mac || !device) {
   /* Si no hay dispositivo nuevo, solo abrir panel de contactos e iniciar scan */
   this.togglePanel();
   this.toggleScan();
   return;
   }
   var name = device.name || 'NEXO Peer';
   /* FIX v5.1.3: Deduplicar por MAC antes de agregar contacto nuevo */
   var contacts = _getBLEContacts();
   var existingByMac = contacts.find(function(c) { return _normMac(c.macAddress) === mac; });
   if (existingByMac) {
   existingByMac.online = true;
   existingByMac.lastSeen = Date.now();
   existingByMac.name = name;
   _saveBLEContacts(contacts);
   try { localStorage.setItem(BLE_ACTIVE_CHAT_MAC_KEY, mac); } catch (e) {}
   this._autoConnectGATT(mac, device);
   this.foundDevices.delete(mac);
   this.renderContactsList(); this.renderNewDeviceBar(); this.renderOnlineStrip();
   return;
   }
   var existingUUID = this._macToUuidMap.get(mac);
   var existingContact = existingUUID ? _getContactByUUID(existingUUID) : null;
   if (existingContact) {
   existingContact.online = true; existingContact.lastSeen = Date.now(); existingContact.macAddress = mac;
   var contacts2 = _getBLEContacts();
   var idx = contacts2.findIndex(function(c) { return _normId(c.deviceUUID) === _normId(existingUUID); });
   if (idx >= 0) { contacts2[idx] = existingContact; _saveBLEContacts(contacts2); }
   try { localStorage.setItem(BLE_ACTIVE_CHAT_MAC_KEY, mac); } catch (e) {}
   this._autoConnectGATT(mac, device); this.foundDevices.delete(mac); this.renderContactsList(); this.renderNewDeviceBar(); this.renderOnlineStrip(); return;
   }
   var tempUUID = 'mac-' + mac;
   this._macToUuidMap.set(mac, tempUUID); this._uuidToMacMap.set(tempUUID, mac);
   _saveMacMaps(this._uuidToMacMap, this._macToUuidMap); _addBLEContact({ deviceUUID: tempUUID, name: name, macAddress: mac });
   try { localStorage.setItem(BLE_ACTIVE_CHAT_MAC_KEY, mac); } catch (e) {}
   this._autoConnectGATT(mac, device); this.foundDevices.delete(mac); this.renderContactsList(); this.renderNewDeviceBar(); this.renderOnlineStrip();
   }
   _autoConnectGATT(mac, device) {
   var self = this;
   if (!self.nativePlugin || !_hasNativeMethod(self.nativePlugin, 'connectToDevice')) return Promise.resolve();
   var macNorm = _normMac(mac);
   if (!macNorm) return Promise.resolve();
   var state = self._getDeviceState(macNorm);
   if (state.state === BLE_STATES.READY_TO_CHAT || state.state === BLE_STATES.NOTIFICATIONS_READY || state.state === BLE_STATES.CONNECTING) return Promise.resolve();
   self._setDeviceState(macNorm, BLE_STATES.CONNECTING, { direction: 'outgoing', role: 'client', auto: true });
   self.connectedDevices.set(macNorm, { id: macNorm, address: macNorm, name: (device && device.name) || 'NEXO Peer', direction: 'outgoing', servicesReady: false, deviceUUID: self._macToUuidMap.get(macNorm) });
   return _safeNativeCall(self.nativePlugin, 'connectToDevice', { deviceId: _macWithColons(macNorm) })
   .then(function(result) { if (result && (result.connected || result.alreadyConnected)) { return self._waitForReadyToChat(macNorm, 8000).then(function() {}); } else { self._setDeviceState(macNorm, BLE_STATES.DISCONNECTED); } })
   .catch(function(e) { self._setDeviceState(macNorm, BLE_STATES.DISCONNECTED); });
   }
   removeContact(deviceUUID) {
   try { _removeBLEContact(deviceUUID); this.renderContactsList(); this.renderNewDeviceBar(); this.renderOnlineStrip(); } catch (e) {}
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
   self._activeChatDeviceId = null; self._activeChatMAC = null;
   try { localStorage.removeItem(BLE_ACTIVE_CHAT_MAC_KEY); } catch(e) {}
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
   /* Solo mostrar FAB si el panel BLE está cerrado (pantalla principal) */
   if (this.elements.panel && this.elements.panel.classList.contains('active')) { fabBtn.style.display = 'none'; return; }
   fabBtn.style.display = 'flex';
   if (this.newDevicesCount > 0) {
   /* Mostrar badge con contador sobre el + */
   fabBtn.innerHTML = '<div style="position:relative;width:28px;height:28px;"><svg viewBox="0 0 24 24" width="28" height="28" fill="#fff"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg><span style="position:absolute;top:-8px;right:-8px;background:#ff4757;color:#fff;border-radius:50%;width:18px;height:18px;font-size:11px;display:flex;align-items:center;justify-content:center;font-weight:700;">' + this.newDevicesCount + '</span></div>';
   } else {
   fabBtn.innerHTML = '<svg viewBox="0 0 24 24" width="28" height="28" fill="#fff"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>';
   }
   }
   updateStatusBar(text) {
   /* FIX: No mostrar status bar al usuario */
   return;
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
   }).catch(function(err) { self.updateStatusBar('ERROR'); });
   }
   self.updateStatusBar('NEXO BLE');
   return Promise.resolve();
   }
   }
   /*
   Focos de Interés:
 * FIX v5.1.3: Deduplicación de contactos por MAC + elimina contactos temporales mac-xxx al recibir UUID real
 * FIX: Botón back en panel BLE para volver a pantalla NEXO
 * FIX: Pantalla NEXO al arrancar, no panel de contactos
 * Mantener la integridad de la estructura de la clase y funciones auxiliares existentes.
 * Garantizar la persistencia y recuperación correcta de los mapas de direcciones (MAC/UUID).
 * Asegurar la compatibilidad con el plugin nativo de Capacitor (NexoBLE).
 * Gestión eficiente de estados de conexión BLE (scanning, advertising, connected).
 * renderizado ligero de UI utilizando elementos del DOM sin canvas.
   */
