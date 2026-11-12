// Stickers (2829): A manda un sticker a B. Se ve el SVG INCORPORADO (no el JSON crudo), propio y recibido; un id
// desconocido cae a 🎟️ (nunca a bytes del emisor). Nada de JSON a la vista. Función del mapa comprobada directa.
// Uso: node stickers.js <dir_build> [--io-delay=25]
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
const logs = [];
async function boot(name, native) {
  native.listeners = new Map();
  const vc = new VirtualConsole();
  ['log', 'warn', 'error'].forEach((l) => vc.on(l, (...a) => logs.push(`${new Date().toISOString().substring(14, 23)} [${name}] ${l}: ` + a.map(String).join(' ').substring(0, 250))));
  const dom = new JSDOM(fs.readFileSync(path.join(buildDir, 'dist', 'index.html'), 'utf8'), {
    url: 'https://' + name.toLowerCase() + '.nexo.test/index.html', runScripts: 'dangerously',
    resources: new DistLoader(path.join(buildDir, 'dist')), pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) {
      win.CapacitorCustomPlatform = { name: 'android' }; installWebCrypto(win); win.Capacitor = { Plugins: { NexoBLE: native.plugin() } };
      win.HTMLElement.prototype.scrollTo = function () {}; Object.defineProperty(win.navigator, 'clipboard', { value: { writeText: async (t) => { win.__copied = t; } } });
    },
  });
  const win = dom.window;
  for (let i = 0; i < 100 && !(win.NEXO && win.NEXO.initialized); i++) await sleep(100);
  await sleep(800);
  return { name, native, win };
}
const click = (win, el) => el && el.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
async function openChatWith(p, name) {
  const row = Array.from(p.win.document.querySelectorAll('#main-contacts-list .ble-contact-row')).find((r) => (r.querySelector('.ble-contact-name') || {}).textContent === name);
  click(p.win, row); await sleep(600); return !!row;
}
async function closeChat(p) { p.win.dispatchEvent(new p.win.CustomEvent('nexo:ble:closeChat', { detail: {} })); await sleep(300); }
async function sendText(p, t) { const i = p.win.document.getElementById('message-input'); i.value = t; i.dispatchEvent(new p.win.Event('input', { bubbles: true })); click(p.win, p.win.document.getElementById('send-btn')); }
async function addFound(p, name) {
  let add = null;
  if (p.win.bleInterface.isScanning) { click(p.win, p.win.document.getElementById('ble-scan-btn')); await sleep(400); }
  const find = () => { const row = Array.from(p.win.document.querySelectorAll('#ble-new-device > div')).find((d) => (d.querySelector('span') || {}).textContent === name); return row && row.querySelector('button'); };
  for (let i = 0; i < 400 && !add; i++) { await sleep(100); add = find(); if (!add && !p.win.bleInterface.isScanning) click(p.win, p.win.document.getElementById('ble-scan-btn')); }
  click(p.win, add); await sleep(2000);
  return !!add;
}
async function waitFor(fn, ms) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return Math.round((Date.now() - t0) / 100) / 10; await sleep(500); } return null; }

(async () => {
  const radio = new Radio();
  const names = ['A', 'B'];
  const nat = {}, P = {};
  names.forEach((n, i) => { nat[n] = new NativePhone(n, n.repeat(2) + ':' + n.repeat(2) + ':' + n.repeat(2) + ':' + n.repeat(2) + ':' + n.repeat(2) + ':0' + (i + 1), opts); radio.add(nat[n]); nat[n].load(); });
  (await Promise.all(names.map((n) => boot(n, nat[n])))).forEach((p) => { P[p.name] = p; });
  const id = (n) => P[n].win.bleInterface.localNexoId.toLowerCase();
  const r = { build: path.basename(buildDir) };
  const A = P.A, B = P.B;
  const bubbles = (p) => Array.from(p.win.document.querySelectorAll('#messages-container .message:not(.progress-placeholder)'));
  const shown = (p) => bubbles(p).map((m) => (m.querySelector('.msg-content') || {}).textContent || '');
  const stickerEls = (p) => Array.from(p.win.document.querySelectorAll('#messages-container .msg-sticker'));

  // 0) Función pura del mapa (de solo lectura): id conocido → RUTA de imagen del pack; desconocido → null.
  r.asset_feliz = typeof A.win.__nexoStickerAsset === 'function' && String(A.win.__nexoStickerAsset('feliz') || '').indexOf('assets/stickers/') >= 0;
  r.asset_desconocido_null = A.win.__nexoStickerAsset('noexiste') === null;

  // Emparejar A y B (kx con fx:1), como en chatactions.
  P.A.win.bleInterface.togglePanel(); const ok = await addFound(P.A, 'B'); P.A.win.bleInterface.togglePanel();
  await sleep(800);
  await openChatWith(P.A, 'B'); await sendText(P.A, 'hola B'); await sleep(2500); await closeChat(P.A);
  if (!ok) { console.log('STICKER ' + JSON.stringify({ error: 'no empareja AB' })); process.exit(0); }
  await sleep(3000);

  // 1) A manda un sticker CONOCIDO a B.
  await openChatWith(A, 'B'); await sleep(600);
  A.win.__nexoSendSticker(id('B'), 'feliz');
  r.b_recibe = !!(await waitFor(async () => (await B.win.vaultLoadMessages(id('A'))).some((m) => /"type":"nexo_sticker"/.test(String(m.content || ''))), 30000));

  // 2) B abre el chat y ve la IMAGEN del pack (no el JSON); A también ve la propia como <img> con ruta del repo.
  await openChatWith(B, 'A'); await sleep(1000);
  var packImg = (p) => stickerEls(p).some((e) => { var im = e.querySelector('img'); return im && String(im.getAttribute('src') || '').indexOf('assets/stickers/') >= 0; });
  r.b_pinta_pack = packImg(B);
  r.a_pinta_pack = packImg(A);

  // 3) Id DESCONOCIDO: A manda, B lo ve como 🎟️ (respaldo), nunca bytes crudos ni JSON ni <img>.
  A.win.__nexoSendSticker(id('B'), 'noexiste');
  await waitFor(async () => (await B.win.vaultLoadMessages(id('A'))).filter((m) => /"type":"nexo_sticker"/.test(String(m.content || ''))).length >= 2, 20000);
  await sleep(1500);
  r.desconocido_fallback = stickerEls(B).some((e) => (e.textContent || '').indexOf('🎟️') >= 0 && !e.querySelector('img'));

  // 5) Sticker PROPIO (2878): A manda una IMAGEN (sticker creado). B y A la pintan como <img> (no SVG, no JSON crudo).
  var VALID_IMG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC';
  A.win.__nexoSendSticker(id('B'), { img: VALID_IMG });
  r.b_recibe_img = !!(await waitFor(async () => (await B.win.vaultLoadMessages(id('A'))).filter((m) => /"type":"nexo_sticker"/.test(String(m.content || ''))).length >= 3, 25000));
  await sleep(1500);
  var imgsOf = (p) => stickerEls(p).map((e) => e.querySelector('img')).filter(Boolean);
  r.b_pinta_img = imgsOf(B).some((im) => String(im.getAttribute('src') || '').indexOf('data:image/') === 0);
  r.a_pinta_img = imgsOf(A).some((im) => String(im.getAttribute('src') || '').indexOf('data:image/') === 0);

  // 6) Validador anti-XSS (el MISMO que usa el render): acepta imagen válida; RECHAZA html, formato raro y exceso de tamaño.
  var V = A.win.__nexoIsValidStickerImg;
  r.valida_ok = typeof V === 'function' && V(VALID_IMG) === true
    && V('data:text/html;base64,QUJD') === false
    && V('<img src=x onerror=alert(1)>') === false
    && V('data:image/png;base64,' + 'A'.repeat(100000)) === false;

  // 7) NUNCA se ve el JSON crudo del sticker (ni pack ni imagen propia, ni en A ni en B).
  r.sin_json = shown(A).concat(shown(B)).filter((t) => /"type":"nexo_/.test(t) || t.indexOf('nexo_sticker') >= 0).length === 0;

  // 8) A5 (2982): borrar un sticker PROPIO desde el selector (clic derecho / pulsación larga + confirmación); uno corto lo manda.
  A.win.__nexoAddUserSticker(VALID_IMG);
  var nProp = () => A.win.__nexoUserStickers().length;
  r.prop_antes = nProp();
  A.win.__nexoOpenStickerPicker(id('B'), () => {}, () => {});
  await sleep(800);
  var own = () => Array.from(A.win.document.querySelectorAll('#sticker-sheet .sticker-own'));
  r.selector_muestra_propio = own().length >= 1;
  A.win.confirm = () => false;   // cancelar: no borra
  own()[0].dispatchEvent(new A.win.MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
  await sleep(300);
  r.cancelar_no_borra = nProp() === r.prop_antes && own().length >= 1;
  A.win.confirm = () => true;    // aceptar: borra de la lista y de la rejilla
  own()[0].dispatchEvent(new A.win.MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
  await sleep(300);
  r.borrar_quita = nProp() === r.prop_antes - 1 && own().length === r.prop_antes - 1;
  A.win.__nexoCloseStickerPicker && A.win.__nexoCloseStickerPicker();

  // 9) 3032 (dueño 12-11: «que si me mandan un sticker lo pueda agregar a mis stickers»): B mantiene pulsado el sticker
  //    PROPIO que le mandó A → «Agregar a mis stickers» → queda en sus stickers (y guardado); otra vez → no se duplica.
  //    En A (es suyo) no sale la opción.
  var ctxm = (p, el) => el && el.dispatchEvent(new p.win.MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
  var imgBubble = (p) => bubbles(p).find((m) => { var im = m.querySelector('.msg-sticker img'); return im && String(im.getAttribute('src') || '') === VALID_IMG; });
  var addItem = (p) => p.win.document.querySelector('#nexo-msg-menu .mm-sticker-add');
  var closeMenu = (p) => { var c = p.win.document.querySelector('#nexo-msg-menu .mm-cancel'); if (c) click(p.win, c); };
  var nB0 = (await B.win.__nexoLoadUserStickers()).filter((x) => x.img === VALID_IMG).length;
  ctxm(B, imgBubble(B)); await sleep(600);
  r.b_menu_agregar = !!addItem(B);
  click(B.win, addItem(B)); await sleep(800);
  r.b_agregado = B.win.__nexoUserStickers().filter((x) => x.img === VALID_IMG).length === nB0 + 1;
  r.b_guardado = /iVBORw0KGgo/.test((await B.win.Capacitor.Plugins.NexoBLE.loadFromFile({ filename: 'nexo_my_stickers.json' })).content || '');
  ctxm(B, imgBubble(B)); await sleep(600); click(B.win, addItem(B)); await sleep(800);
  r.b_no_duplica = B.win.__nexoUserStickers().filter((x) => x.img === VALID_IMG).length === nB0 + 1;
  ctxm(A, imgBubble(A)); await sleep(600);
  r.a_sin_opcion = !!A.win.document.getElementById('nexo-msg-menu') && !addItem(A);
  closeMenu(A);
  r.resultado = (r.b_menu_agregar && r.b_agregado && r.b_guardado && r.b_no_duplica && r.a_sin_opcion && r.asset_feliz && r.asset_desconocido_null && r.b_recibe && r.b_pinta_pack && r.a_pinta_pack && r.desconocido_fallback && r.b_recibe_img && r.b_pinta_img && r.a_pinta_img && r.valida_ok && r.selector_muestra_propio && r.cancelar_no_borra && r.borrar_quita && r.sin_json) ? 'OK' : 'FALLO';
  console.log('STICKER ' + JSON.stringify(r));
  try { fs.writeFileSync(path.join(buildDir, 'last_logs_stickers.txt'), logs.slice(-250).join('\n')); } catch (e) {}
  process.exit(0);
})().catch((e) => { console.log('STICKER ' + JSON.stringify({ error: String((e && e.message) || e) })); process.exit(0); });
