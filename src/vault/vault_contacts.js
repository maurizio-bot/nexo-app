import { _normId, _nativePlugin, _safeNativeCall, VAULT_CONTACTS_FILE } from './vault_shared.js';
import { _flushPendingWrites, _pendingAttachments, vaultSaveFile } from './vault_messages.js';
import { vaultEarlyReady } from './vault_early_acts.js';
// vault_manager.js — CONTACTOS: la lista, su arranque (initVault), guardado y búsqueda; y volcar todo a disco (vaultFlushAll).
// Reestructuración 15-11: movido TAL CUAL desde vault_manager.js (que lo sigue exportando).
var _vaultContacts = [];
var _vaultInitDone = false;
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
    _vaultLoadFailed = true; // auditoría #7: no pisar el archivo real mientras no se haya podido leer
  }
  // 3175: las acciones que esperan a su mensaje (lápidas de «eliminar para todos»), listas antes de que llegue nada
  try { await vaultEarlyReady(); } catch (e) {}
  _vaultInitDone = true;
}
var _persistContactsTimer = null;
var _vaultLoadFailed = false;
 // auditoría #7: si la carga de contactos FALLÓ (plugin/JSON), no sobrescribir el archivo real con []
function _persistContacts() {
  if (_persistContactsTimer) return;
  _persistContactsTimer = setTimeout(function() { _persistContactsTimer = null; _persistContactsNow(); }, 300);
}
function _persistContactsNow() {
  var plugin = _nativePlugin();
  if (!plugin) return Promise.resolve();
  // Auditoría #7: si initVault no pudo LEER los contactos (error del plugin o JSON dañado), la lista en memoria no es
  // de fiar: no se sobrescribe el archivo (así no se pisan los contactos reales con una lista vacía/parcial).
  if (_vaultLoadFailed) { console.warn('[VaultManager] contactos no se guardan: la carga inicial había fallado (archivo conservado)'); return Promise.resolve(); }
  return _safeNativeCall(plugin, 'saveToFile', {
    filename: VAULT_CONTACTS_FILE,
    content: JSON.stringify({ contacts: _vaultContacts, savedAt: Date.now() })
  }).catch(function(e) { console.warn('[VaultManager] fallo al guardar contactos (R2): ' + ((e && e.message) || e)); }); // R2: no tragar el error en silencio
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
// Ronda 2759 (pasar la cuenta): todo lo pendiente a disco antes de empaquetarlo
export function vaultFlushAll() {
  // Auditoría #8b: volcar TAMBIÉN el temporizador de contactos (antes solo mensajes + adjuntos), si no un contacto
  // guardado en los últimos 300 ms no entraba en la cuenta al pasarla.
  if (_persistContactsTimer) { clearTimeout(_persistContactsTimer); _persistContactsTimer = null; }
  return Promise.all([_persistContactsNow(), _flushPendingWrites()]).then(function() { return Promise.all(Object.keys(_pendingAttachments).map(function(f) { return vaultSaveFile(f, _pendingAttachments[f]); })); });
}
if (typeof document !== 'undefined') {
  // R3 (auditoría 03-11): al pasar a 2.º plano hay que volcar TAMBIÉN los adjuntos pendientes (`_pendingAttachments`),
  // no solo los mensajes. Antes se llamaba a `_flushPendingWrites` (solo mensajes) → si el proceso moría ahí, un mensaje
  // podía quedar apuntando a un adjunto que nunca se escribió. `vaultFlushAll` vuelca mensajes + adjuntos + contactos.
  document.addEventListener('visibilitychange', function() { if (document.visibilityState === 'hidden') vaultFlushAll(); });
  window.addEventListener('pagehide', function() { vaultFlushAll(); });
}

// Para las otras piezas de vault_manager.js
export { _vaultContacts, _getContactIdentity };
