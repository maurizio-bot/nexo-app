// 3018 (opción A del dueño 12-11): al reinstalar NEXO un teléfono estrena NEXO ID; para los demás era un contacto NUEVO y el
// viejo se quedaba con sus pendientes (y la app lo buscaba sin fin). Ahora, al entrar un contacto con el MISMO nombre que uno
// que ya está y que no se alcanza, se pregunta si es el mismo teléfono reinstalado; si sí, el chat y lo pendiente pasan al nuevo.
// A y B emparejados; A le manda 2 textos; B se va (deja de estar al alcance) y A le escribe un 3.º (queda ⏳). Llega B2 (otro
// teléfono, mismo nombre «B», NEXO ID nuevo) y A lo agrega:
//  R1  A pregunta UNA vez «¿es el mismo teléfono reinstalado?»;
//  R2  (sí) el contacto viejo desaparece, el chat de B2 tiene los 3 textos y el viejo queda vacío;
//  R3  el texto pendiente le llega a B2 y queda entregado (cifrado con la clave nueva);
//  R4  (no) con otro contacto «B» nuevo y la respuesta «no», no se une nada.
// 3135 (anti-suplantación, dueño 15-11): R1 la pregunta avisa del impostor y hay una SEGUNDA («¿lo comprobaste por llamada o en
//  persona?»); R5 sí a la primera y no a la segunda → no se une; R6 el chat unido queda «sin verificar» (aviso rojo en el chat)
//  hasta marcar verificado el número de seguridad. Contraprueba 3134: una sola pregunta sin aviso y sin marca.
// Uso: node reinstall.js <dir_build>
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone, installWebCrypto } = require('./native_mock');
const { NostrRelay } = require('./nostr_relay');
const { importSrc } = require('./srcmod');

const buildDir = path.resolve(process.argv[2] || path.join(__dirname, 'builds/wip'));
const SIN_PONG = false;
const base = { noNativePong: SIN_PONG, readsContentFallback: true, retain: ['onPayloadReceived', 'onLanMessage', 'onLanUp', 'onLanDown'], closeOnNoService: true, pace: [15, 15], ioDelay: 25, asymmetric: true, noTor: true };
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



const sleep2 = sleep;
async function waitFor(fn, ms) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return Math.round((Date.now() - t0) / 100) / 10; await sleep2(250); } return null; }
(async () => {
  const r = { prueba: 'reinstall', build: path.basename(buildDir) };
  RELAYS = [];
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', Object.assign({}, base, { wifi: null })), nB = new NativePhone('B', 'BB:BB:BB:BB:BB:02', Object.assign({}, base, { wifi: null }));
  [nA, nB].forEach((n) => { radio.add(n); n.load(); });
  const A = await boot('A', nA); const B = await boot('B', nB);
  const idB = B.win.bleInterface.localNexoId.toLowerCase(), idA = A.win.bleInterface.localNexoId.toLowerCase();
  let asked = 0, answer = true; const texts = [];
  A.win.confirm = (msg) => { asked++; texts.push(String(msg || '')); return Array.isArray(answer) ? !!answer.shift() : answer; };
  A.win.bleInterface.togglePanel(); const paired = await addFound(A, 'B'); A.win.bleInterface.togglePanel();
  if (!paired) { console.log('REINSTALL ' + JSON.stringify(Object.assign(r, { resultado: 'FALLO', error: 'no empareja' }))); process.exit(1); }
  await openChatWith(A, 'B'); sendText(A, 'uno'); await sleep(2000); sendText(A, 'dos'); await sleep(2000);
  await openChatWith(B, 'A'); sendText(B, 'hola A'); await sleep(3000);
  r.antes = (await A.win.vaultLoadMessages(idB)).length;
  // B se va: fuera de alcance y fuera de la radio (como un teléfono que se reinstaló y ya no existe con ese NEXO ID)
  radio.block(nA, nB);
  await sleep(4000);
  await openChatWith(A, 'B'); sendText(A, 'tres pendiente'); await sleep(12000);
  const askedBefore = asked;
  // llega B2: mismo nombre, otro NEXO ID
  const nB2 = new NativePhone('B2', 'BB:BB:BB:BB:BB:12', Object.assign({}, base, { wifi: null }));
  radio.add(nB2); radio.block(nB, nB2); nB2.load(); // el teléfono viejo ya no existe: tampoco lo ve el nuevo
  const B2 = await boot('B2', nB2);
  B2.win.bleInterface.localDeviceName = 'B'; // mismo nombre que el teléfono de antes
  try { B2.win.bleInterface._syncKxCard(); } catch (e) {}
  const idB2 = B2.win.bleInterface.localNexoId.toLowerCase();
  r.id_distinto = idB2 !== idB;
  A.win.bleInterface.togglePanel(); const p2 = await addFound(A, 'B'); A.win.bleInterface.togglePanel();
  r.agrega_B2 = p2;
  r.R1_pregunta_s = await waitFor(() => asked > askedBefore, 10000);
  await sleep(1500);
  r.R1_veces = asked - askedBefore;
  r.R1_avisa_impostor = /impostor/i.test(texts[askedBefore] || '');
  r.R1_segunda = /comprobaste/.test(texts[askedBefore + 1] || '');
  await sleep(1000);
  const contacts = A.win.vaultLoadContacts().map((c) => String(c.nexoId || c.deviceUUID || '').toLowerCase());
  r.R2_viejo_borrado = !contacts.includes(idB) && contacts.includes(idB2);
  const m2 = (await A.win.vaultLoadMessages(idB2)).filter((m) => m._own).map((m) => m.content);
  r.R2_textos_en_nuevo = ['uno', 'dos', 'tres pendiente'].every((t) => m2.includes(t));
  r.R2_viejo_vacio = (await A.win.vaultLoadMessages(idB)).length === 0;
  // R6: unido = sin verificar (marca y aviso rojo en el chat) hasta verificar el número de seguridad
  const cB2 = () => A.win.bleInterface.getBLEContacts().find((c) => String(c.nexoId || '').toLowerCase() === idB2) || {};
  r.R6_marca = cB2().mergeUnverified === 1;
  await openChatWith(A, 'B'); await sleep(800);
  r.R6_aviso = ((A.win.document.querySelector('.e2e-text') || {}).textContent || '').slice(0, 90);
  r.R6_aviso_ok = /NO está verificado/.test(r.R6_aviso);
  r.R3_llega_s = await waitFor(async () => (await B2.win.vaultLoadMessages(idA)).some((m) => !m._own && m.content === 'tres pendiente'), 60000);
  r.R3_entregado_s = await waitFor(async () => { const m = (await A.win.vaultLoadMessages(idB2)).find((x) => x._own && x.content === 'tres pendiente'); return m && /delivered|read/.test(m.status); }, 30000);
  // R4: B2 se va, llega B3 (otro «B») y la respuesta es «no»
  radio.block(nA, nB2);
  await sleep(4000);
  answer = false; const askedR4 = asked;
  // otro contacto nuevo «B» (NEXO ID nuevo) entra sin camino con B2: se pregunta y la respuesta es «no»
  const idB3 = 'nx0zz9b3b3';
  const cs4 = A.win.vaultLoadContacts(); cs4.push({ nexoId: idB3, deviceUUID: idB3, name: 'B', deviceId: null, addedAt: Date.now(), lastSeen: 0 }); A.win.vaultSaveContacts(cs4);
  if (typeof A.win.bleInterface._offerReinstallMerge === 'function') A.win.bleInterface._offerReinstallMerge(idB3);
  await waitFor(() => asked > askedR4, 10000); await sleep(2500);
  const c4 = A.win.vaultLoadContacts().map((c) => String(c.nexoId || c.deviceUUID || '').toLowerCase());
  r.R4_pregunto = asked > askedR4;
  r.R4_no_une = c4.includes(idB2) && c4.includes(idB3) && (await A.win.vaultLoadMessages(idB2)).some((m) => m._own && m.content === 'uno');
  // R5: otro «B» nuevo; sí a la primera pregunta y no a la segunda → no se une
  const idB4 = 'nx0zz9b4b4'; const askedR5 = asked; answer = [true, false];
  const cs5 = A.win.vaultLoadContacts(); cs5.push({ nexoId: idB4, deviceUUID: idB4, name: 'B', deviceId: null, addedAt: Date.now(), lastSeen: 0 }); A.win.vaultSaveContacts(cs5);
  if (typeof A.win.bleInterface._offerReinstallMerge === 'function') A.win.bleInterface._offerReinstallMerge(idB4);
  await waitFor(() => asked > askedR5, 10000); await sleep(2500);
  const c5 = A.win.vaultLoadContacts().map((c) => String(c.nexoId || c.deviceUUID || '').toLowerCase());
  r.R5_preguntas = asked - askedR5;
  r.R5_no_une = c5.includes(idB2) && c5.includes(idB4) && (await A.win.vaultLoadMessages(idB2)).some((m) => m._own && m.content === 'uno');
  // R6 (fin): al verificar el número de seguridad se quita la marca
  try { A.win.bleInterface.setContactVerified(idB2, true); } catch (e) {}
  r.R6_verificar_quita = !cB2().mergeUnverified;
  r.errores = logs.filter((l) => / error: /.test(l) && !/JSDOMERROR|styles\.css|Not implemented|GLOBAL TIMEOUT|net::ERR|fetch/.test(l)).slice(0, 5);
  const ok = r.id_distinto && r.agrega_B2 && r.R1_veces === 2 && r.R1_avisa_impostor && r.R1_segunda && r.R2_viejo_borrado && r.R2_textos_en_nuevo && r.R2_viejo_vacio && r.R3_llega_s !== null && r.R3_entregado_s !== null && r.R4_pregunto && r.R4_no_une && r.R5_preguntas === 2 && r.R5_no_une && r.R6_marca && r.R6_aviso_ok && r.R6_verificar_quita && !r.errores.length;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('REINSTALL ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_reinstall.txt'), logs.join('\n'));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('REINSTALL ' + JSON.stringify({ prueba: 'reinstall', resultado: 'FALLO', error: String(e && e.message).replace(/"/g, "'") })); console.error(e && e.stack); fs.writeFileSync(path.join(__dirname, 'last_logs_reinstall.txt'), logs.join('\n')); process.exit(1); });
