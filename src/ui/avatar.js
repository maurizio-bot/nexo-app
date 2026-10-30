/**
 * avatar.js v1.0 (ronda 2765, pedido del dueño) — Foto de perfil.
 * - La propia: Perfil → tocar el círculo → elegir una foto; se recorta cuadrada a 160 px (JPEG, ~10–15 KB) y se guarda
 *   (cifrada en reposo, como todo lo de NEXO) en nexo_my_avatar.json { h, img }.
 * - Va a cada contacto como acción oculta del chat ({type:'nexo_act', act:'av', h, img}): cifrada de extremo a extremo,
 *   por cualquier camino (Bluetooth, Wi-Fi, internet, Jump), sin aviso ni "no leído"; a quien aún no la tiene, al
 *   conectar con él (peerReady). La copia oculta se borra al entregarse. Quitar la foto manda img vacía.
 * - La de cada contacto: nexo_av_<NEXO ID>.json; se pinta en la lista, la fila de conectados, la llamada y Perfil.
 */
import { _getBLEContacts, _normId, _saveBLEContacts } from './ble_helpers.js';
import { _sendTextTo } from './send.js';
import { vaultDeleteMessage } from '../vault/vault_manager.js';
import { t } from './i18n.js';

var MY_FILE = 'nexo_my_avatar.json', SENT_FILE = 'nexo_av_sent.json';
var IMG_RE = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/;
var MAX_LEN = 60000;          // ~45 KB de imagen como mucho (las nuestras: 10–15 KB)
var SIZE = 160;
var NX_RE = /^nx[0-9a-z]{8}$/;

var _mine = null;             // { h, img } (img '' = sin foto)
var _cache = new Map();       // NEXO ID → data URL
var _sent = {};               // NEXO ID → h que ya se le mandó
var _outIds = new Map();      // id de la copia oculta → NEXO ID (se borra al entregarse)
var _started = false;

function _pl() { return (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.NexoBLE) || null; }
function _load(name) {
  var pl = _pl();
  if (!pl || typeof pl.loadFromFile !== 'function') return Promise.resolve(null);
  return pl.loadFromFile({ filename: name }).then(function(r) { return r && r.exists && r.content ? JSON.parse(r.content) : null; }).catch(function() { return null; });
}
function _save(name, obj) { var pl = _pl(); if (pl && typeof pl.saveToFile === 'function') pl.saveToFile({ filename: name, content: JSON.stringify(obj) }).catch(function() {}); }
function _hash(s) { var h = 2166136261; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h.toString(36); }
function _emit(nx) { try { window.dispatchEvent(new CustomEvent('nexo:avatar', { detail: { nx: nx } })); } catch (e) {} }
function _contactIds() { return _getBLEContacts().map(function(c) { return _normId(c.nexoId || c.deviceUUID); }).filter(function(nx) { return NX_RE.test(nx); }); }

export function avatarInit() {
  if (_started) return;
  _started = true;
  Promise.all([_load(MY_FILE), _load(SENT_FILE)]).then(function(r) {
    if (r[0] && typeof r[0].h === 'string') _mine = { h: r[0].h, img: IMG_RE.test(r[0].img || '') ? r[0].img : '' };
    if (r[1] && typeof r[1] === 'object') _sent = r[1];
    if (_mine && _mine.img) _emit('me');
  });
  // Las fotos de los contactos (solo de los que la tienen: avh en el contacto)
  _getBLEContacts().forEach(function(c) {
    var nx = _normId(c.nexoId || c.deviceUUID);
    if (!c.avh || !NX_RE.test(nx)) return;
    _load('nexo_av_' + nx + '.json').then(function(o) { if (o && IMG_RE.test(o.img || '')) { _cache.set(nx, o.img); _emit(nx); } });
  });
  window.addEventListener('nexo:ble:peerReady', function(e) {
    var nx = _normId(e && e.detail && e.detail.nexoId);
    if (NX_RE.test(nx)) setTimeout(function() { sendAvatarTo(nx); }, 4000);
  });
  window.addEventListener('nexo:ble:ackStatus', function(e) {
    var d = e && e.detail, nx = d && _outIds.get(d.msgId);
    if (nx && (d.status === 'delivered' || d.status === 'read')) { _outIds.delete(d.msgId); vaultDeleteMessage(nx, d.msgId).catch(function() {}); }
  });
}

export function avatarOf(nx) { return nx === 'me' ? myAvatar() : (_cache.get(_normId(nx)) || null); }
export function myAvatar() { return (_mine && _mine.img) || null; }

// Pinta la foto en un círculo (si la hay); textEl: dónde van las iniciales (si no es el propio círculo)
export function paintAvatar(el, nx, textEl) {
  var img = el && avatarOf(nx);
  if (!img) return false;
  el.style.backgroundImage = 'url("' + img + '")';
  el.style.backgroundSize = 'cover';
  el.style.backgroundPosition = 'center';
  el.style.backgroundRepeat = 'no-repeat';
  el.classList.add('nx-has-photo');
  (textEl || el).textContent = '';
  return true;
}

// A un contacto que aún no tiene la versión actual
export function sendAvatarTo(nx) {
  nx = _normId(nx);
  if (!_mine || !_mine.h || !NX_RE.test(nx) || _sent[nx] === _mine.h || _contactIds().indexOf(nx) < 0) return;
  var id = _sendTextTo(nx, JSON.stringify({ type: 'nexo_act', act: 'av', h: _mine.h, img: _mine.img || '' }), '', true);
  if (!id) return;
  _outIds.set(id, nx);
  _sent[nx] = _mine.h;
  _save(SENT_FILE, _sent);
  console.log('[AVATAR] Foto de perfil ' + (_mine.img ? 'mandada' : 'quitada') + ' a ' + nx);
}
function _sendToAll() { _contactIds().forEach(sendAvatarTo); }

export function setMyAvatar(dataUrl) {
  if (!IMG_RE.test(dataUrl || '') || dataUrl.length > MAX_LEN) return false;
  _mine = { h: _hash(dataUrl), img: dataUrl };
  _save(MY_FILE, _mine);
  _emit('me');
  _sendToAll();
  return true;
}
export function clearMyAvatar() {
  _mine = { h: 'x' + Date.now().toString(36), img: '' };
  _save(MY_FILE, _mine);
  _emit('me');
  _sendToAll();
}

// Lo que llega de un contacto (chat_actions._applyChatAction)
export function applyAvatar(sender, act) {
  var nx = _normId(sender), img = typeof act.img === 'string' ? act.img : '', h = String(act.h || '').substring(0, 20);
  if (!NX_RE.test(nx) || !h || (img && (!IMG_RE.test(img) || img.length > MAX_LEN))) return;
  if (img) _cache.set(nx, img); else _cache.delete(nx);
  _save('nexo_av_' + nx + '.json', { h: h, img: img });
  var contacts = _getBLEContacts(), c = contacts.find(function(x) { return _normId(x.nexoId || x.deviceUUID) === nx; });
  if (c && c.avh !== (img ? h : '')) { c.avh = img ? h : ''; _saveBLEContacts(contacts); }
  console.log('[AVATAR] Foto de perfil de ' + nx + ': ' + (img ? 'nueva' : 'quitada'));
  _emit(nx);
}

// Cuadrada, 160 px, JPEG (el simulador no tiene canvas: window.NEXO_makeAvatar)
export function makeAvatar(file) {
  if (typeof window.NEXO_makeAvatar === 'function') return Promise.resolve(window.NEXO_makeAvatar(file));
  return new Promise(function(resolve, reject) {
    var r = new FileReader();
    r.onerror = function() { reject(new Error(t('misc_avatar_read_fail', 'no se pudo leer la foto'))); };
    r.onload = function() {
      var im = new Image();
      im.onerror = function() { reject(new Error(t('misc_avatar_not_image', 'no es una imagen'))); };
      im.onload = function() {
        var s = Math.min(im.width, im.height), cv = document.createElement('canvas');
        cv.width = cv.height = SIZE;
        cv.getContext('2d').drawImage(im, (im.width - s) / 2, (im.height - s) / 2, s, s, 0, 0, SIZE, SIZE);
        var out = cv.toDataURL('image/jpeg', 0.82);
        if (out.length > MAX_LEN) out = cv.toDataURL('image/jpeg', 0.6);
        resolve(out);
      };
      im.src = r.result;
    };
    r.readAsDataURL(file);
  });
}
