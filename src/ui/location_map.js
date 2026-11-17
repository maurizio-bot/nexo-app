/**
 * NEXO — Miniatura del mapa de una ubicación.
 * 3201 (dueño 17-11: miniatura del mapa al mandar la ubicación; eligió la opción A): quien MANDA su ubicación baja UNA vez las 2–4
 * teselas de OpenStreetMap que cubren la zona, las pinta en un canvas con el pin (y el círculo de precisión si cabe) y el crédito
 * «© OpenStreetMap» (lo pide su licencia), y la miniatura viaja DENTRO del mensaje cifrado (meta.map = data:image/webp;base64,…).
 * Quien la recibe la ve sin pedir nada a ningún servidor: render.js solo acepta una imagen en base64 (ni URL, ni SVG, ni HTML) y el
 * vault la valida también al guardar (vault_shared.js _locMapOk). Sin internet, con Tor puesto a mano (privacidad) o si no está en
 * LOC_MAP_WAIT_MS, la ubicación sale sin mapa (la tarjeta de siempre): el mapa nunca frena el envío.
 * Uso de las teselas de OSM (operations.osmfoundation.org/policies/tiles): solo al mandar, por decisión del usuario (nunca al pintar,
 * ni para precargar); 2–4 teselas por envío; con la caché HTTP normal (su política pide respetarla y NO mandar «no-cache»); sin
 * cookies. El WebView manda su propio User-Agent (no dice NEXO): ver el informe de la 3201.
 */
import { _locMapOk } from '../vault/vault_shared.js';

export var LOC_MAP_WAIT_MS = 4000;       // tope para tener el mapa; pasado, sale sin él
var TILE_URL = 'https://tile.openstreetmap.org/';   // un solo sitio: para cambiar de servidor de teselas basta con esto
var WIN_W = 240, WIN_H = 135;            // ventana del mapa en píxeles de tesela (16:9; nunca más de 2×2 teselas)
// Escala y calidad, de mejor a más chica: se queda la primera que cabe en BUDGET. 480×270 se ve nítido en la burbuja (~260 px).
var STEPS = [[2, 0.62], [2, 0.5], [2, 0.4], [1.5, 0.45], [1, 0.5]];
// Caracteres del data URI. Así el mensaje entero, ya cifrado, cabe en UN paquete por internet (NET_TEXT_ONE = 20 000: va al
// buzón de los relés aunque el otro esté dormido) y por Bluetooth tarda poco más que antes. El tope duro de quien recibe es otro.
var BUDGET = 12000;
var SEND_MAX = 30000;                    // si ni la más chica cabe en BUDGET, se manda la más chica solo hasta esto
var TILE_MAX_BYTES = 400000;             // una tesela más grande que esto no es una tesela

// ¿Se puede intentar? '' = sí; si no, el motivo (para el diagnóstico)
function _whyNot() {
  if (typeof window === 'undefined' || window.NEXO_LOC_MAP === false) return 'apagado';
  if (typeof fetch !== 'function' || typeof createImageBitmap !== 'function') return 'sin fetch/createImageBitmap';
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return 'sin internet';
  var net = window.bleInterface && window.bleInterface.net;
  if (net && net.state && net.state.tor === true) return 'Tor puesto a mano (privacidad)';
  // Con relés configurados, «en línea» lo dicen ellos (más fiable que navigator.onLine con un Wi-Fi sin salida); por un puente
  // (internet de otro teléfono por Bluetooth) no hay internet propio
  if (net && net.relays && net.relays.size > 0 && typeof net.online === 'function' &&
      (!net.online() || (typeof net.gwOnly === 'function' && net.gwOnly()))) return 'sin internet propio';
  var c = document.createElement('canvas');
  if (!c.getContext || !c.getContext('2d')) return 'sin canvas';
  return '';
}

// Mercator web: píxel global a la escala de la tesela (256 px) del zoom z
function _world(lat, lng, z) {
  var n = 256 * Math.pow(2, z);
  var la = Math.max(-85.0511, Math.min(85.0511, lat)) * Math.PI / 180;
  return { x: (lng + 180) / 360 * n, y: (1 - Math.log(Math.tan(la) + 1 / Math.cos(la)) / Math.PI) / 2 * n };
}
// Con una precisión mala (posición por red, cientos de metros) se aleja el mapa para que el círculo quepa
function _zoomFor(acc) { return acc <= 100 ? 16 : acc <= 200 ? 15 : acc <= 400 ? 14 : 13; }

function _tile(z, tx, ty, signal) {
  var N = Math.pow(2, z);
  if (ty < 0 || ty >= N) return Promise.resolve(null);
  var x = ((tx % N) + N) % N;
  return fetch(TILE_URL + z + '/' + x + '/' + ty + '.png', { mode: 'cors', credentials: 'omit', signal: signal })
    .then(function(r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.blob(); })
    .then(function(b) {
      if (!b || !b.size || b.size > TILE_MAX_BYTES || (b.type && !/^image\/(png|jpeg|webp)$/.test(b.type))) throw new Error('tesela no válida');
      return createImageBitmap(b);
    });
}

var PIN = 'M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z';   // el mismo pin de la tarjeta
function _draw(tiles, x0, y0, s, accPx) {
  var c = document.createElement('canvas');
  c.width = Math.round(WIN_W * s); c.height = Math.round(WIN_H * s);
  var g = c.getContext('2d');
  g.fillStyle = '#f2efe9'; g.fillRect(0, 0, c.width, c.height);
  g.imageSmoothingEnabled = true; try { g.imageSmoothingQuality = 'high'; } catch (e) {}
  tiles.forEach(function(t) { if (t.bm) g.drawImage(t.bm, (t.tx * 256 - x0) * s, (t.ty * 256 - y0) * s, 256 * s, 256 * s); });
  var cx = c.width / 2, cy = c.height / 2;
  // Círculo de precisión (si es razonable: ni un punto bajo el pin ni más grande que el mapa)
  if (accPx >= 8 && accPx <= WIN_W) {
    g.beginPath(); g.arc(cx, cy, accPx * s, 0, Math.PI * 2);
    g.fillStyle = 'rgba(0,122,255,0.14)'; g.fill();
    g.lineWidth = 1.5 * s; g.strokeStyle = 'rgba(0,122,255,0.55)'; g.stroke();
  }
  // Pin con la punta justo en el punto
  var k = 1.15 * s;
  g.save();
  g.translate(cx - 12 * k, cy - 22 * k); g.scale(k, k);
  g.shadowColor = 'rgba(0,0,0,0.35)'; g.shadowBlur = 2 * s; g.shadowOffsetY = s;
  var P2 = window.Path2D, p = typeof P2 === 'function' ? new P2(PIN) : null;
  g.fillStyle = '#FF3B30';
  if (p) g.fill(p); else { g.beginPath(); g.arc(12, 9, 7, 0, Math.PI * 2); g.fill(); }
  g.shadowColor = 'transparent';
  g.lineWidth = 1.2; g.strokeStyle = '#ffffff'; if (p) g.stroke(p);
  g.beginPath(); g.arc(12, 9, 2.6, 0, Math.PI * 2); g.fillStyle = '#ffffff'; g.fill();
  g.restore();
  // Crédito obligatorio de OpenStreetMap, abajo a la derecha
  var txt = '© OpenStreetMap', fs = Math.round(9 * s), pad = Math.round(2.5 * s);
  g.font = '600 ' + fs + 'px sans-serif'; g.textBaseline = 'middle';
  var tw = g.measureText(txt).width, bw = tw + pad * 2, bh = fs + pad * 2;
  g.fillStyle = 'rgba(255,255,255,0.82)'; g.fillRect(c.width - bw, c.height - bh, bw, bh);
  g.fillStyle = '#2b2b2b'; g.fillText(txt, c.width - bw + pad, c.height - bh / 2);
  return c;
}

function _encode(c, q) {
  var u = '';
  try { u = c.toDataURL('image/webp', q); } catch (e) { u = ''; }
  if (u.indexOf('data:image/webp;base64,') !== 0) { try { u = c.toDataURL('image/jpeg', q); } catch (e) { u = ''; } } // sin WebP
  return u;
}

async function _build(lat, lng, acc, signal, info) {
  var z = _zoomFor(acc), w = _world(lat, lng, z);
  var x0 = Math.round(w.x - WIN_W / 2), y0 = Math.round(w.y - WIN_H / 2);
  var list = [];
  for (var ty = Math.floor(y0 / 256); ty <= Math.floor((y0 + WIN_H - 1) / 256); ty++) {
    for (var tx = Math.floor(x0 / 256); tx <= Math.floor((x0 + WIN_W - 1) / 256); tx++) list.push({ tx: tx, ty: ty, bm: null });
  }
  info.z = z; info.tiles = list.length;
  try {
    await Promise.all(list.map(function(t) { return _tile(z, t.tx, t.ty, signal).then(function(b) { t.bm = b; }); }));
    if (signal && signal.aborted) return '';
    var mpp = 156543.03392 * Math.cos(lat * Math.PI / 180) / Math.pow(2, z);   // metros por píxel de tesela
    var accPx = acc > 0 ? acc / mpp : 0;
    var best = '', lastS = 0, c = null;
    for (var i = 0; i < STEPS.length; i++) {
      if (STEPS[i][0] !== lastS) { c = _draw(list, x0, y0, STEPS[i][0], accPx); lastS = STEPS[i][0]; }
      var u = _encode(c, STEPS[i][1]);
      if (!u) continue;
      if (!best || u.length < best.length) { best = u; info.px = c.width + 'x' + c.height; info.q = STEPS[i][1]; }
      if (u.length <= BUDGET) break;
    }
    return best.length <= SEND_MAX && _locMapOk(best) ? best : '';
  } finally {
    list.forEach(function(t) { try { if (t.bm && t.bm.close) t.bm.close(); } catch (e) {} });
  }
}

// La miniatura (data URI) o '' si no se pudo a tiempo. Nunca rechaza.
export function locationMap(lat, lng, accuracy, maxMs) {
  lat = Number(lat); lng = Number(lng);
  var acc = Number(accuracy) || 0, t0 = Date.now();
  var why = (isFinite(lat) && isFinite(lng)) ? _whyNot() : 'coordenadas no válidas';
  if (why) { console.log('[ATTACH] Ubicación sin mapa: ' + why); return Promise.resolve(''); }
  var ctl = typeof AbortController === 'function' ? new AbortController() : null;
  var info = {};
  return new Promise(function(resolve) {
    var done = false;
    var finish = function(v, note) {
      if (done) return;
      done = true; clearTimeout(timer);
      try { if (ctl) ctl.abort(); } catch (e) {}   // lo que siga en vuelo se corta (no se baja nada más)
      var ms = Date.now() - t0;
      if (v) console.log('[ATTACH] Mapa de la ubicación: ' + info.tiles + ' teselas (z' + info.z + '), ' + info.px + ' q' + info.q + ', ' + Math.round(v.length * 3 / 4 / 102.4) / 10 + ' KB en ' + ms + ' ms');
      else console.log('[ATTACH] Ubicación sin mapa (' + (note || 'no se pudo') + ', ' + ms + ' ms)');
      resolve(v || '');
    };
    var timer = setTimeout(function() { finish('', 'no llegó en ' + Math.round((maxMs || LOC_MAP_WAIT_MS) / 1000) + ' s'); }, maxMs || LOC_MAP_WAIT_MS);
    _build(lat, lng, acc, ctl && ctl.signal, info).then(function(v) { finish(v, v ? '' : 'demasiado grande'); }, function(e) { finish('', (e && e.message) || 'error'); });
  });
}
