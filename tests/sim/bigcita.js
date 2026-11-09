// Fase D de la entrega offline (build 2972): la «CITA» para archivos > 5 MB a un contacto AUSENTE — dos teléfonos.
// A y B se conocen por Bluetooth; cada uno a su casa (solo internet); B APAGA el teléfono. A manda un archivo de 6 MB (no cabe
// en el buzón de archivos de la Fase B):
//  (1) en A queda ⏳ (pendiente, no ✗) y A deja en el buzón de B un AVISO chiquito (nombre, tamaño): un solo evento, nada
//      legible; A entra al toque FCM por pendientes (Fase A).
//  (2) B vuelve: en su chat aparece un MARCADOR «📦 nombre · 6 MB · esperando que los dos estén en línea» (sin tocar la red
//      por el archivo), B contesta «ya estoy» al buzón de A y entra al toque MUTUO (si A durmiera, B lo despierta).
//  (3) A recibe el «ya estoy», saluda y reenvía lo pendiente: el archivo va por el flujo directo de siempre; en B el marcador se
//      vuelve el archivo entero (mismo id, una sola burbuja) y A ve ✓✓; la cita se da por cumplida.
// Uso: node bigcita.js <dir_build>
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone, installWebCrypto } = require('./native_mock');
const { NostrRelay } = require('./nostr_relay');

const buildDir = path.resolve(process.argv[2]);
const base = { readsContentFallback: true, retain: ['onPayloadReceived', 'onLanMessage', 'onLanUp', 'onLanDown'], closeOnNoService: true, pace: [15, 15], ioDelay: 25, asymmetric: true, noL2: true };
let RELAYS = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
class DistLoader extends ResourceLoader {
  constructor(dir) { super(); this.dir = dir; }
  fetch(url) { const f = path.join(this.dir, decodeURIComponent(new URL(url).pathname)); return fs.existsSync(f) ? Promise.resolve(fs.readFileSync(f)) : Promise.reject(new Error('no existe ' + f)); }
}
const logs = [];
async function boot(name, native) {
  native.listeners = new Map();
  const vc = new VirtualConsole();
  ['log', 'warn', 'error'].forEach((l) => vc.on(l, (...a) => logs.push(`${new Date().toISOString().substring(14, 23)} [${name}] ${l}: ` + a.map(String).join(' ').substring(0, 300))));
  const dom = new JSDOM(fs.readFileSync(path.join(buildDir, 'dist', 'index.html'), 'utf8'), {
    url: 'https://' + name.toLowerCase() + '.nexo.test/index.html', runScripts: 'dangerously',
    resources: new DistLoader(path.join(buildDir, 'dist')), pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) { win.NEXO_NET_RELAYS = RELAYS; win.CapacitorCustomPlatform = { name: 'android' }; installWebCrypto(win); win.Capacitor = { Plugins: { NexoBLE: native.plugin() } }; win.HTMLElement.prototype.scrollTo = function () {}; },
  });
  const win = dom.window;
  for (let i = 0; i < 100 && !(win.NEXO && win.NEXO.initialized); i++) await sleep(100);
  await sleep(800);
  return { name, native, win };
}
const click = (win, el) => el && el.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
async function openChatWith(p, name) {
  const row = Array.from(p.win.document.querySelectorAll('#main-contacts-list .ble-contact-row')).find((r) => (r.querySelector('.ble-contact-name') || {}).textContent === name);
  click(p.win, row); await sleep(500); return !!row;
}
function sendText(p, t) { const i = p.win.document.getElementById('message-input'); i.value = t; i.dispatchEvent(new p.win.Event('input', { bubbles: true })); click(p.win, p.win.document.getElementById('send-btn')); }
async function sendFile(p, name, bytes) {
  const b = Buffer.alloc(bytes); for (let i = 0; i < b.length; i++) b[i] = (i * 31 + name.length * 7) & 255;
  click(p.win, p.win.document.querySelector('.attach-menu-item[data-type="file"]')); await sleep(100);
  const fin = Array.from(p.win.document.querySelectorAll('input[type=file]')).pop();
  Object.defineProperty(fin, 'files', { configurable: true, value: [new p.win.File([b], name, { type: 'application/octet-stream' })] });
  fin.dispatchEvent(new p.win.Event('change'));
  return b;
}
async function addFound(p, name) {
  let add = null;
  const find = () => { const row = Array.from(p.win.document.querySelectorAll('#ble-new-device > div')).find((d) => (d.querySelector('span') || {}).textContent === name); return row && row.querySelector('button'); };
  for (let i = 0; i < 400 && !add; i++) { await sleep(100); add = find(); if (!add && !p.win.bleInterface.isScanning) click(p.win, p.win.document.getElementById('ble-scan-btn')); }
  click(p.win, add); await sleep(2000);
  return !!add;
}
async function waitFor(fn, ms) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return Math.round((Date.now() - t0) / 100) / 10; await sleep(200); } return null; }
function shutdown(p) {
  try { p.win.bleInterface.net._closeAll(); p.win.bleInterface.net.relays.forEach((rl) => { rl.retryAt = Date.now() + 9e6; }); } catch (e) {}
  p.win.close(); p.native.destroyActivity();
}
const vaultMsgs = (p, chat) => p.win.vaultLoadMessages(chat);
async function findMsg(p, chat, b64, own) {
  const list = await vaultMsgs(p, chat);
  return list.find((m) => !!m._own === !!own && m.attachmentType && !m.deleted && !m.hidden && (m.attachmentPayload || p.native.files.get(m.attachmentRef)) === b64) || null;
}
const statusOf = (p, msgId) => { const s = p.win.document.querySelector('.msg-status[data-msg-id="' + msgId + '"]'); const m = s && (s.className || '').match(/status-([a-z]+)/); return m ? m[1] : null; };

(async () => {
  const r = { prueba: 'bigcita', build: path.basename(buildDir) };
  const r1 = new NostrRelay(), r2 = new NostrRelay({ authRequired: true });
  RELAYS = [await r1.start(), await r2.start()];
  const relays = [r1, r2];
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', Object.assign({}, base, { wifi: 'casa', noTor: true })), nB = new NativePhone('B', 'BB:BB:BB:BB:BB:02', Object.assign({}, base, { wifi: 'oficina', noTor: true }));
  [nA, nB].forEach((n) => { radio.add(n); n.load(); });
  let A = await boot('A', nA), B = await boot('B', nB);
  const idA = A.win.bleInterface.localNexoId.toLowerCase(), idB = B.win.bleInterface.localNexoId.toLowerCase();
  A.win.bleInterface.togglePanel(); const paired = await addFound(A, 'B'); A.win.bleInterface.togglePanel();
  if (!paired) { console.log('BIGCITA ' + JSON.stringify({ prueba: 'bigcita', resultado: 'FALLO', error: 'no empareja' })); process.exit(1); }
  await openChatWith(A, 'B'); sendText(A, 'hola B'); await sleep(3000);
  await openChatWith(B, 'A'); sendText(B, 'hola A'); await sleep(3000);
  radio.block(nA, nB);
  const netA = () => A.win.bleInterface.net, viaA = () => A.win.bleInterface.linkOf(idB), viaB = () => B.win.bleInterface.linkOf(idA);
  netA().tick(); B.win.bleInterface.net.tick();
  r.en_linea_por_internet_s = await waitFor(() => viaA() === 'internet' && viaB() === 'internet', 60000);

  // ===== (1) B apaga; A manda 6 MB (> 5 MB: no cabe en el buzón de archivos) =====
  shutdown(B); await sleep(500);
  const pB = netA().peers.get(idB); if (pB) pB.lastRx = 0; await netA().tick();
  r.A_ve_que_B_no_esta = await waitFor(() => !netA().canReach(idB), 15000) !== null;
  const ev0 = relays.map((x) => x.events.length), b0 = relays.reduce((n, x) => n + x.events.filter((e) => e.kind === 1064).length, 0);
  const archivo = await sendFile(A, 'pelicula.bin', 6 * 1024 * 1024);
  const b64 = archivo.toString('base64');
  let msgA = null;
  r.A_registrado_s = await waitFor(async () => !!(msgA = await findMsg(A, idB, b64, true)), 20000);
  const fileId = msgA && msgA.messageId;
  r.A_queda_pendiente_s = await waitFor(() => statusOf(A, fileId) === 'pending', 20000);
  r.A_aviso_log = await waitFor(() => logs.some((l) => /\[A\].*\[CITA\].*le dejo el aviso/.test(l)), 15000) !== null;
  await sleep(1500);
  r.sin_trozos_1064 = relays.reduce((n, x) => n + x.events.filter((e) => e.kind === 1064).length, 0) === b0; // nada del archivo en los relés
  r.eventos_nuevos_r1 = r1.events.length - ev0[0]; // informativo (aviso + saludos)
  r.A_programa_toque = await waitFor(() => !!(A.win.bleInterface._pendingWake && A.win.bleInterface._pendingWake.has(idB)), 10000) !== null;
  r.A_recuerda_aviso = (A.win.localStorage.getItem('nexo_cita_out') || '').indexOf(fileId) >= 0;
  const all1 = relays.map((x) => x.events.map((e) => JSON.stringify(e)).join('\n')).join('\n').toLowerCase();
  r.reles_ven_algo = ['pelicula', idA, idB, '"type"', b64.substring(0, 24).toLowerCase()].filter((x) => all1.indexOf(x) >= 0);

  // ===== (2) B vuelve: marcador en el chat, «ya estoy» a A y toque mutuo =====
  nB.load(); B = await boot('B', nB);
  let marker = null;
  r.B_marcador_s = await waitFor(async () => { const list = await vaultMsgs(B, idA); marker = list.find((m) => m.messageId === fileId) || null; return !!(marker && marker.attachmentMeta && marker.attachmentMeta.cita); }, 30000);
  r.B_marcador_sin_archivo = !!marker && !marker.attachmentPayload && !marker.attachmentRef && marker.attachmentMeta.cita.bytes === 6 * 1024 * 1024 && marker.attachmentType === 'file';
  r.B_toque_mutuo = !!(B.win.bleInterface._pendingWake && B.win.bleInterface._pendingWake.has(idA)) || logs.some((l) => /\[B\].*\[CITA\].*tiene un archivo/.test(l));
  r.B_log_cita = logs.some((l) => /\[B\].*\[CITA\].*tiene un archivo de 6 MB/.test(l));
  await openChatWith(B, 'A');
  r.B_tarjeta_esperando = await waitFor(() => !!B.win.document.querySelector('.message[data-msg-id="' + fileId + '"] .file-attachment[data-cita="1"], .file-attachment[data-cita="1"]'), 10000) !== null;
  const cardTxt = (B.win.document.querySelector('.file-attachment[data-cita="1"] .file-sub') || {}).textContent || '';
  r.B_tarjeta_texto = cardTxt.substring(0, 80);
  r.A_recibe_ya_estoy_s = await waitFor(() => logs.some((l) => /\[A\].*\[CITA\].*ya está/.test(l)), 30000);

  // ===== (3) coinciden: el archivo va por el flujo directo; el marcador se vuelve el archivo; A ✓✓ =====
  r.de_vuelta_en_linea_s = await waitFor(() => viaA() === 'internet' && netA().canReach(idB), 60000);
  let msgB = null;
  r.B_recibe_el_archivo_s = await waitFor(async () => !!(msgB = await findMsg(B, idA, b64, false)), 240000);
  const conId = (await vaultMsgs(B, idA)).filter((m) => m.messageId === fileId);
  r.B_una_sola_burbuja = conId.length === 1 && !!msgB && msgB.messageId === fileId && !(msgB.attachmentMeta && msgB.attachmentMeta.cita);
  r.B_marcador_reemplazado_en_pantalla = await waitFor(() => !B.win.document.querySelector('.file-attachment[data-cita="1"]') && !!B.win.document.querySelector('.message[data-msg-id="' + fileId + '"] .file-attachment'), 15000) !== null;
  r.B_cita_cumplida = !(B.win.bleInterface._citaIn && B.win.bleInterface._citaIn.has(fileId)) && logs.some((l) => /\[B\].*\[CITA\].*llegó/.test(l));
  r.A_doble_tick_s = await waitFor(() => ['delivered', 'read'].includes(statusOf(A, fileId)), 60000);

  r.errores = logs.filter((l) => /ilegible|Error procesando|No se pudo descifrar|\[CITA\].*rechazado|\[BLOB\].*( descartado:|rechazado \(|no se pudo bajar|caducó|no pudo subirse)/.test(l)).slice(0, 3);
  r.contenido_en_registros = logs.filter((l) => l.indexOf(b64.substring(0, 24)) >= 0).length;

  const numeric = ['en_linea_por_internet_s', 'A_registrado_s', 'A_queda_pendiente_s', 'B_marcador_s', 'A_recibe_ya_estoy_s', 'de_vuelta_en_linea_s', 'B_recibe_el_archivo_s', 'A_doble_tick_s'];
  const info = { prueba: 1, build: 1, resultado: 1, eventos_nuevos_r1: 1, B_tarjeta_texto: 1 };
  const ok = numeric.every((k) => typeof r[k] === 'number') && r.reles_ven_algo.length === 0 && r.errores.length === 0 && r.contenido_en_registros === 0 &&
    Object.keys(r).every((k) => info[k] || typeof r[k] !== 'boolean' || r[k] === true);
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('BIGCITA ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_bigcita.txt'), logs.join('\n'));
  await Promise.all(relays.map((x) => x.stop()));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('BIGCITA {"prueba":"bigcita","resultado":"FALLO","error":"' + String(e && e.message).replace(/"/g, "'") + '"}'); console.error(e && e.stack); fs.writeFileSync(path.join(__dirname, 'last_logs_bigcita.txt'), logs.join('\n')); process.exit(1); });
