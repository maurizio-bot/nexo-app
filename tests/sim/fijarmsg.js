// 3219 (dueño 17-11: funciones de WhatsApp dentro del chat): FIJAR mensajes dentro del chat, para los dos. Mantener pulsado → «Fijar» /
// «Desfijar»; hasta 3 por chat; una franja arriba del chat con el último fijado que al tocarla salta a ese mensaje y rota entre los
// fijados. Viaja como «Editar»: acción oculta cifrada (nexo_act act:'pin', con su hora), sin aviso ni «no leído». A, B y C por Bluetooth:
//  F1  1-a-1: A fija un mensaje → franja en A («Mensaje fijado» y su texto); a B le llega (franja al abrir el chat) sin aviso (tampoco
//      del nativo en segundo plano), sin «no leído» y sin subir el chat; el menú de A ofrece «Desfijar»;
//  F2  3 fijados: la franja muestra el último (3 rayitas, «1/3»); tocarla salta a ese mensaje (resaltado) y pasa al siguiente, y así rota;
//  F3  un cuarto: se quita el más antiguo (con aviso) en A y en B;
//  F4  B desfija uno → se va también en A (y su franja);
//  F5  gana el más nuevo: uno viejo, repetido o de otro id raro no cambia nada;
//  F6  GRUPO de 3: B fija un mensaje de A → A y C lo ven fijado (cada uno su copia) con su franja; C lo desfija → A y B; uno de fuera
//      del grupo no puede fijar;
//  F7  el fijado llega ANTES que su mensaje: la franja sale cuando llega el mensaje;
//  F8  (opcional, FIJAR_OLD_BUILD=<build de antes, p. ej. b3205>) un teléfono con la versión vieja lo ignora: ni lo muestra ni avisa ni
//      falla;
//  F9  tras reiniciar B siguen fijados (bóveda) y con su franja;
//  F10 los textos en los 5 idiomas y sin voseo.
// Contraprueba b3205: FALLO (sin «Fijar» en el menú ni franja). Imprime FIJARMSG {json}; last_logs_fijarmsg.txt.
// Uso: node fijarmsg.js <dir_build>
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone, installWebCrypto } = require('./native_mock');

const buildDir = path.resolve(process.argv[2] || path.join(__dirname, 'builds/wip'));
const oldBuild = process.env.FIJAR_OLD_BUILD ? path.resolve(process.env.FIJAR_OLD_BUILD) : '';
const base = { readsContentFallback: true, retain: ['onPayloadReceived'], closeOnNoService: true, pace: [15, 15], ioDelay: 25, asymmetric: true, noL2: true, noTor: true };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
class DL extends ResourceLoader { constructor(d) { super(); this.d = d; } fetch(u) { const f = path.join(this.d, decodeURIComponent(new URL(u).pathname)); return fs.existsSync(f) ? Promise.resolve(fs.readFileSync(f)) : Promise.reject(new Error('x')); } }
const logs = [];
const T0 = Date.now();
const ts = () => String(((Date.now() - T0) / 1000).toFixed(1)).padStart(6) + 's';
const VOSEO = /(^|[^a-záéíóúüñ])(mirá|tocá|fijá|podés|tenés|vos)(?![a-záéíóúüñ])/i;
async function boot(name, native, dir) {
  native.listeners = new Map();
  const bd = dir || buildDir;
  const vc = new VirtualConsole();
  ['log', 'warn', 'error'].forEach((l) => vc.on(l, (...a) => logs.push(`${ts()} [${name}] ${l}: ` + a.map(String).join(' ').substring(0, 300))));
  const dom = new JSDOM(fs.readFileSync(path.join(bd, 'dist', 'index.html'), 'utf8'), {
    url: 'https://' + name.toLowerCase() + '.nexo.test/index.html', runScripts: 'dangerously', resources: new DL(path.join(bd, 'dist')), pretendToBeVisual: true, virtualConsole: vc,
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
async function openChat(p, cid) { try { await p.win.bleInterface.openChat(cid); } catch (e) {} await sleep(700); }
async function openGroup(p, gid) { if (p.win.NEXO_openGroupChat) p.win.NEXO_openGroupChat(gid); await sleep(700); }
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
async function ownWith(p, cid, re) { let m = null; await waitFor(async () => !!(m = (await msgsOf(p, cid)).filter((x) => x._own && !x.hidden && re.test(String(x.content))).pop()), 15000); return m; }
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
async function pinLabel(p, id) { if (!(await bubbleMenu(p, id))) return 'sin_menu'; const it = $(p, '#nexo-msg-menu .mm-pin'); const l = it ? it.textContent.trim() : null; dismiss(p); return l; }
async function pin(p, id) { if (!(await bubbleMenu(p, id))) return false; const it = $(p, '#nexo-msg-menu .mm-pin'); if (!it) { dismiss(p); return false; } click(p.win, it); await sleep(500); return true; }
const pinsOf = (p, cid) => (p.win.__nexoPins ? p.win.__nexoPins.pinsOf(cid) : null);
const bar = (p) => { const b = $(p, '#nexo-pin-bar'); return b ? { id: b.dataset.msgId, lbl: (b.querySelector('.pb-lbl') || {}).textContent, msg: (b.querySelector('.pb-msg') || {}).textContent, ticks: b.querySelectorAll('.pb-ticks span').length, on: Array.from(b.querySelectorAll('.pb-ticks span')).findIndex((s) => s.classList.contains('on')) } : null; };
const highlighted = (p, id) => { const el = $(p, '.message[data-msg-id="' + id + '"]'); return !!(el && el.classList.contains('msg-highlight')); };
const contactOf = (p, nx) => (p.win.vaultLoadContacts() || []).find((c) => String(c.nexoId || '').toLowerCase() === nx) || {};
const unreadOf = (p, cid) => { try { const u = (p.win.bleInterface.unreadSummary() || []).find((x) => String(x.chatId).toLowerCase() === cid); return u ? u.count : 0; } catch (e) { return -1; } };
const hiddenPins = async (p, cid) => (await msgsOf(p, cid)).filter((m) => m.hidden && /"act":"pin"/.test(String(m.content)));
function inject(p, from, act) {
  p.win.dispatchEvent(new p.win.CustomEvent('nexo:ble:messageReceived', { detail: { content: JSON.stringify(act), senderNexoId: from, deviceUUID: from, messageId: 'inj' + Date.now() + Math.random().toString(36).slice(2, 6), timestamp: Date.now(), e2e: true } }));
}
// Retener lo que llega (ya descifrado) con una marca, hasta soltarlo (como editar.js): el fijado llega antes que su mensaje
function installHold(P) {
  const hold = { tokens: new Set(), items: [] };
  const bi = P.win.bleInterface, hp = bi._handlePayload;
  bi._handlePayload = function (d) {
    try { const c = String((d && (d.content || d.data)) || ''); for (const tk of hold.tokens) if (c.indexOf(tk) >= 0 && c.indexOf('nexo_act') < 0) { hold.items.push({ tk, d, orig: hp, bi }); return; } } catch (e) {}
    return hp.apply(this, arguments);
  };
  hold.release = (tk) => { hold.items.filter((x) => x.tk === tk).forEach((x) => x.orig.call(x.bi, x.d)); hold.items = hold.items.filter((x) => x.tk !== tk); hold.tokens.delete(tk); };
  hold.held = (tk) => hold.items.some((x) => x.tk === tk);
  return hold;
}

(async () => {
  const r = { prueba: 'fijarmsg', build: path.basename(buildDir) };
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', Object.assign({}, base)), nB = new NativePhone('B', 'BB:BB:BB:BB:BB:02', Object.assign({}, base)), nC = new NativePhone('C', 'CC:CC:CC:CC:CC:03', Object.assign({}, base));
  [nA, nB, nC].forEach((n) => { radio.add(n); n.load(); });
  const A = await boot('A', nA); let B = await boot('B', nB); const C = await boot('C', nC);
  const idA = A.win.bleInterface.localNexoId.toLowerCase(), idB = B.win.bleInterface.localNexoId.toLowerCase(), idC = C.win.bleInterface.localNexoId.toLowerCase();
  A.win.bleInterface.togglePanel(); const okB = await addFound(A, 'B'); const okC = await addFound(A, 'C'); A.win.bleInterface.togglePanel();
  if (!okB || !okC) { console.log('FIJARMSG ' + JSON.stringify(Object.assign(r, { resultado: 'FALLO', error: 'no empareja' }))); fs.writeFileSync(path.join(__dirname, 'last_logs_fijarmsg.txt'), logs.join('\n')); process.exit(1); }
  await openChat(A, idB); typeSend(A, 'hola B'); await sleep(1500); await closeChat(A);
  await openChat(A, idC); typeSend(A, 'hola C'); await sleep(1500); await closeChat(A);
  r.contactos_s = await waitFor(() => !!contactOf(B, idA).nexoId && !!contactOf(C, idA).nexoId, 20000);
  await openChat(B, idA); typeSend(B, 'hola A'); await sleep(1500); await closeChat(B);
  await openChat(C, idA); typeSend(C, 'hola A, soy C'); await sleep(1500); await closeChat(C);
  await sleep(2500); // kx con fx (entienden acciones)

  // ---------- F1: A fija; a B le llega sin aviso ----------
  await openChat(A, idB);
  const m = [];
  for (let i = 1; i <= 4; i++) { typeSend(A, '[F] mensaje ' + i); m.push(await ownWith(A, idB, new RegExp('\\[F\\] mensaje ' + i + '$'))); await sleep(700); }
  r.F1_llegan_s = await waitFor(async () => { for (const x of m) if (!(x && await byId(B, idA, x.msgId))) return false; return true; }, 30000);
  await sleep(2500);
  const n1 = nB.notifLog.length, u1 = unreadOf(B, idA), at1 = contactOf(B, idA).lastMessageAt, hid1 = (await hiddenPins(A, idB)).length;
  nB.setAppActive(false); // segundo plano: el nativo avisaría a los 4 s de lo que no sea callado
  r.F1_menu = await pinLabel(A, m[0].msgId);
  r.F1_fija = await pin(A, m[0].msgId);
  const b1 = bar(A);
  r.F1_franja_A = b1 ? [b1.lbl, b1.msg] : null;
  r.F1_menu_desfijar = await pinLabel(A, m[0].msgId);
  r.F1_accion_oculta = (await hiddenPins(A, idB)).length - hid1;
  r.F1_B_fijado_s = await waitFor(() => (pinsOf(B, idA) || []).indexOf(m[0].msgId) >= 0, 20000);
  await sleep(5500);
  nB.setAppActive(true);
  r.F1_B_avisos = nB.notifLog.slice(n1).map((x) => x.text || x.msgId);
  r.F1_B_no_leidos = unreadOf(B, idA) - u1;
  r.F1_B_no_sube = contactOf(B, idA).lastMessageAt === at1;
  r.F1_B_visibles = (await msgsOf(B, idA)).filter((x) => !x.hidden && /nexo_act|"pin"/.test(String(x.content))).length;
  await openChat(B, idA); await sleep(500);
  const bb1 = bar(B);
  r.F1_franja_B = bb1 ? [bb1.lbl, bb1.msg] : null;
  r.F1_ok = r.contactos_s !== null && r.F1_llegan_s !== null && r.F1_menu === 'Fijar' && r.F1_fija && !!b1 && b1.lbl === 'Mensaje fijado' && b1.msg === '[F] mensaje 1' && r.F1_menu_desfijar === 'Desfijar' &&
    r.F1_accion_oculta === 1 && r.F1_B_fijado_s !== null && r.F1_B_avisos.length === 0 && r.F1_B_no_leidos === 0 && r.F1_B_no_sube && r.F1_B_visibles === 0 && !!bb1 && bb1.msg === '[F] mensaje 1';

  // ---------- F2: 3 fijados; la franja muestra el último y rota al tocarla ----------
  await pin(A, m[1].msgId); await sleep(200); await pin(A, m[2].msgId);
  const b2 = bar(A);
  r.F2_franja = b2 ? [b2.lbl, b2.msg, b2.ticks, b2.on] : null;
  const seq = [];
  for (let i = 0; i < 4; i++) {
    const cur = bar(A); if (!cur) break;
    click(A.win, $(A, '#nexo-pin-bar')); await sleep(400);
    seq.push({ salta: highlighted(A, cur.id), era: cur.msg, ahora: (bar(A) || {}).msg });
  }
  r.F2_rota = seq.map((x) => x.era + (x.salta ? ' ✓' : ' ✗')).join(' → ');
  r.F2_B_s = await waitFor(() => JSON.stringify(pinsOf(B, idA)) === JSON.stringify([m[2].msgId, m[1].msgId, m[0].msgId]), 20000);
  r.F2_ok = !!b2 && b2.lbl === 'Mensaje fijado · 1/3' && b2.msg === '[F] mensaje 3' && b2.ticks === 3 && b2.on === 0 &&
    r.F2_rota === '[F] mensaje 3 ✓ → [F] mensaje 2 ✓ → [F] mensaje 1 ✓ → [F] mensaje 3 ✓' && r.F2_B_s !== null;

  // ---------- F3: un cuarto quita el más antiguo ----------
  await pin(A, m[3].msgId);
  r.F3_aviso = (($(A, '#perm-error-toast') || {}).textContent) || '';
  r.F3_A = pinsOf(A, idB);
  r.F3_B_s = await waitFor(() => JSON.stringify(pinsOf(B, idA)) === JSON.stringify([m[3].msgId, m[2].msgId, m[1].msgId]), 20000);
  r.F3_ok = r.F3_aviso === 'Máximo 3 mensajes fijados: se quitó el más antiguo' && JSON.stringify(r.F3_A) === JSON.stringify([m[3].msgId, m[2].msgId, m[1].msgId]) && r.F3_B_s !== null;

  // ---------- F4: B desfija uno → también en A ----------
  r.F4_menu_B = await pinLabel(B, m[2].msgId);
  await pin(B, m[2].msgId);
  r.F4_B = pinsOf(B, idA);
  r.F4_A_s = await waitFor(() => JSON.stringify(pinsOf(A, idB)) === JSON.stringify([m[3].msgId, m[1].msgId]), 20000);
  await sleep(300);
  const b4 = bar(A);
  r.F4_franja_A = b4 ? [b4.ticks, b4.msg] : null;
  r.F4_ok = r.F4_menu_B === 'Desfijar' && JSON.stringify(r.F4_B) === JSON.stringify([m[3].msgId, m[1].msgId]) && r.F4_A_s !== null && !!b4 && b4.ticks === 2;

  // ---------- F5: gana el más nuevo; lo viejo, repetido o raro no cambia nada ----------
  const acts = (await hiddenPins(A, idB)).map((x) => JSON.parse(x.content));
  const first = acts.find((x) => x.id === m[0].msgId && x.on === 1);
  if (first) inject(B, idA, first);                                                        // repetido (y ya superado por el desfijado del cuarto)
  inject(B, idA, { type: 'nexo_act', act: 'pin', id: m[2].msgId, on: 1, ts: Date.now() - 3600000 }); // más viejo que el desfijado de B
  inject(B, idA, { type: 'nexo_act', act: 'pin', id: '<img onerror=x>', on: 1, ts: Date.now() + 1000 });
  inject(B, idA, { type: 'nexo_act', act: 'pin', on: 1, ts: Date.now() });
  await sleep(1500);
  r.F5_B = pinsOf(B, idA);
  r.F5_ok = JSON.stringify(r.F5_B) === JSON.stringify([m[3].msgId, m[1].msgId]);
  await closeChat(A); await closeChat(B);

  // ---------- F6: grupo de 3 ----------
  click(A.win, A.win.document.getElementById('nexo-new-group-btn')); await sleep(400);
  const sheet = A.win.document.getElementById('nexo-group-sheet');
  sheet.querySelectorAll('.nexo-pick-row input').forEach((cb) => { cb.checked = true; cb.dispatchEvent(new A.win.Event('change')); });
  const gnm = sheet.querySelector('#nexo-group-name'); gnm.value = 'Fijados'; gnm.dispatchEvent(new A.win.Event('input'));
  click(A.win, sheet.querySelector('#nexo-group-create')); await sleep(800);
  const gid = Object.keys(A.win.bleInterface.groups.list)[0];
  r.F6_grupo_s = await waitFor(() => !!(B.win.bleInterface.groups.get(gid) && C.win.bleInterface.groups.get(gid)), 60000);
  r.F6_se_conocen_s = await waitFor(() => !!contactOf(B, idC).nexoId && !!contactOf(C, idB).nexoId, 30000);
  await sleep(1500);
  typeSend(A, '[G] de A para fijar');
  const g1 = await ownWith(A, gid, /\[G\] de A para fijar/);
  const wB = g1 && (g1.msgId + '_' + idB.substring(2)), wC = g1 && (g1.msgId + '_' + idC.substring(2));
  r.F6_llega_s = await waitFor(async () => !!(g1 && await byId(B, gid, wB) && await byId(C, gid, wC)), 40000);
  await sleep(1500);
  await openGroup(B, gid);
  r.F6_menu_B = await pinLabel(B, wB);
  await pin(B, wB);
  r.F6_B = pinsOf(B, gid);
  r.F6_A_y_C_s = await waitFor(() => JSON.stringify(pinsOf(A, gid)) === JSON.stringify([g1.msgId]) && JSON.stringify(pinsOf(C, gid)) === JSON.stringify([wC]), 30000);
  await openGroup(C, gid); await sleep(300);
  const bc = bar(C);
  r.F6_franja_C = bc ? bc.msg : null;
  const bA = bar(A); // A tiene el grupo abierto (lo creó y escribió)
  r.F6_franja_A = bA ? bA.msg : null;
  // de fuera del grupo (y un miembro con un id que no es de grupo): nada
  inject(C, 'nxzzzzzzzz', { type: 'nexo_act', act: 'pin', id: g1.msgId, g: gid, on: 0, ts: Date.now() + 5000 });
  inject(C, idB, { type: 'nexo_act', act: 'pin', id: 'msg123456', g: gid, on: 1, ts: Date.now() + 5000 });
  await sleep(1200);
  r.F6_de_fuera_nada = JSON.stringify(pinsOf(C, gid)) === JSON.stringify([wC]);
  // C lo desfija → A y B
  await pin(C, wC);
  r.F6_desfijado_s = await waitFor(() => (pinsOf(A, gid) || []).length === 0 && (pinsOf(B, gid) || []).length === 0, 30000);
  await sleep(400);
  r.F6_sin_franja_A = !$(A, '#nexo-pin-bar');
  await closeChat(B); await closeChat(C); await closeChat(A);
  r.F6_ok = r.F6_grupo_s !== null && r.F6_llega_s !== null && r.F6_menu_B === 'Fijar' && JSON.stringify(r.F6_B) === JSON.stringify([wB]) && r.F6_A_y_C_s !== null &&
    r.F6_franja_C === '[G] de A para fijar' && r.F6_franja_A === '[G] de A para fijar' && r.F6_de_fuera_nada && r.F6_desfijado_s !== null && r.F6_sin_franja_A;

  // ---------- F7: el fijado llega antes que su mensaje ----------
  const holdB = installHold(B);
  holdB.tokens.add('[F7]');
  await openChat(A, idB); await openChat(B, idA);
  typeSend(A, '[F7] llega tarde');
  const m7 = await ownWith(A, idB, /\[F7\]/);
  r.F7_retenido_s = await waitFor(() => holdB.held('[F7]'), 20000);
  await pin(A, m7.msgId);
  r.F7_fijado_antes_s = await waitFor(() => (pinsOf(B, idA) || []).indexOf(m7.msgId) >= 0, 20000);
  r.F7_franja_antes = (bar(B) || {}).msg || null;
  holdB.release('[F7]');
  r.F7_franja_al_llegar_s = await waitFor(() => (bar(B) || {}).msg === '[F7] llega tarde', 15000);
  r.F7_ok = r.F7_retenido_s !== null && r.F7_fijado_antes_s !== null && r.F7_franja_antes !== '[F7] llega tarde' && r.F7_franja_al_llegar_s !== null;
  await closeChat(B);

  // ---------- F8 (opcional): un teléfono con la versión vieja lo ignora ----------
  if (oldBuild && fs.existsSync(path.join(oldBuild, 'dist', 'index.html'))) {
    const nD = new NativePhone('D', 'DD:DD:DD:DD:DD:04', Object.assign({}, base)); radio.add(nD); nD.load();
    const D = await boot('D', nD, oldBuild); const idD = D.win.bleInterface.localNexoId.toLowerCase();
    A.win.bleInterface.togglePanel(); const okD = await addFound(A, 'D'); A.win.bleInterface.togglePanel();
    await closeChat(A); await openChat(A, idD); typeSend(A, 'hola D'); await sleep(1500);
    await waitFor(() => !!contactOf(D, idA).nexoId, 20000);
    await openChat(D, idA); typeSend(D, 'hola A'); await sleep(2500);
    typeSend(A, '[F8] para la vieja');
    const m8 = await ownWith(A, idD, /\[F8\]/);
    await waitFor(async () => !!(m8 && await byId(D, idA, m8.msgId)), 20000);
    await sleep(1000);
    const nD0 = nD.notifLog.length, hD = (await hiddenPins(A, idD)).length;
    await pin(A, m8.msgId);
    await sleep(4000);
    const errD = logs.filter((l) => l.indexOf('[D] error:') >= 0 && !/JSDOMERROR|styles\.css|Not implemented|net::ERR|fetch/.test(l));
    r.F8 = { build_vieja: path.basename(oldBuild), empareja: okD, accion_enviada: (await hiddenPins(A, idD)).length - hD, visibles_en_D: (await msgsOf(D, idA)).filter((x) => !x.hidden && /nexo_act|"pin"/.test(String(x.content))).length,
      burbujas_raras: Array.from(D.win.document.querySelectorAll('#messages-container .message')).filter((x) => /nexo_act|"act"/.test(x.textContent)).length, avisos: nD.notifLog.length - nD0, errores: errD.length };
    r.F8_ok = r.F8.empareja && r.F8.accion_enviada === 1 && r.F8.visibles_en_D === 0 && r.F8.burbujas_raras === 0 && r.F8.avisos === 0 && r.F8.errores === 0;
    await closeChat(D);
  } else { r.F8 = 'sin build vieja (FIJAR_OLD_BUILD)'; r.F8_ok = true; }

  // ---------- F9: tras reiniciar B siguen fijados ----------
  B.win.close(); nB.destroyActivity(); await sleep(1500); nB.load(); B = await boot('B', nB);
  await sleep(500);
  r.F9_B = pinsOf(B, idA);
  await openChat(B, idA); await sleep(600);
  const b9 = bar(B);
  r.F9_franja = b9 ? b9.msg : null;
  r.F9_ok = JSON.stringify(r.F9_B) === JSON.stringify([m7.msgId, m[3].msgId, m[1].msgId]) && r.F9_franja === '[F7] llega tarde';

  // ---------- F10: 5 idiomas sin voseo ----------
  const { importSrc } = require('./srcmod');
  r.F10 = {}; let f10 = true;
  const strip = (s) => String(s || '').replace(/^[^\p{L}\p{N}]+/u, '').trim();
  for (const l of ['es', 'it', 'en', 'pt', 'fr']) {
    const T = (await importSrc('ui/i18n/' + l + '.js')).default;
    B.win.NEXO_FORCE_LANG = l;
    const on = await pinLabel(B, m[1].msgId), off = await pinLabel(B, m[0].msgId);
    await closeChat(B); await openChat(B, idA); await sleep(400);
    const lbl = (bar(B) || {}).lbl || '';
    const ok = on === strip(T.chat_unpin) && off === strip(T.chat_pin) && lbl.indexOf(T.pin_label) === 0 && !!T.pin_max && !VOSEO.test([on, off, lbl, T.pin_max].join(' '));
    r.F10[l] = ok ? [off, on, lbl].join(' | ') : { on, off, lbl };
    f10 = f10 && ok;
  }
  B.win.NEXO_FORCE_LANG = 'es';
  r.F10_ok = f10 && VOSEO.test('fijá') && !VOSEO.test('fija');

  r.errores = logs.filter((l) => / error: /.test(l) && l.indexOf('[D]') < 0 && !/JSDOMERROR|styles\.css|Not implemented|GLOBAL TIMEOUT|net::ERR|fetch/.test(l)).slice(0, 5);
  const ok = r.F1_ok && r.F2_ok && r.F3_ok && r.F4_ok && r.F5_ok && r.F6_ok && r.F7_ok && r.F8_ok && r.F9_ok && r.F10_ok && !r.errores.length;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('FIJARMSG ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_fijarmsg.txt'), logs.join('\n'));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('FIJARMSG ' + JSON.stringify({ prueba: 'fijarmsg', resultado: 'FALLO', error: String(e && e.message).replace(/"/g, "'") })); console.error(e && e.stack); fs.writeFileSync(path.join(__dirname, 'last_logs_fijarmsg.txt'), logs.join('\n')); process.exit(1); });
