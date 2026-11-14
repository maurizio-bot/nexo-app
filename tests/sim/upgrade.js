// 3080 (dueño 14-11: «el Bluetooth es la emergencia… siempre el camino más rápido»; diagnóstico S23→Redmi 21:46: un vídeo HD de
// 2,9 MB por Bluetooth a ~0,4 KB/s siguió por ahí aunque un minuto después los dos quedaron en el mismo Wi-Fi). Un archivo que va por
// Bluetooth pasa al camino rápido en cuanto está listo:
//  --caso=wifi  sin Wi-Fi ni internet, A manda 600 KB por Bluetooth; a los 4 s los dos entran al mismo Wi-Fi → el archivo deja el
//               Bluetooth y llega por el Wi-Fi (U1 el cambio queda escrito; U2 llega en < 30 s desde que lo elige);
//  --caso=net   Bluetooth lento (sin L2CAP, ~8 KB/s) y sin internet; A manda 300 KB; a los 3 s vuelve internet (B con datos móviles) →
//               medido el Bluetooth lento, el archivo sigue por internet (U1, U2 < 60 s).
// Uso: node upgrade.js <dir_build> --caso=wifi|net
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
const caso = (process.argv.find((a) => a.startsWith('--caso=')) || '--caso=wifi').split('=')[1];
(async () => {
  const r = { prueba: 'upgrade', caso, build: path.basename(buildDir) };
  let relays = [], ports = [];
  if (caso === 'net') { relays = [new NostrRelay(), new NostrRelay()]; RELAYS = [await relays[0].start(), await relays[1].start()]; ports = RELAYS.map((u) => Number(u.split(':').pop())); }
  else RELAYS = [];
  const radio = new Radio();
  const mtu = {};
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', Object.assign({}, base, { wifi: caso === 'net' ? 'casa' : null, noTor: true }, mtu));
  const nB = new NativePhone('B', 'BB:BB:BB:BB:BB:02', Object.assign({}, base, { wifi: null, noTor: true }, mtu));
  [nA, nB].forEach((n) => { radio.add(n); n.load(); });
  const A = await boot('A', nA), B = await boot('B', nB);
  const idA = A.win.bleInterface.localNexoId.toLowerCase(), idB = B.win.bleInterface.localNexoId.toLowerCase();
  A.win.bleInterface.togglePanel(); const paired = await addFound(A, 'B'); A.win.bleInterface.togglePanel();
  if (!paired) { console.log('UPGRADE ' + JSON.stringify(Object.assign(r, { resultado: 'FALLO', error: 'no empareja' }))); process.exit(1); }
  await openChatWith(A, 'B'); sendText(A, 'hola B'); await sleep(3000);
  await openChatWith(B, 'A'); sendText(B, 'hola A'); await sleep(3000);
  // net: ya emparejados (claves cambiadas), el Bluetooth se vuelve lento de verdad (sin L2CAP, escrituras al ritmo de un teléfono
  // lento: ~8 KB/s) y se cae internet; el archivo empieza por Bluetooth
  if (caso === 'net') {
    [nA, nB].forEach((n) => { n.opts.pace = [60, 120]; n.opts.noL2 = true; });
    await relays[0].stop(); await relays[1].stop(); r.sin_internet_s = await waitFor(() => !A.win.bleInterface.net.canReach(idB), 60000);
  }
  r.solo_bluetooth = !!A.win.bleInterface._bleReadyFor(idB) && !A.win.bleInterface.net.canReach(idB) && !(A.win.bleInterface.lan && A.win.bleInterface.lan.canReach(idB));
  await openChatWith(A, 'B');
  const mark = logs.length;
  const size = caso === 'net' ? 300000 : 600000;
  const t0 = Date.now();
  pickFile(A, 'grande.bin', Buffer.alloc(size, 5));
  r.empieza_por_bluetooth_s = await waitFor(() => logs.slice(mark).some((l) => /\[A\].*sendFile START .*deviceId=(?!lan|net)/.test(l) || /\[A\].*\[ChatStream\] START .*type=file/.test(l)), 30000);
  await sleep(caso === 'net' ? 3000 : 4000);
  if (caso === 'wifi') { nA.setWifi('casa'); nB.setWifi('casa'); }
  else { await relays[0].start(ports[0]); await relays[1].start(ports[1]); }
  r.U2_llega_s = await waitFor(async () => (await B.win.vaultLoadMessages(idA)).some((m) => m.attachmentType && !m._own && (m.attachmentMeta || {}).name === 'grande.bin'), caso === 'net' ? 150000 : 150000);
  if (r.U2_llega_s !== null) r.U2_llega_s = Math.round((Date.now() - t0) / 100) / 10;
  const cambio = logs.slice(mark).find((l) => /\[A\].*el archivo deja el Bluetooth y sigue por/.test(l));
  r.U1_cambio = cambio ? cambio.replace(/^.*\[ChatStream\] /, '').substring(0, 200) : null;
  r.errores = logs.filter((l) => / error: /.test(l) && !/JSDOMERROR|styles\.css|Not implemented|net::ERR|fetch/.test(l)).slice(0, 5);
  const limite = caso === 'net' ? 60 : 30;
  const ok = r.solo_bluetooth && !!r.U1_cambio && r.U2_llega_s !== null && r.U2_llega_s < limite && !r.errores.length;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('UPGRADE ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_upgrade_' + caso + '.txt'), logs.join('\n'));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('UPGRADE ' + JSON.stringify({ prueba: 'upgrade', resultado: 'FALLO', error: String(e && e.message) })); console.error(e); fs.writeFileSync(path.join(__dirname, 'last_logs_upgrade.txt'), logs.join('\n')); process.exit(1); });
