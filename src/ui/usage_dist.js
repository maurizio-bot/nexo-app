/**
 * NEXO — Distribución de medidas para el diagnóstico (COLA 8 de docs/REDES.md; dueño 20-11: «las medias engañan: hubo 74 s y 377 s sueltos»).
 * Guarda las muestras de un día de forma ACOTADA (MAX_SAMPLES por camino) y da mediana y percentiles. Solo números, sin estado propio:
 * el arreglo vive en el contador del día (usage_stats.js). Con pocas muestras NO se inventan percentiles (ver distStats).
 */
var MAX_SAMPLES = 200;   // por camino y día: ~1 KB en localStorage
var MIN_MEDIAN = 3;      // con menos de 3 muestras la mediana no dice nada que la media no diga
var MIN_TAIL = 10;       // el percentil 90 (o 10) con menos de 10 muestras sería simplemente el máximo (o el mínimo)

/** Agrega x a las muestras (arreglo, se crea si falta). Al llenarse, reemplaza una muestra del medio (nunca el mínimo ni el máximo vigentes):
 *  los extremos del día se conservan. seen = cuántas muestras ha habido en total (decide el lugar de forma repetible, sin azar). Devuelve el arreglo. */
export function distPush(arr, x, seen, max) {
  max = max || MAX_SAMPLES;
  arr = Array.isArray(arr) ? arr : [];
  if (typeof x !== 'number' || !isFinite(x)) return arr;
  if (arr.length < max) { arr.push(x); return arr; }
  var imin = 0, imax = 0, i;
  for (i = 1; i < arr.length; i++) { if (arr[i] < arr[imin]) imin = i; if (arr[i] > arr[imax]) imax = i; }
  var idx = Math.floor((seen || arr.length) * 2654435761) % arr.length;
  for (i = 0; i < arr.length && (idx === imin || idx === imax); i++) idx = (idx + 1) % arr.length;
  if (idx !== imin && idx !== imax) arr[idx] = x; // x puede ser el nuevo mínimo o máximo: entra igual y los viejos extremos siguen en el arreglo
  return arr;
}

function _rank(s, p) { return s[Math.max(0, Math.min(s.length - 1, Math.ceil(p / 100 * s.length) - 1))]; } // rango más cercano

/** {n, med, p90, p10, lo, hi}; med solo con ≥ 3 muestras y p90/p10 solo con ≥ 10 (si no, son null). null sin muestras. */
export function distStats(arr) {
  if (!Array.isArray(arr)) return null;
  var s = arr.filter(function(v) { return typeof v === 'number' && isFinite(v); }).sort(function(a, b) { return a - b; }), n = s.length;
  if (!n) return null;
  var med = n < MIN_MEDIAN ? null : (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2);
  return { n: n, med: med, p90: n < MIN_TAIL ? null : _rank(s, 90), p10: n < MIN_TAIL ? null : _rank(s, 10), lo: s[0], hi: s[n - 1] };
}
export { MAX_SAMPLES };
