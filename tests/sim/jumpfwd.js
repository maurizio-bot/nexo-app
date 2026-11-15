// 3125 (diagnóstico automático S24 3059, 15-11 00:08, «zombi …db61»): el S24 llevaba un archivo suyo a un contacto lejano POR un
// puente Jump (la cola de saltos: forwardStream con meta.dst) un TEXTO largo suyo (msg…ue4eus06, 8 trozos por ventana) y la app
// del puente dormía: la ventana 0 se reenviaba entera cada 12 s (reintento 6 al volver la app) sin un trozo confirmado. La regla
// 3021 (soltar un puente que no confirma ni un trozo en 2 ventanas) solo valía para ARCHIVOS. Ahora también para textos: se suelta
// pronto y la cola de saltos lo reintenta por otro camino (buzón de internet si lo hay) o más tarde.
// Prueba: A y B por Bluetooth; la app de B duerme (enlace vivo); A pasa por B un texto largo (5.000 caracteres) para un tercero.
//  F1 A suelta el flujo en ≤ 30 s (contraprueba 3124: agota los 8 reintentos);   F2 como mucho 2 ventanas enteras reenviadas;
//  F3 B queda marcado como puente que no responde.
//  F4 (3127) el reintento por un camino que falla espera 15 s, 30 s… hasta 10 min (antes, como mucho 2 min: ~300 intentos en 10 h).
// Uso: node jumpfwd.js <dir_build>
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone, installWebCrypto } = require('./native_mock');

const buildDir = path.resolve(process.argv[2]);
const base = { readsContentFallback: true, retain: ['onPayloadReceived'], closeOnNoService: true, pace: [15, 15], ioDelay: 25, asymmetric: true, noL2: true, noTor: true };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
class DL extends ResourceLoader { constructor(d) { super(); this.d = d; } fetch(u) { const f = path.join(this.d, decodeURIComponent(new URL(u).pathname)); return fs.existsSync(f) ? Promise.resolve(fs.readFileSync(f)) : Promise.reject(new Error('x')); } }
const logs = [];
const T0 = Date.now();
const ts = () => String(((Date.now() - T0) / 1000).toFixed(1)).padStart(6) + 's';
async function boot(name, native) {
  const vc = new VirtualConsole();
  ['log', 'warn', 'error'].forEach((l) => vc.on(l, (...a) => logs.push(`${ts()} [${name}] ${l}: ` + a.map(String).join(' ').substring(0, 250))));
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
async function openChatWith(p, name) {
  let row; for (let i = 0; i < 300 && !row; i++) { row = Array.from(p.win.document.querySelectorAll('#main-contacts-list .ble-contact-row')).find((r) => (r.querySelector('.ble-contact-name') || {}).textContent === name); if (!row) await sleep(100); }
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
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', Object.assign({}, base)), nB = new NativePhone('B', 'BB:BB:BB:BB:BB:02', Object.assign({}, base));
  [nA, nB].forEach((n) => { radio.add(n); n.load(); });
  const A = await boot('A', nA), B = await boot('B', nB);
  const biA = A.win.bleInterface, AS = biA.ackSystem;
  const idA = biA.localNexoId.toLowerCase(), idB = B.win.bleInterface.localNexoId.toLowerCase();
  const r = { prueba: 'jumpfwd', build: path.basename(buildDir) };
  biA.togglePanel(); const paired = await addFound(A, 'B'); biA.togglePanel();
  if (!paired) { console.log('JUMPFWD ' + JSON.stringify(Object.assign(r, { resultado: 'FALLO', error: 'no empareja' }))); process.exit(1); }
  await openChatWith(A, 'B'); sendText(A, 'hola B'); await sleep(1200);
  await openChatWith(B, 'A'); sendText(B, 'hola A'); await sleep(1200);
  r.emparejados_s = await waitFor(async () => (await B.win.vaultLoadMessages(idA)).some((m) => m.content === 'hola B'), 30000);
  const macB = biA._bleReadyFor(idB) || biA._resolveDeviceIdForNexoId(idB);
  const stalled = []; const relay = biA.relay;
  if (relay && typeof relay.bridgeStalled === 'function') { const o = relay.bridgeStalled; relay.bridgeStalled = function (v, ms) { stalled.push(String(v)); return o.apply(this, arguments); }; }
  // La APP de B (el puente) se duerme: no confirma nada; el enlace sigue VIVO
  const plugB = B.win.Capacitor.Plugins.NexoBLE;
  const swallow = function () { return Promise.resolve({ sent: true }); };
  plugB.sendMessage = swallow; if (plugB.sendBinary) plugB.sendBinary = swallow;
  nB.setFrozen(true);
  const n0 = logs.length;
  const t0 = Date.now();
  let fin = null;
  AS.forwardStream(macB, 'fwd_dormido_1', 'x'.repeat(5000), { dst: 'nx0000beef', hp: 1, fr: idA }, 'chat').then(() => { fin = 'ok'; }, (e) => { fin = (e && e.code) || String(e && e.message); });
  r.F1_suelta_s = await waitFor(() => fin !== null, 100000);
  r.F1_resultado = fin;
  const win = logs.slice(n0);
  r.F2_ventanas_reenviadas = win.filter((l) => /\[A\].*Window timeout, reenviando ventana.*fwd_dormido_1/.test(l)).length;
  r.F3_puente_fuera = stalled.some((s) => s.indexOf(idB) >= 0 || s.toLowerCase().replace(/[^0-9a-f]/g, '').indexOf(String(macB).toLowerCase().replace(/[^0-9a-f]/g, '')) >= 0);
  // F4 (3127): el reintento por un camino que falla espera cada vez más, hasta 10 min (antes 2)
  try { const RL = await import(require('url').pathToFileURL(path.join(buildDir, 'src/ui/ble_relay.js')).href); r.F4_esperas_s = [1, 2, 4, 5, 6, 7, 20].map((n) => RL._hopFailWaitMs(n) / 1000); } catch (e) { r.F4_esperas_s = String(e && e.message); }
  r.F4_tope_10_min = Array.isArray(r.F4_esperas_s) && r.F4_esperas_s.join(',') === '15,30,120,240,480,600,600';
  r.errores = logs.filter((l) => / error: /.test(l) && !/JSDOMERROR|styles\.css|Not implemented|GLOBAL TIMEOUT|net::ERR|fetch/.test(l)).slice(0, 5);
  const ok = r.emparejados_s !== null && r.F1_suelta_s !== null && r.F1_suelta_s <= 30 && r.F2_ventanas_reenviadas <= 2 && r.F3_puente_fuera && r.F4_tope_10_min && !r.errores.length;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('JUMPFWD ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_jumpfwd.txt'), logs.join('\n'));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('JUMPFWD ' + JSON.stringify({ prueba: 'jumpfwd', resultado: 'FALLO', error: String(e && e.message).replace(/"/g, "'") })); console.error(e && e.stack); fs.writeFileSync(path.join(__dirname, 'last_logs_jumpfwd.txt'), logs.join('\n')); process.exit(1); });
