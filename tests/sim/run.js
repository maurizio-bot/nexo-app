// Prueba virtual de extremo a extremo: dos "teléfonos" ejecutando el bundle web real de la APK
// sobre jsdom, unidos por native_mock.js (réplica de NexoBlePlugin.kt).
// Uso: node run.js <dir_build> [--content-fallback] [--verbose]
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
class DistLoader extends ResourceLoader {
  constructor(dir) { super(); this.dir = dir; }
  fetch(url, opts) {
    const u = new URL(url);
    const f = path.join(this.dir, decodeURIComponent(u.pathname));
    if (!fs.existsSync(f)) return Promise.reject(new Error('no existe ' + f));
    return Promise.resolve(fs.readFileSync(f));
  }
}
const { Radio, NativePhone } = require('./native_mock');

const buildDir = path.resolve(process.argv[2]);
const contentFallback = process.argv.includes('--content-fallback');
const verbose = process.argv.includes('--verbose');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function bootPhone(name, address, radio, existingNative) {
  const native = existingNative || new NativePhone(name, address, { readsContentFallback: contentFallback });
  if (existingNative) { native.listeners = new Map(); native.calls = []; } else radio.add(native);
  native.load();
  const logs = [];
  const vc = new VirtualConsole();
  ['log', 'info', 'warn', 'error', 'debug'].forEach((lvl) => vc.on(lvl, (...a) => {
    const line = `[${name}] ${lvl}: ` + a.map((x) => (typeof x === 'string' ? x : (() => { try { return JSON.stringify(x); } catch (e) { return String(x); } })())).join(' ');
    logs.push(line);
    if (verbose) console.log(line);
  }));
  vc.on('jsdomError', (e) => logs.push(`[${name}] jsdomError: ${e.message}`));
  const html = fs.readFileSync(path.join(buildDir, 'dist', 'index.html'), 'utf8');
  const dom = new JSDOM(html, {
    url: 'https://' + name.toLowerCase() + '.nexo.test/index.html',
    runScripts: 'dangerously', resources: new DistLoader(path.join(buildDir, 'dist')), pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) {
      win.CapacitorCustomPlatform = { name: 'android' }; require('./native_mock').installWebCrypto(win);
      win.Capacitor = { Plugins: { NexoBLE: native.plugin() } };
      win.scrollTo = () => {}; win.HTMLElement.prototype.scrollTo = function () {};
    },
  });
  const win = dom.window;
  for (let i = 0; i < 100 && !(win.NEXO && win.NEXO.initialized); i++) await sleep(100);
  if (!(win.NEXO && win.NEXO.initialized)) throw new Error(name + ': la app no terminó de inicializar');
  await sleep(800);
  return { name, native, win, logs };
}

function click(win, el) { el.dispatchEvent(new win.MouseEvent('click', { bubbles: true })); }

function bubbles(win) {
  return Array.from(win.document.querySelectorAll('#messages-container .message')).map((m) => ({
    own: m.classList.contains('own'),
    text: (m.querySelector('.msg-content') || {}).textContent || '',
    status: ((m.querySelector('.msg-status') || {}).className || '').replace('msg-status ', ''),
    icon: (m.querySelector('.msg-status') || {}).textContent || '',
  }));
}

async function openChatWith(phone, peerNexoId) {
  const rows = Array.from(phone.win.document.querySelectorAll('#main-contacts-list .ble-contact-row'));
  const row = rows.find((r) => r.textContent.length > 0);
  if (!row) { console.log('DEBUG contactos', JSON.stringify(phone.win.vaultLoadContacts())); console.log('DEBUG html', phone.win.document.getElementById('main-contacts-list').outerHTML.substring(0,300)); console.log(phone.logs.slice(-40).join('\n')); throw new Error(phone.name + ': no hay contacto en la lista para abrir el chat'); }
  click(phone.win, row);
  await sleep(300);
}

async function sendText(phone, text) {
  const input = phone.win.document.getElementById('message-input');
  input.value = text;
  input.dispatchEvent(new phone.win.Event('input', { bubbles: true }));
  click(phone.win, phone.win.document.getElementById('send-btn'));
}

(async () => {
  process.on("exit", () => {});
  const radio = new Radio();
  const [A, B] = await Promise.all([bootPhone('A', 'AA:AA:AA:AA:AA:01', radio), bootPhone('B', 'BB:BB:BB:BB:BB:02', radio)]);
  const idA = A.win.bleInterface.localNexoId, idB = B.win.bleInterface.localNexoId;
  console.log(`NEXO ID A=${idA} B=${idB}`);

  // 1. A abre "Gente", busca y añade a B tocando "+"
  A.win.bleInterface.togglePanel();
  await sleep(300);
  let addBtn = null;
  for (let i = 0; i < 100 && !addBtn; i++) {
    await sleep(100);
    addBtn = A.win.document.querySelector('#ble-new-device button');
    if (!addBtn && !A.win.bleInterface.isScanning) click(A.win, A.win.document.getElementById('ble-scan-btn'));
  }
  if (!addBtn) throw new Error('A no encontró a B en el escaneo');
  click(A.win, addBtn);
  await sleep(1500);

  // 2. A abre el chat con B y envía mensajes
  await openChatWith(A, idB);
  const short = 'Hola B, prueba corta';
  const long = 'Mensaje largo: ' + 'abcdefghij'.repeat(25);
  await sendText(A, short);
  await sleep(2500);
  await sendText(A, long);
  await sleep(6000);

  // 3. B abre el chat con A (si apareció como contacto) y responde
  let bReply = null;
  const bRows = B.win.document.querySelectorAll('#main-contacts-list .ble-contact-row');
  if (bRows.length) {
    await openChatWith(B, idA);
    bReply = 'Respuesta de B';
    await sendText(B, bReply);
    await sleep(4000);
  }

  // 4. Con el chat de B abierto, A envía otro texto (debería llegar a "leído")
  const third = 'Tercero con chat abierto';
  await sendText(A, third);
  await sleep(4000);

  // 5. A envía un archivo por el menú de adjuntos (misma transferencia que las fotos)
  const fileBytes = 'ARCHIVO-NEXO-'.repeat(230); // ~3 KB
  click(A.win, A.win.document.querySelector('.attach-menu-item[data-type="file"]'));
  await sleep(100);
  const fin = Array.from(A.win.document.querySelectorAll('input[type=file]')).pop();
  let fileSent = false;
  if (fin) {
    const f = new A.win.File([fileBytes], 'prueba.txt', { type: 'text/plain' });
    Object.defineProperty(fin, 'files', { value: [f] });
    fin.dispatchEvent(new A.win.Event('change'));
    fileSent = true;
  }
  for (let i = 0; i < 60; i++) { await sleep(500); if (bubbles(B.win).some((b) => b.text.indexOf('prueba.txt') >= 0)) break; }
  await sleep(1500);

  const aB = bubbles(A.win), bB = bubbles(B.win);

  // 6. B cierra y vuelve a abrir el chat: el historial guardado debe mostrar todo
  click(B.win, B.win.document.getElementById('chat-back-btn'));
  await sleep(900);
  await openChatWith(B, idA);
  await sleep(1200);
  const bReabierto = bubbles(B.win);

  // 7. A cierra y reabre su chat: sus mensajes propios deben seguir con su estado
  click(A.win, A.win.document.getElementById('chat-back-btn'));
  await sleep(900);
  await openChatWith(A, idB);
  await sleep(1200);
  const aReabierto = bubbles(A.win);

  // 8. B se aleja; A escribe; B vuelve -> debe llegar una sola vez
  B.native.setOffline(true);
  await sleep(1500);
  const offlineText = 'Mensaje mientras B no estaba';
  await sendText(A, offlineText);
  await sleep(3000);
  const estadoOffline = (bubbles(A.win).find((b) => b.text === offlineText) || {}).status;
  B.native.setOffline(false);
  let llegoOffline = false;
  for (let i = 0; i < 60 && !llegoOffline; i++) {
    await sleep(1000);
    llegoOffline = (await B.win.vaultLoadMessages(idA)).some((m) => m.content === offlineText);
  }
  await sleep(3000);
  const vaultBfinal = await B.win.vaultLoadMessages(idA);
  const estadoTrasVolver = (bubbles(A.win).find((b) => b.text === offlineText) || {}).status;

  // 9. B se aleja; A escribe, CIERRA la app y la reabre; luego B vuelve
  B.native.setOffline(true);
  await sleep(1500);
  const restartText = 'Enviado antes de reiniciar A';
  await sendText(A, restartText);
  await sleep(2000);
  A.win.close();
  A.native.clients.clear(); A.native.serverConnected.clear(); A.native.serverNotif.clear(); A.native.pendingQueue.clear();
  await sleep(500);
  const A2 = await bootPhone('A', 'AA:AA:AA:AA:AA:01', radio, A.native);
  B.native.setOffline(false);
  let llegoRestart = false;
  for (let i = 0; i < 70 && !llegoRestart; i++) {
    await sleep(1000);
    llegoRestart = (await B.win.vaultLoadMessages(idA)).some((m) => m.content === restartText);
  }
  await sleep(3000);
  const vaultA2 = await A2.win.vaultLoadMessages(idB);
  const estadoRestart = (vaultA2.find((m) => m.content === restartText) || {}).status;
  const vaultBfin2 = await B.win.vaultLoadMessages(idA);
  const vaultB = await B.win.vaultLoadMessages(idA);
  const vaultA = await A.win.vaultLoadMessages(idB);
  const result = {
    build: path.basename(buildDir),
    contentFallback,
    A_burbujas: aB,
    B_burbujas: bB,
    B_vault_recibidos: vaultB.filter((m) => !m._own).map((m) => m.content.substring(0, 40)),
    A_vault_recibidos: vaultA.filter((m) => !m._own).map((m) => m.content.substring(0, 40)),
    A_native_sendMessage: A.native.calls.filter((c) => c.name === 'sendMessage').slice(0, 4).map((c) => ({ deviceId: c.args.deviceId, keys: Object.keys(c.args), message: (c.args.message || '').substring(0, 60) })),
    A_por_el_aire: A.native.sent.length,
    A_cola_nativa: Array.from(A.native.pendingQueue.entries()).map(([k, v]) => [k, v.length]),
  };
  const ok = {
    corto_llega: result.B_vault_recibidos.some((t) => t.indexOf('Hola B') === 0),
    largo_llega: result.B_vault_recibidos.some((t) => t.indexOf('Mensaje largo') === 0),
    corto_marca_entregado: (aB.find((b) => b.text === short) || {}).status === 'status-delivered' || (aB.find((b) => b.text === short) || {}).status === 'status-read',
    respuesta_B_llega: bReply ? result.A_vault_recibidos.some((t) => t.indexOf(bReply) === 0) : false,
    tercero_leido: (aB.find((b) => b.text === third) || {}).status === 'status-read',
    archivo_llega_a_B: bB.some((b) => b.text.indexOf('prueba.txt') >= 0),
    archivo_estado_A: ((aB.find((b) => b.text.indexOf('prueba.txt') >= 0) || {}).status) || 'sin burbuja',
    historial_A: aReabierto.filter((b) => b.own).map((b) => b.text.substring(0, 18) + '=' + b.status.replace('status-', '')),
    offline_estado_mientras: estadoOffline,
    offline_llega_al_volver: llegoOffline,
    offline_estado_tras_volver: estadoTrasVolver,
    duplicados_en_B: vaultBfinal.length - new Set(vaultBfinal.map((m) => m.msgId)).size + (vaultBfinal.filter((m) => m.content === offlineText).length > 1 ? 1 : 0),
    reinicio_llega: llegoRestart,
    reinicio_estado_guardado_A: estadoRestart,
    reinicio_duplicados_B: vaultBfin2.filter((m) => m.content === restartText).length > 1,
    historial_B_largo: bReabierto.some((b) => b.text.indexOf('Mensaje largo') === 0),
    historial_B_archivo: bReabierto.some((b) => b.text.indexOf('prueba.txt') >= 0),
    historial_B_total: bReabierto.length,
    historial_B: bReabierto.map((b) => (b.own ? 'yo:' : 'A:') + b.text.substring(0, 20)),
    vault_B: (await B.win.vaultLoadMessages(idA)).map((m) => (m._own ? 'yo:' : 'A:') + String(m.content).substring(0, 20) + '|' + (m.attachmentType || '')),
    estados_A: aB.filter((b) => b.own).map((b) => b.text.substring(0, 18) + '=' + b.status.replace('status-', '')),
  };
  console.log('TRAZA_RADIO\n' + radio.trace.join('\n'));
  console.log('B_sendMessage', JSON.stringify(B.native.calls.filter((c) => c.name === 'sendMessage').map((c) => [c.args.deviceId, (c.args.message || '').substring(0, 70)])));
  console.log(JSON.stringify(result, null, 1));
  console.log('RESULTADO', JSON.stringify(ok));
  fs.writeFileSync(path.join(__dirname, 'last_logs_' + path.basename(buildDir) + '.txt'), A.logs.concat(B.logs).join('\n'));
  process.exit(0);
})().catch((e) => { console.error('FALLO DEL ESCENARIO:', e.message); process.exit(1); });
