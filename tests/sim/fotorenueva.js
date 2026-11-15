// 3129 (dueño 15-11, vivo y S24: «eliminé mi contacto del vivo y lo volví a agregar buscándolo con el proceso normal… mi foto de perfil
// real no es la que él ve… cuando se agregue un contacto nuevo o se elimine y se vuelva a agregar, la información se tiene que renovar…
// no puede tener información vieja»). A y B por Bluetooth, contactos; B tiene una foto VIEJA de A (no la de ahora):
//  F1  B borra a A → B olvida su foto (antes seguía en memoria y en el disco);
//  F2  B lo vuelve a agregar buscándolo → ve la foto de AHORA de A (antes la vieja: A creía que ya se la había mandado);
//  F3  sin borrar: B con la vieja y la app reiniciada → al conectar pregunta si está al día y A se la reenvía;
//  F4  si ya está al día, la pregunta no hace que A la reenvíe.
// Contraprueba: en la 3128 F1, F2 y F3 fallan.
// Uso: node fotorenueva.js <dir_build>
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
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', opts), nB = new NativePhone('B', 'BB:BB:BB:BB:BB:02', opts);
  [nA, nB].forEach((n) => { radio.add(n); n.load(); });
  let [A, B] = await Promise.all([boot('A', nA), boot('B', nB)]);
  const idA = A.win.bleInterface.localNexoId.toLowerCase(), idB = B.win.bleInterface.localNexoId.toLowerCase();
  const r = { prueba: 'fotorenueva', build: path.basename(buildDir) };
  A.win.bleInterface.togglePanel(); await addFound(A); A.win.bleInterface.togglePanel();
  await openChatWith(A, 'B'); sendText(A, 'hola'); await sleep(2500); await closeChat(A);
  r.contactos = await wait(async () => (await B.win.vaultLoadMessages(idA)).some((m) => m.content === 'hola'), 30);
  // A pone su foto (la de ahora); B la ve
  A.win.dispatchEvent(new A.win.CustomEvent('nexo:ui:profile')); await sleep(400);
  click(A.win, A.win.document.getElementById('nexo-av-pick')); await sleep(200);
  const inp = Array.from(A.win.document.querySelectorAll('input[type=file]')).find((i) => i.accept === 'image/*');
  if (inp) { Object.defineProperty(inp, 'files', { configurable: true, value: [new A.win.File([Buffer.alloc(100)], 'yo.jpg', { type: 'image/jpeg' })] }); inp.dispatchEvent(new A.win.Event('change')); }
  await sleep(500);
  { const c = A.win.document.getElementById('nexo-profile-close'); if (c) click(A.win, c); }
  r.B_ve_la_de_ahora = await wait(() => B.win.NEXO_avatarOf(idA) === PHOTO, 60);
  // El vivo del dueño tenía una foto VIEJA del S24 (no la de ahora): se le pone a B una foto vieja de A
  const OLD = 'data:image/jpeg;base64,' + Buffer.alloc(9000, 9).toString('base64');
  B.win.NEXO_applyAvatar(idA, { type: 'nexo_act', act: 'av', h: 'fotovieja01', img: OLD });
  r.B_con_la_vieja = await wait(() => B.win.NEXO_avatarOf(idA) === OLD, 15);
  // F1: B BORRA a A → olvida su foto (antes seguía en memoria y en el disco)
  B.win.bleInterface.removeContact(idA); await sleep(800);
  r.F1_olvida_al_borrar = !B.win.NEXO_avatarOf(idA);
  // F2: B lo vuelve a agregar buscándolo → le pide su foto: ve la de AHORA (antes: la vieja; A creía que ya se la había mandado)
  B.win.bleInterface.togglePanel(); await addFound(B); B.win.bleInterface.togglePanel();
  r.F2_readd = await wait(() => B.win.bleInterface.getBLEContacts().some((c) => (c.nexoId || '').toLowerCase() === idA), 20);
  r.F2_ve_la_de_ahora = await wait(() => B.win.NEXO_avatarOf(idA) === PHOTO, 60);
  // F3: SIN borrar: B vuelve a tener la vieja y la app se reinicia; al conectar pregunta si está al día y A se la reenvía
  B.win.NEXO_applyAvatar(idA, { type: 'nexo_act', act: 'av', h: 'fotovieja02', img: OLD });
  r.F3_con_la_vieja = await wait(() => B.win.NEXO_avatarOf(idA) === OLD, 15);
  await sleep(2500); // que se guarde en el disco
  B.win.close(); nB.destroyActivity(); await sleep(1500); nB.load(); B = await boot('B', nB);
  r.F3_tras_reiniciar_la_vieja = B.win.NEXO_avatarOf(idA) === OLD || !B.win.NEXO_avatarOf(idA);
  r.F3_al_conectar_la_de_ahora = await wait(() => B.win.NEXO_avatarOf(idA) === PHOTO, 90);
  // F4: si ya la tiene al día, la pregunta no hace que A la mande otra vez
  const sentBefore = logs.filter((l) => /\[A\].*\[AVATAR\] Foto de perfil mandada a/.test(l)).length;
  B.win.close(); nB.destroyActivity(); await sleep(1500); nB.load(); B = await boot('B', nB);
  await wait(() => B.win.NEXO_avatarOf(idA) === PHOTO, 30); await sleep(12000);
  r.F4_al_dia_no_reenvia = logs.filter((l) => /\[A\].*\[AVATAR\] Foto de perfil mandada a/.test(l)).length === sentBefore && B.win.NEXO_avatarOf(idA) === PHOTO;
  r.errores = logs.filter((l) => / error: /.test(l) && !/JSDOMERROR|styles\.css|Not implemented/.test(l)).slice(0, 5);
  const ok = r.contactos && r.B_ve_la_de_ahora && r.B_con_la_vieja && r.F1_olvida_al_borrar && r.F2_readd && r.F2_ve_la_de_ahora && r.F3_al_conectar_la_de_ahora && r.F4_al_dia_no_reenvia && !r.errores.length;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('FOTORENUEVA ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_fotorenueva.txt'), logs.join('\n'));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('FOTORENUEVA ' + JSON.stringify({ prueba: 'fotorenueva', resultado: 'FALLO', error: String(e && e.message) })); fs.writeFileSync(path.join(__dirname, 'last_logs_fotorenueva.txt'), logs.join('\n')); process.exit(1); });
