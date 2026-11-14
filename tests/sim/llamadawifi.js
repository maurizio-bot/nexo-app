// 3097 (diagnóstico S24 3054 14-11 16:15–16:19, videollamada por Wi-Fi con el Xiaomi): «En llamada: lo pendiente para nx1e50c95d
// por Bluetooth espera a colgar (la radio es de la llamada)»: lo del S23 (solo por Bluetooth) esperó 4,5 min, y la llamada iba por
// Wi-Fi: el Bluetooth no lo usaba nadie. La regla de la 3058 (con una llamada en curso, lo de fondo por Bluetooth espera) solo tiene
// sentido si la llamada va por Bluetooth.
// A y B en el mismo Wi-Fi; C solo por Bluetooth. C se va con 3 pendientes de A (uno largo); A llama a B (por Wi-Fi) y, hablando, C
// vuelve al alcance:
//  W1  la llamada va por Wi-Fi;
//  W2  lo pendiente para C le llega DURANTE la llamada (≤ 25 s desde que vuelve; antes, solo al colgar);
//  W3  la voz sigue llegando a B (≥ 120 paquetes en ~25 s);
//  W4  al colgar no queda nada pendiente para C.
// (La llamada por Bluetooth sigue reservando la radio: radiollamada.js L.)
// Uso: node llamadawifi.js <dir_build>
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone, installWebCrypto } = require('./native_mock');

const buildDir = path.resolve(process.argv[2]);
const opts = { readsContentFallback: true, retain: ['onPayloadReceived', 'onLanMessage', 'onLanUp', 'onLanDown'], closeOnNoService: true, pace: [15, 15], ioDelay: 25, asymmetric: true, supervisionMs: 3000, noTor: true };
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
  const r = { prueba: 'llamadawifi', build: path.basename(buildDir) };
  const radio = new Radio();
  const nat = {}, P = {};
  ['A', 'B', 'C'].forEach((n, i) => {
    const h = n.repeat(2);
    nat[n] = new NativePhone(n, [h, h, h, h, h, '0' + (i + 1)].join(':'), Object.assign({}, opts, n !== 'C' ? { wifi: 'casa' } : {}));
    radio.add(nat[n]); nat[n].load();
  });
  radio.block(nat.B, nat.C); // B nunca ve a C (sin puente Jump por B: como el S24, que solo tenía al S23 por Bluetooth)
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
  for (const [x, y] of [['A', 'B'], ['A', 'C']]) if (!(await pair(x, y))) { console.log('LLAMADAWIFI ' + JSON.stringify({ prueba: 'llamadawifi', resultado: 'FALLO', error: 'no empareja ' + x + y })); process.exit(1); }
  const lanA = () => P.A.win.bleInterface.lan;
  r.wifi_ab_s = await waitFor(() => !!(lanA() && lanA().canReach(id('B'))), 40000);
  // C se va con 3 pendientes de A
  radio.block(nat.A, nat.C);
  await waitFor(() => !P.A.win.bleInterface._bleReadyFor(id('C')), 30000);
  await sleep(2000);
  await openChatWith(P.A, 'C');
  const largo = 'texto largo para el que solo va por Bluetooth '.repeat(150).trim();
  for (const t of ['siete', largo, 'ocho']) { await sendText(P.A, t); await sleep(700); }
  await closeChat(P.A);
  await sleep(3000);
  // A llama a B (por Wi-Fi)
  await openChatWith(P.A, 'B');
  click(P.A.win, P.A.win.document.getElementById('nexo-call-btn'));
  r.suena_en_B_s = await waitFor(() => { const c = P.B.win.bleInterface.calls.call; return c && c.state === 'ringing'; }, 20000);
  click(P.B.win, P.B.win.document.querySelector('#nexo-call-screen .call-accept'));
  r.en_llamada_s = await waitFor(() => { const a = P.A.win.bleInterface.calls.call, b = P.B.win.bleInterface.calls.call; return a && b && a.state === 'active' && b.state === 'active'; }, 20000);
  await sleep(2000);
  r.W1_camino = String(P.A.win.bleInterface.calls._link(id('B')) || '').replace(/:.*/, '');
  const ll0 = logs.length, voz0 = P.B.media.played.length;
  const cTexts = async () => (await P.C.win.vaultLoadMessages(id('A'))).map((m) => String(m.content || m.text || ''));
  const has = (txt, list) => list.every((t) => txt.includes(t));
  radio.unblock(nat.A, nat.C); // C vuelve al alcance durante la llamada
  const tBack = Date.now();
  r.enlace_con_C_s = await waitFor(() => !!P.A.win.bleInterface._bleReadyFor(id('C')), 45000);
  const w2 = await waitFor(async () => has(await cTexts(), ['siete', largo, 'ocho']), 25000);
  r.W2_llegan_en_llamada_s = w2 === null ? null : Math.round((Date.now() - tBack) / 100) / 10;
  const dur = await cTexts(); r.W2_llegan = ['siete', largo, 'ocho'].filter((t) => dur.includes(t)).length;
  r.W2_seguia_en_llamada = !!(P.A.win.bleInterface.calls.call && P.A.win.bleInterface.calls.call.state === 'active');
  r.W2_espera_dicha = logs.slice(ll0 - 50).some((l) => /\[A\].*En llamada: .*espera a colgar/.test(l));
  await sleep(Math.max(0, 25000 - (Date.now() - tBack)));
  r.W3_voz_recibida_B = P.B.media.played.length - voz0;
  P.A.win.bleInterface.calls.hangup();
  r.W4_todo_tras_colgar_s = await waitFor(async () => has(await cTexts(), ['siete', largo, 'ocho']), 60000);
  r.errores = logs.filter((l) => /Error procesando|No se pudo descifrar|ilegible/.test(l)).slice(0, 3);
  const ok = typeof r.en_llamada_s === 'number' && r.W1_camino === 'lan' && r.W2_llegan === 3 && r.W2_seguia_en_llamada && r.W3_voz_recibida_B >= 120 &&
    typeof r.W4_todo_tras_colgar_s === 'number' && !r.errores.length;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('LLAMADAWIFI ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_llamadawifi.txt'), logs.join('\n'));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('LLAMADAWIFI {"prueba":"llamadawifi","resultado":"FALLO","error":"' + String(e && e.message).replace(/"/g, "'") + '"}'); console.error(e && e.stack); fs.writeFileSync(path.join(__dirname, 'last_logs_llamadawifi.txt'), logs.join('\n')); process.exit(1); });
