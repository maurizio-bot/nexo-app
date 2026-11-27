// 3360 (plan del dueño 27-11 §6): MENSAJES TEMPORALES. A pone 24 h en el chat con B → B lo recibe; lo escrito después se borra de los
// dos teléfonos al pasar el plazo; lo de antes de activarlo se queda; un cambio viejo que llega tarde no pisa uno nuevo; desactivar para.
// Uso: node chatdisappear.js <dir_build>
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
  A.win.bleInterface.togglePanel(); if (!(await addFound(A))) { console.log('CHATDISAPPEAR ' + JSON.stringify({ resultado: 'FALLO', error: 'no empareja' })); process.exit(1); } A.win.bleInterface.togglePanel();
  await openChatWith(A, 'B'); sendText(A, 'antes de activar'); await sleep(2500);
  r.emparejados = await wait(async () => (await B.win.vaultLoadMessages(idA)).some((m) => m.content === 'antes de activar'), 30);
  A.win.NEXO_setDisappear(idB, 86400000);
  r.B_recibe_ajuste = await wait(() => { const e = B.win.NEXO_disappearOf(idA); return !!(e && e.ttl === 86400000); }, 30);
  await sleep(50);
  sendText(A, 'temporal 1');
  r.llega = await wait(async () => (await B.win.vaultLoadMessages(idA)).some((m) => m.content === 'temporal 1'), 30);
  const has = async (P, cid, txt) => (await P.win.vaultLoadMessages(cid)).some((m) => m.content === txt);
  await A.win.NEXO_sweepChat(idB, Date.now() + 3600000); await B.win.NEXO_sweepChat(idA, Date.now() + 3600000);
  r.antes_del_plazo_sigue = (await has(A, idB, 'temporal 1')) && (await has(B, idA, 'temporal 1'));
  const bA = await A.win.NEXO_sweepChat(idB, Date.now() + 25 * 3600000), bB = await B.win.NEXO_sweepChat(idA, Date.now() + 25 * 3600000);
  r.pasado_el_plazo_se_borra = bA >= 1 && bB >= 1 && !(await has(A, idB, 'temporal 1')) && !(await has(B, idA, 'temporal 1'));
  r.lo_de_antes_se_queda = (await has(A, idB, 'antes de activar')) && (await has(B, idA, 'antes de activar'));
  // un cambio viejo (ts anterior) que llega tarde no pisa el nuevo
  const viejo = JSON.stringify({ type: 'nexo_act', act: 'dsp', ttl: 0, ts: 1000 });
  A.win.bleInterface.sendChatMessage(idB, viejo, 'dspold_' + Date.now());
  await sleep(4000);
  r.viejo_no_pisa = !!(B.win.NEXO_disappearOf(idA));
  B.win.NEXO_setDisappear(idA, 0);
  r.desactivar_llega = await wait(() => A.win.NEXO_disappearOf(idB) === null, 30);
  const ok = ['emparejados', 'B_recibe_ajuste', 'llega', 'antes_del_plazo_sigue', 'pasado_el_plazo_se_borra', 'lo_de_antes_se_queda', 'viejo_no_pisa', 'desactivar_llega'].every((k) => r[k] === true);
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('CHATDISAPPEAR ' + JSON.stringify(r));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('CHATDISAPPEAR ' + JSON.stringify({ resultado: 'FALLO', error: String(e && e.stack || e).slice(0, 400) })); process.exit(1); });
