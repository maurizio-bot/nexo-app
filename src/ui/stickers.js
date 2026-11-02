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
// Rediseño 2877 (pedido del dueño 01-11 «los que existen son muy feos y básicos»): mismos ids y viewBox,
// pero con degradados, brillos, mejillas y contornos. Cada degradado lleva un id ÚNICO por sticker (prefijo
// fz_/rs_/… ) porque el selector pinta los 10 a la vez en el mismo documento (ids repetidos colisionarían).
export var STICKER_SET = Object.freeze({
  feliz: '<svg viewBox="0 0 100 100"><defs><radialGradient id="fz_f" cx="40%" cy="34%" r="72%"><stop offset="0%" stop-color="#FFEFA6"/><stop offset="55%" stop-color="#FFD23F"/><stop offset="100%" stop-color="#F2B008"/></radialGradient></defs><circle cx="50" cy="50" r="46" fill="url(#fz_f)" stroke="#E09E00" stroke-width="2"/><circle cx="33" cy="58" r="6.5" fill="#FF8FA3" opacity="0.5"/><circle cx="67" cy="58" r="6.5" fill="#FF8FA3" opacity="0.5"/><circle cx="37" cy="44" r="6.5" fill="#3A2E00"/><circle cx="63" cy="44" r="6.5" fill="#3A2E00"/><circle cx="39.4" cy="41.7" r="2.1" fill="#fff"/><circle cx="65.4" cy="41.7" r="2.1" fill="#fff"/><path d="M33 60 Q50 79 67 60" stroke="#3A2E00" stroke-width="6" fill="none" stroke-linecap="round"/></svg>',
  risa: '<svg viewBox="0 0 100 100"><defs><radialGradient id="rs_f" cx="40%" cy="34%" r="72%"><stop offset="0%" stop-color="#FFEFA6"/><stop offset="55%" stop-color="#FFD23F"/><stop offset="100%" stop-color="#F2B008"/></radialGradient></defs><circle cx="50" cy="50" r="46" fill="url(#rs_f)" stroke="#E09E00" stroke-width="2"/><path d="M26 45 Q35 35 44 45" stroke="#3A2E00" stroke-width="5" fill="none" stroke-linecap="round"/><path d="M56 45 Q65 35 74 45" stroke="#3A2E00" stroke-width="5" fill="none" stroke-linecap="round"/><path d="M30 58 Q50 86 70 58 Z" fill="#5A3410"/><path d="M35 61 Q50 71 65 61 Z" fill="#FF6E7F"/><path d="M20 49 Q14 61 24 65 Q30 56 20 49 Z" fill="#6FD0FF"/><path d="M80 49 Q86 61 76 65 Q70 56 80 49 Z" fill="#6FD0FF"/></svg>',
  guino: '<svg viewBox="0 0 100 100"><defs><radialGradient id="gu_f" cx="40%" cy="34%" r="72%"><stop offset="0%" stop-color="#FFEFA6"/><stop offset="55%" stop-color="#FFD23F"/><stop offset="100%" stop-color="#F2B008"/></radialGradient></defs><circle cx="50" cy="50" r="46" fill="url(#gu_f)" stroke="#E09E00" stroke-width="2"/><circle cx="33" cy="58" r="6" fill="#FF8FA3" opacity="0.5"/><path d="M28 46 Q37 39 45 46" stroke="#3A2E00" stroke-width="6" fill="none" stroke-linecap="round"/><circle cx="64" cy="44" r="6.5" fill="#3A2E00"/><circle cx="66.4" cy="41.7" r="2.1" fill="#fff"/><path d="M32 62 Q50 77 68 60" stroke="#3A2E00" stroke-width="6" fill="none" stroke-linecap="round"/></svg>',
  triste: '<svg viewBox="0 0 100 100"><defs><radialGradient id="tr_f" cx="40%" cy="34%" r="72%"><stop offset="0%" stop-color="#FFEFA6"/><stop offset="55%" stop-color="#FFD23F"/><stop offset="100%" stop-color="#F2B008"/></radialGradient></defs><circle cx="50" cy="50" r="46" fill="url(#tr_f)" stroke="#E09E00" stroke-width="2"/><path d="M30 41 Q37 45 44 41" stroke="#3A2E00" stroke-width="5" fill="none" stroke-linecap="round"/><path d="M56 41 Q63 45 70 41" stroke="#3A2E00" stroke-width="5" fill="none" stroke-linecap="round"/><circle cx="37" cy="50" r="5.5" fill="#3A2E00"/><circle cx="63" cy="50" r="5.5" fill="#3A2E00"/><path d="M34 72 Q50 58 66 72" stroke="#3A2E00" stroke-width="6" fill="none" stroke-linecap="round"/><path d="M37 54 Q31 69 40 73 Q47 62 37 54 Z" fill="#6FD0FF"/></svg>',
  sorpresa: '<svg viewBox="0 0 100 100"><defs><radialGradient id="sp_f" cx="40%" cy="34%" r="72%"><stop offset="0%" stop-color="#FFEFA6"/><stop offset="55%" stop-color="#FFD23F"/><stop offset="100%" stop-color="#F2B008"/></radialGradient></defs><circle cx="50" cy="50" r="46" fill="url(#sp_f)" stroke="#E09E00" stroke-width="2"/><path d="M28 34 Q37 29 46 33" stroke="#3A2E00" stroke-width="4" fill="none" stroke-linecap="round"/><path d="M54 33 Q63 29 72 34" stroke="#3A2E00" stroke-width="4" fill="none" stroke-linecap="round"/><circle cx="37" cy="45" r="6.5" fill="#3A2E00"/><circle cx="63" cy="45" r="6.5" fill="#3A2E00"/><circle cx="39.4" cy="42.7" r="2" fill="#fff"/><circle cx="65.4" cy="42.7" r="2" fill="#fff"/><ellipse cx="50" cy="68" rx="9" ry="12" fill="#5A3410"/></svg>',
  corazon: '<svg viewBox="0 0 100 100"><defs><linearGradient id="co_h" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#FF6B7A"/><stop offset="55%" stop-color="#E53935"/><stop offset="100%" stop-color="#B4152A"/></linearGradient></defs><path d="M50 86 C20 64 6 48 6 31 C6 17 17 8 29 8 C39 8 46 14 50 23 C54 14 61 8 71 8 C83 8 94 17 94 31 C94 48 80 64 50 86 Z" fill="url(#co_h)"/><path d="M26 19 Q16 25 17 37 Q24 28 33 27 Q29 20 26 19 Z" fill="#fff" opacity="0.45"/></svg>',
  estrella: '<svg viewBox="0 0 100 100"><defs><linearGradient id="es_s" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#FFE57A"/><stop offset="55%" stop-color="#FFC107"/><stop offset="100%" stop-color="#F59100"/></linearGradient></defs><polygon points="50,7 61,36 92,37 67,56 76,86 50,68 24,86 33,56 8,37 39,36" fill="url(#es_s)" stroke="#E08A00" stroke-width="1.5" stroke-linejoin="round"/><polygon points="50,19 56,37 50,47 44,37" fill="#fff" opacity="0.4"/></svg>',
  fuego: '<svg viewBox="0 0 100 100"><defs><linearGradient id="fg_o" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#FF8A3D"/><stop offset="100%" stop-color="#E53900"/></linearGradient><linearGradient id="fg_i" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#FFE23D"/><stop offset="100%" stop-color="#FF9800"/></linearGradient></defs><path d="M52 6 C50 30 34 30 37 51 C32 46 30 39 32 33 C19 49 22 80 50 94 C78 82 76 53 65 43 C67 52 62 57 57 55 C64 39 56 22 52 6 Z" fill="url(#fg_o)"/><path d="M50 50 C49 63 41 63 43 76 C38 71 38 66 40 62 C33 71 37 86 50 90 C64 85 61 66 55 60 C56 67 52 69 49 67 C53 60 51 55 50 50 Z" fill="url(#fg_i)"/></svg>',
  ok: '<svg viewBox="0 0 100 100"><defs><radialGradient id="ok_g" cx="40%" cy="34%" r="74%"><stop offset="0%" stop-color="#7BE07E"/><stop offset="60%" stop-color="#4CAF50"/><stop offset="100%" stop-color="#2E8B3C"/></radialGradient></defs><circle cx="50" cy="50" r="46" fill="url(#ok_g)" stroke="#2A7D37" stroke-width="2"/><path d="M29 52 l13 14 l29 -31" stroke="#fff" stroke-width="9" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  nexo: '<svg viewBox="0 0 100 100"><defs><radialGradient id="nx_g" cx="42%" cy="34%" r="74%"><stop offset="0%" stop-color="#16585F"/><stop offset="100%" stop-color="#0A2D34"/></radialGradient></defs><circle cx="50" cy="50" r="46" fill="url(#nx_g)" stroke="#19C3C9" stroke-width="2"/><path d="M33 68 L33 32 L67 68 L67 32" stroke="#19C3C9" stroke-width="6" fill="none" stroke-linecap="round" stroke-linejoin="round"/><circle cx="33" cy="68" r="6.5" fill="#5FEAF0"/><circle cx="67" cy="32" r="6.5" fill="#5FEAF0"/></svg>'
});

// Orden de la rejilla del selector.
export var STICKER_ORDER = ['feliz', 'risa', 'guino', 'triste', 'sorpresa', 'corazon', 'estrella', 'fuego', 'ok', 'nexo'];

// Devuelve el SVG estático de un ID, o null si no existe (el llamador cae a un emoji de respaldo, nunca a bytes del emisor).
export function stickerSvg(id) {
  if (typeof id !== 'string') return null;
  return Object.prototype.hasOwnProperty.call(STICKER_SET, id) ? STICKER_SET[id] : null;
}

// ---- Stickers PROPIOS (2878, pedido del dueño 01-11 «crear stickers»: foto + texto/emoji) ----
// A diferencia del pack, un sticker propio SÍ lleva el dibujo (imagen) para que se vea en el otro teléfono. Viaja de
// forma SEGURA, igual que la foto de perfil: imagen base64 VALIDADA (STICKER_IMG_RE) con tope de tamaño, cifrada de
// extremo a extremo por el camino normal, y pintada como <img> (NUNCA innerHTML). Un dato que no cumpla cae a 🎟️.
export var STICKER_IMG_RE = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/;
export var STICKER_MAX_LEN = 90000;   // ~67 KB como mucho por sticker (el editor comprime para caber)
export var STICKER_SIZE = 288;        // lienzo cuadrado del sticker creado
var USER_FILE = 'nexo_my_stickers.json';
var MAX_USER = 30;                     // guardamos como mucho los 30 más recientes
var _userStickers = null;              // [{ id:'u<ts>', img, ts }] (cacheado)

export function isValidStickerImg(img) { return typeof img === 'string' && img.length <= STICKER_MAX_LEN && STICKER_IMG_RE.test(img); }
function _plug() { try { return (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.NexoBLE) || null; } catch (e) { return null; } }

export function loadUserStickers() {
  if (_userStickers) return Promise.resolve(_userStickers);
  var pl = _plug();
  if (!pl || typeof pl.loadFromFile !== 'function') { _userStickers = []; return Promise.resolve(_userStickers); }
  return pl.loadFromFile({ filename: USER_FILE }).then(function(r) {
    var arr = [];
    try { if (r && r.exists && r.content) { var p = JSON.parse(r.content); if (Array.isArray(p)) arr = p.filter(function(x) { return x && isValidStickerImg(x.img); }); } } catch (e) {}
    _userStickers = arr;
    return _userStickers;
  }).catch(function() { _userStickers = []; return _userStickers; });
}
export function getUserStickers() { return _userStickers || []; }
function _saveUser() { var pl = _plug(); if (pl && typeof pl.saveToFile === 'function') { try { pl.saveToFile({ filename: USER_FILE, content: JSON.stringify(_userStickers || []) }).catch(function() {}); } catch (e) {} } }
// Añade un sticker propio (imagen ya validada por el editor). Devuelve el id, o null si la imagen no es válida.
export function addUserSticker(img) {
  if (!isValidStickerImg(img)) return null;
  if (!_userStickers) _userStickers = [];
  var id = 'u' + Date.now().toString(36);
  _userStickers.unshift({ id: id, img: img, ts: Date.now() });
  if (_userStickers.length > MAX_USER) _userStickers = _userStickers.slice(0, MAX_USER);
  _saveUser();
  return id;
}
export function removeUserSticker(id) {
  if (!_userStickers) return;
  _userStickers = _userStickers.filter(function(x) { return x.id !== id; });
  _saveUser();
}

// Hoja inferior con la rejilla de stickers. Al tocar un sticker del pack → sendFn(cid, id); un sticker PROPIO →
// sendFn(cid, {img}); la celda «+ Crear» → onCreate(). sendFn y onCreate las da app_setup.js.
export function openStickerPicker(cid, sendFn, onCreate) {
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

    // 1) Celda «+ Crear» (2878): abre el editor de stickers (foto + texto/emoji).
    var create = document.createElement('button');
    create.type = 'button';
    create.className = 'sticker-cell sticker-create';
    create.setAttribute('aria-label', t('sticker_create', 'Crear sticker'));
    create.innerHTML = '<span class="sticker-plus">+</span>';
    create.addEventListener('click', function(e) {
      e.preventDefault(); e.stopPropagation();
      closeStickerPicker();
      try { if (typeof onCreate === 'function') onCreate(); } catch (err) {}
    });
    grid.appendChild(create);

    // Marca dónde insertar los stickers propios (van tras «+ Crear», antes del pack).
    var afterCreate = create.nextSibling;

    // 2) Pack incorporado (SVG estáticos de confianza).
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

    // 3) Stickers PROPIOS (asíncrono: se cargan del vault). Se pintan como <img> (imagen validada), no innerHTML.
    loadUserStickers().then(function(list) {
      if (!document.getElementById('sticker-sheet')) return; // se cerró entre tanto
      (list || []).forEach(function(st) {
        if (!isValidStickerImg(st.img)) return;
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'sticker-cell sticker-own';
        b.setAttribute('aria-label', t('sticker_mine', 'Mi sticker'));
        var im = document.createElement('img');
        im.src = st.img;            // imagen VALIDADA (no innerHTML)
        im.alt = '';
        b.appendChild(im);
        b.addEventListener('click', function(e) {
          e.preventDefault(); e.stopPropagation();
          closeStickerPicker();
          try { if (typeof sendFn === 'function') sendFn(cid, { img: st.img }); } catch (err) {}
        });
        grid.insertBefore(b, afterCreate);
      });
    });
  } catch (e) {}
}

export function closeStickerPicker() {
  try { var ov = document.getElementById('sticker-sheet'); if (ov && ov.parentNode) ov.parentNode.removeChild(ov); } catch (e) {}
}

// Gancho de pruebas (funciones de solo lectura): tests/sim/stickers.js comprueba el mapa y el validador sin interfaz.
try { if (typeof window !== 'undefined') { window.__nexoStickerSvg = stickerSvg; window.__nexoIsValidStickerImg = isValidStickerImg; window.__nexoAddUserSticker = addUserSticker; } } catch (e) {}
