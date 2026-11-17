// 3203 (diagnóstico de Roberto, Motorola edge 40 neo 3087, 17-11 09:32): con la app en segundo plano, un teléfono sin identificar
// (…0da5) entró y salió del servidor GATT cada ~36 s durante 14 min; al volver a la app, el JS recibió de golpe todo lo acumulado
// («Enlace ? (0da5) desconectado ×21») y pidió 24 «[ADVERTISING] startAdvertising» en el mismo milisegundo (09:32:04.155–.182), uno
// por desconexión. Ahora una ráfaga pide UNO (el último pedido gana) y una desconexión suelta lo sigue pidiendo.
// (El freno del lado nativo, que corta esas vueltas en el servidor GATT, se prueba en JVM: tests/kotlin ServerFlapPolicyTest.)
// Uso: node advrafaga.js <dir_build>
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone, installWebCrypto } = require('./native_mock');

const buildDir = path.resolve(process.argv[2]);
// bridgeMs: en el teléfono cada aviso es su propio evaluateJavascript, uno detrás de otro
const base = { readsContentFallback: true, retain: ['onPayloadReceived'], closeOnNoService: true, pace: [15, 15], ioDelay: 0, asymmetric: true, noTor: true, appStateEvents: true, bridgeMs: 2 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
class DL extends ResourceLoader { constructor(d) { super(); this.d = d; } fetch(u) { const f = path.join(this.d, decodeURIComponent(new URL(u).pathname)); return fs.existsSync(f) ? Promise.resolve(fs.readFileSync(f)) : Promise.reject(new Error('no existe ' + f)); } }
const logs = [];
(async () => {
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', base);
  radio.add(nA); nA.load();
  const vc = new VirtualConsole();
  ['log', 'warn', 'error'].forEach((l) => vc.on(l, (...a) => logs.push(`[A] ${l}: ` + a.map(String).join(' ').substring(0, 250))));
  const advCalls = [];
  const dom = new JSDOM(fs.readFileSync(path.join(buildDir, 'dist', 'index.html'), 'utf8'), {
    url: 'https://a.nexo.test/index.html', runScripts: 'dangerously', resources: new DL(path.join(buildDir, 'dist')), pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) {
      win.CapacitorCustomPlatform = { name: 'android' }; installWebCrypto(win);
      const pl = nA.plugin(); const orig = pl.startAdvertising;
      pl.startAdvertising = function (a) { advCalls.push(Date.now()); return orig.call(pl, a); };
      win.Capacitor = { Plugins: { NexoBLE: pl } }; win.HTMLElement.prototype.scrollTo = function () {};
    },
  });
  const win = dom.window;
  for (let i = 0; i < 100 && !(win.NEXO && win.NEXO.initialized); i++) await sleep(100);
  await sleep(2500);
  const bi = win.bleInterface;
  const r = { prueba: 'advrafaga', build: path.basename(buildDir) };
  r.anunciando = !!bi.isAdvertising;
  if (!bi.isAdvertising) bi.isAdvertising = true;
  const MAC = '4B:F1:7F:56:0D:A5', otros = ['5C:11:22:33:44:01', '5C:11:22:33:44:02', '5C:11:22:33:44:03'];
  const count = (t0) => advCalls.filter((t) => t >= t0).length;

  // (1) segundo plano con la app congelada: 21 entradas y salidas del desconocido + 3 salidas más (24); vuelve a la app
  nA.setAppActive(false); nA.setFrozen(true);
  for (let i = 0; i < 21; i++) {
    nA.emit('onDeviceConnected', { deviceId: MAC, direction: 'incoming', role: 'server', servicesReady: true });
    nA.emit('onDeviceDisconnected', { deviceId: MAC });
  }
  otros.forEach((m) => nA.emit('onDeviceDisconnected', { deviceId: m }));
  await sleep(300);
  let t0 = Date.now(); logs.length = 0;
  nA.setFrozen(false); nA.setAppActive(true);
  await sleep(4000);
  r.al_volver_startAdvertising = count(t0);
  if (r.al_volver_startAdvertising > 1) { const c = advCalls.filter((t) => t >= t0); r.al_volver_en_ms = c[c.length - 1] - c[0]; }
  r.al_volver_desconexiones_0da5 = logs.filter((l) => /Enlace \? \(0da5\) desconectado/.test(l)).length;

  // (2) ráfaga con la app abierta: 6 desconexiones seguidas (cada 30 ms) → uno
  t0 = Date.now();
  for (let i = 0; i < 6; i++) { nA.emit('onDeviceDisconnected', { deviceId: otros[i % 3] }); await sleep(30); }
  await sleep(2500);
  r.rafaga_startAdvertising = count(t0);

  // (3) una desconexión suelta, ya pasada la ráfaga: sigue pidiéndolo (no se pierde el reinicio)
  t0 = Date.now();
  nA.emit('onDeviceDisconnected', { deviceId: MAC });
  await sleep(2500);
  r.suelta_startAdvertising = count(t0);

  // (4) chorro continuo (una cada 300 ms durante 5 s): como mucho uno cada 2 s, y ninguno se queda sin salir al final
  t0 = Date.now();
  for (let i = 0; i < 17; i++) { nA.emit('onDeviceDisconnected', { deviceId: otros[i % 3] }); await sleep(300); }
  const tFin = Date.now();
  await sleep(2500);
  r.chorro_startAdvertising = count(t0);
  r.chorro_ultimo_tras_el_fin = advCalls.some((t) => t >= tFin);

  // (5) el último pedido gana: se pide y antes de que salga se deja de anunciar → no se pide
  t0 = Date.now();
  nA.emit('onDeviceDisconnected', { deviceId: MAC });
  await sleep(50); bi.isAdvertising = false;
  await sleep(2500);
  r.ultimo_pedido_gana_startAdvertising = count(t0);
  bi.isAdvertising = true;

  r.errores = logs.filter((l) => / error: /.test(l) && !/JSDOMERROR|styles\.css|Not implemented|GLOBAL TIMEOUT|Assembly timeout|net::ERR|fetch/.test(l)).slice(0, 5);
  const ok = r.al_volver_startAdvertising === 1 && r.al_volver_desconexiones_0da5 === 21 && r.rafaga_startAdvertising === 1 && r.suelta_startAdvertising === 1 &&
    r.chorro_startAdvertising >= 2 && r.chorro_startAdvertising <= 4 && r.chorro_ultimo_tras_el_fin && r.ultimo_pedido_gana_startAdvertising === 0 && r.errores.length === 0;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('ADVRAFAGA ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_advrafaga.txt'), logs.join('\n'));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('ADVRAFAGA ' + JSON.stringify({ prueba: 'advrafaga', resultado: 'FALLO', error: String(e && e.message) })); fs.writeFileSync(path.join(__dirname, 'last_logs_advrafaga.txt'), logs.join('\n')); process.exit(1); });
