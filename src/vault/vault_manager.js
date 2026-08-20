/**
 * vault_manager.js - Persistencia unificada NEXO
 * Items 9 (contactos) + 10 (conversaciones)
 * Reemplaza funciones duplicadas de crypto_vault.js y vault_fs.js
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

// ========== CONTACTOS (Item 9) ==========

export function vaultLoadContacts() {
  try {
    var raw = localStorage.getItem(VAULT_CONTACTS_KEY);
    if (!raw) return [];
    var parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) { return []; }
}

export function vaultSaveContact(contact) {
  try {
    var contacts = vaultLoadContacts();
    var idx = contacts.findIndex(function(c) { return _normId(c.nexoId) === _normId(contact.nexoId); });
    var now = Date.now();
    var normalized = {
      nexoId: contact.nexoId || '',
      displayName: contact.displayName || contact.name || contact.deviceName || 'Desconocido',
      avatarColor: contact.avatarColor || _generateColor(contact.nexoId),
      deviceName: contact.deviceName || contact.displayName || '',
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
    return true;
  } catch (e) { console.error('[VaultManager] saveContact:', e); return false; }
}

export function vaultFindContactByNexoId(nexoId) {
  if (!nexoId) return null;
  var contacts = vaultLoadContacts();
  return contacts.find(function(c) { return c.nexoId === nexoId; }) || null;
}

export function vaultUpdateContactLastSeen(nexoId) {
  var c = vaultFindContactByNexoId(nexoId);
  if (c) { c.lastSeen = Date.now(); vaultSaveContact(c); }
}

export function vaultGetOrCreateContact(nexoId, deviceName) {
  var c = vaultFindContactByNexoId(nexoId);
  if (!c) {
    c = {
      nexoId: nexoId,
      displayName: deviceName || nexoId.substring(0, 8),
      deviceName: deviceName || ''
    };
    vaultSaveContact(c);
  } else if (deviceName && !c.deviceName) {
    c.deviceName = deviceName;
    vaultSaveContact(c);
  }
  return c;
}

// ========== MENSAJES (Item 10) ==========

function _enqueueMsg(contactId, fn) {
  var cid = _normId(contactId);
  if (!cid) return Promise.resolve();
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
  while (queue.tasks.length > 0) {
    var task = queue.tasks.shift();
    try { var r = task.fn(); task.resolve(r); } catch (e) { task.reject(e); }
  }
  queue.processing = false;
  if (queue.tasks.length > 0) setTimeout(function() { _processMsgQueue(contactId); }, 0);
}

export function vaultLoadMessages(contactNexoId) {
  if (!contactNexoId) return [];
  if (_msgCache.has(contactNexoId)) return _msgCache.get(contactNexoId).slice();
  try {
    var raw = localStorage.getItem(VAULT_MESSAGES_PREFIX + contactNexoId);
    if (!raw) return [];
    var parsed = JSON.parse(raw);
    var msgs = Array.isArray(parsed) ? parsed : [];
    // FIX: normalizar msgId/messageId al cargar
    msgs.forEach(function(m) {
      var mid = m.msgId || m.messageId || m.id || ('msg_' + (m.timestamp || Date.now()));
      m.msgId = mid;
      m.messageId = mid;
    });
    _msgCache.set(contactNexoId, msgs.slice());
    return msgs;
  } catch (e) { return []; }
}

export function vaultSaveMessages(contactNexoId, messages) {
  if (!contactNexoId) return false;
  try {
    var toSave = messages.slice(-2000);
    localStorage.setItem(VAULT_MESSAGES_PREFIX + contactNexoId, JSON.stringify(toSave));
    _msgCache.set(contactNexoId, toSave.slice());
    return true;
  } catch (e) { console.error('[VaultManager] saveMessages:', e); return false; }
}

export function vaultAppendMessage(contactNexoId, message) {
  if (!contactNexoId || !message) return false;
  return _enqueueMsg(contactNexoId, function() {
    var messages = vaultLoadMessages(contactNexoId);
    var msgId = message.msgId || message.messageId || message.id || ('msg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6));
    // FIX: dual-key compatibilidad msgId/messageId
    message.msgId = msgId;
    message.messageId = msgId;
    var normalized = {
      msgId: msgId,
      messageId: msgId,
      text: message.text || message.content || '',
      content: message.content || message.text || '',
      senderNexoId: message.senderNexoId || message.sender || '',
      senderName: message.senderName || '',
      timestamp: message.timestamp || message.ts || Date.now(),
      status: message.status || 'pending',
      _own: !!message._own,
      type: message.type || 'text',
      attachmentType: message.attachmentType || null,
      attachmentPayload: message.attachmentPayload || null,
      attachmentMeta: message.attachmentMeta || null
    };
    var existingIdx = messages.findIndex(function(m) { return m.msgId === normalized.msgId; });
    if (existingIdx >= 0) {
      messages[existingIdx] = Object.assign({}, messages[existingIdx], normalized);
    } else {
      messages.push(normalized);
    }
    vaultSaveMessages(contactNexoId, messages);
    return normalized;
  });
}

export function vaultUpdateMessageStatus(contactNexoId, msgId, status) {
  if (!contactNexoId || !msgId) return false;
  return _enqueueMsg(contactNexoId, function() {
    var messages = vaultLoadMessages(contactNexoId);
    var idx = messages.findIndex(function(m) { return m.msgId === msgId; });
    if (idx >= 0) {
      messages[idx].status = status;
      vaultSaveMessages(contactNexoId, messages);
      return true;
    }
    return false;
  });
}
