// 3098 (diagnóstico Honor 3055 14-11 16:16 y S24 3054 16:07–16:18): en 4 videollamadas el S24 nunca vio al Honor: la cámara de NEXO
// estaba BLOQUEADA en el Honor («Cámara: NotAllowedError» tres veces → solo voz) y el aviso decía «Tu cámara no funciona: solo voz»,
// sin forma de arreglarlo desde la llamada. Videollamada de verdad en Chromium entre A (cámara bloqueada) y B:
//  P1  A ve «NEXO no tiene permiso para la cámara: toca aquí para darlo»;
//  P2  al tocarlo, se abre la ficha de permisos de NEXO (openAlertSetting what:'app');
//  P3  A da el permiso y vuelve a la app: la cámara se abre y B ve a A (imágenes decodificadas) en ≤ 10 s.
// Uso: node camdenied.js <dir_build>
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Radio, NativePhone } = require('./native_mock');
const PW = (() => { try { return require('playwright'); } catch (e) { return require('/opt/node22/lib/node_modules/playwright'); } })();

const buildDir = path.resolve(process.argv[2]);
const dist = path.join(buildDir, 'dist');
const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith('--' + k)); if (!a) return d; const v = a.split('=')[1]; return v === undefined ? true : Number(v); };
const opts = { readsContentFallback: true, retain: ['onPayloadReceived'], closeOnNoService: true, pace: [15, 15], ioDelay: 25, supervisionMs: 3000, wifi: 'casa' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const logs = [];
const TYPES = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json', '.woff2': 'font/woff2' };

// Cámara falsa vertical (y4m, I420): rojo | azul y un cuadrado blanco de 160x160 en el centro
const CW = 480, CH = 640, SQ = 160;
function makeY4m(file) {
  const ySz = CW * CH, cSz = (CW / 2) * (CH / 2);
  const frame = Buffer.alloc(ySz + 2 * cSz);
  const RED = [82, 90, 240], BLUE = [41, 240, 110], WHITE = [235, 128, 128];
  const at = (x, y) => (Math.abs(x - CW / 2) < SQ / 2 && Math.abs(y - CH / 2) < SQ / 2 ? WHITE : x < CW / 2 ? RED : BLUE);
  for (let y = 0; y < CH; y++) for (let x = 0; x < CW; x++) frame[y * CW + x] = at(x, y)[0];
  for (let y = 0; y < CH / 2; y++) for (let x = 0; x < CW / 2; x++) { const c = at(x * 2, y * 2); frame[ySz + y * (CW / 2) + x] = c[1]; frame[ySz + cSz + y * (CW / 2) + x] = c[2]; }
  const parts = [Buffer.from('YUV4MPEG2 W' + CW + ' H' + CH + ' F15:1 Ip A1:1 C420jpeg\n')];
  for (let i = 0; i < 2; i++) parts.push(Buffer.from('FRAME\n'), frame);
  fs.writeFileSync(file, Buffer.concat(parts));
}

async function boot(browser, name, native, camBlocked) {
  const page = await browser.newPage({ viewport: { width: 393, height: 851 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  page.on('console', (m) => logs.push(`${new Date().toISOString().substring(14, 23)} [${name}] ${m.text()}`.substring(0, 400)));
  page.on('pageerror', (e) => logs.push(`[${name}] PAGEERROR ${e.message}`));
  await page.route('https://' + name.toLowerCase() + '.nexo.test/**', (route) => {
    const f = path.join(dist, decodeURIComponent(new URL(route.request().url()).pathname));
    if (fs.existsSync(f) && fs.statSync(f).isFile()) route.fulfill({ body: fs.readFileSync(f), contentType: TYPES[path.extname(f)] || 'application/octet-stream' });
    else route.fulfill({ status: 404, body: '' });
  });
  const methods = Object.keys(native.plugin()).filter((k) => k !== 'addListener');
  const forwarded = new Set();
  await page.exposeFunction('__nexoCall', async (method, args) => {
    try { return { ok: await native.plugin()[method](args || {}) }; } catch (e) { return { err: e.message, code: e.code }; }
  });
  await page.exposeFunction('__nexoAddListener', (event) => {
    if (forwarded.has(event)) return;
    forwarded.add(event);
    native.plugin().addListener(event, (data) => { page.evaluate(([e, d]) => window.__nexoEmit(e, d), [event, data]).catch(() => {}); });
  });
  await page.addInitScript((methods) => {
    window.CapacitorCustomPlatform = { name: 'android' };
    const listeners = {};
    window.__nexoEmit = (e, d) => (listeners[e] || []).slice().forEach((cb) => { try { cb(d); } catch (x) { console.error('listener ' + e + ': ' + x.message); } });
    const plugin = {
      addListener(event, cb) {
        (listeners[event] = listeners[event] || []).push(cb);
        window.__nexoAddListener(event);
        const h = { remove: async () => { const l = listeners[event] || []; const i = l.indexOf(cb); if (i >= 0) l.splice(i, 1); } };
        const p = Promise.resolve(h); p.remove = h.remove; return p;
      },
    };
    methods.forEach((m) => { plugin[m] = async (args) => { const r = await window.__nexoCall(m, args); if (r.err) { const e = new Error(r.err); e.code = r.code; throw e; } return r.ok; }; });
    window.Capacitor = { Plugins: { NexoBLE: plugin } };
  }, methods);
  // El permiso de cámara de NEXO bloqueado (como el Honor del 14-11): getUserMedia con vídeo → NotAllowedError mientras __camBlocked
  if (camBlocked) await page.addInitScript(() => {
    window.__camBlocked = true;
    const md = navigator.mediaDevices, orig = md.getUserMedia.bind(md);
    md.getUserMedia = (c) => (window.__camBlocked && c && c.video ? Promise.reject(new DOMException('Permission denied', 'NotAllowedError')) : orig(c));
  });
  await page.goto('https://' + name.toLowerCase() + '.nexo.test/index.html');
  await page.waitForFunction(() => window.NEXO && window.NEXO.initialized, null, { timeout: 20000 });
  await sleep(800);
  return page;
}
const click = (page, sel) => page.evaluate((s) => { const el = document.querySelector(s); if (el) el.dispatchEvent(new MouseEvent('click', { bubbles: true })); return !!el; }, sel);
async function sendText(page, t) {
  await page.evaluate((t) => { const i = document.getElementById('message-input'); i.value = t; i.dispatchEvent(new Event('input', { bubbles: true })); document.getElementById('send-btn').dispatchEvent(new MouseEvent('click', { bubbles: true })); }, t);
}


(async () => {
  const y4m = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'nexo-cam-')), 'retrato.y4m');
  makeY4m(y4m);
  const browser = await PW.chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--use-file-for-fake-video-capture=' + y4m] });
  const r = { prueba: 'camdenied', build: path.basename(buildDir) };
  try {
    const radio = new Radio();
    const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', opts), nB = new NativePhone('B', 'BB:BB:BB:BB:BB:02', opts);
    radio.add(nA); radio.add(nB); nA.load(); nB.load();
    const [A, B] = await Promise.all([boot(browser, 'A', nA, true), boot(browser, 'B', nB, false)]);
    await A.evaluate(() => { window.NEXO_FORCE_LANG = 'es'; window.bleInterface.togglePanel(); });
    for (let i = 0; i < 100; i++) { await sleep(150); const ok = await click(A, '#ble-new-device button'); if (ok) break; const scanning = await A.evaluate(() => window.bleInterface.isScanning); if (!scanning) await click(A, '#ble-scan-btn'); }
    await sleep(1500);
    await A.evaluate(() => window.bleInterface.togglePanel());
    await click(A, '#main-contacts-list .ble-contact-row'); await sleep(400);
    await sendText(A, 'hola'); await sleep(2500);
    await click(B, '#main-contacts-list .ble-contact-row'); await sleep(600);
    for (let i = 0; i < 200 && !(await A.evaluate(() => window.bleInterface.calls.canVideo(Array.from(window.bleInterface.lan.links.keys())[0] || ''))); i++) await sleep(200);
    await click(A, '#nexo-video-btn');
    for (let i = 0; i < 100 && !(await B.evaluate(() => !!document.querySelector('#nexo-call-screen .call-accept'))); i++) await sleep(200);
    await click(B, '#nexo-call-screen .call-accept');
    // la cámara de A se rinde (tres intentos, cada 4 s)
    const note = () => A.evaluate(() => { const n = document.querySelector('#nexo-call-screen .call-note'); return n ? n.textContent : ''; });
    let txt = '';
    for (let i = 0; i < 100; i++) { await sleep(300); txt = await note(); if (/permiso|solo voz/.test(txt) && (await A.evaluate(() => (window.bleInterface.calls.state() || {}).camState)) === 'none') break; }
    r.A_cam = await A.evaluate(() => (window.bleInterface.calls.state() || {}).camState);
    r.P1_aviso = txt;
    r.P1_ok = /permiso para la cámara/.test(txt);
    r.decodificadas_B_antes = await B.evaluate(() => (window.NEXO_callVideoStats || {}).decoded || 0);
    // toca el aviso
    nA.alertOpened = [];
    await A.evaluate(() => { const n = document.querySelector('#nexo-call-screen .call-note'); if (n) n.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    await sleep(500);
    r.P2_abre = (nA.alertOpened || []).slice();
    r.P2_ok = r.P2_abre.includes('app');
    // da el permiso en Ajustes y vuelve a la app
    await A.evaluate(() => { window.__camBlocked = false; document.dispatchEvent(new Event('visibilitychange')); });
    const t3 = Date.now(); let dec = 0;
    for (let i = 0; i < 50; i++) { await sleep(200); dec = await B.evaluate(() => (window.NEXO_callVideoStats || {}).decoded || 0); if (dec > r.decodificadas_B_antes + 3) break; }
    r.P3_decodificadas_B = dec;
    r.P3_s = dec > r.decodificadas_B_antes + 3 ? Math.round((Date.now() - t3) / 100) / 10 : null;
    r.P3_A_cam = await A.evaluate(() => (window.bleInterface.calls.state() || {}).camState);
    r.P3_ok = r.P3_s !== null && r.P3_s <= 10 && r.P3_A_cam === 'on';
    r.errores = logs.filter((l) => /PAGEERROR/.test(l)).slice(0, 3);
  } catch (e) { r.error = String(e && e.message); }
  await browser.close();
  const ok = !!(r.P1_ok && r.P2_ok && r.P3_ok && !(r.errores || []).length && !r.error);
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('CAMDENIED ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_camdenied.txt'), logs.join('\n'));
  process.exit(ok ? 0 : 1);
})();
