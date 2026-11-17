// 3196 (dueño 17-11: «falta el botón para buscar contactos en la pantalla Contactos»): hasta ahora la cabecera de Contactos solo
// tenía Perfil y Grupo; el único buscador estaba dentro de «Agregar» (ronda 2771) y no filtraba la lista principal.
// Chromium real a 360 px con toques de verdad (CDP) y el teclado de verdad. A tiene 30 contactos (nombres con acentos, algunos con
// no leídos) y un grupo, «Familia Pérez»:
//  L   la lupa está en la cabecera, a la derecha, se ve entera y recibe el toque (elementFromPoint); al presionarla responde el motor
//      de press.js (se hunde: is-pressed); área de toque ≥ 44 px (la suya y la de Perfil y Grupo); aria-label y title en el idioma;
//      al tocarla sale el campo con el teclado puesto (foco), «Buscar por nombre o NEXO ID» y la ✕.
//  B1  «jose» encuentra José, María José y Joselyn (sin distinguir acentos ni mayúsculas; «JOSÉ» igual), en el MISMO orden que la
//      lista completa (último arriba) y con sus no leídos; buscando, la tira «en línea» y el aviso de solicitudes no salen (al
//      cerrar, vuelven).
//  B2  un trozo del NEXO ID sin «NX» (en mayúsculas), con «nx» (minúsculas) y con «Nx » y espacio: solo ese contacto.
//  B3  el grupo por su nombre («perez»).
//  B4  algo que no existe: ninguna fila y «Ningún contacto coincide» (no el aviso de «Aún no tienes contactos»).
//  R   el filtro aguanta un redibujo: forzado, un mensaje nuevo de alguien que NO coincide (no aparece), uno de alguien que sí (sube
//      arriba con su no leído) y alguien que se conecta (la tira sigue escondida mientras se busca).
//  D   deslizar para actualizar sigue funcionando con el buscador abierto («[ACTUALIZAR]» en el registro), sin abrir un chat.
//  C   la ✕ (responde al dedo como la lupa; al soltar, cierra) y el atrás de Android (__nexoHandleBack) cierran: campo vacío, barra
//      fuera, lista completa (31) y la tira y el aviso de nuevo; con todo cerrado, atrás ya no hace nada (false).
//  T   tocar un resultado (contacto y grupo) abre su chat y el buscador se cierra; al volver, la lista completa.
//  I   5 idiomas (es, it, en, pt, fr): textos nuevos en los 5, distintos del español, sin voseo; en la app, aria-label, campo, ✕ y
//      «ningún contacto» en su idioma; a 360 px (y 320) la cabecera no se desborda: título entero, botones dentro y sin pisarse.
//  P   rendimiento: con 1000 contactos (CPU ×4, como un teléfono), escribir «jose» tecla a tecla, rápido (90 ms) y a ritmo de pulgar
//      (200 ms), no traba (al abrir y al escribir, ninguna tarea de más de 200 ms —o de 0,6 veces lo que tarda la app en dibujar la
//      lista completa, si la máquina va más lenta—) y el resultado está ≤ 600 ms después de la última tecla; cerrar devuelve las 1000.
// Contraprueba dea1918d (HEAD sin la 3196): FALLO (L_hay_lupa: no hay lupa).
// Uso: node buscarcontactos.js <dir_build>      (BUSCAR_SHOTS=<carpeta>: capturas de la cabecera y de la búsqueda)
'use strict';
const fs = require('fs');
const path = require('path');
if (!process.env.SHOTS_VIEWPORT) process.env.SHOTS_VIEWPORT = '360x740';
const { PW, bootPhone, sleep } = require('./pw_harness');
const { Radio, NativePhone } = require('./native_mock');

const buildDir = path.resolve(process.argv[2] || path.join(__dirname, 'builds/wip'));
const dist = path.join(buildDir, 'dist');
const shots = process.env.BUSCAR_SHOTS ? path.resolve(process.env.BUSCAR_SHOTS) : '';
const LANGS = ['es', 'it', 'en', 'pt', 'fr'];
const logs = [];
const r = { prueba: 'buscarcontactos', build: path.basename(buildDir) };
const fallos = [];
const fin = (ok) => {
  r.fallos = fallos;
  r.resultado = ok && !fallos.length ? 'OK' : 'FALLO';
  console.log('BUSCARCONTACTOS ' + JSON.stringify(r));
  try { fs.writeFileSync(path.join(__dirname, 'last_logs_buscarcontactos.txt'), logs.join('\n')); } catch (e) {}
};
const check = (k, v, info) => { r[k] = v; if (v !== true) fallos.push(k + (info ? ' (' + info + ')' : '')); };

// Los textos de cada idioma, tal cual están en la build que se prueba
const TXT = {};
for (const l of LANGS) {
  try {
    const s = fs.readFileSync(path.join(buildDir, 'src', 'ui', 'i18n', l + '.js'), 'utf8');
    const a = s.indexOf('export default {'), b = s.lastIndexOf('\n};');
    TXT[l] = new Function('return ' + s.slice(a + 'export default '.length, b + 2))();
  } catch (e) { TXT[l] = {}; }
}
const VOSEO = /\b(busc[aá]s|busc[aá]|tocá|toc[aá]s|escrib[ií]s|escribí|ten[eé]s|pod[eé]s|quer[eé]s|sab[eé]s|sos|vos|mirá|elegí|probá|agregá)\b/i;

// ---------- la libreta de A ----------
let seed = 3196; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const B36 = '0123456789abcdefghijklmnopqrstuvwxyz';
const used = new Set();
const nxId = () => { for (;;) { const id = 'nx' + Array.from({ length: 8 }, () => B36[Math.floor(rnd() * 36)]).join(''); if (!used.has(id)) { used.add(id); return id; } } };
const NAMES = ['José Martínez', 'María José López', 'Ángela Ruiz', 'Iñaki Peña', 'Zoë Müller', 'Joselyn Ortiz', 'Andrés Gómez', 'Ana', 'Beto', 'Carla',
  'Diego', 'Elena', 'Fernando', 'Gabriela', 'Héctor', 'Isabel', 'Jorge', 'Karla', 'Luis', 'Mónica', 'Nicolás', 'Óscar', 'Pablo', 'Raúl', 'Sofía',
  'Tomás', 'Úrsula', 'Valeria', 'Ximena', 'Yolanda'];
const UNREAD = { 'María José López': 3, 'Joselyn Ortiz': 1, 'Diego': 2 };
function libreta(names, now) {
  // mezcladas en el tiempo (el orden de la lista no es el alfabético ni el de alta)
  const order = names.map((n, i) => ({ n, k: rnd() })).sort((a, b) => a.k - b.k).map((x) => x.n);
  return names.map((name, i) => {
    const id = nxId();
    return { nexoId: id, deviceUUID: id, name, addedAt: now - 40 * 86400000 + i, lastSeen: 0, online: false, unreadCount: UNREAD[name] || 0, lastMessage: 'Hola ' + i, lastMessageAt: now - (order.indexOf(name) + 1) * 7 * 60000 };
  });
}
const fold = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

// ---------- lo que se mide dentro de la página ----------
function pageHelpers() {
  const R = (x) => Math.round(x * 10) / 10;
  const q = (el) => { const b = el.getBoundingClientRect(); return { l: R(b.left), r: R(b.right), t: R(b.top), b: R(b.bottom), w: R(b.width), h: R(b.height) }; };
  window.__bc = {
    rows() {
      return Array.from(document.querySelectorAll('#main-contacts-list .ble-contact-row')).map((row) => ({
        name: (row.querySelector('.ble-contact-name') || {}).textContent || '',
        unread: Number(((row.querySelector('.ble-unread-badge') || {}).textContent) || 0),
      }));
    },
    names() { return this.rows().map((x) => x.name); },
    vis(el) { if (!el) return false; for (let e = el; e && e.nodeType === 1; e = e.parentElement) { const cs = getComputedStyle(e); if (cs.display === 'none' || cs.visibility === 'hidden') return false; } const b = el.getBoundingClientRect(); return b.width > 0 && b.height > 0; },
    hit(el) { if (!el) return false; const b = el.getBoundingClientRect(); const h = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2); return !!h && (h === el || el.contains(h)); },
    // área de toque: la caja más lo que le suma press.js (--hs-*)
    area(el) {
      if (!el) return null;
      const b = el.getBoundingClientRect(), cs = getComputedStyle(el), v = (k) => parseFloat(cs.getPropertyValue(k)) || 0;
      return { w: R(b.width + v('--hs-l') + v('--hs-r')), h: R(b.height + v('--hs-t') + v('--hs-b')) };
    },
    state() {
      const bar = document.getElementById('nexo-contacts-search-bar'), inp = document.getElementById('nexo-contacts-search-input');
      const strip = document.getElementById('main-contacts-online-strip');
      return {
        bar: this.vis(bar), value: inp ? inp.value : null, foco: !!inp && document.activeElement === inp,
        strip: !!strip && getComputedStyle(strip).display !== 'none', stripItems: strip ? strip.children.length : 0,
        nomatch: this.vis(document.getElementById('main-contacts-nomatch')) ? document.getElementById('main-contacts-nomatch').textContent : null,
        vacio: this.vis(document.getElementById('main-contacts-empty-msg')),
        banner: !!document.getElementById('ble-req-banner'),
        chat: document.body.classList.contains('chat-view-active'),
        activo: (window.NEXO && window.NEXO.app && window.NEXO.app.activeContact && window.NEXO.app.activeContact.nexoId) || null,
      };
    },
    // la cabecera a este ancho: nada se sale ni se pisa, el título entero
    header() {
      const W = document.documentElement.clientWidth, h = document.getElementById('main-header'), tt = document.getElementById('main-title');
      const ids = ['nexo-contacts-search-btn', 'nexo-profile-btn', 'nexo-new-group-btn'];
      const out = { W, header: { scroll: h.scrollWidth, client: h.clientWidth }, titulo: q(tt), titulo_entero: tt.scrollWidth <= tt.clientWidth + 0.5, texto: tt.textContent, botones: {} };
      const malos = [];
      if (h.scrollWidth > h.clientWidth + 0.5) malos.push('cabecera desborda');
      if (!out.titulo_entero) malos.push('título cortado');
      let prev = null;
      ids.forEach((id) => {
        const el = document.getElementById(id);
        if (!el) { malos.push(id + ' no está'); return; }
        const b = q(el); out.botones[id] = b;
        if (b.l < -0.5 || b.r > W + 0.5 || b.t < -0.5 || b.b > h.getBoundingClientRect().bottom + 0.5) malos.push(id + ' fuera');
        if (!this.hit(el)) malos.push(id + ' no recibe el toque');
        if (prev && b.l < prev.r - 0.5) malos.push(id + ' pisa al anterior');
        prev = b;
      });
      const lupa = out.botones['nexo-contacts-search-btn'];
      if (lupa && out.titulo.r > lupa.l - 4) malos.push('título pisa la lupa');
      out.malos = malos;
      return out;
    },
  };
}

(async () => {
  const browser = await PW.chromium.launch();
  const now = Date.now();
  const contacts = libreta(NAMES, now);
  const byName = {}; contacts.forEach((c) => { byName[c.name] = c; });
  const gid = 'gr' + 'fam3196px';
  const group = { id: gid, name: 'Familia Pérez', members: [contacts[0].nexoId, contacts[7].nexoId], createdBy: contacts[0].nexoId, createdAt: now - 86400000, lastMessageAt: now - 17 * 60000, lastMessage: 'Ana: ¿comemos?', unreadCount: 2 };
  const radio = new Radio();
  const opts = { readsContentFallback: true, retain: ['onPayloadReceived'], closeOnNoService: true, pace: [5, 5], ioDelay: 10, asymmetric: true, noTor: true };
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', opts);
  radio.add(nA); nA.load();
  nA.files.set('nexo_vault_contacts.json', JSON.stringify({ contacts, savedAt: now }));
  nA.files.set('nexo_groups.json', JSON.stringify({ groups: { [gid]: group }, st: {} }));
  // sin idioma fijo en el arnés (lo volvería a poner en cada recarga): se pone por localStorage y se recarga, como Ajustes → Idioma
  const phA = await bootPhone(browser, 'A', nA, dist, { phone: true, logs, seedName: 'Ana' });
  const A = phA.page, cdp = phA.cdp;
  const ev = (fn, arg) => A.evaluate(fn, arg);
  await ev(() => localStorage.setItem('nexo_lang', 'es'));
  await A.reload();
  await A.waitForFunction(() => window.NEXO && window.NEXO.initialized, null, { timeout: 60000 });
  await sleep(800);
  const H = () => A.evaluate(pageHelpers);
  await H();
  const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: (type === 'touchEnd' || type === 'touchCancel') ? [] : [{ x, y }] });
  const center = (sel) => ev((s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; }, sel);
  const tap = async (sel) => { const c = await center(sel); if (!c) return false; await touch('touchStart', c.x, c.y); await sleep(60); await touch('touchEnd'); await sleep(250); return true; };
  const names = () => ev(() => window.__bc.names());
  const rows = () => ev(() => window.__bc.rows());
  const st = () => ev(() => window.__bc.state());
  const waitFor = async (fn, ms) => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return Date.now() - t0; if (Date.now() - t0 > ms) return null; await sleep(40); } };
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const clear = async () => { await A.keyboard.press('Control+A'); await A.keyboard.press('Backspace'); await sleep(200); };
  const typeQ = async (s) => { await clear(); await A.keyboard.type(s, { delay: 60 }); };

  // ---------- la lista completa (el orden de referencia) ----------
  await waitFor(async () => (await names()).length === NAMES.length + 1, 15000);
  const full = await names();
  r.lista_completa = full.length;
  check('preparado', full.length === NAMES.length + 1, full.length + ' filas');
  const info = (n) => { const c = byName[n]; return c ? { id: c.nexoId, group: false } : { id: gid, group: true }; };
  const expect = (qs, base) => {
    const fq = fold(qs).replace(/\s+/g, ' ').trim(), iq = fq.replace(/[^0-9a-z]/g, '');
    return (base || full).filter((n) => fold(n).includes(fq) || (!info(n).group && iq.length >= 3 && info(n).id.includes(iq)));
  };

  // ---------- L: la lupa ----------
  const lupa = await ev(() => {
    const b = document.getElementById('nexo-contacts-search-btn');
    if (!b) return null;
    const h = document.getElementById('main-header');
    return { enCabecera: h.contains(b), visible: window.__bc.vis(b), toque: window.__bc.hit(b), aria: b.getAttribute('aria-label'), title: b.title, w: b.offsetWidth, h: b.offsetHeight,
      derecha: b.getBoundingClientRect().left > document.documentElement.clientWidth / 2, area: window.__bc.area(b),
      areaPerfil: window.__bc.area(document.getElementById('nexo-profile-btn')), areaGrupo: window.__bc.area(document.getElementById('nexo-new-group-btn')) };
  });
  r.L_lupa = lupa;
  check('L_hay_lupa', !!lupa);
  if (!lupa) { await browser.close(); fin(false); process.exit(1); }
  check('L_en_la_cabecera_a_la_derecha', lupa.enCabecera && lupa.visible && lupa.derecha && lupa.toque);
  check('L_aria_label', lupa.aria === TXT.es.contacts_search && lupa.title === TXT.es.contacts_search, lupa.aria);
  const a44 = (a) => !!a && a.w >= 44 && a.h >= 44;
  check('L_area_44', a44(lupa.area) && a44(lupa.areaPerfil) && a44(lupa.areaGrupo), JSON.stringify([lupa.area, lupa.areaPerfil, lupa.areaGrupo]));
  r.H_es_360 = await ev(() => window.__bc.header());
  if (shots) { fs.mkdirSync(shots, { recursive: true }); await A.screenshot({ path: path.join(shots, r.build + '_cabecera.png'), clip: { x: 0, y: 0, width: 360, height: 140 }, scale: 'css' }); }
  // presionar (motor de press.js) y soltar: se abre con el teclado puesto
  const lc = await center('#nexo-contacts-search-btn');
  await touch('touchStart', lc.x, lc.y);
  await sleep(140);
  r.L_presionada = await ev(() => { const b = document.getElementById('nexo-contacts-search-btn'); return { pressable: b.classList.contains('nx-pressable'), pressed: b.classList.contains('is-pressed'), onda: !!b.querySelector('.nx-ripple') }; });
  await touch('touchEnd');
  await sleep(350);
  check('L_responde_al_dedo', r.L_presionada.pressable && r.L_presionada.pressed && r.L_presionada.onda, JSON.stringify(r.L_presionada));
  const s0 = await st();
  const campo = await ev(() => { const i = document.getElementById('nexo-contacts-search-input'), x = document.getElementById('nexo-contacts-search-close'); return { ph: i && i.placeholder, xVis: window.__bc.vis(x), xToque: window.__bc.hit(x), xAria: x && x.getAttribute('aria-label'), xArea: window.__bc.area(x) }; });
  r.L_abierta = Object.assign({}, s0, campo);
  check('L_abre_con_teclado', s0.bar && s0.foco && s0.value === '');
  check('L_campo_y_x', campo.ph === TXT.es.ph_search_contact && campo.xVis && campo.xToque && campo.xAria === TXT.es.misc_search_close && a44(campo.xArea), JSON.stringify(campo));
  check('L_lista_igual_al_abrir', same(await names(), full));

  // ---------- B1: «jose» (y «JOSÉ») ----------
  // dos contactos «en línea» (la tira) y una solicitud pendiente (el aviso): buscando no salen
  await ev(() => {
    window.NEXO_STRIP_MS = 1;
    const cs = window.vaultLoadContacts();
    cs.forEach((c) => { if (c.name === 'Ana' || c.name === 'José Martínez') { c.online = true; c.lastSeen = Date.now(); } });
    window.vaultSaveContacts(cs);
    const bi = window.bleInterface;
    localStorage.setItem('nexo_req_in', JSON.stringify([{ id: 'nx00req196', name: 'Alguien', at: Date.now() }]));
    bi._renderContactsListNow();
    bi.renderOnlineStrip(); setTimeout(() => bi.renderOnlineStrip(), 30);
  });
  await sleep(300);
  { const s1 = await st(); r.B1_tira_antes = s1.strip; r.B1_aviso_antes = s1.banner; }
  await A.keyboard.type('jose', { delay: 60 });
  const expJose = expect('jose');
  r.B1_esperado = expJose;
  r.B1_ms = await waitFor(async () => same(await names(), expJose), 2000);
  const rJose = await rows();
  r.B1_filas = rJose;
  check('B1_jose', r.B1_ms !== null && expJose.length === 3 && expJose.every((n) => /Jos[eé]/.test(n)), JSON.stringify(rJose.map((x) => x.name)));
  check('B1_no_leidos', rJose.every((x) => x.unread === ((byName[x.name] || {}).unreadCount || 0)), JSON.stringify(rJose));
  const sJ = await st();
  check('B1_tira_y_aviso_escondidos', r.B1_tira_antes === true && r.B1_aviso_antes === true && sJ.strip === false && sJ.banner === false && sJ.foco, JSON.stringify({ antes: [r.B1_tira_antes, r.B1_aviso_antes], ahora: [sJ.strip, sJ.banner] }));
  if (shots) await A.screenshot({ path: path.join(shots, r.build + '_jose.png'), clip: { x: 0, y: 0, width: 360, height: 420 }, scale: 'css' });
  await typeQ('JOSÉ');
  r.B1_mayus_ms = await waitFor(async () => same(await names(), expJose), 2000);
  check('B1_mayusculas_y_acento', r.B1_mayus_ms !== null, JSON.stringify(await names()));

  // ---------- B2: trozo del NEXO ID ----------
  const target = byName['Isabel'];
  let chunk = '';
  for (let k = 2; k <= 5 && !chunk; k++) { const c = target.nexoId.substr(k, 5); if (contacts.filter((x) => x.nexoId.includes(c)).length === 1) chunk = c; }
  r.B2_id = target.nexoId; r.B2_trozo = chunk;
  const idQueries = [chunk.toUpperCase(), 'nx' + target.nexoId.substr(2, 4), 'Nx ' + target.nexoId.substr(2, 4).toUpperCase()];
  r.B2 = {};
  for (const qs of idQueries) {
    await typeQ(qs);
    const ms = await waitFor(async () => same(await names(), ['Isabel']), 2000);
    r.B2[qs] = ms === null ? await names() : 'ok';
  }
  check('B2_nexo_id', !!chunk && Object.values(r.B2).every((v) => v === 'ok'), JSON.stringify(r.B2));

  // ---------- B3: el grupo por su nombre ----------
  await typeQ('perez');
  const expG = expect('perez');
  r.B3_ms = await waitFor(async () => same(await names(), expG), 2000);
  r.B3_filas = await rows();
  check('B3_grupo', r.B3_ms !== null && expG.length === 1 && /Familia Pérez/.test(expG[0]) && r.B3_filas[0].unread === 2, JSON.stringify(r.B3_filas));

  // ---------- B4: nada ----------
  await typeQ('zzqx');
  r.B4_ms = await waitFor(async () => (await names()).length === 0, 2000);
  const s4 = await st();
  r.B4 = s4;
  check('B4_ningun_contacto', r.B4_ms !== null && s4.nomatch === TXT.es.contacts_no_match && !s4.vacio, JSON.stringify(s4));

  // ---------- R: el filtro aguanta los redibujos ----------
  await typeQ('jose');
  await waitFor(async () => same(await names(), expJose), 2000);
  await ev(() => window.bleInterface._renderContactsListNow());
  r.R_forzado = await names();
  const idBeto = byName['Beto'].nexoId, idJoselyn = byName['Joselyn Ortiz'].nexoId;
  await ev(([b, j]) => {
    const bi = window.bleInterface;
    bi._noteContactAt(b, 'mensaje nuevo de Beto', Date.now()); bi.bumpUnread(b);
    bi._noteContactAt(j, 'mensaje nuevo de Joselyn', Date.now() + 1); bi.bumpUnread(j);
  }, [idBeto, idJoselyn]);
  await sleep(800);
  r.R_mensajes = await rows();
  await ev(() => {
    const cs = window.vaultLoadContacts();
    cs.forEach((c) => { if (c.name === 'Carla') { c.online = true; c.lastSeen = Date.now(); } });
    window.vaultSaveContacts(cs);
    window.bleInterface.renderContactsList(); window.bleInterface.renderOnlineStrip();
  });
  await sleep(800);
  const fullR = ['Joselyn Ortiz', 'Beto'].concat(full.filter((n) => n !== 'Joselyn Ortiz' && n !== 'Beto'));
  const expR = expect('jose', fullR);
  r.R_conexion = await names();
  const sR = await st();
  check('R_forzado', same(r.R_forzado, expJose), JSON.stringify(r.R_forzado));
  check('R_mensaje_nuevo', same(r.R_mensajes.map((x) => x.name), expR) && r.R_mensajes[0].name === 'Joselyn Ortiz' && r.R_mensajes[0].unread === 2 && !r.R_mensajes.some((x) => x.name === 'Beto'), JSON.stringify(r.R_mensajes));
  check('R_conexion', same(r.R_conexion, expR) && sR.strip === false && sR.bar && sR.value === 'jose', JSON.stringify({ filas: r.R_conexion, tira: sR.strip }));

  // ---------- D: deslizar para actualizar con el buscador abierto ----------
  await typeQ('a');
  const expA = expect('a', fullR);
  await waitFor(async () => same(await names(), expA), 2000);
  await A.evaluate(() => { const e = document.activeElement; if (e && e.blur) e.blur(); }); // el teclado baja (como al tocar la lista)
  await sleep(200);
  const nLogs0 = logs.length;
  const lr = await ev(() => { const l = document.querySelector('#main-contacts-list .ble-contact-row'); const b = l.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + 10 }; });
  await touch('touchStart', lr.x, lr.y);
  for (let i = 1; i <= 12; i++) { await sleep(25); await touch('touchMove', lr.x, lr.y + i * 12); }
  await sleep(80);
  await touch('touchEnd');
  const dms = await waitFor(async () => logs.slice(nLogs0).some((l) => /\[ACTUALIZAR\] Deslizar/.test(l)), 3000);
  await sleep(400);
  const sD = await st();
  r.D = { ms: dms, chat: sD.chat, filtro: sD.value };
  check('D_deslizar_actualiza', dms !== null && !sD.chat && sD.bar && sD.value === 'a' && same(await names(), expA), JSON.stringify(r.D));

  // ---------- C: la ✕ y el atrás ----------
  await ev(() => { const cs = window.vaultLoadContacts(); cs.forEach((c) => { if (c.online) c.lastSeen = Date.now(); }); window.vaultSaveContacts(cs); window.bleInterface.renderOnlineStrip(); });
  // la ✕ también responde al dedo (motor de press.js) y al soltar cierra
  const xc = await center('#nexo-contacts-search-close');
  await touch('touchStart', xc.x, xc.y);
  await sleep(140);
  r.C_x_presionada = await ev(() => { const b = document.getElementById('nexo-contacts-search-close'); return { pressed: b.classList.contains('is-pressed'), onda: !!b.querySelector('.nx-ripple') }; });
  await touch('touchEnd');
  await sleep(650);
  const sX = await st();
  const fullAfterX = await names();
  r.C_x = { bar: sX.bar, value: sX.value, filas: fullAfterX.length, tira: sX.strip, aviso: sX.banner, nomatch: sX.nomatch };
  check('C_x_responde_al_dedo', r.C_x_presionada.pressed && r.C_x_presionada.onda, JSON.stringify(r.C_x_presionada));
  check('C_x_cierra', !sX.bar && sX.value === '' && same(fullAfterX, fullR) && sX.strip === true && sX.banner === true && !sX.nomatch, JSON.stringify(r.C_x));
  await tap('#nexo-contacts-search-btn');
  r.C_reabre_foco = (await st()).foco;
  await A.keyboard.type('jose', { delay: 40 });
  await waitFor(async () => same(await names(), expR), 2000);
  const back1 = await ev(() => window.__nexoHandleBack());
  await sleep(400);
  const sB = await st();
  const back2 = await ev(() => window.__nexoHandleBack());
  r.C_atras = { primero: back1, bar: sB.bar, value: sB.value, filas: (await names()).length, segundo: back2 };
  check('C_atras_cierra', r.C_reabre_foco && back1 === true && !sB.bar && sB.value === '' && same(await names(), fullR) && back2 === false, JSON.stringify(r.C_atras));

  // ---------- T: tocar un resultado abre su chat ----------
  await tap('#nexo-contacts-search-btn');
  await A.keyboard.type('maria jose', { delay: 40 });
  await waitFor(async () => same(await names(), ['María José López']), 2000);
  // el toque en el nombre (no en el círculo ni en el ⋮)
  await tap('#main-contacts-list .ble-contact-row .ble-contact-name');
  const tms = await waitFor(async () => (await st()).chat, 3000);
  const sT = await st();
  r.T_contacto = { ms: tms, activo: sT.activo, bar: sT.bar, cabecera: await ev(() => document.getElementById('chat-contact-name').value) };
  check('T_abre_chat', tms !== null && sT.activo === byName['María José López'].nexoId && !sT.bar && r.T_contacto.cabecera === 'María José López', JSON.stringify(r.T_contacto));
  await ev(() => window.__nexoHandleBack());
  await waitFor(async () => !(await st()).chat, 3000);
  await sleep(500);
  const sT2 = await st();
  const listT = await names();
  r.T_vuelta = { chat: sT2.chat, bar: sT2.bar, filas: listT.length };
  check('T_vuelve_completa', !sT2.chat && !sT2.bar && listT.length === NAMES.length + 1 && (await ev(() => window.NEXO_contactSearch.query())) === null, JSON.stringify(r.T_vuelta));
  await tap('#nexo-contacts-search-btn');
  await A.keyboard.type('familia', { delay: 40 });
  await waitFor(async () => (await names()).length === 1, 2000);
  await tap('#main-contacts-list .ble-contact-row .ble-contact-name');
  const gms = await waitFor(async () => (await st()).chat, 3000);
  const sG = await st();
  r.T_grupo = { ms: gms, activo: sG.activo, bar: sG.bar };
  check('T_abre_grupo', gms !== null && sG.activo === gid && !sG.bar, JSON.stringify(r.T_grupo));
  await ev(() => window.__nexoHandleBack());
  await waitFor(async () => !(await st()).chat, 3000);
  await sleep(500);

  // ---------- I: 5 idiomas ----------
  r.I = {};
  const nuevas = ['contacts_search', 'contacts_no_match'];
  const tabla = {};
  for (const l of LANGS) tabla[l] = nuevas.map((k) => TXT[l][k] || null);
  r.I_textos = tabla;
  check('I_textos_5_idiomas', LANGS.every((l) => tabla[l].every((x) => typeof x === 'string' && x.trim())) && LANGS.filter((l) => l !== 'es').every((l) => tabla[l].every((x, i) => x !== tabla.es[i])), JSON.stringify(tabla));
  check('I_sin_voseo', !tabla.es.some((x) => VOSEO.test(x || '')), JSON.stringify(tabla.es));
  const header360 = {};
  for (const l of LANGS) {
    await ev((x) => localStorage.setItem('nexo_lang', x), l);
    await A.reload();
    await A.waitForFunction(() => window.NEXO && window.NEXO.initialized, null, { timeout: 60000 });
    await H();
    await waitFor(async () => (await names()).length === NAMES.length + 1, 15000);
    await sleep(500);
    const c = { idioma: await ev(() => localStorage.getItem('nexo_lang')) };
    for (const w of [360, 320]) {
      await A.setViewportSize({ width: w, height: 740 });
      await sleep(400);
      c['cabecera_' + w] = await ev(() => window.__bc.header());
    }
    await A.setViewportSize({ width: 360, height: 740 });
    await sleep(300);
    c.aria = await ev(() => { const b = document.getElementById('nexo-contacts-search-btn'); return b && b.getAttribute('aria-label'); });
    await tap('#nexo-contacts-search-btn');
    await A.keyboard.type('zzqx', { delay: 30 });
    await waitFor(async () => (await names()).length === 0, 2000);
    const sI = await st();
    c.campo = await ev(() => { const i = document.getElementById('nexo-contacts-search-input'), x = document.getElementById('nexo-contacts-search-close'); return { ph: i.placeholder, x: x.getAttribute('aria-label') }; });
    c.nomatch = sI.nomatch;
    c.foco = sI.foco;
    await tap('#nexo-contacts-search-close');
    c.ok = c.idioma === l && c.aria === TXT[l].contacts_search && c.campo.ph === TXT[l].ph_search_contact && c.campo.x === TXT[l].misc_search_close && c.nomatch === TXT[l].contacts_no_match && c.foco;
    header360[l] = !c.cabecera_360.malos.length;
    r.I[l] = { ok: c.ok, aria: c.aria, ph: c.campo.ph, nomatch: c.nomatch, titulo: c.cabecera_360.texto, titulo_360: c.cabecera_360.titulo, malos_360: c.cabecera_360.malos, malos_320: c.cabecera_320.malos, lupa_360: c.cabecera_360.botones['nexo-contacts-search-btn'] };
    if (shots) await A.screenshot({ path: path.join(shots, r.build + '_cabecera_' + l + '.png'), clip: { x: 0, y: 0, width: 360, height: 70 }, scale: 'css' });
  }
  check('I_app_en_su_idioma', LANGS.every((l) => r.I[l].ok), JSON.stringify(LANGS.filter((l) => !r.I[l].ok)));
  check('I_cabecera_360_no_desborda', LANGS.every((l) => header360[l]), JSON.stringify(LANGS.map((l) => [l, r.I[l].malos_360])));
  r.I_cabecera_320_sin_problemas = LANGS.filter((l) => !r.I[l].malos_320.length);
  check('I_cabecera_320_no_desborda', LANGS.every((l) => !r.I[l].malos_320.length), JSON.stringify(LANGS.map((l) => [l, r.I[l].malos_320])));
  await A.close();

  // ---------- P: 1000 contactos ----------
  const N = 1000;
  const FIRST = ['José', 'Ana', 'Luis', 'María', 'Carlos', 'Lucía', 'Jorge', 'Sofía', 'Pedro', 'Elena', 'Raúl', 'Inés', 'Joselyn', 'Tomás', 'Paula', 'Andrés', 'Marta', 'Diego', 'Nuria', 'Iván'];
  const LAST = ['García', 'López', 'Martínez', 'Sánchez', 'Pérez', 'Gómez', 'Díaz', 'Ruiz', 'Hernández', 'Jiménez', 'Muñoz', 'Álvarez', 'Romero', 'Navarro', 'Torres', 'Domínguez', 'Vázquez', 'Ramos', 'Gil', 'Serrano'];
  const bigNames = Array.from({ length: N }, (_, i) => FIRST[i % FIRST.length] + ' ' + LAST[Math.floor(i / FIRST.length) % LAST.length] + ' ' + (i + 1));
  const big = libreta(bigNames, now);
  const nP = new NativePhone('P', 'CC:CC:CC:CC:CC:03', opts);
  radio.add(nP); nP.load();
  nP.files.set('nexo_vault_contacts.json', JSON.stringify({ contacts: big, savedAt: now }));
  const phP = await bootPhone(browser, 'P', nP, dist, { phone: true, logs, seedName: 'Pepe', lang: 'es', cpuThrottle: 4 });
  const P = phP.page, cdpP = phP.cdp;
  await P.evaluate(pageHelpers);
  const nP0 = await (async () => { for (let i = 0; i < 150; i++) { const n = await P.evaluate(() => window.__bc.names().length); if (n === N) return n; await sleep(200); } return P.evaluate(() => window.__bc.names().length); })();
  r.P_filas = nP0;
  await sleep(1500);
  const perfOf = async (fn) => {
    await P.evaluate(() => { window.__perf.lags = []; window.__perf.longs = []; });
    const out = await fn();
    const pf = await P.evaluate(() => ({ lags: window.__perf.lags.slice(), longs: window.__perf.longs.slice() }));
    const lags = pf.lags.sort((a, b) => a - b);
    return Object.assign(out || {}, { lag_max: Math.round(lags[lags.length - 1] || 0), largas: pf.longs.length, larga_max: Math.round(Math.max(0, ...pf.longs)) });
  };
  const tapP = async (id) => {
    const c = await P.evaluate((x) => { const b = document.getElementById(x); if (!b) return null; const q = b.getBoundingClientRect(); return { x: q.left + q.width / 2, y: q.top + q.height / 2 }; }, id);
    if (!c) return false;
    await cdpP.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: c.x, y: c.y }] }); await sleep(60); await cdpP.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    return true;
  };
  const countP = () => P.evaluate(() => window.__bc.names().length);
  // referencia: la app quieta el mismo rato, y lo que cuesta un dibujo de la lista completa (lo de siempre, sin buscar)
  r.P_quieta = await perfOf(async () => { await sleep(1500); return {}; });
  r.P_dibujo_completo = await perfOf(async () => { const ms = await P.evaluate(() => { const t0 = performance.now(); window.bleInterface._renderContactsListNow(); void document.body.offsetHeight; return Math.round(performance.now() - t0); }); await sleep(600); return { ms }; });
  // cuántas veces se redibuja la lista mientras se escribe
  await P.evaluate(() => { const bi = window.bleInterface, o = bi._renderContactsListNow; window.__draws = []; bi._renderContactsListNow = function() { const t0 = performance.now(); const x = o.apply(this, arguments); window.__draws.push(Math.round(performance.now() - t0)); return x; }; });
  await sleep(800);
  const fq = 'jose', expP = bigNames.filter((n) => fold(n).includes(fq)).length;
  r.P = { contactos: nP0, escrito: fq, esperado: expP };
  let back = true;
  for (const delay of [90, 200]) {
    const ab = await perfOf(async () => { await tapP('nexo-contacts-search-btn'); await sleep(600); return {}; });
    await P.evaluate(() => { window.__draws = []; });
    const m = await perfOf(async () => {
      const t0 = Date.now();
      await P.keyboard.type(fq, { delay });
      const tLast = Date.now();
      let tDone = null;
      for (;;) { const n = await countP(); if (n === expP) { tDone = Date.now(); break; } if (Date.now() - tLast > 4000) break; await sleep(20); }
      await sleep(300);
      return { tecla_ms: delay, escribir_ms: tLast - t0, ms_tras_ultima_tecla: tDone === null ? null : tDone - tLast };
    });
    m.dibujos = await P.evaluate(() => window.__draws.slice());
    m.abrir_larga_max = ab.larga_max;
    r.P['teclas_' + delay] = m;
    // cerrar: las 1000 de nuevo
    await tapP('nexo-contacts-search-close');
    let ok = false; for (let i = 0; i < 100 && !ok; i++) { await sleep(50); ok = (await countP()) === N; }
    m.cerrar_vuelven_todas = ok;
    back = back && ok;
    await sleep(800);
  }
  // «no traba»: ninguna tarea al abrir ni al escribir pasa de 200 ms o, si esta máquina va más lenta, de 6 décimas de lo que ya tarda
  // la app en dibujar la lista completa (lo que hace con cada mensaje nuevo): así se caza un filtrado que redibuje las 1000 filas por
  // tecla sin depender de la carga de la máquina
  const tope = Math.max(200, Math.round(0.6 * r.P_dibujo_completo.larga_max));
  r.P.tope_tarea_ms = tope;
  const bien = (m) => m.ms_tras_ultima_tecla !== null && m.ms_tras_ultima_tecla <= 600 && m.larga_max <= tope && m.abrir_larga_max <= tope;
  check('P_1000_contactos', nP0 === N && bien(r.P.teclas_90) && bien(r.P.teclas_200) && back, JSON.stringify(r.P));

  r.errores = logs.filter((l) => /PAGEERROR|TypeError|ReferenceError/.test(l)).slice(0, 5);
  check('sin_errores', !r.errores.length, JSON.stringify(r.errores));
  await browser.close();
  fin(true);
  process.exit(r.resultado === 'OK' ? 0 : 1);
})().catch((e) => { fallos.push('excepción: ' + String(e && e.message || e).substring(0, 300)); r.error = String(e && e.stack || e).substring(0, 600); fin(false); process.exit(1); });
