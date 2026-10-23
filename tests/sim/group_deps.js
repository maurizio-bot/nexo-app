// Para un grupo de declaraciones de primer nivel: qué otras declaraciones del mismo archivo usan (fuera del grupo)
// y quién de fuera del grupo las usa. Un grupo se puede mover tal cual si "usa de fuera" está vacío.
// Uso: node group_deps.js <archivo.js> nombre1 nombre2 ...
'use strict';
const fs = require('fs'), path = require('path');
const acorn = require(path.join(__dirname, '.deps/node_modules/acorn'));
const escope = require(path.join(__dirname, '.deps/node_modules/eslint-scope'));
const [file, ...names] = process.argv.slice(2);
const code = fs.readFileSync(file, 'utf8');
const ast = acorn.parse(code, { ecmaVersion: 'latest', sourceType: 'module', ranges: true, locations: true });
const sm = escope.analyze(ast, { ecmaVersion: 2022, sourceType: 'module' });
const mod = sm.scopes.find((s) => s.type === 'module');
const top = new Map(); // nombre → nodo de primer nivel
for (const n of ast.body) {
  if (n.type === 'FunctionDeclaration') top.set(n.id.name, n);
  else if (n.type === 'VariableDeclaration') n.declarations.forEach((d) => d.id.type === 'Identifier' && top.set(d.id.name, n));
}
const group = new Set(names);
const owner = (pos) => { for (const [nm, n] of top) if (pos >= n.range[0] && pos < n.range[1]) return nm; return null; };
const uses = new Set(), usedBy = new Set();
for (const v of mod.variables) {
  if (!top.has(v.name)) continue;
  for (const r of v.references) {
    const who = owner(r.identifier.range[0]);
    if (group.has(who) && !group.has(v.name)) uses.add(v.name);
    if (group.has(v.name) && !group.has(who)) usedBy.add(who || '(código suelto)');
  }
}
const missing = names.filter((n) => !top.has(n));
if (missing.length) console.log('NO EXISTEN: ' + missing.join(', '));
console.log('usa de fuera: ' + ([...uses].join(', ') || '—'));
console.log('lo usan fuera: ' + ([...usedBy].join(', ') || '—'));
