// 3083 (diagnóstico S24 14-11 08:09, build 3050; ya anotado como «Menor» en PENDIENTES): «Resume: 4 outgoing para nx1e29ab2f» —la
// tablet, AUSENTE desde ayer— arrancaba sus 4 textos largos (41–55 trozos) por la dirección Bluetooth guardada, sin enlace: 13
// escrituras a ciegas a esa dirección, «Write fallo durante ~6 s … descartado entero (20 trozos)» en el nativo, y a los 10 s «Texto
// sobre un Bluetooth que el nativo ya soltó: se rinde». Pasaba al volver la app al frente y en cada reenvío de pendientes de OTRO
// contacto (el vivo, con enlace listo), y mientras tanto los envíos de ese otro esperaban («otro envío avanza por la radio»).
// A, B y C emparejados por Bluetooth, sin internet. A le manda a C un texto largo y C se va a mitad (queda ⏳). Luego A va a segundo
// plano, vuelve, y escribe a B, que está cerca pero con la app congelada (no confirma: A le reenvía en vueltas):
//  R1  el texto largo a C queda pendiente (no se pierde);
//  R2  mientras C no tiene enlace, ninguna escritura Bluetooth hacia C al volver la app ni en los reenvíos a B;
//  R3  B (con la app congelada, como el vivo) despierta: lo suyo llega (≤ 75 s, lo que tarda la siguiente vuelta de reenvío);
//  R4  C vuelve: el texto largo le llega (≤ 60 s).
// Uso: node resumeciego.js <dir_build>
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone, installWebCrypto } = require('./native_mock');

const buildDir = path.resolve(process.argv[2]);
const base = { readsContentFallback: true, retain: ['onPayloadReceived'], closeOnNoService: true, pace: [40, 60], ioDelay: 25, asymmetric: true, noTor: true };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
class DL extends ResourceLoader { constructor(d) { super(); this.d = d; } fetch(u) { const f = path.join(this.d, decodeURIComponent(new URL(u).pathname)); return fs.existsSync(f) ? Promise.resolve(fs.readFileSync(f)) : Promise.reject(new Error('no existe ' + f)); } }
const logs = [];
async function boot(name, native) {
  native.btCalls = native.btCalls || [];
  let vis = 'visible';
  const vc = new VirtualConsole();
  ['log', 'warn', 'error'].forEach((l) => vc.on(l, (...a) => logs.push(`${new Date().toISOString().substring(14, 23)} [${name}] ${l}: ` + a.map(String).join(' ').substring(0, 300))));
  const dom = new JSDOM(fs.readFileSync(path.join(buildDir, 'dist', 'index.html'), 'utf8'), {
    url: 'https://' + name.toLowerCase() + '.nexo.test/index.html', runScripts: 'dangerously', resources: new DL(path.join(buildDir, 'dist')), pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) {
      win.NEXO_NET_RELAYS = []; win.CapacitorCustomPlatform = { name: 'android' }; installWebCrypto(win);
      Object.defineProperty(win.document, 'visibilityState', { configurable: true, get: () => vis });
      Object.defineProperty(win.document, 'hidden', { configurable: true, get: () => vis === 'hidden' });
      const pl = native.plugin();
      ['sendMessage', 'sendBinary'].forEach((k) => {
        const o = pl[k]; if (typeof o !== 'function') return;
        pl[k] = (a) => { try { native.btCalls.push({ t: Date.now(), k, id: String((a && a.deviceId) || '').toLowerCase().replace(/[^0-9a-z]/g, '') }); } catch (e) {} return o(a); };
      });
      win.Capacitor = { Plugins: { NexoBLE: pl } }; win.HTMLElement.prototype.scrollTo = function () {};
    },
  });
  const win = dom.window;
  for (let i = 0; i < 1000 && !(win.NEXO && win.NEXO.initialized); i++) await sleep(10);
  await sleep(800);
  const p = { name, native, win };
  p.setActive = (active) => { vis = active ? 'visible' : 'hidden'; win.document.dispatchEvent(new win.Event('visibilitychange')); native.setAppActive(active); };
  return p;
}
const click = (win, el) => el && el.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
async function openChatWith(p, name) {
  const row = Array.from(p.win.document.querySelectorAll('#main-contacts-list .ble-contact-row')).find((r) => (r.querySelector('.ble-contact-name') || {}).textContent === name);
  click(p.win, row); await sleep(500); return !!row;
}
function sendText(p, t) { const i = p.win.document.getElementById('message-input'); i.value = t; i.dispatchEvent(new p.win.Event('input', { bubbles: true })); click(p.win, p.win.document.getElementById('send-btn')); }
async function addFound(p, name) {
  let add = null;
  const find = () => { const row = Array.from(p.win.document.querySelectorAll('#ble-new-device > div')).find((d) => (d.querySelector('span') || {}).textContent === name); return row && row.querySelector('button'); };
  for (let i = 0; i < 400 && !add; i++) { await sleep(100); add = find(); if (!add && !p.win.bleInterface.isScanning) click(p.win, p.win.document.getElementById('ble-scan-btn')); }
  click(p.win, add); await sleep(2000);
  return !!add;
}
async function waitFor(fn, ms) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return Math.round((Date.now() - t0) / 100) / 10; await sleep(200); } return null; }
const has = (p, from, pred) => p.win.vaultLoadMessages(from).then((l) => l.some(pred));
const hexOf = (a) => a.toLowerCase().replace(/[^0-9a-f]/g, '');

(async () => {
  const r = { prueba: 'resumeciego', build: path.basename(buildDir) };
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', Object.assign({}, base)), nB = new NativePhone('B', 'BB:BB:BB:BB:BB:02', Object.assign({}, base)), nC = new NativePhone('C', 'CC:CC:CC:CC:CC:03', Object.assign({}, base));
  [nA, nB, nC].forEach((n) => { radio.add(n); n.load(); });
  const A = await boot('A', nA), B = await boot('B', nB), C = await boot('C', nC);
  const biA = A.win.bleInterface;
  const idA = biA.localNexoId.toLowerCase(), idB = B.win.bleInterface.localNexoId.toLowerCase(), idC = C.win.bleInterface.localNexoId.toLowerCase();
  // primero solo A y C (B fuera de alcance: sin puente Jump para lo de C)
  radio.block(nA, nB); radio.block(nB, nC);
  biA.togglePanel(); const pC = await addFound(A, 'C'); biA.togglePanel();
  await openChatWith(A, 'C'); sendText(A, 'hola C'); await sleep(2500);
  r.c_recibe = await waitFor(() => has(C, idA, (m) => m.content === 'hola C'), 20000) !== null;
  // A le manda un texto largo y C se va lejos a mitad (como la tablet: sus textos largos quedaron a medias): queda ⏳
  await openChatWith(A, 'C');
  const largo = 'texto largo para la tablet '.repeat(450).trim(); // ~12 KB: va troceado (ChatStream)
  sendText(A, largo);
  await waitFor(() => logs.some((l) => /\[A\].*ChatStream\] START .*type=chat totalChunks=/.test(l)), 5000);
  await sleep(150);
  nC.setOffline(true);
  r.c_fuera_s = await waitFor(() => !biA._bleReadyFor(idC), 30000);
  await sleep(25000); // se rinde (sin enlace) y queda ⏳
  const own = (await A.win.vaultLoadMessages(idC)).find((m) => m._own && m.content === largo);
  r.R1_estado = own ? own.status : 'no está';
  if (!own) r.R1_dbg = (await A.win.vaultLoadMessages(idC)).map((m) => [m._own ? 1 : 0, (m.content || '').length, m.status, m.hidden ? 'h' : '']).slice(-6);
  // ahora B aparece y se empareja con A (C sigue lejos)
  radio.unblock(nA, nB);
  biA.togglePanel(); const pB = await addFound(A, 'B'); biA.togglePanel();
  if (!pB || !pC) { console.log('RESUMECIEGO ' + JSON.stringify({ prueba: 'resumeciego', resultado: 'FALLO', error: 'no empareja' })); process.exit(1); }
  await openChatWith(A, 'B'); sendText(A, 'hola B'); await sleep(2500);
  r.enlace_b = await waitFor(() => !!biA._bleReadyFor(idB), 30000) !== null;
  // direcciones de C que A puede usar (la de anuncio y la de conexión)
  const cIds = new Set([hexOf(nC.address), hexOf(nC.initAddress)]);
  const cWrites = () => nA.btCalls.filter((c) => cIds.has(c.id) || c.id === idC).length;

  // A a segundo plano y de vuelta (como en el diagnóstico: «App de vuelta en primer plano» → «Resume: N outgoing»); B con la app
  // congelada (como el vivo): no confirma lo que A le escribe → A le reenvía cada 15–60 s, y cada vuelta de reenvío repasaba lo de C
  const w0 = cWrites(); const k0 = logs.length;
  A.setActive(false); await sleep(3000); A.setActive(true); await sleep(4000);
  nB.setFrozen(true);
  await openChatWith(A, 'B');
  sendText(A, 'para B uno');
  await sleep(4000);
  sendText(A, 'para B dos');
  await sleep(80000);
  r.R2_escrituras_a_c = cWrites() - w0;
  // B despierta: lo suyo llega
  nB.setFrozen(false);
  const tWake = Date.now();
  const tB2 = await waitFor(async () => (await has(B, idA, (m) => m.content === 'para B uno')) && has(B, idA, (m) => m.content === 'para B dos'), 90000);
  r.R3_b_llega_s = tB2 === null ? null : Math.round((Date.now() - tWake) / 100) / 10;
  r.R2_resume_c = logs.slice(k0).filter((l) => /\[A\].*Resume:.*outgoing para/.test(l) && l.indexOf(idC) >= 0).length;
  r.R2_rendidos = logs.slice(k0).filter((l) => /\[A\].*Bluetooth que el nativo ya soltó/.test(l)).length;

  // C vuelve
  nC.setOffline(false);
  const tBack = Date.now();
  r.R4_llega_s = await waitFor(() => has(C, idA, (m) => m.content === largo), 90000);
  if (r.R4_llega_s !== null) r.R4_llega_s = Math.round((Date.now() - tBack) / 100) / 10;
  r.errores = logs.filter((l) => / error: /.test(l) && !/JSDOMERROR|styles\.css|Not implemented|net::ERR|fetch/.test(l)).slice(0, 5);
  const ok = r.enlace_b && r.c_recibe && r.c_fuera_s !== null && (r.R1_estado === 'pending' || r.R1_estado === 'sending' || r.R1_estado === 'failed') && r.R2_escrituras_a_c === 0 &&
    r.R3_b_llega_s !== null && r.R3_b_llega_s <= 75 && r.R4_llega_s !== null && r.R4_llega_s <= 60 && !r.errores.length;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('RESUMECIEGO ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_resumeciego.txt'), logs.join('\n'));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('RESUMECIEGO ' + JSON.stringify({ prueba: 'resumeciego', resultado: 'FALLO', error: String(e && e.message) })); console.error(e); fs.writeFileSync(path.join(__dirname, 'last_logs_resumeciego.txt'), logs.join('\n')); process.exit(1); });
