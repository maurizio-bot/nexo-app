const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
// Comprobación del sticker de VIDEO (3213) en un Chromium REAL (MediaRecorder + captureStream de verdad; el simulador usa un shim).
// Uso: en una carpeta DIR, un entry.js con
//   import { makeStickerVideo, clampTrim, canMakeStickerVideo } from '<repo>/src/ui/sticker_video.js';
//   import { stickerVideoEl, isValidStickerVid, STICKER_VID_MAX_LEN } from '<repo>/src/ui/stickers.js';
//   window.T = { makeStickerVideo, clampTrim, canMakeStickerVideo, stickerVideoEl, isValidStickerVid, STICKER_VID_MAX_LEN };
// empaquetado a DIR/bundle.js (webpack), un DIR/index.html que lo cargue, y: node tests/real_stickervideo.cjs DIR
// Resultado del 17-11: 5 s desde 0,5 de un video de 6,2 s → WebM válido de ~49 mil caracteres (tope 150 mil), 256×256, sin sonido, en bucle.
const dir = path.resolve(process.argv[2] || __dirname);
const srv = http.createServer((q, s) => { const f = path.join(dir, q.url === '/' ? 'index.html' : q.url); if (!fs.existsSync(f)) { s.writeHead(404); s.end(); return; } s.writeHead(200, { 'Content-Type': f.endsWith('.js') ? 'text/javascript' : 'text/html' }); s.end(fs.readFileSync(f)); }).listen(0, async () => {
  const port = srv.address().port;
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const pg = await b.newPage();
  pg.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE', m.text()); });
  await pg.goto('http://127.0.0.1:' + port + '/');
  const res = await pg.evaluate(async () => {
    const out = { puede: T.canMakeStickerVideo() };
    // video de origen: 6 s, 320x240, colores que cambian (grabado aquí mismo)
    const src = document.createElement('canvas'); src.width = 320; src.height = 240; const sx = src.getContext('2d');
    const st = src.captureStream(25); const rec = new MediaRecorder(st, { mimeType: 'video/webm;codecs=vp8', videoBitsPerSecond: 800000 }); const parts = [];
    rec.ondataavailable = (e) => parts.push(e.data);
    let t0 = performance.now(), on = true;
    const anim = () => { if (!on) return; const t = (performance.now() - t0) / 1000; sx.fillStyle = 'hsl(' + Math.floor(t * 60) % 360 + ',80%,50%)'; sx.fillRect(0, 0, 320, 240); sx.fillStyle = '#fff'; sx.font = '40px sans-serif'; sx.fillText(t.toFixed(1), 100, 130); requestAnimationFrame(anim); };
    anim(); rec.start(200);
    await new Promise((r) => setTimeout(r, 6200)); on = false;
    await new Promise((r) => { rec.onstop = r; rec.stop(); });
    const blob = new Blob(parts, { type: 'video/webm' });
    out.origen_kb = Math.round(blob.size / 1024);
    const v = document.createElement('video'); v.muted = true; v.playsInline = true; v.src = URL.createObjectURL(blob);
    await new Promise((r) => { v.onloadedmetadata = r; });
    // el WebM grabado no trae duración: se busca hasta el final para que el navegador la conozca (como un archivo de la galería sí la trae)
    if (!isFinite(v.duration)) { v.currentTime = 1e6; await new Promise((r) => { v.onseeked = r; }); v.currentTime = 0; await new Promise((r) => { v.onseeked = r; }); }
    out.origen_dur = Math.round(v.duration * 10) / 10;
    const draw = (ctx, S, f) => { const w = f.videoWidth, h = f.videoHeight, s = Math.min(w, h); ctx.drawImage(f, (w - s) / 2, (h - s) / 2, s, s, 0, 0, S, S); ctx.fillStyle = '#fff'; ctx.font = 'bold 30px sans-serif'; ctx.fillText('jaja', 90, 230); };
    const t1 = performance.now();
    const tr = T.clampTrim(v.duration, 0.5, 5);
    const d = await T.makeStickerVideo({ video: v, start: tr.start, len: tr.len }, draw);
    out.tramo = tr.start + '+' + tr.len;
    out.grabar_s = Math.round((performance.now() - t1) / 100) / 10;
    out.valido = T.isValidStickerVid(d);
    out.largo = d.length; out.tope = T.STICKER_VID_MAX_LEN;
    out.prefijo = d.slice(0, 24);
    // se reproduce como sticker: 256x256, en bucle
    const el = T.stickerVideoEl(d); document.body.appendChild(el);
    await new Promise((r) => { if (el.readyState >= 2) r(); else el.onloadeddata = r; });
    out.tam = el.videoWidth + 'x' + el.videoHeight;
    out.silenciado = el.muted;
    const seen = [];
    for (let i = 0; i < 16; i++) { await new Promise((r) => setTimeout(r, 500)); seen.push(Math.round(el.currentTime * 10) / 10); }
    out.tiempos = seen.join(',');
    out.repite = seen.some((x, i) => i > 0 && x < seen[i - 1]);
    return out;
  });
  console.log('REALVID ' + JSON.stringify(res));
  await b.close(); srv.close();
});
