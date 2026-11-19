// Estadística de los diagnósticos recibidos (docs/diagnosticos.json): por día, por categoría y causas que se repiten. Uso: node tests/sim/diag_stats.js
'use strict';
const path = require('path');
const d = require(path.join(__dirname, '../../docs/diagnosticos.json')).diagnosticos || [];
const cuenta = (arr, f) => arr.reduce((m, x) => { const k = f(x); m[k] = (m[k] || 0) + 1; return m; }, {});
const fallos = d.filter((x) => x.sintoma !== 'resumen_diario');
console.log('Total: ' + d.length + ' (fallos ' + fallos.length + ', resúmenes ' + (d.length - fallos.length) + ')');
console.log('\nPor día (fallos / total):');
const dias = [...new Set(d.map((x) => x.dia))].sort();
dias.forEach((k) => console.log('  ' + k + ': ' + fallos.filter((x) => x.dia === k).length + ' / ' + d.filter((x) => x.dia === k).length));
console.log('\nFallos por categoría:');
Object.entries(cuenta(fallos, (x) => x.categoria)).sort((a, b) => b[1] - a[1]).forEach(([k, n]) => console.log('  ' + n + ' · ' + k));
console.log('\nCausas:');
Object.entries(cuenta(fallos, (x) => x.causa)).sort((a, b) => b[1] - a[1]).forEach(([k, n]) => console.log('  ' + n + ' · ' + k));
console.log('\nTeléfonos con más fallos:');
Object.entries(cuenta(fallos, (x) => x.nx)).sort((a, b) => b[1] - a[1]).slice(0, 6).forEach(([k, n]) => console.log('  ' + n + ' · ' + k));
