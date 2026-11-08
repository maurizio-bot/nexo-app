// Orden de la lista de contactos (#dueño 08-11, captura): un contacto agregado de una tarjeta/grupo quedaba marcado «nuevo»
// y flotaba ARRIBA de todo hasta que ABRÍAS su chat — aunque su último mensaje fuera viejo. Por eso «vivo Y03 (14m)» salía
// encima de «Galaxy (Ahora)». 2955: con un mensaje (entrante o saliente) se limpia isNewShared y el contacto se ordena por el
// más reciente como todos; el «nuevo arriba» queda solo para uno recién agregado SIN ningún mensaje. Uso: node contactorder.js <dir_build>
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
  await sleep(800);
  return { name, win, bi: win.bleInterface };
}
const rowNames = (p) => Array.from(p.win.document.querySelectorAll('#main-contacts-list .ble-contact-row')).map((r) => (r.querySelector('.ble-contact-name') || {}).textContent);
const findC = (p, id) => (p.win.vaultLoadContacts() || []).find((c) => (c.nexoId || c.deviceUUID || '').toLowerCase() === id.toLowerCase());

(async () => {
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', { closeOnNoService: true });
  radio.add(nA); nA.load();
  const A = await boot('A', nA);
  const r = { build: path.basename(buildDir) };
  const now = Date.now();

  // Tres contactos agregados de una tarjeta (sharedBy≠null → isNewShared=true).
  A.bi.addSharedContacts([
    { nexoId: 'NXNUEVO001', name: 'Nuevo' },
    { nexoId: 'NXVIEJO002', name: 'Viejo' },
    { nexoId: 'NXRECIE003', name: 'Reciente' },
  ], 'NXSHARER01', {});
  await sleep(200);

  // Viejo y Reciente cruzan un mensaje (entrante/saliente) → dejan de ser «nuevos». Nuevo NO.
  A.bi.noteContactMessage('NXVIEJO002', 'hola viejo', now - 100000);
  A.bi.noteContactMessage('NXRECIE003', 'hola reciente', now);
  await sleep(200);
  A.bi.renderContactsList();
  await sleep(200);

  // (1) El flag «nuevo» se limpia con un mensaje, y queda solo en el que no cruzó ninguno.
  r.nuevo_sigue_nuevo = !!(findC(A, 'nxnuevo001') || {}).isNewShared;
  r.viejo_ya_no_es_nuevo = !((findC(A, 'nxviejo002') || {}).isNewShared);
  r.reciente_ya_no_es_nuevo = !((findC(A, 'nxrecie003') || {}).isNewShared);

  // (2) Orden: «Nuevo» (sin mensaje) flota arriba; los que hablaron, por el MÁS RECIENTE (Reciente antes que Viejo).
  const names = rowNames(A);
  r.orden = names;
  const iNuevo = names.indexOf('Nuevo'), iReciente = names.indexOf('Reciente'), iViejo = names.indexOf('Viejo');
  r.reciente_antes_que_viejo = iReciente >= 0 && iViejo >= 0 && iReciente < iViejo; // lo clave del bug del dueño
  r.nuevo_sin_mensaje_arriba = iNuevo >= 0 && iNuevo < iReciente && iNuevo < iViejo;

  r.errores = logs.filter((l) => / error: /.test(l) && !/JSDOMERROR|styles\.css|Not implemented/.test(l)).slice(0, 5);
  const ok = r.nuevo_sigue_nuevo && r.viejo_ya_no_es_nuevo && r.reciente_ya_no_es_nuevo &&
    r.reciente_antes_que_viejo && r.nuevo_sin_mensaje_arriba && !r.errores.length;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('CONTACTORDER ' + JSON.stringify(r));
  if (!ok) console.log(logs.slice(-30).join('\n'));
  fs.writeFileSync(path.join(__dirname, 'last_logs_contactorder.txt'), logs.join('\n'));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('CONTACTORDER {"resultado":"FALLO","error":"' + String(e && e.message) + '"}'); console.log(logs.slice(-30).join('\n')); fs.writeFileSync(path.join(__dirname, 'last_logs_contactorder.txt'), logs.join('\n')); process.exit(1); });
