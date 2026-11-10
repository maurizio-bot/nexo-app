/**
 * display_name.js — #dueño 06-11: el NOMBRE con el que te ven tus contactos se pide UNA sola vez (en la primera
 * descarga/primer arranque) y NO se puede cambiar después, para evitar PERFILES FALSOS / FRAUDES (que alguien se gane
 * la confianza con un nombre y luego lo cambie para hacerse pasar por otro).
 *
 * Antes NEXO mostraba el "nombre del teléfono" (bi.localDeviceName, leído del sistema, que el usuario podía cambiar en
 * Android). Ahora, elegido el nombre en NEXO, ese queda FIJO y es el que se manda a los contactos: todas las vías de
 * propagación (saludo kx `pkt.nm`, solicitudes por ID, senderName, Fénix) usan bi.localDeviceName, así que basta con
 * pisar bi.localDeviceName con el nombre elegido al arrancar.
 *
 * Se guarda cifrado en reposo con el plugin (loadFromFile/saveToFile, igual que la foto y el perfil). Sin dependencias
 * duras: en el simulador el plugin de mentira responde; si no hay plugin, cae a vacío sin romper. La pantalla es
 * OBLIGATORIA (no se puede saltar) y se pre-rellena con el nombre actual del teléfono para que al usuario de siempre le
 * baste confirmar; el usuario nuevo escribe el suyo.
 */

import { t } from './i18n.js';

var FILE = 'nexo_display_name.json';
var NAME_MAX = 40;
var _state = { name: '', locked: false };
var _loaded = false;

function _pl() { try { return (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.NexoBLE) || null; } catch (e) { return null; } }
// #dueño 06-11: el nombre son SOLO letras (con acentos/ñ), espacios, guion y apóstrofe (nombres reales tipo «Jean-Pierre»
// u «O'Brien»). NADA de números ni símbolos (para que sea un nombre de verdad, no un alias raro). _stripName quita lo no
// permitido pero DEJA los espacios tal cual (para poder escribir «Juan Pérez» mientras se teclea); _clean además colapsa
// espacios y recorta (al confirmar / guardar).
function _stripName(s) { return String(s == null ? '' : s).replace(/[0-9]/g, '').replace(/[^\p{L}\s'\-]/gu, '').slice(0, NAME_MAX); }
function _clean(s) { return _stripName(s).replace(/\s+/g, ' ').trim(); }

function _lsGet(k) { try { return (typeof localStorage !== 'undefined') ? localStorage.getItem(k) : null; } catch (e) { return null; } }
function _lsSet(k, v) { try { if (typeof localStorage !== 'undefined') localStorage.setItem(k, v); } catch (e) {} }

/** Carga el nombre guardado (una vez). Devuelve el nombre ('' si no hay). La verdad en producción es el archivo cifrado
 * del plugin; localStorage es una caché rápida (y la vía de siembra en el simulador). */
export function loadDisplayName() {
  var ls = _lsGet('nexo_display_name'); if (ls && !_state.name) _state = { name: _clean(ls), locked: true };
  var pl = _pl();
  if (!pl || typeof pl.loadFromFile !== 'function') { _loaded = true; return Promise.resolve(_state.name); }
  return pl.loadFromFile({ filename: FILE }).then(function (r) {
    if (r && r.exists && r.content) { try { var o = JSON.parse(r.content); if (o && o.name) _state = { name: _clean(o.name), locked: !!o.locked }; } catch (e) {} }
    _loaded = true;
    return _state.name;
  }).catch(function () { _loaded = true; return _state.name; });
}
export function displayNameLoaded() { return _loaded; }
export function myDisplayName() { return _state.name || ''; }
/** ¿Ya está fijado (y por tanto no se puede cambiar)? */
export function displayNameLocked() { return !!(_state.locked && _state.name); }

function _save() { var pl = _pl(); if (pl && typeof pl.saveToFile === 'function') pl.saveToFile({ filename: FILE, content: JSON.stringify(_state) }).catch(function () {}); _lsSet('nexo_display_name', _state.name || ''); }

/** Al arrancar: si hay nombre elegido, que sea el que ven los contactos (pisa el nombre del teléfono). */
export function applyDisplayName(bi) { try { if (bi && _state.name) bi.localDeviceName = _state.name; } catch (e) {} }

/** Guarda el nombre elegido UNA sola vez y lo bloquea; lo aplica a bi.localDeviceName. Devuelve true si se guardó. */
export function setDisplayNameOnce(bi, name) {
  var n = _clean(name);
  if (!n || displayNameLocked()) return false;   // vacío o ya fijado → no se cambia
  _state = { name: n, locked: true };
  _save();
  applyDisplayName(bi);
  return true;
}

// Lógica PURA testeable: ¿hace falta pedir el nombre? Sí salvo que ya esté fijado.
export function nameGateNeeded(locked, force) { return !force && !locked; }

function _injectStyles() {
  if (typeof document === 'undefined' || document.getElementById('nexo-name-styles')) return;
  var s = document.createElement('style');
  s.id = 'nexo-name-styles';
  s.textContent = '#nexo-name-overlay { position: fixed; inset: 0; z-index: 2147483647; display: flex; align-items: center; justify-content: center; padding: 18px; box-sizing: border-box;'
    + ' background: radial-gradient(circle at 18% 8%, rgba(0,200,255,0.16), transparent 42%), radial-gradient(circle at 88% 92%, rgba(168,85,247,0.18), transparent 46%), linear-gradient(170deg,#0a0a15 0%,#10112a 55%,#0b1428 100%); }'
    + ' #nexo-name-overlay .nm-in { width: 100%; max-width: 370px; display: flex; flex-direction: column; color: #fff; text-align: center; box-sizing: border-box; }'
    + ' #nexo-name-overlay .nm-icon { font-size: 54px; line-height: 1; margin: 2px 0 12px; }'
    + ' #nexo-name-overlay .nm-title { font-size: 22px; font-weight: 800; margin: 0 0 10px; background: linear-gradient(135deg,#00c8ff,#a855f7); -webkit-background-clip: text; background-clip: text; color: transparent; }'
    + ' #nexo-name-overlay .nm-body { font-size: 14px; line-height: 1.55; color: #cdd3e6; margin: 0 auto 14px; max-width: 330px; }'
    + ' #nexo-name-overlay input.nm-input { width: 100%; padding: 14px 14px; border-radius: 13px; border: 1.5px solid rgba(255,255,255,0.18); background: rgba(255,255,255,0.06); color: #fff; font-size: 17px; text-align: center; box-sizing: border-box; outline: none; }'
    + ' #nexo-name-overlay input.nm-input:focus { border-color: #00c8ff; }'
    + ' #nexo-name-overlay .nm-warn { font-size: 13px; line-height: 1.5; color: #ffd27a; margin: 12px auto 16px; max-width: 330px; }'
    + ' #nexo-name-overlay .nm-warn b { color: #ffb300; }'
    + ' #nexo-name-overlay .nm-primary { display: block; width: 100%; padding: 15px; border: none; border-radius: 14px; font-size: 16px; font-weight: 700; color: #fff; cursor: pointer; background: linear-gradient(135deg,#00c8ff,#a855f7); box-shadow: 0 8px 22px rgba(0,200,255,0.3); }'
    + ' #nexo-name-overlay .nm-primary:disabled { opacity: 0.45; box-shadow: none; cursor: default; }'
    + '';
  document.head.appendChild(s);
}

/**
 * Pantalla OBLIGATORIA de "elegí tu nombre" (una sola vez). opts: { force, prefill, onDone }.
 *  - Si ya está fijado (y no se fuerza), aplica el nombre y llama onDone() directo (no vuelve a salir).
 *  - No tiene "Saltar": el botón Confirmar está deshabilitado hasta que haya un nombre válido.
 *  - force: mostrarla aunque esté fijada (no se usa en producción; el nombre no se cambia). prefill: valor inicial.
 */
export function nameGate(bi, opts) {
  opts = opts || {};
  var done = typeof opts.onDone === 'function' ? opts.onDone : function () {};
  if (typeof document === 'undefined') { try { done(); } catch (e) {} return; }
  if (!nameGateNeeded(displayNameLocked(), opts.force)) { applyDisplayName(bi); try { done(); } catch (e) {} return; }
  if (document.getElementById('nexo-name-overlay')) return;
  _injectStyles();

  var overlay = document.createElement('div');
  overlay.id = 'nexo-name-overlay';
  var box = document.createElement('div'); box.className = 'nm-in'; overlay.appendChild(box);
  var icon = document.createElement('div'); icon.className = 'nm-icon'; icon.textContent = '🪪';
  var title = document.createElement('div'); title.className = 'nm-title'; title.textContent = t('name_gate_title', '¿Cómo te llamas?');
  var body = document.createElement('div'); body.className = 'nm-body'; body.textContent = t('name_gate_body', 'Este es el nombre con el que te van a ver tus contactos en NEXO.');
  var input = document.createElement('input'); input.className = 'nm-input'; input.id = 'nexo-name-input';
  input.type = 'text'; input.maxLength = NAME_MAX; input.autocomplete = 'off'; input.autocapitalize = 'words'; input.spellcheck = false;
  input.placeholder = t('name_gate_ph', 'Tu nombre');
  var pre = _clean(opts.prefill || (bi && bi.localDeviceName) || '');
  if (pre) input.value = pre;
  var warn = document.createElement('div'); warn.className = 'nm-warn';
  warn.innerHTML = t('name_gate_warn', '⚠️ <b>Escribilo con atención: NO se puede cambiar después.</b> Tu nombre queda fijo para que nadie pueda hacerse pasar por otro (evita perfiles falsos y fraudes).');
  var primary = document.createElement('button'); primary.className = 'nm-primary'; primary.id = 'nexo-name-ok';
  primary.textContent = t('name_gate_ok', 'Confirmar mi nombre');
  box.append(icon, title, body, input, warn, primary);

  function refresh() {
    var live = _stripName(input.value);
    if (input.value !== live) input.value = live;   // #dueño 06-11: quita números/símbolos al instante (deja los espacios)
    primary.disabled = _clean(input.value).length < 1;
  }
  input.addEventListener('input', refresh);
  function confirm() {
    if (_clean(input.value).length < 1) return;
    if (setDisplayNameOnce(bi, input.value)) {
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      try { done(); } catch (e) {}
    }
  }
  primary.onclick = confirm;
  input.addEventListener('keydown', function (e) { if (e.key === 'Enter') confirm(); });

  document.body.appendChild(overlay);
  refresh();
  try { input.focus(); } catch (e) {}
}

// UMD / global, como el resto de módulos de UI (y ganchos para el simulador)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { nameGate: nameGate, nameGateNeeded: nameGateNeeded, loadDisplayName: loadDisplayName, applyDisplayName: applyDisplayName, setDisplayNameOnce: setDisplayNameOnce, myDisplayName: myDisplayName, displayNameLocked: displayNameLocked };
} else if (typeof window !== 'undefined') {
  try {
    window.NEXO_nameGate = nameGate;
    window.__nexoNameGateNeeded = nameGateNeeded;
    window.NEXO_myDisplayName = myDisplayName;
    window.NEXO_displayNameLocked = displayNameLocked;
  } catch (e) {}
}
