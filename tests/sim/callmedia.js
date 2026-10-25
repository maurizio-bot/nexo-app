// Rondas 2768 y 2769 (revisión de llamadas; informe del dueño: en videollamadas Vivo ↔ S24 a veces el S24 salía "sin
// cámara", el otro veía negro y no se le oía, y al apagar y encender la cámara volvía): src/ui/call_media.js, el de
// verdad, con micrófono, cámara, audio y vídeo falsos que fallan como los de un teléfono.
//  2768: colgar mientras se abre el micrófono (quedaba abierto), videollamada sin cámara (no había ni voz), girar y
//        colgar (cámara encendida), dos toques en "Girar" (dos cámaras), ráfaga de voz (trozos superpuestos).
//  2769: cámara ocupada al empezar (unos instantes, o varios segundos), micrófono ocupado al empezar, cámara cortada por
//        el sistema en plena llamada, cámara abierta sin imágenes, audio en pausa, fallo del codificador de vídeo, fallo
//        del decodificador del otro (quedaba negro hasta colgar), vídeo sin imagen completa (pedirla), pedir imagen
//        completa al otro, fallo del codificador de voz (Opus; quedaba sin voz hasta colgar) y del decodificador de voz,
//        sin micrófono (permiso quitado: no salía nada y el otro cortaba a los 12 s), codificador de vídeo que falla
//        siempre (se rehacía sin parar y llenaba el registro), decodificador parado (llega vídeo y no sale imagen).
//  2772: girar el teléfono en plena videollamada (la imagen de la cámara cambia de forma: codificador nuevo con la
//        forma nueva y la siguiente imagen completa); eco en la llamada (la voz del otro que suena vuelve al micrófono:
//        con los filtros de voz, lo que se manda baja; si uno habla a la vez, su voz pasa).
// Uso: node callmedia.js <dir_build>   (lee <dir_build>/src/ui/call_media.js)
'use strict';
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(path.resolve(process.argv[2]), 'src', 'ui', 'call_media.js'), 'utf8').replace(/^export /gm, '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (c, ms) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (c()) return Date.now() - t0; await sleep(50); } return c() ? ms : null; };

// Navegador falso. o: gumDelay (ms o función n→ms), cameraDenied, camFail(n, ms) / micFail(n, ms) → nombre del error o
// null (n = intento de cámara o de micrófono, ms = desde que empezó), stuckCam(n) → esa cámara no da imágenes,
// suspended → el audio empieza en pausa y el primer resume() no basta, encErrAfter / decErrAt → fallo del codificador
// (tras N imágenes) o del decodificador (en la N.ª), encErrAlways → el codificador falla siempre, decSilent → el primer
// decodificador acepta el vídeo pero no da imágenes, vp8 → hay WebCodecs de vídeo, opus → hay WebCodecs de voz
// (aEncErrAfter / aDecErrAt: fallo del codificador o del decodificador de voz)
function env(o) {
  const t0 = Date.now(), tracks = [], ctxs = [], starts = [], encoded = [], decoded = [], videos = [];
  let camN = 0, micN = 0, decN = 0;
  function mkTrack(kind, extra) { const t = Object.assign({ kind, readyState: 'live', enabled: true, muted: false, stopped: false, _l: [], stop() { this.stopped = true; this.readyState = 'ended'; }, addEventListener(ev, f) { if (ev === 'ended') this._l.push(f); } }, extra || {}); tracks.push(t); return t; }
  const endTrack = (t) => { t.readyState = 'ended'; if (typeof t.onended === 'function') t.onended(); t._l.forEach((f) => f()); };
  class FakeStream {
    constructor(ts) { this.ts = (ts || []).slice(); }
    getTracks() { return this.ts.slice(); } getAudioTracks() { return this.ts.filter((t) => t.kind === 'audio'); } getVideoTracks() { return this.ts.filter((t) => t.kind === 'video'); }
    removeTrack(t) { this.ts = this.ts.filter((x) => x !== t); } addTrack(t) { this.ts.push(t); }
  }
  const navigator = { mediaDevices: { getUserMedia(c) {
    const ms = Date.now() - t0, wantV = !!c.video, wantA = !!c.audio;
    const vn = wantV ? ++camN : 0, an = wantA ? ++micN : 0;
    const delay = typeof o.gumDelay === 'function' ? o.gumDelay(vn || an) : (o.gumDelay || 0);
    return new Promise((res, rej) => setTimeout(() => {
      const fail = (name) => { const e = new Error(name); e.name = name; rej(e); };
      if (wantV && o.cameraDenied) return fail('NotAllowedError');
      if (wantV && o.camFail) { const f = o.camFail(vn, ms); if (f) return fail(f); }
      if (wantA && o.micFail) { const f = o.micFail(an, ms); if (f) return fail(f); }
      const ts = [];
      if (wantA) ts.push(mkTrack('audio'));
      if (wantV) ts.push(mkTrack('video', { stuck: !!(o.stuckCam && o.stuckCam(vn)) }));
      res(new FakeStream(ts));
    }, delay));
  } } };
  class AC {
    constructor() {
      this.state = o.suspended ? 'suspended' : 'running'; this.closed = false; this.destination = {}; this.resumes = 0; ctxs.push(this);
      if (o.clock) Object.defineProperty(this, 'currentTime', { get: () => 10 + (Date.now() - t0) / 1000 }); else this.currentTime = 10; // (2772: o.clock, reloj que avanza)
    }
    createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
    createScriptProcessor() { const p = { onaudioprocess: null, connect() {}, disconnect() {} }; this.proc = p; return p; }
    createBuffer(ch, n, rate) { const d = new Float32Array(n); return { duration: n / rate, rate, data: d, copyToChannel(f) { d.set(f); }, getChannelData() { return d; } }; }
    createBufferSource() { const s = { buffer: null, connect() {}, start(t) { starts.push({ t, d: s.buffer ? s.buffer.duration : 0, buf: s.buffer }); } }; return s; }
    resume() { this.resumes++; if (!o.suspended || this.resumes >= 2) this.state = 'running'; return Promise.resolve(); }
    close() { this.closed = true; this.state = 'closed'; return Promise.resolve(); }
  }
  // <video>: tiene imagen (readyState 4) si su cámara está viva y no está "atascada"
  function mkVideo() {
    const v = { muted: false, plays: 0, setAttribute() {}, srcObject: null, play() { v.plays++; return Promise.resolve(); } };
    Object.defineProperty(v, 'readyState', { get() { const t = v.srcObject && v.srcObject.getVideoTracks()[0]; return t && t.readyState === 'live' && !t.stuck ? 4 : 0; } });
    videos.push(v); return v;
  }
  const document = { visibilityState: 'visible', createElement(tag) { if (tag === 'canvas') return { width: 0, height: 0, getContext() { return { drawImage() {} }; } }; return mkVideo(); } };
  const window = { AudioContext: AC, MediaStream: FakeStream };
  if (o.vp8) {
    let encN = 0;
    window.VideoEncoder = class {
      constructor(init) { this.state = 'unconfigured'; this.init = init; this.encodeQueueSize = 0; window._encs = (window._encs || 0) + 1; }
      configure(c) { this.state = 'configured'; (window._cfgs = window._cfgs || []).push(c || {}); }
      encode(f, opt) {
        if (this.state !== 'configured') { const e = new Error('InvalidStateError'); e.name = 'InvalidStateError'; throw e; }
        encN++;
        if (o.encErrAlways || (o.encErrAfter && encN === o.encErrAfter)) { this.state = 'closed'; this.init.error(new Error('Encoding error')); return; }
        const key = !!(opt && opt.keyFrame);
        encoded.push({ at: Date.now(), key });
        this.init.output({ type: key ? 'key' : 'delta', byteLength: 10, copyTo(b) { b.fill(7); } });
      }
      close() { this.state = 'closed'; }
      static isConfigSupported() { return Promise.resolve({ supported: true }); }
    };
    window.VideoDecoder = class {
      constructor(init) { this.state = 'unconfigured'; this.init = init; window._decs = (window._decs || 0) + 1; }
      configure() { this.state = 'configured'; }
      decode(ch) {
        if (this.state !== 'configured') { const e = new Error('InvalidStateError'); e.name = 'InvalidStateError'; throw e; }
        decN++;
        if (o.decErrAt && decN === o.decErrAt) { this.state = 'closed'; setTimeout(() => this.init.error(new Error('Decoding error')), 0); return; }
        if (o.decSilent && window._decs === 1) return; // el primer decodificador se queda parado: acepta y no da imágenes
        decoded.push({ at: Date.now(), type: ch.type });
        this.init.output({ close() {} });
      }
      close() { this.state = 'closed'; }
    };
    window.VideoFrame = class { close() {} };
    window.EncodedVideoChunk = class { constructor(i) { Object.assign(this, i); } };
  }
  if (o.opus) {
    let aEncN = 0, aDecN = 0;
    const closedErr = () => { const e = new Error('InvalidStateError'); e.name = 'InvalidStateError'; return e; };
    window.AudioEncoder = class {
      constructor(init) { this.state = 'unconfigured'; this.init = init; window._aencs = (window._aencs || 0) + 1; }
      configure() { this.state = 'configured'; }
      encode() {
        if (this.state !== 'configured') throw closedErr();
        aEncN++;
        if (o.aEncErrAfter && aEncN === o.aEncErrAfter) { this.state = 'closed'; setTimeout(() => this.init.error(new Error('Encoding error')), 0); return; }
        this.init.output({ byteLength: 40, copyTo(b) { b.fill(5); } });
      }
      close() { this.state = 'closed'; }
      static isConfigSupported() { return Promise.resolve({ supported: true }); }
    };
    window.AudioDecoder = class {
      constructor(init) { this.state = 'unconfigured'; this.init = init; window._adecs = (window._adecs || 0) + 1; }
      configure() { this.state = 'configured'; }
      decode() {
        if (this.state !== 'configured') throw closedErr();
        aDecN++;
        if (o.aDecErrAt && aDecN === o.aDecErrAt) { this.state = 'closed'; setTimeout(() => this.init.error(new Error('Decoding error')), 0); return; }
        this.init.output({ numberOfFrames: 960, sampleRate: 48000, copyTo(f) { f.fill(0.1); }, close() {} });
      }
      close() { this.state = 'closed'; }
      static isConfigSupported() { return Promise.resolve({ supported: true }); }
    };
    window.AudioData = class { constructor(i) { Object.assign(this, i); } close() {} };
    window.EncodedAudioChunk = class { constructor(i) { Object.assign(this, i); } };
  }
  const mod = new Function('window', 'navigator', 'document', 'MediaStream', src + '\nreturn { createCallMedia, unpackCallPacket };')(window, navigator, document, FakeStream);
  const live = (kind) => tracks.filter((t) => t.kind === kind && !t.stopped && t.readyState === 'live').length;
  return { mod, tracks, ctxs, starts, encoded, decoded, videos, live, endTrack, window, document };
}
// Paquete de vídeo como los que manda call_media.js: [1 = imagen completa / 0 = diferencia][datos]
const vpk = (key) => { const b = new Uint8Array(12); b[0] = key ? 1 : 0; b.fill(9, 1); return b; };
const mk = (e, extra) => e.mod.createCallMedia(Object.assign({ onPacket() {}, codecs: 'ulaw' }, extra || {}));

(async () => {
  const r = {};
  // --- 2768 ---
  // 1. Se cuelga mientras el micrófono aún se abre (diálogo de permiso, teléfono lento) y luego el micrófono da audio
  {
    const e = env({ gumDelay: 400 });
    const packets = [];
    const m = mk(e, { onPacket: (b) => packets.push(b) });
    const p = m.start().then(() => 'ok', (er) => 'error ' + er.message);
    await sleep(50); m.stop();
    await p; await sleep(100);
    const ctx = e.ctxs[0];
    if (ctx && ctx.proc && ctx.proc.onaudioprocess) for (let i = 0; i < 30; i++) ctx.proc.onaudioprocess({ inputBuffer: { getChannelData: () => new Float32Array(2048).fill(0.1) } });
    r.colgar_mientras_abre_el_micro = { micros_abiertos: e.live('audio'), audio_abierto: e.ctxs.filter((c) => !c.closed).length, voz_tras_colgar: packets.length };
  }
  // 2. Videollamada con la cámara denegada (o sin cámara): al menos voz, y el estado lo dice
  {
    const e = env({ cameraDenied: true, vp8: true });
    const states = [];
    const m = mk(e, { video: true, onVideoPacket() {}, onState: (s) => states.push(s && s.cam) });
    r.video_sin_camara = await m.start().then((i) => ({ empieza: true, video: !!i.video, micros: e.live('audio') }), () => ({ empieza: false, micros: e.live('audio') }));
    await sleep(300);
    r.video_sin_camara.estado = states[states.length - 1] || null;
    m.stop();
  }
  // 3. Girar la cámara y colgar antes de que abra la otra
  {
    const e = env({ vp8: true, gumDelay: (n) => (n <= 1 ? 0 : 400) });
    const m = mk(e, { video: true, onVideoPacket() {} });
    await m.start();
    const f = m.flip(); await sleep(50); m.stop(); await f; await sleep(50);
    r.girar_y_colgar = { camaras_encendidas: e.live('video'), micros_abiertos: e.live('audio') };
  }
  // 4. Dos toques seguidos en "Girar"
  {
    const e = env({ vp8: true, gumDelay: (n) => (n <= 1 ? 0 : 300) });
    const m = mk(e, { video: true, onVideoPacket() {} });
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
    const m = mk(e);
    await m.start();
    const pk = () => { const p = new Uint8Array(4 + 800); p[0] = 2; p[1] = 1; p[2] = 800 >> 8; p[3] = 800 & 255; p.fill(0xff, 4); return p; };
    for (let i = 0; i < 20; i++) m.play(pk(), i);
    const iv = e.starts.map((s) => [s.t, s.t + s.d]);
    let maxAtOnce = iv.length ? 1 : 0;
    for (let i = 0; i < iv.length; i++) { let c = 1; for (let j = 0; j < iv.length; j++) if (j !== i && iv[j][0] < iv[i][1] - 1e-9 && iv[j][1] > iv[i][0] + 1e-9) c++; maxAtOnce = Math.max(maxAtOnce, c); }
    r.rafaga = { suenan: iv.length, a_la_vez_max: maxAtOnce };
    m.stop();
  }
  // --- 2769 ---
  // 6. Cámara ocupada un momento al empezar (p. ej. aún soltándose de la llamada anterior): 2 intentos fallan
  {
    const e = env({ vp8: true, camFail: (n) => (n <= 2 ? 'NotReadableError' : null) });
    const sent = [];
    const m = mk(e, { video: true, onVideoPacket: (b) => sent.push(b) });
    const i = await m.start().catch(() => ({}));
    await sleep(1200);
    r.camara_ocupada_un_momento = { video: !!i.video, imagenes_enviadas: sent.length, micros: e.live('audio') };
    m.stop();
  }
  // 7. Cámara ocupada ~5 s: se empieza con voz y entra el vídeo cuando la cámara se libera
  {
    const e = env({ vp8: true, camFail: (n, ms) => (ms < 5000 ? 'NotReadableError' : null) });
    const sent = [], states = [];
    const m = mk(e, { video: true, onVideoPacket: (b) => sent.push(b), onState: (s) => states.push(s && s.cam) });
    const i = await m.start().catch(() => ({}));
    const voz = e.live('audio');
    const t = await until(() => sent.length > 0, 14000);
    r.camara_ocupada_5s = { al_empezar_video: !!i.video, voz_al_empezar: voz, video_entra_ms: t, estados: states.filter((x, k) => x !== states[k - 1]) };
    m.stop();
  }
  // 8. Micrófono ocupado al empezar (otra app lo soltaba): el primer intento falla
  {
    const e = env({ micFail: (n) => (n === 1 ? 'NotReadableError' : null) });
    const packets = [];
    const m = mk(e, { onPacket: (b) => { if (b.length > 2) packets.push(b); } }); // (los de 2 bytes son "sigo aquí", sin voz)
    const st = await m.start().then(() => 'ok', (er) => 'error ' + er.message);
    await sleep(100);
    const ctx = e.ctxs[e.ctxs.length - 1];
    if (ctx && ctx.proc && ctx.proc.onaudioprocess) for (let k = 0; k < 10; k++) ctx.proc.onaudioprocess({ inputBuffer: { getChannelData: () => new Float32Array(2048).fill(0.1) } });
    await sleep(200);
    r.micro_ocupado_un_momento = { empieza: st, micros: e.live('audio'), voz_enviada: packets.length };
    m.stop();
  }
  // 9. El sistema corta la cámara en plena llamada (otra app, segundo plano y vuelta): se vuelve a abrir sola
  {
    const e = env({ vp8: true });
    const sent = [];
    const m = mk(e, { video: true, onVideoPacket: (b) => sent.push(b) });
    await m.start();
    await sleep(600);
    const cam = e.tracks.find((t) => t.kind === 'video' && t.readyState === 'live');
    if (cam) e.endTrack(cam);
    const n0 = sent.length;
    await sleep(200);
    const n1 = sent.length;
    const t = await until(() => sent.length > n1 + 3, 6000);
    r.camara_cortada = { imagenes_antes: n0, vuelve_ms: t, camaras_vivas: e.live('video') };
    m.stop();
  }
  // 10. Cámara abierta pero sin imágenes (el <video> no arranca): se reanuda y, si no, se vuelve a abrir
  {
    const e = env({ vp8: true, stuckCam: (n) => n === 1 });
    const sent = [];
    const m = mk(e, { video: true, onVideoPacket: (b) => sent.push(b) });
    await m.start();
    const t = await until(() => sent.length > 3, 10000);
    r.camara_sin_imagenes = { imagenes_ms: t, camaras_vivas: e.live('video') };
    m.stop();
  }
  // 11. Audio en pausa al empezar (el primer resume() no basta): se insiste
  {
    const e = env({ suspended: true });
    const m = mk(e);
    await m.start();
    const t = await until(() => e.ctxs[0] && e.ctxs[0].state === 'running', 5000);
    r.audio_en_pausa = { reanudado_ms: t, intentos: e.ctxs[0] ? e.ctxs[0].resumes : 0 };
    m.stop();
  }
  // 12. Falla el codificador de vídeo a media llamada: se rehace
  {
    const e = env({ vp8: true, encErrAfter: 8 });
    const sent = [];
    const m = mk(e, { video: true, onVideoPacket: (b) => sent.push(b) });
    await m.start();
    await sleep(1200);
    const n1 = sent.length;
    const t = await until(() => sent.length > n1 + 5, 4000);
    r.codificador_falla = { imagenes_antes: n1, sigue_ms: t };
    m.stop();
  }
  // 13. Falla el decodificador del otro (imagen dañada): antes quedaba cerrado y en negro hasta colgar
  {
    const e = env({ vp8: true, decErrAt: 3 });
    let keyReq = 0;
    const m = mk(e, { onNeedKey: () => keyReq++ });
    m.playVideo(vpk(true)); m.playVideo(vpk(false)); m.playVideo(vpk(false)); // la 3.ª falla
    await sleep(50);
    const before = e.decoded.length;
    for (let k = 0; k < 4; k++) { m.playVideo(vpk(false)); await sleep(20); }
    m.playVideo(vpk(true)); for (let k = 0; k < 4; k++) { m.playVideo(vpk(false)); await sleep(20); }
    r.decodificador_falla = { imagenes_tras_el_fallo: e.decoded.length - before, pide_imagen_completa: keyReq };
    m.stop();
  }
  // 14. Llega vídeo pero sin imagen completa (se perdió): se pide al otro enseguida
  {
    const e = env({ vp8: true });
    let keyReq = 0;
    const m = mk(e, { onNeedKey: () => keyReq++ });
    for (let k = 0; k < 10; k++) { m.playVideo(vpk(false)); await sleep(100); }
    r.sin_imagen_completa = { pide_imagen_completa: keyReq };
    m.stop();
  }
  // 15. El otro pide una imagen completa: la siguiente que sale lo es
  {
    const e = env({ vp8: true });
    const m = mk(e, { video: true, onVideoPacket() {} });
    await m.start();
    await sleep(300);
    const n0 = e.encoded.length;
    if (typeof m.requestKey === 'function') m.requestKey();
    await sleep(200);
    r.pedir_imagen_completa = { siguiente_completa: !!(e.encoded[n0] && e.encoded[n0].key) };
    m.stop();
  }
  // 16. Falla el codificador de voz (Opus) a media llamada: se rehace (antes quedaba cerrado: sin voz hasta colgar)
  {
    const e = env({ opus: true, aEncErrAfter: 5 });
    const packets = [];
    const m = mk(e, { codecs: 'opus,ulaw', onPacket: (b) => { if (b.length > 2) packets.push(b); } }); // (los de 2 bytes son "sigo aquí")
    const i = await m.start().catch(() => ({}));
    const ctx = e.ctxs[e.ctxs.length - 1];
    const feed = async (n) => { for (let k = 0; k < n; k++) { if (ctx && ctx.proc && ctx.proc.onaudioprocess) ctx.proc.onaudioprocess({ inputBuffer: { getChannelData: () => new Float32Array(2048).fill(0.1) } }); await sleep(43); } };
    await feed(10); // el 5.º bloque falla
    const n1 = packets.length;
    await feed(50); // ~2 s más de voz
    r.opus_falla = { codec: i.codec || null, voz_antes: n1, voz_despues: packets.length - n1, codificadores: e.window._aencs || 0 };
    m.stop();
  }
  // 17. Falla el decodificador de voz (lo que llega del otro): con el siguiente paquete se rehace
  {
    const e = env({ opus: true, aDecErrAt: 3 });
    const m = mk(e, { codecs: 'opus,ulaw' });
    await m.start().catch(() => ({}));
    const pk = () => { const p = new Uint8Array(4 + 40); p[0] = 1; p[1] = 1; p[2] = 0; p[3] = 40; p.fill(3, 4); return p; };
    for (let k = 0; k < 3; k++) { m.play(pk()); await sleep(20); } // el 3.º falla
    const n0 = e.starts.length;
    for (let k = 0; k < 5; k++) { m.play(pk()); await sleep(20); }
    r.opus_recibir_falla = { suenan_tras_el_fallo: e.starts.length - n0, decodificadores: e.window._adecs || 0 };
    m.stop();
  }
  // 18. Sin micrófono (permiso quitado): la llamada sigue, sale un "sigo aquí" sin voz cada ~2 s y el estado lo dice
  {
    const e = env({ micFail: () => 'NotAllowedError' });
    const packets = [], states = [];
    const m = mk(e, { onPacket: (b) => packets.push({ n: b.length, at: Date.now() }), onState: (s) => states.push(s && s.mic) });
    const i = await m.start().then((x) => x, () => null);
    await sleep(5500);
    const vacios = packets.filter((x) => x.n <= 2);
    const gaps = vacios.slice(1).map((x, k) => x.at - vacios[k].at);
    r.sin_micro = { empieza: !!i, mic: i ? i.mic : null, estado: states[states.length - 1] || null, sigo_aqui: vacios.length, hueco_max_ms: gaps.length ? Math.max(...gaps) : null, micros: e.live('audio') };
    m.stop();
  }
  // 19. El codificador de vídeo falla siempre (teléfono con el codificador roto): se rehace como mucho una vez por segundo y
  //     el registro no se llena (antes, unas 7 por segundo y un aviso por cada una); la voz sigue
  {
    const e = env({ vp8: true, encErrAlways: true });
    const warns = [], ow = console.warn;
    console.warn = (...a) => { warns.push(a.join(' ')); };
    const m = mk(e, { video: true, onVideoPacket() {} });
    const i = await m.start().catch(() => ({}));
    const n0 = e.window._encs || 0;
    await sleep(3000);
    console.warn = ow;
    r.codificador_siempre_falla = { empieza: !!i.codec, codificadores_en_3s: (e.window._encs || 0) - n0, avisos: warns.filter((w) => /codificar/.test(w)).length, micros: e.live('audio') };
    m.stop();
  }
  // 20. Llega vídeo pero el decodificador se queda parado (no da imágenes): a los 3 s se pide una imagen completa y, si
  //     sigue, a los 6 s un decodificador nuevo (con la siguiente imagen completa, ya se ve)
  {
    const e = env({ vp8: true, decSilent: true });
    let keyReq = 0;
    const m = mk(e, { onNeedKey: () => keyReq++ });
    await m.start().catch(() => ({}));
    const t0 = Date.now();
    let keyAt = null, n = 0;
    while (Date.now() - t0 < 8500) { m.playVideo(vpk(n % 30 === 0)); n++; if (keyReq && keyAt === null) keyAt = Date.now() - t0; await sleep(66); }
    r.decodificador_parado = { pide_completa_ms: keyAt, decodificadores: e.window._decs || 0, se_ve: e.decoded.length > 0, en_vivo: typeof m.remoteLive === 'function' ? m.remoteLive() : null };
    m.stop();
  }
  // --- 2772 ---
  // 21. Girar el teléfono en plena videollamada: la imagen de la cámara pasa de vertical (480x640) a apaisada (640x480):
  //     codificador nuevo con la forma nueva (antes siempre 320x240: recortada o estirada) y la siguiente imagen completa
  {
    const e = env({ vp8: true });
    const m = mk(e, { video: true, onVideoPacket() {} });
    await m.start();
    const vid = e.videos[e.videos.length - 1];
    vid.videoWidth = 480; vid.videoHeight = 640;
    await sleep(400);
    const cfg1 = (e.window._cfgs || []).slice(-1)[0] || {};
    const n0 = e.encoded.length;
    vid.videoWidth = 640; vid.videoHeight = 480;
    await sleep(400);
    const cfg2 = (e.window._cfgs || []).slice(-1)[0] || {};
    r.girar_telefono = { vertical: cfg1.width + 'x' + cfg1.height, apaisada: cfg2.width + 'x' + cfg2.height, siguiente_completa: !!(e.encoded[n0] && e.encoded[n0].key), tiempo_real: cfg2.latencyMode || null };
    m.stop();
  }
  // 22. Eco en la llamada: suena la voz del otro (μ-law, como la manda su teléfono) y vuelve al micrófono a los 80 ms con
  //     la mitad de fuerza (altavoz). Con los filtros de voz (call_voice_fx.js), lo que se manda baja al menos 10 dB
  //     frente a la misma llamada sin filtros; desde los 5 s uno habla a la vez y su voz pasa (como mucho −6 dB).
  {
    const fxFile = path.join(path.resolve(process.argv[2]), 'src', 'ui', 'call_voice_fx.js');
    const fxMod = fs.existsSync(fxFile) ? new Function(fs.readFileSync(fxFile, 'utf8').replace(/^export /gm, '') + '\nreturn { createVoiceFx };')() : null;
    const ulawEnc = (x) => { x = Math.max(-1, Math.min(1, x)) * 32635; const sign = x < 0 ? 0x80 : 0; if (sign) x = -x; x += 132; let ex = 7; for (let mk2 = 0x4000; (x & mk2) === 0 && ex > 0; mk2 >>= 1) ex--; return ~(sign | (ex << 4) | ((x >> (ex + 3)) & 0x0f)) & 0xff; };
    const ulawDec = (u) => { u = ~u & 0xff; const sign = u & 0x80, ex = (u >> 4) & 7, man = u & 0x0f; let x = ((man << 3) + 132) << ex; x -= 132; return (sign ? -x : x) / 32635; };
    // Voz sintética con sílabas al azar (como voicefx.js)
    const voice = (f0, amp, seed) => {
      let x = Math.floor(seed * 1e6) % 2147483646 + 1; const rnd = () => (x = (x * 48271) % 2147483647) / 2147483647; const segs = [];
      for (let t = 0; t < 30;) { const d = 0.08 + 0.22 * rnd(), on = rnd() > 0.25; segs.push([t, t + d, on ? 0.5 + 0.5 * rnd() : 0]); t += d; }
      return (t) => { if (t < 0) return 0; const g = segs.find((q) => t >= q[0] && t < q[1]); if (!g || !g[2]) return 0; const env1 = g[2] * Math.sin(Math.PI * (t - g[0]) / (g[1] - g[0])); let sm = 0; for (let k = 1; k <= 12; k++) sm += Math.sin(2 * Math.PI * f0 * k * t + k * seed) / k; return amp * 0.6 * sm * env1; };
    };
    const echoCall = async (withFx) => {
      const e = env({ clock: true });
      const sent = [];
      const m = mk(e, { onPacket: (b) => sent.push({ at: Date.now(), b }), voiceFx: withFx && fxMod ? fxMod.createVoiceFx : undefined });
      await m.start();
      const ctx = e.ctxs[e.ctxs.length - 1];
      const T0 = Date.now(), farV = voice(140, 0.5, 0.31), nearV = voice(220, 0.4, 0.77), NEAR_AT = 5;
      // Lo que sonaba en el altavoz en el instante τ (reloj del audio): de lo que call_media.js programó de verdad
      const played = (tau) => { for (let i = e.starts.length - 1; i >= 0; i--) { const q = e.starts[i]; if (q.t <= tau && tau < q.t + q.d && q.buf && q.buf.data) return q.buf.data[Math.floor((tau - q.t) * q.buf.rate)] || 0; } return 0; };
      let farT = 0, nearE = 0, nearN = 0;
      while (Date.now() - T0 < 9000) {
        const el = (Date.now() - T0) / 1000;
        while (farT <= el + 0.1) { const pk = new Uint8Array(804); pk[0] = 2; pk[1] = 1; pk[2] = 800 >> 8; pk[3] = 800 & 255; for (let i = 0; i < 800; i++) pk[4 + i] = ulawEnc(farV(farT + i / 8000)); m.play(pk); farT += 0.1; }
        const now = ctx.currentTime, inp = new Float32Array(2048);
        for (let i = 0; i < 2048; i++) { const w = el - (2048 - i) / 48000, nv = w >= NEAR_AT ? nearV(w) : 0; inp[i] = 0.5 * played(now - (2048 - i) / 48000 - 0.08) + nv; if (w >= NEAR_AT + 0.5) { nearE += nv * nv; nearN++; } }
        ctx.proc.onaudioprocess({ inputBuffer: { getChannelData: () => inp } });
        await sleep(43);
      }
      m.stop();
      const lvl = (a, b) => { let e2 = 0, n = 0; sent.forEach((x) => { const t = (x.at - T0) / 1000; if (t < a || t >= b) return; const p = e.mod.unpackCallPacket(x.b); if (!p || p.codec !== 2) return; p.frames.forEach((f) => { for (let i = 0; i < f.length; i++) { const v2 = ulawDec(f[i]); e2 += v2 * v2; n++; } }); }); return Math.sqrt(e2 / (n || 1)); };
      return { eco: lvl(2, 5), ambos: lvl(NEAR_AT + 0.5, 9), voz: Math.sqrt(nearE / (nearN || 1)) };
    };
    const sinF = await echoCall(false), conF = await echoCall(true);
    const dbr = (a, b) => (a > 0 && b > 0 ? Math.round(20 * Math.log10(a / b) * 10) / 10 : null);
    r.eco_en_llamada = { filtros: !!fxMod, eco_baja_dB: dbr(sinF.eco, conF.eco), voz_propia_dB: dbr(conF.ambos, conF.voz) };
  }
  const c1 = r.colgar_mientras_abre_el_micro, v = r.video_sin_camara, p6 = r.camara_ocupada_un_momento, p7 = r.camara_ocupada_5s;
  const checks = {
    colgar_mientras_abre_el_micro: c1.micros_abiertos === 0 && c1.audio_abierto === 0 && c1.voz_tras_colgar === 0,
    video_sin_camara: v.empieza && v.micros >= 1 && !v.video && v.estado === 'none',
    girar_y_colgar: r.girar_y_colgar.camaras_encendidas === 0 && r.girar_y_colgar.micros_abiertos === 0,
    girar_dos_veces: r.girar_dos_veces.camaras_a_la_vez <= 1 && r.girar_dos_veces.camaras_tras_colgar === 0,
    rafaga: r.rafaga.suenan >= 1 && r.rafaga.a_la_vez_max === 1,
    camara_ocupada_un_momento: p6.video && p6.imagenes_enviadas > 3 && p6.micros >= 1,
    camara_ocupada_5s: !p7.al_empezar_video && p7.voz_al_empezar >= 1 && p7.video_entra_ms !== null && p7.estados.indexOf('retry') >= 0 && p7.estados[p7.estados.length - 1] === 'on',
    micro_ocupado_un_momento: r.micro_ocupado_un_momento.empieza === 'ok' && r.micro_ocupado_un_momento.micros >= 1 && r.micro_ocupado_un_momento.voz_enviada > 0,
    camara_cortada: r.camara_cortada.vuelve_ms !== null && r.camara_cortada.camaras_vivas === 1,
    camara_sin_imagenes: r.camara_sin_imagenes.imagenes_ms !== null && r.camara_sin_imagenes.camaras_vivas === 1,
    audio_en_pausa: r.audio_en_pausa.reanudado_ms !== null,
    codificador_falla: r.codificador_falla.sigue_ms !== null,
    decodificador_falla: r.decodificador_falla.imagenes_tras_el_fallo > 0 && r.decodificador_falla.pide_imagen_completa > 0,
    sin_imagen_completa: r.sin_imagen_completa.pide_imagen_completa > 0,
    pedir_imagen_completa: r.pedir_imagen_completa.siguiente_completa,
    opus_falla: r.opus_falla.codec === 'opus' && r.opus_falla.voz_antes > 0 && r.opus_falla.voz_despues > 5 && r.opus_falla.codificadores >= 2,
    opus_recibir_falla: r.opus_recibir_falla.suenan_tras_el_fallo >= 4 && r.opus_recibir_falla.decodificadores >= 2,
    codificador_siempre_falla: r.codificador_siempre_falla.empieza && r.codificador_siempre_falla.codificadores_en_3s <= 4 && r.codificador_siempre_falla.avisos <= 5 && r.codificador_siempre_falla.micros >= 1,
    decodificador_parado: r.decodificador_parado.pide_completa_ms !== null && r.decodificador_parado.pide_completa_ms < 4500 && r.decodificador_parado.decodificadores >= 2 && r.decodificador_parado.se_ve && r.decodificador_parado.en_vivo === true,
    girar_telefono: r.girar_telefono.vertical === '360x480' && r.girar_telefono.apaisada === '480x360' && r.girar_telefono.siguiente_completa,
    eco_en_llamada: r.eco_en_llamada.eco_baja_dB >= 9 && r.eco_en_llamada.voz_propia_dB >= -6,
    sin_micro: r.sin_micro.empieza && r.sin_micro.mic === false && r.sin_micro.estado === 'none' && r.sin_micro.sigo_aqui >= 2 && r.sin_micro.hueco_max_ms !== null && r.sin_micro.hueco_max_ms < 3500,
  };
  r.fallan = Object.keys(checks).filter((k) => !checks[k]);
  r.resultado = r.fallan.length ? 'FALLO' : 'OK';
  console.log('CALLMEDIA ' + JSON.stringify(r));
  process.exit(r.fallan.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
