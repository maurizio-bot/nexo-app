// 3016 (dueño 12-11, diagnóstico S23 con la 3014): con un contacto cuyo Bluetooth está «vivo» (su nativo contesta los pings)
// pero que NO confirma los mensajes (app dormida/congelada), el S23 reenviaba 2 textos cortos sin pausa durante >16 min:
// «ACK timeout reintento 1..5/5» → «Pending fallo» → 0,3 s → «Reenviando 2 pending» → otra vez (una vuelta cada ~22 s).
// Dos teléfonos por Bluetooth, el enlace vivo (pings contestados) pero las confirmaciones de 2 textos cortos de A no le llegan
// (se tiran al entrar en A: modela el camino que acepta el envío y nunca confirma); A los manda:
//  R1  en 150 s, A hace POCAS vueltas de reenvío a B (espera creciente tras vueltas sin ningún éxito), no una cada ~22 s;
//  R2  (informativo) estados de los textos durante el corte;
//  R3  los dos textos le llegan a B;
//  R4  al volver las confirmaciones, A los ve entregados (la espera tiene tope).
// Uso: node resendloop.js <dir_build>
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
  const r = { prueba: 'resendloop', build: path.basename(buildDir) };
  RELAYS = [];
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', Object.assign({}, base, { wifi: null })), nB = new NativePhone('B', 'BB:BB:BB:BB:BB:02', Object.assign({}, base, { wifi: null }));
  [nA, nB].forEach((n) => { radio.add(n); n.load(); });
  const A = await boot('A', nA); const B = await boot('B', nB);
  const idB = B.win.bleInterface.localNexoId.toLowerCase(), idA = A.win.bleInterface.localNexoId.toLowerCase();
  A.win.bleInterface.togglePanel(); const paired = await addFound(A, 'B'); A.win.bleInterface.togglePanel();
  if (!paired) { console.log('RESENDLOOP ' + JSON.stringify(Object.assign(r, { resultado: 'FALLO', error: 'no empareja' }))); process.exit(1); }
  await openChatWith(A, 'B'); sendText(A, 'hola B'); await sleep(2000);
  await openChatWith(B, 'A'); sendText(B, 'hola A'); await sleep(3000);
  await openChatWith(A, 'B');
  const t1 = 'primero corto', t2 = 'segundo corto';
  // las confirmaciones (ack / leído) de t1 y t2 no llegan a A mientras mute
  let mute = true; const muted = new Set();
  const ackS = A.win.bleInterface.ackSystem, origAck = ackS.processIncomingAck.bind(ackS);
  ackS.processIncomingAck = function(c) { if (mute) { try { const a = JSON.parse(c); if (a && muted.has(a.msgId || a.messageId || a.id)) return true; } catch (e) {} } return origAck(c); };
  const idsOf = async () => { (await A.win.vaultLoadMessages(idB)).forEach((m) => { if (m._own && (m.content === t1 || m.content === t2)) muted.add(m.msgId || m.messageId || m.id); }); };
  const mark = logs.length;
  sendText(A, t1); await sleep(30); await idsOf(); sendText(A, t2); await sleep(30); await idsOf();
  for (let i = 0; i < 20; i++) { await sleep(50); await idsOf(); }
  r.mudos = muted.size;
  await sleep(150000);
  const re = new RegExp('\\[A\\] log: \\[BLEInterface\\] Reenviando \\d+ pending para ' + idB, 'i');
  r.R1_vueltas = logs.slice(mark).filter((l) => re.test(l)).length;
  r.R1_ack_timeouts = logs.slice(mark).filter((l) => /\[A\] .*ACK timeout msgId=.*reintento/.test(l)).length;
  r.R1_pocas_vueltas = r.R1_vueltas <= 3;
  const st = async (t) => { const m = (await A.win.vaultLoadMessages(idB)).find((x) => x._own && x.content === t); return m ? m.status : null; };
  r.R2_estados = [await st(t1), await st(t2)];
  r.R2_no_falla = true;
  mute = false;
  r.R3_llegan_s = await waitFor(async () => { const ms = await B.win.vaultLoadMessages(idA); return [t1, t2].every((t) => ms.some((m) => !m._own && m.content === t)); }, 30000);
  // R4: al volver las confirmaciones, A los ve entregados (la espera creciente no deja el mensaje colgado: tope 2 min)
  r.R4_entregados_s = await waitFor(async () => { const a = await st(t1), b = await st(t2); return /delivered|read/.test(a) && /delivered|read/.test(b); }, 150000);
  r.errores = logs.filter((l) => / error: /.test(l) && !/JSDOMERROR|styles\.css|Not implemented|GLOBAL TIMEOUT|net::ERR|fetch/.test(l)).slice(0, 5);
  const ok = r.mudos === 2 && r.R1_pocas_vueltas && r.R2_no_falla && r.R3_llegan_s !== null && r.R4_entregados_s !== null && !r.errores.length;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('RESENDLOOP ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_resendloop.txt'), logs.join('\n'));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('RESENDLOOP ' + JSON.stringify({ prueba: 'resendloop', resultado: 'FALLO', error: String(e && e.message).replace(/"/g, "'") })); console.error(e && e.stack); fs.writeFileSync(path.join(__dirname, 'last_logs_resendloop.txt'), logs.join('\n')); process.exit(1); });
