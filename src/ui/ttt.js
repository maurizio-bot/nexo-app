/**
 * NEXO — Tres en raya (ronda 2830, pedido del dueño: «un entretenimiento para pegar un user a la pantalla»).
 *
 * Juego de 2 jugadores DENTRO del chat, entre dos contactos, sobre el canal que ya existe (Bluetooth/Wi-Fi/Jump/
 * internet) y CIFRADO como cualquier mensaje. Es asíncrono por naturaleza: una jugada es una acción oculta del chat
 * ({type:'nexo_act', act:'game', g:'ttt', ...}) que se entrega como un mensaje normal (si el otro está desconectado,
 * llega cuando vuelve), así que encaja con lo P2P/offline-first de NEXO. No hay servidor ni terceros.
 *
 * ROBUSTEZ (clave): cada jugada lleva el TABLERO COMPLETO, así el estado es autocontenido e idempotente. Al recibir se
 * VALIDA SIEMPRE (nunca se confía en el otro): el tablero entrante debe ser el mío con EXACTAMENTE una marca nueva, del
 * símbolo del que la manda, en una casilla vacía, y debe tocarle a él; si no, se ignora (jugada ilegal / desorden). El
 * que invita juega X y empieza. El ganador/empate se calcula localmente. gid acota el tamaño; no se dibuja nada del
 * otro como HTML (solo X/O y nombres por textContent).
 */
import { _normId } from './ble_helpers.js';
import { _sendTextTo } from './send.js';
import { _contactName, _getCurrentContactId } from './chat_format.js';
import { _showInfoToast } from './ui_bits.js';
import { t } from './i18n.js';

var NX_RE = /^nx[0-9a-z]{8}$/;
var LINES = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];
var games = {};          // gid → { gid, board[9], me:'X'|'O', opp, oppName, over, winner }
var openGid = null;      // gid del overlay abierto (o null)

function _emptyBoard() { return ['', '', '', '', '', '', '', '', '']; }
function _count(b) { var n = 0; for (var i = 0; i < 9; i++) if (b[i]) n++; return n; }
function _turn(b) { return (_count(b) % 2 === 0) ? 'X' : 'O'; } // X empieza
function _winner(b) {
  for (var i = 0; i < LINES.length; i++) { var L = LINES[i]; if (b[L[0]] && b[L[0]] === b[L[1]] && b[L[1]] === b[L[2]]) return b[L[0]]; }
  return '';
}
// Parsea el tablero entrante de forma estricta: array de 9, cada casilla '' | 'X' | 'O'. Null si está mal.
function _parseBoard(raw) {
  if (!Array.isArray(raw) || raw.length !== 9) return null;
  var b = [];
  for (var i = 0; i < 9; i++) { var c = raw[i]; if (c !== '' && c !== 'X' && c !== 'O') return null; b.push(c); }
  return b;
}
function _same(a, b) { for (var i = 0; i < 9; i++) if (a[i] !== b[i]) return false; return true; }
function _finish(g) { var w = _winner(g.board); if (w) { g.over = true; g.winner = w; } else if (_count(g.board) === 9) { g.over = true; g.winner = ''; } }

function _newGid() { return 'g' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }

// ----- Envío (yo juego el símbolo g.me) -----
function _sendMove(g) {
  try { _sendTextTo(g.opp, JSON.stringify({ type: 'nexo_act', act: 'game', g: 'ttt', gid: g.gid, b: g.board }), '', true); } catch (e) {}
}
function _play(g, cell) {
  if (!g || g.over || cell < 0 || cell > 8 || g.board[cell] !== '' || _turn(g.board) !== g.me) return false;
  g.board = g.board.slice(); g.board[cell] = g.me;
  _finish(g);
  _sendMove(g);
  if (openGid === g.gid) _renderOverlay(g);
  return true;
}

// Recibido: una jugada (o invitación = primera jugada) del contacto.
export function tttOnAction(senderNx, act) {
  if (!act || act.g !== 'ttt' || !act.gid) return;
  var S = _normId(senderNx);
  if (!NX_RE.test(S)) return;
  var gid = String(act.gid).slice(0, 48);
  var b = _parseBoard(act.b);
  if (!b) return;                       // tablero mal formado → ignorar
  var g = games[gid];
  var marks = _count(b);
  if (!g) {
    // Partida nueva: solo vale la PRIMERA jugada del que invita (1 marca, y es X). Yo quedo como O.
    if (marks !== 1 || b.indexOf('X') < 0) return;
    g = games[gid] = { gid: gid, board: b, me: 'O', opp: S, oppName: _contactName(S), over: false, winner: '' };
    _finish(g);
    _notify(g, true);
    return;
  }
  if (_normId(g.opp) !== S || g.over) return;          // solo el rival de ESA partida; si ya terminó, nada
  if (_same(b, g.board)) return;                        // duplicado (relé) → ignorar en silencio
  var oppSym = g.me === 'X' ? 'O' : 'X';
  // Debe ser EXACTAMENTE una marca nueva del rival, en casilla vacía, y tocarle a él.
  var diff = -1, n = 0;
  for (var i = 0; i < 9; i++) { if (b[i] !== g.board[i]) { n++; diff = i; } }
  if (n !== 1 || g.board[diff] !== '' || b[diff] !== oppSym || _turn(g.board) !== oppSym) return; // ilegal → ignorar
  g.board = b;
  _finish(g);
  _notify(g, false);
}

function _notify(g, isNew) {
  if (openGid === g.gid) { _renderOverlay(g); return; }
  // Si el chat con el rival está abierto, abro el overlay directo; si no, aviso tocable.
  var cur = _normId(_getCurrentContactId());
  if (cur === _normId(g.opp)) { _openOverlay(g.gid); return; }
  var msg = isNew ? ('🎮 ' + g.oppName + t('chat_ttt_invited', ' te invitó a Tres en raya')) : (g.over ? (t('chat_ttt_with', '🎮 Tres en raya con ') + g.oppName + ': ' + _endText(g)) : ('🎮 ' + g.oppName + t('chat_ttt_your_turn_toast', ': te toca en Tres en raya')));
  try { _showInfoToast(msg, 3500); } catch (e) {}
}

function _endText(g) { return g.winner === '' ? t('chat_ttt_draw', 'empate') : (g.winner === g.me ? t('chat_ttt_won', 'ganaste 🎉') : t('chat_ttt_lost', 'perdiste')); }

// ----- Overlay -----
function _openOverlay(gid) {
  var g = games[gid]; if (!g) return;
  _closeOverlay();
  openGid = gid;
  var ov = document.createElement('div');
  ov.id = 'ttt-overlay'; ov.className = 'ttt-overlay';
  var panel = document.createElement('div'); panel.className = 'ttt-panel';
  var head = document.createElement('div'); head.className = 'ttt-head';
  var title = document.createElement('div'); title.className = 'ttt-title'; title.textContent = t('chat_ttt_title', 'Tres en raya'); title.style.fontWeight = '600';
  var sub = document.createElement('div'); sub.className = 'ttt-sub ttt-status';
  var vs = document.createElement('div'); vs.className = 'ttt-vs'; vs.textContent = t('chat_ttt_you_paren', 'Tú (') + g.me + t('chat_ttt_vs', ') vs ') + g.oppName + ' (' + (g.me === 'X' ? 'O' : 'X') + ')';
  head.appendChild(title); head.appendChild(vs); head.appendChild(sub);
  var grid = document.createElement('div'); grid.className = 'ttt-grid';
  for (var i = 0; i < 9; i++) {
    var cell = document.createElement('button'); cell.type = 'button'; cell.className = 'ttt-cell'; cell.setAttribute('data-i', String(i));
    cell.addEventListener('click', (function(idx) { return function(e) { e.preventDefault(); e.stopPropagation(); if (_play(g, idx)) { /* pintado dentro de _play */ } }; })(i));
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
  var ov = document.getElementById('ttt-overlay'); if (!ov || openGid !== g.gid) return;
  var cells = ov.querySelectorAll('.ttt-cell');
  var myTurn = !g.over && _turn(g.board) === g.me;
  for (var i = 0; i < cells.length; i++) {
    var v = g.board[i];
    cells[i].textContent = v;                 // solo 'X'/'O'/'' por textContent (nunca HTML del otro)
    cells[i].className = 'ttt-cell' + (v ? ' ttt-' + v.toLowerCase() : '');
    cells[i].disabled = !!v || !myTurn;
  }
  var st = ov.querySelector('.ttt-status');
  if (st) st.textContent = g.over ? (t('chat_ttt_end', 'Fin — ') + _endText(g)) : (myTurn ? t('chat_ttt_your_turn', 'Tu turno') : t('chat_ttt_turn_of', 'Turno de ') + g.oppName);
  var again = ov.querySelector('.ttt-again');
  if (again) again.style.display = g.over ? '' : 'none';
}
function _closeOverlay() { try { var ov = document.getElementById('ttt-overlay'); if (ov && ov.parentNode) ov.parentNode.removeChild(ov); } catch (e) {} openGid = null; }

// Empezar SIEMPRE una partida nueva con un contacto (yo = X). Usado por el menú y por «Nueva partida».
function _startFresh(cid) {
  cid = _normId(cid);
  if (!NX_RE.test(cid)) { _showInfoToast(t('chat_ttt_two_people', 'Los juegos son entre dos personas (abre el chat de un contacto)'), 2500); return; }
  var gid = _newGid();
  games[gid] = { gid: gid, board: _emptyBoard(), me: 'X', opp: cid, oppName: _contactName(cid), over: false, winner: '' };
  _openOverlay(gid);
}

// Punto de entrada del menú: retoma la partida viva con el contacto, o empieza una nueva.
export function openTttForContact(cid) {
  cid = _normId(cid);
  if (!NX_RE.test(cid)) { _showInfoToast(t('chat_ttt_two_people', 'Los juegos son entre dos personas (abre el chat de un contacto)'), 2500); return; }
  var live = null;
  Object.keys(games).forEach(function(k) { var gg = games[k]; if (_normId(gg.opp) === cid && !gg.over) live = gg; });
  if (live) _openOverlay(live.gid); else _startFresh(cid);
}

// Cierre por el botón atrás de Android (window.__nexoHandleBack lo consulta vía este flag).
export function tttOverlayOpen() { return !!document.getElementById('ttt-overlay'); }
export function tttCloseOverlay() { _closeOverlay(); }

// Ganchos de prueba (tests/sim/ttt.js): mover y leer estado sin depender del DOM del overlay.
try {
  if (typeof window !== 'undefined') {
    window.__nexoTttStart = function(cid) { _startFresh(cid); return Object.keys(games).filter(function(k) { return _normId(games[k].opp) === _normId(cid); }).pop(); };
    window.__nexoTttMove = function(gid, cell) { return _play(games[gid], cell); };
    window.__nexoTttState = function(gid) { var g = games[gid]; return g ? { board: g.board.slice(), me: g.me, over: g.over, winner: g.winner, turn: _turn(g.board) } : null; };
    window.__nexoTttGidFor = function(cid) { var r = null; Object.keys(games).forEach(function(k) { if (_normId(games[k].opp) === _normId(cid)) r = k; }); return r; };
    window.__nexoCloseTtt = function() { _closeOverlay(); }; // lo usa el botón atrás de Android (chat_nav.js)
  }
} catch (e) {}
