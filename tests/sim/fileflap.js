// Ronda 2821b (#2/#dueño, diagnóstico del S24 28-10): una transferencia de archivo (ChatStream) se ABORTABA tras 8
// «window timeout» aunque el enlace solo estuviera parpadeando (caído un rato y vuelto): `Max window retries alcanzado`
// → `sendFile FAIL … Abortado`. Cuando el enlace está CAÍDO, que la ventana caduque no es que el receptor rechace: es
// que no hay por dónde. Arreglo: `_onWindowTimeout` no gasta un reintento del tope si `_linkUp()` es false (espera a que
// el enlace vuelva); el límite real sigue siendo el timeout global (60 s sin ningún ACK). Esta prueba es determinista:
// coge un ChatStream real y comprueba que con el enlace caído muchas caducidades NO abortan, y con el enlace arriba sí
// aborta al pasar el tope. Uso: node fileflap.js <dir_build>
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
async function sendFile(p, name, type, bytes) {
  click(p.win, p.win.document.querySelector('.attach-menu-item[data-type="file"]')); await sleep(100);
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

  // B en línea: la transferencia arranca (se crea el ChatStream); se coge rápido y se CONGELA (timers parados,
  // envío de trozos neutralizado) para controlar _onWindowTimeout a mano, sin depender de los tiempos reales.
  sendFile(A, 'foto.jpg', 'image/jpeg', rnd(1024 * 1024, 5));
  let st = null;
  for (let i = 0; i < 200 && !st; i++) {
    await sleep(20);
    (biA.ackSystem.outgoingStreams || new Map()).forEach((s) => { if (!st && s && s.type === 'file') st = s; });
    if (st) { // congelar en cuanto aparece
      nB.setOffline(true);
      try { clearTimeout(st.timer); } catch (e) {}
      try { clearTimeout(st.globalTimeout); } catch (e) {}
      st._sendChunk = function () { return Promise.resolve(); };
    }
  }
  r.hay_stream = !!st;
  if (!st) { console.log('FILEFLAP ' + JSON.stringify(Object.assign(r, { resultado: 'FALLO', why: 'no stream' }))); process.exit(1); }
  await sleep(100);
  try { clearTimeout(st.timer); } catch (e) {}
  try { clearTimeout(st.globalTimeout); } catch (e) {}
  let rt = 0, wt = 0;
  st._retransmitWindow = function () { rt++; };
  st._startWindowTimer = function () { wt++; };
  st._windowReject = function () {};
  const forceWindow = () => { st.aborted = false; st.windowRetryCount = 0; st._windowStartAtSend = 0; st._windowEndAtSend = Math.max(1, Math.min(st.windowSize || 1, st.total || 1)); st.ackedMask = []; };

  // _linkUp real: un enlace lan: hacia un contacto NO alcanzable se ve CAÍDO (para Bluetooth crudo _linkUp no se mete)
  const devSave = st.deviceId;
  st.deviceId = 'lan:nxffffffff';
  r.linkup_falso_si_desconectado = st._linkUp() === false;
  st.deviceId = devSave;

  // (a) enlace CAÍDO → muchas caducidades NO abortan ni gastan reintentos
  forceWindow();
  st._linkUp = function () { return false; };
  for (let k = 0; k < 12; k++) st._onWindowTimeout();
  r.caido_no_aborta = !st.aborted && st.windowRetryCount === 0;
  r.caido_espera = wt > 0; // reprograma el timer en vez de abortar

  // (b) enlace ARRIBA → al pasar el tope de reintentos, aborta (comportamiento de siempre)
  forceWindow();
  st._linkUp = function () { return true; };
  for (let k = 0; k <= st.maxWindowRetries + 1 && !st.aborted; k++) st._onWindowTimeout();
  r.arriba_aborta = st.aborted === true;
  r.arriba_reintento = rt > 0; // reenvió la ventana mientras estaba arriba

  r.errores = logs.filter((l) => / error: /.test(l) && !/JSDOMERROR|styles\.css|Not implemented|GLOBAL TIMEOUT/.test(l)).slice(0, 5);
  const ok = r.hay_stream && r.linkup_falso_si_desconectado && r.caido_no_aborta && r.caido_espera && r.arriba_aborta && r.arriba_reintento && !r.errores.length;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('FILEFLAP ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_fileflap.txt'), logs.join('\n'));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error(e); fs.writeFileSync(path.join(__dirname, 'last_logs_fileflap.txt'), logs.join('\n')); process.exit(1); });
