/**
 * call_media.js v1.1 (ronda 2758) — Audio de las llamadas (lo usa calls.js).
 * Micrófono (con cancelación de eco y de ruido) → paquetes de ~100 ms → calls.js los cifra y envía.
 * Lo que llega se reproduce con un colchón de ~150 ms (absorbe los saltos de la radio).
 * Formato de cada paquete:  [códec 1 byte][n.º de tramas 1 byte]{[largo 2 bytes][trama]}…
 *   códec 1 = Opus 16 kb/s (WebCodecs, ~2 KB/s: cabe por Bluetooth)   códec 2 = μ-law 8 kHz (si no hay Opus: 8 KB/s)
 * El códec lo elige quien envía según lo que soporta él y lo que dijo el otro en la oferta (calls.js).
 * Videollamada (opts.video): cámara a 320x240 y 15 fps, VP8 con WebCodecs (~300 kb/s, una imagen completa cada 2 s);
 * cada imagen es un paquete [1 = completa / 0 = diferencia][datos]. Vista propia (media.localVideo) y la del otro
 * (media.remoteCanvas): las coloca calls_ui.js.
 * Ronda 2769 (informe del dueño: en videollamadas Vivo ↔ S24 a veces el S24 salía "sin cámara", el otro veía negro y no
 * se le oía; al apagar y encender la cámara volvía). Reproducido en tests/sim/callmedia.js:
 *  - micrófono y cámara se piden por separado (un fallo de la cámara ya no deja sin voz, ni al revés) y, si están
 *    ocupados un momento (NotReadableError, AbortError: la llamada anterior, otra app), se reintenta;
 *  - sin cámara al empezar se sigue con voz y se reintenta la cámara; cuando abre, entra el vídeo;
 *  - vigilante cada segundo: micrófono o cámara cortados por el sistema → se vuelven a pedir; cámara abierta sin
 *    imágenes → se reanuda y, si no, se vuelve a abrir; audio en pausa → se reanuda; codificador caído → se rehace;
 *  - imagen del otro: el decodificador que falla se rehace (antes quedaba cerrado: negro hasta colgar) y, si llega vídeo
 *    sin imagen, se pide una imagen completa al otro (opts.onNeedKey → media.requestKey en el otro);
 *  - el estado de la cámara y del micrófono se avisa (opts.onState) para la pantalla de los dos.
 */
var VW = 320, VH = 240, FPS = 15;
var RATE = 48000;
var PACKET_MS = 100;
// Ronda 2769
var GUM_RETRY_MS = [400, 1000, 2000];          // micrófono o cámara ocupados un momento: reintentos al abrir
var CAM_RETRY_MS = 4000, CAM_RETRY_MAX = 15;   // sin cámara: otro intento cada 4 s (~1 min)
var MIC_RETRY_MS = 3000;
var WATCH_MS = 1000;
var NO_FRAMES_MS = 2000;                       // cámara abierta sin imágenes: se reanuda; el doble: se vuelve a abrir
var STALL_MS = 3000;                           // llega vídeo del otro pero no sale imagen
var KEY_REQ_MS = 1500;                         // pedir imagen completa al otro, como mucho cada 1,5 s

function _hasOpus() {
  if (typeof window.AudioEncoder !== 'function' || typeof window.AudioDecoder !== 'function') return Promise.resolve(false);
  var cfg = { codec: 'opus', sampleRate: RATE, numberOfChannels: 1, bitrate: 16000 };
  return Promise.all([window.AudioEncoder.isConfigSupported(cfg), window.AudioDecoder.isConfigSupported({ codec: 'opus', sampleRate: RATE, numberOfChannels: 1 })])
    .then(function(r) { return !!(r[0] && r[0].supported && r[1] && r[1].supported); }).catch(function() { return false; });
}

// μ-law (G.711)
function _ulawEnc(s) {
  var x = Math.max(-1, Math.min(1, s)) * 32635, sign = x < 0 ? 0x80 : 0;
  if (sign) x = -x;
  x += 132;
  var exp = 7;
  for (var m = 0x4000; (x & m) === 0 && exp > 0; m >>= 1) exp--;
  var man = (x >> (exp + 3)) & 0x0f;
  return ~(sign | (exp << 4) | man) & 0xff;
}
function _ulawDec(u) {
  u = ~u & 0xff;
  var sign = u & 0x80, exp = (u >> 4) & 7, man = u & 0x0f;
  var x = ((man << 3) + 132) << exp;
  x -= 132;
  return (sign ? -x : x) / 32635;
}

function _pack(codec, frames) {
  var len = 2 + frames.reduce(function(n, f) { return n + 2 + f.length; }, 0);
  var out = new Uint8Array(len), o = 2;
  out[0] = codec; out[1] = frames.length;
  frames.forEach(function(f) { out[o] = f.length >> 8; out[o + 1] = f.length & 255; out.set(f, o + 2); o += 2 + f.length; });
  return out;
}
export function unpackCallPacket(u8) {
  if (!u8 || u8.length < 2) return null;
  var codec = u8[0], n = u8[1], o = 2, frames = [];
  for (var i = 0; i < n && o + 2 <= u8.length; i++) {
    var l = (u8[o] << 8) | u8[o + 1];
    if (o + 2 + l > u8.length) return null;
    frames.push(u8.subarray(o + 2, o + 2 + l)); o += 2 + l;
  }
  return { codec: codec, frames: frames };
}

function _hasVp8() {
  if (typeof window.VideoEncoder !== 'function' || typeof window.VideoDecoder !== 'function' || typeof window.VideoFrame !== 'function') return Promise.resolve(false);
  return window.VideoEncoder.isConfigSupported({ codec: 'vp8', width: VW, height: VH, bitrate: 300000, framerate: FPS })
    .then(function(r) { return !!(r && r.supported); }).catch(function() { return false; });
}

// Ronda 2769: ocupado un momento (se reintenta) o definitivo (permiso denegado, no hay)
function _busy(e) { var n = e && e.name; return n === 'NotReadableError' || n === 'AbortError' || n === 'TrackStartError'; }
function _final(e) { var n = e && e.name; return n === 'NotAllowedError' || n === 'PermissionDeniedError' || n === 'NotFoundError' || n === 'DevicesNotFoundError' || n === 'SecurityError'; }
function _stopAll(s) { try { s.getTracks().forEach(function(t) { t.stop(); }); } catch (e) {} }

// Ronda 2761: lo que este teléfono puede recibir (va en la oferta y en la respuesta; antes se anunciaba Opus siempre)
export function callCodecs() { return _hasOpus().then(function(o) { return o ? 'opus,ulaw' : 'ulaw'; }); }

export function createCallMedia(opts) {
  var onPacket = opts.onPacket, peerCodecs = String(opts.codecs || 'ulaw');
  var onState = typeof opts.onState === 'function' ? opts.onState : function() {};
  var onNeedKey = typeof opts.onNeedKey === 'function' ? opts.onNeedKey : function() {};
  var wantVideo = !!opts.video, venc = null, vdec = null, vTimer = null, vN = 0, vIn = 0, vGotKey = false, camOn = true, vcanvas = null, vctx = null;
  var facing = 'user', forceKey = false, localV = null;
  var vstats = window.NEXO_callVideoStats = { sent: 0, keys: 0, decoded: 0, bytes: 0, frames: 0, keyReq: 0, encErr: 0, decErr: 0 };
  window.NEXO_callAudioStats = { samples: 0, seconds: 0, energy: 0 }; // por llamada
  var media;
  var ctx = null, stream = null, src = null, proc = null, enc = null, dec = null, codec = 0, muted = false;
  var pending = [], pendingSince = 0, playAt = 0, ts = 0, decTs = 0, lastSentAt = 0;
  var ulawBuf = [];
  // Ronda 2761: para el diagnóstico (calls.js lo escribe cada 5 s): nivel del micrófono y audio reproducido
  var mic = { blocks: 0, energy: 0, peak: 0, encErr: 0 };
  // Ronda 2768: colgada (lo que se abra después se cierra) y un solo "Girar" a la vez
  var stopped = false, flipping = null;
  // Ronda 2769: estado de la cámara ('on' | 'off' | 'retry' | 'none') y del micrófono ('on' | 'retry' | 'none') y vigilante
  var camState = '', micState = '', camErr = '', micErr = '', watchTimer = null;
  var camOpening = false, camTries = 0, camNextTry = 0, camReopens = 0, lastFrameAt = 0, playTriedAt = 0;
  var micOpening = false, micNextTry = 0, micReopens = 0, lastResumeAt = 0;
  var rxVideoAt = 0, firstRxAt = 0, lastDecodedAt = 0, lastKeyReq = 0, stallResetAt = 0;

  function setState(cam, micS) {
    var changed = false;
    if (cam && cam !== camState) { camState = cam; changed = true; }
    if (micS && micS !== micState) { micState = micS; changed = true; }
    if (changed) try { onState({ cam: wantVideo ? camState || 'retry' : 'none', mic: micState || 'retry', camErr: camErr, micErr: micErr }); } catch (e) {}
  }

  function flush(force) {
    if (!pending.length) return;
    if (!force && Date.now() - pendingSince < PACKET_MS) return;
    var f = pending; pending = [];
    lastSentAt = Date.now();
    onPacket(_pack(codec, f));
  }
  function queueFrame(u8) {
    if (!pending.length) pendingSince = Date.now();
    pending.push(u8);
    flush(codec === 2); // μ-law: cada trama ya son 100 ms (sale sola: menos retraso)
  }
  function playPcm(f32, rate) {
    if (!ctx) return;
    // Para el diagnóstico (y las pruebas): cuánto audio llegó a reproducirse y con qué volumen medio
    var st = window.NEXO_callAudioStats = window.NEXO_callAudioStats || { samples: 0, seconds: 0, energy: 0 };
    var e2 = 0; for (var k = 0; k < f32.length; k++) e2 += f32[k] * f32[k];
    st.samples += f32.length; st.seconds += f32.length / rate; st.energy += e2;
    var buf = ctx.createBuffer(1, f32.length, rate);
    buf.copyToChannel ? buf.copyToChannel(f32, 0) : buf.getChannelData(0).set(f32);
    var s = ctx.createBufferSource();
    s.buffer = buf; s.connect(ctx.destination);
    var now = ctx.currentTime;
    if (playAt > now + 0.6) return; // ronda 2768: demasiado adelantado (ráfaga tras un atasco): se descarta (antes sonaban varios a la vez)
    if (playAt < now + 0.05) playAt = now + 0.15; // colchón
    s.start(playAt);
    playAt += buf.duration;
  }

  // Ronda 2769: getUserMedia con reintentos si está ocupado un momento
  function gum(c, label) {
    var tries = 0;
    function attempt() {
      return navigator.mediaDevices.getUserMedia(c).catch(function(e) {
        if (!stopped && _busy(e) && tries < GUM_RETRY_MS.length) {
          var wait = GUM_RETRY_MS[tries++];
          console.warn('[CALL] ' + label + ' (' + e.name + '): otro intento en ' + wait + ' ms');
          return new Promise(function(r) { setTimeout(r, wait); }).then(attempt);
        }
        throw e;
      });
    }
    return attempt();
  }
  function openCamStream(f) {
    return gum({ video: { width: { ideal: VW }, height: { ideal: VH }, frameRate: { ideal: FPS }, facingMode: f } }, 'Cámara ocupada').catch(function(e) {
      if (e && (e.name === 'OverconstrainedError' || e.name === 'ConstraintNotSatisfiedError')) return gum({ video: { facingMode: f } }, 'Cámara ocupada');
      throw e;
    });
  }

  // Audio: el procesador (y el codificador) se montan una vez; el micrófono se conecta cuando abre (y si se vuelve a abrir)
  function setupAudio() {
    var AC = window.AudioContext || window.webkitAudioContext;
    ctx = new AC({ sampleRate: RATE });
    proc = ctx.createScriptProcessor(2048, 1, 1);
    if (codec === 1) makeAudioEncoder();
    proc.onaudioprocess = function(ev) {
      if (stopped) return;
      if (codec === 1 && (!enc || enc.state === 'closed') && Date.now() - encMadeAt > 1000) makeAudioEncoder(); // ronda 2769: falló: uno nuevo (si no, no salía voz)
      var inp = ev.inputBuffer.getChannelData(0);
      var data = muted ? new Float32Array(inp.length) : new Float32Array(inp);
      var e1 = 0; for (var q = 0; q < inp.length; q++) e1 += inp[q] * inp[q];
      e1 = Math.sqrt(e1 / (inp.length || 1)); mic.blocks++; mic.energy += e1; if (e1 > mic.peak) mic.peak = e1;
      if (codec === 1) {
        try {
          var ad = new window.AudioData({ format: 'f32', sampleRate: RATE, numberOfFrames: data.length, numberOfChannels: 1, timestamp: ts, data: data });
          ts += Math.round(data.length * 1e6 / RATE);
          enc.encode(ad); ad.close();
        } catch (e) {}
      } else {
        // 48 kHz → 8 kHz (media de cada 6 muestras) → μ-law
        for (var i = 0; i + 6 <= data.length; i += 6) ulawBuf.push(_ulawEnc((data[i] + data[i + 1] + data[i + 2] + data[i + 3] + data[i + 4] + data[i + 5]) / 6));
        if (ulawBuf.length >= 800) { queueFrame(Uint8Array.from(ulawBuf.splice(0, 800))); }
      }
      flush(false);
    };
    proc.connect(ctx.destination); // el nodo necesita salida para funcionar (escribe silencio)
    // Ronda 2761: si el sistema dejó el audio en pausa (sin un toque reciente), se activa; si no, ni suena ni graba
    if (ctx.state !== 'running' && ctx.resume) { lastResumeAt = Date.now(); ctx.resume().catch(function() {}); }
  }

  var encMadeAt = 0;
  function makeAudioEncoder() {
    encMadeAt = Date.now();
    var me = enc = new window.AudioEncoder({
      output: function(chunk) { var b = new Uint8Array(chunk.byteLength); chunk.copyTo(b); queueFrame(b); },
      error: function(e) { if (me === enc && ++mic.encErr <= 5) console.warn('[CALL] Opus: ' + (e && e.message) + ': se rehace'); }
    });
    enc.configure({ codec: 'opus', sampleRate: RATE, numberOfChannels: 1, bitrate: 16000 });
  }

  function openMic(first) {
    if (micOpening || stopped) return Promise.resolve(false);
    micOpening = true;
    return gum({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }, 'Micrófono ocupado').then(function(s) {
      micOpening = false;
      if (stopped) { _stopAll(s); return false; }
      var t = s.getAudioTracks()[0];
      if (!t) { _stopAll(s); throw Object.assign(new Error('sin micrófono'), { name: 'NotFoundError' }); }
      stream.getAudioTracks().forEach(function(o) { stream.removeTrack(o); try { o.stop(); } catch (e) {} });
      stream.addTrack(t);
      try { if (src) src.disconnect(); } catch (e) {}
      if (ctx) { src = ctx.createMediaStreamSource(new MediaStream([t])); src.connect(proc); }
      micErr = ''; micNextTry = 0;
      if (!first) { micReopens++; console.log('[CALL] Micrófono abierto de nuevo'); }
      setState(null, 'on');
      return true;
    }).catch(function(e) {
      micOpening = false;
      micErr = (e && e.name) || 'error';
      micNextTry = _final(e) ? Infinity : Date.now() + MIC_RETRY_MS;
      console.warn('[CALL] Micrófono: ' + micErr + (_final(e) ? '' : ': se reintenta'));
      setState(null, _final(e) ? 'none' : 'retry');
      return false;
    });
  }

  // Cámara (al empezar, al volver tras un corte o "sin imágenes"): release = soltar antes la actual (muchos teléfonos
  // no abren la misma cámara dos veces)
  function openCam(reason, release) {
    if (camOpening || stopped || !wantVideo) return Promise.resolve(false);
    camOpening = true; camTries++;
    if (release) stream.getVideoTracks().forEach(function(o) { stream.removeTrack(o); try { o.stop(); } catch (e) {} });
    return openCamStream(facing).then(function(s) {
      camOpening = false;
      if (stopped) { _stopAll(s); return false; }
      var t = s.getVideoTracks()[0];
      if (!t) { _stopAll(s); throw Object.assign(new Error('sin cámara'), { name: 'NotFoundError' }); }
      stream.getVideoTracks().forEach(function(o) { stream.removeTrack(o); try { o.stop(); } catch (e) {} });
      t.enabled = camOn; stream.addTrack(t);
      camTries = 0; camErr = ''; camNextTry = 0; lastFrameAt = Date.now(); playTriedAt = 0; forceKey = true;
      if (reason) { camReopens++; console.log('[CALL] Cámara abierta de nuevo (' + reason + ')'); }
      if (localV) { localV.srcObject = new MediaStream([t]); playLocal(); }
      setState(camOn ? 'on' : 'off');
      return startVideo();
    }).catch(function(e) {
      camOpening = false;
      camErr = (e && e.name) || 'error';
      var fin = _final(e) || camTries >= CAM_RETRY_MAX;
      camNextTry = fin ? Infinity : Date.now() + CAM_RETRY_MS;
      console.warn('[CALL] Cámara: ' + camErr + (fin ? ': solo voz' : ': solo voz por ahora, otro intento en ' + CAM_RETRY_MS / 1000 + ' s'));
      setState(fin ? 'none' : 'retry');
      return false;
    });
  }

  function playLocal() {
    if (!localV) return;
    playTriedAt = Date.now();
    try { var pp = localV.play(); if (pp && pp.catch) pp.catch(function() {}); } catch (e) {}
  }

  var vencMadeAt = 0;
  function makeEncoder() {
    vencMadeAt = Date.now();
    try { if (venc && venc.state !== 'closed') venc.close(); } catch (e) {}
    var me = venc = new window.VideoEncoder({
      output: function(chunk) {
        var b = new Uint8Array(1 + chunk.byteLength); b[0] = chunk.type === 'key' ? 1 : 0; chunk.copyTo(b.subarray(1));
        vstats.sent++; vstats.bytes += b.length; if (b[0]) vstats.keys++;
        if (opts.onVideoPacket) opts.onVideoPacket(b);
      },
      error: function(e) { if (me === venc) { vstats.encErr++; if (vstats.encErr <= 5) console.warn('[CALL] Vídeo (codificar): ' + (e && e.message) + ': se rehace'); } }
    });
    venc.configure({ codec: 'vp8', width: VW, height: VH, bitrate: 300000, framerate: FPS });
    forceKey = true;
  }

  function encodeTick() {
    if (stopped || !camOn) return;
    if (!venc || venc.state === 'closed') { if (Date.now() - vencMadeAt > 1000) makeEncoder(); return; } // ronda 2769: falló: uno nuevo (como mucho uno por segundo)
    if (venc.state !== 'configured' || !localV || localV.readyState < 2 || venc.encodeQueueSize > 3) return;
    var f = null;
    try {
      vctx.drawImage(localV, 0, 0, VW, VH);
      f = new window.VideoFrame(vcanvas, { timestamp: Math.round(vN * 1e6 / FPS) });
      venc.encode(f, { keyFrame: forceKey || vN % (FPS * 2) === 0 }); vN++; forceKey = false;
      lastFrameAt = Date.now(); vstats.frames++;
    } catch (e) {}
    try { if (f) f.close(); } catch (e) {}
  }

  // Vídeo propio: <video> con la cámara, codificador y temporizador (una vez; una cámara nueva entra en el mismo <video>)
  function startVideo() {
    if (stopped) return Promise.resolve(false);
    if (vTimer) return Promise.resolve(true);
    return _hasVp8().then(function(ok) {
      var vt = stream && stream.getVideoTracks()[0];
      if (stopped || !vt) return false;
      if (!ok) {
        console.warn('[CALL] Este teléfono no puede codificar vídeo (VP8): solo voz');
        stream.getVideoTracks().forEach(function(o) { stream.removeTrack(o); try { o.stop(); } catch (e) {} });
        camNextTry = Infinity; setState('none');
        return false;
      }
      if (vTimer) return true;
      if (!localV) {
        localV = document.createElement('video');
        localV.muted = true; localV.playsInline = true; localV.autoplay = true; localV.setAttribute('playsinline', '');
        media.localVideo = localV;
      }
      localV.srcObject = new MediaStream([vt]);
      playLocal();
      vcanvas = document.createElement('canvas'); vcanvas.width = VW; vcanvas.height = VH; vctx = vcanvas.getContext('2d');
      makeEncoder();
      lastFrameAt = Date.now();
      vTimer = setInterval(encodeTick, Math.round(1000 / FPS));
      return true;
    });
  }

  function resetDecoder() { try { if (vdec && vdec.state !== 'closed') vdec.close(); } catch (e) {} vdec = null; vGotKey = false; }
  function needKey(why) {
    var now = Date.now();
    if (now - lastKeyReq < KEY_REQ_MS) return;
    lastKeyReq = now; vstats.keyReq++;
    console.log('[CALL] Pido una imagen completa (' + why + ')');
    try { onNeedKey(); } catch (e) {}
  }

  // Ronda 2769: vigilante
  function watch() {
    if (stopped) return;
    var now = Date.now(), visible = typeof document === 'undefined' || document.visibilityState !== 'hidden';
    // Audio en pausa (el sistema lo paró, otra app tomó el audio): se reanuda
    if (ctx && ctx.state === 'suspended' && now - lastResumeAt > 1500) { lastResumeAt = now; console.log('[CALL] Audio en pausa: se reanuda'); ctx.resume().catch(function() {}); }
    // Micrófono cortado por el sistema (o que no abrió): se vuelve a pedir
    var at = stream && stream.getAudioTracks()[0];
    if ((!at || at.readyState === 'ended') && micState !== 'none' && now >= micNextTry && !micOpening) {
      if (at) { stream.removeTrack(at); console.warn('[CALL] Micrófono cortado por el sistema'); setState(null, 'retry'); }
      openMic(false);
    }
    // Sin voz que mandar (sin micrófono, audio en pausa): un paquete vacío cada 2 s, para que el otro no corte
    if (now - lastSentAt > 2000) { lastSentAt = now; try { onPacket(_pack(codec || 2, [])); } catch (e) {} }
    if (wantVideo && camOn && camState !== 'none') watchCam(now, visible);
    // Llega vídeo del otro pero no sale imagen: imagen completa y, si sigue, decodificador nuevo
    if (rxVideoAt && now - rxVideoAt < 2000) {
      var since = lastDecodedAt || firstRxAt;
      if (now - since > STALL_MS) {
        needKey('sin imagen ' + Math.round((now - since) / 1000) + ' s');
        if (vdec && now - since > 2 * STALL_MS && now - stallResetAt > 2 * STALL_MS) { stallResetAt = now; console.warn('[CALL] Vídeo (recibir) parado: decodificador nuevo'); resetDecoder(); }
      }
    }
  }
  function watchCam(now, visible) {
    var vt = stream && stream.getVideoTracks()[0];
    if (!vt || vt.readyState === 'ended') {
      if (vt) { stream.removeTrack(vt); console.warn('[CALL] Cámara cortada por el sistema'); setState('retry'); }
      if (visible && now >= camNextTry && !camOpening) openCam(vTimer ? 'cortada' : 'otro intento');
      return;
    }
    if (!vTimer || !localV || !visible || camOpening) return;
    // Abierta pero sin imágenes: se reanuda el <video>; si sigue igual, se vuelve a abrir
    var idle = now - (lastFrameAt || now);
    if (idle > NO_FRAMES_MS && now - playTriedAt > NO_FRAMES_MS) { console.warn('[CALL] Cámara sin imágenes ' + Math.round(idle / 1000) + ' s: se reanuda'); playLocal(); }
    if (idle > 2 * NO_FRAMES_MS && now >= camNextTry) { console.warn('[CALL] Cámara sin imágenes: se vuelve a abrir'); camNextTry = now + CAM_RETRY_MS; setState('retry'); openCam('sin imágenes', true); }
  }

  media = {
    localVideo: null,
    remoteCanvas: null,
    start: function() {
      return _hasOpus().then(function(opus) {
        codec = opus && peerCodecs.indexOf('opus') >= 0 ? 1 : 2;
        if (stopped) return false;
        stream = new MediaStream([]);
        setupAudio();
        watchTimer = setInterval(watch, WATCH_MS);
        // Ronda 2769: primero el micrófono y luego la cámara, por separado (antes juntos: si la cámara fallaba, sin voz)
        return openMic(true);
      }).then(function(micOk) {
        var info = { codec: codec === 1 ? 'opus' : 'ulaw', mic: !!micOk, micError: micOk ? '' : micErr, video: false };
        if (stopped || !wantVideo) { if (!wantVideo) setState('none'); return info; }
        return openCam('').then(function(vok) { info.video = !!vok; return info; });
      });
    },
    // Imagen del otro (videollamada)
    playVideo: function(bytes) {
      if (stopped || !bytes || bytes.length < 2 || typeof window.VideoDecoder !== 'function') return;
      var now = Date.now();
      rxVideoAt = now; if (!firstRxAt) firstRxAt = now;
      var key = bytes[0] === 1;
      if (vdec && vdec.state === 'closed') resetDecoder(); // ronda 2769: falló: uno nuevo con la siguiente imagen completa
      if (!vGotKey && !key) { needKey('falta una imagen completa'); return; } // hasta la primera imagen completa no se puede
      if (!media.remoteCanvas) { var rc = document.createElement('canvas'); rc.width = VW; rc.height = VH; media.remoteCanvas = rc; }
      if (!vdec) {
        var rctx = media.remoteCanvas.getContext('2d');
        var d = vdec = new window.VideoDecoder({
          output: function(frame) { try { rctx.drawImage(frame, 0, 0, media.remoteCanvas.width, media.remoteCanvas.height); } catch (e) {} frame.close(); vstats.decoded++; lastDecodedAt = Date.now(); },
          error: function(e) { if (d !== vdec) return; vstats.decErr++; console.warn('[CALL] Vídeo (recibir): ' + (e && e.message) + ': se rehace'); resetDecoder(); needKey('fallo al decodificar'); }
        });
        vdec.configure({ codec: 'vp8' });
      }
      if (key) vGotKey = true;
      try { vdec.decode(new window.EncodedVideoChunk({ type: key ? 'key' : 'delta', timestamp: Math.round(vIn++ * 1e6 / FPS), data: bytes.subarray(1) })); }
      catch (e) { resetDecoder(); needKey('fallo al decodificar'); }
    },
    // Ronda 2769: el otro no tiene imagen: la siguiente que sale es completa
    requestKey: function() { forceKey = true; },
    // ¿Se está viendo la imagen del otro? (si no, la pantalla muestra su foto en vez de negro)
    remoteLive: function() { return !!lastDecodedAt && Date.now() - lastDecodedAt < 2500; },
    // Ronda 2762: cámara de delante / de detrás (se suelta la actual antes de abrir la otra: muchos teléfonos no
    // abren dos a la vez); si la otra no abre, se vuelve a la de antes. Imagen completa al cambiar.
    facing: function() { return facing; },
    flip: function() {
      if (!stream || !wantVideo || !navigator.mediaDevices || stopped) return Promise.resolve(facing);
      if (flipping) return flipping; // ronda 2768: dos toques seguidos, un solo cambio (antes, dos cámaras abiertas)
      var next = facing === 'user' ? 'environment' : 'user';
      stream.getVideoTracks().forEach(function(t) { stream.removeTrack(t); t.stop(); });
      camOpening = true;
      flipping = openCamStream(next).then(function(s2) { facing = next; return s2; }, function() { return openCamStream(facing); }).then(function(s2) {
        camOpening = false;
        if (stopped) { _stopAll(s2); return facing; } // ronda 2768: se colgó mientras se abría (la cámara quedaba encendida)
        var nt = s2.getVideoTracks()[0];
        if (nt) { nt.enabled = camOn; stream.addTrack(nt); }
        if (localV) { localV.srcObject = new MediaStream(nt ? [nt] : []); playLocal(); }
        forceKey = true; lastFrameAt = Date.now();
        return facing;
      }).catch(function() { camOpening = false; return facing; }).then(function(f) { flipping = null; return f; });
      return flipping;
    },
    camera: function(on) {
      camOn = !!on;
      try { stream.getVideoTracks().forEach(function(t) { t.enabled = !!on; }); } catch (e) {}
      if (!wantVideo || stopped) return;
      if (!on) { setState('off'); return; }
      forceKey = true; lastFrameAt = Date.now();
      var vt = stream && stream.getVideoTracks()[0];
      // Ronda 2769: encenderla sin cámara abierta (se cortó o no abrió) la vuelve a pedir
      if (!vt || vt.readyState === 'ended') { camTries = 0; camNextTry = 0; setState('retry'); openCam('encendida'); }
      else setState('on');
    },
    // Ronda 2769: la app vuelve a la vista (la cámara se pierde en segundo plano): se reintenta ya
    wake: function() {
      if (stopped) return;
      lastFrameAt = Date.now();
      if (camNextTry !== Infinity) camNextTry = 0;
      if (micNextTry !== Infinity) micNextTry = 0;
      if (ctx && ctx.state === 'suspended') { lastResumeAt = Date.now(); ctx.resume().catch(function() {}); }
    },
    play: function(bytes) {
      var p = unpackCallPacket(bytes);
      if (!p || !ctx) return;
      if (p.codec === 2) {
        p.frames.forEach(function(f) { var out = new Float32Array(f.length); for (var i = 0; i < f.length; i++) out[i] = _ulawDec(f[i]); playPcm(out, 8000); });
        return;
      }
      if (p.codec === 1) {
        if (!dec || dec.state === 'closed') {
          if (typeof window.AudioDecoder !== 'function') return;
          dec = new window.AudioDecoder({
            output: function(ad) {
              var f = new Float32Array(ad.numberOfFrames);
              try { ad.copyTo(f, { planeIndex: 0, format: 'f32-planar' }); } catch (e) { try { ad.copyTo(f, { planeIndex: 0 }); } catch (e2) {} }
              playPcm(f, ad.sampleRate); ad.close();
            },
            error: function(e) { console.warn('[CALL] Opus (recibir): ' + (e && e.message)); }
          });
          dec.configure({ codec: 'opus', sampleRate: RATE, numberOfChannels: 1 });
        }
        p.frames.forEach(function(f) {
          try { dec.decode(new window.EncodedAudioChunk({ type: 'key', timestamp: decTs, data: f })); decTs += 20000; } catch (e) {}
        });
      }
    },
    mute: function(on) { muted = !!on; },
    // Para el diagnóstico: estado del audio, micrófono (nivel medio y pico, 0–1) y lo reproducido del otro; ronda 2769:
    // estado de las pistas, de la cámara y del vídeo de los dos sentidos
    stats: function() {
      var st = window.NEXO_callAudioStats || { seconds: 0, samples: 0, energy: 0 };
      var at = stream && stream.getAudioTracks()[0], vt = stream && stream.getVideoTracks()[0];
      var trk = function(t) { return t ? (t.readyState !== 'live' ? 'cortada' : t.muted ? 'muda' : t.enabled ? 'viva' : 'apagada') : 'no'; };
      var out = { ctx: ctx ? ctx.state : 'sin audio', codec: codec === 1 ? 'opus' : codec === 2 ? 'ulaw' : '?', micLevel: mic.blocks ? mic.energy / mic.blocks : 0, micPeak: mic.peak,
        playedS: st.seconds || 0, playedLevel: st.samples ? Math.sqrt(st.energy / st.samples) : 0, mic: !!(at && at.readyState === 'live' && at.enabled && !at.muted),
        micTrack: trk(at), micState: micState, micErr: micErr, micReopens: micReopens };
      if (wantVideo || rxVideoAt) {
        out.video = { cam: wantVideo ? camState : 'none', track: trk(vt), local: localV ? localV.readyState : -1, enc: venc ? venc.state : 'no', frames: vstats.frames,
          sent: vstats.sent, keys: vstats.keys, decoded: vstats.decoded, dec: vdec ? vdec.state : 'no', keyReq: vstats.keyReq, encErr: vstats.encErr,
          decErr: vstats.decErr, err: camErr, reopens: camReopens, facing: facing };
      }
      return out;
    },
    stop: function() {
      stopped = true;
      flush(true);
      clearInterval(vTimer); clearInterval(watchTimer);
      try { if (venc && venc.state !== 'closed') venc.close(); if (vdec && vdec.state !== 'closed') vdec.close(); } catch (e) {}
      try { if (proc) proc.disconnect(); if (src) src.disconnect(); } catch (e) {}
      try { if (enc && enc.state !== 'closed') enc.close(); if (dec && dec.state !== 'closed') dec.close(); } catch (e) {}
      try { if (stream) stream.getTracks().forEach(function(t) { t.stop(); }); } catch (e) {}
      try { if (ctx) ctx.close(); } catch (e) {}
      ctx = null;
    }
  };
  return media;
}
