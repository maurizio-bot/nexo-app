// COLA 4b «Grupos: administración» (dueño 20-11), G1–G9 en cuatro teléfonos de verdad (jsdom + radio simulada).
// A conoce a B, C y D; B, C y D no se conocen. Los permisos se comprueban en el teléfono que RECIBE.
//  1. A crea el grupo en modo CONTROL con B y C (estado v1 firmado): a C (no admin) se le bloquea la barra de escribir con el motivo.
//     1b (dueño 23-11): C ve la ruedita de ajustes en la cabecera del chat del grupo (no en un chat normal); tocar a un miembro abre su
//     chat si es contacto o, si no, ofrece «Agregar» (solicitud).
//  2. Ajustes del grupo → «Designar administradores» → B: todos lo ven («Ahora es admin»). B escribe y llega.
//  3. C, con la app trucada, escribe igual y firma un cambio haciéndose admin: los demás lo descartan (sin aviso).
//  4. A agrega a D: entra con el estado y las tarjetas, NO ve lo de antes, y recibe lo nuevo de B.
//  5. B (admin) firma un estado que expulsa al creador, y otro tocado después de firmar: nadie los acepta.
//  6. B expulsa a C («Solo expulsar»; B no ve «Expulsar y bloquear» ni el botón de expulsar al creador): a C el grupo le DESAPARECE de la
//     lista (dueño 22-11); C sigue escribiendo con la app trucada y nadie lo guarda.
//  7. A expulsa y bloquea a D: «Personas bloqueadas» aparece; B la ve sin «Desbloquear»; A desbloquea y lo vuelve a agregar (vuelve).
//  8. B se atrasa (versión vieja): con el siguiente mensaje de A pide el estado y se pone al día.
//  9. Foto del grupo (A) y fondo compartido (A): llegan a B.
// 10. Sale el creador: pasa al admin más antiguo (B).
// 11. Grupo VIEJO (sin estado): renombrar sigue como antes; el primer cambio firmado (A hace admin a B) se acepta.
// Uso: node gruposadmin.js <dir_build>
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone } = require('./native_mock');

const buildDir = path.resolve(process.argv[2]);
const opts = { readsContentFallback: true, retain: ['onPayloadReceived'], closeOnNoService: true, pace: [15, 15], ioDelay: 10, asymmetric: true };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
class DistLoader extends ResourceLoader {
  constructor(dir) { super(); this.dir = dir; }
  fetch(url) { const f = path.join(this.dir, decodeURIComponent(new URL(url).pathname)); return fs.existsSync(f) ? Promise.resolve(fs.readFileSync(f)) : Promise.reject(new Error('no existe ' + f)); }
}
const logs = [];
async function boot(name, native) {
  const vc = new VirtualConsole();
  ['log', 'warn', 'error'].forEach((l) => vc.on(l, (...a) => logs.push(`${new Date().toISOString().substring(14, 23)} [${name}] ${l}: ` + a.map(String).join(' ').substring(0, 300))));
  const dom = new JSDOM(fs.readFileSync(path.join(buildDir, 'dist', 'index.html'), 'utf8'), {
    url: 'https://' + name.toLowerCase() + '.nexo.test/index.html', runScripts: 'dangerously',
    resources: new DistLoader(path.join(buildDir, 'dist')), pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) { win.CapacitorCustomPlatform = { name: 'android' }; require('./native_mock').installWebCrypto(win); win.Capacitor = { Plugins: { NexoBLE: native.plugin() } }; win.HTMLElement.prototype.scrollTo = function () {}; },
  });
  const win = dom.window;
  // dueño 24-11: entrar a un grupo es una invitación; en esta prueba el usuario la acepta al momento
  win.addEventListener('nexo:groups:invite', (e) => setTimeout(() => { try { win.bleInterface.groups.acceptInvite(e.detail.id); } catch (x) {} }, 50));
  for (let i = 0; i < 100 && !(win.NEXO && win.NEXO.initialized); i++) await sleep(100);
  await sleep(800);
  return { name, native, win };
}
const click = (win, el) => el && el.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
const q = (p, sel) => p.win.document.querySelector(sel);
async function openChatWith(p, name) {
  // 24-11: la fila de un grupo sale al aceptar la invitación (un momento después): se espera hasta 5 s
  let row = null; for (let i = 0; i < 25 && !row; i++) { row = Array.from(p.win.document.querySelectorAll('#main-contacts-list .ble-contact-row')).find((r) => (r.querySelector('.ble-contact-name') || {}).textContent === name); if (!row) await sleep(200); }
  click(p.win, row); await sleep(500); return !!row;
}
async function closeChat(p) { p.win.dispatchEvent(new p.win.CustomEvent('nexo:ble:closeChat', { detail: {} })); await sleep(200); }
async function sendText(p, t) { const i = p.win.document.getElementById('message-input'); i.value = t; i.dispatchEvent(new p.win.Event('input', { bubbles: true })); click(p.win, p.win.document.getElementById('send-btn')); }
async function addFound(p, name) {
  let add = null;
  const find = () => { const row = Array.from(p.win.document.querySelectorAll('#ble-new-device > div')).find((d) => (d.querySelector('span') || {}).textContent === name); return row && row.querySelector('button'); };
  for (let i = 0; i < 400 && !add; i++) { await sleep(100); add = find(); if (!add && !p.win.bleInterface.isScanning) click(p.win, p.win.document.getElementById('ble-scan-btn')); }
  click(p.win, add); await sleep(2000);
  return !!add;
}
const wait = async (c, s) => { for (let i = 0; i < s * 5; i++) { if (await c()) return true; await sleep(200); } return !!(await c()); };
const vaultHas = async (p, cid, re) => (await p.win.vaultLoadMessages(cid)).some((m) => re.test(m.content || ''));
const gsOf = (p) => p.win.bleInterface.groups;
const st = (p, gid) => { const g = gsOf(p).get(gid); return g && g.s; };
const check = (p, sel) => { const cb = q(p, sel); if (cb) { cb.checked = true; cb.dispatchEvent(new p.win.Event('change')); } return !!cb; };

(async () => {
  const radio = new Radio();
  const names = ['A', 'B', 'C', 'D'];
  const natives = names.map((n, i) => new NativePhone(n, n + n + ':' + n + n + ':00:00:00:0' + (i + 1), opts));
  natives.forEach((n) => { radio.add(n); n.load(); });
  const [A, B, C, D] = await Promise.all(names.map((n, i) => boot(n, natives[i])));
  const id = (p) => p.win.bleInterface.localNexoId.toLowerCase();
  const r = { build: path.basename(buildDir) };
  A.win.bleInterface.togglePanel(); for (const n of ['B', 'C', 'D']) await addFound(A, n); A.win.bleInterface.togglePanel();
  await sleep(1500);
  for (const n of ['B', 'C', 'D']) { await openChatWith(A, n); await sendText(A, 'hola ' + n); await sleep(2500); await closeChat(A); }

  // 1. A crea el grupo en modo Control con B y C
  A.win.NEXO_newGroupWith(); await sleep(400);
  const sheet = q(A, '#nexo-group-sheet');
  // dueño 23-11: lo PRIMERO son las dos opciones; el nombre y los contactos aparecen al elegir una
  r.opciones_primero = !!q(A, '#nexo-group-mode .gset-mode-o') && !!q(A, '#nexo-group-mode .gset-mode-p') && q(A, '#nexo-group-step2').style.display === 'none';
  click(A.win, q(A, '#nexo-group-mode .gset-mode-p'));
  r.personalizado_abre_paso_2 = q(A, '#nexo-group-step2').style.display === 'flex' && sheet.querySelectorAll('.gset-row .gset-who-adm[aria-pressed="true"]').length === 3;
  sheet.querySelectorAll('.nexo-pick-row input').forEach((cb) => { const nm = cb.parentNode.querySelector('.nx-pick-name').textContent; if (nm === 'B' || nm === 'C') { cb.checked = true; cb.dispatchEvent(new A.win.Event('change')); } });
  r.boton_admin_junto_a_elegidos = Array.from(sheet.querySelectorAll('.nexo-pick-admin')).filter((b) => b.style.display !== 'none').length === 2;
  const nmIn = sheet.querySelector('#nexo-group-name'); nmIn.value = 'Equipo'; nmIn.dispatchEvent(new A.win.Event('input'));
  click(A.win, sheet.querySelector('#nexo-group-create')); await sleep(800);
  const gid = Object.keys(gsOf(A).list)[0];
  r.v1_firmado_en_A = !!st(A, gid) && st(A, gid).v === 1 && st(A, gid).md === 'c' && st(A, gid).ow === 1;
  r.v1_en_B = await wait(() => st(B, gid) && st(B, gid).v === 1 && st(B, gid).cr === id(A), 60);
  r.v1_en_C = await wait(() => st(C, gid) && st(C, gid).v === 1, 60);
  r.aviso_creado_en_C = await wait(() => vaultHas(C, gid, /Creó el grupo/), 20);
  await closeChat(A);
  await openChatWith(C, '👥 Equipo');
  { const i = q(C, '#message-input'); r.C_barra_bloqueada = !!i && i.disabled && /Solo los administradores/.test(i.getAttribute('placeholder') || ''); }
  // 1b (dueño 23-11): ruedita de ajustes arriba a la derecha del chat del grupo, también para quien no es admin; tocar a un miembro
  { const gb = q(C, '#nexo-gset-btn'); r.C_ruedita_en_chat_grupo = !!gb && gb.style.display !== 'none' && gb.parentNode.id === 'chat-head-actions'; }
  click(C.win, q(C, '#nexo-gset-btn')); await sleep(300);
  r.C_ruedita_abre_ajustes = !!q(C, '#nexo-gset .gset-member[data-nx="' + id(A) + '"]');
  click(C.win, q(C, '#nexo-gset .gset-member[data-nx="' + id(B) + '"] .gset-member-name')); await sleep(600);
  r.C_toca_miembro_contacto_abre_chat = !q(C, '#nexo-gset') && C.win.bleInterface._activeChatDeviceId === id(B);
  { const gb = q(C, '#nexo-gset-btn'); r.C_sin_ruedita_en_chat_normal = !gb || gb.style.display === 'none'; }
  await closeChat(C);
  await openChatWith(C, '👥 Equipo');
  { const vl = C.win.vaultLoadContacts, bi = C.win.bleInterface, ab = bi.addByNexoId, sent = [];
    C.win.vaultLoadContacts = function() { return vl.apply(this, arguments).filter((c) => String(c.nexoId || '').toLowerCase() !== id(B)); };
    bi.addByNexoId = function(nx) { sent.push(nx); return Promise.resolve(true); };
    click(C.win, q(C, '#nexo-gset-btn')); await sleep(300);
    click(C.win, q(C, '#nexo-gset .gset-member[data-nx="' + id(B) + '"] .gset-member-name')); await sleep(300);
    r.C_toca_no_contacto_ofrece_agregar = !!q(C, '#nexo-gset-mem .gset-mem-add');
    // Dueño 26-11 (3160): sin botón X; el atrás de Android cierra la pantalla de arriba y luego Ajustes, y se queda en el chat
    r.C_ajustes_sin_x = !q(C, '#nexo-gset .gset-close') && !q(C, '#nexo-gset-mem .gset-close');
    { const hb = C.win.__nexoHandleBack;
      r.C_atras_cierra_ficha = !!(hb && hb()) && !q(C, '#nexo-gset-mem') && !!q(C, '#nexo-gset');
      r.C_atras_cierra_ajustes = !!(hb && hb()) && !q(C, '#nexo-gset') && C.win.document.body.classList.contains('chat-view-active');
      click(C.win, q(C, '#nexo-gset-btn')); await sleep(300);
      click(C.win, q(C, '#nexo-gset .gset-member[data-nx="' + id(B) + '"] .gset-member-name')); await sleep(300); }
    click(C.win, q(C, '#nexo-gset-mem .gset-mem-add')); await sleep(300);
    r.C_agregar_manda_solicitud = sent.length === 1 && sent[0] === id(B);
    C.win.vaultLoadContacts = vl; bi.addByNexoId = ab;
    ['#nexo-gset-mem', '#nexo-gset'].forEach((s) => { if (q(C, s)) q(C, s).remove(); }); }
  await closeChat(C);

  // 2. A designa admin a B desde Ajustes del grupo
  A.win.NEXO_openGroupMenu(gid); await sleep(200);
  r.menu_ajustes = !!q(A, '#nexo-group-menu .gm-settings');
  click(A.win, q(A, '#nexo-group-menu .gm-settings')); await sleep(300);
  r.panel = !!q(A, '#nexo-gset');
  click(A.win, q(A, '#nexo-gset .gset-admins')); await sleep(300);
  r.buscador_admins = !!q(A, '#nexo-gset-admins .gset-q');
  { const sq = q(A, '#nexo-gset-admins .gset-q'); sq.value = 'b'; sq.dispatchEvent(new A.win.Event('input')); r.buscador_filtra = q(A, '#nexo-gset-admins .gset-pick[data-nx="' + id(C) + '"]').style.display === 'none'; }
  check(A, '#nexo-gset-admins .gset-pick[data-nx="' + id(B) + '"] input');
  click(A.win, q(A, '#nexo-gset-admins .gset-save')); await sleep(800);
  r.B_admin_en_A = st(A, gid).ad.join() === [id(A), id(B)].join();
  r.B_admin_en_B = await wait(() => st(B, gid) && st(B, gid).v === 2 && st(B, gid).ad.indexOf(id(B)) >= 0, 60);
  r.B_admin_en_C = await wait(() => st(C, gid) && st(C, gid).v === 2, 60);
  r.aviso_admin_en_C = await wait(() => vaultHas(C, gid, /Ahora es admin/), 20);
  if (q(A, '#nexo-gset')) q(A, '#nexo-gset').remove();
  await openChatWith(B, '👥 Equipo'); await sendText(B, 'hola de B admin'); await sleep(300);
  r.B_escribe_llega_a_A = await wait(() => vaultHas(A, gid, /hola de B admin/), 60);
  r.B_escribe_llega_a_C = await wait(() => vaultHas(C, gid, /hola de B admin/), 60);
  await closeChat(B);

  // 3. C trucado: escribe y se firma admin
  gsOf(C).canWrite = () => true;
  C.win.NEXO_sendGroupText(gid, JSON.stringify({ type: 'nexo_txt', t: 'trampa de C' }), 'trampa de C');
  { const g = gsOf(C).get(gid), S = gsOf(C).state(gid); const fake = { g: gid, v: S.v + 1, p: gsOf(C).stateId(gid), cr: S.cr, ad: S.ad.concat([id(C)]), md: S.md, ow: S.ow, oa: S.oa, m: S.m, bl: S.bl, n: S.n, ph: S.ph, by: id(C), t: Date.now(), sg: '' };
    await gsOf(C)._sign(fake); gsOf(C).sendText(gid, JSON.stringify({ type: 'nexo_txt', t: '👥 Ahora es admin: C', gs: 1 }), null, null, null, null, { s: [fake] }); void g; }
  await sleep(7000);
  r.trampa_no_llega = !(await vaultHas(A, gid, /trampa de C/)) && !(await vaultHas(B, gid, /trampa de C/));
  r.C_no_se_hizo_admin = st(A, gid).v === 2 && st(B, gid).v === 2 && st(A, gid).ad.indexOf(id(C)) < 0;
  r.sin_aviso_falso = !(await vaultHas(A, gid, /Ahora es admin: C/));
  r.registro_descartado = logs.some((l) => /\[A\].*solo los administradores escriben/.test(l)) && logs.some((l) => /\[A\].*descartado: no puede designar admins/.test(l));
  delete gsOf(C).canWrite;

  // 4. A agrega a D
  A.win.NEXO_openGroupSettings(gid); await sleep(300);
  click(A.win, q(A, '#nexo-gset .gset-add')); await sleep(300);
  r.agregar_lista_sin_miembros = !q(A, '#nexo-gset-addl .gset-pick[data-nx="' + id(B) + '"]') && !!q(A, '#nexo-gset-addl .gset-pick[data-nx="' + id(D) + '"]');
  check(A, '#nexo-gset-addl .gset-pick[data-nx="' + id(D) + '"] input');
  click(A.win, q(A, '#nexo-gset-addl .gset-save')); await sleep(800);
  if (q(A, '#nexo-gset')) q(A, '#nexo-gset').remove();
  r.D_entra = await wait(() => st(D, gid) && st(D, gid).m.indexOf(id(D)) >= 0 && st(D, gid).v === 3, 60);
  r.B_ve_a_D = await wait(() => st(B, gid) && st(B, gid).m.indexOf(id(D)) >= 0, 60);
  r.D_no_ve_lo_anterior = !(await vaultHas(D, gid, /hola de B admin/));
  r.D_conoce_a_B = await wait(() => D.win.vaultLoadContacts().some((c) => (c.nexoId || '').toLowerCase() === id(B)), 30);
  await sleep(1500);
  await openChatWith(B, '👥 Equipo'); await sendText(B, 'segundo de B'); await sleep(300); await closeChat(B);
  r.D_recibe_lo_nuevo = await wait(() => vaultHas(D, gid, /segundo de B/), 60);

  // 5. B (admin) intenta expulsar al creador y manda un estado tocado
  { const S = gsOf(B).state(gid); const fake = { g: gid, v: S.v + 1, p: gsOf(B).stateId(gid), cr: id(B), ad: [id(B)], md: S.md, ow: S.ow, oa: S.oa, m: S.m.filter((x) => x !== id(A)), bl: S.bl, n: S.n, ph: S.ph, by: id(B), t: Date.now(), sg: '' };
    await gsOf(B)._sign(fake);
    const fake2 = { g: gid, v: S.v + 1, p: gsOf(B).stateId(gid), cr: S.cr, ad: S.ad, md: S.md, ow: S.ow, oa: S.oa, m: S.m, bl: S.bl, n: 'Renombrado', ph: S.ph, by: id(B), t: Date.now(), sg: '' };
    await gsOf(B)._sign(fake2); fake2.ow = 0; // tocado DESPUÉS de firmar: la firma ya no vale
    r.B_no_puede_localmente = await gsOf(B).kick(gid, id(A)).then(() => false, () => true);
    gsOf(B).sendText(gid, JSON.stringify({ type: 'nexo_txt', t: '👥', gs: 1 }), null, null, null, null, { s: [fake] });
    gsOf(B).sendText(gid, JSON.stringify({ type: 'nexo_txt', t: '👥', gs: 1 }), null, null, null, null, { s: [fake2] }); }
  await sleep(7000);
  r.creador_sigue = [A, C, D].every((p) => st(p, gid).cr === id(A) && st(p, gid).m.indexOf(id(A)) >= 0 && st(p, gid).v === 3);
  r.tocado_rechazado = [A, C, D].every((p) => st(p, gid).ow === 1 && st(p, gid).n === 'Equipo') && logs.some((l) => /firma no válida/.test(l));

  // 6. B expulsa a C
  B.win.NEXO_openGroupSettings(gid); await sleep(300);
  r.B_sin_expulsar_creador = !q(B, '#nexo-gset .gset-member[data-nx="' + id(A) + '"] .gset-kick');
  click(B.win, q(B, '#nexo-gset .gset-member[data-nx="' + id(C) + '"] .gset-kick')); await sleep(300);
  r.B_sin_bloquear = !!q(B, '#nexo-gset-kick .gset-kick-only') && !q(B, '#nexo-gset-kick .gset-kick-block');
  click(B.win, q(B, '#nexo-gset-kick .gset-kick-only')); await sleep(800);
  if (q(B, '#nexo-gset')) q(B, '#nexo-gset').remove();
  r.C_fuera_en_A = await wait(() => st(A, gid).m.indexOf(id(C)) < 0, 60);
  r.C_fuera_en_D = await wait(() => st(D, gid).m.indexOf(id(C)) < 0, 60);
  r.C_expulsado = await wait(() => gsOf(C).get(gid).kicked === true, 60);
  // dueño 22-11 (opción B): al expulsado el grupo le DESAPARECE de la lista (no queda de solo lectura)
  r.C_grupo_desaparece = await wait(() => !gsOf(C).all().some((g) => g.id === gid), 20);
  r.C_sin_fila_en_la_lista = !(await openChatWith(C, '👥 Equipo'));
  { const g = gsOf(C).get(gid); g.kicked = false; gsOf(C).canWrite = () => true; g.members = [id(A), id(B), id(D), id(C)];
    gsOf(C).sendText(gid, JSON.stringify({ type: 'nexo_txt', t: 'sigo escribiendo' }), null, null, null, null, { x: 1 }); g.kicked = true; delete gsOf(C).canWrite; }
  await sleep(7000);
  r.expulsado_no_llega = !(await vaultHas(A, gid, /sigo escribiendo/)) && !(await vaultHas(B, gid, /sigo escribiendo/)) && !(await vaultHas(D, gid, /sigo escribiendo/));

  // 7. A expulsa y bloquea a D; B ve la lista sin Desbloquear; A desbloquea y lo vuelve a agregar
  A.win.NEXO_openGroupSettings(gid); await sleep(300);
  r.sin_bloqueados_sin_boton = !q(A, '#nexo-gset .gset-blocked');
  click(A.win, q(A, '#nexo-gset .gset-member[data-nx="' + id(D) + '"] .gset-kick')); await sleep(300);
  click(A.win, q(A, '#nexo-gset-kick .gset-kick-block')); await sleep(800);
  r.bloqueados_aparece = !!q(A, '#nexo-gset .gset-blocked');
  r.D_bloqueado_en_B = await wait(() => st(B, gid).bl.indexOf(id(D)) >= 0 && st(B, gid).m.indexOf(id(D)) < 0, 60);
  r.D_expulsado = await wait(() => gsOf(D).get(gid).kicked === true, 60);
  if (q(A, '#nexo-gset')) q(A, '#nexo-gset').remove();
  B.win.NEXO_openGroupSettings(gid); await sleep(300);
  click(B.win, q(B, '#nexo-gset .gset-blocked')); await sleep(300);
  r.B_ve_bloqueados_sin_desbloquear = !!q(B, '#nexo-gset-bl .gset-bl-row[data-nx="' + id(D) + '"]') && !q(B, '#nexo-gset-bl .gset-unblock');
  if (q(B, '#nexo-gset-bl')) q(B, '#nexo-gset-bl').remove();
  click(B.win, q(B, '#nexo-gset .gset-add')); await sleep(300);
  r.B_no_puede_agregar_al_bloqueado = !!q(B, '#nexo-gset-addl') && !q(B, '#nexo-gset-addl .gset-pick[data-nx="' + id(D) + '"]');
  ['#nexo-gset-addl', '#nexo-gset'].forEach((s) => { if (q(B, s)) q(B, s).remove(); });
  A.win.NEXO_openGroupSettings(gid); await sleep(300);
  click(A.win, q(A, '#nexo-gset .gset-blocked')); await sleep(300);
  click(A.win, q(A, '#nexo-gset-bl .gset-unblock')); await sleep(800);
  r.desbloqueado_en_B = await wait(() => st(B, gid).bl.length === 0, 60);
  await sleep(300);
  if (!q(A, '#nexo-gset')) A.win.NEXO_openGroupSettings(gid);
  await sleep(300);
  r.bloqueados_desaparece = !q(A, '#nexo-gset .gset-blocked');
  click(A.win, q(A, '#nexo-gset .gset-add')); await sleep(300);
  check(A, '#nexo-gset-addl .gset-pick[data-nx="' + id(D) + '"] input');
  click(A.win, q(A, '#nexo-gset-addl .gset-save')); await sleep(800);
  if (q(A, '#nexo-gset')) q(A, '#nexo-gset').remove();
  r.D_vuelve = await wait(() => gsOf(D).get(gid).kicked === false && st(D, gid).m.indexOf(id(D)) >= 0 && gsOf(D).all().some((g) => g.id === gid), 60);

  // 8. B se atrasa y se pone al día con el siguiente mensaje de A
  await wait(() => st(B, gid).v === st(A, gid).v, 30);
  { const g = gsOf(B).get(gid); const old = g.sl[g.sl.length - 3]; g.sl = g.sl.slice(0, g.sl.length - 2); g.s = old; g.members = old.m.slice(); r.B_atrasado = g.s.v + 2 === st(A, gid).v; }
  await openChatWith(A, '👥 Equipo'); await sendText(A, 'mensaje de A con versión'); await sleep(300); await closeChat(A);
  r.B_al_dia = await wait(() => st(B, gid).v === st(A, gid).v && st(B, gid).m.indexOf(id(D)) >= 0, 60);
  r.registro_pide_estado = logs.some((l) => /\[B\].*Voy atrasado/.test(l));

  // 9. Foto del grupo y fondo compartido
  const PH = 'data:image/jpeg;base64,' + Buffer.from('foto-del-grupo-' + 'x'.repeat(300)).toString('base64');
  await gsOf(A).setPhoto(gid, PH);
  r.foto_en_B = await wait(() => gsOf(B).photoOf(gid) === PH, 60);
  r.foto_en_lista_B = await wait(() => Array.from(B.win.document.querySelectorAll('#main-contacts-list .ble-contact-row')).some((row) => /foto-del-grupo|Zm90by1kZWwtZ3J1cG8/.test((row.querySelector('.ble-contact-avatar') || {}).style ? row.querySelector('.ble-contact-avatar').style.backgroundImage : '')), 10);
  const WP = 'data:image/jpeg;base64,' + Buffer.from('fondo-del-grupo-' + 'y'.repeat(300)).toString('base64');
  A.win.NEXO_makeWallpaper = () => WP;
  A.win.NEXO_openGroupSettings(gid); await sleep(300);
  click(A.win, q(A, '#nexo-gset .gset-wp')); await sleep(300);
  { const fin = q(A, '#nexo-gset-wpl .gset-wp-file'); Object.defineProperty(fin, 'files', { value: [new A.win.File([Buffer.from('x')], 'f.jpg', { type: 'image/jpeg' })] }); fin.dispatchEvent(new A.win.Event('change')); }
  await sleep(500);
  click(A.win, q(A, '#nexo-gset .gset-wp')); await sleep(300);
  r.boton_compartir_fondo = !!q(A, '#nexo-gset-wpl .gset-wp-share');
  click(A.win, q(A, '#nexo-gset-wpl .gset-wp-share')); await sleep(300);
  if (q(A, '#nexo-gset')) q(A, '#nexo-gset').remove();
  const wpFile = async (p) => { const o = await p.win.Capacitor.Plugins.NexoBLE.loadFromFile({ filename: 'nexo_wp_c_' + gid + '.json' }); try { return JSON.parse(o.content).img; } catch (e) { return null; } };
  r.fondo_en_B = await wait(async () => (await wpFile(B)) === WP, 60);
  // Dueño 26-11: cada quien pone el fondo SOLO para sí; compartir es a propósito. Uno compartido cambia al compartido de antes, pero NO
  // al que B eligió para sí: ése se queda y el compartido queda para usarlo desde ⚙️ → Fondo del grupo.
  const pickWp = async (p, img, share) => {
    p.win.NEXO_makeWallpaper = () => img;
    p.win.NEXO_openGroupSettings(gid); await sleep(300);
    click(p.win, q(p, '#nexo-gset .gset-wp')); await sleep(300);
    { const fin = q(p, '#nexo-gset-wpl .gset-wp-file'); Object.defineProperty(fin, 'files', { value: [new p.win.File([Buffer.from('x')], 'f.jpg', { type: 'image/jpeg' })] }); fin.dispatchEvent(new p.win.Event('change')); }
    await sleep(500);
    if (share) { click(p.win, q(p, '#nexo-gset .gset-wp')); await sleep(300); click(p.win, q(p, '#nexo-gset-wpl .gset-wp-share')); await sleep(300); }
    ['#nexo-gset-wpl', '#nexo-gset'].forEach((x) => { if (q(p, x)) q(p, x).remove(); });
  };
  const offerFile = async (p) => { const o = await p.win.Capacitor.Plugins.NexoBLE.loadFromFile({ filename: 'nexo_wp_o_' + gid + '.json' }).catch(() => null); try { return JSON.parse(o.content).img || null; } catch (e) { return null; } };
  const WP2 = 'data:image/jpeg;base64,' + Buffer.from('fondo-dos-' + 'z'.repeat(300)).toString('base64');
  const WPB = 'data:image/jpeg;base64,' + Buffer.from('fondo-de-B-' + 'w'.repeat(300)).toString('base64');
  const WP3 = 'data:image/jpeg;base64,' + Buffer.from('fondo-tres-' + 'v'.repeat(300)).toString('base64');
  await pickWp(A, WP2, true);
  r.fondo_compartido_cambia_el_compartido = await wait(async () => (await wpFile(B)) === WP2, 60);
  await pickWp(B, WPB, false);
  r.fondo_propio_solo_en_B = (await wpFile(B)) === WPB && (await wpFile(A)) === WP2;
  await pickWp(A, WP3, true);
  r.fondo_propio_se_queda = (await wait(async () => (await offerFile(B)) === WP3, 60)) !== false && (await wpFile(B)) === WPB;
  B.win.NEXO_openGroupSettings(gid); await sleep(300);
  click(B.win, q(B, '#nexo-gset .gset-wp')); await sleep(500);
  r.boton_usar_el_compartido = !!q(B, '#nexo-gset-wpl .gset-wp-offer');
  click(B.win, q(B, '#nexo-gset-wpl .gset-wp-offer')); await sleep(300);
  ['#nexo-gset-wpl', '#nexo-gset'].forEach((x) => { if (q(B, x)) q(B, x).remove(); });
  r.usa_el_compartido = (await wpFile(B)) === WP3;

  // 10. Sale el creador: pasa a B (el admin más antiguo)
  A.win.NEXO_openGroupSettings(gid); await sleep(300);
  click(A.win, q(A, '#nexo-gset .gset-leave')); await sleep(800);
  r.A_fuera = !gsOf(A).all().some((g) => g.id === gid);
  r.B_creador = await wait(() => st(B, gid).cr === id(B) && st(B, gid).m.indexOf(id(A)) < 0, 60);
  r.D_ve_a_B_creador = await wait(() => st(D, gid).cr === id(B), 60);

  // 11. Grupo viejo (sin estado): como antes; después, el primer cambio firmado
  const g2 = gsOf(A).create('Viejo', [id(B), id(C)]).id;
  A.win.NEXO_sendGroupText(g2, JSON.stringify({ type: 'nexo_txt', t: '👥 Creó el grupo «Viejo»' }), 'creó');
  r.viejo_en_B = await wait(() => !!gsOf(B).get(g2) && !gsOf(B).get(g2).s, 60);
  await sleep(2000); // 24-11: que lleguen antes los «Se unió al grupo» de B y C (en un grupo viejo el nombre del último sobre manda)
  gsOf(B).rename(g2, 'Viejo renombrado'); await sleep(1000);
  r.viejo_B_abre = await openChatWith(B, '👥 Viejo renombrado');
  await sendText(B, 'hola viejo'); await sleep(300); await closeChat(B);
  r.viejo_renombra_como_antes = await wait(() => gsOf(A).get(g2).name === 'Viejo renombrado' && !gsOf(A).get(g2).s, 60);
  await gsOf(A).setAdmins(g2, [id(A), id(B)]);
  r.viejo_primer_estado_en_B = await wait(() => st(B, g2) && st(B, g2).v === 1 && st(B, g2).ad.indexOf(id(B)) >= 0, 60);
  r.viejo_primer_estado_en_C = await wait(() => st(C, g2) && st(C, g2).v === 1, 60);

  r.errores = logs.filter((l) => / error: /.test(l) && !/JSDOMERROR|styles\.css/.test(l)).slice(0, 5);
  const fails = Object.keys(r).filter((k) => r[k] === false);
  if (r.errores.length) fails.push('errores');
  r.resultado = fails.length ? 'FALLO' : 'OK';
  if (fails.length) r.fallan = fails;
  console.log('GRUPOSADMIN ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_gruposadmin.txt'), logs.join('\n'));
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error(e); fs.writeFileSync(path.join(__dirname, 'last_logs_gruposadmin.txt'), logs.join('\n')); process.exit(1); });
