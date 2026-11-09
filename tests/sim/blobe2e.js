// Fase B de la entrega offline (build 2969) — PUNTA A PUNTA con dos teléfonos: ARCHIVO A UN TELÉFONO APAGADO.
// A y B se conocen por Bluetooth y se van cada uno a su casa (solo internet; 3 relés como los públicos, uno pide identificarse
// —NIP-42—). B APAGA el teléfono (cierra la app). A manda un archivo de 300 KB:
//  (1) la burbuja de A pasa a ✓ sin esperar a B (el puntero quedó guardado en un relé); en los relés quedan los 8 trozos
//      CIFRADOS (kind 1064) replicados en los 3, SIN etiqueta del destinatario y con caducidad de 7 días; nada legible; A no
//      abrió ningún flujo por trozos y recuerda el blob para borrarlo. Antes (hasta la 2968): PEER_ABSENT → ⏳ hasta coincidir.
//  (2) B vuelve (arranca la app): lee el puntero de su buzón, baja los trozos por id (también del relé NIP-42: 1064 no es 1059),
//      verifica, descifra y guarda el archivo IDÉNTICO como un adjunto normal; A recibe ✓✓, pide BORRAR los trozos (kind 5,
//      NIP-09) y limpia su registro.
//  (3) El mismo puntero llega otra vez (dos vías / reenvío) → dedup: una sola copia y ni una bajada más.
//  (4) Con B EN LÍNEA (Wi-Fi los dos) un archivo NO pasa por el buzón de archivos: camino directo de siempre, ni un trozo nuevo.
// Uso: node blobe2e.js <dir_build>
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone, installWebCrypto } = require('./native_mock');
const { NostrRelay } = require('./nostr_relay');

const buildDir = path.resolve(process.argv[2]);
const base = { readsContentFallback: true, retain: ['onPayloadReceived', 'onLanMessage', 'onLanUp', 'onLanDown'], closeOnNoService: true, pace: [15, 15], ioDelay: 25, asymmetric: true, noL2: true }; // noL2: sin canal L2CAP (como la tablet del dueño): un archivo > 5 MB va por el flujo normal, no por big_file.js
let RELAYS = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
class DistLoader extends ResourceLoader {
  constructor(dir) { super(); this.dir = dir; }
  fetch(url) { const f = path.join(this.dir, decodeURIComponent(new URL(url).pathname)); return fs.existsSync(f) ? Promise.resolve(fs.readFileSync(f)) : Promise.reject(new Error('no existe ' + f)); }
}
const logs = [];
// onReady(win): se llama en cuanto existe bleInterface (antes de que la app termine de arrancar) para enganchar espías
async function boot(name, native, onReady) {
  native.listeners = new Map();
  const vc = new VirtualConsole();
  ['log', 'warn', 'error'].forEach((l) => vc.on(l, (...a) => logs.push(`${new Date().toISOString().substring(14, 23)} [${name}] ${l}: ` + a.map(String).join(' ').substring(0, 300))));
  const dom = new JSDOM(fs.readFileSync(path.join(buildDir, 'dist', 'index.html'), 'utf8'), {
    url: 'https://' + name.toLowerCase() + '.nexo.test/index.html', runScripts: 'dangerously',
    resources: new DistLoader(path.join(buildDir, 'dist')), pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) { win.NEXO_NET_RELAYS = RELAYS; win.CapacitorCustomPlatform = { name: 'android' }; installWebCrypto(win); win.Capacitor = { Plugins: { NexoBLE: native.plugin() } }; win.HTMLElement.prototype.scrollTo = function () {}; },
  });
  const win = dom.window;
  let hooked = false;
  for (let i = 0; i < 1000 && !(win.NEXO && win.NEXO.initialized); i++) {
    if (!hooked && onReady && win.bleInterface) { hooked = true; onReady(win); }
    await sleep(10);
  }
  if (!hooked && onReady && win.bleInterface) onReady(win);
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
const vaultMsgs = (p, from) => p.win.vaultLoadMessages(from);
// el mensaje del vault cuyo adjunto es exactamente este archivo (el historial puede guardarlo aparte: attachmentRef)
async function findMsg(p, from, b64, own) {
  const list = await vaultMsgs(p, from);
  return list.find((m) => !!m._own === !!own && m.attachmentType && !m.deleted && (m.attachmentPayload || p.native.files.get(m.attachmentRef)) === b64) || null;
}
const statusOf = (p, msgId) => { const s = p.win.document.querySelector('.msg-status[data-msg-id="' + msgId + '"]'); const m = s && (s.className || '').match(/status-([a-z]+)/); return m ? m[1] : null; };

(async () => {
  const r = { prueba: 'blobe2e', build: path.basename(buildDir) };
  const r1 = new NostrRelay(), r2 = new NostrRelay({ authRequired: true }), r3 = new NostrRelay();
  RELAYS = [await r1.start(), await r2.start(), await r3.start()];
  const relays = [r1, r2, r3];
  const count1064 = () => relays.reduce((n, x) => n + x.events.filter((e) => e.kind === 1064).length, 0);
  const radio = new Radio();
  // A en casa y B en la oficina: los dos con Wi-Fi, módems distintos; sin Tor
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', Object.assign({}, base, { wifi: 'casa', noTor: true })), nB = new NativePhone('B', 'BB:BB:BB:BB:BB:02', Object.assign({}, base, { wifi: 'oficina', noTor: true }));
  [nA, nB].forEach((n) => { radio.add(n); n.load(); });
  let A = await boot('A', nA), B = await boot('B', nB);
  const idA = A.win.bleInterface.localNexoId.toLowerCase(), idB = B.win.bleInterface.localNexoId.toLowerCase();
  // Se conocen en persona (Bluetooth): claves y "nt"
  A.win.bleInterface.togglePanel(); const paired = await addFound(A, 'B'); A.win.bleInterface.togglePanel();
  if (!paired) { console.log('BLOBE2E ' + JSON.stringify({ prueba: 'blobe2e', resultado: 'FALLO', error: 'no empareja' })); process.exit(1); }
  await openChatWith(A, 'B'); sendText(A, 'hola B'); await sleep(3000);
  await openChatWith(B, 'A'); sendText(B, 'hola A'); await sleep(3000);
  // Cada uno a su casa: sin Bluetooth, en línea por internet
  radio.block(nA, nB);
  const netA = () => A.win.bleInterface.net, ackA = () => A.win.bleInterface.ackSystem;
  const viaA = () => A.win.bleInterface.linkOf(idB), viaB = () => B.win.bleInterface.linkOf(idA);
  netA().tick(); B.win.bleInterface.net.tick();
  r.en_linea_por_internet_s = await waitFor(() => viaA() === 'internet' && viaB() === 'internet', 60000);

  // ===== B apaga el teléfono =====
  B.win.close(); nB.destroyActivity();
  // En la app A tarda UP_MS (150 s sin saludo) en darlo por desconectado; aquí se adelanta ese reloj
  const pB = netA().peers.get(idB); if (pB) pB.lastRx = 0; await netA().tick();
  r.A_ve_que_B_no_esta = await waitFor(() => viaA() !== 'internet' && !netA().canReach(idB), 15000) !== null;
  r.A_tiene_buzon_para_B = netA().mailboxOk(idB);
  const ev0 = relays.map((x) => x.events.length);

  // ===== (1) archivo de 300 KB a B apagado =====
  const archivo = await sendFile(A, 'foto_buzon.jpg', 300000);
  const b64 = archivo.toString('base64');
  let msgA = null;
  r.registrado_en_A_s = await waitFor(async () => !!(msgA = await findMsg(A, idB, b64, true)), 10000);
  const msgId = msgA && msgA.messageId;
  r.A_tick_al_guardarse_el_puntero_s = await waitFor(() => statusOf(A, msgId) === 'sent', 30000);
  r.A_sin_doble_tick_todavia = statusOf(A, msgId) === 'sent';
  r.trozos_por_rele = relays.map((x) => x.events.filter((e) => e.kind === 1064).length).join(',');
  const blobs = r1.events.filter((e) => e.kind === 1064);
  r.sin_etiqueta_destinatario = blobs.length === 8 && blobs.every((e) => !e.tags.some((t) => t[0] === 'p'));
  const now = Math.floor(Date.now() / 1000);
  r.caducidad_7_dias = blobs.every((e) => { const t = e.tags.find((t) => t[0] === 'expiration'); return t && Number(t[1]) > now + 6.9 * 86400 && Number(t[1]) <= now + 7 * 86400 + 5; });
  r.A_no_abrio_flujo_por_trozos = ackA().outgoingStreams.size === 0 && !logs.some((l) => /\[A\].*sendFile START/.test(l));
  const outRec = ackA()._blobOut && ackA()._blobOut.get(msgId);
  r.A_recuerda_el_blob = !!(outRec && outRec.rec && outRec.rec.ids.length === 8) && /"sk"/.test(A.win.localStorage.getItem('nexo_blob_out') || '');
  const all = relays.map((x) => x.events.map((e) => JSON.stringify(e)).join('\n')).join('\n').toLowerCase();
  r.reles_ven_algo = ['foto_buzon', idA, idB, '"type"', b64.substring(0, 24).toLowerCase()].filter((x) => all.indexOf(x) >= 0);
  r.eventos_nuevos_no_trozo_en_r1 = r1.events.slice(ev0[0]).filter((e) => e.kind !== 1064).length; // puntero (+ saludos de A)
  r.A_subio_al_buzon_log = logs.some((l) => /\[A\].*\[BLOB\].*buzón de archivos/.test(l));

  // ===== (2) B vuelve: lee el puntero, baja, verifica, descifra; A recibe ✓✓ y limpia =====
  const cap = [];
  nB.load();
  B = await boot('B', nB, (win) => {
    const bi = win.bleInterface, orig = bi._blobPointerReceived;
    if (typeof orig !== 'function') return;
    bi._blobPointerReceived = function() { cap.push(Array.from(arguments)); return orig.apply(this, arguments); };
  });
  let msgB = null;
  r.B_recibe_el_archivo_s = await waitFor(async () => !!(msgB = await findMsg(B, idA, b64, false)), 60000);
  r.archivo_identico_mismo_id = !!msgB && msgB.messageId === msgId && msgB.attachmentType === 'file';
  r.meta_sin_puntero = !!msgB && !(msgB.attachmentMeta && msgB.attachmentMeta.ptr);
  r.B_bajo_y_verifico_log = logs.some((l) => /\[B\].*\[BLOB\].*bajado y verificado/.test(l));
  r.A_doble_tick_s = await waitFor(() => ['delivered', 'read'].includes(statusOf(A, msgId)), 30000);
  r.A_pidio_borrar_trozos_kind5 = await waitFor(() => relays.some((x) => x.events.some((e) => e.kind === 5 && blobs.length && e.pubkey === blobs[0].pubkey && e.tags.filter((t) => t[0] === 'e').length === 8)), 10000) !== null;
  r.A_limpio_su_registro = !(ackA()._blobOut && ackA()._blobOut.has(msgId)) && !/"sk"/.test(A.win.localStorage.getItem('nexo_blob_out') || '');
  // El relé que pide identificarse (NIP-42) SÍ sirve los trozos por id: kind 1064 no es el 1059 de los mensajes privados
  const ids = blobs.map((e) => e.id);
  let evs42 = [];
  try { evs42 = await B.win.bleInterface.net.fetchEvents(RELAYS[1], ids, 8000); } catch (e) { evs42 = []; }
  r.rele_nip42_sirve_trozos = evs42.length === 8;

  // ===== (3) el mismo puntero llega otra vez (dos vías / reenvío) → dedup =====
  const reqIds0 = relays.map((x) => x.stats.reqIds || 0).join(',');
  const before = (await vaultMsgs(B, idA)).filter((m) => m.messageId === msgId).length;
  r.puntero_capturado = cap.length >= 1; // informativo: si el puntero se procesó antes del espía, se usa el camino de dedup igual
  const devA = B.win.bleInterface._resolveDeviceIdForNexoId(idA);
  const args = cap[0] || [devA, idA, msgId, { type: 'attachment', attachmentType: 'file', payload: 'ptr', meta: { ptr: 1 }, ptr: {} }, { deviceId: devA, timestamp: Date.now() }, null];
  B.win.bleInterface._blobPointerReceived.apply(B.win.bleInterface, args);
  await sleep(3000);
  const after = (await vaultMsgs(B, idA)).filter((m) => m.messageId === msgId).length;
  r.dedup_una_copia = before === 1 && after === 1 && !(B.win.bleInterface._blobIn && B.win.bleInterface._blobIn.size);
  r.dedup_sin_bajar_de_nuevo = relays.map((x) => x.stats.reqIds || 0).join(',') === reqIds0;

  // ===== (4) con B EN LÍNEA el archivo NO pasa por el buzón de archivos (camino directo de siempre) =====
  r.de_vuelta_en_linea_s = await waitFor(() => viaA() === 'internet' && netA().canReach(idB), 60000);
  const blob1 = count1064();
  const foto2 = await sendFile(A, 'foto_en_linea.jpg', 120000);
  const b64b = foto2.toString('base64');
  r.en_linea_llega_s = await waitFor(async () => !!(await findMsg(B, idA, b64b, false)), 90000);
  const m2 = await findMsg(A, idB, b64b, true);
  r.en_linea_no_usa_buzon_de_archivos = count1064() === blob1 && !!m2 && !(ackA()._blobOut && ackA()._blobOut.has(m2.messageId)) && logs.filter((l) => /\[A\].*\[BLOB\].*buzón de archivos/.test(l)).length === 1;

  // ===== (5) 2970 (diagnóstico del dueño S24 09-11, APK de 25 MB a la tablet): archivo > 5 MB a un contacto conectado por
  //     BLUETOOTH pero AUSENTE por internet → queda ⏳ UNA vez. Antes se re-reanudaba cada ~1,5 s («hasBetter» tomaba
  //     mailboxOk —tengo internet— por «camino mejor» aunque el contacto no estuviera en línea): leía 35 MB del disco y
  //     armaba el base64 en cada vuelta = la ralentización del diagnóstico =====
  radio.unblock(nA, nB);
  // volver a enlazar por Bluetooth: abrir el chat fuerza la conexión al dispositivo conocido; si no, buscarlo y agregarlo otra vez
  try { A.win.bleInterface.openChat(idB); } catch (e) {}
  r.bt_de_nuevo_s = await waitFor(() => !!A.win.bleInterface._bleReadyFor(idB), 45000);
  if (r.bt_de_nuevo_s === null) { A.win.bleInterface.togglePanel(); await addFound(A, 'B'); A.win.bleInterface.togglePanel(); r.bt_de_nuevo_s = await waitFor(() => !!A.win.bleInterface._bleReadyFor(idB), 45000); }
  // B se queda sin internet (relés cerrados, sin reintentar) y A lo da por ausente por internet
  B.win.bleInterface.net._closeAll(); B.win.bleInterface.net.relays.forEach((rl) => { rl.retryAt = Date.now() + 9e6; });
  const pB3 = netA().peers.get(idB); if (pB3) pB3.lastRx = 0; await netA().tick();
  r.B_sin_internet_con_bt = await waitFor(() => !netA().canReach(idB) && !!A.win.bleInterface._bleReadyFor(idB), 15000) !== null;
  const blobEvents5 = count1064();
  const grande = await sendFile(A, 'grande.bin', 6 * 1024 * 1024);
  let msgG = null;
  r.grande_registrado_s = await waitFor(async () => !!(msgG = await findMsg(A, idB, grande.toString('base64'), true)), 20000);
  const idG = msgG && msgG.messageId;
  await sleep(9000);
  const starts = logs.filter((l) => new RegExp('\\[A\\].*sendFile START fileId=' + idG + '\\b').test(l)).length;
  const resumes = logs.filter((l) => new RegExp('\\[A\\].*Resume: .* para ' + idB).test(l)).length;
  r.grande_bt_intentos_en_9s = starts + '/' + resumes;
  r.grande_bt_sin_bucle = starts <= 2 && resumes <= 3;
  r.grande_bt_queda_pendiente = statusOf(A, idG) === 'pending' && count1064() === blobEvents5; // > 5 MB: no va al buzón de archivos (Fase D)
  // ===== (6) 2970: una REANUDACIÓN con contenido YA SELLADO (registro saliente, como los segmentos de Fénix del diagnóstico) a
  //     un contacto ausente por internet NO pasa por el buzón de archivos (antes: «atob … not correctly encoded») ni abre un
  //     flujo por relés hacia un ausente =====
  await A.win.vaultCreateOutgoingTransfer(idB, 'msgsellado1', 'file', 1, ['E2:QUJDREVGRw=='], { type: 'file', to: idB }, 'net:' + idB);
  const blobLogs0 = logs.filter((l) => /\[A\].*\[BLOB\]/.test(l)).length;
  ackA().resumeOutgoingTransfers(); await sleep(4000);
  r.sellado_no_pasa_por_buzon = logs.filter((l) => /\[A\].*\[BLOB\]/.test(l)).length === blobLogs0 && !logs.some((l) => /atob/.test(l));
  r.sellado_sin_flujo_por_reles_a_ausente = !logs.some((l) => /\[A\].*sendFile START fileId=msgsellado1 .*to=net/.test(l));

  r.errores = logs.filter((l) => !/msgsellado1/.test(l) && /ilegible|Error procesando|No se pudo descifrar|\[BLOB\].*( descartado:|rechazado \(|no se pudo bajar|caducó|no pudo subirse)/.test(l)).slice(0, 3); // msgsellado1: contenido falso de la prueba (6)
  r.contenido_en_registros = logs.filter((l) => l.indexOf(b64.substring(0, 24)) >= 0).length;

  const numeric = ['en_linea_por_internet_s', 'registrado_en_A_s', 'A_tick_al_guardarse_el_puntero_s', 'B_recibe_el_archivo_s', 'A_doble_tick_s', 'de_vuelta_en_linea_s', 'en_linea_llega_s', 'bt_de_nuevo_s', 'grande_registrado_s'];
  const info = { prueba: 1, build: 1, resultado: 1, eventos_nuevos_no_trozo_en_r1: 1, puntero_capturado: 1, grande_bt_intentos_en_9s: 1 };
  const ok = numeric.every((k) => typeof r[k] === 'number') && r.trozos_por_rele === '8,8,8' && r.reles_ven_algo.length === 0 && r.errores.length === 0 && r.contenido_en_registros === 0 &&
    Object.keys(r).every((k) => info[k] || typeof r[k] !== 'boolean' || r[k] === true);
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('BLOBE2E ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_blobe2e.txt'), logs.join('\n'));
  await Promise.all(relays.map((x) => x.stop()));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('BLOBE2E {"prueba":"blobe2e","resultado":"FALLO","error":"' + String(e && e.message).replace(/"/g, "'") + '"}'); console.error(e && e.stack); fs.writeFileSync(path.join(__dirname, 'last_logs_blobe2e.txt'), logs.join('\n')); process.exit(1); });
