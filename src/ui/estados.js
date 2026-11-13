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
import { stageBlob, fetchBlob, validatePointer } from '../net/blob_mailbox.js';

var MY_FILE = 'nexo_my_status.json', SENT_FILE = 'nexo_status_sent.json';
var TTL_MS = 24 * 60 * 60 * 1000;      // caduca a las 24 h
var MAX_LEN = 280;                      // texto de estado como mucho
var IMG_DIM = 1600;                     // foto de estado: lado mayor como mucho (3032: hasta 5 MB, antes 720 px / 150 KB)
var IMG_MAX = 150 * 1024;               // y como mucho ~150 KB de data URI (si no, se rechaza al recibir)
var AUD_MAX = 220 * 1024;               // audio de estado: como mucho ~220 KB (≈30 s en opus/webm a bitrate bajo)
var AUD_SECS = 60;                      // y como mucho 60 s de grabación (3032: con estados grandes, antes 30)
var VID_MAX = 520 * 1024;               // video de estado: como mucho ~520 KB (previa 240p re-codificada, ~250 KB objetivo)
var NX_RE = /^nx[0-9a-z]{8}$/;
// 3032 — Estados v3 (dueño 12-11: «poder subir más estados», «que se puedan comentar», «ver quién puso me gusta», «deslizar
// abajo actualiza los estados»; decidió: hasta 10 a la vez y comentarios que ve SOLO el dueño del estado):
//  - cada estado lleva su id (sid); se pueden tener hasta MAX_ITEMS activos (24 h cada uno).
//  - «me gusta» y comentarios van al dueño por acción oculta (sl / sc, con sid); el dueño guarda quién y qué.
//  - deslizar hacia abajo en Contactos manda «sq» a los contactos a la vista: cada uno reenvía sus estados activos.
//  - compatible con builds anteriores: un estado sin sid reemplaza todos (como antes); a un teléfono viejo le llega
//    cada estado como «su estado» (ve el último).
var MAX_ITEMS = 10;
var MAX_COMMENTS = 50;
var SID_RE = /^[a-z0-9]{4,24}$/;
var SQ_GAP_MS = 15000;                  // una petición «sq» por contacto cada 15 s como mucho (en los dos sentidos)
// 3032 (dueño 12-11: «que se puedan subir estados de al menos 5 MB»): una foto/video/audio que no cabe en la acción oculta
// (topes de arriba) viaja aparte, hasta BIG_MAX: con internet se sube UNA vez cifrada al buzón de archivos (relés) y a cada
// contacto le llega solo el puntero dentro del estado; el que lo ve lo baja y lo verifica. Sin internet (o si el puntero no
// sirve) lo pide al dueño por el enlace directo («sm») y le llega como archivo («stmedia»). Se guarda aparte (no en la lista).
var BIG_MAX = 5 * 1024 * 1024;          // bytes reales de la media de un estado
var VID_HD_TARGET = Math.round(4.6 * 1024 * 1024); // 3035: un video grande se recodifica para caber aquí (margen bajo BIG_MAX)
var INLINE_SEND_MAX = 24 * 1024;        // al publicar, solo va dentro del estado una media de hasta ~24 KB (data URI)
var BIG_TTL_SEC = 26 * 3600;            // en los relés: lo que dura el estado y un margen
var SM_GAP_MS = 20000;                  // una petición/envío «sm» por contacto y estado cada 20 s como mucho
var SM_WAIT_MS = 90000;                 // espera de la media pedida por el enlace directo
var _media = new Map();                 // 'me|sid' o 'nx|sid' → data URI (memoria)
var _smWait = new Map(), _smOut = new Map(), _smIn = new Map();

var _mine = { items: [] };    // mis estados: [{ sid, t, ts, img, mime, aud, amime, vid, vmime, likes:{nx:ts}, comments:[{nx,t,ts}] }]
var _cache = new Map();       // NEXO ID → [estados del contacto] (ordenados por ts)
var _sent = {};               // NEXO ID → { sid: 1 } ya mandados
var _outIds = new Map();      // id de la copia oculta → NEXO ID
var _seen = new Map();        // NEXO ID → Set(sid) ya vistos (para abrir en el primero sin ver)
var _iLiked = new Set();      // 'nx|sid' a los que ya di me gusta
var _sqOut = new Map(), _sqIn = new Map(); // freno de «sq» por contacto
var _started = false;
var _loaded = false;          // 3033: mis estados ya leídos del disco
var _unsent = [];             // 3033: [nx, sid] a volver a mandar en el formato de ahora (si llegan antes de leer _sent)
var _staleDone = new Set();   // 3033: copias viejas ya borradas (id)

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
function _active(s) { return !!(s && typeof s.ts === 'number' && ((typeof s.t === 'string' && s.t) || (typeof s.img === 'string' && s.img) || (typeof s.aud === 'string' && s.aud) || (typeof s.vid === 'string' && s.vid) || (s.big && s.big.k)) && (Date.now() - s.ts) < TTL_MS); }
function _validImg(v) { return typeof v === 'string' && /^data:image\/(png|jpe?g|webp|gif);base64,/.test(v) && v.length <= IMG_MAX; }
function _validAud(v) { return typeof v === 'string' && /^data:audio\/(webm|ogg|mp4|mpeg|mp3|wav|aac);base64,/.test(v) && v.length <= AUD_MAX; }
function _validVid(v) { return typeof v === 'string' && /^data:video\/(webm|mp4|ogg|quicktime);base64,/.test(v) && v.length <= VID_MAX; }
function _rawBytes(b64) { var l = (b64 || '').length; if (!l) return 0; var pad = b64.charAt(l - 1) === '=' ? (b64.charAt(l - 2) === '=' ? 2 : 1) : 0; return Math.floor(l * 3 / 4) - pad; }
function _b64Of(d) { var i = String(d || '').indexOf(','); return i >= 0 ? d.substring(i + 1) : ''; }
// Media grande válida: data URI de imagen/video/audio, base64 (se mira el principio y el final; el resto lo verifica quien lo baja) y ≤ BIG_MAX
function _bigOf(d) {
  var m = /^data:(image|video|audio)\/([a-z0-9.+-]{1,30});base64,/.exec(typeof d === 'string' ? d.substring(0, 80) : '');
  if (!m) return null;
  var b = _b64Of(d), n = _rawBytes(b);
  if (!n || n > BIG_MAX || !/^[A-Za-z0-9+/]*={0,2}$/.test(b.substring(0, 2000)) || !/^[A-Za-z0-9+/]*={0,2}$/.test(b.substring(Math.max(0, b.length - 2000)))) return null;
  return { k: m[1] === 'image' ? 'img' : (m[1] === 'video' ? 'vid' : 'aud'), mime: m[1] + '/' + m[2], size: n };
}
function _validBig(b) { return !!(b && typeof b === 'object' && /^(img|vid|aud)$/.test(b.k) && /^(image|video|audio)\/[a-z0-9.+-]{1,30}$/.test(String(b.mime || '')) && String(b.mime).indexOf({ img: 'image/', vid: 'video/', aud: 'audio/' }[b.k]) === 0 && Number(b.size) > 0 && Number(b.size) <= BIG_MAX); }
function _mediaFile(owner, sid) { return owner === 'me' ? 'nexo_stm_' + sid + '.json' : 'nexo_stc_' + owner + '_' + sid + '.json'; }
function _delFile(name) { var pl = _pl(); if (pl && typeof pl.deleteFile === 'function') pl.deleteFile({ filename: name }).catch(function() {}); }
function _newSid() { return Date.now().toString(36) + Math.random().toString(36).substr(2, 5); }
// Un estado validado (de un archivo o de otro teléfono): campos conocidos, media válida o vacía
function _item(o, sid) {
  if (!o || typeof o !== 'object') return null;
  var img = _validImg(o.img) ? o.img : '', aud = _validAud(o.aud) ? o.aud : '', vid = _validVid(o.vid) ? o.vid : '';
  return { sid: sid || (SID_RE.test(String(o.sid || '')) ? String(o.sid) : 'l' + Number(o.ts || 0).toString(36)), t: typeof o.t === 'string' ? o.t.substring(0, MAX_LEN) : '', ts: Number(o.ts) || 0,
    img: img, mime: img ? (o.mime || 'image/jpeg') : '', aud: aud, amime: aud ? (o.amime || 'audio/webm') : '', vid: vid, vmime: vid ? (o.vmime || 'video/webm') : '',
    big: _validBig(o.big) ? { k: o.big.k, mime: o.big.mime, size: Number(o.big.size) } : null, ptr: (_validBig(o.big) && o.ptr && !validatePointer(o.ptr)) ? o.ptr : null };
}
function _activeList(list) { return (list || []).filter(_active).sort(function(a, b) { return a.ts - b.ts; }); }
// Archivo guardado: v3 { v:3, items:[...] } o el de antes (un solo estado { t, ts, img… })
function _fromFile(o) {
  if (!o || typeof o !== 'object') return [];
  var raw = Array.isArray(o.items) ? o.items : [o];
  return raw.map(function(x) { var it = _item(x); if (it && x.lg) it.lg = 1; if (it && x.likes && typeof x.likes === 'object') it.likes = x.likes; if (it && Array.isArray(x.comments)) it.comments = x.comments.slice(-MAX_COMMENTS); return it; }).filter(_active);
}
function _saveMine() { _save(MY_FILE, { v: 3, items: _mine.items }); }
function _saveContact(nx) { _save('nexo_status_' + nx + '.json', { v: 3, items: _cache.get(nx) || [] }); }
function _markSte(nx, has) {
  try {
    var contacts = _getBLEContacts(), i = contacts.findIndex(function(c) { return _normId(c.nexoId || c.deviceUUID) === nx; });
    if (i >= 0 && contacts[i].ste !== (has ? 1 : 0)) { contacts[i].ste = has ? 1 : 0; _saveBLEContacts(contacts); }
  } catch (e) {}
}

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
        var out = cv.toDataURL('image/jpeg', 0.85);
        if (!_validImg(out) && !_bigOf(out)) out = cv.toDataURL('image/jpeg', 0.6);
        resolve(out);
      };
      im.src = r.result;
    };
    r.readAsDataURL(file);
  });
}

// 3033 (diagnósticos S24 y Honor 12-11 22:06–22:25): copias ocultas de estados mandadas por builds anteriores con la foto
// DENTRO (112 KB → 424–779 trozos por Bluetooth) seguían en la cola de reenvío y volvían a saturar la radio tras actualizar.
// Una copia mía de un estado que ya no se manda así (media en línea por encima del tope de ahora), de un estado que ya no
// está activo, o del estado único sin sid (builds < 3032) NO se reenvía: se borra. Si el estado sigue activo se marca «no
// mandado» a ese contacto y sendStatusTo se lo manda en el formato de ahora (puntero o «se pide al verla») al conectar.
// Las bajas (del) y «sin estado» (t vacío) sí se reenvían.
var STALE_INLINE = INLINE_SEND_MAX + 4096;
export function staleStatusCopy(m, cid) {
  if (!m || m.hidden !== true || m._own !== true || typeof m.content !== 'string') return false;
  var c = m.content;
  if (c.indexOf('nexo_act') < 0 || !/"act":"st"/.test(c)) return false;
  var a = null;
  try { a = JSON.parse(c); } catch (e) { return false; }
  if (!a || a.type !== 'nexo_act' || a.act !== 'st' || a.del) return false;
  var sid = SID_RE.test(String(a.sid || '')) ? String(a.sid) : '';
  var why = '';
  if (c.length > STALE_INLINE) why = 'media dentro, ' + Math.round(c.length / 1024) + ' KB';   // i18n-ok (registro)
  else if (!sid && a.t) why = 'formato anterior';                                              // i18n-ok
  else if (sid && _loaded && !_mine.items.some(function(x) { return x.sid === sid && _active(x); })) why = 'ya no está activo'; // i18n-ok
  if (!why) return false;
  var id = m.msgId || m.messageId || m.id, nx = _normId(cid || m.contactNexoId || '');
  // se borra cuando se sabe de quién es (la cola de pendientes lo pasa; el filtro genérico _isResendable, no)
  if (id && NX_RE.test(nx) && !_staleDone.has(id)) {
    _staleDone.add(id);
    console.log('[ESTADO] Copia vieja de un estado para ' + nx + ' (' + why + '): no se reenvía, se borra'); // i18n-ok
    {
      vaultDeleteMessage(nx, id).catch(function() {});
      if (sid) { if (_loaded) _unmarkSent(nx, sid); else _unsent.push([nx, sid]); }
    }
  }
  return true;
}
function _unmarkSent(nx, sid) {
  if (_sent[nx] && _sent[nx][sid]) { delete _sent[nx][sid]; _save(SENT_FILE, _sent); }
}

export function estadosInit() {
  if (_started) return;
  _started = true;
  Promise.all([_load(MY_FILE), _load(SENT_FILE)]).then(function(r) {
    _mine.items = _fromFile(r[0]).map(function(it) { it.likes = it.likes || {}; it.comments = it.comments || []; return it; });
    if (r[1] && typeof r[1] === 'object') { Object.keys(r[1]).forEach(function(k) { _sent[k] = (r[1][k] && typeof r[1][k] === 'object') ? r[1][k] : {}; }); }
    _loaded = true;
    _unsent.splice(0).forEach(function(p) { _unmarkSent(p[0], p[1]); }); // 3033
    _renderStrip();
  });
  // Los estados de los contactos que los tienen (ste en el contacto)
  _getBLEContacts().forEach(function(c) {
    var nx = _normId(c.nexoId || c.deviceUUID);
    if (!c.ste || !NX_RE.test(nx)) return;
    _load('nexo_status_' + nx + '.json').then(function(o) { var l = _fromFile(o); if (l.length) { _cache.set(nx, l); _emit(nx); } });
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
  _attachPull();
}

// ---- Lectura ----
export function statusesOf(nx) {
  nx = _normId(nx);
  var l = _activeList(_cache.get(nx));
  if (_cache.has(nx) && l.length !== (_cache.get(nx) || []).length) { if (l.length) _cache.set(nx, l); else _cache.delete(nx); } // caducados fuera
  return l;
}
// El más reciente (compatibilidad: «el estado» de un contacto)
export function statusOf(nx) { var l = statusesOf(nx); return l.length ? l[l.length - 1] : null; }
export function myStatuses() { return _activeList(_mine.items); }
export function myStatus() { var l = myStatuses(); return l.length ? l[l.length - 1] : null; }

// ---- Publicar / quitar ----
// Publica un estado NUEVO (texto y/o una media). Devuelve su sid, o null (vacío, o ya hay MAX_ITEMS activos).
export function addMyStatus(text, img, mime, aud, amime, vid, vmime) {
  text = String(text == null ? '' : text).substring(0, MAX_LEN);
  // 3032: una media que no cabe en línea pero sí hasta 5 MB va aparte («big»)
  var bigData = '', big = null;
  // 3032 (diagnósticos 12-11 15:07: el Honor publicó un estado con una foto de 112 KB y salió EN LÍNEA a 6 contactos por
  // Bluetooth, 434 trozos cada uno: la radio quedó saturada y llegaron «zombi» y «enlace_abre_cierra»). Ahora solo va en línea una
  // media muy chica (≤ INLINE_SEND_MAX); el resto va aparte: puntero (buzón de archivos) o se pide al verla, a quien la ve.
  [img, vid, aud].some(function(d) { if (d && (d.length > INLINE_SEND_MAX || (!_validImg(d) && !_validAud(d) && !_validVid(d)))) { big = _bigOf(d); if (big) bigData = d; return true; } return false; });
  img = _validImg(img) ? img : ''; aud = _validAud(aud) ? aud : ''; vid = _validVid(vid) ? vid : '';
  if (big) { img = ''; aud = ''; vid = ''; }
  if (!text && !img && !aud && !vid && !big) return null;
  var act = myStatuses();
  if (act.length >= MAX_ITEMS) { _toast(t('est_max', 'Ya tienes 10 estados: quita uno para publicar otro')); return null; }
  var it = { sid: _newSid(), t: text, ts: Date.now(), img: img, mime: img ? (mime || 'image/jpeg') : '', aud: aud, amime: aud ? (amime || 'audio/webm') : '', vid: vid, vmime: vid ? (vmime || 'video/webm') : '', big: big, ptr: null, likes: {}, comments: [] };
  _mine.items = act.concat([it]);
  _saveMine();
  if (big) {
    _save(_mediaFile('me', it.sid), { d: bigData }); _media.set('me|' + it.sid, bigData);
    // con internet: se sube UNA vez al buzón de archivos y el puntero va dentro del estado; sin internet, sale sin puntero
    _stageMine(it, bigData).then(function() { _contactIds().forEach(function(nx) { sendStatusTo(nx); }); });
  } else _contactIds().forEach(function(nx) { sendStatusTo(nx); });
  _emit('me');
  console.log('[ESTADO] Publicado ' + it.sid + ' (' + text.length + ' car.' + (img ? ' + foto ' + Math.round(img.length / 1024) + ' KB' : '') + (aud ? ' + audio ' + Math.round(aud.length / 1024) + ' KB' : '') + (vid ? ' + video ' + Math.round(vid.length / 1024) + ' KB' : '') + (big ? ' + ' + big.k + ' grande ' + Math.round(big.size / 1024) + ' KB' : '') + '; activos ' + _mine.items.length + ')');
  return it.sid;
}
function _stageMine(it, data) {
  var bi = window.bleInterface, net = bi && bi.net;
  if (!net || typeof net.online !== 'function' || !net.online()) return Promise.resolve();
  return stageBlob(net, _b64Of(data), { ttlSec: BIG_TTL_SEC }).then(function(res) {
    it.ptr = res.pointer; _saveMine();
    console.log('[ESTADO] ' + it.sid + ': media subida una vez al buzón de archivos (' + res.pointer.chunks.length + ' trozos)');
  }).catch(function(e) { console.warn('[ESTADO] ' + it.sid + ': no se pudo subir la media (' + ((e && e.message) || e) + '): se pedirá por el enlace directo'); });
}
// Compatibilidad: publicar (un estado nuevo); sin nada → quita todos
export function setMyStatus(text, img, mime, aud, amime, vid, vmime) {
  if (!text && !_validImg(img) && !_validAud(aud) && !_validVid(vid) && !_bigOf(img || vid || aud)) { clearMyStatus(); return; }
  addMyStatus(text, img, mime, aud, amime, vid, vmime);
}
// Quita UNO de mis estados
export function removeMyStatus(sid) {
  var had = _mine.items.some(function(x) { return x.sid === sid; });
  if (!had) return false;
  _mine.items = myStatuses().filter(function(x) { return x.sid !== sid; });
  _saveMine();
  _media.delete('me|' + sid); _delFile(_mediaFile('me', sid));
  _contactIds().forEach(function(nx) {
    var s = _sent[nx];
    if (s && s[sid]) { delete s[sid]; _sendAct(nx, { type: 'nexo_act', act: 'st', sid: sid, del: 1, t: '', ts: Date.now() }); }
  });
  _save(SENT_FILE, _sent);
  _emit('me');
  console.log('[ESTADO] Quitado ' + sid + ' (activos ' + _mine.items.length + ')');
  return true;
}
// Quita TODOS
export function clearMyStatus() {
  _mine.items.forEach(function(x) { if (x.big) { _media.delete('me|' + x.sid); _delFile(_mediaFile('me', x.sid)); } });
  _mine.items = [];
  _saveMine();
  var sent = _sent; _sent = {}; _save(SENT_FILE, _sent);
  _contactIds().forEach(function(nx) { if (sent[nx] && Object.keys(sent[nx]).length) _sendAct(nx, { type: 'nexo_act', act: 'st', t: '', ts: Date.now() }); });
  _emit('me');
}
function _sendAct(nx, act) {
  var id = _sendTextTo(nx, JSON.stringify(act), '', true);
  if (id) _outIds.set(id, nx);
  return id;
}
function _broadcastItem(nx, s) {
  var act = { type: 'nexo_act', act: 'st', sid: s.sid, t: s.t || '', ts: s.ts };
  if (s.img) { act.img = s.img; act.mime = s.mime || 'image/jpeg'; }
  if (s.aud) { act.aud = s.aud; act.amime = s.amime || 'audio/webm'; }
  if (s.vid) { act.vid = s.vid; act.vmime = s.vmime || 'video/webm'; }
  if (s.big) { act.big = s.big; if (s.ptr) act.ptr = s.ptr; }
  return _sendAct(nx, act);
}
// Manda a nx los estados activos que aún no tiene (force: todos otra vez, p. ej. si los pidió con «sq»)
export function sendStatusTo(nx, force) {
  nx = _normId(nx);
  var act = myStatuses();
  if (!act.length || !NX_RE.test(nx) || _contactIds().indexOf(nx) < 0) return 0;
  var s = _sent[nx] = (_sent[nx] && typeof _sent[nx] === 'object') ? _sent[nx] : {};
  var n = 0;
  act.forEach(function(it) { if (force || !s[it.sid]) { if (_broadcastItem(nx, it)) { s[it.sid] = 1; n++; } } });
  Object.keys(s).forEach(function(k) { if (!act.some(function(x) { return x.sid === k; })) delete s[k]; });
  if (n) _save(SENT_FILE, _sent);
  return n;
}

// ---- Recibir ----
// Un contacto publicó / quitó un estado (con sid) o su estado único (sin sid, builds anteriores: reemplaza todos)
export function applyStatus(senderNx, act) {
  var nx = _normId(senderNx);
  if (!NX_RE.test(nx) || !act) return;
  // Robustez (auditoría 2800): el ts lo pone el OTRO teléfono; uno en el futuro (reloj malo o malicioso) haría que su estado
  // nunca caducara. Se acota a «ahora». Un ts negativo/no numérico también cae a ahora.
  var now = Date.now();
  var ts = (typeof act.ts === 'number' && act.ts > 0) ? Math.min(act.ts, now) : now;
  var sid = SID_RE.test(String(act.sid || '')) ? String(act.sid) : '';
  var list = statusesOf(nx);
  if (sid && act.del) list = list.filter(function(x) { return x.sid !== sid; });
  else {
    var it = _item(Object.assign({}, act, { ts: ts }), sid || ('l' + ts.toString(36)));
    var ok = it && _active(it);
    if (!sid) { if (ok) it.lg = 1; list = ok ? [it] : []; }               // estado único (build anterior): reemplaza
    else if (ok) { list = list.filter(function(x) { return x.sid !== sid && !x.lg; }).concat([it]); } // ya manda con sid: lo de antes sobra
    list = _activeList(list).slice(-MAX_ITEMS);
  }
  if (list.length) _cache.set(nx, list); else _cache.delete(nx);
  _saveContact(nx);
  _markSte(nx, list.length > 0);
  _emit(nx);
}
// Pidieron mis estados (deslizar para actualizar en su lista): se los reenvío todos (con freno)
export function statusQueryReceived(senderNx) {
  var nx = _normId(senderNx), now = Date.now();
  if (!NX_RE.test(nx) || now - (_sqIn.get(nx) || 0) < SQ_GAP_MS) return 0;
  _sqIn.set(nx, now);
  return sendStatusTo(nx, true);
}
// Deslizar hacia abajo en Contactos: pedir los estados a los contactos a la vista (enlace vivo o internet)
export function requestStatuses() {
  var bi = window.bleInterface, now = Date.now(), n = 0;
  _contactIds().forEach(function(nx) {
    var via = 'none'; try { via = bi && typeof bi.linkOf === 'function' ? bi.linkOf(nx) : 'none'; } catch (e) {}
    if (via === 'none' || now - (_sqOut.get(nx) || 0) < SQ_GAP_MS) return;
    _sqOut.set(nx, now);
    if (_sendAct(nx, { type: 'nexo_act', act: 'sq', ts: now })) n++;
  });
  _contactIds().forEach(function(nx) { statusesOf(nx); }); // de paso, fuera los caducados
  _renderStrip();
  console.log('[ESTADO] Actualizar: pedidos a ' + n + ' contacto(s)');
  return n;
}

// ---- Media grande de un estado (3032) ----
// La media de un estado (data URI): memoria → archivo → buzón de archivos (puntero) → pedirla al dueño por el enlace directo
export function statusMedia(owner, it) {
  owner = owner === 'me' ? 'me' : _normId(owner);
  if (!it || !it.big) return Promise.resolve(it ? (it.img || it.vid || it.aud || null) : null);
  var key = owner + '|' + it.sid;
  if (_media.has(key)) return Promise.resolve(_media.get(key));
  return _load(_mediaFile(owner, it.sid)).then(function(o) {
    var d = o && typeof o.d === 'string' && _bigOf(o.d) ? o.d : '';
    if (d) { _media.set(key, d); return d; }
    if (owner === 'me') return null;
    var net = window.bleInterface && window.bleInterface.net;
    var viaPtr = (it.ptr && net && typeof net.online === 'function' && net.online())
      ? fetchBlob(net, it.ptr).then(function(res) { return 'data:' + it.big.mime + ';base64,' + res.b64; }).catch(function(e) { console.warn('[ESTADO] media de ' + owner + ' ' + it.sid + ' no bajó del buzón (' + ((e && e.message) || e) + '): la pido directo'); return null; })
      : Promise.resolve(null);
    return viaPtr.then(function(d2) { return d2 || _requestMedia(owner, it); }).then(function(d3) {
      if (d3 && _bigOf(d3)) { _media.set(key, d3); _save(_mediaFile(owner, it.sid), { d: d3 }); return d3; }
      return null;
    });
  });
}
function _requestMedia(nx, it) {
  var key = nx + '|' + it.sid, now = Date.now();
  return new Promise(function(resolve) {
    var list = _smWait.get(key) || []; list.push(resolve); _smWait.set(key, list);
    setTimeout(function() { var l = _smWait.get(key); if (l && l.indexOf(resolve) >= 0) { l.splice(l.indexOf(resolve), 1); resolve(null); } }, SM_WAIT_MS);
    if (now - (_smOut.get(key) || 0) < SM_GAP_MS) return;
    _smOut.set(key, now);
    console.log('[ESTADO] pido la media de ' + it.sid + ' a ' + nx + ' por el enlace directo');
    _sendAct(nx, { type: 'nexo_act', act: 'sm', sid: it.sid, ts: now });
  });
}
// Me piden la media de uno de mis estados: se la mando como archivo («stmedia») por el enlace directo de ahora
export function statusMediaRequested(senderNx, act) {
  var nx = _normId(senderNx), sid = act && SID_RE.test(String(act.sid || '')) ? String(act.sid) : '';
  var it = sid ? myStatuses().find(function(x) { return x.sid === sid && x.big; }) : null;
  var bi = window.bleInterface, ack = bi && bi.ackSystem, now = Date.now(), key = nx + '|' + sid;
  if (!NX_RE.test(nx) || !it || _contactIds().indexOf(nx) < 0 || !ack || typeof ack.sendFile !== 'function') return false;
  if (now - (_smIn.get(key) || 0) < SM_GAP_MS) return false;
  var dev = typeof bi._resolveDeviceIdForNexoId === 'function' ? bi._resolveDeviceIdForNexoId(nx) : null;
  if (!dev) return false;                                    // sin enlace: no al buzón (allí se vería como un adjunto del chat)
  _smIn.set(key, now);
  statusMedia('me', it).then(function(d) {
    if (!d) return;
    console.log('[ESTADO] mando la media de ' + sid + ' a ' + nx + ' (' + Math.round(it.big.size / 1024) + ' KB)');
    ack.sendFile(dev, 'stm' + sid + now.toString(36), _b64Of(d), { type: 'stmedia', sid: sid, name: 'st:' + sid, mime: it.big.mime, to: nx }).catch(function(e) { console.warn('[ESTADO] la media de ' + sid + ' a ' + nx + ' no salió (' + ((e && e.message) || e) + ')'); });
  });
  return true;
}
// Me llegó la media («stmedia») de un estado de un contacto
export function statusMediaIn(senderNx, meta, b64) {
  // el sid viaja en el nombre del archivo («st:<sid>»): los datos del archivo solo llevan campos fijos
  var nm = meta && /^st:([a-z0-9]{4,24})$/.exec(String(meta.name || '')), nx = _normId(senderNx);
  var sid = meta && SID_RE.test(String(meta.sid || '')) ? String(meta.sid) : (nm ? nm[1] : '');
  var it = sid ? statusesOf(nx).find(function(x) { return x.sid === sid && x.big; }) : null;
  if (!it || typeof b64 !== 'string') return false;
  var d = 'data:' + it.big.mime + ';base64,' + b64, b = _bigOf(d);
  if (!b || b.size !== it.big.size) { console.warn('[ESTADO] media de ' + nx + ' ' + sid + ' no coincide con lo anunciado: descartada'); return false; }
  var key = nx + '|' + sid;
  _media.set(key, d); _save(_mediaFile(nx, sid), { d: d });
  var l = _smWait.get(key) || []; _smWait.delete(key); l.forEach(function(fn) { try { fn(d); } catch (e) {} });
  console.log('[ESTADO] media de ' + sid + ' de ' + nx + ' recibida por el enlace directo (' + Math.round(b.size / 1024) + ' KB)');
  _emit(nx);
  return true;
}

// ---- «Me gusta» y comentarios ----
function _sidOrLatest(list, sid) { var it = sid ? list.find(function(x) { return x.sid === sid; }) : null; return it || (sid ? null : list[list.length - 1] || null); }
// Le doy me gusta a un estado de nx (sid; sin sid, al más reciente)
export function likeStatus(nx, sid) {
  nx = _normId(nx);
  var it = _sidOrLatest(statusesOf(nx), sid);
  if (!NX_RE.test(nx) || !it || _iLiked.has(nx + '|' + it.sid)) return false;
  var ok = !!_sendAct(nx, { type: 'nexo_act', act: 'sl', sid: it.sid, ts: Date.now() });
  if (ok) _iLiked.add(nx + '|' + it.sid);
  return ok;
}
export function iLiked(nx, sid) { return _iLiked.has(_normId(nx) + '|' + sid); }
// A MÍ me llegó un me gusta (de senderNx) a uno de mis estados
export function likeReceived(senderNx, act) {
  var nx = _normId(senderNx);
  var it = _sidOrLatest(myStatuses(), act && SID_RE.test(String(act.sid || '')) ? String(act.sid) : '');
  if (!NX_RE.test(nx) || !it) return;
  it.likes = it.likes || {};
  if (it.likes[nx]) return;                                   // un me gusta por contacto y estado
  it.likes[nx] = Date.now();
  _saveMine();
  _toast('❤️ ' + _contactName(nx) + ' ' + t('est_liked_your', 'le gustó tu estado'));
  _emit('me');
}
// Cuántos me gusta (de un estado, o de todos los activos)
export function myLikes(sid) {
  var l = myStatuses().filter(function(x) { return !sid || x.sid === sid; });
  return l.reduce(function(n, x) { return n + Object.keys(x.likes || {}).length; }, 0);
}
// Quién le dio me gusta a uno de mis estados: [{ nx, name, ts }]
export function whoLiked(sid) {
  var it = myStatuses().find(function(x) { return x.sid === sid; });
  return it ? Object.keys(it.likes || {}).map(function(nx) { return { nx: nx, name: _contactName(nx), ts: it.likes[nx] }; }).sort(function(a, b) { return a.ts - b.ts; }) : [];
}
// Comento un estado de nx: le llega SOLO al dueño (decisión del dueño 12-11)
export function commentStatus(nx, sid, text) {
  nx = _normId(nx);
  text = String(text == null ? '' : text).trim().substring(0, MAX_LEN);
  var it = _sidOrLatest(statusesOf(nx), sid);
  if (!NX_RE.test(nx) || !it || !text) return false;
  return !!_sendAct(nx, { type: 'nexo_act', act: 'sc', sid: it.sid, t: text, ts: Date.now() });
}
// A MÍ me comentaron un estado
export function commentReceived(senderNx, act) {
  var nx = _normId(senderNx);
  var text = act && typeof act.t === 'string' ? act.t.trim().substring(0, MAX_LEN) : '';
  var it = _sidOrLatest(myStatuses(), act && SID_RE.test(String(act.sid || '')) ? String(act.sid) : '');
  if (!NX_RE.test(nx) || !it || !text) return;
  var now = Date.now(), ts = (typeof act.ts === 'number' && act.ts > 0) ? Math.min(act.ts, now) : now;
  it.comments = (it.comments || []).concat([{ nx: nx, t: text, ts: ts }]).slice(-MAX_COMMENTS);
  _saveMine();
  _toast('💬 ' + _contactName(nx) + ' ' + t('est_commented_your', 'comentó tu estado') + ': ' + text.substring(0, 60));
  _emit('me');
}
// Comentarios de uno de mis estados: [{ nx, name, t, ts }]
export function myComments(sid) {
  var it = myStatuses().find(function(x) { return x.sid === sid; });
  return it ? (it.comments || []).map(function(c) { return { nx: c.nx, name: _contactName(c.nx), t: c.t, ts: c.ts }; }) : [];
}

function _toast(msg) {
  try {
    var el = document.createElement('div');
    el.style.cssText = 'position:fixed;left:50%;bottom:80px;transform:translateX(-50%);background:#0a0a15;border:1px solid #00c8ff;color:#fff;padding:10px 16px;border-radius:12px;z-index:7000;font-size:14px;max-width:80%;text-align:center;';
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(function() { try { el.remove(); } catch (e) {} }, 3000);
  } catch (e) {}
}

// Contactos (con nombre) que tienen estados activos ahora
function _activeContacts() {
  var out = [];
  _getBLEContacts().forEach(function(c) {
    var nx = _normId(c.nexoId || c.deviceUUID);
    var l = statusesOf(nx);
    if (!l.length) return;
    var last = l[l.length - 1], seen = _seen.get(nx);
    out.push({ nx: nx, name: c.name || nx.toUpperCase(), items: l, img: (l.filter(function(x) { return x.img; }).pop() || {}).img || '', n: l.length, unseen: l.filter(function(x) { return !(seen && seen.has(x.sid)); }).length, ts: last.ts });
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
  var mine = myStatuses(), last = mine[mine.length - 1];
  var myImg = (mine.filter(function(x) { return x.img; }).pop() || {}).img || '';
  el.appendChild(_chip(t('grp_my_status', 'Mi estado'), mine.length ? t('grp_your_status', 'Tu estado') + (mine.length > 1 ? ' (' + mine.length + ')' : '') : t('grp_my_status', 'Mi estado'), function() { if (mine.length) _myView(); else _compose(); }, !mine.length, myImg));
  if (last && !myImg) { var mc = el.lastChild.querySelector('div'); if (mc) { mc.textContent = (last.t || '·').substring(0, 1).toUpperCase(); mc.style.background = 'var(--nx-grad,linear-gradient(135deg,#00c8ff,#a855f7))'; } }
  _activeContacts().forEach(function(c) {
    var ch = _chip(c.name, c.name + (c.n > 1 ? ' (' + c.n + ')' : ''), function() { _view(c); }, false, c.img);
    if (!c.unseen) { var cc = ch.querySelector('div'); if (cc) cc.style.borderColor = 'rgba(255,255,255,0.25)'; }   // ya vistos: aro gris
    el.appendChild(ch);
  });
  el.style.display = 'flex'; // siempre visible (al menos «Mi estado»)
}
// 2999 (dueño 10-11: «en un estado no hay razón de que esté el botón de agregar contacto»): el botón flotante de la burbuja de chat
// (#ble-fab-btn, abre el panel «Agregar contactos») va por encima de todo; mientras hay un estado abierto (verlo o componerlo) se oculta
// y vuelve cuando se cierra, sea por donde sea que se cierre.
var _fabWatch = null;
function _hideFabWhileOpen() {
  var fab = document.getElementById('ble-fab-btn');
  if (!fab) return;
  if (!_fabWatch) fab.setAttribute('data-estado-prev', fab.style.display || '');
  fab.style.display = 'none';
  if (_fabWatch) return;
  _fabWatch = new MutationObserver(function() {
    if (document.getElementById('estado-overlay')) return;
    var f = document.getElementById('ble-fab-btn');
    if (f) { f.style.display = f.getAttribute('data-estado-prev') || ''; f.removeAttribute('data-estado-prev'); }
    try { _fabWatch.disconnect(); } catch (e) {}
    _fabWatch = null;
  });
  _fabWatch.observe(document.body, { childList: true });
}
function _overlay() {
  var o = document.getElementById('estado-overlay');
  if (o) o.remove();
  o = document.createElement('div');
  o.id = 'estado-overlay';
  o.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.9);z-index:6000;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:16px;padding:24px;';
  o.addEventListener('click', function(e) { if (e.target === o) o.remove(); });
  document.body.appendChild(o);
  _hideFabWhileOpen();
  return o;
}
function _compose() {
  var o = _overlay();
  var box = document.createElement('div');
  box.style.cssText = 'background:#0a0a15;border:1px solid #00c8ff;border-radius:16px;padding:20px;max-width:340px;width:100%;color:#fff;display:flex;flex-direction:column;gap:12px;';
  var h = document.createElement('div'); h.style.cssText = 'font-weight:700;color:#00c8ff;'; h.textContent = t('grp_my_status_24h', 'Mi estado (24 h)');
  var m = null;   // 3032: «Publicar» crea un estado NUEVO (hasta 10); los anteriores se ven y se quitan en «Mis estados»
  var picked = { img: '', mime: '', aud: '', amime: '', vid: '', vmime: '' };
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
  // elegir foto
  var fin = document.createElement('input'); fin.type = 'file'; fin.accept = 'image/*'; fin.style.display = 'none';
  fin.addEventListener('change', function() {
    var f = fin.files && fin.files[0]; if (!f) return;
    makeStatusImage(f).then(function(dataUri) {
      if (!_validImg(dataUri) && !_bigOf(dataUri)) { _toast(t('est_img_too_big', 'La foto es muy pesada para un estado')); return; }
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
          if (!_validAud(d) && !_bigOf(d)) { _toast(t('est_aud_too_big', 'El audio es muy largo/pesado para un estado')); return; }
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
    // 3032: un video de hasta 5 MB va tal cual (sin recomprimir); más grande, la previa liviana de siempre
    if (f.size && f.size <= BIG_MAX && /^video\//.test(f.type || '')) {
      var frv = new FileReader();
      frv.onload = function() {
        var dv = String(frv.result || '');
        if (!_validVid(dv) && !_bigOf(dv)) { _toast(t('est_vid_too_big', 'El video quedó muy pesado para un estado')); return; }
        picked.vid = dv; picked.vmime = (f.type || 'video/mp4').split(';')[0];
        vidPrev.src = dv; vidPrev.style.display = 'block';
        picked.img = ''; prev.removeAttribute('src'); prev.style.display = 'none';
        picked.aud = ''; audPrev.removeAttribute('src'); audPrev.style.display = 'none';
      };
      frv.readAsDataURL(f);
      return;
    }
    var mk = (typeof window.NEXO_makeVideoPreview === 'function') ? window.NEXO_makeVideoPreview : _makeVideoPreview;
    vidBtn.textContent = '🎥 ' + t('est_processing', 'Procesando…'); vidBtn.disabled = true;
    // 3035 (dueño 13-11: videos de otras apps, tipo TikTok): más de 5 MB → se recodifica en 720p con el bitrate justo para
    // caber (VID_HD_TARGET); si ese HD no sale o no cabe, la previa liviana de siempre.
    Promise.resolve(mk(f, undefined, { hdTargetBytes: VID_HD_TARGET })).then(function(res) {
      vidBtn.textContent = '🎥 ' + t('est_add_video', 'Video'); vidBtn.disabled = false;
      if (!res || res.tooLong || !res.size) { _toast(res && res.tooLong ? t('est_vid_too_long', 'El video es muy largo para un estado') : t('est_vid_fail', 'No se pudo preparar el video')); return; }
      if (res.hd && res.hd.size > 0 && res.hd.size <= BIG_MAX) { console.log('[ESTADO] Video de ' + Math.round(f.size / 1024) + ' KB → 720p de ' + Math.round(res.hd.size / 1024) + ' KB'); res = res.hd; } // i18n-ok
      return _blobToB64(res).then(function(b64) {
        var d = 'data:' + ((res.type || 'video/webm').split(';')[0]) + ';base64,' + b64;
        if (!_validVid(d) && !_bigOf(d)) { _toast(t('est_vid_too_big', 'El video quedó muy pesado para un estado')); return; }
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
  pub.addEventListener('click', function(e) { e.stopPropagation(); _stopRec(); if (addMyStatus(ta.value, picked.img, picked.mime, picked.aud, picked.amime, picked.vid, picked.vmime)) o.remove(); });
  row.appendChild(pub);
  box.appendChild(h); box.appendChild(prev); box.appendChild(vidPrev); box.appendChild(audPrev); box.appendChild(ta);
  var mrow = document.createElement('div'); mrow.style.cssText = 'display:flex;gap:10px;';
  mrow.appendChild(photoBtn); mrow.appendChild(audBtn); mrow.appendChild(vidBtn);
  box.appendChild(mrow); box.appendChild(fin); box.appendChild(vfin); box.appendChild(row);
  o.appendChild(box);
  setTimeout(function() { try { ta.focus(); } catch (e) {} }, 50);
}
// Ver los estados de un contacto: uno a la vez (‹ ›), empezando por el primero sin ver; me gusta y comentario por estado
function _view(c) {
  var o = _overlay();
  var items = statusesOf(c.nx);
  if (!items.length) { o.remove(); return; }
  var seen = _seen.get(c.nx) || new Set(); _seen.set(c.nx, seen);
  var idx = items.findIndex(function(x) { return !seen.has(x.sid); });
  if (idx < 0) idx = 0;
  var box = document.createElement('div');
  box.id = 'estado-view';
  box.style.cssText = 'max-width:360px;width:100%;color:#fff;display:flex;flex-direction:column;gap:10px;';
  o.appendChild(box);
  var paint = function() {
    var it = items[idx];
    seen.add(it.sid);
    box.innerHTML = '';
    // 2999 (dueño 10-11): tocar el NOMBRE del dueño del estado abre el chat con él
    var head = document.createElement('div'); head.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:8px;';
    var who = document.createElement('div'); who.id = 'estado-who'; who.style.cssText = 'font-weight:700;color:#00c8ff;cursor:pointer;display:inline-flex;align-items:center;gap:6px;padding:4px 0;';
    who.textContent = c.name + ' ›'; who.title = t('est_open_chat', 'Abrir el chat');
    who.addEventListener('click', function(e) {
      e.stopPropagation();
      var bi = window.bleInterface;
      o.remove();
      try { if (bi && typeof bi.openChat === 'function') bi.openChat(c.nx).catch(function() {}); } catch (err) {}
    });
    var cnt = document.createElement('div'); cnt.id = 'estado-pos'; cnt.style.cssText = 'font-size:12px;color:#aaa;'; cnt.textContent = (idx + 1) + '/' + items.length;
    head.appendChild(who); head.appendChild(cnt);
    var when = document.createElement('div'); when.style.cssText = 'font-size:12px;color:#888;'; when.textContent = _ago(it.ts);
    box.appendChild(head); box.appendChild(when);
    if (it.img) { var im = document.createElement('img'); im.src = it.img; im.style.cssText = 'width:100%;max-height:55vh;object-fit:contain;border-radius:12px;background:#000;'; box.appendChild(im); }
    if (it.vid) { var vd = document.createElement('video'); vd.id = 'estado-video'; vd.controls = true; vd.src = it.vid; vd.playsInline = true; vd.style.cssText = 'width:100%;max-height:55vh;border-radius:12px;background:#000;'; box.appendChild(vd); }
    if (it.aud) { var au = document.createElement('audio'); au.id = 'estado-audio'; au.controls = true; au.src = it.aud; au.style.cssText = 'width:100%;'; box.appendChild(au); }
    if (it.big) _bigEl(box, c.nx, it);
    if (it.t) { var txt = document.createElement('div'); txt.style.cssText = 'font-size:20px;line-height:1.5;white-space:pre-wrap;word-break:break-word;'; txt.innerHTML = _esc(it.t); box.appendChild(txt); }
    // ‹ anterior / siguiente ›
    if (items.length > 1) {
      var nav = document.createElement('div'); nav.style.cssText = 'display:flex;gap:10px;';
      var mk = function(id, label, dis, fn) { var b = document.createElement('button'); b.id = id; b.textContent = label; b.disabled = dis; b.style.cssText = 'flex:1;padding:8px;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.2);border-radius:10px;color:#fff;cursor:pointer;' + (dis ? 'opacity:0.35;' : ''); b.addEventListener('click', function(e) { e.stopPropagation(); fn(); }); return b; };
      nav.appendChild(mk('estado-prev', '‹', idx === 0, function() { idx--; paint(); }));
      nav.appendChild(mk('estado-next', '›', idx >= items.length - 1, function() { idx++; paint(); }));
      box.appendChild(nav);
    }
    // «Me gusta»
    var like = document.createElement('button');
    like.id = 'estado-like';
    like.style.cssText = 'align-self:flex-start;padding:9px 16px;background:rgba(255,59,48,0.18);border:1px solid #ff6b9d;border-radius:20px;color:#fff;font-size:15px;cursor:pointer;';
    var liked = iLiked(c.nx, it.sid);
    like.textContent = liked ? '❤️ ' + t('est_liked', 'Te gustó') : '🤍 ' + t('est_like', 'Me gusta');
    like.disabled = liked;
    like.addEventListener('click', function(e) {
      e.stopPropagation();
      if (likeStatus(c.nx, it.sid)) { like.textContent = '❤️ ' + t('est_liked', 'Te gustó'); like.disabled = true; like.style.opacity = '0.8'; }
    });
    box.appendChild(like);
    // Comentario: le llega SOLO al dueño del estado
    var crow = document.createElement('div'); crow.style.cssText = 'display:flex;gap:8px;';
    var cin = document.createElement('input'); cin.id = 'estado-comentar-input'; cin.type = 'text'; cin.maxLength = MAX_LEN;
    cin.placeholder = t('est_comment_ph', 'Comentar (solo lo verá ') + c.name + ')';
    cin.style.cssText = 'flex:1;min-width:0;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.15);border-radius:18px;color:#fff;font-size:14px;padding:9px 12px;outline:none;';
    cin.addEventListener('click', function(e) { e.stopPropagation(); });
    var cbtn = document.createElement('button'); cbtn.id = 'estado-comentar-btn'; cbtn.textContent = t('est_comment_send', 'Enviar');
    cbtn.style.cssText = 'padding:9px 14px;background:linear-gradient(135deg,#00c8ff,#a855f7);border:none;border-radius:18px;color:#fff;font-weight:700;cursor:pointer;';
    cbtn.addEventListener('click', function(e) {
      e.stopPropagation();
      if (commentStatus(c.nx, it.sid, cin.value)) { cin.value = ''; _toast(t('est_comment_sent', 'Comentario enviado a ') + c.name); }
    });
    crow.appendChild(cin); crow.appendChild(cbtn);
    box.appendChild(crow);
    _renderStrip();
  };
  paint();
}

// Media grande en el visor: «Cargando…» mientras se baja (buzón de archivos o enlace directo)
function _bigEl(box, owner, it) {
  var el;
  var tag = { img: 'img', vid: 'video', aud: 'audio' }[it.big.k];
  var css = { img: 'width:100%;max-height:55vh;object-fit:contain;border-radius:12px;background:#000;', vid: 'width:100%;max-height:55vh;border-radius:12px;background:#000;', aud: 'width:100%;' }[it.big.k];
  el = document.createElement(tag);
  el.id = { img: 'estado-img-grande', vid: 'estado-video', aud: 'estado-audio' }[it.big.k];
  el.style.cssText = css;
  if (tag !== 'img') el.controls = true;
  if (tag === 'video') el.playsInline = true;
  var ph = document.createElement('div'); ph.id = 'estado-cargando'; ph.style.cssText = 'font-size:13px;color:#00c8ff;'; ph.textContent = '⏳ ' + t('est_loading', 'Cargando…') + ' (' + Math.round(it.big.size / 1024) + ' KB)';
  el.style.display = 'none';
  box.appendChild(ph); box.appendChild(el);
  statusMedia(owner, it).then(function(d) {
    if (d) { el.src = d; el.style.display = ''; ph.remove(); }
    else ph.textContent = t('est_media_fail', 'No se pudo bajar todavía: se reintenta cuando el otro esté cerca o en línea');
  });
}

// Mis estados: cada uno con quién le dio me gusta y los comentarios (solo los veo yo); quitar uno; «+ Nuevo»
function _myView() {
  var o = _overlay();
  var box = document.createElement('div');
  box.id = 'estado-mios';
  box.style.cssText = 'background:#0a0a15;border:1px solid #00c8ff;border-radius:16px;padding:16px;max-width:360px;width:100%;max-height:85vh;overflow-y:auto;color:#fff;display:flex;flex-direction:column;gap:12px;';
  var paint = function() {
    var list = myStatuses();
    box.innerHTML = '';
    var h = document.createElement('div'); h.style.cssText = 'font-weight:700;color:#00c8ff;'; h.textContent = t('est_my_statuses', 'Mis estados') + ' (' + list.length + '/' + MAX_ITEMS + ')';
    box.appendChild(h);
    var nuevo = document.createElement('button'); nuevo.id = 'estado-nuevo';
    nuevo.textContent = '＋ ' + t('est_new', 'Nuevo estado');
    nuevo.disabled = list.length >= MAX_ITEMS;
    nuevo.style.cssText = 'padding:10px;background:linear-gradient(135deg,#00c8ff,#a855f7);border:none;border-radius:10px;color:#fff;font-weight:700;cursor:pointer;' + (nuevo.disabled ? 'opacity:0.4;' : '');
    nuevo.addEventListener('click', function(e) { e.stopPropagation(); if (myStatuses().length >= MAX_ITEMS) { _toast(t('est_max', 'Ya tienes 10 estados: quita uno para publicar otro')); return; } _compose(); });
    box.appendChild(nuevo);
    if (!list.length) { o.remove(); return; }
    list.slice().reverse().forEach(function(it) {
      var card = document.createElement('div'); card.className = 'estado-mio'; card.setAttribute('data-sid', it.sid);
      card.style.cssText = 'border:1px solid rgba(255,255,255,0.12);border-radius:12px;padding:10px;display:flex;flex-direction:column;gap:6px;';
      var top = document.createElement('div'); top.style.cssText = 'display:flex;gap:10px;align-items:center;';
      if (it.img) { var im = document.createElement('img'); im.src = it.img; im.style.cssText = 'width:48px;height:48px;object-fit:cover;border-radius:8px;flex-shrink:0;'; top.appendChild(im); }
      var info = document.createElement('div'); info.style.cssText = 'flex:1;min-width:0;';
      var tx = document.createElement('div'); tx.style.cssText = 'font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
      var kk = it.big ? it.big.k : (it.vid ? 'vid' : it.aud ? 'aud' : it.img ? 'img' : '');
      tx.textContent = it.t || (kk === 'vid' ? '🎥 ' + t('est_add_video', 'Video') : kk === 'aud' ? '🎤 ' + t('est_add_audio', 'Audio') : kk === 'img' ? '📷 ' + t('est_add_photo', 'Foto') : '');
      var wh = document.createElement('div'); wh.style.cssText = 'font-size:11px;color:#888;'; wh.textContent = _ago(it.ts);
      info.appendChild(tx); info.appendChild(wh); top.appendChild(info);
      var del = document.createElement('button'); del.className = 'estado-quitar'; del.textContent = t('grp_remove', 'Quitar');
      del.style.cssText = 'padding:6px 10px;background:rgba(255,59,48,0.3);border:1px solid #FF3B30;border-radius:8px;color:#fff;font-size:12px;cursor:pointer;flex-shrink:0;';
      del.addEventListener('click', function(e) { e.stopPropagation(); removeMyStatus(it.sid); paint(); });
      top.appendChild(del);
      card.appendChild(top);
      // Quién le dio me gusta
      var who = whoLiked(it.sid);
      var lk = document.createElement('div'); lk.className = 'estado-likes'; lk.style.cssText = 'font-size:13px;color:#ff6b9d;';
      lk.textContent = who.length ? '❤️ ' + who.length + ' · ' + who.map(function(w) { return w.name; }).join(', ') : '🤍 ' + t('est_no_likes', 'Aún sin me gusta');
      card.appendChild(lk);
      // Comentarios (solo los ves tú)
      myComments(it.sid).forEach(function(cm) {
        var cr = document.createElement('div'); cr.className = 'estado-comentario'; cr.style.cssText = 'font-size:13px;background:rgba(255,255,255,0.06);border-radius:8px;padding:6px 8px;';
        var nm = document.createElement('b'); nm.style.color = '#00c8ff'; nm.textContent = cm.name + ': ';
        var ct = document.createElement('span'); ct.textContent = cm.t;
        cr.appendChild(nm); cr.appendChild(ct); card.appendChild(cr);
      });
      box.appendChild(card);
    });
  };
  o.appendChild(box);
  paint();
}

// ---------- Deslizar hacia abajo en Contactos: pedir los estados (dueño 12-11) ----------
var _pullAttached = false;
function _attachPull() {
  if (_pullAttached) return;
  var cv = document.getElementById('contacts-view');
  if (!cv) { setTimeout(_attachPull, 1000); return; }
  _pullAttached = true;
  var y0 = null, dy = 0, ind = null;
  var showInd = function(txt) {
    if (!ind) { ind = document.createElement('div'); ind.id = 'estados-pull'; ind.style.cssText = 'text-align:center;font-size:12px;color:#00c8ff;padding:6px 0;'; cv.insertBefore(ind, cv.firstChild); }
    ind.textContent = txt;
  };
  var hideInd = function(ms) { setTimeout(function() { if (ind) { try { ind.remove(); } catch (e) {} ind = null; } }, ms || 0); };
  cv.addEventListener('touchstart', function(e) { y0 = (cv.scrollTop <= 0 && e.touches && e.touches[0]) ? e.touches[0].clientY : null; dy = 0; }, { passive: true });
  cv.addEventListener('touchmove', function(e) {
    if (y0 === null || !e.touches || !e.touches[0]) return;
    dy = e.touches[0].clientY - y0;
    if (dy > 20) showInd(dy > PULL_PX ? '↻ ' + t('est_pull_release', 'Suelta para actualizar los estados') : '↓ ' + t('est_pull', 'Desliza para actualizar los estados'));
  }, { passive: true });
  cv.addEventListener('touchend', function() {
    if (y0 !== null && dy > PULL_PX) { showInd('↻ ' + t('est_refreshing', 'Actualizando estados…')); requestStatuses(); hideInd(1500); }
    else hideInd(0);
    y0 = null; dy = 0;
  }, { passive: true });
}
var PULL_PX = 70;

if (typeof window !== 'undefined') {
  window.NEXO_composeStatus = _compose; // 3035: pruebas (tests/sim/pedidos13.js)
  window.NEXO_setMyStatus = setMyStatus; window.NEXO_statusOf = statusOf; window.NEXO_applyStatus = applyStatus;
  window.NEXO_likeStatus = likeStatus; window.NEXO_likeReceived = likeReceived; window.NEXO_myLikes = myLikes; // pruebas (tests/sim/estados.js)
  window.NEXO_addMyStatus = addMyStatus; window.NEXO_statusesOf = statusesOf; window.NEXO_myStatuses = myStatuses; window.NEXO_removeMyStatus = removeMyStatus;
  window.NEXO_staleStatusCopy = staleStatusCopy; // 3033: la cola de reenvío (ble_helpers._isResendable, ble_ack) lo consulta
  window.NEXO_commentStatus = commentStatus; window.NEXO_myComments = myComments; window.NEXO_whoLiked = whoLiked; window.NEXO_requestStatuses = requestStatuses; window.NEXO_statusMedia = statusMedia; window.NEXO_statusMediaIn = statusMediaIn; // 3032
}
