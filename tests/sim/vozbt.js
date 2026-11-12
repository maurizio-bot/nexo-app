// Nota de voz por Bluetooth (dueño 12-11, diagnósticos S24 + S23 con la 3014): una nota de voz de 22 s iba como TEXTO troceado
// (1761 trozos de 360 letras, ventana de 8), no como archivo (binario, trozos de ~550, ventana de 12): tardaba minutos, tapaba
// el enlace («Cola de escritura llena») y los textos del otro no recibían confirmación; cada reintento la cifraba de nuevo y el
// receptor tiraba lo recibido («llega otro intento: se empieza de nuevo»).
//  V1  una nota de voz de ~300 KB llega a B como nota de voz (con su duración) en pocos segundos;
//  V2  va por el camino de archivos (sin trozos de texto de esa nota por el aire);
//  V3  un texto de B a A mientras tanto llega y A lo confirma.
// Uso: node vozbt.js <dir_build>
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone, installWebCrypto } = require('./native_mock');

const buildDir = path.resolve(process.argv[2] || path.join(__dirname, 'builds/wip'));
const opts = { readsContentFallback: true, retain: ['onPayloadReceived'], closeOnNoService: true, pace: [15, 15], ioDelay: 25, asymmetric: true, noL2: true };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
class DL extends ResourceLoader { constructor(d) { super(); this.d = d; } fetch(u) { const f = path.join(this.d, decodeURIComponent(new URL(u).pathname)); return fs.existsSync(f) ? Promise.resolve(fs.readFileSync(f)) : Promise.reject(new Error('x')); } }
const air = [];
const orig = NativePhone.prototype._processReceivedChunk;
NativePhone.prototype._processReceivedChunk = function (from, chunk, source) { air.push(String(chunk)); return orig.call(this, from, chunk, source); };
const logs = [];
async function boot(name, native) {
  native.listeners = new Map();
  const vc = new VirtualConsole(); ['log', 'warn', 'error'].forEach((l) => vc.on(l, (...a) => logs.push(`[${name}] ${l}: ` + a.map(String).join(' ').substring(0, 250))));
  const dom = new JSDOM(fs.readFileSync(path.join(buildDir, 'dist', 'index.html'), 'utf8'), { url: 'https://' + name.toLowerCase() + '.nexo.test/index.html', runScripts: 'dangerously', resources: new DL(path.join(buildDir, 'dist')), pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) { win.CapacitorCustomPlatform = { name: 'android' }; installWebCrypto(win); win.Capacitor = { Plugins: { NexoBLE: native.plugin() } }; win.HTMLElement.prototype.scrollTo = function () {}; win.URL.createObjectURL = () => 'blob:sim'; win.URL.revokeObjectURL = () => {}; } });
  const win = dom.window; for (let i = 0; i < 100 && !(win.NEXO && win.NEXO.initialized); i++) await sleep(100); await sleep(800);
  return { name, native, win };
}
const click = (w, el) => el && el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
async function waitFor(fn, ms) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return Math.round((Date.now() - t0) / 100) / 10; await sleep(200); } return null; }
function sendText(p, t) { const i = p.win.document.getElementById('message-input'); i.value = t; i.dispatchEvent(new p.win.Event('input', { bubbles: true })); click(p.win, p.win.document.getElementById('send-btn')); }

(async () => {
  const r = { prueba: 'vozbt', build: path.basename(buildDir) };
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', opts), nB = new NativePhone('B', 'BB:BB:BB:BB:BB:02', opts);
  radio.add(nA); radio.add(nB); nA.load(); nB.load();
  const [A, B] = await Promise.all([boot('A', nA), boot('B', nB)]);
  A.win.bleInterface.togglePanel();
  let add = null;
  for (let i = 0; i < 400 && !add; i++) { await sleep(100); add = A.win.document.querySelector('#ble-new-device > div button'); if (!add && !A.win.bleInterface.isScanning) click(A.win, A.win.document.getElementById('ble-scan-btn')); }
  if (!add) throw new Error('no empareja');
  click(A.win, add); await sleep(2500);
  if (A.win.document.getElementById('ble-panel').classList.contains('active')) A.win.bleInterface.togglePanel();
  click(A.win, A.win.document.querySelector('#main-contacts-list .ble-contact-row')); await sleep(800);
  const idA = A.win.bleInterface.localNexoId.toLowerCase(), idB = B.win.bleInterface.localNexoId.toLowerCase();
  await waitFor(() => (B.win.bleInterface.getContacts() || []).some((c) => (c.nexoId || c.deviceUUID || '').toLowerCase() === idA), 30000);
  sendText(A, 'hola'); await waitFor(async () => (await B.win.vaultLoadMessages(idA)).some((m) => m.content === 'hola'), 30000);
  // ---- V1/V2: nota de voz de ~300 KB ----
  const audio = Buffer.alloc(225000); for (let i = 0; i < audio.length; i++) audio[i] = (i * 31 + 7) & 255;
  const b64 = audio.toString('base64');
  const before = air.length;
  A.win.NEXO_sendAttachment('audio', b64, { format: 'webm', duration: 22, mimeType: 'audio/webm' });
  await sleep(300);
  const vid = ((await A.win.vaultLoadMessages(idB)).filter((m) => m.attachmentType === 'audio').pop() || {}).msgId;
  const got = async () => (await B.win.vaultLoadMessages(idA)).find((m) => {
    const p = m.attachmentRef ? nB.files.get(m.attachmentRef) : m.attachmentPayload;
    return m.attachmentType === 'audio' && p === b64;
  });
  // ---- V3: un texto de B a A mientras la nota viaja ----
  click(B.win, B.win.document.querySelector('#main-contacts-list .ble-contact-row')); await sleep(500);
  sendText(B, 'mientras');
  r.V1_llega_s = await waitFor(got, 240000);
  const m = await got();
  r.V1_duracion = m && m.attachmentMeta ? m.attachmentMeta.duration : null;
  const mine = air.slice(before).filter((x) => vid && x.indexOf(vid) >= 0);
  r.V2_trozos_de_texto = mine.filter((x) => /"t":"c"/.test(x)).length;
  r.V2_trozos_total = mine.length;
  r.V3_texto_de_B_llega_s = await waitFor(async () => (await A.win.vaultLoadMessages(idB)).some((x) => x.content === 'mientras'), 60000);
  r.errores = logs.filter((l) => / error: /.test(l) && !/JSDOMERROR|styles\.css|Not implemented/.test(l)).slice(0, 5);
  const ok = r.V1_llega_s !== null && r.V1_llega_s <= 30 && r.V1_duracion === 22 && r.V2_trozos_de_texto === 0 && r.V3_texto_de_B_llega_s !== null && !r.errores.length;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('VOZBT ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_vozbt.txt'), logs.join('\n'));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('VOZBT ' + JSON.stringify({ prueba: 'vozbt', resultado: 'FALLO', error: String(e && e.message).replace(/"/g, "'") })); fs.writeFileSync(path.join(__dirname, 'last_logs_vozbt.txt'), logs.join('\n')); process.exit(1); });
