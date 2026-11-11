// Wi-Fi Direct con el Wi-Fi APAGADO (dueño 11-11: «primero es Wi-Fi Direct y después, si no hay otra forma, Bluetooth… no veo
// que funcione Wi-Fi Direct»). Diagnósticos reales del 08 y 10-11: «No se pudo crear el grupo (2)» en los dos teléfonos: el 2 es
// «ocupado», lo que contesta Android cuando no puede levantar Wi-Fi Direct (lo más común: el Wi-Fi apagado; Wi-Fi Direct lo
// necesita encendido aunque no haya red). Antes: se intentaba igual, fallaba, y el contacto quedaba 10 MINUTOS castigado «por
// Bluetooth» aunque se encendiera el Wi-Fi al momento; y nadie le decía al usuario por qué iba lento.
//  W1  B con el Wi-Fi apagado: el archivo llega por Bluetooth; B NO intenta montar el grupo; A lo registra, avisa al usuario
//      y NO castiga a B;
//  W2  B enciende el Wi-Fi: el siguiente archivo va YA por Wi-Fi Direct (nada por Bluetooth);
//  W3  A con el Wi-Fi apagado: ni siquiera lo ofrece; va por Bluetooth; aviso «enciende el Wi-Fi»;
//  W4  A lo enciende: el siguiente va por Wi-Fi Direct;
//  W5  con el Wi-Fi encendido el grupo no se puede montar (Android sigue «ocupado» tras los reintentos del nativo): va por
//      Bluetooth y se vuelve a probar a los 2 min (no a los 10).
// Uso: node wdoff.js <dir_build>
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone, installWebCrypto } = require('./native_mock');

const buildDir = path.resolve(process.argv[2] || path.join(__dirname, 'builds/wip'));
const opts = { wifiDirect: true, readsContentFallback: true, retain: ['onPayloadReceived'], closeOnNoService: true, pace: [15, 15], ioDelay: 0, asymmetric: true, noL2: true };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
class DL extends ResourceLoader { constructor(d) { super(); this.d = d; } fetch(u) { const f = path.join(this.d, decodeURIComponent(new URL(u).pathname)); return fs.existsSync(f) ? Promise.resolve(fs.readFileSync(f)) : Promise.reject(new Error('x')); } }
const air = [];
const orig = NativePhone.prototype._processReceivedChunk;
NativePhone.prototype._processReceivedChunk = function (from, chunk, source) { air.push(String(chunk)); return orig.call(this, from, chunk, source); };
const logs = [];
async function boot(name, native) {
  native.listeners = new Map();
  const vc = new VirtualConsole(); ['log', 'warn', 'error'].forEach((l) => vc.on(l, (...a) => logs.push(`[${name}] ${l}: ` + a.map(String).join(' ').substring(0, 250))));
  const dom = new JSDOM(fs.readFileSync(path.join(buildDir, 'dist', 'index.html'), 'utf8'), { url: 'https://' + name.toLowerCase() + '.nexo.test/index.html', runScripts: 'dangerously', resources: new DL(path.join(buildDir, 'dist')), pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) { win.CapacitorCustomPlatform = { name: 'android' }; installWebCrypto(win); win.Capacitor = { Plugins: { NexoBLE: native.plugin() } }; win.HTMLElement.prototype.scrollTo = function () {}; } });
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
async function waitFor(fn, ms) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return Math.round((Date.now() - t0) / 100) / 10; await sleep(250); } return null; }

(async () => {
  const r = { prueba: 'wdoff', build: path.basename(buildDir) };
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', opts), nB = new NativePhone('B', 'BB:BB:BB:BB:BB:02', Object.assign({}, opts));
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
  const wdA = A.win.bleInterface.wifiDirect;
  r.A_sabe_que_B_tiene = await waitFor(() => wdA.peers.has(nxB), 20000) !== null;
  const has = async (b64) => (await B.win.vaultLoadMessages(idA)).some((m) => m.attachmentPayload === b64 || (m.attachmentRef && nB.files.get(m.attachmentRef) === b64));
  const chunksOf = (id) => air.filter((x) => x.indexOf('"m":"' + id) >= 0).length;
  const lastAttId = async () => ((await A.win.vaultLoadMessages(idB)).filter((m) => m.attachmentType).pop() || {}).msgId;
  const offers = () => air.filter((x) => x.indexOf('"type":"wq"') >= 0).length;
  const avisos = [];
  A.win.addEventListener('nexo:wd:wifiOff', (e) => avisos.push(e && e.detail && e.detail.peer ? 'otro' : 'yo'));
  const logA = (re) => logs.some((l) => l.startsWith('[A]') && re.test(l));
  const castigo = () => Math.round(((wdA.failUntil[nxB] || 0) - Date.now()) / 1000);
  const send = async (n, k, name) => { const f = bytes(n, k); await pickFile(A, new A.win.File([f], name, { type: 'application/octet-stream' })); const s = await waitFor(() => has(f.toString('base64')), 300000); return { s, id: await lastAttId() }; };
  const SIZE = 130000;

  // ---- W1: B con el Wi-Fi apagado ----
  nB.opts.wifiOff = true;
  let x = await send(SIZE, 13, 'uno.bin');
  r.W1_llega_s = x.s;
  r.W1_por_bluetooth = chunksOf(x.id) > 10;
  r.W1_B_no_intenta_montar_el_grupo = (nB.stats.wdHostCalls || 0) === 0;
  r.W1_A_lo_registra = logA(/Wi-Fi APAGADO en el otro teléfono/);
  r.W1_aviso = avisos.indexOf('otro') >= 0;
  r.W1_castigo_s = castigo();
  // ---- W2: B enciende el Wi-Fi: el siguiente va YA por Wi-Fi Direct ----
  nB.opts.wifiOff = false;
  await sleep(4500);
  const wd0 = nA.stats.wdBytes || 0;
  x = await send(SIZE, 17, 'dos.bin');
  r.W2_llega_s = x.s;
  r.W2_por_wifi_direct = (nA.stats.wdBytes || 0) > wd0;
  r.W2_trozos_por_bluetooth = chunksOf(x.id);
  // ---- W3: A con el Wi-Fi apagado: ni lo ofrece ----
  nA.opts.wifiOff = true;
  await sleep(4500);
  const of0 = offers(), wd1 = nA.stats.wdBytes || 0;
  x = await send(SIZE, 19, 'tres.bin');
  r.W3_llega_s = x.s;
  r.W3_por_bluetooth = chunksOf(x.id) > 10 && (nA.stats.wdBytes || 0) === wd1;
  r.W3_sin_oferta = offers() === of0;
  r.W3_A_lo_registra = logA(/Wi-Fi APAGADO en este teléfono/);
  r.W3_aviso = avisos.indexOf('yo') >= 0;
  r.W3_castigo_s = castigo();
  // ---- W4: A lo enciende: Wi-Fi Direct otra vez ----
  nA.opts.wifiOff = false;
  await sleep(4500);
  const wd2 = nA.stats.wdBytes || 0;
  x = await send(SIZE, 23, 'cuatro.bin');
  r.W4_llega_s = x.s;
  r.W4_por_wifi_direct = (nA.stats.wdBytes || 0) > wd2 && chunksOf(x.id) === 0;
  // ---- W5: con el Wi-Fi encendido, el grupo no se puede montar ----
  nB.opts.wdBusy = true;
  x = await send(SIZE, 29, 'cinco.bin');
  r.W5_llega_s = x.s;
  r.W5_por_bluetooth = chunksOf(x.id) > 10;
  r.W5_castigo_s = castigo();
  r.errores = logs.filter((l) => / error: /.test(l) && !/JSDOMERROR|styles\.css|Not implemented/.test(l)).slice(0, 5);
  r.diag_A = logs.filter((l) => l.startsWith('[A]') && /WIFI-DIRECT/.test(l)).map((l) => l.replace(/^\[A\] \w+: /, '').substring(0, 130)).slice(0, 14);
  const ok = r.A_sabe_que_B_tiene && r.W1_llega_s !== null && r.W1_por_bluetooth && r.W1_B_no_intenta_montar_el_grupo && r.W1_A_lo_registra && r.W1_aviso && r.W1_castigo_s <= 0 &&
    r.W2_llega_s !== null && r.W2_por_wifi_direct && r.W2_trozos_por_bluetooth === 0 &&
    r.W3_llega_s !== null && r.W3_por_bluetooth && r.W3_sin_oferta && r.W3_A_lo_registra && r.W3_aviso && r.W3_castigo_s <= 0 &&
    r.W4_llega_s !== null && r.W4_por_wifi_direct &&
    r.W5_llega_s !== null && r.W5_por_bluetooth && r.W5_castigo_s > 60 && r.W5_castigo_s <= 125 && !r.errores.length;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('WDOFF ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_wdoff.txt'), logs.join('\n'));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('WDOFF ' + JSON.stringify({ prueba: 'wdoff', resultado: 'FALLO', error: String(e && e.message).replace(/"/g, "'") })); console.error(e && e.stack); fs.writeFileSync(path.join(__dirname, 'last_logs_wdoff.txt'), logs.join('\n')); process.exit(1); });
