// 3071 (dueño 13-11, opción A: «limitar fotos a 5 MB»): una foto del chat de más de 5 MB no se manda (aviso «La foto pesa más de
// 5 MB: elige una más pequeña») y ni se lee entera; las demás de la misma tanda sí siguen. Antes: sin tope (se leía y comprimía).
// Uso: node photocap.js <dir_build>
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone, installWebCrypto } = require('./native_mock');
const { importSrc } = require('./srcmod');

const buildDir = path.resolve(process.argv[2]);
const opts = { readsContentFallback: true, retain: ['onPayloadReceived'], closeOnNoService: true, pace: [15, 15], ioDelay: 25 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
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
    beforeParse(win) { win.CapacitorCustomPlatform = { name: 'android' }; installWebCrypto(win); win.Capacitor = { Plugins: { NexoBLE: native.plugin() } }; win.HTMLElement.prototype.scrollTo = function () {}; },
  });
  const win = dom.window;
  for (let i = 0; i < 100 && !(win.NEXO && win.NEXO.initialized); i++) await sleep(100);
  await sleep(800);
  return { name, native, win };
}
const click = (win, el) => el && el.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
async function addFound(p, name) {
  let add = null;
  const find = () => { const row = Array.from(p.win.document.querySelectorAll('#ble-new-device > div')).find((d) => (d.querySelector('span') || {}).textContent === name); return row && row.querySelector('button'); };
  for (let i = 0; i < 400 && !add; i++) { await sleep(100); add = find(); if (!add && !p.win.bleInterface.isScanning) click(p.win, p.win.document.getElementById('ble-scan-btn')); }
  click(p.win, add); await sleep(2000);
  return !!add;
}
async function openChatWith(p, name) {
  const row = Array.from(p.win.document.querySelectorAll('#main-contacts-list .ble-contact-row')).find((r) => (r.querySelector('.ble-contact-name') || {}).textContent === name);
  click(p.win, row); await sleep(500); return !!row;
}

(async () => {
  const r = { build: path.basename(buildDir) };
  // 1) La regla (función pura)
  const cap = await importSrc('ui/attach_cap.js').catch(() => ({}));
  if (typeof cap._photoTooBig === 'function') {
    r.tope_5mb = cap.PHOTO_MAX_BYTES === 5 * 1024 * 1024;
    r.regla = cap._photoTooBig({ type: 'image/jpeg', size: 6e6 }) === true && cap._photoTooBig({ type: 'image/jpeg', size: 5 * 1024 * 1024 }) === false &&
      cap._photoTooBig({ type: 'image/png', size: 300000 }) === false && cap._photoTooBig({ type: 'video/mp4', size: 50e6 }) === false;
  } else { r.tope_5mb = false; r.regla = false; }
  // 2) De punta a punta: galería con una foto de 6 MB y una pequeña
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', opts), nB = new NativePhone('B', 'BB:BB:BB:BB:BB:02', opts);
  [nA, nB].forEach((n) => { radio.add(n); n.load(); });
  const A = await boot('A', nA), B = await boot('B', nB);
  const idB = B.win.bleInterface.localNexoId.toLowerCase();
  A.win.bleInterface.togglePanel(); const paired = await addFound(A, 'B'); A.win.bleInterface.togglePanel();
  if (!paired) { console.log('PHOTOCAP ' + JSON.stringify({ error: 'no empareja', resultado: 'FALLO' })); process.exit(1); }
  await openChatWith(A, 'B');
  const mark = logs.length;
  // qué fotos se LEEN del teléfono (FileReader): la grande ya no
  const read = [];
  const rd = A.win.FileReader.prototype.readAsDataURL;
  A.win.FileReader.prototype.readAsDataURL = function (f) { read.push(f && f.name); return rd.call(this, f); };
  click(A.win, A.win.document.querySelector('.attach-menu-item[data-type="gallery"]')); await sleep(400);
  const fin = Array.from(A.win.document.querySelectorAll('input[type=file]')).pop();
  const big = Buffer.alloc(6 * 1024 * 1024, 7), small = Buffer.alloc(40 * 1024, 9);
  Object.defineProperty(fin, 'files', { configurable: true, value: [new A.win.File([big], 'grande.jpg', { type: 'image/jpeg' }), new A.win.File([small], 'chica.jpg', { type: 'image/jpeg' })] });
  fin.dispatchEvent(new A.win.Event('change'));
  await sleep(4000);
  const after = logs.slice(mark);
  const ms = await A.win.vaultLoadMessages(idB);
  r.grande_no_se_manda = !ms.some((m) => m.attachmentMeta && m.attachmentMeta.name === 'grande.jpg');
  r.grande_avisa = A.win.document.body.textContent.indexOf('La foto pesa más de 5 MB') >= 0;
  r.grande_no_se_lee = read.indexOf('grande.jpg') < 0 && after.some((l) => /\[A\].*Foto de 6\.0 MB: más de 5 MB/.test(l));
  // la pequeña de la misma tanda sigue su camino: se lee para comprimirla (en el simulador no hay lienzo; basta con que se procese)
  r.chica_sigue = read.indexOf('chica.jpg') >= 0;
  r.leidas = read;
  r.resultado = r.tope_5mb && r.regla && r.grande_no_se_manda && r.grande_avisa && r.grande_no_se_lee && r.chica_sigue ? 'OK' : 'FALLO';
  console.log('PHOTOCAP ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_photocap.txt'), logs.join('\n'));
  process.exit(0);
})().catch((e) => { console.error('FALLO:', e.stack); fs.writeFileSync(path.join(__dirname, 'last_logs_photocap.txt'), logs.join('\n')); process.exit(1); });
