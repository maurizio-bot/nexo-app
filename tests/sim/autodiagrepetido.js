// 3240 (diagnósticos de Marcos 17-11: el MISMO diagnóstico llegó 3 veces a la bandeja): el mismo contacto con la misma hora de salida y el mismo
// síntoma no se guarda dos veces; otra hora, otro síntoma u otro contacto sí; sin hora de salida no se puede saber y se guarda.
// Uso: node autodiagrepetido.js [dir_build]
'use strict';
const { importSrc } = require('./srcmod');

(async () => {
  const r = { prueba: 'autodiagrepetido' };
  const noop = () => {};
  const mem = {};
  global.localStorage = { getItem: (k) => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); }, removeItem: (k) => { delete mem[k]; } };
  global.window = global; global.window.addEventListener = noop; global.window.removeEventListener = noop; global.window.dispatchEvent = noop;
  global.CustomEvent = global.CustomEvent || function CE(n) { this.type = n; };
  global.document = global.document || { addEventListener: noop, removeEventListener: noop, getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], createElement: () => ({ style: {}, classList: { add: noop, remove: noop }, addEventListener: noop, appendChild: noop, setAttribute: noop }), body: { appendChild: noop }, documentElement: { style: {} }, visibilityState: 'visible' };
  const m = await importSrc('ui/autodiag.js');
  m.autoDiagClearInbox();
  const diag = (at, sym) => ({ v: 1, text: 'registro', at, sym: sym || 'par:zombi', build: '3097' });
  m.autoDiagReceived('nx1905c1ee', diag(1000));
  m.autoDiagReceived('nx1905c1ee', diag(1000));
  m.autoDiagReceived('nx1905c1ee', diag(1000));
  r.tres_iguales_se_guardan_una = m.autoDiagInbox().length === 1;
  m.autoDiagReceived('nx1905c1ee', diag(2000));
  r.otra_hora_si = m.autoDiagInbox().length === 2;
  m.autoDiagReceived('nx1905c1ee', diag(2000, 'zombi'));
  r.otro_sintoma_si = m.autoDiagInbox().length === 3;
  m.autoDiagReceived('nx10b6f4ac', diag(2000));
  r.otro_contacto_si = m.autoDiagInbox().length === 4;
  m.autoDiagReceived('nx10b6f4ac', diag(0));
  m.autoDiagReceived('nx10b6f4ac', diag(0));
  r.sin_hora_no_se_puede_saber = m.autoDiagInbox().length === 6;
  r.resultado = ['tres_iguales_se_guardan_una', 'otra_hora_si', 'otro_sintoma_si', 'otro_contacto_si', 'sin_hora_no_se_puede_saber'].every((k) => r[k]) ? 'OK' : 'FALLO';
  console.log('AUTODIAGREPETIDO ' + JSON.stringify(r));
  process.exit(r.resultado === 'OK' ? 0 : 1);
})().catch((e) => { console.log('AUTODIAGREPETIDO ' + JSON.stringify({ prueba: 'autodiagrepetido', error: String(e && e.stack || e).slice(0, 500), resultado: 'FALLO' })); process.exit(1); });
