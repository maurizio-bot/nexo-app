// 3256 (dueño 20-11: «que el diagnóstico mida solo la hora y la temperatura de lo que hace la app, como estándar»): en el diagnóstico de una
// llamada salen la batería y la temperatura al empezar, cada minuto y al colgar (con el %/h y la máxima), y en el estado del teléfono y en el
// resumen del día la temperatura.
//  P1  resumen: baja de 67 % a 61 % en 12 min → 30 %/h; temperatura inicial → final (máx.); estado térmico; cargando no calcula; sin dato lo dice;
//      menos de 5 min no da %/h; subió = se cargó
//  P2  readPower lee getPowerStatus (nivel, temperatura, estado térmico) y devuelve null sin plugin o sin nivel
//  P3  una llamada de punta a punta (ciclo callPowerStart/Tick/End) escribe las 3 líneas en el registro
//  P4  el resumen del día lleva la temperatura máxima (usage_power) y la línea del teléfono (diag_state) la temperatura actual
// Contraprueba 3111: no existe call_power.js.
// Uso: node callpower.js [dir_build]
'use strict';
const { importSrc } = require('./srcmod');

(async () => {
  const r = { prueba: 'callpower' };
  const noop = () => {};
  const mem = {};
  global.localStorage = { getItem: (k) => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); }, removeItem: (k) => { delete mem[k]; } };
  global.window = global; global.window.addEventListener = noop; global.window.removeEventListener = noop; global.window.dispatchEvent = noop;
  global.document = { addEventListener: noop, removeEventListener: noop, visibilityState: 'visible' };
  let power = { level: 67, charging: false, temp: 31.4, thermal: 0 };
  global.window.Capacitor = { Plugins: { NexoBLE: { getPowerStatus: () => Promise.resolve(Object.assign({}, power)) } } };
  const logs = []; const olog = console.log; console.log = (...a) => { logs.push(a.join(' ')); };
  try {
    const m = await importSrc('ui/call_power.js');
    const t0 = 1_000_000;
    const a = { at: t0, level: 67, charging: false, temp: 31.4, thermal: 0 }, b = { at: t0 + 12 * 60000, level: 61, charging: false, temp: 36.2, thermal: 1 };
    const s1 = m.callPowerSummary(a, b, 38.1);
    r.P1_resumen = s1;
    const p1 = /67 % → 61 % \(-6 puntos en 12 min, 30 %\/h\)/.test(s1) && /temperatura 31,4 → 36,2 °C \(máx\. 38,1 °C\)/.test(s1) && /estado térmico al final: ligero/.test(s1)
      && /cargando: no se calcula/.test(m.callPowerSummary(Object.assign({}, a, { charging: true }), b, null))
      && /sin dato/.test(m.callPowerSummary(null, b, null))
      && /muy corto/.test(m.callPowerSummary(a, Object.assign({}, b, { at: t0 + 120000 }), null))
      && /subió: se cargó/.test(m.callPowerSummary(Object.assign({}, a, { level: 50 }), b, null));
    // P2
    const rp = await m.readPower();
    const noPlugin = (() => { const keep = global.window.Capacitor; global.window.Capacitor = {}; return m.readPower().then((x) => { global.window.Capacitor = keep; return x; }); })();
    const p2 = rp && rp.level === 67 && rp.temp === 31.4 && rp.thermal === 0 && (await noPlugin) === null;
    // P3
    logs.length = 0;
    const c = { startedAt: Date.now() };
    m.callPowerStart(c); await new Promise((x) => setTimeout(x, 20));
    c.pw.at = Date.now() - 61000; power = { level: 66, charging: false, temp: 35.0, thermal: 0 };
    m.callPowerTick(c); await new Promise((x) => setTimeout(x, 20));
    power = { level: 64, charging: false, temp: 36.0, thermal: 2 };
    c.pw.a.at -= 12 * 60000; // la llamada «duró» 12 min
    m.callPowerEnd(c, 750); await new Promise((x) => setTimeout(x, 20));
    r.P3_lineas = logs.filter((l) => /Batería y temperatura/.test(l)).map((l) => l.substring(0, 260));
    const p3 = r.P3_lineas.length === 3 && /al empezar: batería 67 %, temperatura 31,4 °C/.test(r.P3_lineas[0]) && /\(a los 0 min\)|batería 66 %/.test(r.P3_lineas[1])
      && /en la llamada \(13 min\)/.test(r.P3_lineas[2]) && /67 % → 64 % \(-3 puntos/.test(r.P3_lineas[2]) && /máx\. 36,0 °C/.test(r.P3_lineas[2]);
    // P4
    const up = await importSrc('ui/usage_power.js');
    const pw = global.window.__nexoPower;
    power = { level: 60, charging: false, temp: 38.5, thermal: 0 };
    await pw.sample();
    const lines = pw.lines();
    r.P4_dia = lines.filter((l) => /temperatura/.test(l));
    const p4 = r.P4_dia.length === 1 && /38,5 °C/.test(r.P4_dia[0]);
    r.resultado = p1 && p2 && p3 && p4 ? 'OK' : 'FALLO';
    r.detalle = { p1, p2, p3, p4 };
  } catch (e) { r.resultado = 'FALLO'; r.error = String(e && e.stack || e).slice(0, 500); }
  console.log = olog;
  console.log('CALLPOWER ' + JSON.stringify(r));
  process.exit(r.resultado === 'OK' ? 0 : 1);
})();
