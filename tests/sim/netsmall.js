// 3127 (diagnóstico S24 3067, 15-11 08:01: una nota de voz de 3 s —56 KB— al S23 por internet tardó 138 s: la app del S23 dormía, con
// datos móviles, y el S24 reenviaba la ventana ENTERA —todo el audio— cada 8 s; los relés guardan lo publicado, así que eso solo gasta
// datos de los dos). El «sondeo» de la 3005 (1 trozo cada 60 s) solo valía para archivos grandes (≥ 64 trozos). Ahora también un
// archivo pequeño por internet sin un solo trozo confirmado entra en sondeo, con 1 trozo cada 15 s (no 60: es lo que el usuario espera).
// Prueba: A y B en Wi-Fi distintas (solo internet); la app de B no procesa nada (dormida); A manda 60 KB (6 trozos).
//  N1 en 60 s callado A publica como mucho 20 trozos (contraprueba 3126: ~45, la ventana entera cada 8 s);
//  N2 B despierta y el archivo llega en ≤ 30 s.
// Uso: node netsmall.js <dir_build>
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
      win.NEXO_BLOB_ONLINE = false; // 3128: ≤ 5 MB a un contacto en línea va al buzón de archivos; aquí se mide el flujo por trozos (sigue para > 5 MB, Tor y reanudaciones)
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
const BYTES = 60000;                        // 60 KB → ~80 000 caracteres en base64 (6 trozos de 16 000), como una nota de voz
const SILENCE_MS = 60000;
async function waitFor(fn, ms) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return Math.round((Date.now() - t0) / 100) / 10; await sleep(250); } return null; }
function shutdown(p) {
  try { p.win.bleInterface.net._closeAll(); p.win.bleInterface.net.relays.forEach((rl) => { rl.retryAt = Date.now() + 9e6; }); } catch (e) {}
  p.win.close(); p.native.destroyActivity();
}
async function filesAt(p, from) { const l = await p.win.vaultLoadMessages(from); return l.filter((m) => !m._own && (m.attachmentRef || m.attachmentPayload) && m.attachmentType === 'file'); }
function rxProgress(p) { let best = null; try { p.win.bleInterface.ackSystem.incomingBuffers.forEach((b) => { if (b && b.total > 100 && (!best || b.received > best.received)) best = b; }); } catch (e) {} return best ? { rx: best.received, total: best.total } : null; }
// trozos de archivo que A publica por internet (contenido > 10 000 car.)
let chunkSends = 0, chunkSendsAt = [];
function countSends(p) { const net = p.win.bleInterface.net; const o = net.send.bind(net); net.send = (nx, content, opts) => { if (String(content || '').length > 10000) { chunkSends++; chunkSendsAt.push(Date.now()); } return o(nx, content, opts); }; }
function silence(p, on) { const bi = p.win.bleInterface; if (!bi.__origNP) bi.__origNP = bi._onNetPayload.bind(bi); bi._onNetPayload = on ? function () {} : bi.__origNP; }

(async () => {
  const r = { prueba: 'netsmall', build: path.basename(buildDir) };
  const r1 = new NostrRelay(), r2 = new NostrRelay();
  RELAYS = [await r1.start(), await r2.start()];
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', Object.assign({}, base, { wifi: 'casa' })), nB = new NativePhone('B', 'BB:BB:BB:BB:BB:02', Object.assign({}, base, { wifi: 'oficina' }));
  [nA, nB].forEach((n) => { radio.add(n); n.load(); });
  const A = await boot('A', nA); const B = await boot('B', nB);
  const idA = A.win.bleInterface.localNexoId.toLowerCase(), idB = B.win.bleInterface.localNexoId.toLowerCase();
  A.win.bleInterface.togglePanel(); const paired = await addFound(A, 'B'); A.win.bleInterface.togglePanel();
  if (!paired) { console.log('NETSMALL ' + JSON.stringify(Object.assign(r, { resultado: 'FALLO', error: 'no empareja' }))); process.exit(1); }
  await openChatWith(A, 'B'); sendText(A, 'hola B'); await sleep(2000);
  await openChatWith(B, 'A'); sendText(B, 'hola A'); await sleep(2000);
  radio.block(nA, nB);
  A.win.bleInterface.net.tick(); B.win.bleInterface.net.tick();
  r.en_linea_por_internet_s = await waitFor(() => A.win.bleInterface.linkOf(idB) === 'internet' && B.win.bleInterface.linkOf(idA) === 'internet', 60000);
  await openChatWith(A, 'B');
  countSends(A);
  const buf = Buffer.alloc(BYTES); for (let i = 0; i < buf.length; i++) buf[i] = (i * 31 + 7) & 255;
  silence(B, true);
  const s0 = chunkSends;
  pickFile(A, 'nota.bin', buf);
  await sleep(SILENCE_MS);
  r.N1_trozos_publicados_callado = chunkSends - s0;
  silence(B, false);
  try { B.win.bleInterface.net.tick(); } catch (e) {}
  r.N2_llega_s = await waitFor(async () => (await filesAt(B, idA)).length >= 1, 90000);
  r.errores = logs.filter((l) => / error: /.test(l) && !/JSDOMERROR|styles\.css|Not implemented|GLOBAL TIMEOUT|net::ERR|fetch/.test(l)).slice(0, 5);
  const ok = r.en_linea_por_internet_s !== null && r.N1_trozos_publicados_callado <= 20 && r.N2_llega_s !== null && r.N2_llega_s <= 30 && !r.errores.length;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('NETSMALL ' + JSON.stringify(r));
  try { fs.writeFileSync(path.join(__dirname, 'last_logs_netsmall.txt'), logs.join('\n')); } catch (e) {}
  shutdown(A); shutdown(B); await r1.stop(); await r2.stop();
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('NETSMALL ' + JSON.stringify({ prueba: 'netsmall', resultado: 'FALLO', error: String(e && e.message).replace(/"/g, "'") })); console.error(e && e.stack); process.exit(1); });
