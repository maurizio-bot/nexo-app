// 3263 (PRIORIDAD 1, fase 2 — GattServerHost): el servidor GATT es UNO por proceso y no se cierra al abrir la app. Antes (3251) abrir
// NEXO cortaba TODOS los enlaces que los contactos cercanos tenían con este teléfono (reconectaban en 1–3 s, o quedaban a medias).
// A y B por Bluetooth (sin internet), A conectado de cliente al servidor de B; B cierra la app (sigue recibiendo) y la vuelve a abrir:
//  F1  A NO pierde su enlace con B (ni una desconexión, sigue «listo» todo el rato);
//  F2  la app nueva de B hereda ese enlace («Conexión existente recuperada») y sabe de quién es;
//  F3  un texto de A llega a B (≤ 5 s) y uno de B llega a A (≤ 10 s) por ese mismo enlace, sin «muerto», «zombi» ni escrituras perdidas.
// Contraprueba --k3262 (Kotlin de antes en B: cortaba al abrir): A pierde el enlace (F1 falla).
// Uso: node gattsigue.js <dir_build> [--k3262]
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone, installWebCrypto } = require('./native_mock');
const { NostrRelay } = require('./nostr_relay');

const buildDir = path.resolve(process.argv[2]);
const K3262 = process.argv.includes('--k3262');
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
  const r = { prueba: 'gattsigue', build: path.basename(buildDir), k3262: K3262 };
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', Object.assign({}, base)), nB = new NativePhone('B', 'BB:BB:BB:BB:BB:02', Object.assign({ kotlin3262: K3262 }, base));
  [nA, nB].forEach((n) => { radio.add(n); n.load(); });
  const A = await boot('A', nA); let B = await boot('B', nB);
  const idB = B.win.bleInterface.localNexoId.toLowerCase(), idA = A.win.bleInterface.localNexoId.toLowerCase();
  A.win.bleInterface.togglePanel(); const paired = await addFound(A, 'B'); A.win.bleInterface.togglePanel();
  if (!paired) { console.log('GATTSIGUE ' + JSON.stringify({ prueba: 'gattsigue', resultado: 'FALLO', error: 'no empareja' })); process.exit(1); }
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
  // B abre la app: la instancia nueva se engancha al MISMO servidor (takeOverFromClosed → adoptGattServer)
  let perdido = false;
  const watch = setInterval(() => { if (!nA.clients.has('bbbbbbbbbb02') || !A.win.bleInterface._bleReadyFor(idB)) perdido = true; }, 100);
  nB.load(); B = await boot('B', nB);
  r.F2_hereda_s = await waitFor(() => !!B.win.bleInterface._bleReadyFor(idA), 8000);
  r.F2_recuperada = logs.slice(logFrom).some((l) => /\[B\].*Conexión existente recuperada al arrancar/.test(l));
  sendText(A, 'tras abrir');
  r.F3_A_a_B_s = await waitFor(() => has(B, idA, (m) => (m.content || m.text) === 'tras abrir'), 15000);
  await openChatWith(B, 'A'); sendText(B, 'hola A, sigo aquí');
  r.F3_B_a_A_s = await waitFor(() => has(A, idB, (m) => (m.content || m.text) === 'hola A, sigo aquí'), 15000);
  await sleep(1000);
  clearInterval(watch);
  const mine = logs.slice(logFrom).filter((l) => /\[A\]/.test(l));
  r.F1_A_conserva_enlace = !perdido;
  r.F1_desconexiones_en_A = mine.filter((l) => /Enlace .* desconectado/.test(l)).length;
  r.muertos = mine.filter((l) => /soltó un mensaje \(muerto\)/.test(l)).length;
  r.zombi = symptoms.filter((k) => k === 'zombi').length + mine.filter((l) => /sin respuesta a \d+ pings/.test(l)).length;
  r.escrituras_perdidas = nA.stats.staleWrites || 0;
  r.enlaces_heredados = nB.stats.serverKept || 0;
  r.errores = logs.filter((l) => / error: /.test(l) && !/JSDOMERROR|styles\.css|Not implemented|GLOBAL TIMEOUT|Assembly timeout|net::ERR|fetch|WebSocket/.test(l)).slice(0, 5);
  const ok = r.listo_antes && r.llega_antes && r.F1_A_conserva_enlace && r.F1_desconexiones_en_A === 0 && r.F2_hereda_s !== null && r.F3_A_a_B_s !== null && r.F3_A_a_B_s <= 5 &&
    r.F3_B_a_A_s !== null && r.F3_B_a_A_s <= 10 && r.muertos === 0 && r.zombi === 0 && r.escrituras_perdidas === 0 && r.errores.length === 0;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('GATTSIGUE ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_gattsigue.txt'), logs.join('\n'));
  process.exit(ok ? 0 : 1);
})();
