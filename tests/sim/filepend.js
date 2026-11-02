// #dueño 02-11 (diagnóstico llamada en el coche): un ARCHIVO que no cabe por el Bluetooth de ahora (MTU 23
// congestionado, «Cola de escritura llena» → «Max window retries») se marcaba ✗ 'failed' y el dueño lo daba por
// perdido. En realidad el registro de la transferencia SIGUE en el vault (no se borra al abortar, solo al entregar),
// así que resumeOutgoingTransfers lo reenvía cuando vuelve Wi-Fi/internet. Arreglo (2885): al agotar reintentos un
// ARCHIVO queda ⏳ 'pending' (no ✗), reflejando que sigue pendiente y se reenviará; el TEXTO sigue 'failed'.
//
// Esta prueba, como fileflap.js, coge un ChatStream REAL de archivo, lo congela y dispara _onWindowTimeout a mano con
// el enlace ARRIBA hasta pasar el tope de reintentos. Comprueba: (1) aborta el stream (como antes), (2) el estado que
// se despacha es 'pending' (no 'failed'), (3) el registro de salientes SIGUE en el vault (reanudable).
// Uso: node filepend.js <dir_build>
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
  const r = { build: path.basename(buildDir) };

  // A agrega a B y se conectan
  biA.togglePanel(); let add = null;
  for (let i = 0; i < 400 && !add; i++) { await sleep(100); add = A.win.document.querySelector('#ble-new-device > div button'); if (!add && !biA.isScanning) click(A.win, A.win.document.getElementById('ble-scan-btn')); }
  click(A.win, add); await sleep(1500);
  if (A.win.document.getElementById('ble-panel').classList.contains('active')) biA.togglePanel();
  await openChatWith(A, 'B');

  // Espía de estados despachados por msgId (para ver con qué estado queda el archivo al agotar reintentos)
  const seen = {};
  const origDisp = biA.ackSystem._dispatchStatus.bind(biA.ackSystem);
  biA.ackSystem._dispatchStatus = function (mid, stt) { seen[mid] = stt; return origDisp(mid, stt); };

  // Enviar un archivo y coger el ChatStream real; congelarlo (como fileflap) para controlar _onWindowTimeout a mano
  sendFile(A, 'foto.jpg', 'image/jpeg', rnd(1024 * 1024, 5));
  let st = null;
  for (let i = 0; i < 200 && !st; i++) {
    await sleep(20);
    (biA.ackSystem.outgoingStreams || new Map()).forEach((s) => { if (!st && s && s.type === 'file') st = s; });
    if (st) {
      nB.setOffline(true);
      try { clearTimeout(st.timer); } catch (e) {}
      try { clearTimeout(st.globalTimeout); } catch (e) {}
      st._sendChunk = function () { return Promise.resolve(); };
    }
  }
  r.hay_stream = !!st;
  if (!st) { console.log('FILEPEND ' + JSON.stringify(Object.assign(r, { resultado: 'FALLO', why: 'no stream' }))); process.exit(1); }
  await sleep(100);
  try { clearTimeout(st.timer); } catch (e) {}
  try { clearTimeout(st.globalTimeout); } catch (e) {}
  st._retransmitWindow = function () {};
  st._startWindowTimer = function () {};
  st._windowReject = function () {};
  const forceWindow = () => { st.aborted = false; st.windowRetryCount = 0; st._windowStartAtSend = 0; st._windowEndAtSend = Math.max(1, Math.min(st.windowSize || 1, st.total || 1)); st.ackedMask = []; };

  // El registro de la transferencia se creó al arrancar el ChatStream (status 'sending')
  const pend0 = await A.win.vaultGetPendingOutgoingTransfers(idB);
  r.registro_creado = Array.isArray(pend0) && pend0.some((t) => t.transferId === st.msgId);

  // Enlace ARRIBA → al pasar el tope de reintentos, aborta (igual que antes). El cambio es CON QUÉ ESTADO queda.
  forceWindow();
  st._linkUp = function () { return true; };
  for (let k = 0; k <= st.maxWindowRetries + 1 && !st.aborted; k++) st._onWindowTimeout();
  r.aborta = st.aborted === true;
  r.estado_archivo = seen[st.msgId] || '(ninguno)';
  r.es_pending_no_failed = r.estado_archivo === 'pending';

  // Y el registro SIGUE en el vault (no se borró al abortar) → resumeOutgoingTransfers lo reenviará al volver una ruta
  const pend1 = await A.win.vaultGetPendingOutgoingTransfers(idB);
  r.registro_sigue = Array.isArray(pend1) && pend1.some((t) => t.transferId === st.msgId);

  r.errores = logs.filter((l) => / error: /.test(l) && !/JSDOMERROR|styles\.css|Not implemented|GLOBAL TIMEOUT/.test(l)).slice(0, 5);
  const ok = r.hay_stream && r.registro_creado && r.aborta && r.es_pending_no_failed && r.registro_sigue && !r.errores.length;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('FILEPEND ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_filepend.txt'), logs.join('\n'));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error(e); fs.writeFileSync(path.join(__dirname, 'last_logs_filepend.txt'), logs.join('\n')); process.exit(1); });
