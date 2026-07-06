/**
 * BLE Interface v5.1.7-NO-MAC-CLEAN
 * FIX: Identidad = NEXO ID únicamente. deviceId opaco para conexión nativa.
 * deviceId es string opaco del plugin nativo (puede ser MAC, UUID BT, etc).
 * El JS nunca parsea ni normaliza deviceId.
   */
   export function initBLEInterface(bleMesh) {
   var instance = new BLEInterface(bleMesh).init();
   window.bleInterface = instance;
   return instance;
   }
var BLE_CONTACTS_STORAGE_KEY = 'nexo_ble_contacts_v2';
var BLE_UUID_STORAGE_KEY = 'nexo_device_uuid';
var BLE_PINNED_CONTACTS_KEY = 'nexo_ble_pinned_contacts';
var BLE_NEXO_ID_STORAGE_KEY = 'nexo_ble_advertising_id';
var BLE_NEXO_ID_VAULT_FILE = 'nexo_advertising_id.json';
var BLE_CONTACTS_VAULT_FILE = 'nexo_ble_contacts.json';
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
function _generateNexoId() {
var now = new Date();
var seconds = now.getSeconds();
var secBase36 = seconds.toString(36).toUpperCase().padStart(2, '0');
var uuidPart = _generateUUID().replace(/-/g, '').substring(0, 6).toUpperCase();
return 'NX' + secBase36 + uuidPart;
}
function _saveNexoIdToVault(nexoId) {
return new Promise(function(resolve) {
try { localStorage.setItem(BLE_NEXO_ID_STORAGE_KEY, nexoId); } catch (e) {}
if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.NexoBLE) {
_safeNativeCall(window.Capacitor.Plugins.NexoBLE, 'saveToFile', {
filename: BLE_NEXO_ID_VAULT_FILE,
content: JSON.stringify({ nexoId: nexoId, createdAt: Date.now() })
}).then(function() { resolve(nexoId); }).catch(function() { resolve(nexoId); });
} else { resolve(nexoId); }
});
}
function _loadNexoIdFromVault() {
return new Promise(function(resolve) {
var cached = null;
try { cached = localStorage.getItem(BLE_NEXO_ID_STORAGE_KEY); } catch (e) {}
if (cached && cached.length === 10 && cached.indexOf('NX') === 0) { resolve(cached); return; }
if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.NexoBLE) {
_safeNativeCall(window.Capacitor.Plugins.NexoBLE, 'loadFromFile', {
filename: BLE_NEXO_ID_VAULT_FILE
}).then(function(result) {
if (result && result.exists && result.content) {
try {
var data = JSON.parse(result.content);
if (data.nexoId && data.nexoId.length === 10 && data.nexoId.indexOf('NX') === 0) {
try { localStorage.setItem(BLE_NEXO_ID_STORAGE_KEY, data.nexoId); } catch (e) {}
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
function _saveContactsToVault(contacts) {
return new Promise(function(resolve) {
try { localStorage.setItem(BLE_CONTACTS_STORAGE_KEY, JSON.stringify(contacts)); } catch (e) {}
if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.NexoBLE) {
_safeNativeCall(window.Capacitor.Plugins.NexoBLE, 'saveToFile', {
filename: BLE_CONTACTS_VAULT_FILE,
content: JSON.stringify({ contacts: contacts, savedAt: Date.now() })
}).then(function() { resolve(true); }).catch(function() { resolve(false); });
} else { resolve(false); }
});
}
function _loadContactsFromVault() {
return new Promise(function(resolve) {
try {
var raw = localStorage.getItem(BLE_CONTACTS_STORAGE_KEY);
if (raw) {
var parsed = JSON.parse(raw);
if (Array.isArray(parsed) && parsed.length > 0) { resolve(parsed); return; }
}
} catch (e) {}
if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.NexoBLE) {
_safeNativeCall(window.Capacitor.Plugins.NexoBLE, 'loadFromFile', {
filename: BLE_CONTACTS_VAULT_FILE
}).then(function(result) {
if (result && result.exists && result.content) {
try {
var data = JSON.parse(result.content);
if (data.contacts && Array.isArray(data.contacts)) {
try { localStorage.setItem(BLE_CONTACTS_STORAGE_KEY, JSON.stringify(data.contacts)); } catch (e) {}
resolve(data.contacts); return;
}
} catch (e) {}
}
resolve([]);
}).catch(function() { resolve([]); });
} else { resolve([]); }
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
// === CONTACTOS: Solo por NEXO ID, sin MAC ===
function _getBLEContacts() {
try { var raw = localStorage.getItem(BLE_CONTACTS_STORAGE_KEY); return raw ? JSON.parse(raw) : []; }
catch (e) { return []; }
}
function _saveBLEContacts(contacts) {
try { localStorage.setItem(BLE_CONTACTS_STORAGE_KEY, JSON.stringify(contacts)); } catch (e) {}
_saveContactsToVault(contacts).catch(function() {});
}
function _addBLEContact(contact) {
var contacts = _getBLEContacts();
var uuid = _normId(contact.deviceUUID);
if (!uuid) return false;
var existingIdx = contacts.findIndex(function(c) { return _normId(c.deviceUUID) === uuid; });
if (existingIdx >= 0) {
contacts[existingIdx].name = contact.name || contacts[existingIdx].name || '';
contacts[existingIdx].lastSeen = Date.now();
contacts[existingIdx].online = true;
if (contact.deviceId) contacts[existingIdx].deviceId = contact.deviceId;
_saveBLEContacts(contacts);
return true;
}
contacts.push({
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
function _getContactByDeviceId(deviceId) {
if (!deviceId) return null;
return _getBLEContacts().find(function(c) { return c.deviceId === deviceId; });
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
this.nativePlugin = (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.NexoBLE) || null;
this.isDummyMode = !bleMesh && !this.nativePlugin;
this.meshType = this._detectMeshType();
this.isAdvertising = false;
this.canAdvertise = false;
this.localDeviceName = '';
this.localDeviceUUID = _getDeviceUUID();
this.localNexoId = null;
this._activeChatDeviceId = null;
this._activeChatDeviceIdNative = null;
this._deviceStates = new Map();
this._receivedMessageIds = new Set();
this._maxMessageIds = 1000;
this._pendingMessageQueue = new Map();
this._readyResolvers = new Map();
this._notificationFallbackTimers = new Map();
console.log('[BLEInterface] v5.1.7-NO-MAC-CLEAN iniciado');
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
_loadContactsAndInit() {
var self = this;
_loadContactsFromVault().then(function(contacts) {
if (contacts && contacts.length > 0) {
try { localStorage.setItem(BLE_CONTACTS_STORAGE_KEY, JSON.stringify(contacts)); } catch (e) {}
}
self._continueInit();
}).catch(function() { self._continueInit(); });
}
_continueInit() {
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
this._setupAppStateListener();
this.elements.panel.classList.remove('active');
this.elements.overlay.classList.remove('active');
this.renderContactsList();
this.renderOnlineStrip();
var self = this;
setTimeout(function() {
if (!self.isDummyMode && self.nativePlugin) {
self._autoScanForKnownContacts();
}
}, 2000);
}
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
_loadContactsFromVault().then(function(contacts) {
if (contacts && contacts.length > 0) {
try { localStorage.setItem(BLE_CONTACTS_STORAGE_KEY, JSON.stringify(contacts)); } catch (e) {}
self.renderContactsList(); self.renderOnlineStrip();
}
}).catch(function() {});
if (!self.isAdvertising && self.nativePlugin && _hasNativeMethod(self.nativePlugin, 'startAdvertising')) {
_safeNativeCall(self.nativePlugin, 'startAdvertising', {})
.then(function() { self.isAdvertising = true; self.updateVisibilityButton(); })
.catch(function(e) {});
}
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
var peerUUID = null;
var contact = _getContactByDeviceId(deviceId);
if (contact) peerUUID = contact.deviceUUID;
var displayName = data.name || (contact ? contact.name : null) || '';
self.connectedDevices.set(deviceId, {
id: deviceId, name: displayName,
direction: data.direction || 'outgoing', role: data.role || 'client',
servicesReady: data.servicesReady || false, deviceUUID: peerUUID
});
self._setDeviceState(deviceId, data.role === 'server' ? BLE_STATES.READY_TO_CHAT : BLE_STATES.CONNECTING, {
direction: data.direction, role: data.role, deviceUUID: peerUUID
});
if (peerUUID) {
var contacts = _getBLEContacts();
var idx = contacts.findIndex(function(c) { return _normId(c.deviceUUID) === _normId(peerUUID); });
if (idx >= 0) {
contacts[idx].online = true; contacts[idx].lastSeen = Date.now(); contacts[idx].deviceId = deviceId;
_saveBLEContacts(contacts); self.renderContactsList(); self.renderOnlineStrip();
}
}
_safeDispatchEvent('nexo:ble:deviceConnected', { deviceId: deviceId, deviceUUID: peerUUID, name: displayName });
} catch (e) {}
});
this._nativeDeviceDisconnectedListener = this.nativePlugin.addListener('onDeviceDisconnected', function(data) {
try {
var deviceId = data.deviceId || '';
if (!deviceId) return;
var peerUUID = null;
var contact = _getContactByDeviceId(deviceId);
if (contact) peerUUID = contact.deviceUUID;
self.connectedDevices.delete(deviceId);
self._setDeviceState(deviceId, BLE_STATES.DISCONNECTED);
if (peerUUID) {
var contacts = _getBLEContacts();
var idx = contacts.findIndex(function(c) { return _normId(c.deviceUUID) === _normId(peerUUID); });
if (idx >= 0) { contacts[idx].online = false; _saveBLEContacts(contacts); self.renderContactsList(); self.renderOnlineStrip(); }
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
if (contact) peerUUID = contact.deviceUUID;
self._setDeviceState(deviceId, BLE_STATES.READY_TO_CHAT, { notificationsEnabled: true, deviceUUID: peerUUID });
self._resolveReadyToChat(deviceId);
self._processPendingMessages(deviceId);
} catch (e) {}
});
this._nativeConnectionFailedListener = this.nativePlugin.addListener('onConnectionFailed', function(data) {
try {
var deviceId = data.deviceId || '';
if (!deviceId) return;
var ft = self._notificationFallbackTimers.get(deviceId);
if (ft) { clearTimeout(ft); self._notificationFallbackTimers.delete(deviceId); }
self._setDeviceState(deviceId, BLE_STATES.ERROR, { lastError: data.reason });
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
var source = data.source || 'unknown';
if (source !== 'gatt_server' && source !== 'gatt_client' && source !== 'broadcast') source = 'gatt_client';
var messageId = null, senderName = null, senderUUID = null;
var content = data.content || data.data || '';
var isControl = _isControlPacket(content);
if (isControl) {
try {
var ctrl = JSON.parse(content);
messageId = ctrl.messageId; senderUUID = ctrl.deviceUUID; senderName = ctrl.senderName || '';
_safeDispatchEvent('nexo:ble:messageReceived', { deviceId: deviceId, deviceUUID: senderUUID, content: content, senderName: senderName, messageId: messageId, source: source, timestamp: data.timestamp || Date.now(), isControl: true });
return;
} catch (ctrlErr) {}
}
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
} catch (e) {}
}
if (!senderUUID) {
var contactByDevice = _getContactByDeviceId(deviceId);
if (contactByDevice) senderUUID = contactByDevice.deviceUUID;
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
var idx2 = contacts2.findIndex(function(c) { return _normId(c.deviceUUID) === _normId(senderUUID); });
if (idx2 >= 0) { contacts2[idx2].online = true; contacts2[idx2].lastSeen = Date.now(); contacts2[idx2].deviceId = deviceId; if (content && !isControl) contacts2[idx2].lastMessage = content.substring(0, 50); _saveBLEContacts(contacts2); self.renderContactsList(); self.renderOnlineStrip(); }
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
var stableId = senderUUID || deviceId;
_safeDispatchEvent('nexo:ble:messageReceived', { deviceId: stableId, deviceUUID: senderUUID, content: content, senderName: senderName, messageId: messageId, source: source, timestamp: data.timestamp || Date.now() });
} catch (e) { console.warn('[BLEInterface] Error onPayloadReceived:', e.message); }
});
}
_processPendingMessages(deviceId) {
var self = this;
if (!deviceId) return Promise.resolve();
var queue = this._pendingMessageQueue.get(deviceId);
if (!queue || queue.length === 0) return Promise.resolve();
this._pendingMessageQueue.delete(deviceId);
var processNext = function(idx) {
if (idx >= queue.length) return Promise.resolve();
var item = queue[idx];
return self._sendMessageNative(deviceId, item.content, item.messageId)
.then(function() { item.resolve(); return processNext(idx + 1); })
.catch(function(e) { item.reject(e); return processNext(idx + 1); });
};
return processNext(0);
}
_sendMessageNative(deviceId, content, messageId) {
var self = this;
return new Promise(function(resolve, reject) {
try {
if (!self.nativePlugin) { reject(new Error('Plugin no disponible')); return; }
if (!deviceId) { reject(new Error('deviceId invalido')); return; }
var isCtrl = _isControlPacket(content);
var enrichedPayload;
if (isCtrl) { enrichedPayload = content; }
else {
var senderId = self.localNexoId || self.localDeviceUUID;
var msgId = messageId || ('msg' + Date.now() + '*' + Math.random().toString(36).substr(2, 9));
enrichedPayload = JSON.stringify({
v: 1,
type: 'chat',
from: senderId,
to: '',
ts: Date.now(),
msgId: msgId,
payload: {
text: content,
senderNexoId: senderId,
senderName: self.localDeviceName,
timestamp: Date.now()
},
jump: { ttl: 5, hops: 0, path: [] }
});
}
if (_hasNativeMethod(self.nativePlugin, 'sendMessage')) {
_safeNativeCall(self.nativePlugin, 'sendMessage', { deviceId: deviceId, message: enrichedPayload })
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
if (_normId(allContacts[i].deviceUUID) === uuid && allContacts[i].deviceId) { deviceId = allContacts[i].deviceId; break; }
}
}
if (!deviceId) { console.error('[BLEInterface] sendChatMessage: No deviceId para UUID', uuid); reject(new Error('Dispositivo no encontrado')); return; }
if (contact && !contact.deviceId) { contact.deviceId = deviceId; _saveBLEContacts(_getBLEContacts()); }
var state = self._getDeviceState(deviceId);
var isReady = state.state === BLE_STATES.READY_TO_CHAT || state.state === BLE_STATES.NOTIFICATIONS_READY;
var isConnecting = state.state === BLE_STATES.CONNECTING || state.state === BLE_STATES.DISCOVERING_SERVICES;
function doSend() {
self._sendMessageNative(deviceId, content, messageId).then(function() { resolve(); }).catch(function(err) { reject(err); });
}
function enqueueMsg() {
var queue = self._pendingMessageQueue.get(deviceId) || [];
queue.push({ content: content, messageId: messageId, resolve: resolve, reject: reject });
self._pendingMessageQueue.set(deviceId, queue);
}
if (isReady) { doSend(); return; }
enqueueMsg();
if (!isConnecting && self.nativePlugin && _hasNativeMethod(self.nativePlugin, 'connectToDevice')) {
_safeNativeCall(self.nativePlugin, 'connectToDevice', { deviceId: deviceId })
.catch(function(e) {});
}
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
var resolver = this._readyResolvers.get(deviceId);
if (resolver) { clearTimeout(resolver.timer); resolver.resolve(); this._readyResolvers.delete(deviceId); }
this._processPendingMessages(deviceId);
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
var displayName = (contact && contact.name) || '';
if (!deviceId) { reject(new Error('Dispositivo no conectado')); return; }
self._activeChatDeviceId = uuid; self._activeChatDeviceIdNative = deviceId;
self.newDevicesCount = 0; self.updateBadge();
if (contact) {
contact.unreadCount = 0; var contacts = _getBLEContacts();
var idx = contacts.findIndex(function(c) { return _normId(c.deviceUUID) === uuid; });
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
if (nameInput) nameInput.value = displayName;
if (subtitle) subtitle.textContent = '';
_safeDispatchEvent('nexo:ble:openChat', { contactId: uuid, name: displayName, deviceId: deviceId, transport: 'ble', source: 'ble_interface' });
self.elements.panel.classList.remove('active'); self.elements.overlay.classList.remove('active');
}
finishOpenChat();
resolve();
if (!isFullyReady && self.nativePlugin && _hasNativeMethod(self.nativePlugin, 'connectToDevice')) {
if (!isConnecting) {
_safeNativeCall(self.nativePlugin, 'connectToDevice', { deviceId: deviceId })
.catch(function(e) {});
}
}
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
_autoScanForKnownContacts() {
var self = this;
if (self.isScanning) return;
if (!self.nativePlugin || !_hasNativeMethod(self.nativePlugin, 'startScan')) return;
var contacts = _getBLEContacts();
if (contacts.length === 0) return;
console.log('[BLEInterface] Auto-scan iniciado para ' + contacts.length + ' contactos conocidos');
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
}, 8000);
})
.catch(function(e) {
console.warn('[BLEInterface] Auto-scan fallo:', e.message);
});
}
_autoConnectGATT(deviceId, device) {
var self = this;
if (!self.nativePlugin || !_hasNativeMethod(self.nativePlugin, 'connectToDevice')) return Promise.resolve();
if (!deviceId) return Promise.resolve();
var state = self._getDeviceState(deviceId);
if (state.state === BLE_STATES.READY_TO_CHAT || state.state === BLE_STATES.NOTIFICATIONS_READY || state.state === BLE_STATES.CONNECTING) return Promise.resolve();
self._setDeviceState(deviceId, BLE_STATES.CONNECTING, { direction: 'outgoing', role: 'client', auto: true });
self.connectedDevices.set(deviceId, { id: deviceId, name: (device && device.name) || '', direction: 'outgoing', servicesReady: false, deviceUUID: device && device.deviceUUID });
return _safeNativeCall(self.nativePlugin, 'connectToDevice', { deviceId: deviceId })
.then(function(result) { if (result && (result.connected || result.alreadyConnected)) { return self._waitForReadyToChat(deviceId, 8000).then(function() {}); } else { self._setDeviceState(deviceId, BLE_STATES.DISCONNECTED); } })
.catch(function(e) { self._setDeviceState(deviceId, BLE_STATES.DISCONNECTED); });
}
