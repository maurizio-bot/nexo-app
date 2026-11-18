// 3195 (dueño 17-11: «al pulsar un mensaje enviado agrega la posibilidad de editarlo»): mantener pulsado un mensaje PROPIO de texto
// → «Editar» → la caja se llena con su texto y sale la barra «Editando mensaje» (✕ cancela) → enviar guarda la edición. La edición
// viaja como acción oculta (nexo_act act:'edit', cifrada E2E como «eliminar para todos» y las reacciones) en 1-a-1 y en GRUPO.
// A, B y C por Bluetooth y con relés de internet (simulados). Casos:
//  E1  1-a-1 por Bluetooth: «Editar» en el menú, barra y caja con el texto; ✕ cancela sin mandar; un texto igual no manda nada;
//      la edición: el globo de A y el de B con el texto nuevo y «Editado» junto a la hora; en B sin aviso nuevo, sin «no leído»,
//      el chat no sube (misma hora en la lista) y la lista muestra el texto nuevo (era el último); la búsqueda encuentra el nuevo;
//  E2  1-a-1 por INTERNET (Bluetooth bloqueado entre los tres): llega igual; la acción sale callada (sin marca de mensaje nuevo
//      para el aviso nativo de internet, NetBg) y B no avisa;
//  E3  grupo de 3: A edita su mensaje y B y C lo ven editado (con «Editado»), sin aviso, sin «no leído», sin subir el grupo y con
//      «A: <texto nuevo>» en la lista (B y C con la app en segundo plano: tampoco avisa su parte nativa); B (que no creó el grupo)
//      edita el suyo y les llega a A y a C;
//  E4  la edición llega ANTES que su mensaje (se retiene el texto en el que recibe): en 1-a-1 y en grupo se aplica al llegar; en
//      el grupo, una edición FALSA de otro miembro que también esperaba no se aplica (gana la del autor);
//  E5  dos ediciones seguidas: gana la última; la más vieja que llega después (desordenada) o repetida no la pisa;
//  E6  en el grupo, una edición de otro miembro (o de alguien de fuera) del mensaje de A se ignora (suplantación);
//  E7  sin «Editar» en el menú: mensaje de más de 15 min, archivo, foto, sticker, reenviado, «ver una vez», eliminado para todos o
//      recibido; con «Editar» uno de 14 min y una respuesta (que al editarse conserva su cita); si al enviar ya pasaron los 15 min (+2 de margen
//      para escribir), avisa y el texto se queda en la caja, sin mandar nada;
//  E8  los textos («Editar», «Editando mensaje», «Editado» y el aviso de los 15 min) en los 5 idiomas y sin voseo;
//  E9  tras reiniciar B sigue editado (bóveda) y con «Editado»;
//  E10 una edición cuyo texto parece JSON del protocolo (p. ej. una foto) se guarda y se ve como TEXTO (no cambia el tipo del mensaje).
// (Que la barra «Editando mensaje» se VEA encima de la barra de escribir y su ✕ se pueda tocar lo mira pressall.js en Chromium: antes
// de la 3195 quedaba detrás.) Imprime EDITAR {json} y escribe last_logs_editar.txt.
// Contraprueba b3194: FALLO en todo salvo E2 (en grupo no hay «Editar», un sticker y un reenviado sí lo tienen, la edición vieja o
// desordenada pisa a la última, la respuesta pierde su cita, sin aviso de los 15 min, «editado» en minúscula).
// Uso: node editar.js <dir_build>
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone, installWebCrypto } = require('./native_mock');
const { NostrRelay } = require('./nostr_relay');

const buildDir = path.resolve(process.argv[2] || path.join(__dirname, 'builds/wip'));
const base = { readsContentFallback: true, retain: ['onPayloadReceived', 'onLanMessage', 'onLanUp', 'onLanDown'], closeOnNoService: true, pace: [15, 15], ioDelay: 25, asymmetric: true, noTor: true, wifi: null };
let RELAYS = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
class DL extends ResourceLoader { constructor(d) { super(); this.d = d; } fetch(u) { const f = path.join(this.d, decodeURIComponent(new URL(u).pathname)); return fs.existsSync(f) ? Promise.resolve(fs.readFileSync(f)) : Promise.reject(new Error('x')); } }
const logs = [];
const T0 = Date.now();
const ts = () => String(((Date.now() - T0) / 1000).toFixed(1)).padStart(6) + 's';
const VOSEO = /(^|[^a-záéíóúüñ])(mirá|confirmá|tocá|aceptá|abrí|podés|tenés|querés|editá|escribí|vos)(?![a-záéíóúüñ])/i;
async function boot(name, native) {
  native.listeners = new Map();
  const vc = new VirtualConsole();
  ['log', 'warn', 'error'].forEach((l) => vc.on(l, (...a) => logs.push(`${ts()} [${name}] ${l}: ` + a.map(String).join(' ').substring(0, 300))));
  const dom = new JSDOM(fs.readFileSync(path.join(buildDir, 'dist', 'index.html'), 'utf8'), {
    url: 'https://' + name.toLowerCase() + '.nexo.test/index.html', runScripts: 'dangerously', resources: new DL(path.join(buildDir, 'dist')), pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) {
      win.NEXO_NET_RELAYS = RELAYS.map((u) => u + '/?p=' + name); win.CapacitorCustomPlatform = { name: 'android' }; installWebCrypto(win);
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
async function openChat(p, cid) { try { await p.win.bleInterface.openChat(cid); } catch (e) {} await sleep(600); }
async function openGroup(p, gid) { p.win.NEXO_openGroupChat ? p.win.NEXO_openGroupChat(gid) : null; await sleep(600); }
async function closeChat(p) { p.win.dispatchEvent(new p.win.CustomEvent('nexo:ble:closeChat', { detail: {} })); await sleep(300); }
function typeIn(p, t) { const i = p.win.document.getElementById('message-input'); i.value = t; i.dispatchEvent(new p.win.Event('input', { bubbles: true })); }
function typeSend(p, t) { typeIn(p, t); click(p.win, p.win.document.getElementById('send-btn')); }
async function addFound(p, name) {
  let add = null;
  const find = () => { const row = Array.from(p.win.document.querySelectorAll('#ble-new-device > div')).find((d) => (d.querySelector('span') || {}).textContent === name); return row && row.querySelector('button'); };
  for (let i = 0; i < 400 && !add; i++) { await sleep(100); add = find(); if (!add && !p.win.bleInterface.isScanning) click(p.win, p.win.document.getElementById('ble-scan-btn')); }
  click(p.win, add); await sleep(2000);
  return !!add;
}
async function waitFor(fn, ms) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return Math.round((Date.now() - t0) / 100) / 10; await sleep(250); } return null; }
async function bubbleMenu(p, msgId) {
  const el = $(p, '.message[data-msg-id="' + msgId + '"]');
  if (!el) return false;
  (el.querySelector('.msg-content') || el).dispatchEvent(new p.win.MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
  for (let i = 0; i < 20 && !$(p, '#nexo-msg-menu'); i++) await sleep(100);
  await sleep(150);
  return !!$(p, '#nexo-msg-menu');
}
function dismissMenu(p) { const m = $(p, '#nexo-msg-menu'); if (m) m.remove(); }
// ¿El menú de este mensaje tiene «Editar»? (y lo cierra)
async function hasEdit(p, msgId) { if (!(await bubbleMenu(p, msgId))) return 'sin_menu'; const has = !!$(p, '#nexo-msg-menu .mm-edit'); dismissMenu(p); return has; }
async function edit(p, msgId, text) {
  if (!(await bubbleMenu(p, msgId))) return false;
  const it = $(p, '#nexo-msg-menu .mm-edit'); if (!it) { dismissMenu(p); return false; }
  click(p.win, it); await sleep(300);
  typeSend(p, text); await sleep(600); return true;
}
async function msgsOf(p, cid) { try { return (await p.win.vaultLoadMessages(cid)) || []; } catch (e) { return []; } }
async function ownWith(p, cid, re, ms) { let m = null; await waitFor(async () => !!(m = (await msgsOf(p, cid)).filter((x) => x._own && !x.hidden && re.test(String(x.content))).pop()), ms || 10000); return m; }
async function gotWith(p, cid, re, ms) { let m = null; await waitFor(async () => !!(m = (await msgsOf(p, cid)).filter((x) => !x._own && !x.hidden && re.test(String(x.content))).pop()), ms || 30000); return m; }
const byId = async (p, cid, id) => (await msgsOf(p, cid)).find((m) => (m.msgId || m.messageId) === id) || null;
const plain = (c) => { try { const o = JSON.parse(c); if (o && o.type === 'nexo_txt') return o.t; } catch (e) {} return String(c || ''); };
const bubbleText = (p, id) => { const el = $(p, '.message[data-msg-id="' + id + '"]'); return el ? ((el.querySelector('.msg-content') || {}).textContent || '') : null; };
const bubbleMark = (p, id) => { const el = $(p, '.message[data-msg-id="' + id + '"] .msg-meta .msg-edited'); return el ? el.textContent : null; };
const contactOf = (p, nx) => (p.win.vaultLoadContacts() || []).find((c) => String(c.nexoId || '').toLowerCase() === nx) || {};
const unreadOf = (p, cid) => { try { const u = (p.win.bleInterface.unreadSummary() || []).find((x) => String(x.chatId).toLowerCase() === cid); return u ? u.count : 0; } catch (e) { return -1; } };
const hiddenEdits = async (p, cid) => (await msgsOf(p, cid)).filter((m) => m.hidden && /"act":"edit"/.test(String(m.content)));
// Entregar a mano una acción ya descifrada (como la deja el transporte en la app) — para el orden y la suplantación
function inject(p, from, act) {
  p.win.dispatchEvent(new p.win.CustomEvent('nexo:ble:messageReceived', { detail: { content: JSON.stringify(act), senderNexoId: from, deviceUUID: from, messageId: 'inj' + Date.now() + Math.random().toString(36).slice(2, 6), timestamp: Date.now(), e2e: true } }));
}
// Retener lo que llega (ya descifrado) con una marca, hasta soltarlo: así la edición llega antes que su mensaje
function installHold(P) {
  const hold = { tokens: new Set(), items: [] };
  const bi = P.win.bleInterface, hp = bi._handlePayload;
  bi._handlePayload = function (d) {
    try {
      const c = String((d && (d.content || d.data)) || '');
      for (const tk of hold.tokens) if (c.indexOf(tk) >= 0 && c.indexOf('nexo_act') < 0) { hold.items.push({ tk, d, orig: hp, bi }); logs.push(ts() + ' [' + P.name + '] PRUEBA retenido ' + tk); return; }
      if (/act\\?":\\?"edit/.test(c)) logs.push(ts() + ' [' + P.name + '] PRUEBA llega una edición');
    } catch (e) {}
    return hp.apply(this, arguments);
  };
  hold.release = (tk) => { hold.items.filter((x) => x.tk === tk).forEach((x) => { logs.push(ts() + ' [' + P.name + '] PRUEBA suelto ' + tk); x.orig.call(x.bi, x.d); }); hold.items = hold.items.filter((x) => x.tk !== tk); hold.tokens.delete(tk); };
  hold.held = (tk) => hold.items.some((x) => x.tk === tk);
  return hold;
}
const editsIn = (name) => logs.filter((l) => l.indexOf('[' + name + '] PRUEBA llega una edición') >= 0).length;

(async () => {
  const r = { prueba: 'editar', build: path.basename(buildDir) };
  const relays = [new NostrRelay(), new NostrRelay()];
  RELAYS = [await relays[0].start(), await relays[1].start()];
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', base), nB = new NativePhone('B', 'BB:BB:BB:BB:BB:02', base), nC = new NativePhone('C', 'CC:CC:CC:CC:CC:03', base);
  [nA, nB, nC].forEach((n) => { radio.add(n); n.load(); });
  const A = await boot('A', nA); let B = await boot('B', nB); const C = await boot('C', nC);
  const idA = A.win.bleInterface.localNexoId.toLowerCase(), idB = B.win.bleInterface.localNexoId.toLowerCase(), idC = C.win.bleInterface.localNexoId.toLowerCase();
  A.win.bleInterface.togglePanel(); const okB = await addFound(A, 'B'); const okC = await addFound(A, 'C'); A.win.bleInterface.togglePanel();
  if (!okB || !okC) { console.log('EDITAR ' + JSON.stringify(Object.assign(r, { resultado: 'FALLO', error: 'no empareja' }))); fs.writeFileSync(path.join(__dirname, 'last_logs_editar.txt'), logs.join('\n')); process.exit(1); }
  await openChat(A, idB); typeSend(A, 'hola B'); await sleep(2000); await closeChat(A);
  await openChat(A, idC); typeSend(A, 'hola C'); await sleep(2000); await closeChat(A);
  r.B_tiene_a_A_s = await waitFor(() => !!contactOf(B, idA).nexoId && !!contactOf(C, idA).nexoId, 20000);
  await openChat(B, idA); typeSend(B, 'hola A'); await sleep(1500); await closeChat(B);
  await openChat(C, idA); typeSend(C, 'hola A, soy C'); await sleep(1500); await closeChat(C);
  await sleep(2500); // kx con fx (entienden acciones)
  const holdB = installHold(B), holdC = installHold(C);

  // ---------- E1: 1-a-1 por Bluetooth ----------
  await openChat(A, idB);
  typeSend(A, '[E1] hola original');
  const e1 = await ownWith(A, idB, /\[E1\]/);
  r.E1_llega_s = await waitFor(async () => !!(e1 && await byId(B, idA, e1.msgId)), 20000);
  await sleep(3000); // (el aviso y el «no leído» del mensaje original ya pasaron)
  const n0 = nB.notifLog.length, u0 = unreadOf(B, idA), at0 = contactOf(B, idA).lastMessageAt, hid0 = (await hiddenEdits(A, idB)).length;
  // menú, barra y caja; ✕ cancela; un texto igual no manda nada
  r.E1_menu_editar = e1 ? await hasEdit(A, e1.msgId) : 'sin_mensaje';
  await bubbleMenu(A, e1.msgId); click(A.win, $(A, '#nexo-msg-menu .mm-edit')); await sleep(300);
  r.E1_barra = !!$(A, '#edit-bar') && /Editando mensaje/.test($(A, '#edit-bar').textContent);
  r.E1_caja = A.win.document.getElementById('message-input').value;
  click(A.win, $(A, '#edit-bar .edit-cancel')); await sleep(300);
  r.E1_cancela = !$(A, '#edit-bar') && A.win.document.getElementById('message-input').value === '';
  await bubbleMenu(A, e1.msgId); click(A.win, $(A, '#nexo-msg-menu .mm-edit')); await sleep(300);
  click(A.win, A.win.document.getElementById('send-btn')); await sleep(800); // mismo texto
  r.E1_igual_no_manda = !$(A, '#edit-bar') && (await hiddenEdits(A, idB)).length === hid0 && !(await byId(A, idB, e1.msgId)).edited;
  // la edición
  r.E1_edita = await edit(A, e1.msgId, '[E1] hola editado');
  const a1 = await byId(A, idB, e1.msgId);
  r.E1_A_guardado = !!(a1 && a1.edited && a1.content === '[E1] hola editado' && a1.editTs > 0);
  r.E1_A_globo = bubbleText(A, e1.msgId);
  r.E1_A_marca = bubbleMark(A, e1.msgId);
  r.E1_A_no_duplica = (await msgsOf(A, idB)).filter((m) => !m.hidden && /\[E1\]/.test(m.content)).length;
  r.E1_B_editado_s = await waitFor(async () => { const m = await byId(B, idA, e1.msgId); return !!(m && m.edited && m.content === '[E1] hola editado'); }, 20000);
  await sleep(2500);
  r.E1_B_avisos_nuevos = nB.notifLog.slice(n0).map((n) => n.text || n.msgId);
  r.E1_B_no_leidos = unreadOf(B, idA) - u0;
  r.E1_B_no_sube = contactOf(B, idA).lastMessageAt === at0;
  r.E1_B_lista = contactOf(B, idA).lastMessage;
  r.E1_B_mensajes = (await msgsOf(B, idA)).filter((m) => !m.hidden && /\[E1\]/.test(m.content)).length;
  await openChat(B, idA); await sleep(600);
  r.E1_B_globo = bubbleText(B, e1.msgId);
  r.E1_B_marca = bubbleMark(B, e1.msgId);
  click(B.win, $(B, '.attach-menu-item[data-type="search"]')); await sleep(300);
  const sIn = $(B, '#nexo-search-input');
  const search = async (q) => { sIn.value = q; sIn.dispatchEvent(new B.win.Event('input', { bubbles: true })); await sleep(200); return ($(B, '#nexo-search-count') || {}).textContent; };
  r.E1_busca_nuevo = sIn ? await search('hola editado') : 'sin búsqueda';
  r.E1_busca_viejo = sIn ? await search('hola original') : 'sin búsqueda';
  if (sIn) await search('');
  await closeChat(B);
  r.E1_ok = r.E1_llega_s !== null && r.E1_menu_editar === true && r.E1_barra && r.E1_caja === '[E1] hola original' && r.E1_cancela && r.E1_igual_no_manda && r.E1_edita && r.E1_A_guardado &&
    r.E1_A_globo === '[E1] hola editado' && r.E1_A_marca === 'Editado' && r.E1_A_no_duplica === 1 && r.E1_B_editado_s !== null && r.E1_B_avisos_nuevos.length === 0 && r.E1_B_no_leidos === 0 &&
    r.E1_B_no_sube && r.E1_B_lista === '[E1] hola editado' && r.E1_B_mensajes === 1 && r.E1_B_globo === '[E1] hola editado' && r.E1_B_marca === 'Editado' && r.E1_busca_nuevo === '1 resultado' && r.E1_busca_viejo === '0 resultados';

  // ---------- E5: dos ediciones; la más vieja que llega después o repetida no pisa a la última ----------
  typeSend(A, '[E5] uno');
  const e5 = await ownWith(A, idB, /\[E5\] uno/);
  r.E5_llega_s = await waitFor(async () => !!(e5 && await byId(B, idA, e5.msgId)), 20000);
  await edit(A, e5.msgId, '[E5] dos'); await sleep(300);
  await edit(A, e5.msgId, '[E5] tres');
  r.E5_B_tres_s = await waitFor(async () => { const m = await byId(B, idA, e5.msgId); return !!(m && m.content === '[E5] tres'); }, 20000);
  const acts5 = (await hiddenEdits(A, idB)).map((m) => JSON.parse(m.content)).filter((x) => x.id === e5.msgId);
  const dos = acts5.find((x) => x.t === '[E5] dos'), tres = acts5.find((x) => x.t === '[E5] tres');
  r.E5_con_hora = !!(dos && tres && dos.ts > 0 && tres.ts > dos.ts);
  if (dos) inject(B, idA, dos);                                                      // llega tarde la vieja
  if (tres) inject(B, idA, tres);                                                    // repetida
  inject(B, idA, { type: 'nexo_act', act: 'edit', id: e5.msgId, t: '[E5] vieja', ts: (dos ? dos.ts : Date.now()) - 60000 }); // más vieja aún
  await sleep(1500);
  const b5 = await byId(B, idA, e5.msgId);
  r.E5_B_final = b5 ? b5.content : null;
  r.E5_A_final = (await byId(A, idB, e5.msgId) || {}).content;
  r.E5_ok = r.E5_llega_s !== null && r.E5_B_tres_s !== null && r.E5_con_hora && r.E5_B_final === '[E5] tres' && r.E5_A_final === '[E5] tres';

  // ---------- E4: la edición llega antes que su mensaje (1-a-1) ----------
  holdB.tokens.add('[E4]');
  typeSend(A, '[E4] llega tarde');
  const e4 = await ownWith(A, idB, /\[E4\]/);
  r.E4_retenido_s = await waitFor(() => holdB.held('[E4]'), 20000);
  const ne4 = editsIn('B');
  await edit(A, e4.msgId, '[E4] llega tarde (editado)');
  r.E4_edicion_llega_s = await waitFor(() => editsIn('B') > ne4, 20000);
  await sleep(800);
  r.E4_espera = /editó un mensaje que aún no llegó/.test(logs.filter((l) => l.indexOf('[B]') >= 0).slice(-40).join('\n'));
  const e4acts = (await hiddenEdits(A, idB)).map((m) => JSON.parse(m.content)).filter((x) => x.id === e4.msgId);
  inject(B, idA, { type: 'nexo_act', act: 'edit', id: e4.msgId, t: '[E4] vieja', ts: ((e4acts[0] && e4acts[0].ts) || Date.now()) - 30000 }); // otra más vieja que también espera
  await sleep(800);
  holdB.release('[E4]');
  r.E4_B_editado_s = await waitFor(async () => { const m = await byId(B, idA, e4.msgId); return !!(m && m.edited && m.content === '[E4] llega tarde (editado)'); }, 15000);
  const b4 = await byId(B, idA, e4.msgId);
  r.E4_B_final = b4 ? b4.content : null;
  r.E4_ok = r.E4_retenido_s !== null && r.E4_edicion_llega_s !== null && r.E4_espera && r.E4_B_editado_s !== null;

  // ---------- E7: cuándo NO sale «Editar» ----------
  const now = Date.now(), mk = (k, o) => Object.assign({ msgId: 'msg7' + k + now, messageId: 'msg7' + k + now, contactNexoId: idB, _own: true, status: 'delivered', timestamp: now - 1000, seq: 0 }, o);
  const inj7 = {
    viejo: mk('viejo', { content: '[E7] de hace 16 min', timestamp: now - 16 * 60000 }),
    reciente: mk('reciente', { content: '[E7] de hace 14 min', timestamp: now - 14 * 60000 }),
    sticker: mk('sticker', { content: JSON.stringify({ type: 'nexo_sticker', s: 'zz_prueba' }) }),
    reenviado: mk('reenviado', { content: JSON.stringify({ type: 'nexo_txt', t: '[E7] reenviado', fw: 1 }) }),
    foto: mk('foto', { content: '', attachmentType: 'image', attachmentPayload: Buffer.alloc(300, 7).toString('base64'), attachmentMeta: { format: 'jpeg' } }),
    unavez: mk('unavez', { content: '', attachmentType: 'image', attachmentPayload: Buffer.alloc(300, 9).toString('base64'), attachmentMeta: { format: 'jpeg', once: true } }),
    recibido: mk('recibido', { content: '[E7] recibido de B', _own: false, senderNexoId: idB }),
    respuesta: mk('respuesta', { content: JSON.stringify({ type: 'nexo_txt', t: '[E7] respuesta', rp: { id: e1.msgId, a: idB, s: 'hola', k: 'text' } }) }),
  };
  for (const k of Object.keys(inj7)) await A.win.vaultAppendMessage(idB, inj7[k]);
  // uno eliminado para todos de verdad (desde su menú)
  typeSend(A, '[E7] para eliminar');
  const del7 = await ownWith(A, idB, /\[E7\] para eliminar/);
  if (del7 && await bubbleMenu(A, del7.msgId)) click(A.win, $(A, '#nexo-msg-menu .mm-del-all'));
  const del7ok = await waitFor(async () => !!(del7 && ((await byId(A, idB, del7.msgId)) || {}).deleted), 10000);
  // un archivo de verdad
  click(A.win, $(A, '.attach-menu-item[data-type="file"]')); await sleep(150);
  const fin = Array.from(A.win.document.querySelectorAll('input[type=file]')).pop();
  Object.defineProperty(fin, 'files', { configurable: true, value: [new A.win.File([Buffer.alloc(20 * 1024, 5)], 'plan.pdf', { type: 'application/pdf' })] }); fin.dispatchEvent(new A.win.Event('change'));
  const file7 = await waitFor(async () => (await msgsOf(A, idB)).some((m) => m._own && m.attachmentType === 'file'), 15000);
  await closeChat(A); await openChat(A, idB); await sleep(800);
  r.E7 = {};
  for (const k of Object.keys(inj7)) r.E7[k] = await hasEdit(A, inj7[k].msgId);
  const fm = (await msgsOf(A, idB)).filter((m) => m._own && m.attachmentType === 'file').pop();
  r.E7.archivo = file7 !== null && fm ? await hasEdit(A, fm.msgId) : 'sin_archivo';
  r.E7.eliminado = del7ok !== null ? await hasEdit(A, del7.msgId) : 'sin_eliminar';
  await edit(A, inj7.respuesta.msgId, '[E7] respuesta corregida');
  const rp7 = await byId(A, idB, inj7.respuesta.msgId);
  let rpo = null; try { rpo = JSON.parse(rp7.content); } catch (e) {}
  r.E7_respuesta_conserva_cita = !!(rpo && rpo.type === 'nexo_txt' && rpo.t === '[E7] respuesta corregida' && rpo.rp && rpo.rp.id === e1.msgId && rp7.edited);
  r.E7_respuesta_globo = !!($(A, '.message[data-msg-id="' + inj7.respuesta.msgId + '"] .msg-quote') && /respuesta corregida/.test(bubbleText(A, inj7.respuesta.msgId) || ''));
  // tarde: se abre la edición del de 14 min y se envía cuando ya pasaron más de 15 + 2 (el reloj de A se adelanta 4 min)
  const hid7 = (await hiddenEdits(A, idB)).length;
  await bubbleMenu(A, inj7.reciente.msgId); click(A.win, $(A, '#nexo-msg-menu .mm-edit')); await sleep(300);
  const realNow = A.win.Date.now;
  A.win.Date.now = () => realNow.call(A.win.Date) + 4 * 60000;
  typeIn(A, '[E7] tarde'); click(A.win, A.win.document.getElementById('send-btn')); await sleep(400);
  A.win.Date.now = realNow;
  r.E7_tarde_aviso = (($(A, '#perm-error-toast') || {}).textContent) || '';
  r.E7_tarde_caja = A.win.document.getElementById('message-input').value;
  r.E7_tarde_sin_barra = !$(A, '#edit-bar');
  await sleep(800);
  r.E7_tarde_no_manda = (await hiddenEdits(A, idB)).length === hid7 && ((await byId(A, idB, inj7.reciente.msgId)) || {}).content === '[E7] de hace 14 min';
  typeIn(A, '');
  r.E7_ok = Object.keys(r.E7).every((k) => r.E7[k] === (k === 'reciente' || k === 'respuesta')) && r.E7_respuesta_conserva_cita && r.E7_respuesta_globo &&
    r.E7_tarde_aviso === 'Ya no se puede editar: pasaron más de 15 minutos' && r.E7_tarde_caja === '[E7] tarde' && r.E7_tarde_sin_barra && r.E7_tarde_no_manda;

  // ---------- E8: 5 idiomas sin voseo ----------
  r.E8 = {};
  let e8ok = true;
  const { importSrc } = require('./srcmod');
  for (const l of ['es', 'it', 'en', 'pt', 'fr']) {
    const T = (await importSrc('ui/i18n/' + l + '.js')).default;
    A.win.NEXO_FORCE_LANG = l;
    await bubbleMenu(A, e1.msgId);
    const lab = (($(A, '#nexo-msg-menu .mm-edit') || {}).textContent || '').trim();
    click(A.win, $(A, '#nexo-msg-menu .mm-edit')); await sleep(250);
    const bar = (($(A, '#edit-bar') || {}).textContent || '').replace('✕', '').trim();
    click(A.win, $(A, '#edit-bar .edit-cancel')); await sleep(150);
    await closeChat(A); await openChat(A, idB); await sleep(400);
    const mark = bubbleMark(A, e1.msgId);
    const late = String(T.chat_edit_late_a || '') + '15' + String(T.chat_edit_late_b || '');
    const strip = (s) => String(s || '').replace(/^[^\p{L}\p{N}]+/u, '').trim();
    const ok = !!lab && lab === strip(T.chat_edit) && !!T.chat_editing_msg && bar === T.chat_editing_msg && !!T.chat_edited && mark === T.chat_edited && !!T.chat_edit_late_a && !!T.chat_edit_late_b &&
      !VOSEO.test([lab, bar, mark, late].join(' '));
    r.E8[l] = ok ? [lab, bar, mark, late].join(' | ') : { lab, bar, mark, late };
    e8ok = e8ok && ok;
  }
  A.win.NEXO_FORCE_LANG = 'es';
  r.E8_ok = e8ok && VOSEO.test('mirá') && !VOSEO.test('mira');
  await closeChat(A);

  // ---------- E3: grupo de 3 ----------
  click(A.win, A.win.document.getElementById('ble-fab-btn')); await sleep(300); click(A.win, A.win.document.getElementById('nexo-fab-group')); await sleep(400); // 3222: «Crear grupo» desde el botón de agregar
  const sheet = A.win.document.getElementById('nexo-group-sheet');
  sheet.querySelectorAll('.nexo-pick-row input').forEach((cb) => { cb.checked = true; cb.dispatchEvent(new A.win.Event('change')); });
  const nm = sheet.querySelector('#nexo-group-name'); nm.value = 'Edición'; nm.dispatchEvent(new A.win.Event('input'));
  click(A.win, sheet.querySelector('#nexo-group-create')); await sleep(800);
  const gid = Object.keys(A.win.bleInterface.groups.list)[0];
  r.E3_grupo_en_B_y_C_s = await waitFor(() => !!(B.win.bleInterface.groups.get(gid) && C.win.bleInterface.groups.get(gid)), 60000);
  r.E3_B_conoce_a_C_s = await waitFor(() => !!contactOf(B, idC).nexoId && !!contactOf(C, idB).nexoId, 30000);
  await sleep(1500);
  typeSend(A, '[E3] del grupo original');
  const g1 = await ownWith(A, gid, /\[E3\]/);
  const wB = g1 && (g1.msgId + '_' + idB.substring(2)), wC = g1 && (g1.msgId + '_' + idC.substring(2));
  r.E3_llega_s = await waitFor(async () => !!(g1 && await byId(B, gid, wB) && await byId(C, gid, wC)), 40000);
  await sleep(3000);
  const gB0 = Object.assign({}, B.win.bleInterface.groups.get(gid)), gC0 = Object.assign({}, C.win.bleInterface.groups.get(gid));
  const nB3 = nB.notifLog.length, nC3 = nC.notifLog.length;
  r.E3_menu_editar = await hasEdit(A, g1.msgId);
  nB.setAppActive(false); nC.setAppActive(false); // segundo plano: el nativo avisaría a los 4 s de lo que no sea callado
  r.E3_edita = await edit(A, g1.msgId, '[E3] del grupo editado');
  r.E3_A_globo = bubbleText(A, g1.msgId);
  r.E3_A_marca = bubbleMark(A, g1.msgId);
  r.E3_A_lista = (A.win.bleInterface.groups.get(gid) || {}).lastMessage;
  r.E3_editado_en_B_y_C_s = await waitFor(async () => { const b = await byId(B, gid, wB), c = await byId(C, gid, wC); return !!(b && b.edited && b.content === '[E3] del grupo editado' && c && c.edited && c.content === '[E3] del grupo editado'); }, 30000);
  await sleep(5500);
  nB.setAppActive(true); nC.setAppActive(true);
  const gB1 = B.win.bleInterface.groups.get(gid) || {}, gC1 = C.win.bleInterface.groups.get(gid) || {};
  r.E3_avisos_nuevos = nB.notifLog.slice(nB3).concat(nC.notifLog.slice(nC3)).map((n) => n.text || n.msgId);
  r.E3_no_leidos = [(gB1.unreadCount || 0) - (gB0.unreadCount || 0), (gC1.unreadCount || 0) - (gC0.unreadCount || 0)];
  r.E3_no_sube = gB1.lastMessageAt === gB0.lastMessageAt && gC1.lastMessageAt === gC0.lastMessageAt;
  r.E3_lista = [gB1.lastMessage, gC1.lastMessage];
  r.E3_copias_1a1_visibles = (await msgsOf(B, idA)).filter((m) => !m.hidden && /E3\]/.test(m.content)).length;
  await openGroup(B, gid);
  r.E3_B_globo = bubbleText(B, wB);
  r.E3_B_marca = bubbleMark(B, wB);
  r.E3_B_quien = (($(B, '.message[data-msg-id="' + wB + '"] .msg-group-sender') || {}).textContent) || '';
  // B (no creó el grupo) edita el suyo
  typeSend(B, '[E3b] de B original');
  const g2 = await ownWith(B, gid, /\[E3b\]/);
  const g2A = g2 && (g2.msgId + '_' + idA.substring(2)), g2C = g2 && (g2.msgId + '_' + idC.substring(2));
  r.E3b_llega_s = await waitFor(async () => !!(g2 && await byId(A, gid, g2A) && await byId(C, gid, g2C)), 40000);
  r.E3b_menu_editar = await hasEdit(B, g2.msgId);
  r.E3b_menu_ajeno = await hasEdit(B, wB); // el mensaje de A en B: no es suyo
  await edit(B, g2.msgId, '[E3b] de B editado');
  r.E3b_editado_en_A_y_C_s = await waitFor(async () => { const a = await byId(A, gid, g2A), c = await byId(C, gid, g2C); return !!(a && a.edited && a.content === '[E3b] de B editado' && c && c.edited && c.content === '[E3b] de B editado'); }, 30000);
  await closeChat(B);
  r.E3_ok = r.E3_grupo_en_B_y_C_s !== null && r.E3_llega_s !== null && r.E3_menu_editar === true && r.E3_edita && r.E3_A_globo === '[E3] del grupo editado' && r.E3_A_marca === 'Editado' &&
    r.E3_editado_en_B_y_C_s !== null && r.E3_avisos_nuevos.length === 0 && r.E3_no_leidos[0] === 0 && r.E3_no_leidos[1] === 0 && r.E3_no_sube &&
    r.E3_lista[0] === 'A: [E3] del grupo editado' && r.E3_lista[1] === 'A: [E3] del grupo editado' && r.E3_copias_1a1_visibles === 0 &&
    r.E3_B_globo === '[E3] del grupo editado' && r.E3_B_marca === 'Editado' && r.E3_B_quien === 'A' &&
    r.E3b_llega_s !== null && r.E3b_menu_editar === true && r.E3b_menu_ajeno === false && r.E3b_editado_en_A_y_C_s !== null;

  // ---------- E6: suplantación en el grupo ----------
  inject(B, idC, { type: 'nexo_act', act: 'edit', id: g1.msgId, g: gid, t: '[FALSO] C suplanta a A', ts: Date.now() + 3600000 });
  inject(B, 'nxzzzzzzzz', { type: 'nexo_act', act: 'edit', id: g1.msgId, g: gid, t: '[FALSO] de fuera', ts: Date.now() + 3600000 });
  await sleep(1500);
  r.E6_B_sigue = ((await byId(B, gid, wB)) || {}).content;
  r.E6_aviso_suplantacion = logs.some((l) => /\[B\] warn: \[CHAT\] Edición de .* descartada: .* no lo escribió/.test(l));
  r.E6_ok = r.E6_B_sigue === '[E3] del grupo editado' && r.E6_aviso_suplantacion;

  // ---------- E4G: en el grupo, la edición antes que el mensaje; la falsa de otro que también esperaba no gana ----------
  holdC.tokens.add('[E4G]');
  await openGroup(B, gid);
  typeSend(B, '[E4G] de B tarde');
  const g4 = await ownWith(B, gid, /\[E4G\]/);
  const g4C = g4 && (g4.msgId + '_' + idC.substring(2));
  r.E4G_retenido_s = await waitFor(() => holdC.held('[E4G]'), 30000);
  inject(C, idA, { type: 'nexo_act', act: 'edit', id: g4.msgId, g: gid, t: '[FALSO] A edita lo de B', ts: Date.now() + 3600000 });
  const neC = editsIn('C');
  await edit(B, g4.msgId, '[E4G] de B tarde (editado)');
  r.E4G_edicion_llega_s = await waitFor(() => editsIn('C') > neC, 20000);
  await sleep(1000);
  holdC.release('[E4G]');
  r.E4G_C_editado_s = await waitFor(async () => { const m = await byId(C, gid, g4C); return !!(m && m.edited && m.content === '[E4G] de B tarde (editado)'); }, 15000);
  r.E4G_C_final = ((await byId(C, gid, g4C)) || {}).content;
  await closeChat(B);
  r.E4G_ok = r.E4G_retenido_s !== null && r.E4G_edicion_llega_s !== null && r.E4G_C_editado_s !== null;

  // ---------- E10: un texto editado que parece JSON del protocolo se queda como texto ----------
  await closeChat(A); await openChat(A, idB); await openChat(B, idA);
  typeSend(A, '[E10] texto');
  const e10 = await ownWith(A, idB, /\[E10\]/);
  r.E10_llega_s = await waitFor(async () => !!(e10 && await byId(B, idA, e10.msgId)), 20000);
  const fake = JSON.stringify({ type: 'attachment', attachmentType: 'image', payload: Buffer.alloc(200, 3).toString('base64'), meta: { format: 'jpeg' } });
  inject(B, idA, { type: 'nexo_act', act: 'edit', id: e10.msgId, t: fake, ts: Date.now() });
  await sleep(1500);
  const b10 = await byId(B, idA, e10.msgId) || {};
  let o10 = null; try { o10 = JSON.parse(b10.content); } catch (e) {}
  r.E10_guardado_como_texto = !!(o10 && o10.type === 'nexo_txt' && o10.t === fake && !b10.attachmentType && b10.edited);
  r.E10_globo_texto = !$(B, '.message[data-msg-id="' + (e10 && e10.msgId) + '"] img') && /attachmentType/.test(bubbleText(B, e10 && e10.msgId) || '');
  await closeChat(B); await closeChat(A);
  r.E10_ok = r.E10_llega_s !== null && r.E10_guardado_como_texto && r.E10_globo_texto;

  // ---------- E2: 1-a-1 por internet (Bluetooth bloqueado entre los tres) ----------
  const netA = A.win.bleInterface.net, netB = B.win.bleInterface.net;
  netA.tick(); netB.tick();
  r.E2_en_internet_s = await waitFor(() => netA.canReach(idB) && netB.canReach(idA), 60000);
  radio.block(nA, nB); radio.block(nA, nC); radio.block(nB, nC);
  r.E2_sin_bluetooth_s = await waitFor(() => !A.win.bleInterface._bleReadyFor(idB) && !B.win.bleInterface._bleReadyFor(idA), 40000);
  await sleep(2000);
  const nmCalls = []; const onm = netA._newMsgId.bind(netA);
  netA._newMsgId = (p) => { const res = onm(p); let id = null; try { const o = JSON.parse(p); id = o.msgId || o.m || null; } catch (e) {} nmCalls.push({ id, res }); return res; };
  await openChat(A, idB);
  typeSend(A, '[E2] por internet original');
  const e2 = await ownWith(A, idB, /\[E2\]/);
  r.E2_llega_s = await waitFor(async () => !!(e2 && await byId(B, idA, e2.msgId)), 60000);
  await sleep(3000);
  const n2 = nB.notifLog.length, u2 = unreadOf(B, idA), at2 = contactOf(B, idA).lastMessageAt;
  const hid2 = (await hiddenEdits(A, idB)).map((m) => m.msgId);
  r.E2_edita = await edit(A, e2.msgId, '[E2] por internet editado');
  r.E2_B_editado_s = await waitFor(async () => { const m = await byId(B, idA, e2.msgId); return !!(m && m.edited && m.content === '[E2] por internet editado'); }, 60000);
  await sleep(2000);
  const act2 = (await hiddenEdits(A, idB)).map((m) => m.msgId).filter((id) => hid2.indexOf(id) < 0);
  const actCalls = nmCalls.filter((c) => act2.indexOf(c.id) >= 0);
  r.E2_accion_por_internet = actCalls.length;
  r.E2_accion_callada = actCalls.length > 0 && actCalls.every((c) => c.res === null);
  r.E2_mensaje_con_marca = nmCalls.some((c) => c.id === e2.msgId && c.res === e2.msgId); // (el mensaje en sí sí lleva la marca de «nuevo»)
  r.E2_B_avisos_nuevos = nB.notifLog.slice(n2).map((n) => n.text || n.msgId);
  r.E2_B_no_leidos = unreadOf(B, idA) - u2;
  r.E2_B_no_sube = contactOf(B, idA).lastMessageAt === at2;
  r.E2_B_lista = contactOf(B, idA).lastMessage;
  await closeChat(A);
  r.E2_ok = r.E2_en_internet_s !== null && r.E2_sin_bluetooth_s !== null && r.E2_llega_s !== null && r.E2_edita && r.E2_B_editado_s !== null && r.E2_accion_callada && r.E2_mensaje_con_marca &&
    r.E2_B_avisos_nuevos.length === 0 && r.E2_B_no_leidos === 0 && r.E2_B_no_sube && r.E2_B_lista === '[E2] por internet editado';

  // ---------- E9: tras reiniciar B sigue editado ----------
  await sleep(1500);
  B.win.close(); nB.destroyActivity(); await sleep(1500); nB.load(); B = await boot('B', nB);
  const pe = async (cid, id) => { const m = await byId(B, cid, id); return m ? (m.edited ? plain(m.content) : 'sin marca: ' + plain(m.content)) : 'no está'; };
  r.E9 = { E1: await pe(idA, e1.msgId), E5: await pe(idA, e5.msgId), E4: await pe(idA, e4.msgId), E2: await pe(idA, e2.msgId), E3: await pe(gid, wB), E4G_suyo: await pe(gid, g4.msgId) };
  await openChat(B, idA); await sleep(800);
  r.E9_marca = bubbleMark(B, e2.msgId);
  r.E9_ok = r.E9.E1 === '[E1] hola editado' && r.E9.E5 === '[E5] tres' && r.E9.E4 === '[E4] llega tarde (editado)' && r.E9.E2 === '[E2] por internet editado' && r.E9.E3 === '[E3] del grupo editado' &&
    r.E9.E4G_suyo === '[E4G] de B tarde (editado)' && r.E9_marca === 'Editado';

  r.errores = logs.filter((l) => / error: /.test(l) && !/JSDOMERROR|styles\.css|Not implemented|GLOBAL TIMEOUT|net::ERR|fetch/.test(l)).slice(0, 5);
  const ok = r.E1_ok && r.E2_ok && r.E3_ok && r.E4_ok && r.E4G_ok && r.E5_ok && r.E6_ok && r.E7_ok && r.E8_ok && r.E9_ok && r.E10_ok && !r.errores.length;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('EDITAR ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_editar.txt'), logs.join('\n'));
  relays.forEach((x) => { try { x.stop(); } catch (e) {} });
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('EDITAR ' + JSON.stringify({ prueba: 'editar', resultado: 'FALLO', error: String(e && e.message).replace(/"/g, "'") })); console.error(e && e.stack); fs.writeFileSync(path.join(__dirname, 'last_logs_editar.txt'), logs.join('\n')); process.exit(1); });
