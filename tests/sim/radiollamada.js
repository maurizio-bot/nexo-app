// 3058 (diagnóstico del dueño 13-11 07:28, S24 + vivo con la 3039): videollamada por Wi-Fi; al apagar el Wi-Fi de los dos la voz
// siguió por Bluetooth, pero al colgar y volver a llamar la oferta no llegó en 10 s (ni el «colgar» del vivo) y el Motorola vio al
// S24 «zombi». A la vez el S24 (y el vivo, como puente) le mandaban por Bluetooth, una y otra vez, lo pendiente a la TABLET: lejos
// (-89), conectada y con la app dormida (no contesta ni los pings). Cada vuelta: 6 pendientes (uno de 55 trozos), ~1,5 min de
// radio, y otra vez a los 15–120 s.
// El simulador tiene una cola por enlace (no la radio compartida del teléfono real), así que NO reproduce que la oferta se atasque;
// mide lo que sí depende de la app:
//  Z (tablet dormida): lo que A le manda por el aire a C (app congelada, sin pong nativo) en 150 s con 5 pendientes (uno largo).
//     Antes: vueltas enteras (todos los pendientes y el largo reanudado). Ahora: una prueba corta por vuelta.
//  U: C despierta: los 5 pendientes le llegan (la prueba se confirma y sigue todo) en ≤ 3 min.
//  L (llamada): C se va del alcance y A le deja 3 pendientes (uno largo); A llama a B por Bluetooth y, hablando, C vuelve al alcance.
//     Antes: A le manda lo pendiente a C en plena llamada. Ahora: espera a colgar (la radio es de la llamada), la voz sigue
//     llegando y al colgar le llega todo a C en ≤ 30 s.
// Uso: node radiollamada.js <dir_build>
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
  const r = { prueba: 'radiollamada', build: path.basename(buildDir) };
  const radio = new Radio();
  const nat = {}, P = {};
  ['A', 'B', 'C'].forEach((n, i) => {
    const h = n.repeat(2);
    // C = la tablet: su nativo tampoco contesta los pings con la app dormida (el S24 la vio «sin respuesta a 2 pings»)
    nat[n] = new NativePhone(n, [h, h, h, h, h, '0' + (i + 1)].join(':'), Object.assign({}, opts, n === 'C' ? { noNativePong: true } : {}));
    radio.add(nat[n]); nat[n].load();
  });
  P.A = await boot('A', nat.A); P.B = await boot('B', nat.B); P.C = await boot('C', nat.C);
  const id = (n) => P[n].win.bleInterface.localNexoId.toLowerCase();
  async function pair(x, y) {
    const others = ['A', 'B', 'C'].filter((n) => n !== x && n !== y);
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
  for (const [x, y] of [['A', 'B'], ['A', 'C']]) if (!(await pair(x, y))) { console.log('RADIOLLAMADA ' + JSON.stringify({ prueba: 'radiollamada', resultado: 'FALLO', error: 'no empareja ' + x + y })); process.exit(1); }
  await sleep(3000);
  // Lo que A le manda a C por el aire (como cliente a su dirección de anuncio o como servidor a la de iniciador)
  const macsC = new Set([norm(nat.C.address), norm(nat.C.initAddress)]);
  const bytesToC = () => nat.A.sent.filter((s) => macsC.has(s.to)).reduce((t, s) => t + (Buffer.isBuffer(s.chunk) ? s.chunk.length : Buffer.byteLength(String(s.chunk), 'utf8')), 0);

  // ---- Z: la tablet se duerme con 5 pendientes de A (4 cortos y uno largo) ----
  nat.C.setFrozen(true);
  await sleep(1000);
  await openChatWith(P.A, 'C');
  const largo = 'texto largo para la tablet. '.repeat(220); // ~6 KB: un flujo de muchos trozos (como el de 55 del S24)
  for (const t of ['uno', 'dos', largo, 'tres', 'cuatro']) { await sendText(P.A, t); await sleep(700); }
  await closeChat(P.A);
  await sleep(20000); // los envíos se rinden (sin confirmar) y quedan pendientes
  const z0 = bytesToC(), zl0 = logs.length;
  await sleep(150000);
  r.Z_bytes_a_C_150s = bytesToC() - z0;
  const zLogs = logs.slice(zl0);
  r.Z_vueltas = zLogs.filter((l) => /\[A\].*Reenviando \d+ pending para nx/i.test(l) && l.indexOf(id('C')) >= 0).length;
  r.Z_pruebas = zLogs.filter((l) => /\[A\].*no confirma ni la prueba/.test(l)).length;
  r.Z_reanuda_largo = zLogs.filter((l) => /\[A\].*Resume: \d+ outgoing para/.test(l) && l.indexOf(id('C')) >= 0).length;

  // ---- U: la tablet despierta: le llegan los 5 (la prueba se confirma y sigue todo) ----
  nat.C.setFrozen(false);
  const cTexts = async () => (await P.C.win.vaultLoadMessages(id('A'))).map((m) => String(m.content || m.text || ''));
  const has = (txt, list) => list.every((t) => txt.includes(t));
  r.U_le_llegan_los_5_s = await waitFor(async () => has(await cTexts(), ['uno', 'dos', 'tres', 'cuatro', largo.trim()]), 180000);
  await sleep(5000);

  // ---- L: llamada A→B por Bluetooth; a mitad de la llamada C vuelve al alcance con 3 pendientes de A ----
  radio.block(nat.A, nat.C); radio.block(nat.B, nat.C); // (sin puente por B: C vuelve solo con A)
  await sleep(4000);
  await openChatWith(P.A, 'C');
  const largo2 = 'segundo texto largo para la tablet'.repeat(180);
  for (const t of ['cinco', largo2, 'seis']) { await sendText(P.A, t); await sleep(700); }
  await closeChat(P.A);
  await sleep(3000);
  await openChatWith(P.A, 'B');
  click(P.A.win, P.A.win.document.getElementById('nexo-call-btn'));
  r.L_suena_en_B_s = await waitFor(() => { const c = P.B.win.bleInterface.calls.call; return c && c.state === 'ringing'; }, 20000);
  click(P.B.win, P.B.win.document.querySelector('#nexo-call-screen .call-accept'));
  r.L_en_llamada_s = await waitFor(() => { const a = P.A.win.bleInterface.calls.call, b = P.B.win.bleInterface.calls.call; return a && b && a.state === 'active' && b.state === 'active'; }, 20000);
  await sleep(2000);
  const ll0 = logs.length, voz0 = P.B.media.played.length, l0 = bytesToC();
  radio.unblock(nat.A, nat.C); // C vuelve al alcance (despierta): A se reconecta durante la llamada
  r.L_enlace_con_C_s = await waitFor(() => !!P.A.win.bleInterface._bleReadyFor(id('C')), 45000);
  await sleep(15000);
  const durante = await cTexts();
  r.L_llegan_durante_llamada = ['cinco', largo2, 'seis'].filter((t) => durante.includes(t)).length;
  r.L_bytes_a_C_en_llamada = bytesToC() - l0;
  r.L_voz_recibida_B = P.B.media.played.length - voz0;
  r.L_espera_dicha = logs.slice(ll0 - 50).some((l) => /\[A\].*En llamada: .*espera a colgar/.test(l));
  const tCall = Date.now();
  P.A.win.bleInterface.calls.hangup();
  r.L_llegan_tras_colgar_s = await waitFor(async () => has(await cTexts(), ['cinco', largo2, 'seis']), 60000);
  r.errores = logs.filter((l) => /Error procesando|No se pudo descifrar|ilegible/.test(l)).slice(0, 3);
  // Criterios (3058). Z: menos de 60 KB en 150 s (la 3057: vueltas enteras, ~126 KB); U: al despertar llegan los 5 en ≤ 3 min;
  // L: con C de vuelta durante la llamada, lo pendiente para C NO sale por Bluetooth mientras se habla (la 3057 lo manda al
  // momento), la voz sigue llegando (≥ 150 paquetes en ~20 s) y al colgar le llega todo en ≤ 30 s.
  r.Z_ok = r.Z_bytes_a_C_150s < 60000;
  r.L_ok = typeof r.L_en_llamada_s === 'number' && typeof r.L_enlace_con_C_s === 'number' && r.L_llegan_durante_llamada === 0 && r.L_voz_recibida_B >= 150 && typeof r.L_llegan_tras_colgar_s === 'number' && r.L_llegan_tras_colgar_s <= 30;
  r.U_ok = typeof r.U_le_llegan_los_5_s === 'number';
  const ok = r.Z_ok && r.L_ok && r.U_ok && !r.errores.length;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('RADIOLLAMADA ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_radiollamada.txt'), logs.join('\n'));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('RADIOLLAMADA {"prueba":"radiollamada","resultado":"FALLO","error":"' + String(e && e.message).replace(/"/g, "'") + '"}'); console.error(e && e.stack); fs.writeFileSync(path.join(__dirname, 'last_logs_radiollamada.txt'), logs.join('\n')); process.exit(1); });
