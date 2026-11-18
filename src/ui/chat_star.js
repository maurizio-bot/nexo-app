/**
 * 3219 (dueño 17-11, funciones de WhatsApp dentro del chat): mensajes DESTACADOS. Mantener pulsado un mensaje → «Destacar» / «Quitar
 * destacado» (menú de chat_actions). Una estrellita pequeña junto a la hora de la burbuja (render.js). «Mensajes destacados» (tocar el
 * círculo del contacto en la cabecera del chat, chat_menu.js): la lista de los de este chat; al tocar uno, salta a él en el chat (aunque
 * esté más arriba de lo dibujado: se cargan las páginas anteriores). Es SOLO de este teléfono: se guarda en el propio mensaje del vault
 * (campo starred, cifrado como el resto) y no viaja al otro.
 */
import { t, getLang } from './i18n.js';
import { _contactName, _findMessage, _getCurrentContactId, _msgSummary, _myNexoId, _normId } from './chat_format.js';
import { vaultLoadMessages, vaultPatchMessage } from '../vault/vault_manager.js';
import { _showInfoToast } from './ui_bits.js';
import { _loadOlderMessages, _olderMessages } from './render.js';
import { SHEET_CLOSE_SVG } from './share_contacts.js';

var STAR_PATH = '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>';

// ¿Se puede destacar? (no un mensaje eliminado ni una acción oculta)
export function canStar(msg) { return !!msg && !msg.deleted && !msg.hidden; }

// La estrellita de la burbuja (junto a la hora)
export function starMark() {
  var s = document.createElement('span');
  s.className = 'msg-star';
  s.setAttribute('aria-label', t('star_mark', 'Destacado'));
  s.innerHTML = '<svg viewBox="0 0 24 24" width="11" height="11" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linejoin="round">' + STAR_PATH + '</svg>'; // SVG fijo
  return s;
}

function _paintMark(id, on) {
  var el = document.querySelector('.message[data-msg-id="' + id + '"]');
  var meta = el && el.querySelector('.msg-meta');
  if (!meta) return;
  var cur = meta.querySelector('.msg-star');
  if (on && !cur) { var tm = meta.querySelector('.msg-time'); meta.insertBefore(starMark(), tm || meta.firstChild); }
  else if (!on && cur) cur.remove();
}

export function toggleStar(cid, msg) {
  var id = msg && (msg.msgId || msg.messageId);
  cid = _normId(cid);
  if (!cid || !id) return Promise.resolve(false);
  return _findMessage(cid, id).then(function(m) {
    if (!canStar(m)) return false;
    var on = !m.starred;
    return vaultPatchMessage(cid, id, { starred: on }).then(function(ok) {
      if (!ok) return false;
      _paintMark(id, on);
      console.log('[STAR] ' + id + (on ? ' destacado' : ' ya no está destacado'));
      return on;
    });
  }).catch(function() { return false; });
}

// Los destacados de un chat, del más nuevo al más viejo
export function starredOf(cid) {
  return vaultLoadMessages(_normId(cid)).then(function(list) {
    return (list || []).filter(function(m) { return m && m.starred && !m.deleted && !m.hidden; })
      .sort(function(a, b) { return (b.timestamp || 0) - (a.timestamp || 0); });
  }).catch(function() { return []; });
}

// Saltar a un mensaje del chat abierto: si no está dibujado (más arriba de la última página), se cargan las anteriores hasta dar con él
export async function jumpToMessage(id) {
  var sel = '.message[data-msg-id="' + id + '"]';
  var cid = _getCurrentContactId();
  for (var i = 0; i < 60 && !document.querySelector(sel); i++) {
    if (!_olderMessages || !_olderMessages.length || _getCurrentContactId() !== cid) break;
    await _loadOlderMessages();
  }
  var el = document.querySelector(sel);
  if (!el) { _showInfoToast(t('msg_gone', 'Ese mensaje ya no está en el chat'), 2500); return false; }
  try { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e) {}
  el.classList.add('msg-highlight');
  el.style.transition = 'background 0.4s';
  el.style.background = 'rgba(0,200,255,0.25)';
  if (el._nxHl) clearTimeout(el._nxHl); // tocar otra vez la franja enseguida: el resaltado dura desde el último toque
  el._nxHl = setTimeout(function() { el._nxHl = null; el.style.background = ''; el.classList.remove('msg-highlight'); }, 1400);
  return true;
}

function _when(ts) {
  var d = new Date(ts || Date.now()), lang = getLang();
  try { return d.toLocaleString(lang === 'pt' ? 'pt-BR' : lang, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }); } catch (e) { return d.toLocaleString(); }
}

// «Mensajes destacados» del chat abierto: pantalla como «Reenviar a…» (cabecera con el título y la ✕ redonda)
export function openStarredSheet(cid) {
  cid = _normId(cid || _getCurrentContactId());
  if (!cid) return Promise.resolve(null);
  var old = document.getElementById('nexo-starred-sheet');
  if (old) old.remove();
  var box = document.createElement('div');
  box.id = 'nexo-starred-sheet';
  var head = document.createElement('div');
  head.className = 'nx-page-head nx-sheet-head';
  var title = document.createElement('div');
  title.className = 'nx-page-title';
  title.textContent = t('star_title', 'Mensajes destacados');
  var x = document.createElement('button');
  x.id = 'nexo-starred-close';
  x.className = 'nx-round-btn';
  x.setAttribute('aria-label', t('chat_cancel', 'Cancelar'));
  x.innerHTML = SHEET_CLOSE_SVG;
  x.onclick = function() { box.remove(); };
  head.appendChild(title); head.appendChild(x);
  var list = document.createElement('div');
  list.className = 'nx-starred-list';
  box.appendChild(head); box.appendChild(list);
  document.body.appendChild(box);
  var gs = window.bleInterface && window.bleInterface.groups, me = _myNexoId();
  return starredOf(cid).then(function(msgs) {
    if (!msgs.length) {
      var e = document.createElement('div');
      e.className = 'nx-starred-empty';
      e.textContent = t('star_empty', 'Aún no hay mensajes destacados. Mantén pulsado un mensaje y toca «Destacar».');
      list.appendChild(e);
      return box;
    }
    msgs.forEach(function(m) {
      var row = document.createElement('button');
      row.type = 'button';
      row.className = 'mm-item nx-starred-row';
      row.dataset.msgId = m.msgId || m.messageId;
      var top = document.createElement('div');
      top.className = 'nx-starred-top';
      var who = document.createElement('span');
      who.className = 'nx-starred-who';
      var sender = _normId(m.senderNexoId || '');
      who.textContent = m._own ? t('chat_you', 'Tú') : (gs && gs.isGroup(cid) ? gs.memberName(sender) : _contactName(sender && sender !== me ? sender : cid));
      var when = document.createElement('span');
      when.className = 'nx-starred-when';
      when.textContent = _when(m.timestamp);
      top.appendChild(who); top.appendChild(when);
      var txt = document.createElement('div');
      txt.className = 'nx-starred-txt';
      txt.textContent = _msgSummary(m).s;
      row.appendChild(top); row.appendChild(txt);
      row.onclick = function() { box.remove(); jumpToMessage(row.dataset.msgId); };
      list.appendChild(row);
    });
    return box;
  });
}
