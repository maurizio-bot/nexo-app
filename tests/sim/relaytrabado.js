// 3174 (dueño 17-11, diagnóstico S24 19:49:38 y 19:50:28: «algunos mensajes se tardaban en salir»): con los datos móviles trabados
// (las conexiones a los relés abiertas para la app pero sin contestar ni cerrarse) un texto por internet esperó 12 s a que algún relé
// dijera OK, luego «Relé … no contesta (sin respuesta a un envío)» ×4, reconexión y «Texto entregado en 14085 ms». Cuando NINGÚN relé
// contesta, el problema es la conexión del teléfono: ahora a los 3 s sin nada de ninguno se les hace la pregunta mínima y, si en 2 s
// tampoco contestan, se reconectan y el texto sale por las conexiones nuevas. A y B solo por internet (dos relés del simulador):
//  T1  las conexiones de A quedan TRABADAS (mudas: ni contestan ni se cierran) y A escribe: a B le llega en ≤ 9 s (contraprueba
//      3172: ~13–14 s) y A lo ve entregado;
//  T2  relés LENTOS pero vivos (cada respuesta tarda 4 s): A escribe y le llega, sin ninguna reconexión «no contesta» de A (un
//      relé lento no es una conexión trabada).
// Uso: node relaytrabado.js <dir_build>
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
  const r = { prueba: 'relaytrabado', build: path.basename(buildDir) };
  const r1 = new NostrRelay(), r2 = new NostrRelay();
  RELAYS = [await r1.start(), await r2.start()];
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', Object.assign({}, base, { wifi: 'casa' })), nB = new NativePhone('B', 'BB:BB:BB:BB:BB:02', Object.assign({}, base, { wifi: 'oficina' }));
  [nA, nB].forEach((n) => { radio.add(n); n.load(); });
  const A = await boot('A', nA); const B = await boot('B', nB);
  const idA = A.win.bleInterface.localNexoId.toLowerCase(), idB = B.win.bleInterface.localNexoId.toLowerCase();
  A.win.bleInterface.togglePanel(); const paired = await addFound(A, 'B'); A.win.bleInterface.togglePanel();
  if (!paired) { console.log('RELAYTRABADO ' + JSON.stringify(Object.assign(r, { resultado: 'FALLO', error: 'no empareja' }))); process.exit(1); }
  await openChatWith(A, 'B'); sendText(A, 'hola B'); await sleep(2000);
  await openChatWith(B, 'A'); sendText(B, 'hola A'); await sleep(2000);
  radio.block(nA, nB);
  A.win.bleInterface.net.tick(); B.win.bleInterface.net.tick();
  r.en_linea_por_internet_s = await waitFor(() => A.win.bleInterface.linkOf(idB) === 'internet' && B.win.bleInterface.linkOf(idA) === 'internet', 60000);
  await openChatWith(A, 'B');
  const got = (t) => async () => (await B.win.vaultLoadMessages(idA)).some((m) => !m._own && String(m.content).trim() === t);
  const st = (t) => async () => { const m = (await A.win.vaultLoadMessages(idB)).find((x) => x._own && String(x.content).trim() === t); return m ? m.status : null; };
  sendText(A, 'antes'); r.T0_llega_s = await waitFor(got('antes'), 30000);
  await sleep(3000);

  // ---- T1: conexiones de A trabadas (abiertas, mudas); B sigue sano (conexiones nuevas) ----
  r1.muteAll(); r2.muteAll();
  r.T1_B_reconecta = (await freshB(B)) !== null;
  await sleep(1000);
  const m1 = logs.length;
  sendText(A, 'con datos trabados');
  r.T1_llega_s = await waitFor(got('con datos trabados'), 40000);
  r.T1_entregado_s = await waitFor(async () => /delivered|read/.test(String(await st('con datos trabados')())), 30000);
  r.T1_reconexiones_A = logs.slice(m1).filter((l) => /\[A\] warn: \[NET\] Relé .* no contesta/.test(l)).length;

  // ---- T2: relés lentos pero vivos (4 s por respuesta): nada de reconexiones en falso ----
  await sleep(3000);
  r1.opts.latencyMs = 4000; r2.opts.latencyMs = 4000;
  r1.dropAll(); r2.dropAll();
  await waitFor(() => A.win.bleInterface.net._openCount() === RELAYS.length && B.win.bleInterface.net._openCount() === RELAYS.length, 30000);
  await sleep(9000);
  const m2 = logs.length;
  sendText(A, 'con relés lentos');
  r.T2_llega_s = await waitFor(got('con relés lentos'), 60000);
  r.T2_reconexiones_A = logs.slice(m2).filter((l) => /\[A\] warn: \[NET\] Relé .* no contesta/.test(l)).length;

  r.errores = logs.filter((l) => / error: /.test(l) && !/JSDOMERROR|styles\.css|Not implemented|GLOBAL TIMEOUT|net::ERR|fetch/.test(l)).slice(0, 5);
  const ok = r.T0_llega_s !== null && r.T1_B_reconecta && r.T1_llega_s !== null && r.T1_llega_s <= 9 && r.T1_entregado_s !== null &&
    r.T2_llega_s !== null && r.T2_reconexiones_A === 0 && !r.errores.length;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('RELAYTRABADO ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_relaytrabado.txt'), logs.join('\n'));
  shutdown(A); shutdown(B); await r1.stop(); await r2.stop();
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('RELAYTRABADO ' + JSON.stringify({ prueba: 'relaytrabado', resultado: 'FALLO', error: String(e && e.message).replace(/"/g, "'") })); console.error(e && e.stack); fs.writeFileSync(path.join(__dirname, 'last_logs_relaytrabado.txt'), logs.join('\n')); process.exit(1); });
