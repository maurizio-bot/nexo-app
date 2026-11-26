// 3346 (diagnóstico S24 3156 26-11 14:39–14:47, «zombi» con Marcos): un texto largo de grupo salió por Bluetooth en un momento en que el
// contacto no estaba en línea por internet (los relés acababan de reconectar); su Bluetooth seguía contestando los pings (nativo) pero su
// app no confirmaba ni un trozo. El envío reintentó la ventana 8 veces por ese Bluetooth mudo aunque, segundos después, el contacto ya
// estaba EN LÍNEA por internet: el camino bueno no se volvía a mirar al vencer las ventanas (solo al fallar la escritura nativa).
// Ahora: un envío por Bluetooth directo sin un trozo confirmado en 2 ventanas, con un camino mejor listo (internet/Wi-Fi), se rehace por él.
// Escenario: A y B emparejados por Bluetooth y los dos en internet. Se caen los relés; A manda un texto largo (va por Bluetooth) y el
// Bluetooth de B se lo «traga» sin confirmar (los pings sí pasan). Vuelven los relés: el texto debe llegar por internet en pocos segundos
// (antes de agotar los 8 reintentos de ventana: ≤ 10 s desde que vuelve internet).
// Uso: node btsinack.js <dir_build>
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
      // el Bluetooth «mudo»: con swallow activo, lo grande que A escribe por Bluetooth (trozos del texto) no llega; lo chico (pings, acks) sí
      pl.sendMessage = (a) => { const s = String((a && (a.message || a.data || a.content)) || ''); if (native.swallow && s.length > 250) { native.swallowed = (native.swallowed || 0) + 1; return Promise.resolve({ success: true }); } return oS(a); };
      win.Capacitor = { Plugins: { NexoBLE: pl } }; win.HTMLElement.prototype.scrollTo = function () {};
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
  const r = { prueba: 'btsinack', build: path.basename(buildDir) };
  const r1 = new NostrRelay(), r2 = new NostrRelay();
  RELAYS = [await r1.start(), await r2.start()];
  const ports = RELAYS.map((u) => Number(u.split(':').pop()));
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', Object.assign({}, base, { wifi: 'casa', noTor: true })), nB = new NativePhone('B', 'BB:BB:BB:BB:BB:02', Object.assign({}, base, { noTor: true }));
  [nA, nB].forEach((n) => { radio.add(n); n.load(); });
  const A = await boot('A', nA), B = await boot('B', nB);
  const idA = A.win.bleInterface.localNexoId.toLowerCase(), idB = B.win.bleInterface.localNexoId.toLowerCase();
  A.win.bleInterface.togglePanel(); const paired = await addFound(A, 'B'); A.win.bleInterface.togglePanel();
  if (!paired) { console.log('BTSINACK ' + JSON.stringify({ prueba: 'btsinack', resultado: 'FALLO', error: 'no empareja' })); process.exit(1); }
  await openChatWith(A, 'B'); sendText(A, 'hola B'); await sleep(3000);
  await openChatWith(B, 'A'); sendText(B, 'hola A'); await sleep(3000);
  const netA = () => A.win.bleInterface.net;
  netA().tick(); B.win.bleInterface.net.tick();
  r.bt_y_internet = await waitFor(() => !!A.win.bleInterface._bleReadyFor(idB) && netA().canReach(idB), 60000) !== null;
  // se caen los relés: el texto largo sale por Bluetooth, y el Bluetooth de B no lo confirma
  await r1.stop(); await r2.stop();
  r.sin_internet_s = await waitFor(() => !netA().canReach(idB), 60000);
  await openChatWith(A, 'B');
  nA.swallow = true;
  const largo = 'texto largo por un bluetooth mudo ' + 'x'.repeat(3000);
  sendText(A, largo);
  await sleep(1500);
  // vuelven los relés: B en línea por internet otra vez (el Bluetooth sigue «mudo» para lo grande)
  await r1.start(ports[0]); await r2.start(ports[1]);
  r.internet_vuelve_s = await waitFor(() => netA().canReach(idB), 60000);
  const t0 = Date.now();
  r.llega_s = await waitFor(async () => (await B.win.vaultLoadMessages(idA)).some((m) => m.content === largo), 60000);
  r.llega_desde_internet_s = r.llega_s === null ? null : Math.round((Date.now() - t0) / 100) / 10;
  r.tragados_por_bt = nA.swallowed || 0;
  r.reintentos_bt = logs.filter((l) => /^.{0,20}\[A\]/.test(l) && /Window timeout, reenviando/.test(l)).length;
  r.cambio_de_camino = logs.some((l) => /\[A\]/.test(l) && /Bluetooth no confirma.*sigue por/.test(l));
  r.errores = logs.filter((l) => / error: /.test(l) && !/JSDOMERROR|styles\.css|Not implemented|net::ERR|fetch|WebSocket/.test(l)).slice(0, 5);
  // antes: 8 ventanas por el Bluetooth mudo (~35 s) antes de rendirse y probar internet
  const ok = r.bt_y_internet && r.sin_internet_s !== null && r.internet_vuelve_s !== null && r.tragados_por_bt > 0 && r.llega_s !== null && r.llega_s <= 10 && r.cambio_de_camino && !r.errores.length;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('BTSINACK ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_btsinack.txt'), logs.join('\n'));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('BTSINACK ' + JSON.stringify({ prueba: 'btsinack', resultado: 'FALLO', error: String(e && e.message) })); console.error(e); fs.writeFileSync(path.join(__dirname, 'last_logs_btsinack.txt'), logs.join('\n')); process.exit(1); });
