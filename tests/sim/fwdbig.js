// Dueño 10-11: mandó un APK de 25 MB a un contacto; ese contacto lo REENVIÓ A 10 CONTACTOS y la app se cerró (cada reenvío tenía el archivo
// entero en memoria varias veces, los 10 a la vez). 2995: un adjunto GRANDE se reenvía de a UN contacto (se lee una sola vez y el siguiente
// empieza cuando el anterior termina o queda pendiente); lo chico sigue yendo a la vez. Prueba: un teléfono con sendFile simulado (tarda
// 400 ms) y 6 destinatarios. Grande (2 MB de base64): nunca más de 1 envío a la vez y salen los 6. Chico: salen a la vez.
// Uso: node fwdbig.js <dir_build>
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone, installWebCrypto } = require('./native_mock');

const buildDir = path.resolve(process.argv[2]);
const base = { readsContentFallback: true, retain: ['onPayloadReceived'], closeOnNoService: true, pace: [15, 15], ioDelay: 0, asymmetric: true, noTor: true };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
class DL extends ResourceLoader { constructor(d) { super(); this.d = d; } fetch(u) { const f = path.join(this.d, decodeURIComponent(new URL(u).pathname)); return fs.existsSync(f) ? Promise.resolve(fs.readFileSync(f)) : Promise.reject(new Error('no existe ' + f)); } }
const logs = [];
(async () => {
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', base);
  radio.add(nA); nA.load();
  const vc = new VirtualConsole();
  ['log', 'warn', 'error'].forEach((l) => vc.on(l, (...a) => logs.push(`[A] ${l}: ` + a.map(String).join(' ').substring(0, 250))));
  const dom = new JSDOM(fs.readFileSync(path.join(buildDir, 'dist', 'index.html'), 'utf8'), {
    url: 'https://a.nexo.test/index.html', runScripts: 'dangerously', resources: new DL(path.join(buildDir, 'dist')), pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) { win.CapacitorCustomPlatform = { name: 'android' }; installWebCrypto(win); win.Capacitor = { Plugins: { NexoBLE: nA.plugin() } }; win.HTMLElement.prototype.scrollTo = function () {}; },
  });
  const win = dom.window;
  for (let i = 0; i < 100 && !(win.NEXO && win.NEXO.initialized); i++) await sleep(100);
  await sleep(800);
  const r = { prueba: 'fwdbig', build: path.basename(buildDir) };
  r.gancho = typeof win.__nexoForwardMany === 'function';
  let inflight = 0, maxIn = 0, calls = [];
  win.bleInterface.sendFile = function (cid, mid, payload) { calls.push(cid); inflight++; maxIn = Math.max(maxIn, inflight); return new Promise((res) => setTimeout(() => { inflight--; res(); }, 400)); };
  const ids = ['nx0test0a1', 'nx0test0a2', 'nx0test0a3', 'nx0test0a4', 'nx0test0a5', 'nx0test0a6'];
  const mk = (n) => ({ msgId: 'mfwd' + n, attachmentType: 'file', attachmentPayload: 'A'.repeat(n), attachmentMeta: { name: 'x.apk', size: Math.floor(n * 3 / 4), mime: 'application/vnd.android.package-archive' } });
  // GRANDE: de a uno
  const t0 = Date.now();
  await win.__nexoForwardMany(ids, mk(2000000));
  r.grande_enviados = calls.length; r.grande_max_a_la_vez = maxIn; r.grande_ms = Date.now() - t0;
  // CHICO: a la vez
  calls = []; inflight = 0; maxIn = 0;
  await win.__nexoForwardMany(ids, mk(300000));
  await sleep(600);
  r.chico_enviados = calls.length; r.chico_max_a_la_vez = maxIn;
  r.errores = logs.filter((l) => / error: /.test(l) && !/JSDOMERROR|styles\.css|Not implemented|GLOBAL TIMEOUT|Assembly timeout|net::ERR|fetch/.test(l)).slice(0, 5);
  const ok = r.gancho && r.grande_enviados === 6 && r.grande_max_a_la_vez === 1 && r.grande_ms >= 6 * 350 && r.chico_enviados === 6 && r.chico_max_a_la_vez > 1 && r.errores.length === 0;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('FWDBIG ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_fwdbig.txt'), logs.join('\n'));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('FWDBIG ' + JSON.stringify({ prueba: 'fwdbig', resultado: 'FALLO', error: String(e && e.message) })); process.exit(1); });
