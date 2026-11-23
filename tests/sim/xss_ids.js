// Auditoría 23-11 (I-X1, I-X2): (1) el NOMBRE de un contacto con HTML no se pinta como HTML en la hoja «Fondo de este chat»;
// (2) un mensaje (nota de voz) cuyo id trae HTML no inyecta nada en la burbuja (el id lo elige quien manda): se descarta.
// Un mensaje normal después sigue llegando.
// Uso: node xss_ids.js <dir_build>
'use strict';
const SIM = __dirname;
const fs = require('fs'), path = require('path');
const { JSDOM, VirtualConsole, ResourceLoader } = require(SIM + '/node_modules/jsdom');
const { Radio, NativePhone, installWebCrypto } = require(SIM + '/native_mock');
const buildDir = path.resolve(process.argv[2]);
const opts = { readsContentFallback: true, retain: ['onPayloadReceived'], closeOnNoService: true, pace: [15, 15], ioDelay: 25 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
class DL extends ResourceLoader { constructor(d) { super(); this.d = d; } fetch(u) { const f = path.join(this.d, decodeURIComponent(new URL(u).pathname)); return fs.existsSync(f) ? Promise.resolve(fs.readFileSync(f)) : Promise.reject(new Error('x')); } }
const logs = [];
async function boot(name, native) {
  const vc = new VirtualConsole();
  ['log', 'warn', 'error'].forEach((l) => vc.on(l, (...a) => logs.push(`[${name}] ${l}: ` + a.map(String).join(' ').substring(0, 300))));
  const dom = new JSDOM(fs.readFileSync(path.join(buildDir, 'dist', 'index.html'), 'utf8'), {
    url: 'https://' + name.toLowerCase() + '.nexo.test/index.html', runScripts: 'dangerously', resources: new DL(path.join(buildDir, 'dist')), pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) { win.CapacitorCustomPlatform = { name: 'android' }; installWebCrypto(win); win.Capacitor = { Plugins: { NexoBLE: native.plugin() } }; win.HTMLElement.prototype.scrollTo = function () {}; win.URL.createObjectURL = function () { return 'blob:poc'; }; win.URL.revokeObjectURL = function () {}; },
  });
  const win = dom.window;
  for (let i = 0; i < 100 && !(win.NEXO && win.NEXO.initialized); i++) await sleep(100);
  await sleep(800);
  return { name, native, win };
}
const click = (w, el) => el && el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
const EVIL = '<img src=x onerror="window.__w1=1">';
(async () => {
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', opts), nB = new NativePhone(EVIL, 'BB:BB:BB:BB:BB:02', opts);
  [nA, nB].forEach((n) => { radio.add(n); n.load(); });
  const [A, B] = await Promise.all([boot('A', nA), boot('B', nB)]);
  const r = {};
  A.win.bleInterface.togglePanel(); let add = null;
  for (let i = 0; i < 400 && !add; i++) { await sleep(100); add = A.win.document.querySelector('#ble-new-device > div button'); if (!add && !A.win.bleInterface.isScanning) click(A.win, A.win.document.getElementById('ble-scan-btn')); }
  click(A.win, add); await sleep(2000);
  if (A.win.document.getElementById('ble-panel').classList.contains('active')) A.win.bleInterface.togglePanel();
  const rows = Array.from(A.win.document.querySelectorAll('#main-contacts-list .ble-contact-row'));
  r.nombres_en_A = rows.map((x) => (x.querySelector('.ble-contact-name') || {}).textContent);
  click(A.win, rows[0]); await sleep(800);
  r.cabecera = (A.win.document.getElementById('chat-contact-name') || {}).value;
  const nxA = A.win.bleInterface.localNexoId, nxB = B.win.bleInterface.localNexoId;
  r.nxA = nxA; r.nxB = nxB;
  // --- W1: B pone el fondo del chat en A (acción nexo_act wp) ---
  const img = 'data:image/jpeg;base64,' + Buffer.from('fake-jpeg-bytes-0123456789').toString('base64');
  try { await B.win.bleInterface.sendChatMessage(nxA, JSON.stringify({ type: 'nexo_act', act: 'wp', h: 'x', img }), null); } catch (e) { r.w1_send_err = e.message; }
  await sleep(2500);
  A.win.NEXO_WP_LONGPRESS_MS = 20;
  const mc = A.win.document.getElementById('messages-container');
  mc.dispatchEvent(new A.win.MouseEvent('mousedown', { bubbles: true, button: 0, clientX: 5, clientY: 5 }));
  await sleep(600);
  const sheet = A.win.document.getElementById('nexo-wp-sheet');
  r.w1_hoja = !!sheet;
  const sb = sheet && sheet.querySelector('#nexo-wp-share');
  r.w1_boton_compartir = !!sb;
  r.w1_img_inyectada = !!(sb && sb.querySelector('img[onerror]'));
  r.w1_html = sb ? sb.innerHTML.substring(0, 160) : null;
  if (sheet) sheet.remove();
  // --- M1: nota de voz con msgId que rompe el atributo id ---
  const evilId = '\\"><img src=x onerror=window.__m1=1 class=pocm1>';
  const att = JSON.stringify({ type: 'attachment', attachmentType: 'audio', payload: Buffer.from('nota-de-voz-falsa-000000').toString('base64'), meta: { duration: 2, format: 'webm' } });
  try { await B.win.bleInterface.sendChatMessage(nxA, att, evilId); } catch (e) { r.m1_send_err = e.message; }
  await sleep(3000);
  r.m1_img_inyectada = !!A.win.document.querySelector('#messages-container img.pocm1');
  r.m1_mensajes = A.win.document.querySelectorAll('#messages-container .message').length;
  try { await B.win.bleInterface.sendChatMessage(nxA, 'texto normal despues', 'msg_normal_1'); } catch (e) { r.n_send_err = e.message; }
  await sleep(3000);
  r.normal_llega = (await A.win.vaultLoadMessages(nxB)).some((m) => /texto normal despues/.test(m.content || ''));
  r.handlers = !!(A.win.__w1 || A.win.__m1);
  const ok = r.w1_hoja && r.w1_boton_compartir && !r.w1_img_inyectada && !r.m1_img_inyectada && !r.handlers && r.normal_llega;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('XSSIDS ' + JSON.stringify(r));
  if (!ok) console.log(logs.slice(-40).join('\n'));
  process.exit(0);
})().catch((e) => { console.error('FALLO:', e.stack); process.exit(1); });
