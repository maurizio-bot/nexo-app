// #dueño 05-11: guía de bienvenida la PRIMERA vez (welcome_guide.js) — una pantalla con diapositivas que explica lo
// básico (qué es NEXO, agregar un contacto, mandar un mensaje) y, al terminar, enlaza con el aviso de batería de siempre.
// Escenarios (cada uno un teléfono que arranca; no hablan entre sí):
//   N (nuevo): SALE la guía (4 diapositivas, «Atrás» off y «Saltar» en la 1ª). Avanzar con «Siguiente» hasta la última
//      («Empezar») → cierra, marca nexo_welcome_done y RECIÉN AHÍ sale el aviso de batería (el encadenado onDone).
//   S (saltar): SALE la guía; «Saltar» la cierra de una, marca el flag y también enlaza con el aviso de batería.
//   A (ya vista): con nexo_welcome_done='1' y batería ya exenta → NO sale sola; «Ver la guía otra vez» (force) la reabre.
// Uso: node welcome.js <dir_build>
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
async function boot(name, native, seed) {
  const vc = new VirtualConsole();
  ['log', 'warn', 'error'].forEach((l) => vc.on(l, (...a) => logs.push(`${new Date().toISOString().substring(14, 23)} [${name}] ${l}: ` + a.map(String).join(' ').substring(0, 250))));
  const dom = new JSDOM(fs.readFileSync(path.join(buildDir, 'dist', 'index.html'), 'utf8'), {
    url: 'https://' + name.toLowerCase() + '.nexo.test/index.html', runScripts: 'dangerously', resources: new DL(path.join(buildDir, 'dist')), pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) {
      win.CapacitorCustomPlatform = { name: 'android' }; require('./native_mock').installWebCrypto(win); win.Capacitor = { Plugins: { NexoBLE: native.plugin() } }; win.HTMLElement.prototype.scrollTo = function () {};
      win.navigator.mediaDevices = { getUserMedia: () => Promise.reject(new Error('sin micrófono en el simulador')) };
      if (seed) { try { Object.keys(seed).forEach((k) => win.localStorage.setItem(k, seed[k])); } catch (e) {} }
    },
  });
  const win = dom.window;
  for (let i = 0; i < 100 && !(win.NEXO && win.NEXO.initialized); i++) await sleep(100);
  await sleep(800);
  return { name, native, win };
}
const click = (w, el) => el && el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
const $ = (p, id) => p.win.document.getElementById(id);
const txt = (p, id) => { const el = $(p, id); return el ? (el.textContent || '').trim() : ''; };
const qs = (p, sel) => p.win.document.querySelector(sel);
const wait = async (c, s) => { for (let i = 0; i < s * 5; i++) { if (await c()) return true; await sleep(200); } return false; };

(async () => {
  const radio = new Radio();
  const nN = new NativePhone('N', 'NN:NN:NN:NN:NN:01', Object.assign({}, opts, { alerts: { battery: false }, vendor: 'google' }));
  const nS = new NativePhone('S', 'SS:SS:SS:SS:SS:02', Object.assign({}, opts, { alerts: { battery: false }, vendor: 'google' }));
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:03', Object.assign({}, opts, { alerts: { battery: true }, vendor: 'google' }));
  const nG = new NativePhone('G', 'GG:GG:GG:GG:GG:04', Object.assign({}, opts, { alerts: { battery: false }, vendor: 'google' }));
  [nN, nS, nA, nG].forEach((n) => { radio.add(n); n.load(); });
  // N/S/A ya tienen el nombre fijado (nexo_display_name) → la pantalla de nombre NO sale, prueban la guía en aislado (como
  // antes). G es un teléfono NUEVO del todo (sin nombre) → sale la pantalla OBLIGATORIA del nombre ANTES de la guía (#dueño 06-11).
  const [N, S, A, G] = await Promise.all([
    boot('N', nN, { nexo_display_name: 'Tester' }),
    boot('S', nS, { nexo_display_name: 'Tester' }),
    boot('A', nA, { nexo_welcome_done: '1', nexo_display_name: 'Tester' }),
    boot('G', nG),
  ]);
  const r = { build: path.basename(buildDir) };

  // N: nuevo — sale la guía; se recorre entera y al «Empezar» se cierra, marca el flag y sale el aviso de batería
  r.N_sale_guia = await wait(() => !!$(N, 'nexo-welcome-overlay'), 20);
  r.N_cuatro_diapositivas = (() => { const o = $(N, 'nexo-welcome-overlay'); return !!o && o.querySelectorAll('.wel-dot').length === 4; })();
  r.N_primera_es_bienvenida = /Bienvenido a NEXO/.test((qs(N, '#nexo-welcome-overlay .wel-title') || {}).textContent || '');
  r.N_atras_desactivado_en_1a = (() => { const b = $(N, 'nexo-welcome-back'); return !!b && b.disabled === true; })();
  r.N_aviso_bateria_aun_no = !$(N, 'nexo-bat-allow'); // la guía va ANTES del aviso de batería
  // avanzar: Siguiente, Siguiente, Siguiente → última (botón «Empezar»)
  for (let k = 0; k < 3; k++) { click(N.win, $(N, 'nexo-welcome-next')); await sleep(120); }
  r.N_ultima_es_empezar = txt(N, 'nexo-welcome-next') === 'Empezar';
  r.N_saltar_oculto_en_ultima = (() => { const sk = $(N, 'nexo-welcome-skip'); return !!sk && sk.style.visibility === 'hidden'; })();
  click(N.win, $(N, 'nexo-welcome-next')); // Empezar → cierra
  r.N_cierra = await wait(() => !$(N, 'nexo-welcome-overlay'), 10);
  r.N_marca_vista = (() => { try { return N.win.localStorage.getItem('nexo_welcome_done') === '1'; } catch (e) { return false; } })();
  r.N_luego_aviso_bateria = await wait(() => !!$(N, 'nexo-bat-allow'), 15); // el encadenado onDone dispara la batería

  // S: saltar — «Saltar» cierra la guía de una, marca el flag y también enlaza con el aviso de batería
  r.S_sale_guia = await wait(() => !!$(S, 'nexo-welcome-overlay'), 20);
  click(S.win, $(S, 'nexo-welcome-skip'));
  r.S_cierra = await wait(() => !$(S, 'nexo-welcome-overlay'), 10);
  r.S_marca_vista = (() => { try { return S.win.localStorage.getItem('nexo_welcome_done') === '1'; } catch (e) { return false; } })();
  r.S_luego_aviso_bateria = await wait(() => !!$(S, 'nexo-bat-allow'), 15);

  // A: ya vista — NO sale sola; «Ver la guía otra vez» (force) la reabre aunque el flag esté puesto
  r.A_sin_guia = !(await wait(() => !!$(A, 'nexo-welcome-overlay'), 10));
  try { A.win.NEXO_welcome({ force: true }); } catch (e) {}
  r.A_force_reabre = await wait(() => !!$(A, 'nexo-welcome-overlay'), 6);
  click(A.win, $(A, 'nexo-welcome-skip'));
  r.A_force_cierra = await wait(() => !$(A, 'nexo-welcome-overlay'), 10);

  // G: teléfono NUEVO del todo (#dueño 06-11) — ANTES de la guía sale la pantalla OBLIGATORIA del nombre: avisa que NO se
  //    puede cambiar (anti perfiles falsos), el botón Confirmar está apagado si está vacío, y al confirmar el nombre queda
  //    FIJO y es el que verán los contactos (bi.localDeviceName). Recién después sale la guía.
  r.G_sale_pantalla_nombre = await wait(() => !!$(G, 'nexo-name-overlay'), 20);
  r.G_aviso_permanente = /no se puede cambiar|no se podrá cambiar/i.test((qs(G, '#nexo-name-overlay .nm-warn') || {}).textContent || '');
  r.G_guia_aun_no = !$(G, 'nexo-welcome-overlay');   // el nombre va ANTES de la guía
  (() => { const inp = $(G, 'nexo-name-input'); if (inp) { inp.value = ''; inp.dispatchEvent(new G.win.Event('input', { bubbles: true })); } })();
  r.G_confirmar_off_si_vacio = (() => { const b = $(G, 'nexo-name-ok'); return !!b && b.disabled === true; })();
  // #dueño 06-11: el campo NO admite números ni caracteres especiales (un nombre de verdad, no un alias) → se limpian al teclear
  (() => { const inp = $(G, 'nexo-name-input'); inp.value = 'Jo4n #Pérez!'; inp.dispatchEvent(new G.win.Event('input', { bubbles: true })); })();
  r.G_sin_numeros_ni_simbolos = (() => { const inp = $(G, 'nexo-name-input'); return !!inp && inp.value === 'Jon Pérez'; })();
  (() => { const inp = $(G, 'nexo-name-input'); inp.value = 'Maurizio Real'; inp.dispatchEvent(new G.win.Event('input', { bubbles: true })); })();
  r.G_confirmar_on_con_nombre = (() => { const b = $(G, 'nexo-name-ok'); return !!b && b.disabled === false; })();
  click(G.win, $(G, 'nexo-name-ok'));
  r.G_cierra_nombre = await wait(() => !$(G, 'nexo-name-overlay'), 10);
  r.G_nombre_fijado = (() => { try { return G.win.NEXO_displayNameLocked() === true && G.win.NEXO_myDisplayName() === 'Maurizio Real'; } catch (e) { return false; } })();
  r.G_contactos_ven_el_nombre = (G.win.bleInterface && G.win.bleInterface.localDeviceName) === 'Maurizio Real';
  r.G_luego_guia = await wait(() => !!$(G, 'nexo-welcome-overlay'), 15);   // tras fijar el nombre, sí sale la guía

  r.errores = logs.filter((l) => / error: /.test(l) && !/JSDOMERROR|styles\.css|Not implemented/.test(l)).slice(0, 5);
  const ok = r.N_sale_guia && r.N_cuatro_diapositivas && r.N_primera_es_bienvenida && r.N_atras_desactivado_en_1a &&
    r.N_aviso_bateria_aun_no && r.N_ultima_es_empezar && r.N_saltar_oculto_en_ultima && r.N_cierra && r.N_marca_vista && r.N_luego_aviso_bateria &&
    r.S_sale_guia && r.S_cierra && r.S_marca_vista && r.S_luego_aviso_bateria &&
    r.A_sin_guia && r.A_force_reabre && r.A_force_cierra &&
    r.G_sale_pantalla_nombre && r.G_aviso_permanente && r.G_guia_aun_no && r.G_confirmar_off_si_vacio &&
    r.G_sin_numeros_ni_simbolos &&
    r.G_confirmar_on_con_nombre && r.G_cierra_nombre && r.G_nombre_fijado && r.G_contactos_ven_el_nombre && r.G_luego_guia &&
    !r.errores.length;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('WELCOME ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_welcome.txt'), logs.join('\n'));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error(e); fs.writeFileSync(path.join(__dirname, 'last_logs_welcome.txt'), logs.join('\n')); process.exit(1); });
