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
// Uso: node puente.js <dir_build>
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
  const r = { prueba: 'puente', build: path.basename(buildDir) };
  // 0. El filtro del que presta: solo mensajes privados firmados, su suscripción, AUTH y CLOSE (la build anterior no lo tiene)
  try {
    const gw = await importSrc('net/gw_link.js'), nl = await importSrc('net/net_link.js');
    const sk = new Uint8Array(32).fill(7), P = 'a'.repeat(64);
    const ev = nl.netMakeEvent(sk, 1059, [['p', P]], 'x'), blob = nl.netMakeEvent(sk, 1064, [], 'x'), bad = Object.assign({}, ev, { content: 'y' });
    const cases = [[['EVENT', ev], 'EVENT'], [['EVENT', blob], ''], [['EVENT', bad], ''], [['REQ', 's1', { kinds: [1059], '#p': [P], since: 1 }], 'REQ'],
      [['REQ', 's2', { kinds: [1064] }], ''], [['REQ', 's3', {}], ''], [['REQ', 's4', { kinds: [1059], authors: [P] }], ''], [['REQ', 'pb', { ids: ['0'.repeat(64)], limit: 1 }], 'REQ'],
      [['CLOSE', 's1'], 'CLOSE'], [['COUNT', 's1', {}], ''], [['AUTH', nl.netMakeEvent(sk, 22242, [['relay', 'x']], '')], 'AUTH']];
    r.filtro_ok = cases.every(([f, want]) => gw.gwAllowUp(JSON.stringify(f)) === want);
  } catch (e) { r.filtro_ok = false; r.filtro_error = String(e && e.message).slice(0, 120); }
  const r1 = new NostrRelay(), r2 = new NostrRelay();
  RELAYS = [await r1.start(), await r2.start()];
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', base), nB1 = new NativePhone('B1', 'BB:BB:BB:BB:BB:02', base);
  const nB2 = new NativePhone('B2', 'BB:BB:BB:BB:BB:03', base), nC = new NativePhone('C', 'CC:CC:CC:CC:CC:04', base);
  [nA, nB1, nB2, nC].forEach((n) => { radio.add(n); n.load(); });
  const A = await boot('A', nA, true), B1 = await boot('B1', nB1), B2 = await boot('B2', nB2), C = await boot('C', nC);
  const id = (p) => p.win.bleInterface.localNexoId.toLowerCase();
  const idA = id(A), idB1 = id(B1), idB2 = id(B2), idC = id(C);
  // A agrega a los tres por Bluetooth (C todavía está cerca)
  A.win.bleInterface.togglePanel();
  const paired = (await addFound(A, 'B1')) && (await addFound(A, 'B2')) && (await addFound(A, 'C'));
  A.win.bleInterface.togglePanel();
  if (!paired) { console.log('PUENTE ' + JSON.stringify(Object.assign(r, { resultado: 'FALLO', error: 'no empareja' }))); process.exit(1); }
  // un primer texto por Bluetooth a cada uno (así C, B1 y B2 tienen a A y abren sus relés)
  for (const [P, n] of [[B1, 'B1'], [B2, 'B2'], [C, 'C']]) { await openChatWith(A, n); sendText(A, 'hola ' + n); await sleep(1500); }
  await sleep(2000);
  // C se va lejos: fuera del alcance de todos (solo le queda internet)
  radio.block(nA, nC); radio.block(nB1, nC); radio.block(nB2, nC);
  [B1, B2, C].forEach((p) => p.win.bleInterface.net.tick());
  const netA = A.win.bleInterface.net;
  r.c_con_internet_s = await waitFor(() => C.win.bleInterface.net.online() && B1.win.bleInterface.net.online() && B2.win.bleInterface.net.online(), 30000);
  // 1. A encuentra puentes
  r.puentes_s = await waitFor(() => netA.gw && typeof netA.gwOnly === 'function' && netA.gwOnly() && netA.gw.bridges.size >= 2, 60000);
  r.puentes = netA.gw ? netA.gw.summary().bridges.length : 0;
  // a un contacto con Bluetooth directo listo (B2) no se le escribe «por internet» a través del Bluetooth de otro
  r.b2_por_bluetooth = !!(netA.gwOnly && netA.gwOnly() && !netA.canReach(idB2) && A.win.bleInterface.linkOf(idB2) === 'bluetooth');
  const has = (P, other, t, own) => async () => (await P.win.vaultLoadMessages(other)).some((m) => !!m._own === !!own && String(m.content).trim() === t);
  const status = async (P, other, t) => { const m = (await P.win.vaultLoadMessages(other)).find((x) => x._own && String(x.content).trim() === t); return m ? m.status : null; };
  // 2. A → C por el puente
  await openChatWith(A, 'C');
  sendText(A, 'hola por puente');
  r.ida_llega_s = await waitFor(has(C, idA, 'hola por puente', false), 60000);
  r.ida_doble_check_s = await waitFor(async () => (await status(A, idC, 'hola por puente')) === 'delivered' || (await status(A, idC, 'hola por puente')) === 'read', 40000);
  r.ida_estado = await status(A, idC, 'hola por puente');
  // 3. C → A: la respuesta vuelve («recoge lo mío»)
  await openChatWith(C, 'A');
  sendText(C, 'te contesto');
  r.vuelta_llega_s = await waitFor(has(A, idC, 'te contesto', false), 60000);
  // 4. B1 se va: sigue por B2
  radio.block(nA, nB1);
  r.suelta_b1_s = await waitFor(() => netA.gw && !netA.gw.bridges.has(idB1), 60000);
  sendText(C, 'sigue');
  r.sin_b1_vuelta_s = await waitFor(has(A, idC, 'sigue', false), 60000);
  sendText(A, 'yo también');
  r.sin_b1_ida_s = await waitFor(has(C, idA, 'yo también', false), 60000);
  // 5. Los puentes no ven los textos y no pasan archivos
  const secret = ['hola por puente', 'te contesto', 'sigue', 'yo también'];
  const seen = async (P) => { let n = 0; for (const o of [idA, idC]) for (const m of await P.win.vaultLoadMessages(o)) if (secret.indexOf(String(m.content).trim()) >= 0) n++; return n; };
  r.b1_ve = await seen(B1); r.b2_ve = await seen(B2);
  r.relay_raw_texto = r1.events.concat(r2.events).some((e) => secret.some((t) => JSON.stringify(e).indexOf(t) >= 0));
  r.blob_por_puente = r1.events.concat(r2.events).filter((e) => e && e.kind === 1064).length;
  r.gw = netA.gw ? netA.gw.summary() : null;
  r.srv = { B1: B1.win.bleInterface.net.gw ? B1.win.bleInterface.net.gw.stats : null, B2: B2.win.bleInterface.net.gw ? B2.win.bleInterface.net.gw.stats : null };
  r.errores = logs.filter((l) => / error: /.test(l) && !/JSDOMERROR|styles\.css|Not implemented|GLOBAL TIMEOUT|net::ERR|fetch|ECONNREFUSED|WebSocket/.test(l)).slice(0, 5);
  const ok = r.filtro_ok && r.puentes_s !== null && r.b2_por_bluetooth && r.ida_llega_s !== null && r.ida_doble_check_s !== null && r.vuelta_llega_s !== null && r.suelta_b1_s !== null &&
    r.sin_b1_vuelta_s !== null && r.sin_b1_ida_s !== null && r.b1_ve === 0 && r.b2_ve === 0 && !r.relay_raw_texto && r.blob_por_puente === 0 && !r.errores.length;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('PUENTE ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_puente.txt'), logs.join('\n'));
  [A, B1, B2, C].forEach(shutdown);
  await r1.stop(); await r2.stop();
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('PUENTE ' + JSON.stringify({ prueba: 'puente', resultado: 'FALLO', error: String(e && e.message).replace(/"/g, "'") })); console.error(e && e.stack); fs.writeFileSync(path.join(__dirname, 'last_logs_puente.txt'), logs.join('\n')); process.exit(1); });
