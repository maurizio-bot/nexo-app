// Orden de la lista de chats (dueño 11-11: «la lista no se ordena desde el último de conversación»). Tres teléfonos por
// Bluetooth; B y C le escriben a A por turnos (textos cortos y LARGOS, > 180 letras, que van troceados). Tras cada mensaje, el
// que acaba de escribir tiene que quedar PRIMERO en la lista de A. Uso: node ordenlista.js <dir_build>
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone, installWebCrypto } = require('./native_mock');
const { NostrRelay } = require('./nostr_relay');
const { importSrc } = require('./srcmod');

const buildDir = path.resolve(process.argv[2] || path.join(__dirname, 'builds/wip'));
const SIN_PONG = false;
const base = { noNativePong: SIN_PONG, readsContentFallback: true, retain: ['onPayloadReceived', 'onLanMessage', 'onLanUp', 'onLanDown'], closeOnNoService: true, pace: [15, 15], ioDelay: 25, asymmetric: true, noTor: true };
let RELAYS = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
class DL extends ResourceLoader { constructor(d) { super(); this.d = d; } fetch(u) { const f = path.join(this.d, decodeURIComponent(new URL(u).pathname)); return fs.existsSync(f) ? Promise.resolve(fs.readFileSync(f)) : Promise.reject(new Error('x')); } }
const logs = [];
const T0 = Date.now();
const ts = () => String(((Date.now() - T0) / 1000).toFixed(1)).padStart(6) + 's';
function instrument(native, pl, who) {
  native.calls = { push() {}, length: 0, filter() { return []; }, slice() { return []; }, forEach() {}, map() { return []; }, some() { return false; }, find() { return undefined; } };
  if (who !== 'A') return;
  const oS = pl.saveToFile;
  pl.saveToFile = (a) => { const len = String((a && a.content) || '').length; return oS(a); };
}
async function boot(name, native) {
  native.listeners = new Map();
  const vc = new VirtualConsole();
  ['log', 'warn', 'error'].forEach((l) => vc.on(l, (...a) => logs.push(`${ts()} [${name}] ${l}: ` + a.map(String).join(' ').substring(0, 260))));
  const dom = new JSDOM(fs.readFileSync(path.join(buildDir, 'dist', 'index.html'), 'utf8'), {
    url: 'https://' + name.toLowerCase() + '.nexo.test/index.html', runScripts: 'dangerously', resources: new DL(path.join(buildDir, 'dist')), pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) {
      win.NEXO_NET_RELAYS = RELAYS; win.CapacitorCustomPlatform = { name: 'android' }; installWebCrypto(win);
      const pl = native.plugin(); instrument(native, pl, name);
      win.Capacitor = { Plugins: { NexoBLE: pl } }; win.HTMLElement.prototype.scrollTo = function () {};
    },
  });
  const win = dom.window;
  for (let i = 0; i < 100 && !(win.NEXO && win.NEXO.initialized); i++) await sleep(100);
  await sleep(800);
  return { name, native, win };
}
const click = (win, el) => el && el.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
async function openChatWith(p, name) {
  let row; for (let i = 0; i < 200 && !row; i++) { row = Array.from(p.win.document.querySelectorAll('#main-contacts-list .ble-contact-row')).find((r) => (r.querySelector('.ble-contact-name') || {}).textContent === name); if (!row) await sleep(100); }
  click(p.win, row); await sleep(500); return !!row;
}
function sendText(p, t) { const i = p.win.document.getElementById('message-input'); i.value = t; i.dispatchEvent(new p.win.Event('input', { bubbles: true })); click(p.win, p.win.document.getElementById('send-btn')); }
function pickFile(p, name, b) {
  click(p.win, p.win.document.querySelector('.attach-menu-item[data-type="file"]'));
  const fin = Array.from(p.win.document.querySelectorAll('input[type=file]')).pop();
  Object.defineProperty(fin, 'files', { configurable: true, value: [new p.win.File([b], name, { type: 'application/octet-stream' })] });
  fin.dispatchEvent(new p.win.Event('change'));
}
async function addFound(p, name) {
  let add = null;
  const find = () => { const row = Array.from(p.win.document.querySelectorAll('#ble-new-device > div')).find((d) => (d.querySelector('span') || {}).textContent === name); return row && row.querySelector('button'); };
  for (let i = 0; i < 400 && !add; i++) { await sleep(100); add = find(); if (!add && !p.win.bleInterface.isScanning) click(p.win, p.win.document.getElementById('ble-scan-btn')); }
  click(p.win, add); await sleep(2000);
  return !!add;
}




const sleep2 = sleep;
async function waitFor(fn, ms) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return Math.round((Date.now() - t0) / 100) / 10; await sleep2(250); } return null; }
const rowNames = (p) => Array.from(p.win.document.querySelectorAll('#main-contacts-list .ble-contact-row')).map((r) => (r.querySelector('.ble-contact-name') || {}).textContent);
async function goHome(p) { try { p.win.history.back(); } catch (e) {} await sleep(300); const bb = p.win.document.querySelector('.chat-back-btn, #chat-back-btn, #back-btn'); click(p.win, bb); await sleep(300); try { p.win.bleInterface.renderContactsList(); } catch (e) {} await sleep(200); }
(async () => {
  const r = { prueba: 'ordenlista', build: path.basename(buildDir) };
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', Object.assign({}, base, { wifi: null })), nB = new NativePhone('B', 'BB:BB:BB:BB:BB:02', Object.assign({}, base, { wifi: null })), nC = new NativePhone('C', 'CC:CC:CC:CC:CC:03', Object.assign({}, base, { wifi: null }));
  [nA, nB, nC].forEach((n) => { radio.add(n); n.load(); });
  const A = await boot('A', nA); const B = await boot('B', nB); const C = await boot('C', nC);
  const idA = A.win.bleInterface.localNexoId.toLowerCase();
  A.win.bleInterface.togglePanel(); const pB = await addFound(A, 'B'); const pC = await addFound(A, 'C'); A.win.bleInterface.togglePanel();
  if (!pB || !pC) { console.log('ORDENLISTA ' + JSON.stringify(Object.assign(r, { resultado: 'FALLO', error: 'no empareja' }))); process.exit(1); }
  await openChatWith(A, 'B'); sendText(A, 'hola B'); await sleep(1500);
  await openChatWith(A, 'C'); sendText(A, 'hola C'); await sleep(1500);
  await goHome(A);
  const got = (P, t) => waitFor(async () => (await A.win.vaultLoadMessages(P.win.bleInterface.localNexoId.toLowerCase())).some((m) => !m._own && String(m.content).trim() === t.trim()), 30000);
  const LONG = (w) => 'Mensaje largo de ' + w + ': ' + 'abcdefghij '.repeat(30);
  const steps = [['B', 'corto de B'], ['C', 'corto de C'], ['B', LONG('B')], ['C', LONG('C')], ['B', 'otro corto de B']];
  r.pasos = [];
  for (const [w, t] of steps) {
    const P = w === 'B' ? B : C;
    await openChatWith(P, 'A'); sendText(P, t);
    const s = await got(P, t);
    await sleep(800);
    try { A.win.bleInterface.renderContactsList(); } catch (e) {}
    await sleep(200);
    const order = rowNames(A);
    r.pasos.push({ de: w, largo: t.length > 180, llega_s: s, primero: order[0], ok: s !== null && order[0] === w });
  }
  r.errores = logs.filter((l) => / error: /.test(l) && !/JSDOMERROR|styles\.css|Not implemented|GLOBAL TIMEOUT|net::ERR|fetch/.test(l)).slice(0, 5);
  const ok = r.pasos.every((p) => p.ok);
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('ORDENLISTA ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_ordenlista.txt'), logs.join('\n'));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('ORDENLISTA ' + JSON.stringify({ prueba: 'ordenlista', resultado: 'FALLO', error: String(e && e.message).replace(/"/g, "'") })); console.error(e && e.stack); fs.writeFileSync(path.join(__dirname, 'last_logs_ordenlista.txt'), logs.join('\n')); process.exit(1); });
