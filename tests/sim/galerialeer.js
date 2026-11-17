// 3199 (diagnóstico automático del Motorola edge 40 neo, build 3086, 17-11 08:35 y 08:48): dos veces seguidas la foto elegida de la
// Galería NO salió: «Galería: envío 1 (0 «ver una vez»)» y 60 ms después «No se pudo leer el archivo: The requested file could not be
// read, typically due to permission problems that have occurred after a reference to a file was acquired.» (NotReadableError de
// Chromium). Desde la 3160 la revisión «Antes de enviar» muestra la foto con una URL de objeto y el archivo se LEE de verdad al tocar
// «Enviar», segundos después de elegirlo; si para entonces el archivo cambió desde que se eligió (Google Fotos, la nube o el selector de
// fotos de Android entregan primero un marcador) o se perdió el permiso temporal, Chromium ya no deja leerlo y la foto se pierde.
// Ahora lo elegido se copia a memoria AL ELEGIRLO (pickers.js, _copyPicked) y la vista previa, el ojo y el envío usan esa copia.
// Chromium real con archivos DE VERDAD en disco (el selector se simula con setInputFiles, como el <input type=file> del teléfono): el
// File guarda la fecha del archivo al elegirlo y, si el archivo cambia después, cualquier lectura da exactamente ese NotReadableError.
// Cada archivo «se rompe» (cambia su fecha) ~1 s después de elegirlo, como en el teléfono. Casos:
//  (1) una_foto: se elige, se rompe al segundo, «Enviar» a los ~2,5 s → sale, llega a B y se ve (contraprueba: la foto no sale y
//      queda el mismo «No se pudo leer el archivo» del diagnóstico);
//  (2) tres_una_vez: 3 fotos, el ojo en la 2.ª → salen las 3 en orden, la 2.ª «ver una vez», y así le llegan a B;
//  (3) falla_al_elegir: el archivo ya no se puede leer al elegirlo → se reintenta una vez (~500 ms) y luego el aviso claro «No se pudo
//      abrir esa foto…», sin revisión y sin ningún mensaje en el chat;
//  (4) reintento_ok: la primera lectura falla y la del reintento ya puede → sale;
//  (5) mezcla: de 2 fotos una no se puede abrir → revisión con la otra, aviso, y sale solo la buena;
//  (6) cancelada: la ✕ de la revisión → no se manda nada;
//  (7) video: un vídeo elegido y roto al segundo → sale (la recodificación se simula pero LEE el archivo entero, como el reproductor);
//  (8) video_grande: un vídeo de 26 MB (> 24 MB) NO se copia a memoria (se comprueba al elegirlo que se puede leer) y sale como antes.
// Además: las URL de objeto de la revisión son de la copia, no del archivo original (salvo el vídeo grande, que no se copia).
// Uso: node galerialeer.js <dir_build>   (imprime GALERIALEER {json} con "resultado":"OK"|"FALLO"; sale 0/1)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { PW, bootPhone, sleep } = require('./pw_harness');
const { Radio, NativePhone } = require('./native_mock');

const dist = path.resolve(process.argv[2], 'dist');
const logs = [];
const r = { prueba: 'galerialeer', build: path.basename(process.argv[2]) };
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'galerialeer-'));
const fin = (ok, extra) => {
  Object.assign(r, extra || {});
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('GALERIALEER ' + JSON.stringify(r));
  try { fs.writeFileSync(path.join(__dirname, 'last_logs_galerialeer.txt'), logs.join('\n')); } catch (e) {}
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) {}
};
const base = { readsContentFallback: true, retain: ['onPayloadReceived'], closeOnNoService: true, pace: [5, 5], ioDelay: 10, asymmetric: true, noTor: true, noL2: true };
const SEED = { A: 'Ana', B: 'Beto' };
const MAC = { A: 'AA:AA:AA:AA:AA:01', B: 'BB:BB:BB:BB:BB:02' };
const waitFor = async (fn, ms) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return true; await sleep(200); } return !!(await fn()); };
const MSG_FAIL = 'No se pudo abrir esa foto. Si está en la nube, ábrela antes en tu galería y vuelve a elegirla.';

// ---- en la página, antes de que arranque la app ----
function pageHooks() {
  // Los File que entrega el selector (los originales) y cuántas URL de objeto se hacen con ellos. Con __hold el «change» del selector
  // se retiene (la prueba rompe el archivo y lo suelta: así falla ya AL ELEGIRLO, sin carreras).
  window.__orig = new Set(); window.__objOrig = 0; window.__hold = false; window.__held = null;
  window.addEventListener('change', (e) => {
    const t = e.target; if (!t || t.type !== 'file') return;
    if (window.__hold) { e.stopImmediatePropagation(); window.__held = t; return; }
    Array.from(t.files || []).forEach((f) => window.__orig.add(f));
  }, true);
  const co = URL.createObjectURL.bind(URL);
  URL.createObjectURL = (b) => { if (window.__orig.has(b)) window.__objOrig++; return co(b); };
  // La recodificación del vídeo se simula, pero LEE el archivo entero (como el reproductor que hace la previa)
  window.NEXO_makeVideoPreview = async (blob) => {
    await blob.arrayBuffer();
    const c = document.createElement('canvas'); c.width = 160; c.height = 90; const g = c.getContext('2d'); g.fillStyle = '#2a7'; g.fillRect(0, 0, 160, 90);
    const b = new Blob([new Uint8Array(20 * 1024).fill(7)], { type: 'video/webm' }); b.thumb = c.toDataURL('image/jpeg', 0.6).split(',')[1];   // como _makeVideoPreview: base64 sin el «data:»
    return b;
  };
}

// ---- teléfonos ----
async function phone(browser, name) {
  const native = new NativePhone(name, MAC[name], Object.assign({}, base));
  const b2 = { newPage: async (o) => { const p = await browser.newPage(o); await p.addInitScript(() => { window.NEXO_NET_RELAYS = []; }); await p.addInitScript(pageHooks); return p; } };
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

// Lo adjunto en un chat: «nombre» (+ «*» si es «ver una vez»), en orden
const atts = (pg, chat, own) => pg.evaluate(async ([c, o]) => ((await window.vaultLoadMessages(c)) || []).filter((m) => !!m._own === o && m.attachmentType && !m.deleted)
  .map((m) => ((m.attachmentType === 'video' ? 'video:' : '') + ((m.attachmentMeta && m.attachmentMeta.name) || '?')) + (m.attachmentMeta && m.attachmentMeta.once ? '*' : '')), [chat, own]);

// ---- archivos en disco: la fecha se fija en segundos enteros; «romper» = cambiarla (el File elegido ya no se deja leer) ----
const T0 = Math.floor(Date.now() / 1000) - 3600;
const fileOf = (n) => path.join(TMP, n);
const writeFile = (n, buf) => { fs.writeFileSync(fileOf(n), buf); fs.utimesSync(fileOf(n), T0, T0); };
const breakFile = (n) => fs.utimesSync(fileOf(n), T0 + 60, T0 + 60);
const restoreFile = (n) => fs.utimesSync(fileOf(n), T0, T0);

// Elegir en la Galería: el selector del sistema se simula con setInputFiles sobre el <input type=file> que crea la app
async function pick(pg, names, opts = {}) {
  await pg.evaluate((h) => {
    document.querySelectorAll('input[type=file]').forEach((i) => i.setAttribute('data-viejo', '1'));
    window.__objOrig = 0; window.__hold = !!h; window.__held = null;
    document.querySelector('.attach-menu-item[data-type="gallery"]').click();
  }, !!opts.hold);
  let inp = null;
  for (let i = 0; i < 60 && !inp; i++) { await sleep(50); inp = await pg.$('input[type=file]:not([data-viejo])'); }
  if (!inp) throw new Error('no se abrió el selector');
  await inp.setInputFiles(names.map(fileOf));
  if (opts.hold) {
    // Chromium fija la fecha del archivo que espera (con la que compara al leer) al registrar el File, de forma asíncrona: se espera a
    // que esté (una lectura la obliga) antes de romperlo, para que la prueba no dependa de esa carrera
    await pg.evaluate(async () => {
      for (let k = 0; k < 50 && !window.__held; k++) await new Promise((res) => setTimeout(res, 20));
      for (const f of Array.from((window.__held && window.__held.files) || [])) await f.arrayBuffer().catch(() => {});
    });
    (opts.beforeRelease || (() => {}))();
    await pg.evaluate(() => { const i = window.__held; window.__hold = false; window.__held = null; if (i) i.dispatchEvent(new Event('change', { bubbles: true })); });
  }
  return Date.now();
}
const review = (pg) => pg.evaluate(() => {
  const ov = document.getElementById('nexo-gallery-review');
  if (!ov) return null;
  const cells = Array.from(ov.querySelectorAll('.nx-grev-item'));
  return { n: cells.length, imgs: cells.map((c) => { const m = c.querySelector('img'); return m ? (m.complete && m.naturalWidth > 0) : null; }), boton: (ov.querySelector('#nexo-grev-send') || {}).textContent };
});
const clickIn = (pg, sel) => pg.evaluate((s) => { const el = document.querySelector(s); if (el) el.click(); return !!el; }, sel);
const toast = (pg) => pg.evaluate(() => { const t = document.getElementById('perm-error-toast'); return t ? t.textContent : null; });
const ownBubbles = (pg) => pg.evaluate(() => document.querySelectorAll('#messages-container .message.own').length);
const logHas = (re, since) => logs.slice(since || 0).some((l) => re.test(l));
const untilAge = async (t0, ms) => { const d = t0 + ms - Date.now(); if (d > 0) await sleep(d); };

(async () => {
  const browser = await PW.chromium.launch();
  try {
    const radio = new Radio();
    const a = await phone(browser, 'A'), b = await phone(browser, 'B');
    radio.add(a.native); radio.add(b.native); a.native.load(); b.native.load();
    const A = await a.boot(), B = await b.boot();
    const idA = await idOf(A), idB = await idOf(B);
    if (!(await pair(A, ['B', SEED.B]))) { fin(false, { error: 'no empareja' }); return; }
    await openChat(A, idB); await sendText(A, 'hola'); await sleep(2500);
    await openChat(B, idA); await sendText(B, 'hola'); await sleep(2500);

    // Fotos de verdad (JPEG 800x600, cada una distinta) y vídeos (bytes; la recodificación está simulada)
    const jpgs = await A.evaluate(() => ['p1', 'q1', 'q2', 'q3', 'x1', 'y1', 'm1', 'm2', 'c1', 'c2'].map((n, k) => {
      const c = document.createElement('canvas'); c.width = 800; c.height = 600; const g = c.getContext('2d');
      g.fillStyle = 'hsl(' + (k * 36) + ',60%,45%)'; g.fillRect(0, 0, 800, 600);
      let s = 3 + k; const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
      for (let i = 0; i < 300; i++) { g.fillStyle = 'hsla(' + Math.floor(rnd() * 360) + ',60%,' + Math.floor(30 + rnd() * 50) + '%,0.6)'; g.beginPath(); g.arc(rnd() * 800, rnd() * 600, 5 + rnd() * 60, 0, 7); g.fill(); }
      g.fillStyle = '#fff'; g.font = 'bold 90px sans-serif'; g.fillText(n, 300, 330);
      return [n, c.toDataURL('image/jpeg', 0.85).split(',')[1]];
    }));
    for (const [n, b64] of jpgs) writeFile(n + '.jpg', Buffer.from(b64, 'base64'));
    writeFile('clip.mp4', Buffer.alloc(300 * 1024, 5));
    writeFile('grande.mp4', Buffer.alloc(26 * 1024 * 1024, 6));
    r.foto_kb = Math.round(fs.statSync(fileOf('p1.jpg')).size / 1024);

    // (1) Una foto: se rompe al segundo de elegirla; «Enviar» a los ~2,5 s
    {
      const c = {}; r.una_foto = c;
      const L = logs.length;
      const t0 = await pick(A, ['p1.jpg']);
      setTimeout(() => breakFile('p1.jpg'), 1000);
      c.revision = await waitFor(async () => !!(await review(A)), 3000);
      await untilAge(t0, 2500);
      const rv = await review(A);
      c.vista_previa_se_ve = !!(rv && rv.n === 1 && rv.imgs[0] === true);
      c.url_de_originales = await A.evaluate(() => window.__objOrig);
      await clickIn(A, '#nexo-grev-send');
      c.sale = await waitFor(async () => (await atts(A, idB, true)).includes('p1.jpg'), 20000);
      c.llega_a_B = await waitFor(async () => (await atts(B, idA, false)).includes('p1.jpg'), 60000);
      c.copiada_log = logHas(/\[A\] \[ATTACH\] Galería: copiadas 1 \(\d+ KB\) en \d+ ms/, L);
      const err = logs.slice(L).find((l) => /\[A\].*No se pudo leer el archivo/.test(l));
      if (err) c.error_de_lectura = err.replace(/^.*\[A\] /, '');
      c.aviso = await toast(A);
    }

    // (2) Tres fotos, el ojo en la 2.ª
    {
      const c = {}; r.tres_una_vez = c;
      const t0 = await pick(A, ['q1.jpg', 'q2.jpg', 'q3.jpg']);
      setTimeout(() => ['q1.jpg', 'q2.jpg', 'q3.jpg'].forEach(breakFile), 1000);
      c.revision = await waitFor(async () => { const x = await review(A); return !!x && x.n === 3; }, 3000);
      await untilAge(t0, 2500);
      const rv = await review(A);
      c.vistas_previas_se_ven = !!(rv && rv.imgs.every((v) => v === true));
      c.boton = rv && rv.boton;
      await A.evaluate(() => { const e = document.querySelectorAll('#nexo-gallery-review .nx-grev-eye')[1]; if (e) e.click(); });
      c.url_de_originales = await A.evaluate(() => window.__objOrig);
      await clickIn(A, '#nexo-grev-send');
      await waitFor(async () => (await atts(A, idB, true)).filter((x) => /^q/.test(x)).length >= 3, 30000);
      c.enviado = (await atts(A, idB, true)).filter((x) => /^q/.test(x));
      c.orden_y_marcas_ok = JSON.stringify(c.enviado) === JSON.stringify(['q1.jpg', 'q2.jpg*', 'q3.jpg']);
      await waitFor(async () => (await atts(B, idA, false)).filter((x) => /^q/.test(x)).length >= 3, 90000);
      c.B_recibe = (await atts(B, idA, false)).filter((x) => /^q/.test(x));
      c.B_ok = ['q1.jpg', 'q2.jpg*', 'q3.jpg'].every((x) => c.B_recibe.includes(x)) && c.B_recibe.length === 3;
    }

    // (3) Ya no se puede leer AL ELEGIRLA (ni al reintentar): aviso claro, sin revisión, sin mensaje en el chat
    {
      const c = {}; r.falla_al_elegir = c;
      const L = logs.length;
      const before = (await atts(A, idB, true)).length, bub0 = await ownBubbles(A);
      await pick(A, ['x1.jpg'], { hold: true, beforeRelease: () => breakFile('x1.jpg') });
      await sleep(2000);
      const rv = await review(A);
      c.sin_revision = !rv;
      if (rv) { c.revision_con_archivo_roto = rv.n; await clickIn(A, '#nexo-grev-send'); await sleep(2000); }
      c.aviso = await toast(A);
      c.aviso_claro = c.aviso === MSG_FAIL;
      c.reintento_log = logHas(/\[A\] \[ATTACH\] Galería: no se pudo leer foto 1 de 1 \(\*\.jpg, \d+ KB\) al elegir \(NotReadableError: .*reintento en 500 ms/, L);
      c.fallo_log = logHas(/\[A\] \[ATTACH\] Galería: foto 1 de 1 \(\*\.jpg, \d+ KB\) no se pudo abrir \(NotReadableError/, L);
      await sleep(2500);
      c.sin_mensaje = (await atts(A, idB, true)).length === before && (await ownBubbles(A)) === bub0;
      c.sin_preparando = await A.evaluate(() => !document.getElementById('video-preparing'));
    }

    // (4) La primera lectura falla y la del reintento (~500 ms) ya puede → sale
    {
      const c = {}; r.reintento_ok = c;
      const L = logs.length;
      await pick(A, ['y1.jpg'], { hold: true, beforeRelease: () => breakFile('y1.jpg') });
      // en cuanto falla la primera lectura (el reintento es a los 500 ms), el archivo vuelve a estar como cuando se eligió
      for (let i = 0; i < 150 && !c.reintento_visto; i++) { await sleep(20); c.reintento_visto = logHas(/\[A\] \[ATTACH\] Galería: no se pudo leer .* reintento en 500 ms/, L); }
      restoreFile('y1.jpg');
      c.revision = await waitFor(async () => !!(await review(A)), 3000);
      setTimeout(() => breakFile('y1.jpg'), 300);
      await sleep(1500);
      await clickIn(A, '#nexo-grev-send');
      c.sale = await waitFor(async () => (await atts(A, idB, true)).includes('y1.jpg'), 20000);
      c.llega_a_B = await waitFor(async () => (await atts(B, idA, false)).includes('y1.jpg'), 60000);
    }

    // (5) De 2 fotos una no se puede abrir: revisión con la otra + aviso; sale solo la buena
    {
      const c = {}; r.mezcla = c;
      const t0 = await pick(A, ['m1.jpg', 'm2.jpg'], { hold: true, beforeRelease: () => breakFile('m2.jpg') });
      setTimeout(() => breakFile('m1.jpg'), 1000);
      c.revision_con_una = await waitFor(async () => { const x = await review(A); return !!x && x.n === 1; }, 3000);
      c.aviso_claro = (await toast(A)) === MSG_FAIL;
      await untilAge(t0, 2500);
      await clickIn(A, '#nexo-grev-send');
      c.sale_la_buena = await waitFor(async () => (await atts(A, idB, true)).includes('m1.jpg'), 20000);
      c.llega_a_B = await waitFor(async () => (await atts(B, idA, false)).includes('m1.jpg'), 60000);
      c.la_mala_no = !(await atts(A, idB, true)).includes('m2.jpg');
    }

    // (6) Revisión cancelada: no se manda nada
    {
      const c = {}; r.cancelada = c;
      const before = (await atts(A, idB, true)).length;
      await pick(A, ['c1.jpg', 'c2.jpg']);
      setTimeout(() => ['c1.jpg', 'c2.jpg'].forEach(breakFile), 1000);
      c.revision = await waitFor(async () => { const x = await review(A); return !!x && x.n === 2; }, 3000);
      await sleep(1500);
      await clickIn(A, '#nexo-grev-cancel');
      await sleep(3000);
      c.cerrada = !(await review(A));
      c.nada_enviado = (await atts(A, idB, true)).length === before;
    }

    // (7) Un vídeo, roto al segundo de elegirlo
    {
      const c = {}; r.video = c;
      const t0 = await pick(A, ['clip.mp4']);
      setTimeout(() => breakFile('clip.mp4'), 1000);
      c.revision = await waitFor(async () => { const x = await review(A); return !!x && x.n === 1; }, 3000);
      c.url_de_originales = await A.evaluate(() => window.__objOrig);
      await untilAge(t0, 2500);
      await clickIn(A, '#nexo-grev-send');
      c.sale = await waitFor(async () => (await atts(A, idB, true)).includes('video:clip.mp4'), 20000);
      c.llega_a_B = await waitFor(async () => (await atts(B, idA, false)).includes('video:clip.mp4'), 60000);
      c.aviso = await toast(A);
    }

    // (8) Un vídeo de 26 MB: no se copia a memoria (se comprueba al elegirlo que se puede leer) y sale como antes
    {
      const c = {}; r.video_grande = c;
      const L = logs.length;
      await pick(A, ['grande.mp4']);
      c.revision = await waitFor(async () => { const x = await review(A); return !!x && x.n === 1; }, 5000);
      c.sin_copiar_log = logHas(/\[A\] \[ATTACH\] Galería: vídeo 1 de 1 \(\*\.mp4, 26624 KB\) sin copiar \(grande\)/, L);
      c.copiadas_0_log = logHas(/\[A\] \[ATTACH\] Galería: copiadas 0 \(0 KB\) en \d+ ms, 1 con el original/, L);
      await sleep(500);
      await clickIn(A, '#nexo-grev-send');
      c.sale = await waitFor(async () => (await atts(A, idB, true)).includes('video:grande.mp4'), 30000);
      c.llega_a_B = await waitFor(async () => (await atts(B, idA, false)).includes('video:grande.mp4'), 60000);
    }

    // Lo que ve B: las fotos normales que le llegaron se decodifican y se ven en su chat; la «una vez», como «una vez»
    await openChat(B, idA); await sleep(1500);
    // el contenido de cada foto: del mensaje o, si se guardó aparte, del archivo del teléfono
    const got = await B.evaluate(async (c) => ((await window.vaultLoadMessages(c)) || []).filter((m) => !m._own && m.attachmentType === 'image' && !(m.attachmentMeta && m.attachmentMeta.once))
      .map((m) => { const p = m.attachmentPayload; return { b64: typeof p === 'string' && p.length > 200 ? p : null, ref: m.attachmentRef || null }; }), idA);
    const b64s = got.map((g) => g.b64 || (g.ref && b.native.files.get(g.ref)) || null);
    r.B_ve = await B.evaluate(async (list) => {
      const dec = (b64) => new Promise((res) => { const im = new Image(); im.onload = () => res(im.naturalWidth + 'x' + im.naturalHeight); im.onerror = () => res('no'); im.src = 'data:image/jpeg;base64,' + b64; });
      const out = { fotos: list.length, decodificadas: [] };
      for (const x of list) out.decodificadas.push(x ? await dec(x) : 'sin datos');
      const imgs = Array.from(document.querySelectorAll('#messages-container .message.other img[data-fullscreen-type="image"]'));
      out.en_el_chat = imgs.filter((i) => i.complete && i.naturalWidth > 0).length;
      out.una_vez = Array.from(document.querySelectorAll('#messages-container .message.other')).filter((m) => /una vez/.test(m.textContent)).length;
      return out;
    }, b64s);

    r.errores = logs.filter((l) => /PAGEERROR|TypeError|ReferenceError|undefined is not/.test(l)).slice(0, 4);
    const c1 = r.una_foto, c2 = r.tres_una_vez, c3 = r.falla_al_elegir, c4 = r.reintento_ok, c5 = r.mezcla, c6 = r.cancelada, c7 = r.video, c8 = r.video_grande;
    r.ok_casos = {
      una_foto: !!(c1.revision && c1.vista_previa_se_ve && c1.url_de_originales === 0 && c1.sale && c1.llega_a_B && c1.copiada_log && !c1.error_de_lectura),
      tres_una_vez: !!(c2.revision && c2.vistas_previas_se_ven && c2.boton === 'Enviar (3)' && c2.url_de_originales === 0 && c2.orden_y_marcas_ok && c2.B_ok),
      falla_al_elegir: !!(c3.sin_revision && c3.aviso_claro && c3.reintento_log && c3.fallo_log && c3.sin_mensaje && c3.sin_preparando),
      reintento_ok: !!(c4.reintento_visto && c4.revision && c4.sale && c4.llega_a_B),
      mezcla: !!(c5.revision_con_una && c5.aviso_claro && c5.sale_la_buena && c5.llega_a_B && c5.la_mala_no),
      cancelada: !!(c6.revision && c6.cerrada && c6.nada_enviado),
      video: !!(c7.revision && c7.url_de_originales === 0 && c7.sale && c7.llega_a_B),
      video_grande: !!(c8.revision && c8.sin_copiar_log && c8.copiadas_0_log && c8.sale && c8.llega_a_B),
      B_ve: !!(r.B_ve && r.B_ve.fotos === 5 && r.B_ve.decodificadas.every((d) => d === '800x600') && r.B_ve.en_el_chat >= 5 && r.B_ve.una_vez === 1),
    };
    const ok = Object.values(r.ok_casos).every(Boolean) && r.errores.length === 0;
    fin(ok);
  } catch (e) {
    fin(false, { error: String((e && e.stack) || e).substring(0, 600) });
  } finally {
    await browser.close().catch(() => {});
  }
  process.exit(r.resultado === 'OK' ? 0 : 1);
})();
