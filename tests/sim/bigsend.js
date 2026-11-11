// 3004 (investigación de fondo 11-11: el S24 del dueño se cerraba en bucle al mandar un APK de 25,9 MB por internet).
// Causa encontrada: el registro de salientes de un contacto (UN archivo JSON con TODOS sus envíos pendientes y sus trozos) se
// reescribía entero por el puente de Capacitor; con el contenido de archivos grandes dentro (35 M caracteres por APK, 71 M con
// dos) el nativo lo analiza en el hilo principal y la app muere sin rastro. Además cada arranque lo reintentaba (bucle) y el
// «leído» de la tarjeta de cita marcaba el archivo como leído sin haberse entregado.
// Esta prueba comprueba, con dos teléfonos en Wi-Fi distintas (solo internet):
//  S1/S2  enviar un archivo grande (y luego otro al MISMO contacto): ningún guardado del registro de salientes lleva el contenido
//         (antes: 4 M y 8 M de caracteres) y los dos archivos LLEGAN.
//  S3     un registro gigante heredado de una versión anterior se purga al arrancar (y se guarda pequeño); se conserva lo demás.
//  S4     freno de bucle: un archivo grande con 2 intentos sin terminar no se reintenta solo al arrancar (queda para «reintentar»);
//         al tocar «reintentar» (borra la cuenta) sí sale.
//  S5     un «leído» de un archivo propio aún no entregado (el de la tarjeta de cita) se ignora; el de uno entregado, no.
//  Puras: bigSendBlocked, _readTooEarly.
// Uso: node bigsend.js <dir_build>
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone, installWebCrypto } = require('./native_mock');
const { NostrRelay } = require('./nostr_relay');
const { importSrc } = require('./srcmod');

const buildDir = path.resolve(process.argv[2] || path.join(__dirname, 'builds/wip'));
const BYTES = 3000000;                      // 3 MB → ~4 M caracteres en base64 (> 2 M, el tope del registro)
const base = { readsContentFallback: true, retain: ['onPayloadReceived', 'onLanMessage', 'onLanUp', 'onLanDown'], closeOnNoService: true, pace: [15, 15], ioDelay: 25, asymmetric: true, noTor: true };
let RELAYS = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
class DL extends ResourceLoader { constructor(d) { super(); this.d = d; } fetch(u) { const f = path.join(this.d, decodeURIComponent(new URL(u).pathname)); return fs.existsSync(f) ? Promise.resolve(fs.readFileSync(f)) : Promise.reject(new Error('x')); } }
const logs = [];
const T0 = Date.now();
const ts = () => String(((Date.now() - T0) / 1000).toFixed(1)).padStart(6) + 's';
const saves = [];   // guardados de A por el puente: { f, len, scene }
let scene = 'pre';
function instrument(native, pl, who) {
  native.calls = { push() {}, length: 0, filter() { return []; }, slice() { return []; }, forEach() {}, map() { return []; }, some() { return false; }, find() { return undefined; } };
  if (who !== 'A') return;
  const oS = pl.saveToFile;
  pl.saveToFile = (a) => { const len = String((a && a.content) || '').length; saves.push({ f: String((a && a.filename) || ''), len, scene }); return oS(a); };
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
async function waitFor(fn, ms) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return Math.round((Date.now() - t0) / 100) / 10; await sleep(250); } return null; }
function shutdown(p) {
  try { p.win.bleInterface.net._closeAll(); p.win.bleInterface.net.relays.forEach((rl) => { rl.retryAt = Date.now() + 9e6; }); } catch (e) {}
  p.win.close(); p.native.destroyActivity();
}
const outName = (nx) => 'nexo_vault_outgoing_v2_' + nx + '.json';
function outRecs(native, nx) { const v = native.files.get(outName(nx)); if (!v) return []; try { return (JSON.parse(v).outgoing) || []; } catch (e) { return null; } }
const maxOutSave = (sc) => saves.filter((x) => /^nexo_vault_outgoing_v2_/.test(x.f) && (!sc || x.scene === sc)).reduce((m, x) => Math.max(m, x.len), 0);
const maxNonAttSave = () => saves.filter((x) => !/^nexo_att_/.test(x.f)).reduce((m, x) => Math.max(m, x.len), 0);
async function filesAt(p, from) { const l = await p.win.vaultLoadMessages(from); return l.filter((m) => !m._own && (m.attachmentRef || m.attachmentPayload) && m.attachmentType === 'file'); }
async function ownStatus(p, cid, id) { const l = await p.win.vaultLoadMessages(cid); const m = l.find((x) => (x.msgId || x.messageId) === id); return m ? m.status : null; }

(async () => {
  const r = { prueba: 'bigsend', build: path.basename(buildDir) };
  // ---- puras ----
  const V = await importSrc('vault/vault_manager.js');
  const A0 = await importSrc('ui/ble_ack.js');
  const now = Date.now();
  r.pura_freno = V.bigSendBlocked({ n: 2, t: now - 1000 }, now) === true && V.bigSendBlocked({ n: 1, t: now }, now) === false &&
    V.bigSendBlocked({ n: 5, t: now - V.BIGSEND_WINDOW_MS - 1 }, now) === false && V.bigSendBlocked(null, now) === false;
  r.pura_leido = A0._readTooEarly('pending') && A0._readTooEarly('sending') && !A0._readTooEarly('delivered') && !A0._readTooEarly('sent') && !A0._readTooEarly('read');

  const r1 = new NostrRelay(), r2 = new NostrRelay();
  RELAYS = [await r1.start(), await r2.start()];
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', Object.assign({}, base, { wifi: 'casa' })), nB = new NativePhone('B', 'BB:BB:BB:BB:BB:02', Object.assign({}, base, { wifi: 'oficina' }));
  [nA, nB].forEach((n) => { radio.add(n); n.load(); });
  let A = await boot('A', nA); const B = await boot('B', nB);
  const idA = A.win.bleInterface.localNexoId.toLowerCase(), idB = B.win.bleInterface.localNexoId.toLowerCase();
  A.win.bleInterface.togglePanel(); const paired = await addFound(A, 'B'); A.win.bleInterface.togglePanel();
  if (!paired) { console.log('BIGSEND ' + JSON.stringify(Object.assign(r, { resultado: 'FALLO', error: 'no empareja' }))); process.exit(1); }
  await openChatWith(A, 'B'); sendText(A, 'hola B'); await sleep(2000);
  await openChatWith(B, 'A'); sendText(B, 'hola A'); await sleep(2000);
  radio.block(nA, nB);   // sin Bluetooth: solo internet (dos Wi-Fi distintas)
  A.win.bleInterface.net.tick(); B.win.bleInterface.net.tick();
  r.en_linea_por_internet_s = await waitFor(() => A.win.bleInterface.linkOf(idB) === 'internet' && B.win.bleInterface.linkOf(idA) === 'internet', 60000);
  await openChatWith(A, 'B');
  const buf = Buffer.alloc(BYTES); for (let i = 0; i < buf.length; i++) buf[i] = (i * 31 + 7) & 255;

  // ---- S1 / S2: dos archivos grandes al mismo contacto ----
  scene = 'S1'; pickFile(A, 'uno.bin', buf);
  r.S1_llega_s = await waitFor(async () => (await filesAt(B, idA)).length >= 1, 150000);
  r.S1_max_guardado_salientes = maxOutSave('S1');
  scene = 'S2'; pickFile(A, 'dos.bin', buf); await sleep(400); pickFile(A, 'tres.bin', buf);
  r.S2_llegan_s = await waitFor(async () => (await filesAt(B, idA)).length >= 3, 240000);
  r.S2_max_guardado_salientes = maxOutSave('S2');
  r.salientes_sin_contenido = (outRecs(nA, idB) || []).every((o) => (o.chunks || []).join('').length < 2000000);

  // ---- S5 (parte 1): «leído» de un archivo ya entregado sí se aplica ----
  const ownFiles = (await A.win.vaultLoadMessages(idB)).filter((m) => m._own && m.attachmentType === 'file');
  const delivered = ownFiles.find((m) => m.status === 'delivered' || m.status === 'read');
  r.hay_entregado = !!delivered;

  // ---- S4: freno de bucle (mensaje grande pendiente con 2 intentos sin terminar) ----
  scene = 'S4';
  const gid = 'msg' + Date.now() + 'guard1';
  const b64 = buf.toString('base64');
  await A.win.vaultBigSendBegin(gid); await A.win.vaultBigSendBegin(gid);   // dos intentos que «murieron»
  await A.win.vaultAppendMessage(idB, { msgId: gid, messageId: gid, content: JSON.stringify({ type: 'attachment', attachmentType: 'file', payload: b64, meta: { name: 'g.bin', size: BYTES } }), _own: true, status: 'sending', timestamp: Date.now(), attachmentType: 'file', attachmentPayload: b64, attachmentMeta: { name: 'g.bin', size: BYTES } });
  // ---- S3: registro gigante heredado (versión anterior) + uno pequeño + uno caducado, inyectados antes de reiniciar ----
  const legacy = { transferId: 'msg1793000000000legacy', type: 'file', status: 'sending', totalChunks: 300, chunks: Array.from({ length: 300 }, () => 'L'.repeat(10000)), sentMask: '', ackMask: '', meta: {}, deviceId: 'net:' + idB, createdAt: Date.now(), updatedAt: Date.now(), expiresAt: Date.now() + 86400000 };
  const small = { transferId: 'fxs_prueba_pequeno', type: 'file', status: 'complete', totalChunks: 1, chunks: ['p'.repeat(500)], sentMask: '1', ackMask: '1', meta: { type: 'fenix' }, deviceId: '', createdAt: Date.now(), updatedAt: Date.now(), expiresAt: Date.now() + 86400000 };
  const expired = { transferId: 'fxs_prueba_caducado', type: 'file', status: 'complete', totalChunks: 1, chunks: ['c'], sentMask: '1', ackMask: '1', meta: { type: 'fenix' }, deviceId: '', createdAt: 1, updatedAt: 1, expiresAt: Date.now() - 1000 };
  shutdown(A); await sleep(300);
  const prev = outRecs(nA, idB) || [];
  nA.files.set(outName(idB), JSON.stringify({ outgoing: prev.concat([legacy, small, expired]), savedAt: Date.now() }));
  scene = 'S3';
  const logMark = logs.length;
  nA.load(); A = await boot('A', nA);
  await sleep(15000);
  const after = outRecs(nA, idB) || [];
  r.S3_gigante_purgado = !after.some((o) => o.transferId === legacy.transferId);
  r.S3_caducado_purgado = !after.some((o) => o.transferId === expired.transferId);
  r.S3_pequeno_conservado = after.some((o) => o.transferId === small.transferId);
  r.S3_max_guardado_salientes = maxOutSave('S3');
  // S4 (cont.): tras el arranque, el mensaje frenado NO salió solo y quedó para «reintentar»
  const s4logs = logs.slice(logMark).join('\n');
  r.S4_no_reintenta_solo = !new RegExp('sendFile START fileId=' + gid).test(s4logs) && /no se reintenta solo/.test(s4logs);
  r.S4_estado = await ownStatus(A, idB, gid);
  // ---- S5 (parte 2): un «leído» del archivo frenado (no entregado) se ignora; uno del entregado se aplica ----
  const AS = A.win.bleInterface.ackSystem;
  AS._applyAck({ type: 'read_receipt', msgId: gid, from: idB }, gid);
  if (delivered) AS._applyAck({ type: 'read_receipt', msgId: delivered.msgId || delivered.messageId, from: idB }, delivered.msgId || delivered.messageId);
  await sleep(1500);
  r.S5_leido_prematuro_ignorado = (await ownStatus(A, idB, gid)) !== 'read';
  r.S5_leido_entregado_aplicado = delivered ? (await ownStatus(A, idB, delivered.msgId || delivered.messageId)) === 'read' : null;
  // S4 (fin): «reintentar» a mano (borra la cuenta) → sí sale
  const mark2 = logs.length;
  await A.win.vaultBigSendEnd(gid);
  A.win.bleInterface._bigBlockedNoted && A.win.bleInterface._bigBlockedNoted.delete(gid);
  A.win.bleInterface._resendPendingMessages(idB);
  r.S4_reintentar_sale_s = await waitFor(() => new RegExp('sendFile START fileId=' + gid).test(logs.slice(mark2).join('\n')), 30000);

  r.max_guardado_no_adjunto = maxNonAttSave();
  r.errores = logs.filter((l) => / error: /.test(l) && !/JSDOMERROR|styles\.css|Not implemented|GLOBAL TIMEOUT|net::ERR|fetch/.test(l)).slice(0, 5);
  const LIM = 2000000;
  const ok = r.pura_freno && r.pura_leido && r.en_linea_por_internet_s !== null && r.S1_llega_s !== null && r.S2_llegan_s !== null &&
    r.S1_max_guardado_salientes < LIM && r.S2_max_guardado_salientes < LIM && r.salientes_sin_contenido &&
    r.S3_gigante_purgado && r.S3_caducado_purgado && r.S3_pequeno_conservado && r.S3_max_guardado_salientes < LIM &&
    r.S4_no_reintenta_solo && r.S4_estado === 'failed' && r.S4_reintentar_sale_s !== null &&
    r.S5_leido_prematuro_ignorado && r.S5_leido_entregado_aplicado === true && r.max_guardado_no_adjunto < LIM && !r.errores.length;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('BIGSEND ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_bigsend.txt'), logs.join('\n'));
  await r1.stop(); await r2.stop();
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('BIGSEND ' + JSON.stringify({ prueba: 'bigsend', resultado: 'FALLO', error: String(e && e.message).replace(/"/g, "'") })); console.error(e && e.stack); fs.writeFileSync(path.join(__dirname, 'last_logs_bigsend.txt'), logs.join('\n')); process.exit(1); });
