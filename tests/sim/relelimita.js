// 3347 (diag. Roberto, motorola, build 3159, 26-11 16:42): los relés LIMITABAN a su teléfono («rate-limited: too many gift wraps from
// this address»). Sus textos al dueño —con el Wi-Fi local y el Bluetooth del dueño listos— salían por internet, se reintentaban 5 veces
// por los mismos relés (más sobres, más castigo) y quedaban fallidos; el reenvío de pendientes volvía a internet y otra vez lo mismo.
// Ahora: un «rate-limited» de los relés hace que internet deje de ir primero 60 s; el texto sigue ya por el camino listo.
// Escenario: A (Wi-Fi) y B (datos) emparejados por Bluetooth y los dos en internet (internet va primero). Los relés limitan a A.
// A manda un texto corto: debe llegar por Bluetooth en pocos segundos y no quedar fallido.
// Uso: node relelimita.js <dir_build>
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone, installWebCrypto } = require('./native_mock');
const { NostrRelay } = require('./nostr_relay');

const buildDir = path.resolve(process.argv[2]);
const base = { readsContentFallback: true, retain: ['onPayloadReceived', 'onLanMessage', 'onLanUp', 'onLanDown'], closeOnNoService: true, pace: [15, 15], ioDelay: 25, asymmetric: true, noL2: true };
let RELAYS = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
class DistLoader extends ResourceLoader {
  constructor(dir) { super(); this.dir = dir; }
  fetch(url) { const f = path.join(this.dir, decodeURIComponent(new URL(url).pathname)); return fs.existsSync(f) ? Promise.resolve(fs.readFileSync(f)) : Promise.reject(new Error('no existe ' + f)); }
}
const logs = [];
async function boot(name, native) {
  native.listeners = new Map();
  const vc = new VirtualConsole();
  ['log', 'warn', 'error'].forEach((l) => vc.on(l, (...a) => logs.push(`${new Date().toISOString().substring(14, 23)} [${name}] ${l}: ` + a.map(String).join(' ').substring(0, 300))));
  const dom = new JSDOM(fs.readFileSync(path.join(buildDir, 'dist', 'index.html'), 'utf8'), {
    url: 'https://' + name.toLowerCase() + '.nexo.test/index.html', runScripts: 'dangerously',
    resources: new DistLoader(path.join(buildDir, 'dist')), pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) {
      win.NEXO_NET_RELAYS = RELAYS; win.CapacitorCustomPlatform = { name: 'android' }; installWebCrypto(win);
      const pl = native.plugin(); const oS = pl.sendMessage;
      win.Capacitor = { Plugins: { NexoBLE: pl } }; win.HTMLElement.prototype.scrollTo = function () {};
      const Real = win.WebSocket;
      const tagged = (u) => { try { const x = new URL(String(u)); if (x.hostname === '127.0.0.1') { x.searchParams.set('p', name + '_'); return x.toString(); } } catch (e) {} return u; };
      const WS = function (u, pr) { return pr ? new Real(tagged(u), pr) : new Real(tagged(u)); };
      WS.CONNECTING = 0; WS.OPEN = 1; WS.CLOSING = 2; WS.CLOSED = 3; WS.prototype = Real.prototype;
      win.WebSocket = WS;
    },
  });
  const win = dom.window;
  for (let i = 0; i < 1000 && !(win.NEXO && win.NEXO.initialized); i++) await sleep(10);
  await sleep(800);
  return { name, native, win };
}
const click = (win, el) => el && el.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
async function openChatWith(p, name) {
  const row = Array.from(p.win.document.querySelectorAll('#main-contacts-list .ble-contact-row')).find((r) => (r.querySelector('.ble-contact-name') || {}).textContent === name);
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
async function waitFor(fn, ms) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return Math.round((Date.now() - t0) / 100) / 10; await sleep(200); } return null; }
(async () => {
  const r = { prueba: 'relelimita', build: path.basename(buildDir) };
  const r1 = new NostrRelay(), r2 = new NostrRelay();
  RELAYS = [await r1.start(), await r2.start()];
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', Object.assign({}, base, { wifi: 'casa', noTor: true })), nB = new NativePhone('B', 'BB:BB:BB:BB:BB:02', Object.assign({}, base, { noTor: true }));
  [nA, nB].forEach((n) => { radio.add(n); n.load(); });
  const A = await boot('A', nA), B = await boot('B', nB);
  const idA = A.win.bleInterface.localNexoId.toLowerCase(), idB = B.win.bleInterface.localNexoId.toLowerCase();
  A.win.bleInterface.togglePanel(); const paired = await addFound(A, 'B'); A.win.bleInterface.togglePanel();
  if (!paired) { console.log('RELELIMITA ' + JSON.stringify({ prueba: 'relelimita', resultado: 'FALLO', error: 'no empareja' })); process.exit(1); }
  await openChatWith(A, 'B'); sendText(A, 'hola B'); await sleep(3000);
  await openChatWith(B, 'A'); sendText(B, 'hola A'); await sleep(3000);
  const netA = () => A.win.bleInterface.net;
  netA().tick(); B.win.bleInterface.net.tick();
  r.bt_y_internet = await waitFor(() => !!A.win.bleInterface._bleReadyFor(idB) && netA().canReach(idB), 60000) !== null;
  r.no_ambos_wifi = !netA().bothWifi(idB);
  await openChatWith(A, 'B');
  [r1, r2].forEach((x) => x.rejectTag('p=A_'));
  const t = 'texto con los relés limitando';
  sendText(A, t);
  r.llega_s = await waitFor(async () => (await B.win.vaultLoadMessages(idA)).some((m) => m.content === t), 40000);
  await sleep(500);
  const own = (await A.win.vaultLoadMessages(idB)).find((m) => m._own && m.content === t);
  r.estado_A = own && own.status;
  r.rechazos = [r1, r2].reduce((n, x) => n + x.stats.rejected.filter((y) => y === 'tag').length, 0);
  r.cambio_de_camino = logs.some((l) => /\[A\]/.test(l) && /los relés limitan/.test(l));
  r.errores = logs.filter((l) => / error: /.test(l) && !/JSDOMERROR|styles\.css|Not implemented|net::ERR|fetch|WebSocket/.test(l)).slice(0, 5);
  const ok = r.bt_y_internet && r.no_ambos_wifi && r.llega_s !== null && r.llega_s <= 6 && r.estado_A !== 'failed' && r.cambio_de_camino && !r.errores.length;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('RELELIMITA ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_relelimita.txt'), logs.join('\n'));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('RELELIMITA ' + JSON.stringify({ prueba: 'relelimita', resultado: 'FALLO', error: String(e && e.message) })); console.error(e); fs.writeFileSync(path.join(__dirname, 'last_logs_relelimita.txt'), logs.join('\n')); process.exit(1); });
