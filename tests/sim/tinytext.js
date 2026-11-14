// 3032 (diagnóstico vivo 3018 12-11 13:45; regla del dueño 04-11 «internet antes que Bluetooth»): un texto LARGO a un contacto
// cuyo Bluetooth está al MÍNIMO (MTU 23) y que está EN LÍNEA por internet (datos móviles) salía por el Bluetooth en cientos de
// trozos (un diagnóstico de 57 KB = 288 trozos). Ahora va por internet. 3079 (dueño 14-11: «el Bluetooth es la emergencia»): con
// internet, también el texto CORTO va por internet; el Bluetooth (aquí al mínimo) solo si no hay otro camino.
// Uso: node tinytext.js <dir_build>
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
    beforeParse(win) { win.NEXO_NET_RELAYS = RELAYS; win.CapacitorCustomPlatform = { name: 'android' }; installWebCrypto(win); win.Capacitor = { Plugins: { NexoBLE: native.plugin() } }; win.HTMLElement.prototype.scrollTo = function () {}; },
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

(async () => {
  const r = { prueba: 'tinytext', build: path.basename(buildDir) };
  const r1 = new NostrRelay(), r2 = new NostrRelay();
  RELAYS = [await r1.start(), await r2.start()];
  const radio = new Radio();
  // A en Wi-Fi de casa; B con datos móviles (sin Wi-Fi): no es «los dos en Wi-Fi», el Bluetooth listo iba primero. Bluetooth MTU 23.
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', Object.assign({}, base, { wifi: 'casa', noTor: true, mtu: 23 })), nB = new NativePhone('B', 'BB:BB:BB:BB:BB:02', Object.assign({}, base, { noTor: true, mtu: 23 }));
  [nA, nB].forEach((n) => { radio.add(n); n.load(); });
  let A = await boot('A', nA), B = await boot('B', nB);
  const idA = A.win.bleInterface.localNexoId.toLowerCase(), idB = B.win.bleInterface.localNexoId.toLowerCase();
  A.win.bleInterface.togglePanel(); const paired = await addFound(A, 'B'); A.win.bleInterface.togglePanel();
  if (!paired) { console.log('TINYTEXT ' + JSON.stringify({ prueba: 'tinytext', resultado: 'FALLO', error: 'no empareja' })); process.exit(1); }
  await openChatWith(A, 'B'); sendText(A, 'hola B'); await sleep(3000);
  await openChatWith(B, 'A'); sendText(B, 'hola A'); await sleep(3000);
  const netA = () => A.win.bleInterface.net;
  netA().tick(); B.win.bleInterface.net.tick();
  r.bt_y_internet = await waitFor(() => !!A.win.bleInterface._bleReadyFor(idB) && netA().canReach(idB) && A.win.bleInterface.getMtu(A.win.bleInterface._bleReadyFor(idB)) === 23, 60000) !== null;
  r.no_ambos_wifi = !netA().bothWifi(idB);
  // texto corto: sigue por Bluetooth
  await openChatWith(A, 'B');
  let logs0 = logs.length;
  sendText(A, 'corto por bluetooth');
  r.corto_llega = await waitFor(async () => (await B.win.vaultLoadMessages(idA)).some((m) => m.content === 'corto por bluetooth'), 30000) !== null;
  r.corto_no_por_internet = !logs.slice(logs0).some((l) => /\[A\].*Texto largo .*va por internet/.test(l));
  // texto largo (6000 caracteres): por internet
  const largo = 'L'.repeat(5990) + ' fin largo';
  logs0 = logs.length;
  sendText(A, largo);
  r.largo_llega = await waitFor(async () => (await B.win.vaultLoadMessages(idA)).some((m) => m.content === largo), 60000) !== null;
  const nuevos = logs.slice(logs0).filter((l) => /\[A\]/.test(l));
  r.largo_por_internet_log = nuevos.some((l) => /Texto largo .*MTU 23.*va por internet/.test(l));
  r.trozos_bt_largo = nuevos.filter((l) => /\[ChatStream\] START .*type=chat totalChunks=(\d+)/.test(l) && Number(/totalChunks=(\d+)/.exec(l)[1]) >= 20).length;
  r.largo_sin_trozos_bt = r.trozos_bt_largo === 0;
  r.errores = logs.filter((l) => / error: /.test(l) && !/JSDOMERROR|styles\.css|Not implemented/.test(l)).slice(0, 5);
  // 3079: el largo va por internet ya desde el resolvedor (el aviso «Texto largo… MTU 23… va por internet» queda solo como información)
  const ok = r.bt_y_internet && r.no_ambos_wifi && r.corto_llega && r.corto_no_por_internet && r.largo_llega && r.largo_sin_trozos_bt && !r.errores.length;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('TINYTEXT ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_tinytext.txt'), logs.join('\n'));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('TINYTEXT ' + JSON.stringify({ prueba: 'tinytext', resultado: 'FALLO', error: String(e && e.message) })); console.error(e); fs.writeFileSync(path.join(__dirname, 'last_logs_tinytext.txt'), logs.join('\n')); process.exit(1); });
