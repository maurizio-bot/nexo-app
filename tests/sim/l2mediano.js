// 3288 (23-11, COLA 14 «Bluetooth ≈ 17 KB/s para archivos medianos sin Wi-Fi»): lo MEDIANO por el canal rápido del Bluetooth
// (L2CAP, l2_fast.js), solo con Bluetooth (sin Wi-Fi ni Wi-Fi Direct: un vagón, un festival). Tres casos, dos teléfonos cada uno:
//  rapido      los dos lo tienen: un archivo de 400 KB va por el canal (no en trozos) y llega en pocos segundos; uno chico
//              (15 KB) sigue en trozos (abrir el canal tardaría más).
//  canal_falla el canal no se abre en ese par de teléfonos: el archivo llega IGUAL, en trozos como siempre; quien recibe no
//              se queda esperando (cancelar) y con ese contacto no se vuelve a probar en un rato (el segundo va directo en trozos).
//  otro_no     el otro no lo tiene (no lo anuncia): ni se ofrece; en trozos como siempre.
// Uso: node l2mediano.js [dir_build] [--solo=caso]
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone, installWebCrypto } = require('./native_mock');

const buildDir = path.resolve(process.argv[2] || path.join(__dirname, 'builds/wip'));
const solo = ((process.argv.find((x) => x.startsWith('--solo=')) || '').split('=')[1]) || '';
const base = { wifiDirect: false, readsContentFallback: true, retain: ['onPayloadReceived'], closeOnNoService: true, pace: [15, 15], ioDelay: 0, asymmetric: true };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
class DL extends ResourceLoader { constructor(d) { super(); this.d = d; } fetch(u) { const f = path.join(this.d, decodeURIComponent(new URL(u).pathname)); return fs.existsSync(f) ? Promise.resolve(fs.readFileSync(f)) : Promise.reject(new Error('x')); } }
let air = [];
const orig = NativePhone.prototype._processReceivedChunk;
NativePhone.prototype._processReceivedChunk = function (from, chunk, source) { air.push(String(chunk)); return orig.call(this, from, chunk, source); };
const logs = [];
async function boot(name, native) {
  native.listeners = new Map();
  const vc = new VirtualConsole(); ['log', 'warn', 'error'].forEach((l) => vc.on(l, (...a) => logs.push(`[${name}] ${l}: ` + a.map(String).join(' ').substring(0, 250))));
  const dom = new JSDOM(fs.readFileSync(path.join(buildDir, 'dist', 'index.html'), 'utf8'), { url: 'https://' + name.toLowerCase() + '.nexo.test/index.html', runScripts: 'dangerously', resources: new DL(path.join(buildDir, 'dist')), pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) { win.CapacitorCustomPlatform = { name: 'android' }; installWebCrypto(win); win.NEXO_FILE_REVIEW = false; win.Capacitor = { Plugins: { NexoBLE: native.plugin() } }; win.HTMLElement.prototype.scrollTo = function () {}; } });
  const win = dom.window; for (let i = 0; i < 100 && !(win.NEXO && win.NEXO.initialized); i++) await sleep(100); await sleep(800);
  return { name, native, win };
}
const click = (w, el) => el && el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
async function pickFile(p, file) {
  click(p.win, p.win.document.querySelector('.attach-menu-item[data-type="file"]')); await sleep(300);
  const fin = Array.from(p.win.document.querySelectorAll('input[type=file]')).pop();
  Object.defineProperty(fin, 'files', { value: [file], configurable: true });
  fin.dispatchEvent(new p.win.Event('change'));
}
const bytes = (n, k) => { const b = Buffer.alloc(n); for (let i = 0; i < n; i++) b[i] = (i * k + 7) & 255; return b; };
async function waitFor(fn, ms) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return Math.round((Date.now() - t0) / 100) / 10; await sleep(200); } return null; }

async function caso(nombre, pA, pB) {
  air = []; logs.length = 0;
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', Object.assign({}, base, pA)), nB = new NativePhone('B', 'BB:BB:BB:BB:BB:02', Object.assign({}, base, pB));
  radio.add(nA); radio.add(nB); nA.load(); nB.load();
  const [A, B] = await Promise.all([boot('A', nA), boot('B', nB)]);
  A.win.bleInterface.togglePanel();
  let add = null;
  for (let i = 0; i < 400 && !add; i++) { await sleep(100); add = A.win.document.querySelector('#ble-new-device > div button'); if (!add && !A.win.bleInterface.isScanning) click(A.win, A.win.document.getElementById('ble-scan-btn')); }
  if (!add) throw new Error('no empareja');
  click(A.win, add); await sleep(2500);
  if (A.win.document.getElementById('ble-panel').classList.contains('active')) A.win.bleInterface.togglePanel();
  click(A.win, A.win.document.querySelector('#main-contacts-list .ble-contact-row')); await sleep(500);
  const idA = A.win.bleInterface.localNexoId, idB = B.win.bleInterface.localNexoId, nxB = idB.toLowerCase();
  const l2A = A.win.bleInterface.l2Fast, l2B = B.win.bleInterface.l2Fast;
  await sleep(3000);   // el intercambio de claves (kx) lleva quién tiene el canal rápido
  const has = async (b64) => (await B.win.vaultLoadMessages(idA)).some((m) => m.attachmentPayload === b64 || (m.attachmentRef && nB.files.get(m.attachmentRef) === b64));
  const chunksOf = (id) => air.filter((x) => x.indexOf('"m":"' + id) >= 0).length;
  const offers = () => air.filter((x) => x.indexOf('"type":"lq"') >= 0).length;
  const lastAttId = async () => ((await A.win.vaultLoadMessages(idB)).filter((m) => m.attachmentType).pop() || {}).msgId;
  const send = async (n, k, name) => { const f = bytes(n, k); await pickFile(A, new A.win.File([f], name, { type: 'application/octet-stream' })); const s = await waitFor(() => has(f.toString('base64')), 300000); return { s, id: await lastAttId() }; }
  const statusA = (mid) => { const s = A.win.document.querySelector('.message[data-msg-id="' + mid + '"] .msg-status'); return s ? s.className.replace('msg-status status-', '') : null; };
  const r = { caso: nombre, A_lo_tiene: l2A.supported(), B_lo_anuncia: l2A.peers.has(nxB) };
  const mal = [], chk = (k, v) => { if (!v) mal.push(k); };
  const x1 = await send(400000, 13, 'mediano.bin');
  r.mediano_llega_s = x1.s; r.mediano_trozos = chunksOf(x1.id); r.ofertas = offers();
  r.por_canal_A = nA.stats.l2pSends || 0; r.canales_abiertos_B = nB.stats.l2pHosts || 0;
  chk('mediano_llega', x1.s !== null);
  await waitFor(() => /delivered|read/.test(statusA(x1.id) || ''), 20000);
  r.mediano_estado_A = statusA(x1.id);
  chk('mediano_entregado_en_A', /delivered|read/.test(r.mediano_estado_A || ''));
  if (nombre === 'rapido') {
    chk('los_dos_lo_tienen', r.A_lo_tiene && r.B_lo_anuncia);
    chk('fue_por_el_canal', r.por_canal_A === 1 && r.mediano_trozos === 0);
    chk('rapido', x1.s !== null && x1.s < 10);
    const x2 = await send(15000, 17, 'chico.bin');
    r.chico_llega_s = x2.s; r.chico_trozos = chunksOf(x2.id);
    chk('chico_en_trozos', x2.s !== null && (nA.stats.l2pSends || 0) === 1 && r.chico_trozos > 0);
  } else if (nombre === 'canal_falla') {
    chk('se_intento', r.ofertas === 1 && r.canales_abiertos_B === 1);
    chk('llego_en_trozos', r.por_canal_A === 0 && r.mediano_trozos > 10);
    r.B_libre = !l2B.busy && !l2B.incoming.size; r.cancelaciones_B = nB.stats.l2pCancels || 0;
    chk('B_no_se_queda_esperando', r.B_libre && r.cancelaciones_B >= 1);
    const x2 = await send(300000, 17, 'otro.bin');
    r.segundo_llega_s = x2.s; r.ofertas_despues = offers();
    chk('segundo_directo_en_trozos', x2.s !== null && r.ofertas_despues === 1 && chunksOf(x2.id) > 10);
  } else {
    chk('ni_se_ofrece', !r.B_lo_anuncia && r.ofertas === 0 && r.canales_abiertos_B === 0);
    chk('llego_en_trozos', r.mediano_trozos > 10);
  }
  const errs = logs.filter((l) => / error: /.test(l) && !/JSDOMERROR|styles\.css|Not implemented/.test(l)).slice(0, 3);
  chk('sin_errores', !errs.length); if (errs.length) r.errores = errs;
  r.diag = logs.filter((l) => /\[L2\]/.test(l)).map((l) => l.replace(/ (log|warn): /, ' ').substring(0, 150)).slice(0, 6);
  r.fallos = mal; r.resultado = mal.length ? 'FALLO' : 'OK';
  try { A.win.close(); B.win.close(); } catch (e) {}
  return r;
}

(async () => {
  const casos = [['rapido', {}, {}], ['canal_falla', { l2pFail: true }, {}], ['otro_no', {}, { noL2Payload: true }]].filter((c) => !solo || c[0] === solo);
  const res = [];
  for (const c of casos) {
    let r;
    try { r = await caso(c[0], c[1], c[2]); } catch (e) { r = { caso: c[0], resultado: 'FALLO', error: String(e && e.message) }; }
    console.log('L2MEDIANO_CASO ' + JSON.stringify(r));
    res.push(r);
  }
  const ok = res.every((r) => r.resultado === 'OK');
  console.log('L2MEDIANO ' + JSON.stringify({ prueba: 'l2mediano', build: path.basename(buildDir), resultado: ok ? 'OK' : 'FALLO', casos: res.map((r) => r.caso + ':' + r.resultado).join(' ') }));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
