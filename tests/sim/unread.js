// Mensajes sin leer (burbuja numerada de cada chat) y notificaciones del teléfono (ronda 2750).
// A y B por Bluetooth. Comprueba:
//  1. B en la lista de chats (app a la vista): texto corto, texto largo y foto de A suman 3 en la burbuja de A; sin
//     notificaciones del teléfono (la app está a la vista).
//  2. B abre el chat de A: burbuja a 0 y A ve "leído".
//  3. B con el chat de A abierto pero la app en segundo plano: lo que llega cuenta como no leído, sale una
//     notificación (con el número) y A NO ve "leído" hasta que B vuelve a la app.
//  4. B vuelve: burbuja a 0, notificación quitada, A ve "leído".
//  5. B en segundo plano con la lista: llega una foto ("📷 Foto" en la notificación); B toca la notificación: se abre
//     el chat de A, burbuja a 0, notificación quitada.
//  6. El mismo mensaje dos veces (reenvío) no cuenta dos veces.
// Uso: node unread.js <dir_build> [--io-delay=25]
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
const vis = {};
async function boot(name, native) {
  native.listeners = new Map();
  vis[name] = 'visible';
  const vc = new VirtualConsole();
  ['log', 'warn', 'error'].forEach((l) => vc.on(l, (...a) => logs.push(`[${name}] ${l}: ` + a.map(String).join(' ').substring(0, 250))));
  const dom = new JSDOM(fs.readFileSync(path.join(buildDir, 'dist', 'index.html'), 'utf8'), {
    url: 'https://' + name.toLowerCase() + '.nexo.test/index.html', runScripts: 'dangerously',
    resources: new DistLoader(path.join(buildDir, 'dist')), pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) {
      win.CapacitorCustomPlatform = { name: 'android' }; installWebCrypto(win); win.Capacitor = { Plugins: { NexoBLE: native.plugin() } }; win.HTMLElement.prototype.scrollTo = function () {};
      Object.defineProperty(win.document, 'visibilityState', { configurable: true, get: () => vis[name] });
      Object.defineProperty(win.document, 'hidden', { configurable: true, get: () => vis[name] === 'hidden' });
    },
  });
  const win = dom.window;
  for (let i = 0; i < 100 && !(win.NEXO && win.NEXO.initialized); i++) await sleep(100);
  await sleep(800);
  return { name, native, win };
}
function setVisible(p, on) { vis[p.name] = on ? 'visible' : 'hidden'; p.win.document.dispatchEvent(new p.win.Event('visibilitychange')); }
const click = (win, el) => el && el.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
async function openChat(p) { click(p.win, p.win.document.querySelector('#main-contacts-list .ble-contact-row')); await sleep(600); }
async function closeChat(p) { click(p.win, p.win.document.getElementById('chat-back-btn')); await sleep(600); }
async function sendText(p, t) { const i = p.win.document.getElementById('message-input'); i.value = t; i.dispatchEvent(new p.win.Event('input', { bubbles: true })); click(p.win, p.win.document.getElementById('send-btn')); }
async function sendPhoto(p, kb, seed) {
  const buf = Buffer.alloc(kb * 1024); for (let i = 0; i < buf.length; i++) buf[i] = (i * seed + 7) & 255;
  click(p.win, p.win.document.querySelector('.attach-menu-item[data-type="file"]')); await sleep(200);
  const fin = Array.from(p.win.document.querySelectorAll('input[type=file]')).pop();
  Object.defineProperty(fin, 'files', { value: [new p.win.File([buf], 'foto' + seed + '.png', { type: 'image/png' })] });
  fin.dispatchEvent(new p.win.Event('change'));
}
async function waitFor(fn, ms) { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (await fn()) return +((Date.now() - t0) / 1000).toFixed(1); } catch (e) {} await sleep(200); } return null; }
const status = (p, text) => { const el = Array.from(p.win.document.querySelectorAll('#messages-container .message.own')).find((m) => m.textContent.indexOf(text) >= 0); const s = el && el.querySelector('.msg-status'); return s ? s.className.replace('msg-status status-', '') : null; };

(async () => {
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', opts), nB = new NativePhone('B', 'BB:BB:BB:BB:BB:02', opts);
  radio.add(nA); radio.add(nB); nA.load(); nB.load();
  const [A, B] = await Promise.all([boot('A', nA), boot('B', nB)]);
  const r = { build: path.basename(buildDir) };
  A.win.bleInterface.togglePanel();
  let add = null;
  for (let i = 0; i < 400 && !add; i++) { await sleep(100); add = A.win.document.querySelector('#ble-new-device > div button'); if (!add && !A.win.bleInterface.isScanning) click(A.win, A.win.document.getElementById('ble-scan-btn')); }
  click(A.win, add); await sleep(2500);
  A.win.bleInterface.togglePanel();
  await openChat(A);
  const idA = A.win.bleInterface.localNexoId.toLowerCase();
  // B tiene a A en la lista (le llega el primer mensaje); se espera a que haya contacto y clave
  await sendText(A, 'hola B'); await waitFor(() => B.win.vaultLoadContacts().some((c) => String(c.nexoId || c.deviceUUID || '').toLowerCase() === idA), 30000);
  await sleep(1500);
  const unreadB = () => ((B.win.vaultLoadContacts().find((c) => String(c.nexoId || c.deviceUUID || '').toLowerCase() === idA)) || {}).unreadCount || 0;
  const badgeB = () => { const row = Array.from(B.win.document.querySelectorAll('#main-contacts-list .ble-contact-row'))[0]; const b = row && row.querySelector('.ble-unread-badge'); return b ? Number(b.textContent) : 0; };
  const notifB = () => nB.notifications.get(idA);
  const base = unreadB();
  r.primer_hola_cuenta = base;

  // 1. B a la vista en la lista: corto, largo y foto
  const largo = 'Mensaje largo ' + 'abcdefghij'.repeat(40);
  await sendText(A, 'corto 1'); await sleep(1500);
  await sendText(A, largo); await sleep(2500);
  await sendPhoto(A, 30, 13);
  r.burbuja_tras_3 = (await waitFor(() => unreadB() >= base + 3, 60000)) !== null ? unreadB() - base : unreadB() - base;
  await sleep(1500);
  r.burbuja_en_pantalla = badgeB();
  r.contador_corto_largo_foto = unreadB() - base;
  r.notificaciones_con_app_a_la_vista = nB.notifLog.length;

  // 2. B abre el chat de A
  await openChat(B); await sleep(2500);
  r.al_abrir_chat = unreadB();
  r.A_ve_leido = await waitFor(() => status(A, 'corto 1') === 'read', 20000) !== null;

  // 3. B en segundo plano con el chat abierto
  setVisible(B, false); await sleep(300);
  await sendText(A, 'en segundo plano 1'); await sleep(1500);
  await sendText(A, 'en segundo plano 2');
  await waitFor(() => unreadB() >= 2, 30000); await sleep(2500);
  r.segundo_plano_cuenta = unreadB();
  const n3 = notifB();
  r.notificacion = n3 ? { nombre: n3.name, numero: n3.base + n3.ids.size, texto: n3.text } : null;
  r.A_no_ve_leido_en_segundo_plano = status(A, 'en segundo plano 2') !== 'read';

  // 4. B vuelve a la app
  setVisible(B, true); await sleep(2500);
  r.al_volver_cuenta = unreadB();
  r.al_volver_notificacion_quitada = !notifB();
  r.al_volver_A_ve_leido = await waitFor(() => status(A, 'en segundo plano 2') === 'read', 20000) !== null;

  // 5. B en segundo plano con la lista; foto; toca la notificación
  await closeChat(B);
  setVisible(B, false); await sleep(300);
  await sendPhoto(A, 20, 29);
  await waitFor(() => unreadB() >= 1, 60000); await sleep(1500);
  const n5 = notifB();
  r.notificacion_foto = n5 ? n5.text : null;
  setVisible(B, true);
  nB.emit('onNotificationOpened', { deviceId: idA, source: 'notification' });
  await sleep(3000);
  r.tocar_abre_chat = (B.win.NEXO.app.activeContact && String(B.win.NEXO.app.activeContact.nexoId || '').toLowerCase()) === idA;
  r.tocar_cuenta = unreadB();
  r.tocar_notificacion_quitada = !notifB();

  // 6. Repetido: el mismo paquete de chat otra vez no cuenta (B con la lista)
  await closeChat(B);
  const before = unreadB();
  B.win.dispatchEvent(new B.win.CustomEvent('nexo:ble:messageReceived', { detail: { content: 'repetido', senderNexoId: idA, messageId: 'msgrepetido1', timestamp: Date.now() } }));
  B.win.dispatchEvent(new B.win.CustomEvent('nexo:ble:messageReceived', { detail: { content: 'repetido', senderNexoId: idA, messageId: 'msgrepetido1', timestamp: Date.now() } }));
  await sleep(800);
  r.repetido_suma = unreadB() - before;
  r.repetido_cuenta_una_vez = r.repetido_suma === 1;

  r.permiso_notificaciones_pedido = (nB.notifPermAsked || 0) >= 1;
  r.errores = logs.filter((l) => / error: /.test(l) && !/JSDOMERROR|styles\.css/.test(l)).slice(0, 5);
  console.log('UNREAD ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_unread.txt'), logs.join('\n'));
  process.exit(0);
})().catch((e) => { console.error('FALLO:', e.stack); fs.writeFileSync(path.join(__dirname, 'last_logs_unread.txt'), logs.join('\n')); process.exit(1); });
