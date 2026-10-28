// Ronda 2814 (#87, diagnóstico del dueño): con un enlace Bluetooth FLOJO (MTU bajo / Vivo), el vigilante cortaba el
// enlace al fallar SOLO 2 pings aunque el otro seguía ahí («sin respuesta a 2 pings: desconectado para reconectar»),
// y cada corte, con varios contactos y teléfonos sueltos alrededor, disparaba escaneos que saturaban la radio = «scan
// lento». Esta prueba comprueba los DOS arreglos de forma determinista (sin azar):
//   1) Throttle del auto-escaneo: un auto-escaneo recién hecho NO se repite antes de _autoScanMinMs; pasado el tiempo, sí.
//   2) Vigilante tolerante: hacen falta 4 pings fallidos seguidos (no 2) para cortar un enlace que sigue «arriba».
// (La tormenta de escaneos real necesita varios teléfonos y una radio de verdad; aquí se validan los mecanismos.)
// Uso: node thrash.js <dir_build>
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

  // Parar el vigilante de fondo (temporizador cada 6 s) para que las dos pruebas sean deterministas: solo cuentan
  // las llamadas que hace la prueba, no pings/escaneos del temporizador en paralelo.
  if (typeof biA._stopConnectionSupervisor === 'function') biA._stopConnectionSupervisor();
  await sleep(300);

  // ---- 1) Throttle del auto-escaneo (determinista) ----
  if (biA.isScanning && typeof biA.toggleScan === 'function') { await biA.toggleScan(); await sleep(300); }
  // (a) auto-escaneo RECIÉN hecho → el siguiente se bloquea (no repite antes de _autoScanMinMs)
  biA.isScanning = false; biA._lastAutoScanAt = Date.now();
  const sBlock0 = scans(nA);
  biA._autoScanForKnownContacts();
  await sleep(150);
  r.throttle_bloquea = scans(nA) === sBlock0; // no hubo escaneo nuevo
  // (b) pasado el tiempo (simulado) → sí escanea
  biA.isScanning = false; biA._lastAutoScanAt = Date.now() - 9000;
  const sAllow0 = scans(nA);
  biA._autoScanForKnownContacts();
  await sleep(150);
  r.throttle_permite = scans(nA) === sAllow0 + 1; // un escaneo
  // (c) el escaneo del USUARIO (toggleScan) NO pasa por el throttle (buscar a mano sigue inmediato)
  if (biA.isScanning && typeof biA.toggleScan === 'function') { await biA.toggleScan(); await sleep(300); }
  biA._lastAutoScanAt = Date.now(); // throttle activo
  const sUser0 = scans(nA);
  if (!biA.isScanning && typeof biA.toggleScan === 'function') await biA.toggleScan();
  await sleep(300);
  r.usuario_no_throttle = scans(nA) === sUser0 + 1;
  if (biA.isScanning && typeof biA.toggleScan === 'function') { await biA.toggleScan(); await sleep(300); }

  // ---- 2) Vigilante tolerante: 4 pings fallidos (no 2) para cortar ----
  let dev = null; biA.connectedDevices.forEach((d, k) => { if (!dev && !/^(lan|net)/.test(k)) dev = k; });
  r.hay_enlace = !!dev;
  if (dev) {
    biA._pingDevice = function () { return Promise.reject(new Error('ping timeout sim')); }; // el ping siempre falla
    biA._pingFailCount.set(dev, 0);
    let cutAt = 0;
    for (let k = 1; k <= 6; k++) {
      if (!biA.connectedDevices.has(dev)) { cutAt = k - 1; break; }
      biA._lastPongTime.set(dev, Date.now() - 20000); // >16 s en silencio → el vigilante pinga
      biA._runSupervisorCycle();
      await sleep(300); // deja correr el ping (que falla) y su manejo
      if (!biA.connectedDevices.has(dev)) { cutAt = k; break; }
    }
    r.corta_en_fallo = cutAt; // debe ser 4 (antes 2)
  }

  r.errores = logs.filter((l) => / error: /.test(l) && !/JSDOMERROR|styles\.css|Not implemented/.test(l)).slice(0, 5);
  const ok = r.conecta && r.throttle_bloquea && r.throttle_permite && r.usuario_no_throttle && r.hay_enlace && r.corta_en_fallo === 4 && !r.errores.length;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('THRASH ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_thrash.txt'), logs.join('\n'));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error(e); fs.writeFileSync(path.join(__dirname, 'last_logs_thrash.txt'), logs.join('\n')); process.exit(1); });
