// ¿Cuánto espera un texto detrás de los archivos? En el teléfono, Capacitor ejecuta todas las llamadas al plugin
// en UN hilo y en fila; guardar o leer un archivo lo ocupa según su tamaño (y desde la 2720, también cifrar).
// --ms-per-mb=N: coste de guardar/leer 1 MB en el teléfono (supuesto; por defecto 150). --off-thread: Kotlin
// 2721+ (los archivos en sus propios hilos, adjuntos aparte). Mide el tiempo hasta ✓✓ de un texto:
//  1) justo después de mandar un archivo de 1,5 MB;  2) justo al abrir un chat con 15 fotos;  3) sin nada más.
// Uso: node iolatency.js <dir_build> [--ms-per-mb=150] [--off-thread]
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone, installWebCrypto } = require('./native_mock');

const buildDir = path.resolve(process.argv[2]);
const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith('--' + k)); if (!a) return d; const v = a.split('=')[1]; return v === undefined ? true : Number(v); };
const msPerMb = arg('ms-per-mb', 150), offThread = !!arg('off-thread', false);
const opts = { readsContentFallback: true, retain: ['onPayloadReceived'], closeOnNoService: true, pace: [15, 15], ioDelay: 25, asymmetric: true, pluginThread: msPerMb, ioOffThread: offThread };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
class DistLoader extends ResourceLoader {
  constructor(dir) { super(); this.dir = dir; }
  fetch(url) { const f = path.join(this.dir, decodeURIComponent(new URL(url).pathname)); return fs.existsSync(f) ? Promise.resolve(fs.readFileSync(f)) : Promise.reject(new Error('no existe ' + f)); }
}
const logs = [];
async function boot(name, native) {
  native.listeners = new Map();
  const vc = new VirtualConsole();
  ['log', 'warn', 'error'].forEach((l) => vc.on(l, (...a) => logs.push(`${new Date().toISOString().substring(14, 23)} [${name}] ${l}: ` + a.map(String).join(' ').substring(0, 250))));
  const dom = new JSDOM(fs.readFileSync(path.join(buildDir, 'dist', 'index.html'), 'utf8'), {
    url: 'https://' + name.toLowerCase() + '.nexo.test/index.html', runScripts: 'dangerously',
    resources: new DistLoader(path.join(buildDir, 'dist')), pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) { win.CapacitorCustomPlatform = { name: 'android' }; installWebCrypto(win); win.Capacitor = { Plugins: { NexoBLE: native.plugin() } }; win.HTMLElement.prototype.scrollTo = function () {}; },
  });
  const win = dom.window;
  for (let i = 0; i < 100 && !(win.NEXO && win.NEXO.initialized); i++) await sleep(100);
  await sleep(800);
  return { name, native, win };
}
const click = (win, el) => el && el.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
async function openChatWith(p, name) {
  const row = Array.from(p.win.document.querySelectorAll('#main-contacts-list .ble-contact-row')).find((r) => (r.querySelector('.ble-contact-name') || {}).textContent === name);
  click(p.win, row); await sleep(50); return !!row;
}
async function closeChat(p) { p.win.dispatchEvent(new p.win.CustomEvent('nexo:ble:closeChat', { detail: {} })); await sleep(300); }
function sendText(p, t) { const i = p.win.document.getElementById('message-input'); i.value = t; i.dispatchEvent(new p.win.Event('input', { bubbles: true })); click(p.win, p.win.document.getElementById('send-btn')); }
function sendFile(p, name, bytes) {
  const file = Buffer.alloc(bytes); for (let i = 0; i < file.length; i++) file[i] = (i * 13 + name.length) & 255;
  click(p.win, p.win.document.querySelector('.attach-menu-item[data-type="file"]'));
  const fin = Array.from(p.win.document.querySelectorAll('input[type=file]')).pop();
  Object.defineProperty(fin, 'files', { configurable: true, value: [new p.win.File([file], name, { type: 'application/octet-stream' })] });
  fin.dispatchEvent(new p.win.Event('change'));
}
async function addFound(p, name) {
  let add = null;
  const find = () => { const row = Array.from(p.win.document.querySelectorAll('#ble-new-device > div')).find((d) => (d.querySelector('span') || {}).textContent === name); return row && row.querySelector('button'); };
  for (let i = 0; i < 400 && !add; i++) { await sleep(100); add = find(); if (!add && !p.win.bleInterface.isScanning) click(p.win, p.win.document.getElementById('ble-scan-btn')); }
  click(p.win, add); await sleep(2000);
  return !!add;
}
const statusOf = (p, t) => { const m = Array.from(p.win.document.querySelectorAll('#messages-container .message.own')).find((x) => (x.querySelector('.msg-content') || {}).textContent === t); return m ? (m.querySelector('.msg-status') || {}).className.replace('msg-status status-', '') : 'sin burbuja'; };
async function timeToDelivered(p, t, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { const s = statusOf(p, t); if (s === 'delivered' || s === 'read') return Math.round((Date.now() - t0) / 100) / 10; await sleep(100); }
  return null;
}
const maxWait = (nat) => { const w = nat.stats.sendWaits || []; const m = w.length ? Math.max(...w) : 0; nat.stats.sendWaits = []; return m; };

(async () => {
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', opts), nB = new NativePhone('B', 'BB:BB:BB:BB:BB:02', opts);
  radio.add(nA); radio.add(nB); nA.load(); nB.load();
  const A = await boot('A', nA), B = await boot('B', nB);
  const r = { build: path.basename(buildDir), ms_por_MB: msPerMb, archivos_en_otro_hilo: offThread };
  A.win.bleInterface.togglePanel(); const paired = await addFound(A, 'B'); A.win.bleInterface.togglePanel();
  if (!paired) { console.log('IOLAT ' + JSON.stringify({ error: 'no empareja' })); process.exit(0); }
  await openChatWith(A, 'B'); await sleep(500); sendText(A, 'hola B'); await sleep(3000);
  await openChatWith(B, 'A'); await sleep(500);

  // 3) Sin nada más (referencia)
  maxWait(nA);
  sendText(A, 'texto solo');
  r.texto_solo_s = await timeToDelivered(A, 'texto solo', 60000);
  r.texto_solo_espera_max_ms = maxWait(nA);
  await sleep(1500);

  // 1) Justo después de mandar un archivo de 1,5 MB
  sendFile(A, 'grande.bin', 1500000); await sleep(50);
  sendText(A, 'texto tras archivo');
  r.texto_tras_archivo_s = await timeToDelivered(A, 'texto tras archivo', 180000);
  r.texto_tras_archivo_espera_max_ms = maxWait(nA);
  for (let i = 0; i < 1200; i++) { if ((await B.win.vaultLoadMessages(A.win.bleInterface.localNexoId)).some((m) => m.attachmentType === 'file')) break; await sleep(250); }
  await sleep(2000);

  // 2) Al abrir un chat con 15 fotos (las manda B)
  for (let i = 0; i < 15; i++) { sendFile(B, 'foto' + i + '.jpg', 100000); await sleep(300); }
  for (let i = 0; i < 1200; i++) { if ((await A.win.vaultLoadMessages(B.win.bleInterface.localNexoId)).filter((m) => m.attachmentType).length >= 16) break; await sleep(250); }
  await sleep(3000);
  await closeChat(A);
  await sleep(500);
  maxWait(nA);
  await openChatWith(A, 'B');
  sendText(A, 'texto al abrir');
  r.texto_al_abrir_chat_s = await timeToDelivered(A, 'texto al abrir', 120000);
  r.texto_al_abrir_espera_max_ms = maxWait(nA);

  console.log('IOLAT ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_iolatency.txt'), logs.join('\n'));
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
