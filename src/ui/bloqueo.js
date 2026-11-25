/**
 * BLOQUEAR CONTACTO (dueño 24-11, como WhatsApp). Se elige en el ⋮ del contacto en la lista, en las opciones del chat (tocar su
 * círculo en la cabecera) y en su perfil; se desbloquea desde los mismos sitios y desde la lista de Ajustes → Seguridad → Privacidad.
 * - Lo suyo NO entra: mensajes, llamadas, estados, foto de perfil, sus datos, acciones del chat y solicitudes (ble_receive._handlePayload,
 *   el punto por el que pasa todo lo que llega: Bluetooth, Wi-Fi, internet, puente). Sin aviso y SIN ✓✓: sus mensajes se le quedan en ✓.
 * - Lo mío NO le sale: ni mensajes, ni llamadas, ni estados, ni foto, ni mis datos (ble_send.sendChatMessage rechaza con BLOCKED), ni el
 *   saludo de internet que me pone «en línea» para él (net_link._hello). Por Bluetooth de cerca el enlace sigue (hace de puente).
 * - Él no se entera: no se le manda nada que lo diga.
 * - En los GRUPOS se le sigue viendo (como WhatsApp): sus mensajes de grupo y las llamadas de grupo siguen.
 * - PRINCIPIO NEXO: se le sigue haciendo de PUENTE (Jump, puente a internet) para los demás: eso va cifrado y no es «lo suyo para mí».
 * Con la app cerrada o congelada lo hace la parte nativa (setMutedChats blocked → MutedChats.kt / BgInbox.classify): ni buzón, ni aviso,
 * ni llamada, ni ✓✓; y por internet la escucha nativa no recibe su clave de pareja (net_link._bgConfig), así que no abre sus sobres.
 * Se guarda en este teléfono (localStorage, lectura al instante desde el primer paquete) y la parte nativa lo guarda cifrado.
 */
// Sin dependencias de la interfaz (lo importan también net_link y ble_send); lo de pantalla está en bloqueo_ui.js

export var BLOCK_KEY = 'nexo_blocked';
export var BLOCK_FILE = 'nexo_blocked.json'; // copia cifrada en el teléfono (vault vía plugin), por si se borra la memoria de la vista web
var _fromStore = false; // ¿la lista salió de localStorage? (si no, al arrancar manda la copia guardada)
var NX_RE = /^nx[0-9a-z]{8}$/;
var _b = null;   // NEXO ID → cuándo se bloqueó (ms)

function _n(id) { return (id || '').toString().toLowerCase().trim(); }
function _plugin() { return (typeof window !== 'undefined' && window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.NexoBLE) || null; }
function _all() {
  if (_b) return _b;
  _b = {};
  try {
    var raw = typeof localStorage !== 'undefined' ? localStorage.getItem(BLOCK_KEY) : null;
    _fromStore = raw != null;
    var o = raw ? JSON.parse(raw) : null;
    if (o && typeof o === 'object') Object.keys(o).forEach(function(k) { var nx = _n(k); if (NX_RE.test(nx)) _b[nx] = Number(o[k]) || 1; });
  } catch (e) {}
  return _b;
}

export function isBlocked(nx) { var id = _n(nx); return NX_RE.test(id) && Object.prototype.hasOwnProperty.call(_all(), id); }
export function blockedIds() { return Object.keys(_all()).sort(); }

// La parte nativa (app cerrada o congelada): solo la lista de bloqueados («chats» no se manda: los silenciados quedan como están)
export function pushBlockedNative() {
  var p = _plugin();
  if (!p || typeof p.setMutedChats !== 'function') return;
  try { Promise.resolve(p.setMutedChats({ blocked: blockedIds() })).catch(function() {}); } catch (e) {}
}

function _changed(id) {
  try { window.dispatchEvent(new CustomEvent('nexo:block', { detail: { id: id, blocked: isBlocked(id) } })); } catch (e) {}
  var bi = typeof window !== 'undefined' ? window.bleInterface : null;
  if (bi) {
    // la escucha nativa de internet deja de tener (o vuelve a tener) su clave de pareja
    try { if (bi.net && typeof bi.net._bgConfig === 'function') bi.net._bgConfig(); } catch (e) {}
    if (typeof bi.renderContactsList === 'function') { try { bi.renderContactsList(); } catch (e) {} }
  }
}

// Lo que mandó MIENTRAS estaba bloqueado no entra tampoco después (como WhatsApp): su teléfono lo sigue reintentando (no tuvo ✓✓) y
// al desbloquear llegaría. Se guarda el último periodo de bloqueo de cada uno (14 días) y se compara con la hora del mensaje (la de su
// teléfono: con 10 s de margen, para no tirar algo escrito justo después de desbloquear con su reloj un poco atrasado).
export var BLOCK_PAST_KEY = 'nexo_blocked_past';
var PAST_MS = 14 * 24 * 3600000, SKEW_MS = 10000;
function _past() {
  var o = {};
  try { var raw = typeof localStorage !== 'undefined' ? localStorage.getItem(BLOCK_PAST_KEY) : null; var p = raw ? JSON.parse(raw) : null; if (p && typeof p === 'object') o = p; } catch (e) {}
  return o;
}
export function sentWhileBlocked(nx, ts) {
  var id = _n(nx), t = Number(ts);
  if (!NX_RE.test(id) || !isFinite(t) || t <= 0) return false;
  var p = _past()[id];
  return !!(p && Array.isArray(p) && Date.now() - p[1] < PAST_MS && t >= p[0] && t < p[1] - SKEW_MS);
}

// ¿Este mensaje (id «msg» + hora de cuando lo escribió; si no, ts) lo mandó mientras lo tenía bloqueado?
export function msgWhileBlocked(nx, msgId, ts) {
  var m = String(msgId || '').match(/^msg_?(1\d{12})/);
  return sentWhileBlocked(nx, m ? m[1] : ts);
}

export function setBlocked(nx, on) {
  var id = _n(nx);
  if (!NX_RE.test(id)) return false;
  if (!on && _all()[id]) {
    try {
      var past = _past(), now = Date.now();
      Object.keys(past).forEach(function(k) { if (!Array.isArray(past[k]) || now - past[k][1] > PAST_MS) delete past[k]; });
      past[id] = [Number(_all()[id]) || 0, now];
      if (typeof localStorage !== 'undefined') localStorage.setItem(BLOCK_PAST_KEY, JSON.stringify(past));
    } catch (e) {}
  }
  if (on) _all()[id] = Date.now(); else delete _all()[id];
  _persist();
  pushBlockedNative();
  console.log('[BLOQUEO] ' + id + (on ? ' bloqueado' : ' desbloqueado'));
  _changed(id);
  return isBlocked(id);
}

function _persist() {
  var s = JSON.stringify(_all());
  try { if (typeof localStorage !== 'undefined') localStorage.setItem(BLOCK_KEY, s); } catch (e) {}
  var p = _plugin();
  if (p && typeof p.saveToFile === 'function') { try { Promise.resolve(p.saveToFile({ filename: BLOCK_FILE, content: s })).catch(function() {}); } catch (e) {} }
}

// Al arrancar: si la memoria de la vista web no la tiene, se toma la copia guardada; la parte nativa recibe la lista
export function loadBlocked() {
  _all();
  var p = _plugin();
  if (_fromStore || !p || typeof p.loadFromFile !== 'function') { pushBlockedNative(); return Promise.resolve(); }
  try {
    return Promise.resolve(p.loadFromFile({ filename: BLOCK_FILE })).then(function(r) {
      var n = 0;
      if (r && r.exists && r.content) {
        try { var o = JSON.parse(r.content); if (o && typeof o === 'object') Object.keys(o).forEach(function(k) { var nx = _n(k); if (NX_RE.test(nx) && !_all()[nx]) { _all()[nx] = Number(o[k]) || 1; n++; } }); } catch (e) {}
      }
      if (n) { try { localStorage.setItem(BLOCK_KEY, JSON.stringify(_all())); } catch (e) {} console.log('[BLOQUEO] ' + n + ' bloqueado(s) desde la copia guardada'); _changed(''); }
      pushBlockedNative();
    }).catch(function() { pushBlockedNative(); });
  } catch (e) { pushBlockedNative(); return Promise.resolve(); }
}

// ¿Este contenido (lo que sale a un bloqueado o llega de él) es de un GRUPO? Eso sigue (en los grupos se le sigue viendo)
export function isGroupWire(content) {
  return typeof content === 'string' && (content.indexOf('"nexo_grp"') >= 0 || content.indexOf('"nexo_gcall"') >= 0);
}

try { if (typeof window !== 'undefined') window.__nexoBlock = { set: setBlocked, isBlocked: isBlocked, list: blockedIds }; } catch (e) {} // gancho de pruebas (bloqueo.js)
