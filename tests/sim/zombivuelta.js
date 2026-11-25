// 3187 (diagnóstico automático S24 3082 17-11 04:04, zombi con la tableta): la tableta se durmió a las 23:07 con un enlace Bluetooth
// abierto con el S24 y quedó congelada del todo (tampoco su nativo contestaba los pings). Al volver el dueño a la app (04:02:57) el
// S24 tardó 104 s y 9 pings en dar el enlace por muerto («sin respuesta a 2 pings: desconectado para reconectar» a las 04:04:40):
// entró y salió de la app 3 veces y en CADA vuelta la limpieza de estados viejos (_cleanupStaleStates) borraba, con el estado del
// enlace, la cuenta de pings sin respuesta y el último pong; _seedNativeConnections lo recuperaba como listo («Conexión existente
// recuperada al arrancar») y el vigilante volvía a contar desde 0 (hacen falta _pingMaxFails = 4 seguidos). Dos teléfonos por
// Bluetooth (sin Wi-Fi ni internet), A con las idas y vueltas del dueño (vuelve 0 s, sale 14, vuelve 34, sale 49, vuelve 66, sale 95):
//  S  enlace SANO (B despierta, contesta los pings): las mismas idas y vueltas NO dan zombi y el enlace sigue por Bluetooth.
//  Z  B dormida del todo (JS y nativo: no sale nada de ella) y A 25 s en segundo plano con su JS parado (las 5 h del teléfono): desde
//     la primera vuelta, A da el enlace por muerto en ≤ 60 s (4 pings: el primero ≤ 6 s tras volver —ciclo del vigilante— y cada
//     uno caduca a los 8 s y el siguiente sale en el ciclo de después, ~12 s → ~50 s; 10 s de margen). Contraprueba b3186z: ~110 s
//     y 9 pings (la tercera vuelta, a los 66 s, vuelve a poner la cuenta a 0), como en el teléfono.
//  R  B despierta: el enlace se rehace y un texto de A llega (lo de arriba no estorba la recuperación).
// Uso: node zombivuelta.js <dir_build>
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
  const r = { prueba: 'zombivuelta', build: path.basename(buildDir) };
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', base), nB = new NativePhone('B', 'BB:BB:BB:BB:BB:02', Object.assign({}, base, tableta));
  [nA, nB].forEach((n) => { radio.add(n); n.load(); });
  const A = await boot('A', nA); const B = await boot('B', nB);
  const biA = A.win.bleInterface;
  const idA = biA.localNexoId.toLowerCase(), idB = B.win.bleInterface.localNexoId.toLowerCase();
  // pings del vigilante de A (todos van a B: es su único enlace) y cuántos volvieron
  let pings = 0, pongs = 0;
  const oPing = biA._pingDevice.bind(biA);
  biA._pingDevice = (d) => { pings++; return oPing(d).then((x) => { pongs++; return x; }); };
  biA.togglePanel(); const paired = await addFound(A, 'B'); if (A.win.document.getElementById('ble-panel').classList.contains('active')) biA.togglePanel();
  if (!paired) { console.log('ZOMBIVUELTA ' + JSON.stringify(Object.assign(r, { resultado: 'FALLO', error: 'no empareja' }))); process.exit(1); }
  await openChatWith(A, 'B'); sendText(A, 'hola B'); await sleep(2000);
  await openChatWith(B, 'A'); sendText(B, 'hola A');
  r.emparejados_s = await waitFor(async () => (await A.win.vaultLoadMessages(idB)).some((m) => !m._own && m.content === 'hola A'), 30000);
  r.enlace_bt = esBt(biA.linkOf(idB));
  await sleep(3000);

  // ===== S: enlace SANO con las mismas idas y vueltas → sin zombi =====
  const mS = logs.length, pS = pings, poS = pongs;
  A.setActive(false); A.stopSup(); await sleep(LARGO_MS);
  A.startSup(); await idasYVueltas(A, () => false); await sleep(20000);
  r.S_vueltas = desde(mS, /\[A\] log: \[BLEInterface\] App de vuelta en primer plano/).length;
  r.S_recuperadas = desde(mS, /\[A\] log: \[BLEInterface\] Conexión existente recuperada al arrancar/).length;
  r.S_pings = pings - pS; r.S_pongs = pongs - poS;
  r.S_zombi = desde(mS, ZOMBI_RE).length > 0;
  r.S_enlace = String(biA.linkOf(idB));
  A.setActive(true); await sleep(3000);

  // ===== Z: B dormida del todo; A vuelve de un segundo plano largo y entra y sale como el dueño =====
  // B: su JS no corre (vigilante parado, lo que llega espera en el nativo) y NADA sale de ella (en jsdom sus temporizadores siguen
  // corriendo: se tragan sus envíos, como un nativo que acepta escrituras con la app congelada); su nativo no contesta (tableta)
  const plugB = B.win.Capacitor.Plugins.NexoBLE, oSendB = plugB.sendMessage, oBinB = plugB.sendBinary;
  B.setActive(false); B.stopSup();
  plugB.sendMessage = () => Promise.resolve({ success: true }); if (oBinB) plugB.sendBinary = () => Promise.resolve({ success: true });
  nB.setFrozen(true);
  A.setActive(false); A.stopSup(); await sleep(LARGO_MS);
  const mZ = logs.length, pZ = pings, poZ = pongs;
  const zombi = () => desde(mZ, ZOMBI_RE).length > 0;
  const t0 = Date.now();
  A.startSup();
  const ritmo = idasYVueltas(A, zombi);
  r.Z_zombi_s = await waitFor(zombi, 200000);
  if (r.Z_zombi_s !== null) {
    const l = desde(mZ, ZOMBI_RE)[0];
    r.Z_zombi_s = Math.round((parseFloat(l) - (t0 - T0) / 1000) * 10) / 10;   // desde la primera vuelta, por la hora del registro
    r.Z_texto = l.replace(/^.*\[BLEInterface\] /, '');
  }
  await ritmo;
  const hasta = r.Z_zombi_s !== null ? logs.slice(mZ).findIndex((x) => ZOMBI_RE.test(x)) + mZ : logs.length;
  const antes = (re) => logs.slice(mZ, hasta).filter((x) => re.test(x)).length;
  r.Z_vueltas_antes_del_zombi = antes(/\[A\] log: \[BLEInterface\] App de vuelta en primer plano/);
  r.Z_recuperadas_antes_del_zombi = antes(/\[A\] log: \[BLEInterface\] Conexión existente recuperada al arrancar/);
  r.Z_pings_sin_respuesta = pings - pZ; r.Z_pongs = pongs - poZ;

  // ===== R: B despierta → el enlace se rehace y un texto de A llega =====
  plugB.sendMessage = oSendB; if (oBinB) plugB.sendBinary = oBinB;
  nB.setFrozen(false); B.setActive(true); B.startSup();
  A.setActive(true); await sleep(3000);
  await openChatWith(A, 'B'); sendText(A, 'tras despertar');
  r.R_texto_llega_s = await waitFor(async () => (await B.win.vaultLoadMessages(idA)).some((m) => !m._own && m.content === 'tras despertar'), 90000);
  r.R_enlace = String(biA.linkOf(idB));

  r.errores = logs.filter((l) => / error: /.test(l) && !/JSDOMERROR|styles\.css|Not implemented|GLOBAL TIMEOUT|net::ERR|fetch/.test(l)).slice(0, 5);
  const ok = r.enlace_bt && !r.S_zombi && esBt(r.S_enlace) && r.S_vueltas >= 3 && r.S_recuperadas >= 3 && r.S_pongs > 0 &&
    r.Z_zombi_s !== null && r.Z_zombi_s <= ZOMBI_MAX_S && r.R_texto_llega_s !== null && !r.errores.length;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('ZOMBIVUELTA ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_zombivuelta.txt'), logs.join('\n'));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('ZOMBIVUELTA ' + JSON.stringify({ prueba: 'zombivuelta', resultado: 'FALLO', error: String(e && e.message).replace(/"/g, "'") })); console.error(e && e.stack); fs.writeFileSync(path.join(__dirname, 'last_logs_zombivuelta.txt'), logs.join('\n')); process.exit(1); });
