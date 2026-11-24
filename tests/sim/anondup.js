// 3303 (diagnóstico S24 23-11 08:27): el S24 sondeaba «de paso» una dirección anónima (código rotativo que no reconoce) que resultaba
// ser Alex, un contacto ya enlazado por otra dirección. Quedaba un 2.º enlace que el desempate cerraba 1–2 min después, y la misma
// dirección se volvía a sondear (08:22:49, 08:25:07, 08:27:31).
//  cierra      al identificarse como un contacto ya enlazado por otra dirección, la conexión de paso se cierra en el acto
//  no_resonda  la misma dirección vuelve a anunciarse (otro código): no se vuelve a sondear, cuenta como «visto» con su NEXO ID
//  sin_enlace  si el contacto NO tenía otro enlace, la conexión de paso se queda (es su único camino)
//  caduca      pasados 15 min la dirección vuelve a tratarse como anónima
// Uso: node anondup.js [dir_build]
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
  const ble = win.bleInterface, rel = ble.relay;
  const r = {}, mal = [], chk = (k, v) => { r[k] = !!v; if (!v) mal.push(k); };
  const ALEX = 'nx10b6f4ac', BETO = 'nx20c7e5bd';
  ble.addSharedContacts([{ nexoId: ALEX, name: 'Alex' }, { nexoId: BETO, name: 'Beto' }], null, { quiet: true });
  const OLD = 'F4:77:00:00:00:01', ANON = '40:AA:DA:AC:96:7E', ANON2 = '50:BB:00:00:00:02';
  const nm = (d) => d.toLowerCase().replace(/:/g, '');
  const setReady = (dev, nx) => { ble._deviceStates.set(nm(dev), { state: 'ready_to_chat' }); ble._macToNexoId.set(nm(dev), nx); };
  const disc = [], conn = [];
  ble.nativePlugin.disconnectDevice = (o) => { disc.push(o.deviceId); return Promise.resolve(); };
  ble.nativePlugin.connectToDevice = (o) => { conn.push(o.deviceId); return Promise.resolve(); };
  ble._linkRoom = () => true;
  // Alex ya enlazado por su dirección vieja
  setReady(OLD, ALEX);
  // 1. aparece una dirección anónima y se sondea de paso
  rel.noteAnon(ANON, 'Rabcdefghi', -60);
  r.sondea = rel._connectAnon(ANON, true) && conn.indexOf(ANON) >= 0;
  setReady(ANON, ALEX);
  rel.identify(ANON, ALEX);
  chk('cierra', disc.indexOf(ANON) >= 0);
  // 2. se desconecta y la misma dirección vuelve a anunciarse con otro código: no se vuelve a sondear
  ble._deviceStates.delete(nm(ANON));
  rel.noteAnon(ANON, 'Rjklmnopqr', -60);
  chk('no_resonda', !rel.anon.has(ANON.toLowerCase().replace(/:/g, '')) && rel.nearby.has(ALEX));
  // 3. Beto sin otro enlace: su conexión de paso se queda
  rel.noteAnon(ANON2, 'Rstuvwxyza', -60);
  rel._connectAnon(ANON2, true); setReady(ANON2, BETO);
  rel.identify(ANON2, BETO);
  chk('sin_enlace', disc.indexOf(ANON2) < 0);
  // 4. caduca a los 15 min
  const k = rel.anonKnown && rel.anonKnown.get(ANON.toLowerCase().replace(/:/g, '')); if (k) k.ts -= 16 * 60 * 1000;
  rel.noteAnon(ANON, 'Rbcdefghij', -60);
  chk('caduca', rel.anon.has(ANON.toLowerCase().replace(/:/g, '')));
  // 5. (24-11, S24 22:52) Vivo dormido: la conexión de paso se identifica por el nativo (peerReady sin kx) y no se cierra «sin uso»
  const VIVO = 'nx09acdb61', ANON3 = '64:30:1D:F8:98:A8';
  ble.addSharedContacts([{ nexoId: VIVO, name: 'Vivo' }], null, { quiet: true });
  rel.noteAnon(ANON3, 'Rqf4zxrj5n', -50);
  rel._connectAnon(ANON3, true); setReady(ANON3, VIVO);
  ble._notifyPeerReady(nm(ANON3), VIVO);
  chk('vivo_no_anon', !rel.transient.has('anon:' + nm(ANON3)));
  // y si quedara apuntada como anónima con su dirección ya de un contacto, tampoco se cierra por inactividad
  rel.transient.set('anon:' + nm(ANON3), { deviceId: ANON3, since: Date.now() - 300000, lastUse: Date.now() - 300000 });
  const d0 = disc.length; rel._closeIdleTransient(false);
  chk('vivo_no_cierra', disc.slice(d0).indexOf(ANON3) < 0 && !rel.transient.has('anon:' + nm(ANON3)));
  r.fallos = mal; r.resultado = mal.length ? 'FALLO' : 'OK';
  console.log('ANONDUP ' + JSON.stringify(r));
  try { win.close(); } catch (e) {}
  process.exit(mal.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
