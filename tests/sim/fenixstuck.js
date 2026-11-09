// Primer diagnóstico AUTOMÁTICO del dueño (S24, 09-11 16:01 UTC, build 2975): nada más abrir la app, dos respaldos Fénix salían por
// Bluetooth a contactos con MTU 23; el nativo soltó el mensaje («Write fallo para 6a14… durante ~6 s: mensaje descartado entero»,
// «Enlace … atascado: suelto 331 trozos») y avisó (onWriteDropped → marcado muerto), pero el flujo Fénix siguió reenviando la ventana
// cada 8 s (retry 5, 6, 7 × 12 trozos) sobre el enlace muerto: las escrituras «sin respuesta» no fallan en JS, así que nunca pasaba
// por el catch de _sendChunk, el único sitio donde se rendía (2956). 2976: se rinde también al vencer la ventana (_onWindowTimeout).
// Lo del usuario (archivo/foto/texto) NO se toca: mantiene toda su paciencia (#129).
// Prueba determinista: A y B por Bluetooth; A manda un respaldo Fénix y un archivo del usuario a B; B se congela (sin ACKs); el
// nativo de A «suelta» el mensaje (_markBleDead) → el respaldo Fénix se rinde en el siguiente vencimiento (< 12 s) y el archivo del
// usuario sigue vivo. Con la build anterior el respaldo seguía reenviando.
// Uso: node fenixstuck.js <dir_build>
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone, installWebCrypto } = require('./native_mock');

const buildDir = path.resolve(process.argv[2]);
const base = { readsContentFallback: true, retain: ['onPayloadReceived'], closeOnNoService: true, pace: [15, 15], ioDelay: 25, asymmetric: true, noL2: true, noTor: true };
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
async function openChatWith(p, name) {
  let row; for (let i = 0; i < 300 && !row; i++) { row = Array.from(p.win.document.querySelectorAll('#main-contacts-list .ble-contact-row')).find((r) => (r.querySelector('.ble-contact-name') || {}).textContent === name); if (!row) await sleep(100); }
  click(p.win, row); await sleep(400); return !!row;
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

(async () => {
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', Object.assign({}, base)), nB = new NativePhone('B', 'BB:BB:BB:BB:BB:02', Object.assign({}, base));
  [nA, nB].forEach((n) => { radio.add(n); n.load(); });
  const A = await boot('A', nA), B = await boot('B', nB);
  const biA = A.win.bleInterface, AS = biA.ackSystem;
  const idA = biA.localNexoId.toLowerCase(), idB = B.win.bleInterface.localNexoId.toLowerCase();
  const r = { prueba: 'fenixstuck', build: path.basename(buildDir) };

  biA.togglePanel(); const paired = await addFound(A, 'B'); biA.togglePanel();
  if (!paired) { console.log('FENIXSTUCK ' + JSON.stringify(Object.assign(r, { resultado: 'FALLO', error: 'no empareja' }))); process.exit(1); }
  await openChatWith(A, 'B'); sendText(A, 'hola B'); await sleep(1200);
  await openChatWith(B, 'A'); sendText(B, 'hola A'); await sleep(1200);
  r.emparejados_s = await waitFor(async () => (await B.win.vaultLoadMessages(idA)).some((m) => m.content === 'hola B'), 30000);
  const macB = biA._bleReadyFor(idB) || biA._resolveDeviceIdForNexoId(idB);
  r.por_bluetooth = !!macB && !/^(lan|net)/i.test(String(macB));

  // B se congela: no contesta nada (ni ACKs) — como una app congelada en segundo plano
  const plugB = B.win.Capacitor.Plugins.NexoBLE, oSendB = plugB.sendMessage, oBinB = plugB.sendBinary;
  const swallow = function () { return Promise.resolve({ sent: true }); };
  plugB.sendMessage = swallow; if (oBinB) plugB.sendBinary = swallow;
  nB.setFrozen(true);

  // A manda un respaldo Fénix (type 'fenix') y un archivo DEL USUARIO (type 'file') al Bluetooth de B
  const b64 = 'A'.repeat(60000);
  const pFx = AS.sendFile(macB, 'fxs_prueba_1', b64, { type: 'fenix', fx: 'put' }).then(() => 'ok', (e) => (e && e.code) || String(e && e.message));
  const pUs = AS.sendFile(macB, 'ufile_prueba_1', b64, { type: 'file', to: idB, dst: idB, fileName: 'u.bin' }).then(() => 'ok', (e) => (e && e.code) || String(e && e.message));
  // Por un enlace Bluetooth va UN archivo a la vez: el respaldo Fénix sale primero y el del usuario queda EN COLA detrás
  r.flujos_en_vuelo_s = await waitFor(() => AS.outgoingStreams.has('fxs_prueba_1'), 15000);
  r.usuario_en_cola = logs.some((l) => /\[A\].*EN COLA.*ufile_prueba_1/.test(l));
  await sleep(500);

  // El nativo de A «suelta» un mensaje por ese enlace (onWriteDropped) → marcado muerto
  biA._markBleDead(macB);
  r.enlace_marcado_muerto = !!biA._bleCongested(macB);
  const t1 = Date.now();
  r.fenix_se_rinde_s = await waitFor(() => !AS.outgoingStreams.has('fxs_prueba_1'), 15000);      // antes: null (seguía reenviando)
  r.fenix_resultado = await Promise.race([pFx, sleep(500).then(() => 'en_vuelo')]);               // PEER_ABSENT = queda pendiente
  // Al rendirse el respaldo, la cola sigue con el archivo del usuario, que mantiene su paciencia (#129) aunque B siga mudo
  r.usuario_arranca_s = await waitFor(() => AS.outgoingStreams.has('ufile_prueba_1'), 15000);
  await sleep(2000);
  r.usuario_sigue_vivo = AS.outgoingStreams.has('ufile_prueba_1') && !AS.outgoingStreams.get('ufile_prueba_1').aborted;
  r.reenvios_fenix_tras_muerto = logs.filter((l) => /\[A\].*reenviando ventana.*fxs_prueba_1/.test(l) && parseFloat(l) * 1000 >= (t1 - T0)).length; // informativo (0 esperado)

  // B vuelve: el archivo del usuario llega (su paciencia sirvió)
  plugB.sendMessage = oSendB; if (oBinB) plugB.sendBinary = oBinB; nB.setFrozen(false);
  r.usuario_llega_s = await waitFor(async () => (await B.win.vaultLoadMessages(idA)).some((m) => m.attachmentType && !m._own), 90000);

  r.errores = logs.filter((l) => / error: /.test(l) && !/JSDOMERROR|styles\.css|Not implemented|GLOBAL TIMEOUT|net::ERR|fetch/.test(l)).slice(0, 5);
  const ok = r.emparejados_s !== null && r.por_bluetooth && r.flujos_en_vuelo_s !== null && r.enlace_marcado_muerto && r.fenix_se_rinde_s !== null && r.fenix_resultado === 'PEER_ABSENT' &&
    r.usuario_arranca_s !== null && r.usuario_sigue_vivo && r.usuario_llega_s !== null && !r.errores.length;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('FENIXSTUCK ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_fenixstuck.txt'), logs.join('\n'));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('FENIXSTUCK ' + JSON.stringify({ prueba: 'fenixstuck', resultado: 'FALLO', error: String(e && e.message).replace(/"/g, "'") })); console.error(e && e.stack); fs.writeFileSync(path.join(__dirname, 'last_logs_fenixstuck.txt'), logs.join('\n')); process.exit(1); });
