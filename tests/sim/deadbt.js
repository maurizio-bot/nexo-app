// BT muerto → internet al toque (regla del dueño 04-11: «internet antes que un Bluetooth muerto»; y «bajá los 9 s»).
// Dos teléfonos reales en jsdom, emparejados por Bluetooth. Comprueba el RESOLVEDOR de camino:
//   (1) 3079 (dueño 14-11: «el Bluetooth es la emergencia»): con el BT vivo e internet, el resolvedor elige internet; sin
//       internet, el Bluetooth vivo (la emergencia).
//   (2) cuando el nativo suelta un mensaje (_markBleDead, lo que dispara 'onWriteDropped'), ese BT se marca muerto y el
//       resolvedor SALTA a internet (net:) — no se queda pegado al Bluetooth muerto.
//   (3) recibir algo por ese BT (prueba de vida, _clearBleDead) lo vuelve a habilitar → sin internet, el resolvedor vuelve al
//       Bluetooth.
// Uso: node deadbt.js <dir_build>
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone, installWebCrypto } = require('./native_mock');

const buildDir = path.resolve(process.argv[2]);
const opts = { readsContentFallback: true, retain: ['onPayloadReceived'], closeOnNoService: true, pace: [15, 15], ioDelay: 25, asymmetric: true };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
class DL extends ResourceLoader { constructor(d) { super(); this.d = d; } fetch(u) { const f = path.join(this.d, decodeURIComponent(new URL(u).pathname)); return fs.existsSync(f) ? Promise.resolve(fs.readFileSync(f)) : Promise.reject(new Error('x')); } }
const logs = [];
async function boot(name, native) {
  const vc = new VirtualConsole();
  ['log', 'warn', 'error'].forEach((l) => vc.on(l, (...a) => logs.push(`[${name}] ${l}: ` + a.map(String).join(' ').substring(0, 220))));
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
async function addFound(p) {
  let add = null;
  for (let i = 0; i < 400 && !add; i++) { await sleep(100); add = p.win.document.querySelector('#ble-new-device > div button'); if (!add && !p.win.bleInterface.isScanning) click(p.win, p.win.document.getElementById('ble-scan-btn')); }
  click(p.win, add); await sleep(2000); return !!add;
}
async function openChatWith(p, name) { let row; for (let i = 0; i < 300 && !row; i++) { row = Array.from(p.win.document.querySelectorAll('#main-contacts-list .ble-contact-row')).find((r) => (r.querySelector('.ble-contact-name') || {}).textContent === name); if (!row) await sleep(100); } click(p.win, row); await sleep(600); return !!row; }
function sendText(p, t) { const i = p.win.document.getElementById('message-input'); i.value = t; i.dispatchEvent(new p.win.Event('input', { bubbles: true })); click(p.win, p.win.document.getElementById('send-btn')); }
const wait = async (c, s) => { for (let i = 0; i < s * 5; i++) { if (await c()) return true; await sleep(200); } return false; };
const isNet = (d) => /^net[:]?nx/i.test(String(d || ''));
const isBtMac = (d) => !!d && !/^(lan|net)/i.test(String(d));

(async () => {
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', opts), nB = new NativePhone('B', 'BB:BB:BB:BB:BB:02', opts);
  [nA, nB].forEach((n) => { radio.add(n); n.load(); });
  const [A, B] = await Promise.all([boot('A', nA), boot('B', nB)]);
  const idA = A.win.bleInterface.localNexoId.toLowerCase(), idB = B.win.bleInterface.localNexoId.toLowerCase();
  const r = { build: path.basename(buildDir) };
  const bi = A.win.bleInterface;

  // Emparejar por Bluetooth y fijar la sesión con un texto
  A.win.bleInterface.togglePanel(); if (!(await addFound(A))) { console.log('DEADBT ' + JSON.stringify({ resultado: 'FALLO', error: 'no empareja' })); process.exit(1); } A.win.bleInterface.togglePanel();
  await openChatWith(A, 'B'); sendText(A, 'hola'); await sleep(2500);
  r.emparejados = await wait(async () => (await B.win.vaultLoadMessages(idA)).some((m) => m.content === 'hola'), 30);

  // Hacer a B alcanzable por internet (en el sim no hay relés → si net es null, inyecto uno mínimo). canReach(idB)=true,
  // bothWifi=false (uno con datos móviles: desde la 3079 internet gana igual al Bluetooth listo).
  r.net_antes = !!bi.net;
  if (!bi.net) bi.net = {};
  bi.net.canReach = function (x) { return String(x || '').toLowerCase().indexOf(idB) >= 0; };
  bi.net.bothWifi = function () { return false; };
  bi.net.filesOk = bi.net.filesOk || function () { return true; };
  bi.net.mailboxOk = bi.net.mailboxOk || function () { return true; };

  // (1) 3079 (dueño 14-11: «el Bluetooth es la emergencia, solo por si no hay otro camino; fuera de eso, siempre el más rápido»): con el
  //     BT vivo E internet, el resolvedor elige internet (antes de la 3079, el Bluetooth listo iba primero si no estaban los dos en Wi-Fi)
  var dev1 = bi._resolveDeviceIdForNexoId(idB);
  r.con_internet_elige_internet = isNet(dev1);
  // (1b) sin internet, el BT vivo es la emergencia: se elige
  var netOn = bi.net.canReach;
  bi.net.canReach = function () { return false; };
  var btMac = bi._resolveDeviceIdForNexoId(idB);
  r.sin_internet_bt_emergencia = isBtMac(btMac);
  bi.net.canReach = netOn;

  // (2) el nativo soltó un mensaje por ese BT → se marca muerto → con internet, internet (no se queda pegado al Bluetooth muerto)
  bi._markBleDead(btMac);
  var dev2 = bi._resolveDeviceIdForNexoId(idB);
  r.dev2 = String(dev2); // para el log: debe ser net:...
  r.bt_muerto_salta_internet = isNet(dev2);

  // (3) recibir algo por ese BT (prueba de vida) lo re-habilita → sin internet, vuelve a ser el camino de emergencia
  bi._clearBleDead(btMac);
  bi.net.canReach = function () { return false; };
  var dev3 = bi._resolveDeviceIdForNexoId(idB);
  r.prueba_de_vida_vuelve_bt = isBtMac(dev3);

  // (4) si NO hay otro camino (sin internet), marcar muerto NO rompe: sigue dando el BT (no deja al contacto sin camino)
  bi._markBleDead(btMac);
  var dev4 = bi._resolveDeviceIdForNexoId(idB);
  r.sin_internet_no_rompe = !!dev4; // da algo (el BT u otra dirección), no null

  r.errores = logs.filter((l) => /TypeError|undefined is not|is not a function/.test(l) && /error/.test(l)).slice(0, 4);
  const ok = r.emparejados && r.con_internet_elige_internet && r.sin_internet_bt_emergencia && r.bt_muerto_salta_internet && r.prueba_de_vida_vuelve_bt && r.sin_internet_no_rompe && r.errores.length === 0;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('DEADBT ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_deadbt.txt'), logs.join('\n'));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error('FALLO:', e.stack); fs.writeFileSync(path.join(__dirname, 'last_logs_deadbt.txt'), logs.join('\n')); process.exit(1); });
