// 3252 (diagnóstico del S24 19-11 14:54, 3109): con datos móviles los relés se dieron por muertos ~9 s; un texto al S23 se marcó
// «fallido» (✗, vibración de error) por «Sin internet con …» (NET_DOWN) y se entregó 1 s después, al volver los relés. Que el
// internet se caiga un momento no es un fallo del mensaje: queda pendiente (⏳) y sale solo al volver (como sin Wi-Fi o sin clave).
//  F1  NET_DOWN («Sin internet con …», «Sin relés», «Los relés no respondieron») → 'pending'
//  F2  lo de antes no cambia: LAN_DOWN/NO_KEY/PEER_ABSENT → 'pending'; IN_MAILBOX → 'sent'; un error cualquiera → 'failed'
// Contraprueba 3109: F1 da 'failed'.
// Uso: node failnet.js <dir_build>
'use strict';
const path = require('path');
const { pathToFileURL } = require('url');
const buildDir = path.resolve(process.argv[2]);
(async () => {
  const r = { prueba: 'failnet', build: path.basename(buildDir) };
  try {
    const m = await import(pathToFileURL(path.join(buildDir, 'src', 'ui', 'ble_helpers.js')).href);
    const st = (code, msg) => m._failStatus(Object.assign(new Error(msg || 'x'), code ? { code } : {}));
    r.F1 = [st('NET_DOWN', 'Sin internet con nx1'), st('NET_DOWN', 'Sin relés'), st('NET_DOWN', 'Los relés no respondieron')];
    r.F2 = { lan: st('LAN_DOWN'), key: st('NO_KEY'), absent: st('PEER_ABSENT'), mailbox: st('IN_MAILBOX'), otro: st(null, 'boom'), nulo: m._failStatus(null) };
    const ok = r.F1.every((s) => s === 'pending') && r.F2.lan === 'pending' && r.F2.key === 'pending' && r.F2.absent === 'pending' && r.F2.mailbox === 'sent' && r.F2.otro === 'failed' && r.F2.nulo === 'failed';
    r.resultado = ok ? 'OK' : 'FALLO';
  } catch (e) { r.resultado = 'FALLO'; r.error = String(e && e.message); }
  console.log('FAILNET ' + JSON.stringify(r));
  process.exit(r.resultado === 'OK' ? 0 : 1);
})();
