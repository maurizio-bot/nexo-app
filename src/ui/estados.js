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
 * - UI: desde la 3169 (dueño 17-11), su propia pantalla «Estados», a la que se llega deslizando Contactos de derecha a izquierda
 *   (estados_screen.js). Aquí quedan el visor y «Mis estados»; publicar (la ventana «Mi estado») está en estados_compose.js
 *   desde la reestructuración del 17-11. La pantalla los abre con lo que se exporta abajo.
 */
import { _getBLEContacts, _normId, _saveBLEContacts } from './ble_helpers.js';
import { _sendTextTo } from './send.js';
import { isBlocked } from './bloqueo.js';
import { vaultDeleteMessage } from '../vault/vault_manager.js';
import { _b64ToBlob } from './video_tools.js';
import { t } from './i18n.js';
import { stageBlob, fetchBlob, validatePointer } from '../net/blob_mailbox.js';
import { _compose } from './estados_compose.js'; // reestructuración 17-11

var MY_FILE = 'nexo_my_status.json', SENT_FILE = 'nexo_status_sent.json';
// 3059 (dueño 13-11: «cuando ves un estado se quita el marcador azul, pero al cerrar y volver a abrir la app vuelven a aparecer
// como nuevos»): lo visto (y a qué di me gusta) vivía solo en memoria. Ahora se guarda en el teléfono; lo de más de 2 días se olvida.
var SEEN_FILE = 'nexo_status_seen.json', SEEN_KEEP_MS = 48 * 3600 * 1000;
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
var SQ_STALE_MS = 120000;                // 3035: una petición «sq» sin entregar caduca a los 2 min (no se reenvía)
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
// 3062 (dueño 13-11: «me comentan que los estados no se están cargando de forma robusta»): al abrir la app, lo que llega mientras
// se leen del disco los estados (los míos y los de cada contacto) espera a que termine la lectura. Antes, un estado que llegaba
// en esos segundos pisaba el archivo del contacto con solo él (se perdían los que ya tenía) y un me gusta o comentario a uno de
// mis estados se perdía (aún no estaban leídos).
var _mineP = null;            // lectura de mis estados en curso
var _loading = new Map();     // NEXO ID → lectura de sus estados en curso

function _pl() { return (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.NexoBLE) || null; }
function _load(name) {
  var pl = _pl();
  if (!pl || typeof pl.loadFromFile !== 'function') return Promise.resolve(null);
  return pl.loadFromFile({ filename: name }).then(function(r) { return r && r.exists && r.content ? JSON.parse(r.content) : null; }).catch(function() { return null; });
}
function _save(name, obj) { var pl = _pl(); if (pl && typeof pl.saveToFile === 'function') pl.saveToFile({ filename: name, content: JSON.stringify(obj) }).catch(function() {}); }
function _emit(nx) { try { window.dispatchEvent(new CustomEvent('nexo:estado', { detail: { nx: nx } })); } catch (e) {} }
function _contactIds() { return _getBLEContacts().map(function(c) { return _normId(c.nexoId || c.deviceUUID); }).filter(function(nx) { return NX_RE.test(nx) && !isBlocked(nx); }); } // bloqueo (24-11): a un bloqueado no le sale lo mío
// 3358 (plan del dueño 27-11, docs/PLAN_CAPACIDAD_27-11.md §6: «lista de quién ve mis estados»): todos / todos menos… / solo… .
// Se guarda en el teléfono; mis estados (y su medio) solo salen a quien puede verlos. Al cambiarla, a quien deja de poder se le quitan
// los que ya tenía (aviso de borrado) y a quien ahora puede se le mandan.
var PRIV_KEY = 'nexo_status_priv';
function _privGet() {
  try { var o = JSON.parse(localStorage.getItem(PRIV_KEY) || 'null'); if (o && (o.m === 'except' || o.m === 'only') && Array.isArray(o.l)) return { m: o.m, l: o.l.map(_normId).filter(function(x) { return NX_RE.test(x); }) }; } catch (e) {}
  return { m: 'all', l: [] };
}
export function statusPrivacy() { return _privGet(); }
export function statusAllowed(nx, p) {
  p = p || _privGet(); nx = _normId(nx);
  if (p.m === 'except') return p.l.indexOf(nx) < 0;
  if (p.m === 'only') return p.l.indexOf(nx) >= 0;
  return true;
}
export function setStatusPrivacy(m, list) {
  var p = { m: (m === 'except' || m === 'only') ? m : 'all', l: (list || []).map(_normId).filter(function(x) { return NX_RE.test(x); }) };
  try { localStorage.setItem(PRIV_KEY, JSON.stringify(p)); } catch (e) {}
  var changed = false;
  _contactIds().forEach(function(nx) {
    if (statusAllowed(nx, p)) { sendStatusTo(nx); return; }
    var st = _sent[nx];
    if (!st) return;
    Object.keys(st).forEach(function(sid) { _sendAct(nx, { type: 'nexo_act', act: 'st', sid: sid, del: 1, t: '', ts: Date.now() }); changed = true; });
    _sent[nx] = {};
  });
  if (changed) _save(SENT_FILE, _sent);
  return p;
}
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
// 3059: lo visto y los me gusta, en disco ({ seen: { nx: { sid: ts } }, liked: { 'nx|sid': ts } })
var _seenAt = {}, _likedAt = {}, _seenT = null, _seenLoaded = false;
function _markSeen(nx, sid) {
  var s = _seen.get(nx); if (!s) { s = new Set(); _seen.set(nx, s); }
  if (s.has(sid) && _seenAt[nx] && _seenAt[nx][sid]) return;
  s.add(sid); (_seenAt[nx] = _seenAt[nx] || {})[sid] = Date.now();
  _saveSeenSoon();
}
function _saveSeenSoon() {
  if (!_seenLoaded) return; // aún no se leyó lo guardado: se guarda al terminar de leer (se juntan las dos cosas)
  clearTimeout(_seenT);
  _seenT = setTimeout(function() {
    var old = Date.now() - SEEN_KEEP_MS;
    Object.keys(_seenAt).forEach(function(nx) {
      Object.keys(_seenAt[nx]).forEach(function(sid) { if (_seenAt[nx][sid] < old) delete _seenAt[nx][sid]; });
      if (!Object.keys(_seenAt[nx]).length) delete _seenAt[nx];
    });
    Object.keys(_likedAt).forEach(function(k) { if (_likedAt[k] < old) delete _likedAt[k]; });
    _save(SEEN_FILE, { v: 1, seen: _seenAt, liked: _likedAt });
  }, 400);
}
function _loadSeen() {
  return _load(SEEN_FILE).then(function(o) {
    var sAt = (o && o.seen && typeof o.seen === 'object') ? o.seen : {}, lAt = (o && o.liked && typeof o.liked === 'object') ? o.liked : {};
    Object.keys(sAt).forEach(function(nx) {
      if (!NX_RE.test(nx) || !sAt[nx] || typeof sAt[nx] !== 'object') return;
      var set = _seen.get(nx); if (!set) { set = new Set(); _seen.set(nx, set); }
      _seenAt[nx] = _seenAt[nx] || {};
      Object.keys(sAt[nx]).forEach(function(sid) { var ts = Number(sAt[nx][sid]) || 0; set.add(sid); if (!_seenAt[nx][sid]) _seenAt[nx][sid] = ts; });
    });
    Object.keys(lAt).forEach(function(k) { _iLiked.add(k); if (!_likedAt[k]) _likedAt[k] = Number(lAt[k]) || 0; });
    _seenLoaded = true;
    if (Object.keys(_seenAt).length || Object.keys(_likedAt).length) _saveSeenSoon();
  });
}
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
  if (c.indexOf('nexo_act') < 0 || !/"act":"s[tq]"/.test(c)) return false;
  var a = null;
  try { a = JSON.parse(c); } catch (e) { return false; }
  if (!a || a.type !== 'nexo_act') return false;
  var sid = SID_RE.test(String(a.sid || '')) ? String(a.sid) : '';
  var why = '';
  // 3035 (diagnóstico S24 APK 3029, 12-11 18:51: «reenvio_sin_fin» con la tablet): la petición «sq» (deslizar para actualizar
  // los estados) quedaba en la cola y se reenviaba sin fin a un teléfono dormido; pasados 2 min ya no sirve: se borra.
  if (a.act === 'sq') { if (!(Date.now() - (Number(a.ts) || 0) > SQ_STALE_MS)) return false; why = 'petición de estados vieja'; } // i18n-ok
  else if (a.act !== 'st' || a.del) return false;
  else if (c.length > STALE_INLINE) why = 'media dentro, ' + Math.round(c.length / 1024) + ' KB';   // i18n-ok (registro)
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
      // 3041: y su transferencia guardada (si no, quedaba huérfana y se reanudaba en cada arranque)
      try { if (typeof window !== 'undefined' && typeof window.vaultRemoveOutgoingTransfer === 'function') window.vaultRemoveOutgoingTransfer(nx, id).catch(function() {}); } catch (e) {}
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
  _mineP = Promise.all([_load(MY_FILE), _load(SENT_FILE), _loadSeen()]).then(function(r) {
    var disk = _fromFile(r[0]).map(function(it) { it.likes = it.likes || {}; it.comments = it.comments || []; return it; });
    // 3062: uno publicado mientras se leía el disco se suma (no se pierde ni pisa los de antes)
    var added = _mine.items.filter(function(x) { return !disk.some(function(y) { return y.sid === x.sid; }); });
    _mine.items = disk.concat(added);
    if (added.length) _saveMine();
    if (r[1] && typeof r[1] === 'object') { Object.keys(r[1]).forEach(function(k) { _sent[k] = (r[1][k] && typeof r[1][k] === 'object') ? r[1][k] : {}; }); }
    _loaded = true;
    _unsent.splice(0).forEach(function(p) { _unmarkSent(p[0], p[1]); }); // 3033
    _mineP = null;
    _emit('me');   // 3169: la pantalla «Estados» (estados_screen.js) se vuelve a pintar con este aviso
  }).catch(function() { _mineP = null; });
  // Los estados de los contactos que los tienen (ste en el contacto)
  _getBLEContacts().forEach(function(c) {
    var nx = _normId(c.nexoId || c.deviceUUID);
    if (!c.ste || !NX_RE.test(nx)) return;
    _loading.set(nx, _load('nexo_status_' + nx + '.json').then(function(o) { _loading.delete(nx); var l = _fromFile(o); if (l.length) { _cache.set(nx, l); _emit(nx); } }, function() { _loading.delete(nx); }));
  });
  window.addEventListener('nexo:ble:peerReady', function(e) {
    var nx = _normId(e && e.detail && e.detail.nexoId);
    if (NX_RE.test(nx)) setTimeout(function() { sendStatusTo(nx); }, 4000);
  });
  window.addEventListener('nexo:ble:ackStatus', function(e) {
    var d = e && e.detail, nx = d && _outIds.get(d.msgId);
    if (nx && (d.status === 'delivered' || d.status === 'read')) { _outIds.delete(d.msgId); vaultDeleteMessage(nx, d.msgId).catch(function() {}); }
  });
  _attachPull();
}

// ---- Lectura ----
export function statusesOf(nx) {
  nx = _normId(nx);
  if (isBlocked(nx)) return []; // bloqueo (24-11): sus estados no se ven
  var l = _activeList(_cache.get(nx));
  if (_cache.has(nx) && l.length !== (_cache.get(nx) || []).length) { if (l.length) _cache.set(nx, l); else _cache.delete(nx); } // caducados fuera
  return l;
}
// El más reciente (compatibilidad: «el estado» de un contacto)
export function statusOf(nx) { var l = statusesOf(nx); return l.length ? l[l.length - 1] : null; }
export function myStatuses() { return _activeList(_mine.items); }

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
  if (!_mineP) _saveMine();   // 3062: si aún se leen del disco, se guarda al sumarlo a los de antes (no pisa el archivo)
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
  if (_mineP) { _mineP.then(function() { sendStatusTo(nx, force); }); return 0; }   // 3062: tras leer mis estados
  var act = myStatuses();
  if (!act.length || !NX_RE.test(nx) || _contactIds().indexOf(nx) < 0 || !statusAllowed(nx)) return 0; // 3358: quien no puede verlos
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
  var pend = _loading.get(nx);
  if (pend) { pend.then(function() { applyStatus(senderNx, act); }); return; }   // 3062: tras leer los que ya tenía de él
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
// 3138 (estados3.js en la batería de la 3133): la petición automática que sale al agregar un contacto (avatar.js, 3129) gastaba el
// freno de 15 s y el «deslizar para actualizar» del usuario justo después no traía nada. Ahora la automática (auto) tiene su freno aparte.
export function statusQueryReceived(senderNx, auto) {
  var nx = _normId(senderNx), now = Date.now(), key = nx + (auto ? ':auto' : '');
  if (!NX_RE.test(nx) || now - (_sqIn.get(key) || 0) < SQ_GAP_MS) return 0;
  _sqIn.set(key, now);
  return sendStatusTo(nx, true);
}
// Deslizar hacia abajo en Contactos: pedir los estados a los contactos a la vista (enlace vivo o internet)
export function requestStatuses() {
  var bi = window.bleInterface, now = Date.now(), n = 0;
  _contactIds().forEach(function(nx) {
    var via = 'none'; try { via = bi && typeof bi.linkOf === 'function' ? bi.linkOf(nx) : 'none'; } catch (e) {}
    if (via === 'none' || now - (_sqOut.get(nx) || 0) < SQ_GAP_MS) return;
    _sqOut.set(nx, now);
    // 3095 (dueño 14-11: «con ese gesto quiero actualizar la pantalla completa… los estados y las fotos de perfiles»): av:1 = «y
    // mándame tu foto de perfil otra vez» (el otro la reenvía aunque crea que ya la tengo)
    if (_sendAct(nx, { type: 'nexo_act', act: 'sq', ts: now, av: 1 })) n++;
  });
  _contactIds().forEach(function(nx) { statusesOf(nx); }); // de paso, fuera los caducados
  _emit('');
  console.log('[ESTADO] Actualizar: pedidos a ' + n + ' contacto(s)');
  return n;
}

// 3095 (dueño 14-11: «con ese gesto quiero actualizar la pantalla completa: los estados y las fotos de perfiles; y aprovechar para
// que los chats estén sincronizados entre mi teléfono y los otros»): deslizar hacia abajo en Contactos ahora (1) pide a cada contacto
// con enlace sus estados y su foto de perfil (una petición, con el freno de 15 s por contacto), (2) reenvía lo mío que esté pendiente,
// (3) pone al día lo de internet (comprueba los relés, vuelve a pedir lo de los últimos minutos y avisa de que estoy en línea) y
// (4) vuelve a dibujar la lista. Ligero: nada se manda dos veces y los mensajes ya entregados no se repiten.
export function refreshAll() {
  var bi = window.bleInterface, n = requestStatuses(), net = bi && bi.net, r = null;
  try { if (bi && typeof bi._flushAllPendingMessages === 'function') bi._flushAllPendingMessages(); } catch (e) {}
  try { if (net && typeof net.refresh === 'function') r = net.refresh('deslizar para actualizar'); } catch (e) {}
  try { if (bi && typeof bi.renderContactsList === 'function') bi.renderContactsList(); } catch (e) {}
  console.log('[ACTUALIZAR] Deslizar: estados y fotos pedidos a ' + n + ' contacto(s); pendientes reenviados; internet: ' +
    (r ? r.relays + ' relé(s) comprobados, lo reciente pedido otra vez' : 'sin conexión'));
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
  if (_mineP) { _mineP.then(function() { statusMediaRequested(senderNx, act); }); return true; }   // 3062
  var nx = _normId(senderNx), sid = act && SID_RE.test(String(act.sid || '')) ? String(act.sid) : '';
  var it = sid ? myStatuses().find(function(x) { return x.sid === sid && x.big; }) : null;
  var bi = window.bleInterface, ack = bi && bi.ackSystem, now = Date.now(), key = nx + '|' + sid;
  if (!NX_RE.test(nx) || !it || _contactIds().indexOf(nx) < 0 || !statusAllowed(nx) || !ack || typeof ack.sendFile !== 'function') return false; // 3358
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
  if (ok) { _iLiked.add(nx + '|' + it.sid); _likedAt[nx + '|' + it.sid] = Date.now(); _saveSeenSoon(); }
  return ok;
}
export function iLiked(nx, sid) { return _iLiked.has(_normId(nx) + '|' + sid); }
// A MÍ me llegó un me gusta (de senderNx) a uno de mis estados
export function likeReceived(senderNx, act) {
  if (_mineP) { _mineP.then(function() { likeReceived(senderNx, act); }); return; }   // 3062: tras leer mis estados
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
  if (_mineP) { _mineP.then(function() { commentReceived(senderNx, act); }); return; }   // 3062: tras leer mis estados
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

// 3141: si llegan varios avisos a la vez, el nuevo reemplaza al anterior (antes se encimaban unos sobre otros)
var _toastTimer = null;
function _toast(msg) {
  try {
    var old = document.getElementById('nexo-est-toast'); if (old) old.remove();
    clearTimeout(_toastTimer);
    var el = document.createElement('div');
    el.id = 'nexo-est-toast';
    el.style.cssText = 'position:fixed;left:50%;bottom:80px;transform:translateX(-50%);background:var(--nx-sheet);border:1px solid var(--nx-line);color:#fff;padding:10px 16px;border-radius:16px;z-index:7000;font-size:14px;max-width:80%;text-align:center;';
    el.textContent = msg;
    document.body.appendChild(el);
    _toastTimer = setTimeout(function() { try { el.remove(); } catch (e) {} }, 3000);
  } catch (e) {}
}

// Contactos (con nombre) que tienen estados activos ahora: { nx, name, items, img, n, unseen, ts }
export function activeStatusContacts() {
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

// ---------- Interfaz: visor, publicar y «Mis estados» (la pantalla «Estados» los abre: estados_screen.js, 3169) ----------
function _ago(ts) { var m = Math.floor((Date.now() - ts) / 60000); if (m < 1) return t('grp_ago_now', 'ahora'); if (m < 60) return t('grp_ago_prefix', 'hace ') + m + t('grp_ago_min', ' min'); return t('grp_ago_prefix', 'hace ') + Math.floor(m / 60) + t('grp_ago_h', ' h'); }
export function statusAgo(ts) { return _ago(ts); }
export function statusSeen(nx, sid) { var s = _seen.get(_normId(nx)); return !!(s && s.has(sid)); }
export function markStatusSeen(nx, sid) { nx = _normId(nx); _markSeen(nx, sid); _emit(nx); }
export function openStatusCompose() { _compose(); }
export function openMyStatuses() { _myView(); }
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
// 3200 (dueño 17-11: Roberto no puede subir un video como estado): la CSP de la app (index.html: media-src 'self' blob:) NO deja
// cargar audio ni video desde «data:», y los estados ponían así su media en el <video>/<audio>: al elegir un video la vista previa
// salía rota (código 4, «Media load rejected by URL safety check») y el visor de los contactos igual, con CUALQUIER video o audio.
// Ahora se reproducen desde una URL «blob:» (la que la CSP deja, como en el chat); cada ventana revoca las suyas al cerrarse.
function _mimeOfData(d) { var m = /^data:([^;,]+)/.exec(String(d || '').substring(0, 80)); return m ? m[1] : ''; }
function _blobUrl(holder, blob) {
  try { var u = URL.createObjectURL(blob); (holder._nxUrls = holder._nxUrls || []).push(u); return u; } catch (e) { return ''; }
}
function _freeUrls(holder) { ((holder && holder._nxUrls) || []).splice(0).forEach(function(u) { try { URL.revokeObjectURL(u); } catch (e) {} }); }
// Media de un estado en el visor; si este teléfono no la puede abrir, un aviso en lugar del reproductor roto (y queda en el registro)
function _playMedia(el, d, holder, what) {
  var mime = _mimeOfData(d), u = '';
  try { u = _blobUrl(holder, _b64ToBlob(_b64Of(d), mime)); } catch (e) {}
  el.addEventListener('error', function() {
    if (!u || el.getAttribute('src') !== u || !el.parentNode) return;
    var er = el.error, aud = el.tagName === 'AUDIO';
    console.warn('[VIDEO] Estado de ' + what + ': este teléfono no puede reproducir ' + (aud ? 'el audio' : 'el video') + ' (' + (mime || '?') + ', ' + Math.round(_rawBytes(_b64Of(d)) / 1024) + ' KB, código ' + (er && er.code) + (er && er.message ? ': ' + er.message : '') + ')');
    var note = document.createElement('div'); note.className = 'estado-no-se-ve';
    note.style.cssText = 'padding:14px;border-radius:12px;background:#000;border:1px solid var(--nx-line);color:var(--nx-muted);font-size:13px;text-align:center;';
    note.textContent = aud ? '🎤 ' + t('est_aud_cant_play', 'Tu teléfono no puede reproducir este audio') : '🎥 ' + t('est_vid_cant_play', 'Tu teléfono no puede reproducir este video');
    el.style.display = 'none';
    el.parentNode.insertBefore(note, el.nextSibling);
  });
  if (el.tagName === 'VIDEO' && !el.getAttribute('poster')) el.setAttribute('poster', _POSTER); // 3230: sin el cuadro gris con ▶ del sistema
  el.src = u || d;
}
var _POSTER = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
export { _playMedia as playStatusMedia, _freeUrls as freeStatusUrls };
function _overlay() {
  var o = document.getElementById('estado-overlay');
  if (o) o.remove();
  o = document.createElement('div');
  o.id = 'estado-overlay';
  o.style.cssText = 'position:fixed;inset:0;background:var(--nx-bg);z-index:6000;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:16px;padding:24px;';
  o.addEventListener('click', function(e) { if (e.target === o) o.remove(); });
  document.body.appendChild(o);
  _hideFabWhileOpen();
  // 3200: al cerrarse (por donde sea) suelta sus URL blob:
  try { var mo = new MutationObserver(function() { if (!o.isConnected) { mo.disconnect(); _freeUrls(o); } }); mo.observe(document.body, { childList: true }); } catch (e) {}
  return o;
}
// Mis estados: cada uno con quién le dio me gusta y los comentarios (solo los veo yo); quitar uno; «+ Nuevo»
// 3358: hoja «Quién ve mis estados» (todos / todos menos… / solo…) con la lista de contactos
function _privSheet(onDone) {
  var prev = document.getElementById('estado-priv'); if (prev) prev.remove();
  var p = _privGet(), mode = p.m, sel = {};
  p.l.forEach(function(x) { sel[x] = 1; });
  var o = document.createElement('div'); o.id = 'estado-priv'; o.className = 'nx-panel';
  o.style.cssText = 'position:fixed;inset:0;background:var(--nx-bg);z-index:6100;display:flex;flex-direction:column;padding:16px;box-sizing:border-box;gap:10px;';
  var h = document.createElement('div'); h.className = 'nx-ask-title'; h.textContent = t('est_priv_btn', 'Quién ve mis estados');
  o.appendChild(h);
  var modes = document.createElement('div'); modes.style.cssText = 'display:flex;flex-direction:column;gap:8px;';
  var listBox = document.createElement('div'); listBox.style.cssText = 'flex:1;overflow-y:auto;display:flex;flex-direction:column;gap:4px;';
  var opts = [['all', t('est_priv_all', 'Todos mis contactos')], ['except', t('est_priv_except', 'Mis contactos, excepto…')], ['only', t('est_priv_only', 'Solo compartir con…')]];
  var paintList = function() {
    listBox.innerHTML = '';
    if (mode === 'all') return;
    _contactIds().forEach(function(nx) {
      var row = document.createElement('label'); row.className = 'estado-priv-row';
      row.style.cssText = 'display:flex;align-items:center;gap:12px;min-height:48px;padding:4px 8px;border-bottom:1px solid var(--nx-line);font-size:15px;';
      var cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = !!sel[nx]; cb.setAttribute('data-nx', nx); cb.style.cssText = 'width:22px;height:22px;flex-shrink:0;';
      cb.addEventListener('change', function() { if (cb.checked) sel[nx] = 1; else delete sel[nx]; });
      var nm = document.createElement('span'); nm.textContent = _contactName(nx); nm.style.cssText = 'flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
      row.appendChild(cb); row.appendChild(nm); listBox.appendChild(row);
    });
  };
  opts.forEach(function(op) {
    var b = document.createElement('label'); b.style.cssText = 'display:flex;align-items:center;gap:12px;min-height:44px;font-size:15px;';
    var r = document.createElement('input'); r.type = 'radio'; r.name = 'estado-priv-m'; r.value = op[0]; r.checked = mode === op[0]; r.style.cssText = 'width:22px;height:22px;';
    r.addEventListener('change', function() { if (r.checked) { mode = op[0]; paintList(); } });
    var tx = document.createElement('span'); tx.textContent = op[1];
    b.appendChild(r); b.appendChild(tx); modes.appendChild(b);
  });
  o.appendChild(modes); o.appendChild(listBox);
  var row = document.createElement('div'); row.style.cssText = 'display:flex;gap:10px;';
  var cancel = document.createElement('button'); cancel.className = 'nx-btn'; cancel.style.flex = '1'; cancel.textContent = t('cancel', 'Cancelar');
  var save = document.createElement('button'); save.id = 'estado-priv-save'; save.className = 'nx-btn nx-btn-primary'; save.style.flex = '1'; save.textContent = t('est_priv_save', 'Guardar');
  cancel.addEventListener('click', function() { o.remove(); });
  save.addEventListener('click', function() { setStatusPrivacy(mode, Object.keys(sel)); o.remove(); if (onDone) onDone(); });
  row.appendChild(cancel); row.appendChild(save); o.appendChild(row);
  document.body.appendChild(o);
  paintList();
}
function _myView() {
  var o = _overlay();
  var box = document.createElement('div');
  box.id = 'estado-mios';
  box.className = 'nx-ask-card nx-ask-flex'; box.style.cssText = 'max-height:85vh;overflow-y:auto;'; // B-EST (26-11): la tarjeta del aviso común
  var paint = function() {
    var list = myStatuses();
    _freeUrls(o);   // 3200: las URL blob: de lo que se vio antes
    box.innerHTML = '';
    var h = document.createElement('div'); h.className = 'nx-ask-title'; h.textContent = t('est_my_statuses', 'Mis estados') + ' (' + list.length + '/' + MAX_ITEMS + ')';
    box.appendChild(h);
    var nuevo = document.createElement('button'); nuevo.id = 'estado-nuevo';
    nuevo.textContent = '＋ ' + t('est_new', 'Nuevo estado');
    nuevo.disabled = list.length >= MAX_ITEMS;
    nuevo.className = 'nx-btn nx-btn-primary'; if (nuevo.disabled) nuevo.style.cssText = 'opacity:0.4;box-shadow:none;';
    nuevo.addEventListener('click', function(e) { e.stopPropagation(); if (myStatuses().length >= MAX_ITEMS) { _toast(t('est_max', 'Ya tienes 10 estados: quita uno para publicar otro')); return; } _compose(); });
    box.appendChild(nuevo);
    var priv = document.createElement('button'); priv.id = 'estado-privacidad'; priv.className = 'nx-btn';
    var pv = _privGet();
    priv.textContent = '👁 ' + t('est_priv_btn', 'Quién ve mis estados') + ': ' + (pv.m === 'all' ? t('est_priv_all', 'Todos mis contactos') : pv.m === 'except' ? t('est_priv_except_n', 'todos menos') + ' ' + pv.l.length : t('est_priv_only_n', 'solo') + ' ' + pv.l.length);
    priv.addEventListener('click', function(e) { e.stopPropagation(); _privSheet(paint); });
    box.appendChild(priv);
    if (!list.length) { o.remove(); return; }
    list.slice().reverse().forEach(function(it) {
      var card = document.createElement('div'); card.className = 'estado-mio'; card.setAttribute('data-sid', it.sid);
      card.style.cssText = 'background:var(--nx-surface);border:1px solid var(--nx-line);border-radius:14px;padding:10px;display:flex;flex-direction:column;gap:6px;';
      var top = document.createElement('div'); top.style.cssText = 'display:flex;gap:10px;align-items:center;';
      if (it.img) { var im = document.createElement('img'); im.src = it.img; im.style.cssText = 'width:48px;height:48px;object-fit:cover;border-radius:12px;flex-shrink:0;'; top.appendChild(im); }
      var info = document.createElement('div'); info.style.cssText = 'flex:1;min-width:0;';
      var tx = document.createElement('div'); tx.style.cssText = 'font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
      var kk = it.big ? it.big.k : (it.vid ? 'vid' : it.aud ? 'aud' : it.img ? 'img' : '');
      tx.textContent = it.t || (kk === 'vid' ? '🎥 ' + t('est_add_video', 'Video') : kk === 'aud' ? '🎤 ' + t('est_add_audio', 'Audio') : kk === 'img' ? '📷 ' + t('est_add_photo', 'Foto') : '');
      var wh = document.createElement('div'); wh.style.cssText = 'font-size:11px;color:var(--nx-muted);'; wh.textContent = _ago(it.ts);
      info.appendChild(tx); info.appendChild(wh); top.appendChild(info);
      // 3200 (dueño 17-11: «publicar Y VER un video de estado tiene que funcionar»): ver mi propio video/audio (o foto grande) aquí.
      // Se carga al tocar «Ver» (no los 10 a la vez) y desde una URL blob: (la CSP no deja «data:» en un <video>/<audio>).
      var ver = null;
      if (kk === 'vid' || kk === 'aud' || (kk === 'img' && it.big)) {
        ver = document.createElement('button'); ver.className = 'estado-ver nx-chip'; ver.textContent = '▶ ' + t('est_view', 'Ver');
        ver.addEventListener('click', function(e) {
          e.stopPropagation(); ver.disabled = true; ver.style.opacity = '0.5';
          statusMedia('me', it).then(function(d) {
            if (!d || !card.isConnected) { if (!d) _toast(t('media_file_gone', 'Archivo: ya no está en este teléfono')); ver.disabled = false; ver.style.opacity = ''; return; }
            var el = document.createElement(kk === 'vid' ? 'video' : kk === 'aud' ? 'audio' : 'img');
            el.className = 'estado-mio-media';
            el.style.cssText = kk === 'aud' ? 'width:100%;' : 'width:100%;max-height:240px;object-fit:contain;border-radius:12px;background:#000;';
            card.insertBefore(el, top.nextSibling);
            if (kk === 'img') el.src = d;
            else {
              el.controls = true; el.preload = 'metadata';
              if (kk === 'vid') el.playsInline = true;
              _playMedia(el, d, o, 'me ' + it.sid);
            }
            ver.remove();
          });
        });
        top.appendChild(ver);
      }
      var del = document.createElement('button'); del.className = 'estado-quitar nx-chip nx-chip-danger'; del.textContent = t('grp_remove', 'Quitar');
      del.addEventListener('click', function(e) { e.stopPropagation(); removeMyStatus(it.sid); paint(); });
      top.appendChild(del);
      card.appendChild(top);
      // Quién le dio me gusta
      var who = whoLiked(it.sid);
      var lk = document.createElement('div'); lk.className = 'estado-likes'; lk.style.cssText = 'font-size:13px;color:var(--nx-muted);';
      lk.textContent = who.length ? '❤️ ' + who.length + ' · ' + who.map(function(w) { return w.name; }).join(', ') : '🤍 ' + t('est_no_likes', 'Aún sin me gusta');
      card.appendChild(lk);
      // Comentarios (solo los ves tú)
      myComments(it.sid).forEach(function(cm) {
        var cr = document.createElement('div'); cr.className = 'estado-comentario'; cr.style.cssText = 'font-size:13px;background:var(--nx-surface);border-radius:12px;padding:6px 10px;';
        var nm = document.createElement('b'); nm.style.color = '#fff'; nm.textContent = cm.name + ': ';
        var ct = document.createElement('span'); ct.textContent = cm.t;
        cr.appendChild(nm); cr.appendChild(ct); card.appendChild(cr);
      });
      box.appendChild(card);
    });
  };
  o.appendChild(box);
  paint();
}

// ---------- Deslizar hacia abajo para actualizar (dueño 12-11): en Contactos y, desde la 3169, en la pantalla Estados ----------
var _pullAttached = false;
function _attachPull() {
  if (_pullAttached) return;
  var cv = document.getElementById('contacts-view');
  if (!cv) { setTimeout(_attachPull, 1000); return; }
  _pullAttached = true;
  attachPullRefresh(cv, 'estados-pull');
}
// el: lo que se desliza (y su scroll); indId: id del aviso «Desliza / Suelta para actualizar» que sale arriba de el.
// 3169: si el gesto es más de lado que hacia abajo (cambiar de pantalla deslizando) no cuenta como «actualizar».
// host (3230): el aviso va encima, dentro de host, sin empujar lo que se desliza (los estados a pantalla completa).
export function attachPullRefresh(el, indId, host) {
  if (!el || el._nxPull) return;
  el._nxPull = true;
  var y0 = null, x0 = 0, dy = 0, ind = null;
  var showInd = function(txt) {
    if (!ind) {
      ind = document.createElement('div'); ind.id = indId; ind.style.cssText = 'text-align:center;font-size:12px;color:var(--nx-muted);padding:6px 0;';
      if (host) { ind.className = 'nx-est-pullind'; host.appendChild(ind); } else el.insertBefore(ind, el.firstChild);
    }
    ind.textContent = txt;
  };
  var hideInd = function(ms) { setTimeout(function() { if (ind) { try { ind.remove(); } catch (e) {} ind = null; } }, ms || 0); };
  var xOf = function(e) { var p = e.touches && e.touches[0]; return p && typeof p.clientX === 'number' ? p.clientX : 0; };
  // 34 (dueño 21-11 14:38; su diagnóstico: 10 «Deslizar para actualizar» en 26 s al desplazar contactos, cada uno reenviaba TODOS los
  // pendientes): lo que se desplaza en Contactos es la lista de DENTRO (#main-contacts-list), no `el`, cuyo scrollTop es siempre 0 →
  // cualquier gesto hacia abajo contaba. Ahora se mira todo lo que hay entre el dedo y `el`: si algo está desplazado, no es «actualizar»
  // (al empezar, durante el gesto y al soltar). Y como mucho una actualización cada 10 s (dos tirones seguidos = una).
  var tgt = null;
  var scrolled = function() {
    for (var n = tgt; n && n.nodeType === 1; n = n.parentNode) { if (n.scrollTop > 0) return true; if (n === el) break; }
    return el.scrollTop > 0;
  };
  el.addEventListener('touchstart', function(e) { tgt = e.target || null; y0 = (!scrolled() && e.touches && e.touches[0]) ? e.touches[0].clientY : null; x0 = xOf(e); dy = 0; }, { passive: true });
  el.addEventListener('touchmove', function(e) {
    if (y0 === null || !e.touches || !e.touches[0]) return;
    dy = e.touches[0].clientY - y0;
    if (Math.abs(xOf(e) - x0) > Math.abs(dy) || document.body.classList.contains('nx-est-drag') || scrolled()) { y0 = null; dy = 0; hideInd(0); return; }
    if (dy > 20) showInd(dy > PULL_PX ? '↻ ' + t('est_pull_release', 'Suelta para actualizar') : '↓ ' + t('est_pull', 'Desliza para actualizar'));
  }, { passive: true });
  el.addEventListener('touchend', function() {
    var nowT = Date.now();
    if (y0 !== null && dy > PULL_PX && !scrolled()) {
      if (nowT - (el._nxPullAt || 0) >= PULL_COOLDOWN_MS) { el._nxPullAt = nowT; showInd('↻ ' + t('est_refreshing', 'Actualizando estados, fotos y chats…')); refreshAll(); hideInd(1500); }
      else hideInd(600); // recién actualizado: el aviso se va sin repetir el trabajo
    }
    else hideInd(0);
    y0 = null; dy = 0;
  }, { passive: true });
}
var PULL_PX = 70, PULL_COOLDOWN_MS = 10000;

if (typeof window !== 'undefined') {
  window.NEXO_composeStatus = _compose; // 3035: pruebas (tests/sim/pedidos13.js)
  window.NEXO_openMyStatuses = _myView; // 3200: pruebas (tests/sim/estadovideo.js)
  window.NEXO_setMyStatus = setMyStatus; window.NEXO_setStatusPrivacy = setStatusPrivacy; window.NEXO_statusPrivSheet = _privSheet; window.NEXO_statusOf = statusOf; window.NEXO_applyStatus = applyStatus;
  window.NEXO_iLiked = iLiked; // 3059: pruebas (tests/sim/estados3.js)
  window.NEXO_likeStatus = likeStatus; window.NEXO_likeReceived = likeReceived; window.NEXO_myLikes = myLikes; // pruebas (tests/sim/estados.js)
  window.NEXO_addMyStatus = addMyStatus; window.NEXO_statusesOf = statusesOf; window.NEXO_myStatuses = myStatuses; window.NEXO_removeMyStatus = removeMyStatus;
  window.NEXO_staleStatusCopy = staleStatusCopy; // 3033: la cola de reenvío (ble_helpers._isResendable, ble_ack) lo consulta
  window.NEXO_commentStatus = commentStatus; window.NEXO_myComments = myComments; window.NEXO_whoLiked = whoLiked; window.NEXO_requestStatuses = requestStatuses; window.NEXO_refreshAll = refreshAll; window.NEXO_statusMedia = statusMedia; window.NEXO_statusMediaIn = statusMediaIn; // 3032
}
// Para estados_compose.js (reestructuración 17-11)
export { _overlay, _blobUrl, _b64Of, MAX_LEN, _validImg, _bigOf, _toast, _validAud, AUD_SECS, BIG_MAX, _validVid, VID_HD_TARGET };
