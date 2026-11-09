/**
 * NEXO Touch (build 2968, pedido del dueño 09-11) — MOTOR ÚNICO de «presionado» para toda la app.
 * Antes: `:active { transform: scale(0.92) }` repetido a mano en ~25 selectores, sin tiempos ni curvas, y `:active` en
 * el WebView llega tarde (espera a saber que no es un scroll). Ahora UN listener delegado (pointer events) hace, en el
 * mismo instante del dedo:
 *   1. HUNDIRSE: scale 0.96 (filas 0.985, redondos 0.9) en ≤70 ms, en pointerdown (no en :active). Web Animations API
 *      sobre la propiedad `scale` → no pisa los `transform` que ya tienen los botones (translateY de las cabeceras).
 *   2. VELO + ONDA: una onda circular (12 %) que nace EXACTAMENTE donde tocaste y llena el contorno en ~260 ms, acotada al
 *      elemento (contenedor con overflow:hidden y border-radius heredado: no desborda a la fila de al lado).
 *   3. SOLTAR CON VIDA: vuelve en ~220 ms con un muelle suave (sobrepaso ~2 %); en los redondos un «pulso NEXO» cian que se
 *      expande y desvanece en 320 ms. El estado presionado se sostiene ≥120 ms aunque el toque sea fulminante.
 *   + háptica: un «tick» del sistema al presionar (haptics.js). Cancelación por deslizamiento (>12 px, touch slop de Android
 *     8 dp con margen) o scroll: se despresiona sin pulso. prefers-reduced-motion: sin escala ni onda (solo el velo, CSS).
 *   + ÁREAS DE TOQUE (hit slop): a los controles más usados se les amplía el área invisible (::before) hasta 48/56 px, SIN
 *     pisar a los vecinos (≥8 px entre áreas; si no hay lugar crece solo hacia el lado libre o el borde). Decisión pura
 *     _hitSlop, aplicada con la geometría real (applyHitAreas) al cargar, al rotar y cuando cambia el DOM.
 * Todo con transform/opacity (GPU, sin relayout): cero impacto en la radio. Pruebas: tests/sim/press.js.
 */
import { haptic } from './haptics.js';

export var PRESS_SELECTOR = 'button, [role="button"], .ble-contact-row, .attach-menu-item, .ble-menu-item, .mm-item, .sticker-cell, .nx-btn, .ble-nav-item, .game-pick-item, .nexo-pick-row, .fw-row, .input-btn, .nc-btn, .camera-btn';
export var PRESS_SLOP_PX = 12;        // touch slop de Android = 8 dp, con margen
export var PRESS_MIN_HOLD_MS = 120;   // el ojo necesita verlo aunque el toque sea fulminante
export var PRESS_IN_MS = 70, PRESS_OUT_MS = 220, PRESS_RIPPLE_MS = 320, PRESS_PULSE_MS = 320;
export var PRESS_SCALE = { round: 0.9, row: 0.985, btn: 0.96 };
export var HIT_MIN_GAP = 8;
// Controles a los que se les amplía el área de toque (tamaño objetivo en px). Lo del pulgar y en serie → 56 (Parhi 2006: 9,2–9,6 mm ≈ 58 dp).
export var HIT_TARGETS = [
  { sel: '#send-btn', size: 56 }, { sel: '#attach-btn', size: 56 }, { sel: '#chat-back-btn', size: 56 }, { sel: '.ble-btn-back', size: 56 },
  { sel: '#nexo-profile-btn', size: 48 }, { sel: '#nexo-new-group-btn', size: 48 }, { sel: '#nexo-call-btn', size: 48 }, { sel: '#nexo-video-btn', size: 48 },
  { sel: '#nexo-gcall-btn', size: 48 }, { sel: '#nexo-gvideo-btn', size: 48 }, { sel: '#nexo-search-btn', size: 48 }, { sel: '#nexo-lock-btn', size: 48 },
  { sel: '.ble-btn-add-small', size: 48 }
];

// ---------- decisiones PURAS (testeables sin DOM) ----------
export function _pressMoved(x0, y0, x1, y1, slop) {
  var s = (typeof slop === 'number') ? slop : PRESS_SLOP_PX, dx = (x1 || 0) - (x0 || 0), dy = (y1 || 0) - (y0 || 0);
  return (dx * dx + dy * dy) > s * s;
}
export function _pressReleaseDelay(downAtMs, nowMs, minHold) {
  var d = ((typeof minHold === 'number') ? minHold : PRESS_MIN_HOLD_MS) - (nowMs - downAtMs);
  return d > 0 ? d : 0;
}
var ROUND_IDS = /^(chat-back-btn|nexo-(profile|new-group|call|video|gcall|gvideo|search|lock)-btn|camera-btn-[a-z]+)$/;
export function _pressKind(el) {
  var cl = (el && el.classList) || { contains: function() { return false; } }, id = (el && el.id) || '';
  if (cl.contains('ble-contact-row') || cl.contains('ble-menu-item') || cl.contains('mm-item') || cl.contains('nexo-pick-row') || cl.contains('fw-row') || cl.contains('game-pick-item')) return 'row';
  if (cl.contains('input-btn') || cl.contains('nc-btn') || cl.contains('camera-btn') || cl.contains('ble-btn-back') || cl.contains('ble-btn-add-small') ||
      cl.contains('ble-btn-scan-round') || cl.contains('ble-btn-visibility-round') || ROUND_IDS.test(id)) return 'round';
  return 'btn';
}
// Área de toque: cuánto crece cada lado (l,r,t,b) para llegar a `size`, sin pasar del contenedor ni pisar a un vecino
// (gap mínimo). Si un lado está trabado, el resto se reparte al lado libre (el borde de la pantalla es «infinito»).
export function _hitSlop(rect, bounds, neighbors, size, minGap) {
  var gap = (typeof minGap === 'number') ? minGap : HIT_MIN_GAP;
  var wantW = Math.max(0, size - rect.width), wantH = Math.max(0, size - rect.height);
  var freeL = rect.left - bounds.left, freeR = bounds.right - rect.right, freeT = rect.top - bounds.top, freeB = bounds.bottom - rect.bottom;
  (neighbors || []).forEach(function(n) {
    if (!n) return;
    var sameRow = n.bottom > rect.top && n.top < rect.bottom, sameCol = n.right > rect.left && n.left < rect.right;
    if (sameRow) {
      if (n.right <= rect.left) freeL = Math.min(freeL, rect.left - n.right - gap);
      if (n.left >= rect.right) freeR = Math.min(freeR, n.left - rect.right - gap);
    }
    if (sameCol) {
      if (n.bottom <= rect.top) freeT = Math.min(freeT, rect.top - n.bottom - gap);
      if (n.top >= rect.bottom) freeB = Math.min(freeB, n.top - rect.bottom - gap);
    }
  });
  var split = function(want, fa, fb) {
    fa = Math.max(0, fa); fb = Math.max(0, fb);
    var a = Math.min(want / 2, fa), b = Math.min(want / 2, fb), d = want - a - b;
    if (d > 0) { var ea = Math.min(d, fa - a); a += ea; d -= ea; if (d > 0) b += Math.min(d, fb - b); }
    return [Math.round(a), Math.round(b)];
  };
  var lr = split(wantW, freeL, freeR), tb = split(wantH, freeT, freeB);
  return { l: lr[0], r: lr[1], t: tb[0], b: tb[1] };
}

// ---------- motor (DOM) ----------
var _docs = []; // documentos ya inicializados (la app tiene uno; las pruebas, varios)
function _rect(el) { var r = el.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height }; }
function _reduced(w) { try { return !!(w && w.matchMedia && w.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) { return false; } }
function _positioned(w, el) {
  try { var p = w.getComputedStyle(el).position; if (!p || p === 'static') el.style.position = 'relative'; } catch (e) { if (!el.style.position) el.style.position = 'relative'; }
}
function _findPressable(target) {
  var el = (target && target.closest) ? target.closest(PRESS_SELECTOR) : null;
  if (!el) return null;
  if (el.disabled || el.getAttribute('aria-disabled') === 'true' || el.closest('[data-nopress]')) return null;
  return el;
}
function _animateScale(w, el, to, ms, easing) {
  if (!el.animate || _reduced(w)) return;
  try {
    if (el._nxAnim) { try { el._nxAnim.cancel(); } catch (e) {} }
    var from = el._nxScale || 1;
    el._nxAnim = el.animate([{ scale: String(from) }, { scale: String(to) }], { duration: ms, easing: easing, fill: 'forwards' });
    el._nxScale = to;
    if (to === 1) el._nxAnim.onfinish = function() { try { el._nxAnim.cancel(); } catch (e) {} el._nxAnim = null; el._nxScale = 1; };
  } catch (e) {}
}
export function markPressables(doc) {
  var d = doc || document, n = 0;
  Array.prototype.forEach.call(d.querySelectorAll(PRESS_SELECTOR), function(el) { if (!el.classList.contains('nx-pressable')) { el.classList.add('nx-pressable'); n++; } });
  return n;
}
// Aplica las áreas de toque con la geometría REAL (vecinos = todo lo interactivo cercano; contenedor = offsetParent ∩ ventana).
export function applyHitAreas(doc) {
  var d = doc || document, w = d.defaultView || window;
  if (!d.body) return 0;
  var vw = w.innerWidth || 360, vh = w.innerHeight || 800;
  var all = Array.prototype.slice.call(d.querySelectorAll(PRESS_SELECTOR + ', input, textarea, select, a[href]'));
  var rects = [];
  all.forEach(function(el) { var r = _rect(el); if (r.width > 0 && r.height > 0) rects.push({ el: el, r: r }); });
  var n = 0;
  HIT_TARGETS.forEach(function(t) {
    Array.prototype.forEach.call(d.querySelectorAll(t.sel), function(el) {
      var me = _rect(el); if (!(me.width > 0 && me.height > 0)) return;
      var par = el.offsetParent || el.parentElement, pr = (par && par.getBoundingClientRect) ? _rect(par) : null;
      var bounds = (pr && pr.width > 0) ? { left: Math.max(0, pr.left), right: Math.min(vw, pr.right), top: Math.max(0, pr.top), bottom: Math.min(vh, pr.bottom) } : { left: 0, right: vw, top: 0, bottom: vh };
      var neigh = [];
      rects.forEach(function(x) { if (x.el === el || el.contains(x.el) || x.el.contains(el)) return; if (Math.abs(x.r.top - me.top) > 160 && Math.abs(x.r.left - me.left) > 160) return; neigh.push(x.r); });
      var s = _hitSlop(me, bounds, neigh, t.size);
      _positioned(w, el);
      el.classList.add('nx-hit');
      el.style.setProperty('--hs-t', s.t + 'px'); el.style.setProperty('--hs-r', s.r + 'px');
      el.style.setProperty('--hs-b', s.b + 'px'); el.style.setProperty('--hs-l', s.l + 'px');
      n++;
    });
  });
  return n;
}

export function initPress(doc) {
  var d = doc || (typeof document !== 'undefined' ? document : null);
  if (!d || _docs.indexOf(d) >= 0) return false;
  _docs.push(d);
  var w = d.defaultView || window;
  var cur = null, hitTimer = null, markTimer = null;

  function ripple(el, px, py, pr) {
    var sp = d.createElement('span'); sp.className = 'nx-ripple';
    var i = d.createElement('i'); sp.appendChild(i);
    el.style.setProperty('--nx-px', Math.round(px) + 'px'); el.style.setProperty('--nx-py', Math.round(py) + 'px'); el.style.setProperty('--nx-pr', pr + 'px');
    el.appendChild(sp);
    void sp.offsetWidth; // que la onda arranque desde 0 (reflow) antes de encenderla
    sp.classList.add('on');
    return sp;
  }
  function finish(c, cancelled) {
    var el = c.el, current = (el._nxSeq === c.seq); // si ya hay un toque más nuevo encima, este solo apaga su onda
    if (current) { el.classList.remove('is-pressed'); _animateScale(w, el, 1, PRESS_OUT_MS, 'cubic-bezier(.34,1.56,.64,1)'); }
    if (c.ripple) { var rp = c.ripple; rp.classList.add('out'); w.setTimeout(function() { if (rp.parentNode) rp.parentNode.removeChild(rp); }, PRESS_RIPPLE_MS); }
    if (current && !cancelled && c.kind === 'round' && !_reduced(w)) {
      var p = d.createElement('span'); p.className = 'nx-pulse'; el.appendChild(p);
      w.setTimeout(function() { if (p.parentNode) p.parentNode.removeChild(p); }, PRESS_PULSE_MS + 40);
    }
  }
  function release(cancelled) {
    var c = cur; if (!c) return; cur = null;
    var delay = cancelled ? 0 : _pressReleaseDelay(c.t0, Date.now());
    if (delay > 0) w.setTimeout(function() { finish(c, false); }, delay); else finish(c, cancelled);
  }
  function onDown(e) {
    if (e.button != null && e.button > 0) return;
    var el = _findPressable(e.target); if (!el) return;
    if (cur) release(true);
    var r = _rect(el), x = e.clientX || 0, y = e.clientY || 0, px = x - r.left, py = y - r.top;
    var pr = Math.ceil(Math.sqrt(Math.pow(Math.max(px, r.width - px), 2) + Math.pow(Math.max(py, r.height - py), 2))) || 24;
    var kind = _pressKind(el);
    _positioned(w, el);
    el._nxSeq = (el._nxSeq || 0) + 1; // un toque nuevo sobre el mismo botón invalida el «soltar» pendiente del anterior
    el.classList.add('nx-pressable'); el.classList.add('is-pressed');
    el.style.setProperty('--nx-press-scale', String(PRESS_SCALE[kind]));
    cur = { el: el, id: e.pointerId, x0: x, y0: y, t0: Date.now(), kind: kind, seq: el._nxSeq, ripple: ripple(el, px, py, pr) };
    _animateScale(w, el, PRESS_SCALE[kind], PRESS_IN_MS, 'cubic-bezier(.2,0,0,1)');
    haptic('tick');
  }
  function onMove(e) {
    if (!cur || (e.pointerId != null && cur.id != null && e.pointerId !== cur.id)) return;
    if (_pressMoved(cur.x0, cur.y0, e.clientX || 0, e.clientY || 0)) release(true);
  }
  function onUp(e) { if (!cur || (e.pointerId != null && cur.id != null && e.pointerId !== cur.id)) return; release(false); }
  function onCancel() { if (cur) release(true); }
  function scheduleHit() { if (hitTimer) w.clearTimeout(hitTimer); hitTimer = w.setTimeout(function() { hitTimer = null; try { applyHitAreas(d); } catch (e) {} }, 250); }
  function scheduleMark() { if (markTimer) return; markTimer = w.setTimeout(function() { markTimer = null; try { markPressables(d); } catch (e) {} scheduleHit(); }, 120); }

  d.addEventListener('pointerdown', onDown, { capture: true, passive: true });
  d.addEventListener('pointermove', onMove, { capture: true, passive: true });
  d.addEventListener('pointerup', onUp, { capture: true, passive: true });
  d.addEventListener('pointercancel', onCancel, { capture: true, passive: true });
  d.addEventListener('scroll', onCancel, { capture: true, passive: true });
  w.addEventListener('blur', onCancel);
  w.addEventListener('resize', scheduleHit);
  w.addEventListener('orientationchange', scheduleHit);
  var start = function() {
    try { markPressables(d); } catch (e) {}
    scheduleHit();
    if (w.MutationObserver && d.body) { try { new w.MutationObserver(scheduleMark).observe(d.body, { childList: true, subtree: true }); } catch (e) {} }
  };
  if (d.readyState === 'loading') d.addEventListener('DOMContentLoaded', start); else start();
  return true;
}
