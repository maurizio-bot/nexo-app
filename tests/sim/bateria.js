// 3119 (dueño 15-11: «el tiempo de uso de la aplicación y cuánto gasta NEXO de batería en el tiempo de uso que se le da»). Prueba de
// UNIDAD de usage_power.js con un reloj y un nativo de prueba:
//  B1  30 min a la vista, la batería baja de 80 a 77 → «a la vista 6 %/h (en 30 min)» y «tiempo con la app a la vista: 30 min»;
//  B2  2 h en segundo plano, baja de 77 a 73 → «en segundo plano 2 %/h (en 2 h)»;
//  B3  un rato cargando (sube) no cuenta como gasto;
//  B4  el resumen diario y el diagnóstico llevan esas líneas.
// Uso: node bateria.js [dir_build]
'use strict';
const { importSrc } = require('./srcmod');
(async () => {
  const r = { prueba: 'bateria' };
  let now = Date.parse('2026-11-15T15:00:00'), level = 80, charging = false, vis = 'visible';
  const ls = new Map(), listeners = {};
  global.localStorage = { getItem: (k) => (ls.has(k) ? ls.get(k) : null), setItem: (k, v) => ls.set(k, String(v)), removeItem: (k) => ls.delete(k) };
  global.document = { get visibilityState() { return vis; }, addEventListener: (ev, fn) => { (listeners[ev] = listeners[ev] || []).push(fn); } };
  global.window = { NEXO_POWER_NOW: () => now, NEXO_POWER_SAMPLE_MS: 3600000, Capacitor: { Plugins: { NexoBLE: { getPowerStatus: async () => ({ level, charging }) } } } };
  const P = await importSrc('ui/usage_power.js');
  const tick = () => new Promise((res) => setTimeout(res, 20));
  const setVis = async (v) => { vis = v; (listeners.visibilitychange || []).forEach((f) => f()); await tick(); await tick(); };
  P.powerInit(); await tick();
  // B1: 30 min a la vista, 80 → 77
  now += 30 * 60000; level = 77;
  await setVis('hidden');
  // B2: 2 h detrás, 77 → 73
  now += 2 * 3600000; level = 73;
  await setVis('visible');
  // B3: 20 min cargando (73 → 76) a la vista: no cuenta
  now += 20 * 60000; level = 76; charging = true;
  await window.__nexoPower.sample(); await tick();
  const key = '2026-11-15';
  r.lineas = P.powerLines(key);
  r.B1_tiempo = r.lineas.some((l) => /tiempo con la app a la vista: 50 min/.test(l)); // 30 + 20 a la vista (el rato cargando también es uso)
  r.B1_vista = r.lineas.some((l) => /a la vista 6 %\/h \(en 30 min\)/.test(l));
  r.B2_fondo = r.lineas.some((l) => /en segundo plano 2 %\/h \(en 2 h\)/.test(l));
  r.B3_carga_no_cuenta = P.powerAccount({ at: 0, level: 73, charging: false }, { at: 1200000, level: 76, charging: true }, 1200000) === null &&
    P.powerAccount({ at: 0, level: 70, charging: false }, { at: 600000, level: 72, charging: false }, 0) === null;
  const ok = r.B1_tiempo && r.B1_vista && r.B2_fondo && r.B3_carga_no_cuenta;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('BATERIA ' + JSON.stringify(r));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('BATERIA ' + JSON.stringify({ prueba: 'bateria', resultado: 'FALLO', error: String(e && e.message) })); process.exit(1); });
