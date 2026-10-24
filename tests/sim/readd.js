// Informe del dueño (2763): en la tablet, tras borrar los contactos, al buscar salían "desconocidos" y al pulsar
// agregar no pasaba nada. A (tablet) y B (S24) son contactos; A borra a B (B sigue teniendo a A). Luego:
//  1. Solo A abre "Agregar" (B, que sigue teniendo a A, anuncia su código rotativo y A ya no lo reconoce): ronda 2764,
//     A se conecta con los NEXO cercanos que no reconoce para saber quiénes son y los muestra (antes: nada).
//  2. B abre también "Agregar": A lo ve (nunca "Unknown": el anuncio no trae el nombre), lo agrega con "+", el nombre
//     del teléfono llega al conectar y se escriben.
// Uso: node readd.js <dir_build>
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone } = require('./native_mock');
const buildDir = path.resolve(process.argv[2]);
const opts = { readsContentFallback: true, retain: ['onPayloadReceived'], closeOnNoService: true, pace: [15, 15], ioDelay: 25, asymmetric: true, noAdvName: true };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
class DL extends ResourceLoader { constructor(d) { super(); this.d = d; } fetch(u) { const f = path.join(this.d, decodeURIComponent(new URL(u).pathname)); return fs.existsSync(f) ? Promise.resolve(fs.readFileSync(f)) : Promise.reject(new Error('x')); } }
const logs = [];
async function boot(name, native) {
  const vc = new VirtualConsole(); ['log', 'warn', 'error'].forEach((l) => vc.on(l, (...a) => logs.push(`${new Date().toISOString().substring(14, 23)} [${name}] ${l}: ` + a.map(String).join(' ').substring(0, 250))));
  const dom = new JSDOM(fs.readFileSync(path.join(buildDir, 'dist', 'index.html'), 'utf8'), { url: 'https://' + name.toLowerCase() + '.nexo.test/index.html', runScripts: 'dangerously', resources: new DL(path.join(buildDir, 'dist')), pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) { win.CapacitorCustomPlatform = { name: 'android' }; require('./native_mock').installWebCrypto(win); win.Capacitor = { Plugins: { NexoBLE: native.plugin() } }; win.HTMLElement.prototype.scrollTo = function () {}; } });
  const win = dom.window; for (let i = 0; i < 100 && !(win.NEXO && win.NEXO.initialized); i++) await sleep(100); await sleep(800);
  return { name, native, win };
}
const click = (w, el) => el && el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
const found = (p) => Array.from(p.win.document.querySelectorAll('#ble-new-device > div')).map((d) => d.textContent.replace('+', '').trim());
const contacts = (p) => Array.from(p.win.document.querySelectorAll('#main-contacts-list .ble-contact-row .ble-contact-name')).map((e) => e.textContent);
async function scanFor(p, s) { for (let i = 0; i < s * 10; i++) { await sleep(100); if (found(p).length) return true; if (!p.win.bleInterface.isScanning) click(p.win, p.win.document.getElementById('ble-scan-btn')); } return false; }
const wait = async (c, s) => { for (let i = 0; i < s * 5; i++) { if (await c()) return true; await sleep(200); } return false; };
(async () => {
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', opts), nB = new NativePhone('B', 'BB:BB:BB:BB:BB:02', opts);
  [nA, nB].forEach((n) => { radio.add(n); n.load(); });
  const [A, B] = await Promise.all([boot('A', nA), boot('B', nB)]);
  const idA = A.win.bleInterface.localNexoId.toLowerCase(), idB = B.win.bleInterface.localNexoId.toLowerCase();
  const r = { build: path.basename(buildDir) };
  A.win.bleInterface.togglePanel(); await scanFor(A, 40); click(A.win, A.win.document.querySelector('#ble-new-device > div button')); await sleep(2000);
  if (A.win.document.getElementById('ble-panel').classList.contains('active')) A.win.bleInterface.togglePanel();
  // B también agrega a A (como en los teléfonos del dueño: los demás siguen teniendo a la tablet)
  B.win.bleInterface.togglePanel(); await scanFor(B, 40); click(B.win, B.win.document.querySelector('#ble-new-device > div button')); await sleep(2000);
  if (B.win.document.getElementById('ble-panel').classList.contains('active')) B.win.bleInterface.togglePanel();
  r.contactos_A_antes = contacts(A);
  r.B_tiene_a_A = await wait(() => B.win.bleInterface.getContacts().some((c) => (c.nexoId || c.deviceUUID || '').toLowerCase() === idA), 30);
  // A borra a B (menú del contacto → Eliminar)
  A.win.bleInterface.removeContact(idB.toUpperCase()); await sleep(1000);
  r.contactos_A_tras_borrar = contacts(A);
  // 1. Solo A abre Agregar (B sigue con su código rotativo: tiene contactos). Ronda 2764: A lo identifica y lo ve
  A.win.bleInterface.togglePanel();
  await scanFor(A, 40);
  r.solo_A_ve = found(A);
  // 2. Se agrega con "+" (si no salió, B abre también "Agregar", como antes)
  if (!r.solo_A_ve.length) { B.win.bleInterface.togglePanel(); r.con_B_visible_ve = (await scanFor(A, 40)) ? found(A) : []; }
  else r.con_B_visible_ve = r.solo_A_ve;
  click(A.win, A.win.document.querySelector('#ble-new-device > div button')); await sleep(3000);
  r.contactos_A_tras_agregar = contacts(A);
  r.agregado = A.win.bleInterface.getContacts().some((c) => (c.nexoId || c.deviceUUID || '').toLowerCase() === idB);
  r.nombre_no_unknown = !r.contactos_A_tras_agregar.some((n) => /unknown/i.test(n)) && !r.con_B_visible_ve.some((n) => /unknown/i.test(n));
  r.nombre_de_verdad = await wait(() => contacts(A).indexOf('B') >= 0, 20); // llega con el kx (nm)
  if (A.win.document.getElementById('ble-panel').classList.contains('active')) A.win.bleInterface.togglePanel();
  if (B.win.document.getElementById('ble-panel').classList.contains('active')) B.win.bleInterface.togglePanel();
  // escribirse
  const row = Array.from(A.win.document.querySelectorAll('#main-contacts-list .ble-contact-row'))[0]; click(A.win, row); await sleep(600);
  const i = A.win.document.getElementById('message-input'); i.value = 'otra vez'; i.dispatchEvent(new A.win.Event('input', { bubbles: true })); click(A.win, A.win.document.getElementById('send-btn'));
  r.texto_llega = await wait(async () => (await B.win.vaultLoadMessages(idA)).some((m) => m.content === 'otra vez'), 60);
  r.errores = logs.filter((l) => / error: /.test(l) && !/JSDOMERROR|styles\.css|Not implemented/.test(l)).slice(0, 5);
  const ok = r.B_tiene_a_A && r.solo_A_ve.length > 0 && r.agregado && r.nombre_no_unknown && r.nombre_de_verdad && r.texto_llega && !r.errores.length;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('READD ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_readd.txt'), logs.join('\n'));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error(e); fs.writeFileSync(path.join(__dirname, 'last_logs_readd.txt'), logs.join('\n')); process.exit(1); });
