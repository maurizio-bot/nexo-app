// Ronda 2765 (pedido del dueño): que los avisos y las llamadas lleguen con la app en segundo plano o cerrada y con la
// pantalla apagada, y que la enciendan. A y B por Bluetooth; B empieza sin "funcionar en segundo plano" ni "llamadas a
// pantalla completa" (como un teléfono con ahorro de batería, p.ej. el Vivo del dueño).
//  1. Al arrancar, B pide una vez que el ahorro de batería no congele NEXO.
//  2. Perfil → "Avisos con la pantalla apagada": lo que falta sale con "Arreglar"; al arreglarlo, ✅.
//  3. B en segundo plano con la pantalla apagada: un mensaje de A la enciende; sin "Encender la pantalla con un
//     mensaje nuevo", no; una llamada de A, siempre.
//  4. Al acabar la llamada, la app vuelve detrás de la pantalla de bloqueo (callScreenDone).
// Lo nativo (encender la pantalla, pantalla de bloqueo, ajustes del sistema) es el modelo de native_mock.js (Kotlin
// 2765): aquí se prueba lo que hace la app con ello.
// Uso: node alerts.js <dir_build>
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone } = require('./native_mock');

const buildDir = path.resolve(process.argv[2]);
const opts = { readsContentFallback: true, retain: ['onPayloadReceived'], closeOnNoService: true, pace: [15, 15], ioDelay: 25, asymmetric: true };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
class DL extends ResourceLoader { constructor(d) { super(); this.d = d; } fetch(u) { const f = path.join(this.d, decodeURIComponent(new URL(u).pathname)); return fs.existsSync(f) ? Promise.resolve(fs.readFileSync(f)) : Promise.reject(new Error('x')); } }
const logs = [];
const vis = {};
async function boot(name, native) {
  const vc = new VirtualConsole();
  ['log', 'warn', 'error'].forEach((l) => vc.on(l, (...a) => logs.push(`${new Date().toISOString().substring(14, 23)} [${name}] ${l}: ` + a.map(String).join(' ').substring(0, 250))));
  const dom = new JSDOM(fs.readFileSync(path.join(buildDir, 'dist', 'index.html'), 'utf8'), {
    url: 'https://' + name.toLowerCase() + '.nexo.test/index.html', runScripts: 'dangerously', resources: new DL(path.join(buildDir, 'dist')), pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) {
      win.CapacitorCustomPlatform = { name: 'android' }; require('./native_mock').installWebCrypto(win); win.Capacitor = { Plugins: { NexoBLE: native.plugin() } }; win.HTMLElement.prototype.scrollTo = function () {};
      Object.defineProperty(win.document, 'visibilityState', { configurable: true, get: () => vis[name] || 'visible' });
      Object.defineProperty(win.document, 'hidden', { configurable: true, get: () => (vis[name] || 'visible') === 'hidden' });
      win.navigator.mediaDevices = { getUserMedia: () => Promise.reject(new Error('sin micrófono en el simulador')) };
    },
  });
  const win = dom.window;
  for (let i = 0; i < 100 && !(win.NEXO && win.NEXO.initialized); i++) await sleep(100);
  await sleep(800);
  return { name, native, win };
}
function setVisible(p, on) { vis[p.name] = on ? 'visible' : 'hidden'; p.native.setAppActive(on); p.win.document.dispatchEvent(new p.win.Event('visibilitychange')); }
const click = (w, el) => el && el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
async function openChatWith(p, name) {
  let row; for (let i = 0; i < 300 && !row; i++) { row = Array.from(p.win.document.querySelectorAll('#main-contacts-list .ble-contact-row')).find((r) => (r.querySelector('.ble-contact-name') || {}).textContent === name); if (!row) await sleep(100); }
  click(p.win, row); await sleep(600); return !!row;
}
function sendText(p, t) { const i = p.win.document.getElementById('message-input'); i.value = t; i.dispatchEvent(new p.win.Event('input', { bubbles: true })); click(p.win, p.win.document.getElementById('send-btn')); }
const wait = async (c, s) => { for (let i = 0; i < s * 5; i++) { if (await c()) return true; await sleep(200); } return false; };
const rows = (p) => Array.from(p.win.document.querySelectorAll('#nexo-alert-rows .nx-alert-row')).map((r) => r.textContent.replace('Arreglar', '').trim());

(async () => {
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', opts), nB = new NativePhone('B', 'BB:BB:BB:BB:BB:02', Object.assign({}, opts, { alerts: { battery: false, fullScreen: false } }));
  [nA, nB].forEach((n) => { radio.add(n); n.load(); });
  const [A, B] = await Promise.all([boot('A', nA), boot('B', nB)]);
  const idA = A.win.bleInterface.localNexoId.toLowerCase(), idB = B.win.bleInterface.localNexoId.toLowerCase();
  const r = { build: path.basename(buildDir) };
  // 1. Pedido una vez al arrancar
  r.pide_segundo_plano = await wait(() => (nB.alertOpened || []).indexOf('battery') >= 0, 20);
  r.A_no_pide = !(nA.alertOpened || []).length; // A ya lo tiene
  // Contactos
  A.win.bleInterface.togglePanel(); let add = null;
  for (let i = 0; i < 400 && !add; i++) { await sleep(100); add = A.win.document.querySelector('#ble-new-device > div button'); if (!add && !A.win.bleInterface.isScanning) click(A.win, A.win.document.getElementById('ble-scan-btn')); }
  click(A.win, add); await sleep(1500);
  if (A.win.document.getElementById('ble-panel').classList.contains('active')) A.win.bleInterface.togglePanel();
  await openChatWith(A, 'B'); sendText(A, 'hola'); await sleep(2500);
  r.contactos = await wait(async () => (await B.win.vaultLoadMessages(idA)).some((m) => m.content === 'hola'), 30);
  // 2. Perfil
  B.win.dispatchEvent(new B.win.CustomEvent('nexo:ui:profile'));
  await wait(() => rows(B).length === 3, 10);
  r.perfil_antes = rows(B);
  const fix = B.win.document.querySelector('#nexo-alert-rows button[data-what="fullScreen"]');
  r.boton_arreglar = !!fix;
  click(B.win, fix);
  await sleep(4500);
  r.perfil_despues = rows(B);
  r.abre_ajuste = (nB.alertOpened || []).indexOf('fullScreen') >= 0;
  const wakeBox = B.win.document.getElementById('nexo-wake-msg');
  r.encender_por_defecto = !!(wakeBox && wakeBox.checked);
  { const c = B.win.document.getElementById('nexo-profile-close'); if (c) click(B.win, c); }
  // 3. Pantalla apagada
  setVisible(B, false); nB.screenOn = false; await sleep(500);
  const w0 = nB.screenWakes || 0;
  sendText(A, 'con la pantalla apagada');
  await wait(() => nB.notifLog.some((n) => /pantalla apagada/.test(n.text || '')), 30);
  r.mensaje_enciende = (nB.screenWakes || 0) > w0;
  nB.wakeOnMsg = false; // como si se quitara en Perfil (setWakeOnMessage)
  const w1 = nB.screenWakes || 0;
  sendText(A, 'otro sin encender');
  await wait(() => nB.notifLog.some((n) => /sin encender/.test(n.text || '')), 30);
  r.sin_opcion_no_enciende = (nB.screenWakes || 0) === w1;
  const w2 = nB.screenWakes || 0;
  click(A.win, A.win.document.getElementById('nexo-call-btn'));
  r.llamada_suena = await wait(() => !!(nB.callNotif && nB.callNotif.from === idA), 30);
  r.llamada_enciende = (nB.screenWakes || 0) > w2;
  // 4. Al acabar la llamada
  const d0 = nB.calls.filter((c) => c.name === 'callScreenDone').length;
  if (A.win.bleInterface.calls.call) A.win.bleInterface.calls.hangup();
  r.vuelve_tras_el_bloqueo = await wait(() => nB.calls.filter((c) => c.name === 'callScreenDone').length > d0, 30);
  r.errores = logs.filter((l) => / error: /.test(l) && !/JSDOMERROR|styles\.css|Not implemented/.test(l)).slice(0, 5);
  const ok = r.pide_segundo_plano && r.A_no_pide && r.contactos && r.perfil_antes.length === 3 && r.perfil_antes.filter((t) => /^⚠️/.test(t)).length === 1 && r.boton_arreglar &&
    r.abre_ajuste && r.perfil_despues.every((t) => /^✅/.test(t)) && r.encender_por_defecto && r.mensaje_enciende && r.sin_opcion_no_enciende && r.llamada_suena && r.llamada_enciende &&
    r.vuelve_tras_el_bloqueo && !r.errores.length;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('ALERTS ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_alerts.txt'), logs.join('\n'));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error(e); fs.writeFileSync(path.join(__dirname, 'last_logs_alerts.txt'), logs.join('\n')); process.exit(1); });
