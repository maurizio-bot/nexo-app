// 3124 (PLAN etapa 1, punto 5 de la revisión del 15-11; diagnóstico S23 3057 19:46: vídeo HD a …6482 con 8 reintentos en 64 s): un
// ARCHIVO del usuario por un enlace local (Bluetooth o Wi-Fi) a un contacto cuya APP duerme (el sistema la congela; su nativo sigue
// vivo) reenviaba la ventana entera cada 8 s hasta agotar 8 reintentos, gastando radio y batería sin que nadie armara los trozos.
// Ahora: sin un trozo confirmado en 2 ventanas → toque para despertarlo y «sondeo» (1 trozo cada 10 s) en vez de la ventana entera;
// al primer trozo confirmado sigue al ritmo normal; si no despierta en 3 min queda ⏳ (sale solo al volver).
// Prueba: A y B por Bluetooth; B se congela con el enlace VIVO; A manda un archivo de ~200 KB.
//  D1 en 45 s, como mucho 2 ventanas enteras reenviadas (contraprueba 3123: 4–5);   D2 entra en sondeo;
//  D3 se pide despertar a B (toque);   D4 no queda ✗ ni se aborta;   D5 al despertar B, el archivo llega.
// Uso: node dormidafile.js <dir_build>
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone, installWebCrypto } = require('./native_mock');

const buildDir = path.resolve(process.argv[2]);
const base = { readsContentFallback: true, retain: ['onPayloadReceived'], closeOnNoService: true, pace: [15, 15], ioDelay: 25, asymmetric: true, noL2: true, noTor: true };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
class DL extends ResourceLoader { constructor(d) { super(); this.d = d; } fetch(u) { const f = path.join(this.d, decodeURIComponent(new URL(u).pathname)); return fs.existsSync(f) ? Promise.resolve(fs.readFileSync(f)) : Promise.reject(new Error('x')); } }
const logs = [];
const T0 = Date.now();
const ts = () => String(((Date.now() - T0) / 1000).toFixed(1)).padStart(6) + 's';
async function boot(name, native) {
  const vc = new VirtualConsole();
  ['log', 'warn', 'error'].forEach((l) => vc.on(l, (...a) => logs.push(`${ts()} [${name}] ${l}: ` + a.map(String).join(' ').substring(0, 250))));
  const dom = new JSDOM(fs.readFileSync(path.join(buildDir, 'dist', 'index.html'), 'utf8'), {
    url: 'https://' + name.toLowerCase() + '.nexo.test/index.html', runScripts: 'dangerously', resources: new DL(path.join(buildDir, 'dist')), pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) { win.CapacitorCustomPlatform = { name: 'android' }; installWebCrypto(win); win.Capacitor = { Plugins: { NexoBLE: native.plugin() } }; win.HTMLElement.prototype.scrollTo = function () {}; },
  });
  const win = dom.window;
  for (let i = 0; i < 100 && !(win.NEXO && win.NEXO.initialized); i++) await sleep(100);
  await sleep(800);
  return { name, native, win };
}
const click = (w, el) => el && el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
async function openChatWith(p, name) {
  let row; for (let i = 0; i < 300 && !row; i++) { row = Array.from(p.win.document.querySelectorAll('#main-contacts-list .ble-contact-row')).find((r) => (r.querySelector('.ble-contact-name') || {}).textContent === name); if (!row) await sleep(100); }
  click(p.win, row); await sleep(400); return !!row;
}
function sendText(p, t) { const i = p.win.document.getElementById('message-input'); i.value = t; i.dispatchEvent(new p.win.Event('input', { bubbles: true })); click(p.win, p.win.document.getElementById('send-btn')); }
async function addFound(p, name) {
  let add = null;
  const find = () => { const row = Array.from(p.win.document.querySelectorAll('#ble-new-device > div')).find((d) => (d.querySelector('span') || {}).textContent === name); return row && row.querySelector('button'); };
  for (let i = 0; i < 400 && !add; i++) { await sleep(100); add = find(); if (!add && !p.win.bleInterface.isScanning) click(p.win, p.win.document.getElementById('ble-scan-btn')); }
  click(p.win, add); await sleep(2000);
  return !!add;
}
async function waitFor(fn, ms) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return Math.round((Date.now() - t0) / 100) / 10; await sleep(200); } return null; }

(async () => {
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', Object.assign({}, base)), nB = new NativePhone('B', 'BB:BB:BB:BB:BB:02', Object.assign({}, base));
  [nA, nB].forEach((n) => { radio.add(n); n.load(); });
  const A = await boot('A', nA), B = await boot('B', nB);
  const biA = A.win.bleInterface, AS = biA.ackSystem;
  const idA = biA.localNexoId.toLowerCase(), idB = B.win.bleInterface.localNexoId.toLowerCase();
  const r = { prueba: 'dormidafile', build: path.basename(buildDir) };
  const statuses = []; A.win.addEventListener('nexo:ble:ackStatus', (e) => { const d = e.detail || {}; if (d.messageId === 'ufile_dormida_1') statuses.push(d.status); });
  const wakes = []; const oWake = biA._wakeSleepingPeer;
  biA._wakeSleepingPeer = function (nx, why) { wakes.push(String(nx) + ' ' + (why || '')); return typeof oWake === 'function' ? oWake.apply(this, arguments) : null; };

  biA.togglePanel(); const paired = await addFound(A, 'B'); biA.togglePanel();
  if (!paired) { console.log('DORMIDAFILE ' + JSON.stringify(Object.assign(r, { resultado: 'FALLO', error: 'no empareja' }))); process.exit(1); }
  await openChatWith(A, 'B'); sendText(A, 'hola B'); await sleep(1200);
  await openChatWith(B, 'A'); sendText(B, 'hola A'); await sleep(1200);
  r.emparejados_s = await waitFor(async () => (await B.win.vaultLoadMessages(idA)).some((m) => m.content === 'hola B'), 30000);
  const macB = biA._bleReadyFor(idB) || biA._resolveDeviceIdForNexoId(idB);

  // La APP de B se duerme: no confirma nada; el enlace sigue VIVO
  const plugB = B.win.Capacitor.Plugins.NexoBLE, oSendB = plugB.sendMessage, oBinB = plugB.sendBinary;
  const swallow = function () { return Promise.resolve({ sent: true }); };
  plugB.sendMessage = swallow; if (oBinB) plugB.sendBinary = swallow;
  nB.setFrozen(true);

  const b64 = 'A'.repeat(270000); // ~200 KB
  const n0 = logs.length;
  AS.sendFile(macB, 'ufile_dormida_1', b64, { type: 'file', to: idB, fileName: 'video.bin' }).catch(() => {});
  r.arranca_s = await waitFor(() => AS.outgoingStreams.has('ufile_dormida_1'), 15000);
  await sleep(45000);
  const win = logs.slice(n0);
  r.D1_ventanas_reenviadas_45s = win.filter((l) => /\[A\].*Window timeout, reenviando ventana.*ufile_dormida_1/.test(l)).length;
  r.D2_sondeo = win.some((l) => /\[A\].*(app del otro duerme|Sondeo).*ufile_dormida_1/.test(l));
  r.D3_toque = wakes.filter((w) => w.indexOf(idB) === 0).length;
  const st = AS.outgoingStreams.get('ufile_dormida_1');
  r.D4_estados = statuses.slice(-3);
  r.D4_no_falla = statuses.indexOf('failed') < 0 && !!st && !st.aborted;
  r.enlace_vivo = !biA._bleCongested(macB);
  // B despierta: el archivo llega
  plugB.sendMessage = oSendB; if (oBinB) plugB.sendBinary = oBinB; nB.setFrozen(false);
  r.D5_llega_s = await waitFor(async () => (await B.win.vaultLoadMessages(idA)).some((m) => m.attachmentType && !m._own), 60000);

  r.errores = logs.filter((l) => / error: /.test(l) && !/JSDOMERROR|styles\.css|Not implemented|GLOBAL TIMEOUT|net::ERR|fetch/.test(l)).slice(0, 5);
  const ok = r.emparejados_s !== null && r.arranca_s !== null && r.D1_ventanas_reenviadas_45s <= 2 && r.D2_sondeo && r.D3_toque >= 1 &&
    r.D4_no_falla && r.enlace_vivo && r.D5_llega_s !== null && !r.errores.length;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('DORMIDAFILE ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_dormidafile.txt'), logs.join('\n'));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('DORMIDAFILE ' + JSON.stringify({ prueba: 'dormidafile', resultado: 'FALLO', error: String(e && e.message).replace(/"/g, "'") })); console.error(e && e.stack); fs.writeFileSync(path.join(__dirname, 'last_logs_dormidafile.txt'), logs.join('\n')); process.exit(1); });
