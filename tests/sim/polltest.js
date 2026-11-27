// 3361 (plan del dueño 27-11 §6): ENCUESTAS. A crea una por la hoja (Adjuntar → Más → Encuesta) → B la recibe y la ve; B vota → A ve
// el voto; A vota → B lo ve; una sola respuesta: cambiar mueve el voto; tocar otra vez lo quita. Uso: node polltest.js <dir_build>
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone, installWebCrypto } = require('./native_mock');

const buildDir = path.resolve(process.argv[2]);
const opts = { readsContentFallback: true, retain: ['onPayloadReceived'], closeOnNoService: true, pace: [15, 15], ioDelay: 25, asymmetric: true };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
class DL extends ResourceLoader { constructor(d) { super(); this.d = d; } fetch(u) { const f = path.join(this.d, decodeURIComponent(new URL(u).pathname)); return fs.existsSync(f) ? Promise.resolve(fs.readFileSync(f)) : Promise.reject(new Error('x')); } }
const logs = [];
async function boot(name, native) {
  const vc = new VirtualConsole();
  ['log', 'warn', 'error'].forEach((l) => vc.on(l, (...a) => logs.push(`[${name}] ${l}: ` + a.map(String).join(' ').substring(0, 250))));
  const dom = new JSDOM(fs.readFileSync(path.join(buildDir, 'dist', 'index.html'), 'utf8'), {
    url: 'https://' + name.toLowerCase() + '.nexo.test/index.html', runScripts: 'dangerously', resources: new DL(path.join(buildDir, 'dist')), pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) { win.CapacitorCustomPlatform = { name: 'android' }; installWebCrypto(win); win.Capacitor = { Plugins: { NexoBLE: native.plugin() } }; win.HTMLElement.prototype.scrollTo = function () {}; },
  });
  const win = dom.window;
  for (let i = 0; i < 100 && !(win.NEXO && win.NEXO.initialized); i++) await sleep(100);
  await sleep(800);
  return { name, native, win };
}
const click = (w, el) => el && el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
async function addFound(p) {
  let add = null;
  for (let i = 0; i < 400 && !add; i++) { await sleep(100); add = p.win.document.querySelector('#ble-new-device > div button'); if (!add && !p.win.bleInterface.isScanning) click(p.win, p.win.document.getElementById('ble-scan-btn')); }
  click(p.win, add); await sleep(2000); return !!add;
}
async function openChatWith(p, name) { let row; for (let i = 0; i < 300 && !row; i++) { row = Array.from(p.win.document.querySelectorAll('#main-contacts-list .ble-contact-row')).find((r) => (r.querySelector('.ble-contact-name') || {}).textContent === name); if (!row) await sleep(100); } click(p.win, row); await sleep(600); return !!row; }
async function closeChat(p) { p.win.dispatchEvent(new p.win.CustomEvent('nexo:ble:closeChat', { detail: {} })); await sleep(300); }
function sendText(p, t) { const i = p.win.document.getElementById('message-input'); i.value = t; i.dispatchEvent(new p.win.Event('input', { bubbles: true })); click(p.win, p.win.document.getElementById('send-btn')); }
const wait = async (c, s) => { for (let i = 0; i < s * 5; i++) { if (await c()) return true; await sleep(200); } return false; };
// 3169: los estados ya no están en una tira arriba de Contactos sino en su propia pantalla (estados_screen.js; una fila por estado)
const chips = (p) => Array.from(p.win.document.querySelectorAll('#estados-screen .estado-chip'));
// 3230: los estados se ven a pantalla completa dentro de Estados (estados_feed.js): tocar el círculo lleva a los suyos; el de la
// vista lleva los id de siempre (#estado-view…); me gusta = dos toques; se sale de Estados con el «atrás»
const openEst = (p) => { if (p.win.__nexoEstadosOpen) p.win.__nexoEstadosOpen(); };
const closeEst = (p) => { if (p.win.__nexoEstadosBack) p.win.__nexoEstadosBack(); };

(async () => {
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', opts), nB = new NativePhone('B', 'BB:BB:BB:BB:BB:02', opts);
  [nA, nB].forEach((n) => { radio.add(n); n.load(); });
  const [A, B] = await Promise.all([boot('A', nA), boot('B', nB)]);
  const idA = A.win.bleInterface.localNexoId.toLowerCase(), idB = B.win.bleInterface.localNexoId.toLowerCase();
  const r = { build: path.basename(buildDir) };
  // Emparejar
  A.win.bleInterface.togglePanel(); if (!(await addFound(A))) { console.log('POLLTEST ' + JSON.stringify({ resultado: 'FALLO', error: 'no empareja' })); process.exit(1); } A.win.bleInterface.togglePanel();
  await openChatWith(A, 'B'); sendText(A, 'hola'); await sleep(2500);
  r.emparejados = await wait(async () => (await B.win.vaultLoadMessages(idA)).some((m) => m.content === 'hola'), 30);
  // A crea la encuesta con la hoja
  A.win.NEXO_openPollSheet(); await sleep(200);
  const d = A.win.document; d.getElementById('poll-q').value = '¿Dónde cenamos?';
  click(A.win, d.getElementById('poll-add')); await sleep(50);
  const ins = d.querySelectorAll('#poll-opts .poll-o'); ins[0].value = 'Tacos'; ins[1].value = 'Pizza'; ins[2].value = 'Sushi';
  click(A.win, d.getElementById('poll-send'));
  const poll = async (P, cid) => { const m = (await P.win.vaultLoadMessages(cid)).find((x) => x.attachmentType === 'poll' || /"attachmentType":"poll"/.test(String(x.content || ''))); if (m && !m.attachmentMeta) { try { m.attachmentMeta = JSON.parse(m.content).meta; } catch (e) {} } return m; };
  r.B_recibe = await wait(async () => !!(await poll(B, idA)), 30);
  const pa = await poll(A, idB), pb = await poll(B, idA);
  r.tres_opciones = !!(pb && pb.attachmentMeta && pb.attachmentMeta.opts && pb.attachmentMeta.opts.length === 3);
  r.A_ve_tarjeta = !!A.win.document.querySelector('.poll-card .poll-opt');
  await openChatWith(B, 'A'); await sleep(800);
  r.B_ve_tarjeta = B.win.document.querySelectorAll('.poll-card .poll-opt').length === 3;
  const idOf = (m) => m.msgId || m.messageId;
  B.win.NEXO_pollVote(idA, idOf(pb), 1, pb.attachmentMeta);
  r.A_ve_voto_de_B = await wait(() => A.win.NEXO_pollCounts(idOf(pa), 3).counts[1] === 1, 30);
  A.win.NEXO_pollVote(idB, idOf(pa), 1, pa.attachmentMeta);
  r.B_ve_dos = await wait(() => B.win.NEXO_pollCounts(idOf(pb), 3).counts[1] === 2, 30);
  A.win.NEXO_pollVote(idB, idOf(pa), 2, pa.attachmentMeta);
  r.cambiar_mueve = await wait(() => { const c = B.win.NEXO_pollCounts(idOf(pb), 3).counts; return c[1] === 1 && c[2] === 1; }, 30);
  A.win.NEXO_pollVote(idB, idOf(pa), 2, pa.attachmentMeta);
  r.quitar = await wait(() => { const c = B.win.NEXO_pollCounts(idOf(pb), 3); return c.counts[2] === 0 && c.voters === 1; }, 30);
  r.tarjeta_cuenta = (A.win.document.querySelector('.poll-card .poll-voters') || {}).textContent || '';
  const ok = ['emparejados', 'B_recibe', 'tres_opciones', 'A_ve_tarjeta', 'B_ve_tarjeta', 'A_ve_voto_de_B', 'B_ve_dos', 'cambiar_mueve', 'quitar'].every((k) => r[k] === true);
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('POLLTEST ' + JSON.stringify(r));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('POLLTEST ' + JSON.stringify({ resultado: 'FALLO', error: String(e && e.stack || e).slice(0, 400) })); process.exit(1); });
