/**
 * i18n.js (#132, pedido del dueño 30-10) — selección de idioma de NEXO.
 * Idiomas: español (es), italiano (it), inglés (en). Para añadir uno: su archivo en src/ui/i18n/ (mismas claves), importarlo
 * aquí en TABLES y sumarlo a LANGS/LANG_NAMES.
 *   - Por DEFECTO se ajusta al idioma del TELÉFONO (navigator.language, el mismo criterio que cobro.js usa para la moneda
 *     «del país/idioma del teléfono»). NO usa GPS ni pide permisos (encaja con la privacidad de NEXO). El dueño confirmó
 *     este criterio el 30-10.
 *   - Se puede CAMBIAR en Perfil → Ajustes (🌐 Idioma); la elección se guarda por teléfono en localStorage (NO viaja).
 *   - `t(clave)` devuelve el texto en el idioma actual; si falta la traducción cae al ESPAÑOL (base) y luego a la propia
 *     clave, así que nunca rompe aunque una zona todavía no esté traducida.
 *   - Al cambiar el idioma se emite `nexo:lang` y la app recarga para aplicarlo en todas las pantallas.
 *   - `applyStaticI18n(root)` traduce el HTML estático marcado con data-i18n / data-i18n-ph / data-i18n-title.
 * Los textos van en un archivo por idioma (src/ui/i18n/es.js, it.js, en.js; reestructuración 15-11): t() busca en el del idioma
 * activo y, si falta, en el español. Sin dependencias: se prueba en Node (tests/sim/i18n.js) sin construir.
 */
'use strict';
import ES from './i18n/es.js';
import IT from './i18n/it.js';
import EN from './i18n/en.js';

export var LANGS = ['es', 'it', 'en'];
export var LANG_NAMES = { es: 'Español', it: 'Italiano', en: 'English' };

// Textos: un archivo por idioma en src/ui/i18n/ (reestructuración 15-11, tools/partir_i18n.cjs). El español es el texto original
// (el simulador se fija a español, así que las pruebas que comprueban textos en español siguen pasando) y el respaldo de todos.
var TABLES = { es: ES, it: IT, en: EN };

// El idioma del teléfono (navigator.language), reducido a dos letras; si no es uno de los nuestros → español.
function detectLang() {
  try {
    var nav = (typeof navigator !== 'undefined') ? navigator : null;
    var loc = (nav && nav.languages && nav.languages[0]) || (nav && nav.language) || '';
    var two = String(loc).toLowerCase().slice(0, 2);
    return LANGS.indexOf(two) >= 0 ? two : 'es';
  } catch (e) { return 'es'; }
}

var _lang = null; // caché del idioma activo

// Idioma activo: el guardado (si vale), si no el del teléfono. Se cachea tras el primero.
export function getLang() {
  // Semilla para pruebas/sim: una pantalla de pruebas puede fijar el idioma con window.NEXO_FORCE_LANG (el simulador lo
  // pone en español para que los textos sean deterministas; los teléfonos reales no lo tienen y siguen su locale).
  try {
    if (typeof window !== 'undefined' && window.NEXO_FORCE_LANG && LANGS.indexOf(window.NEXO_FORCE_LANG) >= 0) return window.NEXO_FORCE_LANG;
  } catch (e) {}
  if (_lang) return _lang;
  try {
    var s = (typeof localStorage !== 'undefined') ? localStorage.getItem('nexo_lang') : null;
    if (s && LANGS.indexOf(s) >= 0) { _lang = s; return _lang; }
  } catch (e) {}
  _lang = detectLang();
  return _lang;
}

// Cambiar el idioma: se guarda y se avisa (la app recarga para aplicarlo en todas las pantallas). Un idioma desconocido
// se ignora (defensivo).
export function setLang(l) {
  if (LANGS.indexOf(l) < 0) return getLang();
  _lang = l;
  try { if (typeof localStorage !== 'undefined') localStorage.setItem('nexo_lang', l); } catch (e) {}
  try { if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('nexo:lang', { detail: { lang: l } })); } catch (e) {}
  syncNativeLang();
  return l;
}

// 3122: los avisos del teléfono (los pone el nativo, también con la app cerrada) en el idioma de la app: se le dice al arrancar y al
// cambiarlo. Sin nativo (simulador) no hace nada.
export function syncNativeLang() {
  try {
    var pl = (typeof window !== 'undefined') && window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.NexoBLE;
    if (pl && typeof pl.setAppLang === 'function') Promise.resolve(pl.setAppLang({ lang: getLang() })).catch(function() {});
  } catch (e) {}
}

// Texto por clave en el idioma actual; cae al español y luego a la clave (o al fallback dado). Nunca lanza.
export function t(key, fallback) {
  var tl = TABLES[getLang()];
  if (tl && Object.prototype.hasOwnProperty.call(tl, key) && tl[key] != null) return tl[key];
  if (Object.prototype.hasOwnProperty.call(ES, key) && ES[key] != null) return ES[key];
  return (fallback != null) ? fallback : key;
}

export function langName(l) { return LANG_NAMES[l] || l; }

// Traduce el HTML estático marcado: data-i18n (textContent), data-i18n-ph (placeholder), data-i18n-title (title).
// Se llama al arrancar y tras cambiar idioma (aunque el cambio recarga la app, es barato y deja todo coherente).
export function applyStaticI18n(root) {
  try {
    var r = root || (typeof document !== 'undefined' ? document : null);
    if (!r || typeof r.querySelectorAll !== 'function') return;
    r.querySelectorAll('[data-i18n]').forEach(function(el) { var k = el.getAttribute('data-i18n'); if (k) el.textContent = t(k); });
    r.querySelectorAll('[data-i18n-ph]').forEach(function(el) { var k = el.getAttribute('data-i18n-ph'); if (k) el.setAttribute('placeholder', t(k)); });
    r.querySelectorAll('[data-i18n-title]').forEach(function(el) { var k = el.getAttribute('data-i18n-title'); if (k) el.setAttribute('title', t(k)); });
    r.querySelectorAll('[data-i18n-label]').forEach(function(el) { var k = el.getAttribute('data-i18n-label'); if (k) el.setAttribute('data-label', t(k)); }); // etiqueta que el CSS pinta con attr(data-label) (menú «+»)
  } catch (e) {}
}

// Solo para pruebas: reinicia la caché (para comprobar la detección por locale sin recargar el módulo).
export function _resetForTest() { _lang = null; }
