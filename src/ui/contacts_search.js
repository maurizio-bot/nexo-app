/**
 * NEXO — Buscar en Contactos (3196, dueño 17-11: «falta el botón para buscar contactos en la pantalla Contactos»).
 * Una lupa en la cabecera de Contactos (redonda de 42 px, como Perfil y Grupo; la respuesta al dedo es la de press.js) abre una
 * barra justo debajo con el teclado abierto y una ✕ para cerrar. Mientras se escribe, la lista principal muestra solo lo que
 * coincide: por nombre sin distinguir mayúsculas ni acentos («jose» encuentra «José»; también los grupos por su nombre) o por un
 * trozo del NEXO ID, con o sin «NX». El filtro lo aplica el propio dibujo de la lista (ble_ui._renderContactsListNow pregunta
 * contactSearchQuery), así que sigue puesto aunque la lista se redibuje sola (mensaje nuevo, alguien se conecta). Cerrar (✕,
 * atrás de Android vía chat_nav, Escape, o abrir un chat) limpia el filtro y vuelve la lista completa. No toca lo guardado.
 */
import { t } from './i18n.js';
import { applyHitAreas } from './press.js';

var BTN_ID = 'nexo-contacts-search-btn', BAR_ID = 'nexo-contacts-search-bar', INPUT_ID = 'nexo-contacts-search-input', CLOSE_ID = 'nexo-contacts-search-close';
// Con una lista grande (más de BIG_LIST filas al abrir) o un dibujo lento (> SLOW_MS) se espera a que se deje de escribir
// DEBOUNCE_MS antes de redibujar; con las normales, al momento (con cada letra)
var BIG_LIST = 150, SLOW_MS = 30, DEBOUNCE_MS = 100;
var _bi = null, _open = false, _q = null, _timer = null, _lastCost = 0, _rowsAtOpen = 0;

// ---------- decisiones PURAS (las prueba tests/sim/buscarcontactos.js) ----------
// Sin acentos ni mayúsculas («José» → «jose»; la ñ queda como n, como en el teclado sin acentos)
export function _csFold(s) {
  var x = String(s == null ? '' : s);
  try { x = x.normalize('NFD').replace(/[\u0300-\u036f]/g, ''); } catch (e) {}
  return x.toLowerCase();
}
// Lo escrito, listo para comparar (null = sin filtro): `q` para el nombre; `id`, solo letras y números, para el NEXO ID
export function _csQuery(raw) {
  var q = _csFold(raw).replace(/\s+/g, ' ').trim();
  return q ? { q: q, id: q.replace(/[^0-9a-z]/g, '') } : null;
}
// ¿Coincide? Por el nombre en cualquier parte; por el NEXO ID desde 3 letras o números (con o sin «NX»: «nx3f9», «3F9A»); los
// grupos solo por su nombre (su ID no se ve en ningún lado)
export function _csMatch(query, name, id, isGroup) {
  if (!query) return true;
  if (_csFold(name).indexOf(query.q) >= 0) return true;
  if (isGroup || query.id.length < 3) return false;
  return String(id || '').toLowerCase().indexOf(query.id) >= 0;
}

// Lo que pregunta el dibujo de la lista: null con el buscador cerrado o vacío
export function contactSearchQuery() { return _open ? _q : null; }

// ---------- la interfaz ----------
function _el(id) { return document.getElementById(id); }
function _render() {
  if (!_bi || typeof _bi._renderContactsListNow !== 'function') return;
  var t0 = Date.now();
  try { _bi._renderContactsListNow(); } catch (e) {}
  _lastCost = Date.now() - t0;
}
function _filtering(on) { var cv = _el('contacts-view'); if (cv) cv.classList.toggle('nx-cs-filtering', !!on); }
function _apply(raw) {
  var nq = _csQuery(raw), same = (!nq && !_q) || (nq && _q && nq.q === _q.q);
  _q = nq;
  _filtering(!!_q);
  if (_timer) { clearTimeout(_timer); _timer = null; }
  if (same) return;
  if (_lastCost > SLOW_MS || _rowsAtOpen > BIG_LIST) _timer = setTimeout(function() { _timer = null; _render(); }, DEBOUNCE_MS);
  else _render();
}

function _buildBar() {
  var bar = _el(BAR_ID);
  if (bar) return bar;
  var header = _el('main-header');
  if (!header || !header.parentNode) return null;
  bar = document.createElement('div');
  bar.id = BAR_ID;
  bar.setAttribute('role', 'search');
  var field = document.createElement('label');
  field.className = 'nx-cs-field';
  field.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>';
  var input = document.createElement('input');
  input.id = INPUT_ID;
  input.type = 'text';
  input.setAttribute('inputmode', 'search');
  input.setAttribute('enterkeyhint', 'search');
  input.setAttribute('autocomplete', 'off');
  input.setAttribute('autocorrect', 'off');
  input.setAttribute('autocapitalize', 'off');
  input.setAttribute('spellcheck', 'false');
  input.placeholder = t('ph_search_contact', 'Buscar por nombre o NEXO ID');
  input.setAttribute('aria-label', t('contacts_search', 'Buscar contactos'));
  field.appendChild(input);
  var close = document.createElement('button');
  close.id = CLOSE_ID;
  close.type = 'button';
  close.setAttribute('aria-label', t('misc_search_close', 'Cerrar búsqueda'));
  close.title = t('misc_search_close', 'Cerrar búsqueda');
  close.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
  input.addEventListener('input', function() { _apply(input.value); });
  input.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') { e.preventDefault(); closeContactSearch(); }
    else if (e.key === 'Enter') { e.preventDefault(); try { input.blur(); } catch (x) {} } // «buscar» del teclado: baja el teclado, el filtro queda
  });
  close.addEventListener('click', function(e) { e.stopPropagation(); closeContactSearch(); });
  bar.appendChild(field);
  bar.appendChild(close);
  header.parentNode.insertBefore(bar, header.nextSibling);
  return bar;
}

export function openContactSearch() {
  var bar = _buildBar();
  if (!bar) return false;
  if (!_open) {
    _open = true;
    _q = null;
    _rowsAtOpen = document.querySelectorAll('#main-contacts-list .ble-contact-row').length;
    bar.classList.add('nx-cs-open');
    var b = _el(BTN_ID); if (b) b.setAttribute('aria-expanded', 'true');
    // el área de toque de la ✕ (48 px, press.js): el motor la mide cuando cambia el DOM, y mostrar la barra no lo cambia (es una
    // clase). Con una lista grande no se mide aquí (recorre cada fila: ~0,2 s con 1000): la mide el propio motor tras el primer
    // filtrado, ya con menos filas
    if (_rowsAtOpen <= BIG_LIST) { try { applyHitAreas(document); } catch (e) {} }
  }
  // el teclado se abre con el foco DENTRO del toque (en el WebView, un focus() fuera del gesto no lo abre)
  var i = _el(INPUT_ID);
  if (i) { try { i.focus(); } catch (e) {} if (document.activeElement !== i) setTimeout(function() { try { i.focus(); } catch (e) {} }, 60); }
  return true;
}

// Cierra y vuelve la lista completa. true = estaba abierto (lo usa el «atrás» de Android, chat_nav.js). lazy: la lista no se ve
// (se abrió un chat): se redibuja por el camino de siempre (renderContactsList, agrupado) y no en medio de la apertura del chat
export function closeContactSearch(lazy) {
  if (!_open) return false;
  _open = false;
  if (_timer) { clearTimeout(_timer); _timer = null; }
  var had = !!_q;
  _q = null;
  _filtering(false);
  var bar = _el(BAR_ID), i = _el(INPUT_ID), b = _el(BTN_ID);
  if (i) { i.value = ''; try { i.blur(); } catch (e) {} }
  if (bar) bar.classList.remove('nx-cs-open');
  if (b) b.setAttribute('aria-expanded', 'false');
  if (had) { if (lazy === true && _bi && typeof _bi.renderContactsList === 'function') { try { _bi.renderContactsList(); } catch (e) {} } else _render(); }
  return true;
}

// La lupa en la cabecera (la llama ble_ui.setupEventListeners con la interfaz de contactos)
export function installContactSearch(bi) {
  _bi = bi || _bi;
  var header = _el('main-header');
  if (!header || _el(BTN_ID)) return;
  var b = document.createElement('button');
  b.id = BTN_ID;
  b.type = 'button';
  b.title = t('contacts_search', 'Buscar contactos');
  b.setAttribute('aria-label', t('contacts_search', 'Buscar contactos'));
  b.setAttribute('aria-expanded', 'false');
  b.setAttribute('aria-controls', BAR_ID);
  b.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>';
  if (getComputedStyle(header).position === 'static') header.style.position = 'relative';
  b.addEventListener('click', function(e) { e.stopPropagation(); if (_open) closeContactSearch(); else openContactSearch(); });
  header.appendChild(b);
  _buildBar();
  // al abrir un chat (tocar un resultado, la tira «en línea», un aviso…) el buscador se cierra: al volver, la lista completa
  window.addEventListener('nexo:ble:openChat', function() { closeContactSearch(true); });
  window.__nexoCloseContactSearch = function() { return closeContactSearch(); };
  window.NEXO_contactSearch = { open: openContactSearch, close: closeContactSearch, query: contactSearchQuery, match: _csMatch, parse: _csQuery }; // pruebas
}
