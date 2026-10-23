/**
 * NEXO — Herramientas de vídeo (sacadas de main.js en la ronda 2752, sin cambios): previa 240p recodificada en un
 * canvas, miniatura, conversión Blob ↔ base64 y formato. No dependen del resto de la app.
 */

// ===================== v9.9.30: vídeo previa + HD =====================
export var PREVIEW_MAX_SIDE = 426;          // 240p

export var PREVIEW_MAX_SECONDS = 60;

export var HD_DIRECT_MAX_BYTES = 2500000;   // original mayor (o >720p): se manda un HD recodificado

export var HD_MAX_SIDE = 1280;              // HD recodificado: 720p

export var HD_REENCODE_BPS = 1200000;       // ~750 KB por 5 s

export function _videoFormat(mime) { return /mp4/i.test(mime || '') ? 'mp4' : 'webm'; }

export function _blobToB64(blob) {
  return new Promise(function(resolve, reject) {
    var r = new FileReader();
    r.onload = function() { resolve(String(r.result).split(',')[1] || ''); };
    r.onerror = function() { reject(new Error('lectura')); };
    r.readAsDataURL(blob);
  });
}

// Recodifica a 240p y bitrate bajo reproduciendo el vídeo en un canvas (sin sonido audible: el audio
// va por WebAudio solo a la grabación). Devuelve un Blob (con .thumb = miniatura JPEG en base64) o null
// si el teléfono no puede; nunca se queda colgada (vigilante general).
// v9.9.32: vídeo temporal dentro de la pantalla (Android no decodifica vídeos ocultos), AudioContext
// reanudado o sin audio si sigue suspendido, vigilante de atascos y registro [VIDEO] de cada paso.
export function _makeVideoPreview(blob, knownDuration) {
  return new Promise(function(resolve) {
    var done = false, cleanup = [], t0 = Date.now();
    function log(m) { console.log('[VIDEO] ' + m + ' (' + Math.round((Date.now() - t0) / 100) / 10 + ' s)'); }
    function finish(res, why) {
      if (done) return; done = true;
      if (!res || res.tooLong) log('Previa no generada: ' + (why || (res && res.tooLong ? 'demasiado largo' : '?')));
      cleanup.forEach(function(f) { try { f(); } catch (e) {} });
      resolve(res);
    }
    try {
      if (typeof MediaRecorder === 'undefined' || !window.HTMLCanvasElement || !HTMLCanvasElement.prototype.captureStream) return finish(null, 'sin MediaRecorder/captureStream');
      log('Previa: inicio, original ' + Math.round(blob.size / 1024) + ' KB ' + (blob.type || '?'));
      var url = URL.createObjectURL(blob);
      cleanup.push(function() { URL.revokeObjectURL(url); });
      var v = document.createElement('video');
      v.playsInline = true; v.preload = 'auto';
      v.style.cssText = 'position:fixed;right:0;bottom:0;width:2px;height:2px;opacity:0.01;pointer-events:none;z-index:-1;';
      document.body.appendChild(v);
      cleanup.push(function() { v.pause(); v.removeAttribute('src'); v.load(); v.remove(); });
      var watchdog = setTimeout(function() { finish(null, 'sin metadatos en 15 s'); }, 15000);
      cleanup.push(function() { clearTimeout(watchdog); });
      v.onerror = function() { finish(null, 'el teléfono no puede leer el vídeo (código ' + (v.error && v.error.code) + ')'); };
      v.onloadedmetadata = function() {
        clearTimeout(watchdog);
        var dur = isFinite(v.duration) && v.duration > 0 ? v.duration : (knownDuration || 0);
        log('Previa: metadatos ' + v.videoWidth + 'x' + v.videoHeight + ' dur=' + (Math.round(dur * 10) / 10));
        if (dur > PREVIEW_MAX_SECONDS) return finish({ tooLong: true, duration: dur });
        // Vigilante general: nunca más de la duración + 25 s
        watchdog = setTimeout(function() { finish(null, 'tiempo agotado'); }, ((dur || PREVIEW_MAX_SECONDS) + 25) * 1000);
        var w = v.videoWidth || 640, h = v.videoHeight || 360;
        var scale = Math.min(1, PREVIEW_MAX_SIDE / Math.max(w, h));
        var cw = Math.max(2, Math.round(w * scale / 2) * 2), ch = Math.max(2, Math.round(h * scale / 2) * 2);
        var canvas = document.createElement('canvas');
        canvas.width = cw; canvas.height = ch;
        var ctx = canvas.getContext('2d');
        var tracks = canvas.captureStream(24).getVideoTracks().slice();
        _previewAudioTracks(v, cleanup).then(function(audioTracks) {
          if (done) return;
          audioTracks.forEach(function(t) { tracks.push(t); });
          if (!audioTracks.length) v.muted = true;
          log('Previa: audio ' + (audioTracks.length ? 'sí' : 'no'));
          var mime = ['video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'].filter(function(m) { return MediaRecorder.isTypeSupported(m); })[0] || '';
          // ~250 KB de previa como objetivo, entre 60 y 200 kbps de vídeo
          var vbps = Math.max(60000, Math.min(200000, Math.round(250000 * 8 / Math.max(dur || 10, 1)) - 24000));
          var rec;
          try { rec = new MediaRecorder(new MediaStream(tracks), Object.assign(mime ? { mimeType: mime } : {}, { videoBitsPerSecond: vbps, audioBitsPerSecond: 24000 })); }
          catch (e) { return finish(null, 'MediaRecorder: ' + e.message); }
          // v9.9.35: original grande (galería: 1080p/4K, decenas de MB) → en la misma pasada un HD 720p
          // recodificado; antes ese HD superaba el límite y solo viajaba la previa
          var needHd = blob.size > HD_DIRECT_MAX_BYTES || Math.max(w, h) > HD_MAX_SIDE;
          var hdRec = null, hdParts = [], hdCanvas = null, hdCtx = null, hw = 0, hh = 0;
          if (needHd) {
            try {
              var hs = Math.min(1, HD_MAX_SIDE / Math.max(w, h));
              hw = Math.max(2, Math.round(w * hs / 2) * 2); hh = Math.max(2, Math.round(h * hs / 2) * 2);
              hdCanvas = document.createElement('canvas'); hdCanvas.width = hw; hdCanvas.height = hh;
              hdCtx = hdCanvas.getContext('2d');
              var hdTracks = hdCanvas.captureStream(24).getVideoTracks().slice();
              audioTracks.forEach(function(t) { hdTracks.push(t.clone()); });
              hdRec = new MediaRecorder(new MediaStream(hdTracks), Object.assign(mime ? { mimeType: mime } : {}, { videoBitsPerSecond: HD_REENCODE_BPS, audioBitsPerSecond: 64000 }));
              hdRec.ondataavailable = function(e) { if (e.data && e.data.size) hdParts.push(e.data); };
              log('Previa: también HD ' + hw + 'x' + hh + ' (original ' + w + 'x' + h + ', ' + Math.round(blob.size / 1024) + ' KB)');
            } catch (e) { hdRec = null; log('Previa: sin HD recodificado (' + e.message + ')'); }
          }
          var parts = [], thumb = null, frames = 0, lastT = -1, stuck = 0, pendingStops = hdRec ? 2 : 1, out = null;
          rec.ondataavailable = function(e) { if (e.data && e.data.size) parts.push(e.data); };
          rec.onerror = function(e) { finish(null, 'error del grabador'); };
          var stopped = function() {
            if (--pendingStops > 0) return;
            if (hdRec) {
              var hdBlob = new Blob(hdParts, { type: (hdRec.mimeType || mime || 'video/webm').split(';')[0] });
              log('HD recodificado ' + hw + 'x' + hh + ' ' + Math.round(hdBlob.size / 1024) + ' KB');
              if (hdBlob.size > 0 && hdBlob.size < blob.size * 0.9) out.hd = hdBlob;
            }
            finish(out);
          };
          rec.onstop = function() {
            out = new Blob(parts, { type: (rec.mimeType || mime || 'video/webm').split(';')[0] });
            log('Previa ' + cw + 'x' + ch + ' ' + Math.round(out.size / 1024) + ' KB (original ' + Math.round(blob.size / 1024) + ' KB), miniatura ' + (thumb ? 'sí' : 'no'));
            if (!(out.size > 0 && out.size < blob.size * 0.8)) return finish(null, 'la previa no es más pequeña (' + Math.round(out.size / 1024) + ' KB)');
            out.thumb = thumb;
            stopped();
          };
          if (hdRec) { hdRec.onstop = stopped; hdRec.onerror = function() { hdRec = null; pendingStops = 1; if (out) finish(out); }; }
          var stop = function(why) {
            log('Previa: fin (' + why + ')');
            try { if (hdRec && hdRec.state !== 'inactive') hdRec.stop(); } catch (e) {}
            try { if (rec.state !== 'inactive') rec.stop(); else finish(null, 'grabador inactivo'); } catch (e) { finish(null, 'stop: ' + e.message); }
          };
          var draw = setInterval(function() {
            try {
              ctx.drawImage(v, 0, 0, cw, ch);
              if (hdCtx) hdCtx.drawImage(v, 0, 0, hw, hh);
              // Miniatura (poster) para la burbuja: un fotograma a ~0,3 s
              if (!thumb && ++frames === 8) thumb = canvas.toDataURL('image/jpeg', 0.6).split(',')[1] || null;
            } catch (e) {}
            // Atasco: el vídeo no avanza en 5 s
            if (v.currentTime === lastT) { if (++stuck > 120) { clearInterval(draw); stop('reproducción atascada en ' + Math.round(v.currentTime * 10) / 10 + ' s'); } }
            else { stuck = 0; lastT = v.currentTime; }
          }, 42);
          cleanup.push(function() { clearInterval(draw); });
          v.onended = function() { stop('vídeo terminado'); };
          rec.start(500);
          if (hdRec) { try { hdRec.start(500); } catch (e) { hdRec = null; pendingStops = 1; } }
          var pp = v.play();
          if (pp && pp.catch) pp.catch(function(e) { finish(null, 'play() rechazado: ' + (e && e.message)); });
        });
      };
      v.src = url;
    } catch (e) { finish(null, 'excepción: ' + (e && e.message)); }
  });
}

// Pista de audio del vídeo para la grabación, por WebAudio (no suena). Si el AudioContext no arranca
// (Android sin gesto del usuario) se devuelve [] y la previa va sin sonido en vez de colgarse.
export function _previewAudioTracks(v, cleanup) {
  return new Promise(function(resolve) {
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return resolve([]);
      var ac = new AC();
      cleanup.push(function() { try { ac.close(); } catch (e) {} });
      var ready = function() {
        try {
          var dest = ac.createMediaStreamDestination();
          ac.createMediaElementSource(v).connect(dest);
          resolve(dest.stream.getAudioTracks());
        } catch (e) { resolve([]); }
      };
      if (ac.state === 'running') return ready();
      var p = ac.resume ? ac.resume() : null;
      var t = setTimeout(function() { resolve([]); }, 800);
      if (p && p.then) p.then(function() { if (ac.state === 'running') { clearTimeout(t); ready(); } }).catch(function() {});
    } catch (e) { resolve([]); }
  });
}

export function _b64ToBlob(b64, mime) {
  var bin = atob(b64 || ''), arr = new Uint8Array(bin.length);
  for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime || 'application/octet-stream' });
}

// Miniatura JPEG (base64) de un vídeo (Blob o URL): primer fotograma. null si no se puede.
// El <video> temporal va dentro de la pantalla (1 px): Android no decodifica vídeos ocultos.
export function _makeVideoThumb(srcOrBlob, maxSide) {
  return new Promise(function(resolve) {
    var done = false, url = null, v = null;
    function finish(r) {
      if (done) return; done = true;
      try { if (v) { v.pause(); v.removeAttribute('src'); v.load(); v.remove(); } } catch (e) {}
      if (url) { try { URL.revokeObjectURL(url); } catch (e) {} }
      resolve(r);
    }
    try {
      url = (typeof srcOrBlob === 'string') ? null : URL.createObjectURL(srcOrBlob);
      v = document.createElement('video');
      v.muted = true; v.playsInline = true; v.preload = 'auto';
      v.style.cssText = 'position:fixed;right:0;bottom:0;width:1px;height:1px;opacity:0.01;pointer-events:none;z-index:-1;';
      document.body.appendChild(v);
      var timer = setTimeout(function() { finish(null); }, 6000);
      var grab = function() {
        try {
          var w = v.videoWidth, h = v.videoHeight;
          if (!w || !h) return;
          var sc = Math.min(1, (maxSide || 320) / Math.max(w, h));
          var c = document.createElement('canvas');
          c.width = Math.round(w * sc); c.height = Math.round(h * sc);
          c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
          clearTimeout(timer);
          finish(c.toDataURL('image/jpeg', 0.6).split(',')[1] || null);
        } catch (e) { clearTimeout(timer); finish(null); }
      };
      v.onloadeddata = function() { setTimeout(grab, 120); };
      v.onerror = function() { clearTimeout(timer); finish(null); };
      v.src = url || srcOrBlob;
    } catch (e) { finish(null); }
  });
}
