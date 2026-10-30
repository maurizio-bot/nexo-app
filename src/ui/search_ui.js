// Buscar dentro del chat (rápido de A_LA_PAR, pedido del dueño): una lupa 🔍 en la cabecera abre una
// barra de búsqueda DEBAJO (sin amontonar botones). Filtra los mensajes del chat (oculta los que no
// coinciden), resalta los que sí y muestra cuántos coinciden. Cerrar o vaciar restaura todo.
// No toca el almacenamiento ni el envío: solo muestra/oculta burbujas ya pintadas en #messages-container.
'use strict';

import { t } from './i18n.js';

var _bar = null;
var _active = false;

function _header() { return document.getElementById('chat-header'); }
function _container() { return document.getElementById('messages-container'); }

// Lupa en la cabecera del chat (igual estilo que llamar/videollamar). A diferencia de esas, se ve también
// en los grupos (buscar sirve en cualquier conversación).
function _installButton() {
  var header = _header();
  if (!header || document.getElementById('nexo-search-btn')) return;
  var b = document.createElement('button');
  b.id = 'nexo-search-btn';
  b.title = t('misc_search_in_chat', 'Buscar en el chat');
  b.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>';
  b.style.cssText = 'width:38px;height:38px;border-radius:50%;background:rgba(255,255,255,0.1);color:#fff;border:none;cursor:pointer;flex-shrink:0;margin-left:6px;display:inline-flex;align-items:center;justify-content:center;padding:0;';
  b.addEventListener('click', function(e) { e.stopPropagation(); _toggle(); });
  header.appendChild(b);
}

function _buildBar() {
  if (_bar) return _bar;
  _bar = document.createElement('div');
  _bar.id = 'nexo-search-bar';
  _bar.style.cssText = 'display:none;align-items:center;gap:8px;padding:8px 12px;background:rgba(0,0,0,0.85);border-bottom:1px solid rgba(255,255,255,0.08);flex-shrink:0;';
  var input = document.createElement('input');
  input.id = 'nexo-search-input';
  input.type = 'text';
  input.placeholder = t('misc_search_placeholder', 'Buscar en esta conversación…');
  input.setAttribute('autocomplete', 'off');
  input.setAttribute('autocorrect', 'off');
  input.setAttribute('spellcheck', 'false');
  input.style.cssText = 'flex:1;min-width:0;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.12);border-radius:18px;color:#fff;font-size:14px;padding:7px 14px;outline:none;';
  var count = document.createElement('span');
  count.id = 'nexo-search-count';
  count.style.cssText = 'font-size:12px;color:#8696a0;flex-shrink:0;min-width:64px;text-align:right;';
  var close = document.createElement('button');
  close.id = 'nexo-search-close';
  close.type = 'button';
  close.title = t('misc_search_close', 'Cerrar búsqueda');
  close.textContent = '✕';
  close.style.cssText = 'width:32px;height:32px;border-radius:50%;background:rgba(255,255,255,0.1);color:#fff;border:none;cursor:pointer;flex-shrink:0;font-size:15px;';
  input.addEventListener('input', function() { _apply(input.value); });
  input.addEventListener('keydown', function(e) { if (e.key === 'Escape') { e.preventDefault(); _toggle(); } });
  close.addEventListener('click', function(e) { e.stopPropagation(); _toggle(); });
  _bar.appendChild(input);
  _bar.appendChild(count);
  _bar.appendChild(close);
  var header = _header();
  if (header && header.parentNode) header.parentNode.insertBefore(_bar, header.nextSibling);
  return _bar;
}

function _toggle() {
  _buildBar();
  _active = !_active;
  if (_active) {
    _bar.style.display = 'flex';
    var i = document.getElementById('nexo-search-input');
    if (i) { i.value = ''; setTimeout(function() { try { i.focus(); } catch (e) {} }, 50); }
    _apply('');
  } else {
    _bar.style.display = 'none';
    _clear();
  }
}

// Filtra las burbujas: oculta las que no contienen el texto, resalta las que sí y cuenta. Compara contra el
// texto visible de la burbuja (.msg-content), sin la hora ni la palomita de estado (que están en .msg-meta).
function _apply(q) {
  var c = _container();
  if (!c) return;
  var query = String(q || '').trim().toLowerCase();
  var msgs = c.querySelectorAll('.message');
  var hits = 0, last = null;
  for (var k = 0; k < msgs.length; k++) {
    var m = msgs[k];
    if (!query) { m.classList.remove('msg-search-hidden'); m.classList.remove('msg-search-hit'); continue; }
    var cont = m.querySelector('.msg-content');
    var text = (cont ? cont.textContent : m.textContent) || '';
    if (text.toLowerCase().indexOf(query) >= 0) {
      m.classList.remove('msg-search-hidden'); m.classList.add('msg-search-hit'); hits++; last = m;
    } else {
      m.classList.add('msg-search-hidden'); m.classList.remove('msg-search-hit');
    }
  }
  var cnt = document.getElementById('nexo-search-count');
  if (cnt) cnt.textContent = !query ? '' : (hits + (hits === 1 ? t('misc_search_result', ' resultado') : t('misc_search_results', ' resultados')));
  // Llevar la vista al coincidente más reciente (el de más abajo)
  if (last && typeof last.scrollIntoView === 'function') { try { last.scrollIntoView({ block: 'center' }); } catch (e) {} }
}

function _clear() {
  var c = _container();
  if (!c) return;
  var msgs = c.querySelectorAll('.message');
  for (var k = 0; k < msgs.length; k++) { msgs[k].classList.remove('msg-search-hidden'); msgs[k].classList.remove('msg-search-hit'); }
}

// Al abrir o cerrar un chat, la búsqueda se cierra (cada chat empieza limpio).
function _reset() { if (_active) _toggle(); }

export function installSearchUi() {
  _installButton();
  window.addEventListener('nexo:ble:closeChat', _reset);
  window.addEventListener('nexo:ble:openChat', _reset);
}
