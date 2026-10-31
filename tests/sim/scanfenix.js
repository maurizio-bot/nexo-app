// Ronda 2854 (#129, diagnóstico del dueño 31-10): «escaneo lento otra vez... debería ser instantáneo». Causa encontrada en
// los diagnósticos: un respaldo FÉNIX de fondo (type:'fenix') viaja sobre un enlace degradado (MTU 23 «ready» pero lentísimo,
// «Cola de escritura llena») y arrastra hasta 15 min; durante todo ese rato `_transferActive()` daba true y el bucle de
// re-búsqueda SALTABA su turno (y `_stopAutoScan` paraba el escaneo al arrancar el envío) → el escaneo de contactos quedaba
// PARADO. Arreglo: un respaldo Fénix (de fondo, nadie lo espera) NO pausa el escaneo; una foto/vídeo/archivo que el usuario
// sí espera SÍ lo pausa (como antes, v6.1.13). Prueba determinista:
//   1) _transferActive(): vacío→libre; un flujo FÉNIX saliente→libre; un ARCHIVO de usuario saliente→ocupado;
//      un FÉNIX entrante→libre; un ARCHIVO de usuario entrante→ocupado.
//   2) bucle de re-búsqueda end-to-end: con un respaldo FÉNIX en curso SÍ escanea (el arreglo); con un ARCHIVO de usuario
//      en curso NO escanea (regresión: lo que el usuario espera sigue pausando el escaneo).
// Uso: node scanfenix.js <dir_build>
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone } = require('./native_mock');

const buildDir = path.resolve(process.argv[2]);
const opts = { readsContentFallback: true, retain: ['onPayloadReceived'], closeOnNoService: true, pace: [15, 15], ioDelay: 25, asymmetric: true };
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
const scans = (n) => n.calls.filter((c) => c.name === 'startScan').length;
function sendText(p, t) { const i = p.win.document.getElementById('message-input'); if (!i) return; i.value = t; i.dispatchEvent(new p.win.Event('input', { bubbles: true })); click(p.win, p.win.document.getElementById('send-btn')); }
const wait = async (c, s) => { for (let i = 0; i < s * 5; i++) { if (await c()) return true; await sleep(200); } return false; };
async function openChatWith(p, name) {
  let row; for (let i = 0; i < 300 && !row; i++) { row = Array.from(p.win.document.querySelectorAll('#main-contacts-list .ble-contact-row')).find((r) => (r.querySelector('.ble-contact-name') || {}).textContent === name); if (!row) await sleep(100); }
  click(p.win, row); await sleep(400); return !!row;
}

(async () => {
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', opts), nB = new NativePhone('B', 'BB:BB:BB:BB:BB:02', opts);
  [nA, nB].forEach((n) => { radio.add(n); n.load(); });
  const [A, B] = await Promise.all([boot('A', nA), boot('B', nB)]);
  const biA = A.win.bleInterface, idA = biA.localNexoId.toLowerCase(), idB = B.win.bleInterface.localNexoId.toLowerCase();
  const r = { build: path.basename(buildDir) };

  // A agrega a B y se conectan
  biA.togglePanel(); let add = null;
  for (let i = 0; i < 400 && !add; i++) { await sleep(100); add = A.win.document.querySelector('#ble-new-device > div button'); if (!add && !biA.isScanning) click(A.win, A.win.document.getElementById('ble-scan-btn')); }
  click(A.win, add); await sleep(1500);
  if (A.win.document.getElementById('ble-panel').classList.contains('active')) biA.togglePanel();
  await openChatWith(A, 'B'); sendText(A, 'hola'); await sleep(1500);
  r.conecta = await wait(async () => (await B.win.vaultLoadMessages(idA)).some((m) => m.content === 'hola'), 30);

  // Determinismo: parar vigilante y bucle, apagar escaneo manual
  if (typeof biA._stopConnectionSupervisor === 'function') biA._stopConnectionSupervisor();
  if (biA._reconnectScanTimer) { clearTimeout(biA._reconnectScanTimer); biA._reconnectScanTimer = null; }
  if (biA.isScanning && typeof biA.toggleScan === 'function') { await biA.toggleScan(); }
  await sleep(300);

  const ack = biA.ackSystem;
  r.hay_ack = !!ack;

  // ---- 1) _transferActive(): clasificación ----
  const clear = () => { if (ack.outgoingStreams) ack.outgoingStreams.clear(); if (ack.incomingBuffers) ack.incomingBuffers.clear(); };
  clear();
  r.vacio_libre = biA._transferActive() === false;
  // flujo FÉNIX saliente (de fondo) → NO ocupa
  clear();
  ack.outgoingStreams.set('fx1', { type: 'file', aborted: false, meta: { type: 'fenix' }, lastAckAt: Date.now() });
  r.fenix_out_libre = biA._transferActive() === false;
  // ARCHIVO de usuario saliente → SÍ ocupa (regresión: lo que el usuario espera sigue pausando)
  clear();
  ack.outgoingStreams.set('ph1', { type: 'file', aborted: false, meta: { type: 'photo' }, lastAckAt: Date.now() });
  r.user_out_ocupa = biA._transferActive() === true;
  // FÉNIX entrante → NO ocupa
  clear();
  ack.incomingBuffers.set('fx2', { isChat: false, meta: { type: 'fenix' }, lastActivity: Date.now() });
  r.fenix_in_libre = biA._transferActive() === false;
  // ARCHIVO de usuario entrante → SÍ ocupa
  clear();
  ack.incomingBuffers.set('ph2', { isChat: false, meta: { type: 'photo' }, lastActivity: Date.now() });
  r.user_in_ocupa = biA._transferActive() === true;
  clear();

  // ---- 2) bucle de re-búsqueda end-to-end ----
  const prep = () => {
    if (biA._reconnectScanTimer) { clearTimeout(biA._reconnectScanTimer); biA._reconnectScanTimer = null; }
    biA.isScanning = false; biA._cameraBlePaused = false; biA._scanUnsupported = false;
    biA._scanBlockedUntil = 0; biA._scanStartTimes = []; biA._lastAutoScanAt = 0;
    biA._presenceUntil = 0;
    biA._lostPeers.clear(); biA._lostPeers.add(idB);
    if (biA._bleCooldownUntil) biA._bleCooldownUntil.delete(idB);
  };
  // (a) respaldo FÉNIX en curso → SÍ escanea (el arreglo)
  clear(); prep();
  ack.outgoingStreams.set('fx3', { type: 'file', aborted: false, meta: { type: 'fenix' }, lastAckAt: Date.now() });
  const sFenix0 = scans(nA);
  biA._startReconnectScanLoop();
  await sleep(2600); // primer tick a los 2000 ms
  r.fenix_no_frena_escaneo = scans(nA) > sFenix0;
  if (biA._reconnectScanTimer) { clearTimeout(biA._reconnectScanTimer); biA._reconnectScanTimer = null; }
  // (b) ARCHIVO de usuario en curso → NO escanea (regresión)
  clear(); prep();
  ack.outgoingStreams.set('ph3', { type: 'file', aborted: false, meta: { type: 'photo' }, lastAckAt: Date.now() });
  const sUser0 = scans(nA);
  biA._startReconnectScanLoop();
  await sleep(2600);
  r.user_si_frena_escaneo = scans(nA) === sUser0;
  r.bucle_sigue_vivo = !!biA._reconnectScanTimer; // no murió: reintenta al terminar la transferencia
  if (biA._reconnectScanTimer) { clearTimeout(biA._reconnectScanTimer); biA._reconnectScanTimer = null; }
  clear();

  r.errores = logs.filter((l) => / error: /.test(l) && !/JSDOMERROR|styles\.css|Not implemented/.test(l)).slice(0, 5);
  const ok = r.conecta && r.hay_ack && r.vacio_libre && r.fenix_out_libre && r.user_out_ocupa &&
    r.fenix_in_libre && r.user_in_ocupa && r.fenix_no_frena_escaneo && r.user_si_frena_escaneo && r.bucle_sigue_vivo && !r.errores.length;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('SCANFENIX ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_scanfenix.txt'), logs.join('\n'));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error(e); fs.writeFileSync(path.join(__dirname, 'last_logs_scanfenix.txt'), logs.join('\n')); process.exit(1); });
