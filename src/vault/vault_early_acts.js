// 3175 (prueba de ciudad 17-11): acciones del chat que llegan ANTES que su mensaje.
// Una reacción, una edición o un «eliminar para todos» viaja como acción oculta (nexo_act) y puede adelantarse a su mensaje:
// la acción va por internet en segundos y la foto se queda horas en la custodia de un Jump, o el texto largo espera al buzón.
// Antes la acción se tiraba (no había mensaje que cambiar) y, al llegar el mensaje, se veía y se guardaba entero: la reacción
// se perdía y lo que el otro ELIMINÓ PARA TODOS aparecía igual (privacidad). Ahora se guarda aquí (en el disco, cifrado en
// reposo como el resto) por chat y por id de mensaje, y se aplica al guardarse el mensaje (vault_messages._appendMessageNow):
//   - eliminar para todos → «lápida»: el mensaje queda en blanco («Se eliminó este mensaje»), sin contenido ni adjunto, y la
//     app no avisa de él (main_chats). La lápida se queda hasta caducar: otra copia que llegue después tampoco revive.
//   - edición → el texto nuevo (solo a un texto suyo, no a un adjunto) con la marca «editado»;
//   - reacción → su emoji (vacío = la quitó).
// Solo cuentan las acciones de quien escribió el mensaje, sobre mensajes de su chat 1-a-1 (las mismas reglas que con el mensaje
// presente: chat_actions._applyChatAction). Caducan a los 7 días y hay tope (por chat y en total): un contacto no llena el disco.
import { _nativePlugin, _safeNativeCall, _normId } from './vault_shared.js';

var EARLY_FILE = 'nexo_early_acts.json';
var KEEP_MS = 7 * 24 * 3600000;   // más que la ventana de «eliminar para todos» (24 h) más lo que puede tardar una custodia
var MAX_ALL = 400, MAX_CHAT = 80; // topes: lo más viejo se olvida primero
var EDIT_MAX_CHARS = 8000;        // una edición más larga no se guarda a la espera (se aplica solo si el mensaje ya está)

var _w = Object.create(null);     // 'cid|msgId' → { t, d: 1 (eliminado para todos), e: texto editado, r: { quien: emoji } }
var _loaded = false, _loading = null, _saveT = null;

function _key(cid, msgId) { return _normId(cid) + '|' + String(msgId); }

export function vaultEarlyLoaded() { return _loaded; }

// Carga lo guardado (una vez). Lo que llegó mientras tanto en memoria manda sobre lo del disco.
export function vaultEarlyReady() {
  if (_loaded) return Promise.resolve();
  if (_loading) return _loading;
  var plugin = _nativePlugin();
  var read = plugin ? _safeNativeCall(plugin, 'loadFromFile', { filename: EARLY_FILE }).catch(function() { return null; }) : Promise.resolve(null);
  var timeout = new Promise(function(res) { setTimeout(function() { res(null); }, 2500); });
  _loading = Promise.race([read, timeout]).then(function(r) {
    try {
      var o = (r && r.exists && r.content) ? JSON.parse(r.content) : null;
      var disk = (o && o.w && typeof o.w === 'object') ? o.w : {};
      Object.keys(disk).forEach(function(k) { if (!_w[k] && disk[k] && typeof disk[k] === 'object') _w[k] = disk[k]; });
    } catch (e) {}
    _loaded = true;
    _prune(Date.now());
  });
  return _loading;
}

function _saveSoon() {
  if (_saveT) return;
  _saveT = setTimeout(function() {
    _saveT = null;
    var plugin = _nativePlugin();
    if (plugin) _safeNativeCall(plugin, 'saveToFile', { filename: EARLY_FILE, content: JSON.stringify({ v: 1, w: _w }) }).catch(function() {});
  }, 300);
}

function _prune(now) {
  var keys = Object.keys(_w), changed = false;
  keys.forEach(function(k) { if (!_w[k] || now - (_w[k].t || 0) > KEEP_MS) { delete _w[k]; changed = true; } });
  keys = Object.keys(_w).sort(function(a, b) { return (_w[a].t || 0) - (_w[b].t || 0); }); // lo más viejo primero
  var perChat = Object.create(null);
  keys.forEach(function(k) { var c = k.split('|')[0]; perChat[c] = (perChat[c] || 0) + 1; });
  keys.forEach(function(k) { var c = k.split('|')[0]; if (perChat[c] > MAX_CHAT) { perChat[c]--; delete _w[k]; changed = true; } });
  keys = Object.keys(_w).sort(function(a, b) { return (_w[a].t || 0) - (_w[b].t || 0); });
  while (keys.length > MAX_ALL) { delete _w[keys.shift()]; changed = true; }
  return changed;
}

// Guardar una acción de un mensaje que aún no está. kind: 'del' | 'edit' | 'react'. (La llaman vault_messages dentro del candado
// del chat, así no se cruza con el guardado del mensaje.) Devuelve true si quedó a la espera.
export function vaultEarlyQueue(cid, msgId, kind, value, who) {
  if (!cid || !msgId) return false;
  var k = _key(cid, msgId), now = Date.now();
  var w = _w[k] || { t: now };
  if (kind === 'del') { w = { t: w.t || now, d: 1 }; }
  else if (w.d) return true; // ya eliminado para todos: nada más que hacer
  else if (kind === 'edit') { if (typeof value !== 'string' || value.length > EDIT_MAX_CHARS) return false; w.e = value; }
  else if (kind === 'react') { w.r = w.r || {}; w.r[_normId(who || cid)] = (typeof value === 'string') ? value.slice(0, 8) : ''; }
  else return false;
  _w[k] = w;
  _prune(now);
  _saveSoon();
  return !!_w[k];
}

// ¿El que lo escribió ya lo eliminó para todos? (sin esperar: lo usan la llegada del mensaje y su aviso)
export function vaultEarlyTombstoned(cid, msgId) {
  if (!cid || !msgId) return false;
  var w = _w[_key(cid, msgId)];
  return !!(w && w.d && Date.now() - (w.t || 0) <= KEEP_MS);
}

// Al guardarse un mensaje RECIBIDO (n: el mensaje normalizado; existing: la copia que ya había, si había): aplica lo que
// esperaba. Cambia n. Devuelve { del, edit, react } con lo aplicado, o null.
export function vaultEarlyApply(cid, n, existing) {
  if (!n || !n.msgId) return null;
  var k = _key(cid, n.msgId), w = _w[k];
  if (!w) return null;
  if (Date.now() - (w.t || 0) > KEEP_MS) { delete _w[k]; _saveSoon(); return null; }
  if (w.d) {
    n.deleted = true; n.content = ''; n.text = '';
    n.attachmentType = null; n.attachmentPayload = null; n.attachmentRef = null; n.attachmentMeta = null;
    return { del: 1 };
  }
  var out = {};
  var isText = !n.attachmentType && !(existing && (existing.attachmentType || existing.deleted));
  if (typeof w.e === 'string' && isText) { n.content = w.e; n.text = w.e; n.edited = true; out.edit = 1; }
  if (w.r) {
    var rs = Object.assign({}, (existing && existing.reactions) || {});
    Object.keys(w.r).forEach(function(who) { if (w.r[who]) rs[who] = w.r[who]; else delete rs[who]; });
    n.reactions = rs; out.react = 1;
  }
  delete _w[k]; // aplicadas: una copia que llegue después no las repite (la reacción pudo cambiar entretanto)
  _saveSoon();
  return (out.edit || out.react) ? out : null;
}
