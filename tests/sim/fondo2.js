// Fondo POR chat concreto + compartir E2E (ronda 2890, pedido del dueño: «opción A» para elegirlo desde la cabecera
// del chat, y «compartido, con opción a compartir»). Dos teléfonos reales en jsdom:
//   (1) el fondo por chat MANDA sobre el global de chats SOLO en ese chat; quitarlo cae al global
//   (2) COMPARTIR: A comparte el fondo de su chat con B (acción oculta cifrada E2E, como la foto de perfil) y a B le
//       llega y lo aplica a SU chat con A — con AVISO visible (toast) pero SIN mensaje de chat (diag. 04-11: antes
//       era mudo y el dueño creía que «no funcionaba»)
//   (3) se guarda cifrado por contacto (nexo_wp_c_<id>.json) en los dos teléfonos
//   (4) al recibir, se rechaza lo que no es una imagen (no pisa el fondo bueno)
// Uso: node fondo2.js <dir_build>
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

(async () => {
  const GLOBAL = 'data:image/png;base64,GLOBALxx=';   // fondo global de chats
  const PER = 'data:image/jpeg;base64,PERCHATyy==';     // fondo del chat con B

  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', opts), nB = new NativePhone('B', 'BB:BB:BB:BB:BB:02', opts);
  [nA, nB].forEach((n) => { radio.add(n); n.load(); });
  const [A, B] = await Promise.all([boot('A', nA), boot('B', nB)]);
  const idA = A.win.bleInterface.localNexoId.toLowerCase(), idB = B.win.bleInterface.localNexoId.toLowerCase();
  const r = { build: path.basename(buildDir) };

  // Emparejar y fijar la sesión E2E con un texto
  A.win.bleInterface.togglePanel(); if (!(await addFound(A))) { console.log('FONDO2 ' + JSON.stringify({ resultado: 'FALLO', error: 'no empareja' })); process.exit(1); } A.win.bleInterface.togglePanel();
  await openChatWith(A, 'B'); sendText(A, 'hola'); await sleep(2500);
  r.emparejados = await wait(async () => (await B.win.vaultLoadMessages(idA)).some((m) => m.content === 'hola'), 30);

  // (1) Precedencia: con el chat de B abierto en A, el fondo POR chat manda sobre el global; quitarlo cae al global
  A.win.setChatWallpaper(GLOBAL); await sleep(50);           // global de chats
  r.per_set = A.win.setChatWallpaperFor(idB, PER) === true && A.win.chatWallpaperFor(idB) === PER;
  r.per_manda = A.win.wallpaperApplied() === PER;             // el chat con B abierto muestra el suyo
  A.win.clearChatWallpaperFor(idB);
  r.cae_a_global = A.win.wallpaperApplied() === GLOBAL;        // sin el suyo, vuelve el global de chats
  r.global_intacto = A.win.hasChatWallpaper() === true;        // el global no se tocó

  // vuelve a poner el fondo del chat y comprueba que se guarda cifrado por contacto
  A.win.setChatWallpaperFor(idB, PER); await sleep(200);
  let savedA = null; try { savedA = JSON.parse(nA.files.get('nexo_wp_c_' + idB + '.json') || '{}'); } catch (e) {}
  r.A_guarda_por_chat = !!savedA && savedA.img === PER;

  // (2) COMPARTIR A -> B (acción oculta cifrada E2E): a B le llega y lo aplica a SU chat con A
  r.comparte = A.win.shareChatWallpaper(idB) === true;
  r.llega_a_B = await wait(() => B.win.chatWallpaperFor(idA) === PER, 30);
  r.B_no_mensaje_visible = !(await B.win.vaultLoadMessages(idA)).some((m) => /nexo_act|data:image/.test(m.content || ''));
  // #dueño 04-11: al recibir un fondo compartido AHORA hay aviso visible (toast). B no tenía abierto el chat con A, así
  // que el aviso le dice que lo abra para verlo (el fondo ya quedó guardado y se pinta al abrir).
  var tB = B.win.document.getElementById('perm-error-toast');
  r.B_avisa_al_recibir = !!tB && /fondo/i.test(tB.textContent || '') && /abr/i.test(tB.textContent || '');
  await sleep(200);
  let savedB = null; try { savedB = JSON.parse(nB.files.get('nexo_wp_c_' + idA + '.json') || '{}'); } catch (e) {}
  r.B_guarda = !!savedB && savedB.img === PER;

  // (4) al recibir, se rechaza lo que no es imagen (no pisa el fondo bueno)
  B.win.applyChatWallpaper(idA, { act: 'wp', img: 'data:text/plain;base64,AAAA' });
  r.rechaza_basura = B.win.chatWallpaperFor(idA) === PER;
  // y un img vacío SÍ es válido (quitar): lo deja sin fondo propio
  B.win.applyChatWallpaper(idA, { act: 'wp', img: '' });
  r.recibe_quitar = B.win.chatWallpaperFor(idA) === '';

  // (5) #dueño 04-11: el botón «Fondo de este chat» de la cabecera SALE al abrir un chat 1-a-1, SIN depender de que el
  //     <body> ya tenga 'chat-view-active' (antes era una carrera con el orden del evento → «a veces no estaba el botón»).
  A.win.document.body.classList.remove('chat-view-active');          // simular que la clase aún NO se agregó (la carrera)
  A.win.dispatchEvent(new A.win.CustomEvent('nexo:ble:openChat', { detail: { contactId: idB } }));
  await sleep(60);
  var wpBtn = A.win.document.getElementById('nexo-wp-btn');
  r.boton_existe = !!wpBtn;
  r.boton_visible_en_chat = !!wpBtn && wpBtn.style.display !== 'none'; // visible aunque falte la clase del body
  A.win.dispatchEvent(new A.win.CustomEvent('nexo:ble:closeChat', { detail: {} }));
  await sleep(60);
  r.boton_oculto_fuera = !!wpBtn && wpBtn.style.display === 'none';    // fuera de un chat, oculto

  // (6) #dueño 04-11: si B SÍ tiene abierto ese chat, el fondo recibido se PINTA al instante (por _curNx, sin depender de
  //     la clase 'chat-view-active' del body — misma carrera que el botón) y el aviso NO dice «abrí el chat».
  const PER2 = 'data:image/png;base64,PERCHAT2zz==';
  B.win.dispatchEvent(new B.win.CustomEvent('nexo:ble:openChat', { detail: { contactId: idA } }));
  await sleep(80);
  B.win.applyChatWallpaper(idA, { act: 'wp', img: PER2 });
  await sleep(40);
  r.en_chat_pinta_al_instante = B.win.wallpaperApplied() === PER2;
  var tB2 = B.win.document.getElementById('perm-error-toast');
  r.en_chat_aviso_sin_abrir = !!tB2 && /fondo/i.test(tB2.textContent || '') && !/abr/i.test(tB2.textContent || '');
  B.win.dispatchEvent(new B.win.CustomEvent('nexo:ble:closeChat', { detail: {} }));

  r.errores = logs.filter((l) => /TypeError|undefined is not|No se pudo descifrar/.test(l)).slice(0, 4);
  const ok = r.emparejados && r.per_set && r.per_manda && r.cae_a_global && r.global_intacto && r.A_guarda_por_chat &&
    r.comparte && r.llega_a_B && r.B_no_mensaje_visible && r.B_avisa_al_recibir && r.B_guarda && r.rechaza_basura && r.recibe_quitar &&
    r.boton_existe && r.boton_visible_en_chat && r.boton_oculto_fuera &&
    r.en_chat_pinta_al_instante && r.en_chat_aviso_sin_abrir && r.errores.length === 0;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('FONDO2 ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_fondo2.txt'), logs.join('\n'));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error('FALLO:', e.stack); fs.writeFileSync(path.join(__dirname, 'last_logs_fondo2.txt'), logs.join('\n')); process.exit(1); });
