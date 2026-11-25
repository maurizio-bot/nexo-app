// Dueño 25-11: en la lista de chats, tocar la FOTO de un grupo la abre en grande (como la de un contacto; sin «Guardar en galería»).
// Uso: node grupofoto.js <dir_build>
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone, installWebCrypto } = require('./native_mock');

const buildDir = path.resolve(process.argv[2] || path.join(__dirname, 'builds/wip'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
class DL extends ResourceLoader { constructor(d) { super(); this.d = d; } fetch(u) { const f = path.join(this.d, decodeURIComponent(new URL(u).pathname)); return fs.existsSync(f) ? Promise.resolve(fs.readFileSync(f)) : Promise.reject(new Error('x')); } }
const logs = [];
(async () => {
  const r = { prueba: 'grupofoto', build: path.basename(buildDir) };
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', { readsContentFallback: true, retain: ['onPayloadReceived'] });
  radio.add(nA); nA.load();
  const vc = new VirtualConsole();
  ['log', 'warn', 'error'].forEach((l) => vc.on(l, (...a) => logs.push(`[A] ${l}: ` + a.map(String).join(' ').substring(0, 200))));
  const dom = new JSDOM(fs.readFileSync(path.join(buildDir, 'dist', 'index.html'), 'utf8'), {
    url: 'https://a.nexo.test/index.html', runScripts: 'dangerously', resources: new DL(path.join(buildDir, 'dist')), pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) { win.CapacitorCustomPlatform = { name: 'android' }; installWebCrypto(win); win.Capacitor = { Plugins: { NexoBLE: nA.plugin() } }; win.HTMLElement.prototype.scrollTo = function () {}; },
  });
  const win = dom.window;
  for (let i = 0; i < 100 && !(win.NEXO && win.NEXO.initialized); i++) await sleep(100);
  await sleep(500);
  const bi = win.bleInterface;
  // un grupo con foto (sin otros miembros: solo se mira la lista)
  const PH = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
  let gid = null;
  try { gid = bi.groups.create('Familia', ['nxaaaaaaaa']).id; } catch (e) { r.crear_error = String(e && e.message); }
  const oPhoto = win.NEXO_groupPhoto;
  win.NEXO_groupPhoto = (g) => (g === gid ? PH : (oPhoto ? oPhoto(g) : null));
  const opened = [];
  win.__nexoOpenMedia = (src, kind, noSave) => opened.push({ src, kind, noSave });
  if (typeof bi.renderContactsList === 'function') bi.renderContactsList(); else win.dispatchEvent(new win.CustomEvent('nexo:contacts:changed'));
  await sleep(600);
  const row = Array.from(win.document.querySelectorAll('#main-contacts-list .ble-contact-row')).find((rw) => (rw.querySelector('.ble-contact-name') || {}).textContent.indexOf('Familia') >= 0);

  r.fila_grupo = !!row;
  const av = row && row.querySelector('.ble-contact-avatar');
  r.con_foto = !!(av && /url\(/.test(av.style.backgroundImage || ''));
  if (av) av.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  await sleep(300);
  r.abre_foto = opened.length === 1 && opened[0].src === PH && opened[0].kind === 'image';
  r.sin_guardar = !!(opened[0] && opened[0].noSave);
  r.errores = logs.filter((l) => / error: /.test(l) && !/JSDOMERROR|styles\.css|Not implemented/.test(l)).slice(0, 5);
  const ok = r.fila_grupo && r.con_foto && r.abre_foto && r.sin_guardar && !r.errores.length;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('GRUPOFOTO ' + JSON.stringify(r));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('GRUPOFOTO ' + JSON.stringify({ prueba: 'grupofoto', resultado: 'FALLO', error: String(e && e.message) })); process.exit(1); });
