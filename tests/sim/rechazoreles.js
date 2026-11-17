// 3209 (diagnóstico automático del HONOR …c1ee 17-11 14:27–14:28, build 3090): un texto largo pendiente para el dueño se reanudó por
// internet (por el puente de Roberto) y el relé lo RECHAZÓ («banned: too many rate-limit violations»): ChatStream reintentaba el MISMO
// trozo cada 200 ms–1 s hasta 120 veces (~2 min) por el mismo camino —40 rechazos en el registro— y así el relé lo castigaba más. Lo
// mismo con «Sin internet con …» (20 fallos seguidos en 19 s) y, en Marcos 15:38, «Sin Wi-Fi con …» con el Wi-Fi apagado (20 en 11 s).
// Ahora un camino que dice «no» al momento (sin Wi-Fi, sin internet, rechazado por los relés) y sin otro mejor: el envío queda
// pendiente (⏳) tras 3 intentos y lo retoma el reenvío de pendientes cuando haya camino. Dos teléfonos solo por internet (dos relés):
//  R1  los relés rechazan lo que manda A (él sigue recibiendo); A manda un texto LARGO (por trozos): en 40 s, pocos intentos (antes,
//      uno por segundo por relé) y el mensaje no queda ✗;
//  R2  los relés vuelven a aceptar: el texto llega entero a B.
// Contraprueba b3205: decenas de rechazos en 40 s.
// Uso: node rechazoreles.js <dir_build>
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
      // Cada conexión a un relé lleva la etiqueta del teléfono (el relé de prueba corta, calla o rechaza las de uno solo);
      // sin internet (p.noNet) ninguna conexión nueva abre
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
  let row; for (let i = 0; i < 200 && !row; i++) { row = Array.from(p.win.document.querySelectorAll('#main-contacts-list .ble-contact-row')).find((r) => [].concat(name).indexOf((r.querySelector('.ble-contact-name') || {}).textContent) >= 0); if (!row) await sleep(100); }
  click(p.win, row); await sleep(600); return !!row;
}
async function closeChat(p) { p.win.dispatchEvent(new p.win.CustomEvent('nexo:ble:closeChat', { detail: {} })); await sleep(300); }
function sendText(p, t) { const i = p.win.document.getElementById('message-input'); i.value = t; i.dispatchEvent(new p.win.Event('input', { bubbles: true })); click(p.win, p.win.document.getElementById('send-btn')); }
async function addFound(p, name) {
  let add = null;
  const find = () => { const row = Array.from(p.win.document.querySelectorAll('#ble-new-device > div')).find((d) => (d.querySelector('span') || {}).textContent === name); return row && row.querySelector('button'); };
  for (let i = 0; i < 400 && !add; i++) { await sleep(100); add = find(); if (!add && !p.win.bleInterface.isScanning) click(p.win, p.win.document.getElementById('ble-scan-btn')); }
  click(p.win, add); await sleep(2000);
  return !!add;
}
async function waitFor(fn, ms) { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (await fn()) return Math.round((Date.now() - t0) / 100) / 10; } catch (e) {} await sleep(250); } return null; }
const vis = (c) => { const s = String(c == null ? '' : c); if (s.charAt(0) === '{') { try { const o = JSON.parse(s); if (o && typeof o.t === 'string') return o.t; } catch (e) {} } return s; };
const own = async (p, chat, text) => (await p.win.vaultLoadMessages(chat)).find((m) => m._own && vis(m.content).trim() === text);
const has = async (p, chat, text) => (await p.win.vaultLoadMessages(chat)).some((m) => !m._own && vis(m.content).trim() === text);
const stOf = async (p, chat, text) => { const m = await own(p, chat, text); return m ? m.status : null; };
let relays = [];
function offline(p) { p.noNet = true; p.native.setNetwork('none'); relays.forEach((r) => r.muteTag(TAG(p))); }
function online(p) { p.noNet = false; relays.forEach((r) => r.wakeTag(TAG(p))); p.native.setNetwork('cell'); }

(async () => {
  const r = { prueba: 'rechazoreles', build: path.basename(buildDir) };
  const r1 = new NostrRelay(), r2 = new NostrRelay();
  relays = [r1, r2];
  RELAYS = [await r1.start(), await r2.start()];
  const radio = new Radio();
  const A = { name: 'A', native: new NativePhone('A', 'AA:AA:AA:AA:AA:01', Object.assign({}, base, { wifi: 'casa' })) };
  const B = { name: 'B', native: new NativePhone('B', 'BB:BB:BB:BB:BB:02', Object.assign({}, base, { wifi: 'oficina' })) };
  [A, B].forEach((p) => { radio.add(p.native); p.native.load(); });
  await boot(A); await boot(B);
  const idA = A.win.bleInterface.localNexoId.toLowerCase(), idB = B.win.bleInterface.localNexoId.toLowerCase();
  A.win.bleInterface.togglePanel(); const paired = await addFound(A, 'B'); A.win.bleInterface.togglePanel();
  if (!paired) { console.log('RECHAZORELES ' + JSON.stringify(Object.assign(r, { resultado: 'FALLO', error: 'no empareja' }))); process.exit(1); }
  await openChatWith(A, ['B', 'A']); sendText(A, 'hola B'); await sleep(2000);
  await openChatWith(B, ['A', 'B']); sendText(B, 'hola A'); await sleep(2000);
  await closeChat(B);
  radio.block(A.native, B.native);
  A.win.bleInterface.net.tick(); B.win.bleInterface.net.tick();
  r.en_linea_por_internet_s = await waitFor(() => A.win.bleInterface.linkOf(idB) === 'internet' && B.win.bleInterface.linkOf(idA) === 'internet', 60000);
  await sleep(3000);
  // ---- R1: los relés rechazan lo que manda A; A manda un texto largo (por trozos) ----
  const rej = () => relays.reduce((n, x) => n + x.stats.rejected.filter((t) => t === 'tag').length, 0);
  relays.forEach((x) => x.rejectTag(TAG(A)));
  const rej0 = rej(), mark = logs.length;
  const largo = 'LARGO-' + 'abcdefghijklmnopqrstuvwxyz0123456789'.repeat(700); // ~25 mil letras: va por trozos
  sendText(A, largo);
  await sleep(40000);
  r.R1_rechazos_en_40s = rej() - rej0;
  r.R1_por_trozos = logs.slice(mark).some((l) => /\[A\].*\[ChatStream\] START/.test(l));
  r.R1_fallos_registrados = logs.slice(mark).filter((l) => /\[A\].*Envio nativo fallo/.test(l)).map((l) => (/\((\d+)\)\s*$/.exec(l) || [])[1]).pop() || 0;
  r.R1_estado = await stOf(A, idB, largo);
  r.R1_queda_pendiente = logs.slice(mark).some((l) => /\[A\].*(queda pendiente|queda ⏳)/.test(l));
  // ---- R2: vuelven a aceptar: llega ----
  relays.forEach((x) => x.acceptTag(TAG(A)));
  r.R2_llega_s = await waitFor(() => has(B, idA, largo), 120000);
  r.R2_estado = await stOf(A, idB, largo);
  r.errores = logs.filter((l) => / error: /.test(l) && !/JSDOMERROR|styles\.css|Not implemented|GLOBAL TIMEOUT|net::ERR|fetch/.test(l)).slice(0, 5);
  const ok = r.en_linea_por_internet_s !== null && r.R1_rechazos_en_40s <= 16 && r.R1_estado !== 'failed' && r.R2_llega_s !== null && !r.errores.length;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('RECHAZORELES ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_rechazoreles.txt'), logs.join('\n'));
  [A, B].forEach((p) => { try { p.win.bleInterface.net._closeAll(); p.win.bleInterface.net.relays.forEach((rl) => { rl.retryAt = Date.now() + 9e6; }); } catch (e) {} });
  await r1.stop(); await r2.stop();
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('RECHAZORELES ' + JSON.stringify({ prueba: 'rechazoreles', resultado: 'FALLO', error: String(e && e.message).replace(/"/g, "'") })); console.error(e && e.stack); fs.writeFileSync(path.join(__dirname, 'last_logs_rechazoreles.txt'), logs.join('\n')); process.exit(1); });
