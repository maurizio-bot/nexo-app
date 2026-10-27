/**
 * estados.js (ronda 2799, Stream fase 1, pedido del dueño: «empezamos con cercanos») — ESTADOS tipo WhatsApp.
 * - Un estado es TEXTO con caducidad 24 h. Es un tipo de mensaje con vencimiento (como el cobro/ubicación), cifrado
 *   de extremo a extremo, privado ENTRE CONTACTOS (no público). Viaja por lo que ya hay (Bluetooth/Wi-Fi/Jump/internet)
 *   como acción oculta del chat ({type:'nexo_act', act:'st', t, ts}): sin mensaje visible ni "no leído".
 * - El propio se guarda en nexo_my_status.json {t, ts}. El de cada contacto en nexo_status_<NEXO ID>.json {t, ts}.
 * - Se reparte a cada contacto al publicarlo y, al que no estaba, al conectar con él (peerReady). La copia oculta se
 *   borra al entregarse. Caduca a las 24 h (no se muestra ni se guarda lo vencido).
 * - UI: una tira "Estados" arriba de la lista de contactos: «➕ Mi estado» + un círculo por contacto con estado activo.
 *   Fase 1 solo texto; foto/clip de estado quedan para más adelante.
 */
import { _getBLEContacts, _normId, _saveBLEContacts } from './ble_helpers.js';
import { _sendTextTo } from './send.js';
import { vaultDeleteMessage } from '../vault/vault_manager.js';

var MY_FILE = 'nexo_my_status.json', SENT_FILE = 'nexo_status_sent.json';
var TTL_MS = 24 * 60 * 60 * 1000;      // caduca a las 24 h
var MAX_LEN = 280;                      // texto de estado como mucho
var NX_RE = /^nx[0-9a-z]{8}$/;

var _mine = null;             // { t, ts } (t '' = sin estado)
var _cache = new Map();       // NEXO ID → { t, ts }
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
function _active(s) { return !!(s && typeof s.t === 'string' && s.t && typeof s.ts === 'number' && (Date.now() - s.ts) < TTL_MS); }

export function estadosInit() {
  if (_started) return;
  _started = true;
  Promise.all([_load(MY_FILE), _load(SENT_FILE)]).then(function(r) {
    if (_active(r[0])) _mine = { t: String(r[0].t).substring(0, MAX_LEN), ts: r[0].ts };
    if (r[1] && typeof r[1] === 'object') _sent = r[1];
    _renderStrip();
  });
  // Los estados de los contactos que la tienen (ste en el contacto)
  _getBLEContacts().forEach(function(c) {
    var nx = _normId(c.nexoId || c.deviceUUID);
    if (!c.ste || !NX_RE.test(nx)) return;
    _load('nexo_status_' + nx + '.json').then(function(o) { if (_active(o)) { _cache.set(nx, { t: String(o.t).substring(0, MAX_LEN), ts: o.ts }); _emit(nx); } });
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

// Publicar/actualizar mi estado (texto). '' lo quita.
export function setMyStatus(text) {
  text = String(text == null ? '' : text).substring(0, MAX_LEN);
  if (!text) { clearMyStatus(); return; }
  _mine = { t: text, ts: Date.now() };
  _save(MY_FILE, _mine);
  _sent = {}; _save(SENT_FILE, _sent);   // estado nuevo → reenviar a todos
  _contactIds().forEach(sendStatusTo);
  _emit('me');
  console.log('[ESTADO] Publicado (' + text.length + ' car.)');
}
export function clearMyStatus() {
  _mine = { t: '', ts: Date.now() };
  _save(MY_FILE, _mine);
  var sent = _sent; _sent = {}; _save(SENT_FILE, _sent);
  _contactIds().forEach(function(nx) { if (sent[nx] !== undefined) _broadcast(nx, ''); });
  _mine = null;
  _emit('me');
}
function _broadcast(nx, t) {
  var id = _sendTextTo(nx, JSON.stringify({ type: 'nexo_act', act: 'st', t: t, ts: Date.now() }), '', true);
  if (id) _outIds.set(id, nx);
  return id;
}
export function sendStatusTo(nx) {
  nx = _normId(nx);
  if (!_active(_mine) || !NX_RE.test(nx) || _sent[nx] === _mine.ts || _contactIds().indexOf(nx) < 0) return;
  if (_broadcast(nx, _mine.t)) { _sent[nx] = _mine.ts; _save(SENT_FILE, _sent); }
}

// Recibido: un contacto publicó/quitó su estado
export function applyStatus(senderNx, act) {
  var nx = _normId(senderNx);
  if (!NX_RE.test(nx) || !act) return;
  var t = typeof act.t === 'string' ? act.t.substring(0, MAX_LEN) : '';
  // Robustez (auditoría 2800): el ts lo pone el OTRO teléfono; un ts en el futuro (reloj malo o malicioso)
  // haría que su estado nunca caducara (Date.now()-ts < TTL siempre). Se acota a «ahora» para que las 24 h
  // sean honestas pase lo que pase. Un ts negativo/no numérico también cae a ahora.
  var now = Date.now();
  var ts = (typeof act.ts === 'number' && act.ts > 0) ? Math.min(act.ts, now) : now;
  // marcar el contacto como "tiene estado" (ste) para recargarlo al reiniciar
  try {
    var contacts = _getBLEContacts(), i = contacts.findIndex(function(c) { return _normId(c.nexoId || c.deviceUUID) === nx; });
    if (i >= 0) { contacts[i].ste = t ? 1 : 0; _saveBLEContacts(contacts); }
  } catch (e) {}
  if (t && (Date.now() - ts) < TTL_MS) { _cache.set(nx, { t: t, ts: ts }); _save('nexo_status_' + nx + '.json', { t: t, ts: ts }); }
  else { _cache.delete(nx); _save('nexo_status_' + nx + '.json', { t: '', ts: ts }); }
  _emit(nx);
}

// Contactos (con nombre) que tienen estado activo ahora
function _activeContacts() {
  var out = [];
  _getBLEContacts().forEach(function(c) {
    var nx = _normId(c.nexoId || c.deviceUUID);
    var s = statusOf(nx);
    if (s) out.push({ nx: nx, name: c.name || nx.toUpperCase(), t: s.t, ts: s.ts });
  });
  return out;
}

// ---------- Interfaz: tira de Estados arriba de la lista de contactos ----------
function _esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function(c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function _ago(ts) { var m = Math.floor((Date.now() - ts) / 60000); if (m < 1) return 'ahora'; if (m < 60) return 'hace ' + m + ' min'; return 'hace ' + Math.floor(m / 60) + ' h'; }
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
function _chip(label, sub, onClick, accent) {
  var w = document.createElement('div');
  w.className = 'estado-chip';
  w.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:4px;flex-shrink:0;width:64px;cursor:pointer;';
  var circle = document.createElement('div');
  circle.style.cssText = 'width:52px;height:52px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:20px;color:#fff;' +
    (accent ? 'background:var(--nx-grad,linear-gradient(135deg,#00c8ff,#a855f7));' : 'background:rgba(255,255,255,0.1);border:2px solid #00c8ff;');
  circle.textContent = accent ? '➕' : (label || '·').substring(0, 1).toUpperCase();
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
  el.appendChild(_chip('Mi estado', mine ? 'Tu estado' : 'Mi estado', _compose, !mine));
  if (mine) { var mc = el.lastChild.querySelector('div'); if (mc) { mc.textContent = (mine.t || '·').substring(0, 1).toUpperCase(); mc.style.background = 'var(--nx-grad,linear-gradient(135deg,#00c8ff,#a855f7))'; } }
  _activeContacts().forEach(function(c) {
    el.appendChild(_chip(c.name, c.name, function() { _view(c); }, false));
  });
  el.style.display = (mine || _activeContacts().length) ? 'flex' : 'flex'; // siempre visible (al menos «Mi estado»)
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
  var h = document.createElement('div'); h.style.cssText = 'font-weight:700;color:#00c8ff;'; h.textContent = 'Mi estado (24 h)';
  var ta = document.createElement('textarea');
  ta.id = 'estado-input';
  ta.maxLength = MAX_LEN;
  ta.placeholder = '¿Qué estás pensando?';
  ta.style.cssText = 'width:100%;min-height:70px;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.15);border-radius:10px;color:#fff;font-size:15px;padding:10px;outline:none;resize:none;';
  var m = myStatus(); if (m) ta.value = m.t;
  var row = document.createElement('div'); row.style.cssText = 'display:flex;gap:10px;';
  var pub = document.createElement('button');
  pub.id = 'estado-publicar';
  pub.textContent = 'Publicar';
  pub.style.cssText = 'flex:1;padding:11px;background:linear-gradient(135deg,#00c8ff,#a855f7);border:none;border-radius:10px;color:#fff;font-weight:700;cursor:pointer;';
  pub.addEventListener('click', function(e) { e.stopPropagation(); setMyStatus(ta.value); o.remove(); });
  row.appendChild(pub);
  if (m) {
    var del = document.createElement('button');
    del.id = 'estado-quitar';
    del.textContent = 'Quitar';
    del.style.cssText = 'padding:11px 16px;background:rgba(255,59,48,0.3);border:1px solid #FF3B30;border-radius:10px;color:#fff;font-weight:600;cursor:pointer;';
    del.addEventListener('click', function(e) { e.stopPropagation(); clearMyStatus(); o.remove(); });
    row.appendChild(del);
  }
  box.appendChild(h); box.appendChild(ta); box.appendChild(row);
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
  var txt = document.createElement('div'); txt.style.cssText = 'font-size:20px;line-height:1.5;white-space:pre-wrap;word-break:break-word;'; txt.innerHTML = _esc(c.t);
  box.appendChild(who); box.appendChild(when); box.appendChild(txt);
  o.appendChild(box);
}

if (typeof window !== 'undefined') { window.NEXO_setMyStatus = setMyStatus; window.NEXO_statusOf = statusOf; window.NEXO_applyStatus = applyStatus; } // pruebas (tests/sim/estados.js)
