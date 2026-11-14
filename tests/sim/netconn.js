// 3075 (diagnóstico S24 14-11 19:14, build 3047): al volver la app al frente, el repaso de pendientes («Flush global pending»)
// pedía al Bluetooth nativo CONECTAR a contactos cuyo camino guardado es de internet o de Wi-Fi («net:nx…», «lan:nx…»): 14
// «connectToDevice raw='net:nx…'» seguidos, un enlace fantasma en «conectando» y, con el realme, un «zombi» falso de ese enlace
// (pings sin respuesta → desconectar/reconectar un Bluetooth que no existe). 3072 tapó dos puertas (abrir el chat y el envío);
// quedaba la de la auto-conexión, por donde pasa el repaso. Ahora la propia auto-conexión no pide Bluetooth para esos caminos.
// A y B emparejados por Bluetooth; B se aleja; A deja un texto pendiente; el camino guardado de B en A pasa a «net:nx…»:
//  N1  el repaso de pendientes NO pide al nativo conectar a «net:…» (ni a «lan:…»);
//  N2  ni deja un enlace fantasma «conectando» con ese camino;
//  N3  el texto sigue pendiente (no ✗).
// Uso: node netconn.js <dir_build>
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone, installWebCrypto } = require('./native_mock');
const { NostrRelay } = require('./nostr_relay');
const { importSrc } = require('./srcmod');

const buildDir = path.resolve(process.argv[2] || path.join(__dirname, 'builds/wip'));
const SIN_PONG = false;
const base = { noNativePong: SIN_PONG, readsContentFallback: true, retain: ['onPayloadReceived', 'onLanMessage', 'onLanUp', 'onLanDown'], closeOnNoService: true, pace: [15, 15], ioDelay: 25, asymmetric: true, noTor: true };
let RELAYS = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
class DL extends ResourceLoader { constructor(d) { super(); this.d = d; } fetch(u) { const f = path.join(this.d, decodeURIComponent(new URL(u).pathname)); return fs.existsSync(f) ? Promise.resolve(fs.readFileSync(f)) : Promise.reject(new Error('x')); } }
const logs = [];
const T0 = Date.now();
const ts = () => String(((Date.now() - T0) / 1000).toFixed(1)).padStart(6) + 's';
function instrument(native, pl, who) {
  native.calls = { push() {}, length: 0, filter() { return []; }, slice() { return []; }, forEach() {}, map() { return []; }, some() { return false; }, find() { return undefined; } };
  native.connLog = [];
  const oC = pl.connectToDevice;
  pl.connectToDevice = (a) => { native.connLog.push(String((a && (a.deviceId || a.address)) || '')); return oC(a); };
}
async function boot(name, native) {
  native.listeners = new Map();
  const vc = new VirtualConsole();
  ['log', 'warn', 'error'].forEach((l) => vc.on(l, (...a) => logs.push(`${ts()} [${name}] ${l}: ` + a.map(String).join(' ').substring(0, 260))));
  const dom = new JSDOM(fs.readFileSync(path.join(buildDir, 'dist', 'index.html'), 'utf8'), {
    url: 'https://' + name.toLowerCase() + '.nexo.test/index.html', runScripts: 'dangerously', resources: new DL(path.join(buildDir, 'dist')), pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) {
      win.NEXO_NET_RELAYS = RELAYS; win.CapacitorCustomPlatform = { name: 'android' }; installWebCrypto(win);
      const pl = native.plugin(); instrument(native, pl, name);
      win.Capacitor = { Plugins: { NexoBLE: pl } }; win.HTMLElement.prototype.scrollTo = function () {};
    },
  });
  const win = dom.window;
  for (let i = 0; i < 100 && !(win.NEXO && win.NEXO.initialized); i++) await sleep(100);
  await sleep(800);
  return { name, native, win };
}
const click = (win, el) => el && el.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
async function openChatWith(p, name) {
  let row; for (let i = 0; i < 200 && !row; i++) { row = Array.from(p.win.document.querySelectorAll('#main-contacts-list .ble-contact-row')).find((r) => (r.querySelector('.ble-contact-name') || {}).textContent === name); if (!row) await sleep(100); }
  click(p.win, row); await sleep(500); return !!row;
}
function sendText(p, t) { const i = p.win.document.getElementById('message-input'); i.value = t; i.dispatchEvent(new p.win.Event('input', { bubbles: true })); click(p.win, p.win.document.getElementById('send-btn')); }
function pickFile(p, name, b) {
  click(p.win, p.win.document.querySelector('.attach-menu-item[data-type="file"]'));
  const fin = Array.from(p.win.document.querySelectorAll('input[type=file]')).pop();
  Object.defineProperty(fin, 'files', { configurable: true, value: [new p.win.File([b], name, { type: 'application/octet-stream' })] });
  fin.dispatchEvent(new p.win.Event('change'));
}
async function addFound(p, name) {
  let add = null;
  const find = () => { const row = Array.from(p.win.document.querySelectorAll('#ble-new-device > div')).find((d) => (d.querySelector('span') || {}).textContent === name); return row && row.querySelector('button'); };
  for (let i = 0; i < 400 && !add; i++) { await sleep(100); add = find(); if (!add && !p.win.bleInterface.isScanning) click(p.win, p.win.document.getElementById('ble-scan-btn')); }
  click(p.win, add); await sleep(2000);
  return !!add;
}




async function waitFor(fn, ms) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return Math.round((Date.now() - t0) / 100) / 10; await sleep(250); } return null; }
(async () => {
  const r = { prueba: 'netconn', build: path.basename(buildDir) };
  RELAYS = [];
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', Object.assign({}, base, { wifi: null })), nB = new NativePhone('B', 'BB:BB:BB:BB:BB:02', Object.assign({}, base, { wifi: null }));
  [nA, nB].forEach((n) => { radio.add(n); n.load(); });
  const A = await boot('A', nA); const B = await boot('B', nB);
  const idB = B.win.bleInterface.localNexoId.toLowerCase();
  A.win.bleInterface.togglePanel(); const paired = await addFound(A, 'B'); A.win.bleInterface.togglePanel();
  if (!paired) { console.log('NETCONN ' + JSON.stringify(Object.assign(r, { resultado: 'FALLO', error: 'no empareja' }))); process.exit(1); }
  await openChatWith(A, 'B'); sendText(A, 'hola B'); await sleep(2000);
  await openChatWith(B, 'A'); sendText(B, 'hola A'); await sleep(3000);
  nB.setOffline(true); await sleep(3000);
  const t = 'pendiente mientras B no está';
  sendText(A, t); await sleep(4000);
  const st = async () => { const m = (await A.win.vaultLoadMessages(idB)).find((x) => x._own && x.content === t); return m ? m.status : null; };
  r.pendiente_antes = String(await st());
  const NETDEV = 'net:' + idB;
  const cs = A.win.vaultLoadContacts(); const cB = cs.find((c) => String(c.nexoId || c.deviceUUID || '').toLowerCase() === idB);
  if (cB) { cB.deviceId = NETDEV; A.win.vaultSaveContacts(cs); }
  r.camino_net_puesto = !!cB;
  nA.connLog.length = 0;
  A.win.bleInterface._flushAllPendingMessages(); await sleep(2500);
  r.conexiones_pedidas = nA.connLog.slice(0, 8);
  r.N1_pide_bt_a_net = nA.connLog.some((d) => /^(net|lan|wd):/i.test(d));
  const s = A.win.bleInterface._getDeviceState(NETDEV);
  r.N2_estado_net = (s && s.state) || null;
  r.N2_fantasma = !!(A.win.bleInterface.connectedDevices && A.win.bleInterface.connectedDevices.has(NETDEV)) || r.N2_estado_net === 'connecting';
  r.N3_estado_texto = String(await st());
  r.errores = logs.filter((l) => / error: /.test(l) && !/JSDOMERROR|styles\.css|Not implemented|GLOBAL TIMEOUT|net::ERR|fetch/.test(l)).slice(0, 5);
  const ok = r.camino_net_puesto && !r.N1_pide_bt_a_net && !r.N2_fantasma && !/failed/.test(r.N3_estado_texto) && r.N3_estado_texto !== 'null' && !r.errores.length;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('NETCONN ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_netconn.txt'), logs.join('\n'));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('NETCONN ' + JSON.stringify({ prueba: 'netconn', resultado: 'FALLO', error: String(e && e.message).replace(/"/g, "'") })); console.error(e && e.stack); fs.writeFileSync(path.join(__dirname, 'last_logs_netconn.txt'), logs.join('\n')); process.exit(1); });
