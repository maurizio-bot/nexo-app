// 3081 (paso 3 del dueño 14-11: «medir en el diagnóstico la velocidad real de cada camino en mis teléfonos»). Cada archivo enviado o
// recibido anota camino, tamaño, tiempo y KB/s; cada camino, cuánto tardó en quedar listo. A y B por Bluetooth:
//  V1  un archivo de 200 KB por Bluetooth: A anota «Bluetooth enviado … KB/s» y B «Bluetooth recibido»;
//  V2  los dos entran al mismo Wi-Fi: «Wi-Fi local listo en … s»; otro archivo de 200 KB sale por el Wi-Fi y se anota, más rápido;
//  V3  el diagnóstico de A trae la sección «Velocidad de hoy por camino» y el resumen diario las líneas «velocidad por camino»;
//  V4  la conexión Bluetooth lista también se anota (al emparejar).
// Uso: node velocidad.js <dir_build>
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone, installWebCrypto } = require('./native_mock');
const { NostrRelay } = require('./nostr_relay');

const buildDir = path.resolve(process.argv[2]);
const base = { readsContentFallback: true, retain: ['onPayloadReceived', 'onLanMessage', 'onLanUp', 'onLanDown'], closeOnNoService: true, pace: [15, 15], ioDelay: 25, asymmetric: true, noL2: true }; // noL2: sin canal L2CAP (como la tablet del dueño): un archivo > 5 MB va por el flujo normal, no por big_file.js
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
    beforeParse(win) { win.NEXO_NET_RELAYS = RELAYS; win.CapacitorCustomPlatform = { name: 'android' }; installWebCrypto(win); const pl = native.plugin(); native.btWrites = []; const oS = pl.sendMessage; pl.sendMessage = (a) => { try { native.btWrites.push(String((a && (a.message || a.data || a.content)) || '')); } catch (e) {} return oS(a); }; win.Capacitor = { Plugins: { NexoBLE: pl } }; win.HTMLElement.prototype.scrollTo = function () {}; },
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
  const r = { prueba: 'velocidad', build: path.basename(buildDir) };
  RELAYS = [];
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', Object.assign({}, base, { wifi: null, noTor: true }));
  const nB = new NativePhone('B', 'BB:BB:BB:BB:BB:02', Object.assign({}, base, { wifi: null, noTor: true }));
  [nA, nB].forEach((n) => { radio.add(n); n.load(); });
  const A = await boot('A', nA), B = await boot('B', nB);
  const idA = A.win.bleInterface.localNexoId.toLowerCase(), idB = B.win.bleInterface.localNexoId.toLowerCase();
  A.win.bleInterface.togglePanel(); const paired = await addFound(A, 'B'); A.win.bleInterface.togglePanel();
  if (!paired) { console.log('VELOCIDAD ' + JSON.stringify(Object.assign(r, { resultado: 'FALLO', error: 'no empareja' }))); process.exit(1); }
  await openChatWith(A, 'B'); sendText(A, 'hola B'); await sleep(3000);
  await openChatWith(B, 'A'); sendText(B, 'hola A'); await sleep(3000);
  const has = (who, re) => logs.some((l) => l.indexOf('[' + who + ']') >= 0 && re.test(l));
  r.V4_bluetooth_listo = has('A', /\[VELOCIDAD\] Bluetooth listo en [\d,]+ s/) || has('B', /\[VELOCIDAD\] Bluetooth listo en [\d,]+ s/);
  // V1: por Bluetooth
  await openChatWith(A, 'B');
  pickFile(A, 'uno.bin', Buffer.alloc(200000, 3));
  r.V1_llega_s = await waitFor(async () => (await B.win.vaultLoadMessages(idA)).some((m) => m.attachmentType && !m._own && (m.attachmentMeta || {}).name === 'uno.bin'), 120000);
  r.V1_A_anota = await waitFor(() => has('A', /\[VELOCIDAD\] Bluetooth enviado: [\d,]+ KB en [\d,]+ s = [\d,]+ KB\/s/), 20000) !== null;
  r.V1_B_anota = has('B', /\[VELOCIDAD\] Bluetooth recibido: [\d,]+ KB/);
  // V2: mismo Wi-Fi
  nA.setWifi('casa'); nB.setWifi('casa');
  r.V2_wifi_listo_s = await waitFor(() => has('A', /\[VELOCIDAD\] Wi-Fi local listo en [\d,]+ s/), 60000);
  pickFile(A, 'dos.bin', Buffer.alloc(200000, 4));
  r.V2_llega_s = await waitFor(async () => (await B.win.vaultLoadMessages(idA)).some((m) => m.attachmentType && !m._own && (m.attachmentMeta || {}).name === 'dos.bin'), 60000);
  r.V2_A_anota = await waitFor(() => has('A', /\[VELOCIDAD\] Wi-Fi local enviado: /), 20000) !== null;
  const kbs = (re) => { const l = logs.filter((x) => x.indexOf('[A]') >= 0 && re.test(x)).pop(); const m = l && / = ([\d,]+) KB\/s/.exec(l); return m ? Number(m[1].replace(',', '.')) : null; };
  r.kbs_bluetooth = kbs(/\[VELOCIDAD\] Bluetooth enviado/); r.kbs_wifi = kbs(/\[VELOCIDAD\] Wi-Fi local enviado/);
  r.V2_wifi_mas_rapido = r.kbs_wifi !== null && r.kbs_bluetooth !== null && r.kbs_wifi > r.kbs_bluetooth;
  // V3: diagnóstico y resumen diario
  const diag = typeof A.win.NEXO_diagText === 'function' ? A.win.NEXO_diagText() : '';
  r.V3_diag = /Velocidad de hoy por camino:\n  archivos por Wi-Fi local: enviados 1, media [\d,]+ KB\/s/.test(diag) && /archivos por Bluetooth: enviados 1/.test(diag) && /conexión lista en \(media\): .*Wi-Fi local/.test(diag);
  const lines = A.win.NEXO_speedLines ? A.win.NEXO_speedLines() : [];
  r.V3_lineas = lines.slice(0, 4);
  r.errores = logs.filter((l) => / error: /.test(l) && !/JSDOMERROR|styles\.css|Not implemented|net::ERR|fetch/.test(l)).slice(0, 5);
  const ok = r.V4_bluetooth_listo && r.V1_llega_s !== null && r.V1_A_anota && r.V1_B_anota && r.V2_wifi_listo_s !== null && r.V2_llega_s !== null && r.V2_A_anota && r.V2_wifi_mas_rapido && r.V3_diag && !r.errores.length;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('VELOCIDAD ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_velocidad.txt'), logs.join('\n'));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('VELOCIDAD ' + JSON.stringify({ prueba: 'velocidad', resultado: 'FALLO', error: String(e && e.message) })); console.error(e); fs.writeFileSync(path.join(__dirname, 'last_logs_velocidad.txt'), logs.join('\n')); process.exit(1); });
