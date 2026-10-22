// Prueba de rendimiento de adjuntos: foto (~60 KB base64), varios textos después y un PDF.
// Mide tiempo de llegada, bloqueo del hilo (lag) y lo que se guarda a disco (cruza el bridge).
// Uso: node perf.js <dir_build> [--pdf-kb=400]
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone } = require('./native_mock');

const buildDir = path.resolve(process.argv[2]);
const argNum = (k, d) => { const a = process.argv.find((x) => x.startsWith('--' + k + '=')); return a ? Number(a.split('=')[1]) : d; };
const mtu = argNum('mtu', 512), loss = argNum('loss', 0);
const paceArg = (process.argv.find((x) => x.startsWith('--pace=')) || '').split('=')[1];
const pace = paceArg ? paceArg.split(',').map(Number) : undefined;
const pdfKb = Number((process.argv.find((a) => a.startsWith('--pdf-kb=')) || '--pdf-kb=400').split('=')[1]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class DistLoader extends ResourceLoader {
  constructor(dir) { super(); this.dir = dir; }
  fetch(url) { const f = path.join(this.dir, decodeURIComponent(new URL(url).pathname)); return fs.existsSync(f) ? Promise.resolve(fs.readFileSync(f)) : Promise.reject(new Error('no existe ' + f)); }
}

// Lag del hilo: ambos teléfonos comparten el hilo de Node, igual que la UI comparte el hilo del WebView
let maxLag = 0, lagSamples = [];
let last = Date.now();
setInterval(() => { const now = Date.now(); const lag = now - last - 20; if (lag > maxLag) maxLag = lag; lagSamples.push(lag); last = now; }, 20).unref();
function resetLag() { maxLag = 0; lagSamples = []; }

async function boot(name, address, radio) {
  const native = new NativePhone(name, address, { readsContentFallback: true, mtu, loss, pace, retain: ['onPayloadReceived'], scanPenalty: argNum('scan-penalty', 0) });
  radio.add(native); native.load();
  const logs = [];
  const vc = new VirtualConsole();
  ['log', 'info', 'warn', 'error'].forEach((l) => vc.on(l, (...a) => logs.push(`[${name}] ${l}: ` + a.map(String).join(' ').substring(0, 300))));
  const dom = new JSDOM(fs.readFileSync(path.join(buildDir, 'dist', 'index.html'), 'utf8'), {
    url: 'https://' + name.toLowerCase() + '.nexo.test/index.html', runScripts: 'dangerously',
    resources: new DistLoader(path.join(buildDir, 'dist')), pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) { win.CapacitorCustomPlatform = { name: 'android' }; require('./native_mock').installWebCrypto(win); win.Capacitor = { Plugins: { NexoBLE: native.plugin() } }; win.HTMLElement.prototype.scrollTo = function () {}; },
  });
  const win = dom.window;
  for (let i = 0; i < 100 && !(win.NEXO && win.NEXO.initialized); i++) await sleep(100);
  await sleep(800);
  return { name, native, win, logs };
}
const click = (win, el) => el.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
const bubbles = (win) => Array.from(win.document.querySelectorAll('#messages-container .message:not(.progress-placeholder)')).map((m) => ({
  own: m.classList.contains('own'), text: (m.querySelector('.msg-content') || {}).textContent || '',
  hasImg: !!m.querySelector('.msg-content img'),
  status: ((m.querySelector('.msg-status') || {}).className || '').replace('msg-status status-', ''),
}));
async function openChat(p) { click(p.win, p.win.document.querySelector('#main-contacts-list .ble-contact-row')); await sleep(300); }
async function sendText(p, t) { const i = p.win.document.getElementById('message-input'); i.value = t; i.dispatchEvent(new p.win.Event('input', { bubbles: true })); click(p.win, p.win.document.getElementById('send-btn')); }
async function sendFile(p, name, type, bytes) {
  click(p.win, p.win.document.querySelector('.attach-menu-item[data-type="file"]'));
  await sleep(100);
  const fin = Array.from(p.win.document.querySelectorAll('input[type=file]')).pop();
  Object.defineProperty(fin, 'files', { value: [new p.win.File([bytes], name, { type })] });
  fin.dispatchEvent(new p.win.Event('change'));
}
const snap = (p) => Object.assign({}, p.native.stats);
const delta = (a, b) => ({ perdidos: (b.lost || 0) - (a.lost || 0), cola_max: b.maxQueue || 0, descartados: (b.dropped || 0) - (a.dropped || 0), acks_enviados: (b.acksOut || 0) - (a.acksOut || 0), trozos_enviados: (b.chunksOut || 0) - (a.chunksOut || 0), guardados: b.saves - a.saves, bytes_guardados_KB: Math.round((b.saveBytes - a.saveBytes) / 1024), mayor_guardado_KB: Math.round(b.maxSave / 1024) });

(async () => {
  const radio = new Radio();
  const [A, B] = await Promise.all([boot('A', 'AA:AA:AA:AA:AA:01', radio), boot('B', 'BB:BB:BB:BB:BB:02', radio)]);
  // Conectar: A busca y añade a B, ambos abren chat
  A.win.bleInterface.togglePanel();
  let add = null;
  for (let i = 0; i < 400 && !add; i++) { await sleep(100); add = A.win.document.querySelector('#ble-new-device button'); if (!add && !A.win.bleInterface.isScanning) click(A.win, A.win.document.getElementById('ble-scan-btn')); }
  click(A.win, add); await sleep(1500);
  await openChat(A);
  // --absent: A tiene además un contacto que no está cerca (su re-búsqueda escanea durante las pruebas)
  if (process.argv.includes('--absent') && A.win.bleInterface.addSharedContacts) A.win.bleInterface.addSharedContacts([{ nexoId: 'NXC0000003', name: 'Ausente' }]);
  await sendText(A, 'hola'); await sleep(2500);
  await openChat(B); await sleep(500);

  const report = {};
  const rnd = (n) => { const b = Buffer.alloc(n); for (let i = 0; i < n; i++) b[i] = (i * 7919 + 13) & 255; return b; };

  // 0. Archivo por encima del límite: aviso y nada enviado
  const before = bubbles(A.win).length;
  await sendFile(A, 'enorme.pdf', 'application/pdf', rnd(2600 * 1024));
  await sleep(1500);
  const toast = A.win.document.getElementById('perm-error-toast');
  report.limite_archivo = { aviso: toast ? toast.textContent : null, burbujas_nuevas: bubbles(A.win).length - before };

  // 1. Foto ~45 KB binaria (~60 KB base64), como una foto de galería comprimida
  for (const [label, kb] of [['foto_1', 45], ['foto_2', 45]]) {
    resetLag(); const a0 = snap(A), b0 = snap(B); const t0 = Date.now();
    await sendFile(A, label + '.jpg', 'image/jpeg', rnd(kb * 1024));
    let ok = false; const prog = { A: new Set(), B: new Set() };
    for (let i = 0; i < 600 && !ok; i++) {
      await sleep(200);
      A.win.document.querySelectorAll('.msg-status').forEach((e) => { if (/%/.test(e.textContent)) prog.A.add(e.textContent); });
      B.win.document.querySelectorAll('[data-progress-id]').forEach((e) => prog.B.add(e.textContent));
      ok = bubbles(B.win).some((b) => b.hasImg && b.own === false && Array.from(B.win.document.querySelectorAll('#messages-container .message:not(.progress-placeholder)')).some((m) => m.innerHTML.indexOf(label) >= 0)) || bubbles(B.win).filter((b) => b.hasImg).length >= (label === 'foto_1' ? 1 : 2); }
    await sleep(300);
    report[label] = { progreso_A: Array.from(prog.A).slice(0, 4).concat(prog.A.size > 4 ? ['…' + prog.A.size] : []), progreso_B: Array.from(prog.B).slice(-2), marcador_B_tras_llegar: B.win.document.querySelectorAll('[data-progress-id]').length, llega: ok, segundos: Math.round((Date.now() - t0) / 100) / 10, lag_max_ms: maxLag, A: delta(a0, snap(A)), B: delta(b0, snap(B)) };
  }
  // 2. Coste de un texto normal después de recibir fotos (reescrituras del historial)
  resetLag(); let a0 = snap(A), b0 = snap(B);
  for (let k = 0; k < 3; k++) { await sendText(A, 'texto despues de fotos ' + k); await sleep(1500); }
  await sleep(2000);
  report.tres_textos_despues = { lag_max_ms: maxLag, A: delta(a0, snap(A)), B: delta(b0, snap(B)) };
  // 3. PDF
  resetLag(); a0 = snap(A); b0 = snap(B); const t1 = Date.now();
  await sendFile(A, 'documento.pdf', 'application/pdf', rnd(pdfKb * 1024));
  let okPdf = false;
  for (let i = 0; i < 900 && !okPdf; i++) { await sleep(200); okPdf = Array.from(B.win.document.querySelectorAll('#messages-container .message:not(.progress-placeholder)')).some((m) => m.innerHTML.indexOf('documento.pdf') >= 0); }
  if (okPdf) await sleep(3000); // dejar llegar el ack final antes de leer el estado
  report['pdf_' + pdfKb + 'KB'] = { marcador_B_tras_llegar: B.win.document.querySelectorAll('[data-progress-id]').length, llega: okPdf, segundos: Math.round((Date.now() - t1) / 100) / 10, lag_max_ms: maxLag, A: delta(a0, snap(A)), B: delta(b0, snap(B)) };
  report.estados_A = bubbles(A.win).filter((b) => b.own).map((b) => b.text.substring(0, 20) + '=' + b.status);
  report.escaneos_A = A.native.stats.scans || 0; report.escrituras_lentas_A = A.native.stats.slowWrites || 0;
  report.archivos_B = Array.from(B.native.files.entries()).map(([k, v]) => k + ':' + Math.round(v.length / 1024) + 'KB');
  console.log('PERF ' + JSON.stringify(report, null, 1));
  fs.writeFileSync(path.join(__dirname, 'last_logs_perf.txt'), A.logs.concat(B.logs).join('\n'));
  process.exit(0);
})().catch((e) => { console.error('FALLO:', e.stack); process.exit(1); });
