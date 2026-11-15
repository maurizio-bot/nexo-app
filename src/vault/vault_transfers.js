import { VAULT_TRANSFERS_PREFIX, _normId, _transferCache, _nativePlugin, _safeNativeCall, _msgCache, VAULT_OUTGOING_PREFIX, _outgoingCache, _withOutLock } from './vault_shared.js';
import { vaultLoadMessages, vaultAppendMessage } from './vault_messages.js';
// vault_manager.js — TRANSFERENCIAS: archivos que llegan a trozos y registro de los que salen.
// Reestructuración 15-11: movido TAL CUAL desde vault_manager.js (que lo sigue exportando).
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
  var toSave = transfers.slice(-100);
  _transferCache.set(cid, toSave.slice());
  _safeNativeCall(plugin, 'saveToFile', {
    filename: _transferFileName(cid),
    content: JSON.stringify({ transfers: toSave, savedAt: Date.now() })
  }).catch(function(e) { console.warn('[VaultManager] fallo al guardar transferencias (R2) de ' + cid + ': ' + ((e && e.message) || e)); }); // R2: no tragar en silencio
}
export async function vaultCreateTransfer(contactNexoId, transferId, type, totalChunks, meta) {
  if (!contactNexoId || !transferId || !type || !totalChunks) return null;
  // Robustez (auditoría 2805, misma clase que el DoS de ble_ack.js): un totalChunks disparatado haría un array/
  // cadena de miles de millones (congelación/OOM). Igual que MAX_CHUNKS: el mensaje más grande son ~158k trozos.
  if (totalChunks > 300000) return null;
  var cid = _normId(contactNexoId);
  var transfers = await _loadTransfers(cid);
  var existing = transfers.find(function(t) { return t.transferId === transferId; });
  if (existing) return existing;
  var now = Date.now();
  var maskArr = [];
  for (var i = 0; i < totalChunks; i++) maskArr.push('0');
  var transfer = {
    transferId: transferId, type: type, status: 'receiving',
    totalChunks: totalChunks, receivedChunks: 0, receivedMask: maskArr.join(''),
    chunks: [], meta: meta || {},
    senderNexoId: (meta && meta.senderNexoId) ? meta.senderNexoId : ((meta && meta.from) ? meta.from : ''),
    createdAt: now, updatedAt: now, expiresAt: now + 86400000
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
    if (!totalChunks || totalChunks <= 0) return false;
    if (totalChunks > 300000) return false; // Robustez 2805: mismo tope que MAX_CHUNKS (evita array/cadena gigante → ANR)
    var now = Date.now();
    var maskArr = [];
    for (var i = 0; i < totalChunks; i++) maskArr.push('0');
    t = {
      transferId: transferId, type: 'chat', status: 'receiving',
      totalChunks: totalChunks, receivedChunks: 0, receivedMask: maskArr.join(''),
      chunks: [], meta: meta || {}, senderNexoId: cid,
      createdAt: now, updatedAt: now, expiresAt: now + 86400000
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
  return transfers.find(function(tr) { return tr.transferId === transferId; }) || null;
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
  for (var i = 0; i < t.chunks.length; i++) assembled += t.chunks[i].data || '';
  var msg = {
    msgId: t.transferId, messageId: t.transferId,
    text: assembled, content: assembled,
    senderNexoId: t.senderNexoId || (t.meta && t.meta.from) || '',
    senderName: (t.meta && t.meta.fromName) || (t.meta && t.meta.senderName) || 'NEXO',
    timestamp: (t.meta && t.meta.ts) ? t.meta.ts : t.createdAt,
    seq: (t.meta && typeof t.meta.seq === 'number') ? t.meta.seq : 0,
    status: 'delivered', _own: false,
    type: t.type === 'file' ? 'file' : 'text',
    attachmentType: null, attachmentPayload: null, attachmentMeta: null
  };
  if (t.type === 'file') {
    msg.attachmentPayload = assembled; msg.text = '[Archivo]'; msg.content = '[Archivo]';
    msg.attachmentMeta = {
      fileName: (t.meta && t.meta.fileName) ? t.meta.fileName : 'archivo',
      mimeType: (t.meta && t.meta.mimeType) ? t.meta.mimeType : 'application/octet-stream',
      totalSize: (t.meta && t.meta.totalSize) ? t.meta.totalSize : assembled.length,
      checksum: (t.meta && t.meta.checksum) ? t.meta.checksum : ''
    };
  }
  // FIX v2.2.3: main.js ya guarda el adjunto completo (fileComplete); no pisarlo con '[Archivo]'
  var currentMsgs = _msgCache.has(cid) ? _msgCache.get(cid) : (await vaultLoadMessages(cid));
  var alreadySaved = currentMsgs.some(function(m) { return m.msgId === t.transferId; });
  if (!alreadySaved) await vaultAppendMessage(contactNexoId, msg);
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
function _outgoingFileName(contactNexoId) {
  return VAULT_OUTGOING_PREFIX + _normId(contactNexoId) + '.json';
}
// 3004 (investigación de fondo 11-11, cierre del S24 con un APK de 25,9 MB): el registro de salientes de un contacto es UN
// archivo JSON que se reescribe ENTERO por el puente de Capacitor en cada cambio. Con el contenido de un archivo grande dentro
// (35 M caracteres por APK; 71 M con dos) el nativo lo analiza en el hilo principal y la app muere sin rastro (OutOfMemoryError,
// MessageHandler.java:54). Regla: el contenido de un ARCHIVO DEL USUARIO (id msg… sin sufijo) que no quepa en OUT_INLINE_MAX
// caracteres NO se guarda aquí: ya está en su adjunto (nexo_att_…) y en el historial como pendiente, y lo reenvía el reenvío de
// pendientes. Los registros así que ya existan en el teléfono se purgan al leer, igual que los caducados (expiresAt, que se
// escribía y nunca se aplicaba).
export var OUT_INLINE_MAX = 2000000;
function _isUserFileTransferId(id) { return /^msg[0-9a-z]+$/i.test(String(id || '')); }
function _chunksChars(chunks) {
  var n = 0;
  (chunks || []).forEach(function(c) { n += String(typeof c === 'string' ? c : ((c && (c.data || c.d)) || '')).length; });
  return n;
}
function _purgeOutgoing(cid, list) {
  var now = Date.now(), keep = [], drop = [];
  list.forEach(function(o) {
    if (!o) return;
    var big = o.type === 'file' && _isUserFileTransferId(o.transferId) && _chunksChars(o.chunks) > OUT_INLINE_MAX;
    var expired = o.expiresAt && o.expiresAt < now;
    if (big || expired) drop.push((big ? 'grande ' : 'caducado ') + String(o.transferId || '?').slice(-10)); else keep.push(o);
  });
  if (drop.length) console.log('[VaultManager] Salientes de ' + cid + ': se quitan ' + drop.length + ' registro(s) (' + drop.join(', ') + '); los archivos siguen pendientes en el historial');
  return { keep: keep, purged: drop.length };
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
      var pg = _purgeOutgoing(cid, out);
      if (pg.purged) { _persistOutgoingTransfers(cid, pg.keep); return pg.keep.slice(); }
      _outgoingCache.set(cid, out.slice());
      return out;
    }
  } catch (e) {
    console.warn('[VaultManager] No se pudo leer el registro de salientes de ' + cid + ' (' + ((e && e.message) || e) + '): se trata como vacío');
  }
  return [];
}
function _persistOutgoingTransfers(contactNexoId, outgoing) {
  var plugin = _nativePlugin();
  if (!plugin) return;
  var cid = _normId(contactNexoId);
  var toSave = outgoing.slice(-50);
  _outgoingCache.set(cid, toSave.slice());
  _safeNativeCall(plugin, 'saveToFile', {
    filename: _outgoingFileName(cid),
    content: JSON.stringify({ outgoing: toSave, savedAt: Date.now() })
  }).catch(function(e) { console.warn('[VaultManager] fallo al guardar transferencias salientes (R2) de ' + cid + ': ' + ((e && e.message) || e)); }); // R2: no tragar en silencio
}
export async function vaultCreateOutgoingTransfer(contactNexoId, transferId, type, totalChunks, chunks, meta, deviceId) {
  if (!contactNexoId || !transferId || !type || !totalChunks || !chunks) return null;
  var cid = _normId(contactNexoId);
  // 3004: un archivo grande del usuario no entra en el registro (ver OUT_INLINE_MAX): lo cubre el reenvío de pendientes
  if (type === 'file' && _isUserFileTransferId(transferId) && _chunksChars(chunks) > OUT_INLINE_MAX) return null;
  return _withOutLock(cid, async function() {
    var outgoing = await _loadOutgoingTransfers(cid);
    var existing = outgoing.find(function(o) { return o.transferId === transferId; });
    if (existing) return existing;
    var now = Date.now();
    var mask = [];
    for (var i = 0; i < totalChunks; i++) mask.push('0');
    var zeroMask = mask.join('');
    var record = {
      transferId: transferId, type: type, status: 'sending',
      totalChunks: totalChunks, chunks: chunks.slice(),
      sentMask: zeroMask, ackMask: zeroMask,
      meta: meta || {}, deviceId: deviceId || '',
      createdAt: now, updatedAt: now, expiresAt: now + 86400000,
      blockAckTimeouts: 0
    };
    outgoing.push(record);
    _persistOutgoingTransfers(cid, outgoing);
    return record;
  });
}
export async function vaultSetOutgoingChunkAcked(contactNexoId, transferId, sentMask, ackMask) {
  if (!contactNexoId || !transferId) return false;
  var cid = _normId(contactNexoId);
  return _withOutLock(cid, async function() {
    var outgoing = await _loadOutgoingTransfers(cid);
    var o = outgoing.find(function(x) { return x.transferId === transferId; });
    if (!o) return false;
    if (sentMask !== undefined) o.sentMask = sentMask;
    if (ackMask !== undefined) o.ackMask = ackMask;
    o.updatedAt = Date.now();
    _persistOutgoingTransfers(cid, outgoing);
    return true;
  });
}
export async function vaultIncrementOutgoingTimeout(contactNexoId, transferId) {
  if (!contactNexoId || !transferId) return false;
  var cid = _normId(contactNexoId);
  return _withOutLock(cid, async function() {
    var outgoing = await _loadOutgoingTransfers(cid);
    var o = outgoing.find(function(x) { return x.transferId === transferId; });
    if (!o) return false;
    o.blockAckTimeouts = (o.blockAckTimeouts || 0) + 1;
    o.updatedAt = Date.now();
    _persistOutgoingTransfers(cid, outgoing);
    return true;
  });
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
  return _withOutLock(cid, async function() {
    var outgoing = await _loadOutgoingTransfers(cid);
    var idx = outgoing.findIndex(function(o) { return o.transferId === transferId; });
    if (idx < 0) return false;
    outgoing.splice(idx, 1);
    _persistOutgoingTransfers(cid, outgoing);
    return true;
  });
}
export async function vaultSetOutgoingStatus(contactNexoId, transferId, status) {
  if (!contactNexoId || !transferId) return false;
  var cid = _normId(contactNexoId);
  return _withOutLock(cid, async function() {
    var outgoing = await _loadOutgoingTransfers(cid);
    var o = outgoing.find(function(x) { return x.transferId === transferId; });
    if (!o) return false;
    o.status = status;
    o.updatedAt = Date.now();
    _persistOutgoingTransfers(cid, outgoing);
    return true;
  });
}
// 3004 — FRENO DE BUCLE DE ARRANQUE (investigación 11-11): si la app muere mientras manda un archivo grande, el mensaje sigue
// pendiente y cada arranque lo vuelve a intentar a los ~3 s, y vuelve a morir. Antes de cada intento grande se anota el intento
// (archivo pequeño, esperando a que llegue al disco) y al terminar el intento (bien o mal, sin morir) se borra. Si al arrancar un
// mensaje acumula BIGSEND_MAX_TRIES intentos sin terminar en los últimos BIGSEND_WINDOW_MS, no se reintenta solo: queda para que
// el usuario toque «reintentar» (que borra la cuenta).
export var BIGSEND_MIN_CHARS = 2000000;
export var BIGSEND_MAX_TRIES = 2;
export var BIGSEND_WINDOW_MS = 600000;

// Para las otras piezas de vault_manager.js
export { _loadOutgoingTransfers, _persistOutgoingTransfers };
