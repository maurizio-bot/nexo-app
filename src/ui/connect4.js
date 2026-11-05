/**
 * NEXO — Conecta 4 (Fase A del modo entretenimiento, pedido del dueño 05-11: «arranca ya»).
 *
 * Mismo molde que el tres en raya (ttt.js) y por eso igual de robusto: juego de 2 jugadores DENTRO del chat, sobre el
 * canal que ya existe (Bluetooth/Wi-Fi/Jump/internet) y CIFRADO como cualquier mensaje. Asíncrono por naturaleza: una
 * jugada es una acción oculta ({type:'nexo_act', act:'game', g:'c4', gid, b}) que se entrega como un mensaje normal (si
 * el otro está desconectado, llega cuando vuelve). No hay servidor ni terceros.
 *
 * ROBUSTEZ (clave, idéntico criterio que ttt): cada jugada lleva el TABLERO COMPLETO (42 casillas = 7 col × 6 fil), así
 * el estado es autocontenido e idempotente. Al recibir se VALIDA SIEMPRE (nunca se confía en el otro): el tablero
 * entrante debe ser el mío con EXACTAMENTE una ficha nueva, del color del que la manda, en una casilla vacía que respete
 * la GRAVEDAD (fila de abajo o con ficha justo debajo), y debe tocarle a él; si no, se ignora. El que invita juega rojo
 * (R) y empieza. Ganar = 4 en línea (horizontal, vertical o diagonal). No se dibuja nada del otro como HTML.
 */
import { _normId } from './ble_helpers.js';
import { _sendTextTo } from './send.js';
import { _contactName, _getCurrentContactId } from './chat_format.js';
import { _showInfoToast } from './ui_bits.js';
import { t } from './i18n.js';

var NX_RE = /^nx[0-9a-z]{8}$/;
var COLS = 7, ROWS = 6, N = COLS * ROWS; // 42
var games = {};          // gid → { gid, board[42], me:'R'|'Y', opp, oppName, over, winner }
var openGid = null;      // gid del overlay abierto (o null)

function _emptyBoard() { var b = []; for (var i = 0; i < N; i++) b.push(''); return b; }
function _count(b) { var n = 0; for (var i = 0; i < N; i++) if (b[i]) n++; return n; }
function _turn(b) { return (_count(b) % 2 === 0) ? 'R' : 'Y'; } // R (el que invita) empieza
// Fila/col desde índice (fila 0 = arriba). idx = r*COLS + c.
function _rc(i) { return { r: Math.floor(i / COLS), c: i % COLS }; }
// Casilla más baja vacía de una columna (gravedad). -1 si la columna está llena.
function _lowestEmpty(b, c) { for (var r = ROWS - 1; r >= 0; r--) { var i = r * COLS + c; if (b[i] === '') return i; } return -1; }

// 4 en línea. Recorre cada casilla y mira derecha, abajo, y las dos diagonales.
function _winner(b) {
  var dirs = [[0, 1], [1, 0], [1, 1], [1, -1]]; // [dFila, dCol]
  for (var r = 0; r < ROWS; r++) {
    for (var c = 0; c < COLS; c++) {
      var s = b[r * COLS + c]; if (!s) continue;
      for (var d = 0; d < dirs.length; d++) {
        var dr = dirs[d][0], dc = dirs[d][1], k = 1;
        while (k < 4) {
          var rr = r + dr * k, cc = c + dc * k;
          if (rr < 0 || rr >= ROWS || cc < 0 || cc >= COLS || b[rr * COLS + cc] !== s) break;
          k++;
        }
        if (k === 4) return s;
      }
    }
  }
  return '';
}
// Parseo estricto del tablero entrante: array de N, cada casilla '' | 'R' | 'Y'. Null si está mal.
function _parseBoard(raw) {
  if (!Array.isArray(raw) || raw.length !== N) return null;
  var b = [];
  for (var i = 0; i < N; i++) { var c = raw[i]; if (c !== '' && c !== 'R' && c !== 'Y') return null; b.push(c); }
  return b;
}
function _same(a, b) { for (var i = 0; i < N; i++) if (a[i] !== b[i]) return false; return true; }
function _finish(g) { var w = _winner(g.board); if (w) { g.over = true; g.winner = w; } else if (_count(g.board) === N) { g.over = true; g.winner = ''; } }
function _newGid() { return 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }

// ----- Envío (yo juego el color g.me) -----
function _sendMove(g) {
  try { _sendTextTo(g.opp, JSON.stringify({ type: 'nexo_act', act: 'game', g: 'c4', gid: g.gid, b: g.board }), '', true); } catch (e) {}
}
function _drop(g, col) {
  if (!g || g.over || col < 0 || col >= COLS || _turn(g.board) !== g.me) return false;
  var i = _lowestEmpty(g.board, col); if (i < 0) return false; // columna llena
  g.board = g.board.slice(); g.board[i] = g.me;
  _finish(g);
  _sendMove(g);
  if (openGid === g.gid) _renderOverlay(g);
  return true;
}

// Recibido: una jugada (o invitación = primera jugada) del contacto.
export function connect4OnAction(senderNx, act) {
  if (!act || act.g !== 'c4' || !act.gid) return;
  var S = _normId(senderNx);
  if (!NX_RE.test(S)) return;
  var gid = String(act.gid).slice(0, 48);
  var b = _parseBoard(act.b);
  if (!b) return;                       // tablero mal formado → ignorar
  var g = games[gid];
  var marks = _count(b);
  if (!g) {
    // Partida nueva: solo vale la PRIMERA jugada del que invita (1 ficha roja, en una casilla de abajo de su columna).
    if (marks !== 1 || b.indexOf('R') < 0) return;
    var i0 = b.indexOf('R'); var rc0 = _rc(i0);
    if (rc0.r !== ROWS - 1) return; // la primera ficha tiene que estar en la fila de abajo (gravedad)
    g = games[gid] = { gid: gid, board: b, me: 'Y', opp: S, oppName: _contactName(S), over: false, winner: '' };
    _finish(g);
    _notify(g, true);
    return;
  }
  if (_normId(g.opp) !== S || g.over) return;          // solo el rival de ESA partida; si ya terminó, nada
  if (_same(b, g.board)) return;                        // duplicado (relé) → ignorar en silencio
  var oppSym = g.me === 'R' ? 'Y' : 'R';
  // Debe ser EXACTAMENTE una ficha nueva del rival, en casilla vacía, con gravedad respetada, y tocarle a él.
  var diff = -1, n = 0;
  for (var i = 0; i < N; i++) { if (b[i] !== g.board[i]) { n++; diff = i; } }
  if (n !== 1 || g.board[diff] !== '' || b[diff] !== oppSym || _turn(g.board) !== oppSym) return; // ilegal → ignorar
  var rc = _rc(diff);
  if (rc.r !== ROWS - 1 && g.board[diff + COLS] === '') return; // flotaría (sin ficha debajo) → ilegal
  g.board = b;
  _finish(g);
  _notify(g, false);
}

function _notify(g, isNew) {
  if (openGid === g.gid) { _renderOverlay(g); return; }
  var cur = _normId(_getCurrentContactId());
  if (cur === _normId(g.opp)) { _openOverlay(g.gid); return; }
  var msg = isNew ? ('🔴 ' + g.oppName + t('chat_c4_invited', ' te invitó a Conecta 4'))
    : (g.over ? (t('chat_c4_with', '🔴 Conecta 4 con ') + g.oppName + ': ' + _endText(g))
      : ('🔴 ' + g.oppName + t('chat_c4_your_turn_toast', ': te toca en Conecta 4')));
  try { _showInfoToast(msg, 3500); } catch (e) {}
}
function _endText(g) { return g.winner === '' ? t('chat_ttt_draw', 'empate') : (g.winner === g.me ? t('chat_ttt_won', 'ganaste 🎉') : t('chat_ttt_lost', 'perdiste')); }

// ----- Overlay -----
function _openOverlay(gid) {
  var g = games[gid]; if (!g) return;
  _closeOverlay();
  openGid = gid;
  var ov = document.createElement('div');
  ov.id = 'c4-overlay'; ov.className = 'ttt-overlay c4-overlay';
  var panel = document.createElement('div'); panel.className = 'ttt-panel c4-panel';
  var head = document.createElement('div'); head.className = 'ttt-head';
  var title = document.createElement('div'); title.className = 'ttt-title'; title.textContent = t('chat_c4_title', 'Conecta 4'); title.style.fontWeight = '600';
  var vs = document.createElement('div'); vs.className = 'ttt-vs';
  vs.textContent = t('chat_c4_you_paren', 'Tú (') + (g.me === 'R' ? '🔴' : '🟡') + t('chat_ttt_vs', ') vs ') + g.oppName + ' (' + (g.me === 'R' ? '🟡' : '🔴') + ')';
  var sub = document.createElement('div'); sub.className = 'ttt-sub ttt-status';
  head.appendChild(title); head.appendChild(vs); head.appendChild(sub);
  var grid = document.createElement('div'); grid.className = 'c4-grid';
  for (var i = 0; i < N; i++) {
    var cell = document.createElement('button'); cell.type = 'button'; cell.className = 'c4-cell'; cell.setAttribute('data-i', String(i));
    cell.addEventListener('click', (function(idx) { return function(e) { e.preventDefault(); e.stopPropagation(); _drop(g, idx % COLS); }; })(i));
    grid.appendChild(cell);
  }
  var foot = document.createElement('div'); foot.className = 'ttt-foot';
  var again = document.createElement('button'); again.type = 'button'; again.className = 'ttt-again'; again.textContent = t('chat_ttt_new_game', 'Nueva partida');
  again.addEventListener('click', function(e) { e.preventDefault(); e.stopPropagation(); var opp = g.opp; _closeOverlay(); _startFresh(opp); });
  var close = document.createElement('button'); close.type = 'button'; close.className = 'ttt-close'; close.textContent = t('chat_close', 'Cerrar');
  close.addEventListener('click', function(e) { e.preventDefault(); e.stopPropagation(); _closeOverlay(); });
  foot.appendChild(again); foot.appendChild(close);
  panel.appendChild(head); panel.appendChild(grid); panel.appendChild(foot);
  ov.appendChild(panel);
  ov.addEventListener('click', function(e) { if (e.target === ov) _closeOverlay(); });
  document.body.appendChild(ov);
  _renderOverlay(g);
}
function _renderOverlay(g) {
  var ov = document.getElementById('c4-overlay'); if (!ov || openGid !== g.gid) return;
  var cells = ov.querySelectorAll('.c4-cell');
  var myTurn = !g.over && _turn(g.board) === g.me;
  for (var i = 0; i < cells.length; i++) {
    var v = g.board[i];
    cells[i].className = 'c4-cell' + (v ? ' c4-' + v.toLowerCase() : '');
    // Habilitada solo si: me toca, el juego sigue, y la columna NO está llena.
    var col = i % COLS;
    cells[i].disabled = !myTurn || _lowestEmpty(g.board, col) < 0;
  }
  var st = ov.querySelector('.ttt-status');
  if (st) st.textContent = g.over ? (t('chat_ttt_end', 'Fin — ') + _endText(g)) : (myTurn ? t('chat_ttt_your_turn', 'Tu turno') : t('chat_ttt_turn_of', 'Turno de ') + g.oppName);
  var again = ov.querySelector('.ttt-again');
  if (again) again.style.display = g.over ? '' : 'none';
}
function _closeOverlay() { try { var ov = document.getElementById('c4-overlay'); if (ov && ov.parentNode) ov.parentNode.removeChild(ov); } catch (e) {} openGid = null; }

// Empezar SIEMPRE una partida nueva con un contacto (yo = R, empiezo). Usado por el menú y por «Nueva partida».
function _startFresh(cid) {
  cid = _normId(cid);
  if (!NX_RE.test(cid)) { _showInfoToast(t('chat_ttt_two_people', 'Los juegos son entre dos personas (abre el chat de un contacto)'), 2500); return; }
  var gid = _newGid();
  games[gid] = { gid: gid, board: _emptyBoard(), me: 'R', opp: cid, oppName: _contactName(cid), over: false, winner: '' };
  _openOverlay(gid);
}

// Punto de entrada del menú: retoma la partida viva con el contacto, o empieza una nueva.
export function openConnect4ForContact(cid) {
  cid = _normId(cid);
  if (!NX_RE.test(cid)) { _showInfoToast(t('chat_ttt_two_people', 'Los juegos son entre dos personas (abre el chat de un contacto)'), 2500); return; }
  var live = null;
  Object.keys(games).forEach(function(k) { var gg = games[k]; if (_normId(gg.opp) === cid && !gg.over) live = gg; });
  if (live) _openOverlay(live.gid); else _startFresh(cid);
}

// Cierre por el botón atrás de Android (chat_nav.js lo consulta).
export function connect4OverlayOpen() { return !!document.getElementById('c4-overlay'); }
export function connect4CloseOverlay() { _closeOverlay(); }

// Ganchos de prueba (tests/sim/connect4.js): jugar y leer estado sin depender del DOM.
try {
  if (typeof window !== 'undefined') {
    window.__nexoC4Start = function(cid) { _startFresh(cid); return Object.keys(games).filter(function(k) { return _normId(games[k].opp) === _normId(cid); }).pop(); };
    window.__nexoC4Drop = function(gid, col) { return _drop(games[gid], col); };
    window.__nexoC4State = function(gid) { var g = games[gid]; return g ? { board: g.board.slice(), me: g.me, over: g.over, winner: g.winner, turn: _turn(g.board) } : null; };
    window.__nexoC4GidFor = function(cid) { var r = null; Object.keys(games).forEach(function(k) { if (_normId(games[k].opp) === _normId(cid)) r = k; }); return r; };
    window.__nexoCloseC4 = function() { _closeOverlay(); };
  }
} catch (e) {}
