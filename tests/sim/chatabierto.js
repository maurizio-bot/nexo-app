// 3086 (diagnósticos S24 08:09 y vivo 08:49 del 14-11): el vivo, con el chat del S24 ABIERTO al irse a segundo plano y la app dormida
// por el sistema 40 min, recibió (su nativo) dos textos del S24 y nunca los confirmó: el aviso de respaldo del nativo (backgroundNotify)
// se saltaba ENTERO para el chat abierto (regla del dueño 08-11: no avisar de quien tenés en pantalla), confirmación incluida, y para
// siempre → el S24 reenviaba sin fin («reenvio_sin_fin»). A y B emparejados por Bluetooth, sin internet; B abre el chat de A, pasa a
// segundo plano y el sistema le congela la app:
//  O1  a los 2 s (un parpadeo) A le escribe: A ve ✓✓ en ≤ 10 s y B no recibe aviso (sigue la regla del dueño);
//  O2  a los 20 s A le escribe otra vez: A ve ✓✓ en ≤ 10 s y B recibe el aviso;
//  O3  la app de B despierta: los dos textos están en su chat, una vez cada uno;
//  O4–O6 (dueño 14-11, pantalla apagada con la app DESPIERTA y el chat abierto): en un parpadeo no avisa; pasados 15 s, sí; al
//      encender la pantalla el aviso se quita y queda leído.
// Uso: node chatabierto.js <dir_build>
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone, installWebCrypto } = require('./native_mock');

const buildDir = path.resolve(process.argv[2]);
// openChatRule: el Kotlin de la misma build (3086+ = BgNotifyPolicy; antes, el chat abierto callaba aviso y confirmación para siempre)
const buildNum = (() => { const m = path.basename(buildDir).match(/(\d{4})/); return m ? Number(m[1]) : 9999; })();
const base = { readsContentFallback: true, retain: ['onPayloadReceived'], closeOnNoService: true, pace: [15, 15], ioDelay: 25, asymmetric: true, noTor: true, openChatRule: buildNum >= 3086 ? 'new' : 'old' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
class DL extends ResourceLoader { constructor(d) { super(); this.d = d; } fetch(u) { const f = path.join(this.d, decodeURIComponent(new URL(u).pathname)); return fs.existsSync(f) ? Promise.resolve(fs.readFileSync(f)) : Promise.reject(new Error('no existe ' + f)); } }
const logs = [];
async function boot(name, native) {
  native.btCalls = native.btCalls || [];
  let vis = 'visible';
  const vc = new VirtualConsole();
  ['log', 'warn', 'error'].forEach((l) => vc.on(l, (...a) => logs.push(`${new Date().toISOString().substring(14, 23)} [${name}] ${l}: ` + a.map(String).join(' ').substring(0, 300))));
  const dom = new JSDOM(fs.readFileSync(path.join(buildDir, 'dist', 'index.html'), 'utf8'), {
    url: 'https://' + name.toLowerCase() + '.nexo.test/index.html', runScripts: 'dangerously', resources: new DL(path.join(buildDir, 'dist')), pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) {
      win.NEXO_NET_RELAYS = []; win.CapacitorCustomPlatform = { name: 'android' }; installWebCrypto(win);
      Object.defineProperty(win.document, 'visibilityState', { configurable: true, get: () => vis });
      Object.defineProperty(win.document, 'hidden', { configurable: true, get: () => vis === 'hidden' });
      const pl = native.plugin();
      ['sendMessage', 'sendBinary'].forEach((k) => {
        const o = pl[k]; if (typeof o !== 'function') return;
        pl[k] = (a) => { try { native.btCalls.push({ t: Date.now(), k, id: String((a && a.deviceId) || '').toLowerCase().replace(/[^0-9a-z]/g, '') }); } catch (e) {} return o(a); };
      });
      win.Capacitor = { Plugins: { NexoBLE: pl } }; win.HTMLElement.prototype.scrollTo = function () {};
    },
  });
  const win = dom.window;
  for (let i = 0; i < 1000 && !(win.NEXO && win.NEXO.initialized); i++) await sleep(10);
  await sleep(800);
  const p = { name, native, win };
  p.setActive = (active) => { vis = active ? 'visible' : 'hidden'; win.document.dispatchEvent(new win.Event('visibilitychange')); native.setAppActive(active); };
  return p;
}
const click = (win, el) => el && el.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
async function openChatWith(p, name) {
  const row = Array.from(p.win.document.querySelectorAll('#main-contacts-list .ble-contact-row')).find((r) => (r.querySelector('.ble-contact-name') || {}).textContent === name);
  click(p.win, row); await sleep(500); return !!row;
}
function sendText(p, t) { const i = p.win.document.getElementById('message-input'); i.value = t; i.dispatchEvent(new p.win.Event('input', { bubbles: true })); click(p.win, p.win.document.getElementById('send-btn')); }
async function addFound(p, name) {
  let add = null;
  const find = () => { const row = Array.from(p.win.document.querySelectorAll('#ble-new-device > div')).find((d) => (d.querySelector('span') || {}).textContent === name); return row && row.querySelector('button'); };
  for (let i = 0; i < 400 && !add; i++) { await sleep(100); add = find(); if (!add && !p.win.bleInterface.isScanning) click(p.win, p.win.document.getElementById('ble-scan-btn')); }
  click(p.win, add); await sleep(2000);
  return !!add;
}
async function waitFor(fn, ms) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return Math.round((Date.now() - t0) / 100) / 10; await sleep(200); } return null; }
const has = (p, from, pred) => p.win.vaultLoadMessages(from).then((l) => l.some(pred));
const notifHas = (n, mid) => Array.from((n.notifications || new Map()).values()).some((x) => x && x.ids && x.ids.has(mid));
async function ownStatus(p, peer, text) { const m = (await p.win.vaultLoadMessages(peer)).find((x) => x._own && x.content === text); return m ? { id: m.msgId || m.messageId, st: m.status } : { id: null, st: null }; }

(async () => {
  const r = { prueba: 'chatabierto', build: path.basename(buildDir), regla_nativa: base.openChatRule };
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', Object.assign({}, base)), nB = new NativePhone('B', 'BB:BB:BB:BB:BB:02', Object.assign({}, base));
  [nA, nB].forEach((n) => { radio.add(n); n.load(); });
  const A = await boot('A', nA), B = await boot('B', nB);
  const idA = A.win.bleInterface.localNexoId.toLowerCase(), idB = B.win.bleInterface.localNexoId.toLowerCase();
  A.win.bleInterface.togglePanel(); const paired = await addFound(A, 'B'); A.win.bleInterface.togglePanel();
  if (!paired) { console.log('CHATABIERTO ' + JSON.stringify({ prueba: 'chatabierto', resultado: 'FALLO', error: 'no empareja' })); process.exit(1); }
  await openChatWith(A, 'B'); sendText(A, 'hola B'); await sleep(2500);
  await openChatWith(B, 'A'); sendText(B, 'hola A'); await sleep(2500);
  r.b_chat_abierto = nB.activeChatNx === idA;
  // B a segundo plano con el chat de A abierto; el sistema le congela la app
  B.setActive(false); nB.setFrozen(true);
  await sleep(2000);
  sendText(A, 'mientras miro');
  await sleep(300);
  const s1 = await ownStatus(A, idB, 'mientras miro');
  const o1 = await waitFor(async () => /delivered|read/.test((await ownStatus(A, idB, 'mientras miro')).st || ''), 10000);
  r.O1_entregado_s = o1;
  r.O1_aviso_en_b = s1.id ? notifHas(nB, s1.id) : null;
  // pasado el parpadeo
  await sleep(Math.max(0, 20000 - 2300 - (o1 || 10) * 1000));
  sendText(A, 'te escribo dormido');
  await sleep(300);
  const s2 = await ownStatus(A, idB, 'te escribo dormido');
  r.O2_entregado_s = await waitFor(async () => /delivered|read/.test((await ownStatus(A, idB, 'te escribo dormido')).st || ''), 10000);
  await sleep(500);
  r.O2_aviso_en_b = s2.id ? notifHas(nB, s2.id) : null;
  // B despierta
  nB.setFrozen(false); B.setActive(true);
  await sleep(6000);
  const inB = await B.win.vaultLoadMessages(idA);
  r.O3_en_chat = ['mientras miro', 'te escribo dormido'].map((t) => inB.filter((m) => !m._own && m.content === t).length);
  // Dueño 14-11 (APK 3052, «a pantalla apagada no suena ni hay notificaciones; a pantalla encendida llegan puntuales»; S24 12:00:
  // 10 textos al vivo, ✓✓ en 1 s cada uno y leídos a las 12:18): B APAGA LA PANTALLA con el chat de A abierto pero su app sigue
  // DESPIERTA (el teléfono no la congela enseguida): la que recibe y confirma es la app, y su regla «el chat abierto nunca avisa»
  // no tenía límite de tiempo → callaba el aviso para siempre. Ahora, como en el nativo (3086): solo en un parpadeo (< 15 s).
  //  O4  pantalla apagada hace 2 s (un parpadeo): A ve ✓✓ y B no recibe aviso;
  //  O5  pantalla apagada hace 20 s: A ve ✓✓ y B recibe el aviso (y le cuenta como no leído);
  //  O6  B enciende la pantalla: el chat abierto queda leído y el aviso se quita.
  B.setActive(false);
  await sleep(2000);
  sendText(A, 'pantalla recién apagada');
  await sleep(300);
  const s4 = await ownStatus(A, idB, 'pantalla recién apagada');
  const o4 = await waitFor(async () => /delivered|read/.test((await ownStatus(A, idB, 'pantalla recién apagada')).st || ''), 10000);
  r.O4_entregado_s = o4;
  await sleep(500);
  r.O4_aviso_en_b = s4.id ? notifHas(nB, s4.id) : null;
  await sleep(Math.max(0, 20000 - 2800 - (o4 === null ? 10 : o4) * 1000)); // (o4 puede ser 0: llegó al momento)
  sendText(A, 'pantalla apagada hace rato');
  await sleep(300);
  const s5 = await ownStatus(A, idB, 'pantalla apagada hace rato');
  r.O5_entregado_s = await waitFor(async () => /delivered|read/.test((await ownStatus(A, idB, 'pantalla apagada hace rato')).st || ''), 10000);
  r.O5_aviso_en_b = s5.id ? await waitFor(() => notifHas(nB, s5.id), 6000) !== null : null;
  B.setActive(true);
  await sleep(3000);
  r.O6_aviso_quitado = s5.id ? !notifHas(nB, s5.id) : null;
  r.O6_leido_en_a = await waitFor(async () => (await ownStatus(A, idB, 'pantalla apagada hace rato')).st === 'read', 10000) !== null;
  r.errores = logs.filter((l) => / error: /.test(l) && !/JSDOMERROR|styles\.css|Not implemented|net::ERR|fetch/.test(l)).slice(0, 5);
  const ok = r.b_chat_abierto && r.O1_entregado_s !== null && r.O1_aviso_en_b === false && r.O2_entregado_s !== null && r.O2_aviso_en_b === true &&
    r.O3_en_chat[0] === 1 && r.O3_en_chat[1] === 1 && r.O4_entregado_s !== null && r.O4_aviso_en_b === false && r.O5_entregado_s !== null &&
    r.O5_aviso_en_b === true && r.O6_aviso_quitado === true && r.O6_leido_en_a && !r.errores.length;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('CHATABIERTO ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_chatabierto.txt'), logs.join('\n'));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('CHATABIERTO ' + JSON.stringify({ prueba: 'chatabierto', resultado: 'FALLO', error: String(e && e.message) })); console.error(e); fs.writeFileSync(path.join(__dirname, 'last_logs_chatabierto.txt'), logs.join('\n')); process.exit(1); });
