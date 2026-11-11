// Relés que no contestan al volver de segundo plano (diagnóstico S24 3010, 11-11 19:25 UTC): tras 12 min en segundo plano, al
// volver, las conexiones a los relés seguían «abiertas» pero muertas; todo lo que se mandó por internet esperó 12 s sin
// respuesta, 5 reintentos, y quedó ✗ («Los relés no respondieron»). Dos teléfonos solo por internet (dos relés):
//  M1  A pasa a segundo plano, sus conexiones quedan MUDAS (abiertas, sin respuesta), vuelve y escribe → debe llegar (≤ 30 s);
//  M2  con la app a la vista, las conexiones de A quedan mudas (cambio de red) y A escribe → debe llegar (≤ 40 s).
// Uso: node relaymudo.js <dir_build>
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone, installWebCrypto } = require('./native_mock');
const { NostrRelay } = require('./nostr_relay');
const { importSrc } = require('./srcmod');

const buildDir = path.resolve(process.argv[2] || path.join(__dirname, 'builds/wip'));
const base = { readsContentFallback: true, retain: ['onPayloadReceived', 'onLanMessage', 'onLanUp', 'onLanDown'], closeOnNoService: true, pace: [15, 15], ioDelay: 25, asymmetric: true, noTor: true };
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
async function waitFor(fn, ms) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return Math.round((Date.now() - t0) / 100) / 10; await sleep(250); } return null; }
function setVisible(p, vis) {
  const d = p.win.document; p._vis = vis ? 'visible' : 'hidden';
  if (!p._visDef) { Object.defineProperty(d, 'visibilityState', { configurable: true, get: () => p._vis }); Object.defineProperty(d, 'hidden', { configurable: true, get: () => p._vis === 'hidden' }); p._visDef = true; }
  d.dispatchEvent(new p.win.Event('visibilitychange'));
}
function shutdown(p) { try { p.win.bleInterface.net._closeAll(); p.win.bleInterface.net.relays.forEach((rl) => { rl.retryAt = Date.now() + 9e6; }); } catch (e) {} }
async function freshB(B) { const net = B.win.bleInterface.net; net._closeAll(); await sleep(300); net.relays.forEach((rl) => { rl.retryAt = 0; }); await net.tick(); return waitFor(() => net._openCount() === RELAYS.length, 20000); }

(async () => {
  const r = { prueba: 'relaymudo', build: path.basename(buildDir) };
  const r1 = new NostrRelay(), r2 = new NostrRelay();
  RELAYS = [await r1.start(), await r2.start()];
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', Object.assign({}, base, { wifi: 'casa' })), nB = new NativePhone('B', 'BB:BB:BB:BB:BB:02', Object.assign({}, base, { wifi: 'oficina' }));
  [nA, nB].forEach((n) => { radio.add(n); n.load(); });
  const A = await boot('A', nA); const B = await boot('B', nB);
  const idA = A.win.bleInterface.localNexoId.toLowerCase(), idB = B.win.bleInterface.localNexoId.toLowerCase();
  A.win.bleInterface.togglePanel(); const paired = await addFound(A, 'B'); A.win.bleInterface.togglePanel();
  if (!paired) { console.log('RELAYMUDO ' + JSON.stringify(Object.assign(r, { resultado: 'FALLO', error: 'no empareja' }))); process.exit(1); }
  await openChatWith(A, 'B'); sendText(A, 'hola B'); await sleep(2000);
  await openChatWith(B, 'A'); sendText(B, 'hola A'); await sleep(2000);
  radio.block(nA, nB);
  A.win.bleInterface.net.tick(); B.win.bleInterface.net.tick();
  r.en_linea_por_internet_s = await waitFor(() => A.win.bleInterface.linkOf(idB) === 'internet' && B.win.bleInterface.linkOf(idA) === 'internet', 60000);
  await openChatWith(A, 'B');
  const got = (t) => async () => (await B.win.vaultLoadMessages(idA)).some((m) => !m._own && String(m.content).trim() === t);
  const st = (t) => async () => { const m = (await A.win.vaultLoadMessages(idB)).find((x) => x._own && String(x.content).trim() === t); return m ? m.status : null; };
  sendText(A, 'antes del corte'); r.T0_llega_s = await waitFor(got('antes del corte'), 30000);

  // ---- M1: A en segundo plano; mientras tanto sus conexiones a los relés quedan MUDAS (abiertas pero muertas). Vuelve y escribe ----
  setVisible(A, false);
  r1.muteAll(); r2.muteAll();
  r.M1_B_reconecta = (await freshB(B)) !== null;  // B sigue sano (conexiones nuevas)
  await sleep(20000);
  setVisible(A, true);
  await sleep(500);
  sendText(A, 'al volver');
  r.M1_llega_s = await waitFor(got('al volver'), 90000);
  r.M1_estado = await st('al volver')();

  // ---- M2: con la app a la vista, las conexiones de A se quedan mudas (cambio de red) y A escribe ----
  await sleep(3000);
  r1.muteAll(); r2.muteAll();
  r.M2_B_reconecta = (await freshB(B)) !== null;
  sendText(A, 'red cambiada');
  r.M2_llega_s = await waitFor(got('red cambiada'), 90000);
  r.M2_estado = await st('red cambiada')();

  r.errores = logs.filter((l) => / error: /.test(l) && !/JSDOMERROR|styles\.css|Not implemented|GLOBAL TIMEOUT|net::ERR|fetch/.test(l)).slice(0, 5);
  const ok = r.T0_llega_s !== null && r.M1_llega_s !== null && r.M1_llega_s <= 30 && r.M2_llega_s !== null && r.M2_llega_s <= 40 && /delivered|read/.test(String(r.M1_estado)) && /delivered|read/.test(String(r.M2_estado)) && !r.errores.length;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('RELAYMUDO ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_relaymudo.txt'), logs.join('\n'));
  shutdown(A); shutdown(B); await r1.stop(); await r2.stop();
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('RELAYMUDO ' + JSON.stringify({ prueba: 'relaymudo', resultado: 'FALLO', error: String(e && e.message).replace(/"/g, "'") })); console.error(e && e.stack); fs.writeFileSync(path.join(__dirname, 'last_logs_relaymudo.txt'), logs.join('\n')); process.exit(1); });
