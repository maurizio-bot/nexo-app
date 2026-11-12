// 3022 (prueba del dueño 12-11 07:05, S24 y vivo con la 3018, los dos APAGAN el Wi-Fi con el Bluetooth listo):
//  (1) durante el margen de 15 s tras el corte (regla del dueño 23-10: no brincar por un corte breve) los textos NUEVOS seguían
//      yendo al Wi-Fi caído: el nativo fallaba 5 veces, quedaban pendientes y llegaban a los 37–54 s;
//  (2) un archivo (un respaldo de Fénix) que iba por Wi-Fi siguió por Bluetooth con sus trozos de Wi-Fi (24 000 letras, ~48
//      escrituras cada uno, por debajo del umbral de 100 que lo rehacía): tapó el Bluetooth ~40 s y los textos de los dos lados
//      se quedaban sin confirmar.
// Escena: A y B en el mismo Wi-Fi y con Bluetooth. A manda un archivo de ~1,4 MB por Wi-Fi; a medias, los dos apagan el Wi-Fi.
//  W1: textos escritos durante el margen (A→B y B→A) llegan por Bluetooth en ≤ 5 s, sin fallo nativo contra el Wi-Fi.
//  W2: el archivo a medias espera el margen (no cambia de camino por un corte breve) y, si el Wi-Fi no vuelve, sigue por
//      Bluetooth con trozos A SU MEDIDA (se rehace), no con los de Wi-Fi.
//  W3: con el archivo yendo por Bluetooth, un texto nuevo llega en ≤ 10 s.
//  W4: el archivo llega íntegro.
// Uso: node wifioff.js <dir_build>
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone } = require('./native_mock');

const buildDir = path.resolve(process.argv[2]);
const opts = { readsContentFallback: true, retain: ['onPayloadReceived', 'onLanMessage', 'onLanUp', 'onLanDown'], closeOnNoService: true, pace: [15, 15], ioDelay: 25, asymmetric: true, wifi: 'casa', noTor: true };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
class DL extends ResourceLoader { constructor(d) { super(); this.d = d; } fetch(u) { const f = path.join(this.d, decodeURIComponent(new URL(u).pathname)); return fs.existsSync(f) ? Promise.resolve(fs.readFileSync(f)) : Promise.reject(new Error('x')); } }
const logs = [];
async function boot(name, native) {
  const vc = new VirtualConsole();
  ['log', 'warn', 'error'].forEach((l) => vc.on(l, (...a) => logs.push(`${new Date().toISOString().substring(14, 23)} [${name}] ${l}: ` + a.map(String).join(' ').substring(0, 250))));
  const dom = new JSDOM(fs.readFileSync(path.join(buildDir, 'dist', 'index.html'), 'utf8'), {
    url: 'https://' + name.toLowerCase() + '.nexo.test/index.html', runScripts: 'dangerously', resources: new DL(path.join(buildDir, 'dist')), pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) { win.CapacitorCustomPlatform = { name: 'android' }; require('./native_mock').installWebCrypto(win); win.Capacitor = { Plugins: { NexoBLE: native.plugin() } }; win.HTMLElement.prototype.scrollTo = function () {}; },
  });
  const win = dom.window;
  for (let i = 0; i < 100 && !(win.NEXO && win.NEXO.initialized); i++) await sleep(100);
  await sleep(800);
  return { name, native, win };
}
const click = (w, el) => el && el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
async function openChatWith(p, name) {
  let row; for (let i = 0; i < 300 && !row; i++) { row = Array.from(p.win.document.querySelectorAll('#main-contacts-list .ble-contact-row')).find((r) => (r.querySelector('.ble-contact-name') || {}).textContent === name); if (!row) await sleep(100); }
  click(p.win, row); await sleep(600); return !!row;
}
function sendText(p, t) { const i = p.win.document.getElementById('message-input'); i.value = t; i.dispatchEvent(new p.win.Event('input', { bubbles: true })); click(p.win, p.win.document.getElementById('send-btn')); }
const wait = async (c, s) => { const t0 = Date.now(); for (let i = 0; i < s * 5; i++) { if (await c()) return Math.round((Date.now() - t0) / 100) / 10; await sleep(200); } return null; };
// Estados que ha ido mostrando la burbuja de ese texto en A
function watchBubble(p, text) {
  const seen = new Set();
  const t = setInterval(() => {
    const el = Array.from(p.win.document.querySelectorAll('#messages-container .message.own')).find((e) => (e.textContent || '').indexOf(text) >= 0);
    const s = el && el.querySelector('.msg-status');
    if (s) seen.add(s.className.replace(/.*status-/, ''));
  }, 150);
  return { stop: () => { clearInterval(t); return Array.from(seen); } };
}

(async () => {
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', opts), nB = new NativePhone('B', 'BB:BB:BB:BB:BB:02', opts);
  [nA, nB].forEach((n) => { radio.add(n); n.load(); });
  const [A, B] = await Promise.all([boot('A', nA), boot('B', nB)]);
  const biA = A.win.bleInterface, biB = B.win.bleInterface;
  const idA = biA.localNexoId.toLowerCase(), idB = biB.localNexoId.toLowerCase();
  const r = { prueba: 'wifioff', build: path.basename(buildDir) };
  biA.togglePanel(); let add = null;
  for (let i = 0; i < 400 && !add; i++) { await sleep(100); add = A.win.document.querySelector('#ble-new-device > div button'); if (!add && !biA.isScanning) click(A.win, A.win.document.getElementById('ble-scan-btn')); }
  click(A.win, add); await sleep(1500);
  if (A.win.document.getElementById('ble-panel').classList.contains('active')) biA.togglePanel();
  await openChatWith(A, 'B'); sendText(A, 'hola'); await sleep(2500);
  await openChatWith(B, 'A'); sendText(B, 'hola A'); await sleep(2500);
  r.wifi_s = await wait(() => biA.linkOf(idB) === 'wifi' && biB.linkOf(idA) === 'wifi', 60);
  r.bt_listo = !!biA._bleReadyFor(idB) && !!biB._bleReadyFor(idA);
  const hasB = async (t) => (await B.win.vaultLoadMessages(idA)).some((m) => m.content === t);
  const hasA = async (t) => (await A.win.vaultLoadMessages(idB)).some((m) => m.content === t);
  // Archivo de ~1,4 MB (base64 ~1,9 M letras) por Wi-Fi
  const buf = Buffer.alloc(1400000); for (let i = 0; i < buf.length; i++) buf[i] = (i * 13 + 5) & 255;
  click(A.win, A.win.document.querySelector('.attach-menu-item[data-type="file"]')); await sleep(200);
  const fin = Array.from(A.win.document.querySelectorAll('input[type=file]')).pop();
  Object.defineProperty(fin, 'files', { value: [new A.win.File([buf], 'grande.bin', { type: 'application/octet-stream' })] });
  fin.dispatchEvent(new A.win.Event('change'));
  let st = null;
  r.archivo_por_wifi_s = await wait(() => { st = Array.from(biA.ackSystem.outgoingStreams.values()).find((s) => s.type === 'file'); return !!st && /^lan/i.test(String(st.deviceId).replace(/[:]/g, '')) && st.windowStart >= 4; }, 30);
  const fileId = st && st.msgId;
  r.trozos_wifi = st && st.chunkSize;
  // Los dos apagan el Wi-Fi (el Bluetooth sigue)
  nA.setWifi(null); nB.setWifi(null);
  const tCut = Date.now();
  await sleep(1200);
  await openChatWith(A, 'B'); sendText(A, 'durante corte A');
  await openChatWith(B, 'A'); sendText(B, 'durante corte B');
  r.W1_A_a_B_s = await wait(() => hasB('durante corte A'), 30);
  r.W1_B_a_A_s = await wait(() => hasA('durante corte B'), 30);
  r.fallos_nativos_contra_wifi = logs.filter((l) => /Envio nativo fallo|Sin Wi-Fi con/.test(l) && new Date() - tCut < 60000).length;
  // W2: el archivo sigue por Bluetooth (tras el margen) con trozos a su medida
  let tSwitch = 0;
  r.W2_archivo_sigue_por_bt_s = await wait(() => { const s2 = biA.ackSystem.outgoingStreams.get(fileId); const ok2 = !!s2 && !/^lan/i.test(String(s2.deviceId)); if (ok2 && !tSwitch) tSwitch = Date.now(); return ok2 && s2.windowStart > 0; }, 60);
  r.cambio_a_bt_tras_corte_s = tSwitch ? Math.round((tSwitch - tCut) / 100) / 10 : null;
  const s3 = biA.ackSystem.outgoingStreams.get(fileId);
  r.trozos_bt = s3 && s3.chunkSize;
  r.W2_espero_margen = r.cambio_a_bt_tras_corte_s !== null && r.cambio_a_bt_tras_corte_s >= 14;
  // W3: texto nuevo con el archivo yendo por Bluetooth
  await openChatWith(A, 'B'); sendText(A, 'con archivo por bt');
  r.W3_texto_con_archivo_s = await wait(() => hasB('con archivo por bt'), 30);
  // W4: el archivo llega
  const b64 = buf.toString('base64');
  r.W4_archivo_llega_s = await wait(async () => (await B.win.vaultLoadMessages(idA)).some((m) => m.attachmentType && (m.attachmentPayload === b64 || (m.attachmentRef && nB.files.get(m.attachmentRef) === b64))), 400);
  r.errores = logs.filter((l) => / error: /.test(l) && !/JSDOMERROR|styles\.css|Not implemented/.test(l)).slice(0, 5);
  const ok = r.wifi_s !== null && r.bt_listo && typeof r.archivo_por_wifi_s === 'number' && r.W1_A_a_B_s !== null && r.W1_A_a_B_s <= 5 && r.W1_B_a_A_s !== null && r.W1_B_a_A_s <= 5 &&
    r.W2_archivo_sigue_por_bt_s !== null && r.W2_espero_margen && r.trozos_bt < 2000 && r.W3_texto_con_archivo_s !== null && r.W3_texto_con_archivo_s <= 10 && r.W4_archivo_llega_s !== null && !r.errores.length;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('WIFIOFF ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_wifioff.txt'), logs.join('\n'));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('WIFIOFF {"prueba":"wifioff","resultado":"FALLO","error":"' + String(e && e.message).replace(/"/g, "'") + '"}'); console.error(e); fs.writeFileSync(path.join(__dirname, 'last_logs_wifioff.txt'), logs.join('\n')); process.exit(1); });
