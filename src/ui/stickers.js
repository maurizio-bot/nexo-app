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

// Pack INCORPORADO (2879, pedido del dueño 01-11: los SVG planos «se ven baratos y feos» → emojis 3D con brillo y
// volumen, como su imagen de referencia). Cada sticker del pack es ahora una IMAGEN 3D empaquetada en la app
// (Microsoft Fluent Emoji 3D, licencia MIT; `nexo` es propio) en src/assets/stickers/<id>.png, que webpack copia a
// dist/assets/stickers. Por el cable sigue viajando SOLO el id; el valor es una RUTA FIJA de confianza del repo
// (jamás bytes del emisor), que se pinta como <img>. Un id desconocido → null → respaldo 🎟️.
export var STICKER_SET = Object.freeze({
  risa: 'assets/stickers/risa.png',
  feliz: 'assets/stickers/feliz.png',
  corazon_ojos: 'assets/stickers/corazon_ojos.png',
  guino: 'assets/stickers/guino.png',
  estrella: 'assets/stickers/estrella.png',
  sorpresa: 'assets/stickers/sorpresa.png',
  triste: 'assets/stickers/triste.png',
  nerd: 'assets/stickers/nerd.png',
  corazon: 'assets/stickers/corazon.png',
  fuego: 'assets/stickers/fuego.png',
  manos: 'assets/stickers/manos.png',
  ok: 'assets/stickers/ok.png',
  fiesta: 'assets/stickers/fiesta.png',
  cohete: 'assets/stickers/cohete.png',
  nexo: 'assets/stickers/nexo.png'
});

// Orden de la rejilla del selector.
export var STICKER_ORDER = ['risa', 'feliz', 'corazon_ojos', 'guino', 'estrella', 'sorpresa', 'triste', 'nerd', 'corazon', 'fuego', 'manos', 'ok', 'fiesta', 'cohete', 'nexo'];

// Devuelve la RUTA de imagen del sticker del pack (de confianza, del repo), o null si el id no existe (→ respaldo 🎟️).
// El id lo pone el emisor, pero SOLO sirve para ELEGIR entre rutas fijas conocidas (nunca se construye con su texto).
export function stickerAsset(id) {
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
// 3032 (dueño 12-11: «que si me mandan un sticker lo pueda agregar a mis stickers»): un sticker PROPIO recibido (con imagen
// validada) se agrega a los míos. Primero se carga la lista guardada (si no, se pisaría); el mismo dibujo no se repite.
// Devuelve 'added' | 'dup' | 'invalid'.
export function addReceivedSticker(img) {
  if (!isValidStickerImg(img)) return Promise.resolve('invalid');
  return loadUserStickers().then(function(list) {
    if ((list || []).some(function(x) { return x && x.img === img; })) return 'dup';
    return addUserSticker(img) ? 'added' : 'invalid';
  });
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
      var path = stickerAsset(id);
      if (!path) return;
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'sticker-cell';
      b.setAttribute('aria-label', id);
      var im = document.createElement('img'); im.src = path; im.alt = ''; b.appendChild(im); // imagen 3D del repo (ruta fija de confianza)
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
        // A5 (2982): mantener pulsado (o clic derecho) un sticker PROPIO lo borra, con confirmación. Un toque corto lo manda.
        var _held = false, _timer = null;
        var _ask = function() {
          _held = true; if (_timer) { clearTimeout(_timer); _timer = null; }
          var ok = true; try { ok = window.confirm(t('sticker_delete_confirm', '¿Borrar este sticker?')); } catch (err) {}
          if (!ok) return;
          removeUserSticker(st.id);
          if (b.parentNode) b.parentNode.removeChild(b);
        };
        b.addEventListener('pointerdown', function() { _held = false; if (_timer) clearTimeout(_timer); _timer = setTimeout(_ask, 600); });
        ['pointerup', 'pointerleave', 'pointercancel'].forEach(function(ev) { b.addEventListener(ev, function() { if (_timer) { clearTimeout(_timer); _timer = null; } }); });
        b.addEventListener('contextmenu', function(e) { e.preventDefault(); e.stopPropagation(); _ask(); });
        b.addEventListener('click', function(e) {
          e.preventDefault(); e.stopPropagation();
          if (_held) { _held = false; return; }   // el clic que sigue a una pulsación larga no manda el sticker
          closeStickerPicker();
          try { if (typeof sendFn === 'function') sendFn(cid, { img: st.img }); } catch (err) {}
        });
        grid.insertBefore(b, afterCreate);
        if (head && !head.dataset.hint) { head.dataset.hint = '1'; head.title = t('sticker_delete_hint', 'Mantén pulsado un sticker tuyo para borrarlo'); var hint = document.createElement('div'); hint.className = 'sticker-hint'; hint.textContent = head.title; panel.insertBefore(hint, grid); }
      });
    });
  } catch (e) {}
}

export function closeStickerPicker() {
  try { var ov = document.getElementById('sticker-sheet'); if (ov && ov.parentNode) ov.parentNode.removeChild(ov); } catch (e) {}
}

// Gancho de pruebas (funciones de solo lectura): tests/sim/stickers.js comprueba el mapa y el validador sin interfaz.
try { if (typeof window !== 'undefined') { window.__nexoStickerAsset = stickerAsset; window.__nexoIsValidStickerImg = isValidStickerImg; window.__nexoAddUserSticker = addUserSticker; window.__nexoOpenStickerPicker = openStickerPicker; window.__nexoUserStickers = getUserStickers; window.__nexoLoadUserStickers = loadUserStickers; } } catch (e) {}
