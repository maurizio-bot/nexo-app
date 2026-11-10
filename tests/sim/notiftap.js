// Tocar una notificación de mensaje debe abrir EL CHAT de quien lo mandó (dueño 10-11: «al llegar una notificación, cuando
// la pulsas no te manda directamente al chat que mandó el mensaje»). Caso real que se perdía: la app CERRADA (arranque en
// frío). El nativo avisa onNotificationOpened en cuanto carga el plugin, ANTES de que exista el JS: el evento se perdía
// (no estaba «retenido» y el extra del intent se borraba al avisar). Ahora el nativo lo retiene hasta que el JS escucha, y el
// JS espera a estar listo (vault + interfaz) antes de abrir. Aquí se simula: el evento llega ANTES de arrancar la app y, en
// otra vuelta, con la app ya viva y en segundo plano. Uso: node notiftap.js <dir_build>
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone, installWebCrypto } = require('./native_mock');

const buildDir = path.resolve(process.argv[2]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
class DL extends ResourceLoader { constructor(d) { super(); this.d = d; } fetch(u) { const f = path.join(this.d, decodeURIComponent(new URL(u).pathname)); return fs.existsSync(f) ? Promise.resolve(fs.readFileSync(f)) : Promise.reject(new Error('no existe ' + f)); } }
const logs = [];
const ID1 = 'nx0test0aa', ID2 = 'nx0test0bb';
async function waitFor(fn, ms) { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (await fn()) return Math.round((Date.now() - t0) / 100) / 10; } catch (e) {} await sleep(200); } return null; }
(async () => {
  const base = { readsContentFallback: true, retain: ['onPayloadReceived', 'onNotificationOpened'], closeOnNoService: true, pace: [15, 15], ioDelay: 0, asymmetric: true, noTor: true };
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', base);
  radio.add(nA); nA.load();
  // (1) ARRANQUE EN FRÍO: el nativo avisa antes de que exista el JS
  nA.emit('onNotificationOpened', { deviceId: ID1, source: 'notification' });
  const vc = new VirtualConsole();
  ['log', 'warn', 'error'].forEach((l) => vc.on(l, (...a) => logs.push(`[A] ${l}: ` + a.map(String).join(' ').substring(0, 250))));
  let vis = 'visible';
  const dom = new JSDOM(fs.readFileSync(path.join(buildDir, 'dist', 'index.html'), 'utf8'), {
    url: 'https://a.nexo.test/index.html', runScripts: 'dangerously', resources: new DL(path.join(buildDir, 'dist')), pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) {
      win.CapacitorCustomPlatform = { name: 'android' }; installWebCrypto(win);
      win.Capacitor = { Plugins: { NexoBLE: nA.plugin() } }; win.HTMLElement.prototype.scrollTo = function () {};
      Object.defineProperty(win.document, 'visibilityState', { configurable: true, get: () => vis });
    },
  });
  const win = dom.window;
  const active = () => String((win.NEXO && win.NEXO.app && win.NEXO.app.activeContact && win.NEXO.app.activeContact.nexoId) || '').toLowerCase();
  const r = { prueba: 'notiftap', build: path.basename(buildDir) };
  r.frio_abre_s = await waitFor(() => active() === ID1, 40000);
  r.frio_abre_chat = r.frio_abre_s !== null;
  // (2) app viva en segundo plano: otra notificación (otro contacto) → abre ese chat
  for (let i = 0; i < 100 && !(win.NEXO && win.NEXO.initialized); i++) await sleep(100);
  vis = 'hidden'; win.document.dispatchEvent(new win.Event('visibilitychange')); await sleep(300);
  nA.emit('onNotificationOpened', { deviceId: ID2, source: 'notification' });
  vis = 'visible'; win.document.dispatchEvent(new win.Event('visibilitychange'));
  r.vivo_abre_s = await waitFor(() => active() === ID2, 15000);
  r.vivo_abre_chat = r.vivo_abre_s !== null;
  // (3) sin remitente válido (aviso sin identificar): no rompe ni cambia de chat
  nA.emit('onNotificationOpened', { deviceId: 'basura', source: 'notification' }); await sleep(1500);
  r.sin_remitente_no_cambia = active() === ID2;
  // (4) aviso genérico «Mensaje nuevo» (despertar): sin remitente → abre el chat SOLO si hay un único chat con mensajes sin leer
  const inChat = () => win.document.body.classList.contains('chat-view-active');
  const backToList = async () => { const b = win.document.getElementById('chat-back-btn'); if (b) b.dispatchEvent(new win.MouseEvent('click', { bubbles: true })); await sleep(700); };
  await backToList();
  r.lista_antes = !inChat();
  const bi = win.bleInterface;
  bi.bumpUnread(ID1); await sleep(200);
  nA.emit('onNotificationOpened', { deviceId: '', source: 'wake' });
  r.despertar_un_chat_abre_s = await waitFor(() => inChat() && active() === ID1, 15000);
  r.despertar_un_chat_abre = r.despertar_un_chat_abre_s !== null;
  await backToList();
  bi.bumpUnread(ID1); bi.bumpUnread(ID2); await sleep(200);
  nA.emit('onNotificationOpened', { deviceId: '', source: 'wake' });
  await sleep(4000);
  r.despertar_varios_se_queda_en_lista = !inChat();
  await backToList();
  nA.emit('onNotificationOpened', { deviceId: '', source: 'wake' });   // nada sin leer: no abre nada, sin errores
  await sleep(2000);
  r.despertar_sin_nada_no_abre = !inChat();

  r.errores = logs.filter((l) => / error: /.test(l) && !/JSDOMERROR|styles\.css|Not implemented|GLOBAL TIMEOUT|Assembly timeout|net::ERR|fetch/.test(l)).slice(0, 5);
  const ok = r.frio_abre_chat && r.vivo_abre_chat && r.sin_remitente_no_cambia && r.lista_antes && r.despertar_un_chat_abre && r.despertar_varios_se_queda_en_lista && r.despertar_sin_nada_no_abre && r.errores.length === 0;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('NOTIFTAP ' + JSON.stringify(r));
  try { fs.writeFileSync(path.join(__dirname, 'last_logs_notiftap.txt'), logs.join('\n')); } catch (e) {}
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('NOTIFTAP ' + JSON.stringify({ prueba: 'notiftap', resultado: 'FALLO', error: String(e && e.message) })); process.exit(1); });
