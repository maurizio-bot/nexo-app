// Confirmaciones de lectura ON/OFF (build 2835, pedido del dueño): el ajuste «Confirmaciones de lectura» controla si
// este teléfono MANDA el acuse de lectura (el ✓✓ azul que ve el otro). Apagado → NEXO.sendRead no dispara nada, así que
// el emisor se queda en «entregado» (gris) aunque el otro lea. Encendido → el emisor ve «leído» (azul). El «entregado»
// no se toca en ningún caso. Se prueba sobre la función real NEXO.sendRead (que es la que lleva el candado).
// Uso: node readtoggle.js <dir_build>
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
async function boot(name, native) {
  native.listeners = new Map();
  const vc = new VirtualConsole();
  ['log', 'warn', 'error'].forEach((l) => vc.on(l, (...a) => logs.push(`[${name}] ${l}: ` + a.map(String).join(' ').substring(0, 250))));
  const dom = new JSDOM(fs.readFileSync(path.join(buildDir, 'dist', 'index.html'), 'utf8'), {
    url: 'https://' + name.toLowerCase() + '.nexo.test/index.html', runScripts: 'dangerously',
    resources: new DistLoader(path.join(buildDir, 'dist')), pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) {
      win.CapacitorCustomPlatform = { name: 'android' }; installWebCrypto(win); win.Capacitor = { Plugins: { NexoBLE: native.plugin() } }; win.HTMLElement.prototype.scrollTo = function () {};
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
const msgIdOf = (p, text) => { const el = Array.from(p.win.document.querySelectorAll('#messages-container .message.own')).find((m) => m.textContent.indexOf(text) >= 0); const s = el && el.querySelector('.msg-status'); return s ? s.dataset.msgId : null; };

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
  const idA = A.win.bleInterface.localNexoId.toLowerCase();
  await openChat(A);

  // 1) CON confirmaciones APAGADAS en B: A manda con el chat de B CERRADO; B abre el chat (lo lee de verdad, camino real
  // notify.js → sendRead); con el acuse apagado no debe mandar nada → A se queda en «entregado» (no «leído»).
  try { B.win.localStorage.setItem('nexo_read_receipts', '0'); } catch (e) {}
  r.pref_apagada_en_B = (function () { try { return B.win.localStorage.getItem('nexo_read_receipts'); } catch (e) { return '?'; } })();
  await sendText(A, 'uno');
  await waitFor(() => B.win.vaultLoadContacts().some((c) => String(c.nexoId || c.deviceUUID || '').toLowerCase() === idA), 30000);
  r.entregado_uno = await waitFor(() => { const s = status(A, 'uno'); return s === 'delivered' || s === 'read'; }, 30000);
  await openChat(B); await sleep(500);          // B lee (abre el chat → marca leído)
  await sleep(3000);
  r.A_no_ve_leido_apagado = status(A, 'uno') !== 'read';   // esperado true (sigue «delivered»)
  r.estado_uno = status(A, 'uno');
  try { if (B.win.__nexoHandleBack) B.win.__nexoHandleBack(); } catch (e) {}   // cerrar el chat de B
  await sleep(600);

  // 2) CON confirmaciones ENCENDIDAS en B (lo normal): A manda con el chat cerrado; B abre y lee → A SÍ ve «leído» (azul)
  try { B.win.localStorage.setItem('nexo_read_receipts', '1'); } catch (e) {}
  await sendText(A, 'dos');
  r.entregado_dos = await waitFor(() => { const s = status(A, 'dos'); return s === 'delivered' || s === 'read'; }, 30000);
  await openChat(B);
  r.A_ve_leido_encendido = (await waitFor(() => status(A, 'dos') === 'read', 20000)) !== null;
  r.estado_dos = status(A, 'dos');

  r.errores = logs.filter((l) => / error: /.test(l) && !/JSDOMERROR|styles\.css|Not implemented/.test(l)).slice(0, 5);
  const ok = r.pref_apagada_en_B === '0' && r.entregado_uno !== null && r.A_no_ve_leido_apagado === true &&
    r.entregado_dos !== null && r.A_ve_leido_encendido === true && r.errores.length === 0;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('READTOGGLE ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_readtoggle.txt'), logs.join('\n'));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error('FALLO:', e.stack); fs.writeFileSync(path.join(__dirname, 'last_logs_readtoggle.txt'), logs.join('\n')); process.exit(1); });
