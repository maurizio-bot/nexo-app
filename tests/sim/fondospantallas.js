// Fondos de TODAS las pantallas (COLA 30, dueño 21-11): «todos los fondos se cambian igual que el de un chat».
// Pulsación larga (~0,8 s; aquí 150 ms con NEXO_WP_LONGPRESS_MS) sobre un espacio LIBRE de la lista de chats, la llamada, Perfil
// o Ajustes abre el MISMO menú del fondo (elegir foto / quitar). Un archivo por pantalla (lista: nexo_wp_list.json; el resto:
// nexo_wp_s_<pantalla>.json). Booteando la app de verdad en jsdom (un teléfono, sin red). La pantalla de llamada se simula con
// el mismo HTML que crea calls_ui._screen (para no montar una llamada entera: eso lo cubren calls*.js).
//  (1) sobre fondo vacío abre el menú, en cada pantalla      (2) sobre fila / botón / tarjeta / avatar / tira de estados NO
//  (3) con movimiento del dedo NO, ni si se suelta antes     (4) elegir foto la pinta SOLO en esa pantalla y la guarda en SU archivo
//  (5) tras reiniciar la app sigue puesta                    (6) «quitar» la quita (pantalla y archivo)
//  (7) el fondo del chat de siempre sigue igual (gesto en #messages-container, nexo_wp_c_<id>.json)
// Uso: node fondospantallas.js <dir_build>
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone } = require('./native_mock');

const buildDir = path.resolve(process.argv[2]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
class DL extends ResourceLoader { constructor(d) { super(); this.d = d; } fetch(u) { const f = path.join(this.d, decodeURIComponent(new URL(u).pathname)); return fs.existsSync(f) ? Promise.resolve(fs.readFileSync(f)) : Promise.reject(new Error('x')); } }
const logs = [];
let picN = 0;
async function boot(name, native) {
  const vc = new VirtualConsole();
  ['log', 'warn', 'error'].forEach((l) => vc.on(l, (...a) => logs.push(`[${name}] ${l}: ` + a.map(String).join(' ').substring(0, 200))));
  const dom = new JSDOM(fs.readFileSync(path.join(buildDir, 'dist', 'index.html'), 'utf8'), {
    url: 'https://' + name.toLowerCase() + '.nexo.test/index.html', runScripts: 'dangerously', resources: new DL(path.join(buildDir, 'dist')), pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) {
      win.CapacitorCustomPlatform = { name: 'android' }; require('./native_mock').installWebCrypto(win); win.Capacitor = { Plugins: { NexoBLE: native.plugin() } };
      win.HTMLElement.prototype.scrollTo = function () {};
      win.NEXO_WP_LONGPRESS_MS = 150;
      win.NEXO_makeWallpaper = () => 'data:image/jpeg;base64,PIC' + (++picN) + 'aaaa=';   // sin canvas en jsdom
    },
  });
  const win = dom.window;
  // El selector de archivos: «elige» una foto al instante
  win.HTMLInputElement.prototype.click = function () {
    if (this.type !== 'file') return;
    const self = this;
    Object.defineProperty(self, 'files', { value: [new win.File(['x'], 'a.jpg', { type: 'image/jpeg' })], configurable: true });
    setTimeout(() => { if (typeof self.onchange === 'function') self.onchange(); }, 5);
  };
  for (let i = 0; i < 100 && !(win.NEXO && win.NEXO.initialized); i++) await sleep(100);
  await sleep(800);
  return { name, native, win };
}
// hash idéntico al de wallpaper.js (el atributo data-nexo-wp)
const H = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h.toString(36); };

// Mantiene pulsado `el` (ratón; el mismo detector atiende el táctil). opts.moveTo: mueve el dedo; opts.releaseEarly: suelta antes
async function hold(win, el, opts) {
  opts = opts || {};
  const ev = (type, x, y) => el.dispatchEvent(new win.MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 }));
  ev('mousedown', 50, 50);
  if (opts.releaseEarly) { await sleep(40); ev('mouseup', 50, 50); await sleep(250); return; }
  await sleep(40);
  if (opts.moveTo) ev('mousemove', 50 + opts.moveTo, 50 + opts.moveTo);
  await sleep(300);
  ev('mouseup', 50, 50);
  await sleep(30);
}
// Lo mismo con eventos táctiles reales (touchstart/touchmove/touchend), como en el teléfono
async function holdTouch(win, el, opts) {
  opts = opts || {};
  const mk = (type, x, y) => { const e = new win.Event(type, { bubbles: true, cancelable: true }); e.touches = type === 'touchend' ? [] : [{ clientX: x, clientY: y }]; return e; };
  el.dispatchEvent(mk('touchstart', 60, 60));
  await sleep(40);
  if (opts.moveTo) el.dispatchEvent(mk('touchmove', 60 + opts.moveTo, 60 + opts.moveTo));
  await sleep(300);
  el.dispatchEvent(mk('touchend', 60, 60));
  await sleep(30);
}
const sheetOpen = (w) => !!w.document.getElementById('nexo-wp-sheet');
const closeSheet = (w) => { const s = w.document.getElementById('nexo-wp-sheet'); if (s) s.remove(); };
const wpOf = (el) => (el && el.getAttribute('data-nexo-wp')) || '';

(async () => {
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', { wifi: 'casa', ioDelay: 5 });
  radio.add(nA); nA.load();
  const A = await boot('A', nA);
  let w = A.win, d = w.document;
  const r = { build: path.basename(buildDir) };
  const fileImg = (f) => { try { return JSON.parse(nA.files.get(f) || '{}').img || ''; } catch (e) { return ''; } };

  // ---- Pantallas simuladas / abiertas de verdad ----
  const list = d.getElementById('main-contacts-list');
  const view = d.getElementById('contacts-view');
  const row = d.createElement('div'); row.className = 'ble-contact-row'; row.innerHTML = '<div class="ble-contact-avatar">AB</div><div class="ble-contact-info"><div class="ble-contact-name">Ana</div></div>';
  list.appendChild(row);
  const strip = d.getElementById('main-contacts-online-strip');
  const stripItem = d.createElement('div'); stripItem.className = 'ble-online-item'; strip.appendChild(stripItem);

  // (1)(2)(3) LISTA
  await hold(w, view);              r.lista_vacio_abre = sheetOpen(w); closeSheet(w);
  await hold(w, list);              r.lista_vacio2_abre = sheetOpen(w); closeSheet(w);
  await hold(w, row);               r.lista_fila_no = !sheetOpen(w);
  await hold(w, row.querySelector('.ble-contact-avatar')); r.lista_avatar_no = !sheetOpen(w);
  await hold(w, stripItem);         r.lista_tira_no = !sheetOpen(w);
  await hold(w, strip);             r.lista_tira_fondo_no = !sheetOpen(w);
  await hold(w, d.getElementById('main-header')); r.lista_cabecera_no = !sheetOpen(w);
  await hold(w, view, { moveTo: 40 }); r.lista_mueve_no = !sheetOpen(w);
  await hold(w, view, { releaseEarly: true }); r.lista_suelta_antes_no = !sheetOpen(w);
  await holdTouch(w, view);         r.lista_tactil_abre = sheetOpen(w); closeSheet(w);
  await holdTouch(w, view, { moveTo: 40 }); r.lista_tactil_mueve_no = !sheetOpen(w);
  // desplazamiento: un scroll en medio de la pulsación la cancela
  { const el = view; el.dispatchEvent(new w.MouseEvent('mousedown', { bubbles: true, clientX: 5, clientY: 5, button: 0 })); await sleep(40);
    list.dispatchEvent(new w.Event('scroll')); await sleep(300); el.dispatchEvent(new w.MouseEvent('mouseup', { bubbles: true })); r.lista_scroll_no = !sheetOpen(w); }

  // PERFIL y AJUSTES (las hojas reales)
  d.getElementById('nexo-profile-btn').click(); await sleep(200);
  const prof = d.getElementById('nexo-profile-sheet');
  r.perfil_abierto = !!prof;
  await hold(w, prof.querySelector('.nx-profile-in')); r.perfil_vacio_abre = sheetOpen(w); closeSheet(w);
  await hold(w, prof.querySelector('#nexo-gesture-zone')); r.perfil_zona_abre = sheetOpen(w); closeSheet(w);
  await hold(w, prof.querySelector('.nx-card')); r.perfil_tarjeta_no = !sheetOpen(w);
  await hold(w, prof.querySelector('#nexo-profile-av')); r.perfil_avatar_no = !sheetOpen(w);
  await hold(w, prof.querySelector('#nexo-profile-close')); r.perfil_boton_no = !sheetOpen(w);
  await hold(w, prof.querySelector('input')); r.perfil_campo_no = !sheetOpen(w);
  await hold(w, prof.querySelector('.nx-profile-in'), { moveTo: 40 }); r.perfil_mueve_no = !sheetOpen(w);
  prof.remove();

  d.getElementById('nexo-settings-btn').click(); await sleep(200);
  const sett = d.getElementById('nexo-settings-sheet');
  r.ajustes_abierto = !!sett;
  await hold(w, sett.querySelector('.nx-profile-in')); r.ajustes_vacio_abre = sheetOpen(w); closeSheet(w);
  await hold(w, sett.querySelector('.nx-set-row') || sett.querySelector('.nx-card') || sett.querySelector('button')); r.ajustes_fila_no = !sheetOpen(w);
  await hold(w, sett.querySelector('.nx-profile-in'), { moveTo: 40 }); r.ajustes_mueve_no = !sheetOpen(w);
  sett.remove();

  // LLAMADA (mismo HTML que calls_ui._screen)
  const mkCall = () => {
    const el = d.createElement('div'); el.id = 'nexo-call-screen'; el.className = 'nc-live';
    el.innerHTML = '<div class="nc-bg"></div><div class="nc-top"><div class="nc-pill nc-lock"><span>Cifrada</span></div><div class="nc-mini"></div><div class="nc-warnbar"></div></div>' +
      '<div class="nc-center"><div class="nc-av-wrap"><div class="nc-av"></div></div><div class="call-name">Ana</div><div class="call-status">0:05</div><div class="call-note"></div></div>' +
      '<div class="nc-bottom"><div class="call-buttons"><button class="nc-btn call-hangup">Colgar</button></div></div><button class="nc-min">v</button>';
    let toggles = 0; el.addEventListener('click', () => { toggles++; el._toggles = toggles; });
    d.body.appendChild(el); return el;
  };
  let call = mkCall();
  await hold(w, call.querySelector('.nc-bg')); r.llamada_vacio_abre = sheetOpen(w); closeSheet(w);
  await hold(w, call); r.llamada_raiz_abre = sheetOpen(w); closeSheet(w);
  await hold(w, call.querySelector('.nc-btn')); r.llamada_boton_no = !sheetOpen(w);
  await hold(w, call.querySelector('.nc-av-wrap')); r.llamada_avatar_no = !sheetOpen(w);
  await hold(w, call.querySelector('.call-name')); r.llamada_nombre_no = !sheetOpen(w);
  await hold(w, call, { moveTo: 40 }); r.llamada_mueve_no = !sheetOpen(w);
  // el menú sobre la llamada no deja pasar el «toque» que mostraría/ocultaría los controles
  call._toggles = 0; await hold(w, call); const ab = sheetOpen(w); closeSheet(w); r.llamada_no_alterna_controles = ab && !call._toggles;
  call.classList.add('nc-appmini'); await hold(w, call); r.llamada_mini_no = !sheetOpen(w); call.classList.remove('nc-appmini');

  // ---- (4) ELEGIR en cada pantalla: se pinta SOLO ahí y se guarda en SU archivo ----
  const choose = async (target) => { await hold(w, target); const ok = sheetOpen(w); const b = d.getElementById('nexo-wp-pick'); if (b) b.onclick(); await sleep(150); return ok; };
  r.elige_lista_menu = await choose(view);
  const imgList = fileImg('nexo_wp_list.json');
  r.lista_guardada = /^data:image\/jpeg;base64,PIC\d+aaaa=$/.test(imgList) && w.wallpaperApplied() === imgList && wpOf(d.getElementById('app')) === H(imgList);

  r.elige_llamada_menu = await choose(call.querySelector('.nc-bg'));
  const imgCall = fileImg('nexo_wp_s_call.json');
  r.llamada_guardada = !!imgCall && wpOf(call.querySelector('.nc-bg')) === H(imgCall);

  d.getElementById('nexo-profile-btn').click(); await sleep(200);
  r.elige_perfil_menu = await choose(d.querySelector('#nexo-profile-sheet .nx-profile-in'));
  const imgProf = fileImg('nexo_wp_s_profile.json');
  r.perfil_guardado = !!imgProf && wpOf(d.getElementById('nexo-profile-sheet')) === H(imgProf);
  d.getElementById('nexo-profile-sheet').remove();

  d.getElementById('nexo-settings-btn').click(); await sleep(200);
  r.elige_ajustes_menu = await choose(d.querySelector('#nexo-settings-sheet .nx-profile-in'));
  const imgSet = fileImg('nexo_wp_s_settings.json');
  r.ajustes_guardado = !!imgSet && wpOf(d.getElementById('nexo-settings-sheet')) === H(imgSet);
  r.ajustes_no_pinta_perfil = wpOf(d.getElementById('nexo-settings-sheet')) !== H(imgProf);
  d.getElementById('nexo-settings-sheet').remove();

  // Independientes: cuatro fotos distintas, y cada pantalla nueva abre con la suya
  r.cuatro_distintas = new Set([imgList, imgCall, imgProf, imgSet]).size === 4;
  d.getElementById('nexo-profile-btn').click(); await sleep(150);
  r.perfil_nuevo_con_suyo = wpOf(d.getElementById('nexo-profile-sheet')) === H(imgProf) && wpOf(d.getElementById('nexo-call-screen').querySelector('.nc-bg')) === H(imgCall);
  d.getElementById('nexo-profile-sheet').remove();

  // ---- (7) el del chat de siempre ----
  w.dispatchEvent(new w.CustomEvent('nexo:ble:openChat', { detail: { contactId: 'nxtest0001' } })); await sleep(60);
  d.body.classList.add('chat-view-active');
  const mc = d.getElementById('messages-container');
  await hold(w, mc); r.chat_abre = sheetOpen(w);
  r.chat_menu_es_el_suyo = !!d.getElementById('nexo-wp-share') || /este chat/i.test((d.getElementById('nexo-wp-sheet') || { textContent: '' }).textContent);
  closeSheet(w);
  await hold(w, view); r.chat_lista_no_abre_en_chat = !sheetOpen(w);   // dentro de un chat el detector de la lista no actúa
  d.body.classList.remove('chat-view-active');
  w.dispatchEvent(new w.CustomEvent('nexo:ble:closeChat', {})); await sleep(60);

  // ---- (5) REINICIO: otra ventana con los mismos archivos ----
  w.close();
  const B = await boot('A2', nA); w = B.win; d = w.document;
  for (let i = 0; i < 40 && w.wallpaperApplied() !== imgList; i++) await sleep(50);
  r.reinicio_lista = w.wallpaperApplied() === imgList && wpOf(d.getElementById('app')) === H(imgList);
  d.getElementById('nexo-profile-btn').click(); await sleep(250);
  r.reinicio_perfil = wpOf(d.getElementById('nexo-profile-sheet')) === H(imgProf);
  d.getElementById('nexo-profile-sheet').remove();
  d.getElementById('nexo-settings-btn').click(); await sleep(250);
  r.reinicio_ajustes = wpOf(d.getElementById('nexo-settings-sheet')) === H(imgSet);
  d.getElementById('nexo-settings-sheet').remove();
  { const el = d.createElement('div'); el.id = 'nexo-call-screen'; el.innerHTML = '<div class="nc-bg"></div><div class="nc-center"></div>'; d.body.appendChild(el); await sleep(60);
    r.reinicio_llamada = wpOf(el.querySelector('.nc-bg')) === H(imgCall); call = el; }

  // ---- (6) QUITAR ----
  const remove = async (target) => { await hold(w, target); const rm = d.getElementById('nexo-wp-remove'); const had = !!rm; if (rm) rm.onclick(); await sleep(150); return had; };
  r.quita_menu_ofrece_lista = await remove(d.getElementById('contacts-view'));
  r.quita_lista = fileImg('nexo_wp_list.json') === '' && w.wallpaperApplied() === '' && wpOf(d.getElementById('app')) === '';
  r.quita_menu_ofrece_llamada = await remove(call.querySelector('.nc-bg'));
  r.quita_llamada = fileImg('nexo_wp_s_call.json') === '' && wpOf(call.querySelector('.nc-bg')) === '';
  d.getElementById('nexo-profile-btn').click(); await sleep(200);
  r.quita_menu_ofrece_perfil = await remove(d.querySelector('#nexo-profile-sheet .nx-profile-in'));
  r.quita_perfil = fileImg('nexo_wp_s_profile.json') === '' && wpOf(d.getElementById('nexo-profile-sheet')) === '';
  d.getElementById('nexo-profile-sheet').remove();
  d.getElementById('nexo-settings-btn').click(); await sleep(200);
  r.quita_menu_ofrece_ajustes = await remove(d.querySelector('#nexo-settings-sheet .nx-profile-in'));
  r.quita_ajustes = fileImg('nexo_wp_s_settings.json') === '' && wpOf(d.getElementById('nexo-settings-sheet')) === '';
  d.getElementById('nexo-settings-sheet').remove();
  // quitada la de la lista, el menú vuelve a ofrecer «Elegir» (sin «Quitar»)
  await hold(w, d.getElementById('contacts-view')); r.sin_foto_sin_quitar = sheetOpen(w) && !d.getElementById('nexo-wp-remove'); closeSheet(w);

  r.errores = logs.filter((l) => / error: /.test(l) && !/JSDOMERROR|styles\.css|Not implemented|Could not load/.test(l)).slice(0, 5);
  const bad = Object.keys(r).filter((k) => r[k] === false);
  const ok = !bad.length && !r.errores.length;
  r.fallan = bad;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('FONDOSPANTALLAS ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_fondospantallas.txt'), logs.join('\n'));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error(e); fs.writeFileSync(path.join(__dirname, 'last_logs_fondospantallas.txt'), logs.join('\n')); process.exit(1); });
