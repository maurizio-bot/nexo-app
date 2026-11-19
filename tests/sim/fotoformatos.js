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
const r = { prueba: 'fotoformatos', build: path.basename(process.argv[2]) };
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'fotoformatos-'));
const fin = (ok, extra) => {
  Object.assign(r, extra || {});
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('FOTOFORMATOS ' + JSON.stringify(r));
  try { fs.writeFileSync(path.join(__dirname, 'last_logs_fotoformatos.txt'), logs.join('\n')); } catch (e) {}
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

// 3243 (dueño 18-11: «mandé una foto panorámica y no se refleja en el chat»): una panorámica de más de 5 MB (antes: rechazada) llega como foto
// reducida; una foto en un formato que el teléfono no sabe mostrar (HEIC) llega como archivo en vez de perderse o llegar rota.
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
    const pano = await A.evaluate(() => { const c = document.createElement('canvas'); c.width = 9000; c.height = 1800; const g = c.getContext('2d'); const d = g.createImageData(9000, 1800); for (let i = 0; i < d.data.length; i++) d.data[i] = (i * 2654435761 >>> 24) & 255; g.putImageData(d, 0, 0); return c.toDataURL('image/jpeg', 0.97).split(',')[1]; });
    writeFile('pano.jpg', Buffer.from(pano, 'base64'));
    r.pano_mb = +(fs.statSync(fileOf('pano.jpg')).size / 1048576).toFixed(1);
    writeFile('foto.heic', Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypheic'), Buffer.alloc(4000, 9)]));
    const recibidos = () => B.evaluate(async (c) => ((await window.vaultLoadMessages(c)) || []).filter((m) => !m._own && m.attachmentType).map((m) => m.attachmentType + ':' + ((m.attachmentMeta && m.attachmentMeta.name) || '') + ':' + ((m.attachmentMeta && m.attachmentMeta.width) || 0)), idA);
    await A.evaluate(() => { window.__pickType = 'gallery'; });
    await pick(A, ['pano.jpg']);
    await waitFor(async () => !!(await review(A)), 8000);
    await clickIn(A, '#nexo-grev-send');
    r.pano_llega_como_foto = await waitFor(async () => (await recibidos()).some((x) => x.startsWith('image:pano.jpg:')), 40000);
    const pw = (await recibidos()).find((x) => x.startsWith('image:pano.jpg:'));
    r.pano_reducida = !!pw && Number(pw.split(':')[2]) > 0 && Number(pw.split(':')[2]) <= 4096;
    await pick(A, ['foto.heic']);
    await waitFor(async () => !!(await review(A)), 8000);
    await clickIn(A, '#nexo-grev-send');
    r.heic_llega_como_archivo = await waitFor(async () => (await recibidos()).some((x) => x.startsWith('file:foto.heic')), 40000);
    r.recibidos = await recibidos();
    fin(r.pano_mb > 5 && r.pano_llega_como_foto && r.pano_reducida && r.heic_llega_como_archivo);
  } catch (e) { fin(false, { error: String(e && e.message || e).slice(0, 300) }); }
  finally { await browser.close(); process.exit(0); }
})();
