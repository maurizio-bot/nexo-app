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
  nexo: 'assets/stickers/nexo.png',   // ya no sale en la rejilla (dueño 13-11: «quitando la N»); se sigue viendo si llega
  // 3035 (dueño 13-11: «agregando más caritas … 🥰😍🤩🫡🤔😒😫🤬😋😘🤤»; 😍 = corazon_ojos y 🤩 = estrella ya estaban)
  carinosa: 'assets/stickers/carinosa.png',     // 🥰
  saludo: 'assets/stickers/saludo.png',         // 🫡
  pensando: 'assets/stickers/pensando.png',     // 🤔
  fastidio: 'assets/stickers/fastidio.png',     // 😒
  cansado: 'assets/stickers/cansado.png',       // 😫
  furia: 'assets/stickers/furia.png',           // 🤬
  rico: 'assets/stickers/rico.png',             // 😋
  beso: 'assets/stickers/beso.png',             // 😘
  babeo: 'assets/stickers/babeo.png'            // 🤤
});

// Orden de la rejilla del selector.
// 3035: sin «nexo» (la N) y con las caritas nuevas junto a las demás caras; los objetos al final.
export var STICKER_ORDER = ['risa', 'feliz', 'carinosa', 'corazon_ojos', 'estrella', 'beso', 'guino', 'rico', 'babeo', 'sorpresa', 'pensando', 'saludo', 'nerd', 'fastidio', 'triste', 'cansado', 'furia', 'corazon', 'fuego', 'manos', 'ok', 'fiesta', 'cohete'];

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
// 3213 (dueño 17-11: «los stickers se deben poder hacer con videos; obviamente se reducen al tamaño del sticker y deben tener un
// límite de tiempo elegible con un tope de segundos máximos (5 por ejemplo)»): sticker de VIDEO = clip WebM cuadrado, sin sonido, de
// hasta 5 s, que se repite solo. Viaja como el de foto (dato validado, con tope de tamaño, cifrado por el camino normal) y se pinta
// como <video> silenciado desde un blob: (la CSP solo deja blob: para medios; nunca innerHTML). Un dato que no cumpla → 🎟️.
export var STICKER_VID_RE = /^data:video\/webm;base64,[A-Za-z0-9+/]+=*$/;
export var STICKER_VID_MAX_LEN = 150000; // ~110 KB como mucho (el editor baja la calidad para caber)
export var STICKER_VID_MAX_S = 5;        // tope de segundos (el dueño: «5 por ejemplo»); se elige de 1 a 5
export var STICKER_VID_SIZE = 256;       // lado del clip (cuadrado)
export function isValidStickerVid(v) { return typeof v === 'string' && v.length <= STICKER_VID_MAX_LEN && STICKER_VID_RE.test(v); }
var _vidUrls = new Map();                // clave corta del clip → blob: (el mismo sticker repetido en el chat no se vuelve a decodificar)
function _vidKey(v) { return v.length + ':' + v.slice(-48); }
export function stickerVideoUrl(vid) {
  if (!isValidStickerVid(vid)) return '';
  var k = _vidKey(vid), u = _vidUrls.get(k);
  if (u) return u;
  try {
    var bin = atob(vid.slice(vid.indexOf(',') + 1)), a = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
    u = URL.createObjectURL(new Blob([a], { type: 'video/webm' }));
  } catch (e) { return ''; }
  _vidUrls.set(k, u);
  if (_vidUrls.size > 60) { var old = _vidUrls.keys().next().value; try { URL.revokeObjectURL(_vidUrls.get(old)); } catch (e) {} _vidUrls.delete(old); }
  return u;
}
// <video> del sticker: silenciado, en bucle, sin controles; si el clip no trae duración (WebM grabado), el bucle se hace a mano
export function stickerVideoEl(vid) {
  var u = stickerVideoUrl(vid);
  if (!u) return null;
  var v = document.createElement('video');
  v.muted = true; v.defaultMuted = true; v.loop = true; v.autoplay = true; v.playsInline = true;
  ['muted', 'loop', 'autoplay', 'playsinline'].forEach(function(a) { v.setAttribute(a, ''); });
  v.className = 'sticker-vid';
  v.addEventListener('ended', function() { try { v.currentTime = 0; var p = v.play(); if (p && p.catch) p.catch(function() {}); } catch (e) {} });
  v.src = u;
  try { var p = v.play(); if (p && p.catch) p.catch(function() {}); } catch (e) {}
  return v;
}
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
    try { if (r && r.exists && r.content) { var p = JSON.parse(r.content); if (Array.isArray(p)) arr = p.filter(function(x) { return x && (isValidStickerImg(x.img) || isValidStickerVid(x.vid)); }); } } catch (e) {}
    _userStickers = arr;
    return _userStickers;
  }).catch(function() { _userStickers = []; return _userStickers; });
}
export function getUserStickers() { return _userStickers || []; }
function _saveUser() { var pl = _plug(); if (pl && typeof pl.saveToFile === 'function') { try { pl.saveToFile({ filename: USER_FILE, content: JSON.stringify(_userStickers || []) }).catch(function() {}); } catch (e) {} } }
// Añade un sticker propio (imagen ya validada por el editor). Devuelve el id, o null si la imagen no es válida.
export function addUserSticker(img) {
  if (!isValidStickerImg(img)) return null;
  return _addUser({ img: img });
}
// 3213: un sticker de VIDEO propio (clip validado)
export function addUserVideoSticker(vid) {
  if (!isValidStickerVid(vid)) return null;
  return _addUser({ vid: vid });
}
function _addUser(it) {
  if (!_userStickers) _userStickers = [];
  var id = 'u' + Date.now().toString(36);
  _userStickers.unshift(Object.assign({ id: id, ts: Date.now() }, it));
  if (_userStickers.length > MAX_USER) _userStickers = _userStickers.slice(0, MAX_USER);
  _saveUser();
  return id;
}
// 3032 (dueño 12-11: «que si me mandan un sticker lo pueda agregar a mis stickers»): un sticker PROPIO recibido (con imagen
// validada) se agrega a los míos. Primero se carga la lista guardada (si no, se pisaría); el mismo dibujo no se repite.
// Devuelve 'added' | 'dup' | 'invalid'.
export function addReceivedSticker(img, vid) {
  // 3213: también uno de VIDEO (addReceivedSticker(null, vid))
  if (!isValidStickerImg(img) && !isValidStickerVid(vid)) return Promise.resolve('invalid');
  return loadUserStickers().then(function(list) {
    if ((list || []).some(function(x) { return x && (img ? x.img === img : x.vid === vid); })) return 'dup';
    return (img ? addUserSticker(img) : addUserVideoSticker(vid)) ? 'added' : 'invalid';
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
        var isVid = !isValidStickerImg(st.img) && isValidStickerVid(st.vid);
        if (!isValidStickerImg(st.img) && !isVid) return;
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'sticker-cell sticker-own';
        b.setAttribute('aria-label', t('sticker_mine', 'Mi sticker'));
        var im = isVid ? stickerVideoEl(st.vid) : document.createElement('img');
        if (!im) return;
        if (!isVid) { im.src = st.img; im.alt = ''; } // imagen VALIDADA (no innerHTML)
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
          try { if (typeof sendFn === 'function') sendFn(cid, isVid ? { vid: st.vid } : { img: st.img }); } catch (err) {}
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
try { if (typeof window !== 'undefined') { window.__nexoStickerAsset = stickerAsset; window.__nexoIsValidStickerImg = isValidStickerImg; window.__nexoAddUserSticker = addUserSticker; window.__nexoOpenStickerPicker = openStickerPicker; window.__nexoUserStickers = getUserStickers; window.__nexoLoadUserStickers = loadUserStickers; window.__nexoIsValidStickerVid = isValidStickerVid; } } catch (e) {}
