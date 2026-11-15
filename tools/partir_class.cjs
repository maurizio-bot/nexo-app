// Reestructuración semanal (dueño 15-11): parte un archivo con UNA clase grande. Lo de antes de la clase (constantes y ayudantes)
// pasa a <base>_shared.js; grupos CONTIGUOS de métodos pasan, TAL CUAL (con sus comentarios), a archivos propios; la clase queda
// en el archivo original con los demás métodos y se le unen los grupos como métodos normales (no enumerables, como los de clase).
// Uso: node tools/partir_class.cjs <plan.json>
//   plan: { "file": "src/net/x.js", "cls": "X", "fecha": "15-11", "groups": [ { "file": "src/net/x_a.js", "obj": "xA", "from": "m1", "through": "m9", "what": "…" } ] }
// Revisión: node tools/partir_check.cjs HEAD <viejo> <viejo> <shared> <grupos…>
'use strict';
const fs = require('fs');
const path = require('path');
const acorn = require(path.join(__dirname, '..', 'node_modules', 'acorn'));
const root = path.join(__dirname, '..');
const plan = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const BASE = path.basename(plan.file, '.js'), SHARED = path.join(path.dirname(plan.file), BASE + '_shared.js');
const SRC = fs.readFileSync(path.join(root, plan.file), 'utf8');
const ast = acorn.parse(SRC, { ecmaVersion: 'latest', sourceType: 'module' });
const imports = ast.body.filter((n) => n.type === 'ImportDeclaration');
const importOf = new Map();
imports.forEach((d) => d.specifiers.forEach((s) => importOf.set(s.local.name, { src: d.source.value, imported: s.imported ? s.imported.name : 'default' })));
const nonImp = ast.body.filter((n) => n.type !== 'ImportDeclaration');
const clsStmt = nonImp.find((n) => { const d = n.type === 'ExportNamedDeclaration' ? n.declaration : n; return d && d.type === 'ClassDeclaration' && d.id.name === plan.cls; });
const cls = clsStmt.type === 'ExportNamedDeclaration' ? clsStmt.declaration : clsStmt;
const before = nonImp.filter((n) => n.end <= clsStmt.start), after = nonImp.filter((n) => n.start >= clsStmt.end);
const lastImpEnd = imports.length ? imports[imports.length - 1].end : 0;
const prelude = SRC.slice(0, imports.length ? imports[0].start : 0);
const headerText = before.length ? SRC.slice(lastImpEnd, before[0].start).replace(/^[^\n]*\n/, '') : SRC.slice(lastImpEnd, clsStmt.start).replace(/^[^\n]*\n/, '');
const sharedText = before.length ? SRC.slice(before[0].start, clsStmt.start).replace(/\s+$/, '') + '\n' : '';
const afterText = SRC.slice(clsStmt.end).replace(/^\s*\n/, '').replace(/\s+$/, '');
const declNames = (n) => { const d = n.type === 'ExportNamedDeclaration' ? n.declaration : n; const o = []; if (!d) return o; if (d.id && d.id.name) o.push(d.id.name); if (d.declarations) d.declarations.forEach((x) => o.push(x.id.name)); return o; };
const where = new Map(); before.forEach((n) => declNames(n).forEach((x) => where.set(x, 'shared'))); after.forEach((n) => declNames(n).forEach((x) => where.set(x, 'core'))); where.set(plan.cls, 'core');
const exportedShared = []; before.forEach((n) => { if (n.type === 'ExportNamedDeclaration') declNames(n).forEach((x) => exportedShared.push(x)); });
const members = cls.body.body;
const seg = members.map((m, i) => ({ name: m.key.name || m.key.value, start: i === 0 ? cls.body.start + 1 : members[i - 1].end, end: m.end }));
const idx = (n) => { const i = seg.findIndex((s) => s.name === n); if (i < 0) throw new Error('no está: ' + n); return i; };
const taken = new Set();
plan.groups.forEach((g) => { g.a = idx(g.from); g.b = idx(g.through); for (let i = g.a; i <= g.b; i++) { if (taken.has(i)) throw new Error('solapado'); if (seg[i].name === 'constructor') throw new Error('el constructor se queda'); taken.add(i); } });
const segText = (s) => SRC.slice(s.start, s.end).replace(/^\n/, '');
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
function importsFor(body, own, self) {
  const used = usedNames(body), bySrc = new Map();
  const want = (src, spec) => { if (!bySrc.has(src)) bySrc.set(src, []); if (bySrc.get(src).indexOf(spec) < 0) bySrc.get(src).push(spec); };
  for (const n of used) {
    if (own.has(n)) continue;
    if (importOf.has(n)) { const im = importOf.get(n); want(im.src, im.imported === n ? n : im.imported + ' as ' + n); continue; }
    const w = where.get(n);
    if (w === 'shared' && self !== 'shared') want('./' + path.basename(SHARED), n);
    else if (w === 'core' && self !== 'core') want('./' + BASE + '.js', n);
  }
  return [...bySrc].map(([src, specs]) => 'import { ' + specs.join(', ') + ' } from \'' + src + '\';').join('\n');
}
const out = {};
if (sharedText) {
  const own = new Set(); before.forEach((n) => declNames(n).forEach((x) => own.add(x)));
  const exp = [...own].filter((x) => exportedShared.indexOf(x) < 0);
  out[SHARED] = importsFor(sharedText, own, 'shared') + '\n// Constantes y ayudantes de ' + plan.cls + ' (reestructuración ' + plan.fecha + ': antes, la cabecera de ' + BASE + '.js).\n' + sharedText + (exp.length ? '\nexport { ' + exp.join(', ') + ' };\n' : '');
}
plan.groups.forEach((g) => {
  const body = 'export const ' + g.obj + ' = {\n' + seg.slice(g.a, g.b + 1).map((s) => segText(s) + ',').join('\n') + '\n};\n';
  out[g.file] = importsFor(body, new Set([g.obj]), 'piece') + '\n// Métodos de ' + plan.cls + ': ' + g.what + '.\n// Reestructuración ' + plan.fecha + ': movidos TAL CUAL desde ' + BASE + '.js, que los une a la clase (como métodos normales).\n' + body;
});
const coreMembers = seg.filter((s, i) => !taken.has(i)).map(segText).join('\n');
const head = SRC.slice(clsStmt.start, cls.body.start);
const mixFn = '_mix' + plan.cls;
const mix = '\n// Reestructuración ' + plan.fecha + ': métodos de ' + plan.cls + ' repartidos en ' + plan.groups.map((g) => path.basename(g.file)).join(', ') + '; se unen a la clase como sus métodos normales.\n' +
  'function ' + mixFn + '(o) { Object.getOwnPropertyNames(o).forEach(function(k) { Object.defineProperty(' + plan.cls + '.prototype, k, { value: o[k], writable: true, configurable: true, enumerable: false }); }); }\n' +
  plan.groups.map((g) => mixFn + '(' + g.obj + ');').join(' ') + '\n';
const coreBody = head + '{\n' + coreMembers + '\n}\n' + mix + (afterText ? afterText + '\n' : '');
const coreOwn = new Set([mixFn]); after.forEach((n) => declNames(n).forEach((x) => coreOwn.add(x))); coreOwn.add(plan.cls);
let coreImports = importsFor(coreBody, coreOwn, 'core') + '\n' + plan.groups.map((g) => 'import { ' + g.obj + ' } from \'./' + path.basename(g.file) + '\';').join('\n');
out[plan.file] = prelude + coreImports + '\n' + headerText.replace(/\s+$/, '') + '\n' + coreBody + (exportedShared.length ? '\n// Lo que otros archivos importan de aquí (ahora en ' + path.basename(SHARED) + ')\nexport { ' + exportedShared.join(', ') + ' } from \'./' + path.basename(SHARED) + '\';\n' : '');
for (const [f, t] of Object.entries(out)) { fs.writeFileSync(path.join(root, f), t); console.log(f + ': ' + t.split('\n').length + ' líneas'); }
