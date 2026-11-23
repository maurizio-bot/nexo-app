// Auditoría 23-11 (T-D1): una oferta de archivo GRANDE ('gq') de alguien que no es contacto se rechaza sin abrir canal (antes
// cualquiera cerca llenaba el disco: hasta 1,1 GB por oferta); de un contacto, una a la vez; un archivo ya recibido no se pisa.
// Uso: node bigstranger.js <dir_build>
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
  const names = ['A', 'B', 'M'];
  const nat = {}, P = {};
  const hx = { A: 'AA', B: 'BB', M: 'EE' };
  names.forEach((n, i) => { nat[n] = new NativePhone(n, Array(5).fill(hx[n]).join(':') + ':0' + (i + 1), opts); radio.add(nat[n]); nat[n].load(); });
  (await Promise.all(names.map((n) => boot(n, nat[n])))).forEach((p) => { P[p.name] = p; });
  const id = (n) => P[n].win.bleInterface.localNexoId;
  radio.block(nat.A, nat.M); radio.block(nat.B, nat.M);
  P.A.win.bleInterface.togglePanel(); const ok = await addFound(P.A, 'B'); P.A.win.bleInterface.togglePanel();
  await sleep(1500);
  const r = {};
  if (!ok) { console.log('BIGSTRANGER ' + JSON.stringify({ resultado: 'FALLO', error: 'no empareja' })); process.exit(0); }
  const bf = P.A.win.bleInterface.bigFiles;
  await sleep(500);
  bf.l2Ok = true;
  const idB = id('B').toLowerCase(), idM = id('M').toLowerCase();
  // 1. Un desconocido (M, no es contacto de A) ofrece un archivo grande: se rechaza sin abrir canal
  bf.handle({ type: 'gq', id: 'evil1', size: 500 * 1024 * 1024, via: 'l2', from: idM }, 'EE:EE:EE:EE:EE:03');
  await sleep(300);
  r.desconocido_rechazado = !bf.st.evil1;
  // 2. Un contacto: se acepta (abre canal)
  bf.handle({ type: 'gq', id: 'okB1', size: 30 * 1024 * 1024, via: 'l2', from: idB }, 'BB:BB:BB:BB:BB:02');
  await sleep(300);
  r.contacto_aceptado = !!(bf.st.okB1 && bf.st.okB1.state === 'receiving');
  // 3. Otra oferta del mismo contacto mientras recibe: ocupado
  bf.handle({ type: 'gq', id: 'okB2', size: 30 * 1024 * 1024, via: 'l2', from: idB }, 'BB:BB:BB:BB:BB:02');
  await sleep(300);
  r.segunda_a_la_vez_rechazada = !bf.st.okB2;
  // 4. Un id ya recibido no se vuelve a escribir
  bf.saved.yaGot = 'got';
  bf.handle({ type: 'gq', id: 'yaGot', size: 1024 * 1024, via: 'l2', from: idB }, 'BB:BB:BB:BB:BB:02');
  await sleep(300);
  r.recibido_no_se_pisa = !bf.st.yaGot;
  const okAll = r.desconocido_rechazado && r.contacto_aceptado && r.segunda_a_la_vez_rechazada && r.recibido_no_se_pisa;
  r.resultado = okAll ? 'OK' : 'FALLO';
  console.log('BIGSTRANGER ' + JSON.stringify(r));
  if (!okAll) console.log(logs.filter((l) => /BIG|L2/.test(l)).slice(-30).join('\n'));
  process.exit(0);
})().catch((e) => { console.log('BIGSTRANGER ' + JSON.stringify({ resultado: 'FALLO', error: String(e && e.message) })); process.exit(1); });
