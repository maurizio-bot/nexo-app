// Imagen de la videollamada (informe del dueño, 25-10: "el vídeo recibido no está en espejo: si volteo la cara a la
// derecha, en el otro se ve al lado contrario" y "la imagen se ve muy cerca, un poco deformada").
// Videollamada de verdad en Chromium entre A y B (mismo Wi-Fi) con una cámara falsa EN VERTICAL, como la de un teléfono
// en la mano (480x640), que muestra un dibujo conocido: mitad izquierda roja, mitad derecha azul y un cuadrado blanco en
// el centro. Se mira lo que le llega a B:
//  - proporcion: la imagen que recibe B tiene la forma de la cámara de A (vertical 3:4), no un rectángulo apaisado;
//  - cuadrado: el cuadrado blanco sigue siendo cuadrado (sin estirar);
//  - espejo con la cámara de delante: B ve a A como A se ve a sí mismo (el rojo a la derecha, como en un espejo); el
//    espejo lo pone B al mostrarla (los píxeles que llegan van al derecho) y se quita en Perfil; con la de detrás,
//    sin espejo (el rojo a la izquierda: lo que se enseña, por ejemplo un papel, se lee bien);
//  - se_ve_entera: B ve la imagen entera (cabe en la pantalla) y con dos toques la amplía a toda la pantalla.
// Uso: node videoframe.js <dir_build> [--seconds=5]
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Radio, NativePhone } = require('./native_mock');
const PW = (() => { try { return require('playwright'); } catch (e) { return require('/opt/node22/lib/node_modules/playwright'); } })();

const buildDir = path.resolve(process.argv[2]);
const dist = path.join(buildDir, 'dist');
const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith('--' + k)); if (!a) return d; const v = a.split('=')[1]; return v === undefined ? true : Number(v); };
const seconds = arg('seconds', 5);
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

async function boot(browser, name, native) {
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
  await page.goto('https://' + name.toLowerCase() + '.nexo.test/index.html');
  await page.waitForFunction(() => window.NEXO && window.NEXO.initialized, null, { timeout: 20000 });
  await sleep(800);
  return page;
}
const click = (page, sel) => page.evaluate((s) => { const el = document.querySelector(s); if (el) el.dispatchEvent(new MouseEvent('click', { bubbles: true })); return !!el; }, sel);
async function sendText(page, t) {
  await page.evaluate((t) => { const i = document.getElementById('message-input'); i.value = t; i.dispatchEvent(new Event('input', { bubbles: true })); document.getElementById('send-btn').dispatchEvent(new MouseEvent('click', { bubbles: true })); }, t);
}

// Lo que ve B de A: forma de la imagen, colores a los lados, tamaño del cuadrado blanco y cómo se coloca en la pantalla
const look = (page) => page.evaluate(([SQ]) => {
  const rc = document.querySelector('#nexo-call-screen .call-remote-video');
  if (!rc || !rc.width || !rc.height) return null;
  const w = rc.width, h = rc.height, d = rc.getContext('2d').getImageData(0, 0, w, h).data;
  const px = (x, y) => { const i = (Math.round(y) * w + Math.round(x)) * 4; return [d[i], d[i + 1], d[i + 2]]; };
  const color = (x, y) => { const [r, g, b] = px(x, y); return r > 140 && b < 110 && g < 110 ? 'rojo' : b > 140 && r < 110 && g < 110 ? 'azul' : Math.min(r, g, b) > 160 ? 'blanco' : r + ',' + g + ',' + b; };
  const white = (x, y) => Math.min(...px(x, y)) > 160;
  let x0 = -1, x1 = -1, y0 = -1, y1 = -1;
  for (let x = 0; x < w; x++) if (white(x, h / 2)) { if (x0 < 0) x0 = x; x1 = x; }
  for (let y = 0; y < h; y++) if (white(w / 2, y)) { if (y0 < 0) y0 = y; y1 = y; }
  const cs = getComputedStyle(rc), box = rc.getBoundingClientRect();
  const espejo = /^matrix\(-1/.test(cs.transform || ''); // lo que se ve: con espejo, izquierda y derecha se cambian
  // Parte de la imagen que se ve en la pantalla (1 = entera): con "cover" se recorta lo que no cabe
  const scale = cs.objectFit === 'contain' ? Math.min(box.width / w, box.height / h) : Math.max(box.width / w, box.height / h);
  const visible = Math.min(1, box.width / (w * scale)) * Math.min(1, box.height / (h * scale));
  const iz = color(w * 0.2, h * 0.1), de = color(w * 0.8, h * 0.1);
  return { tam: w + 'x' + h, proporcion: Math.round((w / h) * 100) / 100, izquierda: espejo ? de : iz, derecha: espejo ? iz : de, pixeles_izquierda: iz, espejo,
    cuadrado: x0 >= 0 && y0 >= 0 ? Math.round(((x1 - x0 + 1) / (y1 - y0 + 1)) * 100) / 100 : null, ajuste: cs.objectFit, parte_visible: Math.round(visible * 100) / 100 };
}, [SQ]);

(async () => {
  const y4m = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'nexo-cam-')), 'retrato.y4m');
  makeY4m(y4m);
  const browser = await PW.chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--use-file-for-fake-video-capture=' + y4m] });
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', opts), nB = new NativePhone('B', 'BB:BB:BB:BB:BB:02', opts);
  radio.add(nA); radio.add(nB); nA.load(); nB.load();
  const [A, B] = await Promise.all([boot(browser, 'A', nA), boot(browser, 'B', nB)]);
  await A.evaluate(() => window.bleInterface.togglePanel());
  for (let i = 0; i < 100; i++) { await sleep(150); const ok = await click(A, '#ble-new-device button'); if (ok) break; const scanning = await A.evaluate(() => window.bleInterface.isScanning); if (!scanning) await click(A, '#ble-scan-btn'); }
  await sleep(1500);
  await A.evaluate(() => window.bleInterface.togglePanel());
  await click(A, '#main-contacts-list .ble-contact-row'); await sleep(400);
  await sendText(A, 'hola'); await sleep(2500);
  await click(B, '#main-contacts-list .ble-contact-row'); await sleep(600);
  const r = { build: path.basename(buildDir), camara_A: CW + 'x' + CH + ' (vertical)' };
  for (let i = 0; i < 200 && !(await A.evaluate(() => window.bleInterface.calls.canVideo(Array.from(window.bleInterface.lan.links.keys())[0] || ''))); i++) await sleep(200);
  await click(A, '#nexo-video-btn');
  for (let i = 0; i < 100 && !(await B.evaluate(() => !!document.querySelector('#nexo-call-screen .call-accept'))); i++) await sleep(200);
  await click(B, '#nexo-call-screen .call-accept');
  await sleep(seconds * 1000);
  r.A_camara_da = await A.evaluate(() => { const v = (window.bleInterface.calls.videoViews() || {}).local; return v ? v.videoWidth + 'x' + v.videoHeight : null; });
  r.A_se_ve = await A.evaluate(() => { const v = (window.bleInterface.calls.videoViews() || {}).local; return v ? (getComputedStyle(v).transform.indexOf('-1') >= 0 ? 'en espejo' : 'sin espejo') : null; });
  r.frontal = await look(B);
  // Dos toques en la imagen del otro: a toda la pantalla (y otros dos: entera otra vez)
  const dbl = (p) => p.evaluate(() => { const rc = document.querySelector('#nexo-call-screen .call-remote-video'); if (rc) rc.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); });
  await dbl(B); await sleep(300);
  r.dos_toques = (await look(B) || {}).ajuste || null;
  await dbl(B); await sleep(300);
  r.dos_toques_otra_vez = (await look(B) || {}).ajuste || null;
  // Sin el espejo (Perfil): B ve a A al derecho
  await B.evaluate(() => localStorage.setItem('nexo_call_mirror', '0')); await sleep(1500);
  r.sin_espejo = await look(B);
  await B.evaluate(() => localStorage.removeItem('nexo_call_mirror')); await sleep(1500);
  // Cámara de detrás (en el simulador hay una sola cámara: es la misma imagen, ahora sin espejo)
  await click(A, '#nexo-call-screen .call-flip'); await sleep(3000);
  r.trasera = await look(B);
  r.decodificadas_B = await B.evaluate(() => (window.NEXO_callVideoStats || {}).decoded || 0);
  await click(A, '#nexo-call-screen .call-hangup'); await sleep(1200);
  r.errores = logs.filter((l) => /PAGEERROR|Vídeo \((codificar|recibir)\)/.test(l)).slice(0, 5);
  const f = r.frontal || {}, t = r.trasera || {}, se = r.sin_espejo || {};
  const ok = Math.abs((f.proporcion || 0) - CW / CH) < 0.04 && Math.abs((f.cuadrado || 0) - 1) < 0.12 && f.izquierda === 'azul' && f.derecha === 'rojo' &&
    f.pixeles_izquierda === 'rojo' && se.izquierda === 'rojo' && t.izquierda === 'rojo' && t.derecha === 'azul' && f.parte_visible >= 0.99 && r.dos_toques === 'cover' && r.dos_toques_otra_vez === 'contain' &&
    r.decodificadas_B >= seconds * 8 && !r.errores.length;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('VIDEOFRAME ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_videoframe.txt'), logs.join('\n'));
  await browser.close();
  try { fs.rmSync(path.dirname(y4m), { recursive: true, force: true }); } catch (e) {}
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error(e); fs.writeFileSync(path.join(__dirname, 'last_logs_videoframe.txt'), logs.join('\n')); process.exit(1); });
