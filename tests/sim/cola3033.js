// 3033 — diagnósticos del 12-11 22:06–22:25 (S24 3027/3028 y Honor 3026):
//  1. PAUSA DE BLUETOOTH QUE SE SALTA: el S24 escribía «nx… sin servicio GATT 21 veces: pauso Bluetooth 600 s» y aun así
//     conectaba/cortaba con el Motorola cada 1–3 s. El resultado de escaneo llega con el contacto en nexoId (no deviceUUID) y
//     _autoConnectGATT buscaba la pausa por la dirección. También Jump (_connect) y el envío de texto forzaban la conexión.
//  2. ESTADOS VIEJOS EN COLA: copias ocultas de estados con la foto DENTRO (112 KB → 424–779 trozos por Bluetooth), mandadas
//     por builds anteriores, seguían en la cola de reenvío tras actualizar y volvían a saturar la radio. Ahora no se reenvían:
//     se borran y, si el estado sigue activo, se manda en el formato de ahora.
//  3. FOTO DE PERFIL EMPATADA: el Honor escondía las DOS (la del dueño y la copia de otro contacto). Ahora cada foto viaja con
//     cuándo la puso su dueño: se muestra la original y se esconde solo la copia, aunque la copia llegue antes.
//  4. AVISOS FANTASMA (dueño 12-11: «me aparecieron nueve mensajes nuevos y no vi ninguno»): una acción oculta (estado, foto de
//     perfil, me gusta…) reenviada desde la cola tras reiniciar la app salía como mensaje NUEVO (la marca «callada» vivía solo
//     en memoria) y el otro teléfono avisaba. Ahora lo guardado como oculto se reenvía callado.
// Uso: node cola3033.js <dir_build>
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone, installWebCrypto } = require('./native_mock');

const buildDir = path.resolve(process.argv[2]);
const opts = { readsContentFallback: true, retain: ['onPayloadReceived'], closeOnNoService: true, pace: [15, 15], ioDelay: 25, asymmetric: true };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
class DL extends ResourceLoader { constructor(d) { super(); this.d = d; } fetch(u) { const f = path.join(this.d, decodeURIComponent(new URL(u).pathname)); return fs.existsSync(f) ? Promise.resolve(fs.readFileSync(f)) : Promise.reject(new Error('x')); } }
const X = '0110'.repeat(16);
const mk = (bits, rgb, salt) => 'data:image/jpeg;base64,' + Buffer.from('PH|' + bits + '|' + rgb.join(',') + '|' + salt + '|' + 'x'.repeat(3000)).toString('base64');
const P = mk(X, [120, 100, 90], 'orig'), P_COPIA = mk(X, [121, 99, 90], 'copia');
const phashOf = (url) => { const m = /^PH\|([01]{64})\|(\d+),(\d+),(\d+)\|/.exec(Buffer.from(String(url).split(',')[1] || '', 'base64').toString('latin1')); return m ? { b: m[1], c: [+m[2], +m[3], +m[4]] } : null; };
const logs = [];
async function boot(name, native) {
  const vc = new VirtualConsole();
  ['log', 'warn', 'error'].forEach((l) => vc.on(l, (...a) => logs.push(`${new Date().toISOString().substring(14, 23)} [${name}] ${l}: ` + a.map(String).join(' ').substring(0, 250))));
  const dom = new JSDOM(fs.readFileSync(path.join(buildDir, 'dist', 'index.html'), 'utf8'), {
    url: 'https://' + name.toLowerCase() + '.nexo.test/index.html', runScripts: 'dangerously', resources: new DL(path.join(buildDir, 'dist')), pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) { win.CapacitorCustomPlatform = { name: 'android' }; installWebCrypto(win); win.Capacitor = { Plugins: { NexoBLE: native.plugin() } }; win.HTMLElement.prototype.scrollTo = function () {}; win.NEXO_avatarPHash = phashOf; },
  });
  const win = dom.window;
  for (let i = 0; i < 100 && !(win.NEXO && win.NEXO.initialized); i++) await sleep(100);
  await sleep(800);
  return { name, native, win };
}
const click = (w, el) => el && el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
async function addFound(p) {
  let add = null;
  for (let i = 0; i < 400 && !add; i++) { await sleep(100); add = p.win.document.querySelector('#ble-new-device > div button'); if (!add && !p.win.bleInterface.isScanning) click(p.win, p.win.document.getElementById('ble-scan-btn')); }
  click(p.win, add); await sleep(2000); return !!add;
}
async function openChatWith(p, name) { let row; for (let i = 0; i < 300 && !row; i++) { row = Array.from(p.win.document.querySelectorAll('#main-contacts-list .ble-contact-row')).find((r) => (r.querySelector('.ble-contact-name') || {}).textContent === name); if (!row) await sleep(100); } click(p.win, row); await sleep(600); return !!row; }
async function closeChat(p) { p.win.dispatchEvent(new p.win.CustomEvent('nexo:ble:closeChat', { detail: {} })); await sleep(300); }
function sendText(p, t) { const i = p.win.document.getElementById('message-input'); i.value = t; i.dispatchEvent(new p.win.Event('input', { bubbles: true })); click(p.win, p.win.document.getElementById('send-btn')); }
const wait = async (c, s) => { for (let i = 0; i < s * 5; i++) { if (await c()) return true; await sleep(200); } return false; };

(async () => {
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', opts), nB = new NativePhone('B', 'BB:BB:BB:BB:BB:02', opts);
  [nA, nB].forEach((n) => { radio.add(n); n.load(); });
  let [A, B] = await Promise.all([boot('A', nA), boot('B', nB)]);
  const idA = A.win.bleInterface.localNexoId.toLowerCase(), idB = B.win.bleInterface.localNexoId.toLowerCase();
  const r = { prueba: 'cola3033', build: path.basename(buildDir) };
  A.win.bleInterface.togglePanel(); if (!(await addFound(A))) { console.log('COLA3033 ' + JSON.stringify({ resultado: 'FALLO', error: 'no empareja' })); process.exit(1); } A.win.bleInterface.togglePanel();
  await openChatWith(A, 'B'); sendText(A, 'hola'); await sleep(2500); await closeChat(A);
  r.emparejados = await wait(async () => (await B.win.vaultLoadMessages(idA)).some((m) => m.content === 'hola'), 30);

  // ---------- 2. estados viejos en cola ----------
  // A tiene un estado activo (texto) ya «mandado» a B; en su cola quedó la copia de una build anterior con la foto DENTRO
  // (112 KB, mismo sid) y otra del formato de antes de la 3032 (sin sid). B se va; A se reinicia (como al actualizar); B vuelve.
  const sid = A.win.NEXO_addMyStatus('mi estado');
  r.estado_publicado = !!sid;
  r.B_lo_tiene = await wait(() => (B.win.NEXO_statusesOf(idA) || []).some((x) => x.sid === sid), 30);
  B.win.close(); nB.destroyActivity(); await sleep(1500);
  const bigImg = 'data:image/jpeg;base64,' + 'A'.repeat(112 * 1024);
  const ts = Date.now();
  const viejo1 = { msgId: 'msg' + ts + 'viejo1aa', messageId: 'msg' + ts + 'viejo1aa', contactNexoId: idB, _own: true, hidden: true, status: 'pending', timestamp: ts, seq: 0,
    content: JSON.stringify({ type: 'nexo_act', act: 'st', sid: sid, t: 'mi estado', ts: ts, img: bigImg, mime: 'image/jpeg' }) };
  const viejo2 = { msgId: 'msg' + ts + 'viejo2bb', messageId: 'msg' + ts + 'viejo2bb', contactNexoId: idB, _own: true, hidden: true, status: 'pending', timestamp: ts, seq: 0,
    content: JSON.stringify({ type: 'nexo_act', act: 'st', t: 'estado viejo', ts: ts }) };
  await A.win.vaultAppendMessage(idB, viejo1); await A.win.vaultAppendMessage(idB, viejo2);
  // 3035: una petición «sq» (deslizar para actualizar) de hace 10 min, sin entregar: caducó, no se reenvía
  const sqVieja = { msgId: 'msg' + ts + 'sqvieja1', messageId: 'msg' + ts + 'sqvieja1', contactNexoId: idB, _own: true, hidden: true, status: 'pending', timestamp: ts - 600000, seq: 0,
    content: JSON.stringify({ type: 'nexo_act', act: 'sq', ts: ts - 600000 }) };
  await A.win.vaultAppendMessage(idB, sqVieja);
  // 4. (avisos fantasma, dueño 12-11: «nueve mensajes nuevos y no vi ninguno») mientras B no está, A publica otro estado:
  //    su copia oculta queda en cola; tras reiniciar A se reenvía y en B debe llegar CALLADA (sin «mensaje nuevo»)
  //    (una baja de estado: acción oculta que sí se reenvía; en la app real, lo mismo pasa con fotos de perfil, me gusta, etc.)
  const sid2 = A.win.NEXO_addMyStatus('mientras no estabas');
  const baja = { msgId: 'msg' + ts + 'bajaoc1', messageId: 'msg' + ts + 'bajaoc1', contactNexoId: idB, _own: true, hidden: true, status: 'pending', timestamp: ts, seq: 0,
    content: JSON.stringify({ type: 'nexo_act', act: 'st', sid: 'zzzz9999', del: 1, t: '', ts: ts }) };
  await A.win.vaultAppendMessage(idB, baja);
  await sleep(1500);
  const ocultas = (await A.win.vaultLoadMessages(idB)).filter((m) => m.hidden && m._own && !/viejo[12]/.test(m.msgId || '') && (m.status === 'pending' || m.status === 'failed' || m.status === 'sending')).map((m) => m.msgId);
  r.ocultas_en_cola = ocultas.length;
  await sleep(500);
  A.win.close(); nA.destroyActivity(); await sleep(1500); nA.load(); A = await boot('A', nA);
  const llegadas = new Map();
  const realEmit = nB.emit.bind(nB);
  nB.emit = function (ev, d) {
    if (ev === 'onPayloadReceived' && d && typeof d.content === 'string') {
      try { const info = NativePhone.classifyClosed(d.content, nB.advertisingId); if (info && info.msgId && ocultas.indexOf(info.msgId) >= 0) llegadas.set(info.msgId, !!info.quiet); } catch (e) {}
    }
    return realEmit(ev, d);
  };
  nB.load(); B = await boot('B', nB);
  const t0 = logs.length;
  await sleep(25000);
  const after = logs.slice(t0);
  r.no_sale_la_vieja = !after.some((l) => /\[A\].*(viejo1aa|viejo2bb)/.test(l) && /START|Reenvi|_splitChunks|sendFile/.test(l)) && !after.some((l) => /\[A\].*_splitChunks: (\d{3,}) chunks/.test(l));
  r.trozos_grandes = (after.filter((l) => /\[A\].*_splitChunks: \d+ chunks/.test(l)).map((l) => +/(\d+) chunks/.exec(l)[1]).sort((a, b) => b - a)[0]) || 0;
  const vA = await A.win.vaultLoadMessages(idB);
  r.viejas_borradas = !vA.some((m) => /viejo[12]|sqvieja1/.test(m.msgId || ''));
  r.B_sin_foto_vieja = !(B.win.NEXO_statusesOf(idA) || []).some((x) => x.img && x.img.length > 100000);
  r.B_sin_estado_viejo = !(B.win.NEXO_statusesOf(idA) || []).some((x) => x.t === 'estado viejo' || x.lg);
  r.B_sigue_con_su_estado = (B.win.NEXO_statusesOf(idA) || []).some((x) => x.sid === sid);
  r.B_tiene_estado_nuevo = (B.win.NEXO_statusesOf(idA) || []).some((x) => x.sid === sid2);
  r.ocultas_llegadas = llegadas.size;
  r.ocultas_calladas = llegadas.size > 0 && Array.from(llegadas.values()).every(Boolean);
  r.log_copia_vieja = logs.some((l) => /\[A\].*Copia vieja de un estado/.test(l));

  // ---------- 3. foto de perfil empatada ----------
  // En A llegan dos contactos con la misma foto: primero la COPIA (puesta hace 1 h), luego la original (puesta hace 1 día).
  const nxO = 'nx0origin1', nxC = 'nx0copiaa1';
  const now = Date.now();
  if (typeof A.win.NEXO_applyAvatar !== 'function') { r.foto_original_se_ve = false; r.foto_copia_escondida = false; r.foto_nota = 'build sin fecha de la foto'; } else {
  A.win.NEXO_applyAvatar(nxC, { act: 'av', h: 'hcopia', img: P_COPIA, t: now - 3600e3 });
  await sleep(400);
  A.win.NEXO_applyAvatar(nxO, { act: 'av', h: 'horig', img: P, t: now - 86400e3 });
  await sleep(800);
  r.foto_original_se_ve = A.win.NEXO_avatarOf(nxO) === P;
  r.foto_copia_escondida = !A.win.NEXO_avatarOf(nxC);
  }

  // ---------- 1. pausa de Bluetooth ----------
  const biA = A.win.bleInterface;
  if (typeof biA._stopConnectionSupervisor === 'function') biA._stopConnectionSupervisor();
  if (biA._reconnectScanTimer) { clearTimeout(biA._reconnectScanTimer); biA._reconnectScanTimer = null; }
  if (biA.isScanning && typeof biA.toggleScan === 'function') await biA.toggleScan();
  await sleep(300);
  let conn = 0; const realConn = biA.nativePlugin.connectToDevice;
  biA.nativePlugin.connectToDevice = function () { conn++; return Promise.resolve({ connected: false }); };
  // pausa como la del diagnóstico (no_service repetido)
  biA._bleCooldownUntil.set(idB, Date.now() + 600000);
  // (a) el escaneo ve a B: onDeviceFound llama _autoConnectGATT con el dispositivo TAL CUAL llega del escaneo (nexoId, sin
  //     deviceUUID). Se usa una dirección sin enlace para que nada más (enlace bueno por otra dirección) lo frene.
  const scanMac = 'BB:BB:BB:BB:BB:99';
  const scanDev = { id: scanMac, name: 'B', rssi: -60, nexoId: idB.toUpperCase() };
  try { biA._setDeviceState(scanMac, 'disconnected'); } catch (e) {}
  let c0 = conn;
  biA._autoConnectGATT(scanMac, scanDev); await sleep(150);
  r.escaneo_en_pausa_no_conecta = conn === c0;
  // (b) Jump: el contacto en pausa tampoco se conecta por ahí (sin vecino ni enlace listo con esa dirección)
  const nb = biA.relay && biA.relay.neighbors && biA.relay.neighbors.get(idB);
  if (biA.relay) { if (nb) biA.relay.neighbors.delete(idB); biA.relay._connecting && biA.relay._connecting.delete(idB); }
  c0 = conn;
  if (biA.relay) biA.relay._connect(idB, scanMac);
  await sleep(150);
  r.jump_en_pausa_no_conecta = !!biA.relay && conn === c0;
  // (c) sin pausa, lo mismo SÍ conecta (la reconexión normal no se rompió)
  biA._bleCooldownUntil.delete(idB);
  try { biA._setDeviceState(scanMac, 'disconnected'); } catch (e) {} biA.connectedDevices.delete(scanMac);
  c0 = conn;
  biA._autoConnectGATT(scanMac, scanDev); await sleep(150);
  r.escaneo_sin_pausa_conecta = conn > c0;
  try { biA._setDeviceState(scanMac, 'disconnected'); } catch (e) {} biA.connectedDevices.delete(scanMac);
  if (biA.relay) { biA.relay._connecting && biA.relay._connecting.delete(idB); c0 = conn; biA.relay._connect(idB, scanMac); await sleep(150); r.jump_sin_pausa_conecta = conn > c0; }
  if (nb) biA.relay.neighbors.set(idB, nb);
  biA.nativePlugin.connectToDevice = realConn;

  r.errores = logs.filter((l) => / error: /.test(l) && !/JSDOMERROR|styles\.css|Not implemented/.test(l)).slice(0, 5);
  const ok = r.emparejados && r.estado_publicado && r.B_lo_tiene && r.no_sale_la_vieja && r.B_sin_foto_vieja && r.viejas_borradas && r.B_sin_estado_viejo && r.B_sigue_con_su_estado && r.B_tiene_estado_nuevo && r.ocultas_en_cola > 0 && r.ocultas_calladas &&
    r.foto_original_se_ve && r.foto_copia_escondida && r.escaneo_en_pausa_no_conecta && r.jump_en_pausa_no_conecta && r.escaneo_sin_pausa_conecta && r.jump_sin_pausa_conecta && !r.errores.length;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('COLA3033 ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_cola3033.txt'), logs.join('\n'));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('COLA3033 ' + JSON.stringify({ resultado: 'FALLO', error: String(e && e.message) })); console.error(e); fs.writeFileSync(path.join(__dirname, 'last_logs_cola3033.txt'), logs.join('\n')); process.exit(1); });
