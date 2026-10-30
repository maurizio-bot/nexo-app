// #124 (build 2840, informe del dueño 30-10 con diagnóstico): un archivo a un contacto OFFLINE por internet no se
// enviaba — la transferencia storm-retransmitía (`Window timeout … retry 3…8`) y acababa en «fallido», con la burbuja
// clavada en ⏳. Causa: `_linkUp()` por internet preguntaba `net.online()` = «¿tengo YO internet?» (verdadero aunque el
// contacto esté apagado) en vez de `net.canReach(nx)` = «¿está el CONTACTO en línea?» (como ya hace con Wi-Fi). Arreglo:
// por internet, `_linkUp()` usa `net.canReach(nx)`; contacto ausente → enlace «caído» → la ventana ESPERA (no storm, no
// gasta reintentos) y el tope global marca 'pending' (⏳ «esperando»), no 'failed' (store-and-forward: se entrega al
// conectarse el contacto). Esta prueba coge un ChatStream real (como fileflap.js) y lo comprueba de forma determinista.
// Uso: node fileabsent.js <dir_build>
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone } = require('./native_mock');

const buildDir = path.resolve(process.argv[2] || path.join(__dirname, 'builds/wip'));
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
  Object.defineProperty(fin, 'files', { value: [new p.win.File([bytes], name, { type })], configurable: true }); fin.dispatchEvent(new p.win.Event('change'));
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

  // Enviar un archivo y coger el ChatStream real; congelarlo para controlar _onWindowTimeout a mano
  sendFile(A, 'foto.jpg', 'image/jpeg', rnd(512 * 1024, 5));
  let st = null;
  for (let i = 0; i < 200 && !st; i++) {
    await sleep(20);
    (biA.ackSystem.outgoingStreams || new Map()).forEach((s) => { if (!st && s && s.type === 'file') st = s; });
    if (st) { nB.setOffline(true); try { clearTimeout(st.timer); } catch (e) {} try { clearTimeout(st.globalTimeout); } catch (e) {} st._sendChunk = function () { return Promise.resolve(); }; }
  }
  r.hay_stream = !!st;
  if (!st) { console.log('FILEABSENT ' + JSON.stringify(Object.assign(r, { resultado: 'FALLO', why: 'no stream' }))); process.exit(1); }
  await sleep(100);
  try { clearTimeout(st.timer); } catch (e) {} try { clearTimeout(st.globalTimeout); } catch (e) {}

  // (1) _linkUp() por INTERNET sigue la PRESENCIA del contacto (canReach), no "¿tengo internet?" (online)
  const devSave = st.deviceId;
  st.deviceId = 'net:' + idB;
  const net = biA.net || {};
  const canReachSave = net.canReach, onlineSave = net.online;
  net.online = function () { return true; };               // yo SÍ tengo internet
  net.canReach = function () { return false; };             // pero el contacto está OFFLINE
  r.net_offline_linkup_falso = st._linkUp() === false;      // antes (online) daba true → el bug
  net.canReach = function () { return true; };              // contacto en línea
  r.net_online_linkup_verdadero = st._linkUp() === true;
  net.canReach = canReachSave; net.online = onlineSave; st.deviceId = devSave;

  // (2) con el enlace (net) CAÍDO → muchas caducidades NO abortan, NO gastan reintentos y NO marcan 'failed' (esperan)
  let wt = 0, rt = 0; const statuses = [];
  st._startWindowTimer = function () { wt++; };
  st._retransmitWindow = function () { rt++; };
  st._windowReject = function () {};
  const dispSave = biA.ackSystem._dispatchStatus.bind(biA.ackSystem);
  biA.ackSystem._dispatchStatus = function (mid, s) { if (mid === st.msgId) statuses.push(s); };
  const forceWindow = () => { st.aborted = false; st.windowRetryCount = 0; st._windowStartAtSend = 0; st._windowEndAtSend = Math.max(1, Math.min(st.windowSize || 1, st.total || 1)); st.ackedMask = []; };
  forceWindow();
  st._linkUp = function () { return false; };
  for (let k = 0; k < 12; k++) st._onWindowTimeout();
  r.offline_no_aborta = !st.aborted && st.windowRetryCount === 0;
  r.offline_espera = wt > 0 && rt === 0;
  r.offline_sin_failed = statuses.indexOf('failed') < 0;

  // (3) con el contacto EN LÍNEA (enlace arriba) → al pasar el tope de reintentos aborta (comportamiento de siempre)
  forceWindow();
  st._linkUp = function () { return true; };
  for (let k = 0; k <= st.maxWindowRetries + 1 && !st.aborted; k++) st._onWindowTimeout();
  r.online_aborta = st.aborted === true;
  biA.ackSystem._dispatchStatus = dispSave;

  r.errores = logs.filter((l) => / error: /.test(l) && !/JSDOMERROR|styles\.css|Not implemented|GLOBAL TIMEOUT/.test(l)).slice(0, 5);
  const ok = r.hay_stream && r.net_offline_linkup_falso && r.net_online_linkup_verdadero &&
    r.offline_no_aborta && r.offline_espera && r.offline_sin_failed && r.online_aborta && r.errores.length === 0;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('FILEABSENT ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_fileabsent.txt'), logs.join('\n'));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error('FILEABSENT FALLO:', e && e.stack); try { fs.writeFileSync(path.join(__dirname, 'last_logs_fileabsent.txt'), logs.join('\n')); } catch (x) {} process.exit(1); });
