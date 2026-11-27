// 3259 (dueño 20-11: «revisar red por red: velocidad de conexión, de transporte, capacidad y fallas recurrentes; ya no es resolver, es pulir»):
// el diagnóstico lleva, por camino al salir, cuántos mensajes salieron, cuántos llegaron (✓✓) y en cuánto tiempo, y los síntomas del día por tipo.
//  R1  una ✓✓ en 0,4 s por Bluetooth y otra en 40 s por internet quedan en su cubeta y con su media; lo que sigue sin ✓✓ se cuenta aparte
//  R2  la ✓✓ con la app dormida no cuenta como tiempo de la red (solo «con la app dormida»)
//  R3  de punta a punta: diag_state anota «salió» al ver el primer estado y «llegó» con la primera ✓✓ (la repetida no suma otra vez)
//  R4  los síntomas del día se cuentan por tipo (nexo:diag:symptom)
//  R5  basura: vía desconocida o tiempo raro no rompe ni suma
// Uso: node redesmedidas.js [dir_build]
'use strict';
const { importSrc } = require('./srcmod');

(async () => {
  const r = { prueba: 'redesmedidas' };
  const noop = () => {};
  const mem = {};
  global.localStorage = { getItem: (k) => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); }, removeItem: (k) => { delete mem[k]; } };
  global.window = global; global.window.removeEventListener = noop; global.window.dispatchEvent = noop;
  const listeners = {};
  global.window.addEventListener = (ev, fn) => { (listeners[ev] = listeners[ev] || []).push(fn); };
  global.document = { addEventListener: noop, removeEventListener: noop, visibilityState: 'visible' };
  global.window.Capacitor = { Plugins: {} };
  const olog = console.log; console.log = noop;
  try {
    const us = await importSrc('ui/usage_stats.js');
    const ds = await importSrc('ui/diag_state.js');
    const lines = () => us.usageSpeedLines().join('\n');
    // R1
    us.usageNoteSent('bluetooth'); us.usageNoteDelivered('bluetooth', 400);
    us.usageNoteSent('internet'); us.usageNoteDelivered('internet', 40000);
    us.usageNoteSent('internet'); // sin ✓✓ aún
    let L = lines();
    r.R1_bt = /Bluetooth: salieron 1, con ✓✓ 1 · <1 s 1, <5 s 0, <30 s 0, más 0 · media 0,4 s, máx\. 0,4 s/.test(L);
    r.R1_internet = /internet: salieron 2, con ✓✓ 1 \(1 sin ✓✓ aún\) · <1 s 0, <5 s 0, <30 s 0, más 1 · media 40 s, máx\. 40 s/.test(L);
    // R2
    us.usageNoteSent('wifi'); us.usageNoteDelivered('wifi', -1);
    L = lines();
    r.R2 = /Wi-Fi \(local o Wi-Fi Direct\): salieron 1, con ✓✓ 1 · con la app dormida 1/.test(L) && !/Wi-Fi \(local o Wi-Fi Direct\): salieron 1, con ✓✓ 1 · <1 s/.test(L);
    // R4
    ['zombi', 'zombi', 'enlace_abre_cierra'].forEach((k) => us.usageNoteSymptom(k));
    // el listener real
    us.usageInit(); (listeners['nexo:diag:symptom'] || []).forEach((fn) => fn({ detail: { kind: 'entrega_lenta' } }));
    L = lines();
    r.R4 = /síntomas de hoy: zombi ×2, enlace_abre_cierra ×1, entrega_lenta ×1/.test(L);
    // R3: diag_state de punta a punta
    const before = lines();
    window.bleInterface = { linkOf: () => 'bluetooth', _macToNexoId: new Map([['aabbccddee01', 'nx1aaaaaaa']]), ackSystem: { pendingAcks: new Map([['msg123456789abcd', { deviceId: 'AA:BB:CC:DD:EE:01' }]]) } };
    ds.diagStateInit();
    const st = listeners['nexo:ble:ackStatus'] || [];
    const fire = (status) => st.forEach((fn) => fn({ detail: { msgId: 'msg123456789abcd', status } }));
    fire('sending'); fire('delivered'); fire('delivered'); fire('read');
    L = lines();
    r.R3_hay_listener = st.length > 0;
    r.R3_salio_y_llego = /Bluetooth: salieron 2, con ✓✓ 2/.test(L) && /<1 s 2, <5 s 0/.test(L.split('\n').find((x) => /Bluetooth: salieron/.test(x)) || '');
    r.R3_repetida_no_suma = /Bluetooth: salieron 2, con ✓✓ 2/.test(L) && !/con ✓✓ 3/.test(L);
    // R6 (dueño 26-11: «sin camino al salir» con 13 sin ✓✓): salió sin camino y pasó directo a «leído» (el otro tenía el chat abierto): cuenta como llegado
    window.bleInterface.linkOf = () => 'none'; window.bleInterface.ackSystem.pendingAcks.set('msg6sincamino0001', { deviceId: 'AA:BB:CC:DD:EE:01' });
    st.forEach((fn) => fn({ detail: { msgId: 'msg6sincamino0001', status: 'pending' } })); st.forEach((fn) => fn({ detail: { msgId: 'msg6sincamino0001', status: 'read' } }));
    r.R6_leido_sin_entregado_cuenta = /sin camino al salir: salieron 1, con ✓✓ 1/.test(lines());
    window.bleInterface.linkOf = () => 'bluetooth';
    // R5
    const b5 = lines();
    us.usageNoteSent('marte'); us.usageNoteDelivered('marte', 5); us.usageNoteDelivered('bluetooth', NaN); us.usageNoteSymptom('');
    r.R5 = (() => { const l5 = lines(); return l5.replace(/con ✓✓ \d+/g, '') !== undefined && !/marte/.test(l5) && /Bluetooth: salieron 2, con ✓✓ 3/.test(l5); })();
    r.antes_vacio_de_marte = !/marte/.test(b5);
  } finally { console.log = olog; }
  const ok = Object.keys(r).filter((k) => k !== 'prueba' && k !== 'resultado').every((k) => r[k] === true);
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('REDESMEDIDAS ' + JSON.stringify(r));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('REDESMEDIDAS {"resultado":"FALLO","error":"' + String(e && e.stack || e).replace(/"/g, "'").slice(0, 500) + '"}'); process.exit(1); });
