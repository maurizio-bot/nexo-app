/**
 * NEXO — Batería, temperatura y tiempo de cada llamada en el diagnóstico (3256; dueño 20-11: «en lugar de decirme "checa la hora y la
 * temperatura", que el diagnóstico las mida solo y sea parte del estándar»).
 * Al empezar una llamada se anota nivel, temperatura y hora; durante ella, una muestra por minuto (temperatura máxima); al colgar, una línea con
 * lo que bajó la batería, los %/h, la temperatura inicial/final/máxima y el estado térmico. Solo medidas del teléfono (nativo getPowerStatus):
 * nada de contenido. Límite honesto: es el gasto de TODO el teléfono durante la llamada (pantalla, cámara, radio…), no de NEXO sola.
 */
var SAMPLE_MS = 60000;
var THERMAL = ['normal', 'ligero', 'moderado', 'severo', 'crítico', 'emergencia', 'apagado']; // i18n-ok: texto para el desarrollador (PowerManager.THERMAL_STATUS_*)

function _plugin() { return (typeof window !== 'undefined' && window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.NexoBLE) || null; }
function _n1(x) { return (Math.round(x * 10) / 10).toString().replace('.', ','); }
function _t1(x) { return (Math.round(x * 10) / 10).toFixed(1).replace('.', ','); } // temperaturas: siempre con un decimal

/** Una muestra del teléfono: {at, level, charging, temp, thermal} (null si el nativo no la da). */
export function readPower() {
  var pl = _plugin(); if (!pl || typeof pl.getPowerStatus !== 'function') return Promise.resolve(null);
  return Promise.resolve(pl.getPowerStatus()).then(function(r) {
    if (!r || typeof r.level !== 'number') return null;
    return { at: Date.now(), level: r.level, charging: !!r.charging, temp: typeof r.temp === 'number' ? r.temp : null, thermal: typeof r.thermal === 'number' ? r.thermal : null };
  }).catch(function() { return null; });
}

/** Estado térmico en palabras (null si es normal o no se sabe). */
export function thermalWord(t) { return (typeof t === 'number' && t > 0 && THERMAL[t]) ? THERMAL[t] : null; }

/** Texto de una muestra suelta (para las líneas de cada minuto). */
export function powerNow(s) {
  if (!s) return 'batería y temperatura: sin dato'; // i18n-ok: texto para el desarrollador
  var p = ['batería ' + s.level + ' %' + (s.charging ? ' (cargando)' : '')];
  if (s.temp != null) p.push('temperatura ' + _t1(s.temp) + ' °C');
  var th = thermalWord(s.thermal); if (th) p.push('estado térmico ' + th);
  return p.join(', ');
}

/** Resumen de una llamada: lo que bajó la batería y cómo cambió la temperatura. a = muestra inicial, b = final, maxTemp = la mayor vista. */
export function callPowerSummary(a, b, maxTemp) {
  if (!a || !b) return 'batería y temperatura: sin dato'; // i18n-ok: texto para el desarrollador
  var mins = Math.max(0, (b.at - a.at) / 60000), p = [];
  if (a.charging || b.charging) p.push('batería ' + a.level + ' % → ' + b.level + ' % (cargando: no se calcula el gasto)'); // i18n-ok: texto para el desarrollador
  else {
    var drop = a.level - b.level;
    if (drop < 0) p.push('batería ' + a.level + ' % → ' + b.level + ' % (subió: se cargó)');
    else p.push('batería ' + a.level + ' % → ' + b.level + ' % (-' + drop + ' puntos en ' + _n1(mins) + ' min' + (mins >= 5 ? ', ' + _n1(drop / (mins / 60)) + ' %/h' : '; muy corto para dar %/h') + ')');
  }
  if (a.temp != null && b.temp != null) p.push('temperatura ' + _t1(a.temp) + ' → ' + _t1(b.temp) + ' °C' + (typeof maxTemp === 'number' ? ' (máx. ' + _t1(Math.max(maxTemp, a.temp, b.temp)) + ' °C)' : ''));
  var th = thermalWord(b.thermal); if (th) p.push('estado térmico al final: ' + th);
  return p.join(', ');
}

/** Al empezar la llamada: anota la muestra inicial en c.pw (no bloquea nada). */
export function callPowerStart(c) {
  if (!c) return;
  c.pw = { a: null, last: null, max: null, at: Date.now() };
  readPower().then(function(s) { if (s && c.pw) { c.pw.a = s; c.pw.last = s; c.pw.max = s.temp; console.log('[CALL] Batería y temperatura al empezar: ' + powerNow(s)); } }); // i18n-ok: registro
}

/** Cada vez que el diagnóstico de la llamada corre: una muestra por minuto (temperatura máxima) con su línea. */
export function callPowerTick(c) {
  if (!c || !c.pw || Date.now() - c.pw.at < SAMPLE_MS) return;
  c.pw.at = Date.now();
  readPower().then(function(s) {
    if (!s || !c.pw) return;
    c.pw.last = s; if (s.temp != null && (c.pw.max == null || s.temp > c.pw.max)) c.pw.max = s.temp;
    console.log('[CALL] Batería y temperatura: ' + powerNow(s) + (c.startedAt ? ' (a los ' + Math.round((Date.now() - c.startedAt) / 60000) + ' min)' : '')); // i18n-ok: registro
  });
}

/** Al colgar: la línea de resumen (con una muestra final fresca). */
export function callPowerEnd(c, secs) {
  if (!c || !c.pw) return;
  var pw = c.pw; c.pw = null;
  readPower().then(function(b) {
    if (b && b.temp != null && (pw.max == null || b.temp > pw.max)) pw.max = b.temp;
    console.log('[CALL] Batería y temperatura en la llamada (' + Math.round((secs || 0) / 60) + ' min): ' + callPowerSummary(pw.a, b || pw.last, pw.max)); // i18n-ok: registro
  });
}
