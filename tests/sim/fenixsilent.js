// Diagnósticos automáticos del dueño 13-11 (S24 APK 3032 22:25 y APK 3033 23:14, síntoma «reintentos»): un respaldo Fénix de
// 393 KB al vivo por Wi-Fi local (lan:nx09acdb61) reenviaba la ventana 0 ocho veces (~70 s, 8 × 288 KB) sin un solo trozo
// confirmado, y disparaba el diagnóstico automático. El enlace estaba vivo (un texto por ese Wi-Fi llegó con ✓✓ a los 4 s) pero
// la APP del vivo estaba dormida (el sistema congela NEXO en segundo plano: «oído hace 1105 s»): nadie arma los trozos.
// La regla 2976 solo rendía el respaldo si el Bluetooth estaba MUERTO. Ahora: un respaldo Fénix sin un trozo confirmado en
// 2 ventanas se rinde (queda para más tarde: el custodio se salta un rato) y sin diagnóstico «reintentos». Lo del usuario
// mantiene toda su paciencia (#129).
// Prueba: A y B por Bluetooth; B se congela (no confirma nada) con el enlace VIVO; A manda un respaldo Fénix y un archivo del
// usuario. Contraprueba 3043: 8 reenvíos (~70 s) y síntoma «reintentos».
// Uso: node fenixsilent.js <dir_build>
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
  const r = { prueba: 'fenixsilent', build: path.basename(buildDir) };
  const syms = []; A.win.addEventListener('nexo:diag:symptom', (e) => syms.push(e.detail && e.detail.kind + ' ' + e.detail.info));

  biA.togglePanel(); const paired = await addFound(A, 'B'); biA.togglePanel();
  if (!paired) { console.log('FENIXSILENT ' + JSON.stringify(Object.assign(r, { resultado: 'FALLO', error: 'no empareja' }))); process.exit(1); }
  await openChatWith(A, 'B'); sendText(A, 'hola B'); await sleep(1200);
  await openChatWith(B, 'A'); sendText(B, 'hola A'); await sleep(1200);
  r.emparejados_s = await waitFor(async () => (await B.win.vaultLoadMessages(idA)).some((m) => m.content === 'hola B'), 30000);
  const macB = biA._bleReadyFor(idB) || biA._resolveDeviceIdForNexoId(idB);

  // La APP de B se duerme: no confirma nada; el enlace sigue VIVO (su nativo no lo suelta y A no lo marca muerto)
  const plugB = B.win.Capacitor.Plugins.NexoBLE, oSendB = plugB.sendMessage, oBinB = plugB.sendBinary;
  const swallow = function () { return Promise.resolve({ sent: true }); };
  plugB.sendMessage = swallow; if (oBinB) plugB.sendBinary = swallow;
  nB.setFrozen(true);

  const b64 = 'A'.repeat(60000);
  const t0 = Date.now();
  const pFx = AS.sendFile(macB, 'fxs_prueba_1', b64, { type: 'fenix', fx: 'put' }).then(() => 'ok', (e) => (e && e.code) || String(e && e.message));
  const pUs = AS.sendFile(macB, 'ufile_prueba_1', b64, { type: 'file', to: idB, fileName: 'u.bin' }).then(() => 'ok', (e) => (e && e.code) || String(e && e.message));
  r.fenix_en_vuelo_s = await waitFor(() => AS.outgoingStreams.has('fxs_prueba_1'), 15000);
  r.fenix_se_rinde_s = await waitFor(() => !AS.outgoingStreams.has('fxs_prueba_1'), 45000);  // antes: ~70 s (8 reenvíos)
  r.fenix_resultado = await Promise.race([pFx, sleep(500).then(() => 'en_vuelo')]);
  r.reenvios_fenix = logs.filter((l) => /\[A\].*reenviando ventana.*fxs_prueba_1/.test(l)).length;
  r.enlace_vivo = !biA._bleCongested(macB);
  // El archivo del usuario (en cola detrás) arranca y mantiene su paciencia aunque B siga dormida
  r.usuario_arranca_s = await waitFor(() => AS.outgoingStreams.has('ufile_prueba_1'), 15000);
  await sleep(20000);
  r.usuario_sigue_vivo = AS.outgoingStreams.has('ufile_prueba_1') && !AS.outgoingStreams.get('ufile_prueba_1').aborted;
  r.sintomas = syms.slice(0, 3);
  // B despierta: el archivo del usuario llega
  plugB.sendMessage = oSendB; if (oBinB) plugB.sendBinary = oBinB; nB.setFrozen(false);
  r.usuario_llega_s = await waitFor(async () => (await B.win.vaultLoadMessages(idA)).some((m) => m.attachmentType && !m._own), 90000);

  r.errores = logs.filter((l) => / error: /.test(l) && !/JSDOMERROR|styles\.css|Not implemented|GLOBAL TIMEOUT|net::ERR|fetch/.test(l)).slice(0, 5);
  const ok = r.emparejados_s !== null && r.fenix_en_vuelo_s !== null && r.fenix_se_rinde_s !== null && r.fenix_se_rinde_s <= 30 && r.reenvios_fenix <= 2 &&
    r.fenix_resultado === 'PEER_ABSENT' && r.enlace_vivo && !r.sintomas.some((x) => /fxs_prueba_1/.test(x)) &&
    r.usuario_arranca_s !== null && r.usuario_sigue_vivo && r.usuario_llega_s !== null && !r.errores.length;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('FENIXSILENT ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_fenixsilent.txt'), logs.join('\n'));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('FENIXSILENT ' + JSON.stringify({ prueba: 'fenixsilent', resultado: 'FALLO', error: String(e && e.message).replace(/"/g, "'") })); console.error(e && e.stack); fs.writeFileSync(path.join(__dirname, 'last_logs_fenixsilent.txt'), logs.join('\n')); process.exit(1); });
