// 3179 (ciudad 17-11, semilla 1 #127, 2 #137, 3 #110: «Faltan N de N trozos», esperas de 30 s → 2 min → 8 min): un teléfono SIN
// internet propio (H) usa a P de puente; C (lejos, con internet) le manda un archivo por el buzón de archivos. Por el puente la
// bajada no sale (aquí el puente no consigue pasar los trozos: el relé no se los sirve a las conexiones de P) y queda esperando su
// turno. Cuando H tiene internet PROPIO (con el puente aún abierto) debe reintentar YA: antes, _netOnline solo se avisaba al abrir
// la PRIMERA conexión a un relé y la del puente ya contaba, así que la bajada seguía esperando su turno (2 u 8 min).
// Uso: node blobpuente.js <dir_build>
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone, installWebCrypto } = require('./native_mock');
const { NostrRelay } = require('./nostr_relay');

const buildDir = path.resolve(process.argv[2] || path.join(__dirname, 'builds/wip'));
const base = { readsContentFallback: true, retain: ['onPayloadReceived', 'onLanMessage', 'onLanUp', 'onLanDown'], closeOnNoService: true, pace: [15, 15], ioDelay: 25, asymmetric: true, noTor: true };
let RELAYS = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
class DL extends ResourceLoader { constructor(d) { super(); this.d = d; } fetch(u) { const f = path.join(this.d, decodeURIComponent(new URL(u).pathname)); return fs.existsSync(f) ? Promise.resolve(fs.readFileSync(f)) : Promise.reject(new Error('x')); } }
class NoNetWS { constructor(u) { this.url = u; this.readyState = 0; setTimeout(() => { this.readyState = 3; if (this.onerror) this.onerror({}); if (this.onclose) this.onclose({ code: 1006 }); }, 30); } send() { throw new Error('sin red'); } close() {} addEventListener() {} removeEventListener() {} }
const logs = [];
const T0 = Date.now();
const ts = () => String(((Date.now() - T0) / 1000).toFixed(1)).padStart(6) + 's';
const TAG = (p) => 'p=' + p.name + '_';
async function boot(p) {
  p.native.listeners = new Map();
  p.native.calls = { push() {}, length: 0, filter() { return []; }, slice() { return []; }, forEach() {}, map() { return []; }, some() { return false; }, find() { return undefined; } };
  const vc = new VirtualConsole();
  ['log', 'warn', 'error'].forEach((l) => vc.on(l, (...a) => logs.push(`${ts()} [${p.name}] ${l}: ` + a.map(String).join(' ').substring(0, 260))));
  const dom = new JSDOM(fs.readFileSync(path.join(buildDir, 'dist', 'index.html'), 'utf8'), {
    url: 'https://' + p.name.toLowerCase() + '.nexo.test/index.html', runScripts: 'dangerously', resources: new DL(path.join(buildDir, 'dist')), pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) {
      win.NEXO_NET_RELAYS = RELAYS.slice(); win.CapacitorCustomPlatform = { name: 'android' }; installWebCrypto(win);
      win.Capacitor = { Plugins: { NexoBLE: p.native.plugin() } }; win.HTMLElement.prototype.scrollTo = function () {};
      const Real = win.WebSocket;
      const tagged = (u) => { try { const x = new URL(String(u)); if (x.hostname === '127.0.0.1') { x.searchParams.set('p', p.name + '_'); return x.toString(); } } catch (e) {} return u; };
      const WS = function (u, pr) { if (p.noNet) return new NoNetWS(u); return pr ? new Real(tagged(u), pr) : new Real(tagged(u)); };
      WS.CONNECTING = 0; WS.OPEN = 1; WS.CLOSING = 2; WS.CLOSED = 3; WS.prototype = Real.prototype;
      win.WebSocket = WS;
    },
  });
  const win = dom.window;
  for (let i = 0; i < 100 && !(win.NEXO && win.NEXO.initialized); i++) await sleep(100);
  await sleep(800);
  p.win = win;
  return p;
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
async function waitFor(fn, ms) { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (await fn()) return Math.round((Date.now() - t0) / 100) / 10; } catch (e) {} await sleep(250); } return null; }
function shutdown(p) { try { p.win.bleInterface.net._closeAll(); p.win.bleInterface.net.relays.forEach((rl) => { rl.retryAt = Date.now() + 9e6; }); } catch (e) {} }
async function sendFile(p, name, bytes) {
  const b = Buffer.alloc(bytes); for (let i = 0; i < b.length; i++) b[i] = (i * 31 + name.length * 7) & 255;
  click(p.win, p.win.document.querySelector('.attach-menu-item[data-type="file"]')); await sleep(100);
  const fin = Array.from(p.win.document.querySelectorAll('input[type=file]')).pop();
  Object.defineProperty(fin, 'files', { configurable: true, value: [new p.win.File([b], name, { type: 'application/octet-stream' })] });
  fin.dispatchEvent(new p.win.Event('change'));
  return b;
}
async function findMsg(p, from, b64) {
  const list = await p.win.vaultLoadMessages(from);
  return list.find((m) => !m._own && m.attachmentType && !m.deleted && (m.attachmentPayload || p.native.files.get(m.attachmentRef)) === b64) || null;
}
const fails = (name) => logs.filter((l) => l.indexOf('[' + name + '] warn: [BLOB]') >= 0 && /no se pudo bajar/.test(l)).length;

(async () => {
  const r = { prueba: 'blobpuente', build: path.basename(buildDir) };
  const r1 = new NostrRelay(), r2 = new NostrRelay(), relays = [r1, r2];
  RELAYS = [await r1.start(), await r2.start()];
  const radio = new Radio();
  const H = { name: 'H', noNet: true, native: new NativePhone('H', 'AA:AA:AA:AA:AA:01', base) };
  const P = { name: 'P', native: new NativePhone('P', 'BB:BB:BB:BB:BB:02', base) };
  const C = { name: 'C', native: new NativePhone('C', 'CC:CC:CC:CC:CC:04', base) };
  [H, P, C].forEach((p) => { radio.add(p.native); p.native.load(); });
  H.native.setNetwork('none');
  await boot(H); await boot(P); await boot(C);
  const id = (p) => p.win.bleInterface.localNexoId.toLowerCase();
  const idH = id(H), idP = id(P), idC = id(C);
  H.win.bleInterface.togglePanel();
  const paired = (await addFound(H, 'P')) && (await addFound(H, 'C'));
  H.win.bleInterface.togglePanel();
  if (!paired) { console.log('BLOBPUENTE ' + JSON.stringify(Object.assign(r, { resultado: 'FALLO', error: 'no empareja' }))); process.exit(1); }
  for (const n of ['P', 'C']) { await openChatWith(H, n); sendText(H, 'hola ' + n); await sleep(1500); }
  await sleep(2000);
  radio.block(H.native, C.native); radio.block(P.native, C.native);
  [P, C].forEach((p) => p.win.bleInterface.net.tick());
  const netH = H.win.bleInterface.net;
  r.puente_s = await waitFor(() => netH.gw && netH.gwOnly() && netH.gw.bridges.has(idP), 90000);
  r.c_en_linea_para_H_s = await waitFor(() => netH.canReach(idC), 60000);
  // El puente no consigue pasar los trozos del buzón de archivos (en la ciudad: su tope de datos por hora y su cola llena)
  relays.forEach((x) => x.hideTag(TAG(P), 1064));
  await openChatWith(C, 'H');
  const f = await sendFile(C, 'foto_para_h.jpg', 60000), b64 = f.toString('base64');
  r.puntero_s = await waitFor(() => logs.some((l) => l.indexOf('[H] log: [BLOB] Puntero de') >= 0), 60000);
  // dos intentos por el puente que fallan: el siguiente queda para dentro de 2 min
  r.fallos_por_puente_s = await waitFor(() => fails('H') >= 2, 200000);
  r.llego_por_puente = !!(await findMsg(H, idC, b64));
  // H tiene internet PROPIO (el puente sigue abierto un rato)
  H.noNet = false; H.native.setNetwork('cell');
  r.internet_propio_s = await waitFor(() => netH._realOpenCount() > 0, 30000);
  const tOwn = Date.now();
  r.llega_tras_internet_propio_s = await waitFor(async () => !!(await findMsg(H, idC, b64)), 150000);
  r.reintento_al_tener_internet = logs.some((l) => /\[H\] log: \[NET\].*[Ii]nternet propio/.test(l));
  r.fallos_por_puente = fails('H');
  r.errores = logs.filter((l) => / error: /.test(l) && !/JSDOMERROR|styles\.css|Not implemented|GLOBAL TIMEOUT|net::ERR|fetch|ECONNREFUSED|WebSocket/.test(l)).slice(0, 5);
  const ok = r.puente_s !== null && r.puntero_s !== null && r.fallos_por_puente_s !== null && !r.llego_por_puente && r.internet_propio_s !== null &&
    r.llega_tras_internet_propio_s !== null && r.llega_tras_internet_propio_s <= 20 && !r.errores.length;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('BLOBPUENTE ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_blobpuente.txt'), logs.join('\n'));
  [H, P, C].forEach(shutdown);
  await r1.stop(); await r2.stop();
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('BLOBPUENTE ' + JSON.stringify({ prueba: 'blobpuente', resultado: 'FALLO', error: String(e && e.message).replace(/"/g, "'") })); console.error(e && e.stack); fs.writeFileSync(path.join(__dirname, 'last_logs_blobpuente.txt'), logs.join('\n')); process.exit(1); });
