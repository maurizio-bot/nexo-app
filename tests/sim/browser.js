// Simulador de dos teléfonos en Chromium REAL (Playwright): la app corre en dos páginas y la radio
// sigue simulada en Node (native_mock.js). A diferencia de jsdom, aquí funcionan de verdad <video>,
// canvas, MediaRecorder, WebAudio y blob URLs: previa del vídeo, miniatura, reproducción.
// Uso: node browser.js <dir_build> [--seconds=5] [--views=3] [--closed] [--io-delay=25]
'use strict';
const fs = require('fs');
const path = require('path');
const { Radio, NativePhone } = require('./native_mock');
const PW = (() => { try { return require('playwright'); } catch (e) { return require('/opt/node22/lib/node_modules/playwright'); } })();

const buildDir = path.resolve(process.argv[2]);
const dist = path.join(buildDir, 'dist');
const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith('--' + k)); if (!a) return d; const v = a.split('=')[1]; return v === undefined ? true : Number(v); };
const seconds = arg('seconds', 5), views = arg('views', 3), closed = !!arg('closed', false), noPreview = !!arg('no-preview', false);
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
  const browser = await PW.chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', opts), nB = new NativePhone('B', 'BB:BB:BB:BB:BB:02', opts);
  radio.add(nA); radio.add(nB); nA.load(); nB.load();
  let [A, B] = await Promise.all([boot(browser, 'A', nA), boot(browser, 'B', nB)]);
  // Emparejar y abrir chats
  await A.evaluate(() => window.bleInterface.togglePanel());
  for (let i = 0; i < 100; i++) { await sleep(150); const ok = await click(A, '#ble-new-device button'); if (ok) break; const scanning = await A.evaluate(() => window.bleInterface.isScanning); if (!scanning) await click(A, '#ble-scan-btn'); }
  await sleep(1500);
  await A.evaluate(() => window.bleInterface.togglePanel());
  await click(A, '#main-contacts-list .ble-contact-row'); await sleep(400);
  await sendText(A, 'hola'); await sleep(2500);
  await click(B, '#main-contacts-list .ble-contact-row'); await sleep(600);
  const idA = await A.evaluate(() => window.bleInterface.localNexoId);

  // Clip real grabado con MediaRecorder (como la cámara): 1280x720, 1,5 Mbps, con audio
  const clip = await A.evaluate(async (seconds) => {
    const c = document.createElement('canvas'); c.width = 1280; c.height = 720; const ctx = c.getContext('2d');
    const s = c.captureStream(30);
    const ac = new AudioContext(); const o = ac.createOscillator(); const d = ac.createMediaStreamDestination(); o.connect(d); o.start();
    s.addTrack(d.stream.getAudioTracks()[0]);
    const mime = ['video/mp4', 'video/webm;codecs=vp8,opus', 'video/webm'].find((m) => MediaRecorder.isTypeSupported(m));
    const r = new MediaRecorder(s, { mimeType: mime, videoBitsPerSecond: 1500000 });
    const parts = []; r.ondataavailable = (e) => { if (e.data.size) parts.push(e.data); };
    let f = 0;
    const iv = setInterval(() => { ctx.fillStyle = `hsl(${(f * 7) % 360},70%,45%)`; ctx.fillRect(0, 0, 1280, 720); ctx.fillStyle = '#fff'; ctx.font = '140px sans-serif'; ctx.fillText('NEXO ' + f++, 120, 420); for (let i = 0; i < 400; i++) ctx.fillRect(Math.random() * 1280, Math.random() * 720, 10, 10); }, 33);
    r.start(100);
    await new Promise((res) => setTimeout(res, seconds * 1000));
    clearInterval(iv);
    await new Promise((res) => { r.onstop = res; r.stop(); });
    window.__clip = new Blob(parts, { type: mime.split(';')[0] });
    return { mime, KB: Math.round(window.__clip.size / 1024) };
  }, seconds);
  const res = { build: path.basename(buildDir), clip, app_B_cerrada: closed, previa_forzada_a_fallar: noPreview };
  if (noPreview) await A.evaluate(() => { window.MediaRecorder = undefined; });

  if (closed) { await B.close(); nB.destroyActivity(); await sleep(15000); }
  const t0 = Date.now();
  await A.evaluate((s) => window.NEXO_sendVideo(window.__clip, { duration: s }), seconds);
  if (closed) {
    await sleep(60000);
    nB.load(); await sleep(3000);
    B = await boot(browser, 'B', nB);
    await click(B, '#main-contacts-list .ble-contact-row'); await sleep(600);
  }
  // Seguir el proceso en B
  for (let i = 0; i < 900; i++) {
    await sleep(1000);
    const st = await B.evaluate(async (idA) => {
      const msgs = await window.vaultLoadMessages(idA);
      const v = msgs.find((m) => m.attachmentType === 'video');
      return v ? { meta: { hd: !!(v.attachmentMeta && v.attachmentMeta.hd), preview: !!(v.attachmentMeta && v.attachmentMeta.preview), thumb: !!(v.attachmentMeta && v.attachmentMeta.thumb) } } : null;
    }, idA);
    if (st && !res.video_llega_s) { res.video_llega_s = Math.round((Date.now() - t0) / 1000); res.llega_como = st.meta; }
    if (st && st.meta.hd) { res.HD_llega_s = Math.round((Date.now() - t0) / 1000); break; }
  }
  // Previa generada de verdad en A (log de _makeVideoPreview)
  res.previa_log = logs.filter((l) => /\[A\].*\[VIDEO\]/.test(l)).map((l) => l.substring(l.indexOf('[VIDEO]'), l.indexOf('[VIDEO]') + 120));
  await sleep(1500);
  // Burbuja en B: miniatura y reproducción repetida (visor a pantalla completa)
  res.burbuja_B = await B.evaluate(() => {
    const m = Array.from(document.querySelectorAll('#messages-container .message')).find((x) => x.querySelector('.video-attachment'));
    if (!m) return null;
    const img = m.querySelector('.video-attachment img'); const v = m.querySelector('.video-attachment video');
    return { miniatura: !!((img && img.src && img.src.indexOf('data:image') === 0) || (v && v.poster)), etiqueta: (m.querySelector('.hd-badge') || {}).textContent || null };
  });
  res.reproducciones = [];
  for (let k = 0; k < views; k++) {
    await B.evaluate(() => { const m = Array.from(document.querySelectorAll('#messages-container .message')).find((x) => x.querySelector('.video-attachment')); const t = m && m.querySelector('.video-attachment'); if (t) t.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    await sleep(2500);
    const play = await B.evaluate(() => {
      const ov = document.getElementById('fullscreen-media-overlay'); const v = ov && ov.querySelector('video');
      return v ? { readyState: v.readyState, currentTime: Math.round(v.currentTime * 10) / 10, error: v.error ? v.error.code : null, paused: v.paused } : null;
    });
    res.reproducciones.push(play && play.currentTime > 0 && !play.error ? 'se reproduce (' + play.currentTime + ' s)' : 'NO: ' + JSON.stringify(play));
    await B.evaluate(() => { const ov = document.getElementById('fullscreen-media-overlay'); const b = ov && ov.querySelector('button'); if (b) b.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    await sleep(500);
  }
  res.reproductores_vivos_B = await B.evaluate(() => window.__videos.filter((v) => v.currentSrc && (v.readyState > 0 || !v.paused) && !v.isConnected).length + ' sueltos (fuera de la pantalla), ' + window.__videos.filter((v) => v.isConnected && v.currentSrc && v.readyState > 0).length + ' en pantalla');
  // Diagnóstico: Perfil → texto con el registro
  res.diagnostico_A = await A.evaluate(async () => {
    const tab = document.querySelector('.ble-nav-item[data-tab="profile"]');
    if (!tab) return 'sin pestaña';
    tab.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 300));
    const ta = document.getElementById('nexo-diag-text');
    if (!ta) return 'no abre';
    return ta.value.split('\n').length + ' líneas, ' + ta.value.split('\n').filter((l) => l.indexOf('[VIDEO]') >= 0).length + ' de [VIDEO]';
  });
  res.errores_pagina = logs.filter((l) => /PAGEERROR/.test(l)).slice(0, 5);
  console.log('BROWSER ' + JSON.stringify(res, null, 1));
  fs.writeFileSync(path.join(__dirname, 'last_logs_browser.txt'), logs.join('\n'));
  await browser.close();
  process.exit(0);
})().catch((e) => { console.error('FALLO:', e.stack); fs.writeFileSync(path.join(__dirname, 'last_logs_browser.txt'), logs.join('\n')); process.exit(1); });
