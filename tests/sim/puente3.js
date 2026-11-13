// Dueño 13-11 — PUENTE A INTERNET, parte 3: FOTOS PEQUEÑAS por el puente e indicador «por puente».
// A sin internet usa a B1 (con internet, cerca) de puente; C está lejos (solo internet):
//   1. el filtro del que presta deja pasar los trozos del buzón de archivos y pedir hasta 16 por id (no «tráeme todo»);
//   2. el subtítulo del chat de A con C dice «por puente»;
//   3. A manda a C un archivo pequeño (120 KB): llega idéntico;
//   4. un archivo grande (1 MB) NO sale por el puente: queda ⏳ (no «enviando» clavado) y no llega;
//   5. C manda a A un archivo pequeño: le llega por el puente;
//   6. el que presta lleva la cuenta de bytes de A (tope por hora y por día).
// Contraprueba 3046: 2, 3 y 6 fallan (las fotos de A quedaban ⏳: «por un puente, solo textos»).
// Uso: node puente3.js <dir_build>
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone, installWebCrypto } = require('./native_mock');
const { NostrRelay } = require('./nostr_relay');
const { importSrc } = require('./srcmod');

const buildDir = path.resolve(process.argv[2] || path.join(__dirname, 'builds/wip'));
const base = { readsContentFallback: true, retain: ['onPayloadReceived', 'onLanMessage', 'onLanUp', 'onLanDown'], closeOnNoService: true, pace: [15, 15], ioDelay: 25, asymmetric: true, noTor: true };
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
  const r = { prueba: 'puente3', build: path.basename(buildDir) };
  try {
    const gw = await importSrc('net/gw_link.js'), nl = await importSrc('net/net_link.js');
    const sk = new Uint8Array(32).fill(7), P = 'a'.repeat(64), H = (n) => Array.from({ length: n }, (_, k) => k.toString(16).padStart(64, '0'));
    const blob = nl.netMakeEvent(sk, 1064, [], 'x'), raro = nl.netMakeEvent(sk, 1, [], 'x');
    const cases = [[['EVENT', blob], 'BLOB'], [['EVENT', raro], ''], [['REQ', 'b1', { ids: H(16) }], 'REQ'], [['REQ', 'b2', { ids: H(17) }], ''],
      [['REQ', 'b3', { kinds: [1064] }], ''], [['REQ', 'b4', { ids: [] }], ''], [['REQ', 's1', { kinds: [1059], '#p': [P] }], 'REQ']];
    r.filtro = cases.map(([f, want]) => gw.gwAllowUp(JSON.stringify(f)) === want ? 1 : 0).join('');
  } catch (e) { r.filtro = 'error ' + String(e && e.message).slice(0, 80); }
  const r1 = new NostrRelay(), r2 = new NostrRelay();
  RELAYS = [await r1.start(), await r2.start()];
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', base), nB1 = new NativePhone('B1', 'BB:BB:BB:BB:BB:02', base), nC = new NativePhone('C', 'CC:CC:CC:CC:CC:04', base);
  [nA, nB1, nC].forEach((n) => { radio.add(n); n.load(); });
  const A = await boot('A', nA, true), B1 = await boot('B1', nB1), C = await boot('C', nC);
  const id = (p) => p.win.bleInterface.localNexoId.toLowerCase();
  const idA = id(A), idB1 = id(B1), idC = id(C);
  A.win.bleInterface.togglePanel();
  const paired = (await addFound(A, 'B1')) && (await addFound(A, 'C'));
  A.win.bleInterface.togglePanel();
  if (!paired) { console.log('PUENTE3 ' + JSON.stringify(Object.assign(r, { resultado: 'FALLO', error: 'no empareja' }))); process.exit(1); }
  for (const n of ['B1', 'C']) { await openChatWith(A, n); sendText(A, 'hola ' + n); await sleep(1500); }
  await sleep(2000);
  radio.block(nA, nC); radio.block(nB1, nC);
  [B1, C].forEach((p) => p.win.bleInterface.net.tick());
  const netA = A.win.bleInterface.net;
  r.puente_s = await waitFor(() => netA.gw && netA.gwOnly() && netA.gw.bridges.has(idB1), 90000);
  r.c_en_linea_para_A_s = await waitFor(() => netA.canReach(idC), 60000);
  // 2. «por puente» en el subtítulo del chat
  await openChatWith(A, 'C');
  r.subtitulo_s = await waitFor(() => /por puente/.test((A.win.document.getElementById('chat-contact-subtitle') || {}).title || ''), 15000);
  r.subtitulo = (A.win.document.getElementById('chat-contact-subtitle') || {}).title || '';
  // 3. A → C: archivo pequeño por el puente
  const chico = await sendFile(A, 'foto_chica.jpg', 120000), chicoB64 = chico.toString('base64');
  r.chico_llega_s = await waitFor(async () => !!(await findMsg(C, idA, chicoB64, false)), 90000);
  // 4. A → C: archivo grande NO pasa por el puente
  const grande = await sendFile(A, 'grande.bin', 1024 * 1024), grandeB64 = grande.toString('base64');
  await sleep(25000);
  r.grande_no_llega = !(await findMsg(C, idA, grandeB64, false));
  const mg = await findMsg(A, idC, grandeB64, true);
  // lo que ve el dueño en la burbuja (la bóveda no «degrada» enviando → pendiente: regla v2.2.3)
  const st = mg && A.win.document.querySelector('.msg-status[data-msg-id="' + (mg.messageId || mg.msgId || mg.id) + '"]');
  const cm = st && (st.className || '').match(/status-([a-z]+)/);
  r.grande_estado = cm ? cm[1] : (mg ? 'boveda:' + mg.status : null);
  // 5. C → A: archivo pequeño le llega por el puente
  await openChatWith(C, 'A');
  const deC = await sendFile(C, 'foto_de_c.jpg', 90000), deCB64 = deC.toString('base64');
  r.de_c_llega_s = await waitFor(async () => !!(await findMsg(A, idC, deCB64, false)), 90000);
  // 6. el que presta lleva la cuenta de bytes de A
  const bb = B1.win.bleInterface.net.gw && B1.win.bleInterface.net.gw.blobBytes && B1.win.bleInterface.net.gw.blobBytes.get(idA);
  r.bytes_contados_kb = bb ? Math.round(bb.d / 1024) : 0;
  r.b1_ve_archivos = (await B1.win.vaultLoadMessages(idA)).concat(await B1.win.vaultLoadMessages(idC)).filter((m) => m.attachmentType).length;
  r.errores = logs.filter((l) => / error: /.test(l) && !/JSDOMERROR|styles\.css|Not implemented|GLOBAL TIMEOUT|net::ERR|fetch|ECONNREFUSED|WebSocket/.test(l)).slice(0, 5);
  const ok = r.filtro === '1111111' && r.puente_s !== null && r.subtitulo_s !== null && r.chico_llega_s !== null && r.grande_no_llega && r.grande_estado === 'pending' &&
    r.de_c_llega_s !== null && r.bytes_contados_kb >= 150 && r.b1_ve_archivos === 0 && !r.errores.length;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('PUENTE3 ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_puente3.txt'), logs.join('\n'));
  [A, B1, C].forEach(shutdown);
  await r1.stop(); await r2.stop();
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('PUENTE3 ' + JSON.stringify({ prueba: 'puente3', resultado: 'FALLO', error: String(e && e.message).replace(/"/g, "'") })); console.error(e && e.stack); fs.writeFileSync(path.join(__dirname, 'last_logs_puente3.txt'), logs.join('\n')); process.exit(1); });
