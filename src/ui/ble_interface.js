// BLE Interface v3.7.6-HEALTH-FIX
// Ubicacion: src/ui/ble_interface.js
// FIXES v3.7.6: dedup en onDeviceFound, _peerNames con _normId consistente, 
//   _processCompletePayload resuelve nombre correcto, badge fix
export function initBLEInterface(bleMesh) {
var instance = new BLEInterface(bleMesh).init();
window.bleInterface = instance;
return instance;
}
var BLE_CONTACTS_STORAGE_KEY = 'nexo_ble_contacts_v1';
function _normId(id) {
if (!id) return '';
return id.toString().toLowerCase().replace(/[:-]/g, '').trim();
}
function _getBLEContacts() {
try {
var raw = localStorage.getItem(BLE_CONTACTS_STORAGE_KEY);
return raw ? JSON.parse(raw) : [];
} catch (e) { return []; }
}
function _addBLEContact(device) {
var contacts = _getBLEContacts();
var id = _normId(device.id || device.address);
if (!id) return false;
var existingByName = contacts.find(function(c) { return c.name && device.name && c.name === device.name; });
if (existingByName) {
existingByName.id = id;
existingByName.address = _normId(device.address || device.id);
existingByName.rssi = device.rssi || existingByName.rssi;
existingByName.updatedAt = Date.now();
localStorage.setItem(BLE_CONTACTS_STORAGE_KEY, JSON.stringify(contacts));
return true;
}
if (contacts.some(function(c) { return _normId(c.id || c.address) === id; })) return false;
contacts.push({ id: id, address: _normId(device.address || device.id), name: device.name || 'NEXO Device', rssi: device.rssi || null, addedAt: Date.now() });
localStorage.setItem(BLE_CONTACTS_STORAGE_KEY, JSON.stringify(contacts));
return true;
}
function _removeBLEContact(deviceId) {
var nid = _normId(deviceId);
var contacts = _getBLEContacts().filter(function(c) { return _normId(c.id || c.address) !== nid; });
localStorage.setItem(BLE_CONTACTS_STORAGE_KEY, JSON.stringify(contacts));
}
function _isBLEContact(deviceId) {
return _getBLEContacts().some(function(c) { return _normId(c.id || c.address) === _normId(deviceId); });
}
function _getContactName(deviceId) {
var nid = _normId(deviceId);
var c = _getBLEContacts().find(function(c) { return _normId(c.id || c.address) === nid; });
return c ? c.name : null;
}
function _messageFingerprint(deviceId, content, timestamp) {
var nid = _normId(deviceId);
var c = String(content || '').trim().toLowerCase().substring(0, 100);
var bucket = Math.floor((timestamp || Date.now()) / 30000);
return nid + ':' + bucket + ':' + c;
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
this._activeChatDeviceId = null;
this._deviceStates = new Map();
this._receivedMessageIds = new Set();
this._maxMessageIds = 1000;
this._pendingMessageQueue = new Map();
this._reconnectTimers = new Map();
this._reconnectAttempts = new Map();
this._serverReady = false;
this._destroyed = false;
this._openChatTimeouts = new Map();
this._toastDebounceTimer = null;
this._lastToastMessage = '';
this._lastToastTime = 0;
this._peerNames = {};
this._handshakeSent = new Set();
this._fragBuffers = {};
this.MAX_PAYLOAD = 160;
this.FRAG_TIMEOUT = 5000;
this.FRAG_THROTTLE = 50;
this._healthCheckInterval = null;
this._autoCleanupInterval = null;
this._serviceRebootInterval = null;
this._lastActivity = Date.now();
this._staleConnectionCheckInterval = null;
this._memoryCheckInterval = null;
this._sessionStartTime = Date.now();
this._totalOperations = 0;
this._nameCache = new Map();
this._nameCacheTTLReal = 3600000;
this._nameCacheTTLGeneric = 30000;
this._badgeCountedIds = new Set();
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
this._setupNativeServerReadyListener();
this._setupNativePayloadListener();
this._setupNativeStateListeners();
this._loadLocalDeviceInfo();
this._startHealthMonitor();
}
return this;
}
_startHealthMonitor() {
var self = this;
this._healthCheckInterval = setInterval(function() { self._performHealthCheck(); }, 120000);
this._autoCleanupInterval = setInterval(function() { self._performAutoCleanup(); }, 600000);
this._serviceRebootInterval = setInterval(function() { self._performServiceReboot(); }, 3600000);
this._staleConnectionCheckInterval = setInterval(function() { self._checkStaleConnections(); }, 30000);
this._memoryCheckInterval = setInterval(function() { self._checkMemoryPressure(); }, 300000);
console.log('[BLEInterface] Health Monitor iniciado');
}
_stopHealthMonitor() {
if (this._healthCheckInterval) clearInterval(this._healthCheckInterval);
if (this._autoCleanupInterval) clearInterval(this._autoCleanupInterval);
if (this._serviceRebootInterval) clearInterval(this._serviceRebootInterval);
if (this._staleConnectionCheckInterval) clearInterval(this._staleConnectionCheckInterval);
if (this._memoryCheckInterval) clearInterval(this._memoryCheckInterval);
this._healthCheckInterval = null;
this._autoCleanupInterval = null;
this._serviceRebootInterval = null;
this._staleConnectionCheckInterval = null;
this._memoryCheckInterval = null;
}
_performHealthCheck() {
try {
var now = Date.now();
var uptime = Math.floor((now - this._sessionStartTime) / 1000);
var memory = performance && performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : 'N/A';
console.log('[HEALTH] Uptime: ' + uptime + 's, Memory: ' + memory + 'MB, Ops: ' + this._totalOperations + ', Found: ' + this.foundDevices.size + ', Connected: ' + this.connectedDevices.size + ', Pending: ' + this._pendingMessageQueue.size);
if (uptime > 14400) {
console.warn('[HEALTH] Uptime > 4h, recomendando reboot de servicio');
this._performServiceReboot();
}
} catch (e) { console.error('[HEALTH] Health check error:', e); }
}
_performAutoCleanup() {
try {
console.log('[HEALTH] Auto-cleanup iniciado');
var now = Date.now();
var staleDevices = [];
this.foundDevices.forEach(function(device, id) {
if (device.lastSeen && (now - device.lastSeen) > 1800000) staleDevices.push(id);
});
staleDevices.forEach(function(id) {
this.foundDevices.delete(id);
this._renderedDeviceIds.delete(id);
this._badgeCountedIds.delete(id);
}.bind(this));
if (this._receivedMessageIds.size > this._maxMessageIds) {
var toRemove = this._receivedMessageIds.size - this._maxMessageIds;
var iter = this._receivedMessageIds.values();
for (var i = 0; i < toRemove; i++) {
var val = iter.next().value;
if (val) this._receivedMessageIds.delete(val);
}
}
this._pendingMessageQueue.forEach(function(queue, id) {
if (!queue || queue.length === 0) this._pendingMessageQueue.delete(id);
}.bind(this));
this._totalOperations = 0;
if (window.gc) { try { window.gc(); } catch (e) {} }
console.log('[HEALTH] Auto-cleanup completado. Found: ' + this.foundDevices.size + ', MsgIds: ' + this._receivedMessageIds.size);
} catch (e) { console.error('[HEALTH] Auto-cleanup error:', e); }
}
_performServiceReboot() {
try {
if (!this.isAdvertising || !this.nativePlugin) return;
var self = this;
this._safeNativeCall('stopAdvertising', {}, 5000).then(function() {
self.isAdvertising = false;
self._serverReady = false;
self.connectedDevices.clear();
self._deviceStates.clear();
self._reconnectTimers.forEach(function(t) { clearTimeout(t); });
self._reconnectTimers.clear();
self._reconnectAttempts.clear();
setTimeout(function() {
if (!self._destroyed) {
self._safeNativeCall('startAdvertising', {}, 5000).then(function() {
self.isAdvertising = true;
self._serverReady = true;
console.log('[HEALTH] Service reboot completado');
self.showToast('Servicio BLE reiniciado', 'info');
}).catch(function(e) { console.error('[HEALTH] Reboot restart failed:', e); });
}
}, 2000);
}).catch(function(e) { console.error('[HEALTH] Reboot stop failed:', e); });
} catch (e) { console.error('[HEALTH] Service reboot error:', e); }
}
_checkStaleConnections() {
try {
var now = Date.now();
var stale = [];
this.connectedDevices.forEach(function(device, id) {
var state = this._getDeviceState(id);
if (state.state === BLE_STATES.READY_TO_CHAT && state.timestamp && (now - state.timestamp) > 300000 && this._activeChatDeviceId !== id) {
stale.push(id);
}
}.bind(this));
stale.forEach(function(id) { console.log('[HEALTH] Desconectando peer stale:', id); this.disconnect(id); }.bind(this));
} catch (e) { console.error('[HEALTH] Stale check error:', e); }
}
_checkMemoryPressure() {
try {
if (!performance || !performance.memory) return;
var used = performance.memory.usedJSHeapSize;
var limit = performance.memory.jsHeapSizeLimit;
var percent = Math.round((used / limit) * 100);
if (percent > 80) {
console.warn('[HEALTH] MEMORY PRESSURE: ' + percent + '%');
this._performAutoCleanup();
this.showToast('Memoria alta, limpiando...', 'warning');
}
} catch (e) { console.error('[HEALTH] Memory check error:', e); }
}
_generateUUID() {
return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
var r = Math.random() * 16 | 0;
return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
});
}
_chunkString(str, size) {
var chunks = [];
for (var i = 0; i < str.length; i += size) {
chunks.push(str.substring(i, i + size));
}
return chunks;
}
_sleep(ms) {
return new Promise(function(resolve) { setTimeout(resolve, ms); });
}
async _sendHandshake(deviceId) {
try {
var id = _normId(deviceId);
if (this._handshakeSent.has(id)) return;
var hs = JSON.stringify({ _t: 'hs', _n: this.localDeviceName });
await this._safeNativeCall('sendMessage', { deviceId: id, message: hs }, 5000);
this._handshakeSent.add(id);
console.log('[BLE] Handshake enviado a', id);
} catch (e) {
console.warn('[BLE] Handshake fallo:', e.message);
}
}
_handleFragment(peerId, frag) {
var fragId = frag._i;
var idx = frag._n;
var total = frag._o;
var chunkData = frag._d;
if (!fragId || idx === undefined || !total || chunkData === undefined) {
console.warn('[BLE] Fragmento malformado:', frag);
return;
}
if (!this._fragBuffers[fragId]) {
var self = this;
this._fragBuffers[fragId] = {
chunks: new Array(total).fill(null),
total: total,
peerId: peerId,
received: 0,
timer: setTimeout(function() {
console.warn('[BLE] Timeout de fragmentos:', fragId);
delete self._fragBuffers[fragId];
}, this.FRAG_TIMEOUT)
};
}
var buf = this._fragBuffers[fragId];
if (buf.chunks[idx] === null) {
buf.chunks[idx] = chunkData;
buf.received++;
}
if (buf.received === buf.total) {
clearTimeout(buf.timer);
var fullPayload = buf.chunks.join('');
delete this._fragBuffers[fragId];
console.log('[BLE] Mensaje reensamblado:', fragId, fullPayload.length, 'chars');
this._processCompletePayload(peerId, fullPayload, null, null, { source: 'ble_reassembled' });
}
}
_processCompletePayload(deviceId, content, senderName, messageId, data) {
var self = this;
var nid = _normId(deviceId);
var resolvedName = senderName
|| this._peerNames[nid]
|| _getContactName(nid)
|| (this.connectedDevices.get(nid) && this.connectedDevices.get(nid).name)
|| (this.foundDevices.get(nid) && this.foundDevices.get(nid).name)
|| 'NEXO Peer';
if (messageId && this._receivedMessageIds.has(messageId)) return;
if (messageId) {
this._receivedMessageIds.add(messageId);
if (this._receivedMessageIds.size > this._maxMessageIds) {
var first = this._receivedMessageIds.values().next().value;
this._receivedMessageIds.delete(first);
}
}
var fingerprint = _messageFingerprint(deviceId, content, (data && data.timestamp) || Date.now());
window.dispatchEvent(new CustomEvent('nexo:ble:messageReceived', {
detail: {
deviceId: nid,
content: content,
senderName: resolvedName,
messageId: messageId,
source: (data && data.source) || 'unknown',
timestamp: (data && data.timestamp) || Date.now(),
conversationId: nid,
fingerprint: fingerprint
}
}));
var activeId = _normId(this._activeChatDeviceId);
if (activeId && activeId === nid) return;
this.showToast('Mensaje de ' + resolvedName, 'info');
this.newDevicesCount++;
this.updateBadge();
}
async sendMessage(deviceId, content) {
if (this.isDummyMode || this._destroyed) return;
var id = _normId(deviceId);
if (!this._handshakeSent.has(id)) {
await this._sendHandshake(id);
}
if (content.length <= this.MAX_PAYLOAD) {
await this._sendMessageNative(id, content);
return;
}
var chunkSize = this.MAX_PAYLOAD - 50;
var chunks = this._chunkString(content, chunkSize);
var fragId = this._generateUUID();
var total = chunks.length;
console.log('[BLE] Fragmentando mensaje:', total, 'partes');
for (var i = 0; i < total; i++) {
var frag = JSON.stringify({
_t: 'f',
_i: fragId,
_n: i,
_o: total,
_d: chunks[i]
});
await this._sendMessageNative(id, frag);
if (i < total - 1) {
await this._sleep(this.FRAG_THROTTLE);
}
}
}
async _loadLocalDeviceInfo() {
if (!this.nativePlugin || !this.nativePlugin.getLocalDeviceInfo) {
var ua = navigator.userAgent;
if (ua.indexOf('SM-S928') !== -1) this.localDeviceName = 'Galaxy S24 Ultra';
else if (ua.indexOf('SM-S918') !== -1) this.localDeviceName = 'Galaxy S23 Ultra';
else if (ua.indexOf('SM-S') !== -1) this.localDeviceName = 'Galaxy S Series';
return;
}
try {
var info = await this._safeNativeCall('getLocalDeviceInfo', {}, 3000);
this.localDeviceName = info.deviceName || 'NEXO Device';
this.localDeviceAddress = _normId(info.deviceAddress || '');
} catch (e) {}
}
async _safeNativeCall(methodName, args, timeoutMs) {
timeoutMs = timeoutMs || 5000;
this._totalOperations++;
if (!this.nativePlugin || !this.nativePlugin[methodName]) throw new Error('PLUGIN_METHOD_NOT_AVAILABLE: ' + methodName);
try {
var result = await Promise.race([
this.nativePlugin[methodName](args),
new Promise(function(_, reject) { setTimeout(function() { reject(new Error('NATIVE_TIMEOUT: ' + methodName)); }, timeoutMs); })
]);
return result;
} catch (e) { console.error('[BLEInterface] safeNativeCall(' + methodName + ') failed:', e.message); throw e; }
}
_setupNativeScanListeners() {
if (!this.nativePlugin) return;
this._removeListener(this._nativeDeviceFoundListener);
this._removeListener(this._nativeScanFailedListener);
var self = this;
this._nativeDeviceFoundListener = this.nativePlugin.addListener('onDeviceFound', function(data) {
self.onDeviceFound({ id: data.deviceId, address: data.deviceId, name: data.name || 'NEXO Device', rssi: data.rssi });
});
this._nativeScanFailedListener = this.nativePlugin.addListener('onScanFailed', function(data) {
self.isScanning = false;
self.onScanStateChanged(false);
self.showToast('Error al escanear', 'error');
});
}
_setupNativeServerReadyListener() {
if (!this.nativePlugin) return;
this._removeListener(this._nativeServerReadyListener);
var self = this;
this._nativeServerReadyListener = this.nativePlugin.addListener('onServerReady', function(data) {
self._serverReady = true;
console.log('[BLEInterface] onServerReady recibido:', data);
self.showToast('Servidor BLE listo', 'success');
});
}
_setupNativeConnectionListeners() {
if (!this.nativePlugin) return;
this._removeListener(this._nativeDeviceConnectedListener);
this._removeListener(this._nativeDeviceDisconnectedListener);
var self = this;
this._nativeDeviceConnectedListener = this.nativePlugin.addListener('onDeviceConnected', function(data) {
var deviceId = _normId(data.deviceId);
var attempt = data.attempt || 0;
self._cancelReconnect(deviceId);
var contactName = _getContactName(deviceId);
var displayName = data.name || contactName || 'NEXO Peer';
if (data.direction === 'incoming') {
self._setDeviceState(deviceId, BLE_STATES.READY_TO_CHAT, { direction: 'incoming', role: 'peer_connected' });
self.connectedDevices.set(deviceId, { id: deviceId, address: deviceId, name: displayName, direction: 'incoming', servicesReady: true });
self.showToast('Peer conectado: ' + self._formatId(deviceId), 'success');
self._sendHandshake(deviceId);
} else {
self._setDeviceState(deviceId, BLE_STATES.CONNECTING, { direction: 'outgoing', attempt: attempt, role: 'client' });
self.connectedDevices.set(deviceId, { id: deviceId, address: deviceId, name: displayName, direction: 'outgoing', servicesReady: false });
}
self.onDeviceConnected({ id: deviceId, address: deviceId, name: displayName, direction: data.direction || 'unknown', servicesReady: data.servicesReady === true, attempt: attempt });
});
this._nativeDeviceDisconnectedListener = this.nativePlugin.addListener('onDeviceDisconnected', function(data) {
var deviceId = _normId(data.deviceId);
self._setDeviceState(deviceId, BLE_STATES.DISCONNECTED);
self.connectedDevices.delete(deviceId);
self.onDeviceDisconnected({ id: deviceId, address: deviceId });
if (self._activeChatDeviceId === deviceId) {
self._activeChatDeviceId = null;
self.showToast('Conexion BLE perdida. Reconectando...', 'warning');
self._startReconnect(deviceId);
}
});
}
_startReconnect(deviceId) {
this._cancelReconnect(deviceId);
var currentAttempts = this._reconnectAttempts.get(deviceId) || 0;
if (currentAttempts >= 5) {
console.log('[BLEInterface] Max reintentos alcanzado para', deviceId);
this.showToast('No se pudo reconectar despues de 5 intentos', 'error');
this._reconnectAttempts.delete(deviceId);
return;
}
this._reconnectAttempts.set(deviceId, currentAttempts + 1);
this._setDeviceState(deviceId, BLE_STATES.RECONNECTING, { message: 'Reconectando... (intento ' + (currentAttempts + 1) + '/5)' });
var self = this;
var attemptReconnect = async function() {
if (self._activeChatDeviceId !== deviceId) return;
try {
console.log('[BLEInterface] Force reconnect a', deviceId, 'intento', (self._reconnectAttempts.get(deviceId) || 0));
await self._safeNativeCall('forceReconnect', { deviceId: deviceId }, 8000);
} catch (e) {
console.warn('[BLEInterface] Force reconnect fallo:', e.message);
var timer = setTimeout(attemptReconnect, 3000);
self._reconnectTimers.set(deviceId, timer);
}
};
attemptReconnect();
}
_cancelReconnect(deviceId) {
var timer = this._reconnectTimers.get(deviceId);
if (timer) { clearTimeout(timer); this._reconnectTimers.delete(deviceId); }
this._reconnectAttempts.delete(deviceId);
}
_setupNativeStateListeners() {
if (!this.nativePlugin) return;
var self = this;
this._removeListener(this._nativeServicesReadyListener);
this._removeListener(this._nativeNotificationsListener);
this._removeListener(this._nativeConnectionFailedListener);
this._nativeServicesReadyListener = this.nativePlugin.addListener('onServicesReady', function(data) {
var deviceId = _normId(data.deviceId);
self._setDeviceState(deviceId, BLE_STATES.DISCOVERING_SERVICES, { servicesReady: true });
var device = self.connectedDevices.get(deviceId);
if (device) { device.servicesReady = true; self.connectedDevices.set(deviceId, device); }
});
this._nativeNotificationsListener = this.nativePlugin.addListener('onNotificationsEnabled', function(data) {
var deviceId = _normId(data.deviceId);
self._setDeviceState(deviceId, BLE_STATES.READY_TO_CHAT, { notificationsEnabled: true, direction: (self._getDeviceState(deviceId).direction || 'unknown') });
self._processPendingMessages(deviceId);
self._sendHandshake(deviceId);
});
this._nativeConnectionFailedListener = this.nativePlugin.addListener('onConnectionFailed', function(data) {
var deviceId = _normId(data.deviceId);
if (data.recoverable !== false && data.attempt < (data.maxAttempts || 3)) {
self._setDeviceState(deviceId, BLE_STATES.CONNECTING, { attempt: data.attempt, message: 'Reintentando...' });
} else {
self._setDeviceState(deviceId, BLE_STATES.ERROR, { lastError: data.reason });
self.showToast('Conexion fallada: ' + data.reason, 'error');
}
});
}
_setDeviceState(deviceId, state, meta) {
meta = meta || {};
var nid = _normId(deviceId);
this._deviceStates.set(nid, Object.assign({}, meta, { state: state, timestamp: Date.now() }));
this.renderConnectedList();
}
_getDeviceState(deviceId) {
return this._deviceStates.get(_normId(deviceId)) || { state: BLE_STATES.DISCONNECTED };
}
_setupNativePayloadListener() {
if (!this.nativePlugin) return;
this._removeListener(this._nativePayloadListener);
var self = this;
this._nativePayloadListener = this.nativePlugin.addListener('onPayloadReceived', function(data) {
var deviceId = _normId(data.deviceId);
var raw = data.content || data.data || '';
if (!raw || typeof raw !== 'string') return;
var parsed = null;
var isControl = false;
try {
var trimmed = raw.trim();
if (trimmed.charAt(0) === '{' && trimmed.charAt(trimmed.length - 1) === '}') {
parsed = JSON.parse(trimmed);
isControl = (parsed._t === 'hs' || parsed._t === 'f');
}
} catch (e) {
isControl = false;
}
if (isControl && parsed._t === 'hs') {
var hsName = parsed._n || 'NEXO Device';
self._peerNames[deviceId] = hsName;
var connDev = self.connectedDevices.get(deviceId);
if (connDev) { connDev.name = hsName; self.connectedDevices.set(deviceId, connDev); }
var foundDev = self.foundDevices.get(deviceId);
if (foundDev) { foundDev.name = hsName; self.foundDevices.set(deviceId, foundDev); }
_addBLEContact({ id: deviceId, address: deviceId, name: hsName });
self.renderConnectedList();
self.renderDevicesList();
self.renderAddedList();
console.log('[BLE] Handshake recibido de', deviceId, ':', hsName);
return;
}
if (isControl && parsed._t === 'f') {
self._handleFragment(deviceId, parsed);
return;
}
var messageId = null;
var senderName = data.senderName || null;
var content = raw;
try {
var json = JSON.parse(raw);
if (json.messageId) messageId = json.messageId;
if (json.senderName && !senderName) senderName = json.senderName;
if (json.content) content = json.content;
} catch (e) {}
self._processCompletePayload(deviceId, content, senderName, messageId, data);
});
}
async _processPendingMessages(deviceId) {
var nid = _normId(deviceId);
var queue = this._pendingMessageQueue.get(nid);
if (!queue || queue.length === 0) return;
this._pendingMessageQueue.delete(nid);
for (var i = 0; i < queue.length; i++) {
var item = queue[i];
try { await this._sendMessageNative(nid, item.content); item.resolve(); }
catch (e) { item.reject(e); }
}
}
async _sendMessageNative(deviceId, content) {
if (!this.nativePlugin) throw new Error('Plugin no disponible');
var device = this.connectedDevices.get(_normId(deviceId));
var targetId = (device && device.id) || (device && device.address) || deviceId;
await this._safeNativeCall('sendMessage', { deviceId: targetId, message: content }, 8000);
}
async _initVisibility() {
if (this.isDummyMode) return;
try {
var btState = await this._safeNativeCall('isBluetoothEnabled', {}, 3000);
this.canAdvertise = btState.canAdvertise || false;
this._serverReady = btState.serverReady || false;
var adState = await this._safeNativeCall('isAdvertising', {}, 3000);
this.isAdvertising = adState.isAdvertising === true;
this.updateVisibilityButton();
this._setupNativeAdvertisingListeners();
} catch (err) { console.error('[BLEInterface] Error consultando estado:', err); }
}
_setupNativeAdvertisingListeners() {
if (!this.nativePlugin) return;
this._removeListener(this._nativeAdStartedListener);
this._removeListener(this._nativeAdFailedListener);
var self = this;
this._nativeAdStartedListener = this.nativePlugin.addListener('onAdvertiseStarted', function() {
self.isAdvertising = true;
self._serverReady = true;
self.updateVisibilityButton();
self.showToast('Visibilidad activada', 'success');
});
this._nativeAdFailedListener = this.nativePlugin.addListener('onAdvertiseFailed', function(data) {
self.isAdvertising = false;
self.updateVisibilityButton();
self.showToast('Error al activar visibilidad: ' + (data.error || ''), 'error');
});
}
updateVisibilityButton() {
var btn = this.elements.visibilityBtn;
if (!btn) return;
var icon = btn.querySelector('.btn-icon');
var text = btn.querySelector('span:last-child');
if (!this.canAdvertise) {
btn.className = 'ble-btn-visibility btn-visibility-warning';
if (icon) icon.textContent = '⚠️';
if (text) text.textContent = 'Visibilidad desactivada';
} else if (!this.isAdvertising) {
btn.className = 'ble-btn-visibility btn-visibility-off';
if (icon) icon.textContent = '👁️';
if (text) text.textContent = 'Visibilidad';
} else {
btn.className = 'ble-btn-visibility btn-visibility-on';
if (icon) icon.textContent = '👁️‍🗨️';
if (text) text.textContent = 'Visible';
}
}
async toggleVisibility() {
if (this.isDummyMode || this._destroyed) return;
var permsReady = false;
try {
if (window.ensureBLEPermissions) permsReady = await window.ensureBLEPermissions();
else if (window.permissionShim && window.permissionShim.ensureBLEPermissions) permsReady = await window.permissionShim.ensureBLEPermissions();
else permsReady = true;
} catch (e) { console.warn('[BLEInterface] Shim no disponible para permisos, continuando...', permsReady = true); }
if (!permsReady) { this.showToast('Permisos BLE requeridos. Concede los permisos en Ajustes.', 'warning', 5000); return; }
if (!this._serverReady) {
try {
this.showToast('Inicializando servidor BLE...', 'info');
await this._safeNativeCall('initializeBLE', {}, 8000);
await new Promise(function(resolve, reject) {
var timeout = setTimeout(function() { reject(new Error('Timeout esperando servidor BLE')); }, 8000);
var check = function() {
if (this._serverReady) { clearTimeout(timeout); resolve(); }
else { setTimeout(check, 200); }
}.bind(this);
var serverReadyListener = null;
if (this.nativePlugin) {
serverReadyListener = this.nativePlugin.addListener('onServerReady', function() {
if (serverReadyListener) serverReadyListener.remove();
clearTimeout(timeout);
this._serverReady = true;
resolve();
}.bind(this));
}
check();
}.bind(this));
} catch (e) {
console.error('[BLEInterface] Error inicializando servidor:', e.message);
this.showToast('No se pudo inicializar servidor BLE: ' + e.message, 'error', 5000);
return;
}
}
try {
var btState = await this._safeNativeCall('isBluetoothEnabled', {}, 3000);
this.canAdvertise = btState.canAdvertise || false;
} catch (e) {}
if (!this.canAdvertise) { this.showToast('Sin permiso de advertising', 'warning'); return; }
try {
if (this.isAdvertising) { await this._safeNativeCall('stopAdvertising', {}, 5000); this.isAdvertising = false; }
else { await this._safeNativeCall('startAdvertising', {}, 5000); }
this.updateVisibilityButton();
} catch (err) { this.showToast('Error: ' + err.message, 'error'); }
}
createDOM() {
var tab = document.createElement('div');
tab.id = 'ble-tab';
tab.innerHTML = '<div class="ble-tab-icon">🔷</div><div class="ble-tab-label">BLE</div><div class="ble-tab-badge" id="ble-tab-badge" style="display:none">0</div>';
document.body.appendChild(tab);
this.elements.tab = tab;
var panel = document.createElement('div');
panel.id = 'ble-panel';
panel.innerHTML = '<div class="ble-header"><h3>BLE Mesh</h3><button id="ble-close">✕</button></div><div class="ble-tabs"><button class="ble-tab-btn active" data-tab="devices">Dispositivos</button><button class="ble-tab-btn" data-tab="added">Contactos</button><button class="ble-tab-btn" data-tab="connected">Conectados</button></div><div class="ble-main-controls"><button id="ble-visibility-btn" class="ble-btn-visibility btn-visibility-off"><span class="btn-icon">👁️</span><span>Visibilidad</span></button><button id="ble-scan-btn" class="ble-btn-discover"><span id="text-discover">Descubrir</span></button></div><div class="ble-secondary-controls"><span id="ble-status" class="ble-status-offline">OFFLINE</span></div><div id="tab-devices" class="ble-tab-content active"><div id="ble-devices-list" class="ble-list"><div class="ble-empty">Presiona Descubrir para find dispositivos cercanos</div></div></div><div id="tab-added" class="ble-tab-content"><div id="ble-added-list" class="ble-list"><div class="ble-empty">No hay contactos agregados</div></div></div><div id="tab-connected" class="ble-tab-content"><div id="ble-connected-list" class="ble-list"><div class="ble-empty">No hay dispositivos conectados</div></div></div>';
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
style.textContent = `#ble-tab { position: fixed; left: 0; top: 50%; transform: translateY(-50%); width: 44px; height: 100px; background: linear-gradient(180deg, #00d4ff, #0099cc); border-radius: 0 12px 12px 0; display: flex; flex-direction: column; align-items: center; justify-content: center; cursor: pointer; z-index: 2147483644; color: #000; font-weight: bold; } .ble-tab-badge { position: absolute; top: 5px; right: -5px; background: #ff4444; color: white; width: 18px; height: 18px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 10px; animation: pulse 2s infinite; } @keyframes pulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.1); } } #ble-panel { position: fixed; top: 0; left: 0; width: 85vw; max-width: 400px; height: 100vh; background: rgba(10,10,15,0.98); transform: translateX(-100%); transition: transform 0.3s ease; z-index: 2147483645; color: #fff; padding: 20px; overflow-y: auto; } #ble-panel.active { transform: translateX(0); } #ble-overlay { position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.6); display: none; z-index: 2147483644; backdrop-filter: blur(4px); } #ble-overlay.active { display: block; } .ble-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px; border-bottom: 1px solid #333; padding-bottom: 10px; } .ble-tabs { display: flex; gap: 8px; margin-bottom: 15px; } .ble-tab-btn { flex: 1; padding: 10px 4px; background: #222; border: 1px solid #333; border-radius: 6px; color: #888; cursor: pointer; font-size: 11px; } .ble-tab-btn.active { background: linear-gradient(135deg, #00d4ff, #0099cc); color: #000; font-weight: bold; border-color: #00d4ff; } .ble-tab-content { display: none; } .ble-tab-content.active { display: block; } .ble-main-controls { display: flex; gap: 12px; justify-content: center; align-items: center; margin-bottom: 10px; } .ble-secondary-controls { margin-bottom: 15px; display: flex; justify-content: space-between; align-items: center; } .ble-btn-visibility { flex: 1; max-width: 140px; height: 48px; border-radius: 12px; border: none; font-weight: 600; font-size: 13px; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 6px; transition: all 0.3s ease; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; } .ble-btn-visibility.btn-visibility-warning { background: #4A3A00 !important; color: #FFCC00 !important; border: 1px solid #FFCC00 !important; } .ble-btn-visibility.btn-visibility-off { background: #3A3A3A; color: #888888; } .ble-btn-visibility.btn-visibility-on { background: #00D9FF; color: #000000; box-shadow: 0 0 12px rgba(0, 217, 255, 0.4); } .ble-btn-discover { flex: 1.2; height: 56px; border-radius: 14px; border: none; font-weight: 700; font-size: 15px; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 8px; background: linear-gradient(135deg, #00d4ff, #0099cc); color: #000; box-shadow: 0 4px 15px rgba(0, 212, 255, 0.3); transition: all 0.3s ease; } .ble-btn-discover.scanning { background: linear-gradient(135deg, #ff4444, #cc0000); color: #fff; animation: pulse-red 1.5s infinite; } @keyframes pulse-red { 0%, 100% { box-shadow: 0 0 0 0 rgba(255, 68, 68, 0.4); } 50% { box-shadow: 0 0 0 10px rgba(255, 68, 68, 0); } } #ble-status { font-size: 12px; padding: 4px 8px; border-radius: 4px; } .ble-status-offline { background: #333; color: #888; } .ble-status-online { background: #00d4ff; color: #000; } .ble-status-scanning { background: #ffaa00; color: #000; animation: blink 1s infinite; } @keyframes blink { 0%, 50% { opacity: 1; } 51%, 100% { opacity: 0.7; } } .ble-list { display: flex; flex-direction: column; gap: 8px; max-height: calc(100vh - 300px); overflow-y: auto; } .ble-empty { text-align: center; color: #666; padding: 20px; font-style: italic; } .ble-device-item { display: flex; align-items: center; justify-content: space-between; padding: 12px; background: rgba(255,255,255,0.05); border: 1px solid #333; border-radius: 8px; cursor: pointer; transition: all 0.2s; } .ble-device-item:hover { background: rgba(0,212,255,0.1); border-color: #00d4ff; } .ble-device-item.new { border-left: 3px solid #00d4ff; animation: slideIn 0.3s ease; } @keyframes slideIn { from { opacity: 0; transform: translateX(-10px); } to { opacity: 1; transform: translateX(0); } } .ble-device-info { display: flex; flex-direction: column; flex: 1; min-width: 0; } .ble-device-name { font-weight: bold; color: #fff; } .ble-device-id { font-size: 11px; color: #888; } .ble-device-rssi { font-size: 12px; color: #00d4ff; } .ble-device-actions { display: flex; gap: 8px; align-items: center; flex-shrink: 0; } .ble-btn-add { padding: 8px 16px; background: #00ff88; color: #000; border: none; border-radius: 6px; cursor: pointer; font-size: 12px; font-weight: bold; } .ble-btn-write { padding: 8px 16px; background: #00d4ff; color: #000; border: none; border-radius: 6px; cursor: pointer; font-size: 12px; font-weight: bold; } .ble-btn-write:disabled { background: #555; color: #aaa; cursor: not-allowed; } .ble-btn-disconnect { padding: 6px 12px; background: #ff4444; color: #fff; border: none; border-radius: 4px; cursor: pointer; font-size: 12px; } .ble-toast { position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%); padding: 12px 24px; border-radius: 8px; color: #fff; font-weight: bold; z-index: 2147483646; animation: fadeInUp 0.3s ease; } .ble-toast.success { background: #00d4ff; color: #000; } .ble-toast.error { background: #ff4444; } .ble-toast.warning { background: #ffaa00; color: #000; } .ble-toast.info { background: #444; } @keyframes fadeInUp { from { opacity: 0; transform: translateX(-50%) translateY(20px); } to { opacity: 1; transform: translateX(-50%) translateY(0); } } .ble-state-connecting { color: #ffaa00; font-size: 11px; } .ble-state-ready { color: #00ff88; font-size: 11px; } .ble-state-error { color: #ff4444; font-size: 11px; } .ble-state-reconnecting { color: #ffaa00; font-size: 11px; animation: blink 1s infinite; }`;
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
self.updateBadge();
});
}
togglePanel() {
this.elements.panel.classList.toggle('active');
this.elements.overlay.classList.toggle('active');
if (this.elements.panel.classList.contains('active')) {
this.newDevicesCount = 0;
this._badgeCountedIds.clear();
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
if (this.isDummyMode || this._destroyed) return;
var permsReady = false;
try {
if (window.ensureBLEPermissions) permsReady = await window.ensureBLEPermissions();
else if (window.permissionShim && window.permissionShim.ensureBLEPermissions) permsReady = await window.permissionShim.ensureBLEPermissions();
else permsReady = true;
} catch (e) { console.warn('[BLEInterface] Shim no disponible para scan, continuing...'); permsReady = true; }
if (!permsReady) { this.showToast('Permisos BLE requeridos. Concede los permisos en Ajustes.', 'warning', 5000); return; }
try {
if (this.isScanning) {
if (this.nativePlugin) await this._safeNativeCall('stopScan', {}, 5000);
this.isScanning = false;
this.onScanStateChanged(false);
} else {
this.foundDevices.clear();
this._renderedDeviceIds.clear();
this._badgeCountedIds.clear();
this.renderDevicesList();
if (this.nativePlugin) await this._safeNativeCall('startScan', {}, 5000);
this.isScanning = true;
this.onScanStateChanged(true);
setTimeout(function() { if (this.isScanning) { this.isScanning = false; this.onScanStateChanged(false); } }.bind(this), 15000);
}
} catch (err) { this.isScanning = false; this.onScanStateChanged(false); }
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
var id = _normId(device.id || device.address);
if (!id || id === 'null' || id === 'undefined') return;
if (this.localDeviceAddress && id === this.localDeviceAddress) return;
if (this.foundDevices.has(id)) {
var existing = this.foundDevices.get(id);
existing.rssi = device.rssi;
existing.name = device.name || existing.name;
existing.lastSeen = Date.now();
this.foundDevices.set(id, existing);
this.renderDevicesList();
return;
}
device.lastSeen = Date.now();
this.foundDevices.set(id, device);
if (!this._badgeCountedIds.has(id)) {
this._badgeCountedIds.add(id);
this.newDevicesCount++;
this.updateBadge();
}
this.renderDevicesList();
}
onDeviceConnected(device) {
var nid = _normId(device.id || device.address);
this.connectedDevices.set(nid, device);
this.renderConnectedList();
this.showToast('Conectado: ' + (device.name || 'Dispositivo'), 'success');
}
onDeviceDisconnected(device) {
var nid = _normId(device.id || device.address);
this.connectedDevices.delete(nid);
this.renderConnectedList();
this.showToast('Desconectado', 'info');
}
async _loadConnectedDevices() {
if (this.isDummyMode) return;
try {
var devices = [];
if (this.nativePlugin && this.nativePlugin.getConnectedDevices) {
var result = await this._safeNativeCall('getConnectedDevices', {}, 3000);
devices = result.devices || [];
}
this.connectedDevices.clear();
devices.forEach(function(d) {
var nid = _normId(d.id || d.address || d.deviceId);
this.connectedDevices.set(nid, Object.assign({}, d, { id: nid, address: nid }));
}.bind(this));
this.renderConnectedList();
} catch (err) {}
}
async addContact(deviceId) {
var nid = _normId(deviceId);
var device = this.foundDevices.get(nid) || this.connectedDevices.get(nid);
if (!device) { this.showToast('Dispositivo no encontrado', 'error'); return; }
if (_addBLEContact(device)) { this.showToast('Agregado a contactos', 'success'); this.renderDevicesList(); }
else { this.showToast('Ya esta en contactos', 'warning'); }
}
async removeContact(deviceId) {
_removeBLEContact(deviceId);
this.showToast('Eliminado', 'info');
this.renderAddedList();
this.renderDevicesList();
}
async openChat(deviceId) {
var nid = _normId(deviceId);
var device = this.foundDevices.get(nid) || this.connectedDevices.get(nid);
var contact = _getBLEContacts().find(function(c) { return _normId(c.id || c.address) === nid; });
if (!device && contact) device = { id: contact.id || contact.address, address: contact.address, name: contact.name || 'NEXO Device', rssi: contact.rssi };
if (!device) { this.showToast('Contacto no disponible', 'error'); return; }
this._activeChatDeviceId = nid;
this.newDevicesCount = 0;
this._badgeCountedIds.clear();
this.updateBadge();
var displayName = (contact && contact.name) || device.name || 'NEXO Peer';
var state = this._getDeviceState(nid);
var isFullyReady = state.state === BLE_STATES.READY_TO_CHAT || state.state === BLE_STATES.NOTIFICATIONS_READY;
var isConnecting = state.state === BLE_STATES.CONNECTING || state.state === BLE_STATES.DISCOVERING_SERVICES;
if (!isFullyReady && isConnecting && this.nativePlugin) {
this.showToast('Conexion en progreso, esperando canal...', 'info');
try {
await new Promise(function(resolve, reject) {
var timeout = setTimeout(function() { reject(new Error('Timeout')); }, 15000);
this._openChatTimeouts.set(nid, timeout);
var checkReady = function() {
var s = this._getDeviceState(nid);
if (s.state === BLE_STATES.NOTIFICATIONS_READY || s.state === BLE_STATES.READY_TO_CHAT) {
clearTimeout(timeout); this._openChatTimeouts.delete(nid); resolve();
} else { setTimeout(checkReady, 300); }
}.bind(this);
checkReady();
}.bind(this));
} catch (e) { this.showToast('Canal aun no listo. Intente enviar en unos segundos.', 'warning'); }
}
if (!isFullyReady && !isConnecting && this.nativePlugin) {
var permsReady = false;
try { if (window.ensureBLEPermissions) permsReady = await window.ensureBLEPermissions(); else permsReady = true; } catch (e) { permsReady = true; }
if (!permsReady) { this.showToast('Permisos BLE requeridos para conectar', 'warning', 5000); return; }
try {
console.log('[BLEInterface] Conectando a', nid, '...');
var connResult = await this._safeNativeCall('connectToDevice', { deviceId: device.id || device.address || nid }, 10000);
console.log('[BLEInterface] connectToDevice result:', connResult);
if (connResult && connResult.connected && !connResult.alreadyConnected) {
this.showToast('Conectando canal BLE...', 'info');
await new Promise(function(resolve, reject) {
var timeout = setTimeout(function() { reject(new Error('Timeout')); }, 15000);
this._openChatTimeouts.set(nid, timeout);
var checkReady = function() {
var s = this._getDeviceState(nid);
if (s.state === BLE_STATES.NOTIFICATIONS_READY || s.state === BLE_STATES.READY_TO_CHAT) {
clearTimeout(timeout); this._openChatTimeouts.delete(nid); resolve();
} else { setTimeout(checkReady, 300); }
}.bind(this);
checkReady();
}.bind(this));
}
} catch (e) { console.warn('[BLEInterface] Conexion/timeout:', e.message); this.showToast('Canal aun no listo. Intente enviar en unos segundos.', 'warning'); }
}
var appContainer = document.getElementById('app');
if (appContainer) appContainer.classList.remove('hidden');
var nameInput = document.getElementById('chat-contact-name');
var subtitle = document.getElementById('chat-contact-subtitle');
if (nameInput) nameInput.value = displayName;
if (subtitle) subtitle.textContent = 'BLUETOOTH';
window.dispatchEvent(new CustomEvent('nexo:ble:openChat', {
detail: {
contactId: device.id || device.address,
name: displayName,
address: device.address || device.id,
transport: 'ble',
rssi: device.rssi,
source: 'ble_interface'
}
}));
this.elements.panel.classList.remove('active');
this.elements.overlay.classList.remove('active');
}
renderDevicesList() {
var list = this.elements.devicesList;
if (this.foundDevices.size === 0) { list.innerHTML = '<div class="ble-empty">Presiona Descubrir para encontrar dispositivos cercanos</div>'; return; }
list.innerHTML = '';
var self = this;
this.foundDevices.forEach(function(device, id) {
var isAdded = _isBLEContact(id);
var isNew = !self._renderedDeviceIds.has(id);
if (isNew) self._renderedDeviceIds.add(id);
var item = document.createElement('div');
item.className = 'ble-device-item' + (isNew ? ' new' : '');
var actionHtml = isAdded
? '<button class="ble-btn-write" onclick="window.bleInterface.openChat('' + id + '')">Chat</button>'
: '<button class="ble-btn-add" onclick="window.bleInterface.addContact('' + id + '')">+</button><button class="ble-btn-write" onclick="window.bleInterface.openChat('' + id + '')">Chat</button>';
item.innerHTML = '<div class="ble-device-info"><div class="ble-device-name">' + (device.name || 'NEXO Device') + '</div><div class="ble-device-id">' + self._formatId(id) + '</div><div class="ble-device-rssi">📶 ' + (device.rssi || '?') + ' dBm</div></div><div class="ble-device-actions">' + actionHtml + '</div>';
list.appendChild(item);
});
}
renderAddedList() {
var list = this.elements.addedList;
var contacts = _getBLEContacts();
if (contacts.length === 0) { list.innerHTML = '<div class="ble-empty">No hay contactos agregados</div>'; return; }
list.innerHTML = '';
var self = this;
contacts.forEach(function(contact) {
var id = _normId(contact.id || contact.address);
var item = document.createElement('div');
item.className = 'ble-device-item';
item.innerHTML = '<div class="ble-device-info"><div class="ble-device-name">' + (contact.name || 'NEXO Device') + '</div><div class="ble-device-id">' + self._formatId(id) + '</div></div><div class="ble-device-actions"><button class="ble-btn-write" onclick="window.bleInterface.openChat('' + id + '')">Chat</button><button class="ble-btn-disconnect" onclick="window.bleInterface.removeContact('' + id + '')">✕</button></div>';
list.appendChild(item);
});
}
renderConnectedList() {
var list = this.elements.connectedList;
if (this.connectedDevices.size === 0) { list.innerHTML = '<div class="ble-empty">No hay dispositivos conectados</div>'; return; }
list.innerHTML = '';
var self = this;
this.connectedDevices.forEach(function(device, id) {
var state = self._getDeviceState(id);
var stateLabel = self._renderStateLabel(state);
var isReady = state.state === BLE_STATES.NOTIFICATIONS_READY || state.state === BLE_STATES.READY_TO_CHAT;
var item = document.createElement('div');
item.className = 'ble-device-item';
item.innerHTML = '<div class="ble-device-info"><div class="ble-device-name">' + (device.name || 'NEXO Peer') + '</div><div class="ble-device-id">' + self._formatId(id) + '</div><div class="ble-device-rssi">● ' + (device.direction || 'Conectado') + ' ' + stateLabel + '</div></div><div class="ble-device-actions"><button class="ble-btn-write" ' + (isReady ? '' : 'disabled') + ' onclick="window.bleInterface.openChat('' + id + '')">Chat</button><button class="ble-btn-disconnect" onclick="window.bleInterface.disconnect('' + id + '')">Desconectar</button></div>';
list.appendChild(item);
});
}
_renderStateLabel(state) {
if (!state || !state.state) return '';
switch (state.state) {
case BLE_STATES.CONNECTING: return '⏳ ' + (state.message || 'Conectando...');
case BLE_STATES.DISCOVERING_SERVICES: return '🔍 Descubriendo...';
case BLE_STATES.NOTIFICATIONS_READY: return '✅ Canal listo';
case BLE_STATES.READY_TO_CHAT: return '✅ Listo';
case BLE_STATES.ERROR: return '❌ ' + (state.lastError || 'Error');
case BLE_STATES.RECONNECTING: return '🔄 ' + (state.message || 'Reconectando...');
default: return '';
}
}
async connect(deviceId) {
if (this.isDummyMode) return;
try { if (this.nativePlugin) await this._safeNativeCall('connectToDevice', { deviceId: deviceId }, 10000); }
catch (err) { this.showToast('Error al conectar', 'error'); }
}
async disconnect(deviceId) {
if (this.isDummyMode) return;
var nid = _normId(deviceId);
try {
this._cancelReconnect(nid);
if (this._activeChatDeviceId === nid) { this._activeChatDeviceId = null; this.updateBadge(); }
var chatTimeout = this._openChatTimeouts.get(nid);
if (chatTimeout) { clearTimeout(chatTimeout); this._openChatTimeouts.delete(nid); }
var device = this.connectedDevices.get(nid);
var targetId = (device && device.id) || (device && device.address) || deviceId;
if (this.nativePlugin) await this._safeNativeCall('disconnectDevice', { deviceId: targetId }, 5000);
} catch (err) {}
}
updateBadge() {
var badge = this.elements.badge;
if (this._activeChatDeviceId) { badge.style.display = 'none'; return; }
if (this.newDevicesCount > 0) { badge.textContent = this.newDevicesCount; badge.style.display = 'flex'; }
else { badge.style.display = 'none'; }
}
async updateStatus(customStatus) {
if (customStatus) { this.elements.status.textContent = customStatus; this.elements.status.className = 'ble-status-offline'; return; }
if (this.isDummyMode) return;
try {
var state = 'UNKNOWN';
if (this.nativePlugin && this.nativePlugin.isBluetoothEnabled) {
var btState = await this._safeNativeCall('isBluetoothEnabled', {}, 3000);
state = btState.enabled ? 'poweredOn' : 'poweredOff';
this._serverReady = btState.serverReady || false;
}
var stateMap = { 'poweredon': 'ENCENDIDO', 'poweredoff': 'APAGADO', 'unknown': 'DESCONOCIDO' };
var normalizedState = (state || '').toString().toLowerCase();
this.elements.status.textContent = stateMap[normalizedState] || state.toUpperCase();
this.elements.status.className = state === 'poweredOn' ? 'ble-status-online' : 'ble-status-offline';
} catch (err) { this.elements.status.textContent = 'ERROR'; }
}
showToast(message, type, duration) {
type = type || 'info';
duration = duration || 3000;
var now = Date.now();
if (message === this._lastToastMessage && (now - this._lastToastTime) < 500) return;
this._lastToastMessage = message;
this._lastToastTime = now;
var existing = document.querySelector('.ble-toast');
if (existing) existing.remove();
var toast = document.createElement('div');
toast.className = 'ble-toast ' + type;
toast.textContent = message;
document.body.appendChild(toast);
setTimeout(function() { toast.style.opacity = '0'; setTimeout(function() { toast.remove(); }, 300); }, duration);
}
_formatId(id) {
if (!id) return '??';
return id.substring(0, 8) + '...' + id.substring(id.length - 4);
}
_removeListener(listenerRef) {
if (listenerRef && typeof listenerRef.remove === 'function') { try { listenerRef.remove(); } catch (e) {} }
}
destroy() {
this._destroyed = true;
this._stopHealthMonitor();
this._nameCache.clear();
var styles = document.getElementById('ble-styles');
if (styles) styles.remove();
this._reconnectTimers.forEach(function(timer) { clearTimeout(timer); });
this._reconnectTimers.clear();
this._reconnectAttempts.clear();
this._openChatTimeouts.forEach(function(t) { clearTimeout(t); });
this._openChatTimeouts.clear();
this._pendingMessageQueue.forEach(function(queue) { queue.forEach(function(item) { try { item.reject(new Error('Interface destroyed')); } catch (e) {} }); });
this._pendingMessageQueue.clear();
this._removeListener(this._nativeAdStartedListener);
this._removeListener(this._nativeAdFailedListener);
this._removeListener(this._nativeDeviceFoundListener);
this._removeListener(this._nativeScanFailedListener);
this._removeListener(this._nativeDeviceConnectedListener);
this._removeListener(this._nativeDeviceDisconnectedListener);
this._removeListener(this._nativePayloadListener);
this._removeListener(this._nativeServicesReadyListener);
this._removeListener(this._nativeNotificationsListener);
this._removeListener(this._nativeConnectionFailedListener);
this._removeListener(this._nativeServerReadyListener);
if (this.isScanning) this.toggleScan();
}
}
window.bleInterface = null;
