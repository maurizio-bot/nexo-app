/**
 * NEXO Touch (build 2968, pedido del dueño 09-11 «que el user diga: wow, qué bien se siente») — HÁPTICA.
 * Tres sensaciones y nada más, mapeadas a las constantes del SISTEMA Android (View.performHapticFeedback, en el plugin
 * nativo): lo mismo que usan el teclado y los botones del propio Android → el usuario ya conoce la sensación, la controla
 * desde Ajustes del teléfono («Vibración al tocar»), no hace falta permiso y el fabricante la afina (S24 nítido; en un
 * motor pobre el sistema da lo mejor posible o nada — nunca un zumbido). Principios de Android: «clear», 10–20 ms, «entre
 * un háptico buzzy y nada, nada»; una sola sensación por gesto; nunca por píxel de scroll.
 *   tick     → al PRESIONAR cualquier botón (pointerdown; lo pide press.js)
 *   confirm  → momentos de verdad: mensaje enviado, nota de voz grabada, foto tomada, solicitud aceptada, llamada
 *              contestada/colgada
 *   reject   → error de verdad (no se pudo enviar, importe inválido…)
 *   long     → menú por pulsación larga armado · gesture → «responder» por deslizar llega al umbral · segment → snaps
 * Modo (Perfil → Ajustes): 'system' (sigue el ajuste del teléfono; por defecto) · 'on' (siempre, vía efectos predefinidos)
 * · 'off' (nunca). Suplente sin plugin (navegador/simulador): navigator.vibrate con patrones cortos.
 */
var KEY = 'nexo_haptics';
export var HAPTIC_KINDS = ['tick', 'confirm', 'reject', 'long', 'gesture', 'segment'];
export var HAPTIC_TICK_MIN_GAP_MS = 40; // ráfagas: como mucho un tick cada 40 ms
var _root = (typeof window !== 'undefined') ? window : null;
var _last = 0;
// [pegamento] para las pruebas (jsdom): inyectar la ventana cuyo navigator/localStorage/plugin se usan
export function hapticsUse(w) { _root = w || null; _last = 0; }

export function hapticMode() {
  try { var v = _root && _root.localStorage && _root.localStorage.getItem(KEY); return (v === 'on' || v === 'off') ? v : 'system'; } catch (e) { return 'system'; }
}
export function setHapticMode(mode) {
  var m = (mode === 'on' || mode === 'off') ? mode : 'system';
  try { if (_root && _root.localStorage) _root.localStorage.setItem(KEY, m); } catch (e) {}
  return m;
}
// Decisión PURA: ¿se dispara? (modo, tipo, tiempo desde el último)
export function _hapticGate(kind, mode, nowMs, lastMs) {
  if (mode === 'off') return false;
  if (HAPTIC_KINDS.indexOf(kind) < 0) return false;
  if (kind === 'tick' && (nowMs - (lastMs || 0)) < HAPTIC_TICK_MIN_GAP_MS) return false;
  return true;
}
// Suplente (sin plugin): patrón corto. Nunca más de 20 ms de «motor» salvo reject (dos golpes).
export function _fallbackPattern(kind) {
  switch (kind) {
    case 'tick': return 8;
    case 'confirm': return 16;
    case 'reject': return [18, 50, 18];
    case 'long': return 14;
    case 'gesture': return 10;
    case 'segment': return 6;
    default: return 8;
  }
}
export function haptic(kind) {
  var now = Date.now(), mode = hapticMode();
  if (!_hapticGate(kind, mode, now, _last)) return false;
  _last = now;
  var pl = null;
  try { pl = (_root && _root.Capacitor && _root.Capacitor.Plugins && _root.Capacitor.Plugins.NexoBLE) || null; } catch (e) { pl = null; }
  if (pl && typeof pl.haptic === 'function') {
    try { var p = pl.haptic({ kind: kind, mode: mode }); if (p && typeof p.catch === 'function') p.catch(function() {}); } catch (e) {}
    return true;
  }
  var nav = _root && _root.navigator;
  if (nav && typeof nav.vibrate === 'function') { try { nav.vibrate(_fallbackPattern(kind)); } catch (e) {} return true; }
  return false;
}
