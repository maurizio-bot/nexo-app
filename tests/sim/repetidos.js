// 3212 (diagnóstico de Marcos 17-11 16:13: 2,6 MB bajados de los relés en el primer minuto tras abrir la app, 528 de 546 eventos YA
// vistos; HONOR: 4 cambios Wi-Fi ↔ datos en 5 min, 306 de 522 repetidos): al (re)suscribir un relé (abrir la app, cambio de red, relé
// que se reconecta) se pedía desde «lo último visto − 10 min» (margen fijo por si el reloj del otro va atrasado) y cada relé volvía a
// mandar 10 min de todo. Ahora el margen es el desfase que se ve en lo que llega EN VIVO (+30 s), entre 2 y 10 min.
// A y B solo por internet (dos relés). A le manda 10 textos de ~1,5 KB; pasados ~3 min:
//  R1  B se queda sin red y vuelve (los relés se reconectan y se vuelve a pedir): lo REPETIDO que baja (contraprueba b3205: 51
//      eventos y 106 KB; ahora ≤ 40 KB);
//  R2  un texto que A manda mientras B está sin red llega igual;
//  R3  uno de A con el reloj 100 s ATRASADO, mandado mientras B está sin red, llega igual (cabe en el margen mínimo);
//  R4  A con el reloj 2,5 min atrasado manda con B en línea: B lo ve llegar tarde y sube su margen (≥ 3 min); otro con ese mismo
//      atraso mientras B está sin red llega al volver (≤ 5 s: lo trae la suscripción nueva, no el reenvío de A).
// Si el reloj de un contacto va MÁS de 2 min atrasado y aún no se aprendió, sus sobres esperan hasta ~3 min tras una reconexión (el
// relé filtra por la hora del sobre; los reenvíos los traen): el margen se aprende con el primero que llega en vivo y dura 12 h.
// Uso: node repetidos.js <dir_build>
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
  const r = { prueba: 'repetidos', build: path.basename(buildDir) };
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
  if (!paired) { console.log('REPETIDOS ' + JSON.stringify(Object.assign(r, { resultado: 'FALLO', error: 'no empareja' }))); process.exit(1); }
  await openChatWith(A, ['B', 'A']); sendText(A, 'hola B'); await sleep(2000);
  await openChatWith(B, ['A', 'B']); sendText(B, 'hola A'); await sleep(2000);
  await closeChat(B);
  radio.block(A.native, B.native);
  // solo por internet: sin Wi-Fi local entre los dos (redes distintas; el anuncio de la red local se apaga)
  [A, B].forEach((p) => { try { p.win.bleInterface.lan && p.win.bleInterface.lan.stop && p.win.bleInterface.lan.stop(); } catch (e) {} });
  A.win.bleInterface.net.tick(); B.win.bleInterface.net.tick();
  r.en_linea_por_internet_s = await waitFor(() => A.win.bleInterface.linkOf(idB) === 'internet' && B.win.bleInterface.linkOf(idA) === 'internet', 60000);
  // 10 textos de ~1,5 KB
  const txt = (i) => 'T' + i + '-' + 'abcdefghijklmnopqrstuvwxyz0123456789'.repeat(40);
  for (let i = 0; i < 10; i++) { sendText(A, txt(i)); await sleep(500); }
  r.textos_llegan_s = await waitFor(async () => { for (let i = 0; i < 10; i++) if (!(await has(B, idA, txt(i)))) return false; return true; }, 60000);
  await sleep(process.env.REP_FAST ? 3000 : 190000);   // pasan más de 3 min (lo último visto lo siguen moviendo los saludos de A)
  const netB = B.win.bleInterface.net;
  const rx = () => { const s = netB._rx && netB._rx.all; return s ? { ev: s.ev, dup: s.dup, dupB: s.dupBytes } : { ev: 0, dup: 0, dupB: 0 }; };
  const skewSend = (p, secs, text) => { const D = p.win.Date, real = D.now.bind(D); D.now = () => real() - secs * 1000; try { sendText(p, text); } finally { setTimeout(() => { D.now = real; }, 1500); } };
  // ---- R1–R3: B sin red un momento ----
  const x0 = rx();
  offline(B); await sleep(2500);
  sendText(A, 'mientras B no tiene red');
  await sleep(1800);
  skewSend(A, 100, 'reloj 100 s atrasado');
  await sleep(2500);
  B.native.setNetwork('wifi', 'oficina'); B.noNet = false; relays.forEach((x) => x.wakeTag(TAG(B)));
  r.R2_llega_s = await waitFor(() => has(B, idA, 'mientras B no tiene red'), 60000);
  r.R3_atrasado_llega_s = await waitFor(() => has(B, idA, 'reloj 100 s atrasado'), 30000);
  await sleep(8000);
  const x1 = rx();
  r.R1_repetidos_al_volver = x1.dup - x0.dup;
  r.R1_kb_repetidos_al_volver = Math.round((x1.dupB - x0.dupB) / 1024);
  r.margen_s_antes = typeof netB._sinceMarginS === 'function' ? netB._sinceMarginS() : 600;
  // ---- R4: reloj 5 min atrasado ----
  await sleep(35000);   // la suscripción ya lleva un rato: lo atrasado 150 s cabe en ella y llega EN VIVO
  skewSend(A, 150, 'reloj 2,5 min atrasado, en vivo');
  await sleep(1200);
  r.R4_en_vivo_llega_s = await waitFor(() => has(B, idA, 'reloj 2,5 min atrasado, en vivo'), 30000);
  await sleep(1500);
  r.R4_margen_s = typeof netB._sinceMarginS === 'function' ? netB._sinceMarginS() : 600;
  offline(B); await sleep(2500);
  skewSend(A, 150, 'reloj 2,5 min atrasado, sin red');
  await sleep(2500);
  B.native.setNetwork('wifi', 'oficina'); B.noNet = false; relays.forEach((x) => x.wakeTag(TAG(B)));
  r.R4_sin_red_llega_s = await waitFor(() => has(B, idA, 'reloj 2,5 min atrasado, sin red'), 60000);
  r.errores = logs.filter((l) => / error: /.test(l) && !/JSDOMERROR|styles\.css|Not implemented|GLOBAL TIMEOUT|net::ERR|fetch/.test(l)).slice(0, 5);
  const ok = r.en_linea_por_internet_s !== null && r.textos_llegan_s !== null && r.R1_kb_repetidos_al_volver <= 40 && r.R2_llega_s !== null && r.R3_atrasado_llega_s !== null &&
    r.R4_en_vivo_llega_s !== null && r.R4_margen_s >= 180 && r.R4_sin_red_llega_s <= 5 && r.R4_sin_red_llega_s !== null && !r.errores.length;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('REPETIDOS ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_repetidos.txt'), logs.join('\n'));
  [A, B].forEach((p) => { try { p.win.bleInterface.net._closeAll(); p.win.bleInterface.net.relays.forEach((rl) => { rl.retryAt = Date.now() + 9e6; }); } catch (e) {} });
  await r1.stop(); await r2.stop();
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('REPETIDOS ' + JSON.stringify({ prueba: 'repetidos', resultado: 'FALLO', error: String(e && e.message).replace(/"/g, "'") })); console.error(e && e.stack); fs.writeFileSync(path.join(__dirname, 'last_logs_repetidos.txt'), logs.join('\n')); process.exit(1); });
