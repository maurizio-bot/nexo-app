// COLA 13: enlaces Bluetooth a MTU mínimo (23) por día, por contacto y por papel (cliente/servidor), con las líneas [MTU] de ble_send.js.
//  M1 diag.js pasa las líneas [MTU] a NEXO_noteLog
//  M2 la línea dice «3 de 8 (38 %)» (enlaces a 23 de los asentados) y lista por NEXO ID
//  M3 un 517 cuenta como enlace listo pero no como 23 y no sale en la lista
//  M4 papel: cliente/servidor leído de bleInterface; sin papel conocido no se inventa
//  M5 otras líneas no cuentan
// Uso: node mtu23.js [dir_build]
'use strict';
const fs = require('fs'); const path = require('path');
const { importSrc, buildDir } = require('./srcmod');
(async () => {
  const r = { prueba: 'mtu23' };
  const noop = () => {}; const mem = {};
  global.localStorage = { getItem: (k) => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); }, removeItem: (k) => { delete mem[k]; } };
  global.window = global; global.window.removeEventListener = noop; global.window.dispatchEvent = noop; global.window.addEventListener = noop;
  global.document = { addEventListener: noop, removeEventListener: noop, visibilityState: 'visible' };
  const olog = console.log; console.log = noop;
  try {
    const dsrc = fs.readFileSync(path.join(buildDir, 'src/ui/diag.js'), 'utf8');
    r.M1_gancho = /\(WIFI\|NET\|JUMP\|GW\|MTU\)/.test(dsrc);
    const us = await importSrc('ui/usage_stats.js');
    const setRole = (role) => { global.window.bleInterface = { _deviceStates: new Map([['AA:01', role ? { role } : {}], ['AA:03', {}]]), _macToNexoId: new Map([['AA:01', 'nx1234abcd'], ['AA:03', 'nx99999999']]) }; };
    const L = () => (us.usageSpeedLines().find((x) => /MTU mínimo/.test(x)) || '');
    const aviso = (id) => '[MTU] ' + id + ': 23 (mínimo: Bluetooth muy lento con este teléfono)';
    setRole('client'); us.usageNoteLog(aviso('nx1234abcd'));
    setRole('server'); us.usageNoteLog(aviso('nx1234abcd'));
    setRole('client'); us.usageNoteLog(aviso('nx1234abcd'));
    us.usageNoteLog(aviso('nx99999999')); // sin papel conocido
    for (let i = 0; i < 4; i++) us.usageNoteLog('[MTU] nxaaaaaaaa: 517');
    us.usageNoteLog('[BLEInterface] algo: 23'); // no cuenta
    r.M_linea = L();
    r.M2 = /hoy: 4 de 8 \(50 %\): nx1234abcd ×3/.test(r.M_linea);
    r.M3 = !/nxaaaaaaaa/.test(r.M_linea);
    r.M4 = /nx1234abcd ×3 \(cliente 2, servidor 1\)/.test(r.M_linea) && /nx99999999 ×1(,|$)/.test(r.M_linea);
    r.M5 = !/algo/.test(r.M_linea) && us.usageSpeedLines().filter((x) => /MTU mínimo/.test(x)).length === 1;
  } finally { console.log = olog; }
  const ok = Object.keys(r).filter((k) => k !== 'prueba' && k !== 'resultado' && !/_linea$/.test(k)).every((k) => r[k] === true);
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('MTU23 ' + JSON.stringify(r)); process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('MTU23 {"resultado":"FALLO","error":"' + String(e && e.stack || e).replace(/"/g, "'").slice(0, 500) + '"}'); process.exit(1); });
