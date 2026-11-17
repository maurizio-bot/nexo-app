// msg_select.js — 3206 (dueño 17-11: «al reenviar hay que agregar la multiselección»): elegir VARIOS mensajes de un chat y
// reenviarlos juntos. «Seleccionar» en el menú de un mensaje (pulsación larga) abre la selección con ese mensaje marcado; tocar
// otros los marca o los desmarca (sin abrir fotos, enlaces ni el menú, y sin reaccionar con el doble toque); arriba, una barra con
// ✕, cuántos van y «Reenviar», que abre la hoja de siempre («Reenviar a…», uno o más chats) y los manda en el ORDEN DEL CHAT.
// No se marcan los eliminados ni los de «ver una vez» (no se reenvían). La cierran: ✕, el gesto atrás, quitar el último, reenviar
// y abrir o cerrar un chat. No toca el almacenamiento ni el envío: reenvía con lo mismo que el reenvío de un solo mensaje.
'use strict';

import { t } from './i18n.js';
import { _findMessage } from './chat_format.js';
import { _showInfoToast } from './ui_bits.js';
import { _openForwardSheet } from './chat_actions.js';

var MAX_SEL = 50;                 // como mucho, mensajes en una selección
var LONG_TAP_MS = 800;            // tras marcar con una pulsación larga, el «click» que la sigue no vuelve a desmarcar
var _sel = null;                  // { cid, ids: [msgId…] en el orden en que se marcaron }
var _bar = null, _mo = null, _last = { id: '', at: 0 };

function _container() { return document.getElementById('messages-container'); }
function _bubbles() { var mc = _container(); return mc ? Array.prototype.slice.call(mc.querySelectorAll('.message[data-msg-id]')) : []; }
function _canPick(m) { return !!m && !m.deleted && !(m.onceSeen || (m.attachmentMeta && m.attachmentMeta.once)); }
function _label(key, fb) { return String(t(key, fb) || '').replace(/^[^\p{L}\p{N}]+/u, ''); }

export function isSelecting() { return !!_sel; }

// Desde «Seleccionar» del menú del mensaje
export function startSelect(cid, id) {
  if (!cid || !id) return;
  endSelect();
  _sel = { cid: cid, ids: [] };
  _buildBar();
  document.addEventListener('click', _onClick, true);
  var mc = _container();
  if (mc && typeof MutationObserver !== 'undefined') { _mo = new MutationObserver(_paint); _mo.observe(mc, { childList: true }); }
  _toggle(id);
}

// Una pulsación larga con la selección abierta marca o desmarca (en vez del menú)
export function selectFromBubble(div) {
  var id = div && div.dataset && div.dataset.msgId;
  if (!_sel || !id) return;
  _last = { id: id, at: Date.now() };
  _toggle(id);
}

// true si había una selección abierta (el gesto atrás la cierra)
export function endSelect() {
  if (!_sel) return false;
  _sel = null;
  document.removeEventListener('click', _onClick, true);
  if (_mo) { try { _mo.disconnect(); } catch (e) {} _mo = null; }
  _bubbles().forEach(function(b) { b.classList.remove('msg-selected'); });
  if (_bar) { _bar.remove(); _bar = null; }
  return true;
}

function _onClick(e) {
  if (!_sel) return;
  var m = e.target && e.target.closest ? e.target.closest('.message') : null;
  var mc = _container();
  if (!m || !mc || !mc.contains(m) || !m.dataset.msgId || m.classList.contains('progress-placeholder')) return;
  e.stopPropagation(); e.preventDefault();
  if (_last.id === m.dataset.msgId && Date.now() - _last.at < LONG_TAP_MS) return;
  _toggle(m.dataset.msgId);
}

function _toggle(id) {
  var s = _sel;
  if (!s) return;
  var i = s.ids.indexOf(id);
  if (i >= 0) {
    s.ids.splice(i, 1);
    if (!s.ids.length) { endSelect(); return; }
    _paint(); _count();
    return;
  }
  if (s.ids.length >= MAX_SEL) { _showInfoToast(t('chat_sel_max', 'Puedes elegir hasta 50 mensajes'), 2000); return; }
  _findMessage(s.cid, id).then(function(m) {
    if (_sel !== s) return;
    if (!_canPick(m)) {
      _showInfoToast(t('chat_sel_cant', 'Este mensaje no se puede reenviar'), 2000);
      if (!s.ids.length) endSelect();
      return;
    }
    if (s.ids.indexOf(id) < 0) s.ids.push(id);
    _paint(); _count();
  });
}

function _paint() {
  if (!_sel) return;
  var ids = _sel.ids;
  _bubbles().forEach(function(b) { b.classList.toggle('msg-selected', ids.indexOf(b.dataset.msgId) >= 0); });
}

function _count() {
  var c = document.getElementById('nexo-select-count');
  if (!c || !_sel) return;
  var n = _sel.ids.length;
  c.textContent = n === 1 ? t('chat_sel_one', '1 seleccionado') : n + t('chat_sel_many', ' seleccionados');
}

function _buildBar() {
  if (_bar) _bar.remove();
  _bar = document.createElement('div');
  _bar.id = 'nexo-select-bar';
  _bar.style.cssText = 'display:flex;align-items:center;gap:10px;padding:8px 12px;flex-shrink:0;background:var(--nx-surface,#1b1c33);border-bottom:1px solid var(--nx-line,rgba(255,255,255,0.08));';
  var close = document.createElement('button');
  close.id = 'nexo-select-close';
  close.type = 'button';
  close.setAttribute('aria-label', _label('chat_cancel', 'Cancelar')); close.title = close.getAttribute('aria-label');
  close.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6L6 18"/><path d="M6 6l12 12"/></svg>'; // SVG fijo
  close.style.cssText = 'width:34px;height:34px;border-radius:50%;background:rgba(255,255,255,0.1);color:#fff;border:none;cursor:pointer;flex-shrink:0;display:inline-flex;align-items:center;justify-content:center;padding:0;';
  close.addEventListener('click', function(e) { e.stopPropagation(); endSelect(); });
  var count = document.createElement('span');
  count.id = 'nexo-select-count';
  count.style.cssText = 'flex:1;min-width:0;font-size:15px;font-weight:600;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
  var fwd = document.createElement('button');
  fwd.id = 'nexo-select-forward';
  fwd.type = 'button';
  fwd.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M15 14l5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/></svg>'; // SVG fijo
  var fl = document.createElement('span'); fl.textContent = _label('chat_forward', 'Reenviar');
  fwd.appendChild(fl);
  fwd.style.cssText = 'display:inline-flex;align-items:center;gap:6px;padding:8px 14px;border:none;border-radius:18px;background:var(--nx-grad,linear-gradient(135deg,#00c8ff,#a855f7));color:#fff;font-size:14px;font-weight:600;cursor:pointer;flex-shrink:0;';
  fwd.addEventListener('click', function(e) { e.stopPropagation(); _forward(); });
  _bar.appendChild(close); _bar.appendChild(count); _bar.appendChild(fwd);
  var header = document.getElementById('chat-header');
  if (header && header.parentNode) header.parentNode.insertBefore(_bar, header.nextSibling);
  else document.body.appendChild(_bar);
}

// Los marcados, en el orden del chat (por la hora de cada uno), a la hoja «Reenviar a…»; la selección se cierra al mandarlos
function _forward() {
  var s = _sel;
  if (!s || !s.ids.length) return;
  Promise.all(s.ids.map(function(id) { return _findMessage(s.cid, id).catch(function() { return null; }); })).then(function(list) {
    if (_sel !== s) return;
    list = list.filter(_canPick).sort(function(a, b) { return (a.timestamp || 0) - (b.timestamp || 0); });
    if (!list.length) { _showInfoToast(t('chat_sel_cant', 'Este mensaje no se puede reenviar'), 2000); return; }
    _openForwardSheet(list, function() { if (_sel === s) endSelect(); });
  });
}

if (typeof window !== 'undefined') {
  window.__nexoEndSelect = endSelect; // el gesto atrás (chat_nav.js)
  window.addEventListener('nexo:ble:closeChat', endSelect);
  window.addEventListener('nexo:ble:openChat', endSelect);
}
