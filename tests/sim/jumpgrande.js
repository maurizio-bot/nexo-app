// Diagnóstico automático del vivo (3031, 12-11 22:00): 3 archivos de ~25 MB pendientes para un contacto lejano (…707a) desde
// hace 11 días. Cada vez que el vivo veía al S24 (por Wi-Fi), lo usaba de puente Jump: leía 75 MB del disco («leyendo lento»)
// y los intentaba mandar por el S24 para fallar después («no cabe por Bluetooth») — en cada vuelta. La regla 2974 («un archivo
// que no cabe por Bluetooth tampoco cabe por un puente») solo miraba puentes por Bluetooth; por un puente por Wi-Fi el
// siguiente tramo sigue siendo Bluetooth.
// A y B en la misma Wi-Fi (sin Bluetooth entre ellos), C lejos (solo por Bluetooth con B). A le deja a C un archivo de 3 MB y una
// foto pequeña; aparece la ruta por B: la foto llega y el archivo grande NO se lee del disco ni se intenta (espera Wi-Fi/internet).
// Uso: node jumpgrande.js <dir_build>
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone, installWebCrypto } = require('./native_mock');
const { NostrRelay } = require('./nostr_relay');

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
async function boot(name, native) {
  native.listeners = new Map();
  native.calls = { push() {}, length: 0, filter() { return []; }, slice() { return []; }, forEach() {}, map() { return []; }, some() { return false; }, find() { return undefined; } };
  const vc = new VirtualConsole();
  ['log', 'warn', 'error'].forEach((l) => vc.on(l, (...a) => logs.push(`${ts()} [${name}] ${l}: ` + a.map(String).join(' ').substring(0, 260))));
  const dom = new JSDOM(fs.readFileSync(path.join(buildDir, 'dist', 'index.html'), 'utf8'), {
    url: 'https://' + name.toLowerCase() + '.nexo.test/index.html', runScripts: 'dangerously', resources: new DL(path.join(buildDir, 'dist')), pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) {
      win.NEXO_NET_RELAYS = RELAYS; win.CapacitorCustomPlatform = { name: 'android' }; installWebCrypto(win);
      win.Capacitor = { Plugins: { NexoBLE: native.plugin() } }; win.HTMLElement.prototype.scrollTo = function () {};
      // internet que se puede quitar y devolver (win.__noNet)
      const Real = win.WebSocket; win.__noNet = true;
      win.WebSocket = function (u) { return win.__noNet ? new NoNetWS(u) : new Real(u); };
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
async function closeChat(p) { p.win.dispatchEvent(new p.win.CustomEvent('nexo:ble:closeChat', { detail: {} })); await sleep(300); }
function typeSend(p, t) { const i = p.win.document.getElementById('message-input'); i.value = t; i.dispatchEvent(new p.win.Event('input', { bubbles: true })); click(p.win, p.win.document.getElementById('send-btn')); }
async function addFound(p, name) {
  let add = null;
  const find = () => { const row = Array.from(p.win.document.querySelectorAll('#ble-new-device > div')).find((d) => (d.querySelector('span') || {}).textContent === name); return row && row.querySelector('button'); };
  for (let i = 0; i < 400 && !add; i++) { await sleep(100); add = find(); if (!add && !p.win.bleInterface.isScanning) click(p.win, p.win.document.getElementById('ble-scan-btn')); }
  click(p.win, add); await sleep(2500);
  return !!add;
}
async function waitFor(fn, ms) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return Math.round((Date.now() - t0) / 100) / 10; await sleep(200); } return null; }
function shutdown(p) { try { p.win.bleInterface.net._closeAll(); p.win.bleInterface.net.relays.forEach((rl) => { rl.retryAt = Date.now() + 9e6; }); } catch (e) {} }
function makeFile(name, bytes) { let h = 0; for (const ch of name) h = (h * 33 + ch.charCodeAt(0)) & 0xffff; const b = Buffer.alloc(bytes); for (let i = 0; i < b.length; i++) b[i] = (i * 31 + h + (i >> 9)) & 255; return b; }

(async () => {
  const r = { prueba: 'jumpgrande', build: path.basename(buildDir) };
  const radio = new Radio();
  const nat = { A: new NativePhone('A', 'AA:AA:AA:AA:AA:01', base), B: new NativePhone('B', 'BB:BB:BB:BB:BB:02', base), C: new NativePhone('C', 'CC:CC:CC:CC:CC:04', base) };
  Object.values(nat).forEach((n) => { radio.add(n); n.load(); });
  const P = { A: await boot('A', nat.A), B: await boot('B', nat.B), C: await boot('C', nat.C) };
  const id = (n) => P[n].win.bleInterface.localNexoId.toLowerCase();
  const names = ['A', 'B', 'C'];
  let open = { A: null, B: null, C: null };
  async function chat(a, b) { if (open[a] !== b) { if (open[a]) await closeChat(P[a]); await openChatWith(P[a], b); open[a] = b; } }
  async function pair(x, y) {
    const others = names.filter((n) => n !== x && n !== y);
    others.forEach((o) => radio.block(nat[x], nat[o]));
    P[x].win.bleInterface.togglePanel(); const ok = await addFound(P[x], y); P[x].win.bleInterface.togglePanel();
    await sleep(800);
    await chat(x, y); typeSend(P[x], 'hola ' + y); await sleep(2500);
    const keyOf = (a, b) => !!(P[a].win.vaultLoadContacts().find((c) => c.name === b) || {}).publicKey;
    for (let i = 0; i < 40 && !keyOf(x, y); i++) await sleep(500);
    others.forEach((o) => radio.unblock(nat[x], nat[o]));
    return ok;
  }
  for (const [x, y] of [['A', 'B'], ['A', 'C'], ['B', 'C']]) if (!(await pair(x, y))) { console.log('JUMPGRANDE ' + JSON.stringify(Object.assign(r, { resultado: 'FALLO', error: 'no empareja ' + x + y }))); process.exit(1); }
  // C lejos de A y de B; A y B en la misma Wi-Fi y sin Bluetooth entre ellos (el puente es por Wi-Fi, como el Vivo con el S24)
  radio.block(nat.A, nat.C); radio.block(nat.B, nat.C); radio.block(nat.A, nat.B);
  nat.A.setWifi('casa'); nat.B.setWifi('casa'); setTimeout(() => { nat.A.emit('onLanNet', { wifi: true }); nat.B.emit('onLanNet', { wifi: true }); }, 1500);
  r.wifi_ab_s = await waitFor(() => !!(P.A.win.bleInterface.lan && P.A.win.bleInterface.lan.canReach(id('B'))), 60000);
  // A le manda a C un archivo de 3 MB (no cabe por Bluetooth) y una foto pequeña: sin camino, quedan ⏳
  await chat('A', 'C');
  const mark = logs.length;
  const big = Buffer.alloc(3 * 1024 * 1024); for (let i = 0; i < big.length; i++) big[i] = (i * 13 + (i >> 11)) & 255;
  const small = Buffer.alloc(40 * 1024); for (let i = 0; i < small.length; i++) small[i] = (i * 7) & 255;
  for (const [buf, name] of [[big, 'grande.apk'], [small, 'foto.jpg']]) {
    click(P.A.win, P.A.win.document.querySelector('.attach-menu-item[data-type="file"]')); await sleep(100);
    const fin = Array.from(P.A.win.document.querySelectorAll('input[type=file]')).pop();
    Object.defineProperty(fin, 'files', { configurable: true, value: [new P.A.win.File([buf], name, { type: 'application/octet-stream' })] });
    fin.dispatchEvent(new P.A.win.Event('change'));
    await sleep(12000);
  }
  await closeChat(P.A); open.A = null;
  // C vuelve al alcance de B: aparece la ruta A → B (Wi-Fi) → C (Bluetooth); lo pendiente se reenvía por el puente
  radio.unblock(nat.B, nat.C);
  r.ruta_s = await waitFor(() => !!(P.A.win.bleInterface.relay && P.A.win.bleInterface.relay.relayHop(id('C'))), 90000);
  const smallB64 = small.toString('base64');
  r.foto_llega_s = await waitFor(async () => (await P.C.win.vaultLoadMessages(id('A'))).some((m) => !m._own && m.attachmentType && (m.attachmentPayload || nat.C.files.get(m.attachmentRef)) === smallB64), 120000);
  await sleep(20000);
  const after = logs.slice(mark).filter((l) => /\[A\]/.test(l));
  // lo que pasaba en el Vivo (diagnóstico 12-11 22:00): se leía del disco y se intentaba por el puente para fallar después
  r.grande_leido_del_disco = after.some((l) => /se cargan .* adjunto\(s\) del disco para reenviar: .*3072 KB/.test(l));
  r.grande_intentado_por_puente = after.some((l) => { const m = /sendFile START .*bytes\(b64\)=(\d+) to=/.exec(l); return !!m && Number(m[1]) > 3100000; });
  r.grande_espera = after.some((l) => /archivo\(s\) grande\(s\) para .* no caben por Bluetooth: esperan Wi-Fi\/internet/.test(l));
  r.errores = logs.filter((l) => / error: /.test(l) && !/JSDOMERROR|styles\.css|Not implemented|GLOBAL TIMEOUT|net::ERR|fetch|ECONNREFUSED|WebSocket/.test(l)).slice(0, 5);
  const ok = r.wifi_ab_s !== null && r.ruta_s !== null && r.foto_llega_s !== null && !r.grande_leido_del_disco && !r.grande_intentado_por_puente && r.grande_espera && !r.errores.length;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('JUMPGRANDE ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_jumpgrande.txt'), logs.join('\n'));
  names.forEach((n) => shutdown(P[n]));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('JUMPGRANDE ' + JSON.stringify({ prueba: 'jumpgrande', resultado: 'FALLO', error: String(e && e.message).replace(/"/g, "'") })); console.error(e && e.stack); fs.writeFileSync(path.join(__dirname, 'last_logs_jumpgrande.txt'), logs.join('\n')); process.exit(1); });
