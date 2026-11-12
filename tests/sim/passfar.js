// 3024 (diagnóstico del vivo 12-11 07:12–07:13: cada ~minuto «Conectando con un NEXO anónimo (de paso)» con un teléfono a −92/−95 dBm
// que nunca conectaba: radio gastada para nada). Al buscar puente Jump hacia un contacto fuera de alcance (texto pendiente):
//  P1: con un NEXO a −95 dBm (lejísimos) no se intenta conectar de paso ni una vez.
//  P2: con un NEXO cercano que no llega a conectar, se espera cada vez más (1, 2, 4… min): pocos intentos en 4 min.
//  P3: «Agregar» no cambia (regla del dueño 11-11: todo NEXO cercano sale al instante): no se toca aquí.
// Uso: node passfar.js <dir_build>
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone, installWebCrypto } = require('./native_mock');
const { NostrRelay } = require('./nostr_relay');

const buildDir = path.resolve(process.argv[2]);
const opts = { readsContentFallback: true, retain: ['onPayloadReceived'], closeOnNoService: true, pace: [15, 15], ioDelay: 25, asymmetric: true };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
class DistLoader extends ResourceLoader {
  constructor(dir) { super(); this.dir = dir; }
  fetch(url) { const f = path.join(this.dir, decodeURIComponent(new URL(url).pathname)); return fs.existsSync(f) ? Promise.resolve(fs.readFileSync(f)) : Promise.reject(new Error('no existe ' + f)); }
}
const logs = [];
async function boot(name, native, relays) {
  native.listeners = new Map();
  const vc = new VirtualConsole();
  ['log', 'warn', 'error'].forEach((l) => vc.on(l, (...a) => logs.push(`${new Date().toISOString().substring(14, 23)} [${name}] ${l}: ` + a.map(String).join(' ').substring(0, 250))));
  const dom = new JSDOM(fs.readFileSync(path.join(buildDir, 'dist', 'index.html'), 'utf8'), {
    url: 'https://' + name.toLowerCase() + '.nexo.test/index.html', runScripts: 'dangerously',
    resources: new DistLoader(path.join(buildDir, 'dist')), pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) { win.NEXO_NET_RELAYS = relays; win.CapacitorCustomPlatform = { name: 'android' }; installWebCrypto(win); win.Capacitor = { Plugins: { NexoBLE: native.plugin() } }; win.HTMLElement.prototype.scrollTo = function () {}; },
  });
  const win = dom.window;
  for (let i = 0; i < 100 && !(win.NEXO && win.NEXO.initialized); i++) await sleep(100);
  await sleep(800);
  return { name, native, win };
}
const click = (win, el) => el && el.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
async function openChatWith(p, name) {
  let row; for (let i = 0; i < 100 && !row; i++) { row = Array.from(p.win.document.querySelectorAll('#main-contacts-list .ble-contact-row')).find((r) => (r.querySelector('.ble-contact-name') || {}).textContent === name); if (!row) await sleep(100); }
  click(p.win, row); await sleep(600); return !!row;
}
async function closeChat(p) { p.win.dispatchEvent(new p.win.CustomEvent('nexo:ble:closeChat', { detail: {} })); await sleep(300); }
async function sendText(p, t) { const i = p.win.document.getElementById('message-input'); i.value = t; i.dispatchEvent(new p.win.Event('input', { bubbles: true })); click(p.win, p.win.document.getElementById('send-btn')); }
async function addFound(p, name) {
  let add = null;
  const find = () => { const row = Array.from(p.win.document.querySelectorAll('#ble-new-device > div')).find((d) => (d.querySelector('span') || {}).textContent === name); return row && row.querySelector('button'); };
  for (let i = 0; i < 400 && !add; i++) { await sleep(100); add = find(); if (!add && !p.win.bleInterface.isScanning) click(p.win, p.win.document.getElementById('ble-scan-btn')); }
  click(p.win, add); await sleep(2000);
  return !!add;
}
async function waitFor(fn, ms) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return Math.round((Date.now() - t0) / 100) / 10; await sleep(250); } return null; }
const statusOf = (p, msgId) => { const s = p.win.document.querySelector('.msg-status[data-msg-id="' + msgId + '"]'); const m = s && (s.className || '').match(/status-([a-z]+)/); return m ? m[1] : null; };

(async () => {
  const r = { prueba: 'passfar', build: path.basename(buildDir) };
  const radio = new Radio();
  const nat = {}, P = {};
  const mk = (n, i, extra) => { const h = n.repeat(2); nat[n] = new NativePhone(n, [h, h, h, h, h, '0' + (i + 1)].join(':'), Object.assign({}, opts, { noTor: true }, extra || {})); radio.add(nat[n]); nat[n].load(); };
  mk('A', 0); mk('C', 1); mk('E', 2, { rssi: -95, connectFails: true }); mk('F', 3, { rssi: -70, connectFails: true });
  P.A = await boot('A', nat.A, []); P.C = await boot('C', nat.C, []); P.E = await boot('E', nat.E, []); P.F = await boot('F', nat.F, []);
  const id = (n) => P[n].win.bleInterface.localNexoId.toLowerCase();
  // A y C se conocen; luego C queda fuera de alcance de A con un texto pendiente
  radio.block(nat.A, nat.E); radio.block(nat.A, nat.F);
  P.A.win.bleInterface.togglePanel(); const ok = await addFound(P.A, 'C'); P.A.win.bleInterface.togglePanel();
  await openChatWith(P.A, 'C'); await sendText(P.A, 'hola C'); await sleep(3000);
  const keyOk = await waitFor(() => !!(P.A.win.vaultLoadContacts().find((c) => c.name === 'C') || {}).publicKey, 20000);
  if (!ok || keyOk === null) { console.log('PASSFAR ' + JSON.stringify({ prueba: 'passfar', resultado: 'FALLO', error: 'no empareja' })); process.exit(1); }
  radio.unblock(nat.A, nat.E); radio.unblock(nat.A, nat.F);
  radio.block(nat.A, nat.C);
  await sleep(1500);
  await sendText(P.A, 'pendiente para C');
  const e0 = nat.E.stats.connectsIn || 0, f0 = nat.F.stats.connectsIn || 0;
  await sleep(240000);
  r.intentos_a_E_lejano = (nat.E.stats.connectsIn || 0) - e0;
  r.intentos_a_F_que_no_conecta = (nat.F.stats.connectsIn || 0) - f0;
  r.P1_lejano_ni_una = r.intentos_a_E_lejano === 0;
  r.P2_espera_creciente = r.intentos_a_F_que_no_conecta <= 3;
  r.errores = logs.filter((l) => / error: /.test(l) && !/JSDOMERROR|styles\.css|Not implemented/.test(l)).slice(0, 3);
  const okAll = r.P1_lejano_ni_una && r.P2_espera_creciente && !r.errores.length;
  r.resultado = okAll ? 'OK' : 'FALLO';
  console.log('PASSFAR ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_passfar.txt'), logs.join('\n'));
  process.exit(okAll ? 0 : 1);
})().catch((e) => { console.log('PASSFAR {"prueba":"passfar","resultado":"FALLO","error":"' + String(e && e.message).replace(/"/g, "'") + '"}'); console.error(e && e.stack); fs.writeFileSync(path.join(__dirname, 'last_logs_passfar.txt'), logs.join('\n')); process.exit(1); });
