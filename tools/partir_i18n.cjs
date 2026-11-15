#!/usr/bin/env node
// Reestructuración 15-11 (dueño: «primero reestructura, luego la implementación»; antes de portugués y francés): la tabla de textos de
// src/ui/i18n.js (CLAVE-primero: { clave: { es, it, en } }, 832 claves) pasa a UN ARCHIVO POR IDIOMA (src/ui/i18n/es.js, it.js, en.js:
// { clave: 'texto' }), mismo orden y mismos comentarios de sección. Así cada idioma nuevo es un archivo aparte y la tabla no crece a lo
// ancho. i18n.js se queda con la lógica (idioma activo, t(), HTML estático) y busca en la tabla del idioma y, si falta, en la de español:
// exactamente lo que hacía con la fila (row[l] ?? row.es).
// Uso: node tools/partir_i18n.cjs           (escribe los archivos y comprueba que cada texto de cada idioma es idéntico)
'use strict';
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const P = path.join(root, 'src/ui/i18n.js');
const src = fs.readFileSync(P, 'utf8');
const A = src.indexOf('var STRINGS = {'), B = src.indexOf('\n};', A);
if (A < 0 || B < 0) throw new Error('no encuentro la tabla STRINGS');
const OLD = new Function('return ' + src.slice(A + 'var STRINGS = '.length, B + 2))();
const body = src.slice(src.indexOf('\n', A) + 1, B + 1).split('\n');
const LANGS = ['es', 'it', 'en'];
const NAMES = { es: 'español (base: es el texto original y el respaldo de todos los idiomas)', it: 'italiano', en: 'inglés' };
const out = { es: [], it: [], en: [] };
for (const l of body) {
  if (!l.trim()) { LANGS.forEach((g) => out[g].push('')); continue; }
  if (/^\s*\/\//.test(l)) { LANGS.forEach((g) => out[g].push(l)); continue; }
  const o = new Function('return {' + l + '}')();
  const k = Object.keys(o)[0], v = o[k];
  LANGS.forEach((g) => { if (v && typeof v[g] === 'string') out[g].push('  ' + k + ': ' + JSON.stringify(v[g]) + ','); });
}
while (out.es.length && !out.es[out.es.length - 1].trim()) LANGS.forEach((g) => out[g].pop());
fs.mkdirSync(path.join(root, 'src/ui/i18n'), { recursive: true });
LANGS.forEach((g) => {
  const head = '/**\n * NEXO — Textos de la app en ' + NAMES[g] + ' (reestructuración 15-11: un archivo por idioma; antes, una tabla de tres columnas\n' +
    ' * en src/ui/i18n.js). Mismas claves y mismo orden en todos los idiomas; lo comprueba tests/sim/i18n_audit.js.\n */\n';
  fs.writeFileSync(path.join(root, 'src/ui/i18n', g + '.js'), head + 'export default {\n' + out[g].join('\n') + '\n};\n');
});
// i18n.js: la tabla se cambia por las importaciones; t() busca en la tabla del idioma y cae a la de español
let s = src.slice(0, A) + "var TABLES = { es: ES, it: IT, en: EN };" + src.slice(B + 3);
const imp = "import ES from './i18n/es.js';\nimport IT from './i18n/it.js';\nimport EN from './i18n/en.js';\n";
s = s.replace("'use strict';\n", "'use strict';\n" + imp);
s = s.replace("// Tabla de textos CLAVE-primero. El `es` debe ser IDÉNTICO al texto original (el simulador se fija a español, así que\n// las pruebas que comprueban textos en español siguen pasando). Se va ampliando por zonas (Fase 2).\n",
  "// Textos: un archivo por idioma en src/ui/i18n/ (reestructuración 15-11, tools/partir_i18n.cjs). El español es el texto original\n// (el simulador se fija a español, así que las pruebas que comprueban textos en español siguen pasando) y el respaldo de todos.\n");
const oldT = "  var row = STRINGS[key];\n  if (row) {\n    var l = getLang();\n    if (row[l] != null) return row[l];\n    if (row.es != null) return row.es;\n  }\n";
if (s.indexOf(oldT) < 0) throw new Error('no encuentro el cuerpo de t()');
s = s.replace(oldT, "  var tl = TABLES[getLang()];\n  if (tl && Object.prototype.hasOwnProperty.call(tl, key) && tl[key] != null) return tl[key];\n  if (Object.prototype.hasOwnProperty.call(ES, key) && ES[key] != null) return ES[key];\n");
s = s.replace(" * La tabla es CLAVE-primero ({ clave: { es, it, en } }) para tener las tres traducciones juntas y ver de un vistazo si\n * falta alguna. Sin dependencias: se prueba en Node (tests/sim/i18n.js) sin construir.\n",
  " * Los textos van en un archivo por idioma (src/ui/i18n/es.js, it.js, en.js; reestructuración 15-11): t() busca en el del idioma\n * activo y, si falta, en el español. Sin dependencias: se prueba en Node (tests/sim/i18n.js) sin construir.\n");
fs.writeFileSync(P, s);
// Comprobación: cada clave y cada idioma, el mismo texto; mismas claves y mismo orden
(async () => {
  const url = (f) => require('url').pathToFileURL(path.join(root, f)).href + '?v=' + Date.now();
  const T = {}; for (const g of LANGS) T[g] = (await import(url('src/ui/i18n/' + g + '.js'))).default;
  let iguales = 0, distintos = [];
  for (const k of Object.keys(OLD)) for (const g of LANGS) {
    const a = OLD[k] ? OLD[k][g] : undefined, b = T[g][k];
    if (a === b) iguales++; else distintos.push(k + ':' + g);
  }
  const orden = LANGS.every((g) => JSON.stringify(Object.keys(T[g])) === JSON.stringify(Object.keys(OLD).filter((k) => OLD[k] && typeof OLD[k][g] === 'string')));
  console.log('PARTIR_I18N ' + JSON.stringify({ claves: Object.keys(OLD).length, iguales, distintos: distintos.length, orden, ejemplos: distintos.slice(0, 5), resultado: (!distintos.length && orden) ? 'OK' : 'FALLO' }));
  process.exit(!distintos.length && orden ? 0 : 1);
})();
