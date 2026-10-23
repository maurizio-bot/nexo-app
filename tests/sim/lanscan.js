// Wi-Fi con un router que no deja pasar el anuncio mDNS (repetidores, mallas, routers de operadora): idea del
// dueño, escaneo activo de la red (Kotlin LanBeacon, 2733). A y B emparejados por Bluetooth, en la misma red:
//  1) ¿se encuentran por Wi-Fi? (con la 2732, solo mDNS: nunca);
//  2) lejos por Bluetooth: texto y foto por Wi-Fi;
//  3) B sale del Wi-Fi y vuelve: se reconecta al entrar en la red;
//  4) cada uno en una red distinta (módems distintos): sin internet no hay camino (queda Bluetooth/Jump).
// Uso: node lanscan.js <dir_build> [--kotlin-2732]
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone, installWebCrypto } = require('./native_mock');

const buildDir = path.resolve(process.argv[2]);
const oldKotlin = process.argv.includes('--kotlin-2732');
// El router no deja pasar el anuncio mDNS (repetidores, mallas, muchos routers de operadora)
const opts = { readsContentFallback: true, retain: ['onPayloadReceived', 'onLanMessage', 'onLanUp', 'onLanDown'], closeOnNoService: true, pace: [15, 15], ioDelay: 25, asymmetric: true, wifi: 'casa', lanNoMdns: true, lanNoScan: oldKotlin };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
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
    beforeParse(win) { win.CapacitorCustomPlatform = { name: 'android' }; installWebCrypto(win); win.Capacitor = { Plugins: { NexoBLE: native.plugin() } }; win.HTMLElement.prototype.scrollTo = function () {}; },
  });
  const win = dom.window;
  for (let i = 0; i < 100 && !(win.NEXO && win.NEXO.initialized); i++) await sleep(100);
  await sleep(800);
  return { name, native, win };
}
const click = (win, el) => el && el.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
async function openChatWith(p, name) {
  const row = Array.from(p.win.document.querySelectorAll('#main-contacts-list .ble-contact-row')).find((r) => (r.querySelector('.ble-contact-name') || {}).textContent === name);
  click(p.win, row); await sleep(500); return !!row;
}
function sendText(p, t) { const i = p.win.document.getElementById('message-input'); i.value = t; i.dispatchEvent(new p.win.Event('input', { bubbles: true })); click(p.win, p.win.document.getElementById('send-btn')); }
async function sendFile(p, name, bytes) {
  const b = Buffer.alloc(bytes); for (let i = 0; i < b.length; i++) b[i] = (i * 31 + name.length * 7) & 255;
  click(p.win, p.win.document.querySelector('.attach-menu-item[data-type="file"]')); await sleep(100);
  const fin = Array.from(p.win.document.querySelectorAll('input[type=file]')).pop();
  Object.defineProperty(fin, 'files', { configurable: true, value: [new p.win.File([b], name, { type: 'application/octet-stream' })] });
  fin.dispatchEvent(new p.win.Event('change'));
  return b;
}
async function addFound(p, name) {
  let add = null;
  const find = () => { const row = Array.from(p.win.document.querySelectorAll('#ble-new-device > div')).find((d) => (d.querySelector('span') || {}).textContent === name); return row && row.querySelector('button'); };
  for (let i = 0; i < 400 && !add; i++) { await sleep(100); add = find(); if (!add && !p.win.bleInterface.isScanning) click(p.win, p.win.document.getElementById('ble-scan-btn')); }
  click(p.win, add); await sleep(2000);
  return !!add;
}
async function waitFor(fn, ms) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return Math.round((Date.now() - t0) / 100) / 10; await sleep(200); } return null; }
const tokenOf = (nx, day) => crypto.createHash('sha256').update('nexo-lan|' + nx + '|' + day).digest('hex').substring(0, 16);

(async () => {
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', opts), nB = new NativePhone('B', 'BB:BB:BB:BB:BB:02', opts);
  [nA, nB].forEach((n) => { radio.add(n); n.load(); });
  const A = await boot('A', nA), B = await boot('B', nB);
  const idA = A.win.bleInterface.localNexoId.toLowerCase(), idB = B.win.bleInterface.localNexoId.toLowerCase();
  const r = { build: path.basename(buildDir), kotlin: oldKotlin ? '2732 (solo mDNS)' : '2733 (escaneo de la red)', router: 'no deja pasar mDNS' };
  A.win.bleInterface.togglePanel(); const paired = await addFound(A, 'B'); A.win.bleInterface.togglePanel();
  if (!paired) { console.log('LANSCAN ' + JSON.stringify({ error: 'no empareja' })); process.exit(0); }
  await openChatWith(A, 'B'); sendText(A, 'hola B'); await sleep(3000);
  await openChatWith(B, 'A'); sendText(B, 'hola A'); await sleep(2000);
  A.win.bleInterface.lan.start(); B.win.bleInterface.lan.start();
  const viaA = () => A.win.bleInterface.linkOf(idB), viaB = () => B.win.bleInterface.linkOf(idA);
  const has = async (p, from, f) => (await p.win.vaultLoadMessages(from)).some(f);
  // 1) Los dos en la misma red Wi-Fi: ¿se encuentran?
  r.wifi_comprobado_s = await waitFor(() => viaA() === 'wifi' && viaB() === 'wifi', 30000);
  r.encontrado_por = (logs.find((l) => /\[A\].*está en la misma red/.test(l)) || '').replace(/^.*\(/, '').replace(/\).*$/, '') || null;
  // 2) Lejos por Bluetooth (otra habitación), misma red: texto y foto
  radio.block(nA, nB);
  await sleep(1500);
  const ble0 = nA.sent.length;
  sendText(A, 'texto lejos');
  r.texto_sin_bluetooth_s = await waitFor(() => has(B, idA, (m) => m.content === 'texto lejos'), 30000);
  const foto = await sendFile(A, 'foto.jpg', 300000);
  r.foto_sin_bluetooth_s = await waitFor(() => has(B, idA, (m) => m.attachmentType && !m._own && (m.attachmentPayload || nB.files.get(m.attachmentRef)) === foto.toString('base64')), 40000);
  r.escrituras_bluetooth = nA.sent.length - ble0;
  // 3) B sale del Wi-Fi y vuelve a entrar ("en cuanto tenga Wi-Fi")
  nB.setWifi(null);
  await waitFor(() => viaA() !== 'wifi', 60000);
  const t0 = Date.now();
  nB.setWifi('casa');
  r.al_volver_al_wifi_conecta_s = await waitFor(() => viaA() === 'wifi' && viaB() === 'wifi', 60000);
  // 4) Cada uno en su casa (módems distintos): sin internet no hay camino entre redes distintas (ver docs/WIFI.md)
  nB.setWifi('oficina');
  await waitFor(() => viaA() !== 'wifi', 60000);
  await sleep(3000);
  r.modems_distintos_via = viaA();
  console.log('LANSCAN ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_lanscan.txt'), logs.join('\n'));
  process.exit(0);
})().catch((e) => { console.error('FALLO:', e.stack); fs.writeFileSync(path.join(__dirname, 'last_logs_lanscan.txt'), logs.join('\n')); process.exit(1); });
