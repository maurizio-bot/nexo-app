/**
 * ble_relay_pass.js (3024) — la espera por fallos de las conexiones «de paso» (Jump). Sacado de ble_relay.js (tope de 1000 líneas).
 */
import { PASS_MIN_RSSI, PASS_FAIL_BASE_MS, PASS_FAIL_MAX_MS, PASS_RETRY_WINDOW_MS } from './ble_relay_conf.js';

function _mac(m) { return (m || '').toString().toLowerCase().replace(/[:-]/g, '').trim(); }

// ¿Se puede intentar una conexión «de paso» con este teléfono ahora? (señal suficiente y sin espera por fallos)
export function passOk(rel, deviceId, rssi) {
  if (typeof rssi === 'number' && rssi > -100 && rssi <= PASS_MIN_RSSI) return false; // (−100 = sin medida)
  var m = _mac(deviceId), f = rel._passFail && rel._passFail.get(m);
  if (!f) return true;
  if (rel._isReady(deviceId)) { rel._passFail.delete(m); return true; }
  return !(f.until > Date.now());
}

// Se va a intentar; si el intento anterior (hace < 2 min) no llegó a conectar, cuenta como fallo y crece la espera.
// Devuelve false si con eso queda en espera (no se intenta ahora).
export function passTry(rel, deviceId) {
  rel._passFail = rel._passFail || new Map();
  var m = _mac(deviceId), now = Date.now(), f = rel._passFail.get(m) || { n: 0, until: 0, last: 0 };
  if (f.last && now - f.last < PASS_RETRY_WINDOW_MS && !rel._isReady(deviceId)) {
    f.n++; f.until = now + Math.min(PASS_FAIL_MAX_MS, PASS_FAIL_BASE_MS * Math.pow(2, f.n - 1));
    if (f.n === 1 || f.n % 5 === 0) console.log('[JUMP] Conexión de paso con ' + m.slice(-4) + ' sin éxito: vuelvo a probar en ' + Math.round((f.until - now) / 60000) + ' min');
    rel._passFail.set(m, f);
    if (rel._passFail.size > 200) rel._passFail.delete(rel._passFail.keys().next().value);
    return false;
  }
  f.last = now; rel._passFail.set(m, f);
  return true;
}
