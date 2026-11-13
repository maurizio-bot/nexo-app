// 3032 (dueño 12-11: «que se puedan subir estados de al menos 5 MB»): (1) con internet, una foto de 1,5 MB se sube UNA vez
// cifrada al buzón de archivos y a cada contacto le llega solo el puntero dentro del estado; el que la ve la baja, la verifica
// y la guarda (nada en el chat). (2) Sin internet, un video de 700 KB sale sin puntero; el que lo ve lo pide al dueño por
// Bluetooth («sm») y le llega como archivo de estado («stmedia»), tampoco en el chat; el visor lo muestra.
// (4) 3062 (dueño 13-11: «me comentan que los estados no se están cargando de forma robusta»): A publica una foto SIN internet
// (en el teléfono: al volver de la galería los relés aún se están conectando) y lejos de B; luego los dos tienen internet pero no
// Bluetooth: B tiene que poder verla (antes: sin puntero y sin enlace directo, «No se pudo bajar todavía» para siempre).
// Uso: node estadosbig.js <dir_build>
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
  const r = { prueba: 'estadosbig', build: path.basename(buildDir) };
  const r1 = new NostrRelay(), r2 = new NostrRelay();
  RELAYS = [await r1.start(), await r2.start()];
  const relays = [r1, r2];
  const count1064 = () => relays.reduce((n, x) => n + x.events.filter((e) => e.kind === 1064).length, 0);
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', Object.assign({}, base, { wifi: 'casa', noTor: true })), nB = new NativePhone('B', 'BB:BB:BB:BB:BB:02', Object.assign({}, base, { wifi: 'oficina', noTor: true }));
  [nA, nB].forEach((n) => { radio.add(n); n.load(); });
  let A = await boot('A', nA), B = await boot('B', nB);
  const idA = A.win.bleInterface.localNexoId.toLowerCase(), idB = B.win.bleInterface.localNexoId.toLowerCase();
  A.win.bleInterface.togglePanel(); const paired = await addFound(A, 'B'); A.win.bleInterface.togglePanel();
  if (!paired) { console.log('ESTADOSBIG ' + JSON.stringify({ prueba: 'estadosbig', resultado: 'FALLO', error: 'no empareja' })); process.exit(1); }
  await openChatWith(A, 'B'); sendText(A, 'hola B'); await sleep(3000);
  await openChatWith(B, 'A'); sendText(B, 'hola A'); await sleep(3000);
  B.win.dispatchEvent(new B.win.CustomEvent('nexo:ble:closeChat', { detail: {} })); A.win.dispatchEvent(new A.win.CustomEvent('nexo:ble:closeChat', { detail: {} })); await sleep(300);
  const mk = (mime, kb, seed) => { const b = Buffer.alloc(kb * 1024); for (let i = 0; i < b.length; i++) b[i] = (i * 7 + seed) & 255; return 'data:' + mime + ';base64,' + b.toString('base64'); };

  // ===== 1. Con internet: foto de 1,5 MB → se sube UNA vez a los relés y a B le llega solo el puntero; B la ve =====
  radio.block(nA, nB);
  A.win.bleInterface.net.tick(); B.win.bleInterface.net.tick();
  r.por_internet = await waitFor(() => A.win.bleInterface.linkOf(idB) === 'internet', 60000) !== null;
  const FOTO = mk('image/jpeg', 1536, 3);
  const ev0 = count1064();
  const s1 = A.win.NEXO_addMyStatus('foto grande', FOTO, 'image/jpeg');
  r.publicada = !!s1;
  r.subida_una_vez = await waitFor(() => { const it = A.win.NEXO_myStatuses().find((x) => x.sid === s1); return !!(it && it.ptr); }, 60000) !== null;
  r.trozos_en_reles = count1064() - ev0;
  r.B_recibe_puntero = await waitFor(() => { const it = (B.win.NEXO_statusesOf(idA) || []).find((x) => x.sid === s1); return !!(it && it.big && it.ptr && !it.img); }, 60000) !== null;
  const it1 = (B.win.NEXO_statusesOf(idA) || []).find((x) => x.sid === s1);
  r.B_estado_sin_foto_en_linea = !!it1 && !it1.img && it1.big.size === 1536 * 1024;
  const d1 = await Promise.race([B.win.NEXO_statusMedia(idA, it1), sleep(60000).then(() => null)]);
  r.B_baja_y_ve_la_foto = d1 === FOTO;
  r.B_la_guarda = /"d":"data:image\/jpeg/.test(((await B.win.Capacitor.Plugins.NexoBLE.loadFromFile({ filename: 'nexo_stc_' + idA + '_' + s1 + '.json' })) || {}).content || '');
  r.B_sin_adjunto_en_chat = !(await B.win.vaultLoadMessages(idA)).some((m) => m.attachmentType);

  // ===== 2. Sin internet: video de 700 KB → sale sin puntero; B lo pide por Bluetooth («sm») y le llega como «stmedia» =====
  [A, B].forEach((p) => { p.win.bleInterface.net._closeAll(); p.win.bleInterface.net.relays.forEach((rl) => { rl.retryAt = Date.now() + 9e6; }); });
  await sleep(500);
  radio.unblock(nA, nB);
  try { A.win.bleInterface.openChat(idB); } catch (e) {}
  r.bt_de_nuevo = await waitFor(() => !!A.win.bleInterface._bleReadyFor(idB) && !!B.win.bleInterface._bleReadyFor(idA), 60000) !== null;
  A.win.dispatchEvent(new A.win.CustomEvent('nexo:ble:closeChat', { detail: {} }));
  const VID = mk('video/mp4', 700, 9);
  const s2 = A.win.NEXO_addMyStatus('', '', '', '', '', VID, 'video/mp4');
  r.B_recibe_video_sin_puntero = await waitFor(() => { const it = (B.win.NEXO_statusesOf(idA) || []).find((x) => x.sid === s2); return !!(it && it.big && it.big.k === 'vid' && !it.ptr); }, 60000) !== null;
  const it2 = (B.win.NEXO_statusesOf(idA) || []).find((x) => x.sid === s2);
  const d2 = await Promise.race([B.win.NEXO_statusMedia(idA, it2), sleep(90000).then(() => null)]);
  r.B_pide_y_ve_el_video = d2 === VID;
  r.pedido_log = logs.some((l) => /\[B\].*pido la media/.test(l)) && logs.some((l) => /\[A\].*mando la media/.test(l));
  r.B_sin_adjunto_en_chat_2 = !(await B.win.vaultLoadMessages(idA)).some((m) => m.attachmentType);
  // en el visor de B: «Cargando…» y luego el video (ya guardado)
  const chip = Array.from(B.win.document.querySelectorAll('#main-estados-strip .estado-chip')).find((c) => /A/.test(c.textContent) && !/Mi estado|Tu estado/.test(c.textContent));
  if (chip) { chip.dispatchEvent(new B.win.MouseEvent('click', { bubbles: true })); await sleep(300); }
  for (let i = 0; i < 5 && B.win.document.getElementById('estado-pos') && !/2\//.test(B.win.document.getElementById('estado-pos').textContent); i++) { const nx = B.win.document.getElementById('estado-next'); if (nx) nx.dispatchEvent(new B.win.MouseEvent('click', { bubbles: true })); await sleep(200); }
  await sleep(800);
  const vel = B.win.document.getElementById('estado-video');
  r.visor_muestra_video = !!vel && vel.getAttribute('src') === VID;

  // ===== 3. Diagnóstico 12-11 15:07 (Honor): una foto MEDIANA (84 KB) ya no va dentro del estado (antes: 434 trozos por contacto
  //     por Bluetooth): el estado lleva solo el aviso y la foto se pide al verla =====
  const MED = mk('image/jpeg', 84, 5);
  const logs3 = logs.length;
  const s3 = A.win.NEXO_addMyStatus('foto mediana', MED, 'image/jpeg');
  r.mediana_llega_sin_foto_en_linea = await waitFor(() => { const it = (B.win.NEXO_statusesOf(idA) || []).find((x) => x.sid === s3); return !!(it && it.big && !it.img); }, 60000) !== null;
  r.mediana_trozos = logs.slice(logs3).filter((l) => /\[A\].*\[ChatStream\] START .*type=chat totalChunks=(\d+)/.test(l)).map((l) => Number(/totalChunks=(\d+)/.exec(l)[1]));
  r.mediana_sin_cientos_de_trozos = r.mediana_trozos.every((n) => n < 60);
  const it3 = (B.win.NEXO_statusesOf(idA) || []).find((x) => x.sid === s3);
  r.mediana_se_ve_al_pedirla = !!it3 && (await Promise.race([B.win.NEXO_statusMedia(idA, it3), sleep(90000).then(() => null)])) === MED;
  // ===== 4. (3062) Foto publicada SIN internet y lejos de B; luego internet sin Bluetooth: B la ve =====
  [A, B].forEach((p) => { p.win.bleInterface.net._closeAll(); p.win.bleInterface.net.relays.forEach((rl) => { rl.retryAt = Date.now() + 9e6; }); });
  radio.block(nA, nB);
  r.A_sin_internet = await waitFor(() => !A.win.bleInterface.net.online(), 20000) !== null;
  await sleep(1500);
  const FOTO4 = mk('image/jpeg', 300, 11);
  const s4 = A.win.NEXO_addMyStatus('foto sin internet', FOTO4, 'image/jpeg');
  await sleep(3000);
  r.sin_internet_sin_puntero = !((A.win.NEXO_myStatuses().find((x) => x.sid === s4) || {}).ptr);
  [A, B].forEach((p) => { p.win.bleInterface.net.relays.forEach((rl) => { rl.retryAt = 0; }); p.win.bleInterface.net.tick(); });
  r.vuelve_internet = await waitFor(() => A.win.bleInterface.linkOf(idB) === 'internet' && B.win.bleInterface.linkOf(idA) === 'internet', 90000) !== null;
  r.B_recibe_estado_4 = await waitFor(() => (B.win.NEXO_statusesOf(idA) || []).some((x) => x.sid === s4), 90000) !== null;
  const it4 = (B.win.NEXO_statusesOf(idA) || []).find((x) => x.sid === s4);
  const t4 = Date.now();
  const d4 = it4 ? await Promise.race([B.win.NEXO_statusMedia(idA, it4), sleep(150000).then(() => null)]) : null;
  r.B_ve_foto_publicada_sin_internet = d4 === FOTO4;
  r.B_ve_foto_4_s = Math.round((Date.now() - t4) / 1000);
  r.errores = logs.filter((l) => / error: /.test(l) && !/JSDOMERROR|styles\.css|Not implemented/.test(l)).slice(0, 5);
  const ok = r.por_internet && r.publicada && r.subida_una_vez && r.trozos_en_reles > 0 && r.B_recibe_puntero && r.B_estado_sin_foto_en_linea && r.B_baja_y_ve_la_foto && r.B_la_guarda && r.B_sin_adjunto_en_chat &&
    r.bt_de_nuevo && r.B_recibe_video_sin_puntero && r.B_pide_y_ve_el_video && r.pedido_log && r.B_sin_adjunto_en_chat_2 && r.visor_muestra_video && r.mediana_llega_sin_foto_en_linea && r.mediana_sin_cientos_de_trozos && r.mediana_se_ve_al_pedirla &&
    r.A_sin_internet && r.sin_internet_sin_puntero && r.vuelve_internet && r.B_recibe_estado_4 && r.B_ve_foto_publicada_sin_internet && !r.errores.length;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('ESTADOSBIG ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_estadosbig.txt'), logs.join('\n'));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('ESTADOSBIG ' + JSON.stringify({ prueba: 'estadosbig', resultado: 'FALLO', error: String(e && e.message) })); console.error(e); fs.writeFileSync(path.join(__dirname, 'last_logs_estadosbig.txt'), logs.join('\n')); process.exit(1); });
