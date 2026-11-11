// 2002 (diagnóstico automático del 11-11, S24 14:55): un TEXTO por Bluetooth con el enlace atascado: el nativo soltó el mensaje
// («Write fallo… descartado entero» → onWriteDropped → marcado muerto) y el JS, sin otro camino, reenviaba la ventana 8 veces (~64 s)
// y lo marcaba ✗ («Max window retries»). Un texto no debe quedar ✗ por un Bluetooth muerto: pasa a ⏳ (pendiente) y se reenvía
// solo cuando vuelve un camino. Prueba: A y B por Bluetooth; B se congela; A manda un texto largo; el nativo de A lo suelta
// (_markBleDead) → el flujo se rinde pronto (PEER_ABSENT), el estado NO es ✗, y al volver B el texto llega.
// Uso: node textdead.js <dir_build>
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
  const r = { prueba: 'textdead', build: path.basename(buildDir) };

  biA.togglePanel(); const paired = await addFound(A, 'B'); biA.togglePanel();
  if (!paired) { console.log('TEXTDEAD ' + JSON.stringify(Object.assign(r, { resultado: 'FALLO', error: 'no empareja' }))); process.exit(1); }
  await openChatWith(A, 'B'); sendText(A, 'hola B'); await sleep(1200);
  await openChatWith(B, 'A'); sendText(B, 'hola A'); await sleep(1200);
  r.emparejados_s = await waitFor(async () => (await B.win.vaultLoadMessages(idA)).some((m) => m.content === 'hola B'), 30000);
  const macB = biA._bleReadyFor(idB) || biA._resolveDeviceIdForNexoId(idB);
  r.por_bluetooth = !!macB && !/^(lan|net)/i.test(String(macB));

  // B se congela (sin ACKs): su nativo traga todo, como una app dormida con el enlace Bluetooth atascado
  const plugB = B.win.Capacitor.Plugins.NexoBLE, oSendB = plugB.sendMessage, oBinB = plugB.sendBinary;
  const swallow = function () { return Promise.resolve({ sent: true }); };
  plugB.sendMessage = swallow; if (oBinB) plugB.sendBinary = swallow;
  nB.setFrozen(true);

  // A escribe un texto largo (viaja por trozos, ChatStream 'chat'): queda en vuelo sin ACK
  const largo = 'texto largo por Bluetooth con el enlace atascado. '.repeat(8);
  await openChatWith(A, 'B'); sendText(A, largo);
  let mid = null;
  r.flujo_en_vuelo_s = await waitFor(() => { for (const [id, s] of AS.outgoingStreams) { if (s.type === 'chat') { mid = id; return true; } } return false; }, 15000);
  await sleep(500);

  // El nativo SUELTA el mensaje (onWriteDropped → _markBleDead). Sin otro camino, antes el JS reenviaba la ventana 8 veces y ponía ✗.
  biA._markBleDead(macB);
  r.enlace_marcado_muerto = !!biA._bleCongested(macB);
  const statusOf = async () => { const ms = await A.win.vaultLoadMessages(idB); const own = ms.filter((x) => x._own && x.content !== 'hola B'); const m = own.length ? own[own.length - 1] : null; return m ? m.status : null; };
  r.se_rinde_s = await waitFor(() => !AS.outgoingStreams.has(mid), 20000);   // antes: null (8 reintentos de ~8 s)
  r.estado_al_rendirse = await statusOf();                                    // antes: 'failed' al final de los reintentos
  r.nunca_fallido = r.estado_al_rendirse !== 'failed';
  await sleep(1500);
  r.estado_tras_1s = await statusOf();

  // B vuelve: el texto pendiente se reenvía solo y llega
  plugB.sendMessage = oSendB; if (oBinB) plugB.sendBinary = oBinB; nB.setFrozen(false);
  r.llega_s = await waitFor(async () => (await B.win.vaultLoadMessages(idA)).some((m) => !m._own && String(m.content).indexOf('texto largo por Bluetooth') === 0), 90000);
  r.confirmado_s = await waitFor(async () => { const st = await statusOf(); return st && st !== 'pending' && st !== 'failed' && st !== 'sending' && st !== 'queued'; }, 40000);
  r.estado_final = await statusOf();

  r.errores = logs.filter((l) => / error: /.test(l) && !/JSDOMERROR|styles\.css|Not implemented|GLOBAL TIMEOUT|net::ERR|fetch/.test(l)).slice(0, 5);
  const ok = r.emparejados_s !== null && r.por_bluetooth && r.flujo_en_vuelo_s !== null && r.enlace_marcado_muerto && r.se_rinde_s !== null &&
    r.nunca_fallido && r.estado_tras_1s !== 'failed' && r.llega_s !== null && r.confirmado_s !== null && r.estado_final !== 'failed' && !r.errores.length;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('TEXTDEAD ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_textdead.txt'), logs.join('\n'));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('TEXTDEAD ' + JSON.stringify({ prueba: 'textdead', resultado: 'FALLO', error: String(e && e.message).replace(/"/g, "'") })); console.error(e && e.stack); fs.writeFileSync(path.join(__dirname, 'last_logs_textdead.txt'), logs.join('\n')); process.exit(1); });
