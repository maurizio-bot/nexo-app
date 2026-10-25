// Notificaciones por todas las vías de llegada (pedido del dueño: que avisen sea cual sea la red). B recibe de A:
//  1. con la app en segundo plano (en la lista de chats): un texto y una foto → notificación del teléfono con el
//     nombre de A (o del grupo) y el texto / "📷 Foto"; la burbuja numerada de la lista sube;
//  1b. (2760) con la app en segundo plano y CONGELADA (el Vivo del dueño no ejecuta la app en segundo plano): avisa la
//     parte nativa (sin texto) y, al volver, llega todo; sin avisos repetidos (en un grupo el aviso pasa al grupo);
//  1c. (2772; informe del dueño: "aunque ambos teléfonos tienen Wi-Fi, si mando un mensaje y el otro tiene la pantalla
//     apagada no llegan los mensajes, y lo mismo con las notificaciones") con la app en segundo plano y la PANTALLA
//     APAGADA: el teléfono duerme salvo que el nativo lo mantenga despierto (native_mock setScreenOff); el mensaje
//     debe llegar, avisar y marcarse entregado sin encender la pantalla; al encenderla, sin avisos repetidos;
//  2. con la app cerrada: un texto y una foto → notificación (sin texto: va cifrado) si la vía sigue viva con la app
//     cerrada (Bluetooth, grupo y, desde la 2760, Jump); al abrir la app llega todo.
// --sin-despertar: el Kotlin de antes de la 2772 (no mantenía el teléfono despierto al recibir)
// --via=ble     A y B a alcance de Bluetooth
// --via=lan     A y B en el mismo Wi-Fi, fuera de alcance de Bluetooth
// --via=net     A y B en redes distintas, sin Bluetooth: internet (relés locales)
// --via=tor     como net, con Tor
// --via=jump    A y B fuera de alcance; C en medio (Jump)
// --via=group   A escribe en un grupo (A, B, C), todos a alcance de Bluetooth
// Uso: node notify.js <dir_build> --via=ble [--io-delay=25]
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone, installWebCrypto } = require('./native_mock');

const buildDir = path.resolve(process.argv[2]);
const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith('--' + k)); if (!a) return d; const v = a.split('=')[1]; return v === undefined ? true : v; };
const via = arg('via', 'ble');
const opts = { readsContentFallback: true, retain: ['onPayloadReceived', 'onLanMessage', 'onLanUp', 'onLanDown'], closeOnNoService: true, pace: [15, 15], ioDelay: Number(arg('io-delay', 25)), asymmetric: true, noRxWake: !!arg('sin-despertar', false) };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let RELAYS = [];
class DistLoader extends ResourceLoader {
  constructor(dir) { super(); this.dir = dir; }
  fetch(url) { const f = path.join(this.dir, decodeURIComponent(new URL(url).pathname)); return fs.existsSync(f) ? Promise.resolve(fs.readFileSync(f)) : Promise.reject(new Error('no existe ' + f)); }
}
const logs = [];
const vis = {};
async function boot(name, native) {
  native.listeners = new Map();
  vis[name] = 'visible';
  const vc = new VirtualConsole();
  ['log', 'warn', 'error'].forEach((l) => vc.on(l, (...a) => logs.push(`${new Date().toISOString().substring(14, 23)} [${name}] ${l}: ` + a.map(String).join(' ').substring(0, 250))));
  const dom = new JSDOM(fs.readFileSync(path.join(buildDir, 'dist', 'index.html'), 'utf8'), {
    url: 'https://' + name.toLowerCase() + '.nexo.test/index.html', runScripts: 'dangerously',
    resources: new DistLoader(path.join(buildDir, 'dist')), pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) {
      win.NEXO_NET_RELAYS = RELAYS; win.CapacitorCustomPlatform = { name: 'android' }; installWebCrypto(win); win.Capacitor = { Plugins: { NexoBLE: native.plugin() } }; win.HTMLElement.prototype.scrollTo = function () {}; win.confirm = () => true;
      Object.defineProperty(win.document, 'visibilityState', { configurable: true, get: () => vis[name] });
      Object.defineProperty(win.document, 'hidden', { configurable: true, get: () => vis[name] === 'hidden' });
    },
  });
  const win = dom.window;
  for (let i = 0; i < 100 && !(win.NEXO && win.NEXO.initialized); i++) await sleep(100);
  await sleep(800);
  return { name, native, win };
}
function setVisible(p, on) { vis[p.name] = on ? 'visible' : 'hidden'; p.native.setAppActive(on); p.win.document.dispatchEvent(new p.win.Event('visibilitychange')); }
const click = (win, el) => el && el.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
async function openChatWith(p, name) { let row; for (let i = 0; i < 100 && !row; i++) { row = Array.from(p.win.document.querySelectorAll('#main-contacts-list .ble-contact-row')).find((r) => (r.querySelector('.ble-contact-name') || {}).textContent === name); if (!row) await sleep(100); } click(p.win, row); await sleep(600); return !!row; }
async function closeChat(p) { p.win.dispatchEvent(new p.win.CustomEvent('nexo:ble:closeChat', { detail: {} })); await sleep(300); }
function sendText(p, t) { const i = p.win.document.getElementById('message-input'); i.value = t; i.dispatchEvent(new p.win.Event('input', { bubbles: true })); click(p.win, p.win.document.getElementById('send-btn')); }
async function sendPhoto(p, kb, seed) {
  const buf = Buffer.alloc(kb * 1024); for (let i = 0; i < buf.length; i++) buf[i] = (i * seed + 7) & 255;
  click(p.win, p.win.document.querySelector('.attach-menu-item[data-type="file"]')); await sleep(200);
  const fin = Array.from(p.win.document.querySelectorAll('input[type=file]')).pop();
  Object.defineProperty(fin, 'files', { value: [new p.win.File([buf], 'foto' + seed + '.jpg', { type: 'image/jpeg' })] });
  fin.dispatchEvent(new p.win.Event('change'));
}
async function addFound(p, name) {
  let add = null;
  const find = () => { const row = Array.from(p.win.document.querySelectorAll('#ble-new-device > div')).find((d) => (d.querySelector('span') || {}).textContent === name); return row && row.querySelector('button'); };
  for (let i = 0; i < 400 && !add; i++) { await sleep(100); add = find(); if (!add && !p.win.bleInterface.isScanning) click(p.win, p.win.document.getElementById('ble-scan-btn')); }
  click(p.win, add); await sleep(2000);
  return !!add;
}
async function waitFor(fn, ms) { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (await fn()) return +((Date.now() - t0) / 1000).toFixed(1); } catch (e) {} await sleep(200); } return null; }

(async () => {
  let relays = [];
  if (via === 'net' || via === 'tor') { const { NostrRelay } = require('./nostr_relay'); relays = [new NostrRelay(), new NostrRelay({ authRequired: true })]; RELAYS = [await relays[0].start(), await relays[1].start()]; }
  const radio = new Radio();
  const wifi = { lan: ['casa', 'casa'], net: ['casa', 'oficina'], tor: ['casa', 'oficina'] }[via] || [null, null];
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', Object.assign({}, opts, { wifi: wifi[0], noTor: via !== 'tor' }));
  const nB = new NativePhone('B', 'BB:BB:BB:BB:BB:02', Object.assign({}, opts, { wifi: wifi[1], noTor: via !== 'tor' }));
  const three = via === 'jump' || via === 'group';
  const nC = three ? new NativePhone('C', 'CC:CC:CC:CC:CC:03', opts) : null;
  const nat = { A: nA, B: nB, C: nC }, names = three ? ['A', 'B', 'C'] : ['A', 'B'];
  names.forEach((n) => { radio.add(nat[n]); nat[n].load(); });
  const P = {};
  (await Promise.all(names.map((n) => boot(n, nat[n])))).forEach((p) => { P[p.name] = p; });
  let { A, B } = P;
  const idA = A.win.bleInterface.localNexoId.toLowerCase(), idB = B.win.bleInterface.localNexoId.toLowerCase();
  const r = { build: path.basename(buildDir), via };
  // Emparejar X con Y (X solo ve a Y mientras lo agrega) y saludarse para tener las claves
  async function pair(x, y) {
    const others = names.filter((n) => n !== x && n !== y);
    others.forEach((o) => radio.block(nat[x], nat[o]));
    P[x].win.bleInterface.togglePanel(); const ok = await addFound(P[x], y); P[x].win.bleInterface.togglePanel();
    await sleep(800);
    await openChatWith(P[x], y); sendText(P[x], 'hola ' + y); await sleep(2500);
    await openChatWith(P[y], x); sendText(P[y], 'hola ' + x); await sleep(2500);
    const keyOf = (a, b) => !!(P[a].win.vaultLoadContacts().find((c) => c.name === b) || {}).publicKey;
    for (let i = 0; i < 40 && !(keyOf(x, y) && keyOf(y, x)); i++) await sleep(500);
    await closeChat(P[x]); await closeChat(P[y]);
    others.forEach((o) => radio.unblock(nat[x], nat[o]));
    return ok;
  }
  const pairs = three ? [['A', 'B'], ['B', 'C'], ['A', 'C']] : [['A', 'B']];
  for (const [x, y] of pairs) if (!(await pair(x, y))) { console.log('NOTIFY ' + JSON.stringify({ via, error: 'no empareja ' + x + y, resultado: 'FALLO' })); process.exit(1); }
  // Camino
  let gid = null;
  const linkB = () => A.win.bleInterface.linkOf(idB);
  if (via === 'lan') { r.camino_listo_s = await waitFor(() => linkB() === 'wifi' && B.win.bleInterface.linkOf(idA) === 'wifi', 60000); radio.block(nA, nB); }
  if (via === 'net' || via === 'tor') {
    radio.block(nA, nB); A.win.bleInterface.net.tick(); B.win.bleInterface.net.tick();
    r.camino_listo_s = await waitFor(() => linkB() === 'internet' && B.win.bleInterface.linkOf(idA) === 'internet', 60000);
    if (via === 'tor') r.por_tor_s = await waitFor(() => logs.some((l) => /\[A\].*conectado por Tor/.test(l)) && logs.some((l) => /\[B\].*conectado por Tor/.test(l)), 60000);
  }
  if (via === 'jump') radio.block(nA, nB);
  if (via === 'group') {
    gid = A.win.bleInterface.groups.create('Familia', [idB, P.C.win.bleInterface.localNexoId.toLowerCase()]).id;
    // (B conoce el grupo con su primer mensaje: crear no avisa a nadie)
  }
  await sleep(1500);
  const chat = gid || idA;                       // chat de B donde cae lo de A
  const has = async (f) => (await B.win.vaultLoadMessages(chat)).some(f);
  // Con la app cerrada la parte nativa no sabe de grupos: avisa con el remitente
  const notifs = (since, closed) => nB.notifLog.filter((n) => n.t >= since && [chat, idA, 'nexo_jump'].indexOf(n.chatId) >= 0 && !!n.closed === !!closed);
  const fmt = (list) => list.map((n) => n.name + ': ' + (n.text || '(sin texto)') + ' #' + n.count + (n.bg ? ' (nativo)' : ''));
  const unreadB = () => { const b = B.win.bleInterface; const s = typeof b.unreadSummary === 'function' ? b.unreadSummary() : []; return (s.find((x) => String(x.chatId).toLowerCase() === chat) || {}).count || 0; };
  async function openSendChat() { if (gid) { A.win.NEXO_openGroupChat(gid); await sleep(600); } else await openChatWith(A, 'B'); }

  // 1. B en segundo plano (en la lista de chats)
  setVisible(B, false); await sleep(500);
  let t0 = Date.now();
  await openSendChat();
  sendText(A, 'fondo-' + via);
  r.fondo_texto_llega_s = await waitFor(() => has((m) => m.content === 'fondo-' + via), 90000);
  await sleep(1500);
  await sendPhoto(A, 30, 11);
  // (en el simulador no hay canvas: la foto va como archivo adjunto y la notificación dice "📎 Archivo")
  r.fondo_foto_llega_s = await waitFor(() => has((m) => m.attachmentType && !m._own && (m.attachmentMeta || {}).name === 'foto11.jpg'), 120000);
  await sleep(1500);
  const nf = notifs(t0, false);
  r.fondo_avisos = fmt(nf);
  r.fondo_aviso_texto = nf.some((n) => n.text.indexOf('fondo-' + via) >= 0);
  r.fondo_aviso_foto = nf.some((n) => /📷 Foto|📎 Archivo/.test(n.text));
  // (en un grupo el aviso nativo sale con quien escribe y pasa al grupo cuando avisa la app: al final, uno)
  r.fondo_avisos_repetidos = gid ? nB.notifications.has(idA) : nf.length > 2;
  r.fondo_no_leidos = unreadB();
  r.fondo_aviso_pendiente = nB.notifications.has(chat);
  await closeChat(A);

  // 1b. B en segundo plano con la app congelada (lo que llega espera; su vigilante tampoco corre)
  const frozenOk = ['ble', 'lan', 'jump', 'group'].indexOf(via) >= 0; // internet: lo avisa NetBg.kt (no está en el simulador)
  B.win.bleInterface._stopConnectionSupervisor(); nB.setFrozen(true);
  t0 = Date.now();
  await openSendChat();
  sendText(A, 'congelada-' + via);
  await sleep(1500);
  await sendPhoto(A, 30, 12);
  await waitFor(() => notifs(t0, false).length >= 2, 30000);
  const nz = notifs(t0, false);
  r.congelada_avisos = fmt(nz);
  r.congelada_aviso_texto = nz.length >= 1;
  // (en un grupo la foto va como texto largo: el aviso nativo no sabe que es una foto)
  r.congelada_aviso_foto = gid ? nz.length >= 2 : nz.some((n) => /📷 Foto|📎 Archivo/.test(n.text));
  nB.setFrozen(false); { const bi = B.win.bleInterface; bi._supervisorTimer = B.win.setInterval(() => bi._runSupervisorCycle(), bi._supervisorIntervalMs); }
  r.congelada_texto_llega_s = await waitFor(() => has((m) => m.content === 'congelada-' + via), 120000);
  r.congelada_foto_llega_s = await waitFor(() => has((m) => m.attachmentType && !m._own && (m.attachmentMeta || {}).name === 'foto12.jpg'), 180000);
  await sleep(2000);
  r.congelada_avisos_final = Object.fromEntries(Array.from(nB.notifications.entries()).map(([k, n]) => [k === chat ? 'chat' : k === idA ? 'A' : k, n.base + n.ids.size]));
  r.congelada_sin_repetir = !(gid && nB.notifications.has(idA)) && !nB.notifications.has('nexo_jump');
  await closeChat(A);

  // 1c. B en segundo plano con la pantalla apagada (ronda 2772)
  {
    B.win.bleInterface._stopConnectionSupervisor(); nB.setScreenOff(true);
    await sleep(800);
    t0 = Date.now();
    await openSendChat();
    const txt = 'apagada-' + via;
    sendText(A, txt);
    r.apagada_aviso_s = await waitFor(() => notifs(t0, false).length >= 1, 20000);
    r.apagada_llega_s = await waitFor(() => has((m) => m.content === txt), 20000);
    r.apagada_entregado_s = await waitFor(async () => /delivered|read/.test(((await A.win.vaultLoadMessages(gid || idB)).find((m) => m.content === txt) || {}).status || ''), 20000);
    r.apagada_despertares = nB.stats.rxWakes || 0;
    nB.setScreenOff(false); { const bi = B.win.bleInterface; bi._supervisorTimer = B.win.setInterval(() => bi._runSupervisorCycle(), bi._supervisorIntervalMs); }
    await sleep(3000);
    r.apagada_avisos = fmt(notifs(t0, false));
    r.apagada_sin_repetir = notifs(t0, false).filter((n) => !n.update).length <= 1;
    await closeChat(A);
  }

  // 2. B cerrada (la app se cierra; el Bluetooth sigue recibiendo, ver BgInbox.kt)
  B.win.close(); nB.destroyActivity(); await sleep(1000);
  t0 = Date.now();
  await openSendChat();
  sendText(A, 'cerrada-' + via);
  await sleep(1500);
  await sendPhoto(A, 30, 13);
  await waitFor(() => notifs(t0, true).length >= 2, 45000);
  await sleep(3000);
  const nc = notifs(t0, true);
  r.cerrada_avisos = fmt(nc);
  r.cerrada_aviso_texto = nc.length >= 1;
  r.cerrada_aviso_foto = gid ? nc.length >= 2 : nc.some((n) => /📷 Foto|📎 Archivo/.test(n.text));
  // Ronda 2763: con la app cerrada, el aviso de un grupo lleva su nombre (el texto corto va directo con el id del grupo)
  if (gid) r.cerrada_nombre_grupo = nc.some((n) => n.chatId === gid && n.name === 'Familia');
  r.cerrada_buzon = (nB.bgInbox || []).length;
  // Al abrir la app llega todo
  nB.load(); B = await boot('B', nB);
  r.al_abrir_texto_s = await waitFor(() => has((m) => m.content === 'cerrada-' + via), 120000);
  r.al_abrir_foto_s = await waitFor(() => has((m) => m.attachmentType && !m._own && (m.attachmentMeta || {}).name === 'foto13.jpg'), 180000);
  r.errores = logs.filter((l) => / error: /.test(l) && !/JSDOMERROR|styles\.css|Not implemented/.test(l)).slice(0, 5);
  const closedOk = ['ble', 'jump', 'group'].indexOf(via) >= 0; // Wi-Fi sin Bluetooth ni internet: nada sigue vivo
  const ok = r.fondo_texto_llega_s !== null && r.fondo_foto_llega_s !== null && r.fondo_aviso_texto && r.fondo_aviso_foto && r.fondo_no_leidos >= 2 && !r.fondo_avisos_repetidos &&
    (!frozenOk || (r.congelada_aviso_texto && r.congelada_aviso_foto && r.congelada_sin_repetir)) && r.congelada_texto_llega_s !== null && r.congelada_foto_llega_s !== null &&
    (!closedOk || (r.cerrada_aviso_texto && r.cerrada_aviso_foto && (!gid || r.cerrada_nombre_grupo))) && r.al_abrir_texto_s !== null && r.al_abrir_foto_s !== null && !r.errores.length &&
    (!frozenOk || (r.apagada_aviso_s !== null && r.apagada_aviso_s <= 8 && r.apagada_llega_s !== null && r.apagada_llega_s <= 8 && r.apagada_entregado_s !== null && r.apagada_entregado_s <= 10 && r.apagada_sin_repetir));
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('NOTIFY ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_notify_' + via + '.txt'), logs.join('\n'));
  relays.forEach((x) => { try { x.stop(); } catch (e) {} });
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error(e); fs.writeFileSync(path.join(__dirname, 'last_logs_notify_' + via + '.txt'), logs.join('\n')); process.exit(1); });
