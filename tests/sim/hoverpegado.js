// Dueño 23-11 (captura: la fila de un contacto se quedaba «seleccionada» y parpadeando): en un teléfono el :hover de CSS se queda pegado
// en el último elemento tocado. Ningún :hover puede estar fuera de @media (hover: hover): solo con ratón. Uso: node hoverpegado.js [dir_build]
'use strict';
const fs = require('fs'), path = require('path');
const { buildDir } = require('./srcmod');
const dir = path.join(buildDir, 'src', 'styles');
const sueltos = [];
for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.css'))) {
  const css = fs.readFileSync(path.join(dir, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  let depth = 0, hoverDepth = -1, buf = '';
  for (const ch of css) {
    if (ch === '{') {
      const sel = buf.trim();
      if (hoverDepth < 0 && /@media[^{]*\(hover:\s*hover\)/.test(sel)) hoverDepth = depth;
      else if (hoverDepth < 0 && /:hover/.test(sel)) sueltos.push(f + ': ' + sel.slice(-80));
      depth++; buf = '';
    } else if (ch === '}') { depth--; if (depth === hoverDepth) hoverDepth = -1; buf = ''; }
    else if (ch === ';') buf = '';
    else buf += ch;
  }
}
const r = { prueba: 'hoverpegado', sueltos, resultado: sueltos.length ? 'FALLO' : 'OK' };
console.log('HOVERPEGADO ' + JSON.stringify(r));
process.exit(sueltos.length ? 1 : 0);
