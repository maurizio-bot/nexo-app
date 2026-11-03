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
 */
import { t } from './i18n.js';
import { _normId } from './ble_helpers.js';
import { _sendTextTo } from './send.js';
import { vaultDeleteMessage } from '../vault/vault_manager.js';

var LIST_FILE = 'nexo_wp_list.json', CHAT_FILE = 'nexo_wp_chat.json';
function CHATP_FILE(nx) { return 'nexo_wp_c_' + nx + '.json'; }   // fondo por chat concreto
var IMG_RE = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/;
var NX_RE = /^nx[0-9a-z]{8}$/;
var MAX_LEN = 1400000;    // ~1 MB de imagen como mucho (las nuestras: 100–400 KB)
var MAX_EDGE = 1280;      // lado mayor al que se reduce la foto elegida (fondos globales)
var SHARE_EDGE = 1080, SHARE_LEN = 520000; // el fondo por chat se comparte: más chico para que viaje bien
var DIM = 0.5;            // oscurecido del fondo (0 = foto tal cual, 1 = negro) para que se lea el texto encima

var _list = '';           // data URL o '' (sin fondo)
var _chat = '';           // fondo global de chats
var _per = new Map();      // NEXO ID -> data URL (fondo por chat concreto; '' = sin fondo propio)
var _curNx = '';           // contacto del chat abierto ahora (para pintar y para el botón)
var _applied = '';         // lo que está pintado ahora mismo (para el simulador; el navegador real pinta #app)
var _outIds = new Map();    // id de la copia oculta compartida -> NEXO ID (se borra al entregarse)
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
  // Al entrar a un chat: pinta el global de chats al instante y, si ese contacto tiene fondo propio, lo cambia.
  window.addEventListener('nexo:ble:openChat', function(e) {
    _curNx = _normId((e && e.detail && e.detail.contactId) || '');
    _paint(_chat);
    var nx = _curNx;
    _ensurePer(nx).then(function() { if (_curNx === nx) _paint(_chatImgFor(nx)); });
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
  if (!NX_RE.test(nx) || !IMG_RE.test(dataUrl || '') || dataUrl.length > MAX_LEN) return false;
  _per.set(nx, dataUrl); _save(CHATP_FILE(nx), { img: dataUrl });
  if (_curNx === nx) _paint(dataUrl);
  return true;
}
export function clearChatWallpaperFor(nx) {
  nx = _normId(nx);
  if (!NX_RE.test(nx)) return;
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
  if (_curNx === nx) _paint(img || _chat);
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
        var w = im.width || 1, h = im.height || 1, s = Math.min(1, maxEdge / Math.max(w, h));
        var cw = Math.max(1, Math.round(w * s)), ch = Math.max(1, Math.round(h * s));
        var cv = document.createElement('canvas'); cv.width = cw; cv.height = ch;
        cv.getContext('2d').drawImage(im, 0, 0, cw, ch);
        var q = 0.72, out = cv.toDataURL('image/jpeg', q);
        while (out.length > maxLen && q > 0.4) { q -= 0.12; out = cv.toDataURL('image/jpeg', q); }
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
  // Solo en chats 1 a 1 (en grupos no; el global de chats sí los cubre)
  b.style.display = (_inChat() && NX_RE.test(_curNx)) ? '' : 'none';
}

export function installWallpaperButton() {
  var header = document.getElementById('chat-header');
  if (!header || document.getElementById('nexo-wp-btn')) return;
  var b = document.createElement('button');
  b.id = 'nexo-wp-btn';
  b.title = t('wp_btn_title', 'Fondo de este chat');
  b.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9" r="1.6"/><path d="M21 16l-5-5L5 20"/></svg>';
  b.style.cssText = 'width:38px;height:38px;border-radius:50%;background:rgba(255,255,255,0.1);color:#fff;border:none;cursor:pointer;flex-shrink:0;margin-left:6px;display:none;';
  b.addEventListener('click', function(e) { e.stopPropagation(); _openSheet(); });
  header.appendChild(b);
  _refreshButton();
}

function _pick(onUrl) {
  var inp = document.createElement('input');
  inp.type = 'file'; inp.accept = 'image/*'; inp.style.display = 'none';
  inp.onchange = function() {
    var f = inp.files && inp.files[0]; inp.remove();
    if (!f) return;
    makeWallpaper(f, SHARE_EDGE, SHARE_LEN).then(onUrl).catch(function(e) {
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
