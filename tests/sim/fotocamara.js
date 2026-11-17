// 3171 (dueño 17-11: «las fotos se ven mal»; aprobó la opción A): la foto de la CÁMARA sale de la cámara del propio teléfono.
// Hasta la 3170 «Cámara» abría la cámara de NEXO y la foto era un cuadro del vídeo de la vista previa (getUserMedia ≤ 1080p): sin el
// modo noche ni el procesado del teléfono (una foto nocturna del S24 Ultra se veía muy mal). Ahora «Cámara» abre DIRECTO la cámara
// del teléfono (@capacitor/camera, getPhoto con source CAMERA); al volver, la foto pasa por la revisión «Antes de enviar» de la galería
// (con el ojo «ver una vez») y sale por el mismo camino que una foto de la galería (_photoTarget: 1600/82 por un camino rápido,
// 1280/75 solo Bluetooth). Si el usuario sale de la cámara del teléfono sin tomar foto, queda en la cámara de NEXO abierta en VÍDEO;
// sin el plugin o si falla (no por cancelar), la cámara de NEXO como antes (en FOTO).
// Chromium real (lienzo para comprimir y decodificar; cámara falsa para la vista previa de NEXO). El plugin Camera se simula en la
// página ANTES de que arranque la app y hace lo que hace el nativo (CameraPlugin 5.0.10): una foto de 4000x3000, reducida al
// recuadro width x height SIN suavizar (Bitmap.createScaledBitmap(…, false)) y en JPEG con su `quality`. Casos:
//  (a) solo Bluetooth: «Cámara» → getPhoto({source:'CAMERA', resultType:'base64', width/height = 2 x 1280, correctOrientation,
//      saveToGallery:false}) sin pausar el Bluetooth ni abrir la cámara de NEXO → «Antes de enviar» con 1 miniatura y su ojo →
//      «Enviar (1)» → B la recibe decodificada a 1280 px de lado mayor y JPEG ~75 %;
//  (b) misma red Wi-Fi: pide 2 x 1600 → B la recibe a 1600 px y ~82 %; otra con el ojo marcado → llega «ver una vez» (meta.once);
//  (c) salir de la cámara del teléfono sin tomar foto («User cancelled photos app») → cámara de NEXO abierta en VÍDEO, sin revisión
//      y sin mandar nada;
//  (d) sin el plugin → cámara de NEXO en FOTO, como antes;
//  (e) el plugin falla («Unable to create photo on disk») → cámara de NEXO en FOTO, sin revisión.
// Por qué base64 y el doble del lado (camera.js): con 'uri' el plugin deja su archivo en el teléfono para siempre; y al reducir no
// suaviza, así que la última mitad la hace el lienzo de la app.
// Uso: node fotocamara.js <dir_build>   (imprime FOTOCAMARA {json} con "resultado":"OK"|"FALLO"; sale 0/1)
'use strict';
const fs = require('fs');
const path = require('path');
const { PW, bootPhone, sleep } = require('./pw_harness');
const { Radio, NativePhone } = require('./native_mock');

const dist = path.resolve(process.argv[2], 'dist');
const logs = [];
const r = { prueba: 'fotocamara', build: path.basename(process.argv[2]) };
const fin = (ok, extra) => {
  Object.assign(r, extra || {});
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('FOTOCAMARA ' + JSON.stringify(r));
  try { fs.writeFileSync(path.join(__dirname, 'last_logs_fotocamara.txt'), logs.join('\n')); } catch (e) {}
};
const base = { readsContentFallback: true, retain: ['onPayloadReceived', 'onLanMessage', 'onLanUp', 'onLanDown'], closeOnNoService: true, pace: [5, 5], ioDelay: 10, asymmetric: true, noTor: true, noL2: true };
const SEED = { A: 'Ana', B: 'Beto' };
const MAC = { A: 'AA:AA:AA:AA:AA:01', B: 'BB:BB:BB:BB:BB:02' };
const waitFor = async (fn, ms) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return Math.round((Date.now() - t0) / 100) / 10; await sleep(250); } return null; };

// ---- JPEG: tamaño (SOF) y calidad estimada por la tabla de luminancia (DQT), como fotocalidad.js ----
const STD_LUM = [16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55, 14, 13, 16, 24, 40, 57, 69, 56, 14, 17, 22, 29, 51, 87, 80, 62,
  18, 22, 37, 56, 68, 109, 103, 77, 24, 35, 55, 64, 81, 104, 113, 92, 49, 64, 78, 87, 103, 121, 120, 101, 72, 92, 95, 98, 112, 100, 103, 99];
const lumSum = (q) => { const s = q < 50 ? Math.floor(5000 / q) : 200 - q * 2; return STD_LUM.reduce((a, v) => a + Math.min(255, Math.max(1, Math.floor((v * s + 50) / 100))), 0); };
function jpegInfo(b64) {
  const b = Buffer.from(b64, 'base64');
  if (b[0] !== 0xFF || b[1] !== 0xD8) return null;
  let i = 2, w = 0, h = 0, lum = null;
  while (i + 4 <= b.length) {
    if (b[i] !== 0xFF) { i++; continue; }
    const mk = b[i + 1], len = b.readUInt16BE(i + 2);
    if (mk === 0xDB) {
      let j = i + 4;
      while (j < i + 2 + len) { const pq = b[j] >> 4, tq = b[j] & 15; const n = pq ? 128 : 64; if (tq === 0 && !lum) { lum = []; for (let k = 0; k < 64; k++) lum.push(pq ? b.readUInt16BE(j + 1 + k * 2) : b[j + 1 + k]); } j += 1 + n; }
    } else if (mk >= 0xC0 && mk <= 0xC2) { h = b.readUInt16BE(i + 5); w = b.readUInt16BE(i + 7); }
    if (mk === 0xDA) break;
    i += 2 + len;
  }
  let q = null;
  if (lum) { const s = lum.reduce((a, v) => a + v, 0); let best = 1e9; for (let k = 1; k <= 100; k++) { const d = Math.abs(lumSum(k) - s); if (d < best) { best = d; q = k; } } }
  return { w, h, q, kb: Math.round(b.length / 1024) };
}

// ---- el plugin Camera simulado (se instala antes de que arranque la app; el arnés luego pone window.Capacitor y se le cuelga) ----
function cameraMock() {
  window.__cam = { mode: 'photo', calls: [], made: [] };
  const photo = () => {
    const W = 4000, H = 3000;
    const c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d');
    const gr = g.createLinearGradient(0, 0, W, H); gr.addColorStop(0, '#0b1d2e'); gr.addColorStop(0.5, '#5a3d6e'); gr.addColorStop(1, '#e09f3e');
    g.fillStyle = gr; g.fillRect(0, 0, W, H);
    let s = 11; const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    for (let i = 0; i < 1200; i++) { g.fillStyle = 'hsla(' + Math.floor(rnd() * 360) + ',60%,' + Math.floor(25 + rnd() * 55) + '%,0.55)'; g.beginPath(); g.arc(rnd() * W, rnd() * H, 8 + rnd() * 150, 0, 7); g.fill(); }
    g.fillStyle = '#fff'; g.font = 'bold 200px sans-serif'; g.fillText('NEXO cámara', W * 0.1, H * 0.5);
    return c;
  };
  const b64ToBlob = (b64) => { const bin = atob(b64); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return new Blob([u], { type: 'image/jpeg' }); };
  const mock = {
    async getPhoto(o) {
      const opts = JSON.parse(JSON.stringify(o || {}));
      window.__cam.calls.push(opts);
      await new Promise((res) => setTimeout(res, 400)); // la app de cámara del teléfono, abierta
      if (window.__cam.mode === 'cancel') throw new Error('User cancelled photos app');
      if (window.__cam.mode === 'error') throw new Error('Unable to create photo on disk');
      const src = photo(), W = src.width, H = src.height;
      let w = W, h = H;
      if ((opts.width || 0) > 0 || (opts.height || 0) > 0) { // ImageUtils.resizePreservingAspectRatio
        const mw = opts.width || W, mh = opts.height || H;
        let nw = Math.min(W, mw), nh = (H * nw) / W;
        if (nh > mh) { nw = (W * mh) / H; nh = mh; }
        w = Math.round(nw); h = Math.round(nh);
      }
      const out = document.createElement('canvas'); out.width = w; out.height = h; const g = out.getContext('2d');
      g.imageSmoothingEnabled = false; // createScaledBitmap(…, false): sin suavizar
      g.drawImage(src, 0, 0, w, h);
      const url = out.toDataURL('image/jpeg', (opts.quality || 90) / 100), b64 = url.split(',')[1];
      window.__cam.made.push({ w, h, kb: Math.round((b64.length * 3) / 4 / 1024) });
      const rt = String(opts.resultType || 'base64').toLowerCase();
      if (rt === 'base64') return { base64String: b64, format: 'jpeg', exif: {}, saved: false };
      if (rt === 'dataurl') return { dataUrl: url, format: 'jpeg', exif: {}, saved: false };
      return { webPath: URL.createObjectURL(b64ToBlob(b64)), path: 'file:///storage/emulated/0/Android/data/com.nexo.app/files/Pictures/JPEG_x.jpg', format: 'jpeg', saved: false };
    },
  };
  window.__camMock = mock;
  let cap;
  Object.defineProperty(window, 'Capacitor', {
    configurable: true, enumerable: true,
    get() { return cap; },
    set(v) { cap = v; try { if (v && typeof v === 'object') { v.Plugins = v.Plugins || {}; if (!v.Plugins.Camera) v.Plugins.Camera = mock; } } catch (e) {} },
  });
}

// ---- teléfonos ----
async function phone(browser, name, extra, withCam) {
  const native = new NativePhone(name, MAC[name], Object.assign({}, base, extra || {}));
  const b2 = { newPage: async (o) => { const p = await browser.newPage(o); await p.addInitScript(() => { window.NEXO_NET_RELAYS = []; }); if (withCam) await p.addInitScript(cameraMock); return p; } };
  return { name, native, boot: async () => (await bootPhone(b2, name, native, dist, { phone: true, logs, seedName: SEED[name], lang: 'es' })).page };
}
const idOf = (pg) => pg.evaluate(() => window.bleInterface.localNexoId.toLowerCase());
async function pair(pg, names) {
  await pg.evaluate(() => window.bleInterface.togglePanel());
  let ok = false;
  for (let i = 0; i < 200 && !ok; i++) {
    await sleep(150);
    ok = await pg.evaluate((ns) => {
      const row = Array.from(document.querySelectorAll('#ble-new-device > div')).find((d) => ns.indexOf(((d.querySelector('span') || {}).textContent || '').trim()) >= 0);
      const b = row && row.querySelector('button'); if (b) { b.click(); return true; }
      if (!window.bleInterface.isScanning) { const s = document.getElementById('ble-scan-btn'); if (s) s.click(); }
      return false;
    }, names);
  }
  await sleep(2000);
  await pg.evaluate(() => { if (document.getElementById('ble-panel').classList.contains('active')) window.bleInterface.togglePanel(); });
  return ok;
}
const openChat = async (pg, id) => { await pg.evaluate((x) => window.bleInterface.openChat(x).catch(() => {}), id); await sleep(700); };
const sendText = (pg, t) => pg.evaluate((s) => { const i = document.getElementById('message-input'); i.value = s; i.dispatchEvent(new Event('input', { bubbles: true })); document.getElementById('send-btn').click(); }, t);
const linkOf = (pg, id) => pg.evaluate((x) => window.bleInterface.linkOf(x), id);
const ownImages = (pg, chat) => pg.evaluate(async (c) => ((await window.vaultLoadMessages(c)) || []).filter((y) => y.attachmentType === 'image' && y._own && !y.deleted)
  .map((y) => ({ id: y.messageId || y.msgId, name: (y.attachmentMeta || {}).name || '', once: !!(y.attachmentMeta && y.attachmentMeta.once) })), chat);
const recvImages = (pg, chat) => pg.evaluate(async (c) => ((await window.vaultLoadMessages(c)) || []).filter((y) => y.attachmentType === 'image' && !y._own && !y.deleted)
  .map((y) => ({ id: y.messageId || y.msgId, once: !!(y.attachmentMeta && y.attachmentMeta.once) })), chat);
// La última foto recibida (sin «una vez») en ese chat: su contenido (del mensaje o del archivo del teléfono)
async function lastPhoto(pg, native, chat) {
  const m = await pg.evaluate(async (c) => {
    const ms = (await window.vaultLoadMessages(c)) || [];
    const x = ms.filter((y) => y.attachmentType === 'image' && !y._own && !y.deleted && !(y.attachmentMeta && y.attachmentMeta.once)).pop();
    if (!x) return null;
    const p = x.attachmentPayload;
    return { id: x.messageId || x.msgId, b64: typeof p === 'string' && p.length > 200 ? p : null, ref: x.attachmentRef || null };
  }, chat);
  if (!m) return null;
  const b64 = m.b64 || (m.ref && native.files.get(m.ref)) || null;
  return b64 ? { id: m.id, b64 } : null;
}
async function measure(pg, native, chat, ms) {
  let got = null;
  const s = await waitFor(async () => !!(got = await lastPhoto(pg, native, chat)), ms);
  if (!got) return { llega: false };
  const dec = await pg.evaluate((b) => new Promise((res) => { const im = new Image(); im.onload = () => res({ w: im.naturalWidth, h: im.naturalHeight }); im.onerror = () => res(null); im.src = 'data:image/jpeg;base64,' + b; }), got.b64);
  const info = jpegInfo(got.b64) || {};
  return { llega: true, s, ancho: dec && dec.w, alto: dec && dec.h, lado_mayor: dec ? Math.max(dec.w, dec.h) : 0, calidad: info.q, kb: info.kb };
}

// Tocar «Cámara» en el menú de adjuntar y ver qué pasa: ¿se llamó al plugin?, ¿salió la revisión?, ¿se abrió la cámara de NEXO y en qué modo?
async function tapCamera(pg) {
  const n0 = await pg.evaluate(() => (window.__cam ? window.__cam.calls.length : 0));
  await pg.evaluate(() => document.querySelector('.attach-menu-item[data-type="camera"]').click());
  const st = () => pg.evaluate((n) => {
    const ov = document.getElementById('camera-preview-overlay');
    const rv = document.getElementById('nexo-gallery-review');
    const c = window.__cam || { calls: [], made: [] };
    return {
      llamada: c.calls.length > n ? c.calls[n] : null,
      hecha: c.calls.length > n ? c.made[c.made.length - 1] || null : null,
      revision: !!rv,
      miniaturas: rv ? rv.querySelectorAll('.nx-grev-item img').length : 0,
      ojos: rv ? rv.querySelectorAll('.nx-grev-eye').length : 0,
      camara_nexo: !!ov && !ov.classList.contains('hidden'),
      modo: document.querySelector('#cam-mode-video.active') ? 'video' : document.querySelector('#cam-mode-photo.active') ? 'foto' : null,
      vista_previa: !!document.querySelector('#camera-preview-container video'),
      ble_pausado: !!(window.bleInterface && window.bleInterface._cameraBlePaused),
    };
  }, n0);
  let s = null;
  await waitFor(async () => { s = await st(); return s.revision || (s.camara_nexo && s.vista_previa); }, 10000);
  await sleep(600);
  return st();
}
async function closeNexoCamera(pg) {
  await pg.evaluate(() => { const ov = document.getElementById('camera-preview-overlay'); if (ov && !ov.classList.contains('hidden')) document.getElementById('camera-btn-close').click(); });
  await sleep(1200);
}
// En la revisión: (opcional) tocar el ojo y «Enviar (1)»
const sendReview = (pg, eye) => pg.evaluate((e) => {
  const rv = document.getElementById('nexo-gallery-review');
  if (!rv) return false;
  if (e) { const b = rv.querySelector('.nx-grev-eye'); if (b) b.click(); }
  const s = rv.querySelector('#nexo-grev-send'); if (!s) return false; s.click(); return true;
}, eye);
const pedidoOk = (c, side) => !!c && c.source === 'CAMERA' && c.resultType === 'base64' && c.width === side && c.height === side && c.correctOrientation === true && c.saveToGallery === false && typeof c.quality === 'number' && c.quality >= 85;
const closePages = async (...pgs) => { for (const p of pgs) { try { await p.context().close(); } catch (e) {} } };

async function twoPhones(browser, optsA, optsB, ready) {
  const radio = new Radio();
  const a = await phone(browser, 'A', optsA, true), b = await phone(browser, 'B', optsB, false);
  radio.add(a.native); radio.add(b.native); a.native.load(); b.native.load();
  const A = await a.boot(), B = await b.boot();
  const idA = await idOf(A), idB = await idOf(B);
  if (!(await pair(A, ['B', SEED.B]))) return { error: 'no empareja' };
  await openChat(A, idB); await sendText(A, 'hola'); await sleep(2500);
  await openChat(B, idA); await sendText(B, 'hola'); await sleep(2500);
  const listo = await ready({ A, B, idA, idB });
  return { A, B, idA, idB, a, b, listo };
}

(async () => {
  const browser = await PW.chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  const okQ = (v, q) => typeof v === 'number' && Math.abs(v - q) <= 1;
  try {
    // 1) solo Bluetooth: (a), (c), (d), (e)
    let s = await twoPhones(browser, {}, {}, async () => 0);
    if (s.error) throw new Error(s.error);
    r.bt = { camino: await linkOf(s.A, s.idB) };
    const t = await tapCamera(s.A);
    r.bt.a = Object.assign({}, t);
    if (t.revision) {
      await sendReview(s.A, false);
      Object.assign(r.bt.a, await measure(s.B, s.b.native, s.idA, 180000));
      const own = await ownImages(s.A, s.idB);
      r.bt.a.nombre = own.length ? own[own.length - 1].name : null;
      r.bt.a.una_vez = own.length ? own[own.length - 1].once : null;
    } else await closeNexoCamera(s.A);
    // (c) salir sin tomar foto → cámara de NEXO en VÍDEO, sin revisión ni envío
    let before = (await ownImages(s.A, s.idB)).length;
    await s.A.evaluate(() => { window.__cam.mode = 'cancel'; });
    r.bt.c = await tapCamera(s.A);
    await sleep(1500);
    r.bt.c.nada_enviado = (await ownImages(s.A, s.idB)).length === before && !(await s.A.evaluate(() => !!document.getElementById('nexo-gallery-review')));
    await closeNexoCamera(s.A);
    r.bt.c.ble_reanudado = !(await s.A.evaluate(() => !!window.bleInterface._cameraBlePaused));
    // (d) sin el plugin → cámara de NEXO en FOTO
    await s.A.evaluate(() => { delete window.Capacitor.Plugins.Camera; });
    r.bt.d = await tapCamera(s.A);
    await closeNexoCamera(s.A);
    await s.A.evaluate(() => { window.Capacitor.Plugins.Camera = window.__camMock; window.__cam.mode = 'error'; });
    // (e) el plugin falla → cámara de NEXO en FOTO
    before = (await ownImages(s.A, s.idB)).length;
    r.bt.e = await tapCamera(s.A);
    r.bt.e.nada_enviado = (await ownImages(s.A, s.idB)).length === before;
    await closeNexoCamera(s.A);
    await closePages(s.A, s.B);

    // 2) misma red Wi-Fi (camino rápido): (a) a 1600 y (b) «ver una vez»
    s = await twoPhones(browser, { wifi: 'casa' }, { wifi: 'casa' }, async ({ A, B, idA, idB }) => waitFor(async () => (await linkOf(A, idB)) === 'wifi' && (await linkOf(B, idA)) === 'wifi', 30000));
    if (s.error) throw new Error(s.error);
    r.wifi = { camino: await linkOf(s.A, s.idB), listo_s: s.listo };
    const t2 = await tapCamera(s.A);
    r.wifi.a = Object.assign({}, t2);
    if (t2.revision) {
      await sendReview(s.A, false);
      Object.assign(r.wifi.a, await measure(s.B, s.b.native, s.idA, 120000));
    } else await closeNexoCamera(s.A);
    const t3 = await tapCamera(s.A);
    r.wifi.b = { revision: t3.revision, ojos: t3.ojos };
    if (t3.revision) {
      await sendReview(s.A, true);
      r.wifi.b.llega_s = await waitFor(async () => (await recvImages(s.B, s.idA)).some((x) => x.once), 120000);
      const own = await ownImages(s.A, s.idB);
      r.wifi.b.A_una_vez = own.length ? own[own.length - 1].once : null;
    } else await closeNexoCamera(s.A);
    r.wifi.b.B_una_vez = (await recvImages(s.B, s.idA)).filter((x) => x.once).length;
    await closePages(s.A, s.B);
  } catch (e) {
    r.error = (e && e.stack || String(e)).substring(0, 400);
  }
  await browser.close().catch(() => {});

  const bt = r.bt || {}, a = bt.a || {}, c = bt.c || {}, d = bt.d || {}, e = bt.e || {}, wf = r.wifi || {}, wa = wf.a || {}, wb = wf.b || {};
  r.ok = {
    a_abre_la_camara_del_telefono: pedidoOk(a.llamada, 2560) && !a.camara_nexo && a.ble_pausado === false,
    a_revision_antes_de_enviar: a.revision === true && a.miniaturas === 1 && a.ojos === 1,
    a_bluetooth_1280_75: a.lado_mayor === 1280 && okQ(a.calidad, 75) && a.una_vez === false && /^IMG_\d{8}_\d{6}\.jpg$/.test(a.nombre || ''),
    a_wifi_pide_3200_llega_1600_82: pedidoOk(wa.llamada, 3200) && wa.revision === true && wa.lado_mayor === 1600 && okQ(wa.calidad, 82),
    b_ver_una_vez: wb.revision === true && wb.ojos === 1 && typeof wb.llega_s === 'number' && wb.A_una_vez === true && wb.B_una_vez === 1,
    c_cancelar_camara_nexo_en_video: !!c.llamada && c.camara_nexo === true && c.modo === 'video' && c.vista_previa === true && c.revision === false && c.nada_enviado === true && c.ble_reanudado === true,
    d_sin_plugin_camara_nexo_en_foto: !d.llamada && d.camara_nexo === true && d.modo === 'foto' && d.revision === false,
    e_error_camara_nexo_en_foto: !!e.llamada && e.camara_nexo === true && e.modo === 'foto' && e.revision === false && e.nada_enviado === true,
  };
  r.errores = logs.filter((l) => /PAGEERROR|Uncaught/.test(l)).slice(0, 5);
  const ok = !r.error && Object.values(r.ok).every(Boolean) && !r.errores.length;
  fin(ok);
  process.exit(ok ? 0 : 1);
})().catch((e) => { fin(false, { error: e && e.stack }); process.exit(1); });
