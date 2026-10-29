// Ronda 2798 (pedido del dueño): aviso de MALA SEÑAL. Por Bluetooth, si el MTU se quedó pequeño (p. ej. 23, sin
// negociar) el enlace es muy lento; el subtítulo del chat lo marca "⚠ señal débil" para que el dueño entienda la
// lentitud. A y B emparejados por Bluetooth; forzamos el MTU del enlace activo y comprobamos el subtítulo.
// Uso: node malasenal.js <dir_build>
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone, installWebCrypto } = require('./native_mock');

const buildDir = path.resolve(process.argv[2]);
const opts = { readsContentFallback: true, retain: ['onPayloadReceived'], closeOnNoService: true, pace: [15, 15], ioDelay: 25, asymmetric: true, noL2: true };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const normMac = (m) => (m || '').toString().toLowerCase().replace(/[:-]/g, '').trim();
class DL extends ResourceLoader { constructor(d) { super(); this.d = d; } fetch(u) { const f = path.join(this.d, decodeURIComponent(new URL(u).pathname)); return fs.existsSync(f) ? Promise.resolve(fs.readFileSync(f)) : Promise.reject(new Error('x')); } }
const logs = [];
async function boot(name, native) {
  const vc = new VirtualConsole();
  ['log', 'warn', 'error'].forEach((l) => vc.on(l, (...a) => logs.push(`[${name}] ${l}: ` + a.map(String).join(' ').substring(0, 250))));
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
async function openChat(p) { click(p.win, p.win.document.querySelector('#main-contacts-list .ble-contact-row')); await sleep(600); }
// Ronda 2826: el transporte se muestra como ICONO (no la palabra); el título (tooltip) conserva «Bluetooth»/«señal
// débil». Se miran los dos (título + texto visible) para comprobar el transporte y el aviso de señal.
const sub = (p) => { var el = p.win.document.getElementById('chat-contact-subtitle') || {}; return (el.title || '') + ' ' + (el.textContent || ''); };
async function refresh(p) { p.win.dispatchEvent(new p.win.CustomEvent('nexo:ble:linkChange', { detail: {} })); await sleep(200); }
async function waitFor(fn, ms) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return true; await sleep(150); } return false; }

(async () => {
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', opts), nB = new NativePhone('B', 'BB:BB:BB:BB:BB:02', opts);
  [nA, nB].forEach((n) => { radio.add(n); n.load(); });
  const [A, B] = await Promise.all([boot('A', nA), boot('B', nB)]);
  const r = { build: path.basename(buildDir) };
  // Emparejar por Bluetooth
  A.win.bleInterface.togglePanel();
  let add = null;
  for (let i = 0; i < 400 && !add; i++) { await sleep(100); add = A.win.document.querySelector('#ble-new-device > div button'); if (!add && !A.win.bleInterface.isScanning) click(A.win, A.win.document.getElementById('ble-scan-btn')); }
  if (!add) { console.log('MALASENAL ' + JSON.stringify({ resultado: 'FAIL', error: 'no empareja' })); process.exit(0); }
  click(A.win, add); await sleep(2500);
  A.win.bleInterface.togglePanel();
  await openChat(A);
  const bi = A.win.bleInterface;
  const dev = bi._activeChatDeviceId;
  r.hay_device_activo = !!dev;
  // Esperar a que el subtítulo diga "Bluetooth" (enlace por Bluetooth)
  r.subtitulo_bluetooth = await waitFor(() => /Bluetooth/.test(sub(A)), 10000);
  await refresh(A);
  r.normal_sin_aviso = /Bluetooth/.test(sub(A)) && !/señal débil/.test(sub(A));

  // Forzar MTU bajo (23) en el enlace activo → debe avisar
  bi._mtuByDevice.set(normMac(dev), 23);
  await refresh(A);
  r.sub_con_mtu_bajo = sub(A);
  r.mtu_bajo_avisa = /señal débil/.test(sub(A));

  // MTU normal (247) → sin aviso
  bi._mtuByDevice.set(normMac(dev), 247);
  await refresh(A);
  r.mtu_ok_sin_aviso = /Bluetooth/.test(sub(A)) && !/señal débil/.test(sub(A));

  r.errores = logs.filter((l) => /TypeError|undefined is not/.test(l)).slice(0, 4);
  const ok = r.hay_device_activo && r.subtitulo_bluetooth && r.normal_sin_aviso && r.mtu_bajo_avisa && r.mtu_ok_sin_aviso && r.errores.length === 0;
  r.resultado = ok ? 'OK' : 'FAIL';
  console.log('MALASENAL ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_malasenal.txt'), logs.join('\n'));
  process.exit(0);
})().catch((e) => { console.error('FALLO:', e.stack); fs.writeFileSync(path.join(__dirname, 'last_logs_malasenal.txt'), logs.join('\n')); process.exit(1); });
