// Reestructuración semanal (dueño 15-11): EXTRAE de un archivo con instrucciones de arranque (como main.js) un tramo de
// sentencias que solo DECLARAN (funciones, constantes) a un archivo nuevo, tal cual. Lo que se ejecuta al cargar se queda donde
// está y en su orden. El original importa del nuevo lo que usa; el nuevo importa lo que necesita (también del original).
// Uso: node tools/partir_extraer.cjs <plan.json>   plan: { "file": "src/main.js", "out": "src/x.js", "lines": [[529,965]], "what": "…", "fecha": "15-11" }
'use strict';
const fs = require('fs');
const path = require('path');
const acorn = require(path.join(__dirname, '..', 'node_modules', 'acorn'));
const root = path.join(__dirname, '..');
const plan = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const SRC = fs.readFileSync(path.join(root, plan.file), 'utf8');
const ast = acorn.parse(SRC, { ecmaVersion: 'latest', sourceType: 'module' });
const lineOf = (p) => SRC.slice(0, p).split('\n').length;
const imports = ast.body.filter((n) => n.type === 'ImportDeclaration');
const importOf = new Map();
imports.forEach((d) => d.specifiers.forEach((s) => importOf.set(s.local.name, { src: d.source.value, imported: s.imported ? s.imported.name : 'default' })));
const stmts = ast.body.filter((n) => n.type !== 'ImportDeclaration');
const inRange = (n) => plan.lines.some((r) => lineOf(n.start) >= r[0] && lineOf(n.start) <= r[1]);
const declNames = (n) => { const d = n.type === 'ExportNamedDeclaration' ? n.declaration : n; const o = []; if (!d) return o; if (d.id && d.id.name) o.push(d.id.name); if (d.declarations) d.declarations.forEach((x) => o.push(x.id.name)); return o; };
const moved = stmts.filter(inRange);
moved.forEach((n) => { const d = n.type === 'ExportNamedDeclaration' ? n.declaration : n; if (!d || (d.type !== 'FunctionDeclaration' && d.type !== 'VariableDeclaration')) throw new Error('línea ' + lineOf(n.start) + ': solo se extraen declaraciones'); if (d.type === 'VariableDeclaration' && d.declarations.some((x) => x.init && !/^(Literal|ObjectExpression|ArrayExpression|ArrowFunctionExpression|FunctionExpression)$/.test(x.init.type))) throw new Error('línea ' + lineOf(n.start) + ': una constante que ejecuta algo al cargar se queda'); });
const movedNames = new Set(); moved.forEach((n) => declNames(n).forEach((x) => movedNames.add(x)));
const keptNames = new Set(); stmts.filter((n) => !inRange(n)).forEach((n) => declNames(n).forEach((x) => keptNames.add(x)));
// texto: cada sentencia movida con su comentario de antes
const pieces = [], cut = [];
stmts.forEach((n, i) => { if (!inRange(n)) return; const start = i === 0 ? n.start : stmts[i - 1].end; pieces.push(SRC.slice(start, n.end).replace(/^[^\S\n]*\n/, '')); cut.push([start, n.end]); });
function usedNames(src) {
  const toks = [...acorn.tokenizer(src, { ecmaVersion: 'latest', sourceType: 'module' })], used = new Set();
  for (let i = 0; i < toks.length; i++) { const t = toks[i]; if (t.type.label !== 'name') continue; const p = toks[i - 1], nx = toks[i + 1];
    if (p && (p.type.label === '.' || p.type.label === '?.')) continue; if (nx && nx.type.label === ':' && p && (p.type.label === '{' || p.type.label === ',')) continue; used.add(t.value); }
  return used;
}
const body = pieces.join('\n').replace(/\s+$/, '') + '\n';
const used = usedNames(body), bySrc = new Map(), fromOrig = [];
const want = (src, spec) => { if (!bySrc.has(src)) bySrc.set(src, []); if (bySrc.get(src).indexOf(spec) < 0) bySrc.get(src).push(spec); };
const relOut = path.relative(path.dirname(plan.out), path.dirname(plan.file));
const origSpec = './' + (relOut ? relOut + '/' : '') + path.basename(plan.file);
for (const n of used) {
  if (movedNames.has(n)) continue;
  if (importOf.has(n)) { const im = importOf.get(n); let s = im.src; if (s.startsWith('.')) s = './' + path.relative(path.dirname(plan.out), path.join(path.dirname(plan.file), s)).replace(/^(?!\.)/, ''); want(s.startsWith('.') ? s : './' + s, im.imported === n ? n : im.imported + ' as ' + n); }
  else if (keptNames.has(n)) { want(origSpec, n); fromOrig.push(n); }
}
const outText = [...bySrc].map(([s, specs]) => 'import { ' + specs.join(', ') + ' } from \'' + s + '\';').join('\n') +
  '\n// ' + path.basename(plan.file) + ' — ' + plan.what + '.\n// Reestructuración ' + plan.fecha + ': movido TAL CUAL desde ' + path.basename(plan.file) + ' (solo declaraciones; lo que se ejecuta al arrancar sigue allí, en su orden).\n' +
  body + '\nexport { ' + [...movedNames].join(', ') + ' };\n';
// original: quitar lo movido, importar lo que usa, exportar lo que el nuevo le pide
let orig = SRC;
cut.slice().reverse().forEach(([a, b]) => { orig = orig.slice(0, a) + orig.slice(b); });
const usedOrig = usedNames(orig);
const need = [...movedNames].filter((n) => usedOrig.has(n));
const lastImp = imports[imports.length - 1];
const impLine = '\nimport { ' + need.join(', ') + ' } from \'./' + path.relative(path.dirname(plan.file), plan.out).replace(/^(?!\.)/, '') + '\'; // reestructuración ' + plan.fecha;
orig = orig.slice(0, lastImp.end) + (need.length ? impLine : '') + orig.slice(lastImp.end);
if (fromOrig.length) orig = orig.replace(/\s*$/, '\n') + '// Para ' + path.basename(plan.out) + ' (reestructuración ' + plan.fecha + ')\nexport { ' + [...new Set(fromOrig)].join(', ') + ' };\n';
fs.writeFileSync(path.join(root, plan.out), outText); fs.writeFileSync(path.join(root, plan.file), orig);
console.log(plan.out + ': ' + outText.split('\n').length + ' líneas; ' + plan.file + ': ' + orig.split('\n').length + ' líneas');
