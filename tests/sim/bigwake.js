// #dueño 06-11 — LATIDO de despertador para un ARCHIVO GRANDE por INTERNET (idea del dueño). Mientras se manda un
// archivo grande por internet a alguien que puede estar DORMIDO (otro país, datos móviles, app en segundo plano), cada
// vez que el envío NO avanza se le re-dispara el «toque» FCM para que su app vuelva, siga recibiendo y confirme — así
// los dos se mantienen despiertos hasta terminar. El toque es SPARSE (como mucho 1 cada XFER_WAKE_MIN_MS=15 s, con su
// propio throttle), para NO gastar la cuota de FCM: NO es un toque por trozo. Cuando el envío fluye no hay timeout de
// ventana → no hay toques.
//
// Prueba DETERMINISTA (como filetinymtu): coge un ChatStream REAL de archivo por net:, lo congela y dispara
// _onWindowTimeout a mano (ventana sin ACK = estancado), comprobando que:
//  (1) un archivo por net estancado dispara el latido (wakeKeepAlive → un POST al enviador con el token del contacto);
//  (2) está THROTTLEADO: varios timeouts pegados = UN solo toque; pasado el tope, otro → nunca un toque por trozo;
//  (3) NO dispara por Bluetooth (otra cola) ni por un texto (chat) por net — solo archivos por internet;
//  (4) el toque lleva SOLO el token (privacidad), nunca el contenido.
// El despertar real del teléfono dormido y los tiempos de Android se validan en el móvil (acá no hay Android).
// Uso: node bigwake.js <dir_build>
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
const isNet = (d) => { d = (d || '').toString().toLowerCase(); return d.indexOf('net:') === 0 || /^netnx[0-9a-z]{8}$/.test(d); };
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
function installFetchSpy(win) {
  const calls = [];
  win.fetch = function (url, opts) {
    let body = null; try { body = opts && opts.body ? JSON.parse(opts.body) : null; } catch (e) {}
    calls.push({ url: String(url), body: body });
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true }) });
  };
  return calls;
}

(async () => {
  const r1 = new NostrRelay(), r2 = new NostrRelay({ authRequired: true });
  RELAYS = [await r1.start(), await r2.start()];
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', Object.assign({}, base, { wifi: 'casa' })), nB = new NativePhone('B', 'BB:BB:BB:BB:BB:02', Object.assign({}, base, { wifi: 'oficina' }));
  [nA, nB].forEach((n) => { radio.add(n); n.load(); });
  const A = await boot('A', nA), B = await boot('B', nB);
  const biA = A.win.bleInterface, AS = biA.ackSystem, netA = biA.net, netB = B.win.bleInterface.net;
  const idA = biA.localNexoId.toLowerCase(), idB = B.win.bleInterface.localNexoId.toLowerCase();
  const TOKB = 'FCMTOK-B-0000000000000000000000000000';
  const r = { build: path.basename(buildDir) };

  // Se conocen por Bluetooth y se saludan
  biA.togglePanel(); const paired = await addFound(A, 'B'); biA.togglePanel();
  if (!paired) { console.log('BIGWAKE ' + JSON.stringify({ resultado: 'FALLO', error: 'no empareja' })); process.exit(0); }
  await openChatWith(A, 'B'); sendText(A, 'hola B'); await sleep(1500);
  await openChatWith(B, 'A'); sendText(B, 'hola A'); await sleep(1500);

  // Cada uno a su casa (solo internet) → se intercambian el token FCM (body.f)
  radio.block(nA, nB);
  netA.tick(); netB.tick();
  r.en_internet_s = await waitFor(() => biA.linkOf(idB) === 'internet', 60000);
  r.token_intercambiado_s = await waitFor(() => { const p = netA.peers.get(idB); return p && p.fcmToken === TOKB; }, 40000);

  // Enviador de mentira + espía de fetch (el «toque» es un POST al enviador)
  const calls = installFetchSpy(A.win);
  netA.setSender('https://sender.test/wake');
  const peerB = netA.peers.get(idB);
  const nWake = () => calls.filter((c) => /sender\.test\/wake/.test(c.url)).length;

  // B "sordo": su app está dormida, no procesa eventos de internet → nunca confirma (fuerza el estancamiento)
  netB._onEvent = async function () {};

  // Coger un ChatStream REAL de archivo por internet y congelarlo (como filetinymtu), para disparar _onWindowTimeout a mano
  await openChatWith(A, 'B');
  const bigB64 = 'A'.repeat(400000);   // archivo grande (multi-ventana por net: 16000/trozo)
  biA.sendFile(idB, 'bigwake1', bigB64, { type: 'file', to: idB, dst: idB, fileName: 'g.bin' });
  let st = null;
  for (let i = 0; i < 300 && !st; i++) {
    await sleep(20);
    (AS.outgoingStreams || new Map()).forEach((s) => { if (!st && s && s.type === 'file') st = s; });
  }
  r.hay_stream_net = !!st && isNet(st.deviceId);
  if (!st) { console.log('BIGWAKE ' + JSON.stringify(Object.assign(r, { resultado: 'FALLO', why: 'no stream' }))); fs.writeFileSync(path.join(__dirname, 'last_logs_bigwake.txt'), logs.join('\n')); process.exit(1); }
  try { clearTimeout(st.timer); } catch (e) {} try { clearTimeout(st.globalTimeout); } catch (e) {}
  st._sendChunk = function () { return Promise.resolve(); };
  st._retransmitWindow = function () {}; st._startWindowTimer = function () {};
  await sleep(400); // drenar cualquier temporizador en vuelo del flujo real antes de disparar a mano

  // Disparar una ventana SIN ACK (estancado), con el enlace "caído" para no tocar la maquinaria de reintentos
  const drive = () => {
    st.aborted = false; st.deviceId = 'net:' + idB; st.type = 'file';
    st.meta = Object.assign({}, st.meta, { dst: idB });
    st._windowStartAtSend = 0; st._windowEndAtSend = 4; st.ackedMask = []; st.windowStart = 0;
    st.windowRetryCount = 0; st.maxWindowRetries = 50; st._linkUp = function () { return false; };
    st._onWindowTimeout();
  };

  // (1) Un archivo por internet ESTANCADO dispara el latido (sin throttle)
  A.win.NEXO_XFER_WAKE_MS = 0; if (peerB) peerB._xferWakeAt = 0;
  const w0 = nWake(); drive(); await sleep(60);
  r.net_estancado_dispara = nWake() === w0 + 1;
  const wk = calls.filter((c) => /sender\.test\/wake/.test(c.url));
  r.toque_con_token_de_B = wk.some((c) => c.body && c.body.to === TOKB);
  r.toque_solo_token = wk.length > 0 && wk.every((c) => c.body && Object.keys(c.body).length === 1 && c.body.to); // privacidad

  // (2) THROTTLE (lo contrario de "un toque por trozo"): 3 timeouts pegados con el tope real = UN solo toque…
  A.win.NEXO_XFER_WAKE_MS = 15000; if (peerB) peerB._xferWakeAt = 0;
  const w1 = nWake(); drive(); await sleep(20); drive(); await sleep(20); drive(); await sleep(20);
  r.throttle_un_solo_toque = nWake() === w1 + 1;
  // …y pasado el tope (simulamos que pasaron > 15 s), vuelve a disparar → se mantiene despierto hasta terminar
  if (peerB) peerB._xferWakeAt = Date.now() - 20000;
  const w2 = nWake(); drive(); await sleep(40);
  r.pasado_el_tope_otro_toque = nWake() === w2 + 1;

  // (3) Alcance: NO dispara por Bluetooth (otra cola, no aplica) ni por un TEXTO (chat) por net — solo archivos por net
  A.win.NEXO_XFER_WAKE_MS = 0; if (peerB) peerB._xferWakeAt = 0;
  const wb = nWake();
  st.aborted = false; st.deviceId = 'BB:BB:BB:BB:BB:02'; st.type = 'file';
  st._windowStartAtSend = 0; st._windowEndAtSend = 4; st.ackedMask = []; st.windowStart = 0; st.windowRetryCount = 0; st.maxWindowRetries = 50; st._linkUp = function () { return false; };
  st._onWindowTimeout(); await sleep(40);
  r.bluetooth_no_dispara = nWake() === wb;
  if (peerB) peerB._xferWakeAt = 0;
  const wc = nWake();
  st.aborted = false; st.deviceId = 'net:' + idB; st.type = 'chat';
  st._windowStartAtSend = 0; st._windowEndAtSend = 4; st.ackedMask = []; st.windowStart = 0; st.windowRetryCount = 0; st.maxWindowRetries = 50; st._linkUp = function () { return false; };
  st._onWindowTimeout(); await sleep(40);
  r.net_chat_no_dispara = nWake() === wc;

  // --- PASO 2 (latido de VUELTA): el que RECIBE un archivo por internet le devuelve el «toque» al que ENVÍA, para que
  //     el que envía tampoco se duerma a mitad del envío. Mismo throttle (15 s), solo token, solo archivos por net. ---
  const TOKA = 'FCMTOK-A-0000000000000000000000000000';
  const ASB = B.win.bleInterface.ackSystem;
  const callsB = installFetchSpy(B.win);
  netB.setSender('https://sender.test/wakeB');
  const nWakeB = () => callsB.filter((c) => /sender\.test\/wakeB/.test(c.url)).length;
  const peerA = netB.peers.get(idA);
  r.B_conoce_token_de_A = !!(peerA && peerA.fcmToken === TOKA);
  const fileBuf = { isChat: false, total: 4, chunks: new Map([[0, 'x']]) };
  const chatBuf = { isChat: true, total: 4, chunks: new Map([[0, 'x']]) };
  // (a) recibir un archivo por net → devuelve el toque al que envía (token de A), solo el token
  B.win.NEXO_XFER_WAKE_MS = 0; if (peerA) peerA._xferWakeAt = 0;
  const b0 = nWakeB(); ASB._sendBlockAck('net:' + idA, 'rxf1', fileBuf); await sleep(60);
  r.rx_echo_dispara = nWakeB() > b0;
  const wkB = callsB.filter((c) => /sender\.test\/wakeB/.test(c.url));
  r.rx_echo_solo_token = wkB.length > 0 && wkB.every((c) => c.body && Object.keys(c.body).length === 1 && c.body.to === TOKA);
  // (b) throttle: confirmar otro bloque enseguida (tope real) NO repite el toque → no es un toque por bloque
  B.win.NEXO_XFER_WAKE_MS = 15000; if (peerA) peerA._xferWakeAt = Date.now();
  const b1 = nWakeB(); ASB._sendBlockAck('net:' + idA, 'rxf1', fileBuf); await sleep(30);
  r.rx_echo_throttle = nWakeB() === b1;
  // (c) un TEXTO (chat) por net NO devuelve toque; un archivo por BLUETOOTH tampoco
  B.win.NEXO_XFER_WAKE_MS = 0; if (peerA) peerA._xferWakeAt = 0;
  const b2 = nWakeB(); ASB._sendBlockAck('net:' + idA, 'rxc1', chatBuf); await sleep(30);
  r.rx_chat_no_devuelve = nWakeB() === b2;
  if (peerA) peerA._xferWakeAt = 0;
  const b3 = nWakeB(); ASB._sendBlockAck('AA:AA:AA:AA:AA:01', 'rxf2', fileBuf); await sleep(30);
  r.rx_bluetooth_no_devuelve = nWakeB() === b3;

  r.errores = logs.filter((l) => / error: /.test(l) && !/JSDOMERROR|styles\.css|Not implemented|GLOBAL TIMEOUT/.test(l)).slice(0, 5);
  const ok = r.en_internet_s !== null && r.token_intercambiado_s !== null && r.hay_stream_net &&
    r.net_estancado_dispara && r.toque_con_token_de_B && r.toque_solo_token &&
    r.throttle_un_solo_toque && r.pasado_el_tope_otro_toque &&
    r.bluetooth_no_dispara && r.net_chat_no_dispara &&
    r.B_conoce_token_de_A && r.rx_echo_dispara && r.rx_echo_solo_token && r.rx_echo_throttle &&
    r.rx_chat_no_devuelve && r.rx_bluetooth_no_devuelve && r.errores.length === 0;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('BIGWAKE ' + JSON.stringify(r));
  if (!ok) console.log(logs.slice(-40).join('\n'));
  fs.writeFileSync(path.join(__dirname, 'last_logs_bigwake.txt'), logs.join('\n'));
  try { await r1.stop(); await r2.stop(); } catch (e) {}
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('BIGWAKE {"resultado":"FALLO","error":"' + String(e && e.message) + '"}'); console.log(logs.slice(-30).join('\n')); fs.writeFileSync(path.join(__dirname, 'last_logs_bigwake.txt'), logs.join('\n')); process.exit(1); });
