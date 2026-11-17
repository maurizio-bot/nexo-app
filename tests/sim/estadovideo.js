// 3200 (dueño 17-11: Roberto no puede subir un video como estado; su captura: «Mi estado (24 h)» con el reproductor ROTO —icono de
// imagen rota sobre el play, 0:00— y el dueño lo repitió en su S24: un video de 5,2 MB publicado tal cual no se reproduce).
// Causa: la CSP de la app (index.html: media-src 'self' blob:) no deja cargar media desde «data:», y los estados ponían su video y su
// audio así en el <video>/<audio> (al elegirlo y en el visor de los contactos): error 4 «Media load rejected by URL safety check».
// Chromium real (Playwright) con la página construida, CSP incluida, a 360×800 (la pantalla de Roberto, 720×1600). R = Roberto publica,
// B = Ana (su contacto) los ve. Los videos se generan en la página (MediaRecorder, VP8) y los «rotos» son MP4 sin película (tipo video/mp4).
//  V1  video normal (≤ 5 MB; el archivo deja de poderse leer 1 s después de elegirlo): la vista previa SE VE (desde blob:), Publicar
//      lo publica tal cual
//  V8  video diminuto (va dentro del estado, sin archivo aparte): vista previa y publicar
//  V4  video que este teléfono NO puede abrir (≤ 5 MB): sin reproductor roto, portada genérica con el aviso, Publicar lo publica tal
//      cual (mismo tipo y tamaño) y el registro anota tipo, tamaño y el código del <video>
//  V7  audio grabado (micrófono simulado): la previa se puede reproducir y se publica
//  V3  un video que ya no se deja leer al elegirlo (NotReadableError; chico y grande): aviso claro (antes: nada o «No se pudo preparar»)
//  V5  video de más de 5 MB que no se puede abrir: aviso claro de qué hacer (máx. 5 MB) y al registro con su código; Publicar vacío
//      avisa (antes no hacía nada)
//  V2  video de más de 5 MB (se recodifica; el archivo deja de poderse leer 1 s después): Publicar mientras se prepara ESPERA (antes
//      salía solo el texto y el video se perdía); al terminar, la vista previa se ve y se publica con el texto
//  H   con ffmpeg (si está): un MP4 H.264 1080×1920 de ~5 MB (como el del dueño: S24, 5106 KB, tal cual) y uno HEVC: van tal cual,
//      sin reproductor roto. El Chromium de las pruebas no trae esos códecs: se ven o dicen claro que aquí no se pueden reproducir
//  VM  «verlo yo»: en «Mis estados», ▶ Ver reproduce mi video (normal, recodificado), mi audio; el que no se abre lo dice
//  VB  Ana ve TODOS los estados de Roberto, en orden: videos y audio se reproducen desde blob:, el que su teléfono no abre lo dice
//      (sin reproductor roto); el H.264/HEVC le llega entero
//  csp_rechazos = 0 («Refused to load media» en la consola)
// Contraprueba: en la 3199 (79c440d5) fallan V1, V8, VB, VM (error 4 por la CSP; sin ▶ Ver), V4 (reproductor roto), V7 (el audio
// grabado nunca se aceptaba: «;codecs=opus» en el tipo), V3 (sin aviso), V5 y V2.
// Uso: node estadovideo.js <dir_build> [dir_capturas]
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const HAS_FFMPEG = (() => { try { return spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0; } catch (e) { return false; } })();
if (!process.env.SHOTS_VIEWPORT) process.env.SHOTS_VIEWPORT = '360x800';
const { PW, bootPhone, sleep } = require('./pw_harness');
const { Radio, NativePhone } = require('./native_mock');
const { NostrRelay } = require('./nostr_relay');

const dist = path.resolve(process.argv[2], 'dist');
const shots = process.argv[3] ? path.resolve(process.argv[3]) : '';
const logs = [];
const r = { prueba: 'estadovideo', build: path.basename(process.argv[2]) };
const fin = (ok) => {
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('ESTADOVIDEO ' + JSON.stringify(r));
  try { fs.writeFileSync(path.join(__dirname, 'last_logs_estadovideo.txt'), logs.join('\n')); } catch (e) {}
};
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'estadovideo-'));
const MB = 1024 * 1024;

// MP4 que nadie puede abrir: cabecera «ftyp» y un «mdat» de bytes al azar, sin «moov»
function brokenMp4(file, size) {
  const head = Buffer.from([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 2, 0, 0x69, 0x73, 0x6f, 0x6d, 0x6d, 0x70, 0x34, 0x31]);
  const body = Buffer.alloc(size - head.length - 8);
  for (let i = 0; i < body.length; i++) body[i] = (i * 2654435761 >>> 13) & 255;
  const mdat = Buffer.alloc(8); mdat.writeUInt32BE(size - head.length, 0); mdat.write('mdat', 4);
  fs.writeFileSync(file, Buffer.concat([head, mdat, body]));
}
// el archivo cambia en el disco: Chromium ya no deja leer el File que se eligió antes (NotReadableError)
function spoil(file) { fs.appendFileSync(file, Buffer.alloc(16, 7)); const t = new Date(Date.now() + 5000); fs.utimesSync(file, t, t); }

(async () => {
  const browser = await PW.chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  // con internet (relés del simulador), como el S24 del dueño y el Motorola de Roberto: la media grande va UNA vez al buzón de archivos
  const relays = [new NostrRelay(), new NostrRelay({ authRequired: true })];
  const urls = []; for (const rl of relays) urls.push(await rl.start());
  const withRelays = { newPage: async (o) => { const p = await browser.newPage(o); await p.addInitScript((u) => { window.NEXO_NET_RELAYS = u; }, urls); return p; } };
  const radio = new Radio();
  const opts = { readsContentFallback: true, retain: ['onPayloadReceived'], closeOnNoService: true, pace: [5, 5], ioDelay: 10, asymmetric: true, noTor: true };
  const nR = new NativePhone('R', 'AA:AA:AA:AA:AA:01', opts), nB = new NativePhone('B', 'BB:BB:BB:BB:BB:02', opts);
  radio.add(nR); radio.add(nB); nR.load(); nB.load();
  const phR = await bootPhone(withRelays, 'R', nR, dist, { phone: true, logs, seedName: 'Roberto', lang: 'es' });
  const phB = await bootPhone(withRelays, 'B', nB, dist, { phone: true, logs, seedName: 'Ana', lang: 'es' });
  const R = phR.page, B = phB.page;
  await R.context().grantPermissions(['microphone'], { origin: 'https://r.nexo.test' });   // el micrófono simulado (audio del estado)
  const shot = async (pg, name) => { if (shots) { fs.mkdirSync(shots, { recursive: true }); await pg.screenshot({ path: path.join(shots, name) }); } };

  // ---- Videos de prueba (generados en la página: VP8 que Chromium sí abre) ----
  const genWebm = (o) => R.evaluate(async ({ w, h, secs, bps, noise }) => {
    const c = document.createElement('canvas'); c.width = w; c.height = h; const ctx = c.getContext('2d');
    const rec = new MediaRecorder(c.captureStream(24), { mimeType: 'video/webm;codecs=vp8', videoBitsPerSecond: bps });
    const parts = []; rec.ondataavailable = (e) => { if (e.data && e.data.size) parts.push(e.data); };
    const frames = noise ? Array.from({ length: 6 }, () => { const im = ctx.createImageData(w, h), d = im.data; for (let i = 0; i < d.length; i += 4) { const v = Math.random() * 255 | 0; d[i] = v; d[i + 1] = (v * 7) & 255; d[i + 2] = (v * 13) & 255; d[i + 3] = 255; } return im; }) : null;
    let n = 0;
    const draw = () => { if (noise) ctx.putImageData(frames[n % frames.length], 0, 0); else { ctx.fillStyle = 'hsl(' + (n * 12 % 360) + ',70%,45%)'; ctx.fillRect(0, 0, w, h); ctx.fillStyle = '#fff'; ctx.fillRect((n * 6) % w, h / 3, w / 5, h / 3); } n++; };
    draw(); const iv = setInterval(draw, 42); rec.start(250);
    await new Promise((res) => setTimeout(res, secs * 1000));
    clearInterval(iv); await new Promise((res) => { rec.onstop = res; rec.stop(); });
    const u8 = new Uint8Array(await new Blob(parts).arrayBuffer()); let s = '';
    for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    return btoa(s);
  }, o);
  const F = { normal: path.join(TMP, 'VID_normal.webm'), mini: path.join(TMP, 'mini.webm'), grande: path.join(TMP, 'VID_grande.webm'), roto: path.join(TMP, 'roto.mp4'), rotoGrande: path.join(TMP, 'VID_roto_grande.mp4'), noLee: path.join(TMP, 'no_se_lee.webm'), noLeeGrande: path.join(TMP, 'no_se_lee_grande.webm') };
  fs.writeFileSync(F.normal, Buffer.from(await genWebm({ w: 320, h: 240, secs: 2.5, bps: 400000, noise: true }), 'base64'));
  fs.writeFileSync(F.mini, Buffer.from(await genWebm({ w: 64, h: 48, secs: 0.8, bps: 30000 }), 'base64'));
  for (let i = 0; i < 3 && !(fs.existsSync(F.grande) && fs.statSync(F.grande).size > 5.3 * MB); i++) fs.writeFileSync(F.grande, Buffer.from(await genWebm({ w: 640, h: 360, secs: 6 + 2 * i, bps: 12000000, noise: true }), 'base64'));
  brokenMp4(F.roto, 120 * 1024); brokenMp4(F.rotoGrande, Math.round(5.6 * MB));
  fs.copyFileSync(F.normal, F.noLee); fs.copyFileSync(F.grande, F.noLeeGrande);
  if (HAS_FFMPEG) {
    const ff = (args) => spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y'].concat(args), { stdio: 'ignore' }).status === 0;
    const src = ['-f', 'lavfi', '-i', 'testsrc2=s=1080x1920:r=30', '-f', 'lavfi', '-i', 'sine=frequency=440', '-vf', 'noise=alls=30:allf=t'];
    F.h264 = path.join(TMP, '20261031_125824.mp4'); F.hevc = path.join(TMP, '20261031_130102.mp4');
    for (const kbps of [7600, 7000, 6200]) { // ≤ 5 MB (va tal cual, como el del dueño)
      ff(src.concat(['-t', '5', '-c:v', 'libx264', '-preset', 'veryfast', '-b:v', kbps + 'k', '-maxrate', kbps + 'k', '-bufsize', (kbps / 2) + 'k', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '96k', F.h264]));
      if (fs.existsSync(F.h264) && fs.statSync(F.h264).size <= 5 * MB) break;
    }
    if (!ff(src.concat(['-t', '4', '-c:v', 'libx265', '-preset', 'ultrafast', '-tag:v', 'hvc1', '-b:v', '3000k', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '96k', F.hevc]))) delete F.hevc;
    if (!(fs.existsSync(F.h264) && fs.statSync(F.h264).size <= 5 * MB && fs.statSync(F.h264).size > 3 * MB)) delete F.h264;
  }
  const SZ = Object.fromEntries(Object.entries(F).map(([k, f]) => [k, fs.statSync(f).size]));
  r.tam_kb = Object.fromEntries(Object.entries(SZ).map(([k, v]) => [k, Math.round(v / 1024)]));
  if (!(fs.statSync(F.grande).size > 5.3 * MB) || !(fs.statSync(F.mini).size < 17000) || !(fs.statSync(F.normal).size > 40000)) { r.error = 'no se pudieron generar los videos de prueba'; fin(false); process.exit(1); }

  // ---- Emparejar: Roberto agrega a Ana ----
  await R.evaluate(() => window.bleInterface.togglePanel());
  for (let i = 0; i < 100; i++) { await sleep(150); if (await R.evaluate(() => !!document.querySelector('#ble-new-device button'))) break; await R.evaluate(() => { if (!window.bleInterface.isScanning) { const b = document.getElementById('ble-scan-btn'); if (b) b.click(); } }); }
  await R.evaluate(() => { const b = document.querySelector('#ble-new-device button'); if (b) b.click(); }); await sleep(1800);
  await R.evaluate(() => { if (document.getElementById('ble-panel').classList.contains('active')) window.bleInterface.togglePanel(); });
  const idR = await R.evaluate(() => window.bleInterface.localNexoId.toLowerCase());
  for (let i = 0; i < 60; i++) { if (await B.evaluate(() => !!document.querySelector('#main-contacts-list .ble-contact-row'))) break; await sleep(250); }
  await sleep(1500);
  r.emparejados = await R.evaluate(() => !!document.querySelector('#main-contacts-list .ble-contact-row')) && await B.evaluate(() => !!document.querySelector('#main-contacts-list .ble-contact-row'));

  // ---- Ayudas de la ventana «Mi estado» ----
  const VIN = '#estado-overlay input[type=file][accept="video/*"]';
  const compose = async () => { await R.evaluate(() => { const o = document.getElementById('estado-overlay'); if (o) o.remove(); window.NEXO_composeStatus(); }); await sleep(400); };
  const mark = () => logs.length;
  const since = (m, re) => logs.slice(m).filter((l) => /^\S+ \[R\]/.test(l) && re.test(l));
  const toastSince = async (re, ms) => { for (let i = 0; i < ms / 100; i++) { const t = await R.evaluate(() => (document.getElementById('nexo-est-toast') || {}).textContent || ''); if (re.test(t)) return t; await sleep(100); } return ''; };
  const busy = () => R.evaluate(() => { const b = document.getElementById('estado-video-btn'); return !!(b && b.disabled); });
  const waitIdle = async (ms) => { for (let i = 0; i < ms / 200; i++) { if (!(await busy())) return true; await sleep(200); } return false; };
  // cómo quedó la previa del video: se ve (metadatos, sin error), rota (error y a la vista) o portada
  const prevState = () => R.evaluate(() => {
    const v = document.querySelector('#estado-overlay video'), c = document.getElementById('estado-video-portada');
    const vis = (el) => !!el && getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().height > 0;
    return { video_a_la_vista: vis(v), src: v ? (v.getAttribute('src') || '').substring(0, 5) : '', error: v && v.error ? v.error.code : null, listo: v ? v.readyState : -1, ancho: v ? v.videoWidth : 0,
      portada: vis(c), portada_texto: c ? c.textContent : '' };
  });
  const waitPrev = async (ms) => { let s = null; for (let i = 0; i < ms / 200; i++) { s = await prevState(); if ((s.video_a_la_vista && (s.listo >= 1 || s.error)) || s.portada) break; await sleep(200); } await sleep(300); return prevState(); };
  const seVe = (s) => !!s && s.video_a_la_vista && s.src === 'blob:' && !s.error && s.listo >= 1 && s.ancho > 0;
  const publish = async () => { await R.evaluate(() => { const b = document.getElementById('estado-publicar'); if (b) b.click(); }); await sleep(700); };
  const mine = () => R.evaluate(() => (window.NEXO_myStatuses() || []).map((x) => ({ t: x.t, k: x.big ? x.big.k : (x.vid ? 'vid' : x.aud ? 'aud' : x.img ? 'img' : ''), mime: x.big ? x.big.mime : (x.vmime || x.amime || ''), size: x.big ? x.big.size : 0, inline: !x.big && !!(x.vid || x.aud) })));
  const overlayOpen = () => R.evaluate(() => !!document.getElementById('estado-overlay'));
  const pickHelper = async (file) => { // un File de verdad (del disco), elegido aparte para estropearlo antes de dárselo a la app
    await R.evaluate(() => { let h = document.getElementById('t-pick'); if (!h) { h = document.createElement('input'); h.type = 'file'; h.id = 't-pick'; h.style.display = 'none'; document.body.appendChild(h); } });
    await R.setInputFiles('#t-pick', file);
  };
  const giveHelperToApp = () => R.evaluate((sel) => { const vin = document.querySelector(sel), h = document.getElementById('t-pick'); Object.defineProperty(vin, 'files', { configurable: true, value: h.files }); vin.dispatchEvent(new Event('change')); }, VIN);

  // V1: video normal; deja de poderse leer 1 s después de elegirlo
  await compose();
  let m0 = mark();
  await R.setInputFiles(VIN, F.normal);
  await sleep(1000); spoil(F.normal);
  let s1 = await waitPrev(8000);
  r.V1_previa = s1;
  r.V1_vista_previa_se_ve = seVe(s1);
  r.V1_registro = since(m0, /\[VIDEO\] Estado: video elegido/).length > 0;
  await shot(R, 'V1_previa.png');
  await publish();
  let my = await mine();
  r.V1_publicado = !(await overlayOpen()) && my.length === 1 && my[0].k === 'vid' && !my[0].inline && my[0].mime === 'video/webm' && my[0].size === SZ.normal;

  // V8: video diminuto (va dentro del estado)
  await compose();
  await R.setInputFiles(VIN, F.mini);
  const s8 = await waitPrev(8000);
  r.V8_vista_previa_se_ve = seVe(s8);
  await publish();
  my = await mine();
  const last = (l) => l[l.length - 1] || {};
  let nPub = my.length;
  r.V8_publicado_en_linea = nPub === 2 && last(my).k === 'vid' && last(my).inline;

  // V4: video que este teléfono no puede abrir (≤ 5 MB)
  await compose();
  m0 = mark();
  await R.setInputFiles(VIN, F.roto);
  const s4 = await waitPrev(8000);
  r.V4_previa = s4;
  r.V4_sin_reproductor_roto = !s4.video_a_la_vista;
  r.V4_portada = s4.portada && /roto\.mp4 · 120 KB/.test(s4.portada_texto) && /no puede mostrar este video aquí, pero se publicará tal cual/.test(s4.portada_texto);
  const reg4 = since(m0, /\[VIDEO\] Estado: este teléfono no puede abrir el video elegido/);
  r.V4_registro = reg4.length > 0 && /video\/mp4, 120 KB/.test(reg4[0]) && /código 4/.test(reg4[0]);
  r.V4_registro_linea = (reg4[0] || '').replace(/^\S+ \[R\] /, '').substring(0, 200);
  await shot(R, 'V4_portada.png');
  await publish();
  my = await mine();
  r.V4_publicado_tal_cual = !(await overlayOpen()) && my.length === nPub + 1 && last(my).k === 'vid' && last(my).mime === 'video/mp4' && last(my).size === 120 * 1024;
  nPub = my.length;

  // V7: audio grabado (micrófono simulado)
  await compose();
  await R.evaluate(() => document.getElementById('estado-audio-btn').click()); await sleep(1600);
  await R.evaluate(() => document.getElementById('estado-audio-btn').click());
  let s7 = null;
  for (let i = 0; i < 40; i++) { s7 = await R.evaluate(() => { const a = document.querySelector('#estado-overlay audio'); return a ? { vis: getComputedStyle(a).display !== 'none', src: (a.getAttribute('src') || '').substring(0, 5), error: a.error ? a.error.code : null, listo: a.readyState } : null; }); if (s7 && s7.vis && (s7.listo >= 1 || s7.error)) break; await sleep(200); }
  r.V7_previa = s7;
  r.V7_audio_se_puede_oir = !!s7 && s7.vis && s7.src === 'blob:' && !s7.error && s7.listo >= 1;
  await publish();
  my = await mine();
  r.V7_publicado = my.length === nPub + 1 && last(my).k === 'aud';
  nPub = my.length;

  // V3: un video que ya no se deja leer al elegirlo (chico y grande): aviso claro
  await compose();
  m0 = mark();
  await pickHelper(F.noLee); spoil(F.noLee); await giveHelperToApp();
  r.V3_aviso = await toastSince(/No se pudo leer el video: vuelve a elegirlo/, 4000);
  r.V3_registro = since(m0, /\[VIDEO\] Estado: no se pudo leer el video elegido .*NotReadableError/).length > 0;
  r.V3_boton_libre = !(await busy());
  await sleep(3200);
  m0 = mark();
  await pickHelper(F.noLeeGrande); spoil(F.noLeeGrande); await giveHelperToApp();
  r.V3_grande_aviso = await toastSince(/No se pudo leer el video: vuelve a elegirlo/, 20000);
  await waitIdle(30000);

  // V5: más de 5 MB y no se puede abrir
  await compose();
  m0 = mark();
  await R.setInputFiles(VIN, F.rotoGrande);
  r.V5_aviso = await toastSince(/Este video no se puede preparar en tu teléfono: elige uno más corto o más ligero \(máx\. 5 MB\)/, 20000);
  await waitIdle(20000);
  const reg5 = since(m0, /\[VIDEO\] Estado: no se pudo preparar el video elegido/);
  r.V5_registro = reg5.length > 0 && /video\/mp4, 5734 KB/.test(reg5[0]) && /código 4/.test(reg5[0]);
  r.V5_registro_linea = (reg5[0] || '').replace(/^\S+ \[R\] /, '').substring(0, 220);
  const s5 = await prevState();
  r.V5_sin_reproductor_roto = !s5.video_a_la_vista && !s5.portada;
  await sleep(3200);
  await publish();
  r.V5_publicar_vacio_avisa = await toastSince(/Escribe algo o elige una foto, un audio o un video/, 2000);
  my = await mine();
  r.V5_nada_publicado = (await overlayOpen()) && my.length === nPub;

  // V2: más de 5 MB (se recodifica); deja de poderse leer 1 s después; Publicar mientras se prepara espera
  await compose();
  await R.evaluate(() => { const ta = document.getElementById('estado-input'); ta.value = 'con texto'; });
  m0 = mark();
  await R.setInputFiles(VIN, F.grande);
  await sleep(1000); spoil(F.grande);
  r.V2_preparando = await busy();
  await publish();
  r.V2_espera_aviso = await toastSince(/Espera: el video aún se está preparando/, 1500);
  my = await mine();
  r.V2_no_sale_solo_el_texto = (await overlayOpen()) && my.length === nPub;
  await waitIdle(60000);
  const s2 = await waitPrev(8000);
  r.V2_previa = s2;
  r.V2_vista_previa_se_ve = seVe(s2);
  r.V2_recodificado = since(m0, /\[ESTADO\] Video de \d+ KB → 720p de \d+ KB|\[VIDEO\] Previa \d+x\d+/).length > 0;
  await shot(R, 'V2_previa.png');
  await publish();
  my = await mine();
  r.V2_publicado_con_texto = !(await overlayOpen()) && my.length === nPub + 1 && last(my).t === 'con texto' && last(my).k === 'vid' && last(my).size > 0 && last(my).size <= 5 * MB;
  nPub = my.length;

  // H.264 y HEVC de teléfono (con ffmpeg, si está): 1080×1920, el H.264 de ~5 MB como el del dueño (S24, 5106 KB, tal cual). El
  // Chromium de las pruebas no trae esos códecs: aquí se comprueba el camino (tal cual, sin reproductor roto, le llega a Ana entero,
  // URL blob:, sin rechazos de la CSP) y que se vea o diga claro que no se puede; en el teléfono (WebView con H.264) se reproduce.
  const phoneCases = [];
  if (HAS_FFMPEG) {
    for (const pc of [{ k: 'h264', f: F.h264 }, { k: 'hevc', f: F.hevc }]) {
      if (!pc.f || !fs.existsSync(pc.f)) continue;
      await compose();
      await R.setInputFiles(VIN, pc.f);
      const sp = await waitPrev(10000);
      r[pc.k + '_previa'] = sp;
      r[pc.k + '_sin_reproductor_roto'] = seVe(sp) || (sp.portada && !sp.video_a_la_vista);
      await publish();
      my = await mine();
      r[pc.k + '_publicado_tal_cual'] = !(await overlayOpen()) && my.length === nPub + 1 && last(my).k === 'vid' && last(my).mime === 'video/mp4' && last(my).size === SZ[pc.k];
      nPub = my.length;
      phoneCases.push(pc.k);
    }
  } else r.h264 = 'sin ffmpeg: no se probó';

  // ---- VM: «verlo yo» (Mis estados → ▶ Ver) ----
  const sids = await R.evaluate(() => (window.NEXO_myStatuses() || []).map((x) => x.sid));
  await R.evaluate(() => { const o = document.getElementById('estado-overlay'); if (o) o.remove(); if (typeof window.NEXO_openMyStatuses === 'function') window.NEXO_openMyStatuses(); }); await sleep(500);
  const myCard = async (sid, ms) => {
    await R.evaluate((id) => { const b = document.querySelector('.estado-mio[data-sid="' + id + '"] .estado-ver'); if (b) b.click(); }, sid);
    let st = null;
    for (let i = 0; i < ms / 200; i++) {
      st = await R.evaluate((id) => { const c = document.querySelector('.estado-mio[data-sid="' + id + '"]'); if (!c) return null; const m = c.querySelector('.estado-mio-media'), note = c.querySelector('.estado-no-se-ve');
        return { tag: m ? m.tagName.toLowerCase() : '', vis: !!m && getComputedStyle(m).display !== 'none', src: m ? (m.getAttribute('src') || '').substring(0, 5) : '', error: m && m.error ? m.error.code : null, listo: m ? m.readyState : -1, aviso: note ? note.textContent : '' }; }, sid);
      if (st && (st.aviso || (st.vis && (st.listo >= 1 || st.error)))) break;
      await sleep(200);
    }
    return st;
  };
  const okMedia = (s, tag) => !!s && s.tag === tag && s.vis && s.src === 'blob:' && !s.error && s.listo >= 1 && !s.aviso;
  const noteOk = (s, re) => !!s && !s.vis && re.test(s.aviso);
  const playOrNote = (s) => okMedia(s, 'video') || noteOk(s, /no puede reproducir este video/);
  const vm1 = await myCard(sids[0], 8000); r.VM_normal = vm1; r.VM_normal_se_ve = okMedia(vm1, 'video');
  const vm7 = await myCard(sids[3], 8000); r.VM_audio_se_puede_oir = okMedia(vm7, 'audio');
  const vm4 = await myCard(sids[2], 8000); r.VM_roto_avisa = noteOk(vm4, /Tu teléfono no puede reproducir este video/);
  const vm2 = await myCard(sids[4], 8000); r.VM_recodificado_se_ve = okMedia(vm2, 'video');
  for (let i = 0; i < phoneCases.length; i++) { const sm = await myCard(sids[5 + i], 8000); r['VM_' + phoneCases[i]] = sm; r['VM_' + phoneCases[i] + '_ok'] = playOrNote(sm); }
  await shot(R, 'VM_mis_estados.png');
  await R.evaluate(() => { const o = document.getElementById('estado-overlay'); if (o) o.remove(); });

  // ---- VB: Ana ve los estados de Roberto (todos, en orden) ----
  let n = 0;
  for (let i = 0; i < 480 && n < sids.length; i++) { n = await B.evaluate((id) => (window.NEXO_statusesOf(id) || []).length, idR); if (n < sids.length) await sleep(250); }
  r.VB_le_llegan = n + '/' + sids.length;
  const touch = (type, x, y) => phB.cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
  const swipe = async (x0, y0, x1, y1, ms) => { const k = Math.max(3, Math.round(ms / 16)); await touch('touchStart', x0, y0); for (let i = 1; i <= k; i++) { await sleep(ms / k); await touch('touchMove', x0 + (x1 - x0) * i / k, y0 + (y1 - y0) * i / k); } await touch('touchEnd'); };
  await swipe(270, 420, 60, 420, 200); await sleep(700);
  await B.evaluate((id) => { const b = document.querySelector('#estados-screen .estado-chip[data-nx="' + id + '"]'); if (b) b.click(); }, idR);
  await sleep(600);
  const viewState = () => B.evaluate(() => {
    const v = document.getElementById('estado-view'); if (!v) return null;
    const m = v.querySelector('video, audio'), note = v.querySelector('.estado-no-se-ve');
    return { pos: (document.getElementById('estado-pos') || {}).textContent || '', cargando: !!document.getElementById('estado-cargando'), tag: m ? m.tagName.toLowerCase() : '',
      vis: !!m && getComputedStyle(m).display !== 'none', src: m ? (m.getAttribute('src') || '').substring(0, 5) : '', error: m && m.error ? m.error.code : null, listo: m ? m.readyState : -1, aviso: note ? note.textContent : '' };
  });
  const waitView = async (ms) => { let s = null; for (let i = 0; i < ms / 250; i++) { s = await viewState(); if (s && !s.cargando && (s.aviso || (s.vis && (s.listo >= 1 || s.error)))) break; await sleep(250); } await sleep(300); return viewState(); };
  const next = () => B.evaluate(() => { const b = document.getElementById('estado-next'); if (b) b.click(); });
  const plan = [['normal', (s) => okMedia(s, 'video')], ['diminuto', (s) => okMedia(s, 'video')], ['roto', (s) => noteOk(s, /Tu teléfono no puede reproducir este video/)],
    ['audio', (s) => okMedia(s, 'audio')], ['recodificado', (s) => okMedia(s, 'video')]].concat(phoneCases.map((k) => [k, playOrNote]));
  r.VB_ok = {};
  for (let i = 0; i < plan.length; i++) {
    if (i) await next();
    const t0 = Date.now(), sv = await waitView(240000);
    r['VB_' + plan[i][0]] = Object.assign({ s: Math.round((Date.now() - t0) / 1000) }, sv || {});
    r.VB_ok[plan[i][0]] = plan[i][1](sv) && !!sv && sv.pos === (i + 1) + '/' + sids.length;
    if (i === 0 || plan[i][0] === 'roto' || plan[i][0] === 'h264') await shot(B, 'VB_' + plan[i][0] + '.png');
  }
  r.VB_todos = Object.values(r.VB_ok).every(Boolean) && Object.keys(r.VB_ok).length === sids.length;
  r.buzon_subidas = since(0, /media subida una vez al buzón de archivos/).length;

  r.csp_rechazos = logs.filter((l) => /Refused to load media/.test(l)).length;
  r.errores = logs.filter((l) => /PAGEERROR/.test(l)).slice(0, 5);
  const phoneOk = phoneCases.every((k) => r[k + '_sin_reproductor_roto'] && r[k + '_publicado_tal_cual'] && r['VM_' + k + '_ok']);
  const ok = r.emparejados && r.V1_vista_previa_se_ve && r.V1_registro && r.V1_publicado && r.V8_vista_previa_se_ve && r.V8_publicado_en_linea &&
    r.V4_sin_reproductor_roto && r.V4_portada && r.V4_registro && r.V4_publicado_tal_cual && r.V7_audio_se_puede_oir && r.V7_publicado &&
    !!r.V3_aviso && r.V3_registro && r.V3_boton_libre && !!r.V3_grande_aviso && !!r.V5_aviso && r.V5_registro && r.V5_sin_reproductor_roto && !!r.V5_publicar_vacio_avisa && r.V5_nada_publicado &&
    r.V2_preparando && !!r.V2_espera_aviso && r.V2_no_sale_solo_el_texto && r.V2_vista_previa_se_ve && r.V2_recodificado && r.V2_publicado_con_texto &&
    r.VM_normal_se_ve && r.VM_audio_se_puede_oir && r.VM_roto_avisa && r.VM_recodificado_se_ve && phoneOk && r.VB_todos && r.csp_rechazos === 0 && !r.errores.length;
  fin(ok);
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) {}
  for (const rl of relays) { try { await rl.stop(); } catch (e) {} }
  await browser.close();
  process.exit(ok ? 0 : 1);
})().catch((e) => { r.error = String(e && e.message); console.error(e); fin(false); try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (x) {} process.exit(1); });
