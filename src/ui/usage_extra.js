/**
 * NEXO — Medidas extra del resumen diario (docs/REDES.md «Siguiente en medir»; COLA 7, 9 y 10): fallas por camino con causa, pico de enlaces
 * Bluetooth y de transferencias de Wi-Fi Direct a la vez, y cronómetro de actividades (foto/archivo de principio a fin). Solo números.
 * Opera sobre el «día» que le pasa usage_stats.js (que es dueño del almacenamiento): sin estado propio ni imports de la app.
 * Se mide para ARREGLAR cada camino, nunca para cerrar ninguno (principio del dueño).
 */
import { distPush, distStats } from './usage_dist.js';

function _n1(x) { return (Math.round(x * 10) / 10).toString().replace('.', ','); }
function _hhmm(ts) { var d = new Date(ts), p = function(n) { return (n < 10 ? '0' : '') + n; }; return p(d.getHours()) + ':' + p(d.getMinutes()); }

// ---- COLA 10: fallas por camino con causa y conteo ----
var PF_VIAS = { wifi: 'Wi-Fi local', internet: 'internet', jump: 'puente (Jump)', tor: 'Tor', bluetooth: 'Bluetooth' }; // i18n-ok: texto para el desarrollador
var PF_ORDER = ['wifi', 'internet', 'jump', 'tor', 'bluetooth'];
function _norm(s) { return String(s == null ? '' : s).replace(/nx[0-9a-z]{8}/g, 'nx…').replace(/"[^"]*"/g, '').replace(/\d+([.,]\d+)?/g, 'N').replace(/\s+/g, ' ').trim().slice(0, 60); }
export function pfNote(day, via, cause) {
  if (!PF_VIAS[via]) return false;
  var c = _norm(cause) || 'otro'; // i18n-ok: texto para el desarrollador
  day.pf = day.pf || {}; var m = day.pf[via] || (day.pf[via] = {});
  if (!(c in m) && Object.keys(m).length >= 12) c = 'otras'; // acotado: no crece sin fin si la causa lleva texto variable
  m[c] = (m[c] || 0) + 1;
  return true;
}
export function pfLines(d) {
  var parts = PF_ORDER.filter(function(v) { return d.pf && d.pf[v]; }).map(function(v) {
    var m = d.pf[v], tot = 0; Object.keys(m).forEach(function(c) { tot += m[c]; });
    return PF_VIAS[v] + ' ' + tot + ': ' + Object.keys(m).sort(function(a, b) { return m[b] - m[a]; }).map(function(c) { return c + ' ×' + m[c]; }).join(', ');
  });
  return parts.length ? ['  fallos con causa por camino hoy: ' + parts.join(' · ')] : []; // i18n-ok: texto para el desarrollador
}
// Clasifica una línea del REGISTRO de consola (tras la hora) → {via, cause} o null. Reconoce solo las fallas ya escritas por Wi-Fi local, relés,
// puente y Tor; lo demás (informativo) no cuenta. Lo llama el registro (diag.js) con cada línea que empieza por [WIFI], [NET], [JUMP] o [GW].
export function pfClassify(text) {
  var s = String(text || ''), m;
  if (/^\[WIFI\] Conexión con .* sin comprobar/.test(s)) return { via: 'wifi', cause: /su app no contestó/.test(s) ? 'sin comprobar (su app no contestó)' : 'sin comprobar' }; // i18n-ok: causa para el desarrollador
  if ((m = /^\[WIFI\] Sin Wi-Fi con \S+ \((.+?)\): sigue/.exec(s))) return /^sin comprobar/.test(m[1]) ? null : { via: 'wifi', cause: 'sin Wi-Fi: ' + m[1] }; // «sin comprobar» ya se contó en su aviso // i18n-ok: causa para el desarrollador
  if (/^\[WIFI\] Señal Wi-Fi mala/.test(s)) return { via: 'wifi', cause: 'señal mala' }; // i18n-ok: causa para el desarrollador
  // Dueño 26-11 (resumen del 25-11: «Wi-Fi local: conectado pero su app no contesta» ×10): es que la app del OTRO duerme y se le despierta con un
  // toque; el Wi-Fi está bien. No es un fallo del camino (si no despierta, cuenta su «sin comprobar (su app no contestó)», que sí lo es).
  if (/^\[WIFI\] .* conectado por Wi-Fi pero su app no contesta/.test(s)) return null;
  if ((m = /^\[NET\] Relé \S+ no contesta \((.*?)\)/.exec(s))) return { via: 'internet', cause: 'relé no contesta (' + m[1] + ')' }; // i18n-ok: causa para el desarrollador
  if (/^\[NET\] Sin relés: internet no disponible/.test(s)) return { via: 'internet', cause: 'sin relés' }; // i18n-ok: causa para el desarrollador
  if (/^\[NET\] Relé inestable/.test(s)) return { via: 'internet', cause: 'relé inestable (apartado)' }; // i18n-ok: causa para el desarrollador
  if (/^\[NET\] Wi-Fi sin internet/.test(s)) return { via: 'internet', cause: 'Wi-Fi sin internet' }; // i18n-ok: causa para el desarrollador
  if ((m = /^\[NET\] Relé propio: (.*?);/.exec(s))) return { via: 'internet', cause: 'relé propio: ' + m[1] }; // i18n-ok: causa para el desarrollador
  if ((m = /^\[NET\] Tor no disponible: (.*)/.exec(s))) return { via: 'tor', cause: 'no disponible: ' + m[1] }; // i18n-ok: causa para el desarrollador
  if (/^\[NET\] Conexión Tor de .* no se puede comprobar/.test(s)) return { via: 'tor', cause: 'conexión sin comprobar' }; // i18n-ok: causa para el desarrollador
  if (/^\[JUMP\] Sin confirmación del puente/.test(s)) return { via: 'jump', cause: 'sin confirmación del puente' }; // i18n-ok: causa para el desarrollador
  if (/^\[JUMP\] Caducado sin entregar/.test(s)) return { via: 'jump', cause: 'caducado sin entregar' }; // i18n-ok: causa para el desarrollador
  if ((m = /^\[JUMP\] No se pudo reenviar \S+: (.*?) \(/.exec(s))) return { via: 'jump', cause: 'no se pudo reenviar: ' + m[1] }; // i18n-ok: causa para el desarrollador
  if (/^\[JUMP\] Conexión de paso con .* sin éxito/.test(s)) return { via: 'jump', cause: 'conexión de paso sin éxito' }; // i18n-ok: causa para el desarrollador
  if (/^\[GW\] El puente .* no abrió la sesión/.test(s)) return { via: 'jump', cause: 'puente a internet: no abrió la sesión' }; // i18n-ok: causa para el desarrollador
  if (/^\[GW\] El puente .* no pudo abrir la sesión/.test(s)) return { via: 'jump', cause: 'puente a internet: no pudo abrir la sesión' }; // i18n-ok: causa para el desarrollador
  if (/^\[GW\] .* no contestan?\b/.test(s)) return { via: 'jump', cause: 'puente a internet: no contesta' }; // i18n-ok: causa para el desarrollador
  return null;
}

// ---- COLA 9: capacidad (picos a la vez en el día) ----
export function pkNote(day, kind, n, ts) {
  if (!(n > 0) || (kind !== 'bt' && kind !== 'wd')) return false;
  day.pk = day.pk || {};
  var e = day.pk[kind];
  if (e && e[0] >= n) return false;
  day.pk[kind] = [n, ts || Date.now()];
  return true;
}
/** Enlaces Bluetooth listos ahora en una interfaz (solo lee): claves de dispositivo (no «lan»/«net») en estado listo. */
export function btLinksNow(bi) {
  var n = 0;
  try { bi._deviceStates.forEach(function(st, key) { if (!/^(lan|net)nx/.test(key) && st && (st.state === 'ready_to_chat' || st.state === 'notifications_ready')) n++; }); } catch (e) { return 0; }
  return n;
}
export function pkLines(d) {
  var p = d.pk, out = [];
  if (!p) return out;
  if (p.bt) out.push('  pico de enlaces Bluetooth a la vez: ' + p.bt[0] + ' (a las ' + _hhmm(p.bt[1]) + ')'); // i18n-ok: texto para el desarrollador
  if (p.wd) out.push('  pico de transferencias de Wi-Fi Direct a la vez: ' + p.wd[0] + ' (a las ' + _hhmm(p.wd[1]) + ')'); // i18n-ok: texto para el desarrollador
  return out;
}

/** « · mediana Y u · p90 Z u» (p10 para velocidades: lo malo es lo lento). Con pocas muestras no inventa: < 3 nada, < 10 solo la mediana. */
export function distExtras(samples, unit, tail) {
  var st = distStats(samples), u = unit ? ' ' + unit : '', out = '';
  if (st && st.med != null) out += ' · mediana ' + _n1(st.med) + u;
  if (st && st.p90 != null) out += ' · ' + (tail === 'p10' ? 'p10 ' + _n1(st.p10) : 'p90 ' + _n1(st.p90)) + u;
  return out;
}
/** «media X u · mediana Y u · p90 Z u (N veces, de A a B u)»; con 1 muestra solo «X u (1 vez)». */
export function distText(e, unit, avg, lo, hi, tail) {
  var u = unit ? ' ' + unit : '';
  if (e.n === 1) return _n1(avg) + u + ' (1 vez)';
  return 'media ' + _n1(avg) + u + distExtras(e.s, unit, tail) + ' (' + e.n + ' veces, de ' + _n1(lo) + ' a ' + _n1(hi) + u + ')';
}

// ---- COLA 7: cronómetro de actividades (desde que el usuario suelta la foto/archivo hasta la primera ✓✓), por tipo y camino ----
var AC_KINDS = { image: 'foto', file: 'archivo', video: 'vídeo', audio: 'audio' }; // i18n-ok: texto para el desarrollador
var AC_VIAS = { bluetooth: 'Bluetooth', wifi: 'Wi-Fi', internet: 'internet', jump: 'puente', none: 'sin camino al salir' }; // i18n-ok: texto para el desarrollador
export function acKindOf(attachmentType) { return AC_KINDS[attachmentType] ? attachmentType : ''; }
export function acNote(day, kind, via, ms) {
  if (!AC_KINDS[kind] || !AC_VIAS[via] || !(ms >= 0) || ms > 24 * 3600000) return false;
  day.ac = day.ac || {};
  var k = kind + '|' + via, e = day.ac[k] || (day.ac[k] = { n: 0, ms: 0, lo: ms, hi: ms, s: [] });
  e.n++; e.ms += ms; e.lo = Math.min(e.lo, ms); e.hi = Math.max(e.hi, ms); e.s = distPush(e.s, Math.round(ms / 100) / 10, e.n); // muestras en s con 1 decimal
  return true;
}
export function acLines(d) {
  var parts = [];
  Object.keys(AC_KINDS).forEach(function(kind) { Object.keys(AC_VIAS).forEach(function(via) {
    var e = d.ac && d.ac[kind + '|' + via]; if (!e || !e.n) return;
    parts.push(AC_KINDS[kind] + ' por ' + AC_VIAS[via] + ' ' + distText(e, 's', e.ms / e.n / 1000, e.lo / 1000, e.hi / 1000)); // i18n-ok: texto para el desarrollador
  }); });
  return parts.length ? ['  cronómetro de actividades (de soltar a la ✓✓): ' + parts.join(' · ')] : []; // i18n-ok: texto para el desarrollador
}

// ---- COLA 13: enlaces Bluetooth que se quedan en MTU mínimo (23: todo ~20 veces más lento), por contacto y por papel ----
// Se alimenta de las líneas «[MTU] <id>: <n>» que ya escribe ble_send.js (_noteMtu): el 23 solo sale tras 4 s sin subir (aviso), el resto al cambiar.
// Cuenta enlaces con MTU ya asentado; un enlace que se rehace con el MISMO MTU no escribe línea y no se cuenta (por eso es una cota baja).
export function mtClassify(text) {
  var m = /^\[MTU\] (\S+): (\d+)/.exec(String(text || ''));
  return m ? { id: m[1], mtu: parseInt(m[2], 10) } : null;
}
/** Papel de NEXO en el enlace de ese contacto (cliente/servidor) leído de bleInterface (solo lee): 'c', 's' o ''. */
export function mtRoleOf(bi, nx) {
  try {
    var role = '';
    bi._deviceStates.forEach(function(st, key) { if (!role && st && st.role && String(bi._macToNexoId.get(key) || '').toLowerCase() === String(nx).toLowerCase()) role = st.role; });
    return role === 'client' ? 'c' : role === 'server' ? 's' : '';
  } catch (e) { return ''; }
}
export function mtNote(day, nx, mtu, role) {
  if (!nx || !(mtu >= 23)) return false;
  var m = day.mt || (day.mt = { n: 0, lo: 0, by: {} });
  m.n++;
  if (mtu > 23) return true;
  m.lo++;
  if (!m.by[nx] && Object.keys(m.by).length >= 12) nx = 'otros';
  var e = m.by[nx] || (m.by[nx] = { n: 0, c: 0, s: 0 });
  e.n++; if (role === 'c') e.c++; else if (role === 's') e.s++;
  return true;
}
export function mtLines(d) {
  var m = d.mt; if (!m || !m.n) return [];
  var ids = Object.keys(m.by).sort(function(a, b) { return m.by[b].n - m.by[a].n; }).map(function(k) {
    var e = m.by[k], sp = e.n - e.c - e.s;
    return k + ' ×' + e.n + (e.c || e.s ? ' (cliente ' + e.c + ', servidor ' + e.s + (sp ? ', sin papel ' + sp : '') + ')' : ''); // i18n-ok: texto para el desarrollador
  });
  return ['  enlaces Bluetooth a MTU mínimo (23) hoy: ' + m.lo + ' de ' + m.n + ' (' + Math.round(m.lo * 100 / m.n) + ' %)' + (ids.length ? ': ' + ids.join(', ') : '')]; // i18n-ok: texto para el desarrollador
}
