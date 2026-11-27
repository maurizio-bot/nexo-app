// 3218 (dueño 17-11: «separar ajustes de perfil», eligió el diseño clásico; regla: «al agregar nuevas funciones hay que hacerlo de forma
// práctica y cómoda, ergonómica y estética»). La cabecera de Contactos: arriba a la IZQUIERDA mi foto (círculo de color con la inicial si
// no hay foto) y mi nombre —tocarlos abre MI Perfil—; arriba a la DERECHA la lupa, «nuevo grupo» y la ruedita de Ajustes (abre Ajustes
// DIRECTO y su «atrás» vuelve a la lista, no a Perfil); «Contactos» como título centrado debajo. Botones con el estilo único aprobado
// (SECUNDARIO: círculo de 44 px, fondo blanco al 8 %, aro de 1 px al 14 %, icono de línea blanco de 2).
// Chromium real a 360×780 con toques de verdad (CDP). A tiene nombre fijo «Ana» y 6 contactos:
//  N0  al arrancar, la cabecera ya dice «Ana» y la app usa el nombre FIJO (bi.localDeviceName): antes, si el nativo contestaba después de
//      aplicarlo, durante ~4 s mandaba el nombre del teléfono («A»)
//  G   geometría a 360 px: «yo» (foto 36–40 px redonda + nombre) a la izquierda; lupa, grupo y ruedita a la derecha (la ruedita en la
//      esquina), todo en la misma fila, dentro de la pantalla, sin pisarse, cada uno recibe el toque y tiene área ≥ 44 px; «Contactos»
//      debajo, centrado y entero; la cabecera no desborda
//  E   estilo: lupa, grupo y ruedita IGUALES (44 px, redondos, mismo fondo, borde e icono de línea blanco de 2)
//  T   responden al dedo (press.js: se hunden con la onda) la ruedita y «yo»
//  S   la ruedita abre Ajustes (y no Perfil); atrás (gesto) vuelve a la LISTA: sin Ajustes ni Perfil y con la lista a la vista; dentro
//      de una sección, atrás vuelve a la lista de Ajustes y otro atrás a Contactos; el botón «atrás» también
//  P   tocar foto/nombre abre MI Perfil (mi NEXO ID y «te ven como Ana»), y nada más (ni Ajustes, ni el selector de foto, ni el juego);
//      el atajo de Ajustes de Perfil sigue y su atrás vuelve a Perfil
//  F   cambiar mi foto en Perfil → la cabecera la muestra al momento; «Quitar» → vuelve la inicial
//  M   el nombre se elige por primera vez (pantalla «¿Cómo te llamas?», B sin nombre): la cabecera cambia al momento; un nombre largo se
//      acorta con «…» sin pisar la lupa
//  I   5 idiomas a 360 px: título entero y centrado, sin desbordes ni solapes, etiquetas de la ruedita y de «yo» en su idioma
// Contraprueba b3205: FALLO (no hay ruedita ni foto/nombre en la cabecera).
// Uso: node cabecera.js <dir_build>      (CABECERA_SHOTS=<carpeta>: capturas de la cabecera en los 5 idiomas y de Ajustes)
'use strict';
const fs = require('fs');
const path = require('path');
if (!process.env.SHOTS_VIEWPORT) process.env.SHOTS_VIEWPORT = '360x780';
const { PW, bootPhone, sleep } = require('./pw_harness');
const { Radio, NativePhone } = require('./native_mock');

const buildDir = path.resolve(process.argv[2] || path.join(__dirname, 'builds/wip'));
const dist = path.join(buildDir, 'dist');
const shots = process.env.CABECERA_SHOTS ? path.resolve(process.env.CABECERA_SHOTS) : '';
const LANGS = ['es', 'it', 'en', 'pt', 'fr'];
const logs = [];
const r = { prueba: 'cabecera', build: path.basename(buildDir) };
const fallos = [];
const fin = (ok) => {
  r.fallos = fallos;
  r.errores = logs.filter((l) => /PAGEERROR|TypeError|is not a function|undefined is not/.test(l)).slice(0, 5);
  r.resultado = ok && !fallos.length && !r.errores.length ? 'OK' : 'FALLO';
  console.log('CABECERA ' + JSON.stringify(r));
  try { fs.writeFileSync(path.join(__dirname, 'last_logs_cabecera.txt'), logs.join('\n')); } catch (e) {}
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

const NAMES = ['Beto', 'Carla Méndez', 'Diego', 'Elena Ríos', 'Fernando', 'Gabriela'];
function libreta(now) {
  return NAMES.map((name, i) => {
    const id = 'nx' + ('cab' + i + '3218xyz').slice(0, 8);
    return { nexoId: id, deviceUUID: id, name, addedAt: now - 9 * 86400000 + i, lastSeen: 0, online: false, unreadCount: i === 1 ? 2 : 0, lastMessage: 'Hola ' + i, lastMessageAt: now - (i + 1) * 9 * 60000 };
  });
}

// ---------- lo que se mide dentro de la página ----------
function pageHelpers() {
  const R = (x) => Math.round(x * 10) / 10;
  const q = (el) => { const b = el.getBoundingClientRect(); return { l: R(b.left), r: R(b.right), t: R(b.top), b: R(b.bottom), w: R(b.width), h: R(b.height) }; };
  const $ = (id) => document.getElementById(id);
  window.__cab = {
    vis(el) { if (!el) return false; for (let e = el; e && e.nodeType === 1; e = e.parentElement) { const cs = getComputedStyle(e); if (cs.display === 'none' || cs.visibility === 'hidden') return false; } const b = el.getBoundingClientRect(); return b.width > 0 && b.height > 0; },
    hit(el) { if (!el) return false; const b = el.getBoundingClientRect(); const h = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2); return !!h && (h === el || el.contains(h)); },
    area(el) {
      if (!el) return null;
      const b = el.getBoundingClientRect(), cs = getComputedStyle(el), v = (k) => parseFloat(cs.getPropertyValue(k)) || 0;
      return { w: R(b.width + v('--hs-l') + v('--hs-r')), h: R(b.height + v('--hs-t') + v('--hs-b')) };
    },
    // la cabecera a este ancho: nada se sale, ni se pisa, ni se corta
    header() {
      const W = document.documentElement.clientWidth, h = $('main-header'), tt = $('main-title');
      const me = $('nexo-profile-btn'), av = $('nexo-hdr-av'), nm = $('nexo-hdr-name');
      const ids = ['nexo-profile-btn', 'nexo-contacts-search-btn', 'nexo-settings-btn']; // 3222: sin «nuevo grupo» arriba (va en el botón de agregar)
      const fila3 = ['nexo-contacts-search-btn', 'nexo-settings-btn']; // 3218b: «yo» va en la fila de abajo
      const malos = [];
      const out = { W, header: h ? { scroll: h.scrollWidth, client: h.clientWidth, alto: R(h.getBoundingClientRect().height) } : null, botones: {} };
      if (!h) return { malos: ['sin cabecera'] };
      if (h.scrollWidth > h.clientWidth + 0.5) malos.push('cabecera desborda');
      if (document.documentElement.scrollWidth > W + 0.5) malos.push('la página desborda a lo ancho');
      ids.forEach((id) => {
        const el = $(id);
        if (!el) { malos.push(id + ' no está'); return; }
        const b = q(el); out.botones[id] = b;
        if (!this.vis(el)) malos.push(id + ' no se ve');
        if (b.l < -0.5 || b.r > W + 0.5 || b.t < -0.5) malos.push(id + ' fuera');
        if (!this.hit(el)) malos.push(id + ' no recibe el toque');
        const a = this.area(el); out.botones[id].area = a;
        if (!a || a.w < 44 || a.h < 44) malos.push(id + ' área < 44');
      });
      // misma fila, de izquierda a derecha, sin pisarse; la ruedita en la esquina derecha
      let prev = null;
      fila3.forEach((id) => { const b = out.botones[id]; if (!b) return; if (prev && b.l < prev.r - 0.5) malos.push(id + ' pisa al anterior'); prev = b; });
      const fila = fila3.map((id) => out.botones[id]).filter(Boolean).map((b) => (b.t + b.b) / 2);
      if (fila.length === 2 && Math.max(...fila) - Math.min(...fila) > 2) malos.push('los botones no están en la misma fila');
      const gear = out.botones['nexo-settings-btn'];
      if (gear && W - gear.r > 24) malos.push('la ruedita no está en la esquina derecha');
      const mb = out.botones['nexo-profile-btn'];
      if (mb && mb.l > 24) malos.push('«yo» no está a la izquierda');
      // la foto: 36–40 px y redonda
      if (av) {
        const ab = q(av), cs = getComputedStyle(av);
        out.foto = { w: ab.w, h: ab.h, radio: cs.borderTopLeftRadius, texto: av.textContent, foto: !!(cs.backgroundImage && /url\(/.test(cs.backgroundImage)) };
        if (ab.w < 36 || ab.w > 40 || Math.abs(ab.w - ab.h) > 0.5) malos.push('foto de ' + ab.w + '×' + ab.h);
        if (!(cs.borderTopLeftRadius === '50%' || parseFloat(cs.borderTopLeftRadius) >= ab.w / 2 - 0.5)) malos.push('foto no redonda');
        if (me && !me.contains(av)) malos.push('la foto no está dentro de «yo»');
      } else malos.push('sin foto');
      if (nm) {
        out.nombre = { texto: nm.textContent, cortado: nm.scrollWidth > nm.clientWidth + 0.5, q: q(nm) };
        if (me && !me.contains(nm)) malos.push('el nombre no está dentro de «yo»');
        if (out.nombre.cortado && getComputedStyle(nm).textOverflow !== 'ellipsis') malos.push('nombre cortado sin «…»');
      } else malos.push('sin nombre');
      // el título: debajo de la fila, centrado, entero, sin pisar nada
      if (tt) {
        const t = q(tt);
        out.titulo = Object.assign(t, { texto: tt.textContent, entero: tt.scrollWidth <= tt.clientWidth + 0.5, centro: R((t.l + t.r) / 2) });
        if (!out.titulo.entero) malos.push('título cortado');
        if (!this.vis(tt)) malos.push('título no se ve');
        // 3218b (dueño: «invierte el perfil y la palabra Contactos»): el título arriba a la izquierda, en la fila de los botones; «yo» debajo
        if (t.l > 24) malos.push('el título no está a la izquierda (' + t.l + ')');
        const g0 = out.botones['nexo-settings-btn'];
        if (g0 && Math.abs((t.t + t.b) / 2 - (g0.t + g0.b) / 2) > 6) malos.push('el título no está en la fila de los botones');
        if (mb && mb.t < t.b - 6) malos.push('«yo» no está debajo del título');
        ids.forEach((id) => { const b = out.botones[id]; if (b && t.l < b.r && t.r > b.l && t.t < b.b && t.b > b.t) malos.push('el título pisa ' + id); });
      } else malos.push('sin título');
      out.malos = malos;
      return out;
    },
    // estilo de cada botón redondo de la cabecera
    estilo(id) {
      const el = $(id); if (!el) return null;
      const cs = getComputedStyle(el), b = el.getBoundingClientRect(), sv = el.querySelector('svg'), ss = sv && getComputedStyle(sv);
      return { w: R(b.width), h: R(b.height), radio: cs.borderTopLeftRadius, fondo: cs.backgroundColor, borde: cs.borderTopWidth + ' ' + cs.borderTopStyle + ' ' + cs.borderTopColor,
        icono: sv ? { w: R(sv.getBoundingClientRect().width), trazo: ss.stroke, grosor: ss.strokeWidth, relleno: ss.fill, puntas: ss.strokeLinecap } : null };
    },
    sheets() { return { ajustes: !!$('nexo-settings-sheet'), perfil: !!$('nexo-profile-sheet'), juego: !!$('nexo-game-overlay'), lista: this.vis($('contacts-view')), cabecera: this.vis($('main-header')), archivo: document.querySelectorAll('input[type=file]').length }; },
  };
}

const R1 = (x) => Math.round(x);
(async () => {
  const browser = await PW.chromium.launch();
  const now = Date.now();
  const radio = new Radio();
  const opts = { readsContentFallback: true, retain: ['onPayloadReceived'], closeOnNoService: true, pace: [5, 5], ioDelay: 10, asymmetric: true, noTor: true };
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', opts);
  radio.add(nA); nA.load();
  nA.files.set('nexo_vault_contacts.json', JSON.stringify({ contacts: libreta(now), savedAt: now }));
  // sin idioma fijo en el arnés (lo volvería a poner en cada recarga): se pone por localStorage y se recarga, como Ajustes → Idioma
  const phA = await bootPhone(browser, 'A', nA, dist, { phone: true, logs, seedName: 'Ana' });
  const A = phA.page, cdp = phA.cdp;
  const ev = (fn, arg) => A.evaluate(fn, arg);
  const H = async () => { await ev(pageHelpers); await ev(() => { try { localStorage.setItem('nexo_bat_prompt_done', '1'); } catch (e) {} }); };

  // ---------- N0: al arrancar, el nombre FIJO (no el del teléfono) ----------
  r.N0 = await ev(() => ({ app: window.bleInterface && window.bleInterface.localDeviceName, cabecera: (document.getElementById('nexo-hdr-name') || {}).textContent || null }));
  check('N0_nombre_fijo_al_arrancar', r.N0.app === 'Ana' && r.N0.cabecera === 'Ana', JSON.stringify(r.N0));
  await ev(() => localStorage.setItem('nexo_lang', 'es'));
  await A.reload();
  await A.waitForFunction(() => window.NEXO && window.NEXO.initialized, null, { timeout: 60000 });
  await H();

  const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: (type === 'touchEnd' || type === 'touchCancel') ? [] : [{ x, y }] });
  const center = (sel) => ev((s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; }, sel);
  const tap = async (sel) => { const c = await center(sel); if (!c) return false; await touch('touchStart', c.x, c.y); await sleep(60); await touch('touchEnd'); await sleep(450); return true; };
  const back = () => ev(() => (typeof window.__nexoHandleBack === 'function' ? window.__nexoHandleBack() : null));
  const sheets = () => ev(() => window.__cab.sheets());
  const clean = () => ev(() => { ['nexo-bat-overlay', 'nexo-welcome-overlay'].forEach((id) => { const o = document.getElementById(id); if (o) o.remove(); }); });
  const waitFor = async (fn, ms) => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return Date.now() - t0; if (Date.now() - t0 > ms) return null; await sleep(40); } };
  await waitFor(() => ev(() => document.querySelectorAll('#main-contacts-list .ble-contact-row').length >= 6), 15000);
  await sleep(4200); // que pase la pantalla del nombre/bienvenida/batería (a los 4 s del arranque) antes de medir y tocar
  await clean();

  // ---------- G: geometría a 360 px ----------
  const g = await ev(() => window.__cab.header());
  r.G_360 = g;
  check('G_cabecera_360', !!g && Array.isArray(g.malos) && !g.malos.length, JSON.stringify(g && g.malos));
  check('G_muestra_mi_nombre', !!g.nombre && g.nombre.texto === 'Ana' && !g.nombre.cortado, JSON.stringify(g.nombre));
  check('G_inicial_sin_foto', !!g.foto && g.foto.texto === 'A' && !g.foto.foto, JSON.stringify(g.foto));
  check('G_titulo_contactos', !!g.titulo && g.titulo.texto === TXT.es.nav_contactos && g.titulo.entero, JSON.stringify(g.titulo));
  if (shots) { fs.mkdirSync(shots, { recursive: true }); }

  // ---------- E: estilo único (SECUNDARIO) en la lupa, grupo y ruedita ----------
  const est = {};
  for (const id of ['nexo-contacts-search-btn', 'nexo-settings-btn']) est[id] = await ev((x) => window.__cab.estilo(x), id);
  r.E_estilo = est;
  const e0 = est['nexo-settings-btn'];
  const iguales = Object.values(est).every((e) => e && JSON.stringify(e) === JSON.stringify(e0));
  check('E_tres_iguales', iguales, JSON.stringify(est));
  check('E_secundario', !!e0 && e0.w === 44 && e0.h === 44 && e0.radio === '50%' && /rgba\(255, 255, 255, 0\.08\)/.test(e0.fondo) && /^1px solid rgba\(255, 255, 255, 0\.14\)/.test(e0.borde) &&
    !!e0.icono && e0.icono.w === 22 && /rgb\(255, 255, 255\)/.test(e0.icono.trazo) && parseFloat(e0.icono.grosor) === 2 && e0.icono.relleno === 'none' && e0.icono.puntas === 'round', JSON.stringify(e0));

  // ---------- T: responden al dedo (press.js) ----------
  const pressOf = async (sel) => {
    const c = await center(sel);
    if (!c) return null;
    await touch('touchStart', c.x, c.y);
    await sleep(140);
    const st = await ev((s) => { const b = document.querySelector(s); const sc = (el) => { const v = getComputedStyle(el).scale; return v === 'none' ? 1 : parseFloat(v); }; return { pressable: b.classList.contains('nx-pressable'), pressed: b.classList.contains('is-pressed'), onda: !!b.querySelector('.nx-ripple'), escala: sc(b) }; }, sel);
    await touch('touchCancel');
    await sleep(400);
    return st;
  };
  r.T_ruedita = await pressOf('#nexo-settings-btn');
  r.T_yo = await pressOf('#nexo-profile-btn');
  const okPress = (p) => !!p && p.pressable && p.pressed && p.onda && p.escala < 1;
  check('T_responden_al_dedo', okPress(r.T_ruedita) && okPress(r.T_yo), JSON.stringify([r.T_ruedita, r.T_yo]));
  r.T_aria = await ev(() => { const g = document.getElementById('nexo-settings-btn'), m = document.getElementById('nexo-profile-btn'); return { ruedita: g && g.getAttribute('aria-label'), yo: m && m.getAttribute('aria-label') }; });
  check('T_etiquetas', r.T_aria.ruedita === TXT.es.settings_title && r.T_aria.yo === TXT.es.hdr_my_profile + ': Ana', JSON.stringify(r.T_aria));
  if (shots) await A.screenshot({ path: path.join(shots, 'cabecera_es.png') });

  // ---------- S: la ruedita abre Ajustes; atrás vuelve a la lista ----------
  await tap('#nexo-settings-btn');
  await sleep(300);
  const s1 = await sheets();
  r.S_abre = Object.assign({ titulo: await ev(() => (document.getElementById('nexo-settings-title') || {}).textContent || null), secciones: await ev(() => document.querySelectorAll('#nexo-settings-sheet .nx-set-row').length) }, s1);
  check('S_ruedita_abre_ajustes', s1.ajustes && !s1.perfil && r.S_abre.titulo === TXT.es.settings_title && r.S_abre.secciones >= 5, JSON.stringify(r.S_abre));
  if (shots) await A.screenshot({ path: path.join(shots, 'ajustes_desde_ruedita_es.png') });
  // una sección y atrás → la lista de Ajustes; otro atrás → Contactos (no Perfil)
  await tap('#nexo-settings-sheet .nx-set-row[data-sec="app"]');
  const enSec = await ev(() => { const s = document.getElementById('nexo-settings-sheet'); return !!s && s.classList.contains('nx-in-sec'); });
  const b1 = await back(); await sleep(250);
  const trasSec = await ev(() => { const s = document.getElementById('nexo-settings-sheet'); return { abierta: !!s, enSeccion: !!s && s.classList.contains('nx-in-sec') }; });
  const b2 = await back(); await sleep(400);
  const s2 = await sheets();
  r.S_atras = { enSec, b1, trasSec, b2, despues: s2 };
  check('S_atras_seccion_a_lista_de_ajustes', enSec && b1 === true && trasSec.abierta && !trasSec.enSeccion, JSON.stringify(r.S_atras));
  check('S_atras_vuelve_a_la_lista', b2 === true && !s2.ajustes && !s2.perfil && s2.lista && s2.cabecera, JSON.stringify(s2));
  // el botón «atrás» de Ajustes (en la lista lo oculta la regla «atrás solo por gestos», pero su acción es la misma)
  await tap('#nexo-settings-btn');
  const bb = await ev(() => { const b = document.getElementById('nexo-settings-back'); if (!b) return null; b.click(); return true; });
  await sleep(400);
  const s3 = await sheets();
  check('S_boton_atras_vuelve_a_la_lista', bb === true && !s3.ajustes && !s3.perfil && s3.lista, JSON.stringify(s3));
  r.S_nada_mas = await back();
  check('S_atras_final_false', r.S_nada_mas === false, String(r.S_nada_mas));

  // ---------- P: tocar foto/nombre abre MI Perfil, y nada más ----------
  const idA = await ev(() => String(window.bleInterface.localNexoId || '').toUpperCase());
  await tap('#nexo-hdr-name');
  await sleep(300);
  const p1 = await sheets();
  r.P_perfil = Object.assign({ id: await ev(() => (document.getElementById('nexo-profile-id') || {}).textContent || null), teVen: await ev(() => (document.getElementById('nexo-profile-seen') || {}).textContent || '') }, p1);
  check('P_nombre_abre_perfil', p1.perfil && !p1.ajustes && !p1.juego && p1.archivo === 0 && r.P_perfil.id === idA && /Ana/.test(r.P_perfil.teVen), JSON.stringify(r.P_perfil));
  await back(); await sleep(300);
  await tap('#nexo-hdr-av');
  await sleep(300);
  const p2 = await sheets();
  check('P_foto_abre_perfil', p2.perfil && !p2.ajustes && !p2.juego && p2.archivo === 0, JSON.stringify(p2));
  if (shots) await A.screenshot({ path: path.join(shots, 'perfil_desde_foto_es.png') });
  // el atajo de Ajustes dentro de Perfil sigue; desde ahí, atrás vuelve a Perfil (gesto y botón)
  await tap('#nexo-open-settings');
  const p3 = await sheets();
  const pb = await back(); await sleep(400);
  const p4 = await sheets();
  check('P_atajo_ajustes_vuelve_a_perfil', p3.ajustes && !p3.perfil && pb === true && p4.perfil && !p4.ajustes, JSON.stringify([p3, p4]));
  await tap('#nexo-open-settings');
  await ev(() => { const b = document.getElementById('nexo-settings-back'); if (b) b.click(); });
  await sleep(400);
  const p5 = await sheets();
  check('P_atajo_boton_atras_vuelve_a_perfil', p5.perfil && !p5.ajustes, JSON.stringify(p5));

  // ---------- F: cambiar mi foto → la cabecera al momento ----------
  await tap('#nexo-av-pick');
  const puesta = await ev(async () => {
    const inp = Array.from(document.querySelectorAll('input[type=file]')).find((i) => i.accept === 'image/*');
    if (!inp) return 'sin selector';
    const c = document.createElement('canvas'); c.width = 320; c.height = 320; const g = c.getContext('2d');
    const gr = g.createLinearGradient(0, 0, 320, 320); gr.addColorStop(0, '#ff7a18'); gr.addColorStop(1, '#2bd2ff'); g.fillStyle = gr; g.fillRect(0, 0, 320, 320);
    g.fillStyle = '#fff'; g.beginPath(); g.arc(160, 130, 60, 0, 7); g.fill(); g.fillRect(70, 210, 180, 110);
    const blob = await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.9));
    const dt = new DataTransfer(); dt.items.add(new File([blob], 'yo.jpg', { type: 'image/jpeg' }));
    inp.files = dt.files; inp.dispatchEvent(new Event('change'));
    return 'ok';
  });
  // 28-11: la foto se ajusta antes de usarla (avatar_crop.js): se acepta como viene
  await waitFor(() => ev(() => !!document.querySelector('#nexo-avatar-crop .nexo-av-use')), 4000);
  // 27-11: el ajuste se VE encima de la hoja de Perfil (antes quedaba debajo: pantallas encimadas)
  r.F_ajuste_encima = await ev(() => { const b = document.querySelector('#nexo-avatar-crop .nexo-av-use'); if (!b) return 'sin ajuste'; const q = b.getBoundingClientRect(); const top = document.elementFromPoint(q.left + q.width / 2, q.top + q.height / 2); return top === b || b.contains(top); });
  check('F_ajuste_de_la_foto_encima_de_perfil', r.F_ajuste_encima === true, String(r.F_ajuste_encima));
  await ev(() => { const b = document.querySelector('#nexo-avatar-crop .nexo-av-use'); if (b) b.click(); });
  const tFoto = await waitFor(() => ev(() => { const a = document.getElementById('nexo-hdr-av'); return !!a && /url\(["']?data:image/.test(a.style.backgroundImage || '') && a.classList.contains('nx-has-photo'); }), 6000);
  r.F_foto = { puesta, ms: tFoto };
  check('F_foto_nueva_en_cabecera', puesta === 'ok' && tFoto !== null, JSON.stringify(r.F_foto));
  await ev(() => { const s = document.getElementById('nexo-profile-sheet'); if (s) s.remove(); });
  await sleep(300);
  if (shots) await A.screenshot({ path: path.join(shots, 'cabecera_con_foto_es.png'), clip: { x: 0, y: 0, width: 360, height: 130 } });
  await tap('#nexo-profile-btn');
  await ev(() => { const b = document.getElementById('nexo-av-clear'); if (b) b.click(); });
  const tQuita = await waitFor(() => ev(() => { const a = document.getElementById('nexo-hdr-av'); return !!a && !a.style.backgroundImage && !a.classList.contains('nx-has-photo') && a.textContent === 'A'; }), 3000);
  check('F_quitar_vuelve_la_inicial', tQuita !== null, String(tQuita));
  await back(); await sleep(300);

  // ---------- I: 5 idiomas a 360 px ----------
  r.I = {};
  for (const l of LANGS) {
    await ev((x) => localStorage.setItem('nexo_lang', x), l);
    await A.reload();
    await A.waitForFunction(() => window.NEXO && window.NEXO.initialized, null, { timeout: 60000 });
    await H();
    await waitFor(() => ev(() => document.querySelectorAll('#main-contacts-list .ble-contact-row').length >= 6), 15000);
    await sleep(600);
    await clean();
    const c = await ev(() => window.__cab.header());
    const aria = await ev(() => { const gg = document.getElementById('nexo-settings-btn'), m = document.getElementById('nexo-profile-btn'); return { ruedita: gg && gg.getAttribute('aria-label'), yo: m && m.getAttribute('aria-label') }; });
    const t = TXT[l];
    r.I[l] = { titulo: c.titulo && c.titulo.texto, entero: c.titulo && c.titulo.entero, centro: c.titulo && c.titulo.centro, malos: c.malos, aria,
      ok: !!c.titulo && c.titulo.texto === t.nav_contactos && !c.malos.length && aria.ruedita === t.settings_title && aria.yo === t.hdr_my_profile + ': Ana' };
    for (const w of [320]) {
      await A.setViewportSize({ width: w, height: 780 }); await sleep(350);
      r.I[l]['malos_' + w] = (await ev(() => window.__cab.header())).malos;
      await A.setViewportSize({ width: 360, height: 780 }); await sleep(350);
    }
    if (shots) await A.screenshot({ path: path.join(shots, 'cabecera_' + l + '.png') });
  }
  check('I_5_idiomas_360', LANGS.every((l) => r.I[l].ok), JSON.stringify(LANGS.filter((l) => !r.I[l].ok).map((l) => [l, r.I[l]])));
  r.I_320_sin_problemas = LANGS.filter((l) => !r.I[l].malos_320.length);
  await A.close();

  // ---------- M: el nombre elegido por primera vez → la cabecera cambia al momento; uno largo, con «…» ----------
  const nB = new NativePhone('B', 'BB:BB:BB:BB:BB:02', opts);
  radio.add(nB); nB.load();
  const phB = await bootPhone(browser, 'B', nB, dist, { phone: true, logs, lang: 'es' });
  const B = phB.page;
  await B.evaluate(pageHelpers);
  const antes = await B.evaluate(() => (document.getElementById('nexo-hdr-name') || {}).textContent || null);
  const gate = await (async () => { for (let i = 0; i < 80; i++) { if (await B.evaluate(() => !!document.getElementById('nexo-name-input'))) return true; await sleep(100); } return false; })();
  const LARGO = 'Maximiliano Alejandro de la Fuente';
  await B.evaluate((n) => { const i = document.getElementById('nexo-name-input'); if (!i) return; i.value = n; i.dispatchEvent(new Event('input', { bubbles: true })); }, LARGO);
  await B.evaluate(() => { const b = document.getElementById('nexo-name-ok'); if (b) b.click(); });
  let tNombre = null;
  { const t0 = Date.now(); for (;;) { if (await B.evaluate((n) => (document.getElementById('nexo-hdr-name') || {}).textContent === n, LARGO)) { tNombre = Date.now() - t0; break; } if (Date.now() - t0 > 3000) break; await sleep(30); } }
  await B.evaluate(() => { ['nexo-bat-overlay', 'nexo-welcome-overlay'].forEach((id) => { const o = document.getElementById(id); if (o) o.remove(); }); });
  await sleep(300);
  const mB = await B.evaluate(() => window.__cab.header());
  r.M = { antes, pantalla_nombre: gate, ms: tNombre, nombre: mB.nombre, malos: mB.malos, aria: await B.evaluate(() => document.getElementById('nexo-profile-btn').getAttribute('aria-label')) };
  check('M_nombre_nuevo_al_momento', gate && tNombre !== null && tNombre < 1000, JSON.stringify(r.M));
  // 3218b: con «yo» en su propia fila el nombre largo suele caber entero; si no cabe, «…» (lo mira mB.malos: «nombre cortado sin «…»»)
  check('M_nombre_largo_con_puntos', !!mB.nombre && mB.nombre.texto === LARGO && !mB.malos.length && r.M.aria === TXT.es.hdr_my_profile + ': ' + LARGO, JSON.stringify(r.M));
  if (shots) await B.screenshot({ path: path.join(shots, 'cabecera_nombre_largo_es.png'), clip: { x: 0, y: 0, width: 360, height: 130 } });

  await browser.close();
  fin(true);
  process.exit(r.resultado === 'OK' ? 0 : 1);
})().catch((e) => { fallos.push('excepción: ' + String(e && e.message || e).substring(0, 300)); r.error = String(e && e.stack || e).substring(0, 600); fin(false); process.exit(1); });
