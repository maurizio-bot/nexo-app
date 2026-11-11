// Investigación 11-11 §9 (primera prueba real de la 3004, diagnóstico S24 12:17 UTC): un APK de 25 MB por internet se para en
// el trozo 180/2213 porque el que recibe deja de contestar; en TODOS los envíos de 25 MB por relés a teléfonos de amigos pasó
// igual (96–411 trozos). Esta prueba reproduce, con dos teléfonos en Wi-Fi distintas (solo internet, relés):
//  C1  el receptor se CALLA a mitad (no le llegan los trozos ~150 s, más que los 120 s en que tira lo recibido) y vuelve:
//      ¿termina? ¿cuántos trozos hubo que volver a mandar? ¿cuánto tráfico mandó el emisor mientras el otro callaba?
//  C3  (3006) el contacto SALE de internet a mitad (el emisor lo ve «ya no está en línea») y vuelve: antes el envío se
//      abortaba en el acto y el siguiente intento empezaba de cero.
//  C2  el receptor se REINICIA a mitad (app cerrada y abierta): ¿sigue donde iba o empieza de cero?
// Deseado (arreglo (a)/(b)): termina en los dos casos, vuelve a mandar < 25 % de los trozos y, callado el otro, el emisor no
// inunda los relés (≤ 1 ventana por minuto). Uso: node netsilence.js <dir_build>
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
const BYTES = 4000000;                      // 4 MB → ~5,3 M caracteres en base64 (~335 trozos de 16 000)
const SILENCE_MS = 150000;
async function waitFor(fn, ms) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return Math.round((Date.now() - t0) / 100) / 10; await sleep(250); } return null; }
function shutdown(p) {
  try { p.win.bleInterface.net._closeAll(); p.win.bleInterface.net.relays.forEach((rl) => { rl.retryAt = Date.now() + 9e6; }); } catch (e) {}
  p.win.close(); p.native.destroyActivity();
}
async function filesAt(p, from) { const l = await p.win.vaultLoadMessages(from); return l.filter((m) => !m._own && (m.attachmentRef || m.attachmentPayload) && m.attachmentType === 'file'); }
function rxProgress(p) { let best = null; try { p.win.bleInterface.ackSystem.incomingBuffers.forEach((b) => { if (b && b.total > 100 && (!best || b.received > best.received)) best = b; }); } catch (e) {} return best ? { rx: best.received, total: best.total } : null; }
// trozos de archivo que A publica por internet (contenido > 10 000 car.)
let chunkSends = 0, chunkSendsAt = [];
function countSends(p) { const net = p.win.bleInterface.net; const o = net.send.bind(net); net.send = (nx, content, opts) => { if (String(content || '').length > 10000) { chunkSends++; chunkSendsAt.push(Date.now()); } return o(nx, content, opts); }; }
function silence(p, on) { const bi = p.win.bleInterface; if (!bi.__origNP) bi.__origNP = bi._onNetPayload.bind(bi); bi._onNetPayload = on ? function () {} : bi.__origNP; }

(async () => {
  const r = { prueba: 'netsilence', build: path.basename(buildDir) };
  const AK = await importSrc('ui/ble_ack.js');
  r.pura_espera = typeof AK._assemblyTimeoutFor === 'function' ? (AK._assemblyTimeoutFor(true, false, 2213) >= 1800000 && AK._assemblyTimeoutFor(true, true, 2213) === 120000 && AK._assemblyTimeoutFor(false, false, 2213) === 120000 && AK._assemblyTimeoutFor(true, false, 10) === 120000) : false;
  const r1 = new NostrRelay(), r2 = new NostrRelay();
  RELAYS = [await r1.start(), await r2.start()];
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', Object.assign({}, base, { wifi: 'casa' })), nB = new NativePhone('B', 'BB:BB:BB:BB:BB:02', Object.assign({}, base, { wifi: 'oficina' }));
  [nA, nB].forEach((n) => { radio.add(n); n.load(); });
  const A = await boot('A', nA); let B = await boot('B', nB);
  const idA = A.win.bleInterface.localNexoId.toLowerCase(), idB = B.win.bleInterface.localNexoId.toLowerCase();
  A.win.bleInterface.togglePanel(); const paired = await addFound(A, 'B'); A.win.bleInterface.togglePanel();
  if (!paired) { console.log('NETSILENCE ' + JSON.stringify(Object.assign(r, { resultado: 'FALLO', error: 'no empareja' }))); process.exit(1); }
  await openChatWith(A, 'B'); sendText(A, 'hola B'); await sleep(2000);
  await openChatWith(B, 'A'); sendText(B, 'hola A'); await sleep(2000);
  radio.block(nA, nB);
  A.win.bleInterface.net.tick(); B.win.bleInterface.net.tick();
  r.en_linea_por_internet_s = await waitFor(() => A.win.bleInterface.linkOf(idB) === 'internet' && B.win.bleInterface.linkOf(idA) === 'internet', 60000);
  await openChatWith(A, 'B');
  countSends(A);
  const buf = Buffer.alloc(BYTES); for (let i = 0; i < buf.length; i++) buf[i] = (i * 31 + 7) & 255;

  // ---- C1: el receptor se calla a mitad y vuelve ----
  pickFile(A, 'uno.bin', buf);
  await waitFor(() => { const g = rxProgress(B); return g && g.rx >= g.total * 0.3; }, 120000);
  const g1 = rxProgress(B); r.C1_total = g1 && g1.total; r.C1_recibidos_antes = g1 && g1.rx;
  const sendsBefore = chunkSends;
  silence(B, true); const tS = Date.now();
  await sleep(SILENCE_MS);
  r.C1_trozos_mandados_callado = chunkSends - sendsBefore;
  r.C1_por_minuto_callado = Math.round((chunkSends - sendsBefore) / (SILENCE_MS / 60000));
  r.C1_receptor_conserva = !!rxProgress(B);
  silence(B, false);
  const sendsBack = chunkSends;
  r.C1_llega_s = await waitFor(async () => (await filesAt(B, idA)).length >= 1, 300000);
  r.C1_trozos_tras_volver = chunkSends - sendsBack;
  r.C1_reenviado_pct = r.C1_total ? Math.round(100 * Math.max(0, (chunkSends - sendsBefore) - (r.C1_total - r.C1_recibidos_antes)) / r.C1_total) : null;

  // ---- C3 (3006): el contacto SALE de internet a mitad (A lo ve «ya no está en línea»: _netDown) y vuelve ----
  const s3 = chunkSends;
  pickFile(A, 'tres.bin', buf);
  await waitFor(() => { const g = rxProgress(B); return g && g.rx >= g.total * 0.3; }, 120000);
  const g3 = rxProgress(B); r.C3_recibidos_antes = g3 && g3.rx; r.C3_total = g3 && g3.total;
  const bigStream = () => { let f = null; A.win.bleInterface.ackSystem.outgoingStreams.forEach((st, id) => { if (st && st.type === 'file' && st.total > 100) f = { id, st }; }); return f; };
  const st3 = bigStream(); r.C3_hay_envio = !!st3;
  const netA = A.win.bleInterface.net; const origDeliver = netA._deliver.bind(netA); let cutB = true;
  netA._deliver = (nx, o) => { if (cutB && nx === idB) return; return origDeliver(nx, o); };
  silence(B, true);
  const pB = netA.peers.get(idB); if (pB) { pB.up = false; pB.lastRx = 0; }
  A.win.bleInterface._netDown(idB);
  await sleep(60000);
  r.C3_envio_sigue_vivo = !!(st3 && A.win.bleInterface.ackSystem.outgoingStreams.get(st3.id) === st3.st && !st3.st.aborted);
  cutB = false; silence(B, false);
  r.C3_llega_s = await waitFor(async () => (await filesAt(B, idA)).length >= 2, 300000);
  r.C3_trozos_total = chunkSends - s3;
  r.C3_reenviado_pct = r.C3_total ? Math.round(100 * Math.max(0, r.C3_trozos_total - r.C3_total) / r.C3_total) : null;

  // ---- C2: el receptor se reinicia a mitad ----
  const s2 = chunkSends;
  pickFile(A, 'dos.bin', buf);
  await waitFor(() => { const g = rxProgress(B); return g && g.rx >= g.total * 0.3; }, 120000);
  const g2 = rxProgress(B); r.C2_recibidos_antes = g2 && g2.rx; r.C2_total = g2 && g2.total;
  const sentBefore2 = chunkSends - s2;
  shutdown(B); await sleep(5000);
  nB.load(); B = await boot('B', nB);
  r.C2_llega_s = await waitFor(async () => (await filesAt(B, idA)).length >= 3, 400000);
  r.C2_trozos_total = chunkSends - s2;
  r.C2_reenviado_pct = r.C2_total ? Math.round(100 * Math.max(0, r.C2_trozos_total - r.C2_total) / r.C2_total) : null;
  r.C2_mandados_antes_del_reinicio = sentBefore2;

  r.errores = logs.filter((l) => / error: /.test(l) && !/JSDOMERROR|styles\.css|Not implemented|GLOBAL TIMEOUT|net::ERR|fetch/.test(l)).slice(0, 5);
  const ok = r.pura_espera && r.en_linea_por_internet_s !== null && r.C1_receptor_conserva && r.C1_llega_s !== null && r.C1_reenviado_pct !== null && r.C1_reenviado_pct < 25 && r.C1_por_minuto_callado <= 12 &&
    r.C3_envio_sigue_vivo && r.C3_llega_s !== null && r.C3_reenviado_pct !== null && r.C3_reenviado_pct < 25 &&
    r.C2_llega_s !== null && r.C2_reenviado_pct !== null && r.C2_reenviado_pct < 25 && !r.errores.length;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('NETSILENCE ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_netsilence.txt'), logs.join('\n'));
  await r1.stop(); await r2.stop();
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('NETSILENCE ' + JSON.stringify({ prueba: 'netsilence', resultado: 'FALLO', error: String(e && e.message).replace(/"/g, "'") })); console.error(e && e.stack); fs.writeFileSync(path.join(__dirname, 'last_logs_netsilence.txt'), logs.join('\n')); process.exit(1); });
