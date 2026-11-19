// 3251 (diagnóstico de Roberto/S24 19-11 08:09; 2.ª prueba Zhelowsky 17-11 16:34): al abrir la app con el Bluetooth recibiendo con la
// app cerrada, la instancia vieja del plugin cerraba su servidor GATT («GATT_SERVER Detenido») sin cortar los enlaces que los demás tenían
// abiertos a él. Esos enlaces seguían «conectados» del otro lado pero apuntaban al servidor viejo: sus escrituras fallaban ~6 s («Write
// fallo», MTU 23) y a los ~55 s salía un «zombi». Ahora endClosedMode los corta (cancelConnection) y el otro reconecta al servidor nuevo.
// A y B por Bluetooth (sin internet), A conectado de cliente al servidor de B; B cierra la app (sigue recibiendo) y la vuelve a abrir:
//  R1  A suelta el enlace viejo con B (≤ 3 s tras abrir B);
//  R2  un texto de A llega a B (≤ 15 s) sin «soltó un mensaje (muerto)» ni «zombi».
// Contraprueba --k3250 (Kotlin de antes en B): el enlace de A sigue «listo», el texto se suelta (muerto) y no llega en 15 s.
// Uso: node gattreabre.js <dir_build> [--k3250]
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone, installWebCrypto } = require('./native_mock');
const { NostrRelay } = require('./nostr_relay');

const buildDir = path.resolve(process.argv[2]);
const K3250 = process.argv.includes('--k3250');
const base = { readsContentFallback: true, retain: ['onPayloadReceived', 'onLanMessage', 'onLanUp', 'onLanDown'], closeOnNoService: true, pace: [15, 15], ioDelay: 25, asymmetric: true, noL2: true, noTor: true };
let RELAYS = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
class DistLoader extends ResourceLoader {
  constructor(dir) { super(); this.dir = dir; }
  fetch(url) { const f = path.join(this.dir, decodeURIComponent(new URL(url).pathname)); return fs.existsSync(f) ? Promise.resolve(fs.readFileSync(f)) : Promise.reject(new Error('no existe ' + f)); }
}
const logs = [];
async function boot(name, native) {
  native.listeners = new Map();
  native.btCalls = native.btCalls || [];
  const vc = new VirtualConsole();
  ['log', 'warn', 'error'].forEach((l) => vc.on(l, (...a) => logs.push(`${new Date().toISOString().substring(14, 23)} [${name}] ${l}: ` + a.map(String).join(' ').substring(0, 300))));
  const dom = new JSDOM(fs.readFileSync(path.join(buildDir, 'dist', 'index.html'), 'utf8'), {
    url: 'https://' + name.toLowerCase() + '.nexo.test/index.html', runScripts: 'dangerously',
    resources: new DistLoader(path.join(buildDir, 'dist')), pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) {
      win.NEXO_NET_RELAYS = RELAYS; win.CapacitorCustomPlatform = { name: 'android' }; installWebCrypto(win);
      const pl = native.plugin();
      // espía: toda llamada Bluetooth hacia un dispositivo (escritura de texto, trozo binario o conexión)
      ['sendMessage', 'sendBinary', 'connectToDevice'].forEach((k) => {
        const o = pl[k]; if (typeof o !== 'function') return;
        pl[k] = (a) => { try { native.btCalls.push({ t: Date.now(), k, id: String((a && (a.deviceId || a.address)) || ''), off: !!native.btOff }); } catch (e) {} return o(a); };
      });
      win.Capacitor = { Plugins: { NexoBLE: pl } }; win.HTMLElement.prototype.scrollTo = function () {};
    },
  });
  const win = dom.window;
  for (let i = 0; i < 1000 && !(win.NEXO && win.NEXO.initialized); i++) await sleep(10);
  await sleep(800);
  return { name, native, win };
}
const click = (win, el) => el && el.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
async function openChatWith(p, name) {
  const row = Array.from(p.win.document.querySelectorAll('#main-contacts-list .ble-contact-row')).find((r) => (r.querySelector('.ble-contact-name') || {}).textContent === name);
  click(p.win, row); await sleep(500); return !!row;
}
function sendText(p, t) { const i = p.win.document.getElementById('message-input'); i.value = t; i.dispatchEvent(new p.win.Event('input', { bubbles: true })); click(p.win, p.win.document.getElementById('send-btn')); }
function pickFile(p, name, b) {
  p.win.document.querySelector('.attach-menu-item[data-type="file"]').dispatchEvent(new p.win.MouseEvent('click', { bubbles: true }));
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
async function waitFor(fn, ms) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return Math.round((Date.now() - t0) / 100) / 10; await sleep(200); } return null; }
const has = (p, from, pred) => p.win.vaultLoadMessages(from).then((l) => l.some(pred));

(async () => {
  const r = { prueba: 'gattreabre', build: path.basename(buildDir), k3250: K3250 };
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', Object.assign({}, base)), nB = new NativePhone('B', 'BB:BB:BB:BB:BB:02', Object.assign({ kotlin3250: K3250 }, base));
  [nA, nB].forEach((n) => { radio.add(n); n.load(); });
  const A = await boot('A', nA); let B = await boot('B', nB);
  const idB = B.win.bleInterface.localNexoId.toLowerCase(), idA = A.win.bleInterface.localNexoId.toLowerCase();
  A.win.bleInterface.togglePanel(); const paired = await addFound(A, 'B'); A.win.bleInterface.togglePanel();
  if (!paired) { console.log('GATTREABRE ' + JSON.stringify({ prueba: 'gattreabre', resultado: 'FALLO', error: 'no empareja' })); process.exit(1); }
  await openChatWith(A, 'B'); sendText(A, 'hola B'); await sleep(3000);
  r.listo_antes = await waitFor(() => !!A.win.bleInterface._bleReadyFor(idB), 30000) !== null;
  r.llega_antes = await waitFor(() => has(B, idA, (m) => (m.content || m.text) === 'hola B'), 20000) !== null;
  r.A_cliente_de_B = nA.clients.has('bbbbbbbbbb02');
  // B cierra la app: su Bluetooth sigue recibiendo (closedMode)
  B.win.close(); nB.destroyActivity(); await sleep(3000);
  sendText(A, 'con B cerrada');
  r.cerrada_buzon = await waitFor(() => (nB.bgInbox || []).some((x) => /./.test(x.c || '')), 15000) !== null;
  await sleep(2000);
  const symptoms = [];
  A.win.addEventListener('nexo:diag:symptom', (e) => symptoms.push(e.detail && e.detail.kind));
  const logFrom = logs.length;
  // B abre la app: la instancia nueva releva a la vieja (takeOverFromClosed → endClosedMode)
  nB.load(); B = await boot('B', nB);
  const stale = () => { const cl = nA.clients.get('bbbbbbbbbb02'); return !!(cl && cl.stale); };
  r.R1_suelta_enlace_s = await waitFor(() => !stale() && !A.win.bleInterface._bleReadyFor(idB) || (!stale() && nA.clients.has('bbbbbbbbbb02') && nB.serverConnected.size > 0), 3000);
  sendText(A, 'tras abrir');
  r.R2_llega_s = await waitFor(() => has(B, idA, (m) => (m.content || m.text) === 'tras abrir'), 15000);
  await sleep(1000);
  const mine = logs.slice(logFrom).filter((l) => /\[A\]/.test(l));
  r.R2_muertos = mine.filter((l) => /soltó un mensaje \(muerto\)/.test(l)).length;
  r.R2_zombi = symptoms.filter((k) => k === 'zombi').length + mine.filter((l) => /sin respuesta a \d+ pings/.test(l)).length;
  r.escrituras_perdidas = nA.stats.staleWrites || 0;
  r.errores = logs.filter((l) => / error: /.test(l) && !/JSDOMERROR|styles\.css|Not implemented|GLOBAL TIMEOUT|Assembly timeout|net::ERR|fetch|WebSocket/.test(l)).slice(0, 5);
  const ok = r.listo_antes && r.llega_antes && r.R1_suelta_enlace_s !== null && r.R2_llega_s !== null && r.R2_muertos === 0 && r.R2_zombi === 0 && r.escrituras_perdidas === 0 && r.errores.length === 0;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('GATTREABRE ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_gattreabre.txt'), logs.join('\n'));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('GATTREABRE ' + JSON.stringify({ prueba: 'gattreabre', resultado: 'FALLO', error: String(e && e.message) })); console.error(e); fs.writeFileSync(path.join(__dirname, 'last_logs_gattreabre.txt'), logs.join('\n')); process.exit(1); });
