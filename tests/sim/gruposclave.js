// Auditoría 23-11 (G-K1): una clave «de oídas» (tarjeta o grupo) no sirve para aceptar un SALTO de estado de grupo, y si llega
// otra «de oídas» distinta para el mismo contacto queda en conflicto: no se cambia y no verifica estados hasta comprobar.
// Uso: node gruposclave.js <dir_build>
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone, installWebCrypto } = require('./native_mock');

const buildDir = path.resolve(process.argv[2]);
const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith('--' + k)); if (!a) return d; const v = a.split('=')[1]; return v === undefined ? true : Number(v); };
const opts = { readsContentFallback: true, retain: ['onPayloadReceived'], closeOnNoService: true, pace: [15, 15], ioDelay: arg('io-delay', 0), asymmetric: true };
const directLater = !!arg('direct-later', false);
const shared = !!arg('shared', false), chain = !!arg('chain', false), stranger = !!arg('stranger', false), lowBat = !!arg('low-battery', false);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
class DistLoader extends ResourceLoader {
  constructor(dir) { super(); this.dir = dir; }
  fetch(url) { const f = path.join(this.dir, decodeURIComponent(new URL(url).pathname)); return fs.existsSync(f) ? Promise.resolve(fs.readFileSync(f)) : Promise.reject(new Error('no existe ' + f)); }
}
// Lo que recibe cada teléfono por radio
const air = {};
const orig = NativePhone.prototype._processReceivedChunk;
NativePhone.prototype._processReceivedChunk = function (from, chunk, source) { (air[this.name] = air[this.name] || []).push(String(chunk)); return orig.call(this, from, chunk, source); };
const logs = [];
async function boot(name, native) {
  const vc = new VirtualConsole();
  ['log', 'warn', 'error'].forEach((l) => vc.on(l, (...a) => logs.push(`${new Date().toISOString().substring(14, 23)} [${name}] ${l}: ` + a.map(String).join(' ').substring(0, 250))));
  const dom = new JSDOM(fs.readFileSync(path.join(buildDir, 'dist', 'index.html'), 'utf8'), {
    url: 'https://' + name.toLowerCase() + '.nexo.test/index.html', runScripts: 'dangerously',
    resources: new DistLoader(path.join(buildDir, 'dist')), pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) { win.CapacitorCustomPlatform = { name: 'android' }; installWebCrypto(win); win.Capacitor = { Plugins: { NexoBLE: native.plugin() } }; win.HTMLElement.prototype.scrollTo = function () {}; },
  });
  const win = dom.window;
  for (let i = 0; i < 100 && !(win.NEXO && win.NEXO.initialized); i++) await sleep(100);
  await sleep(800);
  return { name, native, win };
}
const click = (win, el) => el && el.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
async function openChatWith(p, name) {
  const row = Array.from(p.win.document.querySelectorAll('#main-contacts-list .ble-contact-row')).find((r) => (r.querySelector('.ble-contact-name') || {}).textContent === name);
  click(p.win, row); await sleep(600); return !!row;
}
async function closeChat(p) { p.win.dispatchEvent(new p.win.CustomEvent('nexo:ble:closeChat', { detail: {} })); await sleep(300); }
async function sendText(p, t) { const i = p.win.document.getElementById('message-input'); i.value = t; i.dispatchEvent(new p.win.Event('input', { bubbles: true })); click(p.win, p.win.document.getElementById('send-btn')); }
// Pulsa el "+" de la fila del teléfono `name` en "dispositivos nuevos" (puede haber otros listados)
async function addFound(p, name) {
  let add = null;
  const find = () => { const row = Array.from(p.win.document.querySelectorAll('#ble-new-device > div')).find((d) => (d.querySelector('span') || {}).textContent === name); return row && row.querySelector('button'); };
  for (let i = 0; i < 400 && !add; i++) { await sleep(100); add = find(); if (!add && !p.win.bleInterface.isScanning) click(p.win, p.win.document.getElementById('ble-scan-btn')); }
  click(p.win, add); await sleep(2000);
  return !!add;
}
const status = (p, text) => { const el = Array.from(p.win.document.querySelectorAll('#messages-container .message.own')).find((m) => m.textContent.indexOf(text) >= 0); const s = el && el.querySelector('.msg-status'); return s ? s.className.replace('msg-status status-', '') : null; };
async function waitFor(fn, ms) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return Math.round((Date.now() - t0) / 100) / 10; await sleep(250); } return null; }

(async () => {
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', opts); radio.add(nA); nA.load();
  const A = await boot('A', nA);
  const bi = A.win.bleInterface, gs = bi.groups, r = {};
  // Dos claves P-256 válidas (formato de la app: base64 de 65 bytes)
  const mk = async () => { const k = await A.win.crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']); return Buffer.from(await A.win.crypto.subtle.exportKey('raw', k.publicKey)).toString('base64'); };
  const k1 = await mk(), k2 = await mk();
  const X = 'nx0xx11111', S1 = 'nx0ss11111', S2 = 'nx0ss22222';
  // 1. X llega «de oídas» (tarjeta de un grupo de S1): la clave se usa para mensajes, pero NO para un salto de grupo
  bi.addSharedContacts([{ nexoId: X.toUpperCase(), name: 'X', publicKey: k1 }], S1, { quiet: true });
  r.oidas_marcada = !!(A.win.vaultLoadContacts().find((c) => c.nexoId.toLowerCase() === X) || {}).pkHearsay;
  r.mensajes_con_clave = gs._keyOf(X) === k1;
  r.salto_sin_clave = gs._keyOf(X, false, true) === null;
  // 2. Otra tarjeta trae una clave DISTINTA de X: conflicto, no se cambia y no vale para estados de grupo
  bi.addSharedContacts([{ nexoId: X.toUpperCase(), name: 'X', publicKey: k2 }], S2, { quiet: true });
  const cX = A.win.vaultLoadContacts().find((c) => c.nexoId.toLowerCase() === X) || {};
  r.conflicto = !!cX.pkConflict; r.clave_no_cambia = cX.publicKey === k1;
  r.conflicto_no_verifica = gs._keyOf(X) === null;
  const ok = r.oidas_marcada && r.mensajes_con_clave && r.salto_sin_clave && r.conflicto && r.clave_no_cambia && r.conflicto_no_verifica;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('GRUPOSCLAVE ' + JSON.stringify(r));
  if (!ok) console.log(logs.slice(-30).join('\n'));
  process.exit(0);
})().catch((e) => { console.log('GRUPOSCLAVE ' + JSON.stringify({ resultado: 'FALLO', error: String(e && e.message) })); process.exit(1); });
