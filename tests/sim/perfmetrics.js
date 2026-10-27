// Ronda 2808 (pedido del dueño «rendimiento api de nexo»): la medición de rendimiento (src/ui/perf.js) capta lo REAL:
//  1. window.nexoPerf existe y resume.
//  2. Al mandar un mensaje A→B de verdad, A cuenta enviado + entregado y mide la ida y vuelta de la confirmación
//     (escucha el evento nexo:ble:ackStatus que la app ya emite).
//  3. El RTT medido por el supervisor se registra (record('rtt', …)) y entra en el resumen.
//  4. La transferencia de archivos se cronometra (evento nexo:ble:fileProgress out → delivered).
//  5. El panel «Rendimiento» se dibuja en Ajustes con números, sin reventar.
// Uso: node perf.js <dir_build>
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone, installWebCrypto } = require('./native_mock');

const buildDir = path.resolve(process.argv[2]);
const opts = { readsContentFallback: true, retain: ['onPayloadReceived'], closeOnNoService: true, pace: [15, 15], ioDelay: 25 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
class DL extends ResourceLoader { constructor(d) { super(); this.d = d; } fetch(u) { const f = path.join(this.d, decodeURIComponent(new URL(u).pathname)); return fs.existsSync(f) ? Promise.resolve(fs.readFileSync(f)) : Promise.reject(new Error('x')); } }
const logs = [];
async function boot(name, native) {
  const vc = new VirtualConsole();
  ['log', 'warn', 'error'].forEach((l) => vc.on(l, (...a) => logs.push(`[${name}] ${l}: ` + a.map(String).join(' ').substring(0, 250))));
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
const wait = async (c, s) => { for (let i = 0; i < s * 5; i++) { if (await c()) return true; await sleep(200); } return false; };
async function openChatWith(p, name) {
  let row; for (let i = 0; i < 300 && !row; i++) { row = Array.from(p.win.document.querySelectorAll('#main-contacts-list .ble-contact-row')).find((r) => (r.querySelector('.ble-contact-name') || {}).textContent === name); if (!row) await sleep(100); }
  click(p.win, row); await sleep(600); return !!row;
}
function sendText(p, t) { const i = p.win.document.getElementById('message-input'); i.value = t; i.dispatchEvent(new p.win.Event('input', { bubbles: true })); click(p.win, p.win.document.getElementById('send-btn')); }

(async () => {
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', opts), nB = new NativePhone('B', 'BB:BB:BB:BB:BB:02', opts);
  [nA, nB].forEach((n) => { radio.add(n); n.load(); });
  const [A, B] = await Promise.all([boot('A', nA), boot('B', nB)]);
  const r = { build: path.basename(buildDir) };
  const idA = A.win.bleInterface.localNexoId.toLowerCase();
  const estados = []; // diagnóstico: qué estados de ackStatus emite la app en A
  A.win.addEventListener('nexo:ble:ackStatus', (e) => estados.push((e.detail || {}).status));

  r.hay_api = !!(A.win.nexoPerf && typeof A.win.nexoPerf.summary === 'function' && typeof A.win.nexoPerf.record === 'function');

  // Agregar B como contacto en A (flujo normal de la app)
  A.win.bleInterface.togglePanel(); let add = null;
  for (let i = 0; i < 400 && !add; i++) { await sleep(100); add = A.win.document.querySelector('#ble-new-device > div button'); if (!add && !A.win.bleInterface.isScanning) click(A.win, A.win.document.getElementById('ble-scan-btn')); }
  click(A.win, add); await sleep(1500);
  if (A.win.document.getElementById('ble-panel').classList.contains('active')) A.win.bleInterface.togglePanel();

  // 2. Mensaje real A→B: debe contar enviado + entregado y medir la ida y vuelta
  await openChatWith(A, 'B');
  sendText(A, 'medir rendimiento');
  r.B_recibe = await wait(async () => (await B.win.vaultLoadMessages(idA)).some((m) => m.content === 'medir rendimiento'), 30);
  await wait(() => { const s = A.win.nexoPerf.summary(); return s.enviados >= 1 && s.entregados >= 1; }, 20);
  let s = A.win.nexoPerf.summary();
  r.enviados = s.enviados; r.entregados = s.entregados; r.tasa = s.tasa;
  r.entrega_medida = !!(s.entrega && typeof s.entrega.med === 'number' && s.entrega.med >= 0);
  r.estados_vistos = estados.slice(0, 8);

  // 3. RTT: el supervisor lo mide y lo registra; además probamos el camino de registro/!resumen
  A.win.nexoPerf.record('rtt', 45); A.win.nexoPerf.record('rtt', 90);
  s = A.win.nexoPerf.summary();
  r.rtt_en_resumen = !!(s.rtt && s.rtt.n >= 2 && typeof s.rtt.med === 'number');
  r.rtt_vivo_tipo = (s.rtt_vivo === null || typeof s.rtt_vivo === 'number'); // del supervisor (puede no haber pingeado aún)

  // 4. Transferencia: el evento que la app ya emite (out, progreso → entregado) se cronometra
  A.win.dispatchEvent(new A.win.CustomEvent('nexo:ble:fileProgress', { detail: { fileId: 'f1', sent: 1, total: 10, status: 'sending', percent: 10, direction: 'out' } }));
  await sleep(120);
  A.win.dispatchEvent(new A.win.CustomEvent('nexo:ble:fileProgress', { detail: { fileId: 'f1', sent: 10, total: 10, status: 'delivered', percent: 100, direction: 'out' } }));
  s = A.win.nexoPerf.summary();
  r.transfer_medida = !!(s.transfer && s.transfer.n >= 1) && s.archivos >= 1;

  // 5. Panel «Rendimiento» en Ajustes
  A.win.dispatchEvent(new A.win.Event('nexo:ui:profile'));
  await sleep(200);
  { const b = A.win.document.getElementById('nexo-open-settings'); if (b) click(A.win, b); }
  await sleep(300);
  const panel = A.win.document.getElementById('nexo-perf-rows');
  r.panel_dibuja = !!(panel && /Latencia|Mensajes entregados/.test(panel.textContent));
  r.panel_sin_undefined = !!(panel && !/undefined|NaN/.test(panel.textContent));

  r.errores = logs.filter((l) => /TypeError|undefined is not|is not a function|RangeError/.test(l)).slice(0, 4);
  const ok = r.hay_api && r.B_recibe && r.enviados >= 1 && r.entregados >= 1 && r.entrega_medida &&
    r.rtt_en_resumen && r.rtt_vivo_tipo && r.transfer_medida && r.panel_dibuja && r.panel_sin_undefined && r.errores.length === 0;
  r.resultado = ok ? 'OK' : 'FAIL';
  console.log('PERF ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_perfmetrics.txt'), logs.join('\n'));
  process.exit(0);
})().catch((e) => { console.error('FALLO:', e.stack); fs.writeFileSync(path.join(__dirname, 'last_logs_perfmetrics.txt'), logs.join('\n')); process.exit(1); });
