// 3341 (diag. 24-11 21:52): con Wi-Fi local con el contacto POR LA RED de un grupo de Wi-Fi Direct (192.168.49.x), un archivo nuevo no debe
// montar OTRO grupo (tiraba el Wi-Fi local y un archivo grande que iba por él volvía a empezar). Sin ese Wi-Fi, Wi-Fi Direct se usa como siempre.
// Uso: node wdsobregrupo.js <dir_build>
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
  const r = { prueba: 'wdsobregrupo', build: path.basename(buildDir) };
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
  const bi = win.bleInterface, wd = bi.wifiDirect, NX = 'nx0x4029e6', DEV = '45:73:F7:57:C2:3C';
  wd.status = { supported: true, wifiOn: true }; wd.denied = false; wd.busy = false; wd.peers.add(NX);
  wd._nexoOf = () => NX; wd._directReady = () => true; wd._cooling = () => false;
  const lan = bi.lan || (bi.lan = {});
  lan.canReach = () => true; lan._wdAddr = () => true;
  r.con_wifi_por_grupo = JSON.stringify(wd._whyNot(DEV, 3 * 1048576));
  lan._wdAddr = () => false; lan.canReach = () => false;
  r.sin_wifi_local = JSON.stringify(wd._whyNot(DEV, 3 * 1048576));
  r.errores = logs.filter((l) => / error: /.test(l) && !/JSDOMERROR|styles\.css|Not implemented/.test(l)).slice(0, 5);
  const ok = /grupo de Wi-Fi Direct/.test(r.con_wifi_por_grupo) && /"use"/.test(r.sin_wifi_local) && !r.errores.length;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('WDSOBREGRUPO ' + JSON.stringify(r));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('WDSOBREGRUPO ' + JSON.stringify({ prueba: 'wdsobregrupo', resultado: 'FALLO', error: String(e && e.message) })); process.exit(1); });
