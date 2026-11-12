/**
 * avatar.js v1.0 (ronda 2765, pedido del dueño) — Foto de perfil.
 * - La propia: Perfil → tocar el círculo → elegir una foto; se recorta cuadrada a 160 px (JPEG, ~10–15 KB) y se guarda
 *   (cifrada en reposo, como todo lo de NEXO) en nexo_my_avatar.json { h, img }.
 * - Va a cada contacto como acción oculta del chat ({type:'nexo_act', act:'av', h, img}): cifrada de extremo a extremo,
 *   por cualquier camino (Bluetooth, Wi-Fi, internet, Jump), sin aviso ni "no leído"; a quien aún no la tiene, al
 *   conectar con él (peerReady). La copia oculta se borra al entregarse. Quitar la foto manda img vacía.
 * - La de cada contacto: nexo_av_<NEXO ID>.json; se pinta en la lista, la fila de conectados, la llamada y Perfil.
 * - 3028 (dueño 12-11: «hay otros contactos con mi misma foto de perfil»; el registro del Motorola mostró que se guardó en la
 *   galería una foto de 7 KB —la de perfil de un contacto, desde el visor— y 9 s después se puso como propia en Perfil):
 *   (1) una foto de contacto que es la MISMA que la tuya, o la de otro contacto que la tenía antes, NO se muestra (huella de la
 *   imagen: la copia re-comprimida da la misma huella; vale aunque el otro teléfono tenga una versión vieja); se recalcula en cada
 *   cambio (si el que copió cambia su foto, el original vuelve a verse); (2) Perfil no deja poner como propia la foto de un contacto;
 *   (3) el visor de la foto de un contacto no tiene «Guardar en galería» (ble_ui).
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
var _cache = new Map();       // NEXO ID → data URL (solo las que se MUESTRAN)
var _all = new Map();         // NEXO ID → { img, at, ph } todas las recibidas (también las que no se muestran por copiadas)
var _minePh = null;           // huella de mi foto
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
// 3028: huella de la imagen (dHash 8×8 de grises + color medio). Una copia re-comprimida o re-escalada da la misma (o casi).
// El simulador no tiene canvas: window.NEXO_avatarPHash(dataUrl) → { b: '0101…' (64), c: [r, g, b] } o null.
function _phash(url) {
  if (!url) return Promise.resolve(null);
  if (typeof window.NEXO_avatarPHash === 'function') { try { return Promise.resolve(window.NEXO_avatarPHash(url) || null); } catch (e) { return Promise.resolve(null); } }
  return new Promise(function(resolve) {
    setTimeout(function() { resolve(null); }, 2000);   // sin huella a tiempo (imagen que no carga): no se compara
    try {
      var im = new Image();
      im.onerror = function() { resolve(null); };
      im.onload = function() {
        try {
          var cv = document.createElement('canvas'); cv.width = 9; cv.height = 8;
          var cx = cv.getContext('2d'); cx.drawImage(im, 0, 0, 9, 8);
          var d = cx.getImageData(0, 0, 9, 8).data, bits = '', r = 0, g = 0, b = 0, lum = function(i) { return d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114; };
          for (var y = 0; y < 8; y++) for (var x = 0; x < 8; x++) { var i = (y * 9 + x) * 4; bits += lum(i) > lum(i + 4) ? '1' : '0'; }
          for (var k = 0; k < d.length; k += 4) { r += d[k]; g += d[k + 1]; b += d[k + 2]; }
          resolve({ b: bits, c: [Math.round(r / 72), Math.round(g / 72), Math.round(b / 72)] });
        } catch (e) { resolve(null); }
      };
      im.src = url;
    } catch (e) { resolve(null); }
  });
}
// Misma foto: ≤ 8 de 64 bits distintos y color medio parecido. Una imagen casi lisa (huella sin dibujo) no se compara.
function _same(p, q) {
  if (!p || !q || typeof p.b !== 'string' || typeof q.b !== 'string' || p.b.length !== 64 || q.b.length !== 64) return false;
  var ones = p.b.split('1').length - 1;
  if (ones < 4 || ones > 60) return false;
  var dist = 0; for (var i = 0; i < 64; i++) if (p.b.charAt(i) !== q.b.charAt(i)) dist++;
  if (dist > 8) return false;
  var pc = p.c || [], qc = q.c || [];
  for (var j = 0; j < 3; j++) if (Math.abs((pc[j] || 0) - (qc[j] || 0)) > 24) return false;
  return true;
}
function _nameOf(nx) { var c = _getBLEContacts().find(function(x) { return _normId(x.nexoId || x.deviceUUID) === nx; }); return (c && c.name) || nx; }
// Qué fotos se muestran: la de un contacto NO si es la mía, ni si otro contacto tenía la misma desde antes (empate: ninguna).
function _recompute() {
  _all.forEach(function(o, nx) {
    var why = '';
    if (o.ph && _minePh && _mine && _mine.img && _same(o.ph, _minePh)) why = 'es la misma que la tuya';   // i18n-ok (registro del diagnóstico)
    else if (o.ph) _all.forEach(function(p, ny) { if (!why && ny !== nx && p.ph && (p.at || 0) <= (o.at || 0) && _same(o.ph, p.ph)) why = 'es la misma que la de ' + ny; });   // i18n-ok
    var shown = _cache.get(nx) === o.img;
    if (why) {
      if (shown || !o.hid) console.warn('[AVATAR] Foto de perfil de ' + nx + ' no se muestra: ' + why + ' (copiada)');
      o.hid = true;
      if (shown) { _cache.delete(nx); _emit(nx); }
    } else {
      o.hid = false;
      if (!shown) { _cache.set(nx, o.img); _emit(nx); }
    }
  });
}
function _keep(nx, img, at) {
  return _phash(img).then(function(ph) { _all.set(nx, { img: img, at: at || 0, ph: ph }); });
}
/** 3028: ¿esta foto es la de perfil de algún contacto? → su nombre (o null). Perfil no deja ponerla como propia. */
export function avatarClash(url) {
  if (!_all.size) return Promise.resolve(null);   // ningún contacto con foto: nada con qué comparar (sin esperar)
  // las que quedaron sin huella (la imagen no cargó a tiempo) se vuelven a intentar
  var miss = [];
  _all.forEach(function(o) { if (!o.ph) miss.push(_phash(o.img).then(function(ph) { o.ph = ph; })); });
  return Promise.all(miss).then(function() { return _phash(url); }).then(function(ph) {
    if (!ph) return null;
    var hit = null;
    _all.forEach(function(o, nx) { if (!hit && o.ph && _same(ph, o.ph)) hit = nx; });
    return hit ? _nameOf(hit) : null;
  });
}
function _contactIds() { return _getBLEContacts().map(function(c) { return _normId(c.nexoId || c.deviceUUID); }).filter(function(nx) { return NX_RE.test(nx); }); }

export function avatarInit() {
  if (_started) return;
  _started = true;
  Promise.all([_load(MY_FILE), _load(SENT_FILE)]).then(function(r) {
    if (r[0] && typeof r[0].h === 'string') _mine = { h: r[0].h, img: IMG_RE.test(r[0].img || '') ? r[0].img : '', at: Number(r[0].at) || 0 };
    // 3012 (dueño 11-11: un contacto salió con una foto que no era la suya; el registro de Marcos mostró que la mandó ese teléfono
    // como SU foto): al diagnóstico, si este teléfono tiene foto propia y desde cuándo (las puestas antes de la 3012: «fecha desconocida»)
    if (_mine && _mine.img) console.log('[AVATAR] Este teléfono tiene foto de perfil propia (' + Math.round(_mine.img.length / 1024) + ' KB, puesta: ' + (_mine.at ? new Date(_mine.at).toISOString().substring(0, 16) : 'fecha desconocida') + ')');
    if (r[1] && typeof r[1] === 'object') _sent = r[1];
    if (_mine && _mine.img) _emit('me');
    return _phash(_mine && _mine.img).then(function(ph) { _minePh = ph; });
  }).then(function() {
    // Las fotos de los contactos (solo de los que la tienen: avh en el contacto); 3028: se muestran tras comparar huellas
    return Promise.all(_getBLEContacts().map(function(c) {
      var nx = _normId(c.nexoId || c.deviceUUID);
      if (!c.avh || !NX_RE.test(nx)) return null;
      return _load('nexo_av_' + nx + '.json').then(function(o) { if (o && IMG_RE.test(o.img || '')) return _keep(nx, o.img, Number(o.at) || 0); });
    }));
  }).then(_recompute).catch(function() {});
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
  _mine = { h: _hash(dataUrl), img: dataUrl, at: Date.now() };
  _save(MY_FILE, _mine);
  console.log('[AVATAR] Foto de perfil propia puesta ahora desde Perfil (' + Math.round(dataUrl.length / 1024) + ' KB)');
  _emit('me');
  _sendToAll();
  _phash(dataUrl).then(function(ph) { if (_mine && _mine.img === dataUrl) { _minePh = ph; _recompute(); } });
  return true;
}
export function clearMyAvatar() {
  _mine = { h: 'x' + Date.now().toString(36), img: '', at: Date.now() };
  _save(MY_FILE, _mine);
  console.log('[AVATAR] Foto de perfil propia quitada desde Perfil');
  _minePh = null;
  _emit('me');
  _sendToAll();
  _recompute();
}

// Lo que llega de un contacto (chat_actions._applyChatAction)
export function applyAvatar(sender, act) {
  var nx = _normId(sender), img = typeof act.img === 'string' ? act.img : '', h = String(act.h || '').substring(0, 20);
  if (!NX_RE.test(nx) || !h || (img && (!IMG_RE.test(img) || img.length > MAX_LEN))) return;
  var prev = _all.get(nx), at = (prev && prev.img === img) ? prev.at : Date.now();
  _save('nexo_av_' + nx + '.json', { h: h, img: img, at: at });
  var contacts = _getBLEContacts(), c = contacts.find(function(x) { return _normId(x.nexoId || x.deviceUUID) === nx; });
  if (c && c.avh !== (img ? h : '')) { c.avh = img ? h : ''; _saveBLEContacts(contacts); }
  console.log('[AVATAR] Foto de perfil de ' + nx + ': ' + (img ? 'nueva' : 'quitada'));
  // 3028: no se pinta hasta comparar su huella con la mía y las de los demás contactos (_recompute)
  if (!img) { _all.delete(nx); if (_cache.delete(nx)) _emit(nx); _recompute(); return; }
  _keep(nx, img, at).then(_recompute).catch(function() {});
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
