// Ronda 2766 (revisión del código). A y B contactos en el mismo Wi-Fi.
//  1. Volver a la app (p.ej. tras elegir una foto en la galería) borraba el estado del enlace Wi-Fi: ya no se mandaba
//     nada por Wi-Fi (un texto tardaba ~19 s por Bluetooth y un archivo se quedaba en "enviando"). Debe: el texto va
//     por Wi-Fi enseguida y el archivo llega.
//  2. Tras pulsar BUSCAR, el nativo para solo a los 15 s sin avisar y la app seguía "buscando": ya no volvía a buscar
//     sola. Debe: la app deja de "buscar" y las búsquedas automáticas siguen.
//  3. La reconexión de un enlace caído (el otro ya fuera de alcance) no esperaba cada vez más: reintentaba cada ~3 s
//     sin fin y buscaba en cuanto acababa la búsqueda anterior (Android ignora más de 5 búsquedas en 30 s). Debe: pocas
//     búsquedas e intentos en 40 s.
// Uso: node resume.js <dir_build>
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone } = require('./native_mock');

const buildDir = path.resolve(process.argv[2]);
const opts = { readsContentFallback: true, retain: ['onPayloadReceived', 'onLanMessage', 'onLanUp', 'onLanDown'], closeOnNoService: true, pace: [15, 15], ioDelay: 25, asymmetric: true, wifi: 'casa' };
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
async function openChatWith(p, name) {
  let row; for (let i = 0; i < 300 && !row; i++) { row = Array.from(p.win.document.querySelectorAll('#main-contacts-list .ble-contact-row')).find((r) => (r.querySelector('.ble-contact-name') || {}).textContent === name); if (!row) await sleep(100); }
  click(p.win, row); await sleep(600); return !!row;
}
function sendText(p, t) { const i = p.win.document.getElementById('message-input'); i.value = t; i.dispatchEvent(new p.win.Event('input', { bubbles: true })); click(p.win, p.win.document.getElementById('send-btn')); }
async function sendFile(p, name, bytes) {
  click(p.win, p.win.document.querySelector('.attach-menu-item[data-type="file"]')); await sleep(100);
  const fin = Array.from(p.win.document.querySelectorAll('input[type=file]')).pop();
  const b = Buffer.alloc(bytes); for (let i = 0; i < b.length; i++) b[i] = (i * 13) & 255;
  Object.defineProperty(fin, 'files', { configurable: true, value: [new p.win.File([b], name, { type: 'application/pdf' })] }); fin.dispatchEvent(new p.win.Event('change'));
}
const wait = async (c, s) => { const t0 = Date.now(); for (let i = 0; i < s * 5; i++) { if (await c()) return Math.round((Date.now() - t0) / 100) / 10; await sleep(200); } return null; };
const scans = (n) => n.calls.filter((c) => c.name === 'startScan').length;
const conns = (n) => n.calls.filter((c) => c.name === 'connectToDevice').length;

(async () => {
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', opts), nB = new NativePhone('B', 'BB:BB:BB:BB:BB:02', opts);
  [nA, nB].forEach((n) => { radio.add(n); n.load(); });
  const [A, B] = await Promise.all([boot('A', nA), boot('B', nB)]);
  const biA = A.win.bleInterface;
  const idA = biA.localNexoId.toLowerCase(), idB = B.win.bleInterface.localNexoId.toLowerCase();
  const r = { build: path.basename(buildDir) };
  biA.togglePanel(); let add = null;
  for (let i = 0; i < 400 && !add; i++) { await sleep(100); add = A.win.document.querySelector('#ble-new-device > div button'); if (!add && !biA.isScanning) click(A.win, A.win.document.getElementById('ble-scan-btn')); }
  click(A.win, add); await sleep(1500);
  if (A.win.document.getElementById('ble-panel').classList.contains('active')) biA.togglePanel();
  await openChatWith(A, 'B'); sendText(A, 'hola'); await sleep(2500);
  r.wifi_s = await wait(() => biA.linkOf(idB) === 'wifi' && B.win.bleInterface.linkOf(idA) === 'wifi', 60);

  // 1. Volver a la app
  A.win.document.dispatchEvent(new A.win.Event('visibilitychange'));
  await sleep(1500);
  r.estado_wifi_tras_volver = (biA._deviceStates.get('lan' + idB) || {}).state || null;
  const lan0 = nA.stats.lanOut || 0;
  sendText(A, 'tras volver a la app');
  r.texto_s = await wait(async () => (await B.win.vaultLoadMessages(idA)).some((m) => m.content === 'tras volver a la app'), 30);
  r.texto_por_wifi = (nA.stats.lanOut || 0) > lan0;
  await sendFile(A, 'galeria.pdf', 120000);
  r.archivo_s = await wait(async () => (await B.win.vaultLoadMessages(idA)).some((m) => m.attachmentType && !m._own && (m.attachmentMeta || {}).name === 'galeria.pdf'), 60);

  // 2. BUSCAR del usuario: la app deja de "buscar" cuando para el nativo
  await wait(() => !biA.isScanning, 20);
  biA.togglePanel();
  click(A.win, A.win.document.getElementById('ble-scan-btn'));
  await wait(() => biA.isScanning, 5);
  r.buscando_al_pulsar = biA.isScanning;
  await sleep(18000);
  r.buscando_18s_despues = biA.isScanning;
  biA.togglePanel();
  const s0 = scans(nA);
  biA._startPresenceSearch(60000); biA._autoScanForKnownContacts();
  await sleep(12000);
  r.busquedas_automaticas_luego = scans(nA) - s0;

  // 3. Reconexión de un enlace caído con el otro ya fuera de alcance (y sin Wi-Fi): sin ráfagas de búsquedas
  if (biA.isScanning) { await biA.toggleScan(); await sleep(300); }
  nA.setWifi(null); nB.setWifi(null);
  await wait(() => biA.linkOf(idB) === 'bluetooth', 30);
  let link = null; biA.connectedDevices.forEach((d, k) => { if (!link && !/^(lan|net)/.test(k)) link = k; });
  const s1 = scans(nA), c1 = conns(nA);
  radio.block(nA, nB);
  if (link) biA._forceDisconnectAndReconnect(link);
  await sleep(40000);
  r.busquedas_en_40s_tras_un_corte = scans(nA) - s1;
  r.intentos_de_conexion_en_40s = conns(nA) - c1;
  r.errores = logs.filter((l) => / error: /.test(l) && !/JSDOMERROR|styles\.css|Not implemented/.test(l)).slice(0, 5);
  const ok = r.wifi_s !== null && r.estado_wifi_tras_volver === 'ready_to_chat' && r.texto_s !== null && r.texto_s < 5 && r.texto_por_wifi && r.archivo_s !== null &&
    r.buscando_al_pulsar && !r.buscando_18s_despues && r.busquedas_automaticas_luego >= 1 && r.busquedas_en_40s_tras_un_corte <= 5 && r.intentos_de_conexion_en_40s <= 8 && !r.errores.length;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('RESUME ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_resume.txt'), logs.join('\n'));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error(e); fs.writeFileSync(path.join(__dirname, 'last_logs_resume.txt'), logs.join('\n')); process.exit(1); });
