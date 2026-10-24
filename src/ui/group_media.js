/**
 * group_media.js v1.0 (ronda 2764) — Vídeo HD y archivos grandes en los grupos (PENDIENTES §2: faltaban).
 * - Archivo grande: se cifra a disco una vez (big_file.js, con el id del mensaje del grupo) y el sobre del grupo lleva
 *   un mensaje normal con nombre, tamaño, la clave y quién lo manda (big.from). Después va a cada miembro con camino
 *   (mismo Wi-Fi, Wi-Fi Direct o Bluetooth L2CAP), uno tras otro. Quien no tenga camino lo pide al tocar su tarjeta:
 *   la petición va a quien lo mandó, no al grupo.
 * - Vídeo: la previa va al grupo como siempre; el HD va a cada miembro como en un chat normal (sendFile con hdFor = el
 *   id de su copia) cuando le llega la previa, y al reconectar si quedó pendiente. Quien lo recibe lo pone en el chat
 *   del grupo (videoGroupChatOf). La etiqueta del emisor cuenta "HD n/m" hasta "HD ✓".
 * Estado por miembro en groups.st[id] (big: { nx: 'sent' }, hd: { mime, n: { nx: 'sent' } }), guardado con el grupo.
 */
import { vaultHdFileName, vaultLoadFile, vaultLoadMessages, vaultSaveFile, vaultSetMessageFields } from '../vault/vault_manager.js';
import { _videoFormat } from './video_tools.js';
import { _setHdBadge } from './video_send.js';

var WID_RE = /^(gm[0-9a-z]+)_([0-9a-z]{8})$/;
var DONE = { delivered: true, read: true };
var _hdMem = {};       // id del mensaje → HD en base64 (emisor, mientras no lo tengan todos)
var _inflight = {};    // id de la copia de un miembro → HD saliendo
var _started = false;

function _nid(id) { return (id || '').toString().toLowerCase().trim(); }
function _bi() { return window.bleInterface || (window.NEXO && window.NEXO.app && window.NEXO.app.bleInterface) || null; }
function _gs() { var bi = _bi(); return bi && bi.groups; }

// ¿Es el id de la copia de un miembro ('gm…_' + 8 letras del miembro)?
export function isGroupWire(id) { return WID_RE.test(String(id || '')); }

export function startGroupMedia() {
  if (_started) return;
  _started = true;
  window.addEventListener('nexo:ble:ackStatus', function(e) {
    var d = e && e.detail, m = d && WID_RE.exec(String(d.msgId || ''));
    if (m && DONE[d.status]) _hdTo(m[1], 'nx' + m[2]);
  });
  window.addEventListener('nexo:ble:peerReady', function(e) {
    var nx = _nid(e && e.detail && e.detail.nexoId);
    if (nx) setTimeout(function() { resumeGroupHd(nx); }, 3000);
  });
  var bigs = _bi() && _bi().bigFiles;
  if (bigs) bigs.onSent = function(nx, id) { var gs = _gs(), st = gs && gs.st[id]; if (st && st.big) { st.big[_nid(nx)] = 'sent'; gs._save(); } };
}

// ===== Archivos grandes =====

// ¿Algún miembro tiene ya camino para un archivo grande?
export function groupBigRoute(gid) {
  var bi = _bi(), gs = _gs(), g = gs && gs.get(gid), me = gs && gs._me();
  if (!g || !bi.bigFiles) return null;
  for (var i = 0; i < g.members.length; i++) { if (g.members[i] !== me && bi.bigFiles.route(g.members[i])) return bi.bigFiles.route(g.members[i]); }
  return null;
}

// Mandar (o volver a mandar) el archivo ya cifrado a los miembros que aún no lo tienen y tienen camino
export function bigToGroup(gid, id) {
  startGroupMedia();
  var bi = _bi(), gs = _gs(), g = gs && gs.get(gid), bigs = bi && bi.bigFiles;
  if (!g || !bigs) return Promise.resolve();
  var me = gs._me(), st = gs.st[id] || (gs.st[id] = { g: g.id, m: {} });
  st.big = st.big || {};
  var todo = g.members.filter(function(nx) { return nx !== me && st.big[nx] !== 'sent'; });
  var sent = 0, failed = 0, noRoute = 0;
  return todo.reduce(function(p, nx) {
    return p.then(function() {
      if (!bigs.route(nx)) { noRoute++; return; }
      return bigs.transfer(nx, id).then(function() { st.big[nx] = 'sent'; sent++; gs._save(); }, function() { failed++; });
    });
  }, Promise.resolve()).then(function() {
    console.log('[GROUP] Archivo grande ' + id + ': enviado a ' + sent + ', sin camino ' + noRoute + ', fallido ' + failed + ' (lo piden al tocar la tarjeta)');
    bigs._set(id, { dir: 'out', state: failed && !sent ? 'failed' : 'done' });
  });
}

// ===== Vídeo HD =====

// Emisor: el HD de un vídeo del grupo (la previa ya salió con id msgId)
export function registerGroupHd(gid, msgId, b64, mime) {
  startGroupMedia();
  var gs = _gs(), st = gs && gs.st[msgId];
  if (!st || !b64) return;
  st.hd = { mime: mime, n: {} };
  gs._save();
  _hdMem[msgId] = b64;
  vaultSaveFile(vaultHdFileName(msgId), b64);
  vaultSetMessageFields(gid, msgId, { hdRef: vaultHdFileName(msgId), hdStatus: 'pending', hdMime: mime });
  _badge(msgId);
  Object.keys(st.m).forEach(function(nx) { if (DONE[st.m[nx]]) _hdTo(msgId, nx); });
}

// Al reconectar con un miembro: los HD que le faltan (de vídeos cuya previa ya le llegó)
export function resumeGroupHd(nx) {
  var gs = _gs();
  if (!gs) return;
  Object.keys(gs.st).forEach(function(id) {
    var st = gs.st[id];
    if (st && st.hd && DONE[st.m[nx]] && st.hd.n[nx] !== 'sent') _hdTo(id, nx);
  });
}

function _hdTo(base, nx) {
  var bi = _bi(), gs = _gs(), st = gs && gs.st[base], key = base + '_' + nx.substring(2);
  if (!st || !st.hd || st.hd.n[nx] === 'sent' || _inflight[key] || !bi || typeof bi.sendFile !== 'function') return;
  _inflight[key] = true;
  var mime = st.hd.mime || 'video/webm';
  (_hdMem[base] ? Promise.resolve(_hdMem[base]) : vaultLoadFile(vaultHdFileName(base))).then(function(b64) {
    if (!b64) throw new Error('el HD ya no está');
    console.log('[VIDEO] HD de ' + base + ' a ' + nx + ' (grupo, ' + Math.round(b64.length / 1024) + ' KB)');
    _badge(base);
    return bi.sendFile(nx, key + '_hd', b64, { type: 'video', hdFor: key, mime: mime, format: _videoFormat(mime), size: b64.length });
  }).then(function() {
    st.hd.n[nx] = 'sent';
    gs._save();
  }, function(err) {
    console.warn('[VIDEO] HD de ' + base + ' a ' + nx + ' interrumpido, se reintenta al reconectar: ' + (err && err.message));
  }).then(function() {
    delete _inflight[key];
    if (_badge(base)) { delete _hdMem[base]; vaultSetMessageFields(st.g, base, { hdStatus: 'sent' }); }
  });
}

// Etiqueta del vídeo propio: "HD n/m" hasta "HD ✓" (true si ya lo tienen todos)
function _badge(base) {
  var st = _gs() && _gs().st[base];
  if (!st || !st.hd) return false;
  var all = Object.keys(st.m), got = all.filter(function(nx) { return st.hd.n[nx] === 'sent'; }).length;
  var done = all.length > 0 && got >= all.length;
  _setHdBadge(base, done ? 'HD ✓' : 'HD ' + got + '/' + all.length);
  return done;
}

// Receptor: chat del grupo donde está la copia 'gm…_xxxxxxxx' que mandó 'from' (null si no está en ningún grupo)
export function videoGroupChatOf(from, wid) {
  var gs = _gs(), nx = _nid(from);
  if (!gs || !isGroupWire(wid)) return Promise.resolve(null);
  var gids = gs.all().filter(function(g) { return g.members.indexOf(nx) >= 0; }).map(function(g) { return g.id; });
  return gids.reduce(function(p, gid) {
    return p.then(function(found) {
      if (found) return found;
      return vaultLoadMessages(gid).then(function(ms) { return (ms || []).some(function(m) { return m.msgId === wid; }) ? gid : null; });
    });
  }, Promise.resolve(null));
}
