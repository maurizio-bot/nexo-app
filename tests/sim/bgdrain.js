// 3033 (dueño 12-11 22:41: «si me llega un mensaje ya debe de quedarse en el chat y no cargarse cuando yo abro el chat; cuando
// abra el chat ya deben de estar ahí los mensajes»). Con la app en segundo plano la parte nativa (NetBg) recibía por internet y
// AVISABA, pero el mensaje no quedaba en el chat: al volver, la app lo pedía otra vez a los relés (17 s en el S24, con un relé
// que no contestaba). Ahora la parte nativa guarda lo que recibió y la app lo procesa al volver (netBgDrain).
// Prueba: A y B solo por internet; B a segundo plano (su app no escucha); A manda 3 textos; los relés se caen; B vuelve:
// los 3 textos tienen que estar en el chat de B en ≤ 3 s (contraprueba 3032: no llegan mientras los relés no vuelvan).
// Uso: node bgdrain.js <dir_build>
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
function instrument(native, pl, who) {
  native.calls = { push() {}, length: 0, filter() { return []; }, slice() { return []; }, forEach() {}, map() { return []; }, some() { return false; }, find() { return undefined; } };
  if (who !== 'A') return;
  const oS = pl.saveToFile;
  pl.saveToFile = (a) => { const len = String((a && a.content) || '').length; return oS(a); };
}
async function boot(name, native) {
  native.listeners = new Map();
  const vc = new VirtualConsole();
  ['log', 'warn', 'error'].forEach((l) => vc.on(l, (...a) => logs.push(`${ts()} [${name}] ${l}: ` + a.map(String).join(' ').substring(0, 260))));
  const dom = new JSDOM(fs.readFileSync(path.join(buildDir, 'dist', 'index.html'), 'utf8'), {
    url: 'https://' + name.toLowerCase() + '.nexo.test/index.html', runScripts: 'dangerously', resources: new DL(path.join(buildDir, 'dist')), pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) {
      win.NEXO_NET_RELAYS = RELAYS; win.CapacitorCustomPlatform = { name: 'android' }; installWebCrypto(win);
      const pl = native.plugin(); instrument(native, pl, name);
      win.Capacitor = { Plugins: { NexoBLE: pl } }; win.HTMLElement.prototype.scrollTo = function () {};
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
function pickFile(p, name, b) {
  click(p.win, p.win.document.querySelector('.attach-menu-item[data-type="file"]'));
  const fin = Array.from(p.win.document.querySelectorAll('input[type=file]')).pop();
  Object.defineProperty(fin, 'files', { configurable: true, value: [new p.win.File([b], name, { type: 'application/octet-stream' })] });
  fin.dispatchEvent(new p.win.Event('change'));
}
async function addFound(p, name) {
  let add = null;
  const find = () => { const row = Array.from(p.win.document.querySelectorAll('#ble-new-device > div')).find((d) => (d.querySelector('span') || {}).textContent === name); return row && row.querySelector('button'); };
  for (let i = 0; i < 400 && !add; i++) { await sleep(100); add = find(); if (!add && !p.win.bleInterface.isScanning) click(p.win, p.win.document.getElementById('ble-scan-btn')); }
  click(p.win, add); await sleep(2000);
  return !!add;
}
async function waitFor(fn, ms) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return Math.round((Date.now() - t0) / 100) / 10; await sleep(250); } return null; }
function setVisible(p, vis) {
  const d = p.win.document; p._vis = vis ? 'visible' : 'hidden';
  if (!p._visDef) { Object.defineProperty(d, 'visibilityState', { configurable: true, get: () => p._vis }); Object.defineProperty(d, 'hidden', { configurable: true, get: () => p._vis === 'hidden' }); p._visDef = true; }
  d.dispatchEvent(new p.win.Event('visibilitychange'));
}
function shutdown(p) { try { p.win.bleInterface.net._closeAll(); p.win.bleInterface.net.relays.forEach((rl) => { rl.retryAt = Date.now() + 9e6; }); } catch (e) {} }
async function freshB(B) { const net = B.win.bleInterface.net; net._closeAll(); await sleep(300); net.relays.forEach((rl) => { rl.retryAt = 0; }); await net.tick(); return waitFor(() => net._openCount() === RELAYS.length, 20000); }

(async () => {
  const r = { prueba: 'bgdrain', build: path.basename(buildDir) };
  const r1 = new NostrRelay(), r2 = new NostrRelay();
  RELAYS = [await r1.start(), await r2.start()];
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', Object.assign({}, base, { wifi: 'casa' })), nB = new NativePhone('B', 'BB:BB:BB:BB:BB:02', Object.assign({}, base, { wifi: 'oficina' }));
  [nA, nB].forEach((n) => { radio.add(n); n.load(); });
  const A = await boot('A', nA); const B = await boot('B', nB);
  const idA = A.win.bleInterface.localNexoId.toLowerCase(), idB = B.win.bleInterface.localNexoId.toLowerCase();
  A.win.bleInterface.togglePanel(); const paired = await addFound(A, 'B'); A.win.bleInterface.togglePanel();
  if (!paired) { console.log('BGDRAIN ' + JSON.stringify(Object.assign(r, { resultado: 'FALLO', error: 'no empareja' }))); process.exit(1); }
  await openChatWith(A, 'B'); sendText(A, 'hola B'); await sleep(2000);
  await openChatWith(B, 'A'); sendText(B, 'hola A'); await sleep(2000);
  radio.block(nA, nB);
  A.win.bleInterface.net.tick(); B.win.bleInterface.net.tick();
  r.en_linea_por_internet_s = await waitFor(() => A.win.bleInterface.linkOf(idB) === 'internet' && B.win.bleInterface.linkOf(idA) === 'internet', 60000);
  const got = (t) => async () => (await B.win.vaultLoadMessages(idA)).some((m) => !m._own && String(m.content).trim() === t);
  await openChatWith(A, 'B');
  sendText(A, 'antes'); r.antes_llega_s = await waitFor(got('antes'), 30000);
  // B a segundo plano: su app deja de escuchar los relés (la parte nativa escucha por ella)
  B.win.dispatchEvent(new B.win.CustomEvent('nexo:ble:closeChat', { detail: {} }));
  setVisible(B, false); shutdown(B);
  // en el teléfono la app queda congelada en segundo plano: no vuelve a conectarse a los relés hasta volver
  const netB = B.win.bleInterface.net, realConnect = netB._connect; netB._connect = function () {};
  await sleep(1000);
  const k1 = r1.events.length, k2 = r2.events.length;
  const textos = ['uno', 'dos', 'tres'];
  for (const t of textos) { sendText(A, t); await sleep(1500); }
  await sleep(3000);
  // lo que la parte nativa de B habría recibido (eventos nuevos de los relés, sin repetir)
  const ids = new Set(); const evs = [];
  r1.events.slice(k1).concat(r2.events.slice(k2)).forEach((e) => { if (e && !ids.has(e.id)) { ids.add(e.id); evs.push(JSON.stringify(e)); } });
  r.eventos_guardados = evs.length;
  // los relés se caen (como el relé que no contestaba en el S24): solo queda lo que guardó la parte nativa
  await r1.stop(); await r2.stop();
  nB.netBgInbox = evs;
  const t0 = Date.now();
  netB._connect = realConnect;
  B.win.bleInterface.net.relays.forEach((rl) => { rl.retryAt = 0; });
  setVisible(B, true);
  const ok3 = await waitFor(async () => { for (const t of textos) if (!(await got(t)())) return false; return true; }, 15000);
  r.al_volver_estan_s = ok3;
  r.log_drain = logs.some((l) => /\[B\].*recibió en segundo plano: entran ya/.test(l));
  // 3044 (diagnóstico S24 APK 3033 22:53: «500 sobre(s) … entran ya» tras una llamada en segundo plano, con la app viva todo
  // el rato: eran repetidos, ya vistos). El registro cuenta solo los nuevos y dice cuántos estaban repetidos.
  const nLog0 = logs.length;
  setVisible(B, false); await sleep(500);
  nB.netBgInbox = evs.slice(); // los mismos sobres otra vez (la app ya los tenía)
  setVisible(B, true); await sleep(2500);
  const nuevos = logs.slice(nLog0).filter((l) => /\[B\].*\[NET\].*segundo plano/.test(l));
  r.log_repetidos = nuevos.map((l) => l.replace(/^.*\[NET\] /, '')).slice(0, 2);
  r.repetidos_no_entran = !nuevos.some((l) => /entran ya/.test(l)) && nuevos.some((l) => new RegExp(evs.length + ' repetido').test(l));
  // al abrir el chat ya están
  await openChatWith(B, 'A'); await sleep(500);
  const bubbles = Array.from(B.win.document.querySelectorAll('#messages-container .message, .message')).map((e) => e.textContent || '');
  r.en_el_chat = textos.every((t) => bubbles.some((b) => b.indexOf(t) >= 0));
  r.errores = logs.filter((l) => / error: /.test(l) && !/JSDOMERROR|styles\.css|Not implemented|GLOBAL TIMEOUT|net::ERR|fetch|ECONNREFUSED|WebSocket/.test(l)).slice(0, 5);
  const ok = r.antes_llega_s !== null && r.eventos_guardados > 0 && ok3 !== null && ok3 <= 3 && r.repetidos_no_entran && r.en_el_chat && !r.errores.length;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('BGDRAIN ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_bgdrain.txt'), logs.join('\n'));
  shutdown(A); shutdown(B);
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('BGDRAIN ' + JSON.stringify({ prueba: 'bgdrain', resultado: 'FALLO', error: String(e && e.message).replace(/"/g, "'") })); console.error(e && e.stack); fs.writeFileSync(path.join(__dirname, 'last_logs_bgdrain.txt'), logs.join('\n')); process.exit(1); });
