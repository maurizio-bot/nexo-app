/**
 * call_merge.js — UNIR LLAMADAS (build 3216, idea del dueño 17-11: «si yo estoy en una llamada y me llega otra llamada, incorporarla
 * como si fuera grupo… Hablo con A; B no me contesta. Después B me vuelve a marcar y yo le contesto, y al contestarle puedo decidir si
 * involucrarlo en la misma llamada que ya tenía con A… quita el condicional de tener que estar todos al mismo tiempo»).
 * Como el «unir llamadas» del teléfono de siempre: decide quien une; los otros entran solos (ni el que llamó ni el que ya estaba
 * contestan nada):
 *  - hablo con A y suena B → «Unir a esta llamada» (en la pantalla de la que suena) mete a B directo en la llamada con A;
 *  - ya contesté a B (A en espera, dos llamadas a la vez) → «Unir» junta las dos;
 *  - estoy en una llamada de GRUPO y suena B (o ya le contesté) → B entra a la de grupo (con su tope de personas).
 * Reúsa el paso a grupo de «Agregar» (#221/#224): cada invitación lleva el id de la llamada que ese contacto tenía conmigo (up) y
 * entra sin sonar; la videollamada en la que estoy hablando pasa a la de grupo sin cortar la imagen (handoff → adopt) y cada uno
 * sigue con la cámara como la tenía. La de grupo va por malla (Bluetooth o el mismo Wi-Fi, como group_call.js): si con alguno solo
 * hay internet, no se une y se dice por qué, sin tocar ninguna de las dos llamadas.
 * Sin pantallas: los botones están en calls_ui.js / calls2_ui.js.
 */
import { t } from './i18n.js';
import { gcallMax } from './group_call.js';

function _nid(id) { return (id || '').toString().toLowerCase().trim(); }

// ¿Hay camino DIRECTO con él (Bluetooth listo o el mismo Wi-Fi arriba)? Es lo que necesita un tramo de la llamada de grupo
// (group_call._sendTo: la voz no va por los relés de internet)
function _directOk(ble, nx) {
  var bt = typeof ble._bleReadyFor === 'function' ? ble._bleReadyFor(nx) : null;
  var q = ble.lan && typeof ble.lan.quality === 'function' ? ble.lan.quality(nx) : null;
  var wifi = !!(ble.lan && typeof ble.lan.canReach === 'function' && ble.lan.canReach(nx) && q && q.up);
  return !!(bt || wifi);
}

// ¿Se pueden unir las llamadas de ahora? null si no hay nada que unir (no hay dos, o una todavía no está en curso: la que hago yo y
// aún suena, o una de grupo que me suena); si no, { ok, why, kind: 'pair'|'group', lanes } (ok=false: el botón se ve apagado y al
// tocarlo dice why).
export function mergeCheck(ble, nameOf) {
  if (!ble) return null;
  var g = ble.gcall, gc = g && g.gc;
  var lanes = [ble.calls, ble.calls2].filter(function(l) { return l && l.call; });
  if (!lanes.length || lanes.length + (gc ? 1 : 0) !== 2) return null;
  var joinable = function(c) { return c.state === 'active' || (c.dir === 'in' && c.state === 'ringing'); };
  if (!lanes.every(function(l) { return joinable(l.call); })) return null;
  if (gc ? gc.state !== 'active' : !lanes.some(function(l) { return l.call.state === 'active'; })) return null;
  var name = function(nx) { return (nameOf && nameOf(nx)) || String(nx || '').toUpperCase(); };
  var res = { ok: true, why: '', kind: gc ? 'group' : 'pair', lanes: lanes };
  if (gc) {
    var nx = _nid(lanes[0].call.nx);
    if (gc.roster.has(nx)) return Object.assign(res, { ok: false, why: t('grp_already_in', 'Ya está en la llamada') });
    if (gc.roster.size + 1 > gcallMax()) return Object.assign(res, { ok: false, why: t('grp_max_a', 'Máximo ') + gcallMax() + t('grp_max_call', ' en una llamada de grupo') });
  }
  for (var i = 0; i < lanes.length; i++) {
    var px = _nid(lanes[i].call.nx);
    if (!_directOk(ble, px)) return Object.assign(res, { ok: false, why: t('call_merge_net', 'No se pueden unir: con {name} la llamada va por internet y la de grupo necesita Bluetooth o el mismo Wi-Fi').replace('{name}', name(px)) });
  }
  return res;
}

// Unir. Promesa: true si se unieron; con error (y las dos llamadas como estaban) si no se puede.
export function mergeCalls(ble, nameOf) {
  var m = mergeCheck(ble, nameOf);
  if (!m) return Promise.reject(new Error(t('call_merge_none', 'Ya no hay dos llamadas que unir')));
  if (!m.ok) return Promise.reject(new Error(m.why));
  var g = ble.gcall;
  if (m.kind === 'group') {
    // B entra a la llamada de grupo en curso (como «Agregar», pero sin sonarle: lleva el id de la llamada que tenía conmigo)
    var l = m.lanes[0], c = l.call, nx = _nid(c.nx);
    var p = g.addMember(nx, { up: c.id, v: c.video ? 1 : 0 });
    if (!(g.gc && g.gc.roster.has(nx))) return p; // no entró: las dos siguen como estaban
    console.log('[CALL] Unir: ' + nx + ' entra a la llamada de grupo');
    try { l._finish('merged', false); } catch (e) {}
    if (g.gc && g.gc.held) g.hold(false); // estaba en espera porque hablaba con él: ahora estamos todos
    return Promise.resolve(p).then(function() { return true; }, function() { return true; });
  }
  // Dos llamadas 1-a-1: la de grupo con los dos. La que tengo «delante» (en curso y no en espera) manda: si es videollamada, pasa sin
  // cortar (mi cámara y su imagen siguen); la otra (sonando o en espera) termina aquí sin avisar (su lado hace lo mismo al recibir la
  // invitación con el id de su llamada).
  var cur = m.lanes.filter(function(x) { return x.call.state === 'active' && !x.call.held; })[0] || m.lanes.filter(function(x) { return x.call.state === 'active'; })[0];
  var other = m.lanes[0] === cur ? m.lanes[1] : m.lanes[0];
  var X = cur.call, Y = other.call;
  var ups = [X, Y].map(function(c) { return { nx: c.nx, id: c.id, v: c.video ? 1 : 0, ul: 1 }; });
  var ad = X.video && !X.held && typeof cur.handoff === 'function' ? cur.handoff() : null;
  var video = !!(ad || (X.video && !X.cameraOff));
  console.log('[CALL] Unir: ' + X.nx + ' y ' + Y.nx + ' pasan a una llamada de grupo' + (ad ? ' (sin cortar la imagen)' : ''));
  [cur, other].forEach(function(x) { if (x.call) { try { x._finish('merged', false); } catch (e) {} } });
  return g.start([X.nx, Y.nx], video, null, { upgrade: ups, adopt: ad }).then(function() { return true; }, function(err) {
    if (ad && !(g.gc && g.gc.adopt)) { try { ad.media.stop(); } catch (e) {} }
    throw err;
  });
}
