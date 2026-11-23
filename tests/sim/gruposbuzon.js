// COLA 4b «Grupos: administración», G2 — COPIA CIFRADA del estado del grupo en el buzón de archivos de los relés (decisión 20-11:
// reusa blob_mailbox.js, cifrado, 7 días; cada cambio sube una copia nueva). A y B con Bluetooth y un relé local.
//  1. A crea el grupo (Colegas) y B hace un cambio: sube la copia del estado (registro «Copia del estado vN … en el buzón»).
//  2. A se pierde 7 cambios de B (más de los 6 que viajan con cada cambio) y no puede pedirle el estado (se le quita esa vía):
//     con el siguiente cambio de B ve el hueco, baja la copia del buzón (firmada: se valida igual) y queda al día.
// Uso: node gruposbuzon.js <dir_build>
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone, installWebCrypto } = require('./native_mock');
const { NostrRelay } = require('./nostr_relay');

const buildDir = path.resolve(process.argv[2]);
const base = { readsContentFallback: true, retain: ['onPayloadReceived'], closeOnNoService: true, pace: [15, 15], ioDelay: 10, asymmetric: true, noTor: true };
let RELAYS = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
class DistLoader extends ResourceLoader {
  constructor(dir) { super(); this.dir = dir; }
  fetch(url) { const f = path.join(this.dir, decodeURIComponent(new URL(url).pathname)); return fs.existsSync(f) ? Promise.resolve(fs.readFileSync(f)) : Promise.reject(new Error('no existe ' + f)); }
}
const logs = [];
async function boot(name, native) {
  const vc = new VirtualConsole();
  ['log', 'warn', 'error'].forEach((l) => vc.on(l, (...a) => logs.push(`${new Date().toISOString().substring(14, 23)} [${name}] ${l}: ` + a.map(String).join(' ').substring(0, 300))));
  const dom = new JSDOM(fs.readFileSync(path.join(buildDir, 'dist', 'index.html'), 'utf8'), {
    url: 'https://' + name.toLowerCase() + '.nexo.test/index.html', runScripts: 'dangerously',
    resources: new DistLoader(path.join(buildDir, 'dist')), pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) { win.NEXO_NET_RELAYS = RELAYS; win.CapacitorCustomPlatform = { name: 'android' }; installWebCrypto(win); win.Capacitor = { Plugins: { NexoBLE: native.plugin() } }; win.HTMLElement.prototype.scrollTo = function () {}; },
  });
  const win = dom.window;
  for (let i = 0; i < 100 && !(win.NEXO && win.NEXO.initialized); i++) await sleep(100);
  await sleep(800);
  return { name, native, win };
}
const click = (win, el) => el && el.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
async function openChatWith(p, name) {
  const row = Array.from(p.win.document.querySelectorAll('#main-contacts-list .ble-contact-row')).find((r) => (r.querySelector('.ble-contact-name') || {}).textContent === name);
  click(p.win, row); await sleep(500); return !!row;
}
async function sendText(p, t) { const i = p.win.document.getElementById('message-input'); i.value = t; i.dispatchEvent(new p.win.Event('input', { bubbles: true })); click(p.win, p.win.document.getElementById('send-btn')); }
async function addFound(p, name) {
  let add = null;
  const find = () => { const row = Array.from(p.win.document.querySelectorAll('#ble-new-device > div')).find((d) => (d.querySelector('span') || {}).textContent === name); return row && row.querySelector('button'); };
  for (let i = 0; i < 400 && !add; i++) { await sleep(100); add = find(); if (!add && !p.win.bleInterface.isScanning) click(p.win, p.win.document.getElementById('ble-scan-btn')); }
  click(p.win, add); await sleep(2000);
  return !!add;
}
const wait = async (c, s) => { for (let i = 0; i < s * 5; i++) { if (await c()) return true; await sleep(200); } return !!(await c()); };

(async () => {
  const relay = new NostrRelay();
  RELAYS = [await relay.start()];
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', base), nB = new NativePhone('B', 'BB:BB:BB:BB:BB:02', base);
  [nA, nB].forEach((n) => { radio.add(n); n.load(); });
  const A = await boot('A', nA), B = await boot('B', nB);
  const r = { build: path.basename(buildDir) };
  const idB = B.win.bleInterface.localNexoId.toLowerCase();
  A.win.bleInterface.togglePanel(); r.empareja = await addFound(A, 'B'); A.win.bleInterface.togglePanel();
  await openChatWith(A, 'B'); await sendText(A, 'hola B'); await sleep(3000);
  r.A_en_linea = await wait(() => A.win.bleInterface.net && A.win.bleInterface.net.online(), 30);
  const gsA = A.win.bleInterface.groups, gsB = () => B.win.bleInterface.groups;
  const g = gsA.create('Buzón', [idB]);
  const chain = await gsA.signGenesis(g.id, 'o', 0);
  A.win.NEXO_sendGroupText(g.id, JSON.stringify({ type: 'nexo_txt', t: '👥 Creó el grupo', gs: 1 }), 'creó', null, A.win.NEXO_groupCards(g), { extra: { s: chain } });
  r.B_v1 = await wait(() => gsB().get(g.id) && gsB().get(g.id).s && gsB().get(g.id).s.v === 1, 60);
  // quien cambia es B (en modo Colegas todos renombran) y quien se atrasa, A: un cambio con hueco solo se acepta del creador, así
  // que el que va atrasado frente a un miembro normal necesita los estados intermedios
  const copyOf = (v) => logs.some((l) => new RegExp('\\[B\\].*Copia del estado v' + v + ' de ' + g.id + ' en el buzón').test(l));
  r.B_en_linea = await wait(() => B.win.bleInterface.net && B.win.bleInterface.net.online(), 30);
  await gsB().renameSigned(g.id, 'Buzón 2');
  r.copia_subida = await wait(() => copyOf(2) && !!gsB().get(g.id).sp, 60);
  r.A_v2 = await wait(() => gsA.get(g.id).s.v === 2, 60);
  const realRecv = gsA._adminReceive;
  gsA._adminReceive = function (env) { return env && env.s ? { ret: null } : realRecv.apply(this, arguments); };
  gsA._askState = function () {};
  for (let i = 3; i <= 9; i++) { await gsB().renameSigned(g.id, 'Buzón ' + i); await sleep(200); }
  r.copia_v9 = await wait(() => copyOf(9), 60);
  r.A_atrasado = gsA.get(g.id).s.v === 2;
  gsA._adminReceive = realRecv;
  await gsB().renameSigned(g.id, 'Buzón final');
  r.A_baja_la_copia = await wait(() => logs.some((l) => /\[A\].*Copia del estado de .* bajada del buzón: [1-9]/.test(l)), 60);
  r.A_al_dia = await wait(() => gsA.get(g.id).s.v === 10 && gsA.get(g.id).name === 'Buzón final', 60);
  r.errores = logs.filter((l) => / error: /.test(l) && !/JSDOMERROR|styles\.css/.test(l)).slice(0, 5);
  const fails = Object.keys(r).filter((k) => r[k] === false);
  if (r.errores.length) fails.push('errores');
  r.resultado = fails.length ? 'FALLO' : 'OK';
  if (fails.length) r.fallan = fails;
  console.log('GRUPOSBUZON ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_gruposbuzon.txt'), logs.join('\n'));
  try { await relay.stop(); } catch (e) {}
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error(e); fs.writeFileSync(path.join(__dirname, 'last_logs_gruposbuzon.txt'), logs.join('\n')); process.exit(1); });
