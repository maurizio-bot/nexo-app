/**
 * BLE Interface v4.2.2-ARMORED
 * Base: v4.2.1-FUSION + Protocolo Anti-Crash completo
 * FIX: Validaciones defensivas en TODAS las llamadas al plugin nativo
 * Validacion estricta de MAC/null/undefined strings
 * Try-catch maestro en openChat()
 * Safe wrappers para nativePlugin calls
 * Safe event dispatch
 * ES5 syntax compatible con webpack
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
function _isValidMAC(mac) {
var m = _normId(mac);
return m && m !== 'null' && m !== 'undefined' && m.length >= 2;
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
if (existingIdx >= 0) {
contacts[existingIdx].name = contact.name || contacts[existingIdx].name || 'NEXO Peer';
contacts[existingIdx].macAddress = contact.macAddress || contacts[existingIdx].macAddress;
contacts[existingIdx].lastSeen = Date.now();
contacts[existingIdx].online = true;
_saveBLEContacts(contacts);
return true;
}
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
var result = plugin[method].apply(plugin, args || []);
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
this._autoStartAdvertising();
}
console.log('[BLEInterface] UUID local:', this.localDeviceUUID);
return this;
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
this.localDeviceAddress = _normId((info && info.deviceAddress) || '');
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
var mac = _normId(data.deviceId);
var name = data.name || 'NEXO Device';
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
var mac = _normId(data.deviceId);
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
var mac = _normId(data.deviceId);
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
if (!_isValidMAC(mac)) {
reject(new Error('MAC invalida'));
return;
}
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
var currentAttempts = this._reconnectAttemptCounts.get(deviceMAC) || 0;
if (currentAttempts >= this._maxReconnectAttempts) {
console.warn('[BLEInterface] Max reintentos alcanzado para', deviceMAC);
this._setDeviceState(deviceMAC, BLE_STATES.ERROR, { message: 'Max reintentos alcanzados' });
return;
}
this._reconnectAttemptCounts.set(deviceMAC, currentAttempts + 1);
this._setDeviceState(deviceMAC, BLE_STATES.RECONNECTING, { message: 'Reconectando...' });
var self = this;
var attemptReconnect = async function() {
if (self._activeChatMAC !== deviceMAC) return;
try {
if (_hasNativeMethod(self.nativePlugin, 'forceReconnect')) {
await _safeNativeCall(self.nativePlugin, 'forceReconnect', { deviceId: deviceMAC });
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
this._reconnectAttemptCounts.delete(deviceMAC);
}
_setupNativeStateListeners() {
if (!this.nativePlugin) return;
if (!_hasNativeMethod(this.nativePlugin, 'addListener')) return;
var self = this;
this._nativeServicesReadyListener = this.nativePlugin.addListener('onServicesReady', function(data) {
try {
var mac = _normId(data.deviceId);
self._setDeviceState(mac, BLE_STATES.DISCOVERING_SERVICES, { servicesReady: true });
var device = self.connectedDevices.get(mac);
if (device) { device.servicesReady = true; self.connectedDevices.set(mac, device); }
} catch (e) {
console.warn('[BLEInterface] Error en onServicesReady callback:', e.message);
}
});
this._nativeNotificationsListener = this.nativePlugin.addListener('onNotificationsEnabled', function(data) {
try {
var mac = _normId(data.deviceId);
var peerUUID = self._macToUuidMap.get(mac);
self._setDeviceState(mac, BLE_STATES.READY_TO_CHAT, { notificationsEnabled: true, deviceUUID: peerUUID });
self._processPendingMessages(mac);
} catch (e) {
console.warn('[BLEInterface] Error en onNotificationsEnabled callback:', e.message);
}
});
this._nativeConnectionFailedListener = this.nativePlugin.addListener('onConnectionFailed', function(data) {
try {
var mac = _normId(data.deviceId);
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
var nid = _normId(deviceMAC);
if (!nid) return;
var stateObj = Object.assign({}, meta, { state: state, timestamp: Date.now() });
this._deviceStates.set(nid, stateObj);
}
_getDeviceState(deviceMAC) {
return this._deviceStates.get(_normId(deviceMAC)) || { state: BLE_STATES.DISCONNECTED };
}
/* ============================================================
RECEPCION DE MENSAJES: Anti-crash + Toast de retroalimentacion
============================================================ */
_setupNativePayloadListener() {
if (!this.nativePlugin) return;
if (!_hasNativeMethod(this.nativePlugin, 'addListener')) return;
if (this._nativePayloadListener) {
try { this._nativePayloadListener.remove(); } catch (e) {}
}
var self = this;
this._nativePayloadListener = this.nativePlugin.addListener('onPayloadReceived', function(data) {
try {
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
var contact = _getContactByUUID(senderUUID);
var cname = contact ? contact.name : null;
senderName = cname
|| (self.connectedDevices.get(mac) && self.connectedDevices.get(mac).name)
|| (self.foundDevices.get(mac) && self.foundDevices.get(mac).name)
|| 'NEXO Peer';
}
if (senderUUID && !_isBLEContact(senderUUID) && senderName && senderName !== 'NEXO Peer') {
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
/* ============================================================
ENVIO DE MENSAJES: Anti-crash + Toast de retroalimentacion
============================================================ */
async _processPendingMessages(deviceMAC) {
var nid = _normId(deviceMAC);
if (!nid) {
this.showToast('Error interno: MAC invalida en cola de mensajes', 'error');
return;
}
var queue = this._pendingMessageQueue.get(nid);
if (!queue || queue.length === 0) return;
this._pendingMessageQueue.delete(nid);
var failed = 0;
for (var i = 0; i < queue.length; i++) {
var item = queue[i];
try {
await this._sendMessageNative(nid, item.content, item.messageId);
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
async _sendMessageNative(deviceMAC, content, messageId) {
try {
if (!this.nativePlugin) {
this.showToast('Plugin BLE no disponible para enviar', 'error');
throw new Error('Plugin no disponible');
}
if (!_isValidMAC(deviceMAC)) {
this.showToast('Direccion MAC invalida para envio', 'error');
throw new Error('MAC invalida');
}
var device = this.connectedDevices.get(_normId(deviceMAC));
var targetId = (device && device.id) || (device && device.address) || deviceMAC;
var enrichedPayload = JSON.stringify({
deviceUUID: this.localDeviceUUID,
deviceName: this.localDeviceName,
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
var mac = self._uuidToMacMap.get(uuid);
if (!mac && self._activeChatDeviceId === uuid) {
mac = self._activeChatMAC;
}
if (!mac) {
self.foundDevices.forEach(function(d, m) {
if (!mac && _normId(d.deviceUUID) === uuid) mac = m;
});
self.connectedDevices.forEach(function(d, m) {
if (!mac && _normId(d.deviceUUID) === uuid) mac = m;
});
}
if (!_isValidMAC(mac)) {
self.showToast('Dispositivo no encontrado para chat. Verifica el contacto.', 'error');
reject(new Error('Dispositivo no encontrado para chat'));
return;
}
self._sendMessageNative(mac, content, messageId).then(function() {
resolve();
}).catch(function(err) {
self.showToast('No se pudo enviar: ' + (err.message || 'Error BLE'), 'error');
reject(err);
});
} catch (fatal) {
self.showToast('Error critico al enviar mensaje: ' + (fatal.message || 'desconocido'), 'error');
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
/* ============================================================
COLORES NEXO: Fondo #000, Royal Blue #4169E1, Midnight Navy #191970
============================================================ */
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
.ble-btn-scan-round { width: 56px; height: 56px; border-radius: 50%; background: linear-gradient(135deg, #4169E1, #191970); color: #000; border: none; font-size: 14px; font-weight: bold; cursor: pointer; display: flex; align-items: center; justify-content: center; flex-shrink: 0; box-shadow: 0 4px 15px rgba(65,105,225,0.3); transition: all 0.3s; }
.ble-btn-scan-round.scanning { background: linear-gradient(135deg, #ff4444, #cc0000); color: #fff; animation: pulse-red 1.5s infinite; }
.ble-btn-scan-round::before { content: 'SCAN'; font-size: 10px; }
.ble-btn-scan-round.scanning::before { content: 'STOP'; }
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
var mac = _normId(device.id || device.address);
if (!_isValidMAC(mac)) return;
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
if (!mac || !_isValidMAC(mac)) return;
var device = this.foundDevices.get(mac);
if (!device) return;
var name = device.name || 'NEXO Peer';
var existingByName = _getContactByName(name);
if (existingByName && name !== 'NEXO Peer' && name !== 'NEXO Device') {
this.showToast('Ya tienes un contacto con ese nombre', 'warning');
return;
}
var tempUUID = 'mac-' + mac.replace(/:/g, '');
this._macToUuidMap.set(mac, tempUUID);
this._uuidToMacMap.set(tempUUID, mac);
_addBLEContact({ deviceUUID: tempUUID, name: name, macAddress: mac });
this.foundDevices.delete(mac);
this.renderContactsList();
this.renderNewDeviceBar();
this.showToast('Agregado: ' + name, 'success');
}
/* ============================================================
openChat() CON PROTOCOLO ANTI-CRASH COMPLETO
============================================================ */
async openChat(deviceUUID) {
var self = this;
try {
var uuid = _normId(deviceUUID);
if (!uuid) {
self.showToast('ID de dispositivo invalido', 'warning');
return;
}
var contact = _getContactByUUID(uuid);
var mac = self._uuidToMacMap.get(uuid) || (contact && contact.macAddress);
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
self._activeChatDeviceId = uuid;
self._activeChatMAC = mac;
self.newDevicesCount = 0;
self.updateBadge();
var state = self._getDeviceState(mac);
var isFullyReady = state.state === BLE_STATES.READY_TO_CHAT || state.state === BLE_STATES.NOTIFICATIONS_READY;
var isConnecting = state.state === BLE_STATES.CONNECTING || state.state === BLE_STATES.DISCOVERING_SERVICES;
if (!isFullyReady && isConnecting && self.nativePlugin) {
self.showToast('Conexion en progreso, esperando canal...', 'info');
try {
await self._waitForReadyToChat(mac, 15000);
isFullyReady = true;
} catch (e) {
self.showToast('Canal aun no listo. Intente enviar en unos segundos.', 'warning');
}
}
if (!isFullyReady && !isConnecting && self.nativePlugin) {
try {
if (!_hasNativeMethod(self.nativePlugin, 'connectToDevice')) {
throw new Error('connectToDevice no disponible en plugin nativo');
}
console.log('[BLEInterface] Conectando GATT a', mac, '...');
var connResult = await _safeNativeCall(self.nativePlugin, 'connectToDevice', { deviceId: mac });
console.log('[BLEInterface] connectToDevice result:', connResult);
if (connResult && connResult.connected && !connResult.alreadyConnected) {
self.showToast('Conectando canal BLE...', 'info');
await self._waitForReadyToChat(mac, 15000);
}
} catch (e) {
console.warn('[BLEInterface] Conexion GATT fallo:', e.message);
self.showToast('Canal aun no listo. Intente enviar en unos segundos.', 'warning');
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
var mac = _normId(deviceMAC);
if (!_isValidMAC(mac)) return;
try {
this._cancelReconnect(mac);
var device = this.connectedDevices.get(mac);
var targetId = (device && device.id) || (device && device.address) || deviceMAC;
if (_hasNativeMethod(this.nativePlugin, 'disconnectDevice')) {
await _safeNativeCall(this.nativePlugin, 'disconnectDevice', { deviceId: targetId });
}
var uuid = this._macToUuidMap.get(mac);
if (this._activeChatDeviceId === uuid || this._activeChatMAC === mac) {
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
