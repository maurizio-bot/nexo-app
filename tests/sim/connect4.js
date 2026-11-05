// Conecta 4 (Fase A): A y B juegan por el canal del chat. Las jugadas se PROPAGAN (acción oculta cifrada), el estado se
// mantiene en los dos, A gana una columna (4 vertical), una jugada FUERA DE TURNO se ignora, y el gid coincide. Función
// de juego comprobada por los ganchos __nexoC4* (sin depender del DOM del overlay). Uso: node connect4.js <dir_build>
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone, installWebCrypto } = require('./native_mock');

const buildDir = path.resolve(process.argv[2]);
const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith('--' + k)); if (!a) return d; const v = a.split('=')[1]; return v === undefined ? true : Number(v); };
const opts = { readsContentFallback: true, retain: ['onPayloadReceived'], closeOnNoService: true, pace: [15, 15], ioDelay: arg('io-delay', 0), asymmetric: true };
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
    beforeParse(win) {
      win.CapacitorCustomPlatform = { name: 'android' }; installWebCrypto(win); win.Capacitor = { Plugins: { NexoBLE: native.plugin() } };
      win.HTMLElement.prototype.scrollTo = function () {}; Object.defineProperty(win.navigator, 'clipboard', { value: { writeText: async (t) => { win.__copied = t; } } });
    },
  });
  const win = dom.window;
  for (let i = 0; i < 100 && !(win.NEXO && win.NEXO.initialized); i++) await sleep(100);
  await sleep(800);
  return { name, native, win };
}
const click = (win, el) => el && el.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
async function openChatWith(p, name) {
  const row = Array.from(p.win.document.querySelectorAll('#main-contacts-list .ble-contact-row')).find((r) => (r.querySelector('.ble-contact-name') || {}).textContent === name);
  click(p.win, row); await sleep(600); return !!row;
}
async function closeChat(p) { p.win.dispatchEvent(new p.win.CustomEvent('nexo:ble:closeChat', { detail: {} })); await sleep(300); }
async function sendText(p, t) { const i = p.win.document.getElementById('message-input'); i.value = t; i.dispatchEvent(new p.win.Event('input', { bubbles: true })); click(p.win, p.win.document.getElementById('send-btn')); }
async function addFound(p, name) {
  let add = null;
  if (p.win.bleInterface.isScanning) { click(p.win, p.win.document.getElementById('ble-scan-btn')); await sleep(400); }
  const find = () => { const row = Array.from(p.win.document.querySelectorAll('#ble-new-device > div')).find((d) => (d.querySelector('span') || {}).textContent === name); return row && row.querySelector('button'); };
  for (let i = 0; i < 400 && !add; i++) { await sleep(100); add = find(); if (!add && !p.win.bleInterface.isScanning) click(p.win, p.win.document.getElementById('ble-scan-btn')); }
  click(p.win, add); await sleep(2000);
  return !!add;
}
async function waitFor(fn, ms) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return Math.round((Date.now() - t0) / 100) / 10; await sleep(400); } return null; }

(async () => {
  const radio = new Radio();
  const names = ['A', 'B'];
  const nat = {}, P = {};
  names.forEach((n, i) => { nat[n] = new NativePhone(n, n.repeat(2) + ':' + n.repeat(2) + ':' + n.repeat(2) + ':' + n.repeat(2) + ':' + n.repeat(2) + ':0' + (i + 1), opts); radio.add(nat[n]); nat[n].load(); });
  (await Promise.all(names.map((n) => boot(n, nat[n])))).forEach((p) => { P[p.name] = p; });
  const id = (n) => P[n].win.bleInterface.localNexoId.toLowerCase();
  const A = P.A, B = P.B;
  const r = { build: path.basename(buildDir) };

  // Emparejar A y B.
  P.A.win.bleInterface.togglePanel(); const ok = await addFound(P.A, 'B'); P.A.win.bleInterface.togglePanel();
  await sleep(800);
  await openChatWith(P.A, 'B'); await sendText(P.A, 'hola B'); await sleep(2500); await closeChat(P.A);
  if (!ok) { console.log('C4 ' + JSON.stringify({ error: 'no empareja AB' })); process.exit(0); }
  await sleep(3000);

  const stA = (gid) => A.win.__nexoC4State(gid);
  const stB = (gid) => B.win.__nexoC4State(gid);
  const waitB = (gid, pred, ms) => waitFor(async () => { const s = B.win.__nexoC4State(gid); return s && pred(s); }, ms);
  const waitA = (gid, pred, ms) => waitFor(async () => { const s = A.win.__nexoC4State(gid); return s && pred(s); }, ms);
  const COLS = 7, bot = (c) => 35 + c; // fila de abajo (r=5): idx 35..41

  await openChatWith(A, 'B'); await sleep(400);
  // A empieza (R) y suelta en la columna 0 → invita a B.
  const gid = A.win.__nexoC4Start(id('B'));
  r.gid = !!gid;
  A.win.__nexoC4Drop(gid, 0);
  r.b_recibe_invite = (await waitFor(async () => { const g = B.win.__nexoC4GidFor(id('A')); if (!g) return false; const s = B.win.__nexoC4State(g); return s && s.board[bot(0)] === 'R' && s.me === 'Y'; }, 30000)) !== null;
  const gidB = B.win.__nexoC4GidFor(id('A'));
  r.mismo_gid = gidB === gid;

  // Columna 0 para A (R), columna 1 para B (Y). A arma 4 verticales en la col 0.
  B.win.__nexoC4Drop(gidB, 1);                     // Y → 36
  r.a_recibe = (await waitA(gid, (s) => s.board[bot(1)] === 'Y', 30000)) !== null;
  A.win.__nexoC4Drop(gid, 0);                      // R → 28
  await waitB(gidB, (s) => s.board[28] === 'R', 30000);
  B.win.__nexoC4Drop(gidB, 1);                     // Y → 29
  await waitA(gid, (s) => s.board[29] === 'Y', 30000);
  A.win.__nexoC4Drop(gid, 0);                      // R → 21
  await waitB(gidB, (s) => s.board[21] === 'R', 30000);
  B.win.__nexoC4Drop(gidB, 1);                     // Y → 22
  await waitA(gid, (s) => s.board[22] === 'Y', 30000);

  // Jugada ILEGAL: B intenta soltar fuera de turno (es turno de R/A). No debe cambiar nada.
  const beforeB = JSON.stringify(stB(gidB).board);
  const ilegalRet = B.win.__nexoC4Drop(gidB, 2);
  r.ilegal_turno = (ilegalRet === false) && JSON.stringify(stB(gidB).board) === beforeB;

  // A suelta col 0 → 4 en vertical (35,28,21,14) → gana. Estado local inmediato (síncrono).
  A.win.__nexoC4Drop(gid, 0);                      // R → 14, gana
  var sa2 = stA(gid); r.a_gana = !!(sa2 && sa2.over && sa2.winner === 'R');
  r.b_ve_gana = (await waitB(gidB, (s) => s.over && s.winner === 'R', 30000)) !== null;

  r.resultado = (r.gid && r.b_recibe_invite && r.mismo_gid && r.a_recibe && r.ilegal_turno && r.a_gana && r.b_ve_gana) ? 'OK' : 'FALLO';
  console.log('C4 ' + JSON.stringify(r));
  try { fs.writeFileSync(path.join(buildDir, 'last_logs_connect4.txt'), logs.slice(-250).join('\n')); } catch (e) {}
  process.exit(0);
})().catch((e) => { console.log('C4 ' + JSON.stringify({ error: String((e && e.message) || e) })); process.exit(0); });
