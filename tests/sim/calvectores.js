// Fase 1 del contrato de los caminos (A.7.2 [RIESGO] «la copia Kotlin de lo mecánico puede separarse de JS: los vectores compartidos son
// obligatorios»): el calendario por mensaje, el cupo por relé y los toques degradados (src/core/ruta/calendario.js, reles_puntos.js,
// contacto_ruta.js) dan lo que dicen tests/vectores/calendario.json; RutaCalendarioTest.kt prueba RutaCalendario.kt con el MISMO archivo.
// Uso: node calvectores.js [dir_build]
'use strict';
const { importSrc } = require('./srcmod');
const V = require('../vectores/calendario.json');
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
(async () => {
  const C = await importSrc('core/ruta/calendario.js'), R = await importSrc('core/ruta/contacto_ruta.js'), PU = await importSrc('core/ruta/reles_puntos.js');
  const fallos = [], chk = (fn, args, want, got) => { if (!eq(want, got)) fallos.push({ fn, args, want, got }); };
  V.espera.forEach(([b, n, r, w]) => chk('espera', [b, n, r], w, C.espera(b, n, r)));
  V.siguienteTrasFallo.forEach((c) => chk('siguienteTrasFallo', [c.tipo, c.n, c.usados, c.r], c.out, C.siguienteTrasFallo(c.tipo, c.n, c.usados, c.now, c.r)));
  V.toqueAt.forEach(([g, i, w]) => { const t = C.toqueAt(g, i); chk('toqueAt', [g, i], w, t === Infinity ? -1 : t); });
  V.sinAckMs.forEach(([p, w]) => chk('sinAckMs', [p], w, C.sinAckMs(p)));
  V.cabeSobre.forEach((c) => chk('cabeSobre', [c.salidas], c.out, C.cabeSobre(c.salidas, c.now)));
  V.juntar.forEach((c) => chk('juntar', [c.lista.length], c.out, C.juntar(c.lista)));
  V.cupoPorMin.forEach(([l, n, w]) => chk('cupoPorMin', [l, n], w, PU.cupoPorMin(l, n)));
  V.toqueDegradado.forEach(([p, o, w]) => chk('toqueDegradado', [p, o], w, R.toqueDegradado(p, o)));
  V.tocar.forEach((c) => { const cr = R.nuevo('B'); cr.fcm = { tiene: c.tiene, degradado: c.degradado }; cr.despierto = c.despierto; chk('tocar', [c], c.out, R.tocar(cr, c.tipo, c.primero)); });
  const n = Object.keys(V).filter((k) => k !== '_').reduce((a, k) => a + V[k].length, 0);
  const r = { prueba: 'calvectores', vectores: n, fallos, resultado: fallos.length ? 'FALLO' : 'OK' };
  console.log('CALVECTORES ' + JSON.stringify(r));
  process.exit(fallos.length ? 1 : 0);
})().catch((e) => { console.log('CALVECTORES ' + JSON.stringify({ prueba: 'calvectores', resultado: 'FALLO', error: String(e && e.stack).slice(0, 400) })); process.exit(1); });
