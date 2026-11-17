// 3213 (dueño 17-11: «los stickers se deben de poder hacer con videos, obviamente se reducen al tamaño del sticker y deben tener un
// límite de tiempo elegible con un tope de segundos máximos (5 por ejemplo)»). El editor de stickers deja elegir un VIDEO, el tramo
// (dónde empieza y cuánto dura, de 1 a 5 s) y lo graba como clip WebM cuadrado sin sonido (en el teléfono, MediaRecorder; aquí, el
// grabador de prueba). A y B por Bluetooth:
//  V1  el validador acepta un clip WebM y rechaza otro formato, HTML y uno demasiado grande; el tramo nunca pasa de 5 s ni del final;
//  V2  en el editor de A: «🎬 Elegir video» → barras «Empieza en» y «Dura» (tope 5 s); pedir 5 s desde el segundo 9 de un video de
//      12 s se ajusta a 7–12; «Enviar» graba ESE tramo y lo manda;
//  V3  B ve el sticker como VIDEO silenciado en bucle (no 🎟️, no el JSON); A también; queda en los stickers de A;
//  V4  B lo agrega a sus stickers desde el menú del mensaje; otra vez → «ya lo tienes»; en el selector de B sale como video;
//  V5  un dato que no es WebM (mp4) o demasiado grande → 🎟️.
// Contraprueba b3205: sin «🎬 Elegir video» y el clip se ve como 🎟️.
// Uso: node stickervideo.js <dir_build>
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
      // jsdom no carga video ni tiene blob: (createObjectURL): un video «de 12 s» que avisa sus datos al ponerle src
      let nUrl = 0; win.URL.createObjectURL = () => 'blob:https://x.nexo.test/' + (++nUrl); win.URL.revokeObjectURL = () => {};
      Object.defineProperty(win.HTMLMediaElement.prototype, 'duration', { configurable: true, get() { return this.__dur || 12; } });
      const sd = Object.getOwnPropertyDescriptor(win.HTMLMediaElement.prototype, 'src');
      Object.defineProperty(win.HTMLMediaElement.prototype, 'src', { configurable: true, get() { return sd.get.call(this); }, set(v) { sd.set.call(this, v); setTimeout(() => this.dispatchEvent(new win.Event('loadedmetadata')), 20); } });
      win.HTMLMediaElement.prototype.play = function () { return Promise.resolve(); }; win.HTMLMediaElement.prototype.pause = function () {};
      // el simulador no graba video: el «grabador» devuelve un clip WebM chiquito y apunta qué tramo le pidieron
      win.NEXO_makeStickerVideo = (st) => { win.__vidReq = { start: st.start, len: st.len, text: st.text }; return 'data:video/webm;base64,GkXfo59ChoEBQveBAULygQRC84EIQoKEd2VibUKHgQRChYECGFOAZwH/////////FUmpZpkq17GDD0JATYCGQ2hyb21lV0GGQ2hyb21lFlSua7+uvdeBAXPFhzm3kz8m2c+DgQKGhlZfVlA4'; };
    },
  });
  const win = dom.window;
  for (let i = 0; i < 100 && !(win.NEXO && win.NEXO.initialized); i++) await sleep(100);
  await sleep(800);
  return { name, native, win };
}
const click = (win, el) => el && el.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
async function openChatWith(p, name) {
  let row = null; for (let i = 0; i < 50 && !row; i++) { row = Array.from(p.win.document.querySelectorAll('#main-contacts-list .ble-contact-row')).find((r) => (r.querySelector('.ble-contact-name') || {}).textContent === name); if (!row) await sleep(100); }
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
  const r = { prueba: 'stickervideo', build: path.basename(buildDir) };
  const A = P.A, B = P.B;
  const bubbles = (p) => Array.from(p.win.document.querySelectorAll('#messages-container .message:not(.progress-placeholder)'));
  const shown = (p) => bubbles(p).map((m) => (m.querySelector('.msg-content') || {}).textContent || '');
  const stickerEls = (p) => Array.from(p.win.document.querySelectorAll('#messages-container .msg-sticker'));
  const VID = A.win.NEXO_makeStickerVideo({ start: 0, len: 1 });
  // V1
  const V = A.win.__nexoIsValidStickerVid, CT = A.win.__nexoClampTrim;
  r.V1_valida = typeof V === 'function' && V(VID) === true && V('data:video/mp4;base64,AAAAIGZ0eXBpc29t') === false && V('<video src=x onerror=alert(1)>') === false
    && V('data:video/webm;base64,' + 'A'.repeat(160000)) === false;
  r.V1_tramo = typeof CT === 'function' ? [CT(12, 9, 5), CT(2.4, 0, 5), CT(30, 0, 9)].map((x) => x.start + '+' + x.len).join(' ') : null;
  r.V1_tramo_ok = r.V1_tramo === '7+5 0+2.4 0+5';
  // Emparejar
  A.win.bleInterface.togglePanel(); const ok = await addFound(A, 'B'); A.win.bleInterface.togglePanel();
  if (!ok) { console.log('STICKERVIDEO ' + JSON.stringify(Object.assign(r, { resultado: 'FALLO', error: 'no empareja' }))); process.exit(1); }
  await sleep(800);
  const openAny = async (p, names) => { for (const n of names) if (await openChatWith(p, n)) return true; return false; };
  await openAny(A, ['B', 'Tester']); await sendText(A, 'hola B'); await sleep(2500);
  // V2: editor
  A.win.__nexoOpenStickerEditor(id('B'), A.win.__nexoSendSticker);
  await sleep(400);
  const q = (s) => A.win.document.querySelector(s);
  r.V2_boton_video = !!q('#stedit-pick-vid');
  if (r.V2_boton_video) {
    click(A.win, q('#stedit-pick-vid'));
    const fin = q('#stedit-vfile');
    Object.defineProperty(fin, 'files', { configurable: true, value: [new A.win.File([Buffer.alloc(2000, 7)], 'clip.mp4', { type: 'video/mp4' })] });
    fin.dispatchEvent(new A.win.Event('change'));
    await sleep(300);
    r.V2_barras = !!(q('#stedit-trim.on') && q('#stedit-start') && q('#stedit-len'));
    r.V2_tope_dura = q('#stedit-len') && q('#stedit-len').max;
    // pedir 5 s desde el segundo 9 (video de 12 s): se ajusta a 7–12
    q('#stedit-len').value = '5'; q('#stedit-len').dispatchEvent(new A.win.Event('input'));
    q('#stedit-start').value = '9'; q('#stedit-start').dispatchEvent(new A.win.Event('input'));
    await sleep(100);
    r.V2_etiquetas = (q('#stedit-start-v') || {}).textContent + ' / ' + (q('#stedit-len-v') || {}).textContent;
    const et = q('#stedit-text'); et.value = 'jaja'; et.dispatchEvent(new A.win.Event('input'));
    click(A.win, q('#stedit-send'));
    await sleep(600);
    r.V2_tramo_grabado = A.win.__vidReq ? A.win.__vidReq.start + '+' + A.win.__vidReq.len : null;
    r.V2_editor_cerrado = !q('#sticker-editor');
  }
  // V3
  r.V3_b_recibe = (await waitFor(async () => (await B.win.vaultLoadMessages(id('A'))).some((m) => /"vid":"data:video\/webm/.test(String(m.content || ''))), 30000)) !== null;
  await openAny(B, ['A', 'Tester']); await sleep(1200);
  const vidOf = (p) => stickerEls(p).map((e) => e.querySelector('video')).filter(Boolean);
  const vOk = (v) => v && /^blob:/.test(String(v.getAttribute('src') || v.src || '')) && v.muted && v.loop;
  r.V3_b_video = vidOf(B).some(vOk);
  r.V3_a_video = vidOf(A).some(vOk);
  r.V3_sin_json = shown(A).concat(shown(B)).filter((t) => t.indexOf('nexo_sticker') >= 0 || t.indexOf('data:video') >= 0).length === 0;
  r.V3_en_mis_stickers_A = A.win.__nexoUserStickers().some((x) => x.vid === VID);
  // V4: agregar en B
  const ctxm = (p, el) => el && el.dispatchEvent(new p.win.MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
  const vidBubble = (p) => bubbles(p).find((m) => !!m.querySelector('.msg-sticker video'));
  const addItem = (p) => p.win.document.querySelector('#nexo-msg-menu .mm-sticker-add');
  ctxm(B, vidBubble(B)); await sleep(500);
  r.V4_menu_agregar = !!addItem(B);
  if (addItem(B)) { click(B.win, addItem(B)); await sleep(600); }
  r.V4_agregado = (await B.win.__nexoLoadUserStickers()).filter((x) => x.vid === VID).length === 1;
  ctxm(B, vidBubble(B)); await sleep(500);
  if (addItem(B)) { click(B.win, addItem(B)); await sleep(600); }
  r.V4_sin_duplicar = (await B.win.__nexoLoadUserStickers()).filter((x) => x.vid === VID).length === 1;
  B.win.__nexoOpenStickerPicker(id('A'), () => {}, () => {}); await sleep(600);
  r.V4_selector_video = !!B.win.document.querySelector('#sticker-sheet .sticker-own video');
  // V5: datos malos → 🎟️
  const nB = async () => (await B.win.vaultLoadMessages(id('A'))).filter((m) => /nexo_sticker/.test(String(m.content || ''))).length;
  const n0 = await nB();
  await A.win.NEXO.app.sendMessage({ content: JSON.stringify({ type: 'nexo_sticker', vid: 'data:video/mp4;base64,AAAAIGZ0eXBpc29t' }), msgId: 'msgvidmalo1', messageId: 'msgvidmalo1' }).catch(() => {});
  await A.win.NEXO.app.sendMessage({ content: JSON.stringify({ type: 'nexo_sticker', vid: 'data:video/webm;base64,' + 'A'.repeat(160000) }), msgId: 'msgvidmalo2', messageId: 'msgvidmalo2' }).catch(() => {});
  await waitFor(async () => (await nB()) >= n0 + 2, 40000);
  await sleep(1500);
  r.V5_malos_respaldo = stickerEls(B).filter((e) => (e.textContent || '').indexOf('🎟️') >= 0 && !e.querySelector('video,img')).length >= 2;
  r.errores = logs.filter((l) => / error: /.test(l) && !/JSDOMERROR|styles\.css|Not implemented|GLOBAL TIMEOUT|net::ERR|fetch/.test(l)).slice(0, 5);
  const okAll = r.V1_valida && r.V1_tramo_ok && r.V2_boton_video && r.V2_barras && r.V2_tope_dura === '5' && r.V2_tramo_grabado === '7+5' && r.V2_editor_cerrado &&
    r.V3_b_recibe && r.V3_b_video && r.V3_a_video && r.V3_sin_json && r.V3_en_mis_stickers_A && r.V4_menu_agregar && r.V4_agregado && r.V4_sin_duplicar && r.V4_selector_video && r.V5_malos_respaldo && !r.errores.length;
  r.resultado = okAll ? 'OK' : 'FALLO';
  console.log('STICKERVIDEO ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_stickervideo.txt'), logs.join('\n'));
  process.exit(okAll ? 0 : 1);
})().catch((e) => { console.log('STICKERVIDEO ' + JSON.stringify({ prueba: 'stickervideo', resultado: 'FALLO', error: String(e && e.message).replace(/"/g, "'") })); console.error(e && e.stack); fs.writeFileSync(path.join(__dirname, 'last_logs_stickervideo.txt'), logs.join('\n')); process.exit(1); });
