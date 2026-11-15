import { _nativePlugin, _safeNativeCall, _normId, _withOutLock } from './vault_shared.js';
import { BIGSEND_MAX_TRIES, BIGSEND_WINDOW_MS, _loadOutgoingTransfers, _persistOutgoingTransfers } from './vault_transfers.js';
// vault_manager.js — ARCHIVOS GRANDES: guarda de envío grande y trozos en disco por internet (bigx).
// Reestructuración 15-11: movido TAL CUAL desde vault_manager.js (que lo sigue exportando).
var BIGSEND_GUARD_FILE = 'nexo_bigsend_guard.json';
var _bigGuard = null, _bigGuardLoading = null;
function _bigGuardLoad() {
  if (_bigGuard) return Promise.resolve(_bigGuard);
  if (_bigGuardLoading) return _bigGuardLoading;
  var plugin = _nativePlugin();
  _bigGuardLoading = (plugin ? _safeNativeCall(plugin, 'loadFromFile', { filename: BIGSEND_GUARD_FILE }) : Promise.resolve(null))
    .then(function(r) { var g = {}; try { if (r && r.exists && r.content) g = JSON.parse(r.content) || {}; } catch (e) {} _bigGuard = g; return g; })
    .catch(function() { _bigGuard = {}; return _bigGuard; });
  return _bigGuardLoading;
}
function _bigGuardSave() {
  var plugin = _nativePlugin();
  if (!plugin || !_bigGuard) return Promise.resolve();
  var keys = Object.keys(_bigGuard);
  if (keys.length > 50) keys.sort(function(a, b) { return (_bigGuard[a].t || 0) - (_bigGuard[b].t || 0); }).slice(0, keys.length - 50).forEach(function(k) { delete _bigGuard[k]; });
  return _safeNativeCall(plugin, 'saveToFile', { filename: BIGSEND_GUARD_FILE, content: JSON.stringify(_bigGuard) }).catch(function() {});
}
// Pura (prueba bigsend.js): ¿este registro del freno bloquea el reintento automático ahora?
export function bigSendBlocked(entry, now) {
  return !!entry && (entry.n || 0) >= BIGSEND_MAX_TRIES && (now - (entry.t || 0)) < BIGSEND_WINDOW_MS;
}
export function vaultBigSendBegin(msgId) {
  if (!msgId) return Promise.resolve(0);
  return _bigGuardLoad().then(function(g) {
    var now = Date.now(), e = g[msgId];
    if (!e || now - (e.t || 0) >= BIGSEND_WINDOW_MS) e = { n: 0 };
    e.n = (e.n || 0) + 1; e.t = now; g[msgId] = e;
    return _bigGuardSave().then(function() { return e.n; });
  });
}
export function vaultBigSendEnd(msgId) {
  if (!msgId) return Promise.resolve();
  return _bigGuardLoad().then(function(g) { if (g[msgId]) { delete g[msgId]; return _bigGuardSave(); } });
}
// Devuelve el conjunto de ids que NO deben reintentarse solos ahora
export function vaultBigSendBlockedIds() {
  return _bigGuardLoad().then(function(g) {
    var now = Date.now(), out = new Set();
    Object.keys(g).forEach(function(k) { if (bigSendBlocked(g[k], now)) out.add(k); });
    return out;
  });
}
// ── 3007 (dueño 11-11, «(a) aquí está mi OK»): ARCHIVO GRANDE POR INTERNET QUE SIGUE DONDE IBA ─────────────────────────────
// Antes, si el envío de un archivo grande por internet se cortaba más de 30 min o se reiniciaba la app de cualquiera de los dos,
// el siguiente intento se volvía a cifrar (marca 'a' distinta) y el receptor empezaba de CERO. Ahora, en el teléfono:
//  · el que ENVÍA guarda el contenido YA CIFRADO en rebanadas de BIGX_SLICE_CHARS + su marca 'a' y la meta (índice
//    nexo_bigx_out.json); al reanudar usa exactamente eso (mismos trozos, misma marca) sin releer ni volver a cifrar el adjunto;
//  · el que RECIBE guarda cada bloque completo de trozos (BIGX_BLOCK) + un índice (nexo_bigx_in.json); tras reiniciarse
//    rehace lo recibido desde el disco y lo confirma, así el que envía salta lo que ya llegó.
// Todo por el puente en piezas pequeñas (~1 MB): nunca un archivo entero de una vez (lección de la 3004). Caducan a las 48 h.
export var BIGX_SLICE_CHARS = 1000000;
export var BIGX_BLOCK = 64;
export var BIGX_TTL_MS = 48 * 3600 * 1000;
var BIGX_OUT_INDEX = 'nexo_bigx_out.json', BIGX_IN_INDEX = 'nexo_bigx_in.json';
var _bigx = { out: null, inn: null, loading: null };
var _bigxQ = Promise.resolve();
function _bigxSerial(fn) { var p = _bigxQ.then(fn, fn); _bigxQ = p.catch(function() {}); return p; }
function _bigxSafeId(id) { return String(id || '').replace(/[^0-9a-z_#-]/gi, '').replace(/#/g, '_').substring(0, 80); }
// Con prefijo nexo_att_ para que el nativo los lea/escriba en el hilo de los adjuntos (ioBig), no en el del historial y las claves
export function bigxSliceName(id, k) { return 'nexo_att_bigxo_' + _bigxSafeId(id) + '_' + k + '.dat'; }
export function bigxBlockName(id, k) { return 'nexo_att_bigxi_' + _bigxSafeId(id) + '_' + k + '.dat'; }
function _bigxDel(name) { var pl = _nativePlugin(); if (pl) _safeNativeCall(pl, 'deleteFile', { filename: name }).catch(function() {}); }
async function _bigxReadIndex(name) {
  var pl = _nativePlugin(); if (!pl) return {};
  try { var r = await _safeNativeCall(pl, 'loadFromFile', { filename: name }); var o = (r && r.exists && r.content) ? JSON.parse(r.content) : {}; return (o && typeof o === 'object') ? o : {}; } catch (e) { return {}; }
}
function _bigxWriteIndex(name, map) {
  var pl = _nativePlugin(); if (!pl) return Promise.resolve(false);
  return _safeNativeCall(pl, 'saveToFile', { filename: name, content: JSON.stringify(map) }).then(function(r) { return !(r && r.frozen); }, function() { return false; });
}
function _bigxDropOutFiles(id, rec) { var n = (rec && rec.slices) || 0; for (var k = 0; k < n; k++) _bigxDel(bigxSliceName(id, k)); }
function _bigxDropInFiles(id, rec) { ((rec && rec.blocks) || []).forEach(function(k) { _bigxDel(bigxBlockName(id, k)); }); }
// Carga (una vez) los dos índices y tira lo caducado. Se llama al arrancar; las consultas síncronas (vaultBigxOutHas) responden
// «no» hasta que termina (entonces el envío sale como siempre: correcto, solo sin reanudar).
export function vaultBigxInit() {
  if (_bigx.loading) return _bigx.loading;
  _bigx.loading = _bigxSerial(async function() {
    // Sin el plugin nativo todavía (muy al principio): no se cachea un índice vacío que luego pisaría el de verdad
    if (!_nativePlugin()) { _bigx.loading = null; return false; }
    var now = Date.now(), out = await _bigxReadIndex(BIGX_OUT_INDEX), inn = await _bigxReadIndex(BIGX_IN_INDEX), dO = 0, dI = 0;
    Object.keys(out).forEach(function(id) { var r = out[id]; if (!r || !(now - (r.t || 0) < BIGX_TTL_MS)) { _bigxDropOutFiles(id, r); delete out[id]; dO++; } });
    Object.keys(inn).forEach(function(id) { var r = inn[id]; if (!r || !(now - (r.t || 0) < BIGX_TTL_MS)) { _bigxDropInFiles(id, r); delete inn[id]; dI++; } });
    _bigx.out = out; _bigx.inn = inn;
    if (dO) await _bigxWriteIndex(BIGX_OUT_INDEX, out);
    if (dI) await _bigxWriteIndex(BIGX_IN_INDEX, inn);
    if (dO || dI) console.log('[VAULT] Archivos grandes a medias caducados (48 h): ' + dO + ' de salida, ' + dI + ' de entrada');
    return true;
  });
  return _bigx.loading;
}
export function vaultBigxOutHas(id) { return !!(_bigx.out && id && _bigx.out[id]); }
// Guarda el contenido cifrado de un envío grande (rebanada a rebanada, de una en una) y, al final, su ficha en el índice.
export function vaultBigxOutPut(id, info, content) {
  if (!id || typeof content !== 'string' || !content.length) return Promise.resolve(false);
  return vaultBigxInit().then(function() { return _bigxSerial(async function() {
    if (!_bigx.out) return false;
    if (_bigx.out[id] && _bigx.out[id].len === content.length && _bigx.out[id].att === info.att) return true;
    var prev = _bigx.out[id];
    if (prev) { delete _bigx.out[id]; await _bigxWriteIndex(BIGX_OUT_INDEX, _bigx.out); _bigxDropOutFiles(id, prev); }
    var pl = _nativePlugin(); if (!pl) return false;
    var n = Math.ceil(content.length / BIGX_SLICE_CHARS);
    for (var k = 0; k < n; k++) {
      var r = await _safeNativeCall(pl, 'saveToFile', { filename: bigxSliceName(id, k), content: content.substring(k * BIGX_SLICE_CHARS, (k + 1) * BIGX_SLICE_CHARS) }).catch(function() { return { frozen: true }; });
      if (r && r.frozen) { for (var j = 0; j <= k; j++) _bigxDel(bigxSliceName(id, j)); return false; }
    }
    _bigx.out[id] = { att: info.att, cid: info.cid || '', meta: info.meta || {}, len: content.length, slices: n, t: Date.now() };
    var ok = await _bigxWriteIndex(BIGX_OUT_INDEX, _bigx.out);
    if (ok) console.log('[VAULT] ' + id + ': envío grande guardado en el teléfono para seguir donde iba (' + n + ' partes)');
    return ok;
  }); });
}
// Devuelve { rec, content } o null (y lo tira) si falta alguna rebanada.
export function vaultBigxOutGet(id) {
  return vaultBigxInit().then(function() {
    var rec = _bigx.out && _bigx.out[id]; if (!rec) return null;
    var pl = _nativePlugin(); if (!pl) return null;
    var parts = [], k = 0;
    var next = function() {
      if (k >= rec.slices) { var c = parts.join(''); return (c.length === rec.len) ? { rec: rec, content: c } : null; }
      return _safeNativeCall(pl, 'loadFromFile', { filename: bigxSliceName(id, k) }).then(function(r) {
        if (!(r && r.exists && typeof r.content === 'string')) return null;
        parts.push(r.content); k++; return next();
      });
    };
    return next().catch(function() { return null; }).then(function(x) { if (!x) { console.warn('[VAULT] ' + id + ': el envío grande guardado está incompleto: se descarta'); vaultBigxOutDrop(id); } return x; });
  });
}
export function vaultBigxOutDrop(id) {
  return vaultBigxInit().then(function() { return _bigxSerial(async function() {
    var rec = _bigx.out && _bigx.out[id]; if (!rec) return false;
    delete _bigx.out[id]; await _bigxWriteIndex(BIGX_OUT_INDEX, _bigx.out); _bigxDropOutFiles(id, rec); return true;
  }); });
}
// Recepción: copia del índice (para rehacer lo recibido al arrancar) y alta de un bloque completo.
export function vaultBigxInIndex() { return vaultBigxInit().then(function() { return Object.assign({}, _bigx.inn || {}); }); }
export function vaultBigxInPutBlock(id, k, chunks, info) {
  if (!id || !Array.isArray(chunks)) return Promise.resolve(false);
  return vaultBigxInit().then(function() { return _bigxSerial(async function() {
    if (!_bigx.inn) return false;
    var rec = _bigx.inn[id];
    if (rec && (rec.a !== info.a || rec.total !== info.total)) { delete _bigx.inn[id]; _bigxDropInFiles(id, rec); rec = null; }
    var pl = _nativePlugin(); if (!pl) return false;
    var r = await _safeNativeCall(pl, 'saveToFile', { filename: bigxBlockName(id, k), content: JSON.stringify(chunks) }).catch(function() { return { frozen: true }; });
    if (r && r.frozen) return false;
    rec = _bigx.inn[id] || { a: info.a, total: info.total, meta: info.meta || {}, from: info.from || '', blocks: [] };
    if (rec.blocks.indexOf(k) < 0) rec.blocks.push(k);
    rec.t = Date.now();
    _bigx.inn[id] = rec;
    return _bigxWriteIndex(BIGX_IN_INDEX, _bigx.inn);
  }); });
}
export function vaultBigxInGetBlock(id, k) {
  var pl = _nativePlugin(); if (!pl) return Promise.resolve(null);
  return _safeNativeCall(pl, 'loadFromFile', { filename: bigxBlockName(id, k) }).then(function(r) {
    if (!(r && r.exists && r.content)) return null;
    var a = JSON.parse(r.content); return Array.isArray(a) ? a : null;
  }).catch(function() { return null; });
}
export function vaultBigxInDrop(id) {
  return vaultBigxInit().then(function() { return _bigxSerial(async function() {
    var rec = _bigx.inn && _bigx.inn[id]; if (!rec) return false;
    delete _bigx.inn[id]; await _bigxWriteIndex(BIGX_IN_INDEX, _bigx.inn); _bigxDropInFiles(id, rec); return true;
  }); });
}

export async function vaultCleanupOutgoingTransfers(contactNexoId, maxAgeMs) {
  if (!contactNexoId) return 0;
  var cid = _normId(contactNexoId);
  return _withOutLock(cid, async function() {
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
  });
}
