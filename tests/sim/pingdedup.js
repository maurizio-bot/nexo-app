// 3172 (diag. automático S23 nx1e50c95d 3170 27-11 16:33, zombi falso con el HONOR Magic5 lite): al volver a la app, el ping del enlace
// recuperado («sin comprobar») y el Dedup salieron en el mismo milisegundo; el Dedup cerró ese enlace por repetido, el ping falló por
// eso y se tomó por «medio muerto» → «sin respuesta a 4 pings» y un diagnóstico automático de zombi que no lo era.
// Debe: un ping que falla en un enlace que YO acabo de cerrar por repetido no cuenta (ni «medio muerto» ni síntoma zombi).
// Control: el mismo fallo en un enlace recuperado que NO cerré yo sí se rehace (la detección real sigue).
// Uso: node pingdedup.js <dir_build>
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
  const r = { prueba: 'pingdedup', build: path.basename(buildDir) };
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', base), nB = new NativePhone('B', 'BB:BB:BB:BB:BB:02', base);
  [nA, nB].forEach((n) => { radio.add(n); n.load(); });
  const A = await boot('A', nA); const B = await boot('B', nB);
  const biA = A.win.bleInterface, idB = B.win.bleInterface.localNexoId.toLowerCase();
  const sintomas = []; A.win.addEventListener('nexo:diag:symptom', (e) => sintomas.push(e.detail && e.detail.kind));
  biA.togglePanel(); const paired = await addFound(A, 'B'); if (A.win.document.getElementById('ble-panel').classList.contains('active')) biA.togglePanel();
  if (!paired) { console.log('PINGDEDUP ' + JSON.stringify(Object.assign(r, { resultado: 'FALLO', error: 'no empareja' }))); process.exit(1); }
  await openChatWith(A, 'B'); sendText(A, 'hola B'); await sleep(4000);
  r.enlace_bt = esBt(biA.linkOf(idB));
  const dev = Array.from(biA.connectedDevices.keys())[0];
  const norm = (m) => String(m).replace(/:/g, '').toLowerCase();
  const oPing = biA._pingDevice.bind(biA); let falla = 0;
  biA._pingDevice = (d) => { if (falla > 0) { falla--; return Promise.reject(new Error('Write failed')); } return oPing(d); };
  // 1) Como en el S23: enlace recuperado sin comprobar que el Dedup acaba de cerrar; su ping falla
  const m0 = logs.length;
  biA._unverified = biA._unverified || new Map(); biA._unverified.set(dev, Date.now() - 10); biA._lastPongTime.set(dev, 1);
  biA._dupClosedAt = biA._dupClosedAt || new Map(); biA._dupClosedAt.set(norm(dev), Date.now());
  falla = 1; biA._runSupervisorCycle(); await sleep(1500);
  r.no_cuenta = desde(m0, /Ping a .* ya lo cerré yo \(repetido\) o ya no está: no cuenta/).length > 0;
  r.zombi_falso = desde(m0, /medio muerto/).length > 0 || desde(m0, ZOMBI_RE).length > 0 || sintomas.includes('zombi');
  // 2) Control: el mismo fallo sin haberlo cerrado yo sí se toma por medio muerto (la detección real sigue)
  biA._dupClosedAt.delete(norm(dev)); biA._pingInFlight && biA._pingInFlight.delete(dev);
  const m1 = logs.length; biA._unverified.set(dev, Date.now() - 10); biA._lastPongTime.set(dev, 1);
  falla = 1; biA._runSupervisorCycle(); await sleep(1500);
  r.control_rehace = desde(m1, /medio muerto/).length > 0;
  r.errores = logs.filter((l) => / error: /.test(l) && !/JSDOMERROR|styles\.css|Not implemented|GLOBAL TIMEOUT|net::ERR|fetch/.test(l)).slice(0, 5);
  const ok = r.enlace_bt && r.no_cuenta && !r.zombi_falso && r.control_rehace && !r.errores.length;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('PINGDEDUP ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_pingdedup.txt'), logs.join('\n'));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('PINGDEDUP ' + JSON.stringify({ prueba: 'pingdedup', resultado: 'FALLO', error: String(e && e.message) })); fs.writeFileSync(path.join(__dirname, 'last_logs_pingdedup.txt'), logs.join('\n')); process.exit(1); });
