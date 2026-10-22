// Wi-Fi Direct: archivo grande por Wi-Fi Direct (rápido, nada del contenido por Bluetooth), pequeño por
// Bluetooth, uno de 6 MB (más que el límite de Bluetooth), vídeo original sin previa, credenciales del
// grupo nunca en claro, y si Wi-Fi Direct falla, sigue por Bluetooth.
// Uso: node wifidirect.js <dir_build> [--io-delay=25] [--b-no-wd]  (B sin Wi-Fi Direct: todo como antes)
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone, installWebCrypto } = require('./native_mock');

const buildDir = path.resolve(process.argv[2]);
const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith('--' + k)); if (!a) return d; const v = a.split('=')[1]; return v === undefined ? true : Number(v); };
const opts = { wifiDirect: true, readsContentFallback: true, retain: ['onPayloadReceived'], closeOnNoService: true, pace: [15, 15], ioDelay: arg('io-delay', 0), asymmetric: true };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
class DistLoader extends ResourceLoader {
  constructor(dir) { super(); this.dir = dir; }
  fetch(url) { const f = path.join(this.dir, decodeURIComponent(new URL(url).pathname)); return fs.existsSync(f) ? Promise.resolve(fs.readFileSync(f)) : Promise.reject(new Error('no existe ' + f)); }
}
// Todo lo que llega a cualquier teléfono por radio
const air = [];
const orig = NativePhone.prototype._processReceivedChunk;
NativePhone.prototype._processReceivedChunk = function (from, chunk, source) { air.push(String(chunk)); return orig.call(this, from, chunk, source); };
const logs = [];
async function boot(name, native) {
  native.listeners = new Map();
  const vc = new VirtualConsole();
  ['log', 'warn', 'error'].forEach((l) => vc.on(l, (...a) => logs.push(`[${name}] ${l}: ` + a.map(String).join(' ').substring(0, 250))));
  const dom = new JSDOM(fs.readFileSync(path.join(buildDir, 'dist', 'index.html'), 'utf8'), {
    url: 'https://' + name.toLowerCase() + '.nexo.test/index.html', runScripts: 'dangerously',
    resources: new DistLoader(path.join(buildDir, 'dist')), pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) { win.CapacitorCustomPlatform = { name: 'android' }; installWebCrypto(win); win.Capacitor = { Plugins: { NexoBLE: native.plugin() } }; win.HTMLElement.prototype.scrollTo = function () {}; },
  });
  const win = dom.window;
  for (let i = 0; i < 100 && !(win.NEXO && win.NEXO.initialized); i++) await sleep(100);
  await sleep(800);
  return { name, native, win };
}
const click = (win, el) => el && el.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
async function openChat(p) { click(p.win, p.win.document.querySelector('#main-contacts-list .ble-contact-row')); await sleep(500); }
async function sendText(p, t) { const i = p.win.document.getElementById('message-input'); i.value = t; i.dispatchEvent(new p.win.Event('input', { bubbles: true })); click(p.win, p.win.document.getElementById('send-btn')); }

const toastText = (p) => ((p.win.document.getElementById('perm-error-toast') || {}).textContent || '');
async function pickFile(p, file, kind) {
  click(p.win, p.win.document.querySelector('.attach-menu-item[data-type="' + (kind || 'file') + '"]')); await sleep(300);
  const fin = Array.from(p.win.document.querySelectorAll('input[type=file]')).pop();
  Object.defineProperty(fin, 'files', { value: [file], configurable: true });
  fin.dispatchEvent(new p.win.Event('change'));
}
const bytes = (n, k) => { const b = Buffer.alloc(n); for (let i = 0; i < n; i++) b[i] = (i * k + 7) & 255; return b; };
async function waitFor(fn, ms) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return Math.round((Date.now() - t0) / 100) / 10; await sleep(250); } return null; }

(async () => {
  const bNoWd = !!arg('b-no-wd', false);
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', opts), nB = new NativePhone('B', 'BB:BB:BB:BB:BB:02', Object.assign({}, opts, { wifiDirect: !bNoWd }));
  radio.add(nA); radio.add(nB); nA.load(); nB.load();
  const [A, B] = await Promise.all([boot('A', nA), boot('B', nB)]);
  const r = { build: path.basename(buildDir), B_con_wifi_direct: !bNoWd };
  A.win.bleInterface.togglePanel();
  let add = null;
  for (let i = 0; i < 400 && !add; i++) { await sleep(100); add = A.win.document.querySelector('#ble-new-device button'); if (!add && !A.win.bleInterface.isScanning) click(A.win, A.win.document.getElementById('ble-scan-btn')); }
  if (!add) { console.log('WIFIDIRECT ' + JSON.stringify({ error: 'no empareja' })); process.exit(0); }
  click(A.win, add); await sleep(2500);
  A.win.bleInterface.togglePanel();
  await openChat(A);
  const idA = A.win.bleInterface.localNexoId, idB = B.win.bleInterface.localNexoId;
  r.A_sabe_que_B_tiene = A.win.bleInterface.wifiDirect.canReach(idB);
  const has = async (b64) => (await B.win.vaultLoadMessages(idA)).some((m) => m.attachmentPayload === b64 || (m.attachmentRef && nB.files.get(m.attachmentRef) === b64));
  const chunksOf = (id) => air.filter((x) => x.indexOf('"m":"' + id) >= 0).length;
  const lastAttId = async () => ((await A.win.vaultLoadMessages(idB)).filter((m) => m.attachmentType).pop() || {}).msgId;
  const statusById = (mid) => { const s = A.win.document.querySelector('.message[data-msg-id="' + mid + '"] .msg-status'); return s ? s.className.replace('msg-status status-', '') : null; };

  // 1) 600 KB: Wi-Fi Direct
  const f1 = bytes(600000, 13);
  let t0 = Date.now();
  await pickFile(A, new A.win.File([f1], 'grande.bin', { type: 'application/octet-stream' }));
  r.grande_llega_s = await waitFor(() => has(f1.toString('base64')), 240000);
  const id1 = await lastAttId();
  r.grande_trozos_por_bluetooth = chunksOf(id1);
  r.grande_estado_A = await waitFor(() => statusById(id1) === 'delivered' || statusById(id1) === 'read', 20000) !== null ? statusById(id1) : statusById(id1);
  // 2) 20 KB: Bluetooth (no compensa montar el grupo)
  const f2 = bytes(20000, 17);
  await pickFile(A, new A.win.File([f2], 'pequeño.bin', { type: 'application/octet-stream' }));
  r.pequeño_llega_s = await waitFor(() => has(f2.toString('base64')), 60000);
  r.pequeño_trozos_por_bluetooth = chunksOf(await lastAttId());
  // 3) 6 MB: solo posible por Wi-Fi Direct
  const f3 = bytes(6 * 1024 * 1024, 7);
  const tNow = toastText(A);
  await pickFile(A, new A.win.File([f3], 'enorme.bin', { type: 'application/octet-stream' }));
  await sleep(1500);
  r.enorme_aviso = toastText(A) !== tNow ? toastText(A).substring(0, 90) : null;
  r.enorme_llega_s = bNoWd ? null : await waitFor(() => has(f3.toString('base64')), 240000);
  // 4) Vídeo (galería): original por Wi-Fi Direct
  const v = bytes(900000, 3);
  await pickFile(A, new A.win.File([v], 'clip.mp4', { type: 'video/mp4' }), 'gallery');
  r.video_llega_s = await waitFor(async () => (await B.win.vaultLoadMessages(idA)).some((m) => m.attachmentType === 'video' && (m.attachmentPayload === v.toString('base64') || (m.attachmentRef && nB.files.get(m.attachmentRef) === v.toString('base64')))), 240000);
  // 5) Falla Wi-Fi Direct → Bluetooth
  if (!bNoWd) {
    nB.opts.wdFail = true;
    const f5 = bytes(400000, 29);
    await pickFile(A, new A.win.File([f5], 'falla.bin', { type: 'application/octet-stream' }));
    r.con_fallo_llega_s = await waitFor(() => has(f5.toString('base64')), 300000);
    r.con_fallo_por_bluetooth = chunksOf(await lastAttId()) > 10;
    nB.opts.wdFail = false;
  }
  r.grupos_creados_B = nB.stats.wdGroups || 0;
  r.bytes_por_wifi_direct = nA.stats.wdBytes || 0;
  const airText = air.join('\n');
  r.credenciales_en_claro = /"passphrase"|"ssid"|DIRECT-..-NEXO/.test(airText);
  r.contenido_en_claro = airText.indexOf(f1.toString('base64').substring(5000, 5060)) >= 0;
  r.errores = logs.filter((l) => / error: /.test(l)).slice(0, 5);
  r.diag_A = logs.filter((l) => l.startsWith('[A]') && /WIFI-DIRECT/.test(l)).map((l) => l.replace(/^\[A\] \w+: /, '').substring(0, 80)).slice(0, 12);
  console.log('WIFIDIRECT ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_wifidirect.txt'), logs.join('\n'));
  process.exit(0);
})().catch((e) => { console.error('FALLO:', e.stack); fs.writeFileSync(path.join(__dirname, 'last_logs_wifidirect.txt'), logs.join('\n')); process.exit(1); });
