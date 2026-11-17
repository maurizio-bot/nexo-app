// 3177 (prueba de ciudad 17-11, semilla 1, envíos #117 y #119): una FOTO DE GRUPO por el buzón de archivos que llega por BLUETOOTH
// se guardaba ROTA. Con internet, la foto al grupo se sube una vez a los relés y cada miembro recibe dentro del sobre del grupo un
// PUNTERO; ese sobre (~700 letras) por Bluetooth viaja como texto largo por trozos, y ese camino (ble_ack_resume.
// _dispatchChunkedMessageComplete → main_chats) aplicaba el adjunto sin mirar el puntero: Lola y Ana guardaron la foto con contenido
// 'ptr' (2 bytes) y nunca la bajaron; a Ana le llegó después la foto entera por otro camino y se quedó tapada por la copia rota.
// A, B y C con internet (3 relés); A y B en la misma Wi-Fi (como Lola; a Ana le llegó por Bluetooth: el mismo camino de trozos),
// C lejos (solo internet). A manda una foto de 80 KB al grupo [B, C]:
//  G1  el sobre con el puntero le llega a B por trozos (Wi-Fi), B baja la foto de los relés y la guarda IDÉNTICA;
//  G2  C (por internet, camino corto) también; A ve ✓✓ de los dos;
//  G3  una copia rota ('ptr') ya guardada no tapa la buena cuando esta llega (el contenido viejo no se queda encima).
// Uso: node grupoptr.js <dir_build>
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone, installWebCrypto } = require('./native_mock');
const { NostrRelay } = require('./nostr_relay');

const buildDir = path.resolve(process.argv[2] || path.join(__dirname, 'builds/wip'));
const base = { readsContentFallback: true, retain: ['onPayloadReceived', 'onLanMessage', 'onLanUp', 'onLanDown'], closeOnNoService: true, pace: [15, 15], ioDelay: 25, asymmetric: true, noL2: true, noTor: true };
let RELAYS = [];
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
    beforeParse(win) { win.NEXO_NET_RELAYS = RELAYS; win.CapacitorCustomPlatform = { name: 'android' }; installWebCrypto(win); win.Capacitor = { Plugins: { NexoBLE: native.plugin() } }; win.HTMLElement.prototype.scrollTo = function () {}; },
  });
  const win = dom.window;
  for (let i = 0; i < 100 && !(win.NEXO && win.NEXO.initialized); i++) await sleep(100);
  await sleep(800);
  return { name, native, win };
}
const click = (win, el) => el && el.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
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
const payloadOf = (p, m) => (m && (m.attachmentPayload || (m.attachmentRef && p.native.files.get(m.attachmentRef)))) || null;

(async () => {
  const r = { prueba: 'grupoptr', build: path.basename(buildDir) };
  const relays = [new NostrRelay(), new NostrRelay(), new NostrRelay()];
  RELAYS = [];
  for (const x of relays) RELAYS.push(await x.start());
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', Object.assign({}, base, { wifi: 'casa' }));
  const nB = new NativePhone('B', 'BB:BB:BB:BB:BB:02', Object.assign({}, base, { wifi: 'casa' }));
  const nC = new NativePhone('C', 'CC:CC:CC:CC:CC:03', Object.assign({}, base, { wifi: 'campo' }));
  [nA, nB, nC].forEach((n) => { radio.add(n); n.load(); });
  const A = await boot('A', nA), B = await boot('B', nB), C = await boot('C', nC);
  const id = (p) => p.win.bleInterface.localNexoId.toLowerCase();
  const idA = id(A), idB = id(B), idC = id(C);
  A.win.bleInterface.togglePanel(); const pAB = await addFound(A, 'B'); const pAC = await addFound(A, 'C'); A.win.bleInterface.togglePanel();
  if (!pAB || !pAC) { console.log('GRUPOPTR ' + JSON.stringify(Object.assign(r, { resultado: 'FALLO', error: 'no empareja' }))); process.exit(1); }
  for (const [x, nx] of [['B', idB], ['C', idC]]) { await openChat(A, nx); typeSend(A, 'hola ' + x); await sleep(2500); await closeChat(A); }
  const gid = A.win.bleInterface.groups.create('Amigos', [idB, idC]).id;
  A.win.NEXO_openGroupChat(gid); await sleep(600);
  typeSend(A, 'hola grupo');
  r.grupo_en_B_y_C_s = await waitFor(() => !!B.win.bleInterface.groups.get(gid) && !!C.win.bleInterface.groups.get(gid), 60000);
  // C se va lejos (solo internet); A y B siguen cerca por Bluetooth
  radio.block(nA, nC); radio.block(nB, nC);
  [A, B, C].forEach((p) => p.win.bleInterface.net.tick());
  r.A_en_linea_s = await waitFor(() => A.win.bleInterface.net.online() && A.win.bleInterface.net.canReach(idC), 60000);
  r.A_B_por = A.win.bleInterface.linkOf(idB);

  // ---- G1/G2: foto de 80 KB al grupo (buzón de archivos: puntero dentro del sobre) ----
  const foto = Buffer.alloc(80000); for (let i = 0; i < foto.length; i++) foto[i] = (i * 29 + 11) & 255; Buffer.from('FOTOGRUPO').copy(foto, 0);
  const b64 = foto.toString('base64');
  const mark = logs.length;
  A.win.NEXO_sendAttachment('image', b64, { format: 'jpeg', width: 800, height: 600 });
  let gm = null;
  await waitFor(async () => { const m = (await A.win.vaultLoadMessages(gid)).filter((x) => x._own && x.attachmentType === 'image').pop(); gm = m && m.msgId; return !!gm; }, 10000);
  const widB = gm + '_' + idB.substring(2), widC = gm + '_' + idC.substring(2);
  r.G1_por_buzon = await waitFor(() => logs.slice(mark).some((l) => /\[A\].*\[BLOB\].*buzón de archivos: cifro una vez/.test(l)), 15000) !== null;
  r.G1_sobre_a_B_por_trozos = await waitFor(() => logs.slice(mark).some((l) => l.indexOf('[A] log: [ChatStream] START msgId=' + widB + ' type=chat') >= 0), 30000) !== null;
  const inB = async () => (await B.win.vaultLoadMessages(gid)).find((x) => x.msgId === widB) || null;
  const inC = async () => (await C.win.vaultLoadMessages(gid)).find((x) => x.msgId === widC) || null;
  r.G1_B_foto_identica_s = await waitFor(async () => payloadOf(B, await inB()) === b64, 90000);
  const mB = await inB();
  r.G1_B_guardado = mB ? (payloadOf(B, mB) === b64 ? 'idéntica' : 'rota (' + String(payloadOf(B, mB) || '').length + ' letras: ' + String(payloadOf(B, mB) || '').substring(0, 8) + ')') : 'no está';
  r.G1_B_bajo_del_buzon = logs.slice(mark).some((l) => /\[B\].*\[BLOB\].*(bajado y verificado|ya lo tenía)/.test(l));
  r.G2_C_foto_identica_s = await waitFor(async () => payloadOf(C, await inC()) === b64, 90000);
  const stA = () => (A.win.bleInterface.groups.st[gm] || {}).m || {};
  r.G2_A_doble_tick_s = await waitFor(() => Object.keys(stA()).length === 2 && Object.values(stA()).every((s) => s === 'delivered' || s === 'read'), 60000);

  // ---- G3: una copia rota ya guardada no tapa la buena ----
  const full = Buffer.alloc(30000); for (let i = 0; i < full.length; i++) full[i] = (i * 7 + 3) & 255;
  const fullB64 = full.toString('base64');
  const rid = 'msgrota' + Date.now();
  const roto = { type: 'attachment', attachmentType: 'image', payload: 'ptr', meta: { ptr: 1 } };
  await B.win.vaultAppendMessage(idA, { msgId: rid, messageId: rid, content: JSON.stringify(roto), _own: false, status: 'delivered', senderNexoId: idA, attachmentType: 'image', attachmentPayload: 'ptr', attachmentMeta: { ptr: 1 } });
  await B.win.vaultAppendMessage(idA, { msgId: rid, messageId: rid, content: JSON.stringify({ type: 'attachment', attachmentType: 'image', payload: fullB64, meta: { format: 'jpeg' } }), _own: false, status: 'delivered', senderNexoId: idA, attachmentType: 'image', attachmentPayload: fullB64, attachmentMeta: { format: 'jpeg' } });
  await sleep(500);
  const mR = (await B.win.vaultLoadMessages(idA)).find((x) => x.msgId === rid);
  r.G3_copia_buena_gana = payloadOf(B, mR) === fullB64;
  // al dibujar (vaultHydrateAttachments) un contenido guardado en el mensaje manda sobre su archivo: no debe quedar el viejo
  r.G3_al_dibujar = mR ? (mR.attachmentPayload ? (mR.attachmentPayload === fullB64 ? 'la buena' : 'la rota: ' + String(mR.attachmentPayload).substring(0, 8)) : (mR.attachmentRef && nB.files.get(mR.attachmentRef) === fullB64 ? 'la buena' : 'sin datos')) : null;

  r.errores = logs.filter((l) => /ilegible|Error procesando|No se pudo descifrar|\[BLOB\].*( descartado:|rechazado \(|caducó|no pudo subirse)/.test(l)).slice(0, 3);
  const ok = r.grupo_en_B_y_C_s !== null && r.A_en_linea_s !== null && r.G1_por_buzon && r.G1_sobre_a_B_por_trozos && r.G1_B_foto_identica_s !== null && r.G1_B_bajo_del_buzon &&
    r.G2_C_foto_identica_s !== null && r.G2_A_doble_tick_s !== null && r.G3_copia_buena_gana && r.G3_al_dibujar === 'la buena' && !r.errores.length;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('GRUPOPTR ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_grupoptr.txt'), logs.join('\n'));
  await Promise.all(relays.map((x) => x.stop()));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('GRUPOPTR ' + JSON.stringify({ prueba: 'grupoptr', resultado: 'FALLO', error: String(e && e.message).replace(/"/g, "'") })); console.error(e && e.stack); fs.writeFileSync(path.join(__dirname, 'last_logs_grupoptr.txt'), logs.join('\n')); process.exit(1); });
