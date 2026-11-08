// Dedup de enlaces Bluetooth repetidos al mismo NEXO (#dueño 08-11, fase «conectar» del orden del Bluetooth). Android abre
// varias conexiones a una persona (dirección BT rotativa + anunciar vs conectar); los de sobra quedan ABIERTOS y tapan la
// radio (parte de la «foto lenta de cerca»). _dupBleLinksToClose decide, dado el grupo de enlaces LISTOS a un NEXO, cuál se
// QUEDA (mejor MTU no-muerto; empate → más reciente) y cuáles CERRAR (los demás que no estén ocupados). Nunca cierra un
// enlace ocupado (transferencia / chat activo) ni el único. Prueba de la función pura. Uso: node bledup.js [dir_build]
'use strict';
const { importSrc } = require('./srcmod');

(async () => {
  const r = { prueba: 'bledup' };
  const { _dupBleLinksToClose } = await importSrc('ui/ble_helpers.js');
  const L = (key, mtu, opts) => Object.assign({ key, mtu, dead: false, since: 0, busy: false }, opts || {});
  const same = (a, b) => a.length === b.length && a.slice().sort().join(',') === b.slice().sort().join(',');

  // 1. Dos enlaces sanos, distinto MTU → se queda el de MÁS MTU, se cierra el bajo.
  r.cierra_el_lento = same(_dupBleLinksToClose([L('A', 512), L('B', 23)]), ['B']);

  // 2. Uno sano (alto) + uno MUERTO (bajo) → se cierra el muerto, se queda el sano.
  r.cierra_el_muerto = same(_dupBleLinksToClose([L('A', 512), L('B', 23, { dead: true })]), ['B']);

  // 3. Un solo enlace → no se cierra nada (nunca dejar sin camino).
  r.uno_no_se_toca = same(_dupBleLinksToClose([L('A', 23)]), []);

  // 4. NUNCA cerrar uno OCUPADO: mejor (A) + ocupado bajo (B) + libre bajo (C) → solo se cierra C.
  r.respeta_ocupado = same(_dupBleLinksToClose([L('A', 512), L('B', 23, { busy: true }), L('C', 23)]), ['C']);

  // 5. El keeper puede estar OCUPADO: se queda igual (mejor MTU, ocupado) y se cierra el libre de sobra.
  r.keeper_ocupado_ok = same(_dupBleLinksToClose([L('A', 512, { busy: true }), L('B', 23)]), ['B']);

  // 6. Empate de MTU → se queda el MÁS RECIENTE (mayor since), se cierra el viejo.
  r.empate_por_reciente = same(_dupBleLinksToClose([L('A', 185, { since: 100 }), L('B', 185, { since: 900 })]), ['A']);

  // 7. TODOS muertos → igual se conserva uno (el de más MTU) y se cierra el otro (bajar congestión).
  r.todos_muertos_queda_uno = same(_dupBleLinksToClose([L('A', 512, { dead: true }), L('B', 23, { dead: true })]), ['B']);

  // 8. Muchos repetidos (el caso real: 4 enlaces a una persona) → se queda 1, se cierran los otros 3 libres.
  r.cuatro_quedan_uno = same(_dupBleLinksToClose([L('A', 512), L('B', 23), L('C', 23), L('D', 185)]), ['B', 'C', 'D']);

  // INVARIANTES: el keeper nunca se cierra; un ocupado nunca se cierra. C (300, no muerto, no ocupado) es el mejor →
  // keeper; A y B están ocupados (se respetan aunque sean repetidos); D (libre, de sobra) es el único que se cierra.
  const ej = [L('A', 100, { busy: true }), L('B', 90, { busy: true }), L('C', 300), L('D', 50)];
  const cerr = _dupBleLinksToClose(ej);
  r.nunca_cierra_ocupado = !cerr.includes('A') && !cerr.includes('B');
  r.keeper_no_se_cierra = !cerr.includes('C'); // C es el keeper (mejor MTU no muerto) → nunca se cierra
  r.cierra_solo_el_libre = same(cerr, ['D']);  // solo el repetido LIBRE se cierra

  // 9. Robustez ante basura.
  r.sin_dato = same(_dupBleLinksToClose([]), []) && same(_dupBleLinksToClose(null), []) &&
    same(_dupBleLinksToClose([L('A', 512)]), []) && same(_dupBleLinksToClose([null, { mtu: 1 }]), []);

  const ok = Object.keys(r).filter((k) => k !== 'prueba' && k !== 'resultado').every((k) => r[k] === true);
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('BLEDUP ' + JSON.stringify(r));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('BLEDUP {"resultado":"FALLO","error":"' + String(e && e.message) + '"}'); process.exit(1); });
