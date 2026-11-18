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

  // 10. 3027 (S24↔Motorola 12-11, «enlace_abre_cierra» en los DOS): cada teléfono es cliente del otro → dos enlaces físicos
  //     (enl1 = A cliente→B servidor; enl2 = B cliente→A servidor), mismo MTU. Cada lado ve los dos con papeles invertidos y
  //     «since» distintos. Los dos deben cerrar el MISMO enlace físico (si no, se caen ambos y vuelta a empezar).
  //     (contraprueba 3026: el desempate «más reciente» elige enlaces distintos a cada lado)
  const ladoA = [L('enl1', 517, { role: 'client', since: 100 }), L('enl2', 517, { role: 'server', since: 900 })];
  const ladoB = [L('enl1', 517, { role: 'server', since: 900 }), L('enl2', 517, { role: 'client', since: 100 })];
  const cA = _dupBleLinksToClose(ladoA, { iAmLower: true }), cB = _dupBleLinksToClose(ladoB, { iAmLower: false });
  r.cruzado_cierran_el_mismo = cA.length === 1 && same(cA, cB);
  r.cruzado_queda_cliente_del_menor = same(cA, ['enl2']);
  // 11. 3139 (diagnóstico automático S24 3069 16-11 00:52, «zombi» con Yaelito 3070): NO es verdad que los dos vean el mismo MTU
  //     del mismo enlace: el S24 veía su enlace de cliente a 517 y el de servidor más bajo; por el MTU cerró el de servidor, y
  //     Yaelito (NEXO ID menor), por el papel, cerró el otro → el S24 mandaba por un enlace que el otro ya había cerrado (texto
  //     largo sin confirmar 8 veces, puente que no abre, «sin respuesta a 2 pings»), mientras lo de Yaelito entraba por el bueno.
  //     Con papeles distintos manda el desempate común (el mismo enlace físico en los dos), no el MTU que cada uno cree ver.
  //     (contraprueba 3137: cada lado cierra un enlace distinto)
  const s24 = [L('5817', 517, { role: 'client', since: 100 }), L('7bf3', 23, { role: 'server', since: 50 })];
  const yae = [L('7bf3', 517, { role: 'client', since: 50 }), L('5817', 185, { role: 'server', since: 100 })];
  const cS24 = _dupBleLinksToClose(s24, { iAmLower: false }), cYae = _dupBleLinksToClose(yae, { iAmLower: true });
  r.mtu_distinto_cierran_el_mismo = cS24.length === 1 && same(cS24, cYae) && same(cS24, ['5817']);
  // con el mismo papel (dos enlaces de cliente, dirección rotativa) sí manda el MTU
  r.mismo_papel_manda_mtu = same(_dupBleLinksToClose([L('c1', 23, { role: 'client' }), L('c2', 517, { role: 'client' })], { iAmLower: true }), ['c1']);
  // y un enlace MUERTO nunca se queda aunque sea el del papel preferido
  r.papel_muerto_no_se_queda = same(_dupBleLinksToClose([L('e1', 517, { role: 'client', dead: true }), L('e2', 517, { role: 'server' })], { iAmLower: true }), ['e1']);

  // 12. 3233 (diagnóstico S23 17-11 21:39 «zombi» con Yaelito): por el desempate común el S23 cerró el ENTRANTE —el único que
  //     seguía recibiendo— y se quedó con el saliente, callado desde hacía 36 s → 4 pings sin respuesta y reconexión. Si el que
  //     se iba a quedar lleva > 15 s sin recibir nada y otro sí recibe, no se cierra nada ahora (el vigilante tumba al callado).
  //     (contraprueba 3232: cierra el que recibe)
  const now12 = 1000000;
  const s23 = [L('5d5b', 517, { role: 'client', heard: now12 - 36000 }), L('6a15', 517, { role: 'server', heard: now12 - 2000 })];
  r.no_cierra_el_que_recibe = same(_dupBleLinksToClose(s23, { iAmLower: true, now: now12 }), []);
  // si los dos reciben, el desempate común sigue igual (y sin «now», como antes)
  const ambos = [L('5d5b', 517, { role: 'client', heard: now12 - 3000 }), L('6a15', 517, { role: 'server', heard: now12 - 2000 })];
  r.ambos_reciben_desempate_igual = same(_dupBleLinksToClose(ambos, { iAmLower: true, now: now12 }), ['6a15']) && same(_dupBleLinksToClose(s23, { iAmLower: true }), ['6a15']);

  // 9. Robustez ante basura.
  r.sin_dato = same(_dupBleLinksToClose([]), []) && same(_dupBleLinksToClose(null), []) &&
    same(_dupBleLinksToClose([L('A', 512)]), []) && same(_dupBleLinksToClose([null, { mtu: 1 }]), []);

  const ok = Object.keys(r).filter((k) => k !== 'prueba' && k !== 'resultado').every((k) => r[k] === true);
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('BLEDUP ' + JSON.stringify(r));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('BLEDUP {"resultado":"FALLO","error":"' + String(e && e.message) + '"}'); process.exit(1); });
