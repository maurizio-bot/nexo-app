// 3094 (cola del dueño 14-11: «sin la foto del contacto en sus notificaciones»): la foto que la app MUESTRA de cada contacto pasa
// al nativo para sus avisos, SOLO EN MEMORIA (Kotlin NotifAvatars; nunca se escribe en el teléfono: no toca el cifrado en reposo).
// A (con foto) y B, emparejados por Bluetooth:
//  F1  la foto de A le llega a B y la app de B se la pasa al nativo (setNotifAvatar) para los avisos de A;
//  F2  B en segundo plano (pantalla apagada): A le escribe → el aviso de A en B lleva su foto;
//  F3  B con la app CERRADA (el proceso sigue vivo): A le escribe → el aviso del nativo también lleva la foto;
//  F4  A quita su foto: al volver B, el nativo la olvida y el siguiente aviso sale sin foto.
// El simulador no tiene canvas: la huella de la imagen la da window.NEXO_avatarPHash (como en avatardup.js).
// Uso: node fotoaviso.js <dir_build>
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone, installWebCrypto } = require('./native_mock');

const buildDir = path.resolve(process.argv[2]);
const opts = { readsContentFallback: true, retain: ['onPayloadReceived'], closeOnNoService: true, pace: [15, 15], ioDelay: 25, asymmetric: true, noTor: true };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const mk = (bits, rgb, salt) => 'data:image/jpeg;base64,' + Buffer.from('PH|' + bits + '|' + rgb.join(',') + '|' + salt + '|' + 'x'.repeat(7000)).toString('base64');
const P = mk('0110'.repeat(16), [120, 100, 90], 'a');
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
      win.NEXO_makeAvatar = () => P; win.NEXO_avatarPHash = (url) => phashOf(url);
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
const lastNotif = (n, chat, pred) => (n.notifLog || []).filter((x) => x.chatId === chat && !x.update && (!pred || pred(x))).slice(-1)[0] || null;

(async () => {
  const r = { prueba: 'fotoaviso', build: path.basename(buildDir) };
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', opts), nB = new NativePhone('B', 'BB:BB:BB:BB:BB:02', opts);
  [nA, nB].forEach((n) => { radio.add(n); n.load(); });
  const A = await boot('A', nA); let B = await boot('B', nB);
  const idA = A.win.bleInterface.localNexoId.toLowerCase();
  await pickPhoto(A);
  A.win.bleInterface.togglePanel(); const paired = await addFound(A, 'B'); A.win.bleInterface.togglePanel();
  if (!paired) { console.log('FOTOAVISO ' + JSON.stringify({ prueba: 'fotoaviso', resultado: 'FALLO', error: 'no empareja' })); process.exit(1); }
  await openChatWith(A, 'B'); sendText(A, 'hola B'); await sleep(2000);
  // F1: la foto de A llega a B (tras peerReady + 4 s) y la app de B la pasa al nativo
  r.F1_foto_al_nativo = await wait(() => !!(nB.notifAvatars && nB.notifAvatars.get(idA) === P), 40);
  // F2: B en segundo plano; A le escribe
  await closeChat(B);
  B.setActive(false); await sleep(1000);
  sendText(A, 'con B en segundo plano');
  await wait(() => !!lastNotif(nB, idA, (x) => true), 20);
  const n2 = lastNotif(nB, idA);
  r.F2_aviso = !!n2; r.F2_con_foto = !!(n2 && n2.photo);
  // F3: B con la app cerrada (el proceso vivo); A le escribe
  const before3 = (nB.notifLog || []).length;
  B.win.close(); nB.destroyActivity(); await sleep(1500);
  sendText(A, 'con B cerrada');
  await wait(() => (nB.notifLog || []).slice(before3).some((x) => x.chatId === idA && !x.update), 30);
  const n3 = (nB.notifLog || []).slice(before3).filter((x) => x.chatId === idA && !x.update).slice(-1)[0];
  r.F3_aviso = !!n3; r.F3_con_foto = !!(n3 && n3.photo);
  // F4: B vuelve; A quita su foto; al llegar el «quitada», el nativo de B la olvida
  nB.load(); B = await boot('B', nB);
  await sleep(3000);
  await profile(A, async () => { click(A.win, A.win.document.getElementById('nexo-av-clear')); await sleep(500); });
  r.F4_foto_olvidada = await wait(() => !(nB.notifAvatars && nB.notifAvatars.get(idA)), 40);
  B.setActive(false); await sleep(1000);
  const before4 = (nB.notifLog || []).length;
  sendText(A, 'ya sin foto');
  await wait(() => (nB.notifLog || []).slice(before4).some((x) => x.chatId === idA && !x.update), 20);
  const n4 = (nB.notifLog || []).slice(before4).filter((x) => x.chatId === idA && !x.update).slice(-1)[0];
  r.F4_aviso_sin_foto = !!n4 && !n4.photo;
  r.errores = logs.filter((l) => / error: /.test(l) && !/JSDOMERROR|styles\.css|Not implemented|net::ERR|fetch/.test(l)).slice(0, 5);
  const ok = r.F1_foto_al_nativo && r.F2_aviso && r.F2_con_foto && r.F3_aviso && r.F3_con_foto && r.F4_foto_olvidada && r.F4_aviso_sin_foto && !r.errores.length;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('FOTOAVISO ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_fotoaviso.txt'), logs.join('\n'));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('FOTOAVISO ' + JSON.stringify({ prueba: 'fotoaviso', resultado: 'FALLO', error: String(e && e.message) })); console.error(e); fs.writeFileSync(path.join(__dirname, 'last_logs_fotoaviso.txt'), logs.join('\n')); process.exit(1); });
