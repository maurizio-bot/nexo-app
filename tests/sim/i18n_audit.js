// Cola de pulido A1 (modo adelanto, 10-11): auditoría de textos y traducciones. Prueba de UNIDAD, no necesita build.
// Revisa: (1) claves de la tabla sin es/it/en o con alguna vacía; (2) claves cuyo it o en es IGUAL al es (posible texto sin
// traducir; se ignoran las palabras iguales en los tres idiomas como «Internet»); (3) claves USADAS con t('clave', '…') que no
// existen en la tabla (en italiano e inglés se verá el texto de respaldo en español); (4) claves de la tabla que nadie usa.
// Uso: node i18n_audit.js [--strict]   (con --strict sale con error si hay (1) o (3))
'use strict';
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '../..');
const src = fs.readFileSync(path.join(root, 'src/ui/i18n.js'), 'utf8');
const a = src.indexOf('var STRINGS = {'), b = src.indexOf('\n};', a);
if (a < 0 || b < 0) { console.log('I18N_AUDIT {"resultado":"FALLO","error":"no encuentro la tabla STRINGS"}'); process.exit(1); }
const STR = new Function('return ' + src.slice(a + 'var STRINGS = '.length, b + 2))();
const keys = Object.keys(STR);

function walk(d, out) { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); const s = fs.statSync(p); if (s.isDirectory()) walk(p, out); else if (/\.js$/.test(f)) out.push(p); } return out; }
const files = walk(path.join(root, 'src'), []).filter((f) => !/[\\/]ui[\\/]i18n\.js$/.test(f));
const used = new Map(); // clave -> [archivo...]
const re = /\bt\(\s*(['"])([a-zA-Z0-9_.]+)\1\s*(?:,|\))/g;
for (const f of files) {
  const txt = fs.readFileSync(f, 'utf8'); let m;
  while ((m = re.exec(txt))) { const k = m[2]; if (!used.has(k)) used.set(k, new Set()); used.get(k).add(path.relative(root, f)); }
}
// data-i18n="clave" en HTML estático
for (const f of ['index.html']) {
  const p = path.join(root, f); if (!fs.existsSync(p)) continue;
  const txt = fs.readFileSync(p, 'utf8'); const r2 = /data-i18n(?:-ph|-title)?="([a-zA-Z0-9_.]+)"/g; let m;
  while ((m = r2.exec(txt))) { if (!used.has(m[1])) used.set(m[1], new Set()); used.get(m[1]).add(f); }
}

const VACIAS_OK = new Set(['grp_ago_prefix:it', 'grp_ago_prefix:en']); // vacías a propósito: en it/en la unidad va sin prefijo
const faltan = [], vacias = [], iguales = [], sinTabla = [], sinUso = [];
for (const k of keys) {
  const v = STR[k];
  for (const l of ['es', 'it', 'en']) if (!v || typeof v[l] !== 'string' || !v[l].trim()) { (v && l in v ? (VACIAS_OK.has(k + ':' + l) ? null : vacias) : faltan)?.push(k + ':' + l); }
  if (v && v.es && v.it && v.en) {
    const same = (x) => x === v.es && v.es.length > 3 && /[a-záéíóúñ]{4,}/i.test(v.es) && !(v.es === v.it && v.es === v.en);
    if (same(v.it)) iguales.push(k + ':it');
    if (same(v.en)) iguales.push(k + ':en');
  }
  if (!used.has(k)) sinUso.push(k);
}
for (const [k, fs_] of used) if (!(k in STR)) sinTabla.push(k + '  (' + Array.from(fs_).slice(0, 2).join(', ') + ')');

const ok = !faltan.length && !vacias.length && !sinTabla.length;
const r = { prueba: 'i18n_audit', resultado: ok ? 'OK' : 'FALLO', claves: keys.length, usadas: used.size, faltan_idioma: faltan.length, vacias: vacias.length, usadas_sin_tabla: sinTabla.length, iguales_al_es: iguales.length, sin_uso: sinUso.length };
console.log('I18NAUDIT ' + JSON.stringify(r));
const show = (t, a_) => { if (a_.length) console.log('\n' + t + ' (' + a_.length + '):\n  ' + a_.slice(0, 60).join('\n  ') + (a_.length > 60 ? '\n  …' : '')); };
show('Claves con idioma que falta o vacío', faltan.concat(vacias));
show('Claves USADAS que no están en la tabla (en it/en se verá el respaldo en español)', sinTabla);
show('Traducción igual al español (posible sin traducir)', iguales);
if (process.argv.includes('--strict') && !ok) process.exit(1);
