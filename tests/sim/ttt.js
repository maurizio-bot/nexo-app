// Tres en raya (2830): A y B juegan por el canal del chat. Las jugadas se PROPAGAN (acción oculta), el estado se
// mantiene en los dos, A gana la fila de arriba, y una jugada ILEGAL (fuera de turno) se ignora. Función de juego
// comprobada por los ganchos __nexoTtt* (sin depender del DOM del overlay). Uso: node ttt.js <dir_build> [--io-delay=25]
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

  // Emparejar A y B (kx con fx:1), como en los otros tests.
  P.A.win.bleInterface.togglePanel(); const ok = await addFound(P.A, 'B'); P.A.win.bleInterface.togglePanel();
  await sleep(800);
  await openChatWith(P.A, 'B'); await sendText(P.A, 'hola B'); await sleep(2500); await closeChat(P.A);
  if (!ok) { console.log('TTT ' + JSON.stringify({ error: 'no empareja AB' })); process.exit(0); }
  await sleep(3000);

  const stA = (gid) => A.win.__nexoTttState(gid);
  const stB = (gid) => B.win.__nexoTttState(gid);
  const waitB = (gid, pred, ms) => waitFor(async () => { const s = B.win.__nexoTttState(gid); return s && pred(s); }, ms);
  const waitA = (gid, pred, ms) => waitFor(async () => { const s = A.win.__nexoTttState(gid); return s && pred(s); }, ms);

  await openChatWith(A, 'B'); await sleep(400);
  // A empieza (X) y juega la casilla 0 → invita a B.
  const gid = A.win.__nexoTttStart(id('B'));
  r.gid = !!gid;
  A.win.__nexoTttMove(gid, 0);
  r.b_recibe_invite = (await waitFor(async () => { const g = B.win.__nexoTttGidFor(id('A')); if (!g) return false; const s = B.win.__nexoTttState(g); return s && s.board[0] === 'X' && s.me === 'O'; }, 30000)) !== null;
  const gidB = B.win.__nexoTttGidFor(id('A'));
  r.mismo_gid = gidB === gid;

  // B juega 3 → A lo recibe.
  B.win.__nexoTttMove(gidB, 3);
  r.a_recibe = (await waitA(gid, (s) => s.board[3] === 'O', 30000)) !== null;
  // A juega 1 → B lo recibe.
  A.win.__nexoTttMove(gid, 1);
  await waitB(gidB, (s) => s.board[1] === 'X', 30000);
  // B juega 4 → A lo recibe. Ahora toca X (A).
  B.win.__nexoTttMove(gidB, 4);
  await waitA(gid, (s) => s.board[4] === 'O', 30000);

  // Jugada ILEGAL: B intenta jugar fuera de turno (es turno de X). No debe cambiar nada.
  const beforeB = JSON.stringify(stB(gidB).board);
  const ilegalRet = B.win.__nexoTttMove(gidB, 6);
  r.ilegal_turno = (ilegalRet === false) && JSON.stringify(stB(gidB).board) === beforeB;

  // A juega 2 → gana la fila de arriba (0,1,2). Su estado queda ganador al instante (jugada local, síncrona).
  A.win.__nexoTttMove(gid, 2);
  var sa2 = stA(gid); r.a_gana = !!(sa2 && sa2.over && sa2.winner === 'X');
  r.b_ve_gana = (await waitB(gidB, (s) => s.over && s.winner === 'X', 30000)) !== null;
  r.resultado = (r.gid && r.b_recibe_invite && r.mismo_gid && r.a_recibe && r.ilegal_turno && r.a_gana && r.b_ve_gana) ? 'OK' : 'FALLO';
  console.log('TTT ' + JSON.stringify(r));
  try { fs.writeFileSync(path.join(buildDir, 'last_logs_ttt.txt'), logs.slice(-250).join('\n')); } catch (e) {}
  process.exit(0);
})().catch((e) => { console.log('TTT ' + JSON.stringify({ error: String((e && e.message) || e) })); process.exit(0); });
