// Ronda 2801 (pedido del dueño #101): el «atrás» de Android. Comprueba la LÓGICA JS que el MainActivity llama
// (window.__nexoHandleBack): cierra lo que esté arriba en orden (visor → estado → cámara → chat) y devuelve true;
// con nada abierto devuelve false (el nativo manda la app a segundo plano). El cableado nativo se prueba en el teléfono.
// Uso: node backbtn.js <dir_build>
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone, installWebCrypto } = require('./native_mock');

const buildDir = path.resolve(process.argv[2]);
const opts = { readsContentFallback: true, closeOnNoService: true, pace: [15, 15], ioDelay: 25 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
class DL extends ResourceLoader { constructor(d) { super(); this.d = d; } fetch(u) { const f = path.join(this.d, decodeURIComponent(new URL(u).pathname)); return fs.existsSync(f) ? Promise.resolve(fs.readFileSync(f)) : Promise.reject(new Error('x')); } }
const logs = [];
async function boot(name, native) {
  const vc = new VirtualConsole();
  ['log', 'warn', 'error'].forEach((l) => vc.on(l, (...a) => logs.push(`[${name}] ${l}: ` + a.map(String).join(' ').substring(0, 250))));
  const dom = new JSDOM(fs.readFileSync(path.join(buildDir, 'dist', 'index.html'), 'utf8'), {
    url: 'https://' + name.toLowerCase() + '.nexo.test/index.html', runScripts: 'dangerously', resources: new DL(path.join(buildDir, 'dist')), pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) { win.CapacitorCustomPlatform = { name: 'android' }; installWebCrypto(win); win.Capacitor = { Plugins: { NexoBLE: native.plugin() } }; win.HTMLElement.prototype.scrollTo = function () {}; },
  });
  const win = dom.window;
  for (let i = 0; i < 100 && !(win.NEXO && win.NEXO.initialized); i++) await sleep(100);
  await sleep(500);
  return { name, native, win };
}

(async () => {
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', opts);
  radio.add(nA); nA.load();
  const [A] = await Promise.all([boot('A', nA)]);
  const win = A.win, doc = win.document, body = doc.body;
  const r = { build: path.basename(buildDir) };

  r.handler_existe = typeof win.__nexoHandleBack === 'function';

  // 1. Nada abierto → false (el nativo mandaría la app a segundo plano)
  r.nada_false = win.__nexoHandleBack() === false;

  // 2. Chat abierto solo → lo cierra (true) y a los ~300 ms sale de chat-view-active
  body.classList.add('chat-view-active');
  r.chat_true = win.__nexoHandleBack() === true;
  await sleep(450);
  r.chat_cerrado = !body.classList.contains('chat-view-active');

  // 3. Prioridad: un overlay (estado) ENCIMA del chat se cierra primero; el chat NO se cierra todavía
  body.classList.add('chat-view-active');
  body.insertAdjacentHTML('beforeend', '<div id="estado-overlay"></div>');
  var pr = win.__nexoHandleBack();
  r.overlay_primero = pr === true && !doc.getElementById('estado-overlay') && body.classList.contains('chat-view-active');
  body.classList.remove('chat-view-active');

  // 4. Visor de foto a pantalla completa → lo cierra
  win.__nexoOpenMedia('data:image/png;base64,' + Buffer.alloc(60, 1).toString('base64'), 'image');
  await sleep(120);
  var teniaVisor = !!doc.getElementById('fullscreen-media-overlay');
  var vr = win.__nexoHandleBack();
  r.visor_cierra = teniaVisor && vr === true && !doc.getElementById('fullscreen-media-overlay');

  // 5. Tras cerrarlo todo → otra vez false
  r.final_false = win.__nexoHandleBack() === false;

  r.errores = logs.filter((l) => /TypeError|undefined is not|is not a function/.test(l)).slice(0, 4);
  const ok = r.handler_existe && r.nada_false && r.chat_true && r.chat_cerrado && r.overlay_primero && r.visor_cierra && r.final_false && r.errores.length === 0;
  r.resultado = ok ? 'OK' : 'FAIL';
  console.log('BACKBTN ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_backbtn.txt'), logs.join('\n'));
  process.exit(0);
})().catch((e) => { console.error('FALLO:', e.stack); fs.writeFileSync(path.join(__dirname, 'last_logs_backbtn.txt'), logs.join('\n')); process.exit(1); });
