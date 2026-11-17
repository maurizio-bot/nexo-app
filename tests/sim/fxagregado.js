// 3176 (prueba de ciudad 17-11): las REACCIONES del teléfono AGREGADO no salían nunca (en 6 teléfonos, 11 de 12 pares). Al agregar,
// el que agrega (A) manda su kx (con fx: «entiendo reacciones, editar, eliminar para todos…») ANTES de que el agregado (B) lo tenga
// de contacto (lo tendrá con el «hola»); ble_keys._noteFenixPeer solo guardaba fx si el contacto ya existía → fx = 0 para siempre
// en B, _peerUnderstands(A) = false: la reacción de B se quedaba en su teléfono y no tenía «Editar» ni «Eliminar para todos».
// A agrega a B (primer mensaje corto), a C (que es como una build que NO anuncia fx) y a D (primer mensaje LARGO: llega por trozos):
//  F1  B y D tienen fx de A en cuanto A es su contacto (sin otra conexión);
//  F2  la reacción de B a un mensaje de A le llega a A;
//  F3  B tiene «Editar» y «Eliminar para todos» en su propio mensaje a A, y la edición le llega a A;
//  F4  con C, que de verdad no anuncia fx, nada cambia: A no le manda reacciones ni le ofrece editar/eliminar para todos.
// Uso: node fxagregado.js <dir_build>
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone, installWebCrypto } = require('./native_mock');

const buildDir = path.resolve(process.argv[2] || path.join(__dirname, 'builds/wip'));
const base = { readsContentFallback: true, retain: ['onPayloadReceived', 'onLanMessage', 'onLanUp', 'onLanDown'], closeOnNoService: true, pace: [15, 15], ioDelay: 25, asymmetric: true, noTor: true, wifi: null };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
class DL extends ResourceLoader { constructor(d) { super(); this.d = d; } fetch(u) { const f = path.join(this.d, decodeURIComponent(new URL(u).pathname)); return fs.existsSync(f) ? Promise.resolve(fs.readFileSync(f)) : Promise.reject(new Error('x')); } }
const logs = [];
const T0 = Date.now();
const ts = () => String(((Date.now() - T0) / 1000).toFixed(1)).padStart(6) + 's';
async function boot(name, native) {
  native.listeners = new Map();
  const vc = new VirtualConsole();
  ['log', 'warn', 'error'].forEach((l) => vc.on(l, (...a) => logs.push(`${ts()} [${name}] ${l}: ` + a.map(String).join(' ').substring(0, 300))));
  const dom = new JSDOM(fs.readFileSync(path.join(buildDir, 'dist', 'index.html'), 'utf8'), {
    url: 'https://' + name.toLowerCase() + '.nexo.test/index.html', runScripts: 'dangerously', resources: new DL(path.join(buildDir, 'dist')), pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) {
      win.NEXO_NET_RELAYS = []; win.CapacitorCustomPlatform = { name: 'android' }; installWebCrypto(win);
      win.Capacitor = { Plugins: { NexoBLE: native.plugin() } }; win.HTMLElement.prototype.scrollTo = function () {};
    },
  });
  const win = dom.window;
  for (let i = 0; i < 100 && !(win.NEXO && win.NEXO.initialized); i++) await sleep(100);
  await sleep(800);
  return { name, native, win };
}
const click = (win, el) => el && el.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
const $ = (p, sel) => p.win.document.querySelector(sel);
async function openChat(p, cid) { try { await p.win.bleInterface.openChat(cid); } catch (e) {} await sleep(600); }
async function closeChat(p) { p.win.dispatchEvent(new p.win.CustomEvent('nexo:ble:closeChat', { detail: {} })); await sleep(300); }
function typeSend(p, t) { const i = p.win.document.getElementById('message-input'); i.value = t; i.dispatchEvent(new p.win.Event('input', { bubbles: true })); click(p.win, p.win.document.getElementById('send-btn')); }
async function addFound(p, name) {
  let add = null;
  if (p.win.bleInterface.isScanning) { click(p.win, p.win.document.getElementById('ble-scan-btn')); await sleep(400); }
  const find = () => { const row = Array.from(p.win.document.querySelectorAll('#ble-new-device > div')).find((d) => (d.querySelector('span') || {}).textContent === name); return row && row.querySelector('button'); };
  for (let i = 0; i < 400 && !add; i++) { await sleep(100); add = find(); if (!add && !p.win.bleInterface.isScanning) click(p.win, p.win.document.getElementById('ble-scan-btn')); }
  click(p.win, add); await sleep(2000);
  return !!add;
}
async function waitFor(fn, ms) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return Math.round((Date.now() - t0) / 100) / 10; await sleep(250); } return null; }
async function menuOpts(p, msgId) {
  const el = $(p, '.message[data-msg-id="' + msgId + '"]');
  if (!el) return null;
  (el.querySelector('.msg-content') || el).dispatchEvent(new p.win.MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
  await sleep(400);
  return Array.from(p.win.document.querySelectorAll('#nexo-msg-menu .mm-item')).map((b) => (b.className.split(/\s+/).find((c) => c !== 'mm-item' && c.indexOf('mm-') === 0) || ''));
}
function dismissMenu(p) { const m = $(p, '#nexo-msg-menu'); if (m) m.remove(); }
async function react(p, msgId, emo) {
  if (!(await menuOpts(p, msgId))) return false;
  let b = null; for (let i = 0; i < 15 && !b; i++) { b = Array.from(p.win.document.querySelectorAll('#nexo-msg-menu .mm-react')).find((x) => x.textContent === emo); if (!b) await sleep(100); }
  click(p.win, b); await sleep(500); return !!b;
}
const fxOf = (p, nx) => { const c = (p.win.vaultLoadContacts() || []).find((x) => String(x.nexoId || x.deviceUUID || '').toLowerCase() === nx); return c ? (c.fx || 0) : 'sin contacto'; };
async function msgWith(p, cid, re, own) { let m = null; await waitFor(async () => !!(m = (await p.win.vaultLoadMessages(cid)).filter((x) => !!x._own === !!own && !x.hidden && re.test(String(x.content))).pop()), 20000); return m; }

(async () => {
  const r = { prueba: 'fxagregado', build: path.basename(buildDir) };
  const radio = new Radio();
  const N = {}, P = {};
  for (const [n, mac] of [['A', 'AA:AA:AA:AA:AA:01'], ['B', 'BB:BB:BB:BB:BB:02'], ['C', 'CC:CC:CC:CC:CC:03'], ['D', 'DD:DD:DD:DD:DD:04']]) { N[n] = new NativePhone(n, mac, base); radio.add(N[n]); N[n].load(); }
  for (const n of ['A', 'B', 'C', 'D']) P[n] = await boot(n, N[n]);
  // C hace de teléfono que NO entiende fx (su kx no lo anuncia)
  const kxC = P.C.win.bleInterface._kxPacketBase;
  P.C.win.bleInterface._kxPacketBase = function () { const p = kxC.apply(this, arguments); if (p) delete p.fx; return p; };
  const id = (n) => P[n].win.bleInterface.localNexoId.toLowerCase();
  const A = P.A, B = P.B, C = P.C, D = P.D;
  const largo = 'Hola D, este primer mensaje es largo a propósito para que viaje por trozos (más de 180 letras) y el contacto se cree desde el camino de los textos largos, no desde el corto; así se prueba también ese camino. Fin.';
  const pair = async (x, first) => {
    const others = ['B', 'C', 'D'].filter((o) => o !== x);
    others.forEach((o) => radio.block(N.A, N[o]));
    A.win.bleInterface.togglePanel(); const ok = await addFound(A, x); A.win.bleInterface.togglePanel();
    await sleep(800);
    await openChat(A, id(x)); typeSend(A, first); await sleep(1500); await closeChat(A);
    if (!ok) { console.log('FXAGREGADO ' + JSON.stringify(Object.assign(r, { resultado: 'FALLO', error: 'no empareja A' + x }))); process.exit(1); }
    r['F1_' + x + '_tiene_contacto_A_s'] = await waitFor(() => fxOf(P[x], id('A')) !== 'sin contacto', 20000);
    await sleep(2000);
    r['F1_fx_' + x + '_de_A'] = fxOf(P[x], id('A')); // en cuanto A es su contacto (sin otra conexión)
    return others;
  };
  // ---- B: primer mensaje corto ----
  let others = await pair('B', 'hola B');
  r.fx_A_de_B = fxOf(A, id('B'));
  // F2: B reacciona al «hola B» de A
  await openChat(B, id('A'));
  const holaB = await msgWith(B, id('A'), /^hola B$/, false);
  r.F2_B_reacciona = await react(B, holaB && holaB.msgId, '👍');
  r.F2_A_recibe_reaccion_s = await waitFor(async () => { const m = (await A.win.vaultLoadMessages(id('B'))).find((x) => x.msgId === (holaB && holaB.msgId)); return !!(m && m.reactions && m.reactions[id('B')] === '👍'); }, 20000);
  // F3: B escribe a A: su menú tiene «Editar» y «Eliminar para todos»; la edición le llega a A
  typeSend(B, 'hola A con herror');
  const propioB = await msgWith(B, id('A'), /con herror/, true);
  await sleep(1500);
  r.F3_menu_B = await menuOpts(B, propioB && propioB.msgId);
  const ed = $(B, '#nexo-msg-menu .mm-edit');
  if (ed) { click(B.win, ed); await sleep(300); typeSend(B, 'hola A corregido'); await sleep(600); } else dismissMenu(B);
  r.F3_A_recibe_edicion_s = await waitFor(async () => { const m = (await A.win.vaultLoadMessages(id('B'))).find((x) => x.msgId === (propioB && propioB.msgId)); return !!(m && m.edited && m.content === 'hola A corregido'); }, 20000);
  await closeChat(B);
  others.forEach((o) => radio.unblock(N.A, N[o]));
  // ---- C: no anuncia fx (A no debe darle por entendidas las acciones) ----
  others = await pair('C', 'hola C');
  r.F4_fx_A_de_C = fxOf(A, id('C'));
  await openChat(C, id('A')); typeSend(C, 'hola A de C'); await sleep(2500); await closeChat(C);
  await openChat(A, id('C'));
  const deC = await msgWith(A, id('C'), /hola A de C/, false);
  r.F4_A_reacciona_local = await react(A, deC && deC.msgId, '❤️');
  await sleep(4000);
  const enC = (await C.win.vaultLoadMessages(id('A'))).find((x) => x.msgId === (deC && deC.msgId));
  r.F4_C_recibe_reaccion = !!(enC && enC.reactions && enC.reactions[id('A')]);
  const holaC = await msgWith(A, id('C'), /^hola C$/, true);
  r.F4_menu_A_a_C = await menuOpts(A, holaC && holaC.msgId); dismissMenu(A);
  await closeChat(A);
  others.forEach((o) => radio.unblock(N.A, N[o]));
  // ---- D: primer mensaje LARGO (llega por trozos: el contacto se crea en ese camino) ----
  others = await pair('D', largo);
  others.forEach((o) => radio.unblock(N.A, N[o]));

  r.errores = logs.filter((l) => / error: /.test(l) && !/JSDOMERROR|styles\.css|Not implemented|GLOBAL TIMEOUT|net::ERR|fetch/.test(l)).slice(0, 5);
  const ok = r.F1_fx_B_de_A >= 1 && r.F1_fx_D_de_A >= 1 && r.F1_fx_C_de_A >= 1 && r.fx_A_de_B >= 1 && r.F2_B_reacciona && r.F2_A_recibe_reaccion_s !== null &&
    Array.isArray(r.F3_menu_B) && r.F3_menu_B.includes('mm-edit') && r.F3_menu_B.includes('mm-del-all') && r.F3_A_recibe_edicion_s !== null &&
    !r.F4_fx_A_de_C && r.F4_A_reacciona_local && !r.F4_C_recibe_reaccion && Array.isArray(r.F4_menu_A_a_C) && !r.F4_menu_A_a_C.includes('mm-edit') && !r.F4_menu_A_a_C.includes('mm-del-all') && r.F4_menu_A_a_C.includes('mm-reply') &&
    !r.errores.length;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('FXAGREGADO ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_fxagregado.txt'), logs.join('\n'));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('FXAGREGADO ' + JSON.stringify({ prueba: 'fxagregado', resultado: 'FALLO', error: String(e && e.message).replace(/"/g, "'") })); console.error(e && e.stack); fs.writeFileSync(path.join(__dirname, 'last_logs_fxagregado.txt'), logs.join('\n')); process.exit(1); });
