// 3342 (diag. S24 25-11 14:16, dueño sin Wi-Fi ni datos con 3 NEXO cerca: «debe ser más rápido»): el puente aceptó, pero el relé que
// ofreció no le abrió la sesión («no conecta») y A no volvió a intentarlo hasta 34 s después. Ahora: sin ninguna red se busca puente a
// los 1,5 s y, si la sesión no abre, se prueba YA otro relé por el mismo puente. A sin red, B (cerca, con internet) rechaza la primera
// apertura; A debe tener internet prestado en ≤ 15 s y su texto llegar a C (lejos). Contraprueba: la build anterior tarda > 30 s.
// Uso: node puenterele.js <dir_build>
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
// Sin antena: ningún relé contesta (como un teléfono sin datos ni Wi-Fi con salida)
class NoNetWS { constructor(u) { this.url = u; this.readyState = 0; setTimeout(() => { this.readyState = 3; if (this.onerror) this.onerror({}); if (this.onclose) this.onclose({}); }, 30); } send() { throw new Error('sin red'); } close() {} }
async function boot(name, native, noNet) {
  native.listeners = new Map();
  native.calls = { push() {}, length: 0, filter() { return []; }, slice() { return []; }, forEach() {}, map() { return []; }, some() { return false; }, find() { return undefined; } };
  const vc = new VirtualConsole();
  ['log', 'warn', 'error'].forEach((l) => vc.on(l, (...a) => logs.push(`${ts()} [${name}] ${l}: ` + a.map(String).join(' ').substring(0, 260))));
  const dom = new JSDOM(fs.readFileSync(path.join(buildDir, 'dist', 'index.html'), 'utf8'), {
    url: 'https://' + name.toLowerCase() + '.nexo.test/index.html', runScripts: 'dangerously', resources: new DL(path.join(buildDir, 'dist')), pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) {
      win.NEXO_NET_RELAYS = RELAYS; win.CapacitorCustomPlatform = { name: 'android' }; installWebCrypto(win);
      win.Capacitor = { Plugins: { NexoBLE: native.plugin() } }; win.HTMLElement.prototype.scrollTo = function () {};
      if (noNet) win.WebSocket = NoNetWS;
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
  click(p.win, add); await sleep(2500);
  return !!add;
}
async function waitFor(fn, ms) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return Math.round((Date.now() - t0) / 100) / 10; await sleep(250); } return null; }
function shutdown(p) { try { p.win.bleInterface.net._closeAll(); p.win.bleInterface.net.relays.forEach((rl) => { rl.retryAt = Date.now() + 9e6; }); } catch (e) {} }

(async () => {
  const r = { prueba: 'puenterele', build: path.basename(buildDir) };
  const r1 = new NostrRelay(), r2 = new NostrRelay();
  RELAYS = [await r1.start(), await r2.start()];
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', base), nB = new NativePhone('B', 'BB:BB:BB:BB:BB:02', base), nC = new NativePhone('C', 'CC:CC:CC:CC:CC:04', base);
  [nA, nB, nC].forEach((n) => { radio.add(n); n.load(); });
  const A = await boot('A', nA, true), B = await boot('B', nB), C = await boot('C', nC);
  const id = (p) => p.win.bleInterface.localNexoId.toLowerCase();
  const idA = id(A), idC = id(C);
  A.win.bleInterface.togglePanel();
  const paired = (await addFound(A, 'B')) && (await addFound(A, 'C'));
  A.win.bleInterface.togglePanel();
  if (!paired) { console.log('PUENTERELE ' + JSON.stringify(Object.assign(r, { resultado: 'FALLO', error: 'no empareja' }))); process.exit(1); }
  for (const n of ['B', 'C']) { await openChatWith(A, n); sendText(A, 'hola ' + n); await sleep(1500); }
  radio.block(nA, nC); radio.block(nB, nC);
  [B, C].forEach((p) => p.win.bleInterface.net.tick());
  r.b_c_en_linea_s = await waitFor(() => C.win.bleInterface.net.online() && B.win.bleInterface.net.online(), 30000);
  // El relé que B ofrece primero no le abre la sesión (lo castigó por límite): la PRIMERA apertura que A le pide, falla
  const gwB = B.win.bleInterface.net.gw; let refused = 0;
  const oOpen = gwB._srvOpen.bind(gwB);
  gwB._srvOpen = function(from, dev, p) { if (!refused) { refused++; this._tx(dev, { op: 'k', s: p.s, ok: 0, why: 'no conecta' }); return; } return oOpen(from, dev, p); };
  // A: sin ninguna red (el sistema avisa «sin red»)
  const netA = A.win.bleInterface.net;
  nA.emit('onNetChange', { type: 'none', prev: 'wifi' });
  const t0 = Date.now();
  r.puente_listo_s = await waitFor(() => netA.gw && netA.gw.bridges.size >= 1 && Array.from(netA.gw.bridges.values()).some((b) => b.sock && b.sock._opened), 90000);
  r.rechazos = refused;
  await openChatWith(A, 'C'); sendText(A, 'por el puente');
  r.llega_s = await waitFor(async () => (await C.win.vaultLoadMessages(idA)).some((m) => !m._own && String(m.content).trim() === 'por el puente'), 60000);
  r.otro_rele = logs.some((l) => /\[A\] log: \[GW\] Pruebo otro relé por el mismo puente/.test(l));
  r.errores = logs.filter((l) => / error: /.test(l) && !/JSDOMERROR|styles\.css|Not implemented|GLOBAL TIMEOUT|net::ERR|fetch/.test(l)).slice(0, 5);
  const ok = r.rechazos === 1 && r.puente_listo_s !== null && r.puente_listo_s <= 15 && r.llega_s !== null && !r.errores.length;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('PUENTERELE ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_puenterele.txt'), logs.join('\n'));
  [A, B, C].forEach(shutdown); await r1.stop(); await r2.stop();
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('PUENTERELE ' + JSON.stringify({ prueba: 'puenterele', resultado: 'FALLO', error: String(e && e.message) })); fs.writeFileSync(path.join(__dirname, 'last_logs_puenterele.txt'), logs.join('\n')); process.exit(1); });
