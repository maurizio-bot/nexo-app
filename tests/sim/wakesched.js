// Build 2967 — Fase A de la entrega offline (docs/CONTRATOS_ENTREGA_OFFLINE_FASE_AB.md §1 y §6; dueño 09-11: «Luz verde.
// Arrancá la Fase A»). Antes el «toque» FCM a un contacto dormido salía SOLO al abrir su chat: un archivo/mensaje a alguien
// offline quedaba ⏳ sin que nadie lo despertara. Ahora cada contacto con PENDIENTES y sin enlace entra a un calendario de
// toques con freno creciente (30 s → 2 m → 8 m → 30 m → 2 h → 6 h techo, jitter ±20 %) y se RINDE al techo (20 toques
// seguidos o min(TTL, 7 días)) → PASSIVE explícito: deja de tocar activo, el ⏳ sigue y al abrir su chat se re-dispara.
// Pedido del dueño: el calendario queda A LA VISTA en la salida (timestamps esperados + intervalos) para que «no spamea»
// sea inequívoco. Dos capas: (1) las funciones puras del calendario (ble_helpers) y (2) el tick del supervisor
// (ble_connections._tickWakePending) con `this` falso, reloj y azar inyectados — sin red ni DOM.
// Uso: node wakesched.js [dir_build]
'use strict';
const { importSrc } = require('./srcmod');

(async () => {
  const r = { prueba: 'wakesched' };
  const H = await importSrc('ui/ble_helpers.js');
  const { BLE_CONNECTION_METHODS } = await importSrc('ui/ble_connections.js');
  const { WAKE_BACKOFF_MS, WAKE_MAX_FAILS, WAKE_GIVEUP_MS, _wakeBackoffMs, _wakeJitter, _wakeGaveUp, _wakeNewEntry, _wakeShouldFire, _wakeAdvance } = H;
  const S = 1000, M = 60 * S, HR = 60 * M, D = 24 * HR;
  const fmt = (ms) => {
    var s = Math.round(ms / 1000), out = '';
    var d = Math.floor(s / 86400); s -= d * 86400;
    var h = Math.floor(s / 3600); s -= h * 3600;
    var m = Math.floor(s / 60); s -= m * 60;
    if (d) out += d + 'd';
    if (h || d) out += h + 'h';
    if (m || h || d) out += m + 'm';
    return out + s + 's';
  };

  // --- 1) Constantes del contrato (§1) ---
  r.constantes = JSON.stringify(WAKE_BACKOFF_MS) === JSON.stringify([30 * S, 2 * M, 8 * M, 30 * M, 2 * HR, 6 * HR]) &&
    WAKE_MAX_FAILS === 20 && WAKE_GIVEUP_MS === 7 * D;

  // --- 2) Freno base por intento (1-indexado); se queda en el techo de 6 h ---
  var base = [];
  for (var i = 1; i <= 8; i++) base.push(_wakeBackoffMs(i));
  r.freno_base = JSON.stringify(base) === JSON.stringify([30 * S, 2 * M, 8 * M, 30 * M, 2 * HR, 6 * HR, 6 * HR, 6 * HR]);
  r.freno_intento_raro = _wakeBackoffMs(0) === 30 * S && _wakeBackoffMs(undefined) === 30 * S && _wakeBackoffMs(-3) === 30 * S &&
    _wakeBackoffMs(1000) === 6 * HR;

  // --- 3) Jitter ±20 %: determinista con rnd inyectado; acotado con rnd al azar ---
  r.jitter_bordes = _wakeJitter(100000, 0) === 80000 && _wakeJitter(100000, 1) === 120000 && _wakeJitter(100000, 0.5) === 100000;
  var enRango = true;
  for (var j = 0; j < 2000; j++) { var v = _wakeJitter(6 * HR); if (v < 0.8 * 6 * HR || v > 1.2 * 6 * HR) enRango = false; }
  r.jitter_en_rango = enRango;

  // --- 4) CALENDARIO inspeccionable. Simula la vida de una entrada saltando al próximo instante programado (nunca antes). ---
  function calendario(rnd, giveUpMs) {
    var t = 0, e = _wakeNewEntry(t), fires = [];
    for (var guard = 0; guard < 100; guard++) {
      var d = _wakeShouldFire(e, t, giveUpMs);
      if (d === 'passive') return { fires: fires, passiveAt: t, attempt: e.attempt };
      if (d === 'wait') { t = e.nextAt; continue; }
      fires.push(t);
      e = _wakeAdvance(e, t, rnd);
    }
    return { fires: fires, passiveAt: null, attempt: e.attempt };
  }
  // Esperado con jitter neutro (rnd = 0,5 → intervalo = base exacta): acumulado de 30 s, 2 m, 8 m, 30 m, 2 h y luego 6 h fijo.
  var esperado = [0, 30 * S, 150 * S, 630 * S, 2430 * S, 9630 * S];
  for (var k = 7; k <= 20; k++) esperado.push(esperado[k - 2] + 6 * HR);
  var neutro = calendario(0.5, WAKE_GIVEUP_MS);
  var deltas = neutro.fires.slice(1).map((t, idx) => t - neutro.fires[idx]);
  r.calendario_neutro = neutro.fires.map(fmt); // informativo (a la vista)
  r.intervalos_neutro = deltas.map(fmt); // informativo
  r.calendario_20_toques = neutro.fires.length === 20 && JSON.stringify(neutro.fires) === JSON.stringify(esperado);
  r.passive_tras_20 = neutro.passiveAt !== null && neutro.attempt === 20 && neutro.passiveAt === esperado[19];
  r.duracion_total = fmt(neutro.passiveAt); // informativo: ~3d14h40m30s (el tope de 20 toques llega antes que los 7 días)
  r.no_spamea_min_30s = deltas.length === 19 && deltas.every((d) => d >= 30 * S);
  r.freno_creciente = deltas.every((d, idx) => idx === 0 || d >= deltas[idx - 1]);
  r.techo_6h = deltas.every((d) => d <= 6 * HR) && deltas.slice(5).every((d) => d === 6 * HR);
  // Peor caso (rnd = 0 → todo ×0,8, lo MÁS rápido posible): sigue sin spamear.
  var rapido = calendario(0, WAKE_GIVEUP_MS);
  var dR = rapido.fires.slice(1).map((t, idx) => t - rapido.fires[idx]);
  r.peor_caso_min_24s = dR.length === 19 && dR.every((d) => d >= 24 * S) && dR[0] === 24 * S;
  r.peor_caso_1h_max_5 = rapido.fires.filter((t) => t < HR).length <= 5;
  r.peor_caso_24h_max_10 = rapido.fires.filter((t) => t < D).length <= 10;
  r.peor_caso_20_toques = rapido.fires.length === 20;
  // Caso más lento (rnd = 1 → ×1,2): también llega a 20 toques antes de los 7 días (el tope de intentos manda con TTL largo).
  r.lento_20_toques = calendario(1, WAKE_GIVEUP_MS).fires.length === 20;

  // --- 5) GIVE_UP por tiempo: min(TTL, 7 días), lo que llegue primero ---
  var e5 = { attempt: 3, firstAt: 0, nextAt: 0, passive: false };
  r.ttl_corto_rinde = _wakeShouldFire(e5, 2 * D, 2 * D) === 'passive' && _wakeShouldFire(e5, 2 * D - 1, 2 * D) === 'fire';
  r.sin_ttl_7d = _wakeShouldFire(e5, 7 * D, undefined) === 'passive' && _wakeShouldFire(e5, 7 * D - 1, undefined) === 'fire';
  r.ttl_largo_tope_7d = _wakeShouldFire(e5, 7 * D, 30 * D) === 'passive' && _wakeShouldFire(e5, 7 * D - 1, 30 * D) === 'fire';
  r.ttl_invalido_7d = _wakeShouldFire(e5, 7 * D, 0) === 'passive' && _wakeShouldFire(e5, 7 * D, -5) === 'passive' &&
    _wakeShouldFire(e5, 7 * D - 1, 0) === 'fire';
  var ttl2 = calendario(0.5, 2 * D); // blob que expira a los 2 días → corta a los 13 toques, nunca toca después del TTL
  r.ttl_corta_calendario = ttl2.fires.length === 13 && ttl2.fires.every((t) => t < 2 * D) && ttl2.passiveAt !== null && ttl2.attempt === 13;

  // --- 6) Decisiones de la entrada ---
  var e6 = _wakeNewEntry(1000);
  r.primer_toque_inmediato = _wakeShouldFire(e6, 1000) === 'fire';
  var e6b = _wakeAdvance(e6, 1000, 0.5); // 1er toque hecho → el 2.º a los 30 s
  r.espera_hasta_la_hora = _wakeShouldFire(e6b, 1000 + 29999) === 'wait' && _wakeShouldFire(e6b, 1000 + 30000) === 'fire' &&
    e6b.attempt === 1 && e6b.firstAt === 1000;
  var e6c = _wakeAdvance(_wakeAdvance(e6b, 31000, 0.5), 200000, 0.5);
  r.advance_conserva_firstAt = e6c.firstAt === 1000 && e6c.attempt === 3 && e6c.nextAt === 200000 + 8 * M;
  r.passive_pegajoso = _wakeShouldFire({ attempt: 1, firstAt: 0, nextAt: 0, passive: true }, 10 * M) === 'passive';
  r.sin_entrada_no_rompe = _wakeShouldFire(null, 0) === 'passive' && _wakeShouldFire(undefined, 0) === 'passive';
  r.rendido_por_intentos = _wakeGaveUp(20, 0, 1) === true && _wakeGaveUp(19, 0, 1) === false && _wakeGaveUp(25, 0, 1) === true;

  // --- 7) Integración: el tick del supervisor con `this` falso, reloj (Date.now) y azar (Math.random) inyectados ---
  var realNow = Date.now, realRandom = Math.random, clock = 1000000;
  Date.now = function () { return clock; };
  try {
    function mkSelf(via, wakeResult) {
      var self = { _toques: [], linkOf: function () { return via; } };
      self._wakeSleepingPeer = function (nx) { self._toques.push({ nx: nx, t: clock }); return wakeResult; };
      self._noteWakePending = BLE_CONNECTION_METHODS._noteWakePending;
      self._tickWakePending = BLE_CONNECTION_METHODS._tickWakePending;
      self._wakeStillPending = BLE_CONNECTION_METHODS._wakeStillPending; // sin bóveda (sim puro) → «sigue pendiente»
      return self;
    }
    // El toque pasa por una comprobación asíncrona (¿siguen los pendientes?): tras cada tick se drenan las microtareas.
    async function tick(s) { s._tickWakePending(); await null; await null; await null; await null; }
    // a) contacto dormido con pendientes → 1er toque en el 1er tick; los ticks de 6 s del supervisor no repiten (freno 30 s)
    var A = mkSelf('none', 'waking');
    A._noteWakePending('nxb0000002');
    await tick(A);
    r.tick_toca_al_alta = A._toques.length === 1 && A._toques[0].nx === 'nxb0000002' && A._pendingWake.get('nxb0000002').attempt === 1;
    clock += 6000; await tick(A);
    clock += 6000; await tick(A);
    r.tick_no_repite_en_6s = A._toques.length === 1;
    A._noteWakePending('nxb0000002'); // alta repetida (otro flush) NO reinicia el calendario
    r.alta_repetida_no_reinicia = A._pendingWake.get('nxb0000002').attempt === 1 && A._pendingWake.size === 1;

    // b) vida completa con ticks de 6 s durante 8 días: 20 toques EXACTOS en el calendario esperado y PASSIVE marcado UNA vez
    Math.random = function () { return 0.5; };
    var B = mkSelf('none', 'waking');
    var t0 = clock;
    B._noteWakePending('nxc0000003');
    var passiveLog = [], realLog = console.log;
    console.log = function (s) { if (typeof s === 'string' && s.indexOf('PASSIVE') >= 0) passiveLog.push(clock - t0); };
    try {
      for (var dt = 0; dt <= 8 * D; dt += 6000) { clock = t0 + dt; await tick(B); }
    } finally { console.log = realLog; }
    var rel = B._toques.map((x) => x.t - t0);
    r.supervisor_calendario = rel.map(fmt); // informativo (a la vista)
    r.supervisor_20_toques_exactos = JSON.stringify(rel) === JSON.stringify(esperado);
    var eB = B._pendingWake.get('nxc0000003');
    r.supervisor_marca_passive = !!(eB && eB.passive === true && eB.attempt === 20);
    r.supervisor_passive_una_vez_y_pronto = passiveLog.length === 1 && passiveLog[0] > esperado[19] && passiveLog[0] <= esperado[19] + 30 * S;
    r.supervisor_sin_toques_tras_passive = B._toques.length === 20;

    // c) el contacto se vuelve alcanzable (Wi-Fi) → sale de la lista sin tocar más
    var C = mkSelf('none', 'waking');
    C._noteWakePending('nxd0000004');
    clock += 60000; await tick(C);
    C.linkOf = function () { return 'wifi'; };
    clock += 60000; await tick(C);
    r.alcanzable_sale_sin_tocar = C._toques.length === 1 && !C._pendingWake.has('nxd0000004');
    // d) se vuelve alcanzable JUSTO al tocar (_wakeSleepingPeer devuelve el via) → sale
    var C2 = mkSelf('none', 'internet');
    C2._noteWakePending('nxd0000005');
    clock += 60000; await tick(C2);
    r.alcanzable_al_tocar_sale = C2._toques.length === 1 && !C2._pendingWake.has('nxd0000005');
    // k) 3088 (idea del dueño 14-11: «cada mensaje a un teléfono dormido lleva su despertador hasta que haya confirmación»; el vivo:
    //    Bluetooth sano y app dormida 40 min sin que nadie lo despertara): alcanzable por Bluetooth pero con lo suyo SIN CONFIRMAR hace
    //    rato → se le sigue tocando (con motivo, aunque haya enlace) con el mismo freno; en cuanto confirma, sale de la lista
    var K = mkSelf('bluetooth', 'waking'), whys = [], stuck = true;
    K._wakeSleepingPeer = function (nx, why) { K._toques.push({ nx: nx, t: clock }); whys.push(why); return 'waking'; };
    K._wakeStuckPending = function () { return Promise.resolve(stuck); };
    K._noteWakePending('nxk0000011');
    var tk0 = clock;
    await tick(K);
    clock = tk0 + 6000; await tick(K);
    clock = tk0 + 46000; await tick(K);
    r.k_alcanzable_sin_confirmar_sigue_tocando = K._toques.length === 2 && whys.every((w) => w === 'sin confirmar') && K._pendingWake.has('nxk0000011');
    stuck = false;
    clock = tk0 + 46000 + 130000; await tick(K);
    r.k_al_confirmar_sale = K._toques.length === 2 && !K._pendingWake.has('nxk0000011');

    // e) no se pudo tocar (sin token / sin internet → 'none') → se reintenta en el próximo tick SIN avanzar el freno ni rendirse
    var E = mkSelf('none', 'none');
    E._noteWakePending('nxe0000006');
    clock += 60000; await tick(E);
    clock += 60000; await tick(E);
    var eE = E._pendingWake.get('nxe0000006');
    r.sin_token_reintenta_sin_avanzar = E._toques.length === 2 && !!eE && eE.attempt === 0 && eE.passive === false;
    // f) contactos independientes: uno ya rendido (→ PASSIVE) no frena el toque al otro
    var F = mkSelf('none', 'waking');
    F._noteWakePending('nxf0000007');
    F._pendingWake.set('nxg0000008', { attempt: 20, firstAt: clock - 1000, nextAt: clock, passive: false });
    clock += 60000; await tick(F);
    r.independientes = F._toques.length === 1 && F._toques[0].nx === 'nxf0000007' && F._pendingWake.get('nxg0000008').passive === true;
    // g) ids inválidos (vacíos, grupos, basura) no rompen ni agregan; tick sin nada pendiente no rompe
    F._noteWakePending(null); F._noteWakePending(''); F._noteWakePending(undefined); F._noteWakePending('grupo-1234'); F._noteWakePending('nx12');
    r.id_invalido_ignorado = F._pendingWake.size === 2;
    var G = mkSelf('none', 'waking'); await tick(G);
    r.tick_vacio_ok = G._toques.length === 0 && !G._pendingWake;
    // h) lo pendiente ya se entregó por otro camino (Jump, buzón+ack con el otro en 2.º plano) → al ir a tocar se ve que no
    //    queda nada: NO toca y la entrada se va sola (no se persigue a quien ya recibió todo)
    var Hh = mkSelf('none', 'waking');
    Hh._noteWakePending('nxh0000009');
    clock += 60000; await tick(Hh); // 1er toque (aún pendiente)
    Hh._wakeStillPending = function () { return Promise.resolve(false); };
    clock += 60000; await tick(Hh); // 2.º toque programado a los 30 s: ya no hay pendientes
    r.sin_pendientes_deja_de_tocar = Hh._toques.length === 1 && !Hh._pendingWake.has('nxh0000009');
    // i) si la comprobación de pendientes FALLA (bóveda rota) se asume que sigue pendiente: toca igual (mejor un toque de más)
    var I = mkSelf('none', 'waking');
    I._noteWakePending('nxi0000010');
    I._wakeStillPending = function () { return Promise.reject(new Error('bóveda rota')).catch(function () { return true; }); };
    clock += 60000; await tick(I);
    r.boveda_rota_toca_igual = I._toques.length === 1;
    // j) 3076 (dueño 14-11: «la notificación de cuando recibo un diagnóstico»): si lo pendiente son solo cosas que no se leen
    //    (diagnóstico automático, estado, foto de perfil: ocultas), NO se toca; una copia de un mensaje de GRUPO (también oculta en
    //    el chat del que manda, pero es un mensaje para el otro) o un texto normal SÍ.
    var hadWin = typeof global.window !== 'undefined', oldWin = global.window;
    var pend = [];
    global.window = { vaultGetPendingMessages: function () { return Promise.resolve(pend.slice()); } };
    try {
      pend = [{ msgId: 'msg1aaaa', hidden: true, content: '{"type":"nexo_diag"}' }, { msgId: 'msg2bbbb', hidden: true, content: '{"type":"nexo_act","act":"st"}' }];
      var J = mkSelf('none', 'waking'); J._noteWakePending('nxj0000011'); clock += 60000; await tick(J);
      r.solo_ocultos_no_toca = J._toques.length === 0 && !J._pendingWake.has('nxj0000011');
      pend = [{ msgId: 'gm1794622257098xyz_0j000001', hidden: true, content: '{"type":"nexo_grp","g":"grabcdefgh","c":"hola"}' }];
      var K = mkSelf('none', 'waking'); K._noteWakePending('nxj0000001'); clock += 60000; await tick(K);
      r.copia_de_grupo_toca = K._toques.length === 1;
      pend = [{ msgId: 'msg3cccc', hidden: true, content: '{"type":"nexo_diag"}' }, { msgId: 'msg4dddd', content: 'hola' }];
      var L = mkSelf('none', 'waking'); L._noteWakePending('nxl0000013'); clock += 60000; await tick(L);
      r.texto_normal_toca = L._toques.length === 1;
    } finally { if (hadWin) global.window = oldWin; else delete global.window; }
  } finally { Date.now = realNow; Math.random = realRandom; }

  // Calendario a la vista (pedido del dueño): un toque por línea, con su instante y el intervalo desde el anterior.
  console.log('Calendario de toques (jitter neutro; con jitter real cada intervalo varía ±20 %):');
  neutro.fires.forEach((t, idx) => console.log('  toque ' + String(idx + 1).padStart(2) + '  +' + fmt(t).padEnd(12) +
    (idx ? ' (intervalo ' + fmt(deltas[idx - 1]) + ')' : ' (inmediato)')));
  console.log('  PASSIVE  +' + fmt(neutro.passiveAt) + '  (rendido tras 20 toques; el tope de 7 días no llegó a aplicar)');
  console.log('  peor caso (todo ×0,8): toques en la 1.ª hora = ' + rapido.fires.filter((t) => t < HR).length +
    ', en 24 h = ' + rapido.fires.filter((t) => t < D).length + ', total = ' + rapido.fires.length);

  const info = { prueba: 1, resultado: 1, calendario_neutro: 1, intervalos_neutro: 1, duracion_total: 1, supervisor_calendario: 1 };
  const ok = Object.keys(r).filter((k) => !info[k]).every((k) => r[k] === true);
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('WAKESCHED ' + JSON.stringify(r));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('WAKESCHED {"resultado":"FALLO","error":"' + String(e && e.message).replace(/"/g, "'") + '"}'); console.error(e && e.stack); process.exit(1); });
