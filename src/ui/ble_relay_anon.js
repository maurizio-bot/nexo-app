/**
 * ble_relay_anon.js (3303, diagnóstico S24 23-11 08:27) — NEXO «anónimos» (código rotativo que no reconozco) que ya dijeron quién son.
 * El S24 sondeaba «de paso» una dirección anónima que resultaba ser Alex, al que ya tenía enlazado por otra dirección: quedaba un
 * 2.º enlace que el desempate cerraba 1–2 min después, y se volvía a sondear la misma dirección (08:22:49, 08:25:07, 08:27:31).
 * Ahora: (1) al identificarse, la dirección → NEXO ID se recuerda 15 min y no se vuelve a sondear (cuenta como «visto» con su
 * NEXO ID); (2) si era un contacto ya enlazado por otra dirección, esa conexión de paso se cierra en el acto.
 */
import { ANON_KNOWN_MS } from './ble_relay_conf.js';

function _nid(id) { return (id || '').toString().toLowerCase().trim(); }
function _mac(m) { return (m || '').toString().toLowerCase().replace(/[:-]/g, '').trim(); }

// ¿Hay otro enlace Bluetooth listo con este NEXO ID por una dirección distinta de exceptMac?
export function otherReadyLink(rel, nx, exceptMac) {
  var ble = rel.ble, map = ble && ble._macToNexoId, found = false;
  if (!ble || !ble._deviceStates || typeof ble._deviceStates.forEach !== 'function') return false;
  ble._deviceStates.forEach(function(v, dev) {
    if (found || /^(lan|net)/i.test(String(dev)) || _mac(dev) === exceptMac) return;
    if (_nid(map && map.get(_mac(dev))) === nx && rel._isReady(dev)) found = true;
  });
  return found;
}

// Lo llama relay.identify (al llegar el kx). wasProbe: la conexión la abrí yo «de paso» para saber quién era.
export function anonIdentified(rel, deviceId, nx, wasProbe) {
  var m = _mac(deviceId);
  rel.anonKnown.set(m, { nx: nx, ts: Date.now() });
  if (rel.anonKnown.size > 300) rel.anonKnown.delete(rel.anonKnown.keys().next().value);
  if (!wasProbe || !rel._isContact(nx) || !otherReadyLink(rel, nx, m)) return false;
  rel._closedT = rel._closedT || new Map();
  rel._closedT.set(m, Date.now()); if (rel._closedT.size > 100) rel._closedT.delete(rel._closedT.keys().next().value);
  console.log('[JUMP] El NEXO de paso era ' + nx + ', ya enlazado por otra dirección: cierro esta conexión');
  var pl = rel.ble && rel.ble.nativePlugin;
  if (pl && typeof pl.disconnectDevice === 'function') pl.disconnectDevice({ deviceId: deviceId }).catch(function() {});
  return true;
}

// Lo llama relay.noteAnon: si esta dirección ya dijo quién es (hace < 15 min), es él → «visto» con su NEXO ID y no se sondea.
export function anonAlreadyKnown(rel, m, deviceId, rssi) {
  var k = rel.anonKnown.get(m);
  if (!k) return false;
  if (Date.now() - k.ts >= ANON_KNOWN_MS) { rel.anonKnown.delete(m); return false; }
  rel.anon.delete(m);
  rel.noteSeen(k.nx, deviceId, rssi);
  return true;
}
