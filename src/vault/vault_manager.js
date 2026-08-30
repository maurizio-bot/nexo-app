/**
 * vault_manager.js v2.1.2-FIX
 * FIX: Campo seq en mensajes + ordenación por (timestamp, seq, msgId)
 * FIX: LRU cache para _msgCache (límite 20 contactos, evita leak de memoria)
 * FIX: Nunca persistir JSONs de protocolo (chat_meta, chat_chunk, file_meta, file_chunk, file_resume)
 * Base: v2.1.1-FIX
 */

var VAULT_CONTACTS_FILE = 'nexo_vault_contacts.json';
var VAULT_MESSAGES_PREFIX = 'nexo_vault_msgs_v2_';
var _vaultContacts = [];
var _vaultInitDone = false;

// LRU cache nativo para mensajes (max 20 contactos en memoria)
function _createLRU(maxSize) {
  var map = new Map();
  return {
    get: function(key) {
      var val = map.get(key);
      if (val !== undefined) {
        map.delete(key);
        map.set(key, val);
      }
      return val;
    },
    set: function(key, value) {
      if (map.has(key)) map.delete(key);
      map.set(key, value);
      if (map.size > maxSize) {
        var first = map.keys().next().value;
        map.delete(first);
      }
    },
    has: function(key) { return map.has(key); },
    delete: function(key) { map.delete(key); },
    clear: function() { map.clear(); }
  };
}
var _msgCache = _createLRU(20);

function _normId(id) {
  return (id || '').toString().toLowerCase().trim();
}

function _hasNativeMethod(plugin, method) {
  return plugin && typeof plugin[method] === 'function';
}

function _safeNativeCall(plugin, method, args) {
  return new Promise(function(resolve, reject) {
    if (!plugin) { reject(new Error('Plugin nativo no disponible')); return; }
    if (typeof plugin[method] !== 'function') { reject(new Error('Metodo ' + method + ' no disponible')); return; }
    try {
      var result = plugin[method](args);
      if (result && typeof result.then === 'function') {
        result.then(resolve).catch(reject);
      } else { resolve(result); }
    } catch (e) { reject(e); }
  });
}

function _nativePlugin() {
  return (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.NexoBLE) || null;
}

function _generateColor(str) {
  var colors = ['#FF6B6B','#4ECDC4','#45B7D1','#96CEB4','#FFEAA7','#DDA0DD','#98D8C8','#F7DC6F','#BB8FCE','#85C1E9'];
  var hash = 0;
  for (var i = 0; i < (str || '').length; i++) hash = ((hash << 5) - hash) + str.charCodeAt(i);
  return colors[Math.abs(hash) % colors.length];
}

// ========== INIT ==========

export async function initVault() {
  if (_vaultInitDone) return;
  var plugin = _nativePlugin();
  if (!plugin) {
    _vaultInitDone = true;
    return;
  }
  try {
    var result = await _safeNativeCall(plugin, 'loadFromFile', { filename: VAULT_CONTACTS_FILE });
    if (result && result.exists && result.content) {
      var data = JSON.parse(result.content);
      _vaultContacts = Array.isArray(data.contacts) ? data.contacts : [];
    } else {
      _vaultContacts = [];
    }
  } catch (e) {
    _vaultContacts = [];
  }
  _vaultInitDone = true;
}

function _persistContacts() {
  var plugin = _nativePlugin();
  if (!plugin) return;
  _safeNativeCall(plugin, 'saveToFile', {
    filename: VAULT_CONTACTS_FILE,
    content: JSON.stringify({ contacts: _vaultContacts, savedAt: Date.now() })
  }).catch(function(e) {});
}

// ========== CONTACTOS ==========

export function vaultLoadContacts() {
  return _vaultContacts || [];
}

export function vaultSaveContacts(contacts) {
  try {
    _vaultContacts = Array.isArray(contacts) ? contacts : [];
    _persistContacts();
    return true;
  } catch (e) { return false; }
}

export function vaultSaveContact(contact) {
  try {
    var contacts = _vaultContacts;
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
      publicKey: contact.publicKey || '',
      deviceId: contact.deviceId || contact.deviceUUID || null
    };
    if (idx >= 0) {
      var existing = contacts[idx];
      contacts[idx] = Object.assign({}, existing, normalized, { createdAt: existing.createdAt || now });
    } else {
      contacts.push(normalized);
    }
    _persistContacts();
    return true;
  } catch (e) { console.error('[VaultManager] saveContact:', e); return false; }
}

export function vaultFindContactByNexoId(nexoId) {
  if (!nexoId) return null;
  return _vaultContacts.find(function(c) { return _normId(c.nexoId) === _normId(nexoId); }) || null;
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

// ========== MENSAJES ==========

function _msgFileName(contactNexoId) {
  return VAULT_MESSAGES_PREFIX + _normId(contactNexoId) + '.json';
}

export async function vaultLoadMessages(contactNexoId) {
  if (!contactNexoId) return [];
  var cid = _normId(contactNexoId);
  var cached = _msgCache.get(cid);
  if (cached !== undefined) return cached.slice();
  var plugin = _nativePlugin();
  if (!plugin) return [];
  try {
    var result = await _safeNativeCall(plugin, 'loadFromFile', { filename: _msgFileName(cid) });
    if (result && result.exists && result.content) {
      var data = JSON.parse(result.content);
      var msgs = Array.isArray(data.messages) ? data.messages : (Array.isArray(data) ? data : []);
      msgs.forEach(function(m) {
        var mid = m.msgId || m.messageId || m.id || ('msg_' + (m.timestamp || Date.now()));
        m.msgId = mid;
        m.messageId = mid;
      });
      msgs.sort(function(a, b) {
        var tsA = a.timestamp || 0;
        var tsB = b.timestamp || 0;
        if (tsA !== tsB) return tsA - tsB;
        var seqA = (typeof a.seq === 'number') ? a.seq : 0;
        var seqB = (typeof b.seq === 'number') ? b.seq : 0;
        if (seqA !== seqB) return seqA - seqB;
        var idA = a.msgId || '';
        var idB = b.msgId || '';
        return idA.localeCompare(idB);
      });
      _msgCache.set(cid, msgs.slice());
      return msgs;
    }
  } catch (e) {}
  return [];
}

function _persistMessages(contactNexoId, messages) {
  var plugin = _nativePlugin();
  if (!plugin) return;
  var cid = _normId(contactNexoId);
  var toSave = messages.slice(-2000);
  _msgCache.set(cid, toSave.slice());
  _safeNativeCall(plugin, 'saveToFile', {
    filename: _msgFileName(cid),
    content: JSON.stringify({ messages: toSave, savedAt: Date.now() })
  }).catch(function(e) {});
}

export async function vaultSaveMessages(contactNexoId, messages) {
  if (!contactNexoId) return false;
  var cid = _normId(contactNexoId);
  var toSave = messages.slice(-2000);
  _msgCache.set(cid, toSave.slice());
  var plugin = _nativePlugin();
  if (!plugin) return false;
  try {
    await _safeNativeCall(plugin, 'saveToFile', {
      filename: _msgFileName(cid),
      content: JSON.stringify({ messages: toSave, savedAt: Date.now() })
    });
    return true;
  } catch (e) { return false; }
}

export async function vaultAppendMessage(contactNexoId, message) {
  if (!contactNexoId || !message) return null;
  // FIX v2.1.2: Nunca persistir JSONs de protocolo
  var txt = message.text || message.content || '';
  if (typeof txt === 'string' && txt.trim().charAt(0) === '{') {
    try {
      var p = JSON.parse(txt.trim());
      if (p.type === 'chat_meta' || p.type === 'chat_chunk' || p.type === 'file_meta' ||
          p.type === 'file_chunk' || p.type === 'file_resume') {
        console.warn('[VaultManager] Protocol JSON rejected from vault:', p.type);
        return null;
      }
    } catch(e) {}
  }
  var cid = _normId(contactNexoId);
  var messages = _msgCache.has(cid) ? _msgCache.get(cid).slice() : (await vaultLoadMessages(cid));
  var msgId = message.msgId || message.messageId || message.id || ('msg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6));
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
    seq: (typeof message.seq === 'number') ? message.seq : 0,
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
  _persistMessages(cid, messages);
  return normalized;
}

export async function vaultUpdateMessageStatus(contactNexoId, msgId, status) {
  if (!contactNexoId || !msgId) return false;
  var cid = _normId(contactNexoId);
  var messages = _msgCache.has(cid) ? _msgCache.get(cid).slice() : (await vaultLoadMessages(cid));
  var idx = messages.findIndex(function(m) { return m.msgId === msgId; });
  if (idx >= 0) {
    messages[idx].status = status;
    _persistMessages(cid, messages);
    return true;
  }
  return false;
}

// === FIX OFFLINE: Vault entrega pending ordenados cronológicamente ===
export async function vaultGetPendingMessages(contactNexoId) {
  if (!contactNexoId) return [];
  var cid = _normId(contactNexoId);
  var messages = _msgCache.has(cid) ? _msgCache.get(cid).slice() : (await vaultLoadMessages(cid));
  var pending = messages.filter(function(m) {
    return m._own === true && (m.status === 'pending' || m.status === 'failed');
  });
  pending.sort(function(a, b) {
    var tsA = a.timestamp || 0;
    var tsB = b.timestamp || 0;
    if (tsA !== tsB) return tsA - tsB;
    var seqA = (typeof a.seq === 'number') ? a.seq : 0;
    var seqB = (typeof b.seq === 'number') ? b.seq : 0;
    return seqA - seqB;
  });
  return pending;
}
// === FIN FIX OFFLINE ===
