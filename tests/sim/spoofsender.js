// Auditoría 23-11 (G-F1): M, contacto de A con su propia sesión cifrada, manda un mensaje con `from` = M pero
// `payload.senderNexoId` = B. A NO debe guardarlo en el chat de B ni atribuírselo (antes sí: cualquier contacto escribía
// como otro, y en grupos saltaba los permisos). Un mensaje normal de M sigue llegando.
// Uso: node spoofsender.js <dir_build>
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
  // Direcciones con dígitos hexadecimales (M no lo es: su dirección es EE:…)
  const hx = { A: 'AA', B: 'BB', M: 'EE' };
  names.forEach((n, i) => { nat[n] = new NativePhone(n, Array(5).fill(hx[n]).join(':') + ':0' + (i + 1), opts); radio.add(nat[n]); nat[n].load(); });
  (await Promise.all(names.map((n) => boot(n, nat[n])))).forEach((p) => { P[p.name] = p; });
  const id = (n) => P[n].win.bleInterface.localNexoId;
  async function pair(x, y) {
    const others = names.filter((n) => n !== x && n !== y);
    others.forEach((o) => radio.block(nat[x], nat[o]));
    P[x].win.bleInterface.togglePanel(); const ok = await addFound(P[x], y); P[x].win.bleInterface.togglePanel();
    await sleep(800);
    await openChatWith(P[x], y); await sendText(P[x], 'hola ' + y); await sleep(2500); await closeChat(P[x]);
    others.forEach((o) => radio.unblock(nat[x], nat[o]));
    return ok;
  }
  if (process.env.DBG) { const o = NativePhone.prototype._processReceivedChunk; NativePhone.prototype._processReceivedChunk = function (from, chunk, src) { if (/"type":"(kx|chat)"/.test(String(chunk)) || /MANDAME|hola/.test(String(chunk))) logs.push('AIR ' + from + '->' + this.name + ' ' + String(chunk).substring(0, 90)); return o.call(this, from, chunk, src); }; }
  if (process.env.DBG) { const oe = nat.M.emit.bind(nat.M); nat.M.emit = function (ev, d) { if (ev === 'onPayloadReceived') logs.push('MEMIT ' + String(d.content).substring(0, 50) + ' listeners=' + ((nat.M.listeners.get(ev) || []).length)); return oe(ev, d); }; }
  if (process.env.DBG) { const bi = P.M.win.bleInterface; const o = bi._prePayload.bind(bi); bi._prePayload = function (d) { const raw = String(d.content || d.data || ''); if (raw.indexOf('"kx"') >= 0) logs.push('MPRE kx ' + raw.substring(0, 60) + ' contactos=' + JSON.stringify(P.M.win.vaultLoadContacts().map((c) => c.nexoId))); return o(d); }; }
  if (!(await pair('A', 'B')) || !(await pair('M', 'A'))) { console.log('SPOOFSENDER ' + JSON.stringify({ resultado: 'FALLO', error: 'no empareja' })); process.exit(0); }
  const r = { build: path.basename(buildDir) };
  Object.keys(r).forEach((k) => delete r[k]);
  const idA = id('A'), idB = id('B'), idM = id('M');
  // M (contacto de A, con su propia sesión cifrada) escribe a A poniendo payload.senderNexoId = B; "from" sigue siendo M
  const bi = P.M.win.bleInterface, o = bi._chatEnv.bind(bi);
  bi._chatEnv = function (content, msgId, seq, dst) { const env = o(content, msgId, seq, dst); let e = typeof env === 'string' ? JSON.parse(env) : env; if (e && e.payload) { e.payload.senderNexoId = idB; e.payload.senderName = 'B'; } return typeof env === 'string' ? JSON.stringify(e) : e; };
  await openChatWith(P.M, 'A'); await sendText(P.M, 'SOY B (escrito por M)'); await sleep(7000);
  const inB = (await P.A.win.vaultLoadMessages(idB)).filter((m) => /escrito por M/.test(m.content || ''));
  const inM = (await P.A.win.vaultLoadMessages(idM)).filter((m) => /escrito por M/.test(m.content || ''));
  r.A_guarda_en_chat_de_B = inB.length; r.A_guarda_en_chat_de_M = inM.length;
  r.atribuido_a = inB[0] ? inB[0].senderNexoId : null; r.idB = idB; r.idM = idM;
  const cB = P.A.win.vaultLoadContacts().find((c) => c.nexoId.toLowerCase() === idB.toLowerCase()) || {};
  bi._chatEnv = o;
  await sendText(P.M, 'normal de M'); await sleep(5000);
  r.normal_de_M_llega = (await P.A.win.vaultLoadMessages(idM)).some((m) => /normal de M/.test(m.content || ''));
  const ok = r.A_guarda_en_chat_de_B === 0 && r.A_guarda_en_chat_de_M === 0 && r.normal_de_M_llega;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('SPOOFSENDER ' + JSON.stringify(r));
  if (!ok) console.log(logs.slice(-40).join('\n'));
  process.exit(0);
})().catch((e) => { console.error('FALLO:', e.stack); process.exit(1); });
