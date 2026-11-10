// Diagnóstico del dueño (S24, build 2993, 10-11 12:39): al mandar el APK de 25 MB al vivo, el receptor pedía «faltan 0…95» (NACK) cada
// ~150 ms y cada aviso reenviaba todos esos trozos y, al fallar el envío (los relés no respondían), encadenaba otra vuelta de la ventana:
// ~100 reenvíos de la misma ventana en 10 s y el registro lleno de «handleNack». 2995: UN reenvío por NACK en curso (los que llegan mientras
// tanto se juntan y se atienden de una vez) y una sola cadena de reenvío de ventana a la vez.
// Prueba: un teléfono, un flujo de 30 trozos a un contacto de internet; se le tiran 60 NACK en 6 s con el envío de trozos fallando
// (como «Los relés no respondieron»). Con la 2993: cientos de envíos de trozos y decenas de _retransmitWindow; ahora: pocos.
// Uso: node nackstorm.js <dir_build>
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
  const r = { prueba: 'nackstorm', build: path.basename(buildDir) };
  const dst = 'nx1abcdefgh';
  win.bleInterface.net.send = async function () { return { ok: true }; };
  AS.sendChunkedMessage('net:' + dst, 'E1:' + 'A'.repeat(200000), { dst, sealedFrom: 'nx0test0000' }, 'mtestnack1', 1, true).catch(() => {});
  let st = null;
  for (let i = 0; i < 50 && !st; i++) { await sleep(200); st = AS.outgoingStreams.get('mtestnack1'); }
  r.hay_flujo = !!st && st.total >= 20;
  if (!st) { r.resultado = 'FALLO'; console.log('NACKSTORM ' + JSON.stringify(r)); process.exit(1); }
  // el envío de trozos falla (relés que no responden) y se cuentan los intentos
  let sends = 0;
  st._sendChunk = function () { sends++; return Promise.reject(new Error('Los relés no respondieron (1)')); };
  st._sendFailed = function () { return false; };
  const t0 = Date.now();
  const idx = []; for (let i = 0; i < Math.min(st.total, 30); i++) idx.push(i);
  for (let k = 0; k < 60; k++) { AS._handleNack({ m: 'mtestnack1', k: idx }); await sleep(100); }
  await sleep(2500);
  const retx = logs.filter((l) => l.t >= t0 && /_retransmitWindow: \[/.test(l.s) && /mtestnack1/.test(l.s)).length;
  const nackLogs = logs.filter((l) => l.t >= t0 && /handleNack:/.test(l.s) && /mtestnack1/.test(l.s)).length;
  r.envios_de_trozos = sends; r.reenvios_de_ventana = retx; r.lineas_handleNack = nackLogs;
  // 60 avisos en 6 s sin freno → ~1800 envíos de trozos y decenas de vueltas de ventana. Con el freno: unas pocas rondas.
  const ok = r.hay_flujo && sends <= 400 && retx <= 12 && nackLogs <= 12;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('NACKSTORM ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_nackstorm.txt'), logs.map((l) => l.s).join('\n'));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('NACKSTORM ' + JSON.stringify({ prueba: 'nackstorm', resultado: 'FALLO', error: String(e && e.message) })); process.exit(1); });
