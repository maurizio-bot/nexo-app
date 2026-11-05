/**
 * profile_share.js — Perfil enriquecido, paso 2b/3 (pedido del dueño 04-11): compartir MIS datos de perfil (nombre,
 * teléfono, correo COMPLETOS) con cada contacto por el canal seguro E2E, y guardar los que me comparten para verlos en
 * su ficha (⋮ → Perfil). Mismo molde robusto que la foto de perfil (avatar.js): va como acción oculta
 * ({type:'nexo_act', act:'prof', ...}) cifrada de extremo a extremo, por cualquier camino, sin aviso ni «no leído»; se
 * manda al conectar con un contacto (peerReady) y solo si cambió (dedupe por hash); la copia oculta se borra al entregarse.
 *
 * Seguridad: en la SOLICITUD (buzón de internet, clave derivable del ID) viajan SOLO los datos ENMASCARADOS (ver
 * net_link.js / ble_links.js, build 2922). Los COMPLETOS viajan ACÁ, por el canal E2E real (claves intercambiadas), que
 * es lo que se enciende al ACEPTAR. Cada campo es opcional: lo que el dueño no llenó, no se manda.
 */
import { _normId, _getBLEContacts } from './ble_helpers.js';
import { _sendTextTo } from './send.js';
import { vaultDeleteMessage } from '../vault/vault_manager.js';
import { myProfile } from './profile_data.js';

var SENT_FILE = 'nexo_prof_sent.json';
var NX_RE = /^nx[0-9a-z]{8}$/;
var NAME_MAX = 60, PHONE_MAX = 24, EMAIL_MAX = 80;

var _cache = {};              // NEXO ID → { n, p, e } del contacto (lo que me compartió)
var _sent = {};               // NEXO ID → hash que ya le mandé
var _outIds = new Map();      // id de la copia oculta → NEXO ID (se borra al entregarse)
var _started = false;

function _pl() { return (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.NexoBLE) || null; }
function _load(name) {
  var pl = _pl();
  if (!pl || typeof pl.loadFromFile !== 'function') return Promise.resolve(null);
  return pl.loadFromFile({ filename: name }).then(function (r) { return r && r.exists && r.content ? JSON.parse(r.content) : null; }).catch(function () { return null; });
}
function _save(name, obj) { var pl = _pl(); if (pl && typeof pl.saveToFile === 'function') pl.saveToFile({ filename: name, content: JSON.stringify(obj) }).catch(function () {}); }
function _hash(s) { var h = 2166136261; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h.toString(36); }
function _clean(s, max) { return String(s == null ? '' : s).replace(/[<>]/g, '').trim().slice(0, max); }
function _contactIds() { return _getBLEContacts().map(function (c) { return _normId(c.nexoId || c.deviceUUID); }).filter(function (nx) { return NX_RE.test(nx); }); }

// Mi perfil en formato de envío (campos no vacíos) + su hash para dedupe.
function _myMsg() {
  var p = myProfile();
  var msg = {};
  if (p.name) msg.n = _clean(p.name, NAME_MAX);
  if (p.phone) msg.p = _clean(p.phone, PHONE_MAX);
  if (p.email) msg.e = _clean(p.email, EMAIL_MAX);
  return msg;
}
function _myHash() { var m = _myMsg(); return _hash((m.n || '') + '|' + (m.p || '') + '|' + (m.e || '')); }

export function profileShareInit() {
  if (_started) return;
  _started = true;
  _load(SENT_FILE).then(function (r) { if (r && typeof r === 'object') _sent = r; });
  // Cargar los perfiles ya recibidos de los contactos
  _contactIds().forEach(function (nx) {
    _load('nexo_prof_' + nx + '.json').then(function (o) { if (o && typeof o === 'object') _cache[nx] = { n: o.n || '', p: o.p || '', e: o.e || '' }; });
  });
  window.addEventListener('nexo:ble:peerReady', function (e) {
    var nx = _normId(e && e.detail && e.detail.nexoId);
    if (NX_RE.test(nx)) setTimeout(function () { sendProfileTo(nx); }, 5000);   // tras la foto (avatar usa 4 s)
  });
  window.addEventListener('nexo:ble:ackStatus', function (e) {
    var d = e && e.detail, nx = d && _outIds.get(d.msgId);
    if (nx && (d.status === 'delivered' || d.status === 'read')) { _outIds.delete(d.msgId); vaultDeleteMessage(nx, d.msgId).catch(function () {}); }
  });
}

// A un contacto que aún no tiene mi versión actual (o nunca se la mandé). Si no tengo ningún dato, no mando nada.
export function sendProfileTo(nx) {
  nx = _normId(nx);
  if (!NX_RE.test(nx) || _contactIds().indexOf(nx) < 0) return;
  var msg = _myMsg();
  if (!msg.n && !msg.p && !msg.e) return;            // nada que compartir
  var h = _myHash();
  if (_sent[nx] === h) return;                        // ya le mandé esta versión
  var wire = { type: 'nexo_act', act: 'prof', h: h };
  if (msg.n) wire.n = msg.n; if (msg.p) wire.p = msg.p; if (msg.e) wire.e = msg.e;
  var id = _sendTextTo(nx, JSON.stringify(wire), '', true);
  if (!id) return;
  _outIds.set(id, nx);
  _sent[nx] = h;
  _save(SENT_FILE, _sent);
  console.log('[PROFILE] datos de perfil compartidos con ' + nx);
}
function _sendToAll() { _contactIds().forEach(sendProfileTo); }

// Al editar mis datos (profile.js): reenviar a todos (con el dedupe por hash, solo va a quien tenga una versión vieja).
export function profileShareResend() { _sent = {}; _sendToAll(); }

// Lo que llega de un contacto (chat_actions._applyChatAction): guardar su perfil.
export function applyContactProfile(sender, act) {
  var nx = _normId(sender);
  if (!NX_RE.test(nx) || !act) return;
  var prof = { n: _clean(act.n, NAME_MAX), p: _clean(act.p, PHONE_MAX), e: _clean(act.e, EMAIL_MAX) };
  _cache[nx] = prof;
  _save('nexo_prof_' + nx + '.json', prof);
  console.log('[PROFILE] datos de perfil recibidos de ' + nx);
  try { window.dispatchEvent(new CustomEvent('nexo:profile', { detail: { nx: nx } })); } catch (e) {}
}

// Para la ficha del contacto (profile.js). Devuelve { name, phone, email } (strings; '' si no hay) o null si no comparte nada.
export function getContactProfile(nx) {
  var p = _cache[_normId(nx)];
  if (!p || (!p.n && !p.p && !p.e)) return null;
  return { name: p.n || '', phone: p.p || '', email: p.e || '' };
}

// Ganchos de prueba (tests/sim): el plugin no está en jsdom pero esto es JS puro.
try {
  if (typeof window !== 'undefined') {
    window.__nexoSendProfileTo = sendProfileTo;
    window.__nexoGetContactProfile = getContactProfile;
    window.__nexoApplyContactProfile = applyContactProfile;
  }
} catch (e) {}
