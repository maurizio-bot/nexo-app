/**
 * NEXO — Sticker de VIDEO (3213, dueño 17-11: «los stickers se deben poder hacer con videos; obviamente se reducen al tamaño del
 * sticker y deben tener un límite de tiempo elegible con un tope de segundos máximos (5 por ejemplo)»).
 *
 * El editor (sticker_editor.js) deja elegir un video, el TRAMO (dónde empieza y cuánto dura: de 1 a 5 s) y, como con la foto, poner
 * texto y emoji encima. Aquí se graba ese tramo: cada cuadro del video se dibuja recortado al centro en un lienzo cuadrado de
 * STICKER_VID_SIZE (con el texto y el emoji encima, la MISMA función de dibujo que la vista previa) y el lienzo se graba con
 * MediaRecorder a WebM (VP8/VP9), sin sonido, 15 cuadros por segundo. Si sale más grande que el tope, se graba otra vez con menos
 * calidad. El resultado es un data URL validado (STICKER_VID_RE) que viaja como el sticker de foto.
 *
 * El simulador no tiene video ni MediaRecorder: si existe window.NEXO_makeStickerVideo se usa esa (shim de tests/sim).
 */
import { STICKER_VID_SIZE, STICKER_VID_MAX_S, isValidStickerVid } from './stickers.js';

var FPS = 15;
var BPS = [110000, 55000];   // bits por segundo: primer intento y, si no cabe, el segundo

// Tramo válido: duración de 1 a 5 s (o menos si el video es más corto) y que no se pase del final
export function clampTrim(duration, start, len) {
  var d = Number(duration) > 0 && isFinite(duration) ? Number(duration) : STICKER_VID_MAX_S;
  var maxLen = Math.min(STICKER_VID_MAX_S, d);
  var L = Math.max(Math.min(1, maxLen), Math.min(Number(len) || maxLen, maxLen));
  var S = Math.max(0, Math.min(Number(start) || 0, Math.max(0, d - L)));
  return { start: Math.round(S * 10) / 10, len: Math.round(L * 10) / 10, maxLen: Math.round(maxLen * 10) / 10, duration: d };
}

function _mime() {
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') return '';
  var c = ['video/webm;codecs=vp8', 'video/webm;codecs=vp9', 'video/webm'];
  for (var i = 0; i < c.length; i++) { try { if (MediaRecorder.isTypeSupported(c[i])) return c[i]; } catch (e) {} }
  return '';
}

function _blobToDataUrl(blob) {
  return new Promise(function(res) {
    try {
      var fr = new FileReader();
      fr.onload = function() { res(String(fr.result || '').replace(/^data:video\/webm[^,]*,/, 'data:video/webm;base64,')); };
      fr.onerror = function() { res(''); };
      fr.readAsDataURL(blob);
    } catch (e) { res(''); }
  });
}

// Graba UNA vez el tramo [start, start+len] de `video` dibujando cada cuadro con draw(ctx, S, video) → data URL ('' si falla)
function _recordOnce(video, start, len, draw, bps, mime) {
  return new Promise(function(resolve) {
    var S = STICKER_VID_SIZE, cv = document.createElement('canvas');
    cv.width = cv.height = S;
    var ctx = cv.getContext('2d');
    if (!ctx || typeof cv.captureStream !== 'function') { resolve(''); return; }
    var stream, rec, parts = [], done = false, safety = null;
    var finish = function() {
      if (done) return; done = true;
      clearTimeout(safety);
      try { video.pause(); } catch (e) {}
      try { if (rec && rec.state !== 'inactive') rec.stop(); else resolve(''); } catch (e) { resolve(''); }
    };
    try {
      stream = cv.captureStream(FPS);
      rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: bps });
    } catch (e) { resolve(''); return; }
    rec.ondataavailable = function(e) { if (e.data && e.data.size) parts.push(e.data); };
    rec.onstop = function() {
      try { stream.getTracks().forEach(function(t) { t.stop(); }); } catch (e) {}
      if (!parts.length) { resolve(''); return; }
      _blobToDataUrl(new Blob(parts, { type: 'video/webm' })).then(resolve);
    };
    var end = start + len;
    var tick = function() {
      if (done) return;
      try { draw(ctx, S, video); } catch (e) {}
      if (video.currentTime >= end - 0.02 || video.ended) { finish(); return; }
      requestAnimationFrame(tick);
    };
    var go = function() {
      try { draw(ctx, S, video); } catch (e) {}
      try { rec.start(250); } catch (e) { done = true; resolve(''); return; }
      var p; try { p = video.play(); } catch (e) {}
      if (p && p.catch) p.catch(function() {});
      safety = setTimeout(finish, (len + 6) * 1000);   // por si el video se queda trabado: nunca se graba sin fin
      requestAnimationFrame(tick);
    };
    try {
      video.muted = true;
      video.pause();
      if (Math.abs(video.currentTime - start) < 0.05) go();
      else { var onSeek = function() { video.removeEventListener('seeked', onSeek); go(); }; video.addEventListener('seeked', onSeek); video.currentTime = start; }
    } catch (e) { resolve(''); }
  });
}

// st = { video, start, len, ... } (el editor); draw(ctx, S, video) dibuja un cuadro con el texto y el emoji → Promise<data URL | ''>
export function makeStickerVideo(st, draw) {
  if (typeof window !== 'undefined' && typeof window.NEXO_makeStickerVideo === 'function') {
    try { return Promise.resolve(window.NEXO_makeStickerVideo(st)).then(function(v) { return isValidStickerVid(v) ? v : ''; }, function() { return ''; }); } catch (e) { return Promise.resolve(''); }
  }
  var v = st && st.video, mime = _mime();
  if (!v || !mime) return Promise.resolve('');
  var tr = clampTrim(v.duration, st.start, st.len);
  return _recordOnce(v, tr.start, tr.len, draw, BPS[0], mime).then(function(out) {
    if (isValidStickerVid(out) || !out) return out;
    return _recordOnce(v, tr.start, tr.len, draw, BPS[1], mime);   // no cupo: otra vez con menos calidad
  }).then(function(out) { return isValidStickerVid(out) ? out : ''; }, function() { return ''; });
}

// ¿Este teléfono puede grabar el sticker de video? (sin MediaRecorder/captureStream no se ofrece el botón)
export function canMakeStickerVideo() {
  if (typeof window !== 'undefined' && typeof window.NEXO_makeStickerVideo === 'function') return true;
  try { return !!_mime() && typeof HTMLCanvasElement !== 'undefined' && typeof HTMLCanvasElement.prototype.captureStream === 'function'; } catch (e) { return false; }
}

try { if (typeof window !== 'undefined') { window.__nexoMakeStickerVideo = makeStickerVideo; window.__nexoClampTrim = clampTrim; } } catch (e) {}
