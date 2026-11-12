// 3020 (batería de la 3019, blobe2e/bigcita): el «tengo internet» (kx nt:1) de un teléfono que AÚN no es contacto se
// recordaba solo en memoria y se aplicaba al contacto en el siguiente ciclo de internet (segundos después). Si la app se
// cerraba antes, se perdía: al volver, ese contacto no contaba para internet → no se leía su buzón (textos ni archivos) ni
// se le veía en línea. Escena: A agrega a B por Bluetooth y le escribe; B lo agrega solo al recibir el texto y CIERRA la app
// enseguida (≤ 0,6 s). B vuelve sin Bluetooth (cada uno en su casa, solo internet).
//  N1: al volver, B tiene a A marcado «con internet» (nt) y cuenta para internet.
//  N2: B ve a A en línea por internet.
//  N3: el texto que A le deja en el buzón mientras B está cerrado le llega a B.
// Uso: node ntpersist.js <dir_build>
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
  const r = { prueba: 'ntpersist', build: path.basename(buildDir) };
  const r1 = new NostrRelay(), r2 = new NostrRelay(), r3 = new NostrRelay();
  RELAYS = [await r1.start(), await r2.start(), await r3.start()];
  const relays = [r1, r2, r3];
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', Object.assign({}, base, { wifi: 'casa', noTor: true })), nB = new NativePhone('B', 'BB:BB:BB:BB:BB:02', Object.assign({}, base, { wifi: 'oficina', noTor: true }));
  [nA, nB].forEach((n) => { radio.add(n); n.load(); });
  let A = await boot('A', nA), B = await boot('B', nB);
  const idA = A.win.bleInterface.localNexoId.toLowerCase(), idB = B.win.bleInterface.localNexoId.toLowerCase();
  A.win.bleInterface.togglePanel(); const paired = await addFound(A, 'B'); A.win.bleInterface.togglePanel();
  if (!paired) { console.log('NTPERSIST ' + JSON.stringify({ prueba: 'ntpersist', resultado: 'FALLO', error: 'no empareja' })); process.exit(1); }
  await openChatWith(A, 'B'); sendText(A, 'hola B');
  const isContact = () => (B.win.bleInterface.getBLEContacts() || []).some((c) => (c.nexoId || c.deviceUUID || '').toLowerCase() === idA);
  r.B_agrega_a_A_s = await waitFor(() => isContact(), 20000);
  await sleep(600);
  // B cierra la app enseguida y se va a su casa (sin Bluetooth)
  B.win.close(); nB.destroyActivity();
  radio.block(nA, nB);
  const pB = A.win.bleInterface.net.peers.get(idB); if (pB) pB.lastRx = 0; await A.win.bleInterface.net.tick();
  await sleep(1500);
  sendText(A, 'texto al buzón');
  await sleep(2500);
  nB.load();
  B = await boot('B', nB);
  const cB = (B.win.bleInterface.getBLEContacts() || []).find((c) => (c.nexoId || c.deviceUUID || '').toLowerCase() === idA);
  r.N1_B_recuerda_internet_de_A = !!(cB && cB.nt) && B.win.bleInterface.net._netContacts().length === 1;
  r.N2_B_ve_a_A_en_linea_s = await waitFor(() => B.win.bleInterface.linkOf(idA) === 'internet', 30000);
  r.N3_texto_del_buzon_llega_s = await waitFor(async () => (await B.win.vaultLoadMessages(idA)).some((m) => !m._own && /texto al buz/.test(m.text || m.content || '')), 30000);
  r.errores = logs.filter((l) => /Error procesando|No se pudo descifrar|ilegible/.test(l)).slice(0, 3);
  const ok = typeof r.B_agrega_a_A_s === 'number' && r.N1_B_recuerda_internet_de_A === true && typeof r.N2_B_ve_a_A_en_linea_s === 'number' && typeof r.N3_texto_del_buzon_llega_s === 'number' && r.errores.length === 0;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('NTPERSIST ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_ntpersist.txt'), logs.join('\n'));
  await Promise.all(relays.map((x) => x.stop()));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('NTPERSIST {"prueba":"ntpersist","resultado":"FALLO","error":"' + String(e && e.message).replace(/"/g, "'") + '"}'); console.error(e && e.stack); fs.writeFileSync(path.join(__dirname, 'last_logs_ntpersist.txt'), logs.join('\n')); process.exit(1); });
