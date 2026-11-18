// 3241 (diagnósticos del dueño 18-11: «Wi-Fi local 382,9 s»): una medida de «conexión lista» que abarca un rato con la app en segundo plano
// (o que empezó en él) no cuenta; una medida normal con la app a la vista, sí.
// Uso: node medidasegundoplano.js [dir_build]
'use strict';
const { importSrc } = require('./srcmod');

(async () => {
  const r = { prueba: 'medidasegundoplano' };
  const noop = () => {};
  const mem = {};
  global.localStorage = { getItem: (k) => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); }, removeItem: (k) => { delete mem[k]; } };
  const oyentes = {};
  global.window = global; global.window.addEventListener = noop; global.window.removeEventListener = noop; global.window.dispatchEvent = noop;
  global.document = { visibilityState: 'visible', addEventListener: (ev, fn) => { oyentes[ev] = fn; }, removeEventListener: noop, getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], createElement: () => ({ style: {}, classList: { add: noop, remove: noop }, addEventListener: noop, appendChild: noop, setAttribute: noop }), body: { appendChild: noop }, documentElement: { style: {} } };
  const logs = [];
  const log0 = console.log; console.log = (...a) => { const t = a.join(' '); if (t.includes('[VELOCIDAD]')) logs.push(t); };
  const m = await importSrc('ui/usage_stats.js');
  const esp = (ms) => new Promise((res) => setTimeout(res, ms));
  const cuantas = () => logs.length;
  m.usageNoteConnect('wifi', 500);
  r.normal_cuenta = cuantas() === 1;
  // la app pasa a segundo plano 100 ms y vuelve; una medida de 2 s que la abarca no cuenta
  const antes = cuantas();
  await esp(30);
  document.visibilityState = 'hidden'; oyentes.visibilitychange && oyentes.visibilitychange();
  await esp(30);
  document.visibilityState = 'visible'; oyentes.visibilitychange && oyentes.visibilitychange();
  m.usageNoteConnect('wifi', 60000);
  r.abarca_segundo_plano_no_cuenta = cuantas() === antes;
  // una medida que empezó DESPUÉS de volver a la vista sí cuenta
  await esp(40);
  m.usageNoteConnect('wifi', 10);
  r.despues_de_volver_cuenta = cuantas() === antes + 1;
  // con la app oculta ahora mismo, no cuenta
  document.visibilityState = 'hidden';
  m.usageNoteConnect('internet', 5);
  r.oculta_ahora_no_cuenta = cuantas() === antes + 1;
  console.log = log0;
  r.resultado = ['normal_cuenta', 'abarca_segundo_plano_no_cuenta', 'despues_de_volver_cuenta', 'oculta_ahora_no_cuenta'].every((k) => r[k]) ? 'OK' : 'FALLO';
  console.log('MEDIDASEGUNDOPLANO ' + JSON.stringify(r));
  process.exit(r.resultado === 'OK' ? 0 : 1);
})().catch((e) => { console.log('MEDIDASEGUNDOPLANO ' + JSON.stringify({ prueba: 'medidasegundoplano', error: String(e && e.stack || e).slice(0, 500), resultado: 'FALLO' })); process.exit(1); });
