// 3126 (atascos, PLAN etapa 1; dueño 15-11: «sigue con los atascos»): un desatasco del cifrado que se REPITE con el mismo contacto
// no se arreglaba solo y nadie se enteraba. Prueba de UNIDAD de resync.js (sin cambiar nada del cifrado):
//  B1 dos avisos en 30 min: nada (un desatasco normal);   B2 el tercero en 30 min: un diagnóstico automático «desatasco_bucle»;
//  B3 el cuarto no repite el diagnóstico;   B4 pasados 30 min la cuenta vuelve a empezar;
//  B5 el analizador de diagnósticos reconoce la línea y la marca grave.
// Contraprueba: la 3125 no tiene la detección.
// Uso: node desatascobucle.js [dir_build]
'use strict';
const path = require('path');
const { importSrc, buildDir } = require('./srcmod');
(async () => {
  const r = { prueba: 'desatascobucle', build: path.basename(buildDir) };
  let now = Date.parse('2026-11-15T15:00:00');
  const syms = [], logs = [];
  global.CustomEvent = class { constructor(n, i) { this.type = n; this.detail = i && i.detail; } };
  global.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  global.window = { NEXO_RESYNC_NOW: () => now, addEventListener: () => {}, dispatchEvent: (e) => { if (e.type === 'nexo:diag:symptom') syms.push(e.detail); return true; } };
  const oWarn = console.warn; console.warn = (...a) => { logs.push(a.join(' ')); };
  const m = await importSrc('ui/resync.js');
  const nx = 'nx0abc1234';
  m.resyncOnAct(nx, { st: 'rst', need: [], since: 0 }); now += 5 * 60000;
  m.resyncOnAct(nx, { st: 'rst', need: [], since: 0 }); now += 5 * 60000;
  r.B1_dos_nada = syms.length === 0;
  m.resyncOnAct(nx, { st: 'rst', need: [], since: 0 }); now += 5 * 60000;
  r.B2_tercero = syms.length === 1 && syms[0].kind === 'desatasco_bucle' && /nx0abc1234 ×3/.test(syms[0].info);
  m.resyncOnAct(nx, { st: 'rst', need: [], since: 0 });
  r.B3_no_repite = syms.length === 1;
  now += 40 * 60000;
  m.resyncOnAct(nx, { st: 'rst', need: [], since: 0 }); now += 60000; m.resyncOnAct(nx, { st: 'rst', need: [], since: 0 });
  r.B4_reinicia = syms.length === 1;
  now += 60000; m.resyncOnAct(nx, { st: 'rst', need: [], since: 0 });
  r.B4_vuelve = syms.length === 2;
  console.warn = oWarn;
  const { analizar } = require(path.join(__dirname, '../../tools/diag_analyze.cjs'));
  const txt = '===== ESTADO (15:00:00 hora local) =====\n' + logs.map((l) => '15:10:00.000 W ' + l).join('\n') + '\n';
  const a = analizar({ text: txt, sym: 'desatasco_bucle', build: 3126 });
  r.B5_analizador = /desatasco_bucle ×\d/.test(a.out.join('\n')) && a.alerts.some((x) => /desatasco_bucle/.test(x));
  r.sintomas = syms.map((s) => s.kind + ': ' + s.info);
  const ok = r.B1_dos_nada && r.B2_tercero && r.B3_no_repite && r.B4_reinicia && r.B4_vuelve && r.B5_analizador;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('DESATASCOBUCLE ' + JSON.stringify(r));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('DESATASCOBUCLE ' + JSON.stringify({ prueba: 'desatascobucle', resultado: 'FALLO', error: String(e && e.message) })); process.exit(1); });
