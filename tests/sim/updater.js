// Actualizador automático del APK de probadores (2986; pedido del dueño 10-11: «las actualizaciones automáticas»).
// Un teléfono en jsdom con el plugin nativo SIMULADO (updateCheck/updateInstall). Se comprueba que:
//   (1) con un número de build propio (window.NEXO_BUILD) y un lanzamiento más nuevo, la app consulta SOLA al arrancar y muestra el aviso
//       «Hay una versión nueva» con el número; «Ahora no» lo calla ese número (no vuelve en la siguiente consulta);
//   (2) el límite de tiempo: una segunda consulta automática no llama al nativo; «Buscar ahora» (manual) sí;
//   (3) «Actualizar» llama a updateInstall con la URL del lanzamiento; sin permiso de instalar (install_permission) no hay instalador y
//       el aviso sigue ahí para reintentar;
//   (4) el mismo número (o menor) no ofrece nada y quita el aviso; sin número de build («dev») no consulta; interruptor apagado no consulta;
//   (5) Perfil → Ajustes tiene su tarjeta «Actualizaciones» (interruptor + «Buscar ahora» que informa del resultado).
// Uso: node updater.js <dir_build>
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone, installWebCrypto } = require('./native_mock');

const buildDir = path.resolve(process.argv[2]);
const base = { readsContentFallback: true, retain: ['onPayloadReceived'], closeOnNoService: true, pace: [15, 15], ioDelay: 25, asymmetric: true, noTor: true };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
class DL extends ResourceLoader { constructor(d) { super(); this.d = d; } fetch(u) { const f = path.join(this.d, decodeURIComponent(new URL(u).pathname)); return fs.existsSync(f) ? Promise.resolve(fs.readFileSync(f)) : Promise.reject(new Error('no existe ' + f)); } }
const logs = [];
const URL_NEW = 'https://github.com/maurizio-bot/nexo-app/releases/download/nightly-2005/nexo-nightly-2005-abc1234.apk';
async function waitFor(fn, ms) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return Math.round((Date.now() - t0) / 100) / 10; await sleep(200); } return null; }
(async () => {
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', base);
  radio.add(nA); nA.load();
  const vc = new VirtualConsole();
  ['log', 'warn', 'error'].forEach((l) => vc.on(l, (...a) => logs.push(`[A] ${l}: ` + a.map(String).join(' ').substring(0, 250))));
  const dom = new JSDOM(fs.readFileSync(path.join(buildDir, 'dist', 'index.html'), 'utf8'), {
    url: 'https://a.nexo.test/index.html', runScripts: 'dangerously', resources: new DL(path.join(buildDir, 'dist')), pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) {
      win.CapacitorCustomPlatform = { name: 'android' }; installWebCrypto(win);
      const pl = nA.plugin();
      win.__upd = { checks: 0, installs: [], nextCheck: { build: 2005, tag: 'nightly-2005', url: URL_NEW, size: 25000000 }, nextInstall: { opened: true } };
      pl.updateCheck = async () => { win.__upd.checks++; return win.__upd.nextCheck; };
      pl.updateInstall = async (a) => { win.__upd.installs.push(a && a.url); return win.__upd.nextInstall; };
      win.Capacitor = { Plugins: { NexoBLE: pl } };
      win.HTMLElement.prototype.scrollTo = function () {};
    },
  });
  const win = dom.window, doc = win.document;
  for (let i = 0; i < 100 && !(win.NEXO && win.NEXO.initialized); i++) await sleep(100);
  win.NEXO_BUILD = '2000';   // el index.html trae «__NEXO_BUILD__» (lo reemplaza el workflow); la consulta automática sale a los 8 s
  const U = () => win.__nexoUpdater;
  const banner = () => doc.getElementById('nexo-update-banner');
  const r = { prueba: 'updater', build: path.basename(buildDir) };
  r.gancho = !!U();

  // (1) consulta sola al arrancar (a los ~8 s) y avisa
  r.aviso_s = await waitFor(() => !!banner(), 20000);
  r.consulta_sola = win.__upd.checks === 1;
  r.aviso_con_numero = !!banner() && /2005/.test(banner().textContent) && /24 MB/.test(banner().textContent);
  r.disponible = !!(U().available() && U().available().build === 2005);
  // «Ahora no» lo calla ese número
  doc.getElementById('nexo-update-later').click(); await sleep(200);
  r.ahora_no_quita = !banner();

  // (2) límite de tiempo: la consulta automática siguiente NO llama al nativo; la manual sí
  const auto = await U().check(false);
  r.auto_limitada = auto.state === 'skipped' && win.__upd.checks === 1;
  const man = await U().check(true);
  r.manual_consulta = man.state === 'newer' && man.build === 2005 && win.__upd.checks === 2;
  r.silenciado_no_vuelve = !banner();

  // (3) «Actualizar»: llama a updateInstall con la URL; sin permiso no hay instalador y el aviso queda para reintentar
  win.localStorage.removeItem('nexo_upd_snooze');
  win.__upd.nextInstall = { opened: false, reason: 'install_permission' };
  const i1 = await U().install();
  r.sin_permiso = i1.reason === 'install_permission' && win.__upd.installs[0] === URL_NEW;
  r.reintento_posible = !!U().available();
  win.__upd.nextInstall = { opened: true };
  const i2 = await U().install();
  r.instala = i2.opened === true && win.__upd.installs.length === 2 && win.__upd.installs[1] === URL_NEW;

  // (4) mismo número → nada y se quita el aviso; sin número («dev») → no consulta; interruptor apagado → no consulta
  win.__upd.nextCheck = { build: 2000, tag: 'nightly-2000', url: URL_NEW.replace('2005', '2000'), size: 1 };
  const cur = await U().check(true);
  r.mismo_numero_nada = cur.state === 'current' && !U().available() && !banner();
  const before = win.__upd.checks;
  win.NEXO_BUILD = '';
  const dev = await U().check(true);
  r.dev_no_consulta = dev.state === 'unsupported' && win.__upd.checks === before;
  win.NEXO_BUILD = '2000';
  win.__upd.nextCheck = { build: 2005, tag: 'nightly-2005', url: URL_NEW, size: 25000000 };
  U().setEnabled(false);
  win.localStorage.setItem('nexo_upd_last', '0');
  const off = await U().check(false);
  r.apagado_no_consulta = off.state === 'skipped' && win.__upd.checks === before;
  r.apagado_sin_aviso = !banner();
  U().setEnabled(true);

  // (5) Perfil → Ajustes: tarjeta «Actualizaciones»
  win.dispatchEvent(new win.CustomEvent('nexo:ui:settings')); await sleep(300);
  const sheet = doc.getElementById('nexo-settings-sheet');
  r.tarjeta_ajustes = !!(sheet && sheet.querySelector('#nexo-updater-on') && sheet.querySelector('#nexo-updater-now'));
  if (sheet) {
    win.__upd.nextCheck = { build: 2000, tag: 'nightly-2000', url: URL_NEW, size: 1 };
    sheet.querySelector('#nexo-updater-now').click(); await sleep(400);
    r.buscar_ahora_informa = /Ya tienes la última/.test(sheet.querySelector('#nexo-updater-status').textContent);
  }

  // (6) 2991 (pedido del dueño): si «Buscar ahora» encuentra una versión nueva, el MISMO botón pasa a «Instalar actualización (N)» y al tocarlo instala
  if (sheet) {
    win.__upd.nextCheck = { build: 2005, tag: 'nightly-2005', url: URL_NEW, size: 25000000 };
    win.localStorage.removeItem('nexo_upd_snooze');
    sheet.querySelector('#nexo-updater-now').click(); await sleep(500);
    const b6 = sheet.querySelector('#nexo-updater-now');
    r.boton_pasa_a_instalar = /Instalar actualización \(2005\)/.test(b6.textContent) && /2005/.test(sheet.querySelector('#nexo-updater-status').textContent);
    const antes = win.__upd.installs.length;
    b6.click(); await sleep(500);
    r.boton_instala = win.__upd.installs.length === antes + 1 && win.__upd.installs[antes] === URL_NEW;
    // al abrir Ajustes con una versión ya conocida, el botón ya dice «Instalar actualización» (sin tener que buscar otra vez)
    win.dispatchEvent(new win.CustomEvent('nexo:ui:settings')); await sleep(300);
    const sheet2 = doc.getElementById('nexo-settings-sheet');
    r.abre_ya_con_instalar = !!sheet2 && /Instalar actualización \(2005\)/.test(sheet2.querySelector('#nexo-updater-now').textContent);
  }

  r.errores = logs.filter((l) => / error: /.test(l) && !/JSDOMERROR|styles\.css|Not implemented|GLOBAL TIMEOUT|Assembly timeout|net::ERR|fetch/.test(l)).slice(0, 5);
  const keys = ['gancho', 'consulta_sola', 'aviso_con_numero', 'disponible', 'ahora_no_quita', 'auto_limitada', 'manual_consulta', 'silenciado_no_vuelve', 'sin_permiso', 'reintento_posible', 'instala', 'mismo_numero_nada', 'dev_no_consulta', 'apagado_no_consulta', 'apagado_sin_aviso', 'tarjeta_ajustes', 'buscar_ahora_informa', 'boton_pasa_a_instalar', 'boton_instala', 'abre_ya_con_instalar'];
  const ok = typeof r.aviso_s === 'number' && keys.every((k) => r[k] === true) && r.errores.length === 0;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('UPDATER ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_updater.txt'), logs.join('\n'));
  process.exit(ok ? 0 : 1);
})().catch((e) => { try { fs.writeFileSync(path.join(__dirname, 'last_logs_updater.txt'), logs.join('\n')); } catch (x) {} console.log('UPDATER ' + JSON.stringify({ prueba: 'updater', resultado: 'FALLO', error: String(e && e.message) })); process.exit(1); });
