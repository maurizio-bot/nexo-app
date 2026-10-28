/**
 * NEXO — Registro de diagnóstico (sacado de main.js en la ronda 2752, sin cambios): copia la consola (también la
 * sesión anterior) para Perfil → Copiar diagnóstico, con los eventos clave aparte.
 */
// ===================== v9.9.32: registro de diagnóstico =====================
// Últimas líneas de la consola (también de la sesión anterior) para verlas en Perfil → Diagnóstico y
// copiarlas: lo que pasa en el teléfono real sin necesidad de un PC.
// v9.9.40 (seguridad): archivo nuevo; el anterior podía tener fragmentos de mensajes y se borra
var DIAG_MAX = 800, DIAG_FILE = 'nexo_diag_log2.txt', DIAG_OLD_FILE = 'nexo_diag_log.txt';
var _diagLines = [], _diagKey = [], _diagTimes = [], _diagKeyTimes = [], _diagDirty = false, _diagPrev = '';
// Ventana del diagnóstico: 30 min (pedido del dueño 28-10; antes era 1 h). Para que el texto quepa al pegarlo.
var DIAG_WINDOW_MS = 30 * 60 * 1000;
var DIAG_WINDOW_LABEL = 'últimos 30 min';
// Tope de líneas del diagnóstico (pedido del dueño 28-10: ~5000; 20 mil era excesivo). Dos niveles: se limitan los
// «eventos clave» por sesión (así el total queda holgadamente por debajo del tope, con el registro nativo y las
// cabeceras intactos) y, como garantía dura, nunca se pasa de MAX_DIAG_LINES (se queda la cabecera y lo más reciente).
var MAX_DIAG_LINES = 5000;
var DIAG_KEY_MAX = 1500; // «eventos clave» por sesión (actual y anterior)
// Ronda 2785 (#87): registro nativo persistente (NativeLog.kt). La parte nativa (NetBg por internet, Bluetooth con la
// app cerrada, WifiLock, energía, ciclo de vida) lo escribe en disco; aquí lo recogemos al abrir la app para ver qué
// hizo mientras estaba cerrada (el registro de consola de arriba no existe sin WebView).
var _nativeLog = '';
// Eventos clave: se guardan aparte para que el detalle de una transferencia larga no los borre
var DIAG_KEY_RE = /BT_ERR|\[BIN\]|\[MTU\]|\[VIDEO\]|\[NET\]|\[SEND\]|\[WIFI\]|FILE_IO|AT_REST|\[LOCK\]|\[E2E\]|\[JUMP\]|\[WIFI-DIRECT\]|\[ATTACH\]|\[CAMERA\]|\[CALL\]|\[ADD\]|sendFile|Reenvi|peerReady|Peer ready|App de vuelta|Re-búsqueda|desconect|Disconnect|GLOBAL TIMEOUT|Assembly timeout|Archivo recibido|^\S+ [WE] /;
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
        _diagLines.push(line); _diagTimes.push(d.getTime());
        if (_diagLines.length > DIAG_MAX) { var ex = _diagLines.length - DIAG_MAX; _diagLines.splice(0, ex); _diagTimes.splice(0, ex); }
        if (DIAG_KEY_RE.test(line)) { _diagKey.push(line); _diagKeyTimes.push(d.getTime()); if (_diagKey.length > DIAG_KEY_MAX) { var ek = _diagKey.length - DIAG_KEY_MAX; _diagKey.splice(0, ek); _diagKeyTimes.splice(0, ek); } }
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
    // Ronda 2785 (#87): lo que hizo la parte nativa con la app cerrada (recién abierta, es lo más valioso para el #87)
    if (typeof pl.readNativeLog === 'function') pl.readNativeLog().then(function(r) { if (r && r.content) _nativeLog = r.content; }).catch(function() {});
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
    // Ronda 2812 (pedido del dueño: «solo una hora»): se guarda SOLO la última hora, así la próxima sesión carga
    // como «sesión anterior» un registro ya recortado y el diagnóstico no se hace enorme.
    pl.saveToFile({ filename: DIAG_FILE, content: _diagSessionText(true) }).catch(function() {});
    // Refrescar el registro nativo (crece mientras la app está en segundo plano)
    if (typeof pl.readNativeLog === 'function') pl.readNativeLog().then(function(r) { if (r && r.content) _nativeLog = r.content; }).catch(function() {});
  }, 20000);
})();

function _diagSessionText(hourOnly) {
  var key = _diagKey, lines = _diagLines;
  if (hourOnly) {
    // Ronda 2784 / 28-10 (pedido del dueño): solo los últimos 30 min, para que el diagnóstico quepa al pegarlo
    var cut = Date.now() - DIAG_WINDOW_MS;
    key = _diagKey.filter(function(l, i) { return _diagKeyTimes[i] >= cut; });
    lines = _diagLines.filter(function(l, i) { return _diagTimes[i] >= cut; });
  }
  return '--- eventos clave ---\n' + key.slice(-DIAG_KEY_MAX).join('\n') + '\n--- últimas líneas ---\n' + lines.slice(-400).join('\n');
}

// Ronda 2812 / 28-10 (pedido del dueño: «solo 30 minutos»): recorta un texto ya guardado (la sesión anterior) a la
// ventana (DIAG_WINDOW_MS) mirando la hora al inicio de cada línea (HH:MM:SS). Las líneas sin hora (cabeceras) se mantienen.
function _lastHourText(text) {
  if (!text) return text;
  var now = new Date();
  var nowSec = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
  return text.split('\n').filter(function(l) {
    var m = /^(\d{2}):(\d{2}):(\d{2})/.exec(l);
    if (!m) return true; // cabeceras («--- eventos clave ---», etc.): se mantienen
    var s = (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]);
    var diff = nowSec - s; if (diff < 0) diff += 86400; // la medianoche: la hora da la vuelta
    return diff <= DIAG_WINDOW_MS / 1000;
  }).join('\n');
}

// Garantía dura de tamaño: nunca más de MAX_DIAG_LINES líneas. Mantiene la cabecera (NEXO ID, UA) y las MÁS RECIENTES.
function _capDiag(text) {
  var lines = text.split('\n');
  if (lines.length <= MAX_DIAG_LINES) return text;
  var keepHead = lines.slice(0, 3);
  var keepTail = lines.slice(lines.length - (MAX_DIAG_LINES - keepHead.length - 1));
  return keepHead.concat(['… (diagnóstico recortado a ' + MAX_DIAG_LINES + ' líneas; se muestran las más recientes) …'], keepTail).join('\n');
}

export function _diagnosticText() {
  var bi = window.bleInterface || {};
  var head = 'NEXO diagnóstico ' + new Date().toISOString() + ' (' + DIAG_WINDOW_LABEL + ')\nNEXO ID: ' + (bi.localNexoId || '?') + '\nUA: ' + navigator.userAgent + '\n';
  // Tanto la sesión actual como la anterior se recortan a la ventana (28-10, pedido del dueño: «solo 30 minutos»)
  // Ronda 2785 (#87): el registro nativo (últimas ~150 líneas) muestra qué hizo el nativo con la app cerrada
  var nat = _nativeLog ? ('\n===== REGISTRO NATIVO (segundo plano / app cerrada) =====\n' + _nativeLog.split('\n').slice(-150).join('\n') + '\n') : '';
  var prev = _lastHourText(_diagPrev);
  // L1 (auditoría 28-10): la garantía dura de ≤ MAX_DIAG_LINES se aplica de verdad (antes _capDiag estaba definida pero
  // no se llamaba; hoy el texto cabe por construcción, pero así el tope descrito no queda sin efecto si sube una cte).
  return _capDiag(head + nat + (prev ? '\n===== SESIÓN ANTERIOR (' + DIAG_WINDOW_LABEL + ') =====\n' + prev + '\n' : '') +
    '\n===== SESIÓN ACTUAL (' + DIAG_WINDOW_LABEL + ') =====\n' + _diagSessionText(true));
}
