/**
 * 3323 (dueño 24-11, decisión B: «lo que yo ayudo, me ayudan»): RECIPROCIDAD del puente a internet. El que presta su internet da TEXTOS
 * a cualquiera (la emergencia: un texto pesa casi nada), pero fotos, audios y archivos solo a quien LE AYUDÓ a él en los últimos 30 días:
 * le prestó su internet o le hizo de puente por Bluetooth (un paquete para mí que llegó por su enlace con saltos). La libreta es de este
 * teléfono (sin servidor): un NEXO ID recién creado o dos teléfonos propios no se fabrican crédito ante nadie más. Se guarda en
 * nexo_gw_help.json (cifrado como el resto por el plugin) y la parte nativa recibe la lista con la configuración de la escucha
 * (net_link _bgConfig → gwHelp) para aplicar la misma regla con la app dormida o cerrada (GwServe.kt).
 */
export var GW_HELP_FILE = 'nexo_gw_help.json';
export var GW_HELP_MS = 30 * 24 * 3600 * 1000;
export var GW_TEXT_MAX = 16384;   // lo que pasa para quien no ha ayudado: un evento de texto (no un trozo de archivo)
var MAX = 500;
var _m = null, _loading = null, _saveT = null;

function _plugin() { return (typeof window !== 'undefined' && window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.NexoBLE) || null; }
function _nid(x) { return String(x || '').toLowerCase().trim(); }

export function loadHelp() {
  if (_loading) return _loading;
  var p = _plugin();
  _m = _m || new Map();
  _loading = (p && typeof p.loadFromFile === 'function'
    ? Promise.resolve(p.loadFromFile({ filename: GW_HELP_FILE })).then(function(r) {
        try {
          var d = r && r.exists && r.content ? JSON.parse(r.content) : null;
          if (d && d.h && typeof d.h === 'object') Object.keys(d.h).forEach(function(k) { var t = Number(d.h[k]); if (/^nx[0-9a-z]{8}$/.test(k) && t > 0 && !_m.has(k)) _m.set(k, t); });
        } catch (e) {}
      }).catch(function() {})
    : Promise.resolve()).then(function() { return _m; });
  return _loading;
}

function _save() {
  var p = _plugin();
  if (!p || typeof p.saveToFile !== 'function' || !_m) return;
  clearTimeout(_saveT);
  _saveT = setTimeout(function() {
    var h = {}; _m.forEach(function(t, k) { h[k] = t; });
    try { Promise.resolve(p.saveToFile({ filename: GW_HELP_FILE, content: JSON.stringify({ v: 1, h: h }) })).catch(function() {}); } catch (e) {}
  }, 2000);
}

/** nx me ayudó ahora (me prestó su internet o me hizo de puente). */
export function noteHelp(nx, how) {
  nx = _nid(nx);
  if (!/^nx[0-9a-z]{8}$/.test(nx)) return false;
  _m = _m || new Map();
  var had = _m.has(nx) && Date.now() - _m.get(nx) < GW_HELP_MS;
  _m.delete(nx); _m.set(nx, Date.now());
  while (_m.size > MAX) _m.delete(_m.keys().next().value);
  if (!had) console.log('[GW] ' + nx + ' me ayudó (' + (how || 'puente') + '): le presto también fotos y audios 30 días');
  if (!had) { try { window.dispatchEvent(new CustomEvent('nexo:gwhelp', { detail: nx })); } catch (e) {} }
  _save();
  return !had;
}

/** ¿nx me ayudó en los últimos 30 días? */
export function helped(nx) {
  var t = _m && _m.get(_nid(nx));
  return !!(t && Date.now() - t < GW_HELP_MS);
}

/** Los que me ayudaron (para la parte nativa). */
export function helperList() {
  var out = [], now = Date.now();
  if (_m) _m.forEach(function(t, k) { if (now - t < GW_HELP_MS) out.push(k); });
  return out;
}

export function _helpReset() { _m = new Map(); _loading = null; }

if (typeof window !== 'undefined') { window.__nexoGwHelp = { noteHelp: noteHelp, helped: helped }; setTimeout(function() { loadHelp(); }, 0); } // (pruebas)
