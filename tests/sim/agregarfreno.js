// 3184 (estudio EDC 17-11, docs/EDC_LIMITES.md, cambio n.º 1): «Agregar» con freno. En una multitud el escaneo avisa cientos de
// veces por segundo y cada aviso de un NEXO con su ID visible rehacía TODA la lista de «Agregar» (renderNewDeviceBar), aunque el
// panel estuviera cerrado, recorriendo la libreta por cada fila: 90–98 % del tiempo de JS (multitud.js: 500 NEXO → lag de 2,5 s;
// 1000 → app colgada). A (app real, jsdom) tiene en su libreta a K; alrededor, 60 NEXO con su ID visible (avisos como los del
// Kotlin, ~2 por segundo cada uno) y B, un teléfono de verdad que A agrega desde la lista.
//  F1  panel CERRADO, 2 s de avisos: la lista no se dibuja (o casi: ≤ 1 vez);
//  F2  al ABRIR el panel se dibuja YA con lo acumulado (1–30 filas); abierto, 2 s de avisos: ≤ 5 dibujos (≈ 2 por segundo) y
//      nunca más de 30 filas (las demás, con el buscador: aviso «Y N más…»);
//  F3  un contacto no ocupa fila: K (de la libreta) nunca sale, y uno de la lista que pasa a ser contacto deja de salir;
//  F4  agregar desde la lista sigue igual: «+» en la fila de B (con la multitud avisando) → B es contacto y le llega un texto.
// Contraprueba: 344586ad (dibuja con cada aviso y todas las filas).
// Uso: node agregarfreno.js <dir_build>
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone, installWebCrypto } = require('./native_mock');

const buildDir = path.resolve(process.argv[2] || path.join(__dirname, 'builds/wip'));
const opts = { readsContentFallback: true, retain: ['onPayloadReceived'], closeOnNoService: true, pace: [15, 15], ioDelay: 25, asymmetric: true };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
class DL extends ResourceLoader { constructor(d) { super(); this.d = d; } fetch(u) { const f = path.join(this.d, decodeURIComponent(new URL(u).pathname)); return fs.existsSync(f) ? Promise.resolve(fs.readFileSync(f)) : Promise.reject(new Error('x')); } }
const logs = [];
async function boot(name, native) {
  const vc = new VirtualConsole(); ['log', 'warn', 'error'].forEach((l) => vc.on(l, (...a) => logs.push(`${new Date().toISOString().substring(14, 23)} [${name}] ${l}: ` + a.map(String).join(' ').substring(0, 250))));
  const dom = new JSDOM(fs.readFileSync(path.join(buildDir, 'dist', 'index.html'), 'utf8'), { url: 'https://' + name.toLowerCase() + '.nexo.test/index.html', runScripts: 'dangerously', resources: new DL(path.join(buildDir, 'dist')), pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) { win.CapacitorCustomPlatform = { name: 'android' }; installWebCrypto(win); win.Capacitor = { Plugins: { NexoBLE: native.plugin() } }; win.HTMLElement.prototype.scrollTo = function () {}; } });
  const win = dom.window; for (let i = 0; i < 100 && !(win.NEXO && win.NEXO.initialized); i++) await sleep(100); await sleep(800);
  return { name, native, win };
}
const click = (w, el) => el && el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
const rowsOf = (p) => Array.from(p.win.document.querySelectorAll('#ble-new-device .ble-found-row'));
const rowName = (row) => ((row.querySelector('span') || row).textContent || '').replace('+', '').trim();
const wait = async (c, s) => { const t0 = Date.now(); while (Date.now() - t0 < s * 1000) { if (await c()) return Math.round((Date.now() - t0) / 100) / 10; await sleep(100); } return null; };
let seed = 3184; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const B36 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const nxId = () => 'NX' + Array.from({ length: 8 }, () => B36[Math.floor(rnd() * 36)]).join('');
const mac = (i) => '4E:20:00:' + (i >> 8 & 0xff).toString(16).toUpperCase().padStart(2, '0') + ':' + (i & 0xff).toString(16).toUpperCase().padStart(2, '0') + ':C3';

(async () => {
  const r = { prueba: 'agregarfreno', build: path.basename(buildDir) };
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', opts), nB = new NativePhone('B', 'BB:BB:BB:BB:BB:02', opts);
  [nA, nB].forEach((n) => { radio.add(n); n.load(); });
  // Libreta de A: K (contacto que anda por ahí con «Agregar» abierto: anuncia su NEXO ID)
  const K = { nx: nxId(), name: 'Amigo K', mac: mac(999) };
  nA.files.set('nexo_vault_contacts.json', JSON.stringify({ contacts: [{ nexoId: K.nx.toLowerCase(), deviceUUID: K.nx.toLowerCase(), name: K.name, addedAt: Date.now() - 86400000, lastSeen: 0, online: false, unreadCount: 0, lastMessage: '' }], savedAt: Date.now() }));
  const [A, B] = await Promise.all([boot('A', nA), boot('B', nB)]);
  const bi = A.win.bleInterface, idB = B.win.bleInterface.localNexoId.toLowerCase(), idA = bi.localNexoId.toLowerCase();
  // La multitud: 60 NEXO con su ID visible (no están en la radio: solo sus avisos, ~2 por segundo cada uno, como el Kotlin)
  const crowd = Array.from({ length: 60 }, (_, i) => ({ nx: nxId(), name: 'Tel ' + i, mac: mac(i + 1), rssi: -62 - Math.round(rnd() * 33) }));
  let sent = 0;
  const emitOne = (g) => { sent++; nA.emit('onDeviceFound', { deviceId: g.mac, name: g.name, rssi: g.rssi + Math.round((rnd() - 0.5) * 6), nexoId: g.nx }); };
  const startCrowd = () => {
    const next = new Map(); [...crowd, K].forEach((g) => next.set(g, Date.now() + Math.floor(rnd() * 500)));
    const t = setInterval(() => { const now = Date.now(); next.forEach((at, g) => { if (at > now) return; next.set(g, now + 500); emitOne(g); }); }, 25);
    return () => clearInterval(t);
  };
  // Cada dibujo de la lista: cuántos, cuántas filas, y si salió una fila de un contacto
  const contactNames = new Set([K.name]);
  const st = { draws: 0, maxRows: 0, contactRow: [] };
  const orig = bi.renderNewDeviceBar;
  bi.renderNewDeviceBar = function () {
    const out = orig.apply(this, arguments);
    st.draws++;
    const rows = rowsOf(A); st.maxRows = Math.max(st.maxRows, rows.length);
    rows.forEach((row) => { const n = rowName(row); if (contactNames.has(n) && st.contactRow.indexOf(n) < 0) st.contactRow.push(n); });
    return out;
  };
  const panelOpen = () => A.win.document.getElementById('ble-panel').classList.contains('active');
  const window2s = async () => { const s0 = sent, d0 = st.draws; st.maxRows = 0; const stop = startCrowd(); await sleep(2000); stop(); return { avisos: sent - s0, dibujos: st.draws - d0, filas_max: st.maxRows }; };

  // ---- F1: panel CERRADO ----
  if (panelOpen()) bi.togglePanel();
  await sleep(3200); // (lo que quedara del arranque)
  const f1 = await window2s();
  r.F1_avisos = f1.avisos; r.F1_dibujos_cerrado = f1.dibujos;
  r.F1_acumulados = bi.foundDevices.size;

  // ---- F2: abrir (dibujo inmediato con lo acumulado) y 2 s con el panel abierto ----
  const dOpen = st.draws;
  bi.togglePanel();
  r.F2_dibuja_al_abrir = st.draws > dOpen;
  r.F2_filas_al_abrir = rowsOf(A).length;
  await sleep(400); // (el escaneo del usuario arranca a los 150 ms)
  const f2 = await window2s();
  r.F2_avisos = f2.avisos; r.F2_dibujos_abierto = f2.dibujos; r.F2_filas_max = f2.filas_max;
  r.F2_aviso_mas = Number(((A.win.document.querySelector('#ble-new-device .ble-more-note') || {}).dataset || {}).n || 0);

  // ---- F3: un contacto no ocupa fila ----
  const shown = rowsOf(A).map(rowName);
  const X = crowd.find((g) => shown.indexOf(g.name) >= 0);
  r.F3_X_salia = !!X;
  if (X) {
    A.win.vaultSaveContacts(A.win.vaultLoadContacts().concat([{ nexoId: X.nx.toLowerCase(), deviceUUID: X.nx.toLowerCase(), name: X.name, addedAt: Date.now(), lastSeen: 0, online: false, unreadCount: 0, lastMessage: '' }]));
    contactNames.add(X.name);
    const stop = startCrowd(); await sleep(1500); stop();
    r.F3_X_ya_no_sale = rowsOf(A).map(rowName).indexOf(X.name) < 0;
  }
  r.F3_K_nunca_salio = st.contactRow.indexOf(K.name) < 0;

  // ---- F4: agregar a B desde la lista, con la multitud avisando ----
  const stopC = startCrowd();
  let rowB = null;
  await wait(() => { if (!bi.isScanning) click(A.win, A.win.document.getElementById('ble-scan-btn')); rowB = rowsOf(A).find((row) => rowName(row) === 'B'); return !!rowB; }, 30);
  r.F4_B_en_la_lista = !!rowB;
  if (rowB) click(A.win, rowB.querySelector('button'));
  r.F4_agregado_s = await wait(() => bi.getContacts().some((c) => String(c.nexoId || c.deviceUUID || '').toLowerCase() === idB), 20);
  stopC();
  if (panelOpen()) bi.togglePanel();
  await sleep(1500);
  let rowC = null;
  await wait(() => { rowC = Array.from(A.win.document.querySelectorAll('#main-contacts-list .ble-contact-row')).find((x) => (x.querySelector('.ble-contact-name') || {}).textContent === 'B'); return !!rowC; }, 20);
  click(A.win, rowC); await sleep(600);
  const inp = A.win.document.getElementById('message-input'); inp.value = 'hola B'; inp.dispatchEvent(new A.win.Event('input', { bubbles: true })); click(A.win, A.win.document.getElementById('send-btn'));
  r.F4_texto_llega_s = await wait(async () => (await B.win.vaultLoadMessages(idA)).some((m) => m.content === 'hola B'), 60);
  r.F3_contactos_con_fila = st.contactRow;
  r.errores = logs.filter((l) => / error: /.test(l) && !/JSDOMERROR|styles\.css|Not implemented/.test(l)).slice(0, 5);
  const ok = r.F1_avisos >= 100 && r.F1_dibujos_cerrado <= 1 && r.F2_dibuja_al_abrir && r.F2_filas_al_abrir >= 1 && r.F2_filas_al_abrir <= 30 &&
    r.F2_avisos >= 100 && r.F2_dibujos_abierto <= 5 && r.F2_filas_max <= 30 && r.F3_X_salia && r.F3_X_ya_no_sale && r.F3_K_nunca_salio && !r.F3_contactos_con_fila.length &&
    r.F4_B_en_la_lista && r.F4_agregado_s !== null && r.F4_texto_llega_s !== null && !r.errores.length;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('AGREGARFRENO ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_agregarfreno.txt'), logs.join('\n'));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('AGREGARFRENO ' + JSON.stringify({ prueba: 'agregarfreno', resultado: 'FALLO', error: String(e && e.message).substring(0, 300) })); console.error(e); fs.writeFileSync(path.join(__dirname, 'last_logs_agregarfreno.txt'), logs.join('\n')); process.exit(1); });
