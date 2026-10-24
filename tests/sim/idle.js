// Ronda 2766 (revisión del código): ningún ping se contestaba (el pong se descartaba antes de llegar a su respuesta) y
// el vigilante cortaba cada ~30 s todo enlace sin tráfico: el "Peer ready cada ~30 s" de la ronda 2760, enlaces de MTU
// 23 al rehacerse y fotos por Bluetooth que no llegaban. A y B contactos, 80 s sin escribirse.
// Debe pasar: A recibe pongs, ningún "sin respuesta a 2 pings", el enlace sigue (mismo camino) y un texto al final
// llega enseguida.
// Uso: node idle.js <dir_build> [--wifi]
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone } = require('./native_mock');

const buildDir = path.resolve(process.argv[2]);
const WIFI = process.argv.includes('--wifi');
const opts = { readsContentFallback: true, retain: ['onPayloadReceived', 'onLanMessage', 'onLanUp', 'onLanDown'], closeOnNoService: true, pace: [15, 15], ioDelay: 25, asymmetric: true };
if (WIFI) opts.wifi = 'casa';
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
const wait = async (c, s) => { const t0 = Date.now(); for (let i = 0; i < s * 5; i++) { if (await c()) return Math.round((Date.now() - t0) / 100) / 10; await sleep(200); } return null; };

(async () => {
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', opts), nB = new NativePhone('B', 'BB:BB:BB:BB:BB:02', opts);
  [nA, nB].forEach((n) => { radio.add(n); n.load(); });
  const [A, B] = await Promise.all([boot('A', nA), boot('B', nB)]);
  const idA = A.win.bleInterface.localNexoId.toLowerCase(), idB = B.win.bleInterface.localNexoId.toLowerCase();
  const r = { build: path.basename(buildDir), modo: WIFI ? 'Wi-Fi + Bluetooth' : 'Bluetooth' };
  A.win.bleInterface.togglePanel(); let add = null;
  for (let i = 0; i < 400 && !add; i++) { await sleep(100); add = A.win.document.querySelector('#ble-new-device > div button'); if (!add && !A.win.bleInterface.isScanning) click(A.win, A.win.document.getElementById('ble-scan-btn')); }
  click(A.win, add); await sleep(1500);
  if (A.win.document.getElementById('ble-panel').classList.contains('active')) A.win.bleInterface.togglePanel();
  await openChatWith(A, 'B'); sendText(A, 'hola'); await sleep(2500);
  r.contactos = (await wait(async () => (await B.win.vaultLoadMessages(idA)).some((m) => m.content === 'hola'), 30)) !== null;
  if (WIFI) r.wifi_s = await wait(() => A.win.bleInterface.linkOf(idB) === 'wifi', 60);
  let pongsA = 0, pingsB = 0;
  const oA = nA.emit.bind(nA); nA.emit = (ev, d) => { if (ev === 'onPayloadReceived' && /"type":"pong"/.test(String(d && d.content))) pongsA++; return oA(ev, d); };
  const oB = nB.emit.bind(nB); nB.emit = (ev, d) => { if (ev === 'onPayloadReceived' && /"type":"ping"/.test(String(d && d.content))) pingsB++; return oB(ev, d); };
  const z0 = logs.filter((l) => /sin respuesta a 2 pings/.test(l)).length, via0 = A.win.bleInterface.linkOf(idB);
  await sleep(80000);
  r.pings_recibidos_B = pingsB; r.pongs_recibidos_A = pongsA;
  r.cortes = logs.filter((l) => /sin respuesta a 2 pings/.test(l)).length - z0;
  r.camino_antes = via0; r.camino_despues = A.win.bleInterface.linkOf(idB);
  sendText(A, 'tras 80 s parados');
  r.texto_llega_s = await wait(async () => (await B.win.vaultLoadMessages(idA)).some((m) => m.content === 'tras 80 s parados'), 30);
  r.errores = logs.filter((l) => / error: /.test(l) && !/JSDOMERROR|styles\.css|Not implemented/.test(l)).slice(0, 5);
  const ok = r.contactos && (!WIFI || r.wifi_s !== null) && r.pongs_recibidos_A > 0 && r.cortes === 0 && r.camino_despues === r.camino_antes && r.texto_llega_s !== null && r.texto_llega_s < 10 && !r.errores.length;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('IDLE ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_idle' + (WIFI ? '_wifi' : '') + '.txt'), logs.join('\n'));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error(e); fs.writeFileSync(path.join(__dirname, 'last_logs_idle' + (WIFI ? '_wifi' : '') + '.txt'), logs.join('\n')); process.exit(1); });
