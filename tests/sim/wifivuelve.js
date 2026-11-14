// Dueño 14-11: «cuando estoy en Bluetooth y activo yo el Wi-Fi, la aplicación no se da cuenta; debería darse cuenta del cambio
// de conexión e inmediatamente cambiar de conexión en los chats, para mandar las cosas de forma más rápida». A (S24) en el Wi-Fi de
// casa; B (vivo) con el Wi-Fi apagado: solo Bluetooth entre ellos, hablando. B ENCIENDE el Wi-Fi (la misma red de casa):
//  V1  B ve a A por Wi-Fi local en ≤ 5 s (el teléfono avisa de la red nueva y la app busca al momento);
//  V2  lo que B escribe justo después sale por Wi-Fi (no por Bluetooth) y llega;
//  V3  un archivo de 1,5 MB que B estaba mandando por Bluetooth pasa al Wi-Fi a mitad y llega entero (≤ 30 s).
// Uso: node wifivuelve.js <dir_build>
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone, installWebCrypto } = require('./native_mock');
const { NostrRelay } = require('./nostr_relay');

const buildDir = path.resolve(process.argv[2]);
const base = { readsContentFallback: true, retain: ['onPayloadReceived', 'onLanMessage', 'onLanUp', 'onLanDown'], closeOnNoService: true, pace: [15, 15], ioDelay: 25, asymmetric: true, noL2: true, noTor: true }; // noL2: sin canal L2CAP (como la tablet del dueño): un archivo > 5 MB va por el flujo normal, no por big_file.js
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
    beforeParse(win) { win.NEXO_NET_RELAYS = RELAYS.map((u) => u + '/?p=' + name); win.CapacitorCustomPlatform = { name: 'android' }; installWebCrypto(win); const pl = native.plugin(); native.btWrites = []; const oS = pl.sendMessage; pl.sendMessage = (a) => { try { native.btWrites.push(String((a && (a.message || a.data || a.content)) || '')); } catch (e) {} return oS(a); }; win.Capacitor = { Plugins: { NexoBLE: pl } }; win.HTMLElement.prototype.scrollTo = function () {}; },
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
  const r = { prueba: 'wifivuelve', build: path.basename(buildDir) };
  RELAYS = []; // sin internet: solo Bluetooth y Wi-Fi local
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', Object.assign({}, base, { wifi: 'casa' })), nB = new NativePhone('B', 'BB:BB:BB:BB:BB:02', Object.assign({}, base));
  [nA, nB].forEach((n) => { radio.add(n); n.load(); });
  const A = await boot('A', nA), B = await boot('B', nB);
  const idA = A.win.bleInterface.localNexoId.toLowerCase(), idB = B.win.bleInterface.localNexoId.toLowerCase();
  A.win.bleInterface.togglePanel(); const paired = await addFound(A, 'B'); A.win.bleInterface.togglePanel();
  if (!paired) { console.log('WIFIVUELVE ' + JSON.stringify({ prueba: 'wifivuelve', resultado: 'FALLO', error: 'no empareja' })); process.exit(1); }
  await openChatWith(A, 'B'); sendText(A, 'hola B'); await sleep(2500);
  await openChatWith(B, 'A'); sendText(B, 'hola A por Bluetooth'); await sleep(2500);
  const linkB = () => { try { return B.win.bleInterface.linkOf(idA); } catch (e) { return '?'; } };
  r.antes = linkB();
  r.por_bluetooth = await waitFor(() => vaultMsgs(A, idB).then((l) => l.some((m) => m.content === 'hola A por Bluetooth')), 20000) !== null;
  // B empieza a mandar un archivo por Bluetooth
  const big = Buffer.alloc(1500000); for (let i = 0; i < big.length; i++) big[i] = (i * 7 + 3) & 255;
  const b64 = big.toString('base64');
  pickFile(B, 'grande.bin', big);
  await waitFor(() => logs.some((l) => /\[B\].*sendFile START .*to=(?!lan|net)/.test(l)), 15000);
  await sleep(1500);
  // B ENCIENDE el Wi-Fi (la misma red de casa)
  const t0 = Date.now();
  nB.setNetwork('wifi', 'casa');
  // (3096: listo = la app ya lo usa —Wi-Fi comprobado, linkOf 'wifi'—, no solo la conexión abierta: con eso, lo escrito en ese instante
  // podía salir aún por Bluetooth mientras se comprobaba la identidad y la V2 fallaba por carrera, 1 de cada varias en la batería)
  const v1 = await waitFor(() => linkB() === 'wifi', 30000);
  r.V1_wifi_listo_s = v1 === null ? null : Math.round((Date.now() - t0) / 100) / 10;
  r.despues = linkB();
  // V2: lo que escribe ahora sale por Wi-Fi
  const k2 = logs.length;
  sendText(B, 'ya con Wi-Fi');
  r.V2_llega_s = await waitFor(() => vaultMsgs(A, idB).then((l) => l.some((m) => m.content === 'ya con Wi-Fi')), 20000);
  // (3096: el registro de entrega dice el camino de verdad; antes ponía «Bluetooth» siempre y la prueba miraba otras líneas)
  await waitFor(() => logs.slice(k2).some((l) => /\[B\].*\[SEND\] Texto entregado .*salir por /.test(l)), 5000);
  r.V2_por_wifi = logs.slice(k2).some((l) => /\[B\].*\[SEND\] Texto entregado .*salir por Wi-Fi /.test(l));
  // V3: el archivo pasa al Wi-Fi y llega entero
  const v3 = await waitFor(async () => !!(await findMsg(A, idB, b64, false)), 60000);
  r.V3_archivo_llega_s = v3 === null ? null : Math.round((Date.now() - t0) / 100) / 10;
  r.V3_paso_al_wifi = logs.some((l) => /\[B\].*(el archivo deja el Bluetooth|sigue por Wi-Fi|to=lan:)/.test(l));
  r.errores = logs.filter((l) => / error: /.test(l) && !/JSDOMERROR|styles\.css|Not implemented|net::ERR|fetch/.test(l)).slice(0, 5);
  const ok = r.por_bluetooth && r.V1_wifi_listo_s !== null && r.V1_wifi_listo_s <= 5 && r.V2_llega_s !== null && r.V2_por_wifi &&
    r.V3_archivo_llega_s !== null && r.V3_archivo_llega_s <= 30 && r.V3_paso_al_wifi && !r.errores.length;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('WIFIVUELVE ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_wifivuelve.txt'), logs.join('\n'));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('WIFIVUELVE ' + JSON.stringify({ prueba: 'wifivuelve', resultado: 'FALLO', error: String(e && e.message) })); console.error(e); fs.writeFileSync(path.join(__dirname, 'last_logs_wifivuelve.txt'), logs.join('\n')); process.exit(1); });
