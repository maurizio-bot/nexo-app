/**
 * NEXO — Registro de diagnóstico (sacado de main.js en la ronda 2752, sin cambios): copia la consola (también la
 * sesión anterior) para Perfil → Copiar diagnóstico, con los eventos clave aparte.
 */
// ===================== v9.9.32: registro de diagnóstico =====================
// Últimas líneas de la consola (también de la sesión anterior) para verlas en Perfil → Diagnóstico y
// copiarlas: lo que pasa en el teléfono real sin necesidad de un PC.
// v9.9.40 (seguridad): archivo nuevo; el anterior podía tener fragmentos de mensajes y se borra
var DIAG_MAX = 800, DIAG_KEY_MAX = 700, DIAG_FILE = 'nexo_diag_log2.txt', DIAG_OLD_FILE = 'nexo_diag_log.txt';
var _diagLines = [], _diagKey = [], _diagDirty = false, _diagPrev = '';
// Eventos clave: se guardan aparte para que el detalle de una transferencia larga no los borre
var DIAG_KEY_RE = /BT_ERR|\[BIN\]|\[VIDEO\]|\[NET\]|\[SEND\]|\[WIFI\]|FILE_IO|AT_REST|\[LOCK\]|\[E2E\]|\[JUMP\]|\[WIFI-DIRECT\]|\[ATTACH\]|\[CAMERA\]|sendFile|Reenvi|peerReady|Peer ready|App de vuelta|Re-búsqueda|desconect|Disconnect|GLOBAL TIMEOUT|Assembly timeout|Archivo recibido|^\S+ [WE] /;
(function() {
  function fmt(a) {
    if (typeof a === 'string') return a;
    if (a && a.message) return a.message;
    try { return JSON.stringify(a, function(k, v) { return (typeof v === 'string' && v.length > 120) ? v.substring(0, 120) + '…' : v; }); } catch (e) { return String(a); }
  }
  ['log', 'info', 'warn', 'error'].forEach(function(level) {
    var orig = console[level] ? console[level].bind(console) : function() {};
    console[level] = function() {
      try {
        var parts = [];
        for (var i = 0; i < arguments.length; i++) parts.push(fmt(arguments[i]));
        var d = new Date();
        var ts = ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2) + ':' + ('0' + d.getSeconds()).slice(-2) + '.' + ('00' + d.getMilliseconds()).slice(-3);
        var line = ts + (level === 'warn' ? ' W ' : level === 'error' ? ' E ' : ' ') + parts.join(' ').substring(0, 300);
        _diagLines.push(line);
        if (_diagLines.length > DIAG_MAX) _diagLines.splice(0, _diagLines.length - DIAG_MAX);
        if (DIAG_KEY_RE.test(line)) { _diagKey.push(line); if (_diagKey.length > DIAG_KEY_MAX) _diagKey.splice(0, _diagKey.length - DIAG_KEY_MAX); }
        _diagDirty = true;
      } catch (e) {}
      return orig.apply(null, arguments);
    };
  });
  window.addEventListener('error', function(e) { console.error('[ERROR] ' + (e && e.message) + ' @' + (e && e.filename) + ':' + (e && e.lineno)); });
  window.addEventListener('unhandledrejection', function(e) { console.warn('[PROMESA] ' + (e && e.reason && (e.reason.message || e.reason))); });
  function plugin() { return window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.NexoBLE; }
  setTimeout(function() {
    var pl = plugin();
    if (!pl || typeof pl.loadFromFile !== 'function') return;
    pl.loadFromFile({ filename: DIAG_FILE }).then(function(r) { if (r && r.exists && r.content) _diagPrev = r.content; }).catch(function() {});
    // v9.9.48: avisos nativos de archivos (lentos, cifrado en reposo); solo estas etiquetas (sin contenido)
    if (typeof pl.addListener === 'function') pl.addListener('onRemLog', function(d) {
      if (d && (d.tag === 'FILE_IO' || d.tag === 'AT_REST')) console[d.level === 'WARN' ? 'warn' : 'log']('[NATIVO] ' + d.tag + ': ' + d.message);
    });
    if (typeof pl.deleteFile === 'function') pl.deleteFile({ filename: DIAG_OLD_FILE }).catch(function() {});
  }, 500);
  setInterval(function() {
    var pl = plugin();
    if (!_diagDirty || !pl || typeof pl.saveToFile !== 'function') return;
    _diagDirty = false;
    pl.saveToFile({ filename: DIAG_FILE, content: _diagSessionText() }).catch(function() {});
  }, 20000);
})();

function _diagSessionText() {
  return '--- eventos clave ---\n' + _diagKey.join('\n') + '\n--- últimas líneas ---\n' + _diagLines.slice(-400).join('\n');
}

export function _diagnosticText() {
  var bi = window.bleInterface || {};
  var head = 'NEXO diagnóstico ' + new Date().toISOString() + '\nNEXO ID: ' + (bi.localNexoId || '?') + '\nUA: ' + navigator.userAgent + '\n';
  return head + (_diagPrev ? '\n===== SESIÓN ANTERIOR =====\n' + _diagPrev + '\n' : '') +
    '\n===== SESIÓN ACTUAL =====\n' + _diagSessionText();
}
