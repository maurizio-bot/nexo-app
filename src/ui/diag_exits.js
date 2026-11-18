/**
 * NEXO — Cierres de la app en el diagnóstico (3120; «build forense» pendiente desde el 11-11: el 15-11 el dueño vio en su S24
 * «NEXO se bloqueó más de 10 veces en la última semana» —era el bucle del APK de 25 MB del 10-11, ya arreglado— y el diagnóstico no
 * decía nada de los cierres). Al arrancar se pide UNA vez al nativo (getExitReasons) la lista que guarda Android (desde la 11) de los
 * cierres de los últimos 7 días con su motivo, el hilo principal si se congeló y los fallos guardados al caer (CrashLog). Sale en el
 * diagnóstico («Cierres de la app») y, si hay un cierre con problema nuevo (fallo, congelada, sin memoria) de las últimas 24 h, se
 * manda un diagnóstico automático («cierre_fallo») cuando la app ya arrancó del todo.
 * Perillas de prueba: window.NEXO_EXITS_DELAY_MS (espera antes del síntoma), window.NEXO_EXITS_NOW (reloj).
 */
var SEEN_KEY = 'nexo_exits_seen', DELAY_MS = 90 * 1000, NEW_MS = 24 * 3600 * 1000, MAX_ROWS = 12, MAX_CRASH_LINES = 40;
var _res = null, _inited = false;

function _now() { return (typeof window !== 'undefined' && typeof window.NEXO_EXITS_NOW === 'function') ? window.NEXO_EXITS_NOW() : Date.now(); }
function _plugin() { return (typeof window !== 'undefined' && window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.NexoBLE) || null; }
function _p2(n) { return (n < 10 ? '0' : '') + n; }
function _when(ms) { var d = new Date(ms); return _p2(d.getDate()) + '-' + _p2(d.getMonth() + 1) + ' ' + _p2(d.getHours()) + ':' + _p2(d.getMinutes()); }
function _seen() { try { return Number(localStorage.getItem(SEEN_KEY)) || 0; } catch (e) { return 0; } }
function _setSeen(v) { try { localStorage.setItem(SEEN_KEY, String(v)); } catch (e) {} }
// 3127 (diagnóstico S24 3067): Android también apunta los cierres del proceso aparte que dibuja la pantalla («[ISOLATED NOT NEEDED]»,
// al actualizar o al quedar sin uso). Son normales: se cuentan aparte para que no tapen los de la app.
function _isIsolated(e) { return /isolated/i.test(String((e && e.desc) || '')); }
function _all() { return (_res && Array.isArray(_res.exits)) ? _res.exits.slice().sort(function(a, b) { return (b.t || 0) - (a.t || 0); }) : []; }
function _list() { return _all().filter(function(e) { return !_isIsolated(e); }); }
function _row(e) { return _when(e.t) + ' ' + (e.label || ('motivo ' + e.reason)) + (e.fg ? ' (a la vista)' : ' (detrás)') + (e.desc ? ' — ' + e.desc : ''); } // i18n-ok: texto para el desarrollador

/** Líneas para el diagnóstico (vacío si aún no se pidió al nativo o no hay nativo). */
export function exitsLines() {
  if (!_res) return [];
  var out = [];
  if (_res.sdk && _res.sdk < 30) return ['Cierres de la app: Android ' + _res.sdk + ' no los guarda (hace falta Android 11)']; // i18n-ok
  var list = _list(), bad = list.filter(function(e) { return e.problem; }), iso = _all().length - list.length;
  out.push('Cierres de la app (7 días): ' + list.length + (bad.length ? ', ' + bad.length + ' con problema' : ', ninguno con problema') + // i18n-ok
    (iso ? ' (+' + iso + ' del proceso que dibuja la pantalla, normales)' : '') + // i18n-ok
    (_res.maxMemMb ? ' · memoria máx. de la app ' + _res.maxMemMb + ' MB' : '') + (_res.error ? ' · error al leerlos: ' + _res.error : '')); // i18n-ok
  list.slice(0, MAX_ROWS).forEach(function(e) { out.push('  ' + (e.problem ? '⚠ ' : '') + _row(e)); });
  if (list.length > MAX_ROWS) out.push('  … y ' + (list.length - MAX_ROWS) + ' más'); // i18n-ok
  var anr = list.filter(function(e) { return e.trace; })[0];
  if (anr) { out.push('  ' + (anr.reason === 5 ? 'Pistas del fallo nativo' : 'Hilo principal en la congelada') + ' del ' + _when(anr.t) + ':'); String(anr.trace).split('\n').slice(0, 25).forEach(function(l) { out.push('    ' + l); }); } // i18n-ok
  if (_res.crashes) {
    out.push('Fallos guardados al caer (el más reciente primero):'); // i18n-ok
    String(_res.crashes).split('\n').filter(function(l) { return l.trim(); }).slice(0, MAX_CRASH_LINES).forEach(function(l) { out.push('  ' + l); });
  }
  return out;
}

// Cierres con problema nuevos (desde el último visto y de las últimas 24 h): uno solo por arranque, el más reciente
function _newProblem() {
  var since = Math.max(_seen(), _now() - NEW_MS), list = _list(), max = _seen();
  list.forEach(function(e) { if (e.t > max) max = e.t; });
  if (max > _seen()) _setSeen(max);
  var bad = list.filter(function(e) { return e.problem && e.t > since; });
  return bad.length ? { e: bad[0], n: bad.length } : null;
}

/** Pide la lista al nativo (una vez por arranque). Devuelve una promesa con el resultado (o null). */
export function exitsInit() {
  if (_inited) return Promise.resolve(_res);
  _inited = true;
  var pl = _plugin();
  if (!pl || typeof pl.getExitReasons !== 'function') return Promise.resolve(null);
  return Promise.resolve(pl.getExitReasons()).then(function(r) {
    _res = r || null;
    if (!_res) return null;
    var nb = _newProblem();
    if (nb) {
      var info = _when(nb.e.t) + ' ' + nb.e.label + (nb.e.fg ? ', a la vista' : ', detrás') + (nb.n > 1 ? ' (+' + (nb.n - 1) + ')' : ''); // i18n-ok
      console.log('[CIERRES] Cierre con problema desde la última vez: ' + info);
      var delay = (typeof window.NEXO_EXITS_DELAY_MS === 'number') ? window.NEXO_EXITS_DELAY_MS : DELAY_MS;
      setTimeout(function() { try { window.dispatchEvent(new CustomEvent('nexo:diag:symptom', { detail: { kind: 'cierre_fallo', info: info } })); } catch (e) {} }, delay);
    }
    return _res;
  }).catch(function() { return null; });
}

// Gancho de pruebas
try { if (typeof window !== 'undefined') window.__nexoExits = { lines: exitsLines, init: exitsInit }; } catch (e) {}
