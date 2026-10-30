// VOPR — simulador de caos DETERMINISTA (build 2838, pedido del dueño: «robusto en un concierto con miles de NEXO
// escaneando» + «escaneo rápido y robusto en poca señal, lejanía, interferencia, ahorro de batería»).
// Con una SEMILLA fija inyecta condiciones reproducibles y comprueba INVARIANTES duras; al fallar, imprime la semilla
// para re-ejecutar idéntico (estilo VOPR de TigerBeetle). Sube la dimensión D del índice de robustez.
//
// Escenario 1 = «concierto»: A (nuestro teléfono) debe descubrir a un contacto CONOCIDO (B) entre N anunciantes de
// RUIDO (pulseras/beacons/otros teléfonos), sin tormenta de callbacks, respetando el límite de Android (5 startScan/30 s)
// y recuperándose de fallos de escaneo (onScanFailed 3/5/6). Palanca nº1 (build 2838): el FILTRO NEXO en hardware hace
// que el ruido NO llegue a la app → el tiempo de descubrimiento del conocido NO crece con N.
//
// Uso: node vopr.js <dir_build> [--scenario=concierto] [--seed=1337]
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone, installWebCrypto } = require('./native_mock');

const buildDir = path.resolve(process.argv[2] || path.join(__dirname, 'builds/wip'));
function argOf(name, def) { const a = process.argv.find((x) => x.indexOf('--' + name + '=') === 0); return a ? a.split('=')[1] : def; }
const scenario = argOf('scenario', 'concierto');
const seed = parseInt(argOf('seed', '1337'), 10) || 1337;
// PRNG determinista (mulberry32): mismo seed → misma corrida.
function mulberry32(a) { return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const rnd = mulberry32(seed);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const base = { readsContentFallback: true, retain: ['onDeviceFound', 'onScanFailed', 'onScanStopped'], closeOnNoService: true, pace: [15, 15], ioDelay: 25 };
const logs = [];
class DL extends ResourceLoader { constructor(d) { super(); this.d = d; } fetch(u) { const f = path.join(this.d, decodeURIComponent(new URL(u).pathname)); return fs.existsSync(f) ? Promise.resolve(fs.readFileSync(f)) : Promise.reject(new Error('x')); } }
async function boot(name, native) {
  native.listeners = new Map();
  const vc = new VirtualConsole();
  ['log', 'warn', 'error'].forEach((l) => vc.on(l, (...a) => logs.push(`${name} ${l}: ` + a.map(String).join(' ').substring(0, 200))));
  const dom = new JSDOM(fs.readFileSync(path.join(buildDir, 'dist', 'index.html'), 'utf8'), {
    url: 'https://' + name.toLowerCase() + '.nexo.test/index.html', runScripts: 'dangerously',
    resources: new DL(path.join(buildDir, 'dist')), pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) { win.CapacitorCustomPlatform = { name: 'android' }; installWebCrypto(win); win.Capacitor = { Plugins: { NexoBLE: native.plugin() } }; win.HTMLElement.prototype.scrollTo = function () {}; },
  });
  const win = dom.window;
  for (let i = 0; i < 100 && !(win.NEXO && win.NEXO.initialized); i++) await sleep(100);
  await sleep(800);
  return { name, native, win };
}
const click = (win, el) => el && el.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
async function addFound(p, name) {
  let add = null;
  const find = () => { const row = Array.from(p.win.document.querySelectorAll('#ble-new-device > div')).find((d) => (d.querySelector('span') || {}).textContent === name); return row && row.querySelector('button'); };
  for (let i = 0; i < 400 && !add; i++) { await sleep(100); add = find(); if (!add && !p.win.bleInterface.isScanning) click(p.win, p.win.document.getElementById('ble-scan-btn')); }
  click(p.win, add); await sleep(1500);
  return !!add;
}
async function waitFor(fn, ms) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (fn()) return Date.now() - t0; await sleep(50); } return null; }

(async () => {
  if (scenario !== 'concierto') { console.log('VOPR ' + JSON.stringify({ scenario, resultado: 'FALLO', error: 'escenario desconocido' })); process.exit(1); }
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', Object.assign({}, base));
  const nB = new NativePhone('B', 'BB:BB:BB:BB:BB:02', Object.assign({}, base));
  [nA, nB].forEach((n) => { radio.add(n); n.load(); });
  const A = await boot('A', nA), B = await boot('B', nB);
  const r = { scenario, seed, build: path.basename(buildDir) };
  const bi = A.win.bleInterface;

  // Emparejar: A agrega a B (B pasa a ser contacto CONOCIDO). Confirma de paso que el escaneo CON FILTRO (cambio de la
  // 2838, ahora siempre filtrado) sigue encontrando a un NEXO real.
  bi.togglePanel();
  r.empareja = await addFound(A, 'B');
  bi.togglePanel();
  await sleep(500);

  // Silenciar los bucles de fondo para aserciones deterministas (el escaneo lo disparamos nosotros).
  if (bi._reconnectScanTimer) { clearTimeout(bi._reconnectScanTimer); bi._reconnectScanTimer = null; }
  bi._startReconnectScanLoop = function () {};
  bi._presenceUntil = 0;

  // Instrumentar la entrada real de cada resultado de escaneo (proxy de la «tormenta de callbacks» nativa).
  let sawNexo = 0, sawNoise = 0;
  const origOSF = bi._onScanFound.bind(bi);
  bi._onScanFound = function (d, retried) {
    try { if (d && d.nexoId) sawNexo++; else sawNoise++; } catch (e) {}
    return origOSF(d, retried);
  };
  function quiet() {
    nA.scanningUntil = 0;
    if (nA._scanTick) { clearInterval(nA._scanTick); nA._scanTick = null; }
    if (nA._scanStopT) { clearTimeout(nA._scanStopT); nA._scanStopT = null; }
    bi.isScanning = false;
    if (bi._scanDeferTimer) { clearTimeout(bi._scanDeferTimer); bi._scanDeferTimer = null; }
    if (bi._userDeferTimer) { clearTimeout(bi._userDeferTimer); bi._userDeferTimer = null; }
  }
  function resetGate() { bi._scanStartTimes = []; bi._lastAutoScanAt = 0; bi._scanBlockedUntil = 0; bi._scanFailBackoff = 0; bi._scanUnsupported = false; if (bi._scanDeferTimer) { clearTimeout(bi._scanDeferTimer); bi._scanDeferTimer = null; } }

  // ---- BARRIDO DE CONCIERTO: N anunciantes de RUIDO (no-NEXO). Con el filtro NO deben llegar a la app; B sí, rápido.
  const sweep = [0, 500, 2000, 5000];
  r.concierto = [];
  for (const N of sweep) {
    radio.noiseAds = [];
    for (let i = 0; i < N; i++) {
      const h = (x) => (x & 0xff).toString(16).padStart(2, '0');
      radio.noiseAds.push({ address: 'CC:' + h(i) + ':' + h(Math.floor(rnd() * 256)) + ':' + h(i >> 8) + ':00:' + h(i), name: 'ruido-' + i, rssi: -60 - Math.floor(rnd() * 35) });
    }
    quiet(); resetGate();
    sawNexo = 0; sawNoise = 0; nA.stats.noiseDelivered = 0;
    bi._presenceUntil = Date.now() + 60000;
    bi._autoScanForKnownContacts();
    const ttd = await waitFor(() => sawNexo > 0, 4000);
    r.concierto.push({ N: N, ttd_ms: ttd, ruido_a_la_app: sawNoise, ruido_entregado_nativo: nA.stats.noiseDelivered || 0 });
    quiet(); await sleep(80);
  }
  radio.noiseAds = [];

  // Control: un escaneo SIN filtro SÍ entrega el ruido → prueba que el modelo lo entrega y que el FILTRO es lo que lo
  // bloquea (no que el ruido simplemente no exista).
  for (let i = 0; i < 300; i++) radio.noiseAds.push({ address: 'DD:00:00:00:00:' + (i & 0xff).toString(16).padStart(2, '0'), name: 'ctrl-' + i });
  nA.stats.noiseDelivered = 0;
  nA.plugin().startScan({ filtered: false });
  await sleep(250);
  r.control_sin_filtro_entrega_ruido = (nA.stats.noiseDelivered || 0) > 0;
  radio.noiseAds = []; quiet(); await sleep(80);

  // ---- COMPUERTA: nunca más de 5 arranques en 30 s. Con la ventana llena, el arranque del USUARIO se DIFIERE.
  resetGate();
  for (let i = 0; i < 4; i++) bi._noteScanStart();
  r.ventana_llena_tras_4 = bi._scanWindowFull() === true;
  r.espera_ms_positiva = (bi._scanWindowWaitMs() || 0) > 0;
  const scansAntes = nA.stats.scans || 0;
  bi.isScanning = false;
  await bi._executeToggleScan(); // ventana llena → debe DIFERIR (no arrancar nativo)
  await sleep(200);
  r.usuario_diferido_con_ventana_llena = (nA.stats.scans || 0) === scansAntes;
  quiet();

  // ---- RECUPERACIÓN ante onScanFailed
  // 3 = INTERNAL_ERROR → backoff corto y un reintento que SÍ arranca.
  resetGate(); bi._presenceUntil = Date.now() + 60000;
  nA.scanFailQueue = [3];
  const scans3 = nA.stats.scans || 0;
  bi._autoScanForKnownContacts();
  await sleep(120);
  r.fail3_backoff = (bi._scanFailBackoff || 0) > 0;
  r.fail3_reintenta = (await waitFor(() => (nA.stats.scans || 0) > scans3 + 1, 6000)) !== null;
  quiet();

  // 6 = SCANNING_TOO_FREQUENTLY → bloquea ~31 s, sin reintento inmediato.
  resetGate(); bi._presenceUntil = Date.now() + 60000;
  nA.scanFailQueue = [6];
  bi._autoScanForKnownContacts();
  await sleep(120);
  r.fail6_bloquea_30s = (bi._scanBlockedUntil || 0) > Date.now() + 29000;
  const scans6 = nA.stats.scans || 0;
  bi._autoScanForKnownContacts(); // debe estar bloqueado
  await sleep(120);
  r.fail6_no_reintenta_inmediato = (nA.stats.scans || 0) === scans6;
  quiet();

  // 4 = FEATURE_UNSUPPORTED → no reintentar en bucle.
  resetGate(); bi._presenceUntil = Date.now() + 60000;
  nA.scanFailQueue = [4];
  bi._autoScanForKnownContacts();
  await sleep(120);
  r.fail4_marca_unsupported = bi._scanUnsupported === true;
  const scans4 = nA.stats.scans || 0;
  bi._autoScanForKnownContacts();
  await sleep(120);
  r.fail4_no_mas_escaneos = (nA.stats.scans || 0) === scans4;
  quiet();

  // ---- INVARIANTES
  r.errores = logs.filter((l) => / error: /.test(l) && !/JSDOMERROR|styles\.css|Not implemented/.test(l)).slice(0, 5);
  const ttds = r.concierto.map((c) => c.ttd_ms).filter((x) => x !== null);
  const todosDescubren = r.concierto.every((c) => c.ttd_ms !== null);         // el conocido se descubre en todos los N
  const sinRuidoALaApp = r.concierto.every((c) => c.ruido_a_la_app === 0 && c.ruido_entregado_nativo === 0); // el filtro bloquea el ruido
  const ttdPlano = ttds.length === sweep.length && (Math.max.apply(null, ttds) - Math.min.apply(null, ttds) < 2500); // el TTD NO se dispara con N
  const ok = r.empareja === true && todosDescubren && sinRuidoALaApp && ttdPlano &&
    r.control_sin_filtro_entrega_ruido === true &&
    r.ventana_llena_tras_4 === true && r.espera_ms_positiva === true && r.usuario_diferido_con_ventana_llena === true &&
    r.fail3_backoff === true && r.fail3_reintenta === true &&
    r.fail6_bloquea_30s === true && r.fail6_no_reintenta_inmediato === true &&
    r.fail4_marca_unsupported === true && r.fail4_no_mas_escaneos === true &&
    r.errores.length === 0;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('VOPR ' + JSON.stringify(r));
  if (!ok) console.log('VOPR reproducir: node vopr.js <dir_build> --scenario=' + scenario + ' --seed=' + seed);
  fs.writeFileSync(path.join(__dirname, 'last_logs_vopr.txt'), logs.join('\n'));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error('FALLO:', e.stack); try { fs.writeFileSync(path.join(__dirname, 'last_logs_vopr.txt'), logs.join('\n')); } catch (x) {} process.exit(1); });
