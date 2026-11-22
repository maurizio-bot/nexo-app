// COLA 35 — la línea de tiempo del diagnóstico («Mensajes propios recientes») debe traer el contacto del PROPIO mensaje aunque
// salga SIN camino (antes «→ ?»). A y B se emparejan; luego B queda fuera de alcance y A le manda un texto: sin enlace no hay
// deviceId en pendingAcks, y el destinatario ha de salir igual (tomado del chat que lo envió).
// Uso: node diagplus.js <dir_build>
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone, installWebCrypto } = require('./native_mock');

const buildDir = path.resolve(process.argv[2]);
const opts = { readsContentFallback: true, retain: ['onPayloadReceived', 'onLanMessage', 'onLanUp', 'onLanDown'], closeOnNoService: true, pace: [15, 15], ioDelay: 25, asymmetric: true, noL2: true };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
class DL extends ResourceLoader { constructor(d) { super(); this.d = d; } fetch(u) { const f = path.join(this.d, decodeURIComponent(new URL(u).pathname)); return fs.existsSync(f) ? Promise.resolve(fs.readFileSync(f)) : Promise.reject(new Error('x')); } }
const logs = [];
const T0 = Date.now();
const ts = () => String(((Date.now() - T0) / 1000).toFixed(1)).padStart(6) + 's';
async function boot(name, native, knobs) {
  const vc = new VirtualConsole();
  ['log', 'warn', 'error'].forEach((l) => vc.on(l, (...a) => logs.push(`${ts()} [${name}] ${l}: ` + a.map(String).join(' ').substring(0, 250))));
  const dom = new JSDOM(fs.readFileSync(path.join(buildDir, 'dist', 'index.html'), 'utf8'), {
    url: 'https://' + name.toLowerCase() + '.nexo.test/index.html', runScripts: 'dangerously', resources: new DL(path.join(buildDir, 'dist')), pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) { win.CapacitorCustomPlatform = { name: 'android' }; installWebCrypto(win); win.Capacitor = { Plugins: { NexoBLE: native.plugin() } }; win.HTMLElement.prototype.scrollTo = function () {}; Object.assign(win, knobs || {}); },
  });
  const win = dom.window;
  for (let i = 0; i < 100 && !(win.NEXO && win.NEXO.initialized); i++) await sleep(100);
  await sleep(800);
  return { name, native, win };
}
const click = (w, el) => el && el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
async function openChatWith(p, name) {
  let row; for (let i = 0; i < 300 && !row; i++) { row = Array.from(p.win.document.querySelectorAll('#main-contacts-list .ble-contact-row')).find((r) => (r.querySelector('.ble-contact-name') || {}).textContent === name); if (!row) await sleep(100); }
  click(p.win, row); await sleep(400); return !!row;
}
function sendText(p, t) { const i = p.win.document.getElementById('message-input'); i.value = t; i.dispatchEvent(new p.win.Event('input', { bubbles: true })); click(p.win, p.win.document.getElementById('send-btn')); }
async function waitFor(fn, ms) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return Math.round((Date.now() - t0) / 100) / 10; await sleep(200); } return null; }
const visibles = async (p, from) => (await p.win.vaultLoadMessages(from)).filter((m) => !m.hidden && !m.deleted).length;
const ocultos = async (p, from) => (await p.win.vaultLoadMessages(from)).filter((m) => m.hidden).length;

(async () => {
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', opts), nB = new NativePhone('B', 'BB:BB:BB:BB:BB:02', opts);
  [nA, nB].forEach((n) => { radio.add(n); n.load(); });
  const [A, B] = await Promise.all([boot('A', nA, {}), boot('B', nB, {})]);
  const biA = A.win.bleInterface, idB = B.win.bleInterface.localNexoId.toLowerCase(), idA = biA.localNexoId.toLowerCase();
  const r = { prueba: 'diag_sinruta', build: path.basename(buildDir) };
  biA.togglePanel(); let add = null;
  for (let i = 0; i < 400 && !add; i++) { await sleep(100); add = A.win.document.querySelector('#ble-new-device > div button'); if (!add && !biA.isScanning) click(A.win, A.win.document.getElementById('ble-scan-btn')); }
  if (!add) { console.log('DIAG_SINRUTA ' + JSON.stringify({ resultado: 'FALLO', error: 'no empareja' })); process.exit(1); }
  click(A.win, add); await sleep(1500);
  if (A.win.document.getElementById('ble-panel').classList.contains('active')) biA.togglePanel();
  await openChatWith(A, 'B'); sendText(A, 'hola B');
  r.emparejados_s = await waitFor(async () => (await B.win.vaultLoadMessages(idA)).some((m) => m.content === 'hola B'), 30000);
  // B fuera de alcance: el siguiente texto sale sin camino
  radio.block(nA, nB); await sleep(1500);
  sendText(A, 'sin camino');
  const own = await (async () => { let m = null; await waitFor(async () => { m = (await A.win.vaultLoadMessages(idB)).find((x) => x._own && x.content === 'sin camino'); return !!m; }, 8000); return m; })();
  r.mensaje_guardado = !!own;
  // sin enlace: el estado llega sin entrada en pendingAcks (como un archivo grande en espera o un texto sin ruta)
  if (own) { biA.ackSystem.pendingAcks.delete(own.messageId); A.win.dispatchEvent(new A.win.CustomEvent('nexo:ble:ackStatus', { detail: { msgId: own.messageId, status: 'pending' } })); }
  await sleep(1500);
  let txt = ''; try { txt = String(await A.win.NEXO_diagText()); } catch (e) {}
  const filas = txt.split('\n').filter((l) => own && l.indexOf(String(own.messageId).slice(-8) + ' → ') >= 0);
  r.todo = txt.split('\n').filter((l) => /→/.test(l) && /camino al mandar/.test(l)).join(' // ').slice(0, 600); r.mid = own && String(own.messageId);
  r.fila = (filas[0] || '').slice(0, 200);
  r.hay_fila = filas.length > 0;
  r.sin_interrogante = r.hay_fila && !/ → \? /.test(filas[0]) && filas[0].indexOf('…' + idB.slice(-4)) >= 0;
  r.resultado = r.mensaje_guardado && r.sin_interrogante ? 'OK' : 'FALLO';
  console.log('DIAG_SINRUTA ' + JSON.stringify(r));
  if (r.resultado !== 'OK') console.log(logs.filter((l) => /\[A\]/.test(l)).slice(-15).join('\n'));
  process.exit(r.resultado === 'OK' ? 0 : 1);
})();
