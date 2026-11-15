// Revisión de una REESTRUCTURACIÓN (dueño 15-11: «una vez a la semana… identificar los archivos que ya se hicieron demasiado grandes y
// hacer reestructuración»). Comprueba que partir un archivo no cambió nada de lo que hace:
//  1) cada pieza del archivo viejo (función, constante, método de clase u objeto, `X.prototype.y = …`) está, con el MISMO texto, en
//     alguno de los archivos nuevos;
//  2) en cada archivo nuevo, todo nombre de nivel de módulo del archivo viejo que se usa está declarado o importado ahí (nada suelto
//     que fallaría solo al ejecutarse ese camino).
// Uso: node tools/partir_check.cjs <ref git> <archivo viejo> <archivo nuevo>...   (sale con 1 si algo no cuadra)
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const acorn = require(path.join(__dirname, '..', 'node_modules', 'acorn'));

const parse = (src) => acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'module', allowHashBang: true });
const norm = (s) => s.replace(/\s+/g, ' ').trim();

// Piezas: kind:name → texto
function pieces(src) {
  const ast = parse(src), out = new Map(), txt = (n) => norm(src.slice(n.start, n.end));
  const add = (k, n) => { if (out.has(k)) k = k + '#' + n.start; out.set(k, txt(n)); };
  const members = (body, owner) => body.forEach((m) => {
    if (m.type === 'MethodDefinition' || (m.type === 'Property' && (m.method || m.value && /Function/.test(m.value.type)))) {
      const name = m.key && (m.key.name || m.key.value);
      add('m:' + name, m.type === 'Property' && !m.method ? m.value : m);
    }
  });
  const visitTop = (n) => {
    if (n.type === 'ExportNamedDeclaration' && n.declaration) return visitTop(n.declaration);
    if (n.type === 'ExportDefaultDeclaration' && n.declaration) return visitTop(n.declaration);
    if (n.type === 'FunctionDeclaration') return add('f:' + n.id.name, n);
    if (n.type === 'ClassDeclaration') return members(n.body.body, n.id.name);
    if (n.type === 'VariableDeclaration') return n.declarations.forEach((d) => {
      if (d.init && d.init.type === 'ObjectExpression' && d.init.properties.some((p) => p.method)) return members(d.init.properties, d.id.name);
      add('v:' + (d.id.name || src.slice(d.id.start, d.id.end)), d);
    });
    if (n.type === 'ExpressionStatement' && n.expression.type === 'AssignmentExpression') {
      const l = src.slice(n.expression.left.start, n.expression.left.end);
      const r = n.expression.right;
      if (r.type === 'ObjectExpression' && /\.prototype$/.test(l)) return members(r.properties, l);
      return add('a:' + l, n.expression.right);
    }
  };
  ast.body.forEach(visitTop);
  return out;
}

// Nombres de nivel de módulo (importados o declarados arriba)
function topNames(src) {
  const ast = parse(src), names = new Set();
  ast.body.forEach((n) => {
    if (n.type === 'ImportDeclaration') n.specifiers.forEach((s) => names.add(s.local.name));
    const d = n.type === 'ExportNamedDeclaration' || n.type === 'ExportDefaultDeclaration' ? n.declaration : n;
    if (!d) return;
    if ((d.type === 'FunctionDeclaration' || d.type === 'ClassDeclaration') && d.id) names.add(d.id.name);
    if (d.type === 'VariableDeclaration') d.declarations.forEach((x) => { if (x.id.type === 'Identifier') names.add(x.id.name); });
  });
  return names;
}

// Nombres usados (fichas de identificador que no van detrás de «.» ni son la clave de «clave:»)
function usedNames(src) {
  const toks = [...acorn.tokenizer(src, { ecmaVersion: 'latest', sourceType: 'module', allowHashBang: true })];
  // `export { a } from './x.js'` reexporta sin crear el nombre aquí: esas fichas no son usos
  const skip = parse(src).body.filter((n) => (n.type === 'ExportNamedDeclaration' || n.type === 'ExportAllDeclaration') && n.source).map((n) => [n.start, n.end]);
  const used = new Set();
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i]; if (t.type.label !== 'name') continue;
    if (skip.some((r) => t.start >= r[0] && t.end <= r[1])) continue;
    const prev = toks[i - 1], next = toks[i + 1];
    if (prev && (prev.type.label === '.' || prev.type.label === '?.')) continue;
    if (next && next.type.label === ':' && prev && (prev.type.label === '{' || prev.type.label === ',')) continue; // clave de objeto
    used.add(t.value);
  }
  return used;
}

const [ref, oldPath, ...newPaths] = process.argv.slice(2);
if (!ref || !oldPath || !newPaths.length) { console.error('Uso: node tools/partir_check.cjs <ref> <viejo> <nuevo>...'); process.exit(2); }
const root = path.join(__dirname, '..');
const oldSrc = execFileSync('git', ['show', ref + ':' + oldPath], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const oldP = pieces(oldSrc), oldTop = topNames(oldSrc);
const newP = new Map(); const problems = [];
for (const f of newPaths) {
  const src = fs.readFileSync(path.join(root, f), 'utf8');
  for (const [k, v] of pieces(src)) { const kk = newP.has(k) ? k + '@' + f : k; newP.set(kk, v); }
  const declared = topNames(src), used = usedNames(src);
  for (const n of used) if (oldTop.has(n) && !declared.has(n)) problems.push(f + ': usa «' + n + '» sin declararlo ni importarlo');
  // un nombre IMPORTADO no se puede cambiar (fallaría al ejecutarse): ningún archivo puede asignar a lo que importa
  const importedHere = new Set(); parse(src).body.forEach((n) => { if (n.type === 'ImportDeclaration') n.specifiers.forEach((s) => importedHere.add(s.local.name)); });
  (function walk(n) {
    if (!n || typeof n.type !== 'string') return;
    const id = n.type === 'AssignmentExpression' ? n.left : n.type === 'UpdateExpression' ? n.argument : null;
    if (id && id.type === 'Identifier' && importedHere.has(id.name)) problems.push(f + ': cambia «' + id.name + '», que importa de otro archivo');
    for (const k in n) { const v = n[k]; if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === 'object' && v.type) walk(v); }
  })(parse(src));
  const lines = src.split('\n').length;
  if (lines > 1000) problems.push(f + ': ' + lines + ' líneas (> 1000)');
}
const newVals = new Set(newP.values());
let same = 0;
for (const [k, v] of oldP) {
  if (newVals.has(v)) { same++; continue; }
  problems.push('pieza cambiada o perdida: ' + k);
}
console.log('PARTIR ' + JSON.stringify({ viejo: oldPath, piezas: oldP.size, iguales: same, archivos: newPaths.length, problemas: problems.length }));
problems.slice(0, 40).forEach((p) => console.log('  - ' + p));
process.exit(problems.length ? 1 : 0);
