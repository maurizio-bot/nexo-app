// 3180 (ciudad 17-11, semilla 3 #142 y semilla 2 #218: una foto ⏳ toda la fase final con «Reenviando ADJUNTO» y ningún «sendFile
// START»): un archivo que espera en la cola de «enlace Bluetooth ocupado» (como mucho un archivo chico a la vez por enlace) se quedaba
// ahí. A–B–C en fila (A y C fuera de alcance; sin internet): A le manda archivos a C por Jump y B, el puente, los reenvía a C ocupando
// el hueco de archivos de su enlace con C; mientras tanto B le manda a C una foto suya:
//  1. al terminar el reenvío, la foto de B tiene que salir (antes el reenvío de Jump no avisaba a la cola: se quedaba para siempre);
//  2. con otro reenvío largo en curso, B y C entran al mismo Wi-Fi: la foto de B sale YA por el Wi-Fi (no espera a la cola del
//     Bluetooth; antes cualquier intento nuevo, aunque fuera por Wi-Fi o internet, solo se sumaba a la espera).
// Uso: node colabt.js <dir_build>
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone, installWebCrypto } = require('./native_mock');

const buildDir = path.resolve(process.argv[2] || path.join(__dirname, 'builds/wip'));
const opts = { readsContentFallback: true, retain: ['onPayloadReceived', 'onLanMessage', 'onLanUp', 'onLanDown'], closeOnNoService: true, pace: [15, 15], ioDelay: 25, asymmetric: true, noTor: true };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
class DL extends ResourceLoader { constructor(d) { super(); this.d = d; } fetch(u) { const f = path.join(this.d, decodeURIComponent(new URL(u).pathname)); return fs.existsSync(f) ? Promise.resolve(fs.readFileSync(f)) : Promise.reject(new Error('x')); } }
class NoNetWS { constructor(u) { this.url = u; this.readyState = 0; setTimeout(() => { this.readyState = 3; if (this.onerror) this.onerror({}); if (this.onclose) this.onclose({ code: 1006 }); }, 30); } send() { throw new Error('sin red'); } close() {} addEventListener() {} removeEventListener() {} }
const logs = [];
const T0 = Date.now();
const ts = () => String(((Date.now() - T0) / 1000).toFixed(1)).padStart(6) + 's';
async function boot(name, native) {
  native.listeners = new Map();
  native.calls = { push() {}, length: 0, filter() { return []; }, slice() { return []; }, forEach() {}, map() { return []; }, some() { return false; }, find() { return undefined; } };
  const vc = new VirtualConsole();
  ['log', 'warn', 'error'].forEach((l) => vc.on(l, (...a) => logs.push(`${ts()} [${name}] ${l}: ` + a.map(String).join(' ').substring(0, 260))));
  const dom = new JSDOM(fs.readFileSync(path.join(buildDir, 'dist', 'index.html'), 'utf8'), {
    url: 'https://' + name.toLowerCase() + '.nexo.test/index.html', runScripts: 'dangerously', resources: new DL(path.join(buildDir, 'dist')), pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) {
      win.CapacitorCustomPlatform = { name: 'android' }; installWebCrypto(win);
      win.Capacitor = { Plugins: { NexoBLE: native.plugin() } }; win.HTMLElement.prototype.scrollTo = function () {};
      win.WebSocket = NoNetWS; // sin internet: solo Bluetooth (y el Wi-Fi local del paso 2)
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
  click(p.win, row); await sleep(600); return !!row;
}
async function closeChat(p) { p.win.dispatchEvent(new p.win.CustomEvent('nexo:ble:closeChat', { detail: {} })); await sleep(300); }
function sendText(p, t) { const i = p.win.document.getElementById('message-input'); i.value = t; i.dispatchEvent(new p.win.Event('input', { bubbles: true })); click(p.win, p.win.document.getElementById('send-btn')); }
async function addFound(p, name) {
  let add = null;
  const find = () => { const row = Array.from(p.win.document.querySelectorAll('#ble-new-device > div')).find((d) => (d.querySelector('span') || {}).textContent === name); return row && row.querySelector('button'); };
  for (let i = 0; i < 400 && !add; i++) { await sleep(100); add = find(); if (!add && !p.win.bleInterface.isScanning) click(p.win, p.win.document.getElementById('ble-scan-btn')); }
  click(p.win, add); await sleep(2000);
  return !!add;
}
async function waitFor(fn, ms) { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (await fn()) return Math.round((Date.now() - t0) / 100) / 10; } catch (e) {} await sleep(200); } return null; }
async function sendFile(p, name, bytes) {
  const b = Buffer.alloc(bytes); for (let i = 0; i < b.length; i++) b[i] = (i * 31 + name.length * 7 + (i >> 9)) & 255;
  click(p.win, p.win.document.querySelector('.attach-menu-item[data-type="file"]')); await sleep(100);
  const fin = Array.from(p.win.document.querySelectorAll('input[type=file]')).pop();
  Object.defineProperty(fin, 'files', { configurable: true, value: [new p.win.File([b], name, { type: 'application/octet-stream' })] });
  fin.dispatchEvent(new p.win.Event('change'));
  return b.toString('base64');
}
async function hasFile(p, from, b64) {
  const list = await p.win.vaultLoadMessages(from);
  return list.some((m) => !m._own && m.attachmentType && !m.deleted && (m.attachmentPayload || p.native.files.get(m.attachmentRef)) === b64);
}
// ¿B está reenviando un archivo de Jump (forwardStream) hacia C?
const forwarding = (B) => Array.from(B.win.bleInterface.ackSystem.outgoingStreams.values()).some((s) => s && !s.aborted && s.type === 'file' && s.meta && s.meta.fwd);
const enCola = () => logs.filter((l) => l.indexOf('[B] log: [BleAckSystem] sendFile EN COLA') >= 0).length;

(async () => {
  const r = { prueba: 'colabt', build: path.basename(buildDir) };
  const radio = new Radio();
  const nat = { A: new NativePhone('A', 'AA:AA:AA:AA:AA:01', opts), B: new NativePhone('B', 'BB:BB:BB:BB:BB:02', opts), C: new NativePhone('C', 'CC:CC:CC:CC:CC:03', opts) };
  Object.values(nat).forEach((n) => { radio.add(n); n.load(); });
  const P = {};
  for (const n of ['A', 'B', 'C']) P[n] = await boot(n, nat[n]);
  const { A, B, C } = P;
  const id = (p) => p.win.bleInterface.localNexoId.toLowerCase();
  const idA = id(A), idB = id(B), idC = id(C);
  async function pair(x, y) {
    const others = ['A', 'B', 'C'].filter((n) => n !== x && n !== y);
    others.forEach((o) => radio.block(nat[x], nat[o]));
    P[x].win.bleInterface.togglePanel(); const ok = await addFound(P[x], y); P[x].win.bleInterface.togglePanel();
    await sleep(800);
    await openChatWith(P[x], y); sendText(P[x], 'hola ' + y); await sleep(2500);
    const keyOf = (a, b) => !!(P[a].win.vaultLoadContacts().find((c) => c.name === b) || {}).publicKey;
    for (let i = 0; i < 40 && !keyOf(x, y); i++) await sleep(500);
    await closeChat(P[x]);
    others.forEach((o) => radio.unblock(nat[x], nat[o]));
    return ok;
  }
  const paired = (await pair('A', 'B')) && (await pair('B', 'C')) && (await pair('A', 'C'));
  if (!paired) { console.log('COLABT ' + JSON.stringify(Object.assign(r, { resultado: 'FALLO', error: 'no empareja' }))); process.exit(1); }
  radio.block(nat.A, nat.C);
  r.ruta_s = await waitFor(() => A.win.bleInterface.linkOf(idC) === 'jump', 60000);
  await openChatWith(A, 'C'); await openChatWith(B, 'C');

  // ---- 1: la foto de B espera en la cola (B reenvía el archivo de A) y tiene que salir al terminar el reenvío ----
  const f1 = await sendFile(A, 'de_a_1.bin', 300 * 1024);
  r.reenvio1_s = await waitFor(() => forwarding(B), 90000);
  const q1 = enCola(), p1 = await sendFile(B, 'foto_b_1.jpg', 30 * 1024);
  r.en_cola1 = (await waitFor(() => enCola() > q1, 8000)) !== null;
  r.f1_llega_s = await waitFor(() => hasFile(C, idA, f1), 120000);
  r.p1_tras_reenvio_s = await waitFor(() => hasFile(C, idB, p1), 45000);

  // ---- 2: otro reenvío largo; la foto de B espera; B y C entran al mismo Wi-Fi: sale ya por ahí ----
  const f2 = await sendFile(A, 'de_a_2.bin', 380 * 1024);
  r.reenvio2_s = await waitFor(() => forwarding(B), 90000);
  const q2 = enCola(), p2 = await sendFile(B, 'foto_b_2.jpg', 30 * 1024);
  r.en_cola2 = (await waitFor(() => enCola() > q2, 8000)) !== null;   // la foto ya espera en la cola (cifrada) antes del Wi-Fi
  nat.B.setNetwork('wifi', 'casa'); nat.C.setNetwork('wifi', 'casa');
  r.wifi_s = await waitFor(() => B.win.bleInterface.lan && B.win.bleInterface.lan.canReach(idC), 30000);
  const tW = Date.now();
  r.p2_tras_wifi_s = await waitFor(() => hasFile(C, idB, p2), 60000);
  r.reenvio2_seguia = forwarding(B); // el reenvío de Jump (Bluetooth) aún en curso cuando la foto ya llegó por el Wi-Fi
  r.f2_llega_s = await waitFor(() => hasFile(C, idA, f2), 120000);
  r.sale_de_la_cola = logs.filter((l) => /esperaba en la cola del Bluetooth ocupado/.test(l)).length;
  r.errores = logs.filter((l) => / error: /.test(l) && !/JSDOMERROR|styles\.css|Not implemented|GLOBAL TIMEOUT|net::ERR|fetch|ECONNREFUSED|WebSocket/.test(l)).slice(0, 5);
  const ok = r.ruta_s !== null && r.reenvio1_s !== null && r.en_cola1 && r.f1_llega_s !== null && r.p1_tras_reenvio_s !== null &&
    r.reenvio2_s !== null && r.en_cola2 && r.wifi_s !== null && r.p2_tras_wifi_s !== null && r.p2_tras_wifi_s <= 10 && r.f2_llega_s !== null && !r.errores.length;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('COLABT ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_colabt.txt'), logs.join('\n'));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('COLABT ' + JSON.stringify({ prueba: 'colabt', resultado: 'FALLO', error: String(e && e.message).replace(/"/g, "'") })); console.error(e && e.stack); fs.writeFileSync(path.join(__dirname, 'last_logs_colabt.txt'), logs.join('\n')); process.exit(1); });
