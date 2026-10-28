// Ronda 2821 (#87, diagnóstico del dueño 28-10): un contacto cuyo GATT nunca aparece (reason 'no_service', MTU 23 en el
// Vivo) se reconectaba por Bluetooth cada ~15 s PARA SIEMPRE → cientos de «despertares» y batería (el diagnóstico del
// Vivo marcó 627 despertares por mensajes). Arreglo: tras `_noServiceThreshold` (4) no_service seguidos se pausa SOLO el
// Bluetooth con ese contacto (backoff exponencial); internet/Wi-Fi/Jump siguen igual; al conectar bien se olvida.
// Esta prueba es determinista (dispara los eventos a mano, no depende de la radio real):
//   1) 4 no_service seguidos → se fija la pausa (cooldown) y la racha llega a 4.
//   2) un corte normal (no no_service) NO cuenta como GATT roto → se olvida la racha.
//   3) al conectar bien (peerReady) se olvida racha y pausa.
//   4) con el contacto en pausa y siendo el único «perdido», el bucle de re-búsqueda NO escanea (deja de martillar);
//      sin pausa, sí escanea.
// Uso: node noservice.js <dir_build>
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

  // A agrega a B y se conectan (A conoce a B y su deviceId)
  biA.togglePanel(); let add = null;
  for (let i = 0; i < 400 && !add; i++) { await sleep(100); add = A.win.document.querySelector('#ble-new-device > div button'); if (!add && !biA.isScanning) click(A.win, A.win.document.getElementById('ble-scan-btn')); }
  click(A.win, add); await sleep(1500);
  if (A.win.document.getElementById('ble-panel').classList.contains('active')) biA.togglePanel();
  await openChatWith(A, 'B'); sendText(A, 'hola'); await sleep(1500);
  r.conecta = await wait(async () => (await B.win.vaultLoadMessages(idA)).some((m) => m.content === 'hola'), 30);

  // Parar el vigilante y el bucle para que la prueba sea determinista
  if (typeof biA._stopConnectionSupervisor === 'function') biA._stopConnectionSupervisor();
  if (biA._reconnectScanTimer) { clearTimeout(biA._reconnectScanTimer); biA._reconnectScanTimer = null; }
  if (biA.isScanning && typeof biA.toggleScan === 'function') { await biA.toggleScan(); }
  await sleep(300);

  // deviceId (MAC) de B en A
  let bMac = null; biA.connectedDevices.forEach((d, k) => { if (!bMac && !/^(lan|net)/.test(k)) bMac = k; });
  r.hay_enlace = !!bMac;

  // No dejar que el auto-escaneo reconecte a B a mitad de la prueba (controlamos los eventos a mano)
  const realAutoScan = biA._autoScanForKnownContacts;
  biA._autoScanForKnownContacts = function () {};

  // ---- 1) 4 no_service seguidos → pausa fijada ----
  biA._noServiceStreak.delete(idB); biA._bleCooldownUntil.delete(idB);
  for (let k = 0; k < 4; k++) { nA.emit('onDeviceDisconnected', { deviceId: bMac, reason: 'no_service' }); await sleep(40); }
  r.racha_4 = (biA._noServiceStreak.get(idB) || 0) >= 4;
  r.pausa_fijada = (biA._bleCooldownUntil.get(idB) || 0) > Date.now();
  r.aviso_pausa = logs.some((l) => /sin servicio GATT/.test(l));

  // ---- 2) un corte normal NO cuenta como GATT roto (se olvida la racha) ----
  nA.emit('onDeviceDisconnected', { deviceId: bMac, reason: 'timeout' }); await sleep(40);
  r.corte_normal_olvida_racha = !biA._noServiceStreak.has(idB);

  // ---- 3) al conectar bien (peerReady) se olvida racha y pausa ----
  biA._noServiceStreak.set(idB, 5); biA._bleCooldownUntil.set(idB, Date.now() + 300000);
  biA._notifyPeerReady(bMac, idB);
  r.peerready_limpia = !biA._noServiceStreak.has(idB) && !biA._bleCooldownUntil.has(idB);

  // ---- 4) bucle de re-búsqueda: en pausa NO escanea; sin pausa sí ----
  biA._autoScanForKnownContacts = realAutoScan; // el bucle vuelve a escanear de verdad
  biA.isScanning = false;
  const startLoopFresh = async () => { if (biA._reconnectScanTimer) { clearTimeout(biA._reconnectScanTimer); biA._reconnectScanTimer = null; } };
  // (a) B perdido y EN PAUSA (único perdido) → no escanea
  await startLoopFresh();
  biA._lostPeers.clear(); biA._lostPeers.add(idB);
  biA._bleCooldownUntil.set(idB, Date.now() + 60000);
  biA._presenceUntil = 0;
  const sPause0 = scans(nA);
  biA._startReconnectScanLoop();
  await sleep(2600); // el primer tick es a los 2000 ms
  r.pausa_no_escanea = scans(nA) === sPause0;
  r.bucle_sigue_vivo = !!biA._reconnectScanTimer; // reprogramado para cuando acabe la pausa (no murió)
  // (b) B perdido SIN pausa → sí escanea
  await startLoopFresh();
  biA._bleCooldownUntil.delete(idB);
  biA._lostPeers.clear(); biA._lostPeers.add(idB);
  biA.isScanning = false;
  const sActive0 = scans(nA);
  biA._startReconnectScanLoop();
  await sleep(2600);
  r.activo_si_escanea = scans(nA) > sActive0;

  r.errores = logs.filter((l) => / error: /.test(l) && !/JSDOMERROR|styles\.css|Not implemented/.test(l)).slice(0, 5);
  const ok = r.conecta && r.hay_enlace && r.racha_4 && r.pausa_fijada && r.aviso_pausa &&
    r.corte_normal_olvida_racha && r.peerready_limpia && r.pausa_no_escanea && r.bucle_sigue_vivo && r.activo_si_escanea && !r.errores.length;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('NOSERVICE ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_noservice.txt'), logs.join('\n'));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error(e); fs.writeFileSync(path.join(__dirname, 'last_logs_noservice.txt'), logs.join('\n')); process.exit(1); });
