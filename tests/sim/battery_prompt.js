// Ronda 2811 (pedido del dueño): el aviso de ahorro de batería al instalar, COMO UN PERMISO que se acepta
// (battery_prompt.js). Antes se saltaba en mudo al ajuste del sistema; ahora una pantalla clara explica por qué y, en
// los teléfonos agresivos (Vivo —el del dueño—, Samsung…), guía además al «inicio automático».
// Escenarios (cada uno un teléfono que arranca; no necesitan hablar entre sí):
//   G (genérico, sin exención): sale el aviso → «Desactivar ahorro de batería» abre el ajuste → al volver queda exento
//      → NO hay 2º paso de fabricante → se cierra. Marca nexo_bat_prompt_done.
//   V (Vivo, sin exención): como G pero, al quedar exento, aparece el 2º paso (inicio automático) con «Abrir»; «Listo» cierra.
//   P (posponer): «Ahora no» cierra el aviso SIN abrir el ajuste y cuenta el aplazamiento (nexo_bat_prompt_skips).
//   E (ya exento): NO sale el aviso (ni salto al ajuste).
//   K (ya pospuesto 3 veces): NO sale el aviso (queda en Perfil → Ajustes).
// Uso: node battery_prompt.js <dir_build>
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
      // Sembrar localStorage antes de que arranque la app (p. ej. aplazamientos previos)
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
const wait = async (c, s) => { for (let i = 0; i < s * 5; i++) { if (await c()) return true; await sleep(200); } return false; };

(async () => {
  const radio = new Radio();
  const nG = new NativePhone('G', 'GG:GG:GG:GG:GG:01', Object.assign({}, opts, { alerts: { battery: false }, vendor: 'google' }));
  const nV = new NativePhone('V', 'VV:VV:VV:VV:VV:02', Object.assign({}, opts, { alerts: { battery: false }, vendor: 'vivo' }));
  const nP = new NativePhone('P', 'PP:PP:PP:PP:PP:03', Object.assign({}, opts, { alerts: { battery: false }, vendor: 'google' }));
  const nE = new NativePhone('E', 'EE:EE:EE:EE:EE:04', Object.assign({}, opts, { alerts: { battery: true }, vendor: 'google' }));
  const nK = new NativePhone('K', 'KK:KK:KK:KK:KK:05', Object.assign({}, opts, { alerts: { battery: false }, vendor: 'google' }));
  [nG, nV, nP, nE, nK].forEach((n) => { radio.add(n); n.load(); });
  const [G, V, P, E, K] = await Promise.all([
    boot('G', nG), boot('V', nV), boot('P', nP), boot('E', nE), boot('K', nK, { nexo_bat_prompt_skips: '3' }),
  ]);
  const r = { build: path.basename(buildDir) };

  // G: genérico — sale el aviso, se concede, sin 2º paso de fabricante
  r.G_sale_aviso = await wait(() => !!$(G, 'nexo-bat-allow'), 20);
  click(G.win, $(G, 'nexo-bat-allow'));
  r.G_abre_ajuste_bateria = await wait(() => (nG.alertOpened || []).indexOf('battery') >= 0, 15);
  r.G_cierra = await wait(() => !$(G, 'nexo-bat-overlay'), 15);
  r.G_sin_paso_fabricante = (nG.alertOpened || []).indexOf('vendor') < 0;
  r.G_marca_hecho = (() => { try { return G.win.localStorage.getItem('nexo_bat_prompt_done') === '1'; } catch (e) { return false; } })();

  // V: Vivo — sale el aviso, se concede, y aparece el 2º paso (inicio automático) con «Abrir»; «Listo» cierra
  r.V_sale_aviso = await wait(() => !!$(V, 'nexo-bat-allow'), 20);
  click(V.win, $(V, 'nexo-bat-allow'));
  r.V_abre_ajuste_bateria = await wait(() => (nV.alertOpened || []).indexOf('battery') >= 0, 15);
  r.V_paso_fabricante = await wait(() => !!$(V, 'nexo-bat-vendor'), 15);
  { const v = $(V, 'nexo-bat-vendor'); if (v) click(V.win, v); }
  r.V_abre_inicio_automatico = (nV.alertOpened || []).indexOf('vendor') >= 0;
  { const d = $(V, 'nexo-bat-vendor-done'); if (d) click(V.win, d); }
  r.V_cierra = await wait(() => !$(V, 'nexo-bat-overlay'), 15);

  // P: posponer — «Ahora no» cierra sin abrir el ajuste y cuenta el aplazamiento
  r.P_sale_aviso = await wait(() => !!$(P, 'nexo-bat-skip'), 20);
  click(P.win, $(P, 'nexo-bat-skip'));
  r.P_cierra = await wait(() => !$(P, 'nexo-bat-overlay'), 15);
  r.P_no_abre_ajuste = (nP.alertOpened || []).indexOf('battery') < 0;
  r.P_cuenta_aplazo = (() => { try { return P.win.localStorage.getItem('nexo_bat_prompt_skips') === '1'; } catch (e) { return false; } })();

  // E: ya exento — no sale el aviso ni se salta al ajuste
  r.E_sin_aviso = !(await wait(() => !!$(E, 'nexo-bat-allow'), 10));
  r.E_no_abre_ajuste = (nE.alertOpened || []).indexOf('battery') < 0;

  // K: ya pospuesto 3 veces — no vuelve a salir solo (queda en Ajustes)
  r.K_sin_aviso = !(await wait(() => !!$(K, 'nexo-bat-allow'), 10));

  r.errores = logs.filter((l) => / error: /.test(l) && !/JSDOMERROR|styles\.css|Not implemented/.test(l)).slice(0, 5);
  const ok = r.G_sale_aviso && r.G_abre_ajuste_bateria && r.G_cierra && r.G_sin_paso_fabricante && r.G_marca_hecho &&
    r.V_sale_aviso && r.V_abre_ajuste_bateria && r.V_paso_fabricante && r.V_abre_inicio_automatico && r.V_cierra &&
    r.P_sale_aviso && r.P_cierra && r.P_no_abre_ajuste && r.P_cuenta_aplazo &&
    r.E_sin_aviso && r.E_no_abre_ajuste && r.K_sin_aviso && !r.errores.length;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('BATPROMPT ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_battery_prompt.txt'), logs.join('\n'));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error(e); fs.writeFileSync(path.join(__dirname, 'last_logs_battery_prompt.txt'), logs.join('\n')); process.exit(1); });
