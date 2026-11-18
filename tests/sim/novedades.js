// 3105 (dueño 15-11: «quiero que aparezca… lo que se tocó y lo que se actualizó, una breve descripción de lo que se hizo… para tener ya
// un antecedente para cuando se suba a Google Play»). NOVEDADES.md lleva, entre las marcas <!-- APK --> y <!-- /APK --> (cada una en su
// línea), las novedades de la próxima APK en el formato de Google Play. El workflow las pone como descripción del lanzamiento y la app
// las muestra junto al botón de actualizar. Esta prueba comprueba que el bloque existe, que tiene español, italiano e inglés, que
// ninguno pasa de 500 caracteres (tope de Google Play) y que la app lee cada idioma.
// Uso: node novedades.js [dir_build]
'use strict';
const fs = require('fs');
const path = require('path');
const { importSrc } = require('./srcmod');
(async () => {
  const r = { prueba: 'novedades' };
  const md = fs.readFileSync(path.join(__dirname, '..', '..', 'NOVEDADES.md'), 'utf8');
  // mismo recorte que el workflow (awk con las marcas en su propia línea)
  const lines = md.split('\n'); let f = false; const out = [];
  for (const l of lines) { if (l === '<!-- APK -->') { f = true; continue; } if (l === '<!-- /APK -->') { f = false; continue; } if (f) out.push(l); }
  const block = out.join('\n');
  r.bloque = block.length > 0;
  const langs = { 'es-419': 'es', 'it-IT': 'it', 'en-US': 'en', 'pt-BR': 'pt', 'fr-FR': 'fr' }; // 3123: + portugués y francés
  r.idiomas = {};
  for (const tag of Object.keys(langs)) {
    const m = block.match(new RegExp('<' + tag + '>\\n([\\s\\S]*?)\\n</' + tag + '>'));
    r.idiomas[tag] = m ? m[1].length : null;
  }
  // dueño 17-11: mientras sigamos en desarrollo, las novedades van SOLO en español (los 5 idiomas, al acercarse la publicación). El
  // español es obligatorio; los demás, si están, con lo suyo; la app muestra el español a quien no tenga el suyo.
  const presentes = Object.keys(r.idiomas).filter((tag) => r.idiomas[tag] !== null);
  r.tres_idiomas = typeof r.idiomas['es-419'] === 'number' && presentes.every((tag) => r.idiomas[tag] > 20);
  r.tope_500 = presentes.every((tag) => r.idiomas[tag] <= 500);
  r.workflow_usa_bloque = /body_path: release_notes\.txt/.test(fs.readFileSync(path.join(__dirname, '..', '..', '.github', 'workflows', 'build-apk.yml'), 'utf8'));
  const { updaterNotesText } = await importSrc('ui/updater.js');
  r.app_lee = Object.keys(langs).every((tag) => { const t = updaterNotesText(block, langs[tag]); return t.length > 20 && block.indexOf(t) >= 0 && t.indexOf('<') < 0; }) &&
    presentes.every((tag) => updaterNotesText(block, langs[tag]) !== updaterNotesText(block, 'es') || tag === 'es-419');
  const ok = r.bloque && r.tres_idiomas && r.tope_500 && r.workflow_usa_bloque && r.app_lee;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('NOVEDADES ' + JSON.stringify(r));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('NOVEDADES ' + JSON.stringify({ prueba: 'novedades', resultado: 'FALLO', error: String(e && e.message) })); process.exit(1); });
