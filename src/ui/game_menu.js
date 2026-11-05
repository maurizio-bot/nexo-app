/**
 * NEXO — Salón de juegos (Fase A, pedido del dueño 05-11). Un pequeño selector que se abre desde el menú de adjuntar
 * del chat (🎮 Jugar) y, al elegir un juego, lo arranca con el contacto del chat actual. Cada juego vive en su módulo
 * (ttt.js, connect4.js, …) y es asíncrono/cifrado sobre el canal que ya existe. Sin servidor.
 */
import { openTttForContact } from './ttt.js';
import { openConnect4ForContact } from './connect4.js';
import { _getCurrentContactId } from './chat_format.js';
import { _normId } from './ble_helpers.js';
import { _showInfoToast } from './ui_bits.js';
import { t } from './i18n.js';

var NX_RE = /^nx[0-9a-z]{8}$/;

// Catálogo de juegos disponibles (por turnos; todos reusan el canal del chat). Agregar uno es una línea más acá.
function _catalog() {
  return [
    { id: 'ttt', emoji: '⭕', name: t('game_ttt_name', 'Tres en raya'), open: openTttForContact },
    { id: 'c4', emoji: '🔴', name: t('game_c4_name', 'Conecta 4'), open: openConnect4ForContact },
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
  var list = document.createElement('div'); list.className = 'game-pick-list';
  _catalog().forEach(function(game) {
    var btn = document.createElement('button'); btn.type = 'button'; btn.className = 'game-pick-item';
    var em = document.createElement('span'); em.className = 'game-pick-emoji'; em.textContent = game.emoji;
    var nm = document.createElement('span'); nm.className = 'game-pick-name'; nm.textContent = game.name;
    btn.appendChild(em); btn.appendChild(nm);
    btn.addEventListener('click', function(e) { e.preventDefault(); e.stopPropagation(); _close(); try { game.open(cid); } catch (err) {} });
    list.appendChild(btn);
  });
  var foot = document.createElement('div'); foot.className = 'ttt-foot';
  var close = document.createElement('button'); close.type = 'button'; close.className = 'ttt-close'; close.textContent = t('chat_close', 'Cerrar');
  close.addEventListener('click', function(e) { e.preventDefault(); e.stopPropagation(); _close(); });
  foot.appendChild(close);
  panel.appendChild(head); panel.appendChild(list); panel.appendChild(foot);
  ov.appendChild(panel);
  ov.addEventListener('click', function(e) { if (e.target === ov) _close(); });
  document.body.appendChild(ov);
}

// Para el botón atrás de Android (chat_nav.js).
export function gamePickerOpen() { return !!document.getElementById('game-picker-overlay'); }
export function gamePickerClose() { _close(); }

try { if (typeof window !== 'undefined') { window.__nexoCloseGamePicker = function() { _close(); }; window.__nexoOpenGamePicker = function(cid) { openGamePicker(cid || _getCurrentContactId()); }; } } catch (e) {}
