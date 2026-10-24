// Trozos binarios por Bluetooth (ronda 2753): fotos y archivos en los dos sentidos entre dos teléfonos, cada uno con
// su build. Con las dos nuevas los trozos de datos van en binario; con una build anterior todo sigue en JSON y llega.
// Uso: node binary.js <build_A> [build_B] [--old-a | --old-b] [--mtu=247] [--loss=0.02] [--quick: solo una foto y un texto]
//   --old-b: B es una build anterior (su nativo convierte todo a texto, como el Kotlin de antes); --old-a: lo mismo con A
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone } = require('./native_mock');

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const buildA = path.resolve(args[0]), buildB = path.resolve(args[1] || args[0]);
const argNum = (k, d) => { const a = process.argv.find((x) => x.startsWith('--' + k + '=')); return a ? Number(a.split('=')[1]) : d; };
const mtu = argNum('mtu', 247), loss = argNum('loss', 0), oldB = process.argv.includes('--old-b'), oldA = process.argv.includes('--old-a'), quick = process.argv.includes('--quick');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class DistLoader extends ResourceLoader {
  constructor(dir) { super(); this.dir = dir; }
  fetch(url) { const f = path.join(this.dir, decodeURIComponent(new URL(url).pathname)); return fs.existsSync(f) ? Promise.resolve(fs.readFileSync(f)) : Promise.reject(new Error('no existe ' + f)); }
}
const logs = [];
async function boot(name, address, radio, buildDir, opts) {
  const native = new NativePhone(name, address, Object.assign({ readsContentFallback: true, mtu, loss: 0, pace: [15, 15], retain: ['onPayloadReceived'] }, opts));
  radio.add(native); native.load();
  const vc = new VirtualConsole();
  ['log', 'info', 'warn', 'error'].forEach((l) => vc.on(l, (...a) => logs.push(`[${name}] ${l}: ` + a.map(String).join(' ').substring(0, 300))));
  const dom = new JSDOM(fs.readFileSync(path.join(buildDir, 'dist', 'index.html'), 'utf8'), {
    url: 'https://' + name.toLowerCase() + '.nexo.test/index.html', runScripts: 'dangerously',
    resources: new DistLoader(path.join(buildDir, 'dist')), pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) { win.CapacitorCustomPlatform = { name: 'android' }; if (argNum('small-chunk', 0)) win.NEXO_SMALL_CHUNK = argNum('small-chunk', 0); require('./native_mock').installWebCrypto(win); win.Capacitor = { Plugins: { NexoBLE: native.plugin() } }; win.HTMLElement.prototype.scrollTo = function () {}; },
  });
  const win = dom.window;
  for (let i = 0; i < 100 && !(win.NEXO && win.NEXO.initialized); i++) await sleep(100);
  await sleep(800);
  return { name, native, win };
}
const click = (win, el) => el.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
const imgs = (p) => Array.from(p.win.document.querySelectorAll('#messages-container .message:not(.own):not(.progress-placeholder)')).filter((m) => m.querySelector('.msg-content img')).length;
const files = (p, label) => Array.from(p.win.document.querySelectorAll('#messages-container .message:not(.own):not(.progress-placeholder)')).some((m) => m.textContent.indexOf(label) >= 0);
async function openChat(p) {
  let row = null;
  for (let i = 0; i < 300 && !row; i++) { row = p.win.document.querySelector('#main-contacts-list .ble-contact-row'); if (!row) await sleep(100); }
  click(p.win, row); await sleep(300);
}
async function sendText(p, t) { const i = p.win.document.getElementById('message-input'); i.value = t; i.dispatchEvent(new p.win.Event('input', { bubbles: true })); click(p.win, p.win.document.getElementById('send-btn')); }
async function sendFile(p, name, type, bytes) {
  click(p.win, p.win.document.querySelector('.attach-menu-item[data-type="file"]'));
  await sleep(100);
  const fin = Array.from(p.win.document.querySelectorAll('input[type=file]')).pop();
  Object.defineProperty(fin, 'files', { value: [new p.win.File([bytes], name, { type })] });
  fin.dispatchEvent(new p.win.Event('change'));
}
const rnd = (n, seed) => { const b = Buffer.alloc(n); for (let i = 0; i < n; i++) b[i] = (i * 7919 + seed) & 255; return b; };
const st = (p) => ({ bin_enviados: p.native.stats.binChunksOut || 0, bin_recibidos: p.native.stats.binChunksIn || 0, json_enviados: p.native.stats.chunksOut || 0, escrituras: p.native.stats.airWrites || 0, bytes_aire: p.native.stats.airBytes || 0, bin_descartados: p.native.stats.binDropped || 0 });

(async () => {
  const radio = new Radio();
  const [A, B] = await Promise.all([boot('A', 'AA:AA:AA:AA:AA:01', radio, buildA, { noBinNative: oldA }), boot('B', 'BB:BB:BB:BB:BB:02', radio, buildB, { noBinNative: oldB })]);
  A.win.bleInterface.togglePanel();
  let add = null;
  for (let i = 0; i < 400 && !add; i++) { await sleep(100); add = A.win.document.querySelector('#ble-new-device > div button'); if (!add && !A.win.bleInterface.isScanning) click(A.win, A.win.document.getElementById('ble-scan-btn')); }
  click(A.win, add); await sleep(1500);
  await openChat(A);
  await sendText(A, 'hola'); await sleep(2500);
  await openChat(B); await sleep(500);
  // Las pérdidas, solo durante los envíos (al conectar, otras pruebas ya cubren la pérdida del intercambio de claves)
  A.native.opts.loss = B.native.opts.loss = loss;
  const r = { mtu, loss, a_anterior: oldA, b_anterior: oldB, pasos: {} };
  const wait = async (cond, s) => { const t0 = Date.now(); for (let i = 0; i < s * 5 && !cond(); i++) await sleep(200); return { llega: !!cond(), segundos: Math.round((Date.now() - t0) / 100) / 10 }; };
  const step = async (label, from, to, fn, cond, s) => {
    const a0 = st(A), b0 = st(B);
    await fn();
    const res = await wait(cond, s);
    const d = (x, y) => Object.fromEntries(Object.keys(y).map((k) => [k, y[k] - x[k]]));
    r.pasos[label] = Object.assign(res, { A: d(a0, st(A)), B: d(b0, st(B)) });
    await sleep(1000);
  };
  await step('foto_A_a_B', A, B, () => sendFile(A, 'foto_ab.jpg', 'image/jpeg', rnd(45 * 1024, 13)), () => imgs(B) >= 1, argNum('wait', 120));
  if (!quick) await step('foto_B_a_A', B, A, () => sendFile(B, 'foto_ba.jpg', 'image/jpeg', rnd(45 * 1024, 29)), () => imgs(A) >= 1, 120);
  if (!quick) await step('pdf_A_a_B', A, B, () => sendFile(A, 'informe_bin.pdf', 'application/pdf', rnd(150 * 1024, 41)), () => files(B, 'informe_bin'), 240);
  await step('texto_largo_B_a_A', B, A, () => sendText(B, 'ñandú 📷 '.repeat(120)), () => Array.from(A.win.document.querySelectorAll('#messages-container .message:not(.own)')).some((m) => m.textContent.indexOf('ñandú 📷 ñandú') >= 0), 60);
  const ok = Object.values(r.pasos).every((p) => p.llega);
  // Con una build anterior en un lado: nadie le manda binario (no lo entendería) y él no manda binario
  const expectBin = !oldA && !oldB;
  const binA = r.pasos.foto_A_a_B.A.bin_enviados + (quick ? 0 : r.pasos.pdf_A_a_B.A.bin_enviados), binB = quick ? (expectBin ? 1 : 0) : r.pasos.foto_B_a_A.B.bin_enviados;
  const binOk = expectBin ? binA > 0 && binB > 0 : binA === 0 && binB === 0;
  r.resultado = ok && binOk ? 'OK' : 'FALLO';
  console.log('BINARY ' + JSON.stringify(r));
  if (r.resultado !== 'OK') fs.writeFileSync(path.join(__dirname, 'last_logs_binary.txt'), logs.join('\n'));
  process.exit(r.resultado === 'OK' ? 0 : 1);
})().catch((e) => { console.error(e); fs.writeFileSync(path.join(__dirname, 'last_logs_binary.txt'), logs.join('\n')); process.exit(1); });
