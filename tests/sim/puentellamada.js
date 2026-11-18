// 3217 «UNIR» con MI teléfono de PUENTE (dueño 17-11 19:25: su caso real son amigos que llaman cada uno desde su casa, por internet;
// la llamada de grupo de 3216 es malla —Bluetooth o el mismo Wi-Fi— y ahí decía «No se pueden unir…»). Las dos llamadas 1-a-1 siguen
// por su camino y mi teléfono le manda a cada uno mi micrófono + la voz del otro (nunca la suya).
// Parte 1 — la MEZCLA de verdad (src/ui/call_media.js + call_bridge.js, WebAudio falso como callmedia.js, μ-law): A habla en 440 Hz,
// B en 700 Hz, yo en 1000 Hz; se mide cada tono (Goertzel) en lo que sale hacia cada uno:
//  M1  hacia B salen mi voz y la de A; hacia A, la mía y la de B; ninguno recibe su propia voz (sin eco);
//  M2  silenciado yo: A y B se siguen oyendo entre ellos (mi voz no sale);
//  M3  terminado el puente (uno cuelga): al otro ya no le llega nada del que se fue (la mezcla se suelta).
// Parte 2 — la app entera (jsdom + native_mock), Y (yo), A y B LEJOS (sin Bluetooth) y POR INTERNET (relés de prueba y conexión
// directa con un RTCPeerConnection falso, como callp2p.js):
//  P1  Y habla con A y le llama B: «Unir a esta llamada» está activo (antes, apagado: «No se pueden unir: … por internet») y al tocarlo
//      las dos siguen como 1-a-1, las dos en curso, sin espera ni llamada de grupo;
//  P2  la voz cruza: A recibe la de B y B la de A (a través de Y) y nadie recibe la suya (sin eco); Y oye a los dos;
//  P3  pantallas: Y ve UNA llamada «A y B» (sin la de abajo, sin «En espera» ni «Unir»); A ve «Y y B» y «B se unió a la llamada»; B ve
//      «Y y A» y «A se unió a la llamada»;
//  P4  Y se silencia: se silencia en las dos y A y B se siguen oyendo;
//  P5  A cuelga: B sigue con Y en su 1-a-1 normal (se oyen; a B ya no le llega A; «A salió de la llamada» en B y en Y; sin puente);
//  P6  otra vez unidas, Y cuelga: se acaba todo (A y B sin llamada) y no queda puente.
// Uso: node puentellamada.js <dir_build>
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone, installWebCrypto } = require('./native_mock');
const { NostrRelay } = require('./nostr_relay');
const { importSrc } = require('./srcmod');

const buildDir = path.resolve(process.argv[2]);
const base = { readsContentFallback: true, retain: ['onPayloadReceived', 'onLanMessage', 'onLanUp', 'onLanDown', 'onWifiDirectReceived'], closeOnNoService: true, pace: [15, 15], ioDelay: 25, asymmetric: true, noTor: true, wifiDirect: true };
let RELAYS = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const _n = (x) => (x || '').toString().toLowerCase().trim();
class DL extends ResourceLoader { constructor(d) { super(); this.d = d; } fetch(u) { const f = path.join(this.d, decodeURIComponent(new URL(u).pathname)); return fs.existsSync(f) ? Promise.resolve(fs.readFileSync(f)) : Promise.reject(new Error('x')); } }
const logs = [];
const T0 = Date.now();
const ts = () => String(((Date.now() - T0) / 1000).toFixed(1)).padStart(6) + 's';
async function waitFor(fn, ms) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return Math.round((Date.now() - t0) / 100) / 10; await sleep(200); } return null; }

// ───────────────────────── Parte 1: la mezcla de verdad ─────────────────────────
function ulawEnc(s) { let x = Math.max(-1, Math.min(1, s)) * 32635; const sign = x < 0 ? 0x80 : 0; if (sign) x = -x; x += 132; let exp = 7; for (let m = 0x4000; (x & m) === 0 && exp > 0; m >>= 1) exp--; const man = (x >> (exp + 3)) & 0x0f; return ~(sign | (exp << 4) | man) & 0xff; }
function ulawDec(u) { u = ~u & 0xff; const sign = u & 0x80, exp = (u >> 4) & 7, man = u & 0x0f; let x = ((man << 3) + 132) << exp; x -= 132; return (sign ? -x : x) / 32635; }
// amplitud de un tono en una señal (Goertzel)
function tone(x, f, rate) { const k = 2 * Math.cos(2 * Math.PI * f / rate); let s1 = 0, s2 = 0; for (let i = 0; i < x.length; i++) { const s0 = x[i] + k * s1 - s2; s2 = s1; s1 = s0; } const p = s1 * s1 + s2 * s2 - k * s1 * s2; return x.length ? 2 * Math.sqrt(Math.max(0, p)) / x.length : 0; }
function mediaEnv() {
  const ctxs = [];
  class FakeStream { constructor(t) { this.ts = (t || []).slice(); } getTracks() { return this.ts.slice(); } getAudioTracks() { return this.ts.filter((t) => t.kind === 'audio'); } getVideoTracks() { return this.ts.filter((t) => t.kind === 'video'); } removeTrack(t) { this.ts = this.ts.filter((x) => x !== t); } addTrack(t) { this.ts.push(t); } }
  const mkTrack = (kind) => ({ kind, readyState: 'live', enabled: true, muted: false, stop() { this.readyState = 'ended'; }, addEventListener() {}, getSettings() { return {}; }, getCapabilities() { return {}; } });
  const navigator = { mediaDevices: { getUserMedia(c) { return Promise.resolve(new FakeStream(c.audio ? [mkTrack('audio')] : [])); } } };
  class AC {
    constructor() { this.state = 'running'; this.destination = {}; this.currentTime = 10; ctxs.push(this); }
    createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
    createScriptProcessor() { const p = { onaudioprocess: null, connect() {}, disconnect() {} }; this.proc = p; return p; }
    createBuffer(ch, n, rate) { const d = new Float32Array(n); return { duration: n / rate, copyToChannel(f) { d.set(f); }, getChannelData() { return d; } }; }
    createBufferSource() { return { buffer: null, connect() {}, start() {} }; }
    resume() { return Promise.resolve(); }
    close() { this.state = 'closed'; return Promise.resolve(); }
  }
  const document = { visibilityState: 'visible', createElement() { return { getContext() { return {}; } }; } };
  const window = { AudioContext: AC, MediaStream: FakeStream };
  const src = fs.readFileSync(path.join(buildDir, 'src', 'ui', 'call_media.js'), 'utf8').replace(/^export /gm, '');
  const mod = new Function('window', 'navigator', 'document', 'MediaStream', src + '\nreturn { createCallMedia, unpackCallPacket };')(window, navigator, document, FakeStream);
  return { mod, ctxs };
}
async function mezcla(r) {
  const { mod, ctxs } = mediaEnv();
  let bridge = null;
  try { bridge = await importSrc('ui/call_bridge.js'); } catch (e) { r.sin_call_bridge = String(e && e.message).slice(0, 80); }
  const out = { A: [], B: [] };
  const MA = mod.createCallMedia({ onPacket: (p) => out.A.push(p), codecs: 'ulaw' }); await MA.start();
  const MB = mod.createCallMedia({ onPacket: (p) => out.B.push(p), codecs: 'ulaw' }); await MB.start();
  const pA = ctxs[0].proc, pB = ctxs[1].proc;
  const sigs = [];
  const lane = (id, nx, m) => ({ call: { id, nx, state: 'active', dir: 'out', media: m }, _signal(to, op, ex) { sigs.push({ to, op, ex }); }, _set() {}, hangup() { this.call = null; } });
  const lA = lane('clpa', 'nxa0000001', MA), lB = lane('clpb', 'nxb0000002', MB), ble = { _bridge: null };
  if (bridge && typeof MA.setTap === 'function') await bridge.startBridge(ble, [lA, lB], (nx) => nx.slice(0, 3).toUpperCase());
  r.M_conf = sigs.map((s) => s.op + '>' + s.to.slice(0, 3) + ':' + ((s.ex && s.ex.who) || []).map((w) => w.n).join(','));
  // un rato de llamada: cada 100 ms llega un paquete de A (440 Hz) y uno de B (700 Hz) y mi micrófono (1000 Hz) graba 100 ms
  let tA = 0, tB = 0, tM = 0, acc = 0;
  const pkt = (f, ph) => { const n = 800, b = new Uint8Array(4 + n); b[0] = 2; b[1] = 1; b[2] = n >> 8; b[3] = n & 255; for (let i = 0; i < n; i++) b[4 + i] = ulawEnc(0.3 * Math.sin(2 * Math.PI * f * (ph + i) / 8000)); return b; };
  function run(ticks, opt) {
    for (let k = 0; k < ticks; k++) {
      if (!opt.noA) MA.play(pkt(440, tA)); tA += 800;
      MB.play(pkt(700, tB)); tB += 800;
      acc += 4800;
      while (acc >= 2048) {
        const blk = new Float32Array(2048); for (let i = 0; i < 2048; i++) blk[i] = 0.3 * Math.sin(2 * Math.PI * 1000 * (tM + i) / 48000); tM += 2048; acc -= 2048;
        [pA, pB].forEach((p) => p.onaudioprocess({ inputBuffer: { getChannelData: () => blk } }));
      }
    }
  }
  // por paquete (100 ms): el codificador μ-law junta 6 muestras y deja 2 de cada bloque de 2048 (2048 no es múltiplo de 6), así que en
  // una ventana larga el tono se corre un poco; en 100 ms no importa
  const frames = (list) => { const fs2 = []; list.forEach((p) => { const u = mod.unpackCallPacket(p); if (u && u.codec === 2) u.frames.forEach((f) => fs2.push(Float32Array.from(f, ulawDec))); }); return fs2; };
  const avg = (fs2, f) => fs2.length ? fs2.reduce((s, x) => s + tone(x, f, 8000), 0) / fs2.length : 0;
  const tonos = (list) => { const fs2 = frames(list); return { a440: +avg(fs2, 440).toFixed(3), b700: +avg(fs2, 700).toFixed(3), yo1000: +avg(fs2, 1000).toFixed(3) }; };
  run(4, {}); out.A.length = 0; out.B.length = 0; // (el colchón de 150 ms)
  run(20, {});
  r.M1_hacia_B = tonos(out.B); r.M1_hacia_A = tonos(out.A);
  r.M1_ok = r.M1_hacia_B.a440 > 0.08 && r.M1_hacia_B.yo1000 > 0.08 && r.M1_hacia_B.b700 < 0.02 && r.M1_hacia_A.b700 > 0.08 && r.M1_hacia_A.yo1000 > 0.08 && r.M1_hacia_A.a440 < 0.02;
  MA.mute(true); MB.mute(true); run(2, {}); out.A.length = 0; out.B.length = 0; run(10, {}); // (lo grabado antes de silenciar ya salió)
  r.M2_silenciado = { hacia_B: tonos(out.B), hacia_A: tonos(out.A) };
  r.M2_ok = r.M2_silenciado.hacia_B.a440 > 0.08 && r.M2_silenciado.hacia_A.b700 > 0.08 && r.M2_silenciado.hacia_B.yo1000 < 0.02 && r.M2_silenciado.hacia_A.yo1000 < 0.02;
  MA.mute(false); MB.mute(false);
  // A cuelga: termina el puente; a B ya no le llega A (aunque quedara algo en la cola)
  if (ble._bridge) { lA.call = null; MA.stop(); ble._bridge.laneEnded(lA); }
  run(2, { noA: true }); out.B.length = 0; run(10, { noA: true }); // (lo que ya estaba en el paquete a medias ya salió)
  r.M3_tras_colgar_A = tonos(out.B);
  r.M3_ok = r.M3_tras_colgar_A.a440 < 0.02 && r.M3_tras_colgar_A.yo1000 > 0.08 && !ble._bridge && sigs.some((s) => s.op === 'conf' && s.to === 'nxb0000002' && s.ex && Array.isArray(s.ex.who) && !s.ex.who.length);
  try { MA.stop(); MB.stop(); } catch (e) {}
}

// ───────────────────────── Parte 2: la app entera, por internet ─────────────────────────
class NoNetWS { constructor(u) { this.url = u; this.readyState = 0; setTimeout(() => { this.readyState = 3; if (this.onerror) this.onerror({}); if (this.onclose) this.onclose({}); }, 30); } send() { throw new Error('sin red'); } close() {} }
const FAKE = { reg: new Map(), block: false, msgs: 0 };
function makeRTC() {
  return class FakePC {
    constructor() { this.id = Math.random().toString(36).slice(2, 10); this.iceGatheringState = 'new'; this.connectionState = 'new'; this.localDescription = null; this.dc = null; FAKE.reg.set(this.id, this); }
    createDataChannel() { this.dc = new FakeDC(this); return this.dc; }
    createOffer() { return Promise.resolve({ type: 'offer', sdp: 'v=0 fake-offer ' + this.id }); }
    createAnswer() { return Promise.resolve({ type: 'answer', sdp: 'v=0 fake-answer ' + this.id + ' ' + this.peerId }); }
    setLocalDescription(d) { this.localDescription = d; setTimeout(() => { this.iceGatheringState = 'complete'; if (this.onicegatheringstatechange) this.onicegatheringstatechange(); }, 50); return Promise.resolve(); }
    setRemoteDescription(d) {
      const m = /fake-(offer|answer) (\w+)/.exec(d.sdp || ''); if (!m) return Promise.reject(new Error('sdp'));
      this.peerId = m[2];
      if (d.type === 'answer' && !FAKE.block) {
        const other = FAKE.reg.get(this.peerId);
        if (other && this.dc) { const theirs = new FakeDC(other); this.dc.peer = theirs; theirs.peer = this.dc; setTimeout(() => { if (other.ondatachannel) other.ondatachannel({ channel: theirs }); setTimeout(() => { this.dc.open(); theirs.open(); }, 50); }, 300); }
      }
      return Promise.resolve();
    }
    close() { this.connectionState = 'closed'; if (this.dc) this.dc.close(); FAKE.reg.delete(this.id); }
  };
}
class FakeDC {
  constructor(pc) { this.pc = pc; this.readyState = 'connecting'; this.bufferedAmount = 0; this.peer = null; }
  open() { if (this.readyState !== 'connecting') return; this.readyState = 'open'; if (this.onopen) this.onopen(); }
  send(s) { if (this.readyState !== 'open') throw new Error('cerrado'); FAKE.msgs++; const p = this.peer; setTimeout(() => { if (p && p.readyState === 'open' && p.onmessage) p.onmessage({ data: s }); }, 5); }
  close() { if (this.readyState === 'closed') return; this.readyState = 'closed'; if (this.onclose) this.onclose(); if (this.peer) this.peer.close(); }
}
async function boot(name, native) {
  native.listeners = new Map();
  native.calls = { push() {}, length: 0, filter() { return []; }, slice() { return []; }, forEach() {}, map() { return []; }, some() { return false; }, find() { return undefined; } };
  const vc = new VirtualConsole();
  ['log', 'warn', 'error'].forEach((l) => vc.on(l, (...a) => logs.push(`${ts()} [${name}] ${l}: ` + a.map(String).join(' ').substring(0, 260))));
  const media = { played: [], sent: 0, stopped: 0, taps: [] };
  const dom = new JSDOM(fs.readFileSync(path.join(buildDir, 'dist', 'index.html'), 'utf8'), {
    url: 'https://' + name.toLowerCase() + '.nexo.test/index.html', runScripts: 'dangerously', resources: new DL(path.join(buildDir, 'dist')), pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) {
      win.NEXO_NET_RELAYS = RELAYS; win.CapacitorCustomPlatform = { name: 'android' }; installWebCrypto(win);
      win.Capacitor = { Plugins: { NexoBLE: native.plugin() } }; win.HTMLElement.prototype.scrollTo = function () {};
      win.NEXO_CALL_RING_MS = 40000; win.NEXO_FORCE_LANG = 'es';
      win.RTCPeerConnection = makeRTC();
      // voz de prueba: cada 100 ms un paquete [quién habla][nº][lo que se le mezcló (hasta 4)]; silenciado, «_». Lo que llega se
      // «decodifica» (quién habló + lo mezclado) y, con el puente, se pasa como la «voz» de la otra llamada (setTap / mixIn)
      win.NEXO_callMediaFactory = (o) => {
        let t = null, n = 0, tap = null, q = [], muted = false;
        return {
          opts: o,
          start() { t = setInterval(() => { const f = new Uint8Array(42); f[0] = muted ? 95 : name.charCodeAt(0); f[1] = (n >> 8) & 255; f[2] = n & 255; const mx = q.shift() || []; for (let i = 0; i < 4; i++) f[3 + i] = mx[i] || 0; f.fill(0x5a, 7); n++; media.sent++; const p = new Uint8Array(4 + f.length); p[0] = 1; p[1] = 1; p[2] = 0; p[3] = f.length; p.set(f, 4); o.onPacket(p); }, 100); return Promise.resolve({ codec: 'opus', video: false }); },
          play(bytes) {
            if (bytes.length <= 10) return;
            const voices = [bytes[4], bytes[7], bytes[8], bytes[9], bytes[10]].filter((c) => c && c !== 95);
            media.played.push({ from: String.fromCharCode(bytes[4]), mixed: [bytes[7], bytes[8], bytes[9], bytes[10]].filter(Boolean).map((c) => String.fromCharCode(c)), at: Date.now() });
            if (tap && voices.length) tap(Float32Array.from(voices), 48000);
          },
          setTap(fn) { tap = typeof fn === 'function' ? fn : null; media.taps.push(!!tap); if (!tap) q = []; },
          mixIn(pcm) { if (pcm === null) { q = []; return; } q.push(Array.from(pcm)); if (q.length > 8) q.shift(); },
          playVideo() {}, mute(on) { muted = !!on; }, requestKey() {}, remoteLive() { return true; }, setPeerCodecs() {}, wake() {},
          stop() { clearInterval(t); t = null; tap = null; q = []; media.stopped++; }
        };
      };
      const Real = win.WebSocket; win.__noNet = true;
      win.WebSocket = function (u) { return win.__noNet ? new NoNetWS(u) : new Real(u); };
    },
  });
  const win = dom.window;
  for (let i = 0; i < 100 && !(win.NEXO && win.NEXO.initialized); i++) await sleep(100);
  await sleep(800);
  const p = { name, native, win, media, toasts: [] };
  // avisos: los de la llamada (3217: #nexo-call-aviso, por encima de su pantalla) y los de siempre
  new win.MutationObserver(() => { ['nexo-call-aviso', 'perm-error-toast'].forEach((id) => { const el = win.document.getElementById(id); if (el && el.textContent && p.toasts[p.toasts.length - 1] !== el.textContent) p.toasts.push(el.textContent); }); }).observe(win.document.body, { childList: true });
  return p;
}
const click = (win, el) => el && el.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
async function openChatWith(p, name) {
  let row; for (let i = 0; i < 200 && !row; i++) { row = Array.from(p.win.document.querySelectorAll('#main-contacts-list .ble-contact-row')).find((r) => (r.querySelector('.ble-contact-name') || {}).textContent === name); if (!row) await sleep(100); }
  click(p.win, row); await sleep(500); return !!row;
}
async function closeChat(p) { p.win.dispatchEvent(new p.win.CustomEvent('nexo:ble:closeChat', { detail: {} })); await sleep(300); }
function typeSend(p, t) { const i = p.win.document.getElementById('message-input'); i.value = t; i.dispatchEvent(new p.win.Event('input', { bubbles: true })); click(p.win, p.win.document.getElementById('send-btn')); }
async function addFound(p, name) {
  let add = null;
  const find = () => { const row = Array.from(p.win.document.querySelectorAll('#ble-new-device > div')).find((d) => (d.querySelector('span') || {}).textContent === name); return row && row.querySelector('button'); };
  for (let i = 0; i < 400 && !add; i++) { await sleep(100); add = find(); if (!add && !p.win.bleInterface.isScanning) click(p.win, p.win.document.getElementById('ble-scan-btn')); }
  click(p.win, add); await sleep(2500);
  return !!add;
}
function shutdown(p) { try { p.win.bleInterface.net._closeAll(); p.win.bleInterface.net.relays.forEach((rl) => { rl.retryAt = Date.now() + 9e6; }); } catch (e) {} }

async function app(r) {
  const r1 = new NostrRelay(), r2 = new NostrRelay();
  RELAYS = [await r1.start(), await r2.start()];
  const N = ['Y', 'A', 'B'];
  const radio = new Radio(), nat = {}, P = {};
  N.forEach((n, i) => { const h = { Y: 'EE', A: 'AA', B: 'BB' }[n]; nat[n] = new NativePhone(n, [h, h, h, h, h, '0' + (i + 1)].join(':'), Object.assign({}, base)); radio.add(nat[n]); nat[n].load(); });
  for (const n of N) P[n] = await boot(n, nat[n]);
  const bi = (p) => p.win.bleInterface, doc = (p) => p.win.document, q = (p, sel) => doc(p).querySelector(sel);
  const id = (n) => _n(bi(P[n]).localNexoId);
  // Y empareja con A y con B por Bluetooth (A y B no se conocen)
  async function pair(x, y) {
    const others = N.filter((n) => n !== x && n !== y);
    others.forEach((o) => radio.block(nat[x], nat[o]));
    bi(P[x]).togglePanel(); const ok = await addFound(P[x], y); bi(P[x]).togglePanel();
    await sleep(800);
    await openChatWith(P[x], y); typeSend(P[x], 'hola ' + y); await sleep(2500);
    const keyOf = (a, b) => !!(P[a].win.vaultLoadContacts().find((c) => c.name === b) || {}).publicKey;
    for (let i = 0; i < 40 && !keyOf(x, y); i++) await sleep(500);
    for (let i = 0; i < 40 && !keyOf(y, x); i++) await sleep(500);
    await closeChat(P[x]);
    others.forEach((o) => radio.unblock(nat[x], nat[o]));
    return ok;
  }
  for (const [x, y] of [['Y', 'A'], ['Y', 'B']]) if (!(await pair(x, y))) { r.error = 'no empareja ' + x + y; return; }
  // lejos (sin Bluetooth) y los tres con internet
  radio.block(nat.Y, nat.A); radio.block(nat.Y, nat.B); radio.block(nat.A, nat.B);
  N.forEach((n) => { const w = P[n].win; w.__noNet = false; bi(P[n]).net.relays.forEach((rl) => { rl.retryAt = 0; }); bi(P[n]).net.tick(); });
  r.por_internet_s = await waitFor(() => /^net/.test(bi(P.Y).calls._link(id('A')) || '') && /^net/.test(bi(P.Y).calls._link(id('B')) || '') && /^net/.test(bi(P.A).calls._link(id('Y')) || '') && /^net/.test(bi(P.B).calls._link(id('Y')) || ''), 90000);
  if (r.por_internet_s === null) { r.error = 'sin internet entre ellos'; return; }
  const st = (p, lane) => { const c = lane === 2 ? bi(p).calls2 : bi(p).calls; return c && c.call ? c.call.state : null; };
  const label = (el) => (el ? (el.querySelector('span:last-child') || el).textContent : null);
  const oye = (p, pred, since) => p.media.played.filter((x) => x.at >= since && pred(x)).length;
  const sinLlamadas = (p) => !bi(p).calls.call && !bi(p).calls2.call && !bi(p).gcall.gc;
  async function hangAll() {
    for (const n of N) { const b = bi(P[n]); try { if (b.calls2.call) b.calls2.hangup(); } catch (e) {} try { if (b.calls.call) b.calls.hangup(); } catch (e) {} }
    await waitFor(() => N.every((n) => sinLlamadas(P[n])), 20000); await sleep(2500);
  }
  async function unir() {
    await openChatWith(P.Y, 'A'); click(P.Y.win, doc(P.Y).getElementById('nexo-call-btn'));
    await waitFor(() => st(P.A, 1) === 'ringing', 30000);
    click(P.A.win, q(P.A, '#nexo-call-screen .call-accept'));
    const s1 = await waitFor(() => st(P.Y, 1) === 'active' && st(P.A, 1) === 'active', 20000);
    await closeChat(P.Y);
    await openChatWith(P.B, 'Y'); click(P.B.win, doc(P.B).getElementById('nexo-call-btn'));
    const s2 = await waitFor(() => st(P.Y, 2) === 'ringing', 30000);
    await closeChat(P.B);
    await sleep(600);
    const btn = q(P.Y, '#nexo-call2-screen .call-merge');
    const info = { YA_s: s1, suena_B_s: s2, boton: label(btn), apagado: !!(btn && btn.classList.contains('nc-off')) };
    click(P.Y.win, btn);
    info.unidas_s = await waitFor(() => { const br = bi(P.Y)._bridge; return !!(br && br.on) && st(P.Y, 1) === 'active' && st(P.Y, 2) === 'active' && st(P.A, 1) === 'active' && st(P.B, 1) === 'active'; }, 20000);
    return info;
  }

  // P1–P5
  const u = await unir();
  r.P1 = u;
  await sleep(2500);
  const c1 = bi(P.Y).calls.call, c2 = bi(P.Y).calls2.call;
  r.P1_ok = u.boton === 'Unir a esta llamada' && !u.apagado && typeof u.unidas_s === 'number' && !!c1 && !!c2 && !c1.held && !c2.held && N.every((n) => !bi(P[n]).gcall.gc);
  let t1 = Date.now(); await sleep(4000);
  r.P2_A = { oye_B: oye(P.A, (x) => x.mixed.includes('B'), t1), oye_Y: oye(P.A, (x) => x.from === 'Y', t1), eco: P.A.media.played.filter((x) => x.from === 'A' || x.mixed.includes('A')).length };
  r.P2_B = { oye_A: oye(P.B, (x) => x.mixed.includes('A'), t1), oye_Y: oye(P.B, (x) => x.from === 'Y', t1), eco: P.B.media.played.filter((x) => x.from === 'B' || x.mixed.includes('B')).length };
  r.P2_Y = { oye_A: oye(P.Y, (x) => x.from === 'A', t1), oye_B: oye(P.Y, (x) => x.from === 'B', t1) };
  r.P2_ok = r.P2_A.oye_B > 15 && r.P2_A.oye_Y > 15 && r.P2_A.eco === 0 && r.P2_B.oye_A > 15 && r.P2_B.oye_Y > 15 && r.P2_B.eco === 0 && r.P2_Y.oye_A > 20 && r.P2_Y.oye_B > 20;
  const name = (p) => (q(p, '#nexo-call-screen .call-name') || {}).textContent || '';
  const botones = (p) => Array.from(doc(p).querySelectorAll('#nexo-call-screen .call-buttons .nc-btn')).map(label);
  r.P3_Y = { nombre: name(P.Y), botones: botones(P.Y), abajo: !!q(P.Y, '#nexo-call2-screen'), dividida: doc(P.Y).documentElement.classList.contains('nc-split'), nota: (q(P.Y, '#nexo-call-screen .call-note') || {}).textContent };
  r.P3_A = { nombre: name(P.A), avisos: P.A.toasts.slice() }; r.P3_B = { nombre: name(P.B), avisos: P.B.toasts.slice() };
  r.P3_ok = r.P3_Y.nombre === 'A y B' && !r.P3_Y.abajo && !r.P3_Y.dividida && !r.P3_Y.botones.some((b) => /En espera|Reanudar|Unir|Agregar/.test(b)) && r.P3_Y.botones.includes('Colgar') &&
    r.P3_A.nombre === 'Y y B' && r.P3_A.avisos.includes('B se unió a la llamada') && r.P3_B.nombre === 'Y y A' && r.P3_B.avisos.includes('A se unió a la llamada');
  // P4: Y se silencia (el botón de su única pantalla)
  click(P.Y.win, q(P.Y, '#nexo-call-screen .call-mute'));
  await sleep(1500); t1 = Date.now(); await sleep(3000);
  r.P4 = { silenciado_en_las_dos: !!(bi(P.Y).calls.call && bi(P.Y).calls.call.muted && bi(P.Y).calls2.call && bi(P.Y).calls2.call.muted), A_oye_B: oye(P.A, (x) => x.mixed.includes('B'), t1), A_oye_Y: oye(P.A, (x) => x.from === 'Y', t1), B_oye_A: oye(P.B, (x) => x.mixed.includes('A'), t1) };
  r.P4_ok = r.P4.silenciado_en_las_dos && r.P4.A_oye_B > 10 && r.P4.A_oye_Y === 0 && r.P4.B_oye_A > 10;
  click(P.Y.win, q(P.Y, '#nexo-call-screen .call-mute'));
  await sleep(800);
  // P5: A cuelga → B sigue con Y
  P.B.toasts.length = 0; P.Y.toasts.length = 0;
  click(P.A.win, q(P.A, '#nexo-call-screen .call-hangup'));
  r.P5_A_colgo_s = await waitFor(() => st(P.Y, 1) === null && st(P.A, 1) === null, 15000);
  await sleep(2500); t1 = Date.now(); await sleep(3000);
  r.P5 = { sin_puente: !bi(P.Y)._bridge, B_sigue: st(P.Y, 2) === 'active' && st(P.B, 1) === 'active', B_oye_Y: oye(P.B, (x) => x.from === 'Y', t1), B_oye_A: oye(P.B, (x) => x.mixed.includes('A'), t1), Y_oye_B: oye(P.Y, (x) => x.from === 'B', t1),
    B_nombre: name(P.B), B_aviso: P.B.toasts.slice(), Y_aviso: P.Y.toasts.slice(), Y_pantalla_B: !!q(P.Y, '#nexo-call2-screen') && !doc(P.Y).documentElement.classList.contains('nc-split') };
  r.P5_ok = r.P5.sin_puente && r.P5.B_sigue && r.P5.B_oye_Y > 15 && r.P5.B_oye_A === 0 && r.P5.Y_oye_B > 15 && r.P5.B_nombre === 'Y' && r.P5.B_aviso.includes('A salió de la llamada') && r.P5.Y_aviso.includes('A salió de la llamada') && r.P5.Y_pantalla_B;
  await hangAll();
  // P6: unidas otra vez, Y cuelga → se acaba todo
  const u2 = await unir();
  r.P6_unidas_s = u2.unidas_s;
  await sleep(1500);
  click(P.Y.win, q(P.Y, '#nexo-call-screen .call-hangup'));
  r.P6_todo_s = await waitFor(() => N.every((n) => sinLlamadas(P[n])), 15000);
  r.P6_ok = typeof u2.unidas_s === 'number' && typeof r.P6_todo_s === 'number' && !bi(P.Y)._bridge;
  await hangAll();
  r.errores = logs.filter((l) => /Error procesando|No se pudo descifrar|ilegible/.test(l)).slice(0, 3);
  N.forEach((n) => shutdown(P[n]));
  await r1.stop(); await r2.stop();
}

(async () => {
  const r = { prueba: 'puentellamada', build: path.basename(buildDir) };
  await mezcla(r).catch((e) => { r.mezcla_error = String(e && e.message).slice(0, 160); });
  await app(r).catch((e) => { r.error = String(e && e.message).slice(0, 160); console.error(e && e.stack); });
  r.partes = { M1: !!r.M1_ok, M2: !!r.M2_ok, M3: !!r.M3_ok, P1: !!r.P1_ok, P2: !!r.P2_ok, P3: !!r.P3_ok, P4: !!r.P4_ok, P5: !!r.P5_ok, P6: !!r.P6_ok };
  const ok = Object.values(r.partes).every(Boolean) && !(r.errores || []).length && !r.error && !r.mezcla_error;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('PUENTELLAMADA ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_puentellamada.txt'), logs.join('\n'));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('PUENTELLAMADA ' + JSON.stringify({ prueba: 'puentellamada', resultado: 'FALLO', error: String(e && e.message) })); fs.writeFileSync(path.join(__dirname, 'last_logs_puentellamada.txt'), logs.join('\n')); process.exit(1); });
