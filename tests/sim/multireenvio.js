// 3206 (dueño 17-11: «al reenviar hay que agregar la multiselección»): ya se podía reenviar UN mensaje a varios chats; ahora se eligen
// VARIOS mensajes y se reenvían juntos. A, B y C por Bluetooth. En el chat de A con B hay 3 textos de A, 1 de B y 1 eliminado para todos:
//  M1  el menú del mensaje (pulsación larga) trae «Seleccionar»; al tocarlo: barra arriba con ✕, «1 seleccionado» y «Reenviar», y el
//      mensaje marcado;
//  M2  tocar otros los marca (también uno recibido) y otra vez los desmarca; el eliminado no se marca (aviso); con la selección abierta
//      la pulsación larga marca en vez de abrir el menú y el doble toque no reacciona;
//  M3  «Reenviar» abre «Reenviar a…»; con C y B elegidos: la selección se cierra y a C le llegan los 3 elegidos EN EL ORDEN DEL CHAT
//      (aunque se marcaron desordenados) como reenviados, y a B también; lo no elegido no sale;
//  M4  la cierran: ✕, el gesto atrás (primero la hoja, luego la selección), quitar el último marcado y cambiar de chat;
//  M5  el reenvío de UN mensaje (sin seleccionar) sigue igual;
//  M6  los textos nuevos en los 5 idiomas.
// Imprime MULTIREENVIO {json} y escribe last_logs_multireenvio.txt. Contraprueba b3205: sin «Seleccionar» (FALLO).
// Uso: node multireenvio.js <dir_build>
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone, installWebCrypto } = require('./native_mock');

const buildDir = path.resolve(process.argv[2] || path.join(__dirname, 'builds/wip'));
const base = { readsContentFallback: true, retain: ['onPayloadReceived', 'onLanMessage', 'onLanUp', 'onLanDown'], closeOnNoService: true, pace: [15, 15], ioDelay: 25, asymmetric: true, noTor: true, wifi: null };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
class DL extends ResourceLoader { constructor(d) { super(); this.d = d; } fetch(u) { const f = path.join(this.d, decodeURIComponent(new URL(u).pathname)); return fs.existsSync(f) ? Promise.resolve(fs.readFileSync(f)) : Promise.reject(new Error('x')); } }
const logs = [];
const T0 = Date.now();
const ts = () => String(((Date.now() - T0) / 1000).toFixed(1)).padStart(6) + 's';
async function boot(name, native) {
  native.listeners = new Map();
  const vc = new VirtualConsole();
  ['log', 'warn', 'error'].forEach((l) => vc.on(l, (...a) => logs.push(`${ts()} [${name}] ${l}: ` + a.map(String).join(' ').substring(0, 300))));
  const dom = new JSDOM(fs.readFileSync(path.join(buildDir, 'dist', 'index.html'), 'utf8'), {
    url: 'https://' + name.toLowerCase() + '.nexo.test/index.html', runScripts: 'dangerously', resources: new DL(path.join(buildDir, 'dist')), pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) {
      win.NEXO_NET_RELAYS = []; win.CapacitorCustomPlatform = { name: 'android' }; installWebCrypto(win);
      win.Capacitor = { Plugins: { NexoBLE: native.plugin() } }; win.HTMLElement.prototype.scrollTo = function () {}; win.HTMLElement.prototype.scrollIntoView = function () {};
    },
  });
  const win = dom.window;
  for (let i = 0; i < 100 && !(win.NEXO && win.NEXO.initialized); i++) await sleep(100);
  await sleep(800);
  return { name, native, win };
}
const click = (win, el) => el && el.dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true }));
const $ = (p, sel) => p.win.document.querySelector(sel);
async function openChat(p, cid) { try { await p.win.bleInterface.openChat(cid); } catch (e) {} await sleep(600); }
async function closeChat(p) { p.win.dispatchEvent(new p.win.CustomEvent('nexo:ble:closeChat', { detail: {} })); await sleep(300); }
function typeSend(p, t) { const i = p.win.document.getElementById('message-input'); i.value = t; i.dispatchEvent(new p.win.Event('input', { bubbles: true })); click(p.win, p.win.document.getElementById('send-btn')); }
async function addFound(p, name) {
  let add = null;
  const find = () => { const row = Array.from(p.win.document.querySelectorAll('#ble-new-device > div')).find((d) => (d.querySelector('span') || {}).textContent === name); return row && row.querySelector('button'); };
  for (let i = 0; i < 400 && !add; i++) { await sleep(100); add = find(); if (!add && !p.win.bleInterface.isScanning) click(p.win, p.win.document.getElementById('ble-scan-btn')); }
  click(p.win, add); await sleep(2000);
  return !!add;
}
async function waitFor(fn, ms) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return Math.round((Date.now() - t0) / 100) / 10; await sleep(250); } return null; }
const bubble = (p, id) => $(p, '.message[data-msg-id="' + id + '"]');
async function longPress(p, id) { const el = bubble(p, id); if (!el) return false; (el.querySelector('.msg-content') || el).dispatchEvent(new p.win.MouseEvent('contextmenu', { bubbles: true, cancelable: true })); await sleep(400); return true; }
async function tap(p, id) { const el = bubble(p, id); if (!el) return false; click(p.win, el.querySelector('.msg-content') || el); await sleep(250); return true; }
async function msgsOf(p, cid) { try { return (await p.win.vaultLoadMessages(cid)) || []; } catch (e) { return []; } }
const plain = (c) => { try { const o = JSON.parse(c); if (o && o.type === 'nexo_txt') return o.t; } catch (e) {} return String(c || ''); };
async function ownWith(p, cid, re) { let m = null; await waitFor(async () => !!(m = (await msgsOf(p, cid)).filter((x) => x._own && !x.hidden && re.test(plain(x.content))).pop()), 10000); return m; }
const marked = (p) => Array.from(p.win.document.querySelectorAll('#messages-container .message.msg-selected')).map((e) => e.dataset.msgId);
const countText = (p) => ($(p, '#nexo-select-count') || {}).textContent || null;
const toastText = (p) => Array.from(p.win.document.querySelectorAll('body *')).filter((e) => e.children.length === 0 && /no se puede reenviar/i.test(e.textContent || '')).length > 0;
async function pickInSheet(p, names) {
  for (const nm of names) { const row = Array.from(p.win.document.querySelectorAll('#nexo-forward-sheet .fw-row')).find((r) => (r.querySelector('.fw-name') || {}).textContent === nm); const cb = row && row.querySelector('input[type=checkbox]'); if (!cb) return false; cb.checked = true; cb.dispatchEvent(new p.win.Event('change', { bubbles: true })); }
  return true;
}

(async () => {
  const r = { prueba: 'multireenvio', build: path.basename(buildDir) };
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', base), nB = new NativePhone('B', 'BB:BB:BB:BB:BB:02', base), nC = new NativePhone('C', 'CC:CC:CC:CC:CC:03', base);
  [nA, nB, nC].forEach((n) => { radio.add(n); n.load(); });
  const A = await boot('A', nA), B = await boot('B', nB), C = await boot('C', nC);
  const idA = A.win.bleInterface.localNexoId.toLowerCase(), idB = B.win.bleInterface.localNexoId.toLowerCase(), idC = C.win.bleInterface.localNexoId.toLowerCase();
  A.win.bleInterface.togglePanel(); const okB = await addFound(A, 'B'); const okC = await addFound(A, 'C'); A.win.bleInterface.togglePanel();
  const fin = (ok) => { r.resultado = ok ? 'OK' : 'FALLO'; console.log('MULTIREENVIO ' + JSON.stringify(r)); fs.writeFileSync(path.join(__dirname, 'last_logs_multireenvio.txt'), logs.join('\n')); process.exit(ok ? 0 : 1); };
  if (!okB || !okC) { r.error = 'no empareja'; fin(false); }
  await openChat(A, idC); typeSend(A, 'hola C'); await sleep(1500); await closeChat(A);
  await openChat(B, idA); typeSend(B, '[R] de B para A'); await sleep(1500); await closeChat(B);
  await openChat(A, idB);
  typeSend(A, '[1] primero'); await sleep(700);
  typeSend(A, '[2] segundo'); await sleep(700);
  typeSend(A, '[X] este no'); await sleep(700);
  typeSend(A, '[3] tercero'); await sleep(700);
  typeSend(A, '[D] se elimina'); await sleep(1500);
  const m1 = await ownWith(A, idB, /^\[1\]/), m2 = await ownWith(A, idB, /^\[2\]/), mX = await ownWith(A, idB, /^\[X\]/), m3 = await ownWith(A, idB, /^\[3\]/), mD = await ownWith(A, idB, /^\[D\]/);
  let mR = null; await waitFor(async () => !!(mR = (await msgsOf(A, idB)).find((x) => !x._own && /\[R\]/.test(plain(x.content)))), 15000);
  if (!m1 || !m2 || !mX || !m3 || !mD || !mR) { r.error = 'faltan mensajes'; fin(false); }
  await closeChat(A); await openChat(A, idB);
  // el [D] eliminado para todos (lápida)
  if (await longPress(A, mD.msgId)) click(A.win, $(A, '#nexo-msg-menu .mm-del-all'));
  await sleep(800);
  r.lapida = !!((await msgsOf(A, idB)).find((x) => x.msgId === mD.msgId && x.deleted));

  // ---- M1 ----
  await longPress(A, m2.msgId);
  r.M1_menu_seleccionar = !!$(A, '#nexo-msg-menu .mm-select');
  click(A.win, $(A, '#nexo-msg-menu .mm-select')); await sleep(400);
  r.M1_barra = !!$(A, '#nexo-select-bar') && !!$(A, '#nexo-select-close') && !!$(A, '#nexo-select-forward');
  r.M1_cuenta = countText(A);
  r.M1_marcado = marked(A).join(',') === m2.msgId;

  // ---- M2 ----
  await tap(A, m3.msgId); await tap(A, mR.msgId); await tap(A, m1.msgId);
  r.M2_tres_y_recibido = countText(A) === '4 seleccionados' && [m1, m2, m3, mR].every((m) => marked(A).indexOf(m.msgId) >= 0);
  await tap(A, mR.msgId);
  r.M2_desmarca = countText(A) === '3 seleccionados' && marked(A).indexOf(mR.msgId) < 0;
  await tap(A, mD.msgId); await sleep(300);
  r.M2_eliminado_no = countText(A) === '3 seleccionados' && marked(A).indexOf(mD.msgId) < 0 && toastText(A);
  await longPress(A, mX.msgId);
  r.M2_pulsacion_larga_marca = !$(A, '#nexo-msg-menu') && marked(A).indexOf(mX.msgId) >= 0 && countText(A) === '4 seleccionados';
  await longPress(A, mX.msgId);
  r.M2_pulsacion_larga_desmarca = !$(A, '#nexo-msg-menu') && marked(A).indexOf(mX.msgId) < 0;
  const reacts0 = JSON.stringify(((await msgsOf(A, idB)).find((x) => x.msgId === m1.msgId) || {}).reactions || null);
  await tap(A, m1.msgId); await tap(A, m1.msgId); await sleep(600); // doble toque: desmarca y vuelve a marcar, sin ❤️
  r.M2_doble_toque_sin_reaccion = JSON.stringify(((await msgsOf(A, idB)).find((x) => x.msgId === m1.msgId) || {}).reactions || null) === reacts0 && marked(A).indexOf(m1.msgId) >= 0;

  // ---- M3: reenviar a C y a B ----
  const cBefore = (await msgsOf(C, idA)).length, bBefore = (await msgsOf(B, idA)).length;
  click(A.win, $(A, '#nexo-select-forward')); await sleep(600);
  r.M3_hoja = !!$(A, '#nexo-forward-sheet');
  // el gesto atrás cierra primero la hoja y deja la selección
  r.M4_atras_hoja = A.win.__nexoHandleBack() === true && !$(A, '#nexo-forward-sheet') && !!$(A, '#nexo-select-bar');
  click(A.win, $(A, '#nexo-select-forward')); await sleep(600);
  r.M3_elige = await pickInSheet(A, ['C', 'B']);
  click(A.win, $(A, '#nexo-forward-sheet .fw-send')); await sleep(300);
  r.M3_cierra_seleccion = !$(A, '#nexo-select-bar') && marked(A).length === 0;
  const want = ['[1] primero', '[2] segundo', '[3] tercero'];
  const newIn = async (p, before) => (await msgsOf(p, idA)).slice(before).filter((x) => !x._own && !x.hidden).map((x) => plain(x.content));
  r.M3_C_llega_s = await waitFor(async () => (await newIn(C, cBefore)).length >= 3, 30000);
  r.M3_B_llega_s = await waitFor(async () => (await newIn(B, bBefore)).length >= 3, 30000);
  await sleep(1500);
  r.M3_C_orden = (await newIn(C, cBefore)).join(' | ');
  r.M3_B_orden = (await newIn(B, bBefore)).join(' | ');
  const fwC = (await msgsOf(C, idA)).slice(cBefore).filter((x) => !x._own && !x.hidden);
  r.M3_C_reenviados = fwC.length > 0 && fwC.every((x) => /"fw":1/.test(String(x.content)) || x.forwarded || x.fw);

  // ---- M4: ✕, atrás, quitar el último, cambiar de chat ----
  const sel = async (id) => { await longPress(A, id); click(A.win, $(A, '#nexo-msg-menu .mm-select')); await sleep(400); return !!$(A, '#nexo-select-bar'); };
  r.M4_x = (await sel(m1.msgId)) && (click(A.win, $(A, '#nexo-select-close')), await sleep(200), !$(A, '#nexo-select-bar') && marked(A).length === 0);
  r.M4_atras = (await sel(m1.msgId)) && A.win.__nexoHandleBack() === true && !$(A, '#nexo-select-bar') && marked(A).length === 0 && !!$(A, '#messages-container');
  r.M4_quitar_ultimo = (await sel(m1.msgId)) && (await tap(A, m1.msgId), !$(A, '#nexo-select-bar'));
  r.M4_cambiar_chat = (await sel(m1.msgId)) && (await closeChat(A), !$(A, '#nexo-select-bar'));
  await openChat(A, idB);
  r.M4_tras_cerrar_toque_normal = (await longPress(A, m3.msgId)) && !!$(A, '#nexo-msg-menu'); // el menú vuelve a abrirse
  const mm = $(A, '#nexo-msg-menu'); if (mm) mm.remove();

  // ---- M5: reenviar UN mensaje (sin seleccionar) ----
  const c5 = (await msgsOf(C, idA)).length;
  await longPress(A, m3.msgId); click(A.win, $(A, '#nexo-msg-menu .mm-forward')); await sleep(500);
  await pickInSheet(A, ['C']); click(A.win, $(A, '#nexo-forward-sheet .fw-send'));
  r.M5_uno_llega_s = await waitFor(async () => (await newIn(C, c5)).length >= 1, 20000);
  await sleep(1000);
  r.M5_solo_uno = (await newIn(C, c5)).join(' | ');

  // ---- M6: textos en 5 idiomas ----
  const T = A.win.NEXO_i18nTables || null;
  const keys = ['chat_select', 'chat_sel_one', 'chat_sel_many', 'chat_sel_max', 'chat_sel_cant'];
  const srcDir = path.join(__dirname, '..', '..', 'src', 'ui', 'i18n');
  r.M6_idiomas = ['es', 'it', 'en', 'pt', 'fr'].every((l) => { const s = fs.readFileSync(path.join(srcDir, l + '.js'), 'utf8'); return keys.every((k) => new RegExp('\\n  ' + k + ': "').test(s)); });
  void T;

  r.errores = logs.filter((l) => / error: /.test(l) && !/JSDOMERROR|styles\.css|Not implemented|GLOBAL TIMEOUT|net::ERR|fetch/.test(l)).slice(0, 5);
  const ok = r.lapida && r.M1_menu_seleccionar && r.M1_barra && r.M1_cuenta === '1 seleccionado' && r.M1_marcado &&
    r.M2_tres_y_recibido && r.M2_desmarca && r.M2_eliminado_no && r.M2_pulsacion_larga_marca && r.M2_pulsacion_larga_desmarca && r.M2_doble_toque_sin_reaccion &&
    r.M3_hoja && r.M3_elige && r.M3_cierra_seleccion && r.M3_C_llega_s !== null && r.M3_B_llega_s !== null &&
    r.M3_C_orden === want.join(' | ') && r.M3_B_orden === want.join(' | ') && r.M3_C_reenviados &&
    r.M4_atras_hoja && r.M4_x && r.M4_atras && r.M4_quitar_ultimo && r.M4_cambiar_chat && r.M4_tras_cerrar_toque_normal &&
    r.M5_uno_llega_s !== null && r.M5_solo_uno === '[3] tercero' && r.M6_idiomas && !r.errores.length;
  fin(ok);
})().catch((e) => { console.log('MULTIREENVIO ' + JSON.stringify({ prueba: 'multireenvio', resultado: 'FALLO', error: String(e && e.message).replace(/"/g, "'") })); console.error(e && e.stack); fs.writeFileSync(path.join(__dirname, 'last_logs_multireenvio.txt'), logs.join('\n')); process.exit(1); });
