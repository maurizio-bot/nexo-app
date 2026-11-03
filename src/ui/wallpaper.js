/**
 * wallpaper.js — Fondo de pantalla (pedido del dueño 02-11). Dos fondos, elegidos en Ajustes → «Fondo de pantalla»:
 *   • Lista de contactos  (nexo_wp_list.json)
 *   • Chats               (nexo_wp_chat.json) — se ve detrás de las burbujas
 * Se guardan cifrados en reposo (como todo NEXO, vía el plugin loadFromFile/saveToFile) y se pintan en el fondo del
 * contenedor #app: no hace scroll con el contenido y la cabecera y la barra de escribir (opacas) lo tapan donde toca.
 * Lleva un oscurecido para que el texto y las burbujas se lean sobre cualquier foto. Sin fondo elegido todo queda
 * como antes (negro liso). Al abrir un chat se pone el fondo de chats; al volver a la lista, el de la lista.
 * (El fondo POR chat concreto, con sync E2E al otro teléfono, llega en una ronda siguiente.)
 */
import { t } from './i18n.js';

var LIST_FILE = 'nexo_wp_list.json', CHAT_FILE = 'nexo_wp_chat.json';
var IMG_RE = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/;
var MAX_LEN = 1400000;    // ~1 MB de imagen como mucho (las nuestras: 100–400 KB)
var MAX_EDGE = 1280;      // lado mayor al que se reduce la foto elegida
var DIM = 0.5;            // oscurecido del fondo (0 = foto tal cual, 1 = negro) para que se lea el texto encima

var _list = '';           // data URL o '' (sin fondo)
var _chat = '';
var _applied = '';        // lo que está pintado ahora mismo (para el simulador; el navegador real pinta #app)
var _started = false;

function _pl() { return (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.NexoBLE) || null; }
function _load(name) {
  var pl = _pl();
  if (!pl || typeof pl.loadFromFile !== 'function') return Promise.resolve(null);
  return pl.loadFromFile({ filename: name }).then(function(r) { return r && r.exists && r.content ? JSON.parse(r.content) : null; }).catch(function() { return null; });
}
function _save(name, obj) { var pl = _pl(); if (pl && typeof pl.saveToFile === 'function') pl.saveToFile({ filename: name, content: JSON.stringify(obj) }).catch(function() {}); }

function _inChat() { try { return document.body.classList.contains('chat-view-active'); } catch (e) { return false; } }

// Pinta el fondo en #app (no hace scroll; la cabecera y la barra de escribir, opacas, lo tapan donde toca).
function _paint(img) {
  _applied = (img && IMG_RE.test(img)) ? img : '';
  var app;
  try { app = document.getElementById('app'); } catch (e) { app = null; }
  if (!app) return;
  if (img && IMG_RE.test(img)) {
    app.style.backgroundImage = 'linear-gradient(rgba(0,0,0,' + DIM + '),rgba(0,0,0,' + DIM + ')),url("' + img + '")';
    app.style.backgroundSize = 'cover';
    app.style.backgroundPosition = 'center';
    app.style.backgroundRepeat = 'no-repeat';
  } else {
    app.style.backgroundImage = '';   // vuelve al negro liso del CSS
  }
}

// Vuelve a pintar según la pantalla en la que estemos ahora.
export function wallpaperRefresh() { _paint(_inChat() ? _chat : _list); }

export function wallpaperInit() {
  if (_started) return;
  _started = true;
  Promise.all([_load(LIST_FILE), _load(CHAT_FILE)]).then(function(r) {
    if (r[0] && typeof r[0].img === 'string' && IMG_RE.test(r[0].img)) _list = r[0].img;
    if (r[1] && typeof r[1].img === 'string' && IMG_RE.test(r[1].img)) _chat = r[1].img;
    wallpaperRefresh();
  });
  // Independiente del orden de los listeners: al entrar a un chat, fondo de chats; al salir, fondo de la lista.
  window.addEventListener('nexo:ble:openChat', function() { _paint(_chat); });
  window.addEventListener('nexo:ble:closeChat', function() { _paint(_list); });
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

// Reduce la foto elegida (lado mayor MAX_EDGE, JPEG) para no cargar el fondo con una imagen enorme.
// El simulador no tiene canvas: window.NEXO_makeWallpaper.
export function makeWallpaper(file) {
  if (typeof window.NEXO_makeWallpaper === 'function') return Promise.resolve(window.NEXO_makeWallpaper(file));
  return new Promise(function(resolve, reject) {
    var r = new FileReader();
    r.onerror = function() { reject(new Error(t('misc_avatar_read_fail', 'no se pudo leer la foto'))); };
    r.onload = function() {
      var im = new Image();
      im.onerror = function() { reject(new Error(t('misc_avatar_not_image', 'no es una imagen'))); };
      im.onload = function() {
        var w = im.width || 1, h = im.height || 1, s = Math.min(1, MAX_EDGE / Math.max(w, h));
        var cw = Math.max(1, Math.round(w * s)), ch = Math.max(1, Math.round(h * s));
        var cv = document.createElement('canvas'); cv.width = cw; cv.height = ch;
        cv.getContext('2d').drawImage(im, 0, 0, cw, ch);
        var q = 0.72, out = cv.toDataURL('image/jpeg', q);
        while (out.length > MAX_LEN && q > 0.4) { q -= 0.12; out = cv.toDataURL('image/jpeg', q); }
        resolve(out);
      };
      im.src = r.result;
    };
    r.readAsDataURL(file);
  });
}
