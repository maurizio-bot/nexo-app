// 3084 (dueño 14-11: «si un contacto no está al alcance del Bluetooth ni siquiera debería intentarlo; siempre primero las vías más
// rápidas»; diagnóstico S24 08:06: al volver la app, «Flush global pending» pedía conectar por Bluetooth, por la dirección guardada, a
// los 15 contactos con algo pendiente aunque ninguno estaba cerca; también al abrir su chat y al mandarle algo). A, B, C, D y E
// emparejados por Bluetooth, sin internet. C, D y E se van lejos (más de 2 min sin verlos) y A les escribe (queda ⏳). Luego A va a
// segundo plano y vuelve:
//  K1  ningún intento de conexión Bluetooth a C, D ni E mientras están lejos (al volver la app, al abrir el chat de C, al mandarle);
//  K2  B (cerca) sigue recibiendo al momento;
//  K3  C vuelve: el escaneo lo ve, se conecta solo y su mensaje le llega (≤ 45 s).
// Uso: node btcerca.js <dir_build>
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone, installWebCrypto } = require('./native_mock');

const buildDir = path.resolve(process.argv[2]);
const base = { readsContentFallback: true, retain: ['onPayloadReceived'], closeOnNoService: true, pace: [15, 15], ioDelay: 25, asymmetric: true, noTor: true };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
class DL extends ResourceLoader { constructor(d) { super(); this.d = d; } fetch(u) { const f = path.join(this.d, decodeURIComponent(new URL(u).pathname)); return fs.existsSync(f) ? Promise.resolve(fs.readFileSync(f)) : Promise.reject(new Error('no existe ' + f)); } }
const logs = [];
async function boot(name, native) {
  native.conns = native.conns || [];
  let vis = 'visible';
  const vc = new VirtualConsole();
  ['log', 'warn', 'error'].forEach((l) => vc.on(l, (...a) => logs.push(`${new Date().toISOString().substring(14, 23)} [${name}] ${l}: ` + a.map(String).join(' ').substring(0, 300))));
  const dom = new JSDOM(fs.readFileSync(path.join(buildDir, 'dist', 'index.html'), 'utf8'), {
    url: 'https://' + name.toLowerCase() + '.nexo.test/index.html', runScripts: 'dangerously', resources: new DL(path.join(buildDir, 'dist')), pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) {
      win.NEXO_NET_RELAYS = []; win.CapacitorCustomPlatform = { name: 'android' }; installWebCrypto(win);
      Object.defineProperty(win.document, 'visibilityState', { configurable: true, get: () => vis });
      Object.defineProperty(win.document, 'hidden', { configurable: true, get: () => vis === 'hidden' });
      const pl = native.plugin();
      const o = pl.connectToDevice;
      pl.connectToDevice = (a) => { try { native.conns.push({ t: Date.now(), id: String((a && (a.deviceId || a.address)) || '').toLowerCase().replace(/[^0-9a-z]/g, ''), st: process.env.BTCERCA_STACK ? String(new Error().stack).split('\n').slice(2, 7).map((x) => x.trim().replace(/\(.*\/dist\//, '(')).join(' < ') : '' }); } catch (e) {} return o(a); };
      win.Capacitor = { Plugins: { NexoBLE: pl } }; win.HTMLElement.prototype.scrollTo = function () {};
    },
  });
  const win = dom.window;
  for (let i = 0; i < 1000 && !(win.NEXO && win.NEXO.initialized); i++) await sleep(10);
  await sleep(800);
  const p = { name, native, win };
  p.setActive = (active) => { vis = active ? 'visible' : 'hidden'; win.document.dispatchEvent(new win.Event('visibilitychange')); native.setAppActive(active); };
  return p;
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
const has = (p, from, pred) => p.win.vaultLoadMessages(from).then((l) => l.some(pred));
const hexOf = (a) => a.toLowerCase().replace(/[^0-9a-f]/g, '');

(async () => {
  const r = { prueba: 'btcerca', build: path.basename(buildDir) };
  const radio = new Radio();
  const names = ['A', 'B', 'C', 'D', 'E'];
  const nat = {}; names.forEach((n, i) => { nat[n] = new NativePhone(n, `${n}${n}:${n}${n}:${n}${n}:${n}${n}:${n}${n}:0${i + 1}`, Object.assign({}, base)); radio.add(nat[n]); nat[n].load(); });
  const P = {}; for (const n of names) P[n] = await boot(n, nat[n]);
  const A = P.A, biA = A.win.bleInterface;
  const id = {}; names.forEach((n) => { id[n] = P[n].win.bleInterface.localNexoId.toLowerCase(); });
  biA.togglePanel();
  for (const n of ['B', 'C', 'D', 'E']) { if (!(await addFound(A, n))) { console.log('BTCERCA ' + JSON.stringify({ prueba: 'btcerca', resultado: 'FALLO', error: 'no empareja ' + n })); process.exit(1); } }
  biA.togglePanel();
  for (const n of ['B', 'C', 'D', 'E']) { await openChatWith(A, n); sendText(A, 'hola ' + n); await sleep(1500); }
  r.emparejados = await waitFor(async () => (await has(P.C, id.A, (m) => m.content === 'hola C')) && has(P.E, id.A, (m) => m.content === 'hola E'), 30000) !== null;

  // C, D y E se van lejos; A les escribe (queda ⏳)
  ['C', 'D', 'E'].forEach((n) => nat[n].setOffline(true));
  await waitFor(() => ['C', 'D', 'E'].every((n) => !biA._bleReadyFor(id[n])), 30000);
  for (const n of ['C', 'D', 'E']) { await openChatWith(A, n); sendText(A, 'para ' + n + ' lejos'); await sleep(1000); }
  // se fueron de verdad: más de 2 min sin verlos (en el diagnóstico, horas)
  await sleep(130000);
  const far = new Set(); ['C', 'D', 'E'].forEach((n) => { far.add(hexOf(nat[n].address)); far.add(hexOf(nat[n].initAddress)); far.add(id[n]); });
  const farConns = () => nat.A.conns.filter((c) => far.has(c.id)).length;
  const c0 = farConns();
  // A a segundo plano y de vuelta (en el diagnóstico: «Flush global pending» → conectar a los 15)
  A.setActive(false); await sleep(3000); A.setActive(true); await sleep(8000);
  // abrir el chat de C y mandarle otra cosa
  await openChatWith(A, 'C'); sendText(A, 'otra para C'); await sleep(6000);
  r.K1_intentos_bt_a_lejanos = farConns() - c0;
  if (process.env.BTCERCA_STACK) r.K1_origen = nat.A.conns.filter((c) => far.has(c.id)).slice(-5).map((c) => c.st);
  // K2: B cerca recibe al momento
  await openChatWith(A, 'B'); sendText(A, 'B cerca');
  r.K2_b_llega_s = await waitFor(() => has(P.B, id.A, (m) => m.content === 'B cerca'), 20000);
  // K3: C vuelve
  nat.C.setOffline(false);
  const tBack = Date.now();
  const ok3 = await waitFor(async () => (await has(P.C, id.A, (m) => m.content === 'para C lejos')) && has(P.C, id.A, (m) => m.content === 'otra para C'), 90000);
  r.K3_c_llega_s = ok3 === null ? null : Math.round((Date.now() - tBack) / 100) / 10;
  r.errores = logs.filter((l) => / error: /.test(l) && !/JSDOMERROR|styles\.css|Not implemented|net::ERR|fetch/.test(l)).slice(0, 5);
  const ok = r.emparejados && r.K1_intentos_bt_a_lejanos === 0 && r.K2_b_llega_s !== null && r.K2_b_llega_s <= 10 && r.K3_c_llega_s !== null && r.K3_c_llega_s <= 45 && !r.errores.length;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('BTCERCA ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_btcerca.txt'), logs.join('\n'));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('BTCERCA ' + JSON.stringify({ prueba: 'btcerca', resultado: 'FALLO', error: String(e && e.message) })); console.error(e); fs.writeFileSync(path.join(__dirname, 'last_logs_btcerca.txt'), logs.join('\n')); process.exit(1); });
