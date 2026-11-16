// 3166 (la APK 3076 se paró en 9 pruebas por «Unknown file extension .css»): un módulo de src/ que importa un .css rompe toda prueba
// que lo cargue con Node (importSrc). Los estilos se importan SOLO desde src/main.js (webpack); esta prueba lo vigila.
// Contraprueba: con `import '../styles/links.css'` en src/ui/links.js (3165) → FALLO. Uso: node importcss.js [dir_build]
'use strict';
const fs = require('fs');
const path = require('path');
const root = path.resolve(process.argv[2] ? path.join(process.argv[2], 'src') : path.join(__dirname, '..', '..', 'src'));
const malos = [];
(function walk(d) {
  for (const n of fs.readdirSync(d)) {
    const f = path.join(d, n), st = fs.statSync(f);
    if (st.isDirectory()) { walk(f); continue; }
    if (!/\.js$/.test(n) || path.relative(root, f) === 'main.js') continue;
    fs.readFileSync(f, 'utf8').split('\n').forEach((l, i) => { if (/^\s*import\s+['"][^'"]+\.css['"]/.test(l)) malos.push(path.relative(root, f) + ':' + (i + 1)); });
  }
})(root);
const r = { prueba: 'importcss', fuera_de_main: malos, resultado: malos.length ? 'FALLO' : 'OK' };
console.log('IMPORTCSS ' + JSON.stringify(r));
process.exit(malos.length ? 1 : 0);
