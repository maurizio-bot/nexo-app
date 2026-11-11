// Diagnóstico AUTOMÁTICO al desarrollador (build 2974; pedido del dueño 09-11: «que el diagnóstico se haga solo y me llegue»;
// sus probadores casi nunca lo mandan a mano). Dos teléfonos reales en jsdom por Bluetooth: A es un probador, B es el
// «desarrollador» (window.NEXO_DIAG_DEV = idB). Se comprueba que:
//   (1) un síntoma en A (evento nexo:diag:symptom / report) manda a B un diagnóstico cifrado como mensaje OCULTO: llega a la
//       bandeja de B con remitente, síntoma y texto; NO aparece como mensaje en el chat de ninguno de los dos (en A queda un
//       mensaje oculto, que es lo que le da la cola de pendientes); A ve el ✓ cuando B lo confirma.
//   (2) límites: el mismo síntoma no se repite en 24 h; otro síntoma espera el hueco de 2 h; apagado → no manda; tope diario.
//   (3) B apagado (fuera de alcance): el diagnóstico queda pendiente y llega solo cuando B vuelve (misma cola que un mensaje).
//   (4) el propio desarrollador: su síntoma va directo a su bandeja, sin viajar.
//   (5) pendiente VIEJO con el contacto alcanzable (barrido): se detecta y se manda como síntoma, una sola vez.
//   (6) el texto para copiar incluye los recibidos; «marcar vistos» deja 0 nuevos; el icono de Perfil muestra un puntito mientras
//       haya nuevos (A3, 2982) y lo quita al marcarlos.
// Uso: node autodiag.js <dir_build>
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
  // A: sin barrido periódico (se llama a mano) y «viejo» = 1 s para la prueba (5); B: nada especial
  const [A, B] = await Promise.all([boot('A', nA, { NEXO_AUTODIAG_SCAN_MS: 3600000, NEXO_AUTODIAG_OLD_MS: 1000 }), boot('B', nB, { NEXO_AUTODIAG_SCAN_MS: 3600000 })]);
  const biA = A.win.bleInterface, idA = biA.localNexoId.toLowerCase(), idB = B.win.bleInterface.localNexoId.toLowerCase();
  A.win.NEXO_DIAG_DEV = idB; B.win.NEXO_DIAG_DEV = idB; // B es el desarrollador
  const adA = () => A.win.__nexoAutoDiag, adB = () => B.win.__nexoAutoDiag;
  const r = { prueba: 'autodiag', build: path.basename(buildDir) };
  r.modulo_activo = !!(adA() && adB());

  // Emparejar por Bluetooth y fijar la sesión con un texto en cada sentido
  biA.togglePanel(); let add = null;
  for (let i = 0; i < 400 && !add; i++) { await sleep(100); add = A.win.document.querySelector('#ble-new-device > div button'); if (!add && !biA.isScanning) click(A.win, A.win.document.getElementById('ble-scan-btn')); }
  if (!add) { console.log('AUTODIAG ' + JSON.stringify({ prueba: 'autodiag', resultado: 'FALLO', error: 'no empareja' })); process.exit(1); }
  click(A.win, add); await sleep(1500);
  if (A.win.document.getElementById('ble-panel').classList.contains('active')) biA.togglePanel();
  await openChatWith(A, 'B'); sendText(A, 'hola B');
  r.emparejados_s = await waitFor(async () => (await B.win.vaultLoadMessages(idA)).some((m) => m.content === 'hola B'), 30000);
  await openChatWith(B, 'A'); sendText(B, 'hola A'); await sleep(2500);
  const visA0 = await visibles(A, idB), visB0 = await visibles(B, idA), ocuA0 = await ocultos(A, idB);
  r.aviso_desarrollador_sin_contacto_antes = null; // (informativo) B ya es contacto de A: el envío aplica

  // ===== (1) síntoma en A → bandeja de B, sin burbujas =====
  const bubblesB0 = B.win.document.querySelectorAll('#messages .message, .message-bubble, .msg').length;
  A.win.dispatchEvent(new A.win.CustomEvent('nexo:diag:symptom', { detail: { kind: 'zombi', info: 'prueba' } }));
  r.evento_sintoma_manda = await waitFor(() => (adA().state().sent || []).length === 1, 5000) !== null;
  r.llega_a_B_s = await waitFor(() => adB().inbox().length === 1, 40000);
  const e1 = adB().inbox()[0] || {};
  r.remitente_ok = e1.from === idA;
  r.sintoma_ok = e1.sym === 'zombi' && e1.info === 'prueba';
  r.texto_es_diagnostico = typeof e1.text === 'string' && e1.text.indexOf('NEXO diagnóstico') >= 0 && e1.text.indexOf('Build:') >= 0 && e1.text.length < 45000;
  r.sin_burbuja_en_B = (await visibles(B, idA)) === visB0 && B.win.document.querySelectorAll('#messages .message, .message-bubble, .msg').length === bubblesB0;
  r.sin_burbuja_en_A = (await visibles(A, idB)) === visA0 && (await ocultos(A, idB)) === ocuA0 + 1;
  r.A_ve_tick_s = await waitFor(() => !!((adA().state().sent || [])[0] || {}).ok, 20000);
  r.estado_enviado = adA().state().count === 1;

  // ===== (2) límites =====
  r.mismo_sintoma_repetido = adA().report('zombi', 'prueba') === 'repetido';
  r.otro_sintoma_espera_2h = adA().report('reintentos', 'x1') === 'espera';
  A.win.NEXO_AUTODIAG_GAP_MS = 0;
  adA().setEnabled(false);
  r.apagado_no_manda = adA().report('reintentos', 'x2') === 'apagado' && adB().inbox().length === 1;
  adA().setEnabled(true);
  { const st = adA().state(); st.count = 3; st.day = new Date().toISOString().substring(0, 10); A.win.localStorage.setItem('nexo_autodiag_state', JSON.stringify(st)); }
  r.tope_diario = adA().report('reintentos', 'x3') === 'tope';
  { const st = adA().state(); st.count = 1; A.win.localStorage.setItem('nexo_autodiag_state', JSON.stringify(st)); }
  await sleep(500);
  r.bandeja_B_sigue_1 = adB().inbox().length === 1;

  // ===== (3) B fuera de alcance: queda pendiente y llega al volver =====
  radio.block(nA, nB);
  await waitFor(() => !biA._bleReadyFor(idB), 15000);
  r.B_fuera = !biA._bleReadyFor(idB);
  r.sintoma_con_B_ausente = adA().report('reintentos', 'x4');
  await sleep(4000);
  r.no_llega_mientras_B_ausente = adB().inbox().length === 1;
  radio.unblock(nA, nB);
  try { biA.openChat(idB); } catch (e) {}
  r.bt_de_nuevo_s = await waitFor(() => !!biA._bleReadyFor(idB), 45000);
  r.llega_al_volver_s = await waitFor(() => adB().inbox().length === 2, 90000);
  r.pendiente_entregado = (adB().inbox()[0] || {}).sym === 'reintentos';

  // ===== (4) el desarrollador consigo mismo =====
  r.dev_propio = adB().report('error', 'propio') === 'local' && adB().inbox().length === 3 && (adB().inbox()[0] || {}).from === idB && (adB().inbox()[0] || {}).local === true;

  // ===== (5) pendiente viejo con el contacto alcanzable (barrido a mano) =====
  await A.win.vaultAppendMessage(idB, { msgId: 'viejo1', messageId: 'viejo1', content: 'viejo', _own: true, status: 'pending', timestamp: Date.now() - 120000, seq: 0 });
  const found = await adA().scan();
  r.barrido_detecta_viejo = !!(found && found.id === 'viejo1' && found.nx === idB);
  r.viejo_llega_s = await waitFor(() => adB().inbox().some((e) => e.sym === 'pendiente_viejo'), 40000);
  const again = await adA().scan();
  r.barrido_no_repite = again === null;
  // 2999: un archivo grande que no cabe por Bluetooth y espera Wi-Fi/internet a propósito NO es «pendiente viejo» (leído en un diagnóstico real por el canal)
  await A.win.vaultAppendMessage(idB, { msgId: 'grande1', messageId: 'grande1', content: JSON.stringify({ type: 'attachment', attachmentType: 'file', payload: null, meta: { name: 'x.apk', size: 30000000 } }), attachmentType: 'file', attachmentMeta: { name: 'x.apk', size: 30000000 }, _own: true, status: 'pending', timestamp: Date.now() - 600000, seq: 0 });
  const grande = await adA().scan();
  r.archivo_grande_esperando_no_cuenta = grande === null || (grande && grande.id !== 'grande1');

  // ===== (6) copiar y marcar vistos =====
  const txt = adB().text(true);
  r.texto_copiar_ok = txt.indexOf('DIAGNÓSTICO AUTOMÁTICO de ' + idA) >= 0 && txt.indexOf('síntoma: zombi') >= 0 && txt.indexOf('síntoma: pendiente_viejo') >= 0;
  r.nuevos_antes = adB().newCount();
  // A3 (2982): puntito en el icono de Perfil mientras haya diagnósticos sin leer; se quita al marcarlos vistos
  const dotB = () => B.win.document.getElementById('nexo-profile-badge');
  r.insignia_con_nuevos = !!dotB() && B.win.document.getElementById('nexo-profile-btn').getAttribute('data-badge') === String(r.nuevos_antes);
  r.insignia_solo_dev = !A.win.document.getElementById('nexo-profile-badge');
  adB().markSeen();
  r.nuevos_despues = adB().newCount();
  r.insignia_se_quita = !dotB() && !B.win.document.getElementById('nexo-profile-btn').hasAttribute('data-badge');
  r.sin_contenido_de_mensajes = txt.indexOf('hola B') < 0 && txt.indexOf('hola A') < 0;

  r.errores = logs.filter((l) => / error: /.test(l) && !/JSDOMERROR|styles\.css|Not implemented|GLOBAL TIMEOUT|Assembly timeout|net::ERR|fetch/.test(l)).slice(0, 5);
  const nums = ['emparejados_s', 'llega_a_B_s', 'A_ve_tick_s', 'bt_de_nuevo_s', 'llega_al_volver_s', 'viejo_llega_s'];
  const ok = r.modulo_activo && nums.every((k) => typeof r[k] === 'number') && r.evento_sintoma_manda && r.remitente_ok && r.sintoma_ok && r.texto_es_diagnostico && r.sin_burbuja_en_B && r.sin_burbuja_en_A &&
    r.estado_enviado && r.mismo_sintoma_repetido && r.otro_sintoma_espera_2h && r.apagado_no_manda && r.tope_diario && r.bandeja_B_sigue_1 && r.B_fuera && r.sintoma_con_B_ausente === 'enviado' &&
    r.no_llega_mientras_B_ausente && r.pendiente_entregado && r.dev_propio && r.barrido_detecta_viejo && r.barrido_no_repite && r.archivo_grande_esperando_no_cuenta && r.texto_copiar_ok && r.nuevos_antes === 4 && r.nuevos_despues === 0 && r.insignia_con_nuevos && r.insignia_solo_dev && r.insignia_se_quita && r.sin_contenido_de_mensajes && !r.errores.length;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('AUTODIAG ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_autodiag.txt'), logs.join('\n'));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('AUTODIAG ' + JSON.stringify({ prueba: 'autodiag', resultado: 'FALLO', error: String(e && e.message).replace(/"/g, "'") })); console.error(e && e.stack); fs.writeFileSync(path.join(__dirname, 'last_logs_autodiag.txt'), logs.join('\n')); process.exit(1); });
