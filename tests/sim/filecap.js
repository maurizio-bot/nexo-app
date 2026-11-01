// #129 parte 2 (dueño 01-11, pacing BLE): al reconectar, NEXO arrancaba TODAS las transferencias de archivo a la vez
// (en el diagnóstico real se ven ~12 «sendFile START» juntos) e inundaba la cola nativa con MTU 23 → los textos/acks
// quedaban atrás y los mensajes se veían en ○. Ahora hay un TOPE de transferencias de archivo simultáneas por enlace
// Bluetooth (_maxBleFilesPerLink): las demás esperan en cola y arrancan al liberarse un hueco; todas llegan igual.
// Este test manda 4 archivos a la vez a B por Bluetooth y comprueba: (1) nunca hay más de `tope` streams de archivo
// a la vez, (2) los 4 llegan, (3) un TEXTO mandado en medio no se queda atascado (llega aunque haya archivos en curso).
// Uso: node filecap.js <dir_build>
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone, installWebCrypto } = require('./native_mock');

const buildDir = path.resolve(process.argv[2]);
const opts = { readsContentFallback: true, retain: ['onPayloadReceived'], closeOnNoService: true, pace: [10, 10], ioDelay: 0, asymmetric: true, noL2: true };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
class DistLoader extends ResourceLoader {
  constructor(dir) { super(); this.dir = dir; }
  fetch(url) { const f = path.join(this.dir, decodeURIComponent(new URL(url).pathname)); return fs.existsSync(f) ? Promise.resolve(fs.readFileSync(f)) : Promise.reject(new Error('no existe ' + f)); }
}
const logs = [];
async function boot(name, native) {
  native.listeners = new Map();
  const vc = new VirtualConsole();
  ['log', 'warn', 'error'].forEach((l) => vc.on(l, (...a) => logs.push(`[${name}] ${l}: ` + a.map(String).join(' ').substring(0, 220))));
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
async function openChat(p) { click(p.win, p.win.document.querySelector('#main-contacts-list .ble-contact-row')); await sleep(500); }
function sendText(p, t) { const i = p.win.document.getElementById('message-input'); i.value = t; i.dispatchEvent(new p.win.Event('input', { bubbles: true })); click(p.win, p.win.document.getElementById('send-btn')); }
async function waitFor(fn, ms) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return Math.round((Date.now() - t0) / 100) / 10; await sleep(150); } return null; }

(async () => {
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', opts), nB = new NativePhone('B', 'BB:BB:BB:BB:BB:02', opts);
  radio.add(nA); radio.add(nB); nA.load(); nB.load();
  const [A, B] = await Promise.all([boot('A', nA), boot('B', nB)]);
  const r = { build: path.basename(buildDir) };
  // Emparejar por Bluetooth
  A.win.bleInterface.togglePanel();
  let add = null;
  for (let i = 0; i < 400 && !add; i++) { await sleep(100); add = A.win.document.querySelector('#ble-new-device > div button'); if (!add && !A.win.bleInterface.isScanning) click(A.win, A.win.document.getElementById('ble-scan-btn')); }
  if (!add) { console.log('FILECAP ' + JSON.stringify({ resultado: 'FALLA: no empareja' })); process.exit(0); }
  click(A.win, add); await sleep(2500);
  A.win.bleInterface.togglePanel();
  await openChat(A);
  const bi = A.win.bleInterface, ack = bi.ackSystem, idB = B.win.bleInterface.localNexoId, idA = bi.localNexoId;
  r.tope = ack._maxBleFilesPerLink;
  // Esperar enlace Bluetooth listo y resolver el deviceId (MAC) de B
  await waitFor(() => { const d = bi._resolveDeviceIdForNexoId(idB); return d && d.indexOf('net:') < 0 && d.indexOf('lan:') < 0; }, 30000);
  const devId = bi._resolveDeviceIdForNexoId(idB);
  r.devId_es_bluetooth = !!(devId && devId.indexOf('net:') < 0 && devId.indexOf('lan:') < 0);
  // Contar streams de ARCHIVO activos (a cualquier destino: aquí todo va a B)
  const fileStreams = () => { let n = 0; ack.outgoingStreams.forEach((s) => { if (s && !s.aborted && s.type === 'file') n++; }); return n; };
  // Lanzar 4 archivos A LA VEZ (como el vaciado del backlog al reconectar)
  const N = 4, KB = 5;
  const sends = [];
  for (let i = 0; i < N; i++) {
    const b64 = Buffer.alloc(KB * 1024, (i * 37 + 11) & 255).toString('base64');
    sends.push(ack.sendFile(devId, 'cap-file-' + i, b64, { type: 'file', name: 'archivo' + i + '.bin', to: idB }));
  }
  // Muestrear la concurrencia mientras corren
  let maxConc = 0, maxQueue = 0, done = false;
  Promise.allSettled(sends).then(() => { done = true; });
  const t0 = Date.now();
  while (!done && Date.now() - t0 < 120000) {
    maxConc = Math.max(maxConc, fileStreams());
    maxQueue = Math.max(maxQueue, ack._fileStartQueue.size);
    // A mitad de la congestión, mandar un TEXTO: no debe quedarse atrás
    if (!r._textAt && Date.now() - t0 > 1500) { r._textAt = 1; await openChat(A); sendText(A, 'TEXTO-en-medio-de-archivos'); }
    await sleep(120);
  }
  r.max_streams_archivo_a_la_vez = maxConc;
  r.max_en_cola = maxQueue;
  const results = await Promise.allSettled(sends);
  r.archivos_ok = results.filter((x) => x.status === 'fulfilled').length + '/' + N;
  // ¿Llegó el texto a B aunque hubiera archivos en curso?
  r.texto_en_medio_llega_s = await waitFor(async () => (await B.win.vaultLoadMessages(idA)).some((m) => m.content === 'TEXTO-en-medio-de-archivos' && !m._own), 30000);
  // ¿Llegaron los 4 archivos a B?
  const bFiles = async () => (await B.win.vaultLoadMessages(idA)).filter((m) => !m._own && m.attachmentType === 'file').length;
  r.archivos_en_B = await waitFor(async () => (await bFiles()) >= N, 30000) !== null ? await bFiles() : await bFiles();
  const capOk = maxConc <= ack._maxBleFilesPerLink;
  const allOk = results.every((x) => x.status === 'fulfilled');
  const textOk = r.texto_en_medio_llega_s !== null;
  r.resultado = (capOk && allOk && textOk && r.devId_es_bluetooth) ? 'OK'
    : 'FALLA: ' + [!r.devId_es_bluetooth ? 'no-bluetooth' : '', !capOk ? 'concurrencia>' + ack._maxBleFilesPerLink : '', !allOk ? 'archivos no entregados' : '', !textOk ? 'texto atascado' : ''].filter(Boolean).join(', ');
  console.log('FILECAP ' + JSON.stringify(r));
  process.exit(0);
})().catch((e) => { console.log('FILECAP ' + JSON.stringify({ resultado: 'FALLA: ' + String((e && e.stack) || e) })); process.exit(1); });
