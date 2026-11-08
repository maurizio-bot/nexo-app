// Lentitud en Bluetooth, hueco del 2.º diagnóstico (#dueño 08-11): la REANUDACIÓN de transferencias
// (resumeOutgoingTransfers → _resumeRunOne → sendFile) volvía a mandar un respaldo Fénix a un contacto atascado o con la app
// en primer plano, SALTÁNDOSE el freno que el respaldo ya respeta al elegir (2951/2952). 2954: _resumeRunOne aplaza un
// respaldo Fénix (tx.type/meta.type==='fenix') si _fenixDeferNow — usuario en primer plano (_foreground===true) o enlace
// atascado (_bleCongested). Prueba de la decisión: Uso: node fenixresume.js <dir_build>
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone, installWebCrypto } = require('./native_mock');

const buildDir = path.resolve(process.argv[2]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
class DistLoader extends ResourceLoader {
  constructor(dir) { super(); this.dir = dir; }
  fetch(url) { const f = path.join(this.dir, decodeURIComponent(new URL(url).pathname)); return fs.existsSync(f) ? Promise.resolve(fs.readFileSync(f)) : Promise.reject(new Error('no existe ' + f)); }
}
const logs = [];
async function boot(name, native) {
  const vc = new VirtualConsole();
  ['log', 'warn', 'error'].forEach((l) => vc.on(l, (...a) => logs.push(`[${name}] ${l}: ` + a.map(String).join(' ').substring(0, 250))));
  const dom = new JSDOM(fs.readFileSync(path.join(buildDir, 'dist', 'index.html'), 'utf8'), {
    url: 'https://' + name.toLowerCase() + '.nexo.test/index.html', runScripts: 'dangerously',
    resources: new DistLoader(path.join(buildDir, 'dist')), pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) { win.CapacitorCustomPlatform = { name: 'android' }; installWebCrypto(win); win.Capacitor = { Plugins: { NexoBLE: native.plugin() } }; win.HTMLElement.prototype.scrollTo = function () {}; },
  });
  const win = dom.window;
  for (let i = 0; i < 100 && !(win.NEXO && win.NEXO.initialized); i++) await sleep(100);
  await sleep(600);
  return { name, win, bi: win.bleInterface };
}

(async () => {
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', { closeOnNoService: true });
  radio.add(nA); nA.load();
  const A = await boot('A', nA);
  const ack = A.bi.ackSystem;
  const r = { build: path.basename(buildDir) };
  const MAC = 'CC:CC:CC:CC:CC:09', OTRO = 'DD:DD:DD:DD:DD:09';

  r.hay_ackSystem = !!(ack && typeof ack._fenixDeferNow === 'function');

  // (1) App en PRIMER PLANO: un respaldo se aplaza (el usuario es dueño de la radio).
  A.bi._foreground = true;
  r.primer_plano_aplaza = ack._fenixDeferNow(MAC) === true;

  // (2) Segundo plano + enlace SANO: el respaldo corre (no se aplaza).
  A.bi._foreground = false;
  r.segundo_plano_sano_corre = ack._fenixDeferNow(MAC) === false;

  // (3) Segundo plano + enlace ATASCADO (marcado muerto por un write-drop): se aplaza (no martillar).
  A.bi._markBleDead(MAC);
  r.atascado_aplaza = ack._fenixDeferNow(MAC) === true;

  // (4) Sin señal de primer plano (undefined, como el simulador) + enlace sano: corre, no se deja el respaldo sin hacerse.
  A.bi._foreground = undefined;
  r.sin_senal_corre = ack._fenixDeferNow(OTRO) === false;

  r.errores = logs.filter((l) => / error: /.test(l) && !/JSDOMERROR|styles\.css|Not implemented/.test(l)).slice(0, 5);
  const ok = r.hay_ackSystem && r.primer_plano_aplaza && r.segundo_plano_sano_corre && r.atascado_aplaza && r.sin_senal_corre && !r.errores.length;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('FENIXRESUME ' + JSON.stringify(r));
  if (!ok) console.log(logs.slice(-30).join('\n'));
  fs.writeFileSync(path.join(__dirname, 'last_logs_fenixresume.txt'), logs.join('\n'));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('FENIXRESUME {"resultado":"FALLO","error":"' + String(e && e.message) + '"}'); console.log(logs.slice(-30).join('\n')); fs.writeFileSync(path.join(__dirname, 'last_logs_fenixresume.txt'), logs.join('\n')); process.exit(1); });
