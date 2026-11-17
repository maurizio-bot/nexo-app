// 3211 (diagnóstico automático del HONOR …c1ee 17-11 16:04–16:05, build 3090): un texto a Marcos (su app arrancando, sin confirmar por
// Bluetooth) pasó a ✗ a los ~11 s («sendMessage failed: ACK timeout») y a ✓✓ un segundo después. La «red de seguridad de entrega»
// (2836: sin ✓✓ a los 10 s, una copia al buzón de internet + toque FCM) decía «al buzón de internet» pero NO mandaba nada: el mismo
// mensaje seguía esperando su confirmación por Bluetooth (pendingAcks) y el envío por internet se quedaba esperando con él
// (_sendWithRetryRaw: «si ese mismo mensaje ya está esperando su confirmación, se espera con él»); al agotarse los reintentos
// Bluetooth, los dos fallaban → ✗.
// A y B por Bluetooth y con internet (dos relés); la app de B no atiende el Bluetooth (lo que llega por ahí se queda en cola, como
// con la app dormida) pero sí internet. A le manda un texto:
//  S1  a los ~10 s sale la copia por internet y le llega a B (antes: nada hasta que B atiende el Bluetooth);
//  S2  A nunca ve ✗ y termina en ✓✓ (entregado);
//  S3  B lo tiene una sola vez cuando vuelve a atender el Bluetooth (sin duplicado).
// Contraprueba b3205: no llega por internet y A ve ✗.
// Uso: node redseguridad.js <dir_build>
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
  const r = { prueba: 'redseguridad', build: path.basename(buildDir) };
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
  if (!paired) { console.log('REDSEGURIDAD ' + JSON.stringify(Object.assign(r, { resultado: 'FALLO', error: 'no empareja' }))); process.exit(1); }
  await openChatWith(A, ['B', 'A']); sendText(A, 'hola B'); await sleep(2000);
  await openChatWith(B, ['A', 'B']); sendText(B, 'hola A'); await sleep(2000);
  await closeChat(B);
  A.win.bleInterface.net.tick(); B.win.bleInterface.net.tick();
  r.internet_listo_s = await waitFor(() => A.win.bleInterface.net.mailboxOk(idB) && B.win.bleInterface.net.online(), 60000);
  // Como Marcos en el diagnóstico («internet fuera»): A no lo ve EN LÍNEA por internet (no hay saludo suyo reciente) → el texto sale por
  // Bluetooth; su buzón de internet sí sirve (mailboxOk: A tiene su token)
  const netA = A.win.bleInterface.net, crA = netA.canReach.bind(netA);
  netA.canReach = function (nx) { return String(nx || '').toLowerCase() === idB ? false : crA(nx); };
  r.buzon_de_B_disponible = netA.mailboxOk(idB);
  r.bluetooth_entre_ellos = /^(bluetooth|wifi)$/.test(A.win.bleInterface.linkOf(idB));
  // La app de B deja de atender el Bluetooth (lo que llega por ahí espera en cola, como dormida); internet sí
  B.native.setFrozen(true);
  const estados = [];
  const t0 = Date.now();
  const watch = setInterval(async () => { try { const s = await stOf(A, idB, 'por la red de seguridad'); if (s && String(estados[estados.length - 1] || '').split('@')[0] !== s) estados.push(s + '@' + Math.round((Date.now() - t0) / 1000)); } catch (e) {} }, 150);
  sendText(A, 'por la red de seguridad');
  r.S1_llega_por_internet_s = await waitFor(() => has(B, idA, 'por la red de seguridad'), 40000);
  r.S2_entregado_s = await waitFor(async () => /delivered|read/.test(String(await stOf(A, idB, 'por la red de seguridad'))), 30000);
  await sleep(3000);
  clearInterval(watch);
  r.S2_estados_en_A = estados;
  r.S2_vio_fallo = estados.some((x) => /^failed/.test(x));
  B.native.setFrozen(false);
  await sleep(6000);
  r.S3_copias_en_B = (await B.win.vaultLoadMessages(idA)).filter((m) => !m._own && String(m.content).trim() === 'por la red de seguridad').length;
  r.errores = logs.filter((l) => / error: /.test(l) && !/JSDOMERROR|styles\.css|Not implemented|GLOBAL TIMEOUT|net::ERR|fetch/.test(l)).slice(0, 5);
  const ok = r.bluetooth_entre_ellos && r.buzon_de_B_disponible && r.S1_llega_por_internet_s !== null && r.S1_llega_por_internet_s <= 25 && r.S2_entregado_s !== null && !r.S2_vio_fallo && r.S3_copias_en_B === 1 && !r.errores.length;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('REDSEGURIDAD ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_redseguridad.txt'), logs.join('\n'));
  [A, B].forEach((p) => { try { p.win.bleInterface.net._closeAll(); p.win.bleInterface.net.relays.forEach((rl) => { rl.retryAt = Date.now() + 9e6; }); } catch (e) {} });
  await r1.stop(); await r2.stop();
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('REDSEGURIDAD ' + JSON.stringify({ prueba: 'redseguridad', resultado: 'FALLO', error: String(e && e.message).replace(/"/g, "'") })); console.error(e && e.stack); fs.writeFileSync(path.join(__dirname, 'last_logs_redseguridad.txt'), logs.join('\n')); process.exit(1); });
