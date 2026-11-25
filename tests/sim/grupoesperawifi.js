// 3337 (3b en GRUPOS; dueño 24-11): archivo grande a un grupo con un miembro cerca y el Wi-Fi APAGADO (Wi-Fi Direct sin red). Antes la
// tarjeta del que manda quedaba en «No se pudo enviar» (o «hecho») y a ese miembro no le llegaba hasta que lo pedía a mano. Ahora:
//  G1  al que tiene Wi-Fi (B) le llega;  G2  la tarjeta de A dice «Esperando el Wi-Fi del otro» y nunca «No se pudo enviar»;
//  G3  C enciende el Wi-Fi: le llega SOLO (sin tocar nada), idéntico;  G4  la tarjeta de A termina.
// Uso: node grupoesperawifi.js <build> [--mb=8]
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone } = require('./native_mock');

const buildDir = path.resolve(process.argv[2]);
const MB = Number((process.argv.find((a) => a.startsWith('--mb=')) || '--mb=8').split('=')[1]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
class DL extends ResourceLoader { constructor(d) { super(); this.d = d; } fetch(u) { const f = path.join(this.d, decodeURIComponent(new URL(u).pathname)); return fs.existsSync(f) ? Promise.resolve(fs.readFileSync(f)) : Promise.reject(new Error('x')); } }
const logs = [];
async function boot(name, address, radio, wifi) {
  const o = { readsContentFallback: true, mtu: 512, pace: [15, 15], retain: ['onPayloadReceived', 'onLanMessage', 'onLanUp', 'onLanDown', 'onBigDone'], asymmetric: true, noL2: true, wifiDirect: true };
  const native = new NativePhone(name, address, o);
  radio.add(native); native.load();
  const vc = new VirtualConsole(); ['log', 'info', 'warn', 'error'].forEach((l) => vc.on(l, (...a) => logs.push(`${new Date().toISOString().substring(14, 23)} [${name}] ${l}: ` + a.map(String).join(' ').substring(0, 250))));
  const dom = new JSDOM(fs.readFileSync(path.join(buildDir, 'dist', 'index.html'), 'utf8'), { url: 'https://' + name.toLowerCase() + '.nexo.test/index.html', runScripts: 'dangerously', resources: new DL(path.join(buildDir, 'dist')), pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) {
      win.CapacitorCustomPlatform = { name: 'android' }; require('./native_mock').installWebCrypto(win); win.Capacitor = { Plugins: { NexoBLE: native.plugin() } }; win.HTMLElement.prototype.scrollTo = function () {};
      let n = 0; win.URL.createObjectURL = () => 'blob:sim/' + (++n); win.URL.revokeObjectURL = () => {};
      win.NEXO_makeVideoPreview = () => { const b = new win.Blob([new Uint8Array(45 * 1024).fill(7)], { type: 'video/webm' }); b.thumb = 'T'.repeat(6000); return Promise.resolve(b); };
    } });
  const win = dom.window;
  // dueño 24-11: entrar a un grupo es una invitación; en esta prueba el usuario la acepta al momento
  win.addEventListener('nexo:groups:invite', (e) => setTimeout(() => { try { win.bleInterface.groups.acceptInvite(e.detail.id); } catch (x) {} }, 50));
  for (let i = 0; i < 100 && !(win.NEXO && win.NEXO.initialized); i++) await sleep(100); await sleep(800);
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
  const [A, B, C] = await Promise.all([boot('A', 'AA:AA:AA:AA:AA:01', radio), boot('B', 'BB:BB:BB:BB:BB:02', radio), boot('C', 'CC:CC:CC:CC:CC:03', radio)]);
  A.win.NEXO_BIG_WAIT_MS = 2000; // el reintento automático, rápido para la prueba
  const id = (p) => p.win.bleInterface.localNexoId.toLowerCase();
  A.win.bleInterface.togglePanel(); await addFound(A); await addFound(A); A.win.bleInterface.togglePanel();
  await sleep(1500);
  for (const n of ['B', 'C']) { await openChatWith(A, n); await sendText(A, 'hola ' + n); await sleep(2500); await closeChat(A); }
  const r = { prueba: 'grupoesperawifi', build: path.basename(buildDir), mb: MB };
  const gid = A.win.bleInterface.groups.create('Familia', [id(B), id(C)]).id;
  A.win.NEXO_openGroupChat(gid); await sleep(600);
  await sendText(A, 'hola familia');
  r.grupo_en_B = await wait(async () => !!B.win.bleInterface.groups.get(gid), 90);
  r.grupo_en_C = await wait(async () => !!C.win.bleInterface.groups.get(gid), 90);
  await wait(async () => !!A.win.bleInterface.bigFiles.route(id(B)) && !!A.win.bleInterface.bigFiles.route(id(C)), 60);
  for (const p of [B, C]) { p.win.NEXO_openGroupChat(gid); await sleep(500); }
  // C apaga el Wi-Fi; A manda el archivo grande al grupo
  C.native.opts.wifiOff = true;
  const big = rnd(MB * 1024 * 1024, 5), sha = crypto.createHash('sha256').update(big).digest('hex');
  await sendFile(A, 'fotos.zip', 'application/zip', big);
  const subs = new Set();
  const peek = () => { const c = card(A, 'fotos.zip', true); if (c) subs.add(sub(c).replace(/\d+([,.]\d+)? ?(%|MB\/s|MB|KB)/g, 'N')); };
  r.G1_llega_a_B = await wait(async () => { peek(); return /Toca para abrir/.test(sub(card(B, 'fotos.zip', false))); }, 240);
  r.G2_espera = await wait(async () => { peek(); return /Esperando el Wi-Fi del otro/.test(sub(card(A, 'fotos.zip', true))); }, 60);
  for (let i = 0; i < 25; i++) { await sleep(200); peek(); }
  r.G2_nunca_no_se_pudo = !Array.from(subs).some((s) => /No se pudo enviar/.test(s));
  r.tarjetas_A = Array.from(subs);
  // C enciende el Wi-Fi: le llega solo, sin tocar nada
  C.native.opts.wifiOff = false;
  r.G3_llega_a_C_sola = await wait(async () => { peek(); return /Toca para abrir/.test(sub(card(C, 'fotos.zip', false))); }, 180);
  click(C.win, card(C, 'fotos.zip', false)); await sleep(1000);
  const obC = (C.native.opened || []).find((o) => o.big);
  r.G3_identico = !!(obC && obC.sha === sha);
  await sleep(2500); peek();
  r.tarjeta_A_final = sub(card(A, 'fotos.zip', true));
  r.G4_A_termina = !/Esperando|No se pudo/.test(r.tarjeta_A_final);
  r.errores = logs.filter((l) => / error: /.test(l) && !/JSDOMERROR|styles\.css|Not implemented/.test(l)).slice(0, 5);
  const ok = r.grupo_en_B && r.grupo_en_C && r.G1_llega_a_B && r.G2_espera && r.G2_nunca_no_se_pudo && r.G3_llega_a_C_sola && r.G3_identico && r.G4_A_termina && !r.errores.length;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('GRUPOESPERAWIFI ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_grupoesperawifi.txt'), logs.join('\n'));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error(e); fs.writeFileSync(path.join(__dirname, 'last_logs_grupoesperawifi.txt'), logs.join('\n')); process.exit(1); });
