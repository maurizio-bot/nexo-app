// Lentitud en Bluetooth / «audio no sale» por internet (dos WiFi) — diagnósticos del dueño 08-11 (00:47 y 01:07).
// Hallazgo: un respaldo Fénix EN VUELO a un enlace Bluetooth atascado (MTU 23) seguía martillando la cola nativa
// («Cola de escritura llena» / «mensaje descartado entero») hasta ~5 min por segmento (BUSY_MAX_WAITS), tapando la
// radio y el hilo JS → el audio por internet tardaba ~1 min en salir y la UI parecía clavada. En el log, los enlaces
// martillados (5ab50526519b, 65916ff3aabc, 6a14d9595cff) recibían SIEMPRE transferencias Fénix (fxs_…/fx_…, type=fenix);
// lo del usuario iba por net:. Las rondas 2951/2952/2954 frenan al ELEGIR/REANUDAR, pero NO a un stream ya corriendo.
// 2956: un respaldo de FONDO (meta.type==='fenix') sobre un Bluetooth ya marcado atascado (_bleCongested) se RINDE al
// toque en el bucle de trozos (queda pendiente; Fénix tiene redundancia y el resume lo reintenta luego o por internet).
// Lo del usuario (texto/foto/archivo) NUNCA entra acá: mantiene toda la paciencia de #129. Prueba de la función pura
// _fenixYieldBle (la decisión). Uso: node fenixyield.js [dir_build]
'use strict';
const { importSrc } = require('./srcmod');

(async () => {
  const r = { prueba: 'fenixyield' };
  const { _fenixYieldBle } = await importSrc('ui/ble_ack.js');

  // El CASO DEL BUG: respaldo Fénix, por Bluetooth, enlace atascado → se rinde (true). Es lo que paraba la radio.
  r.fenix_bt_atascado_rinde = _fenixYieldBle('fenix', true, true) === true;

  // Enlace Bluetooth SANO (no atascado): el respaldo Fénix sigue — no hay que rendir en un enlace bueno.
  r.fenix_bt_sano_sigue = _fenixYieldBle('fenix', true, false) === false;

  // Fénix por INTERNET (net:/lan: → deviceIsBle=false): no hay cola MTU-23 que tapar → nunca se rinde por esto.
  r.fenix_net_no_rinde = _fenixYieldBle('fenix', false, true) === false;

  // LO DEL USUARIO nunca se rinde por acá, aunque el Bluetooth esté atascado: mantiene la paciencia de #129.
  r.usuario_archivo_mantiene = _fenixYieldBle('file', true, true) === false;
  r.usuario_texto_mantiene = _fenixYieldBle('chat', true, true) === false;
  r.usuario_imagen_mantiene = _fenixYieldBle('image', true, true) === false;

  // Sin tipo (undefined/null) = no es Fénix → no se rinde.
  r.sin_tipo_no_rinde = _fenixYieldBle(undefined, true, true) === false && _fenixYieldBle(null, true, true) === false;

  // Hace falta que SE den las tres: Fénix Y Bluetooth Y atascado. Faltando cualquiera, no se rinde.
  r.fenix_sin_atasco_no = _fenixYieldBle('fenix', true, false) === false;
  r.fenix_sin_bt_no = _fenixYieldBle('fenix', false, true) === false;

  // Coerción robusta (congested podría llegar como 1/0 desde un Map.get): 1 → true, 0 → false.
  r.coercion_1_true = _fenixYieldBle('fenix', true, 1) === true;
  r.coercion_0_false = _fenixYieldBle('fenix', true, 0) === false;

  const ok = Object.keys(r).filter((k) => k !== 'prueba' && k !== 'resultado').every((k) => r[k] === true);
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('FENIXYIELD ' + JSON.stringify(r));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('FENIXYIELD {"resultado":"FALLO","error":"' + String(e && e.message) + '"}'); process.exit(1); });
