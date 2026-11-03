// Fondo de pantalla (ronda 2889, pedido del dueño 02-11). Dos fondos locales elegidos en Ajustes:
//   • Lista de contactos (nexo_wp_list.json)   • Chats (nexo_wp_chat.json)
// Se guardan cifrados (plugin saveToFile) y se pintan en #app; al entrar a un chat se pone el de chats y al salir el
// de la lista, de forma INDEPENDIENTE (poner uno no borra el otro). Sin fondo, #app queda negro liso (como antes).
//
// Comprueba, booteando la app de verdad en jsdom (un solo teléfono, sin red):
//   (1) arranque: un fondo guardado en disco se carga y se pinta al abrir la app (round-trip)
//   (2) lista: setListWallpaper lo pinta; (3) al abrir chat cambia al de chats (que está vacío → nada)
//   (4) setChatWallpaper lo pinta; (5) al volver a la lista vuelve el de la lista (independientes)
//   (6) se guarda en el archivo correcto; (7) rechaza lo que no es imagen o es enorme; (8) quitar deja todo limpio
// La selección (qué foto va en cada pantalla) se comprueba con window.wallpaperApplied() — determinista, sin depender
// de cómo jsdom parsea el CSS del degradado. Uso: node fondo.js <dir_build>
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone } = require('./native_mock');

const buildDir = path.resolve(process.argv[2]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
class DL extends ResourceLoader { constructor(d) { super(); this.d = d; } fetch(u) { const f = path.join(this.d, decodeURIComponent(new URL(u).pathname)); return fs.existsSync(f) ? Promise.resolve(fs.readFileSync(f)) : Promise.reject(new Error('x')); } }
const logs = [];
async function boot(name, native) {
  const vc = new VirtualConsole();
  ['log', 'warn', 'error'].forEach((l) => vc.on(l, (...a) => logs.push(`[${name}] ${l}: ` + a.map(String).join(' ').substring(0, 200))));
  const dom = new JSDOM(fs.readFileSync(path.join(buildDir, 'dist', 'index.html'), 'utf8'), {
    url: 'https://' + name.toLowerCase() + '.nexo.test/index.html', runScripts: 'dangerously', resources: new DL(path.join(buildDir, 'dist')), pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) { win.CapacitorCustomPlatform = { name: 'android' }; require('./native_mock').installWebCrypto(win); win.Capacitor = { Plugins: { NexoBLE: native.plugin() } }; win.HTMLElement.prototype.scrollTo = function () {}; },
  });
  const win = dom.window;
  for (let i = 0; i < 100 && !(win.NEXO && win.NEXO.initialized); i++) await sleep(100);
  await sleep(800);
  return { name, native, win };
}
const bgOf = (win) => { try { return (win.document.getElementById('app').style.backgroundImage || ''); } catch (e) { return ''; } };

(async () => {
  const SEED = 'data:image/jpeg;base64,SEEDaaaa==';
  const URL1 = 'data:image/png;base64,LISTxxxx=';
  const URL2 = 'data:image/webp;base64,CHATyyyy=';

  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', { wifi: 'casa', ioDelay: 5 });
  radio.add(nA); nA.load();
  // (1) sembrar un fondo de lista en disco ANTES de arrancar → debe cargarse y pintarse al iniciar
  nA.files.set('nexo_wp_list.json', JSON.stringify({ img: SEED }));

  const A = await boot('A', nA);
  const w = A.win;
  const r = { build: path.basename(buildDir) };

  // (1) round-trip de arranque
  for (let i = 0; i < 40 && w.wallpaperApplied() !== SEED; i++) await sleep(50);
  r.arranque_carga_guardado = w.wallpaperApplied() === SEED;

  // limpiar para empezar las pruebas en frío
  w.clearListWallpaper(); await sleep(20);
  r.limpio_inicio = w.wallpaperApplied() === '';

  // (2) lista
  const okL = w.setListWallpaper(URL1); await sleep(20);
  r.lista_pinta = okL === true && w.wallpaperApplied() === URL1;
  r.lista_dom = bgOf(w).indexOf('gradient') >= 0 || bgOf(w).indexOf('url') >= 0; // informativo (jsdom puede descartar el degradado)

  // (6) guardado en el archivo correcto
  await sleep(150);
  let savedL = null; try { savedL = JSON.parse(nA.files.get('nexo_wp_list.json') || '{}'); } catch (e) {}
  r.guarda_lista = !!savedL && savedL.img === URL1;

  // (3) abrir chat → fondo de chats (vacío) → nada pintado
  w.dispatchEvent(new w.CustomEvent('nexo:ble:openChat', { detail: { contactId: 'nxtest0001' } })); await sleep(50);
  r.en_chat_vacio = w.wallpaperApplied() === '';

  // (4) poner fondo de chats (estamos en vista chat) → se pinta
  const okC = w.setChatWallpaper(URL2); await sleep(20);
  r.chat_pinta = okC === true && w.wallpaperApplied() === URL2;
  await sleep(150);
  let savedC = null; try { savedC = JSON.parse(nA.files.get('nexo_wp_chat.json') || '{}'); } catch (e) {}
  r.guarda_chat = !!savedC && savedC.img === URL2;

  // (5) volver a la lista → vuelve el fondo de la lista (independiente del de chats)
  w.dispatchEvent(new w.CustomEvent('nexo:ble:closeChat', {})); await sleep(50);
  r.vuelve_lista = w.wallpaperApplied() === URL1;

  // (7) rechazar lo que no es imagen y lo enorme (y no cambiar lo pintado)
  const badType = w.setListWallpaper('data:text/plain;base64,AAAA');
  const tooBig = w.setListWallpaper('data:image/jpeg;base64,' + 'A'.repeat(1400001));
  await sleep(20);
  r.rechaza_no_imagen = badType === false;
  r.rechaza_enorme = tooBig === false;
  r.sigue_la_lista = w.wallpaperApplied() === URL1;

  // (8) quitar ambos → limpio y archivos a vacío
  w.clearListWallpaper(); w.clearChatWallpaper(); await sleep(150);
  r.limpia_lista = w.wallpaperApplied() === '';
  w.dispatchEvent(new w.CustomEvent('nexo:ble:openChat', { detail: { contactId: 'nxtest0001' } })); await sleep(50);
  r.limpia_chat = w.wallpaperApplied() === '';
  let clrL = null, clrC = null;
  try { clrL = JSON.parse(nA.files.get('nexo_wp_list.json') || '{}'); } catch (e) {}
  try { clrC = JSON.parse(nA.files.get('nexo_wp_chat.json') || '{}'); } catch (e) {}
  r.archivos_vacios = clrL && clrL.img === '' && clrC && clrC.img === '';

  r.errores = logs.filter((l) => / error: /.test(l) && !/JSDOMERROR|styles\.css|Not implemented|Could not load/.test(l)).slice(0, 5);
  const ok = r.arranque_carga_guardado && r.limpio_inicio && r.lista_pinta && r.guarda_lista && r.en_chat_vacio &&
    r.chat_pinta && r.guarda_chat && r.vuelve_lista && r.rechaza_no_imagen && r.rechaza_enorme && r.sigue_la_lista &&
    r.limpia_lista && r.limpia_chat && r.archivos_vacios && !r.errores.length;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('FONDO ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_fondo.txt'), logs.join('\n'));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error(e); fs.writeFileSync(path.join(__dirname, 'last_logs_fondo.txt'), logs.join('\n')); process.exit(1); });
