// #dueño 07-11 (diagnóstico «se tarda en enviar audios/archivos… queda en °», panel Rendimiento «Contactos en línea: 0»,
// «2 de 7 entregados»): un AUDIO/ARCHIVO a un contacto que no está disponible por ningún camino queda guardado y se
// entrega al reconectar (store-and-forward, ya probado en fileabsent.js) — PERO la burbuja se quedaba en ○ (enviando)
// porque el estado 'pending' («esperando») no tenía dibujo y, por rango (pending=1 < sending=3), _updateMessageStatus lo
// BLOQUEABA. El dueño lo leía como «clavado». Arreglo (build 2940): 'pending' ahora tiene reloj de espera ⏳ y puede
// reemplazar a sending/queued (nunca a sent/delivered/read); y _onWindowTimeout, con el contacto de internet AUSENTE,
// marca 'pending' PRONTO (no a los 10 min del tope global). Esta prueba comprueba las dos cosas de forma determinista.
// Uso: node netwait.js <dir_build>
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone } = require('./native_mock');

const buildDir = path.resolve(process.argv[2] || path.join(__dirname, 'builds/wip'));
const WAIT_GLYPH = '⏳'; // ⏳ reloj de arena = «esperando» (store-and-forward)
const opts = { readsContentFallback: true, retain: ['onPayloadReceived', 'onLanMessage', 'onLanUp', 'onLanDown'], closeOnNoService: true, pace: [15, 15], ioDelay: 25, asymmetric: true, noL2: true };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
class DL extends ResourceLoader { constructor(d) { super(); this.d = d; } fetch(u) { const f = path.join(this.d, decodeURIComponent(new URL(u).pathname)); return fs.existsSync(f) ? Promise.resolve(fs.readFileSync(f)) : Promise.reject(new Error('x')); } }
const logs = [];
async function boot(name, native) {
  const vc = new VirtualConsole();
  ['log', 'warn', 'error'].forEach((l) => vc.on(l, (...a) => logs.push(`${new Date().toISOString().substring(14, 23)} [${name}] ${l}: ` + a.map(String).join(' ').substring(0, 250))));
  const dom = new JSDOM(fs.readFileSync(path.join(buildDir, 'dist', 'index.html'), 'utf8'), {
    url: 'https://' + name.toLowerCase() + '.nexo.test/index.html', runScripts: 'dangerously', resources: new DL(path.join(buildDir, 'dist')), pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) { win.CapacitorCustomPlatform = { name: 'android' }; require('./native_mock').installWebCrypto(win); win.Capacitor = { Plugins: { NexoBLE: native.plugin() } }; win.HTMLElement.prototype.scrollTo = function () {}; },
  });
  const win = dom.window;
  for (let i = 0; i < 100 && !(win.NEXO && win.NEXO.initialized); i++) await sleep(100);
  await sleep(800);
  return { name, native, win };
}
const click = (w, el) => el && el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
const rnd = (n, s) => { const b = Buffer.alloc(n); for (let i = 0; i < n; i++) b[i] = (i * 7919 + s) & 255; return b; };
async function openChatWith(p, name) {
  let row; for (let i = 0; i < 300 && !row; i++) { row = Array.from(p.win.document.querySelectorAll('#main-contacts-list .ble-contact-row')).find((r) => (r.querySelector('.ble-contact-name') || {}).textContent === name); if (!row) await sleep(100); }
  click(p.win, row); await sleep(400); return !!row;
}
function sendFile(p, name, type, bytes) {
  click(p.win, p.win.document.querySelector('.attach-menu-item[data-type="file"]'));
  const fin = Array.from(p.win.document.querySelectorAll('input[type=file]')).pop();
  Object.defineProperty(fin, 'files', { value: [new p.win.File([bytes], name, { type })], configurable: true }); fin.dispatchEvent(new p.win.Event('change'));
}
// Crea una burbuja propia de verdad en el DOM, con su .msg-status (como las que pinta _renderMessage)
function makeBubble(win, msgId, statusClass, glyph) {
  const d = win.document.createElement('div'); d.className = 'message own status-' + statusClass;
  const meta = win.document.createElement('div'); meta.className = 'msg-meta';
  const st = win.document.createElement('span'); st.className = 'msg-status status-' + statusClass; st.setAttribute('data-msg-id', msgId); st.textContent = glyph;
  meta.appendChild(st); d.appendChild(meta); (win.document.getElementById('messages') || win.document.body).appendChild(d);
  return st;
}
const statusOf = (el) => { const m = (el.className || '').match(/status-(pending|queued|sending|sent|delivered|read|failed)/); return m ? m[1] : null; };

(async () => {
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', Object.assign({}, opts, { wifi: 'casa' })), nB = new NativePhone('B', 'BB:BB:BB:BB:BB:02', Object.assign({}, opts, { wifi: 'casa' }));
  [nA, nB].forEach((n) => { radio.add(n); n.load(); });
  const [A, B] = await Promise.all([boot('A', nA), boot('B', nB)]);
  const biA = A.win.bleInterface, idB = B.win.bleInterface.localNexoId.toLowerCase();
  const r = { build: path.basename(buildDir) };

  // ---------- Parte 1 (UI, determinista): el evento real ackStatus con 'pending' se VE en la burbuja ----------
  // Antes: pending (rango 1) no podía reemplazar a sending (rango 3) y no tenía dibujo → la burbuja seguía en ○.
  const stSend = makeBubble(A.win, 'mNW1', 'sending', '○'); // ○
  A.win.dispatchEvent(new A.win.CustomEvent('nexo:ble:ackStatus', { detail: { msgId: 'mNW1', status: 'pending' } }));
  await sleep(50);
  r.pending_visible = statusOf(stSend) === 'pending' && stSend.textContent === WAIT_GLYPH;

  // Seguridad: 'pending' NO debe degradar una burbuja ya entregada (✓✓) ni enviada (✓)
  const stDeliv = makeBubble(A.win, 'mNW2', 'delivered', '✓✓'); // ✓✓
  A.win.dispatchEvent(new A.win.CustomEvent('nexo:ble:ackStatus', { detail: { msgId: 'mNW2', status: 'pending' } }));
  await sleep(50);
  r.pending_no_degrada_entregado = statusOf(stDeliv) === 'delivered' && stDeliv.textContent === '✓✓';
  const stSent = makeBubble(A.win, 'mNW3', 'sent', '✓'); // ✓
  A.win.dispatchEvent(new A.win.CustomEvent('nexo:ble:ackStatus', { detail: { msgId: 'mNW3', status: 'pending' } }));
  await sleep(50);
  r.pending_no_degrada_enviado = statusOf(stSent) === 'sent' && stSent.textContent === '✓';

  // ---------- Parte 2 (integración): con el contacto de internet AUSENTE, _onWindowTimeout marca 'pending' PRONTO ----------
  // A agrega a B y se conectan (igual que fileabsent.js), se manda un archivo y se coge el ChatStream real.
  biA.togglePanel(); let add = null;
  for (let i = 0; i < 400 && !add; i++) { await sleep(100); add = A.win.document.querySelector('#ble-new-device > div button'); if (!add && !biA.isScanning) click(A.win, A.win.document.getElementById('ble-scan-btn')); }
  click(A.win, add); await sleep(1500);
  if (A.win.document.getElementById('ble-panel').classList.contains('active')) biA.togglePanel();
  await openChatWith(A, 'B');

  sendFile(A, 'nota.m4a', 'audio/mp4', rnd(400 * 1024, 9));
  let st = null;
  for (let i = 0; i < 200 && !st; i++) {
    await sleep(20);
    (biA.ackSystem.outgoingStreams || new Map()).forEach((s) => { if (!st && s && s.type === 'file') st = s; });
    if (st) { nB.setOffline(true); try { clearTimeout(st.timer); } catch (e) {} try { clearTimeout(st.globalTimeout); } catch (e) {} st._sendChunk = function () { return Promise.resolve(); }; }
  }
  r.hay_stream = !!st;
  if (!st) { console.log('NETWAIT ' + JSON.stringify(Object.assign(r, { resultado: 'FALLO', why: 'no stream' }))); process.exit(1); }
  try { clearTimeout(st.timer); } catch (e) {} try { clearTimeout(st.globalTimeout); } catch (e) {}

  // Contacto de internet AUSENTE: _linkUp() falso (sigue canReach), como en la vida real cuando el otro está apagado.
  st.deviceId = 'net:' + idB;
  const net = biA.net || {};
  const canReachSave = net.canReach, onlineSave = net.online;
  net.online = function () { return true; };      // yo SÍ tengo internet
  net.canReach = function () { return false; };    // el contacto NO está en línea

  // Capturar los estados que se despachan para ESTE msgId y evitar temporizadores colgando.
  const statuses = [];
  const dispSave = biA.ackSystem._dispatchStatus.bind(biA.ackSystem);
  biA.ackSystem._dispatchStatus = function (mid, s) { if (mid === st.msgId) statuses.push(s); return dispSave(mid, s); };
  st._startWindowTimer = function () {}; // no re-armar (determinista)
  st._windowReject = function () {};
  st._windowStartAtSend = 0; st._windowEndAtSend = Math.max(1, Math.min(st.windowSize || 1, st.total || 1)); st.ackedMask = []; st.windowRetryCount = 0; st.aborted = false;

  // Una caducidad de ventana con el enlace (internet) caído → NO aborta, NO gasta reintento y marca 'pending' PRONTO.
  st._onWindowTimeout();
  biA.ackSystem._dispatchStatus = dispSave;
  net.canReach = canReachSave; net.online = onlineSave;
  r.ausente_no_aborta = !st.aborted && st.windowRetryCount === 0;
  r.pending_pronto = statuses.indexOf('pending') >= 0;   // antes: nunca (solo el tope global a los 10 min)
  r.sin_failed = statuses.indexOf('failed') < 0;
  // El mensaje sigue siendo re-enviable (store-and-forward): el helper lo confirma.
  try { r.resendable_pending = A.win.NEXO && A.win.NEXO._isResendable ? A.win.NEXO._isResendable({ _own: true, status: 'pending' }) === true : true; } catch (e) { r.resendable_pending = true; }

  r.errores = logs.filter((l) => / error: /.test(l) && !/JSDOMERROR|styles\.css|Not implemented|GLOBAL TIMEOUT/.test(l)).slice(0, 5);
  const ok = r.pending_visible && r.pending_no_degrada_entregado && r.pending_no_degrada_enviado &&
    r.hay_stream && r.ausente_no_aborta && r.pending_pronto && r.sin_failed && r.errores.length === 0;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('NETWAIT ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_netwait.txt'), logs.join('\n'));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error('NETWAIT FALLO:', e && e.stack); try { fs.writeFileSync(path.join(__dirname, 'last_logs_netwait.txt'), logs.join('\n')); } catch (x) {} process.exit(1); });
