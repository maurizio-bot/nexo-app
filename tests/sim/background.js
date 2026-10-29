// Mensajes con la app del receptor en segundo plano o cerrada, con radio realista:
// - supervision timeout: el emisor tarda en notar la caída y lo que escribe mientras se pierde
// - escaneos que no ven al otro (--scan-miss) y límite de Android de 5 escaneos / 30 s
// Escenarios (--scenario):
//   bg     : B pasa a segundo plano, se pierde el enlace, A escribe, el enlace vuelve, B vuelve a la app
//   closed : B cierra la app, A escribe, B la reabre (el nativo arranca antes que el JS). Desde la 2758 el
//            Bluetooth de B sigue recibiendo cerrada: m1/m2 a su buzón, ✓✓ en A y notificación (--old-kotlin: no)
// --a-bg     : A pasa a segundo plano justo después de escribir (pantalla bloqueada)
// --app-events : el nativo avisa al JS de onResume/onPause (Kotlin nuevo)
// --off=25000 : tiempo sin enlace / con B cerrada (ms)
// Uso: node background.js <dir_build> --scenario=closed --a-bg --scan-miss=0.5 --app-events
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone } = require('./native_mock');

const buildDir = path.resolve(process.argv[2]);
const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith('--' + k)); if (!a) return d; const v = a.split('=')[1]; return v === undefined ? true : (isNaN(Number(v)) ? v : Number(v)); };
const scenario = arg('scenario', 'bg');
const aBg = !!arg('a-bg', false);
const offMs = arg('off', 25000);
const noM3 = !!arg('no-m3', false);
const withVideo = !!arg('video', false); // closed: A manda un vídeo (300 KB) antes de m1 // A no escribe nada más al volver B (lo normal: espera)
const opts = {
  readsContentFallback: true, retain: ['onPayloadReceived'], closeOnNoService: true, asymmetric: true,
  supervisionMs: arg('supervision', 8000), scanMiss: arg('scan-miss', 0), scanThrottle: true,
  rotateOnRestart: !!arg('rotate', false), noClosedRx: !!arg('old-kotlin', false), appStateEvents: !!arg('app-events', false), pace: [15, 15], ioDelay: arg('io-delay', 0),
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
class DistLoader extends ResourceLoader {
  constructor(dir) { super(); this.dir = dir; }
  fetch(url) { const f = path.join(this.dir, decodeURIComponent(new URL(url).pathname)); return fs.existsSync(f) ? Promise.resolve(fs.readFileSync(f)) : Promise.reject(new Error('no existe ' + f)); }
}
const allLogs = [];
async function bootJs(name, native) {
  native.listeners = new Map(); native.calls = [];
  const vc = new VirtualConsole();
  ['log', 'info', 'warn', 'error'].forEach((l) => vc.on(l, (...a) => allLogs.push(`${new Date().toISOString().substring(14, 23)} [${name}] ${l}: ` + a.map(String).join(' ').substring(0, 300))));
  let vis = 'visible';
  const dom = new JSDOM(fs.readFileSync(path.join(buildDir, 'dist', 'index.html'), 'utf8'), {
    url: 'https://' + name.toLowerCase() + '.nexo.test/index.html', runScripts: 'dangerously',
    resources: new DistLoader(path.join(buildDir, 'dist')), pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) {
      win.CapacitorCustomPlatform = { name: 'android' }; require('./native_mock').installWebCrypto(win); win.Capacitor = { Plugins: { NexoBLE: native.plugin() } }; win.HTMLElement.prototype.scrollTo = function () {};
      Object.defineProperty(win.document, 'visibilityState', { configurable: true, get: () => vis });
      Object.defineProperty(win.document, 'hidden', { configurable: true, get: () => vis === 'hidden' });
      // Vídeo (--video): jsdom no tiene blob URLs ni MediaRecorder; previa simulada de 45 KB
      let nUrl = 0; win.URL.createObjectURL = () => 'blob:sim/' + (++nUrl); win.URL.revokeObjectURL = () => {};
      win.NEXO_makeVideoPreview = () => { const b = new win.Blob([new Uint8Array(45 * 1024).fill(7)], { type: 'video/webm' }); b.thumb = 'T'.repeat(6000); return Promise.resolve(b); };
    },
  });
  const win = dom.window;
  for (let i = 0; i < 100 && !(win.NEXO && win.NEXO.initialized); i++) await sleep(100);
  await sleep(500);
  const p = { name, native, win };
  // Segundo plano / volver: el WebView cambia la visibilidad y (Kotlin nuevo) el nativo avisa
  p.setActive = (active) => {
    vis = active ? 'visible' : 'hidden';
    win.document.dispatchEvent(new win.Event('visibilitychange'));
    native.setAppActive(active);
  };
  return p;
}
const click = (win, el) => el.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
async function openChat(p) { const r = p.win.document.querySelector('#main-contacts-list .ble-contact-row'); if (!r) return false; click(p.win, r); await sleep(300); return true; }
async function sendText(p, t) { const i = p.win.document.getElementById('message-input'); i.value = t; i.dispatchEvent(new p.win.Event('input', { bubbles: true })); click(p.win, p.win.document.getElementById('send-btn')); }
const statusOf = (p, t) => { const m = Array.from(p.win.document.querySelectorAll('#messages-container .message.own')).find((x) => (x.querySelector('.msg-content') || {}).textContent === t); return m ? (m.querySelector('.msg-status') || {}).className.replace('msg-status status-', '') : 'sin burbuja'; };

(async () => {
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', opts), nB = new NativePhone('B', 'BB:BB:BB:BB:BB:02', opts);
  radio.add(nA); radio.add(nB); nA.load(); nB.load();
  let [A, B] = await Promise.all([bootJs('A', nA), bootJs('B', nB)]);
  const idA = A.win.bleInterface.localNexoId;
  // Emparejar sin fallos de escaneo (el contacto ya existe en la prueba real)
  const miss = opts.scanMiss; opts.scanMiss = 0;
  A.win.bleInterface.togglePanel();
  let add = null;
  for (let i = 0; i < 400 && !add; i++) { await sleep(100); add = A.win.document.querySelector('#ble-new-device > div button'); if (!add && !A.win.bleInterface.isScanning) click(A.win, A.win.document.getElementById('ble-scan-btn')); }
  if (!add) { console.log('BACKGROUND ' + JSON.stringify({ error: 'la prueba no pudo emparejar A con B' })); process.exit(2); }
  click(A.win, add); await sleep(1500);
  A.win.bleInterface.togglePanel();
  await openChat(A); await sendText(A, 'hola'); await sleep(2500);
  await openChat(B); await sendText(B, 'hola A'); await sleep(2500);
  opts.scanMiss = miss;

  if (scenario === 'repeat') {
    // Mismo texto varias veces con el chat abierto en B: deben verse todos
    for (let k = 0; k < 3; k++) { await sendText(A, 'ok'); await sleep(1500); }
    await sleep(2000);
    const vis = Array.from(B.win.document.querySelectorAll('#messages-container .message.other .msg-content')).filter((e) => e.textContent === 'ok').length;
    const saved = (await B.win.vaultLoadMessages(idA)).filter((m) => m.content === 'ok').length;
    console.log('BACKGROUND ' + JSON.stringify({ build: path.basename(buildDir), scenario, ok_visibles_en_B: vis, ok_guardados_en_B: saved, estados_A: Array.from(A.win.document.querySelectorAll('#messages-container .message.own .msg-status')).slice(-3).map((e) => e.className.replace('msg-status status-', '')) }));
    process.exit(0);
  }
  if (scenario === 'frozen') {
    // El Vivo del dueño CONGELA la app en segundo plano: el JS no corre, así que no puede confirmar la entrega.
    // Solo actúa el nativo (aviso de respaldo a los 4 s). Se comprueba que, aun así, el emisor A ve el ✓✓
    // (entregado) gracias a la confirmación de ENTREGA FIRMADA que el nativo manda AL AVISAR — sin esperar a que
    // B vuelva a la app. Antes (hasta 2832) el nativo solo avisaba en segundo plano pero no confirmaba, y el ✓✓
    // se quedaba corto hasta que B descongelaba. Pedido del dueño 29-10 (dos vías de confirmación del "entregado").
    await sleep(2000); // que el JS ya haya dado al nativo las claves de firma (_pushAckKeys, 4 s tras init)
    const clavesB = nB.ackKeys ? nB.ackKeys.size : 0;
    B.setActive(false); nB.setFrozen(true); await sleep(800);
    await sendText(A, 'm1'); await sleep(6000);  // > 4 s del aviso de respaldo del nativo
    await sendText(A, 'm2'); await sleep(6000);
    const estadoCongelada = ['m1', 'm2'].map((w) => w + ': ' + statusOf(A, w));
    const avisosB = nB.notifLog.filter((n) => n.bg).length;
    // B vuelve: lo retenido (congelado) se entrega, sin pérdidas ni duplicados
    nB.setFrozen(false); B.setActive(true); await sleep(4000);
    const enB = await B.win.vaultLoadMessages(idA);
    const res = {
      build: path.basename(buildDir), scenario, claves_firma_en_B: clavesB,
      estado_en_A_con_B_congelada: estadoCongelada,                 // esperado: m1/m2 'delivered' (o 'read')
      avisos_nativos_B: avisosB,                                    // esperado: >= 2 (el nativo avisó)
      recibidos_en_B_al_volver: ['m1', 'm2'].map((w) => enB.filter((m) => m.content === w).length), // esperado: [1,1]
      entregado_sin_abrir_B: estadoCongelada.every((s) => /: (delivered|read)$/.test(s)),
    };
    console.log('BACKGROUND ' + JSON.stringify(res));
    process.exit(0);
  }
  const want = noM3 ? ['m1', 'm2'] : ['m1', 'm2', 'm3'];
  let tBack; const cerrada = {};
  if (scenario === 'bg') {
    B.setActive(false); await sleep(1000);
    nB.setOffline(true);
    await sendText(A, 'm1'); await sleep(3000);
    await sendText(A, 'm2'); await sleep(3000);
    if (aBg) A.setActive(false);
    await sleep(Math.max(0, offMs - 6000));
    nB.setOffline(false); // el enlace vuelve a estar disponible, B sigue en segundo plano
    await sleep(10000);
    tBack = Date.now();
    B.setActive(true);
    await sleep(1500);
    if (!noM3) await sendText(A, 'm3');
  } else {
    B.win.close(); nB.destroyActivity();
    await sleep(arg('pre-wait', 0)); // B lleva un rato cerrada: A ya sabe que no está
    if (withVideo) { A.win.NEXO_sendVideo(new A.win.Blob([new Uint8Array(300 * 1024).fill(3)], { type: 'video/mp4' }), { name: 'clip.mp4', duration: 5 }); await sleep(2000); }
    await sendText(A, 'm1'); await sleep(3000);
    await sendText(A, 'm2'); await sleep(3000);
    // Acción oculta (borrar para todos…): al buzón pero sin notificación
    const biA = A.win.bleInterface, idB = B.win.bleInterface.localNexoId;
    if (biA.localNexoId && idB) { biA._quietOut = biA._quietOut || new Set(); biA._quietOut.add('msg_oculta_1'); biA.sendChatMessage(idB, 'oculta', 'msg_oculta_1', biA.getNextSeq()).catch(() => {}); }
    if (aBg) A.setActive(false);
    await sleep(Math.max(0, offMs - 6000));
    cerrada.oculta_en_buzon_sin_aviso = (nB.bgInbox || []).some((x) => /"msgId":"msg_oculta_1"/.test(x.c) && /"q":1/.test(x.c)) && !Array.from(nB.notifications.values()).some((n) => n.ids.has('msg_oculta_1'));
    // Kotlin 2758: con B cerrada, su Bluetooth sigue recibiendo (buzón, ✓✓ y notificación)
    cerrada.estado_en_A = ['m1', 'm2'].map((w) => w + ': ' + statusOf(A, w));
    cerrada.notificaciones_B = nB.notifLog.filter((n) => n.closed).map((n) => (n.text || 'mensaje') + ' x' + n.count);
    cerrada.en_buzon = (nB.bgInbox || []).length;
    tBack = Date.now();
    nB.load();
    if (!noM3) setTimeout(() => sendText(A, 'm3'), 1500);
    await sleep(4000);
    B = await bootJs('B', nB);
  }
  const llegada = {};
  for (let i = 0; i < 120 && Object.keys(llegada).length < want.length; i++) {
    await sleep(1000);
    const v = await B.win.vaultLoadMessages(idA);
    want.forEach((w) => { if (!llegada[w] && v.some((m) => m.content === w)) llegada[w] = Math.round((Date.now() - tBack) / 1000) + ' s'; });
    if (withVideo && !llegada.VIDEO && v.some((m) => m.attachmentType === 'video')) llegada.VIDEO = Math.round((Date.now() - tBack) / 1000) + ' s';
    if (withVideo && !llegada.HD && v.some((m) => m.attachmentType === 'video' && m.attachmentMeta && m.attachmentMeta.hd)) llegada.HD = Math.round((Date.now() - tBack) / 1000) + ' s';
  }
  if (withVideo) for (let i = 0; i < 120 && !llegada.HD; i++) {
    await sleep(1000);
    const v = await B.win.vaultLoadMessages(idA);
    if (!llegada.VIDEO && v.some((m) => m.attachmentType === 'video')) llegada.VIDEO = Math.round((Date.now() - tBack) / 1000) + ' s';
    if (v.some((m) => m.attachmentType === 'video' && m.attachmentMeta && m.attachmentMeta.hd)) llegada.HD = Math.round((Date.now() - tBack) / 1000) + ' s';
  }
  await sleep(3000);
  const res = {
    build: path.basename(buildDir), scenario, a_en_segundo_plano: aBg, app_events: opts.appStateEvents, scan_miss: opts.scanMiss,
    llegada_a_B_tras_volver: want.map((w) => w + ': ' + (llegada[w] || 'NO LLEGÓ')).concat(withVideo ? ['video: ' + (llegada.VIDEO || 'NO LLEGÓ'), 'HD: ' + (llegada.HD || 'NO LLEGÓ')] : []),
    estado_en_A: want.map((w) => w + ': ' + statusOf(A, w)),
    con_B_cerrada: scenario === 'closed' ? cerrada : undefined, entregados_desde_buzon: nB.stats.closedDelivered || 0,
    escaneos_A: nA.stats.scans || 0, escaneos_B: nB.stats.scans || 0,
    escaneos_bloqueados_por_android: (nA.stats.throttledScans || 0) + (nB.stats.throttledScans || 0),
    escaneos_sin_resultado_pantalla_apagada: (nA.stats.screenOffScans || 0) + (nB.stats.screenOffScans || 0),
    escrituras_perdidas_enlace_caido: (nA.stats.voidWrites || 0) + (nB.stats.voidWrites || 0),
  };
  console.log('BACKGROUND ' + JSON.stringify(res));
  fs.writeFileSync(process.env.SIM_LOG || path.join(__dirname, 'last_logs_background.txt'), allLogs.join('\n'));
  process.exit(0);
})().catch((e) => { console.error('FALLO:', e.stack); process.exit(1); });
