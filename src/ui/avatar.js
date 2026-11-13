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
 * - 3062 (dueño 13-11: «se mezcló mi foto con otro contacto y eso no debe pasar»; registro del Motorola: rechazó la foto del dueño a
 *   las 08:32:57, la app se reinició a las 08:33:10 al elegir de la galería y a las 08:33:20 la ACEPTÓ): (a) Perfil espera a tener
 *   cargadas las fotos de los contactos antes de comparar (al abrir la app no había con qué y aceptaba cualquiera; y la carga, al
 *   terminar, pisaba la foto recién puesta: el teléfono creía tener una y sus contactos recibían otra); (b) cada aviso de foto lleva
 *   CUÁNDO se hizo (también «quitada») y el que llega con uno más viejo que el último aplicado no gana (un «quitada» corto
 *   adelantaba a la foto larga, en trozos, y el contacto se quedaba con una foto que el otro ya no tenía).
 */
import { _getBLEContacts, _normId, _saveBLEContacts } from './ble_helpers.js';
import { _sendTextTo } from './send.js';
import { vaultDeleteMessage } from '../vault/vault_manager.js';
import { t } from './i18n.js';
import { printOfImage, printSame, printScore, printValid } from './img_print.js';

var MY_FILE = 'nexo_my_avatar.json', SENT_FILE = 'nexo_av_sent.json', HIST_FILE = 'nexo_av_hist.json';
var IMG_RE = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/;
var MAX_LEN = 60000;          // ~45 KB de imagen como mucho (las nuestras: 10–15 KB)
var SIZE = 160;
export var AVATAR_MAX_BYTES = 5 * 1024 * 1024;   // 3066 (dueño 13-11): la foto que se elige para el perfil, como mucho 5 MB
var NX_RE = /^nx[0-9a-z]{8}$/;

var _mine = null;             // { h, img } (img '' = sin foto)
var _cache = new Map();       // NEXO ID → data URL (solo las que se MUESTRAN)
var _all = new Map();         // NEXO ID → { img, at, ph } todas las recibidas (también las que no se muestran por copiadas)
var _minePh = null;           // huella de mi foto
// 3060 (dueño 13-11: «Roberto aparece con mi foto de perfil todavía»; ese día el dueño cambió su foto dos veces): también se esconde
// la copia de una foto que FUE mía (huellas de mis fotos anteriores, con desde cuándo la tuve; 5 como mucho, 180 días). Solo si el
// contacto la puso después de que yo la pusiera (si la tenía él antes, el original es el suyo).
var _past = [];               // [{ b, c, at, until }]
var PAST_MAX = 8, PAST_KEEP_MS = 180 * 86400000;   // 3065: 8 (también las que el dueño marca «Es mi foto»)
// 3063 (diagnóstico del Motorola 13-11: a las 08:38:31 Perfil aceptó una foto de 9 KB, 20 s después de rechazar la foto actual del
// dueño; el dueño la había cambiado a las 08:35 y lo más probable es que fuera la de antes): Perfil compara también con las fotos que
// cada contacto TUVO (huellas de las 5 últimas por contacto, 180 días), no solo con la actual.
var _hist = {};               // NEXO ID → [{ b, c, until }]
var _sent = {};               // NEXO ID → h que ya se le mandó
var _outIds = new Map();      // id de la copia oculta → NEXO ID (se borra al entregarse)
var _started = false;
var _readyRes, _ready = new Promise(function(r) { _readyRes = r; });   // 3062: fotos guardadas ya cargadas (al abrir la app)
var READY_MAX_MS = 20000;
var _gen = new Map();         // 3062: NEXO ID → turno de la última foto que se está preparando (la que llega después gana)
var _live = new Set();        // 3062: contactos cuya foto llegó en esta sesión (la carga del arranque no la pisa)

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
    setTimeout(function() { resolve(null); }, 2000);   // sin huella a tiempo (imagen que no carga): no se compara (se reintenta)
    try {
      var im = new Image();
      im.onerror = function() { resolve(null); };
      // 3065: huella v2 (img_print.js): además de la de 8×8, una miniatura para reconocer recortes, bordes y capturas
      im.onload = function() { try { resolve(printOfImage(im, function() { return document.createElement('canvas'); })); } catch (e) { resolve(null); } };
      im.src = url;
    } catch (e) { resolve(null); }
  });
}
// Misma foto (3065: img_print.printSame — alineando miniaturas si las dos huellas las traen; si no, la de 8×8 como antes)
function _same(p, q) { return printSame(p, q); }
function _nameOf(nx) { var c = _getBLEContacts().find(function(x) { return _normId(x.nexoId || x.deviceUUID) === nx; }); return (c && c.name) || nx; }
// Qué fotos se muestran: la de un contacto NO si es la mía, ni si otro contacto tenía la misma desde antes (empate: ninguna).
function _recompute() {
  _all.forEach(function(o, nx) {
    var why = '';
    if (o.ph && _minePh && _mine && _mine.img && _same(o.ph, _minePh)) why = 'es la misma que la tuya';   // i18n-ok (registro del diagnóstico)
    else if (o.ph) {
      _past.forEach(function(q) { if (!why && (o.at || 0) >= (q.at || 0) && _same(o.ph, q)) why = 'es una foto que tuviste tú'; });   // i18n-ok
      // 3062: esta comprobación quedó sin ejecutarse en la 3060 (iba en otro «else» detrás de la de arriba)
      if (!why) _all.forEach(function(p, ny) { if (!why && ny !== nx && p.ph && (p.at || 0) <= (o.at || 0) && _same(o.ph, p.ph)) why = 'es la misma que la de ' + ny; });   // i18n-ok
    }
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
  var g = (_gen.get(nx) || 0) + 1;
  _gen.set(nx, g);
  // 3062: si mientras se calculaba la huella llegó otra (o «quitada»), esta ya no vale
  return _phash(img).then(function(ph) { if (_gen.get(nx) !== g) return; _all.set(nx, { img: img, at: at || 0, ph: ph }); if (!ph) _phRetrySoon(); });
}
// Lo que se guarda de una huella (3065: con la miniatura y el color si los trae)
function _keepPrint(ph, extra) { var o = { b: ph.b, c: ph.c }; if (typeof ph.t === 'string') o.t = ph.t; if (typeof ph.k === 'string') o.k = ph.k; return Object.assign(o, extra || {}); }
// 3063: la foto que un contacto deja de tener pasa a su historial (con su huella; si no la había, se calcula)
function _histAdd(nx, old) {
  if (!old || !old.img) return;
  var push = function(ph) {
    if (!ph || typeof ph.b !== 'string') return;
    var now = Date.now();
    var l = (_hist[nx] || []).filter(function(q) { return q && now - (Number(q.until) || 0) < PAST_KEEP_MS && !_same(q, ph); });
    l.push(_keepPrint(ph, { until: now }));
    _hist[nx] = l.slice(-PAST_MAX);
    _save(HIST_FILE, _hist);
  };
  if (old.ph) push(old.ph); else _phash(old.img).then(push).catch(function() {});
}
// 3059 (dueño 13-11: «¿por qué Roberto aparece con mi foto de perfil todavía? se supone que ya lo arreglaste»): la copia se esconde
// comparando huellas; si al abrir la app una huella no se pudo calcular a tiempo (2 s, con la app arrancando y muchas fotos a la
// vez) —la mía o la del contacto—, no se comparaba y la copia se veía hasta que alguien cambiara de foto. Ahora las huellas que
// faltan se vuelven a intentar (a los 4 s, 12 s, 40 s y 2 min) y, en cuanto están, se vuelve a decidir qué se muestra.
var _phTry = 0, _phTimer = null, PH_RETRY_MS = [4000, 12000, 40000, 120000];
function _phMissing() {
  var miss = !!(_mine && _mine.img && !_minePh);
  _all.forEach(function(o) { if (!o.ph) miss = true; });
  return miss;
}
function _phRetrySoon() {
  if (_phTimer || _phTry >= PH_RETRY_MS.length) return;
  _phTimer = setTimeout(function() {
    _phTimer = null; _phTry++;
    var jobs = [];
    if (_mine && _mine.img && !_minePh) { var mi = _mine.img; jobs.push(_phash(mi).then(function(ph) { if (_mine && _mine.img === mi) _minePh = ph; })); }
    _all.forEach(function(o) { if (!o.ph) jobs.push(_phash(o.img).then(function(ph) { o.ph = ph; })); });
    Promise.all(jobs).then(function() {
      var still = _phMissing();
      console.log('[AVATAR] Huellas de fotos que faltaban: ' + (still ? 'aún falta alguna (otro intento más tarde)' : 'listas') + ' (intento ' + _phTry + ')');
      _recompute();
      if (still) _phRetrySoon();
    }).catch(function() {});
  }, PH_RETRY_MS[_phTry]);
}
/** 3028: ¿esta foto es la de perfil de algún contacto? → su nombre (o null). Perfil no deja ponerla como propia. */
export function avatarClash(url) {
  // 3062: al abrir la app, las fotos de los contactos aún se están cargando: se espera a tenerlas (antes no había con qué comparar)
  var late = false;
  var tmo = new Promise(function(r) { setTimeout(function() { late = true; r(); }, READY_MAX_MS); });
  return Promise.race([_ready, tmo]).then(function() {
    if (late) console.warn('[AVATAR] Perfil: las fotos de los contactos no terminaron de cargarse; comparo con las que hay');
    if (!_all.size && !Object.keys(_hist).length) return null;   // ningún contacto con foto (ni de antes): nada con qué comparar
    // las que quedaron sin huella (la imagen no cargó a tiempo) se vuelven a intentar
    var miss = [];
    _all.forEach(function(o) { if (!o.ph) miss.push(_phash(o.img).then(function(ph) { o.ph = ph; })); });
    return Promise.all(miss);
  }).then(function() { return (_all.size || Object.keys(_hist).length) ? _phash(url) : null; }).then(function(ph) {
    if (!ph) return null;
    var hit = null, now = Date.now();
    // 3063: una foto que fue MÍA (la vuelvo a poner) no se rechaza aunque un contacto tenga o haya tenido una copia
    if (_past.some(function(q) { return _same(ph, q); })) return null;
    _all.forEach(function(o, nx) { if (!hit && o.ph && _same(ph, o.ph)) hit = nx; });
    // 3063: o una que ese contacto TUVO antes
    if (!hit) Object.keys(_hist).forEach(function(nx) { (_hist[nx] || []).forEach(function(q) { if (!hit && q && now - (Number(q.until) || 0) < PAST_KEEP_MS && _same(ph, q)) { hit = nx; console.warn('[AVATAR] Perfil: esa foto la tuvo antes ' + _nameOf(nx)); } }); });
    return hit ? _nameOf(hit) : null;
  });
}
function _contactIds() { return _getBLEContacts().map(function(c) { return _normId(c.nexoId || c.deviceUUID); }).filter(function(nx) { return NX_RE.test(nx); }); }

export function avatarInit() {
  if (_started) return;
  _started = true;
  Promise.all([_load(MY_FILE), _load(SENT_FILE), _load(HIST_FILE)]).then(function(r) {
    if (r[2] && typeof r[2] === 'object') Object.keys(r[2]).forEach(function(nx) { if (NX_RE.test(nx) && Array.isArray(r[2][nx])) _hist[nx] = r[2][nx].filter(function(q) { return printValid(q) && Date.now() - (Number(q.until) || 0) < PAST_KEEP_MS; }).slice(-PAST_MAX); });
    if (r[0] && typeof r[0].h === 'string' && !_mine) _mine = { h: r[0].h, img: IMG_RE.test(r[0].img || '') ? r[0].img : '', at: Number(r[0].at) || 0 };
    if (r[0] && Array.isArray(r[0].past)) _past = r[0].past.filter(function(q) { return printValid(q) && Date.now() - (Number(q.until) || 0) < PAST_KEEP_MS; }).slice(-PAST_MAX);
    // 3012 (dueño 11-11: un contacto salió con una foto que no era la suya; el registro de Marcos mostró que la mandó ese teléfono
    // como SU foto): al diagnóstico, si este teléfono tiene foto propia y desde cuándo (las puestas antes de la 3012: «fecha desconocida»)
    if (_mine && _mine.img) console.log('[AVATAR] Este teléfono tiene foto de perfil propia (' + Math.round(_mine.img.length / 1024) + ' KB, puesta: ' + (_mine.at ? new Date(_mine.at).toISOString().substring(0, 16) : 'fecha desconocida') + ')');
    if (r[1] && typeof r[1] === 'object') _sent = r[1];
    if (_mine && _mine.img) _emit('me');
    return _phash(_mine && _mine.img).then(function(ph) { _minePh = ph; if (_mine && _mine.img && !ph) { console.warn('[AVATAR] Huella de mi foto: no se pudo calcular al abrir (se reintenta)'); _phRetrySoon(); } });
  }).then(function() {
    // Las fotos de los contactos (solo de los que la tienen: avh en el contacto); 3028: se muestran tras comparar huellas
    return Promise.all(_getBLEContacts().map(function(c) {
      var nx = _normId(c.nexoId || c.deviceUUID);
      if (!c.avh || !NX_RE.test(nx)) return null;
      return _load('nexo_av_' + nx + '.json').then(function(o) { if (!_live.has(nx) && o && IMG_RE.test(o.img || '')) return _keep(nx, o.img, Number(o.at) || 0); });
    }));
  }).then(_recompute).catch(function() {}).then(function() { _readyRes(); });
  window.addEventListener('nexo:ble:peerReady', function(e) {
    var nx = _normId(e && e.detail && e.detail.nexoId);
    if (NX_RE.test(nx)) setTimeout(function() { sendAvatarTo(nx); }, 4000);
  });
  window.addEventListener('nexo:ble:ackStatus', function(e) {
    var d = e && e.detail, nx = d && _outIds.get(d.msgId);
    if (nx && (d.status === 'delivered' || d.status === 'read')) { _outIds.delete(d.msgId); vaultDeleteMessage(nx, d.msgId).catch(function() {}); }
  });
}

// 3060: para el diagnóstico: qué foto tiene este contacto aquí (se ve / copia escondida y por qué / sin foto) y a cuánto está de la mía
export function avatarDiag(nx) {
  nx = _normId(nx);
  var o = _all.get(nx);
  if (!o) return 'sin foto';
  var d = '';
  if (o.ph && _minePh && typeof o.ph.b === 'string' && typeof _minePh.b === 'string') { var n = 0; for (var i = 0; i < 64; i++) if (o.ph.b.charAt(i) !== _minePh.b.charAt(i)) n++; d = ', a ' + n + '/64 de la tuya'; } // i18n-ok: diagnóstico
  else if (!o.ph) d = ', sin huella';
  var sc = (o.ph && _minePh) ? printScore(o.ph, _minePh) : null;
  if (sc) d += ', parecido ' + Math.round(sc.lum * 100) + '%' + (sc.color !== null ? ' color ' + Math.round(sc.color) : ''); // i18n-ok: diagnóstico
  return (o.hid ? 'foto copiada (escondida)' : 'foto') + d + (_past.length ? ', fotos tuyas anteriores ' + _past.length : '');
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
  // 3033: también va CUÁNDO la puse (t): con dos contactos con la misma foto, el otro muestra la de quien la puso antes y
  // esconde la copia (antes, sin fecha, empataban y escondía las dos; diagnóstico del Honor 12-11). La marca «:t» hace que se
  // mande una vez más a quien ya la tenía sin fecha.
  if (!_mine || !_mine.h || !NX_RE.test(nx)) return;
  var mark = _mine.h + ':t';
  if (_sent[nx] === mark || _contactIds().indexOf(nx) < 0) return;
  var act = { type: 'nexo_act', act: 'av', h: _mine.h, img: _mine.img || '' };
  if (_mine.at) act.t = _mine.at;   // 3062: también al quitarla (el que la recibe se queda con el aviso más reciente)
  var id = _sendTextTo(nx, JSON.stringify(act), '', true);
  if (!id) return;
  _outIds.set(id, nx);
  _sent[nx] = mark;
  _save(SENT_FILE, _sent);
  console.log('[AVATAR] Foto de perfil ' + (_mine.img ? 'mandada' : 'quitada') + ' a ' + nx);
}
function _sendToAll() { _contactIds().forEach(sendAvatarTo); }

// 3060: la foto que deja de ser mía pasa a la lista de «fotos que tuve» (con su huella; si no la había, se calcula)
function _archiveMine() {
  var old = _mine, oldPh = _minePh;
  if (!old || !old.img) return;
  var push = function(ph) {
    if (!ph || typeof ph.b !== 'string') return;
    _past = _past.filter(function(q) { return !_same(q, ph); });
    _past.push(_keepPrint(ph, { at: old.at || 0, until: Date.now() }));
    _past = _past.slice(-PAST_MAX);
    _saveMine();
    _recompute();
  };
  if (oldPh) push(oldPh); else _phash(old.img).then(push).catch(function() {});
}
function _saveMine() { _save(MY_FILE, Object.assign({}, _mine || {}, { past: _past })); }
export function setMyAvatar(dataUrl) {
  if (!IMG_RE.test(dataUrl || '') || dataUrl.length > MAX_LEN) return false;
  _archiveMine();
  _mine = { h: _hash(dataUrl), img: dataUrl, at: Date.now() };
  _saveMine();
  console.log('[AVATAR] Foto de perfil propia puesta ahora desde Perfil (' + Math.round(dataUrl.length / 1024) + ' KB)');
  _emit('me');
  _sendToAll();
  _phash(dataUrl).then(function(ph) { if (_mine && _mine.img === dataUrl) { _minePh = ph; if (!ph) { _phTry = 0; _phRetrySoon(); } _recompute(); } });
  return true;
}
export function clearMyAvatar() {
  _archiveMine();
  _mine = { h: 'x' + Date.now().toString(36), img: '', at: Date.now() };
  _saveMine();
  console.log('[AVATAR] Foto de perfil propia quitada desde Perfil');
  _minePh = null;
  _emit('me');
  _sendToAll();
  _recompute();
}

// 3065 (dueño 13-11: «cualquier cosa subida por un user se debe ligar a su ID»): «Es mi foto» — el dueño marca la foto de un contacto
// como suya (una copia que la huella no reconoció, o de una foto suya de antes de la 3042): pasa a sus fotos y deja de verse en ese
// contacto aquí (y en cualquier otro que la ponga). No toca el teléfono del otro.
export function claimAvatarMine(nx) {
  nx = _normId(nx);
  var o = _all.get(nx);
  if (!o || !o.img) return Promise.resolve(false);
  return (o.ph ? Promise.resolve(o.ph) : _phash(o.img)).then(function(ph) {
    if (!ph || typeof ph.b !== 'string') return false;
    _past = _past.filter(function(q) { return !_same(q, ph); });
    _past.push(_keepPrint(ph, { at: 0, until: Date.now(), mine: 1 }));
    _past = _past.slice(-PAST_MAX);
    _saveMine();
    console.warn('[AVATAR] El dueño marcó la foto de ' + nx + ' como suya («Es mi foto»): no se muestra');
    _recompute();
    return true;
  });
}

// Lo que llega de un contacto (chat_actions._applyChatAction)
export function applyAvatar(sender, act) {
  var nx = _normId(sender), img = typeof act.img === 'string' ? act.img : '', h = String(act.h || '').substring(0, 20);
  if (!NX_RE.test(nx) || !h || (img && (!IMG_RE.test(img) || img.length > MAX_LEN))) return;
  var prev = _all.get(nx), at = (prev && prev.img === img) ? prev.at : Date.now();
  // 3033: si trae cuándo la puso su dueño (t), manda esa fecha (acotada: no en el futuro ni antes de 2024)
  var tSet = Number(act.t);
  if (img && tSet > 1704067200000 && tSet <= Date.now() + 60000) at = tSet;
  var contacts = _getBLEContacts(), c = contacts.find(function(x) { return _normId(x.nexoId || x.deviceUUID) === nx; });
  // 3062: un aviso más viejo que el último aplicado de este contacto (los dos con la hora de SU reloj) no gana
  var tAct = tSet > 0 && isFinite(tSet) ? tSet : 0;
  if (tAct && c && Number(c.avt) > tAct) { console.log('[AVATAR] Aviso de foto de ' + nx + ' más viejo que el último que llegó: no se aplica'); return; }
  _live.add(nx);
  if (prev && prev.img && prev.img !== img) _histAdd(nx, prev);   // 3063
  _save('nexo_av_' + nx + '.json', { h: h, img: img, at: at });
  if (c && (c.avh !== (img ? h : '') || (tAct && c.avt !== tAct))) { c.avh = img ? h : ''; if (tAct) c.avt = tAct; _saveBLEContacts(contacts); }
  console.log('[AVATAR] Foto de perfil de ' + nx + ': ' + (img ? 'nueva' : 'quitada'));
  // 3028: no se pinta hasta comparar su huella con la mía y las de los demás contactos (_recompute)
  if (!img) { _gen.set(nx, (_gen.get(nx) || 0) + 1); _all.delete(nx); if (_cache.delete(nx)) _emit(nx); _recompute(); return; }
  _keep(nx, img, at).then(_recompute).catch(function() {});
}

// Cuadrada, 160 px, JPEG (el simulador no tiene canvas: window.NEXO_makeAvatar)
export function makeAvatar(file) {
  if (file && file.size > AVATAR_MAX_BYTES) return Promise.reject(new Error(t('prof_photo_big', 'La foto pesa más de 5 MB: elige una más pequeña')));
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

if (typeof window !== 'undefined') { window.NEXO_applyAvatar = applyAvatar; window.NEXO_avatarOf = avatarOf; window.NEXO_avatarDiag = avatarDiag; } // pruebas (tests/sim/cola3033.js)
