// Scan rápido, cupo reservado (#dueño 08-11: «cuidado con no sobrepasarse del límite de escaneos repetidos para que
// Android no nos tache»). Android deja de dar resultados con >5 startScan/30 s. La defensa es una ventana deslizante con
// un tope. _scanWindowFullAt(count, max) dice si una fuente ya llenó su cupo. El FONDO (reconexión) usa un tope más bajo
// (_bgScanWindowMax=3) que el USUARIO (_scanWindowMax=4): así SIEMPRE queda un hueco libre para el escaneo del usuario y
// «Agregar» nunca se difiere por culpa del fondo. Prueba de la función pura. Uso: node scancupo.js [dir_build]
'use strict';
const { importSrc } = require('./srcmod');

(async () => {
  const r = { prueba: 'scancupo' };
  const { _scanWindowFullAt } = await importSrc('ui/ble_helpers.js');

  const BG = 3;   // _bgScanWindowMax (fondo)
  const USER = 4; // _scanWindowMax (usuario)

  // El tope manda: lleno cuando count >= max.
  r.fondo_lleno_en_3 = _scanWindowFullAt(3, BG) === true && _scanWindowFullAt(2, BG) === false;
  r.usuario_lleno_en_4 = _scanWindowFullAt(4, USER) === true && _scanWindowFullAt(3, USER) === false;

  // CUPO RESERVADO: en el punto donde el fondo ya cedió (count=3), el usuario todavía puede arrancar.
  r.hueco_reservado = _scanWindowFullAt(3, BG) === true && _scanWindowFullAt(3, USER) === false;

  // Nunca se pasa del límite real de Android (5): ni el usuario arranca con la ventana llena de verdad.
  r.usuario_no_pasa_limite = _scanWindowFullAt(4, USER) === true && _scanWindowFullAt(5, USER) === true;

  // bg < user ⇒ el fondo cede antes; para todo count, si el usuario está lleno el fondo también (nunca al revés).
  let invariante = true;
  for (let c = 0; c <= 8; c++) {
    if (_scanWindowFullAt(c, USER) && !_scanWindowFullAt(c, BG)) invariante = false; // usuario lleno pero fondo no: imposible
  }
  r.fondo_cede_antes = invariante === true;

  // Monótona y robusta ante basura (cuenta/tope ausentes ⇒ 0, no llena salvo max=0).
  r.monotona = _scanWindowFullAt(2, 3) === false && _scanWindowFullAt(3, 3) === true;
  r.sin_dato = _scanWindowFullAt(undefined, 3) === false && _scanWindowFullAt(null, 4) === false;

  const ok = Object.keys(r).filter((k) => k !== 'prueba' && k !== 'resultado').every((k) => r[k] === true);
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('SCANCUPO ' + JSON.stringify(r));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('SCANCUPO {"resultado":"FALLO","error":"' + String(e && e.message) + '"}'); process.exit(1); });
