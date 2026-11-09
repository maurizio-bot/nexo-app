// Diagnóstico del dueño (S24 09-11 13:35, APK de 25 MB a la tablet por Wi-Fi): el archivo por fin salía por la red local (trozos
// de 24 KB, 350 de 1487 en 90 s) y la propia app lo cortó: «Señal Wi-Fi mala con la tablet (ida y vuelta 5509 ms, 0 s sin
// recibir): lo nuevo por otro camino» y 2 ms después «abort … Contacto no disponible: queda pendiente». El latido nativo viaja
// por el MISMO canal que los 288 KB en vuelo: la ida y vuelta se infla por la CARGA, no por mala señal («0 s sin recibir» = el
// enlace está vivo). Y al degradar, relink movía el archivo en vuelo a Bluetooth, donde no cabe → ⏳ → el siguiente intento
// empezaba de cero («llega otro intento: se empieza de nuevo» en la tablet).
// Arreglos (2975): (1) lan.js: mientras hay una transferencia por ese enlace Wi-Fi (hasActiveTransferOn), la ida y vuelta alta no
// cuenta como mala señal (solo «sin recibir» > 12 s); sin transferencia, la regla de siempre (lan.js/route.js la vigilan); (2) relink
// con keepTooBig: un archivo que no cabe por el camino nuevo se queda en el Wi-Fi mientras esté arriba (degradado ≠ caído).
// Prueba (2 teléfonos en la misma Wi-Fi): (1) archivo de 6 MB por Wi-Fi; en vuelo, ida y vuelta de 5000 ms con 0 s sin recibir
// → NO se degrada y el archivo llega entero. (2) archivo de 12 MB; en vuelo, el latido dice 5000 ms y 15 s sin recibir → sí
// degrada («Señal Wi-Fi mala») pero el archivo grande SIGUE por Wi-Fi (no se aborta) y llega entero.
// Uso: node lanload.js <dir_build>
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone, installWebCrypto } = require('./native_mock');

const buildDir = path.resolve(process.argv[2]);
const base = { readsContentFallback: true, retain: ['onPayloadReceived', 'onLanMessage', 'onLanUp', 'onLanDown'], closeOnNoService: true, pace: [15, 15], ioDelay: 25, asymmetric: true, noL2: true, noTor: true, wifi: 'casa' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
class DL extends ResourceLoader { constructor(d) { super(); this.d = d; } fetch(u) { const f = path.join(this.d, decodeURIComponent(new URL(u).pathname)); return fs.existsSync(f) ? Promise.resolve(fs.readFileSync(f)) : Promise.reject(new Error('x')); } }
const logs = [];
const T0 = Date.now();
const ts = () => String(((Date.now() - T0) / 1000).toFixed(1)).padStart(6) + 's';
async function boot(name, native) {
  const vc = new VirtualConsole();
  ['log', 'warn', 'error'].forEach((l) => vc.on(l, (...a) => logs.push(`${ts()} [${name}] ${l}: ` + a.map(String).join(' ').substring(0, 250))));
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
async function openChatWith(p, name) {
  let row; for (let i = 0; i < 300 && !row; i++) { row = Array.from(p.win.document.querySelectorAll('#main-contacts-list .ble-contact-row')).find((r) => (r.querySelector('.ble-contact-name') || {}).textContent === name); if (!row) await sleep(100); }
  click(p.win, row); await sleep(400); return !!row;
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
async function waitFor(fn, ms) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return Math.round((Date.now() - t0) / 100) / 10; await sleep(200); } return null; }
async function hasFile(p, from, b64) { const list = await p.win.vaultLoadMessages(from); return list.some((m) => !m._own && m.attachmentType && !m.deleted && (m.attachmentPayload || p.native.files.get(m.attachmentRef)) === b64); }
const lanStreams = (bi) => { const out = []; (bi.ackSystem.outgoingStreams || new Map()).forEach((s, id) => { if (s && s.type === 'file' && !s.aborted && /^lan/i.test(String(s.deviceId))) out.push({ id, s }); }); return out; };
const malaSenal = () => logs.filter((l) => /\[A\].*Señal Wi-Fi mala con/.test(l)).length;

(async () => {
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', Object.assign({}, base)), nB = new NativePhone('B', 'BB:BB:BB:BB:BB:02', Object.assign({}, base));
  [nA, nB].forEach((n) => { radio.add(n); n.load(); });
  const [A, B] = await Promise.all([boot('A', nA), boot('B', nB)]);
  const biA = A.win.bleInterface, idA = biA.localNexoId.toLowerCase(), idB = B.win.bleInterface.localNexoId.toLowerCase();
  const r = { prueba: 'lanload', build: path.basename(buildDir) };

  // Se conocen por Bluetooth (claves) y quedan en la misma Wi-Fi
  biA.togglePanel(); let add = null;
  for (let i = 0; i < 400 && !add; i++) { await sleep(100); add = A.win.document.querySelector('#ble-new-device > div button'); if (!add && !biA.isScanning) click(A.win, A.win.document.getElementById('ble-scan-btn')); }
  if (!add) { console.log('LANLOAD ' + JSON.stringify({ prueba: 'lanload', resultado: 'FALLO', error: 'no empareja' })); process.exit(1); }
  click(A.win, add); await sleep(1500);
  if (A.win.document.getElementById('ble-panel').classList.contains('active')) biA.togglePanel();
  await openChatWith(A, 'B'); sendText(A, 'hola B');
  r.emparejados_s = await waitFor(async () => (await B.win.vaultLoadMessages(idA)).some((m) => m.content === 'hola B'), 30000);
  r.wifi_s = await waitFor(() => !!(biA.lan && biA.lan.canReach(idB)), 30000);
  const link = () => biA.lan && biA.lan.links && biA.lan.links.get(idB);

  // ===== (1) 6 MB por Wi-Fi; en vuelo, ida y vuelta 5000 ms con 0 s sin recibir → no se degrada, llega entero =====
  const f1 = await sendFile(A, 'grande1.bin', 6 * 1024 * 1024), b1 = f1.toString('base64');
  r.flujo1_por_wifi = await waitFor(() => lanStreams(biA).some((x) => x.s.windowStart > 0), 30000);
  const mala0 = malaSenal();
  nA.opts.lanRtt = 5000;
  for (let k = 0; k < 5; k++) { try { await biA.lan._tick(); } catch (e) {} await sleep(50); }
  r.carga_no_degrada = malaSenal() === mala0 && !(link() && link().degraded);
  r.ticks_malos_con_carga = (link() && link().bad) || 0; // informativo: debe quedarse en 0
  nA.opts.lanRtt = 5;
  r.archivo1_llega_s = await waitFor(() => hasFile(B, idA, b1), 180000);

  // ===== (2) 12 MB por Wi-Fi; en vuelo, el latido dice 5000 ms y 15 s sin recibir → degrada, pero el grande sigue por Wi-Fi =====
  const f2 = await sendFile(A, 'grande2.bin', 12 * 1024 * 1024), b2 = f2.toString('base64');
  r.flujo2_por_wifi = await waitFor(() => lanStreams(biA).some((x) => x.s.windowStart > 0 && String(x.s.content || '').length > 10000000), 60000);
  const st2 = lanStreams(biA).find((x) => String(x.s.content || '').length > 10000000);
  const plA = A.win.Capacitor.Plugins.NexoBLE, oStatus = plA.lanStatus;
  plA.lanStatus = () => Promise.resolve({ supported: true, wifi: true, running: true, port: 1, peers: [{ nx: idB, rtt: 5000, idle: 15000 }] });
  const mala1 = malaSenal();
  for (let k = 0; k < 5; k++) { try { await biA.lan._tick(); } catch (e) {} await sleep(50); }
  r.sin_recibir_si_degrada = malaSenal() === mala1 + 1 && !!(link() && link().degraded);
  r.grande_sigue_en_wifi = !!(st2 && !st2.s.aborted && biA.ackSystem.outgoingStreams.has(st2.id) && /^lan/i.test(String(st2.s.deviceId)));
  r.grande_no_quedo_pendiente = !logs.some((l) => /\[A\].*sendFile FAIL fileId=/.test(l) && l.indexOf(st2 ? st2.id : '§') >= 0);
  plA.lanStatus = oStatus;
  for (let k = 0; k < 10; k++) { try { await biA.lan._tick(); } catch (e) {} await sleep(50); }
  r.buena_otra_vez = !(link() && link().degraded);
  r.archivo2_llega_s = await waitFor(() => hasFile(B, idA, b2), 240000);

  r.errores = logs.filter((l) => / error: /.test(l) && !/JSDOMERROR|styles\.css|Not implemented|GLOBAL TIMEOUT|Assembly timeout|net::ERR|fetch/.test(l)).slice(0, 5);
  const nums = ['emparejados_s', 'wifi_s', 'flujo1_por_wifi', 'archivo1_llega_s', 'flujo2_por_wifi', 'archivo2_llega_s'];
  const ok = nums.every((k) => typeof r[k] === 'number') && r.carga_no_degrada && r.sin_recibir_si_degrada && r.grande_sigue_en_wifi && r.grande_no_quedo_pendiente && r.buena_otra_vez && !r.errores.length;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('LANLOAD ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_lanload.txt'), logs.join('\n'));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('LANLOAD ' + JSON.stringify({ prueba: 'lanload', resultado: 'FALLO', error: String(e && e.message).replace(/"/g, "'") })); console.error(e && e.stack); fs.writeFileSync(path.join(__dirname, 'last_logs_lanload.txt'), logs.join('\n')); process.exit(1); });
