// Diagnóstico del dueño (S24, build 2984, 10-11 05:37): dos envíos pendientes a contactos de SOLO internet AUSENTES (net:…) arrancaron al abrir
// la app («Resume: N outgoing») y repetían «Ventana sin ACK con el enlace caído: espero a que vuelva» + «Timer iniciado (3800ms)» cada 3,8 s sin
// parar (hasta 2 h en memoria): ~950 vueltas por hora por flujo, y el registro de 30 min del diagnóstico quedaba casi todo lleno de esas
// líneas (se tapaban las demás). 2985: con el enlace caído la espera crece (3,8 s → 7,6 → 15 → 30 s, tope) y vuelve a 3,8 s en cuanto el
// enlace está arriba o llegan ACKs; no se gasta reintento ni se aborta (igual que antes).
// Prueba: un teléfono; un flujo por trozos a «net:nx1…» ausente (sin relés); se cuentan los vencimientos de ventana en 45 s. Con la 2984:
// ~11; con la 2985: ≤ 5 (y ≥ 3: sigue esperando).
// Uso: node winbackoff.js <dir_build>
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone, installWebCrypto } = require('./native_mock');

const buildDir = path.resolve(process.argv[2]);
const base = { readsContentFallback: true, retain: ['onPayloadReceived'], closeOnNoService: true, pace: [15, 15], ioDelay: 25, asymmetric: true, noTor: true };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
class DL extends ResourceLoader { constructor(d) { super(); this.d = d; } fetch(u) { const f = path.join(this.d, decodeURIComponent(new URL(u).pathname)); return fs.existsSync(f) ? Promise.resolve(fs.readFileSync(f)) : Promise.reject(new Error('no existe ' + f)); } }
const logs = [];
(async () => {
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', base);
  radio.add(nA); nA.load();
  const vc = new VirtualConsole();
  ['log', 'warn', 'error'].forEach((l) => vc.on(l, (...a) => logs.push({ t: Date.now(), s: a.map(String).join(' ').substring(0, 250) })));
  const dom = new JSDOM(fs.readFileSync(path.join(buildDir, 'dist', 'index.html'), 'utf8'), {
    url: 'https://a.nexo.test/index.html', runScripts: 'dangerously', resources: new DL(path.join(buildDir, 'dist')), pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) { win.CapacitorCustomPlatform = { name: 'android' }; installWebCrypto(win); win.Capacitor = { Plugins: { NexoBLE: nA.plugin() } }; win.HTMLElement.prototype.scrollTo = function () {}; },
  });
  const win = dom.window;
  for (let i = 0; i < 100 && !(win.NEXO && win.NEXO.initialized); i++) await sleep(100);
  await sleep(1000);
  const AS = win.bleInterface.ackSystem;
  const r = { prueba: 'winbackoff', build: path.basename(buildDir) };
  const dst = 'nx1abcdefgh';
  // Como en el teléfono: el trozo SALE (al buzón de los relés) pero el contacto está ausente y nunca confirma
  win.bleInterface.net.send = async function () { return { ok: true }; };
  const t0 = Date.now();
  AS.sendChunkedMessage('net:' + dst, 'E1:' + 'A'.repeat(5000), { dst, sealedFrom: 'nx0test0000' }, 'mtestbackoff1', 1, true).catch(() => {});
  await sleep(45000);
  const timeouts = logs.filter((l) => l.t >= t0 && /_onWindowTimeout\./.test(l.s) && /mtestbackoff1/.test(l.s)).length;
  const esperas = logs.filter((l) => l.t >= t0 && /Ventana sin ACK con el enlace caído/.test(l.s) && /mtestbackoff1/.test(l.s)).length;
  const gastaReintento = logs.some((l) => /mtestbackoff1/.test(l.s) && /(Reintento|reintento) [0-9]/.test(l.s) && !/no gasta/.test(l.s));
  r.vencimientos_45s = timeouts; r.esperas_enlace_caido = esperas; r.sigue_vivo = !logs.some((l) => /GLOBAL TIMEOUT.*mtestbackoff1|abort.*mtestbackoff1/i.test(l.s));
  r.arranco = logs.some((l) => /START msgId=mtestbackoff1/.test(l.s));
  const ok = r.arranco && esperas >= 3 && timeouts <= 5 && r.sigue_vivo;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('WINBACKOFF ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_winbackoff.txt'), logs.map((l) => l.s).join('\n'));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('WINBACKOFF ' + JSON.stringify({ prueba: 'winbackoff', resultado: 'FALLO', error: String(e && e.message) })); process.exit(1); });
