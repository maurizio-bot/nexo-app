// Dueño 16-11: opción por chat «Ocultar el texto en los avisos». Con ella puesta, el aviso de ESE chat sale como el genérico
// («Mensaje nuevo», sin vista previa); los demás chats no cambian. Se guarda por NEXO ID en el mismo almacén que los fijados
// (archivo del vault vía plugin). El interruptor global (bloqueo de la app) sigue mandando: ver main.js → hidePreview.
export var HIDE_PREVIEW_FILE = 'nexo_hide_preview.json';
var _set = null;
function _n(id) { return (id || '').toString().toLowerCase().trim(); }
function _plugin() { return (typeof window !== 'undefined' && window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.NexoBLE) || null; }
function _all() { if (!_set) _set = new Set(); return _set; }

export function isPreviewHidden(chatId) { var id = _n(chatId); return !!id && _all().has(id); }

export function setPreviewHidden(chatId, on) {
  var id = _n(chatId); if (!id) return false;
  if (on) _all().add(id); else _all().delete(id);
  var p = _plugin();
  if (p && typeof p.saveToFile === 'function') {
    try { Promise.resolve(p.saveToFile({ filename: HIDE_PREVIEW_FILE, content: JSON.stringify({ hidden: Array.from(_all()), savedAt: Date.now() }) })).catch(function() {}); } catch (e) {}
  }
  return !!on;
}

export function toggleHidePreview(chatId) { var on = !isPreviewHidden(chatId); setPreviewHidden(chatId, on); return on; }

export function loadHidePreview() {
  var p = _plugin();
  if (!p || typeof p.loadFromFile !== 'function') return Promise.resolve();
  try {
    return Promise.resolve(p.loadFromFile({ filename: HIDE_PREVIEW_FILE })).then(function(r) {
      if (r && r.exists && r.content) { try { var d = JSON.parse(r.content); if (d && Array.isArray(d.hidden)) d.hidden.forEach(function(x) { _all().add(_n(x)); }); } catch (e) {} }
    }).catch(function() {});
  } catch (e) { return Promise.resolve(); }
}
export function _resetForTest() { _set = null; }
