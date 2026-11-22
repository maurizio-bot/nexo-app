/**
 * wallpaper.js — Fondo de pantalla (pedido del dueño 02-11).
 *  • Lista de contactos (nexo_wp_list.json) — global, local.
 *  • Chats (nexo_wp_chat.json) — global para TODOS los chats, local.
 *  • Fondo POR chat concreto (nexo_wp_c_<NEXO ID>.json, ronda 2890): se elige desde la cabecera del chat (botón 🖼️,
 *    «opción A» del dueño) y manda sobre el global de chats SOLO en ese chat. Con opción a COMPARTIRLO al otro
 *    teléfono (el dueño: «compartido, con opción a compartir»): acción oculta cifrada E2E (nexo_act act:'wp', como la
 *    foto de perfil), el otro lo guarda y lo aplica SOLO a ese chat. Compartir es a PROPÓSITO (no automático).
 * Todo se guarda cifrado en reposo (plugin loadFromFile/saveToFile) y se pinta en el fondo del contenedor #app (no
 * hace scroll; la cabecera y la barra de escribir, opacas, lo tapan donde toca), con un oscurecido para que el texto
 * y las burbujas se lean sobre cualquier foto. Sin fondo elegido, negro liso (como antes).
 * COLA 30 (dueño 21-11): TODAS las pantallas con fondo se cambian igual que un chat — pulsación larga (~0,8 s) sobre un espacio
 * LIBRE abre el mismo menú: lista de chats (nexo_wp_list.json), llamada/videollamada, Perfil y Ajustes (un archivo por pantalla:
 * nexo_wp_s_<pantalla>.json). Un solo detector en `document` (installScreenGestures) + un observador que pinta las pantallas
 * que se crean al abrirse. Los grupos no entran aquí.
 */
import { t } from './i18n.js';
import { _normId, _getBLEContacts } from './ble_helpers.js';
import { _sendTextTo } from './send.js';
import { vaultDeleteMessage } from '../vault/vault_manager.js';

var LIST_FILE = 'nexo_wp_list.json', CHAT_FILE = 'nexo_wp_chat.json';
function CHATP_FILE(nx) { return 'nexo_wp_c_' + nx + '.json'; }   // fondo por chat concreto
var IMG_RE = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/;
var NX_RE = /^nx[0-9a-z]{8}$/;
var CHAT_RE = /^(nx|gr)[0-9a-z]{8}$/;   // 22-11 (COLA 4b, G7): el fondo por chat vale también para un grupo (su id gr…)
var MAX_LEN = 1400000;    // ~1 MB de imagen como mucho (las nuestras: 100–400 KB)
var MAX_EDGE = 1280;      // lado mayor al que se reduce la foto elegida (fondos globales, SOLO locales: no se comparten)
// #dueño 08-11 (fondo compartido no aparecía en la tablet): el fondo POR chat se COMPARTE (acción oculta cifrada E2E). Por
// internet, un evento de relé no puede pasar de ~60 KB (MAX_CONTENT en net_link.js) o se DESCARTA → el fondo de 520 KB nunca
// llegaba por internet (p.ej. a una tablet en otra red: «no apareció»; NO era un tema de dimensiones, el pintado usa
// background-size:cover y se adapta solo). Ahora se achica para que, ya CIFRADO (AES-GCM + base64 ~×1,33), entre bajo ese
// tope y llegue por CUALQUIER camino (Bluetooth, Wi-Fi o internet). Es un fondo oscurecido al 50 %: la menor resolución no se nota.
var NET_MAX = 60000;                       // tope de un evento de relé (igual que MAX_CONTENT en net_link.js)
var SHARE_EDGE = 720, SHARE_LEN = 40000;   // ~40 KB de data URL → cifrado ~53 KB, entra bajo NET_MAX con margen
var DIM = 0.5;            // oscurecido del fondo (0 = foto tal cual, 1 = negro) para que se lea el texto encima

// ¿Un contenido de `plainLen` chars entra por internet una vez CIFRADO? El relé mira el tamaño YA cifrado (iv + AES-GCM, luego
// base64 ≈ ×4/3, +~28 B de iv/tag). Pura y exportada: prueba wpnet.js. Con esto el fondo compartido (SHARE_LEN) cae bajo NET_MAX.
export function _encFitsNet(plainLen, netMax) {
  return Math.ceil(((plainLen || 0) + 28) * 4 / 3) <= (netMax || NET_MAX);
}
export function wpShareLimits() { return { edge: SHARE_EDGE, len: SHARE_LEN, netMax: NET_MAX }; } // para la prueba

var _list = '';           // data URL o '' (sin fondo)
var _chat = '';           // fondo global de chats
var _per = new Map();      // NEXO ID -> data URL (fondo por chat concreto; '' = sin fondo propio)
var _curNx = '';           // contacto del chat abierto ahora (para pintar y para el botón)
var _applied = '';         // lo que está pintado ahora mismo (para el simulador; el navegador real pinta #app)
var _outIds = new Map();    // id de la copia oculta compartida -> NEXO ID (se borra al entregarse)
var _scr = { call: '', profile: '', settings: '' };   // fondo por pantalla (COLA 30): llamada, Perfil, Ajustes
var SCR_SEL = { call: '#nexo-call-screen .nc-bg', profile: '#nexo-profile-sheet', settings: '#nexo-settings-sheet' };
function SCR_FILE(k) { return 'nexo_wp_s_' + k + '.json'; }
var _started = false;
var _showInfoToast = function () {};

// [pegamento] main.js da el aviso (toast) al arrancar
export function wallpaperUse(d) { if (d && typeof d._showInfoToast === 'function') _showInfoToast = d._showInfoToast; } // [/pegamento]

function _pl() { return (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.NexoBLE) || null; }
function _load(name) {
  var pl = _pl();
  if (!pl || typeof pl.loadFromFile !== 'function') return Promise.resolve(null);
  return pl.loadFromFile({ filename: name }).then(function(r) { return r && r.exists && r.content ? JSON.parse(r.content) : null; }).catch(function() { return null; });
}
function _save(name, obj) { var pl = _pl(); if (pl && typeof pl.saveToFile === 'function') pl.saveToFile({ filename: name, content: JSON.stringify(obj) }).catch(function() {}); }
function _hash(s) { var h = 2166136261; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h.toString(36); }

function _inChat() { try { return document.body.classList.contains('chat-view-active'); } catch (e) { return false; } }
// El fondo que corresponde a un chat: el propio del contacto si lo tiene, si no el global de chats.
function _chatImgFor(nx) { return (nx && _per.get(nx)) || _chat; }
// Nombre del contacto para los avisos (si no está en la agenda, el NEXO ID en mayúsculas).
function _nameOf(nx) {
  try {
    var c = _getBLEContacts().find(function (x) { return _normId(x.nexoId || x.deviceUUID) === _normId(nx); });
    return (c && c.name) || String(nx || '').toUpperCase();
  } catch (e) { return String(nx || '').toUpperCase(); }
}

// Pinta el fondo en un elemento (con el oscurecido). #dueño 04-11: el tema pone `background:transparent!important` en #app y
// en las hojas de Perfil/Ajustes; el inline-important le gana al stylesheet-important. Al quitar, removeProperty devuelve el tema.
function _paintEl(el, img) {
  if (!el) return;
  var ok = !!(img && IMG_RE.test(img));
  el.setAttribute('data-nexo-wp', ok ? _hash(img) : '');   // para el simulador (jsdom no aplica bien la cascada)
  if (ok) {
    el.style.setProperty('background-image', 'linear-gradient(rgba(0,0,0,' + DIM + '),rgba(0,0,0,' + DIM + ')),url("' + img + '")', 'important');
    el.style.setProperty('background-size', 'cover', 'important');
    el.style.setProperty('background-position', 'center', 'important');
    el.style.setProperty('background-repeat', 'no-repeat', 'important');
  } else {
    el.style.removeProperty('background-image');   // vuelve al gradiente del tema (body::before) / negro liso
    el.style.removeProperty('background-size');
    el.style.removeProperty('background-position');
    el.style.removeProperty('background-repeat');
  }
}
// Pinta el fondo en #app (no hace scroll; la cabecera y la barra de escribir, opacas, lo tapan donde toca).
function _paint(img) {
  _applied = (img && IMG_RE.test(img)) ? img : '';
  var app;
  try { app = document.getElementById('app'); } catch (e) { app = null; }
  _paintEl(app, img);
}

// Carga perezosa del fondo por chat de un contacto (una sola lectura; cachea '' si no tiene).
function _ensurePer(nx) {
  if (!nx || _per.has(nx)) return Promise.resolve((_per.get(nx)) || '');
  return _load(CHATP_FILE(nx)).then(function(o) {
    var img = (o && typeof o.img === 'string' && IMG_RE.test(o.img)) ? o.img : '';
    // No pisar un valor puesto mientras tanto (el usuario eligió/recibió un fondo antes de que terminara la lectura)
    if (!_per.has(nx)) _per.set(nx, img);
    return _per.get(nx) || '';
  });
}

// Vuelve a pintar según la pantalla en la que estemos ahora.
export function wallpaperRefresh() { _paint(_inChat() ? _chatImgFor(_curNx) : _list); }

export function wallpaperInit() {
  if (_started) return;
  _started = true;
  Promise.all([_load(LIST_FILE), _load(CHAT_FILE)]).then(function(r) {
    if (r[0] && typeof r[0].img === 'string' && IMG_RE.test(r[0].img)) _list = r[0].img;
    if (r[1] && typeof r[1].img === 'string' && IMG_RE.test(r[1].img)) _chat = r[1].img;
    wallpaperRefresh();
  });
  Object.keys(_scr).forEach(function(k) {
    _load(SCR_FILE(k)).then(function(o) {
      if (o && typeof o.img === 'string' && IMG_RE.test(o.img) && !_scr[k]) { _scr[k] = o.img; _paintScreens(); }
    });
  });
  installScreenGestures();
  // Al entrar a un chat: pinta el global de chats al instante y, si ese contacto tiene fondo propio, lo cambia.
  window.addEventListener('nexo:ble:openChat', function(e) {
    // #dueño 04-11: aceptar las dos formas del evento — {contactId} (el camino normal, ble_interface) y {contact}
    // (un camino de respaldo de main.js que mandaba el objeto); si no, _curNx quedaba '' y el botón no salía.
    var d = (e && e.detail) || {};
    _curNx = _normId(d.contactId || (d.contact && (d.contact.nexoId || d.contact.deviceUUID || d.contact.id)) || '');
    _paint(_chat);
    var nx = _curNx;
    _ensurePer(nx).then(function() { if (_curNx === nx) _paint(_chatImgFor(nx)); });
    installWallpaperGesture(); // re-asegura el gesto de pulsación larga por si no se instaló al arrancar (idempotente)
    _refreshButton();
  });
  window.addEventListener('nexo:ble:closeChat', function() { _curNx = ''; _paint(_list); _refreshButton(); });
  // El fondo por chat COMPARTIDO: cuando se entrega la copia oculta, se borra del vault (como la foto de perfil).
  window.addEventListener('nexo:ble:ackStatus', function(e) {
    var d = e && e.detail, nx = d && _outIds.get(d.msgId);
    if (nx && (d.status === 'delivered' || d.status === 'read')) { _outIds.delete(d.msgId); vaultDeleteMessage(nx, d.msgId).catch(function() {}); }
  });
}

export function hasListWallpaper() { return !!_list; }
export function hasChatWallpaper() { return !!_chat; }
export function wallpaperApplied() { return _applied; } // solo para tests/sim (determinista, sin depender del CSS de jsdom)

export function setListWallpaper(dataUrl) {
  if (!IMG_RE.test(dataUrl || '') || dataUrl.length > MAX_LEN) return false;
  _list = dataUrl; _save(LIST_FILE, { img: dataUrl }); wallpaperRefresh(); return true;
}
export function clearListWallpaper() { _list = ''; _save(LIST_FILE, { img: '' }); wallpaperRefresh(); }
export function setChatWallpaper(dataUrl) {
  if (!IMG_RE.test(dataUrl || '') || dataUrl.length > MAX_LEN) return false;
  _chat = dataUrl; _save(CHAT_FILE, { img: dataUrl }); wallpaperRefresh(); return true;
}
export function clearChatWallpaper() { _chat = ''; _save(CHAT_FILE, { img: '' }); wallpaperRefresh(); }

// ===== Fondo POR chat concreto (ronda 2890) =====
export function chatWallpaperFor(nx) { return _per.get(_normId(nx)) || ''; }
export function hasChatWallpaperFor(nx) { return !!chatWallpaperFor(nx); }
export function setChatWallpaperFor(nx, dataUrl) {
  nx = _normId(nx);
  if (!CHAT_RE.test(nx) || !IMG_RE.test(dataUrl || '') || dataUrl.length > MAX_LEN) return false;
  _per.set(nx, dataUrl); _save(CHATP_FILE(nx), { img: dataUrl });
  if (_curNx === nx) _paint(dataUrl);
  return true;
}
export function clearChatWallpaperFor(nx) {
  nx = _normId(nx);
  if (!CHAT_RE.test(nx)) return;
  _per.set(nx, ''); _save(CHATP_FILE(nx), { img: '' });
  if (_curNx === nx) _paint(_chat);   // vuelve al global de chats (o negro si no hay)
}
// Compartir el fondo de ESTE chat con el contacto (a propósito): acción oculta cifrada E2E, como la foto de perfil.
export function shareChatWallpaper(nx) {
  nx = _normId(nx);
  var img = chatWallpaperFor(nx);
  if (!NX_RE.test(nx) || !img) return false;
  var id = _sendTextTo(nx, JSON.stringify({ type: 'nexo_act', act: 'wp', h: _hash(img), img: img }), '', true);
  if (!id) return false;
  _outIds.set(id, nx);
  console.log('[WP] Fondo del chat compartido con ' + nx);
  return true;
}
// Lo que llega de un contacto (chat_actions._applyChatAction): aplica el fondo a SU chat.
export function applyChatWallpaper(sender, act) {
  var nx = _normId(sender), img = (act && typeof act.img === 'string') ? act.img : '';
  if (!NX_RE.test(nx) || (img && (!IMG_RE.test(img) || img.length > MAX_LEN))) return;
  _per.set(nx, img);
  _save(CHATP_FILE(nx), { img: img });
  var here = (_curNx === nx);
  if (here) _paint(img || _chat);   // si estoy en ese chat, se ve al instante (por _curNx, sin depender de la clase del body)
  // #dueño 04-11: antes se aplicaba EN SILENCIO (y solo repintaba si justo estabas en ese chat). El fondo llegaba
  // bien (el diagnóstico lo confirma) pero el dueño creía que «no funcionaba» porque no veía nada. Ahora: aviso
  // visible siempre, y si no estás en ese chat, te dice que lo abras para verlo (ya está guardado, lo pinta al abrir).
  try {
    _showInfoToast('🖼️ ' + _nameOf(nx) + ' ' +
      (img ? t('wp_shared_in', 'compartió el fondo de este chat') : t('wp_removed_in', 'quitó el fondo de este chat')) +
      (here ? '' : t('wp_open_to_see', ' — abrí el chat para verlo')), 4200);
  } catch (e) {}
  console.log('[WP] Fondo de chat ' + (img ? 'recibido' : 'quitado') + ' de ' + nx);
}

// Reduce la foto elegida (lado mayor maxEdge, JPEG) para no cargar el fondo con una imagen enorme.
// El simulador no tiene canvas: window.NEXO_makeWallpaper.
export function makeWallpaper(file, maxEdge, maxLen) {
  maxEdge = maxEdge || MAX_EDGE; maxLen = maxLen || MAX_LEN;
  if (typeof window.NEXO_makeWallpaper === 'function') return Promise.resolve(window.NEXO_makeWallpaper(file, maxEdge, maxLen));
  return new Promise(function(resolve, reject) {
    var r = new FileReader();
    r.onerror = function() { reject(new Error(t('misc_avatar_read_fail', 'no se pudo leer la foto'))); };
    r.onload = function() {
      var im = new Image();
      im.onerror = function() { reject(new Error(t('misc_avatar_not_image', 'no es una imagen'))); };
      im.onload = function() {
        var w = im.width || 1, h = im.height || 1;
        var edge = maxEdge, out = '';
        // #dueño 08-11: GARANTIZAR que el resultado quepa en maxLen. Primero se baja la calidad; si ni con la calidad mínima
        // entra (foto muy cargada), se ACHICA el lado y se reintenta. Antes solo bajaba la calidad y un fondo compartido podía
        // quedar por encima del tope de internet (y se descartaba al viajar). El lado no baja de ~360 px (un fondo oscurecido).
        for (var attempt = 0; attempt < 6; attempt++) {
          var s = Math.min(1, edge / Math.max(w, h));
          var cw = Math.max(1, Math.round(w * s)), ch = Math.max(1, Math.round(h * s));
          var cv = document.createElement('canvas'); cv.width = cw; cv.height = ch;
          cv.getContext('2d').drawImage(im, 0, 0, cw, ch);
          var q = 0.72; out = cv.toDataURL('image/jpeg', q);
          while (out.length > maxLen && q > 0.4) { q -= 0.12; out = cv.toDataURL('image/jpeg', q); }
          if (out.length <= maxLen || edge <= 360) break;
          edge = Math.round(edge * 0.8);
        }
        resolve(out);
      };
      im.src = r.result;
    };
    r.readAsDataURL(file);
  });
}

// ===== Botón 🖼️ en la cabecera del chat (opción A del dueño) + hoja de acciones =====
function _curName() { try { return (document.getElementById('chat-contact-name') || {}).value || t('the_contact', 'el contacto'); } catch (e) { return t('the_contact', 'el contacto'); } }

function _refreshButton() {
  var b = document.getElementById('nexo-wp-btn');
  if (!b) return;
  // Solo en chats 1 a 1 (en grupos no; el global de chats sí los cubre). #dueño 04-11: se decide por _curNx (puesto al
  // abrir el chat, '' al cerrar), NO por la clase 'chat-view-active' del <body>: esa clase se agrega DESPUÉS de disparar
  // openChat (main.js / chat_nav), así que mirarla aquí —síncrono— dejaba el botón OCULTO a veces (carrera; por eso «a
  // veces lo veía y a veces no»). calls_ui/groupcall_ui lo evitaban con setTimeout; esto lo hace determinista.
  b.style.display = NX_RE.test(_curNx) ? '' : 'none';
}

// #dueño 05-11: se quitó el botón 🖼️ de la cabecera. Ahora el fondo del chat se abre con una PULSACIÓN LARGA (~0,8 s)
// sobre el FONDO del chat (donde no hay mensajes). Solo en chats 1-a-1 y solo si no se arrastró (para no pisar el scroll
// ni el gesto de cerrar). El tiempo es configurable por window.NEXO_WP_LONGPRESS_MS (para probarlo determinista en jsdom).
export function installWallpaperGesture() {
  var c = document.getElementById('messages-container');
  if (!c || c._nexoWpGesture) return;
  c._nexoWpGesture = true;
  var timer = null, sx = 0, sy = 0, moved = false, MOVE = 12;
  function clearT() { if (timer) { clearTimeout(timer); timer = null; } }
  function start(x, y, target) {
    if (!NX_RE.test(_curNx)) return;                                  // solo en chats 1-a-1
    if (target && target.closest && target.closest('.message, button, a, input, textarea, img, video, svg, .msg-media')) return; // solo el FONDO vacío
    sx = x; sy = y; moved = false; clearT();
    var ms = (typeof window !== 'undefined' && window.NEXO_WP_LONGPRESS_MS) || 800;
    timer = setTimeout(function() { timer = null; if (!moved) _openSheet(); }, ms);
  }
  function move(x, y) { if (timer && (Math.abs(x - sx) > MOVE || Math.abs(y - sy) > MOVE)) { moved = true; clearT(); } }
  c.addEventListener('touchstart', function(e) { var t = e.touches && e.touches[0]; if (t) start(t.clientX, t.clientY, e.target); }, { passive: true });
  c.addEventListener('touchmove', function(e) { var t = e.touches && e.touches[0]; if (t) move(t.clientX, t.clientY); }, { passive: true });
  c.addEventListener('touchend', clearT, { passive: true });
  c.addEventListener('touchcancel', clearT, { passive: true });
  c.addEventListener('scroll', function() { moved = true; clearT(); }, { passive: true });
  c.addEventListener('mousedown', function(e) { if (e.button === 0) start(e.clientX, e.clientY, e.target); });
  c.addEventListener('mousemove', function(e) { move(e.clientX, e.clientY); });
  c.addEventListener('mouseup', clearT);
  c.addEventListener('mouseleave', clearT);
}

function _pick(onUrl, edge, len) {
  var inp = document.createElement('input');
  inp.type = 'file'; inp.accept = 'image/*'; inp.style.display = 'none';
  inp.onchange = function() {
    var f = inp.files && inp.files[0]; inp.remove();
    if (!f) return;
    makeWallpaper(f, edge || SHARE_EDGE, len || SHARE_LEN).then(onUrl).catch(function(e) {
      _showInfoToast(t('prof_photo_fail', 'No se pudo usar esa foto: ') + ((e && e.message) || t('prof_error', 'error')), 3500);
    });
  };
  document.body.appendChild(inp); inp.click();
}

function _openSheet() {
  var nx = _curNx;
  if (!NX_RE.test(nx)) return;
  _ensurePer(nx).then(function() {
    var old = document.getElementById('nexo-wp-sheet'); if (old) old.remove();
    var name = _curName();
    var has = hasChatWallpaperFor(nx);
    var sheet = document.createElement('div');
    sheet.id = 'nexo-wp-sheet';
    sheet.style.cssText = 'position:fixed;inset:0;z-index:2147483646;background:rgba(0,0,0,0.6);display:flex;align-items:flex-end;justify-content:center;';
    sheet.innerHTML = '<div class="nx-card" style="width:100%;max-width:460px;margin:0 0 env(safe-area-inset-bottom,0px);border-radius:20px 20px 0 0;">' +
      '<div class="nx-h"><span class="nx-ico">🖼️</span>' + t('wp_sheet_title', 'Fondo de este chat') + '</div>' +
      '<div class="nx-sub">' + t('wp_sheet_sub', 'Una foto de fondo solo para este chat (manda sobre el fondo general de chats).') + '</div>' +
      '<button id="nexo-wp-pick" class="nx-btn nx-btn-primary">' + (has ? t('wp_change', 'Cambiar la foto…') : t('wp_set', 'Elegir una foto…')) + '</button>' +
      (has ? '<button id="nexo-wp-share" class="nx-btn">' + t('wp_share', 'Compartir este fondo con ') + name + '</button>' +
             '<button id="nexo-wp-remove" class="nx-btn">' + t('wp_remove', 'Quitar el fondo de este chat') + '</button>' : '') +
      '<button id="nexo-wp-close" class="nx-btn" style="background:none;border:none;">' + t('close', 'Cerrar') + '</button>' +
      '</div>';
    document.body.appendChild(sheet);
    sheet.addEventListener('click', function(e) { if (e.target === sheet) sheet.remove(); });
    var close = function() { var s = document.getElementById('nexo-wp-sheet'); if (s) s.remove(); };
    sheet.querySelector('#nexo-wp-close').onclick = close;
    sheet.querySelector('#nexo-wp-pick').onclick = function() {
      close();
      _pick(function(url) {
        if (setChatWallpaperFor(nx, url)) _showInfoToast(t('wp_set_ok', 'Fondo de este chat puesto. Para que lo vea el otro, tocá «Compartir».'), 4000);
        else _showInfoToast(t('prof_photo_invalid', 'foto no válida'), 3000);
      });
    };
    var shareBtn = sheet.querySelector('#nexo-wp-share');
    if (shareBtn) shareBtn.onclick = function() {
      close();
      if (shareChatWallpaper(nx)) _showInfoToast(t('wp_share_ok', 'Fondo enviado a ') + name, 3000);
      else _showInfoToast(t('wp_share_fail', 'No se pudo enviar el fondo'), 3000);
    };
    var rmBtn = sheet.querySelector('#nexo-wp-remove');
    if (rmBtn) rmBtn.onclick = function() { close(); clearChatWallpaperFor(nx); _showInfoToast(t('wp_removed', 'Fondo de este chat quitado'), 2500); };
  });
}

// ===== COLA 30: fondo de las demás pantallas (llamada/videollamada, Perfil, Ajustes y lista de chats) =====
function _paintScreens() {
  Object.keys(SCR_SEL).forEach(function(k) {
    var el; try { el = document.querySelector(SCR_SEL[k]); } catch (e) { el = null; }
    if (el) _paintEl(el, _scr[k]);
  });
}
export function screenWallpaperFor(key) { return key === 'list' ? _list : (_scr[key] || ''); }
export function setScreenWallpaper(key, dataUrl) {
  if (key === 'list') return setListWallpaper(dataUrl);
  if (!(key in _scr) || !IMG_RE.test(dataUrl || '') || dataUrl.length > MAX_LEN) return false;
  _scr[key] = dataUrl; _save(SCR_FILE(key), { img: dataUrl }); _paintScreens(); return true;
}
export function clearScreenWallpaper(key) {
  if (key === 'list') return clearListWallpaper();
  if (!(key in _scr)) return;
  _scr[key] = ''; _save(SCR_FILE(key), { img: '' }); _paintScreens();
}

// Lo que NO es «espacio libre»: mensajes, filas, botones, campos, avatares, la tira de estados, tarjetas, cabecera y barras.
var NOT_FREE = '.message, button, a, input, textarea, select, label, img, video, canvas, svg, [role="button"], .msg-media, ' +
  '.nx-card, .nx-set-row, .nx-btn, .nx-link, .nx-av, .nx-page-title, ' +
  '.ble-contact-row, .ble-contact-menu, .contacts-online-strip, .ble-online-item, .ble-found-row, #main-header, .ble-bottom-nav, ' +
  '.nc-btn, .nc-pip, .call-buttons, .nc-av-wrap, .nc-pill, .nc-min, .nc-warnbar, .call-name, .call-status, .call-note';
// ¿A qué pantalla pertenece el toque? ('' = a ninguna con fondo propio; el chat va por su propio gesto)
function _screenOf(target) {
  if (!target || !target.closest) return '';
  if (target.closest(NOT_FREE)) return '';
  if (target.closest('#nexo-wp-sheet')) return '';
  if (target.closest('#nexo-settings-sheet')) return 'settings';
  if (target.closest('#nexo-profile-sheet')) return 'profile';
  var cs = target.closest('#nexo-call-screen');
  if (cs) return cs.classList.contains('nc-appmini') ? '' : 'call';
  if (target.closest('#contacts-view') && !_inChat() && !document.querySelector('#nexo-contact-profile, #nexo-scr-ask')) return 'list';
  return '';
}

export function installScreenGestures() {
  if (document._nexoWpScr) return;
  document._nexoWpScr = true;
  var timer = null, sx = 0, sy = 0, MOVE = 12;
  function clearT() { if (timer) { clearTimeout(timer); timer = null; } }
  function start(x, y, target) {
    clearT();
    var k = _screenOf(target);
    if (!k) return;
    sx = x; sy = y;
    var ms = window.NEXO_WP_LONGPRESS_MS || 800;
    timer = setTimeout(function() { timer = null; _openScreenSheet(k); }, ms);
  }
  function move(x, y) { if (timer && (Math.abs(x - sx) > MOVE || Math.abs(y - sy) > MOVE)) clearT(); }
  var o = { passive: true, capture: true };
  document.addEventListener('touchstart', function(e) { var t0 = e.touches && e.touches[0]; if (!t0 || e.touches.length > 1) { clearT(); return; } start(t0.clientX, t0.clientY, e.target); }, o);
  document.addEventListener('touchmove', function(e) { var t0 = e.touches && e.touches[0]; if (t0) move(t0.clientX, t0.clientY); }, o);
  document.addEventListener('touchend', clearT, o);
  document.addEventListener('touchcancel', clearT, o);
  document.addEventListener('scroll', clearT, o);   // si la lista se desplaza (o se arrastra para actualizar), se cancela
  document.addEventListener('mousedown', function(e) { if (e.button === 0) start(e.clientX, e.clientY, e.target); }, true);
  document.addEventListener('mousemove', function(e) { move(e.clientX, e.clientY); }, true);
  document.addEventListener('mouseup', clearT, true);
  // Las hojas de Perfil/Ajustes y la pantalla de llamada se crean al abrirse: se pintan en cuanto aparecen en <body>.
  try {
    new MutationObserver(function(ms) {
      for (var i = 0; i < ms.length; i++) for (var j = 0; j < ms[i].addedNodes.length; j++) {
        var n = ms[i].addedNodes[j];
        if (n && (n.id === 'nexo-profile-sheet' || n.id === 'nexo-settings-sheet' || n.id === 'nexo-call-screen')) { _paintScreens(); return; }
      }
    }).observe(document.body, { childList: true });
  } catch (e) {}
}

// Textos: SOLO claves que ya existen en los diccionarios (no pasan de 999 líneas; la auditoría exige todas las claves en la tabla).
// El MISMO menú que el del chat (elegir foto de la galería / quitar / cerrar), sin «compartir».
function _openScreenSheet(k) {
  var old = document.getElementById('nexo-wp-sheet'); if (old) old.remove();
  var has = !!screenWallpaperFor(k);
  var sheet = document.createElement('div');
  sheet.id = 'nexo-wp-sheet';
  sheet.setAttribute('data-screen', k);
  sheet.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,0.6);display:flex;align-items:flex-end;justify-content:center;';
  sheet.innerHTML = '<div class="nx-card" style="width:100%;max-width:460px;margin:0 0 env(safe-area-inset-bottom,0px);border-radius:20px 20px 0 0;">' +
    '<div class="nx-h"><span class="nx-ico">🖼️</span>' + t('prof_wallpaper_title', 'Fondo de pantalla') + '</div>' +
    '<button id="nexo-wp-pick" class="nx-btn nx-btn-primary">' + (has ? t('wp_change', 'Cambiar la foto…') : t('wp_set', 'Elegir una foto…')) + '</button>' +
    (has ? '<button id="nexo-wp-remove" class="nx-btn">' + t('prof_wallpaper_remove', 'Quitar este fondo') + '</button>' : '') +
    '<button id="nexo-wp-close" class="nx-btn" style="background:none;border:none;">' + t('close', 'Cerrar') + '</button>' +
    '</div>';
  document.body.appendChild(sheet);
  var close = function() { var s = document.getElementById('nexo-wp-sheet'); if (s) s.remove(); };
  sheet.addEventListener('click', function(e) { if (e.target === sheet) close(); });
  sheet.querySelector('#nexo-wp-close').onclick = close;
  sheet.querySelector('#nexo-wp-pick').onclick = function() {
    close();
    _pick(function(url) {
      if (setScreenWallpaper(k, url)) _showInfoToast(t('prof_wallpaper_title', 'Fondo de pantalla') + ' ✓', 2500);
      else _showInfoToast(t('prof_photo_invalid', 'foto no válida'), 3000);
    }, MAX_EDGE, MAX_LEN);
  };
  var rm = sheet.querySelector('#nexo-wp-remove');
  if (rm) rm.onclick = function() { close(); clearScreenWallpaper(k); };
}
