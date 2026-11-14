// 3075 (diagnósticos S24 y S23 14-11 18:34–18:42): el S23 mandó un audio (169 KB) por el buzón de archivos al S24, que tenía la app
// dormida. El NATIVO del S24 confirmó la entrega (✓✓) en cuanto llegó el aviso, SIN haber bajado el audio; el S23 tomó ese ✓✓ como
// «ya lo tiene» y borró los trozos de los relés a los 20 s. Al abrir la app, el S24: «Faltan 5 de 5 trozos». Ahora los trozos se
// borran cuando el otro confirma que BAJÓ el archivo (su app lo dice al terminar) o al leerlo; si no, caducan solos.
// Uso: node blobnative.js <dir_build>
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone, installWebCrypto } = require('./native_mock');
const { NostrRelay } = require('./nostr_relay');

const buildDir = path.resolve(process.argv[2]);
const base = { readsContentFallback: true, retain: ['onPayloadReceived', 'onLanMessage', 'onLanUp', 'onLanDown'], closeOnNoService: true, pace: [15, 15], ioDelay: 25, asymmetric: true, noL2: true }; // noL2: sin canal L2CAP (como la tablet del dueño): un archivo > 5 MB va por el flujo normal, no por big_file.js
let RELAYS = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
class DistLoader extends ResourceLoader {
  constructor(dir) { super(); this.dir = dir; }
  fetch(url) { const f = path.join(this.dir, decodeURIComponent(new URL(url).pathname)); return fs.existsSync(f) ? Promise.resolve(fs.readFileSync(f)) : Promise.reject(new Error('no existe ' + f)); }
}
const logs = [];
// onReady(win): se llama en cuanto existe bleInterface (antes de que la app termine de arrancar) para enganchar espías
async function boot(name, native, onReady) {
  native.listeners = new Map();
  const vc = new VirtualConsole();
  ['log', 'warn', 'error'].forEach((l) => vc.on(l, (...a) => logs.push(`${new Date().toISOString().substring(14, 23)} [${name}] ${l}: ` + a.map(String).join(' ').substring(0, 300))));
  const dom = new JSDOM(fs.readFileSync(path.join(buildDir, 'dist', 'index.html'), 'utf8'), {
    url: 'https://' + name.toLowerCase() + '.nexo.test/index.html', runScripts: 'dangerously',
    resources: new DistLoader(path.join(buildDir, 'dist')), pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) { win.NEXO_NET_RELAYS = RELAYS; win.CapacitorCustomPlatform = { name: 'android' }; installWebCrypto(win); win.Capacitor = { Plugins: { NexoBLE: native.plugin() } }; win.HTMLElement.prototype.scrollTo = function () {}; },
  });
  const win = dom.window;
  let hooked = false;
  for (let i = 0; i < 1000 && !(win.NEXO && win.NEXO.initialized); i++) {
    if (!hooked && onReady && win.bleInterface) { hooked = true; onReady(win); }
    await sleep(10);
  }
  if (!hooked && onReady && win.bleInterface) onReady(win);
  await sleep(800);
  return { name, native, win };
}
const click = (win, el) => el && el.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
async function openChatWith(p, name) {
  const row = Array.from(p.win.document.querySelectorAll('#main-contacts-list .ble-contact-row')).find((r) => (r.querySelector('.ble-contact-name') || {}).textContent === name);
  click(p.win, row); await sleep(500); return !!row;
}
function sendText(p, t) { const i = p.win.document.getElementById('message-input'); i.value = t; i.dispatchEvent(new p.win.Event('input', { bubbles: true })); click(p.win, p.win.document.getElementById('send-btn')); }
async function sendFile(p, name, bytes) {
  const b = Buffer.alloc(bytes); for (let i = 0; i < b.length; i++) b[i] = (i * 31 + name.length * 7) & 255;
  click(p.win, p.win.document.querySelector('.attach-menu-item[data-type="file"]')); await sleep(100);
  const fin = Array.from(p.win.document.querySelectorAll('input[type=file]')).pop();
  Object.defineProperty(fin, 'files', { configurable: true, value: [new p.win.File([b], name, { type: 'application/octet-stream' })] });
  fin.dispatchEvent(new p.win.Event('change'));
  return b;
}
async function addFound(p, name) {
  let add = null;
  const find = () => { const row = Array.from(p.win.document.querySelectorAll('#ble-new-device > div')).find((d) => (d.querySelector('span') || {}).textContent === name); return row && row.querySelector('button'); };
  for (let i = 0; i < 400 && !add; i++) { await sleep(100); add = find(); if (!add && !p.win.bleInterface.isScanning) click(p.win, p.win.document.getElementById('ble-scan-btn')); }
  click(p.win, add); await sleep(2000);
  return !!add;
}
async function waitFor(fn, ms) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return Math.round((Date.now() - t0) / 100) / 10; await sleep(200); } return null; }
const vaultMsgs = (p, from) => p.win.vaultLoadMessages(from);
// el mensaje del vault cuyo adjunto es exactamente este archivo (el historial puede guardarlo aparte: attachmentRef)
async function findMsg(p, from, b64, own) {
  const list = await vaultMsgs(p, from);
  return list.find((m) => !!m._own === !!own && m.attachmentType && !m.deleted && (m.attachmentPayload || p.native.files.get(m.attachmentRef)) === b64) || null;
}
const statusOf = (p, msgId) => { const s = p.win.document.querySelector('.msg-status[data-msg-id="' + msgId + '"]'); const m = s && (s.className || '').match(/status-([a-z]+)/); return m ? m[1] : null; };


(async () => {
  const r = { prueba: 'blobnative', build: path.basename(buildDir) };
  const r1 = new NostrRelay({ honorDeletes: true }), r2 = new NostrRelay({ honorDeletes: true });
  RELAYS = [await r1.start(), await r2.start()];
  const relays = [r1, r2];
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', Object.assign({}, base, { wifi: 'casa', noTor: true })), nB = new NativePhone('B', 'BB:BB:BB:BB:BB:02', Object.assign({}, base, { wifi: 'oficina', noTor: true }));
  [nA, nB].forEach((n) => { radio.add(n); n.load(); });
  // B «dormido»: le llega el puntero del audio, su NATIVO confirma la entrega (✓✓) en el acto, pero la app no baja nada hasta despertar
  const held = [];
  let asleep = true;
  const A = await boot('A', nA), B = await boot('B', nB, (win) => {
    const bi = win.bleInterface, orig = bi._blobPointerReceived;
    if (typeof orig !== 'function') return;
    bi._blobPointerReceived = function () {
      const a = Array.from(arguments);
      if (!asleep) return orig.apply(this, a);
      held.push({ self: this, a: a, orig: orig });
      try { win.bleInterface.ackSystem.sendAck(a[0], a[2], a[5]); } catch (e) {} // la confirmación del nativo (NetBg), sin haber bajado nada
    };
  });
  const idA = A.win.bleInterface.localNexoId.toLowerCase(), idB = B.win.bleInterface.localNexoId.toLowerCase();
  A.win.bleInterface.togglePanel(); const paired = await addFound(A, 'B'); A.win.bleInterface.togglePanel();
  if (!paired) { console.log('BLOBNATIVE ' + JSON.stringify({ prueba: 'blobnative', resultado: 'FALLO', error: 'no empareja' })); process.exit(1); }
  await openChatWith(A, 'B'); sendText(A, 'hola B'); await sleep(3000);
  await openChatWith(B, 'A'); sendText(B, 'hola A'); await sleep(3000);
  radio.block(nA, nB);
  const netA = () => A.win.bleInterface.net, ackA = () => A.win.bleInterface.ackSystem;
  netA().tick(); B.win.bleInterface.net.tick();
  r.en_linea_por_internet_s = await waitFor(() => A.win.bleInterface.linkOf(idB) === 'internet', 60000);
  // A ve a B fuera de línea en el momento de mandar (como el S23 con el S24 a las 18:34): el audio va por el buzón de archivos
  const pB = netA().peers.get(idB); if (pB) pB.lastRx = 0; await netA().tick();
  await openChatWith(A, 'B');
  const archivo = await sendFile(A, 'audio_buzon.m4a', 170000);
  const b64 = archivo.toString('base64');
  r.puntero_le_llega_dormido_s = await waitFor(() => held.length > 0, 60000);
  const kind5 = () => relays.some((x) => x.events.some((e) => e.kind === 5));
  await sleep(8000); // el ✓✓ del nativo llega a A
  r.A_borra_antes_de_que_lo_baje = kind5();
  // B despierta y baja el audio
  asleep = false;
  held.forEach((h) => h.orig.apply(h.self, h.a));
  let msgB = null;
  r.B_recibe_el_audio_s = await waitFor(async () => !!(msgB = await findMsg(B, idA, b64, false)), 60000);
  r.B_falla_faltan_trozos = logs.some((l) => /\[B\].*\[BLOB\].*Faltan/.test(l));
  r.A_borra_despues_s = await waitFor(() => kind5(), 30000);
  const ok = r.en_linea_por_internet_s !== null && r.puntero_le_llega_dormido_s !== null && !r.A_borra_antes_de_que_lo_baje && r.B_recibe_el_audio_s !== null && !r.B_falla_faltan_trozos && r.A_borra_despues_s !== null;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('BLOBNATIVE ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_blobnative.txt'), logs.join('\n'));
  try { A.win.bleInterface.net._closeAll(); B.win.bleInterface.net._closeAll(); } catch (e) {}
  await r1.stop(); await r2.stop();
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('BLOBNATIVE ' + JSON.stringify({ prueba: 'blobnative', resultado: 'FALLO', error: String(e && e.message) })); fs.writeFileSync(path.join(__dirname, 'last_logs_blobnative.txt'), logs.join('\n')); process.exit(1); });
