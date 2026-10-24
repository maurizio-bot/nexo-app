// Ronda 2765 (pedido del dueño): foto de perfil. A, B y C por Bluetooth; A y B contactos.
//  1. A elige su foto en Perfil: B la ve en la lista (y en la fila de conectados), sin mensaje visible ni "no leído";
//     la copia oculta de A se borra al entregarse.
//  2. B se reinicia: la foto sigue.
//  3. A agrega a C después: C la recibe al conectar.
//  4. A quita su foto: B deja de verla.
// El simulador no tiene canvas: la foto ya recortada la da window.NEXO_makeAvatar (como NEXO_makeVideoPreview).
// Uso: node avatar.js <dir_build>
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone } = require('./native_mock');

const buildDir = path.resolve(process.argv[2]);
const opts = { readsContentFallback: true, retain: ['onPayloadReceived'], closeOnNoService: true, pace: [15, 15], ioDelay: 25, asymmetric: true };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PHOTO = 'data:image/jpeg;base64,' + Buffer.alloc(9000, 7).toString('base64');
class DL extends ResourceLoader { constructor(d) { super(); this.d = d; } fetch(u) { const f = path.join(this.d, decodeURIComponent(new URL(u).pathname)); return fs.existsSync(f) ? Promise.resolve(fs.readFileSync(f)) : Promise.reject(new Error('x')); } }
const logs = [];
async function boot(name, native) {
  const vc = new VirtualConsole();
  ['log', 'warn', 'error'].forEach((l) => vc.on(l, (...a) => logs.push(`${new Date().toISOString().substring(14, 23)} [${name}] ${l}: ` + a.map(String).join(' ').substring(0, 250))));
  const dom = new JSDOM(fs.readFileSync(path.join(buildDir, 'dist', 'index.html'), 'utf8'), {
    url: 'https://' + name.toLowerCase() + '.nexo.test/index.html', runScripts: 'dangerously', resources: new DL(path.join(buildDir, 'dist')), pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) { win.CapacitorCustomPlatform = { name: 'android' }; require('./native_mock').installWebCrypto(win); win.Capacitor = { Plugins: { NexoBLE: native.plugin() } }; win.HTMLElement.prototype.scrollTo = function () {}; win.NEXO_makeAvatar = () => PHOTO; },
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
const rowPhoto = (p, name) => { const row = Array.from(p.win.document.querySelectorAll('#main-contacts-list .ble-contact-row')).find((r) => (r.querySelector('.ble-contact-name') || {}).textContent === name); const av = row && row.querySelector('.ble-contact-avatar'); return !!(av && /url\(["']?data:image\/jpeg/.test(av.getAttribute('style') || '')); };

(async () => {
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', opts), nB = new NativePhone('B', 'BB:BB:BB:BB:BB:02', opts), nC = new NativePhone('C', 'CC:CC:CC:CC:CC:03', opts);
  [nA, nB, nC].forEach((n) => { radio.add(n); n.load(); });
  let [A, B, C] = await Promise.all([boot('A', nA), boot('B', nB), boot('C', nC)]);
  const idA = A.win.bleInterface.localNexoId.toLowerCase(), idB = B.win.bleInterface.localNexoId.toLowerCase();
  const r = { build: path.basename(buildDir) };
  A.win.bleInterface.togglePanel(); await addFound(A); A.win.bleInterface.togglePanel();
  await openChatWith(A, 'B'); sendText(A, 'hola'); await sleep(2500); await closeChat(A);
  r.contactos = await wait(async () => (await B.win.vaultLoadMessages(idA)).some((m) => m.content === 'hola'), 30);
  // 1. A elige su foto en Perfil
  A.win.dispatchEvent(new A.win.CustomEvent('nexo:ui:profile')); await sleep(400);
  click(A.win, A.win.document.getElementById('nexo-av-pick')); await sleep(200);
  const inp = Array.from(A.win.document.querySelectorAll('input[type=file]')).find((i) => i.accept === 'image/*');
  r.selector = !!inp;
  if (inp) { Object.defineProperty(inp, 'files', { configurable: true, value: [new A.win.File([Buffer.alloc(100)], 'yo.jpg', { type: 'image/jpeg' })] }); inp.dispatchEvent(new A.win.Event('change')); }
  await sleep(500);
  r.A_ve_su_foto = /url\(["']?data:image\/jpeg/.test(A.win.document.getElementById('nexo-profile-av').getAttribute('style') || '');
  { const c = A.win.document.getElementById('nexo-profile-close'); if (c) click(A.win, c); }
  const unread0 = (B.win.bleInterface.unreadSummary() || []).reduce((s, x) => s + x.count, 0);
  r.B_ve_la_foto = await wait(() => rowPhoto(B, 'A'), 60);
  await sleep(2000);
  r.B_sin_mensaje_visible = !(await B.win.vaultLoadMessages(idA)).some((m) => /nexo_act|data:image/.test(m.content || ''));
  r.B_sin_no_leido = (B.win.bleInterface.unreadSummary() || []).reduce((s, x) => s + x.count, 0) === unread0;
  r.B_sin_aviso = !nB.notifLog.some((n) => /data:image|nexo_act/.test(n.text || ''));
  r.A_borra_copia_oculta = await wait(async () => !(await A.win.vaultLoadMessages(idB)).some((m) => /"act":"av"/.test(m.content || '')), 30);
  // 2. B se reinicia
  B.win.close(); nB.destroyActivity(); await sleep(1500); nB.load(); B = await boot('B', nB);
  r.tras_reiniciar = await wait(() => rowPhoto(B, 'A'), 30);
  // 3. C, contacto nuevo
  A.win.bleInterface.togglePanel(); await addFound(A); A.win.bleInterface.togglePanel();
  await openChatWith(A, 'C'); sendText(A, 'hola C'); await sleep(2500); await closeChat(A);
  r.C_la_recibe = await wait(() => rowPhoto(C, 'A'), 60);
  // 4. A la quita
  A.win.dispatchEvent(new A.win.CustomEvent('nexo:ui:profile')); await sleep(400);
  click(A.win, A.win.document.getElementById('nexo-av-clear')); await sleep(300);
  { const c = A.win.document.getElementById('nexo-profile-close'); if (c) click(A.win, c); }
  r.B_deja_de_verla = await wait(() => !rowPhoto(B, 'A'), 60);
  r.errores = logs.filter((l) => / error: /.test(l) && !/JSDOMERROR|styles\.css|Not implemented/.test(l)).slice(0, 5);
  const ok = r.contactos && r.selector && r.A_ve_su_foto && r.B_ve_la_foto && r.B_sin_mensaje_visible && r.B_sin_no_leido && r.B_sin_aviso && r.A_borra_copia_oculta &&
    r.tras_reiniciar && r.C_la_recibe && r.B_deja_de_verla && !r.errores.length;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('AVATAR ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_avatar.txt'), logs.join('\n'));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error(e); fs.writeFileSync(path.join(__dirname, 'last_logs_avatar.txt'), logs.join('\n')); process.exit(1); });
