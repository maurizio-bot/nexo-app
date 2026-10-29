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

  // 0) Función pura del mapa (de solo lectura): id conocido → SVG; desconocido → null.
  r.svg_feliz = typeof A.win.__nexoStickerSvg === 'function' && String(A.win.__nexoStickerSvg('feliz') || '').indexOf('<svg') >= 0;
  r.svg_desconocido_null = A.win.__nexoStickerSvg('noexiste') === null;

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

  // 2) B abre el chat y ve el SVG (no el JSON); A también ve el propio como SVG.
  await openChatWith(B, 'A'); await sleep(1000);
  r.b_pinta_svg = stickerEls(B).some((e) => !!e.querySelector('svg'));
  r.a_pinta_svg = stickerEls(A).some((e) => !!e.querySelector('svg'));

  // 3) Id DESCONOCIDO: A manda, B lo ve como 🎟️ (respaldo), nunca bytes crudos ni JSON.
  A.win.__nexoSendSticker(id('B'), 'noexiste');
  await waitFor(async () => (await B.win.vaultLoadMessages(id('A'))).filter((m) => /"type":"nexo_sticker"/.test(String(m.content || ''))).length >= 2, 20000);
  await sleep(1500);
  r.desconocido_fallback = stickerEls(B).some((e) => (e.textContent || '').indexOf('🎟️') >= 0 && !e.querySelector('svg'));

  // 4) NUNCA se ve el JSON crudo del sticker (ni en A ni en B).
  r.sin_json = shown(A).concat(shown(B)).filter((t) => /"type":"nexo_/.test(t) || t.indexOf('nexo_sticker') >= 0).length === 0;

  r.resultado = (r.svg_feliz && r.svg_desconocido_null && r.b_recibe && r.b_pinta_svg && r.a_pinta_svg && r.desconocido_fallback && r.sin_json) ? 'OK' : 'FALLO';
  console.log('STICKER ' + JSON.stringify(r));
  try { fs.writeFileSync(path.join(buildDir, 'last_logs_stickers.txt'), logs.slice(-250).join('\n')); } catch (e) {}
  process.exit(0);
})().catch((e) => { console.log('STICKER ' + JSON.stringify({ error: String((e && e.message) || e) })); process.exit(0); });
