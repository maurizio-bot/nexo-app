// Escenario de ciclo de vida: B cierra la app (actividad destruida; el servicio sigue anunciando),
// A escribe, B reabre (el nativo arranca antes que el JS) y A escribe justo al reabrir.
// Uso: node lifecycle.js <dir_build> [--retain] [--close-no-service] [--js-delay=2500]
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone } = require('./native_mock');

const buildDir = path.resolve(process.argv[2]);
const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith('--' + k)); if (!a) return d; const v = a.split('=')[1]; return v === undefined ? true : Number(v); };
const opts = { readsContentFallback: true, retain: arg('retain', false) ? ['onPayloadReceived'] : [], closeOnNoService: !!arg('close-no-service', false), asymmetric: !!arg('asymmetric', false), ioDelay: arg('io-delay', 0) };
const jsDelay = arg('js-delay', 2500);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
class DistLoader extends ResourceLoader {
  constructor(dir) { super(); this.dir = dir; }
  fetch(url) { const f = path.join(this.dir, decodeURIComponent(new URL(url).pathname)); return fs.existsSync(f) ? Promise.resolve(fs.readFileSync(f)) : Promise.reject(new Error('no existe ' + f)); }
}
const allLogs = [];
async function bootJs(name, native) {
  native.listeners = new Map(); native.calls = [];
  const vc = new VirtualConsole();
  ['log', 'info', 'warn', 'error'].forEach((l) => vc.on(l, (...a) => allLogs.push(`[${name}] ${l}: ` + a.map(String).join(' ').substring(0, 300))));
  const dom = new JSDOM(fs.readFileSync(path.join(buildDir, 'dist', 'index.html'), 'utf8'), {
    url: 'https://' + name.toLowerCase() + '.nexo.test/index.html', runScripts: 'dangerously',
    resources: new DistLoader(path.join(buildDir, 'dist')), pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) { win.CapacitorCustomPlatform = { name: 'android' }; win.Capacitor = { Plugins: { NexoBLE: native.plugin() } }; win.HTMLElement.prototype.scrollTo = function () {}; },
  });
  const win = dom.window;
  for (let i = 0; i < 100 && !(win.NEXO && win.NEXO.initialized); i++) await sleep(100);
  await sleep(500);
  return { name, native, win };
}
const click = (win, el) => el.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
async function openChat(p) { const r = p.win.document.querySelector('#main-contacts-list .ble-contact-row'); if (!r) return false; click(p.win, r); await sleep(300); return true; }
async function sendText(p, t) { const i = p.win.document.getElementById('message-input'); i.value = t; i.dispatchEvent(new p.win.Event('input', { bubbles: true })); click(p.win, p.win.document.getElementById('send-btn')); }
const statusOf = (p, t) => { const m = Array.from(p.win.document.querySelectorAll('#messages-container .message.own')).find((x) => (x.querySelector('.msg-content') || {}).textContent === t); return m ? (m.querySelector('.msg-status') || {}).className.replace('msg-status status-', '') : 'sin burbuja'; };

(async () => {
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', opts), nB = new NativePhone('B', 'BB:BB:BB:BB:BB:02', opts);
  radio.add(nA); radio.add(nB); nA.load(); nB.load();
  // B ya ha escrito muchos mensajes en su vida: su contador seq va por delante del de A
  const seqB = arg('seq-b', 0);
  if (seqB) nB.files.set('nexo_seq_counter.json', JSON.stringify({ seq: seqB }));
  let [A, B] = await Promise.all([bootJs('A', nA), bootJs('B', nB)]);
  const idA = A.win.bleInterface.localNexoId, idB = B.win.bleInterface.localNexoId;
  A.win.bleInterface.togglePanel();
  let add = null;
  for (let i = 0; i < 400 && !add; i++) { await sleep(100); add = A.win.document.querySelector('#ble-new-device button'); if (!add && !A.win.bleInterface.isScanning) click(A.win, A.win.document.getElementById('ble-scan-btn')); }
  click(A.win, add); await sleep(1500);
  await openChat(A);
  await sendText(A, 'antes de cerrar'); await sleep(2500);
  await openChat(B); await sendText(B, 'B antes de cerrar'); await sleep(2500);

  // B cierra la app
  B.win.close(); nB.destroyActivity();
  await sleep(1000);
  await sendText(A, 'm1 con B cerrada'); await sleep(5000);
  await sendText(A, 'm2 con B cerrada'); await sleep(20000);

  // B reabre: el nativo arranca primero; el JS tarda jsDelay
  const tOpen = Date.now();
  nB.load();
  setTimeout(() => sendText(A, 'm3 justo al reabrir B'), 800);
  await sleep(jsDelay);
  B = await bootJs('B', nB);
  const want = ['m1 con B cerrada', 'm2 con B cerrada', 'm3 justo al reabrir B'];
  const llegada = {};
  for (let i = 0; i < 120 && Object.keys(llegada).length < want.length; i++) {
    await sleep(1000);
    const v = await B.win.vaultLoadMessages(idA);
    want.forEach((w) => { if (!llegada[w] && v.some((m) => m.content === w)) llegada[w] = Math.round((Date.now() - tOpen) / 1000) + ' s tras reabrir'; });
  }
  // B responde desde la app reabierta
  await openChat(B); await sendText(B, 'B tras reabrir'); await sleep(6000);
  const vA = await A.win.vaultLoadMessages(idB);
  const res = {
    build: path.basename(buildDir), asymmetric: opts.asymmetric, retain: opts.retain.length > 0, closeOnNoService: opts.closeOnNoService,
    llegada_a_B: want.map((w) => w + ': ' + (llegada[w] || 'NO LLEGÓ')),
    estado_en_A: want.map((w) => w + ': ' + statusOf(A, w)),
    respuesta_B_llega_a_A: vA.some((m) => m.content === 'B tras reabrir'),
    eventos_descartados_B: nB.stats.droppedEvents || 0,
    payloads_perdidos_sin_listener: radio.trace.filter((t) => t.indexOf('EVENTO PERDIDO') >= 0).map((t) => t.substring(0, 120)),
  };
  console.log('LIFECYCLE ' + JSON.stringify(res, null, 1));
  fs.writeFileSync(path.join(__dirname, 'last_logs_lifecycle.txt'), allLogs.join('\n'));
  process.exit(0);
})().catch((e) => { console.error('FALLO:', e.stack); process.exit(1); });
