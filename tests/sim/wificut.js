// Ronda 2767: cortes del Wi-Fi (regla del dueño: el Wi-Fi se mantiene y tras un corte se esperan 15 s a que vuelva).
// A y B en el mismo Wi-Fi y por Bluetooth.
//  1. Corte breve (6 s): un texto escrito durante el corte llega en cuanto vuelve el Wi-Fi, sin "!".
//  2. Corte largo (el Wi-Fi no vuelve): llega por Bluetooth al acabar el margen. Antes, mientras tanto, la burbuja
//     mostraba "!" (no enviado) unos 10 s. Debe: nunca "!" (pendiente, con el reloj).
// Uso: node wificut.js <dir_build>
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone } = require('./native_mock');

const buildDir = path.resolve(process.argv[2]);
const opts = { readsContentFallback: true, retain: ['onPayloadReceived', 'onLanMessage', 'onLanUp', 'onLanDown'], closeOnNoService: true, pace: [15, 15], ioDelay: 25, asymmetric: true, wifi: 'casa', noTor: true };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
class DL extends ResourceLoader { constructor(d) { super(); this.d = d; } fetch(u) { const f = path.join(this.d, decodeURIComponent(new URL(u).pathname)); return fs.existsSync(f) ? Promise.resolve(fs.readFileSync(f)) : Promise.reject(new Error('x')); } }
const logs = [];
async function boot(name, native) {
  const vc = new VirtualConsole();
  ['log', 'warn', 'error'].forEach((l) => vc.on(l, (...a) => logs.push(`${new Date().toISOString().substring(14, 23)} [${name}] ${l}: ` + a.map(String).join(' ').substring(0, 250))));
  const dom = new JSDOM(fs.readFileSync(path.join(buildDir, 'dist', 'index.html'), 'utf8'), {
    url: 'https://' + name.toLowerCase() + '.nexo.test/index.html', runScripts: 'dangerously', resources: new DL(path.join(buildDir, 'dist')), pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) { win.CapacitorCustomPlatform = { name: 'android' }; require('./native_mock').installWebCrypto(win); win.Capacitor = { Plugins: { NexoBLE: native.plugin() } }; win.HTMLElement.prototype.scrollTo = function () {}; },
  });
  const win = dom.window;
  for (let i = 0; i < 100 && !(win.NEXO && win.NEXO.initialized); i++) await sleep(100);
  await sleep(800);
  return { name, native, win };
}
const click = (w, el) => el && el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
async function openChatWith(p, name) {
  let row; for (let i = 0; i < 300 && !row; i++) { row = Array.from(p.win.document.querySelectorAll('#main-contacts-list .ble-contact-row')).find((r) => (r.querySelector('.ble-contact-name') || {}).textContent === name); if (!row) await sleep(100); }
  click(p.win, row); await sleep(600); return !!row;
}
function sendText(p, t) { const i = p.win.document.getElementById('message-input'); i.value = t; i.dispatchEvent(new p.win.Event('input', { bubbles: true })); click(p.win, p.win.document.getElementById('send-btn')); }
const wait = async (c, s) => { const t0 = Date.now(); for (let i = 0; i < s * 5; i++) { if (await c()) return Math.round((Date.now() - t0) / 100) / 10; await sleep(200); } return null; };
// Estados que ha ido mostrando la burbuja de ese texto en A
function watchBubble(p, text) {
  const seen = new Set();
  const t = setInterval(() => {
    const el = Array.from(p.win.document.querySelectorAll('#messages-container .message.own')).find((e) => (e.textContent || '').indexOf(text) >= 0);
    const s = el && el.querySelector('.msg-status');
    if (s) seen.add(s.className.replace(/.*status-/, ''));
  }, 150);
  return { stop: () => { clearInterval(t); return Array.from(seen); } };
}

(async () => {
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', opts), nB = new NativePhone('B', 'BB:BB:BB:BB:BB:02', opts);
  [nA, nB].forEach((n) => { radio.add(n); n.load(); });
  const [A, B] = await Promise.all([boot('A', nA), boot('B', nB)]);
  const biA = A.win.bleInterface;
  const idA = biA.localNexoId.toLowerCase(), idB = B.win.bleInterface.localNexoId.toLowerCase();
  const r = { build: path.basename(buildDir) };
  biA.togglePanel(); let add = null;
  for (let i = 0; i < 400 && !add; i++) { await sleep(100); add = A.win.document.querySelector('#ble-new-device > div button'); if (!add && !biA.isScanning) click(A.win, A.win.document.getElementById('ble-scan-btn')); }
  click(A.win, add); await sleep(1500);
  if (A.win.document.getElementById('ble-panel').classList.contains('active')) biA.togglePanel();
  await openChatWith(A, 'B'); sendText(A, 'hola'); await sleep(2500);
  r.wifi_s = await wait(() => biA.linkOf(idB) === 'wifi' && B.win.bleInterface.linkOf(idA) === 'wifi', 60);
  const has = async (t) => (await B.win.vaultLoadMessages(idA)).some((m) => m.content === t);
  // 1. Corte breve
  nA.setWifi(null); nB.setWifi(null); await sleep(1000);
  const w1 = watchBubble(A, 'durante el corte');
  sendText(A, 'durante el corte');
  await sleep(5000);
  nA.setWifi('casa'); nB.setWifi('casa');
  r.breve_llega_tras_volver_s = await wait(() => has('durante el corte'), 30);
  await sleep(1000);
  r.breve_estados = w1.stop();
  r.breve_camino = biA.linkOf(idB);
  await wait(() => biA.linkOf(idB) === 'wifi', 30);
  await sleep(3000);
  // 2. Corte medio (~12 s): agota los reintentos cortos del ack (~8 s) → el texto queda PENDIENTE, pero el Wi-Fi
  //    vuelve DENTRO del margen (15 s), así que no lo rescata el giveUp→Bluetooth (que nunca llega a dispararse).
  //    Debe llegar igual en cuanto vuelve el Wi-Fi, sin "!".
  nA.setWifi(null); nB.setWifi(null); await sleep(1000);
  const w3 = watchBubble(A, 'corte medio');
  sendText(A, 'corte medio');
  await sleep(11000);
  nA.setWifi('casa'); nB.setWifi('casa');
  r.medio_llega_tras_volver_s = await wait(() => has('corte medio'), 30);
  await sleep(1000);
  r.medio_estados = w3.stop();
  await wait(() => biA.linkOf(idB) === 'wifi', 30);
  await sleep(3000);
  // 3. Corte largo
  nA.setWifi(null); nB.setWifi(null); await sleep(1000);
  const w2 = watchBubble(A, 'sin volver el wifi');
  sendText(A, 'sin volver el wifi');
  r.largo_llega_s = await wait(() => has('sin volver el wifi'), 45);
  await sleep(1000);
  r.largo_estados = w2.stop();
  r.errores = logs.filter((l) => / error: /.test(l) && !/JSDOMERROR|styles\.css|Not implemented/.test(l)).slice(0, 5);
  const ok = r.wifi_s !== null && r.breve_llega_tras_volver_s !== null && r.breve_llega_tras_volver_s <= 5 && r.breve_estados.indexOf('failed') < 0 &&
    r.medio_llega_tras_volver_s !== null && r.medio_llega_tras_volver_s <= 10 && r.medio_estados.indexOf('failed') < 0 &&
    r.largo_llega_s !== null && r.largo_llega_s <= 30 && r.largo_estados.indexOf('failed') < 0 && !r.errores.length;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('WIFICUT ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_wificut.txt'), logs.join('\n'));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error(e); fs.writeFileSync(path.join(__dirname, 'last_logs_wificut.txt'), logs.join('\n')); process.exit(1); });
