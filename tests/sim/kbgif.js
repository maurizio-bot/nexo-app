// 3035 (dueño 13-11, captura del S23: «intentaron mandar unos GIF o stickers y la app no lo permite»): el teclado de Samsung
// decía «No es posible introducir este contenido aquí». La parte nativa (NexoWebView.java) ahora acepta GIF/PNG/JPEG/WebP del
// teclado y llama a window.__nexoKeyboardImage(mime, dataUrl). Aquí: A con el chat de B abierto recibe un GIF del teclado →
// B lo recibe como imagen GIF IDÉNTICA (sin recomprimir); sin chat abierto o con datos que no son imagen, no se manda nada.
// Uso: node kbgif.js <dir_build>
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone, installWebCrypto } = require('./native_mock');

const buildDir = path.resolve(process.argv[2]);
const opts = { readsContentFallback: true, retain: ['onPayloadReceived'], closeOnNoService: true, pace: [15, 15], ioDelay: 25, asymmetric: true };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
class DL extends ResourceLoader { constructor(d) { super(); this.d = d; } fetch(u) { const f = path.join(this.d, decodeURIComponent(new URL(u).pathname)); return fs.existsSync(f) ? Promise.resolve(fs.readFileSync(f)) : Promise.reject(new Error('x')); } }
const X = '0110'.repeat(16);
const mk = (bits, rgb, salt) => 'data:image/jpeg;base64,' + Buffer.from('PH|' + bits + '|' + rgb.join(',') + '|' + salt + '|' + 'x'.repeat(3000)).toString('base64');
const P = mk(X, [120, 100, 90], 'orig'), P_COPIA = mk(X, [121, 99, 90], 'copia');
const phashOf = (url) => { const m = /^PH\|([01]{64})\|(\d+),(\d+),(\d+)\|/.exec(Buffer.from(String(url).split(',')[1] || '', 'base64').toString('latin1')); return m ? { b: m[1], c: [+m[2], +m[3], +m[4]] } : null; };
const logs = [];
async function boot(name, native) {
  const vc = new VirtualConsole();
  ['log', 'warn', 'error'].forEach((l) => vc.on(l, (...a) => logs.push(`${new Date().toISOString().substring(14, 23)} [${name}] ${l}: ` + a.map(String).join(' ').substring(0, 250))));
  const dom = new JSDOM(fs.readFileSync(path.join(buildDir, 'dist', 'index.html'), 'utf8'), {
    url: 'https://' + name.toLowerCase() + '.nexo.test/index.html', runScripts: 'dangerously', resources: new DL(path.join(buildDir, 'dist')), pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) { win.CapacitorCustomPlatform = { name: 'android' }; installWebCrypto(win); win.Capacitor = { Plugins: { NexoBLE: native.plugin() } }; win.HTMLElement.prototype.scrollTo = function () {}; win.NEXO_avatarPHash = phashOf; },
  });
  const win = dom.window;
  for (let i = 0; i < 100 && !(win.NEXO && win.NEXO.initialized); i++) await sleep(100);
  await sleep(800);
  return { name, native, win };
}
const click = (w, el) => el && el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
async function addFound(p) {
  let add = null;
  for (let i = 0; i < 400 && !add; i++) { await sleep(100); add = p.win.document.querySelector('#ble-new-device > div button'); if (!add && !p.win.bleInterface.isScanning) click(p.win, p.win.document.getElementById('ble-scan-btn')); }
  click(p.win, add); await sleep(2000); return !!add;
}
async function openChatWith(p, name) { let row; for (let i = 0; i < 300 && !row; i++) { row = Array.from(p.win.document.querySelectorAll('#main-contacts-list .ble-contact-row')).find((r) => (r.querySelector('.ble-contact-name') || {}).textContent === name); if (!row) await sleep(100); } click(p.win, row); await sleep(600); return !!row; }
async function closeChat(p) { p.win.dispatchEvent(new p.win.CustomEvent('nexo:ble:closeChat', { detail: {} })); await sleep(300); }
function sendText(p, t) { const i = p.win.document.getElementById('message-input'); i.value = t; i.dispatchEvent(new p.win.Event('input', { bubbles: true })); click(p.win, p.win.document.getElementById('send-btn')); }
const wait = async (c, s) => { for (let i = 0; i < s * 5; i++) { if (await c()) return true; await sleep(200); } return false; };

(async () => {
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', opts), nB = new NativePhone('B', 'BB:BB:BB:BB:BB:02', opts);
  [nA, nB].forEach((n) => { radio.add(n); n.load(); });
  const [A, B] = await Promise.all([boot('A', nA), boot('B', nB)]);
  const idA = A.win.bleInterface.localNexoId.toLowerCase(), idB = B.win.bleInterface.localNexoId.toLowerCase();
  const r = { prueba: 'kbgif', build: path.basename(buildDir) };
  A.win.bleInterface.togglePanel(); if (!(await addFound(A))) { console.log('KBGIF ' + JSON.stringify({ resultado: 'FALLO', error: 'no empareja' })); process.exit(1); } A.win.bleInterface.togglePanel();
  await openChatWith(A, 'B'); sendText(A, 'hola'); await sleep(2500);
  r.emparejados = await wait(async () => (await B.win.vaultLoadMessages(idA)).some((m) => m.content === 'hola'), 30);
  r.hay_gancho = typeof A.win.__nexoKeyboardImage === 'function';
  // un GIF de verdad (cabecera GIF89a) de ~40 KB
  const gif = Buffer.concat([Buffer.from('GIF89a', 'latin1'), Buffer.alloc(40 * 1024, 7)]);
  const url = 'data:image/gif;base64,' + gif.toString('base64');
  if (r.hay_gancho) A.win.__nexoKeyboardImage('image/gif', url);
  r.B_recibe_gif = await wait(async () => (await B.win.vaultLoadMessages(idA)).some((m) => !m._own && m.attachmentType === 'image'), 40);
  if (r.B_recibe_gif) {
    const m = (await B.win.vaultLoadMessages(idA)).find((x) => !x._own && x.attachmentType === 'image');
    let payload = m.attachmentPayload;
    if (!payload && typeof B.win.vaultHydrateAttachments === 'function') { try { const h = await B.win.vaultHydrateAttachments([m]); payload = h && h[0] && h[0].attachmentPayload; } catch (e) {} }
    r.formato_gif = !!(m.attachmentMeta && m.attachmentMeta.format === 'gif');
    r.identico = typeof payload === 'string' ? payload === gif.toString('base64') : 'sin_leer';
  }
  // datos que no son imagen: no se manda
  const nOwn = async () => (await A.win.vaultLoadMessages(idB)).filter((m) => m._own && m.attachmentType).length;
  const n0 = await nOwn();
  if (r.hay_gancho) A.win.__nexoKeyboardImage('text/html', 'data:text/html;base64,PHNjcmlwdD4=');
  await sleep(1500);
  r.rechaza_no_imagen = (await nOwn()) === n0;
  r.errores = logs.filter((l) => / error: /.test(l) && !/JSDOMERROR|styles\.css|Not implemented/.test(l)).slice(0, 5);
  const ok = r.emparejados && r.hay_gancho && r.B_recibe_gif && r.formato_gif && r.identico === true && r.rechaza_no_imagen && !r.errores.length;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('KBGIF ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_kbgif.txt'), logs.join('\n'));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('KBGIF ' + JSON.stringify({ resultado: 'FALLO', error: String(e && e.message) })); console.error(e); fs.writeFileSync(path.join(__dirname, 'last_logs_kbgif.txt'), logs.join('\n')); process.exit(1); });
