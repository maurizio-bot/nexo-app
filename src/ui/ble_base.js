/**
 * BLE Base — Helpers, constantes y clase BLEInterface (constructor)
 * v5.2.2-split-base  (FIXED: no circular deps)
 */
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
  if (content.indexOf('"type":"ping"') !== -1) return true;
  if (content.indexOf('"type":"pong"') !== -1) return true;
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
    this._seenMsgs = new Map();
    this._pendingACKs = new Map();
    this._heartbeatTimers = new Map();
    this._heartbeatInterval = 5000;
    this._heartbeatTimeout = 10000;
    this._scanFallbackTimer = null;
    this._scanActionPending = false;
    this._cleanupSeenMsgsTimer = null;
    console.log('[BLEInterface] v5.2.2-split-base iniciado');
  }
  _detectMeshType() {
    if (!this.bleMesh) return 'none';
    if (typeof this.bleMesh.getState === 'function') return 'nordic';
    if (typeof this.bleMesh.getStatus === 'function') return 'hybrid';
    return 'unknown';
  }
}

// FIX: Exportar helpers a window para que otros módulos puedan usarlos sin import
if (typeof window !== 'undefined') {
  Object.assign(window, {
    BLE_CONTACTS_STORAGE_KEY, BLE_UUID_STORAGE_KEY, BLE_PINNED_CONTACTS_KEY,
    BLE_NEXO_ID_STORAGE_KEY, BLE_NEXO_ID_VAULT_FILE, BLE_CONTACTS_VAULT_FILE,
    GRADIENTS, _getGradientForUUID, _getInitials, _generateNexoId,
    _saveNexoIdToVault, _loadNexoIdFromVault, _getOrCreateNexoId,
    _saveContactsToVault, _loadContactsFromVault, _formatTime,
    _generateUUID, _getDeviceUUID, _normId, _getBLEContacts,
    _saveBLEContacts, _addBLEContact, _removeBLEContact, _isBLEContact,
    _getContactByUUID, _getContactByDeviceId, _getPinnedContacts,
    _togglePinnedContact, _isPinned, BLE_STATES, _hasNativeMethod,
    _safeNativeCall, _safeDispatchEvent, _showToast, _isControlPacket
  });
}
