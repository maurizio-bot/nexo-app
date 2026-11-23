// 17 (diagnósticos 19-11 21:34/21:48, S23 → S24 en videollamada): el S23 (datos + ahorro de batería) no oía la presencia del S24
// por los relés («oído hace 312–1014 s»: lo que los relés le repartían EN VIVO se perdía), y un texto LARGO (9 trozos) al S24 quedó
// atorado ≥ 17 min: en el S24 «Assembly timeout» y en el S23 «Buzón no disponible: Abortado», una y otra vez.
// A y B solo por internet, los dos despiertos; a A los relés le pierden TODO lo que le reparten en vivo (lo guardado sí se lo dan al
// volver a pedirlo; --keep=N: solo le llega 1 de cada N). A manda un texto de ~50 KB (va en trozos):
//  T1  le llega a B entero y una sola vez en ≤ 90 s;
//  T2  A lo da por entregado (✓✓) en ≤ 120 s y su envío termina;
//  T3  sin vueltas de «Abortado»/«Assembly timeout» por ese mensaje.
// Uso: node textoatorado.js <dir_build>
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
  const r = { prueba: 'textoatorado', build: path.basename(buildDir) };
  const r1 = new NostrRelay(), r2 = new NostrRelay();
  RELAYS = [await r1.start(), await r2.start()];
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', Object.assign({}, base, { wifi: 'casa' })), nB = new NativePhone('B', 'BB:BB:BB:BB:BB:02', Object.assign({}, base));
  [nA, nB].forEach((n) => { radio.add(n); n.load(); });
  const A = await boot('A', nA), B = await boot('B', nB);
  const idA = A.win.bleInterface.localNexoId.toLowerCase(), idB = B.win.bleInterface.localNexoId.toLowerCase();
  A.win.bleInterface.togglePanel(); const paired = await addFound(A, 'B'); A.win.bleInterface.togglePanel();
  if (!paired) { console.log('TEXTOATORADO ' + JSON.stringify({ prueba: 'textoatorado', resultado: 'FALLO', error: 'no empareja' })); process.exit(1); }
  await openChatWith(A, 'B'); sendText(A, 'hola B'); await sleep(3000);
  await openChatWith(B, 'A'); sendText(B, 'hola A'); await sleep(3000);
  const netA = () => A.win.bleInterface.net, netB = () => B.win.bleInterface.net;
  netA().tick(); netB().tick();
  r.en_internet = await waitFor(() => netA().canReach(idB) && netB().canReach(idA), 60000) !== null;
  radio.block(nA, nB);
  await waitFor(() => !A.win.bleInterface._bleReadyFor(idB) && !B.win.bleInterface._bleReadyFor(idA), 30000);
  await sleep(2000);
  const KEEP = Number((process.argv.find((a) => a.indexOf('--keep=') === 0) || '--keep=100000').slice(7)); r.keep = KEEP;
  r1.lossyTag('p=A', KEEP); r2.lossyTag('p=A', KEEP);
  const largo = 'texto largo en plena videollamada con los relés perdiendo lo que le llega al que envía '.repeat(560).trim();
  r.chars = largo.length;
  const k0 = logs.length, t0 = Date.now();
  await openChatWith(A, 'B'); sendText(A, largo);
  const got = async () => (await vaultMsgs(B, idA)).filter((m) => !m._own && m.content === largo).length;
  const t1 = await waitFor(async () => (await got()) >= 1, 90000);
  r.T1_llega_s = t1;
  const st = async () => ((await vaultMsgs(A, idB)).find((m) => m._own && m.content === largo) || {}).status;
  const t2 = await waitFor(async () => /delivered|read/.test((await st()) || ''), Math.max(5000, 120000 - (Date.now() - t0)));
  r.T2_entregado_s = t2 === null ? null : Math.round((Date.now() - t0) / 100) / 10;
  r.estado = await st();
  await sleep(3000);
  r.T1_una_vez = await got();
  const own = (await vaultMsgs(A, idB)).find((m) => m._own && m.content === largo);
  const mid = own && (own.msgId || own.messageId);
  r.T2_terminado = !!mid && !A.win.bleInterface.ackSystem.outgoingStreams.has(mid);
  const L = logs.slice(k0);
  r.T3_abortado = L.filter((l) => /Abortado|abort msgId/.test(l) && (!mid || l.indexOf(mid) >= 0)).length;
  r.T3_assembly = L.filter((l) => /Assembly timeout/.test(l)).length;
  r.perdidos_a_A = (r1._lossy ? r1._lossy.lost : 0) + (r2._lossy ? r2._lossy.lost : 0);
  r.errores = logs.filter((l) => / error: /.test(l) && !/JSDOMERROR|styles\.css|Not implemented|net::ERR|fetch/.test(l)).slice(0, 5);
  const ok = r.en_internet && t1 !== null && r.T1_una_vez === 1 && t2 !== null && r.T2_terminado && !r.T3_abortado && !r.T3_assembly && !r.errores.length;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('TEXTOATORADO ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_textoatorado.txt'), logs.join('\n'));
  await r1.stop(); await r2.stop();
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('TEXTOATORADO ' + JSON.stringify({ prueba: 'textoatorado', resultado: 'FALLO', error: String(e && e.message) })); console.error(e); fs.writeFileSync(path.join(__dirname, 'last_logs_textoatorado.txt'), logs.join('\n')); process.exit(1); });
