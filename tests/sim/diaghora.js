// Ronda 2812 (pedido del dueño: «ya quiero que recortes el tiempo! te dije que solo sea una hora!»): el diagnóstico
// (Perfil → Ajustes → Copiar diagnóstico) debe cubrir SOLO la última hora, también la «sesión anterior» (antes se
// metía entera y lo hacía enorme). Se siembra un registro de sesión anterior con una línea de hace 2 h y otra de hace
// 10 min; el texto del diagnóstico debe tener la reciente y NO la vieja, manteniendo las cabeceras de sección.
// Uso: node diaghora.js <dir_build>
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone } = require('./native_mock');

const buildDir = path.resolve(process.argv[2]);
const opts = { readsContentFallback: true, retain: ['onPayloadReceived'], closeOnNoService: true, pace: [15, 15], ioDelay: 25, asymmetric: true };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
class DL extends ResourceLoader { constructor(d) { super(); this.d = d; } fetch(u) { const f = path.join(this.d, decodeURIComponent(new URL(u).pathname)); return fs.existsSync(f) ? Promise.resolve(fs.readFileSync(f)) : Promise.reject(new Error('x')); } }
const logs = [];
async function boot(name, native) {
  const vc = new VirtualConsole();
  ['log', 'warn', 'error'].forEach((l) => vc.on(l, (...a) => logs.push(`${new Date().toISOString().substring(14, 23)} [${name}] ${l}: ` + a.map(String).join(' ').substring(0, 250))));
  const dom = new JSDOM(fs.readFileSync(path.join(buildDir, 'dist', 'index.html'), 'utf8'), {
    url: 'https://' + name.toLowerCase() + '.nexo.test/index.html', runScripts: 'dangerously', resources: new DL(path.join(buildDir, 'dist')), pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) { win.CapacitorCustomPlatform = { name: 'android' }; require('./native_mock').installWebCrypto(win); win.Capacitor = { Plugins: { NexoBLE: native.plugin() } }; win.HTMLElement.prototype.scrollTo = function () {}; },
  });
  const win = dom.window;
  for (let i = 0; i < 100 && !(win.NEXO && win.NEXO.initialized); i++) await sleep(100);
  await sleep(1200); // deja que diag.js cargue la «sesión anterior» del fichero (setTimeout 500 ms)
  return { name, native, win };
}
const click = (w, el) => el && el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
const pad = (n) => ('0' + n).slice(-2);
const hhmmss = (d) => pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()) + '.000';

(async () => {
  const radio = new Radio();
  const n = new NativePhone('A', 'AA:AA:AA:AA:AA:01', opts);
  radio.add(n); n.load();
  // Sembrar la «sesión anterior» en el fichero de diagnóstico: una línea de hace 2 h y otra de hace 10 min
  const now = new Date();
  const viejo = new Date(now.getTime() - 2 * 3600 * 1000);
  const recien = new Date(now.getTime() - 10 * 60 * 1000);
  const prev = '--- eventos clave ---\n' + hhmmss(viejo) + ' [TESTVIEJO] hace dos horas\n' + hhmmss(recien) + ' [TESTRECIENTE] hace diez minutos\n' +
    '--- últimas líneas ---\n' + hhmmss(viejo) + ' [TESTVIEJO] otra vieja\n' + hhmmss(recien) + ' [TESTRECIENTE] otra reciente';
  n.files.set('nexo_diag_log2.txt', prev);

  const A = await boot('A', n);
  const r = { build: path.basename(buildDir) };

  // Abrir Perfil → Ajustes (ahí vive el diagnóstico desde la 2807)
  A.win.dispatchEvent(new A.win.CustomEvent('nexo:ui:profile'));
  await sleep(200);
  { const s = A.win.document.getElementById('nexo-open-settings'); if (s) click(A.win, s); }
  await sleep(400);
  const ta = A.win.document.getElementById('nexo-diag-text');
  const txt = ta ? ta.value : '';
  r.hay_textarea = !!ta;
  r.recorta_la_vieja = txt.indexOf('[TESTVIEJO]') < 0;         // la de hace 2 h NO está
  r.mantiene_la_reciente = txt.indexOf('[TESTRECIENTE]') >= 0;  // la de hace 10 min SÍ
  r.cabecera_sesion_anterior = /SESIÓN ANTERIOR \(última hora\)/.test(txt);
  r.cabecera_sesion_actual = /SESIÓN ACTUAL \(última hora\)/.test(txt);
  r.errores = logs.filter((l) => / error: /.test(l) && !/JSDOMERROR|styles\.css|Not implemented/.test(l)).slice(0, 5);

  const ok = r.hay_textarea && r.recorta_la_vieja && r.mantiene_la_reciente && r.cabecera_sesion_anterior && r.cabecera_sesion_actual && !r.errores.length;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('DIAGHORA ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_diaghora.txt'), logs.join('\n'));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error(e); fs.writeFileSync(path.join(__dirname, 'last_logs_diaghora.txt'), logs.join('\n')); process.exit(1); });
