// Auditoría C1 (ronda 2777): las confirmaciones (✓✓/leído) viajaban sin firmar. Cualquiera que supiera el msgId (va en
// claro) podía mandar una confirmación falsa: el emisor dejaba de reintentar y el mensaje se perdía mostrando ✓✓. Ahora,
// con un contacto moderno (proto 2), la confirmación debe venir firmada con el secreto de la pareja; una falsa se
// ignora. Aquí se empareja A↔B (proto 2) y se comprueba que una confirmación falsa de "B" (sin firma, o con firma mala)
// NO marca entregado el mensaje de A, y que la entrega real (acks firmados) sigue funcionando.
// Uso: node ackforge.js <dir_build> [--io-delay=25]
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone, installWebCrypto } = require('./native_mock');

const buildDir = path.resolve(process.argv[2]);
const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith('--' + k)); if (!a) return d; const v = a.split('=')[1]; return v === undefined ? true : Number(v); };
const opts = { readsContentFallback: true, retain: ['onPayloadReceived'], closeOnNoService: true, pace: [15, 15], ioDelay: arg('io-delay', 0), asymmetric: true };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
class DistLoader extends ResourceLoader {
  constructor(dir) { super(); this.dir = dir; }
  fetch(url) { const f = path.join(this.dir, decodeURIComponent(new URL(url).pathname)); return fs.existsSync(f) ? Promise.resolve(fs.readFileSync(f)) : Promise.reject(new Error('no existe ' + f)); }
}
const logs = [];
async function boot(name, native) {
  native.listeners = new Map();
  const vc = new VirtualConsole();
  ['log', 'warn', 'error'].forEach((l) => vc.on(l, (...a) => logs.push(`[${name}] ${l}: ` + a.map(String).join(' ').substring(0, 250))));
  const dom = new JSDOM(fs.readFileSync(path.join(buildDir, 'dist', 'index.html'), 'utf8'), {
    url: 'https://' + name.toLowerCase() + '.nexo.test/index.html', runScripts: 'dangerously',
    resources: new DistLoader(path.join(buildDir, 'dist')), pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) { win.CapacitorCustomPlatform = { name: 'android' }; installWebCrypto(win); win.Capacitor = { Plugins: { NexoBLE: native.plugin() } }; win.HTMLElement.prototype.scrollTo = function () {}; },
  });
  const win = dom.window;
  for (let i = 0; i < 100 && !(win.NEXO && win.NEXO.initialized); i++) await sleep(100);
  await sleep(800);
  return { name, native, win };
}
const click = (win, el) => el && el.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
async function openChat(p) { click(p.win, p.win.document.querySelector('#main-contacts-list .ble-contact-row')); await sleep(500); }
async function sendText(p, t) { const i = p.win.document.getElementById('message-input'); i.value = t; i.dispatchEvent(new p.win.Event('input', { bubbles: true })); click(p.win, p.win.document.getElementById('send-btn')); }

(async () => {
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', opts), nB = new NativePhone('B', 'BB:BB:BB:BB:BB:02', opts);
  radio.add(nA); radio.add(nB); nA.load(); nB.load();
  const [A, B] = await Promise.all([boot('A', nA), boot('B', nB)]);
  const r = { build: path.basename(buildDir) };
  // Emparejar: A escanea, agrega a B y abre el chat
  A.win.bleInterface.togglePanel();
  let add = null;
  for (let i = 0; i < 400 && !add; i++) { await sleep(100); add = A.win.document.querySelector('#ble-new-device > div button'); if (!add && !A.win.bleInterface.isScanning) click(A.win, A.win.document.getElementById('ble-scan-btn')); }
  click(A.win, add); await sleep(2500);
  A.win.bleInterface.togglePanel();
  await openChat(A);
  const idB = B.win.bleInterface.localNexoId;
  // 1. Entrega de verdad: A escribe a B; con los acks firmados debe marcarse entregado/leído
  await sendText(A, 'hola B (entrega real)'); await sleep(3500);
  const sys = A.win.bleInterface.ackSystem;
  const cB = A.win.bleInterface.getBLEContacts().find((c) => (c.nexoId || c.deviceUUID || '').toLowerCase() === idB.toLowerCase());
  r.contacto_proto2 = !!(cB && cB.proto === 2 && cB.publicKey);
  const bubbleStatus = () => Array.from(A.win.document.querySelectorAll('#messages-container .message.own')).map((m) => ((m.querySelector('.msg-status') || {}).className || '').replace('msg-status status-', '')).pop();
  r.entrega_real_marca = /delivered|read/.test(bubbleStatus() || '');

  // 2. Confirmación FALSA: un tercero que sabe el msgId manda un ack "de B" sin firma (y luego con firma mala).
  // Se registra un envío pendiente a B y se inyectan las confirmaciones falsas: no deben marcarlo entregado.
  const fakeId = 'forge_test_msg_1';
  const statuses = [];
  A.win.addEventListener('nexo:ble:ackStatus', (e) => { if (e.detail && e.detail.msgId === fakeId) statuses.push(e.detail.status); });
  sys.pendingAcks.set(fakeId, { msgId: fakeId, to: idB.toLowerCase(), quiet: false, retries: 0, resolve() {}, reject() {}, timer: setTimeout(() => {}, 9e6) });
  sys.processIncomingAck(JSON.stringify({ v: 1, type: 'ack', msgId: fakeId, from: idB, ts: Date.now() }));          // sin firma
  sys.processIncomingAck(JSON.stringify({ v: 1, type: 'ack', msgId: fakeId, from: idB, ts: Date.now(), a: 'AAAAAAAAAAAAAAAA' })); // firma mala
  sys.processIncomingAck(JSON.stringify({ v: 1, type: 'read_receipt', msgId: fakeId, from: idB, ts: Date.now() }));  // "leído" falso
  await sleep(600);
  r.falsa_no_marca_entregado = !statuses.some((s) => s === 'delivered' || s === 'read');
  r.sigue_pendiente = sys.pendingAcks.has(fakeId);
  try { clearTimeout(sys.pendingAcks.get(fakeId).timer); } catch (e) {}
  sys.pendingAcks.delete(fakeId);

  const ok = r.contacto_proto2 && r.entrega_real_marca && r.falsa_no_marca_entregado && r.sigue_pendiente;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('ACKFORGE ' + JSON.stringify(r));
  if (!ok) console.log(logs.slice(-40).join('\n'));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('ACKFORGE {"resultado":"FALLO","error":"' + String(e && e.message) + '"}'); process.exit(1); });
