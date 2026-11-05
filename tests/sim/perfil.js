// Perfil enriquecido — paso 1 (ronda 2910, pedido del dueño 04-11). Un solo teléfono en jsdom (es todo local):
//   (1) mis datos (nombre y apellido, teléfono, correo) se guardan y se leen (round-trip) y quedan en disco cifrado
//   (2) validación suave: el teléfono se limpia (fuera letras), el correo malo avisa (email_bad) pero se guarda igual
//   (3) enmascarado (decisión del dueño): teléfono = últimos dígitos, correo = primeras letras
//   (4) la pantalla Perfil muestra los 3 campos con lo guardado (inputs editables)
//   (5) ⋮ → Perfil de un contacto: antes NO hacía nada; ahora abre la ficha del contacto con su NEXO ID
// Uso: node perfil.js <dir_build>
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone, installWebCrypto } = require('./native_mock');

const buildDir = path.resolve(process.argv[2]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
class DL extends ResourceLoader { constructor(d) { super(); this.d = d; } fetch(u) { const f = path.join(this.d, decodeURIComponent(new URL(u).pathname)); return fs.existsSync(f) ? Promise.resolve(fs.readFileSync(f)) : Promise.reject(new Error('x')); } }
const logs = [];
async function boot(name, native) {
  const vc = new VirtualConsole();
  ['log', 'warn', 'error'].forEach((l) => vc.on(l, (...a) => logs.push(`[${name}] ${l}: ` + a.map(String).join(' ').substring(0, 200))));
  const dom = new JSDOM(fs.readFileSync(path.join(buildDir, 'dist', 'index.html'), 'utf8'), {
    url: 'https://' + name.toLowerCase() + '.nexo.test/index.html', runScripts: 'dangerously', resources: new DL(path.join(buildDir, 'dist')), pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) { win.CapacitorCustomPlatform = { name: 'android' }; installWebCrypto(win); win.Capacitor = { Plugins: { NexoBLE: native.plugin() } }; win.HTMLElement.prototype.scrollTo = function () {}; },
  });
  const win = dom.window;
  for (let i = 0; i < 100 && !(win.NEXO && win.NEXO.initialized); i++) await sleep(100);
  await sleep(800);
  return { name, native, win };
}

(async () => {
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', { wifi: 'casa', ioDelay: 5 });
  radio.add(nA); nA.load();
  const A = await boot('A', nA);
  const w = A.win;
  const r = { build: path.basename(buildDir) };

  // (1) round-trip: guardar mis datos y leerlos
  w.NEXO_setMyProfile({ name: 'Juan Pérez', phone: '+54 11 2345-6789', email: 'juan@correo.com' });
  await sleep(50);
  let mp = w.NEXO_myProfile();
  r.guarda_nombre = mp.name === 'Juan Pérez';
  r.guarda_tel = mp.phone === '+54 11 2345-6789';
  r.guarda_correo = mp.email === 'juan@correo.com';
  // queda en disco (cifrado por el plugin; aquí el mock lo guarda en nA.files)
  let saved = null; try { saved = JSON.parse(nA.files.get('nexo_my_profile.json') || '{}'); } catch (e) {}
  r.en_disco = !!saved && saved.name === 'Juan Pérez' && saved.email === 'juan@correo.com';

  // (2) validación suave: teléfono se limpia (fuera letras), correo malo avisa pero se guarda igual
  let res = w.NEXO_setMyProfile({ phone: '11ABC22xx33', email: 'no-es-correo' });
  await sleep(20);
  mp = w.NEXO_myProfile();
  r.tel_limpio = mp.phone === '112233';   // '11ABC22xx33' → se quitan las letras
  r.correo_malo_avisa = res && res.email_bad === true;
  r.correo_malo_se_guarda = mp.email === 'no-es-correo';

  // (3) enmascarado (lo que viajará en la solicitud en el paso 2)
  r.mask_tel = w.NEXO_maskPhone('+54 11 2345-6789') === '•••••89';
  r.mask_correo = w.NEXO_maskEmail('juan@correo.com') === 'ju•••@•••';
  r.mask_vacio = w.NEXO_maskPhone('') === '' && w.NEXO_maskEmail('') === '';

  // volver a poner datos buenos para la pantalla
  w.NEXO_setMyProfile({ name: 'Juan Pérez', phone: '+54 11 2345-6789', email: 'juan@correo.com' });
  await sleep(30);

  // (4) la pantalla Perfil muestra los campos con lo guardado
  w.dispatchEvent(new w.CustomEvent('nexo:ui:profile', {}));
  await sleep(120);
  const fName = w.document.getElementById('nexo-prof-name');
  const fPhone = w.document.getElementById('nexo-prof-phone');
  const fEmail = w.document.getElementById('nexo-prof-email');
  r.pantalla_tiene_campos = !!(fName && fPhone && fEmail);
  r.pantalla_muestra_datos = !!fName && fName.value === 'Juan Pérez' && !!fEmail && fEmail.value === 'juan@correo.com';
  // editar en la pantalla + 'change' debe guardar
  if (fName) { fName.value = 'Juana López'; fName.dispatchEvent(new w.Event('change', { bubbles: true })); }
  await sleep(30);
  r.editar_en_pantalla_guarda = w.NEXO_myProfile().name === 'Juana López';
  // cerrar la hoja
  const closeP = w.document.getElementById('nexo-profile-close'); if (closeP) closeP.click();
  await sleep(30);

  // (5) ⋮ → Perfil de un contacto: ANTES no hacía nada; ahora abre la ficha con su NEXO ID
  const prevNada = !w.document.getElementById('nexo-contact-profile');
  w.dispatchEvent(new w.CustomEvent('nexo:ble:goToProfile', { detail: { deviceUUID: 'nx12345678' } }));
  await sleep(120);
  const cp = w.document.getElementById('nexo-contact-profile');
  r.perfil_contacto_abre = !!cp;
  r.perfil_contacto_muestra_id = !!cp && /NX12345678/.test(cp.textContent || '');
  r.perfil_contacto_antes_nada = prevNada;

  // (6) #dueño 04-11: una solicitud de contacto pendiente AVISA en la lista principal (banner), no solo dentro de «Agregar»
  //     (antes: si no entrabas a «Agregar», no te enterabas). Y al quedar sin solicitudes, el banner desaparece.
  w.bleInterface._reqSave('nexo_req_in', [{ id: 'nx0solic1', pk: 'xx', name: 'Fulano', at: Date.now() }]);
  w.bleInterface.renderContactsList();
  await sleep(450); // renderContactsList tiene un throttle de ~300 ms
  var reqBanner = w.document.getElementById('ble-req-banner');
  r.solicitud_banner_en_lista = !!reqBanner && /solicitud/i.test(reqBanner.textContent || '');
  w.bleInterface._reqSave('nexo_req_in', []);
  w.bleInterface.renderContactsList();
  await sleep(450);
  r.sin_solicitud_sin_banner = !w.document.getElementById('ble-req-banner');

  r.errores = logs.filter((l) => /TypeError|undefined is not|is not a function|NEXO_setMyProfile/.test(l) && /error/.test(l)).slice(0, 4);
  const ok = r.guarda_nombre && r.guarda_tel && r.guarda_correo && r.en_disco &&
    r.tel_limpio && r.correo_malo_avisa && r.correo_malo_se_guarda &&
    r.mask_tel && r.mask_correo && r.mask_vacio &&
    r.pantalla_tiene_campos && r.pantalla_muestra_datos && r.editar_en_pantalla_guarda &&
    r.perfil_contacto_abre && r.perfil_contacto_muestra_id && r.perfil_contacto_antes_nada &&
    r.solicitud_banner_en_lista && r.sin_solicitud_sin_banner &&
    r.errores.length === 0;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('PERFIL ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_perfil.txt'), logs.join('\n'));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error('FALLO:', e.stack); fs.writeFileSync(path.join(__dirname, 'last_logs_perfil.txt'), logs.join('\n')); process.exit(1); });
