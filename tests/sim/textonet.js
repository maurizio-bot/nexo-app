// 3096 (diagnósticos vivo y S24 14-11 13:03–13:05): el vivo mandaba 3 textos LARGOS (~20 KB, van en trozos) por internet al S24 con
// su app dormida. El teléfono del S24 (NetBg, su nativo) los guardaba y confirmaba con ✓✓, pero el vivo seguía reenviando la ventana
// de trozos cada ~4–5 s (esperaba la confirmación de cada trozo, que solo da la app): ~50 s de reenvíos; al despertar, el S24 tenía
// 109 sobres acumulados. Y tras 8 reintentos el texto volvía a ⏳ (pisaba el ✓✓) y la cola lo reenviaba entero.
// A y B solo por internet; la app de B duerme (sus conexiones a los relés quedan mudas, como en el teléfono) y su nativo confirma
// (se imita el ✓✓ firmado del NetBg); A le manda un texto largo:
//  N1  A ve ✓✓ (el del nativo de B);
//  N2  durante 40 s con B dormido, A reenvía la ventana como mucho 3 veces (antes, cada ~4 s) y el texto sigue ✓✓ (no vuelve a ⏳ ni ✗);
//  N3  B despierta: el texto (varias ventanas de trozos: el resto sale cuando su app confirma la primera) le llega entero, una vez,
//      en ≤ 20 s, y el envío de A termina.
// Uso: node textonet.js <dir_build>
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone, installWebCrypto } = require('./native_mock');
const { NostrRelay } = require('./nostr_relay');

const buildDir = path.resolve(process.argv[2]);
const base = { readsContentFallback: true, retain: ['onPayloadReceived', 'onLanMessage', 'onLanUp', 'onLanDown'], closeOnNoService: true, pace: [15, 15], ioDelay: 25, asymmetric: true, noL2: true, noTor: true }; // noL2: sin canal L2CAP (como la tablet del dueño): un archivo > 5 MB va por el flujo normal, no por big_file.js
let RELAYS = [];
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
    beforeParse(win) { win.NEXO_NET_RELAYS = RELAYS.map((u) => u + '/?p=' + name); win.CapacitorCustomPlatform = { name: 'android' }; installWebCrypto(win); const pl = native.plugin(); native.btWrites = []; const oS = pl.sendMessage; pl.sendMessage = (a) => { try { native.btWrites.push(String((a && (a.message || a.data || a.content)) || '')); } catch (e) {} return oS(a); }; win.Capacitor = { Plugins: { NexoBLE: pl } }; win.HTMLElement.prototype.scrollTo = function () {}; },
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
  const r = { prueba: 'textonet', build: path.basename(buildDir) };
  const r1 = new NostrRelay(), r2 = new NostrRelay();
  RELAYS = [await r1.start(), await r2.start()];
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', Object.assign({}, base, { wifi: 'casa' })), nB = new NativePhone('B', 'BB:BB:BB:BB:BB:02', Object.assign({}, base));
  [nA, nB].forEach((n) => { radio.add(n); n.load(); });
  const A = await boot('A', nA), B = await boot('B', nB);
  const idA = A.win.bleInterface.localNexoId.toLowerCase(), idB = B.win.bleInterface.localNexoId.toLowerCase();
  A.win.bleInterface.togglePanel(); const paired = await addFound(A, 'B'); A.win.bleInterface.togglePanel();
  if (!paired) { console.log('TEXTONET ' + JSON.stringify({ prueba: 'textonet', resultado: 'FALLO', error: 'no empareja' })); process.exit(1); }
  await openChatWith(A, 'B'); sendText(A, 'hola B'); await sleep(3000);
  await openChatWith(B, 'A'); sendText(B, 'hola A'); await sleep(3000);
  const netA = () => A.win.bleInterface.net, netB = () => B.win.bleInterface.net;
  netA().tick(); netB().tick();
  r.en_internet = await waitFor(() => netA().canReach(idB) && netB().canReach(idA), 60000) !== null;
  radio.block(nA, nB);
  await waitFor(() => !A.win.bleInterface._bleReadyFor(idB) && !B.win.bleInterface._bleReadyFor(idA), 30000);
  await sleep(2000);
  // la app de B se duerme: sus conexiones a los relés quedan mudas (como en el teléfono); A aún la ve «en línea» un rato
  r.mudas = r1.sleepTag('p=B') + r2.sleepTag('p=B');
  const largo = 'texto largo por internet con la app del otro dormida '.repeat(1140).trim(); // ~60 KB: va en trozos, en varias ventanas
  await openChatWith(A, 'B'); sendText(A, largo);
  await sleep(300);
  const own = (await vaultMsgs(A, idB)).find((m) => m._own && m.content === largo);
  const mid = own && (own.msgId || own.messageId);
  r.troceado = await waitFor(() => logs.some((l) => /\[A\].*ChatStream\] START .*type=chat/.test(l)), 8000) !== null;
  r.ventanas = Number(((logs.find((l) => /\[A\].*ChatStream\] START .*type=chat/.test(l)) || '').match(/totalWindows=(\d+)/) || [])[1] || 0);
  await sleep(1500);
  // el NetBg de B (su nativo) recibe el sobre, lo guarda para la app y confirma ✓✓ firmado
  const ackJson = nB._deliveredAckJson({ msgId: mid, from: idA });
  r.ack_firmado = !!ackJson && /"a":/.test(ackJson);
  if (ackJson) A.win.bleInterface.ackSystem.processIncomingAck(ackJson);
  const st = async () => ((await vaultMsgs(A, idB)).find((m) => m._own && m.content === largo) || {}).status;
  r.N1_doble_palomita = (await waitFor(async () => /delivered|read/.test((await st()) || ''), 5000)) !== null;
  const k = logs.length;
  await sleep(40000);
  r.N2_reenvios = logs.slice(k).filter((l) => /\[A\].*_retransmitWindow/.test(l) && l.indexOf(mid) >= 0).length;
  r.N2_estado = await st();
  // B despierta: la app vuelve, rehace los relés y recoge lo guardado
  r1.wakeTag('p=B'); r2.wakeTag('p=B');
  try { netB()._probeRelays('despierta', 0); } catch (e) {}
  const t3 = await waitFor(async () => (await vaultMsgs(B, idA)).filter((m) => !m._own && m.content === largo).length >= 1, 60000);
  r.N3_llega_s = t3;
  r.N3_una_vez = (await vaultMsgs(B, idA)).filter((m) => !m._own && m.content === largo).length;
  r.N3_terminado = await waitFor(() => !A.win.bleInterface.ackSystem.outgoingStreams.has(mid), 60000) !== null;
  r.errores = logs.filter((l) => / error: /.test(l) && !/JSDOMERROR|styles\.css|Not implemented|net::ERR|fetch/.test(l)).slice(0, 5);
  const ok = r.en_internet && r.troceado && r.ventanas >= 2 && r.ack_firmado && r.N1_doble_palomita && r.N2_reenvios <= 3 && /delivered|read/.test(r.N2_estado || '') &&
    r.N3_llega_s !== null && r.N3_llega_s <= 20 && r.N3_una_vez === 1 && r.N3_terminado && !r.errores.length;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('TEXTONET ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_textonet.txt'), logs.join('\n'));
  await r1.stop(); await r2.stop();
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('TEXTONET ' + JSON.stringify({ prueba: 'textonet', resultado: 'FALLO', error: String(e && e.message) })); console.error(e); fs.writeFileSync(path.join(__dirname, 'last_logs_textonet.txt'), logs.join('\n')); process.exit(1); });
