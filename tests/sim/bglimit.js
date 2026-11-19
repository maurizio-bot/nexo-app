// (cabecera copiada de fcmwake.js) FCM «despertador» tipo WhatsApp (#87, Fase 2b, plomería de la app). A y B se conocen (Bluetooth) y luego cada uno en
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


// 3247 (dueño 18-11, «Hazlo»): NEXO limitado por el ahorro de batería. B tiene el ahorro ACTIVO (alertSettings.battery=false).
//  (2) B lo dice en su saludo cifrado (lm:1) → A lo guarda y, en el chat con B, ve «B tiene NEXO limitado…»; cuando B lo
//      arregla, A deja de verlo. (3) A B le llegan mensajes atrasados (> 2 min) al volver a la app → aviso «Te llegaron … tarde»
//      con «Arreglarlo», que abre la pantalla de la batería aunque ya se hubiera pospuesto; un mensaje al día no avisa.
(async () => {
  const r1 = new NostrRelay(); RELAYS = [await r1.start()];
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', Object.assign({}, base, { wifi: 'casa' }));
  const nB = new NativePhone('B', 'BB:BB:BB:BB:BB:02', Object.assign({}, base, { wifi: 'oficina', alerts: { battery: false } }));
  [nA, nB].forEach((n) => { radio.add(n); n.load(); });
  const A = await boot('A', nA), B = await boot('B', nB);
  const idA = A.win.bleInterface.localNexoId.toLowerCase(), idB = B.win.bleInterface.localNexoId.toLowerCase();
  const r = { build: path.basename(buildDir) };
  const netA = A.win.bleInterface.net, netB = B.win.bleInterface.net;
  const $ = (p, id) => p.win.document.getElementById(id);
  // Fuera la pantalla de la batería de B (si sale al arrancar) diciendo que no a propósito
  const dropBat = async () => { for (let i = 0; i < 30; i++) { if ($(B, 'nexo-bat-skip')) { click(B.win, $(B, 'nexo-bat-skip')); await sleep(200); click(B.win, $(B, 'nexo-bat-skip-sure')); } await sleep(200); } };

  A.win.bleInterface.togglePanel(); const paired = await addFound(A, 'B'); A.win.bleInterface.togglePanel();
  if (!paired) { console.log('BGLIMIT ' + JSON.stringify({ resultado: 'FALLO', error: 'no empareja' })); process.exit(1); }
  await openChatWith(A, 'B'); sendText(A, 'hola B'); await sleep(2000);
  await openChatWith(B, 'A'); sendText(B, 'hola A'); await sleep(2000);
  radio.block(nA, nB);
  r.B_sabe_que_esta_limitado = await waitFor(() => B.win.NEXO_BG_LIMITED === true, 15000) !== null;
  netA.tick(); netB.tick();
  r.en_linea_s = await waitFor(() => A.win.bleInterface.linkOf(idB) === 'internet' && B.win.bleInterface.linkOf(idA) === 'internet', 60000);
  r.A_sabe_que_B_esta_limitado_s = await waitFor(() => !!(netA.state.peerLim && netA.state.peerLim[idB]), 30000);
  r.B_no_cree_que_A_lo_este = !(netB.state.peerLim && netB.state.peerLim[idA]);
  // (2) Línea en el chat de A con B
  await openChatWith(A, 'B');
  const note = await waitFor(() => { const el = $(A, 'nexo-peer-lim'); return el && el.style.display !== 'none' && /limitado/.test(el.textContent); }, 5000);
  r.A_ve_aviso_en_chat_de_B = note !== null;
  r.texto_aviso = ($(A, 'nexo-peer-lim') || {}).textContent || '';
  await openChatWith(B, 'A');
  r.B_no_ve_aviso_de_A = !(() => { const el = $(B, 'nexo-peer-lim'); return el && el.style.display !== 'none'; })();

  // (3) Mensajes atrasados en B (limitado): uno al día no avisa; uno de hace 5 min, sí
  await dropBat();
  B.win.document.dispatchEvent(new B.win.Event('visibilitychange')); await sleep(300); // «vuelve a la app»
  const fire = (id) => B.win.dispatchEvent(new B.win.CustomEvent('nexo:ble:messageReceived', { detail: { messageId: id, senderNexoId: idA, content: 'x' } }));
  fire('msg' + Date.now() + 'fresco1');
  await sleep(5000);
  r.al_dia_no_avisa = !$(B, 'nexo-late-note');
  fire('msg' + (Date.now() - 300000) + 'tarde01'); fire('msg' + (Date.now() - 240000) + 'tarde02');
  r.atrasados_avisan = await waitFor(() => !!$(B, 'nexo-late-note'), 8000) !== null;
  r.texto_tarde = ($(B, 'nexo-late-note') || {}).textContent || '';
  r.cuenta_dos = /2 mensajes/.test(r.texto_tarde);
  click(B.win, $(B, 'nexo-late-fix'));
  r.arreglarlo_abre_bateria = await waitFor(() => !!$(B, 'nexo-bat-allow'), 5000) !== null; // aunque ya se pospuso
  // B lo arregla → A deja de ver el aviso
  nB.alertFix = { battery: true };
  click(B.win, $(B, 'nexo-bat-allow'));
  await sleep(500); B.win.document.dispatchEvent(new B.win.Event('visibilitychange'));
  r.B_ya_no_limitado = await waitFor(() => B.win.NEXO_BG_LIMITED === false, 10000) !== null;
  r.A_lo_olvida_s = await waitFor(() => !(netA.state.peerLim && netA.state.peerLim[idB]), 30000);
  await openChatWith(A, 'B'); await sleep(400);
  r.A_ya_no_ve_aviso = !(() => { const el = $(A, 'nexo-peer-lim'); return el && el.style.display !== 'none'; })();
  r.registro = logs.filter((l) => /\[ENERGIA\]/.test(l)).map((l) => l.slice(0, 160)).slice(0, 6);
  r.errores = logs.filter((l) => / error: /.test(l) && !/JSDOMERROR|styles\.css|Not implemented/.test(l)).slice(0, 5);
  const ok = r.B_sabe_que_esta_limitado && r.en_linea_s !== null && r.A_sabe_que_B_esta_limitado_s !== null && r.B_no_cree_que_A_lo_este &&
    r.A_ve_aviso_en_chat_de_B && r.B_no_ve_aviso_de_A && r.al_dia_no_avisa && r.atrasados_avisan && r.cuenta_dos && r.arreglarlo_abre_bateria &&
    r.B_ya_no_limitado && r.A_lo_olvida_s !== null && r.A_ya_no_ve_aviso && !r.errores.length;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('BGLIMIT ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_bglimit.txt'), logs.join('\n'));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error(e); fs.writeFileSync(path.join(__dirname, 'last_logs_bglimit.txt'), logs.join('\n')); process.exit(1); });
