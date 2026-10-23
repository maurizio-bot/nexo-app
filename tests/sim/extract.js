// Herramienta de reestructuración: mueve declaraciones de primer nivel (function / var / const) de un archivo a un
// módulo nuevo SIN tocar su texto: corta cada una exactamente (con los comentarios de encima), la pega en el módulo
// con "export" y añade el import en el archivo de origen. Después: node undef.js (nada sin definir) y las pruebas.
// Uso: node extract.js <origen.js> <destino.js> "<cabecera del módulo>" nombre1 nombre2 ...
//      (el destino puede existir: se añade al final; los imports que necesite el módulo se añaden a mano)
'use strict';
const fs = require('fs');
const path = require('path');
const acorn = require(path.join(__dirname, '.deps/node_modules/acorn'));

const [src, dst, header, ...names] = process.argv.slice(2);
if (!src || !dst || !names.length) { console.error('Uso: node extract.js origen destino "cabecera" nombres...'); process.exit(2); }
let code = fs.readFileSync(src, 'utf8');
const ast = acorn.parse(code, { ecmaVersion: 'latest', sourceType: 'module', ranges: true });
const want = new Set(names), found = [];
for (const node of ast.body) {
  let n = null;
  if (node.type === 'FunctionDeclaration') n = node.id.name;
  else if (node.type === 'VariableDeclaration' && node.declarations.every((d) => d.id.type === 'Identifier')) {
    const all = node.declarations.map((d) => d.id.name), some = all.filter((x) => want.has(x));
    if (!some.length) continue;
    // var a = 1, b = 2: la sentencia entera o nada
    if (some.length < all.length) { console.error('La sentencia declara también ' + all.filter((x) => !want.has(x)).join(', ') + ': pídelos todos'); process.exit(1); }
    n = all.join(',');
    all.slice(1).forEach((x) => found.push({ n: x, alias: true }));
  }
  if (!n || (!want.has(n) && !n.includes(','))) continue;
  // Incluir los comentarios de línea inmediatamente encima (sin línea en blanco de por medio)
  let start = node.range[0];
  while (true) {
    const prevNl = code.lastIndexOf('\n', start - 2);
    const line = code.substring(prevNl + 1, start - 1);
    if (/^\s*(\/\/|\/\*|\*)/.test(line) && start > 0) start = prevNl + 1; else break;
  }
  let end = node.range[1];
  // Hasta el final de la línea si lo que queda es un comentario (var X = 1;   // explicación)
  const eol = code.indexOf('\n', end);
  if (eol >= 0 && /^\s*(\/\/.*)?$/.test(code.substring(end, eol))) end = eol;
  if (code[end] === '\n') end++;
  found.push({ n, start, end, kind: node.type });
}
const missing = names.filter((n) => !found.some((f) => f.n === n || (f.n.includes(',') && f.n.split(',').includes(n))));
for (let k = found.length - 1; k >= 0; k--) if (found[k].alias) found.splice(k, 1);
if (missing.length) { console.error('No encontrados en el primer nivel: ' + missing.join(', ')); process.exit(1); }
found.sort((a, b) => a.start - b.start);
// Una variable importada no se puede reasignar: si el resto del origen la modifica, no se mueve
{
  let rest = code;
  for (const f of found.slice().sort((a, b) => b.start - a.start)) rest = rest.substring(0, f.start) + rest.substring(f.end);
  const bad = found.filter((f) => f.kind === 'VariableDeclaration').flatMap((f) => f.n.split(',')).filter((nm) => new RegExp('(^|[^\\w$.])' + nm.replace(/\$/g, '\\$') + '\\s*(=(?!=)|\\+\\+|--|[-+*/%|&^]=)').test(rest) || new RegExp('(\\+\\+|--)' + nm + '\\b').test(rest));
  if (bad.length) { console.error('Se modifican en el origen (no se pueden mover solas): ' + bad.join(', ')); process.exit(1); }
}
const pieces = found.map((f) => code.substring(f.start, f.end).replace(/^((?:\s*(?:\/\/|\/\*|\*).*\n)*)(async function |function |var |const |let )/, '$1export $2'));
for (const f of found.slice().reverse()) code = code.substring(0, f.start) + code.substring(f.end);
// import en el origen, detrás del último import
const rel = './' + path.relative(path.dirname(src), dst).replace(/\\/g, '/');
const imp = `import { ${found.map((f) => f.n.split(',').join(', ')).join(', ')} } from '${rel.startsWith('./..') ? rel.substring(2) : rel}';\n`;
const lastImp = [...code.matchAll(/^import .*;\n/gm)].pop();
const at = lastImp ? lastImp.index + lastImp[0].length : 0;
code = code.substring(0, at) + imp + code.substring(at);
fs.writeFileSync(src, code);
let out = fs.existsSync(dst) ? fs.readFileSync(dst, 'utf8').replace(/\n*$/, '\n\n') : (header ? header.replace(/\n*$/, '\n\n') : '');
fs.writeFileSync(dst, out + pieces.join('\n'));
console.log(`Movidos a ${dst}: ${found.map((f) => f.n.split(',').join(', ')).join(', ')}`);
