/**
 * estados.js — ESTADOS tipo WhatsApp (Stream, cercanos, E2E, 24 h).
 * - Fase 1 (ronda 2799): estado de TEXTO con caducidad 24 h, cifrado E2E, privado ENTRE CONTACTOS (no público).
 *   Viaja por lo que ya hay (Bluetooth/Wi-Fi/Jump/internet) como acción oculta del chat
 *   ({type:'nexo_act', act:'st', t, ts}): sin mensaje visible ni "no leído".
 * - Fase 2 (ronda 2906, pedido del dueño): el estado puede llevar también una FOTO (img reducida) y se le puede dar
 *   «me gusta» ({type:'nexo_act', act:'sl', ts} de vuelta al dueño del estado). Video/audio quedan para el siguiente paso.
 * - El propio se guarda en nexo_my_status.json {t, ts, img?, mime?}. El de cada contacto en nexo_status_<NEXO ID>.json.
 * - Se reparte a cada contacto al publicarlo y, al que no estaba, al conectar con él (peerReady). La copia oculta se
 *   borra al entregarse. Caduca a las 24 h (no se muestra ni se guarda lo vencido).
 * - UI: una tira "Estados" arriba de la lista de contactos.
 */
import { _getBLEContacts, _normId, _saveBLEContacts } from './ble_helpers.js';
import { _sendTextTo } from './send.js';
import { vaultDeleteMessage } from '../vault/vault_manager.js';
import { _makeVideoPreview, _blobToB64 } from './video_tools.js';
import { t } from './i18n.js';

var MY_FILE = 'nexo_my_status.json', SENT_FILE = 'nexo_status_sent.json';
var TTL_MS = 24 * 60 * 60 * 1000;      // caduca a las 24 h
var MAX_LEN = 280;                      // texto de estado como mucho
var IMG_DIM = 720;                      // foto de estado: lado mayor como mucho (ligera; se reparte a todos los contactos)
var IMG_MAX = 150 * 1024;               // y como mucho ~150 KB de data URI (si no, se rechaza al recibir)
var AUD_MAX = 220 * 1024;               // audio de estado: como mucho ~220 KB (≈30 s en opus/webm a bitrate bajo)
var AUD_SECS = 30;                      // y como mucho 30 s de grabación
var VID_MAX = 520 * 1024;               // video de estado: como mucho ~520 KB (previa 240p re-codificada, ~250 KB objetivo)
var NX_RE = /^nx[0-9a-z]{8}$/;

var _mine = null;             // { t, ts, img, mime, likes:Map(nx->ts) } (t '' e img '' = sin estado)
var _cache = new Map();       // NEXO ID → { t, ts, img, mime }
var _sent = {};               // NEXO ID → ts que ya se le mandó
var _outIds = new Map();      // id de la copia oculta → NEXO ID
var _started = false;

function _pl() { return (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.NexoBLE) || null; }
function _load(name) {
  var pl = _pl();
  if (!pl || typeof pl.loadFromFile !== 'function') return Promise.resolve(null);
  return pl.loadFromFile({ filename: name }).then(function(r) { return r && r.exists && r.content ? JSON.parse(r.content) : null; }).catch(function() { return null; });
}
function _save(name, obj) { var pl = _pl(); if (pl && typeof pl.saveToFile === 'function') pl.saveToFile({ filename: name, content: JSON.stringify(obj) }).catch(function() {}); }
function _emit(nx) { try { window.dispatchEvent(new CustomEvent('nexo:estado', { detail: { nx: nx } })); } catch (e) {} }
function _contactIds() { return _getBLEContacts().map(function(c) { return _normId(c.nexoId || c.deviceUUID); }).filter(function(nx) { return NX_RE.test(nx); }); }
function _contactName(nx) { var c = _getBLEContacts().find(function(x) { return _normId(x.nexoId || x.deviceUUID) === _normId(nx); }); return (c && c.name) || String(nx || '').toUpperCase(); }
// Un estado está activo si tiene texto, foto, audio O video, con ts dentro de las 24 h
function _active(s) { return !!(s && typeof s.ts === 'number' && ((typeof s.t === 'string' && s.t) || (typeof s.img === 'string' && s.img) || (typeof s.aud === 'string' && s.aud) || (typeof s.vid === 'string' && s.vid)) && (Date.now() - s.ts) < TTL_MS); }
function _validImg(v) { return typeof v === 'string' && /^data:image\/(png|jpe?g|webp|gif);base64,/.test(v) && v.length <= IMG_MAX; }
function _validAud(v) { return typeof v === 'string' && /^data:audio\/(webm|ogg|mp4|mpeg|mp3|wav|aac);base64,/.test(v) && v.length <= AUD_MAX; }
function _validVid(v) { return typeof v === 'string' && /^data:video\/(webm|mp4|ogg|quicktime);base64,/.test(v) && v.length <= VID_MAX; }

// Reduce una foto a una imagen ligera para el estado (lado mayor IMG_DIM, JPEG). En el simulador no hay canvas:
// window.NEXO_makeStatusImage hace de stub.
export function makeStatusImage(file) {
  if (typeof window.NEXO_makeStatusImage === 'function') return Promise.resolve(window.NEXO_makeStatusImage(file));
  return new Promise(function(resolve, reject) {
    var r = new FileReader();
    r.onerror = function() { reject(new Error(t('misc_avatar_read_fail', 'no se pudo leer la foto'))); };
    r.onload = function() {
      var im = new Image();
      im.onerror = function() { reject(new Error(t('misc_avatar_not_image', 'no es una imagen'))); };
      im.onload = function() {
        var w = im.width, h = im.height, sc = Math.min(1, IMG_DIM / Math.max(w, h));
        var cw = Math.max(1, Math.round(w * sc)), ch = Math.max(1, Math.round(h * sc));
        var cv = document.createElement('canvas'); cv.width = cw; cv.height = ch;
        cv.getContext('2d').drawImage(im, 0, 0, cw, ch);
        var out = cv.toDataURL('image/jpeg', 0.72);
        if (out.length > IMG_MAX) out = cv.toDataURL('image/jpeg', 0.55);
        if (out.length > IMG_MAX) out = cv.toDataURL('image/jpeg', 0.4);
        resolve(out);
      };
      im.src = r.result;
    };
    r.readAsDataURL(file);
  });
}

export function estadosInit() {
  if (_started) return;
  _started = true;
  Promise.all([_load(MY_FILE), _load(SENT_FILE)]).then(function(r) {
    if (_active(r[0])) _mine = { t: String(r[0].t || '').substring(0, MAX_LEN), ts: r[0].ts, img: _validImg(r[0].img) ? r[0].img : '', mime: r[0].mime || '', aud: _validAud(r[0].aud) ? r[0].aud : '', amime: r[0].amime || '', vid: _validVid(r[0].vid) ? r[0].vid : '', vmime: r[0].vmime || '', likes: new Map() };
    if (r[1] && typeof r[1] === 'object') _sent = r[1];
    _renderStrip();
  });
  // Los estados de los contactos que la tienen (ste en el contacto)
  _getBLEContacts().forEach(function(c) {
    var nx = _normId(c.nexoId || c.deviceUUID);
    if (!c.ste || !NX_RE.test(nx)) return;
    _load('nexo_status_' + nx + '.json').then(function(o) { if (_active(o)) { _cache.set(nx, { t: String(o.t || '').substring(0, MAX_LEN), ts: o.ts, img: _validImg(o.img) ? o.img : '', mime: o.mime || '', aud: _validAud(o.aud) ? o.aud : '', amime: o.amime || '', vid: _validVid(o.vid) ? o.vid : '', vmime: o.vmime || '' }); _emit(nx); } });
  });
  window.addEventListener('nexo:ble:peerReady', function(e) {
    var nx = _normId(e && e.detail && e.detail.nexoId);
    if (NX_RE.test(nx)) setTimeout(function() { sendStatusTo(nx); }, 4000);
  });
  window.addEventListener('nexo:ble:ackStatus', function(e) {
    var d = e && e.detail, nx = d && _outIds.get(d.msgId);
    if (nx && (d.status === 'delivered' || d.status === 'read')) { _outIds.delete(d.msgId); vaultDeleteMessage(nx, d.msgId).catch(function() {}); }
  });
  window.addEventListener('nexo:estado', function() { _renderStrip(); });
  window.addEventListener('nexo:ble:openChat', function() { _renderStrip(); });
  window.addEventListener('nexo:ble:closeChat', function() { setTimeout(_renderStrip, 60); });
}

export function statusOf(nx) {
  nx = _normId(nx);
  var s = _cache.get(nx);
  if (s && !_active(s)) { _cache.delete(nx); return null; } // caducó
  return _active(s) ? s : null;
}
export function myStatus() { return _active(_mine) ? _mine : null; }

// Publicar/actualizar mi estado. text y/o img y/o aud y/o vid (data URI). Sin ninguno → lo quita.
export function setMyStatus(text, img, mime, aud, amime, vid, vmime) {
  text = String(text == null ? '' : text).substring(0, MAX_LEN);
  img = _validImg(img) ? img : '';
  aud = _validAud(aud) ? aud : '';
  vid = _validVid(vid) ? vid : '';
  if (!text && !img && !aud && !vid) { clearMyStatus(); return; }
  _mine = { t: text, ts: Date.now(), img: img, mime: img ? (mime || 'image/jpeg') : '', aud: aud, amime: aud ? (amime || 'audio/webm') : '', vid: vid, vmime: vid ? (vmime || 'video/webm') : '', likes: new Map() };
  _save(MY_FILE, { t: text, ts: _mine.ts, img: img, mime: _mine.mime, aud: aud, amime: _mine.amime, vid: vid, vmime: _mine.vmime });
  _sent = {}; _save(SENT_FILE, _sent);   // estado nuevo → reenviar a todos
  _contactIds().forEach(sendStatusTo);
  _emit('me');
  console.log('[ESTADO] Publicado (' + text.length + ' car.' + (img ? ' + foto ' + Math.round(img.length / 1024) + ' KB' : '') + (aud ? ' + audio ' + Math.round(aud.length / 1024) + ' KB' : '') + (vid ? ' + video ' + Math.round(vid.length / 1024) + ' KB' : '') + ')');
}
export function clearMyStatus() {
  _mine = { t: '', ts: Date.now(), img: '', mime: '', likes: new Map() };
  _save(MY_FILE, { t: '', ts: _mine.ts });
  var sent = _sent; _sent = {}; _save(SENT_FILE, _sent);
  _contactIds().forEach(function(nx) { if (sent[nx] !== undefined) _broadcast(nx, { t: '', img: '' }); });
  _mine = null;
  _emit('me');
}
function _broadcast(nx, s) {
  var act = { type: 'nexo_act', act: 'st', t: s.t || '', ts: Date.now() };
  if (s.img) { act.img = s.img; act.mime = s.mime || 'image/jpeg'; }
  if (s.aud) { act.aud = s.aud; act.amime = s.amime || 'audio/webm'; }
  if (s.vid) { act.vid = s.vid; act.vmime = s.vmime || 'video/webm'; }
  var id = _sendTextTo(nx, JSON.stringify(act), '', true);
  if (id) _outIds.set(id, nx);
  return id;
}
export function sendStatusTo(nx) {
  nx = _normId(nx);
  if (!_active(_mine) || !NX_RE.test(nx) || _sent[nx] === _mine.ts || _contactIds().indexOf(nx) < 0) return;
  if (_broadcast(nx, _mine)) { _sent[nx] = _mine.ts; _save(SENT_FILE, _sent); }
}

// Recibido: un contacto publicó/quitó su estado
export function applyStatus(senderNx, act) {
  var nx = _normId(senderNx);
  if (!NX_RE.test(nx) || !act) return;
  var txt = typeof act.t === 'string' ? act.t.substring(0, MAX_LEN) : '';
  var img = _validImg(act.img) ? act.img : '';   // lo que no es una imagen válida (o muy grande) se descarta: no pisa nada raro
  var aud = _validAud(act.aud) ? act.aud : '';   // ídem con el audio
  var vid = _validVid(act.vid) ? act.vid : '';   // ídem con el video
  // Robustez (auditoría 2800): el ts lo pone el OTRO teléfono; un ts en el futuro (reloj malo o malicioso) haría que su
  // estado nunca caducara. Se acota a «ahora». Un ts negativo/no numérico también cae a ahora.
  var now = Date.now();
  var ts = (typeof act.ts === 'number' && act.ts > 0) ? Math.min(act.ts, now) : now;
  var has = (txt || img || aud || vid) && (now - ts) < TTL_MS;
  try {
    var contacts = _getBLEContacts(), i = contacts.findIndex(function(c) { return _normId(c.nexoId || c.deviceUUID) === nx; });
    if (i >= 0) { contacts[i].ste = has ? 1 : 0; _saveBLEContacts(contacts); }
  } catch (e) {}
  if (has) { var s = { t: txt, ts: ts, img: img, mime: img ? (act.mime || 'image/jpeg') : '', aud: aud, amime: aud ? (act.amime || 'audio/webm') : '', vid: vid, vmime: vid ? (act.vmime || 'video/webm') : '' }; _cache.set(nx, s); _save('nexo_status_' + nx + '.json', s); }
  else { _cache.delete(nx); _save('nexo_status_' + nx + '.json', { t: '', ts: ts }); }
  _emit(nx);
}

// ---- «Me gusta» a un estado ----
// Le doy me gusta al estado de nx: le mando una acción oculta de vuelta.
export function likeStatus(nx) {
  nx = _normId(nx);
  if (!NX_RE.test(nx) || !statusOf(nx)) return false;
  var id = _sendTextTo(nx, JSON.stringify({ type: 'nexo_act', act: 'sl', ts: Date.now() }), '', true);
  if (id) _outIds.set(id, nx);
  return !!id;
}
// A MÍ me llegó un me gusta a mi estado (de senderNx)
export function likeReceived(senderNx, act) {
  var nx = _normId(senderNx);
  if (!NX_RE.test(nx) || !_active(_mine)) return;            // sin estado activo, nada que likear
  if (!_mine.likes) _mine.likes = new Map();
  if (_mine.likes.has(nx)) return;                           // un me gusta por contacto
  _mine.likes.set(nx, Date.now());
  _toast('❤️ ' + _contactName(nx) + ' ' + t('est_liked_your', 'le gustó tu estado'));
  _emit('me');
}
export function myLikes() { return _active(_mine) && _mine.likes ? _mine.likes.size : 0; }

function _toast(msg) {
  try {
    var el = document.createElement('div');
    el.style.cssText = 'position:fixed;left:50%;bottom:80px;transform:translateX(-50%);background:#0a0a15;border:1px solid #00c8ff;color:#fff;padding:10px 16px;border-radius:12px;z-index:7000;font-size:14px;max-width:80%;text-align:center;';
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(function() { try { el.remove(); } catch (e) {} }, 3000);
  } catch (e) {}
}

// Contactos (con nombre) que tienen estado activo ahora
function _activeContacts() {
  var out = [];
  _getBLEContacts().forEach(function(c) {
    var nx = _normId(c.nexoId || c.deviceUUID);
    var s = statusOf(nx);
    if (s) out.push({ nx: nx, name: c.name || nx.toUpperCase(), t: s.t, ts: s.ts, img: s.img, aud: s.aud, vid: s.vid });
  });
  return out;
}

// ---------- Interfaz: tira de Estados arriba de la lista de contactos ----------
function _esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function(c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function _ago(ts) { var m = Math.floor((Date.now() - ts) / 60000); if (m < 1) return t('grp_ago_now', 'ahora'); if (m < 60) return t('grp_ago_prefix', 'hace ') + m + t('grp_ago_min', ' min'); return t('grp_ago_prefix', 'hace ') + Math.floor(m / 60) + t('grp_ago_h', ' h'); }
function _strip() {
  var cv = document.getElementById('contacts-view');
  if (!cv) return null;
  var el = document.getElementById('main-estados-strip');
  if (!el) {
    el = document.createElement('div');
    el.id = 'main-estados-strip';
    el.style.cssText = 'display:flex;gap:10px;overflow-x:auto;padding:10px 12px;align-items:flex-start;';
    cv.insertBefore(el, cv.firstChild);
  }
  return el;
}
function _chip(label, sub, onClick, accent, img) {
  var w = document.createElement('div');
  w.className = 'estado-chip';
  w.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:4px;flex-shrink:0;width:64px;cursor:pointer;';
  var circle = document.createElement('div');
  circle.style.cssText = 'width:52px;height:52px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:20px;color:#fff;overflow:hidden;' +
    (accent ? 'background:var(--nx-grad,linear-gradient(135deg,#00c8ff,#a855f7));' : 'background:rgba(255,255,255,0.1);border:2px solid #00c8ff;');
  if (img) { var im = document.createElement('img'); im.src = img; im.style.cssText = 'width:100%;height:100%;object-fit:cover;'; circle.appendChild(im); }
  else circle.textContent = accent ? '➕' : (label || '·').substring(0, 1).toUpperCase();
  var nm = document.createElement('div');
  nm.style.cssText = 'font-size:11px;color:#ccc;max-width:64px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:center;';
  nm.textContent = sub || label || '';
  w.appendChild(circle); w.appendChild(nm);
  w.addEventListener('click', function(e) { e.stopPropagation(); onClick(); });
  return w;
}
function _renderStrip() {
  var el = _strip();
  if (!el) return;
  el.innerHTML = '';
  var mine = myStatus();
  el.appendChild(_chip(t('grp_my_status', 'Mi estado'), mine ? t('grp_your_status', 'Tu estado') : t('grp_my_status', 'Mi estado'), _compose, !mine, mine && mine.img));
  if (mine && !mine.img) { var mc = el.lastChild.querySelector('div'); if (mc) { mc.textContent = (mine.t || '·').substring(0, 1).toUpperCase(); mc.style.background = 'var(--nx-grad,linear-gradient(135deg,#00c8ff,#a855f7))'; } }
  _activeContacts().forEach(function(c) {
    el.appendChild(_chip(c.name, c.name, function() { _view(c); }, false, c.img));
  });
  el.style.display = 'flex'; // siempre visible (al menos «Mi estado»)
}
function _overlay() {
  var o = document.getElementById('estado-overlay');
  if (o) o.remove();
  o = document.createElement('div');
  o.id = 'estado-overlay';
  o.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.9);z-index:6000;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:16px;padding:24px;';
  o.addEventListener('click', function(e) { if (e.target === o) o.remove(); });
  document.body.appendChild(o);
  return o;
}
function _compose() {
  var o = _overlay();
  var box = document.createElement('div');
  box.style.cssText = 'background:#0a0a15;border:1px solid #00c8ff;border-radius:16px;padding:20px;max-width:340px;width:100%;color:#fff;display:flex;flex-direction:column;gap:12px;';
  var h = document.createElement('div'); h.style.cssText = 'font-weight:700;color:#00c8ff;'; h.textContent = t('grp_my_status_24h', 'Mi estado (24 h)');
  var m = myStatus();
  var picked = { img: (m && m.img) || '', mime: (m && m.mime) || '', aud: (m && m.aud) || '', amime: (m && m.amime) || '', vid: (m && m.vid) || '', vmime: (m && m.vmime) || '' };
  // previa de la foto (si hay)
  var prev = document.createElement('img');
  prev.style.cssText = 'width:100%;max-height:200px;object-fit:contain;border-radius:10px;background:#000;' + (picked.img ? '' : 'display:none;');
  if (picked.img) prev.src = picked.img;
  // previa del video (si hay)
  var vidPrev = document.createElement('video'); vidPrev.controls = true; vidPrev.playsInline = true;
  vidPrev.style.cssText = 'width:100%;max-height:200px;border-radius:10px;background:#000;' + (picked.vid ? '' : 'display:none;');
  if (picked.vid) vidPrev.src = picked.vid;
  // previa del audio (si hay)
  var audPrev = document.createElement('audio'); audPrev.controls = true;
  audPrev.style.cssText = 'width:100%;' + (picked.aud ? '' : 'display:none;');
  if (picked.aud) audPrev.src = picked.aud;
  var ta = document.createElement('textarea');
  ta.id = 'estado-input';
  ta.maxLength = MAX_LEN;
  ta.placeholder = t('grp_status_ph', '¿Qué estás pensando?');
  ta.style.cssText = 'width:100%;min-height:70px;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.15);border-radius:10px;color:#fff;font-size:15px;padding:10px;outline:none;resize:none;';
  if (m) ta.value = m.t || '';
  // elegir foto
  var fin = document.createElement('input'); fin.type = 'file'; fin.accept = 'image/*'; fin.style.display = 'none';
  fin.addEventListener('change', function() {
    var f = fin.files && fin.files[0]; if (!f) return;
    makeStatusImage(f).then(function(dataUri) {
      if (!_validImg(dataUri)) { _toast(t('est_img_too_big', 'La foto es muy pesada para un estado')); return; }
      picked.img = dataUri; picked.mime = 'image/jpeg'; prev.src = dataUri; prev.style.display = 'block';
      picked.aud = ''; audPrev.removeAttribute('src'); audPrev.style.display = 'none';
      picked.vid = ''; vidPrev.removeAttribute('src'); vidPrev.style.display = 'none'; // una sola media por estado
    }).catch(function() { _toast(t('misc_avatar_not_image', 'no es una imagen')); });
  });
  var photoBtn = document.createElement('button');
  photoBtn.id = 'estado-foto';
  photoBtn.textContent = '📷 ' + t('est_add_photo', 'Foto');
  photoBtn.style.cssText = 'flex:1;padding:9px;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.2);border-radius:10px;color:#fff;cursor:pointer;';
  photoBtn.addEventListener('click', function(e) { e.stopPropagation(); fin.click(); });
  // grabar audio (grabador propio, autocontenido; tope AUD_SECS). Un segundo toque detiene.
  var rec = null, recChunks = [], recTimer = null, recStart = 0;
  function _stopRec() { if (recTimer) { clearInterval(recTimer); recTimer = null; } try { if (rec && rec.state !== 'inactive') rec.stop(); } catch (e) {} }
  var audBtn = document.createElement('button');
  audBtn.id = 'estado-audio-btn';
  audBtn.textContent = '🎤 ' + t('est_add_audio', 'Audio');
  audBtn.style.cssText = 'flex:1;padding:9px;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.2);border-radius:10px;color:#fff;cursor:pointer;';
  audBtn.addEventListener('click', function(e) {
    e.stopPropagation();
    if (rec && rec.state === 'recording') { _stopRec(); return; }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || typeof MediaRecorder === 'undefined') { _toast(t('est_no_mic', 'No se puede grabar audio aquí')); return; }
    navigator.mediaDevices.getUserMedia({ audio: true }).then(function(stream) {
      recChunks = []; rec = new MediaRecorder(stream);
      rec.ondataavailable = function(ev) { if (ev.data && ev.data.size) recChunks.push(ev.data); };
      rec.onstop = function() {
        try { stream.getTracks().forEach(function(tk) { tk.stop(); }); } catch (e) {}
        audBtn.textContent = '🎤 ' + t('est_add_audio', 'Audio');
        var blob = new Blob(recChunks, { type: (rec && rec.mimeType) || 'audio/webm' });
        var fr = new FileReader();
        fr.onload = function() {
          var d = String(fr.result || '');
          if (!_validAud(d)) { _toast(t('est_aud_too_big', 'El audio es muy largo/pesado para un estado')); return; }
          picked.aud = d; picked.amime = (blob.type || 'audio/webm').split(';')[0];
          audPrev.src = d; audPrev.style.display = 'block';
          picked.img = ''; prev.removeAttribute('src'); prev.style.display = 'none';
          picked.vid = ''; vidPrev.removeAttribute('src'); vidPrev.style.display = 'none'; // una sola media por estado
        };
        fr.readAsDataURL(blob);
      };
      rec.start(); recStart = Date.now();
      recTimer = setInterval(function() {
        var s = Math.floor((Date.now() - recStart) / 1000);
        audBtn.textContent = '⏹ ' + t('est_stop', 'Detener') + ' (' + s + 's)';
        if (s >= AUD_SECS) _stopRec();
      }, 250);
    }).catch(function() { _toast(t('est_no_mic', 'No se puede grabar audio aquí')); });
  });
  // elegir video: se re-codifica a una previa 240p liviana (reusa _makeVideoPreview; stub NEXO_makeVideoPreview en pruebas)
  var vidBtn = document.createElement('button');
  vidBtn.id = 'estado-video-btn';
  vidBtn.textContent = '🎥 ' + t('est_add_video', 'Video');
  vidBtn.style.cssText = 'flex:1;padding:9px;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.2);border-radius:10px;color:#fff;cursor:pointer;';
  var vfin = document.createElement('input'); vfin.type = 'file'; vfin.accept = 'video/*'; vfin.style.display = 'none';
  vfin.addEventListener('change', function() {
    var f = vfin.files && vfin.files[0]; if (!f) return;
    var mk = (typeof window.NEXO_makeVideoPreview === 'function') ? window.NEXO_makeVideoPreview : _makeVideoPreview;
    vidBtn.textContent = '🎥 ' + t('est_processing', 'Procesando…'); vidBtn.disabled = true;
    Promise.resolve(mk(f)).then(function(res) {
      vidBtn.textContent = '🎥 ' + t('est_add_video', 'Video'); vidBtn.disabled = false;
      if (!res || res.tooLong || !res.size) { _toast(res && res.tooLong ? t('est_vid_too_long', 'El video es muy largo para un estado') : t('est_vid_fail', 'No se pudo preparar el video')); return; }
      return _blobToB64(res).then(function(b64) {
        var d = 'data:' + ((res.type || 'video/webm').split(';')[0]) + ';base64,' + b64;
        if (!_validVid(d)) { _toast(t('est_vid_too_big', 'El video quedó muy pesado para un estado')); return; }
        picked.vid = d; picked.vmime = (res.type || 'video/webm').split(';')[0];
        vidPrev.src = d; vidPrev.style.display = 'block';
        picked.img = ''; prev.removeAttribute('src'); prev.style.display = 'none';
        picked.aud = ''; audPrev.removeAttribute('src'); audPrev.style.display = 'none';
      });
    }).catch(function() { vidBtn.textContent = '🎥 ' + t('est_add_video', 'Video'); vidBtn.disabled = false; _toast(t('est_vid_fail', 'No se pudo preparar el video')); });
  });
  vidBtn.addEventListener('click', function(e) { e.stopPropagation(); vfin.click(); });
  var row = document.createElement('div'); row.style.cssText = 'display:flex;gap:10px;';
  var pub = document.createElement('button');
  pub.id = 'estado-publicar';
  pub.textContent = t('grp_publish', 'Publicar');
  pub.style.cssText = 'flex:1;padding:11px;background:linear-gradient(135deg,#00c8ff,#a855f7);border:none;border-radius:10px;color:#fff;font-weight:700;cursor:pointer;';
  pub.addEventListener('click', function(e) { e.stopPropagation(); _stopRec(); setMyStatus(ta.value, picked.img, picked.mime, picked.aud, picked.amime, picked.vid, picked.vmime); o.remove(); });
  row.appendChild(pub);
  if (m) {
    var del = document.createElement('button');
    del.id = 'estado-quitar';
    del.textContent = t('grp_remove', 'Quitar');
    del.style.cssText = 'padding:11px 16px;background:rgba(255,59,48,0.3);border:1px solid #FF3B30;border-radius:10px;color:#fff;font-weight:600;cursor:pointer;';
    del.addEventListener('click', function(e) { e.stopPropagation(); clearMyStatus(); o.remove(); });
    row.appendChild(del);
  }
  box.appendChild(h); box.appendChild(prev); box.appendChild(vidPrev); box.appendChild(audPrev); box.appendChild(ta);
  var mrow = document.createElement('div'); mrow.style.cssText = 'display:flex;gap:10px;';
  mrow.appendChild(photoBtn); mrow.appendChild(audBtn); mrow.appendChild(vidBtn);
  box.appendChild(mrow); box.appendChild(fin); box.appendChild(vfin); box.appendChild(row);
  // Si es mi propio estado y tiene me gusta, mostrarlo
  if (m && myLikes() > 0) { var lk = document.createElement('div'); lk.style.cssText = 'font-size:13px;color:#ff6b9d;'; lk.textContent = '❤️ ' + myLikes() + ' ' + t('est_likes', 'me gusta'); box.appendChild(lk); }
  o.appendChild(box);
  setTimeout(function() { try { ta.focus(); } catch (e) {} }, 50);
}
function _view(c) {
  var o = _overlay();
  var box = document.createElement('div');
  box.id = 'estado-view';
  box.style.cssText = 'max-width:360px;width:100%;color:#fff;display:flex;flex-direction:column;gap:10px;';
  var who = document.createElement('div'); who.style.cssText = 'font-weight:700;color:#00c8ff;'; who.textContent = c.name;
  var when = document.createElement('div'); when.style.cssText = 'font-size:12px;color:#888;'; when.textContent = _ago(c.ts);
  box.appendChild(who); box.appendChild(when);
  if (c.img) { var im = document.createElement('img'); im.src = c.img; im.style.cssText = 'width:100%;max-height:60vh;object-fit:contain;border-radius:12px;background:#000;'; box.appendChild(im); }
  if (c.vid) { var vd = document.createElement('video'); vd.id = 'estado-video'; vd.controls = true; vd.src = c.vid; vd.playsInline = true; vd.style.cssText = 'width:100%;max-height:60vh;border-radius:12px;background:#000;'; box.appendChild(vd); }
  if (c.aud) { var au = document.createElement('audio'); au.id = 'estado-audio'; au.controls = true; au.src = c.aud; au.style.cssText = 'width:100%;'; box.appendChild(au); }
  if (c.t) { var txt = document.createElement('div'); txt.style.cssText = 'font-size:20px;line-height:1.5;white-space:pre-wrap;word-break:break-word;'; txt.innerHTML = _esc(c.t); box.appendChild(txt); }
  // «Me gusta»
  var like = document.createElement('button');
  like.id = 'estado-like';
  like.style.cssText = 'align-self:flex-start;padding:9px 16px;background:rgba(255,59,48,0.18);border:1px solid #ff6b9d;border-radius:20px;color:#fff;font-size:15px;cursor:pointer;';
  like.textContent = '🤍 ' + t('est_like', 'Me gusta');
  like.addEventListener('click', function(e) {
    e.stopPropagation();
    if (likeStatus(c.nx)) { like.textContent = '❤️ ' + t('est_liked', 'Te gustó'); like.disabled = true; like.style.opacity = '0.8'; }
  });
  box.appendChild(like);
  o.appendChild(box);
}

if (typeof window !== 'undefined') {
  window.NEXO_setMyStatus = setMyStatus; window.NEXO_statusOf = statusOf; window.NEXO_applyStatus = applyStatus;
  window.NEXO_likeStatus = likeStatus; window.NEXO_likeReceived = likeReceived; window.NEXO_myLikes = myLikes; // pruebas (tests/sim/estados.js)
}
