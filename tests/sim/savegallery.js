// Ronda 2801 (pedido del dueño #92): guardar foto/vídeo en la galería. Comprueba el CABLEADO JS del visor:
//  1. El visor normal muestra el botón de guardar (.fs-save-btn) y al tocarlo llama al nativo saveToGallery con el
//     base64 correcto, un nombre NEXO_*.<ext> y el mime.
//  2. El visor de «ver una vez» (noSave) NO muestra el botón (una foto de una vez se consume, no se guarda).
// (El guardado real en MediaStore es nativo y se prueba en el teléfono; acá solo el cableado.)
// Uso: node savegallery.js <dir_build>
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone, installWebCrypto } = require('./native_mock');

const buildDir = path.resolve(process.argv[2]);
const opts = { readsContentFallback: true, closeOnNoService: true, pace: [15, 15], ioDelay: 25 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
class DL extends ResourceLoader { constructor(d) { super(); this.d = d; } fetch(u) { const f = path.join(this.d, decodeURIComponent(new URL(u).pathname)); return fs.existsSync(f) ? Promise.resolve(fs.readFileSync(f)) : Promise.reject(new Error('x')); } }
const logs = [];
async function boot(name, native) {
  const vc = new VirtualConsole();
  ['log', 'warn', 'error'].forEach((l) => vc.on(l, (...a) => logs.push(`[${name}] ${l}: ` + a.map(String).join(' ').substring(0, 250))));
  const dom = new JSDOM(fs.readFileSync(path.join(buildDir, 'dist', 'index.html'), 'utf8'), {
    url: 'https://' + name.toLowerCase() + '.nexo.test/index.html', runScripts: 'dangerously', resources: new DL(path.join(buildDir, 'dist')), pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) { win.CapacitorCustomPlatform = { name: 'android' }; installWebCrypto(win); win.Capacitor = { Plugins: { NexoBLE: native.plugin() } }; win.HTMLElement.prototype.scrollTo = function () {}; },
  });
  const win = dom.window;
  for (let i = 0; i < 100 && !(win.NEXO && win.NEXO.initialized); i++) await sleep(100);
  await sleep(500);
  return { name, native, win };
}
const click = (w, el) => el && el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));

(async () => {
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', opts);
  radio.add(nA); nA.load();
  const [A] = await Promise.all([boot('A', nA)]);
  const r = { build: path.basename(buildDir) };

  // Mock del nativo: registramos lo que se pide guardar
  const saved = [];
  A.win.Capacitor.Plugins.NexoBLE.saveToGallery = function (o) { saved.push(o); return Promise.resolve({ saved: true }); };

  const b64 = Buffer.alloc(300, 9).toString('base64');
  const dataUrl = 'data:image/png;base64,' + b64;

  // 1. Visor normal → hay botón de guardar
  A.win.__nexoOpenMedia(dataUrl, 'image');
  await sleep(150);
  var ov = A.win.document.getElementById('fullscreen-media-overlay');
  var btn = ov && ov.querySelector('.fs-save-btn');
  r.visor_tiene_boton = !!btn;

  // Tocar guardar → llama al nativo con el base64/nombre/mime correctos
  click(A.win, btn);
  await sleep(200);
  r.llama_nativo = saved.length === 1;
  r.base64_correcto = saved.length === 1 && saved[0].base64 === b64;
  r.nombre_ok = saved.length === 1 && /^NEXO_\d+\.png$/.test(String(saved[0].name || ''));
  r.mime_ok = saved.length === 1 && saved[0].mime === 'image/png';
  A.win.__nexoOpenMedia && (function () { var o = A.win.document.getElementById('fullscreen-media-overlay'); if (o) o.remove(); })();

  // 2. Visor «ver una vez» (noSave) → NO hay botón de guardar
  A.win.__nexoOpenMedia(dataUrl, 'image', true);
  await sleep(150);
  var ov2 = A.win.document.getElementById('fullscreen-media-overlay');
  r.una_vez_sin_boton = !!ov2 && !ov2.querySelector('.fs-save-btn');

  r.errores = logs.filter((l) => /TypeError|undefined is not|is not a function/.test(l)).slice(0, 4);
  const ok = r.visor_tiene_boton && r.llama_nativo && r.base64_correcto && r.nombre_ok && r.mime_ok && r.una_vez_sin_boton && r.errores.length === 0;
  r.resultado = ok ? 'OK' : 'FAIL';
  console.log('SAVEGAL ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_savegallery.txt'), logs.join('\n'));
  process.exit(0);
})().catch((e) => { console.error('FALLO:', e.stack); fs.writeFileSync(path.join(__dirname, 'last_logs_savegallery.txt'), logs.join('\n')); process.exit(1); });
