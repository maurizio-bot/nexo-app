// 3026 (diagnósticos del S24 12-11, 17:57 y 10:26-10:35 hora local): el MISMO segmento Fénix salía 2-4 veces seguidas al mismo
// contacto (fxs_<seg>_63bd, _8e40, _83f7, _616b; y 808 KB ×2 al A55 de Marcos, «EN COLA (enlace Bluetooth ocupado)»). Causa: cada
// intento Fénix que fallaba («queda pendiente») quedaba GUARDADO como transferencia saliente y resumeOutgoingTransfers lo reenviaba
// por su cuenta, mientras Fénix lo reintentaba con otro id → copias en paralelo que saturan la radio. Arreglo: Fénix no se guarda
// para reanudar (reintenta solo, con espera y redundancia) y los registros Fénix viejos se borran al reanudar sin reenviarlos.
// Prueba: A y B por Bluetooth; B congelado; el respaldo se rinde → NO queda registro; un registro Fénix viejo se borra sin salir.
// Uso: node fenixdup.js <dir_build>
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
  const r = { prueba: 'fenixdup', build: path.basename(buildDir) };

  biA.togglePanel(); const paired = await addFound(A, 'B'); biA.togglePanel();
  if (!paired) { console.log('FENIXDUP ' + JSON.stringify(Object.assign(r, { resultado: 'FALLO', error: 'no empareja' }))); process.exit(1); }
  await openChatWith(A, 'B'); sendText(A, 'hola B'); await sleep(1200);
  r.emparejados_s = await waitFor(async () => (await B.win.vaultLoadMessages(idA)).some((m) => m.content === 'hola B'), 30000);
  const macB = biA._bleReadyFor(idB) || biA._resolveDeviceIdForNexoId(idB);
  r.por_bluetooth = !!macB && !/^(lan|net)/i.test(String(macB));
  const pend = async () => ((await A.win.vaultGetPendingOutgoingTransfers(idB)) || []).map((t) => t.transferId);

  // 1) B se congela; A manda un respaldo Fénix; el enlace muere → el respaldo se rinde (PEER_ABSENT)
  const plugB = B.win.Capacitor.Plugins.NexoBLE, oSendB = plugB.sendMessage, oBinB = plugB.sendBinary;
  const swallow = function () { return Promise.resolve({ sent: true }); };
  plugB.sendMessage = swallow; if (oBinB) plugB.sendBinary = swallow;
  nB.setFrozen(true);
  const pFx = AS.sendFile(macB, 'fxs_prueba_1', 'A'.repeat(60000), { type: 'fenix', fx: 'put' }).then(() => 'ok', (e) => (e && e.code) || String(e && e.message));
  r.en_vuelo_s = await waitFor(() => AS.outgoingStreams.has('fxs_prueba_1'), 15000);
  await sleep(500);
  biA._markBleDead(macB);
  r.se_rinde_s = await waitFor(() => !AS.outgoingStreams.has('fxs_prueba_1'), 15000);
  r.resultado_envio = await Promise.race([pFx, sleep(500).then(() => 'en_vuelo')]);
  await sleep(500);
  // 3026: el respaldo fallido NO queda guardado para reanudar (contraprueba 3025: queda y se reenvía aparte de Fénix)
  r.no_guardado = !(await pend()).includes('fxs_prueba_1');

  // 2) un registro Fénix de una build anterior se borra al reanudar, sin reenviarlo
  await A.win.vaultCreateOutgoingTransfer(idB, 'fxs_viejo_1', 'file', 1, ['QUFB'], { type: 'fenix', fx: 'put' }, macB);
  r.viejo_creado = (await pend()).includes('fxs_viejo_1');
  plugB.sendMessage = oSendB; if (oBinB) plugB.sendBinary = oBinB; nB.setFrozen(false);
  if (biA._bleDead) biA._bleDead.clear && biA._bleDead.clear();
  const L0 = logs.length;
  AS._resumeScanAt = 0; AS.resumeOutgoingTransfers();
  await sleep(6000);
  const nuevos = logs.slice(L0);
  r.reanuda_fenix = nuevos.filter((l) => /\[A\].*sendFile START fileId=fxs_(prueba|viejo)_1/.test(l)).length; // 0 esperado
  r.viejo_borrado = !(await pend()).includes('fxs_viejo_1');

  r.errores = logs.filter((l) => / error: /.test(l) && !/JSDOMERROR|styles\.css|Not implemented|GLOBAL TIMEOUT|net::ERR|fetch/.test(l)).slice(0, 5);
  const ok = r.emparejados_s !== null && r.por_bluetooth && r.en_vuelo_s !== null && r.se_rinde_s !== null && r.resultado_envio === 'PEER_ABSENT' &&
    r.no_guardado && r.viejo_creado && r.reanuda_fenix === 0 && r.viejo_borrado && !r.errores.length;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('FENIXDUP ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_fenixdup.txt'), logs.join('\n'));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('FENIXDUP ' + JSON.stringify({ prueba: 'fenixdup', resultado: 'FALLO', error: String(e && e.message).replace(/"/g, "'") })); console.error(e && e.stack); fs.writeFileSync(path.join(__dirname, 'last_logs_fenixdup.txt'), logs.join('\n')); process.exit(1); });
