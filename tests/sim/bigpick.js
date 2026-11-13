// Dueño 13-11 02:10 (S24 → vivo por Bluetooth, los dos con Wi-Fi Direct; APK de 25 MB): «nunca se activó Wi-Fi Direct».
// Al volver del selector de archivos la app limpia los estados de enlace con > 10 s (_cleanupStaleStates) y los rehace un
// instante después («Conexión existente recuperada»); el archivo elegido caía en ese hueco: «sin camino local» → se leía
// entero (35 MB) y quedaba ⏳ «esperan Wi-Fi/internet» aunque el Wi-Fi Direct funcionara (el vivo recibió un respaldo de
// 384 KB por Wi-Fi Direct ese mismo minuto). Prueba: A y B con Wi-Fi Direct, enlace listo hace > 10 s; A abre el selector,
// la app sale y vuelve, y el archivo (8 MB) se elige justo en el hueco: tiene que salir como ARCHIVO GRANDE (Wi-Fi Direct)
// y llegar; nunca «Payload demasiado grande» ni leído entero. Contraprueba 3048: queda ⏳ / «demasiado grande».
// Uso: node bigpick.js <build>
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone } = require('./native_mock');

const buildDir = path.resolve(process.argv[2]);
const WD = true, L2 = false; // siempre Wi-Fi Direct (el caso del dueño)
// --b-no-l2: solo Bluetooth, A con L2CAP y B sin (Android 9): no hay camino, como --no-route
const B_NO_L2 = process.argv.includes('--b-no-l2'), NOROUTE = process.argv.includes('--no-route') || B_NO_L2;
const MB = 24; // > ~22 MB: no cabe como adjunto por Wi-Fi Direct; tiene que ir como ARCHIVO GRANDE (como el APK del dueño)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
class DL extends ResourceLoader { constructor(d) { super(); this.d = d; } fetch(u) { const f = path.join(this.d, decodeURIComponent(new URL(u).pathname)); return fs.existsSync(f) ? Promise.resolve(fs.readFileSync(f)) : Promise.reject(new Error('x')); } }
const logs = [];
async function boot(name, address, radio) {
  const o = { appStateEvents: true, connectedDelayMs: name === 'A' ? 400 : 0, readsContentFallback: true, mtu: 512, pace: [15, 15], retain: ['onPayloadReceived', 'onLanMessage', 'onLanUp', 'onLanDown', 'onBigDone'], asymmetric: true };
  if (!NOROUTE && !WD && !L2) o.wifi = 'casa';
  if (WD) o.wifiDirect = true;
  if (NOROUTE && (!B_NO_L2 || name === 'B')) o.noL2 = true;
  const native = new NativePhone(name, address, o);
  radio.add(native); native.load();
  const vc = new VirtualConsole(); ['log', 'info', 'warn', 'error'].forEach((l) => vc.on(l, (...a) => logs.push(`[${name}] ${l}: ` + a.map(String).join(' ').substring(0, 250))));
  const dom = new JSDOM(fs.readFileSync(path.join(buildDir, 'dist', 'index.html'), 'utf8'), { url: 'https://' + name.toLowerCase() + '.nexo.test/index.html', runScripts: 'dangerously', resources: new DL(path.join(buildDir, 'dist')), pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) { win.CapacitorCustomPlatform = { name: 'android' }; require('./native_mock').installWebCrypto(win); win.Capacitor = { Plugins: { NexoBLE: native.plugin() } }; win.HTMLElement.prototype.scrollTo = function () {}; } });
  const win = dom.window; for (let i = 0; i < 100 && !(win.NEXO && win.NEXO.initialized); i++) await sleep(100); await sleep(800);
  return { name, native, win };
}
const click = (w, el) => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
async function openChat(p) { let row; for (let i = 0; i < 300 && !row; i++) { row = p.win.document.querySelector('#main-contacts-list .ble-contact-row'); if (!row) await sleep(100); } click(p.win, row); await sleep(300); }
async function sendText(p, t) { const i = p.win.document.getElementById('message-input'); i.value = t; i.dispatchEvent(new p.win.Event('input', { bubbles: true })); click(p.win, p.win.document.getElementById('send-btn')); }
async function sendFile(p, name, type, bytes) {
  click(p.win, p.win.document.querySelector('.attach-menu-item[data-type="file"]')); await sleep(100);
  const fin = Array.from(p.win.document.querySelectorAll('input[type=file]')).pop();
  Object.defineProperty(fin, 'files', { value: [new p.win.File([bytes], name, { type })] }); fin.dispatchEvent(new p.win.Event('change'));
}
const card = (p, label, own) => Array.from(p.win.document.querySelectorAll('#messages-container .message' + (own ? '.own' : ':not(.own)'))).map((m) => m.querySelector('.file-attachment')).find((c) => c && c.textContent.indexOf(label) >= 0);
const sub = (c) => (c && c.querySelector('.file-sub') || {}).textContent || '';
const got = (p, label) => !!card(p, label, false) || Array.from(p.win.document.querySelectorAll('#messages-container .message:not(.own)')).some((m) => m.textContent.indexOf(label) >= 0);
const rnd = (n, s) => { const b = Buffer.alloc(n); for (let i = 0; i < n; i++) b[i] = (i * 7919 + s) & 255; return b; };
const wait = async (c, s) => { for (let i = 0; i < s * 5 && !c(); i++) await sleep(200); return !!c(); };

(async () => {
  const radio = new Radio();
  const [A, B] = await Promise.all([boot('A', 'AA:AA:AA:AA:AA:01', radio), boot('B', 'BB:BB:BB:BB:BB:02', radio)]);
  A.win.bleInterface.togglePanel(); let add = null;
  for (let i = 0; i < 400 && !add; i++) { await sleep(100); add = A.win.document.querySelector('#ble-new-device > div button'); if (!add && !A.win.bleInterface.isScanning) click(A.win, A.win.document.getElementById('ble-scan-btn')); }
  click(A.win, add); await sleep(1500);
  if (A.win.document.getElementById('ble-panel').classList.contains('active')) A.win.bleInterface.togglePanel();
  await openChat(A); await sendText(A, 'hola'); await sleep(3000); await openChat(B); await sleep(500);
  const nxB = B.win.bleInterface.localNexoId;
  const r = { prueba: 'bigpick', build: path.basename(buildDir) };
  r.camino_antes_s = await wait(() => !!A.win.bleInterface.bigFiles.route(nxB), 40) ? A.win.bleInterface.bigFiles.route(nxB) : null;
  // el enlace lleva más de 10 s listo (como en el teléfono: a la vuelta, _cleanupStaleStates lo da por viejo)
  await sleep(12000);
  // A abre el selector de archivos, la app sale a segundo plano y vuelve, y el archivo se elige EN EL HUECO
  const big = rnd(MB * 1024 * 1024, 5), sha = crypto.createHash('sha256').update(big).digest('hex');
  const nLog = logs.length;
  click(A.win, A.win.document.querySelector('.attach-menu-item[data-type="file"]')); await sleep(100);
  const fin = Array.from(A.win.document.querySelectorAll('input[type=file]')).pop();
  A.native.setAppActive(false); await sleep(300);
  A.native.setAppActive(true);
  // el orden del teléfono del dueño: vuelve → limpia los estados viejos → SE ELIGE el archivo → se rehace el enlace
  for (let i = 0; i < 150 && !logs.slice(nLog).some((l) => /\[A\].*Cleanup stale states/.test(l)); i++) await sleep(10);
  r.elegido_en_el_hueco = !logs.slice(nLog).some((l) => /\[A\].*Conexión existente recuperada/.test(l));
  Object.defineProperty(fin, 'files', { value: [new A.win.File([big], 'nexo-3034.apk', { type: 'application/vnd.android.package-archive' })] }); fin.dispatchEvent(new A.win.Event('change'));
  const desde = () => logs.slice(nLog);
  r.limpia_al_volver = desde().some((l) => /\[A\].*Cleanup stale states/.test(l));
  r.grande_llega = await wait(() => /Toca para abrir/.test(sub(card(B, 'nexo-3034', false))), 120);
  r.demasiado_grande = desde().some((l) => /\[A\].*(Payload demasiado grande|Archivo demasiado grande|no caben por Bluetooth)/.test(l));
  r.por_wifi_direct = A.native.calls.some((c) => c.name === 'wifiDirectSend');
  r.nunca_entero = (A.native.stats.bigMaxSlice || 0) <= 700 * 1024;
  const cb = card(B, 'nexo-3034', false); if (cb) click(B.win, cb); await sleep(1000);
  const ob = (B.native.opened || []).find((o) => o.big);
  r.identico = !!(ob && ob.sha === sha);
  r.espera_log = desde().filter((l) => /\[A\].*\[ATTACH\].*(espero|Camino para el archivo grande|no volvió)/.test(l)).map((l) => l.replace(/^.*\[ATTACH\] /, '')).slice(0, 2);
  r.errores = logs.filter((l) => / error: /.test(l) && !/JSDOMERROR|styles\.css/.test(l)).slice(0, 5);
  const ok = !!r.camino_antes_s && r.limpia_al_volver && r.elegido_en_el_hueco && r.espera_log.length > 0 && r.grande_llega && !r.demasiado_grande && r.por_wifi_direct && r.nunca_entero && r.identico && !r.errores.length;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('BIGPICK ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_bigpick.txt'), logs.join('\n'));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error(e); fs.writeFileSync(path.join(__dirname, 'last_logs_bigpick.txt'), logs.join('\n')); process.exit(1); });
