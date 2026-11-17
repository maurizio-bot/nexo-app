/**
 * NEXO Touch (build 2968, pedido del dueño 09-11) — MOTOR ÚNICO de «presionado» para toda la app.
 * Antes: `:active { transform: scale(0.92) }` repetido a mano en ~25 selectores, sin tiempos ni curvas, y `:active` en
 * el WebView llega tarde (espera a saber que no es un scroll). Ahora UN listener delegado (pointer events) hace, en el
 * mismo instante del dedo:
 *   1. HUNDIRSE: scale 0.96 (filas 0.985, redondos 0.9) en ≤70 ms, en pointerdown (no en :active). Web Animations API
 *      sobre la propiedad `scale` → no pisa los `transform` que ya tienen los botones (translateY de las cabeceras).
 *   2. VELO + ONDA: una onda circular (12 %) que nace EXACTAMENTE donde tocaste y llena el contorno en ~260 ms, acotada a la
 *      forma (border-radius heredado: no desborda a la fila de al lado; 3181: ver «la forma que se ve»).
 *   3. SOLTAR CON VIDA: vuelve en ~220 ms con un muelle suave (sobrepaso ~2 %); en los redondos un «pulso NEXO» cian que se
 *      expande y desvanece en 320 ms. El estado presionado se sostiene ≥120 ms aunque el toque sea fulminante.
 *   + LA FORMA QUE SE VE (3181, dueño 17-11: «todos los botones con la misma retroalimentación… en los de llamadas sale un cuadrado
 *     feo»): si el botón es transparente y su forma la dibuja un hijo (los de llamada: <button class="nc-btn"><span class="nc-ic">
 *     círculo</span><span>Colgar</span></button>), el hundido, la onda y el pulso van en ESE hijo (_pressShape), no en la caja del
 *     botón (antes: un rectángulo claro sobre círculo y nombre, y el pulso un óvalo). El pulso sale en todo lo que se ve redondo
 *     (por su geometría, _isRoundBox), con el radio de la forma. La onda es UNA capa con fondo redondeado por su propio
 *     border-radius y recortada en círculo con clip-path: su contorno ya no depende de que el compositor del WebView recorte en
 *     redondo una capa compuesta aparte (overflow + border-radius), que no se pudo comprobar en el teléfono.
 *   + háptica: un «tick» del sistema al presionar (haptics.js). Cancelación por deslizamiento (>12 px, touch slop de Android
 *     8 dp con margen) o scroll: se despresiona sin pulso. prefers-reduced-motion: sin escala ni onda (solo el velo, CSS).
 *   + ÁREAS DE TOQUE (hit slop): a los controles más usados se les amplía el área invisible (::before) hasta 48/56 px, SIN
 *     pisar a los vecinos (≥8 px entre áreas; si no hay lugar crece solo hacia el lado libre o el borde). Decisión pura
 *     _hitSlop, aplicada con la geometría real (applyHitAreas) al cargar, al rotar y cuando cambia el DOM.
 * Todo con transform/opacity (GPU, sin relayout): cero impacto en la radio. Pruebas: tests/sim/press.js.
 */
import { haptic } from './haptics.js';

export var PRESS_SELECTOR = 'button, [role="button"], .ble-contact-row, .attach-menu-item, .ble-menu-item, .mm-item, .sticker-cell, .nx-btn, .ble-nav-item, .game-pick-item, .nexo-pick-row, .fw-row, .input-btn, .nc-btn, .camera-btn, .nx-est-row';
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
  if (cl.contains('ble-contact-row') || cl.contains('ble-menu-item') || cl.contains('mm-item') || cl.contains('nexo-pick-row') || cl.contains('fw-row') || cl.contains('game-pick-item') || cl.contains('nx-est-row')) return 'row';
  if (cl.contains('input-btn') || cl.contains('nc-btn') || cl.contains('camera-btn') || cl.contains('ble-btn-back') || cl.contains('ble-btn-add-small') ||
      cl.contains('ble-btn-scan-round') || cl.contains('ble-btn-visibility-round') || ROUND_IDS.test(id)) return 'round';
  return 'btn';
}
// ¿Una caja (ancho, alto, radio de esquina en px) se ve redonda? Casi cuadrada y con el radio de la mitad del lado.
export function _isRoundBox(w, h, r) { return w > 0 && h > 0 && Math.abs(w - h) <= 2 && r >= Math.min(w, h) / 2 - 1; }
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
function _alpha(c) { var m = /rgba?\(([^)]+)\)/.exec(c || ''); if (!m) return c === 'transparent' || !c ? 0 : 1; var p = m[1].split(/[\s,/]+/).filter(Boolean); return p.length >= 4 ? parseFloat(p[3]) : 1; }
// ¿Pinta una superficie propia (fondo, borde o sombra)?
function _paints(cs) {
  if (!cs || cs.display === 'none' || cs.visibility === 'hidden') return false;
  if (_alpha(cs.backgroundColor) > 0.02 || (cs.backgroundImage && cs.backgroundImage !== 'none')) return true;
  if (cs.boxShadow && cs.boxShadow !== 'none') return true;
  return ['Top', 'Right', 'Bottom', 'Left'].some(function(k) { return parseFloat(cs['border' + k + 'Width']) > 0 && cs['border' + k + 'Style'] !== 'none' && _alpha(cs['border' + k + 'Color']) > 0.02; });
}
// La forma que se VE al tocar `el`: el propio botón si pinta algo; si es transparente, el hijo directo que pinta la superficie
// más grande (≥ 20 % de la caja: el círculo de un botón de llamada); si ninguno, el propio botón (texto suelto).
export function _pressShape(w, el) {
  try {
    if (!el || !w || !w.getComputedStyle || _paints(w.getComputedStyle(el))) return el;
    var er = el.getBoundingClientRect(), best = null, area = 0;
    for (var i = 0; i < el.children.length; i++) {
      var c = el.children[i];
      if (!c.getBoundingClientRect || /^svg$/i.test(c.tagName) || (c.classList && (c.classList.contains('nx-ripple') || c.classList.contains('nx-pulse')))) continue;
      var q = c.getBoundingClientRect(), a = q.width * q.height;
      if (a > area && _paints(w.getComputedStyle(c))) { best = c; area = a; }
    }
    return best && area >= 0.2 * er.width * er.height ? best : el;
  } catch (e) { return el; }
}
// ¿La forma se ve redonda? (por su geometría real; sin medidas —jsdom— no se sabe: null)
function _roundShape(w, sh) {
  try {
    var bw = sh.offsetWidth, bh = sh.offsetHeight;
    if (!(bw > 0 && bh > 0)) return null;
    var v = String(w.getComputedStyle(sh).borderTopLeftRadius || '0').split(/\s+/)[0];
    var rad = /%$/.test(v) ? parseFloat(v) / 100 * Math.min(bw, bh) : (parseFloat(v) || 0);
    return _isRoundBox(bw, bh, rad);
  } catch (e) { return null; }
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

  // La onda: UNA capa con el fondo (currentColor al 12 %) redondeado por su propio border-radius (el de la forma) y recortada en un
  // círculo que crece desde el dedo (clip-path). Así el contorno es el de la forma siempre, aunque la capa se componga aparte.
  function ripple(el, px, py, pr) {
    var sp = d.createElement('span'); sp.className = 'nx-ripple';
    el.style.setProperty('--nx-px', Math.round(px) + 'px'); el.style.setProperty('--nx-py', Math.round(py) + 'px'); el.style.setProperty('--nx-pr', pr + 'px');
    el.appendChild(sp);
    void sp.offsetWidth; // que la onda arranque desde 0 (reflow) antes de encenderla
    sp.classList.add('on');
    return sp;
  }
  function finish(c, cancelled) {
    var el = c.el, sh = c.shape || el, current = (el._nxSeq === c.seq); // si ya hay un toque más nuevo encima, este solo apaga su onda
    if (current) { el.classList.remove('is-pressed'); _animateScale(w, sh, 1, PRESS_OUT_MS, 'cubic-bezier(.34,1.56,.64,1)'); }
    if (c.ripple) { var rp = c.ripple; rp.classList.add('out'); w.setTimeout(function() { if (rp.parentNode) rp.parentNode.removeChild(rp); }, PRESS_RIPPLE_MS); }
    if (current && !cancelled && c.kind === 'round' && !_reduced(w) && sh.isConnected !== false) {
      var p = d.createElement('span'); p.className = 'nx-pulse'; sh.appendChild(p);
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
    // 3181: la forma que se ve (el botón o el círculo que dibuja su hijo); la onda nace del dedo, llevado dentro de esa forma
    var kind = _pressKind(el), sh = kind === 'row' ? el : _pressShape(w, el); // una fila es su propia forma (su velo es su fondo)
    if (kind !== 'row' && _roundShape(w, sh)) kind = 'round'; // todo lo que se ve redondo: hundido de redondo y pulso NEXO
    var r = _rect(sh), x = e.clientX || 0, y = e.clientY || 0;
    var px = Math.max(0, Math.min(r.width, x - r.left)), py = Math.max(0, Math.min(r.height, y - r.top));
    var pr = Math.ceil(Math.sqrt(Math.pow(Math.max(px, r.width - px), 2) + Math.pow(Math.max(py, r.height - py), 2))) || 24;
    _positioned(w, sh);
    el._nxSeq = (el._nxSeq || 0) + 1; // un toque nuevo sobre el mismo botón invalida el «soltar» pendiente del anterior
    el.classList.add('nx-pressable'); el.classList.add('is-pressed');
    el.style.setProperty('--nx-press-scale', String(PRESS_SCALE[kind]));
    cur = { el: el, shape: sh, id: e.pointerId, x0: x, y0: y, t0: Date.now(), kind: kind, seq: el._nxSeq, ripple: ripple(sh, px, py, pr) };
    _animateScale(w, sh, PRESS_SCALE[kind], PRESS_IN_MS, 'cubic-bezier(.2,0,0,1)');
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
