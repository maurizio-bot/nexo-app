// Camino de envío según la regla del dueño (ronda 2760): A y B a alcance de Bluetooth, en el mismo Wi-Fi y con internet
// (relés locales). Comprueba:
//  1. Wi-Fi bueno: todo por Wi-Fi.
//  2. Wi-Fi muy malo (ida y vuelta 2,5 s): no cambia por un pico; tras ~12 s pasa a INTERNET (no a Bluetooth) y una
//     foto va por internet.
//  3. El Wi-Fi mejora: no vuelve enseguida (sin "brincar"): sigue por internet ~30 s y luego vuelve al Wi-Fi solo.
//  4. Sin internet y con el Wi-Fi muy malo: Bluetooth, y un texto llega.
// Uso: node route.js <dir_build>
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone, installWebCrypto } = require('./native_mock');
const { NostrRelay } = require('./nostr_relay');

const buildDir = path.resolve(process.argv[2]);
const opts = { readsContentFallback: true, retain: ['onPayloadReceived', 'onLanMessage', 'onLanUp', 'onLanDown'], closeOnNoService: true, pace: [15, 15], ioDelay: 25, asymmetric: true, wifi: 'casa', noTor: true };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let RELAYS = [];
class DistLoader extends ResourceLoader {
  constructor(dir) { super(); this.dir = dir; }
  fetch(url) { const f = path.join(this.dir, decodeURIComponent(new URL(url).pathname)); return fs.existsSync(f) ? Promise.resolve(fs.readFileSync(f)) : Promise.reject(new Error('no existe ' + f)); }
}
const logs = [];
async function boot(name, native) {
  native.listeners = new Map();
  const vc = new VirtualConsole();
  ['log', 'warn', 'error'].forEach((l) => vc.on(l, (...a) => logs.push(`${new Date().toISOString().substring(14, 23)} [${name}] ${l}: ` + a.map(String).join(' ').substring(0, 250))));
  const dom = new JSDOM(fs.readFileSync(path.join(buildDir, 'dist', 'index.html'), 'utf8'), {
    url: 'https://' + name.toLowerCase() + '.nexo.test/index.html', runScripts: 'dangerously',
    resources: new DistLoader(path.join(buildDir, 'dist')), pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) { win.NEXO_NET_RELAYS = RELAYS; win.CapacitorCustomPlatform = { name: 'android' }; installWebCrypto(win); win.Capacitor = { Plugins: { NexoBLE: native.plugin() } }; win.HTMLElement.prototype.scrollTo = function () {}; },
  });
  const win = dom.window;
  for (let i = 0; i < 100 && !(win.NEXO && win.NEXO.initialized); i++) await sleep(100);
  await sleep(800);
  return { name, native, win };
}
const click = (win, el) => el && el.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
async function openChatWith(p, name) { let row; for (let i = 0; i < 100 && !row; i++) { row = Array.from(p.win.document.querySelectorAll('#main-contacts-list .ble-contact-row')).find((r) => (r.querySelector('.ble-contact-name') || {}).textContent === name); if (!row) await sleep(100); } click(p.win, row); await sleep(600); return !!row; }
function sendText(p, t) { const i = p.win.document.getElementById('message-input'); i.value = t; i.dispatchEvent(new p.win.Event('input', { bubbles: true })); click(p.win, p.win.document.getElementById('send-btn')); }
async function sendFile(p, name, bytes) {
  const b = Buffer.alloc(bytes); for (let i = 0; i < b.length; i++) b[i] = (i * 31 + name.length * 7) & 255;
  click(p.win, p.win.document.querySelector('.attach-menu-item[data-type="file"]')); await sleep(100);
  const fin = Array.from(p.win.document.querySelectorAll('input[type=file]')).pop();
  Object.defineProperty(fin, 'files', { configurable: true, value: [new p.win.File([b], name, { type: 'image/jpeg' })] });
  fin.dispatchEvent(new p.win.Event('change'));
  return b;
}
async function waitFor(fn, ms) { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (await fn()) return Math.round((Date.now() - t0) / 100) / 10; } catch (e) {} await sleep(200); } return null; }

(async () => {
  const relay = new NostrRelay(); RELAYS = [await relay.start()];
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', opts), nB = new NativePhone('B', 'BB:BB:BB:BB:BB:02', opts);
  [nA, nB].forEach((n) => { radio.add(n); n.load(); });
  const [A, B] = await Promise.all([boot('A', nA), boot('B', nB)]);
  const idA = A.win.bleInterface.localNexoId.toLowerCase(), idB = B.win.bleInterface.localNexoId.toLowerCase();
  const r = { build: path.basename(buildDir) };
  A.win.bleInterface.togglePanel(); let add = null;
  for (let i = 0; i < 400 && !add; i++) { await sleep(100); add = A.win.document.querySelector('#ble-new-device > div button'); if (!add && !A.win.bleInterface.isScanning) click(A.win, A.win.document.getElementById('ble-scan-btn')); }
  click(A.win, add); await sleep(1500);
  if (A.win.document.getElementById('ble-panel').classList.contains('active')) A.win.bleInterface.togglePanel();
  await openChatWith(A, 'B'); sendText(A, 'hola B'); await sleep(2500);
  await openChatWith(B, 'A'); sendText(B, 'hola A'); await sleep(2500);
  const via = () => A.win.bleInterface.linkOf(idB);
  const has = async (f) => (await B.win.vaultLoadMessages(idA)).some(f);
  A.win.bleInterface.net.tick(); B.win.bleInterface.net.tick();
  // 1. Wi-Fi bueno
  r.wifi_s = await waitFor(() => via() === 'wifi', 60000);
  r.internet_tambien_s = await waitFor(() => A.win.bleInterface.net.canReach(idB) && A.win.bleInterface.net.bothWifi(idB), 60000);
  // 2. Wi-Fi muy malo
  nA.opts.lanRtt = 2500; nB.opts.lanRtt = 2500;
  const t2 = Date.now(); const seen2 = new Set();
  const left = await waitFor(() => { seen2.add(via()); return via() !== 'wifi'; }, 40000);
  r.malo_deja_wifi_s = left; r.malo_pasa_a = via(); r.malo_caminos_vistos = Array.from(seen2);
  r.malo_no_por_un_pico = left !== null && left >= 7;
  const sentNet0 = logs.filter((l) => /\[A\].*sendFile START .*to=net:/.test(l)).length;
  const foto = await sendFile(A, 'malo.jpg', 60000);
  r.malo_foto_llega_s = await waitFor(() => has((m) => m.attachmentType && !m._own && (m.attachmentMeta || {}).name === 'malo.jpg'), 60000);
  r.malo_foto_por_internet = logs.filter((l) => /\[A\].*sendFile START .*to=net:/.test(l)).length > sentNet0;
  // 3. Mejora: sin brincar
  nA.opts.lanRtt = 0; nB.opts.lanRtt = 0;
  const t3 = Date.now(); let flips = 0, last = via();
  r.vuelve_wifi_s = await waitFor(() => { const v = via(); if (v !== last) { flips++; last = v; } return v === 'wifi'; }, 90000);
  r.vuelve_no_antes_de_20s = r.vuelve_wifi_s !== null && r.vuelve_wifi_s >= 20;
  r.cambios_hasta_volver = flips;
  // 4. Sin internet y Wi-Fi muy malo: Bluetooth
  await relay.stop(); A.win.bleInterface.net.tick(); B.win.bleInterface.net.tick();
  r.sin_internet_s = await waitFor(() => !A.win.bleInterface.net.canReach(idB), 90000);
  nA.opts.lanRtt = 2500; nB.opts.lanRtt = 2500;
  r.sin_internet_pasa_a_bluetooth_s = await waitFor(() => via() === 'bluetooth', 40000);
  sendText(A, 'por bluetooth');
  r.sin_internet_texto_llega_s = await waitFor(() => has((m) => m.content === 'por bluetooth'), 30000);
  r.errores = logs.filter((l) => / error: /.test(l) && !/JSDOMERROR|styles\.css|Not implemented/.test(l)).slice(0, 5);
  const ok = r.wifi_s !== null && r.internet_tambien_s !== null && r.malo_pasa_a === 'internet' && r.malo_no_por_un_pico && r.malo_foto_llega_s !== null && r.malo_foto_por_internet &&
    r.vuelve_no_antes_de_20s && r.cambios_hasta_volver === 1 && r.sin_internet_pasa_a_bluetooth_s !== null && r.sin_internet_texto_llega_s !== null && !r.errores.length;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('ROUTE ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_route.txt'), logs.join('\n'));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error(e); fs.writeFileSync(path.join(__dirname, 'last_logs_route.txt'), logs.join('\n')); process.exit(1); });
