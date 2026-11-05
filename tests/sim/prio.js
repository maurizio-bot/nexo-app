// Prioridad de lo chico sobre lo grande (#dueño 05-11: «la foto tarda detrás de un archivo grande»).
// A manda a B un ARCHIVO grande (bulk) por Bluetooth y, con eso en curso, una FOTO chica. Con la prioridad, el archivo
// grande le CEDE la radio: la foto sale ANTES de que el archivo termine. Se mide dos veces: sin prioridad (baseline) y
// con prioridad, y se comprueba que (a) con prioridad la foto llega antes que el grande, (b) con prioridad es más
// rápida que sin, y (c) NADA se pierde: el grande y la foto llegan en los dos casos (el grande no se muere de hambre).
// Uso: node prio.js <dir_build>
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone } = require('./native_mock');

const buildDir = path.resolve(process.argv[2]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
class DL extends ResourceLoader { constructor(d) { super(); this.d = d; } fetch(u) { const f = path.join(this.d, decodeURIComponent(new URL(u).pathname)); return fs.existsSync(f) ? Promise.resolve(fs.readFileSync(f)) : Promise.reject(new Error('x')); } }
const logs = [];
async function boot(name, address, radio) {
  // Solo Bluetooth (sin Wi-Fi, sin L2CAP) → los archivos van por ChatStream, que es donde está la cola por enlace y la
  // contención. Ritmo rápido para que el test no sea eterno (la contención es relativa, no depende del ritmo absoluto).
  const o = { readsContentFallback: true, mtu: 128, pace: [2, 2], noL2: true, retain: ['onPayloadReceived'], asymmetric: true };
  const native = new NativePhone(name, address, o);
  radio.add(native); native.load();
  const vc = new VirtualConsole(); ['warn', 'error'].forEach((l) => vc.on(l, (...a) => logs.push(`[${name}] ${l}: ` + a.map(String).join(' ').substring(0, 200))));
  const dom = new JSDOM(fs.readFileSync(path.join(buildDir, 'dist', 'index.html'), 'utf8'), { url: 'https://' + name.toLowerCase() + '.nexo.test/index.html', runScripts: 'dangerously', resources: new DL(path.join(buildDir, 'dist')), pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) { win.CapacitorCustomPlatform = { name: 'android' }; require('./native_mock').installWebCrypto(win); win.Capacitor = { Plugins: { NexoBLE: native.plugin() } }; win.HTMLElement.prototype.scrollTo = function () {}; } });
  const win = dom.window; for (let i = 0; i < 100 && !(win.NEXO && win.NEXO.initialized); i++) await sleep(100); await sleep(800);
  return { name, native, win };
}
const click = (w, el) => el && el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
async function openChat(p) { let row; for (let i = 0; i < 300 && !row; i++) { row = p.win.document.querySelector('#main-contacts-list .ble-contact-row'); if (!row) await sleep(100); } click(p.win, row); await sleep(300); }
async function sendText(p, t) { const i = p.win.document.getElementById('message-input'); i.value = t; i.dispatchEvent(new p.win.Event('input', { bubbles: true })); click(p.win, p.win.document.getElementById('send-btn')); }
async function sendFile(p, name, type, bytes) {
  click(p.win, p.win.document.querySelector('.attach-menu-item[data-type="file"]')); await sleep(80);
  const fin = Array.from(p.win.document.querySelectorAll('input[type=file]')).pop();
  Object.defineProperty(fin, 'files', { value: [new p.win.File([bytes], name, { type })], configurable: true }); fin.dispatchEvent(new p.win.Event('change'));
}
const got = (p, label) => Array.from(p.win.document.querySelectorAll('#messages-container .message:not(.own)')).some((m) => (m.textContent || '').indexOf(label) >= 0);
const rnd = (n, s) => { const b = Buffer.alloc(n); for (let i = 0; i < n; i++) b[i] = (i * 7919 + s) & 255; return b; };
const wait = async (c, s) => { for (let i = 0; i < s * 5 && !(await c()); i++) await sleep(200); return await c(); };

async function run(prio, seed) {
  const radio = new Radio();
  const [A, B] = await Promise.all([boot('A', 'AA:AA:AA:AA:AA:0' + seed, radio), boot('B', 'BB:BB:BB:BB:BB:0' + seed, radio)]);
  A.win.NEXO_BULK_PRIO = prio;   // interruptor de la prioridad (false = baseline)
  // Emparejar y abrir chat
  A.win.bleInterface.togglePanel(); let add = null;
  for (let i = 0; i < 400 && !add; i++) { await sleep(100); add = A.win.document.querySelector('#ble-new-device > div button'); if (!add && !A.win.bleInterface.isScanning) click(A.win, A.win.document.getElementById('ble-scan-btn')); }
  click(A.win, add); await sleep(1500);
  if (A.win.document.getElementById('ble-panel').classList.contains('active')) A.win.bleInterface.togglePanel();
  await openChat(A); await sendText(A, 'hola'); await sleep(2500); await openChat(B); await sleep(400);
  // Archivo GRANDE (bulk): ~700 KB crudo → base64 ~930 KB > 600 000 → bulk. Muchos trozos por MTU 128.
  await sendFile(A, 'grande.bin', 'application/octet-stream', rnd(700 * 1024, seed));
  await sleep(2500);  // dejar que el grande empiece a copar la cola
  const bigDoneAtPhoto = got(B, 'grande.bin');
  // Archivo chico (interactivo, representa la foto): 40 KB con nombre (tarjeta detectable). Se mide cuánto tarda.
  const t0 = Date.now();
  await sendFile(A, 'foto.pdf', 'application/pdf', rnd(40 * 1024, seed + 50));
  const fotoLlega = await wait(() => got(B, 'foto.pdf'), 120);
  const fotoDt = Math.round((Date.now() - t0) / 100) / 10;
  const bigDoneWhenFoto = got(B, 'grande.bin');
  // El grande tiene que terminar también (no se muere de hambre)
  const grandeLlega = await wait(() => got(B, 'grande.bin'), 240);
  return { fotoLlega, fotoDt, grandeLlega, fotoAntesDelGrande: fotoLlega && !bigDoneWhenFoto, bigDoneAtPhoto };
}

(async () => {
  const r = { build: path.basename(buildDir) };
  const off = await run(false, 1);
  const on = await run(true, 2);
  r.sin_prio = off; r.con_prio = on;
  // Con prioridad: la foto llega, antes de que el grande termine, y más rápido que sin prioridad. Los dos (grande y foto)
  // llegan en ambos casos (nada se pierde / nadie se muere de hambre).
  r.foto_llega_con_prio = on.fotoLlega;
  r.foto_antes_del_grande = on.fotoAntesDelGrande;
  r.prio_mas_rapida = on.fotoDt < off.fotoDt;
  r.nada_se_pierde = off.fotoLlega && off.grandeLlega && on.fotoLlega && on.grandeLlega;
  r.errores = logs.filter((l) => /TypeError|undefined is not|is not a function/.test(l) && /error/.test(l)).slice(0, 4);
  const ok = r.foto_llega_con_prio && r.foto_antes_del_grande && r.prio_mas_rapida && r.nada_se_pierde && r.errores.length === 0;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('PRIO ' + JSON.stringify(r));
  try { fs.writeFileSync(path.join(__dirname, 'last_logs_prio.txt'), logs.join('\n')); } catch (e) {}
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error('FALLO:', e.stack); try { fs.writeFileSync(path.join(__dirname, 'last_logs_prio.txt'), logs.join('\n')); } catch (x) {} process.exit(1); });
