
// vault_manager.js — lo común: nombres de archivos, cachés, candados de escritura y acceso al nativo.
// Reestructuración 15-11: movido TAL CUAL desde vault_manager.js (que lo sigue exportando).
var VAULT_CONTACTS_FILE = 'nexo_vault_contacts.json';
var VAULT_MESSAGES_PREFIX = 'nexo_vault_msgs_v2_';
var VAULT_TRANSFERS_PREFIX = 'nexo_vault_transfers_v2_';
var VAULT_OUTGOING_PREFIX = 'nexo_vault_outgoing_v2_';

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
var _msgLocks = new Map();
   // cid -> promesa del último cambio en cola
var _msgLoading = new Map();
 // cid -> promesa de carga en curso

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

// Para las otras piezas de vault_manager.js
export { _normId, _nativePlugin, _safeNativeCall, VAULT_CONTACTS_FILE, VAULT_MESSAGES_PREFIX, _msgCache, _msgLoading, _withMsgLock, VAULT_TRANSFERS_PREFIX, _transferCache, VAULT_OUTGOING_PREFIX, _outgoingCache, _withOutLock };
