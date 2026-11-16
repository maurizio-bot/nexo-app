// 3153 — AVISO «Activa las notificaciones» en Contactos (diagnóstico real, Honor, APK 3073: notificaciones denegadas y la app solo
// dejaba un log; el dueño no sabía que con la app cerrada no recibiría mensajes ni llamadas).
//  A  denegadas → banner #nexo-notif-banner visible arriba de Contactos con botón «Activar» (sin otras pantallas encima);
//  B  tocar «Activar» → vuelve a pedir el permiso (ensureNotificationPermission) y, como Android ya no pregunta (responde al
//     instante denegado), abre los ajustes de notificaciones (openAlertSetting what:'notifications');
//  C  concedido + volver a la app (visibilitychange) → el banner desaparece;
//  D  «✕» lo oculta 24 h (guarda nexo_notif_banner_hide; tras recomprobar sigue oculto);
//  E  con las notificaciones concedidas desde el principio no hay banner.
// Contraprueba: en la 3151 (b3151e) no hay banner → A falla.
// Uso: node avisonotif.js <dir_build>
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
const wait = async (c, s) => { for (let i = 0; i < s * 5; i++) { if (await c()) return true; await sleep(200); } return false; };
const resume = (p) => p.win.document.dispatchEvent(new p.win.Event('visibilitychange'));

(async () => {
  const radio = new Radio();
  const nD = new NativePhone('D', 'DD:DD:DD:DD:DD:01', Object.assign({}, opts, { noNotifPerm: true, alerts: { notifications: false, battery: true }, vendor: 'honor' }));
  const nX = new NativePhone('X', 'XX:XX:XX:XX:XX:02', Object.assign({}, opts, { noNotifPerm: true, alerts: { notifications: false, battery: true }, vendor: 'honor' }));
  const nE = new NativePhone('E', 'EE:EE:EE:EE:EE:03', Object.assign({}, opts, { alerts: { notifications: true, battery: true }, vendor: 'google' }));
  [nD, nX, nE].forEach((n) => { radio.add(n); n.load(); });
  const W = { nexo_welcome_done: '1', nexo_display_name: 'Tester' };
  const [D, X, E] = await Promise.all([boot('D', nD, W), boot('X', nX, W), boot('E', nE, W)]);
  const r = { build: path.basename(buildDir) };
  const vis = (p) => { const b = $(p, 'nexo-notif-banner'); return !!b && !!$(p, 'nexo-notif-go') && /notificaciones/i.test(b.textContent); };

  // A + B + C (teléfono D)
  r.A_banner_visible = await wait(() => vis(D), 15);
  r.A_arriba_de_contactos = !!$(D, 'contacts-view') && $(D, 'contacts-view').firstElementChild === $(D, 'nexo-notif-banner');
  click(D.win, $(D, 'nexo-notif-go'));
  r.B_pide_permiso_otra_vez = await wait(() => (nD.notifPermAsked || 0) >= 2, 10);
  r.B_abre_ajustes_notif = await wait(() => (nD.alertOpened || []).indexOf('notifications') >= 0, 10);
  nD.opts.noNotifPerm = false; // el dueño lo activó en los ajustes (openAlertSetting del mock ya marca notifications:true)
  resume(D);
  r.C_banner_desaparece = await wait(() => !$(D, 'nexo-notif-banner'), 10);

  // D (teléfono X): «✕» oculta 24 h
  r.D_banner_visible = await wait(() => vis(X), 15);
  click(X.win, $(X, 'nexo-notif-x'));
  r.D_oculto = !$(X, 'nexo-notif-banner');
  r.D_guarda_hora = (() => { try { return Date.now() - parseInt(X.win.localStorage.getItem('nexo_notif_banner_hide'), 10) < 5000; } catch (e) { return false; } })();
  resume(X); await sleep(1500);
  r.D_sigue_oculto = !$(X, 'nexo-notif-banner');

  // E: concedidas → sin banner
  await sleep(6000);
  r.E_sin_banner = !$(E, 'nexo-notif-banner');

  r.errores = logs.filter((l) => / error: /.test(l) && !/JSDOMERROR|styles\.css|Not implemented/.test(l)).slice(0, 5);
  const ok = r.A_banner_visible && r.A_arriba_de_contactos && r.B_pide_permiso_otra_vez && r.B_abre_ajustes_notif && r.C_banner_desaparece &&
    r.D_banner_visible && r.D_oculto && r.D_guarda_hora && r.D_sigue_oculto && r.E_sin_banner && !r.errores.length;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('AVISONOTIF ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_avisonotif.txt'), logs.join('\n'));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error(e); fs.writeFileSync(path.join(__dirname, 'last_logs_avisonotif.txt'), logs.join('\n')); process.exit(1); });
