/**
 * 3345 (dueño 26-11, MODO MULTITUD / EDC: «lo primero en una multitud es buscar a las personas que conoces en esa multitud y poderte
 * reencontrar»). Lo que se sabe de DÓNDE está cada contacto, sin internet ni enlace:
 *  - su SEÑAL de Bluetooth: cada anuncio que oye el escaneo (ble_conn_scan.onDeviceFound) deja aquí su intensidad (RSSI). La señal
 *    de un teléfono salta mucho (el cuerpo, la gente, el bolsillo), así que se usa la MEDIANA de los últimos segundos y la tendencia
 *    se mide entre dos ventanas (¿te acercas o te alejas?);
 *  - su UBICACIÓN, si él decidió compartirla para encontrarse (acción oculta 'fnd' op 'loc', cifrada de punta a punta, por cualquier
 *    camino): sirve cuando está más lejos de lo que llega el Bluetooth; con la mía da distancia y rumbo.
 * Solo datos y cuentas (sin pantalla): la pantalla es find_ui.js. Todo puro y probado en tests/sim/buscarcerca.js.
 */

export var NEAR_KEEP_MS = 20000;   // muestras de señal que se guardan por contacto
export var NEAR_NOW_MS = 4000;     // la señal «de ahora» = mediana de los últimos 4 s
export var NEAR_LOST_MS = 10000;   // sin oírlo en 10 s: «dejé de verlo»
export var LOC_MAX_AGE_MS = 10 * 60000; // una ubicación de más de 10 min ya no sirve para encontrarse

var _sig = new Map();   // nx → [{t, r}]
var _loc = new Map();   // nx → {la, lo, ac, ts, at}

function _now() { return Date.now(); }
function _med(a) {
  if (!a.length) return null;
  var s = a.slice().sort(function(x, y) { return x - y; }), m = s.length >> 1;
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

/** Se oyó al contacto `nx` con esta señal (lo llama el escaneo). */
export function nearNote(nx, rssi, now) {
  if (!nx || typeof rssi !== 'number' || !isFinite(rssi) || rssi >= 0 || rssi < -127) return;
  now = now || _now();
  var a = _sig.get(nx);
  if (!a) { a = []; _sig.set(nx, a); }
  a.push({ t: now, r: Math.round(rssi) });
  while (a.length && now - a[0].t > NEAR_KEEP_MS) a.shift();
  if (a.length > 80) a.splice(0, a.length - 80);
  if (_sig.size > 600) { var k = _sig.keys().next().value; _sig.delete(k); } // tope (multitud): se olvida al más viejo
}

/** Nivel por la señal: 3 muy cerca (a unos pasos) · 2 cerca · 1 lejos · 0 la señal apenas llega. */
export function nearLevel(rssi) {
  if (typeof rssi !== 'number') return -1;
  return rssi >= -62 ? 3 : rssi >= -74 ? 2 : rssi >= -86 ? 1 : 0;
}

/**
 * Lo que se sabe ahora de la señal de `nx`: { rssi (mediana de los últimos 4 s, o null), level, trend (+1 acercando, -1 alejando,
 * 0 igual), lastAt, n }. La tendencia compara la mediana de los últimos 3 s con la de 4 a 9 s atrás (4 dB o más).
 */
export function nearInfo(nx, now) {
  now = now || _now();
  var a = _sig.get(nx) || [];
  var lastAt = a.length ? a[a.length - 1].t : 0;
  var cur = a.filter(function(s) { return now - s.t <= NEAR_NOW_MS; }).map(function(s) { return s.r; });
  var rssi = (lastAt && now - lastAt <= NEAR_LOST_MS) ? _med(cur.length ? cur : [a[a.length - 1].r]) : null;
  var rec = a.filter(function(s) { return now - s.t <= 3000; }).map(function(s) { return s.r; });
  var old = a.filter(function(s) { return now - s.t > 4000 && now - s.t <= 9000; }).map(function(s) { return s.r; });
  var trend = 0;
  if (rssi !== null && rec.length && old.length) {
    var d = _med(rec) - _med(old);
    trend = d >= 4 ? 1 : d <= -4 ? -1 : 0;
  }
  return { rssi: rssi, level: rssi === null ? -1 : nearLevel(rssi), trend: trend, lastAt: lastAt, n: a.length };
}

/** Los contactos (de esta lista) que el Bluetooth oyó en los últimos 10 s, del más cercano al más lejano. */
export function nearList(ids, now) {
  now = now || _now();
  return (ids || []).map(function(nx) { var i = nearInfo(nx, now); i.nx = nx; return i; })
    .filter(function(i) { return i.rssi !== null; })
    .sort(function(a, b) { return b.rssi - a.rssi; });
}

// ─── Ubicación compartida para encontrarse ───
/** Llegó la ubicación de `nx` (de su acción 'loc'). Se valida: coordenadas reales, precisión con sentido y hora no del futuro. */
export function locNote(nx, o, now) {
  now = now || _now();
  if (!nx || !o) return false;
  var la = Number(o.la), lo = Number(o.lo), ac = Number(o.ac) || 0, ts = Number(o.ts) || now;
  if (!isFinite(la) || !isFinite(lo) || Math.abs(la) > 90 || Math.abs(lo) > 180 || (la === 0 && lo === 0)) return false;
  if (ts > now + 120000) ts = now; // reloj del otro adelantado
  if (now - ts > LOC_MAX_AGE_MS) return false;
  var prev = _loc.get(nx);
  if (prev && prev.ts > ts) return false; // llegó una más vieja después (otro camino)
  _loc.set(nx, { la: la, lo: lo, ac: Math.max(0, Math.min(ac, 5000)), ts: ts, at: now });
  return true;
}
export function locOf(nx, now) {
  var l = _loc.get(nx);
  if (!l) return null;
  if ((now || _now()) - l.ts > LOC_MAX_AGE_MS) return null;
  return l;
}
export function locForget(nx) { _loc.delete(nx); }

var R = 6371000;
function _rad(d) { return d * Math.PI / 180; }
/** Distancia en metros entre dos puntos {la, lo}. */
export function distM(a, b) {
  var p1 = _rad(a.la), p2 = _rad(b.la), dp = _rad(b.la - a.la), dl = _rad(b.lo - a.lo);
  var h = Math.sin(dp / 2) * Math.sin(dp / 2) + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) * Math.sin(dl / 2);
  return 2 * R * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}
/** Rumbo de a hacia b en grados (0 = norte, 90 = este). */
export function bearingDeg(a, b) {
  var p1 = _rad(a.la), p2 = _rad(b.la), dl = _rad(b.lo - a.lo);
  var y = Math.sin(dl) * Math.cos(p2), x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}
/** Rumbo en palabras (8 puntos): clave i18n y texto de respaldo. */
export function bearingWord(deg) {
  var w = [['dir_n', 'norte'], ['dir_ne', 'noreste'], ['dir_e', 'este'], ['dir_se', 'sureste'], ['dir_s', 'sur'], ['dir_sw', 'suroeste'], ['dir_w', 'oeste'], ['dir_nw', 'noroeste']];
  return w[Math.round(((deg % 360) + 360) % 360 / 45) % 8];
}
/**
 * Distancia para mostrar: { m (redondeada), close } — close = más cerca de lo que distinguen los dos GPS (entonces manda la señal de
 * Bluetooth). Redondeo: de 5 en 5 m hasta 100, de 10 en 10 hasta 1 km, y en km con un decimal.
 */
export function distShow(m, accA, accB) {
  var err = Math.max(10, (accA || 0) + (accB || 0));
  if (m <= err) return { m: Math.round(m), close: true, txt: '' };
  var r = m < 100 ? Math.round(m / 5) * 5 : m < 1000 ? Math.round(m / 10) * 10 : Math.round(m / 100) * 100;
  return { m: r, close: false, txt: r < 1000 ? r + ' m' : (Math.round(r / 100) / 10).toString().replace('.', ',') + ' km' };
}

/** [pruebas] olvidar todo */
export function _nearReset() { _sig.clear(); _loc.clear(); }
