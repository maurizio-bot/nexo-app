// #dueño 02-11 (B2, diagnóstico del coche): no MARTILLAR un Bluetooth de MTU MÍNIMO (23) con un archivo GRANDE. Con MTU
// 23 cada escritura lleva ~20 bytes útiles: un archivo de cientos de KB son decenas de miles de escrituras que
// congestionan la cola nativa («Cola de escritura llena» → «Max window retries»), gastan batería/radio y suelen morir
// al moverse. Arreglo (2886): al arrancar un ARCHIVO grande cuyo único camino es un Bluetooth de MTU mínimo, NO se
// martillea — queda ⏳ PENDIENTE (el registro sigue en el vault) y resumeOutgoingTransfers lo reenvía por Wi-Fi/internet
// al aparecer un camino mejor. Anti-inanición: si tras MTU_DEFER_MAX_WAIT_MS no apareció nada mejor, se intenta IGUAL
// por Bluetooth (un contacto solo-Bluetooth nunca pierde el archivo). Las fotos/vistas previas chicas SÍ se mandan.
//
// Esta prueba coge un ChatStream REAL de archivo (como filepend) y lo usa de vehículo para comprobar la DECISIÓN
// _shouldDeferTinyMtu en todos los casos (grande/chico, MTU mínimo/sano, enlace net:, anti-inanición), y además arranca
// un archivo grande de verdad por un enlace de MTU mínimo para confirmar que (1) queda 'pending' (no ✗), (2) NO deja un
// flujo martillando, (3) el registro saliente SIGUE en el vault (reanudable).
// Uso: node filetinymtu.js <dir_build>
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone } = require('./native_mock');

const buildDir = path.resolve(process.argv[2]);
const opts = { readsContentFallback: true, retain: ['onPayloadReceived', 'onLanMessage', 'onLanUp', 'onLanDown'], closeOnNoService: true, pace: [15, 15], ioDelay: 25, asymmetric: true, noL2: true };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
class DL extends ResourceLoader { constructor(d) { super(); this.d = d; } fetch(u) { const f = path.join(this.d, decodeURIComponent(new URL(u).pathname)); return fs.existsSync(f) ? Promise.resolve(fs.readFileSync(f)) : Promise.reject(new Error('x')); } }
const logs = [];
async function boot(name, native) {
  const vc = new VirtualConsole();
  ['log', 'warn', 'error'].forEach((l) => vc.on(l, (...a) => logs.push(`${new Date().toISOString().substring(14, 23)} [${name}] ${l}: ` + a.map(String).join(' ').substring(0, 250))));
  const dom = new JSDOM(fs.readFileSync(path.join(buildDir, 'dist', 'index.html'), 'utf8'), {
    url: 'https://' + name.toLowerCase() + '.nexo.test/index.html', runScripts: 'dangerously', resources: new DL(path.join(buildDir, 'dist')), pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) { win.CapacitorCustomPlatform = { name: 'android' }; require('./native_mock').installWebCrypto(win); win.Capacitor = { Plugins: { NexoBLE: native.plugin() } }; win.HTMLElement.prototype.scrollTo = function () {}; },
  });
  const win = dom.window;
  for (let i = 0; i < 100 && !(win.NEXO && win.NEXO.initialized); i++) await sleep(100);
  await sleep(800);
  return { name, native, win };
}
const click = (w, el) => el && el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
const rnd = (n, s) => { const b = Buffer.alloc(n); for (let i = 0; i < n; i++) b[i] = (i * 7919 + s) & 255; return b; };
async function openChatWith(p, name) {
  let row; for (let i = 0; i < 300 && !row; i++) { row = Array.from(p.win.document.querySelectorAll('#main-contacts-list .ble-contact-row')).find((r) => (r.querySelector('.ble-contact-name') || {}).textContent === name); if (!row) await sleep(100); }
  click(p.win, row); await sleep(400); return !!row;
}
function sendFile(p, name, type, bytes) {
  click(p.win, p.win.document.querySelector('.attach-menu-item[data-type="file"]'));
  const fin = Array.from(p.win.document.querySelectorAll('input[type=file]')).pop();
  Object.defineProperty(fin, 'files', { value: [new p.win.File([bytes], name, { type })] }); fin.dispatchEvent(new p.win.Event('change'));
}

(async () => {
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', Object.assign({}, opts, { wifi: 'casa' })), nB = new NativePhone('B', 'BB:BB:BB:BB:BB:02', Object.assign({}, opts, { wifi: 'casa' }));
  [nA, nB].forEach((n) => { radio.add(n); n.load(); });
  const [A, B] = await Promise.all([boot('A', nA), boot('B', nB)]);
  const biA = A.win.bleInterface, idB = B.win.bleInterface.localNexoId.toLowerCase();
  const AS = biA.ackSystem;
  const r = { build: path.basename(buildDir) };

  // A agrega a B y se conectan
  biA.togglePanel(); let add = null;
  for (let i = 0; i < 400 && !add; i++) { await sleep(100); add = A.win.document.querySelector('#ble-new-device > div button'); if (!add && !biA.isScanning) click(A.win, A.win.document.getElementById('ble-scan-btn')); }
  click(A.win, add); await sleep(1500);
  if (A.win.document.getElementById('ble-panel').classList.contains('active')) biA.togglePanel();
  await openChatWith(A, 'B');

  // Espía de estados despachados por msgId
  const seen = {};
  const origDisp = AS._dispatchStatus.bind(AS);
  AS._dispatchStatus = function (mid, stt) { seen[mid] = stt; return origDisp(mid, stt); };

  // --- Coger un ChatStream REAL de archivo y congelarlo (vehículo para la decisión) ---
  sendFile(A, 'foto.jpg', 'image/jpeg', rnd(64 * 1024, 5));
  let st = null;
  for (let i = 0; i < 200 && !st; i++) {
    await sleep(20);
    (AS.outgoingStreams || new Map()).forEach((s) => { if (!st && s && s.type === 'file') st = s; });
    if (st) { try { clearTimeout(st.timer); } catch (e) {} try { clearTimeout(st.globalTimeout); } catch (e) {} st._sendChunk = function () { return Promise.resolve(); }; st._retransmitWindow = function () {}; st._startWindowTimer = function () {}; st.abort(); }
  }
  r.hay_stream = !!st;
  if (!st) { console.log('FILETINYMTU ' + JSON.stringify(Object.assign(r, { resultado: 'FALLO', why: 'no stream' }))); process.exit(1); }

  const BIG = 'A'.repeat(500000);   // > 300000 (tope): archivo grande
  const SMALL = 'A'.repeat(60000);  // < 300000: foto/preview chica
  const mac = st.deviceId;          // enlace Bluetooth real (MAC) hacia B

  // Caso 1: archivo GRANDE + MTU mínimo (23) → aplazar (true)
  biA.getMtu = function () { return 23; };
  AS._mtuDeferSince.clear(); st.deviceId = mac; st.type = 'file'; st.content = BIG; delete st.meta.fwd;
  r.c1_grande_mtu23_aplaza = st._shouldDeferTinyMtu() === true;

  // Caso 2: archivo CHICO (foto) + MTU 23 → NO aplazar (cabe por MTU 23)
  AS._mtuDeferSince.clear(); st.content = SMALL;
  r.c2_chico_mtu23_no_aplaza = st._shouldDeferTinyMtu() === false;

  // Caso 3: archivo GRANDE + MTU SANO (512) → NO aplazar (enlace normal)
  AS._mtuDeferSince.clear(); st.content = BIG; biA.getMtu = function () { return 512; };
  r.c3_grande_mtusano_no_aplaza = st._shouldDeferTinyMtu() === false;

  // Caso 4: archivo GRANDE + enlace por internet (net:) → NO aplazar (sin cola MTU-23)
  AS._mtuDeferSince.clear(); biA.getMtu = function () { return 23; }; st.deviceId = 'net:' + idB;
  r.c4_net_no_aplaza = st._shouldDeferTinyMtu() === false;
  st.deviceId = mac;

  // Caso 5: anti-inanición — grande + MTU 23 pero ya esperó > tope → NO aplazar (se intenta por Bluetooth igual)
  AS._mtuDeferSince.clear(); st.content = BIG; biA.getMtu = function () { return 23; };
  A.win.NEXO_MTU_DEFER_MS = 1; // tope de espera 1 ms
  AS._mtuDeferSince.set(st.msgId, Date.now() - 1000);
  r.c5_antiinanicion_intenta = st._shouldDeferTinyMtu() === false;
  delete A.win.NEXO_MTU_DEFER_MS; AS._mtuDeferSince.clear();

  // --- Extremo a extremo: arrancar un archivo GRANDE por MTU mínimo → 'pending', sin martilleo, registro persiste ---
  biA.getMtu = function () { return 23; };
  const fileId = 'bigfile_' + Date.now();
  const outcome = await new Promise((resolve) => {
    let done = false; const fin = (v) => { if (!done) { done = true; resolve(v); } };
    AS._startFileStream(mac, fileId, BIG, { type: 'file', name: 'video.mp4', dst: idB }, () => fin('ok'), (err) => fin('rej:' + (err && err.message)));
    setTimeout(() => fin('timeout'), 4000);
  });
  await sleep(150);
  r.e2e_outcome = outcome;
  r.e2e_rechaza_defer = /no cabe por Bluetooth de MTU mínimo/.test(outcome);
  r.e2e_estado_pending = seen[fileId] === 'pending';
  r.e2e_sin_flujo_martillando = !(AS.outgoingStreams && AS.outgoingStreams.has(fileId)); // no quedó un flujo activo
  const pend = await A.win.vaultGetPendingOutgoingTransfers(idB);
  r.e2e_registro_persiste = Array.isArray(pend) && pend.some((t) => t.transferId === fileId); // reanudable

  r.errores = logs.filter((l) => / error: /.test(l) && !/JSDOMERROR|styles\.css|Not implemented|GLOBAL TIMEOUT/.test(l)).slice(0, 5);
  const ok = r.hay_stream && r.c1_grande_mtu23_aplaza && r.c2_chico_mtu23_no_aplaza && r.c3_grande_mtusano_no_aplaza &&
             r.c4_net_no_aplaza && r.c5_antiinanicion_intenta && r.e2e_rechaza_defer && r.e2e_estado_pending &&
             r.e2e_sin_flujo_martillando && r.e2e_registro_persiste && !r.errores.length;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('FILETINYMTU ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_filetinymtu.txt'), logs.join('\n'));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error(e); fs.writeFileSync(path.join(__dirname, 'last_logs_filetinymtu.txt'), logs.join('\n')); process.exit(1); });
