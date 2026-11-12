// 3031 (observación del diagnóstico S24 3021, 12-11): el PUNTERO del buzón de archivos de un vídeo llevaba la miniatura (~24 KB)
// y ya no cabía en un paquete del buzón (tope 20 000 caracteres): salía por trozos esperando confirmaciones de un contacto
// AUSENTE («enlace caído: espero…» cada 30 s) y al volver la app se abortaba y se volvía a subir. Ahora el puntero cabe en UN
// paquete: la miniatura grande no viaja dentro (el que recibe la hace al bajar el vídeo) y la burbuja pasa a ✓ al guardarse.
// A y B se conocen; B sin internet y sin Bluetooth; A manda un vídeo con miniatura de 32 000 caracteres.
// Uso: node blobthumb.js <dir_build>
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone, installWebCrypto } = require('./native_mock');
const { NostrRelay } = require('./nostr_relay');

const buildDir = path.resolve(process.argv[2]);
const base = { readsContentFallback: true, retain: ['onPayloadReceived', 'onLanMessage', 'onLanUp', 'onLanDown'], closeOnNoService: true, pace: [15, 15], ioDelay: 25, asymmetric: true, noL2: true }; // noL2: sin canal L2CAP (como la tablet del dueño): un archivo > 5 MB va por el flujo normal, no por big_file.js
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
    beforeParse(win) { win.NEXO_NET_RELAYS = RELAYS; win.CapacitorCustomPlatform = { name: 'android' }; installWebCrypto(win); win.Capacitor = { Plugins: { NexoBLE: native.plugin() } }; win.HTMLElement.prototype.scrollTo = function () {}; },
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

(async () => {
  const r = { prueba: 'blobthumb', build: path.basename(buildDir) };
  const r1 = new NostrRelay(), r2 = new NostrRelay();
  RELAYS = [await r1.start(), await r2.start()];
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', Object.assign({}, base, { wifi: 'casa', noTor: true })), nB = new NativePhone('B', 'BB:BB:BB:BB:BB:02', Object.assign({}, base, { wifi: 'oficina', noTor: true }));
  [nA, nB].forEach((n) => { radio.add(n); n.load(); });
  let A = await boot('A', nA), B = await boot('B', nB);
  const idA = A.win.bleInterface.localNexoId.toLowerCase(), idB = B.win.bleInterface.localNexoId.toLowerCase();
  A.win.bleInterface.togglePanel(); const paired = await addFound(A, 'B'); A.win.bleInterface.togglePanel();
  if (!paired) { console.log('BLOBTHUMB ' + JSON.stringify({ prueba: 'blobthumb', resultado: 'FALLO', error: 'no empareja' })); process.exit(1); }
  await openChatWith(A, 'B'); sendText(A, 'hola B'); await sleep(3000);
  await openChatWith(B, 'A'); sendText(B, 'hola A'); await sleep(3000);
  const netA = () => A.win.bleInterface.net, ackA = () => A.win.bleInterface.ackSystem;
  // B se va: sin Bluetooth y sin internet → ausente para A
  radio.block(nA, nB);
  netA().tick(); B.win.bleInterface.net.tick();
  await waitFor(() => A.win.bleInterface.linkOf(idB) === 'internet', 40000);
  B.win.bleInterface.net._closeAll(); B.win.bleInterface.net.relays.forEach((rl) => { rl.retryAt = Date.now() + 9e6; });
  const pB = netA().peers.get(idB); if (pB) pB.lastRx = 0; await netA().tick();
  r.B_ausente = await waitFor(() => !netA().canReach(idB) && !A.win.bleInterface._bleReadyFor(idB), 20000) !== null;
  r.A_buzon_ok = netA().mailboxOk(idB);
  // A manda un vídeo con miniatura grande (32 000 caracteres, como la del diagnóstico) → buzón de archivos
  A.win.NEXO_makeVideoPreview = () => { const bb = new A.win.Blob([new Uint8Array(90 * 1024).fill(5)], { type: 'video/webm' }); bb.thumb = 'data:image/jpeg;base64,' + 'Q'.repeat(32000); return Promise.resolve(bb); };
  await openChatWith(A, 'B');
  const orig = new A.win.Blob([new Uint8Array(70 * 1024).fill(9)], { type: 'video/mp4' });
  const logs0 = logs.length;
  A.win.NEXO_sendVideo(orig, { name: 'clip.mp4', size: orig.size, mime: 'video/mp4', duration: 5 });
  let msgId = null;
  r.registrado = await waitFor(async () => { const l = await A.win.vaultLoadMessages(idB); const m = l.find((x) => x._own && x.attachmentType === 'video'); msgId = m && (m.messageId || m.msgId); return !!msgId; }, 15000) !== null;
  r.puntero_al_buzon = await waitFor(() => logs.slice(logs0).some((l) => /\[A\].*mando el puntero al buzón/.test(l) && l.indexOf(msgId) >= 0), 40000) !== null;
  r.tick = await waitFor(() => statusOf(A, msgId) === 'sent', 20000) !== null;
  await sleep(6000);
  const nuevos = logs.slice(logs0).filter((l) => /\[A\]/.test(l) && l.indexOf(msgId) >= 0 && !/_hd/.test(l));
  r.puntero_en_trozos = nuevos.filter((l) => /\[ChatStream\] START/.test(l)).length;
  r.espera_confirmacion = nuevos.filter((l) => /enlace caído|Window timeout/.test(l)).length;
  r.puntero_un_paquete = r.puntero_en_trozos === 0 && r.espera_confirmacion === 0;
  r.miniatura_fuera_log = logs.slice(logs0).some((l) => /miniatura grande no va en el puntero/.test(l));
  // la burbuja propia de A conserva su miniatura (solo el puntero va sin ella)
  const mA = (await A.win.vaultLoadMessages(idB)).find((x) => (x.messageId || x.msgId) === msgId);
  r.A_conserva_miniatura = !!(mA && mA.attachmentMeta && mA.attachmentMeta.thumb && mA.attachmentMeta.thumb.length > 30000);
  // B vuelve a internet: baja el vídeo del buzón aunque el puntero no traiga miniatura
  B.win.bleInterface.net.relays.forEach((rl) => { rl.retryAt = 0; }); try { B.win.bleInterface.net.tick(); } catch (e) {}
  r.B_recibe_video = await waitFor(async () => { const l = await B.win.vaultLoadMessages(idA); return l.some((x) => !x._own && x.attachmentType === 'video' && (x.messageId || x.msgId) === msgId); }, 90000) !== null;
  r.A_doble_tick = await waitFor(() => ['delivered', 'read'].includes(statusOf(A, msgId)), 30000) !== null;
  r.errores = logs.filter((l) => / error: /.test(l) && !/JSDOMERROR|styles\.css|Not implemented/.test(l)).slice(0, 5);
  const ok = r.B_ausente && r.A_buzon_ok && r.registrado && r.puntero_al_buzon && r.tick && r.puntero_un_paquete && r.miniatura_fuera_log && r.A_conserva_miniatura && r.B_recibe_video && r.A_doble_tick && !r.errores.length;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('BLOBTHUMB ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_blobthumb.txt'), logs.join('\n'));
  await Promise.all([r1.stop && r1.stop(), r2.stop && r2.stop()].filter(Boolean)).catch(() => {});
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('BLOBTHUMB ' + JSON.stringify({ prueba: 'blobthumb', resultado: 'FALLO', error: String(e && e.message) })); console.error(e); fs.writeFileSync(path.join(__dirname, 'last_logs_blobthumb.txt'), logs.join('\n')); process.exit(1); });
