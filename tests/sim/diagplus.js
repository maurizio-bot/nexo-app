// 3020 — DIAGNÓSTICO MÁS CLARO (plan del dueño 12-11: «más claro el diagnóstico, mejor lo puedes arreglar»). Dos teléfonos por
// Bluetooth: A probador, B desarrollador (y a la vez el contacto implicado). Se comprueba en el diagnóstico que llega a B:
//   D1: sección ESTADO arriba: zona horaria, teléfono (batería, red), y por contacto el camino, el enlace BT (MTU) y su BUILD
//       (la dice en su kx «bd»), sin el NEXO ID completo (solo «…» + 4 últimos).
//   D2: línea de tiempo de los mensajes propios (estado con hora y camino al mandarlo).
//   D3: líneas repetidas compactadas (40 iguales salvo el número → la primera + «↳ ×39 más iguales hasta HH:MM:SS»).
//   D4: diagnóstico EMPAREJADO: un síntoma que nombra a B le pide el suyo; con su interruptor apagado no manda nada; encendido
//       lo manda («par:<síntoma>», pedido por A); un diagnóstico pedido no pide a su vez.
//   D5: síntomas nuevos: enlace que abre y cierra (3 cierres por repetido en 10 min); entrega lenta (perilla 1,5 s).
//   D6: límites nuevos: 10 min entre diagnósticos (antes 2 h).
//   Sin contenido de mensajes.
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
  const knobs = { NEXO_AUTODIAG_SCAN_MS: 3600000, NEXO_AUTODIAG_PAIR_MS: 0, NEXO_DIAG_SLOW_MS: 1500 };
  const [A, B] = await Promise.all([boot('A', nA, knobs), boot('B', nB, knobs)]);
  const biA = A.win.bleInterface, idA = biA.localNexoId.toLowerCase(), idB = B.win.bleInterface.localNexoId.toLowerCase();
  A.win.NEXO_DIAG_DEV = idB; B.win.NEXO_DIAG_DEV = idB; // B es el desarrollador (y también el contacto implicado)
  const adA = () => A.win.__nexoAutoDiag, adB = () => B.win.__nexoAutoDiag;
  const r = { prueba: 'diagplus', build: path.basename(buildDir) };
  biA.togglePanel(); let add = null;
  for (let i = 0; i < 400 && !add; i++) { await sleep(100); add = A.win.document.querySelector('#ble-new-device > div button'); if (!add && !biA.isScanning) click(A.win, A.win.document.getElementById('ble-scan-btn')); }
  if (!add) { console.log('DIAGPLUS ' + JSON.stringify({ prueba: 'diagplus', resultado: 'FALLO', error: 'no empareja' })); process.exit(1); }
  click(A.win, add); await sleep(1500);
  if (A.win.document.getElementById('ble-panel').classList.contains('active')) biA.togglePanel();
  await openChatWith(A, 'B'); sendText(A, 'hola B');
  r.emparejados_s = await waitFor(async () => (await B.win.vaultLoadMessages(idA)).some((m) => m.content === 'hola B'), 30000);
  await openChatWith(B, 'A'); sendText(B, 'hola A'); await sleep(3000);
  const ownA = (await A.win.vaultLoadMessages(idB)).find((m) => m._own && m.content === 'hola B');
  // un bucle en el registro de A: 40 líneas iguales salvo el número
  for (let i = 0; i < 40; i++) A.win.console.log('[BLEInterface] Re-búsqueda de contactos prueba intento ' + i);

  // ===== D1-D3: ESTADO, línea de tiempo y compactación en el diagnóstico que llega a B =====
  A.win.NEXO_AUTODIAG_GAP_MS = 0;
  const rep = adA().report('zombi', 'prueba');
  r.reporte = rep;
  r.llega_a_B_s = await waitFor(() => adB().inbox().some((e) => e.from === idA && e.sym === 'zombi'), 40000);
  const txt = (adB().inbox().find((e) => e.from === idA && e.sym === 'zombi') || {}).text || '';
  const tailB = '…' + idB.slice(-4);
  r.D1_estado_y_zona = /===== ESTADO/.test(txt) && /Zona horaria: UTC[+-]\d\d:\d\d/.test(txt) && /Teléfono: .*batería \d+%.*red /.test(txt);
  const rowB = (txt.split('\n').find((l) => l.indexOf('  ' + tailB + ':') === 0) || '');
  r.D1_fila_del_contacto = rowB.substring(0, 160);
  r.D1_contacto_camino_y_build = /camino bluetooth/.test(rowB) && /BT listo MTU \d+/.test(rowB) && /build dev/.test(rowB);
  r.D2_linea_de_tiempo = !!ownA && new RegExp(ownA.messageId.slice(-8) + ' → ' + tailB + ' \\(camino al mandar bluetooth\\): .*(delivered|read)').test(txt);
  r.D3_compactado = /Re-búsqueda de contactos prueba intento 0\n\s+↳ ×39 más iguales hasta \d\d:\d\d:\d\d/.test(txt);
  r.estado_antes_del_registro = txt.indexOf('===== ESTADO') >= 0 && txt.indexOf('===== ESTADO') < txt.indexOf('===== SESIÓN ACTUAL');

  // ===== D4: diagnóstico EMPAREJADO: el síntoma nombra a B → B manda el suyo (si lo tiene encendido) =====
  adB().setEnabled(false);
  const nB0 = adB().inbox().length;
  adA().report('reenvio_sin_fin', idB + ' 2 sin confirmar, 3 vueltas');
  await sleep(6000);
  r.D4_apagado_no_manda = adB().inbox().length === nB0 + 1 && !adB().inbox().some((e) => /^par:/.test(e.sym)) && logs.some((l) => /\[B\].*pidió mi diagnóstico.*: apagado/.test(l));
  adB().setEnabled(true);
  adA().report('enlace_abre_cierra', idB + ' 6 desconexiones en 10 min');
  r.D4_par_manda_s = await waitFor(() => adB().inbox().some((e) => e.sym === 'par:enlace_abre_cierra' && e.info === 'pedido por ' + idA && e.local), 30000);
  r.D4_A_no_pide_por_un_pedido = !logs.some((l) => /\[B\].*pido a .* su diagnóstico \(síntoma «par:/.test(l));

  // ===== D5: síntomas nuevos =====
  const symsA = () => (adA().state().sent || []).map((x) => x.sym);
  // enlace que abre y cierra: 3 cierres por repetido en 10 min
  for (let i = 0; i < 3; i++) biA._noteLinkFlap(idB, 'repetido');
  r.D5_enlace_abre_cierra = await waitFor(() => symsA().filter((s) => s === 'enlace_abre_cierra').length >= 2, 5000) !== null;
  // entrega lenta (perilla 1,5 s): un mensaje con camino que tarda en confirmarse
  biA.ackSystem.pendingAcks.set('msgLENTO0001', { msgId: 'msgLENTO0001', deviceId: [...biA._deviceStates.keys()].find((k) => biA._macToNexoId.get(k) === idB) || 'bbbbbbbbbb02', resolve() {}, reject() {}, timer: null });
  A.win.dispatchEvent(new A.win.CustomEvent('nexo:ble:ackStatus', { detail: { msgId: 'msgLENTO0001', status: 'sending' } }));
  biA.ackSystem.pendingAcks.delete('msgLENTO0001');
  await sleep(1800);
  A.win.dispatchEvent(new A.win.CustomEvent('nexo:ble:ackStatus', { detail: { msgId: 'msgLENTO0001', status: 'delivered' } }));
  r.D5_entrega_lenta = await waitFor(() => symsA().includes('entrega_lenta'), 5000) !== null;
  // límites nuevos (sin perilla): 10 min entre envíos, 30 por día
  A.win.NEXO_AUTODIAG_GAP_MS = undefined;
  r.D6_hueco_10_min = adA().report('error', 'otro') === 'espera';
  { const st = adA().state(); st.lastAt = Date.now() - 11 * 60 * 1000; A.win.localStorage.setItem('nexo_autodiag_state', JSON.stringify(st)); }
  r.D6_pasa_tras_10_min = adA().report('error', 'otro2') === 'enviado';

  r.contenido_en_diagnostico = /hola B|hola A/.test(txt);
  r.errores = logs.filter((l) => / error: /.test(l) && !/Not implemented|ResizeObserver/.test(l)).slice(0, 3);
  const ok = typeof r.emparejados_s === 'number' && r.reporte === 'enviado' && typeof r.llega_a_B_s === 'number' && r.D1_estado_y_zona && r.D1_contacto_camino_y_build && r.D2_linea_de_tiempo && r.D3_compactado && r.estado_antes_del_registro &&
    r.D4_apagado_no_manda && typeof r.D4_par_manda_s === 'number' && r.D4_A_no_pide_por_un_pedido && r.D5_enlace_abre_cierra && r.D5_entrega_lenta && r.D6_hueco_10_min && r.D6_pasa_tras_10_min && !r.contenido_en_diagnostico && !r.errores.length;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('DIAGPLUS ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_diagplus.txt'), logs.join('\n') + '\n\n===== TEXTO =====\n' + txt.substring(0, 6000));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('DIAGPLUS {"prueba":"diagplus","resultado":"FALLO","error":"' + String(e && e.message).replace(/"/g, "'") + '"}'); console.error(e && e.stack); fs.writeFileSync(path.join(__dirname, 'last_logs_diagplus.txt'), logs.join('\n')); process.exit(1); });
