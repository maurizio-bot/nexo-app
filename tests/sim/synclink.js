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
  // C-N10 (auditoría 23-11): con un contacto de protocolo 2 el «sr» solo vale firmado con el secreto de la pareja y atado al número del
  // «ss» que mandé por ESE enlace (< 2 min, una vez). La firma «buena» se fabrica aquí con el mismo teléfono haciéndose pasar por el otro
  // (el secreto de pareja es el mismo en los dos lados): A contesta a un «ss» de sí mismo con los NEXO ID cambiados.
  const kp = await win.crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const pub = Buffer.from(await win.crypto.subtle.exportKey('raw', kp.publicKey)).toString('base64');
  if (!bi.localNexoId) bi.localNexoId = 'nx0yomismo';
  const me = bi.localNexoId, peer = 'nx0amigo01';
  r.mi_id = me;
  const oContact = AS._contactOf;
  AS._contactOf = function (d, nx) { return { nexoId: nx, proto: 2, publicKey: pub }; };
  let lastOut = null;
  bi._sendMessageNative = function (dev, payload) { sent++; lastOut = JSON.parse(payload); return Promise.resolve(); };
  const askSs = async () => { lastOut = null; AS.sendSessionSync(macOk, peer); await sleep(200); return lastOut; };
  // el «sr» que mandaría el contacto de verdad: se fabrica con A haciendo de él
  const forge = async (n, l) => {
    const oMe = bi.localNexoId; bi.localNexoId = peer;
    const ml = me.toLowerCase(); bi._macToNexoId.set(macOther.toLowerCase(), ml); bi._macToNexoId.set(macOther.toUpperCase(), ml); bi._macToNexoId.set(macOther.toLowerCase().replace(/:/g, ''), ml);
    lastOut = null; AS._handleSessionSync(macOther, { t: 'ss', fr: me, l: 0, n }); await sleep(250);
    bi.localNexoId = oMe; [macOther.toLowerCase(), macOther.toUpperCase(), macOther.toLowerCase().replace(/:/g, '')].forEach((k) => bi._macToNexoId.delete(k));
    return lastOut;
  };
  const trySr = async (m) => { resent = 0; AS._handleSessionSyncResponse(macOk, m || { t: 'sr', fr: peer }); await sleep(250); return resent; };
  const ss1 = await askSs();
  r.ss_lleva_numero = !!(ss1 && /^[0-9a-f]{16}$/.test(ss1.n));
  const good = await forge(ss1.n, 0);
  r.sr_respuesta_firmada = !!(good && good.t === 'sr' && good.n === ss1.n && typeof good.a === 'string' && good.a.length > 8);
  r.sr_n10_sin_firma_ignorado = (await trySr({ t: 'sr', fr: peer, l: 0, n: ss1.n })) === 0;
  r.sr_n10_firma_buena_reenvia = (await trySr(good)) === 1;
  r.sr_n10_repetido_ignorado = (await trySr(good)) === 0;           // el número ya se gastó
  const ss2 = await askSs();
  r.sr_n10_numero_viejo_ignorado = (await trySr(good)) === 0;       // firma vieja con número que no es el pedido ahora
  const good2 = await forge(ss2.n, 0);
  r.sr_n10_otro_l_ignorado = (await trySr(Object.assign({}, good2, { l: 7 }))) === 0; // l cambiado: la firma no cuadra
  // 24-11 (diagnóstico S24 08:41: las respuestas de Roberto, 3142, todas «sin firma válida»): dos «ss» seguidas al mismo contacto (al conectar
  // y al volver la app); la respuesta firmada de la PRIMERA también vale (antes la segunda pisaba el número y se rechazaba)
  const ss3 = await askSs(); const ss4 = await askSs();
  const good3 = await forge(ss3.n, 0), good4 = await forge(ss4.n, 0);
  r.sr_n10_dos_seguidas_primera = (await trySr(good3)) === 1;
  r.sr_n10_dos_seguidas_segunda = (await trySr(good4)) === 1;
  AS._ssNonces && AS._ssNonces.clear();
  r.sr_n10_sin_ss_ignorado = (await trySr(good2)) === 0;            // nadie se lo pidió
  AS._contactOf = oContact;
  r.errores = logs.filter((l) => / error: /.test(l) && !/JSDOMERROR|styles\.css|Not implemented|GLOBAL TIMEOUT|Assembly timeout|net::ERR|fetch/.test(l)).slice(0, 5);
  const ok = Object.keys(r).filter((k) => /^s[sr]_/.test(k)).every((k) => r[k] === true) && r.errores.length === 0;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('SYNCLINK ' + JSON.stringify(r));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('SYNCLINK ' + JSON.stringify({ prueba: 'synclink', resultado: 'FALLO', error: String(e && e.stack).slice(0, 600) })); process.exit(1); });
