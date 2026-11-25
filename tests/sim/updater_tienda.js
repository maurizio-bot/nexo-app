// Versión de GOOGLE PLAY (COLA 26): sin actualizador propio ni instalador de APK. El CI de tienda reemplaza «__NEXO_STORE__» por 1 en el
// index.html (igual que «__NEXO_BUILD__»); la APK de GitHub lo deja sin reemplazar y se comporta como siempre (prueba updater.js).
// Un teléfono en jsdom con el plugin nativo SIMULADO. Se comprueba que, con NEXO_STORE=1 y un número de build (que SÍ consultaría):
//   (1) pasados los 8 s del arranque NO se llamó a updateCheck, ni aviso, ni banner, ni se pidió ningún aviso del sistema;
//   (2) Perfil → Ajustes NO tiene la tarjeta «Actualizaciones» (ni interruptor ni botón);
//   (3) la consulta manual responde «unsupported» y nunca llega al nativo; nada se ofrece aunque el almacenamiento tenga una versión guardada;
//   (4) abrir un APK recibido (adjunto o archivo grande) NO llama al nativo y avisa; abrir un PDF sí;
//   (5) contraprueba: con el marcador SIN reemplazar (APK de GitHub) y el mismo número, la app SÍ consulta (el actualizador sigue vivo).
// Uso: node updater_tienda.js <dir_build>
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

async function phone(store) {
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', base);
  radio.add(nA); nA.load();
  const vc = new VirtualConsole();
  ['log', 'warn', 'error'].forEach((l) => vc.on(l, (...a) => logs.push(`[${store ? 'T' : 'G'}] ${l}: ` + a.map(String).join(' ').substring(0, 250))));
  // Como el workflow: el número de build siempre se reemplaza; el de tienda solo en la variante de tienda
  let html = fs.readFileSync(path.join(buildDir, 'dist', 'index.html'), 'utf8').replace(/__NEXO_BUILD__/g, '2000');
  if (store) html = html.replace(/__NEXO_STORE__/g, '1');
  const dom = new JSDOM(html, {
    url: 'https://a.nexo.test/index.html', runScripts: 'dangerously', resources: new DL(path.join(buildDir, 'dist')), pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) {
      win.CapacitorCustomPlatform = { name: 'android' }; installWebCrypto(win);
      const pl = nA.plugin();
      win.__upd = { checks: 0, installs: 0, notifs: 0, opens: [] };
      pl.updateCheck = async () => { win.__upd.checks++; return { build: 2005, tag: 'nightly-2005', url: URL_NEW, size: 25000000 }; };
      pl.updateInstall = async () => { win.__upd.installs++; return { opened: true }; };
      pl.updateNotify = async () => { win.__upd.notifs++; };
      pl.updateNotifyCancel = async () => {};
      pl.openFile = async (a) => { win.__upd.opens.push(a && a.name); return { opened: true }; };
      win.Capacitor = { Plugins: { NexoBLE: pl } };
      win.HTMLElement.prototype.scrollTo = function () {};
    },
  });
  const win = dom.window;
  for (let i = 0; i < 100 && !(win.NEXO && win.NEXO.initialized); i++) await sleep(100);
  return win;
}

(async () => {
  const r = { prueba: 'updater_tienda', build: path.basename(buildDir) };
  // ---------- TIENDA ----------
  const win = await phone(true), doc = win.document;
  r.marca_tienda = win.NEXO_STORE === '1' && win.NEXO_BUILD === '2000';
  await sleep(10500);   // la consulta automática sale a los 8 s del arranque
  r.no_consulta = win.__upd.checks === 0;
  r.sin_aviso = !doc.getElementById('nexo-update-banner') && win.__upd.notifs === 0;
  const U = win.__nexoUpdater;
  r.gancho = !!U;
  const man = await U.check(true);
  r.manual_no_soportada = man.state === 'unsupported' && win.__upd.checks === 0;
  // aunque el almacenamiento tenga una versión «disponible» guardada de antes, no se ofrece
  win.localStorage.setItem('nexo_upd_avail', JSON.stringify({ build: 2005, url: URL_NEW, size: 1, notes: '' }));
  r.nada_disponible = !U.available() && !U.enabled();
  win.dispatchEvent(new win.CustomEvent('nexo:ui:settings')); await sleep(600);
  const sheet = doc.getElementById('nexo-settings-sheet');
  r.ajustes_abre = !!sheet;
  r.sin_tarjeta = !!sheet && !sheet.querySelector('#nexo-updater-on') && !sheet.querySelector('#nexo-updater-now') && !/Actualizaciones/.test(sheet.textContent);
  r.nada_al_nativo = win.__upd.checks === 0 && win.__upd.installs === 0;
  // (4) APK recibido: no se abre con el instalador; un PDF sí
  const open = win.__nexoOpenFile;
  r.gancho_abrir = typeof open === 'function';
  if (open) {
    open('QUJD', 'app.apk', 'application/vnd.android.package-archive'); await sleep(100);
    open('QUJD', 'otra.APK', ''); await sleep(100);
    r.apk_no_se_abre = win.__upd.opens.length === 0;
    open('QUJD', 'doc.pdf', 'application/pdf'); await sleep(200);
    r.pdf_si_se_abre = win.__upd.opens.length === 1 && win.__upd.opens[0] === 'doc.pdf';
  }
  win.close();

  // ---------- GITHUB (contraprueba: marcador sin reemplazar) ----------
  const g = await phone(false);
  r.github_marca_sin_reemplazar = g.NEXO_STORE === '__NEXO_STORE__';
  const hit = (() => { const t0 = Date.now(); return (async () => { while (Date.now() - t0 < 20000) { if (g.__upd.checks >= 1) return true; await sleep(200); } return false; })(); })();
  r.github_consulta = await hit;
  g.dispatchEvent(new g.CustomEvent('nexo:ui:settings')); await sleep(600);
  const gs = g.document.getElementById('nexo-settings-sheet');
  r.github_tarjeta = !!(gs && gs.querySelector('#nexo-updater-on') && gs.querySelector('#nexo-updater-now'));
  g.__upd.opens.length = 0;
  if (g.__nexoOpenFile) { g.__nexoOpenFile('QUJD', 'app.apk', 'application/vnd.android.package-archive'); await sleep(200); }
  r.github_apk_se_abre = g.__upd.opens.length === 1;
  g.close();

  r.errores = logs.filter((l) => / error: /.test(l) && !/JSDOMERROR|styles\.css|Not implemented|GLOBAL TIMEOUT|Assembly timeout|net::ERR|fetch/.test(l)).slice(0, 5);
  const keys = ['marca_tienda', 'no_consulta', 'sin_aviso', 'gancho', 'manual_no_soportada', 'nada_disponible', 'ajustes_abre', 'sin_tarjeta', 'nada_al_nativo', 'gancho_abrir', 'apk_no_se_abre', 'pdf_si_se_abre', 'github_marca_sin_reemplazar', 'github_consulta', 'github_tarjeta', 'github_apk_se_abre'];
  const ok = keys.every((k) => r[k] === true) && r.errores.length === 0;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('UPDATER_TIENDA ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_updater_tienda.txt'), logs.join('\n'));
  process.exit(ok ? 0 : 1);
})().catch((e) => { try { fs.writeFileSync(path.join(__dirname, 'last_logs_updater_tienda.txt'), logs.join('\n')); } catch (x) {} console.log('UPDATER_TIENDA ' + JSON.stringify({ prueba: 'updater_tienda', resultado: 'FALLO', error: String(e && e.stack || e).slice(0, 400) })); process.exit(1); });
