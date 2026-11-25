/**
 * call_gestos.js (25-11, dueño: «el zoom de dos dedos agranda TODA la pantalla, botones incluidos», «la ventanita enseña Ajustes en vez de la
 * llamada», «los botones ya no vuelven al tocar»). Los gestos de la pantalla de la videollamada 1-a-1, aparte de calls_ui.js (tope de 1000
 * líneas). Lo aprobado por el dueño:
 *   - La pantalla de la llamada NO se agranda nunca (touch-action: none: el zoom del WebView queda fuera). El zoom es solo de la IMAGEN del
 *     otro (el vídeo grande): dos dedos, de 1× a 4×, sin salirse nunca de los bordes; con zoom, un dedo la mueve. La barra de botones es una
 *     capa aparte (hermana del vídeo): ni el tamaño ni los toques del vídeo la tocan.
 *   - Un toque en el vídeo muestra / oculta la barra (se oculta sola a los 5 s). Dos toques: entera ↔ toda la pantalla; con zoom puesto,
 *     vuelve a tamaño normal. Se espera 300 ms para distinguir uno de dos (antes el doble toque hacía parpadear la barra). Dos dedos (o el
 *     toque que sigue a mover la imagen) nunca cuentan como toque.
 *   - En la ventanita del sistema (html.nx-pip) se oculta todo lo que no sea la llamada y la llamada va por encima de todo.
 *   - Al tocar, el registro dice qué marcas tiene la pantalla y si la barra se ve de verdad (getComputedStyle); fuera de la ventanita, si la
 *     barra debe verse y no se ve, se quitan las marcas sobrantes y se manda el diagnóstico «botones».
 */
import { pipApply } from './call_pip.js';

var TAP_WAIT = 300, MAX_ZOOM = 4;
var _z = { s: 1, x: 0, y: 0 }, _mirror = false;

var CSS = [
  // el zoom del WebView no actúa en la llamada (los botones siguen recibiendo su toque)
  '#nexo-call-screen,#nexo-call-screen *{touch-action:none}',
  // el zoom de la imagen gira sobre su centro (así el espejo y los bordes se calculan igual)
  '#nexo-call-screen .call-remote-video{transform-origin:50% 50% !important}',
  // ventanita del sistema: lo único que existe es la llamada, y por encima de todo (Perfil/Ajustes usan z-index 2147483646/7)
  'html.nx-pip body>*:not(#nexo-call-screen):not(#nexo-gcall-screen):not(#nexo-call2-screen){display:none !important}',
  'html.nx-pip #nexo-call-screen,html.nx-pip #nexo-gcall-screen{z-index:2147483647 !important}'
].join('\n');

function _style() {
  if (typeof document === 'undefined' || document.getElementById('nexo-call-gestos-style')) return;
  var st = document.createElement('style'); st.id = 'nexo-call-gestos-style'; st.textContent = CSS; document.head.appendChild(st);
}

/** Zoom actual (para las pruebas). */
export function zoomState() { return { s: _z.s, x: _z.x, y: _z.y }; }
/** Transformación de la imagen del otro: el zoom (si hay) y, con su cámara de delante, el espejo. */
export function peerTransform(mirror) {
  _mirror = !!mirror;
  var z = _z.s > 1.01 ? 'translate(' + _z.x + 'px,' + _z.y + 'px) scale(' + _z.s + ')' : '';
  var m = _mirror ? 'scaleX(-1)' : '';
  return (z + ' ' + m).trim() || 'none';
}
export function zoomReset() { _z = { s: 1, x: 0, y: 0 }; }

// La imagen nunca se sale de los bordes: con escala s, el desplazamiento máximo es (s-1)/2 del ancho y del alto
function _clamp(el) {
  var W = el.clientWidth || window.innerWidth, H = el.clientHeight || window.innerHeight;
  _z.s = Math.max(1, Math.min(MAX_ZOOM, _z.s));
  if (_z.s <= 1.01) { _z.s = 1; _z.x = 0; _z.y = 0; return; }
  var mx = (_z.s - 1) * W / 2, my = (_z.s - 1) * H / 2;
  _z.x = Math.max(-mx, Math.min(mx, _z.x)); _z.y = Math.max(-my, Math.min(my, _z.y));
}

/** Las marcas que tiene la pantalla (para el registro). */
export function marksText(el) {
  var cl = el.classList, r = document.documentElement.classList, out = [];
  ['nc-pipwin', 'nc-appmini', 'nc-hide', 'nc-minimized', 'nc-live'].forEach(function(c) { if (cl.contains(c)) out.push(c); });
  if (r.contains('nx-pip')) out.push('html.nx-pip');
  if (r.contains('nc-split')) out.push('html.nc-split');
  return out.join(' ') || 'ninguna'; // i18n-ok: registro
}
/** ¿La barra de botones se ve de verdad? (estilo calculado, no solo las marcas) */
export function barShown(el, soloEstilo) {
  var b = el.querySelector('.nc-bottom');
  if (!b || !b.querySelector('.nc-btn')) return true; // sin botones que enseñar no hay nada que corregir
  try {
    var cs = getComputedStyle(b), r = b.getBoundingClientRect();
    return cs.display !== 'none' && cs.visibility !== 'hidden' && cs.pointerEvents !== 'none' && (soloEstilo || parseFloat(cs.opacity) > 0.5) && r.width > 1 && r.height > 1;
  } catch (e) { return true; }
}

function _diag(info) { try { window.dispatchEvent(new CustomEvent('nexo:diag:symptom', { detail: { kind: 'botones', info: info } })); } catch (e) {} }

// Fuera de la ventanita, si la barra debe verse y no se ve, sobran marcas: se quitan (y se manda diagnóstico si fue necesario)
function _heal(el, deps, when) {
  if (!el.isConnected || !el.classList.contains('nc-live') || el.classList.contains('nc-hide') || el.classList.contains('nc-appmini')) return;
  var root = document.documentElement, real = window.innerWidth > 300 && window.innerHeight > 300; // la ventanita real es chica
  var fixed = [];
  if (real && el.classList.contains('nc-pipwin')) { el.classList.remove('nc-pipwin'); fixed.push('nc-pipwin'); }
  if (real && root.classList.contains('nx-pip')) { try { pipApply(false, 'botones sin verse'); } catch (e) { root.classList.remove('nx-pip'); } fixed.push('html.nx-pip'); } // i18n-ok: registro
  if (when === 'ya' && !fixed.length) return;
  if (barShown(el) && !fixed.length) return;
  console.warn('[CALL] Botones: la barra ' + (barShown(el) ? 'se ve' : 'NO se ve') + ' con marcas «' + marksText(el) + '»' + (fixed.length ? '; se quitaron: ' + fixed.join(', ') : '')); // i18n-ok: registro
  if (fixed.length || !barShown(el)) _diag('barra sin verse; marcas: ' + marksText(el) + (fixed.length ? '; quitadas: ' + fixed.join(', ') : '')); // i18n-ok: diagnóstico
}

/**
 * Engancha los gestos a la pantalla de la llamada (una vez).
 * deps: target() → la imagen grande del otro (o null), miniOpen(el), autoHide(el), toggleFill(el), isLive(el), apply() → vuelve a poner la transformación.
 */
export function bindCallGestures(el, deps) {
  _style();
  var g = null, pan = null, multiAt = 0, noTapUntil = 0, tapT = null;
  var apply = function() { var n = deps.target(); if (n) n.style.transform = peerTransform(_mirror); };
  var onBtn = function(e) { return !!(e.target && e.target.closest && e.target.closest('.nc-btn, .nc-pip, .nc-scrbar, #nexo-scr-ask')); };
  var d2 = function(ts) { return Math.hypot(ts[0].clientX - ts[1].clientX, ts[0].clientY - ts[1].clientY); };
  var mid = function(ts) { return { x: (ts[0].clientX + ts[1].clientX) / 2, y: (ts[0].clientY + ts[1].clientY) / 2 }; };

  el.addEventListener('touchstart', function(e) {
    if (e.touches.length >= 2) { // dos dedos: nunca es un toque; si había un toque esperando, se anula
      multiAt = Date.now(); clearTimeout(tapT); tapT = null; pan = null;
      if (!deps.isLive(el) || !deps.target()) { g = null; return; }
      g = { d: d2(e.touches), m: mid(e.touches), s: _z.s, x: _z.x, y: _z.y };
    } else if (e.touches.length === 1 && _z.s > 1.01 && deps.isLive(el) && deps.target()) {
      pan = { x0: e.touches[0].clientX, y0: e.touches[0].clientY, x: _z.x, y: _z.y, moved: false };
    }
  }, { passive: true });
  el.addEventListener('touchmove', function(e) {
    if (g && e.touches.length >= 2) {
      var s = Math.max(1, Math.min(MAX_ZOOM, g.s * d2(e.touches) / (g.d || 1))), m = mid(e.touches);
      var W = el.clientWidth || window.innerWidth, H = el.clientHeight || window.innerHeight;
      // el punto que estaba bajo los dedos sigue bajo los dedos (el zoom gira sobre el centro de la pantalla)
      _z.s = s; _z.x = m.x - W / 2 - (g.m.x - W / 2 - g.x) * s / g.s; _z.y = m.y - H / 2 - (g.m.y - H / 2 - g.y) * s / g.s;
      _clamp(el); apply(); multiAt = Date.now();
    } else if (pan && e.touches.length === 1) {
      var dx = e.touches[0].clientX - pan.x0, dy = e.touches[0].clientY - pan.y0;
      if (!pan.moved && Math.hypot(dx, dy) > 8) pan.moved = true;
      if (pan.moved) { _z.x = pan.x + dx; _z.y = pan.y + dy; _clamp(el); apply(); noTapUntil = Date.now() + 500; }
    }
  }, { passive: true });
  var end = function(e) {
    if (e.touches.length < 2 && g) { g = null; multiAt = Date.now(); }
    if (e.touches.length === 0) pan = null;
  };
  el.addEventListener('touchend', end, { passive: true });
  el.addEventListener('touchcancel', end, { passive: true });

  var single = function() {
    tapT = null;
    if (!el.isConnected || !deps.isLive(el)) return;
    el.classList.toggle('nc-hide');
    var hid = el.classList.contains('nc-hide');
    if (!hid) _heal(el, deps, 'ya');
    console.log('[CALL] Toque en la pantalla: botones ' + (hid ? 'ocultos' : 'visibles') + ' · marcas: ' + marksText(el) + ' · barra ' + (barShown(el, true) ? 'a la vista' : 'sin verse')); // 3229 (dueño 17-11: «al voltear la cámara no aparecen los botones»); i18n-ok: registro
    deps.autoHide(el);
    if (!hid) setTimeout(function() { _heal(el, deps, 'después'); }, 500); // pasada la transición de .3 s se mira lo que de verdad se ve
  };
  var lastDbl = 0;
  var dbl = function() {
    lastDbl = Date.now();
    if (_z.s > 1.01) { zoomReset(); apply(); console.log('[CALL] Dos toques: la imagen vuelve a tamaño normal'); } // i18n-ok: registro
    else deps.toggleFill(el);
  };
  // (los WebView que mandan «dblclick»: si los dos clics ya contaron como doble toque, no se repite)
  el.addEventListener('dblclick', function(e) {
    if (!deps.isLive(el) || onBtn(e) || Date.now() - lastDbl < 150 || Date.now() - multiAt < 500 || Date.now() < noTapUntil) return;
    clearTimeout(tapT); tapT = null; dbl();
  });
  el.addEventListener('click', function(e) {
    // mini flotante → pantalla completa al instante (29b: con los botones ya ocultos solos volvía sin botones; miniOpen los muestra)
    if (deps.miniOpen(el)) return;
    if (!deps.isLive(el) || onBtn(e)) {
      if (!deps.isLive(el)) console.log('[CALL] Toque en la pantalla de llamada ignorado: la llamada no está en curso'); // i18n-ok: registro
      return;
    }
    var now = Date.now();
    if (now - multiAt < 500 || now < noTapUntil) return; // dos dedos / mover la imagen: no es un toque
    if (tapT) { clearTimeout(tapT); tapT = null; dbl(); return; } // el segundo toque
    tapT = setTimeout(single, TAP_WAIT);
  });
}
