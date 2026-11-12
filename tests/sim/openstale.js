// 3017 (dueño 12-11, diagnósticos S23 y HONOR con la 3014): al abrir un chat (también al tocar un aviso) se usaba PRIMERO la
// dirección Bluetooth guardada en el contacto y se forzaba la conexión a ella, aunque ya no sirviera (dirección rotada, o un
// enlace repetido que la propia app cerró): escrituras atascadas ~6 s ×2 antes de pasar al Wi-Fi. Ahora se usa el mejor camino
// vivo (Wi-Fi comprobado, internet, enlace Bluetooth listo) y la guardada solo si no hay otro.
// A y B emparejados y en la misma Wi-Fi (comprobada); la dirección guardada de B en A es una VIEJA que ya no existe:
//  O1  abrir el chat NO fuerza la conexión a la dirección vieja (ni la toma como la del chat);
//  O2  un texto llega y queda entregado sin esperas (< 5 s).
// Uso: node openstale.js <dir_build>
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
  const r = { prueba: 'openstale', build: path.basename(buildDir) };
  RELAYS = [];
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', Object.assign({}, base, { wifi: null })), nB = new NativePhone('B', 'BB:BB:BB:BB:BB:02', Object.assign({}, base, { wifi: null }));
  [nA, nB].forEach((n) => { radio.add(n); n.load(); });
  const A = await boot('A', nA); const B = await boot('B', nB);
  const idB = B.win.bleInterface.localNexoId.toLowerCase(), idA = A.win.bleInterface.localNexoId.toLowerCase();
  A.win.bleInterface.togglePanel(); const paired = await addFound(A, 'B'); A.win.bleInterface.togglePanel();
  if (!paired) { console.log('OPENSTALE ' + JSON.stringify(Object.assign(r, { resultado: 'FALLO', error: 'no empareja' }))); process.exit(1); }
  await openChatWith(A, 'B'); sendText(A, 'hola B'); await sleep(2000);
  await openChatWith(B, 'A'); sendText(B, 'hola A'); await sleep(3000);
  nA.setWifi('casa'); nB.setWifi('casa');
  r.wifi_comprobado_s = await waitFor(async () => logs.some((l) => /\[A\] log: \[WIFI\] Conectado con .* por Wi-Fi \(comprobado\)/.test(l)), 60000);
  // la dirección guardada de B en A pasa a ser una vieja que ya no existe (rotó / enlace cerrado)
  const OLD = 'CC:CC:CC:CC:CC:09';
  const cs = A.win.vaultLoadContacts(); const cB = cs.find((c) => String(c.nexoId || c.deviceUUID || '').toLowerCase() === idB);
  if (cB) { cB.deviceId = OLD; A.win.vaultSaveContacts(cs); }
  r.vieja_puesta = !!cB;
  const mark = logs.length;
  await A.win.bleInterface.openChat(idB); await sleep(1500);
  r.O1_forzada = logs.slice(mark).some((l) => l.indexOf('forcing connectToDevice for ' + OLD) >= 0);
  r.O1_chat_dev = String(A.win.bleInterface._activeChatDeviceIdNative || '');
  r.O1_ok = !r.O1_forzada && r.O1_chat_dev.toUpperCase() !== OLD;
  const t = 'tras abrir el chat';
  sendText(A, t);
  const st = async () => { const m = (await A.win.vaultLoadMessages(idB)).find((x) => x._own && x.content === t); return m ? m.status : null; };
  r.O2_entregado_s = await waitFor(async () => /delivered|read/.test(String(await st())), 20000);
  r.errores = logs.filter((l) => / error: /.test(l) && !/JSDOMERROR|styles\.css|Not implemented|GLOBAL TIMEOUT|net::ERR|fetch/.test(l)).slice(0, 5);
  const ok = r.vieja_puesta && r.wifi_comprobado_s !== null && r.O1_ok && r.O2_entregado_s !== null && r.O2_entregado_s < 5 && !r.errores.length;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('OPENSTALE ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_openstale.txt'), logs.join('\n'));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('OPENSTALE ' + JSON.stringify({ prueba: 'openstale', resultado: 'FALLO', error: String(e && e.message).replace(/"/g, "'") })); console.error(e && e.stack); fs.writeFileSync(path.join(__dirname, 'last_logs_openstale.txt'), logs.join('\n')); process.exit(1); });
