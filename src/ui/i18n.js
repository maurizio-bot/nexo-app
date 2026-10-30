/**
 * i18n.js (#132, pedido del dueño 30-10) — selección de idioma de NEXO.
 * Idiomas: español (es), italiano (it), inglés (en). Preparado para añadir más (otra clave en cada fila de STRINGS y en
 * LANGS/LANG_NAMES).
 *   - Por DEFECTO se ajusta al idioma del TELÉFONO (navigator.language, el mismo criterio que cobro.js usa para la moneda
 *     «del país/idioma del teléfono»). NO usa GPS ni pide permisos (encaja con la privacidad de NEXO). El dueño confirmó
 *     este criterio el 30-10.
 *   - Se puede CAMBIAR en Perfil → Ajustes (🌐 Idioma); la elección se guarda por teléfono en localStorage (NO viaja).
 *   - `t(clave)` devuelve el texto en el idioma actual; si falta la traducción cae al ESPAÑOL (base) y luego a la propia
 *     clave, así que nunca rompe aunque una zona todavía no esté traducida.
 *   - Al cambiar el idioma se emite `nexo:lang` y la app recarga para aplicarlo en todas las pantallas.
 *   - `applyStaticI18n(root)` traduce el HTML estático marcado con data-i18n / data-i18n-ph / data-i18n-title.
 * La tabla es CLAVE-primero ({ clave: { es, it, en } }) para tener las tres traducciones juntas y ver de un vistazo si
 * falta alguna. Sin dependencias: se prueba en Node (tests/sim/i18n.js) sin construir.
 */
'use strict';

export var LANGS = ['es', 'it', 'en'];
export var LANG_NAMES = { es: 'Español', it: 'Italiano', en: 'English' };

// Tabla de textos CLAVE-primero. El `es` debe ser IDÉNTICO al texto original (el simulador se fija a español, así que
// las pruebas que comprueban textos en español siguen pasando). Se va ampliando por zonas (Fase 2).
var STRINGS = {
  // Ajustes (Fase 1)
  settings_title: { es: 'Ajustes', it: 'Impostazioni', en: 'Settings' },
  settings_back: { es: '‹ Perfil', it: '‹ Profilo', en: '‹ Profile' },
  language: { es: 'Idioma', it: 'Lingua', en: 'Language' },
  language_hint: { es: 'Por defecto, el idioma de tu teléfono. Puedes cambiarlo cuando quieras.', it: 'Per impostazione predefinita, la lingua del tuo telefono. Puoi cambiarla quando vuoi.', en: "Defaults to your phone's language. You can change it anytime." },
  privacy: { es: 'Privacidad', it: 'Privacy', en: 'Privacy' },
  read_receipts: { es: 'Confirmaciones de lectura (✓✓ azul)', it: 'Conferme di lettura (✓✓ blu)', en: 'Read receipts (blue ✓✓)' },
  security: { es: 'Seguridad', it: 'Sicurezza', en: 'Security' },
  notifications: { es: 'Avisos', it: 'Notifiche', en: 'Notifications' },
  calls_tone: { es: 'Llamadas y tono', it: 'Chiamate e suoneria', en: 'Calls & ringtone' },
  internet: { es: 'Internet', it: 'Internet', en: 'Internet' },
  diagnostics: { es: 'Diagnóstico', it: 'Diagnostica', en: 'Diagnostics' },
  account: { es: 'Tu cuenta', it: 'Il tuo account', en: 'Your account' },
  save: { es: 'Guardar', it: 'Salva', en: 'Save' },
  cancel: { es: 'Cancelar', it: 'Annulla', en: 'Cancel' },
  close: { es: 'Cerrar', it: 'Chiudi', en: 'Close' },

  // Pantalla principal: navegación y lista de contactos (Fase 2a)
  nav_contactos: { es: 'Contactos', it: 'Contatti', en: 'Contacts' },
  nav_compartir: { es: 'Compartir', it: 'Condividi', en: 'Share' },
  cam_video: { es: 'VÍDEO', it: 'VIDEO', en: 'VIDEO' },
  cam_foto: { es: 'FOTO', it: 'FOTO', en: 'PHOTO' },
  ph_contacto: { es: 'Contacto', it: 'Contatto', en: 'Contact' },
  ph_mensaje: { es: 'Mensaje...', it: 'Messaggio...', en: 'Message...' },
  view_once: { es: 'Ver una vez', it: 'Vedi una volta', en: 'View once' },
  add_contacts: { es: 'Agregar contactos', it: 'Aggiungi contatti', en: 'Add contacts' },
  ph_search_contact: { es: 'Buscar por nombre o NEXO ID', it: 'Cerca per nome o NEXO ID', en: 'Search by name or NEXO ID' },
  add_by_id: { es: 'Agregar por NEXO ID (está lejos)', it: 'Aggiungi tramite NEXO ID (è lontano)', en: 'Add by NEXO ID (far away)' },
  add: { es: 'Agregar', it: 'Aggiungi', en: 'Add' },
  online_now: { es: 'En línea ahora', it: 'Online adesso', en: 'Online now' },
  your_contacts: { es: 'Tus contactos', it: 'I tuoi contatti', en: 'Your contacts' },
  ph_addid: { es: 'NX……… (su NEXO ID)', it: 'NX……… (il suo NEXO ID)', en: 'NX……… (their NEXO ID)' },
  requests_for_you: { es: 'Solicitudes para ti', it: 'Richieste per te', en: 'Requests for you' },
  // Estado de conexión (subtítulo bajo el nombre, main.js)
  st_online: { es: 'En línea', it: 'Online', en: 'Online' },
  st_connecting: { es: 'Conectando…', it: 'Connessione…', en: 'Connecting…' },
  st_bluetooth: { es: 'Bluetooth', it: 'Bluetooth', en: 'Bluetooth' },
  st_internet: { es: 'Internet', it: 'Internet', en: 'Internet' },
  st_wifi: { es: 'Wi-Fi', it: 'Wi-Fi', en: 'Wi-Fi' },
  st_weak_signal: { es: 'señal débil', it: 'segnale debole', en: 'weak signal' },
  st_offline: { es: 'Sin conexión', it: 'Non connesso', en: 'Offline' },
  st_jump: { es: 'Por Jump', it: 'Tramite Jump', en: 'Via Jump' },
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
  var row = STRINGS[key];
  if (row) {
    var l = getLang();
    if (row[l] != null) return row[l];
    if (row.es != null) return row.es;
  }
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
  } catch (e) {}
}

// Solo para pruebas: reinicia la caché (para comprobar la detección por locale sin recargar el módulo).
export function _resetForTest() { _lang = null; }
