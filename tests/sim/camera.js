// Cámara en Chromium REAL con una cámara simulada (--use-fake-device-for-media-stream): interfaz nueva
// (VÍDEO/FOTO, disparador, contador, girar), revisar antes de enviar (Repetir / Enviar), cámara frontal en
// espejo y foto igual que se ve, vídeo grabado y enviado. La radio sigue simulada en Node.
// Uso: node camera.js <dir_build>
'use strict';
const fs = require('fs');
const path = require('path');
const { Radio, NativePhone } = require('./native_mock');
const PW = (() => { try { return require('playwright'); } catch (e) { return require('/opt/node22/lib/node_modules/playwright'); } })();

const buildDir = path.resolve(process.argv[2]);
const dist = path.join(buildDir, 'dist');
const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith('--' + k)); if (!a) return d; const v = a.split('=')[1]; return v === undefined ? true : Number(v); };
const big = !!arg('big', false); // clip 1080p a 8 Mbps (como uno de la cámara del teléfono)
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
  const browser = await PW.chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
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
  const idA = await A.evaluate(() => window.bleInterface.localNexoId);
  const r = { build: path.basename(buildDir) };
  const state = () => A.evaluate(() => {
    const q = (s) => document.querySelector(s);
    const v = q('#camera-preview-container video');
    return { abierta: !q('#camera-preview-overlay').classList.contains('hidden'), video: !!(v && v.videoWidth), w: v ? v.videoWidth : 0, h: v ? v.videoHeight : 0,
      espejo: q('#camera-preview-container').classList.contains('mirror'), transform: v ? getComputedStyle(v).transform : '',
      modo: (q('.cam-mode.active') || {}).textContent, disparador: q('#camera-btn-capture').className, contador: q('#cam-timer').classList.contains('hidden') ? null : q('#cam-timer-text').textContent,
      revision: !q('#cam-review').classList.contains('hidden'), revision_img: !!q('#cam-review-media img'), revision_video: !!q('#cam-review-media video'), error: q('#camera-preview-status').textContent };
  });
  const waitState = async (f, ms) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const s = await state(); if (f(s)) return s; await sleep(200); } return state(); };
  // Abrir la cámara desde el menú de adjuntar
  await click(A, '.attach-menu-item[data-type="camera"]');
  let s = await waitState((x) => x.video, 8000);
  r.abre_trasera = { video: s.video, res: s.w + 'x' + s.h, espejo: s.espejo, modo: s.modo, disparador: s.disparador, error: s.error };
  // Foto → revisar → Repetir → otra foto → Enviar
  await click(A, '#camera-btn-capture');
  s = await waitState((x) => x.revision, 4000);
  r.foto_revision = s.revision && s.revision_img;
  r.camara_liberada_en_revision = await A.evaluate(() => !document.querySelector('#camera-preview-container video'));
  await click(A, '#cam-review-retake');
  s = await waitState((x) => x.video && !x.revision, 8000);
  r.repetir_vuelve_a_la_camara = s.video && !s.revision;
  // Frontal: espejo en pantalla y en la foto. Imagen de cámara asimétrica (izquierda roja, derecha azul) para
  // saber de qué lado sale cada cosa
  await A.evaluate(() => {
    const orig = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (c) => {
      const cv = document.createElement('canvas'); cv.width = 640; cv.height = 480;
      const x = cv.getContext('2d');
      const draw = () => { x.fillStyle = '#f00'; x.fillRect(0, 0, 320, 480); x.fillStyle = '#00f'; x.fillRect(320, 0, 320, 480); };
      draw(); setInterval(draw, 100);
      const st = cv.captureStream(15);
      if (c && c.audio) { try { const a = await orig({ audio: true }); a.getAudioTracks().forEach((t) => st.addTrack(t)); } catch (e) {} }
      return st;
    };
  });
  await click(A, '#camera-btn-flip');
  await sleep(500);
  s = await waitState((x) => x.video && x.espejo, 8000);
  r.frontal = { espejo: s.espejo, transform: s.transform };
  // En pantalla (espejo) la izquierda se ve azul; la foto debe tener la izquierda azul también
  r.foto_igual_que_se_ve = await A.evaluate(async () => {
    document.getElementById('camera-btn-capture').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await new Promise((res) => setTimeout(res, 500));
    const img = document.querySelector('#cam-review-media img');
    if (!img) return null;
    await img.decode();
    const d = document.createElement('canvas'); d.width = img.naturalWidth; d.height = img.naturalHeight;
    const y = d.getContext('2d'); y.drawImage(img, 0, 0);
    const px = y.getImageData(20, Math.round(d.height / 2), 1, 1).data;
    return { izquierda_de_la_foto: px[2] > 150 && px[0] < 100 ? 'azul (como se ve)' : px[0] > 150 ? 'roja (al revés)' : 'otro ' + px.slice(0, 3).join(',') };
  });
  await click(A, '#cam-review-send');
  r.foto_llega_s = await (async () => { const t0 = Date.now(); while (Date.now() - t0 < 60000) { const ok = await B.evaluate(async (id) => (await window.vaultLoadMessages(id)).some((m) => m.attachmentType === 'image'), idA); if (ok) return Math.round((Date.now() - t0) / 100) / 10; await sleep(500); } return null; })();
  r.foto_tamano = await B.evaluate(async (id) => { const m = (await window.vaultLoadMessages(id)).find((x) => x.attachmentType === 'image'); return m && m.attachmentMeta ? m.attachmentMeta.width + 'x' + m.attachmentMeta.height : null; }, idA);
  r.camara_cerrada_tras_enviar = !(await state()).abierta;
  // Vídeo: pestaña VÍDEO, grabar 3 s con contador, parar → revisar → Enviar
  await click(A, '.attach-menu-item[data-type="camera"]');
  await waitState((x) => x.video, 8000);
  await click(A, '#cam-mode-video');
  s = await waitState((x) => x.video && x.modo === 'VÍDEO', 8000);
  r.modo_video = { modo: s.modo, disparador: s.disparador };
  await click(A, '#camera-btn-capture');
  await sleep(3200);
  s = await state();
  r.grabando = { contador: s.contador, disparador: s.disparador };
  await click(A, '#camera-btn-capture');
  s = await waitState((x) => x.revision, 6000);
  r.video_revision = s.revision && s.revision_video;
  await click(A, '#cam-review-send');
  r.video_llega_s = await (async () => { const t0 = Date.now(); while (Date.now() - t0 < 120000) { const ok = await B.evaluate(async (id) => (await window.vaultLoadMessages(id)).some((m) => m.attachmentType === 'video'), idA); if (ok) return Math.round((Date.now() - t0) / 100) / 10; await sleep(1000); } return null; })();
  r.errores_pagina = logs.filter((l) => /PAGEERROR/.test(l)).slice(0, 3);
  r.registro = logs.filter((l) => /\[A\].*\[CAMERA\]/.test(l)).map((l) => l.replace(/^.*\[CAMERA\] /, '')).slice(0, 8);
  console.log('CAMERA ' + JSON.stringify(r, null, 1));
  fs.writeFileSync(path.join(__dirname, 'last_logs_camera.txt'), logs.join('\n'));
  await browser.close();
  process.exit(0);
})().catch((e) => { console.error('FALLO:', e.stack); fs.writeFileSync(path.join(__dirname, 'last_logs_camera.txt'), logs.join('\n')); process.exit(1); });
