// 3210 (dueño 17-11: «quiero saber por qué a Marcos le llegan notificaciones mías si yo no le mandé nada»; diagnóstico de Marcos 16:13:
// «[BT_CERRADA] llega por Bluetooth: NOTIFY_ONLY de nx1n36c283 (msgId fxs_smwf3nk6hf7b7f7_1664)» y luego «Aviso de mensaje tocado: abre el
// chat nx1n36c283»). El teléfono del dueño le guarda a Marcos, en segundo plano, fragmentos de su copia de respaldo (Fénix: «fxs_…») y
// le pasa los medios de sus estados («stm…»). Con la app abierta van ocultos, pero con la app CERRADA (o dormida) la parte nativa
// (BgInbox.classify) veía el primer trozo de un archivo (t:'f', i:0) y avisaba «📎 Archivo» del dueño. Por internet, lo mismo: el
// sobre llevaba la marca de mensaje nuevo (n) y la escucha nativa (NetBg) avisaba. Ahora esos envíos ocultos llevan la marca de
// callado (q:1) en su primer trozo y no llevan la de mensaje nuevo.
// A y B por Bluetooth; la app de B se CIERRA (el Bluetooth sigue recibiendo): A le manda un fragmento de respaldo, el medio de un
// estado y, de control, un texto. Debe avisar solo el texto. Por internet: el sobre del respaldo no lleva marca de mensaje nuevo.
// Contraprueba b3205: «📎 Archivo» de A por el respaldo y por el estado.
// Uso: node avisofenix.js <dir_build>
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
  let row; for (let i = 0; i < 300 && !row; i++) { row = Array.from(p.win.document.querySelectorAll('#main-contacts-list .ble-contact-row')).find((r) => [].concat(name).indexOf((r.querySelector('.ble-contact-name') || {}).textContent) >= 0); if (!row) await sleep(100); }
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
  const r = { prueba: 'avisofenix', build: path.basename(buildDir) };
  biA.togglePanel(); const paired = await addFound(A, 'B'); biA.togglePanel();
  if (!paired) { console.log('AVISOFENIX ' + JSON.stringify(Object.assign(r, { resultado: 'FALLO', error: 'no empareja' }))); process.exit(1); }
  await openChatWith(A, ['B', 'A']); sendText(A, 'hola B'); await sleep(1200);
  r.emparejados_s = await waitFor(async () => (await B.win.vaultLoadMessages(idA)).some((m) => m.content === 'hola B'), 30000);
  const macB = biA._bleReadyFor(idB) || biA._resolveDeviceIdForNexoId(idB);
  // La app de B se cierra: su Bluetooth sigue recibiendo (modo cerrado) y la parte nativa decide qué avisa
  B.win.close(); nB.destroyActivity(); await sleep(1500);
  const avisosDeA = () => { const n = nB.notifications && nB.notifications.get(idA); return n ? Array.from(n.ids) : []; };
  // Lo que A manda por Bluetooth: se guarda el primer trozo del respaldo (el mismo sobre que iría por internet)
  let chunk0 = null;
  const plugA = A.win.Capacitor.Plugins.NexoBLE, oSendA = plugA.sendMessage;
  plugA.sendMessage = function (o) { try { const m = String((o && (o.message || o.content)) || ''); if (!chunk0 && m.indexOf('"m":"fxs_prueba_7f2a"') >= 0 && /"i":0[,}]/.test(m)) chunk0 = m; } catch (e) {} return oSendA.apply(this, arguments); };
  const b64 = 'A'.repeat(3000);
  AS.sendFile(macB, 'fxs_prueba_7f2a', b64, { type: 'fenix', fx: 'put' }).catch(() => {});
  await sleep(4000);
  AS.sendFile(macB, 'stmprueba' + Date.now().toString(36), b64, { type: 'stmedia', sid: 'st1', name: 'st:st1', mime: 'image/jpeg', to: idB }).catch(() => {});
  await sleep(4000);
  r.avisos_por_respaldo_y_estado = avisosDeA().filter((id) => /^(fxs_|stm)/.test(id));
  // Control: un texto de verdad SÍ avisa con la app cerrada
  sendText(A, 'hola con la app cerrada');
  r.texto_avisa_s = await waitFor(() => avisosDeA().some((id) => !/^(fxs_|stm)/.test(id)), 20000);
  r.avisos_de_A = avisosDeA().length;
  // Por internet: el primer trozo del respaldo tal cual sale (capturado) no lleva la marca de mensaje nuevo para la escucha nativa
  r.marca_internet = chunk0 ? biA.net._newMsgId(chunk0) : 'sin capturar';
  r.errores = logs.filter((l) => / error: /.test(l) && !/JSDOMERROR|styles\.css|Not implemented|GLOBAL TIMEOUT|net::ERR|fetch/.test(l)).slice(0, 5);
  const ok = r.emparejados_s !== null && r.avisos_por_respaldo_y_estado.length === 0 && r.texto_avisa_s !== null && r.marca_internet === null && !r.errores.length;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('AVISOFENIX ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_avisofenix.txt'), logs.join('\n'));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('AVISOFENIX ' + JSON.stringify({ prueba: 'avisofenix', resultado: 'FALLO', error: String(e && e.message).replace(/"/g, "'") })); console.error(e && e.stack); fs.writeFileSync(path.join(__dirname, 'last_logs_avisofenix.txt'), logs.join('\n')); process.exit(1); });
