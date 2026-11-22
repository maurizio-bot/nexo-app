// 3261 (diseño del dueño 20-11): elegir Wi-Fi Direct por TIEMPO ESTIMADO. Wi-Fi Direct no tiene preferencia sobre internet: entra si
// llega antes. Hallazgo que lo motivó (19-11): con el contacto en línea por internet, un archivo NUNCA probaba Wi-Fi Direct aunque
// estuviera al lado por Bluetooth (una foto tardó 25 s por los relés; por Wi-Fi Direct ≈ 3 s).
// A y B se conocen, cada uno en su Wi-Fi (módems distintos) con internet por relés, y están CERCA (Bluetooth listo, los dos con Wi-Fi Direct).
//  0) wdPlan (pura): tiempos estimados y cuándo se cambia (1,5 veces más rápido y ≥ 3 s menos).
//  1) Internet LENTO medido (10 KB/s): un archivo de 300 KB va por Wi-Fi Direct (no sube nada a los relés) y llega.
//  2) Internet RÁPIDO medido (8 MB/s): el mismo archivo sigue por internet (Wi-Fi Direct ni se intenta).
//  3) Internet lento y Wi-Fi Direct ROTO: lo intenta, falla y el archivo llega por INTERNET (no se arrastra por Bluetooth).
// Uso: node wdplan.js <dir_build>
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone, installWebCrypto } = require('./native_mock');
const { NostrRelay } = require('./nostr_relay');
const { importSrc } = require('./srcmod');

const buildDir = path.resolve(process.argv[2]);
const base = { readsContentFallback: true, retain: ['onPayloadReceived', 'onLanMessage', 'onLanUp', 'onLanDown'], closeOnNoService: true, pace: [15, 15], ioDelay: 25, asymmetric: true, noTor: true, wifiDirect: true, noL2: true };
let RELAYS = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
class DistLoader extends ResourceLoader {
  constructor(dir) { super(); this.dir = dir; }
  fetch(url) { const f = path.join(this.dir, decodeURIComponent(new URL(url).pathname)); return fs.existsSync(f) ? Promise.resolve(fs.readFileSync(f)) : Promise.reject(new Error('no existe ' + f)); }
}
const logs = [];
async function boot(name, native) {
  native.listeners = new Map();
  const vc = new VirtualConsole();
  ['log', 'warn', 'error'].forEach((l) => vc.on(l, (...a) => logs.push(`${new Date().toISOString().substring(14, 23)} [${name}] ${l}: ` + a.map(String).join(' ').substring(0, 250))));
  let vis = 'visible';
  const dom = new JSDOM(fs.readFileSync(path.join(buildDir, 'dist', 'index.html'), 'utf8'), {
    url: 'https://' + name.toLowerCase() + '.nexo.test/index.html', runScripts: 'dangerously',
    resources: new DistLoader(path.join(buildDir, 'dist')), pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) {
      win.NEXO_NET_RELAYS = RELAYS; win.CapacitorCustomPlatform = { name: 'android' }; installWebCrypto(win); win.Capacitor = { Plugins: { NexoBLE: native.plugin() } }; win.HTMLElement.prototype.scrollTo = function () {};
      Object.defineProperty(win.document, 'visibilityState', { configurable: true, get: () => vis });
      Object.defineProperty(win.document, 'hidden', { configurable: true, get: () => vis === 'hidden' });
    },
  });
  const win = dom.window;
  for (let i = 0; i < 100 && !(win.NEXO && win.NEXO.initialized); i++) await sleep(100);
  await sleep(800);
  const p = { name, native, win };
  p.setActive = (active) => { vis = active ? 'visible' : 'hidden'; win.document.dispatchEvent(new win.Event('visibilitychange')); native.setAppActive(active); };
  return p;
}
const click = (win, el) => el && el.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
async function openChatWith(p, name) {
  const row = Array.from(p.win.document.querySelectorAll('#main-contacts-list .ble-contact-row')).find((r) => (r.querySelector('.ble-contact-name') || {}).textContent === name);
  click(p.win, row); await sleep(500); return !!row;
}
function sendText(p, t) { const i = p.win.document.getElementById('message-input'); i.value = t; i.dispatchEvent(new p.win.Event('input', { bubbles: true })); click(p.win, p.win.document.getElementById('send-btn')); }
async function addFound(p, name) {
  let add = null;
  const find = () => { const row = Array.from(p.win.document.querySelectorAll('#ble-new-device > div')).find((d) => (d.querySelector('span') || {}).textContent === name); return row && row.querySelector('button'); };
  for (let i = 0; i < 400 && !add; i++) { await sleep(100); add = find(); if (!add && !p.win.bleInterface.isScanning) click(p.win, p.win.document.getElementById('ble-scan-btn')); }
  click(p.win, add); await sleep(2000);
  return !!add;
}
async function waitFor(fn, ms) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return Math.round((Date.now() - t0) / 100) / 10; await sleep(200); } return null; }
const save = () => fs.writeFileSync(path.join(__dirname, 'last_logs_wdplan.txt'), logs.join('\n'));

async function sendFile(p, name, bytes) {
  const b = Buffer.alloc(bytes); for (let i = 0; i < b.length; i++) b[i] = (i * 31 + name.length * 7) & 255;
  click(p.win, p.win.document.querySelector('.attach-menu-item[data-type="file"]')); await sleep(100);
  const fin = Array.from(p.win.document.querySelectorAll('input[type=file]')).pop();
  Object.defineProperty(fin, 'files', { configurable: true, value: [new p.win.File([b], name, { type: 'application/octet-stream' })] });
  fin.dispatchEvent(new p.win.Event('change'));
  return b;
}
(async () => {
  const r = { prueba: 'wdplan', build: path.basename(buildDir) };
  const { wdPlan, WD_MIN_BYTES } = await importSrc('ui/wifi_direct.js');
  const p1 = wdPlan(4000000, 6.8), p2 = wdPlan(409600, null), p3 = wdPlan(100000, null), p4 = wdPlan(4000000, 2000), p5 = wdPlan(4000000, 600);
  r.P_lento_gana_wd = p1.use === true && p1.tNet > 500 && p1.tWd < 6;
  r.P_sin_medida_supone_reles = p2.use === true && Math.abs(p2.tNet - 13.3) < 0.2 && Math.abs(p2.tWd - 4.1) < 0.1;
  r.P_chico_no_compensa = p3.use === false;
  r.P_internet_rapido_se_queda = p4.use === false && p4.tNet < p4.tWd;
  r.P_por_poco_no_cambia = p5.use === false; // 6,5 s contra 4,8 s: no es 1,5 veces más rápido
  r.P_minimo = WD_MIN_BYTES === 100000;

  const r1 = new NostrRelay(), r2 = new NostrRelay({ authRequired: true });
  RELAYS = [await r1.start(), await r2.start()];
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', Object.assign({}, base, { wifi: 'casa' })), nB = new NativePhone('B', 'BB:BB:BB:BB:BB:02', Object.assign({}, base, { wifi: 'oficina' }));
  [nA, nB].forEach((n) => { radio.add(n); n.load(); });
  const A = await boot('A', nA), B = await boot('B', nB);
  const idA = A.win.bleInterface.localNexoId.toLowerCase(), idB = B.win.bleInterface.localNexoId.toLowerCase();
  A.win.bleInterface.togglePanel(); const paired = await addFound(A, 'B'); A.win.bleInterface.togglePanel();
  if (!paired) { r.error = 'no empareja'; r.resultado = 'FALLO'; console.log('WDPLAN ' + JSON.stringify(r)); save(); process.exit(1); }
  await openChatWith(A, 'B'); sendText(A, 'hola B'); await sleep(3000);
  await openChatWith(B, 'A'); sendText(B, 'hola A'); await sleep(3000);
  A.win.bleInterface.net.tick(); B.win.bleInterface.net.tick();
  const bi = A.win.bleInterface;
  r.en_linea_por_internet_y_cerca = await waitFor(() => bi.linkOf(idB) === 'internet' && !!bi._bleReadyFor(idB) && bi.wifiDirect.canReach(idB), 90000) !== null;
  const got = (buf) => async () => (await B.win.vaultLoadMessages(idA)).some((m) => m.attachmentType && !m._own && (m.attachmentPayload || nB.files.get(m.attachmentRef)) === buf.toString('base64'));
  const evs = () => r1.events.length + r2.events.length;
  const planLog = (dest) => logs.filter((l) => /\[A\].*está en línea por internet y cerca por Bluetooth/.test(l) && l.indexOf('→ ' + dest) >= 0).length;

  // 1) internet lento medido → Wi-Fi Direct
  A.win.NEXO_noteSpeed('internet', 'out', 200 * 1024, 20000);
  r.velocidad_medida_kbs = A.win.NEXO_recentSpeed('internet', 'out');
  let wd0 = nA.stats.wdBytes || 0, ev0 = evs(), bt0 = nA.sent.length;
  const f1 = await sendFile(A, 'lento.bin', 300000);
  r.L_llega_s = await waitFor(got(f1), 90000);
  r.L_por_wifi_direct = (nA.stats.wdBytes || 0) - wd0 >= 300000;
  r.L_eventos_a_los_reles = evs() - ev0;
  r.L_sin_subir_a_los_reles = r.L_eventos_a_los_reles <= 6; // nada del archivo (solo saludos/confirmaciones sueltas)
  r.L_decision_en_el_registro = planLog('Wi-Fi Direct') >= 1;
  await sleep(3000);

  // 2) internet rápido medido → sigue por internet
  A.win.NEXO_noteSpeed('internet', 'out', 8 * 1024 * 1024, 1000);
  wd0 = nA.stats.wdBytes || 0; const off0 = nA.stats.wdOffers || 0, g0 = nB.stats.wdGroups || 0;
  const f2 = await sendFile(A, 'rapido.bin', 300000);
  r.R_llega_s = await waitFor(got(f2), 120000);
  r.R_sin_wifi_direct = (nA.stats.wdBytes || 0) === wd0 && (nB.stats.wdGroups || 0) === g0;
  r.R_decision_en_el_registro = planLog('internet') >= 1;
  await sleep(3000);

  // 3) internet lento y Wi-Fi Direct roto → lo intenta y el archivo llega por internet (no por Bluetooth)
  A.win.NEXO_noteSpeed('internet', 'out', 200 * 1024, 20000);
  nA.opts.wdFail = true;
  wd0 = nA.stats.wdBytes || 0; ev0 = evs(); bt0 = nA.sent.length;
  const f3 = await sendFile(A, 'roto.bin', 300000);
  r.F_llega_s = await waitFor(got(f3), 180000);
  r.F_lo_intento = logs.some((l) => /\[A\].*no salió.*sigue por internet/.test(l));
  r.F_por_internet = evs() - ev0 >= 3 && (nA.stats.wdBytes || 0) === wd0;
  r.F_escrituras_bluetooth = nA.sent.length - bt0;
  r.F_no_por_bluetooth = r.F_escrituras_bluetooth < 400; // 300 KB por Bluetooth serían miles de escrituras
  r.una_copia_de_cada = (await B.win.vaultLoadMessages(idA)).filter((m) => m.attachmentType && !m._own).length === 3;
  r.errores = logs.filter((l) => /ilegible|Error procesando|No se pudo descifrar/.test(l)).slice(0, 3);

  const bools = ['P_lento_gana_wd', 'P_sin_medida_supone_reles', 'P_chico_no_compensa', 'P_internet_rapido_se_queda', 'P_por_poco_no_cambia', 'P_minimo', 'en_linea_por_internet_y_cerca',
    'L_por_wifi_direct', 'L_sin_subir_a_los_reles', 'L_decision_en_el_registro', 'R_sin_wifi_direct', 'R_decision_en_el_registro', 'F_lo_intento', 'F_por_internet', 'F_no_por_bluetooth', 'una_copia_de_cada'];
  const nums = ['L_llega_s', 'R_llega_s', 'F_llega_s'];
  r.fallan = bools.filter((k) => r[k] !== true).concat(nums.filter((k) => r[k] === null || r[k] === undefined));
  if (r.errores.length) r.fallan.push('errores');
  r.resultado = r.fallan.length ? 'FALLO' : 'OK';
  console.log('WDPLAN ' + JSON.stringify(r));
  save();
  await r1.stop(); await r2.stop();
  process.exit(r.resultado === 'OK' ? 0 : 1);
})().catch((e) => { console.error('FALLO:', e.stack); save(); console.log('WDPLAN ' + JSON.stringify({ resultado: 'FALLO', error: String(e && e.message) })); process.exit(1); });
