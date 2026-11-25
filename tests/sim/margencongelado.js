// 3249 (diagnósticos del dueño 19-11): Vivo 05:12 «Un sobre llegó 17565 s después de su hora: margen al reconectar 600 s» y S24 05:23
// «Un sobre llegó 429 s después… margen 459 s»; el S24 bajó 12,2 MB repetidos de los relés en 18 min. Lo que se quedó parado en la conexión
// mientras la app estaba CONGELADA (pantalla apagada) se procesaba al volver como «en vivo y tarde»: el margen del `since` al reconectar
// (3212) subía al máximo y se recordaba 12 h → cada vuelta a la app y cada «deslizar» volvía a pedir 10 min de todo a cada relé.
//  M1  sobre de hace 429 s procesado justo al volver la app a la vista (estuvo oculta) → el margen NO sube (sigue en 120 s);
//  M2  sobre procesado con la app oculta → no cuenta;
//  M3  desfase de verdad (app a la vista todo el rato, sobre de hace 200 s) → sí cuenta (margen 230 s), como en 3212.
// Contraprueba (build anterior): M1 y M2 fallan.
// Uso: node margencongelado.js <dir_build>
'use strict';
const { JSDOM } = require('jsdom');
const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true });
let vis = 'visible';
Object.defineProperty(dom.window.document, 'visibilityState', { get: () => vis, configurable: true });
global.document = dom.window.document;
const { importSrc } = require('./srcmod');
const setVis = (v) => { vis = v; document.dispatchEvent(new dom.window.Event('visibilitychange')); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const { netRelays } = await importSrc('net/net_relays.js');
  const mk = () => { const o = Object.create(netRelays); o.state = {}; o._saveState = () => {}; return o; };
  const now = () => Math.floor(Date.now() / 1000);
  const res = [];
  const check = (id, ok, msg) => { res.push(ok); console.log((ok ? 'OK  ' : 'FAIL') + ' ' + id + ' ' + msg); };

  // M3 primero: la app lleva a la vista todo el rato (ningún cambio de visibilidad en el rato del sobre)
  const a = mk();
  a._noteLag({ created_at: now() - 200 });
  check('M3', Math.abs(a._sinceMarginS() - 230) <= 2, 'desfase real a la vista: margen ' + a._sinceMarginS() + ' s (esperado 230)');

  // La app pasa a segundo plano y se congela; al volver se procesa lo detenido
  setVis('hidden');
  await sleep(20);
  const b = mk();
  b._noteLag({ created_at: now() - 300 });
  check('M2', b._sinceMarginS() === 120, 'con la app oculta: margen ' + b._sinceMarginS() + ' s (esperado 120)');
  setVis('visible');
  await sleep(20);
  const c = mk();
  c._noteLag({ created_at: now() - 429 });
  check('M1', c._sinceMarginS() === 120, 'sobre detenido mientras estaba congelada, al volver: margen ' + c._sinceMarginS() + ' s (esperado 120)');

  const ok = res.every(Boolean);
  console.log('MARGENCONGELADO ' + JSON.stringify({ resultado: ok ? 'OK' : 'FALLO', M1_margen_s: c._sinceMarginS(), M2_margen_s: b._sinceMarginS(), M3_margen_s: a._sinceMarginS() }));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(2); });
