// Diagnóstico automático del dueño (vivo, build 2987, 10-11 16:46, síntoma «reintentos»): un mensaje de GRUPO al tablet —que va por el puente del
// S24— agotó sus 8 reintentos de ventana (31 s a 3,8 s) y quedó ✗ MIENTRAS una foto de 212 KB salía por ese mismo Bluetooth: la radio estaba
// OCUPADA, no muerta, y cada reenvío de la ventana le sumaba carga. 2993: un TEXTO cuya ventana vence mientras otro envío avanza (ACKs en los
// últimos 8 s) no gasta reintento ni reenvía: espera con backoff hasta 3 min; pasado eso, o sin otro envío avanzando, el presupuesto de siempre.
// Prueba: A y B por Bluetooth, B congelado (no contesta ACKs); A manda un texto largo (varios trozos) y mientras se simula un envío ajeno que
// avanza (flujo «file» con ACKs recientes). A los 45 s —más de los 31 s que bastaban antes— el texto NO ha agotado reintentos ni quedó ✗; al
// terminar el envío ajeno sigue con su presupuesto; B vuelve y el texto llega.
// Uso: node textbusy.js <dir_build>
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
  const r = { prueba: 'textbusy', build: path.basename(buildDir) };
  biA.togglePanel(); const paired = await addFound(A, 'B'); biA.togglePanel();
  if (!paired) { console.log('TEXTBUSY ' + JSON.stringify(Object.assign(r, { resultado: 'FALLO', error: 'no empareja' }))); process.exit(1); }
  await openChatWith(A, 'B'); sendText(A, 'hola B'); await sleep(1200);
  await openChatWith(B, 'A'); sendText(B, 'hola A'); await sleep(1200);
  r.emparejados_s = await waitFor(async () => (await B.win.vaultLoadMessages(idA)).some((m) => m.content === 'hola B'), 30000);

  // B se congela: no contesta nada (ni ACKs)
  const plugB = B.win.Capacitor.Plugins.NexoBLE, oSendB = plugB.sendMessage, oBinB = plugB.sendBinary;
  const swallow = function () { return Promise.resolve({ sent: true }); };
  plugB.sendMessage = swallow; if (oBinB) plugB.sendBinary = swallow;
  nB.setFrozen(true);

  // un envío ajeno que AVANZA: un flujo «file» falso con ACKs recientes que se renuevan cada segundo
  const fake = { type: 'file', aborted: false, deviceId: 'otro', startTime: Date.now(), lastAckAt: Date.now() };
  AS.outgoingStreams.set('envio_ajeno_1', fake);
  const iv = setInterval(() => { fake.lastAckAt = Date.now(); }, 1000);

  const LONG = ('mensaje de grupo largo '.repeat(300)).trim();   // ~7 KB: varios trozos
  const t0 = Date.now();
  await openChatWith(A, 'B'); sendText(A, LONG);
  await sleep(45000);                                      // antes: a los ~31 s agotaba los 8 reintentos y quedaba ✗
  const logsA = logs.filter((l) => /\[A\]/.test(l));
  r.sin_agotar_reintentos = !logsA.some((l) => /Max window retries/.test(l));
  r.espera_sin_gastar = logsA.some((l) => /otro envío avanza por la radio: espero sin gastar reintento/.test(l));
  const msgs = await A.win.vaultLoadMessages(idB);
  const mine = msgs.filter((m) => m._own && m.content === LONG);
  r.no_quedo_fallido = mine.length === 1 && mine[0].status !== 'failed';

  // el envío ajeno termina; B vuelve: el texto llega
  clearInterval(iv); AS.outgoingStreams.delete('envio_ajeno_1');
  plugB.sendMessage = oSendB; if (oBinB) plugB.sendBinary = oBinB; nB.setFrozen(false);
  r.llega_s = await waitFor(async () => (await B.win.vaultLoadMessages(idA)).some((m) => m.content === LONG), 90000);

  r.errores = logs.filter((l) => / error: /.test(l) && !/JSDOMERROR|styles\.css|Not implemented|GLOBAL TIMEOUT|net::ERR|fetch/.test(l)).slice(0, 5);
  const ok = r.emparejados_s !== null && r.sin_agotar_reintentos && r.espera_sin_gastar && r.no_quedo_fallido && r.llega_s !== null && !r.errores.length;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('TEXTBUSY ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_textbusy.txt'), logs.join('\n'));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('TEXTBUSY ' + JSON.stringify({ prueba: 'textbusy', resultado: 'FALLO', error: String(e && e.message).replace(/"/g, "'") })); console.error(e && e.stack); process.exit(1); });
