// Reestructuración semanal (dueño 15-11): parte un archivo cuyo contenido es UN objeto de métodos (export const X = { … }) que se une
// a una clase con Object.assign. Mueve grupos CONTIGUOS de métodos, tal cual (con sus comentarios), a archivos nuevos; el archivo
// original queda con los demás y vuelve a exportar X como la unión de todas las piezas (mismo nombre y mismos métodos).
// Uso: node tools/partir_obj.cjs <plan.json>
//   plan: { "file": "src/ui/x.js", "obj": "X", "groups": [ { "file": "src/ui/x_a.js", "obj": "xA", "from": "m1", "through": "m5", "what": "…" } ] }
// Revisión: node tools/partir_check.cjs HEAD <viejo> <viejo> <nuevos…>
'use strict';
const fs = require('fs');
const path = require('path');
const acorn = require(path.join(__dirname, '..', 'node_modules', 'acorn'));
const root = path.join(__dirname, '..');
const plan = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const SRC = fs.readFileSync(path.join(root, plan.file), 'utf8');
const ast = acorn.parse(SRC, { ecmaVersion: 'latest', sourceType: 'module' });
const imports = ast.body.filter((n) => n.type === 'ImportDeclaration');
const importOf = new Map();
imports.forEach((d) => d.specifiers.forEach((s) => importOf.set(s.local.name, { src: d.source.value, imported: s.imported ? s.imported.name : 'default' })));
const objStmt = ast.body.find((n) => n.type === 'ExportNamedDeclaration' && n.declaration && n.declaration.type === 'VariableDeclaration' && n.declaration.declarations[0].id.name === plan.obj);
if (!objStmt) throw new Error('no está el objeto ' + plan.obj);
const objExpr = objStmt.declaration.declarations[0].init;
const props = objExpr.properties;
const seg = props.map((m, i) => ({ name: m.key.name || m.key.value, start: i === 0 ? objExpr.start + 1 : props[i - 1].end, end: m.end }));
const idx = (n) => { const i = seg.findIndex((s) => s.name === n); if (i < 0) throw new Error('no está: ' + n); return i; };
const taken = new Set();
plan.groups.forEach((g) => { g.a = idx(g.from); g.b = idx(g.through); for (let i = g.a; i <= g.b; i++) { if (taken.has(i)) throw new Error('solapado'); taken.add(i); } });
// el texto entre propiedades incluye la coma de la anterior: se quita la coma inicial de cada tramo
const segText = (s) => SRC.slice(s.start, s.end).replace(/^\s*,/, '').replace(/^\n/, '');
// nombres de nivel de módulo (fuera del objeto) y dónde quedan
const topDecl = new Map();
ast.body.forEach((n) => {
  if (n.type === 'ImportDeclaration' || n === objStmt) return;
  const d = n.type === 'ExportNamedDeclaration' ? n.declaration : n; if (!d) return;
  if (d.id) topDecl.set(d.id.name, n);
  if (d.declarations) d.declarations.forEach((x) => topDecl.set(x.id.name, n));
});
function usedNames(src) {
  const toks = [...acorn.tokenizer(src, { ecmaVersion: 'latest', sourceType: 'module' })], used = new Set();
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i]; if (t.type.label !== 'name') continue;
    const p = toks[i - 1], nx = toks[i + 1];
    if (p && (p.type.label === '.' || p.type.label === '?.')) continue;
    if (nx && nx.type.label === ':' && p && (p.type.label === '{' || p.type.label === ',')) continue;
    used.add(t.value);
  }
  return used;
}
const baseName = './' + path.basename(plan.file);
const exportsNeeded = new Set(); // nombres de nivel de módulo del original que usan las piezas nuevas
function importsFor(body) {
  const used = usedNames(body), bySrc = new Map();
  const want = (src, spec) => { if (!bySrc.has(src)) bySrc.set(src, []); if (bySrc.get(src).indexOf(spec) < 0) bySrc.get(src).push(spec); };
  for (const n of used) {
    if (importOf.has(n)) { const im = importOf.get(n); want(im.src, im.imported === n ? n : im.imported + ' as ' + n); }
    else if (topDecl.has(n)) { exportsNeeded.add(n); want(baseName, n); }
  }
  return [...bySrc].map(([src, specs]) => 'import { ' + specs.join(', ') + ' } from \'' + src + '\';').join('\n');
}
const out = {};
plan.groups.forEach((g) => {
  const body = 'export const ' + g.obj + ' = {\n' + seg.slice(g.a, g.b + 1).map((s) => segText(s).replace(/\s+$/, '') + ',').join('\n') + '\n};\n';
  out[g.file] = importsFor(body) + '\n// Métodos de ' + plan.obj + ': ' + g.what + '.\n// Reestructuración ' + plan.fecha + ': movidos TAL CUAL desde ' + path.basename(plan.file) + ', que los une en ' + plan.obj + '.\n' + body;
});
// original: imports que siga usando + lo de fuera del objeto + el objeto con lo que queda + la unión
const keep = seg.filter((s, i) => !taken.has(i)).map((s) => segText(s).replace(/\s+$/, '') + ',').join('\n');
const before = SRC.slice(imports.length ? imports[imports.length - 1].end : 0, objStmt.start);
const after = SRC.slice(objStmt.end);
const coreObj = 'const _' + plan.obj + '_BASE = {\n' + keep.replace(/,$/, '') + '\n};\n' +
  '// Reestructuración ' + plan.fecha + ': ' + plan.obj + ' = estos métodos + los de ' + plan.groups.map((g) => path.basename(g.file)).join(', ') + ' (mismos nombres, mismo objeto).\n' +
  'export const ' + plan.obj + ' = Object.assign({}, _' + plan.obj + '_BASE, ' + plan.groups.map((g) => g.obj).join(', ') + ');\n';
let coreBody = before.replace(/^\n/, '') + coreObj + after;
// exportar lo que usan las piezas (si no estaba exportado)
let exp = [...exportsNeeded].filter((n) => topDecl.get(n).type !== 'ExportNamedDeclaration');
if (exp.length) coreBody += '\nexport { ' + exp.join(', ') + ' };\n';
const usedCore = usedNames(coreBody);
const coreImports = imports.map((d) => {
  const specs = d.specifiers.filter((s) => usedCore.has(s.local.name));
  if (!specs.length) return null;
  return 'import { ' + specs.map((s) => (s.imported && s.imported.name !== s.local.name ? s.imported.name + ' as ' + s.local.name : s.local.name)).join(', ') + ' } from \'' + d.source.value + '\';';
}).filter(Boolean).join('\n');
const groupImports = plan.groups.map((g) => 'import { ' + g.obj + ' } from \'./' + path.basename(g.file) + '\';').join('\n');
const head = SRC.slice(0, imports.length ? imports[0].start : 0);
out[plan.file] = head + coreImports + '\n' + groupImports + '\n' + coreBody;
for (const [f, t] of Object.entries(out)) { fs.writeFileSync(path.join(root, f), t); console.log(f + ': ' + t.split('\n').length + ' líneas'); }
