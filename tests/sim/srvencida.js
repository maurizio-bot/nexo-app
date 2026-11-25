// 3339 (diag. S24 3154 25-11 10:57): tres respuestas de sincronía («sr») de la S23 llegaron con la app en segundo plano y entraron al
// volver, ya vencidas (su número al azar dura 2 min): se ignoraban (bien, seguridad C-N10) y la sincronía quedaba sin hacer. Ahora,
// al ignorar una, se vuelve a pedir UNA vez (como mucho una por minuto y contacto). Contraprueba: el código anterior no vuelve a pedir.
// Uso: node srvencida.js <dir_build>
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone, installWebCrypto } = require('./native_mock');

const buildDir = path.resolve(process.argv[2] || path.join(__dirname, 'builds/wip'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
class DL extends ResourceLoader { constructor(d) { super(); this.d = d; } fetch(u) { const f = path.join(this.d, decodeURIComponent(new URL(u).pathname)); return fs.existsSync(f) ? Promise.resolve(fs.readFileSync(f)) : Promise.reject(new Error('x')); } }
const logs = [];
(async () => {
  const r = { prueba: 'srvencida', build: path.basename(buildDir) };
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', { readsContentFallback: true, retain: ['onPayloadReceived'] });
  radio.add(nA); nA.load();
  const vc = new VirtualConsole();
  ['log', 'warn', 'error'].forEach((l) => vc.on(l, (...a) => logs.push(`[A] ${l}: ` + a.map(String).join(' ').substring(0, 200))));
  const dom = new JSDOM(fs.readFileSync(path.join(buildDir, 'dist', 'index.html'), 'utf8'), {
    url: 'https://a.nexo.test/index.html', runScripts: 'dangerously', resources: new DL(path.join(buildDir, 'dist')), pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) { win.CapacitorCustomPlatform = { name: 'android' }; installWebCrypto(win); win.Capacitor = { Plugins: { NexoBLE: nA.plugin() } }; win.HTMLElement.prototype.scrollTo = function () {}; },
  });
  const win = dom.window;
  for (let i = 0; i < 100 && !(win.NEXO && win.NEXO.initialized); i++) await sleep(100);
  await sleep(500);
  const ack = win.bleInterface.ackSystem, NX = 'nx1e50c95d', DEV = 'net:' + NX;
  const asked = [];
  ack.sendSessionSync = (d, nx) => asked.push(d + '|' + nx);
  ack._srSigned = () => Promise.resolve(false); // la respuesta llegó vencida (su número ya no vale) o sin firma
  const sr = () => ack._handleSessionSyncResponse(DEV, { v: 2, t: 'sr', fr: NX, l: 0, n: '0123456789abcdef', a: 'x' });
  sr(); sr(); sr(); await sleep(400);
  r.repedidas = asked.length;
  r.a_quien = asked[0] || null;
  r.errores = logs.filter((l) => / error: /.test(l) && !/JSDOMERROR|styles\.css|Not implemented/.test(l)).slice(0, 5);
  const ok = r.repedidas === 1 && r.a_quien === DEV + '|' + NX && !r.errores.length;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('SRVENCIDA ' + JSON.stringify(r));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('SRVENCIDA ' + JSON.stringify({ prueba: 'srvencida', resultado: 'FALLO', error: String(e && e.message) })); process.exit(1); });
