// 3183 (dueño 17-11: «En mi lista de contactos, el Vivo siempre está arriba, independientemente de si lo ocupo o no; nunca baja»).
// El vivo (nx09acdb61) está casi siempre cerca del S24 por Bluetooth con su app dormida. A = el S24 con 3 contactos: B y C con
// los que cruza mensajes de verdad y V (el vivo), con el que habló una vez hace rato. V solo está cerca: se conecta y desconecta
// varias veces, su app duerme/despierta/se cierra, y por debajo corre su tráfico de fondo (foto de perfil «avq»/«av», estados,
// Fénix, presencia, kx…). La lista de A debe quedar por el ÚLTIMO MENSAJE VISIBLE: C, B, V (V abajo).
// Causa reproducida (contraprueba b3182): el tráfico de fondo NO subía a V; lo subía un REENVÍO de un mensaje viejo que A ya tenía
// (la app dormida del vivo no se entera de la confirmación y lo vuelve a mandar al reconectar; tras reiniciarse A ya no recuerda ese
// id): noteContactMessage lo anotaba con la hora de LLEGADA → V arriba sin mensaje nuevo (y el almacén le cambiaba la hora). Ahora
// cuenta la hora de su primera llegada (con su id), el almacén la conserva, y una hora del futuro se acota a ahora.
// Uso: node vivoarriba.js <dir_build>
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone, installWebCrypto } = require('./native_mock');

const buildDir = path.resolve(process.argv[2]);
const opts = { readsContentFallback: true, retain: ['onPayloadReceived'], closeOnNoService: true, pace: [15, 15], ioDelay: 25, asymmetric: true, noL2: true, noTor: true };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PHOTO = { A: 'data:image/jpeg;base64,' + Buffer.alloc(6000, 7).toString('base64'), V: 'data:image/jpeg;base64,' + Buffer.alloc(5000, 9).toString('base64') };
class DL extends ResourceLoader { constructor(d) { super(); this.d = d; } fetch(u) { const f = path.join(this.d, decodeURIComponent(new URL(u).pathname)); return fs.existsSync(f) ? Promise.resolve(fs.readFileSync(f)) : Promise.reject(new Error('x')); } }
const logs = [];
const T0 = Date.now();
const ts = () => String(((Date.now() - T0) / 1000).toFixed(1)).padStart(6) + 's';
async function boot(name, native) {
  const vc = new VirtualConsole();
  ['log', 'warn', 'error'].forEach((l) => vc.on(l, (...a) => logs.push(`${ts()} [${name}] ${l}: ` + a.map(String).join(' ').substring(0, 250))));
  let vis = 'visible';
  const dom = new JSDOM(fs.readFileSync(path.join(buildDir, 'dist', 'index.html'), 'utf8'), {
    url: 'https://' + name.toLowerCase() + '.nexo.test/index.html', runScripts: 'dangerously', resources: new DL(path.join(buildDir, 'dist')), pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) {
      win.CapacitorCustomPlatform = { name: 'android' }; installWebCrypto(win); win.Capacitor = { Plugins: { NexoBLE: native.plugin() } }; win.HTMLElement.prototype.scrollTo = function () {};
      win.NEXO_makeAvatar = () => PHOTO[name] || PHOTO.A;
      Object.defineProperty(win.document, 'visibilityState', { configurable: true, get: () => vis });
      Object.defineProperty(win.document, 'hidden', { configurable: true, get: () => vis === 'hidden' });
    },
  });
  const win = dom.window;
  for (let i = 0; i < 100 && !(win.NEXO && win.NEXO.initialized); i++) await sleep(100);
  await sleep(800);
  const p = { name, native, win };
  p.setActive = (active) => { vis = active ? 'visible' : 'hidden'; win.document.dispatchEvent(new win.Event('visibilitychange')); native.setAppActive(active); };
  return p;
}
const click = (w, el) => el && el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
async function addFound(p, name) {
  let add = null;
  const find = () => { const row = Array.from(p.win.document.querySelectorAll('#ble-new-device > div')).find((d) => (d.querySelector('span') || {}).textContent === name); return row && row.querySelector('button'); };
  for (let i = 0; i < 600 && !add; i++) { await sleep(100); add = find(); if (!add && !p.win.bleInterface.isScanning) click(p.win, p.win.document.getElementById('ble-scan-btn')); }
  click(p.win, add); await sleep(2000);
  return !!add;
}
async function openChatWith(p, name) {
  let row; for (let i = 0; i < 300 && !row; i++) { row = Array.from(p.win.document.querySelectorAll('#main-contacts-list .ble-contact-row')).find((r) => (r.querySelector('.ble-contact-name') || {}).textContent === name); if (!row) await sleep(100); }
  click(p.win, row); await sleep(600); return !!row;
}
async function closeChat(p) { p.win.dispatchEvent(new p.win.CustomEvent('nexo:ble:closeChat', { detail: {} })); await sleep(300); }
function sendText(p, t) { const i = p.win.document.getElementById('message-input'); i.value = t; i.dispatchEvent(new p.win.Event('input', { bubbles: true })); click(p.win, p.win.document.getElementById('send-btn')); }
const wait = async (c, s) => { for (let i = 0; i < s * 5; i++) { if (await c()) return true; await sleep(200); } return false; };
async function pickPhoto(p) {
  p.win.dispatchEvent(new p.win.CustomEvent('nexo:ui:profile')); await sleep(400);
  click(p.win, p.win.document.getElementById('nexo-av-pick')); await sleep(200);
  const inp = Array.from(p.win.document.querySelectorAll('input[type=file]')).find((i) => i.accept === 'image/*');
  if (inp) { Object.defineProperty(inp, 'files', { configurable: true, value: [new p.win.File([Buffer.alloc(100)], 'yo.jpg', { type: 'image/jpeg' })] }); inp.dispatchEvent(new p.win.Event('change')); }
  await sleep(500);
  const c = p.win.document.getElementById('nexo-profile-close'); if (c) click(p.win, c);
  await sleep(200);
}
const rowNames = (p) => Array.from(p.win.document.querySelectorAll('#main-contacts-list .ble-contact-row')).map((r) => (r.querySelector('.ble-contact-name') || {}).textContent);
const contactOf = (p, nx) => (p.win.bleInterface.getBLEContacts() || []).find((c) => String(c.nexoId || c.deviceUUID || '').toLowerCase() === nx) || {};
const readyWith = (p, nx) => { try { return !!p.win.bleInterface._bleReadyFor(nx); } catch (e) { return false; } };
// Lo que el usuario VE en el chat (el último mensaje no oculto ni acción/diagnóstico)
async function lastVisible(p, nx) {
  const list = (await p.win.vaultLoadMessages(nx)) || [];
  const vis = list.filter((m) => !m.hidden && !/"type":"nexo_(act|diag)"/.test(String(m.content || '')));
  return vis.reduce((mx, m) => Math.max(mx, m.timestamp || 0), 0);
}

(async () => {
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', opts), nB = new NativePhone('B', 'BB:BB:BB:BB:BB:02', opts), nC = new NativePhone('C', 'CC:CC:CC:CC:CC:03', opts), nV = new NativePhone('V', 'DD:DD:DD:DD:DD:04', opts);
  [nA, nB, nC, nV].forEach((n) => { radio.add(n); n.load(); });
  let [A, B, C, V] = await Promise.all([boot('A', nA), boot('B', nB), boot('C', nC), boot('V', nV)]);
  const id = (p) => p.win.bleInterface.localNexoId.toLowerCase();
  const idA = id(A), idB = id(B), idC = id(C), idV = id(V);
  const r = { prueba: 'vivoarriba', build: path.basename(buildDir) };

  // Fotos de perfil (A y V) y un estado de V: así corre todo el tráfico de fondo de verdad (avq/av, sq/st)
  await pickPhoto(A); await pickPhoto(V);
  try { V.win.NEXO_setMyStatus('estado del vivo'); } catch (e) {}
  A.win.bleInterface.togglePanel();
  r.agrega_V = await addFound(A, 'V'); r.agrega_B = await addFound(A, 'B'); r.agrega_C = await addFound(A, 'C');
  A.win.bleInterface.togglePanel();

  // 1. Mensajes visibles: primero con V (el más viejo), luego B, luego C (el más reciente)
  const chat = async (other, txtA, txtO) => {
    await openChatWith(A, other.name); sendText(A, txtA); await sleep(1500); await closeChat(A);
    const gotA = await wait(async () => ((await other.win.vaultLoadMessages(idA)) || []).some((m) => m.content === txtA), 30);
    await openChatWith(other, 'A'); sendText(other, txtO); await sleep(1500); await closeChat(other);
    const gotO = await wait(async () => ((await A.win.vaultLoadMessages(id(other))) || []).some((m) => m.content === txtO), 30);
    return gotA && gotO;
  };
  r.chat_V = await chat(V, 'hola vivo', 'hola desde el vivo');
  await sleep(1500);
  r.chat_B = await chat(B, 'hola B', 'hola desde B');
  await sleep(1500);
  r.chat_C = await chat(C, 'hola C', 'hola desde C');
  await sleep(6000); // que termine lo de fondo de esta primera vuelta (fotos, estados…)
  A.win.bleInterface.renderContactsList(); await sleep(200);
  r.orden_inicial = rowNames(A);
  const lmV0 = contactOf(A, idV).lastMessageAt || 0;
  r.V_ultimo_visible_s = Math.round((Date.now() - (await lastVisible(A, idV))) / 1000);

  // Espía en A: quién sube a V en la lista (vista previa + de dónde viene la llamada)
  const bumps = [];
  const bi = A.win.bleInterface, orig = bi.noteContactMessage;
  bi.noteContactMessage = function (nx, preview, t) {
    const before = contactOf(A, idV).lastMessageAt || 0;
    const res = orig.apply(this, arguments);
    if (String(nx || '').toLowerCase() === idV) {
      const after = contactOf(A, idV).lastMessageAt || 0;
      const st = String(new Error().stack || '').split('\n').slice(2, 7).map((s) => s.trim().replace(/^at /, '').replace(/https?:\/\/[^ )]*\//, '').substring(0, 90));
      bumps.push({ t: ts().trim(), preview: String(preview || '').substring(0, 40), ts_rel_s: t ? Math.round((t - Date.now()) / 1000) : null, subio: after > before, pila: st });
    }
    return res;
  };

  // 2. V con la app DORMIDA (el vivo congela NEXO en segundo plano) y entrando y saliendo del alcance
  V.setActive(false); nV.setFrozen(true);
  const cycle = async () => {
    radio.block(nA, nV); await sleep(4000); radio.unblock(nA, nV);
    await wait(() => readyWith(A, idV), 40); await sleep(7000); // avq a los 4 s de cada «Peer ready», estados, Fénix…
  };
  for (let i = 0; i < 3; i++) await cycle();
  // 3. V despierta un rato (su app manda lo suyo: estados, foto, pendientes…) y vuelve a dormir
  nV.setFrozen(false); V.setActive(true); await sleep(9000); V.setActive(false); nV.setFrozen(true);
  await cycle();
  // 4. V se cierra (modo cerrado del nativo), entra y sale del alcance, y se vuelve a abrir
  V.win.close(); nV.destroyActivity(); await sleep(1500);
  radio.block(nA, nV); await sleep(3000); radio.unblock(nA, nV); await sleep(6000);
  nV.load(); V = await boot('V', nV); await sleep(9000);
  V.setActive(false); nV.setFrozen(true);
  await cycle();
  // 5. Mientras tanto A sigue hablando con B (lo más reciente debe ser B)
  await openChatWith(A, 'B'); sendText(A, 'sigo con B'); await sleep(1500); await closeChat(A);
  await sleep(3000);
  A.win.bleInterface.renderContactsList(); await sleep(300);
  r.orden_final = rowNames(A);
  const lmV1 = contactOf(A, idV).lastMessageAt || 0;
  r.V_subio_s = Math.round((lmV1 - lmV0) / 1000);
  r.V_subidas = bumps.filter((b) => b.subio).length;
  r.V_llamadas = bumps.slice(0, 8);
  const iV = r.orden_final.indexOf('V'), iB = r.orden_final.indexOf('B'), iC = r.orden_final.indexOf('C');
  r.V_abajo = iV > iB && iV > iC && iB === 0;
  r.V_hora_no_cambia = lmV1 === lmV0;

  // 5b. El vivo REENVÍA un mensaje viejo que A ya tenía: su app dormida no se enteró de la confirmación (aquí: A no la manda) y
  //     lo vuelve a mandar al reconectar. A se reinicia en medio (la memoria de «ya recibidos» se pierde). El chat no cambia (mismo
  //     id), y la lista tampoco debe: V sigue abajo, con la hora de su último mensaje visible.
  nV.setFrozen(false); V.setActive(true);
  await wait(() => readyWith(A, idV), 40);
  const ackA = A.win.bleInterface.ackSystem, oAck = ackA._sendReceipt;
  ackA._sendReceipt = function (type, dev, mid) { if (type === 'ack' && String(this._resolveNexoId(dev) || '').toLowerCase() === idV) return; return oAck.apply(this, arguments); };
  await openChatWith(V, 'A'); sendText(V, 'viejo del vivo'); await sleep(1500); await closeChat(V);
  r.reenvio_llega = await wait(async () => ((await A.win.vaultLoadMessages(idV)) || []).some((m) => m.content === 'viejo del vivo'), 30);
  await sleep(2000);
  const lmV2 = contactOf(A, idV).lastMessageAt || 0;
  const viejos = async () => ((await A.win.vaultLoadMessages(idV)) || []).filter((m) => m.content === 'viejo del vivo');
  const tsViejo0 = ((await viejos())[0] || {}).timestamp || 0;
  ackA._sendReceipt = oAck;
  V.setActive(false); nV.setFrozen(true);
  await sleep(1500);
  await openChatWith(A, 'C'); sendText(A, 'C otra vez'); await sleep(1500); await closeChat(A);
  await openChatWith(A, 'B'); sendText(A, 'B otra vez'); await sleep(1500); await closeChat(A);
  A.win.close(); nA.destroyActivity(); await sleep(1500); nA.load(); A = await boot('A', nA); await sleep(2000);
  nV.setFrozen(false); V.setActive(true);
  const reRx = () => logs.filter((l) => /^\s*[\d.]+s \[V\] .*Reenviando/.test(l)).length;
  const re0 = reRx();
  for (let i = 0; i < 6 && reRx() === re0; i++) { radio.block(nA, nV); await sleep(2500); radio.unblock(nA, nV); await wait(() => readyWith(A, idV), 40); await sleep(8000); }
  r.V_reenvio = reRx() > re0;
  await sleep(4000);
  A.win.bleInterface.renderContactsList(); await sleep(300);
  r.orden_tras_reenvio = rowNames(A);
  const lmV3 = contactOf(A, idV).lastMessageAt || 0;
  r.reenvio_V_subio_s = Math.round((lmV3 - lmV2) / 1000);
  r.reenvio_V_abajo = r.orden_tras_reenvio[0] === 'B' && r.orden_tras_reenvio.indexOf('V') === 2;
  { const vs = await viejos(); r.reenvio_copias_en_chat = vs.length; r.reenvio_hora_original = vs.length === 1 && vs[0].timestamp === tsViejo0;
    const mid = (vs[0] || {}).msgId || '?'; r.reenvio_A_lo_recibe_veces = logs.filter((l) => l.indexOf('[A] log: [BLE_RECV] Mensaje ' + mid + ' ') >= 0).length; }
  V.setActive(false); nV.setFrozen(true);

  // 6. Hora del otro teléfono adelantada (2 h): un mensaje de verdad de V no puede quedar «en el futuro» (arriba para siempre)
  nV.setFrozen(false); V.setActive(true);
  const realNow = V.win.Date.now; V.win.Date.now = () => realNow.call(V.win.Date) + 7200000;
  await wait(() => readyWith(A, idV), 40);
  await openChatWith(V, 'A'); sendText(V, 'vivo con la hora adelantada'); await sleep(1500); await closeChat(V);
  r.futuro_llega = await wait(async () => ((await A.win.vaultLoadMessages(idV)) || []).some((m) => m.content === 'vivo con la hora adelantada'), 30);
  V.win.Date.now = realNow;
  await sleep(1000);
  r.futuro_V_no_en_futuro = (contactOf(A, idV).lastMessageAt || 0) <= Date.now();
  // y una hora que llegue del futuro por cualquier camino (p. ej. el ts de un texto largo o de un archivo del otro) se acota a ahora
  const before6 = Date.now();
  A.win.bleInterface.noteContactMessage(idC, 'del futuro', Date.now() + 3 * 3600000);
  r.futuro_acotado = (contactOf(A, idC).lastMessageAt || 0) <= Date.now() && (contactOf(A, idC).lastMessageAt || 0) >= before6;
  // tras eso B escribe: B debe quedar arriba (no C clavado en el futuro)
  await openChatWith(B, 'A'); sendText(B, 'B al final'); await sleep(1500); await closeChat(B);
  await wait(async () => ((await A.win.vaultLoadMessages(idB)) || []).some((m) => m.content === 'B al final'), 30);
  await sleep(500); A.win.bleInterface.renderContactsList(); await sleep(200);
  r.orden_tras_futuro = rowNames(A);
  r.futuro_B_arriba = r.orden_tras_futuro[0] === 'B';

  r.errores = logs.filter((l) => / error: /.test(l) && !/JSDOMERROR|styles\.css|Not implemented/.test(l)).slice(0, 5);
  const ok = r.agrega_V && r.agrega_B && r.agrega_C && r.chat_V && r.chat_B && r.chat_C && r.V_abajo && r.V_hora_no_cambia &&
    r.reenvio_llega && r.V_reenvio && r.reenvio_A_lo_recibe_veces >= 2 && r.reenvio_V_abajo && r.reenvio_copias_en_chat === 1 && r.reenvio_hora_original && r.futuro_llega && r.futuro_V_no_en_futuro && r.futuro_acotado && r.futuro_B_arriba && !r.errores.length;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('VIVOARRIBA ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_vivoarriba.txt'), logs.join('\n'));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('VIVOARRIBA {"resultado":"FALLO","error":"' + String(e && e.message).replace(/"/g, "'") + '"}'); console.error(e); fs.writeFileSync(path.join(__dirname, 'last_logs_vivoarriba.txt'), logs.join('\n')); process.exit(1); });
