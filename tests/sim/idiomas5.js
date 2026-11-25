// 3123 (dueño 15-11: «agregar un idioma o dos… portugués y francés»; PLAN etapa 1): NEXO en 5 idiomas. Prueba de UNIDAD de i18n.js:
//  I1  la app ofrece español, italiano, inglés, portugués (Brasil) y francés (el selector de Ajustes sale de LANGS);
//  I2  por defecto el del teléfono: pt-BR → portugués, fr-CA → francés; uno que no tenemos (alemán) → español;
//  I3  cada idioma tiene TODOS los textos del español (ninguno cae al español por falta);
//  I4  los avisos del teléfono: al cambiar de idioma y al arrancar, la app le dice al nativo cuál usa (setAppLang);
//  I5  las novedades: el español siempre; portugués y francés, si están, con lo suyo (dueño 17-11: en desarrollo, solo español).
// Contraprueba: la 3122 tiene 3 idiomas.
// Uso: node idiomas5.js [dir_build]
'use strict';
const fs = require('fs');
const path = require('path');
const { importSrc, buildDir } = require('./srcmod');
let store = {};
global.localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } };
let navLang = 'es-ES';
Object.defineProperty(global, 'navigator', { configurable: true, value: { get language() { return navLang; }, get languages() { return [navLang]; } } });
global.CustomEvent = class { constructor(n, i) { this.type = n; this.detail = i && i.detail; } };
const nativeCalls = [];
global.window = { dispatchEvent: () => true, Capacitor: { Plugins: { NexoBLE: { setAppLang: async (o) => { nativeCalls.push(o && o.lang); return { lang: o && o.lang }; } } } } };
(async () => {
  const r = { prueba: 'idiomas5', build: path.basename(buildDir) };
  const m = await importSrc('ui/i18n.js');
  r.idiomas = m.LANGS.join(',');
  r.I1_cinco = ['es', 'it', 'en', 'pt', 'fr'].every((l) => m.LANGS.indexOf(l) >= 0) && m.langName('pt') === 'Português (Brasil)' && m.langName('fr') === 'Français';
  const T = {};
  for (const l of m.LANGS) { try { T[l] = (await importSrc('ui/i18n/' + l + '.js')).default; } catch (e) { T[l] = null; } }
  for (const l of m.LANGS) { try { if (T[l]) T[l] = Object.assign({}, T[l], (await importSrc('ui/i18n/' + l + '_b.js')).default); } catch (e) {} } // 22-11: segunda parte
  store = {}; navLang = 'pt-BR'; m._resetForTest();
  const pt = m.getLang(), ptTxt = m.t('settings_title');
  store = {}; navLang = 'fr-CA'; m._resetForTest();
  const fr = m.getLang(), frTxt = m.t('settings_title');
  store = {}; navLang = 'de-DE'; m._resetForTest();
  const de = m.getLang();
  r.I2_telefono = { pt, ptTxt, fr, frTxt, de };
  r.I2_ok = pt === 'pt' && fr === 'fr' && de === 'es' && !!T.pt && ptTxt === T.pt.settings_title && !!T.fr && frTxt === T.fr.settings_title && ptTxt !== 'Ajustes' && frTxt !== 'Ajustes';
  const es = T.es || {};
  const faltan = {};
  for (const l of ['pt', 'fr']) faltan[l] = T[l] ? Object.keys(es).filter((k) => !(k in T[l])).length : -1;
  r.I3_faltan = faltan;
  r.I3_completos = faltan.pt === 0 && faltan.fr === 0;
  nativeCalls.length = 0;
  m.setLang('fr');
  if (typeof m.syncNativeLang === 'function') m.syncNativeLang();
  await new Promise((res) => setTimeout(res, 20));
  r.I4_nativo = nativeCalls.slice();
  r.I4_ok = nativeCalls[0] === 'fr' && nativeCalls.length === 2;
  const md = fs.readFileSync(path.join(__dirname, '..', '..', 'NOVEDADES.md'), 'utf8');
  const a = md.indexOf('<!-- APK -->\n'), b = md.indexOf('<!-- /APK -->\n');
  const block = a >= 0 && b > a ? md.slice(a, b) : '';
  const { updaterNotesText } = await importSrc('ui/updater.js');
  const nPt = updaterNotesText(block, 'pt'), nFr = updaterNotesText(block, 'fr'), nEs = updaterNotesText(block, 'es');
  // dueño 17-11: en desarrollo, las novedades solo en español; si un idioma está, con lo suyo (no el español copiado)
  r.I5_novedades = nEs.length > 20 && (!/<pt-BR>/.test(block) || (nPt.length > 20 && nPt !== nEs)) && (!/<fr-FR>/.test(block) || (nFr.length > 20 && nFr !== nEs));
  const ok = r.I1_cinco && r.I2_ok && r.I3_completos && r.I4_ok && r.I5_novedades;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('IDIOMAS5 ' + JSON.stringify(r));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('IDIOMAS5 ' + JSON.stringify({ prueba: 'idiomas5', resultado: 'FALLO', error: String(e && e.message) })); process.exit(1); });
