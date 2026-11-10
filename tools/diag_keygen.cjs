#!/usr/bin/env node
// Genera la llave del CANAL DIRECTO DE DIAGNÓSTICOS a Claude (2992+): un par secp256k1 aparte de la identidad del dueño.
//   · la clave PÚBLICA (hex, 33 bytes comprimida) se pega en src/ui/diag_channel.js (DIAG_CHANNEL_PUB): va dentro de la app, es pública;
//   · la clave PRIVADA se guarda en el ARCHIVO que se indique (permisos 600) y NUNCA se imprime ni se sube al repositorio: el dueño la pega como
//     variable de entorno NEXO_DIAG_PRIV en la configuración del entorno de Claude (cada sesión nueva la recibe) y borra el archivo.
// Uso: node tools/diag_keygen.cjs <archivo_donde_guardar_la_privada>
'use strict';
const fs = require('fs');
(async () => {
  const out = process.argv[2];
  if (!out) { console.error('Uso: node tools/diag_keygen.cjs <archivo_privada>'); process.exit(2); }
  if (fs.existsSync(out)) { console.error('Ya existe ' + out + ': no se sobrescribe'); process.exit(2); }
  const path = require('path'), { pathToFileURL } = require('url');
  const dir = [path.join(__dirname, '.deps/node_modules'), path.join(__dirname, '../node_modules'), path.join(__dirname, '../tests/sim/.deps/node_modules')].find((d) => fs.existsSync(path.join(d, '@noble/curves/secp256k1.js')));
  if (!dir) { console.error('Faltan @noble/curves y @noble/hashes (npm install en la raíz o en tools/.deps)'); process.exit(2); }
  const imp = (f) => import(pathToFileURL(path.join(dir, f)).href);
  const { secp256k1 } = await imp('@noble/curves/secp256k1.js');
  const { sha256 } = await imp('@noble/hashes/sha2.js');
  const { bytesToHex } = await imp('@noble/hashes/utils.js');
  const sk = secp256k1.utils.randomSecretKey();
  const pub = secp256k1.getPublicKey(sk, true);
  fs.writeFileSync(out, bytesToHex(sk) + '\n', { mode: 0o600 });
  console.log('PUBLICA ' + bytesToHex(pub));
  console.log('ETIQUETA nexo-diag-' + bytesToHex(sha256(pub)).slice(0, 16));
  console.log('PRIVADA guardada en ' + out + ' (no se muestra)');
})();
