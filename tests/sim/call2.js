// #220 fase 2 (dueño 15-11: «estaba en dos llamadas diferentes al mismo tiempo… se pueden hacer dos videollamadas o dos llamadas al
// mismo tiempo y nada más; si se necesitan más personas, la de grupo»). Antes, una segunda llamada 1-a-1 recibía «ocupado». A, B, C y D
// por Bluetooth; A habla con B:
//  T1  C llama a A: a A le suena ABAJO (segunda llamada), la de B sigue (antes: C recibía «ocupado»);
//  T2  A contesta: las dos activas, pantalla dividida; A oye a B y a C, y B y C oyen a A;
//  T3  D llama a A con dos en curso: D recibe «ocupado» (máximo 2);
//  T4  A cuelga a C: la de B sigue (la voz de B sigue llegando) y la pantalla vuelve a ser una.
// Uso: node call2.js <dir_build>
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone, installWebCrypto } = require('./native_mock');

const buildDir = path.resolve(process.argv[2]);
const opts = { readsContentFallback: true, retain: ['onPayloadReceived'], closeOnNoService: true, pace: [15, 15], ioDelay: 25, asymmetric: true, supervisionMs: 3000 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const norm = (m) => String(m || '').replace(/[:\-.]/g, '').toLowerCase();
class DistLoader extends ResourceLoader {
  constructor(dir) { super(); this.dir = dir; }
  fetch(url) { const f = path.join(this.dir, decodeURIComponent(new URL(url).pathname)); return fs.existsSync(f) ? Promise.resolve(fs.readFileSync(f)) : Promise.reject(new Error('no existe ' + f)); }
}
const logs = [];
const T0 = Date.now();
const ts = () => String(((Date.now() - T0) / 1000).toFixed(1)).padStart(6) + 's';
async function boot(name, native) {
  const vc = new VirtualConsole();
  ['log', 'warn', 'error'].forEach((l) => vc.on(l, (...a) => logs.push(`${ts()} [${name}] ${l}: ` + a.map(String).join(' ').substring(0, 250))));
  const media = { sent: 0, played: [] };
  const dom = new JSDOM(fs.readFileSync(path.join(buildDir, 'dist', 'index.html'), 'utf8'), {
    url: 'https://' + name.toLowerCase() + '.nexo.test/index.html', runScripts: 'dangerously',
    resources: new DistLoader(path.join(buildDir, 'dist')), pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) {
      win.CapacitorCustomPlatform = { name: 'android' }; installWebCrypto(win); win.Capacitor = { Plugins: { NexoBLE: native.plugin() } }; win.HTMLElement.prototype.scrollTo = function () {};
      win.NEXO_CALL_RING_MS = 30000;
      // micrófono falso (como calls2.js): un paquete de voz numerado cada 100 ms
      win.NEXO_callMediaFactory = (o) => {
        let t = null, n = 0;
        return {
          opts: o,
          start() { t = setInterval(() => { const f = new Uint8Array(42); f[0] = name.charCodeAt(0); f[1] = (n >> 8) & 255; f[2] = n & 255; f.fill(0x5a, 3); n++; media.sent++; const p = new Uint8Array(4 + f.length); p[0] = 1; p[1] = 1; p[2] = 0; p[3] = f.length; p.set(f, 4); o.onPacket(p); }, 100); return Promise.resolve({ codec: 'opus', video: false }); },
          play(bytes) { if (bytes.length > 6) media.played.push({ from: String.fromCharCode(bytes[4]), at: Date.now() }); },
          playVideo() {}, mute() {}, requestKey() {}, remoteLive() { return true; },
          stop() { clearInterval(t); t = null; }
        };
      };
    },
  });
  const win = dom.window;
  for (let i = 0; i < 100 && !(win.NEXO && win.NEXO.initialized); i++) await sleep(100);
  await sleep(800);
  return { name, native, win, media };
}
const click = (win, el) => el && el.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
async function openChatWith(p, name) {
  let row; for (let i = 0; i < 100 && !row; i++) { row = Array.from(p.win.document.querySelectorAll('#main-contacts-list .ble-contact-row')).find((r) => (r.querySelector('.ble-contact-name') || {}).textContent === name); if (!row) await sleep(100); }
  click(p.win, row); await sleep(600); return !!row;
}
async function closeChat(p) { p.win.dispatchEvent(new p.win.CustomEvent('nexo:ble:closeChat', { detail: {} })); await sleep(300); }
async function sendText(p, t) { const i = p.win.document.getElementById('message-input'); i.value = t; i.dispatchEvent(new p.win.Event('input', { bubbles: true })); click(p.win, p.win.document.getElementById('send-btn')); }
async function addFound(p, name) {
  let add = null;
  const find = () => { const row = Array.from(p.win.document.querySelectorAll('#ble-new-device > div')).find((d) => (d.querySelector('span') || {}).textContent === name); return row && row.querySelector('button'); };
  for (let i = 0; i < 400 && !add; i++) { await sleep(100); add = find(); if (!add && !p.win.bleInterface.isScanning) click(p.win, p.win.document.getElementById('ble-scan-btn')); }
  click(p.win, add); await sleep(2000);
  return !!add;
}
async function waitFor(fn, ms) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return Math.round((Date.now() - t0) / 100) / 10; await sleep(250); } return null; }


(async () => {
  const r = { prueba: 'call2', build: path.basename(buildDir) };
  const radio = new Radio();
  const nat = {}, P = {};
  ['A', 'B', 'C', 'D'].forEach((n, i) => { const h = n.repeat(2); nat[n] = new NativePhone(n, [h, h, h, h, h, '0' + (i + 1)].join(':'), Object.assign({}, opts)); radio.add(nat[n]); nat[n].load(); });
  for (const n of ['A', 'B', 'C', 'D']) P[n] = await boot(n, nat[n]);
  const id = (n) => P[n].win.bleInterface.localNexoId.toLowerCase();
  async function pair(x, y) {
    const others = ['A', 'B', 'C', 'D'].filter((n) => n !== x && n !== y);
    others.forEach((o) => radio.block(nat[x], nat[o]));
    P[x].win.bleInterface.togglePanel(); const ok = await addFound(P[x], y); P[x].win.bleInterface.togglePanel();
    await sleep(800);
    await openChatWith(P[x], y); await sendText(P[x], 'hola ' + y); await sleep(2500);
    const keyOf = (a, b) => !!(P[a].win.vaultLoadContacts().find((c) => c.name === b) || {}).publicKey;
    for (let i = 0; i < 40 && !keyOf(x, y); i++) await sleep(500);
    for (let i = 0; i < 40 && !keyOf(y, x); i++) await sleep(500);
    await closeChat(P[x]);
    others.forEach((o) => radio.unblock(nat[x], nat[o]));
    return ok;
  }
  for (const [x, y] of [['A', 'B'], ['A', 'C'], ['A', 'D']]) if (!(await pair(x, y))) { console.log('CALL2 ' + JSON.stringify({ prueba: 'call2', resultado: 'FALLO', error: 'no empareja ' + x + y })); process.exit(1); }
  await sleep(2000);
  const st = (p, lane) => { const c = lane === 2 ? p.win.bleInterface.calls2 : p.win.bleInterface.calls; return c && c.call ? c.call.state : null; };
  const doc = (p) => p.win.document;
  // A llama a B
  await openChatWith(P.A, 'B');
  click(P.A.win, doc(P.A).getElementById('nexo-call-btn'));
  await waitFor(() => st(P.B, 1) === 'ringing', 20000);
  click(P.B.win, doc(P.B).querySelector('#nexo-call-screen .call-accept'));
  r.AB_activa_s = await waitFor(() => st(P.A, 1) === 'active' && st(P.B, 1) === 'active', 20000);
  await closeChat(P.A);
  // T1: C llama a A
  await openChatWith(P.C, 'A');
  click(P.C.win, doc(P.C).getElementById('nexo-call-btn'));
  r.T1_suena_abajo_s = await waitFor(() => st(P.A, 2) === 'ringing', 20000);
  r.T1_C_estado = st(P.C, 1);
  r.T1_pantalla2 = !!doc(P.A).getElementById('nexo-call2-screen');
  r.T1_B_sigue = st(P.A, 1) === 'active';
  // T2: A contesta
  click(P.A.win, doc(P.A).querySelector('#nexo-call2-screen .call-accept'));
  r.T2_dos_activas_s = await waitFor(() => st(P.A, 1) === 'active' && st(P.A, 2) === 'active' && st(P.C, 1) === 'active', 20000);
  r.T2_dividida = doc(P.A).documentElement.classList.contains('nc-split');
  const pa0 = P.A.media.played.length, pb0 = P.B.media.played.length, pc0 = P.C.media.played.length;
  await sleep(6000);
  const desde = (arr, n0, who) => arr.slice(n0).filter((x) => x.from === who).length;
  r.T2_A_oye_B = desde(P.A.media.played, pa0, 'B'); r.T2_A_oye_C = desde(P.A.media.played, pa0, 'C');
  r.T2_B_oye_A = desde(P.B.media.played, pb0, 'A'); r.T2_C_oye_A = desde(P.C.media.played, pc0, 'A');
  // T3: D llama a A
  await openChatWith(P.D, 'A');
  click(P.D.win, doc(P.D).getElementById('nexo-call-btn'));
  const ended = []; P.D.win.addEventListener('nexo:call', (e) => { if (e.detail && e.detail.state === 'ended') ended.push(e.detail.reason); });
  await waitFor(() => ended.length > 0 || st(P.D, 1) === null, 25000);
  r.T3_D_fin = ended[0] || st(P.D, 1);
  r.T3_A_sigue_con_dos = st(P.A, 1) === 'active' && st(P.A, 2) === 'active';
  // T4: A cuelga a C
  click(P.A.win, doc(P.A).querySelector('#nexo-call2-screen .call-hangup'));
  await waitFor(() => st(P.A, 2) === null, 10000);
  await sleep(2500);
  const pb1 = P.A.media.played.length;
  await sleep(4000);
  r.T4_B_sigue = st(P.A, 1) === 'active' && desde(P.A.media.played, pb1, 'B') > 10;
  r.T4_una_pantalla = !doc(P.A).documentElement.classList.contains('nc-split') && !doc(P.A).getElementById('nexo-call2-screen');
  r.errores = logs.filter((l) => /Error procesando|No se pudo descifrar|ilegible|PAGEERROR/.test(l)).slice(0, 3);
  const ok = typeof r.AB_activa_s === 'number' && typeof r.T1_suena_abajo_s === 'number' && r.T1_pantalla2 && r.T1_B_sigue &&
    typeof r.T2_dos_activas_s === 'number' && r.T2_dividida && r.T2_A_oye_B > 20 && r.T2_A_oye_C > 20 && r.T2_B_oye_A > 20 && r.T2_C_oye_A > 20 &&
    r.T3_D_fin === 'busy' && r.T3_A_sigue_con_dos && r.T4_B_sigue && r.T4_una_pantalla && !r.errores.length;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('CALL2 ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_call2.txt'), logs.join('\n'));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('CALL2 {"prueba":"call2","resultado":"FALLO","error":"' + String(e && e.message).replace(/"/g, "'") + '"}'); console.error(e && e.stack); fs.writeFileSync(path.join(__dirname, 'last_logs_call2.txt'), logs.join('\n')); process.exit(1); });
