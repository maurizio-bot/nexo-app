// Dueño 13-11 — COMPARTIR PANTALLA parte 2 (llamada de GRUPO): la pantalla de la llamada de grupo con una llamada de prueba.
//   1. con la llamada activa hay botón «Pantalla»; al tocarlo, el aviso (se verá todo, también las notificaciones) y
//      «Compartir» llama a shareScreen(true);
//   2. mientras comparto: barra roja «Compartiendo tu pantalla · Detener» (tocarla para) y el botón dice «Detener»;
//   3. la pantalla de otro participante se ve GRANDE, entera (object-fit: contain) y con «Pantalla de …»; al dejar de
//      compartir vuelve a ser una baldosa normal.
// Contraprueba 3047: sin botón ni baldosa de pantalla.
// Uso: node gscreenui.js <dir_build>
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone, installWebCrypto } = require('./native_mock');

const buildDir = path.resolve(process.argv[2]);
const base = { readsContentFallback: true, retain: ['onPayloadReceived'], closeOnNoService: true, pace: [15, 15], ioDelay: 25, asymmetric: true, noL2: true, noTor: true };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
class DL extends ResourceLoader { constructor(d) { super(); this.d = d; } fetch(u) { const f = path.join(this.d, decodeURIComponent(new URL(u).pathname)); return fs.existsSync(f) ? Promise.resolve(fs.readFileSync(f)) : Promise.reject(new Error('x')); } }
const logs = [];
const T0 = Date.now();
const ts = () => String(((Date.now() - T0) / 1000).toFixed(1)).padStart(6) + 's';
async function boot(name, native) {
  const vc = new VirtualConsole();
  ['log', 'warn', 'error'].forEach((l) => vc.on(l, (...a) => logs.push(`${ts()} [${name}] ${l}: ` + a.map(String).join(' ').substring(0, 250))));
  const dom = new JSDOM(fs.readFileSync(path.join(buildDir, 'dist', 'index.html'), 'utf8'), {
    url: 'https://' + name.toLowerCase() + '.nexo.test/index.html', runScripts: 'dangerously', resources: new DL(path.join(buildDir, 'dist')), pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) { win.CapacitorCustomPlatform = { name: 'android' }; installWebCrypto(win); win.Capacitor = { Plugins: { NexoBLE: native.plugin() } }; win.HTMLElement.prototype.scrollTo = function () {}; },
  });
  const win = dom.window;
  for (let i = 0; i < 100 && !(win.NEXO && win.NEXO.initialized); i++) await sleep(100);
  await sleep(800);
  return { name, native, win };
}
const click = (w, el) => el && el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
async function openChatWith(p, name) {
  let row; for (let i = 0; i < 300 && !row; i++) { row = Array.from(p.win.document.querySelectorAll('#main-contacts-list .ble-contact-row')).find((r) => (r.querySelector('.ble-contact-name') || {}).textContent === name); if (!row) await sleep(100); }
  click(p.win, row); await sleep(400); return !!row;
}
function sendText(p, t) { const i = p.win.document.getElementById('message-input'); i.value = t; i.dispatchEvent(new p.win.Event('input', { bubbles: true })); click(p.win, p.win.document.getElementById('send-btn')); }
async function addFound(p, name) {
  let add = null;
  const find = () => { const row = Array.from(p.win.document.querySelectorAll('#ble-new-device > div')).find((d) => (d.querySelector('span') || {}).textContent === name); return row && row.querySelector('button'); };
  for (let i = 0; i < 400 && !add; i++) { await sleep(100); add = find(); if (!add && !p.win.bleInterface.isScanning) click(p.win, p.win.document.getElementById('ble-scan-btn')); }
  click(p.win, add); await sleep(2000);
  return !!add;
}
async function waitFor(fn, ms) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return Math.round((Date.now() - t0) / 100) / 10; await sleep(200); } return null; }

(async () => {
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', Object.assign({}, base));
  radio.add(nA); nA.load();
  const A = await boot('A', nA);
  const r = { prueba: 'gscreenui', build: path.basename(buildDir) };
  const w = A.win, d = w.document, B = 'nxb0000002';
  const canvas = d.createElement('canvas');
  const calls = [];
  const st = { gid: 'gcprueba01', dir: 'out', state: 'active', video: true, cameraOn: false, muted: false, screen: false, members: [B], chatId: '',
    legs: [{ nx: B, state: 'active', talking: false, reconnecting: false, peerScreen: true }] };
  w.bleInterface.gcall = {
    state() { return JSON.parse(JSON.stringify(st)); },
    shareScreen(on) { calls.push(on); st.screen = !!on; return Promise.resolve(true); },
    remoteVideoEl(nx) { return nx === B ? canvas : null; }, localVideoEl() { return null; },
    mute() {}, camera() {}, hangup() {}, addMember() { return Promise.resolve(); }, flip() {},
  };
  const emit = () => w.dispatchEvent(new w.CustomEvent('nexo:gcall', { detail: JSON.parse(JSON.stringify(st)) }));
  const btnOf = (txt) => Array.from(d.querySelectorAll('#nexo-gcall-screen .gc-buttons button')).find((b) => b.textContent === txt);
  emit(); await sleep(200);
  // 3. la pantalla del otro: grande, entera y con su nombre
  const tile = d.querySelector('#nexo-gcall-screen .gc-tile[data-nx="' + B + '"]');
  r.baldosa_pantalla = !!tile && tile.classList.contains('gc-tile-screen') && /contain/.test(canvas.style.cssText) && !/scaleX\(-1\)/.test(canvas.style.cssText);
  r.etiqueta = tile ? (tile.querySelector('.gc-tile-lab') || {}).textContent : null;
  // 1. botón «Pantalla» → aviso → «Compartir»
  const bp = btnOf('Pantalla');
  r.boton_pantalla = !!bp;
  if (bp) bp.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await sleep(100);
  const ask = d.getElementById('nexo-gscr-ask');
  r.aviso = !!ask && /notificaciones/.test(ask.textContent);
  const yes = ask && ask.querySelector('.gc-ask-yes');
  if (yes) yes.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await sleep(100);
  r.compartir_llama = calls[0] === true && !d.getElementById('nexo-gscr-ask');
  // 2. mientras comparto: barra roja y «Detener»
  emit(); await sleep(150);
  const bar = d.querySelector('#nexo-gcall-screen .gc-scrbar');
  r.barra_roja = !!bar && /Compartiendo tu pantalla/.test(bar.textContent);
  r.boton_detener = !!btnOf('Detener');
  if (bar) bar.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await sleep(100);
  r.barra_detiene = calls[1] === false;
  emit(); await sleep(150);
  r.barra_se_va = !d.querySelector('#nexo-gcall-screen .gc-scrbar');
  // el otro deja de compartir: vuelve a baldosa normal (recortada para llenar)
  st.legs[0].peerScreen = false; emit(); await sleep(150);
  const tile2 = d.querySelector('#nexo-gcall-screen .gc-tile[data-nx="' + B + '"]');
  r.vuelve_normal = !!tile2 && !tile2.classList.contains('gc-tile-screen') && /cover/.test(canvas.style.cssText);
  r.errores = logs.filter((l) => / error: /.test(l) && !/JSDOMERROR|styles\.css|Not implemented|GLOBAL TIMEOUT|net::ERR|fetch/.test(l)).slice(0, 5);
  const ok = r.baldosa_pantalla && /^Pantalla de /.test(r.etiqueta || '') && r.boton_pantalla && r.aviso && r.compartir_llama && r.barra_roja && r.boton_detener &&
    r.barra_detiene && r.barra_se_va && r.vuelve_normal && !r.errores.length;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('GSCREENUI ' + JSON.stringify(r));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('GSCREENUI ' + JSON.stringify({ prueba: 'gscreenui', resultado: 'FALLO', error: String(e && e.message).replace(/"/g, "'") })); console.error(e && e.stack); process.exit(1); });
