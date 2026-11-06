/**
 * NEXO — Tetris VERSUS (Fase A entretenimiento, pedido del dueño 05-11: «Tetris, primero solo y después basura»).
 *
 * Cada jugador tiene SU tablero; la SEMILLA es COMPARTIDA (el que invita la fija) → los dos reciben la MISMA cola de
 * piezas (justo). Al hacer líneas, le manda «basura» al rival (filas grises con un hueco). Se sincroniza por EVENTOS
 * (no posición a posición): una jugada/efecto es una acción oculta cifrada como cualquier mensaje → aguanta el lag y va
 * por el canal de NEXO (Bluetooth/Wi-Fi/Jump/internet). No hay servidor.
 *
 * Eventos ({type:'nexo_act', act:'game', g:'tetvs', gid, seq, e, ...}):
 *   {e:'start', seed}     el que invita; PRIMER evento de un gid nuevo; fija la semilla compartida.
 *   {e:'garbage', n, h}   «te mando n filas de basura con huecos h[]» (n 1..4, h[k] en 0..9, h.length==n).
 *   {e:'over'}            «perdí (se me llenó el tablero)».
 *
 * ROBUSTEZ / anti-trampa (se VALIDA SIEMPRE al recibir, nunca se confía en el otro):
 *   - seq estrictamente creciente por emisor → deduplica reenvíos de relé e ignora desordenados viejos.
 *   - garbage: n en 1..4, h array de n enteros 0..9; techo acumulado de basura por partida (MAX_GARBAGE_ROWS).
 *   - start: solo válido como PRIMER evento de un gid desconocido; seed entero.
 *   - tras el 'over' propio o del rival, se ignora todo lo demás.
 *   - el tablero del rival NUNCA se pinta como HTML; solo se muestra su ESTADO (jugando / perdió) y la basura.
 */
import { _normId } from './ble_helpers.js';
import { _sendTextTo } from './send.js';
import { _contactName, _getCurrentContactId } from './chat_format.js';
import { _showInfoToast } from './ui_bits.js';
import { recordGameResult } from './game_stats.js';
import { t } from './i18n.js';
// Núcleo PURO reutilizado del modo solo (exportado desde tetris.js sin tocar el solo):
import { COLS, ROWS, COLORS, newGame, tryMove, tryRotate, step, hardDrop, softDrop, addGarbage } from './tetris.js';

var NX_RE = /^nx[0-9a-z]{8}$/;
var GARBAGE_FOR = [0, 1, 2, 3, 4];      // líneas que hago → filas de basura que mando (1→1, 2→2, 3→3, 4→4). #dueño 06-11:
                                        // antes 1 línea mandaba 0 (regla del Tetris competitivo) y parecía roto; en NEXO
                                        // (casual) CADA línea manda basura, para que se vea reflejada en el rival.
var MAX_GARBAGE_ROWS = 60;              // techo acumulado de basura recibida por partida (anti-spam)
var games = {};                          // gid → estado
var openGid = null;
var loopTimer = null;

function _newGid() { return 'v' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
function _seed() { return (Math.floor(Math.random() * 0x7fffffff)) >>> 0; }
function _randHoles(n) { var h = []; for (var k = 0; k < n; k++) h.push(Math.floor(Math.random() * COLS)); return h; }

// ---- Envío de un evento (yo contra g.opp) ----
function _send(g, ev) {
  ev.type = 'nexo_act'; ev.act = 'game'; ev.g = 'tetvs'; ev.gid = g.gid; ev.seq = (g.seqOut = (g.seqOut || 0) + 1);
  try { _sendTextTo(g.opp, JSON.stringify(ev), '', true); } catch (e) {}
}
function _dropInterval(level) { return Math.max(140, 800 - level * 70); }

// ---- Loop de caída de MI tablero ----
function _startLoop() {
  if (loopTimer) { clearInterval(loopTimer); loopTimer = null; }
  var tick = function () {
    var g = games[openGid]; if (!g || g.over) { if (loopTimer) { clearInterval(loopTimer); loopTimer = null; } return; }
    _afterPlay(g, function () { step(g.G); });
    clearInterval(loopTimer); loopTimer = setInterval(tick, _dropInterval(g.G.level));
  };
  var g0 = games[openGid]; if (g0 && !g0.over) loopTimer = setInterval(tick, _dropInterval(g0.G.level));
}

// Hace una jugada en MI tablero y, DESPUÉS, mira si hice líneas (→ mando basura) o si perdí (→ mando 'over').
function _afterPlay(g, fn) {
  if (g.over || !g.G || g.G.over) return;
  var linesBefore = g.G.lines;
  fn();
  var delta = g.G.lines - linesBefore;
  if (delta > 0) {
    var n = GARBAGE_FOR[Math.min(delta, 4)] || 0;
    if (n > 0) { var h = _randHoles(n); g.sent = (g.sent || 0) + n; _send(g, { e: 'garbage', n: n, h: h }); }
  }
  if (g.G.over && !g.over) _lose(g);          // me llené → pierdo
  if (openGid === g.gid) _render(g);
}

function _lose(g) {
  if (g.over) return;
  g.over = true; g.winner = g.oppOver ? 'me' : 'opp';   // si el rival ya había perdido, gano yo; si no, pierdo
  _send(g, { e: 'over' });
  _finishRecord(g);
}
function _finishRecord(g) {
  if (g.recorded) return; g.recorded = true;
  try { recordGameResult(g.opp, 'tetvs', g.winner === 'me' ? 'win' : (g.winner === 'draw' ? 'draw' : 'loss')); } catch (e) {}
}

// ---- Recepción + validación ----
export function tetrisVersusOnAction(senderNx, act) {
  if (!act || act.g !== 'tetvs' || !act.gid) return;
  var S = _normId(senderNx); if (!NX_RE.test(S)) return;
  var gid = String(act.gid).slice(0, 48);
  var seq = (typeof act.seq === 'number' && isFinite(act.seq)) ? act.seq : -1;
  var g = games[gid];

  if (act.e === 'start') {
    if (g) return;                                   // start solo crea una partida NUEVA
    var seed = (typeof act.seed === 'number' && isFinite(act.seed)) ? (act.seed >>> 0) : null;
    if (seed === null) return;
    g = games[gid] = _mkGame(gid, S, seed, 'Y');     // yo soy el invitado; la semilla la fijó el que invita
    g.seqIn = seq;
    _notify(g, true);
    return;
  }
  if (!g) return;                                    // garbage/over de una partida que no tengo → ignoro
  if (_normId(g.opp) !== S) return;                  // solo el rival de ESA partida
  if (seq <= (g.seqIn || 0)) return;                 // dedupe / desordenado viejo
  if (g.over && act.e !== 'over') return;            // ya terminó para mí
  // Importante: el seq se COMPROMETE (g.seqIn = seq) SOLO con un evento VÁLIDO; así un evento mal formado con un seq
  // alto no «quema» el contador ni bloquea los válidos que vengan después.

  if (act.e === 'garbage') {
    var n = act.n;
    if (typeof n !== 'number' || n < 1 || n > 4) return;
    var h = act.h;
    if (!Array.isArray(h) || h.length !== n) return;
    for (var k = 0; k < n; k++) { if (typeof h[k] !== 'number' || h[k] < 0 || h[k] >= COLS) return; }
    g.seqIn = seq;
    if ((g.recv || 0) + n > MAX_GARBAGE_ROWS) return;   // techo anti-spam (seq consumido, basura ignorada)
    g.recv = (g.recv || 0) + n;
    if (!g.over && g.G) {
      _afterPlay(g, function () { addGarbage(g.G, n, h); });  // la basura puede llenarme → _afterPlay detecta el over
    }
    if (openGid === g.gid) _render(g);
    return;
  }
  if (act.e === 'over') {
    g.seqIn = seq;
    g.oppOver = true;
    if (!g.over) { g.over = true; g.winner = 'me'; _finishRecord(g); }  // el rival perdió y yo seguía vivo → gano
    if (openGid === g.gid) _render(g);
    _notify(g, false);
    return;
  }
}

function _mkGame(gid, opp, seed, me) {
  return { gid: gid, opp: _normId(opp), oppName: _contactName(opp), seed: seed, G: newGame(seed), me: me,
    over: false, winner: '', oppOver: false, recorded: false, seqOut: 0, seqIn: 0, sent: 0, recv: 0, autoOpenPending: false };
}

// ---- Avisos (igual criterio que connect4) ----
function _notify(g, isNew) {
  if (openGid === g.gid) { _render(g); return; }
  var cur = _normId(_getCurrentContactId());
  var visible = (typeof document === 'undefined' || document.visibilityState !== 'hidden');
  if (cur === _normId(g.opp) && visible && isNew) { _openOverlay(g.gid); return; }
  if (!g.over) g.autoOpenPending = true;
  var msg = isNew ? ('🧱 ' + g.oppName + t('chat_tvs_invited', ' te retó a Tetris versus'))
    : (g.over ? (t('chat_tvs_with', '🧱 Tetris versus con ') + g.oppName + ': ' + _endText(g)) : '🧱 ' + g.oppName);
  if (!visible) _fireGameNotif(g, msg);
  else { try { _showInfoToast(msg, 3200); } catch (e) {} }
}
function _fireGameNotif(g, text) {
  try {
    var pl = (typeof window !== 'undefined' && window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.NexoBLE) || null;
    if (pl && typeof pl.notifyMessage === 'function') pl.notifyMessage({ chatId: _normId(g.opp), name: g.oppName, msgId: 'game_tvs_' + g.gid, text: text, count: 1 }).catch(function () {});
  } catch (e) {}
}
function _endText(g) { return g.over ? (g.winner === 'me' ? t('chat_ttt_won', 'ganaste 🎉') : t('chat_ttt_lost', 'perdiste')) : ''; }

// ---- Overlay: MI tablero (canvas) + estado del rival. NO se pinta el tablero del rival. ----
function _openOverlay(gid) {
  var g = games[gid]; if (!g) return;
  g.autoOpenPending = false;
  _closeOverlay();
  openGid = gid;
  var ov = document.createElement('div'); ov.id = 'tvs-overlay'; ov.className = 'tetris-overlay';
  var panel = document.createElement('div'); panel.className = 'tetris-panel';
  var head = document.createElement('div'); head.className = 'tetris-head';
  var title = document.createElement('div'); title.className = 'tetris-title'; title.textContent = t('chat_tvs_title', 'Tetris versus');
  var stat = document.createElement('div'); stat.className = 'tetris-stat tvs-stat';
  head.appendChild(title); head.appendChild(stat);
  var boardWrap = document.createElement('div'); boardWrap.className = 'tetris-board-wrap';
  var canvas = document.createElement('canvas'); canvas.className = 'tetris-canvas'; boardWrap.appendChild(canvas);
  var pad = document.createElement('div'); pad.className = 'tetris-pad';
  function mkBtn(label, cls, fn) {
    var b = document.createElement('button'); b.type = 'button'; b.className = 'tetris-btn ' + cls; b.textContent = label;
    b.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); var gg = games[openGid]; if (!gg || gg.over) return; _afterPlay(gg, fn.bind(null, gg)); });
    return b;
  }
  pad.appendChild(mkBtn('◀', 'tl', function (gg) { tryMove(gg.G, -1, 0); }));
  pad.appendChild(mkBtn('⟳', 'tr', function (gg) { tryRotate(gg.G); }));
  pad.appendChild(mkBtn('▶', 'tl', function (gg) { tryMove(gg.G, 1, 0); }));
  pad.appendChild(mkBtn('⬇', 'td', function (gg) { softDrop(gg.G); }));
  pad.appendChild(mkBtn('⤓', 'thd', function (gg) { hardDrop(gg.G); }));
  var foot = document.createElement('div'); foot.className = 'tetris-foot';
  var again = document.createElement('button'); again.type = 'button'; again.className = 'tetris-again'; again.style.display = 'none'; again.textContent = t('chat_ttt_new_game', 'Nueva partida');
  again.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); var opp = g.opp; _closeOverlay(); _startFresh(opp); });
  var close = document.createElement('button'); close.type = 'button'; close.className = 'tetris-close'; close.textContent = t('chat_close', 'Cerrar');
  close.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); _closeOverlay(); });
  foot.appendChild(again); foot.appendChild(close);
  panel.appendChild(head); panel.appendChild(boardWrap); panel.appendChild(pad); panel.appendChild(foot);
  ov.appendChild(panel);
  ov.addEventListener('click', function (e) { if (e.target === ov) _closeOverlay(); });
  document.body.appendChild(ov);
  ov._key = function (e) {
    var gg = games[openGid]; if (!gg || gg.over) return;
    if (e.key === 'ArrowLeft') _afterPlay(gg, function () { tryMove(gg.G, -1, 0); });
    else if (e.key === 'ArrowRight') _afterPlay(gg, function () { tryMove(gg.G, 1, 0); });
    else if (e.key === 'ArrowUp') _afterPlay(gg, function () { tryRotate(gg.G); });
    else if (e.key === 'ArrowDown') _afterPlay(gg, function () { softDrop(gg.G); });
    else if (e.key === ' ') { e.preventDefault(); _afterPlay(gg, function () { hardDrop(gg.G); }); }
  };
  window.addEventListener('keydown', ov._key);
  _sizeCanvas(canvas);
  window.addEventListener('resize', ov._resize = function () { _sizeCanvas(canvas); _render(g); });
  _render(g);
  _startLoop();
}
function _sizeCanvas(canvas) {
  var wrap = canvas.parentNode; if (!wrap) return;
  var vw = (typeof window !== 'undefined' && window.innerWidth) || 360;
  var vh = (typeof window !== 'undefined' && window.innerHeight) || 720;
  var wrapW = wrap.clientWidth || 0;
  var availW = wrapW > 40 ? wrapW : Math.min(vw - 28, 460);
  var availH = Math.max(260, vh - 230);     // un poco más de cromo (línea de estado del rival)
  var cell = Math.max(14, Math.floor(Math.min(availW / COLS, availH / ROWS)));
  var dpr = Math.min((typeof window !== 'undefined' && window.devicePixelRatio) || 1, 2);
  canvas.width = cell * COLS * dpr; canvas.height = cell * ROWS * dpr;
  canvas.style.width = (cell * COLS) + 'px'; canvas.style.height = (cell * ROWS) + 'px';
  canvas._cell = cell; canvas._dpr = dpr;
}
function _render(g) {
  var ov = document.getElementById('tvs-overlay'); if (!ov || openGid !== g.gid) return;
  var stat = ov.querySelector('.tvs-stat');
  if (stat) {
    var rival = g.oppOver ? (t('chat_tvs_rival', 'Rival: ') + '💀') : (t('chat_tvs_rival', 'Rival: ') + '🎮');
    stat.textContent = (g.over ? _endText(g) : (t('game_tetris_lines', 'Líneas ') + g.G.lines)) + ' · ' + rival + ' · ' + t('chat_tvs_sent', 'enviada ') + (g.sent || 0) + ' / ' + t('chat_tvs_recv', 'recibida ') + (g.recv || 0);
  }
  var canvas = ov.querySelector('.tetris-canvas');
  var ctx = canvas && canvas.getContext && canvas.getContext('2d'); if (!ctx) { _renderAgain(ov, g); return; }  // jsdom: sin canvas
  var cell = canvas._cell || 14, dpr = canvas._dpr || 1; ctx.save(); ctx.scale(dpr, dpr);
  ctx.fillStyle = '#0a1020'; ctx.fillRect(0, 0, COLS * cell, ROWS * cell);
  ctx.strokeStyle = 'rgba(255,255,255,0.05)';
  var G = g.G, r, c;
  for (r = 0; r < ROWS; r++) for (c = 0; c < COLS; c++) { if (G.grid[r][c]) _cell(ctx, c, r, cell, COLORS[G.grid[r][c]] || '#6b7280'); else ctx.strokeRect(c * cell + 0.5, r * cell + 0.5, cell - 1, cell - 1); }
  if (G.piece && !G.over) { var p = G.piece; for (var pr = 0; pr < p.m.length; pr++) for (var pc = 0; pc < p.m[pr].length; pc++) if (p.m[pr][pc]) _cell(ctx, p.x + pc, p.y + pr, cell, COLORS[p.type]); }
  if (g.over) {
    ctx.fillStyle = 'rgba(0,0,0,0.72)'; ctx.fillRect(0, 0, COLS * cell, ROWS * cell);
    ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = 'bold ' + Math.floor(cell * 1.2) + 'px sans-serif';
    ctx.fillText(g.winner === 'me' ? t('chat_ttt_won', 'ganaste 🎉') : t('chat_ttt_lost', 'perdiste'), COLS * cell / 2, ROWS * cell / 2);
  }
  ctx.restore();
  _renderAgain(ov, g);
}
function _renderAgain(ov, g) { var again = ov.querySelector('.tetris-again'); if (again) again.style.display = g.over ? '' : 'none'; }
function _cell(ctx, c, r, cell, color) {
  if (r < 0) return;
  ctx.fillStyle = color; ctx.fillRect(c * cell + 1, r * cell + 1, cell - 2, cell - 2);
  ctx.fillStyle = 'rgba(255,255,255,0.22)'; ctx.fillRect(c * cell + 1, r * cell + 1, cell - 2, Math.max(2, (cell - 2) * 0.28));
}
function _closeOverlay() {
  if (loopTimer) { clearInterval(loopTimer); loopTimer = null; }
  var ov = document.getElementById('tvs-overlay');
  if (ov) { try { window.removeEventListener('keydown', ov._key); window.removeEventListener('resize', ov._resize); } catch (e) {} if (ov.parentNode) ov.parentNode.removeChild(ov); }
  openGid = null;
}

// ---- Entradas ----
function _startFresh(cid) {
  cid = _normId(cid);
  if (!NX_RE.test(cid)) { _showInfoToast(t('chat_ttt_two_people', 'Los juegos son entre dos personas (abre el chat de un contacto)'), 2500); return; }
  var gid = _newGid(), seed = _seed();
  var g = games[gid] = _mkGame(gid, cid, seed, 'R');
  _send(g, { e: 'start', seed: seed });     // invito: le mando la semilla compartida
  _openOverlay(gid);
}
export function openTetrisVersusForContact(cid) {
  cid = _normId(cid);
  if (!NX_RE.test(cid)) { _showInfoToast(t('chat_ttt_two_people', 'Los juegos son entre dos personas (abre el chat de un contacto)'), 2500); return; }
  var live = null;
  Object.keys(games).forEach(function (k) { var gg = games[k]; if (_normId(gg.opp) === cid && !gg.over) live = gg; });
  if (live) _openOverlay(live.gid); else _startFresh(cid);
}
export function tetrisVersusOverlayOpen() { return !!document.getElementById('tvs-overlay'); }
export function tetrisVersusCloseOverlay() { _closeOverlay(); }

function _autoOpenForContact(cid) {
  cid = _normId(cid);
  if (!NX_RE.test(cid) || openGid) return;
  var pend = null;
  Object.keys(games).forEach(function (k) { var g = games[k]; if (_normId(g.opp) === cid && !g.over && g.autoOpenPending) pend = g; });
  if (pend) setTimeout(function () { if (!openGid && games[pend.gid] && games[pend.gid].autoOpenPending) _openOverlay(pend.gid); }, 350);
}
try {
  if (typeof window !== 'undefined') {
    window.addEventListener('nexo:ble:openChat', function (e) { var d = (e && e.detail) || {}; _autoOpenForContact(d.contactId || (d.contact && (d.contact.nexoId || d.contact.deviceUUID || d.contact.id)) || ''); });
  }
} catch (e) {}

// ---- Ganchos de prueba (tests/sim/tetvs.js): jugar por eventos sin depender del canvas ----
try {
  if (typeof window !== 'undefined') {
    window.__nexoTvsStart = function (cid) { _startFresh(cid); return Object.keys(games).filter(function (k) { return _normId(games[k].opp) === _normId(cid); }).pop(); };
    window.__nexoTvsGidFor = function (cid) { var r = null; Object.keys(games).forEach(function (k) { if (_normId(games[k].opp) === _normId(cid)) r = k; }); return r; };
    window.__nexoTvsState = function (gid) { var g = games[gid]; return g ? { seed: g.seed, lines: g.G.lines, over: g.over, winner: g.winner, oppOver: g.oppOver, sent: g.sent, recv: g.recv, next: g.G.nextType, filled: g.G.grid.reduce(function (a, row) { return a + row.filter(function (c) { return !!c; }).length; }, 0) } : null; };
    // Simula que hice k líneas (sin depender del canvas): sube G.lines → _afterPlay manda la basura correspondiente.
    window.__nexoTvsClearLines = function (gid, k) { var g = games[gid]; if (!g) return; _afterPlay(g, function () { g.G.lines += k; }); };
    window.__nexoTvsTopOut = function (gid) { var g = games[gid]; if (!g) return; _afterPlay(g, function () { g.G.over = true; }); };
    window.__nexoTvsPendingFor = function (cid) { var r = false; Object.keys(games).forEach(function (k) { var g = games[k]; if (_normId(g.opp) === _normId(cid) && !g.over && g.autoOpenPending) r = true; }); return r; };
    window.__nexoTvsOnAction = tetrisVersusOnAction;  // inyectar un evento crudo (prueba de la validación anti-trampa)
    window.__nexoCloseTvs = function () { _closeOverlay(); };
  }
} catch (e) {}
