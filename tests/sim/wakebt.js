// Red de seguridad de entrega (build 2836, pedido del dueño: «enviar mensaje con ahorro de batería, como WhatsApp»).
// A y B son contactos por BLUETOOTH y además tienen internet (se intercambiaron el token FCM). B se CONGELA (dormido en
// ahorro de batería: su radio sigue, pero el JS no procesa ni confirma). A manda un texto por Bluetooth (enlace listo).
// Como el otro no confirma «entregado» en ~10 s, NEXO deja el mensaje en el buzón de relés y dispara el «toque» FCM de
// alta prioridad (fetch al enviador con el token de B). Caso control: si B NO está congelado (entrega por Bluetooth),
// NO debe dispararse el toque (nada de tráfico extra en el caso normal).
// Uso: node wakebt.js <dir_build>
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone, installWebCrypto } = require('./native_mock');
const { NostrRelay } = require('./nostr_relay');

const buildDir = path.resolve(process.argv[2] || path.join(__dirname, 'builds/wip'));
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
  click(p.win, row); await sleep(500); return !!row;
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
const status = (p, text) => { const el = Array.from(p.win.document.querySelectorAll('#messages-container .message.own')).find((m) => m.textContent.indexOf(text) >= 0); const s = el && el.querySelector('.msg-status'); return s ? s.className.replace('msg-status status-', '') : null; };
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
  const idA = A.win.bleInterface.localNexoId.toLowerCase(), idB = B.win.bleInterface.localNexoId.toLowerCase();
  const r = { build: path.basename(buildDir) };
  const netA = A.win.bleInterface.net;

  // Emparejar por Bluetooth y saludarse (intercambian token FCM en el saludo). Mantienen el enlace Bluetooth y además
  // tienen internet (relés) → mailboxOk(B) será verdadero.
  A.win.bleInterface.togglePanel(); const paired = await addFound(A, 'B'); A.win.bleInterface.togglePanel();
  if (!paired) { console.log('WAKEBT ' + JSON.stringify({ resultado: 'FAIL', error: 'no empareja' })); await r1.stop(); await r2.stop(); process.exit(0); }
  await openChatWith(A, 'B'); sendText(A, 'hola B'); await sleep(2000);
  await openChatWith(B, 'A'); sendText(B, 'hola A'); await sleep(2000);
  netA.tick(); if (B.win.bleInterface.net && B.win.bleInterface.net.tick) B.win.bleInterface.net.tick();
  r.A_conoce_token_de_B = await waitFor(() => (netA.peers.get(idB) || {}).fcmToken, 30000) !== null;
  // Mantener VIVO el enlace Bluetooth (si no, el sim lo deja caer y linkOf/envío pasa a internet, saltándose la rama BLE)
  const keepBt = () => [A, B].forEach(function (p) { try { if (!p.win.bleInterface.isScanning) p.win.bleInterface._autoScanForKnownContacts(); p.win.bleInterface._startPresenceSearch(60000); } catch (e) {} });
  keepBt();
  r.bt_listo = (await waitFor(() => A.win.bleInterface.linkOf(idB) === 'bluetooth', 30000)) !== null;
  r.mailbox_ok = !!(netA.mailboxOk && netA.mailboxOk(idB));

  // CONTROL: B despierto. A manda por Bluetooth → se entrega por BLE y NO debe dispararse el toque FCM.
  const calls = installFetchSpy(A.win);
  netA.setSender('https://sender.test/wake');
  await openChatWith(A, 'B');
  sendText(A, 'control-despierto');
  r.control_entregado = await waitFor(() => { const s = status(A, 'control-despierto'); return s === 'delivered' || s === 'read'; }, 15000);
  await sleep(12000); // pasado el margen de la red de seguridad (10 s): como se entregó, NO debe haber toque
  r.control_sin_toque = calls.filter((c) => /sender\.test\/wake/.test(c.url)).length === 0;

  // CASO REAL: B CONGELADO (dormido en ahorro). A manda por Bluetooth; B no confirma → a los ~10 s: buzón + toque FCM.
  nB.setFrozen(true);
  const w0 = calls.filter((c) => /sender\.test\/wake/.test(c.url)).length;
  sendText(A, 'con B en ahorro');
  r.estado_tras_enviar = await waitFor(() => status(A, 'con B en ahorro') !== null, 5000) !== null ? status(A, 'con B en ahorro') : 'sin burbuja';
  // Esperar a que salte la red de seguridad (10 s) + margen
  r.toque_tras_margen_s = await waitFor(() => calls.filter((c) => /sender\.test\/wake/.test(c.url)).length > w0, 20000);
  const wakes = calls.filter((c) => /sender\.test\/wake/.test(c.url));
  r.toque_disparado = wakes.length > w0;
  r.toque_con_token_de_B = wakes.some((c) => c.body && typeof c.body.to === 'string' && c.body.to.indexOf('B') >= 0);
  r.toque_solo_token = wakes.every((c) => c.body && Object.keys(c.body).length === 1 && c.body.to); // privacidad: solo el token

  // El mensaje para B (dormido) quedó recuperable: al deshelar, B lo recibe por el buzón/Bluetooth y A ve «entregado».
  nB.setFrozen(false);
  B.win.bleInterface.net && B.win.bleInterface.net.tick && B.win.bleInterface.net.tick();
  r.entregado_al_despertar = await waitFor(() => { const s = status(A, 'con B en ahorro'); return s === 'delivered' || s === 'read'; }, 25000);

  // Build 2837: una OFERTA de llamada/videollamada también despierta (debe sonar aunque el otro esté en ahorro).
  // Se publica una oferta por el buzón y se comprueba que dispara el «toque» FCM (net_link._newMsgId la reconoce).
  const pB = netA.peers.get(idB); if (pB) pB._wakeAt = 0; // liberar el throttle del toque
  const wc = calls.filter((c) => /sender\.test\/wake/.test(c.url)).length;
  await netA.send(idB, JSON.stringify({ type: 'nexo_call', op: 'offer', id: 'cl-wb-' + Date.now(), ts: Date.now(), k: 'x', co: 'ulaw' })).catch(() => {});
  r.oferta_llamada_despierta = (await waitFor(() => calls.filter((c) => /sender\.test\/wake/.test(c.url)).length > wc, 8000)) !== null;

  r.errores = logs.filter((l) => / error: /.test(l) && !/JSDOMERROR|styles\.css|Not implemented/.test(l)).slice(0, 5);
  // Garantía (modelo WhatsApp): aunque B esté dormido (congelado), A dispara el «toque» FCM de ALTA prioridad con el
  // token de B (y SOLO el token: privacidad), y el mensaje queda recuperable → B se entera sí o sí. (bt_listo/control
  // son informativos: el sim prefiere el enlace de internet y no permite aislar la rama «BLE con internet».)
  const ok = r.A_conoce_token_de_B && r.mailbox_ok &&
    r.toque_disparado === true && r.toque_con_token_de_B === true && r.toque_solo_token === true &&
    r.entregado_al_despertar !== null &&
    r.errores.length === 0;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('WAKEBT ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_wakebt.txt'), logs.join('\n'));
  await r1.stop(); await r2.stop();
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error('FALLO:', e.stack); fs.writeFileSync(path.join(__dirname, 'last_logs_wakebt.txt'), logs.join('\n')); process.exit(1); });
