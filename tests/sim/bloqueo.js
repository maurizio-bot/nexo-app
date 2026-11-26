// BLOQUEAR CONTACTO (dueño 24-11, como WhatsApp). A y B por Bluetooth; B bloquea a A:
//  K1  B toca el círculo de A en la cabecera del chat → «Opciones del chat» con «Bloquear» → hoja «¿Bloquear a A?» con la nota →
//      «Bloquear»: queda bloqueado, la parte nativa lo sabe, la caja de escribir se cambia por «Bloqueaste a este contacto…», el ⋮ de
//      la lista y el perfil dicen «Desbloquear», y Ajustes → Seguridad lo lista;
//  K2  A le escribe (B con la app abierta): no entra en el chat de B y A NO recibe ✓✓ (se le queda en ✓);
//  K3  A llama a B: no suena;
//  K4  lo mío no le sale a A: un envío de B a A se rechaza (BLOCKED); llamar a A dice «Desbloquea…»;
//  K5  con la app de B CERRADA: A le escribe → ni buzón, ni aviso, ni ✓✓; al abrir B tampoco está;
//  K6  en un GRUPO se le sigue viendo: el mensaje de grupo de A llega a B;
//  K7  B desbloquea tocando la barra: vuelve la caja de escribir, la parte nativa lo sabe; lo que A mandó MIENTRAS (y su teléfono
//      reintenta) no aparece; lo nuevo de A sí llega con ✓✓; sigue bloqueado/desbloqueado tras reiniciar (K1 → K5 lo comprueba).
// Contraprueba: NEXO_OLD_BLOCK=1 (el nativo sin bloqueo) → FALLO en K5 (con la app cerrada lo guarda, avisa y confirma).
// Imprime BLOQUEO {json} y escribe last_logs_bloqueo.txt. Uso: node bloqueo.js <dir_build>
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
const statusOf = async (p, cid, txt) => { const m = (await msgsOf(p, cid)).find((x) => String(x.content).indexOf(txt) >= 0); return m ? m.status : null; };
const delivered = (st) => st === 'delivered' || st === 'read';
const msgNotifs = (n, chat, n0) => n.notifLog.slice(n0).filter((x) => x.chatId === chat && !x.call && !x.callEnd && !x.update);
const out = (r, code) => { console.log('BLOQUEO ' + JSON.stringify(r)); fs.writeFileSync(path.join(__dirname, 'last_logs_bloqueo.txt'), logs.join('\n')); process.exit(code); };

(async () => {
  const r = { prueba: 'bloqueo', build: path.basename(buildDir) };
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', Object.assign({}, base)), nB = new NativePhone('B', 'BB:BB:BB:BB:BB:02', Object.assign({}, base));
  [nA, nB].forEach((n) => { radio.add(n); n.load(); });
  const A = await boot('A', nA); let B = await boot('B', nB);
  const idA = A.win.bleInterface.localNexoId.toLowerCase(), idB = B.win.bleInterface.localNexoId.toLowerCase();
  A.win.bleInterface.togglePanel(); const okB = await addFound(A, 'B'); A.win.bleInterface.togglePanel();
  if (!okB) out(Object.assign(r, { resultado: 'FALLO', error: 'no empareja' }), 1);
  await openChat(A, idB); typeSend(A, 'hola B'); await sleep(1500);
  r.emparejados_s = await waitFor(() => has(B, idA, 'hola B'), 30000);
  r.antes_con_dos_palomitas_s = await waitFor(async () => delivered(await statusOf(A, idB, 'hola B')), 30000);
  await openChat(B, idA); typeSend(B, 'hola A'); await sleep(1500);
  const nameOfA = ((B.win.vaultLoadContacts() || []).find((c) => String(c.nexoId || '').toLowerCase() === idA) || {}).name || '';

  // ---------- K1: bloquear desde las opciones del chat ----------
  click(B.win, $(B, '#chat-contact-avatar')); await sleep(300);
  r.K1_opciones = Array.from(B.win.document.querySelectorAll('#nexo-chat-menu .mm-item')).map((b) => b.textContent.trim());
  click(B.win, $(B, '#nexo-chat-menu .chat-block')); await sleep(300);
  r.K1_titulo = (($(B, '#nexo-block-menu .nx-sheet-title') || {}).textContent) || '';
  r.K1_nota = (($(B, '#nexo-block-menu .nx-sheet-note') || {}).textContent) || '';
  click(B.win, $(B, '#nexo-block-menu .chat-block')); await sleep(400);
  r.K1_bloqueado = !!(B.win.__nexoBlock && B.win.__nexoBlock.isBlocked(idA));
  r.K1_aviso = (($(B, '#perm-error-toast') || {}).textContent) || '';
  r.K1_nativo_sabe = !!(nB.blocked && nB.blocked.has(idA));
  r.K1_barra = (($(B, '#nx-blocked-bar') || {}).textContent) || '';
  r.K1_caja_oculta = !!$(B, '#input-area.nx-blocked');
  await closeChat(B);
  r.K1_barra_se_quita_al_cerrar = !$(B, '#nx-blocked-bar');
  B.win.bleInterface.renderContactsList(); await sleep(200);
  const rowA = Array.from(B.win.document.querySelectorAll('#main-contacts-list .ble-contact-row')).find((x) => (x.querySelector('.ble-contact-name') || {}).textContent === nameOfA);
  click(B.win, rowA && rowA.querySelector('.ble-btn-menu')); await sleep(300);
  r.K1_menu_lista = (($(B, '.ble-contact-menu [data-action="block"]') || {}).textContent || '').trim();
  { const m = $(B, '.ble-contact-menu'); if (m) m.remove(); }
  B.win.dispatchEvent(new B.win.CustomEvent('nexo:ble:goToProfile', { detail: { deviceUUID: idA } })); await sleep(300);
  r.K1_perfil = (($(B, '#nexo-cp-block') || {}).textContent || '').trim();
  { const s = $(B, '#nexo-contact-profile'); if (s) s.remove(); }
  r.K1_ok = r.emparejados_s !== null && r.antes_con_dos_palomitas_s !== null && r.K1_opciones.indexOf('Bloquear') >= 0 && r.K1_titulo === '¿Bloquear a ' + nameOfA + '?' &&
    /En los grupos se le sigue viendo/.test(r.K1_nota) && r.K1_bloqueado && r.K1_aviso === 'Bloqueaste a ' + nameOfA && r.K1_nativo_sabe &&
    /Bloqueaste a este contacto/.test(r.K1_barra) && r.K1_caja_oculta && r.K1_barra_se_quita_al_cerrar && /Desbloquear/.test(r.K1_menu_lista) && r.K1_perfil === 'Desbloquear';

  // ---------- K2: A le escribe con la app de B abierta: no entra, sin ✓✓ ----------
  typeSend(A, '[K2] mientras bloqueado');
  await sleep(8000);
  r.K2_entro = await has(B, idA, '[K2]');
  r.K2_estado_en_A = await statusOf(A, idB, '[K2]');
  r.K2_log = logs.some((l) => /\[B\] log: \[BLOQUEO\] Llega algo de/.test(l));
  r.K2_ok = !r.K2_entro && !delivered(r.K2_estado_en_A) && r.K2_log;

  // ---------- K3: A llama: no suena ----------
  nB.callNotif = null;
  click(A.win, A.win.document.getElementById('nexo-call-btn'));
  r.K3_suena_s = await waitFor(() => !!(nB.callNotif && nB.callNotif.from === idA) || !!(B.win.bleInterface.calls && B.win.bleInterface.calls.call), 10000);
  if (A.win.bleInterface.calls && A.win.bleInterface.calls.call) A.win.bleInterface.calls.hangup();
  await sleep(2000);
  r.K3_ok = r.K3_suena_s === null;

  // ---------- K4: lo mío no le sale ----------
  let rej = null;
  try { await B.win.bleInterface.sendChatMessage(idA, 'prueba', 'msg_' + Date.now() + '_k4'); } catch (e) { rej = (e && e.code) || String(e); }
  r.K4_rechazo = rej;
  await openChat(B, idA);
  click(B.win, B.win.document.getElementById('nexo-call-btn')); await sleep(400);
  r.K4_llamar = (($(B, '#perm-error-toast') || {}).textContent || '') + ' ' + ((($(B, '.nx-call-toast') || {}).textContent) || '');
  r.K4_sin_llamada = !(B.win.bleInterface.calls && B.win.bleInterface.calls.call);
  await closeChat(B);
  r.K4_ok = r.K4_rechazo === 'BLOCKED' && r.K4_sin_llamada;

  // ---------- K5: app de B CERRADA: ni buzón, ni aviso, ni ✓✓; al abrir tampoco está ----------
  B.win.close(); nB.destroyActivity(); await sleep(1500);
  const n5 = nB.notifLog.length, box5 = (nB.bgInbox || []).length;
  typeSend(A, '[K5] con la app cerrada');
  await sleep(8000);
  r.K5_buzon = (nB.bgInbox || []).length - box5;
  r.K5_avisos = msgNotifs(nB, idA, n5).length;
  r.K5_estado_en_A = await statusOf(A, idB, '[K5]');
  vis.B = 'visible'; nB.setAppActive(true);
  nB.load(); B = await boot('B', nB);
  await sleep(4000);
  r.K5_al_abrir = await has(B, idA, '[K5]');
  r.K5_sigue_bloqueado = !!(B.win.__nexoBlock && B.win.__nexoBlock.isBlocked(idA)) && !!(nB.blocked && nB.blocked.has(idA));
  r.K5_ok = r.K5_buzon === 0 && r.K5_avisos === 0 && !delivered(r.K5_estado_en_A) && !r.K5_al_abrir && r.K5_sigue_bloqueado;

  // ---------- K6: en un grupo se le sigue viendo ----------
  A.win.NEXO_newGroupWith(); await sleep(400);
  const sheet = A.win.document.getElementById('nexo-group-sheet');
  sheet.querySelectorAll('.nexo-pick-row input').forEach((cb) => { cb.checked = true; cb.dispatchEvent(new A.win.Event('change')); });
  const gnm = sheet.querySelector('#nexo-group-name'); gnm.value = 'Con bloqueado'; gnm.dispatchEvent(new A.win.Event('input'));
  click(A.win, sheet.querySelector('#nexo-group-create')); await sleep(800);
  const gid = Object.keys(A.win.bleInterface.groups.list)[0];
  r.K6_grupo_en_B_s = await waitFor(() => !!B.win.bleInterface.groups.get(gid), 60000);
  await closeChat(A); if (A.win.NEXO_openGroupChat) A.win.NEXO_openGroupChat(gid); await sleep(600);
  typeSend(A, '[K6] en el grupo');
  r.K6_llega_s = await waitFor(async () => (await msgsOf(B, gid)).some((m) => /\[K6\] en el grupo/.test(String(m.content))), 40000);
  await closeChat(A);
  r.K6_ok = r.K6_grupo_en_B_s !== null && r.K6_llega_s !== null;

  // ---------- K7: desbloquear tocando la barra; lo de antes no aparece, lo nuevo sí ----------
  await openChat(B, idA);
  click(B.win, $(B, '#nx-blocked-bar')); await sleep(400);
  r.K7_desbloqueado = !!(B.win.__nexoBlock && !B.win.__nexoBlock.isBlocked(idA)) && !(nB.blocked && nB.blocked.has(idA));
  r.K7_aviso = (($(B, '#perm-error-toast') || {}).textContent) || '';
  r.K7_caja_vuelve = !$(B, '#nx-blocked-bar') && !$(B, '#input-area.nx-blocked');
  await closeChat(B);
  // A reintenta lo pendiente (como hace su teléfono al volver a verlo)
  try { A.win.bleInterface._resendPendingMessages(idB); } catch (e) {}
  await sleep(8000);
  r.K7_viejos_no_entran = !(await has(B, idA, '[K2]')) && !(await has(B, idA, '[K5]'));
  await openChat(A, idB);
  typeSend(A, '[K7] ya desbloqueado');
  r.K7_nuevo_llega_s = await waitFor(() => has(B, idA, '[K7] ya'), 30000);
  r.K7_nuevo_con_dos_palomitas_s = await waitFor(async () => delivered(await statusOf(A, idB, '[K7] ya')), 30000);
  r.K7_ok = r.K7_desbloqueado && r.K7_aviso === 'Desbloqueaste a ' + nameOfA && r.K7_caja_vuelve && r.K7_viejos_no_entran && r.K7_nuevo_llega_s !== null && r.K7_nuevo_con_dos_palomitas_s !== null;

  r.errores = logs.filter((l) => / error: /.test(l) && !/JSDOMERROR|styles\.css|Not implemented|GLOBAL TIMEOUT|net::ERR|fetch|micrófono|getUserMedia/.test(l)).slice(0, 5);
  const ok = r.K1_ok && r.K2_ok && r.K3_ok && r.K4_ok && r.K5_ok && r.K6_ok && r.K7_ok && !r.errores.length;
  r.resultado = ok ? 'OK' : 'FALLO';
  out(r, ok ? 0 : 1);
})().catch((e) => { console.error(e && e.stack); out({ prueba: 'bloqueo', resultado: 'FALLO', error: String(e && e.message).replace(/"/g, "'") }, 1); });
