// #dueño 02-11 (CRASH, lo más grave hasta ahora): subir 2 archivos a un chat con TIEMPO (muchas transferencias
// pendientes viejas: segmentos Fénix, mensajes sin entregar) congelaba la app (ANR). Causa: resumeOutgoingTransfers
// arrancaba TODAS las pendientes a la vez → decenas de ChatStreams simultáneos, cada uno con su temporizador
// reintentando sobre un enlace caído/MTU 23 → el hilo principal del WebView se saturaba y la app se trababa.
// Arreglo (2888): cola global — se reanudan como mucho MAX_RESUME_CONCURRENT a la vez (el resto espera), con dedup
// (no encolar dos veces lo mismo) y contenido reconstruido perezosamente (no todas de golpe).
//
// Esta prueba inyecta 12 transferencias pendientes en el vault, congela el envío real (para poder medir cuántas
// arrancan) y comprueba: (1) solo arrancan MAX a la vez, (2) el resto queda EN COLA (ninguna perdida), (3) al
// terminar una, entra la siguiente, (4) resumeOutgoingTransfers llamado otra vez NO duplica (dedup).
// Uso: node resumestorm.js <dir_build>
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
  ['log', 'warn', 'error'].forEach((l) => vc.on(l, (...a) => logs.push(`[${name}] ${l}: ` + a.map(String).join(' ').substring(0, 200))));
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
async function openChatWith(p, name) {
  let row; for (let i = 0; i < 300 && !row; i++) { row = Array.from(p.win.document.querySelectorAll('#main-contacts-list .ble-contact-row')).find((r) => (r.querySelector('.ble-contact-name') || {}).textContent === name); if (!row) await sleep(100); }
  click(p.win, row); await sleep(300); return !!row;
}

(async () => {
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', Object.assign({}, opts, { wifi: 'casa' })), nB = new NativePhone('B', 'BB:BB:BB:BB:BB:02', Object.assign({}, opts, { wifi: 'casa' }));
  [nA, nB].forEach((n) => { radio.add(n); n.load(); });
  const [A, B] = await Promise.all([boot('A', nA), boot('B', nB)]);
  const biA = A.win.bleInterface, AS = biA.ackSystem, idB = B.win.bleInterface.localNexoId.toLowerCase();
  const r = { build: path.basename(buildDir) };

  // A agrega a B y se conectan (para que resume resuelva un deviceId)
  biA.togglePanel(); let add = null;
  for (let i = 0; i < 400 && !add; i++) { await sleep(100); add = A.win.document.querySelector('#ble-new-device > div button'); if (!add && !biA.isScanning) click(A.win, A.win.document.getElementById('ble-scan-btn')); }
  click(A.win, add); await sleep(1500);
  if (A.win.document.getElementById('ble-panel').classList.contains('active')) biA.togglePanel();
  await openChatWith(A, 'B');
  const devB = Array.from(biA.connectedDevices.keys())[0] || 'BB:BB:BB:BB:BB:02';

  // Tope de reanudación en 3 para la prueba
  A.win.NEXO_MAX_RESUME = 3;

  // Congelar el envío REAL para medir cuántas arrancan (promesas que no resuelven hasta que queramos)
  const started = []; const resolvers = {};
  const hold = function (devId, content, meta, tid) { started.push(tid); return new A.win.Promise(function (res) { resolvers[tid] = res; }); };
  AS.sendChunkedMessage = function (devId, content, meta, tid, seq) { return hold(devId, content, meta, tid); };
  AS.sendFile = function (devId, tid, content, meta) { return hold(devId, content, meta, tid); };

  // Inyectar 12 transferencias pendientes (chunked) para B en el vault de A
  const N = 12;
  for (let i = 0; i < N; i++) {
    await A.win.vaultCreateOutgoingTransfer(idB, 'inj_' + i, 'chat', 1, ['hola' + i], { to: idB }, devB);
  }
  const pend0 = await A.win.vaultGetPendingOutgoingTransfers(idB);
  r.inyectadas = Array.isArray(pend0) ? pend0.filter((t) => /^inj_/.test(t.transferId)).length : 0;

  // Reanudar: NO deben arrancar las 12 de golpe
  AS.resumeOutgoingTransfers();
  await sleep(600); // esperar a vaultGetPendingOutgoingTransfers + _dropDeliveredTransfers
  r.arrancaron_primera_tanda = started.length;          // esperado: 3 (no 12)
  r.en_cola = (AS._resumeQueue || []).length;            // esperado: 9
  r.activas = AS._resumeActive;                          // esperado: 3
  r.cap_respetado = started.length === 3 && r.en_cola === 9 && r.activas === 3;
  r.ninguna_perdida = started.length + r.en_cola === N;

  // Dedup: llamar resume otra vez NO debe encolar/arrancar duplicados
  AS.resumeOutgoingTransfers();
  await sleep(300);
  r.sin_duplicar = started.length === 3 && (AS._resumeQueue || []).length === 9;

  // Al terminar una, entra la siguiente (la cola avanza, no se queda clavada)
  const firstId = started[0];
  if (resolvers[firstId]) resolvers[firstId]();
  await sleep(200);
  r.avanza_cola = started.length === 4 && AS._resumeActive === 3 && (AS._resumeQueue || []).length === 8;

  // Soltar el resto para no dejar promesas colgadas
  Object.keys(resolvers).forEach((k) => { try { resolvers[k](); } catch (e) {} });
  await sleep(100);

  r.errores = logs.filter((l) => / error: /.test(l) && !/JSDOMERROR|styles\.css|Not implemented/.test(l)).slice(0, 5);
  const ok = r.inyectadas === N && r.cap_respetado && r.ninguna_perdida && r.sin_duplicar && r.avanza_cola && !r.errores.length;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('RESUMESTORM ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_resumestorm.txt'), logs.join('\n'));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error(e); fs.writeFileSync(path.join(__dirname, 'last_logs_resumestorm.txt'), logs.join('\n')); process.exit(1); });
