// Fase 1 (internet) del contrato de los caminos: la política de relés común (src/core/ruta/politica_reles.js) da lo que dicen los vectores
// compartidos con la parte nativa (tests/vectores/politica_reles.json; RelayPolicyTest.kt prueba RelayPolicy.kt con el mismo archivo).
// Uso: node politicareles.js [dir_build]
'use strict';
const { importSrc } = require('./srcmod');
const V = require('../vectores/politica_reles.json');
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
(async () => {
  const P = await importSrc('core/ruta/politica_reles.js');
  const fallos = [];
  const chk = (fn, args, want, got) => { if (!eq(want, got)) fallos.push({ fn, args, want, got }); };
  V.tipoLimite.forEach(([m, w]) => chk('tipoLimite', [m], w, P.tipoLimite(m)));
  V.pausaMs.forEach(([k, n, w]) => chk('pausaMs', [k, n], w, P.pausaMs(k, n)));
  V.anotarLimite.forEach((c) => chk('anotarLimite', [c.prev, c.msg, c.now], c.out, P.anotarLimite(c.prev, c.msg, c.now)));
  V.juntarPausas.forEach((c) => chk('juntarPausas', [c.a, c.b, c.now], c.out, P.juntarPausas(c.a, c.b, c.now)));
  V.lecturasDe.forEach((c) => chk('lecturasDe', [c.anuncio, c.pool, c.now], c.out, P.lecturasDe(c.anuncio, c.pool, c.now)));
  V.destinos.forEach((c) => chk('destinos', [c._], c.out, P.destinos(c.relays, c.lee, c.now)));
  V.daGuardado.forEach(([u, l, w]) => chk('daGuardado', [u, l], w, P.daGuardado(u, l)));
  // la app usa ESTA política (no una copia): net_publish re-exporta las mismas funciones
  const NP = await importSrc('net/net_publish.js');
  const misma = NP.relayLimitKind === P.tipoLimite && NP.relayCoolMs === P.pausaMs;
  if (!misma) fallos.push({ fn: 'net_publish usa la política común', want: true, got: false });
  const r = { prueba: 'politicareles', vectores: V.tipoLimite.length + V.pausaMs.length + V.anotarLimite.length + V.juntarPausas.length + V.lecturasDe.length + V.destinos.length + V.daGuardado.length, fallos, resultado: fallos.length ? 'FALLO' : 'OK' };
  console.log('POLITICARELES ' + JSON.stringify(r));
  process.exit(fallos.length ? 1 : 0);
})().catch((e) => { console.log('POLITICARELES {"resultado":"FALLO","error":' + JSON.stringify(String(e && e.stack)) + '}'); process.exit(1); });
