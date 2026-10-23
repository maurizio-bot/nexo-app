// Reenvíos inútiles: tras entregar un texto largo y un archivo, ¿se vuelven a enviar al reconectar
// (B reinicia y A tiene algo pendiente) o al reiniciar A? Cuenta los flujos repetidos y lo que pasa por el aire.
// Uso: node resend.js <dir_build> [--io-delay=25] [--upgrade=<dir_build_nueva>]  (A reinicia con otra build: actualización)
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone, installWebCrypto } = require('./native_mock');

const buildDir = path.resolve(process.argv[2]);
const upA = process.argv.find((x) => x.startsWith('--upgrade='));
const upgradeDir = upA ? path.resolve(upA.split('=')[1]) : null;
const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith('--' + k)); if (!a) return d; const v = a.split('=')[1]; return v === undefined ? true : Number(v); };
const opts = { readsContentFallback: true, retain: ['onPayloadReceived'], closeOnNoService: true, pace: [15, 15], ioDelay: arg('io-delay', 0), asymmetric: true };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
class DistLoader extends ResourceLoader {
  constructor(dir) { super(); this.dir = dir; }
  fetch(url) { const f = path.join(this.dir, decodeURIComponent(new URL(url).pathname)); return fs.existsSync(f) ? Promise.resolve(fs.readFileSync(f)) : Promise.reject(new Error('no existe ' + f)); }
}
let airChunks = 0, airBytes = 0;
const orig = NativePhone.prototype._processReceivedChunk;
NativePhone.prototype._processReceivedChunk = function (from, chunk, source) { airChunks++; airBytes += String(chunk).length; return orig.call(this, from, chunk, source); };
const logs = [];
async function boot(name, native, dir) {
  dir = dir || buildDir;
  native.listeners = new Map();
  const vc = new VirtualConsole();
  ['log', 'warn', 'error'].forEach((l) => vc.on(l, (...a) => logs.push(`[${name}] ${l}: ` + a.map(String).join(' ').substring(0, 250))));
  const dom = new JSDOM(fs.readFileSync(path.join(dir, 'dist', 'index.html'), 'utf8'), {
    url: 'https://' + name.toLowerCase() + '.nexo.test/index.html', runScripts: 'dangerously',
    resources: new DistLoader(path.join(dir, 'dist')), pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) { win.CapacitorCustomPlatform = { name: 'android' }; installWebCrypto(win); win.Capacitor = { Plugins: { NexoBLE: native.plugin() } }; win.HTMLElement.prototype.scrollTo = function () {}; },
  });
  const win = dom.window;
  for (let i = 0; i < 100 && !(win.NEXO && win.NEXO.initialized); i++) await sleep(100);
  await sleep(800);
  return { name, native, win };
}
const click = (win, el) => el && el.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
async function openChat(p) { click(p.win, p.win.document.querySelector('#main-contacts-list .ble-contact-row')); await sleep(500); }
async function sendText(p, t) { const i = p.win.document.getElementById('message-input'); i.value = t; i.dispatchEvent(new p.win.Event('input', { bubbles: true })); click(p.win, p.win.document.getElementById('send-btn')); }
const starts = () => logs.filter((l) => l.startsWith('[A]') && /\[ChatStream\] START/.test(l)).length;
const snap = () => ({ flujos: starts(), paquetes: airChunks, bytes: airBytes });
const diff = (a, b) => ({ flujos_nuevos: b.flujos - a.flujos, paquetes: b.paquetes - a.paquetes, bytes: b.bytes - a.bytes });

(async () => {
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', opts), nB = new NativePhone('B', 'BB:BB:BB:BB:BB:02', opts);
  radio.add(nA); radio.add(nB); nA.load(); nB.load();
  let [A, B] = await Promise.all([boot('A', nA), boot('B', nB)]);
  A.win.bleInterface.togglePanel();
  let add = null;
  for (let i = 0; i < 400 && !add; i++) { await sleep(100); add = A.win.document.querySelector('#ble-new-device > div button'); if (!add && !A.win.bleInterface.isScanning) click(A.win, A.win.document.getElementById('ble-scan-btn')); }
  if (!add) { console.log('RESEND ' + JSON.stringify({ error: 'no empareja' })); process.exit(0); }
  click(A.win, add); await sleep(2500);
  A.win.bleInterface.togglePanel();
  await openChat(A);
  const r = { build: path.basename(buildDir) };
  await sendText(A, 'largo-' + 'abcdefghij'.repeat(40)); await sleep(4000);
  const foto = Buffer.alloc(30000); for (let i = 0; i < foto.length; i++) foto[i] = (i * 13 + 7) & 255;
  click(A.win, A.win.document.querySelector('.attach-menu-item[data-type="file"]')); await sleep(200);
  const fin = Array.from(A.win.document.querySelectorAll('input[type=file]')).pop();
  Object.defineProperty(fin, 'files', { value: [new A.win.File([foto], 'foto.bin', { type: 'application/octet-stream' })] });
  fin.dispatchEvent(new A.win.Event('change'));
  await sleep(9000);
  r.entregados = Array.from(A.win.document.querySelectorAll('#messages-container .message.own .msg-status')).map((e) => e.className.replace('msg-status status-', ''));
  const s0 = snap();
  r.flujos_envio_inicial = s0.flujos;

  // 1) B cierra la app; A escribe (queda pendiente); B vuelve
  B.win.close(); nB.destroyActivity(); await sleep(1500);
  await sendText(A, 'corto-pendiente'); await sleep(3000);
  nB.load(); B = await boot('B', nB); await sleep(12000);
  const s1 = snap();
  r.reconexion_B = diff(s0, s1);
  r.llega_pendiente = (await B.win.vaultLoadMessages(A.win.bleInterface.localNexoId)).some((m) => m.content === 'corto-pendiente');

  // 2) A reinicia la app
  A.win.close(); nA.destroyActivity(); await sleep(1500);
  nA.load(); A = await boot('A', nA, upgradeDir); await sleep(12000);
  if (upgradeDir) r.A_actualizada_a = path.basename(upgradeDir);
  const s2 = snap();
  r.reinicio_A = diff(s1, s2);
  const quedan = await A.win.vaultGetPendingOutgoingTransfers(B.win.bleInterface.localNexoId);
  r.registros_salientes_al_final = quedan.length;
  if (quedan.length) { const ms = await A.win.vaultLoadMessages(B.win.bleInterface.localNexoId); r.quedan = quedan.map((t) => { const m = ms.find((x) => x.msgId === t.transferId) || {}; return t.transferId + ' ' + t.type + ' ' + t.status + ' msg:' + m.status; }); }
  console.log('RESEND ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_resend.txt'), logs.join('\n'));
  process.exit(0);
})().catch((e) => { console.error('FALLO:', e.stack); fs.writeFileSync(path.join(__dirname, 'last_logs_resend.txt'), logs.join('\n')); process.exit(1); });
