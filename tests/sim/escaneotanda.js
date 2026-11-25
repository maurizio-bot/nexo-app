// MULTITUD / EDC (docs/EDC_LIMITES.md cambio 5; 23-11) — avisos del escaneo EN TANDA. Con muchos teléfonos cerca el nativo ya no
// avisa a la app de cada dirección por separado: los junta (onDevicesFound { list }, ScanBook.kt). Aquí A y B reciben TODOS sus
// avisos de escaneo así (opts.scanBatch) entre 60 NEXO más que anuncian con su código rotativo (teléfonos «fantasma»: no corren la
// app, solo están ahí, como la gente de un vagón), y aun así:
//  1. A encuentra a B en «Agregar» y lo agrega.   2. Un texto de A llega a B y vuelve la ✓✓.   3. Hubo tandas (no avisos sueltos).
// Uso: node escaneotanda.js <dir_build>
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone } = require('./native_mock');

const buildDir = path.resolve(process.argv[2]);
const opts = { readsContentFallback: true, retain: ['onPayloadReceived'], closeOnNoService: true, pace: [15, 15], ioDelay: 10, asymmetric: true, scanBatch: true };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
class DistLoader extends ResourceLoader {
  constructor(dir) { super(); this.dir = dir; }
  fetch(url) { const f = path.join(this.dir, decodeURIComponent(new URL(url).pathname)); return fs.existsSync(f) ? Promise.resolve(fs.readFileSync(f)) : Promise.reject(new Error('no existe ' + f)); }
}
const logs = [];
async function boot(name, native) {
  const vc = new VirtualConsole();
  ['log', 'warn', 'error'].forEach((l) => vc.on(l, (...a) => logs.push(`${new Date().toISOString().substring(14, 23)} [${name}] ${l}: ` + a.map(String).join(' ').substring(0, 300))));
  const dom = new JSDOM(fs.readFileSync(path.join(buildDir, 'dist', 'index.html'), 'utf8'), {
    url: 'https://' + name.toLowerCase() + '.nexo.test/index.html', runScripts: 'dangerously',
    resources: new DistLoader(path.join(buildDir, 'dist')), pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) { win.CapacitorCustomPlatform = { name: 'android' }; require('./native_mock').installWebCrypto(win); win.Capacitor = { Plugins: { NexoBLE: native.plugin() } }; win.HTMLElement.prototype.scrollTo = function () {}; },
  });
  const win = dom.window;
  for (let i = 0; i < 100 && !(win.NEXO && win.NEXO.initialized); i++) await sleep(100);
  await sleep(800);
  return { name, native, win };
}
const click = (win, el) => el && el.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
async function openChatWith(p, name) {
  const row = Array.from(p.win.document.querySelectorAll('#main-contacts-list .ble-contact-row')).find((r) => (r.querySelector('.ble-contact-name') || {}).textContent === name);
  click(p.win, row); await sleep(500); return !!row;
}
async function sendText(p, t) { const i = p.win.document.getElementById('message-input'); i.value = t; i.dispatchEvent(new p.win.Event('input', { bubbles: true })); click(p.win, p.win.document.getElementById('send-btn')); }
async function addFound(p, name) {
  let add = null;
  const find = () => { const row = Array.from(p.win.document.querySelectorAll('#ble-new-device > div')).find((d) => (d.querySelector('span') || {}).textContent === name); return row && row.querySelector('button'); };
  for (let i = 0; i < 400 && !add; i++) { await sleep(100); add = find(); if (!add && !p.win.bleInterface.isScanning) click(p.win, p.win.document.getElementById('ble-scan-btn')); }
  click(p.win, add); await sleep(2000);
  return !!add;
}
const wait = async (c, s) => { for (let i = 0; i < s * 5; i++) { if (await c()) return true; await sleep(200); } return !!(await c()); };

(async () => {
  const radio = new Radio();
  // 60 NEXO desconocidos alrededor (app dormida, código rotativo): llegan en la misma tanda que B
  const nodeCrypto = require('crypto');
  for (let i = 0; i < 60; i++) {
    const g = new NativePhone('G' + i, 'EE:00:00:00:00:' + (i + 16).toString(16).toUpperCase(), { noRid: false, rssi: -55 - (i % 35) });
    g.isGhost = true; g.advertisingId = 'nx' + nodeCrypto.randomBytes(4).toString('hex'); g.serviceRunning = true; g.serverUp = true; g.appActive = false;
    g.ridKey = nodeCrypto.randomBytes(32).toString('hex'); g.ridVisibleUntil = 0; g.ridEpochS = 900;
    radio.add(g);
  }
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', opts), nB = new NativePhone('B', 'BB:BB:BB:BB:BB:02', opts);
  [nA, nB].forEach((n) => { radio.add(n); n.load(); });
  const A = await boot('A', nA), B = await boot('B', nB);
  const r = { build: path.basename(buildDir) };
  const idA = A.win.bleInterface.localNexoId.toLowerCase(), idB = B.win.bleInterface.localNexoId.toLowerCase();
  A.win.bleInterface.togglePanel(); r.A_encuentra_y_agrega_a_B = await addFound(A, 'B'); A.win.bleInterface.togglePanel();
  r.hubo_tandas = (nA.stats.scanBatches || 0) > 0;
  r.tanda_con_muchos = (nA.stats.scanBatchMax || 0) >= 40;   // B y la multitud, juntos en una misma tanda
  await openChatWith(A, 'B'); await sendText(A, 'hola entre la multitud');
  r.llega_a_B = await wait(async () => (await B.win.vaultLoadMessages(idA)).some((m) => /hola entre la multitud/.test(m.content || '')), 40);
  r.vuelve_la_doble_palomita = await wait(async () => (await A.win.vaultLoadMessages(idB)).some((m) => /hola entre la multitud/.test(m.content || '') && /delivered|read/.test(m.status || '')), 40);
  r.errores = logs.filter((l) => / error: /.test(l) && !/JSDOMERROR|styles\.css/.test(l)).slice(0, 5);
  const fails = Object.keys(r).filter((k) => r[k] === false);
  if (r.errores.length) fails.push('errores');
  r.resultado = fails.length ? 'FALLO' : 'OK';
  if (fails.length) r.fallan = fails;
  console.log('ESCANEOTANDA ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_escaneotanda.txt'), logs.join('\n'));
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error(e); fs.writeFileSync(path.join(__dirname, 'last_logs_escaneotanda.txt'), logs.join('\n')); process.exit(1); });
