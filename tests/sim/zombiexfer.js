// Diagnóstico del dueño (S24, 09-11 12:15 UTC): la tablet seguía CONECTADA por Bluetooth pero no contestaba nada (enlace
// zombi: las escrituras GATT «salen» —NO_RESPONSE— y no vuelve ni un ACK) mientras había transferencias en curso (foto de
// grupo de 267 trozos, segmentos de Fénix). El vigilante del enlace saltaba SIEMPRE el ping/zombie por «transferencia
// activa», así que el enlace muerto nunca se detectaba ni se rehacía: cada pendiente se arrastraba 8 reintentos de ventana
// sobre él y, al abortar, arrancaba el siguiente sobre el mismo enlace muerto, para siempre («Max window retries» en bucle).
// Arreglo (ble_ack.hasActiveTransfer): un flujo saliente que lleva > 20 s sin NINGÚN ACK ya no cuenta como «transferencia
// activa» para proteger el enlace → el vigilante pinga, y sin pong el enlace se da por zombi y se rehace (como siempre).
// Prueba (2 teléfonos reales en jsdom, solo Bluetooth):
//   (0) control: un archivo de 150 KB con B sano llega entero y el vigilante NO corta nada (una transferencia sana sigue protegida).
//   (1) otro archivo igual; en cuanto fluye el primer ACK, B se CONGELA (app suspendida: su nativo acepta las escrituras,
//       su JS no procesa nada y nada sale de él). A debe detectar el zombi («sin respuesta a 2 pings: desconectado para
//       reconectar») en < 90 s (medido: ~70 s = 20 s de atasco + 4 pings sin pong a 8 s con el ciclo de 6 s del vigilante).
//       Antes: NUNCA (110 s medidos): «skip ping/zombie» cada 6 s, 8 reintentos, abort, el pendiente re-arranca sobre el mismo enlace.
//   (2) B vuelve: el archivo termina de llegar por el enlace rehecho (reanudación), sin intervención.
// Uso: node zombiexfer.js <dir_build>
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
async function boot(name, native) {
  const vc = new VirtualConsole();
  ['log', 'warn', 'error'].forEach((l) => vc.on(l, (...a) => logs.push(`${ts()} [${name}] ${l}: ` + a.map(String).join(' ').substring(0, 250))));
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
const rnd = (n, s) => { const b = Buffer.alloc(n); for (let i = 0; i < n; i++) b[i] = (i * 7919 + s) & 255; return b; };
async function openChatWith(p, name) {
  let row; for (let i = 0; i < 300 && !row; i++) { row = Array.from(p.win.document.querySelectorAll('#main-contacts-list .ble-contact-row')).find((r) => (r.querySelector('.ble-contact-name') || {}).textContent === name); if (!row) await sleep(100); }
  click(p.win, row); await sleep(400); return !!row;
}
async function sendFile(p, name, type, bytes) {
  click(p.win, p.win.document.querySelector('.attach-menu-item[data-type="file"]')); await sleep(100);
  const fin = Array.from(p.win.document.querySelectorAll('input[type=file]')).pop();
  Object.defineProperty(fin, 'files', { configurable: true, value: [new p.win.File([bytes], name, { type })] }); fin.dispatchEvent(new p.win.Event('change'));
}
async function waitFor(fn, ms) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return Math.round((Date.now() - t0) / 100) / 10; await sleep(200); } return null; }
// ¿tiene B el archivo entero? (el historial puede guardar el adjunto aparte: attachmentRef)
async function hasFile(p, from, b64) {
  const list = await p.win.vaultLoadMessages(from);
  return list.some((m) => !m._own && m.attachmentType && !m.deleted && (m.attachmentPayload || p.native.files.get(m.attachmentRef)) === b64);
}
const cortes = (mac) => logs.filter((l) => /\[A\].*sin respuesta a 2 pings: desconectado para reconectar/.test(l) && (!mac || l.indexOf(mac) >= 0 || /\[A\].*Enlace [^ ]+ sin respuesta/.test(l))).length;

(async () => {
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', opts), nB = new NativePhone('B', 'BB:BB:BB:BB:BB:02', opts);
  [nA, nB].forEach((n) => { radio.add(n); n.load(); });
  const [A, B] = await Promise.all([boot('A', nA), boot('B', nB)]);
  const biA = A.win.bleInterface, idA = biA.localNexoId.toLowerCase(), idB = B.win.bleInterface.localNexoId.toLowerCase();
  const r = { prueba: 'zombiexfer', build: path.basename(buildDir) };

  // A agrega a B por Bluetooth y fija la sesión con un texto
  biA.togglePanel(); let add = null;
  for (let i = 0; i < 400 && !add; i++) { await sleep(100); add = A.win.document.querySelector('#ble-new-device > div button'); if (!add && !biA.isScanning) click(A.win, A.win.document.getElementById('ble-scan-btn')); }
  if (!add) { console.log('ZOMBIEXFER ' + JSON.stringify({ prueba: 'zombiexfer', resultado: 'FALLO', error: 'no empareja' })); process.exit(1); }
  click(A.win, add); await sleep(1500);
  if (A.win.document.getElementById('ble-panel').classList.contains('active')) biA.togglePanel();
  await openChatWith(A, 'B');
  const inp = A.win.document.getElementById('message-input'); inp.value = 'hola B'; inp.dispatchEvent(new A.win.Event('input', { bubbles: true })); click(A.win, A.win.document.getElementById('send-btn'));
  r.emparejados_s = await waitFor(async () => (await B.win.vaultLoadMessages(idA)).some((m) => m.content === 'hola B'), 30000);
  r.enlace_bt = !!biA._bleReadyFor(idB);

  // ===== (0) control: archivo de 150 KB con B sano → llega, y el vigilante no corta nada =====
  const f0 = rnd(150 * 1024, 3), b0 = f0.toString('base64');
  const cortes0 = cortes();
  await sendFile(A, 'control.bin', 'application/octet-stream', f0);
  r.control_llega_s = await waitFor(() => hasFile(B, idA, b0), 60000);
  r.control_sin_cortes = cortes() === cortes0;
  await sleep(1500);

  // ===== (1) archivo igual; al primer ACK B se CONGELA (zombi: el nativo acepta, el JS no contesta) =====
  const f1 = rnd(150 * 1024, 11), b1 = f1.toString('base64');
  await sendFile(A, 'zombi.bin', 'application/octet-stream', f1);
  let st = null;
  for (let i = 0; i < 300 && !(st && st.windowStart > 0); i++) {
    await sleep(50);
    (biA.ackSystem.outgoingStreams || new Map()).forEach((s) => { if (s && s.type === 'file' && !s.aborted && !/^(lan|net)/.test(String(s.deviceId))) st = s; });
  }
  r.flujo_arranco = !!(st && st.windowStart > 0);
  const macB = st && st.deviceId;
  const cortes1 = cortes();
  const skipsAt = () => logs.filter((l) => /\[A\].*Supervisor: transferencia activa, skip ping\/zombie/.test(l)).length;
  const sk0 = skipsAt();
  // Zombi de verdad: la app de B queda SUSPENDIDA — su JS no procesa lo que llega (cola del nativo) y NADA sale de él (sus
  // escrituras se «tragan» con éxito, como un nativo que sigue aceptando GATT con la app congelada). En jsdom los
  // temporizadores de B siguen corriendo (en el teléfono también se pararían): si no se silencian sus envíos, B seguiría
  // mandando sus pings y A lo daría por vivo (_prePayload: «cualquier cosa que llega prueba que está vivo»).
  const plugB = B.win.Capacitor.Plugins.NexoBLE, oSendB = plugB.sendMessage, oBinB = plugB.sendBinary;
  const swallow = () => Promise.resolve({ success: true });
  plugB.sendMessage = swallow; if (oBinB) plugB.sendBinary = swallow;
  nB.setFrozen(true); const tFreeze = Date.now();
  r.zombi_detectado_s = await waitFor(() => cortes() > cortes1, 110000);
  if (r.zombi_detectado_s !== null) r.zombi_detectado_s = Math.round((Date.now() - tFreeze) / 100) / 10;
  // cuánto tardó el vigilante en dejar de «proteger» el enlace atascado (informativo)
  r.skips_proteccion = skipsAt() - sk0; // informativo: cuántos ciclos del vigilante siguió «protegiendo» el enlace atascado (con el arreglo: los ~20 s iniciales)
  r.reintentos_ventana_al_detectar = st ? st.windowRetryCount : null; // informativo: cuántos reintentos de ventana (de 8) llevaba el flujo atascado al detectarse el zombi

  // ===== (2) B vuelve: el archivo termina de llegar por el enlace rehecho =====
  await sleep(2000);
  plugB.sendMessage = oSendB; if (oBinB) plugB.sendBinary = oBinB;
  nB.setFrozen(false);
  r.archivo_llega_tras_volver_s = await waitFor(() => hasFile(B, idA, b1), 150000);
  r.estado_final_A = (() => { const list = Array.from(A.win.document.querySelectorAll('.msg-status')); const s = list[list.length - 1]; const m = s && (s.className || '').match(/status-([a-z]+)/); return m ? m[1] : null; })();

  r.errores = logs.filter((l) => / error: /.test(l) && !/JSDOMERROR|styles\.css|Not implemented|GLOBAL TIMEOUT|Assembly timeout|net::ERR|fetch/.test(l)).slice(0, 5);
  const ok = typeof r.emparejados_s === 'number' && r.enlace_bt && typeof r.control_llega_s === 'number' && r.control_sin_cortes && r.flujo_arranco &&
    typeof r.zombi_detectado_s === 'number' && r.zombi_detectado_s < 90 && typeof r.archivo_llega_tras_volver_s === 'number' && !r.errores.length;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('ZOMBIEXFER ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_zombiexfer.txt'), logs.join('\n'));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('ZOMBIEXFER ' + JSON.stringify({ prueba: 'zombiexfer', resultado: 'FALLO', error: String(e && e.message).replace(/"/g, "'") })); console.error(e && e.stack); fs.writeFileSync(path.join(__dirname, 'last_logs_zombiexfer.txt'), logs.join('\n')); process.exit(1); });
