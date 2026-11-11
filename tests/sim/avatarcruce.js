// Foto de perfil cruzada (dueño 11-11): Marcos (recién actualizado) agregó a Austin y le salió con la foto del DUEÑO; también en
// la pantalla de perfil. A = el dueño (con foto), contacto de B (Marcos) y de C (Austin); B y C no se conocen. B agrega a C desde
// «Agregar»: C (sin foto) NO debe salir con la de A en ningún lado; el perfil propio de B y de C tampoco; cuando C pone la suya,
// B ve la de C. Uso: node avatarcruce.js <dir_build>
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone } = require('./native_mock');

const buildDir = path.resolve(process.argv[2]);
const opts = { readsContentFallback: true, retain: ['onPayloadReceived'], closeOnNoService: true, pace: [15, 15], ioDelay: 25, asymmetric: true };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PHOTO = 'data:image/jpeg;base64,' + Buffer.alloc(9000, 7).toString('base64');
const PHOTO_C = 'data:image/jpeg;base64,' + Buffer.alloc(7000, 9).toString('base64');
class DL extends ResourceLoader { constructor(d) { super(); this.d = d; } fetch(u) { const f = path.join(this.d, decodeURIComponent(new URL(u).pathname)); return fs.existsSync(f) ? Promise.resolve(fs.readFileSync(f)) : Promise.reject(new Error('x')); } }
const logs = [];
async function boot(name, native) {
  const vc = new VirtualConsole();
  ['log', 'warn', 'error'].forEach((l) => vc.on(l, (...a) => logs.push(`${new Date().toISOString().substring(14, 23)} [${name}] ${l}: ` + a.map(String).join(' ').substring(0, 250))));
  const dom = new JSDOM(fs.readFileSync(path.join(buildDir, 'dist', 'index.html'), 'utf8'), {
    url: 'https://' + name.toLowerCase() + '.nexo.test/index.html', runScripts: 'dangerously', resources: new DL(path.join(buildDir, 'dist')), pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) { win.CapacitorCustomPlatform = { name: 'android' }; require('./native_mock').installWebCrypto(win); win.Capacitor = { Plugins: { NexoBLE: native.plugin() } }; win.HTMLElement.prototype.scrollTo = function () {}; win.NEXO_makeAvatar = () => (name === 'C' ? PHOTO_C : PHOTO); },
  });
  const win = dom.window;
  for (let i = 0; i < 100 && !(win.NEXO && win.NEXO.initialized); i++) await sleep(100);
  await sleep(800);
  return { name, native, win };
}
const click = (w, el) => el && el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
async function addFound(p, name) {
  let add = null; const t0 = Date.now();
  const find = () => { const row = Array.from(p.win.document.querySelectorAll('#ble-new-device > div')).find((d) => (d.querySelector('span') || {}).textContent === name); return row && row.querySelector('button'); };
  for (let i = 0; i < 600 && !add; i++) { await sleep(100); add = find(); if (!add && !p.win.bleInterface.isScanning) click(p.win, p.win.document.getElementById('ble-scan-btn')); }
  const s = Math.round((Date.now() - t0) / 100) / 10;
  click(p.win, add); await sleep(2000);
  return add ? s : null;
}
async function openChatWith(p, name) {
  let row; for (let i = 0; i < 300 && !row; i++) { row = Array.from(p.win.document.querySelectorAll('#main-contacts-list .ble-contact-row')).find((r) => (r.querySelector('.ble-contact-name') || {}).textContent === name); if (!row) await sleep(100); }
  click(p.win, row); await sleep(600); return !!row;
}
async function closeChat(p) { p.win.dispatchEvent(new p.win.CustomEvent('nexo:ble:closeChat', { detail: {} })); await sleep(300); }
function sendText(p, t) { const i = p.win.document.getElementById('message-input'); i.value = t; i.dispatchEvent(new p.win.Event('input', { bubbles: true })); click(p.win, p.win.document.getElementById('send-btn')); }
const wait = async (c, s) => { for (let i = 0; i < s * 5; i++) { if (await c()) return true; await sleep(200); } return false; };
const rowPhoto = (p, name) => { const row = Array.from(p.win.document.querySelectorAll('#main-contacts-list .ble-contact-row')).find((r) => (r.querySelector('.ble-contact-name') || {}).textContent === name); const av = row && row.querySelector('.ble-contact-avatar'); return !!(av && /url\(["']?data:image\/jpeg/.test(av.getAttribute('style') || '')); };


const rowStyle = (p, name) => { const row = Array.from(p.win.document.querySelectorAll('#main-contacts-list .ble-contact-row')).find((r) => (r.querySelector('.ble-contact-name') || {}).textContent === name); const av = row && row.querySelector('.ble-contact-avatar'); return row ? ((av && av.getAttribute('style')) || '') : null; };
const whose = (st) => st === null ? 'sin fila' : (st.indexOf(PHOTO) >= 0 ? 'A' : (st.indexOf(PHOTO_C) >= 0 ? 'C' : (/data:image/.test(st) ? 'otra' : 'ninguna')));
async function pickPhoto(p) {
  p.win.dispatchEvent(new p.win.CustomEvent('nexo:ui:profile')); await sleep(400);
  click(p.win, p.win.document.getElementById('nexo-av-pick')); await sleep(200);
  const inp = Array.from(p.win.document.querySelectorAll('input[type=file]')).find((i) => i.accept === 'image/*');
  if (inp) { Object.defineProperty(inp, 'files', { configurable: true, value: [new p.win.File([Buffer.alloc(100)], 'yo.jpg', { type: 'image/jpeg' })] }); inp.dispatchEvent(new p.win.Event('change')); }
  await sleep(500);
  const c = p.win.document.getElementById('nexo-profile-close'); if (c) click(p.win, c);
  await sleep(200);
}
async function myProfilePhoto(p) {
  p.win.dispatchEvent(new p.win.CustomEvent('nexo:ui:profile')); await sleep(400);
  const el = p.win.document.getElementById('nexo-profile-av'); const st = (el && el.getAttribute('style')) || '';
  const c = p.win.document.getElementById('nexo-profile-close'); if (c) click(p.win, c);
  await sleep(200);
  return whose(st);
}
const avFile = async (p, nx) => { try { const r0 = await p.win.Capacitor.Plugins.NexoBLE.loadFromFile({ filename: 'nexo_av_' + nx + '.json' }); if (!r0 || !r0.exists || !r0.content) return 'ninguna'; const o = JSON.parse(r0.content); return !o.img ? 'ninguna' : (o.img === PHOTO ? 'A' : (o.img === PHOTO_C ? 'C' : 'otra')); } catch (e) { return 'error'; } };

(async () => {
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', opts), nB = new NativePhone('B', 'BB:BB:BB:BB:BB:02', opts), nC = new NativePhone('C', 'CC:CC:CC:CC:CC:03', opts);
  [nA, nB, nC].forEach((n) => { radio.add(n); n.load(); });
  const [A, B, C] = await Promise.all([boot('A', nA), boot('B', nB), boot('C', nC)]);
  const idA = A.win.bleInterface.localNexoId.toLowerCase(), idB = B.win.bleInterface.localNexoId.toLowerCase(), idC = C.win.bleInterface.localNexoId.toLowerCase();
  const r = { prueba: 'avatarcruce', build: path.basename(buildDir) };
  // A (el dueño, con foto) tiene de contactos a B (Marcos) y a C (Austin); B y C no se conocen
  await pickPhoto(A);
  A.win.bleInterface.togglePanel(); r.A_agrega_B_s = await addFound(A, 'B'); r.A_agrega_C_s = await addFound(A, 'C'); A.win.bleInterface.togglePanel();
  await openChatWith(A, 'B'); sendText(A, 'hola B'); await sleep(2000); await closeChat(A);
  await openChatWith(A, 'C'); sendText(A, 'hola C'); await sleep(2000); await closeChat(A);
  r.B_ve_foto_de_A = await wait(() => whose(rowStyle(B, 'A')) === 'A', 60);
  r.C_ve_foto_de_A = await wait(() => whose(rowStyle(C, 'A')) === 'A', 60);
  // B agrega a C desde «Agregar» (C NO tiene foto)
  B.win.bleInterface.togglePanel(); r.B_agrega_C_s = await addFound(B, 'C'); B.win.bleInterface.togglePanel();
  await openChatWith(B, 'C'); sendText(B, 'hola C, soy B'); await sleep(3000); await closeChat(B);
  await sleep(8000);
  B.win.bleInterface.renderContactsList(); C.win.bleInterface.renderContactsList(); await sleep(300);
  r.B_fila_C_foto = whose(rowStyle(B, 'C'));
  r.B_archivo_foto_C = await avFile(B, idC);
  r.C_fila_B_foto = whose(rowStyle(C, 'B'));
  r.C_archivo_foto_B = await avFile(C, idB);
  r.B_mi_perfil = await myProfilePhoto(B);
  r.C_mi_perfil = await myProfilePhoto(C);
  r.B_fila_A_foto = whose(rowStyle(B, 'A'));
  // C pone SU foto: B debe ver la de C (no la de A)
  await pickPhoto(C);
  r.B_ve_foto_de_C = await wait(() => whose(rowStyle(B, 'C')) === 'C', 60);
  r.B_fila_C_foto_final = whose(rowStyle(B, 'C'));
  r.A_fila_C_foto_final = whose(rowStyle(A, 'C'));
  r.B_fila_A_foto_final = whose(rowStyle(B, 'A'));
  r.avatar_logs = logs.filter((l) => /\[AVATAR\]/.test(l)).map((l) => l.substring(10)).slice(0, 20);
  r.errores = logs.filter((l) => / error: /.test(l) && !/JSDOMERROR|styles\.css|Not implemented/.test(l)).slice(0, 5);
  const ok = r.B_ve_foto_de_A && r.C_ve_foto_de_A && r.B_agrega_C_s !== null && r.B_fila_C_foto === 'ninguna' && r.B_archivo_foto_C === 'ninguna' && r.C_fila_B_foto === 'ninguna' && r.C_archivo_foto_B === 'ninguna' &&
    r.B_mi_perfil === 'ninguna' && r.C_mi_perfil === 'ninguna' && r.B_fila_A_foto === 'A' && r.B_ve_foto_de_C && r.A_fila_C_foto_final === 'C' && r.B_fila_A_foto_final === 'A' && !r.errores.length;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('AVATARCRUCE ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_avatarcruce.txt'), logs.join('\n'));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('AVATARCRUCE ' + JSON.stringify({ resultado: 'FALLO', error: String(e && e.message) })); console.error(e); fs.writeFileSync(path.join(__dirname, 'last_logs_avatarcruce.txt'), logs.join('\n')); process.exit(1); });
