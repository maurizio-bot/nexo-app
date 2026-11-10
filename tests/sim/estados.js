// Ronda 2799 (Stream fase 1, pedido del dueño «empezamos con cercanos»): ESTADOS tipo WhatsApp — texto, 24 h, cifrado
// entre contactos. A publica un estado → llega a B y se guarda; en B sale en la tira "Estados" y al tocarlo se ve el
// texto; B publica el suyo por la interfaz y le llega a A; un estado de hace 25 h está caducado; al quitarlo desaparece.
// Uso: node estados.js <dir_build>
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone, installWebCrypto } = require('./native_mock');

const buildDir = path.resolve(process.argv[2]);
const opts = { readsContentFallback: true, retain: ['onPayloadReceived'], closeOnNoService: true, pace: [15, 15], ioDelay: 25, asymmetric: true };
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
const chips = (p) => Array.from(p.win.document.querySelectorAll('#main-estados-strip .estado-chip'));

(async () => {
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', opts), nB = new NativePhone('B', 'BB:BB:BB:BB:BB:02', opts);
  [nA, nB].forEach((n) => { radio.add(n); n.load(); });
  const [A, B] = await Promise.all([boot('A', nA), boot('B', nB)]);
  const idA = A.win.bleInterface.localNexoId.toLowerCase(), idB = B.win.bleInterface.localNexoId.toLowerCase();
  const r = { build: path.basename(buildDir) };
  // Emparejar
  A.win.bleInterface.togglePanel(); if (!(await addFound(A))) { console.log('ESTADOS ' + JSON.stringify({ resultado: 'FAIL', error: 'no empareja' })); process.exit(0); } A.win.bleInterface.togglePanel();
  await openChatWith(A, 'B'); sendText(A, 'hola'); await sleep(2500); await closeChat(A);
  r.emparejados = await wait(async () => (await B.win.vaultLoadMessages(idA)).some((m) => m.content === 'hola'), 30);

  // 1. A publica un estado → llega a B (núcleo: broadcast + recibir + guardar)
  A.win.NEXO_setMyStatus('hola mundo 24h');
  r.llega_a_B = await wait(() => { const s = B.win.NEXO_statusOf(idA); return s && s.t === 'hola mundo 24h'; }, 30);
  r.B_no_mensaje_visible = !(await B.win.vaultLoadMessages(idA)).some((m) => /nexo_act|hola mundo 24h/.test(m.content || ''));

  // 2. En B, la tira "Estados" muestra a A; al tocarlo se ve el texto
  await sleep(400);
  const chipA = chips(B).find((c) => /A/.test(c.textContent) && !/Mi estado|Tu estado/.test(c.textContent));
  r.tira_muestra_a_A = !!chipA;
  if (chipA) { click(B.win, chipA); await sleep(300); }
  r.ver_muestra_texto = /hola mundo 24h/.test((B.win.document.getElementById('estado-view') || {}).textContent || '');
  // 2999 (dueño 10-11): en el estado NO está el botón flotante de agregar contacto; tocar el NOMBRE abre el chat con el dueño del estado
  { const fab = B.win.document.getElementById('ble-fab-btn');
    r.fab_existe = !!fab;
    r.fab_oculto_en_estado = !!fab && fab.style.display === 'none';
    const who = B.win.document.getElementById('estado-who');
    r.nombre_tocable = !!who && /›/.test(who.textContent);
    if (who) { click(B.win, who); await sleep(1500); }
    r.nombre_cierra_el_estado = !B.win.document.getElementById('estado-overlay');
    r.nombre_abre_chat = String((B.win.NEXO.app.activeContact && B.win.NEXO.app.activeContact.nexoId) || '').toLowerCase() === idA;
    r.fab_vuelve = !!fab && fab.style.display !== 'none';
    await closeChat(B); }
  { const o = B.win.document.getElementById('estado-overlay'); if (o) o.remove(); }

  // 2b. Fase 2 (foto en el estado, #dueño): A publica un estado CON foto → le llega a B con la imagen; la tira y el
  //     visor muestran la foto.
  const FOTO = 'data:image/jpeg;base64,' + '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQ'.repeat(3);
  A.win.NEXO_setMyStatus('mirá esto', FOTO);
  r.foto_llega_a_B = await wait(() => { const s = B.win.NEXO_statusOf(idA); return !!(s && s.img === FOTO && s.t === 'mirá esto'); }, 30);
  await sleep(400);
  const chipFoto = chips(B).find((c) => c.querySelector('img') && !/Mi estado|Tu estado/.test(c.textContent));
  r.tira_muestra_foto = !!chipFoto;
  if (chipFoto) { click(B.win, chipFoto); await sleep(300); }
  r.ver_muestra_foto = !!(B.win.document.querySelector('#estado-view img'));

  // 2c. Fase 2 («me gusta», #dueño): B le da me gusta al estado de A → a A le llega (myLikes pasa a 1); el botón existe.
  const likeBtn = B.win.document.getElementById('estado-like');
  r.boton_like = !!likeBtn;
  if (likeBtn) click(B.win, likeBtn);
  r.like_llega_a_A = await wait(() => A.win.NEXO_myLikes() === 1, 30);
  { const o = B.win.document.getElementById('estado-overlay'); if (o) o.remove(); }

  // 2d. Robustez: una "imagen" que NO es imagen (o gigante) se descarta al recibir y no pisa el estado bueno.
  B.win.NEXO_applyStatus(idA, { t: 'x', img: 'data:text/plain;base64,QQ==', ts: Date.now() });
  r.rechaza_img_mala = (B.win.NEXO_statusOf(idA) || {}).img === '';

  // 2e. Fase 2 (audio en el estado, #dueño): A publica un estado con AUDIO → le llega a B con el audio; el visor
  //     muestra el reproductor. Un "audio" que no es audio se descarta.
  const AUDIO = 'data:audio/webm;base64,' + 'GkXfowEAAAAAAAAfQoaBAUL3gQFC8oEEQvOBCEKChHdlYm1Ch4ECQ'.repeat(2);
  A.win.NEXO_setMyStatus('', '', '', AUDIO, 'audio/webm');
  r.audio_llega_a_B = await wait(() => { const s = B.win.NEXO_statusOf(idA); return !!(s && s.aud === AUDIO); }, 30);
  await sleep(400);
  const chipAud = chips(B).find((c) => !/Mi estado|Tu estado/.test(c.textContent));
  if (chipAud) { click(B.win, chipAud); await sleep(300); }
  r.ver_muestra_audio = !!(B.win.document.querySelector('#estado-view #estado-audio'));
  { const o = B.win.document.getElementById('estado-overlay'); if (o) o.remove(); }
  B.win.NEXO_applyStatus(idA, { t: 'y', aud: 'data:text/plain;base64,QQ==', ts: Date.now() });
  r.rechaza_aud_malo = (B.win.NEXO_statusOf(idA) || {}).aud === '';

  // 2f. Fase 2 (video en el estado, #dueño): A publica un estado con VIDEO → le llega a B con el video; el visor
  //     muestra el reproductor <video>. Un "video" que no es video se descarta.
  const VIDEO = 'data:video/webm;base64,' + 'GkXfo0AgQoaBAULygQFC8oEEQvOBCEKCQAEAAAAAAAFc'.repeat(3);
  A.win.NEXO_setMyStatus('', '', '', '', '', VIDEO, 'video/webm');
  r.video_llega_a_B = await wait(() => { const s = B.win.NEXO_statusOf(idA); return !!(s && s.vid === VIDEO); }, 30);
  await sleep(400);
  const chipVid = chips(B).find((c) => !/Mi estado|Tu estado/.test(c.textContent));
  if (chipVid) { click(B.win, chipVid); await sleep(300); }
  r.ver_muestra_video = !!(B.win.document.querySelector('#estado-view #estado-video'));
  { const o = B.win.document.getElementById('estado-overlay'); if (o) o.remove(); }
  B.win.NEXO_applyStatus(idA, { t: 'z', vid: 'data:text/plain;base64,QQ==', ts: Date.now() });
  r.rechaza_vid_malo = (B.win.NEXO_statusOf(idA) || {}).vid === '';

  // 3. B publica el suyo por la INTERFAZ (chip "Mi estado" → input → Publicar) → le llega a A
  const miChip = chips(B).find((c) => /Mi estado|Tu estado/.test(c.textContent)) || chips(B)[0];
  click(B.win, miChip); await sleep(300);
  const ta = B.win.document.getElementById('estado-input');
  r.compose_abre = !!ta;
  if (ta) { ta.value = 'estado de B'; ta.dispatchEvent(new B.win.Event('input', { bubbles: true })); click(B.win, B.win.document.getElementById('estado-publicar')); await sleep(300); }
  r.B_a_A_por_ui = await wait(() => { const s = A.win.NEXO_statusOf(idB); return s && s.t === 'estado de B'; }, 30);

  // 4. Caducidad: un estado de hace 25 h no se muestra; uno fresco sí
  B.win.NEXO_applyStatus(idA, { t: 'viejo', ts: Date.now() - 25 * 3600 * 1000 });
  r.caducado_no_se_ve = B.win.NEXO_statusOf(idA) === null;
  B.win.NEXO_applyStatus(idA, { t: 'fresco', ts: Date.now() });
  r.fresco_se_ve = (B.win.NEXO_statusOf(idA) || {}).t === 'fresco';

  // 4b. Robustez (auditoría 2800): un ts en el FUTURO (reloj malo/malicioso del otro) se acota a «ahora»,
  // así no puede burlar la caducidad de 24 h quedándose para siempre.
  B.win.NEXO_applyStatus(idA, { t: 'futuro', ts: Date.now() + 100 * 24 * 3600 * 1000 });
  var sFut = B.win.NEXO_statusOf(idA);
  r.futuro_acotado = !!(sFut && sFut.t === 'futuro' && typeof sFut.ts === 'number' && sFut.ts <= Date.now() + 2000);

  // 5. A quita su estado → B deja de verlo
  A.win.NEXO_setMyStatus('');
  r.quitar_borra_en_B = await wait(() => B.win.NEXO_statusOf(idA) === null, 30);

  r.errores = logs.filter((l) => /TypeError|undefined is not|No se pudo descifrar/.test(l)).slice(0, 4);
  const ok = r.emparejados && r.llega_a_B && r.B_no_mensaje_visible && r.tira_muestra_a_A && r.ver_muestra_texto &&
    r.fab_existe && r.fab_oculto_en_estado && r.nombre_tocable && r.nombre_cierra_el_estado && r.nombre_abre_chat && r.fab_vuelve &&
    r.foto_llega_a_B && r.tira_muestra_foto && r.ver_muestra_foto && r.boton_like && r.like_llega_a_A && r.rechaza_img_mala &&
    r.audio_llega_a_B && r.ver_muestra_audio && r.rechaza_aud_malo &&
    r.video_llega_a_B && r.ver_muestra_video && r.rechaza_vid_malo &&
    r.compose_abre && r.B_a_A_por_ui && r.caducado_no_se_ve && r.fresco_se_ve && r.futuro_acotado && r.quitar_borra_en_B && r.errores.length === 0;
  r.resultado = ok ? 'OK' : 'FAIL';
  console.log('ESTADOS ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_estados.txt'), logs.join('\n'));
  process.exit(0);
})().catch((e) => { console.error('FALLO:', e.stack); fs.writeFileSync(path.join(__dirname, 'last_logs_estados.txt'), logs.join('\n')); process.exit(1); });
