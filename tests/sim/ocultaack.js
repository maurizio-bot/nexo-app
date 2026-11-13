// 3034 (diagnóstico S24 12-11 17:54, «reenvio_sin_fin» con …db61, 3 vueltas): lo que no se confirmaba eran ACCIONES OCULTAS
// (estado/foto de perfil al reconectar) a un teléfono con la app en segundo plano y congelada. Su nativo confirma los textos (al
// avisar, 2833) pero las acciones ocultas (marca q:1) ni se avisan ni se confirmaban → el S24 las reenviaba sin fin.
// A y B por Bluetooth; B en segundo plano y CONGELADA; A publica un estado (acción oculta hacia B):
//  Q1  la copia queda ENTREGADA (✓✓) con B todavía congelada (confirmación nativa, sin aviso en B);
//  Q2  A no la reenvía en vueltas (≤ 1 vuelta de reenvío en 50 s);
//  Q3  B no muestra ningún aviso por ella; Q4  B despierta → tiene el estado (una vez).
// Contraprueba: NEXO_OLD_QUIETACK=1 (nativo ≤ 3033).
// Uso: node ocultaack.js <dir_build>
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
  const r = { prueba: 'ocultaack', build: path.basename(buildDir), nativo_viejo: process.env.NEXO_OLD_QUIETACK === '1' };
  RELAYS = [];
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', Object.assign({}, base, { wifi: null })), nB = new NativePhone('B', 'BB:BB:BB:BB:BB:02', Object.assign({}, base, { wifi: null }));
  [nA, nB].forEach((n) => { radio.add(n); n.load(); });
  const A = await boot('A', nA); const B = await boot('B', nB);
  const idB = B.win.bleInterface.localNexoId.toLowerCase(), idA = A.win.bleInterface.localNexoId.toLowerCase();
  A.win.bleInterface.togglePanel(); const paired = await addFound(A, 'B'); A.win.bleInterface.togglePanel();
  if (!paired) { console.log('OCULTAACK ' + JSON.stringify(Object.assign(r, { resultado: 'FALLO', error: 'no empareja' }))); process.exit(1); }
  await openChatWith(A, 'B'); sendText(A, 'hola B'); await sleep(2000);
  await openChatWith(B, 'A'); sendText(B, 'hola A'); await sleep(3000);
  B.win.dispatchEvent(new B.win.CustomEvent('nexo:ble:closeChat', { detail: {} }));
  nB.setAppActive(false); nB.setFrozen(true);
  { const bi = B.win.bleInterface; B.win.clearInterval(bi._supervisorTimer); bi._supervisorTimer = null; }
  const delivered = new Set();
  A.win.addEventListener('nexo:ble:ackStatus', (e) => { const d = e && e.detail; if (d && (d.status === 'delivered' || d.status === 'read')) delivered.add(String(d.msgId)); });
  const notif0 = (nB.notifications && nB.notifications.size) || 0;
  const mark = logs.length;
  const sid = A.win.NEXO_addMyStatus('estado con B dormido');
  await sleep(1500);
  const copias = (await A.win.vaultLoadMessages(idB)).filter((m) => m._own && m.hidden).map((m) => m.msgId);
  r.copias = copias.length;
  r.Q1_confirmada_s = await waitFor(async () => copias.length > 0 && copias.every((id) => delivered.has(id)), 30000);
  await sleep(Math.max(0, 50000 - (r.Q1_confirmada_s || 30) * 1000));
  const re = new RegExp('\\[A\\] log: \\[BLEInterface\\] Reenviando \\d+ pending para ' + idB, 'i');
  r.Q2_vueltas = logs.slice(mark).filter((l) => re.test(l)).length;
  r.Q3_sin_aviso = ((nB.notifications && nB.notifications.size) || 0) === notif0;
  nB.setFrozen(false); nB.setAppActive(true);
  { const bi = B.win.bleInterface; bi._supervisorTimer = B.win.setInterval(() => bi._runSupervisorCycle(), bi._supervisorIntervalMs); }
  r.Q4_estado_s = await waitFor(() => (B.win.NEXO_statusesOf(idA) || []).filter((x) => x.sid === sid).length === 1, 30000);
  r.errores = logs.filter((l) => / error: /.test(l) && !/JSDOMERROR|styles\.css|Not implemented|GLOBAL TIMEOUT|net::ERR|fetch/.test(l)).slice(0, 5);
  const ok = r.copias > 0 && r.Q1_confirmada_s !== null && r.Q2_vueltas <= 1 && r.Q3_sin_aviso && r.Q4_estado_s !== null && !r.errores.length;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('OCULTAACK ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_ocultaack.txt'), logs.join('\n'));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('OCULTAACK ' + JSON.stringify({ prueba: 'ocultaack', resultado: 'FALLO', error: String(e && e.message).replace(/"/g, "'") })); console.error(e && e.stack); fs.writeFileSync(path.join(__dirname, 'last_logs_ocultaack.txt'), logs.join('\n')); process.exit(1); });
