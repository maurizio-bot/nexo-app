/**
 * i18n.js (#132, pedido del dueño 30-10) — selección de idioma de NEXO.
 * Idiomas para empezar: español (es), italiano (it), inglés (en). Preparado para añadir más (basta otra entrada en
 * STRINGS y en LANGS).
 *   - Por DEFECTO se ajusta al idioma del TELÉFONO (navigator.language, el mismo criterio que cobro.js usa para la moneda
 *     «del país/idioma del teléfono»). NO usa GPS ni pide permisos (encaja con la privacidad de NEXO).
 *   - Se puede CAMBIAR en Perfil → Ajustes (🌐 Idioma); la elección se guarda por teléfono en localStorage (NO viaja a
 *     los contactos, como las demás preferencias).
 *   - `t(clave)` devuelve el texto en el idioma actual; si falta, cae al español (base) y luego a la propia clave, así que
 *     nunca rompe aunque una traducción quede incompleta (el resto de la app, todavía en español, sigue funcionando).
 *   - Al cambiar el idioma se emite `nexo:lang`; la app recarga la interfaz para aplicarlo en todas las pantallas.
 * Sin dependencias: se puede probar en Node (tests/sim/i18n.js) sin construir.
 */
'use strict';

export var LANGS = ['es', 'it', 'en'];
export var LANG_NAMES = { es: 'Español', it: 'Italiano', en: 'English' };

// Tabla de textos. Fase 1: pantalla de Ajustes + comunes. El resto de la app se pasa a claves por fases (hoy sigue en
// español literal; `t` cae al español si falta la clave, así que conviven sin romperse).
var STRINGS = {
  es: {
    settings_title: 'Ajustes',
    settings_back: '‹ Perfil',
    language: 'Idioma',
    language_hint: 'Por defecto, el idioma de tu teléfono. Puedes cambiarlo cuando quieras.',
    privacy: 'Privacidad',
    read_receipts: 'Confirmaciones de lectura (✓✓ azul)',
    security: 'Seguridad',
    notifications: 'Avisos',
    calls_tone: 'Llamadas y tono',
    internet: 'Internet',
    diagnostics: 'Diagnóstico',
    account: 'Tu cuenta',
    save: 'Guardar',
    cancel: 'Cancelar',
    close: 'Cerrar',
  },
  it: {
    settings_title: 'Impostazioni',
    settings_back: '‹ Profilo',
    language: 'Lingua',
    language_hint: 'Per impostazione predefinita, la lingua del tuo telefono. Puoi cambiarla quando vuoi.',
    privacy: 'Privacy',
    read_receipts: 'Conferme di lettura (✓✓ blu)',
    security: 'Sicurezza',
    notifications: 'Notifiche',
    calls_tone: 'Chiamate e suoneria',
    internet: 'Internet',
    diagnostics: 'Diagnostica',
    account: 'Il tuo account',
    save: 'Salva',
    cancel: 'Annulla',
    close: 'Chiudi',
  },
  en: {
    settings_title: 'Settings',
    settings_back: '‹ Profile',
    language: 'Language',
    language_hint: "Defaults to your phone's language. You can change it anytime.",
    privacy: 'Privacy',
    read_receipts: 'Read receipts (blue ✓✓)',
    security: 'Security',
    notifications: 'Notifications',
    calls_tone: 'Calls & ringtone',
    internet: 'Internet',
    diagnostics: 'Diagnostics',
    account: 'Your account',
    save: 'Save',
    cancel: 'Cancel',
    close: 'Close',
  },
};

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
  return l;
}

// Texto por clave en el idioma actual; cae al español y luego a la clave (o al fallback dado). Nunca lanza.
export function t(key, fallback) {
  var l = getLang();
  var tbl = STRINGS[l] || STRINGS.es;
  if (tbl && tbl[key] != null) return tbl[key];
  if (STRINGS.es[key] != null) return STRINGS.es[key];
  return (fallback != null) ? fallback : key;
}

export function langName(l) { return LANG_NAMES[l] || l; }

// Solo para pruebas: reinicia la caché (para comprobar la detección por locale sin recargar el módulo).
export function _resetForTest() { _lang = null; }
