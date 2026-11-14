// 3085 (dueño 14-11: «el S24 cambia de Wi-Fi a datos en automático y muy rápido, ¿por qué nosotros somos lentos?»). La app solo
// escuchaba «entré a un Wi-Fi»; al cambiar de Wi-Fi a datos móviles no se enteraba: sus conexiones a los relés quedaban colgadas de la
// red vieja (abiertas para la app, muertas de verdad) hasta que fallaban o hasta la comprobación de relés callados (120 s con la app a
// la vista). Mientras, lo que le mandaban no entraba. A (Wi-Fi) y B (datos) emparejados y en internet, sin Bluetooth entre ellos; A pasa
// de Wi-Fi a datos (sus conexiones a los relés quedan mudas, como en el teléfono) y al momento:
//  W1  B le escribe: a A le llega en ≤ 10 s;
//  W2  A le escribe a B: le llega en ≤ 10 s;
//  W3  en el diagnóstico de A queda el cambio y cuánto tardaron los relés en volver.
// Uso: node redcambio.js <dir_build>
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone, installWebCrypto } = require('./native_mock');
const { NostrRelay } = require('./nostr_relay');

const buildDir = path.resolve(process.argv[2]);
const base = { readsContentFallback: true, retain: ['onPayloadReceived', 'onLanMessage', 'onLanUp', 'onLanDown'], closeOnNoService: true, pace: [15, 15], ioDelay: 25, asymmetric: true, noL2: true, noTor: true }; // noL2: sin canal L2CAP (como la tablet del dueño): un archivo > 5 MB va por el flujo normal, no por big_file.js
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
    beforeParse(win) { win.NEXO_NET_RELAYS = RELAYS.map((u) => u + '/?p=' + name); win.CapacitorCustomPlatform = { name: 'android' }; installWebCrypto(win); const pl = native.plugin(); native.btWrites = []; const oS = pl.sendMessage; pl.sendMessage = (a) => { try { native.btWrites.push(String((a && (a.message || a.data || a.content)) || '')); } catch (e) {} return oS(a); }; win.Capacitor = { Plugins: { NexoBLE: pl } }; win.HTMLElement.prototype.scrollTo = function () {}; },
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

(async () => {
  const r = { prueba: 'redcambio', build: path.basename(buildDir) };
  const r1 = new NostrRelay(), r2 = new NostrRelay();
  RELAYS = [await r1.start(), await r2.start()];
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', Object.assign({}, base, { wifi: 'casa' })), nB = new NativePhone('B', 'BB:BB:BB:BB:BB:02', Object.assign({}, base));
  [nA, nB].forEach((n) => { radio.add(n); n.load(); });
  const A = await boot('A', nA), B = await boot('B', nB);
  const idA = A.win.bleInterface.localNexoId.toLowerCase(), idB = B.win.bleInterface.localNexoId.toLowerCase();
  A.win.bleInterface.togglePanel(); const paired = await addFound(A, 'B'); A.win.bleInterface.togglePanel();
  if (!paired) { console.log('REDCAMBIO ' + JSON.stringify({ prueba: 'redcambio', resultado: 'FALLO', error: 'no empareja' })); process.exit(1); }
  await openChatWith(A, 'B'); sendText(A, 'hola B'); await sleep(3000);
  await openChatWith(B, 'A'); sendText(B, 'hola A'); await sleep(3000);
  const netA = () => A.win.bleInterface.net, netB = () => B.win.bleInterface.net;
  netA().tick(); netB().tick();
  r.en_internet = await waitFor(() => netA().canReach(idB) && netB().canReach(idA), 60000) !== null;
  // sin Bluetooth entre ellos: solo internet
  radio.block(nA, nB);
  await waitFor(() => !A.win.bleInterface._bleReadyFor(idB) && !B.win.bleInterface._bleReadyFor(idA), 30000);
  await sleep(3000);
  // A pasa de Wi-Fi a datos: sus conexiones a los relés quedan colgadas de la red vieja
  const k0 = logs.length;
  r.mudas = r1.muteTag('p=A') + r2.muteTag('p=A');
  nA.setNetwork('cell');
  const t0 = Date.now();
  await openChatWith(B, 'A'); sendText(B, 'tras el cambio de red');
  const w1 = await waitFor(() => vaultMsgs(A, idB).then((l) => l.some((m) => m.content === 'tras el cambio de red')), 60000);
  r.W1_a_recibe_s = w1 === null ? null : Math.round((Date.now() - t0) / 100) / 10;
  const t2 = Date.now();
  await openChatWith(A, 'B'); sendText(A, 'desde los datos');
  const w2 = await waitFor(() => vaultMsgs(B, idA).then((l) => l.some((m) => m.content === 'desde los datos')), 60000);
  r.W2_b_recibe_s = w2 === null ? null : Math.round((Date.now() - t2) / 100) / 10;
  r.W3_registro = logs.slice(k0).filter((l) => /\[A\].*\[NET\] (Cambio de red|Relés listos tras el cambio)/.test(l)).map((l) => l.replace(/^.*\[NET\] /, '').substring(0, 110));
  r.errores = logs.filter((l) => / error: /.test(l) && !/JSDOMERROR|styles\.css|Not implemented|net::ERR|fetch/.test(l)).slice(0, 5);
  const ok = r.en_internet && r.mudas > 0 && r.W1_a_recibe_s !== null && r.W1_a_recibe_s <= 10 && r.W2_b_recibe_s !== null && r.W2_b_recibe_s <= 10 &&
    r.W3_registro.length >= 2 && !r.errores.length;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('REDCAMBIO ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_redcambio.txt'), logs.join('\n'));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('REDCAMBIO ' + JSON.stringify({ prueba: 'redcambio', resultado: 'FALLO', error: String(e && e.message) })); console.error(e); fs.writeFileSync(path.join(__dirname, 'last_logs_redcambio.txt'), logs.join('\n')); process.exit(1); });
