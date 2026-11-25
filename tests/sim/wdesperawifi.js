// Archivo grande con el Wi-Fi del OTRO apagado (dueño 24-11, capturas 21:40-21:50, PENDIENTES 3b). Por Wi-Fi Direct (sin red).
// Antes: la tarjeta decía «No se pudo enviar» (y ✓✓ azul, que era del puntero), el aviso decía «se envía por Bluetooth» (el archivo
// grande no va por Bluetooth) y el usuario lo mandaba varias veces (6 copias). Ahora:
//  E1  B con el Wi-Fi apagado: la tarjeta de A dice «Esperando el Wi-Fi del otro» (NUNCA «No se pudo enviar»);
//  E2  el aviso es «Pídele que encienda el Wi-Fi … se manda solo al encenderlo» (no menciona Bluetooth);
//  E3  la marca del mensaje no pasa a ✓✓ mientras el archivo no llegó (aunque B ya confirmó el puntero);
//  E4  B enciende el Wi-Fi: el archivo llega SOLO (sin tocar nada), una sola copia, idéntico; y entonces sí ✓✓;
//  E5  un toque en la tarjeta mientras espera no la rompe (reintenta ya).
// Uso: node wdesperawifi.js <build> [--mb=24]
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone } = require('./native_mock');

const buildDir = path.resolve(process.argv[2]);
const WD = true, L2 = false;
// --b-no-l2: solo Bluetooth, A con L2CAP y B sin (Android 9): no hay camino, como --no-route
const B_NO_L2 = false, NOROUTE = false;
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

process.on('SIGTERM', () => { fs.writeFileSync(path.join(__dirname, 'last_logs_wdesperawifi.txt'), logs.join('\n')); process.exit(2); });
(async () => {
  const radio = new Radio();
  const [A, B] = await Promise.all([boot('A', 'AA:AA:AA:AA:AA:01', radio), boot('B', 'BB:BB:BB:BB:BB:02', radio)]);
  A.win.NEXO_BIG_WAIT_MS = 2000; // el reintento automático, rápido para la prueba
  const tickClass = (p) => { const m = Array.from(p.win.document.querySelectorAll('#messages-container .message.own')).filter((x) => x.querySelector('.file-attachment')).pop(); const s = m && m.querySelector('.msg-status'); return s ? s.textContent + '|' + s.className : ''; };
  const toasts = []; const seen = new Set();
  const scanToasts = () => Array.from(A.win.document.querySelectorAll('div')).forEach((d) => { if (d.children.length === 0 && /Wi-Fi|Bluetooth/.test(d.textContent) && d.textContent.length < 200 && !seen.has(d.textContent)) { seen.add(d.textContent); toasts.push(d.textContent); } });
  A.win.bleInterface.togglePanel(); let add = null;
  for (let i = 0; i < 400 && !add; i++) { await sleep(100); add = A.win.document.querySelector('#ble-new-device > div button'); if (!add && !A.win.bleInterface.isScanning) click(A.win, A.win.document.getElementById('ble-scan-btn')); }
  click(A.win, add); await sleep(1500);
  if (A.win.document.getElementById('ble-panel').classList.contains('active')) A.win.bleInterface.togglePanel();
  await openChat(A); await sendText(A, 'hola'); await sleep(3000); await openChat(B); await sleep(500);
  const nxB = B.win.bleInterface.localNexoId;
  await wait(() => !!A.win.bleInterface.bigFiles.route(nxB), 40);
  const r = { prueba: 'wdesperawifi', mb: MB, camino_antes: A.win.bleInterface.bigFiles.route(nxB) };
  // B apaga el Wi-Fi y A manda el archivo grande
  B.native.opts.wifiOff = true;
  const big = rnd(MB * 1024 * 1024, 5);
  const sha = crypto.createHash('sha256').update(big).digest('hex');
  await sendFile(A, 'grande.apk', 'application/vnd.android.package-archive', big);
  const subs = new Set(); let ticks = new Set();
  const peek = () => { const c = card(A, 'grande.apk', true); if (c) subs.add(sub(c).replace(/\d+ %/, 'N %')); ticks.add(tickClass(A).split('|')[0]); scanToasts(); };
  const esperando = await wait(() => { peek(); return /Esperando el Wi-Fi del otro/.test(sub(card(A, 'grande.apk', true))); }, 90);
  r.E1_tarjeta_espera = esperando;
  // dejarlo esperar varios reintentos (y que B confirme el puntero)
  for (let i = 0; i < 25; i++) { await sleep(200); peek(); }
  r.E1_nunca_no_se_pudo = !Array.from(subs).some((s) => /No se pudo enviar/.test(s));
  r.tarjetas_A = Array.from(subs);
  r.E2_aviso = toasts.find((x) => /encienda el Wi-Fi/.test(x)) || null;
  r.E2_sin_bluetooth = !toasts.some((x) => /por Bluetooth/.test(x));
  r.E3_puntero_llego_a_B = got(B, 'grande.apk');
  r.E3_marcas_mientras_espera = Array.from(ticks);
  r.E3_sin_doble_palomita = !Array.from(ticks).some((x) => /✓✓/.test(x));
  r.intentos_oferta = A.native.calls.filter((c) => c.name === 'wifiDirectSend').length;
  // E5: un toque en la tarjeta mientras espera
  const cw = card(A, 'grande.apk', true); if (cw) click(A.win, cw); await sleep(500);
  r.E5_sigue_esperando = /Esperando el Wi-Fi del otro/.test(sub(card(A, 'grande.apk', true))) || /Enviando|Toca para abrir/.test(sub(card(A, 'grande.apk', true)));
  // E4: B enciende el Wi-Fi
  B.native.opts.wifiOff = false;
  r.E4_llega_sola = await wait(() => { peek(); return /Toca para abrir/.test(sub(card(B, 'grande.apk', false))); }, 120);
  await sleep(1500); peek();
  r.E4_una_sola_copia = Array.from(B.win.document.querySelectorAll('#messages-container .message:not(.own)')).filter((m) => m.textContent.indexOf('grande.apk') >= 0).length === 1;
  const cb = card(B, 'grande.apk', false); if (cb) click(B.win, cb); await sleep(1000);
  const ob = (B.native.opened || []).find((o) => o.big);
  r.E4_identico = !!(ob && ob.sha === sha);
  r.E4_marca_final = tickClass(A).split('|')[0];
  r.E4_doble_palomita_al_llegar = /✓✓/.test(r.E4_marca_final);
  r.tarjeta_A_final = sub(card(A, 'grande.apk', true));
  r.errores = logs.filter((l) => / error: /.test(l) && !/JSDOMERROR|styles\.css/.test(l)).slice(0, 5);
  const ok = r.E1_tarjeta_espera && r.E1_nunca_no_se_pudo && !!r.E2_aviso && r.E2_sin_bluetooth && r.E3_puntero_llego_a_B && r.E3_sin_doble_palomita &&
    r.E5_sigue_esperando && r.E4_llega_sola && r.E4_una_sola_copia && r.E4_identico && r.E4_doble_palomita_al_llegar && !r.errores.length;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('WDESPERAWIFI ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_wdesperawifi.txt'), logs.join('\n'));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error(e); fs.writeFileSync(path.join(__dirname, 'last_logs_wdesperawifi.txt'), logs.join('\n')); process.exit(1); });
