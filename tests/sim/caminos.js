// Dueño 13-11 — MEDICIÓN de caminos: «pruebas de robustez, velocidad, reactividad de conexión y cambio de conexión de
// internet, Wi-Fi, Wi-Fi Direct, Jump, Bluetooth, y de la última implementación Bluetooth/internet y Wi-Fi Direct/internet».
// Tres teléfonos (A, B, C), todos con Wi-Fi Direct; el mismo A recorre los caminos uno tras otro y se mide:
//   velocidad   — cuánto tarda un texto (mediana de 3) y una foto/archivo por cada camino;
//   reactividad — cuánto tarda en subir un camino (Wi-Fi local, Bluetooth al volver, el puente, el internet propio);
//   cambio      — un texto mandado JUSTO al caerse el camino que se usaba: cuánto tarda en llegar por el siguiente;
//   robustez    — nada se pierde ni se duplica (todos los textos llegan una sola vez).
// Caminos: Bluetooth directo, Wi-Fi Direct, Wi-Fi local, Jump (A–B–C), internet (relés), puente Bluetooth→internet y
// puente Wi-Fi Direct→internet. Tiempos del simulador (Bluetooth a ~20 KB/s, Wi-Fi Direct ~2 MB/s con ~3,5 s de montaje);
// en teléfonos reales cambian, pero el orden y los saltos entre caminos son los de la app.
// Uso: node caminos.js <dir_build>
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone, installWebCrypto } = require('./native_mock');
const { NostrRelay } = require('./nostr_relay');

const buildDir = path.resolve(process.argv[2] || path.join(__dirname, 'builds/wip'));
const base = { readsContentFallback: true, retain: ['onPayloadReceived', 'onLanMessage', 'onLanUp', 'onLanDown', 'onWifiDirectReceived'], closeOnNoService: true, pace: [15, 15], ioDelay: 25, asymmetric: true, noTor: true, wifiDirect: true };
let RELAYS = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
class DL extends ResourceLoader { constructor(d) { super(); this.d = d; } fetch(u) { const f = path.join(this.d, decodeURIComponent(new URL(u).pathname)); return fs.existsSync(f) ? Promise.resolve(fs.readFileSync(f)) : Promise.reject(new Error('x')); } }
const logs = [];
const T0 = Date.now();
const ts = () => String(((Date.now() - T0) / 1000).toFixed(1)).padStart(6) + 's';
// Sin antena: ningún relé contesta (como un teléfono sin datos ni Wi-Fi con salida)
class NoNetWS { constructor(u) { this.url = u; this.readyState = 0; setTimeout(() => { this.readyState = 3; if (this.onerror) this.onerror({}); if (this.onclose) this.onclose({}); }, 30); } send() { throw new Error('sin red'); } close() {} }
async function boot(name, native) {
  native.listeners = new Map();
  native.calls = { push() {}, length: 0, filter() { return []; }, slice() { return []; }, forEach() {}, map() { return []; }, some() { return false; }, find() { return undefined; } };
  const vc = new VirtualConsole();
  ['log', 'warn', 'error'].forEach((l) => vc.on(l, (...a) => logs.push(`${ts()} [${name}] ${l}: ` + a.map(String).join(' ').substring(0, 260))));
  const dom = new JSDOM(fs.readFileSync(path.join(buildDir, 'dist', 'index.html'), 'utf8'), {
    url: 'https://' + name.toLowerCase() + '.nexo.test/index.html', runScripts: 'dangerously', resources: new DL(path.join(buildDir, 'dist')), pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) {
      win.NEXO_NET_RELAYS = RELAYS; win.CapacitorCustomPlatform = { name: 'android' }; installWebCrypto(win);
      win.Capacitor = { Plugins: { NexoBLE: native.plugin() } }; win.HTMLElement.prototype.scrollTo = function () {};
      // internet que se puede quitar y devolver (win.__noNet)
      const Real = win.WebSocket; win.__noNet = true;
      win.WebSocket = function (u) { return win.__noNet ? new NoNetWS(u) : new Real(u); };
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
async function closeChat(p) { p.win.dispatchEvent(new p.win.CustomEvent('nexo:ble:closeChat', { detail: {} })); await sleep(300); }
function typeSend(p, t) { const i = p.win.document.getElementById('message-input'); i.value = t; i.dispatchEvent(new p.win.Event('input', { bubbles: true })); click(p.win, p.win.document.getElementById('send-btn')); }
async function addFound(p, name) {
  let add = null;
  const find = () => { const row = Array.from(p.win.document.querySelectorAll('#ble-new-device > div')).find((d) => (d.querySelector('span') || {}).textContent === name); return row && row.querySelector('button'); };
  for (let i = 0; i < 400 && !add; i++) { await sleep(100); add = find(); if (!add && !p.win.bleInterface.isScanning) click(p.win, p.win.document.getElementById('ble-scan-btn')); }
  click(p.win, add); await sleep(2500);
  return !!add;
}
async function waitFor(fn, ms) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return Math.round((Date.now() - t0) / 100) / 10; await sleep(200); } return null; }
function shutdown(p) { try { p.win.bleInterface.net._closeAll(); p.win.bleInterface.net.relays.forEach((rl) => { rl.retryAt = Date.now() + 9e6; }); } catch (e) {} }
function makeFile(name, bytes) { let h = 0; for (const ch of name) h = (h * 33 + ch.charCodeAt(0)) & 0xffff; const b = Buffer.alloc(bytes); for (let i = 0; i < b.length; i++) b[i] = (i * 31 + h + (i >> 9)) & 255; return b; }

(async () => {
  const r = { prueba: 'caminos', build: path.basename(buildDir) };
  const r1 = new NostrRelay(), r2 = new NostrRelay();
  RELAYS = [await r1.start(), await r2.start()];
  const radio = new Radio();
  const nat = { A: new NativePhone('A', 'AA:AA:AA:AA:AA:01', base), B: new NativePhone('B', 'BB:BB:BB:BB:BB:02', base), C: new NativePhone('C', 'CC:CC:CC:CC:CC:04', base) };
  Object.values(nat).forEach((n) => { radio.add(n); n.load(); });
  const P = { A: await boot('A', nat.A), B: await boot('B', nat.B), C: await boot('C', nat.C) };
  const id = (n) => P[n].win.bleInterface.localNexoId.toLowerCase();
  const names = ['A', 'B', 'C'];
  const sent = []; // { from, to, tag }
  const setNet = (n, on) => {
    const w = P[n].win; w.__noNet = !on;
    if (!on) w.bleInterface.net.relays.forEach((rl) => { if (!rl.gw && rl.ws) { try { rl.ws.close(); } catch (e) {} } });
  };
  const joinWifi = (n, net) => { nat[n].setWifi(net); if (net) setTimeout(() => nat[n].emit('onLanNet', { wifi: true }), 1500); }; // como el nativo (onAvailable + 1,5 s)
  const link = (a, b) => P[a].win.bleInterface.linkOf(id(b));
  const got = async (to, from, tag) => (await P[to].win.vaultLoadMessages(id(from))).filter((m) => !m._own && String(m.text || m.content || '').indexOf(tag) >= 0).length;
  let open = { A: null, B: null, C: null };
  async function chat(a, b) { if (open[a] !== b) { if (open[a]) await closeChat(P[a]); await openChatWith(P[a], b); open[a] = b; } }
  // Un texto de a a b: segundos hasta que está en el chat de b (null = no llegó en `ms`)
  async function text(a, b, label, ms) {
    await chat(a, b);
    const tag = label + '-' + Math.random().toString(36).slice(2, 7);
    mark('texto ' + a + '→' + b + ' ' + tag);
    sent.push({ from: a, to: b, tag });
    const t0 = Date.now(); typeSend(P[a], 'medida ' + tag);
    const s = await waitFor(async () => (await got(b, a, tag)) > 0, ms || 60000);
    return s === null ? null : Math.round((Date.now() - t0) / 100) / 10;
  }
  async function text3(a, b, label) { const v = []; for (let i = 0; i < 3; i++) { v.push(await text(a, b, label + i)); await sleep(300); } if (v.some((x) => x === null)) return null; v.sort((x, y) => x - y); return v[1]; }
  async function file(a, b, name, bytes, ms) {
    await chat(a, b);
    const buf = makeFile(name, bytes), b64 = buf.toString('base64');
    mark('archivo ' + a + '→' + b + ' ' + name + ' ' + Math.round(bytes / 1024) + ' KB');
    const t0 = Date.now();
    click(P[a].win, P[a].win.document.querySelector('.attach-menu-item[data-type="file"]')); await sleep(100);
    const fin = Array.from(P[a].win.document.querySelectorAll('input[type=file]')).pop();
    Object.defineProperty(fin, 'files', { configurable: true, value: [new P[a].win.File([buf], name, { type: 'application/octet-stream' })] });
    fin.dispatchEvent(new P[a].win.Event('change'));
    const s = await waitFor(async () => (await P[b].win.vaultLoadMessages(id(a))).some((m) => !m._own && m.attachmentType && !m.deleted && (m.attachmentPayload || nat[b].files.get(m.attachmentRef)) === b64), ms || 120000);
    return s === null ? null : Math.round((Date.now() - t0) / 100) / 10;
  }
  const kbps = (bytes, s) => (s ? Math.round(bytes / 1024 / s) : null);
  const mark = (t) => logs.push(ts() + ' [TEST] ===== ' + t);
  const logCount = (re) => logs.filter((l) => re.test(l)).length;

  // ---------- preparación: A–B, A–C, B–C contactos, sin internet ----------
  async function pair(x, y) {
    const others = names.filter((n) => n !== x && n !== y);
    others.forEach((o) => radio.block(nat[x], nat[o]));
    P[x].win.bleInterface.togglePanel(); const ok = await addFound(P[x], y); P[x].win.bleInterface.togglePanel();
    await sleep(800);
    await chat(x, y); typeSend(P[x], 'hola ' + y); await sleep(2500);
    const keyOf = (a, b) => !!(P[a].win.vaultLoadContacts().find((c) => c.name === b) || {}).publicKey;
    for (let i = 0; i < 40 && !keyOf(x, y); i++) await sleep(500);
    others.forEach((o) => radio.unblock(nat[x], nat[o]));
    return ok;
  }
  for (const [x, y] of [['A', 'B'], ['A', 'C'], ['B', 'C']]) if (!(await pair(x, y))) { console.log('CAMINOS ' + JSON.stringify(Object.assign(r, { resultado: 'FALLO', error: 'no empareja ' + x + y }))); process.exit(1); }
  radio.block(nat.A, nat.C); // C lejos de A (B en medio)
  await sleep(3000);
  const v = r.velocidad = {}, re = r.reactividad = {}, ca = r.cambio = {};

  // 1. Bluetooth directo (sin internet ni Wi-Fi)
  mark('1 Bluetooth');
  v.texto_bluetooth_s = await text3('A', 'B', 'bt');
  r.enlace_bt = link('A', 'B');
  v.foto_60kb_bluetooth_s = await file('A', 'B', 'f60.jpg', 60 * 1024);
  v.bluetooth_kbs = kbps(60 * 1024, v.foto_60kb_bluetooth_s);
  mark('2 Wi-Fi Direct');
  // 2. Wi-Fi Direct (Bluetooth de control + Wi-Fi Direct para lo pesado)
  const wd0 = logCount(/\[A\].*\[WIFI-DIRECT\].*entregado en/);
  v.archivo_2mb_wifi_direct_s = await file('A', 'B', 'v2.mp4', 2 * 1024 * 1024, 180000);
  v.wifi_direct_kbs = kbps(2 * 1024 * 1024, v.archivo_2mb_wifi_direct_s);
  r.wifi_direct_usado = logCount(/\[A\].*\[WIFI-DIRECT\].*entregado en/) > wd0;
  mark('3 Wi-Fi local');
  // 3. Wi-Fi local (los dos entran a la misma red)
  joinWifi('A', 'casa'); joinWifi('B', 'casa');
  re.wifi_local_sube_s = await waitFor(() => !!(P.A.win.bleInterface.lan && P.A.win.bleInterface.lan.canReach(id('B'))), 60000);
  r.enlace_wifi = link('A', 'B');
  v.texto_wifi_s = await text3('A', 'B', 'lan');
  v.archivo_2mb_wifi_s = await file('A', 'B', 'w2.mp4', 2 * 1024 * 1024, 120000);
  v.wifi_kbs = kbps(2 * 1024 * 1024, v.archivo_2mb_wifi_s);
  mark('4 Wi-Fi→Bluetooth');
  // 4. Cambio Wi-Fi → Bluetooth: A sale de la red y manda al instante
  mark('4 A sale del Wi-Fi');
  joinWifi('A', null);
  ca.wifi_a_bluetooth_texto_s = await text('A', 'B', 'wifi2bt', 60000);
  r.enlace_tras_wifi = link('A', 'B');
  mark('5 Jump');
  // 5. Jump: A → C por B (sin internet)
  r.enlace_jump = link('A', 'C');
  v.texto_jump_s = await text3('A', 'C', 'jump');
  v.texto_jump_vuelta_s = await text('C', 'A', 'jumpv');
  mark('6 internet');
  // 6. Internet (relés): todos con internet; el Bluetooth A–B se corta
  names.forEach((n) => setNet(n, true));
  names.forEach((n) => { P[n].win.bleInterface.net.relays.forEach((rl) => { rl.retryAt = 0; }); P[n].win.bleInterface.net.tick(); }); // arranque: como al abrir la app
  re.internet_en_linea_s = await waitFor(() => P.A.win.bleInterface.net.online() && P.B.win.bleInterface.net.online(), 60000);
  await waitFor(() => P.A.win.bleInterface.net.canReach(id('C')), 30000);
  v.texto_internet_s = await text3('A', 'C', 'net');
  mark('6b corto Bluetooth A–B');
  radio.block(nat.A, nat.B);
  ca.bluetooth_a_internet_texto_s = await text('A', 'B', 'bt2net', 60000);
  r.enlace_tras_bt = link('A', 'B');
  v.foto_300kb_internet_s = await file('A', 'B', 'n300.jpg', 300 * 1024, 120000);
  // Bluetooth vuelve: ¿cuánto tarda en estar listo otra vez?
  radio.unblock(nat.A, nat.B);
  re.bluetooth_vuelve_s = await waitFor(() => { const st = P.A.win.bleInterface._getDeviceState(P.A.win.bleInterface._resolveDeviceIdForNexoId(id('B')) || '') || {}; return st.state === 'ready_to_chat' || st.state === 'notifications_ready'; }, 90000);
  mark('7 puente Bluetooth');
  // 7. Puente Bluetooth → internet: A pierde su internet; C lejos de los dos (solo por internet); B (en Wi-Fi) presta
  radio.block(nat.B, nat.C);
  P.A.win.bleInterface.wifiDirect.denied = true; // primero sin Wi-Fi Direct: todo por Bluetooth
  const tCut = Date.now(); setNet('A', false);
  ca.internet_a_puente_texto_s = await text('A', 'C', 'net2gw', 120000);
  re.puente_listo_s = (await waitFor(() => P.A.win.bleInterface.net.gw && P.A.win.bleInterface.net.gw.bridges.size && P.A.win.bleInterface.net.gwOnly(), 120000)) === null ? null : Math.round((Date.now() - tCut) / 100) / 10;
  r.enlace_puente = link('A', 'C');
  v.texto_puente_bt_s = await text3('A', 'C', 'gw');
  v.texto_puente_vuelta_s = await text('C', 'A', 'gwv');
  v.foto_120kb_puente_bt_s = await file('A', 'C', 'g120.jpg', 120 * 1024, 120000);
  v.puente_bt_kbs = kbps(120 * 1024, v.foto_120kb_puente_bt_s);
  mark('8 puente Wi-Fi Direct');
  // 8. Puente Wi-Fi Direct → internet
  P.A.win.bleInterface.wifiDirect.denied = false;
  const gwA = P.A.win.bleInterface.net.gw, wdUp0 = (gwA.stats || {}).wd || 0;
  v.archivo_2mb_puente_wd_s = await file('A', 'C', 'g2.mp4', 2 * 1024 * 1024, 180000);
  v.puente_wd_kbs = kbps(2 * 1024 * 1024, v.archivo_2mb_puente_wd_s);
  r.puente_paquetes_wd = ((gwA.stats || {}).wd || 0) - wdUp0;
  v.archivo_1_5mb_puente_wd_bajada_s = await file('C', 'A', 'c15.zip', 1536 * 1024, 180000);
  mark('9 vuelve internet');
  // 9. Vuelve el internet propio de A: ¿cuánto tarda en usarlo (y soltar el puente)?
  const tBack = Date.now(); setNet('A', true);
  re.internet_vuelve_s = await waitFor(() => P.A.win.bleInterface.net._realOpenCount() > 0, 180000);
  re.suelta_puente_s = await waitFor(() => !P.A.win.bleInterface.net.gw.bridges.size, 60000);
  if (re.suelta_puente_s !== null) re.suelta_puente_s = Math.round((Date.now() - tBack) / 100) / 10;
  ca.tras_volver_internet_texto_s = await text('A', 'C', 'gw2net', 60000);
  // 10. Robustez: todo lo medido llegó exactamente una vez
  await sleep(4000);
  let lost = 0, dup = 0;
  for (const m of sent) { const n = await got(m.to, m.from, m.tag); if (n === 0) lost++; if (n > 1) dup++; }
  r.robustez = { textos: sent.length, perdidos: lost, duplicados: dup };
  r.errores = logs.filter((l) => / error: /.test(l) && !/JSDOMERROR|styles\.css|Not implemented|GLOBAL TIMEOUT|net::ERR|fetch|ECONNREFUSED|WebSocket/.test(l)).slice(0, 5);
  const vals = Object.values(v).concat(Object.values(re), Object.values(ca));
  r.sin_medida = Object.entries(Object.assign({}, v, re, ca)).filter(([, x]) => x === null).map(([k]) => k);
  // Topes (3051; holgados frente a lo medido, para que la carga del simulador no dé falsos fallos). Contraprueba 3050: el
  // texto al salir del Wi-Fi tardaba 20 s, el puente ~113 s en armarse, el internet propio ~74 s en volver a usarse y el
  // archivo de 2 MB por el puente con Wi-Fi Direct no llegaba (se mandaba otra vez trozo a trozo y chocaba con el tope).
  const lento = [];
  const tope = (k, x, max) => { if (x !== null && x > max) lento.push(k + ' ' + x + ' s > ' + max); };
  Object.keys(v).filter((k) => /^texto_/.test(k)).forEach((k) => tope(k, v[k], 5));
  tope('wifi_a_bluetooth_texto_s', ca.wifi_a_bluetooth_texto_s, 5);
  tope('bluetooth_a_internet_texto_s', ca.bluetooth_a_internet_texto_s, 10);
  tope('internet_a_puente_texto_s', ca.internet_a_puente_texto_s, 20);
  tope('tras_volver_internet_texto_s', ca.tras_volver_internet_texto_s, 10);
  tope('puente_listo_s', re.puente_listo_s, 20);
  tope('internet_vuelve_s', re.internet_vuelve_s, 25);
  tope('archivo_2mb_puente_wd_s', v.archivo_2mb_puente_wd_s, 60);
  tope('archivo_1_5mb_puente_wd_bajada_s', v.archivo_1_5mb_puente_wd_bajada_s, 60);
  r.lento = lento;
  const ok = !r.sin_medida.length && !lento.length && lost === 0 && dup === 0 && r.wifi_direct_usado && r.puente_paquetes_wd >= 1 && !r.errores.length && vals.length > 0;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('CAMINOS ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_caminos.txt'), logs.join('\n'));
  names.forEach((n) => shutdown(P[n]));
  await r1.stop(); await r2.stop();
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('CAMINOS ' + JSON.stringify({ prueba: 'caminos', resultado: 'FALLO', error: String(e && e.message).replace(/"/g, "'") })); console.error(e && e.stack); fs.writeFileSync(path.join(__dirname, 'last_logs_caminos.txt'), logs.join('\n')); process.exit(1); });
