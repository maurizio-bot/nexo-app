// Grupos: vídeo HD y archivos grandes (ronda 2764, PENDIENTES §2 "Chats de grupo": faltaban). A, B y C; A conoce a los
// dos y crea el grupo "Familia". A y B en el mismo Wi-Fi; C cerca por Bluetooth.
//  1. A manda un vídeo al grupo: la previa llega a los dos y luego el HD la sustituye en el chat del grupo (no en el
//     chat 1:1 con A); la etiqueta de A acaba en "HD ✓".
//  2. A manda un archivo de 24 MB al grupo (antes: "Demasiado grande para un grupo"): sale como archivo grande, llega
//     a B por el Wi-Fi y se abre idéntico; C no está en el Wi-Fi: su tarjeta dice "Toca para pedirlo".
//  3. C entra en el Wi-Fi y toca la tarjeta: se lo pide a A (quien lo mandó, no al grupo) y le llega idéntico.
// La recodificación del vídeo se simula (jsdom no tiene MediaRecorder), como en video.js.
// Uso: node group_media.js <dir_build> [--mb=24]
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone } = require('./native_mock');

const buildDir = path.resolve(process.argv[2]);
const MB = Number((process.argv.find((a) => a.startsWith('--mb=')) || '--mb=24').split('=')[1]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
class DL extends ResourceLoader { constructor(d) { super(); this.d = d; } fetch(u) { const f = path.join(this.d, decodeURIComponent(new URL(u).pathname)); return fs.existsSync(f) ? Promise.resolve(fs.readFileSync(f)) : Promise.reject(new Error('x')); } }
const logs = [];
async function boot(name, address, radio, wifi) {
  const o = { readsContentFallback: true, mtu: 512, pace: [15, 15], retain: ['onPayloadReceived', 'onLanMessage', 'onLanUp', 'onLanDown', 'onBigDone'], asymmetric: true, noL2: true };
  if (wifi) o.wifi = wifi;
  const native = new NativePhone(name, address, o);
  radio.add(native); native.load();
  const vc = new VirtualConsole(); ['log', 'info', 'warn', 'error'].forEach((l) => vc.on(l, (...a) => logs.push(`${new Date().toISOString().substring(14, 23)} [${name}] ${l}: ` + a.map(String).join(' ').substring(0, 250))));
  const dom = new JSDOM(fs.readFileSync(path.join(buildDir, 'dist', 'index.html'), 'utf8'), { url: 'https://' + name.toLowerCase() + '.nexo.test/index.html', runScripts: 'dangerously', resources: new DL(path.join(buildDir, 'dist')), pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) {
      win.CapacitorCustomPlatform = { name: 'android' }; require('./native_mock').installWebCrypto(win); win.Capacitor = { Plugins: { NexoBLE: native.plugin() } }; win.HTMLElement.prototype.scrollTo = function () {};
      let n = 0; win.URL.createObjectURL = () => 'blob:sim/' + (++n); win.URL.revokeObjectURL = () => {};
      win.NEXO_makeVideoPreview = () => { const b = new win.Blob([new Uint8Array(45 * 1024).fill(7)], { type: 'video/webm' }); b.thumb = 'T'.repeat(6000); return Promise.resolve(b); };
    } });
  const win = dom.window; for (let i = 0; i < 100 && !(win.NEXO && win.NEXO.initialized); i++) await sleep(100); await sleep(800);
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
async function sendText(p, t) { const i = p.win.document.getElementById('message-input'); i.value = t; i.dispatchEvent(new p.win.Event('input', { bubbles: true })); click(p.win, p.win.document.getElementById('send-btn')); }
async function sendFile(p, name, type, bytes) {
  click(p.win, p.win.document.querySelector('.attach-menu-item[data-type="file"]')); await sleep(100);
  const fin = Array.from(p.win.document.querySelectorAll('input[type=file]')).pop();
  Object.defineProperty(fin, 'files', { configurable: true, value: [new p.win.File([bytes], name, { type })] }); fin.dispatchEvent(new p.win.Event('change'));
}
const card = (p, label, own) => Array.from(p.win.document.querySelectorAll('#messages-container .message' + (own ? '.own' : ':not(.own)'))).map((m) => m.querySelector('.file-attachment')).find((c) => c && c.textContent.indexOf(label) >= 0);
const sub = (c) => (c && c.querySelector('.file-sub') || {}).textContent || '';
const badge = (p) => { const v = Array.from(p.win.document.querySelectorAll('#messages-container .message .video-attachment')).pop(); const b = v && v.querySelector('.hd-badge'); return b ? b.textContent : null; };
const rnd = (n, s) => { const b = Buffer.alloc(n); for (let i = 0; i < n; i++) b[i] = (i * 7919 + s) & 255; return b; };
const wait = async (c, s) => { for (let i = 0; i < s * 5; i++) { if (await c()) return true; await sleep(200); } return false; };
const toast = (p) => (Array.from(p.win.document.querySelectorAll('div')).find((d) => /grande|Demasiado/i.test(d.textContent) && d.children.length === 0) || {}).textContent || null;

(async () => {
  const radio = new Radio();
  const [A, B, C] = await Promise.all([boot('A', 'AA:AA:AA:AA:AA:01', radio, 'casa'), boot('B', 'BB:BB:BB:BB:BB:02', radio, 'casa'), boot('C', 'CC:CC:CC:CC:CC:03', radio, null)]);
  const id = (p) => p.win.bleInterface.localNexoId.toLowerCase();
  A.win.bleInterface.togglePanel(); await addFound(A); await addFound(A); A.win.bleInterface.togglePanel();
  await sleep(1500);
  for (const n of ['B', 'C']) { await openChatWith(A, n); await sendText(A, 'hola ' + n); await sleep(2500); await closeChat(A); }
  const r = { build: path.basename(buildDir), mb: MB };
  const gid = A.win.bleInterface.groups.create('Familia', [id(B), id(C)]).id;
  A.win.NEXO_openGroupChat(gid); await sleep(600);
  await sendText(A, 'hola familia');
  r.grupo_en_B = await wait(async () => !!B.win.bleInterface.groups.get(gid), 90);
  r.grupo_en_C = await wait(async () => !!C.win.bleInterface.groups.get(gid), 90);
  await wait(async () => !!A.win.bleInterface.bigFiles.route(id(B)), 60);
  r.camino_A_B = A.win.bleInterface.bigFiles.route(id(B)); r.camino_A_C = A.win.bleInterface.bigFiles.route(id(C));
  for (const p of [B, C]) { p.win.NEXO_openGroupChat(gid); await sleep(500); }

  // 1. Vídeo
  const t0 = Date.now(), badgesA = new Set();
  A.win.NEXO_sendVideo(new A.win.Blob([new Uint8Array(300 * 1024).fill(3)], { type: 'video/mp4' }), { name: 'clip.mp4', size: 300 * 1024, mime: 'video/mp4', duration: 5 });
  const vid = async (p) => (await p.win.vaultLoadMessages(gid)).find((m) => m.attachmentType === 'video' && !m._own);
  r.video_previa_B = await wait(async () => !!(await vid(B)), 120);
  r.video_previa_C = await wait(async () => !!(await vid(C)), 120);
  const hdOk = async (p) => { const v = await vid(p); return !!(v && v.attachmentMeta && v.attachmentMeta.hd); };
  r.video_HD_B = await wait(async () => { const b = badge(A); if (b) badgesA.add(b.replace(/\d+/g, 'N')); return hdOk(B); }, 240);
  r.video_HD_C = await wait(async () => { const b = badge(A); if (b) badgesA.add(b.replace(/\d+/g, 'N')); return hdOk(C); }, 240);
  r.video_HD_s = Math.round((Date.now() - t0) / 1000);
  await wait(async () => badge(A) === 'HD ✓', 30);
  r.etiquetas_A = Array.from(badgesA); r.etiqueta_final_A = badge(A);
  r.video_no_en_1a1 = !(await B.win.vaultLoadMessages(id(A))).some((m) => m.attachmentType === 'video') && !(await C.win.vaultLoadMessages(id(A))).some((m) => m.attachmentType === 'video');

  // 2. Archivo grande
  const big = rnd(MB * 1024 * 1024, 5), sha = crypto.createHash('sha256').update(big).digest('hex');
  await sendFile(A, 'fotos.zip', 'application/zip', big);
  await sleep(1500);
  r.aviso_A = toast(A);
  r.tarjeta_A = !!card(A, 'fotos.zip', true);
  r.grande_llega_B = await wait(async () => /Toca para abrir/.test(sub(card(B, 'fotos.zip', false))), 240);
  r.tarjeta_C_sin_wifi = sub(card(C, 'fotos.zip', false));
  click(B.win, card(B, 'fotos.zip', false)); await sleep(1000);
  const obB = (B.native.opened || []).find((o) => o.big);
  r.abre_en_B_identico = !!(obB && obB.sha === sha);
  r.no_entero_en_la_app = (A.native.stats.bigMaxSlice || 0) <= 700 * 1024;

  // 3. C entra en el Wi-Fi y lo pide
  C.native.setWifi('casa'); A.win.bleInterface.lan.start(); C.win.bleInterface.lan.start();
  r.camino_A_C_despues = await wait(async () => !!C.win.bleInterface.bigFiles.route(id(A)), 90);
  await sleep(1500);
  click(C.win, card(C, 'fotos.zip', false));
  r.grande_llega_C = await wait(async () => /Toca para abrir/.test(sub(card(C, 'fotos.zip', false))), 240);
  click(C.win, card(C, 'fotos.zip', false)); await sleep(1000);
  const obC = (C.native.opened || []).find((o) => o.big);
  r.abre_en_C_identico = !!(obC && obC.sha === sha);
  r.tarjeta_A_final = sub(card(A, 'fotos.zip', true));
  r.errores = logs.filter((l) => / error: /.test(l) && !/JSDOMERROR|styles\.css|Not implemented/.test(l)).slice(0, 5);
  const ok = r.grupo_en_B && r.grupo_en_C && r.video_previa_B && r.video_previa_C && r.video_HD_B && r.video_HD_C && r.etiqueta_final_A === 'HD ✓' && r.video_no_en_1a1 &&
    r.tarjeta_A && r.grande_llega_B && r.abre_en_B_identico && r.no_entero_en_la_app && /Toca para pedirlo/.test(r.tarjeta_C_sin_wifi) && r.grande_llega_C && r.abre_en_C_identico && !r.errores.length;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('GROUP_MEDIA ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_group_media.txt'), logs.join('\n'));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error(e); fs.writeFileSync(path.join(__dirname, 'last_logs_group_media.txt'), logs.join('\n')); process.exit(1); });
