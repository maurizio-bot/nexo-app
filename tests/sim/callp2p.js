// Dueño 13-11: «no me gusta que solo con Tor se habilite el vídeo; debería de ser siempre» → «sí, directo por defecto».
// Videollamada por INTERNET entre A y B (lejos, sin Bluetooth): se abre una conexión DIRECTA entre los dos (WebRTC; aquí un
// RTCPeerConnection falso que une los dos teléfonos del proceso) y la voz y el vídeo van por ella (antes: por relés, sin vídeo).
// Si la red no deja la conexión directa, sigue por los relés sin cortarse; con «Usar Tor siempre» no se intenta.
// Contraprueba 3056: no hay conexión directa (el vídeo no llega por internet sin Tor).
// Uso: node callp2p.js <dir_build>
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone, installWebCrypto } = require('./native_mock');
const { NostrRelay } = require('./nostr_relay');

const buildDir = path.resolve(process.argv[2] || path.join(__dirname, 'builds/wip'));
const base = { readsContentFallback: true, retain: ['onPayloadReceived', 'onLanMessage', 'onLanUp', 'onLanDown', 'onWifiDirectReceived'], closeOnNoService: true, pace: [15, 15], ioDelay: 25, asymmetric: true, noTor: true, wifiDirect: true };
let RELAYS = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
class DL extends ResourceLoader { constructor(d) { super(); this.d = d; } fetch(u) { const f = path.join(this.d, decodeURIComponent(new URL(u).pathname)); return fs.existsSync(f) ? Promise.resolve(fs.readFileSync(f)) : Promise.reject(new Error('x')); } }
const logs = [];
const T0 = Date.now();
const ts = () => String(((Date.now() - T0) / 1000).toFixed(1)).padStart(6) + 's';
// Sin antena: ningún relé contesta (como un teléfono sin datos ni Wi-Fi con salida)
class NoNetWS { constructor(u) { this.url = u; this.readyState = 0; setTimeout(() => { this.readyState = 3; if (this.onerror) this.onerror({}); if (this.onclose) this.onclose({}); }, 30); } send() { throw new Error('sin red'); } close() {} }
// RTCPeerConnection falso: los dos teléfonos del proceso se encuentran por un registro común. FAKE.block = la red no deja la
// conexión directa (nunca abre); FAKE.msgs cuenta lo que pasa por el canal directo
const FAKE = { reg: new Map(), block: false, msgs: 0, made: 0 };
function makeRTC() {
  return class FakePC {
    constructor() { this.id = Math.random().toString(36).slice(2, 10); this.iceGatheringState = 'new'; this.connectionState = 'new'; this.localDescription = null; this.dc = null; FAKE.reg.set(this.id, this); FAKE.made++; }
    createDataChannel() { this.dc = new FakeDC(this); return this.dc; }
    createOffer() { return Promise.resolve({ type: 'offer', sdp: 'v=0 fake-offer ' + this.id }); }
    createAnswer() { return Promise.resolve({ type: 'answer', sdp: 'v=0 fake-answer ' + this.id + ' ' + this.peerId }); }
    setLocalDescription(d) { this.localDescription = d; setTimeout(() => { this.iceGatheringState = 'complete'; if (this.onicegatheringstatechange) this.onicegatheringstatechange(); }, 50); return Promise.resolve(); }
    setRemoteDescription(d) {
      const m = /fake-(offer|answer) (\w+)/.exec(d.sdp || '');
      if (!m) return Promise.reject(new Error('sdp'));
      this.peerId = m[2];
      if (d.type === 'answer' && !FAKE.block) {
        const other = FAKE.reg.get(this.peerId);
        if (other && this.dc) {
          const theirs = new FakeDC(other); this.dc.peer = theirs; theirs.peer = this.dc;
          setTimeout(() => { if (other.ondatachannel) other.ondatachannel({ channel: theirs }); setTimeout(() => { this.dc.open(); theirs.open(); }, 50); }, 300);
        }
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
  const dom = new JSDOM(fs.readFileSync(path.join(buildDir, 'dist', 'index.html'), 'utf8'), {
    url: 'https://' + name.toLowerCase() + '.nexo.test/index.html', runScripts: 'dangerously', resources: new DL(path.join(buildDir, 'dist')), pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) {
      win.NEXO_NET_RELAYS = RELAYS; win.CapacitorCustomPlatform = { name: 'android' }; installWebCrypto(win);
      win.Capacitor = { Plugins: { NexoBLE: native.plugin() } }; win.HTMLElement.prototype.scrollTo = function () {};
      // internet que se puede quitar y devolver (win.__noNet)
      win.RTCPeerConnection = makeRTC();
      // medios de prueba (como calls2.js): voz cada 100 ms y, en videollamada, una imagen cada 200 ms
      const media = win.__media = { sentV: 0, gotV: 0, played: 0 };
      win.NEXO_callMediaFactory = (o) => {
        let t = null, tv = null;
        return { opts: o, start() { t = setInterval(() => { const p = new Uint8Array(46); p[0] = 1; p[1] = 1; p[3] = 42; p.fill(0x5a, 4); o.onPacket(p); }, 100);
            if (o.video) tv = setInterval(() => { media.sentV++; const v = new Uint8Array(900); v[0] = 1; o.onVideoPacket(v); }, 200);
            return Promise.resolve({ codec: 'opus', video: !!o.video }); },
          play() { media.played++; }, playVideo() { media.gotV++; }, mute() {}, requestKey() {}, remoteLive() { return true; },
          screen() { return true; }, screenFrame() {}, slidePart() {}, stop() { clearInterval(t); clearInterval(tv); } };
      };
      const Real = win.WebSocket; win.__noNet = true;
      win.WebSocket = function (u) { return win.__noNet ? new NoNetWS(u) : new Real(u); };
    },
  });
  const win = dom.window;
  for (let i = 0; i < 100 && !(win.NEXO && win.NEXO.initialized); i++) await sleep(100);
  await sleep(800);
  return { name, native, win };
}
const click = (win, el) => el && el.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
async function openChatWith(p, name) {
  let row; for (let i = 0; i < 200 && !row; i++) { row = Array.from(p.win.document.querySelectorAll('#main-contacts-list .ble-contact-row')).find((r) => (r.querySelector('.ble-contact-name') || {}).textContent === name); if (!row) await sleep(100); }
  click(p.win, row); await sleep(500); return !!row;
}
function typeSend(p, t) { const i = p.win.document.getElementById('message-input'); i.value = t; i.dispatchEvent(new p.win.Event('input', { bubbles: true })); click(p.win, p.win.document.getElementById('send-btn')); }
async function addFound(p, name) {
  let add = null;
  const find = () => { const row = Array.from(p.win.document.querySelectorAll('#ble-new-device > div')).find((d) => (d.querySelector('span') || {}).textContent === name); return row && row.querySelector('button'); };
  for (let i = 0; i < 400 && !add; i++) { await sleep(100); add = find(); if (!add && !p.win.bleInterface.isScanning) click(p.win, p.win.document.getElementById('ble-scan-btn')); }
  click(p.win, add); await sleep(2500);
  return !!add;
}
async function waitFor(fn, ms) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return Math.round((Date.now() - t0) / 100) / 10; await sleep(200); } return null; }
function shutdown(p) { try { p.win.bleInterface.net._closeAll(); p.win.bleInterface.net.relays.forEach((rl) => { rl.retryAt = Date.now() + 9e6; }); } catch (e) {} }
const st = (p) => { const c = p.win.bleInterface.calls.call; return c ? c.state : null; };

(async () => {
  const r = { prueba: 'callp2p', build: path.basename(buildDir) };
  const r1 = new NostrRelay(), r2 = new NostrRelay();
  RELAYS = [await r1.start(), await r2.start()];
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', base), nB = new NativePhone('B', 'BB:BB:BB:BB:BB:02', base);
  [nA, nB].forEach((n) => { radio.add(n); n.load(); });
  const A = await boot('A', nA), B = await boot('B', nB);
  const idA = A.win.bleInterface.localNexoId.toLowerCase(), idB = B.win.bleInterface.localNexoId.toLowerCase();
  A.win.bleInterface.togglePanel();
  if (!(await addFound(A, 'B'))) { console.log('CALLP2P ' + JSON.stringify(Object.assign(r, { resultado: 'FALLO', error: 'no empareja' }))); process.exit(1); }
  A.win.bleInterface.togglePanel();
  await openChatWith(A, 'B'); typeSend(A, 'hola'); await sleep(3000); await openChatWith(B, 'A'); await sleep(500);
  // lejos (sin Bluetooth) y los dos con internet
  radio.block(nA, nB);
  [A, B].forEach((p) => { p.win.__noNet = false; p.win.bleInterface.net.relays.forEach((rl) => { rl.retryAt = 0; }); p.win.bleInterface.net.tick(); });
  r.por_internet_s = await waitFor(() => A.win.bleInterface.calls.canVideo(idB) && B.win.bleInterface.calls.canVideo(idA) && /^net/.test(A.win.bleInterface.calls._link(idB) || ''), 60000);
  async function videoCall() {
    click(A.win, A.win.document.getElementById('nexo-video-btn'));
    await waitFor(() => st(B) === 'ringing', 30000);
    click(B.win, B.win.document.querySelector('#nexo-call-screen .call-accept'));
    return waitFor(() => st(A) === 'active' && st(B) === 'active', 20000);
  }
  async function hangup() { A.win.bleInterface.calls.hangup(); await waitFor(() => !A.win.bleInterface.calls.call && !B.win.bleInterface.calls.call, 15000); await sleep(1500); }
  // 1. videollamada por internet: se abre la conexión DIRECTA y el vídeo va por ahí (antes: por relés sin vídeo)
  r.llamada1 = await videoCall();
  r.directa_s = await waitFor(() => /^p2p:/.test(A.win.bleInterface.calls._link(idB) || '') && /^p2p:/.test(B.win.bleInterface.calls._link(idA) || ''), 30000);
  const v0 = B.win.__media.gotV, m0 = FAKE.msgs;
  await sleep(4000);
  r.video_llega = B.win.__media.gotV - v0;
  r.por_el_canal_directo = FAKE.msgs - m0;
  r.diag_directo = logs.some((l) => /\[A\].*\[P2P\] Conexión DIRECTA por internet/.test(l));
  await hangup();
  r.cierra_al_colgar = FAKE.reg.size === 0;
  // 2. la red no deja la conexión directa: sigue por los relés (voz) sin quedarse colgada
  FAKE.block = true;
  r.llamada2 = await videoCall();
  r.sin_directa_aviso_s = await waitFor(() => logs.some((l) => /\[A\].*\[P2P\] Sin conexión directa/.test(l)), 40000);
  const p0 = B.win.__media.played;
  await sleep(3000);
  r.voz_por_reles = B.win.__media.played - p0;
  r.sigue_activa = st(A) === 'active' && st(B) === 'active';
  await hangup();
  FAKE.block = false;
  // 3. «Usar Tor siempre» en A (no quiere que vean su IP): sin conexión directa
  A.win.bleInterface.net.state.tor = true;
  const made0 = FAKE.made;
  r.llamada3 = await videoCall();
  await sleep(6000);
  r.tor_sin_directa = FAKE.made === made0 && !/^p2p:/.test(A.win.bleInterface.calls._link(idB) || '');
  await hangup();
  A.win.bleInterface.net.state.tor = undefined;
  r.errores = logs.filter((l) => / error: /.test(l) && !/JSDOMERROR|styles\.css|Not implemented|GLOBAL TIMEOUT|net::ERR|fetch|ECONNREFUSED|WebSocket/.test(l)).slice(0, 5);
  const ok = r.por_internet_s !== null && r.llamada1 !== null && r.directa_s !== null && r.video_llega >= 10 && r.por_el_canal_directo >= 20 && r.diag_directo && r.cierra_al_colgar &&
    r.llamada2 !== null && r.sin_directa_aviso_s !== null && r.voz_por_reles >= 5 && r.sigue_activa && r.llamada3 !== null && r.tor_sin_directa && !r.errores.length;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('CALLP2P ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_callp2p.txt'), logs.join('\n'));
  [A, B].forEach(shutdown);
  await r1.stop(); await r2.stop();
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('CALLP2P ' + JSON.stringify({ prueba: 'callp2p', resultado: 'FALLO', error: String(e && e.message).replace(/"/g, "'") })); console.error(e && e.stack); fs.writeFileSync(path.join(__dirname, 'last_logs_callp2p.txt'), logs.join('\n')); process.exit(1); });
