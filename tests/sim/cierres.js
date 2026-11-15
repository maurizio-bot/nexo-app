// 3120 — Cierres de la app y datos de NEXO en el diagnóstico («build forense» pendiente desde el 11-11; el 15-11 el dueño vio en su S24
// «NEXO se bloqueó más de 10 veces en la última semana» y el diagnóstico no decía nada). Prueba de UNIDAD con un nativo de prueba:
//  C1  el diagnóstico lista los cierres de 7 días con su motivo, marca ⚠ los problemas, muestra el hilo principal de una congelada y los
//      fallos guardados al caer;
//  C2  un cierre con problema nuevo (últimas 24 h) manda UN diagnóstico automático «cierre_fallo»; uno de hace 3 días no;
//  C3  al volver a arrancar (proceso nuevo) el mismo cierre no se vuelve a mandar;
//  C4  Android < 11 lo dice en una línea;
//  C5  datos de NEXO del día por Wi-Fi y por datos móviles; un reinicio del teléfono (la cuenta vuelve a cero) no suma;
//  C6  el analizador de diagnósticos reconoce la firma «cierre_con_problema».
// Contraprueba: en la 3119 no existe diag_exits.js ni la línea de datos.
// Uso: node cierres.js [dir_build]
'use strict';
const path = require('path');
const { pathToFileURL } = require('url');
const { buildDir } = require('./srcmod');
const fresh = (rel, tag) => import(pathToFileURL(path.join(buildDir, 'src', rel)).href + '?r=' + tag);
(async () => {
  const r = { prueba: 'cierres', build: path.basename(buildDir) };
  let now = Date.parse('2026-11-15T15:00:00');
  const H = 3600000;
  const ls = new Map(), listeners = {}, symptoms = [];
  global.localStorage = { getItem: (k) => (ls.has(k) ? ls.get(k) : null), setItem: (k, v) => ls.set(k, String(v)), removeItem: (k) => ls.delete(k) };
  global.CustomEvent = class { constructor(type, o) { this.type = type; this.detail = o && o.detail; } };
  let nat = {
    sdk: 34, maxMemMb: 512,
    exits: [
      { t: now - 5 * H, reason: 16, label: 'actualización de la app', problem: false, fg: false },
      { t: now - 2 * H, reason: 4, label: 'FALLO (error en la app)', problem: true, fg: true },
      { t: now - 72 * H, reason: 6, label: 'CONGELADA (no respondía)', problem: true, fg: false, trace: '"main" prio=5 tid=1 Blocked\n  at com.nexo.ble.PluginGatt.connect(PluginGatt.kt:10)' }
    ],
    crashes: '15-11 13:00:00 hilo main: java.lang.IllegalStateException: cola llena\n    at com.nexo.ble.PluginBleSend.enqueue(PluginBleSend.kt:42)\n'
  };
  let level = 80, rx = 1000000, tx = 200000, net = 'Wi-Fi';
  global.document = { visibilityState: 'visible', addEventListener: () => {} };
  global.window = {
    NEXO_EXITS_NOW: () => now, NEXO_EXITS_DELAY_MS: 10, NEXO_POWER_NOW: () => now, NEXO_POWER_SAMPLE_MS: 3600000,
    addEventListener: (ev, fn) => { (listeners[ev] = listeners[ev] || []).push(fn); },
    dispatchEvent: (e) => { if (e.type === 'nexo:diag:symptom') symptoms.push(e.detail); (listeners[e.type] || []).forEach((f) => f(e)); },
    Capacitor: { Plugins: { NexoBLE: { getExitReasons: async () => nat, getPowerStatus: async () => ({ level, charging: false, rx, tx, net }) } } }
  };
  const wait = (ms) => new Promise((res) => setTimeout(res, ms));
  let E = await fresh('ui/diag_exits.js', 1);
  if (typeof E.exitsInit !== 'function') throw new Error('sin diag_exits.js (build anterior a la 3120)');
  await E.exitsInit(); await wait(60);
  const L = E.exitsLines();
  r.lineas = L.slice(0, 6);
  r.C1_cabecera = L.some((l) => /Cierres de la app \(7 días\): 3, 2 con problema · memoria máx\. de la app 512 MB/.test(l));
  r.C1_marca = L.filter((l) => /^ {2}⚠ /.test(l)).length === 2 && L.some((l) => /^ {2}\d\d-\d\d \d\d:\d\d actualización de la app \(detrás\)/.test(l));
  r.C1_orden = L.findIndex((l) => /FALLO/.test(l)) < L.findIndex((l) => /actualización/.test(l));
  r.C1_congelada = L.some((l) => /Hilo principal en la congelada/.test(l)) && L.some((l) => /^ {4}\s*at com\.nexo\.ble\.PluginGatt\.connect/.test(l));
  r.C1_fallos = L.some((l) => /Fallos guardados al caer/.test(l)) && L.some((l) => /IllegalStateException: cola llena/.test(l));
  r.C2_sintomas = symptoms.map((s) => s.kind + ': ' + s.info);
  r.C2_uno = symptoms.length === 1 && symptoms[0].kind === 'cierre_fallo' && /FALLO \(error en la app\), a la vista/.test(symptoms[0].info);
  // C3: proceso nuevo, mismos cierres → nada
  now += H;
  E = await fresh('ui/diag_exits.js', 2);
  await E.exitsInit(); await wait(60);
  r.C3_no_repite = symptoms.length === 1;
  // y un fallo NUEVO después sí
  nat = Object.assign({}, nat, { exits: nat.exits.concat([{ t: now - 10 * 60000, reason: 3, label: 'sin memoria: Android la cerró', problem: true, fg: false }]) });
  E = await fresh('ui/diag_exits.js', 3);
  await E.exitsInit(); await wait(60);
  r.C3_nuevo = symptoms.length === 2 && /sin memoria/.test(symptoms[1].info);
  // C4
  nat = { sdk: 29, exits: [] };
  E = await fresh('ui/diag_exits.js', 4);
  await E.exitsInit();
  r.C4_viejo = /Android 29 no los guarda/.test(E.exitsLines().join('\n'));
  // C5: datos de NEXO
  const P = await fresh('ui/usage_power.js', 5);
  P.powerInit(); await wait(20);
  now += 30 * 60000; rx += 3 * 1048576; tx += 1048576; await window.__nexoPower.sample();            // +4 MB por Wi-Fi
  net = 'datos móviles'; now += 10 * 60000; rx += 512 * 1024; await window.__nexoPower.sample();      // cambio de red: 0,5 MB «otra»
  now += 30 * 60000; rx += 2 * 1048576; await window.__nexoPower.sample();                           // +2 MB por datos
  now += 10 * 60000; rx = 100; tx = 100; await window.__nexoPower.sample();                          // reinicio del teléfono: no suma
  now += 10 * 60000; rx += 1048576; await window.__nexoPower.sample();                               // +1 MB por datos
  const dl = P.powerLines('2026-11-15').filter((l) => /datos de NEXO/.test(l))[0] || '';
  r.C5_linea = dl;
  r.C5_datos = /datos de NEXO \(recibidos \+ enviados\): 7,5 MB \(Wi-Fi 4 MB · datos móviles 3 MB · al cambiar de red u otra 512 KB\)/.test(dl);
  // C6: analizador
  const { analizar } = require(path.join(__dirname, '../../tools/diag_analyze.cjs'));
  const txt = '===== ESTADO (15:00:00 hora local) =====\n' + L.join('\n') + '\n';
  let an = ''; try { const a = analizar({ text: txt, sym: 'cierre_fallo', build: 3120 }); an = typeof a === 'string' ? a : JSON.stringify(a); } catch (e) { an = 'ERROR ' + e.message; }
  r.C6_firma = /cierre_con_problema ×2/.test(an);
  const ok = r.C1_cabecera && r.C1_marca && r.C1_orden && r.C1_congelada && r.C1_fallos && r.C2_uno && r.C3_no_repite && r.C3_nuevo && r.C4_viejo && r.C5_datos && r.C6_firma;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('CIERRES ' + JSON.stringify(r));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('CIERRES ' + JSON.stringify({ prueba: 'cierres', resultado: 'FALLO', error: String(e && e.message) })); process.exit(1); });
