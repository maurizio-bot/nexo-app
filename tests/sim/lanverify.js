// Diagnósticos del dueño (S24 09-11 13:42 y 15:57, builds 2975/2976): «Conexión con "nx1e29ab2f" sin comprobar: se cierra» y lo mismo
// con el vivo, SIEMPRE a los 30 s de conectarse por Wi-Fi, mientras un APK de 25 MB esperaba justamente la Wi-Fi para salir. La
// comprobación (nonce cifrado 'lv' → respuesta 'lw') la contesta el JS del otro teléfono: con su app dormida (pantalla apagada, WebView
// congelado) nadie contesta aunque su nativo tenga la conexión viva (latido con ida y vuelta). 2978: mientras el latido diga que el
// otro está vivo se espera hasta 3 min (sin usar el enlace) y a los 8 s se le manda un «toque» FCM para que despierte y conteste.
// Prueba: A y B por Bluetooth (claves intercambiadas); B se CONGELA; los dos entran a la misma Wi-Fi → A conecta, B no contesta.
// Antes: a los 30 s «sin comprobar: se cierra» y sin toque. Ahora: toque a los ~8 s, la conexión sigue; B despierta a los 40 s →
// contesta → «Conectado … (comprobado)» y una foto va por Wi-Fi.
// Uso: node lanverify.js <dir_build>
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone, installWebCrypto } = require('./native_mock');

const buildDir = path.resolve(process.argv[2]);
const base = { readsContentFallback: true, retain: ['onPayloadReceived', 'onLanMessage', 'onLanUp', 'onLanDown'], closeOnNoService: true, pace: [15, 15], ioDelay: 25, asymmetric: true, noL2: true, noTor: true };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
class DL extends ResourceLoader { constructor(d) { super(); this.d = d; } fetch(u) { const f = path.join(this.d, decodeURIComponent(new URL(u).pathname)); return fs.existsSync(f) ? Promise.resolve(fs.readFileSync(f)) : Promise.reject(new Error('x')); } }
const logs = [];
const T0 = Date.now();
const ts = () => String(((Date.now() - T0) / 1000).toFixed(1)).padStart(6) + 's';
async function boot(name, native) {
  const vc = new VirtualConsole();
  ['log', 'warn', 'error'].forEach((l) => vc.on(l, (...a) => logs.push(`${ts()} [${name}] ${l}: ` + a.map(String).join(' ').substring(0, 250))));
  const dom = new JSDOM(fs.readFileSync(path.join(buildDir, 'dist', 'index.html'), 'utf8'), {
    url: 'https://' + name.toLowerCase() + '.nexo.test/index.html', runScripts: 'dangerously', resources: new DL(path.join(buildDir, 'dist')), pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) { win.CapacitorCustomPlatform = { name: 'android' }; installWebCrypto(win); win.Capacitor = { Plugins: { NexoBLE: native.plugin() } }; win.HTMLElement.prototype.scrollTo = function () {}; },
  });
  const win = dom.window;
  for (let i = 0; i < 100 && !(win.NEXO && win.NEXO.initialized); i++) await sleep(100);
  await sleep(800);
  return { name, native, win };
}
const click = (w, el) => el && el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
async function openChatWith(p, name) {
  let row; for (let i = 0; i < 300 && !row; i++) { row = Array.from(p.win.document.querySelectorAll('#main-contacts-list .ble-contact-row')).find((r) => (r.querySelector('.ble-contact-name') || {}).textContent === name); if (!row) await sleep(100); }
  click(p.win, row); await sleep(400); return !!row;
}
function sendText(p, t) { const i = p.win.document.getElementById('message-input'); i.value = t; i.dispatchEvent(new p.win.Event('input', { bubbles: true })); click(p.win, p.win.document.getElementById('send-btn')); }
const rnd = (n, s) => { const b = Buffer.alloc(n); for (let i = 0; i < n; i++) b[i] = (i * 7919 + s) & 255; return b; };
function sendFile(p, name, type, bytes) {
  click(p.win, p.win.document.querySelector('.attach-menu-item[data-type="file"]'));
  const fin = Array.from(p.win.document.querySelectorAll('input[type=file]')).pop();
  Object.defineProperty(fin, 'files', { value: [new p.win.File([bytes], name, { type })], configurable: true }); fin.dispatchEvent(new p.win.Event('change'));
}
async function addFound(p, name) {
  let add = null;
  const find = () => { const row = Array.from(p.win.document.querySelectorAll('#ble-new-device > div')).find((d) => (d.querySelector('span') || {}).textContent === name); return row && row.querySelector('button'); };
  for (let i = 0; i < 400 && !add; i++) { await sleep(100); add = find(); if (!add && !p.win.bleInterface.isScanning) click(p.win, p.win.document.getElementById('ble-scan-btn')); }
  click(p.win, add); await sleep(2000);
  return !!add;
}
async function waitFor(fn, ms) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return Math.round((Date.now() - t0) / 100) / 10; await sleep(200); } return null; }

(async () => {
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', Object.assign({}, base)), nB = new NativePhone('B', 'BB:BB:BB:BB:BB:02', Object.assign({}, base));
  [nA, nB].forEach((n) => { radio.add(n); n.load(); });
  const A = await boot('A', nA), B = await boot('B', nB);
  const biA = A.win.bleInterface, idA = biA.localNexoId.toLowerCase(), idB = B.win.bleInterface.localNexoId.toLowerCase();
  const r = { prueba: 'lanverify', build: path.basename(buildDir) };

  // Se conocen por Bluetooth (claves) y se saludan
  biA.togglePanel(); const paired = await addFound(A, 'B'); biA.togglePanel();
  if (!paired) { console.log('LANVERIFY ' + JSON.stringify(Object.assign(r, { resultado: 'FALLO', error: 'no empareja' }))); process.exit(1); }
  await openChatWith(A, 'B'); sendText(A, 'hola B'); await sleep(1200);
  await openChatWith(B, 'A'); sendText(B, 'hola A'); await sleep(1200);
  r.emparejados_s = await waitFor(async () => (await B.win.vaultLoadMessages(idA)).some((m) => m.content === 'hola B'), 30000);

  // Espía del «toque» FCM (sin relés en esta prueba: se cuenta la decisión)
  const wakes = [];
  if (biA.net) biA.net.wakeFor = function (nx) { wakes.push(String(nx)); return true; };

  // B se DUERME (su JS no contesta nada) y los dos entran a la misma Wi-Fi: A conecta, manda la comprobación y nadie contesta
  nB.setFrozen(true);
  const tWifi = Date.now();
  nA.setWifi('casa'); nB.setWifi('casa');
  r.wifi_conectada_s = await waitFor(() => { const l = biA.lan && biA.lan.links && biA.lan.links.get(idB); return !!(l && l.up); }, 30000);
  r.toque_s = await waitFor(() => wakes.some((w) => w === idB), 20000);                      // antes: null (no se tocaba)
  // A los 35 s la conexión sigue (antes: «sin comprobar: se cierra» a los 30 s)
  while (Date.now() - tWifi < 35000) await sleep(500);
  r.cerrada_a_los_30 = logs.some((l) => /\[A\].*sin comprobar: se cierra/.test(l));
  r.sigue_conectada_a_los_35 = !!(biA.lan.links.get(idB) && biA.lan.links.get(idB).up) && !r.cerrada_a_los_30;
  r.no_es_camino_sin_comprobar = !biA.lan.canReach(idB);

  // B despierta (contesta la comprobación pendiente) → Wi-Fi comprobada y una foto va por Wi-Fi
  nB.setFrozen(false);
  r.comprobada_s = await waitFor(() => biA.lan.canReach(idB), 40000);
  await openChatWith(A, 'B'); sendFile(A, 'foto.jpg', 'image/jpeg', rnd(300 * 1024, 3));
  r.foto_llega_s = await waitFor(async () => (await B.win.vaultLoadMessages(idA)).some((m) => m.attachmentType && !m._own), 60000);
  r.foto_por_wifi = logs.some((l) => /\[A\].*sendFile START.*to=lan/.test(l));

  r.errores = logs.filter((l) => / error: /.test(l) && !/JSDOMERROR|styles\.css|Not implemented|GLOBAL TIMEOUT|net::ERR|fetch/.test(l)).slice(0, 5);
  const ok = r.emparejados_s !== null && r.wifi_conectada_s !== null && r.toque_s !== null && !r.cerrada_a_los_30 && r.sigue_conectada_a_los_35 && r.no_es_camino_sin_comprobar &&
    r.comprobada_s !== null && r.foto_llega_s !== null && r.foto_por_wifi && !r.errores.length;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('LANVERIFY ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_lanverify.txt'), logs.join('\n'));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('LANVERIFY ' + JSON.stringify({ prueba: 'lanverify', resultado: 'FALLO', error: String(e && e.message).replace(/"/g, "'") })); console.error(e && e.stack); fs.writeFileSync(path.join(__dirname, 'last_logs_lanverify.txt'), logs.join('\n')); process.exit(1); });
