/**
 * vault_manager.js v2.3.6
 * v2.3.6: vaultDeleteMessage (eliminar para mí) y vaultBlankMessage (eliminado para todos: queda el aviso);
 *         ambos borran los archivos del adjunto y del HD.
 * v2.3.5: escrituras del registro de salientes en cola por contacto (antes se pisaban); kx es protocolo.
 * v2.3.4: un mensaje nuevo se escribe al momento; cambios de estado y duplicados, agrupados (300 ms).
 * v2.3.3: vídeo HD: vaultReplaceAttachment (el HD sustituye a la previa), vaultSetMessageFields,
 *         vaultSaveFile y vaultHydrateAttachments(..., { preferHd }) para ver el original propio.
 * v2.3.2: contactos con lastMessageAt (orden de la lista por último mensaje); guardado de contactos
 *         agrupado (300 ms) para no escribir el archivo con cada paquete recibido.
 * FIX v2.3.1: historial sin carreras. Cada cambio (añadir, estado, guardar) va en cola por contacto y
 *             las lecturas simultáneas comparten una carga. Antes, al abrir la app (caché vacía) dos
 *             mensajes seguidos leían el mismo archivo y el segundo guardado borraba el primero.
 * v2.3.0: adjuntos grandes en archivo propio (attachmentRef) + vaultHydrateAttachments; migración automática.
 * FIX v2.2.3: estado de mensaje no se degrada; completar transferencia no pisa el adjunto guardado.
 * FIX: Filtro defensivo anti-protocolo TURBO compacto (t: c/f/n/a/ss/sr)
 * Base: v2.2.1-D2
 */

var VAULT_CONTACTS_FILE = 'nexo_vault_contacts.json';
var VAULT_MESSAGES_PREFIX = 'nexo_vault_msgs_v2_';
var VAULT_TRANSFERS_PREFIX = 'nexo_vault_transfers_v2_';
var VAULT_OUTGOING_PREFIX = 'nexo_vault_outgoing_v2_';
var _vaultContacts = [];
var _vaultInitDone = false;

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
var _msgLocks = new Map();   // cid -> promesa del último cambio en cola
var _msgLoading = new Map(); // cid -> promesa de carga en curso

// Ejecuta fn en exclusiva para ese contacto (leer → modificar → guardar sin que otro se cuele)
function _withMsgLock(cid, fn) {
  var prev = _msgLocks.get(cid) || Promise.resolve();
  var run = prev.then(fn, fn);
  var tail = run.catch(function() {});
  _msgLocks.set(cid, tail);
  tail.then(function() { if (_msgLocks.get(cid) === tail) _msgLocks.delete(cid); });
  return run;
}
// v2.3.5: las escrituras del registro de salientes también en cola por contacto: dos borrados a la vez
// leían la misma lista y el segundo deshacía el primero (quedaba un envío entregado que se reenviaba)
var _outLocks = new Map();
function _withOutLock(cid, fn) {
  var prev = _outLocks.get(cid) || Promise.resolve();
  var run = prev.then(fn, fn);
  var tail = run.catch(function() {});
  _outLocks.set(cid, tail);
  tail.then(function() { if (_outLocks.get(cid) === tail) _outLocks.delete(cid); });
  return run;
}
var _transferCache = _createLRU(20);
var _outgoingCache = _createLRU(20);
function _normId(id) {
  return (id || '').toString().toLowerCase().trim();
}
function _getContactIdentity(contact) {
  if (!contact) return '';
  /*
   * La identidad principal de NEXO es el NEXO ID.
   *
   * NO usamos:
   * - nombre
   * - deviceId
   * - MAC
   */
  return _normId(
    contact.nexoId ||
    contact.deviceUUID
  );
}
function _dedupeContacts(contacts) {
  if (!Array.isArray(contacts)) return [];
  var result = [];
  var seen = Object.create(null);
  contacts.forEach(function(contact) {
    if (!contact || typeof contact !== 'object') {
      return;
    }
    var identity = _getContactIdentity(contact);
    /*
     * Un registro sin identidad válida no puede ser
     * considerado un contacto NEXO.
     */
    if (!identity) {
      return;
    }
    /*
     * Primera aparición: conservarla.
     */
    if (!seen[identity]) {
      seen[identity] = result.length;
      contact.nexoId = identity;
      contact.deviceUUID = identity;
      result.push(contact);
      return;
    }
    /*
     * Ya existe el mismo NEXO ID.
     *
     * Fusionamos información para no perder:
     * - nombre
     * - última conexión
     * - mensajes
     * - estado
     * - dirección BLE actual
     */
    var existingIndex = seen[identity];
    var existing = result[existingIndex];
    if ((contact.lastSeen || 0) > (existing.lastSeen || 0)) {
      existing.lastSeen = contact.lastSeen;
      existing.online = contact.online;
      existing.deviceId = contact.deviceId || existing.deviceId;
    }
    if (contact.name && !existing.name) {
      existing.name = contact.name;
    }
    if (contact.displayName && !existing.displayName) {
      existing.displayName = contact.displayName;
    }
    if (contact.deviceName && !existing.deviceName) {
      existing.deviceName = contact.deviceName;
    }
    if (contact.publicKey && !existing.publicKey) {
      existing.publicKey = contact.publicKey;
    }
    if ((contact.unreadCount || 0) > (existing.unreadCount || 0)) {
      existing.unreadCount = contact.unreadCount;
    }
    if ((contact.lastMessageAt || 0) > (existing.lastMessageAt || 0)) {
      existing.lastMessageAt = contact.lastMessageAt;
      if (contact.lastMessage) existing.lastMessage = contact.lastMessage;
    } else if (contact.lastMessage && !existing.lastMessage) {
      existing.lastMessage = contact.lastMessage;
    }
  });
  return result;
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
export async function initVault() {
  if (_vaultInitDone) return;
  var plugin = _nativePlugin();
  if (!plugin) {
    _vaultContacts = [];
    _vaultInitDone = true;
    return;
  }
  try {
    var result = await _safeNativeCall(
      plugin,
      'loadFromFile',
      {
        filename: VAULT_CONTACTS_FILE
      }
    );

    if (result && result.exists && result.content) {
      var data = JSON.parse(result.content);
      var loadedContacts =
        Array.isArray(data.contacts)
          ? data.contacts
          : [];
      /*
       * Limpieza automática de duplicados existentes.
       */
      var cleanedContacts =
        _dedupeContacts(loadedContacts);
      _vaultContacts = cleanedContacts;
      /*
       * Si encontramos duplicados, guardamos inmediatamente
       * la versión limpia.
       */
      if (cleanedContacts.length !== loadedContacts.length) {
        _persistContacts();
      }
    } else {
      _vaultContacts = [];
    }
  } catch (e) {
    console.error('[VaultManager] initVault:', e);
    _vaultContacts = [];
  }
  _vaultInitDone = true;
}
var _persistContactsTimer = null;
function _persistContacts() {
  if (_persistContactsTimer) return;
  _persistContactsTimer = setTimeout(function() { _persistContactsTimer = null; _persistContactsNow(); }, 300);
}
function _persistContactsNow() {
  var plugin = _nativePlugin();
  if (!plugin) return;
  _safeNativeCall(plugin, 'saveToFile', {
    filename: VAULT_CONTACTS_FILE,
    content: JSON.stringify({ contacts: _vaultContacts, savedAt: Date.now() })
  }).catch(function(e) {});
}
export function vaultLoadContacts() { return _vaultContacts || []; }
export function vaultSaveContacts(contacts) {
  try {
    /*
     * Segunda barrera contra duplicados.
     */
    _vaultContacts = _dedupeContacts(
      Array.isArray(contacts)
        ? contacts
        : []
    );
    _persistContacts();
    return true;
  } catch (e) {
    console.error('[VaultManager] saveContacts:', e);
    return false;
  }
}
export function vaultSaveContact(contact) {
  try {
    if (!contact || typeof contact !== 'object') {
      return false;
    }

    var contacts = _vaultContacts || [];
    var identity = _getContactIdentity(contact);

    if (!identity) {
      console.warn(
        '[VaultManager] Contacto rechazado: sin NEXO ID'
      );
      return false;
    }

    var now = Date.now();

    var normalized = {
      nexoId: identity,
      deviceUUID: identity,

      displayName:
        contact.displayName ||
        contact.name ||
        contact.deviceName ||
        'Desconocido',

      avatarColor:
        contact.avatarColor ||
        _generateColor(identity),

      deviceName:
        contact.deviceName ||
        contact.displayName ||
        '',

      createdAt:
        contact.createdAt ||
        now,

      lastSeen: now,

      isGuardian:
        !!contact.isGuardian,

      trustScore:
        contact.trustScore || 0,

      verifiedInPerson:
        !!contact.verifiedInPerson,

      messageFrequency:
        contact.messageFrequency || 0,

      proximityScore:
        contact.proximityScore || 0,

      publicKey:
        contact.publicKey || '',
      /*
       * Dirección BLE actual.
       * NO se utiliza para identificar al contacto.
       */
      deviceId:
        contact.deviceId ||
        contact.deviceUUID ||
        null
    };
    /*
     * Buscar únicamente por identidad NEXO.
     */
    var idx = contacts.findIndex(function(c) {
      return _getContactIdentity(c) === identity;
    });
    if (idx >= 0) {
      var existing = contacts[idx];
      /*
       * Actualizamos el registro existente.
       * Nunca agregamos una segunda entrada.
       */
      contacts[idx] = Object.assign(
        {},
        existing,
        normalized,
        {
          createdAt:
            existing.createdAt ||
            normalized.createdAt
        }
      );
    } else {
      contacts.push(normalized);
    }
    /*
     * Última barrera:
     * incluso si contacts ya contenía duplicados,
     * no permitimos que sobrevivan.
     */
    _vaultContacts = _dedupeContacts(contacts);
    _persistContacts();
    return true;
  } catch (e) {
    console.error(
      '[VaultManager] saveContact:',
      e
    );
    return false;
  }
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
  var identity = _normId(nexoId);
  if (!identity) {
    return null;
  }
  var c = vaultFindContactByNexoId(identity);
  if (!c) {
    c = {
      nexoId: identity,
      deviceUUID: identity,

      displayName:
        deviceName ||
        identity.substring(0, 8),

      deviceName:
        deviceName || '',

      deviceId: null
    };
    vaultSaveContact(c);
    return vaultFindContactByNexoId(identity) || c;
  } else if (
    deviceName &&
    !c.deviceName
  ) {
    c.deviceName = deviceName;
    vaultSaveContact(c);
  }
  return c;
}
// v2.3.0: los adjuntos grandes van en su propio archivo (nexo_att_<msgId>.b64) y el historial guarda
// solo 'attachmentRef'. Antes cada foto iba DOS veces dentro del JSON del historial (payload y
// content) y cada cambio de estado reescribía todas las fotos del chat: la app se congelaba.
var ATT_INLINE_LIMIT = 2048;
var _pendingAttachments = Object.create(null); // ref -> payload mientras se escribe a disco
function _attFileName(msgId) {
  return 'nexo_att_' + String(msgId).replace(/[^A-Za-z0-9_-]/g, '_') + '.b64';
}
// Saca el payload grande del mensaje (sin await: no abrir carreras de lectura-escritura del historial)
function _externalizeAttachment(m, existing) {
  if (!m || !m.attachmentPayload || typeof m.attachmentPayload !== 'string' || m.attachmentPayload.length <= ATT_INLINE_LIMIT) return false;
  var ref = (existing && existing.attachmentRef) || m.attachmentRef || _attFileName(m.msgId);
  if (!(existing && existing.attachmentRef)) {
    var payload = m.attachmentPayload;
    var plugin = _nativePlugin();
    _pendingAttachments[ref] = payload;
    if (plugin) {
      _safeNativeCall(plugin, 'saveToFile', { filename: ref, content: payload })
        .then(function() { delete _pendingAttachments[ref]; })
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
    if (ref === m.hdRef && m.hdMime) copy.attachmentMeta = Object.assign({}, m.attachmentMeta || {}, { mime: m.hdMime });
    var mem = _pendingAttachments[ref];
    if (mem) copy.attachmentPayload = mem;
    else if (plugin) {
      try {
        var r = await _safeNativeCall(plugin, 'loadFromFile', { filename: ref });
        if (r && r.exists && r.content) copy.attachmentPayload = r.content;
      } catch (e) {}
    }
    out.push(copy);
  }
  return out;
}
function _msgFileName(contactNexoId) {
  return VAULT_MESSAGES_PREFIX + _normId(contactNexoId) + '.json';
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
  return _safeNativeCall(plugin, 'saveToFile', {
    filename: _msgFileName(cid),
    content: JSON.stringify({ messages: msgs, savedAt: Date.now() })
  }).catch(function(e) {});
}
function _flushPendingWrites() {
  return Promise.all(Array.from(_persistTimers.keys()).map(_writeMessagesFile));
}
// Ronda 2759 (pasar la cuenta): todo lo pendiente a disco antes de empaquetarlo
export function vaultFlushAll() { return _flushPendingWrites().then(function() { return Promise.all(Object.keys(_pendingAttachments).map(function(f) { return vaultSaveFile(f, _pendingAttachments[f]); })); }); }
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', function() { if (document.visibilityState === 'hidden') _flushPendingWrites(); });
  window.addEventListener('pagehide', _flushPendingWrites);
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
    return true;
  } catch (e) { return false; }
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
    messages[existingIdx] = merged;
  }
  else { messages.push(normalized); }
  _persistMessages(cid, messages, !existing);
  return normalized;
}
// v2.3.3: guarda un archivo suelto (p.ej. el vídeo original para el HD) y lo deja en memoria hasta escribirlo
export function vaultSaveFile(filename, content) {
  _pendingAttachments[filename] = content;
  var plugin = _nativePlugin();
  if (!plugin) return Promise.resolve(false);
  return _safeNativeCall(plugin, 'saveToFile', { filename: filename, content: content })
    .then(function() { delete _pendingAttachments[filename]; return true; })
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
  [m && m.attachmentRef, m && m.hdRef, _attFileName(msgId), vaultHdFileName(msgId)].forEach(function(n) { if (n) names[n] = true; });
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

// v2.3.3: el vídeo HD sustituye al adjunto (previa) de un mensaje ya recibido
export async function vaultReplaceAttachment(contactNexoId, msgId, payload, metaPatch) {
  if (!contactNexoId || !msgId || !payload) return false;
  var cid = _normId(contactNexoId);
  return _withMsgLock(cid, async function() {
    var messages = _msgCache.has(cid) ? _msgCache.get(cid).slice() : (await vaultLoadMessages(cid));
    var idx = messages.findIndex(function(m) { return m.msgId === msgId; });
    if (idx < 0) return false;
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
      messages[idx] = Object.assign({}, messages[idx], { status: status });
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
export async function vaultGetPendingMessages(contactNexoId) {
  if (!contactNexoId) return [];
  var cid = _normId(contactNexoId);
  var messages = _msgCache.has(cid) ? _msgCache.get(cid).slice() : (await vaultLoadMessages(cid));
  var pending = messages.filter(function(m) { return m._own === true && (m.status === 'pending' || m.status === 'failed'); });
  pending.sort(function(a, b) {
    var tsA = a.timestamp || 0, tsB = b.timestamp || 0;
    if (tsA !== tsB) return tsA - tsB;
    var seqA = (typeof a.seq === 'number') ? a.seq : 0;
    var seqB = (typeof b.seq === 'number') ? b.seq : 0;
    return seqA - seqB;
  });
  return pending;
}
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
  var toSave = outgoing.slice(-50);
  _outgoingCache.set(cid, toSave.slice());
  _safeNativeCall(plugin, 'saveToFile', {
    filename: _outgoingFileName(cid),
    content: JSON.stringify({ outgoing: toSave, savedAt: Date.now() })
  }).catch(function(e) {});
}
export async function vaultCreateOutgoingTransfer(contactNexoId, transferId, type, totalChunks, chunks, meta, deviceId) {
  if (!contactNexoId || !transferId || !type || !totalChunks || !chunks) return null;
  var cid = _normId(contactNexoId);
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
