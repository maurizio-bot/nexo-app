// 3215 (diagnóstico automático de Marcos —SM-A556E, 3090— 17-11 16:13:41, par:zombi pedido por el HONOR): al abrir la app, las
// confirmaciones (✓✓) del dueño que habían llegado con la app cerrada se comprobaron a las 16:13:41.675–.681 y salieron
// «Confirmación sin firma válida de nx1n36c283 … ignorada» ×6; el NEXO ID propio no se cargó hasta las 16:13:41.710. La firma se
// comprueba sobre «ack|msgId|quien_confirma|YO»: sin «yo» todavía, ninguna cuadra → se tiran confirmaciones buenas, el mensaje
// queda en ✓ y se vuelve a mandar. (Lo mismo al revés: una confirmación que sale antes de tener el ID va firmada como «unknown».)
// Ahora se espera al NEXO ID propio (unos ms) y se comprueba / firma con él.
// A y B por Bluetooth. B le manda un texto a A; cuando llega la ✓✓ de A, B está «arrancando» (su NEXO ID aún sin cargar, 1,5 s):
//  K1  la confirmación se acepta (ningún «sin firma válida») y B ve ✓✓ en ≤ 4 s;
//  K2  al revés: A recibe un texto de B mientras A arranca; la ✓✓ que manda A la acepta B (✓✓, sin «sin firma válida»).
// Contraprueba b3205: «sin firma válida» y el texto se queda sin ✓✓.
// Uso: node ackarranque.js <dir_build>
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone, installWebCrypto } = require('./native_mock');

const buildDir = path.resolve(process.argv[2] || path.join(__dirname, 'builds/wip'));
const base = { readsContentFallback: true, retain: ['onPayloadReceived'], closeOnNoService: true, pace: [15, 15], ioDelay: 25, asymmetric: true, noTor: true };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
class DL extends ResourceLoader { constructor(d) { super(); this.d = d; } fetch(u) { const f = path.join(this.d, decodeURIComponent(new URL(u).pathname)); return fs.existsSync(f) ? Promise.resolve(fs.readFileSync(f)) : Promise.reject(new Error('x')); } }
class NoNetWS { constructor(u) { this.url = u; this.readyState = 0; setTimeout(() => { this.readyState = 3; if (this.onerror) this.onerror({}); if (this.onclose) this.onclose({ code: 1006 }); }, 30); } send() { throw new Error('sin red'); } close() {} addEventListener() {} removeEventListener() {} }
const logs = [];
const T0 = Date.now();
const ts = () => String(((Date.now() - T0) / 1000).toFixed(1)).padStart(6) + 's';
async function boot(p) {
  p.native.calls = { push() {}, length: 0, filter() { return []; }, slice() { return []; }, forEach() {}, map() { return []; }, some() { return false; }, find() { return undefined; } };
  const vc = new VirtualConsole();
  ['log', 'warn', 'error'].forEach((l) => vc.on(l, (...a) => logs.push(`${ts()} [${p.name}] ${l}: ` + a.map(String).join(' ').substring(0, 260))));
  const dom = new JSDOM(fs.readFileSync(path.join(buildDir, 'dist', 'index.html'), 'utf8'), {
    url: 'https://' + p.name.toLowerCase() + '.nexo.test/index.html', runScripts: 'dangerously', resources: new DL(path.join(buildDir, 'dist')), pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) {
      win.NEXO_NET_RELAYS = []; win.CapacitorCustomPlatform = { name: 'android' }; installWebCrypto(win);
      win.Capacitor = { Plugins: { NexoBLE: p.native.plugin() } }; win.HTMLElement.prototype.scrollTo = function () {};
      win.WebSocket = function (u) { return new NoNetWS(u); };
    },
  });
  const win = dom.window;
  for (let i = 0; i < 100 && !(win.NEXO && win.NEXO.initialized); i++) await sleep(100);
  await sleep(800);
  p.win = win;
  return p;
}
const click = (win, el) => el && el.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
async function openChatWith(p, name) {
  let row; for (let i = 0; i < 200 && !row; i++) { row = Array.from(p.win.document.querySelectorAll('#main-contacts-list .ble-contact-row')).find((r) => [].concat(name).indexOf((r.querySelector('.ble-contact-name') || {}).textContent) >= 0); if (!row) await sleep(100); }
  click(p.win, row); await sleep(600); return !!row;
}
function sendText(p, t) { const i = p.win.document.getElementById('message-input'); i.value = t; i.dispatchEvent(new p.win.Event('input', { bubbles: true })); click(p.win, p.win.document.getElementById('send-btn')); }
async function addFound(p, name) {
  let add = null;
  const find = () => { const row = Array.from(p.win.document.querySelectorAll('#ble-new-device > div')).find((d) => (d.querySelector('span') || {}).textContent === name); return row && row.querySelector('button'); };
  for (let i = 0; i < 400 && !add; i++) { await sleep(100); add = find(); if (!add && !p.win.bleInterface.isScanning) click(p.win, p.win.document.getElementById('ble-scan-btn')); }
  click(p.win, add); await sleep(2000);
  return !!add;
}
async function waitFor(fn, ms) { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (await fn()) return Math.round((Date.now() - t0) / 100) / 10; } catch (e) {} await sleep(200); } return null; }
const vis = (c) => { const s = String(c == null ? '' : c); if (s.charAt(0) === '{') { try { const o = JSON.parse(s); if (o && typeof o.t === 'string') return o.t; } catch (e) {} } return s; };
const own = async (p, chat, text) => (await p.win.vaultLoadMessages(chat)).find((m) => m._own && vis(m.content).trim() === text);
const stOf = async (p, chat, text) => { const m = await own(p, chat, text); return m ? m.status : null; };
const unsigned = (who, from) => logs.slice(from).filter((l) => l.indexOf('[' + who + '] ') >= 0 && /sin firma válida/.test(l)).length;

// El teléfono `p` «arranca»: su NEXO ID no está cargado durante `ms` (como entre el inicio y la lectura del NEXO ID del almacén)
function startingUp(p, ms) {
  const bi = p.win.bleInterface, id = bi.localNexoId;
  bi.localNexoId = null;
  bi._nexoIdP = new Promise((res) => setTimeout(() => { bi.localNexoId = id; res(id); }, ms));
}

(async () => {
  const r = { prueba: 'ackarranque', build: path.basename(buildDir) };
  const radio = new Radio();
  const A = { name: 'A', native: new NativePhone('A', 'AA:AA:AA:AA:AA:01', base) };
  const B = { name: 'B', native: new NativePhone('B', 'BB:BB:BB:BB:BB:02', base) };
  [A, B].forEach((p) => { radio.add(p.native); p.native.load(); });
  await boot(A); await boot(B);
  const idA = A.win.bleInterface.localNexoId.toLowerCase(), idB = B.win.bleInterface.localNexoId.toLowerCase();
  A.win.bleInterface.togglePanel(); const paired = await addFound(A, 'B'); A.win.bleInterface.togglePanel();
  if (!paired) { console.log('ACKARRANQUE ' + JSON.stringify(Object.assign(r, { resultado: 'FALLO', error: 'no empareja' }))); process.exit(1); }
  await openChatWith(A, ['B', 'A']); sendText(A, 'hola B'); await sleep(2500);
  await openChatWith(B, ['A', 'B']); sendText(B, 'hola A'); await sleep(2500);
  r.par_con_firma = ['A', 'B'].every((n) => { const p = n === 'A' ? A : B; const c = p.win.bleInterface.ackSystem._contactOf(null, n === 'A' ? idB : idA); return !!(c && c.proto === 2 && c.publicKey && !c.pendingKey); });
  r.saludos_entregados = /delivered|read/.test(String(await stOf(A, idB, 'hola B'))) && /delivered|read/.test(String(await stOf(B, idA, 'hola A')));

  // K1: la ✓✓ de A le llega a B mientras B arranca
  const ackB = B.win.bleInterface.ackSystem, origB = ackB.processIncomingAck;
  let armedB = true;
  ackB.processIncomingAck = function (content) {
    if (armedB && /"type":"ack"/.test(String(content))) { armedB = false; startingUp(B, 1500); }
    return origB.apply(this, arguments);
  };
  let mark = logs.length;
  sendText(B, 'confirma mientras arranco');
  r.K1_entregado_s = await waitFor(async () => /delivered|read/.test(String(await stOf(B, idA, 'confirma mientras arranco'))), 8000);
  r.K1_hubo_arranque = !armedB;
  r.K1_sin_firma = unsigned('B', mark);
  ackB.processIncomingAck = origB;

  // K2: A recibe un texto de B mientras A arranca; su ✓✓ tiene que valer en B
  await openChatWith(A, ['B', 'A']);
  await sleep(500);
  const ackA = A.win.bleInterface.ackSystem, origRcpt = ackA._sendReceipt;
  let armedA = true;
  ackA._sendReceipt = function (type) {
    if (armedA && type === 'ack') { armedA = false; startingUp(A, 1500); }
    return origRcpt.apply(this, arguments);
  };
  mark = logs.length;
  sendText(B, 'te escribo mientras arrancas');
  r.K2_entregado_s = await waitFor(async () => /delivered|read/.test(String(await stOf(B, idA, 'te escribo mientras arrancas'))), 8000);
  r.K2_hubo_arranque = !armedA;
  r.K2_sin_firma = unsigned('B', mark);
  ackA._sendReceipt = origRcpt;

  r.errores = logs.filter((l) => / error: /.test(l) && !/JSDOMERROR|styles\.css|Not implemented|GLOBAL TIMEOUT|net::ERR|fetch/.test(l)).slice(0, 5);
  const ok = r.par_con_firma && r.saludos_entregados &&
    r.K1_hubo_arranque && r.K1_entregado_s !== null && r.K1_entregado_s <= 4 && r.K1_sin_firma === 0 &&
    r.K2_hubo_arranque && r.K2_entregado_s !== null && r.K2_entregado_s <= 4 && r.K2_sin_firma === 0 && !r.errores.length;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('ACKARRANQUE ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_ackarranque.txt'), logs.join('\n'));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('ACKARRANQUE ' + JSON.stringify({ prueba: 'ackarranque', resultado: 'FALLO', error: String(e && e.message).replace(/"/g, "'") })); console.error(e && e.stack); fs.writeFileSync(path.join(__dirname, 'last_logs_ackarranque.txt'), logs.join('\n')); process.exit(1); });
