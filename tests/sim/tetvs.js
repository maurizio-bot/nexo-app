// Tetris VERSUS (Fase A): A y B juegan cada uno su tablero por el canal del chat. Las jugadas/efectos se PROPAGAN como
// acciones ocultas cifradas (por EVENTOS, no posición a posición). Comprueba: A reta a B y la SEMILLA es COMPARTIDA
// (misma cola de piezas); A hace líneas → le manda BASURA a B (el tablero de B crece); una basura INVÁLIDA se ignora y
// NO quema el contador de secuencia (un evento válido posterior sí entra); cuando A se topa, A pierde y B gana, y el
// ranking cabeza a cabeza queda 0–1 en A y 1–0 en B. Función comprobada por los ganchos __nexoTvs* (sin DOM/canvas).
// Uso: node tetvs.js <dir_build>
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone, installWebCrypto } = require('./native_mock');

const buildDir = path.resolve(process.argv[2]);
const opts = { readsContentFallback: true, retain: ['onPayloadReceived'], closeOnNoService: true, pace: [15, 15], ioDelay: 0, asymmetric: true };
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
async function waitFor(fn, ms) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return Math.round((Date.now() - t0) / 100) / 10; await sleep(300); } return null; }

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
  if (!ok) { console.log('TVS ' + JSON.stringify({ error: 'no empareja AB' })); process.exit(0); }
  await sleep(2500);

  const stA = (gid) => A.win.__nexoTvsState(gid);
  const stB = (gid) => B.win.__nexoTvsState(gid);

  await openChatWith(A, 'B'); await sleep(300);
  // A reta a B. Cierro el overlay de A enseguida para PARAR el loop de caída (así A no juega solo durante la prueba).
  const gid = A.win.__nexoTvsStart(id('B'));
  A.win.__nexoCloseTvs();
  r.gid = !!gid;

  // B recibe la invitación 'start' y crea su partida con la MISMA semilla (misma cola de piezas = justo).
  r.b_recibe = (await waitFor(async () => { const g = B.win.__nexoTvsGidFor(id('A')); return g && B.win.__nexoTvsState(g); }, 30000)) !== null;
  const gidB = B.win.__nexoTvsGidFor(id('A'));
  r.mismo_gid = gidB === gid;
  r.semilla_compartida = !!(stA(gid) && stB(gidB) && stA(gid).seed === stB(gidB).seed && stA(gid).next === stB(gidB).next);

  // #dueño 06-11: A hace UNA línea → me manda 1 fila de basura (GARBAGE_FOR[1]=1). ESTE es el caso que el dueño vio ROTO:
  // antes 1 línea mandaba 0 basura, así que haciendo líneas de a una NUNCA se reflejaba nada en el rival. El tablero de B crece.
  const filledB0 = stB(gidB).filled;
  A.win.__nexoTvsClearLines(gid, 1);
  r.b_recibe_basura_1linea = (await waitFor(async () => { const s = stB(gidB); return s && s.recv === 1; }, 30000)) !== null;
  r.basura_crece_tablero = stB(gidB).filled > filledB0;

  // A hace 3 líneas → 3 filas más (GARBAGE_FOR[3]=3). recv 1→4.
  A.win.__nexoTvsClearLines(gid, 3);
  r.b_recibe_basura_3 = (await waitFor(async () => { const s = stB(gidB); return s && s.recv === 4; }, 30000)) !== null;

  // Basura INVÁLIDA (n=99) inyectada directo en B: se ignora y NO quema el seq. Uso un seq ALTO para probar que, pese a
  // eso, un evento VÁLIDO posterior (con seq menor, el real de A) SÍ entra (el inválido no comprometió seqIn).
  B.win.__nexoTvsOnAction(id('A'), { g: 'tetvs', gid: gidB, seq: 99999, e: 'garbage', n: 99, h: [0] });
  await sleep(200);
  r.basura_invalida_ignorada = stB(gidB).recv === 4;
  // Ahora A hace 2 líneas más → 2 filas (GARBAGE_FOR[2]=2). Debe entrar (recv 4→6) aunque antes llegó el seq 99999.
  A.win.__nexoTvsClearLines(gid, 2);
  r.valido_tras_invalido = (await waitFor(async () => { const s = stB(gidB); return s && s.recv === 6; }, 30000)) !== null;

  // A se topa (pierde). Manda 'over'. A queda perdedor; B, que seguía vivo, gana.
  A.win.__nexoTvsTopOut(gid);
  r.a_pierde = !!(stA(gid) && stA(gid).over && stA(gid).winner === 'opp');
  r.b_gana = (await waitFor(async () => { const s = stB(gidB); return s && s.over && s.winner === 'me'; }, 30000)) !== null;

  // Ranking cabeza a cabeza: A perdió vs B (0–1), B ganó vs A (1–0).
  await sleep(400);
  const h2hA = A.win.__nexoGameH2H(id('B'), 'tetvs'), h2hB = B.win.__nexoGameH2H(id('A'), 'tetvs');
  r.ranking_A_0v1 = !!(h2hA && h2hA.w === 0 && h2hA.l === 1);
  r.ranking_B_1v0 = !!(h2hB && h2hB.w === 1 && h2hB.l === 0);

  r.errores = logs.filter((l) => /PAGEERROR|TypeError|is not a function/.test(l)).slice(0, 5);
  r.resultado = (r.gid && r.b_recibe && r.mismo_gid && r.semilla_compartida && r.b_recibe_basura_1linea && r.b_recibe_basura_3 && r.basura_crece_tablero &&
    r.basura_invalida_ignorada && r.valido_tras_invalido && r.a_pierde && r.b_gana && r.ranking_A_0v1 && r.ranking_B_1v0 && r.errores.length === 0) ? 'OK' : 'FALLO';
  console.log('TVS ' + JSON.stringify(r));
  try { fs.writeFileSync(path.join(buildDir, 'last_logs_tetvs.txt'), logs.slice(-250).join('\n')); } catch (e) {}
  process.exit(0);
})().catch((e) => { console.log('TVS ' + JSON.stringify({ error: String((e && e.message) || e) })); process.exit(0); });
