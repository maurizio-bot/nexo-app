// Dueño 27-11, «propuesta B» de la cabecera del chat y del grupo (aprobada: «parejo en ambos, pero menos botones mejor»). Chromium real a
// 360×780 con toques de verdad (CDP):
//  F1  1-a-1: tocar la FOTO abre el visor (#nexo-photo-view) y nada más (ni «Información», ni la hoja vieja de opciones); sin foto se ven
//      las iniciales en grande; en 1-a-1 NO hay «Cambiar foto» (la foto es del contacto); atrás lo cierra y se queda en el chat
//  N1  1-a-1: el nombre es un botón (no se edita al tocarlo) con un «›» justo al final del nombre, que no pisa los botones de la derecha;
//      tocar el nombre abre «Información»: campo con el nombre, NEXO ID y las opciones del chat (buscar, destacados, temporales,
//      silenciar, bloquear); una opción cierra la página y abre su hoja sobre el chat
//  N2  cambiar el nombre en «Información» cambia la cabecera y la libreta
//  G1  grupo: sin rueda en la cabecera; tocar la foto abre el visor con «Cambiar foto» (el creador puede cambiarlo); tocar el nombre abre
//      «Información» con las opciones del chat Y lo de la rueda de antes (miembros, fondo, salir); atrás vuelve al chat
// Contraprueba con la 3170: FALLO (la foto abre la hoja de opciones; hay rueda en el grupo).
// Uso: node cabecerachat.js <dir_build>     (CABCHAT_SHOTS=<carpeta>: capturas)
'use strict';
const fs = require('fs');
const path = require('path');
if (!process.env.SHOTS_VIEWPORT) process.env.SHOTS_VIEWPORT = '360x780';
const { PW, bootPhone, sleep } = require('./pw_harness');
const { Radio, NativePhone } = require('./native_mock');

const buildDir = path.resolve(process.argv[2] || path.join(__dirname, 'builds/wip'));
const dist = path.join(buildDir, 'dist');
const shots = process.env.CABCHAT_SHOTS ? path.resolve(process.env.CABCHAT_SHOTS) : '';
const logs = [];
const r = { prueba: 'cabecerachat', build: path.basename(buildDir) };
const fallos = [];
const check = (k, v, info) => { r[k] = v; if (v !== true) fallos.push(k + (info ? ' (' + info + ')' : '')); };
const ID = 'nxcabchat01';
const NX = 'nxcabcht01';

(async () => {
  const browser = await PW.chromium.launch();
  const now = Date.now();
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', { readsContentFallback: true, noTor: true });
  radio.add(nA); nA.load();
  nA.files.set('nexo_vault_contacts.json', JSON.stringify({ contacts: [{ nexoId: NX, deviceUUID: NX, name: 'Carla Méndez', addedAt: now - 86400000, lastSeen: 0, online: false, unreadCount: 0, lastMessage: 'Hola', lastMessageAt: now - 60000 }], savedAt: now }));
  const ph = await bootPhone(browser, 'A', nA, dist, { phone: true, logs, seedName: 'Ana' });
  const A = ph.page, cdp = ph.cdp;
  const ev = (fn, arg) => A.evaluate(fn, arg);
  await A.waitForFunction(() => window.NEXO && window.NEXO.initialized && window.bleInterface && window.bleInterface.groups, null, { timeout: 60000 });
  await sleep(4200);
  await ev(() => { ['nexo-bat-overlay', 'nexo-welcome-overlay'].forEach((id) => { const o = document.getElementById(id); if (o) o.remove(); }); });
  const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: (type === 'touchEnd' || type === 'touchCancel') ? [] : [{ x, y }] });
  const center = (sel) => ev((s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return { x: b.left + Math.min(b.width / 2, 30), y: b.top + b.height / 2 }; }, sel);
  const tap = async (sel) => { const c = await center(sel); if (!c) return false; await touch('touchStart', c.x, c.y); await sleep(60); await touch('touchEnd'); await sleep(500); return true; };
  const back = () => ev(() => (typeof window.__nexoHandleBack === 'function' ? window.__nexoHandleBack() : null));
  const has = (sel) => ev((s) => !!document.querySelector(s), sel);
  const shot = async (n) => { if (shots) { fs.mkdirSync(shots, { recursive: true }); await A.screenshot({ path: path.join(shots, n + '.png') }); } };
  const cleanAll = () => ev(() => { document.querySelectorAll('.nx-panel,.nx-chat-sheet').forEach((x) => x.remove()); });

  // ---------- 1-a-1 ----------
  await ev((nx) => window.bleInterface.openChat(nx).catch(() => {}), NX);
  await sleep(1200);
  r.chat_abierto = await ev(() => document.body.classList.contains('chat-view-active'));
  // F1
  await tap('#chat-contact-avatar');
  r.F1 = await ev(() => ({ visor: !!document.getElementById('nexo-photo-view'), info: !!document.getElementById('nexo-chat-info'), hojaVieja: !!document.getElementById('nexo-chat-menu'),
    ini: ((document.querySelector('#nexo-photo-view .nx-photo-ini') || {}).textContent) || '', cambiar: !!document.querySelector('#nexo-photo-view .nx-photo-change'),
    nombre: ((document.querySelector('#nexo-photo-view .nx-photo-name') || {}).textContent) || '' }));
  await shot('1_visor_contacto');
  const bF = await back();
  r.F1.atras = !!bF && !(await has('#nexo-photo-view')) && (await ev(() => document.body.classList.contains('chat-view-active')));
  check('F1_foto_abre_visor', r.chat_abierto && r.F1.visor && !r.F1.info && !r.F1.hojaVieja && r.F1.ini === 'CM' && !r.F1.cambiar && r.F1.nombre === 'Carla Méndez' && r.F1.atras, JSON.stringify(r.F1));
  // N1: el nombre con su «›»
  r.N1_geo = await ev(() => {
    const nm = document.getElementById('chat-contact-name'), ch = document.getElementById('chat-name-chev'), act = document.getElementById('chat-head-actions');
    const c = ch && ch.getBoundingClientRect(), a = act && act.getBoundingClientRect();
    const cv = document.createElement('canvas').getContext('2d'); const cs = getComputedStyle(nm); cv.font = cs.fontWeight + ' ' + cs.fontSize + ' ' + cs.fontFamily;
    const n = nm.getBoundingClientRect(), textoFin = n.left + (parseFloat(cs.paddingLeft) || 0) + cv.measureText(nm.value).width;
    let actL = 9999; if (act) Array.from(act.children).forEach((b) => { const r0 = b.getBoundingClientRect(); if (r0.width > 0 && r0.left < actL) actL = r0.left; });
    return { role: document.getElementById('chat-contact-info').getAttribute('role'), ro: nm.readOnly, chev: !!c && c.width > 0, chevL: c ? Math.round(c.left) : null, chevR: c ? Math.round(c.right) : null, textoFin: Math.round(textoFin), actL: Math.round(actL),
      enLinea: c ? Math.abs((c.top + c.bottom) / 2 - (n.top + Math.min(n.height, parseFloat(cs.lineHeight) || 23) / 2)) < 8 : false };
  });
  { const g = r.N1_geo; check('N1_nombre_boton_con_flecha', g.role === 'button' && g.ro === true && g.chev && g.chevL >= g.textoFin - 2 && g.chevL <= g.textoFin + 14 && g.chevR <= g.actL && g.enLinea, JSON.stringify(g)); }
  await shot('2_cabecera_contacto');
  await tap('#chat-contact-name');
  r.N1 = await ev(() => ({ info: !!document.getElementById('nexo-chat-info'), visor: !!document.getElementById('nexo-photo-view'), titulo: ((document.querySelector('#nexo-chat-info .nx-page-title') || {}).textContent) || '',
    nombre: ((document.querySelector('#nexo-chat-info .nx-info-name') || {}).value) || '', id: ((document.querySelector('#nexo-chat-info .nx-info-id') || {}).textContent) || '',
    opciones: Array.from(document.querySelectorAll('#nexo-chat-info .nx-info-opt')).map((b) => Array.from(b.classList).filter((c) => /^chat-/.test(c))[0]),
    foco: document.activeElement && document.activeElement.id === 'chat-contact-name' }));
  await shot('3_informacion_contacto');
  const want = ['chat-search', 'chat-starred', 'chat-disappear', 'chat-mute', 'chat-block'];
  check('N1_nombre_abre_informacion', r.N1.info && !r.N1.visor && /^(Información|Info|Informações|Infos)$/.test(r.N1.titulo) && r.N1.nombre === 'Carla Méndez' && r.N1.id === 'NEXO ID: ' + NX.toUpperCase() &&
    JSON.stringify(r.N1.opciones) === JSON.stringify(want) && !r.N1.foco, JSON.stringify(r.N1));
  await tap('#nexo-chat-info .nx-info-opt.chat-mute');
  r.N1_opcion = await ev(() => ({ info: !!document.getElementById('nexo-chat-info'), hoja: !!document.getElementById('nexo-mute-menu') }));
  check('N1_opcion_abre_su_hoja', !r.N1_opcion.info && r.N1_opcion.hoja, JSON.stringify(r.N1_opcion));
  await cleanAll();
  // N2: cambiar el nombre
  await tap('#chat-contact-name');
  await ev(() => { const i = document.querySelector('#nexo-chat-info .nx-info-name'); i.value = 'Carla M.'; i.dispatchEvent(new Event('change')); });
  await sleep(400);
  r.N2 = await ev((nx) => ({ cab: document.getElementById('chat-contact-name').value, libreta: ((window.vaultLoadContacts ? window.vaultLoadContacts() : []).find((c) => String(c.nexoId).toLowerCase() === nx) || {}).name }), NX);
  check('N2_cambiar_nombre', r.N2.cab === 'Carla M.' && r.N2.libreta === 'Carla M.', JSON.stringify(r.N2));
  await back();
  r.N2.atras = !(await has('#nexo-chat-info')) && (await ev(() => document.body.classList.contains('chat-view-active')));
  check('N2_atras_vuelve_al_chat', r.N2.atras);
  await ev(() => window.dispatchEvent(new CustomEvent('nexo:ble:closeChat', { detail: {} })));
  await sleep(400);

  // ---------- grupo ----------
  const gid = await ev(() => window.bleInterface.groups.create('Amigos del barrio', ['nxa1a1a1a1', 'nxcabcht01']).id);
  await ev(() => window.bleInterface.renderContactsList());
  await sleep(300);
  await ev(() => { const row = Array.from(document.querySelectorAll('#main-contacts-list .ble-contact-row')).find((x) => ((x.querySelector('.ble-contact-name') || {}).textContent || '').indexOf('Amigos') >= 0); if (row) row.click(); });
  await sleep(1000);
  r.G1_rueda = await has('#nexo-gset-btn');
  await shot('4_cabecera_grupo');
  await tap('#chat-contact-avatar');
  r.G1_visor = await ev(() => ({ visor: !!document.getElementById('nexo-photo-view'), cambiar: !!document.querySelector('#nexo-photo-view .nx-photo-change'), gset: !!document.getElementById('nexo-gset') }));
  await shot('5_visor_grupo');
  await back();
  await tap('#chat-contact-name');
  r.G1_info = await ev(() => ({ gset: !!document.getElementById('nexo-gset'), titulo: ((document.querySelector('#nexo-gset .nx-page-title') || {}).textContent) || '',
    opciones: Array.from(document.querySelectorAll('#nexo-gset .nx-info-opt')).map((b) => Array.from(b.classList).filter((c) => /^chat-/.test(c))[0]),
    miembros: document.querySelectorAll('#nexo-gset .gset-member').length, fondo: !!document.querySelector('#nexo-gset .gset-wp'), salir: !!document.querySelector('#nexo-gset .gset-leave'), nombre: !!document.querySelector('#nexo-gset .gset-name') }));
  await shot('6_informacion_grupo');
  // M1 (dueño 27-11): tocar a un miembro en «Información» abre su TARJETA: contacto → Mensaje / Llamar / Info (los 3 caben a 360 px); no
  // contacto → «Agregar»; atrás cierra la tarjeta y deja «Información»
  await ev(() => { const m = document.querySelector('#nexo-gset .gset-member[data-nx="nxcabcht01"] .gset-member-name'); if (m) m.click(); });
  await sleep(400);
  r.M1 = await ev(() => { const c = document.getElementById('nexo-member-card'); if (!c) return { tarjeta: false };
    const W = document.documentElement.clientWidth, bs = Array.from(c.querySelectorAll('.nx-mcard-btn')).map((b) => b.getBoundingClientRect());
    const top = document.elementFromPoint(W / 2, c.querySelector('.nx-mcard-name').getBoundingClientRect().top + 5);
    return { tarjeta: true, botones: Array.from(c.querySelectorAll('.nx-mcard-btn')).map((b) => b.className.split(' ')[1]), nombre: c.querySelector('.nx-mcard-name').textContent,
      caben: bs.every((b) => b.left >= 0 && b.right <= W && b.height >= 44), encima: !!top && c.contains(top) }; });
  await shot('7_tarjeta_miembro');
  await back();
  r.M1.atras = !(await has('#nexo-member-card')) && (await has('#nexo-gset'));
  await ev(() => { const m = document.querySelector('#nexo-gset .gset-member[data-nx="nxa1a1a1a1"] .gset-member-name'); if (m) m.click(); });
  await sleep(400);
  r.M1.noContacto = await ev(() => ({ add: !!document.querySelector('#nexo-member-card .mcard-add'), botones: document.querySelectorAll('#nexo-member-card .nx-mcard-btn').length }));
  await back();
  check('M1_tarjeta_de_miembro', r.M1.tarjeta && JSON.stringify(r.M1.botones) === JSON.stringify(['mcard-msg', 'mcard-call', 'mcard-info']) && r.M1.nombre === 'Carla M.' && r.M1.caben && r.M1.encima && r.M1.atras &&
    r.M1.noContacto.add && r.M1.noContacto.botones === 0, JSON.stringify(r.M1));
  await back();
  r.G1_info.atras = !(await has('#nexo-gset')) && (await ev(() => document.body.classList.contains('chat-view-active')));
  check('G1_sin_rueda', r.G1_rueda === false);
  check('G1_foto_visor_con_cambiar', r.G1_visor.visor && r.G1_visor.cambiar && !r.G1_visor.gset, JSON.stringify(r.G1_visor));
  check('G1_nombre_abre_informacion', r.G1_info.gset && /^(Información|Info|Informações|Infos)$/.test(r.G1_info.titulo) && JSON.stringify(r.G1_info.opciones) === JSON.stringify(['chat-search', 'chat-starred', 'chat-disappear', 'chat-mute']) &&
    r.G1_info.miembros === 3 && r.G1_info.fondo && r.G1_info.salir && r.G1_info.nombre && r.G1_info.atras, JSON.stringify(r.G1_info));
  r.gid = gid;
  r.errores = logs.filter((l) => /PAGEERROR|TypeError|is not a function/.test(l)).slice(0, 5);
  r.fallos = fallos;
  r.resultado = !fallos.length && !r.errores.length ? 'OK' : 'FALLO';
  console.log('CABECERACHAT ' + JSON.stringify(r));
  try { fs.writeFileSync(path.join(__dirname, 'last_logs_cabecerachat.txt'), logs.join('\n')); } catch (e) {}
  await browser.close();
  process.exit(r.resultado === 'OK' ? 0 : 1);
})().catch((e) => { console.log('CABECERACHAT ' + JSON.stringify(Object.assign(r, { resultado: 'FALLO', fallos, error: String(e && e.stack).slice(0, 300) }))); process.exit(1); });
