/**
 * NEXO — Salón de juegos (Fase A, pedido del dueño 05-11). Un pequeño selector que se abre desde el menú de adjuntar
 * del chat (🎮 Jugar) y, al elegir un juego, lo arranca con el contacto del chat actual. Cada juego vive en su módulo
 * (ttt.js, connect4.js, …) y es asíncrono/cifrado sobre el canal que ya existe. Sin servidor.
 */
import { openConnect4ForContact } from './connect4.js';
import { openTetris } from './tetris.js';
import { openTetrisVersusForContact } from './tetris_versus.js';
import { _getCurrentContactId, _contactName } from './chat_format.js';
import { _normId } from './ble_helpers.js';
import { _showInfoToast } from './ui_bits.js';
import { headToHead, leaderboard } from './game_stats.js';
import { t } from './i18n.js';

var NX_RE = /^nx[0-9a-z]{8}$/;

// Catálogo de juegos disponibles. Agregar uno es una línea más acá. (Tres en raya se escondió: era redundante con
// Conecta 4 —ambos «alinear en grilla» y C4 es más juego—, pedido del dueño 05-11. ttt.js queda por compatibilidad
// con partidas en curso y por si se quiere volver a ofrecer.)
// `solo:true` = juego de 1 jugador (no necesita contacto; el picker se abre desde un chat pero se ignora el contacto).
function _catalog() {
  return [
    { id: 'c4', emoji: '🔴', name: t('game_c4_name', 'Conecta 4'), open: openConnect4ForContact },
    { id: 'tetvs', emoji: '🧱', name: t('game_tetvs_name', 'Tetris versus'), open: openTetrisVersusForContact },
    { id: 'tetris', emoji: '🧩', name: t('game_tetris_name', 'Tetris'), open: function() { openTetris(); }, solo: true },
  ];
}

function _close() { try { var ov = document.getElementById('game-picker-overlay'); if (ov && ov.parentNode) ov.parentNode.removeChild(ov); } catch (e) {} }

export function openGamePicker(cid) {
  cid = _normId(cid);
  if (!NX_RE.test(cid)) { _showInfoToast(t('chat_ttt_two_people', 'Los juegos son entre dos personas (abre el chat de un contacto)'), 2500); return; }
  _close();
  var ov = document.createElement('div');
  ov.id = 'game-picker-overlay'; ov.className = 'ttt-overlay game-picker-overlay';
  var panel = document.createElement('div'); panel.className = 'ttt-panel game-picker-panel';
  var head = document.createElement('div'); head.className = 'ttt-head';
  var title = document.createElement('div'); title.className = 'ttt-title'; title.textContent = t('game_pick_title', '🎮 Elegí un juego'); title.style.fontWeight = '600';
  head.appendChild(title);
  var oppName = _contactName(cid);
  var list = document.createElement('div'); list.className = 'game-pick-list';
  _catalog().forEach(function(game) {
    var btn = document.createElement('button'); btn.type = 'button'; btn.className = 'game-pick-item';
    var em = document.createElement('span'); em.className = 'game-pick-emoji'; em.textContent = game.emoji;
    var nm = document.createElement('span'); nm.className = 'game-pick-name'; nm.textContent = game.name;
    btn.appendChild(em); btn.appendChild(nm);
    // #dueño 05-11: en los juegos de 2 (no solo), el cabeza a cabeza contra este contacto («Vos 5–3 Ana»).
    if (!game.solo) {
      var h = headToHead(cid, game.id);
      var sc = document.createElement('span'); sc.className = 'game-pick-score';
      sc.textContent = (h.w + h.l + h.d) ? (t('game_you', 'Tú') + ' ' + h.w + '–' + h.l + ' ' + oppName + (h.d ? (' (' + h.d + ' ' + t('game_draws', 'empates') + ')') : '')) : t('game_no_games', 'sin partidas aún');
      btn.appendChild(sc);
    }
    btn.addEventListener('click', function(e) { e.preventDefault(); e.stopPropagation(); _close(); try { game.open(cid); } catch (err) {} });
    list.appendChild(btn);
  });
  var foot = document.createElement('div'); foot.className = 'ttt-foot';
  var rank = document.createElement('button'); rank.type = 'button'; rank.className = 'ttt-again game-rank-open'; rank.textContent = t('game_ranking', '🏆 Ranking');
  rank.addEventListener('click', function(e) { e.preventDefault(); e.stopPropagation(); _close(); _openLeaderboard(); });
  var close = document.createElement('button'); close.type = 'button'; close.className = 'ttt-close'; close.textContent = t('chat_close', 'Cerrar');
  close.addEventListener('click', function(e) { e.preventDefault(); e.stopPropagation(); _close(); });
  foot.appendChild(rank); foot.appendChild(close);
  panel.appendChild(head); panel.appendChild(list); panel.appendChild(foot);
  ov.appendChild(panel);
  ov.addEventListener('click', function(e) { if (e.target === ov) _close(); });
  document.body.appendChild(ov);
}

// #dueño 05-11: ranking «lista de contactos con las puntuaciones para fomentar la competencia». Hoja con todos los
// contactos ordenados por victorias−derrotas (G=ganadas, P=perdidas, E=empates), sumando todos los juegos.
function _closeRank() { try { var ov = document.getElementById('game-rank-overlay'); if (ov && ov.parentNode) ov.parentNode.removeChild(ov); } catch (e) {} }
function _openLeaderboard() {
  _closeRank();
  var rows = leaderboard();
  var ov = document.createElement('div'); ov.id = 'game-rank-overlay'; ov.className = 'ttt-overlay game-rank-overlay';
  var panel = document.createElement('div'); panel.className = 'ttt-panel game-rank-panel';
  var head = document.createElement('div'); head.className = 'ttt-head';
  var title = document.createElement('div'); title.className = 'ttt-title'; title.textContent = t('game_ranking_title', '🏆 Ranking'); title.style.fontWeight = '600';
  head.appendChild(title);
  var listEl = document.createElement('div'); listEl.className = 'game-rank-list';
  if (!rows.length) {
    var empty = document.createElement('div'); empty.className = 'game-rank-empty'; empty.textContent = t('game_rank_empty', 'Aún no jugaste ninguna partida. ¡Retá a un contacto!');
    listEl.appendChild(empty);
  } else {
    rows.forEach(function(r, i) {
      var row = document.createElement('div'); row.className = 'game-rank-row';
      var pos = document.createElement('span'); pos.className = 'game-rank-pos'; pos.textContent = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : (i + 1) + '.';
      var nm = document.createElement('span'); nm.className = 'game-rank-name'; nm.textContent = r.name;
      var sc = document.createElement('span'); sc.className = 'game-rank-score'; sc.textContent = r.w + 'G · ' + r.l + 'P' + (r.d ? (' · ' + r.d + 'E') : '');
      row.appendChild(pos); row.appendChild(nm); row.appendChild(sc);
      listEl.appendChild(row);
    });
  }
  var foot = document.createElement('div'); foot.className = 'ttt-foot';
  var close = document.createElement('button'); close.type = 'button'; close.className = 'ttt-close'; close.textContent = t('chat_close', 'Cerrar');
  close.addEventListener('click', function(e) { e.preventDefault(); e.stopPropagation(); _closeRank(); });
  foot.appendChild(close);
  panel.appendChild(head); panel.appendChild(listEl); panel.appendChild(foot);
  ov.appendChild(panel);
  ov.addEventListener('click', function(e) { if (e.target === ov) _closeRank(); });
  document.body.appendChild(ov);
}
export function openLeaderboard() { _openLeaderboard(); }

// Para el botón atrás de Android (chat_nav.js).
export function gamePickerOpen() { return !!document.getElementById('game-picker-overlay') || !!document.getElementById('game-rank-overlay'); }
export function gamePickerClose() { _close(); _closeRank(); }

try { if (typeof window !== 'undefined') {
  window.__nexoCloseGamePicker = function() { _close(); _closeRank(); };
  window.__nexoOpenGamePicker = function(cid) { openGamePicker(cid || _getCurrentContactId()); };
  window.__nexoOpenLeaderboard = function() { _openLeaderboard(); };
} } catch (e) {}
