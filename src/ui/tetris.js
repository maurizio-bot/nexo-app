/**
 * NEXO — Tetris (Fase A entretenimiento, pedido del dueño 05-11: «Tetris, primero solo y después basura»).
 *
 * MODO SOLO (este archivo): juego de bloques que caen, 10×20, con puntaje/líneas/nivel y CLASIFICACIÓN local (mejores
 * puntajes en el teléfono). Canvas tipo arcade (mismo enfoque que nexo_game.js). Más adelante: modo VERSUS (cada uno su
 * tablero; al hacer líneas se le manda «basura» al otro) — eso se sincroniza por EVENTOS (mensajes), no posición a
 * posición, así que encaja con el canal de NEXO y aguanta el lag; por eso el estado del juego vive separado del dibujo.
 *
 * La LÓGICA (rejilla, piezas, rotación, líneas, game over) está desacoplada del CANVAS y de los temporizadores, para
 * poder probarla en el simulador (jsdom no dibuja canvas) con los ganchos __nexoTetris* de forma determinista (semilla).
 */
import { _showInfoToast } from './ui_bits.js';
import { t } from './i18n.js';

var COLS = 10, ROWS = 20;
var LB_KEY = 'nexo_tetris_scores_v1';
// Colores clásicos de Tetris (reconocibles) sobre tablero oscuro.
var COLORS = { I: '#22d3ee', O: '#facc15', T: '#a855f7', S: '#22c55e', Z: '#ef4444', J: '#3b82f6', L: '#f97316', G: '#6b7280' }; // G = basura (gris) del modo versus
var SHAPES = {
  I: [[0, 0, 0, 0], [1, 1, 1, 1], [0, 0, 0, 0], [0, 0, 0, 0]],
  J: [[1, 0, 0], [1, 1, 1], [0, 0, 0]],
  L: [[0, 0, 1], [1, 1, 1], [0, 0, 0]],
  O: [[1, 1], [1, 1]],
  S: [[0, 1, 1], [1, 1, 0], [0, 0, 0]],
  T: [[0, 1, 0], [1, 1, 1], [0, 0, 0]],
  Z: [[1, 1, 0], [0, 1, 1], [0, 0, 0]],
};
var TYPES = ['I', 'J', 'L', 'O', 'S', 'T', 'Z'];
var LINE_SCORE = [0, 100, 300, 500, 800];

// ---------- Clasificación local ----------
export function loadScores() {
  try { var a = JSON.parse(localStorage.getItem(LB_KEY) || '[]'); return Array.isArray(a) ? a.filter(function(e) { return e && typeof e.score === 'number'; }) : []; } catch (e) { return []; }
}
function addScore(score, lines) {
  var list = loadScores();
  list.push({ score: Math.max(0, Math.floor(score) || 0), lines: Math.max(0, Math.floor(lines) || 0), ts: Date.now() });
  list.sort(function(a, b) { return b.score - a.score; });
  list = list.slice(0, 10);
  try { localStorage.setItem(LB_KEY, JSON.stringify(list)); } catch (e) {}
  return list;
}

// ---------- RNG con semilla (para pruebas deterministas) ----------
function mulberry32(a) { return function() { a |= 0; a = a + 0x6D2B79F5 | 0; var tt = Math.imul(a ^ a >>> 15, 1 | a); tt = tt + Math.imul(tt ^ tt >>> 7, 61 | tt) ^ tt; return ((tt ^ tt >>> 14) >>> 0) / 4294967296; }; }

// ---------- Lógica pura (sin canvas, sin timers) ----------
function emptyGrid() { var g = []; for (var r = 0; r < ROWS; r++) { var row = []; for (var c = 0; c < COLS; c++) row.push(''); g.push(row); } return g; }
function matCopy(m) { return m.map(function(row) { return row.slice(); }); }
function rotCW(m) { var n = m.length, o = []; for (var r = 0; r < n; r++) { o.push([]); for (var c = 0; c < n; c++) o[r].push(m[n - 1 - c][r]); } return o; }

function collide(G, m, px, py) {
  for (var r = 0; r < m.length; r++) for (var c = 0; c < m[r].length; c++) {
    if (!m[r][c]) continue;
    var x = px + c, y = py + r;
    if (x < 0 || x >= COLS || y >= ROWS) return true;
    if (y >= 0 && G.grid[y][x]) return true;
  }
  return false;
}
function nextFromBag(G) {
  if (!G.bag || !G.bag.length) {
    G.bag = TYPES.slice();
    for (var i = G.bag.length - 1; i > 0; i--) { var j = Math.floor(G.rng() * (i + 1)); var tmp = G.bag[i]; G.bag[i] = G.bag[j]; G.bag[j] = tmp; }
  }
  return G.bag.pop();
}
function spawn(G) {
  var type = G.nextType || nextFromBag(G);
  G.nextType = nextFromBag(G);
  var m = matCopy(SHAPES[type]);
  var px = Math.floor((COLS - m[0].length) / 2), py = 0;
  G.piece = { type: type, m: m, x: px, y: py };
  if (collide(G, m, px, py)) G.over = true;   // no entra → game over
}
function newGame(seed) {
  var G = { grid: emptyGrid(), rng: (seed === undefined || seed === null) ? Math.random : mulberry32(seed >>> 0), bag: null, nextType: null, piece: null, score: 0, lines: 0, level: 0, over: false };
  G.nextType = nextFromBag(G);
  spawn(G);
  return G;
}
function tryMove(G, dx, dy) {
  if (G.over || !G.piece) return false;
  var p = G.piece;
  if (collide(G, p.m, p.x + dx, p.y + dy)) return false;
  p.x += dx; p.y += dy; return true;
}
function tryRotate(G) {
  if (G.over || !G.piece) return false;
  var p = G.piece, rm = rotCW(p.m);
  var kicks = [0, -1, 1, -2, 2];
  for (var i = 0; i < kicks.length; i++) { if (!collide(G, rm, p.x + kicks[i], p.y)) { p.m = rm; p.x += kicks[i]; return true; } }
  return false;
}
function clearLines(G) {
  var kept = [], cleared = 0;
  for (var r = 0; r < ROWS; r++) { var full = G.grid[r].every(function(c) { return !!c; }); if (full) cleared++; else kept.push(G.grid[r]); }
  while (kept.length < ROWS) { var row = []; for (var c = 0; c < COLS; c++) row.push(''); kept.unshift(row); }
  G.grid = kept;
  if (cleared) { G.score += LINE_SCORE[cleared] * (G.level + 1); G.lines += cleared; G.level = Math.floor(G.lines / 10); }
  return cleared;
}
function lockPiece(G) {
  var p = G.piece;
  for (var r = 0; r < p.m.length; r++) for (var c = 0; c < p.m[r].length; c++) { if (p.m[r][c]) { var y = p.y + r, x = p.x + c; if (y >= 0 && y < ROWS && x >= 0 && x < COLS) G.grid[y][x] = p.type; } }
  clearLines(G);
  spawn(G);
}
function step(G) {                   // una «caída» de gravedad: baja o aterriza
  if (G.over || !G.piece) return;
  if (!tryMove(G, 0, 1)) lockPiece(G);
}
function hardDrop(G) {
  if (G.over || !G.piece) return;
  var n = 0; while (tryMove(G, 0, 1)) n++;
  G.score += n * 2;
  lockPiece(G);
}
function softDrop(G) { if (tryMove(G, 0, 1)) G.score += 1; else lockPiece(G); }

// ---------- Overlay (canvas + controles); solo en la app real ----------
var openG = null, raf = null, dropTimer = null;
function dropInterval(level) { return Math.max(90, 800 - level * 70); }

export function openTetris() {
  _close();
  var G = openG = newGame();
  var ov = document.createElement('div'); ov.id = 'tetris-overlay'; ov.className = 'tetris-overlay';
  var panel = document.createElement('div'); panel.className = 'tetris-panel';
  var head = document.createElement('div'); head.className = 'tetris-head';
  var title = document.createElement('div'); title.className = 'tetris-title'; title.textContent = t('game_tetris_name', 'Tetris');
  var stat = document.createElement('div'); stat.className = 'tetris-stat';
  head.appendChild(title); head.appendChild(stat);
  var boardWrap = document.createElement('div'); boardWrap.className = 'tetris-board-wrap';
  var canvas = document.createElement('canvas'); canvas.className = 'tetris-canvas'; boardWrap.appendChild(canvas);
  // Controles
  var pad = document.createElement('div'); pad.className = 'tetris-pad';
  function mkBtn(label, cls, fn) {
    var b = document.createElement('button'); b.type = 'button'; b.className = 'tetris-btn ' + cls; b.textContent = label;
    var act = function(e) { e.preventDefault(); e.stopPropagation(); if (G.over) return; fn(); _render(G, canvas, stat); };
    b.addEventListener('click', act);
    return b;
  }
  pad.appendChild(mkBtn('◀', 'tl', function() { tryMove(G, -1, 0); }));
  pad.appendChild(mkBtn('⟳', 'tr', function() { tryRotate(G); }));
  pad.appendChild(mkBtn('▶', 'tl', function() { tryMove(G, 1, 0); }));
  pad.appendChild(mkBtn('⬇', 'td', function() { softDrop(G); }));
  pad.appendChild(mkBtn('⤓', 'thd', function() { hardDrop(G); }));
  var foot = document.createElement('div'); foot.className = 'tetris-foot';
  var again = document.createElement('button'); again.type = 'button'; again.className = 'tetris-again'; again.style.display = 'none'; again.textContent = t('chat_ttt_new_game', 'Nueva partida');
  again.addEventListener('click', function(e) { e.preventDefault(); e.stopPropagation(); _restart(canvas, stat, again); });
  var close = document.createElement('button'); close.type = 'button'; close.className = 'tetris-close'; close.textContent = t('chat_close', 'Cerrar');
  close.addEventListener('click', function(e) { e.preventDefault(); e.stopPropagation(); _close(); });
  foot.appendChild(again); foot.appendChild(close);
  panel.appendChild(head); panel.appendChild(boardWrap); panel.appendChild(pad); panel.appendChild(foot);
  ov.appendChild(panel); document.body.appendChild(ov);

  // Teclado (escritorio / pruebas en Chromium)
  ov._key = function(e) {
    if (G.over) return;
    if (e.key === 'ArrowLeft') { tryMove(G, -1, 0); } else if (e.key === 'ArrowRight') { tryMove(G, 1, 0); }
    else if (e.key === 'ArrowUp') { tryRotate(G); } else if (e.key === 'ArrowDown') { softDrop(G); }
    else if (e.key === ' ') { e.preventDefault(); hardDrop(G); } else return;
    _render(G, canvas, stat);
  };
  window.addEventListener('keydown', ov._key);

  _sizeCanvas(canvas);
  window.addEventListener('resize', ov._resize = function() { _sizeCanvas(canvas); _render(G, canvas, stat); });
  _render(G, canvas, stat);
  _startLoop(canvas, stat, again);
  return G;
}
function _restart(canvas, stat, again) { openG = newGame(); again.style.display = 'none'; _render(openG, canvas, stat); _startLoop(canvas, stat, again); }
function _startLoop(canvas, stat, again) {
  if (dropTimer) clearInterval(dropTimer);
  var tick = function() {
    var G = openG; if (!G) return;
    if (G.over) { clearInterval(dropTimer); dropTimer = null; _onOver(G, canvas, stat, again); return; }
    step(G); _render(G, canvas, stat);
    if (G.over) { clearInterval(dropTimer); dropTimer = null; _onOver(G, canvas, stat, again); return; }
    // reprogramar con la velocidad del nivel actual
    clearInterval(dropTimer); dropTimer = setInterval(tick, dropInterval(G.level));
  };
  dropTimer = setInterval(tick, dropInterval(openG.level));
}
function _onOver(G, canvas, stat, again) {
  var list = addScore(G.score, G.lines);
  again.style.display = '';
  _render(G, canvas, stat, list);
  try { _showInfoToast(t('game_tetris_over', 'Fin — ') + G.score + t('game_tetris_pts', ' pts'), 2600); } catch (e) {}
}
function _sizeCanvas(canvas) {
  var wrap = canvas.parentNode; if (!wrap) return;
  // #dueño 05-11: el tablero salía MINÚSCULO. Causa: se medía wrap.clientHeight, pero el wrap es flex:1 dentro de un
  // panel de alto automático → su alto depende del canvas, que depende de su alto (círculo); a veces daba un valor chico
  // y la celda colapsaba al mínimo. Ahora el ALTO se saca de la VENTANA menos el «cromo» (cabecera+controles+pie ≈ 212 px)
  // y el ANCHO del contenedor (ese sí es fiable). Así el tablero usa casi toda la pantalla.
  var vw = (typeof window !== 'undefined' && window.innerWidth) || 360;
  var vh = (typeof window !== 'undefined' && window.innerHeight) || 720;
  var wrapW = wrap.clientWidth || 0;
  var availW = wrapW > 40 ? wrapW : Math.min(vw - 28, 460);
  var availH = Math.max(260, vh - 204);
  var cell = Math.max(16, Math.floor(Math.min(availW / COLS, availH / ROWS)));
  var dpr = Math.min((typeof window !== 'undefined' && window.devicePixelRatio) || 1, 2);
  canvas.width = cell * COLS * dpr; canvas.height = cell * ROWS * dpr;
  canvas.style.width = (cell * COLS) + 'px'; canvas.style.height = (cell * ROWS) + 'px';
  canvas._cell = cell; canvas._dpr = dpr;
}
function _render(G, canvas, stat, list) {
  if (stat) stat.textContent = t('game_tetris_score', 'Puntos ') + G.score + ' · ' + t('game_tetris_lines', 'Líneas ') + G.lines + ' · ' + t('game_tetris_level', 'Nivel ') + (G.level + 1);
  var ctx = canvas.getContext && canvas.getContext('2d'); if (!ctx) return;      // jsdom: sin canvas, solo lógica
  var cell = canvas._cell || 16, dpr = canvas._dpr || 1; ctx.save(); ctx.scale(dpr, dpr);
  ctx.fillStyle = '#0a1020'; ctx.fillRect(0, 0, COLS * cell, ROWS * cell);
  ctx.strokeStyle = 'rgba(255,255,255,0.05)';
  for (var r = 0; r < ROWS; r++) for (var c = 0; c < COLS; c++) { if (G.grid[r][c]) _cell(ctx, c, r, cell, COLORS[G.grid[r][c]]); else { ctx.strokeRect(c * cell + 0.5, r * cell + 0.5, cell - 1, cell - 1); } }
  if (G.piece && !G.over) { var p = G.piece; for (var pr = 0; pr < p.m.length; pr++) for (var pc = 0; pc < p.m[pr].length; pc++) if (p.m[pr][pc]) _cell(ctx, p.x + pc, p.y + pr, cell, COLORS[p.type]); }
  if (G.over) {
    ctx.fillStyle = 'rgba(0,0,0,0.72)'; ctx.fillRect(0, 0, COLS * cell, ROWS * cell);
    ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = 'bold ' + Math.floor(cell * 1.3) + 'px sans-serif'; ctx.fillText(t('game_tetris_over_title', 'GAME OVER'), COLS * cell / 2, ROWS * cell / 2 - cell * 2.6);
    ctx.font = Math.floor(cell * 0.9) + 'px sans-serif'; ctx.fillText(G.score + t('game_tetris_pts', ' pts'), COLS * cell / 2, ROWS * cell / 2 - cell * 1.1);
    var scores = list || loadScores();
    ctx.font = Math.floor(cell * 0.72) + 'px sans-serif'; ctx.fillText(t('game_tetris_best', '— Mejores —'), COLS * cell / 2, ROWS * cell / 2 + cell * 0.2);
    scores.slice(0, 5).forEach(function(s, i) { ctx.fillText((i + 1) + '.  ' + s.score, COLS * cell / 2, ROWS * cell / 2 + cell * (1.2 + i)); });
  }
  ctx.restore();
}
function _cell(ctx, c, r, cell, color) {
  if (r < 0) return;
  ctx.fillStyle = color; ctx.fillRect(c * cell + 1, r * cell + 1, cell - 2, cell - 2);
  ctx.fillStyle = 'rgba(255,255,255,0.22)'; ctx.fillRect(c * cell + 1, r * cell + 1, cell - 2, Math.max(2, (cell - 2) * 0.28)); // brillo arriba
}
function _close() {
  if (dropTimer) { clearInterval(dropTimer); dropTimer = null; }
  if (raf && window.cancelAnimationFrame) { window.cancelAnimationFrame(raf); raf = null; }
  var ov = document.getElementById('tetris-overlay');
  if (ov) { try { window.removeEventListener('keydown', ov._key); window.removeEventListener('resize', ov._resize); } catch (e) {} if (ov.parentNode) ov.parentNode.removeChild(ov); }
  openG = null;
}

export function tetrisOverlayOpen() { return !!document.getElementById('tetris-overlay'); }
export function tetrisCloseOverlay() { _close(); }

// ---------- Núcleo PURO reutilizado por el modo VERSUS (tetris_versus.js), sin tocar el modo solo ----------
export { COLS, ROWS, COLORS, newGame, tryMove, tryRotate, step, hardDrop, softDrop };
// #dueño 05-11: en VERSUS, al hacer líneas le mando «basura» al rival; esta función la APLICA a mi tablero: n filas
// grises ('G') suben desde abajo, cada una con un hueco (holes[k] en 0..COLS-1). Si eso empuja bloques por encima del
// techo, o la pieza viva queda atrapada, pierdo (G.over). Determinista: el hueco viaja en el evento y se valida al llegar.
export function addGarbage(G, n, holes) {
  if (!G || G.over) return;
  for (var k = 0; k < n; k++) {
    var topHadBlocks = G.grid[0].some(function (c) { return !!c; });
    G.grid.shift();
    var hole = holes[k], row = [];
    for (var c = 0; c < COLS; c++) row.push(c === hole ? '' : 'G');
    G.grid.push(row);
    if (topHadBlocks) G.over = true;
  }
  if (G.piece && collide(G, G.piece.m, G.piece.x, G.piece.y)) G.over = true;
}

// ---------- Ganchos de prueba (tests/sim/tetris.js): lógica determinista, sin canvas ni timers ----------
try {
  if (typeof window !== 'undefined') {
    var TG = null;
    window.__nexoTetrisStart = function(seed) { TG = newGame(seed); return true; };
    window.__nexoTetrisState = function() { if (!TG) return null; return { grid: TG.grid.map(function(row) { return row.map(function(c) { return c || '.'; }).join(''); }), score: TG.score, lines: TG.lines, level: TG.level, over: TG.over, piece: TG.piece ? { type: TG.piece.type, x: TG.piece.x, y: TG.piece.y } : null, next: TG.nextType }; };
    window.__nexoTetrisMove = function(dx) { return TG ? tryMove(TG, dx, 0) : false; };
    window.__nexoTetrisRotate = function() { return TG ? tryRotate(TG) : false; };
    window.__nexoTetrisStep = function() { if (TG) step(TG); };
    window.__nexoTetrisSoft = function() { if (TG) softDrop(TG); };
    window.__nexoTetrisHardDrop = function() { if (TG) hardDrop(TG); };
    // Para armar un tablero concreto en las pruebas: filas de 10 chars ('.'=vacío, letra=lleno). No toca la pieza viva.
    window.__nexoTetrisSetGrid = function(rows) { if (!TG || !Array.isArray(rows)) return; for (var r = 0; r < ROWS; r++) { var s = rows[r] || ''; for (var c = 0; c < COLS; c++) { var ch = s[c] || '.'; TG.grid[r][c] = (ch === '.' || ch === ' ') ? '' : ch; } } };
    window.__nexoCloseTetris = function() { _close(); };   // botón atrás de Android (chat_nav.js)
    window.__nexoOpenTetris = function() { openTetris(); };  // abrir el overlay (prueba visual en Chromium / acceso directo)
  }
} catch (e) {}
