// 3193 (dueño 17-11: «Ok» a 2 conexiones y 2 copias con datos móviles). Diagnóstico del S24 del mismo día: con datos móviles, en
// 116 min bajó de los relés 2,5 MB en 1896 eventos y 1723 eran «ya vistos» (1,5 MB repetidos): cada evento llega por CADA relé suscrito
// y, tras cada cambio de red, cada relé vuelve a mandar la ventana reciente; una nota de voz de 97 KB tardó 14,3 s en subir porque cada
// trozo del buzón de archivos iba a todos los relés abiertos. Ahora, con datos móviles: se escucha (REQ) en 2 relés —los primeros
// abiertos de la lista, el mismo orden en los dos teléfonos, saltando los caídos— y cada trozo se sube a 2; se sigue publicando en todos.
// Con Wi-Fi, como antes. A y B solo por internet (sin Bluetooth entre ellos), 4 relés de prueba (como los 4 de siempre); con datos
// móviles la subida del teléfono va a CELL_UP_BPS (la comparten todas sus conexiones, como en el teléfono):
//  F1  los dos con datos: cada uno escucha en 2 de los 4 abiertos; 4 textos de ida y 4 de vuelta + un cambio de red de B (sin red →
//      datos) + 1 texto más: llegan todos; se mide lo bajado de los relés (eventos, KB, repetidos) y los pedidos de la ventana (REQ);
//  F2  un archivo de 97 KB de A (datos) a B (datos) por el buzón de archivos: cada trozo en 2 relés; tiempo y KB subidos; llega idéntico;
//  F3  mezclas: A con Wi-Fi y B con datos (A escucha los 4, B 2) y al revés: textos en los dos sentidos llegan;
//  F4  uno de los 2 que escucha B se CAE (los dos con datos): B pasa al siguiente (≤ 8 s) y los textos llegan; al volver, regresa a él;
//  F5  un texto que quedó SOLO en los relés que B no escucha (a A no le abrían los otros): al pasar B al Wi-Fi llega (se les pide desde
//      que se dejaron de escuchar). Con datos no llega hasta entonces (riesgo conocido: queda en el informe).
// Criterio de ahorro (falla con el build de antes): F1 escucha 2 y 2, repetidos ≤ 3 × los nuevos; F2 cada trozo en 2 relés y ≤ 3,2
// veces el archivo subido (2 copias en base64 ≈ 2,7). Contraprueba: build de HEAD (4 suscripciones, 4 copias, ~3 repetidos por evento nuevo).
// Imprime DATOSMOVILES {json}. Uso: node datosmoviles.js <dir_build>
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone, installWebCrypto } = require('./native_mock');
const { NostrRelay } = require('./nostr_relay');

const buildDir = path.resolve(process.argv[2] || path.join(__dirname, 'builds/wip'));
const base = { readsContentFallback: true, retain: ['onPayloadReceived', 'onLanMessage', 'onLanUp', 'onLanDown'], closeOnNoService: true, pace: [15, 15], ioDelay: 25, asymmetric: true, noL2: true, noTor: true };
const CELL_UP_BPS = 40 * 1024; // subida con datos móviles (supuesto: el S24 subió 97 KB × 3–4 copias en 14,3 s ≈ 28–37 KB/s)
const FILE_BYTES = 97 * 1024;
let RELAYS = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
class DL extends ResourceLoader { constructor(d) { super(); this.d = d; } fetch(u) { const f = path.join(this.d, decodeURIComponent(new URL(u).pathname)); return fs.existsSync(f) ? Promise.resolve(fs.readFileSync(f)) : Promise.reject(new Error('x')); } }
const logs = [], logT = [];
const T0 = Date.now();
const ts = () => String(((Date.now() - T0) / 1000).toFixed(1)).padStart(6) + 's';
// La subida del teléfono: todo lo que manda a los relés pasa por aquí (se cuenta; con datos, a CELL_UP_BPS compartidos, en orden)
function shapeUplink(win, up) {
  const proto = win.WebSocket.prototype, oSend = proto.send;
  proto.send = function (d) {
    const s = String(d), len = Buffer.byteLength(s);
    up.bytes += len;
    if (s.startsWith('["EVENT",{') && s.indexOf('"kind":1064') > 0) { up.blobBytes += len; up.blobFrames++; } // trozos del buzón de archivos
    if (s.startsWith('["REQ"') && s.indexOf('"kinds":[1059]') > 0) { try { const m = JSON.parse(s); up.reqs.push({ url: this.url, since: m[2].since, t: Date.now() }); } catch (e) {} }
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
  ['log', 'warn', 'error'].forEach((l) => vc.on(l, (...a) => { logs.push(`${ts()} [${name}] ${l}: ` + a.map(String).join(' ').substring(0, 300)); logT.push(Date.now()); }));
  const up = { bytes: 0, bps: 0, free: 0, reqs: [], blobBytes: 0, blobFrames: 0 };
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
async function findFile(p, chat, b64) {
  const list = await p.win.vaultLoadMessages(chat);
  return list.find((m) => !m._own && m.attachmentType && !m.deleted && !m.hidden && (m.attachmentPayload || p.native.files.get(m.attachmentRef)) === b64) || null;
}
function shutdown(p) { try { p.win.bleInterface.net._closeAll(); p.win.bleInterface.net.relays.forEach((rl) => { rl.retryAt = Date.now() + 9e6; }); clearInterval(p.win.bleInterface.net._timer); } catch (e) {} }
const net = (p) => p.win.bleInterface.net;
const RN = (u) => 'r' + (RELAYS.indexOf(u) + 1);
// Relés abiertos y con la suscripción del buzón (nombres r1..r4)
const subs = (p) => { const o = { open: 0, sub: 0, escucha: [] }; net(p).relays.forEach((r, u) => { if (!r.open || r.gw) return; o.open++; if (r.sub) { o.sub++; o.escucha.push(RN(u)); } }); o.escucha.sort(); o.escucha = o.escucha.join(','); return o; };
const rx = (p) => Object.assign({ bytes: 0, ev: 0, dup: 0, dupBytes: 0 }, (net(p)._rx && net(p)._rx.all) || {});
function setNet(p, type) { p.native.setNetwork(type, type === 'wifi' ? 'casa_' + p.name : undefined); p.up.bps = type === 'cell' ? CELL_UP_BPS : 0; }
const settled = (p, n) => () => { const s = subs(p); return s.open === RELAYS.length && s.sub === n; };

(async () => {
  const r = { prueba: 'datosmoviles', build: path.basename(buildDir) };
  const rel = [new NostrRelay(), new NostrRelay(), new NostrRelay(), new NostrRelay()];
  RELAYS = []; for (const x of rel) RELAYS.push(await x.start());
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', Object.assign({}, base, { wifi: 'casa_A' })), nB = new NativePhone('B', 'BB:BB:BB:BB:BB:02', Object.assign({}, base, { wifi: 'casa_B' }));
  [nA, nB].forEach((n) => { radio.add(n); n.load(); });
  const A = await boot('A', nA); const B = await boot('B', nB);
  const idA = A.win.bleInterface.localNexoId.toLowerCase(), idB = B.win.bleInterface.localNexoId.toLowerCase();
  A.win.bleInterface.togglePanel(); const paired = await addFound(A, 'B'); A.win.bleInterface.togglePanel();
  if (!paired) { console.log('DATOSMOVILES ' + JSON.stringify(Object.assign(r, { resultado: 'FALLO', error: 'no empareja' }))); process.exit(1); }
  await openChatWith(A, 'B'); sendText(A, 'hola B'); await sleep(2000);
  await openChatWith(B, 'A'); sendText(B, 'hola A'); await sleep(2000);
  radio.block(nA, nB);
  net(A).tick(); net(B).tick();
  r.en_linea_por_internet_s = await waitFor(() => A.win.bleInterface.linkOf(idB) === 'internet' && B.win.bleInterface.linkOf(idA) === 'internet', 60000);
  r.wifi_suscripciones = { A: subs(A), B: subs(B) };
  const got = (p, from, t) => async () => (await p.win.vaultLoadMessages(from)).some((m) => !m._own && String(m.content).trim() === t);
  const sendWait = async (from, to, idTo, idFrom, t, ms) => { sendText(from, t); return waitFor(got(to, idFrom, t), ms || 20000); };
  const mark = () => ({ A: rx(A), B: rx(B), upA: A.up.bytes, upB: B.up.bytes, reqA: A.up.reqs.length, reqB: B.up.reqs.length });
  const diff = (m0) => {
    const d = (a, b) => ({ ev: b.ev - a.ev, dup: b.dup - a.dup, kb: Math.round((b.bytes - a.bytes) / 1024), kb_rep: Math.round((b.dupBytes - a.dupBytes) / 1024) });
    const a = d(m0.A, rx(A)), b = d(m0.B, rx(B));
    return { A: a, B: b, eventos: a.ev + b.ev, nuevos: (a.ev - a.dup) + (b.ev - b.dup), repetidos: a.dup + b.dup, kb: a.kb + b.kb, kb_repetidos: a.kb_rep + b.kb_rep,
      pedidos_ventana: (A.up.reqs.length - m0.reqA) + (B.up.reqs.length - m0.reqB),
      pedidos: A.up.reqs.slice(m0.reqA).map((q) => 'A:' + RN(String(q.url).replace(/\/$/, ''))).concat(B.up.reqs.slice(m0.reqB).map((q) => 'B:' + RN(String(q.url).replace(/\/$/, '')))).join(',') };
  };

  // ---- F1: los dos con datos móviles: escuchan 2; textos + cambio de red ----
  setNet(A, 'cell'); setNet(B, 'cell');
  const want = Math.min(2, RELAYS.length);
  r.F1_asentado_s = await waitFor(() => settled(A, want)() && settled(B, want)(), 30000);
  await sleep(4000);
  r.F1_suscripciones = { A: subs(A), B: subs(B) };
  r.F1_en_linea_s = await waitFor(() => A.win.bleInterface.linkOf(idB) === 'internet' && B.win.bleInterface.linkOf(idA) === 'internet', 30000);
  const m1 = mark();
  await openChatWith(A, 'B'); await openChatWith(B, 'A');
  const lleg = [];
  for (let i = 0; i < 4; i++) {
    lleg.push(await sendWait(A, B, idB, idA, 'de A con datos ' + i));
    lleg.push(await sendWait(B, A, idA, idB, 'de B con datos ' + i));
  }
  setNet(B, 'none'); await sleep(1500); setNet(B, 'cell');
  r.F1_tras_cambio_asentado_s = await waitFor(settled(B, want), 20000);
  await sleep(3000);
  lleg.push(await sendWait(A, B, idB, idA, 'de A tras el cambio de red'));
  lleg.push(await sendWait(B, A, idA, idB, 'de B tras el cambio de red'));
  await sleep(5000); // acuses de leído y saludos
  r.F1_llegan = lleg.filter((x) => x !== null).length + '/' + lleg.length;
  // acuses: lo que mandó A con datos quedó «entregado» o «leído» (el acuse de B llega por los 2 relés que escucha A)
  const stA = (await A.win.vaultLoadMessages(idB)).filter((m) => m._own && /^de A (con datos|tras el cambio)/.test(String(m.content).trim())).map((m) => m.status);
  r.F1_acuses_A = stA.filter((x) => x === 'delivered' || x === 'read').length + '/' + stA.length;
  r.F1_llegada_max_s = Math.max.apply(null, lleg.map((x) => (x === null ? 999 : x)));
  r.F1_bajado = diff(m1);
  r.F1_linea_diagnostico_B = net(B).rxLine().slice(0, 200);
  r.F1_registro_modo = logs.filter((l) => /Datos móviles: escucho|Wi-Fi: escucho todos/.test(l)).slice(0, 3).map((l) => l.replace(/ws:\/\/127\.0\.0\.1:\d+/g, 'rel'));

  // ---- F2: archivo de 97 KB de A a B por el buzón de archivos, los dos con datos ----
  await sleep(2000);
  const l2 = logs.length, b0 = A.up.blobBytes, f0 = A.up.blobFrames;
  const file = await sendFile(A, 'nota_de_voz.bin', FILE_BYTES, 4242);
  const b64 = file.toString('base64');
  const RX_START = /\[A\] log: \[BLOB\] .* → buzón de archivos: cifro/, RX_END = /\[A\] log: \[BLOB\] .* trozos en \d+ relés/;
  const staged = await waitFor(() => logs.slice(l2).some((l) => RX_END.test(l)), 120000, 100);
  const iS = logs.findIndex((l, i) => i >= l2 && RX_START.test(l)), iE = logs.findIndex((l, i) => i >= l2 && RX_END.test(l));
  r.F2_subida_s = staged === null || iS < 0 ? null : Math.round((logT[iE] - logT[iS]) / 100) / 10; // de «cifro una vez y subo» a «N trozos en M relés»
  // lo subido de TROZOS del buzón (eventos kind 1064; sin el resto del tráfico)
  r.F2_subido_kb = Math.round((A.up.blobBytes - b0) / 1024);
  r.F2_envios_de_trozo = A.up.blobFrames - f0;
  r.F2_subido_por_kb_de_archivo = Math.round(10 * (A.up.blobBytes - b0) / FILE_BYTES) / 10;
  r.F2_llega_s = await waitFor(() => findFile(B, idA, b64).then((x) => !!x), 120000, 300);
  const msgB = await findFile(B, idA, b64);
  const ptr = msgB && msgB.attachmentMeta && msgB.attachmentMeta.blobPtr;
  r.F2_por = ptr ? 'buzón de archivos' : (msgB ? 'otro camino (reenvío de pendientes por trozos)' : null);
  r.F2_puntero_reles = ptr ? ptr.relays.map(RN).join(',') : null;
  // cada trozo, en cuántos relés quedó (lo guardado en los relés de prueba)
  const per = new Map(); rel.forEach((x) => x.events.filter((e) => e.kind === 1064).forEach((e) => per.set(e.id, (per.get(e.id) || 0) + 1)));
  r.F2_copias_por_trozo = per.size ? Array.from(per.values()).join(',') : null;
  r.F2_trozos_por_rele = rel.map((x) => x.events.filter((e) => e.kind === 1064).length).join(',');
  r.F2_registro = logs.slice(l2).filter((l) => /\[A\] log: \[BLOB\] .* trozos en/.test(l)).slice(0, 1).map((l) => l.replace(/^.*\[BLOB\] \S+: /, ''));
  await sleep(3000);

  // ---- F3: mezclas Wi-Fi / datos ----
  setNet(A, 'wifi');
  r.F3a_asentado_s = await waitFor(() => settled(A, RELAYS.length)() && settled(B, want)(), 20000);
  await sleep(3000);
  r.F3a_suscripciones = { A: subs(A).escucha, B: subs(B).escucha };
  r.F3a_A_wifi_a_B_datos_s = await sendWait(A, B, idB, idA, 'A con Wi-Fi a B con datos');
  r.F3a_B_datos_a_A_wifi_s = await sendWait(B, A, idA, idB, 'B con datos a A con Wi-Fi');
  setNet(A, 'cell'); await sleep(1000); setNet(B, 'wifi');
  r.F3b_asentado_s = await waitFor(() => settled(A, want)() && settled(B, RELAYS.length)(), 20000);
  await sleep(3000);
  r.F3b_suscripciones = { A: subs(A).escucha, B: subs(B).escucha };
  r.F3b_A_datos_a_B_wifi_s = await sendWait(A, B, idB, idA, 'A con datos a B con Wi-Fi');
  r.F3b_B_wifi_a_A_datos_s = await sendWait(B, A, idA, idB, 'B con Wi-Fi a A con datos');

  // ---- F4: uno de los 2 relés que escucha B (con datos) se cae y vuelve ----
  setNet(B, 'cell');
  await waitFor(() => settled(A, want)() && settled(B, want)(), 20000);
  await sleep(3000);
  const before = subs(B).escucha;
  r.F4_antes = before;
  const firstU = RELAYS.find((u) => before.split(',').indexOf(RN(u)) >= 0), fx = rel[RELAYS.indexOf(firstU)], port = Number(firstU.split(':').pop());
  const l4 = logs.length;
  await fx.stop();
  r.F4_cae = RN(firstU);
  r.F4_B_pasa_al_siguiente_s = await waitFor(() => { const s = subs(B); return s.sub === want && s.escucha.indexOf(RN(firstU)) < 0; }, 15000);
  r.F4_B_escucha = subs(B).escucha;
  r.F4_A_escucha = subs(A).escucha;
  r.F4_A_a_B_s = await sendWait(A, B, idB, idA, 'con un relé caído, de A');
  r.F4_B_a_A_s = await sendWait(B, A, idA, idB, 'con un relé caído, de B');
  r.F4_registro = logs.slice(l4).filter((l) => /\[B\] log: \[NET\] Datos móviles: escucho/.test(l)).slice(0, 2).map((l) => l.replace(/^.*\[NET\] /, '').replace(/127\.0\.0\.1:\d+/g, (h) => RN('ws://' + h)));
  await fx.start(port);
  r.F4_vuelve_s = await waitFor(() => subs(B).escucha === before && subs(A).sub === want, 40000);
  r.F4_tras_volver_A_a_B_s = await sendWait(A, B, idB, idA, 'el relé volvió');

  // ---- F5: un texto que queda solo en los relés que B no escucha; B pasa al Wi-Fi ----
  await sleep(2000);
  const noOye = RELAYS.filter((u) => subs(B).escucha.split(',').indexOf(RN(u)) < 0);
  r.F5_B_no_escucha = noOye.map(RN).join(',');
  const pubOrig = net(A)._publish;
  net(A)._publish = function (ev, only) { return pubOrig.call(this, ev, only || noOye); }; // a A solo le abren esos
  const t5 = 'solo en los relés que B no escucha';
  sendText(A, t5);
  r.F5_con_datos_llega_s = await waitFor(got(B, idA, t5), 8000);
  net(A)._publish = pubOrig;
  const reqB0 = B.up.reqs.length, lastSeenB = net(B).state.lastSeen;
  setNet(B, 'wifi');
  r.F5_al_wifi_llega_s = r.F5_con_datos_llega_s !== null ? 0 : await waitFor(got(B, idA, t5), 20000);
  const sinceOf = B.up.reqs.slice(reqB0).filter((q) => noOye.indexOf(String(q.url).replace(/\/$/, '')) >= 0).map((q) => q.since);
  r.F5_pedido_a_los_no_escuchados = sinceOf.length ? Math.round((lastSeenB / 1000 - Math.min.apply(null, sinceOf))) + ' s antes de lo último visto' : null;

  r.errores = logs.filter((l) => / error: /.test(l) && !/JSDOMERROR|styles\.css|Not implemented|GLOBAL TIMEOUT|net::ERR|fetch/.test(l)).slice(0, 5);
  const F1 = r.F1_bajado;
  r.ahorro = {
    escucha_2: r.F1_suscripciones.A.sub === want && r.F1_suscripciones.B.sub === want && r.F1_suscripciones.A.open === RELAYS.length && r.F1_suscripciones.A.escucha === r.F1_suscripciones.B.escucha,
    repetidos: F1.repetidos <= 3 * F1.nuevos,
    copias_2: !!r.F2_copias_por_trozo && r.F2_copias_por_trozo.split(',').every((x) => x === '2'),
    subida: r.F2_subido_por_kb_de_archivo <= 3.2, // 2 copias en base64 (×1,33) ≈ 2,7; 4 copias ≈ 5,4
  };
  r.llegan = {
    F1: r.F1_llegan === lleg.length + '/' + lleg.length && r.F1_acuses_A === '5/5' && r.F1_en_linea_s !== null,
    F2: r.F2_llega_s !== null,
    F3: [r.F3a_A_wifi_a_B_datos_s, r.F3a_B_datos_a_A_wifi_s, r.F3b_A_datos_a_B_wifi_s, r.F3b_B_wifi_a_A_datos_s].every((x) => x !== null && x <= 15),
    F4: r.F4_B_pasa_al_siguiente_s !== null && r.F4_B_pasa_al_siguiente_s <= 8 && r.F4_A_a_B_s !== null && r.F4_B_a_A_s !== null && r.F4_vuelve_s !== null && r.F4_tras_volver_A_a_B_s !== null,
    F5: r.F5_al_wifi_llega_s !== null && r.F5_al_wifi_llega_s <= 15,
  };
  const ok = r.en_linea_por_internet_s !== null && r.F1_asentado_s !== null && Object.values(r.ahorro).every(Boolean) && Object.values(r.llegan).every(Boolean) && !r.errores.length;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('DATOSMOVILES ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_datosmoviles.txt'), logs.join('\n'));
  shutdown(A); shutdown(B); for (const x of rel) { try { await x.stop(); } catch (e) {} }
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('DATOSMOVILES ' + JSON.stringify({ prueba: 'datosmoviles', resultado: 'FALLO', error: String(e && e.message).replace(/"/g, "'") })); console.error(e && e.stack); fs.writeFileSync(path.join(__dirname, 'last_logs_datosmoviles.txt'), logs.join('\n')); process.exit(1); });
