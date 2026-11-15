// Tamaño de los archivos (dueño 15-11: «identificar los archivos que ya se hicieron demasiado grandes y hacer reestructuración para no
// seguir aumentando el tamaño… mantenerlos en un límite manejable»). Regla: ningún archivo de código pasa de 1.000 líneas. Los que ya
// lo pasan están en tamano.json con su tope (lo que miden hoy + un margen pequeño para arreglos): si crecen más, esta prueba falla y
// toca partirlos antes. La revisión de fin de semana los va sacando de la lista (tools/partir_check.cjs comprueba cada partición).
// Uso: node tamano.js
'use strict';
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..', '..');
const LIMIT = 1000;
const caps = JSON.parse(fs.readFileSync(path.join(__dirname, 'tamano.json'), 'utf8')).topes;
const files = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) { if (!/node_modules|build|\.gradle/.test(e.name)) walk(p); }
    else if (/\.(js|kt)$/.test(e.name)) files.push(p);
  }
})(path.join(root, 'src'));
(function walk(d) {
  if (!fs.existsSync(d)) return;
  for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (/\.kt$/.test(e.name)) files.push(p); }
})(path.join(root, 'plugins', 'nexo-ble', 'android', 'src', 'main', 'java'));
const r = { prueba: 'tamano', limite: LIMIT, grandes: {}, problemas: [] };
for (const f of files) {
  const rel = path.relative(root, f), n = fs.readFileSync(f, 'utf8').split('\n').length;
  if (n <= LIMIT) continue;
  r.grandes[rel] = n;
  if (!(rel in caps)) r.problemas.push(rel + ': ' + n + ' líneas (> ' + LIMIT + ' y no está en la lista: partirlo)');
  else if (n > caps[rel]) r.problemas.push(rel + ': ' + n + ' líneas (su tope es ' + caps[rel] + ': creció, partirlo)');
}
r.resultado = r.problemas.length ? 'FALLO' : 'OK';
console.log('TAMANO ' + JSON.stringify(r));
process.exit(r.problemas.length ? 1 : 0);
