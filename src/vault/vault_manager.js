/**
 * vault_manager.js v2.2.1-D2
 * FIX: Bug 5a — vaultAppendChunk auto-crea transferencia si chat_meta se perdió
 * D1: Vault Transfer Layer — persistencia de chunks para mensajes largos y archivos
 * D2: Outgoing Transfer Registry — Block ACK emisor (máscaras sent/ack, chunks para reenvío)
 * FIX: Campo seq en mensajes + ordenación por (timestamp, seq, msgId)
 * FIX: LRU cache para _msgCache (límite 20 contactos, evita leak de memoria)
 * FIX: Nunca persistir JSONs de protocolo (chat_meta, chat_chunk, file_meta, file_chunk, file_resume)
 * Base: v2.1.2-FIX
 */

var VAULT_CONTACTS_FILE = 'nexo_vault_contacts.json';
var VAULT_MESSAGES_PREFIX = 'nexo_vault_msgs_v2_';
var VAULT_TRANSFERS_PREFIX = 'nexo_vault_transfers_v2_';
var VAULT_OUTGOING_PREFIX = 'nexo_vault_outgoing_v2_';
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
var _transferCache = _createLRU(20);
var _outgoingCache = _createLRU(20);

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
n        return idA.localeCompare(idB);
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

// ========== D1: VAULT TRANSFER LAYER (chunks persistentes receptor) ==========

function _transferFileName(contactNexoId) {
  return VAULT_TRANSFERS_PREFIX + _normId(contactNexoId) + '.json';
}

async function _loadTransfers(contactNexoId) {
  if (!contactNexoId) return [];
  var cid = _normId(contactNexoId);
  var cached = _transferCache.get(cid);
  if (cached !== undefined) return cached.slice();
  var plugin = _nativePlugin();
  if (!plugin) return [];
  try {
    var result = await _safeNativeCall(plugin, 'loadFromFile', { filename: _transferFileName(cid) });
    if (result && result.exists && result.content) {
      var data = JSON.parse(result.content);
      var transfers = Array.isArray(data.transfers) ? data.transfers : [];
      _transferCache.set(cid, transfers.slice());
      return transfers;
    }
  } catch (e) {}
  return [];
}

function _persistTransfers(contactNexoId, transfers) {
  var plugin = _nativePlugin();
  if (!plugin) return;
  var cid = _normId(contactNexoId);
  var toSave = transfers.slice(-100); // máx 100 transferencias por contacto
  _transferCache.set(cid, toSave.slice());
  _safeNativeCall(plugin, 'saveToFile', {
    filename: _transferFileName(cid),
    content: JSON.stringify({ transfers: toSave, savedAt: Date.now() })
  }).catch(function(e) {});
}

export async function vaultCreateTransfer(contactNexoId, transferId, type, totalChunks, meta) {
  if (!contactNexoId || !transferId || !type || !totalChunks) return null;
  var cid = _normId(contactNexoId);
  var transfers = await _loadTransfers(cid);
  var existing = transfers.find(function(t) { return t.transferId === transferId; });
  if (existing) return existing;
  var now = Date.now();
  var maskArr = [];
  for (var i = 0; i < totalChunks; i++) maskArr.push('0');
  var transfer = {
    transferId: transferId,
    type: type,
    status: 'receiving',
    totalChunks: totalChunks,
    receivedChunks: 0,
    receivedMask: maskArr.join(''),
    chunks: [],
    meta: meta || {},
    senderNexoId: (meta && meta.senderNexoId) ? meta.senderNexoId : ((meta && meta.from) ? meta.from : ''),
    createdAt: now,
    updatedAt: now,
    expiresAt: now + 86400000 // 24h
  };
  transfers.push(transfer);
  _persistTransfers(cid, transfers);
  return transfer;
}

export async function vaultAppendChunk(contactNexoId, transferId, index, data, totalChunks, meta) {
  if (!contactNexoId || !transferId || typeof index !== 'number' || data === undefined || data === null) return false;
  var cid = _normId(contactNexoId);
  var transfers = await _loadTransfers(cid);
  var t = transfers.find(function(tr) { return tr.transferId === transferId; });
  if (!t) {
    // FIX v2.2.1: auto-crear transferencia si chat_meta se perdió en el aire
    if (!totalChunks || totalChunks <= 0) return false;
    var now = Date.now();
    var maskArr = [];
    for (var i = 0; i < totalChunks; i++) maskArr.push('0');
    t = {
      transferId: transferId,
      type: 'chat',
      status: 'receiving',
      totalChunks: totalChunks,
      receivedChunks: 0,
      receivedMask: maskArr.join(''),
      chunks: [],
      meta: meta || {},
      senderNexoId: cid,
      createdAt: now,
      updatedAt: now,
      expiresAt: now + 86400000
    };
    transfers.push(t);
  }
  var already = t.chunks.some(function(c) { return c.idx === index; });
  if (already) return true;
  t.chunks.push({ idx: index, data: String(data) });
  t.receivedChunks++;
  var maskArr = t.receivedMask.split('');
  if (index >= 0 && index < maskArr.length) maskArr[index] = '1';
  t.receivedMask = maskArr.join('');
  t.updatedAt = Date.now();
  if (t.receivedChunks >= t.totalChunks) t.status = 'complete';
  _persistTransfers(cid, transfers);
  return true;
}

export async function vaultGetTransfer(contactNexoId, transferId) {
  if (!contactNexoId || !transferId) return null;
  var cid = _normId(contactNexoId);
  var transfers = await _loadTransfers(cid);
  var t = transfers.find(function(tr) { return tr.transferId === transferId; });
  return t || null;
}

export async function vaultGetIncompleteTransfers(contactNexoId) {
  if (!contactNexoId) return [];
  var cid = _normId(contactNexoId);
  var transfers = await _loadTransfers(cid);
  return transfers.filter(function(t) { return t.status !== 'complete'; });
}

export async function vaultGetAllTransfers(contactNexoId) {
  if (!contactNexoId) return [];
  return _loadTransfers(_normId(contactNexoId));
}

export async function vaultCompleteTransfer(contactNexoId, transferId) {
  if (!contactNexoId || !transferId) return null;
  var cid = _normId(contactNexoId);
  var transfers = await _loadTransfers(cid);
  var idx = transfers.findIndex(function(t) { return t.transferId === transferId; });
  if (idx < 0) return null;
  var t = transfers[idx];
  if (t.status !== 'complete' && t.receivedChunks < t.totalChunks) {
    console.warn('[VaultManager] CompleteTransfer: incompleta', transferId, t.receivedChunks + '/' + t.totalChunks);
    return null;
  }
  t.chunks.sort(function(a, b) { return a.idx - b.idx; });
  var assembled = '';
  for (var i = 0; i < t.chunks.length; i++) {
    assembled += t.chunks[i].data || '';
  }
  var msg = {
    msgId: t.transferId,
    messageId: t.transferId,
    text: assembled,
    content: assembled,
    senderNexoId: t.senderNexoId || (t.meta && t.meta.from) || '',
    senderName: (t.meta && t.meta.fromName) || (t.meta && t.meta.senderName) || 'NEXO',
    timestamp: (t.meta && t.meta.ts) ? t.meta.ts : t.createdAt,
    seq: (t.meta && typeof t.meta.seq === 'number') ? t.meta.seq : 0,
    status: 'delivered',
    _own: false,
    type: t.type === 'file' ? 'file' : 'text',
    attachmentType: null,
    attachmentPayload: null,
    attachmentMeta: null
  };
  if (t.type === 'file') {
    msg.attachmentPayload = assembled;
    msg.text = '[Archivo]';
    msg.content = '[Archivo]';
    msg.attachmentMeta = {
      fileName: (t.meta && t.meta.fileName) ? t.meta.fileName : 'archivo',
      mimeType: (t.meta && t.meta.mimeType) ? t.meta.mimeType : 'application/octet-stream',
      totalSize: (t.meta && t.meta.totalSize) ? t.meta.totalSize : assembled.length,
      checksum: (t.meta && t.meta.checksum) ? t.meta.checksum : ''
    };
  }
  await vaultAppendMessage(contactNexoId, msg);
  transfers.splice(idx, 1);
  _persistTransfers(cid, transfers);
  console.log('[VaultManager] Transferencia completada y movida al historial:', transferId);
  return msg;
}

export async function vaultCancelTransfer(contactNexoId, transferId) {
  if (!contactNexoId || !transferId) return false;
  var cid = _normId(contactNexoId);
  var transfers = await _loadTransfers(cid);
  var idx = transfers.findIndex(function(t) { return t.transferId === transferId; });
  if (idx < 0) return false;
  transfers.splice(idx, 1);
  _persistTransfers(cid, transfers);
  return true;
}

export async function vaultCleanupTransfers(contactNexoId, maxAgeMs) {
  if (!contactNexoId) return 0;
  var cid = _normId(contactNexoId);
  var transfers = await _loadTransfers(cid);
  var now = Date.now();
  var limit = maxAgeMs || 86400000;
  var before = transfers.length;
  transfers = transfers.filter(function(t) {
    var age = now - (t.updatedAt || t.createdAt || 0);
    var expired = t.expiresAt && t.expiresAt < now;
    return age < limit && !expired;
  });
  var removed = before - transfers.length;
  if (removed > 0) _persistTransfers(cid, transfers);
  return removed;
}

// ========== D2: OUTGOING TRANSFER REGISTRY (Block ACK emisor) ==========

function _outgoingFileName(contactNexoId) {
  return VAULT_OUTGOING_PREFIX + _normId(contactNexoId) + '.json';
}

async function _loadOutgoingTransfers(contactNexoId) {
  if (!contactNexoId) return [];
  var cid = _normId(contactNexoId);
  var cached = _outgoingCache.get(cid);
  if (cached !== undefined) return cached.slice();
  var plugin = _nativePlugin();
  if (!plugin) return [];
  try {
    var result = await _safeNativeCall(plugin, 'loadFromFile', { filename: _outgoingFileName(cid) });
    if (result && result.exists && result.content) {
      var data = JSON.parse(result.content);
      var out = Array.isArray(data.outgoing) ? data.outgoing : [];
      _outgoingCache.set(cid, out.slice());
      return out;
    }
  } catch (e) {}
  return [];
}

function _persistOutgoingTransfers(contactNexoId, outgoing) {
  var plugin = _nativePlugin();
  if (!plugin) return;
  var cid = _normId(contactNexoId);
  var toSave = outgoing.slice(-50); // máx 50 envíos activos por contacto
  _outgoingCache.set(cid, toSave.slice());
  _safeNativeCall(plugin, 'saveToFile', {
    filename: _outgoingFileName(cid),
    content: JSON.stringify({ outgoing: toSave, savedAt: Date.now() })
  }).catch(function(e) {});
}

/**
 * Crea registro de envío (emisor). Guarda chunks completos para reenvío tras reinicio.
 */
export async function vaultCreateOutgoingTransfer(contactNexoId, transferId, type, totalChunks, chunks, meta, deviceId) {
  if (!contactNexoId || !transferId || !type || !totalChunks || !chunks) return null;
  var cid = _normId(contactNexoId);
  var outgoing = await _loadOutgoingTransfers(cid);
  var existing = outgoing.find(function(o) { return o.transferId === transferId; });
  if (existing) return existing;
  var now = Date.now();
  var mask = [];
  for (var i = 0; i < totalChunks; i++) mask.push('0');
  var zeroMask = mask.join('');
  var record = {
    transferId: transferId,
    type: type,
    status: 'sending',
    totalChunks: totalChunks,
    chunks: chunks.slice(),
    sentMask: zeroMask,
    ackMask: zeroMask,
    meta: meta || {},
    deviceId: deviceId || '',
    createdAt: now,
    updatedAt: now,
    expiresAt: now + 86400000,
    blockAckTimeouts: 0
  };
  outgoing.push(record);
  _persistOutgoingTransfers(cid, outgoing);
  return record;
}

/**
 * Actualiza máscaras de envío y ACK. sentMask y ackMask son strings '1010...'.
 */
export async function vaultSetOutgoingChunkAcked(contactNexoId, transferId, sentMask, ackMask) {
  if (!contactNexoId || !transferId) return false;
  var cid = _normId(contactNexoId);
  var outgoing = await _loadOutgoingTransfers(cid);
  var o = outgoing.find(function(x) { return x.transferId === transferId; });
  if (!o) return false;
  if (sentMask !== undefined) o.sentMask = sentMask;
  if (ackMask !== undefined) o.ackMask = ackMask;
  o.updatedAt = Date.now();
  _persistOutgoingTransfers(cid, outgoing);
  return true;
}

export async function vaultIncrementOutgoingTimeout(contactNexoId, transferId) {
  if (!contactNexoId || !transferId) return false;
  var cid = _normId(contactNexoId);
  var outgoing = await _loadOutgoingTransfers(cid);
  var o = outgoing.find(function(x) { return x.transferId === transferId; });
  if (!o) return false;
  o.blockAckTimeouts = (o.blockAckTimeouts || 0) + 1;
  o.updatedAt = Date.now();
  _persistOutgoingTransfers(cid, outgoing);
  return true;
}

export async function vaultGetOutgoingTransfer(contactNexoId, transferId) {
  if (!contactNexoId || !transferId) return null;
  var cid = _normId(contactNexoId);
  var outgoing = await _loadOutgoingTransfers(cid);
  return outgoing.find(function(o) { return o.transferId === transferId; }) || null;
}

export async function vaultGetPendingOutgoingTransfers(contactNexoId) {
  if (!contactNexoId) return [];
  var cid = _normId(contactNexoId);
  var outgoing = await _loadOutgoingTransfers(cid);
  return outgoing.filter(function(o) { return o.status !== 'complete' && o.status !== 'failed'; });
}

export async function vaultRemoveOutgoingTransfer(contactNexoId, transferId) {
  if (!contactNexoId || !transferId) return false;
  var cid = _normId(contactNexoId);
  var outgoing = await _loadOutgoingTransfers(cid);
  var idx = outgoing.findIndex(function(o) { return o.transferId === transferId; });
  if (idx < 0) return false;
  outgoing.splice(idx, 1);
  _persistOutgoingTransfers(cid, outgoing);
  return true;
}

export async function vaultSetOutgoingStatus(contactNexoId, transferId, status) {
  if (!contactNexoId || !transferId) return false;
  var cid = _normId(contactNexoId);
  var outgoing = await _loadOutgoingTransfers(cid);
  var o = outgoing.find(function(x) { return x.transferId === transferId; });
  if (!o) return false;
  o.status = status;
  o.updatedAt = Date.now();
  _persistOutgoingTransfers(cid, outgoing);
  return true;
}

export async function vaultCleanupOutgoingTransfers(contactNexoId, maxAgeMs) {
  if (!contactNexoId) return 0;
  var cid = _normId(contactNexoId);
  var outgoing = await _loadOutgoingTransfers(cid);
  var now = Date.now();
  var limit = maxAgeMs || 86400000;
  var before = outgoing.length;
  outgoing = outgoing.filter(function(o) {
    var age = now - (o.updatedAt || o.createdAt || 0);
    var expired = o.expiresAt && o.expiresAt < now;
    return age < limit && !expired;
  });
  var removed = before - outgoing.length;
  if (removed > 0) _persistOutgoingTransfers(cid, outgoing);
  return removed;
}
