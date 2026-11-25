// 3156 (diagnóstico S24/S23 3073 16-11 11:12): una videollamada directa por internet (WebRTC) se cortó cuando el S23 pasó de Wi-Fi a
// datos: la conexión directa se cayó, los relés tardaron en volver («Sin relés: internet no disponible») y a los 15 s los dos la dieron
// por perdida («Fin (lost, 104 s)» / «Se cortó la conexión directa… → sigue por los relés» y 40 ms después «Fin (lost, 103 s)»).
// Como WhatsApp, un cambio de red no debe cortar la llamada. A y B lejos (sin Bluetooth), por internet (relés de prueba y conexión
// directa con un RTCPeerConnection falso, como callp2p.js); en plena videollamada directa B cambia de red: aviso del sistema
// (onNetChange), la conexión directa muere y B se queda 20 s sin internet; luego vuelve:
//  N1  durante el corte ninguno la da por perdida («Reconectando…»);
//  N2  al volver, la voz vuelve a llegar en los dos sentidos y la conexión directa se rehace por la red nueva;
//  N3  ninguna «Fin».
// Contraprueba 3155: «Fin (lost)» a los 15 s del corte. Uso: node cambiored.js <dir_build>
// --mudo (3300, tanda 2 punto 18; diagnóstico S24 19-11 21:48: hueco de ~25 s sin imagen tras un cambio de red del S23): la red
// cambia SIN aviso que llegue; la conexión directa queda «disconnected» (lo que va por ella se pierde) y Chromium solo la da por
// «failed» a los ~25–30 s. M1: la directa se rehace y la voz vuelve en ≤ 12 s (contraprueba 3299: hasta el «failed», 25 s).
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone, installWebCrypto } = require('./native_mock');
const { NostrRelay } = require('./nostr_relay');

const buildDir = path.resolve(process.argv[2]);
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
  send(s) { if (this.readyState !== 'open') throw new Error('cerrado'); if (this.dead) return; FAKE.msgs++; const p = this.peer; setTimeout(() => { if (p && p.readyState === 'open' && p.onmessage) p.onmessage({ data: s }); }, 5); }
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
  const r = { prueba: 'cambiored', build: path.basename(buildDir) };
  const r1 = new NostrRelay(), r2 = new NostrRelay();
  RELAYS = [await r1.start(), await r2.start()];
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', base), nB = new NativePhone('B', 'BB:BB:BB:BB:BB:02', base);
  [nA, nB].forEach((n) => { radio.add(n); n.load(); });
  const A = await boot('A', nA), B = await boot('B', nB);
  const idA = A.win.bleInterface.localNexoId.toLowerCase(), idB = B.win.bleInterface.localNexoId.toLowerCase();
  A.win.bleInterface.togglePanel();
  if (!(await addFound(A, 'B'))) { console.log('CAMBIORED ' + JSON.stringify(Object.assign(r, { resultado: 'FALLO', error: 'no empareja' }))); process.exit(1); }
  A.win.bleInterface.togglePanel();
  await openChatWith(A, 'B'); typeSend(A, 'hola'); await sleep(3000); await openChatWith(B, 'A'); await sleep(500);
  radio.block(nA, nB); // lejos: sin Bluetooth
  [A, B].forEach((p) => { p.win.__noNet = false; p.win.bleInterface.net.relays.forEach((rl) => { rl.retryAt = 0; }); p.win.bleInterface.net.tick(); });
  r.por_internet_s = await waitFor(() => A.win.bleInterface.calls.canVideo(idB) && B.win.bleInterface.calls.canVideo(idA) && /^net/.test(A.win.bleInterface.calls._link(idB) || ''), 60000);
  const fins = { A: [], B: [] };
  [['A', A], ['B', B]].forEach(([n, p]) => p.win.addEventListener('nexo:call', (e) => { if (e.detail && e.detail.state === 'ended') fins[n].push({ t: Date.now(), why: e.detail.reason }); }));
  click(A.win, A.win.document.getElementById('nexo-video-btn'));
  await waitFor(() => st(B) === 'ringing', 30000);
  click(B.win, B.win.document.querySelector('#nexo-call-screen .call-accept'));
  r.activa_s = await waitFor(() => st(A) === 'active' && st(B) === 'active', 20000);
  r.directa_s = await waitFor(() => /^p2p:/.test(A.win.bleInterface.calls._link(idB) || '') && /^p2p:/.test(B.win.bleInterface.calls._link(idA) || ''), 30000);
  await sleep(2000);
  if (process.argv.indexOf('--mudo') >= 0) {
    r.modo = 'mudo';
    const t0m = Date.now(), madeM = FAKE.made, olds = Array.from(FAKE.reg.values());
    olds.forEach((pc) => { if (pc.dc) { pc.dc.dead = true; if (pc.dc.peer) pc.dc.peer.dead = true; } pc.connectionState = 'disconnected'; if (pc.onconnectionstatechange) pc.onconnectionstatechange(); });
    olds.forEach((pc) => setTimeout(() => { if (FAKE.reg.get(pc.id) === pc && pc.connectionState === 'disconnected') { pc.connectionState = 'failed'; if (pc.onconnectionstatechange) pc.onconnectionstatechange(); } }, 25000));
    const pA0 = A.win.__media.played, pB0 = B.win.__media.played;
    r.M1_directa_nueva_s = await waitFor(() => FAKE.made > madeM && /^p2p:/.test(A.win.bleInterface.calls._link(idB) || '') && /^p2p:/.test(B.win.bleInterface.calls._link(idA) || '') && olds.every((pc) => !FAKE.reg.has(pc.id) || pc.connectionState !== 'disconnected'), 40000);
    const qA = A.win.__media.played, qB = B.win.__media.played; await sleep(3000);
    r.M1_voz_3s = { A: A.win.__media.played - qA, B: B.win.__media.played - qB };
    r.M1_fin = { A: fins.A.map((f) => f.why), B: fins.B.map((f) => f.why) };
    r.diag = logs.filter((l) => /Se cortó la conexión directa|Conexión DIRECTA|desconectada/.test(l)).map((l) => l.slice(0, 160)).slice(0, 8);
    A.win.bleInterface.calls.hangup(); await waitFor(() => !A.win.bleInterface.calls.call && !B.win.bleInterface.calls.call, 15000);
    r.errores = logs.filter((l) => / error: /.test(l) && !/JSDOMERROR|styles\.css|Not implemented|GLOBAL TIMEOUT|net::ERR|fetch|ECONNREFUSED|WebSocket/.test(l)).slice(0, 5);
    const okM = r.activa_s !== null && r.directa_s !== null && typeof r.M1_directa_nueva_s === 'number' && r.M1_directa_nueva_s <= 12 && r.M1_voz_3s.A >= 10 && r.M1_voz_3s.B >= 10 && !r.M1_fin.A.length && !r.M1_fin.B.length && !r.errores.length;
    r.resultado = okM ? 'OK' : 'FALLO';
    console.log('CAMBIORED ' + JSON.stringify(r));
    fs.writeFileSync(path.join(__dirname, 'last_logs_cambiored_mudo.txt'), logs.join('\n'));
    [A, B].forEach(shutdown); await r1.stop(); await r2.stop();
    process.exit(okM ? 0 : 1);
  }
  // B cambia de red: aviso del sistema, la conexión directa muere y B se queda sin internet 20 s (relés caídos)
  const t0 = Date.now(), made0 = FAKE.made;
  FAKE.block = true;
  nB.emit('onNetChange', { type: 'cell', prev: 'wifi' });
  Array.from(FAKE.reg.values()).forEach((pc) => { try { pc.close(); } catch (e) {} });
  B.win.__noNet = true; B.win.bleInterface.net._closeAll(); B.win.bleInterface.net.relays.forEach((rl) => { rl.retryAt = Date.now() + 9e6; });
  let recon = { A: false, B: false };
  for (let i = 0; i < 20; i++) { await sleep(1000); if (A.win.bleInterface.calls.call && A.win.bleInterface.calls.call.reconnecting) recon.A = true; if (B.win.bleInterface.calls.call && B.win.bleInterface.calls.call.reconnecting) recon.B = true; }
  r.N1_durante_el_corte = { A: st(A), B: st(B), reconectando: recon, fin: { A: fins.A.map((f) => f.why + ' a los ' + Math.round((f.t - t0) / 1000) + ' s'), B: fins.B.map((f) => f.why + ' a los ' + Math.round((f.t - t0) / 1000) + ' s') } };
  // vuelve el internet de B (por la red nueva)
  FAKE.block = false;
  B.win.__noNet = false; B.win.bleInterface.net.relays.forEach((rl) => { rl.retryAt = 0; }); B.win.bleInterface.net.tick();
  const pA = A.win.__media.played, pB = B.win.__media.played;
  r.N2_voz_vuelve_s = await waitFor(() => st(A) === 'active' && st(B) === 'active' && A.win.__media.played - pA >= 10 && B.win.__media.played - pB >= 10, 30000);
  r.N2_directa_otra_vez_s = await waitFor(() => /^p2p:/.test(A.win.bleInterface.calls._link(idB) || '') && /^p2p:/.test(B.win.bleInterface.calls._link(idA) || ''), 40000);
  r.N2_intentos_directa = FAKE.made - made0;
  const qA = A.win.__media.played, qB = B.win.__media.played;
  await sleep(3000);
  r.N2_voz_3s = { A: A.win.__media.played - qA, B: B.win.__media.played - qB };
  r.N3_fin = { A: fins.A.map((f) => f.why), B: fins.B.map((f) => f.why) };
  r.diag = logs.filter((l) => /Cambio de red en la llamada|cambió de red: rehago|Conexión DIRECTA|Se cortó la conexión directa|Fin \(/.test(l)).map((l) => l.slice(0, 160)).slice(0, 12);
  A.win.bleInterface.calls.hangup(); await waitFor(() => !A.win.bleInterface.calls.call && !B.win.bleInterface.calls.call, 15000);
  r.errores = logs.filter((l) => / error: /.test(l) && !/JSDOMERROR|styles\.css|Not implemented|GLOBAL TIMEOUT|net::ERR|fetch|ECONNREFUSED|WebSocket/.test(l)).slice(0, 5);
  const ok = r.activa_s !== null && r.directa_s !== null && r.N1_durante_el_corte.A === 'active' && r.N1_durante_el_corte.B === 'active' && r.N1_durante_el_corte.reconectando.A && r.N1_durante_el_corte.reconectando.B &&
    typeof r.N2_voz_vuelve_s === 'number' && typeof r.N2_directa_otra_vez_s === 'number' && r.N2_voz_3s.A >= 10 && r.N2_voz_3s.B >= 10 && !r.N3_fin.A.length && !r.N3_fin.B.length && !r.errores.length;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('CAMBIORED ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_cambiored.txt'), logs.join('\n'));
  [A, B].forEach(shutdown);
  await r1.stop(); await r2.stop();
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('CAMBIORED ' + JSON.stringify({ prueba: 'cambiored', resultado: 'FALLO', error: String(e && e.message).replace(/"/g, "'") })); console.error(e && e.stack); fs.writeFileSync(path.join(__dirname, 'last_logs_cambiored.txt'), logs.join('\n')); process.exit(1); });
