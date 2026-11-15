// Reestructuración 15-11 (dueño: «primero reestructura, tener todo bien claro»): parte src/ui/ble_ack.js (3.150 líneas) en piezas de
// menos de 1.000, moviendo el código TAL CUAL (cada método con sus comentarios). La revisión es tools/partir_check.cjs.
//  ble_ack_shared.js    constantes y ayudantes del módulo (lo que va antes de la clase)
//  chat_stream.js       ChatStream (un envío troceado en curso: ventanas, reintentos)
//  ble_ack_files.js     métodos de ENVÍO de archivos (Wi-Fi Direct, buzón de relés, cola de archivos por Bluetooth)
//  ble_ack_incoming.js  métodos de RECEPCIÓN (trozos que llegan, armado, NACK/ack de bloque, sincronía de sesión)
//  ble_ack_resume.js    métodos de REANUDAR y limpiar (transferencias pendientes, entregadas, progreso, limpieza)
//  ble_ack.js           la clase BleAckSystem con lo demás (envío de textos, acks, reintentos) y la unión de las piezas
'use strict';
const fs = require('fs');
const path = require('path');
const acorn = require(path.join(__dirname, '..', 'node_modules', 'acorn'));
const root = path.join(__dirname, '..'), dir = path.join(root, 'src', 'ui');
const SRC = fs.readFileSync(path.join(dir, 'ble_ack.js'), 'utf8');
const ast = acorn.parse(SRC, { ecmaVersion: 'latest', sourceType: 'module' });
const GROUPS = [
  { file: 'ble_ack_files.js', obj: 'ackFiles', from: 'markBin', through: '_pumpFileQueue', what: 'ENVÍO de archivos: Wi-Fi Direct, buzón de archivos en relés, cola de archivos por Bluetooth' },
  { file: 'ble_ack_incoming.js', obj: 'ackIncoming', from: 'processIncomingFragment', through: 'sendSessionSync', what: 'RECEPCIÓN: trozos que llegan, armado, NACK y ack de bloque, sincronía de sesión' },
  { file: 'ble_ack_resume.js', obj: 'ackResume', from: 'cancelFileSend', through: '_startCleanupInterval', what: 'REANUDAR y limpiar: transferencias pendientes y entregadas, avisos de progreso, limpieza periódica' },
];

const imports = ast.body.filter((n) => n.type === 'ImportDeclaration');
const importOf = new Map(); // local → { src, imported }
imports.forEach((d) => d.specifiers.forEach((s) => importOf.set(s.local.name, { src: d.source.value, imported: s.imported ? s.imported.name : 'default' })));
const lastImport = imports[imports.length - 1];
const nonImp = ast.body.filter((n) => n.type !== 'ImportDeclaration');
const classStmt = nonImp.find((n) => n.type === 'ExportNamedDeclaration' && n.declaration && n.declaration.type === 'ClassDeclaration');
const createStmt = nonImp.find((n) => n.type === 'ExportNamedDeclaration' && n.declaration && n.declaration.type === 'FunctionDeclaration' && n.declaration.id.name === 'createAckSystem');
const firstStmt = nonImp[0];
// comentario de cabecera (historial de versiones) entre los import y la primera sentencia
const headerText = SRC.slice(lastImport.end, firstStmt.start).replace(/^[^\n]*\n/, '');
const sharedText = SRC.slice(firstStmt.start, classStmt.start).replace(/\s+$/, '') + '\n';
const streamText = SRC.slice(classStmt.end, createStmt.start).replace(/^\s*\n/, '').replace(/\s+$/, '') + '\n';
const createText = SRC.slice(createStmt.start).replace(/\s+$/, '') + '\n';

// nombres de nivel de módulo del archivo viejo
const topDecl = new Map(); // nombre → dónde queda: 'shared' | 'stream' | 'core'
const declIn = (n, where) => {
  const d = n.type === 'ExportNamedDeclaration' ? n.declaration : n;
  if (!d) return;
  if ((d.type === 'FunctionDeclaration' || d.type === 'ClassDeclaration') && d.id) topDecl.set(d.id.name, where);
  if (d.type === 'VariableDeclaration') d.declarations.forEach((x) => topDecl.set(x.id.name, where));
};
nonImp.forEach((n) => declIn(n, n.start < classStmt.start ? 'shared' : n === classStmt || n === createStmt ? 'core' : 'stream'));
const alreadyExported = new Set();
nonImp.forEach((n) => { if (n.type === 'ExportNamedDeclaration' && n.declaration && n.start < classStmt.start) { const d = n.declaration; if (d.id) alreadyExported.add(d.id.name); if (d.declarations) d.declarations.forEach((x) => alreadyExported.add(x.id.name)); } });

// miembros de la clase, cada uno con los comentarios que lo preceden
const cls = classStmt.declaration, members = cls.body.body;
const seg = members.map((m, i) => ({ name: m.key.name, start: i === 0 ? cls.body.start + 1 : members[i - 1].end, end: m.end }));
const idx = (name) => { const i = seg.findIndex((s) => s.name === name); if (i < 0) throw new Error('no está: ' + name); return i; };
const taken = new Set();
GROUPS.forEach((g) => { g.a = idx(g.from); g.b = idx(g.through); for (let i = g.a; i <= g.b; i++) { if (taken.has(i)) throw new Error('solapado'); taken.add(i); } });
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
// líneas import para un cuerpo de texto (own: nombres declarados en el propio archivo)
function importsFor(body, own) {
  const used = usedNames(body), bySrc = new Map();
  const want = (src, spec) => { if (!bySrc.has(src)) bySrc.set(src, []); if (bySrc.get(src).indexOf(spec) < 0) bySrc.get(src).push(spec); };
  for (const n of used) {
    if (own.has(n)) continue;
    if (importOf.has(n)) { const im = importOf.get(n); want(im.src, im.imported === n ? n : im.imported + ' as ' + n); continue; }
    const w = topDecl.get(n);
    if (w === 'shared') want('./ble_ack_shared.js', n);
    else if (w === 'stream') want('./chat_stream.js', n);
    else if (w === 'core' && n !== 'BleAckSystem' && n !== 'createAckSystem') want('./ble_ack.js', n);
  }
  return [...bySrc].map(([src, specs]) => 'import { ' + specs.join(', ') + ' } from \'' + src + '\';').join('\n');
}
const ownOf = (text) => { const a = acorn.parse(text, { ecmaVersion: 'latest', sourceType: 'module' }), s = new Set(); a.body.forEach((n) => { const d = n.type === 'ExportNamedDeclaration' ? n.declaration : n; if (!d) return; if (d.id) s.add(d.id.name); if (d.declarations) d.declarations.forEach((x) => s.add(x.id.name)); }); return s; };

const out = {};
// 1) compartido
const sharedOwn = ownOf(sharedText);
const sharedExports = [...sharedOwn].filter((n) => !alreadyExported.has(n));
out['ble_ack_shared.js'] = importsFor(sharedText, sharedOwn) + '\n// Constantes y ayudantes de BleAckSystem (reestructuración 15-11: antes, la cabecera de ble_ack.js). Lo usan ble_ack.js, sus piezas\n// (ble_ack_files/incoming/resume.js) y chat_stream.js.\n' + sharedText + '\nexport { ' + sharedExports.join(', ') + ' };\n';
// 2) ChatStream
const streamOwn = ownOf(streamText);
out['chat_stream.js'] = importsFor(streamText, streamOwn) + '\n// ChatStream: un envío troceado en curso (ventanas, reintentos, confirmaciones). Reestructuración 15-11: antes, al final de ble_ack.js.\n' + streamText + '\nexport { ChatStream };\n';
// 3) piezas de la clase
GROUPS.forEach((g) => {
  const body = seg.slice(g.a, g.b + 1).map((s) => segText(s) + ',').join('\n');
  const text = 'export const ' + g.obj + ' = {\n' + body + '\n};\n';
  out[g.file] = importsFor(text, new Set([g.obj])) + '\n// Métodos de BleAckSystem: ' + g.what + '.\n// Reestructuración 15-11: movidos TAL CUAL desde ble_ack.js; ble_ack.js los une a la clase (como métodos normales).\n' + text;
});
// 4) núcleo
const coreMembers = seg.filter((s, i) => !taken.has(i)).map(segText).join('\n');
const mix = '\n// Reestructuración 15-11: los métodos de BleAckSystem están repartidos en ble_ack_files.js (envío de archivos), ble_ack_incoming.js\n' +
  '// (recepción) y ble_ack_resume.js (reanudar y limpiar). Se unen a la clase como sus métodos normales (no enumerables).\n' +
  'function _mixAck(o) { Object.getOwnPropertyNames(o).forEach(function(k) { Object.defineProperty(BleAckSystem.prototype, k, { value: o[k], writable: true, configurable: true, enumerable: false }); }); }\n' +
  GROUPS.map((g) => '_mixAck(' + g.obj + ');').join(' ') + '\n';
const coreBody = 'export class BleAckSystem {\n' + coreMembers + '\n}\n' + mix + createText;
const coreOwn = new Set(['BleAckSystem', 'createAckSystem', '_mixAck']);
const reexp = [...alreadyExported].filter((n) => topDecl.get(n) === 'shared');
let coreImports = importsFor(coreBody, coreOwn);
coreImports += '\n' + GROUPS.map((g) => 'import { ' + g.obj + ' } from \'./' + g.file + '\';').join('\n');
out['ble_ack.js'] = coreImports + '\n' + headerText.replace(/\s+$/, '') + '\n' + coreBody + '\n// Lo que otros archivos y las pruebas importan de aquí (ahora en ble_ack_shared.js)\nexport { ' + reexp.join(', ') + ' } from \'./ble_ack_shared.js\';\n';
for (const [f, t] of Object.entries(out)) { fs.writeFileSync(path.join(dir, f), t); console.log(f + ': ' + t.split('\n').length + ' líneas'); }
