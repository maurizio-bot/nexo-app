// 3095 (dueño 14-11: «cuando se hace la actualización con el desliz de arriba hacia abajo en la pantalla de contactos quiero que
// actualices las fotos de los estados y las fotos de los perfiles… la pantalla completa; y aprovechar el gesto para que los chats
// estén sincronizados con los otros dispositivos»). Antes el gesto solo pedía los estados. A y B emparejados por Bluetooth, B con
// foto de perfil; A no tiene la foto de B (no le llegó o la perdió) y al reconectar B no se la reenvía:
//  R1  A no tiene la foto de B y, tras reabrir y reconectar, sin el gesto no vuelve;
//  R2  A desliza hacia abajo en Contactos: la foto de B vuelve en ≤ 20 s;
//  R3  (guarda) lo pendiente de A —un texto que quedó ⏳ para B sin enlace— llega (el gesto también lo reenvía);
//  R4  y queda en el registro («[ACTUALIZAR] Deslizar: estados y fotos pedidos a N contacto(s)…»).
// Uso: node refresco.js <dir_build>
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone, installWebCrypto } = require('./native_mock');

const buildDir = path.resolve(process.argv[2]);
const opts = { readsContentFallback: true, retain: ['onPayloadReceived'], closeOnNoService: true, pace: [15, 15], ioDelay: 25, asymmetric: true, noTor: true };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const mk = (bits, rgb, salt) => 'data:image/jpeg;base64,' + Buffer.from('PH|' + bits + '|' + rgb.join(',') + '|' + salt + '|' + 'x'.repeat(7000)).toString('base64');
const P = mk('0110'.repeat(16), [120, 100, 90], 'a'), PB = mk('1001'.repeat(16), [30, 160, 200], 'b');
const phashOf = (url) => { const m = /^PH\|([01]{64})\|(\d+),(\d+),(\d+)\|/.exec(Buffer.from(String(url).split(',')[1] || '', 'base64').toString('latin1')); return m ? { b: m[1], c: [+m[2], +m[3], +m[4]] } : null; };
class DL extends ResourceLoader { constructor(d) { super(); this.d = d; } fetch(u) { const f = path.join(this.d, decodeURIComponent(new URL(u).pathname)); return fs.existsSync(f) ? Promise.resolve(fs.readFileSync(f)) : Promise.reject(new Error('x')); } }
const logs = [];
async function boot(name, native) {
  let vis = 'visible';
  const vc = new VirtualConsole();
  ['log', 'warn', 'error'].forEach((l) => vc.on(l, (...a) => logs.push(`${new Date().toISOString().substring(14, 23)} [${name}] ${l}: ` + a.map(String).join(' ').substring(0, 250))));
  const dom = new JSDOM(fs.readFileSync(path.join(buildDir, 'dist', 'index.html'), 'utf8'), {
    url: 'https://' + name.toLowerCase() + '.nexo.test/index.html', runScripts: 'dangerously', resources: new DL(path.join(buildDir, 'dist')), pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) {
      win.NEXO_NET_RELAYS = []; win.CapacitorCustomPlatform = { name: 'android' }; installWebCrypto(win);
      Object.defineProperty(win.document, 'visibilityState', { configurable: true, get: () => vis });
      Object.defineProperty(win.document, 'hidden', { configurable: true, get: () => vis === 'hidden' });
      win.Capacitor = { Plugins: { NexoBLE: native.plugin() } }; win.HTMLElement.prototype.scrollTo = function () {};
      win.NEXO_makeAvatar = () => (name === 'B' ? PB : P); win.NEXO_avatarPHash = (url) => phashOf(url);
    },
  });
  const win = dom.window;
  for (let i = 0; i < 100 && !(win.NEXO && win.NEXO.initialized); i++) await sleep(100);
  await sleep(800);
  const p = { name, native, win };
  p.setActive = (active) => { vis = active ? 'visible' : 'hidden'; win.document.dispatchEvent(new win.Event('visibilitychange')); native.setAppActive(active); };
  return p;
}
const click = (w, el) => el && el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
async function addFound(p, name) {
  let add = null;
  const find = () => { const row = Array.from(p.win.document.querySelectorAll('#ble-new-device > div')).find((d) => (d.querySelector('span') || {}).textContent === name); return row && row.querySelector('button'); };
  for (let i = 0; i < 600 && !add; i++) { await sleep(100); add = find(); if (!add && !p.win.bleInterface.isScanning) click(p.win, p.win.document.getElementById('ble-scan-btn')); }
  click(p.win, add); await sleep(2000);
  return !!add;
}
async function openChatWith(p, name) {
  let row; for (let i = 0; i < 300 && !row; i++) { row = Array.from(p.win.document.querySelectorAll('#main-contacts-list .ble-contact-row')).find((r) => (r.querySelector('.ble-contact-name') || {}).textContent === name); if (!row) await sleep(100); }
  click(p.win, row); await sleep(600); return !!row;
}
async function closeChat(p) { p.win.dispatchEvent(new p.win.CustomEvent('nexo:ble:closeChat', { detail: {} })); await sleep(300); }
function sendText(p, t) { const i = p.win.document.getElementById('message-input'); i.value = t; i.dispatchEvent(new p.win.Event('input', { bubbles: true })); click(p.win, p.win.document.getElementById('send-btn')); }
const wait = async (c, s) => { for (let i = 0; i < s * 5; i++) { if (await c()) return true; await sleep(200); } return false; };
async function profile(p, fn) {
  p.win.dispatchEvent(new p.win.CustomEvent('nexo:ui:profile')); await sleep(400);
  await fn();
  const c = p.win.document.getElementById('nexo-profile-close'); if (c) click(p.win, c);
  await sleep(200);
}
async function pickPhoto(p) {
  await profile(p, async () => {
    click(p.win, p.win.document.getElementById('nexo-av-pick')); await sleep(200);
    const inp = Array.from(p.win.document.querySelectorAll('input[type=file]')).find((i) => i.accept === 'image/*');
    if (inp) { Object.defineProperty(inp, 'files', { configurable: true, value: [new p.win.File([Buffer.alloc(100)], 'yo.jpg', { type: 'image/jpeg' })] }); inp.dispatchEvent(new p.win.Event('change')); }
    await sleep(800);
  });
}

async function pull(p) {
  const cv = p.win.document.getElementById('contacts-view');
  if (!cv) return false;
  const ev = (type, y) => { const e = new p.win.Event(type, { bubbles: true }); Object.defineProperty(e, 'touches', { value: y === null ? [] : [{ clientY: y }] }); cv.dispatchEvent(e); };
  ev('touchstart', 100); ev('touchmove', 140); ev('touchmove', 220); ev('touchend', null);
  return true;
}
const hasPhotoOf = (n, nx) => { const f = n.files && n.files.get('nexo_av_' + nx + '.json'); if (!f) return false; try { return /data:image/.test(String(f)); } catch (e) { return false; } };

(async () => {
  const r = { prueba: 'refresco', build: path.basename(buildDir) };
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', opts), nB = new NativePhone('B', 'BB:BB:BB:BB:BB:02', opts);
  [nA, nB].forEach((n) => { radio.add(n); n.load(); });
  let A = await boot('A', nA); const B = await boot('B', nB);
  const idB = B.win.bleInterface.localNexoId.toLowerCase();
  await pickPhoto(B);
  A.win.bleInterface.togglePanel(); const paired = await addFound(A, 'B'); A.win.bleInterface.togglePanel();
  if (!paired) { console.log('REFRESCO ' + JSON.stringify({ prueba: 'refresco', resultado: 'FALLO', error: 'no empareja' })); process.exit(1); }
  await openChatWith(A, 'B'); sendText(A, 'hola B'); await sleep(2000);
  await openChatWith(B, 'A'); sendText(B, 'hola A'); await sleep(2000); await closeChat(B);
  r.foto_al_emparejar = await wait(() => hasPhotoOf(nA, idB), 15); // informativo: en el simulador B (el que recibe la conexión) no da «listo» y no manda su foto
  // A pierde la foto de B (su archivo) y queda lejos; escribe a B (queda ⏳)
  await closeChat(A);
  A.win.close(); nA.destroyActivity(); await sleep(1500);
  nA.files.delete('nexo_av_' + idB + '.json');
  radio.block(nA, nB);
  nA.load(); A = await boot('A', nA);
  await openChatWith(A, 'B'); sendText(A, 'escrito sin enlace'); await sleep(2500); await closeChat(A);
  // vuelve el alcance: B cree que A ya tiene su foto → no la reenvía
  radio.unblock(nA, nB);
  await sleep(12000);
  r.R1_sin_gesto_sin_foto = !hasPhotoOf(nA, idB);
  const has = (p, from, pred) => p.win.vaultLoadMessages(from).then((l) => l.some(pred));
  const idA = A.win.bleInterface.localNexoId.toLowerCase();
  r.R3_pendiente_antes = await has(B, idA, (m) => m.content === 'escrito sin enlace');
  // A desliza hacia abajo en Contactos
  const t0 = Date.now();
  r.gesto = await pull(A);
  r.R2_foto_vuelve_s = (await wait(() => hasPhotoOf(nA, idB), 20)) ? Math.round((Date.now() - t0) / 100) / 10 : null;
  r.R3_pendiente_llega = await wait(() => has(B, idA, (m) => m.content === 'escrito sin enlace'), 20);
  r.R4_registro = logs.some((l) => /\[A\].*\[ACTUALIZAR\] Deslizar: estados y fotos pedidos a [1-9]/.test(l));
  r.errores = logs.filter((l) => / error: /.test(l) && !/JSDOMERROR|styles\.css|Not implemented|net::ERR|fetch/.test(l)).slice(0, 5);
  const ok = r.R1_sin_gesto_sin_foto && r.gesto && r.R2_foto_vuelve_s !== null && r.R3_pendiente_llega && r.R4_registro && !r.errores.length;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('REFRESCO ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_refresco.txt'), logs.join('\n'));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('REFRESCO ' + JSON.stringify({ prueba: 'refresco', resultado: 'FALLO', error: String(e && e.message) })); console.error(e); fs.writeFileSync(path.join(__dirname, 'last_logs_refresco.txt'), logs.join('\n')); process.exit(1); });
