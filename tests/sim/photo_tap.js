// Ronda 2797 (pedido del dueño): en la lista de contactos, tocar la FOTO del contacto la abre a tamaño grande (visor);
// tocar el NOMBRE entra al chat. Sin foto, tocar el círculo cae a la fila y abre el chat.
// A y B por Bluetooth; en B comprobamos los toques sobre la fila de A. A elige foto (como avatar.js: NEXO_makeAvatar).
// Uso: node photo_tap.js <dir_build>
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone, installWebCrypto } = require('./native_mock');

const buildDir = path.resolve(process.argv[2]);
const opts = { readsContentFallback: true, retain: ['onPayloadReceived'], closeOnNoService: true, pace: [15, 15], ioDelay: 25, asymmetric: true };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PHOTO = 'data:image/jpeg;base64,' + Buffer.alloc(9000, 7).toString('base64');
class DL extends ResourceLoader { constructor(d) { super(); this.d = d; } fetch(u) { const f = path.join(this.d, decodeURIComponent(new URL(u).pathname)); return fs.existsSync(f) ? Promise.resolve(fs.readFileSync(f)) : Promise.reject(new Error('x')); } }
const logs = [];
async function boot(name, native) {
  const vc = new VirtualConsole();
  ['log', 'warn', 'error'].forEach((l) => vc.on(l, (...a) => logs.push(`[${name}] ${l}: ` + a.map(String).join(' ').substring(0, 250))));
  const dom = new JSDOM(fs.readFileSync(path.join(buildDir, 'dist', 'index.html'), 'utf8'), {
    url: 'https://' + name.toLowerCase() + '.nexo.test/index.html', runScripts: 'dangerously', resources: new DL(path.join(buildDir, 'dist')), pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) { win.CapacitorCustomPlatform = { name: 'android' }; installWebCrypto(win); win.Capacitor = { Plugins: { NexoBLE: native.plugin() } }; win.HTMLElement.prototype.scrollTo = function () {}; win.NEXO_makeAvatar = () => PHOTO; },
  });
  const win = dom.window;
  for (let i = 0; i < 100 && !(win.NEXO && win.NEXO.initialized); i++) await sleep(100);
  await sleep(800);
  return { name, native, win };
}
const click = (w, el) => el && el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
async function addFound(p) {
  let add = null;
  for (let i = 0; i < 400 && !add; i++) { await sleep(100); add = p.win.document.querySelector('#ble-new-device > div button'); if (!add && !p.win.bleInterface.isScanning) click(p.win, p.win.document.getElementById('ble-scan-btn')); }
  click(p.win, add); await sleep(2000);
}
async function openChatWith(p, name) {
  let row; for (let i = 0; i < 300 && !row; i++) { row = Array.from(p.win.document.querySelectorAll('#main-contacts-list .ble-contact-row')).find((r) => (r.querySelector('.ble-contact-name') || {}).textContent === name); if (!row) await sleep(100); }
  click(p.win, row); await sleep(600); return !!row;
}
async function closeChat(p) { p.win.dispatchEvent(new p.win.CustomEvent('nexo:ble:closeChat', { detail: {} })); await sleep(300); }
function sendText(p, t) { const i = p.win.document.getElementById('message-input'); i.value = t; i.dispatchEvent(new p.win.Event('input', { bubbles: true })); click(p.win, p.win.document.getElementById('send-btn')); }
const wait = async (c, s) => { for (let i = 0; i < s * 5; i++) { if (await c()) return true; await sleep(200); } return false; };
const rowOf = (p, name) => Array.from(p.win.document.querySelectorAll('#main-contacts-list .ble-contact-row')).find((r) => (r.querySelector('.ble-contact-name') || {}).textContent === name);
const rowPhoto = (p, name) => { const row = rowOf(p, name); const av = row && row.querySelector('.ble-contact-avatar'); return !!(av && /url\(["']?data:image\/jpeg/.test(av.getAttribute('style') || '')); };
const inChat = (p) => p.win.document.body.classList.contains('chat-view-active');
const fsOpen = (p) => !!p.win.document.querySelector('#fullscreen-media-overlay img');
const closeFs = (p) => { const ov = p.win.document.getElementById('fullscreen-media-overlay'); if (ov) ov.remove(); };

(async () => {
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', opts), nB = new NativePhone('B', 'BB:BB:BB:BB:BB:02', opts);
  [nA, nB].forEach((n) => { radio.add(n); n.load(); });
  const [A, B] = await Promise.all([boot('A', nA), boot('B', nB)]);
  const idA = A.win.bleInterface.localNexoId.toLowerCase();
  const r = { build: path.basename(buildDir) };
  // Emparejar: A agrega a B y saluda (así B conoce a A y lo pinta en su lista)
  A.win.bleInterface.togglePanel(); await addFound(A); A.win.bleInterface.togglePanel();
  await openChatWith(A, 'B'); sendText(A, 'hola'); await sleep(2500); await closeChat(A);
  r.B_tiene_a_A = await wait(() => !!rowOf(B, 'A'), 30);

  // 1. SIN foto todavía: tocar el avatar de A en B abre el CHAT (cae a la fila)
  closeFs(B); await closeChat(B);
  click(B.win, rowOf(B, 'A').querySelector('.ble-contact-avatar')); await sleep(500);
  r.sin_foto_avatar_abre_chat = inChat(B) && !fsOpen(B);
  await closeChat(B);

  // A elige su foto → B la recibe
  A.win.dispatchEvent(new A.win.CustomEvent('nexo:ui:profile')); await sleep(400);
  click(A.win, A.win.document.getElementById('nexo-av-pick')); await sleep(200);
  const inp = Array.from(A.win.document.querySelectorAll('input[type=file]')).find((i) => i.accept === 'image/*');
  if (inp) { Object.defineProperty(inp, 'files', { configurable: true, value: [new A.win.File([Buffer.alloc(100)], 'yo.jpg', { type: 'image/jpeg' })] }); inp.dispatchEvent(new A.win.Event('change')); }
  await sleep(500);
  { const c = A.win.document.getElementById('nexo-profile-close'); if (c) click(A.win, c); }
  r.B_ve_la_foto = await wait(() => rowPhoto(B, 'A'), 60);

  // 2. CON foto: tocar el avatar de A en B abre el VISOR grande (no el chat)
  await closeChat(B); closeFs(B);
  click(B.win, rowOf(B, 'A').querySelector('.ble-contact-avatar')); await sleep(500);
  r.con_foto_avatar_abre_visor = fsOpen(B) && !inChat(B);
  closeFs(B);

  // 3. Tocar el NOMBRE abre el chat
  await closeChat(B); closeFs(B);
  click(B.win, rowOf(B, 'A').querySelector('.ble-contact-name')); await sleep(500);
  r.nombre_abre_chat = inChat(B) && !fsOpen(B);
  await closeChat(B);

  r.errores = logs.filter((l) => /TypeError|undefined is not|No se pudo descifrar/.test(l)).slice(0, 4);
  const ok = r.B_tiene_a_A && r.sin_foto_avatar_abre_chat && r.B_ve_la_foto && r.con_foto_avatar_abre_visor && r.nombre_abre_chat && r.errores.length === 0;
  r.resultado = ok ? 'OK' : 'FAIL';
  console.log('PHOTOTAP ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_phototap.txt'), logs.join('\n'));
  process.exit(0);
})().catch((e) => { console.error('FALLO:', e.stack); fs.writeFileSync(path.join(__dirname, 'last_logs_phototap.txt'), logs.join('\n')); process.exit(1); });
