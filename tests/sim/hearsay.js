// H3 (#dueño 07-11): una clave que llega «de oídas» (tarjeta compartida o cartas de un grupo) entra SIN VERIFICAR.
// Se marca pkHearsay: se usa igual (NO rompe «compartir contacto» — el sellado sigue andando) pero el banner avisa y
// empuja a comparar el número de seguridad. Se CONFIRMA sola cuando el propio contacto conecta directo (_noteSenderKey con
// la misma clave) o cuando el usuario verifica el número de seguridad. Si llega OTRA clave directa, salta el aviso de
// «clave cambiada» de siempre (pendingKey). Una clave del flujo de aceptación (sharedBy=null) NO es «de oídas».
// Uso: node hearsay.js <dir_build>
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone, installWebCrypto } = require('./native_mock');

const buildDir = path.resolve(process.argv[2]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const KEY1 = 'A'.repeat(88), KEY2 = 'B'.repeat(88); // claves base64 de pega (88 car., formato válido) — probamos la LÓGICA, no la cripto
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
const findC = (A, id) => (A.win.vaultLoadContacts() || []).find((c) => (c.nexoId || c.deviceUUID || '').toLowerCase() === id.toLowerCase());

(async () => {
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', { closeOnNoService: true });
  radio.add(nA); nA.load();
  const A = await boot('A', nA);
  const r = { build: path.basename(buildDir) };

  // (1) Tarjeta compartida por un tercero (sharedBy≠null): la clave entra «de oídas».
  A.bi.addSharedContacts([{ nexoId: 'NXAAAAAA01', name: 'DeTarjeta', publicKey: KEY1, ss: 1, nt: 1 }], 'NXSHARER01', {});
  await sleep(150);
  const c1 = findC(A, 'NXAAAAAA01');
  r.tarjeta_marca_de_oidas = !!(c1 && c1.pkHearsay === 1 && c1.publicKey === KEY1);
  // NO rompe compartir: la clave se usa igual (el sellado sigue disponible para esa clave «de oídas»).
  r.sellado_sigue_andando = A.bi._sealKeyFor('NXAAAAAA01') === KEY1;

  // (2) El propio contacto conecta DIRECTO con la MISMA clave → queda confirmada (se quita «de oídas»).
  A.bi._noteSenderKey('NXAAAAAA01', KEY1);
  await sleep(150);
  const c1b = findC(A, 'NXAAAAAA01');
  r.contacto_directo_confirma = !!(c1b && !c1b.pkHearsay && c1b.publicKey === KEY1);

  // (3) Otra tarjeta «de oídas»; si luego llega OTRA clave directa, salta el aviso de siempre (clave cambiada / pendingKey).
  A.bi.addSharedContacts([{ nexoId: 'NXBBBBBB02', name: 'DeTarjeta2', publicKey: KEY1, ss: 1 }], 'NXSHARER01', {});
  await sleep(100);
  A.bi._noteSenderKey('NXBBBBBB02', KEY2); // clave distinta llega directa
  await sleep(150);
  const c2 = findC(A, 'NXBBBBBB02');
  r.clave_distinta_salta_aviso = !!(c2 && c2.pendingKey === KEY2 && c2.pkHearsay === 1);

  // (4) Una clave del FLUJO DE ACEPTACIÓN (sharedBy=null, como al aceptar una solicitud) NO es «de oídas».
  A.bi.addSharedContacts([{ nexoId: 'NXDDDDDD04', name: 'Aceptado', publicKey: KEY1, ss: 1 }], null, { quiet: true });
  await sleep(150);
  const c4 = findC(A, 'NXDDDDDD04');
  r.aceptacion_no_es_de_oidas = !!(c4 && !c4.pkHearsay && c4.publicKey === KEY1);

  // (5) Verificar el número de seguridad confirma la clave «de oídas».
  A.bi.addSharedContacts([{ nexoId: 'NXEEEEEE05', name: 'ParaVerificar', publicKey: KEY1, ss: 1 }], 'NXSHARER01', {});
  await sleep(100);
  A.bi.setContactVerified('NXEEEEEE05', true);
  await sleep(150);
  const c5 = findC(A, 'NXEEEEEE05');
  r.verificar_confirma = !!(c5 && !c5.pkHearsay && c5.verified === KEY1);

  r.errores = logs.filter((l) => / error: /.test(l) && !/JSDOMERROR|styles\.css|Not implemented/.test(l)).slice(0, 5);
  const ok = r.tarjeta_marca_de_oidas && r.sellado_sigue_andando && r.contacto_directo_confirma &&
    r.clave_distinta_salta_aviso && r.aceptacion_no_es_de_oidas && r.verificar_confirma && !r.errores.length;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('HEARSAY ' + JSON.stringify(r));
  if (!ok) console.log(logs.slice(-40).join('\n'));
  fs.writeFileSync(path.join(__dirname, 'last_logs_hearsay.txt'), logs.join('\n'));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('HEARSAY {"resultado":"FALLO","error":"' + String(e && e.message) + '"}'); console.log(logs.slice(-30).join('\n')); fs.writeFileSync(path.join(__dirname, 'last_logs_hearsay.txt'), logs.join('\n')); process.exit(1); });
