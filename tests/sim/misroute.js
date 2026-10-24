// Informe del dueño (2763, tablet + S24 + Vivo): lo que la tablet mandaba al S24 (archivos, llamadas) llegaba al Vivo.
// A (tablet) conoce a B (S24) y a C (Vivo); B y C con la app en segundo plano, todo por Bluetooth. Se reproduce el
// estado que lo causa: en A, la conexión con C queda apuntada como la de B (dirección → NEXO ID equivocado) y la de B
// no está lista. Después A manda a B un texto, un archivo y una llamada.
// Debe pasar: C no avisa ni suena (no es para él) y le dice a A "no soy yo"; A corrige la dirección y todo llega a B
// (B avisa y suena), no a C.
// --sin-fallo: sin estropear nada (lo de siempre).
// Uso: node misroute.js <dir_build> [--sin-fallo]
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone } = require('./native_mock');

const buildDir = path.resolve(process.argv[2]);
const NOFAULT = process.argv.includes('--sin-fallo');
const opts = { readsContentFallback: true, retain: ['onPayloadReceived'], closeOnNoService: true, pace: [15, 15], ioDelay: 25, asymmetric: true };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
class DL extends ResourceLoader { constructor(d) { super(); this.d = d; } fetch(u) { const f = path.join(this.d, decodeURIComponent(new URL(u).pathname)); return fs.existsSync(f) ? Promise.resolve(fs.readFileSync(f)) : Promise.reject(new Error('x')); } }
const logs = [];
const vis = {};
async function boot(name, native) {
  const vc = new VirtualConsole();
  ['log', 'warn', 'error'].forEach((l) => vc.on(l, (...a) => logs.push(`${new Date().toISOString().substring(14, 23)} [${name}] ${l}: ` + a.map(String).join(' ').substring(0, 250))));
  const dom = new JSDOM(fs.readFileSync(path.join(buildDir, 'dist', 'index.html'), 'utf8'), {
    url: 'https://' + name.toLowerCase() + '.nexo.test/index.html', runScripts: 'dangerously', resources: new DL(path.join(buildDir, 'dist')), pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) {
      win.CapacitorCustomPlatform = { name: 'android' }; require('./native_mock').installWebCrypto(win); win.Capacitor = { Plugins: { NexoBLE: native.plugin() } }; win.HTMLElement.prototype.scrollTo = function () {};
      Object.defineProperty(win.document, 'visibilityState', { configurable: true, get: () => vis[name] || 'visible' });
      Object.defineProperty(win.document, 'hidden', { configurable: true, get: () => (vis[name] || 'visible') === 'hidden' });
      win.navigator.mediaDevices = { getUserMedia: () => Promise.reject(new Error('sin micrófono en el simulador')) };
    },
  });
  const win = dom.window;
  for (let i = 0; i < 100 && !(win.NEXO && win.NEXO.initialized); i++) await sleep(100);
  await sleep(800);
  return { name, native, win };
}
function setVisible(p, on) { vis[p.name] = on ? 'visible' : 'hidden'; p.native.setAppActive(on); p.win.document.dispatchEvent(new p.win.Event('visibilitychange')); }
const click = (w, el) => el && el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
async function addFound(p) {
  let add = null;
  for (let i = 0; i < 400 && !add; i++) { await sleep(100); add = p.win.document.querySelector('#ble-new-device > div button'); if (!add && !p.win.bleInterface.isScanning) click(p.win, p.win.document.getElementById('ble-scan-btn')); }
  click(p.win, add); await sleep(2000);
}
async function openChatWith(p, name) {
  let row; for (let i = 0; i < 300 && !row; i++) { row = Array.from(p.win.document.querySelectorAll('#main-contacts-list .ble-contact-row')).find((r) => (r.querySelector('.ble-contact-name') || {}).textContent === name); if (!row) await sleep(100); }
  click(p.win, row); await sleep(600); return !!row;
}
async function closeChat(p) { p.win.dispatchEvent(new p.win.CustomEvent('nexo:ble:closeChat', { detail: {} })); await sleep(300); }
function sendText(p, t) { const i = p.win.document.getElementById('message-input'); i.value = t; i.dispatchEvent(new p.win.Event('input', { bubbles: true })); click(p.win, p.win.document.getElementById('send-btn')); }
async function sendFile(p, name, bytes) {
  click(p.win, p.win.document.querySelector('.attach-menu-item[data-type="file"]')); await sleep(100);
  const fin = Array.from(p.win.document.querySelectorAll('input[type=file]')).pop();
  const b = Buffer.alloc(bytes); for (let i = 0; i < b.length; i++) b[i] = (i * 31) & 255;
  Object.defineProperty(fin, 'files', { configurable: true, value: [new p.win.File([b], name, { type: 'application/pdf' })] }); fin.dispatchEvent(new p.win.Event('change'));
}
const wait = async (c, s) => { for (let i = 0; i < s * 5; i++) { if (await c()) return true; await sleep(200); } return false; };

(async () => {
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', opts), nB = new NativePhone('B', 'BB:BB:BB:BB:BB:02', opts), nC = new NativePhone('C', 'CC:CC:CC:CC:CC:03', opts);
  [nA, nB, nC].forEach((n) => { radio.add(n); n.load(); });
  const [A, B, C] = await Promise.all([boot('A', nA), boot('B', nB), boot('C', nC)]);
  const id = (p) => p.win.bleInterface.localNexoId.toLowerCase();
  const idA = id(A), idB = id(B), idC = id(C);
  A.win.bleInterface.togglePanel(); await addFound(A); await addFound(A); A.win.bleInterface.togglePanel();
  await sleep(1500);
  for (const n of ['B', 'C']) { await openChatWith(A, n); sendText(A, 'hola ' + n); await sleep(2500); await closeChat(A); }
  const r = { build: path.basename(buildDir), con_fallo: !NOFAULT, ids: { A: idA, B: idB, C: idC } };
  r.B_y_C_tienen_a_A = await wait(async () => (await B.win.vaultLoadMessages(idA)).some((m) => m.content === 'hola B') && (await C.win.vaultLoadMessages(idA)).some((m) => m.content === 'hola C'), 60);
  setVisible(B, false); setVisible(C, false); await sleep(500);
  const biA = A.win.bleInterface;
  const devOf = (nx) => { const out = []; biA._deviceStates.forEach((st, k) => { if (!/^(lan|net)nx/.test(k) && String(biA._macToNexoId.get(k) || '').toLowerCase() === nx) out.push(k); }); return out; };
  r.enlaces_A_con_C = devOf(idC);
  const devB = devOf(idB);
  if (!NOFAULT) {
    // El estado del fallo: la conexión con C, apuntada como la de B; la de B, sin listo (p.ej. B se alejó)
    devB.forEach((k) => { biA._deviceStates.set(k, { state: 'disconnected', since: Date.now() }); });
    devOf(idC).forEach((k) => { biA._macToNexoId.set(k, idB); });
    biA._nexoIdToMac.set(idB, devOf(idB)[0]);
    r.A_cree_que_C_es_B = biA._bleReadyFor(idB) !== null && devOf(idC).length === 0;
  }
  const c0 = nC.notifLog.length, b0 = nB.notifLog.length;
  // Qué paquetes llevan a C a avisar (para el informe)
  const cPk = []; const bgC = nC._bgNotify.bind(nC); nC._bgNotify = (json) => { const i = NativePhone.classifyClosed(json, nC.advertisingId); if (i.kind === 'MESSAGE' || i.kind === 'NOTIFY_ONLY') cPk.push(String(json).replace(/"(d|c|pk|text|payload|th)":("[^"]{20,}"|\{[^}]*\})/g, '"$1":…').substring(0, 220)); return bgC(json); };
  await openChatWith(A, 'B');
  // 0. Llamada con el fallo puesto: no debe sonar en C
  click(A.win, A.win.document.getElementById('nexo-call-btn'));
  await sleep(8000);
  r.C_suena_con_el_fallo = !!nC.callNotif;
  if (A.win.bleInterface.calls && A.win.bleInterface.calls.call) A.win.bleInterface.calls.hangup();
  await wait(() => !(A.win.bleInterface.calls && A.win.bleInterface.calls.call), 20);
  await sleep(2000);
  // 1. Texto
  sendText(A, 'para B, no para C');
  r.texto_llega_a_B = await wait(async () => (await B.win.vaultLoadMessages(idA)).some((m) => m.content === 'para B, no para C'), 90);
  // 2. Archivo
  await sendFile(A, 'informe.pdf', 30000);
  r.archivo_llega_a_B = await wait(async () => (await B.win.vaultLoadMessages(idA)).some((m) => m.attachmentType && !m._own && (m.attachmentMeta || {}).name === 'informe.pdf'), 120);
  await sleep(5000);
  // 3. Llamada (B vuelve a estar conectado, como al reconectar en el teléfono)
  devB.forEach((k) => { biA._deviceStates.set(k, { state: 'ready_to_chat', since: Date.now() }); biA._macToNexoId.set(k, idB); });
  await sleep(1000);
  click(A.win, A.win.document.getElementById('nexo-call-btn'));
  r.llamada_suena_en_B = await wait(() => !!(nB.callNotif && nB.callNotif.from === idA) || !!(B.win.bleInterface.calls && B.win.bleInterface.calls.call), 60);
  await sleep(3000);
  const cn = nC.notifLog.slice(c0);
  r.C_avisos = cn.map((n) => (n.call ? 'LLAMADA ' : '') + n.name + ': ' + (n.text || 'Mensaje nuevo'));
  r.C_suena = !!nC.callNotif;
  r.C_paquetes_que_avisan = cPk.slice(0, 4);
  r.C_no_avisa = !cn.some((n) => n.chatId === idA || n.call) && !nC.callNotif;
  r.B_avisos = nB.notifLog.slice(b0).map((n) => (n.call ? 'LLAMADA ' : '') + n.name + ': ' + (n.text || 'Mensaje nuevo'));
  r.C_no_lo_guarda = !(await C.win.vaultLoadMessages(idA)).some((m) => m.content === 'para B, no para C' || (m.attachmentMeta || {}).name === 'informe.pdf');
  r.A_corrige = NOFAULT || (biA._bleReadyFor(idC) !== null && devOf(idC).length > 0);
  r.no_soy_yo_en_registro = logs.filter((l) => /no es para (mí|este teléfono)|era de otro/i.test(l)).slice(0, 3);
  r.errores = logs.filter((l) => / error: /.test(l) && !/JSDOMERROR|styles\.css|Not implemented/.test(l)).slice(0, 5);
  const ok = r.B_y_C_tienen_a_A && !r.C_suena_con_el_fallo && r.texto_llega_a_B && r.archivo_llega_a_B && r.llamada_suena_en_B && r.C_no_avisa && r.C_no_lo_guarda && r.A_corrige && !r.errores.length;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('MISROUTE ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_misroute.txt'), logs.join('\n'));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error(e); fs.writeFileSync(path.join(__dirname, 'last_logs_misroute.txt'), logs.join('\n')); process.exit(1); });
