/**
 * estados_screen.js — 3169 (dueño 17-11: «sacar los estados de arriba de Contactos y llevarlos a una pantalla nueva a la que se llega
 * DESLIZANDO la pantalla de Contactos de derecha a izquierda»; más adelante tendrá también el stream y los vídeos públicos).
 * Regla del dueño: SOLO GESTOS y pantalla limpia — nada de botones, pestañas, etiquetas «Contactos · Estados» ni puntitos. La única
 * ayuda es un aviso de texto que sale UNA vez (la primera) y se va solo o al primer toque; se guarda que ya salió.
 *  - Contactos → Estados: deslizar de derecha a izquierda empezando en el centro (las franjas de los bordes son del gesto «atrás» de
 *    Android: ahí no se intercepta nada). La pantalla sigue al dedo; al soltar pasa con un cuarto del ancho o con un tirón rápido.
 *    Si domina lo vertical es scroll (o «deslizar para actualizar»), no cambio de pantalla.
 *  - Estados → Contactos: deslizar de izquierda a derecha, o el «atrás» de Android (chat_nav.js llama a __nexoEstadosBack).
 *  - La pantalla (3230, dueño 17-11 23:40): los estados como TikTok —arriba los círculos de lado, debajo cada estado a pantalla
 *    completa reproduciéndose solo—; todo eso está en estados_feed.js. Deslizar hacia abajo en el primero actualiza (refreshAll).
 *  - Dentro de Estados, deslizar de lado mueve entre los estados de un mismo contacto; solo en el PRIMERO de ellos, deslizar de
 *    izquierda a derecha vuelve a Contactos. La fila de círculos y el comentario no cambian de pantalla.
 */
import { attachPullRefresh, activeStatusContacts, statusSeen } from './estados.js';
import { feedMount, feedRender, feedShow, feedGoNx } from './estados_feed.js';
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
function _screen() {
  if (_scr && _scr.isConnected) return _scr;
  if (!document.body) return null;
  _scr = document.createElement('div');
  _scr.id = 'estados-screen';
  _scr.className = 'nx-est-scr';
  _scr.setAttribute('aria-hidden', 'true');
  document.body.appendChild(_scr);
  attachPullRefresh(feedMount(_scr), 'estados-scr-pull', _scr);
  return _scr;
}
function _render(force) { if (_screen()) feedRender(!!force); }

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
  if (open && !_open) _render(true);
  var was = _open;
  _open = open;
  if (open !== was) feedShow(open);   // al entrar empieza por el primero y se reproduce; al salir, todo en pausa
  b.classList.remove('nx-est-drag');
  b.classList.toggle('nx-est-on', open);
  scr.classList.add('nx-est-vis'); scr.classList.add('nx-est-anim'); if (app) app.classList.add('nx-est-anim');
  void scr.offsetWidth;
  _setPos(open ? 1 : 0);
  scr.setAttribute('aria-hidden', open ? 'false' : 'true');
  if (open) { _hintHide(); _edgeHide(); setTimeout(_btnBadge, 400); console.log('[ESTADOS] Pantalla de estados abierta'); }
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
  feedShow(false);
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
  // 3230: la fila de círculos se desliza de lado; el comentario es para escribir; y fuera del primer estado de un contacto,
  // deslizar de izquierda a derecha es volver al anterior de ese contacto (no a Contactos)
  if (inScr) {
    if (e.target.closest('#est-rings, .nx-est-cform')) return;
    var hs = e.target.closest('.nx-est-hs'); if (hs && hs.scrollLeft > 2) return;
  }
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
    if (_g.from === 'list') _render(true);
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


// ---------- El destello del borde derecho (dueño 26-11): hay estados NUEVOS que no has visto ----------
// Una rayita suave en el borde derecho que late despacio. No toma los toques. Desaparece al PRIMER toque en la pantalla (el usuario ya lo vio:
// si quiere va a los estados y si no, no) y no vuelve por los mismos estados: solo por otros nuevos.
var EDGE_KEY = 'nexo_est_edge_seen';
var _edge = null;
function _edgeUnseen() {
  var out = [];
  try { activeStatusContacts().forEach(function(c) { c.items.forEach(function(it) { if (!statusSeen(c.nx, it.sid)) out.push(c.nx + '|' + it.sid); }); }); } catch (e) {}
  return out;
}
function _edgeSeen() { try { return JSON.parse(localStorage.getItem(EDGE_KEY) || '[]'); } catch (e) { return []; } }
function _edgeMark(ids) { try { var seen = _edgeSeen(); localStorage.setItem(EDGE_KEY, JSON.stringify(seen.concat(ids.filter(function(i) { return seen.indexOf(i) < 0; })).slice(-300))); } catch (e) {} }
function _edgeHide() {
  if (!_edge) return;
  var e = _edge; _edge = null;
  document.removeEventListener('touchstart', _edgeHide, { capture: true });
  document.removeEventListener('mousedown', _edgeHide, { capture: true });
  _edgeMark(e._ids || []);
  e.classList.add('out');
  setTimeout(function() { try { e.remove(); } catch (x) {} }, 400);
}
function _edgeCheck() {
  if (_edge || !_hintFree()) return;
  var seen = _edgeSeen(), fresh = _edgeUnseen().filter(function(i) { return seen.indexOf(i) < 0; });
  if (!fresh.length) return;
  _edge = document.createElement('div');
  _edge.id = 'nexo-est-edge'; _edge.className = 'nx-est-edge'; _edge.setAttribute('aria-hidden', 'true');
  _edge._ids = fresh;
  document.body.appendChild(_edge);
  document.addEventListener('touchstart', _edgeHide, { passive: true, capture: true });
  document.addEventListener('mousedown', _edgeHide, { passive: true, capture: true });
  console.log('[ESTADOS] Destello del borde: ' + fresh.length + ' estado(s) nuevo(s)');
}

// ---------- El botón de Estados en la cabecera (dueño 26-11: «lo intuitivo»): el gesto sigue, pero ya hay una puerta visible ----------
function _btnInstall() {
  var header = document.getElementById('main-header');
  if (!header) return false;
  if (document.getElementById('nexo-estados-btn')) return true;
  var b = document.createElement('button');
  b.id = 'nexo-estados-btn'; b.type = 'button'; b.className = 'nx-btn-s';
  b.title = t('est_btn', 'Estados'); b.setAttribute('aria-label', t('est_btn', 'Estados'));
  // Dueño 26-11 (3160: «el símbolo no se entiende»): una FLECHA a la derecha (los estados están a la derecha de Chats) y, al tocarla, un
  // letrero breve que enseña el gesto (las 3 primeras veces; se quita solo)
  b.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h13"/><path d="M13 6l6 6-6 6"/></svg>';
  b.addEventListener('click', function(e) { e.stopPropagation(); if (!_open) { _settle(true); _btnHint(); } });
  header.appendChild(b);
  return true;
}
var BTN_HINT_KEY = 'nexo_est_btn_hint_n', BTN_HINT_MAX = 3, BTN_HINT_MS = 3500;
function _btnHint() {
  var n = 0;
  try { n = parseInt(localStorage.getItem(BTN_HINT_KEY) || '0', 10) || 0; } catch (e) {}
  if (n >= BTN_HINT_MAX) return;
  try { localStorage.setItem(BTN_HINT_KEY, String(n + 1)); localStorage.setItem(HINT_KEY, '1'); } catch (e) {} // el aviso de una vez ya no hace falta
  var old = document.getElementById('nexo-est-btnhint'); if (old) old.remove();
  var h = document.createElement('div');
  h.id = 'nexo-est-btnhint'; h.className = 'nx-est-hint nx-est-hint-top'; h.setAttribute('role', 'status');
  h.textContent = t('est_btn_hint', 'Desliza la pantalla hacia la izquierda para ver los estados');
  document.body.appendChild(h);
  setTimeout(function() { h.classList.add('out'); setTimeout(function() { try { h.remove(); } catch (e) {} }, 300); }, BTN_HINT_MS);
}
function _btnBadge() {
  var b = document.getElementById('nexo-estados-btn');
  if (b) b.classList.toggle('has-new', _edgeUnseen().length > 0);
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
  window.addEventListener('nexo:estado', function() { _render(false); setTimeout(_edgeCheck, 400); });
  window.addEventListener('nexo:ble:closeChat', function() { setTimeout(function() { _render(false); _edgeCheck(); }, 60); });
  window.addEventListener('nexo:ble:openChat', function() { _hintHide(); _edgeHide(); if (_open || _g) _closeNow(); });
  window.__nexoEstadosBack = closeEstadosScreen;   // el «atrás» de Android (chat_nav.js)
  // 3230: abrir Estados (y, con nx, ir a los de ese contacto): openStatusViewer (estados.js) y las pruebas
  window.__nexoEstadosOpen = function(nx) { if (!_open) _settle(true); if (nx) feedGoNx(nx); return _open; };
  setTimeout(function() { _hintMaybe(0); }, 1200);
  (function tryBtn(n) { if (!_btnInstall() && n < 20) setTimeout(function() { tryBtn(n + 1); }, 500); else _btnBadge(); })(0);
  window.addEventListener('nexo:estado', function() { setTimeout(_btnBadge, 300); });
  window.addEventListener('nexo:ble:closeChat', function() { setTimeout(_btnBadge, 200); });
  document.addEventListener('visibilitychange', function() { setTimeout(_btnBadge, 700); });
  setTimeout(_edgeCheck, 2500);
  document.addEventListener('visibilitychange', function() { if (document.visibilityState === 'visible') setTimeout(_edgeCheck, 600); });
  window.__nexoEdgeCheck = _edgeCheck;
}
