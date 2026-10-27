// F9 (auditoría): los relés en claro (ws://) a un host REMOTO se ignoran; solo se usan wss:// (y ws:// a loopback para
// pruebas/relé propio). Un ws:// remoto filtraría las etiquetas de tu suscripción (tu buzón) a un espía de la red.
// Uso: node relaytls.js <dir_build>
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone, installWebCrypto } = require('./native_mock');

const buildDir = path.resolve(process.argv[2]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Mezcla: un wss remoto (OK), un ws remoto (debe ignorarse), un ws a loopback (OK, pruebas/propio)
const RELAYS = ['wss://relay.ok.example', 'ws://relay.malo.example:7000', 'ws://127.0.0.1:65123'];
class DistLoader extends ResourceLoader {
  constructor(dir) { super(); this.dir = dir; }
  fetch(url) { const f = path.join(this.dir, decodeURIComponent(new URL(url).pathname)); return fs.existsSync(f) ? Promise.resolve(fs.readFileSync(f)) : Promise.reject(new Error('no existe ' + f)); }
}
const logs = [];
async function boot(name, native) {
  native.listeners = new Map();
  const vc = new VirtualConsole();
  ['log', 'warn', 'error'].forEach((l) => vc.on(l, (...a) => logs.push(`[${name}] ${l}: ` + a.map(String).join(' ').substring(0, 250))));
  const dom = new JSDOM(fs.readFileSync(path.join(buildDir, 'dist', 'index.html'), 'utf8'), {
    url: 'https://' + name.toLowerCase() + '.nexo.test/index.html', runScripts: 'dangerously',
    resources: new DistLoader(path.join(buildDir, 'dist')), pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) { win.NEXO_NET_RELAYS = RELAYS.slice(); win.CapacitorCustomPlatform = { name: 'android' }; installWebCrypto(win); win.Capacitor = { Plugins: { NexoBLE: native.plugin() } }; win.HTMLElement.prototype.scrollTo = function () {}; },
  });
  const win = dom.window;
  for (let i = 0; i < 100 && !(win.NEXO && win.NEXO.initialized); i++) await sleep(100);
  await sleep(600);
  return { name, native, win };
}

(async () => {
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', { wifi: 'casa', noTor: true });
  radio.add(nA); nA.load();
  const A = await boot('A', nA);
  const r = { build: path.basename(buildDir) };
  const net = A.win.bleInterface && A.win.bleInterface.net;
  if (!net || typeof net.relayUrls !== 'function') { console.log('RELAYTLS ' + JSON.stringify({ resultado: 'FAIL', error: 'sin net.relayUrls' })); process.exit(0); }
  const used = net.relayUrls();
  r.usados = used;
  r.incluye_wss = used.indexOf('wss://relay.ok.example') >= 0;
  r.incluye_loopback = used.indexOf('ws://127.0.0.1:65123') >= 0;
  r.excluye_ws_remoto = used.indexOf('ws://relay.malo.example:7000') < 0;
  r.aviso_en_claro = logs.some((l) => /Rel[eé] en claro ignorado/.test(l));
  const ok = r.incluye_wss && r.incluye_loopback && r.excluye_ws_remoto && r.aviso_en_claro;
  r.resultado = ok ? 'OK' : 'FAIL';
  console.log('RELAYTLS ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_relaytls.txt'), logs.join('\n'));
  process.exit(0);
})().catch((e) => { console.error('FALLO:', e.stack); process.exit(1); });
