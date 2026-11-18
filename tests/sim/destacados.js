// 3219 (dueño 17-11: funciones de WhatsApp dentro del chat): mensajes DESTACADOS (estrella), solo en este teléfono. A y B por Bluetooth:
//  D1  mantener pulsado un mensaje (propio o recibido) → «Destacar» → se guarda (starred) y sale la estrellita junto a la hora; el
//      menú ofrece entonces «Quitar destacado»;
//  D2  es SOLO local: no viaja nada al otro (ninguna acción oculta nueva) y en B ese mensaje no está destacado;
//  D3  tocar el círculo de la cabecera → «Mensajes destacados»: la lista de los de este chat (el más nuevo arriba, «Tú» o el nombre de
//      quien lo escribió, su texto); al tocar uno se cierra y salta a él en el chat (resaltado);
//  D4  uno destacado más arriba de lo dibujado (80 mensajes después): al tocarlo en la lista se cargan las páginas anteriores y salta;
//  D5  «Quitar destacado»: se va la estrella y sale de la lista; sin ninguno, la lista lo dice;
//  D6  un destacado «eliminado para todos» no sale en la lista ni lleva estrella;
//  D7  tras reiniciar A sigue destacado (bóveda) y con su estrella;
//  D8  los textos en los 5 idiomas y sin voseo.
// Contraprueba b3205: FALLO (sin «Destacar» en el menú ni lista de destacados). Imprime DESTACADOS {json}; last_logs_destacados.txt.
// Uso: node destacados.js <dir_build>
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone, installWebCrypto } = require('./native_mock');

const buildDir = path.resolve(process.argv[2] || path.join(__dirname, 'builds/wip'));
const base = { readsContentFallback: true, retain: ['onPayloadReceived'], closeOnNoService: true, pace: [15, 15], ioDelay: 25, asymmetric: true, noL2: true, noTor: true };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
class DL extends ResourceLoader { constructor(d) { super(); this.d = d; } fetch(u) { const f = path.join(this.d, decodeURIComponent(new URL(u).pathname)); return fs.existsSync(f) ? Promise.resolve(fs.readFileSync(f)) : Promise.reject(new Error('x')); } }
const logs = [];
const T0 = Date.now();
const ts = () => String(((Date.now() - T0) / 1000).toFixed(1)).padStart(6) + 's';
const VOSEO = /(^|[^a-záéíóúüñ])(mirá|tocá|mantené|podés|tenés|destacá|vos)(?![a-záéíóúüñ])/i;
async function boot(name, native) {
  native.listeners = new Map();
  const vc = new VirtualConsole();
  ['log', 'warn', 'error'].forEach((l) => vc.on(l, (...a) => logs.push(`${ts()} [${name}] ${l}: ` + a.map(String).join(' ').substring(0, 300))));
  const dom = new JSDOM(fs.readFileSync(path.join(buildDir, 'dist', 'index.html'), 'utf8'), {
    url: 'https://' + name.toLowerCase() + '.nexo.test/index.html', runScripts: 'dangerously', resources: new DL(path.join(buildDir, 'dist')), pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) {
      win.CapacitorCustomPlatform = { name: 'android' }; installWebCrypto(win);
      win.Capacitor = { Plugins: { NexoBLE: native.plugin() } }; win.HTMLElement.prototype.scrollTo = function () {}; win.HTMLElement.prototype.scrollIntoView = function () {};
    },
  });
  const win = dom.window;
  for (let i = 0; i < 100 && !(win.NEXO && win.NEXO.initialized); i++) await sleep(100);
  await sleep(800);
  return { name, native, win };
}
const click = (win, el) => el && el.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
const $ = (p, sel) => p.win.document.querySelector(sel);
async function openChat(p, cid) { try { await p.win.bleInterface.openChat(cid); } catch (e) {} await sleep(800); }
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
async function msgsOf(p, cid) { try { return (await p.win.vaultLoadMessages(cid)) || []; } catch (e) { return []; } }
async function find(p, cid, re, own) { let m = null; await waitFor(async () => !!(m = (await msgsOf(p, cid)).filter((x) => !x.hidden && (own === undefined || !!x._own === own) && re.test(String(x.content))).pop()), 30000); return m; }
const byId = async (p, cid, id) => (await msgsOf(p, cid)).find((m) => (m.msgId || m.messageId) === id) || null;
async function bubbleMenu(p, msgId) {
  const el = $(p, '.message[data-msg-id="' + msgId + '"]');
  if (!el) return false;
  (el.querySelector('.msg-content') || el).dispatchEvent(new p.win.MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
  for (let i = 0; i < 20 && !$(p, '#nexo-msg-menu'); i++) await sleep(100);
  await sleep(150);
  return !!$(p, '#nexo-msg-menu');
}
const dismiss = (p) => { const m = $(p, '#nexo-msg-menu'); if (m) m.remove(); };
async function starLabel(p, id) { if (!(await bubbleMenu(p, id))) return 'sin_menu'; const it = $(p, '#nexo-msg-menu .mm-star'); const l = it ? it.textContent.trim() : null; dismiss(p); return l; }
async function star(p, id) { if (!(await bubbleMenu(p, id))) return false; const it = $(p, '#nexo-msg-menu .mm-star'); if (!it) { dismiss(p); return false; } click(p.win, it); await sleep(500); return true; }
const starInBubble = (p, id) => !!$(p, '.message[data-msg-id="' + id + '"] .msg-meta .msg-star');
async function openStarred(p) {
  click(p.win, $(p, '#chat-contact-avatar')); await sleep(250);
  click(p.win, $(p, '#nexo-chat-menu .chat-starred'));
  await waitFor(() => !!$(p, '#nexo-starred-sheet') && !!($(p, '#nexo-starred-sheet .nx-starred-row') || $(p, '#nexo-starred-sheet .nx-starred-empty')), 5000);
  return Array.from(p.win.document.querySelectorAll('#nexo-starred-sheet .nx-starred-row')).map((x) => ({ id: x.dataset.msgId, who: (x.querySelector('.nx-starred-who') || {}).textContent, txt: (x.querySelector('.nx-starred-txt') || {}).textContent }));
}
const closeStarred = (p) => { const s = $(p, '#nexo-starred-sheet'); if (s) s.remove(); };
const highlighted = (p, id) => { const el = $(p, '.message[data-msg-id="' + id + '"]'); return !!(el && el.classList.contains('msg-highlight')); };

(async () => {
  const r = { prueba: 'destacados', build: path.basename(buildDir) };
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', Object.assign({}, base)), nB = new NativePhone('B', 'BB:BB:BB:BB:BB:02', Object.assign({}, base));
  [nA, nB].forEach((n) => { radio.add(n); n.load(); });
  let A = await boot('A', nA); const B = await boot('B', nB);
  const idA = A.win.bleInterface.localNexoId.toLowerCase(), idB = B.win.bleInterface.localNexoId.toLowerCase();
  A.win.bleInterface.togglePanel(); const okB = await addFound(A, 'B'); A.win.bleInterface.togglePanel();
  if (!okB) { console.log('DESTACADOS ' + JSON.stringify(Object.assign(r, { resultado: 'FALLO', error: 'no empareja' }))); fs.writeFileSync(path.join(__dirname, 'last_logs_destacados.txt'), logs.join('\n')); process.exit(1); }
  await openChat(A, idB); typeSend(A, 'hola B'); await sleep(1500);
  r.emparejados_s = await waitFor(async () => (await msgsOf(B, idA)).some((m) => m.content === 'hola B'), 30000);
  await openChat(B, idA); typeSend(B, 'hola A'); await sleep(1500);
  const nameB = ((A.win.vaultLoadContacts() || []).find((c) => String(c.nexoId || '').toLowerCase() === idB) || {}).name || '';

  // ---------- D1: destacar uno propio y uno recibido ----------
  typeSend(A, '[D1] primero de A');
  const a1 = await find(A, idB, /\[D1\] primero de A/, true);
  await sleep(1200);
  typeSend(B, '[D1] uno de B');
  const b1 = await find(A, idB, /\[D1\] uno de B/, false);
  await sleep(800);
  const hid0 = (await msgsOf(A, idB)).filter((m) => m.hidden).length;
  r.D1_menu = a1 ? await starLabel(A, a1.msgId) : 'sin_mensaje';
  r.D1_destaca = a1 ? await star(A, a1.msgId) : false;
  r.D1_guardado = !!(a1 && ((await byId(A, idB, a1.msgId)) || {}).starred === true);
  r.D1_estrella = a1 ? starInBubble(A, a1.msgId) : false;
  r.D1_estrella_antes_de_la_hora = !!(a1 && (() => { const m = $(A, '.message[data-msg-id="' + a1.msgId + '"] .msg-meta'); return m && m.firstElementChild && m.firstElementChild.classList.contains('msg-star'); })());
  r.D1_menu_quitar = a1 ? await starLabel(A, a1.msgId) : null;
  r.D1_destaca_recibido = b1 ? await star(A, b1.msgId) : false;
  r.D1_recibido_guardado = !!(b1 && ((await byId(A, idB, b1.msgId)) || {}).starred === true) && starInBubble(A, b1.msgId);
  r.D1_ok = r.emparejados_s !== null && r.D1_menu === 'Destacar' && r.D1_destaca && r.D1_guardado && r.D1_estrella && r.D1_estrella_antes_de_la_hora && r.D1_menu_quitar === 'Quitar destacado' && r.D1_destaca_recibido && r.D1_recibido_guardado;

  // ---------- D2: solo local ----------
  await sleep(2500);
  r.D2_sin_acciones_nuevas = (await msgsOf(A, idB)).filter((m) => m.hidden).length === hid0;
  r.D2_B_no_destacado = !!(a1 && (await byId(B, idA, a1.msgId)) && !(await byId(B, idA, a1.msgId)).starred);
  r.D2_ok = r.D2_sin_acciones_nuevas && r.D2_B_no_destacado;

  // ---------- D3: la lista y saltar ----------
  const l3 = await openStarred(A);
  r.D3_lista = l3.map((x) => x.who + ': ' + x.txt);
  r.D3_titulo = (($(A, '#nexo-starred-sheet .nx-page-title') || {}).textContent) || '';
  const row = A.win.document.querySelector('#nexo-starred-sheet .nx-starred-row[data-msg-id="' + (a1 && a1.msgId) + '"]');
  click(A.win, row); await sleep(300);
  r.D3_cierra = !$(A, '#nexo-starred-sheet');
  r.D3_salta = a1 ? highlighted(A, a1.msgId) : false;
  r.D3_ok = r.D3_lista.length === 2 && r.D3_lista[0] === nameB + ': [D1] uno de B' && r.D3_lista[1] === 'Tú: [D1] primero de A' && r.D3_titulo === 'Mensajes destacados' && r.D3_cierra && r.D3_salta;

  // ---------- D6: un destacado eliminado para todos no sale ----------
  typeSend(A, '[D6] se va a eliminar');
  const a6 = await find(A, idB, /\[D6\]/, true);
  await sleep(800);
  if (a6) await star(A, a6.msgId);
  r.D6_destacado = !!(a6 && ((await byId(A, idB, a6.msgId)) || {}).starred);
  if (a6 && await bubbleMenu(A, a6.msgId)) click(A.win, $(A, '#nexo-msg-menu .mm-del-all'));
  await waitFor(async () => !!(a6 && ((await byId(A, idB, a6.msgId)) || {}).deleted), 10000);
  await sleep(600);
  const l6 = await openStarred(A); closeStarred(A);
  r.D6_fuera_de_la_lista = !l6.some((x) => a6 && x.id === a6.msgId);
  r.D6_sin_estrella = !(a6 && starInBubble(A, a6.msgId));
  r.D6_sin_menu = a6 ? (await starLabel(A, a6.msgId)) === null : false;
  r.D6_ok = r.D6_destacado && r.D6_fuera_de_la_lista && r.D6_sin_estrella && r.D6_sin_menu;

  // ---------- D7: tras reiniciar A sigue destacado ----------
  await closeChat(A);
  A.win.close(); nA.destroyActivity(); await sleep(1500); nA.load(); A = await boot('A', nA);
  r.D7_guardado = !!(b1 && ((await byId(A, idB, b1.msgId)) || {}).starred);
  await openChat(A, idB); await sleep(1200);
  r.D7_estrella = !!(b1 && starInBubble(A, b1.msgId));

  // ---------- D5: quitar destacado; sin ninguno, la lista lo dice ----------
  r.D5_quita = b1 ? await star(A, b1.msgId) : false;
  r.D5_sin_estrella = !!(b1 && !starInBubble(A, b1.msgId) && !((await byId(A, idB, b1.msgId)) || {}).starred);
  const l5 = await openStarred(A); closeStarred(A);
  r.D5_fuera = !l5.some((x) => b1 && x.id === b1.msgId);
  if (a1) await star(A, a1.msgId);
  await openStarred(A);
  r.D5_vacia = (($(A, '#nexo-starred-sheet .nx-starred-empty') || {}).textContent) || '';
  closeStarred(A);
  r.D5_ok = r.D5_quita && r.D5_sin_estrella && r.D5_fuera && /Aún no hay mensajes destacados/.test(r.D5_vacia);
  r.D7_ok = r.D7_guardado && r.D7_estrella;

  // ---------- D8: 5 idiomas sin voseo ----------
  const { importSrc } = require('./srcmod');
  r.D8 = {}; let d8 = true;
  const strip = (s) => String(s || '').replace(/^[^\p{L}\p{N}]+/u, '').trim();
  for (const l of ['es', 'it', 'en', 'pt', 'fr']) {
    const T = (await importSrc('ui/i18n/' + l + '.js')).default;
    A.win.NEXO_FORCE_LANG = l;
    const lab = a1 ? await starLabel(A, a1.msgId) : null;
    await star(A, a1.msgId);
    const lab2 = await starLabel(A, a1.msgId);
    await star(A, a1.msgId);
    await openStarred(A);
    const title = (($(A, '#nexo-starred-sheet .nx-page-title') || {}).textContent) || '', empty = (($(A, '#nexo-starred-sheet .nx-starred-empty') || {}).textContent) || '';
    closeStarred(A);
    const ok = !!lab && lab === strip(T.chat_star) && lab2 === strip(T.chat_unstar) && title === T.star_title && empty === T.star_empty && !!T.msg_gone && !!T.star_mark && !VOSEO.test([lab, lab2, title, empty].join(' '));
    r.D8[l] = ok ? [lab, lab2, title].join(' | ') : { lab, lab2, title, empty };
    d8 = d8 && ok;
  }
  A.win.NEXO_FORCE_LANG = 'es';
  r.D8_ok = d8 && VOSEO.test('tocá') && !VOSEO.test('toca');

  // ---------- D4: uno destacado más arriba de lo dibujado ----------
  const now = Date.now(), mk = (k, o) => Object.assign({ msgId: 'msgd4' + k + now, messageId: 'msgd4' + k + now, contactNexoId: idB, _own: true, status: 'delivered', seq: 0 }, o);
  await A.win.vaultAppendMessage(idB, mk('viejo', { content: '[D4] viejo destacado', timestamp: now - 200000 }));
  await A.win.vaultPatchMessage(idB, 'msgd4viejo' + now, { starred: true }); // (el campo lo pone «Destacar»; al guardar uno nuevo no se copia)
  for (let i = 0; i < 80; i++) await A.win.vaultAppendMessage(idB, mk('r' + i, { content: '[D4] relleno ' + i, timestamp: now - 150000 + i * 1000 }));
  await closeChat(A); await openChat(A, idB); await sleep(1500);
  const oldId = 'msgd4viejo' + now;
  r.D4_no_dibujado = !$(A, '.message[data-msg-id="' + oldId + '"]');
  const l4 = await openStarred(A);
  r.D4_en_lista = l4.some((x) => x.id === oldId && x.txt === '[D4] viejo destacado');
  click(A.win, A.win.document.querySelector('#nexo-starred-sheet .nx-starred-row[data-msg-id="' + oldId + '"]'));
  r.D4_salta_s = await waitFor(() => highlighted(A, oldId), 15000);
  r.D4_estrella = starInBubble(A, oldId);
  r.D4_ok = r.D4_no_dibujado && r.D4_en_lista && r.D4_salta_s !== null && r.D4_estrella;

  r.errores = logs.filter((l) => / error: /.test(l) && !/JSDOMERROR|styles\.css|Not implemented|GLOBAL TIMEOUT|net::ERR|fetch/.test(l)).slice(0, 5);
  const ok = r.D1_ok && r.D2_ok && r.D3_ok && r.D4_ok && r.D5_ok && r.D6_ok && r.D7_ok && r.D8_ok && !r.errores.length;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('DESTACADOS ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_destacados.txt'), logs.join('\n'));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('DESTACADOS ' + JSON.stringify({ prueba: 'destacados', resultado: 'FALLO', error: String(e && e.message).replace(/"/g, "'") })); console.error(e && e.stack); fs.writeFileSync(path.join(__dirname, 'last_logs_destacados.txt'), logs.join('\n')); process.exit(1); });
