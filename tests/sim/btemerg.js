// 3079 (dueño 14-11: «el Bluetooth es la emergencia, solo se ocupa por si no hay otro camino; fuera de eso, siempre el camino más
// rápido»). Antes, con un contacto en línea por internet pero sin estar los dos en Wi-Fi (uno con datos móviles), un Bluetooth listo
// iba PRIMERO (regla vieja para ahorrar datos): textos y fotos salían por Bluetooth aunque hubiera internet. A en Wi-Fi, B con datos
// móviles, emparejados por Bluetooth (MTU sano) y los dos en internet:
//  E1  un texto corto va por internet (ninguna escritura Bluetooth con su id) y llega;
//  E2  un archivo de 60 KB va por internet (ninguna escritura Bluetooth con su id) y llega;
//  E3  sin internet (relés caídos) el Bluetooth sigue de emergencia: un texto sale por él y llega.
// Uso: node btemerg.js <dir_build>
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone, installWebCrypto } = require('./native_mock');
const { NostrRelay } = require('./nostr_relay');

const buildDir = path.resolve(process.argv[2]);
const base = { readsContentFallback: true, retain: ['onPayloadReceived', 'onLanMessage', 'onLanUp', 'onLanDown'], closeOnNoService: true, pace: [15, 15], ioDelay: 25, asymmetric: true, noL2: true }; // noL2: sin canal L2CAP (como la tablet del dueño): un archivo > 5 MB va por el flujo normal, no por big_file.js
let RELAYS = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
class DistLoader extends ResourceLoader {
  constructor(dir) { super(); this.dir = dir; }
  fetch(url) { const f = path.join(this.dir, decodeURIComponent(new URL(url).pathname)); return fs.existsSync(f) ? Promise.resolve(fs.readFileSync(f)) : Promise.reject(new Error('no existe ' + f)); }
}
const logs = [];
// onReady(win): se llama en cuanto existe bleInterface (antes de que la app termine de arrancar) para enganchar espías
async function boot(name, native, onReady) {
  native.listeners = new Map();
  const vc = new VirtualConsole();
  ['log', 'warn', 'error'].forEach((l) => vc.on(l, (...a) => logs.push(`${new Date().toISOString().substring(14, 23)} [${name}] ${l}: ` + a.map(String).join(' ').substring(0, 300))));
  const dom = new JSDOM(fs.readFileSync(path.join(buildDir, 'dist', 'index.html'), 'utf8'), {
    url: 'https://' + name.toLowerCase() + '.nexo.test/index.html', runScripts: 'dangerously',
    resources: new DistLoader(path.join(buildDir, 'dist')), pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) { win.NEXO_NET_RELAYS = RELAYS; win.CapacitorCustomPlatform = { name: 'android' }; installWebCrypto(win); const pl = native.plugin(); native.btWrites = []; const oS = pl.sendMessage; pl.sendMessage = (a) => { try { native.btWrites.push(String((a && (a.message || a.data || a.content)) || '')); } catch (e) {} return oS(a); }; win.Capacitor = { Plugins: { NexoBLE: pl } }; win.HTMLElement.prototype.scrollTo = function () {}; },
  });
  const win = dom.window;
  let hooked = false;
  for (let i = 0; i < 1000 && !(win.NEXO && win.NEXO.initialized); i++) {
    if (!hooked && onReady && win.bleInterface) { hooked = true; onReady(win); }
    await sleep(10);
  }
  if (!hooked && onReady && win.bleInterface) onReady(win);
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
const vaultMsgs = (p, from) => p.win.vaultLoadMessages(from);
// el mensaje del vault cuyo adjunto es exactamente este archivo (el historial puede guardarlo aparte: attachmentRef)
async function findMsg(p, from, b64, own) {
  const list = await vaultMsgs(p, from);
  return list.find((m) => !!m._own === !!own && m.attachmentType && !m.deleted && (m.attachmentPayload || p.native.files.get(m.attachmentRef)) === b64) || null;
}
const statusOf = (p, msgId) => { const s = p.win.document.querySelector('.msg-status[data-msg-id="' + msgId + '"]'); const m = s && (s.className || '').match(/status-([a-z]+)/); return m ? m[1] : null; };

function pickFile(p, name, b) {
  p.win.document.querySelector('.attach-menu-item[data-type="file"]').dispatchEvent(new p.win.MouseEvent('click', { bubbles: true }));
  const fin = Array.from(p.win.document.querySelectorAll('input[type=file]')).pop();
  Object.defineProperty(fin, 'files', { configurable: true, value: [new p.win.File([b], name, { type: 'application/octet-stream' })] });
  fin.dispatchEvent(new p.win.Event('change'));
}
const btHas = (n, id) => n.btWrites.some((w) => w.indexOf(id) >= 0);
(async () => {
  const r = { prueba: 'btemerg', build: path.basename(buildDir) };
  const r1 = new NostrRelay(), r2 = new NostrRelay();
  RELAYS = [await r1.start(), await r2.start()];
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', Object.assign({}, base, { wifi: 'casa', noTor: true })), nB = new NativePhone('B', 'BB:BB:BB:BB:BB:02', Object.assign({}, base, { noTor: true }));
  [nA, nB].forEach((n) => { radio.add(n); n.load(); });
  let A = await boot('A', nA), B = await boot('B', nB);
  const idA = A.win.bleInterface.localNexoId.toLowerCase(), idB = B.win.bleInterface.localNexoId.toLowerCase();
  A.win.bleInterface.togglePanel(); const paired = await addFound(A, 'B'); A.win.bleInterface.togglePanel();
  if (!paired) { console.log('BTEMERG ' + JSON.stringify({ prueba: 'btemerg', resultado: 'FALLO', error: 'no empareja' })); process.exit(1); }
  await openChatWith(A, 'B'); sendText(A, 'hola B'); await sleep(3000);
  await openChatWith(B, 'A'); sendText(B, 'hola A'); await sleep(3000);
  const netA = () => A.win.bleInterface.net;
  netA().tick(); B.win.bleInterface.net.tick();
  r.bt_y_internet = await waitFor(() => !!A.win.bleInterface._bleReadyFor(idB) && netA().canReach(idB), 60000) !== null;
  r.no_ambos_wifi = !netA().bothWifi(idB);
  await openChatWith(A, 'B');
  // E1: texto corto
  sendText(A, 'texto con internet y bluetooth');
  r.E1_llega_s = await waitFor(async () => (await B.win.vaultLoadMessages(idA)).some((m) => m.content === 'texto con internet y bluetooth'), 30000);
  const t1 = (await A.win.vaultLoadMessages(idB)).find((m) => m._own && m.content === 'texto con internet y bluetooth');
  r.E1_por_bluetooth = !!(t1 && btHas(nA, t1.msgId || t1.messageId));
  // E2: archivo de 60 KB
  const bytes = Buffer.alloc(60000, 7);
  pickFile(A, 'sesenta.bin', bytes);
  r.E2_llega_s = await waitFor(async () => (await B.win.vaultLoadMessages(idA)).some((m) => m.attachmentType && !m._own && (m.attachmentMeta || {}).name === 'sesenta.bin'), 60000);
  const f2 = (await A.win.vaultLoadMessages(idB)).find((m) => m._own && m.attachmentType && (m.attachmentMeta || {}).name === 'sesenta.bin');
  r.E2_por_bluetooth = !!(f2 && btHas(nA, f2.msgId || f2.messageId));
  // E3: sin internet → Bluetooth de emergencia
  await r1.stop(); await r2.stop();
  r.E3_sin_internet_s = await waitFor(() => !netA().canReach(idB), 60000);
  sendText(A, 'emergencia por bluetooth');
  r.E3_llega_s = await waitFor(async () => (await B.win.vaultLoadMessages(idA)).some((m) => m.content === 'emergencia por bluetooth'), 30000);
  const t3 = (await A.win.vaultLoadMessages(idB)).find((m) => m._own && m.content === 'emergencia por bluetooth');
  r.E3_por_bluetooth = !!(t3 && btHas(nA, t3.msgId || t3.messageId));
  r.errores = logs.filter((l) => / error: /.test(l) && !/JSDOMERROR|styles\.css|Not implemented|net::ERR|fetch/.test(l)).slice(0, 5);
  const ok = r.bt_y_internet && r.no_ambos_wifi && r.E1_llega_s !== null && !r.E1_por_bluetooth && r.E2_llega_s !== null && !r.E2_por_bluetooth &&
    r.E3_llega_s !== null && r.E3_por_bluetooth && !r.errores.length;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('BTEMERG ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_btemerg.txt'), logs.join('\n'));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('BTEMERG ' + JSON.stringify({ prueba: 'btemerg', resultado: 'FALLO', error: String(e && e.message) })); console.error(e); fs.writeFileSync(path.join(__dirname, 'last_logs_btemerg.txt'), logs.join('\n')); process.exit(1); });
