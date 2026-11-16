// 3159 (dueño 16-11): el visor a pantalla completa se DESLIZA entre las fotos y vídeos del chat y se CIERRA deslizando hacia arriba.
//  «cuando manden varias fotos seguido, al abrir la primera se desliza de derecha a izquierda y se debe ver la que sigue» y
//  «para salir de las fotos y regresar al chat con deslizar hacia arriba, ya quita la x».
// Chromium real (gestos táctiles de verdad por CDP), un teléfono A con un chat con B: foto 1 (propia), foto 2 (recibida), una «ver
// una vez» (recibida), foto 3 (propia) y un vídeo (propio). Las fotos se abren con la app reiniciada, así que las burbujas tienen
// solo la MINIATURA: el visor tiene que enseñar el ORIGINAL (la misma lectura que hace el toque en la burbuja).
// Y (dueño 16-11) el botón de guardar abajo a la derecha: en un vídeo por encima de la barra del reproductor; tocarlo guarda la que se
// ve y un gesto que empieza sobre él no cierra ni cambia de foto.
// Comprueba: abrir la 1.ª → «1 / 4» y sin X; ← pasa a la 2.ª (original, «2 / 4») y «guardar» guarda la que se ve; ← la 3.ª (la «ver una
// vez» no entra ni se consume); ← el vídeo; ← en la última no hace nada; → vuelve a la 3.ª y el vídeo que se deja queda liberado; un
// gesto corto y lento no cambia; un tirón corto y rápido sí; con zoom 2,5× (doble toque) un arrastre de lado mueve la foto y no cambia
// de foto, ni uno vertical cierra; vertical corto no cierra; ↑ cierra; ↓ también; el «atrás» de Android cierra; en el vídeo, el gesto
// que empieza en la barra del reproductor no cierra y uno sobre la imagen sí; la «ver una vez» no se desliza y ↑ la cierra.
// Uso: node visorfotos.js <dir_build>
'use strict';
const fs = require('fs');
const path = require('path');
const { PW, bootPhone, sleep } = require('./pw_harness');
const { Radio, NativePhone } = require('./native_mock');

const dist = path.resolve(process.argv[2], 'dist');
const logs = [];
const r = { prueba: 'visorfotos', build: path.basename(process.argv[2]) };
const fin = (ok, extra) => {
  Object.assign(r, extra || {});
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('VISORFOTOS ' + JSON.stringify(r));
  try { fs.writeFileSync(path.join(__dirname, 'last_logs_visorfotos.txt'), logs.join('\n')); } catch (e) {}
};

(async () => {
  const browser = await PW.chromium.launch();
  const radio = new Radio();
  const opts = { readsContentFallback: true, retain: ['onPayloadReceived'], closeOnNoService: true, pace: [5, 5], ioDelay: 10, asymmetric: true, noTor: true };
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', opts), nB = new NativePhone('B', 'BB:BB:BB:BB:BB:02', opts);
  radio.add(nA); radio.add(nB); nA.load(); nB.load();
  const phA = await bootPhone(browser, 'A', nA, dist, { phone: true, logs, seedName: 'Ana', lang: 'es' });
  const phB = await bootPhone(browser, 'B', nB, dist, { phone: true, logs, seedName: 'Beto', lang: 'es' });
  const A = phA.page, cdp = phA.cdp;
  const click = (p, sel) => p.evaluate((s) => { const e = document.querySelector(s); if (e) e.click(); return !!e; }, sel);

  // Emparejar A con B por Bluetooth (como chatthumbs) para tener un chat
  await A.evaluate(() => window.bleInterface.togglePanel());
  for (let i = 0; i < 100; i++) { await sleep(150); if (await A.evaluate(() => !!document.querySelector('#ble-new-device button'))) break; await A.evaluate(() => { if (!window.bleInterface.isScanning) { const b = document.getElementById('ble-scan-btn'); if (b) b.click(); } }); }
  await click(A, '#ble-new-device button'); await sleep(1800);
  await A.evaluate(() => { if (document.getElementById('ble-panel').classList.contains('active')) window.bleInterface.togglePanel(); });
  const idB = await phB.page.evaluate(() => window.bleInterface.localNexoId.toLowerCase());

  // Historial: foto 1 (mía), foto 2 (de B), «ver una vez» (de B), foto 3 (mía), vídeo (mío). Fotos de 1200x900 de colores distintos.
  const media = await A.evaluate(async (idB) => {
    const photo = (k) => {
      const c = document.createElement('canvas'); c.width = 1200; c.height = 900; const g = c.getContext('2d');
      g.fillStyle = ['#c33', '#3a3', '#33c', '#cc3'][k]; g.fillRect(0, 0, 1200, 900);
      g.fillStyle = '#fff'; g.font = 'bold 300px sans-serif'; g.fillText(String(k + 1), 480, 560);
      for (let i = 0; i < 400; i++) { g.fillStyle = 'rgba(' + ((i * 37) & 255) + ',' + ((i * 91) & 255) + ',' + ((i * 13) & 255) + ',0.5)'; g.fillRect((i * 53) % 1200, (i * 29) % 900, 40, 30); }
      return c.toDataURL('image/jpeg', 0.9).split(',')[1];
    };
    const now = Date.now(), out = { photos: [], ids: [] };
    const add = async (k, m) => { const id = 'vf' + k + 'x' + now; out.ids.push(id); await window.vaultAppendMessage(idB, Object.assign({ msgId: id, messageId: id, content: '[adjunto]', timestamp: now - (10 - k) * 60000, seq: k + 1 }, m), true); return id; };
    const own = { _own: true, status: 'delivered' }, theirs = { _own: false, senderNexoId: idB, from: idB, status: 'read' };
    const p1 = photo(0), p2 = photo(1), p3 = photo(2), once = photo(3);
    out.photos = [p1, p2, p3]; out.once = once;
    await add(0, Object.assign({ attachmentType: 'image', attachmentPayload: p1, attachmentMeta: { format: 'jpeg', size: p1.length } }, own));
    await add(1, Object.assign({ attachmentType: 'image', attachmentPayload: p2, attachmentMeta: { format: 'jpeg', size: p2.length } }, theirs));
    out.onceId = await add(2, Object.assign({ attachmentType: 'image', attachmentPayload: once, attachmentMeta: { format: 'jpeg', once: true } }, theirs));
    await add(3, Object.assign({ attachmentType: 'image', attachmentPayload: p3, attachmentMeta: { format: 'jpeg', size: p3.length } }, own));
    // Un vídeo DE VERDAD (webm grabado de un lienzo): con uno roto, Chromium pone su capa de error y esa se queda con los toques
    const vc = document.createElement('canvas'); vc.width = 320; vc.height = 240; const vg = vc.getContext('2d');
    const rec = new MediaRecorder(vc.captureStream(15), { mimeType: 'video/webm' }), parts = [];
    rec.ondataavailable = (e) => parts.push(e.data);
    let fr = 0; const iv = setInterval(() => { vg.fillStyle = fr++ % 2 ? '#a3a' : '#3aa'; vg.fillRect(0, 0, 320, 240); }, 60);
    rec.start(); await new Promise((res) => setTimeout(res, 1500)); rec.stop(); clearInterval(iv);
    await new Promise((res) => { rec.onstop = res; });
    const bytes = new Uint8Array(await new Blob(parts).arrayBuffer());
    let bin = ''; for (let i = 0; i < bytes.length; i += 8192) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
    const tc = document.createElement('canvas'); tc.width = 160; tc.height = 120; const tg = tc.getContext('2d'); tg.fillStyle = '#636'; tg.fillRect(0, 0, 160, 120);
    await add(4, Object.assign({ attachmentType: 'video', attachmentPayload: btoa(bin), attachmentMeta: { format: 'webm', mime: 'video/webm', thumb: tc.toDataURL('image/jpeg', 0.7).split(',')[1], size: bytes.length } }, own));
    return out;
  }, idB);
  const fullSrc = (k) => 'data:image/jpeg;base64,' + media.photos[k];
  const openChat = async () => { await A.evaluate(() => window.dispatchEvent(new CustomEvent('nexo:ble:closeChat', { detail: {} }))); await sleep(400); await click(A, '#main-contacts-list .ble-contact-row'); };
  // 1.ª apertura: se crean las miniaturas; luego «reiniciar la app» para que las burbujas tengan solo la miniatura (como en el teléfono)
  await openChat(A);
  for (let i = 0; i < 40; i++) { if (Array.from(nA.files.keys()).filter((f) => /^nexo_thumb_/.test(f)).length >= 3) break; await sleep(400); }
  await A.reload();
  await A.waitForFunction(() => window.NEXO && window.NEXO.initialized, null, { timeout: 60000 });
  await sleep(1200);
  await A.evaluate(() => {
    window.__saved = [];
    window.Capacitor.Plugins.NexoBLE.saveToGallery = async (o) => { window.__saved.push(o); return { saved: true }; };
  });
  await openChat(A);
  await A.waitForFunction(() => document.querySelectorAll('#messages-container .msg-content img:not(.video-thumb)').length >= 3 && !!document.querySelector('#messages-container .video-attachment'), null, { timeout: 15000 }).catch(() => {});
  await sleep(800);
  r.burbujas = await A.evaluate(() => ({
    fotos: document.querySelectorAll('#messages-container .msg-content img:not(.video-thumb)').length,
    con_miniatura: Array.from(document.querySelectorAll('#messages-container .msg-content img:not(.video-thumb)')).filter((i) => !!i.dataset.fullRef).length,
    videos: document.querySelectorAll('#messages-container .video-attachment').length,
    una_vez: document.querySelectorAll('#messages-container .msg-once-tap').length,
  }));
  r.preparado = r.burbujas.fotos === 3 && r.burbujas.con_miniatura === 3 && r.burbujas.videos === 1 && r.burbujas.una_vez === 1;

  // --- utilidades del visor y de los gestos (toques reales por CDP) ---
  const state = () => A.evaluate(() => {
    const ov = document.getElementById('fullscreen-media-overlay');
    if (!ov) return { abierto: false, img: '', vid: '', contador: '', slides: 0, transform: '', botones: [] };
    const slides = ov.querySelectorAll('.fs-slide');
    const cur = slides.length ? slides[slides.length - 1] : ov;
    const img = cur.querySelector('img:not(.fs-preview)'), vid = cur.querySelector('video');
    const c = ov.querySelector('.fs-counter');
    return { abierto: true, img: img ? img.src : '', vid: vid ? (vid.src || '') : '', contador: c ? c.textContent : '', slides: slides.length, transform: img ? img.style.transform : '', botones: Array.from(ov.querySelectorAll('button')).map((b) => (b.classList.contains('fs-save-btn') ? 'guardar' : 'otro')) };
  });
  const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
  // Gesto de un dedo de (x0,y0) a (x1,y1) en `ms` (pasos de ~16 ms)
  const swipe = async (x0, y0, x1, y1, ms) => {
    const n = Math.max(3, Math.round(ms / 16));
    await touch('touchStart', x0, y0);
    for (let i = 1; i <= n; i++) { await sleep(ms / n); await touch('touchMove', x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n); }
    await touch('touchEnd');
  };
  const W = 393, H = 851, cy = 425;
  const left = async () => { await swipe(330, cy, 60, cy, 160); await sleep(700); };    // de derecha a izquierda → la siguiente
  const right = async () => { await swipe(60, cy, 330, cy, 160); await sleep(700); };   // de izquierda a derecha → la anterior
  const dtap = async (x, y) => { await touch('touchStart', x, y); await touch('touchEnd'); await sleep(90); await touch('touchStart', x, y); await touch('touchEnd'); await sleep(350); };
  const tapBubble = async (sel, idx) => { await A.evaluate(([s, i]) => { const e = document.querySelectorAll(s)[i]; if (e) e.click(); }, [sel, idx]); await sleep(900); };
  const PHOTO = '#messages-container .msg-content img:not(.video-thumb)';
  // Botón de guardar (dueño 16-11: «a la esquina baja a la derecha por una cuestión ergonómica»): dónde está y el del vídeo
  const btnRect = () => A.evaluate(() => {
    const b = document.querySelector('#fullscreen-media-overlay .fs-save-btn'); if (!b) return null;
    const q = b.getBoundingClientRect(), v = document.querySelector('#fullscreen-media-overlay video'), w = v && v.getBoundingClientRect();
    return { x: q.left + q.width / 2, y: q.top + q.height / 2, top: q.top, left: q.left, right: q.right, bottom: q.bottom, W: window.innerWidth, H: window.innerHeight, vid: w ? { top: w.top, left: w.left, right: w.right, bottom: w.bottom } : null };
  });
  const enEsquina = (b) => !!b && b.W - b.right >= 12 && b.W - b.right <= 30 && b.left > b.W / 2;
  const tapAt = async (x, y) => { await touch('touchStart', x, y); await sleep(40); await touch('touchEnd'); await sleep(500); };
  const NOB = { x: 196, y: 800 };   // si el visor se cerró por error (prueba fallida), los gestos «sobre el botón» van a un punto cualquiera
  const savedN = () => A.evaluate(() => window.__saved.length);

  // 1) Abrir la 1.ª: el original, «1 / 4», sin X (solo el botón de guardar)
  await tapBubble(PHOTO, 0);
  let s = await state();
  r.abre_1 = s.abierto && s.img === fullSrc(0);
  r.contador_1 = s.contador;
  r.sin_x = s.abierto && s.botones.length === 1 && s.botones[0] === 'guardar';
  let b = await btnRect();
  r.boton_foto = b && { derecha: Math.round(b.W - b.right), abajo: Math.round(b.H - b.bottom) };
  r.boton_abajo_derecha_foto = enEsquina(b) && b.H - b.bottom >= 12 && b.H - b.bottom <= 30;
  // 2) ← la 2.ª (recibida): el ORIGINAL, «2 / 4»; «guardar» guarda la que se ve
  await left(); s = await state();
  r.pasa_a_2 = s.img === fullSrc(1);
  r.contador_2 = s.contador;
  r.un_solo_slide = s.slides === 1;
  // tocar el botón (toque real) guarda la que se ve y no cambia de foto; un gesto que empieza sobre el botón no cierra ni cambia
  b = (await btnRect()) || NOB;
  await tapAt(b.x, b.y); s = await state();
  r.guarda_la_que_se_ve = await A.evaluate((b64) => window.__saved.length === 1 && window.__saved[0].base64 === b64, media.photos[1]);
  r.tocar_boton_no_cambia = s.abierto && s.img === fullSrc(1) && s.contador === '2 / 4';
  await swipe(b.x, b.y, b.x, b.y - 450, 200); await sleep(600); s = await state();
  r.boton_vertical_no_cierra = s.abierto && s.img === fullSrc(1);
  await swipe(b.x, b.y, b.x - 300, b.y, 200); await sleep(600); s = await state();
  r.boton_lateral_no_cambia = s.abierto && s.img === fullSrc(1) && s.contador === '2 / 4' && (await savedN()) === 1;
  // 3) ← la 3.ª: la «ver una vez» no entra en el recorrido ni se consume
  await left(); s = await state();
  r.pasa_a_3 = s.img === fullSrc(2);
  r.contador_3 = s.contador;
  r.guardar_nuevo_en_3 = s.botones.length === 1 && (await A.evaluate(() => { const x = document.querySelector('#fullscreen-media-overlay .fs-save-btn'); return x && x.getAttribute('data-state'); })) === 'idle';
  // 4) ← el vídeo (se lee al pedirlo, como al tocar su burbuja)
  await left(); await sleep(400); s = await state();
  const vidBubbleSrc = await A.evaluate(() => (document.querySelector('#messages-container .video-attachment') || { dataset: {} }).dataset.src || '');
  r.pasa_al_video = /^blob:/.test(s.vid) && s.vid === vidBubbleSrc;
  r.contador_4 = s.contador;
  // En el vídeo, el botón sigue abajo a la derecha pero POR ENCIMA de la barra del reproductor (también la de un vídeo vertical
  // que ocupe todo el alto: su borde de abajo queda a 7,5vh del de la pantalla y la barra mide ~48 px), y tocarlo guarda el vídeo
  b = await btnRect();
  r.boton_video = b && { derecha: Math.round(b.W - b.right), abajo: Math.round(b.H - b.bottom) };
  r.boton_video_sobre_la_barra = enEsquina(b) && b.H - b.bottom >= 0.075 * b.H + 48 && !!b.vid &&
    (b.bottom <= b.vid.bottom - 48 || b.top >= b.vid.bottom || b.right <= b.vid.left || b.left >= b.vid.right);
  b = b || NOB;
  await tapAt(b.x, b.y); await sleep(400); s = await state();
  // el toque llega al botón (arranca el guardado) sin cambiar ni cerrar. (Aparte, previo a 3159 y también en la 3158: que el nativo
  // reciba el vídeo depende de la CSP de index.html, cuyo connect-src no deja leer la URL blob: del vídeo; se anota como dato.)
  r.tocar_boton_video_guarda = !!(await A.evaluate(() => { const x = document.querySelector('#fullscreen-media-overlay .fs-save-btn'); return x && x.getAttribute('data-state') !== 'idle'; })) && s.abierto && /^blob:/.test(s.vid) && s.contador === '4 / 4';
  // 3162: el vídeo LLEGA al nativo (antes la CSP no dejaba leer su blob: con fetch y el botón se ponía rojo; contraprueba 3160)
  await sleep(600);
  r.video_llega_al_nativo = await A.evaluate(() => window.__saved.length === 2 && window.__saved[1].mime === 'video/webm' && (window.__saved[1].base64 || '').length > 100);
  await swipe(b.x, b.y, b.x, b.y - 400, 200); await sleep(600); s = await state();
  r.boton_video_no_cierra = s.abierto && /^blob:/.test(s.vid) && s.contador === '4 / 4';
  // 5) ← en la última: no pasa nada
  await A.evaluate(() => { window.__vidDejado = document.querySelector('#fullscreen-media-overlay video'); });
  await left(); s = await state();
  r.ultima_no_pasa = /^blob:/.test(s.vid) && s.contador === '4 / 4' && s.slides === 1;
  // 6) → vuelve a la 3.ª; el vídeo que se deja se para y se libera
  await right(); s = await state();
  r.vuelve_a_3 = s.img === fullSrc(2) && s.contador === '3 / 4';
  r.video_liberado = await A.evaluate(() => { const v = window.__vidDejado; return !!v && !v.isConnected && v.paused && !v.getAttribute('src'); });
  // 7) gesto corto y lento (60 px en 600 ms): vuelve a su sitio
  await swipe(250, cy, 190, cy, 600); await sleep(600); s = await state();
  r.corto_no_cambia = s.img === fullSrc(2) && s.contador === '3 / 4' && s.slides === 1;
  // 7b) tirón corto pero RÁPIDO (80 px en 48 ms): sí pasa (→ la 2.ª)
  await swipe(150, cy, 230, cy, 48); await sleep(700); s = await state();
  r.tiron_rapido_pasa = s.img === fullSrc(1) && s.contador === '2 / 4';
  // 8) zoom 2,5× (doble toque): un arrastre de lado MUEVE la foto y no cambia de foto; uno vertical no cierra
  await dtap(196, cy); s = await state();
  r.zoom_doble_toque = /scale\(2\.5\)/.test(s.transform);
  await swipe(300, cy, 100, cy, 200); await sleep(600); s = await state();
  r.zoom_arrastre_no_cambia = s.img === fullSrc(1) && s.contador === '2 / 4' && s.slides === 1;
  r.zoom_arrastre_mueve = /translate\(-?[1-9]\d*(\.\d+)?px/.test(s.transform) && /scale\(2\.5\)/.test(s.transform);
  await swipe(196, 300, 196, 700, 200); await sleep(600); s = await state();
  r.zoom_vertical_no_cierra = s.abierto && s.img === fullSrc(1);
  await dtap(196, cy); s = await state();
  r.zoom_vuelve = /scale\(1\)/.test(s.transform);
  // 9) vertical corto y lento: no cierra; ↑ cierra
  await swipe(196, 500, 196, 450, 600); await sleep(600); s = await state();
  r.vertical_corto_no_cierra = s.abierto && s.img === fullSrc(1);
  await swipe(196, 600, 196, 150, 200); await sleep(600); s = await state();
  r.arriba_cierra = !s.abierto;
  // 10) ↓ también cierra
  await tapBubble(PHOTO, 2); s = await state();
  r.abre_3_contador = s.contador;
  await swipe(196, 250, 196, 700, 200); await sleep(600); s = await state();
  r.abajo_cierra = !s.abierto;
  // 11) «atrás» de Android cierra
  await tapBubble(PHOTO, 0);
  r.atras = await A.evaluate(() => { const had = !!document.getElementById('fullscreen-media-overlay'); const v = window.__nexoHandleBack && window.__nexoHandleBack(); return had && v === true && !document.getElementById('fullscreen-media-overlay'); });
  // 12) vídeo: el gesto que empieza en la barra del reproductor no cierra; sobre la imagen sí
  await tapBubble('#messages-container .video-attachment', 0); await sleep(300);
  const vr = await A.evaluate(() => { const v = document.querySelector('#fullscreen-media-overlay video'); if (!v) return null; const b = v.getBoundingClientRect(); return { x: b.left + b.width / 2, top: b.top, bottom: b.bottom, cy: b.top + b.height / 2 }; });
  r.video_abre = !!vr;
  // En Chromium la barra del reproductor se queda con sus toques (no llegan a la página); por si en algún teléfono llegan, el mismo
  // gesto también con eventos táctiles sintéticos sobre el vídeo (esos sí llegan al visor)
  const synth = (x0, y0, x1, y1) => A.evaluate(async ([x0, y0, x1, y1]) => {
    const v = document.querySelector('#fullscreen-media-overlay video'); if (!v) return false;
    const mk = (type, x, y, end) => { const t = new Touch({ identifier: 7, target: v, clientX: x, clientY: y }); return new TouchEvent(type, { touches: end ? [] : [t], targetTouches: end ? [] : [t], changedTouches: [t], bubbles: true, cancelable: true }); };
    v.dispatchEvent(mk('touchstart', x0, y0));
    for (let i = 1; i <= 8; i++) { await new Promise((res) => setTimeout(res, 20)); v.dispatchEvent(mk('touchmove', x0 + (x1 - x0) * i / 8, y0 + (y1 - y0) * i / 8)); }
    v.dispatchEvent(mk('touchend', x1, y1, true));
    return true;
  }, [x0, y0, x1, y1]);
  if (vr) {
    await swipe(vr.x, vr.bottom - 8, vr.x, vr.bottom - 400, 200); await sleep(600); s = await state();
    const realBar = s.abierto && /^blob:/.test(s.vid);
    await synth(vr.x, vr.bottom - 8, vr.x, vr.bottom - 400); await sleep(600); s = await state();
    r.video_barra_no_cierra = realBar && s.abierto && /^blob:/.test(s.vid);
    await synth(vr.x - 100, vr.bottom - 8, vr.x + 100, vr.bottom - 8); await sleep(600); s = await state();
    r.video_barra_lateral_no_cambia = s.abierto && /^blob:/.test(s.vid) && s.contador === '4 / 4';
    await swipe(vr.x, vr.top + 12, vr.x, vr.top - 350, 200); await sleep(600); s = await state();
    r.video_arriba_cierra = !s.abierto;
  }
  // 13) «ver una vez»: no se desliza (ni contador) y ↑ la cierra
  r.una_vez_no_consumida = await A.evaluate(async ([idB, id]) => { const m = (await window.vaultLoadMessages(idB)).find((x) => (x.msgId || x.messageId) === id); return !!m && !m.onceSeen; }, [idB, media.onceId]);
  await tapBubble('#messages-container .msg-once-tap', 0); s = await state();
  const onceSrc = 'data:image/jpeg;base64,' + media.once;
  r.una_vez_abre = s.abierto && s.img === onceSrc && !s.contador;
  await left(); s = await state();
  r.una_vez_no_desliza = s.abierto && s.img === onceSrc && !s.contador && s.slides === 1;
  await swipe(196, 600, 196, 150, 200); await sleep(600); s = await state();
  r.una_vez_arriba_cierra = !s.abierto;

  r.errores = logs.filter((l) => /PAGEERROR|TypeError/.test(l)).slice(0, 4);
  const keys = ['preparado', 'abre_1', 'sin_x', 'boton_abajo_derecha_foto', 'pasa_a_2', 'un_solo_slide', 'guarda_la_que_se_ve', 'tocar_boton_no_cambia', 'boton_vertical_no_cierra', 'boton_lateral_no_cambia',
    'boton_video_sobre_la_barra', 'tocar_boton_video_guarda', 'video_llega_al_nativo', 'boton_video_no_cierra', 'pasa_a_3', 'guardar_nuevo_en_3', 'pasa_al_video', 'ultima_no_pasa', 'vuelve_a_3', 'video_liberado',
    'corto_no_cambia', 'tiron_rapido_pasa', 'zoom_doble_toque', 'zoom_arrastre_no_cambia', 'zoom_arrastre_mueve', 'zoom_vertical_no_cierra', 'zoom_vuelve', 'vertical_corto_no_cierra', 'arriba_cierra',
    'abajo_cierra', 'atras', 'video_abre', 'video_barra_no_cierra', 'video_barra_lateral_no_cambia', 'video_arriba_cierra', 'una_vez_no_consumida', 'una_vez_abre', 'una_vez_no_desliza', 'una_vez_arriba_cierra'];
  const ok = keys.every((k) => r[k] === true) && r.contador_1 === '1 / 4' && r.contador_2 === '2 / 4' && r.contador_3 === '3 / 4' && r.contador_4 === '4 / 4' && r.abre_3_contador === '3 / 4' && r.errores.length === 0;
  r.fallan = keys.filter((k) => r[k] !== true);
  fin(ok);
  await browser.close();
  process.exit(ok ? 0 : 1);
})().catch((e) => { fin(false, { error: String(e && e.message).substring(0, 300) }); process.exit(1); });
