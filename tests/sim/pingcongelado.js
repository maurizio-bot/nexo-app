// 3340 (diag. S24 3154 25-11 13:53, Marcos): un ping del vigilante salió justo antes de que el teléfono congelara la app (1 h en segundo
// plano); su plazo venció al volver y se tomó por «sin respuesta al primer ping» del enlace recién recuperado: a los 0,6 s se rehizo un
// enlace sano y un archivo de 358 trozos volvió a empezar. Ahora un ping que tardó mucho más que su plazo no cuenta.
// A y B sanos por Bluetooth; el ping de A queda «en vuelo» 35 s mientras A está 30 s en segundo plano con el JS parado; A vuelve.
// Debe: el ping viejo no cuenta, el enlace NO se rehace, sigue por Bluetooth. Contraprueba: el código anterior lo rehace.
// Uso: node pingcongelado.js <dir_build>
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone, installWebCrypto } = require('./native_mock');

const buildDir = path.resolve(process.argv[2] || path.join(__dirname, 'builds/wip'));
// appStateEvents: el Kotlin de ahora avisa al JS de la vuelta (onAppStateChange) además de la visibilidad del WebView
const base = { readsContentFallback: true, retain: ['onPayloadReceived', 'onLanMessage', 'onLanUp', 'onLanDown'], closeOnNoService: true, pace: [15, 15], ioDelay: 25, asymmetric: true, noTor: true, wifi: null, appStateEvents: true };
// La tableta dormida: con la app congelada su nativo NO contesta nada (ni el pong de la 3009, ni «quién soy», ni el ✓✓ de respaldo)
const tableta = { noNativePong: true, noNativeKx: true, noBgNotify: true };
const ZOMBI_MAX_S = 25; // 3330 (S24↔Austin 24-11): el enlace recuperado sin oír nada se comprueba ya y con un ping sin respuesta se rehace (antes 60: 4 pings)
const LARGO_MS = 25000;   // «las 5 h» en segundo plano con el JS parado (basta con que el enlace y el último pong sean viejos)
// Idas y vueltas del dueño (diagnóstico S24 3082): segundos desde la primera vuelta (04:02:57)
const RITMO = [[0, true], [14, false], [34, true], [49, false], [66, true], [95, false]];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
class DL extends ResourceLoader { constructor(d) { super(); this.d = d; } fetch(u) { const f = path.join(this.d, decodeURIComponent(new URL(u).pathname)); return fs.existsSync(f) ? Promise.resolve(fs.readFileSync(f)) : Promise.reject(new Error('x')); } }
const logs = [];
const T0 = Date.now();
const ts = () => String(((Date.now() - T0) / 1000).toFixed(1)).padStart(6) + 's';
async function boot(name, native) {
  native.listeners = new Map();
  native.calls = { push() {}, length: 0, filter() { return []; }, slice() { return []; }, forEach() {}, map() { return []; }, some() { return false; }, find() { return undefined; } };
  const vc = new VirtualConsole();
  ['log', 'warn', 'error'].forEach((l) => vc.on(l, (...a) => logs.push(`${ts()} [${name}] ${l}: ` + a.map(String).join(' ').substring(0, 260))));
  let vis = 'visible';
  const dom = new JSDOM(fs.readFileSync(path.join(buildDir, 'dist', 'index.html'), 'utf8'), {
    url: 'https://' + name.toLowerCase() + '.nexo.test/index.html', runScripts: 'dangerously', resources: new DL(path.join(buildDir, 'dist')), pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) {
      win.NEXO_NET_RELAYS = []; win.CapacitorCustomPlatform = { name: 'android' }; installWebCrypto(win);
      win.Capacitor = { Plugins: { NexoBLE: native.plugin() } }; win.HTMLElement.prototype.scrollTo = function () {};
      Object.defineProperty(win.document, 'visibilityState', { configurable: true, get: () => vis });
      Object.defineProperty(win.document, 'hidden', { configurable: true, get: () => vis === 'hidden' });
    },
  });
  const win = dom.window;
  for (let i = 0; i < 100 && !(win.NEXO && win.NEXO.initialized); i++) await sleep(100);
  await sleep(800);
  const p = { name, native, win };
  // Segundo plano / volver: el WebView cambia la visibilidad y el nativo avisa (onAppStateChange)
  p.setActive = (on) => { vis = on ? 'visible' : 'hidden'; win.document.dispatchEvent(new win.Event('visibilitychange')); native.setAppActive(on); };
  // JS parado (WebView congelado): su vigilante no corre
  p.stopSup = () => { const bi = win.bleInterface; win.clearInterval(bi._supervisorTimer); bi._supervisorTimer = null; };
  p.startSup = () => { const bi = win.bleInterface; if (!bi._supervisorTimer) bi._supervisorTimer = win.setInterval(() => bi._runSupervisorCycle(), bi._supervisorIntervalMs); };
  return p;
}
const click = (win, el) => el && el.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
async function openChatWith(p, name) {
  let row; for (let i = 0; i < 200 && !row; i++) { row = Array.from(p.win.document.querySelectorAll('#main-contacts-list .ble-contact-row')).find((r) => (r.querySelector('.ble-contact-name') || {}).textContent === name); if (!row) await sleep(100); }
  click(p.win, row); await sleep(500); return !!row;
}
function sendText(p, t) { const i = p.win.document.getElementById('message-input'); i.value = t; i.dispatchEvent(new p.win.Event('input', { bubbles: true })); click(p.win, p.win.document.getElementById('send-btn')); }
async function addFound(p, name) {
  let add = null;
  const find = () => { const row = Array.from(p.win.document.querySelectorAll('#ble-new-device > div')).find((d) => (d.querySelector('span') || {}).textContent === name); return row && row.querySelector('button'); };
  for (let i = 0; i < 400 && !add; i++) { await sleep(100); add = find(); if (!add && !p.win.bleInterface.isScanning) click(p.win, p.win.document.getElementById('ble-scan-btn')); }
  click(p.win, add); await sleep(2000);
  return !!add;
}
async function waitFor(fn, ms) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return Math.round((Date.now() - t0) / 100) / 10; await sleep(250); } return null; }
const ZOMBI_RE = /\[A\] warn: \[BLEInterface\] Enlace \S+ sin respuesta a \d+ pings: desconectado para reconectar/;
const desde = (mark, re) => logs.slice(mark).filter((l) => re.test(l));
const esBt = (l) => /bluetooth|ble/i.test(String(l || ''));
// Idas y vueltas de A al ritmo del dueño; para en cuanto alto() diga que ya basta
async function idasYVueltas(A, alto) {
  const t0 = Date.now();
  for (const [s, on] of RITMO) {
    while (Date.now() - t0 < s * 1000) { if (alto()) return; await sleep(100); }
    if (alto()) return;
    A.setActive(on);
  }
}

(async () => {
  const r = { prueba: 'pingcongelado', build: path.basename(buildDir) };
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', base), nB = new NativePhone('B', 'BB:BB:BB:BB:BB:02', base);
  [nA, nB].forEach((n) => { radio.add(n); n.load(); });
  const A = await boot('A', nA); const B = await boot('B', nB);
  const biA = A.win.bleInterface, idB = B.win.bleInterface.localNexoId.toLowerCase();
  biA.togglePanel(); const paired = await addFound(A, 'B'); if (A.win.document.getElementById('ble-panel').classList.contains('active')) biA.togglePanel();
  if (!paired) { console.log('PINGCONGELADO ' + JSON.stringify(Object.assign(r, { resultado: 'FALLO', error: 'no empareja' }))); process.exit(1); }
  await openChatWith(A, 'B'); sendText(A, 'hola B'); await sleep(4000);
  r.enlace_bt = esBt(biA.linkOf(idB));
  const dev = Array.from(biA.connectedDevices.keys())[0];
  // Un ping sale justo antes de que el teléfono congele la app: su plazo vence al volver (35 s después de salir)
  const oPing = biA._pingDevice.bind(biA); let stale = true;
  biA._pingDevice = (d) => { if (stale) { stale = false; return new Promise((_, rej) => setTimeout(() => rej(new Error('Ping timeout')), 35000)); } return oPing(d); };
  biA._lastPongTime.set(dev, 1); biA._runSupervisorCycle();
  const m0 = logs.length;
  A.setActive(false); A.stopSup(); await sleep(30000);
  A.setActive(true); A.startSup();   // vuelve: el enlace queda «sin comprobar» y en ese momento vence el ping viejo
  // como en el teléfono: con la app congelada no se oyó nada de B desde antes (en jsdom el JS de A sí corría)
  await sleep(1500);
  biA._unverified = biA._unverified || new Map(); biA._unverified.set(dev, Date.now()); biA._lastPongTime.set(dev, 1);
  await sleep(23500);
  r.ping_viejo_no_cuenta = desde(m0, /\[A\] log: \[BLEInterface\] Ping a .* de antes de congelarse la app: no cuenta/).length > 0;
  r.rehecho_sin_motivo = desde(m0, /\[A\] warn: \[BLEInterface\] Enlace recuperado .* sin respuesta al primer ping/).length > 0 || desde(m0, ZOMBI_RE).length > 0;
  r.enlace_sigue = esBt(biA.linkOf(idB));
  r.errores = logs.filter((l) => / error: /.test(l) && !/JSDOMERROR|styles\.css|Not implemented|GLOBAL TIMEOUT|net::ERR|fetch/.test(l)).slice(0, 5);
  const ok = r.enlace_bt && r.ping_viejo_no_cuenta && !r.rehecho_sin_motivo && r.enlace_sigue && !r.errores.length;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('PINGCONGELADO ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_pingcongelado.txt'), logs.join('\n'));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('PINGCONGELADO ' + JSON.stringify({ prueba: 'pingcongelado', resultado: 'FALLO', error: String(e && e.message) })); fs.writeFileSync(path.join(__dirname, 'last_logs_pingcongelado.txt'), logs.join('\n')); process.exit(1); });
