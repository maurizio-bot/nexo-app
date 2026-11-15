// #222 (dueño 15-11: «solo pueden ser dos llamadas independientes al mismo tiempo… no debe ser posible realizar otra llamada más…
// de contestar y poder pausar la otra en automático y poderla revisar manualmente… un botón de contestación rápida… o la opción de
// ingresar un texto»). A, B, C y D por Bluetooth; A habla con B:
//  S1  A llama a C desde su chat (segunda llamada, saliente): C contesta y la de B pasa sola a EN ESPERA (A oye a C y no a B; B ve
//      «Te puso en espera»);
//  S2  con dos llamadas, los botones de llamar del chat de D están apagados: tocarlos no llama; tampoco se puede llamar a un grupo;
//  S3  A toca «Reanudar» en la de B: vuelve B y C pasa a en espera (A oye a B y no a C);
//  S4  A cuelga a B: la de C vuelve sola (A la oye);
//  S5  D llama a A (con la de C en curso): suena con «Mensaje»; A elige una frase lista: a D se le corta y le llega el texto en el chat;
//  S6  D vuelve a llamar: A elige «Escribir…», escribe y envía: a D le llega ese texto. La de C sigue en todo momento.
// Uso: node callwait.js <dir_build>
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
  const r = { prueba: 'callwait', build: path.basename(buildDir) };
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
  for (const [x, y] of [['A', 'B'], ['A', 'C'], ['A', 'D']]) if (!(await pair(x, y))) { console.log('CALLWAIT ' + JSON.stringify({ prueba: 'callwait', resultado: 'FALLO', error: 'no empareja ' + x + y })); process.exit(1); }
  await sleep(2000);
  const cl = (p, lane) => { const c = lane === 2 ? p.win.bleInterface.calls2 : p.win.bleInterface.calls; return c && c.call; };
  const st = (p, lane) => { const c = cl(p, lane); return c ? c.state : null; };
  const doc = (p) => p.win.document;
  const heard = (p, who, n0) => p.media.played.slice(n0).filter((x) => x.from === who).length;
  const listen = async (p, ms) => { const n0 = p.media.played.length; await sleep(ms); return (who) => heard(p, who, n0); };
  // A llama a B
  await openChatWith(P.A, 'B');
  click(P.A.win, doc(P.A).getElementById('nexo-call-btn'));
  await waitFor(() => st(P.B, 1) === 'ringing', 20000);
  click(P.B.win, doc(P.B).querySelector('#nexo-call-screen .call-accept'));
  r.AB_activa_s = await waitFor(() => st(P.A, 1) === 'active' && st(P.B, 1) === 'active', 20000);
  await closeChat(P.A);
  // S1: A llama a C desde el chat de C (segunda llamada saliente)
  await openChatWith(P.A, 'C');
  click(P.A.win, doc(P.A).getElementById('nexo-call-btn'));
  r.S1_sale_por_segunda_s = await waitFor(() => st(P.A, 2) === 'calling' && st(P.A, 1) === 'active', 10000);
  await waitFor(() => st(P.C, 1) === 'ringing', 20000);
  click(P.C.win, doc(P.C).querySelector('#nexo-call-screen .call-accept'));
  r.S1_dos_activas_s = await waitFor(() => st(P.A, 1) === 'active' && st(P.A, 2) === 'active' && st(P.C, 1) === 'active', 20000);
  r.S1_B_en_espera_s = await waitFor(() => (cl(P.A, 1) || {}).userHold === true && (cl(P.B, 1) || {}).peerHeld === true, 8000);
  await sleep(1500);
  let h = await listen(P.A, 5000);
  r.S1_A_oye = { B: h('B'), C: h('C') };
  r.S1_B_ve = ((doc(P.B).querySelector('#nexo-call-screen .call-status') || {}).textContent || '');
  r.S1_botones_espera = !!doc(P.A).querySelector('#nexo-call-screen .call-hold') && !!doc(P.A).querySelector('#nexo-call2-screen .call-hold');
  r.S1_vigentes = st(P.B, 1) === 'active' && st(P.C, 1) === 'active';
  await closeChat(P.A);
  // S2: con dos llamadas no se puede llamar a nadie más (botones apagados; ni a un grupo)
  await openChatWith(P.D, 'A'); // (para S5)
  await closeChat(P.D);
  await openChatWith(P.A, 'D');
  const cb = doc(P.A).getElementById('nexo-call-btn'), vb = doc(P.A).getElementById('nexo-video-btn');
  r.S2_apagados = !!cb && cb.getAttribute('aria-disabled') === 'true' && !!vb && vb.getAttribute('aria-disabled') === 'true';
  click(P.A.win, cb);
  await sleep(4000);
  r.S2_D_no_suena = st(P.D, 1) === null && st(P.A, 1) === 'active' && st(P.A, 2) === 'active';
  r.S2_grupo_rechazado = await P.A.win.bleInterface.gcall.start([id('D')], false).then(() => false, () => true);
  await closeChat(P.A);
  // S3: A reanuda la de B (la de C pasa a en espera)
  click(P.A.win, doc(P.A).querySelector('#nexo-call-screen .call-hold'));
  r.S3_cambio_s = await waitFor(() => !(cl(P.A, 1) || {}).userHold && (cl(P.A, 2) || {}).userHold === true && (cl(P.C, 1) || {}).peerHeld === true && !(cl(P.B, 1) || {}).peerHeld, 8000);
  await sleep(1500);
  h = await listen(P.A, 5000);
  r.S3_A_oye = { B: h('B'), C: h('C') };
  // S4: A cuelga a B → la de C vuelve sola
  click(P.A.win, doc(P.A).querySelector('#nexo-call-screen .call-hangup'));
  r.S4_C_vuelve_s = await waitFor(() => st(P.A, 1) === null && st(P.A, 2) === 'active' && !(cl(P.A, 2) || {}).userHold && !(cl(P.C, 1) || {}).peerHeld, 8000);
  await sleep(1500);
  h = await listen(P.A, 4000);
  r.S4_A_oye_C = h('C');
  // S5: D llama a A (A con la de C): «Mensaje» → frase lista
  const dEnds = []; P.D.win.addEventListener('nexo:call', (e) => { if (e.detail && e.detail.state === 'ended') dEnds.push(e.detail.reason); });
  const dGot = async (txt) => (await P.D.win.vaultLoadMessages(id('A'))).some((m) => !m._own && String(m.content || '').indexOf(txt) >= 0);
  await openChatWith(P.D, 'A');
  click(P.D.win, doc(P.D).getElementById('nexo-call-btn'));
  r.S5_suena_s = await waitFor(() => (st(P.A, 1) === 'ringing' || st(P.A, 2) === 'ringing'), 20000);
  const ringSel = () => doc(P.A).querySelector('#nexo-call-screen .call-reply') || doc(P.A).querySelector('#nexo-call2-screen .call-reply');
  r.S5_boton_mensaje = !!ringSel();
  click(P.A.win, ringSel());
  await sleep(500);
  const preset = doc(P.A).querySelector('#nexo-call-reply .nexo-qr-preset');
  r.S5_frase = preset ? preset.textContent : null;
  click(P.A.win, preset);
  r.S5_D_cortada_s = await waitFor(() => dEnds.length > 0 && st(P.D, 1) === null, 15000);
  r.S5_D_fin = dEnds[0] || null;
  r.S5_D_recibe_s = r.S5_frase ? await waitFor(() => dGot(r.S5_frase), 30000) : null;
  r.S5_C_sigue = st(P.A, 2) === 'active' && st(P.C, 1) === 'active' && !(cl(P.A, 2) || {}).userHold;
  await closeChat(P.D);
  await sleep(2500);
  // S6: D vuelve a llamar: «Escribir…» con un texto propio
  await openChatWith(P.D, 'A');
  click(P.D.win, doc(P.D).getElementById('nexo-call-btn'));
  r.S6_suena_s = await waitFor(() => (st(P.A, 1) === 'ringing' || st(P.A, 2) === 'ringing') && !!ringSel(), 20000);
  click(P.A.win, ringSel());
  await sleep(500);
  click(P.A.win, doc(P.A).querySelector('#nexo-call-reply .nexo-qr-write'));
  const ta = doc(P.A).querySelector('#nexo-call-reply textarea');
  const propio = 'Te marco a las 5, estoy con otra persona';
  if (ta) { ta.value = propio; ta.dispatchEvent(new P.A.win.Event('input', { bubbles: true })); }
  click(P.A.win, doc(P.A).querySelector('#nexo-call-reply .nexo-qr-send'));
  r.S6_D_recibe_s = await waitFor(() => dGot(propio), 30000);
  r.S6_C_sigue = st(P.A, 2) === 'active' && st(P.C, 1) === 'active';
  r.errores = logs.filter((l) => /Error procesando|No se pudo descifrar|ilegible|PAGEERROR|TypeError|ReferenceError/.test(l)).slice(0, 3);
  const num = (x) => typeof x === 'number';
  const ok = num(r.AB_activa_s) && num(r.S1_sale_por_segunda_s) && num(r.S1_dos_activas_s) && num(r.S1_B_en_espera_s) &&
    r.S1_A_oye.C > 20 && r.S1_A_oye.B === 0 && /espera/i.test(r.S1_B_ve) && r.S1_botones_espera && r.S1_vigentes &&
    r.S2_apagados && r.S2_D_no_suena && r.S2_grupo_rechazado &&
    num(r.S3_cambio_s) && r.S3_A_oye.B > 20 && r.S3_A_oye.C === 0 &&
    num(r.S4_C_vuelve_s) && r.S4_A_oye_C > 15 &&
    num(r.S5_suena_s) && r.S5_boton_mensaje && r.S5_frase && num(r.S5_D_cortada_s) && num(r.S5_D_recibe_s) && r.S5_C_sigue &&
    num(r.S6_suena_s) && num(r.S6_D_recibe_s) && r.S6_C_sigue && !r.errores.length;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('CALLWAIT ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_callwait.txt'), logs.join('\n'));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('CALLWAIT {"prueba":"callwait","resultado":"FALLO","error":"' + String(e && e.message).replace(/"/g, "'") + '"}'); console.error(e && e.stack); fs.writeFileSync(path.join(__dirname, 'last_logs_callwait.txt'), logs.join('\n')); process.exit(1); });
