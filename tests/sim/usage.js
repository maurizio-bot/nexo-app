// Resumen diario de uso al desarrollador (2989; pendiente importante #2 del dueño 10-11: «responde ¿lo usan entre ellos? sin preguntar»).
// Dos teléfonos reales en jsdom por Bluetooth: A es un probador, B es el «desarrollador» (window.NEXO_DIAG_DEV = idB). Se comprueba que:
//   (1) los contadores de A cuentan lo que pasó hoy (enviados, recibidos, llegados ✓✓, por tipo, chats con actividad, app abierta);
//   (2) el resumen del último día COMPLETO (se simula que los contadores son de ayer) llega a la bandeja de B como «resumen_diario», con los
//       números correctos y SIN contenido de mensajes ni identificadores (solo números);
//   (3) una vez por día: un segundo intento no manda nada; con el interruptor del diagnóstico apagado no manda;
//   (4) el desarrollador también guarda su propio resumen (directo a su bandeja).
// Uso: node usage.js <dir_build>
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
  radio.add(nA); radio.add(nB); nA.load(); nB.load();
  const [A, B] = await Promise.all([boot('A', nA, {}), boot('B', nB, {})]);
  const biA = A.win.bleInterface, idA = biA.localNexoId.toLowerCase(), idB = B.win.bleInterface.localNexoId.toLowerCase();
  A.win.NEXO_DIAG_DEV = idB; B.win.NEXO_DIAG_DEV = idB;
  const usA = () => A.win.__nexoUsage, usB = () => B.win.__nexoUsage, adA = () => A.win.__nexoAutoDiag, adB = () => B.win.__nexoAutoDiag;
  const r = { prueba: 'usage', build: path.basename(buildDir) };
  r.modulo_activo = !!(usA() && usB() && adA() && adB());

  biA.togglePanel(); let add = null;
  for (let i = 0; i < 400 && !add; i++) { await sleep(100); add = A.win.document.querySelector('#ble-new-device > div button'); if (!add && !biA.isScanning) click(A.win, A.win.document.getElementById('ble-scan-btn')); }
  if (!add) { console.log('USAGE ' + JSON.stringify({ prueba: 'usage', resultado: 'FALLO', error: 'no empareja' })); process.exit(1); }
  click(A.win, add); await sleep(1500);
  if (A.win.document.getElementById('ble-panel').classList.contains('active')) biA.togglePanel();
  await openChatWith(A, 'B'); sendText(A, 'hola B secreto');
  r.emparejados_s = await waitFor(async () => (await B.win.vaultLoadMessages(idA)).some((m) => m.content === 'hola B secreto'), 30000);
  await openChatWith(B, 'A'); sendText(B, 'hola A privado'); await sleep(1500);
  sendText(A, 'segundo mensaje'); await sleep(3500);

  // (1) contadores de hoy en A
  const today = usA().key();
  const d = usA().load()[today] || {};
  r.cuenta_enviados = d.s >= 2;
  r.cuenta_recibidos = d.r >= 1;
  r.cuenta_llegados = d.d >= 1;
  r.cuenta_texto = (d.t || {}).texto >= 3;
  r.cuenta_un_chat = Array.isArray(d.c) && d.c.length === 1;
  r.abierta_hoy = d.o === 1;
  r.sin_ids_guardados = JSON.stringify(usA().load()).indexOf(idB) < 0 && JSON.stringify(usA().load()).indexOf('secreto') < 0;

  // (3a) el interruptor del diagnóstico apagado: no manda (y no junta para después)
  const ayer = usA().key(Date.now() - 86400000);
  const mover = (w) => { const o = w.__nexoUsage.load(); const t0 = w.__nexoUsage.key(); if (o[t0]) { o[ayer] = o[t0]; delete o[t0]; } w.localStorage.setItem('nexo_usage', JSON.stringify(o)); w.localStorage.removeItem('nexo_usage_sent'); w.localStorage.removeItem('nexo_usage_try'); };
  mover(A.win);   // los contadores de hoy pasan a «ayer»: el resumen de un día completo
  adA().setEnabled(false);
  r.apagado_no_manda = usA().send(true) === 'apagado' && adB().inbox().length === 0;
  adA().setEnabled(true);
  A.win.localStorage.removeItem('nexo_usage_sent');

  // (2) el resumen llega a la bandeja de B con los números y sin contenido
  const got = usA().send(true);
  r.manda = got === 'enviado';
  r.llega_s = await waitFor(() => adB().inbox().some((e) => e.sym === 'resumen_diario'), 40000);
  const e = adB().inbox().find((x) => x.sym === 'resumen_diario') || {};
  r.remitente_ok = e.from === idA && e.info === ayer;
  const m = /mensajes enviados: (\d+) · recibidos: (\d+)/.exec(e.text || '');
  r.numeros_ok = !!m && Number(m[1]) === d.s && Number(m[2]) === d.r;
  r.texto_resumen = typeof e.text === 'string' && e.text.indexOf('RESUMEN DIARIO') >= 0 && e.text.indexOf('chats con actividad: 1') >= 0;
  r.sin_contenido = !!e.text && e.text.indexOf('secreto') < 0 && e.text.indexOf('privado') < 0 && e.text.indexOf('segundo mensaje') < 0 && e.text.indexOf(idA) < 0 && e.text.indexOf(idB) < 0;
  r.no_en_chat = (await B.win.vaultLoadMessages(idA)).every((x) => String(x.content || '').indexOf('RESUMEN') < 0);

  // (3b) una vez por día: el siguiente intento no manda nada
  r.una_vez = usA().send(true) === 'sin_datos' && adB().inbox().filter((x) => x.sym === 'resumen_diario').length === 1;

  // (4) el desarrollador (B) guarda su propio resumen directo a su bandeja
  mover(B.win);
  r.dev_local = usB().send(true) === 'enviado' && adB().inbox().filter((x) => x.sym === 'resumen_diario' && x.from === idB).length === 1;

  r.errores = logs.filter((l) => / error: /.test(l) && !/JSDOMERROR|styles\.css|Not implemented|GLOBAL TIMEOUT|Assembly timeout|net::ERR|fetch/.test(l)).slice(0, 5);
  const keys = ['modulo_activo', 'cuenta_enviados', 'cuenta_recibidos', 'cuenta_llegados', 'cuenta_texto', 'cuenta_un_chat', 'abierta_hoy', 'sin_ids_guardados', 'apagado_no_manda', 'manda', 'remitente_ok', 'numeros_ok', 'texto_resumen', 'sin_contenido', 'no_en_chat', 'una_vez', 'dev_local'];
  const ok = typeof r.emparejados_s === 'number' && typeof r.llega_s === 'number' && keys.every((k) => r[k] === true) && r.errores.length === 0;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('USAGE ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_usage.txt'), logs.join('\n'));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('USAGE ' + JSON.stringify({ prueba: 'usage', resultado: 'FALLO', error: String(e && e.message).replace(/"/g, "'") })); console.error(e && e.stack); process.exit(1); });
