// 3008 (dueño 11-11: «me llegan notificaciones y luego entro y no hay mensajes nuevos»; captura: «Alex pi · Mensaje nuevo»).
// Con la app cerrada, el aviso nativo solo miraba si ese mismo SOBRE ya había llegado, no si el MENSAJE ya estaba en el teléfono:
// cuando el otro reenviaba algo que ya tenías (un envío que en su lado seguía pendiente), salía «Mensaje nuevo» y al entrar no había
// nada. Dos teléfonos por Bluetooth:
//  N1  A manda un texto con B abierta → B lo recibe y la app le avisa al nativo que ya lo tiene (markMsgsSeen).
//  N2  B se cierra; A REENVÍA ese mismo mensaje (mismo id) → el nativo de B NO avisa «Mensaje nuevo».
//  N3  con B cerrada, A manda un texto NUEVO → el nativo de B SÍ avisa.
// Uso: node notifseen.js <dir_build>
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
  const r = { prueba: 'notifseen', build: path.basename(buildDir) };
  RELAYS = [];
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', Object.assign({}, base, { wifi: null })), nB = new NativePhone('B', 'BB:BB:BB:BB:BB:02', Object.assign({}, base, { wifi: null }));
  [nA, nB].forEach((n) => { radio.add(n); n.load(); });
  const A = await boot('A', nA); let B = await boot('B', nB);
  const idB = B.win.bleInterface.localNexoId.toLowerCase(), idA = A.win.bleInterface.localNexoId.toLowerCase();
  A.win.bleInterface.togglePanel(); const paired = await addFound(A, 'B'); A.win.bleInterface.togglePanel();
  if (!paired) { console.log('NOTIFSEEN ' + JSON.stringify(Object.assign(r, { resultado: 'FALLO', error: 'no empareja' }))); process.exit(1); }
  await openChatWith(A, 'B'); sendText(A, 'hola B'); await sleep(2000);
  await openChatWith(B, 'A'); sendText(B, 'hola A'); await sleep(2000);
  await openChatWith(A, 'B');
  // N1
  sendText(A, 'primero de A');
  r.N1_llega_s = await waitFor(async () => (await B.win.vaultLoadMessages(idA)).some((m) => !m._own && m.content === 'primero de A'), 30000);
  const own = (await A.win.vaultLoadMessages(idB)).find((m) => m._own && m.content === 'primero de A');
  const X = own && (own.msgId || own.messageId);
  r.N1_entregado_s = await waitFor(async () => /delivered|read/.test(((await A.win.vaultLoadMessages(idB)).find((m) => (m.msgId || m.messageId) === X) || {}).status || ''), 20000);
  r.N1_app_avisa_al_nativo = await waitFor(() => !!(nB.seenMsgs && nB.seenMsgs.has(X)), 10000) !== null;
  // N2: B cerrada; A reenvía el MISMO mensaje (mismo id)
  B.win.close(); nB.destroyActivity(); await sleep(1500);
  const t0 = Date.now();
  const ak = A.win.bleInterface.ackSystem;
  try { ak._done && ak._done.delete(X); } catch (e) {}
  const dev = A.win.bleInterface._resolveDeviceIdForNexoId(idB);
  try { await ak.sendWithRetry(dev, 'primero de A', X, undefined, { to: idB }); } catch (e) {}
  await sleep(6000);
  const n2 = nB.notifLog.filter((n) => n.t >= t0 && !n.update && !n.call);
  r.N2_avisos = n2.length;
  r.N2_reenvio_llego_al_nativo = (nB.bgInbox || []).length > 0 || (nB.seenSkips || 0) > 0 || n2.length > 0;
  r.N2_sin_aviso = n2.length === 0;
  // N3: mensaje NUEVO con B cerrada → sí avisa
  const t1 = Date.now();
  sendText(A, 'nuevo con B cerrada');
  r.N3_avisa_s = await waitFor(() => nB.notifLog.some((n) => n.t >= t1 && !n.update && !n.call), 30000);
  r.errores = logs.filter((l) => / error: /.test(l) && !/JSDOMERROR|styles\.css|Not implemented|GLOBAL TIMEOUT|net::ERR|fetch/.test(l)).slice(0, 5);
  const ok = r.N1_llega_s !== null && r.N1_app_avisa_al_nativo && r.N2_reenvio_llego_al_nativo && r.N2_sin_aviso && r.N3_avisa_s !== null && !r.errores.length;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('NOTIFSEEN ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_notifseen.txt'), logs.join('\n'));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('NOTIFSEEN ' + JSON.stringify({ prueba: 'notifseen', resultado: 'FALLO', error: String(e && e.message).replace(/"/g, "'") })); console.error(e && e.stack); fs.writeFileSync(path.join(__dirname, 'last_logs_notifseen.txt'), logs.join('\n')); process.exit(1); });
