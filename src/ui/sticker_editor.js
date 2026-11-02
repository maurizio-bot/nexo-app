/**
 * NEXO — Editor de stickers (2878, pedido del dueño 01-11 «crear stickers»: foto + texto/emoji encima).
 *
 * SEGURIDAD: el sticker creado se compone en un LIENZO local y sale como una IMAGEN base64 VALIDADA (igual que la foto
 * de perfil). Viaja por el camino normal cifrado y se pinta en la burbuja como <img> (nunca innerHTML). El tope de
 * tamaño (STICKER_MAX_LEN) y el formato (STICKER_IMG_RE) los comprueba quien envía y quien recibe.
 *
 * El simulador no tiene canvas: si existe window.NEXO_makeStickerImage se usa esa (shim de tests/sim).
 */
import { addUserSticker, isValidStickerImg, STICKER_SIZE, STICKER_MAX_LEN } from './stickers.js';
import { _showInfoToast } from './ui_bits.js';
import { t } from './i18n.js';

// Compone el sticker (foto recortada cuadrada + emoji grande arriba-derecha + texto abajo tipo meme) y devuelve un
// data URL JPEG que CABE en STICKER_MAX_LEN (baja la calidad si hace falta), o '' si no se pudo.
export function buildStickerImage(opts) {
  opts = opts || {};
  if (typeof window.NEXO_makeStickerImage === 'function') { try { return window.NEXO_makeStickerImage(opts) || ''; } catch (e) { return ''; } }
  try {
    var S = STICKER_SIZE;
    var cv = document.createElement('canvas'); cv.width = cv.height = S;
    var ctx = cv.getContext('2d');
    if (!ctx) return '';
    var base = opts.baseImg;
    if (base && base.width) {
      var s = Math.min(base.width, base.height);
      ctx.drawImage(base, (base.width - s) / 2, (base.height - s) / 2, s, s, 0, 0, S, S);
    } else {
      var g = ctx.createLinearGradient(0, 0, 0, S);
      g.addColorStop(0, '#15303a'); g.addColorStop(1, '#0a1a20');
      ctx.fillStyle = g; ctx.fillRect(0, 0, S, S);
    }
    var emoji = (opts.emoji || '').trim();
    if (emoji) {
      ctx.font = Math.round(S * 0.3) + 'px serif';
      ctx.textAlign = 'right'; ctx.textBaseline = 'top';
      ctx.fillText(emoji.slice(0, 4), S - 8, 6);
    }
    var text = (opts.text || '').trim();
    if (text) {
      var fs = Math.round(S * 0.13);
      ctx.font = 'bold ' + fs + 'px sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'bottom'; ctx.lineJoin = 'round';
      ctx.lineWidth = Math.max(3, Math.round(fs * 0.22)); ctx.strokeStyle = '#000'; ctx.fillStyle = '#fff';
      ctx.strokeText(text, S / 2, S - 10, S - 12);
      ctx.fillText(text, S / 2, S - 10, S - 12);
    }
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
    var baseImg = null;   // Image cargada de la foto elegida (o null → fondo de color)

    var ov = document.createElement('div');
    ov.id = 'sticker-editor';
    ov.className = 'sticker-editor';
    var panel = document.createElement('div');
    panel.className = 'stedit-panel';
    panel.innerHTML =
      '<div class="stedit-head">' + t('sticker_create', 'Crear sticker') + '</div>' +
      '<div class="stedit-preview"><canvas id="stedit-canvas" width="' + STICKER_SIZE + '" height="' + STICKER_SIZE + '"></canvas></div>' +
      '<div class="stedit-row">' +
        '<button type="button" id="stedit-pick" class="nx-btn">' + t('sticker_pick', '📷 Elegir foto') + '</button>' +
      '</div>' +
      '<input id="stedit-text" type="text" maxlength="40" placeholder="' + t('sticker_text_ph', 'Texto (opcional)') + '" autocomplete="off" />' +
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

    function redraw() {
      // Dibuja la vista previa en el canvas visible (misma composición que buildStickerImage, sin exportar).
      try {
        var ctx = canvas.getContext('2d'); if (!ctx) return;
        var S = STICKER_SIZE; ctx.clearRect(0, 0, S, S);
        if (baseImg && baseImg.width) {
          var s = Math.min(baseImg.width, baseImg.height);
          ctx.drawImage(baseImg, (baseImg.width - s) / 2, (baseImg.height - s) / 2, s, s, 0, 0, S, S);
        } else {
          var g = ctx.createLinearGradient(0, 0, 0, S); g.addColorStop(0, '#15303a'); g.addColorStop(1, '#0a1a20');
          ctx.fillStyle = g; ctx.fillRect(0, 0, S, S);
        }
        var emoji = (elEmoji.value || '').trim();
        if (emoji) { ctx.font = Math.round(S * 0.3) + 'px serif'; ctx.textAlign = 'right'; ctx.textBaseline = 'top'; ctx.fillText(emoji.slice(0, 4), S - 8, 6); }
        var text = (elText.value || '').trim();
        if (text) {
          var fs = Math.round(S * 0.13); ctx.font = 'bold ' + fs + 'px sans-serif';
          ctx.textAlign = 'center'; ctx.textBaseline = 'bottom'; ctx.lineJoin = 'round';
          ctx.lineWidth = Math.max(3, Math.round(fs * 0.22)); ctx.strokeStyle = '#000'; ctx.fillStyle = '#fff';
          ctx.strokeText(text, S / 2, S - 10, S - 12); ctx.fillText(text, S / 2, S - 10, S - 12);
        }
      } catch (e) {}
    }

    panel.querySelector('#stedit-pick').addEventListener('click', function() { elFile.click(); });
    elFile.addEventListener('change', function() {
      var f = elFile.files && elFile.files[0]; if (!f) return;
      var r = new FileReader();
      r.onload = function() { var im = new Image(); im.onload = function() { baseImg = im; redraw(); }; im.onerror = function() {}; im.src = r.result; };
      r.readAsDataURL(f);
    });
    elText.addEventListener('input', redraw);
    elEmoji.addEventListener('input', redraw);

    panel.querySelector('#stedit-cancel').addEventListener('click', function() { closeStickerEditor(); });
    panel.querySelector('#stedit-send').addEventListener('click', function() {
      var img = buildStickerImage({ baseImg: baseImg, text: elText.value, emoji: elEmoji.value });
      if (!isValidStickerImg(img)) { try { _showInfoToast(t('sticker_fail', 'No se pudo crear el sticker'), 3000); } catch (e) {} return; }
      try { addUserSticker(img); } catch (e) {}
      closeStickerEditor();
      try { if (typeof sendFn === 'function') sendFn(cid, { img: img }); } catch (e) {}
    });

    redraw();
  } catch (e) {}
}
try { if (typeof window !== 'undefined') window.__nexoOpenStickerEditor = openStickerEditor; } catch (e) {}
