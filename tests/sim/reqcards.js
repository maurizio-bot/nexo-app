// Solicitudes arriba de la lista de chats (dueño 28-11). Un teléfono en jsdom:
//  R1 la solicitud sale ARRIBA de la lista con Aceptar / Eliminar ahí mismo (antes: cartel «toca para ver» que llevaba a «Agregar»);
//  R2 brilla al llegar (nx-req-glow, ~2,7 s aunque la lista se redibuje) y después queda fija (no vuelve a brillar al redibujar);
//  R3 más de 3 → se ven 3 y «Ver todas (N)»;
//  R4 Eliminar la quita y ya;
//  R5 Aceptar abre el chat y la caja dice «Saluda a {nombre} 👋»; al escribir vuelve a «Mensaje...»;
//  R6 Aceptar una de «te escribió» abre el chat SIN «Saluda a…» (se ve su mensaje).
// Contraprueba: la base (cartel) falla R1–R6. Uso: node reqcards.js <dir_build>
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone, installWebCrypto } = require('./native_mock');

const buildDir = path.resolve(process.argv[2]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
class DL extends ResourceLoader { constructor(d) { super(); this.d = d; } fetch(u) { const f = path.join(this.d, decodeURIComponent(new URL(u).pathname)); return fs.existsSync(f) ? Promise.resolve(fs.readFileSync(f)) : Promise.reject(new Error('404 ' + f)); } }
const pk = () => Buffer.from(Array.from({ length: 65 }, () => Math.floor(Math.random() * 256))).toString('base64');
async function boot(name, native, seed) {
  const vc = new VirtualConsole();
  const dom = new JSDOM(fs.readFileSync(path.join(buildDir, 'dist', 'index.html'), 'utf8'), {
    url: 'https://' + name.toLowerCase() + '.nexo.test/index.html', runScripts: 'dangerously', resources: new DL(path.join(buildDir, 'dist')), pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) { win.CapacitorCustomPlatform = { name: 'android' }; installWebCrypto(win); win.Capacitor = { Plugins: { NexoBLE: native.plugin() } }; win.HTMLElement.prototype.scrollTo = function () {};
      Object.keys(seed).forEach((k) => win.localStorage.setItem(k, seed[k])); },
  });
  const win = dom.window;
  for (let i = 0; i < 100 && !(win.NEXO && win.NEXO.initialized); i++) await sleep(100);
  await sleep(800);
  return win;
}

(async () => {
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', { wifi: 'casa', ioDelay: 5 });
  radio.add(nA); nA.load();
  const w = await boot('A', nA, { nexo_display_name: 'Juan', nexo_welcome_done: '1' });
  const bi = w.bleInterface, $ = (s) => w.document.querySelector(s), $$ = (s) => Array.from(w.document.querySelectorAll(s));
  const draw = async () => { bi.renderContactsList(); await sleep(450); };
  const r = { build: path.basename(buildDir) };
  const ph = () => ($('#message-input') || {}).placeholder || '';
  const click = (s) => { const b = $(s); if (b) b.click(); };

  bi._reqSave('nexo_req_in', [{ id: 'nx0solic01', pk: pk(), name: 'Fulano', at: Date.now() }]);
  await draw();
  const ban = $('#ble-req-banner');
  r.R1_ok = !!ban && /solicitud/.test(ban.textContent) && !!(ban.querySelector('.ble-req-accept') && ban.querySelector('.ble-req-reject')) && /Fulano/.test(ban.textContent);
  const g1 = !!(ban && /nx-req-glow/.test(ban.className));
  await sleep(2700); await draw();
  const g2 = !!($('#ble-req-banner') && /nx-req-glow/.test($('#ble-req-banner').className));
  r.R2_ok = g1 && !g2;

  bi._reqSave('nexo_req_in', ['nx0solic01', 'nx0solic02', 'nx0solic03', 'nx0solic04'].map((id, i) => ({ id, pk: pk(), name: 'P' + i, at: Date.now() })));
  await draw();
  r.R3_filas = $$('#ble-req-banner .ble-req-row').length;
  r.R3_ok = r.R3_filas === 3 && /Ver todas \(4\)/.test(($('#ble-req-banner .ble-req-more') || {}).textContent || '');

  bi._reqSave('nexo_req_in', [{ id: 'nx0solic05', pk: pk(), name: 'Mengano', at: Date.now() }]);
  await draw();
  click('#ble-req-banner .ble-req-reject');
  await draw();
  r.R4_ok = !$('#ble-req-banner') && bi.pendingRequests().length === 0;

  bi._reqSave('nexo_req_in', [{ id: 'nx0solic06', pk: pk(), name: 'Zutano', at: Date.now() }]);
  await draw();
  click('#ble-req-banner .ble-req-accept');
  await sleep(1500);
  r.R5_chat = String(((w.NEXO.app && w.NEXO.app.activeContact) || {}).nexoId || '').toLowerCase();
  r.R5_ph = ph();
  const inp = $('#message-input');
  if (inp) { inp.value = 'hola'; inp.dispatchEvent(new w.Event('input')); }
  r.R5_ph_despues = ph();
  r.R5_ok = r.R5_chat === 'nx0solic06' && r.R5_ph === 'Saluda a Zutano 👋' && r.R5_ph_despues === 'Mensaje...' && !$('#ble-req-banner');
  if (inp) inp.value = '';

  bi._reqSave('nexo_req_in', [{ id: 'nx0solic07', pk: pk(), name: 'Escribe', at: Date.now(), msg: 1 }]);
  await draw();
  click('#ble-req-banner .ble-req-accept');
  await sleep(1500);
  r.R6_chat = String(((w.NEXO.app && w.NEXO.app.activeContact) || {}).nexoId || '').toLowerCase();
  r.R6_ok = r.R6_chat === 'nx0solic07' && !/Saluda/.test(ph());

  const ok = r.R1_ok && r.R2_ok && r.R3_ok && r.R4_ok && r.R5_ok && r.R6_ok;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('REQCARDS ' + JSON.stringify(r));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('REQCARDS ' + JSON.stringify({ resultado: 'FALLO', error: String((e && e.stack) || e).slice(0, 400) })); process.exit(1); });
