// 3059 (diagnóstico automático del Motorola 13-11 07:50, «enlace_abre_cierra» con el vivo): un mensaje llegó CORTADO (se perdió un
// trozo por el aire) y su resto se quedó en el búfer de reensamblaje del nativo: todo lo que llegó detrás —pings, acuses, el
// saludo— se pegaba a ese resto y no formaba ningún mensaje hasta vencer el plazo (6 s): el vivo parecía muerto («zombi») y se
// cortó el enlace. Kotlin 3059: un trozo que EMPIEZA un mensaje ({"v": / {"t":" / {"type":") con un pendiente que no se
// completa → el pendiente era un resto cortado: fuera al momento (SafeJson.startsMessage; aquí el simulador del nativo hace lo
// mismo, y con opts.kotlin3058 como antes).
// Prueba (2 teléfonos, solo Bluetooth, MTU 185 para que los mensajes vayan en varios trozos): A le manda a B un texto largo con
// el aire perdiendo el ÚLTIMO trozo de cada mensaje (½ s: el mensaje nunca se cierra) y justo después un texto corto. Debe: el corto llega en < 3 s
// (antes: tragado detrás del resto cortado hasta que vence el plazo) y el largo llega igual (reenvío de lo que faltó).
// Uso: node trozocortado.js <dir_build> [--kotlin3058]
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone, installWebCrypto } = require('./native_mock');

const buildDir = path.resolve(process.argv[2]);
const old = process.argv.includes('--kotlin3058');
const mk = () => ({ readsContentFallback: true, retain: ['onPayloadReceived'], closeOnNoService: true, pace: [15, 15], ioDelay: 25, asymmetric: true, mtu: 185, kotlin3058: old });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
class DL extends ResourceLoader { constructor(d) { super(); this.d = d; } fetch(u) { const f = path.join(this.d, decodeURIComponent(new URL(u).pathname)); return fs.existsSync(f) ? Promise.resolve(fs.readFileSync(f)) : Promise.reject(new Error('x')); } }
const logs = [];
const T0 = Date.now();
const ts = () => String(((Date.now() - T0) / 1000).toFixed(1)).padStart(6) + 's';
async function boot(name, native) {
  const vc = new VirtualConsole();
  ['log', 'warn', 'error'].forEach((l) => vc.on(l, (...a) => logs.push(`${ts()} [${name}] ${l}: ` + a.map(String).join(' ').substring(0, 250))));
  const dom = new JSDOM(fs.readFileSync(path.join(buildDir, 'dist', 'index.html'), 'utf8'), {
    url: 'https://' + name.toLowerCase() + '.nexo.test/index.html', runScripts: 'dangerously', resources: new DL(path.join(buildDir, 'dist')), pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) { win.CapacitorCustomPlatform = { name: 'android' }; installWebCrypto(win); win.Capacitor = { Plugins: { NexoBLE: native.plugin() } }; win.HTMLElement.prototype.scrollTo = function () {}; },
  });
  const win = dom.window;
  for (let i = 0; i < 100 && !(win.NEXO && win.NEXO.initialized); i++) await sleep(100);
  await sleep(800);
  return { name, native, win };
}
const click = (w, el) => el && el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
async function addFound(p) {
  let add = null;
  for (let i = 0; i < 400 && !add; i++) { await sleep(100); add = p.win.document.querySelector('#ble-new-device > div button'); if (!add && !p.win.bleInterface.isScanning) click(p.win, p.win.document.getElementById('ble-scan-btn')); }
  click(p.win, add); await sleep(2000); return !!add;
}
async function openChat(p) { let row; for (let i = 0; i < 300 && !row; i++) { row = p.win.document.querySelector('#main-contacts-list .ble-contact-row'); if (!row) await sleep(100); } click(p.win, row); await sleep(500); }
function sendText(p, t) { const i = p.win.document.getElementById('message-input'); i.value = t; i.dispatchEvent(new p.win.Event('input', { bubbles: true })); click(p.win, p.win.document.getElementById('send-btn')); }
async function waitFor(fn, ms) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return Math.round((Date.now() - t0) / 100) / 10; await sleep(100); } return null; }

(async () => {
  const r = { prueba: 'trozocortado', build: path.basename(buildDir), nativo: old ? 'kotlin3058' : 'kotlin3059' };
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', mk()), nB = new NativePhone('B', 'BB:BB:BB:BB:BB:02', mk());
  [nA, nB].forEach((n) => { radio.add(n); n.load(); });
  const [A, B] = await Promise.all([boot('A', nA), boot('B', nB)]);
  const idA = A.win.bleInterface.localNexoId.toLowerCase();
  A.win.bleInterface.togglePanel(); if (!(await addFound(A))) { console.log('TROZOCORTADO ' + JSON.stringify({ prueba: 'trozocortado', resultado: 'FALLO', error: 'no empareja' })); process.exit(1); } A.win.bleInterface.togglePanel();
  await openChat(A); sendText(A, 'hola'); await sleep(3000);
  const has = async (t) => (await B.win.vaultLoadMessages(idA)).some((m) => m.content === t);
  r.emparejados = (await waitFor(() => has('hola'), 30000)) !== null;
  await sleep(2000);
  // El aire pierde un trozo del medio de cada mensaje de varios trozos durante ½ s, justo cuando sale el texto largo
  const largo = 'mensaje largo que llega cortado por el aire. '.repeat(30);
  nA.opts.dropMidEvery = 1; nA.opts.dropLast = true;
  sendText(A, largo);
  await sleep(500);
  nA.opts.dropMidEvery = 0;
  r.trozos_perdidos = nA.stats.mutilated || 0;
  sendText(A, 'corto justo después');
  r.corto_llega_s = await waitFor(() => has('corto justo después'), 20000);
  r.largo_llega_s = await waitFor(() => has(largo.trim()), 60000);
  r.resincronizado = nB.stats.resyncs3059 || 0;
  r.errores = logs.filter((l) => /TypeError|undefined is not|No se pudo descifrar/.test(l)).slice(0, 3);
  const ok = r.emparejados && r.trozos_perdidos > 0 && typeof r.corto_llega_s === 'number' && r.corto_llega_s < 3 && typeof r.largo_llega_s === 'number' && !r.errores.length;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('TROZOCORTADO ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_trozocortado.txt'), logs.join('\n'));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('TROZOCORTADO {"prueba":"trozocortado","resultado":"FALLO","error":"' + String(e && e.message).replace(/"/g, "'") + '"}'); console.error(e && e.stack); fs.writeFileSync(path.join(__dirname, 'last_logs_trozocortado.txt'), logs.join('\n')); process.exit(1); });
