// Scan rápido (#dueño 08-11): barritas de señal por contacto encontrado (como el wifi), para ver de un vistazo quién está
// más cerca SIN re-ordenar la lista (el orden es por aparición). _rssiToBars mapea la fuerza de señal a 1-4 barras (0 si no
// hay dato). El nativo ya descarta por debajo de -95 (MIN_RSSI). Prueba de la función pura. Uso: node rssibars.js [dir_build]
'use strict';
const { importSrc } = require('./srcmod');

(async () => {
  const r = { prueba: 'rssibars' };
  const { _rssiToBars } = await importSrc('ui/ble_helpers.js');

  // 4 barras: muy cerca (>= -60).
  r.muy_cerca_4 = _rssiToBars(-40) === 4 && _rssiToBars(-60) === 4;
  // 3 barras: cerca (-61 a -72).
  r.cerca_3 = _rssiToBars(-61) === 3 && _rssiToBars(-72) === 3;
  // 2 barras: medio (-73 a -84).
  r.medio_2 = _rssiToBars(-73) === 2 && _rssiToBars(-84) === 2;
  // 1 barra: lejos (-85 a -95).
  r.lejos_1 = _rssiToBars(-85) === 1 && _rssiToBars(-95) === 1;

  // Monótona: más cerca nunca da menos barras que más lejos.
  r.monotona = _rssiToBars(-50) >= _rssiToBars(-70) && _rssiToBars(-70) >= _rssiToBars(-90);

  // 0 (sin barritas) si no hay dato válido.
  r.sin_dato_0 = _rssiToBars(undefined) === 0 && _rssiToBars(null) === 0 && _rssiToBars(NaN) === 0 && _rssiToBars('x') === 0;

  const ok = Object.keys(r).filter((k) => k !== 'prueba' && k !== 'resultado').every((k) => r[k] === true);
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('RSSIBARS ' + JSON.stringify(r));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('RSSIBARS {"resultado":"FALLO","error":"' + String(e && e.message) + '"}'); process.exit(1); });
