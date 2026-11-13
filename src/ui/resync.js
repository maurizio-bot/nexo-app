/**
 * resync.js — 3069: desatasco automático del cifrado entre dos teléfonos (pedido del dueño 13-11, tras el atasco S24↔Nubia).
 *
 * Un «atasco» es que el estado de cifrado de los dos ya no casa (un teléfono arrancó con una copia anterior: lo suyo reutiliza
 * números de mensaje y lo nuevo del otro no se puede leer). Pasos, por el camino que haya (Bluetooth, Wi-Fi, internet, Jump):
 *  1. DETECTAR, en cualquiera de los dos lados: al recibir (e2e_ratchet: DESYNC, o «no se pudo leer» de un contacto), o al
 *     arrancar (el estado se cargó atrasado: e2e_ratchet._selfRollback).
 *  2. GUARDAR: cada mensaje suyo que no se pudo leer queda apuntado (su id) y desde cuándo hay que pedir (la última vez que algo
 *     suyo se leyó bien). Lo propio ya está guardado en el teléfono (vault) con su texto/adjunto.
 *  3. AVISAR al otro con un mensaje oculto { act:'e2e', st:'rst', need:[ids], since } que ya va por una sesión NUEVA (las
 *     viejas quedaron retiradas: e2e_ratchet._retire). Al leerlo, su teléfono pasa a esa sesión.
 *  4. PURGAR y «LISTO»: el otro deja de usar lo viejo (corta envíos en curso con cifrado viejo y sus reanudaciones guardadas) y
 *     contesta { st:'ok', n, need } (también pide lo que él no pudo leer).
 *  5. REENVIAR: el otro vuelve a mandar lo pedido (mismo id: si algo ya había llegado, el receptor lo reconoce y no lo duplica).
 * Todo oculto: sin burbujas ni avisos para el usuario; en el diagnóstico queda la traza «[E2E] Desatasco …».
 */
import { _sendTextTo } from './send.js';
import { _getBLEContacts, _normId } from './ble_helpers.js';
import { ratchetResync } from '../vault/e2e_ratchet.js';

var NEED_MAX = 100;           // ids pedidos por contacto como mucho
var WINDOW_MAX = 60;          // mensajes propios reenviados por la ventana de tiempo como mucho
var WINDOW_MAX_MS = 6 * 3600000;
var SINCE_MARGIN_MS = 2 * 60000;
var FLUSH_MS = 1500;          // se juntan los ids de una ráfaga en un solo aviso
var RST_EVERY_MS = 15000;     // como mucho un aviso por contacto cada 15 s (lo que llegue entre medias va en el siguiente)
var BAD_RESYNC_MS = 2500;     // tras «no se pudo leer», se espera un poco por si llega un aviso del otro (él ya lo detectó)

var _need = {};      // nx → Set(ids que no se pudieron leer)
var _since = {};     // nx → desde cuándo pedir
var _timer = {};     // nx → temporizador del aviso
var _rstAt = {};     // nx → hora del último aviso mandado
var _badT = {};      // nx → temporizador del «abrir sesión nueva» por no poder leer
var _gotRst = {};    // nx → hora del último aviso recibido de él
var _inited = false;

function _isContact(nx) {
  try { return _getBLEContacts().some(function(c) { return _normId(c.nexoId || c.deviceUUID) === nx; }); } catch (e) { return false; }
}

// Paso 2: apuntar un mensaje suyo que no se pudo leer (code 'BAD' o 'DESYNC'). Desde ble_messages / ble_ack / lan.
export function resyncNote(fromNx, msgId, code) {
  var nx = _normId(fromNx);
  if (!/^nx[0-9a-z]{8}$/.test(nx) || !_isContact(nx)) return;
  if (msgId) {
    var set = _need[nx] || (_need[nx] = new Set());
    set.add(String(msgId).substring(0, 80));
    while (set.size > NEED_MAX) set.delete(set.values().next().value);
  }
  if (code === 'BAD') {
    // Paso 1 desde el lado que no puede leer: si en unos segundos no llega su aviso (él no lo detectó), se abre sesión nueva aquí
    if (!_badT[nx]) {
      _badT[nx] = setTimeout(function() {
        _badT[nx] = null;
        if (Date.now() - (_gotRst[nx] || 0) < 60000) { _schedule(nx, 0); return; }
        ratchetResync(nx, 'no se pudo leer lo suyo').then(function(retired) { if (!retired) _schedule(nx, 0); }).catch(function() { _schedule(nx, 0); });
      }, BAD_RESYNC_MS);
    }
    return;
  }
  _schedule(nx, FLUSH_MS);
}

function _schedule(nx, ms) {
  if (_timer[nx]) return;
  var wait = Math.max(ms, RST_EVERY_MS - (Date.now() - (_rstAt[nx] || 0)));
  _timer[nx] = setTimeout(function() { _timer[nx] = null; _flush(nx); }, Math.max(0, wait));
}

// Paso 3: el aviso al otro (oculto; por la sesión nueva si se acaba de retirar la vieja)
function _flush(nx) {
  var need = _need[nx] ? Array.from(_need[nx]) : [];
  var since = _since[nx] || 0;
  if (!need.length && !since) return;
  _need[nx] = new Set();
  _since[nx] = 0;
  _rstAt[nx] = Date.now();
  var act = { type: 'nexo_act', act: 'e2e', st: 'rst', need: need, since: since };
  var id = _sendTextTo(nx, JSON.stringify(act), '', true);
  console.log('[E2E] Desatasco con ' + nx + ': le pido que reenvíe ' + need.length + ' mensaje(s) que no pude leer' + (since ? ' y lo suyo desde ' + new Date(since).toISOString().substring(11, 19) : '') + (id ? '' : ' (no salió)'));
}

// Lo que avisa el cifrado (e2e_ratchet): sesión nueva por desfase, por arrancar atrasado o recordatorio
function _onResync(e) {
  var d = (e && e.detail) || {}, nx = _normId(d.nexoId);
  if (!/^nx[0-9a-z]{8}$/.test(nx)) return;
  var s = Number(d.since) || 0;
  if (s) _since[nx] = _since[nx] ? Math.min(_since[nx], s) : s;
  if (!_since[nx] && !(_need[nx] && _need[nx].size)) _since[nx] = Date.now() - 10 * 60000; // sin pista: los últimos 10 min
  // un recordatorio (ya había sesión nueva) no espera los 15 s: la sesión vieja sigue llegando y hay que decírselo ya
  _schedule(nx, d.why === 'recordatorio' ? 0 : 300);
  // El Wi-Fi con él se comprueba otra vez ya (con la sesión nueva); mientras, lo nuevo sale por Bluetooth/internet (lan.recheck)
  try { var bi = window.bleInterface; if (bi && bi.lan && typeof bi.lan.recheck === 'function') bi.lan.recheck(nx); } catch (e) {}
  // Sin esperar a que lo pida: lo mío desde la última vez que leí algo suyo puede no haberle llegado legible (su nativo lo confirma
  // con ✓✓ antes de poder leerlo). Va ya por la sesión nueva; si ya lo tenía, lo reconoce por el id y no lo duplica. Sirve
  // también si su build es anterior y no sabe pedirlo.
  if (d.why !== 'recordatorio') _resend(nx, [], _since[nx] || (Date.now() - 10 * 60000), false);
}

// Pasos 4 y 5, del lado que recibe el aviso
export function resyncOnAct(senderId, act) {
  var nx = _normId(senderId);
  if (!act || !/^nx[0-9a-z]{8}$/.test(nx)) return;
  if (act.st === 'ok') {
    console.log('[E2E] Desatasco con ' + nx + ' completo: reenvió ' + (Number(act.n) || 0) + ' mensaje(s)');
    if (Array.isArray(act.need) && act.need.length) _resend(nx, act.need, 0, false);
    return;
  }
  if (act.st !== 'rst') return; // 3067: el aviso sin más ('e2e' a secas) solo servía para pasar a la sesión nueva
  _gotRst[nx] = Date.now();
  if (_badT[nx]) { clearTimeout(_badT[nx]); _badT[nx] = null; }
  var need = Array.isArray(act.need) ? act.need.slice(0, NEED_MAX).map(String) : [];
  _resend(nx, need, Number(act.since) || 0, true);
}

function _resend(nx, need, since, reply) {
  var bi = window.bleInterface;
  if (typeof window.vaultLoadMessages !== 'function') return;
  window.vaultLoadMessages(nx).then(function(msgs) {
    var now = Date.now(), floor = since ? Math.max(since - SINCE_MARGIN_MS, now - WINDOW_MAX_MS) : 0;
    var byNeed = {}; need.forEach(function(id) { byNeed[id] = 1; });
    var pick = [], seen = {}, nWin = 0;
    (msgs || []).forEach(function(m) {
      if (!m || m._own !== true) return;
      var id = m.msgId || m.messageId || m.id;
      if (!id || seen[id]) return;
      if (typeof m.content === 'string' && m.content.indexOf('"act":"e2e"') >= 0) return; // los propios avisos, nunca
      var want = !!byNeed[id];
      if (!want && floor && (m.timestamp || 0) >= floor && m.status !== 'read' && nWin < WINDOW_MAX) { want = true; nWin++; }
      if (!want) return;
      seen[id] = 1;
      pick.push(id);
    });
    // Paso 4: purga de lo viejo — envíos en curso y reanudaciones guardadas con cifrado de la sesión retirada
    var ack = bi && bi.ackSystem;
    var jobs = pick.map(function(id) {
      try { var st = ack && ack.outgoingStreams && ack.outgoingStreams.get(id); if (st) { st.resolve = null; st.reject = null; st.abort(); ack.outgoingStreams.delete(id); } } catch (e) {}
      try { if (ack && ack._resumeSeen) ack._resumeSeen.delete(id); if (ack && ack._resumeFail) ack._resumeFail.delete(id); } catch (e) {}
      // el ✓✓ que dio su nativo sin poder leerlo dejó el id como «ya entregado»: sin olvidarlo, el reenvío se lo salta
      try { if (ack && ack._done) ack._done.delete(id); } catch (e) {}
      try { if (bi && bi._chatPrep) bi._chatPrep.delete(id); if (ack && ack._chatPrep) ack._chatPrep.delete(id); } catch (e) {}
      var p1 = (typeof window.vaultRemoveOutgoingTransfer === 'function') ? window.vaultRemoveOutgoingTransfer(nx, id).catch(function() {}) : Promise.resolve();
      // Solo en el almacén (la burbuja sigue con su ✓✓: el usuario no ve nada); el reenvío la deja otra vez en entregado
      return p1.then(function() { return typeof window.vaultPatchMessage === 'function' ? window.vaultPatchMessage(nx, id, { status: 'pending' }) : null; }).catch(function() {});
    });
    return Promise.all(jobs).then(function() {
      if (bi && bi._resendBackoff) bi._resendBackoff.delete(nx);
      // Paso 5: reenviar (cifra otra vez desde lo guardado: ya con la sesión nueva)
      if (pick.length && bi && typeof bi._resendPendingMessages === 'function') { try { bi._resendPendingMessages(nx); } catch (e) {} }
      console.log('[E2E] Desatasco con ' + nx + ': reenvío ' + pick.length + ' mensaje(s) (' + need.length + ' pedidos' + (since ? ', y lo mío desde ' + new Date(since).toISOString().substring(11, 19) : '') + ')');
      if (reply) {
        // «Listo»: también le pido lo que yo no pude leer de él (si había algo apuntado)
        var mine = _need[nx] ? Array.from(_need[nx]) : [];
        _need[nx] = new Set();
        _sendTextTo(nx, JSON.stringify({ type: 'nexo_act', act: 'e2e', st: 'ok', n: pick.length, need: mine }), '', true);
      }
    });
  }).catch(function(e) { console.warn('[E2E] Desatasco con ' + nx + ': no se pudo preparar el reenvío: ' + (e && e.message)); });
}

export function resyncInit() {
  if (_inited) return;
  _inited = true;
  window.addEventListener('nexo:e2e:resync', _onResync);
  window.NEXO_resyncNote = resyncNote;
  window.NEXO_resyncOnAct = resyncOnAct;
}
