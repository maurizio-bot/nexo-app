// 3072 (dueño 13-11: «si el vivo no sirve o otro teléfono no sirve, se tiene que buscar otro, y así sucesivamente hasta encontrar un
// puente válido»): PUENTE EN CADENA. A sin internet manda a C (lejos). Cerca hay cinco NEXO con internet: S1–S4 con mejor señal
// pero con la app DORMIDA (no contestan, como el vivo), y S5 más lejos y despierto. A tiene que acabar usando a S5: si los que
// pregunta no contestan en 5 s, prueba en el acto con los siguientes (y lo deja escrito en el diagnóstico).
// Contraprueba 3071: entre ronda y ronda de búsqueda se esperaba el latido de 30 s.
// Uso: node puente5.js <dir_build>
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
  const r = { prueba: 'puente5', build: path.basename(buildDir) };
  const r1 = new NostrRelay(), r2 = new NostrRelay();
  RELAYS = [await r1.start(), await r2.start()];
  const radio = new Radio();
  // S1–S4: NEXO cercanos con BUENA señal pero con la app DORMIDA (como el vivo): no contestan. S5: más lejos, despierto y con
  // internet. Ninguno ha estado nunca cerca de C. Jump abre como mucho 3 conexiones de paso: los dormidos ocupaban los huecos.
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', base), nC = new NativePhone('C', 'CC:CC:CC:CC:CC:04', base);
  const S_RSSI = [-45, -47, -49, -51, -80];
  const nS = S_RSSI.map((rs, i) => new NativePhone('S' + (i + 1), 'D' + (i + 1) + ':D0:D0:D0:D0:1' + (i + 1), Object.assign({}, base, { rssi: rs })));
  [nA, nC].concat(nS).forEach((n) => { radio.add(n); n.load(); });
  nS.forEach((n) => { radio.block(nA, n); radio.block(n, nC); }); // aún lejos de A; nunca cerca de C
  const A = await boot('A', nA, true), C = await boot('C', nC);
  const S = []; for (let i = 0; i < nS.length; i++) S.push(await boot('S' + (i + 1), nS[i]));
  const id = (p) => p.win.bleInterface.localNexoId.toLowerCase();
  const idA = id(A), idC = id(C), idS5 = id(S[4]);
  A.win.bleInterface.togglePanel();
  const paired = await addFound(A, 'C');
  A.win.bleInterface.togglePanel();
  if (!paired) { console.log('PUENTE5 ' + JSON.stringify(Object.assign(r, { resultado: 'FALLO', error: 'no empareja' }))); process.exit(1); }
  await openChatWith(A, 'C'); sendText(A, 'hola C'); await sleep(2500);
  // C se va lejos (solo internet); los S llegan cerca de A, con internet; S1–S4 se duermen
  radio.block(nA, nC); nS.forEach((n) => radio.unblock(nA, n));
  [C].concat(S).forEach((p) => p.win.bleInterface.net.tick());
  r.todos_con_internet = await waitFor(() => [C].concat(S).every((p) => p.win.bleInterface.net.online()), 30000) !== null;
  nS.slice(0, 4).forEach((n) => n.setFrozen(true));
  // que A los vea al escanear
  const netA = A.win.bleInterface.net;
  for (let i = 0; i < 3; i++) { try { await A.win.bleInterface.relay._scan(); } catch (e) {} await sleep(500); }
  const mark = logs.length;
  const has = (P, other, t, own) => async () => (await P.win.vaultLoadMessages(other)).some((m) => !!m._own === !!own && String(m.content).trim() === t);
  await openChatWith(A, 'C');
  const t0 = Date.now();
  sendText(A, 'busca un puente que sirva');
  r.puente_s5_s = await waitFor(() => netA.gw && netA.gw.bridges.has(idS5), 150000);
  r.llega_a_c_s = await waitFor(has(C, idA, 'busca un puente que sirva', false), 90000);
  r.desde_mandar_s = Math.round((Date.now() - t0) / 1000);
  const after = logs.slice(mark).filter((l) => /\[A\]/.test(l));
  r.pregunta_visible = after.some((l) => /\[GW\] Sin internet propio: pregunto a/.test(l));
  r.cadena_visible = after.some((l) => /\[GW\] .*no contesta.* pruebo con otro NEXO cercano/.test(l));
  r.puentes_dormidos = S.slice(0, 4).filter((p) => netA.gw.bridges.has(id(p))).length;
  r.errores = logs.filter((l) => / error: /.test(l) && !/JSDOMERROR|styles\.css|Not implemented|GLOBAL TIMEOUT|net::ERR|fetch|ECONNREFUSED|WebSocket/.test(l)).slice(0, 5);
  const ok = r.todos_con_internet && r.puente_s5_s !== null && r.puente_s5_s <= 40 && r.llega_a_c_s !== null && r.pregunta_visible && r.cadena_visible && !r.errores.length;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('PUENTE5 ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_puente5.txt'), logs.join('\n'));
  [A, C].concat(S).forEach(shutdown);
  await r1.stop(); await r2.stop();
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('PUENTE5 ' + JSON.stringify({ prueba: 'puente5', resultado: 'FALLO', error: String(e && e.message).replace(/"/g, "'") })); console.error(e && e.stack); fs.writeFileSync(path.join(__dirname, 'last_logs_puente5.txt'), logs.join('\n')); process.exit(1); });
