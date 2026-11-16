/**
 * NEXO — Gestos del visor de fotos y vídeos a pantalla completa (3159). Pedidos del dueño (16-11):
 *  «cuando manden varias fotos seguido, al abrir la primera se desliza de derecha a izquierda y se debe ver la que sigue» y
 *  «para salir de las fotos y regresar al chat con deslizar hacia arriba, ya quita la x». Como WhatsApp:
 *  - DE LADO (← la siguiente, → la anterior) recorre las fotos y vídeos del chat abierto en el orden de las burbujas (propias y
 *    recibidas). La foto acompaña al dedo y la vecina asoma con lo que ya enseña su burbuja (miniatura); si el gesto es corto
 *    (< 25 % del ancho) y lento, vuelve a su sitio. En los extremos, un rebote corto. Las «ver una vez» no entran (no tienen
 *    fuente registrada) y su visor no se desliza.
 *  - ARRIBA (o abajo, para que nadie se quede atrapado) cierra el visor: la foto sube con el dedo y el fondo se aclara; si pasó
 *    ~20 % del alto o fue rápido, se cierra; si no, vuelve.
 *  - La dirección se decide con los primeros ~10 px. Con la foto AMPLIADA un dedo la arrastra (no hay gesto); dos dedos =
 *    pellizco. Un gesto que empieza sobre la barra del reproductor de vídeo es del reproductor, y uno sobre el botón de guardar
 *    (abajo a la derecha) es un toque del botón.
 * La fuente de cada burbuja (la foto original si la burbuja solo tiene la miniatura, el vídeo que aún no se leyó…) la da la MISMA
 * función que usa su toque: render.js la registra aquí con registerViewerSource.
 */
import { _releaseMedia } from './ui_bits.js';

var ANIM_MS = 200;     // paso a la vecina, vuelta a su sitio y cierre
var SLOP = 10;         // px antes de decidir la dirección del gesto
var BG = 'rgba(0,0,0,0.95)';

var _sources = new WeakMap();   // elemento de la burbuja → { type, get(cb) }
export function registerViewerSource(el, type, getSrc) {
  if (el && typeof getSrc === 'function') _sources.set(el, { type: type, get: getSrc });
}

// Fotos y vídeos del chat abierto, en el orden de las burbujas (el DOM está en orden de fecha: render.js)
export function viewerItems(fromEl) {
  var root = fromEl && fromEl.closest ? fromEl.closest('#messages-container') : null;
  if (!root) return [];
  return Array.prototype.filter.call(root.querySelectorAll('[data-fullscreen-type]'), function(el) { return _sources.has(el); });
}

export function viewerSlide() {
  var s = document.createElement('div');
  s.className = 'fs-slide';
  s.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;';
  return s;
}

function _put(sl, x, y, anim) {
  sl.style.transition = anim ? 'transform ' + ANIM_MS + 'ms ease-out' : 'none';
  sl.style.transform = 'translate3d(' + Math.round(x) + 'px,' + Math.round(y) + 'px,0)';
}
function _rubber(d) { return (d < 0 ? -1 : 1) * Math.min(60, Math.abs(d) * 0.25); }
function _zoomed(sl) { var im = sl && sl.querySelector('img'); return !!(im && Number(im.dataset.zoom || 1) > 1.02); }
// Lo que ya enseña la burbuja (la miniatura): asoma mientras se desliza y se ve hasta que llega la foto/vídeo de verdad
function _previewSrc(el) {
  if (el.tagName === 'IMG') return el.src || '';
  if (el.tagName === 'VIDEO') return el.poster || '';
  var th = el.querySelector && el.querySelector('img.video-thumb');
  return (th && th.getAttribute('src')) ? th.src : '';
}
// La barra del reproductor (abajo del vídeo): sus gestos son suyos (avanzar, volumen…)
function _onPlayerBar(target, t) {
  if (!target || target.tagName !== 'VIDEO' || !target.controls || !t) return false;
  var r = target.getBoundingClientRect();
  return t.clientY >= r.bottom - Math.min(64, r.height * 0.35);
}
// Hora del toque: la de cuando se generó (e.timeStamp), no la de cuando se atiende; si el hilo se atasca y llegan varios movimientos
// de golpe, un arrastre lento no parece un tirón
function _ts(e) { return (e && e.timeStamp > 0) ? e.timeStamp : Date.now(); }
function _speed(p, tEnd) {
  var b = p[p.length - 1], a = p[0];
  if (tEnd - b.t > 100) return { x: 0, y: 0 };            // el dedo se paró antes de soltar: no es un tirón
  for (var i = p.length - 2; i >= 0; i--) { a = p[i]; if (b.t - a.t >= 80) break; }
  var dt = Math.max(1, b.t - a.t);
  return { x: (b.x - a.x) / dt, y: (b.y - a.y) / dt };
}

// o: { slide (la del medio, ya con su foto/vídeo), el (burbuja de la que se abrió; null = no se desliza de lado: «ver una vez»,
// foto de un contacto…), show(slide, src, type, el) (pone la foto/vídeo y su botón de guardar), leave() (quita el botón de guardar
// de la que se deja), close() }
export function viewerGestures(ov, o) {
  var cur = { slide: o.slide, el: o.el || null };
  var g = null, busy = false, seq = 0, counter = null;
  var W = function() { return ov.clientWidth || window.innerWidth || 1; };
  var H = function() { return ov.clientHeight || window.innerHeight || 1; };
  var items = function() { return cur.el ? viewerItems(cur.el) : []; };
  var chrome = function(a) { Array.prototype.forEach.call(ov.querySelectorAll('.fs-save-btn,.fs-counter'), function(b) { b.style.opacity = String(a); }); };
  // Contador discreto arriba al centro («3 / 7»), solo si hay más de una
  var updateCounter = function() {
    var l = items(), i = l.indexOf(cur.el);
    if (l.length > 1 && i >= 0) {
      if (!counter) {
        counter = document.createElement('div');
        counter.className = 'fs-counter';
        counter.style.cssText = 'position:absolute;top:calc(24px + env(safe-area-inset-top,0px));left:50%;transform:translateX(-50%);color:#fff;font-size:14px;font-weight:600;opacity:0.8;letter-spacing:0.5px;z-index:5001;pointer-events:none;text-shadow:0 1px 3px rgba(0,0,0,0.6);';
        ov.appendChild(counter);
      }
      counter.textContent = (i + 1) + ' / ' + l.length;
    } else if (counter) { counter.remove(); counter = null; }
  };
  updateCounter();
  var drop = function(nb) { if (nb && nb.slide) { _releaseMedia(nb.slide); nb.slide.remove(); } };
  var neighbor = function(step) {
    var key = step > 0 ? 'next' : 'prev';
    if (Object.prototype.hasOwnProperty.call(g, key)) return g[key];
    var l = items(), i = l.indexOf(cur.el), el = i >= 0 ? l[i + step] : null;
    if (!el) { g[key] = null; return null; }
    var sl = viewerSlide();
    var pv = _previewSrc(el);
    if (pv) {
      var im = document.createElement('img');
      im.className = 'fs-preview'; im.alt = ''; im.src = pv;
      im.style.cssText = 'width:95vw;height:85vh;object-fit:contain;border-radius:8px;pointer-events:none;';
      sl.appendChild(im);
    }
    _put(sl, step * W(), 0, false);
    ov.insertBefore(sl, cur.slide);
    g[key] = { el: el, slide: sl, step: step };
    return g[key];
  };
  var dragH = function(dx) {
    var nb = dx < 0 ? neighbor(1) : (dx > 0 ? neighbor(-1) : null);
    var x = (nb || dx === 0) ? dx : _rubber(dx);         // en el extremo: rebote corto
    _put(cur.slide, x, 0, false);
    if (g.next) _put(g.next.slide, W() + x, 0, false);
    if (g.prev) _put(g.prev.slide, -W() + x, 0, false);
  };
  var dragV = function(dy) {
    var k = Math.min(1, Math.abs(dy) / (H() * 0.5));
    _put(cur.slide, 0, dy, false);
    ov.style.transition = 'none';
    ov.style.background = 'rgba(0,0,0,' + (0.95 * (1 - 0.75 * k)).toFixed(3) + ')';
    chrome(1 - k);
  };
  // Vuelve a su sitio (gesto corto, o se cortó)
  var back = function(gg) {
    _put(cur.slide, 0, 0, true);
    if (gg.next) _put(gg.next.slide, W(), 0, true);
    if (gg.prev) _put(gg.prev.slide, -W(), 0, true);
    if (gg.dir === 'v') { ov.style.transition = 'background ' + ANIM_MS + 'ms ease-out'; ov.style.background = BG; chrome(1); }
    setTimeout(function() { drop(gg.next); drop(gg.prev); }, ANIM_MS + 20);
  };
  // Pasa a la vecina: la foto/vídeo de verdad se pide YA (con la misma función que el toque de su burbuja) y se pone al acabar el paso
  var go = function(gg, nb) {
    busy = true;
    var old = cur.slide, other = nb === gg.next ? gg.prev : gg.next;
    Array.prototype.forEach.call(old.querySelectorAll('video,audio'), function(m) { try { m.pause(); } catch (e) {} });
    if (o.leave) o.leave();
    _put(old, -nb.step * W(), 0, true);
    _put(nb.slide, 0, 0, true);
    cur = { slide: nb.slide, el: nb.el };
    updateCounter();
    var my = ++seq, src = null, animDone = false;
    var info = _sources.get(nb.el);
    var maybeShow = function() {
      if (src === null || !animDone || my !== seq || !ov.isConnected) return;
      if (src) o.show(nb.slide, src, info.type, nb.el);   // sin fuente (vídeo borrado del teléfono) queda la miniatura
    };
    if (info) info.get(function(s) { src = s || ''; maybeShow(); });
    setTimeout(function() {
      _releaseMedia(old); old.remove(); drop(other);   // el vídeo que se deja se para y se libera, como al cerrar
      busy = false; animDone = true; maybeShow();
    }, ANIM_MS + 20);
  };
  // Cierra con la foto saliendo hacia donde iba el dedo
  var shut = function(gg) {
    busy = true;
    Array.prototype.forEach.call(ov.querySelectorAll('video,audio'), function(m) { try { m.pause(); } catch (e) {} });
    _put(cur.slide, 0, (gg.dy < 0 ? -1 : 1) * H(), true);
    ov.style.transition = 'opacity ' + ANIM_MS + 'ms linear';
    ov.style.opacity = '0';
    setTimeout(function() { if (ov.isConnected) o.close(); }, ANIM_MS + 20);
  };
  var abort = function() { var gg = g; g = null; if (gg && gg.dir) back(gg); };

  ov.addEventListener('touchstart', function(e) {
    var t = e.touches || [];
    if (g) abort();                                   // un segundo dedo: es pellizco, no deslizar
    if (busy || t.length !== 1 || _zoomed(cur.slide) || _onPlayerBar(e.target, t[0])) return;
    if (e.target && e.target.closest && e.target.closest('button')) return;   // sobre el botón de guardar: es un toque, no un gesto
    g = { x0: t[0].clientX, y0: t[0].clientY, dir: '', dx: 0, dy: 0, pts: [{ t: _ts(e), x: t[0].clientX, y: t[0].clientY }] };
  }, { passive: true });
  ov.addEventListener('touchmove', function(e) {
    if (!g) return;
    var t = e.touches || [];
    if (t.length !== 1) { abort(); return; }
    var x = t[0].clientX, y = t[0].clientY, dx = x - g.x0, dy = y - g.y0;
    if (!g.dir) {
      if (Math.abs(dx) < SLOP && Math.abs(dy) < SLOP) return;
      if (_zoomed(cur.slide)) { g = null; return; }   // se amplió entre medias (doble toque)
      g.dir = Math.abs(dx) > Math.abs(dy) ? 'h' : 'v';
    }
    if (e.cancelable) e.preventDefault();
    g.dx = dx; g.dy = dy;
    g.pts.push({ t: _ts(e), x: x, y: y });
    if (g.pts.length > 8) g.pts.shift();
    if (g.dir === 'h') dragH(dx); else dragV(dy);
  }, { passive: false });
  ov.addEventListener('touchend', function(e) {
    if (!g || (e.touches && e.touches.length)) return;
    var gg = g; g = null;
    if (!gg.dir) return;                              // un toque: nada (el doble toque lo lleva la foto)
    var v = _speed(gg.pts, _ts(e));
    if (gg.dir === 'h') {
      var nb = gg.dx < 0 ? gg.next : gg.prev;
      var fast = Math.abs(v.x) > 0.5 && (v.x < 0) === (gg.dx < 0) && Math.abs(gg.dx) > 30;
      if (nb && (Math.abs(gg.dx) >= 0.25 * W() || fast)) go(gg, nb); else back(gg);
    } else {
      var fastV = Math.abs(v.y) > 0.6 && (v.y < 0) === (gg.dy < 0) && Math.abs(gg.dy) > 40;
      if (Math.abs(gg.dy) >= 0.2 * H() || fastV) shut(gg); else back(gg);
    }
  });
  ov.addEventListener('touchcancel', function() { abort(); });
}
