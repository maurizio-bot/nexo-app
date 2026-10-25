// Ubicación: A envía su ubicación (plugin Geolocation simulado) y debe verse en A y llegar a B, cifrada.
// --gps=indoor: el GPS no responde pero hay posición por red/última conocida (debe enviarla);
// --gps=timeout: nada responde; --gps=off: ubicación del teléfono apagada (deben avisar, no quedarse mudos).
// Uso: node location.js <dir_build> [--io-delay=25] [--gps=ok|indoor|timeout|off]
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone, installWebCrypto } = require('./native_mock');

const buildDir = path.resolve(process.argv[2]);
const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith('--' + k)); if (!a) return d; const v = a.split('=')[1]; return v === undefined ? true : Number(v); };
const opts = { readsContentFallback: true, retain: ['onPayloadReceived'], closeOnNoService: true, pace: [15, 15], ioDelay: arg('io-delay', 0), asymmetric: true };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
class DistLoader extends ResourceLoader {
  constructor(dir) { super(); this.dir = dir; }
  fetch(url) { const f = path.join(this.dir, decodeURIComponent(new URL(url).pathname)); return fs.existsSync(f) ? Promise.resolve(fs.readFileSync(f)) : Promise.reject(new Error('no existe ' + f)); }
}
// Todo lo que llega a cualquier teléfono por radio
const air = [];
const orig = NativePhone.prototype._processReceivedChunk;
NativePhone.prototype._processReceivedChunk = function (from, chunk, source) { air.push(String(chunk)); return orig.call(this, from, chunk, source); };
const gpsMode = (process.argv.find((x) => x.startsWith('--gps=')) || '--gps=ok').split('=')[1];
const geoCalls = [];
function geo(name) {
  return {
    checkPermissions: async () => ({ location: 'granted' }),
    requestPermissions: async () => ({ location: 'granted' }),
    getCurrentPosition: (o) => {
      geoCalls.push(name + (o && o.enableHighAccuracy ? ':gps' : ':red'));
      const ok = { coords: { latitude: 19.4326, longitude: -99.1332, accuracy: o && o.enableHighAccuracy ? 12 : 900 } };
      if (gpsMode === 'off') return Promise.reject(new Error('Location services are not enabled'));
      if (gpsMode === 'timeout' || (gpsMode === 'indoor' && o && o.enableHighAccuracy)) return new Promise((res, rej) => setTimeout(() => rej(new Error('Timeout expired')), (o && o.timeout) || 15000));
      return Promise.resolve(ok);
    },
  };
}
const logs = [];
async function boot(name, native) {
  native.listeners = new Map();
  const vc = new VirtualConsole();
  ['log', 'warn', 'error'].forEach((l) => vc.on(l, (...a) => logs.push(`[${name}] ${l}: ` + a.map(String).join(' ').substring(0, 250))));
  const dom = new JSDOM(fs.readFileSync(path.join(buildDir, 'dist', 'index.html'), 'utf8'), {
    url: 'https://' + name.toLowerCase() + '.nexo.test/index.html', runScripts: 'dangerously',
    resources: new DistLoader(path.join(buildDir, 'dist')), pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) { win.CapacitorCustomPlatform = { name: 'android' }; installWebCrypto(win); win.Capacitor = { Plugins: { NexoBLE: native.plugin(), Geolocation: geo(name) } }; win.HTMLElement.prototype.scrollTo = function () {}; },
  });
  const win = dom.window;
  for (let i = 0; i < 100 && !(win.NEXO && win.NEXO.initialized); i++) await sleep(100);
  await sleep(800);
  return { name, native, win };
}
const click = (win, el) => el && el.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
async function openChat(p) { click(p.win, p.win.document.querySelector('#main-contacts-list .ble-contact-row')); await sleep(500); }
async function sendText(p, t) { const i = p.win.document.getElementById('message-input'); i.value = t; i.dispatchEvent(new p.win.Event('input', { bubbles: true })); click(p.win, p.win.document.getElementById('send-btn')); }

(async () => {
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', opts), nB = new NativePhone('B', 'BB:BB:BB:BB:BB:02', opts);
  radio.add(nA); radio.add(nB); nA.load(); nB.load();
  const [A, B] = await Promise.all([boot('A', nA), boot('B', nB)]);
  const r = { build: path.basename(buildDir), gps: gpsMode };
  A.win.bleInterface.togglePanel();
  let add = null;
  for (let i = 0; i < 400 && !add; i++) { await sleep(100); add = A.win.document.querySelector('#ble-new-device > div button'); if (!add && !A.win.bleInterface.isScanning) click(A.win, A.win.document.getElementById('ble-scan-btn')); }
  click(A.win, add); await sleep(2500);
  A.win.bleInterface.togglePanel();
  await openChat(A);
  await sendText(A, 'hola'); await sleep(2500);
  const idA = A.win.bleInterface.localNexoId;
  const toastNow = () => ((A.win.document.getElementById('perm-error-toast') || {}).textContent || '');
  click(A.win, A.win.document.querySelector('.attach-menu-item[data-type="location"]'));
  let toast = ''; const avisos = [];
  const t0 = Date.now();
  let enA = false, enB = null;
  while (Date.now() - t0 < 45000) {
    await sleep(500);
    if (toastNow() && toastNow() !== toast) { toast = toastNow(); avisos.push(toast.substring(0, 80)); }
    enA = Array.from(A.win.document.querySelectorAll('#messages-container .message.own')).some((m) => /Ubicaci[oó]n/.test(m.textContent));
    enB = (await B.win.vaultLoadMessages(idA)).find((m) => m.attachmentType === 'location' || /"attachmentType":"location"/.test(String(m.content)));
    if (enB || ((gpsMode === 'timeout' || gpsMode === 'off') && avisos.length > 1)) break;
  }
  r.pide_posicion = geoCalls;
  r.se_ve_en_A = enA;
  r.llega_a_B_s = enB ? Math.round((Date.now() - t0) / 100) / 10 : null;
  r.coordenadas_B = enB ? String(enB.content).indexOf('19.4326') >= 0 : null;
  await openChat(B); await sleep(800);
  r.se_ve_en_B = Array.from(B.win.document.querySelectorAll('#messages-container .message')).some((m) => /Ubicaci[oó]n/.test(m.textContent));
  r.estado_A = (Array.from(A.win.document.querySelectorAll('#messages-container .message.own')).filter((m) => /Ubicaci[oó]n/.test(m.textContent)).map((m) => (m.querySelector('.msg-status') || {}).className || '').pop() || '').replace('msg-status status-', '');
  r.avisos_A = avisos;
  r.en_claro = air.join('\n').indexOf('19.4326') >= 0;
  r.registros_A = logs.filter((l) => l.startsWith('[A]') && /LOCATION|Ubicaci|ATTACH|rejected|Error/i.test(l)).map((l) => l.substring(0, 160)).slice(0, 10);
  console.log('LOCATION ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_location.txt'), logs.join('\n'));
  process.exit(0);
})().catch((e) => { console.error('FALLO:', e.stack); fs.writeFileSync(path.join(__dirname, 'last_logs_location.txt'), logs.join('\n')); process.exit(1); });
