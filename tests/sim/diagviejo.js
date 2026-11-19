// 3253 (dueño 19-11: «que lleguen solo diagnósticos de la última versión, así evitamos revisar y gastar en versiones anteriores»):
//  V1  un teléfono que ya sabe que hay una versión más nueva (actualizador) no manda diagnósticos automáticos ni el resumen diario;
//      con la última versión sí (contraprueba 3109: manda);
//  V2  el teléfono del desarrollador NO guarda los que llegan de una build anterior a la suya (sí la misma, una más nueva o sin número);
//  V3  el lector del canal directo (tools/diag_reader.cjs) toma la última build de NOVEDADES.md y deja fuera las anteriores.
// Uso: node diagviejo.js [dir_build]
'use strict';
const path = require('path');
const { importSrc } = require('./srcmod');

(async () => {
  const r = { prueba: 'diagviejo' };
  const noop = () => {};
  const mem = {};
  global.localStorage = { getItem: (k) => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); }, removeItem: (k) => { delete mem[k]; } };
  global.window = global; global.window.addEventListener = noop; global.window.removeEventListener = noop; global.window.dispatchEvent = noop;
  global.CustomEvent = global.CustomEvent || function CE(n) { this.type = n; };
  global.document = global.document || { addEventListener: noop, removeEventListener: noop, getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], createElement: () => ({ style: {}, classList: { add: noop, remove: noop }, addEventListener: noop, appendChild: noop, setAttribute: noop }), body: { appendChild: noop }, documentElement: { style: {} }, visibilityState: 'visible' };
  global.window.NEXO_BUILD = '3110';
  const m = await importSrc('ui/autodiag.js');
  // V1: con una versión más nueva anunciada por el actualizador, no se manda nada
  mem['nexo_upd_avail'] = JSON.stringify({ build: 3111, url: 'https://x/y.apk' });
  r.V1_vieja_sintoma = m.autoDiagReport('zombi', 'nx0g6ef54e');
  r.V1_vieja_resumen = m.autoDiagSendSummary('2026-11-18', 'resumen');
  delete mem['nexo_upd_avail'];
  r.V1_ultima_sintoma = m.autoDiagReport('zombi', 'nx0g6ef54e');
  const v1 = r.V1_vieja_sintoma === 'version_vieja' && r.V1_vieja_resumen === 'version_vieja' && r.V1_ultima_sintoma !== 'version_vieja';
  // V2: bandeja del desarrollador
  m.autoDiagClearInbox();
  const d = (build, at) => ({ v: 1, text: 'registro', at, sym: 'zombi', build });
  m.autoDiagReceived('nx1905c1ee', d('3097', 1));
  m.autoDiagReceived('nx1905c1ee', d('3109', 2));
  r.V2_viejas_fuera = m.autoDiagInbox().length;
  m.autoDiagReceived('nx1905c1ee', d('3110', 3));
  m.autoDiagReceived('nx1905c1ee', d('3111', 4));
  m.autoDiagReceived('nx1905c1ee', d('', 5));
  r.V2_buenas = m.autoDiagInbox().length;
  const v2 = r.V2_viejas_fuera === 0 && r.V2_buenas === 3;
  // V3: lector del canal directo
  let v3 = false;
  try {
    const rd = require(path.join(__dirname, '../../tools/diag_reader.cjs'));
    const nov = '## Historial\n\n### APK 3109 (19-11-2026)\n- x\n\n### APK 3108 (19-11-2026)\n';
    r.V3_ultima = rd.latestBuild(nov);
    const list = [{ build: '3097' }, { build: '3108' }, { build: '3109' }, { build: '3110' }, { build: '' }];
    r.V3_quedan = rd.onlyLatest(list, r.V3_ultima).map((e) => e.build || '?');
    v3 = r.V3_ultima === 3109 && r.V3_quedan.join(',') === '3109,3110,?';
  } catch (e) { r.V3_error = String(e && e.message).slice(0, 120); }
  r.resultado = v1 && v2 && v3 ? 'OK' : 'FALLO';
  console.log('DIAGVIEJO ' + JSON.stringify(r));
  process.exit(r.resultado === 'OK' ? 0 : 1);
})().catch((e) => { console.log('DIAGVIEJO ' + JSON.stringify({ prueba: 'diagviejo', error: String(e && e.stack || e).slice(0, 500), resultado: 'FALLO' })); process.exit(1); });
