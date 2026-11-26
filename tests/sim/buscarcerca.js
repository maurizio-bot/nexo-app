// 3345 (dueño 25-11, modo multitud / EDC: «lo primero en una multitud es buscar a las personas que conoces y poderte reencontrar»).
// A y B contactos por Bluetooth.
//  1. A abre las opciones del chat de B → «Buscar a B entre la gente»: la pantalla sigue la SEÑAL de B (−82 = lejos → −55 = muy cerca,
//     «te estás acercando») y el escaneo no para mientras está abierta (y para al cerrarla).
//  2. «Hacer sonar su teléfono»: a B le llega un mensaje normal (con aviso) y, con la app a la vista, «A te está buscando»;
//     «Buscar a A» le abre su pantalla.
//  3. A comparte su ubicación: B ve la distancia y la dirección (unos 140 m al noreste) sin que nada quede en los chats ni avise;
//     al cerrar A su pantalla, B deja de verla.
//  4. En un grupo: «¿Quién del grupo está cerca?» lista a B con su señal.
// Uso: node buscarcerca.js <dir_build>
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone } = require('./native_mock');

const buildDir = path.resolve(process.argv[2] || path.join(__dirname, 'builds/wip'));
const opts = { readsContentFallback: true, retain: ['onPayloadReceived'], closeOnNoService: true, pace: [15, 15], ioDelay: 25, asymmetric: true };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
class DL extends ResourceLoader { constructor(d) { super(); this.d = d; } fetch(u) { const f = path.join(this.d, decodeURIComponent(new URL(u).pathname)); return fs.existsSync(f) ? Promise.resolve(fs.readFileSync(f)) : Promise.reject(new Error('x')); } }
const logs = [];
// GPS de mentira (Capacitor Geolocation)
function geo(pos) {
  const w = { cbs: [], pos };
  w.plugin = {
    checkPermissions: () => Promise.resolve({ location: 'granted' }),
    requestPermissions: () => Promise.resolve({ location: 'granted' }),
    watchPosition: (o, cb) => { w.cbs.push(cb); setTimeout(() => cb({ coords: { latitude: w.pos[0], longitude: w.pos[1], accuracy: 6 } }), 50); return Promise.resolve('w' + w.cbs.length); },
    clearWatch: () => { w.cleared = (w.cleared || 0) + 1; return Promise.resolve(); },
  };
  return w;
}
async function boot(name, native, g) {
  const vc = new VirtualConsole();
  ['log', 'warn', 'error'].forEach((l) => vc.on(l, (...a) => logs.push(`${new Date().toISOString().substring(14, 23)} [${name}] ${l}: ` + a.map(String).join(' ').substring(0, 250))));
  const dom = new JSDOM(fs.readFileSync(path.join(buildDir, 'dist', 'index.html'), 'utf8'), {
    url: 'https://' + name.toLowerCase() + '.nexo.test/index.html', runScripts: 'dangerously', resources: new DL(path.join(buildDir, 'dist')), pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) { win.CapacitorCustomPlatform = { name: 'android' }; require('./native_mock').installWebCrypto(win); win.Capacitor = { Plugins: { NexoBLE: native.plugin(), Geolocation: g.plugin } }; win.HTMLElement.prototype.scrollTo = function () {}; },
  });
  const win = dom.window;
  for (let i = 0; i < 100 && !(win.NEXO && win.NEXO.initialized); i++) await sleep(100);
  await sleep(800);
  return { name, native, win };
}
const click = (w, el) => el && el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
async function addFound(p) {
  let add = null;
  for (let i = 0; i < 400 && !add; i++) { await sleep(100); add = p.win.document.querySelector('#ble-new-device > div button'); if (!add && !p.win.bleInterface.isScanning) click(p.win, p.win.document.getElementById('ble-scan-btn')); }
  click(p.win, add); await sleep(2000);
}
async function openChatWith(p, name) {
  let row; for (let i = 0; i < 300 && !row; i++) { row = Array.from(p.win.document.querySelectorAll('#main-contacts-list .ble-contact-row')).find((r) => (r.querySelector('.ble-contact-name') || {}).textContent.indexOf(name) >= 0); if (!row) await sleep(100); }
  click(p.win, row); await sleep(600); return !!row;
}
function sendText(p, t) { const i = p.win.document.getElementById('message-input'); i.value = t; i.dispatchEvent(new p.win.Event('input', { bubbles: true })); click(p.win, p.win.document.getElementById('send-btn')); }
const wait = async (c, s) => { for (let i = 0; i < s * 5; i++) { if (await c()) return true; await sleep(200); } return false; };
const $ = (p, sel) => p.win.document.querySelector(sel);
const menuItem = async (p, cls) => { click(p.win, $(p, '#chat-contact-avatar')); await sleep(300); return $(p, '#nexo-chat-menu .' + cls); };

(async () => {
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', opts), nB = new NativePhone('B', 'BB:BB:BB:BB:BB:02', Object.assign({ rssi: -82 }, opts));
  [nA, nB].forEach((n) => { radio.add(n); n.load(); });
  const gA = geo([19.4326, -99.1332]), gB = geo([19.4317, -99.1343]); // B ~150 m al suroeste de A
  let [A, B] = await Promise.all([boot('A', nA, gA), boot('B', nB, gB)]);
  const idA = A.win.bleInterface.localNexoId.toLowerCase(), idB = B.win.bleInterface.localNexoId.toLowerCase();
  const r = { prueba: 'buscarcerca', build: path.basename(buildDir) };
  A.win.bleInterface.togglePanel(); await addFound(A); A.win.bleInterface.togglePanel();
  await openChatWith(A, 'B'); sendText(A, 'hola'); await sleep(2500);
  r.contactos = await wait(async () => (await B.win.vaultLoadMessages(idA)).some((m) => m.content === 'hola'), 30);
  // 0. 26-11 (B0, dueño): escondido por defecto: sin «Buscar a X…» en el menú del chat; con el interruptor encendido vuelve
  r.escondido_por_defecto = !(await menuItem(A, 'chat-find'));
  { const m = $(A, '#nexo-chat-menu'); if (m) m.remove(); }
  A.win.__nexoFindOn = true; B.win.__nexoFindOn = true;
  // 1. la pantalla de buscar
  const it = await menuItem(A, 'chat-find');
  r.opcion_en_menu = !!it && /Buscar a .*entre la gente/.test(it.textContent);
  click(A.win, it); await sleep(300);
  r.pantalla = !!$(A, '#nexo-find');
  const lvl = () => { const e = $(A, '#nexo-find .find-level'); return e ? Number(e.dataset.level) : -9; };
  r.lejos = await wait(() => lvl() === 1, 15);
  const scans0 = nA.stats.scans || 0;
  nB.opts.rssi = -55;
  let trend = false;
  r.muy_cerca = await wait(() => { if (/acercando/.test(($(A, '#nexo-find .find-trend') || {}).textContent || '')) trend = true; return lvl() === 3; }, 15);
  r.acercando = trend || await wait(() => /acercando/.test(($(A, '#nexo-find .find-trend') || {}).textContent || ''), 4);
  await sleep(8000); // más que los 6 s de un escaneo normal
  r.sigue_escaneando = Date.now() < (nA.scanningUntil || 0);
  r.escaneos_pocos = (nA.stats.scans || 0) - scans0 <= 2;
  // 2. hacer sonar
  const vibB = []; B.win.navigator.vibrate = (p) => { vibB.push(p); return true; };
  click(A.win, $(A, '#nexo-find .find-ring'));
  r.b_mensaje = await wait(async () => (await B.win.vaultLoadMessages(idA)).some((m) => /Te estoy buscando/.test(m.content || '')), 30);
  r.b_te_buscan = await wait(() => /te está buscando/.test(($(B, '#nexo-find-rang') || {}).textContent || ''), 20);
  r.b_vibra = vibB.length > 0;
  click(B.win, $(B, '#nexo-find-rang .find-rang-go')); await sleep(400);
  r.b_busca_a_a = /Buscar a A/.test(($(B, '#nexo-find') || {}).textContent || '');
  // 3. A comparte su ubicación
  const notesB0 = nB.notifLog.length;
  click(A.win, $(A, '#nexo-find .find-share')); await sleep(300);
  r.a_comparte = /Dejar de compartir/.test(($(A, '#nexo-find .find-share') || {}).textContent || '');
  const geoB = () => ($(B, '#nexo-find .find-geo') || {}).textContent || '';
  r.b_ve_distancia = await wait(() => /A unos 1[0-9]0 m hacia el noreste/.test(geoB()), 30);
  r.b_texto = geoB();
  r.b_flecha = (($(B, '#nexo-find .find-arrow') || {}).style || {}).display === 'flex';
  await sleep(1500);
  const hidden = async (p, id) => (await p.win.vaultLoadMessages(id)).filter((m) => /"act":"fnd"/.test(m.content || '')).length;
  r.nada_en_chats = (await hidden(A, idB)) + (await hidden(B, idA)) === 0;
  r.sin_aviso_ubicacion = !nB.notifLog.slice(notesB0).some((n) => /nexo_act|"fnd"/.test(n.text || ''));
  click(A.win, $(A, '#nexo-find .find-close')); await sleep(300);
  r.a_cerrada = !$(A, '#nexo-find');
  r.a_para_gps = (gA.cleared || 0) >= 1;
  r.b_deja_de_verla = await wait(() => !/hacia el/.test(geoB()), 20);
  r.a_para_escaneo = await wait(() => !A.win.bleInterface.isScanning || Date.now() >= (nA.scanningUntil || 0), 5);
  click(B.win, $(B, '#nexo-find .find-close')); await sleep(200);
  // 4. en un grupo
  let gid = null;
  try { gid = A.win.bleInterface.groups.create('Amigos', [idB]).id; } catch (e) { r.grupo_error = String(e && e.message); }
  A.win.dispatchEvent(new A.win.CustomEvent('nexo:ble:closeChat', { detail: {} })); await sleep(300);
  A.win.bleInterface.renderContactsList(); await sleep(300);
  await openChatWith(A, 'Amigos');
  const gi = await menuItem(A, 'chat-find');
  r.grupo_opcion = !!gi && /Quién del grupo/.test(gi.textContent);
  click(A.win, gi);
  r.grupo_lista = await wait(() => Array.from(A.win.document.querySelectorAll('#nexo-find-group .find-grp-row')).some((x) => x.dataset.nx === idB && /Muy cerca/.test(x.textContent)), 15);
  r.errores = logs.filter((l) => / error: /.test(l) && !/JSDOMERROR|styles\.css|Not implemented/.test(l)).slice(0, 5);
  const ok = r.contactos && r.escondido_por_defecto && r.opcion_en_menu && r.pantalla && r.lejos && r.muy_cerca && r.acercando && r.sigue_escaneando && r.escaneos_pocos &&
    r.b_mensaje && r.b_te_buscan && r.b_vibra && r.b_busca_a_a && r.a_comparte && r.b_ve_distancia && r.b_flecha && r.nada_en_chats && r.sin_aviso_ubicacion &&
    r.a_cerrada && r.a_para_gps && r.b_deja_de_verla && r.a_para_escaneo && r.grupo_opcion && r.grupo_lista && !r.errores.length;
  r.resultado = ok ? 'OK' : 'FALLO';
  if (!ok) r.log = logs.filter((l) => /FIND|error/.test(l)).slice(-12);
  console.log('BUSCARCERCA ' + JSON.stringify(r));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('BUSCARCERCA ' + JSON.stringify({ prueba: 'buscarcerca', resultado: 'FALLO', error: String(e && e.stack) })); process.exit(1); });
