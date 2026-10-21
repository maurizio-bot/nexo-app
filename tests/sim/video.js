// Vídeo en dos pasos: previa (rápida) y HD automático que sustituye a la previa en el receptor.
// jsdom no tiene MediaRecorder: la recodificación se sustituye por una previa simulada
// (window.NEXO_makeVideoPreview); el resto es el código real de la app.
// Uso: node video.js <dir_build> [--orig-kb=300] [--preview-kb=45] [--cut] [--io-delay=25]
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone } = require('./native_mock');

const buildDir = path.resolve(process.argv[2]);
const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith('--' + k)); if (!a) return d; const v = a.split('=')[1]; return v === undefined ? true : Number(v); };
const origKb = arg('orig-kb', 300), previewKb = arg('preview-kb', 45), cut = !!arg('cut', false), restartA = !!arg('restart-a', false);
const opts = { readsContentFallback: true, retain: ['onPayloadReceived'], closeOnNoService: true, pace: [15, 15], ioDelay: arg('io-delay', 0), supervisionMs: 3000 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
class DistLoader extends ResourceLoader {
  constructor(dir) { super(); this.dir = dir; }
  fetch(url) { const f = path.join(this.dir, decodeURIComponent(new URL(url).pathname)); return fs.existsSync(f) ? Promise.resolve(fs.readFileSync(f)) : Promise.reject(new Error('no existe ' + f)); }
}
const logs = [];
async function boot(name, native) {
  const vc = new VirtualConsole();
  ['log', 'warn', 'error'].forEach((l) => vc.on(l, (...a) => logs.push(`${new Date().toISOString().substring(14, 23)} [${name}] ${l}: ` + a.map(String).join(' ').substring(0, 250))));
  const dom = new JSDOM(fs.readFileSync(path.join(buildDir, 'dist', 'index.html'), 'utf8'), {
    url: 'https://' + name.toLowerCase() + '.nexo.test/index.html', runScripts: 'dangerously',
    resources: new DistLoader(path.join(buildDir, 'dist')), pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) {
      win.CapacitorCustomPlatform = { name: 'android' }; win.Capacitor = { Plugins: { NexoBLE: native.plugin() } }; win.HTMLElement.prototype.scrollTo = function () {};
      let n = 0; win.URL.createObjectURL = () => 'blob:sim/' + (++n); win.__revoked = new Set(); win.URL.revokeObjectURL = (u) => win.__revoked.add(u);
      // Previa simulada: el original reducido a previewKb (como haría la recodificación a 240p)
      win.NEXO_makeVideoPreview = (blob) => { const b = new win.Blob([new Uint8Array(previewKb * 1024).fill(7)], { type: 'video/webm' }); b.thumb = 'T'.repeat(6000); return Promise.resolve(b); };
    },
  });
  const win = dom.window;
  for (let i = 0; i < 100 && !(win.NEXO && win.NEXO.initialized); i++) await sleep(100);
  await sleep(800);
  return { name, native, win };
}
const click = (win, el) => el.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
async function openChat(p) { click(p.win, p.win.document.querySelector('#main-contacts-list .ble-contact-row')); await sleep(400); }
async function sendText(p, t) { const i = p.win.document.getElementById('message-input'); i.value = t; i.dispatchEvent(new p.win.Event('input', { bubbles: true })); click(p.win, p.win.document.getElementById('send-btn')); }
const videoBubbles = (p) => Array.from(p.win.document.querySelectorAll('#messages-container .message:not(.progress-placeholder)')).filter((m) => m.querySelector('.video-attachment'));
const badge = (p) => { const v = videoBubbles(p)[0]; const b = v && v.querySelector('.hd-badge'); return b ? b.textContent : null; };

(async () => {
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', opts), nB = new NativePhone('B', 'BB:BB:BB:BB:BB:02', opts);
  radio.add(nA); radio.add(nB); nA.load(); nB.load();
  let [A, B] = await Promise.all([boot('A', nA), boot('B', nB)]);
  A.win.bleInterface.togglePanel();
  let add = null;
  for (let i = 0; i < 400 && !add; i++) { await sleep(100); add = A.win.document.querySelector('#ble-new-device button'); if (!add && !A.win.bleInterface.isScanning) click(A.win, A.win.document.getElementById('ble-scan-btn')); }
  click(A.win, add); await sleep(1500);
  A.win.bleInterface.togglePanel();
  await openChat(A); await sendText(A, 'hola'); await sleep(2500);
  await openChat(B); await sleep(500);
  const idA = A.win.bleInterface.localNexoId, idB = B.win.bleInterface.localNexoId;

  const orig = new A.win.Blob([new Uint8Array(origKb * 1024).fill(3)], { type: 'video/mp4' });
  const t0 = Date.now();
  A.win.NEXO_sendVideo(orig, { name: 'clip.mp4', size: orig.size, mime: 'video/mp4', duration: 5 });
  const r = { build: path.basename(buildDir), original_KB: origKb, previa_KB: previewKb, corte_durante_HD: cut, A_reinicia: restartA };
  const badgesB = new Set(), badgesA = new Set();
  let textoEnviado = false, tTexto = 0, cutDone = false;
  for (let i = 0; i < 1500; i++) {
    await sleep(200);
    const bA = badge(A), bB = badge(B);
    if (bA) badgesA.add(bA.replace(/\d+%/, 'N%'));
    if (bB) badgesB.add(bB.replace(/\d+%/, 'N%'));
    if (!r.previa_llega_s && videoBubbles(B).length) r.previa_llega_s = Math.round((Date.now() - t0) / 100) / 10;
    // Durante el HD: un texto debe pasar enseguida
    if (!textoEnviado && bB && /HD \d+%/.test(bB)) { textoEnviado = true; tTexto = Date.now(); await sendText(A, 'texto durante HD'); }
    if (textoEnviado && !r.texto_durante_HD_s && B.win.document.body.innerHTML.indexOf('texto durante HD') >= 0) r.texto_durante_HD_s = Math.round((Date.now() - tTexto) / 100) / 10;
    // A cierra la app a mitad del HD y la vuelve a abrir
    if (restartA && !cutDone && bB && /HD (\d+)%/.test(bB) && Number(bB.match(/HD (\d+)%/)[1]) >= 30) {
      cutDone = true; r.A_cierra_en = bB;
      A.win.close(); nA.destroyActivity(); await sleep(3000);
      nA.load(); A = await boot('A', nA);
    }
    // Corte de enlace a mitad del HD
    if (cut && !cutDone && bB && /HD (\d+)%/.test(bB) && Number(bB.match(/HD (\d+)%/)[1]) >= 30) {
      cutDone = true; r.corte_en = bB; nB.setOffline(true); await sleep(10000); nB.setOffline(false);
    }
    const vB = (await B.win.vaultLoadMessages(idA)).find((m) => m.attachmentType === 'video');
    if (vB && vB.attachmentMeta && vB.attachmentMeta.hd) { r.HD_completo_s = Math.round((Date.now() - t0) / 100) / 10; break; }
  }
  await sleep(3000);
  const vB = (await B.win.vaultLoadMessages(idA)).filter((m) => m.attachmentType === 'video');
  const vA = (await A.win.vaultLoadMessages(idB)).filter((m) => m.attachmentType === 'video');
  const fileB = vB[0] && vB[0].attachmentRef ? nB.files.get(vB[0].attachmentRef) : null;
  Object.assign(r, {
    videos_en_B_historial: vB.length, burbujas_video_B: videoBubbles(B).length,
    B_tiene_original_KB: fileB ? Math.round(fileB.length * 3 / 4 / 1024) : null,
    etiquetas_B: Array.from(badgesB), etiquetas_A: Array.from(badgesA), etiqueta_final_A: badge(A), etiqueta_final_B: badge(B),
    A_hdStatus: vA[0] && vA[0].hdStatus, A_estado: vA[0] && vA[0].status,
    contactos_B: Array.from(B.win.document.querySelectorAll('#main-contacts-list .ble-contact-msg')).map((e) => e.textContent),
  });
  // Ver el vídeo dos veces en B: abrir visor, cerrar, volver a abrir; la URL de la burbuja debe seguir viva
  const vidB = videoBubbles(B)[0] && videoBubbles(B)[0].querySelector('.video-attachment');
  if (vidB) {
    for (let k = 0; k < 2; k++) {
      click(B.win, vidB); await sleep(400);
      const ov = B.win.document.getElementById('fullscreen-media-overlay');
      r['visor_abre_' + (k + 1)] = !!ov;
      const closeBtn = ov && ov.querySelector('button'); if (closeBtn) click(B.win, closeBtn); await sleep(300);
    }
    r.url_burbuja_destruida = B.win.__revoked.has(vidB.dataset.src);
    r.poster_en_B = ((vidB.querySelector('img.video-thumb') || {}).src || '').substring(0, 30);
  }
  // Reabrir el chat en A: el vídeo propio debe verse con su etiqueta HD ✓
  A.win.dispatchEvent(new A.win.CustomEvent('nexo:ble:closeChat', { detail: {} })); await sleep(500);
  await openChat(A); await sleep(1500);
  r.A_tras_reabrir_chat = badge(A);
  console.log('VIDEO ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_video.txt'), logs.join('\n'));
  process.exit(0);
})().catch((e) => { console.error('FALLO:', e.stack); process.exit(1); });
