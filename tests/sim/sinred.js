// 3266 (COLA 27; S24 y Motorola 20-11 14:07–14:09: 2 min 17 s sin internet con un Wi-Fi sin salida): cuándo se avisa al teléfono de que
// el Wi-Fi no da internet (función pura noNetStep). Uso: node sinred.js [dir_build]
'use strict';
const { importSrc } = require('./srcmod');
(async () => {
  const { noNetStep, NO_NET_AFTER_MS, NO_NET_EVERY_MS } = await importSrc('net/net_link_shared.js');
  const r = { prueba: 'sinred' };
  let st = {};
  r.con_reles_no = noNetStep(st, true, true, 0) === false && noNetStep(st, true, true, 60000) === false;
  st = {};
  r.primer_corte_espera = noNetStep(st, false, true, 1000) === false;                       // empieza a contar
  r.antes_del_plazo_no = noNetStep(st, false, true, 1000 + NO_NET_AFTER_MS - 1) === false;
  r.pasado_el_plazo_avisa = noNetStep(st, false, true, 1000 + NO_NET_AFTER_MS) === true;
  r.no_repite_enseguida = noNetStep(st, false, true, 1000 + NO_NET_AFTER_MS + 15000) === false;
  r.repite_al_minuto = noNetStep(st, false, true, 1000 + NO_NET_AFTER_MS + NO_NET_EVERY_MS) === true;
  st = {};
  r.con_datos_moviles_nunca = [0, 15000, 30000, 90000].every((t) => noNetStep(st, false, false, t) === false);
  st = {};
  noNetStep(st, false, true, 0);
  r.si_vuelven_los_reles_se_olvida = noNetStep(st, true, true, 5000) === false && noNetStep(st, false, true, 20000) === false && noNetStep(st, false, true, 20000 + NO_NET_AFTER_MS) === true;
  r.un_repaso_basta = NO_NET_AFTER_MS < 15000;                                               // el repaso es cada 15 s: al segundo ya avisa
  r.resultado = Object.keys(r).every((k) => k === 'prueba' || r[k] === true) ? 'OK' : 'FALLO';
  console.log('SINRED ' + JSON.stringify(r));
  process.exit(r.resultado === 'OK' ? 0 : 1);
})();
