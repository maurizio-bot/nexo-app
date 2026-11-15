// Reestructuración semanal (dueño 15-11): parte un MÓDULO de funciones sueltas (con datos del módulo) en varios, moviendo cada
// sentencia de nivel superior TAL CUAL (con sus comentarios). Cada parte importa lo que usa de las demás; el archivo original queda
// como puerta: reexporta todo lo que exportaba antes (los que lo importan no cambian).
// Uso: node tools/partir_mod.cjs <plan.json>
//   plan: { "file": "src/x/y.js", "fecha": "15-11", "parts": [ { "file": "src/x/y_a.js", "lines": [[20,23],[27,79]], "what": "…" } ] }
//   (líneas = dónde EMPIEZA cada sentencia del archivo original; toda sentencia tiene que caer en una parte)
// Revisión: node tools/partir_check.cjs HEAD <viejo> <todos los nuevos…>
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
const lastImpEnd = imports.length ? imports[imports.length - 1].end : 0;
// cabecera = comentarios entre los import y la primera sentencia
const headerText = imports.length ? SRC.slice(lastImpEnd, stmts[0].start).replace(/^[^\n]*\n/, '') : ''; // sin import, la cabecera ya va en `prelude`
const prelude = SRC.slice(0, imports.length ? imports[0].start : stmts[0].start); // comentario antes de los import
const partOf = (line) => plan.parts.findIndex((p) => p.lines.some((r) => line >= r[0] && line <= r[1]));
const declNames = (n) => { const d = n.type === 'ExportNamedDeclaration' ? n.declaration : n; const out = []; if (!d) return out; if (d.id && d.id.name) out.push(d.id.name); if (d.declarations) d.declarations.forEach((x) => out.push(x.id.name)); return out; };
const where = new Map(); // nombre → índice de parte
const exportedOrig = [];
const segs = plan.parts.map(() => []);
stmts.forEach((n, i) => {
  const line = lineOf(n.start), p = partOf(line);
  if (p < 0) throw new Error('la sentencia de la línea ' + line + ' no cae en ninguna parte');
  const start = i === 0 ? n.start : stmts[i - 1].end;
  let text = SRC.slice(start, n.end);
  if (i === 0) text = SRC.slice(n.start, n.end);
  segs[p].push(text.replace(/^[^\S\n]*\n/, ''));
  declNames(n).forEach((nm) => where.set(nm, p));
  if (n.type === 'ExportNamedDeclaration') declNames(n).forEach((nm) => exportedOrig.push(nm));
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
const bodies = segs.map((s) => s.join('\n').replace(/\s+$/, '') + '\n');
const needExport = plan.parts.map(() => new Set());
const importLines = bodies.map((body, pi) => {
  const used = usedNames(body), bySrc = new Map();
  const want = (src, spec) => { if (!bySrc.has(src)) bySrc.set(src, []); if (bySrc.get(src).indexOf(spec) < 0) bySrc.get(src).push(spec); };
  for (const n of used) {
    if (where.has(n)) { const q = where.get(n); if (q !== pi) { needExport[q].add(n); want('./' + path.basename(plan.parts[q].file), n); } }
    else if (importOf.has(n)) { const im = importOf.get(n); want(im.src, im.imported === n ? n : im.imported + ' as ' + n); }
  }
  return [...bySrc].map(([src, specs]) => 'import { ' + specs.join(', ') + ' } from \'' + src + '\';').join('\n');
});
plan.parts.forEach((p, pi) => {
  const extra = [...needExport[pi]].filter((n) => exportedOrig.indexOf(n) < 0);
  const text = importLines[pi] + '\n// ' + path.basename(plan.file) + ' — ' + p.what + '.\n// Reestructuración ' + plan.fecha + ': movido TAL CUAL desde ' + path.basename(plan.file) + ' (que lo sigue exportando).\n' +
    bodies[pi] + (extra.length ? '\n// Para las otras piezas de ' + path.basename(plan.file) + '\nexport { ' + extra.join(', ') + ' };\n' : '');
  fs.writeFileSync(path.join(root, p.file), text);
  console.log(p.file + ': ' + text.split('\n').length + ' líneas');
});
// el original: puerta que reexporta lo de siempre
const byPart = plan.parts.map(() => []);
exportedOrig.forEach((n) => byPart[where.get(n)].push(n));
const gate = prelude + headerText.replace(/\s+$/, '') + '\n// Reestructuración ' + plan.fecha + ': este archivo es la PUERTA de siempre; el código está en ' + plan.parts.map((p) => path.basename(p.file)).join(', ') + '.\n' +
  plan.parts.map((p, pi) => byPart[pi].length ? 'export { ' + byPart[pi].join(', ') + ' } from \'./' + path.basename(p.file) + '\';' : '').filter(Boolean).join('\n') + '\n';
fs.writeFileSync(path.join(root, plan.file), gate);
console.log(plan.file + ': ' + gate.split('\n').length + ' líneas (puerta)');
