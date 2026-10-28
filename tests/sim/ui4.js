// Revisión completa, parte 4 (interfaz), ronda 2771: pantalla "Agregar contactos" y textos de la lista.
//  - Con contactos, "Agregar" decía "No hay contactos. Presiona Buscar para encontrar dispositivos." (las secciones
//    "En línea ahora" y "Recientes" no se rellenaban nunca): deben salir tus contactos.
//  - El buscador ("Buscar contacto…") era un dibujo: debe filtrar tus contactos y los teléfonos encontrados (por nombre
//    o NEXO ID) y decir si nadie coincide.
//  - Textos: "En linea" (sin tilde), "Offline" (en inglés), "BLE ON | N conectados" (jerga), "Activalo", y sin contactos
//    "Presiona el botón +" (el botón es una burbuja, no un +).
//  - El botón redondo con teléfonos nuevos cerca cambiaba su icono por un número suelto: icono y número en una burbuja.
//  - Perfil: el círculo mostraba la primera cifra del NEXO ID ("0"): iniciales del nombre del teléfono y cómo te ven.
//  - Menú ⋮ de un contacto: "Cambiar nombre" (el nombre del chat se podía cambiar tocándolo, pero nada lo decía); el
//    nombre puesto se queda aunque el otro vuelva a conectar.
//  - Avisos rotos: "Permiso de Microfono no encontrado denegado." (nota de voz sin micrófono), "Permiso de Demasiado
//    grande… denegado"; textos sin tilde (Ubicacion, Microfono, Configuracion, "continuara automaticamente").
// Tres teléfonos: Vivo (A) agrega al Galaxy (B); la Tablet (C) está cerca sin agregar.
// Uso: node ui4.js <dir_build>
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone } = require('./native_mock');
const buildDir = path.resolve(process.argv[2]);
const opts = { readsContentFallback: true, retain: ['onPayloadReceived'], closeOnNoService: true, pace: [15, 15], ioDelay: 25, asymmetric: true };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
class DL extends ResourceLoader { constructor(d) { super(); this.d = d; } fetch(u) { const f = path.join(this.d, decodeURIComponent(new URL(u).pathname)); return fs.existsSync(f) ? Promise.resolve(fs.readFileSync(f)) : Promise.reject(new Error('x')); } }
const logs = [];
async function boot(name, native) {
  const vc = new VirtualConsole(); ['log', 'warn', 'error'].forEach((l) => vc.on(l, (...a) => logs.push(`${new Date().toISOString().substring(14, 23)} [${name}] ${l}: ` + a.map(String).join(' ').substring(0, 250))));
  const dom = new JSDOM(fs.readFileSync(path.join(buildDir, 'dist', 'index.html'), 'utf8'), { url: 'https://' + name.toLowerCase() + '.nexo.test/index.html', runScripts: 'dangerously', resources: new DL(path.join(buildDir, 'dist')), pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) { win.__gumErr = 'NotFoundError'; win.navigator.mediaDevices = { getUserMedia: () => Promise.reject(Object.assign(new Error('x'), { name: win.__gumErr })) }; win.CapacitorCustomPlatform = { name: 'android' }; require('./native_mock').installWebCrypto(win); win.Capacitor = { Plugins: { NexoBLE: native.plugin() } }; win.HTMLElement.prototype.scrollTo = function () {}; } });
  const win = dom.window; for (let i = 0; i < 100 && !(win.NEXO && win.NEXO.initialized); i++) await sleep(100); await sleep(800);
  return { name, native, win };
}
const click = (w, el) => el && el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
const $ = (p, sel) => p.win.document.querySelector(sel);
const txt = (p, sel) => (($(p, sel) || {}).textContent || '').trim();
const visible = (el) => !!el && el.style.display !== 'none' && !el.hidden;
// Teléfonos encontrados (barra de abajo de "Agregar"): los que se ven
const found = (p) => Array.from(p.win.document.querySelectorAll('#ble-new-device > div')).filter(visible).map((d) => d.textContent.replace('+', '').trim());
const panelRows = (p) => Array.from(p.win.document.querySelectorAll('#ble-contacts-list .ble-contact-row')).filter(visible).map((d) => d.textContent);
const search = (p, q) => { const i = $(p, '#ble-search-input'); if (!i) return false; i.value = q; i.dispatchEvent(new p.win.Event('input', { bubbles: true })); return true; };
const wait = async (c, s) => { for (let i = 0; i < s * 5; i++) { if (await c()) return true; await sleep(200); } return !!(await c()); };
async function scanUntil(p, cond, s) { for (let i = 0; i < s * 10; i++) { await sleep(100); if (cond()) return true; if (!p.win.bleInterface.isScanning) click(p.win, $(p, '#ble-scan-btn')); } return cond(); }

(async () => {
  const radio = new Radio();
  const nA = new NativePhone('Vivo Y21', 'AA:AA:AA:AA:AA:01', opts), nB = new NativePhone('Galaxy S24', 'BB:BB:BB:BB:BB:02', opts), nC = new NativePhone('Tablet Lenovo', 'CC:CC:CC:CC:CC:03', opts);
  [nA, nB, nC].forEach((n) => { radio.add(n); n.load(); });
  const [A, B, C] = await Promise.all([boot('A', nA), boot('B', nB), boot('C', nC)]);
  const r = {};
  // B y C abren "Agregar" (se anuncian); A los busca y agrega solo a B
  B.win.bleInterface.togglePanel(); C.win.bleInterface.togglePanel();
  A.win.bleInterface.togglePanel();
  r.encontrados = await scanUntil(A, () => found(A).some((t) => /Galaxy/.test(t)) && found(A).some((t) => /Tablet/.test(t)), 60) ? found(A) : found(A);
  const rowB = Array.from(A.win.document.querySelectorAll('#ble-new-device > div')).find((d) => /Galaxy/.test(d.textContent));
  click(A.win, rowB && rowB.querySelector('button'));
  r.agregado = await wait(() => Array.from(A.win.document.querySelectorAll('#main-contacts-list .ble-contact-name')).some((e) => /Galaxy/.test(e.textContent)), 20);
  await sleep(1500);
  // Lista principal: el subtítulo de un contacto sin mensajes, en español y con tilde
  r.subtitulo = txt(A, '#main-contacts-list .ble-contact-row .ble-contact-msg');
  // "Agregar" otra vez (cerrar y abrir); antes, el botón redondo con los teléfonos nuevos encontrados
  if ($(A, '#ble-panel').classList.contains('active')) A.win.bleInterface.togglePanel();
  await sleep(500);
  A.win.bleInterface.newDevicesCount = 2; A.win.bleInterface.updateBadge();
  r.boton = { icono: !!$(A, '#ble-fab-btn svg'), burbuja: txt(A, '#ble-fab-btn .ble-fab-badge') || null };
  A.win.bleInterface.togglePanel();
  await scanUntil(A, () => found(A).some((t) => /Tablet/.test(t)), 40);
  await sleep(600);
  // Ronda 2813 (pedido del dueño): "Agregar" ya NO muestra contactos; solo los teléfonos escaneados nuevos (abajo).
  r.panel_contactos = panelRows(A);       // debe quedar vacío (los contactos están en Chats)
  r.panel_encontrados = found(A);          // la Tablet (sin agregar) sí sale aquí para agregarla
  r.panel_hint = txt(A, '#ble-contacts-list .ble-empty') || null;
  r.estado = txt(A, '#ble-status-text');
  // Buscador: ahora filtra los teléfonos ESCANEADOS (no los contactos, que ya no salen aquí)
  r.hay_buscador = !!$(A, '#ble-search-input');
  search(A, 'zzz'); await sleep(500);
  r.zzz = { contactos: panelRows(A), encontrados: found(A) };
  search(A, 'tablet'); await sleep(500);
  r.tablet = { contactos: panelRows(A), encontrados: found(A) };
  search(A, 'galax'); await sleep(500); // "Galaxy" es un contacto: NO debe salir en "Agregar"
  r.galax = { contactos: panelRows(A), encontrados: found(A) };
  search(A, ''); await sleep(500);
  r.sin_filtro = { contactos: panelRows(A), encontrados: found(A) };
  // Cambiar el nombre de un contacto desde su menú ⋮
  if ($(A, '#ble-panel').classList.contains('active')) A.win.bleInterface.togglePanel();
  await sleep(500);
  click(A.win, $(A, '#main-contacts-list .ble-contact-row .ble-btn-menu'));
  await sleep(300);
  const item = Array.from(A.win.document.querySelectorAll('.ble-contact-menu .ble-menu-item')).find((e) => /Cambiar nombre/.test(e.textContent));
  r.menu_cambiar_nombre = !!item;
  click(A.win, item);
  await sleep(800);
  const ni = $(A, '#chat-contact-name');
  r.nombre_listo = !!ni && A.win.document.activeElement === ni;
  if (ni) { ni.value = 'María'; ni.dispatchEvent(new A.win.Event('blur')); }
  await sleep(300);
  click(A.win, $(A, '#chat-back-btn'));
  await sleep(3500);
  r.nombre_en_lista = Array.from(A.win.document.querySelectorAll('#main-contacts-list .ble-contact-name')).map((e) => e.textContent);
  // Nota de voz sin micrófono (no hay / permiso quitado): el aviso
  click(A.win, $(A, '#main-contacts-list .ble-contact-row'));
  await sleep(800);
  const inp = $(A, '#message-input'); if (inp) { inp.value = ''; inp.dispatchEvent(new A.win.Event('input', { bubbles: true })); }
  click(A.win, $(A, '#send-btn')); await sleep(500);
  r.aviso_sin_micro = txt(A, '#perm-error-toast') || null;
  A.win.__gumErr = 'NotAllowedError';
  click(A.win, $(A, '#send-btn')); await sleep(500);
  r.aviso_permiso_micro = txt(A, '#perm-error-toast') || null;
  click(A.win, $(A, '#chat-back-btn'));
  await sleep(500);
  // Perfil
  A.win.dispatchEvent(new A.win.CustomEvent('nexo:ui:profile'));
  await sleep(500);
  r.perfil = { circulo: txt(A, '#nexo-profile-av'), te_ven: txt(A, '#nexo-profile-seen') || null };
  click(A.win, $(A, '#nexo-profile-close'));
  await sleep(300);
  // Textos que no deben salir en ninguna pantalla de las vistas
  const all = [A, B, C].map((p) => p.win.document.body.textContent).join(' ');
  r.textos_mal = ['En linea', 'Offline', 'BLE ON', 'BLE OFF', 'Presiona Buscar', 'Activalo', 'Presiona el botón'].filter((t) => all.indexOf(t) >= 0);
  // Textos viejos que no deben quedar en el código de la app
  const bundle = fs.readdirSync(path.join(buildDir, 'dist', 'js')).filter((f) => f.endsWith('.js')).map((f) => fs.readFileSync(path.join(buildDir, 'dist', 'js', f), 'utf8')).join('\n');
  r.textos_viejos_en_codigo = ["'Ubicacion'", '<b>Ubicacion</b>', "'Microfono'", 'Microfono no encontrado', 'Permisos BLE Requeridos', 'comunicacion P2P', 'continuara automaticamente', 'Ve a Configuracion', 'Continuar sin BLE', 'Activalo', 'Presiona Buscar', 'Presiona el botón +'].filter((t) => bundle.indexOf(t) >= 0);
  const errores = logs.filter((l) => / error: /.test(l) && !/favicon|Not implemented/.test(l)).slice(0, 5);
  r.errores = errores;
  const has = (arr, re) => arr.some((t) => re.test(t));
  const checks = {
    agregado: r.agregado,
    subtitulo: /^En línea$|^Sin conexión$/.test(r.subtitulo),
    panel_solo_escaneados: !r.panel_contactos.length && has(r.panel_encontrados, /Tablet/),
    estado: /Bluetooth/.test(r.estado),
    buscador: r.hay_buscador,
    zzz: !r.zzz.contactos.length && !r.zzz.encontrados.length,
    tablet: has(r.tablet.encontrados, /Tablet/) && !r.tablet.contactos.length,
    galax: !has(r.galax.encontrados, /Tablet/) && !r.galax.contactos.length,
    sin_filtro: has(r.sin_filtro.encontrados, /Tablet/) && !r.sin_filtro.contactos.length,
    textos: !r.textos_mal.length,
    boton: r.boton.icono && r.boton.burbuja === '2',
    perfil: r.perfil.circulo === 'VY' && /Vivo Y21/.test(r.perfil.te_ven || ''),
    aviso_sin_micro: r.aviso_sin_micro === 'No se encontró el micrófono del teléfono',
    aviso_permiso_micro: /^Permiso de micrófono denegado\./.test(r.aviso_permiso_micro || ''),
    textos_en_codigo: !r.textos_viejos_en_codigo.length,
    cambiar_nombre: r.menu_cambiar_nombre && r.nombre_listo && r.nombre_en_lista.indexOf('María') >= 0 && !r.nombre_en_lista.some((n) => /Galaxy/.test(n)),
    sin_errores: !errores.length,
  };
  r.fallan = Object.keys(checks).filter((k) => !checks[k]);
  r.resultado = r.fallan.length ? 'FALLO' : 'OK';
  console.log('UI4 ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_ui4.txt'), logs.join('\n'));
  process.exit(r.fallan.length ? 1 : 0);
})().catch((e) => { console.error(e); fs.writeFileSync(path.join(__dirname, 'last_logs_ui4.txt'), logs.join('\n')); process.exit(1); });
