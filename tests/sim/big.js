// Archivos grandes (ronda 2756; informe del dueño: un APK de 24 MB no salía y luego no salía ningún archivo).
// A y B contactos. Caso por defecto: los dos en el mismo Wi-Fi (--wd: sin Wi-Fi, con Wi-Fi Direct; --l2: ni uno ni
// otro, por Bluetooth L2CAP (ronda 2758, Android 10+); --no-route: ni Wi-Fi ni L2CAP (Android 9 o anterior)). Pasos:
//  1. Foto pequeña: llega (como antes).
//  2. "APK" de 24 MB: sale como archivo grande; la app nunca lo lee entero (trozos de 512 KB); llega y al tocarlo en
//     B se abre idéntico (comprobado con su huella SHA-256); con --no-route sale el aviso y no se manda nada.
//  3. Otro archivo pequeño y un texto después: llegan (nada se queda bloqueado).
//  4. Corte a mitad (B sale del Wi-Fi o se aleja): la tarjeta de A dice "Toca para reintentar"; al volver, se toca y llega.
// Uso: node big.js <build> [--wd] [--l2] [--no-route] [--b-no-l2] [--mb=24]
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone } = require('./native_mock');

const buildDir = path.resolve(process.argv[2]);
const WD = process.argv.includes('--wd'), L2 = process.argv.includes('--l2');
// --b-no-l2: solo Bluetooth, A con L2CAP y B sin (Android 9): no hay camino, como --no-route
const B_NO_L2 = process.argv.includes('--b-no-l2'), NOROUTE = process.argv.includes('--no-route') || B_NO_L2;
const MB = Number((process.argv.find((a) => a.startsWith('--mb=')) || '--mb=24').split('=')[1]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
class DL extends ResourceLoader { constructor(d) { super(); this.d = d; } fetch(u) { const f = path.join(this.d, decodeURIComponent(new URL(u).pathname)); return fs.existsSync(f) ? Promise.resolve(fs.readFileSync(f)) : Promise.reject(new Error('x')); } }
const logs = [];
async function boot(name, address, radio) {
  const o = { readsContentFallback: true, mtu: 512, pace: [15, 15], retain: ['onPayloadReceived', 'onLanMessage', 'onLanUp', 'onLanDown', 'onBigDone'], asymmetric: true };
  if (!NOROUTE && !WD && !L2) o.wifi = 'casa';
  if (WD) o.wifiDirect = true;
  if (NOROUTE && (!B_NO_L2 || name === 'B')) o.noL2 = true;
  const native = new NativePhone(name, address, o);
  radio.add(native); native.load();
  const vc = new VirtualConsole(); ['log', 'info', 'warn', 'error'].forEach((l) => vc.on(l, (...a) => logs.push(`[${name}] ${l}: ` + a.map(String).join(' ').substring(0, 250))));
  const dom = new JSDOM(fs.readFileSync(path.join(buildDir, 'dist', 'index.html'), 'utf8'), { url: 'https://' + name.toLowerCase() + '.nexo.test/index.html', runScripts: 'dangerously', resources: new DL(path.join(buildDir, 'dist')), pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) { win.CapacitorCustomPlatform = { name: 'android' }; require('./native_mock').installWebCrypto(win); win.Capacitor = { Plugins: { NexoBLE: native.plugin() } }; win.HTMLElement.prototype.scrollTo = function () {}; } });
  const win = dom.window; for (let i = 0; i < 100 && !(win.NEXO && win.NEXO.initialized); i++) await sleep(100); await sleep(800);
  return { name, native, win };
}
const click = (w, el) => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
async function openChat(p) { let row; for (let i = 0; i < 300 && !row; i++) { row = p.win.document.querySelector('#main-contacts-list .ble-contact-row'); if (!row) await sleep(100); } click(p.win, row); await sleep(300); }
async function sendText(p, t) { const i = p.win.document.getElementById('message-input'); i.value = t; i.dispatchEvent(new p.win.Event('input', { bubbles: true })); click(p.win, p.win.document.getElementById('send-btn')); }
async function sendFile(p, name, type, bytes) {
  click(p.win, p.win.document.querySelector('.attach-menu-item[data-type="file"]')); await sleep(100);
  const fin = Array.from(p.win.document.querySelectorAll('input[type=file]')).pop();
  Object.defineProperty(fin, 'files', { value: [new p.win.File([bytes], name, { type })] }); fin.dispatchEvent(new p.win.Event('change'));
}
const card = (p, label, own) => Array.from(p.win.document.querySelectorAll('#messages-container .message' + (own ? '.own' : ':not(.own)'))).map((m) => m.querySelector('.file-attachment')).find((c) => c && c.textContent.indexOf(label) >= 0);
const sub = (c) => (c && c.querySelector('.file-sub') || {}).textContent || '';
const got = (p, label) => !!card(p, label, false) || Array.from(p.win.document.querySelectorAll('#messages-container .message:not(.own)')).some((m) => m.textContent.indexOf(label) >= 0);
const rnd = (n, s) => { const b = Buffer.alloc(n); for (let i = 0; i < n; i++) b[i] = (i * 7919 + s) & 255; return b; };
const wait = async (c, s) => { for (let i = 0; i < s * 5 && !c(); i++) await sleep(200); return !!c(); };

(async () => {
  const radio = new Radio();
  const [A, B] = await Promise.all([boot('A', 'AA:AA:AA:AA:AA:01', radio), boot('B', 'BB:BB:BB:BB:BB:02', radio)]);
  A.win.bleInterface.togglePanel(); let add = null;
  for (let i = 0; i < 400 && !add; i++) { await sleep(100); add = A.win.document.querySelector('#ble-new-device > div button'); if (!add && !A.win.bleInterface.isScanning) click(A.win, A.win.document.getElementById('ble-scan-btn')); }
  click(A.win, add); await sleep(1500);
  if (A.win.document.getElementById('ble-panel').classList.contains('active')) A.win.bleInterface.togglePanel();
  await openChat(A); await sendText(A, 'hola'); await sleep(3000); await openChat(B); await sleep(500);
  const nxB = B.win.bleInterface.localNexoId;
  // Esperar a que haya camino (Wi-Fi comprobado o Wi-Fi Direct anunciado)
  await wait(() => NOROUTE || !!A.win.bleInterface.bigFiles.route(nxB), 40);
  const r = { modo: B_NO_L2 ? 'solo Bluetooth, B sin L2CAP' : NOROUTE ? 'solo Bluetooth sin L2CAP' : WD ? 'Wi-Fi Direct' : L2 ? 'Bluetooth L2CAP' : 'mismo Wi-Fi', mb: MB, camino: A.win.bleInterface.bigFiles.route(nxB) };
  // 1. Foto pequeña
  await sendFile(A, 'uno.pdf', 'application/pdf', rnd(40 * 1024, 3)); r.pequeno_antes = await wait(() => got(B, 'uno.pdf'), 90);
  // 2. Archivo grande
  const big = rnd(MB * 1024 * 1024, 5);
  const sha = crypto.createHash('sha256').update(big).digest('hex');
  const t0 = Date.now();
  await sendFile(A, 'nexo-2755.apk', 'application/vnd.android.package-archive', big);
  if (NOROUTE) {
    await sleep(2000);
    const toast = Array.from(A.win.document.querySelectorAll('div')).find((d) => /Archivo demasiado grande/.test(d.textContent) && d.children.length === 0);
    r.aviso = toast ? toast.textContent : null;
    r.no_hay_tarjeta = !card(A, 'nexo-2755', true);
  } else {
    const subsA = new Set(), subsB = new Set();
    const ok = await wait(() => { const ca = card(A, 'nexo-2755', true), cb = card(B, 'nexo-2755', false); if (ca) subsA.add(sub(ca).replace(/\d+ %/, 'N %')); if (cb) subsB.add(sub(cb).replace(/\d+ %/, 'N %')); return cb && /Toca para abrir/.test(sub(cb)); }, 240);
    r.grande_llega = ok; r.grande_segundos = Math.round((Date.now() - t0) / 1000);
    r.tarjeta_A = Array.from(subsA); r.tarjeta_B = Array.from(subsB);
    r.trozo_mayor_KB = Math.round((A.native.stats.bigMaxSlice || 0) / 1024);
    r.nunca_entero_en_la_app = (A.native.stats.bigMaxSlice || 0) <= 700 * 1024 && !A.native.calls.some((c) => c.name === 'sendFile' || (c.name === 'wifiDirectSend' && c.args.data && c.args.data.length > 1e6));
    if (L2) r.por_l2cap = (A.native.stats.l2Sends || 0) >= 1 && !A.native.calls.some((c) => c.name === 'bigSendLan' || c.name === 'wifiDirectSend');
    // Abrir en B (y en A)
    const cb = card(B, 'nexo-2755', false); if (cb) click(B.win, cb); await sleep(1000);
    const ob = (B.native.opened || []).find((o) => o.big);
    r.abre_en_B_identico = !!(ob && ob.sha === sha && ob.mime === 'application/vnd.android.package-archive');
    const ca = card(A, 'nexo-2755', true); if (ca) click(A.win, ca); await sleep(1000);
    r.abre_en_A = !!(A.native.opened || []).find((o) => o.big && o.sha === sha);
  }
  // 3. Después, lo pequeño sigue llegando
  await sendFile(A, 'dos.pdf', 'application/pdf', rnd(40 * 1024, 7)); r.pequeno_despues = await wait(() => got(B, 'dos.pdf'), 90);
  await sendText(A, 'texto despues'); r.texto_despues = await wait(() => got(B, 'texto despues'), 30);
  // 4. Corte a mitad y reintento
  if (!NOROUTE) {
    await sendFile(A, 'corte.zip', 'application/zip', rnd(MB * 1024 * 1024, 9));
    await wait(() => /Enviando [1-9]/.test(sub(card(A, 'corte.zip', true))), 60);
    if (WD || L2) B.native.setOffline(true); else B.native.setWifi(null);
    r.tras_corte_A = await wait(() => /Toca para reintentar/.test(sub(card(A, 'corte.zip', true))), 60) ? sub(card(A, 'corte.zip', true)) : sub(card(A, 'corte.zip', true));
    if (WD || L2) B.native.setOffline(false); else { B.native.setWifi('casa'); A.win.bleInterface.lan.start(); B.win.bleInterface.lan.start(); }
    await wait(() => !!A.win.bleInterface.bigFiles.route(nxB), 60);
    await sleep(1500);
    click(A.win, card(A, 'corte.zip', true));
    r.tras_reintentar_llega = await wait(() => /Toca para abrir/.test(sub(card(B, 'corte.zip', false))), 240);
  }
  r.errores = logs.filter((l) => / error: /.test(l) && !/JSDOMERROR|styles\.css/.test(l)).slice(0, 5);
  const ok = r.pequeno_antes && r.pequeno_despues && r.texto_despues && (NOROUTE ? (!!r.aviso && r.no_hay_tarjeta) :
    (r.grande_llega && r.nunca_entero_en_la_app && (!L2 || r.por_l2cap) && r.abre_en_B_identico && r.abre_en_A && /Toca para reintentar/.test(r.tras_corte_A) && r.tras_reintentar_llega));
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('BIG ' + JSON.stringify(r));
  if (!ok) fs.writeFileSync(path.join(__dirname, 'last_logs_big.txt'), logs.join('\n'));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error(e); fs.writeFileSync(path.join(__dirname, 'last_logs_big.txt'), logs.join('\n')); process.exit(1); });
