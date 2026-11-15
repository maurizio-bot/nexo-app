/**
 * NEXO — Tiempo de uso y gasto de batería (3119; dueño 15-11: «el tiempo de uso de la aplicación y cuánto gasta NEXO de batería en el
 * tiempo de uso que se le da»). Para la meta de EDC («batería para un día entero»).
 * - Tiempo con la app A LA VISTA por día.
 * - Gasto de batería SIN CARGAR, separado en «con la app a la vista» y «en segundo plano», en % por hora. Se mide el nivel de batería del
 *   teléfono (getPowerStatus del nativo) al abrir y cerrar la app y cada SAMPLE_MS mientras corre; entre dos muestras sin cargar, lo que
 *   bajó se reparte según cuánto de ese rato estuvo la app a la vista.
 * Límite honesto: Android no le dice a una app cuánto gasta ELLA SOLA (eso está en Ajustes → Batería → Uso por app); esto es lo que gasta
 * el TELÉFONO mientras NEXO está a la vista o detrás, que es una buena aproximación para comparar versiones y días.
 * 3120: también los DATOS que usa NEXO (bytes recibidos + enviados, cuenta de Android de la propia app desde que se encendió el
 * teléfono): entre dos muestras se suma lo que creció, por Wi-Fi o por datos móviles si las dos muestras estaban en la misma red
 * (si no, «al cambiar de red»). Va aunque esté cargando. Un reinicio del teléfono pone la cuenta en cero: ese tramo no se cuenta.
 * Solo números, en localStorage (`nexo_power`, 14 días). Sale en el resumen diario y en el diagnóstico.
 * Perillas de prueba: window.NEXO_POWER_NOW (reloj), window.NEXO_POWER_SAMPLE_MS.
 */
var KEY = 'nexo_power', KEEP_DAYS = 14, SAMPLE_MS = 10 * 60 * 1000, MAX_GAP_MS = 12 * 3600 * 1000;
var _vis = false, _visT = 0, _visAccum = 0, _last = null, _timer = null, _inited = false;

function _now() { return (typeof window !== 'undefined' && typeof window.NEXO_POWER_NOW === 'function') ? window.NEXO_POWER_NOW() : Date.now(); }
function _lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
function _lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
function _load() { try { var o = JSON.parse(_lsGet(KEY) || '{}'); return (o && typeof o === 'object') ? o : {}; } catch (e) { return {}; } }
function _save(o) { var ks = Object.keys(o).sort(); while (ks.length > KEEP_DAYS) delete o[ks.shift()]; _lsSet(KEY, JSON.stringify(o)); }
function _dayKey(ms) { var d = new Date(ms), p = function(n) { return (n < 10 ? '0' : '') + n; }; return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()); }
function _day(o, k) { var d = o[k] || (o[k] = { fg: 0, fm: 0, fd: 0, bm: 0, bd: 0 }); if (d.nw == null) { d.nw = 0; d.nm = 0; d.no = 0; } return d; }
function _mb(b) { return b >= 1048576 ? _n1(b / 1048576) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB'; }
function _n1(x) { return (Math.round(x * 10) / 10).toString().replace('.', ','); }
function _plugin() { return (typeof window !== 'undefined' && window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.NexoBLE) || null; }

/** Lo que bajó la batería entre dos muestras, repartido según el rato a la vista (visMs); null si no cuenta (cargando, subió, hueco). */
export function powerAccount(prev, cur, visMs) {
  if (!prev || !cur || prev.charging || cur.charging || typeof prev.level !== 'number' || typeof cur.level !== 'number') return null;
  var dt = cur.at - prev.at; if (!(dt > 0) || dt > MAX_GAP_MS) return null;
  var drop = prev.level - cur.level; if (drop < 0) return null; // subió: se cargó entre medio
  var v = Math.max(0, Math.min(dt, visMs || 0)), share = v / dt;
  return { fgMs: v, fgDrop: drop * share, bgMs: dt - v, bgDrop: drop * (1 - share) };
}

/** 3120: datos de NEXO entre dos muestras ({bytes, net: 'wifi'|'movil'|'otra'}); null si falta el dato o el teléfono se reinició. */
export function dataAccount(prev, cur) {
  if (!prev || !cur || typeof prev.rx !== 'number' || typeof cur.rx !== 'number' || typeof prev.tx !== 'number' || typeof cur.tx !== 'number') return null;
  var b = (cur.rx + cur.tx) - (prev.rx + prev.tx); if (!(b >= 0)) return null; // la cuenta volvió a cero: se reinició el teléfono
  var net = (prev.net && prev.net === cur.net) ? (cur.net === 'Wi-Fi' ? 'wifi' : (cur.net === 'datos móviles' ? 'movil' : 'otra')) : 'otra';
  return { bytes: b, net: net };
}

/** Líneas de un día: tiempo a la vista y gasto sin cargar (solo con datos suficientes: 20 min a la vista / 1 h en segundo plano). */
export function powerLines(key) {
  var d = _load()[key || _dayKey(_now())]; if (!d) return [];
  var out = [];
  if (d.fg > 0) out.push('tiempo con la app a la vista: ' + Math.max(1, Math.round(d.fg / 60000)) + ' min'); // i18n-ok: texto para el desarrollador
  var parts = [];
  if (d.fm >= 20 * 60000) parts.push('a la vista ' + _n1(d.fd / (d.fm / 3600000)) + ' %/h (en ' + Math.round(d.fm / 60000) + ' min)'); // i18n-ok: texto para el desarrollador
  if (d.bm >= 3600000) parts.push('en segundo plano ' + _n1(d.bd / (d.bm / 3600000)) + ' %/h (en ' + _n1(d.bm / 3600000) + ' h)'); // i18n-ok: texto para el desarrollador
  if (parts.length) out.push('batería sin cargar (todo el teléfono): ' + parts.join(' · ')); // i18n-ok: texto para el desarrollador
  var nt = (d.nw || 0) + (d.nm || 0) + (d.no || 0);
  if (nt > 0) {
    var dp = [];
    if (d.nw > 0) dp.push('Wi-Fi ' + _mb(d.nw)); // i18n-ok: texto para el desarrollador
    if (d.nm > 0) dp.push('datos móviles ' + _mb(d.nm)); // i18n-ok: texto para el desarrollador
    if (d.no > 0) dp.push('al cambiar de red u otra ' + _mb(d.no)); // i18n-ok: texto para el desarrollador
    out.push('datos de NEXO (recibidos + enviados): ' + _mb(nt) + ' (' + dp.join(' · ') + ')'); // i18n-ok: texto para el desarrollador
  }
  return out;
}

function _note(fn) { try { var o = _load(); fn(_day(o, _dayKey(_now()))); _save(o); } catch (e) {} }
// tiempo a la vista hasta ahora (lo suma al día y a lo pendiente de la próxima muestra)
function _flushVis() {
  if (!_vis || !_visT) return;
  var now = _now(), ms = Math.max(0, now - _visT);
  _visAccum += ms; _visT = now;
  _note(function(d) { d.fg += ms; });
}
function _sample() {
  var pl = _plugin(); if (!pl || typeof pl.getPowerStatus !== 'function') return Promise.resolve(null);
  _flushVis();
  var vis = _visAccum; _visAccum = 0;
  return Promise.resolve(pl.getPowerStatus()).then(function(r) {
    if (!r || typeof r.level !== 'number') return null;
    var cur = { at: _now(), level: r.level, charging: !!r.charging, rx: r.rx, tx: r.tx, net: r.net };
    var a = powerAccount(_last, cur, vis);
    if (a) _note(function(d) { d.fm += a.fgMs; d.fd += a.fgDrop; d.bm += a.bgMs; d.bd += a.bgDrop; });
    var da = dataAccount(_last, cur);
    if (da && da.bytes > 0) _note(function(d) { if (da.net === 'wifi') d.nw += da.bytes; else if (da.net === 'movil') d.nm += da.bytes; else d.no += da.bytes; });
    _last = cur;
    return a;
  }).catch(function() { return null; });
}
function _onVis() {
  var v = typeof document === 'undefined' || document.visibilityState !== 'hidden';
  if (v === _vis) return;
  if (v) { _sample().then(function() { _vis = true; _visT = _now(); }); } // lo de antes fue en segundo plano
  else { _flushVis(); _vis = false; _visT = 0; _sample(); }                   // lo de antes fue a la vista
}

export function powerInit() {
  if (_inited) return; _inited = true;
  try {
    _vis = typeof document === 'undefined' || document.visibilityState !== 'hidden';
    _visT = _vis ? _now() : 0;
    _sample();
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', _onVis);
    var gap = (typeof window !== 'undefined' && typeof window.NEXO_POWER_SAMPLE_MS === 'number') ? window.NEXO_POWER_SAMPLE_MS : SAMPLE_MS;
    _timer = setInterval(_sample, gap);
  } catch (e) {}
}

// Gancho de pruebas
try { if (typeof window !== 'undefined') window.__nexoPower = { lines: powerLines, account: powerAccount, data: dataAccount, sample: _sample }; } catch (e) {}
