// Alta lenta (dueño 11-11; registro del teléfono de Marcos 13:45–13:47): Marcos abrió «Agregar» y Austin tardó ~75 s en salir.
// Causas vistas en su registro: (1) a cada NEXO cercano sin reconocer se le conectaba, pero «quién eres» solo se preguntaba al
// volver a verlo en el escaneo ≥ 10 s después; (2) solo 3 conexiones de paso a la vez y había más teléfonos (la tableta dormida
// no contesta); (3) la copia de LARGO ALCANCE vista antes que la normal → conexión que falla tras segundos y atasca la cola;
// (4) Austin se identificó justo con la pantalla cerrada y al reabrirla no salía.
// A = el dueño (contacto de todos); B = Marcos; C = Austin; D = tableta con la app DORMIDA; E, F = otros teléfonos del dueño.
// Ninguno tiene «Agregar» abierto salvo B (todos anuncian código rotativo: tienen contactos).
//  L0  (3013, regla del dueño: «cualquiera que tiene NEXO debe aparecer al instante en un escaneo») B abre «Agregar»: en ≤ 1,5 s
//      hay una fila por cada NEXO cercano (con nombre o «identificando…»);
//  L1  C sale con su nombre en ≤ 3 s (y E, F también);
//  L5  (3013) D, con la app DORMIDA, también sale con su nombre: contesta su nativo;
//  L6  (3013) G, versión anterior y dormida: fila «NEXO cercano · no responde todavía»; se toca «+» y se agrega sola al despertar;
//  L2  B cierra y reabre: C sale en ≤ 1,5 s (ya se sabe quién es);
//  L3  B no se conecta a ninguna copia de largo alcance de un teléfono cercano;
//  L4  B agrega a C con «+» y se escriben.
// Uso: node addlento.js <dir_build>
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone, installWebCrypto } = require('./native_mock');

const buildDir = path.resolve(process.argv[2] || path.join(__dirname, 'builds/wip'));
const opts = { readsContentFallback: true, retain: ['onPayloadReceived'], closeOnNoService: true, pace: [15, 15], ioDelay: 25, asymmetric: true, noAdvName: true, codedCopy: true };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
class DL extends ResourceLoader { constructor(d) { super(); this.d = d; } fetch(u) { const f = path.join(this.d, decodeURIComponent(new URL(u).pathname)); return fs.existsSync(f) ? Promise.resolve(fs.readFileSync(f)) : Promise.reject(new Error('x')); } }
const logs = [];
const T0 = Date.now();
const ts = () => String(((Date.now() - T0) / 1000).toFixed(1)).padStart(6) + 's';
async function boot(name, native) {
  const vc = new VirtualConsole(); ['log', 'warn', 'error'].forEach((l) => vc.on(l, (...a) => logs.push(`${ts()} [${name}] ${l}: ` + a.map(String).join(' ').substring(0, 250))));
  const dom = new JSDOM(fs.readFileSync(path.join(buildDir, 'dist', 'index.html'), 'utf8'), { url: 'https://' + name.toLowerCase() + '.nexo.test/index.html', runScripts: 'dangerously', resources: new DL(path.join(buildDir, 'dist')), pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) { win.CapacitorCustomPlatform = { name: 'android' }; installWebCrypto(win); win.Capacitor = { Plugins: { NexoBLE: native.plugin() } }; win.HTMLElement.prototype.scrollTo = function () {}; } });
  const win = dom.window; for (let i = 0; i < 100 && !(win.NEXO && win.NEXO.initialized); i++) await sleep(100); await sleep(800);
  return { name, native, win };
}
const click = (w, el) => el && el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
const found = (p) => Array.from(p.win.document.querySelectorAll('#ble-new-device > div')).map((d) => (d.querySelector('span') || d).textContent.replace('+', '').trim());
const panelOpen = (p) => p.win.document.getElementById('ble-panel').classList.contains('active');
const openPanel = (p) => { if (!panelOpen(p)) p.win.bleInterface.togglePanel(); };
const closePanel = (p) => { if (panelOpen(p)) p.win.bleInterface.togglePanel(); };
const hasContact = (p, id) => p.win.bleInterface.getContacts().some((c) => (c.nexoId || c.deviceUUID || '').toLowerCase() === id);
const wait = async (c, s) => { const t0 = Date.now(); while (Date.now() - t0 < s * 1000) { if (await c()) return Math.round((Date.now() - t0) / 100) / 10; await sleep(100); } return null; };
// con «Agregar» abierto, mantener el escaneo y esperar a que salga `name`
async function waitRow(p, name, s) { return wait(() => { if (!p.win.bleInterface.isScanning) click(p.win, p.win.document.getElementById('ble-scan-btn')); return found(p).some((n) => n === name); }, s); }
async function addRow(p, name) {
  const row = Array.from(p.win.document.querySelectorAll('#ble-new-device > div')).find((d) => ((d.querySelector('span') || d).textContent || '').replace('+', '').trim() === name);
  click(p.win, row && row.querySelector('button')); await sleep(1500); return !!row;
}
async function openChatWith(p, name) {
  let row; for (let i = 0; i < 200 && !row; i++) { row = Array.from(p.win.document.querySelectorAll('#main-contacts-list .ble-contact-row')).find((r) => (r.querySelector('.ble-contact-name') || {}).textContent === name); if (!row) await sleep(100); }
  click(p.win, row); await sleep(500); return !!row;
}
async function closeChat(p) { p.win.dispatchEvent(new p.win.CustomEvent('nexo:ble:closeChat', { detail: {} })); await sleep(300); }
function sendText(p, t) { const i = p.win.document.getElementById('message-input'); i.value = t; i.dispatchEvent(new p.win.Event('input', { bubbles: true })); click(p.win, p.win.document.getElementById('send-btn')); }

(async () => {
  const r = { prueba: 'addlento', build: path.basename(buildDir) };
  const radio = new Radio();
  const names = ['A', 'B', 'D', 'E', 'F', 'G', 'C'];   // C (Austin) es el ÚLTIMO que B ve en cada pasada del escaneo (como en el registro de Marcos)
  const hx = { A: 'AA', B: 'BB', C: 'CC', D: 'DD', E: 'EE', F: 'FF', G: 'A7' };   // direcciones Bluetooth válidas (hexadecimal)
  const nat = {}; names.forEach((n, i) => { const h = hx[n]; nat[n] = new NativePhone(n, [h, h, h, h, h, '0' + (i + 1)].join(':'), Object.assign({}, opts, { codedCopy: false })); });
  // al principio solo A y uno más cada vez (así nadie más se hace contacto de nadie: B…F solo conocen a A)
  const P = {};
  radio.add(nat.A); nat.A.load(); P.A = await boot('A', nat.A);
  const idA = P.A.win.bleInterface.localNexoId.toLowerCase();
  for (const n of names.slice(1)) {
    radio.add(nat[n]); nat[n].load();
    names.slice(1).forEach((o) => { if (o !== n && radio.phones.indexOf(nat[o]) >= 0) radio.block(nat[n], nat[o]); });
    P[n] = await boot(n, nat[n]);
    // (en la preparación, sin copias de largo alcance: solo interesa dejar los contactos hechos)
    openPanel(P.A);
    const s = await wait(() => { if (!P.A.win.bleInterface.isScanning) click(P.A.win, P.A.win.document.getElementById('ble-scan-btn')); return P.A.win.document.querySelectorAll('#ble-new-device > div button').length > 0; }, 40);
    if (s === null) throw new Error('A no ve a ' + n);
    click(P.A.win, P.A.win.document.querySelector('#ble-new-device > div button')); await sleep(1500); closePanel(P.A);
    const named = await wait(() => Array.from(P.A.win.document.querySelectorAll('#main-contacts-list .ble-contact-row .ble-contact-name')).some((e) => e.textContent === n), 30);
    if (named === null) throw new Error('A no supo el nombre de ' + n);
    await openChatWith(P.A, n); sendText(P.A, 'hola ' + n); await sleep(1500); await closeChat(P.A);
    const ok = await wait(() => hasContact(P[n], idA), 30); if (ok === null) throw new Error(n + ' no tiene a A');
  }
  r.contactos_listos = true;
  // Reinicio de B…F: sin nada apuntado en memoria; todos con contactos → código rotativo. Ya se ven todos entre sí.
  for (const n of names.slice(1)) { P[n].win.close(); nat[n].destroyActivity(); }
  await sleep(1000);
  names.slice(1).forEach((a) => names.slice(1).forEach((b) => { if (a < b) radio.unblock(nat[a], nat[b]); }));
  names.forEach((n) => { nat[n].opts.codedCopy = true; });   // desde aquí, como en los teléfonos reales: dos direcciones por teléfono
  for (const n of ['C', 'D', 'E', 'F', 'G']) { nat[n].load(); P[n] = await boot(n, nat[n]); }
  // D: la tableta con la app dormida (no contesta nada)
  nat.D.setAppActive(false); nat.D.setFrozen(true);
  // G: un teléfono con una versión ANTERIOR y la app dormida (su nativo no sabe contestar «quién soy»)
  nat.G.opts.noNativeKx = true; nat.G.setAppActive(false); nat.G.setFrozen(true);
  await sleep(3000);
  // B (Marcos) acaba de abrir la app (recién actualizada) y entra enseguida en «Agregar»: sin nada visto ni conectado todavía
  nat.B.load(); P.B = await boot('B', nat.B);
  const idC = P.C.win.bleInterface.localNexoId.toLowerCase(), idB = P.B.win.bleInterface.localNexoId.toLowerCase();
  r.rotativos = ['B', 'C', 'D', 'E', 'F', 'G'].every((n) => !nat[n].advertisedVisible());
  nat.B.stats.codedConnects = 0;

  // ---- L1: B abre «Agregar» ----
  openPanel(P.B);
  // L0 (3013, regla del dueño: «cualquiera que tiene NEXO debe aparecer al instante»): en ≤ 1,5 s hay una fila por cada NEXO
  // cercano (con su nombre o, mientras no conteste, «identificando…»): C, D (dormida), E y F
  r.L0_filas_s = await wait(() => { if (!P.B.win.bleInterface.isScanning) click(P.B.win, P.B.win.document.getElementById('ble-scan-btn')); return found(P.B).length + P.B.win.document.querySelectorAll('#ble-new-device .ble-anon-row').length >= 5; }, 20);
  r.L1_C_sale_s = await waitRow(P.B, 'C', 60);
  r.L1_lista = found(P.B);
  r.L1_E_sale_s = await waitRow(P.B, 'E', 30);
  r.L1_F_sale_s = await waitRow(P.B, 'F', 30);
  // L5 (3013): D tiene la app DORMIDA: contesta su nativo y también sale con su nombre
  r.L5_D_dormida_sale_s = await waitRow(P.B, 'D', 30);
  r.L5_kx_nativos_de_D = nat.D.stats.nativeKx || 0;
  // L6 (3013): G (versión anterior, dormida) no puede decir quién es: su fila sigue como «NEXO cercano», pasa a «no responde
  // todavía»; el usuario toca «+» y, cuando G despierta, se agrega sola con su nombre
  const anonTxt = () => Array.from(P.B.win.document.querySelectorAll('#ble-new-device .ble-anon-row')).map((e) => (e.firstChild || {}).textContent || '');
  r.L6_fila_sin_nombre = (await wait(() => { if (!P.B.win.bleInterface.isScanning) click(P.B.win, P.B.win.document.getElementById('ble-scan-btn')); return anonTxt().length === 1; }, 10)) !== null;
  r.L6_no_responde = (await wait(() => { if (!P.B.win.bleInterface.isScanning) click(P.B.win, P.B.win.document.getElementById('ble-scan-btn')); return anonTxt().some((x) => /no responde/.test(x)); }, 15)) !== null;
  click(P.B.win, P.B.win.document.querySelector('#ble-new-device .ble-anon-row button')); await sleep(300);
  r.L6_pendiente = anonTxt().some((x) => /en cuanto responda/.test(x));
  const idG = P.G.win.bleInterface.localNexoId.toLowerCase();
  nat.G.setFrozen(false); nat.G.setAppActive(true);
  r.L6_G_agregada_s = await wait(() => { if (panelOpen(P.B) && !P.B.win.bleInterface.isScanning) click(P.B.win, P.B.win.document.getElementById('ble-scan-btn')); return hasContact(P.B, idG); }, 40);
  openPanel(P.B);
  // ---- L2: cerrar y reabrir ----
  closePanel(P.B); await sleep(6000);
  openPanel(P.B);
  r.L2_C_sale_s = await waitRow(P.B, 'C', 30);
  // ---- L3: conexiones a copias de largo alcance ----
  r.L3_conexiones_largo_alcance = nat.B.stats.codedConnects || 0;
  // ---- L4: agregar y escribirse ----
  r.L4_fila = await addRow(P.B, 'C'); closePanel(P.B);
  r.L4_agregado = hasContact(P.B, idC);
  await openChatWith(P.B, 'C'); sendText(P.B, 'hola Austin'); 
  r.L4_llega_s = await wait(async () => (await P.C.win.vaultLoadMessages(idB)).some((m) => m.content === 'hola Austin'), 60);
  r.errores = logs.filter((l) => / error: /.test(l) && !/JSDOMERROR|styles\.css|Not implemented/.test(l)).slice(0, 5);
  const ok = r.rotativos && r.L0_filas_s !== null && r.L0_filas_s <= 1.5 && r.L1_C_sale_s !== null && r.L1_C_sale_s <= 3 && r.L1_E_sale_s !== null && r.L1_F_sale_s !== null &&
    r.L5_D_dormida_sale_s !== null && r.L5_kx_nativos_de_D > 0 && r.L6_fila_sin_nombre && r.L6_no_responde && r.L6_pendiente && r.L6_G_agregada_s !== null && r.L2_C_sale_s !== null && r.L2_C_sale_s <= 1.5 &&
    r.L3_conexiones_largo_alcance === 0 && r.L4_agregado && r.L4_llega_s !== null && !r.errores.length;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('ADDLENTO ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_addlento.txt'), logs.join('\n'));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('ADDLENTO ' + JSON.stringify({ prueba: 'addlento', resultado: 'FALLO', error: String(e && e.message).replace(/"/g, "'") })); console.error(e && e.stack); fs.writeFileSync(path.join(__dirname, 'last_logs_addlento.txt'), logs.join('\n')); process.exit(1); });
