/**
 * NEXO — Editor de stickers (2878; 2881: arrastrar texto/emoji y que NO se recorten, pedido del dueño).
 *
 * El usuario elige una foto y le pone texto y/o un emoji que puede ARRASTRAR con el dedo a donde quiera; el texto se
 * parte en líneas y, si hace falta, se achica para que SIEMPRE quepa (nunca se corta); ambos se mantienen dentro del
 * borde. La vista previa es el MISMO lienzo que se exporta (WYSIWYG): lo que ves es lo que se manda.
 *
 * SEGURIDAD (sin cambios): el sticker creado sale como IMAGEN base64 VALIDADA (STICKER_IMG_RE, tope STICKER_MAX_LEN),
 * cifrada como cualquier mensaje y pintada como <img> (nunca innerHTML). El simulador no tiene canvas: si existe
 * window.NEXO_makeStickerImage se usa esa (shim de tests/sim).
 */
import { addUserSticker, isValidStickerImg, STICKER_SIZE, STICKER_MAX_LEN } from './stickers.js';
import { _showInfoToast } from './ui_bits.js';
import { t } from './i18n.js';

function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

function wrapLines(ctx, text, maxW) {
  var words = String(text).split(/\s+/).filter(Boolean);
  var lines = [], cur = '';
  for (var i = 0; i < words.length; i++) {
    var tryLine = cur ? cur + ' ' + words[i] : words[i];
    if (!cur || ctx.measureText(tryLine).width <= maxW) { cur = tryLine; }
    else { lines.push(cur); cur = words[i]; }
  }
  if (cur) lines.push(cur);
  return lines;
}

// Dibuja el sticker en ctx (lienzo S×S) con la foto de fondo + emoji (en emojiPos) + texto (en textPos, partido y
// achicado si hace falta, con contorno). Clampa todo dentro del borde (no se recorta). Devuelve las cajas (coords del
// lienzo) de texto y emoji para poder arrastrarlos (hit-test). opts: {baseImg, text, emoji, textPos:{x,y}, emojiPos:{x,y}}.
function drawSticker(ctx, S, o) {
  ctx.clearRect(0, 0, S, S);
  var base = o.baseImg;
  if (base && base.width) {
    var s = Math.min(base.width, base.height);
    ctx.drawImage(base, (base.width - s) / 2, (base.height - s) / 2, s, s, 0, 0, S, S);
  } else {
    var g = ctx.createLinearGradient(0, 0, 0, S); g.addColorStop(0, '#15303a'); g.addColorStop(1, '#0a1a20');
    ctx.fillStyle = g; ctx.fillRect(0, 0, S, S);
  }
  var pad = Math.round(S * 0.04);
  var boxes = { textBox: null, emojiBox: null };

  var emoji = (o.emoji || '').trim();
  if (emoji) {
    var ef = Math.round(S * 0.26);
    ctx.font = ef + 'px serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    var ehalf = ef / 2;
    var ecx = clamp((o.emojiPos ? o.emojiPos.x : 0.8) * S, pad + ehalf, S - pad - ehalf);
    var ecy = clamp((o.emojiPos ? o.emojiPos.y : 0.2) * S, pad + ehalf, S - pad - ehalf);
    ctx.fillText(emoji.slice(0, 4), ecx, ecy);
    boxes.emojiBox = { cx: ecx, cy: ecy, w: ef, h: ef };
  }

  var text = (o.text || '').trim();
  if (text) {
    var maxW = S - pad * 2;
    var fs = Math.round(S * 0.12), lines = [], lh = 0, blockW = 0, blockH = 0;
    for (;;) {
      ctx.font = 'bold ' + fs + 'px sans-serif';
      lines = wrapLines(ctx, text, maxW);
      lh = fs * 1.16;
      blockH = lines.length * lh;
      blockW = 0; for (var k = 0; k < lines.length; k++) blockW = Math.max(blockW, ctx.measureText(lines[k]).width);
      if ((blockH <= S - pad * 2 && blockW <= maxW) || fs <= Math.round(S * 0.055)) break;
      fs -= 2;
    }
    ctx.font = 'bold ' + fs + 'px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round'; ctx.lineWidth = Math.max(3, Math.round(fs * 0.22)); ctx.strokeStyle = '#000'; ctx.fillStyle = '#fff';
    var cx = clamp((o.textPos ? o.textPos.x : 0.5) * S, pad + blockW / 2, S - pad - blockW / 2);
    var cy = clamp((o.textPos ? o.textPos.y : 0.82) * S, pad + blockH / 2, S - pad - blockH / 2);
    var startY = cy - blockH / 2 + lh / 2;
    for (var i = 0; i < lines.length; i++) {
      var ly = startY + i * lh;
      ctx.strokeText(lines[i], cx, ly); ctx.fillText(lines[i], cx, ly);
    }
    boxes.textBox = { cx: cx, cy: cy, w: blockW, h: blockH };
  }
  return boxes;
}

// Compone el sticker y devuelve un data URL JPEG que CABE en STICKER_MAX_LEN (baja la calidad si hace falta), o ''.
export function buildStickerImage(opts) {
  opts = opts || {};
  if (typeof window.NEXO_makeStickerImage === 'function') { try { return window.NEXO_makeStickerImage(opts) || ''; } catch (e) { return ''; } }
  try {
    var S = STICKER_SIZE;
    var cv = document.createElement('canvas'); cv.width = cv.height = S;
    var ctx = cv.getContext('2d'); if (!ctx) return '';
    drawSticker(ctx, S, {
      baseImg: opts.baseImg, text: opts.text, emoji: opts.emoji,
      textPos: opts.textPos || { x: 0.5, y: 0.82 }, emojiPos: opts.emojiPos || { x: 0.8, y: 0.2 }
    });
    var q = [0.82, 0.62, 0.45, 0.3], out = '';
    for (var i = 0; i < q.length; i++) { out = cv.toDataURL('image/jpeg', q[i]); if (out.length <= STICKER_MAX_LEN) break; }
    return out && out.length <= STICKER_MAX_LEN ? out : '';
  } catch (e) { return ''; }
}
try { if (typeof window !== 'undefined') window.__nexoBuildStickerImage = buildStickerImage; } catch (e) {}

export function closeStickerEditor() {
  try { var ov = document.getElementById('sticker-editor'); if (ov && ov.parentNode) ov.parentNode.removeChild(ov); } catch (e) {}
}

// Abre el editor. Al enviar: compone → guarda en el vault de propios → sendFn(cid, {img}) y cierra.
export function openStickerEditor(cid, sendFn) {
  try {
    closeStickerEditor();
    // Estado: foto de fondo y posiciones (normalizadas 0..1) del texto y el emoji, arrastrables.
    var st = { baseImg: null, text: '', emoji: '', textPos: { x: 0.5, y: 0.82 }, emojiPos: { x: 0.8, y: 0.2 } };

    var ov = document.createElement('div');
    ov.id = 'sticker-editor';
    ov.className = 'sticker-editor';
    var panel = document.createElement('div');
    panel.className = 'stedit-panel';
    panel.innerHTML =
      '<div class="stedit-head">' + t('sticker_create', 'Crear sticker') + '</div>' +
      '<div class="stedit-preview"><canvas id="stedit-canvas" width="' + STICKER_SIZE + '" height="' + STICKER_SIZE + '"></canvas></div>' +
      '<div class="stedit-hint">' + t('sticker_drag_hint', 'Arrastra el texto y el emoji para moverlos') + '</div>' +
      '<div class="stedit-row">' +
        '<button type="button" id="stedit-pick" class="nx-btn">' + t('sticker_pick', '📷 Elegir foto') + '</button>' +
      '</div>' +
      '<input id="stedit-text" type="text" maxlength="60" placeholder="' + t('sticker_text_ph', 'Texto (opcional)') + '" autocomplete="off" />' +
      '<input id="stedit-emoji" type="text" maxlength="4" placeholder="' + t('sticker_emoji_ph', 'Emoji (opcional)') + '" autocomplete="off" />' +
      '<div class="stedit-actions">' +
        '<button type="button" id="stedit-cancel" class="nx-btn">' + t('cancel', 'Cancelar') + '</button>' +
        '<button type="button" id="stedit-send" class="nx-btn nx-btn-primary">' + t('sticker_send', 'Enviar') + '</button>' +
      '</div>' +
      '<input id="stedit-file" type="file" accept="image/*" style="display:none;" />';
    ov.appendChild(panel);
    document.body.appendChild(ov);

    var canvas = panel.querySelector('#stedit-canvas');
    var elText = panel.querySelector('#stedit-text');
    var elEmoji = panel.querySelector('#stedit-emoji');
    var elFile = panel.querySelector('#stedit-file');
    var boxes = { textBox: null, emojiBox: null };

    function redraw() {
      try { var ctx = canvas.getContext('2d'); if (!ctx) return; boxes = drawSticker(ctx, STICKER_SIZE, st); } catch (e) {}
    }
    // Punto del evento → coordenadas del lienzo (el canvas se muestra más chico que su tamaño interno S).
    function toCanvas(e) {
      var r = canvas.getBoundingClientRect();
      var scale = r.width ? (STICKER_SIZE / r.width) : 1;
      return { x: (e.clientX - r.left) * scale, y: (e.clientY - r.top) * scale };
    }
    function inBox(p, b, m) { return b && Math.abs(p.x - b.cx) <= b.w / 2 + m && Math.abs(p.y - b.cy) <= b.h / 2 + m; }

    var drag = null;
    canvas.addEventListener('pointerdown', function(e) {
      var p = toCanvas(e), m = STICKER_SIZE * 0.04;
      if (inBox(p, boxes.emojiBox, m)) drag = { t: 'emoji', dx: p.x - boxes.emojiBox.cx, dy: p.y - boxes.emojiBox.cy };
      else if (inBox(p, boxes.textBox, m)) drag = { t: 'text', dx: p.x - boxes.textBox.cx, dy: p.y - boxes.textBox.cy };
      else drag = null;
      if (drag) { e.preventDefault(); try { canvas.setPointerCapture(e.pointerId); } catch (x) {} }
    });
    canvas.addEventListener('pointermove', function(e) {
      if (!drag) return; e.preventDefault();
      var p = toCanvas(e);
      var nx = clamp((p.x - drag.dx) / STICKER_SIZE, 0, 1), ny = clamp((p.y - drag.dy) / STICKER_SIZE, 0, 1);
      if (drag.t === 'emoji') st.emojiPos = { x: nx, y: ny }; else st.textPos = { x: nx, y: ny };
      redraw();
    });
    function endDrag(e) { drag = null; try { canvas.releasePointerCapture(e.pointerId); } catch (x) {} }
    canvas.addEventListener('pointerup', endDrag);
    canvas.addEventListener('pointercancel', endDrag);

    panel.querySelector('#stedit-pick').addEventListener('click', function() { elFile.click(); });
    elFile.addEventListener('change', function() {
      var f = elFile.files && elFile.files[0]; if (!f) return;
      var r = new FileReader();
      r.onload = function() { var im = new Image(); im.onload = function() { st.baseImg = im; redraw(); }; im.onerror = function() {}; im.src = r.result; };
      r.readAsDataURL(f);
    });
    elText.addEventListener('input', function() { st.text = elText.value; redraw(); });
    elEmoji.addEventListener('input', function() { st.emoji = elEmoji.value; redraw(); });

    panel.querySelector('#stedit-cancel').addEventListener('click', function() { closeStickerEditor(); });
    panel.querySelector('#stedit-send').addEventListener('click', function() {
      var img = buildStickerImage({ baseImg: st.baseImg, text: st.text, emoji: st.emoji, textPos: st.textPos, emojiPos: st.emojiPos });
      if (!isValidStickerImg(img)) { try { _showInfoToast(t('sticker_fail', 'No se pudo crear el sticker'), 3000); } catch (e) {} return; }
      try { addUserSticker(img); } catch (e) {}
      closeStickerEditor();
      try { if (typeof sendFn === 'function') sendFn(cid, { img: img }); } catch (e) {}
    });

    redraw();
  } catch (e) {}
}
try { if (typeof window !== 'undefined') window.__nexoOpenStickerEditor = openStickerEditor; } catch (e) {}
