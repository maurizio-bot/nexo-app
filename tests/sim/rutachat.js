// 3147 — PREPARAR EL CAMINO AL ABRIR EL CHAT (dueño 16-11: «que al abrir un chat ya se prepare la mejor ruta y el envío sea
// instantáneo»). Antes, al abrir el chat solo se reenviaba lo pendiente, se pedía el «toque» FCM y se conectaba el Bluetooth si
// estaba cerca; por internet no se hacía nada: si la presencia del otro estaba caducada (él estuvo sin internet y volvió sin que yo
// me enterase), nadie saludaba y seguía «sin conexión» hasta su próximo mensaje.
//  R1  A y B se conocen, relés abiertos, sin Bluetooth entre ellos; la presencia de cada uno en el otro caduca. A abre el chat de
//      B: en pocos segundos A ve a B por internet (3145: nunca, en 10 s);
//  R2  el primer texto tras abrir sale sin esperar: ✓✓ medido desde que se pulsa enviar;
//  R3  tope: abrir y cerrar el chat 5 veces en 10 s → ≤ 2 saludos; al escribir (otra vez caducado) un saludo como mucho por 20 s,
//      y B vuelve a verse en línea.
// Uso: node rutachat.js <dir_build>
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone, installWebCrypto } = require('./native_mock');
const { NostrRelay } = require('./nostr_relay');

const buildDir = path.resolve(process.argv[2] || path.join(__dirname, 'builds/wip'));
const base = { readsContentFallback: true, retain: ['onPayloadReceived', 'onLanMessage', 'onLanUp', 'onLanDown'], closeOnNoService: true, pace: [15, 15], ioDelay: 25, asymmetric: true, noL2: true, noTor: true };
let RELAYS = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
class DistLoader extends ResourceLoader {
  constructor(dir) { super(); this.dir = dir; }
  fetch(url) { const f = path.join(this.dir, decodeURIComponent(new URL(url).pathname)); return fs.existsSync(f) ? Promise.resolve(fs.readFileSync(f)) : Promise.reject(new Error('no existe ' + f)); }
}
const logs = [];
async function boot(name, native) {
  native.listeners = new Map();
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
async function closeChat(p) { p.win.dispatchEvent(new p.win.CustomEvent('nexo:ble:closeChat', { detail: {} })); await sleep(300); }
function sendText(p, t) { const i = p.win.document.getElementById('message-input'); i.value = t; i.dispatchEvent(new p.win.Event('input', { bubbles: true })); click(p.win, p.win.document.getElementById('send-btn')); }
async function addFound(p, name) {
  let add = null;
  const find = () => { const row = Array.from(p.win.document.querySelectorAll('#ble-new-device > div')).find((d) => (d.querySelector('span') || {}).textContent === name); return row && row.querySelector('button'); };
  for (let i = 0; i < 400 && !add; i++) { await sleep(100); add = find(); if (!add && !p.win.bleInterface.isScanning) click(p.win, p.win.document.getElementById('ble-scan-btn')); }
  click(p.win, add); await sleep(2000);
  return !!add;
}
async function waitFor(fn, ms) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return Math.round((Date.now() - t0) / 100) / 10; await sleep(200); } return null; }

(async () => {
  const r = { prueba: 'rutachat', build: path.basename(buildDir) };
  const r1 = new NostrRelay(), r2 = new NostrRelay({ authRequired: true });
  RELAYS = [await r1.start(), await r2.start()];
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', Object.assign({}, base, { wifi: 'casa' }));
  const nB = new NativePhone('B', 'BB:BB:BB:BB:BB:02', Object.assign({}, base, { wifi: 'oficina' }));
  [nA, nB].forEach((n) => { radio.add(n); n.load(); });
  const A = await boot('A', nA), B = await boot('B', nB);
  const id = (p) => p.win.bleInterface.localNexoId.toLowerCase();
  const idA = id(A), idB = id(B);
  const net = (p) => p.win.bleInterface.net;
  const sees = (p, nx) => !!(net(p) && net(p).canReach(nx));
  A.win.bleInterface.togglePanel(); const pAB = await addFound(A, 'B'); A.win.bleInterface.togglePanel();
  if (!pAB) { console.log('RUTACHAT ' + JSON.stringify({ prueba: 'rutachat', resultado: 'FALLO', error: 'no empareja' })); process.exit(1); }
  await openChatWith(A, 'B'); sendText(A, 'hola B'); await sleep(2500); await closeChat(A);
  r.A_y_B_en_linea_s = await waitFor(() => sees(A, idB) && sees(B, idA), 20000);
  // Sin Bluetooth entre ellos (lejos): solo internet
  radio.block(nA, nB);
  await sleep(4000);
  // La presencia caduca en los dos (B estuvo sin internet y volvió sin que A se enterase): nadie saluda solo
  const stale = async () => {
    const now = Date.now();
    [[A, idB], [B, idA]].forEach(([p, nx]) => { const pe = net(p).peers.get(nx) || {}; pe.lastRx = now - 200000; pe.helloAt = now - 25000; net(p).peers.set(nx, pe); });
    await net(A).tick(); await net(B).tick();
  };
  await stale();
  r.caducado = !sees(A, idB) && !sees(B, idA);
  const probes = () => logs.filter((l) => l.indexOf('[A]') >= 0 && l.indexOf('[RUTA]') >= 0 && l.indexOf('saludo por internet') >= 0).length;
  // R1: abrir el chat → B por internet
  const p0 = probes();
  await openChatWith(A, 'B');
  r.R1_B_por_internet_tras_abrir_s = await waitFor(() => sees(A, idB), 10000);
  // R2: el primer texto sale sin esperar
  const t0 = Date.now();
  sendText(A, 'primer texto tras abrir');
  const lastStatus = () => { const s = Array.from(A.win.document.querySelectorAll('.msg-status')).pop(); const m = s && (s.className || '').match(/status-([a-z]+)/); return m ? m[1] : null; };
  r.R2_entregado_s = await waitFor(() => ['delivered', 'read'].includes(lastStatus()), 20000);
  r.R2_entregado_ms_desde_enviar = r.R2_entregado_s === null ? null : Date.now() - t0;
  await closeChat(A);
  r.R1_saludos_al_abrir = probes() - p0;
  // R3a: abrir y cerrar 5 veces en 10 s
  await sleep(21000);
  const p1 = probes();
  for (let i = 0; i < 5; i++) { await openChatWith(A, 'B'); await sleep(1200); await closeChat(A); }
  r.R3_saludos_5_aperturas = probes() - p1;
  // R3b: otra vez caducado, abrir y escribir (pasados 20 s del último saludo): un saludo como mucho y B vuelve
  await sleep(21000);
  await stale();
  await openChatWith(A, 'B');
  const p2 = probes();
  await sleep(25000); await stale(); // pasan 20 s del saludo de abrir; vuelve a caducar
  const p3 = probes();
  const inp = A.win.document.getElementById('message-input');
  for (const v of ['h', 'ho', 'hol', 'hola']) { inp.value = v; inp.dispatchEvent(new A.win.Event('input', { bubbles: true })); await sleep(300); }
  r.R3_B_vuelve_al_escribir_s = await waitFor(() => sees(A, idB), 10000);
  for (const v of ['hola q', 'hola qu', 'hola que']) { inp.value = v; inp.dispatchEvent(new A.win.Event('input', { bubbles: true })); await sleep(300); }
  r.R3_saludos_al_escribir = probes() - p3;
  r.R3_saludos_al_abrir_2 = p3 - p2;
  r.estadistica_ruta = logs.some((l) => l.indexOf('[A]') >= 0 && l.indexOf('[VELOCIDAD] internet al abrir el chat listo') >= 0);
  const ok = r.A_y_B_en_linea_s !== null && r.caducado && r.R1_B_por_internet_tras_abrir_s !== null && r.R1_B_por_internet_tras_abrir_s <= 5 &&
    r.R2_entregado_s !== null && r.R2_entregado_ms_desde_enviar <= 5000 && r.R3_saludos_5_aperturas <= 2 && r.R3_saludos_al_escribir <= 1 && r.R3_B_vuelve_al_escribir_s !== null;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('RUTACHAT ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_rutachat.txt'), logs.join('\n'));
  try { await r1.stop(); await r2.stop(); } catch (e) {}
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('RUTACHAT ' + JSON.stringify({ prueba: 'rutachat', resultado: 'FALLO', error: String(e && e.message) })); fs.writeFileSync(path.join(__dirname, 'last_logs_rutachat.txt'), logs.join('\n')); process.exit(1); });
