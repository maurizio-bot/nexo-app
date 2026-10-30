/**
 * NEXO — Stickers (ronda 2829, pedido del dueño «los stickers se deben de implementar»).
 *
 * DISEÑO SEGURO: los stickers son un PACK INCORPORADO en la app. Por el cable viaja SOLO el ID del sticker
 * (envoltorio `{type:'nexo_sticker', s:'<id>'}` por el camino normal de texto, cifrado como cualquier mensaje);
 * el dibujo es un SVG ESTÁTICO de este archivo (mapa congelado, como `_VIA_ICON` en main.js). Nunca viajan bytes
 * de imagen del remitente → sin superficie XSS, sin base64, sin archivos de vault. Un ID desconocido cae a un
 * emoji de respaldo, NUNCA a bytes crudos del emisor.
 *
 * Este módulo es una HOJA (datos + interfaz del selector); NO importa render/send para no crear ciclos. El ENVÍO
 * vive en app_setup.js (`_sendStickerTo`, junto a `_doSend`, que ya tiene la maquinaria de envío) y se pasa al
 * selector como función.
 */

import { t } from './i18n.js';

// Mapa congelado id → SVG estático (viewBox 0 0 100 100). Todo el contenido es fijo y de confianza (de este repo).
export var STICKER_SET = Object.freeze({
  feliz: '<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="46" fill="#FFD23F"/><circle cx="36" cy="43" r="6" fill="#3a2e00"/><circle cx="64" cy="43" r="6" fill="#3a2e00"/><path d="M30 60 Q50 80 70 60" stroke="#3a2e00" stroke-width="6" fill="none" stroke-linecap="round"/></svg>',
  risa: '<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="46" fill="#FFD23F"/><path d="M27 42 Q36 33 45 42" stroke="#3a2e00" stroke-width="5" fill="none" stroke-linecap="round"/><path d="M55 42 Q64 33 73 42" stroke="#3a2e00" stroke-width="5" fill="none" stroke-linecap="round"/><path d="M30 58 Q50 84 70 58 Z" fill="#3a2e00"/><path d="M22 47 Q17 59 26 62 Q31 53 22 47 Z" fill="#4FC3F7"/><path d="M78 47 Q83 59 74 62 Q69 53 78 47 Z" fill="#4FC3F7"/></svg>',
  guino: '<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="46" fill="#FFD23F"/><path d="M28 43 Q36 37 44 43" stroke="#3a2e00" stroke-width="6" fill="none" stroke-linecap="round"/><circle cx="64" cy="43" r="6" fill="#3a2e00"/><path d="M32 62 Q50 78 68 62" stroke="#3a2e00" stroke-width="6" fill="none" stroke-linecap="round"/></svg>',
  triste: '<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="46" fill="#FFD23F"/><circle cx="36" cy="42" r="6" fill="#3a2e00"/><circle cx="64" cy="42" r="6" fill="#3a2e00"/><path d="M32 70 Q50 56 68 70" stroke="#3a2e00" stroke-width="6" fill="none" stroke-linecap="round"/><path d="M36 50 Q33 62 40 64 Q44 56 36 50 Z" fill="#4FC3F7"/></svg>',
  sorpresa: '<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="46" fill="#FFD23F"/><circle cx="36" cy="42" r="7" fill="#3a2e00"/><circle cx="64" cy="42" r="7" fill="#3a2e00"/><ellipse cx="50" cy="66" rx="9" ry="12" fill="#3a2e00"/></svg>',
  corazon: '<svg viewBox="0 0 100 100"><path d="M50 86 C20 64 6 48 6 31 C6 17 17 8 29 8 C39 8 46 14 50 23 C54 14 61 8 71 8 C83 8 94 17 94 31 C94 48 80 64 50 86 Z" fill="#E53935"/></svg>',
  estrella: '<svg viewBox="0 0 100 100"><polygon points="50,8 60,36 90,37 66,55 75,84 50,67 25,84 34,55 10,37 40,36" fill="#FFC107"/></svg>',
  fuego: '<svg viewBox="0 0 100 100"><path d="M52 8 C50 30 36 30 38 50 C34 46 32 40 33 34 C22 48 24 78 50 92 C76 80 74 54 64 44 C66 52 62 56 58 54 C64 40 56 24 52 8 Z" fill="#FF7043"/><path d="M50 50 C49 62 42 62 44 74 C40 70 40 66 41 62 C35 70 38 84 50 88 C63 83 60 66 54 60 C55 66 52 68 49 66 C53 60 51 54 50 50 Z" fill="#FFCA28"/></svg>',
  ok: '<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="46" fill="#4CAF50"/><path d="M30 52 l12 13 l27 -29" stroke="#fff" stroke-width="8" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  nexo: '<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="46" fill="#0E3B43"/><path d="M33 68 L33 32 L67 68 L67 32" stroke="#19C3C9" stroke-width="6" fill="none" stroke-linecap="round" stroke-linejoin="round"/><circle cx="33" cy="68" r="7" fill="#19C3C9"/><circle cx="67" cy="32" r="7" fill="#19C3C9"/></svg>'
});

// Orden de la rejilla del selector.
export var STICKER_ORDER = ['feliz', 'risa', 'guino', 'triste', 'sorpresa', 'corazon', 'estrella', 'fuego', 'ok', 'nexo'];

// Devuelve el SVG estático de un ID, o null si no existe (el llamador cae a un emoji de respaldo, nunca a bytes del emisor).
export function stickerSvg(id) {
  if (typeof id !== 'string') return null;
  return Object.prototype.hasOwnProperty.call(STICKER_SET, id) ? STICKER_SET[id] : null;
}

// Hoja inferior con la rejilla de stickers. Al tocar uno → sendFn(cid, id) y se cierra. sendFn la da app_setup.js.
export function openStickerPicker(cid, sendFn) {
  try {
    closeStickerPicker();
    var ov = document.createElement('div');
    ov.id = 'sticker-sheet';
    ov.className = 'sticker-sheet';
    var panel = document.createElement('div');
    panel.className = 'sticker-panel';
    var head = document.createElement('div');
    head.className = 'sticker-head';
    head.textContent = t('chat_stickers_title', 'Stickers');
    panel.appendChild(head);
    var grid = document.createElement('div');
    grid.className = 'sticker-grid';
    STICKER_ORDER.forEach(function(id) {
      var svg = stickerSvg(id);
      if (!svg) return;
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'sticker-cell';
      b.setAttribute('aria-label', id);
      b.innerHTML = svg; // SVG ESTÁTICO de este repo (no viene del remitente) → seguro, igual que _VIA_ICON
      b.addEventListener('click', function(e) {
        e.preventDefault(); e.stopPropagation();
        closeStickerPicker();
        try { if (typeof sendFn === 'function') sendFn(cid, id); } catch (err) {}
      });
      grid.appendChild(b);
    });
    panel.appendChild(grid);
    ov.appendChild(panel);
    // Tocar fuera del panel cierra.
    ov.addEventListener('click', function(e) { if (e.target === ov) closeStickerPicker(); });
    document.body.appendChild(ov);
  } catch (e) {}
}

export function closeStickerPicker() {
  try { var ov = document.getElementById('sticker-sheet'); if (ov && ov.parentNode) ov.parentNode.removeChild(ov); } catch (e) {}
}

// Gancho de pruebas (función de solo lectura): tests/sim/stickers.js comprueba el mapa sin tocar la interfaz.
try { if (typeof window !== 'undefined') window.__nexoStickerSvg = stickerSvg; } catch (e) {}
