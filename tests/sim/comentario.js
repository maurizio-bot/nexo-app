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
const r = { prueba: 'comentario', build: path.basename(process.argv[2]) };
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'comentario-'));
const fin = (ok, extra) => {
  Object.assign(r, extra || {});
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('COMENTARIO ' + JSON.stringify(r));
  try { fs.writeFileSync(path.join(__dirname, 'last_logs_comentario.txt'), logs.join('\n')); } catch (e) {}
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
    document.querySelector('.attach-menu-item[data-type="' + (window.__pickType || 'gallery') + '"]').click();
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

// 3242 (dueño 18-11: «agregar un comentario al sacar una foto, subir una imagen y compartir un archivo»): A elige una foto en la galería y
// le escribe un comentario en la revisión; elige un archivo (ahora también pasa por la revisión) con otro comentario. B ve los dos
// comentarios debajo del adjunto y en su historial. Sin comentario, la burbuja queda como siempre.
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
    const jpg = await A.evaluate(() => { const c = document.createElement('canvas'); c.width = 400; c.height = 300; const g = c.getContext('2d'); g.fillStyle = '#3a7'; g.fillRect(0, 0, 400, 300); return c.toDataURL('image/jpeg', 0.8).split(',')[1]; });
    writeFile('foto.jpg', Buffer.from(jpg, 'base64'));
    writeFile('notas.txt', Buffer.from('hola mundo '.repeat(50)));
    writeFile('sin.jpg', Buffer.from(jpg, 'base64'));
    const capB = () => B.evaluate(() => Array.from(document.querySelectorAll('#messages-container .message.other .msg-caption')).map((e) => e.textContent));
    const metaB = () => B.evaluate(async (c) => ((await window.vaultLoadMessages(c)) || []).filter((m) => !m._own && m.attachmentType).map((m) => (m.attachmentMeta && m.attachmentMeta.caption) || ''), idA);
    // (1) foto con comentario
    await A.evaluate(() => { window.__pickType = 'gallery'; });
    await pick(A, ['foto.jpg']);
    r.revision_tiene_comentario = await waitFor(async () => !!(await A.$('#nexo-gallery-review #nexo-grev-cap')), 4000);
    await A.fill('#nexo-gallery-review #nexo-grev-cap', 'Mira <b>esto</b>');
    await clickIn(A, '#nexo-grev-send');
    r.foto_llega_con_comentario = await waitFor(async () => (await capB()).includes('Mira <b>esto</b>'), 25000);
    r.comentario_como_texto = await B.evaluate(() => !document.querySelector('#messages-container .msg-caption b'));
    // (2) archivo con comentario (pasa por la revisión)
    await A.evaluate(() => { window.__pickType = 'file'; });
    await pick(A, ['notas.txt']);
    r.archivo_tiene_revision = await waitFor(async () => !!(await A.$('#nexo-gallery-review .nx-grev-file')), 4000);
    await A.fill('#nexo-gallery-review #nexo-grev-cap', 'El informe');
    await clickIn(A, '#nexo-gallery-review #nexo-grev-send');
    r.archivo_llega_con_comentario = await waitFor(async () => (await metaB()).includes('El informe'), 25000);
    // (3) sin comentario: sin caja
    const n0 = (await capB()).length;
    await A.evaluate(() => { window.__pickType = 'gallery'; });
    await pick(A, ['sin.jpg']);
    await waitFor(async () => !!(await review(A)), 4000);
    await clickIn(A, '#nexo-grev-send');
    await waitFor(async () => (await metaB()).length >= 3, 25000);
    await sleep(1000);
    r.sin_comentario_sin_caja = (await metaB()).length >= 3 && (await capB()).length === n0;
    const ok = ['revision_tiene_comentario', 'foto_llega_con_comentario', 'comentario_como_texto', 'archivo_tiene_revision', 'archivo_llega_con_comentario', 'sin_comentario_sin_caja'].every((k) => r[k] === true);
    fin(ok);
  } catch (e) { fin(false, { error: String(e && e.message || e).slice(0, 300) }); }
  finally { await browser.close(); process.exit(0); }
})();
