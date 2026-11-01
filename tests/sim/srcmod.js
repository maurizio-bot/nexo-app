// Carga un módulo ES de la COPIA COMPILADA (builds/<ref>/src/...), NO del repo-raíz.
// Por qué: en CI el job «tests» solo hace `npm ci` dentro de tests/sim; el repo-raíz NO tiene
// node_modules, así que importar `../../src/net/net_link.js` revienta con ERR_MODULE_NOT_FOUND al
// resolver `@noble/*` (y cualquier otra dependencia). En cambio builds/wip/src/... resuelve sus
// dependencias por el node_modules enlazado del build (tests/sim/.deps, que build.sh instala con el
// package.json del repo). Resultado: lo local == lo de CI, y la batería detecta este tipo de fallo.
// ci.js pasa el directorio del build como argv[2]; sin él, por defecto builds/wip.
// Uso: const { importSrc } = require('./srcmod'); const m = await importSrc('ui/calls.js');
'use strict';
const path = require('path');
const { pathToFileURL } = require('url');

const buildDir = path.resolve(process.argv[2] || path.join(__dirname, 'builds/wip'));

function importSrc(rel) {
  return import(pathToFileURL(path.join(buildDir, 'src', rel)).href);
}

module.exports = { importSrc, buildDir };
