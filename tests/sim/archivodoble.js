// 3197 (hallazgo del ayudante de la 3193, 17-11): si llega cualquier cosa del contacto en el medio segundo entre elegir un archivo y
// empezar a subirlo (lo vio con su anuncio de rutas 'rt'), el archivo salía DOS veces, por dos caminos: _prePayload → _kickPeer →
// _resendPendingMessages → ackSystem.sendFile (trozos por los relés) y, a la vez, el envío original al buzón de archivos. Con datos
// móviles, el doble de gasto. A y B solo por internet (sin Bluetooth entre ellos), los dos con datos móviles (subida a CELL_UP_BPS),
// 4 relés de prueba:
//  F1  la carrera a propósito: el 'rt' de B llega justo cuando A empieza a mandar un archivo de 97 KB (y otro 'rt' a 1,5 s, con la
//      subida al buzón en curso): sale por UN camino, se sube una vez (KB del buzón y en total), llega UNA vez a B y queda ✓✓;
//  F2  la subida al buzón FALLA a mitad (los relés dejan de guardar trozos tras el primero), con el mismo 'rt' al empezar: mientras
//      sube no sale por otro camino; al fallar queda ⏳ (nunca ✗; en el almacén sigue «sending»: no se degrada a «pending», y el
//      reenvío lo toma igual) y, con los relés bien otra vez, el reenvío de pendientes lo RETOMA (no queda atascado): llega una vez y ✓✓;
//  F3  textos: el mismo 'rt' justo al mandar un texto (a) y con la cámara abierta (b, el texto espera a que se cierre): cuántas veces
//      sale el texto (envíos por internet con su id) y que llega una vez;
//  F4  un archivo de más de 1,5 MB (A ya con Wi-Fi, para que suba rápido): antes de mandarlo se anota en el disco («envío grande»,
//      freno de bucle de arranque, vaultBigSendBegin; aquí tarda 0,4 s, como un disco lento) y el 'rt' llega en ese rato: sale por
//      un camino, llega una vez y ✓✓.
// Contraprueba: con el build de HEAD (3194) F1, F2 y F4 salen por dos caminos (buzón + trozos) y el texto de F3b sale dos veces.
// Imprime ARCHIVODOBLE {json} y escribe last_logs_archivodoble.txt.
// Uso: node archivodoble.js <dir_build>
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone, installWebCrypto } = require('./native_mock');
const { NostrRelay } = require('./nostr_relay');

const buildDir = path.resolve(process.argv[2] || path.join(__dirname, 'builds/wip'));
const base = { readsContentFallback: true, retain: ['onPayloadReceived', 'onLanMessage', 'onLanUp', 'onLanDown'], closeOnNoService: true, pace: [15, 15], ioDelay: 25, asymmetric: true, noL2: true, noTor: true };
const CELL_UP_BPS = 40 * 1024; // como datosmoviles.js
const FILE_BYTES = 97 * 1024;
let RELAYS = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
class DL extends ResourceLoader { constructor(d) { super(); this.d = d; } fetch(u) { const f = path.join(this.d, decodeURIComponent(new URL(u).pathname)); return fs.existsSync(f) ? Promise.resolve(fs.readFileSync(f)) : Promise.reject(new Error('x')); } }
const logs = [];
const T0 = Date.now();
const ts = () => String(((Date.now() - T0) / 1000).toFixed(1)).padStart(6) + 's';
// La subida del teléfono: todo lo que manda a los relés pasa por aquí (se cuenta; con datos, a CELL_UP_BPS compartidos, en orden)
function shapeUplink(win, up) {
  const proto = win.WebSocket.prototype, oSend = proto.send;
  proto.send = function (d) {
    const s = String(d), len = Buffer.byteLength(s);
    up.bytes += len;
    if (s.startsWith('["EVENT",{') && s.indexOf('"kind":1064') > 0) { up.blobBytes += len; up.blobFrames++; } // trozos del buzón de archivos
    if (!up.bps) return oSend.call(this, d);
    const now = Date.now(), at = Math.max(now, up.free) + len * 1000 / up.bps;
    up.free = at;
    const ws = this;
    setTimeout(() => { try { if (ws.readyState === 1) oSend.call(ws, d); } catch (e) {} }, at - now);
  };
}
async function boot(name, native) {
  native.listeners = new Map();
  const vc = new VirtualConsole();
  ['log', 'warn', 'error'].forEach((l) => vc.on(l, (...a) => logs.push(`${ts()} [${name}] ${l}: ` + a.map(String).join(' ').substring(0, 300))));
  const up = { bytes: 0, bps: 0, free: 0, blobBytes: 0, blobFrames: 0 };
  const dom = new JSDOM(fs.readFileSync(path.join(buildDir, 'dist', 'index.html'), 'utf8'), {
    url: 'https://' + name.toLowerCase() + '.nexo.test/index.html', runScripts: 'dangerously', resources: new DL(path.join(buildDir, 'dist')), pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) {
      win.NEXO_NET_RELAYS = RELAYS.slice(); win.NEXO_SPARE_RELAYS = []; win.CapacitorCustomPlatform = { name: 'android' }; installWebCrypto(win);
      native.calls = { push() {}, length: 0, filter() { return []; }, slice() { return []; }, forEach() {}, map() { return []; }, some() { return false; }, find() { return undefined; } };
      win.Capacitor = { Plugins: { NexoBLE: native.plugin() } }; win.HTMLElement.prototype.scrollTo = function () {};
      shapeUplink(win, up);
    },
  });
  const win = dom.window;
  for (let i = 0; i < 100 && !(win.NEXO && win.NEXO.initialized); i++) await sleep(100);
  await sleep(800);
  return { name, native, win, up };
}
const click = (win, el) => el && el.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
async function openChatWith(p, name) {
  let row; for (let i = 0; i < 200 && !row; i++) { row = Array.from(p.win.document.querySelectorAll('#main-contacts-list .ble-contact-row')).find((r) => (r.querySelector('.ble-contact-name') || {}).textContent === name); if (!row) await sleep(100); }
  click(p.win, row); await sleep(500); return !!row;
}
function sendText(p, t) { const i = p.win.document.getElementById('message-input'); i.value = t; i.dispatchEvent(new p.win.Event('input', { bubbles: true })); click(p.win, p.win.document.getElementById('send-btn')); }
async function sendFile(p, name, bytes, seed) {
  const b = Buffer.alloc(bytes); let x = seed; for (let i = 0; i < b.length; i++) { x = (x * 1103515245 + 12345) & 0x7fffffff; b[i] = x & 255; }
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
async function waitFor(fn, ms, every) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return Math.round((Date.now() - t0) / 100) / 10; await sleep(every || 200); } return null; }
const isFile = (p, b64) => (m) => !m._own && m.attachmentType && !m.deleted && !m.hidden && (m.attachmentPayload || p.native.files.get(m.attachmentRef)) === b64;
async function copiesOf(p, chat, b64) { return (await p.win.vaultLoadMessages(chat)).filter(isFile(p, b64)).length; }
async function statusOf(p, chat, id) { const m = (await p.win.vaultLoadMessages(chat)).find((x) => (x.msgId || x.messageId) === id); return m ? m.status : null; }
function shutdown(p) { try { p.win.bleInterface.net._closeAll(); p.win.bleInterface.net.relays.forEach((rl) => { rl.retryAt = Date.now() + 9e6; }); clearInterval(p.win.bleInterface.net._timer); } catch (e) {} }
const net = (p) => p.win.bleInterface.net;
const subs = (p) => { let n = 0; net(p).relays.forEach((r) => { if (r.open && !r.gw && r.sub) n++; }); return n; };
const openN = (p) => { let n = 0; net(p).relays.forEach((r) => { if (r.open && !r.gw) n++; }); return n; };
function setNet(p, type) { p.native.setNetwork(type, type === 'wifi' ? 'casa_' + p.name : undefined); p.up.bps = type === 'cell' ? CELL_UP_BPS : 0; }
// El anuncio de rutas de B ('rt', tal cual lo manda: lo vio el ayudante en su traza) le llega a A por internet. _kickPeer frena 4 s por
// contacto: se borra su marca para que este 'rt' sí empuje el reenvío de pendientes (como si el anterior fuera de hace rato)
function rtFrom(p, fromId) {
  const bi = p.win.bleInterface;
  try { if (bi._lastKick) bi._lastKick.delete(fromId); } catch (e) {}
  const raw = JSON.stringify({ v: 1, type: 'rt', from: fromId, r: {}, ts: Date.now() });
  let st = '?'; try { st = bi._getDeviceState('net:' + fromId).state; } catch (e) {}
  logs.push(`${ts()} [${p.name}] PRUEBA: llega el 'rt' de ${fromId} (enlace por internet: ${st})`);
  try { bi._prePayload({ deviceId: 'net:' + fromId, content: raw, data: raw, source: 'net', timestamp: Date.now(), reassembled: true }); return st; } catch (e) { return false; }
}
// Por qué caminos salió un archivo en A (desde la línea l0 del registro)
function pathsOf(id, l0) {
  const L = logs.slice(l0).filter((l) => l.indexOf('[A] ') >= 0 && l.indexOf(id) >= 0);
  return {
    buzon: L.filter((l) => /\[BLOB\] \S+ \(.*→ buzón de archivos: cifro/.test(l)).length,
    trozos: L.filter((l) => /\[BleAckSystem\] sendFile START fileId=/.test(l)).length,
    referencia: L.filter((l) => /va POR REFERENCIA/.test(l)).length,
  };
}
const nPaths = (c) => c.buzon + c.trozos + c.referencia;
// B: cuántas veces terminó de recibir ese archivo (por trozos o bajado del buzón)
const arrivalsB = (id, l0) => logs.slice(l0).filter((l) => l.indexOf('[B] ') >= 0 && l.indexOf(id) >= 0 && (/Archivo recibido via fileComplete/.test(l) || /\[BLOB\] \S+ (bajado y verificado|ya lo tenía)/.test(l))).length;
const kb = (n) => Math.round(n / 1024);

(async () => {
  const r = { prueba: 'archivodoble', build: path.basename(buildDir) };
  const rel = [new NostrRelay(), new NostrRelay(), new NostrRelay(), new NostrRelay()];
  RELAYS = []; for (const x of rel) RELAYS.push(await x.start());
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', Object.assign({}, base, { wifi: 'casa_A' })), nB = new NativePhone('B', 'BB:BB:BB:BB:BB:02', Object.assign({}, base, { wifi: 'casa_B' }));
  [nA, nB].forEach((n) => { radio.add(n); n.load(); });
  const A = await boot('A', nA); const B = await boot('B', nB);
  const biA = A.win.bleInterface;
  const idA = biA.localNexoId.toLowerCase(), idB = B.win.bleInterface.localNexoId.toLowerCase();
  biA.togglePanel(); const paired = await addFound(A, 'B'); biA.togglePanel();
  if (!paired) { console.log('ARCHIVODOBLE ' + JSON.stringify(Object.assign(r, { resultado: 'FALLO', error: 'no empareja' }))); process.exit(1); }
  await openChatWith(A, 'B'); sendText(A, 'hola B'); await sleep(2000);
  await openChatWith(B, 'A'); sendText(B, 'hola A'); await sleep(2000);
  radio.block(nA, nB);
  net(A).tick(); net(B).tick();
  setNet(A, 'cell'); setNet(B, 'cell');
  r.datos_asentado_s = await waitFor(() => openN(A) === RELAYS.length && openN(B) === RELAYS.length && subs(A) === 2 && subs(B) === 2, 30000);
  await sleep(4000);
  const online = () => waitFor(() => biA.linkOf(idB) === 'internet' && B.win.bleInterface.linkOf(idA) === 'internet', 60000);
  r.en_linea_por_internet_s = await online();
  await openChatWith(A, 'B'); await openChatWith(B, 'A');

  // Espías en A: cada vuelta del reenvío de pendientes; los envíos por internet de un id; el 'rt' de B justo al empezar a mandar
  let resends = 0;
  const origResend = biA._resendPendingMessages;
  biA._resendPendingMessages = function (nx) { if (String(nx).toLowerCase() === idB) resends++; return origResend.apply(this, arguments); };
  const netSends = new Map();
  const origNetSend = net(A).send;
  net(A).send = function (nx, content) { const m = /"msgId":"([^"]+)"/.exec(String(content || '')); if (m && /"type":"chat"/.test(String(content))) netSends.set(m[1], (netSends.get(m[1]) || 0) + 1); return origNetSend.apply(this, arguments); };
  let armF = null, armT = null;
  const origSendFile = biA.sendFile;
  // El 'rt' llega en cuanto el mensaje ya está guardado en el chat (lo que lee el reenvío de pendientes), dentro del margen de 0,5 s
  // antes de que el envío arranque: se mira el almacén cada 5 ms desde que empieza el envío
  const rtWhenStored = (a) => { const t0 = Date.now(); const poll = () => { A.win.vaultLoadMessages(idB).then((l) => { if ((l || []).some((m) => (m.msgId || m.messageId) === a.id)) { a.rt_ms = Date.now() - t0; const n0 = resends; a.rt = rtFrom(A, idB); a.empuja = resends > n0; return; } if (Date.now() - t0 < 3000) setTimeout(poll, 5); }, () => {}); }; poll(); };
  biA.sendFile = function (uuid, id) { const out = origSendFile.apply(this, arguments); if (armF && !/_hd$/.test(String(id))) { const a = armF; armF = null; a.id = id; rtWhenStored(a); } return out; };
  const origSendChat = biA.sendChatMessage;
  biA.sendChatMessage = function (uuid, content, id) { const out = origSendChat.apply(this, arguments); if (armT && id && !/^(cs|gcs)/.test(String(id))) { const a = armT; armT = null; a.id = id; rtWhenStored(a); } return out; };
  // Que no haya una vuelta del reenvío en marcha (si la hay, un 'rt' solo la marca «otra vez al terminar»: la carrera no sería a propósito)
  // y que A vea a B en línea por internet (si no, el 'rt' no empuja el reenvío: _kickPeer solo lo hace con el enlace listo)
  const quiet = async () => { const a = await online(); const b = await waitFor(() => !(biA._resendRun && biA._resendRun.has(idB)) && !(biA._resendBackoff && biA._resendBackoff.has(idB)), 40000); return a === null || b === null ? null : Math.round((a + b) * 10) / 10; };

  // ---- F1: la carrera ----
  r.F1_quieto_s = await quiet();
  const l1 = logs.length, up1 = { all: A.up.bytes, blob: A.up.blobBytes }, rs1 = resends;
  armF = {}; const a1 = armF;
  const f1 = await sendFile(A, 'doble.bin', FILE_BYTES, 3197);
  const b64_1 = f1.toString('base64');
  await waitFor(() => a1.rt !== undefined, 10000, 20);
  r.F1_rt_al_empezar = a1.rt || false; r.F1_rt_ms = a1.rt_ms; r.F1_rt_empuja_reenvio = !!a1.empuja;
  await sleep(1500);
  r.F1_rt_subiendo = rtFrom(A, idB);
  r.F1_llega_s = await waitFor(async () => (await copiesOf(B, idA, b64_1)) > 0, 120000, 300);
  r.F1_A_ok_s = await waitFor(async () => /^(delivered|read)$/.test(await statusOf(A, idB, a1.id)), 60000, 300);
  // margen para que un segundo envío (si lo hubiera) termine o se vea
  await waitFor(() => { const ack = biA.ackSystem; return !(ack.outgoingStreams && ack.outgoingStreams.has(a1.id)) && !(ack._blobOutRunning && ack._blobOutRunning.has(a1.id)); }, 60000, 300);
  await sleep(4000);
  r.F1_reenvios = resends - rs1;
  r.F1_caminos = pathsOf(a1.id, l1);
  r.F1_subido_kb_buzon = kb(A.up.blobBytes - up1.blob);
  r.F1_subido_kb_total = kb(A.up.bytes - up1.all);
  r.F1_subido_por_kb_de_archivo = Math.round(10 * (A.up.bytes - up1.all) / FILE_BYTES) / 10;
  r.F1_B_copias = await copiesOf(B, idA, b64_1);
  r.F1_B_llegadas = arrivalsB(a1.id, l1);
  r.F1_A_estado = await statusOf(A, idB, a1.id);

  // ---- F2: la subida al buzón falla a mitad; el reenvío la retoma ----
  await sleep(2000);
  r.F2_quieto_s = await quiet();
  const l2 = logs.length, rs2 = resends;
  const origPublishEach = net(A).publishEach;
  let firstChunk = null, cut = true, refused = 0;
  net(A).publishEach = function (ev) {
    if (cut && ev && ev.kind === 1064) {
      if (!firstChunk) firstChunk = ev.id;
      if (ev.id !== firstChunk) { refused++; return new Promise((res) => setTimeout(() => res([]), 300)); } // «ningún relé lo guardó»
    }
    return origPublishEach.apply(this, arguments);
  };
  armF = {}; const a2 = armF;
  const f2 = await sendFile(A, 'doble_falla.bin', FILE_BYTES, 3198);
  const b64_2 = f2.toString('base64');
  await waitFor(() => a2.rt !== undefined, 10000, 20);
  r.F2_rt_al_empezar = a2.rt || false; r.F2_rt_ms = a2.rt_ms; r.F2_rt_empuja_reenvio = !!a2.empuja;
  const failRx = new RegExp('\\[A\\] warn: \\[BLOB\\] ' + a2.id + ' no pudo subirse al buzón');
  r.F2_falla_s = await waitFor(() => logs.slice(l2).some((l) => failRx.test(l)), 90000, 100);
  r.F2_trozos_rechazados = refused;
  r.F2_caminos_antes_de_fallar = pathsOf(a2.id, l2);
  await sleep(800);
  r.F2_estado_tras_fallar = await statusOf(A, idB, a2.id);
  cut = false; net(A).publishEach = origPublishEach;
  const l2b = logs.length;
  r.F2_rt_tras_fallar = rtFrom(A, idB);
  r.F2_retoma_s = await waitFor(async () => (await copiesOf(B, idA, b64_2)) > 0, 120000, 300);
  r.F2_A_ok_s = await waitFor(async () => /^(delivered|read)$/.test(await statusOf(A, idB, a2.id)), 60000, 300);
  await waitFor(() => { const ack = biA.ackSystem; return !(ack.outgoingStreams && ack.outgoingStreams.has(a2.id)) && !(ack._blobOutRunning && ack._blobOutRunning.has(a2.id)); }, 60000, 300);
  await sleep(3000);
  r.F2_reenvios = resends - rs2;
  r.F2_caminos_al_retomar = pathsOf(a2.id, l2b);
  r.F2_B_copias = await copiesOf(B, idA, b64_2);
  r.F2_B_llegadas = arrivalsB(a2.id, l2);
  r.F2_A_estado = await statusOf(A, idB, a2.id);

  // ---- F3: textos ----
  await sleep(2000);
  const gotT = (t) => async () => (await B.win.vaultLoadMessages(idA)).filter((m) => !m._own && String(m.content).trim() === t).length;
  r.F3a_quieto_s = await quiet();
  armT = {}; const t3a = armT, txt3a = 'texto con el rt de B al mandarlo';
  sendText(A, txt3a);
  await waitFor(() => t3a.rt !== undefined, 5000, 5);
  r.F3a_rt_al_empezar = t3a.rt || false; r.F3a_rt_ms = t3a.rt_ms; r.F3a_rt_empuja_reenvio = !!t3a.empuja;
  r.F3a_llega_s = await waitFor(gotT(txt3a), 20000);
  await sleep(4000);
  r.F3a_envios = netSends.get(t3a.id) || 0;
  r.F3a_B_copias = await gotT(txt3a)();
  // b) con la cámara abierta: el texto espera a que se cierre (≤ 8 s) y el 'rt' llega mientras espera
  r.F3b_quieto_s = await quiet();
  biA.pauseBLEForCamera();
  armT = {}; const t3b = armT, txt3b = 'texto mientras la cámara está abierta';
  sendText(A, txt3b);
  await waitFor(() => t3b.rt !== undefined, 5000, 20);
  r.F3b_rt_al_empezar = t3b.rt || false; r.F3b_rt_ms = t3b.rt_ms; r.F3b_rt_empuja_reenvio = !!t3b.empuja;
  await sleep(1500);
  biA.resumeBLEAfterCamera();
  r.F3b_llega_s = await waitFor(gotT(txt3b), 20000);
  await sleep(4000);
  r.F3b_envios = netSends.get(t3b.id) || 0;
  r.F3b_B_copias = await gotT(txt3b)();

  // ---- F4: archivo grande (> 2 000 000 letras en base64): el 'rt' llega mientras se anota el envío en el disco ----
  setNet(A, 'wifi');
  await waitFor(() => openN(A) === RELAYS.length && subs(A) === RELAYS.length, 30000);
  await sleep(3000);
  r.F4_quieto_s = await quiet();
  const BIG_BYTES = 1600 * 1024;
  let armB = null;
  const origBigBegin = A.win.vaultBigSendBegin;
  A.win.vaultBigSendBegin = function (id) { const p = origBigBegin.apply(this, arguments); if (armB && !armB.id) { armB.id = id; rtWhenStored(armB); } return Promise.resolve(p).then((v) => new Promise((res) => setTimeout(() => res(v), 400))); };
  const l4 = logs.length, up4 = { all: A.up.bytes, blob: A.up.blobBytes };
  armB = {}; const a4 = armB;
  const f4 = await sendFile(A, 'doble_grande.bin', BIG_BYTES, 3199);
  const b64_4 = f4.toString('base64');
  await waitFor(() => a4.rt !== undefined, 15000, 20);
  r.F4_anotado = !!a4.id;
  r.F4_rt_al_anotar = a4.rt || false; r.F4_rt_empuja_reenvio = !!a4.empuja;
  r.F4_llega_s = await waitFor(async () => (await copiesOf(B, idA, b64_4)) > 0, 180000, 500);
  r.F4_A_ok_s = await waitFor(async () => /^(delivered|read)$/.test(await statusOf(A, idB, a4.id)), 60000, 300);
  await waitFor(() => { const ack = biA.ackSystem; return !(ack.outgoingStreams && ack.outgoingStreams.has(a4.id)) && !(ack._blobOutRunning && ack._blobOutRunning.has(a4.id)); }, 30000, 300);
  await sleep(3000);
  A.win.vaultBigSendBegin = origBigBegin;
  r.F4_caminos = pathsOf(a4.id || '?', l4);
  r.F4_subido_kb_buzon = kb(A.up.blobBytes - up4.blob);
  r.F4_subido_kb_total = kb(A.up.bytes - up4.all);
  r.F4_B_copias = await copiesOf(B, idA, b64_4);
  r.F4_A_estado = await statusOf(A, idB, a4.id);

  r.errores = logs.filter((l) => / error: /.test(l) && !/JSDOMERROR|styles\.css|Not implemented|GLOBAL TIMEOUT|net::ERR|fetch/.test(l)).slice(0, 5);
  const ok1 = { F1_un_camino: nPaths(r.F1_caminos) === 1 && r.F1_caminos.buzon === 1, F1_llega_una_vez: r.F1_llega_s !== null && r.F1_B_copias === 1 && r.F1_B_llegadas === 1, F1_doble_check: /^(delivered|read)$/.test(String(r.F1_A_estado)), F1_carrera_provocada: r.F1_rt_empuja_reenvio };
  const ok2 = { F2_falla_a_mitad: r.F2_falla_s !== null && r.F2_trozos_rechazados > 0, F2_un_camino_mientras_sube: nPaths(r.F2_caminos_antes_de_fallar) === 1 && r.F2_caminos_antes_de_fallar.buzon === 1, F2_pendiente_no_fallido: /^(pending|sending)$/.test(String(r.F2_estado_tras_fallar)), F2_retoma: r.F2_retoma_s !== null && nPaths(r.F2_caminos_al_retomar) === 1, F2_llega_una_vez: r.F2_B_copias === 1, F2_doble_check: /^(delivered|read)$/.test(String(r.F2_A_estado)) };
  const ok3 = { F3a: r.F3a_llega_s !== null && r.F3a_envios === 1 && r.F3a_B_copias === 1, F3b: r.F3b_llega_s !== null && r.F3b_envios === 1 && r.F3b_B_copias === 1 };
  const ok4 = { F4_un_camino: nPaths(r.F4_caminos) === 1 && r.F4_caminos.buzon === 1, F4_llega_una_vez: r.F4_llega_s !== null && r.F4_B_copias === 1, F4_doble_check: /^(delivered|read)$/.test(String(r.F4_A_estado)), F4_carrera_provocada: r.F4_rt_empuja_reenvio };
  r.comprobaciones = Object.assign({}, ok1, ok2, ok3, ok4);
  const ok = r.en_linea_por_internet_s !== null && Object.values(r.comprobaciones).every(Boolean) && !r.errores.length;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('ARCHIVODOBLE ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_archivodoble.txt'), logs.join('\n'));
  shutdown(A); shutdown(B); for (const x of rel) { try { await x.stop(); } catch (e) {} }
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('ARCHIVODOBLE ' + JSON.stringify({ prueba: 'archivodoble', resultado: 'FALLO', error: String(e && e.message).replace(/"/g, "'") })); console.error(e && e.stack); fs.writeFileSync(path.join(__dirname, 'last_logs_archivodoble.txt'), logs.join('\n')); process.exit(1); });
