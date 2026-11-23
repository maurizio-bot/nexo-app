// I-S1 + T-A1 (auditoría 23-11): «es APK» y el nombre al abrir un archivo recibido se deciden IGUAL en la interfaz (store_flag.js) y
// en el nativo (OpenType.kt). Antes «x.apk » (espacio al final), «fdp‮.apk» o un nombre de más de 80 letras pasaban por PDF en la
// interfaz (la tienda los dejaba pasar) y el nativo los mandaba al instalador.
//  (1) los casos de opentype_vectors.json (los mismos que prueba tests/kotlin OpenTypeTest) con openSafeName/isApkFile;
//  (2) el nombre que se MUESTRA no lleva control ni RTL;
//  (3) versión de tienda: ninguna APK disfrazada llega al nativo, y lo que sí llega va con store:true (el nativo tampoco instala);
//      un PDF se abre; en la APK de GitHub va store:false y la APK se abre.
// Uso: node abrirtipo.js <dir_build>
'use strict';
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone, installWebCrypto } = require('./native_mock');

const buildDir = path.resolve(process.argv[2]);
const base = { readsContentFallback: true, retain: ['onPayloadReceived'], closeOnNoService: true, pace: [15, 15], ioDelay: 25, asymmetric: true, noTor: true };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
class DL extends ResourceLoader { constructor(d) { super(); this.d = d; } fetch(u) { const f = path.join(this.d, decodeURIComponent(new URL(u).pathname)); return fs.existsSync(f) ? Promise.resolve(fs.readFileSync(f)) : Promise.reject(new Error('no existe ' + f)); } }
const logs = [];

async function phone(store) {
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', base);
  radio.add(nA); nA.load();
  const vc = new VirtualConsole();
  ['log', 'warn', 'error'].forEach((l) => vc.on(l, (...a) => logs.push(`[${store ? 'T' : 'G'}] ${l}: ` + a.map(String).join(' ').substring(0, 250))));
  let html = fs.readFileSync(path.join(buildDir, 'dist', 'index.html'), 'utf8').replace(/__NEXO_BUILD__/g, '2000');
  if (store) html = html.replace(/__NEXO_STORE__/g, '1');
  const dom = new JSDOM(html, {
    url: 'https://a.nexo.test/index.html', runScripts: 'dangerously', resources: new DL(path.join(buildDir, 'dist')), pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) {
      win.CapacitorCustomPlatform = { name: 'android' }; installWebCrypto(win);
      const pl = nA.plugin();
      win.__opens = [];
      pl.updateCheck = async () => ({});
      pl.openFile = async (a) => { win.__opens.push(a); return { opened: true }; };
      win.Capacitor = { Plugins: { NexoBLE: pl } };
      win.HTMLElement.prototype.scrollTo = function () {};
    },
  });
  const win = dom.window;
  for (let i = 0; i < 100 && !(win.NEXO && win.NEXO.initialized); i++) await sleep(100);
  return win;
}

const DISFRAZADAS = ['x.apk ', 'factura‮fdp.apk', 'x.apk‮', 'a'.repeat(96) + '.apk', 'X.APK\t'];

(async () => {
  const r = { prueba: 'abrirtipo', build: path.basename(buildDir) };
  const sf = await import(pathToFileURL(path.join(buildDir, 'src', 'ui', 'store_flag.js')).href);
  const vec = JSON.parse(fs.readFileSync(path.join(__dirname, 'opentype_vectors.json'), 'utf8'));
  const malos = [];
  vec.casos.forEach((c, i) => {
    const safe = sf.openSafeName ? sf.openSafeName(c.name) : null;
    if (safe !== c.safe) malos.push(i + ':nombre');
    if (sf.isApkFile(c.name, c.mime) !== c.apk) malos.push(i + ':apk');
  });
  r.casos = vec.casos.length;
  r.casos_mal = malos;
  r.casos_ok = malos.length === 0;
  // (2) lo que se muestra
  const d = sf.displayFileName ? sf.displayFileName('factura‮fdp.apk\u0007') : '';
  r.muestra_sin_rtl = d === 'facturafdp.apk' && sf.displayFileName('Mamá ñ.pdf') === 'Mamá ñ.pdf';

  // (3) tienda
  const win = await phone(true);
  const open = win.__nexoOpenFile;
  r.gancho = typeof open === 'function';
  if (open) {
    for (const n of DISFRAZADAS) { open('QUJD', n, 'application/pdf'); await sleep(120); }
    r.tienda_disfrazadas_no_llegan = win.__opens.length === 0;
    open('QUJD', 'doc.pdf', 'application/pdf'); await sleep(200);
    r.tienda_pdf_con_bandera = win.__opens.length === 1 && win.__opens[0].name === 'doc.pdf' && win.__opens[0].store === true;
  }
  win.close();
  const g = await phone(false);
  if (g.__nexoOpenFile) { g.__nexoOpenFile('QUJD', 'x.apk ', 'application/pdf'); await sleep(200); }
  r.github_apk_se_abre_sin_bandera = g.__opens.length === 1 && g.__opens[0].store === false;
  g.close();

  r.errores = logs.filter((l) => / error: /.test(l) && !/JSDOMERROR|styles\.css|Not implemented|GLOBAL TIMEOUT|Assembly timeout|net::ERR|fetch/.test(l)).slice(0, 5);
  const ok = r.casos_ok && r.muestra_sin_rtl && r.gancho && r.tienda_disfrazadas_no_llegan && r.tienda_pdf_con_bandera && r.github_apk_se_abre_sin_bandera && r.errores.length === 0;
  r.resultado = ok ? 'OK' : 'FAIL';
  console.log('ABRIRTIPO ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_abrirtipo.txt'), logs.join('\n'));
  process.exit(0);
})().catch((e) => { console.error('FALLO:', e.stack); fs.writeFileSync(path.join(__dirname, 'last_logs_abrirtipo.txt'), logs.join('\n')); process.exit(1); });
