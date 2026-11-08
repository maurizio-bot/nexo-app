// Archivos grandes por INTERNET autónomos (diag. del dueño 08-11, dos WiFi distintas): un archivo de 34 MB arrancaba en ○,
// se quedaba en 0%, y SOLO avanzaba ~5% cada vez que el dueño tocaba «reintentar». No era autónomo pese a los despertadores
// (2930–2937). Causa: al estancarse un rato (Tor directo parpadea) el timeout global lo marcaba ✗ 'failed' (→ botón que el
// usuario tocaba) y agotar los reintentos de ventana ABORTABA el stream (→ dependía de un re-disparo externo que no llegaba
// solo). 2957: _netFileAutoRetry — un archivo por internet a un contacto ALCANZABLE (canReach) se reenvía SOLO, sin pedir
// nada, mientras siga alcanzable y dentro del presupuesto (2 h); no aborta ni marca ✗, queda ⏳ y el bucle de ventanas sigue
// reintentando y renovando el despertador. Solo si el contacto se vuelve INALCANZABLE cae al store-and-forward (pending), y
// al pasar el tope se suelta (persistido). Prueba de la función pura _netFileAutoRetry. Uso: node netfileauto.js [dir_build]
'use strict';
const { importSrc } = require('./srcmod');

(async () => {
  const r = { prueba: 'netfileauto' };
  const { _netFileAutoRetry } = await importSrc('ui/ble_ack.js');
  const BUDGET = 7200000; // 2 h

  // EL CASO DEL BUG: archivo por internet a un contacto alcanzable, dentro del presupuesto → se reenvía SOLO (true).
  r.file_net_alcanzable_autonomo = _netFileAutoRetry('file', true, true, 60000, BUDGET) === true;
  r.file_net_recien_empezado = _netFileAutoRetry('file', true, true, 0, BUDGET) === true; // arranca en 0% y sigue solo

  // Contacto INALCANZABLE (se fue de internet) → NO autónomo: cae al store-and-forward de siempre (pending, espera).
  r.file_net_inalcanzable_espera = _netFileAutoRetry('file', true, false, 60000, BUDGET) === false;

  // Pasado el tope de 2 h → se suelta (persistido, reanudable): no sigue reintentando para siempre.
  r.file_net_pasado_tope = _netFileAutoRetry('file', true, true, BUDGET + 1, BUDGET) === false;
  r.file_net_justo_en_tope = _netFileAutoRetry('file', true, true, BUDGET, BUDGET) === false; // estricto: elapsed < budget

  // NO es para texto (los textos tienen su propio camino/buzón) ni para archivos por Bluetooth (BT tiene su propio manejo).
  r.texto_net_no = _netFileAutoRetry('chat', true, true, 60000, BUDGET) === false;
  r.file_bluetooth_no = _netFileAutoRetry('file', false, true, 60000, BUDGET) === false;

  // Hacen falta las tres: archivo Y por internet Y alcanzable. Faltando cualquiera, no es autónomo.
  r.sin_net_no = _netFileAutoRetry('file', false, true, 1000, BUDGET) === false;
  r.sin_alcanzable_no = _netFileAutoRetry('file', true, false, 1000, BUDGET) === false;

  // Coerción robusta (reachable podría llegar como 1/0): 1 → true, 0 → false.
  r.coercion_1_true = _netFileAutoRetry('file', 1, 1, 1000, BUDGET) === true;
  r.coercion_0_false = _netFileAutoRetry('file', true, 0, 1000, BUDGET) === false;

  const ok = Object.keys(r).filter((k) => k !== 'prueba' && k !== 'resultado').every((k) => r[k] === true);
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('NETFILEAUTO ' + JSON.stringify(r));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('NETFILEAUTO {"resultado":"FALLO","error":"' + String(e && e.message) + '"}'); process.exit(1); });
