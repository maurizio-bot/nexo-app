/**
 * call_media.js v1.0 (ronda 2758) — Audio de las llamadas (lo usa calls.js).
 * Micrófono (con cancelación de eco y de ruido) → paquetes de ~100 ms → calls.js los cifra y envía.
 * Lo que llega se reproduce con un colchón de ~150 ms (absorbe los saltos de la radio).
 * Formato de cada paquete:  [códec 1 byte][n.º de tramas 1 byte]{[largo 2 bytes][trama]}…
 *   códec 1 = Opus 16 kb/s (WebCodecs, ~2 KB/s: cabe por Bluetooth)   códec 2 = μ-law 8 kHz (si no hay Opus: 8 KB/s)
 * El códec lo elige quien envía según lo que soporta él y lo que dijo el otro en la oferta (calls.js).
 */
var RATE = 48000;
var PACKET_MS = 100;

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

export function createCallMedia(opts) {
  var onPacket = opts.onPacket, peerCodecs = String(opts.codecs || 'ulaw');
  var ctx = null, stream = null, src = null, proc = null, enc = null, dec = null, codec = 0, muted = false;
  var pending = [], pendingSince = 0, playAt = 0, ts = 0, decTs = 0;
  var ulawBuf = [];

  function flush(force) {
    if (!pending.length) return;
    if (!force && Date.now() - pendingSince < PACKET_MS) return;
    var f = pending; pending = [];
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
    if (playAt < now + 0.05 || playAt > now + 0.6) playAt = now + 0.15; // colchón; si se acumula retraso, se recorta
    s.start(playAt);
    playAt += buf.duration;
  }

  return {
    start: function() {
      return _hasOpus().then(function(opus) {
        codec = opus && peerCodecs.indexOf('opus') >= 0 ? 1 : 2;
        return navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      }).then(function(s) {
        stream = s;
        var AC = window.AudioContext || window.webkitAudioContext;
        ctx = new AC({ sampleRate: RATE });
        src = ctx.createMediaStreamSource(stream);
        proc = ctx.createScriptProcessor(2048, 1, 1);
        if (codec === 1) {
          enc = new window.AudioEncoder({
            output: function(chunk) { var b = new Uint8Array(chunk.byteLength); chunk.copyTo(b); queueFrame(b); },
            error: function(e) { console.warn('[CALL] Opus: ' + (e && e.message)); }
          });
          enc.configure({ codec: 'opus', sampleRate: RATE, numberOfChannels: 1, bitrate: 16000 });
        }
        proc.onaudioprocess = function(ev) {
          var inp = ev.inputBuffer.getChannelData(0);
          var data = muted ? new Float32Array(inp.length) : new Float32Array(inp);
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
        src.connect(proc); proc.connect(ctx.destination); // el nodo necesita salida para funcionar (escribe silencio)
        return { codec: codec === 1 ? 'opus' : 'ulaw' };
      });
    },
    play: function(bytes) {
      var p = unpackCallPacket(bytes);
      if (!p || !ctx) return;
      if (p.codec === 2) {
        p.frames.forEach(function(f) { var out = new Float32Array(f.length); for (var i = 0; i < f.length; i++) out[i] = _ulawDec(f[i]); playPcm(out, 8000); });
        return;
      }
      if (p.codec === 1) {
        if (!dec) {
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
    stop: function() {
      flush(true);
      try { if (proc) proc.disconnect(); if (src) src.disconnect(); } catch (e) {}
      try { if (enc && enc.state !== 'closed') enc.close(); if (dec && dec.state !== 'closed') dec.close(); } catch (e) {}
      try { if (stream) stream.getTracks().forEach(function(t) { t.stop(); }); } catch (e) {}
      try { if (ctx) ctx.close(); } catch (e) {}
      ctx = null;
    }
  };
}
