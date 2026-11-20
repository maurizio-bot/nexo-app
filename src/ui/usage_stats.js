/**
 * NEXO — Resumen diario de uso al desarrollador (2989; pendiente importante #2 de la conversación del dueño 10-11: «responde ¿lo usan entre
 * ellos? sin preguntar»). Cuenta, en este teléfono, SOLO NÚMEROS por día: mensajes enviados y recibidos, cuántos llegaron (✓✓) y cuántos se
 * leyeron, adjuntos por tipo y con cuántos chats hubo actividad. Nunca contenido, nombres ni identificadores de terceros (los chats se
 * cuentan por una marca corta y no vuelven a salir). Al abrir la app un día nuevo, el resumen del último día completo sale al desarrollador por
 * el mismo canal cifrado del diagnóstico automático (`nexo_diag`, síntoma «resumen_diario»), una vez por día y sujeto al MISMO interruptor
 * (Perfil → Ajustes → Diagnóstico automático). Un día en que la app se abrió pero no se escribió nada también se informa (eso ES el dato).
 * Los contadores viven en localStorage (`nexo_usage`, últimos 14 días).
 * Perillas de prueba (tests/sim/usage.js): window.__nexoUsage.
 */
import { vaultSetUsageHook } from '../vault/vault_manager.js';
import { _getBLEContacts, _showToast } from './ble_helpers.js';
import { autoDiagSendSummary, autoDiagBuild } from './autodiag.js';
import { t } from './i18n.js';
import { powerInit, powerLines } from './usage_power.js'; // 3119: tiempo de uso y batería

var KEY = 'nexo_usage', KEY_SENT = 'nexo_usage_sent', KEY_TRY = 'nexo_usage_try', KEY_FIRST = 'nexo_usage_first';
var KEEP_DAYS = 14, RETRY_MS = 60 * 60 * 1000;

function _lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
function _lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
function _load() { try { var o = JSON.parse(_lsGet(KEY) || '{}'); return (o && typeof o === 'object') ? o : {}; } catch (e) { return {}; } }
function _save(o) {
  var keys = Object.keys(o).sort();
  while (keys.length > KEEP_DAYS) delete o[keys.shift()];
  _lsSet(KEY, JSON.stringify(o));
}
/** Día LOCAL del teléfono (AAAA-MM-DD): «ayer» es el de quien lo usa. */
export function usageDayKey(ms) {
  var d = new Date(ms == null ? Date.now() : ms), p = function(n) { return (n < 10 ? '0' : '') + n; };
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}
function _hash(s) { var h = 5381; s = String(s || ''); for (var i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0; return h.toString(36); }
function _day(o, key) { return o[key] || (o[key] = { o: 0, s: 0, r: 0, d: 0, rd: 0, t: {}, c: [] }); }
function _kind(m) { var a = m && m.attachmentType; return !a ? 'texto' : (/^(image|video|audio|file|location|contact)$/.test(a) ? a : 'otro'); }

/** Gancho del almacén: un mensaje NUEVO (kind 'msg') o un cambio de estado de uno propio (kind 'status'). */
function _hook(kind, cid, m, prevStatus) {
  try {
    if (!m || m.hidden) return;
    // 3198 (resumen del 15-11 de nx0g6ef54e: «enviados 1 · llegaron (✓✓) 2»): la ✓✓ y el leído se contaban en el día en que LLEGABAN,
    // no en el del mensaje: lo enviado ayer y entregado hoy inflaba el «llegaron» de hoy. Ahora cuentan en el día del mensaje (si ese día
    // ya se informó, ya no suma: el resumen sale al día siguiente y casi todo llega antes).
    var o = _load(), day = _day(o, usageDayKey(m.timestamp || Date.now()));
    if (kind === 'msg') {
      if (m._own) day.s++; else day.r++;
      var k = _kind(m); day.t[k] = (day.t[k] || 0) + 1;
      var h = _hash(cid); if (day.c.indexOf(h) < 0) day.c.push(h);
    } else if (kind === 'status' && m._own) {
      var st = m.status;
      if ((st === 'delivered' || st === 'read') && prevStatus !== 'delivered' && prevStatus !== 'read') day.d++;
      if (st === 'read' && prevStatus !== 'read') day.rd++;
    } else return;
    _save(o);
  } catch (e) {}
}

// 3081 (paso 3 del dueño 14-11: «medir en el diagnóstico la velocidad real de cada camino en mis teléfonos»): por día, cada archivo
// enviado/recibido por un camino (bytes, tiempo hasta la ✓✓ o hasta tenerlo entero) y cuánto tardó cada camino en quedar listo.
// Solo números (ni nombres ni contenido). Lo anotan ble_ack (Bluetooth/Wi-Fi/internet), wifi_direct, el buzón de archivos, lan,
// net_link y ble_interface (conexión Bluetooth) por window.NEXO_noteSpeed / NEXO_noteConnect (sin importar este módulo: sin ciclos).
var VIAS = { wifi: 'Wi-Fi local', 'wifi-direct': 'Wi-Fi Direct', internet: 'internet', buzon: 'buzón de archivos', bluetooth: 'Bluetooth', ruta: 'internet al abrir el chat' }; // i18n-ok: texto para el desarrollador
var VIA_ORDER = ['wifi', 'wifi-direct', 'internet', 'buzon', 'bluetooth', 'ruta']; // ruta: 3147
function _kbs(bytes, ms) { return (bytes / 1024) / Math.max(0.001, ms / 1000); }
function _n1(x) { return (Math.round(x * 10) / 10).toString().replace('.', ','); }
export function usageNoteSpeed(via, dir, bytes, ms) {
  try {
    if (!VIAS[via] || !(bytes > 0) || !(ms > 0) || (dir !== 'out' && dir !== 'in')) return;
    var o = _load(), day = _day(o, usageDayKey()), k = via + '|' + dir, rate = _kbs(bytes, ms);
    day.v = day.v || {};
    var e = day.v[k] || (day.v[k] = { n: 0, b: 0, ms: 0, lo: rate, hi: rate });
    e.n++; e.b += bytes; e.ms += ms; e.lo = Math.min(e.lo, rate); e.hi = Math.max(e.hi, rate);
    _save(o);
    console.log('[VELOCIDAD] ' + VIAS[via] + ' ' + (dir === 'out' ? 'enviado' : 'recibido') + ': ' + _n1(bytes / 1024) + ' KB en ' + _n1(ms / 1000) + ' s = ' + _n1(rate) + ' KB/s'); // i18n-ok
  } catch (err) {}
}
// 3241 (diagnósticos del dueño 18-11: «Wi-Fi local 382,9 s», «internet de 0,5 a 62 s» en otros teléfonos): con la pantalla apagada la app queda
// CONGELADA minutos y el tiempo de «conexión lista» contaba ese congelado (medida falsa que parecía lentitud de la red). Una medida que
// abarca un rato con la app en segundo plano (o empezó en él) no cuenta.
var _lastHiddenAt = 0, _lastVisibleAt = 0;
if (typeof document !== 'undefined' && document && typeof document.addEventListener === 'function') {
  try {
    document.addEventListener('visibilitychange', function() {
      if (document.visibilityState === 'hidden') _lastHiddenAt = Date.now(); else _lastVisibleAt = Date.now();
    });
  } catch (e) {}
}
export function usageNoteConnect(via, ms) {
  try {
    if (!VIAS[via] || !(ms >= 0) || ms > 600000) return;
    var t0 = Date.now() - ms;
    if ((typeof document !== 'undefined' && document && document.visibilityState === 'hidden') || _lastHiddenAt >= t0 || _lastVisibleAt >= t0) return;
    var o = _load(), day = _day(o, usageDayKey());
    day.k = day.k || {};
    var e = day.k[via] || (day.k[via] = { n: 0, ms: 0, lo: ms, hi: ms });
    e.n++; e.ms += ms; e.lo = Math.min(e.lo, ms); e.hi = Math.max(e.hi, ms);
    _save(o);
    console.log('[VELOCIDAD] ' + VIAS[via] + ' listo en ' + _n1(ms / 1000) + ' s'); // i18n-ok
  } catch (err) {}
}
// 3258 (dueño 20-11: «cuando entre el Wi-Fi Direct, sí o sí me va a aparecer en el diagnóstico y tendré datos reales»): contadores del día de
// Wi-Fi Direct, de los DOS lados (quien envía y quien recibe): cuántos intentos, cuántos salieron, por qué fallaron, cuánto tardó cada fase (crear
// el grupo, unirse), la velocidad PURA de la transferencia (sin montar el grupo), cuánto tiempo estuvo trabajando, si el Wi-Fi normal se cayó
// mientras tanto y por qué se eligió (o no) Wi-Fi Direct para un archivo. Solo números. Se mide si FUNCIONA, para arreglarlo (principio del dueño).
function _wdAcc(map, k, ms) { var e = map[k] || (map[k] = { n: 0, ms: 0, lo: ms, hi: ms }); e.n++; e.ms += ms; e.lo = Math.min(e.lo, ms); e.hi = Math.max(e.hi, ms); }
export function usageNoteWd(ev, o) {
  try {
    o = o || {};
    var all = _load(), day = _day(all, usageDayKey()), w = day.wd || (day.wd = { out: { n: 0, ok: 0, f: {} }, in: { n: 0, ok: 0, f: {} }, t: {}, x: { n: 0, b: 0, ms: 0, lo: 0, hi: 0 }, ap: { keep: 0, lost: 0, none: 0, up: 0 }, rt: 0, rc: {}, act: 0, use: {}, no: {} });
    var dir = o.dir === 'in' ? 'in' : 'out';
    if (ev === 'try') w[dir].n++;
    else if (ev === 'ok') { w[dir].ok++; if (o.act > 0 && o.act < 3600000) w.act += o.act; }
    else if (ev === 'fail') { var c = String(o.cause || 'otro').slice(0, 40); w[dir].f[c] = (w[dir].f[c] || 0) + 1; if (o.act > 0 && o.act < 3600000) w.act += o.act; }
    else if (ev === 'group' && o.ms >= 0) { _wdAcc(w.t, 'grupo', o.ms); if (o.attempts > 1) w.rt += o.attempts - 1; String(o.reasons || '').split(',').forEach(function(r) { if (/^\d+$/.test(r)) w.rc[r] = (w.rc[r] || 0) + 1; }); }
    else if (ev === 'join' && o.ms >= 0) _wdAcc(w.t, 'unirse', o.ms);
    else if (ev === 'xfer' && o.bytes > 0 && o.ms > 0) { var r2 = _kbs(o.bytes, o.ms), x = w.x; x.lo = x.n ? Math.min(x.lo, r2) : r2; x.hi = Math.max(x.hi, r2); x.n++; x.b += o.bytes; x.ms += o.ms; }
    else if (ev === 'ap') { // Wi-Fi normal (MHz; 0 = sin Wi-Fi) antes y después de unirse/montar el grupo
      if (!(o.before > 0)) w.ap.none++; else if (o.after > 0) { w.ap.keep++; if (o.after !== o.before) w.ap.up++; } else w.ap.lost++;
    }
    else if (ev === 'use') w.use[String(o.why).slice(0, 60)] = (w.use[String(o.why).slice(0, 60)] || 0) + 1;
    else if (ev === 'no') w.no[String(o.why).slice(0, 60)] = (w.no[String(o.why).slice(0, 60)] || 0) + 1;
    else return;
    _save(all);
  } catch (err) {}
}
// 3259 (dueño 20-11: «revisar red por red: velocidad de conexión, de transporte, capacidad y fallas recurrentes… ya no es resolver problemas, es pulir»):
// (1) ENTREGA de mensajes por camino al mandar: cuántos salieron, cuántos llegaron (✓✓) y en cuánto tiempo (<1 s, <5 s, <30 s, más); lo que
//     tardó con la app en segundo plano no cuenta como lentitud de la red (3034), solo se anota como «app dormida».
// (2) SÍNTOMAS del día por tipo (zombi, enlace que abre y cierra, entrega lenta…): la serie para ver si bajan o vuelven, por build y por día.
var DEL_VIAS = { bluetooth: 'Bluetooth', wifi: 'Wi-Fi (local o Wi-Fi Direct)', internet: 'internet', jump: 'puente de otro NEXO', none: 'sin camino al salir' }; // i18n-ok: texto para el desarrollador
var DEL_ORDER = ['bluetooth', 'wifi', 'internet', 'jump', 'none'];
function _dl(day, via) { day.dl = day.dl || {}; return day.dl[via] || (day.dl[via] = { n: 0, ok: 0, b: [0, 0, 0, 0], ms: 0, hi: 0, dorm: 0 }); }
export function usageNoteSent(via) {
  try { if (!DEL_VIAS[via]) return; var all = _load(), day = _day(all, usageDayKey()); _dl(day, via).n++; _save(all); } catch (e) {}
}
export function usageNoteDelivered(via, ms) {
  try {
    if (!DEL_VIAS[via]) return;
    var all = _load(), day = _day(all, usageDayKey()), e = _dl(day, via);
    e.ok++;
    if (!(ms >= 0)) e.dorm++; // app dormida mientras esperaba: llegó, pero el tiempo no es de la red
    else { e.b[ms < 1000 ? 0 : ms < 5000 ? 1 : ms < 30000 ? 2 : 3]++; e.ms += ms; e.hi = Math.max(e.hi, ms); }
    _save(all);
  } catch (err) {}
}
export function usageNoteSymptom(kind) {
  try { kind = String(kind || '').slice(0, 40); if (!kind) return; var all = _load(), day = _day(all, usageDayKey()); day.sy = day.sy || {}; day.sy[kind] = (day.sy[kind] || 0) + 1; _save(all); } catch (e) {}
}
function _delLines(d) {
  var out = [];
  var parts = DEL_ORDER.filter(function(v) { return d.dl && d.dl[v] && d.dl[v].n; }).map(function(v) {
    var e = d.dl[v], timed = e.b[0] + e.b[1] + e.b[2] + e.b[3], pend = e.n - e.ok;
    return DEL_VIAS[v] + ': salieron ' + e.n + ', con ✓✓ ' + e.ok + (pend > 0 ? ' (' + pend + ' sin ✓✓ aún)' : '') + // i18n-ok
      (timed ? ' · <1 s ' + e.b[0] + ', <5 s ' + e.b[1] + ', <30 s ' + e.b[2] + ', más ' + e.b[3] + ' · media ' + _n1(e.ms / timed / 1000) + ' s, máx. ' + _n1(e.hi / 1000) + ' s' : '') +
      (e.dorm ? ' · con la app dormida ' + e.dorm : '');
  });
  if (parts.length) { out.push('  entrega de mensajes por camino al salir (hasta la ✓✓; incluye archivos):'); parts.forEach(function(x) { out.push('    ' + x); }); } // i18n-ok
  var sy = d.sy && Object.keys(d.sy).map(function(k) { return k + ' ×' + d.sy[k]; }).join(', ');
  if (sy) out.push('  síntomas de hoy: ' + sy); // i18n-ok
  return out;
}
function _wdCounts(m) { var k = Object.keys(m || {}); return k.map(function(c) { return c + ' ×' + m[c]; }).join(', '); }
function _wdLines(d) {
  var w = d && d.wd, out = [];
  if (!w) return out;
  var side = function(dir) {
    var e = w[dir]; if (!e.n) return '';
    var nf = 0, f = _wdCounts(e.f); Object.keys(e.f).forEach(function(c) { nf += e.f[c]; });
    var pend = e.n - e.ok - nf; // intentos sin resultado (en curso, o la app se cerró a mitad)
    return (dir === 'out' ? 'enviar ' : 'recibir ') + e.n + ' (salieron ' + e.ok + (nf ? ', fallaron ' + nf + ': ' + f : '') + (pend > 0 ? ', sin resultado ' + pend : '') + ')'; // i18n-ok
  };
  var s1 = [side('out'), side('in')].filter(Boolean).join(' · ');
  if (s1) out.push('  Wi-Fi Direct hoy: ' + s1 + (w.act ? ' · trabajando ' + _n1(w.act / 60000) + ' min en total' : '')); // i18n-ok
  var t = [];
  if (w.t.grupo) t.push('crear el grupo (quien recibe) ' + _n1(w.t.grupo.ms / w.t.grupo.n / 1000) + ' s' + (w.t.grupo.n > 1 ? ' (' + w.t.grupo.n + ' veces, de ' + _n1(w.t.grupo.lo / 1000) + ' a ' + _n1(w.t.grupo.hi / 1000) + ')' : '') + (w.rt ? ', ' + w.rt + ' reintento(s) del sistema' + (_wdCounts(w.rc) ? ' con código ' + _wdCounts(w.rc) : '') : '')); // i18n-ok
  if (w.t.unirse) t.push('unirse al grupo (quien envía) ' + _n1(w.t.unirse.ms / w.t.unirse.n / 1000) + ' s' + (w.t.unirse.n > 1 ? ' (' + w.t.unirse.n + ' veces, de ' + _n1(w.t.unirse.lo / 1000) + ' a ' + _n1(w.t.unirse.hi / 1000) + ')' : '')); // i18n-ok
  if (w.x.n) t.push('velocidad pura de la transferencia ' + _n1(_kbs(w.x.b, w.x.ms)) + ' KB/s' + (w.x.n > 1 ? ' (' + w.x.n + ' veces, de ' + _n1(w.x.lo) + ' a ' + _n1(w.x.hi) + ')' : '')); // i18n-ok
  if (t.length) out.push('  Wi-Fi Direct tiempos: ' + t.join(' · ')); // i18n-ok
  var ap = w.ap;
  if (ap.keep || ap.lost || ap.none) out.push('  Wi-Fi Direct y el Wi-Fi normal: seguía conectado ' + ap.keep + (ap.up ? ' (cambió de canal ' + ap.up + ')' : '') + ' · se cayó ' + ap.lost + ' · no había Wi-Fi ' + ap.none); // i18n-ok
  var u = _wdCounts(w.use), n = _wdCounts(w.no);
  if (u || n) out.push('  Wi-Fi Direct en archivos de 20 KB o más: elegido por ' + (u || 'ninguno') + ' · no se pudo usar por ' + (n || 'ninguno')); // i18n-ok
  return out;
}
/** Líneas de velocidad y conexión de un día (para el resumen diario y el diagnóstico); [] si no hay datos. */
export function usageSpeedLines(key) {
  var d = _load()[key || usageDayKey()], out = [];
  if (!d) return out;
  VIA_ORDER.forEach(function(v) {
    var parts = [];
    ['out', 'in'].forEach(function(dir) {
      var e = d.v && d.v[v + '|' + dir]; if (!e || !e.n) return;
      parts.push((dir === 'out' ? 'enviados ' : 'recibidos ') + e.n + ', media ' + _n1(_kbs(e.b, e.ms)) + ' KB/s' + (e.n > 1 ? ' (de ' + _n1(e.lo) + ' a ' + _n1(e.hi) + ')' : '')); // i18n-ok
    });
    if (parts.length) out.push('  archivos por ' + VIAS[v] + ': ' + parts.join(' · ')); // i18n-ok
  });
  var con = VIA_ORDER.filter(function(v) { return d.k && d.k[v] && d.k[v].n; }).map(function(v) {
    var e = d.k[v]; return VIAS[v] + ' ' + _n1(e.ms / e.n / 1000) + ' s (' + (e.n === 1 ? '1 vez' : e.n + ' veces, de ' + _n1(e.lo / 1000) + ' a ' + _n1(e.hi / 1000)) + ')'; // i18n-ok
  });
  if (con.length) out.push('  conexión lista en (media): ' + con.join(' · ')); // i18n-ok
  out = out.concat(_wdLines(d)); // 3258
  out = out.concat(_delLines(d)); // 3259
  return out;
}
if (typeof window !== 'undefined') { window.NEXO_noteSpeed = usageNoteSpeed; window.NEXO_noteConnect = usageNoteConnect; window.NEXO_noteWd = usageNoteWd; window.NEXO_noteSent = usageNoteSent; window.NEXO_noteDelivered = usageNoteDelivered; window.NEXO_speedLines = usageSpeedLines; }

/** Texto del resumen de un día (solo números). */
export function usageSummaryText(key) {
  var d = _load()[key]; if (!d) return null;
  var tipos = ['image', 'video', 'audio', 'file', 'location', 'contact', 'otro'].filter(function(k) { return d.t && d.t[k]; }).map(function(k) { return k + ' ' + d.t[k]; }).join(' · ') || 'ninguno';
  var contactos = 0; try { contactos = (_getBLEContacts() || []).length; } catch (e) {}
  return 'abierta la app: ' + (d.o ? 'sí' : 'no') + '\n' +
    'mensajes enviados: ' + d.s + ' · recibidos: ' + d.r + '\n' +
    'de los enviados: llegaron (✓✓) ' + d.d + ' · leídos ' + d.rd + '\n' + // i18n-ok: texto para el desarrollador
    'por tipo (enviados y recibidos): texto ' + (d.t.texto || 0) + ' · adjuntos: ' + tipos + '\n' +
    'chats con actividad: ' + (d.c ? d.c.length : 0) + ' de ' + contactos + ' contactos' + // i18n-ok
    (function() { var sl = usageSpeedLines(key); return sl.length ? '\nvelocidad por camino:\n' + sl.join('\n') : ''; })() + // i18n-ok: 3081
    (function() { var pw = powerLines(key); return pw.length ? '\n' + pw.join('\n') : ''; })(); // i18n-ok: 3119 tiempo de uso y batería
}

/** Manda el resumen del último día COMPLETO sin enviar (el de hoy no: está a medias). Devuelve el estado, p. ej. 'enviado', 'ya_enviado', 'sin_datos'. */
export function usageMaybeSend(force) {
  var today = usageDayKey(), o = _load(), sentUpTo = _lsGet(KEY_SENT) || '';
  var days = Object.keys(o).filter(function(k) { return k < today && k > sentUpTo; }).sort();
  if (!days.length) return 'sin_datos';
  var key = days[days.length - 1];           // el más reciente sin enviar (si hubo varios días sin abrir, solo ese: lo viejo ya no importa)
  if (!force && Date.now() - (parseInt(_lsGet(KEY_TRY), 10) || 0) < RETRY_MS) return 'espera';
  _lsSet(KEY_TRY, String(Date.now()));
  var text = usageSummaryText(key);
  if (!text) return 'sin_datos';
  var r = autoDiagSendSummary(key, text);
  if (r === 'enviado' || r === 'local') {
    _lsSet(KEY_SENT, key);
    console.log('[USO] resumen de ' + key + ' mandado (' + r + ')');
    if (!_lsGet(KEY_FIRST) && r === 'enviado') { _lsSet(KEY_FIRST, '1'); try { _showToast(t('usage_first_toast', 'Una vez al día se manda al desarrollador un resumen de uso: solo números, sin mensajes ni nombres. Puedes apagarlo en Perfil.'), 'info'); } catch (e) {} }
    return r === 'local' ? 'enviado' : r;
  }
  console.log('[USO] resumen de ' + key + ' no se mandó: ' + r);
  if (r === 'apagado') _lsSet(KEY_SENT, key);   // apagado a propósito: no se junta para después
  return r;
}

/** Arranque (main.js): engancha los contadores, marca el día como «abierta» y, ya con la app en marcha, manda el resumen pendiente. */
export function usageInit() {
  powerInit(); // 3119
  try { window.addEventListener('nexo:diag:symptom', function(e) { usageNoteSymptom(e && e.detail && e.detail.kind); }); } catch (e0) {} // 3259
  try {
    vaultSetUsageHook(_hook);
    var o = _load(); _day(o, usageDayKey()).o = 1; _save(o);
    setTimeout(function() { usageMaybeSend(false); }, 25000);
    document.addEventListener('visibilitychange', function() {
      if (document.visibilityState === 'visible') { var o2 = _load(); _day(o2, usageDayKey()).o = 1; _save(o2); usageMaybeSend(false); }
    });
  } catch (e) {}
}

try { if (typeof window !== 'undefined') window.__nexoUsage = { key: usageDayKey, text: usageSummaryText, send: usageMaybeSend, load: _load, build: autoDiagBuild, hook: _hook }; } catch (e) {}
