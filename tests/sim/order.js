// Ronda 2767 (revisión de mensajes y archivos): el orden en el chat del que recibe. A y B por Bluetooth; el reloj de A
// va 2 min adelantado (sin red los relojes de los teléfonos no se ajustan).
//  1. Antes: un texto largo (o un archivo) llevaba la hora del reloj del otro y uno corto la de llegada: A manda un
//     texto largo, B contesta y A manda otro corto; en B el largo salía el último. Debe: largo, respuesta, corto.
//  2. Antes: con la app de B cerrada, lo que llegaba al buzón nativo salía en el chat con la hora de abrir la app
//     (todo igual, "ahora"). Debe: la hora a la que llegó.
// Uso: node order.js <dir_build>
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone } = require('./native_mock');

const buildDir = path.resolve(process.argv[2]);
const opts = { readsContentFallback: true, retain: ['onPayloadReceived'], closeOnNoService: true, pace: [15, 15], ioDelay: 25, asymmetric: true };
const SKEW = { A: 120000 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
class DL extends ResourceLoader { constructor(d) { super(); this.d = d; } fetch(u) { const f = path.join(this.d, decodeURIComponent(new URL(u).pathname)); return fs.existsSync(f) ? Promise.resolve(fs.readFileSync(f)) : Promise.reject(new Error('x')); } }
const logs = [];
async function boot(name, native) {
  const vc = new VirtualConsole();
  ['log', 'warn', 'error'].forEach((l) => vc.on(l, (...a) => logs.push(`${new Date().toISOString().substring(14, 23)} [${name}] ${l}: ` + a.map(String).join(' ').substring(0, 250))));
  const dom = new JSDOM(fs.readFileSync(path.join(buildDir, 'dist', 'index.html'), 'utf8'), {
    url: 'https://' + name.toLowerCase() + '.nexo.test/index.html', runScripts: 'dangerously', resources: new DL(path.join(buildDir, 'dist')), pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) {
      win.CapacitorCustomPlatform = { name: 'android' }; require('./native_mock').installWebCrypto(win); win.Capacitor = { Plugins: { NexoBLE: native.plugin() } }; win.HTMLElement.prototype.scrollTo = function () {};
      if (SKEW[name]) { const now0 = win.Date.now.bind(win.Date); win.Date.now = () => now0() + SKEW[name]; }
    },
  });
  const win = dom.window;
  for (let i = 0; i < 100 && !(win.NEXO && win.NEXO.initialized); i++) await sleep(100);
  await sleep(800);
  return { name, native, win };
}
const click = (w, el) => el && el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
async function openChatWith(p, name) {
  let row; for (let i = 0; i < 300 && !row; i++) { row = Array.from(p.win.document.querySelectorAll('#main-contacts-list .ble-contact-row')).find((r) => (r.querySelector('.ble-contact-name') || {}).textContent === name); if (!row) await sleep(100); }
  click(p.win, row); await sleep(600); return !!row;
}
function sendText(p, t) { const i = p.win.document.getElementById('message-input'); i.value = t; i.dispatchEvent(new p.win.Event('input', { bubbles: true })); click(p.win, p.win.document.getElementById('send-btn')); }
const wait = async (c, s) => { for (let i = 0; i < s * 5; i++) { if (await c()) return true; await sleep(200); } return false; };
const has = async (p, cid, t) => (await p.win.vaultLoadMessages(cid)).some((m) => m.content === t);
// Como se ve el chat (el historial se ordena por la hora y luego por seq)
const shown = (msgs) => msgs.slice().sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0) || (a.seq || 0) - (b.seq || 0));

(async () => {
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', opts), nB = new NativePhone('B', 'BB:BB:BB:BB:BB:02', opts);
  [nA, nB].forEach((n) => { radio.add(n); n.load(); });
  let [A, B] = await Promise.all([boot('A', nA), boot('B', nB)]);
  const idA = A.win.bleInterface.localNexoId.toLowerCase(), idB = B.win.bleInterface.localNexoId.toLowerCase();
  const r = { build: path.basename(buildDir) };
  A.win.bleInterface.togglePanel(); let add = null;
  for (let i = 0; i < 400 && !add; i++) { await sleep(100); add = A.win.document.querySelector('#ble-new-device > div button'); if (!add && !A.win.bleInterface.isScanning) click(A.win, A.win.document.getElementById('ble-scan-btn')); }
  click(A.win, add); await sleep(1500);
  if (A.win.document.getElementById('ble-panel').classList.contains('active')) A.win.bleInterface.togglePanel();
  await openChatWith(A, 'B'); sendText(A, 'hola'); await sleep(2500);
  r.contactos = await wait(() => has(B, idA, 'hola'), 30);
  // 1. Largo de A, respuesta de B, corto de A
  const L1 = 'L1 ' + 'texto largo '.repeat(200) + 'fin';
  sendText(A, L1);
  r.llega_largo = await wait(() => has(B, idA, L1), 60);
  await openChatWith(B, 'A'); sendText(B, 'r1 respuesta');
  r.llega_respuesta = await wait(() => has(A, idB, 'r1 respuesta'), 30);
  sendText(A, 's2 corto');
  r.llega_corto = await wait(() => has(B, idA, 's2 corto'), 30);
  const label = (m) => String(m.content).substring(0, 2);
  r.orden_en_B = shown((await B.win.vaultLoadMessages(idA)).filter((m) => /^(L1|r1|s2)/.test(m.content || ''))).map(label);
  // 2. Con la app de B cerrada
  B.win.close(); nB.destroyActivity(); await sleep(1500);
  sendText(A, 'c1 cerrada'); await sleep(3000);
  sendText(A, 'c2 cerrada'); await sleep(3000);
  r.en_buzon = (nB.bgInbox || []).length;
  const tOpen = Date.now();
  nB.load(); B = await boot('B', nB);
  r.llegan_al_abrir = await wait(async () => (await has(B, idA, 'c1 cerrada')) && (await has(B, idA, 'c2 cerrada')), 60);
  const vb = await B.win.vaultLoadMessages(idA), c1 = vb.find((m) => m.content === 'c1 cerrada'), c2 = vb.find((m) => m.content === 'c2 cerrada');
  r.cerrada_entre_c1_y_c2_s = c1 && c2 ? Math.round((c2.timestamp - c1.timestamp) / 100) / 10 : null;
  r.cerrada_c1_antes_de_abrir_s = c1 ? Math.round((tOpen - c1.timestamp) / 100) / 10 : null;
  r.errores = logs.filter((l) => / error: /.test(l) && !/JSDOMERROR|styles\.css|Not implemented/.test(l)).slice(0, 5);
  const ok = r.contactos && r.llega_largo && r.llega_respuesta && r.llega_corto && r.orden_en_B.join(',') === 'L1,r1,s2' && r.en_buzon >= 2 && r.llegan_al_abrir &&
    r.cerrada_entre_c1_y_c2_s >= 2 && r.cerrada_c1_antes_de_abrir_s >= 3 && !r.errores.length;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('ORDER ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_order.txt'), logs.join('\n'));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error(e); fs.writeFileSync(path.join(__dirname, 'last_logs_order.txt'), logs.join('\n')); process.exit(1); });
