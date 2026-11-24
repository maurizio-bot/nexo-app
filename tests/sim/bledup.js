// Dedup de enlaces Bluetooth repetidos al mismo NEXO (#dueño 08-11, fase «conectar» del orden del Bluetooth). Android abre
// varias conexiones a una persona (dirección BT rotativa + anunciar vs conectar); los de sobra quedan ABIERTOS y tapan la
// radio (parte de la «foto lenta de cerca»). _dupBleLinksToClose decide, dado el grupo de enlaces LISTOS a un NEXO, cuál se
// QUEDA (mejor MTU no-muerto; empate → más reciente) y cuáles CERRAR (los demás que no estén ocupados). Nunca cierra un
// enlace ocupado (transferencia / chat activo) ni el único. Prueba de la función pura. Uso: node bledup.js [dir_build]
'use strict';
const { importSrc } = require('./srcmod');

(async () => {
  const r = { prueba: 'bledup' };
  const { _dupBleLinksToClose, DUP_DECIDER_GRACE_MS } = await importSrc('ui/ble_helpers.js');
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
  // 16c: todos muertos → se cierran todos (los no ocupados) y se abre uno limpio
  r.todos_muertos_cierra_todos = same(_dupBleLinksToClose([L('A', 512, { dead: true }), L('B', 23, { dead: true })]).sort(), ['A', 'B']);
  r.todos_muertos_respeta_ocupado = same(_dupBleLinksToClose([L('A', 512, { dead: true, busy: true }), L('B', 23, { dead: true })]), ['B']);

  // 8. Muchos repetidos (el caso real: 4 enlaces a una persona) → se queda 1, se cierran los otros 3 libres.
  r.cuatro_quedan_uno = same(_dupBleLinksToClose([L('A', 512), L('B', 23), L('C', 23), L('D', 185)]), ['B', 'C', 'D']);

  // INVARIANTES: el keeper nunca se cierra; un ocupado nunca se cierra. C (300, no muerto, no ocupado) es el mejor →
  // keeper; A y B están ocupados (se respetan aunque sean repetidos); D (libre, de sobra) es el único que se cierra.
  const ej = [L('A', 100, { busy: true }), L('B', 90, { busy: true }), L('C', 300), L('D', 50)];
  const cerr = _dupBleLinksToClose(ej);
  r.nunca_cierra_ocupado = !cerr.includes('A') && !cerr.includes('B');
  r.keeper_no_se_cierra = !cerr.includes('C'); // C es el keeper (mejor MTU no muerto) → nunca se cierra
  r.cierra_solo_el_libre = same(cerr, ['D']);  // solo el repetido LIBRE se cierra

  // 10. 3327 (🔴 1, diez «zombi» del S24 el 24-11): ACUERDO EXPLÍCITO = decide solo el de NEXO ID MENOR; el mayor no cierra nada.
  //     Así nunca cierran enlaces distintos (3027/3137/3139), vea cada uno el MTU que vea.
  //     Caso real: Roberto (menor) tiene su enlace de cliente VIEJO (517, de antes de que volviera la app del S24) y el de servidor
  //     NUEVO (el cliente que el S24 abrió al volver; MTU que Roberto no conoce → 185). El S24 (mayor) ve el viejo como su servidor
  //     a MTU 23. Antes: el desempate por papel conservaba el VIEJO en los dos → dejaba de contestar pings (zombi).
  //     (contraprueba 3326: Roberto cierra el nuevo, ['nuevo'])
  const rob = [L('viejo', 517, { role: 'client', since: 100 }), L('nuevo', 185, { role: 'server', since: 900 })];
  const s24b = [L('viejo', 23, { role: 'server', since: 950 }), L('nuevo', 517, { role: 'client', since: 900 })];
  r.zombi_menor_cierra_el_viejo = same(_dupBleLinksToClose(rob, { iAmLower: true, now: 1000, waitedMs: 13000 }), ['viejo']);
  r.zombi_mayor_no_cierra = same(_dupBleLinksToClose(s24b, { iAmLower: false, now: 1000, waitedMs: 13000 }), []);
  // el mayor solo decide si el menor lleva > 3 min sin hacerlo (su app dormida), con su propia vista
  r.mayor_decide_si_el_menor_no = same(_dupBleLinksToClose(s24b, { iAmLower: false, waitedMs: DUP_DECIDER_GRACE_MS }), ['nuevo']) && DUP_DECIDER_GRACE_MS >= 120000;
  // todos muertos: los dos cierran todo (16c), también el mayor sin esperar
  r.mayor_todos_muertos = same(_dupBleLinksToClose([L('a', 517, { dead: true }), L('b', 23, { dead: true })], { iAmLower: false }), ['a', 'b']);
  // cruzados (cada uno cliente del otro, mismo MTU): solo el menor cierra; se queda el más reciente
  const ladoA = [L('enl1', 517, { role: 'client', since: 100 }), L('enl2', 517, { role: 'server', since: 900 })];
  const ladoB = [L('enl1', 517, { role: 'server', since: 900 }), L('enl2', 517, { role: 'client', since: 100 })];
  r.cruzado_un_solo_lado_cierra = same(_dupBleLinksToClose(ladoA, { iAmLower: true }), ['enl1']) && same(_dupBleLinksToClose(ladoB, { iAmLower: false }), []);
  // 3139: el S24 (mayor) veía MTU distintos; ya no cierra él: cierra Yaelito (menor) y el S24 solo ve caer uno
  const s24 = [L('5817', 517, { role: 'client', since: 100 }), L('7bf3', 23, { role: 'server', since: 50 })];
  const yae = [L('7bf3', 517, { role: 'client', since: 50 }), L('5817', 185, { role: 'server', since: 100 })];
  r.mtu_distinto_un_solo_lado = same(_dupBleLinksToClose(s24, { iAmLower: false }), []) && _dupBleLinksToClose(yae, { iAmLower: true }).length === 1;
  // 3262: con el MISMO papel se queda el más RECIENTE aunque el viejo parezca de más MTU; un muerto nunca se queda
  r.mismo_papel_queda_el_reciente = same(_dupBleLinksToClose([L('s_viejo', 185, { role: 'server', since: 100 }), L('s_nuevo', 23, { role: 'server', since: 900 })], { iAmLower: true }), ['s_viejo']);
  r.mismo_papel_reciente_muerto_no = same(_dupBleLinksToClose([L('s_viejo', 185, { role: 'server', since: 100 }), L('s_nuevo', 517, { role: 'server', since: 900, dead: true })], { iAmLower: true }), ['s_nuevo']);
  r.mismo_papel_manda_mtu = same(_dupBleLinksToClose([L('c1', 23, { role: 'client' }), L('c2', 517, { role: 'client' })], { iAmLower: true }), ['c1']);
  r.papel_muerto_no_se_queda = same(_dupBleLinksToClose([L('e1', 517, { role: 'client', dead: true }), L('e2', 517, { role: 'server' })], { iAmLower: true }), ['e1']);

  // 12. 3233 (diagnóstico S23 17-11 21:39 «zombi» con Yaelito): si el que se iba a quedar lleva > 15 s sin recibir nada y otro sí
  //     recibe, no se cierra nada ahora (el vigilante tumba al callado). (contraprueba 3232: cierra el que recibe)
  const now12 = 1000000;
  const s23 = [L('5d5b', 517, { role: 'client', since: 900, heard: now12 - 36000 }), L('6a15', 517, { role: 'server', since: 100, heard: now12 - 2000 })];
  r.no_cierra_el_que_recibe = same(_dupBleLinksToClose(s23, { iAmLower: true, now: now12 }), []);
  const ambos = [L('5d5b', 517, { role: 'client', since: 900, heard: now12 - 3000 }), L('6a15', 517, { role: 'server', since: 100, heard: now12 - 2000 })];
  r.ambos_reciben_desempate_igual = same(_dupBleLinksToClose(ambos, { iAmLower: true, now: now12 }), ['6a15']) && same(_dupBleLinksToClose(s23, { iAmLower: true }), ['6a15']);

  // 9. Robustez ante basura.
  r.sin_dato = same(_dupBleLinksToClose([]), []) && same(_dupBleLinksToClose(null), []) &&
    same(_dupBleLinksToClose([L('A', 512)]), []) && same(_dupBleLinksToClose([null, { mtu: 1 }]), []);

  const ok = Object.keys(r).filter((k) => k !== 'prueba' && k !== 'resultado').every((k) => r[k] === true);
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('BLEDUP ' + JSON.stringify(r));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('BLEDUP {"resultado":"FALLO","error":"' + String(e && e.message) + '"}'); process.exit(1); });
