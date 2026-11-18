// 3178 (ciudad 17-11: 41 «leído que no vuelve» y grupos que se quedan en ✓ aunque todos lo tienen): un ACUSE (entregado o leído)
// es un paquete de un solo intento. Si no sale (el que lo manda se quedó sin internet justo al leer, sus envíos los rechaza el
// relé o el puente, o no hay camino), se pierde: el emisor no reintenta lo que ya dejó en un relé (✓) ni lo que ya está
// entregado (✓✓ gris). Dos teléfonos solo por internet (dos relés):
//  L  B lee el chat (abre) justo cuando se queda sin internet; vuelve el internet → A debe ver «leído» (✓✓ azul).
//  E  los envíos de B los rechazan los relés (él sigue recibiendo): A le manda un texto, a B le llega y su «entregado» no sale
//     (tampoco el de la copia que A deja en el buzón a los 10 s, «red de seguridad de entrega»); se le vuelven a aceptar → A debe
//     pasar de ✓ a ✓✓.
//  G  lo mismo en un GRUPO (A y B): la burbuja del grupo debe pasar de ✓ a ✓✓.
// Uso: node acuses.js <dir_build>
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
  let row; for (let i = 0; i < 200 && !row; i++) { row = Array.from(p.win.document.querySelectorAll('#main-contacts-list .ble-contact-row')).find((r) => (r.querySelector('.ble-contact-name') || {}).textContent === name); if (!row) await sleep(100); }
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
  const r = { prueba: 'acuses', build: path.basename(buildDir) };
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
  if (!paired) { console.log('ACUSES ' + JSON.stringify(Object.assign(r, { resultado: 'FALLO', error: 'no empareja' }))); process.exit(1); }
  await openChatWith(A, 'B'); sendText(A, 'hola B'); await sleep(2000);
  await openChatWith(B, 'A'); sendText(B, 'hola A'); await sleep(2000);
  await closeChat(A); await closeChat(B);
  radio.block(A.native, B.native);
  A.win.bleInterface.net.tick(); B.win.bleInterface.net.tick();
  r.en_linea_por_internet_s = await waitFor(() => A.win.bleInterface.linkOf(idB) === 'internet' && B.win.bleInterface.linkOf(idA) === 'internet', 60000);

  // ---- L: B lee justo cuando se queda sin internet ----
  await openChatWith(A, 'B');
  sendText(A, 'uno');
  r.L_llega_s = await waitFor(() => has(B, idA, 'uno'), 30000);
  r.L_entregado_s = await waitFor(async () => /delivered|read/.test(String(await stOf(A, idB, 'uno'))), 15000);
  offline(B);
  await openChatWith(B, 'A');                 // B abre el chat: lo lee (el acuse sale con las conexiones colgadas)
  await sleep(12000);
  r.L_estado_sin_internet = await stOf(A, idB, 'uno');
  await closeChat(B);
  online(B);
  r.L_leido_al_volver_s = await waitFor(async () => (await stOf(A, idB, 'uno')) === 'read', 60000);
  r.L_estado = await stOf(A, idB, 'uno');

  // ---- E: los relés rechazan lo que manda B (él sigue recibiendo): su «entregado» no sale ----
  await waitFor(() => A.win.bleInterface.linkOf(idB) === 'internet' && B.win.bleInterface.linkOf(idA) === 'internet', 30000);
  relays.forEach((x) => x.rejectTag(TAG(B)));
  sendText(A, 'dos');
  r.E_llega_s = await waitFor(() => has(B, idA, 'dos'), 30000);
  await sleep(22000);   // pasa también la «red de seguridad de entrega» de A (a los 10 s lo deja otra vez en el buzón; B vuelve a confirmar y tampoco sale)
  r.E_estado_rechazado = await stOf(A, idB, 'dos');
  relays.forEach((x) => x.acceptTag(TAG(B)));
  r.E_entregado_s = await waitFor(async () => /delivered|read/.test(String(await stOf(A, idB, 'dos'))), 60000);
  r.E_estado = await stOf(A, idB, 'dos');
  await closeChat(A);

  // ---- G: lo mismo en un grupo (A y B): la burbuja del grupo se quedaba en ✓ ----
  click(A.win, A.win.document.getElementById('ble-fab-btn')); await sleep(300); click(A.win, A.win.document.getElementById('nexo-fab-group')); await sleep(400); // 3222: «Crear grupo» desde el botón de agregar
  const sheet = A.win.document.getElementById('nexo-group-sheet');
  let gid = null;
  if (sheet) {
    sheet.querySelectorAll('.nexo-pick-row input').forEach((cb) => { cb.checked = true; cb.dispatchEvent(new A.win.Event('change')); });
    const nm = sheet.querySelector('#nexo-group-name'); nm.value = 'Dos'; nm.dispatchEvent(new A.win.Event('input'));
    click(A.win, sheet.querySelector('#nexo-group-create')); await sleep(600);
    gid = Object.keys(A.win.bleInterface.groups.list)[0] || null;
  }
  r.G_grupo = !!gid;
  if (gid) {
    r.G_grupo_en_B_s = await waitFor(() => !!B.win.bleInterface.groups.get(gid), 60000);
    await sleep(2000);
    relays.forEach((x) => x.rejectTag(TAG(B)));
    sendText(A, 'tres');
    r.G_llega_s = await waitFor(() => has(B, gid, 'tres'), 30000);
    await sleep(22000);
    r.G_estado_rechazado = await stOf(A, gid, 'tres');
    relays.forEach((x) => x.acceptTag(TAG(B)));
    r.G_entregado_s = await waitFor(async () => /delivered|read/.test(String(await stOf(A, gid, 'tres'))), 60000);
    r.G_estado = await stOf(A, gid, 'tres');
  }

  r.reintentos_acuse = logs.filter((l) => /\[ACUSE\]/.test(l)).length;
  r.errores = logs.filter((l) => / error: /.test(l) && !/JSDOMERROR|styles\.css|Not implemented|GLOBAL TIMEOUT|net::ERR|fetch/.test(l)).slice(0, 5);
  const ok = r.en_linea_por_internet_s !== null && r.L_llega_s !== null && r.L_estado_sin_internet !== 'read' && r.L_leido_al_volver_s !== null &&
    r.E_llega_s !== null && r.E_estado_rechazado === 'sent' && r.E_entregado_s !== null &&
    r.G_grupo && r.G_llega_s !== null && r.G_estado_rechazado === 'sent' && r.G_entregado_s !== null && !r.errores.length;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('ACUSES ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_acuses.txt'), logs.join('\n'));
  [A, B].forEach((p) => { try { p.win.bleInterface.net._closeAll(); p.win.bleInterface.net.relays.forEach((rl) => { rl.retryAt = Date.now() + 9e6; }); } catch (e) {} });
  await r1.stop(); await r2.stop();
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('ACUSES ' + JSON.stringify({ prueba: 'acuses', resultado: 'FALLO', error: String(e && e.message).replace(/"/g, "'") })); console.error(e && e.stack); fs.writeFileSync(path.join(__dirname, 'last_logs_acuses.txt'), logs.join('\n')); process.exit(1); });
