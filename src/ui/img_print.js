/**
 * img_print.js — huella de una imagen (3065, dueño 13-11: «cualquier cosa subida por un user se debe ligar a su ID así ya no
 * hay error»). La foto de perfil queda ligada al NEXO ID de quien la puso por su huella: cada teléfono recuerda de quién es cada
 * huella (la suya, las de sus contactos y las que tuvieron antes) y no deja que otro la use como suya.
 *
 * Huella v1 (3028): dHash 8×8 de grises + color medio ({ b: '0101…' 64, c: [r, g, b] }). Reconoce la misma foto re-guardada o
 * re-escalada, pero NO un recorte (acercar la cara) ni la foto con un borde alrededor, y confunde dos fotos distintas hechas con
 * la misma plantilla (fondo, aro, rótulo) con otra persona.
 * Huella v2: además una miniatura en grises de 48×48 (t, base64). Dos fotos son la misma si, ALINEÁNDOLAS (se busca el recorte de
 * una que mejor encaja con la otra, en los dos sentidos: así se reconoce un recorte y una foto con borde), se parecen en ≥ 0,93
 * (correlación, con más peso en el centro, donde está la persona). Medido en Chrome con retratos generados
 * (tests/sim/huella_real.js): copias re-guardadas, capturas del visor, recortes, bordes y cambios de brillo ≈ 100 %; fotos
 * distintas y misma plantilla con otra persona: ≤ 0,89 (ninguna confundida). Si alguna de las dos huellas no tiene miniatura
 * (guardada por una versión anterior), se compara como en v1.
 */

var R = 48, G = 24, T_SAME = 0.93, T_COARSE = 0.8, RC = 16, T_CHROMA = 12;
var T_FULL = 8, T_COLOR = 24;

function _b64(u8) { var s = ''; for (var i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]); return btoa(s); }
function _unb64(s, n) { try { var bin = atob(s), a = new Float32Array(bin.length); for (var i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i); return a.length === n ? a : null; } catch (e) { return null; } }

// Huella de una imagen ya cargada (Image o canvas). mkCanvas(): un canvas nuevo (en el teléfono, document.createElement)
export function printOfImage(im, mkCanvas) {
  var w = im.naturalWidth || im.width, h = im.naturalHeight || im.height, side = Math.min(w, h), ox = (w - side) / 2, oy = (h - side) / 2;
  var cv = mkCanvas(); cv.width = 9; cv.height = 8;
  var cx = cv.getContext('2d', { willReadFrequently: true }) || cv.getContext('2d');
  cx.drawImage(im, ox, oy, side, side, 0, 0, 9, 8);
  var d = cx.getImageData(0, 0, 9, 8).data, bits = '', r = 0, g = 0, b = 0;
  var lum = function(i) { return d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114; };
  for (var y = 0; y < 8; y++) for (var x = 0; x < 8; x++) { var i = (y * 9 + x) * 4; bits += lum(i) > lum(i + 4) ? '1' : '0'; }
  for (var k = 0; k < d.length; k += 4) { r += d[k]; g += d[k + 1]; b += d[k + 2]; }
  var cv2 = mkCanvas(); cv2.width = R; cv2.height = R;
  var c2 = cv2.getContext('2d', { willReadFrequently: true }) || cv2.getContext('2d');
  c2.drawImage(im, ox, oy, side, side, 0, 0, R, R);
  var d2 = c2.getImageData(0, 0, R, R).data, t = new Uint8Array(R * R);
  for (var j = 0; j < R * R; j++) t[j] = Math.round(d2[j * 4] * 0.299 + d2[j * 4 + 1] * 0.587 + d2[j * 4 + 2] * 0.114);
  // color (Cb, Cr) en 16×16: dos fotos que encajan en luz y sombra pero no en color (otra piel, otra ropa) no son la misma
  var cv3 = mkCanvas(); cv3.width = RC; cv3.height = RC;
  var c3 = cv3.getContext('2d', { willReadFrequently: true }) || cv3.getContext('2d');
  c3.drawImage(im, ox, oy, side, side, 0, 0, RC, RC);
  var d3 = c3.getImageData(0, 0, RC, RC).data, ch = new Uint8Array(RC * RC * 2);
  for (var q = 0; q < RC * RC; q++) {
    var R3 = d3[q * 4], G3 = d3[q * 4 + 1], B3 = d3[q * 4 + 2];
    ch[q] = Math.max(0, Math.min(255, Math.round(128 - 0.168736 * R3 - 0.331264 * G3 + 0.5 * B3)));
    ch[RC * RC + q] = Math.max(0, Math.min(255, Math.round(128 + 0.5 * R3 - 0.418688 * G3 - 0.081312 * B3)));
  }
  return { b: bits, c: [Math.round(r / 72), Math.round(g / 72), Math.round(b / 72)], t: _b64(t), k: _b64(ch) };
}

// ---- v1: dHash ----
function _ham(a, b) { var n = 0; for (var i = 0; i < 64; i++) if (a.charAt(i) !== b.charAt(i)) n++; return n; }
function _ok(b) { if (typeof b !== 'string' || b.length !== 64) return false; var ones = b.split('1').length - 1; return ones >= 4 && ones <= 60; }
function _col(a, b) { a = a || []; b = b || []; for (var j = 0; j < 3; j++) if (Math.abs((a[j] || 0) - (b[j] || 0)) > T_COLOR) return false; return true; }
function _v1(p, q) { return _ok(p.b) && _ok(q.b) && _ham(p.b, q.b) <= T_FULL && _col(p.c, q.c); }

// ---- v2: alineación ----
var _W = (function() { var w = new Float32Array(G * G); for (var y = 0; y < G; y++) for (var x = 0; x < G; x++) { var dx = (x + 0.5) / G - 0.5, dy = (y + 0.5) / G - 0.5; w[y * G + x] = Math.exp(-(dx * dx + dy * dy) / (2 * 0.22 * 0.22)); } return w; })();
// recorte (x0, y0, s: fracciones) de una miniatura R×R → G×G (bilineal)
function _sample(a, x0, y0, s, n, g, off) {
  n = n || R; g = g || G; off = off || 0;
  var out = new Float32Array(g * g);
  for (var y = 0; y < g; y++) for (var x = 0; x < g; x++) {
    var fx = (x0 + (x + 0.5) / g * s) * n - 0.5, fy = (y0 + (y + 0.5) / g * s) * n - 0.5;
    var ix = Math.max(0, Math.min(n - 2, Math.floor(fx))), iy = Math.max(0, Math.min(n - 2, Math.floor(fy)));
    var dx = Math.min(1, Math.max(0, fx - ix)), dy = Math.min(1, Math.max(0, fy - iy));
    out[y * g + x] = a[off + iy * n + ix] * (1 - dx) * (1 - dy) + a[off + iy * n + ix + 1] * dx * (1 - dy) + a[off + (iy + 1) * n + ix] * (1 - dx) * dy + a[off + (iy + 1) * n + ix + 1] * dx * dy;
  }
  return out;
}
// Diferencia media de color (Cb y Cr, con más peso en el centro) entre el recorte (s, x0, y0) de src y la otra entera
var _WC = (function() { var g = 12, w = new Float32Array(g * g); for (var y = 0; y < g; y++) for (var x = 0; x < g; x++) { var dx = (x + 0.5) / g - 0.5, dy = (y + 0.5) / g - 0.5; w[y * g + x] = Math.exp(-(dx * dx + dy * dy) / (2 * 0.22 * 0.22)); } return w; })();
function _chromaDiff(srcK, fullK, al) {
  var worst = 0;
  for (var ch = 0; ch < 2; ch++) {
    var a = _sample(srcK, al[1], al[2], al[0], RC, 12, ch * RC * RC), b = _sample(fullK, 0, 0, 1, RC, 12, ch * RC * RC), sw = 0, d = 0;
    for (var i = 0; i < a.length; i++) { sw += _WC[i]; d += _WC[i] * Math.abs(a[i] - b[i]); }
    worst = Math.max(worst, d / sw);
  }
  return worst;
}
function _ncc(a, b) {
  var sw = 0, ma = 0, mb = 0, i, k;
  for (i = 0; i < a.length; i++) { k = _W[i]; sw += k; ma += k * a[i]; mb += k * b[i]; }
  ma /= sw; mb /= sw;
  var s = 0, sa = 0, sb = 0;
  for (i = 0; i < a.length; i++) { k = _W[i]; var x = a[i] - ma, y = b[i] - mb; s += k * x * y; sa += k * x * x; sb += k * y * y; }
  return sa && sb ? s / Math.sqrt(sa * sb) : 0;
}
// El recorte de src que mejor encaja con full: rejilla gruesa y, si promete, ajuste fino alrededor de los 3 mejores
function _search(src, full) {
  var cands = [], s, i, j;
  for (s = 0.6; s <= 1.0001; s += 0.08) for (i = 0; i <= 4; i++) for (j = 0; j <= 4; j++) { var x0 = (1 - s) * i / 4, y0 = (1 - s) * j / 4; cands.push([_ncc(_sample(src, x0, y0, s), full), s, x0, y0]); }
  cands.sort(function(a, b) { return b[0] - a[0]; });
  var best = cands[0][0], bestAl = [cands[0][1], cands[0][2], cands[0][3]];
  if (best < T_COARSE) return [best, bestAl];
  var moves = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1], [1, -0.5, -0.5], [-1, 0.5, 0.5]];
  cands.slice(0, 3).forEach(function(c0) {
    var v = c0[0], cs = c0[1], cx = c0[2], cy = c0[3], step = 0.04;
    while (step > 0.004) {
      var improved = false;
      for (var m = 0; m < moves.length; m++) {
        var s2 = Math.min(1, Math.max(0.55, cs + moves[m][0] * step)), x2 = Math.min(1 - s2, Math.max(0, cx + moves[m][1] * step)), y2 = Math.min(1 - s2, Math.max(0, cy + moves[m][2] * step));
        var v2 = _ncc(_sample(src, x2, y2, s2), full);
        if (v2 > v + 1e-6) { v = v2; cs = s2; cx = x2; cy = y2; improved = true; }
      }
      if (!improved) step /= 2;
    }
    if (v > best) { best = v; bestAl = [cs, cx, cy]; }
  });
  return [best, bestAl];
}
var _memo = new Map();
function _h(s) { var h = 2166136261; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h.toString(36) + s.length; }
// Parecido 0…1 de dos miniaturas (alineándolas en los dos sentidos: recorte de una ↔ la otra entera)
export function printScore(p, q) {
  if (!p || !q || typeof p.t !== 'string' || typeof q.t !== 'string') return null;
  var hp = _h(p.t + (p.k || '')), hq = _h(q.t + (q.k || '')), key = hp < hq ? hp + '|' + hq : hq + '|' + hp;
  if (_memo.has(key)) return _memo.get(key);
  var a = _unb64(p.t, R * R), b = _unb64(q.t, R * R);
  if (!a || !b) return null;
  var af = _sample(a, 0, 0, 1), bf = _sample(b, 0, 0, 1);
  var s1 = _search(a, bf), s2 = _search(b, af), win = s1[0] >= s2[0] ? s1 : s2;
  var sc = { lum: win[0], color: null };
  // color en ese mismo encaje (si las dos huellas lo traen)
  var ka = typeof p.k === 'string' ? _unb64(p.k, RC * RC * 2) : null, kb = typeof q.k === 'string' ? _unb64(q.k, RC * RC * 2) : null;
  if (ka && kb && win[0] >= T_SAME) sc.color = win === s1 ? _chromaDiff(ka, kb, win[1]) : _chromaDiff(kb, ka, win[1]);
  if (_memo.size > 2000) _memo.clear();
  _memo.set(key, sc);
  return sc;
}
// ¿La misma foto? p, q: huellas v1 ({b, c}) o v2 ({b, c, t})
export function printSame(p, q) {
  if (!p || !q) return false;
  var sc = printScore(p, q);
  if (sc !== null) return sc.lum >= T_SAME && (sc.color === null || sc.color <= T_CHROMA);
  return _v1(p, q);
}
// Huella guardable (v1 obligatoria; la miniatura, si viene, bien formada)
export function printValid(p) { return !!(p && typeof p.b === 'string' && p.b.length === 64 && Array.isArray(p.c) && (p.t === undefined || (typeof p.t === 'string' && p.t.length <= 4096)) && (p.k === undefined || (typeof p.k === 'string' && p.k.length <= 1024))); }
