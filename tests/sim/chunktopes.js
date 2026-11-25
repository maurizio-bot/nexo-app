// Revisión 24-11 (topes de lo que llega troceado, contra alguien cerca que manda trozos a mano para llenar la memoria):
//  entero      idx/total que no son enteros (1.5, NaN, Infinity) no abren nada
//  tipo        un trozo que no es texto no entra
//  grande      un trozo de más de 64 K caracteres no entra (ninguno legítimo pasa de 24 000)
//  por_enlace  de un mismo enlace, como mucho 64 mensajes a medias; otro enlace sigue atendido
//  memoria     un mensaje que pasa del tope de memoria se descarta entero
//  normal      un mensaje legítimo de 3 trozos de 360 sigue abriéndose y guardando sus trozos
// Uso: node chunktopes.js [dir_build]
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone, installWebCrypto } = require('./native_mock');

const buildDir = path.resolve(process.argv[2] || path.join(__dirname, 'builds/wip'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
class DL extends ResourceLoader { constructor(d) { super(); this.d = d; } fetch(u) { const f = path.join(this.d, decodeURIComponent(new URL(u).pathname)); return fs.existsSync(f) ? Promise.resolve(fs.readFileSync(f)) : Promise.reject(new Error('x')); } }

(async () => {
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', { readsContentFallback: true, retain: ['onPayloadReceived'] });
  radio.add(nA); nA.load(); nA.listeners = new Map();
  const vc = new VirtualConsole();
  const dom = new JSDOM(fs.readFileSync(path.join(buildDir, 'dist', 'index.html'), 'utf8'), { url: 'https://a.nexo.test/index.html', runScripts: 'dangerously', resources: new DL(path.join(buildDir, 'dist')), pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) { win.CapacitorCustomPlatform = { name: 'android' }; installWebCrypto(win); win.Capacitor = { Plugins: { NexoBLE: nA.plugin() } }; win.HTMLElement.prototype.scrollTo = function () {}; } });
  const win = dom.window; for (let i = 0; i < 100 && !(win.NEXO && win.NEXO.initialized); i++) await sleep(100); await sleep(800);
  const ack = win.bleInterface.ackSystem;
  ack._sendNack = () => {}; ack._sendFinalAck = () => {};
  const r = {}, mal = [], chk = (k, v) => { r[k] = !!v; if (!v) mal.push(k); };
  const X = 'CC:CC:CC:CC:CC:01', Y = 'DD:DD:DD:DD:DD:02';
  const ch = (dev, m, i, n, d) => ack._handleIncomingChunk(dev, { m, i, n, d, fr: 'nx12345678', tp: 'file' }, 'f');
  const has = (m) => ack.incomingBuffers.has(m);
  ch(X, 'e1', 0, 1.5, 'x'); ch(X, 'e2', 0, NaN, 'x'); ch(X, 'e3', 0, Infinity, 'x'); ch(X, 'e4', 0.5, 2, 'x');
  chk('entero', !has('e1') && !has('e2') && !has('e3') && !has('e4'));
  ch(X, 't1', 0, 2, { a: 1 }); ch(X, 't2', 0, 2, [1, 2]);
  chk('tipo', !has('t1') && !has('t2'));
  ch(X, 'g1', 0, 2, 'x'.repeat(70000));
  chk('grande', !has('g1'));
  ch(X, 'ok1', 0, 3, 'a'.repeat(360));
  chk('normal', has('ok1') && ack.incomingBuffers.get('ok1').chunks.get(0).length === 360);
  for (let i = 0; i < 80; i++) ch(X, 'p' + i, 0, 3, 'b');
  const deX = Array.from(ack.incomingBuffers.values()).filter((b) => b.deviceId === X).length;
  ch(Y, 'otroY', 0, 3, 'c');
  r.a_medias_de_X = deX;
  chk('por_enlace', deX <= 64 && deX >= 60 && has('otroY'));
  const b = ack.incomingBuffers.get('otroY'); b.mem = 64000000 - 10;
  ch(Y, 'otroY', 1, 3, 'd'.repeat(100));
  chk('memoria', !has('otroY'));
  r.fallos = mal; r.resultado = mal.length ? 'FALLO' : 'OK';
  console.log('CHUNKTOPES ' + JSON.stringify(r));
  try { win.close(); } catch (e) {}
  process.exit(mal.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
