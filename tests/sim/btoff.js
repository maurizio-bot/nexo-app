// Diagnóstico del dueño (teléfono Nubia, build 2984, 10-11 11:47): con el Bluetooth APAGADO la app repetía «Auto-scan fallo: Bluetooth
// desactivado» y «Re-búsqueda» y llegó a dar un «zombi» falso de un enlace Bluetooth que ya no existía (que además mandó un diagnóstico
// automático al desarrollador). 2995: con el Bluetooth apagado NO se busca (se vuelve a mirar cada minuto), NO se comprueban enlaces
// Bluetooth ni se da ningún «zombi», se avisa UNA sola vez, y al encenderse vuelve todo.
// Uso: node btoff.js <dir_build>
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone, installWebCrypto } = require('./native_mock');

const buildDir = path.resolve(process.argv[2]);
const base = { readsContentFallback: true, retain: ['onPayloadReceived'], closeOnNoService: true, pace: [15, 15], ioDelay: 0, asymmetric: true, noTor: true };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
class DL extends ResourceLoader { constructor(d) { super(); this.d = d; } fetch(u) { const f = path.join(this.d, decodeURIComponent(new URL(u).pathname)); return fs.existsSync(f) ? Promise.resolve(fs.readFileSync(f)) : Promise.reject(new Error('no existe ' + f)); } }
const logs = [];
(async () => {
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', base);
  radio.add(nA); nA.load();
  const vc = new VirtualConsole();
  ['log', 'warn', 'error'].forEach((l) => vc.on(l, (...a) => logs.push(`[A] ${l}: ` + a.map(String).join(' ').substring(0, 250))));
  let scans = 0, btOn = false;
  const dom = new JSDOM(fs.readFileSync(path.join(buildDir, 'dist', 'index.html'), 'utf8'), {
    url: 'https://a.nexo.test/index.html', runScripts: 'dangerously', resources: new DL(path.join(buildDir, 'dist')), pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) {
      win.CapacitorCustomPlatform = { name: 'android' }; installWebCrypto(win);
      const pl = nA.plugin(); const orig = pl.startScan;
      pl.startScan = async function (a) { scans++; if (!btOn) throw new Error('Bluetooth desactivado'); return orig.call(pl, a); };
      win.Capacitor = { Plugins: { NexoBLE: pl } }; win.HTMLElement.prototype.scrollTo = function () {};
    },
  });
  const win = dom.window;
  for (let i = 0; i < 100 && !(win.NEXO && win.NEXO.initialized); i++) await sleep(100);
  await sleep(1500);
  const bi = win.bleInterface;
  const r = { prueba: 'btoff', build: path.basename(buildDir) };
  const symptoms = [];
  win.addEventListener('nexo:diag:symptom', (e) => symptoms.push(e.detail && e.detail.kind));
  // (1) 25 intentos de búsqueda con el Bluetooth apagado
  bi._btOffUntil = 0; bi._btOffLogged = false;   // (al arrancar ya se había notado el Bluetooth apagado: se parte de cero)
  scans = 0; logs.length = 0;
  for (let i = 0; i < 25; i++) { bi._lastAutoScanAt = 0; bi.isScanning = false; bi._autoScanForKnownContacts(); await sleep(60); }
  r.intentos_de_escaneo = scans;
  r.avisos_apagado = logs.filter((l) => /Bluetooth apagado: no se busca/.test(l)).length;
  r.sin_fallo_repetido = logs.filter((l) => /Auto-scan fallo/.test(l)).length === 0;
  // (2) un enlace Bluetooth «listo» de un recuerdo: ningún ping ni «zombi» en varios ciclos del supervisor
  const mac = 'AA:BB:CC:DD:EE:99';
  const BLE = win.NEXO && win.NEXO.BLE_STATES;
  let pings = 0;
  bi._pingDevice = function () { pings++; return Promise.reject(new Error('Ping timeout')); };
  bi.connectedDevices.set(mac, { id: mac });
  bi._setDeviceState(mac, 'ready_to_chat');
  bi._pingMaxFails = 1;
  for (let i = 0; i < 4; i++) { bi._lastPongTime.set(mac, 0); bi._runSupervisorCycle(); await sleep(150); }
  r.pings_con_bt_apagado = pings; r.zombi_falso = symptoms.filter((k) => k === 'zombi').length;
  // (3) se enciende el Bluetooth: tras el minuto de espera vuelve a escanear y ya no está «apagado»
  btOn = true; bi._btOffUntil = Date.now() - 1; scans = 0;
  bi._lastAutoScanAt = 0; bi.isScanning = false; bi._autoScanForKnownContacts(); await sleep(300);
  r.vuelve_al_encender = scans >= 1 && !bi._btIsOff() && logs.some((l) => /Bluetooth encendido otra vez/.test(l));
  // y con el Bluetooth encendido el supervisor vuelve a comprobar el enlace
  pings = 0; bi._lastPongTime.set(mac, 0); bi._pingInFlight && bi._pingInFlight.clear(); bi._runSupervisorCycle(); await sleep(100);
  r.supervisor_vuelve = pings >= 1;
  r.errores = logs.filter((l) => / error: /.test(l) && !/JSDOMERROR|styles\.css|Not implemented|GLOBAL TIMEOUT|Assembly timeout|net::ERR|fetch/.test(l)).slice(0, 5);
  const ok = r.intentos_de_escaneo <= 2 && r.avisos_apagado === 1 && r.sin_fallo_repetido && r.pings_con_bt_apagado === 0 && r.zombi_falso === 0 && r.vuelve_al_encender && r.supervisor_vuelve && r.errores.length === 0;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('BTOFF ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_btoff.txt'), logs.join('\n'));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('BTOFF ' + JSON.stringify({ prueba: 'btoff', resultado: 'FALLO', error: String(e && e.message) })); process.exit(1); });
