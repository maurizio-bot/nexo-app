/**
 * estados_screen.js — 3169 (dueño 17-11: «sacar los estados de arriba de Contactos y llevarlos a una pantalla nueva a la que se llega
 * DESLIZANDO la pantalla de Contactos de derecha a izquierda»; más adelante tendrá también el stream y los vídeos públicos).
 * Regla del dueño: SOLO GESTOS y pantalla limpia — nada de botones, pestañas, etiquetas «Contactos · Estados» ni puntitos. La única
 * ayuda es un aviso de texto que sale UNA vez (la primera) y se va solo o al primer toque; se guarda que ya salió.
 *  - Contactos → Estados: deslizar de derecha a izquierda empezando en el centro (las franjas de los bordes son del gesto «atrás» de
 *    Android: ahí no se intercepta nada). La pantalla sigue al dedo; al soltar pasa con un cuarto del ancho o con un tirón rápido.
 *    Si domina lo vertical es scroll (o «deslizar para actualizar»), no cambio de pantalla.
 *  - Estados → Contactos: deslizar de izquierda a derecha, o el «atrás» de Android (chat_nav.js llama a __nexoEstadosBack).
 *  - La pantalla: título (solo texto), «Mi estado» (publicar / mis estados, como antes) y la sección «De tus contactos» (los no vistos
 *    primero, con el aro celeste = sin ver, gris = visto); tocar uno abre el visor de siempre (estados.js). Deslizar hacia abajo
 *    actualiza (refreshAll, «[ACTUALIZAR] Deslizar»). Las secciones van en SECCIONES: «Público» se añadirá debajo sin rehacer nada.
 */
import { myStatuses, activeStatusContacts, openStatusViewer, openStatusCompose, openMyStatuses, attachPullRefresh, statusAgo } from './estados.js';
import { _getGradientForUUID, _getInitials } from './ble_helpers.js';
import { paintAvatar } from './avatar.js';
import { t } from './i18n.js';

var EDGE_PX = 32;          // franja de cada borde reservada al gesto «atrás» del sistema
var SLOP_PX = 10;          // lo que hay que mover el dedo para decidir si el gesto es de lado o vertical
var PASS_FRAC = 0.25;      // al soltar, con un cuarto del ancho se cambia de pantalla…
var FLICK_V = 0.45;        // …o con un tirón rápido (px/ms)…
var FLICK_MIN = 30;        // …de al menos estos píxeles
var ANIM_MS = 260;         // lo que tarda en acomodarse al soltar (igual que .nx-est-anim en estados.css)
var HINT_KEY = 'nexo_est_swipe_hint';   // el aviso de una vez ya salió
var HINT_MS = 6000;

var _scr = null;           // #estados-screen
var _open = false;         // Estados a la vista (o yendo hacia ella)
var _anim = null;          // temporizador del acomodo al soltar
var _g = null;             // gesto en curso: { from: 'list'|'scr', x0, y0, x, t, v, on, W }

// ---------- La pantalla ----------
// Cada sección pinta lo suyo en su <section>; «title» (si lo tiene) es el rótulo de arriba. «Público» irá al final de esta lista.
var SECCIONES = [
  { id: 'mine', paint: _paintMine },
  { id: 'contacts', title: function() { return t('est_sec_contacts', 'De tus contactos'); }, paint: _paintContacts },
];

function _screen() {
  if (_scr && _scr.isConnected) return _scr;
  if (!document.body) return null;
  _scr = document.createElement('div');
  _scr.id = 'estados-screen';
  _scr.className = 'nx-est-scr';
  _scr.setAttribute('aria-hidden', 'true');
  var head = document.createElement('div'); head.className = 'nx-page-head nx-est-head';
  var h = document.createElement('div'); h.className = 'nx-page-title nx-est-title'; h.textContent = t('est_screen_title', 'Estados');
  head.appendChild(h);
  var body = document.createElement('div'); body.id = 'estados-screen-body'; body.className = 'nx-est-body';
  SECCIONES.forEach(function(s) { var el = document.createElement('section'); el.id = 'est-sec-' + s.id; el.className = 'nx-est-sec'; el.setAttribute('data-sec', s.id); body.appendChild(el); });
  _scr.appendChild(head); _scr.appendChild(body);
  document.body.appendChild(_scr);
  attachPullRefresh(body, 'estados-scr-pull');
  return _scr;
}

function _render() {
  if (!_screen()) return;
  SECCIONES.forEach(function(s) {
    var el = document.getElementById('est-sec-' + s.id); if (!el) return;
    el.innerHTML = '';
    if (s.title) { var h = document.createElement('div'); h.className = 'nx-est-sec-t'; h.textContent = s.title(); el.appendChild(h); }
    s.paint(el);
  });
}

// Una fila: el círculo (con el aro) y dos líneas. El círculo es el PRIMER div de la fila: las pruebas leen su aro (border).
function _row(o) {
  var w = document.createElement('div');
  w.className = 'estado-chip nx-est-row' + (o.mine ? ' nx-est-mine' : '');
  if (o.nx) w.setAttribute('data-nx', o.nx);
  var c = document.createElement('div');
  c.className = 'nx-est-av' + (o.nx ? ' ble-contact-avatar ' + _getGradientForUUID(o.nx) : '') + (o.add ? ' nx-est-add' : '') + (o.ring ? '' : ' nx-est-noring');
  if (o.img) { var im = document.createElement('img'); im.src = o.img; im.alt = ''; c.appendChild(im); }
  else if (o.nx) { c.textContent = _getInitials(o.label); try { paintAvatar(c, o.nx); } catch (e) {} }
  else c.textContent = o.letter || '';
  if (o.seen) { c.classList.add('visto'); c.style.borderColor = 'rgba(255,255,255,0.25)'; }   // ya visto: aro gris (como la tira de antes)
  var tx = document.createElement('div'); tx.className = 'nx-est-txt';
  var nm = document.createElement('div'); nm.className = 'nx-est-name'; nm.textContent = o.label || '';
  var sb = document.createElement('div'); sb.className = 'nx-est-sub'; sb.textContent = o.sub || '';
  tx.appendChild(nm); tx.appendChild(sb);
  w.appendChild(c); w.appendChild(tx);
  w.addEventListener('click', function(e) { e.stopPropagation(); o.onTap(); });
  return w;
}
function _countAgo(n, ts) { return (n > 1 ? n + ' ' + t('est_count', 'estados') + ' · ' : '') + statusAgo(ts); }

// «Mi estado»: sin estados, el círculo con ＋ (tocar = publicar); con estados, la última foto o su inicial (tocar = «Mis estados»)
function _paintMine(el) {
  var mine = myStatuses(), last = mine[mine.length - 1];
  var img = (mine.filter(function(x) { return x.img; }).pop() || {}).img || '';
  el.appendChild(_row({
    mine: true, label: t('grp_my_status', 'Mi estado'), img: img, add: !img, ring: !!last,
    letter: last ? (last.t || '·').substring(0, 1).toUpperCase() : '＋',
    sub: last ? _countAgo(mine.length, last.ts) : t('est_tap_publish', 'Toca para publicar uno (24 h)'),
    onTap: function() { if (myStatuses().length) openMyStatuses(); else openStatusCompose(); },
  }));
}
// «De tus contactos»: los que tienen algo sin ver primero; en cada grupo, el más reciente arriba
function _paintContacts(el) {
  var list = activeStatusContacts().sort(function(a, b) { return ((b.unseen > 0) - (a.unseen > 0)) || (b.ts - a.ts); });
  if (!list.length) { var e = document.createElement('div'); e.className = 'nx-est-empty'; e.textContent = t('est_none_yet', 'Aún no hay estados de tus contactos. Cuando publiquen uno, saldrá aquí.'); el.appendChild(e); return; }
  list.forEach(function(c) {
    el.appendChild(_row({ nx: c.nx, label: c.name, img: c.img, ring: true, seen: !c.unseen, sub: _countAgo(c.n, c.ts), onTap: function() { openStatusViewer(c); } }));
  });
}

// ---------- Ir y volver ----------
function _app() { return document.getElementById('app'); }
// p: 0 = Contactos a la vista, 1 = Estados a la vista (lo de en medio, mientras el dedo arrastra)
function _setPos(p) {
  var app = _app(), scr = _screen();
  if (app) app.style.transform = p > 0 ? 'translate3d(' + (-p * 100).toFixed(2) + '%,0,0)' : '';
  if (scr) scr.style.transform = 'translate3d(' + ((1 - p) * 100).toFixed(2) + '%,0,0)';
}
function _settle(open) {
  var scr = _screen(), app = _app(), b = document.body;
  if (!scr) return;
  clearTimeout(_anim);
  if (open && !_open) _render();
  _open = open;
  b.classList.remove('nx-est-drag');
  b.classList.toggle('nx-est-on', open);
  scr.classList.add('nx-est-vis'); scr.classList.add('nx-est-anim'); if (app) app.classList.add('nx-est-anim');
  void scr.offsetWidth;
  _setPos(open ? 1 : 0);
  scr.setAttribute('aria-hidden', open ? 'false' : 'true');
  if (open) { _hintHide(); console.log('[ESTADOS] Pantalla de estados abierta'); }
  _anim = setTimeout(function() {
    _anim = null;
    scr.classList.remove('nx-est-anim'); if (app) app.classList.remove('nx-est-anim');
    if (!_open) { scr.classList.remove('nx-est-vis'); _setPos(0); }
  }, ANIM_MS + 40);
}
// Sin animación (se abrió un chat estando en Estados: el chat vive en #app y tiene que verse ya)
function _closeNow() {
  var scr = _screen(), app = _app();
  clearTimeout(_anim); _anim = null; _g = null; _open = false;
  document.body.classList.remove('nx-est-drag'); document.body.classList.remove('nx-est-on');
  if (app) { app.classList.remove('nx-est-anim'); app.style.transform = ''; }
  if (scr) { scr.classList.remove('nx-est-anim'); scr.classList.remove('nx-est-vis'); scr.style.transform = ''; scr.setAttribute('aria-hidden', 'true'); }
}
// El «atrás» de Android con Estados a la vista: vuelve a Contactos (true = lo manejó)
export function closeEstadosScreen() { if (!_open) return false; _settle(false); return true; }

// ---------- El gesto ----------
function _pt(e) { var p = e.touches && e.touches[0]; return (p && typeof p.clientX === 'number' && typeof p.clientY === 'number') ? p : null; }
// ¿Contactos está a la vista y el dedo empezó en él? (no en la tira «en línea», que se desliza de lado, ni con algo abierto encima)
function _fromList(e) {
  var b = document.body, tg = e.target, bp = document.getElementById('ble-panel');
  if (_open || !b || b.classList.contains('chat-view-active') || !tg || !tg.closest) return false;
  if (!tg.closest('#contacts-view, #main-header') || tg.closest('#main-contacts-online-strip, input, textarea')) return false;
  if (document.querySelector('.ble-contact-menu') || (bp && bp.classList.contains('active'))) return false;
  return true;
}
function _onStart(e) {
  if (_g && _g.on) return;
  _g = null;
  var p = _pt(e);
  if (!p || e.touches.length !== 1 || _anim) return;
  var inScr = !!(_scr && e.target && e.target.closest && e.target.closest('#estados-screen'));
  var from = _open ? (inScr ? 'scr' : null) : (_fromList(e) ? 'list' : null);
  var W = window.innerWidth || document.documentElement.clientWidth || 360;
  if (!from || p.clientX < EDGE_PX || p.clientX > W - EDGE_PX) return;   // bordes: el «atrás» del sistema
  _g = { from: from, x0: p.clientX, y0: p.clientY, x: p.clientX, t: Date.now(), v: 0, on: false, W: W };
}
function _onMove(e) {
  if (!_g) return;
  var p = _pt(e);
  if (!p) return;
  if (e.touches.length > 1) { _onCancel(); return; }
  var dx = p.clientX - _g.x0, dy = p.clientY - _g.y0, now = Date.now();
  if (!_g.on) {
    if (Math.abs(dx) < SLOP_PX && Math.abs(dy) < SLOP_PX) return;
    // domina lo vertical (scroll, actualizar) o va hacia donde no hay otra pantalla: no es nuestro
    if (Math.abs(dy) >= Math.abs(dx) || (_g.from === 'list' ? dx > 0 : dx < 0)) { _g = null; return; }
    _g.on = true;
    document.body.classList.add('nx-est-drag');
    if (_g.from === 'list') _render();
    var scr = _screen(); scr.classList.add('nx-est-vis');
    _hintHide();
  }
  var dt = now - _g.t;
  if (dt > 0) _g.v = 0.7 * ((p.clientX - _g.x) / dt) + 0.3 * _g.v;
  _g.x = p.clientX; _g.t = now;
  var f = _g.from === 'list' ? -dx / _g.W : 1 - dx / _g.W;
  _setPos(Math.max(0, Math.min(1, f)));
  if (e.cancelable) e.preventDefault();
}
function _onEnd() {
  var g = _g; _g = null;
  if (!g || !g.on) return;
  var dir = g.from === 'list' ? -1 : 1;                    // el sentido que cambia de pantalla
  var d = (g.x - g.x0) * dir, v = (Date.now() - g.t > 100 ? 0 : g.v) * dir;
  var pass = v > -FLICK_V && (d >= g.W * PASS_FRAC || (d >= FLICK_MIN && v >= FLICK_V));
  _settle(g.from === 'list' ? pass : !pass);
}
function _onCancel() {
  var g = _g; _g = null;
  if (g && g.on) _settle(g.from === 'scr');
}

// ---------- El aviso de una vez («Desliza a la izquierda para ver los estados») ----------
var _hint = null, _hintT = null;
function _hintDone() { try { return localStorage.getItem(HINT_KEY) === '1'; } catch (e) { return false; } }
function _hintFree() {
  var b = document.body, bp = document.getElementById('ble-panel');
  return !!b && !_open && !_g && !b.classList.contains('chat-view-active') && !(bp && bp.classList.contains('active')) && !!document.getElementById('contacts-view') &&
    !document.querySelector('#nexo-welcome-overlay, #nexo-bat-overlay, #estado-overlay, #nexo-profile-sheet, #nexo-settings-sheet, #fullscreen-media-overlay') && document.visibilityState !== 'hidden';
}
function _hintMaybe(tries) {
  if (_hint || _hintDone()) return;
  if (!_hintFree()) { if (tries < 60) setTimeout(function() { _hintMaybe(tries + 1); }, 1500); return; }
  try { localStorage.setItem(HINT_KEY, '1'); } catch (e) {}
  _hint = document.createElement('div');
  _hint.id = 'nexo-est-hint'; _hint.className = 'nx-est-hint'; _hint.setAttribute('role', 'status');
  _hint.textContent = '← ' + t('est_swipe_hint', 'Desliza a la izquierda para ver los estados');
  document.body.appendChild(_hint);
  document.addEventListener('touchstart', _hintHide, { passive: true, capture: true });
  _hintT = setTimeout(_hintHide, HINT_MS);
  console.log('[ESTADOS] Aviso de una vez: desliza a la izquierda para ver los estados');
}
function _hintHide() {
  if (!_hint) return;
  var h = _hint; _hint = null; clearTimeout(_hintT);
  document.removeEventListener('touchstart', _hintHide, { capture: true });
  h.classList.add('out');
  setTimeout(function() { try { h.remove(); } catch (e) {} }, 300);
}

export function estadosScreenInit() {
  if (window.__nexoEstadosScreen) return;
  window.__nexoEstadosScreen = true;
  _screen();
  _render();
  document.addEventListener('touchstart', _onStart, { passive: true });
  document.addEventListener('touchmove', _onMove, { passive: false });
  document.addEventListener('touchend', _onEnd, { passive: true });
  document.addEventListener('touchcancel', _onCancel, { passive: true });
  window.addEventListener('nexo:estado', _render);
  window.addEventListener('nexo:ble:closeChat', function() { setTimeout(_render, 60); });
  window.addEventListener('nexo:ble:openChat', function() { _hintHide(); if (_open || _g) _closeNow(); });
  window.__nexoEstadosBack = closeEstadosScreen;   // el «atrás» de Android (chat_nav.js)
  setTimeout(function() { _hintMaybe(0); }, 1200);
}
