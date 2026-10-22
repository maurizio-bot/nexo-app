// Suplantación: M (otro teléfono NEXO) se hace pasar por B ante A (mismo NEXO ID, otra clave). A no debe
// mostrar su mensaje como de B ni enviarle nada cifrado a esa clave: queda retenido con aviso hasta que el
// usuario decida. Al rechazarla, lo pendiente sale al B real con la clave de siempre.
// Uso: node impostor.js <dir_build> [--io-delay=25]
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
  if (!(await pair('A', 'B')) || !(await pair('M', 'A'))) { console.log('IMPOSTOR ' + JSON.stringify({ error: 'no empareja' })); process.exit(0); }
  const r = { build: path.basename(buildDir) };
  if (process.env.DBG) { r.dbg_A_calls_a_M = nat.A.calls.filter((c) => c.name === 'sendMessage' && /mm/i.test(JSON.stringify(c.args))).map((c) => String(c.args.deviceId) + ' ' + String(c.args.message).substring(0, 40)); r.dbg_A_srv = Array.from(nat.A.serverConnected.keys()); r.dbg_A_notif = Array.from(nat.A.serverNotif.entries()); r.dbg_A_pend = Array.from(nat.A.pendingQueue.keys()); r.dbg_err = radio.trace.filter((t) => /ERROR entregando/.test(t)).slice(0, 2).map((t) => t.substring(0, 300)); r.dbg_qA = nat.A.writeQ ? Array.from(nat.A.writeQ.entries()).map(([k, q]) => k + ':' + q.items.length + ':' + q.busy) : null; r.dbg_M = { serverUp: nat.M.serverUp, offline: nat.M.offline, void: nat.M.stats.voidWrites, clients: Array.from(nat.M.clients.keys()), blocked: Array.from(radio.blocked) }; }
  const idA = id('A'), idB = id('B');
  const keyB = (P.A.win.vaultLoadContacts().find((c) => c.nexoId.toLowerCase() === idB.toLowerCase()) || {}).publicKey;
  r.A_tiene_clave_de_B = !!keyB;
  // M dice ser B
  radio.block(nat.B, nat.A); await sleep(1500);
  P.M.win.bleInterface.localNexoId = idB;
  await openChatWith(P.M, 'A'); await sendText(P.M, 'SOY B: MANDAME EL CODIGO'); await sleep(6000);
  const allA = [];
  for (const c of P.A.win.vaultLoadContacts()) (await P.A.win.vaultLoadMessages(c.nexoId)).forEach((m) => allA.push(m));
  r.A_muestra_mensaje_del_impostor = allA.some((m) => /MANDAME/.test(m.content || ''));
  const cB = P.A.win.vaultLoadContacts().find((c) => c.nexoId.toLowerCase() === idB.toLowerCase()) || {};
  r.clave_de_B_intacta = cB.publicKey === keyB;
  r.clave_impostor_pendiente = !!cB.pendingKey && cB.pendingKey !== keyB;
  r.retenidos_en_A = P.A.win.bleInterface.heldCount(idB);
  // A escribe a "B": no debe salir cifrado para la clave nueva
  await openChatWith(P.A, 'B');
  r.aviso = ((P.A.win.document.querySelector('#e2e-banner .e2e-text') || {}).textContent || '').substring(0, 60);
  await sendText(P.A, 'hola B real'); await sleep(6000);
  const mGot = [];
  for (const c of P.M.win.vaultLoadContacts()) (await P.M.win.vaultLoadMessages(c.nexoId)).forEach((m) => mGot.push(m));
  r.impostor_recibe_algo = mGot.some((m) => m.content === 'hola B real');
  // A rechaza la clave nueva; el B real vuelve a estar cerca
  click(P.A.win, P.A.win.document.querySelector('#e2e-banner .e2e-reject'));
  P.M.win.bleInterface.localNexoId = id('M') === idB ? P.M.native.advertisingId : P.M.win.bleInterface.localNexoId;
  radio.block(nat.M, nat.A);
  radio.unblock(nat.B, nat.A);
  const t1 = Date.now(); let ok = false;
  while (!ok && Date.now() - t1 < 90000) { await sleep(500); ok = (await P.B.win.vaultLoadMessages(idA)).some((m) => m.content === 'hola B real'); }
  r.B_real_recibe_tras_rechazar_s = ok ? Math.round((Date.now() - t1) / 100) / 10 : null;
  const cB2 = P.A.win.vaultLoadContacts().find((c) => c.nexoId.toLowerCase() === idB.toLowerCase()) || {};
  r.tras_rechazar = { clave_de_siempre: cB2.publicKey === keyB, pendiente: !!cB2.pendingKey, retenidos: P.A.win.bleInterface.heldCount(idB) };
  r.errores = logs.filter((l) => / error: /.test(l)).slice(0, 5);
  console.log('IMPOSTOR ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_impostor.txt'), logs.join('\n'));
  process.exit(0);
})().catch((e) => { console.error('FALLO:', e.stack); fs.writeFileSync(path.join(__dirname, 'last_logs_impostor.txt'), logs.join('\n')); process.exit(1); });
