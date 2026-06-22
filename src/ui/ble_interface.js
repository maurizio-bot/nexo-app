/**
 * BLE Interface v4.2.9-ARMORED-FIXED
 * Base: v4.2.8-ARMORED-FIXED
 * FIX: _normMac quita dos puntos para consistencia de formato MAC
 * FIX: _sendMessageNative acepta estado READY_TO_CHAT sin connectedDevices
 * FIX: sendChatMessage conecta GATT si no está conectado, sin depender de _activeChatMAC
 * FIX: openChat guarda MAC normalizada (sin dos puntos) en _activeChatMAC
 * ES5 syntax compatible con webpack
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
console.warn('[BLEInterface] No se pudieron cargar MAC maps:', e.message);
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
/* ============================================================
   FIX v4.2.9: _normMac normaliza MAC quitando dos puntos y lowercase
   ============================================================ */
function _normMac(mac) {
var m = _normId(mac);
if (!m) return '';
/* Quitar todos los separadores (: - .) */
m = m.replace(/[:\\-\\.]/g, '');
/* Validar: debe ser 12 hex chars */
if (!/^[0-9a-f]{12}$/.test(m)) return '';
return m;
}
function _macWithColons(mac) {
var m = _normMac(mac);
if (!m) return '';
return m.match(/.{2}/g).join(':');
}
function _isValidMAC(mac) {
var m = _normMac(mac);
return m.length === 12;
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
/* ============================================================
PROTOCOLO ANTI-CRASH: Helpers defensivos para plugin nativo
============================================================ */
function _hasNativeMethod(plugin, method) {
return plugin && typeof plugin[method] === 'function';
}
function _safeNativeCall(plugin, method, args) {
return new Promise(function(resolve, reject) {
if (!plugin) {
reject(new Error('Plugin nativo no disponible'));
return;
}
if (typeof plugin[method] !== 'function') {
reject(new Error('Metodo ' + method + ' no disponible en plugin nativo'));
return;
}
try {
var callArgs;
if (Array.isArray(args)) {
callArgs = args;
} else if (args) {
var hasKeys = false;
for (var k in args) { if (args.hasOwnProperty(k)) { hasKeys = true; break; } }
callArgs = hasKeys ? [args] : [];
} else {
callArgs = [];
}
var result = plugin[method].apply(plugin, callArgs);
if (result && typeof result.then === 'function') {
result.then(resolve).catch(reject);
} else {
resolve(result);
}
} catch (e) {
reject(e);
}
});
}
function _safeDispatchEvent(eventName, detail) {
try {
window.dispatchEvent(new CustomEvent(eventName, { detail: detail }));
} catch (e) {
console.warn('[BLEInterface] Error dispatching ' + eventName + ':', e.message);
}
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
this._reconnectTimers = new Map();
this._serverReady = false;
this._macToUuidMap = new Map();
this._uuidToMacMap = new Map();
this._pendingAdds = new Map();
this._maxReconnectAttempts = 10;
this._reconnectAttemptCounts = new Map();
/* FIX v4.2.9: Cargar maps desde localStorage con MACs normalizadas */
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
console.log('[BLEInterface] MAC maps cargados:', this._uuidToMacMap.size, 'entradas');
/* OPTIMIZACION: Resolvers event-driven para _waitForReadyToChat */
this._readyResolvers = new Map();
/* WORKAROUND: Timers fallback para onNotificationsEnabled */
this._notificationFallbackTimers = new Map();
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
this._initVisibility();
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
async _autoStartAdvertising() {
if (this.isDummyMode || !this.nativePlugin) return;
try {
if (!_hasNativeMethod(this.nativePlugin, 'isBluetoothEnabled')) return;
var btState = await _safeNativeCall(this.nativePlugin, 'isBluetoothEnabled', {});
if (btState && btState.canAdvertise) {
if (_hasNativeMethod(this.nativePlugin, 'startAdvertising')) {
await _safeNativeCall(this.nativePlugin, 'startAdvertising', {});
this.isAdvertising = true;
this.updateVisibilityButton();
}
}
} catch (e) {
console.warn('[BLEInterface] Auto-advertise fallo:', e.message);
}
}
async _loadLocalDeviceInfo() {
if (!this.nativePlugin || !_hasNativeMethod(this.nativePlugin, 'getLocalDeviceInfo')) return;
try {
var info = await _safeNativeCall(this.nativePlugin, 'getLocalDeviceInfo', {});
this.localDeviceName = (info && info.deviceName) || 'NEXO Device';
this.localDeviceAddress = _normMac((info && info.deviceAddress) || '');
} catch (e) {}
}
_setupNativeScanListeners() {
if (!this.nativePlugin) return;
if (!_hasNativeMethod(this.nativePlugin, 'addListener')) {
console.warn('[BLEInterface] addListener no disponible en plugin');
return;
}
if (this._nativeDeviceFoundListener) {
try { this._nativeDeviceFoundListener.remove(); } catch (e) {}
}
if (this._nativeScanFailedListener) {
try { this._nativeScanFailedListener.remove(); } catch (e) {}
}
var self = this;
this._nativeDeviceFoundListener = this.nativePlugin.addListener('onDeviceFound', function(data) {
try {
var mac = _normMac(data.deviceId);
var name = data.name || 'NEXO Device';
if (!mac) return;
self.onDeviceFound({ id: mac, address: mac, name: name, rssi: data.rssi });
} catch (e) {
console.warn('[BLEInterface] Error en onDeviceFound callback:', e.message);
}
});
this._nativeScanFailedListener = this.nativePlugin.addListener('onScanFailed', function(data) {
try {
self.isScanning = false;
self.updateScanButton();
self.showToast('Error al escanear', 'error');
} catch (e) {
console.warn('[BLEInterface] Error en onScanFailed callback:', e.message);
}
});
}
_setupNativeServerReadyListener() {
if (!this.nativePlugin) return;
if (!_hasNativeMethod(this.nativePlugin, 'addListener')) return;
if (this._nativeServerReadyListener) {
try { this._nativeServerReadyListener.remove(); } catch (e) {}
}
var self = this;
this._nativeServerReadyListener = this.nativePlugin.addListener('onServerReady', function(data) {
try {
console.log('[BLEInterface] onServerReady recibido:', data);
self._serverReady = true;
} catch (e) {
console.warn('[BLEInterface] Error en onServerReady callback:', e.message);
}
});
}
_setupNativeConnectionListeners() {
if (!this.nativePlugin) return;
if (!_hasNativeMethod(this.nativePlugin, 'addListener')) return;
if (this._nativeDeviceConnectedListener) {
try { this._nativeDeviceConnectedListener.remove(); } catch (e) {}
}
if (this._nativeDeviceDisconnectedListener) {
try { this._nativeDeviceDisconnectedListener.remove(); } catch (e) {}
}
var self = this;
this._nativeDeviceConnectedListener = this.nativePlugin.addListener('onDeviceConnected', function(data) {
try {
var mac = _normMac(data.deviceId);
if (!mac) return;
var attempt = data.attempt || 0;
self._cancelReconnect(mac);
var peerUUID = self._macToUuidMap.get(mac);
var contact = peerUUID ? _getContactByUUID(peerUUID) : null;
var displayName = data.name || (contact ? contact.name : null) || 'NEXO Peer';
if (data.direction === 'incoming') {
self._setDeviceState(mac, BLE_STATES.READY_TO_CHAT, { direction: 'incoming', role: 'peer_connected', deviceUUID: peerUUID });
self.connectedDevices.set(mac, { id: mac, address: mac, name: displayName, direction: 'incoming', servicesReady: true, deviceUUID: peerUUID });
} else {
self._setDeviceState(mac, BLE_STATES.CONNECTING, { direction: 'outgoing', attempt: attempt, role: 'client', deviceUUID: peerUUID });
self.connectedDevices.set(mac, { id: mac, address: mac, name: displayName, direction: 'outgoing', servicesReady: false, deviceUUID: peerUUID });
}
self._processPendingAdd(mac);
} catch (e) {
console.warn('[BLEInterface] Error en onDeviceConnected callback:', e.message);
}
});
this._nativeDeviceDisconnectedListener = this.nativePlugin.addListener('onDeviceDisconnected', function(data) {
try {
var mac = _normMac(data.deviceId);
if (!mac) return;
self._setDeviceState(mac, BLE_STATES.DISCONNECTED);
self.connectedDevices.delete(mac);
if (self._activeChatMAC === mac) {
self._startReconnect(mac);
}
} catch (e) {
console.warn('[BLEInterface] Error en onDeviceDisconnected callback:', e.message);
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
_saveMacMaps(this._uuidToMacMap, this._macToUuidMap);
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
var macNorm = _normMac(mac);
if (!macNorm) {
reject(new Error('MAC invalida'));
return;
}
var state = self._getDeviceState(macNorm);
if (state.state === BLE_STATES.READY_TO_CHAT || state.state === BLE_STATES.NOTIFICATIONS_READY) {
resolve();
return;
}
var timer = setTimeout(function() {
self._readyResolvers.delete(macNorm);
reject(new Error('Timeout'));
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
_startReconnect(deviceMAC) {
this._cancelReconnect(deviceMAC);
var macNorm = _normMac(deviceMAC);
if (!macNorm) return;
var currentAttempts = this._reconnectAttemptCounts.get(macNorm) || 0;
if (currentAttempts >= this._maxReconnectAttempts) {
console.warn('[BLEInterface] Max reintentos alcanzado para', macNorm);
this._setDeviceState(macNorm, BLE_STATES.ERROR, { message: 'Max reintentos alcanzados' });
return;
}
this._reconnectAttemptCounts.set(macNorm, currentAttempts + 1);
this._setDeviceState(macNorm, BLE_STATES.RECONNECTING, { message: 'Reconectando...' });
var self = this;
var attemptReconnect = async function() {
if (self._activeChatMAC !== macNorm) return;
try {
if (_hasNativeMethod(self.nativePlugin, 'forceReconnect')) {
await _safeNativeCall(self.nativePlugin, 'forceReconnect', { deviceId: _macWithColons(macNorm) });
}
} catch (e) {
var timer = setTimeout(attemptReconnect, 3000);
self._reconnectTimers.set(macNorm, timer);
}
};
attemptReconnect();
}
_cancelReconnect(deviceMAC) {
var macNorm = _normMac(deviceMAC);
if (!macNorm) return;
var timer = this._reconnectTimers.get(macNorm);
if (timer) {
clearTimeout(timer);
this._reconnectTimers.delete(macNorm);
}
this._reconnectAttemptCounts.delete(macNorm);
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
console.warn('[BLEInterface] Workaround: forzando READY_TO_CHAT por timeout de notificaciones');
self._setDeviceState(mac, BLE_STATES.READY_TO_CHAT);
self._resolveReadyToChat(mac);
}
}, 3000);
self._notificationFallbackTimers.set(mac, fallbackTimer);
} catch (e) {
console.warn('[BLEInterface] Error en onServicesReady callback:', e.message);
}
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
} catch (e) {
console.warn('[BLEInterface] Error en onNotificationsEnabled callback:', e.message);
}
});
this._nativeConnectionFailedListener = this.nativePlugin.addListener('onConnectionFailed', function(data) {
try {
var mac = _normMac(data.deviceId);
if (!mac) return;
var ft = self._notificationFallbackTimers.get(mac);
if (ft) { clearTimeout(ft); self._notificationFallbackTimers.delete(mac); }
if (data.recoverable !== false && data.attempt < (data.maxAttempts || 3)) {
self._setDeviceState(mac, BLE_STATES.CONNECTING, { attempt: data.attempt, message: 'Reintentando...' });
} else {
self._setDeviceState(mac, BLE_STATES.ERROR, { lastError: data.reason });
}
} catch (e) {
console.warn('[BLEInterface] Error en onConnectionFailed callback:', e.message);
}
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
var messageId = null;
var senderName = null;
var senderUUID = null;
var content = data.content || data.data || '';
/* Fast-path JSON parsing */
if (content.charAt(0) === '{' || (data.data && data.data.charAt(0) === '{')) {
try {
var json = JSON.parse(data.data || content || '{}');
if (json.messageId) messageId = json.messageId;
if (json.senderName) senderName = json.senderName;
else if (json.deviceName) senderName = json.deviceName;
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
if (senderUUID && !_isBLEContact(senderUUID) && senderName && senderName !== 'NEXO Peer') {
self._macToUuidMap.set(mac, senderUUID);
self._uuidToMacMap.set(senderUUID, mac);
_saveMacMaps(self._uuidToMacMap, self._macToUuidMap);
_addBLEContact({ deviceUUID: senderUUID, name: senderName, macAddress: mac });
self.renderContactsList();
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
source: data.source || 'unknown',
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
console.warn('[BLEInterface] Error en onPayloadReceived callback:', e.message);
self.showToast('Error al recibir mensaje: ' + (e.message || 'desconocido'), 'error');
}
});
}
async _processPendingMessages(deviceMAC) {
var macNorm = _normMac(deviceMAC);
if (!macNorm) {
this.showToast('Error interno: MAC invalida en cola de mensajes', 'error');
return;
}
var queue = this._pendingMessageQueue.get(macNorm);
if (!queue || queue.length === 0) return;
this._pendingMessageQueue.delete(macNorm);
var failed = 0;
for (var i = 0; i < queue.length; i++) {
var item = queue[i];
try {
await this._sendMessageNative(macNorm, item.content, item.messageId);
item.resolve();
} catch (e) {
failed++;
item.reject(e);
}
}
if (failed > 0) {
this.showToast(failed + ' mensaje(s) pendiente(s) no se pudieron enviar', 'error');
}
}
/* ============================================================
   FIX v4.2.9: _sendMessageNative acepta estado READY_TO_CHAT sin connectedDevices
   Usa MAC sin dos puntos para claves internas, con dos puntos para plugin nativo
   ============================================================ */
async _sendMessageNative(deviceMAC, content, messageId) {
try {
if (!this.nativePlugin) {
this.showToast('Plugin BLE no disponible para enviar', 'error');
throw new Error('Plugin no disponible');
}
var macNorm = _normMac(deviceMAC);
if (!macNorm) {
this.showToast('Direccion MAC invalida para envio', 'error');
throw new Error('MAC invalida');
}
var state = this._getDeviceState(macNorm);
var isStateReady = state.state === BLE_STATES.READY_TO_CHAT || state.state === BLE_STATES.NOTIFICATIONS_READY;
/* FIX v4.2.9: Aceptar estado READY_TO_CHAT como suficiente, no requerir connectedDevices */
if (!isStateReady) {
this.showToast('Dispositivo no conectado. Reconecte primero.', 'error');
throw new Error('Dispositivo no conectado');
}
/* Usar MAC con dos puntos para el plugin nativo */
var targetId = _macWithColons(macNorm);
var enrichedPayload = JSON.stringify({
deviceUUID: this.localDeviceUUID,
senderName: this.localDeviceName,
content: content,
messageId: messageId || ('msg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9)),
timestamp: Date.now()
});
if (_hasNativeMethod(this.nativePlugin, 'sendMessage')) {
await _safeNativeCall(this.nativePlugin, 'sendMessage', { deviceId: targetId, message: enrichedPayload });
this.showToast('Mensaje enviado por BLE', 'success');
} else {
this.showToast('Metodo sendMessage no disponible en plugin', 'error');
throw new Error('sendMessage no disponible en plugin');
}
} catch (e) {
this.showToast('Fallo al enviar mensaje: ' + (e.message || 'Error desconocido'), 'error');
throw e;
}
}
/* ============================================================
   FIX v4.2.9: sendChatMessage - conexión GATT automática robusta
   ============================================================ */
sendChatMessage(deviceUUID, content, messageId) {
var self = this;
return new Promise(function(resolve, reject) {
try {
var uuid = _normId(deviceUUID);
if (!uuid) {
self.showToast('Error: ID de dispositivo vacio', 'error');
reject(new Error('deviceUUID vacio'));
return;
}
if (!content || typeof content !== 'string' || content.trim() === '') {
self.showToast('Error: Mensaje vacio', 'warning');
reject(new Error('Mensaje vacio'));
return;
}
/* === PASO 3: Buscar contacto y MAC === */
var contact = _getContactByUUID(uuid);
var mac = self._uuidToMacMap.get(uuid);
if (!mac && self._activeChatMAC) {
mac = self._activeChatMAC;
}
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
self.showToast('Dispositivo no encontrado para chat. Verifica el contacto.', 'error', 4000);
reject(new Error('Dispositivo no encontrado para chat'));
return;
}
/* Normalizar MAC */
mac = _normMac(mac);
/* Sincronizar maps para futuro */
if (contact && !self._uuidToMacMap.get(uuid)) {
self._uuidToMacMap.set(uuid, mac);
self._macToUuidMap.set(mac, uuid);
_saveMacMaps(self._uuidToMacMap, self._macToUuidMap);
}

/* === PASO 4-5: Verificar estado y conectar si es necesario === */
var state = self._getDeviceState(mac);
var isReady = state.state === BLE_STATES.READY_TO_CHAT || state.state === BLE_STATES.NOTIFICATIONS_READY;
var isConnecting = state.state === BLE_STATES.CONNECTING || state.state === BLE_STATES.DISCOVERING_SERVICES;

var doSend = function() {
self._sendMessageNative(mac, content, messageId).then(function() {
resolve();
}).catch(function(err) {
reject(err);
});
};

if (!isReady && !isConnecting && self.nativePlugin && _hasNativeMethod(self.nativePlugin, 'connectToDevice')) {
self.showToast('Conectando GATT...', 'info', 2000);
_safeNativeCall(self.nativePlugin, 'connectToDevice', { deviceId: _macWithColons(mac) })
.then(function(connResult) {
if (connResult && (connResult.connected || connResult.alreadyConnected)) {
return self._waitForReadyToChat(mac, 8000);
}
throw new Error('No se pudo conectar al dispositivo');
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
self._waitForReadyToChat(mac, 8000)
.then(function() {
doSend();
})
.catch(function(err) {
reject(err);
});
return;
}

if (!isReady) {
self.showToast('Canal BLE no listo. Intente de nuevo.', 'warning', 3000);
reject(new Error('Canal BLE no listo'));
return;
}

doSend();

} catch (fatal) {
self.showToast('Error critico al enviar: ' + (fatal.message || 'desconocido'), 'error', 4000);
reject(fatal);
}
});
}
async _initVisibility() {
if (this.isDummyMode) return;
try {
if (_hasNativeMethod(this.nativePlugin, 'isBluetoothEnabled')) {
var btState = await _safeNativeCall(this.nativePlugin, 'isBluetoothEnabled', {});
this.canAdvertise = (btState && btState.canAdvertise) || false;
this._serverReady = (btState && btState.serverReady) || false;
}
if (_hasNativeMethod(this.nativePlugin, 'isAdvertising')) {
var adState = await _safeNativeCall(this.nativePlugin, 'isAdvertising', {});
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
if (!_hasNativeMethod(this.nativePlugin, 'addListener')) return;
if (this._nativeAdStartedListener) {
try { this._nativeAdStartedListener.remove(); } catch (e) {}
}
if (this._nativeAdFailedListener) {
try { this._nativeAdFailedListener.remove(); } catch (e) {}
}
var self = this;
this._nativeAdStartedListener = this.nativePlugin.addListener('onAdvertiseStarted', function() {
try {
self.isAdvertising = true;
self.updateVisibilityButton();
} catch (e) {
console.warn('[BLEInterface] Error en onAdvertiseStarted callback:', e.message);
}
});
this._nativeAdFailedListener = this.nativePlugin.addListener('onAdvertiseFailed', function() {
try {
self.isAdvertising = false;
self.updateVisibilityButton();
} catch (e) {
console.warn('[BLEInterface] Error en onAdvertiseFailed callback:', e.message);
}
});
}
updateVisibilityButton() {
var btn = this.elements.visibilityBtn;
if (!btn) return;
if (this.isAdvertising) {
btn.classList.add('active');
btn.style.background = '#4169E1';
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
if (_hasNativeMethod(this.nativePlugin, 'initializeBLE')) {
await _safeNativeCall(this.nativePlugin, 'initializeBLE', {
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
}
} catch (e) {
this.showToast('No se pudo inicializar servidor', 'error', 5000);
return;
}
}
try {
if (this.isAdvertising) {
if (_hasNativeMethod(this.nativePlugin, 'stopAdvertising')) {
await _safeNativeCall(this.nativePlugin, 'stopAdvertising', {});
}
this.isAdvertising = false;
} else {
if (_hasNativeMethod(this.nativePlugin, 'startAdvertising')) {
await _safeNativeCall(this.nativePlugin, 'startAdvertising', {});
}
this.isAdvertising = true;
}
this.updateVisibilityButton();
} catch (err) {
this.showToast('Error: ' + (err.message || 'desconocido'), 'error');
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
style.textContent = `
#ble-tab { position: fixed; left: 0; top: 50%; transform: translateY(-50%); width: 44px; height: 100px; background: linear-gradient(180deg, #4169E1, #191970); border-radius: 0 12px 12px 0; display: flex; flex-direction: column; align-items: center; justify-content: center; cursor: pointer; z-index: 2147483644; color: #000; font-weight: bold; }
.ble-tab-badge { position: absolute; top: 5px; right: -5px; background: #ff4444; color: white; width: 18px; height: 18px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 10px; animation: pulse 2s infinite; }
@keyframes pulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.1); } }
#ble-panel { position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: #000000; transform: translateX(-100%); transition: transform 0.3s ease; z-index: 2147483645; color: #fff; display: flex; flex-direction: column; }
#ble-panel.active { transform: translateX(0); }
#ble-overlay { position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.6); display: none; z-index: 2147483644; backdrop-filter: blur(4px); }
#ble-overlay.active { display: block; }
.ble-header { display: flex; align-items: center; justify-content: space-between; padding: 16px 20px; border-bottom: 1px solid #333; }
.ble-header h3 { margin: 0; font-size: 18px; color: #fff; flex: 1; text-align: center; }
.ble-btn-back { background: none; border: none; color: #4169E1; font-size: 24px; cursor: pointer; padding: 0; width: 40px; height: 40px; display: flex; align-items: center; justify-content: center; }
.ble-btn-visibility-round { width: 44px; height: 44px; border-radius: 50%; border: 2px solid #4169E1; background: rgba(255,255,255,0.1); color: #888; cursor: pointer; font-size: 12px; display: flex; align-items: center; justify-content: center; transition: all 0.3s; }
.ble-btn-visibility-round.active { background: #4169E1; color: #000; border-color: #4169E1; box-shadow: 0 0 12px rgba(65,105,225,0.4); }
.ble-btn-visibility-round::before { content: 'EYE'; font-size: 10px; font-weight: bold; }
.ble-status-bar { padding: 8px 20px; }
.ble-status-offline { font-size: 12px; color: #888; }
.ble-status-online { font-size: 12px; color: #4169E1; }
.ble-status-scanning { font-size: 12px; color: #ffaa00; animation: blink 1s infinite; }
@keyframes blink { 0%,50% { opacity: 1; } 51%,100% { opacity: 0.7; } }
.ble-contacts-list { flex: 1; overflow-y: auto; padding: 0 20px; }
.ble-contact-item { display: flex; align-items: center; justify-content: space-between; padding: 14px 16px; background: rgba(255,255,255,0.05); border: 1px solid #333; border-radius: 12px; margin-bottom: 10px; cursor: pointer; transition: all 0.2s; }
.ble-contact-item:hover { background: rgba(65,105,225,0.1); border-color: #4169E1; }
.ble-contact-item.online { border-left: 3px solid #4169E1; }
.ble-contact-item.offline { border-left: 3px solid #666; }
.ble-contact-info { display: flex; flex-direction: column; flex: 1; min-width: 0; }
.ble-contact-name { font-weight: 600; font-size: 15px; color: #fff; }
.ble-contact-status { font-size: 11px; color: #888; margin-top: 2px; }
.ble-contact-actions { display: flex; gap: 8px; }
.ble-btn-chat { padding: 8px 16px; background: #4169E1; color: #000; border: none; border-radius: 8px; cursor: pointer; font-size: 12px; font-weight: bold; }
.ble-btn-remove { padding: 8px 12px; background: #ff4444; color: #fff; border: none; border-radius: 8px; cursor: pointer; font-size: 12px; }
.ble-empty { text-align: center; color: #666; padding: 40px 20px; font-style: italic; }
.ble-bottom-bar { display: flex; align-items: center; justify-content: space-between; padding: 16px 20px; border-top: 1px solid #333; gap: 12px; }
.ble-new-device { display: flex; align-items: center; gap: 10px; flex: 1; background: rgba(65,105,225,0.1); border: 1px solid #4169E1; border-radius: 12px; padding: 10px 14px; }
.ble-new-device span { color: #fff; font-size: 14px; flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ble-btn-add-small { width: 36px; height: 36px; border-radius: 50%; background: #4169E1; color: #000; border: none; font-size: 20px; font-weight: bold; cursor: pointer; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.ble-btn-scan-round { width: 56px; height: 56px; border-radius: 50%; background: linear-gradient(135deg, #4169E1, #191970); color: #000; border: none; font-size: 14px; font-weight: bold; cursor: pointer; display: flex; align-items: center; justify-content: center; flex-shrink: 0; box-shadow: 0 4px 15px rgba(65,105,255,0.3); transition: all 0.3s; }
.ble-btn-scan-round.scanning { background: linear-gradient(135deg, #ff4444, #cc0000); color: #fff; animation: pulse-red 1.5s infinite; }
.ble-btn-scan-round.scanning::before { content: 'STOP'; }
.ble-btn-scan-round::before { content: 'SCAN'; font-size: 10px; }
@keyframes pulse-red { 0%,100% { box-shadow: 0 0 0 0 rgba(255,68,68,0.4); } 50% { box-shadow: 0 0 0 10px rgba(255,68,68,0); } }
.ble-toast { position: fixed; bottom: 100px; left: 50%; transform: translateX(-50%); padding: 12px 24px; border-radius: 8px; color: #fff; font-weight: bold; z-index: 2147483646; animation: fadeInUp 0.3s ease; }
.ble-toast.success { background: #4169E1; color: #000; }
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
if (_hasNativeMethod(this.nativePlugin, 'stopScan')) {
await _safeNativeCall(this.nativePlugin, 'stopScan', {});
}
this.isScanning = false;
this.updateScanButton();
this.updateStatus();
} else {
this.foundDevices.clear();
this._renderedDeviceIds.clear();
this.renderContactsList();
this.renderNewDeviceBar();
if (_hasNativeMethod(this.nativePlugin, 'startScan')) {
await _safeNativeCall(this.nativePlugin, 'startScan', {});
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
var bar = this.elements.newDeviceBar;
var mac = _normMac(bar.dataset.mac);
if (!mac) return;
var device = this.foundDevices.get(mac);
if (!device) return;
var name = device.name || 'NEXO Peer';
var existingByName = _getContactByName(name);
if (existingByName && name !== 'NEXO Peer' && name !== 'NEXO Device') {
this.showToast('Ya tienes un contacto con ese nombre', 'warning');
return;
}
var tempUUID = 'mac-' + mac;
this._macToUuidMap.set(mac, tempUUID);
this._uuidToMacMap.set(tempUUID, mac);
_saveMacMaps(this._uuidToMacMap, this._macToUuidMap);
_addBLEContact({ deviceUUID: tempUUID, name: name, macAddress: mac });
this._autoConnectGATT(mac, device);
this.foundDevices.delete(mac);
this.renderContactsList();
this.renderNewDeviceBar();
this.showToast('Agregado: ' + name, 'success');
}
async _autoConnectGATT(mac, device) {
if (!this.nativePlugin || !_hasNativeMethod(this.nativePlugin, 'connectToDevice')) {
console.warn('[BLEInterface] Plugin no tiene connectToDevice, skip auto-connect');
return;
}
var macNorm = _normMac(mac);
if (!macNorm) return;
var state = this._getDeviceState(macNorm);
if (state.state === BLE_STATES.READY_TO_CHAT || state.state === BLE_STATES.NOTIFICATIONS_READY || state.state === BLE_STATES.CONNECTING) {
return;
}
this._setDeviceState(macNorm, BLE_STATES.CONNECTING, { direction: 'outgoing', role: 'client', auto: true });
this.connectedDevices.set(macNorm, {
id: macNorm,
address: macNorm,
name: (device && device.name) || 'NEXO Peer',
direction: 'outgoing',
servicesReady: false,
deviceUUID: this._macToUuidMap.get(macNorm)
});
try {
console.log('[BLEInterface] Auto-connect GATT a', macNorm, '...');
var result = await _safeNativeCall(this.nativePlugin, 'connectToDevice', { deviceId: _macWithColons(macNorm) });
console.log('[BLEInterface] Auto-connect resultado:', result);
if (result && (result.connected || result.alreadyConnected)) {
await this._waitForReadyToChat(macNorm, 8000);
console.log('[BLEInterface] Auto-connect exitoso para', macNorm);
} else {
this._setDeviceState(macNorm, BLE_STATES.DISCONNECTED);
}
} catch (e) {
console.warn('[BLEInterface] Auto-connect GATT fallo:', e.message);
this._setDeviceState(macNorm, BLE_STATES.DISCONNECTED);
}
}
async openChat(deviceUUID) {
var self = this;
try {
var uuid = _normId(deviceUUID);
if (!uuid) {
self.showToast('ID de dispositivo invalido', 'warning');
return;
}
var contact = _getContactByUUID(uuid);
var mac = self._uuidToMacMap.get(uuid) || _normMac(contact && contact.macAddress);
if (!mac && contact) {
self.foundDevices.forEach(function(d, m) {
if (!mac && d.deviceUUID === uuid) mac = m;
});
self.connectedDevices.forEach(function(d, m) {
if (!mac && d.deviceUUID === uuid) mac = m;
});
}
var displayName = (contact && contact.name) || 'NEXO Peer';
if (!_isValidMAC(mac)) {
self.showToast('Dispositivo no disponible para conectar', 'warning');
return;
}
mac = _normMac(mac);
self._activeChatDeviceId = uuid;
self._activeChatMAC = mac;
self.newDevicesCount = 0;
self.updateBadge();
_saveMacMaps(self._uuidToMacMap, self._macToUuidMap);
var state = self._getDeviceState(mac);
var isFullyReady = state.state === BLE_STATES.READY_TO_CHAT || state.state === BLE_STATES.NOTIFICATIONS_READY;
var isConnecting = state.state === BLE_STATES.CONNECTING || state.state === BLE_STATES.DISCOVERING_SERVICES;
var lastSeen = contact ? contact.lastSeen : 0;
var isRecent = lastSeen && (Date.now() - lastSeen) < 30000;
var timeoutMs = isRecent ? 5000 : 15000;
if (!isFullyReady && self.nativePlugin && _hasNativeMethod(self.nativePlugin, 'connectToDevice')) {
if (!isConnecting) {
try {
var connResult = await _safeNativeCall(self.nativePlugin, 'connectToDevice', { deviceId: _macWithColons(mac) });
if (connResult && (connResult.connected || connResult.alreadyConnected)) {
try {
await self._waitForReadyToChat(mac, timeoutMs);
isFullyReady = true;
} catch (e) {
self.showToast('Canal aun no listo. Intente enviar en unos segundos.', 'warning');
}
}
} catch (e) {
self.showToast('Canal aun no listo. Intente enviar en unos segundos.', 'warning');
}
} else {
try {
await self._waitForReadyToChat(mac, timeoutMs);
isFullyReady = true;
} catch (e) {
self.showToast('Canal aun no listo. Intente enviar en unos segundos.', 'warning');
}
}
}
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
self.showToast('Chat con ' + displayName + ' listo', 'success');
self.togglePanel();
} catch (fatalErr) {
console.error('[BLEInterface] FATAL openChat:', fatalErr);
self.showToast('Error al abrir chat: ' + (fatalErr.message || 'desconocido'), 'error');
}
}
async removeContact(deviceUUID) {
try {
_removeBLEContact(deviceUUID);
this.showToast('Eliminado', 'info');
this.renderContactsList();
this.renderNewDeviceBar();
} catch (e) {
this.showToast('Error al eliminar contacto: ' + (e.message || 'desconocido'), 'error');
}
}
async disconnect(deviceMAC) {
if (this.isDummyMode) return;
var macNorm = _normMac(deviceMAC);
if (!macNorm) return;
try {
this._cancelReconnect(macNorm);
var device = this.connectedDevices.get(macNorm);
var targetId = (device && device.id) || (device && device.address) || _macWithColons(macNorm);
if (_hasNativeMethod(this.nativePlugin, 'disconnectDevice')) {
await _safeNativeCall(this.nativePlugin, 'disconnectDevice', { deviceId: targetId });
}
var uuid = this._macToUuidMap.get(macNorm);
if (this._activeChatDeviceId === uuid || this._activeChatMAC === macNorm) {
this._activeChatDeviceId = null;
this._activeChatMAC = null;
this.updateBadge();
}
} catch (err) {
this.showToast('Error al desconectar: ' + (err.message || 'desconocido'), 'error');
}
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
if (_hasNativeMethod(this.nativePlugin, 'isBluetoothEnabled')) {
var btState = await _safeNativeCall(this.nativePlugin, 'isBluetoothEnabled', {});
state = (btState && btState.enabled) ? 'poweredOn' : 'poweredOff';
this._serverReady = (btState && btState.serverReady) || false;
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
var self = this;
this._readyResolvers.forEach(function(resolver, nid) {
clearTimeout(resolver.timer);
try { resolver.resolve(); } catch(e) {}
});
this._readyResolvers.clear();
this._notificationFallbackTimers.forEach(function(timer) { clearTimeout(timer); });
this._notificationFallbackTimers.clear();
var listeners = [
this._nativeAdStartedListener,
this._nativeAdFailedListener,
this._nativeDeviceFoundListener,
this._nativeScanFailedListener,
this._nativeDeviceConnectedListener,
this._nativeDeviceDisconnectedListener,
this._nativePayloadListener,
this._nativeServicesReadyListener,
this._nativeNotificationsListener,
this._nativeConnectionFailedListener,
this._nativeServerReadyListener
];
for (var i = 0; i < listeners.length; i++) {
if (listeners[i]) {
try { listeners[i].remove(); } catch (e) {}
}
}
if (this.isScanning) {
try { this.toggleScan(); } catch (e) {}
}
}
}
window.bleInterface = null;
