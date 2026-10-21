// Compartir contactos: A conoce a B y a C; B nunca ha visto a C. A comparte C con B; B pulsa la tarjeta
// (se agrega y parpadea), abre el chat de C y le escribe: debe llegar aunque nunca se habían conectado.
// Uso: node share.js <dir_build> [--io-delay=25]
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone } = require('./native_mock');

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
  const vc = new VirtualConsole();
  ['log', 'warn', 'error'].forEach((l) => vc.on(l, (...a) => logs.push(`${new Date().toISOString().substring(14, 23)} [${name}] ${l}: ` + a.map(String).join(' ').substring(0, 250))));
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
const click = (win, el) => el && el.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
const rows = (p) => Array.from(p.win.document.querySelectorAll('#main-contacts-list .ble-contact-row')).map((r) => ({ name: (r.querySelector('.ble-contact-name') || {}).textContent, blink: r.classList.contains('ble-contact-new'), msg: (r.querySelector('.ble-contact-msg') || {}).textContent }));
async function openChatWith(p, name) {
  const row = Array.from(p.win.document.querySelectorAll('#main-contacts-list .ble-contact-row')).find((r) => (r.querySelector('.ble-contact-name') || {}).textContent === name);
  click(p.win, row); await sleep(500); return !!row;
}
async function closeChat(p) { p.win.dispatchEvent(new p.win.CustomEvent('nexo:ble:closeChat', { detail: {} })); await sleep(300); }
async function sendText(p, t) { const i = p.win.document.getElementById('message-input'); i.value = t; i.dispatchEvent(new p.win.Event('input', { bubbles: true })); click(p.win, p.win.document.getElementById('send-btn')); }
async function addFound(p) {
  let add = null;
  for (let i = 0; i < 400 && !add; i++) { await sleep(100); add = p.win.document.querySelector('#ble-new-device button'); if (!add && !p.win.bleInterface.isScanning) click(p.win, p.win.document.getElementById('ble-scan-btn')); }
  click(p.win, add); await sleep(2000);
}

(async () => {
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', opts), nB = new NativePhone('B', 'BB:BB:BB:BB:BB:02', opts), nC = new NativePhone('C', 'CC:CC:CC:CC:CC:03', opts);
  [nA, nB, nC].forEach((n) => { radio.add(n); n.load(); });
  // C empieza fuera del alcance de B: A añade a B y a C, pero B no ve a C hasta después
  const [A, B, C] = await Promise.all([boot('A', nA), boot('B', nB), boot('C', nC)]);
  const idC = C.win.bleInterface.localNexoId, idB = B.win.bleInterface.localNexoId;
  A.win.bleInterface.togglePanel(); await addFound(A); await addFound(A); A.win.bleInterface.togglePanel();
  await sleep(1500);
  // A saluda a B (B conoce a A)
  await openChatWith(A, 'B'); await sendText(A, 'hola B'); await sleep(2500);
  const r = { build: path.basename(buildDir), B_conoce_a_C_antes: B.win.vaultLoadContacts().some((c) => (c.nexoId || '').toLowerCase() === idC.toLowerCase()) };
  // A comparte C con B (botón contacto del menú de adjuntos)
  click(A.win, A.win.document.querySelector('.attach-menu-item[data-type="contact"]')); await sleep(400);
  const sheet = A.win.document.getElementById('nexo-share-sheet');
  r.hoja_A_contactos = sheet ? Array.from(sheet.querySelectorAll('.nexo-pick-row')).map((x) => x.textContent) : null;
  const rowC = sheet && Array.from(sheet.querySelectorAll('.nexo-pick-row')).find((x) => x.textContent.indexOf('C') === 0);
  if (rowC) { const cb = rowC.querySelector('input'); cb.checked = true; cb.dispatchEvent(new A.win.Event('change')); }
  r.boton_enviar = sheet && sheet.querySelector('#nexo-share-send').textContent;
  click(A.win, sheet && sheet.querySelector('#nexo-share-send')); await sleep(3000);
  r.tarjeta_en_A = !!A.win.document.querySelector('#messages-container .contact-card');
  // B abre el chat con A y pulsa la tarjeta
  await openChatWith(B, 'A'); await sleep(800);
  const card = B.win.document.querySelector('#messages-container .contact-card');
  r.tarjeta_en_B = card ? card.textContent.replace(/\s+/g, ' ').trim() : null;
  click(B.win, card && card.querySelector('.contact-card-add')); await sleep(500);
  r.boton_tras_pulsar = card && card.querySelector('.contact-card-add').textContent;
  await closeChat(B); await sleep(500);
  r.lista_B_tras_agregar = rows(B);
  // B escribe a C (nunca conectados) con "Escribir" desde la tarjeta / la lista
  await openChatWith(B, 'C');
  r.parpadeo_tras_abrir_chat = rows(B).filter((x) => x.blink).map((x) => x.name);
  if (arg('c-away', false)) { nC.setOffline(true); await sleep(1000); }
  await sendText(B, 'hola C, soy B'); const t0 = Date.now();
  if (arg('c-away', false)) { await sleep(3000); r.estado_B_con_C_fuera = ((B.win.document.querySelector('#messages-container .message.own .msg-status') || {}).className || '').replace('msg-status status-', ''); setTimeout(() => nC.setOffline(false), 17000); }
  let llega = false;
  for (let i = 0; i < 90 && !llega; i++) { await sleep(1000); llega = (await C.win.vaultLoadMessages(idB)).some((m) => m.content === 'hola C, soy B'); }
  r.mensaje_B_a_C_llega = llega ? Math.round((Date.now() - t0) / 1000) + ' s' : 'NO';
  await sleep(2000);
  r.estado_en_B = ((B.win.document.querySelector('#messages-container .message.own .msg-status') || {}).className || '').replace('msg-status status-', '');
  r.C_tiene_a_B = C.win.vaultLoadContacts().some((c) => (c.nexoId || '').toLowerCase() === idB.toLowerCase());
  console.log('SHARE ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_share.txt'), logs.join('\n'));
  process.exit(0);
})().catch((e) => { console.error('FALLO:', e.stack); fs.writeFileSync(path.join(__dirname, 'last_logs_share.txt'), logs.join('\n')); process.exit(1); });
