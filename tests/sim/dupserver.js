// 3167 (diagnóstico S24 «nx1n36c283» ↔ realme «nx0v74707a», los dos en la 3075, 16-11 15:16–15:17 hora de México; síntoma
// automático «enlace_abre_cierra: 3 cierres por enlace repetido en 10 min»): con DOS enlaces entre los mismos dos teléfonos (cada uno
// cliente del otro), el desempate 3027 manda al de NEXO ID menor quedarse su enlace de CLIENTE y cerrar el de SERVIDOR (el que el
// otro abrió hacia él). Para cerrar, el JS llamaba a disconnectDevice, que en el nativo solo cierra el lado CLIENTE (gattClients):
// un enlace ENTRANTE (el otro es cliente de MI servidor GATT) no se cerraba; el JS lo daba por cerrado, el otro seguía mandando
// por él (RX en el servidor, notificaciones de 20 B con MTU 23) y cada 60 s se volvía a «cerrar» (3 cierres en 10 min).
// Aquí el de NEXO ID mayor tiene ese segundo enlace como el de su chat abierto (el de más MTU de su lado: no lo corta, «ocupado»),
// así que el que tiene que cerrarlo es el menor, desde su servidor (disconnectDevice con server: true).
// 3167b: el nativo del mayor (Kotlin startAutoReconnect) reabre solo a los ~1,5–3 s un enlace de cliente que el otro cortó, si
// está escaneando (aquí los dos escanean sin parar, como el S24 con la presencia/re-búsqueda). Con la 3167 sola (69e317c4) el
// enlace volvía; ahora el JS del mayor cancela esos reintentos si le queda otro enlace listo con ese contacto, y el desempate
// ya no cuenta «ocupado» (chat abierto) un enlace que el otro cortó.
//  S1  tras el desempate queda UN enlace físico entre los dos, y es el que dice 3027 (su cliente es el de NEXO ID menor);
//  S2  cada JS ve un solo enlace Bluetooth listo con el otro, el mismo enlace físico;
//  S3  los textos llegan en los dos sentidos y cada teléfono manda por UN solo enlace (no por los dos);
//  S5  carrera: si el nativo del mayor llega a reabrir L2 (con su chat aún apuntando ahí), lo cierra el propio mayor (≤ 30 s);
//  S4  el menor no vuelve a «cerrar el repetido» (1 cierre en ~75 s; antes, uno cada 60 s);
//  S6  con un ÚNICO enlace que el otro corta, el nativo sigue reconectando (el JS no cancela) y el texto llega.
// 3327 (🔴 1, zombis del S24 24-11): los repetidos los decide SOLO el de NEXO ID menor y se queda el enlace MÁS RECIENTE (aquí L2, el
// que el mayor abrió después); el chat abierto no le frena. El mayor no cierra nada: solo ve caer L1. S5 pasa a ser la carrera del
// lado que decide: si su nativo reabre L1 (el que cerró), no se lo queda por «nuevo» ni cierra L2 (vaivén). S6: el único enlace (L2)
// lo corta el menor desde su servidor; el nativo del mayor lo reabre y su JS no lo impide.
// Uso: node dupserver.js <dir_build> [--mtu23]   (imprime DUPSERVER {json} con "resultado":"OK"|"FALLO"; sale 0/1)
// --mtu23: el enlace que se queda va a MTU 23; el escaneo del mayor querría reabrir el cortado (excepción de 3019) y no debe.
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone, installWebCrypto } = require('./native_mock');

const buildDir = path.resolve(process.argv[2] || path.join(__dirname, 'builds/wip'));
// --mtu23: el enlace que se queda (L1) va al mínimo; el mayor querría abrir otro mejor al verlo en el escaneo (excepción de 3019)
const MTU23 = process.argv.includes('--mtu23');
const LOGF = 'last_logs_dupserver' + (MTU23 ? '_mtu23' : '') + '.txt';
// --sin-tomar (3262): el Kotlin de antes (cancelConnection sin «tener» el enlace = no corta nada en Android): contraprueba, debe FALLAR
const NOHOLD = process.argv.includes('--sin-tomar');
const base = { serverCutNoHold: NOHOLD, readsContentFallback: true, retain: ['onPayloadReceived', 'onLanMessage', 'onLanUp', 'onLanDown'], closeOnNoService: true, pace: [15, 15], ioDelay: 25, asymmetric: true, noTor: true, wifi: null };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
class DL extends ResourceLoader { constructor(d) { super(); this.d = d; } fetch(u) { const f = path.join(this.d, decodeURIComponent(new URL(u).pathname)); return fs.existsSync(f) ? Promise.resolve(fs.readFileSync(f)) : Promise.reject(new Error('x')); } }
const logs = [];
const T0 = Date.now();
const ts = () => String(((Date.now() - T0) / 1000).toFixed(1)).padStart(6) + 's';
const norm = (m) => String(m || '').toLowerCase().replace(/[^0-9a-z]/g, '');
async function boot(name, native) {
  native.listeners = new Map();
  const vc = new VirtualConsole();
  ['log', 'warn', 'error'].forEach((l) => vc.on(l, (...a) => logs.push(`${ts()} [${name}] ${l}: ` + a.map(String).join(' ').substring(0, 260))));
  const dom = new JSDOM(fs.readFileSync(path.join(buildDir, 'dist', 'index.html'), 'utf8'), {
    url: 'https://' + name.toLowerCase() + '.nexo.test/index.html', runScripts: 'dangerously', resources: new DL(path.join(buildDir, 'dist')), pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) {
      win.NEXO_NET_RELAYS = []; win.CapacitorCustomPlatform = { name: 'android' }; installWebCrypto(win);
      const pl = native.plugin();
      // registro de llamadas JS → nativo: solo disconnectDevice (lo demás no hace falta y pesa)
      native.calls = { push(x) { if (x && x.name === 'disconnectDevice') (native.discs = native.discs || []).push(x.args); }, length: 0, filter() { return []; }, slice() { return []; }, forEach() {}, map() { return []; }, some() { return false; }, find() { return undefined; } };
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
async function addFound(p, name) {
  let add = null;
  const find = () => { const row = Array.from(p.win.document.querySelectorAll('#ble-new-device > div')).find((d) => (d.querySelector('span') || {}).textContent === name); return row && row.querySelector('button'); };
  for (let i = 0; i < 400 && !add; i++) { await sleep(100); add = find(); if (!add && !p.win.bleInterface.isScanning) click(p.win, p.win.document.getElementById('ble-scan-btn')); }
  click(p.win, add); await sleep(2000);
  return !!add;
}
async function waitFor(fn, ms) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return Math.round((Date.now() - t0) / 100) / 10; await sleep(250); } return null; }
// Enlaces Bluetooth LISTOS que el JS de p tiene con nx (claves = direcciones normalizadas)
function jsReady(p, nx) {
  const bi = p.win.bleInterface, out = [];
  bi._deviceStates.forEach((st, key) => {
    if (/^(lan|net)nx/.test(key)) return;
    if (st.state !== 'ready_to_chat' && st.state !== 'notifications_ready') return;
    if (String(bi._macToNexoId.get(key) || '').toLowerCase() === nx) out.push(key);
  });
  return out.sort();
}

(async () => {
  const r = { prueba: 'dupserver', build: path.basename(buildDir) };
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', Object.assign({}, base)), nB = new NativePhone('B', 'BB:BB:BB:BB:BB:02', Object.assign({}, base));
  [nA, nB].forEach((n) => { radio.add(n); n.load(); });
  const A = await boot('A', nA); const B = await boot('B', nB);
  const idA = A.win.bleInterface.localNexoId.toLowerCase(), idB = B.win.bleInterface.localNexoId.toLowerCase();
  // lo = el de NEXO ID menor (el realme del diagnóstico), hi = el mayor (el S24)
  const [lo, hi] = idA < idB ? [A, B] : [B, A];
  const idLo = lo === A ? idA : idB, idHi = hi === A ? idA : idB;
  // L1: el menor es CLIENTE del mayor (el que 3027 manda quedarse); menos MTU que L2 (185, o 23 con --mtu23)
  lo.native.opts.mtu = MTU23 ? 23 : 185;
  r.mtu_L1 = lo.native.opts.mtu;
  lo.win.bleInterface.togglePanel(); const paired = await addFound(lo, hi.name); lo.win.bleInterface.togglePanel();
  if (!paired) { console.log('DUPSERVER ' + JSON.stringify(Object.assign(r, { resultado: 'FALLO', error: 'no empareja' }))); process.exit(1); }
  await openChatWith(lo, hi.name); sendText(lo, 'hola ' + hi.name); await sleep(2000);
  await openChatWith(hi, lo.name); sendText(hi, 'hola ' + lo.name); await sleep(3000);
  // Los dos escanean sin parar (un escaneo dura 6 s; se rearranca cada 5 s): la dirección del otro queda en scannedDevices
  const scanT = setInterval(() => [lo, hi].forEach((p) => { try { p.win.Capacitor.Plugins.NexoBLE.startScan({ filtered: true }); } catch (e) {} }), 5000);
  [lo, hi].forEach((p) => { try { p.win.Capacitor.Plugins.NexoBLE.startScan({ filtered: true }); } catch (e) {} });
  // L2: el mayor abre OTRO enlace como cliente del menor (a su dirección de anuncio), MTU 512
  const K = {
    loL1: norm(hi.native.address), loL2: norm(hi.native.initAddress), // en el menor: L1 = su cliente, L2 = su servidor
    hiL1: norm(lo.native.initAddress), hiL2: norm(lo.native.address), // en el mayor: L1 = su servidor, L2 = su cliente
  };
  await hi.win.bleInterface._autoConnectGATT(lo.native.address, { name: lo.name, deviceUUID: idLo }, { manual: true });
  r.L2_listo_s = await waitFor(() => jsReady(lo, idHi).length === 2 && jsReady(hi, idLo).length === 2, 20000);
  const lblLo = (k) => k === K.loL1 ? 'L1' : k === K.loL2 ? 'L2' : k, lblHi = (k) => k === K.hiL1 ? 'L1' : k === K.hiL2 ? 'L2' : k;
  r.antes = { menor: jsReady(lo, idHi).map(lblLo), mayor: jsReady(hi, idLo).map(lblHi) };
  if (r.L2_listo_s === null) { console.log('DUPSERVER ' + JSON.stringify(Object.assign(r, { resultado: 'FALLO', error: 'no hay dos enlaces listos en los dos' }))); fs.writeFileSync(path.join(__dirname, LOGF), logs.join('\n')); process.exit(1); }
  // El mayor reabre su chat: ahora va por L2 (el de más MTU de su lado) → para él L2 está «ocupado» (chat activo) y no lo corta
  click(hi.win, hi.win.document.getElementById('chat-back-btn'));
  await sleep(300);
  await openChatWith(hi, lo.name);
  r.chat_mayor_por = lblHi(norm(hi.win.bleInterface._activeChatDeviceIdNative));
  // Sin esto no es el caso del diagnóstico (el mayor cerraría L2 desde su lado cliente y el menor no tendría nada que cortar)
  r.escenario_ok = r.chat_mayor_por === 'L2';
  const mark = logs.length;
  // Desempate (supervisor cada 6 s, los repetidos deben coexistir 12 s); luego ~75 s para ver si el menor vuelve a «cerrar»
  const firstClose = await waitFor(() => logs.slice(mark).some((l) => l.includes('[' + lo.name + '] log: [BLEInterface] Dedup: cierro enlace repetido')), 45000);
  r.desempate_s = firstClose;
  const tClose = Date.now();
  await sleep(firstClose === null ? 0 : 8000);
  // S1: enlaces físicos (lado cliente / lado servidor de cada uno)
  const L1 = { cliente: lo.native.clients.has(K.loL1), servidor: hi.native.serverConnected.has(K.hiL1) };
  const L2 = { cliente: hi.native.clients.has(K.hiL2), servidor: lo.native.serverConnected.has(K.loL2) };
  r.S1_fisicos = { L1, L2 };
  r.S1_ok = !L1.cliente && !L1.servidor && L2.cliente && L2.servidor; // 3327: se queda L2 (el más reciente)
  // S2: lo que ve cada JS
  r.S2_menor = jsReady(lo, idHi).map(lblLo);
  r.S2_mayor = jsReady(hi, idLo).map(lblHi);
  r.S2_ok = r.S2_menor.join() === 'L2' && r.S2_mayor.join() === 'L2';
  r.disconnect_menor = (lo.native.discs || []).map((a) => ({ id: lblLo(norm(a.deviceId)), server: !!a.server }));
  // S3: textos en los dos sentidos; por qué enlaces sale cada uno
  const sLo = lo.native.sent.length, sHi = hi.native.sent.length;
  const tLo = ['a1', 'a2', 'a3'].map((x) => 'del menor ' + x), tHi = ['b1', 'b2', 'b3'].map((x) => 'del mayor ' + x);
  for (let i = 0; i < 3; i++) { sendText(lo, tLo[i]); await sleep(400); }
  for (let i = 0; i < 3; i++) { sendText(hi, tHi[i]); await sleep(400); } // su chat sigue abierto (y apuntando a L2)
  const delivered = async (p, peer, texts) => { const ms = await p.win.vaultLoadMessages(peer); return texts.every((t) => ms.some((m) => m._own && m.content === t && /delivered|read/.test(m.status))); };
  r.S3_entregados_s = await waitFor(async () => (await delivered(lo, idHi, tLo)) && (await delivered(hi, idLo, tHi)), 30000);
  const por = (sent, from, lbl) => [...new Set(sent.slice(from).map((x) => lbl(x.to)).filter((x) => x === 'L1' || x === 'L2'))].sort();
  r.S3_menor_por = por(lo.native.sent, sLo, lblLo);
  r.S3_mayor_por = por(hi.native.sent, sHi, lblHi);
  r.S3_ok = r.S3_entregados_s !== null && r.S3_menor_por.join() === 'L2' && r.S3_mayor_por.join() === 'L2';
  r.reabre_nativo = { menor: lo.native.stats.nativeReconnects || 0, sin_cache: lo.native.stats.reconnNoCache || 0 };
  // S5 (3327): el nativo del menor reabre L1 (el que cerró por repetido); no debe quedárselo por «más nuevo» ni cerrar L2: vuelve a
  // cerrar L1 (o lo deja) y L2 sigue en pie todo el rato
  r.S5_chat_mayor_por = lblHi(norm(hi.win.bleInterface._activeChatDeviceIdNative));
  if (!lo.native.clients.has(K.loL1)) lo.native._connectClient(hi.native, null);
  let l2Cayo = false; const t5 = Date.now();
  while (Date.now() - t5 < 30000) { if (!hi.native.clients.has(K.hiL2) || !lo.native.serverConnected.has(K.loL2)) l2Cayo = true; await sleep(250); }
  r.S5_L2_cayo = l2Cayo;
  r.S5_cerrado_s = null;
  r.S5_ok = !l2Cayo && !logs.slice(mark).some((l) => l.includes('Dedup: cierro enlace repetido ' + K.loL2) || l.includes('Dedup: cierro enlace repetido ' + K.hiL2));
  // S4: cierres por «enlace repetido» del menor (hasta ~75 s después del primero)
  if (firstClose !== null) { const tEnd = tClose + 75000; while (Date.now() < tEnd) await sleep(1000); }
  const L = logs.slice(mark);
  r.S4_cierres_menor = L.filter((l) => l.includes('[' + lo.name + '] log: [BLEInterface] Dedup: cierro enlace repetido')).length;
  r.S4_cierres_mayor = L.filter((l) => l.includes('[' + hi.name + '] log: [BLEInterface] Dedup: cierro enlace repetido')).length;
  // 3327: y pasado el enfriamiento (60 s) L2 sigue en pie (antes de mirar «since» de lo ya cerrado, a los 84 s cerraba L2: vaivén)
  r.S4_L2_sigue = hi.native.clients.has(K.hiL2) && lo.native.serverConnected.has(K.loL2);
  r.S4_ok = r.S4_L2_sigue && r.S4_cierres_menor >= 1 && r.S4_cierres_menor <= 2 && r.S4_cierres_mayor === 0; // 3327: el mayor no cierra nunca; el menor, L1 (y otra vez si su nativo lo reabre, S5)
  // S6: un ÚNICO enlace (L2) que corta el otro (el menor, desde su servidor): el nativo del mayor lo reabre y su JS no lo impide
  const d0 = (hi.native.discs || []).length, n0 = hi.native.stats.nativeReconnects || 0;
  const srvKeys = [...lo.native.serverConnected.entries()].filter(([, v]) => v === hi.native).map(([k]) => k);
  r.S6_claves_servidor = srvKeys.map((k) => (k === norm(hi.native.initAddress) ? 'init' : k === norm(hi.native.address) ? 'adv' : 'otra'));
  let cutAt = null; const delOrig = hi.native.clients.delete.bind(hi.native.clients);
  hi.native.clients.delete = (k) => { if (k === K.hiL2 && hi.native.clients.has(k) && cutAt === null) cutAt = Date.now(); return delOrig(k); };
  await lo.win.Capacitor.Plugins.NexoBLE.disconnectDevice({ deviceId: srvKeys[0] || hi.native.initAddress, server: true });
  r.S6_cortado = await waitFor(() => cutAt !== null || !hi.native.clients.has(K.hiL2), 3000) !== null;
  hi.native.clients.delete = delOrig;
  r.S6_datos = { clave: srvKeys[0] || null, sigue_en_servidor: lo.native.serverConnected.has(srvKeys[0]), cancelaciones: lo.native.stats.serverCancels || 0, clientes_mayor: [...hi.native.clients.keys()].map(lblHi) };
  await sleep(300);
  r.S6_reintento_pendiente = hi.native.reconnTimers.has(K.hiL2); // el JS no lo canceló (era el único enlace)
  r.S6_vuelve_s = await waitFor(() => jsReady(lo, idHi).length > 0 && jsReady(hi, idLo).length > 0, 20000);
  r.S6_reabre_nativo = (hi.native.stats.nativeReconnects || 0) - n0;
  r.S6_cancela_js = (hi.native.discs || []).slice(d0).filter((a) => norm(a.deviceId) === K.hiL2).length;
  const t6 = 'tras volver a conectar';
  sendText(hi, t6);
  r.S6_entregado_s = await waitFor(async () => delivered(hi, idLo, [t6]), 20000);
  r.S6_ok = r.S6_cortado && r.S6_reintento_pendiente && r.S6_vuelve_s !== null && r.S6_cancela_js === 0 && r.S6_entregado_s !== null;
  clearInterval(scanT);
  r.errores = logs.filter((l) => / error: /.test(l) && !/JSDOMERROR|styles\.css|Not implemented|GLOBAL TIMEOUT|net::ERR|fetch/.test(l)).slice(0, 5);
  const ok = r.escenario_ok && r.S1_ok && r.S2_ok && r.S3_ok && r.S5_ok && r.S4_ok && r.S6_ok && !r.errores.length;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('DUPSERVER ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, LOGF), logs.join('\n'));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('DUPSERVER ' + JSON.stringify({ prueba: 'dupserver', resultado: 'FALLO', error: String(e && e.message).replace(/"/g, "'") })); console.error(e && e.stack); fs.writeFileSync(path.join(__dirname, LOGF), logs.join('\n')); process.exit(1); });
