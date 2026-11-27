/**
 * NEXO — Ajustar la foto de perfil o de grupo antes de usarla (28-11, dueño: «revisa el formato de cómo se suben las fotos de perfil, grupo
 * y chat para que no se recorten tanto y suban con buena calidad»).
 * Antes: se cortaba sola al cuadrado del centro (en una foto alargada se perdía media cara) y salía a 160 px. Ahora se abre un recuadro con
 * el círculo tal como se verá: arrastrar mueve, pellizcar (o la barra) acerca y aleja. Se puede ALEJAR hasta ver la foto entera: lo que
 * queda fuera de la foto se rellena con la misma foto desenfocada (no con negro). Sale a OUT_SIZE px con buena calidad, sin pasar el tope
 * que aceptan los contactos (MAX_LEN de avatar.js y PH_MAX de group_admin.js: 60 000 caracteres).
 * Pura la parte de cuentas (cropMath/encodeSteps): prueba fotoajuste.js.
 */
import { t } from './i18n.js';

export var OUT_SIZE = 384;                       // px del resultado (antes 160: en pantallas densas se veía borrosa)
export var OUT_MAX_LEN = 60000;                  // tope de un aviso de foto (avatar.js MAX_LEN, group_admin.js PH_MAX)
export var QUALITY_STEPS = [0.9, 0.85, 0.8, 0.72, 0.64, 0.55];
var ZOOM_MAX = 5;

// Cuentas del recuadro (pura). w,h: tamaño de la foto; view: lado del círculo en pantalla. zoom 1 = la foto ENTERA cabe en el círculo
// (contain); zoomCover = lo que cubre el círculo sin huecos (lo de antes). Devuelve la escala en pantalla y los límites del arrastre.
export function cropMath(w, h, view, zoom, dx, dy) {
  var contain = view / Math.max(w, h), cover = view / Math.min(w, h);
  var zc = cover / contain;                                   // el zoom que equivale a «cubrir» (lo de antes)
  var z = Math.max(1, Math.min(ZOOM_MAX * zc, zoom || zc));
  var s = contain * z, dw = w * s, dh = h * s;
  // se puede mover mientras quede foto bajo el centro del círculo (alejada, se centra sola en el eje que sobra)
  var mx = Math.max(0, (dw - view) / 2), my = Math.max(0, (dh - view) / 2);
  return { scale: s, zoom: z, zoomCover: zc, dx: Math.max(-mx, Math.min(mx, dx || 0)), dy: Math.max(-my, Math.min(my, dy || 0)), dw: dw, dh: dh };
}

// Pinta el resultado: fondo con la foto desenfocada (cubre) y encima la foto según el recuadro
function _paint(ctx, im, size, m, view) {
  var k = size / view;
  ctx.fillStyle = '#1d2230'; ctx.fillRect(0, 0, size, size);
  if (m.dw < view || m.dh < view) {
    var cs = Math.max(size / im.width, size / im.height);
    try { ctx.filter = 'blur(' + Math.round(size / 18) + 'px) brightness(0.8)'; } catch (e) {}
    ctx.drawImage(im, (size - im.width * cs) / 2, (size - im.height * cs) / 2, im.width * cs, im.height * cs);
    try { ctx.filter = 'none'; } catch (e) {}
  }
  var w = m.dw * k, h = m.dh * k;
  ctx.drawImage(im, (size - w) / 2 + m.dx * k, (size - h) / 2 + m.dy * k, w, h);
}

// La mejor calidad que cabe en el tope (encode(q) → dataURL)
export function encodeSteps(encode, maxLen) {
  var out = '';
  for (var i = 0; i < QUALITY_STEPS.length; i++) { out = encode(QUALITY_STEPS[i]); if (out.length <= maxLen) return out; }
  return out;
}

export function renderCrop(im, m, view, size) {
  var cv = document.createElement('canvas');
  var sz = size || OUT_SIZE;
  var out = '';
  // si aun con la calidad más baja no cabe (foto con mucho detalle), se baja el tamaño
  for (var s = sz; s >= 192; s = Math.round(s * 0.8)) {
    cv.width = cv.height = s;
    var ctx = cv.getContext('2d');
    ctx.imageSmoothingEnabled = true; try { ctx.imageSmoothingQuality = 'high'; } catch (e) {}
    _paint(ctx, im, s, m, view);
    out = encodeSteps(function(q) { return cv.toDataURL('image/jpeg', q); }, OUT_MAX_LEN);
    if (out.length <= OUT_MAX_LEN) return out;
  }
  return out;
}

// Abre el recuadro. Resuelve con el dataURL listo; rechaza con code 'CANCEL' si el usuario lo cierra.
export function openAvatarCrop(im) {
  return new Promise(function(resolve, reject) {
    var doc = document, VIEW = Math.min(300, Math.round((window.innerWidth || 360) - 56));
    var box = doc.createElement('div');
    box.id = 'nexo-avatar-crop';
    box.setAttribute('role', 'dialog');
    box.style.cssText = 'position:fixed;inset:0;z-index:10050;background:rgba(0,0,0,0.92);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;padding:16px;box-sizing:border-box;touch-action:none;color:#fff;font-family:inherit;';
    var title = doc.createElement('div');
    title.textContent = t('av_crop_title', 'Ajusta la foto');
    title.style.cssText = 'font-size:18px;font-weight:600;';
    var stage = doc.createElement('div');
    stage.style.cssText = 'position:relative;width:' + VIEW + 'px;height:' + VIEW + 'px;overflow:hidden;border-radius:12px;background:#1d2230;';
    var cv = doc.createElement('canvas');
    var dpr = Math.min(3, window.devicePixelRatio || 1);
    cv.width = cv.height = Math.round(VIEW * dpr);
    cv.style.cssText = 'width:100%;height:100%;display:block;';
    var ring = doc.createElement('div'); // el círculo tal como se verá (fuera, oscurecido)
    ring.style.cssText = 'position:absolute;inset:0;border-radius:50%;box-shadow:0 0 0 999px rgba(0,0,0,0.55);border:2px solid rgba(255,255,255,0.85);pointer-events:none;';
    stage.appendChild(cv); stage.appendChild(ring);
    var hint = doc.createElement('div');
    hint.textContent = t('av_crop_hint', 'Arrastra para mover · pellizca o usa la barra para acercar o alejar');
    hint.style.cssText = 'font-size:13px;opacity:0.75;text-align:center;max-width:' + VIEW + 'px;';
    var m0 = cropMath(im.width, im.height, VIEW, 0, 0, 0);
    var st = { zoom: m0.zoomCover, dx: 0, dy: 0 };
    var range = doc.createElement('input');
    range.type = 'range'; range.min = '0'; range.max = '1000'; range.className = 'nexo-av-zoom';
    range.setAttribute('aria-label', t('av_crop_zoom', 'Acercar o alejar'));
    range.style.cssText = 'width:' + VIEW + 'px;accent-color:#ff7a1a;';
    var zMax = ZOOM_MAX * m0.zoomCover;
    var toRange = function(z) { return Math.round(1000 * Math.log(z) / Math.log(zMax)); };
    var fromRange = function(v) { return Math.exp(Math.log(zMax) * v / 1000); };
    var row = doc.createElement('div');
    row.style.cssText = 'display:flex;gap:12px;';
    var mk = function(txt, cls, primary) {
      var b = doc.createElement('button'); b.type = 'button'; b.className = cls; b.textContent = txt;
      b.style.cssText = 'min-width:120px;min-height:46px;border-radius:23px;border:' + (primary ? 'none' : '1px solid rgba(255,255,255,0.5)') + ';background:' + (primary ? '#ff7a1a' : 'transparent') + ';color:#fff;font-size:16px;font-weight:600;';
      return b;
    };
    var cancel = mk(t('cancel', 'Cancelar'), 'nexo-av-cancel', false), ok = mk(t('av_crop_use', 'Usar foto'), 'nexo-av-use', true);
    row.appendChild(cancel); row.appendChild(ok);
    box.appendChild(title); box.appendChild(stage); box.appendChild(range); box.appendChild(hint); box.appendChild(row);
    var cur = m0;
    var draw = function() {
      cur = cropMath(im.width, im.height, VIEW, st.zoom, st.dx, st.dy);
      st.zoom = cur.zoom; st.dx = cur.dx; st.dy = cur.dy;
      var ctx = cv.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      _paint(ctx, im, VIEW, cur, VIEW);
      range.value = String(toRange(st.zoom));
    };
    // arrastrar y pellizcar
    var pts = new Map(), last = null;
    var dist = function() { var a = Array.from(pts.values()); return a.length < 2 ? 0 : Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y); };
    stage.addEventListener('pointerdown', function(e) { try { stage.setPointerCapture(e.pointerId); } catch (x) {} pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); last = { d: dist(), z: st.zoom }; });
    stage.addEventListener('pointermove', function(e) {
      var p = pts.get(e.pointerId); if (!p) return;
      if (pts.size === 1) { st.dx += e.clientX - p.x; st.dy += e.clientY - p.y; }
      p.x = e.clientX; p.y = e.clientY;
      if (pts.size >= 2 && last && last.d > 0) st.zoom = last.z * dist() / last.d;
      draw();
    });
    var up = function(e) { pts.delete(e.pointerId); last = { d: dist(), z: st.zoom }; };
    stage.addEventListener('pointerup', up); stage.addEventListener('pointercancel', up);
    stage.addEventListener('wheel', function(e) { e.preventDefault(); st.zoom *= e.deltaY < 0 ? 1.08 : 1 / 1.08; draw(); }, { passive: false });
    range.addEventListener('input', function() { st.zoom = fromRange(Number(range.value)); draw(); });
    var close = function() { try { box.remove(); } catch (e) {} };
    cancel.onclick = function() { close(); reject(Object.assign(new Error('cancelado'), { code: 'CANCEL' })); }; // i18n-ok: no se muestra
    ok.onclick = function() {
      var url = '';
      try { url = renderCrop(im, cur, VIEW, OUT_SIZE); } catch (e) { close(); reject(e); return; }
      close();
      console.log('[AVATAR] Foto ajustada: ' + OUT_SIZE + ' px, ' + Math.round(url.length * 3 / 4 / 1024) + ' KB (zoom ' + (Math.round(cur.zoom / cur.zoomCover * 100) / 100) + ' de «cubrir»)');
      resolve(url);
    };
    doc.body.appendChild(box);
    draw();
  });
}
