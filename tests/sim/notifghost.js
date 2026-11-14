// 3076 (dueño 14-11: «las notificaciones de cuando recibo un diagnóstico me aparecen como notificación, luego notificaciones
// fantasmas… mensaje que llegue, notificación que llegue, puntual, que no se repita»). Un mensaje OCULTO (diagnóstico automático,
// foto de perfil, estado, acción del chat) nunca debe avisar en el otro teléfono. Se marcaba «callado» solo en memoria
// (bleInterface._quietOut): si la app del que lo manda se reiniciaba antes de entregarlo, al reanudarse salía SIN la marca y el
// nativo del otro avisaba «Mensaje nuevo» (y al entrar no había nada). A (probador) y B (desarrollador) por Bluetooth:
//  G1  B se aleja; A tiene un síntoma → su diagnóstico (oculto, largo) queda pendiente para B;
//  G2  A se reinicia (app cerrada y abierta otra vez);
//  G3  B con la app CERRADA vuelve a estar cerca: A reanuda el envío → el nativo de B recibe el primer trozo y NO avisa;
//  G4  un texto normal de A sí avisa (la prueba ve los avisos);
//  G5  al revés: un mensaje de GRUPO (su copia para B se guarda «oculta» en el chat de B del que manda) que queda pendiente y se
//      reenvía tras reiniciar A SÍ avisa a B con la app cerrada (3075: salía «callado» por ser copia oculta → sin aviso).
// Uso: node notifghost.js <dir_build>
'use strict';'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone, installWebCrypto } = require('./native_mock');
const { NostrRelay } = require('./nostr_relay');
const { importSrc } = require('./srcmod');

const buildDir = path.resolve(process.argv[2] || path.join(__dirname, 'builds/wip'));
const base = { readsContentFallback: true, retain: ['onPayloadReceived', 'onLanMessage', 'onLanUp', 'onLanDown'], closeOnNoService: true, pace: [15, 15], ioDelay: 25, asymmetric: true, noTor: true };
let RELAYS = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
class DL extends ResourceLoader { constructor(d) { super(); this.d = d; } fetch(u) { const f = path.join(this.d, decodeURIComponent(new URL(u).pathname)); return fs.existsSync(f) ? Promise.resolve(fs.readFileSync(f)) : Promise.reject(new Error('x')); } }
const logs = [];
const T0 = Date.now();
const ts = () => String(((Date.now() - T0) / 1000).toFixed(1)).padStart(6) + 's';
function instrument(native, pl, who) {
  native.calls = { push() {}, length: 0, filter() { return []; }, slice() { return []; }, forEach() {}, map() { return []; }, some() { return false; }, find() { return undefined; } };
  if (who !== 'A') return;
  const oS = pl.saveToFile;
  pl.saveToFile = (a) => { const len = String((a && a.content) || '').length; return oS(a); };
}
async function boot(name, native) {
  native.listeners = new Map();
  const vc = new VirtualConsole();
  ['log', 'warn', 'error'].forEach((l) => vc.on(l, (...a) => logs.push(`${ts()} [${name}] ${l}: ` + a.map(String).join(' ').substring(0, 260))));
  const dom = new JSDOM(fs.readFileSync(path.join(buildDir, 'dist', 'index.html'), 'utf8'), {
    url: 'https://' + name.toLowerCase() + '.nexo.test/index.html', runScripts: 'dangerously', resources: new DL(path.join(buildDir, 'dist')), pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) {
      win.NEXO_NET_RELAYS = RELAYS; win.CapacitorCustomPlatform = { name: 'android' }; installWebCrypto(win);
      const pl = native.plugin(); instrument(native, pl, name);
      win.Capacitor = { Plugins: { NexoBLE: pl } }; win.HTMLElement.prototype.scrollTo = function () {};
    },
  });
  const win = dom.window;
  for (let i = 0; i < 100 && !(win.NEXO && win.NEXO.initialized); i++) await sleep(100);
  await sleep(800);
  return { name, native, win };
}
const click = (win, el) => el && el.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
async function openChatWith(p, name) {
  let row; for (let i = 0; i < 200 && !row; i++) { row = Array.from(p.win.document.querySelectorAll('#main-contacts-list .ble-contact-row')).find((r) => (r.querySelector('.ble-contact-name') || {}).textContent === name); if (!row) await sleep(100); }
  click(p.win, row); await sleep(500); return !!row;
}
function sendText(p, t) { const i = p.win.document.getElementById('message-input'); i.value = t; i.dispatchEvent(new p.win.Event('input', { bubbles: true })); click(p.win, p.win.document.getElementById('send-btn')); }
function pickFile(p, name, b) {
  click(p.win, p.win.document.querySelector('.attach-menu-item[data-type="file"]'));
  const fin = Array.from(p.win.document.querySelectorAll('input[type=file]')).pop();
  Object.defineProperty(fin, 'files', { configurable: true, value: [new p.win.File([b], name, { type: 'application/octet-stream' })] });
  fin.dispatchEvent(new p.win.Event('change'));
}
async function addFound(p, name) {
  let add = null;
  const find = () => { const row = Array.from(p.win.document.querySelectorAll('#ble-new-device > div')).find((d) => (d.querySelector('span') || {}).textContent === name); return row && row.querySelector('button'); };
  for (let i = 0; i < 400 && !add; i++) { await sleep(100); add = find(); if (!add && !p.win.bleInterface.isScanning) click(p.win, p.win.document.getElementById('ble-scan-btn')); }
  click(p.win, add); await sleep(2000);
  return !!add;
}


async function waitFor(fn, ms) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return Math.round((Date.now() - t0) / 100) / 10; await sleep(250); } return null; }
(async () => {
  const r = { prueba: 'notifghost', build: path.basename(buildDir) };
  RELAYS = [];
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', Object.assign({}, base, { wifi: null })), nB = new NativePhone('B', 'BB:BB:BB:BB:BB:02', Object.assign({}, base, { wifi: null }));
  [nA, nB].forEach((n) => { radio.add(n); n.load(); });
  let A = await boot('A', nA); let B = await boot('B', nB);
  const idB = B.win.bleInterface.localNexoId.toLowerCase(), idA = A.win.bleInterface.localNexoId.toLowerCase();
  A.win.bleInterface.togglePanel(); const paired = await addFound(A, 'B'); A.win.bleInterface.togglePanel();
  if (!paired) { console.log('NOTIFGHOST ' + JSON.stringify(Object.assign(r, { resultado: 'FALLO', error: 'no empareja' }))); process.exit(1); }
  await openChatWith(A, 'B'); sendText(A, 'hola B'); await sleep(2000);
  await openChatWith(B, 'A'); sendText(B, 'hola A'); await sleep(3000);
  // G1: B lejos; A manda su diagnóstico (oculto) a B
  nB.setOffline(true); await sleep(3000);
  A.win.NEXO_DIAG_DEV = idB; B.win.NEXO_DIAG_DEV = idB; A.win.NEXO_AUTODIAG_GAP_MS = 0;
  const mark = logs.length;
  A.win.dispatchEvent(new A.win.CustomEvent('nexo:diag:symptom', { detail: { kind: 'zombi', info: 'prueba fantasma' } }));
  await sleep(6000);
  const sentLine = logs.slice(mark).find((l) => /\[A\] log: \[AUTODIAG\] síntoma «zombi».*al desarrollador/.test(l));
  const dm = sentLine && /\((msg[0-9a-z]+)\)/.exec(sentLine);
  const D = dm && dm[1];
  r.G1_diag_pendiente = !!D;
  // G2: A se reinicia
  A.win.close(); nA.destroyActivity(); await sleep(1500);
  A = await boot('A', nA);
  r.G2_reiniciada = !!(A.win.bleInterface && A.win.bleInterface.localNexoId);
  // G3: B cerrada vuelve a estar cerca
  B.win.close(); nB.destroyActivity(); await sleep(1500);
  const t0 = Date.now();
  nB.setOffline(false);
  // A reanuda: llega al nativo de B (el primer trozo o el mensaje entero)
  const mark2 = logs.length;
  // A reanuda el diagnóstico tras volver B: sale al menos una ventana suya (el nativo de B ve el primer trozo)
  r.G3_reanuda_s = await waitFor(() => logs.slice(mark2).some((l) => /\[A\] log: \[ChatStream\] (_retransmitWindow|_runWindowLoop: enviando ventana|START)/.test(l) && l.indexOf(D) >= 0), 90000);
  await sleep(6000);
  r.G3_trozo_visto_por_B = (nB.rxFrames || 0) > 0 || r.G3_reanuda_s !== null;
  const ghost = nB.notifLog.filter((n) => n.t >= t0 && !n.update && !n.call && n.msgId === D);
  r.G3_avisos = ghost.map((n) => n.chatId + ':' + (n.text || 'Mensaje nuevo'));
  r.G3_sin_aviso = ghost.length === 0;
  // G4: un texto normal sí avisa con B cerrada
  const t1 = Date.now();
  await openChatWith(A, 'B'); sendText(A, 'texto normal con B cerrada');
  r.G4_avisa_s = await waitFor(() => nB.notifLog.some((n) => n.t >= t1 && !n.update && !n.call && n.msgId !== D), 40000);
  r.avisos_de_B = nB.notifLog.filter((n) => n.t >= t0).map((n) => (n.msgId === D ? 'DIAG' : 'otro') + (n.update ? '(act)' : ''));
  // G5: mensaje de grupo pendiente → A reiniciada → B (cerrada) vuelve → SÍ avisa
  const grp = A.win.bleInterface.groups.create('Fam', [idB]);
  nB.setOffline(true); await sleep(3000);
  const gmid = A.win.bleInterface.groups.sendText(grp.id, 'hola grupo pendiente');
  await sleep(4000);
  A.win.close(); nA.destroyActivity(); await sleep(1500);
  A = await boot('A', nA);
  const t2 = Date.now();
  nB.rxClosed = [];
  if (!nB._ocr) { nB._ocr = nB._closedReceive.bind(nB); nB._closedReceive = (from, json) => { try { const o = JSON.parse(json); nB.rxClosed.push({ type: o.type || o.t, id: o.msgId || o.m, q: o.q, to: o.to, dn: o.dn }); } catch (e) {} return nB._ocr(from, json); }; }
  nB.setOffline(false);
  r.G5_grupo_avisa_s = await waitFor(() => nB.notifLog.some((n) => n.t >= t2 && !n.update && !n.call && String(n.msgId || '').indexOf(gmid) === 0), 90000);
  r.G5_llegado_a_B = (nB.rxClosed || []).filter((x) => String(x.id || '').indexOf(gmid) === 0).slice(0, 3);
  r.errores = logs.filter((l) => / error: /.test(l) && !/JSDOMERROR|styles\.css|Not implemented|GLOBAL TIMEOUT|net::ERR|fetch/.test(l)).slice(0, 5);
  const ok = r.G1_diag_pendiente && r.G2_reiniciada && r.G3_reanuda_s !== null && r.G3_sin_aviso && r.G4_avisa_s !== null && r.G5_grupo_avisa_s !== null && !r.errores.length;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('NOTIFGHOST ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_notifghost.txt'), logs.join('\n'));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('NOTIFGHOST ' + JSON.stringify({ prueba: 'notifghost', resultado: 'FALLO', error: String(e && e.message).replace(/"/g, "'") })); console.error(e && e.stack); fs.writeFileSync(path.join(__dirname, 'last_logs_notifghost.txt'), logs.join('\n')); process.exit(1); });
