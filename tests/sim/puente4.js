// Dueño 13-11 — PUENTE A INTERNET, parte 4: «el cambio de Bluetooth/Wi-Fi Direct también al puente Bluetooth/internet, y que
// el cambio sea ágil». A sin internet usa a B (con internet por Wi-Fi, cerca, los dos con Wi-Fi Direct) de puente; C está lejos:
//   1. A manda a C 2 MB: los trozos del buzón de archivos van al puente en paquetes por Wi-Fi Direct y llegan idénticos;
//   2. un texto sigue por Bluetooth y llega enseguida;
//   3. C le manda a A 1,5 MB: el puente junta lo que A pidió y se lo da por Wi-Fi Direct;
//   4. Wi-Fi Direct deja de funcionar: ese archivo sigue por Bluetooth sin quedarse colgado, y lo siguiente ya no intenta
//      Wi-Fi Direct (sin esperas en cada envío);
//   5. el puente cuenta los bytes de A y no ve los archivos.
// Contraprueba 3049: 1 no llega (por un puente solo fotos pequeñas, ~300 KB) ni hay paquetes por Wi-Fi Direct.
// Uso: node puente4.js <dir_build>
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone, installWebCrypto } = require('./native_mock');
const { NostrRelay } = require('./nostr_relay');
const { importSrc } = require('./srcmod');

const buildDir = path.resolve(process.argv[2] || path.join(__dirname, 'builds/wip'));
const base = { readsContentFallback: true, retain: ['onPayloadReceived', 'onLanMessage', 'onLanUp', 'onLanDown', 'onWifiDirectReceived'], closeOnNoService: true, pace: [15, 15], ioDelay: 25, asymmetric: true, noTor: true, wifiDirect: true };
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

async function sendFile(p, name, bytes) {
  const b = Buffer.alloc(bytes); for (let i = 0; i < b.length; i++) b[i] = (i * 31 + name.length * 7) & 255;
  click(p.win, p.win.document.querySelector('.attach-menu-item[data-type="file"]')); await sleep(100);
  const fin = Array.from(p.win.document.querySelectorAll('input[type=file]')).pop();
  Object.defineProperty(fin, 'files', { configurable: true, value: [new p.win.File([b], name, { type: 'application/octet-stream' })] });
  fin.dispatchEvent(new p.win.Event('change'));
  return b;
}
async function findMsg(p, from, b64, own) {
  const list = await p.win.vaultLoadMessages(from);
  return list.find((m) => !!m._own === !!own && m.attachmentType && !m.deleted && (m.attachmentPayload || p.native.files.get(m.attachmentRef)) === b64) || null;
}
(async () => {
  const r = { prueba: 'puente4', build: path.basename(buildDir) };
  const r1 = new NostrRelay(), r2 = new NostrRelay();
  RELAYS = [await r1.start(), await r2.start()];
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', base), nB = new NativePhone('B', 'BB:BB:BB:BB:BB:02', Object.assign({}, base, { wifi: 'casaB' })), nC = new NativePhone('C', 'CC:CC:CC:CC:CC:04', Object.assign({}, base, { wifiDirect: false }));
  [nA, nB, nC].forEach((n) => { radio.add(n); n.load(); });
  const A = await boot('A', nA, true), B = await boot('B', nB), C = await boot('C', nC);
  const id = (p) => p.win.bleInterface.localNexoId.toLowerCase();
  const idA = id(A), idB = id(B), idC = id(C);
  A.win.bleInterface.togglePanel();
  const paired = (await addFound(A, 'B')) && (await addFound(A, 'C'));
  A.win.bleInterface.togglePanel();
  if (!paired) { console.log('PUENTE4 ' + JSON.stringify(Object.assign(r, { resultado: 'FALLO', error: 'no empareja' }))); process.exit(1); }
  for (const n of ['B', 'C']) { await openChatWith(A, n); sendText(A, 'hola ' + n); await sleep(1500); }
  await sleep(2000);
  radio.block(nA, nC); radio.block(nB, nC);
  [B, C].forEach((p) => p.win.bleInterface.net.tick());
  const netA = A.win.bleInterface.net, gwA = () => netA.gw, gwB = () => B.win.bleInterface.net.gw;
  r.puente_s = await waitFor(() => netA.gw && netA.gwOnly() && netA.gw.bridges.has(idB) && netA.gw.wdAny && netA.gw.wdAny(), 90000);
  r.c_en_linea_para_A_s = await waitFor(() => netA.canReach(idC), 60000);
  r.puente_wd = !!(gwA().bridges.get(idB) || {}).wd;
  await openChatWith(A, 'C');
  // 1. A → C: 2 MB por el puente, lo pesado por Wi-Fi Direct (antes: > 300 KB no salía por el puente)
  const big = await sendFile(A, 'video_2mb.mp4', 2 * 1024 * 1024), bigB64 = big.toString('base64');
  r.subida_2mb_s = await waitFor(async () => !!(await findMsg(C, idA, bigB64, false)), 150000);
  r.subida_paquetes_wd = (gwA().stats || {}).wd || 0;
  if (r.subida_2mb_s === null) return fin(false);
  // 2. un texto mientras tanto/después sigue por Bluetooth y llega enseguida
  const tTxt = Date.now(); sendText(A, 'texto por el puente');
  r.texto_s = await waitFor(async () => (await C.win.vaultLoadMessages(idA)).some((m) => !m._own && /texto por el puente/.test(m.text || m.content || '')), 30000);
  // 3. C → A: 1,5 MB; el puente lo junta y se lo da a A por Wi-Fi Direct
  await openChatWith(C, 'A');
  const down = await sendFile(C, 'fotos_c.zip', 1536 * 1024), downB64 = down.toString('base64');
  r.bajada_1_5mb_s = await waitFor(async () => !!(await findMsg(A, idC, downB64, false)), 150000);
  r.bajada_paquetes_wd = gwB().stats.wd;
  // 4. Wi-Fi Direct deja de funcionar (unirse al grupo falla): ese paquete sigue por Bluetooth al instante y lo siguiente ya
  //    no lo intenta (cambio ágil: sin esperas por cada envío)
  nA.opts.wdFail = true;
  await openChatWith(A, 'C');
  const mid = await sendFile(A, 'foto_600kb.jpg', 600 * 1024), midB64 = mid.toString('base64');
  r.falla_wd_llega_s = await waitFor(async () => !!(await findMsg(C, idA, midB64, false)), 180000);
  r.falla_wd_logs = logs.filter((l) => /\[A\].*Wi-Fi Direct con .* no funcionó/.test(l)).length;
  const wdTries0 = (nA.stats.wdGroups || 0) + (nB.stats.wdGroups || 0);
  const small = await sendFile(A, 'foto_120kb.jpg', 120 * 1024), smallB64 = small.toString('base64');
  r.tras_falla_120kb_s = await waitFor(async () => !!(await findMsg(C, idA, smallB64, false)), 90000);
  r.tras_falla_intentos_wd = (nA.stats.wdGroups || 0) + (nB.stats.wdGroups || 0) - wdTries0;
  r.bytes_contados_kb = Math.round(((gwB().blobBytes.get(idA) || {}).d || 0) / 1024);
  r.b_ve_archivos = (await B.win.vaultLoadMessages(idA)).concat(await B.win.vaultLoadMessages(idC)).filter((m) => m.attachmentType).length;
  const ok = r.puente_s !== null && r.puente_wd && r.subida_2mb_s !== null && r.subida_paquetes_wd >= 1 && r.texto_s !== null && r.texto_s < 15 &&
    r.bajada_1_5mb_s !== null && r.bajada_paquetes_wd >= 1 && r.falla_wd_llega_s !== null && r.falla_wd_logs >= 1 && r.tras_falla_120kb_s !== null &&
    r.tras_falla_intentos_wd === 0 && r.b_ve_archivos === 0;
  return fin(ok);
  async function fin(ok0) {
    r.errores = logs.filter((l) => / error: /.test(l) && !/JSDOMERROR|styles\.css|Not implemented|GLOBAL TIMEOUT|net::ERR|fetch|ECONNREFUSED|WebSocket/.test(l)).slice(0, 5);
    const ok = ok0 && !r.errores.length;
    r.resultado = ok ? 'OK' : 'FALLO';
    console.log('PUENTE4 ' + JSON.stringify(r));
    fs.writeFileSync(path.join(__dirname, 'last_logs_puente4.txt'), logs.join('\n'));
    [A, B, C].forEach(shutdown);
    await r1.stop(); await r2.stop();
    process.exit(ok ? 0 : 1);
  }
})().catch((e) => { console.log('PUENTE4 ' + JSON.stringify({ prueba: 'puente4', resultado: 'FALLO', error: String(e && e.message).replace(/"/g, "'") })); console.error(e && e.stack); fs.writeFileSync(path.join(__dirname, 'last_logs_puente4.txt'), logs.join('\n')); process.exit(1); });
