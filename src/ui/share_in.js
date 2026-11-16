/**
 * NEXO — Lo que se comparte CON NEXO desde otra app (3161, dueño 16-11: «compartir de forma práctica vídeos de TikTok, Facebook,
 * Instagram (y YouTube)»). NEXO sale en el menú «Compartir» de Android para texto y enlaces (intent-filter SEND text/plain de la
 * MainActivity; SharedText.kt valida el tipo y lo corta a 4000). El nativo avisa onSharedText {text} y lo RETIENE hasta que la app
 * escucha (con la app cerrada llega antes que el JS). Aquí: se espera a que la app esté lista, se abre la hoja «Enviar a…» con los
 * chats (contactos y grupos, en el orden de la lista de chats, con buscador) y al elegir uno se abre ese chat con el texto YA escrito
 * en la caja (no se envía solo: el usuario puede añadir algo y lo manda con su botón). Sin chats, un aviso.
 * Fase 1: solo texto (las fotos y vídeos compartidos, después).
 */
import { t } from './i18n.js';
import { _normId } from './chat_format.js';
import { vaultLoadContacts } from '../vault/vault_manager.js';
import { _pickAvatar, SHEET_CLOSE_SVG } from './share_contacts.js';
import { _showInfoToast } from './ui_bits.js';
import { _getPinnedContacts } from './ble_helpers.js';
import { _cancelEdit, _cancelReply } from './chat_actions.js';

export var SHARED_TEXT_MAX = 4000;
var _pending = null, _waiting = false;

function _bi() { return (window.NEXO && window.NEXO.app && window.NEXO.app.bleInterface) || null; }

/** Texto compartido limpio: sin caracteres de control (salvo saltos de línea y tabuladores), sin espacios a los lados y como mucho 4000 */
export function cleanSharedText(text) {
  if (typeof text !== 'string') return '';
  var s = text.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim();
  if (s.length > SHARED_TEXT_MAX) {
    var cut = SHARED_TEXT_MAX, c = s.charCodeAt(cut - 1);
    if (c >= 0xd800 && c <= 0xdbff) cut--; // no partir un emoji por la mitad
    s = s.slice(0, cut);
  }
  return s;
}

/** Escucha el aviso del nativo (se llama al arrancar; lo retenido llega al empezar a escuchar) */
export function shareInInit() {
  var pl = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.NexoBLE;
  if (!pl || typeof pl.addListener !== 'function') return;
  try {
    var h = pl.addListener('onSharedText', function(d) { receiveSharedText(d && d.text); });
    if (h && typeof h.catch === 'function') h.catch(function() {});
  } catch (e) {}
}

/** Llega un texto compartido: cuando la app esté lista (vault + interfaz; hasta 30 s), la hoja «Enviar a…». Si llegan dos, el último. */
export function receiveSharedText(text) {
  var s = cleanSharedText(text);
  if (!s) return;
  console.log('[SHARE] Texto compartido con NEXO (' + s.length + ' caracteres)'); // sin el contenido (privacidad)
  _pending = s;
  if (!_waiting) { _waiting = true; _whenReady(0); }
}
function _whenReady(n) {
  if (window.NEXO && window.NEXO.initialized && _bi()) { _waiting = false; var s = _pending; _pending = null; if (s) openSendToSheet(s); return; }
  if (n < 60) setTimeout(function() { _whenReady(n + 1); }, 500);
  else { _waiting = false; _pending = null; }
}

// Los chats como en la lista de chats: fijados arriba, luego por el último mensaje, luego por fecha de alta
function _chats() {
  var byId = {}, rows = [];
  (vaultLoadContacts() || []).forEach(function(c) {
    var id = _normId(c && (c.nexoId || c.deviceUUID));
    if (!/^nx[0-9a-z]{8}$/.test(id)) return;
    if (byId[id]) { byId[id].at = Math.max(byId[id].at, c.lastMessageAt || 0); return; }
    byId[id] = { id: id, name: String(c.name || '') || id.toUpperCase(), sub: id.toUpperCase(), at: c.lastMessageAt || 0, added: c.addedAt || 0 };
    rows.push(byId[id]);
  });
  var gs = _bi() && _bi().groups;
  try {
    ((gs && typeof gs.all === 'function') ? gs.all() : []).forEach(function(g) {
      var id = _normId(g && g.id);
      if (!id || byId[id]) return;
      byId[id] = { id: id, name: '👥 ' + String(g.name || ''), sub: t('share_in_group', 'Grupo'), at: g.lastMessageAt || 0, added: g.createdAt || 0 };
      rows.push(byId[id]);
    });
  } catch (e) {}
  var pinned = _getPinnedContacts() || [];
  rows.sort(function(a, b) {
    var pa = pinned.indexOf(a.id) >= 0 ? 1 : 0, pb = pinned.indexOf(b.id) >= 0 ? 1 : 0;
    if (pa !== pb) return pb - pa;
    return (b.at - a.at) || (b.added - a.added) || a.name.localeCompare(b.name);
  });
  return rows;
}

/** La hoja «Enviar a…». Devuelve false (y avisa) si no hay ningún chat. */
export function openSendToSheet(text) {
  var old = document.getElementById('nexo-sendto-sheet');
  if (old) old.remove();
  var all = _chats();
  if (!all.length) { _showInfoToast(t('share_in_no_chats', 'Aún no tienes chats: agrega un contacto para poder enviarle lo que compartes.'), 4000); return false; }
  var box = document.createElement('div');
  box.id = 'nexo-sendto-sheet';
  box.style.cssText = 'position:fixed;inset:0;z-index:2147483646;color:#fff;display:flex;flex-direction:column;padding:16px;box-sizing:border-box;';
  var head = document.createElement('div');
  head.className = 'nx-page-head nx-sheet-head';
  var title = document.createElement('div');
  title.className = 'nx-page-title';
  title.textContent = t('share_in_title', 'Enviar a…');
  var cancel = document.createElement('button');
  cancel.id = 'nexo-sendto-cancel';
  cancel.className = 'nx-round-btn';
  cancel.setAttribute('aria-label', t('chat_cancel', 'Cancelar')); cancel.title = t('chat_cancel', 'Cancelar');
  cancel.innerHTML = SHEET_CLOSE_SVG; // SVG fijo (sin datos)
  cancel.onclick = function() { box.remove(); };
  head.appendChild(title); head.appendChild(cancel);
  // Lo que se va a mandar (texto, nunca HTML: viene de otra app)
  var prev = document.createElement('div');
  prev.className = 'nx-sendto-preview';
  prev.textContent = text.length > 300 ? text.slice(0, 300) + '…' : text;
  var search = document.createElement('input');
  search.id = 'nexo-sendto-search';
  search.type = 'search';
  search.placeholder = t('media_search', 'Buscar...');
  var list = document.createElement('div');
  list.style.cssText = 'flex:1;overflow-y:auto;';
  var render = function(q) {
    list.textContent = '';
    var f = String(q || '').trim().toLowerCase();
    var shown = all.filter(function(c) { return !f || c.name.toLowerCase().indexOf(f) >= 0 || c.id.indexOf(f) >= 0; });
    if (!shown.length) {
      var empty = document.createElement('div');
      empty.className = 'nx-sendto-empty';
      empty.textContent = t('media_no_results', 'Sin resultados');
      list.appendChild(empty);
      return;
    }
    shown.forEach(function(c) {
      var row = document.createElement('div');
      row.className = 'nexo-pick-row nx-sendto-row';
      row.setAttribute('data-chat-id', c.id);
      row.setAttribute('role', 'button');
      var txt = document.createElement('div'); txt.className = 'nx-pick-txt';
      var nm = document.createElement('div'); nm.className = 'nx-pick-name'; nm.textContent = c.name;
      var sub = document.createElement('div'); sub.className = 'nx-pick-sub'; sub.textContent = c.sub;
      txt.appendChild(nm); txt.appendChild(sub);
      row.appendChild(_pickAvatar(c.id, c.name)); row.appendChild(txt);
      row.onclick = function() { box.remove(); _openWithText(c.id, text); };
      list.appendChild(row);
    });
  };
  search.oninput = function() { render(search.value); };
  render('');
  box.appendChild(head); box.appendChild(prev); box.appendChild(search); box.appendChild(list);
  document.body.appendChild(box);
  return true;
}

// Abre el chat elegido con el texto en la caja (lo que hubiera encima —Ajustes, un perfil, un estado— se cierra, como al tocar un aviso)
function _openWithText(id, text) {
  ['nexo-settings-sheet', 'nexo-profile-sheet', 'nexo-contact-profile', 'estado-overlay'].forEach(function(k) {
    try { var el = document.getElementById(k); if (el && el.parentNode) el.parentNode.removeChild(el); } catch (e) {}
  });
  try { _cancelEdit(); } catch (e) {}   // un texto nuevo: nada de «editando» ni «respondiendo a» de otro chat
  try { _cancelReply(); } catch (e) {}
  var put = function() {
    var inp = document.getElementById('message-input');
    if (!inp) return;
    inp.value = text;
    try { inp.dispatchEvent(new Event('input', { bubbles: true })); } catch (e) {}
    try { inp.focus(); inp.setSelectionRange(text.length, text.length); } catch (e) {}
  };
  var bi = _bi(), p = null;
  try { p = (bi && typeof bi.openChat === 'function') ? bi.openChat(id) : null; } catch (e) {}
  Promise.resolve(p).then(put, put);
}
