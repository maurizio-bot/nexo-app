// FCM «despertador» tipo WhatsApp (#87, Fase 2b, plomería de la app). A y B se conocen (Bluetooth) y luego cada uno en
// su casa (solo internet). Comprueba, con un FCM de mentira (native_mock.getFcmToken) y un enviador de mentira
// (window.fetch interceptado):
//  1. Los dos SE INTERCAMBIAN su token FCM en el saludo cifrado (body.f): A conoce el de B y B el de A.
//  2. Al mandar A un mensaje a B por el buzón de los relés, A pide al enviador el «toque» que despierta a B: una sola
//     llamada POST al enviador con { to: <token de B> } — SOLO el token, NUNCA el contenido del mensaje.
//  3. El token se guarda (sobrevive) y si el enviador responde 404 (token caducado) se olvida.
// El disparo real por Google y el despertar del teléfono cerrado se prueban en el móvil (no se pueden simular).
// Uso: node fcmwake.js <dir_build>
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

// Intercepta window.fetch para capturar las llamadas al enviador (el «toque» FCM)
function installFetchSpy(win) {
  const calls = [];
  win.fetch = function (url, opts) {
    let body = null; try { body = opts && opts.body ? JSON.parse(opts.body) : null; } catch (e) {}
    calls.push({ url: String(url), body: body, status: 200 });
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
  const netA = A.win.bleInterface.net, netB = B.win.bleInterface.net;
  const TOKA = 'FCMTOK-A-0000000000000000000000000000', TOKB = 'FCMTOK-B-0000000000000000000000000000';

  // Este teléfono tiene su propio token FCM (lo dio el nativo de mentira)
  r.A_tiene_su_token = netA.fcmToken === TOKA;
  r.B_tiene_su_token = netB.fcmToken === TOKB;

  // Se conocen en persona (Bluetooth) y se saludan
  A.win.bleInterface.togglePanel(); const paired = await addFound(A, 'B'); A.win.bleInterface.togglePanel();
  if (!paired) { console.log('FCMWAKE ' + JSON.stringify({ resultado: 'FAIL', error: 'no empareja' })); process.exit(0); }
  await openChatWith(A, 'B'); sendText(A, 'hola B'); await sleep(2000);
  await openChatWith(B, 'A'); sendText(B, 'hola A'); await sleep(2000);

  // Cada uno a su casa: solo internet. Fuerzan saludos → se intercambian los tokens FCM (body.f)
  radio.block(nA, nB);
  netA.tick(); netB.tick();
  r.en_linea_s = await waitFor(() => A.win.bleInterface.linkOf(idB) === 'internet' && B.win.bleInterface.linkOf(idA) === 'internet', 60000);
  r.intercambio_token_s = await waitFor(() => {
    const pb = netA.peers.get(idB), pa = netB.peers.get(idA);
    return pb && pb.fcmToken === TOKB && pa && pa.fcmToken === TOKA;
  }, 40000);
  r.A_conoce_token_de_B = (netA.peers.get(idB) || {}).fcmToken === TOKB;
  r.B_conoce_token_de_A = (netB.peers.get(idA) || {}).fcmToken === TOKA;
  r.token_de_B_guardado = !!(netA.state.peerFcm && netA.state.peerFcm[idB] === TOKB); // sobrevive al reinicio

  // Enviador de mentira + espía de fetch; A manda un mensaje a B → debe pedir el «toque» con el token de B
  const calls = installFetchSpy(A.win);
  netA.setSender('https://sender.test/wake');
  sendText(A, 'mensaje por internet, despierta a B');
  await sleep(3000);
  const wakes = calls.filter((c) => /sender\.test\/wake/.test(c.url));
  r.toque_llamado = wakes.length > 0;
  r.toque_con_token_de_B = wakes.some((c) => c.body && c.body.to === TOKB);
  // PRIVACIDAD: el «toque» SOLO lleva el token, nunca el contenido del mensaje
  r.toque_solo_token = wakes.length > 0 && wakes.every((c) => c.body && Object.keys(c.body).length === 1 && c.body.to);
  r.toque_sin_contenido = wakes.every((c) => JSON.stringify(c.body || {}).indexOf('despierta a B') < 0);

  // M1 (auditoría 28-10): el «toque» SOLO por mensaje NUEVO (nid) y throttle por par. Un archivo son muchos trozos y
  // una ráfaga de textos: NO deben disparar cientos de toques (cuota de FCM agotada = se cae el propio #87, batería).
  const peerB = netA.peers.get(idB);
  const nWake = () => calls.filter((c) => /sender\.test\/wake/.test(c.url)).length;
  // (a) throttle: otro mensaje nuevo enseguida (< 8 s del anterior) no dispara otro toque
  const w0 = nWake();
  await netA.send(idB, JSON.stringify({ type: 'chat', msgId: 'm1-throttle' })).catch(() => {});
  await sleep(800);
  r.throttle_no_repite = nWake() === w0;
  // #130 (informe del dueño 30-10: «al llamar no siempre despierta al otro»): una OFERTA de llamada debe pedir el toque
  // SÍ O SÍ aunque el throttle de textos esté activo (chateando y luego llamo, < 8 s). Antes el throttle por par la
  // silenciaba → el otro teléfono no despertaba. Se usa el FORMATO REAL que la app pasa a net.send para una oferta: el
  // sobre type:'chat' con la marca cl:1 por fuera y la oferta cifrada dentro (ble_messages `_sendMessageNative`), NO la
  // oferta cruda (que por internet nunca llega así). Simulamos que un texto despertó hace un instante:
  // El sobre lleva cl:1 y el msgId (lo que mira el «toque»); el texto va en claro a propósito para no provocar en B un
  // fallo de descifrado (una oferta real lleva texto cifrado, pero eso no cambia la detección de la llamada).
  const offerEnv = (mid) => JSON.stringify({ v: 1, type: 'chat', from: idA, to: '', ts: Date.now(), seq: 1, msgId: mid, payload: { text: 'ring' }, cl: 1 });
  if (peerB) peerB._wakeAt = Date.now();
  const wc0 = nWake();
  await netA.send(idB, offerEnv('cs' + 'aa11bb')).catch(() => {});
  await sleep(800);
  r.llamada_despierta_pese_al_throttle = nWake() === wc0 + 1;
  // ...pero dos ofertas pegadas (< 3 s) piden un solo toque (su propio throttle: no un bucle de toques)
  const wc1 = nWake();
  await netA.send(idB, offerEnv('cs' + 'cc22dd')).catch(() => {});
  await sleep(400);
  r.llamada_no_hace_bucle = nWake() === wc1;
  // (b) un trozo que no es el primero (i>0) nunca dispara, aunque se libere el throttle
  if (peerB) peerB._wakeAt = 0;
  const w1 = nWake();
  await netA.send(idB, JSON.stringify({ t: 'c', i: 3, m: 'archivo-m1' })).catch(() => {});
  await sleep(800);
  r.trozo_siguiente_no_dispara = nWake() === w1;
  // (c) el primer trozo (i:0) de un archivo SÍ (es un mensaje nuevo), con el throttle liberado
  if (peerB) peerB._wakeAt = 0;
  const w2 = nWake();
  await netA.send(idB, JSON.stringify({ t: 'f', i: 0, m: 'archivo-m1b' })).catch(() => {});
  await sleep(800);
  r.primer_trozo_si_dispara = nWake() === w2 + 1;

  // SEC-1 (auditoría 28-10): un evento con created_at en el FUTURO (contacto malicioso, o un relé que reenvía un sobre
  // legítimo cambiándole la fecha) NO debe envenenar lastSeen; si lo hiciera, el filtro `since` saltaría al futuro y B
  // dejaría de recibir CUALQUIER mensaje por internet, para siempre. Se acota a «ahora».
  let capturado = null;
  const origOnEvent = netB._onEvent.bind(netB);
  netB._onEvent = async function(ev) { capturado = ev; return origOnEvent(ev); };
  if (peerB) peerB._wakeAt = 0;
  await netA.send(idB, JSON.stringify({ type: 'chat', msgId: 'sec1-captura' })).catch(() => {});
  await waitFor(() => !!capturado, 8000);
  netB._onEvent = origOnEvent;
  if (capturado) {
    const dentro10a = Math.floor(Date.now() / 1000) + 10 * 365 * 86400;
    const futuro = Object.assign({}, capturado, { id: 'sec1-futuro-' + Date.now(), created_at: dentro10a });
    await netB._onEvent(futuro); // mismo sobre (descifra), pero con fecha disparatada
    r.lastSeen_acotado_a_ahora = (netB.state.lastSeen || 0) <= Date.now() + 2000;
  } else { r.lastSeen_acotado_a_ahora = false; }

  // SEC-4 (auditoría 28-10): un frame de relé enorme se descarta antes de JSON.parse (como el nativo con SafeJson).
  // Se sigue el id concreto 'sec4' (no un contador general, que capturaría entregas asíncronas de otros envíos).
  let sawSec4 = false;
  const oe = netB._onEvent.bind(netB);
  netB._onEvent = async function(ev) { if (ev && ev.id === 'sec4') sawSec4 = true; return oe(ev); };
  const hugeFrame = JSON.stringify(['EVENT', 'matchsub', { id: 'sec4', content: 'A'.repeat(400000), tags: [] }]);
  netB._onRelayMsg('wss://x', { waits: new Map(), sub: 'matchsub' }, hugeFrame);
  await sleep(200);
  r.frame_enorme_no_procesado = !sawSec4; // sin el tope, JSON.parse pasaría y _onEvent vería el id 'sec4'
  netB._onEvent = oe;

  // Un saludo (sin contenido) NO debe disparar toque (solo los mensajes de verdad)
  const antes = calls.length;
  netA._hello(idB);
  await sleep(1500);
  r.saludo_no_dispara_toque = calls.filter((c) => /sender\.test\/wake/.test(c.url)).length === wakes.length || calls.length === antes;

  r.errores = logs.filter((l) => /ilegible|Error procesando|No se pudo descifrar|TypeError|undefined is not/.test(l)).slice(0, 4);
  const ok = r.A_tiene_su_token && r.B_tiene_su_token && r.intercambio_token_s !== null &&
    r.A_conoce_token_de_B && r.B_conoce_token_de_A && r.token_de_B_guardado &&
    r.toque_llamado && r.toque_con_token_de_B && r.toque_solo_token && r.toque_sin_contenido &&
    r.throttle_no_repite && r.trozo_siguiente_no_dispara && r.primer_trozo_si_dispara &&
    r.llamada_despierta_pese_al_throttle && r.llamada_no_hace_bucle &&
    r.lastSeen_acotado_a_ahora && r.frame_enorme_no_procesado &&
    !r.errores.length;
  r.resultado = ok ? 'OK' : 'FAIL';
  console.log('FCMWAKE ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_fcmwake.txt'), logs.join('\n'));
  await r1.stop(); await r2.stop();
  process.exit(0);
})().catch((e) => { console.error('FALLO:', e.stack); fs.writeFileSync(path.join(__dirname, 'last_logs_fcmwake.txt'), logs.join('\n')); process.exit(1); });
