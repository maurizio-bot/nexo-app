/**
 * 28-11 (diag. del dueño 27-11 09:45–09:46, S24 ↔ Austin/HONOR, 3167): Austin había perdido a sus contactos (el S24 ya no lo era para él).
 * Sus confirmaciones al S24 llegaban SIN firma válida (no tenía nuestra clave de pareja) y el S24, con razón, las ignoraba (auditoría C1: una
 * confirmación sin firma podría ser falsa) → el mismo mensaje se reenviaba sin fin y nadie sabía por qué.
 * Ahora, sin aceptar nunca una confirmación sin firma:
 *  1. se le pide el intercambio de claves (kx con «pídeme la mía») como mucho una vez cada 10 min por contacto: si me perdió, le llego como
 *     solicitud («te escribió») y al aceptarla queda arreglado;
 *  2. si sigue pasando (3 veces en 10 min), se avisa UNA vez al día al usuario, en claro: que el otro no lo tiene como contacto y qué hacer.
 * Pura la decisión (lostMeStep): prueba lostme.js.
 */
import { t } from './i18n.js';

export var LOSTME_WINDOW_MS = 600000, LOSTME_KX_EVERY_MS = 600000, LOSTME_TELL_AFTER = 3, LOSTME_TELL_EVERY_MS = 86400000;

// st: { n, first, kxAt, toldAt } (o undefined). Devuelve { st, kx, tell }.
export function lostMeStep(st, now) {
  var s = Object.assign({ n: 0, first: now, kxAt: 0, toldAt: 0 }, st || {});
  if (now - s.first > LOSTME_WINDOW_MS) { s.n = 0; s.first = now; }
  s.n++;
  var kx = now - s.kxAt >= LOSTME_KX_EVERY_MS;
  if (kx) s.kxAt = now;
  var tell = s.n >= LOSTME_TELL_AFTER && now - s.toldAt >= LOSTME_TELL_EVERY_MS;
  if (tell) s.toldAt = now;
  return { st: s, kx: kx, tell: tell };
}

var _st = new Map();
export function noteUnsignedAck(ble, nx, name) {
  var r = lostMeStep(_st.get(nx), Date.now());
  _st.set(nx, r.st);
  if (r.kx && ble) {
    var dev = typeof ble._resolveDeviceIdForNexoId === 'function' ? ble._resolveDeviceIdForNexoId(nx) : null;
    console.log('[E2E] ' + nx + ' confirma sin firma válida (quizá ya no me tiene como contacto): le pido el intercambio de claves' + (dev ? '' : ' por otro teléfono')); // i18n-ok: registro
    try {
      if (dev && typeof ble._sendKx === 'function') ble._sendKx(dev, true, true);
      else if (typeof ble._sendKxRouted === 'function') ble._sendKxRouted(nx, true);
    } catch (e) {}
  }
  if (r.tell) {
    var who = name || nx.toUpperCase();
    var msg = who + t('ack_lostme_a', ' no te tiene como contacto: tus mensajes le llegan pero no puede confirmarlos.') + ' ' + t('ack_lostme_b', 'Pídele que acepte tu solicitud en NEXO.');
    console.warn('[E2E] Aviso al usuario: ' + nx + ' no lo tiene como contacto (3 confirmaciones sin firma en 10 min)'); // i18n-ok: registro
    try { if (typeof window !== 'undefined' && window.NEXO_toast) window.NEXO_toast(msg); } catch (e) {}
  }
  return r;
}
