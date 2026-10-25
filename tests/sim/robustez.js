// Índice de robustez de NEXO (docs/ROBUSTEZ.md), a partir del catálogo (robustez.json) y de la salida de la batería
// (node ci.js <build> > salida.txt). Por área, de 0 a 100:
//  A (35) pruebas: fallos conocidos vigilados por una prueba de la batería que pasa / fallos conocidos del área
//  B (35) teléfonos: confirmado en los teléfonos del dueño tras el último cambio del área (35); funcionó antes y ha
//         cambiado sin volver a probarse (15); el último informe fue un fallo o nunca se probó (0)
//  C (20) puntos débiles abiertos: 20 − 8 por cada grave, 4 por cada medio y 2 por cada leve (mínimo 0)
//  D (10) estabilidad: 10 − 2 por cada fallo que encontró la última revisión del área (0 si aún no se ha revisado)
// Índice global: media de las áreas ponderada por su peso.
// Uso: node robustez.js <salida_de_ci.txt> [--json]
'use strict';
const fs = require('fs');
const path = require('path');

const cat = JSON.parse(fs.readFileSync(path.join(__dirname, 'robustez.json'), 'utf8'));
if (!process.argv[2]) { console.error('Uso: node robustez.js <salida_de_ci.txt> [--json]'); process.exit(2); }
const lines = fs.readFileSync(process.argv[2], 'utf8').split('\n');
const name = (l) => l.slice(2).replace(/ \(\d+ s\)(:.*)?$/, '');
const passed = lines.filter((l) => l.startsWith('✓ ')).map(name);
const failed = lines.filter((l) => l.startsWith('✗ ')).map(name);
const r1 = (x) => Math.round(x * 10) / 10;

const areas = cat.areas.map((a) => {
  const modos = a.modos.map((m) => {
    if (!m.prueba) return Object.assign({ estado: m.fuera ? 'fuera' : 'sin prueba' }, m);
    if (failed.some((n) => n.includes(m.prueba))) return Object.assign({ estado: 'falla' }, m);
    if (passed.some((n) => n.includes(m.prueba))) return Object.assign({ estado: 'pasa' }, m);
    return Object.assign({ estado: 'no encontrada' }, m);
  });
  const pasan = modos.filter((m) => m.estado === 'pasa').length;
  const A = cat.puntos.A * pasan / modos.length;
  const B = cat.telefono[a.telefono.estado] || 0;
  const C = Math.max(0, cat.puntos.C - a.debiles.reduce((s, d) => s + (cat.debil[d.g] || 0), 0));
  const D = a.revision.n ? Math.max(0, cat.puntos.D - 2 * a.revision.fallos) : 0;
  return { id: a.id, nombre: a.nombre, peso: a.peso, A: r1(A), B, C, D, indice: r1(A + B + C + D), pasan, modos, telefono: a.telefono, debiles: a.debiles, revision: a.revision };
});
const peso = areas.reduce((s, a) => s + a.peso, 0);
const glob = (k) => r1(areas.reduce((s, a) => s + a[k] * a.peso, 0) / peso);
const res = { fecha: new Date().toISOString().slice(0, 10), escenarios: { pasan: passed.length, fallan: failed.length }, indice: glob('indice'), A: glob('A'), B: glob('B'), C: glob('C'), D: glob('D'), areas };

if (process.argv.includes('--json')) { console.log(JSON.stringify(res, null, 1)); process.exit(0); }
const P = cat.puntos;
console.log('| Área | Peso | A pruebas (' + P.A + ') | B teléfonos (' + P.B + ') | C débiles (' + P.C + ') | D estabilidad (' + P.D + ') | Índice |');
console.log('|---|---|---|---|---|---|---|');
areas.forEach((a) => console.log('| ' + a.nombre + ' | ' + a.peso + ' | ' + a.A + ' (' + a.pasan + '/' + a.modos.length + ') | ' + a.B + ' (' + a.telefono.estado + ') | ' + a.C + ' (' + a.debiles.length + ') | ' + a.D + (a.revision.n ? ' (' + a.revision.fallos + ' fallos)' : ' (sin revisar)') + ' | **' + a.indice + '** |'));
console.log('| **Global** (ponderado) | ' + peso + ' | ' + res.A + ' | ' + res.B + ' | ' + res.C + ' | ' + res.D + ' | **' + res.indice + '** |');
console.log('');
console.log('Batería: ' + passed.length + ' escenarios pasan, ' + failed.length + ' fallan.');
const sin = [], noEnc = [], mal = [];
areas.forEach((a) => a.modos.forEach((m) => {
  if (m.estado === 'falla') mal.push(a.nombre + ': ' + m.fallo + ' (' + m.prueba + ')');
  else if (m.estado === 'no encontrada') noEnc.push(a.nombre + ': ' + m.fallo + ' («' + m.prueba + '» no está en la salida)');
  else if (m.estado !== 'pasa') sin.push(a.nombre + ': ' + m.fallo + (m.fuera ? ' — prueba fuera de la batería: ' + m.fuera : ' — sin prueba automática'));
}));
if (mal.length) { console.log('\nPruebas que fallan:'); mal.forEach((x) => console.log('- ' + x)); }
if (noEnc.length) { console.log('\nPruebas del catálogo que no aparecen en la salida (¿cambió el nombre?):'); noEnc.forEach((x) => console.log('- ' + x)); }
if (sin.length) { console.log('\nFallos conocidos sin prueba en la batería (' + sin.length + '):'); sin.forEach((x) => console.log('- ' + x)); }
