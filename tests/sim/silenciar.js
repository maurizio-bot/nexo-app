// 3219 (dueño 17-11: «todas las funciones de WhatsApp… de forma práctica y cómoda, ergonómica y estética»): SILENCIAR un chat o un
// grupo (8 horas / 1 semana / Siempre) y «Activar sonido». Un chat silenciado no suena, no vibra ni avisa: con la app en segundo plano
// (notify.js) ni con la app congelada o CERRADA (la parte nativa: setMutedChats → MutedChats.kt; aquí, su modelo en native_mock). Los
// mensajes llegan igual y suman «no leídos». Las LLAMADAS sí suenan. A y B por Bluetooth:
//  S1  B toca el círculo de A en la cabecera del chat → «Opciones del chat» con «Silenciar notificaciones» → 8 horas / 1 semana / Siempre
//      (y la nota de que las llamadas suenan) → «8 horas»: queda silenciado ~8 h, la parte nativa lo sabe (con su fin), el altavoz
//      tachado en la cabecera y junto al nombre en la lista (sin cambiar el texto del nombre), y el menú ofrece «Activar sonido» con
//      «Silenciado hasta el …»;
//  S2  B en segundo plano: A le escribe → el mensaje está en el chat de B y suma «no leído» (el número en gris), pero SIN aviso (ni el
//      de la app ni el de respaldo del nativo a los 4 s); con la app CONGELADA (el JS no corre, como el Vivo del dueño) el aviso de
//      respaldo del nativo tampoco sale, y el mensaje entra al despertar;
//  S3  con el chat silenciado, una LLAMADA de A suena;
//  S4  la app de B CERRADA (el Bluetooth sigue recibiendo): A le escribe → sin aviso; al abrir la app el mensaje está; tras reiniciar
//      sigue silenciado (bóveda) y la parte nativa lo vuelve a saber;
//  S5  «Activar sonido» desde el ⋮ del contacto en la lista: vuelve a avisar (segundo plano y app cerrada); un GRUPO silenciado desde su
//      ⋮ («Siempre») no avisa (segundo plano y app cerrada) mientras el 1-a-1 de A sí;
//  S6  un silencio que vence (2,5 s) vuelve a avisar solo (en la app y en la parte nativa);
//  S7  los textos en los 5 idiomas y sin voseo.
// Contraprueba b3205: FALLO (no hay opciones del chat ni forma de silenciar; los avisos salen). Contraprueba de la parte nativa:
// NEXO_OLD_MUTE=1 (el nativo sin MutedChats) → FALLO en S2 (congelada), S4 y S5 (cerrada): los avisa el nativo.
// Imprime SILENCIAR {json} y escribe last_logs_silenciar.txt. Uso: node silenciar.js <dir_build>
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
const vis = {};
const VOSEO = /(^|[^a-záéíóúüñ])(mirá|tocá|podés|tenés|querés|activá|silenciá|elegí|vos)(?![a-záéíóúüñ])/i;
async function boot(name, native) {
  native.listeners = new Map();
  const vc = new VirtualConsole();
  ['log', 'warn', 'error'].forEach((l) => vc.on(l, (...a) => logs.push(`${ts()} [${name}] ${l}: ` + a.map(String).join(' ').substring(0, 300))));
  const dom = new JSDOM(fs.readFileSync(path.join(buildDir, 'dist', 'index.html'), 'utf8'), {
    url: 'https://' + name.toLowerCase() + '.nexo.test/index.html', runScripts: 'dangerously', resources: new DL(path.join(buildDir, 'dist')), pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) {
      win.CapacitorCustomPlatform = { name: 'android' }; installWebCrypto(win);
      win.Capacitor = { Plugins: { NexoBLE: native.plugin() } }; win.HTMLElement.prototype.scrollTo = function () {}; win.HTMLElement.prototype.scrollIntoView = function () {};
      Object.defineProperty(win.document, 'visibilityState', { configurable: true, get: () => vis[name] || 'visible' });
      Object.defineProperty(win.document, 'hidden', { configurable: true, get: () => (vis[name] || 'visible') === 'hidden' });
      win.navigator.mediaDevices = { getUserMedia: () => Promise.reject(new Error('sin micrófono en el simulador')) };
    },
  });
  const win = dom.window;
  for (let i = 0; i < 100 && !(win.NEXO && win.NEXO.initialized); i++) await sleep(100);
  await sleep(800);
  return { name, native, win };
}
function setVisible(p, on) { vis[p.name] = on ? 'visible' : 'hidden'; p.native.setAppActive(on); p.win.document.dispatchEvent(new p.win.Event('visibilitychange')); }
const click = (win, el) => el && el.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
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
async function msgsOf(p, cid) { try { return (await p.win.vaultLoadMessages(cid)) || []; } catch (e) { return []; } }
const has = async (p, cid, txt) => (await msgsOf(p, cid)).some((m) => !m.hidden && String(m.content).indexOf(txt) >= 0);
const unreadOf = (p, cid) => { try { const u = (p.win.bleInterface.unreadSummary() || []).find((x) => String(x.chatId).toLowerCase() === cid); return u ? u.count : 0; } catch (e) { return -1; } };
// avisos de mensaje (no de llamada) de un chat desde la marca n0
const msgNotifs = (n, chat, n0) => n.notifLog.slice(n0).filter((x) => x.chatId === chat && !x.call && !x.callEnd && !x.update);

(async () => {
  const r = { prueba: 'silenciar', build: path.basename(buildDir) };
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', Object.assign({}, base)), nB = new NativePhone('B', 'BB:BB:BB:BB:BB:02', Object.assign({}, base));
  [nA, nB].forEach((n) => { radio.add(n); n.load(); });
  const A = await boot('A', nA); let B = await boot('B', nB);
  const idA = A.win.bleInterface.localNexoId.toLowerCase(), idB = B.win.bleInterface.localNexoId.toLowerCase();
  A.win.bleInterface.togglePanel(); const okB = await addFound(A, 'B'); A.win.bleInterface.togglePanel();
  if (!okB) { console.log('SILENCIAR ' + JSON.stringify(Object.assign(r, { resultado: 'FALLO', error: 'no empareja' }))); fs.writeFileSync(path.join(__dirname, 'last_logs_silenciar.txt'), logs.join('\n')); process.exit(1); }
  await openChat(A, idB); typeSend(A, 'hola B'); await sleep(1500);
  r.emparejados_s = await waitFor(() => has(B, idA, 'hola B'), 30000);
  await openChat(B, idA); typeSend(B, 'hola A'); await sleep(1500); await closeChat(B);
  await sleep(1500);
  const nameOfA = ((B.win.vaultLoadContacts() || []).find((c) => String(c.nexoId || '').toLowerCase() === idA) || {}).name || '';

  // ---------- S1: silenciar desde las opciones del chat (tocar el círculo de la cabecera) ----------
  await openChat(B, idA);
  const av = $(B, '#chat-contact-avatar');
  r.S1_circulo_es_boton = !!(av && av.getAttribute('role') === 'button');
  click(B.win, av); await sleep(300);
  r.S1_opciones = Array.from(B.win.document.querySelectorAll('#nexo-chat-menu .mm-item')).map((b) => b.textContent.trim());
  click(B.win, $(B, '#nexo-chat-menu .chat-mute')); await sleep(300);
  r.S1_hoja = !!$(B, '#nexo-mute-menu');
  r.S1_opciones_silencio = Array.from(B.win.document.querySelectorAll('#nexo-mute-menu .mm-item')).map((b) => b.textContent.trim());
  r.S1_nota = (($(B, '#nexo-mute-menu .nx-sheet-note') || {}).textContent) || '';
  const t1 = Date.now();
  click(B.win, $(B, '#nexo-mute-menu .mute-8h')); await sleep(400);
  const until = B.win.__nexoMute ? B.win.__nexoMute.until(idA) : null;
  r.S1_ocho_horas = until != null && Math.abs(until - (t1 + 8 * 3600000)) < 60000;
  r.S1_aviso = (($(B, '#perm-error-toast') || {}).textContent) || '';
  r.S1_nativo_sabe = !!(nB.muted && nB.muted.get(idA) === until);
  r.S1_icono_cabecera = !!$(B, '#chat-mute-ico');
  click(B.win, $(B, '#chat-contact-avatar')); await sleep(300);
  const un = $(B, '#nexo-chat-menu .chat-unmute');
  r.S1_menu_activar = un ? un.textContent.trim() : null;
  { const m = $(B, '#nexo-chat-menu'); if (m) m.remove(); }
  await closeChat(B); await sleep(300);
  B.win.bleInterface.renderContactsList(); await sleep(200);
  const rowA = Array.from(B.win.document.querySelectorAll('#main-contacts-list .ble-contact-row')).find((x) => (x.querySelector('.ble-contact-name') || {}).textContent === nameOfA);
  r.S1_icono_lista = !!(rowA && rowA.querySelector('.ble-contact-name .nx-mute-ico'));
  r.S1_nombre_intacto = rowA ? (rowA.querySelector('.ble-contact-name') || {}).textContent : null;
  r.S1_ok = r.emparejados_s !== null && r.S1_circulo_es_boton && r.S1_opciones.length === 5 && !r.S1_opciones.some((o) => /entre la gente/.test(o)) && r.S1_opciones.indexOf('Bloquear') >= 0 && /Silenciar notificaciones/.test(r.S1_opciones.join('|')) && /Mensajes destacados/.test(r.S1_opciones.join('|')) &&
    r.S1_hoja && r.S1_opciones_silencio.join('|') === '8 horas|1 semana|Siempre|Cancelar' && /llamadas sí suenan/.test(r.S1_nota) && r.S1_ocho_horas && r.S1_aviso === 'Chat silenciado' &&
    r.S1_nativo_sabe && r.S1_icono_cabecera && /^Activar sonido\s*Silenciado hasta el /.test(r.S1_menu_activar || '') && r.S1_icono_lista && r.S1_nombre_intacto === nameOfA;

  // ---------- S2: en segundo plano, sin aviso (ni de la app ni de respaldo del nativo), pero llega y suma «no leído» ----------
  setVisible(B, false); await sleep(400);
  const n2 = nB.notifLog.length, u2 = unreadOf(B, idA);
  typeSend(A, '[S2] callado en segundo plano');
  r.S2_llega_s = await waitFor(() => has(B, idA, '[S2]'), 30000);
  await sleep(6000); // el aviso de respaldo del nativo sale a los 4 s
  r.S2_avisos = msgNotifs(nB, idA, n2).map((x) => x.text || x.msgId);
  r.S2_no_leidos = unreadOf(B, idA) - u2;
  r.S2_no_avisa_app = logs.some((l) => /\[B\] log: \[NOTIF\] .* está silenciado: sin aviso/.test(l));
  B.win.bleInterface.renderContactsList(); await sleep(200);
  r.S2_numero_gris = !!B.win.document.querySelector('#main-contacts-list .ble-unread-badge.nx-muted-badge');
  // S2b: la app CONGELADA en segundo plano (el Vivo del dueño): el JS no corre y el aviso de respaldo lo daría el nativo a los 4 s
  nB.setFrozen(true);
  const n2b = nB.notifLog.length;
  typeSend(A, '[S2b] callado con la app congelada');
  await sleep(7000);
  r.S2b_avisos_nativo = msgNotifs(nB, idA, n2b).map((x) => x.text || x.msgId);
  nB.setFrozen(false);
  r.S2b_llega_al_despertar_s = await waitFor(() => has(B, idA, '[S2b]'), 30000);
  r.S2_ok = r.S2_llega_s !== null && r.S2_avisos.length === 0 && r.S2_no_leidos >= 1 && r.S2_no_avisa_app && r.S2_numero_gris && r.S2b_avisos_nativo.length === 0 && r.S2b_llega_al_despertar_s !== null;

  // ---------- S3: la LLAMADA de un chat silenciado suena ----------
  click(A.win, A.win.document.getElementById('nexo-call-btn'));
  r.S3_llamada_suena_s = await waitFor(() => !!(nB.callNotif && nB.callNotif.from === idA), 30000);
  if (A.win.bleInterface.calls && A.win.bleInterface.calls.call) A.win.bleInterface.calls.hangup();
  await sleep(2500);
  r.S3_ok = r.S3_llamada_suena_s !== null;

  // ---------- S4: con la app CERRADA, sin aviso; al abrir está el mensaje; tras reiniciar sigue silenciado ----------
  B.win.close(); nB.destroyActivity(); await sleep(1500);
  const n4 = nB.notifLog.length, box4 = (nB.bgInbox || []).length;
  typeSend(A, '[S4] con la app cerrada');
  r.S4_al_buzon_s = await waitFor(() => (nB.bgInbox || []).length > box4, 30000);
  await sleep(3000);
  r.S4_avisos = msgNotifs(nB, idA, n4).map((x) => x.text || x.msgId);
  r.S4_saltados_por_silencio = nB.mutedSkips || 0;
  vis.B = 'visible'; nB.setAppActive(true);
  nB.load(); B = await boot('B', nB);
  r.S4_mensaje_al_abrir_s = await waitFor(() => has(B, idA, '[S4]'), 30000);
  r.S4_sigue_silenciado = !!(B.win.__nexoMute && B.win.__nexoMute.isMuted(idA));
  r.S4_nativo_tras_reiniciar = !!(nB.muted && nB.muted.get(idA) === until) && (nB.mutedCalls || 0) >= 2;
  r.S4_ok = r.S4_al_buzon_s !== null && r.S4_avisos.length === 0 && r.S4_saltados_por_silencio >= 1 && r.S4_mensaje_al_abrir_s !== null && r.S4_sigue_silenciado && r.S4_nativo_tras_reiniciar;

  // ---------- S5: «Activar sonido» desde el ⋮ de la lista; un GRUPO silenciado («Siempre») desde su ⋮ ----------
  await closeChat(B); B.win.bleInterface.renderContactsList(); await sleep(300);
  const rowA5 = Array.from(B.win.document.querySelectorAll('#main-contacts-list .ble-contact-row')).find((x) => (x.querySelector('.ble-contact-name') || {}).textContent === nameOfA);
  click(B.win, rowA5 && rowA5.querySelector('.ble-btn-menu')); await sleep(300);
  const mi = $(B, '.ble-contact-menu [data-action="mute"]');
  r.S5_menu_lista = mi ? mi.textContent.trim() : null;
  click(B.win, mi); await sleep(400);
  r.S5_activado = !!(B.win.__nexoMute && !B.win.__nexoMute.isMuted(idA)) && !(nB.muted && nB.muted.has(idA));
  r.S5_aviso_activado = (($(B, '#perm-error-toast') || {}).textContent) || '';
  // grupo A + B
  A.win.NEXO_newGroupWith(); await sleep(400); // 3222: «Crear grupo» desde el botón de agregar
  const sheet = A.win.document.getElementById('nexo-group-sheet');
  sheet.querySelectorAll('.nexo-pick-row input').forEach((cb) => { cb.checked = true; cb.dispatchEvent(new A.win.Event('change')); });
  const gnm = sheet.querySelector('#nexo-group-name'); gnm.value = 'Callados'; gnm.dispatchEvent(new A.win.Event('input'));
  click(A.win, sheet.querySelector('#nexo-group-create')); await sleep(800);
  const gid = Object.keys(A.win.bleInterface.groups.list)[0];
  r.S5_grupo_en_B_s = await waitFor(() => !!B.win.bleInterface.groups.get(gid), 60000);
  await sleep(1500);
  B.win.NEXO_openGroupMenu(gid); await sleep(300);
  const gm = $(B, '#nexo-group-menu .gm-mute');
  r.S5_menu_grupo = gm ? gm.textContent.trim() : null;
  click(B.win, gm); await sleep(300);
  click(B.win, $(B, '#nexo-mute-menu .mute-always')); await sleep(400);
  r.S5_grupo_siempre = !!(B.win.__nexoMute && B.win.__nexoMute.until(gid) === 0) && !!(nB.muted && nB.muted.get(gid) === 0);
  // segundo plano: el grupo callado, el 1-a-1 de A avisa
  setVisible(B, false); await sleep(400);
  const n5 = nB.notifLog.length;
  if (A.win.NEXO_openGroupChat) A.win.NEXO_openGroupChat(gid); await sleep(600);
  typeSend(A, '[S5] grupo callado');
  r.S5_grupo_llega_s = await waitFor(async () => (await msgsOf(B, gid)).some((m) => /\[S5\] grupo callado/.test(String(m.content))), 40000);
  await closeChat(A); await openChat(A, idB);
  typeSend(A, '[S5] directo avisa');
  r.S5_directo_avisa_s = await waitFor(() => msgNotifs(nB, idA, n5).length > 0, 30000);
  await sleep(5000);
  r.S5_avisos_grupo = msgNotifs(nB, gid, n5).map((x) => x.text || x.msgId);
  // app cerrada: lo mismo
  B.win.close(); nB.destroyActivity(); await sleep(1500);
  const n5c = nB.notifLog.length;
  await closeChat(A); if (A.win.NEXO_openGroupChat) A.win.NEXO_openGroupChat(gid); await sleep(600);
  typeSend(A, '[S5c] grupo con la app cerrada'); await sleep(3500);
  await closeChat(A); await openChat(A, idB);
  typeSend(A, '[S5c] directo con la app cerrada');
  r.S5c_directo_avisa_s = await waitFor(() => msgNotifs(nB, idA, n5c).length > 0, 30000);
  await sleep(2000);
  r.S5c_avisos_grupo = msgNotifs(nB, gid, n5c).map((x) => x.text || x.msgId);
  vis.B = 'visible'; nB.setAppActive(true);
  nB.load(); B = await boot('B', nB);
  r.S5c_grupo_llega_al_abrir_s = await waitFor(async () => (await msgsOf(B, gid)).some((m) => /\[S5c\]/.test(String(m.content))), 30000);
  r.S5_ok = /Activar sonido/.test(r.S5_menu_lista || '') && r.S5_activado && r.S5_aviso_activado === 'Sonido activado' && r.S5_grupo_en_B_s !== null && /Silenciar notificaciones/.test(r.S5_menu_grupo || '') &&
    r.S5_grupo_siempre && r.S5_grupo_llega_s !== null && r.S5_directo_avisa_s !== null && r.S5_avisos_grupo.length === 0 &&
    r.S5c_directo_avisa_s !== null && r.S5c_avisos_grupo.length === 0 && r.S5c_grupo_llega_al_abrir_s !== null;

  // ---------- S6: un silencio que vence vuelve a avisar solo ----------
  await closeChat(B);
  if (B.win.__nexoMute) B.win.__nexoMute.set(idA, 2500);
  r.S6_nativo_con_fin = !!(nB.muted && nB.muted.get(idA) > Date.now());
  setVisible(B, false); await sleep(300);
  const n6 = nB.notifLog.length;
  typeSend(A, '[S6] aún callado');
  await waitFor(() => has(B, idA, '[S6] aún'), 20000);
  r.S6_callado = msgNotifs(nB, idA, n6).length === 0;
  await sleep(Math.max(0, 3500));
  const n6b = nB.notifLog.length;
  typeSend(A, '[S6] ya vencido');
  r.S6_vuelve_a_avisar_s = await waitFor(() => msgNotifs(nB, idA, n6b).length > 0, 30000);
  setVisible(B, true);
  r.S6_ok = r.S6_nativo_con_fin && r.S6_callado && r.S6_vuelve_a_avisar_s !== null;

  // ---------- S7: 5 idiomas sin voseo ----------
  const { importSrc } = require('./srcmod');
  r.S7 = {}; let s7 = true;
  await openChat(B, idA);
  for (const l of ['es', 'it', 'en', 'pt', 'fr']) {
    const T = (await importSrc('ui/i18n/' + l + '.js')).default;
    B.win.NEXO_FORCE_LANG = l;
    click(B.win, $(B, '#chat-contact-avatar')); await sleep(200);
    const opts = Array.from(B.win.document.querySelectorAll('#nexo-chat-menu .mm-item')).map((b) => b.textContent.trim());
    click(B.win, $(B, '#nexo-chat-menu .chat-mute')); await sleep(200);
    const ms = Array.from(B.win.document.querySelectorAll('#nexo-mute-menu .mm-item')).map((b) => b.textContent.trim());
    const title = (($(B, '#nexo-mute-menu .nx-sheet-title') || {}).textContent) || '', note = (($(B, '#nexo-mute-menu .nx-sheet-note') || {}).textContent) || '';
    { const m = $(B, '#nexo-mute-menu'); if (m) m.remove(); }
    const want = [T.mute_8h, T.mute_week, T.mute_always];
    const ok = opts.indexOf(T.star_title) >= 0 && opts.indexOf(T.mute_title) >= 0 && want.every((x, i) => !!x && ms[i] === x) && title === T.mute_title && note === T.mute_note &&
      !!T.mute_off && !!T.mute_until && !!T.mute_forever && !!T.chat_opts && !VOSEO.test([opts.join(' '), ms.join(' '), note, T.mute_off].join(' '));
    r.S7[l] = ok ? [title, ms.slice(0, 3).join(' / '), T.mute_off].join(' | ') : { opts, ms, title, note };
    s7 = s7 && ok;
  }
  B.win.NEXO_FORCE_LANG = 'es';
  r.S7_ok = s7 && VOSEO.test('tocá') && !VOSEO.test('toca');

  r.errores = logs.filter((l) => / error: /.test(l) && !/JSDOMERROR|styles\.css|Not implemented|GLOBAL TIMEOUT|net::ERR|fetch|micrófono|getUserMedia/.test(l)).slice(0, 5);
  const ok = r.S1_ok && r.S2_ok && r.S3_ok && r.S4_ok && r.S5_ok && r.S6_ok && r.S7_ok && !r.errores.length;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('SILENCIAR ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_silenciar.txt'), logs.join('\n'));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('SILENCIAR ' + JSON.stringify({ prueba: 'silenciar', resultado: 'FALLO', error: String(e && e.message).replace(/"/g, "'") })); console.error(e && e.stack); fs.writeFileSync(path.join(__dirname, 'last_logs_silenciar.txt'), logs.join('\n')); process.exit(1); });
