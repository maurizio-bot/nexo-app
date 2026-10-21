// Orden de la lista de contactos con varios contactos: debe ser por último mensaje (enviado o
// recibido) y no moverse por actividad de radio (pings, escaneos, reconexiones).
// Uso: node contacts.js <dir_build> [--io-delay=25]
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone } = require('./native_mock');

const buildDir = path.resolve(process.argv[2]);
const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith('--' + k)); if (!a) return d; const v = a.split('=')[1]; return v === undefined ? true : Number(v); };
const opts = { readsContentFallback: true, retain: ['onPayloadReceived'], closeOnNoService: true, pace: [15, 15], ioDelay: arg('io-delay', 0) };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
class DistLoader extends ResourceLoader {
  constructor(dir) { super(); this.dir = dir; }
  fetch(url) { const f = path.join(this.dir, decodeURIComponent(new URL(url).pathname)); return fs.existsSync(f) ? Promise.resolve(fs.readFileSync(f)) : Promise.reject(new Error('no existe ' + f)); }
}
const logs = [];
async function boot(name, native) {
  const vc = new VirtualConsole();
  ['log', 'warn', 'error'].forEach((l) => vc.on(l, (...a) => logs.push(`[${name}] ${l}: ` + a.map(String).join(' ').substring(0, 250))));
  const dom = new JSDOM(fs.readFileSync(path.join(buildDir, 'dist', 'index.html'), 'utf8'), {
    url: 'https://' + name.toLowerCase() + '.nexo.test/index.html', runScripts: 'dangerously',
    resources: new DistLoader(path.join(buildDir, 'dist')), pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) { win.CapacitorCustomPlatform = { name: 'android' }; win.Capacitor = { Plugins: { NexoBLE: native.plugin() } }; win.HTMLElement.prototype.scrollTo = function () {}; },
  });
  const win = dom.window;
  for (let i = 0; i < 100 && !(win.NEXO && win.NEXO.initialized); i++) await sleep(100);
  await sleep(800);
  return { name, native, win };
}
const click = (win, el) => el.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
const order = (p) => Array.from(p.win.document.querySelectorAll('#main-contacts-list .ble-contact-row .ble-contact-name')).map((e) => e.textContent);
async function openChatWith(p, name) {
  const row = Array.from(p.win.document.querySelectorAll('#main-contacts-list .ble-contact-row')).find((r) => (r.querySelector('.ble-contact-name') || {}).textContent === name);
  if (!row) return false;
  click(p.win, row); await sleep(400); return true;
}
async function closeChat(p) { p.win.dispatchEvent(new p.win.CustomEvent('nexo:ble:closeChat', { detail: {} })); await sleep(300); }
async function sendText(p, t) { const i = p.win.document.getElementById('message-input'); i.value = t; i.dispatchEvent(new p.win.Event('input', { bubbles: true })); click(p.win, p.win.document.getElementById('send-btn')); }

(async () => {
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', opts), nB = new NativePhone('B', 'BB:BB:BB:BB:BB:02', opts), nC = new NativePhone('C', 'CC:CC:CC:CC:CC:03', opts);
  [nA, nB, nC].forEach((n) => { radio.add(n); n.load(); });
  const [A, B, C] = await Promise.all([boot('A', nA), boot('B', nB), boot('C', nC)]);
  // A añade a B y a C
  A.win.bleInterface.togglePanel();
  for (let k = 0; k < 2; k++) {
    let add = null;
    for (let i = 0; i < 400 && !add; i++) { await sleep(100); add = A.win.document.querySelector('#ble-new-device button'); if (!add && !A.win.bleInterface.isScanning) click(A.win, A.win.document.getElementById('ble-scan-btn')); }
    click(A.win, add); await sleep(2000);
  }
  A.win.bleInterface.togglePanel();
  await sleep(1500);
  const nameB = B.win.bleInterface.localDeviceName || 'B', nameC = C.win.bleInterface.localDeviceName || 'C';
  const names = order(A);
  // A escribe a C y a B; luego C responde a A
  await openChatWith(A, names.find((n) => n.indexOf('C') >= 0));
  await sendText(A, 'hola C'); await sleep(2500);
  await closeChat(A);
  await openChatWith(A, names.find((n) => n.indexOf('B') >= 0) || names[0]);
  await sendText(A, 'hola B'); await sleep(2500);
  await closeChat(A);
  const rowC = C.win.document.querySelector('#main-contacts-list .ble-contact-row');
  if (rowC) { click(C.win, rowC); await sleep(400); await sendText(C, 'hola A, soy C'); }
  await sleep(3000);
  // 30 s sin mensajes nuevos: la lista de A no debe moverse
  const snapshots = [];
  // --churn: actividad de radio (B se va y vuelve cada 5 s: reconexiones, escaneos, lastSeen)
  const churn = !!arg('churn', false);
  for (let i = 0; i < 60; i++) {
    if (churn && i % 10 === 0) nB.setOffline(true);
    if (churn && i % 10 === 4) nB.setOffline(false);
    snapshots.push(order(A).join(' | ')); await sleep(500);
  }
  if (churn) { nB.setOffline(false); await sleep(8000); }
  const distinct = Array.from(new Set(snapshots));
  const quieto = order(A);
  // A vuelve a escribir a B: B debe subir
  await openChatWith(A, quieto.find((n) => n.indexOf('B') >= 0));
  await sendText(A, 'otra vez B'); await sleep(2500);
  await closeChat(A); await sleep(800);
  const trasEscribirB = order(A);
  console.log('CONTACTS ' + JSON.stringify({
    build: path.basename(buildDir), nombres: { B: nameB, C: nameC },
    ordenes_distintos_en_30s_sin_mensajes: distinct.length, ordenes_vistos: distinct,
    orden_esperado_C_primero: quieto, orden_tras_escribir_a_B: trasEscribirB,
    hora_mostrada: Array.from(A.win.document.querySelectorAll('#main-contacts-list .ble-contact-time')).map((e) => e.textContent),
    ultimo_mensaje_mostrado: Array.from(A.win.document.querySelectorAll('#main-contacts-list .ble-contact-msg')).map((e) => e.textContent),
    contactos_guardados_en_disco: (() => { try { return JSON.parse(nA.files.get('nexo_vault_contacts.json')).contacts.map((c) => c.name + ':' + (c.lastMessage || '')); } catch (e) { return null; } })(),
  }));
  fs.writeFileSync(path.join(__dirname, 'last_logs_contacts.txt'), logs.join('\n'));
  process.exit(0);
})().catch((e) => { console.error('FALLO:', e.stack); process.exit(1); });
