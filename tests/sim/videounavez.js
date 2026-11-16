// 3163 (dueño 16-11: «hay que aplicar lo de una sola vista a vídeos también»). «Ver una vez» (#94) era solo para FOTOS: el 👁 de la
// revisión de la cámara se escondía con un vídeo, la revisión de la galería no ponía ojo a los vídeos y _sendVideo no llevaba la marca.
// Comprueba, con el código real de la app (la recodificación se simula: window.NEXO_makeVideoPreview):
//  (a) CÁMARA: revisión de un vídeo grabado con 👁 → A ve «Vídeo de una vez · enviado» (sin previa) y B «Toca para ver · una vez» (sin
//      miniatura, sin reproductor); al tocar se abre el visor y se reproduce el vídeo (el HD si ya llegó), sin botón de guardar ni
//      descarga del reproductor; queda consumido (sin vídeo en el teléfono, sin miniatura) y al CERRAR el visor se libera su URL; la
//      burbuja queda «Abierto», no se puede volver a abrir (ni al reabrir el chat) y el HD que llega DESPUÉS de abrirlo se tira (no revive);
//  (b) GALERÍA: 1 foto + 1 vídeo → la revisión pone ojo también al vídeo; con el ojo solo en el vídeo, solo el vídeo llega «una vez»;
//  (c) ARCHIVO GRANDE: el vídeo que no cabe como adjunto por Bluetooth sale ORIGINAL por Wi-Fi Direct con la marca; si Wi-Fi Direct
//      falla, la previa + HD por Bluetooth también la llevan; por el BUZÓN DE ARCHIVOS (contacto ausente) también: nunca llega normal;
//  (d) GRUPO: un vídeo solo de la galería (también con revisión y ojo) va «una vez» en el sobre del grupo; el HD de cada miembro no
//      revive el ya abierto;
//  (e) VISOR: un vídeo «una vez» entre un vídeo y una foto normales no entra al deslizar entre fotos (ni se gasta), y el suyo no se
//      desliza de lado y se cierra deslizando hacia arriba;
//  (f) PUENTE (Jump A–B–C): el puente reenvía la marca (antes la perdía: llegaba como vídeo normal, y lo mismo una foto).
// Uso: node videounavez.js <dir_build>   →   VIDEOUNAVEZ {json} con "resultado":"OK"|"FALLO"; sale 0/1
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone, installWebCrypto } = require('./native_mock');

const buildDir = path.resolve(process.argv[2]);
const BASE = { readsContentFallback: true, retain: ['onPayloadReceived'], closeOnNoService: true, pace: [15, 15], ioDelay: 25, asymmetric: true, noL2: true };
const PREV_KB = 24;   // previa «recodificada» simulada
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
class DistLoader extends ResourceLoader {
  constructor(dir) { super(); this.dir = dir; }
  fetch(url) { const f = path.join(this.dir, decodeURIComponent(new URL(url).pathname)); return fs.existsSync(f) ? Promise.resolve(fs.readFileSync(f)) : Promise.reject(new Error('no existe ' + f)); }
}
const logs = [];
let RELAYS = null;
async function boot(name, native) {
  native.listeners = new Map();
  const vc = new VirtualConsole();
  ['log', 'warn', 'error'].forEach((l) => vc.on(l, (...a) => logs.push(`${new Date().toISOString().substring(14, 23)} [${name}] ${l}: ` + a.map(String).join(' ').substring(0, 300))));
  const dom = new JSDOM(fs.readFileSync(path.join(buildDir, 'dist', 'index.html'), 'utf8'), {
    url: 'https://' + name.toLowerCase() + '.nexo.test/index.html', runScripts: 'dangerously',
    resources: new DistLoader(path.join(buildDir, 'dist')), pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) {
      if (RELAYS) win.NEXO_NET_RELAYS = RELAYS;
      win.CapacitorCustomPlatform = { name: 'android' }; installWebCrypto(win); win.Capacitor = { Plugins: { NexoBLE: native.plugin() } }; win.HTMLElement.prototype.scrollTo = function () {};
      // URL de objeto simuladas: se guarda qué Blob es cada una (para saber QUÉ vídeo se reproduce) y cuáles se liberan
      let n = 0; win.__blobs = new Map(); win.__revoked = new Set();
      win.URL.createObjectURL = (b) => { const u = 'blob:sim/' + name + '/' + (++n); win.__blobs.set(u, b); return u; };
      win.URL.revokeObjectURL = (u) => { win.__revoked.add(u); };
      win.NEXO_makeVideoPreview = () => { const b = new win.Blob([new Uint8Array(PREV_KB * 1024).fill(7)], { type: 'video/webm' }); b.thumb = 'T'.repeat(3000); return Promise.resolve(b); };
      // El compresor de fotos no puede decodificar en jsdom: «error» → manda la foto tal cual (su camino de siempre)
      const RealImage = win.Image;
      win.Image = function () {
        const im = new RealImage();
        Object.defineProperty(im, 'src', { configurable: true, get() { return this.getAttribute('src') || ''; }, set(v) { this.setAttribute('src', v); setTimeout(() => { if (typeof this.onerror === 'function') this.onerror(new win.Event('error')); }, 5); } });
        return im;
      };
    },
  });
  const win = dom.window;
  for (let i = 0; i < 100 && !(win.NEXO && win.NEXO.initialized); i++) await sleep(100);
  await sleep(800);
  return { name, native, win };
}
const click = (win, el) => el && el.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
async function waitFor(fn, ms) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return true; await sleep(150); } return !!(await fn()); }
async function addFound(p, name) {
  let add = null;
  const find = () => { const row = Array.from(p.win.document.querySelectorAll('#ble-new-device > div')).find((d) => (d.querySelector('span') || {}).textContent === name); return row && row.querySelector('button'); };
  for (let i = 0; i < 400 && !add; i++) { await sleep(100); add = find(); if (!add && !p.win.bleInterface.isScanning) click(p.win, p.win.document.getElementById('ble-scan-btn')); }
  click(p.win, add); await sleep(2000);
  return !!add;
}
async function openChatWith(p, name) {
  const row = Array.from(p.win.document.querySelectorAll('#main-contacts-list .ble-contact-row')).find((r) => (r.querySelector('.ble-contact-name') || {}).textContent === name);
  click(p.win, row); await sleep(600); return !!row;
}
async function closeChat(p) { p.win.dispatchEvent(new p.win.CustomEvent('nexo:ble:closeChat', { detail: {} })); await sleep(300); }
function sendText(p, t) { const i = p.win.document.getElementById('message-input'); i.value = t; i.dispatchEvent(new p.win.Event('input', { bubbles: true })); click(p.win, p.win.document.getElementById('send-btn')); }
const idOf = (p) => p.win.bleInterface.localNexoId.toLowerCase();
// X agrega a Y (los demás de la misma radio fuera de alcance mientras tanto) y se saludan hasta tener la clave del otro
async function pair(radio, phones, x, y) {
  const others = phones.filter((p) => p !== x && p !== y);
  others.forEach((o) => radio.block(x.native, o.native));
  x.win.bleInterface.togglePanel(); const ok = await addFound(x, y.name); x.win.bleInterface.togglePanel();
  await sleep(800);
  await openChatWith(x, y.name); sendText(x, 'hola ' + y.name); await sleep(2500);
  const keyOf = (a, b) => !!(a.win.vaultLoadContacts().find((c) => c.name === b.name) || {}).publicKey;
  for (let i = 0; i < 40 && !keyOf(x, y); i++) await sleep(500);
  await openChatWith(y, x.name); sendText(y, 'hola ' + x.name); await sleep(2000);
  for (let i = 0; i < 40 && !keyOf(y, x); i++) await sleep(500);
  await closeChat(x); await closeChat(y);
  others.forEach((o) => radio.unblock(x.native, o.native));
  return ok;
}
function stop(ps) { ps.forEach((p) => { try { p.win.close(); } catch (e) {} try { p.native.destroyActivity(); } catch (e) {} }); }
const msgs = (p, chat) => p.win.vaultLoadMessages(chat);
const byId = async (p, chat, mid) => (await msgs(p, chat)).find((m) => (m.msgId || m.messageId) === mid) || null;
const lastOwnVideo = async (p, chat) => (await msgs(p, chat)).filter((m) => m._own && m.attachmentType === 'video').pop() || null;
const bubbleOf = (p, mid) => p.win.document.querySelector('#messages-container .message[data-msg-id="' + mid + '"]');
const isOnce = (m) => !!(m && m.attachmentMeta && m.attachmentMeta.once);
const vid = (win, kb, fill) => new win.Blob([new Uint8Array(kb * 1024).fill(fill || 3)], { type: 'video/mp4' });
// Burbuja «una vez» del que recibe: el texto, sin miniatura, sin reproductor, sin fuente para el visor
const onceBubbleOk = (b) => !!b && /Toca para ver/.test(b.textContent) && /una vez/.test(b.textContent) && !b.querySelector('img,video,.video-attachment,[data-fullscreen-type]');
// Toques simulados sobre el visor (en el propio fondo: un gesto que empieza sobre el reproductor es de su barra)
function swipe(win, el, dx, dy) {
  if (!el) return;
  const mk = (type, x, y, list) => { const e = new win.Event(type, { bubbles: true, cancelable: true }); Object.defineProperty(e, 'touches', { value: list ? [{ clientX: x, clientY: y }] : [] }); return e; };
  const x0 = 500, y0 = 400;
  el.dispatchEvent(mk('touchstart', x0, y0, true));
  for (let k = 1; k <= 4; k++) el.dispatchEvent(mk('touchmove', x0 + dx * k / 4, y0 + dy * k / 4, true));
  el.dispatchEvent(mk('touchend', 0, 0, false));
}
const overlay = (p) => p.win.document.getElementById('fullscreen-media-overlay');
// Abre una burbuja «una vez» de vídeo y devuelve lo que se ve: { abre, src, KB, autoplay, sin_guardar, sin_descarga, sin_contador }
async function openOnceVideo(p, b) {
  click(p.win, b && b.querySelector('.msg-once-tap'));
  await waitFor(() => !!(overlay(p) && overlay(p).querySelector('video')), 6000);
  const ov = overlay(p), v = ov && ov.querySelector('video');
  if (!v) return { abre: false };
  const src = v.getAttribute('src'), bl = p.win.__blobs.get(src);
  return { abre: true, src, KB: bl ? Math.round(bl.size / 1024) : null, autoplay: v.autoplay === true, sin_guardar: !ov.querySelector('.fs-save-btn'),
    sin_descarga: /nodownload/.test(v.getAttribute('controlsList') || ''), sin_contador: !ov.querySelector('.fs-counter') };
}
// Consumido en el teléfono: marcado, sin vídeo (ni en el mensaje ni en su archivo), sin texto, sin miniatura
async function consumed(p, chat, mid, ref) {
  const m = await byId(p, chat, mid);
  return !!m && m.onceSeen === true && !m.attachmentPayload && !m.attachmentRef && !m.content && !(m.attachmentMeta && m.attachmentMeta.thumb) && !(ref && p.native.files.get(ref));
}

(async () => {
  const r = { build: path.basename(buildDir) };
  const finish = (ok) => {
    r.errores = logs.filter((l) => /TypeError|ReferenceError|undefined is not|No se pudo descifrar/.test(l)).slice(0, 4);
    if (r.errores.length) ok = false;
    r.resultado = ok ? 'OK' : 'FALLO';
    console.log('VIDEOUNAVEZ ' + JSON.stringify(r));
    fs.writeFileSync(path.join(__dirname, 'last_logs_videounavez.txt'), logs.join('\n'));
    process.exit(ok ? 0 : 1);
  };
  const ok = {};

  // ===================== Fase 1: A y B por Bluetooth =====================
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', BASE), nB = new NativePhone('B', 'BB:BB:BB:BB:BB:02', BASE);
  radio.add(nA); radio.add(nB); nA.load(); nB.load();
  const [A, B] = await Promise.all([boot('A', nA), boot('B', nB)]);
  if (!(await pair(radio, [A, B], A, B))) { r.error = 'no empareja'; finish(false); }
  const idA = idOf(A), idB = idOf(B);
  await openChatWith(A, 'B');

  // (a) CÁMARA. a1: B lo abre ENSEGUIDA (antes de que llegue el HD) → el HD que llega después se tira
  const camSend = async (kb, fill) => {
    const before = (await lastOwnVideo(A, idB) || {}).msgId;
    if (typeof A.win.NEXO_cameraReview !== 'function') {
      // ≤ 3162 no hay gancho para la revisión: su «Enviar» de un vídeo era _sendVideo(blob, { format, duration }) SIN «una vez»
      // (el 👁 se escondía con un vídeo y _sendReview forzaba once = false): se hace lo mismo
      A.win.NEXO_sendVideo(vid(A.win, kb, fill), { format: 'webm', duration: 3 });
      let m0 = null;
      await waitFor(async () => { m0 = await lastOwnVideo(A, idB); return !!m0 && m0.msgId !== before; }, 15000);
      return { ojo_visible: false, ojo_activo: false, msg: m0 && m0.msgId !== before ? m0 : null };
    }
    A.win.NEXO_cameraReview({ type: 'video', blob: vid(A.win, kb, fill), mime: 'video/webm', duration: 3 });
    await sleep(200);
    const btn = A.win.document.getElementById('cam-review-once');
    const shown = !!btn && btn.style.display !== 'none' && !A.win.document.getElementById('cam-review').classList.contains('hidden');
    click(A.win, btn);
    const active = !!btn && btn.classList.contains('active');
    click(A.win, A.win.document.getElementById('cam-review-send'));
    let m = null;
    await waitFor(async () => { m = await lastOwnVideo(A, idB); return !!m && m.msgId !== before; }, 15000);
    return { ojo_visible: shown, ojo_activo: active, msg: m && m.msgId !== before ? m : null };
  };
  const c1 = await camSend(300, 3);   // HD grande: tarda en llegar, B abre la previa antes
  r.a_ojo_en_revision_video = c1.ojo_visible && c1.ojo_activo;
  const mid1 = c1.msg && c1.msg.msgId;
  r.a_A_marca = isOnce(c1.msg) && !(c1.msg.attachmentMeta && c1.msg.attachmentMeta.thumb);
  const aB = bubbleOf(A, mid1);
  r.a_A_burbuja = !!aB && /Vídeo de una vez/.test(aB.textContent) && !aB.querySelector('img,video,.video-attachment');
  r.a_llega_B = await waitFor(async () => !!(await byId(B, idA, mid1)), 40000);
  const bm1 = await byId(B, idA, mid1);
  r.a_B_marca = isOnce(bm1) && !(bm1.attachmentMeta && bm1.attachmentMeta.thumb);
  await openChatWith(B, 'A'); await sleep(500);
  r.a_B_burbuja = onceBubbleOk(bubbleOf(B, mid1));
  const ref1 = bm1 && bm1.attachmentRef;
  const v1 = await openOnceVideo(B, bubbleOf(B, mid1));
  r.a_visor = v1;
  r.a_reproduce_previa = v1.abre && v1.autoplay && v1.KB === PREV_KB && v1.sin_guardar && v1.sin_descarga && v1.sin_contador;
  r.a_consumido_al_abrir = await waitFor(() => consumed(B, idA, mid1, ref1), 8000);
  click(B.win, overlay(B)); await sleep(400);   // tocar fuera del vídeo = cerrar
  r.a_cierra_y_libera = !overlay(B) && !!v1.src && B.win.__revoked.has(v1.src);
  r.a_burbuja_abierto = !!bubbleOf(B, mid1) && /Abierto/.test(bubbleOf(B, mid1).textContent) && !bubbleOf(B, mid1).querySelector('img,video');
  click(B.win, bubbleOf(B, mid1) && bubbleOf(B, mid1).querySelector('div')); await sleep(800);
  r.a_no_se_reabre = !overlay(B);
  // El HD de ese vídeo llega DESPUÉS (A lo manda al confirmarse la previa): no debe revivirlo
  r.a_HD_salio = await waitFor(async () => ((await byId(A, idB, mid1)) || {}).hdStatus === 'sent', 120000);
  await sleep(1500);
  r.a_HD_no_revive = await consumed(B, idA, mid1, 'nexo_att_' + mid1 + '.b64') && (await msgs(B, idA)).filter((m) => m.attachmentType === 'video' && !isOnce(m)).length === 0;
  ok.a1 = r.a_ojo_en_revision_video && r.a_A_marca && r.a_A_burbuja && r.a_llega_B && r.a_B_marca && r.a_B_burbuja && r.a_reproduce_previa && r.a_consumido_al_abrir &&
    r.a_cierra_y_libera && r.a_burbuja_abierto && r.a_no_se_reabre && r.a_HD_salio && r.a_HD_no_revive;

  // a2: B espera a que llegue el HD (sustituye a la previa SIN perder la marca) y entonces lo abre: se reproduce el HD
  const c2 = await camSend(120, 5);
  const mid2 = c2.msg && c2.msg.msgId;
  r.a2_HD_llega_con_marca = await waitFor(async () => { const m = await byId(B, idA, mid2); return !!m && !!m.attachmentMeta && m.attachmentMeta.hd === true && isOnce(m); }, 60000);
  const bm2 = await byId(B, idA, mid2);
  await sleep(500);
  r.a2_B_burbuja = onceBubbleOk(bubbleOf(B, mid2));
  const v2 = await openOnceVideo(B, bubbleOf(B, mid2));
  r.a2_reproduce_HD = v2.abre && v2.KB === 120 && v2.sin_guardar;
  r.a2_consumido = await waitFor(() => consumed(B, idA, mid2, bm2 && bm2.attachmentRef), 8000);
  swipe(B.win, overlay(B), 0, -320); await sleep(600);   // deslizar hacia arriba cierra
  r.a2_cierra_deslizando = !overlay(B) && B.win.__revoked.has(v2.src);
  await closeChat(B); await openChatWith(B, 'A'); await sleep(600);
  r.a2_reabrir_chat_sigue_abierto = [mid1, mid2].every((id) => { const b = bubbleOf(B, id); return !!b && /Abierto/.test(b.textContent) && !b.querySelector('img,video,.msg-once-tap'); });
  ok.a2 = r.a2_HD_llega_con_marca && r.a2_B_burbuja && r.a2_reproduce_HD && r.a2_consumido && r.a2_cierra_deslizando && r.a2_reabrir_chat_sigue_abierto;

  // (e) VISOR: vídeo normal, vídeo «una vez» y foto normal seguidos
  const nNormal = async () => (await msgs(B, idA)).length;
  const n0 = await nNormal();
  A.win.NEXO_sendVideo(vid(A.win, 40, 8), { name: 'normal.mp4', mime: 'video/mp4', duration: 2 });
  await waitFor(async () => (await nNormal()) >= n0 + 1, 40000);
  A.win.NEXO_sendVideo(vid(A.win, 40, 9), { name: 'unavez.mp4', mime: 'video/mp4', duration: 2, once: true });
  await waitFor(async () => (await nNormal()) >= n0 + 2, 40000);
  A.win.NEXO_sendAttachment('image', Buffer.alloc(3000, 4).toString('base64'), { format: 'jpeg', width: 120, height: 90 });
  await waitFor(async () => (await nNormal()) >= n0 + 3, 40000);
  await sleep(1500);
  const recv = (await msgs(B, idA)).slice(n0);
  const mV = recv.find((m) => m.attachmentType === 'video' && !isOnce(m)), mO = recv.find((m) => m.attachmentType === 'video' && isOnce(m)), mP = recv.find((m) => m.attachmentType === 'image');
  r.e_llegan = [!!mV, !!mO, !!mP];
  if (mV && mO && mP) {
    const bV = bubbleOf(B, mV.msgId), bO = bubbleOf(B, mO.msgId);
    click(B.win, bV && bV.querySelector('.video-attachment'));
    await waitFor(() => !!overlay(B), 5000);
    const items = B.win.document.querySelectorAll('#messages-container [data-fullscreen-type]').length;
    const cnt = overlay(B) && overlay(B).querySelector('.fs-counter');
    r.e_contador = cnt ? cnt.textContent : null;
    r.e_contador_sin_la_una_vez = !!cnt && cnt.textContent.split('/')[1].trim() === String(items) && !(bO && bO.querySelector('[data-fullscreen-type]'));
    swipe(B.win, overlay(B), -320, 0); await sleep(900);   // ← la siguiente: debe ser la FOTO, no el vídeo «una vez»
    const shownImg = overlay(B) && Array.from(overlay(B).querySelectorAll('.fs-slide img')).find((i) => !i.classList.contains('fs-preview'));
    r.e_siguiente_es_la_foto = !!shownImg && /^data:image\//.test(shownImg.getAttribute('src') || '') && !overlay(B).querySelector('.fs-slide video');
    swipe(B.win, overlay(B), 0, -320); await sleep(600);
    r.e_una_vez_no_se_gasta = !overlay(B) && !((await byId(B, idA, mO.msgId)) || {}).onceSeen && onceBubbleOk(bubbleOf(B, mO.msgId));
    // El suyo: no se desliza de lado (sigue el mismo vídeo) y ↑ lo cierra
    const vO = await openOnceVideo(B, bubbleOf(B, mO.msgId));
    swipe(B.win, overlay(B), -320, 0); await sleep(900);
    const still = overlay(B) && overlay(B).querySelector('.fs-slide video');
    r.e_una_vez_no_desliza = vO.abre && !!still && still.getAttribute('src') === vO.src && !overlay(B).querySelector('.fs-slide img');
    swipe(B.win, overlay(B), 0, -320); await sleep(600);
    r.e_una_vez_cierra_arriba = !overlay(B) && await consumed(B, idA, mO.msgId);
  }
  ok.e = r.e_llegan.every(Boolean) && r.e_contador_sin_la_una_vez && r.e_siguiente_es_la_foto && r.e_una_vez_no_se_gasta && r.e_una_vez_no_desliza && r.e_una_vez_cierra_arriba;

  // (b) GALERÍA: 1 foto + 1 vídeo, ojo solo en el vídeo
  const pick = async (p, files) => {
    click(p.win, p.win.document.querySelector('.attach-menu-item[data-type="gallery"]')); await sleep(400);
    const fin = Array.from(p.win.document.querySelectorAll('input[type=file]')).pop();
    Object.defineProperty(fin, 'files', { configurable: true, value: files.map((f) => new p.win.File([f.bytes], f.name, { type: f.type })) });
    fin.dispatchEvent(new p.win.Event('change'));
    await sleep(300);
  };
  const review = (p) => p.win.document.getElementById('nexo-gallery-review');
  const nb0 = (await msgs(B, idA)).length;
  await pick(A, [{ name: 'g1.jpg', type: 'image/jpeg', bytes: Buffer.alloc(2400, 1) }, { name: 'g2.mp4', type: 'video/mp4', bytes: Buffer.alloc(30 * 1024, 2) }]);
  const rv = review(A), cells = rv ? Array.from(rv.querySelectorAll('.nx-grev-item')) : [];
  r.b_revision = !!rv;
  r.b_ojo_en_el_video = cells.length === 2 && !!cells[1].querySelector('.nx-grev-eye') && !!cells[1].querySelector('.nx-grev-vid') && !!cells[0].querySelector('.nx-grev-eye');
  click(A.win, cells[1] && cells[1].querySelector('.nx-grev-eye'));
  click(A.win, rv && rv.querySelector('#nexo-grev-send'));
  if (!rv) { await sleep(3000); }
  await waitFor(async () => (await msgs(B, idA)).slice(nb0).filter((m) => m.attachmentType === 'image' || m.attachmentType === 'video').length >= 2, 60000);
  const gb = (await msgs(B, idA)).slice(nb0);
  const gP = gb.find((m) => m.attachmentType === 'image'), gV = gb.find((m) => m.attachmentType === 'video');
  r.b_B_recibe = [gP ? 'foto' + (isOnce(gP) ? '*' : '') : '-', gV ? 'video' + (isOnce(gV) ? '*' : '') : '-'];
  r.b_B_burbuja_video = !!gV && onceBubbleOk(bubbleOf(B, gV.msgId));
  ok.b = r.b_revision && r.b_ojo_en_el_video && JSON.stringify(r.b_B_recibe) === '["foto","video*"]' && r.b_B_burbuja_video;

  // (d) GRUPO A+B: un vídeo SOLO de la galería → también revisión con ojo; B lo abre antes de su HD: el HD no lo revive
  await closeChat(A); await closeChat(B);
  const gid = A.win.bleInterface.groups.create('Vídeos', [idB]).id;
  A.win.NEXO_openGroupChat(gid); await sleep(600);
  sendText(A, 'hola grupo');
  r.d_grupo_en_B = await waitFor(() => !!B.win.bleInterface.groups.get(gid), 30000);
  await pick(A, [{ name: 'gv.mp4', type: 'video/mp4', bytes: Buffer.alloc(90 * 1024, 6) }]);
  const rvg = review(A);
  r.d_revision_solo_video = !!rvg && rvg.querySelectorAll('.nx-grev-eye').length === 1;
  click(A.win, rvg && rvg.querySelector('.nx-grev-eye'));
  click(A.win, rvg && rvg.querySelector('#nexo-grev-send'));
  const gRecv = async () => (await msgs(B, gid)).filter((m) => !m._own && m.attachmentType === 'video');
  await waitFor(async () => (await gRecv()).length >= 1, 60000);
  const gm = (await gRecv())[0];
  r.d_B_marca = isOnce(gm);
  const gOwn = (await msgs(A, gid)).filter((m) => m._own && m.attachmentType === 'video').pop();
  r.d_A_burbuja = !!gOwn && !!bubbleOf(A, gOwn.msgId) && /Vídeo de una vez/.test(bubbleOf(A, gOwn.msgId).textContent);
  B.win.NEXO_openGroupChat(gid); await sleep(800);
  r.d_B_burbuja = !!gm && onceBubbleOk(bubbleOf(B, gm.msgId));
  const vg = gm ? await openOnceVideo(B, bubbleOf(B, gm.msgId)) : { abre: false };
  r.d_abre = vg.abre && vg.sin_guardar;
  click(B.win, overlay(B)); await sleep(400);
  r.d_consumido = !!gm && await waitFor(() => consumed(B, gid, gm.msgId), 8000);
  const st = () => (A.win.bleInterface.groups.st[gOwn && gOwn.msgId] || {}).hd;
  r.d_HD_al_miembro = await waitFor(() => !!(st() && st().n[idB] === 'sent'), 60000);
  await sleep(1500);
  r.d_HD_no_revive = !!gm && await consumed(B, gid, gm.msgId, 'nexo_att_' + gm.msgId + '.b64') && (await gRecv()).length === 1;
  ok.d = r.d_grupo_en_B && r.d_revision_solo_video && r.d_B_marca && r.d_A_burbuja && r.d_B_burbuja && r.d_abre && r.d_consumido && r.d_HD_al_miembro && r.d_HD_no_revive;
  stop([A, B]);

  // ===================== Fase 2: archivo grande por Wi-Fi Direct (y si falla, previa + HD por Bluetooth) =====================
  {
    const radio2 = new Radio();
    const o2 = Object.assign({}, BASE, { wifiDirect: true, ioDelay: 0 });
    const nC = new NativePhone('C', 'CC:CC:CC:CC:CC:03', o2), nD = new NativePhone('D', 'DD:DD:DD:DD:DD:04', o2);
    radio2.add(nC); radio2.add(nD); nC.load(); nD.load();
    const [C, D] = await Promise.all([boot('C', nC), boot('D', nD)]);
    const pc = await pair(radio2, [C, D], C, D);
    const idC = idOf(C), idD = idOf(D);
    r.c_wd_listo = pc && await waitFor(() => C.win.bleInterface.wifiDirect && C.win.bleInterface.wifiDirect.canReach(idD), 30000);
    await openChatWith(C, 'D');
    const big = vid(C.win, 2600, 11);   // 2,6 MB: no cabe como adjunto por Bluetooth (tope ~2,2 MB)
    const l0 = logs.length;
    C.win.NEXO_sendVideo(big, { name: 'grande.mp4', mime: 'video/mp4', duration: 20, once: true });
    let mc = null;
    await waitFor(async () => { mc = (await msgs(D, idC)).find((m) => m.attachmentType === 'video'); return !!mc; }, 90000);
    r.c_por_wifi_direct = logs.slice(l0).some((l) => /\[C\].*Original por Wi-Fi Direct/.test(l)) && logs.slice(l0).some((l) => /\[D\].*\[WIFI-DIRECT\] Recibido/.test(l));
    r.c_wd_marca = isOnce(mc);
    await openChatWith(D, 'C'); await sleep(500);
    const vc = mc ? await openOnceVideo(D, bubbleOf(D, mc.msgId)) : { abre: false };
    r.c_wd_reproduce_original = vc.abre && vc.KB === 2600 && vc.sin_guardar;
    click(D.win, overlay(D)); await sleep(400);
    r.c_wd_consumido = !!mc && await waitFor(() => consumed(D, idC, mc.msgId), 8000);
    // Wi-Fi Direct falla → el mismo mensaje sigue como previa + HD por Bluetooth, con la marca
    nD.opts.wdFail = true;
    const l1 = logs.length;
    C.win.NEXO_sendVideo(vid(C.win, 150, 12), { name: 'falla.mp4', mime: 'video/mp4', duration: 3, once: true });
    let mf = null;
    await waitFor(async () => { mf = (await msgs(D, idC)).filter((m) => m.attachmentType === 'video').find((m) => !mc || m.msgId !== mc.msgId); return !!mf && !!mf.attachmentMeta && mf.attachmentMeta.hd === true; }, 120000);
    r.c_wd_falla_va_por_bluetooth = logs.slice(l1).some((l) => /\[C\].*Wi-Fi Direct no funcionó: previa \+ HD por Bluetooth/.test(l));
    r.c_bt_marca_con_HD = isOnce(mf) && !!mf.attachmentMeta.hd;
    await sleep(500);
    r.c_bt_burbuja = !!mf && onceBubbleOk(bubbleOf(D, mf.msgId));
    ok.c1 = r.c_wd_listo && r.c_por_wifi_direct && r.c_wd_marca && r.c_wd_reproduce_original && r.c_wd_consumido && r.c_wd_falla_va_por_bluetooth && r.c_bt_marca_con_HD && r.c_bt_burbuja;
    stop([C, D]);
  }

  // ===================== Fase 3: buzón de archivos (el otro, ausente) =====================
  {
    const { NostrRelay } = require('./nostr_relay');
    const rl1 = new NostrRelay(), rl2 = new NostrRelay();
    RELAYS = [await rl1.start(), await rl2.start()];
    const radio3 = new Radio();
    const o3 = Object.assign({}, BASE, { retain: ['onPayloadReceived', 'onLanMessage', 'onLanUp', 'onLanDown'], noTor: true });
    const nE = new NativePhone('E', 'EE:EE:EE:EE:EE:05', Object.assign({}, o3, { wifi: 'casa' })), nF = new NativePhone('F', 'FA:FA:FA:FA:FA:06', Object.assign({}, o3, { wifi: 'oficina' }));
    radio3.add(nE); radio3.add(nF); nE.load(); nF.load();
    const E = await boot('E', nE), F = await boot('F', nF);
    await pair(radio3, [E, F], E, F);
    const idE = idOf(E), idF = idOf(F), netE = () => E.win.bleInterface.net;
    radio3.block(nE, nF);
    netE().tick(); F.win.bleInterface.net.tick();
    await waitFor(() => E.win.bleInterface.linkOf(idF) === 'internet', 40000);
    F.win.bleInterface.net._closeAll(); F.win.bleInterface.net.relays.forEach((x) => { x.retryAt = Date.now() + 9e6; });
    const pF = netE().peers.get(idF); if (pF) pF.lastRx = 0; await netE().tick();
    r.c_buzon_F_ausente = await waitFor(() => !netE().canReach(idF) && !E.win.bleInterface._bleReadyFor(idF), 20000);
    await openChatWith(E, 'F');
    const l2 = logs.length;
    E.win.NEXO_sendVideo(vid(E.win, 70, 13), { name: 'buzon.mp4', mime: 'video/mp4', duration: 4, once: true });
    let mid3 = null;
    await waitFor(async () => { const m = await lastOwnVideo(E, idF); mid3 = m && m.msgId; return !!mid3; }, 15000);
    r.c_buzon_puntero = await waitFor(() => logs.slice(l2).some((l) => /\[E\].*mando el puntero al buzón/.test(l) && l.indexOf(mid3) >= 0), 40000);
    F.win.bleInterface.net.relays.forEach((x) => { x.retryAt = 0; }); try { F.win.bleInterface.net.tick(); } catch (e) {}
    let mb = null;
    await waitFor(async () => { mb = await byId(F, idE, mid3); return !!mb; }, 90000);
    r.c_buzon_marca = isOnce(mb) && !(mb.attachmentMeta && mb.attachmentMeta.thumb);
    await openChatWith(F, 'E'); await sleep(500);
    r.c_buzon_burbuja = !!mb && onceBubbleOk(bubbleOf(F, mid3));
    const vb = mb ? await openOnceVideo(F, bubbleOf(F, mid3)) : { abre: false };
    click(F.win, overlay(F)); await sleep(400);
    r.c_buzon_consumido = vb.abre && await waitFor(async () => (await consumed(F, idE, mid3)) && !((await byId(F, idE, mid3)).attachmentMeta || {}).blobPtr, 8000);
    ok.c2 = r.c_buzon_F_ausente && r.c_buzon_puntero && r.c_buzon_marca && r.c_buzon_burbuja && r.c_buzon_consumido;
    stop([E, F]);
    RELAYS = null;
    await Promise.all([rl1, rl2].map((x) => x.stop && x.stop())).catch(() => {});
  }

  // ===================== Fase 4: por un PUENTE (Jump G–H–I: G e I fuera de alcance) =====================
  {
    const radio4 = new Radio();
    const nG = new NativePhone('G', 'A6:A6:A6:A6:A6:07', BASE), nH = new NativePhone('H', 'A7:A7:A7:A7:A7:08', BASE), nI = new NativePhone('I', 'A8:A8:A8:A8:A8:09', BASE);
    [nG, nH, nI].forEach((n) => { radio4.add(n); n.load(); });
    const [G, H, I] = await Promise.all([boot('G', nG), boot('H', nH), boot('I', nI)]);
    const P = [G, H, I];
    const pj = (await pair(radio4, P, G, H)) && (await pair(radio4, P, H, I)) && (await pair(radio4, P, G, I));
    radio4.block(nG, nI);
    const idG = idOf(G), idI = idOf(I);
    r.f_ruta = pj && await waitFor(() => !!G.win.bleInterface.relay.relayHop(idI), 60000);
    await openChatWith(G, 'I');
    const l3 = logs.length;
    G.win.NEXO_sendVideo(vid(G.win, 50, 14), { name: 'puente.mp4', mime: 'video/mp4', duration: 3, once: true });
    let mj = null;
    await waitFor(async () => { mj = (await msgs(I, idG)).find((m) => m.attachmentType === 'video'); return !!mj; }, 90000);
    r.f_por_el_puente = logs.slice(l3).some((l) => /\[H\].*\[JUMP\] Puente: /.test(l));
    r.f_marca = isOnce(mj);
    await openChatWith(I, 'G'); await sleep(500);
    r.f_burbuja = !!mj && onceBubbleOk(bubbleOf(I, mj.msgId));
    ok.f = r.f_ruta && r.f_por_el_puente && r.f_marca && r.f_burbuja;
    stop(P);
  }

  r.partes = ok;
  finish(Object.keys(ok).length === 8 && Object.values(ok).every(Boolean));
})().catch((e) => { console.error('FALLO:', e.stack); console.log('VIDEOUNAVEZ ' + JSON.stringify({ resultado: 'FALLO', error: String(e && e.message) })); fs.writeFileSync(path.join(__dirname, 'last_logs_videounavez.txt'), logs.join('\n')); process.exit(1); });
