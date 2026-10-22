// Archivos (botón archivo): el selector sigue vivo aunque se tarde >30 s en elegir, avisos (demasiado
// grande, no se pudo leer), PDF con miniatura y páginas, nombre del otro teléfono como texto (no HTML),
// tipo (mime) que llega, tocar → abrir con otra app (plugin openFile) y APK.
// Uso: node files.js <dir_build> [--io-delay=25]
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone, installWebCrypto } = require('./native_mock');

const buildDir = path.resolve(process.argv[2]);
const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith('--' + k)); if (!a) return d; const v = a.split('=')[1]; return v === undefined ? true : Number(v); };
const opts = { readsContentFallback: true, retain: ['onPayloadReceived'], closeOnNoService: true, pace: [15, 15], ioDelay: arg('io-delay', 0), asymmetric: true };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
class DistLoader extends ResourceLoader {
  constructor(dir) { super(); this.dir = dir; }
  fetch(url) { const f = path.join(this.dir, decodeURIComponent(new URL(url).pathname)); return fs.existsSync(f) ? Promise.resolve(fs.readFileSync(f)) : Promise.reject(new Error('no existe ' + f)); }
}
// Todo lo que llega a cualquier teléfono por radio
const air = [];
const orig = NativePhone.prototype._processReceivedChunk;
NativePhone.prototype._processReceivedChunk = function (from, chunk, source) { air.push(String(chunk)); return orig.call(this, from, chunk, source); };
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
async function openChat(p) { click(p.win, p.win.document.querySelector('#main-contacts-list .ble-contact-row')); await sleep(500); }
async function sendText(p, t) { const i = p.win.document.getElementById('message-input'); i.value = t; i.dispatchEvent(new p.win.Event('input', { bubbles: true })); click(p.win, p.win.document.getElementById('send-btn')); }

const toastText = (p) => ((p.win.document.getElementById('perm-error-toast') || {}).textContent || '');
async function pick(p, file, waitMs) {
  click(p.win, p.win.document.querySelector('.attach-menu-item[data-type="file"]')); await sleep(200);
  const fin = Array.from(p.win.document.querySelectorAll('input[type=file]')).pop();
  if (waitMs) await sleep(waitMs);
  if (!fin || !fin.isConnected) return false;
  Object.defineProperty(fin, 'files', { value: [file], configurable: true });
  fin.dispatchEvent(new p.win.Event('change'));
  return true;
}
const fakePdf = (pages, kb) => { const head = '%PDF-1.4\n1 0 obj << /Type /Pages /Count ' + pages + ' >> endobj\n'; const b = Buffer.alloc(kb * 1024, 0x20); b.write(head, 0, 'latin1'); for (let i = head.length; i < b.length; i++) b[i] = 32 + ((i * 7) % 90); return b; };

(async () => {
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', opts), nB = new NativePhone('B', 'BB:BB:BB:BB:BB:02', opts);
  radio.add(nA); radio.add(nB); nA.load(); nB.load();
  const [A, B] = await Promise.all([boot('A', nA), boot('B', nB)]);
  const r = { build: path.basename(buildDir) };
  A.win.bleInterface.togglePanel();
  let add = null;
  for (let i = 0; i < 400 && !add; i++) { await sleep(100); add = A.win.document.querySelector('#ble-new-device button'); if (!add && !A.win.bleInterface.isScanning) click(A.win, A.win.document.getElementById('ble-scan-btn')); }
  if (!add) { console.log('FILES ' + JSON.stringify({ error: 'no empareja' })); process.exit(0); }
  click(A.win, add); await sleep(2500);
  A.win.bleInterface.togglePanel();
  await openChat(A);
  const idA = A.win.bleInterface.localNexoId;

  // 1) Demasiado grande (APK de 3 MB): debe salir el aviso
  r.selector_grande = await pick(A, new A.win.File([Buffer.alloc(3 * 1024 * 1024, 1)], 'nexo.apk', { type: 'application/vnd.android.package-archive' }));
  await sleep(500);
  r.aviso_grande = toastText(A).substring(0, 60);
  // 2) Error de lectura: debe salir un aviso
  const origRead = A.win.FileReader.prototype.readAsDataURL;
  A.win.FileReader.prototype.readAsDataURL = function () { setTimeout(() => this.onerror && this.onerror(new A.win.Event('error')), 10); };
  await pick(A, new A.win.File([Buffer.alloc(1000, 2)], 'x.bin', { type: '' }));
  await sleep(500);
  A.win.FileReader.prototype.readAsDataURL = origRead;
  r.aviso_lectura = toastText(A).substring(0, 60);
  // 3) PDF elegido tras 35 s en el selector, con un nombre "peligroso"
  const pdf = fakePdf(3, 60);
  const badName = '<img src=x onerror="window.__xss=1">informe.pdf';
  r.selector_vivo_35s = await pick(A, new A.win.File([pdf], badName, { type: 'application/pdf' }), 35000);
  await sleep(15000);
  // 4) APK pequeña con tipo vacío (algunos selectores no lo dan)
  const apk = Buffer.alloc(40 * 1024, 5); apk.write('PK', 0);
  await pick(A, new A.win.File([apk], 'herramienta.apk', { type: '' }));
  await sleep(15000);

  await openChat(B);
  await sleep(1500);
  const cards = Array.from(B.win.document.querySelectorAll('#messages-container .message.other .file-attachment'));
  r.burbujas_archivo_B = cards.length;
  const cPdf = cards.find((c) => /informe/.test(c.textContent)), cApk = cards.find((c) => /herramienta/.test(c.textContent));
  r.nombre_pdf_como_texto = !!cPdf && cPdf.querySelector('.file-name').textContent === badName;
  r.html_inyectado = !!B.win.document.querySelector('#messages-container img[src="x"]') || !!B.win.__xss;
  r.miniatura_pdf_B = !!cPdf && /^data:image\/jpeg;base64,/.test((cPdf.querySelector('.file-thumb') || {}).src || '') && cPdf.querySelector('.file-thumb').style.display === 'block';
  r.texto_pdf_B = cPdf ? cPdf.querySelector('.file-sub').textContent : null;
  r.texto_apk_B = cApk ? cApk.textContent : null;
  const vB = await B.win.vaultLoadMessages(idA);
  const mPdf = vB.find((m) => m.attachmentMeta && /informe/.test(m.attachmentMeta.name || ''));
  r.mime_llega = mPdf ? mPdf.attachmentMeta.mime : null;
  r.paginas_llegan = mPdf ? mPdf.attachmentMeta.pages : null;
  if (cPdf) { click(B.win, cPdf); await sleep(500); }
  if (cApk) { click(B.win, cApk); await sleep(500); }
  r.abiertos_en_B = (nB.opened || []).map((o) => ({ name: o.name, mime: o.mime, identico: o.b64 === (o.name.indexOf('informe') >= 0 ? pdf : apk).toString('base64') }));
  // Burbuja propia en A también se abre
  const ownPdf = Array.from(A.win.document.querySelectorAll('#messages-container .message.own .file-attachment')).find((c) => /informe/.test(c.textContent));
  r.miniatura_pdf_A = !!ownPdf && ((ownPdf.querySelector('.file-thumb') || {}).style || {}).display === 'block';
  r.en_claro_en_el_aire = ['informe', 'herramienta', pdf.toString('base64').substring(400, 460)].filter((x) => air.join('\n').indexOf(x) >= 0);
  r.estados_A = Array.from(A.win.document.querySelectorAll('#messages-container .message.own .msg-status')).map((e) => e.className.replace('msg-status status-', ''));
  r.diag_A = logs.filter((l) => l.startsWith('[A]') && /\[ATTACH\]/.test(l)).map((l) => l.replace(/^\[A\] \w+: /, '').substring(0, 70));
  console.log('FILES ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_files.txt'), logs.join('\n'));
  process.exit(0);
})().catch((e) => { console.error('FALLO:', e.stack); fs.writeFileSync(path.join(__dirname, 'last_logs_files.txt'), logs.join('\n')); process.exit(1); });
