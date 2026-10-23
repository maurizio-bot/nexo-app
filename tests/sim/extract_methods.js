// Herramienta de reestructuración: mueve métodos de una clase a un módulo SIN tocar su texto. En el módulo quedan como
// métodos de un objeto (la sintaxis es la misma; solo se añade una coma entre ellos) y en el origen, tras la clase,
// Object.assign(Clase.prototype, objeto). Después: node undef.js y las pruebas.
// Uso: node extract_methods.js <origen.js> <Clase> <destino.js> <nombreObjeto> "<cabecera>" metodo1 metodo2 ...
'use strict';
const fs = require('fs');
const path = require('path');
const acorn = require(path.join(__dirname, '.deps/node_modules/acorn'));

const [src, cls, dst, objName, header, ...names] = process.argv.slice(2);
let code = fs.readFileSync(src, 'utf8');
const ast = acorn.parse(code, { ecmaVersion: 'latest', sourceType: 'module', ranges: true });
let klass = null;
for (const n of ast.body) { const d = n.type === 'ExportNamedDeclaration' && n.declaration ? n.declaration : n; if (d.type === 'ClassDeclaration' && d.id.name === cls) klass = d; }
if (!klass) { console.error('No encuentro la clase ' + cls); process.exit(1); }
const want = new Set(names), found = [];
for (const m of klass.body.body) {
  const n = m.key && (m.key.name || m.key.value);
  if (!want.has(n)) continue;
  if (m.type !== 'MethodDefinition' || m.kind !== 'method' || m.static) { console.error(n + ': solo métodos normales'); process.exit(1); }
  if (/\bsuper\b/.test(code.substring(m.range[0], m.range[1]))) { console.error(n + ': usa super'); process.exit(1); }
  let start = m.range[0];
  // comentarios de línea inmediatamente encima
  while (true) {
    const prevNl = code.lastIndexOf('\n', start - 2);
    const line = code.substring(prevNl + 1, start - 1);
    if (/^\s*(\/\/|\/\*|\*)/.test(line) && start > 0) start = prevNl + 1; else break;
  }
  // desde el principio de la línea (con la sangría)
  start = code.lastIndexOf('\n', start - 1) + 1;
  let end = m.range[1];
  const eol = code.indexOf('\n', end);
  if (eol >= 0 && /^\s*(\/\/.*)?$/.test(code.substring(end, eol))) end = eol;
  if (code[end] === '\n') end++;
  found.push({ n, start, end, rEnd: m.range[1] });
}
const missing = names.filter((n) => !found.some((f) => f.n === n));
if (missing.length) { console.error('No encontrados: ' + missing.join(', ')); process.exit(1); }
found.sort((a, b) => a.start - b.start);
// La coma justo detrás de la llave del método (no dentro de un comentario al final de la línea)
const pieces = found.map((f, k) => (code.substring(f.start, f.rEnd) + (k < found.length - 1 ? ',' : '') + code.substring(f.rEnd, f.end)).replace(/\n+$/, ''));
for (const f of found.slice().reverse()) code = code.substring(0, f.start) + code.substring(f.end);
// Tras la clase: añadir los métodos al prototipo
const ast2 = acorn.parse(code, { ecmaVersion: 'latest', sourceType: 'module', ranges: true });
let k2 = null;
for (const n of ast2.body) { const d = n.type === 'ExportNamedDeclaration' && n.declaration ? n.declaration : n; if (d.type === 'ClassDeclaration' && d.id.name === cls) k2 = n; }
const afterClass = k2.range[1];
code = code.substring(0, afterClass) + `\nObject.assign(${cls}.prototype, ${objName});` + code.substring(afterClass);
const rel = './' + path.relative(path.dirname(src), dst).replace(/\\/g, '/');
const imp = `import { ${objName} } from '${rel}';\n`;
const lastImp = [...code.matchAll(/^import .*;\n/gm)].pop();
const at = lastImp ? lastImp.index + lastImp[0].length : 0;
code = code.substring(0, at) + imp + code.substring(at);
fs.writeFileSync(src, code);
const body = `export const ${objName} = {\n` + pieces.join('\n\n') + '\n};\n';
fs.writeFileSync(dst, (header ? header.replace(/\n*$/, '\n\n') : '') + body);
console.log(`Movidos ${found.length} métodos a ${dst}: ${found.map((f) => f.n).join(', ')}`);
