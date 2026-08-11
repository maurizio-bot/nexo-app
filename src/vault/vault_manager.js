/**
 * vault_manager.js - Persistencia unificada NEXO
 * Items 9 (contactos) + 10 (conversaciones)
 * Reemplaza funciones duplicadas de crypto_vault.js y vault_fs.js
 * FIX: Agregar deviceId nativo al schema (campo opcional, NXID sigue siendo key primaria)
 */
var VAULT_CONTACTS_KEY = 'nexo_vault_contacts_v2';
var VAULT_MESSAGES_PREFIX = 'nexo_vault_msgs_v2_';
var _msgCache = new Map();
var _msgQueue = new Map();
function _normId(id) {
  return (id || '').toString().toLowerCase().trim();
}
function _generateColor(str) {
  var colors = ['#FF6B6B','#4ECDC4','#45B7D1','#96CEB4','#FFEAA7','#DDA0DD','#98D8C8','#F7DC6F','#BB8FCE','#85C1E9'];
  var hash = 0;
  for (var i = 0; i < (str || '').length; i++) hash = ((hash << 5) - hash) + str.charCodeAt(i);
  return colors[Math.abs(hash) % colors.length];
}

// ========== SYNC HELPERS (para uso interno y ble_interface) ==========
function vaultLoadContactsSync() {
  try {
    var raw = localStorage.getItem(VAULT_CONTACTS_KEY);
    if (!raw) return [];
    var parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) { return []; }
}
function vaultLoadMessagesSync(contactNexoId) {
  contactNexoId = _normId(contactNexoId);  // FIX: normalizar
  if (!contactNexoId) return [];
  if (_msgCache.has(contactNexoId)) return _msgCache.get(contactNexoId).slice();
  try {
    var raw = localStorage.getItem(VAULT_MESSAGES_PREFIX + contactNexoId);
    if (!raw) return [];
    var parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) { return []; }
}
function vaultSaveMessagesSync(contactNexoId, messages) {
  contactNexoId = _normId(contactNexoId);  // FIX: normalizar
  if (!contactNexoId) return false;
  try {
    var toSave = messages.slice(-2000);
    localStorage.setItem(VAULT_MESSAGES_PREFIX + contactNexoId, JSON.stringify(toSave));
    _msgCache.set(contactNexoId, toSave.slice());
    return true;
  } catch (e) { return false; }
}

// ========== CONTACTOS (Item 9) - Promise API ==========
export function vaultLoadContacts() {
  return Promise.resolve(vaultLoadContactsSync());
}
export function vaultSaveContact(contact) {
  try {
    var contacts = vaultLoadContactsSync();
    var idx = contacts.findIndex(function(c) { return c.nexoId === contact.nexoId; });
    var now = Date.now();
    var normalized = {
      nexoId: contact.nexoId || '',
      displayName: contact.displayName || contact.name || contact.deviceName || 'Desconocido',
      avatarColor: contact.avatarColor || _generateColor(contact.nexoId),
      deviceName: contact.deviceName || contact.displayName || '',
      deviceId: contact.deviceId || contact.nativeDeviceId || null,
      createdAt: contact.createdAt || now,
      lastSeen: now,
      isGuardian: !!contact.isGuardian,
      trustScore: contact.trustScore || 0,
      verifiedInPerson: !!contact.verifiedInPerson,
      messageFrequency: contact.messageFrequency || 0,
      proximityScore: contact.proximityScore || 0,
      publicKey: contact.publicKey || ''
    };
    if (idx >= 0) {
      var existing = contacts[idx];
      contacts[idx] = Object.assign({}, existing, normalized, { createdAt: existing.createdAt || now });
    } else {
      contacts.push(normalized);
    }
    localStorage.setItem(VAULT_CONTACTS_KEY, JSON.stringify(contacts));
    return Promise.resolve(true);
  } catch (e) { console.error('[VaultManager] saveContact:', e); return Promise.resolve(false); }
}
export function vaultFindContactByNexoId(nexoId) {
  if (!nexoId) return null;
  var contacts = vaultLoadContactsSync();
  return contacts.find(function(c) { return c.nexoId === nexoId; }) || null;
}
export function vaultFindContactByDeviceId(deviceId) {
  if (!deviceId) return null;
  var contacts = vaultLoadContactsSync();
  return contacts.find(function(c) { return c.deviceId === deviceId; }) || null;
}
export function vaultUpdateContactLastSeen(nexoId) {
  var c = vaultFindContactByNexoId(nexoId);
  if (c) { c.lastSeen = Date.now(); vaultSaveContact(c); }
}
export function vaultGetOrCreateContact(nexoId, deviceName, deviceId) {
  var c = vaultFindContactByNexoId(nexoId);
  if (!c) {
    c = {
      nexoId: nexoId,
      displayName: deviceName || nexoId.substring(0, 8),
      deviceName: deviceName || '',
      deviceId: deviceId || null
    };
    vaultSaveContact(c);
  } else if (deviceName && !c.deviceName) {
    c.deviceName = deviceName;
    vaultSaveContact(c);
  } else if (deviceId && !c.deviceId) {
    c.deviceId = deviceId;
    vaultSaveContact(c);
  }
  return c;
}
// ========== MENSAJES (Item 10) - Promise API ==========
function _enqueueMsg(contactId, fn) {
  var cid = _normId(contactId);
  if (!cid) return Promise.resolve(null);
  if (!_msgQueue.has(cid)) _msgQueue.set(cid, { tasks: [], processing: false });
  return new Promise(function(resolve, reject) {
    _msgQueue.get(cid).tasks.push({ fn: fn, resolve: resolve, reject: reject });
    _processMsgQueue(cid);
  });
}
function _processMsgQueue(contactId) {
  var queue = _msgQueue.get(contactId);
  if (!queue || queue.processing) return;
  queue.processing = true;
  setTimeout(function() {
    while (queue.tasks.length > 0) {
      var task = queue.tasks.shift();
      try { var r = task.fn(); task.resolve(r); } catch (e) { task.reject(e); }
    }
    queue.processing = false;
    if (queue.tasks.length > 0) _processMsgQueue(contactId);
  }, 0);
}

export function vaultLoadMessages(contactNexoId) {
  return Promise.resolve(vaultLoadMessagesSync(contactNexoId));
}
export function vaultSaveMessages(contactNexoId, messages) {
  return Promise.resolve(vaultSaveMessagesSync(contactNexoId, messages));
}
export function vaultAppendMessage(contactNexoId, message) {
  contactNexoId = _normId(contactNexoId);  // FIX: normalizar
  if (!contactNexoId || !message) return Promise.resolve(false);
  return _enqueueMsg(contactNexoId, function() {
    var messages = vaultLoadMessagesSync(contactNexoId);
    var msgId = message.msgId || message.messageId || ('msg' + Date.now() + '_' + Math.random().toString(36).substr(2, 6));
    var normalized = {
      msgId: msgId,
      text: message.text || message.content || '',
      senderNexoId: message.senderNexoId || message.sender || '',
      senderName: message.senderName || '',
      timestamp: message.timestamp || message.ts || Date.now(),
      status: message.status || 'pending',
      _own: !!message._own,
      type: message.type || 'text'
    };
    var existingIdx = messages.findIndex(function(m) { return m.msgId === normalized.msgId; });
    if (existingIdx >= 0) {
      messages[existingIdx] = Object.assign({}, messages[existingIdx], normalized);
    } else {
      messages.push(normalized);
    }
    vaultSaveMessagesSync(contactNexoId, messages);
    return normalized;
  });
}
export function vaultUpdateMessageStatus(contactNexoId, msgId, status) {
  contactNexoId = _normId(contactNexoId);  // FIX: normalizar
  if (!contactNexoId || !msgId) return Promise.resolve(false);
  return _enqueueMsg(contactNexoId, function() {
    var messages = vaultLoadMessagesSync(contactNexoId);
    var idx = messages.findIndex(function(m) { return m.msgId === msgId; });
    if (idx >= 0) {
      messages[idx].status = status;
      vaultSaveMessagesSync(contactNexoId, messages);
      return true;
    }
    return false;
  });
}

// ========== EXPONER GLOBALMENTE para nexo_app.js y ble_interface.js ==========
if (typeof window !== 'undefined') {
  window.vaultLoadContactsSync = vaultLoadContactsSync;
  window.vaultLoadMessagesSync = vaultLoadMessagesSync;
  window.vaultLoadContacts = vaultLoadContacts;
  window.vaultSaveContact = vaultSaveContact;
  window.vaultFindContactByNexoId = vaultFindContactByNexoId;
  window.vaultFindContactByDeviceId = vaultFindContactByDeviceId;
  window.vaultUpdateContactLastSeen = vaultUpdateContactLastSeen;
  window.vaultGetOrCreateContact = vaultGetOrCreateContact;
  window.vaultLoadMessages = vaultLoadMessages;
  window.vaultSaveMessages = vaultSaveMessages;
  window.vaultAppendMessage = vaultAppendMessage;
  window.vaultUpdateMessageStatus = vaultUpdateMessageStatus;
}
