// 3009 (diagnóstico S24 11-11 10:14, «el Bluetooth está lento»): cada teléfono con NEXO anuncia por DOS direcciones —la normal (1M)
// y la de LARGO ALCANCE (LE Coded)— con el mismo código. La app se conectaba también a la de largo alcance de teléfonos que estaban al
// lado y esas conexiones fallaban (133/147) tras 2–10 s cada una, una y otra vez. Dos teléfonos por Bluetooth:
//  L1  A ve a B por su dirección normal; llega la copia de LARGO ALCANCE de B (otra dirección, mismo código) → A no se conecta a ella
//      y sigue usando la normal.
//  L2  control: un código que SOLO se ve por largo alcance (teléfono lejos) se usa (3012: tras esperar ~3 s por si llega la normal).
//  L3  (3012) la copia de largo alcance llega ANTES que la normal: no se usa (antes sí: conexión que fallaba y atascaba la cola).
// Uso: node codedscan.js <dir_build>
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone, installWebCrypto } = require('./native_mock');
const { NostrRelay } = require('./nostr_relay');
const { importSrc } = require('./srcmod');

const buildDir = path.resolve(process.argv[2] || path.join(__dirname, 'builds/wip'));
const SIN_PONG = false;
const base = { noNativePong: SIN_PONG, readsContentFallback: true, retain: ['onPayloadReceived', 'onLanMessage', 'onLanUp', 'onLanDown'], closeOnNoService: true, pace: [15, 15], ioDelay: 25, asymmetric: true, noTor: true };
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




const sleep2 = sleep;
async function waitFor(fn, ms) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return Math.round((Date.now() - t0) / 100) / 10; await sleep2(250); } return null; }
(async () => {
  const r = { prueba: 'codedscan', build: path.basename(buildDir) };
  RELAYS = [];
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', Object.assign({}, base, { wifi: null })), nB = new NativePhone('B', 'BB:BB:BB:BB:BB:02', Object.assign({}, base, { wifi: null }));
  [nA, nB].forEach((n) => { radio.add(n); n.load(); });
  const A = await boot('A', nA); const B = await boot('B', nB);
  const idB = B.win.bleInterface.localNexoId.toLowerCase();
  A.win.bleInterface.togglePanel(); const paired = await addFound(A, 'B'); A.win.bleInterface.togglePanel();
  if (!paired) { console.log('CODEDSCAN ' + JSON.stringify(Object.assign(r, { resultado: 'FALLO', error: 'no empareja' }))); process.exit(1); }
  await openChatWith(A, 'B'); sendText(A, 'hola B'); await sleep(2000);
  const bi = A.win.bleInterface;
  // la última vez que A vio a B por la dirección normal (lo que entrega el nativo)
  let lastB = null; const origScan = bi._onScanFound.bind(bi);
  bi._onScanFound = (d, retried) => { if (d && /BB:BB/i.test(String(d.deviceId || ''))) lastB = Object.assign({}, d); return origScan(d, retried); };
  for (let i = 0; i < 40 && !lastB; i++) { if (!bi.isScanning) bi.toggleScan(); await sleep(500); }
  r.visto_normal = !!lastB;
  const conn = []; const origConn = bi._autoConnectGATT.bind(bi);
  bi._autoConnectGATT = (dev, d, o) => { conn.push(String(dev)); return origConn(dev, d, o); };
  const ridCalls = { n: 0 }; const origRid = bi._ridFound.bind(bi);
  bi._ridFound = (d, rt) => { ridCalls.n++; return origRid(d, rt); };
  const macAntes = bi._nexoIdToMac.get(idB);
  const macsPuestas = []; const origSet = bi._nexoIdToMac.set.bind(bi._nexoIdToMac);
  bi._nexoIdToMac.set = (k, v) => { macsPuestas.push(String(v)); return origSet(k, v); };
  // L1: copia de largo alcance de B (otra dirección, mismo código)
  if (lastB) {
    const n0 = ridCalls.n;
    bi._onScanFound(Object.assign({}, lastB, { deviceId: '7C:0D:ED:00:00:01', coded: true, rssi: -49 }));
    await sleep(500);
    r.L1_ignorada = ridCalls.n === n0 && !conn.some((d) => /7C:0D:ED/i.test(d));
    r.L1_sigue_normal = !macsPuestas.some((m) => /7c0ded000001/i.test(m));
  }
  // L2: el mismo teléfono visto SOLO por largo alcance (sin verlo por la normal en los últimos 20 s: lejos) → se procesa como siempre
  // (3012: una copia de largo alcance SIN la normal espera ~3 s por si la normal llega después; si no llega, se usa)
  let soloLargo = false; const scan2 = bi._onScanFound.bind(bi);
  bi._onScanFound = (d, retried) => { if (soloLargo && d && !d.coded && /BB:BB/i.test(String(d.deviceId || ''))) return; return scan2(d, retried); };
  if (lastB) {
    soloLargo = true;                       // B «lejos»: su dirección normal ya no se ve
    if (bi._seen1MTok) bi._seen1MTok.clear();
    bi._onScanFound(Object.assign({}, lastB, { deviceId: '7C:0D:ED:00:00:03', coded: true, rssi: -50 }));
    await sleep(600);
    r.L2_espera_a_la_normal = !macsPuestas.some((m) => /7c0ded000003/i.test(m));
    await sleep(3200);
    r.L2_procesada = macsPuestas.some((m) => /7c0ded000003/i.test(m));
    // ya confirmado «solo por largo alcance»: la siguiente vista se usa sin esperar
    bi._onScanFound(Object.assign({}, lastB, { deviceId: '7C:0D:ED:00:00:04', coded: true, rssi: -50 }));
    await sleep(300);
    r.L2_siguiente_sin_espera = macsPuestas.some((m) => /7c0ded000004/i.test(m));
    soloLargo = false;
  }
  // L3 (3012, registro del teléfono de Marcos 11-11): la copia de largo alcance llega ANTES que la normal → no se usa
  if (lastB) {
    if (bi._seen1MTok) bi._seen1MTok.clear();
    if (bi._codedOnly) bi._codedOnly.clear();
    const c0 = conn.length;
    bi._onScanFound(Object.assign({}, lastB, { deviceId: '7C:0D:ED:00:00:05', coded: true, rssi: -48 }));
    await sleep(400);
    bi._onScanFound(Object.assign({}, lastB));   // la normal, 0,4 s después
    await sleep(3600);
    r.L3_largo_primero_no_se_usa = !macsPuestas.some((m) => /7c0ded000005/i.test(m)) && !conn.slice(c0).some((d) => /7C:0D:ED:00:00:05/i.test(d));
  }
  r.errores = logs.filter((l) => / error: /.test(l) && !/JSDOMERROR|styles\.css|Not implemented|GLOBAL TIMEOUT|net::ERR|fetch/.test(l)).slice(0, 5);
  const ok = r.visto_normal && r.L1_ignorada && r.L1_sigue_normal && r.L2_espera_a_la_normal && r.L2_procesada && r.L2_siguiente_sin_espera && r.L3_largo_primero_no_se_usa && !r.errores.length;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('CODEDSCAN ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_codedscan.txt'), logs.join('\n'));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('CODEDSCAN ' + JSON.stringify({ prueba: 'codedscan', resultado: 'FALLO', error: String(e && e.message).replace(/"/g, "'") })); console.error(e && e.stack); fs.writeFileSync(path.join(__dirname, 'last_logs_codedscan.txt'), logs.join('\n')); process.exit(1); });
