// Dueño 13-11 — PUENTE A INTERNET, parte 2: el puente es un NEXO DESCONOCIDO (no es contacto de A). A sin internet y sin
// ningún vecino conectado que le preste internet, AL MANDAR un texto, se conecta «de paso» (como Jump) con un NEXO cercano
// visto al escanear y le pide internet; su texto llega a C (lejos) con ✓✓ y la respuesta vuelve. Sin nada pendiente no sale
// a buscar desconocidos (solo cada 10 min, para recoger lo suyo). EL REGRESO: S se va, A no tiene nada pendiente y C
// contesta: otro desconocido T con internet que pasa cerca le recoge la respuesta (cada minuto tras usar un puente).
// Contraprueba 3042: la ida ya salía (Jump conecta de paso al mandar), pero la respuesta sin S no llega nunca.
// (Cabecera de la parte 1, de la que sale este archivo:)
// Dueño 13-11 — PUENTE A INTERNET por un NEXO cercano (parte 1: textos). «Mando un mensaje y no tengo internet: sale
// por Bluetooth a alguien cercano que sí tiene, ese lo sube al buzón y le llega a mi contacto; la respuesta vuelve por
// ahí». Y la red: si el puente de la ida ya no está, otro cercano recoge lo mío (hasta 3 puentes a la vez).
// Cuatro teléfonos: A SIN internet (su WebSocket no conecta), B1 y B2 cerca de A con internet, C LEJOS de todos (solo
// internet). Pasos:
//   1. A encuentra puentes (B1 y B2) y queda «en línea por puente».
//   2. A → C: el texto llega a C y en A queda ✓✓ (la confirmación vuelve por el puente).
//   3. C → A: la respuesta llega a A («recoge lo mío»).
//   4. B1 se va (fuera de alcance): C → A y A → C siguen por B2.
//   5. B1 y B2 no ven el texto (va cifrado para el contacto) y por el puente no pasan archivos (ni eventos del buzón de archivos).
// Contraprueba: la build anterior (sin puente) no entrega nada (paso 2 falla).
// Uso: node puente2.js <dir_build>
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone, installWebCrypto } = require('./native_mock');
const { NostrRelay } = require('./nostr_relay');
const { importSrc } = require('./srcmod');

const buildDir = path.resolve(process.argv[2] || path.join(__dirname, 'builds/wip'));
const base = { readsContentFallback: true, retain: ['onPayloadReceived', 'onLanMessage', 'onLanUp', 'onLanDown'], closeOnNoService: true, pace: [15, 15], ioDelay: 25, asymmetric: true, noTor: true };
let RELAYS = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
class DL extends ResourceLoader { constructor(d) { super(); this.d = d; } fetch(u) { const f = path.join(this.d, decodeURIComponent(new URL(u).pathname)); return fs.existsSync(f) ? Promise.resolve(fs.readFileSync(f)) : Promise.reject(new Error('x')); } }
const logs = [];
const T0 = Date.now();
const ts = () => String(((Date.now() - T0) / 1000).toFixed(1)).padStart(6) + 's';
// Sin antena: ningún relé contesta (como un teléfono sin datos ni Wi-Fi con salida)
class NoNetWS { constructor(u) { this.url = u; this.readyState = 0; setTimeout(() => { this.readyState = 3; if (this.onerror) this.onerror({}); if (this.onclose) this.onclose({}); }, 30); } send() { throw new Error('sin red'); } close() {} }
async function boot(name, native, noNet) {
  native.listeners = new Map();
  native.calls = { push() {}, length: 0, filter() { return []; }, slice() { return []; }, forEach() {}, map() { return []; }, some() { return false; }, find() { return undefined; } };
  const vc = new VirtualConsole();
  ['log', 'warn', 'error'].forEach((l) => vc.on(l, (...a) => logs.push(`${ts()} [${name}] ${l}: ` + a.map(String).join(' ').substring(0, 260))));
  const dom = new JSDOM(fs.readFileSync(path.join(buildDir, 'dist', 'index.html'), 'utf8'), {
    url: 'https://' + name.toLowerCase() + '.nexo.test/index.html', runScripts: 'dangerously', resources: new DL(path.join(buildDir, 'dist')), pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) {
      win.NEXO_NET_RELAYS = RELAYS; win.CapacitorCustomPlatform = { name: 'android' }; installWebCrypto(win);
      win.Capacitor = { Plugins: { NexoBLE: native.plugin() } }; win.HTMLElement.prototype.scrollTo = function () {};
      if (noNet) win.WebSocket = NoNetWS;
    },
  });
  const win = dom.window;
  for (let i = 0; i < 100 && !(win.NEXO && win.NEXO.initialized); i++) await sleep(100);
  await sleep(800);
  return { name, native, win };
}
const click = (win, el) => el && el.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
async function openChatWith(p, name) {
  let row; for (let i = 0; i < 200 && !row; i++) { row = Array.from(p.win.document.querySelectorAll('#main-contacts-list .ble-contact-row')).find((r) => (r.querySelector('.ble-contact-name') || {}).textContent === name); if (!row) await sleep(100); }
  click(p.win, row); await sleep(500); return !!row;
}
function sendText(p, t) { const i = p.win.document.getElementById('message-input'); i.value = t; i.dispatchEvent(new p.win.Event('input', { bubbles: true })); click(p.win, p.win.document.getElementById('send-btn')); }
async function addFound(p, name) {
  let add = null;
  const find = () => { const row = Array.from(p.win.document.querySelectorAll('#ble-new-device > div')).find((d) => (d.querySelector('span') || {}).textContent === name); return row && row.querySelector('button'); };
  for (let i = 0; i < 400 && !add; i++) { await sleep(100); add = find(); if (!add && !p.win.bleInterface.isScanning) click(p.win, p.win.document.getElementById('ble-scan-btn')); }
  click(p.win, add); await sleep(2500);
  return !!add;
}
async function waitFor(fn, ms) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return Math.round((Date.now() - t0) / 100) / 10; await sleep(250); } return null; }
function shutdown(p) { try { p.win.bleInterface.net._closeAll(); p.win.bleInterface.net.relays.forEach((rl) => { rl.retryAt = Date.now() + 9e6; }); } catch (e) {} }

(async () => {
  const r = { prueba: 'puente2', build: path.basename(buildDir) };
  const r1 = new NostrRelay(), r2 = new NostrRelay();
  RELAYS = [await r1.start(), await r2.start()];
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', base), nS = new NativePhone('S', 'DD:DD:DD:DD:DD:05', base), nC = new NativePhone('C', 'CC:CC:CC:CC:CC:04', base);
  const nT = new NativePhone('T', 'EE:EE:EE:EE:EE:06', base);
  [nA, nS, nC, nT].forEach((n) => { radio.add(n); n.load(); });
  radio.block(nA, nT); radio.block(nT, nC); radio.block(nT, nS); // T (otro desconocido con internet) aparece más tarde
  const A = await boot('A', nA, true), S = await boot('S', nS), C = await boot('C', nC), T = await boot('T', nT);
  const id = (p) => p.win.bleInterface.localNexoId.toLowerCase();
  const idA = id(A), idS = id(S), idC = id(C);
  // A agrega SOLO a C (S es un desconocido); un primer texto por Bluetooth
  A.win.bleInterface.togglePanel();
  const paired = await addFound(A, 'C');
  A.win.bleInterface.togglePanel();
  if (!paired) { console.log('PUENTE2 ' + JSON.stringify(Object.assign(r, { resultado: 'FALLO', error: 'no empareja' }))); process.exit(1); }
  await openChatWith(A, 'C'); sendText(A, 'hola C'); await sleep(2500);
  r.s_no_es_contacto = !A.win.bleInterface.getBLEContacts().some((c) => String(c.nexoId || '').toLowerCase() === idS);
  // C se va lejos (solo internet); S queda cerca de A, con internet, pero sin enlace con A
  radio.block(nA, nC); radio.block(nS, nC);
  [S, C].forEach((p) => p.win.bleInterface.net.tick());
  const netA = A.win.bleInterface.net;
  r.s_y_c_con_internet = await waitFor(() => C.win.bleInterface.net.online() && S.win.bleInterface.net.online(), 30000) !== null;
  // Sin nada pendiente, A NO sale a buscar desconocidos cada 30 s (radio en un apagón general: solo cada 10 min)
  const sIn0 = nS.stats.connectsIn || 0;
  await sleep(45000);
  r.sin_pendiente_no_busca = (nS.stats.connectsIn || 0) - sIn0 === 0 && !netA.gw.bridges.has(idS);
  // A manda sin internet y sin contactos cerca: se conecta de paso con S, le pide internet y el texto sale por ahí
  const has = (P, other, t, own) => async () => (await P.win.vaultLoadMessages(other)).some((m) => !!m._own === !!own && String(m.content).trim() === t);
  const status = async (P, other, t) => { const m = (await P.win.vaultLoadMessages(other)).find((x) => x._own && String(x.content).trim() === t); return m ? m.status : null; };
  await openChatWith(A, 'C');
  sendText(A, 'por un desconocido');
  r.puente_desconocido_s = await waitFor(() => netA.gw && netA.gw.bridges.has(idS) && netA.gwOnly && netA.gwOnly(), 150000);
  r.ida_llega_s = await waitFor(has(C, idA, 'por un desconocido', false), 60000);
  r.ida_doble_check_s = await waitFor(async () => ['delivered', 'read'].indexOf(await status(A, idC, 'por un desconocido')) >= 0, 40000);
  await openChatWith(C, 'A');
  sendText(C, 'te llega');
  r.vuelta_llega_s = await waitFor(has(A, idC, 'te llega', false), 60000);
  // la conexión de paso con S no se cerró por falta de uso mientras hace de puente (Jump cierra las de paso a los 60 s)
  await sleep(70000);
  r.puente_sigue_70s = !!(netA.gw && netA.gw.bridges.has(idS));
  sendText(C, 'otra');
  r.otra_llega_s = await waitFor(has(A, idC, 'otra', false), 60000);
  // EL REGRESO (dueño 13-11): S se va; A no tiene nada pendiente; otro desconocido T con internet pasa cerca. C contesta:
  // la respuesta quedó en el buzón de A y T se la recoge (A vuelve a buscar desconocidos cada minuto tras usar un puente).
  radio.block(nA, nS); radio.unblock(nA, nT);
  const idT = id(T);
  r.suelta_s = await waitFor(() => !netA.gw.bridges.has(idS), 60000);
  sendText(C, 'vuelta sin S');
  r.puente_t_s = await waitFor(() => netA.gw.bridges.has(idT), 180000);
  r.vuelta_sin_s_llega_s = await waitFor(has(A, idC, 'vuelta sin S', false), 60000);
  r.s_no_ve = !(await S.win.vaultLoadMessages(idA)).some((m) => ['por un desconocido', 'te llega', 'otra'].indexOf(String(m.content).trim()) >= 0);
  r.errores = logs.filter((l) => / error: /.test(l) && !/JSDOMERROR|styles\.css|Not implemented|GLOBAL TIMEOUT|net::ERR|fetch|ECONNREFUSED|WebSocket/.test(l)).slice(0, 5);
  const ok = r.s_no_es_contacto && r.s_y_c_con_internet && r.sin_pendiente_no_busca && r.puente_desconocido_s !== null && r.ida_llega_s !== null && r.ida_doble_check_s !== null &&
    r.vuelta_llega_s !== null && r.puente_sigue_70s && r.otra_llega_s !== null && r.suelta_s !== null && r.puente_t_s !== null &&
    r.vuelta_sin_s_llega_s !== null && r.s_no_ve && !r.errores.length;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('PUENTE2 ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_puente2.txt'), logs.join('\n'));
  [A, S, C, T].forEach(shutdown);
  await r1.stop(); await r2.stop();
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('PUENTE2 ' + JSON.stringify({ prueba: 'puente2', resultado: 'FALLO', error: String(e && e.message).replace(/"/g, "'") })); console.error(e && e.stack); fs.writeFileSync(path.join(__dirname, 'last_logs_puente2.txt'), logs.join('\n')); process.exit(1); });
