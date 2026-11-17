
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

// 3195 (dueño 17-11: «al pulsar un mensaje enviado agrega la posibilidad de editarlo»): solo se edita un TEXTO, suelto o envuelto
// (nexo_txt: p. ej. una respuesta con su cita); no uno reenviado ni el aviso «salió del grupo», ni un sticker, un adjunto u otro JSON
// del protocolo. Devuelve el texto que se edita, o null si ese contenido no se edita.
function _editableText(content) {
  if (typeof content !== 'string' || !content) return null;
  if (content.charAt(0) !== '{') return content;
  var o = null;
  try { o = JSON.parse(content); } catch (e) { return content; }
  if (!o || typeof o !== 'object') return content;
  if (o.type === 'nexo_txt') return (typeof o.t === 'string' && o.t && !o.fw && !o.gl) ? o.t : null;
  return (o.type || o.attachmentType) ? null : content;
}
// 3195: el contenido con el texto ya editado. Una respuesta conserva su cita; un texto nuevo que parezca JSON del protocolo va
// envuelto (nexo_txt) para que se vea como texto y nunca se lea como foto, sticker o acción (la edición viene de otro teléfono).
function _editedContent(content, newText) {
  var t = String(newText == null ? '' : newText);
  var o = null;
  if (typeof content === 'string' && content.charAt(0) === '{') { try { o = JSON.parse(content); } catch (e) { o = null; } }
  if (o && o.type === 'nexo_txt') return JSON.stringify(Object.assign({}, o, { t: t }));
  if (t.charAt(0) === '{') { var j = null; try { j = JSON.parse(t); } catch (e) {} if (j && typeof j === 'object') return JSON.stringify({ type: 'nexo_txt', t: t }); }
  return t;
}

// 3201 (dueño 17-11: miniatura del mapa al mandar la ubicación; eligió la opción A): la miniatura viaja DENTRO del mensaje cifrado
// (meta.map) y viene de otro teléfono. Solo vale una imagen raster en base64 (JPEG, PNG o WebP) dentro del tope: nunca una URL (al
// pintarla se pediría algo a un servidor ajeno: la fuga de la auditoría del 03-11), ni SVG (puede llevar script), ni HTML, ni una
// imagen gigante. La usan render.js (al pintar) y vault_messages.js (al guardar: lo que no vale ni se guarda).
var LOC_MAP_MAX_CHARS = 110000;   // tope duro (~80 KB de imagen); quien la manda apunta a ~12 000 (location_map.js)
var LOC_MAP_RE = /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/;
function _locMapOk(s) { return typeof s === 'string' && s.length >= 64 && s.length <= LOC_MAP_MAX_CHARS && LOC_MAP_RE.test(s); }
// Quita un meta.map que no vale de una ubicación (en attachmentMeta y dentro del contenido JSON). Devuelve el mensaje.
function _cleanLocMap(m) {
  if (!m || typeof m !== 'object') return m;
  var am = m.attachmentMeta;
  if (am && typeof am === 'object' && Object.prototype.hasOwnProperty.call(am, 'map') && !_locMapOk(am.map)) { am = Object.assign({}, am); delete am.map; m.attachmentMeta = am; }
  ['content', 'text'].forEach(function(k) {
    var c = m[k];
    if (typeof c !== 'string' || c.charAt(0) !== '{' || c.indexOf('"map"') < 0 || c.indexOf('"location"') < 0) return;
    var o = null;
    try { o = JSON.parse(c); } catch (e) { return; }
    if (!o || o.type !== 'attachment' || o.attachmentType !== 'location' || !o.meta || typeof o.meta !== 'object') return;
    if (!Object.prototype.hasOwnProperty.call(o.meta, 'map') || _locMapOk(o.meta.map)) return;
    delete o.meta.map;
    m[k] = JSON.stringify(o);
  });
  return m;
}

// Para las otras piezas de vault_manager.js
export { _normId, _nativePlugin, _safeNativeCall, VAULT_CONTACTS_FILE, VAULT_MESSAGES_PREFIX, _msgCache, _msgLoading, _withMsgLock, VAULT_TRANSFERS_PREFIX, _transferCache, VAULT_OUTGOING_PREFIX, _outgoingCache, _withOutLock, _editableText, _editedContent, _locMapOk, _cleanLocMap };
