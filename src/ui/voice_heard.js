/**
 * Dueño 23-11: «recibo 3 audios y debo saber cuál ya escuché y cuál me falta, visualmente». Las notas de voz RECIBIDAS que aún no se
 * escucharon llevan el botón de reproducir en color (cian) y un punto; al darle a reproducir pasan a escuchadas (gris). Es solo de este
 * teléfono: no se le dice nada al que lo mandó. Se guarda en un archivo propio (nexo_heard.json, cifrado como el resto por el plugin):
 * { since, ids: { msgId: 1 } }. Lo recibido ANTES de que existiera esto cuenta como escuchado (si no, todo el historial saldría «sin
 * escuchar»). Tope de ids recordados (los más viejos salen: un audio viejo ya no importa).
 */
export var HEARD_FILE = 'nexo_heard.json';
var MAX_IDS = 3000;
var _st = null;            // { since, ids }
var _loading = null;

function _plugin() { return (typeof window !== 'undefined' && window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.NexoBLE) || null; }

export function loadHeard() {
  if (_loading) return _loading;
  var p = _plugin();
  _loading = (p && typeof p.loadFromFile === 'function'
    ? Promise.resolve(p.loadFromFile({ filename: HEARD_FILE })).then(function(r) {
        try { var d = r && r.exists && r.content ? JSON.parse(r.content) : null; if (d && typeof d.since === 'number' && d.ids && typeof d.ids === 'object') _st = { since: d.since, ids: d.ids }; } catch (e) {}
      }).catch(function() {})
    : Promise.resolve()).then(function() {
      if (!_st) { _st = { since: Date.now(), ids: {} }; _save(); } // primera vez: todo lo de antes, escuchado
      return _st;
    });
  return _loading;
}

function _save() {
  var p = _plugin();
  if (!p || typeof p.saveToFile !== 'function' || !_st) return;
  try { Promise.resolve(p.saveToFile({ filename: HEARD_FILE, content: JSON.stringify(_st) })).catch(function() {}); } catch (e) {}
}

/** ¿Esta nota de voz recibida está SIN escuchar? (ts: cuándo llegó). Mientras no se cargó lo guardado, no se marca nada. */
export function isUnheard(msgId, ts) {
  if (!_st || !msgId) return false;
  if (_st.ids[msgId]) return false;
  return (Number(ts) || 0) >= _st.since;
}

/** Se le dio a reproducir: queda escuchada. */
export function markHeard(msgId) {
  if (!msgId) return;
  if (!_st) { loadHeard().then(function() { markHeard(msgId); }); return; }
  if (_st.ids[msgId]) return;
  _st.ids[msgId] = Date.now();
  var ks = Object.keys(_st.ids);
  if (ks.length > MAX_IDS) ks.sort(function(a, b) { return _st.ids[a] - _st.ids[b]; }).slice(0, ks.length - MAX_IDS).forEach(function(k) { delete _st.ids[k]; });
  _save();
}

/** Solo para pruebas. */
export function _heardReset(st) { _st = st || null; _loading = null; }

// Se carga al arrancar la app: así «desde cuándo» es el primer arranque con esto (lo recibido después, sin escuchar hasta oírlo)
if (typeof window !== 'undefined' && !window.__nexoNoHeardBoot) setTimeout(function() { loadHeard(); }, 0);
