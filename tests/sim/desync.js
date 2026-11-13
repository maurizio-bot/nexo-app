// 3067 (diagnóstico del S24 13-11, 12:32–12:40, build 3043 con el Nubia en 3041): el Nubia se reinició en plena videollamada
// y desde entonces cada ~12 s «[WIFI] Comprobación de nx10b6f4ac ilegible: Mensaje ya recibido» durante 8 min: el Wi-Fi no
// se comprobaba nunca y lo que mandaba el Nubia no llegaba. Causa reproducida: el estado de cifrado del que se reinicia
// vuelve a una copia ANTERIOR a lo que ya había mandado → reutiliza números de mensaje → el otro lo tira como repetición
// para siempre (y él no puede leer lo nuevo del otro).
// Aquí: A y B por Bluetooth y Wi-Fi; se guarda una copia del cifrado de B; siguen hablando; B se reinicia con la copia.
//  1) ¿Vuelve a comprobarse el Wi-Fi? (antes: nunca, «Mensaje ya recibido» cada pocos segundos)
//  2) ¿llega a A un texto de B? (antes: nunca)   3) ¿y uno de A a B?
// Uso: node desync.js <dir_build> [--sin-wifi] [--b=<dir_build de B>]   (sin Wi-Fi entre los dos: solo Bluetooth; destraba el aviso oculto de main.js)
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone, installWebCrypto } = require('./native_mock');

const buildDir = path.resolve(process.argv[2]);
const noWifi = process.argv.includes('--sin-wifi');
// 3069 --perdidos: A manda 3 textos justo después de que B arranca atrasado (como el S24 12:36–12:40): ninguno debe perderse ni
// duplicarse; --sin-contador: B pierde también el número apuntado aparte (no puede darse cuenta solo: lo detecta A o al no leer)
const lost = process.argv.includes('--perdidos');
const noHw = process.argv.includes('--sin-contador');
const TAG = lost ? (noHw ? 'DESATASCOSC' : 'DESATASCO') : (noWifi ? 'DESYNCBT' : 'DESYNC');
// --b=<dir_build>: B (el que se reinicia con el cifrado atrasado) con otra build (p. ej. el Nubia aún en una anterior)
const bArg = process.argv.find((a) => a.startsWith('--b='));
const buildB = bArg ? path.resolve(bArg.substring(4)) : buildDir;
const opts = { readsContentFallback: true, retain: ['onPayloadReceived', 'onLanMessage', 'onLanUp', 'onLanDown'], closeOnNoService: true, pace: [15, 15], ioDelay: 25, asymmetric: true, wifi: noWifi ? null : 'casa' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
class DistLoader extends ResourceLoader {
  constructor(dir) { super(); this.dir = dir; }
  fetch(url) { const f = path.join(this.dir, decodeURIComponent(new URL(url).pathname)); return fs.existsSync(f) ? Promise.resolve(fs.readFileSync(f)) : Promise.reject(new Error('no existe ' + f)); }
}
const logs = [];
async function boot(name, native, dir) {
  dir = dir || buildDir;
  native.listeners = new Map();
  const vc = new VirtualConsole();
  ['log', 'warn', 'error'].forEach((l) => vc.on(l, (...a) => logs.push(`${new Date().toISOString().substring(14, 23)} [${name}] ${l}: ` + a.map(String).join(' ').substring(0, 250))));
  const dom = new JSDOM(fs.readFileSync(path.join(dir, 'dist', 'index.html'), 'utf8'), {
    url: 'https://' + name.toLowerCase() + '.nexo.test/index.html', runScripts: 'dangerously',
    resources: new DistLoader(path.join(dir, 'dist')), pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) { win.CapacitorCustomPlatform = { name: 'android' }; installWebCrypto(win); win.Capacitor = { Plugins: { NexoBLE: native.plugin() } }; win.HTMLElement.prototype.scrollTo = function () {}; },
  });
  const win = dom.window;
  for (let i = 0; i < 100 && !(win.NEXO && win.NEXO.initialized); i++) await sleep(100);
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

(async () => {
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', opts), nB = new NativePhone('B', 'BB:BB:BB:BB:BB:02', opts);
  [nA, nB].forEach((n) => { radio.add(n); n.load(); });
  let A = await boot('A', nA), B = await boot('B', nB, buildB);
  const idA = A.win.bleInterface.localNexoId.toLowerCase(), idB = B.win.bleInterface.localNexoId.toLowerCase();
  const r = { build: path.basename(buildDir), build_B: path.basename(buildB), wifi: !noWifi };
  A.win.bleInterface.togglePanel(); const paired = await addFound(A, 'B'); A.win.bleInterface.togglePanel();
  if (!paired) { console.log('DESYNC ' + JSON.stringify({ error: 'no empareja' })); process.exit(0); }
  const has = async (p, from, f) => (await p.win.vaultLoadMessages(from)).some(f);
  const got = (p, from, t) => has(p, from, (m) => m.content === t && !m._own);
  await openChatWith(A, 'B'); sendText(A, 'hola B'); await waitFor(() => got(B, idA, 'hola B'), 20000);
  await openChatWith(B, 'A'); sendText(B, 'hola A'); await waitFor(() => got(A, idB, 'hola A'), 20000);
  if (!noWifi) { A.win.bleInterface.lan.start(); B.win.bleInterface.lan.start(); }
  const viaA = () => A.win.bleInterface.linkOf(idB), viaB = () => B.win.bleInterface.linkOf(idA);
  if (!noWifi) r.wifi_al_principio_s = await waitFor(() => viaA() === 'wifi' && viaB() === 'wifi', 30000);
  // Copia del cifrado de B; después siguen hablando en los dos sentidos (las cadenas avanzan)
  const snap = nB.files.get('nexo_ratchet.json');
  const snapHw = nB.files.get('nexo_ratchet_hw.json');
  let ok = true;
  for (let i = 0; i < 4; i++) {
    sendText(A, 'a' + i); ok = ok && (await waitFor(() => got(B, idA, 'a' + i), 20000)) !== null;
    sendText(B, 'b' + i); ok = ok && (await waitFor(() => got(A, idB, 'b' + i), 20000)) !== null;
  }
  r.conversacion_tras_la_copia = ok;
  // --perdidos: B ve un último mensaje de A (sin contestar) antes de cerrarse: en el desatasco A se lo reenvía (está en su ventana)
  //  y B, que ya lo tenía, no debe mostrarlo dos veces ni sumarlo a «no leídos»
  let vId0 = null;
  if (lost) {
    // B con el chat cerrado: le llega y avisa (no leído, sin «leído» de vuelta → A lo tiene como entregado y entra en su ventana)
    B.win.bleInterface._activeChatDeviceId = null;
    sendText(A, 'visto antes'); r.visto_antes_llega = (await waitFor(() => got(B, idA, 'visto antes'), 20000)) !== null; await sleep(3500);
    vId0 = ((await A.win.vaultLoadMessages(idB)).find((m) => m._own && m.content === 'visto antes') || {}).msgId;
    r.visto_antes_avisado = !!(B.win.NEXO_notifier && (B.win.NEXO_notifier.unreadIds.get(idA) || []).indexOf(vId0) >= 0);
  }
  // B se reinicia y su cifrado vuelve a la copia
  B.win.close(); nB.destroyActivity(); await sleep(1500);
  nB.files.set('nexo_ratchet.json', snap);
  if (process.env.DUMP) fs.writeFileSync(process.env.DUMP, snap);
  // --perdidos: con la app de B CERRADA, A manda 3 textos; el nativo de B los guarda y confirma la entrega (✓✓) sin poder leerlos
  //  (así se perdieron los del S24 de 12:36–12:40: el Nubia los confirmó y luego no los pudo descifrar)
  if (lost) {
    for (let i = 0; i < 3; i++) { sendText(A, 'perdido ' + i); await sleep(400); }
    const deliv = async () => { const ms = await A.win.vaultLoadMessages(idB); return [0, 1, 2].every((i) => ms.some((m) => m.content === 'perdido ' + i && (m.status === 'delivered' || m.status === 'read'))); };
    r.perdidos_con_dobles_s = await waitFor(deliv, 30000);
    r.bandeja_cerrada = (nB.bgInbox || []).length;
  }
  if (noHw) { if (snapHw === undefined) nB.files.delete('nexo_ratchet_hw.json'); else nB.files.set('nexo_ratchet_hw.json', snapHw); }
  nB.load(); B = await boot('B', nB, buildB);
  // --perdidos: qué mensajes SUMAN «no leídos» en B tras arrancar (medido en el momento: abrir el chat luego los pone a cero)
  const countedB = [];
  if (lost && B.win.NEXO_notifier) {
    const nf = B.win.NEXO_notifier, orig = nf.incoming.bind(nf);
    nf.incoming = function(m) { const c = String((m && m.cid) || '').toLowerCase(), b0 = (nf.unreadIds.get(c) || []).length; orig(m); if ((nf.unreadIds.get(c) || []).length > b0) countedB.push(m.msgId); };
  }
  if (!noWifi) B.win.bleInterface.lan.start();
  const mark = logs.length;
  const t0 = Date.now();
  // --perdidos: cuánto tardan en llegar los 3 desde que B arranca (en paralelo a lo demás)
  let tLost = null;
  if (lost) { (async () => { const tt = await waitFor(async () => { try { const ms = await Promise.race([B.win.vaultLoadMessages(idA), sleep(1500).then(() => [])]); return [0, 1, 2].every((i) => ms.some((m) => m.content === 'perdido ' + i && !m._own)); } catch (e) { return false; } }, 120000); tLost = tt; })(); }

  // 1) Wi-Fi comprobado otra vez
  if (!noWifi) r.wifi_tras_reinicio_s = await waitFor(() => viaA() === 'wifi' && viaB() === 'wifi', 90000);
  // 2) Texto de B a A
  await openChatWith(B, 'A'); sendText(B, 'B tras reiniciar');
  r.texto_B_a_A_s = await waitFor(() => got(A, idB, 'B tras reiniciar'), 90000);
  // 3) Texto de A a B
  sendText(A, 'A tras reiniciar B');
  r.texto_A_a_B_s = await waitFor(() => got(B, idA, 'A tras reiniciar B'), 60000);
  const after = logs.slice(mark);
  r.ya_recibido_en_A = after.filter((l) => /^\S+ \[A\].*(Mensaje ya recibido)/.test(l)).length;
  r.desfase_detectado = after.some((l) => /\[A\].*Desfase de cifrado/.test(l));
  if (lost) r.visto_antes_reenviado = logs.slice(mark).some((l) => /\[A\].*Desatasco con .*reenvío [4-9] mensaje/.test(l));
  if (lost) {
    const all3 = async () => { const ms = await B.win.vaultLoadMessages(idA); return [0, 1, 2].every((i) => ms.some((m) => m.content === 'perdido ' + i && !m._own)); };
    r.perdidos_llegan_s = await waitFor(all3, 90000);
    r.perdidos_desde_arranque_s = tLost;
    await sleep(3000); // por si llegara alguno repetido
    const msB = await B.win.vaultLoadMessages(idA), msA = await A.win.vaultLoadMessages(idB);
    r.duplicados_B = ['perdido 0', 'perdido 1', 'perdido 2', 'A tras reiniciar B'].filter((t) => msB.filter((m) => m.content === t).length > 1).length;
    r.duplicados_A = ['B tras reiniciar'].filter((t) => msA.filter((m) => m.content === t).length > 1).length;
    r.visto_antes_copias_B = msB.filter((m) => m.content === 'visto antes').length;
    r.visto_antes_no_leido_otra_vez = !!vId0 && countedB.indexOf(vId0) >= 0;
    r.no_leidos_nuevos_B = countedB.length;
    r.burbujas_aviso = [A, B].reduce((n, p) => n + Array.from(p.win.document.querySelectorAll('.message')).filter((d) => /nexo_act|"e2e"|"rst"/.test(d.textContent)).length, 0);
    const after2 = logs.slice(mark);
    r.desatasco = after2.some((l) => /Desatasco con .*reenvío [1-9]/.test(l));
    r.atrasado_solo = after2.some((l) => /\[B\].*ATRASADO/.test(l));
  }
  r.segundos_total = Math.round((Date.now() - t0) / 1000);
  r.resultado = ((noWifi || r.wifi_tras_reinicio_s !== null) && r.texto_B_a_A_s !== null && r.texto_A_a_B_s !== null && r.conversacion_tras_la_copia &&
    (!lost || (r.perdidos_llegan_s !== null && r.duplicados_B === 0 && r.duplicados_A === 0 && r.burbujas_aviso === 0 && r.visto_antes_copias_B === 1 && r.visto_antes_avisado && r.visto_antes_reenviado && !r.visto_antes_no_leido_otra_vez))) ? 'OK' : 'FALLO';
  console.log(TAG + ' ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_' + TAG.toLowerCase() + '.txt'), logs.join('\n'));
  process.exit(0);
})().catch((e) => { console.error('FALLO:', e.stack); fs.writeFileSync(path.join(__dirname, 'last_logs_desync.txt'), logs.join('\n')); process.exit(1); });
