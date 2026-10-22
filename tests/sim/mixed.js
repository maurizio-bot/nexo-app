// Actualización a medias: A con la build nueva (cifra) y B todavía con una anterior (sin cifrado).
// Lo de A no debe salir en claro (queda pendiente, no fallido); lo de B debe llegar; al actualizarse B,
// el pendiente de A debe llegar cifrado.
// Uso: node mixed.js <dir_build_nueva> --old=<dir_build_anterior> [--io-delay=25]
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone, installWebCrypto } = require('./native_mock');

const buildDir = path.resolve(process.argv[2]);
const oldA = process.argv.find((x) => x.startsWith('--old='));
const oldDir = path.resolve(oldA.split('=')[1]);
const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith('--' + k)); if (!a) return d; const v = a.split('=')[1]; return v === undefined ? true : Number(v); };
const opts = { readsContentFallback: true, retain: ['onPayloadReceived'], closeOnNoService: true, pace: [15, 15], ioDelay: arg('io-delay', 0), asymmetric: true };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
class DistLoader extends ResourceLoader {
  constructor(dir) { super(); this.dir = dir; }
  fetch(url) { const f = path.join(this.dir, decodeURIComponent(new URL(url).pathname)); return fs.existsSync(f) ? Promise.resolve(fs.readFileSync(f)) : Promise.reject(new Error('no existe ' + f)); }
}
const air = [];
const orig = NativePhone.prototype._processReceivedChunk;
const airLog = [];
NativePhone.prototype._processReceivedChunk = function (from, chunk, source) { air.push(String(chunk)); airLog.push(Date.now() + ' ' + from + '->' + this.name + (this.destroyed ? '(destr)' : '') + (this.serverUp === false ? '(srvdown)' : '') + ' ' + String(chunk).substring(0, 120)); return orig.call(this, from, chunk, source); };
const logs = [];
async function boot(name, native, dir) {
  dir = dir || buildDir;
  native.listeners = new Map();
  const vc = new VirtualConsole();
  ['log', 'warn', 'error'].forEach((l) => vc.on(l, (...a) => logs.push(`[${name}] ${l}: ` + a.map(String).join(' ').substring(0, 250))));
  const dom = new JSDOM(fs.readFileSync(path.join(dir, 'dist', 'index.html'), 'utf8'), {
    url: 'https://' + name.toLowerCase() + '.nexo.test/index.html', runScripts: 'dangerously',
    resources: new DistLoader(path.join(dir, 'dist')), pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) { win.CapacitorCustomPlatform = { name: 'android' }; installWebCrypto(win); win.Capacitor = { Plugins: { NexoBLE: native.plugin() } }; win.HTMLElement.prototype.scrollTo = function () {}; },
  });
  const win = dom.window;
  for (let i = 0; i < 100 && !(win.NEXO && win.NEXO.initialized); i++) await sleep(100);
  await sleep(800);
  return { name, native, win };
}
const click = (win, el) => el && el.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
async function openChat(p) { click(p.win, p.win.document.querySelector('#main-contacts-list .ble-contact-row')); await sleep(500); }
async function sendText(p, t) { const i = p.win.document.getElementById('message-input'); i.value = t; i.dispatchEvent(new p.win.Event('input', { bubbles: true })); click(p.win, p.win.document.getElementById('send-btn')); }
const ownStatus = (p, t) => { const el = Array.from(p.win.document.querySelectorAll('#messages-container .message.own')).find((m) => m.textContent.indexOf(t) >= 0); const s = el && el.querySelector('.msg-status'); return s ? s.className.replace('msg-status status-', '') : null; };

(async () => {
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', opts), nB = new NativePhone('B', 'BB:BB:BB:BB:BB:02', opts);
  radio.add(nA); radio.add(nB); nA.load(); nB.load();
  let [A, B] = await Promise.all([boot('A', nA), boot('B', nB, oldDir)]);
  const r = { A: path.basename(buildDir), B_antes: path.basename(oldDir) };
  A.win.bleInterface.togglePanel();
  let add = null;
  for (let i = 0; i < 400 && !add; i++) { await sleep(100); add = A.win.document.querySelector('#ble-new-device button'); if (!add && !A.win.bleInterface.isScanning) click(A.win, A.win.document.getElementById('ble-scan-btn')); }
  if (!add) { console.log('MIXED ' + JSON.stringify({ error: 'no empareja' })); process.exit(0); }
  click(A.win, add); await sleep(2500);
  A.win.bleInterface.togglePanel();
  await openChat(A);
  const idA = A.win.bleInterface.localNexoId;
  await sendText(A, 'SECRETO-a-viejo'); await sleep(9000);
  r.estado_A_con_B_viejo = ownStatus(A, 'SECRETO-a-viejo');
  r.en_claro_en_el_aire = air.join('\n').indexOf('SECRETO-a-viejo') >= 0;
  r.llega_a_B_viejo = (await B.win.vaultLoadMessages(idA)).some((m) => m.content === 'SECRETO-a-viejo');
  await openChat(B); await sendText(B, 'hola desde B viejo'); await sleep(4000);
  r.A_recibe_de_B_viejo = (await A.win.vaultLoadMessages(B.win.bleInterface.localNexoId)).some((m) => m.content === 'hola desde B viejo');
  // Paquetes nuevos (kx, rutas de jump) que la build vieja no conoce no deben aparecer como mensajes
  await sleep(35000);
  const junk = (await B.win.vaultLoadMessages(idA)).filter((m) => /"type":"(kx|rt|rk)"|"v":1/.test(m.content || ''));
  r.basura_en_B_viejo = junk.map((m) => (m.content || '').substring(0, 40));
  r.burbujas_basura_B_viejo = Array.from(B.win.document.querySelectorAll('#messages-container .message')).filter((m) => /"type":"|"v":1/.test(m.textContent)).length;
  // B se actualiza (mismos archivos, build nueva)
  B.win.close(); nB.destroyActivity(); await sleep(2000);
  nB.load(); B = await boot('B', nB); await sleep(25000);
  r.llega_tras_actualizar_B = (await B.win.vaultLoadMessages(idA)).some((m) => m.content === 'SECRETO-a-viejo');
  r.estado_A_final = ownStatus(A, 'SECRETO-a-viejo');
  r.en_claro_en_el_aire_final = air.join('\n').indexOf('SECRETO-a-viejo') >= 0;
  r.paquetes_cifrados = air.filter((x) => x.indexOf('E1:') >= 0).length;
  console.log('MIXED ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_mixed.txt'), logs.join('\n'));
  if (process.env.AIR) fs.writeFileSync(process.env.AIR, airLog.join('\n'));
  process.exit(0);
})().catch((e) => { console.error('FALLO:', e.stack); fs.writeFileSync(path.join(__dirname, 'last_logs_mixed.txt'), logs.join('\n')); process.exit(1); });
