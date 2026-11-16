import { _nativePlugin, _safeNativeCall, VAULT_MESSAGES_PREFIX, _normId, _msgCache, _msgLoading, _withMsgLock } from './vault_shared.js';
import { _vaultContacts, _getContactIdentity } from './vault_contacts.js';
import { vaultBigxOutDrop, vaultBigxInDrop } from './vault_big.js';
// vault_manager.js — MENSAJES y adjuntos: cargar, guardar, estados, editar, borrar, miniaturas.
// Reestructuración 15-11: movido TAL CUAL desde vault_manager.js (que lo sigue exportando).
// v2.3.0: los adjuntos grandes van en su propio archivo (nexo_att_<msgId>.b64) y el historial guarda
// solo 'attachmentRef'. Antes cada foto iba DOS veces dentro del JSON del historial (payload y
// content) y cada cambio de estado reescribía todas las fotos del chat: la app se congelaba.
var ATT_INLINE_LIMIT = 2048;
var _pendingAttachments = Object.create(null);
 // ref -> payload mientras se escribe a disco
function _attFileName(msgId) {
  return 'nexo_att_' + String(msgId).replace(/[^A-Za-z0-9_-]/g, '_') + '.b64';
}
// Saca el payload grande del mensaje (sin await: no abrir carreras de lectura-escritura del historial)
function _externalizeAttachment(m, existing) {
  // 2987: el mensaje dibujado con miniatura (thumbOnly) jamás pisa el original: se descarta la miniatura y se conserva la referencia
  if (m && m.attachmentMeta && (m.attachmentMeta.thumbOnly || m.attachmentMeta.lazyRef)) {
    var mm = Object.assign({}, m.attachmentMeta); delete mm.thumbOnly; delete mm.fullRef; delete mm.lazyRef;
    m.attachmentMeta = mm; m.attachmentPayload = null;
    return false;
  }
  if (!m || !m.attachmentPayload || typeof m.attachmentPayload !== 'string' || m.attachmentPayload.length <= ATT_INLINE_LIMIT) return false;
  var ref = (existing && existing.attachmentRef) || m.attachmentRef || _attFileName(m.msgId);
  if (!(existing && existing.attachmentRef)) {
    var payload = m.attachmentPayload;
    var plugin = _nativePlugin();
    _pendingAttachments[ref] = payload;
    if (plugin) {
      _safeNativeCall(plugin, 'saveToFile', { filename: ref, content: payload })
        // Auditoría #6: durante «pasar la cuenta» saveToFile resuelve {frozen:true} SIN escribir → NO darlo por guardado
        // (si no, se borraría la copia en memoria y el adjunto se perdería si la migración falla). Se mantiene pendiente.
        .then(function(r) { if (r && r.frozen) return; delete _pendingAttachments[ref]; })
        .catch(function(e) { console.warn('[VaultManager] No se pudo guardar adjunto', ref, e && e.message); });
    }
  }
  m.attachmentRef = ref;
  m.attachmentPayload = null;
  if (typeof m.content === 'string' && m.content.indexOf('"payload"') >= 0) { m.content = '[adjunto]'; m.text = '[adjunto]'; }
  return true;
}
// Devuelve copias de los mensajes con el payload del adjunto cargado (para dibujar o reenviar)
export async function vaultHydrateAttachments(messages, opts) {
  var list = Array.isArray(messages) ? messages : [];
  var plugin = _nativePlugin();
  var preferHd = !!(opts && opts.preferHd);
  var out = [];
  for (var i = 0; i < list.length; i++) {
    var m = list[i];
    // Vídeo propio con original guardado: para verlo se usa el HD (lo enviado como mensaje es la previa)
    var ref = (preferHd && m && m.hdRef) ? m.hdRef : (m && m.attachmentRef);
    if (!m || !ref || (m.attachmentPayload && ref === m.attachmentRef)) { out.push(m); continue; }
    var copy = Object.assign({}, m);
    // 2987: FOTO (no «ver una vez») al dibujar el chat → solo su miniatura; el original se carga al tocarla (render.js)
    var wantThumb = !!(opts && opts.thumbs) && m.attachmentType === 'image' && ref === m.attachmentRef && !(m.attachmentMeta && m.attachmentMeta.once) && !_thumbFailed[vaultThumbFileName(m.msgId || m.messageId || m.id)];
    if (wantThumb) {
      var th = await _thumbLoad(vaultThumbFileName(m.msgId || m.messageId || m.id));
      if (th) { copy.attachmentPayload = th; copy.attachmentMeta = Object.assign({}, m.attachmentMeta || {}, { thumbOnly: true, fullRef: ref }); out.push(copy); continue; }
    }
    if (ref === m.hdRef && m.hdMime) copy.attachmentMeta = Object.assign({}, m.attachmentMeta || {}, { mime: m.hdMime });
    // 2988: VÍDEO con miniatura (meta.thumb) al dibujar el chat → NO se lee del disco (un vídeo son varios MB, ~420 ms cada uno en el diagnóstico
    // del dueño del 10-11); la burbuja solo muestra la miniatura. El vídeo (el original si es propio y lo guardó) se carga al TOCARLO (render.js).
    // 2988: ARCHIVO (tarjeta: PDF, zip, documentos…) → tampoco se lee al abrir; solo lo necesita al tocarlo. Un PDF sin miniatura aún sí se lee
    // (una vez) para sacarla; si ya la tiene o ya falló (meta.thumbFailed), no.
    var _fm = m.attachmentMeta || {}, _fmime = String(_fm.mime || _fm.type || '').toLowerCase(), _fisPdf = /pdf/.test(_fmime) || /\.pdf$/i.test(String(_fm.name || ''));
    if (opts && opts.thumbs && m.attachmentType === 'file' && ref === m.attachmentRef && _fm.size && !_fm.big && !_fm.cita && !_fm.once && !/^(image|video)/.test(_fmime) && (!_fisPdf || _fm.thumb || _fm.thumbFailed)) {
      copy.attachmentPayload = 'L';
      copy.attachmentMeta = Object.assign({}, _fm, { lazyRef: ref });
      out.push(copy); continue;
    }
    // 3163: un vídeo «ver una vez» tampoco se lee al abrir el chat (su burbuja no lo enseña; se lee del teléfono al tocarla, once_bubble.js)
    var _vOnce = !!(m.attachmentMeta && m.attachmentMeta.once);
    if (opts && opts.thumbs && m.attachmentType === 'video' && ref && !m.attachmentDisplayUrl && (_vOnce || !(m.attachmentMeta && !m.attachmentMeta.thumb))) {
      copy.attachmentPayload = 'L';
      copy.attachmentMeta = Object.assign({}, copy.attachmentMeta || m.attachmentMeta || {}, { lazyRef: ref });
      out.push(copy); continue;
    }
    var mem = _pendingAttachments[ref];
    if (mem) copy.attachmentPayload = mem;
    else if (plugin) {
      try {
        var r = await _safeNativeCall(plugin, 'loadFromFile', { filename: ref });
        if (r && r.exists && r.content) copy.attachmentPayload = r.content;
      } catch (e) {}
    }
    if (wantThumb && copy.attachmentPayload) _thumbCreate(m.msgId || m.messageId || m.id, copy.attachmentPayload, (m.attachmentMeta && m.attachmentMeta.format) || 'jpeg');
    out.push(copy);
  }
  return out;
}
function _msgFileName(contactNexoId) {
  return VAULT_MESSAGES_PREFIX + _normId(contactNexoId) + '.json';
}
// #dueño 02-11 (fluidez: «los chats con el tiempo tardan más en cargar»): el archivo completo (hasta 2000
// mensajes) se lee+descifra+parsea entero al abrir en frío (en el diagnóstico, «leyendo lento 800 ms»). Por eso
// mantenemos además un archivo de COLA pequeño con solo los últimos TAIL_N mensajes: al abrir se lee ESE (rápido)
// para pintar al instante, y el completo se carga perezosamente (al subir a ver anteriores o al enviar). El archivo
// completo sigue siendo la FUENTE DE VERDAD intacta (la cola es solo una caché aditiva: si falta o está dañada, se
// cae al completo sin perder nada).
var TAIL_N = 80;
 // un poco más que HISTORY_PAGE (60) de la interfaz, para que la 1.ª página entre entera
function _tailFileName(contactNexoId) {
  return VAULT_MESSAGES_PREFIX + _normId(contactNexoId) + '.tail.json';
}
function _writeTailFile(cid) {
  var plugin = _nativePlugin();
  var msgs = _msgCache.get(cid);
  if (!plugin || !msgs) return Promise.resolve();
  var tail = msgs.slice(-TAIL_N);
  return _safeNativeCall(plugin, 'saveToFile', {
    filename: _tailFileName(cid),
    content: JSON.stringify({ messages: tail, savedAt: Date.now(), tail: true })
  }).catch(function(e) {});
}
// Lectura RÁPIDA para pintar al instante: solo la cola. NO toca _msgCache (no es el historial completo; cachearlo
// como «completo» haría que un guardado posterior truncara el historial). Devuelve null si no hay archivo de cola
// (historial viejo aún sin migrar) → el llamador carga el completo como siempre.
export async function vaultLoadRecent(contactNexoId, limit) {
  if (!contactNexoId) return [];
  var cid = _normId(contactNexoId);
  var n = (typeof limit === 'number' && limit > 0) ? limit : TAIL_N;
  var cached = _msgCache.get(cid);
  if (cached !== undefined) return cached.slice(-n); // caché caliente: el completo ya está, usa su cola
  var plugin = _nativePlugin();
  if (!plugin) return null;
  try {
    var result = await _safeNativeCall(plugin, 'loadFromFile', { filename: _tailFileName(cid) });
    if (result && result.exists && result.content) {
      var data = JSON.parse(result.content);
      var msgs = Array.isArray(data.messages) ? data.messages : (Array.isArray(data) ? data : []);
      msgs.forEach(function(m) { var mid = m.msgId || m.messageId || m.id || ('msg_' + (m.timestamp || Date.now())); m.msgId = mid; m.messageId = mid; });
      // ordenar la cola (es chica, trivial) por si el orden de escritura no fuera perfecto
      msgs.sort(function(a, b) {
        var tsA = a.timestamp || 0, tsB = b.timestamp || 0;
        if (tsA !== tsB) return tsA - tsB;
        var seqA = (typeof a.seq === 'number') ? a.seq : 0, seqB = (typeof b.seq === 'number') ? b.seq : 0;
        if (seqA !== seqB) return seqA - seqB;
        return (a.msgId || '').localeCompare(b.msgId || '');
      });
      return msgs.slice(-n);
    }
    return null; // sin cola → cargar completo
  } catch (e) { return null; }
}

export async function vaultLoadMessages(contactNexoId) {
  if (!contactNexoId) return [];
  var cid = _normId(contactNexoId);
  var cached = _msgCache.get(cid);
  if (cached !== undefined) return cached.slice();
  if (_msgLoading.has(cid)) return (await _msgLoading.get(cid)).slice();
  var loading = _loadMessagesFromDisk(cid);
  _msgLoading.set(cid, loading);
  try { return (await loading).slice(); } finally { _msgLoading.delete(cid); }
}

async function _loadMessagesFromDisk(cid) {
  var plugin = _nativePlugin();
  if (!plugin) return [];
  try {
    var result = await _safeNativeCall(plugin, 'loadFromFile', { filename: _msgFileName(cid) });
    // Si mientras se leía alguien guardó (caché ya puesta), lo guardado es más nuevo que el archivo leído
    if (_msgCache.get(cid) !== undefined) return _msgCache.get(cid).slice();
    if (result && result.exists && result.content) {
      var data = JSON.parse(result.content);
      var msgs = Array.isArray(data.messages) ? data.messages : (Array.isArray(data) ? data : []);
      msgs.forEach(function(m) {
        var mid = m.msgId || m.messageId || m.id || ('msg_' + (m.timestamp || Date.now()));
        m.msgId = mid; m.messageId = mid;
      });
      // Migración: historiales antiguos con fotos dentro del JSON
      var migrated = false;
      msgs.forEach(function(m) { if (_externalizeAttachment(m, null)) migrated = true; });
      msgs.sort(function(a, b) {
        var tsA = a.timestamp || 0, tsB = b.timestamp || 0;
        if (tsA !== tsB) return tsA - tsB;
        var seqA = (typeof a.seq === 'number') ? a.seq : 0;
        var seqB = (typeof b.seq === 'number') ? b.seq : 0;
        if (seqA !== seqB) return seqA - seqB;
        return (a.msgId || '').localeCompare(b.msgId || '');
      });
      _msgCache.set(cid, msgs.slice());
      _writeTailFile(cid); // #fluidez: tras la 1.ª carga completa, dejar la cola lista → próximas aperturas instantáneas
      if (migrated) _persistMessages(cid, msgs);
      return msgs;
    }
    if (result && !result.exists) _msgCache.set(cid, []);
  } catch (e) {}
  return [];
}

// v2.3.4: la caché se actualiza al momento y el archivo se escribe agrupado (300 ms tras el último
// cambio de ese contacto). Antes cada mensaje y cada cambio de estado (enviado/entregado/leído)
// serializaba y escribía el historial entero. Se escribe ya si la app pasa a segundo plano o se cierra.
var _persistTimers = new Map();
var _msgRetry = new Map();
 // R2 (auditoría 03-11): cid -> {timer,tries} para reintentar una escritura de mensajes que FALLÓ (sin tragarse el error)
function _persistMessages(contactNexoId, messages, immediate) {
  var cid = _normId(contactNexoId);
  _msgCache.set(cid, messages.slice(-2000));
  // Un mensaje nuevo se escribe ya (durabilidad); los cambios de estado y duplicados, agrupados
  if (immediate) { _writeMessagesFile(cid); return; }
  if (_persistTimers.has(cid)) return;
  _persistTimers.set(cid, setTimeout(function() { _writeMessagesFile(cid); }, 300));
}
function _writeMessagesFile(cid) {
  var t = _persistTimers.get(cid);
  if (t) { clearTimeout(t); _persistTimers.delete(cid); }
  var plugin = _nativePlugin();
  var msgs = _msgCache.get(cid);
  if (!plugin || !msgs) return Promise.resolve();
  var p = _safeNativeCall(plugin, 'saveToFile', {
    filename: _msgFileName(cid),
    content: JSON.stringify({ messages: msgs, savedAt: Date.now() })
  }).then(function() {
    var rt = _msgRetry.get(cid); if (rt) { clearTimeout(rt.timer); _msgRetry.delete(cid); } // guardó bien: olvida el reintento
  }).catch(function(e) {
    // R2 (auditoría 03-11): NO tragar el fallo de escritura de mensajes (p.ej. la clave del Keystore un instante no
    // disponible). Antes el `.catch` vacío lo ocultaba → el mensaje se perdía al reiniciar SIN aviso. Ahora AVISA y
    // reintenta con backoff; los mensajes siguen en `_msgCache`, así que el reintento los recupera (nada se pierde en silencio).
    var rt = _msgRetry.get(cid) || { tries: 0, timer: null };
    rt.tries++; if (rt.timer) clearTimeout(rt.timer);
    if (rt.tries <= 5) {
      console.warn('[VaultManager] fallo al guardar mensajes de ' + cid + ' (intento ' + rt.tries + '): ' + ((e && e.message) || e) + ' → reintento');
      rt.timer = setTimeout(function() { _writeMessagesFile(cid); }, Math.min(500 * rt.tries, 4000));
      _msgRetry.set(cid, rt);
    } else {
      console.error('[VaultManager] NO se pudieron guardar los mensajes de ' + cid + ' tras varios reintentos; quedan en memoria y se reintentará con el próximo mensaje');
      _msgRetry.delete(cid);
    }
  });
  _writeTailFile(cid); // #fluidez: cola pequeña para abrir rápido (aditiva; el completo es la fuente de verdad)
  return p;
}
function _flushPendingWrites() {
  return Promise.all(Array.from(_persistTimers.keys()).map(_writeMessagesFile));
}

export async function vaultSaveMessages(contactNexoId, messages) {
  if (!contactNexoId) return false;
  var cid = _normId(contactNexoId);
  return _withMsgLock(cid, function() { return _saveMessagesNow(cid, messages); });
}
async function _saveMessagesNow(cid, messages) {
  var toSave = messages.slice(-2000);
  _msgCache.set(cid, toSave.slice());
  var plugin = _nativePlugin();
  if (!plugin) return false;
  try {
    await _safeNativeCall(plugin, 'saveToFile', { filename: _msgFileName(cid), content: JSON.stringify({ messages: toSave, savedAt: Date.now() }) });
    await _writeTailFile(cid); // #fluidez: actualizar también la cola (durable antes de volver)
    return true;
  } catch (e) { console.warn('[VaultManager] no se pudieron guardar los mensajes (vaultSaveMessages) de ' + cid + ': ' + ((e && e.message) || e)); return false; }
}

// FIX v2.2.2: Filtro defensivo anti-protocolo TURBO compacto + legacy
function _isProtocolPayload(txt) {
  if (typeof txt !== 'string') return false;
  var trimmed = txt.trim();
  if (trimmed.charAt(0) !== '{') return false;
  try {
    var p = JSON.parse(trimmed);
    if (p.type === 'chat_meta' || p.type === 'chat_chunk' || p.type === 'file_meta' ||
        p.type === 'file_chunk' || p.type === 'file_resume' || p.type === 'ack' ||
        p.type === 'read_receipt' || p.type === 'ping' || p.type === 'pong' || p.type === 'kx' || p.type === 'rt' || p.type === 'rk' || p.type === 'rq' || p.type === 'rp' || /^w[qanf]$/.test(p.type || '') || /^f[poqd]$/.test(p.type || '') ||
        p.type === 'block_ack') return true;
    if (p.t === 'c' || p.t === 'f' || p.t === 'n' || p.t === 'a' || p.t === 'ss' || p.t === 'sr') return true;
  } catch(e) {}
  return false;
}
// 2989: gancho de uso (usage_stats.js): se avisa de un mensaje NUEVO y de los cambios de estado de uno propio. Solo contadores.
var _usageHook = null;
export function vaultSetUsageHook(fn) { _usageHook = (typeof fn === 'function') ? fn : null; }
function _usageNote(kind, cid, m, prev) { if (_usageHook) { try { _usageHook(kind, cid, m, prev); } catch (e) {} } }
export async function vaultAppendMessage(contactNexoId, message) {
  if (!contactNexoId || !message) return null;
  var txt = message.text || message.content || '';
  if (_isProtocolPayload(txt)) {
    console.warn('[VaultManager] Protocol JSON rejected from vault:', txt.substring(0, 60));
    return null;
  }
  var cid = _normId(contactNexoId);
  return _withMsgLock(cid, function() { return _appendMessageNow(cid, message); });
}
async function _appendMessageNow(cid, message) {
  var messages = _msgCache.has(cid) ? _msgCache.get(cid).slice() : (await vaultLoadMessages(cid));
  var msgId = message.msgId || message.messageId || message.id || ('msg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6));
  message.msgId = msgId; message.messageId = msgId;
  var normalized = {
    msgId: msgId, messageId: msgId,
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
    attachmentMeta: message.attachmentMeta || null,
    attachmentRef: message.attachmentRef || null
  };
  // Ronda 2758: copia oculta (acciones del chat, copias de los mensajes de grupo para cada miembro): se guarda para
  // reenviarse pero no se dibuja (antes se perdía la marca al guardar y al reabrir el chat salía como texto)
  if (message.hidden) normalized.hidden = true;
  var existingIdx = messages.findIndex(function(m) { return m.msgId === normalized.msgId; });
  var existing = existingIdx >= 0 ? messages[existingIdx] : null;
  _externalizeAttachment(normalized, existing);
  if (existing) {
    var merged = Object.assign({}, existing, normalized);
    // No perder datos del adjunto ni el texto si la nueva versión no los trae
    ['attachmentType', 'attachmentMeta', 'attachmentRef', 'attachmentPayload'].forEach(function(k) {
      if (normalized[k] == null && existing[k] != null) merged[k] = existing[k];
    });
    if (!normalized.content && existing.content) { merged.content = existing.content; merged.text = existing.text; }
    // #94 «ver una vez»: si ya se abrió, nunca revive el medio (una retransmisión no debe restaurar el payload).
    // Auditoría 2800: faltaba borrar content/text aquí (sí se borran al consumir, l.730). Como por internet/relé
    // el payload viaja DENTRO de content como JSON, una retransmisión del mismo msgId tras abrirlo (p. ej. el
    // reenvío automático del emisor al reconectar: su registro saliente no se borra, #12) devolvía ese content y
    // al reabrir el chat `render.js` lo reconstruía y VOLVÍA A MOSTRAR la foto. Se iguala al borrado de consumir:
    // content/text y payload/ref/hd a cero, y attachmentMeta.once forzado para que la burbuja quede en «Abierta».
    if (existing.onceSeen) {
      merged.onceSeen = true;
      merged.content = ''; merged.text = '';
      merged.attachmentPayload = null; merged.attachmentRef = null; merged.hdRef = null; merged.hdStatus = null;
      merged.attachmentMeta = Object.assign({}, existing.attachmentMeta || merged.attachmentMeta || {}, { once: true, onceSeen: true });
    }
    messages[existingIdx] = merged;
  }
  else { messages.push(normalized); _usageNote('msg', cid, normalized); }
  _persistMessages(cid, messages, !existing);
  return normalized;
}
// v2.3.3: guarda un archivo suelto (p.ej. el vídeo original para el HD) y lo deja en memoria hasta escribirlo
export function vaultSaveFile(filename, content) {
  _pendingAttachments[filename] = content;
  var plugin = _nativePlugin();
  if (!plugin) return Promise.resolve(false);
  return _safeNativeCall(plugin, 'saveToFile', { filename: filename, content: content })
    // Auditoría #6: no dar por guardado un {frozen:true} (migración en curso); se mantiene pendiente.
    .then(function(r) { if (r && r.frozen) return false; delete _pendingAttachments[filename]; return true; })
    .catch(function() { return false; });
}
export async function vaultLoadFile(filename) {
  if (_pendingAttachments[filename]) return _pendingAttachments[filename];
  var plugin = _nativePlugin();
  if (!plugin) return null;
  try {
    var r = await _safeNativeCall(plugin, 'loadFromFile', { filename: filename });
    return (r && r.exists && r.content) ? r.content : null;
  } catch (e) { return null; }
}
export function vaultHdFileName(msgId) { return _attFileName(msgId + '_hd'); }

// 2987 (pedido del dueño 10-11, diagnóstico: «cada chat con fotos tarda 1-8 s en abrir»: una lectura de ~430 ms POR FOTO, una tras otra):
// miniatura de cada foto (JPEG de lado máx. 480, unos 15-40 KB) guardada aparte. Al ABRIR un chat se leen solo las miniaturas
// (burbujas de 220 px); la foto original se carga al TOCARLA. Es una caché derivable: si falta, se lee la foto de siempre y se crea.
var THUMB_MAX_SIDE = 480, THUMB_QUALITY = 0.72, THUMB_CACHE_MAX = 200;
var _thumbCache = {}, _thumbKeys = [], _thumbBusy = {}, _thumbFailed = {};
export function vaultThumbFileName(msgId) { return 'nexo_thumb_' + String(msgId).replace(/[^A-Za-z0-9_-]/g, '_') + '.b64'; }
function _thumbRemember(name, b64) {
  if (!_thumbCache[name]) { _thumbKeys.push(name); if (_thumbKeys.length > THUMB_CACHE_MAX) { var old = _thumbKeys.shift(); delete _thumbCache[old]; } }
  _thumbCache[name] = b64;
}
async function _thumbLoad(name) {
  if (_thumbCache[name]) return _thumbCache[name];
  var plugin = _nativePlugin();
  if (!plugin) return null;
  try {
    var r = await _safeNativeCall(plugin, 'loadFromFile', { filename: name });
    if (r && r.exists && r.content) { _thumbRemember(name, r.content); return r.content; }
  } catch (e) {}
  return null;
}
// Crea la miniatura a partir de la foto ya leída (en segundo plano: no frena el chat). Sin canvas (simulador) no hace nada.
function _thumbCreate(msgId, b64, format) {
  var name = vaultThumbFileName(msgId);
  if (_thumbBusy[name] || _thumbFailed[name] || typeof document === 'undefined' || !b64 || typeof b64 !== 'string') return;
  if (String(format || '').toLowerCase() === 'gif') return; // 3035: un GIF (p. ej. del teclado) se ve animado: sin miniatura fija
  _thumbBusy[name] = true;
  try {
    var img = new Image();
    img.onload = function() {
      try {
        var w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
        if (!w || !h) throw new Error('sin tamaño');
        var k = Math.min(1, THUMB_MAX_SIDE / Math.max(w, h));
        // Una foto que ya es chica no gana nada con la miniatura: se deja como está (se leerá entera, que es rápido)
        if (k >= 1 && b64.length < 60000) { _thumbFailed[name] = true; delete _thumbBusy[name]; return; }
        var c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w * k)); c.height = Math.max(1, Math.round(h * k));
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        var out = c.toDataURL('image/jpeg', THUMB_QUALITY).split(',')[1];
        if (!out || out.length >= b64.length) { _thumbFailed[name] = true; delete _thumbBusy[name]; return; }
        _thumbRemember(name, out);
        var plugin = _nativePlugin();
        if (plugin) _safeNativeCall(plugin, 'saveToFile', { filename: name, content: out }).catch(function() {});
        console.log('[THUMB] miniatura de ' + msgId + ': ' + Math.round(b64.length / 1024) + ' KB → ' + Math.round(out.length / 1024) + ' KB');
      } catch (e) { _thumbFailed[name] = true; }
      delete _thumbBusy[name];
    };
    img.onerror = function() { _thumbFailed[name] = true; delete _thumbBusy[name]; };
    img.src = 'data:image/' + (format || 'jpeg') + ';base64,' + b64;
  } catch (e) { _thumbFailed[name] = true; delete _thumbBusy[name]; }
}

// v2.3.3: cambia campos de un mensaje (sin tocar estado ni contenido)
export async function vaultSetMessageFields(contactNexoId, msgId, patch) {
  if (!msgId || !patch) return false;
  if (!contactNexoId) {
    // Sin contacto (p.ej. ack tras reabrir la app): buscar el mensaje en todos
    var contacts = Array.isArray(_vaultContacts) ? _vaultContacts : [];
    for (var i = 0; i < contacts.length; i++) {
      var id = _getContactIdentity(contacts[i]);
      if (id && await vaultSetMessageFields(id, msgId, patch)) return true;
    }
    return false;
  }
  var cid = _normId(contactNexoId);
  return _withMsgLock(cid, async function() {
    var messages = _msgCache.has(cid) ? _msgCache.get(cid).slice() : (await vaultLoadMessages(cid));
    var idx = messages.findIndex(function(m) { return m.msgId === msgId; });
    if (idx < 0) return false;
    var cur = messages[idx];
    var p = Object.assign({}, patch);
    // metaMerge: campos que se añaden a attachmentMeta sin reemplazarlo (p.ej. la miniatura)
    if (p.metaMerge) { p.attachmentMeta = Object.assign({}, cur.attachmentMeta || {}, p.metaMerge); delete p.metaMerge; }
    messages[idx] = Object.assign({}, cur, p);
    _persistMessages(cid, messages);
    return true;
  });
}

// v2.3.6: archivos de un mensaje (adjunto y HD)
function _deleteMessageFiles(m, msgId) {
  var plugin = _nativePlugin();
  if (!plugin) return;
  var names = {};
  [m && m.attachmentRef, m && m.hdRef, _attFileName(msgId), vaultHdFileName(msgId), vaultThumbFileName(msgId)].forEach(function(n) { if (n) names[n] = true; });
  Object.keys(names).forEach(function(n) { _safeNativeCall(plugin, 'deleteFile', { filename: n }).catch(function() {}); });
}
// Eliminar para mí: fuera del historial
export async function vaultDeleteMessage(contactNexoId, msgId) {
  if (!contactNexoId || !msgId) return false;
  var cid = _normId(contactNexoId);
  return _withMsgLock(cid, async function() {
    var messages = _msgCache.has(cid) ? _msgCache.get(cid).slice() : (await vaultLoadMessages(cid));
    var idx = messages.findIndex(function(m) { return (m.msgId || m.messageId) === msgId; });
    if (idx < 0) return false;
    var m = messages[idx];
    messages.splice(idx, 1);
    _persistMessages(cid, messages);
    _deleteMessageFiles(m, msgId);
    vaultBigxOutDrop(msgId).catch(function() {}); vaultBigxInDrop(msgId).catch(function() {}); // 3007
    return true;
  });
}
// Eliminado para todos: el mensaje queda como aviso ("Se eliminó este mensaje"), sin contenido ni adjuntos
export async function vaultBlankMessage(contactNexoId, msgId) {
  if (!contactNexoId || !msgId) return false;
  var cid = _normId(contactNexoId);
  return _withMsgLock(cid, async function() {
    var messages = _msgCache.has(cid) ? _msgCache.get(cid).slice() : (await vaultLoadMessages(cid));
    var idx = messages.findIndex(function(m) { return (m.msgId || m.messageId) === msgId; });
    if (idx < 0) return false;
    var m = messages[idx];
    messages[idx] = Object.assign({}, m, { deleted: true, content: '', attachmentType: null, attachmentPayload: null,
      attachmentRef: null, attachmentMeta: null, hdRef: null, hdStatus: null });
    _persistMessages(cid, messages);
    _deleteMessageFiles(m, msgId);
    return true;
  });
}

// #94 «ver una vez»: tras abrir un medio de una sola vista, se borra de verdad (blob del disco incluido) y queda
// marcado onceSeen para que la burbuja muestre «Abierta». No se puede volver a abrir. Se conserva el mensaje (no es
// "eliminado"): solo pierde el contenido del medio.
export async function vaultConsumeOnceMessage(contactNexoId, msgId) {
  if (!contactNexoId || !msgId) return false;
  var cid = _normId(contactNexoId);
  return _withMsgLock(cid, async function() {
    var messages = _msgCache.has(cid) ? _msgCache.get(cid).slice() : (await vaultLoadMessages(cid));
    var idx = messages.findIndex(function(m) { return (m.msgId || m.messageId) === msgId; });
    if (idx < 0) return false;
    var m = messages[idx];
    if (m.onceSeen) return true;
    var meta = Object.assign({}, m.attachmentMeta || {}, { once: true, onceSeen: true });
    // 3163: tampoco queda la miniatura (un fotograma del vídeo) ni el puntero del buzón de archivos (con su llave se podría volver a bajar)
    delete meta.thumb; delete meta.blobPtr;
    // Borrar también content/text: el content de un adjunto puede llevar el payload como JSON y lo resucitaría al
    // reabrir el chat. Se conservan attachmentType y attachmentMeta.once para que la burbuja muestre «Abierta».
    messages[idx] = Object.assign({}, m, { onceSeen: true, content: '', text: '', attachmentPayload: null, attachmentRef: null, hdRef: null, hdStatus: null, attachmentMeta: meta });
    _persistMessages(cid, messages);
    _deleteMessageFiles(m, msgId);
    return true;
  });
}

// Ronda 2782: editar un mensaje de texto ya enviado/recibido. Cambia el contenido y lo marca "editado".
export async function vaultEditMessage(contactNexoId, msgId, newText) {
  if (!contactNexoId || !msgId || typeof newText !== 'string') return false;
  var cid = _normId(contactNexoId);
  return _withMsgLock(cid, async function() {
    var messages = _msgCache.has(cid) ? _msgCache.get(cid).slice() : (await vaultLoadMessages(cid));
    var idx = messages.findIndex(function(m) { return (m.msgId || m.messageId) === msgId; });
    if (idx < 0) return false;
    var m = messages[idx];
    if (m.deleted || m.attachmentType) return false; // solo texto; ni borrados ni adjuntos
    messages[idx] = Object.assign({}, m, { content: newText, edited: true });
    _persistMessages(cid, messages);
    return true;
  });
}

// Ronda 2783: reaccionar a un mensaje con un emoji. reactions = { NEXO ID de quien reacciona: emoji }; emoji '' lo quita.
export async function vaultReactMessage(contactNexoId, msgId, reactorNexoId, emoji) {
  if (!contactNexoId || !msgId || !reactorNexoId) return false;
  var cid = _normId(contactNexoId);
  var who = _normId(reactorNexoId);
  var e = (typeof emoji === 'string') ? emoji.slice(0, 8) : '';
  return _withMsgLock(cid, async function() {
    var messages = _msgCache.has(cid) ? _msgCache.get(cid).slice() : (await vaultLoadMessages(cid));
    var idx = messages.findIndex(function(m) { return (m.msgId || m.messageId) === msgId; });
    if (idx < 0) return false;
    var m = messages[idx];
    if (m.deleted) return false;
    var reactions = Object.assign({}, m.reactions || {});
    if (e) reactions[who] = e; else delete reactions[who];
    messages[idx] = Object.assign({}, m, { reactions: reactions });
    _persistMessages(cid, messages);
    return true;
  });
}

// v2.3.3: el vídeo HD sustituye al adjunto (previa) de un mensaje ya recibido. Devuelve true, false (no está) o 'onceSeen' (3163)
export async function vaultReplaceAttachment(contactNexoId, msgId, payload, metaPatch) {
  if (!contactNexoId || !msgId || !payload) return false;
  var cid = _normId(contactNexoId);
  return _withMsgLock(cid, async function() {
    var messages = _msgCache.has(cid) ? _msgCache.get(cid).slice() : (await vaultLoadMessages(cid));
    var idx = messages.findIndex(function(m) { return m.msgId === msgId; });
    if (idx < 0) return false;
    // 3163: un «ver una vez» ya abierto no revive: el HD que llega después se tira sin guardarlo
    if (messages[idx].onceSeen) return 'onceSeen';
    var m = Object.assign({}, messages[idx]);
    var ref = m.attachmentRef || _attFileName(msgId);
    vaultSaveFile(ref, payload);
    m.attachmentRef = ref;
    m.attachmentPayload = null;
    m.attachmentMeta = Object.assign({}, m.attachmentMeta || {}, metaPatch || {});
    messages[idx] = m;
    _persistMessages(cid, messages);
    return true;
  });
}

var _STATUS_RANK = { failed: 0, pending: 1, queued: 2, sending: 3, sent: 4, delivered: 5, read: 6 };
function _statusRank(s) { return _STATUS_RANK[s] || 0; }
export async function vaultUpdateMessageStatus(contactNexoId, msgId, status) {
  if (!msgId || !status) return false;
  var tried = Object.create(null);
  async function updateInContact(cid) {
    if (!cid) return false;
    cid = _normId(cid);
    if (!cid || tried[cid]) return false;
    tried[cid] = true;
    return _withMsgLock(cid, async function() {
      var messages = _msgCache.has(cid) ? _msgCache.get(cid).slice() : (await vaultLoadMessages(cid));
      var idx = messages.findIndex(function(m) {
        return (m.msgId || m.messageId || m.id) === msgId;
      });
      if (idx < 0) return false;
      // FIX v2.2.3: no degradar (p.ej. 'sent' tardío pisando 'delivered'/'read')
      if (_statusRank(status) < _statusRank(messages[idx].status) && !(status === 'failed' && _statusRank(messages[idx].status) < 5)) return true;
      var _prevSt = messages[idx].status;
      messages[idx] = Object.assign({}, messages[idx], { status: status });
      _usageNote('status', cid, messages[idx], _prevSt);
      _persistMessages(cid, messages);
      return true;
    });
  }
  if (await updateInContact(contactNexoId)) return true;
  var contacts = Array.isArray(_vaultContacts) ? _vaultContacts : [];
  for (var i = 0; i < contacts.length; i++) {
    var cid = _getContactIdentity(contacts[i]);
    if (await updateInContact(cid)) return true;
  }
  return false;
}
// 3038: cambiar campos de un mensaje (sin tocar su estado), p. ej. quitar la marca «adjunto ilegible» al reintentar a mano
export async function vaultPatchMessage(contactNexoId, msgId, patch) {
  var cid = _normId(contactNexoId);
  if (!cid || !msgId || !patch) return false;
  return _withMsgLock(cid, async function() {
    var messages = _msgCache.has(cid) ? _msgCache.get(cid).slice() : (await vaultLoadMessages(cid));
    var idx = messages.findIndex(function(m) { return (m.msgId || m.messageId || m.id) === msgId; });
    if (idx < 0) return false;
    messages[idx] = Object.assign({}, messages[idx], patch);
    _persistMessages(cid, messages);
    return true;
  });
}
export async function vaultGetPendingMessages(contactNexoId) {
  if (!contactNexoId) return [];
  var cid = _normId(contactNexoId);
  var messages = _msgCache.has(cid) ? _msgCache.get(cid).slice() : (await vaultLoadMessages(cid));
  var pending = messages.filter(function(m) {
    if (m._own !== true || !(m.status === 'pending' || m.status === 'failed')) return false;
    if (m.attMissing === true) return false; // 3038: adjunto que no se pudo leer del teléfono: solo se reintenta a mano
    // 3033: copia oculta vieja de un estado (ver estados.staleStatusCopy): no se reenvía
    return !(m.hidden === true && typeof window !== 'undefined' && typeof window.NEXO_staleStatusCopy === 'function' && window.NEXO_staleStatusCopy(m, cid));
  });
  pending.sort(function(a, b) {
    var tsA = a.timestamp || 0, tsB = b.timestamp || 0;
    if (tsA !== tsB) return tsA - tsB;
    var seqA = (typeof a.seq === 'number') ? a.seq : 0;
    var seqB = (typeof b.seq === 'number') ? b.seq : 0;
    return seqA - seqB;
  });
  return pending;
}

// Para las otras piezas de vault_manager.js
export { _flushPendingWrites, _pendingAttachments };
