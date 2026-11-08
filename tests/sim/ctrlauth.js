// Control sin autenticar (M5/M6, #dueño 07-11): un mensaje de control 'ni' («esta conexión es de <from>, no de <dn>») podía
// RE-APUNTAR la conexión a cualquier <from>, aunque fuera un DESCONOCIDO → un impostor forjaba un 'ni' para re-etiquetar/
// re-enrutar la conexión (molestia; el contenido ya lo protege el E2E). 2953: _wrongPeer solo honra el re-apuntado si <from> es
// un CONTACTO conocido (_isKnownSender). Un 'ni' legítimo (corregir un mensaje mal dirigido entre los que ya hablan) viene
// siempre de un contacto, así que no se rompe el caso real («envío al teléfono equivocado»). Uso: node ctrlauth.js <dir_build>
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone, installWebCrypto } = require('./native_mock');

const buildDir = path.resolve(process.argv[2]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const KEY = 'A'.repeat(88);
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
  const r = { build: path.basename(buildDir) };
  const MAC = 'AA:BB:CC:DD:EE:09';

  // B es un CONTACTO conocido; S (stranger) NO.
  A.bi.addSharedContacts([{ nexoId: 'NXBBBBBB09', name: 'B', publicKey: KEY, ss: 1 }], null, { quiet: true });
  await sleep(150);
  r.B_es_contacto = A.bi._isKnownSender('nxbbbbbb09') === true;
  r.S_no_es_contacto = A.bi._isKnownSender('nxstrange1') === false;

  // (1) 'ni' FORJADO por un desconocido: NO debe re-apuntar la conexión a él.
  A.bi._wrongPeer(MAC, 'NXSTRANGE1', 'NXWRONG0001');
  r.desconocido_no_reapunta = A.bi._destNx(MAC) !== 'nxstrange1'; // quedó sin mapear (bloqueado)

  // (2) 'ni' de un CONTACTO: sí re-apunta (no rompe el caso legítimo «envío al teléfono equivocado»).
  A.bi._wrongPeer(MAC, 'NXBBBBBB09', 'NXWRONG0001');
  r.contacto_si_reapunta = A.bi._destNx(MAC) === 'nxbbbbbb09';

  r.errores = logs.filter((l) => / error: /.test(l) && !/JSDOMERROR|styles\.css|Not implemented/.test(l)).slice(0, 5);
  const ok = r.B_es_contacto && r.S_no_es_contacto && r.desconocido_no_reapunta && r.contacto_si_reapunta && !r.errores.length;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('CTRLAUTH ' + JSON.stringify(r));
  if (!ok) console.log(logs.slice(-30).join('\n'));
  fs.writeFileSync(path.join(__dirname, 'last_logs_ctrlauth.txt'), logs.join('\n'));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('CTRLAUTH {"resultado":"FALLO","error":"' + String(e && e.message) + '"}'); console.log(logs.slice(-30).join('\n')); fs.writeFileSync(path.join(__dirname, 'last_logs_ctrlauth.txt'), logs.join('\n')); process.exit(1); });
