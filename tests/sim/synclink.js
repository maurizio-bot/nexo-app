// Auditoría M6 (2998): la sincronización de sesión («ss»/«sr») llega SIN firmar. Una «ss» falsa de un desconocido (o de otro enlace que dice ser
// tu contacto) hacía reenviar los propios mensajes y revelaba el último número de secuencia. Ahora solo se atiende si el NEXO ID declarado es el
// dueño CONOCIDO de ese enlace. Prueba: un teléfono; enlace Bluetooth conocido (MAC→contacto) y otro desconocido; Wi-Fi por su id.
// Uso: node synclink.js <dir_build>
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
  const bi = win.bleInterface, AS = bi.ackSystem;
  const r = { prueba: 'synclink', build: path.basename(buildDir) };
  let sent = 0, resent = 0;
  win.vaultLoadMessages = function () { return Promise.resolve([]); };
  bi._sendMessageNative = function () { sent++; return Promise.resolve(); };
  bi._resendPendingMessages = function () { resent++; };
  const macOk = 'AA:BB:CC:DD:EE:01', macOther = 'AA:BB:CC:DD:EE:02';
  bi._macToNexoId.set(macOk.toLowerCase().replace(/:/g, ''), 'nx0amigo01'); bi._macToNexoId.set(macOk.toUpperCase(), 'nx0amigo01'); bi._macToNexoId.set(macOk.toLowerCase(), 'nx0amigo01');
  const tryss = async (dev, fr) => { sent = 0; AS._handleSessionSync(dev, { t: 'ss', fr, l: 5 }); await sleep(150); return sent; };
  const tryr = async (dev, fr) => { resent = 0; AS._handleSessionSyncResponse(dev, { t: 'sr', fr, l: 5 }); await sleep(150); return resent; };
  r.ss_dueno_real_responde = (await tryss(macOk, 'nx0amigo01')) === 1;
  r.ss_suplantado_ignorado = (await tryss(macOk, 'nx0otro002')) === 0;           // el enlace es de A, dice ser otro
  r.ss_enlace_desconocido_ignorado = (await tryss(macOther, 'nx0amigo01')) === 0; // enlace sin dueño conocido
  r.ss_sin_id_ignorado = (await tryss(macOk, '')) === 0;
  r.ss_wifi_por_su_id = (await tryss('lan:nx0lan0003', 'nx0lan0003')) === 1;
  r.ss_wifi_suplantado_ignorado = (await tryss('lan:nx0lan0003', 'nx0amigo01')) === 0;
  r.sr_dueno_real_reenvia = (await tryr(macOk, 'nx0amigo01')) === 1;
  r.sr_suplantado_ignorado = (await tryr(macOk, 'nx0otro002')) === 0;
  r.sr_desconocido_ignorado = (await tryr(macOther, 'nx0amigo01')) === 0;
  r.errores = logs.filter((l) => / error: /.test(l) && !/JSDOMERROR|styles\.css|Not implemented|GLOBAL TIMEOUT|Assembly timeout|net::ERR|fetch/.test(l)).slice(0, 5);
  const ok = Object.keys(r).filter((k) => /^s[sr]_/.test(k)).every((k) => r[k] === true) && r.errores.length === 0;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('SYNCLINK ' + JSON.stringify(r));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('SYNCLINK ' + JSON.stringify({ prueba: 'synclink', resultado: 'FALLO', error: String(e && e.message) })); process.exit(1); });
