// #dueño 06-11 — TOR DIRECTO para archivos GRANDES por internet (paso 2b, parte JS). Los relés no aguantan ~25 MB; el
// camino fiable para un archivo grande por internet es Tor DIRECTO (conexión .onion entre los dos, sin relés, sin tope).
// Antes el envío de archivo por internet NO pedía Tor (solo las llamadas lo hacían con ensureTor); ahora:
//   - el que ENVÍA un archivo > ~12 MB marca al contacto (net.preferTorFor) y arranca Tor a demanda (ensureTor);
//   - el que RECIBE un archivo grande (muchos trozos) arranca Tor (ensureTor) al confirmar bloques;
//   - net.send prefiere Tor para ese contacto (_torPreferred) → con los dos despiertos (latido 2930/2931) se forma el
//     Tor directo y el archivo va por ahí. No hace nada si el usuario apagó Tor (ensureTor respeta state.tor===false).
//   - lo CHICO/mediano (fotos, ≤ ~12 MB) sigue por relés (rápido), y un TEXTO por net no arranca Tor.
// Prueba DETERMINISTA (como bigwake): comprueba la DECISIÓN de preferir/encender Tor; el transporte real por Tor ya lo
// cubre bignet.js --tor, y los tiempos reales de Tor se validan en los teléfonos.
// Uso: node bigtor.js <dir_build>
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone, installWebCrypto } = require('./native_mock');
const { NostrRelay } = require('./nostr_relay');

const buildDir = path.resolve(process.argv[2]);
const base = { readsContentFallback: true, retain: ['onPayloadReceived', 'onLanMessage', 'onLanUp', 'onLanDown'], closeOnNoService: true, pace: [15, 15], ioDelay: 25, asymmetric: true, noTor: true };
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
  ['log', 'warn', 'error'].forEach((l) => vc.on(l, (...a) => logs.push(`${new Date().toISOString().substring(14, 23)} [${name}] ${l}: ` + a.map(String).join(' ').substring(0, 250))));
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
  click(p.win, row); await sleep(400); return !!row;
}
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
  const r1 = new NostrRelay(), r2 = new NostrRelay({ authRequired: true });
  RELAYS = [await r1.start(), await r2.start()];
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', Object.assign({}, base, { wifi: 'casa' })), nB = new NativePhone('B', 'BB:BB:BB:BB:BB:02', Object.assign({}, base, { wifi: 'oficina' }));
  [nA, nB].forEach((n) => { radio.add(n); n.load(); });
  const A = await boot('A', nA), B = await boot('B', nB);
  const biA = A.win.bleInterface, AS = biA.ackSystem, netA = biA.net;
  const ASB = B.win.bleInterface.ackSystem, netB = B.win.bleInterface.net;
  const idA = biA.localNexoId.toLowerCase(), idB = B.win.bleInterface.localNexoId.toLowerCase();
  const r = { build: path.basename(buildDir) };

  biA.togglePanel(); const paired = await addFound(A, 'B'); biA.togglePanel();
  if (!paired) { console.log('BIGTOR ' + JSON.stringify({ resultado: 'FALLO', error: 'no empareja' })); process.exit(0); }
  await openChatWith(A, 'B'); sendText(A, 'hola B'); await sleep(1500);
  await openChatWith(B, 'A'); sendText(B, 'hola A'); await sleep(1500);
  radio.block(nA, nB);   // cada uno a su casa: solo internet
  netA.tick(); netB.tick();
  r.en_internet_s = await waitFor(() => biA.linkOf(idB) === 'internet' && B.win.bleInterface.linkOf(idA) === 'internet', 60000);

  // Umbral «grande» bajo para la prueba (no alocar 12 MB): > 50 000 car. = grande.
  A.win.NEXO_NET_TOR_PREFER_BYTES = 50000;
  // Espía de preferTorFor en A
  const prefCalls = [];
  const origPref = netA.preferTorFor.bind(netA);
  netA.preferTorFor = function (nx, ttl) { prefCalls.push(String(nx || '').toLowerCase()); return origPref(nx, ttl); };

  // Se prueba la DECISIÓN en el camino REAL del archivo por internet (_sendFileBest con un enlace net:), de forma
  // determinista (como filetinymtu/bigwake) sin depender de cómo el resolvedor elige el enlace. bignet.js confirma que
  // un archivo por internet pasa por este camino (los 5/12 MB llegan por net).
  var netDev = 'net:' + idB;
  // (1) archivo CHICO por internet (< umbral) → NO marca Tor (sigue por relés, rápido)
  prefCalls.length = 0;
  try { AS._sendFileBest(netDev, 'chico1', 'A'.repeat(10000), { type: 'file', dst: idB }).catch(function () {}); } catch (e) {}
  await sleep(200);
  r.chico_no_prefiere_tor = prefCalls.indexOf(idB) < 0;
  // (2) archivo GRANDE por internet (> umbral) → marca al contacto para Tor
  prefCalls.length = 0;
  try { AS._sendFileBest(netDev, 'grande1', 'A'.repeat(60000), { type: 'file', dst: idB }).catch(function () {}); } catch (e) {}
  await sleep(200);
  r.grande_prefiere_tor = prefCalls.indexOf(idB) >= 0;

  // (3) preferTorFor marca SOLO a ese contacto, y send() lo leería (_torPreferred)
  netA._torPref = null;                       // limpiar
  r.antes_no_preferido = netA._torPreferred(idB) === false;
  origPref(idB, 600000);                       // marcar (sin pasar por el espía)
  r.torpref_marca_contacto = netA._torPreferred(idB) === true;
  r.torpref_solo_ese_contacto = netA._torPreferred('nx00000000') === false;

  // (4) el que RECIBE: un archivo GRANDE (muchos trozos) por internet arranca Tor (ensureTor); uno chico NO
  let torB = 0; const origEnsure = netB.ensureTor.bind(netB);
  netB.ensureTor = function () { torB++; return origEnsure(); };
  const fileBufBig = { isChat: false, total: 2000, chunks: new Map([[0, 'x']]) };
  const fileBufSmall = { isChat: false, total: 10, chunks: new Map([[0, 'x']]) };
  const b0 = torB; ASB._sendBlockAck('net:' + idA, 'rxbig', fileBufBig); await sleep(40);
  r.rx_grande_enciende_tor = torB > b0;
  const b1 = torB; ASB._sendBlockAck('net:' + idA, 'rxsmall', fileBufSmall); await sleep(40);
  r.rx_chico_no_enciende_tor = torB === b1;

  r.errores = logs.filter((l) => / error: /.test(l) && !/JSDOMERROR|styles\.css|Not implemented|GLOBAL TIMEOUT/.test(l)).slice(0, 5);
  const ok = r.en_internet_s !== null &&
    r.chico_no_prefiere_tor && r.grande_prefiere_tor &&
    r.antes_no_preferido && r.torpref_marca_contacto && r.torpref_solo_ese_contacto &&
    r.rx_grande_enciende_tor && r.rx_chico_no_enciende_tor && r.errores.length === 0;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('BIGTOR ' + JSON.stringify(r));
  if (!ok) console.log(logs.slice(-40).join('\n'));
  fs.writeFileSync(path.join(__dirname, 'last_logs_bigtor.txt'), logs.join('\n'));
  try { await r1.stop(); await r2.stop(); } catch (e) {}
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('BIGTOR {"resultado":"FALLO","error":"' + String(e && e.message) + '"}'); console.log(logs.slice(-30).join('\n')); fs.writeFileSync(path.join(__dirname, 'last_logs_bigtor.txt'), logs.join('\n')); process.exit(1); });
