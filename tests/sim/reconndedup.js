// #dueño 02-11 (diagnóstico del coche + Bluetooth): dos tormentas de reconexión que gastaban radio/batería y se
// realimentaban. Arreglo (2887, todo JS, dedup):
//   A3 — el supervisor corre cada 6 s pero un ping caduca a los 8 s: se apilaban 2-3 pings del MISMO enlace en vuelo y,
//        al caducar juntos, cada catch sumaba fallo y disparaba la desconexión → «sin respuesta a 2 pings» TRIPLICADO.
//        Fix: un ping por enlace a la vez (_pingInFlight) + _forceDisconnectAndReconnect idempotente.
//   D1 — relay._connect llamaba connectToDevice en CADA tick de re-búsqueda para el MISMO contacto (12 en 1 ms:
//        tormenta «[JUMP] Conectando con»): el guard de 15 s solo cubría los NO-contactos. Fix: ventana de dedup de
//        connect (_connecting) que cubre también a los contactos.
//
// Esta prueba arranca UN teléfono, inyecta un enlace y comprueba por conteo que N llamadas → 1 acción.
// Uso: node reconndedup.js <dir_build>
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone } = require('./native_mock');

const buildDir = path.resolve(process.argv[2]);
const opts = { readsContentFallback: true, retain: ['onPayloadReceived'], closeOnNoService: true, pace: [15, 15], ioDelay: 25, noL2: true };
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
  await sleep(600);
  return { name, native, win };
}

(async () => {
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', Object.assign({}, opts, { wifi: 'casa' }));
  radio.add(nA); nA.load();
  const A = await boot('A', nA);
  const bi = A.win.bleInterface;
  const r = { build: path.basename(buildDir) };
  const BLE_STATES = { READY_TO_CHAT: 'ready_to_chat' };

  // ---------- A3: un ping por enlace a la vez; desconexión idempotente ----------
  const dev = 'CC:CC:CC:CC:CC:03';
  bi.connectedDevices.set(dev, { deviceId: dev });
  bi._setDeviceState(dev, 'ready_to_chat');
  bi._lastPongTime.set(dev, 0);            // nunca llegó un pong → el supervisor quiere pingear
  bi._pingFailCount.set(dev, 0);
  bi._hasActiveFileTransfer = function () { return false; };

  // Ping que queda EN VUELO (no resuelve): así se ve si el supervisor apila otro
  let pingCalls = 0;
  bi._pingDevice = function () { pingCalls++; return new Promise(function () {}); };
  bi._runSupervisorCycle(); bi._runSupervisorCycle(); bi._runSupervisorCycle(); // 3 ticks seguidos
  await sleep(30);
  r.a3_un_ping_en_vuelo = pingCalls === 1; // antes: 3

  // Desconexión idempotente: llamarla 3 veces → un solo «sin respuesta a 2 pings»
  const warnsBefore = logs.filter((l) => /sin respuesta a 2 pings/.test(l)).length;
  bi._forceDisconnectAndReconnect(dev); bi._forceDisconnectAndReconnect(dev); bi._forceDisconnectAndReconnect(dev);
  await sleep(30);
  const warnsAfter = logs.filter((l) => /sin respuesta a 2 pings/.test(l)).length;
  r.a3_desconexion_idempotente = (warnsAfter - warnsBefore) === 1; // antes: 3

  // ---------- D1: un connect por contacto dentro de la ventana ----------
  const relay = bi.relay;
  r.hay_relay = !!(relay && typeof relay._connect === 'function');
  if (relay && relay._connect) {
    // Contar connectToDevice nativos hacia un deviceId concreto
    let connCalls = 0;
    const pl = bi.nativePlugin;
    const origConn = pl.connectToDevice ? pl.connectToDevice.bind(pl) : null;
    pl.connectToDevice = function (a) { if (a && a.deviceId === 'DD:DD:DD:DD:DD:04') connCalls++; return Promise.resolve({}); };
    // Forzar que sea CONTACTO y que NO esté listo (es el caso que no tenía dedup)
    relay._isContact = function () { return true; };
    relay._isReady = function () { return false; };
    relay.neighbors = new Map();
    if (relay._connecting && relay._connecting.delete) relay._connecting.delete('nxstorm01');
    for (let i = 0; i < 12; i++) relay._connect('nxstorm01', 'DD:DD:DD:DD:DD:04'); // 12 en ráfaga
    await sleep(20);
    r.d1_connect_calls = connCalls;
    r.d1_un_connect = connCalls === 1; // antes: 12
    if (origConn) pl.connectToDevice = origConn;
  } else {
    r.d1_un_connect = false;
  }

  r.errores = logs.filter((l) => / error: /.test(l) && !/JSDOMERROR|styles\.css|Not implemented/.test(l)).slice(0, 5);
  const ok = r.a3_un_ping_en_vuelo && r.a3_desconexion_idempotente && r.hay_relay && r.d1_un_connect && !r.errores.length;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('RECONNDEDUP ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_reconndedup.txt'), logs.join('\n'));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error(e); fs.writeFileSync(path.join(__dirname, 'last_logs_reconndedup.txt'), logs.join('\n')); process.exit(1); });
