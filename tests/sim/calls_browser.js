// Llamada de voz con audio de verdad en Chromium (ronda 2758): micrófono falso de Chromium (un pitido), WebCodecs Opus,
// cifrado, envío por la radio simulada y reproducción con WebAudio. Comprueba que en cada teléfono se reproduce audio
// del otro (segundos y volumen), con qué códec y cuánto ocupa (KB/s en el aire).
// Uso: node calls_browser.js <dir_build> [--seconds=6] [--ulaw]  (--ulaw: como un teléfono sin Opus)
'use strict';
const fs = require('fs');
const path = require('path');
const { Radio, NativePhone } = require('./native_mock');
const PW = (() => { try { return require('playwright'); } catch (e) { return require('/opt/node22/lib/node_modules/playwright'); } })();

const buildDir = path.resolve(process.argv[2]);
const dist = path.join(buildDir, 'dist');
const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith('--' + k)); if (!a) return d; const v = a.split('=')[1]; return v === undefined ? true : Number(v); };
const seconds = arg('seconds', 6), ULAW = !!arg('ulaw', false);
const opts = { readsContentFallback: true, retain: ['onPayloadReceived'], closeOnNoService: true, pace: [15, 15], ioDelay: arg('io-delay', 25), supervisionMs: 3000 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const logs = [];
const TYPES = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json', '.woff2': 'font/woff2' };

async function boot(browser, name, native) {
  const page = await browser.newPage();
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
    // Contar reproductores de vídeo que quedan vivos (en Android cada uno ocupa un decodificador)
    window.__videos = [];
    const ce = document.createElement.bind(document);
    document.createElement = function (tag, o) { const el = ce(tag, o); if (String(tag).toLowerCase() === 'video') window.__videos.push(el); return el; };
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

(async () => {
  const browser = await PW.chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', opts), nB = new NativePhone('B', 'BB:BB:BB:BB:BB:02', opts);
  radio.add(nA); radio.add(nB); nA.load(); nB.load();
  const [A, B] = await Promise.all([boot(browser, 'A', nA), boot(browser, 'B', nB)]);
  if (ULAW) for (const p of [A, B]) await p.evaluate(() => { window.AudioEncoder = undefined; window.AudioDecoder = undefined; });
  await A.evaluate(() => window.bleInterface.togglePanel());
  for (let i = 0; i < 100; i++) { await sleep(150); const ok = await click(A, '#ble-new-device button'); if (ok) break; const scanning = await A.evaluate(() => window.bleInterface.isScanning); if (!scanning) await click(A, '#ble-scan-btn'); }
  await sleep(1500);
  await A.evaluate(() => window.bleInterface.togglePanel());
  await click(A, '#main-contacts-list .ble-contact-row'); await sleep(400);
  await sendText(A, 'hola'); await sleep(2500);
  await click(B, '#main-contacts-list .ble-contact-row'); await sleep(600);
  const r = { build: path.basename(buildDir), sin_opus: ULAW };
  const air0 = nA.stats.airBytes || 0, airB0 = nB.stats.airBytes || 0;
  await click(A, '#nexo-call-btn');
  for (let i = 0; i < 100 && !(await B.evaluate(() => !!document.querySelector('#nexo-call-screen .call-accept'))); i++) await sleep(200);
  await click(B, '#nexo-call-screen .call-accept');
  const t0 = Date.now();
  await sleep(seconds * 1000);
  const st = async (p) => p.evaluate(() => { const c = window.bleInterface.calls; const a = window.NEXO_callAudioStats || { samples: 0, seconds: 0, energy: 0 }; return { estado: c.call && c.call.state, codec: c.call && c.call.codec, mic: c.call && c.call.micError, enviados: c.stats.sent, recibidos: c.stats.got, malos: c.stats.bad, audio_s: Math.round(a.seconds * 10) / 10, volumen_rms: a.samples ? Math.round(Math.sqrt(a.energy / a.samples) * 1000) / 1000 : 0 }; });
  r.A = await st(A); r.B = await st(B);
  const secs = (Date.now() - t0) / 1000;
  r.KB_por_segundo_aire = Math.round(((nA.stats.airBytes || 0) - air0) / secs / 102.4) / 10;
  await click(A, '#nexo-call-screen .call-hangup'); await sleep(1500);
  r.fin = { A: await A.evaluate(() => !window.bleInterface.calls.call), B: await B.evaluate(() => !window.bleInterface.calls.call) };
  r.errores = logs.filter((l) => /PAGEERROR|\[CALL\] (Opus|Micr)/.test(l)).slice(0, 5);
  const want = ULAW ? 'ulaw' : 'opus';
  const ok = ['A', 'B'].every((k) => r[k].estado === 'active' && r[k].codec === want && !r[k].mic && r[k].recibidos >= seconds * (ULAW ? 5 : 6) && !r[k].malos && r[k].audio_s >= seconds * 0.7 && r[k].volumen_rms > 0.005) && r.fin.A && r.fin.B && !r.errores.length;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('CALLAUDIO ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_calls_browser.txt'), logs.join('\n'));
  await browser.close();
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error(e); fs.writeFileSync(path.join(__dirname, 'last_logs_calls_browser.txt'), logs.join('\n')); process.exit(1); });
