// 3239 (diagnóstico del dueño 18-11 11:43: tras cerrar un enlace repetido, el texto largo siguió escribiéndole 9 s al cerrado hasta
// «Write fallo ~6 s: 20 trozos descartados»): al cerrar el repetido, el flujo y los textos en espera pasan AL INSTANTE al enlace que se queda.
// Uso: node dedupreenlaza.js [dir_build]
'use strict';
const { importSrc } = require('./srcmod');

(async () => {
  const r = { prueba: 'dedupreenlaza' };
  const noop = () => {};
  global.window = global; global.window.addEventListener = noop; global.window.removeEventListener = noop;
  global.document = global.document || { addEventListener: noop, removeEventListener: noop, getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], createElement: () => ({ style: {}, classList: { add: noop, remove: noop }, addEventListener: noop, appendChild: noop, setAttribute: noop }), body: { appendChild: noop }, documentElement: { style: {} }, visibilityState: 'visible' };
  const m = await importSrc('ui/ble_connections.js');
  const M = m.BLE_CONNECTION_METHODS;
  const usos = [];
  const flujo = { aborted: false, deviceId: '44:C1:5D:1B:CD:55', useLink(d) { usos.push(d); this.deviceId = d; } };
  const otro = { aborted: false, deviceId: 'AA:AA:AA:AA:AA:AA', useLink(d) { usos.push('MAL'); } };
  const entrada = { deviceId: '44:C1:5D:1B:CD:55', raw: false };
  const bruta = { deviceId: '44:C1:5D:1B:CD:55', raw: true };
  const yo = Object.assign(Object.create(null), M, {
    ackSystem: { outgoingStreams: new Map([['a', flujo], ['b', otro]]), pendingAcks: new Map([['c', entrada], ['d', bruta]]) }
  });
  const n = yo._rebindOutgoing('44c15d1bcd55', { key: '70ec36c16e9d' });
  r.pasa_el_flujo = usos.join() === '70ec36c16e9d' && flujo.deviceId === '70ec36c16e9d';
  r.pasa_el_texto_en_espera = entrada.deviceId === '70ec36c16e9d';
  r.no_toca_otros_enlaces = otro.deviceId === 'AA:AA:AA:AA:AA:AA' && !usos.includes('MAL');
  r.no_toca_lo_crudo_del_puente = bruta.deviceId === '44:C1:5D:1B:CD:55';
  r.cuenta_2 = n === 2;
  r.sin_enlace_que_queda_no_hace_nada = yo._rebindOutgoing('44c15d1bcd55', undefined) === 0;
  r.resultado = ['pasa_el_flujo', 'pasa_el_texto_en_espera', 'no_toca_otros_enlaces', 'no_toca_lo_crudo_del_puente', 'cuenta_2', 'sin_enlace_que_queda_no_hace_nada'].every((k) => r[k]) ? 'OK' : 'FALLO';
  console.log('DEDUPREENLAZA ' + JSON.stringify(r));
  process.exit(r.resultado === 'OK' ? 0 : 1);
})().catch((e) => { console.log('DEDUPREENLAZA ' + JSON.stringify({ prueba: 'dedupreenlaza', error: String(e && e.stack || e).slice(0, 400), resultado: 'FALLO' })); process.exit(1); });
