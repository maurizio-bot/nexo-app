// Fase 1 del contrato de los caminos (docs/CONTRATO_CAMINOS_28-11.md §D.3, segundo bloque):
//  S  MODO SOMBRA: situacion()/elegirTexto() dan la tabla TEXTO de B.2.3 (S1 lan, S3 net.relay, S4 ble.gatt, S5/S6 net.relay, S7 net.gw,
//     S8 jump, S9 PAUSADO); carrilReal() traduce el camino de hoy; Sombra cuenta iguales/diferencias y anota «[RUTA-SOMBRA] … elegiría X /
//     se hizo Y» sin mandar nada; cada 20, un resumen con el %.
//  R  REPUBLICAR EL MISMO EVENTO: el mismo paquete al mismo contacto el mismo día (y misma clave) devuelve el evento guardado (mismo id);
//     otro paquete, otro día/clave, pasada la ventana de 30 min o a < 2 min de caducar en el relé → null (se cifra uno nuevo); tope de
//     memoria; olvidar(nx).
//  D  el relé que contesta «duplicate» (aunque sea con OK false) cuenta como guardado (net_relays.js).
//  I  net_link.send() usa la caché (busca antes de cifrar; guarda el evento nuevo), salvo saludo y partes de llamada; el envío real por
//     relés lo cubren net.js, bignet.js, relevo.js y leeen.js (que deben seguir verdes).
// Uso: node rutasombra.js
'use strict';
const fs = require('fs');
const path = require('path');
const { importSrc } = require('./srcmod');

(async () => {
  const r = { prueba: 'rutasombra' };
  const fallos = [];
  const ok = (k, v, info) => { r[k] = v; if (v !== true) fallos.push(k + (info ? ' ' + info : '')); };
  const E = await importSrc('core/ruta/elegir.js');
  // S
  const T = (h) => E.elegirTexto(h);
  const casos = [
    [{ lan: true, cerca: true, yoNet: true, elNet: true, buzon: true }, 'S1', 'lan'],
    [{ cerca: true, yoNet: true, elNet: true, buzon: true }, 'S3', 'net.relay'],
    [{ cerca: true, yoNet: false, buzon: false }, 'S4', 'ble.gatt'],
    [{ cerca: true, yoNet: true, elNet: false, buzon: true }, 'S4', 'ble.gatt'],
    [{ yoNet: true, elNet: true, buzon: true }, 'S5', 'net.relay'],
    [{ yoNet: true, elNet: false, buzon: true }, 'S6', 'net.relay'],
    [{ gw: true, buzon: true }, 'S7', 'net.gw'],
    [{ jump: true }, 'S8', 'jump'],
    [{}, 'S9', 'PAUSADO'],
  ];
  const malos = casos.filter((c) => { const e = T(c[0]); return e.sit !== c[1] || e.carril !== c[2]; }).map((c) => JSON.stringify(c[0]) + '→' + JSON.stringify(T(c[0])));
  ok('S_tabla_texto', !malos.length, malos.join(' | '));
  const reales = [[{ deviceId: 'lan:nxaaaaaaaa' }, 'lan'], [{ deviceId: 'net:nxaaaaaaaa' }, 'net.relay'], [{ deviceId: 'netnxaaaaaaaa', gwOnly: true }, 'net.gw'],
    [{ deviceId: 'AA:BB:CC:DD:EE:FF' }, 'ble.gatt'], [{ deviceId: 'wd:nxaaaaaaaa' }, 'wd'], [{ jump: true, deviceId: 'AA' }, 'jump'], [{ buzon: true }, 'net.relay'], [{}, 'PAUSADO']];
  const malos2 = reales.filter((c) => E.carrilReal(c[0]) !== c[1]).map((c) => JSON.stringify(c[0]) + '→' + E.carrilReal(c[0]));
  ok('S_carril_real', !malos2.length, malos2.join(' | '));
  const lines = [];
  const sb = new E.Sombra((l) => lines.push(l));
  for (let i = 0; i < 19; i++) sb.anotar('m' + i, 'TEXTO', { yoNet: true, elNet: true, buzon: true }, { deviceId: 'net:nxaaaaaaaa' });
  const d = sb.anotar('m19', 'TEXTO', { cerca: true, yoNet: true, elNet: true, buzon: true }, { deviceId: 'AA:BB:CC:DD:EE:FF' });
  r.S_linea = lines[lines.length - 2]; r.S_resumen = lines[lines.length - 1];
  ok('S_sombra_cuenta', sb.total === 20 && sb.iguales === 19 && sb.difs['S3:net.relay>ble.gatt'] === 1 && d.igual === false &&
    /^\[RUTA-SOMBRA\] m19 TEXTO S3 elegiría net\.relay \/ se hizo ble\.gatt ≠$/.test(r.S_linea) && /resumen: 19\/20 iguales \(95 %\); diferencias: S3:net\.relay>ble\.gatt ×1/.test(r.S_resumen), JSON.stringify(lines.slice(-2)));
  // R
  const R = await importSrc('core/ruta/republicar.js');
  const now = 1800000000000, exp = String(Math.floor(now / 1000) + 7 * 86400);
  const rp = new R.Republicar();
  const ev = { id: 'e1', tags: [['p', 'x'], ['expiration', exp]] };
  rp.guardar('nxaaaaaaaa', '{"type":"chat","msgId":"m1"}', 'd1|k', ev, 604800, now);
  const a = rp.buscar('nxaaaaaaaa', '{"type":"chat","msgId":"m1"}', 'd1|k', now + 60000);
  ok('R_mismo_paquete_mismo_evento', !!a && a.ev === ev && a.veces === 1);
  ok('R_otro_paquete_nuevo', rp.buscar('nxaaaaaaaa', '{"type":"chat","msgId":"m2"}', 'd1|k', now) === null);
  ok('R_otro_contacto_nuevo', rp.buscar('nxbbbbbbbb', '{"type":"chat","msgId":"m1"}', 'd1|k', now) === null);
  ok('R_otro_dia_o_clave_nuevo', rp.buscar('nxaaaaaaaa', '{"type":"chat","msgId":"m1"}', 'd2|k', now) === null && rp.buscar('nxaaaaaaaa', '{"type":"chat","msgId":"m1"}', 'd1|k2', now) === null);
  ok('R_pasada_la_ventana_nuevo', rp.buscar('nxaaaaaaaa', '{"type":"chat","msgId":"m1"}', 'd1|k', now + R.REPUB.VENTANA_MS + 1) === null);
  const ev2 = { id: 'e2', tags: [['expiration', String(Math.floor(now / 1000) + 60)]] };
  rp.guardar('nxaaaaaaaa', 'casi', 'd1|k', ev2, 600, now);
  ok('R_por_caducar_nuevo', rp.buscar('nxaaaaaaaa', 'casi', 'd1|k', now + 1000) === null);
  for (let i = 0; i < R.REPUB.MAX + 50; i++) rp.guardar('nxcccccccc', 'p' + i, 'd', { id: 'x' + i, tags: [] }, 600, now);
  ok('R_tope_memoria', rp.m.size <= R.REPUB.MAX);
  rp.olvidar('nxcccccccc');
  ok('R_olvidar', Array.from(rp.m.keys()).every((k) => k.indexOf('nxcccccccc|') !== 0));
  ok('R_huella_corta', R.huella('x'.repeat(60000)).length < 20 && R.huella('a') !== R.huella('b'));
  // D
  const relSrc = fs.readFileSync(path.join(__dirname, '../../src/net/net_relays.js'), 'utf8');
  ok('D_duplicate_es_guardado', /var okD = !!m\[2\] \|\| \/\^duplicate:\/i\.test\(String\(m\[3\] \|\| ''\)\);/.test(relSrc) && /fn\(okD, m\[3\]\)/.test(relSrc)); // 3173: el mismo «ok» también puntúa al relé
  // I
  const nl = fs.readFileSync(path.join(__dirname, '../../src/net/net_link.js'), 'utf8');
  ok('I_send_republica', /this\._repub\.buscar\(nx, content, rdia, Date\.now\(\)\)/.test(nl) && /this\._repub\.guardar\(nx, content, rdia, ev, ttl, Date\.now\(\)\)/.test(nl) && /!hello0/.test(nl) && /!== TTL_RT/.test(nl));
  r.fallos = fallos;
  r.resultado = fallos.length ? 'FALLO' : 'OK';
  console.log('RUTASOMBRA ' + JSON.stringify(r));
  process.exit(fallos.length ? 1 : 0);
})().catch((e) => { console.log('RUTASOMBRA ' + JSON.stringify({ prueba: 'rutasombra', resultado: 'FALLO', error: String(e && e.stack).slice(0, 400) })); process.exit(1); });
