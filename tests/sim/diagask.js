// Pregunta única del diagnóstico automático (2991, B del dueño 10-11: «el sentido por defecto»). En estas builds de prueba el diagnóstico va
// ENCENDIDO por defecto; para probadores externos / Google Play la compilación fija window.NEXO_DIAG_DEFAULT = 'ask': apagado hasta que la
// persona conteste «Aceptar» / «Ahora no». Un teléfono en jsdom, tres arranques:
//   (1) sin la marca: encendido, sin pregunta (lo de siempre);
//   (2) con 'ask': aparece la pregunta, mientras tanto apagado (no manda nada); «Aceptar» → encendido, la pregunta se va y no vuelve;
//   (3) con 'ask': «Ahora no» → sigue apagado, la pregunta se va y no vuelve.
// Uso: node diagask.js <dir_build>
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone, installWebCrypto } = require('./native_mock');

const buildDir = path.resolve(process.argv[2]);
const base = { readsContentFallback: true, retain: ['onPayloadReceived'], closeOnNoService: true, pace: [15, 15], ioDelay: 25, asymmetric: true, noTor: true };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
class DL extends ResourceLoader { constructor(d) { super(); this.d = d; } fetch(u) { const f = path.join(this.d, decodeURIComponent(new URL(u).pathname)); return fs.existsSync(f) ? Promise.resolve(fs.readFileSync(f)) : Promise.reject(new Error('no existe ' + f)); } }
const logs = [];
async function boot(flag) {
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', base);
  radio.add(nA); nA.load();
  const vc = new VirtualConsole();
  ['log', 'warn', 'error'].forEach((l) => vc.on(l, (...a) => logs.push(`[A] ${l}: ` + a.map(String).join(' ').substring(0, 250))));
  const dom = new JSDOM(fs.readFileSync(path.join(buildDir, 'dist', 'index.html'), 'utf8'), {
    url: 'https://a.nexo.test/index.html', runScripts: 'dangerously', resources: new DL(path.join(buildDir, 'dist')), pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) { win.CapacitorCustomPlatform = { name: 'android' }; installWebCrypto(win); win.Capacitor = { Plugins: { NexoBLE: nA.plugin() } }; win.HTMLElement.prototype.scrollTo = function () {}; if (flag) win.NEXO_DIAG_DEFAULT = flag; },
  });
  const win = dom.window;
  for (let i = 0; i < 100 && !(win.NEXO && win.NEXO.initialized); i++) await sleep(100);
  await sleep(7500);   // la pregunta sale a los ~6 s
  return win;
}
(async () => {
  const r = { prueba: 'diagask', build: path.basename(buildDir) };
  // (1) sin la marca
  let w = await boot(null);
  r.gancho = !!(w.__nexoAutoDiag && w.__nexoAutoDiag.needsAsk);
  r.defecto_encendido = w.__nexoAutoDiag.enabled() === true;
  r.defecto_sin_pregunta = !w.document.getElementById('nexo-diag-ask') && w.__nexoAutoDiag.needsAsk() === false;
  // (2) 'ask' → Aceptar
  w = await boot('ask');
  r.ask_pregunta = !!w.document.getElementById('nexo-diag-ask') && /Ayudar a mejorar NEXO/.test(w.document.getElementById('nexo-diag-ask').textContent);
  r.ask_apagado_mientras = w.__nexoAutoDiag.enabled() === false && w.__nexoAutoDiag.report('zombi', 'prueba') === 'apagado';
  w.document.getElementById('nexo-diag-ask-yes').click(); await sleep(300);
  r.aceptar_enciende = w.__nexoAutoDiag.enabled() === true && w.localStorage.getItem('nexo_autodiag') === '1' && !w.document.getElementById('nexo-diag-ask');
  r.aceptar_no_repite = w.__nexoAutoDiag.ask() === false && w.__nexoAutoDiag.report('zombi', 'prueba2') !== 'apagado';
  // (3) 'ask' → Ahora no
  w = await boot('ask');
  w.document.getElementById('nexo-diag-ask-no').click(); await sleep(300);
  r.no_deja_apagado = w.__nexoAutoDiag.enabled() === false && w.localStorage.getItem('nexo_autodiag') === '0' && !w.document.getElementById('nexo-diag-ask');
  r.no_no_repite = w.__nexoAutoDiag.ask() === false && w.__nexoAutoDiag.report('zombi', 'prueba3') === 'apagado';
  r.errores = logs.filter((l) => / error: /.test(l) && !/JSDOMERROR|styles\.css|Not implemented|GLOBAL TIMEOUT|Assembly timeout|net::ERR|fetch/.test(l)).slice(0, 5);
  const keys = ['gancho', 'defecto_encendido', 'defecto_sin_pregunta', 'ask_pregunta', 'ask_apagado_mientras', 'aceptar_enciende', 'aceptar_no_repite', 'no_deja_apagado', 'no_no_repite'];
  const ok = keys.every((k) => r[k] === true) && r.errores.length === 0;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('DIAGASK ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_diagask.txt'), logs.join('\n'));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('DIAGASK ' + JSON.stringify({ prueba: 'diagask', resultado: 'FALLO', error: String(e && e.message) })); process.exit(1); });
