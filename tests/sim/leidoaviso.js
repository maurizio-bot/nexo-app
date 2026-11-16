// «Leído» (✓✓ azul) al abrir el chat TOCANDO EL AVISO (PENDIENTES 13-11, sin confirmar: un probador abrió el chat desde la
// notificación y lo que ya estaba NO mandó el «leído»; se marcó al volver a abrir el chat ~1 min después). El acuse de lectura solo
// sale de notify.js: guarda los msgId sin leer por chat (unreadIds) en incoming() y al abrir el chat (_onUnread, count 0, app a la
// vista) los confirma. Escenarios (A escribe a B por Bluetooth; B en la lista de chats, con la app en segundo plano):
//  (a)  app VIVA en segundo plano: llegan 2 textos, B toca el aviso (y la app pasa a la vista) → A ve los 2 «leído».
//  (a2) mismo, pero el aviso se atiende con la app AÚN oculta y la vista llega 2 s después (orden aviso/visibilitychange).
//  (c)  «Confirmaciones de lectura» apagadas (nexo_read_receipts='0'): tocar el aviso NO manda ninguno.
//  (b)  ARRANQUE EN FRÍO: B recibe 2 textos en segundo plano (su JS los cuenta y avisa) y Android MATA la app; B toca el aviso →
//       la app arranca de cero (mismo nativo, mismos archivos) y abre el chat → A ve los 2 «leído». Antes de la 3158 los msgId sin
//       leer vivían solo en memoria: tras el arranque no había nada que confirmar y A se quedaba en «entregado» para siempre.
// Uso: node leidoaviso.js <dir_build>     → una línea «LEIDOAVISO {json}» con "resultado":"OK"|"FALLO" (sale con 0/1)
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone, installWebCrypto } = require('./native_mock');

const buildDir = path.resolve(process.argv[2] || path.join(__dirname, 'builds/wip'));
const opts = { readsContentFallback: true, retain: ['onPayloadReceived', 'onNotificationOpened'], closeOnNoService: true, pace: [15, 15], asymmetric: true, noTor: true };
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
  let vis = 'visible';
  const dom = new JSDOM(fs.readFileSync(path.join(buildDir, 'dist', 'index.html'), 'utf8'), {
    url: 'https://' + name.toLowerCase() + '.nexo.test/index.html', runScripts: 'dangerously',
    resources: new DistLoader(path.join(buildDir, 'dist')), pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) {
      win.CapacitorCustomPlatform = { name: 'android' }; installWebCrypto(win); win.Capacitor = { Plugins: { NexoBLE: native.plugin() } }; win.HTMLElement.prototype.scrollTo = function () {};
      Object.defineProperty(win.document, 'visibilityState', { configurable: true, get: () => vis });
      Object.defineProperty(win.document, 'hidden', { configurable: true, get: () => vis === 'hidden' });
    },
  });
  const win = dom.window;
  for (let i = 0; i < 100 && !(win.NEXO && win.NEXO.initialized); i++) await sleep(100);
  await sleep(800);
  const p = { name, native, win };
  // Segundo plano / volver a la app: el WebView cambia la visibilidad y el nativo lo sabe (onPause/onResume)
  p.setActive = (on) => { vis = on ? 'visible' : 'hidden'; win.document.dispatchEvent(new win.Event('visibilitychange')); native.setAppActive(on); };
  return p;
}
const click = (win, el) => el && el.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
async function openChat(p) { click(p.win, p.win.document.querySelector('#main-contacts-list .ble-contact-row')); await sleep(600); }
async function sendText(p, t) { const i = p.win.document.getElementById('message-input'); i.value = t; i.dispatchEvent(new p.win.Event('input', { bubbles: true })); click(p.win, p.win.document.getElementById('send-btn')); }
async function waitFor(fn, ms) { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (await fn()) return +((Date.now() - t0) / 1000).toFixed(1); } catch (e) {} await sleep(200); } return null; }
const status = (p, t) => { const m = Array.from(p.win.document.querySelectorAll('#messages-container .message.own')).find((x) => (x.querySelector('.msg-content') || {}).textContent === t); const s = m && m.querySelector('.msg-status'); return s ? s.className.replace('msg-status status-', '') : null; };
const delivered = (p, t) => /^(delivered|read)$/.test(status(p, t) || '');

(async () => {
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', opts), nB = new NativePhone('B', 'BB:BB:BB:BB:BB:02', opts);
  radio.add(nA); radio.add(nB); nA.load(); nB.load();
  let [A, B] = await Promise.all([boot('A', nA), boot('B', nB)]);
  const r = { prueba: 'leidoaviso', build: path.basename(buildDir) };
  // Emparejar A↔B por Bluetooth; A deja abierto el chat con B (ahí se mira el ✓✓)
  A.win.bleInterface.togglePanel();
  let add = null;
  for (let i = 0; i < 400 && !add; i++) { await sleep(100); add = A.win.document.querySelector('#ble-new-device > div button'); if (!add && !A.win.bleInterface.isScanning) click(A.win, A.win.document.getElementById('ble-scan-btn')); }
  if (!add) { console.log('LEIDOAVISO ' + JSON.stringify({ prueba: 'leidoaviso', resultado: 'FALLO', error: 'no se pudo emparejar A con B' })); process.exit(1); }
  click(A.win, add); await sleep(2500);
  A.win.bleInterface.togglePanel();
  const idA = A.win.bleInterface.localNexoId.toLowerCase();
  await openChat(A);
  await sendText(A, 'hola B');
  r.emparejado = (await waitFor(() => B.win.vaultLoadContacts().some((c) => String(c.nexoId || c.deviceUUID || '').toLowerCase() === idA) && delivered(A, 'hola B'), 30000)) !== null;

  const inChatB = () => String(B.win.bleInterface._activeChatDeviceId || '').toLowerCase() === idA;
  const backToList = async () => { click(B.win, B.win.document.getElementById('chat-back-btn')); await sleep(800); };
  const unreadB = () => ((B.win.NEXO_notifier && B.win.NEXO_notifier.unreadIds.get(idA)) || []).length;
  // A manda dos textos con B en segundo plano (B en la lista); espera a que estén entregados y contados/avisados en B
  async function twoWhileHidden(t1, t2) {
    B.setActive(false); await sleep(1000);
    const before = unreadB();
    await sendText(A, t1); await sleep(700); await sendText(A, t2);
    const s = {};
    s.entregados_s = await waitFor(() => delivered(A, t1) && delivered(A, t2), 30000);
    s.contados_en_B = (await waitFor(() => unreadB() >= before + 2, 10000)) !== null;
    s.aviso_en_B = nB.notifications.has(idA);
    s.estado_antes_de_tocar = [status(A, t1), status(A, t2)];
    return s;
  }
  const readBoth = (t1, t2) => waitFor(() => status(A, t1) === 'read' && status(A, t2) === 'read', 10000);

  // (a) app viva en segundo plano: toca el aviso y la app pasa a la vista
  const a = r.a_viva = await twoWhileHidden('aviso uno', 'aviso dos');
  nB.emit('onNotificationOpened', { deviceId: idA, source: 'notification' }); B.setActive(true);
  a.abre_chat = (await waitFor(inChatB, 10000)) !== null;
  a.leidos_s = await readBoth('aviso uno', 'aviso dos');
  a.estado_final = [status(A, 'aviso uno'), status(A, 'aviso dos')];
  a.ok = r.emparejado && a.entregados_s !== null && a.contados_en_B && a.abre_chat && a.leidos_s !== null;
  await backToList();

  // (a2) el aviso se atiende con la app aún oculta (abre el chat) y la vista llega 2 s después
  const a2 = r.a2_vista_tarde = await twoWhileHidden('oculta uno', 'oculta dos');
  nB.emit('onNotificationOpened', { deviceId: idA, source: 'notification' });
  a2.abre_chat_oculta = (await waitFor(inChatB, 10000)) !== null; await sleep(2000);
  a2.leido_antes_de_verse = status(A, 'oculta uno') === 'read' || status(A, 'oculta dos') === 'read'; // esperado false (no lo vio)
  B.setActive(true);
  a2.leidos_s = await readBoth('oculta uno', 'oculta dos');
  a2.ok = a2.entregados_s !== null && a2.contados_en_B && a2.abre_chat_oculta && !a2.leido_antes_de_verse && a2.leidos_s !== null;
  await backToList();

  // (c) confirmaciones de lectura apagadas: tocar el aviso no manda ningún «leído»
  try { B.win.localStorage.setItem('nexo_read_receipts', '0'); } catch (e) {}
  const c = r.c_apagadas = await twoWhileHidden('apagado uno', 'apagado dos');
  nB.emit('onNotificationOpened', { deviceId: idA, source: 'notification' }); B.setActive(true);
  c.abre_chat = (await waitFor(inChatB, 10000)) !== null;
  await sleep(6000);
  c.estado_final = [status(A, 'apagado uno'), status(A, 'apagado dos')];
  c.ok = c.entregados_s !== null && c.abre_chat && c.estado_final.every((s) => s === 'delivered');
  await backToList();
  try { B.win.localStorage.setItem('nexo_read_receipts', '1'); } catch (e) {}

  // (b) ARRANQUE EN FRÍO: B los recibe y avisa en segundo plano; Android mata la app; B toca el aviso y la app arranca de cero
  const b = r.b_frio = await twoWhileHidden('frio uno', 'frio dos');
  await sleep(4000); // lo que la app guarda «enseguida» (vistos, sin leer) ya está en disco
  B.win.close(); nB.destroyActivity(); await sleep(1500);
  b.aviso_sigue_tras_matar = nB.notifications.has(idA);
  nB.emit('onNotificationOpened', { deviceId: idA, source: 'notification' }); // el nativo lo retiene hasta que el JS escucha
  nB.load(); B = await boot('B', nB);
  b.abre_chat = (await waitFor(inChatB, 30000)) !== null;
  b.leidos_s = await waitFor(() => status(A, 'frio uno') === 'read' && status(A, 'frio dos') === 'read', 40000);
  b.estado_final = [status(A, 'frio uno'), status(A, 'frio dos')];
  b.ok = b.entregados_s !== null && b.contados_en_B && b.abre_chat && b.leidos_s !== null;
  // y lo de (c) (leído con las confirmaciones apagadas) no se manda después por el arranque
  r.c_sigue_sin_leido = [status(A, 'apagado uno'), status(A, 'apagado dos')].every((s) => s === 'delivered');

  r.errores = logs.filter((l) => / error: /.test(l) && !/JSDOMERROR|styles\.css|Not implemented|GLOBAL TIMEOUT|Assembly timeout|net::ERR|fetch/.test(l)).slice(0, 5);
  const ok = a.ok && a2.ok && c.ok && b.ok && r.c_sigue_sin_leido && r.errores.length === 0;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('LEIDOAVISO ' + JSON.stringify(r));
  try { fs.writeFileSync(path.join(__dirname, 'last_logs_leidoaviso.txt'), logs.join('\n')); } catch (e) {}
  process.exit(ok ? 0 : 1);
})().catch((e) => {
  console.log('LEIDOAVISO ' + JSON.stringify({ prueba: 'leidoaviso', resultado: 'FALLO', error: String(e && e.stack || e) }));
  try { fs.writeFileSync(path.join(__dirname, 'last_logs_leidoaviso.txt'), logs.join('\n')); } catch (e2) {}
  process.exit(1);
});
