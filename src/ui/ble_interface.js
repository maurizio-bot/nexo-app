/**
 * BLE Interface v5.0.7-CONTACTOS-ES5
 * FIXES: (1) Tab siempre visible al salir de chat, (2) BLE→Contactos/👤, (3) EYE auto-reactivar al volver a app
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
function _getPinnedContacts() {
try {
var raw = localStorage.getItem(BLE_PINNED_CONTACTS_KEY);
return raw ? JSON.parse(raw) : [];
} catch (e) { return []; }
}
function _togglePinnedContact(deviceUUID) {
var uuid = _normId(deviceUUID);
var pinned = _getPinnedContacts();
var idx = pinned.indexOf(uuid);
if (idx >= 0) pinned.splice(idx, 1);
else pinned.push(uuid);
try { localStorage.setItem(BLE_PINNED_CONTACTS_KEY, JSON.stringify(pinned)); } catch (e) {}
return idx < 0;
}
function _isPinned(deviceUUID) {
return _getPinnedContacts().indexOf(_normId(deviceUUID)) >= 0;
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
console.log('[BLEInterface] DUAL GATT v5.0.7-CONTACTOS iniciado. MAC maps:', this._uuidToMacMap.size, 'entradas');
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
this._setupAppStateListener();
if (!this.nativePlugin) {
this.nativePlugin = (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.NexoBLE) || null;
if (this.nativePlugin) {
this.isDummyMode = !this.bleMesh && !this.nativePlugin;
}
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
this._autoStartAdvertising();
}
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
if (self.isAdvertising && self.nativePlugin && _hasNativeMethod(self.nativePlugin, 'startAdvertising')) {
_safeNativeCall(self.nativePlugin, 'startAdvertising', {})
.then(function() {
self.isAdvertising = true;
self.updateVisibilityButton();
})
.catch(function(e) {
console.warn('[BLEInterface] Fallo reactivar EYE:', e.message);
});
}
}
} catch (e) {
console.warn('[BLEInterface] Error appStateChange:', e.message);
}
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
if (uuid && mac) {
self._macToUuidMap.set(mac, uuid);
self._uuidToMacMap.set(uuid, mac);
}
});
}
_autoStartAdvertising() {
var self = this;
if (self.isDummyMode || !self.nativePlugin) {
return Promise.resolve();
}
if (!_hasNativeMethod(self.nativePlugin, 'isBluetoothEnabled')) {
return Promise.resolve();
}
return _safeNativeCall(self.nativePlugin, 'isBluetoothEnabled', {})
.then(function(btState) {
var canAdv = btState && btState.canAdvertise;
var serverReady = btState && btState.serverReady;
if ((canAdv || serverReady) && _hasNativeMethod(self.nativePlugin, 'startAdvertising')) {
return _safeNativeCall(self.nativePlugin, 'startAdvertising', {})
.then(function() {
self.isAdvertising = true;
self.canAdvertise = true;
self.updateVisibilityButton();
})
.catch(function(e) {
});
} else {
}
})
.catch(function(e) {
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
} catch (e) {}
});
}
_setupNativeServerReadyListener() {
if (!this.nativePlugin) return;
if (!_hasNativeMethod(this.nativePlugin, 'addListener')) return;
var self = this;
this._nativeServerReadyListener = this.nativePlugin.addListener('onServerReady', function(data) {
try {
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
if (this._nativePayloadListener) {
try { this._nativePayloadListener.remove(); } catch (e) {}
}
var self = this;
this._nativePayloadListener = this.nativePlugin.addListener('onPayloadReceived', function(data) {
try {
var mac = _normMac(data.deviceId);
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
return;
}
self.newDevicesCount++;
self.updateBadge();
} catch (e) {
console.warn('[BLEInterface] Error onPayloadReceived:', e.message);
}
});
}
_processPendingMessages(deviceMAC) {
var self = this;
var macNorm = _normMac(deviceMAC);
if (!macNorm) {
return Promise.resolve();
}
var queue = this._pendingMessageQueue.get(macNorm);
if (!queue || queue.length === 0) return Promise.resolve();
this._pendingMessageQueue.delete(macNorm);
var failed = 0;
var processNext = function(idx) {
if (idx >= queue.length) {
if (failed > 0) {
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
return new Promise(function(resolve, reject) {
try {
if (!self.nativePlugin) {
reject(new Error('Plugin no disponible'));
return;
}
var macNorm = _normMac(deviceMAC);
if (!macNorm) {
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
messageId: messageId || ('msg' + Date.now() + '*' + Math.random().toString(36).substr(2, 9)),
timestamp: Date.now()
});
}
if (_hasNativeMethod(self.nativePlugin, 'sendMessage')) {
_safeNativeCall(self.nativePlugin, 'sendMessage', { deviceId: targetId, message: enrichedPayload })
.then(function() {
resolve();
})
.catch(function(e) {
reject(e);
});
} else {
reject(new Error('sendMessage no disponible'));
}
} catch (e) {
reject(e);
}
});
}
sendChatMessage(deviceUUID, content, messageId) {
var self = this;
return new Promise(function(resolve, reject) {
try {
var uuid = _normId(deviceUUID);
if (!uuid) {
reject(new Error('deviceUUID vacio'));
return;
}
if (!content || typeof content !== 'string' || content.trim() === '') {
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
openChat(deviceUUID) {
var self = this;
return new Promise(function(resolve, reject) {
try {
var uuid = _normId(deviceUUID);
if (!uuid) {
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
self.elements.panel.classList.remove('active');
self.elements.overlay.classList.remove('active');
resolve();
}
if (!isFullyReady && self.nativePlugin && _hasNativeMethod(self.nativePlugin, 'connectToDevice')) {
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
finishOpenChat();
});
} else {
self._waitForReadyToChat(mac, 15000)
.then(function() {
finishOpenChat();
})
.catch(function(e) {
finishOpenChat();
});
}
} else {
finishOpenChat();
}
} catch (fatalErr) {
console.error('[BLEInterface] FATAL openChat:', fatalErr);
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
});
this._nativeAdFailedListener = this.nativePlugin.addListener('onAdvertiseFailed', function() {
});
}
updateVisibilityButton() {
var btn = this.elements.visibilityBtn;
if (!btn) return;
if (this.isAdvertising) {
btn.classList.add('active');
} else {
btn.classList.remove('active');
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
return Promise.resolve();
}
if (!self.nativePlugin) return Promise.resolve();
var promise;
if (self.isAdvertising) {
if (_hasNativeMethod(self.nativePlugin, 'stopAdvertising')) {
promise = _safeNativeCall(self.nativePlugin, 'stopAdvertising', {});
} else { promise = Promise.resolve(); }
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
} else { promise = Promise.resolve(); }
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
})
.catch(function(err) {
});
} else {
permsReady = true;
}
if (!permsReady) {
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
tab.innerHTML = '<div class="ble-tab-icon">👤</div><div class="ble-tab-badge" id="ble-tab-badge" style="display:none">0</div>';
document.body.appendChild(tab);
this.elements.tab = tab;
var panel = document.createElement('div');
panel.id = 'ble-panel';
panel.innerHTML = '<div class="ble-header"> <button id="ble-back" class="ble-btn-back">←</button> <h3>Contactos</h3> <button id="ble-visibility-btn" class="ble-btn-visibility-round"></button> </div>  <div id="ble-contacts-list" class="ble-contacts-list"> <div class="ble-empty">No hay contactos. Presiona Buscar para encontrar dispositivos.</div> </div> <div class="ble-bottom-bar"> <div id="ble-new-device" class="ble-new-device" style="display:none"> <span id="ble-new-device-name"></span> <button id="ble-add-btn" class="ble-btn-add-small">+</button> </div> <button id="ble-scan-btn" class="ble-btn-scan-round"></button> </div> <div id="ble-status-bar" class="ble-status-bar"><span id="ble-status-text">NEXO BLE</span></div>';
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
this.elements.newDeviceBar = document.getElementById('ble-new-device');
this.elements.newDeviceName = document.getElementById('ble-new-device-name');
this.elements.addBtn = document.getElementById('ble-add-btn');
this.elements.statusBar = document.getElementById('ble-status-bar');
this.elements.statusText = document.getElementById('ble-status-text');
}
injectStyles() {
if (document.getElementById('ble-styles-v5')) return;
var style = document.createElement('style');
style.id = 'ble-styles-v5';
style.textContent = "#ble-tab { position: fixed; left: 0; top: 50%; transform: translateY(-50%); width: 44px; height: 100px; background: #0082FC; border-radius: 0 12px 12px 0; display: flex; flex-direction: column; align-items: center; justify-content: center; cursor: pointer; z-index: 2147483644; color: #fff; font-weight: bold; } .ble-tab-badge { position: absolute; top: 5px; right: -5px; background: #ff4444; color: white; width: 18px; height: 18px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 10px; animation: pulse 2s infinite; } @keyframes pulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.1); } } #ble-panel { position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: #000000; transform: translateX(-100%); transition: transform 0.3s ease; z-index: 2147483645; color: #fff; display: flex; flex-direction: column; } #ble-panel.active { transform: translateX(0); } #ble-overlay { position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.6); display: none; z-index: 2147483644; backdrop-filter: blur(4px); } #ble-overlay.active { display: block; } .ble-header { display: flex; align-items: center; justify-content: space-between; padding: 16px 20px; border-bottom: 1px solid #333; } .ble-header h3 { margin: 0; font-size: 18px; color: #fff; flex: 1; text-align: center; } .ble-btn-back { background: none; border: none; color: #0082FC; font-size: 24px; cursor: pointer; padding: 0; width: 40px; height: 40px; display: flex; align-items: center; justify-content: center; } .ble-btn-visibility-round { width: 48px; height: 48px; border-radius: 50%; border: 2px solid #0082FC; background: rgba(255,255,255,0.05); color: #888; cursor: pointer; font-size: 12px; display: flex; align-items: center; justify-content: center; transition: all 0.3s; } .ble-btn-visibility-round.active { background: #0082FC; color: #fff; border-color: #0082FC; box-shadow: 0 0 12px rgba(0,130,252,0.4); } .ble-btn-visibility-round::before { content: 'EYE'; font-size: 10px; font-weight: bold; } .ble-contacts-list { flex: 1; overflow-y: auto; padding: 0 20px; } .ble-contact-item { display: flex; align-items: center; justify-content: space-between; padding: 14px 16px; background: rgba(255,255,255,0.05); border: 1px solid #333; border-radius: 12px; margin-bottom: 10px; cursor: pointer; transition: all 0.2s; } .ble-contact-item:hover { background: rgba(0,130,252,0.1); border-color: #0082FC; } .ble-contact-item.online { border-left: 3px solid #0082FC; } .ble-contact-item.offline { border-left: 3px solid #666; } .ble-contact-item.pinned { border-left: 3px solid #FFD700; } .ble-contact-info { display: flex; flex-direction: column; flex: 1; min-width: 0; } .ble-contact-name { font-weight: 600; font-size: 15px; color: #fff; } .ble-contact-status { font-size: 11px; color: #888; margin-top: 2px; } .ble-contact-actions { display: flex; gap: 8px; } .ble-btn-menu { width: 36px; height: 36px; border-radius: 50%; background: rgba(255,255,255,0.1); color: #fff; border: none; cursor: pointer; font-size: 18px; display: flex; align-items: center; justify-content: center; transition: all 0.2s; } .ble-btn-menu:hover { background: rgba(0,130,252,0.2); } .ble-contact-menu { position: fixed; background: #1a1a1a; border: 1px solid #333; border-radius: 12px; padding: 8px 0; min-width: 160px; z-index: 2147483646; box-shadow: 0 4px 20px rgba(0,0,0,0.5); } .ble-menu-item { padding: 12px 16px; color: #fff; font-size: 14px; cursor: pointer; transition: background 0.2s; display: flex; align-items: center; gap: 8px; } .ble-menu-item:hover { background: rgba(0,130,252,0.15); } .ble-menu-delete { color: #ff4444; } .ble-menu-delete:hover { background: rgba(255,68,68,0.15); } .ble-empty { text-align: center; color: #666; padding: 40px 20px; font-style: italic; } .ble-bottom-bar { display: flex; align-items: center; justify-content: space-between; padding: 16px 20px; border-top: 1px solid #333; gap: 12px; } .ble-new-device { display: flex; align-items: center; gap: 10px; flex: 1; background: rgba(0,130,252,0.1); border: 1px solid #0082FC; border-radius: 12px; padding: 10px 14px; } .ble-new-device span { color: #fff; font-size: 14px; flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; } .ble-btn-add-small { width: 36px; height: 36px; border-radius: 50%; background: #0082FC; color: #fff; border: none; font-size: 20px; font-weight: bold; cursor: pointer; display: flex; align-items: center; justify-content: center; flex-shrink: 0; } .ble-btn-scan-round { width: 48px; height: 48px; border-radius: 50%; background: linear-gradient(135deg, #0082FC, #0055AA); color: #fff; border: none; font-size: 10px; font-weight: bold; cursor: pointer; display: flex; align-items: center; justify-content: center; flex-shrink: 0; box-shadow: 0 4px 15px rgba(0,130,252,0.3); transition: all 0.3s; } .ble-btn-scan-round.scanning { background: linear-gradient(135deg, #ff4444, #cc0000); color: #fff; animation: pulse-red 1.5s infinite; } .ble-btn-scan-round.scanning::before { content: 'STOP'; } .ble-btn-scan-round::before { content: 'SCAN'; font-size: 10px; } @keyframes pulse-red { 0%,100% { box-shadow: 0 0 0 0 rgba(255,68,68,0.4); } 50% { box-shadow: 0 0 0 10px rgba(255,68,68,0); } } .ble-status-bar { display: flex; align-items: center; justify-content: center; padding: 8px 20px; border-top: 1px solid #222; background: rgba(0,0,0,0.8); font-size: 11px; color: #666; } .ble-status-bar span { color: #0082FC; font-weight: 600; }";
document.head.appendChild(style);
}
/* =================================================================
FIX: Back de Contactos → pantalla principal (no pantalla negra)
================================================================= */
setupEventListeners() {
var self = this;
this.elements.tab.addEventListener('click', function() { self.togglePanel(); });
/* FIX: Back de Contactos maneja dos casos:
1. Si hay chat activo → cierra chat, se queda en Contactos
2. Si NO hay chat → cierra Contactos, muestra pantalla principal */
this.elements.backBtn.addEventListener('click', function() {
if (document.body.classList.contains('chat-view-active')) {
/* Caso 1: Hay chat activo → cerrar chat, quedarse en Contactos */
document.body.classList.remove('chat-view-active');
var chatBackBtn = document.getElementById('chat-back-btn');
if (chatBackBtn) chatBackBtn.classList.remove('visible');
if (window.NEXO.app) {
window.NEXO.app.activeContact = null;
}
if (window.NEXO.app && window.NEXO.app.bleInterface) {
window.NEXO.app.bleInterface._activeChatDeviceId = null;
window.NEXO.app.bleInterface._activeChatMAC = null;
}
/* No cerrar el panel, solo cerrar el chat */
return;
}
/* Caso 2: No hay chat → cerrar Contactos, mostrar pantalla principal */
self.togglePanel();
var stream = document.getElementById('nexo-stream');
if (stream) {
stream.style.display = '';
stream.style.visibility = 'visible';
stream.style.opacity = '1';
}
var tab = document.getElementById('ble-tab');
if (tab) {
tab.style.display = 'flex';
tab.style.visibility = 'visible';
tab.style.opacity = '1';
}
});
this.elements.overlay.addEventListener('click', function() { self.togglePanel(); });
this.elements.visibilityBtn.addEventListener('click', function() { self.toggleVisibility(); });
this.elements.scanBtn.addEventListener('click', function() { self.toggleScan(); });
this.elements.addBtn.addEventListener('click', function() { self._addNewDevice(); });
window.addEventListener('nexo:ble:closeChat', function() {
var tab = document.getElementById('ble-tab');
if (tab) {
tab.style.display = 'flex';
tab.style.visibility = 'visible';
tab.style.opacity = '1';
}
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
togglePanel() {
this.elements.panel.classList.toggle('active');
this.elements.overlay.classList.toggle('active');
if (this.elements.panel.classList.contains('active')) {
this.newDevicesCount = 0;
this.updateBadge();
this.renderContactsList();
} else {
var blePanel = document.getElementById('ble-panel');
var bleOverlay = document.getElementById('ble-overlay');
if (blePanel) blePanel.style.display = '';
if (bleOverlay) bleOverlay.style.display = '';
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
return Promise.resolve();
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
});
}
self.isScanning = true;
self.updateScanButton();
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
});
}
self.isScanning = true;
self.updateScanButton();
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
list.innerHTML = '<div class="ble-empty">No hay contactos. Presiona Buscar para encontrar dispositivos.</div>';
return;
}
var pinned = _getPinnedContacts();
contacts.sort(function(a, b) {
var aPinned = pinned.indexOf(_normId(a.deviceUUID)) >= 0 ? 1 : 0;
var bPinned = pinned.indexOf(_normId(b.deviceUUID)) >= 0 ? 1 : 0;
if (aPinned !== bPinned) return bPinned - aPinned;
return (b.lastSeen || 0) - (a.lastSeen || 0);
});
contacts.forEach(function(contact) {
var uuid = _normId(contact.deviceUUID);
var mac = self._uuidToMacMap.get(uuid) || _normMac(contact.macAddress);
var isOnline = contact.online && (Date.now() - (contact.lastSeen || 0)) < 60000;
var isPinned = _isPinned(uuid);
var item = document.createElement('div');
item.className = 'ble-contact-item ' + (isOnline ? 'online' : 'offline') + (isPinned ? ' pinned' : '');
item.addEventListener('click', function(e) {
if (e.target.closest('.ble-contact-menu') || e.target.closest('.ble-btn-menu')) return;
self.openChat(uuid);
});
var infoDiv = document.createElement('div');
infoDiv.className = 'ble-contact-info';
var pinIcon = isPinned ? '★ ' : '';
infoDiv.innerHTML = '<div class="ble-contact-name">' + pinIcon + (contact.name || 'NEXO Peer') + '</div><div class="ble-contact-status">' + (isOnline ? 'En linea' : 'Offline') + '</div>';
item.appendChild(infoDiv);
var actionsDiv = document.createElement('div');
actionsDiv.className = 'ble-contact-actions';
var menuBtn = document.createElement('button');
menuBtn.className = 'ble-btn-menu';
menuBtn.innerHTML = '⋮';
menuBtn.addEventListener('click', function(e) {
e.stopPropagation();
self._toggleContactMenu(uuid, menuBtn);
});
actionsDiv.appendChild(menuBtn);
item.appendChild(actionsDiv);
list.appendChild(item);
});
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
document.addEventListener('click', function closeMenu(e) {
if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener('click', closeMenu); }
});
}, 10);
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
var mac = _normMac(bar.dataset.mac);
var device = this.foundDevices.get(mac);
var name = device.name || 'NEXO Peer';
var existingUUID = this._macToUuidMap.get(mac);
var existingContact = existingUUID ? _getContactByUUID(existingUUID) : null;
if (existingContact) {
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
}
_autoConnectGATT(mac, device) {
var self = this;
if (!self.nativePlugin || !_hasNativeMethod(self.nativePlugin, 'connectToDevice')) {
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
console.warn('[BLEInterface] Auto-connect GATT fallo:', e.message);
self._setDeviceState(macNorm, BLE_STATES.DISCONNECTED);
});
}
removeContact(deviceUUID) {
try {
_removeBLEContact(deviceUUID);
this.renderContactsList();
this.renderNewDeviceBar();
} catch (e) {
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
});
}
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
updateStatusBar(text) {
if (this.elements.statusText) {
this.elements.statusText.textContent = text || 'NEXO BLE';
}
}
updateStatus(customStatus) {
var self = this;
if (customStatus) {
self.updateStatusBar(customStatus);
return Promise.resolve();
}
if (self.isDummyMode) {
self.updateStatusBar('OFFLINE (Dummy)');
return Promise.resolve();
}
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
.catch(function(err) {
console.error('[BLEInterface] Error consultando estado:', err);
self.updateStatusBar('ERROR');
});
}
self.updateStatusBar('NEXO BLE');
return Promise.resolve();
}
}
/*
Focos de Interés (Firmas):
 * v5.0.7-CONTACTOS-ES5
 * initBLEInterface: Inicia la interfaz BLE.
 * _saveMacMaps & _loadMacMaps: Gestión de persistencia de mapas UUID/MAC.
 * _addBLEContact & _removeBLEContact: Gestión de contactos BLE.
 * _setupNativePayloadListener: Procesamiento de mensajes recibidos vía GATT.
 * sendChatMessage: Lógica de envío de mensajes y reconexión automática.
 * openChat: Lógica de UI para abrir chat y manejar transiciones.
 * toggleVisibility & toggleScan: Control de publicidad y escaneo.
 * _initVisibility: Inicializa estado de visibilidad.
 * createDOM & injectStyles: Generación de interfaz de usuario.
 * setupEventListeners: Gestión de eventos de UI incluyendo el fix de navegación.
 * _autoConnectGATT: Reconexión automática a dispositivos conocidos.
   */
