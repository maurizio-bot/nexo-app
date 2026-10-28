// Archivos grandes por INTERNET (pedido del dueño, ronda 2786). A y B se conocen y luego cada uno en su casa (solo
// internet, sin Bluetooth ni misma Wi-Fi).
//  - Sin --tor (solo RELÉS): un archivo mediano (5 MB) llega; uno grande (12 MB) AHORA TAMBIÉN llega (28-10: el tope por
//    internet subió a ~22 MB, troceado; antes 12 MB se rechazaba). Solo por encima de ~22 MB (25 MB) se avisa claro
//    (nombra el tope y Wi-Fi) y no se manda por internet (nunca se queda sin mandar y sin avisar).
//  - Con --tor (TOR DIRECTO, una conexión .onion entre los dos): un archivo grande (12 MB) SÍ sale por internet y llega,
//    sin aviso de "demasiado grande".
// El mock de Tor añade latencia por trozo; aquí se baja (torLatency) para no esperar minutos: se prueba la lógica de la
// app (tope por camino + troceo), no la velocidad real de Tor.
// Uso: node bignet.js <dir_build> [--tor]
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone, installWebCrypto } = require('./native_mock');
const { NostrRelay } = require('./nostr_relay');

const buildDir = path.resolve(process.argv[2]);
const withTor = process.argv.includes('--tor');
const base = { readsContentFallback: true, retain: ['onPayloadReceived', 'onLanMessage', 'onLanUp', 'onLanDown'], closeOnNoService: true, pace: [15, 15], ioDelay: 25, asymmetric: true, torLatency: 4, torBps: 5000000 };
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
  const dom = new JSDOM(fs.readFileSync(path.join(buildDir, 'dist', 'index.html'), 'utf8'), {
    url: 'https://' + name.toLowerCase() + '.nexo.test/index.html', runScripts: 'dangerously',
    resources: new DistLoader(path.join(buildDir, 'dist')), pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) { win.NEXO_NET_RELAYS = RELAYS; win.CapacitorCustomPlatform = { name: 'android' }; installWebCrypto(win); win.Capacitor = { Plugins: { NexoBLE: native.plugin() } }; win.HTMLElement.prototype.scrollTo = function () {}; },
  });
  const win = dom.window;
  for (let i = 0; i < 100 && !(win.NEXO && win.NEXO.initialized); i++) await sleep(100);
  await sleep(800);
  return { name, native, win };
}
const click = (win, el) => el && el.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
async function openChatWith(p, name) {
  const row = Array.from(p.win.document.querySelectorAll('#main-contacts-list .ble-contact-row')).find((r) => (r.querySelector('.ble-contact-name') || {}).textContent === name);
  click(p.win, row); await sleep(500); return !!row;
}
function sendText(p, t) { const i = p.win.document.getElementById('message-input'); i.value = t; i.dispatchEvent(new p.win.Event('input', { bubbles: true })); click(p.win, p.win.document.getElementById('send-btn')); }
async function sendFile(p, name, bytes) {
  const b = Buffer.alloc(bytes); for (let i = 0; i < b.length; i++) b[i] = (i * 31 + name.length * 7) & 255;
  click(p.win, p.win.document.querySelector('.attach-menu-item[data-type="file"]')); await sleep(100);
  const fin = Array.from(p.win.document.querySelectorAll('input[type=file]')).pop();
  Object.defineProperty(fin, 'files', { configurable: true, value: [new p.win.File([b], name, { type: 'application/octet-stream' })] });
  fin.dispatchEvent(new p.win.Event('change'));
  return b;
}
function toastText(p) { const t = p.win.document.getElementById('perm-error-toast'); return t ? t.textContent : null; }
async function addFound(p, name) {
  let add = null;
  const find = () => { const row = Array.from(p.win.document.querySelectorAll('#ble-new-device > div')).find((d) => (d.querySelector('span') || {}).textContent === name); return row && row.querySelector('button'); };
  for (let i = 0; i < 400 && !add; i++) { await sleep(100); add = find(); if (!add && !p.win.bleInterface.isScanning) click(p.win, p.win.document.getElementById('ble-scan-btn')); }
  click(p.win, add); await sleep(2000);
  return !!add;
}
async function waitFor(fn, ms) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return Math.round((Date.now() - t0) / 100) / 10; await sleep(200); } return null; }

(async () => {
  const r1 = new NostrRelay(), r2 = new NostrRelay({ authRequired: true });
  RELAYS = [await r1.start(), await r2.start()];
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', Object.assign({}, base, { wifi: 'casa', noTor: !withTor })), nB = new NativePhone('B', 'BB:BB:BB:BB:BB:02', Object.assign({}, base, { wifi: 'oficina', noTor: !withTor }));
  [nA, nB].forEach((n) => { radio.add(n); n.load(); });
  let A = await boot('A', nA), B = await boot('B', nB);
  const idA = A.win.bleInterface.localNexoId.toLowerCase(), idB = B.win.bleInterface.localNexoId.toLowerCase();
  const r = { build: path.basename(buildDir), modo: withTor ? 'tor' : 'relés' };
  A.win.bleInterface.togglePanel(); const paired = await addFound(A, 'B'); A.win.bleInterface.togglePanel();
  if (!paired) { console.log('BIGNET ' + JSON.stringify({ resultado: 'FAIL', error: 'no empareja' })); process.exit(0); }
  await openChatWith(A, 'B'); sendText(A, 'hola B'); await sleep(2000);
  await openChatWith(B, 'A'); sendText(B, 'hola A'); await sleep(2000);
  // Cada uno a su casa: sin Bluetooth, redes Wi-Fi distintas (solo internet)
  radio.block(nA, nB);
  const viaA = () => A.win.bleInterface.linkOf(idB);
  A.win.bleInterface.net.tick(); B.win.bleInterface.net.tick();
  r.en_linea_por_internet_s = await waitFor(() => viaA() === 'internet' && B.win.bleInterface.linkOf(idA) === 'internet', 60000);
  const has = async (p, from, f) => (await p.win.vaultLoadMessages(from)).some(f);
  const status = (p, name) => { const el = Array.from(p.win.document.querySelectorAll('#messages-container .message.own')).find((m) => (m.textContent || '').indexOf(name) >= 0); const s = el && el.querySelector('.msg-status'); return s ? s.className.replace('msg-status status-', '') : null; };
  const llega = (name, buf) => has(B, idA, (m) => m.attachmentType && !m._own && (m.attachmentPayload || nB.files.get(m.attachmentRef)) === buf.toString('base64'));

  if (withTor) {
    // Esperar a que los dos se conecten directo por Tor
    r.por_tor_directo_s = await waitFor(() => A.win.bleInterface.net.via(idB) === 'tor' && B.win.bleInterface.net.via(idA) === 'tor', 90000);
    await openChatWith(A, 'B');
    const prev = A.win.document.getElementById('perm-error-toast'); if (prev) prev.remove();
    const g = await sendFile(A, 'grande_tor_12MB.bin', 12 * 1048576);
    await sleep(700);
    r.tor_grande_12MB_aviso = toastText(A);                 // debe ser null (no "demasiado grande")
    r.tor_grande_12MB_estado_inicial = status(A, 'grande_tor_12MB.bin'); // 'sending'/'sent'/'delivered'
    r.tor_grande_12MB_llega_s = await waitFor(() => llega('grande_tor_12MB.bin', g), 240000);
    r.errores = logs.filter((l) => /ilegible|Error procesando|No se pudo descifrar|TypeError|undefined is not/.test(l)).slice(0, 4);
    const ok = r.por_tor_directo_s !== null &&
      (r.tor_grande_12MB_aviso === null || !/demasiado grande/i.test(r.tor_grande_12MB_aviso)) &&
      r.tor_grande_12MB_llega_s !== null && r.errores.length === 0;
    r.resultado = ok ? 'OK' : 'FAIL';
  } else {
    r.via_actual = A.win.bleInterface.net.via(idB); // 'relés'
    await openChatWith(A, 'B');
    const prev1 = A.win.document.getElementById('perm-error-toast'); if (prev1) prev1.remove();
    const med = await sendFile(A, 'mediano_5MB.bin', 5 * 1048576);
    r.reles_mediano_5MB_llega_s = await waitFor(() => llega('mediano_5MB.bin', med), 120000);
    // 28-10 (pedido del dueño): un archivo grande (12 MB) AHORA sí sale por los relés (antes se rechazaba). Troceado;
    // cada trozo prueba Tor y, al no haber, cae a los relés.
    await sleep(400);
    const prev2 = A.win.document.getElementById('perm-error-toast'); if (prev2) prev2.remove();
    const g = await sendFile(A, 'grande_12MB.bin', 12 * 1048576);
    await sleep(700);
    r.reles_grande_12MB_aviso = toastText(A);                 // null: ya no "demasiado grande"
    r.reles_grande_12MB_llega_s = await waitFor(() => llega('grande_12MB.bin', g), 240000);
    // Por encima de ~22 MB sí se avisa y no se manda por internet
    await sleep(400);
    const prev3 = A.win.document.getElementById('perm-error-toast'); if (prev3) prev3.remove();
    await sendFile(A, 'enorme_25MB.bin', 25 * 1048576);
    await sleep(700);
    r.reles_enorme_25MB_aviso = toastText(A);
    r.reles_enorme_25MB_estado = status(A, 'enorme_25MB.bin'); // null = no se creó mensaje (avisó antes de mandar)
    r.errores = logs.filter((l) => /ilegible|Error procesando|No se pudo descifrar|TypeError|undefined is not/.test(l)).slice(0, 4);
    const avisoEnorme = (r.reles_enorme_25MB_aviso || '');
    const ok = r.reles_mediano_5MB_llega_s !== null &&
      (r.reles_grande_12MB_aviso === null || !/demasiado grande/i.test(r.reles_grande_12MB_aviso)) &&
      r.reles_grande_12MB_llega_s !== null &&
      /van hasta ~\d+ MB/.test(avisoEnorme) && /Wi-Fi/.test(avisoEnorme) && r.reles_enorme_25MB_estado === null &&
      r.errores.length === 0;
    r.resultado = ok ? 'OK' : 'FAIL';
  }
  console.log('BIGNET ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, withTor ? 'last_logs_bignet_tor.txt' : 'last_logs_bignet.txt'), logs.join('\n'));
  await r1.stop(); await r2.stop();
  process.exit(0);
})().catch((e) => { console.error('FALLO:', e.stack); fs.writeFileSync(path.join(__dirname, withTor ? 'last_logs_bignet_tor.txt' : 'last_logs_bignet.txt'), logs.join('\n')); process.exit(1); });
