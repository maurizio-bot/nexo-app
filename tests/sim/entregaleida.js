// Auditoría 23-11 (T-E1 + T-L1): «entregado ✓✓» por Wi-Fi Direct / canal rápido solo cuando quien recibe YA LO DESCIFRÓ.
// Antes el ✓✓ era el byte del socket: se marcaba completo y se confirmaba al tener los bytes; si no se podía leer (desfase de
// claves, contenido dañado) el archivo se perdía en silencio con ✓✓ en quien envía (y los trozos de después se descartaban).
// Casos (dos teléfonos cada uno):
//  l2_ilegible  solo Bluetooth, canal rápido: B recibe por el canal algo que no puede descifrar → no confirma; A NO lo da por
//               entregado por el canal y sigue en trozos: B lo tiene idéntico y A termina en ✓✓.
//  wd_ilegible  lo mismo por Wi-Fi Direct (sigue por el canal rápido o en trozos).
//  enlace       las respuestas 'la'/'ln', 'wa'/'wn'/'wf' y 'ga'/'gn' solo valen desde el enlace al que se ofreció; el canal y
//               el grupo llevan token ('la' con tk; credenciales con t); una oferta 'wq' de un desconocido (no contacto y sin
//               sesión de puente) se rechaza con 'no es contacto' (su archivo llega igual en trozos).
// Uso: node entregaleida.js [dir_build] [--solo=caso]
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
  await sleep(3000);
  if (pA.wifiDirect) { await waitFor(() => A.win.bleInterface.wifiDirect.peers.has(nxB), 20000); await sleep(3500); }
  const has = async (b64) => (await B.win.vaultLoadMessages(idA)).some((m) => m.attachmentPayload === b64 || (m.attachmentRef && nB.files.get(m.attachmentRef) === b64));
  const lastAttId = async () => ((await A.win.vaultLoadMessages(idB)).filter((m) => m.attachmentType).pop() || {}).msgId;
  const statusA = (mid) => { const s = A.win.document.querySelector('.message[data-msg-id="' + mid + '"] .msg-status'); return s ? s.className.replace('msg-status status-', '') : null; };
  const r = { caso: nombre };
  const mal = [], chk = (k, v) => { if (!v) mal.push(k); };
  if (nombre === 'enlace') {
    const ble = A.win.bleInterface, other = 'CC:CC:CC:CC:CC:09';
    const devB = Array.from(ble._macToNexoId.entries()).filter((e) => String(e[1]).toLowerCase() === nxB).map((e) => e[0])[0];
    r.dev_B = devB || null;
    chk('enlace_de_B', !!devB);
    let hit = 0;
    const l2 = ble.l2Fast, wd = ble.wifiDirect, big = ble.bigFiles;
    l2.out.set('t1', { deviceId: devB, onNo: () => { hit |= 1; }, onAccept: () => { hit |= 2; } });
    l2.handle({ type: 'ln', id: 't1', from: nxB, why: 'x' }, other); l2.handle({ type: 'la', id: 't1', from: nxB, psm: 129, tk: 'a' }, other);
    r.l2_otro_enlace = hit; chk('l2_ignora_otro_enlace', hit === 0);
    l2.handle({ type: 'ln', id: 't1', from: nxB, why: 'x' }, devB); r.l2_mismo_enlace = hit; chk('l2_vale_el_mismo', hit === 1);
    l2.out.delete('t1'); hit = 0;
    wd.out.set('t2', { deviceId: devB, onNo: () => { hit |= 1; }, onCreds: () => { hit |= 2; }, onDone: () => { hit |= 4; } });
    ['wn', 'wa', 'wf'].forEach((t) => wd.handle({ type: t, id: 't2', from: nxB, c: 'x' }, other));
    r.wd_otro_enlace = hit; chk('wd_ignora_otro_enlace', hit === 0);
    wd.handle({ type: 'wf', id: 't2', from: nxB }, devB); r.wd_mismo_enlace = hit; chk('wd_vale_el_mismo', hit === 4);
    wd.out.delete('t2'); hit = 0;
    if (big) {
      big.st.t3 = { nx: nxB, via: 'l2' };
      const bdev = big._dev(nxB, 'l2');
      big.out.set('t3', { onNo: () => { hit |= 1; }, onAccept: () => { hit |= 2; } });
      big.handle({ type: 'gn', id: 't3', from: nxB }, other); big.handle({ type: 'ga', id: 't3', from: nxB, psm: 130, token: 'x'.repeat(32) }, other);
      r.big_otro_enlace = hit; chk('big_ignora_otro_enlace', hit === 0);
      big.handle({ type: 'gn', id: 't3', from: nxB }, bdev || devB); r.big_mismo_enlace = hit; chk('big_vale_el_mismo', hit === 1);
      big.out.delete('t3'); delete big.st.t3;
    }
    // una oferta 'wq' de un desconocido: «no es contacto» (sin montar grupo)
    const sent = [];
    const ctl0 = wd._ctl; wd._ctl = function (d, o) { sent.push(o); return Promise.resolve(); };
    const okSup = wd.supported; wd.supported = () => true;
    const g0 = nA.stats.wdHostCalls || 0;
    wd.handle({ type: 'wq', id: 't4', size: 200000, from: 'nx9zz9zz9z', pk: 'A'.repeat(88), meta: {} }, other);
    await sleep(300);
    wd._ctl = ctl0; wd.supported = okSup;
    r.wq_desconocido = sent.map((o) => o.type + ':' + (o.why || '')).join(',');
    chk('wq_desconocido_no', sent.length === 1 && sent[0].type === 'wn' && /contacto/.test(sent[0].why) && (nA.stats.wdHostCalls || 0) === g0);
    wd.busy = false; wd.incoming.clear();
  } else {
    const f = bytes(400000, 13);
    await pickFile(A, new A.win.File([f], 'ilegible.bin', { type: 'application/octet-stream' }));
    r.llega_s = await waitFor(() => has(f.toString('base64')), 300000);
    const mid = await lastAttId();
    chk('llega_identico', r.llega_s !== null);
    await waitFor(() => /delivered|read/.test(statusA(mid) || ''), 30000);
    r.estado_A = statusA(mid);
    chk('entregado_en_A', /delivered|read/.test(r.estado_A || ''));
    r.l2_sin_confirmar = nA.stats.l2pNoAck || 0; r.l2_confirmados = nA.stats.l2pSends || 0;
    r.wd_sin_confirmar = nA.stats.wdNoAck || 0;
    r.la_con_token = air.some((x) => x.indexOf('"type":"la"') >= 0 && /"tk":"[0-9a-f]{32}"/.test(x));
    if (nombre === 'l2_ilegible') { chk('canal_no_confirmo', r.l2_sin_confirmar >= 1 && r.l2_confirmados === 0); chk('la_lleva_token', r.la_con_token); }
    else chk('wd_no_confirmo', r.wd_sin_confirmar >= 1);
    r.diag = logs.filter((l) => /no se pudo descifrar|sin confirmar/i.test(l)).map((l) => l.substring(0, 160)).slice(0, 4);
  }
  const errs = logs.filter((l) => / error: /.test(l) && !/JSDOMERROR|styles\.css|Not implemented/.test(l)).slice(0, 3);
  chk('sin_errores', !errs.length); if (errs.length) r.errores = errs;
  r.fallos = mal; r.resultado = mal.length ? 'FALLO' : 'OK';
  try { A.win.close(); B.win.close(); } catch (e) {}
  return r;
}

(async () => {
  const WD = { wifiDirect: true };
  const casos = [['l2_ilegible', {}, { rxCorrupt: true }], ['wd_ilegible', WD, Object.assign({ rxCorrupt: true }, WD)], ['enlace', {}, {}]].filter((c) => !solo || c[0] === solo);
  const res = [];
  for (const c of casos) {
    let r;
    try { r = await caso(c[0], c[1], c[2]); } catch (e) { r = { caso: c[0], resultado: 'FALLO', error: String(e && e.stack || e) }; }
    console.log('ENTREGALEIDA_CASO ' + JSON.stringify(r));
    res.push(r);
  }
  const ok = res.every((r) => r.resultado === 'OK');
  console.log('ENTREGALEIDA ' + JSON.stringify({ prueba: 'entregaleida', build: path.basename(buildDir), resultado: ok ? 'OK' : 'FALLO', casos: res.map((r) => r.caso + ':' + r.resultado).join(' ') }));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
