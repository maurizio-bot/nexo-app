// 3185 (AREAS «medición engañosa»; diagnósticos de Yaelito 15-11: «internet listo en» de media 90,7 s y máximo 452 s, con un
// diagnóstico en «red: ninguna»): la medida de cuánto tarda NEXO en tener internet contaba también el tiempo en que el TELÉFONO no tenía
// red (el reloj arrancaba al reintentar los relés aunque no hubiera red, y al volver se anotaba esa espera entera). Ahora sin red (aviso
// «sin red» del sistema) el reloj se para, y al volver la red se mide desde que volvió; una sola medida por vuelta.
// Un teléfono A con un relé de prueba: conecta; se queda SIN RED 30 s (el sistema avisa «sin red» y los relés no conectan); vuelve el
// Wi-Fi. Se leen los «[VELOCIDAD] internet listo en N s» anotados después de volver: el mayor debe ser corto (< 6 s), no los ~30 s sin red.
// Contraprueba: build anterior → ~30 s. Uso: node internetlisto.js <dir_build>
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone, installWebCrypto } = require('./native_mock');
const { NostrRelay } = require('./nostr_relay');

const buildDir = path.resolve(process.argv[2]);
const base = { readsContentFallback: true, retain: ['onPayloadReceived'], closeOnNoService: true, pace: [15, 15], ioDelay: 25, noTor: true };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
class DL extends ResourceLoader { constructor(d) { super(); this.d = d; } fetch(u) { const f = path.join(this.d, decodeURIComponent(new URL(u).pathname)); return fs.existsSync(f) ? Promise.resolve(fs.readFileSync(f)) : Promise.reject(new Error('x')); } }
const logs = [];
const T0 = Date.now();
const ts = () => String(((Date.now() - T0) / 1000).toFixed(1)).padStart(6) + 's';
// Sin red: ningún relé contesta
class NoNetWS { constructor(u) { this.url = u; this.readyState = 0; setTimeout(() => { this.readyState = 3; if (this.onerror) this.onerror({}); if (this.onclose) this.onclose({}); }, 30); } send() { throw new Error('sin red'); } close() {} }

(async () => {
  const r = { prueba: 'internetlisto', build: path.basename(buildDir) };
  const relay = new NostrRelay();
  const RELAYS = [await relay.start()];
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', Object.assign({ wifi: 'casa' }, base));
  radio.add(nA); nA.load();
  const vc = new VirtualConsole();
  ['log', 'warn', 'error'].forEach((l) => vc.on(l, (...a) => logs.push(`${ts()} [A] ${l}: ` + a.map(String).join(' ').substring(0, 260))));
  const dom = new JSDOM(fs.readFileSync(path.join(buildDir, 'dist', 'index.html'), 'utf8'), {
    url: 'https://a.nexo.test/index.html', runScripts: 'dangerously', resources: new DL(path.join(buildDir, 'dist')), pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) {
      win.NEXO_NET_RELAYS = RELAYS; win.CapacitorCustomPlatform = { name: 'android' }; installWebCrypto(win);
      win.Capacitor = { Plugins: { NexoBLE: nA.plugin() } }; win.HTMLElement.prototype.scrollTo = function () {};
      const Real = win.WebSocket; win.__noNet = false;
      win.WebSocket = function (u) { return win.__noNet ? new NoNetWS(u) : new Real(u); };
    },
  });
  const win = dom.window;
  for (let i = 0; i < 100 && !(win.NEXO && win.NEXO.initialized); i++) await sleep(100);
  const net = () => win.bleInterface && win.bleInterface.net;
  const connected = () => { const n = net(); return !!(n && n._openCount && n._openCount() > 0); };
  for (let i = 0; i < 400 && !connected(); i++) await sleep(100);
  r.conecta_al_inicio = connected();
  // sin red: el sistema avisa y los relés no contestan
  win.__noNet = true;
  nA.setNetwork('none');
  try { net()._closeAll(); net().relays.forEach((rl) => { rl.retryAt = 0; }); net().tick(); } catch (e) {}
  const SIN_RED_S = 30;
  await sleep(SIN_RED_S * 1000);
  // vuelve el Wi-Fi
  const mark = logs.length;
  win.__noNet = false;
  nA.setNetwork('wifi', 'casa');
  try { net().relays.forEach((rl) => { rl.retryAt = 0; }); net().tick(); } catch (e) {}
  for (let i = 0; i < 200 && !connected(); i++) await sleep(100);
  await sleep(2000);
  r.reconecta = connected();
  const medidas = logs.slice(mark).map((l) => { const m = /internet listo en ([\d,]+) s/.exec(l); return m ? parseFloat(m[1].replace(',', '.')) : null; }).filter((x) => x !== null);
  r.sin_red_s = SIN_RED_S;
  r.medidas_al_volver_s = medidas;
  r.max_s = medidas.length ? Math.max.apply(null, medidas) : null;
  r.ok = { conecta: r.conecta_al_inicio && r.reconecta, hay_medida: medidas.length > 0, sin_contar_tiempo_sin_red: r.max_s !== null && r.max_s < 6, una_sola_medida: medidas.length === 1 };
  r.errores = logs.filter((l) => /Uncaught|PAGEERROR/.test(l)).slice(0, 5);
  const ok = Object.values(r.ok).every(Boolean) && !r.errores.length;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('INTERNETLISTO ' + JSON.stringify(r));
  try { fs.writeFileSync(path.join(__dirname, 'last_logs_internetlisto.txt'), logs.join('\n')); } catch (e) {}
  try { await relay.stop(); } catch (e) {}
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('INTERNETLISTO ' + JSON.stringify({ resultado: 'FALLO', error: String(e && e.stack).substring(0, 400) })); process.exit(1); });
