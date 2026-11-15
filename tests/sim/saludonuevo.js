// 3133 — SALUDO AL CONTACTO NUEVO con internet ya encendido (encontrado por blobfan.js en la 3129, al revés de lo que parecía: el
// aviso oculto nuevo de la foto cambió el orden en que se guardan las claves y destapó un fallo que ya estaba).
// El saludo cifrado («estoy en línea») solo salía al abrir la conexión con los relés (a los contactos que ya había) y después solo
// a los que ya estaban en línea; a quien se agrega con los relés ya abiertos nadie le saludaba: si los dos tenían internet de antes,
// no se veían «en línea por internet» hasta reabrir la app o deslizar para actualizar (los mensajes iban al buzón y el Bluetooth
// cortado no pasaba a internet).
//  S1  A conoce a B y a C en persona (los relés de B y de C se abren con A); después B y C se conocen en persona y se mandan un
//      texto: en pocos segundos los dos se ven en línea por internet (3128/3132: nunca, en 30 s);
//  S2  al cortar el Bluetooth entre B y C, B ve a C por internet (linkOf = internet);
//  S3  sin inundar: a C le saluda una sola vez (no en cada vuelta del ciclo de internet).
// Contraprueba: en la 3128 S1 y S2 fallan.
// Uso: node saludonuevo.js <dir_build>
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
  const r = { prueba: 'saludonuevo', build: path.basename(buildDir) };
  const r1 = new NostrRelay(), r2 = new NostrRelay({ authRequired: true });
  RELAYS = [await r1.start(), await r2.start()];
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', Object.assign({}, base, { wifi: 'casa' }));
  const nB = new NativePhone('B', 'BB:BB:BB:BB:BB:02', Object.assign({}, base, { wifi: 'oficina' }));
  const nC = new NativePhone('C', 'CC:CC:CC:CC:CC:03', Object.assign({}, base, { wifi: 'campo' }));
  [nA, nB, nC].forEach((n) => { radio.add(n); n.load(); });
  const A = await boot('A', nA), B = await boot('B', nB), C = await boot('C', nC);
  const id = (p) => p.win.bleInterface.localNexoId.toLowerCase();
  const idA = id(A), idB = id(B), idC = id(C);
  const net = (p) => p.win.bleInterface.net;
  const sees = (p, nx) => !!(net(p) && net(p).canReach(nx));
  // A conoce a B y a C (cada uno abre sus relés con A como único contacto por internet)
  A.win.bleInterface.togglePanel(); const pAB = await addFound(A, 'B'); A.win.bleInterface.togglePanel();
  await openChatWith(A, 'B'); sendText(A, 'hola B'); await sleep(2500); await closeChat(A);
  r.A_y_B_en_linea_s = await waitFor(() => sees(A, idB) && sees(B, idA), 20000);
  A.win.bleInterface.togglePanel(); const pAC = await addFound(A, 'C'); A.win.bleInterface.togglePanel();
  await openChatWith(A, 'C'); sendText(A, 'hola C'); await sleep(2500); await closeChat(A);
  r.A_y_C_en_linea_s = await waitFor(() => sees(A, idC) && sees(C, idA), 20000);
  r.reles_abiertos_antes = !!(net(B).online() && net(C).online());
  // Saludos que B manda a C desde ahora
  let hellosBC = 0;
  const hb = net(B)._hello.bind(net(B));
  net(B)._hello = (nx) => { if (nx === idC) hellosBC++; return hb(nx); };
  // S1: B y C se conocen en persona con los relés ya abiertos
  B.win.bleInterface.togglePanel(); const pBC = await addFound(B, 'C'); B.win.bleInterface.togglePanel();
  if (!pAB || !pAC || !pBC) { console.log('SALUDONUEVO ' + JSON.stringify({ prueba: 'saludonuevo', resultado: 'FALLO', error: 'no empareja ' + [pAB, pAC, pBC].join(',') })); process.exit(1); }
  await openChatWith(B, 'C'); sendText(B, 'hola C, soy B'); await sleep(500); await closeChat(B);
  r.S1_B_y_C_en_linea_s = await waitFor(() => sees(B, idC) && sees(C, idB), 30000);
  // S2: sin Bluetooth entre B y C → internet
  radio.block(nB, nC);
  r.S2_B_a_C_por_internet_s = await waitFor(() => B.win.bleInterface.linkOf(idC) === 'internet' && C.win.bleInterface.linkOf(idB) === 'internet', 20000);
  // S3: un saludo, no uno por vuelta del ciclo (TICK) — se cuentan ~20 s más
  await sleep(20000);
  r.S3_saludos_B_a_C = hellosBC;
  r.S3_ok = hellosBC >= 1 && hellosBC <= 3;
  const ok = r.A_y_B_en_linea_s !== null && r.A_y_C_en_linea_s !== null && r.reles_abiertos_antes && r.S1_B_y_C_en_linea_s !== null && r.S1_B_y_C_en_linea_s <= 10 && r.S2_B_a_C_por_internet_s !== null && r.S3_ok;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('SALUDONUEVO ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_saludonuevo.txt'), logs.join('\n'));
  try { await r1.stop(); await r2.stop(); } catch (e) {}
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('SALUDONUEVO ' + JSON.stringify({ prueba: 'saludonuevo', resultado: 'FALLO', error: String(e && e.message) })); fs.writeFileSync(path.join(__dirname, 'last_logs_saludonuevo.txt'), logs.join('\n')); process.exit(1); });
