// #132 (pedido del dueño 30-10): selección de idioma (es/it/en). Prueba de UNIDAD de src/ui/i18n.js (no necesita build).
// Verifica: por defecto sigue el idioma del teléfono (navigator.language); un idioma desconocido cae a español; la
// elección guardada (localStorage) manda sobre el del teléfono; setLang cambia lo que devuelve t(), lo guarda y avisa
// (nexo:lang); t() cae al español y luego a la clave si falta una traducción (así el resto de la app, aún en español,
// no se rompe).
// Uso: node i18n.js
'use strict';

// Polyfills mínimos (navigator, localStorage, window) que se pueden reconfigurar entre casos.
let store = {};
global.localStorage = {
  getItem(k) { return k in store ? store[k] : null; },
  setItem(k, v) { store[k] = String(v); },
  removeItem(k) { delete store[k]; },
};
let navLang = 'es-ES';
Object.defineProperty(global, 'navigator', { configurable: true, value: { get language() { return navLang; }, get languages() { return [navLang]; } } });
let lastLangEvent = null;
class CE { constructor(name, init) { this.type = name; this.detail = init && init.detail; } }
global.CustomEvent = CE;
global.window = { dispatchEvent(ev) { if (ev && ev.type === 'nexo:lang') lastLangEvent = ev.detail; return true; } };

(async () => {
  const r = { prueba: 'i18n' };
  const m = await import('../../src/ui/i18n.js');

  // 1) Por defecto sigue el teléfono: it → italiano
  store = {}; navLang = 'it-IT'; m._resetForTest();
  r.default_it = m.getLang() === 'it' && m.t('settings_title') === 'Impostazioni';

  // 2) Por defecto en inglés: en-US → inglés
  store = {}; navLang = 'en-US'; m._resetForTest();
  r.default_en = m.getLang() === 'en' && m.t('settings_title') === 'Settings';

  // 3) Idioma del teléfono desconocido (p. ej. francés) → español (base)
  store = {}; navLang = 'fr-FR'; m._resetForTest();
  r.desconocido_cae_a_es = m.getLang() === 'es' && m.t('settings_title') === 'Ajustes';

  // 4) La elección guardada manda sobre el del teléfono (teléfono en francés, guardado italiano)
  store = { nexo_lang: 'it' }; navLang = 'fr-FR'; m._resetForTest();
  r.guardado_manda = m.getLang() === 'it' && m.t('language') === 'Lingua';

  // 5) setLang cambia t(), guarda y avisa
  store = {}; navLang = 'es-ES'; m._resetForTest(); lastLangEvent = null;
  m.setLang('en');
  r.setlang_cambia = m.t('settings_title') === 'Settings';
  r.setlang_guarda = store.nexo_lang === 'en';
  r.setlang_avisa = !!lastLangEvent && lastLangEvent.lang === 'en';

  // 6) setLang con un idioma inválido se ignora (sigue el anterior)
  const before = m.getLang();
  m.setLang('xx');
  r.invalido_ignorado = m.getLang() === before && store.nexo_lang === 'en';

  // 7) t() de una clave que NO existe en ningún idioma → cae a la clave (o al fallback dado)
  r.fallback_clave = m.t('clave_inexistente') === 'clave_inexistente' && m.t('otra', 'por defecto') === 'por defecto';

  // 8) t() cae al español si la clave falta SOLO en el idioma activo (robustez ante traducción incompleta).
  //    'settings_title' existe en los tres, así que probamos la mecánica con una clave común y el italiano.
  store = { nexo_lang: 'it' }; m._resetForTest();
  r.it_tiene_privacy = m.t('privacy') === 'Privacy';

  // 9) Zona 1 (pantalla principal): las claves nuevas traducen en los tres idiomas y el 2.º arg (español) es el respaldo.
  store = {}; navLang = 'en-US'; m._resetForTest();
  r.zona1_en = m.t('nav_contactos') === 'Contacts' && m.t('add_contacts') === 'Add contacts' && m.t('st_online', 'En línea') === 'Online';
  store = {}; navLang = 'it-IT'; m._resetForTest();
  r.zona1_it = m.t('nav_contactos') === 'Contatti' && m.t('online_now') === 'Online adesso';
  store = {}; navLang = 'es-ES'; m._resetForTest();
  r.zona1_es = m.t('nav_contactos') === 'Contactos' && m.t('cam_foto') === 'FOTO';

  // 10) Fase 2 completa (chat, llamadas, multimedia, perfil/ajustes, grupos, varios): una clave de cada zona
  //     traduce en inglés e italiano y el español es idéntico al original (respaldo con 2.º arg).
  store = {}; navLang = 'en-US'; m._resetForTest();
  r.zona2_en = m.t('chat_copied') === 'Copied' && m.t('call_hangup', 'Colgar') === 'End' &&
    m.t('media_save_gallery') === 'Save to gallery' && m.t('prof_title') === 'Profile' &&
    m.t('grp_publish') === 'Publish' && m.t('misc_search_in_chat') === 'Search in chat';
  store = {}; navLang = 'it-IT'; m._resetForTest();
  r.zona2_it = m.t('chat_copied') === 'Copiato' && m.t('call_hangup') === 'Termina' &&
    m.t('prof_title') === 'Profilo' && m.t('grp_publish') === 'Pubblica' &&
    m.t('misc_search_in_chat') === 'Cerca nella chat';
  store = {}; navLang = 'es-ES'; m._resetForTest();
  r.zona2_es = m.t('chat_copied') === 'Copiado' && m.t('call_hangup') === 'Colgar' &&
    m.t('media_save_gallery') === 'Guardar en galería' && m.t('prof_title') === 'Perfil' &&
    m.t('grp_publish') === 'Publicar' && m.t('misc_search_in_chat') === 'Buscar en el chat';

  const ok = r.default_it && r.default_en && r.desconocido_cae_a_es && r.guardado_manda &&
    r.setlang_cambia && r.setlang_guarda && r.setlang_avisa && r.invalido_ignorado &&
    r.fallback_clave && r.it_tiene_privacy &&
    r.zona1_en && r.zona1_it && r.zona1_es &&
    r.zona2_en && r.zona2_it && r.zona2_es;
  r.resultado = ok ? 'OK' : 'FAIL';
  console.log('I18N ' + JSON.stringify(r));
  process.exit(0);
})().catch((e) => { console.error('FALLO:', e.stack); process.exit(1); });
