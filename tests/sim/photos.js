// Fotos de tamaño real en las dos direcciones (informe del dueño con la 2722: de A se quedó en 20 % y salió un
// "mensaje de código"; de B se quedó en "○" sin porcentaje). Registra el progreso que ve quien envía, si llega,
// el estado final y cualquier burbuja con texto técnico (JSON, E2:, etc.) en cualquiera de los dos.
// --kb=N: tamaño de la foto (por defecto 300 KB, como una foto a 1600 px). --wd: Wi-Fi Direct en los dos.
// --plugin-thread=N (ms por MB) y --off-thread: hilo único de Capacitor / archivos en hilos propios (2722).
// --camera: al 20 % B abre la cámara de NEXO (pausa el Bluetooth), hace su foto y la envía.
// --cut: la foto de A se corta al 20 % y durante el corte (--cut-ms) B manda la suya.
// --bridge-ms=N: coste de cada aviso Android → app (en fila); --kotlin-2722: todos los registros cruzan.
// Uso: node photos.js <dir_build> [--kb=300] [--wd] [--plugin-thread=150] [--off-thread] [--cut] [--io-delay=25]
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone, installWebCrypto } = require('./native_mock');

const buildDir = path.resolve(process.argv[2]);
const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith('--' + k)); if (!a) return d; const v = a.split('=')[1]; return v === undefined ? true : Number(v); };
const kb = arg('kb', 300), wd = !!arg('wd', false), pt = arg('plugin-thread', 0), off = !!arg('off-thread', false), cut = !!arg('cut', false) || !!arg('camera', false), camera = !!arg('camera', false), cutMs = arg('cut-ms', 15000), bridgeMs = arg('bridge-ms', 0), k2722 = !!arg('kotlin-2722', false);
const opts = { readsContentFallback: true, retain: ['onPayloadReceived'], closeOnNoService: true, pace: [15, 15], ioDelay: arg('io-delay', 25), asymmetric: true, wifiDirect: wd, pluginThread: pt || undefined, ioOffThread: off, bridgeMs, remLogAll: k2722 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
class DistLoader extends ResourceLoader {
  constructor(dir) { super(); this.dir = dir; }
  fetch(url) { const f = path.join(this.dir, decodeURIComponent(new URL(url).pathname)); return fs.existsSync(f) ? Promise.resolve(fs.readFileSync(f)) : Promise.reject(new Error('no existe ' + f)); }
}
const logs = [];
async function boot(name, native) {
  native.listeners = new Map();
  const vc = new VirtualConsole();
  ['log', 'warn', 'error'].forEach((l) => vc.on(l, (...a) => logs.push(`${new Date().toISOString().substring(14, 23)} [${name}] ${l}: ` + a.map(String).join(' ').substring(0, 300))));
  vc.on('jsdomError', (e) => logs.push(`[${name}] JSDOMERROR ${e.message}`));
  const dom = new JSDOM(fs.readFileSync(path.join(buildDir, 'dist', 'index.html'), 'utf8'), {
    url: 'https://' + name.toLowerCase() + '.nexo.test/index.html', runScripts: 'dangerously',
    resources: new DistLoader(path.join(buildDir, 'dist')), pretendToBeVisual: true, virtualConsole: vc,
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
  click(p.win, row); await sleep(600); return !!row;
}
function sendText(p, t) { const i = p.win.document.getElementById('message-input'); i.value = t; i.dispatchEvent(new p.win.Event('input', { bubbles: true })); click(p.win, p.win.document.getElementById('send-btn')); }
async function sendPhoto(p, name, bytes) {
  const b = Buffer.alloc(bytes); b[0] = 0xff; b[1] = 0xd8; for (let i = 2; i < b.length; i++) b[i] = (i * 31 + name.length * 7) & 255;
  click(p.win, p.win.document.querySelector('.attach-menu-item[data-type="file"]')); await sleep(100);
  const fin = Array.from(p.win.document.querySelectorAll('input[type=file]')).pop();
  Object.defineProperty(fin, 'files', { configurable: true, value: [new p.win.File([b], name, { type: 'image/jpeg' })] });
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
// Burbujas con texto técnico a la vista (lo que el dueño llama "mensaje de código")
const codeBubbles = (p) => Array.from(p.win.document.querySelectorAll('#messages-container .message .msg-content'))
  .map((e) => e.textContent).filter((t) => /[{}]|"type"|E[12]:|nexo_|base64|msgId/.test(t)).map((t) => t.substring(0, 120));
const ownLast = (p) => { const m = Array.from(p.win.document.querySelectorAll('#messages-container .message.own')).pop(); if (!m) return null; return { estado: ((m.querySelector('.msg-status') || {}).className || '').replace('msg-status status-', ''), texto_estado: ((m.querySelector('.msg-status') || {}).textContent || '').trim(), progreso: Array.from(m.querySelectorAll('[data-progress-id], .file-progress, .progress-text')).map((e) => e.textContent.trim()).join('|') }; };

async function oneWay(S, R, label, bytesKb) {
  const out = {};
  const idS = S.win.bleInterface.localNexoId;
  const seen = new Set();
  const c0S = S.native.calls.length, c0R = R.native.calls.length;
  const t0 = Date.now();
  const sent = await sendPhoto(S, label + '.jpg', bytesKb * 1024);
  let arrived = null;
  for (let i = 0; i < 600; i++) {
    await sleep(250);
    const o = ownLast(S); if (o) seen.add(o.texto_estado + (o.progreso ? ' ' + o.progreso : ''));
    const msgs = await R.win.vaultLoadMessages(idS);
    const m = msgs.find((x) => x.attachmentType && x.attachmentType !== 'text' && !x._own);
    if (m) {
      arrived = { s: Math.round((Date.now() - t0) / 100) / 10, tipo: m.attachmentType };
      // Idéntica: lo que la app guardó (al rato: el guardado del adjunto va aparte) y lo que muestra
      await sleep(3000);
      const m2 = (await R.win.vaultLoadMessages(idS)).find((x) => x.msgId === m.msgId) || m;
      const disk = m2.attachmentRef && R.native.files.get(m2.attachmentRef);
      arrived.identica_en_disco = (m2.attachmentPayload || disk) === sent.toString('base64');
      arrived.ref = m2.attachmentRef ? 'externo' : (m2.attachmentPayload ? 'en el historial' : 'nada');
      break;
    }
  }
  await sleep(2500);
  out.llega = arrived;
  out.progreso_visto_por_quien_envia = Array.from(seen).slice(0, 12);
  out.estado_final_emisor = ownLast(S);
  // Escrituras a disco durante la foto, por tipo de archivo (cuántas y KB)
  const sum = (calls) => { const o = {}; calls.filter((c) => c.name === 'saveToFile').forEach((c) => { const k = String(c.args.filename).replace(/_nx[0-9a-z]+|msg[0-9a-z_]+|[0-9]{6,}/g, '*'); o[k] = o[k] || [0, 0]; o[k][0]++; o[k][1] += Math.round(String(c.args.content || '').length / 1024); }); return o; };
  out.escrituras_emisor = sum(S.native.calls.slice(c0S));
  out.escrituras_receptor = sum(R.native.calls.slice(c0R));
  return out;
}

(async () => {
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', opts), nB = new NativePhone('B', 'BB:BB:BB:BB:BB:02', opts);
  radio.add(nA); radio.add(nB); nA.load(); nB.load();
  const A = await boot('A', nA), B = await boot('B', nB);
  const r = { build: path.basename(buildDir), kb, wifi_direct: wd, hilo_plugin_ms_mb: pt, archivos_en_otro_hilo: off, puente_ms_por_aviso: bridgeMs, kotlin: k2722 ? '2722' : '2723' };
  A.win.bleInterface.togglePanel(); const paired = await addFound(A, 'B'); A.win.bleInterface.togglePanel();
  if (!paired) { console.log('PHOTOS ' + JSON.stringify({ error: 'no empareja' })); process.exit(0); }
  await openChatWith(A, 'B'); sendText(A, 'hola B'); await sleep(3000);
  await openChatWith(B, 'A'); sendText(B, 'hola A'); await sleep(3000);
  if (!cut) {
    r.A_a_B = await oneWay(A, B, 'fotoA', kb);
    r.B_a_A = await oneWay(B, A, 'fotoB', kb);
  } else {
    // Como lo vio el dueño: la foto de A se corta al 20 % (fuera de alcance / Bluetooth caído) y durante el corte
    // B manda la suya. Al volver el alcance, las dos deben terminar de llegar.
    const idA = A.win.bleInterface.localNexoId, idB = B.win.bleInterface.localNexoId;
    const seenA = new Set(), seenB = new Set();
    const sentA = await sendPhoto(A, 'fotoA.jpg', kb * 1024);
    let cutAt = null;
    for (let i = 0; i < 400 && !cutAt; i++) { await sleep(100); const o = ownLast(A); if (o) { seenA.add(o.texto_estado); const m = /(\d+)%/.exec(o.texto_estado); if (m && Number(m[1]) >= 20) cutAt = o.texto_estado; } }
    r.corte_en = cutAt;
    let sentB;
    if (camera) {
      // Como la cámara de NEXO: al abrirla B pausa el Bluetooth (desconecta a todos); al hacer la foto lo
      // reanuda y la envía al cerrar
      r.modo = 'B abre la cámara durante la foto de A';
      B.win.bleInterface.pauseBLEForCamera();
      for (let i = 0; i < cutMs / 250; i++) { await sleep(250); const a = ownLast(A); if (a) seenA.add(a.texto_estado); }
      await B.win.bleInterface.resumeBLEAfterCamera();
      sentB = await sendPhoto(B, 'fotoB.jpg', kb * 1024);
    } else {
      radio.block(nA, nB);
      await sleep(2000);
      sentB = await sendPhoto(B, 'fotoB.jpg', kb * 1024);
      for (let i = 0; i < cutMs / 250; i++) { await sleep(250); const a = ownLast(A), b = ownLast(B); if (a) seenA.add(a.texto_estado); if (b) seenB.add(b.texto_estado); }
      radio.unblock(nA, nB);
    }
    const t0 = Date.now();
    let gotB = null, gotA = null;
    for (let i = 0; i < 720 && !(gotA && gotB); i++) {
      await sleep(250);
      const a = ownLast(A), b = ownLast(B); if (a) seenA.add(a.texto_estado); if (b) seenB.add(b.texto_estado);
      if (!gotB && (await B.win.vaultLoadMessages(idA)).some((m) => m.attachmentType && !m._own)) gotB = Math.round((Date.now() - t0) / 100) / 10;
      if (!gotA && (await A.win.vaultLoadMessages(idB)).some((m) => m.attachmentType && !m._own)) gotA = Math.round((Date.now() - t0) / 100) / 10;
    }
    await sleep(3000);
    r.foto_de_A_llega_a_B_tras_volver_s = gotB;
    r.foto_de_B_llega_a_A_tras_volver_s = gotA;
    r.estados_A = Array.from(seenA).slice(-10);
    r.estados_B = Array.from(seenB).slice(-10);
    r.final_A = ownLast(A); r.final_B = ownLast(B);
    const dB = (await B.win.vaultLoadMessages(idA)).find((m) => m.attachmentType && !m._own);
    const dA = (await A.win.vaultLoadMessages(idB)).find((m) => m.attachmentType && !m._own);
    r.identicas = [dB && (dB.attachmentPayload || nB.files.get(dB.attachmentRef)) === sentA.toString('base64'), dA && (dA.attachmentPayload || nA.files.get(dA.attachmentRef)) === sentB.toString('base64')];
  }
  r.avisos_por_el_puente = { A: nA.stats.bridgeEvents || 0, B: nB.stats.bridgeEvents || 0, registros_nativos: (nA.stats.remLogsToJs || 0) + (nB.stats.remLogsToJs || 0), espera_max_ms: Math.max(nA.stats.bridgeWaitMax || 0, nB.stats.bridgeWaitMax || 0) };
  r.codigo_a_la_vista_A = codeBubbles(A);
  r.codigo_a_la_vista_B = codeBubbles(B);
  r.errores = logs.filter((l) => / error: | warn: |JSDOMERROR/.test(l)).map((l) => l.substring(0, 220)).slice(0, 15);
  console.log('PHOTOS ' + JSON.stringify(r, null, 1));
  fs.writeFileSync(path.join(__dirname, 'last_logs_photos.txt'), logs.join('\n'));
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
