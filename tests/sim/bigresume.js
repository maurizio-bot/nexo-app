// 3007 (dueño 11-11: «(a) aquí está mi OK»): un archivo GRANDE por internet sigue DONDE IBA aunque se reinicie la app de
// cualquiera de los dos (o pase más de 30 min). Dos teléfonos en Wi-Fi distintas (solo internet, relés), archivo de 4 MB (340 trozos):
//  R1  se reinicia la app del que ENVÍA a mitad: al volver sigue con lo guardado (misma marca, sin releer ni cifrar el adjunto);
//      el que recibe solo recibe lo que le faltaba (+ una ventana repetida). Antes: intento nuevo → el receptor empezaba de cero.
//  R2  se reinicia la app del que RECIBE a mitad y los relés NO guardan los trozos: rehace lo recibido desde el teléfono y el que
//      envía salta hasta ahí. Antes: el receptor pedía todo desde el trozo 0.
//  Los dos llegan íntegros y al terminar no queda nada guardado (ni del que envía ni del que recibe).
// Uso: node bigresume.js <dir_build>
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


const rxCount = new Map();   // msgId → trozos que llegan a B (incluidos los repetidos)
function countRx(p) {
  const ak = p.win.bleInterface.ackSystem; const o = ak._handleIncomingChunk.bind(ak);
  ak._handleIncomingChunk = (dev, msg, type, rxTs) => { const id = msg && (msg.m || msg.msgId); if (id && type !== 'c') rxCount.set(id, (rxCount.get(id) || 0) + 1); return o(dev, msg, type, rxTs); };
}
const bigxFiles = (native, dir) => Array.from(native.files.keys()).filter((k) => k.indexOf('nexo_att_bigx' + dir + '_') === 0);
async function fileIntact(p, from, n, b64) {
  const l = await filesAt(p, from); if (l.length < n) return false;
  const m = l[n - 1]; const ref = m.attachmentRef; const c = ref ? p.native.files.get(ref) : m.attachmentPayload;
  return typeof c === 'string' && c.indexOf(b64.slice(0, 300)) >= 0 && c.indexOf(b64.slice(-300)) >= 0 && c.indexOf(b64.slice(2000000, 2000300)) >= 0;
}
function bigStreamId(p) { let f = null; p.win.bleInterface.ackSystem.outgoingStreams.forEach((st, id) => { if (st && st.type === 'file' && st.total > 100) f = id; }); return f; }

(async () => {
  const r = { prueba: 'bigresume', build: path.basename(buildDir) };
  const AK = await importSrc('ui/ble_ack.js');
  if (typeof AK._bigxFullBlock === 'function') {
    const m = new Map(); for (let i = 0; i < 200; i++) m.set(i, 'x'); m.set(70, null);
    r.pura_bloque = !!AK._bigxFullBlock(m, 0, 200) && AK._bigxFullBlock(m, 1, 200) === null && AK._bigxFullBlock(m, 3, 200) === null && AK._bigxFullBlock(m, 2, 200) !== null;
  } else r.pura_bloque = false;
  const r1 = new NostrRelay(), r2 = new NostrRelay();
  RELAYS = [await r1.start(), await r2.start()];
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', Object.assign({}, base, { wifi: 'casa' })), nB = new NativePhone('B', 'BB:BB:BB:BB:BB:02', Object.assign({}, base, { wifi: 'oficina' }));
  [nA, nB].forEach((n) => { radio.add(n); n.load(); });
  let A = await boot('A', nA); let B = await boot('B', nB);
  const idA = A.win.bleInterface.localNexoId.toLowerCase(), idB = B.win.bleInterface.localNexoId.toLowerCase();
  A.win.bleInterface.togglePanel(); const paired = await addFound(A, 'B'); A.win.bleInterface.togglePanel();
  if (!paired) { console.log('BIGRESUME ' + JSON.stringify(Object.assign(r, { resultado: 'FALLO', error: 'no empareja' }))); process.exit(1); }
  await openChatWith(A, 'B'); sendText(A, 'hola B'); await sleep(2000);
  await openChatWith(B, 'A'); sendText(B, 'hola A'); await sleep(2000);
  radio.block(nA, nB);
  A.win.bleInterface.net.tick(); B.win.bleInterface.net.tick();
  r.en_linea_por_internet_s = await waitFor(() => A.win.bleInterface.linkOf(idB) === 'internet' && B.win.bleInterface.linkOf(idA) === 'internet', 60000);
  await openChatWith(A, 'B');
  countRx(B);
  const buf = Buffer.alloc(BYTES); for (let i = 0; i < buf.length; i++) buf[i] = (i * 31 + 7) & 255;
  const b64 = buf.toString('base64');

  // ---- R1: se reinicia la app del que ENVÍA a mitad ----
  pickFile(A, 'uno.bin', buf);
  await waitFor(() => { const g = rxProgress(B); return g && g.rx >= g.total * 0.4; }, 120000);
  const id1 = bigStreamId(A); r.R1_id = !!id1;
  const g1 = rxProgress(B); r.R1_total = g1 && g1.total; r.R1_recibidos_antes = g1 && g1.rx;
  r.R1_guardado_emisor = await waitFor(() => bigxFiles(nA, 'o').length > 0 && /nexo_bigx_out|bigx/.test(String(nA.files.get('nexo_bigx_out.json') || '')) , 20000) !== null;
  const rxBefore1 = rxCount.get(id1) || 0;
  const mark1 = logs.length;
  shutdown(A); await sleep(3000);
  nA.load(); A = await boot('A', nA);
  await openChatWith(A, 'B');
  r.R1_llega_s = await waitFor(async () => (await filesAt(B, idA)).length >= 1, 300000);
  const lg1 = logs.slice(mark1).join('\n');
  r.R1_sigue_lo_guardado = /sigo el archivo grande donde iba/.test(lg1);
  r.R1_sin_releer_adjunto = !/\[A\].*se cargan 1 adjunto/.test(lg1);
  r.R1_trozos_tras_reinicio = (rxCount.get(id1) || 0) - rxBefore1;
  r.R1_repetidos_pct = r.R1_total ? Math.round(100 * Math.max(0, r.R1_trozos_tras_reinicio - (r.R1_total - r.R1_recibidos_antes)) / r.R1_total) : null;
  r.R1_integro = await fileIntact(B, idA, 1, b64);

  // ---- R2: se reinicia la app del que RECIBE a mitad y los relés no guardan nada ----
  chunkSends = 0; countSends(A);
  pickFile(A, 'dos.bin', buf);
  await waitFor(() => { const g = rxProgress(B); return g && g.rx >= g.total * 0.4; }, 120000);
  const g2 = rxProgress(B); r.R2_total = g2 && g2.total; r.R2_recibidos_antes = g2 && g2.rx;
  r.R2_guardado_receptor = await waitFor(() => bigxFiles(nB, 'i').length >= 2, 20000) !== null;
  const sends2 = chunkSends;
  const mark2 = logs.length;
  shutdown(B);
  r1.events.length = 0; r2.events.length = 0;   // los relés no guardan lo que pasó
  await sleep(3000);
  nB.load(); B = await boot('B', nB); countRx(B);
  r.R2_llega_s = await waitFor(async () => (await filesAt(B, idA)).length >= 2, 400000);
  const lg2 = logs.slice(mark2).join('\n');
  r.R2_rehace_lo_recibido = /sigo recibiendo el archivo grande donde iba/.test(lg2);
  r.R2_trozos_tras_reinicio = chunkSends - sends2;
  r.R2_repetidos_pct = r.R2_total ? Math.round(100 * Math.max(0, r.R2_trozos_tras_reinicio - (r.R2_total - r.R2_recibidos_antes)) / r.R2_total) : null;
  r.R2_integro = await fileIntact(B, idA, 2, b64);

  await sleep(3000);
  r.limpio_emisor = bigxFiles(nA, 'o').length === 0 && !/msg/.test(String(nA.files.get('nexo_bigx_out.json') || ''));
  r.limpio_receptor = bigxFiles(nB, 'i').length === 0 && !/msg/.test(String(nB.files.get('nexo_bigx_in.json') || ''));
  r.errores = logs.filter((l) => / error: /.test(l) && !/JSDOMERROR|styles\.css|Not implemented|GLOBAL TIMEOUT|net::ERR|fetch/.test(l)).slice(0, 5);
  const ok = r.pura_bloque && r.en_linea_por_internet_s !== null &&
    r.R1_llega_s !== null && r.R1_sigue_lo_guardado && r.R1_sin_releer_adjunto && r.R1_repetidos_pct !== null && r.R1_repetidos_pct < 15 && r.R1_integro &&
    r.R2_llega_s !== null && r.R2_rehace_lo_recibido && r.R2_repetidos_pct !== null && r.R2_repetidos_pct < 25 && r.R2_integro &&
    r.limpio_emisor && r.limpio_receptor && !r.errores.length;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('BIGRESUME ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_bigresume.txt'), logs.join('\n'));
  await r1.stop(); await r2.stop();
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('BIGRESUME ' + JSON.stringify({ prueba: 'bigresume', resultado: 'FALLO', error: String(e && e.message).replace(/"/g, "'") })); console.error(e && e.stack); fs.writeFileSync(path.join(__dirname, 'last_logs_bigresume.txt'), logs.join('\n')); process.exit(1); });
