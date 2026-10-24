// Pasar la cuenta a un teléfono nuevo (ronda 2759, plan del dueño punto 15, opción A). A y B contactos con historial
// (textos y una foto) y un grupo; N es un teléfono nuevo. A y N en el mismo Wi-Fi.
//  1. N: "Traer mi cuenta" → código; A lo lee → la cuenta pasa; los dos se reinician.
//  2. N es A: mismo NEXO ID e identidad, contactos, historial (con la foto) y el grupo.
//  3. N escribe a B: B lo recibe como de A, sin aviso de clave cambiada ni fallos al descifrar; B contesta y llega a N.
//  4. A queda vacío: otro NEXO ID, sin contactos ni chats.
//  5. Un código falso o de otra red: no pasa nada y A conserva su cuenta.
// Uso: node move.js <dir_build> [--io-delay=25]
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone } = require('./native_mock');

const buildDir = path.resolve(process.argv[2]);
const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith('--' + k)); if (!a) return d; const v = a.split('=')[1]; return v === undefined ? true : Number(v); };
const opts = { readsContentFallback: true, retain: ['onPayloadReceived', 'onMoveDone'], closeOnNoService: true, pace: [15, 15], ioDelay: arg('io-delay', 0), asymmetric: true, supervisionMs: 3000 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
class DistLoader extends ResourceLoader {
  constructor(dir) { super(); this.dir = dir; }
  fetch(url) { const f = path.join(this.dir, decodeURIComponent(new URL(url).pathname)); return fs.existsSync(f) ? Promise.resolve(fs.readFileSync(f)) : Promise.reject(new Error('no existe ' + f)); }
}
const logs = [];
async function boot(name, native) {
  native.listeners = new Map();
  const vc = new VirtualConsole();
  ['log', 'warn', 'error'].forEach((l) => vc.on(l, (...a) => logs.push(`${new Date().toISOString().substring(14, 23)} [${name}] ${l}: ` + a.map(String).join(' ').substring(0, 250))));
  const dom = new JSDOM(fs.readFileSync(path.join(buildDir, 'dist', 'index.html'), 'utf8'), {
    url: 'https://' + name.toLowerCase() + '.nexo.test/index.html', runScripts: 'dangerously',
    resources: new DistLoader(path.join(buildDir, 'dist')), pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) { win.CapacitorCustomPlatform = { name: 'android' }; require('./native_mock').installWebCrypto(win); win.Capacitor = { Plugins: { NexoBLE: native.plugin() } }; win.HTMLElement.prototype.scrollTo = function () {}; win.confirm = () => true; },
  });
  const win = dom.window;
  for (let i = 0; i < 100 && !(win.NEXO && win.NEXO.initialized); i++) await sleep(100);
  await sleep(800);
  return { name, native, win };
}
// Reinicio de la app (Kotlin: activity.recreate tras pasar/recibir la cuenta)
async function restart(p) { p.win.close(); p.native.moveFrozen = false; p.native.restartWanted = false; p.native.destroyActivity(); await sleep(1500); p.native.load(); return boot(p.name, p.native); }
const click = (win, el) => el && el.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
const rows = (p) => Array.from(p.win.document.querySelectorAll('#main-contacts-list .ble-contact-row')).map((r) => (r.querySelector('.ble-contact-name') || {}).textContent);
async function openChatWith(p, name) { let row; for (let i = 0; i < 100 && !row; i++) { row = Array.from(p.win.document.querySelectorAll('#main-contacts-list .ble-contact-row')).find((r) => (r.querySelector('.ble-contact-name') || {}).textContent === name); if (!row) await sleep(100); } click(p.win, row); await sleep(600); return !!row; }
async function closeChat(p) { p.win.dispatchEvent(new p.win.CustomEvent('nexo:ble:closeChat', { detail: {} })); await sleep(300); }
async function sendText(p, t) { const i = p.win.document.getElementById('message-input'); i.value = t; i.dispatchEvent(new p.win.Event('input', { bubbles: true })); click(p.win, p.win.document.getElementById('send-btn')); }
async function sendFile(p, name, type, bytes) {
  click(p.win, p.win.document.querySelector('.attach-menu-item[data-type="file"]')); await sleep(150);
  const fin = Array.from(p.win.document.querySelectorAll('input[type=file]')).pop();
  Object.defineProperty(fin, 'files', { value: [new p.win.File([bytes], name, { type })] }); fin.dispatchEvent(new p.win.Event('change'));
}
const wait = async (c, s) => { for (let i = 0; i < s * 5; i++) { if (await c()) return true; await sleep(200); } return false; };
const json = (n, f) => { try { return JSON.parse(n.files.get(f)); } catch (e) { return null; } };

(async () => {
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', Object.assign({}, opts, { wifi: 'casa' })), nB = new NativePhone('B', 'BB:BB:BB:BB:BB:02', opts);
  const nN = new NativePhone('N', 'EE:0E:0E:0E:0E:09', Object.assign({}, opts, { wifi: 'casa' }));
  [nA, nB].forEach((n) => { radio.add(n); n.load(); });
  let [A, B] = await Promise.all([boot('A', nA), boot('B', nB)]);
  A.win.bleInterface.togglePanel(); let add = null;
  for (let i = 0; i < 400 && !add; i++) { await sleep(100); add = A.win.document.querySelector('#ble-new-device > div button'); if (!add && !A.win.bleInterface.isScanning) click(A.win, A.win.document.getElementById('ble-scan-btn')); }
  click(A.win, add); await sleep(1500);
  if (A.win.document.getElementById('ble-panel').classList.contains('active')) A.win.bleInterface.togglePanel();
  const idA = A.win.bleInterface.localNexoId.toLowerCase(), idB = B.win.bleInterface.localNexoId.toLowerCase();
  const pubA = (json(nA, 'nexo_e2e_identity.json') || {}).pub;
  // Historial: textos en los dos sentidos, una foto y un grupo
  await openChatWith(A, 'B'); await sendText(A, 'antes-1 de A'); await sleep(2500);
  await openChatWith(B, 'A'); await sendText(B, 'antes-2 de B'); await sleep(2500);
  const foto = Buffer.alloc(30 * 1024); for (let i = 0; i < foto.length; i++) foto[i] = (i * 13 + 5) & 255;
  await sendFile(A, 'antes.jpg', 'image/jpeg', foto); await sleep(6000);
  await closeChat(A);
  const g = A.win.bleInterface.groups.create('Familia', [idB]); A.win.NEXO_sendGroupText(g.id, 'hola familia', 'hola familia'); await sleep(3000);
  const r = { build: path.basename(buildDir) };
  // 5 (primero): un código falso no hace nada
  await A.win.NEXO_moveSendTo('NEXO-MOVE1|192.168.1.99|1234|movexx|' + 'a'.repeat(32) + '|' + 'b'.repeat(64)); await sleep(1500);
  r.codigo_falso_no_borra = (json(nA, 'nexo_e2e_identity.json') || {}).pub === pubA && !nA.moveFrozen;
  // 1. N (nuevo) trae la cuenta de A
  radio.add(nN); nN.load();
  let N = await boot('N', nN);
  r.N_antes = N.win.bleInterface.localNexoId;
  const qr = await N.win.NEXO_moveReceive();
  r.codigo = !!qr && /^NEXO-MOVE1\|192\.168\.1\.\d+\|\d+\|move/.test(qr);
  r.qr_visible = !!N.win.document.querySelector('#nexo-move-screen .move-qr svg');
  await A.win.NEXO_moveSendTo(qr);
  r.A_dice_hecho = await wait(() => /ya está en el teléfono nuevo/.test((A.win.document.querySelector('#nexo-move-screen .move-status') || {}).textContent || ''), 30);
  r.N_dice_hecho = await wait(() => /Cuenta recibida/.test((N.win.document.querySelector('#nexo-move-screen .move-status') || {}).textContent || ''), 30);
  r.archivos = nA.stats.moveFiles; r.KB = Math.round((nA.stats.moveBytes || 0) / 1024);
  r.piden_reinicio = !!(nA.restartWanted && nN.restartWanted);
  [A, N] = await Promise.all([restart(A), restart(N)]);
  await sleep(2000);
  // 2. N es A
  r.N_es_A = N.win.bleInterface.localNexoId.toLowerCase() === idA;
  r.misma_identidad = (json(nN, 'nexo_e2e_identity.json') || {}).pub === pubA;
  r.contactos_N = rows(N);
  const hist = await N.win.vaultLoadMessages(idB);
  r.historial_N = hist.filter((m) => /antes-/.test(m.content || '')).length;
  r.foto_N = hist.some((m) => m.attachmentMeta && m.attachmentMeta.name === 'antes.jpg');
  r.grupo_N = !!N.win.bleInterface.groups.get(g.id);
  // 4. A vacío
  r.A_nuevo_id = A.win.bleInterface.localNexoId.toLowerCase() !== idA;
  r.A_sin_contactos = A.win.vaultLoadContacts().length === 0 && rows(A).length === 0;
  r.A_sin_chats = (await A.win.vaultLoadMessages(idB)).length === 0;
  // 3. N escribe a B (A ya no es nadie: fuera de alcance para no confundir)
  radio.block(nA, nB); radio.block(nA, nN);
  await openChatWith(N, 'B'); await sendText(N, 'despues desde el telefono nuevo');
  r.B_recibe_de_A = await wait(async () => (await B.win.vaultLoadMessages(idA)).some((m) => m.content === 'despues desde el telefono nuevo'), 90);
  await openChatWith(B, 'A'); await sendText(B, 'respuesta de B');
  r.N_recibe = await wait(async () => (await N.win.vaultLoadMessages(idB)).some((m) => m.content === 'respuesta de B'), 90);
  r.aviso_clave_en_B = !!B.win.vaultLoadContacts().find((c) => (c.nexoId || '').toLowerCase() === idA && c.pendingKey);
  r.fallos_descifrado = logs.filter((l) => /No se pudo descifrar/.test(l)).length;
  r.errores = logs.filter((l) => / error: /.test(l) && !/JSDOMERROR|styles\.css/.test(l)).slice(0, 5);
  const ok = r.codigo_falso_no_borra && r.codigo && r.qr_visible && r.A_dice_hecho && r.N_dice_hecho && r.piden_reinicio && r.N_es_A && r.misma_identidad &&
    r.contactos_N.indexOf('B') >= 0 && r.historial_N >= 2 && r.foto_N && r.grupo_N && r.A_nuevo_id && r.A_sin_contactos && r.A_sin_chats &&
    r.B_recibe_de_A && r.N_recibe && !r.aviso_clave_en_B && r.fallos_descifrado === 0 && !r.errores.length;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('MOVE ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_move.txt'), logs.join('\n'));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error(e); fs.writeFileSync(path.join(__dirname, 'last_logs_move.txt'), logs.join('\n')); process.exit(1); });
