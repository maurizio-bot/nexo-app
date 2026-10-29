// Palomita de LEÍDO (✓✓ azul) por BLUETOOTH cuando el enlace se cae entre la entrega y la lectura (informe del dueño
// 29-10: por Bluetooth el leído no se ponía azul). El acuse de lectura es un paquete de control que se manda y, si el
// enlace está caído, se PIERDE sin reintento (a diferencia de un mensaje normal, que queda pendiente y se reenvía al
// reconectar). Aquí: A manda a B por Bluetooth y llega a «entregado»; se CAE el enlace; B abre el chat (lee) con el
// enlace caído; se restablece el enlace; se comprueba que A acaba viendo «leído» (con el arreglo, el acuse se reenvía
// al reconectar; sin el arreglo, se queda en «entregado» gris para siempre).
// Uso: node readbt.js <dir_build>
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone, installWebCrypto } = require('./native_mock');

const buildDir = path.resolve(process.argv[2] || path.join(__dirname, 'builds/wip'));
const opts = { readsContentFallback: true, retain: ['onPayloadReceived'], closeOnNoService: true, pace: [15, 15], asymmetric: true };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
class DistLoader extends ResourceLoader {
  constructor(dir) { super(); this.dir = dir; }
  fetch(url) { const f = path.join(this.dir, decodeURIComponent(new URL(url).pathname)); return fs.existsSync(f) ? Promise.resolve(fs.readFileSync(f)) : Promise.reject(new Error('no existe ' + f)); }
}
const logs = [];
const vis = {};
async function boot(name, native) {
  native.listeners = new Map(); vis[name] = 'visible';
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
const click = (win, el) => el && el.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
async function openChat(p) { click(p.win, p.win.document.querySelector('#main-contacts-list .ble-contact-row')); await sleep(600); }
async function sendText(p, t) { const i = p.win.document.getElementById('message-input'); i.value = t; i.dispatchEvent(new p.win.Event('input', { bubbles: true })); click(p.win, p.win.document.getElementById('send-btn')); }
async function waitFor(fn, ms) { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (await fn()) return +((Date.now() - t0) / 1000).toFixed(1); } catch (e) {} await sleep(200); } return null; }
const status = (p, text) => { const el = Array.from(p.win.document.querySelectorAll('#messages-container .message.own')).find((m) => m.textContent.indexOf(text) >= 0); const s = el && el.querySelector('.msg-status'); return s ? s.className.replace('msg-status status-', '') : null; };

(async () => {
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', opts), nB = new NativePhone('B', 'BB:BB:BB:BB:BB:02', opts);
  radio.add(nA); radio.add(nB); nA.load(); nB.load();
  const [A, B] = await Promise.all([boot('A', nA), boot('B', nB)]);
  const r = { build: path.basename(buildDir) };
  // Emparejar A↔B por Bluetooth
  A.win.bleInterface.togglePanel();
  let add = null;
  for (let i = 0; i < 400 && !add; i++) { await sleep(100); add = A.win.document.querySelector('#ble-new-device > div button'); if (!add && !A.win.bleInterface.isScanning) click(A.win, A.win.document.getElementById('ble-scan-btn')); }
  click(A.win, add); await sleep(2500);
  A.win.bleInterface.togglePanel();
  const idA = A.win.bleInterface.localNexoId.toLowerCase();
  const idB = B.win.bleInterface.localNexoId.toLowerCase();
  const biA = A.win.bleInterface;
  await openChat(A);
  // A manda a B; B lo recibe (le aparece el contacto) y confirma la ENTREGA
  await sendText(A, 'hola B'); await waitFor(() => B.win.vaultLoadContacts().some((c) => String(c.nexoId || c.deviceUUID || '').toLowerCase() === idA), 30000);
  r.entregado_s = await waitFor(() => { var s = status(A, 'hola B'); return s === 'delivered' || s === 'read'; }, 30000);
  r.estado_tras_entregar = status(A, 'hola B');
  // msgId del mensaje de A (para simular que B lo lee con el enlace caído)
  const aMsgId = (function () { const el = Array.from(A.win.document.querySelectorAll('#messages-container .message.own')).find((m) => m.textContent.indexOf('hola B') >= 0); const s = el && el.querySelector('.msg-status'); return s ? s.dataset.msgId : null; })();
  r.hay_msgid = !!aMsgId;

  // Se CAE el enlace Bluetooth entre A y B
  radio.block(nA, nB); await sleep(1500);

  // B LEE con el enlace caído: se dispara el acuse de lectura (como el aviso del notificador al marcar leído). NO se usa
  // openChat para no forzar una reconexión instantánea (en el teléfono real la reconexión BLE tarda y el acuse, que es
  // un paquete de control de un solo intento, se pierde mientras tanto).
  B.win.dispatchEvent(new B.win.CustomEvent('nexo:ble:sendReadReceipt', { detail: { nexoId: idA, msgId: aMsgId } }));
  await sleep(2500);
  r.leido_con_enlace_caido = status(A, 'hola B') === 'read'; // esperado false (el acuse se perdió con el enlace caído)

  // Se restablece el enlace y se reconecta (como resume.js). Al reconectar (peerReady) el acuse de lectura pendiente
  // debe reenviarse.
  radio.unblock(nA, nB);
  [A, B].forEach(function (p) { try { if (p.win.bleInterface.isScanning) p.win.bleInterface.toggleScan(); } catch (e) {} });
  await sleep(300);
  [A, B].forEach(function (p) { try { p.win.bleInterface._startPresenceSearch(60000); p.win.bleInterface._autoScanForKnownContacts(); } catch (e) {} });
  r.reconecta_s = await waitFor(() => biA.linkOf(idB) === 'bluetooth' && B.win.bleInterface.linkOf(idA) === 'bluetooth', 45000);

  // Tras reconectar, A ve «leído» (✓✓ azul = status-read) gracias al reenvío del acuse pendiente
  r.A_ve_leido_tras_reconectar = (await waitFor(() => status(A, 'hola B') === 'read', 25000)) !== null;
  r.estado_final = status(A, 'hola B');

  r.errores = logs.filter((l) => / error: /.test(l) && !/JSDOMERROR|styles\.css|Not implemented/.test(l)).slice(0, 5);
  const ok = r.estado_tras_entregar && (r.estado_tras_entregar === 'delivered' || r.estado_tras_entregar === 'read') &&
    r.reconecta_s !== null && r.A_ve_leido_tras_reconectar && r.errores.length === 0;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('READBT ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_readbt.txt'), logs.join('\n'));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error('FALLO:', e.stack); fs.writeFileSync(path.join(__dirname, 'last_logs_readbt.txt'), logs.join('\n')); process.exit(1); });
