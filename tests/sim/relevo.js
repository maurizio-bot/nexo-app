// 3114 (dueño 15-11: «si un servidor no funciona se ocupa otro y eso debe ser algo rápido, no debe detectarse en el uso diario»;
// diagnósticos S24 y S23 3057–3059: relay.damus.io rechazó la conexión toda la noche, 26 intentos). A y B solo por internet, con 3 relés
// de siempre (r1, r2, r3) y 2 de reserva (r4, r5):
//  R1  r1 cae del todo: los dos pasan a usar uno de reserva (el mismo: r4) en segundos y siguen hablando;
//  R2  caen también r2 y r3 (todos los de siempre): lo que B le escribe a A llega igual por los de reserva;
//  R3  vuelven los de siempre: los de reserva se sueltan.
// Uso: node relevo.js <dir_build>
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone, installWebCrypto } = require('./native_mock');
const { NostrRelay } = require('./nostr_relay');

const buildDir = path.resolve(process.argv[2]);
const base = { readsContentFallback: true, retain: ['onPayloadReceived', 'onLanMessage', 'onLanUp', 'onLanDown'], closeOnNoService: true, pace: [15, 15], ioDelay: 25, asymmetric: true, noL2: true, noTor: true }; // noL2: sin canal L2CAP (como la tablet del dueño): un archivo > 5 MB va por el flujo normal, no por big_file.js
let RELAYS = [], SPARES = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
class DistLoader extends ResourceLoader {
  constructor(dir) { super(); this.dir = dir; }
  fetch(url) { const f = path.join(this.dir, decodeURIComponent(new URL(url).pathname)); return fs.existsSync(f) ? Promise.resolve(fs.readFileSync(f)) : Promise.reject(new Error('no existe ' + f)); }
}
const logs = [];
// onReady(win): se llama en cuanto existe bleInterface (antes de que la app termine de arrancar) para enganchar espías
async function boot(name, native, onReady) {
  native.listeners = new Map();
  const vc = new VirtualConsole();
  ['log', 'warn', 'error'].forEach((l) => vc.on(l, (...a) => logs.push(`${new Date().toISOString().substring(14, 23)} [${name}] ${l}: ` + a.map(String).join(' ').substring(0, 300))));
  const dom = new JSDOM(fs.readFileSync(path.join(buildDir, 'dist', 'index.html'), 'utf8'), {
    url: 'https://' + name.toLowerCase() + '.nexo.test/index.html', runScripts: 'dangerously',
    resources: new DistLoader(path.join(buildDir, 'dist')), pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) { win.NEXO_NET_RELAYS = RELAYS.map((u) => u + '/?p=' + name); win.NEXO_SPARE_RELAYS = SPARES.map((u) => u + '/?p=' + name); win.CapacitorCustomPlatform = { name: 'android' }; installWebCrypto(win); const pl = native.plugin(); native.btWrites = []; const oS = pl.sendMessage; pl.sendMessage = (a) => { try { native.btWrites.push(String((a && (a.message || a.data || a.content)) || '')); } catch (e) {} return oS(a); }; win.Capacitor = { Plugins: { NexoBLE: pl } }; win.HTMLElement.prototype.scrollTo = function () {}; },
  });
  const win = dom.window;
  let hooked = false;
  for (let i = 0; i < 1000 && !(win.NEXO && win.NEXO.initialized); i++) {
    if (!hooked && onReady && win.bleInterface) { hooked = true; onReady(win); }
    await sleep(10);
  }
  if (!hooked && onReady && win.bleInterface) onReady(win);
  await sleep(800);
  return { name, native, win };
}
const click = (win, el) => el && el.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
async function openChatWith(p, name) {
  const row = Array.from(p.win.document.querySelectorAll('#main-contacts-list .ble-contact-row')).find((r) => (r.querySelector('.ble-contact-name') || {}).textContent === name);
  click(p.win, row); await sleep(500); return !!row;
}
function sendText(p, t) { const i = p.win.document.getElementById('message-input'); i.value = t; i.dispatchEvent(new p.win.Event('input', { bubbles: true })); click(p.win, p.win.document.getElementById('send-btn')); }
async function sendFile(p, name, bytes) {
  const b = Buffer.alloc(bytes); for (let i = 0; i < b.length; i++) b[i] = (i * 31 + name.length * 7) & 255;
  click(p.win, p.win.document.querySelector('.attach-menu-item[data-type="file"]')); await sleep(100);
  const fin = Array.from(p.win.document.querySelectorAll('input[type=file]')).pop();
  Object.defineProperty(fin, 'files', { configurable: true, value: [new p.win.File([b], name, { type: 'application/octet-stream' })] });
  fin.dispatchEvent(new p.win.Event('change'));
  return b;
}
async function addFound(p, name) {
  let add = null;
  const find = () => { const row = Array.from(p.win.document.querySelectorAll('#ble-new-device > div')).find((d) => (d.querySelector('span') || {}).textContent === name); return row && row.querySelector('button'); };
  for (let i = 0; i < 400 && !add; i++) { await sleep(100); add = find(); if (!add && !p.win.bleInterface.isScanning) click(p.win, p.win.document.getElementById('ble-scan-btn')); }
  click(p.win, add); await sleep(2000);
  return !!add;
}
async function waitFor(fn, ms) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return Math.round((Date.now() - t0) / 100) / 10; await sleep(200); } return null; }
const vaultMsgs = (p, from) => p.win.vaultLoadMessages(from);
// el mensaje del vault cuyo adjunto es exactamente este archivo (el historial puede guardarlo aparte: attachmentRef)
async function findMsg(p, from, b64, own) {
  const list = await vaultMsgs(p, from);
  return list.find((m) => !!m._own === !!own && m.attachmentType && !m.deleted && (m.attachmentPayload || p.native.files.get(m.attachmentRef)) === b64) || null;
}
const statusOf = (p, msgId) => { const s = p.win.document.querySelector('.msg-status[data-msg-id="' + msgId + '"]'); const m = s && (s.className || '').match(/status-([a-z]+)/); return m ? m[1] : null; };

function pickFile(p, name, b) {
  p.win.document.querySelector('.attach-menu-item[data-type="file"]').dispatchEvent(new p.win.MouseEvent('click', { bubbles: true }));
  const fin = Array.from(p.win.document.querySelectorAll('input[type=file]')).pop();
  Object.defineProperty(fin, 'files', { configurable: true, value: [new p.win.File([b], name, { type: 'application/octet-stream' })] });
  fin.dispatchEvent(new p.win.Event('change'));
}

(async () => {
  const r = { prueba: 'relevo', build: path.basename(buildDir) };
  const rel = [new NostrRelay(), new NostrRelay(), new NostrRelay(), new NostrRelay(), new NostrRelay()];
  const urls = []; for (const x of rel) urls.push(await x.start());
  const ports = urls.map((u) => Number(u.split(':').pop()));
  RELAYS = urls.slice(0, 3); SPARES = urls.slice(3);
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', Object.assign({}, base, { wifi: 'casa' })), nB = new NativePhone('B', 'BB:BB:BB:BB:BB:02', Object.assign({}, base, { wifi: 'otra' }));
  [nA, nB].forEach((n) => { radio.add(n); n.load(); });
  const A = await boot('A', nA), B = await boot('B', nB);
  const idA = A.win.bleInterface.localNexoId.toLowerCase(), idB = B.win.bleInterface.localNexoId.toLowerCase();
  A.win.bleInterface.togglePanel(); const paired = await addFound(A, 'B'); A.win.bleInterface.togglePanel();
  if (!paired) { console.log('RELEVO ' + JSON.stringify({ prueba: 'relevo', resultado: 'FALLO', error: 'no empareja' })); process.exit(1); }
  await openChatWith(A, 'B'); sendText(A, 'hola B'); await sleep(3000);
  await openChatWith(B, 'A'); sendText(B, 'hola A'); await sleep(3000);
  const net = (p) => p.win.bleInterface.net;
  net(A).tick(); net(B).tick();
  r.en_internet = await waitFor(() => net(A).canReach(idB) && net(B).canReach(idA), 60000) !== null;
  radio.block(nA, nB); // solo internet
  await waitFor(() => !A.win.bleInterface._bleReadyFor(idB) && !B.win.bleInterface._bleReadyFor(idA), 30000);
  await sleep(2000);
  const openOn = (p, i) => { const rr = net(p).relays.get(urls[i] + '/?p=' + p.name); return !!(rr && rr.open); };
  const say = async (from, to, idTo, idFrom, txt, ms) => {
    await openChatWith(from, to.name); sendText(from, txt);
    return waitFor(() => vaultMsgs(to, idFrom).then((l) => l.some((m) => m.content === txt)), ms);
  };
  // R1: r1 cae del todo
  r.R1_antes = { A: [0, 1, 2, 3].map((i) => openOn(A, i)), B: [0, 1, 2, 3].map((i) => openOn(B, i)) };
  await rel[0].stop();
  r.R1_reserva_s = await waitFor(() => openOn(A, 3) && openOn(B, 3), 60000);
  r.R1_sigue_s = await say(B, A, idA, idB, 'tras caer r1', 30000);
  // R2: caen también r2 y r3
  await rel[1].stop(); await rel[2].stop();
  await sleep(1500);
  r.R2_llega_s = await say(B, A, idA, idB, 'con los de siempre caidos', 60000);
  r.R2_abiertos_A = [0, 1, 2, 3, 4].map((i) => openOn(A, i));
  // R3: vuelven los de siempre (mismos puertos)
  for (let i = 0; i < 3; i++) { rel[i] = new NostrRelay(); await rel[i].start(ports[i]); }
  r.R3_suelta_s = await waitFor(() => [0, 1, 2].every((i) => openOn(A, i)) && !openOn(A, 3) && !openOn(A, 4), 90000);
  r.R3_registro = logs.filter((l) => /\[A\].*\[NET\] (Relé de reserva|Los relés de siempre vuelven)/.test(l)).map((l) => l.replace(/^.*\[NET\] /, '').substring(0, 120));
  r.errores = logs.filter((l) => / error: /.test(l) && !/JSDOMERROR|styles\.css|Not implemented|net::ERR|fetch|WebSocket/.test(l)).slice(0, 5);
  const ok = r.en_internet && typeof r.R1_reserva_s === 'number' && r.R1_reserva_s <= 12 && typeof r.R1_sigue_s === 'number' && r.R1_sigue_s <= 15 &&
    typeof r.R2_llega_s === 'number' && r.R2_llega_s <= 30 && typeof r.R3_suelta_s === 'number' && !r.errores.length;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('RELEVO ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_relevo.txt'), logs.join('\n'));
  for (const x of rel) { try { await x.stop(); } catch (e) {} }
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('RELEVO ' + JSON.stringify({ prueba: 'relevo', resultado: 'FALLO', error: String(e && e.message) })); console.error(e); fs.writeFileSync(path.join(__dirname, 'last_logs_relevo.txt'), logs.join('\n')); process.exit(1); });
