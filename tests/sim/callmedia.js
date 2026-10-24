// Ronda 2768 (revisión de llamadas): src/ui/call_media.js, el de verdad, con micrófono, cámara y audio falsos. Con la
// 2767: colgar mientras se abría el micrófono lo dejaba abierto (y seguía mandando voz); en una videollamada con la
// cámara denegada u ocupada tampoco salía la voz; girar la cámara y colgar dejaba la cámara encendida; dos toques en
// "Girar" abrían dos cámaras; una ráfaga de voz tras un atasco sonaba superpuesta (hasta 4 trozos a la vez).
// Uso: node callmedia.js <dir_build>   (lee <dir_build>/src/ui/call_media.js)
'use strict';
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(path.resolve(process.argv[2]), 'src', 'ui', 'call_media.js'), 'utf8').replace(/^export /gm, '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Navegador falso: pistas, getUserMedia (con retraso, cámara denegada u ocupada), AudioContext y vídeo
function env(o) {
  const tracks = [], ctxs = [], starts = [];
  let gumCalls = 0;
  function mkTrack(kind) { const t = { kind, readyState: 'live', enabled: true, muted: false, stopped: false, stop() { this.stopped = true; this.readyState = 'ended'; } }; tracks.push(t); return t; }
  class FakeStream {
    constructor(ts) { this.ts = ts || []; }
    getTracks() { return this.ts.slice(); } getAudioTracks() { return this.ts.filter((t) => t.kind === 'audio'); } getVideoTracks() { return this.ts.filter((t) => t.kind === 'video'); }
    removeTrack(t) { this.ts = this.ts.filter((x) => x !== t); } addTrack(t) { this.ts.push(t); }
  }
  const navigator = { mediaDevices: { getUserMedia(c) {
    const n = ++gumCalls;
    return new Promise((res, rej) => setTimeout(() => {
      if (c.video && o.cameraDenied) { const e = new Error('Permission denied'); e.name = 'NotAllowedError'; return rej(e); }
      const ts = []; if (c.audio) ts.push(mkTrack('audio')); if (c.video) ts.push(mkTrack('video'));
      res(new FakeStream(ts));
    }, typeof o.gumDelay === 'function' ? o.gumDelay(n) : (o.gumDelay || 0)));
  } } };
  class AC {
    constructor() { this.state = 'running'; this.closed = false; this.currentTime = 10; this.destination = {}; ctxs.push(this); }
    createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
    createScriptProcessor() { const p = { onaudioprocess: null, connect() {}, disconnect() {} }; this.proc = p; return p; }
    createBuffer(ch, n, rate) { return { duration: n / rate, copyToChannel() {}, getChannelData() { return new Float32Array(n); } }; }
    createBufferSource() { const s = { buffer: null, connect() {}, start(t) { starts.push({ t, d: s.buffer ? s.buffer.duration : 0 }); } }; return s; }
    resume() { return Promise.resolve(); } close() { this.closed = true; this.state = 'closed'; return Promise.resolve(); }
  }
  const document = { createElement(tag) { if (tag === 'canvas') return { width: 0, height: 0, getContext() { return { drawImage() {} }; } }; return { muted: false, setAttribute() {}, play() { return Promise.resolve(); }, readyState: 4, srcObject: null }; } };
  const window = { AudioContext: AC, MediaStream: FakeStream };
  if (o.vp8) {
    window.VideoEncoder = class { constructor() { this.state = 'unconfigured'; } configure() { this.state = 'configured'; } encode() {} close() { this.state = 'closed'; } static isConfigSupported() { return Promise.resolve({ supported: true }); } };
    window.VideoDecoder = class { constructor() { this.state = 'unconfigured'; } configure() { this.state = 'configured'; } decode() {} close() { this.state = 'closed'; } };
    window.VideoFrame = class { close() {} };
  }
  const mod = new Function('window', 'navigator', 'document', 'MediaStream', src + '\nreturn { createCallMedia };')(window, navigator, document, FakeStream);
  const live = (kind) => tracks.filter((t) => t.kind === kind && !t.stopped).length;
  return { mod, tracks, ctxs, starts, live };
}

(async () => {
  const r = {};
  // 1. Se cuelga mientras el micrófono aún se abre (diálogo de permiso, teléfono lento) y luego el micrófono da audio
  {
    const e = env({ gumDelay: 400 });
    const packets = [];
    const m = e.mod.createCallMedia({ onPacket: (b) => packets.push(b), codecs: 'ulaw' });
    const p = m.start().then(() => 'ok', (er) => 'error ' + er.message);
    await sleep(50); m.stop();
    await p; await sleep(100);
    const ctx = e.ctxs[0];
    if (ctx && ctx.proc && ctx.proc.onaudioprocess) for (let i = 0; i < 30; i++) ctx.proc.onaudioprocess({ inputBuffer: { getChannelData: () => new Float32Array(2048).fill(0.1) } });
    r.colgar_mientras_abre_el_micro = { micros_abiertos: e.live('audio'), audio_abierto: e.ctxs.filter((c) => !c.closed).length, voz_tras_colgar: packets.length };
  }
  // 2. Videollamada con la cámara denegada (o sin cámara, u ocupada): al menos voz
  {
    const e = env({ cameraDenied: true, vp8: true });
    const m = e.mod.createCallMedia({ onPacket: () => {}, codecs: 'ulaw', video: true, onVideoPacket: () => {} });
    r.video_sin_camara = await m.start().then((i) => ({ empieza: true, video: !!i.video, micros: e.live('audio') }), () => ({ empieza: false, micros: e.live('audio') }));
    m.stop();
  }
  // 3. Girar la cámara y colgar antes de que abra la otra
  {
    const e = env({ vp8: true, gumDelay: (n) => (n === 1 ? 0 : 400) });
    const m = e.mod.createCallMedia({ onPacket: () => {}, codecs: 'ulaw', video: true, onVideoPacket: () => {} });
    await m.start();
    const f = m.flip(); await sleep(50); m.stop(); await f; await sleep(50);
    r.girar_y_colgar = { camaras_encendidas: e.live('video'), micros_abiertos: e.live('audio') };
  }
  // 4. Dos toques seguidos en "Girar"
  {
    const e = env({ vp8: true, gumDelay: (n) => (n === 1 ? 0 : 300) });
    const m = e.mod.createCallMedia({ onPacket: () => {}, codecs: 'ulaw', video: true, onVideoPacket: () => {} });
    await m.start();
    const f1 = m.flip(); await sleep(20); const f2 = m.flip();
    await Promise.all([f1, f2]);
    r.girar_dos_veces = { camaras_a_la_vez: e.live('video') };
    m.stop();
    r.girar_dos_veces.camaras_tras_colgar = e.live('video');
  }
  // 5. Ráfaga de 20 paquetes de voz a la vez (tras un atasco de la radio)
  {
    const e = env({});
    const m = e.mod.createCallMedia({ onPacket() {}, codecs: 'ulaw' });
    await m.start();
    const pk = () => { const p = new Uint8Array(4 + 800); p[0] = 2; p[1] = 1; p[2] = 800 >> 8; p[3] = 800 & 255; p.fill(0xff, 4); return p; };
    for (let i = 0; i < 20; i++) m.play(pk(), i);
    const iv = e.starts.map((s) => [s.t, s.t + s.d]);
    let maxAtOnce = iv.length ? 1 : 0;
    for (let i = 0; i < iv.length; i++) { let c = 1; for (let j = 0; j < iv.length; j++) if (j !== i && iv[j][0] < iv[i][1] - 1e-9 && iv[j][1] > iv[i][0] + 1e-9) c++; maxAtOnce = Math.max(maxAtOnce, c); }
    r.rafaga = { suenan: iv.length, a_la_vez_max: maxAtOnce };
    m.stop();
  }
  const c1 = r.colgar_mientras_abre_el_micro, v = r.video_sin_camara;
  const ok = c1.micros_abiertos === 0 && c1.audio_abierto === 0 && c1.voz_tras_colgar === 0 &&
    v.empieza && v.micros >= 1 && r.girar_y_colgar.camaras_encendidas === 0 && r.girar_y_colgar.micros_abiertos === 0 &&
    r.girar_dos_veces.camaras_a_la_vez <= 1 && r.girar_dos_veces.camaras_tras_colgar === 0 &&
    r.rafaga.suenan >= 1 && r.rafaga.a_la_vez_max === 1;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('CALLMEDIA ' + JSON.stringify(r));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
