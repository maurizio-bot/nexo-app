// Número de seguridad por QR, en Chromium real con cámara falsa: A muestra su QR, la cámara de B "ve" ese QR
// (vídeo y4m generado del QR que dibuja A) y B lo escanea con el lector de la app (getUserMedia + jsQR).
// Casos: QR correcto → B queda verificado; QR con otro número (impostor) → aviso, sin verificar; QR de otro
// contacto → aviso; algo que no es de NEXO → aviso.
// Uso: node qr.js <dir_build>
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { Radio, NativePhone } = require('./native_mock');
const { PW, bootPhone, click, sleep } = require('./pw_harness');
const qrcode = require(path.join(__dirname, '.deps/node_modules/qrcode-generator'));

const buildDir = path.resolve(process.argv[2]);
const dist = path.join(buildDir, 'dist');
const opts = { readsContentFallback: true, retain: ['onPayloadReceived'], closeOnNoService: true, pace: [15, 15], ioDelay: 25, asymmetric: true };
const cam = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'nexo-qr-')), 'cam.y4m');

// Vídeo de la cámara falsa: el QR en gris sobre fondo claro, algo de ruido (como una cámara)
function writeCam(text) {
  const W = 640, H = 480, q = qrcode(0, 'M');
  q.addData(text); q.make();
  const n = q.getModuleCount(), cell = Math.floor(300 / (n + 8)), size = (n + 8) * cell, ox = (W - size) >> 1, oy = (H - size) >> 1;
  const frames = [];
  for (let f = 0; f < 6; f++) {
    const y = Buffer.alloc(W * H);
    for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
      let v = 200;
      const mr = Math.floor((r - oy) / cell) - 4, mc = Math.floor((c - ox) / cell) - 4;
      if (r >= oy && c >= ox && r < oy + size && c < ox + size) v = (mr >= 0 && mc >= 0 && mr < n && mc < n && q.isDark(mr, mc)) ? 40 : 230;
      y[r * W + c] = Math.max(0, Math.min(255, v + ((r * 7 + c * 13 + f * 31) % 21) - 10));
    }
    frames.push(Buffer.from('FRAME\n'), y, Buffer.alloc(W * H / 2, 128));
  }
  fs.writeFileSync(cam, Buffer.concat([Buffer.from(`YUV4MPEG2 W${W} H${H} F10:1 Ip A1:1 C420jpeg\n`)].concat(frames)));
}

(async () => {
  const logs = [];
  writeCam('nada');
  const browser = await PW.chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--use-file-for-fake-video-capture=' + cam] });
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', opts), nB = new NativePhone('B', 'BB:BB:BB:BB:BB:02', opts);
  radio.add(nA); radio.add(nB); nA.load(); nB.load();
  const A = await bootPhone(browser, 'A', nA, dist, { logs }), B = await bootPhone(browser, 'B', nB, dist, { logs });
  const r = { build: path.basename(buildDir) };
  await A.page.evaluate(() => window.bleInterface.togglePanel());
  let paired = false;
  const nContacts = (p) => p.page.evaluate(() => window.bleInterface.getBLEContacts().length);
  for (let i = 0; i < 300 && !paired; i++) {
    await sleep(200);
    if (await click(A.page, '#ble-new-device > div button')) { for (let k = 0; k < 20 && !paired; k++) { await sleep(500); paired = (await nContacts(A)) > 0; } }
    else if (!(await A.page.evaluate(() => window.bleInterface.isScanning))) await click(A.page, '#ble-scan-btn');
  }
  for (let k = 0; k < 40 && (await nContacts(B)) === 0; k++) await sleep(500);
  await sleep(1500);
  await A.page.evaluate(() => window.bleInterface.togglePanel());
  if (!paired) { console.log('QR ' + JSON.stringify({ error: 'no empareja' })); process.exit(0); }
  const idA = await A.page.evaluate(() => window.bleInterface.localNexoId), idB = await B.page.evaluate(() => window.bleInterface.localNexoId);
  const say = (p, t) => p.page.evaluate((t) => { const i = document.getElementById('message-input'); i.value = t; i.dispatchEvent(new Event('input', { bubbles: true })); document.getElementById('send-btn').dispatchEvent(new MouseEvent('click', { bubbles: true })); }, t);
  const openChat = async (p) => { for (let i = 0; i < 60; i++) { if (await p.page.evaluate(() => !!(window.NEXO.app && window.NEXO.app.activeContact))) return true; await click(p.page, '#main-contacts-list .ble-contact-row'); await sleep(500); } return false; };
  await openChat(A); await say(A, 'hola'); await sleep(3000);
  await openChat(B); await say(B, 'hola'); await sleep(3000);
  // Número de seguridad en cada teléfono (pulsar el aviso de cifrado)
  const sn = async (p) => { await click(p.page, '#e2e-banner'); for (let i = 0; i < 40; i++) { await sleep(250); const t = await p.page.evaluate(() => ((document.querySelector('#e2e-banner .e2e-fp') || {}).textContent || '').replace(/\s+/g, ' ')); const m = t.match(/(\d{5} ){11}\d{5}/); if (m) return m[0]; } return null; };
  const snA = await sn(A), snB = await sn(B);
  r.numero_igual = !!snA && snA === snB;
  r.botones_qr = await B.page.evaluate(() => !!document.querySelector('#e2e-banner .e2e-qr-show') && !!document.querySelector('#e2e-banner .e2e-qr-scan'));
  // A muestra su QR
  await click(A.page, '#e2e-banner .e2e-qr-show'); await sleep(500);
  const shown = await A.page.evaluate(() => { const b = document.querySelector('#qr-show-overlay .qr-code'); return b ? { payload: b.dataset.payload, svg: !!b.querySelector('svg') } : null; });
  r.A_muestra_qr = !!shown && shown.svg;
  r.qr_lleva = shown && shown.payload.split('|').slice(0, 3).join('|');
  await click(A.page, '#qr-show-overlay button');
  const verified = (p, id) => p.page.evaluate((id) => !!(window.vaultLoadContacts().find((c) => c.nexoId.toLowerCase() === id.toLowerCase()) || {}).verified, id);
  const scan = async (text) => {
    writeCam(text);
    await B.page.evaluate(() => { const t = document.getElementById('perm-error-toast'); if (t) t.remove(); });
    if (!(await B.page.evaluate(() => !!document.querySelector('#e2e-banner .e2e-qr-scan')))) { await sn(B); }
    const t0 = Date.now();
    await click(B.page, '#e2e-banner .e2e-qr-scan');
    let toast = null;
    for (let i = 0; i < 60 && !toast; i++) { await sleep(250); toast = await B.page.evaluate(() => { const t = document.getElementById('perm-error-toast'); return t ? t.textContent : null; }); }
    const open = await B.page.evaluate(() => !!document.getElementById('qr-scan-overlay'));
    if (open) await click(B.page, '#qr-scan-overlay button');
    return { s: Math.round((Date.now() - t0) / 100) / 10, aviso: toast && toast.substring(0, 60), camara_cerrada: !open };
  };
  if (!shown) { console.log('QR ' + JSON.stringify(r)); fs.writeFileSync(path.join(__dirname, 'last_logs_qr.txt'), logs.join('\n')); process.exit(1); }
  const digits = shown.payload.split('|')[3];
  const wrong = shown.payload.replace(/\|\d{60}$/, '|' + digits.substring(0, 59) + ((Number(digits[59]) + 1) % 10));
  r.impostor = await scan(wrong);
  r.impostor.verificado = await verified(B, idA);
  r.otro_contacto = await scan(shown.payload.replace('|' + idA.toLowerCase() + '|', '|nx00000000|'));
  r.no_es_nexo = await scan('https://ejemplo.test/hola');
  r.correcto = await scan(shown.payload);
  r.correcto.verificado = await verified(B, idA);
  r.aviso_B = await B.page.evaluate(() => ((document.querySelector('#e2e-banner .e2e-text') || {}).textContent || '').substring(0, 40));
  r.A_sigue_sin_verificar = !(await verified(A, idB));
  r.errores_pagina = logs.filter((l) => /PAGEERROR/.test(l)).slice(0, 3);
  console.log('QR ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_qr.txt'), logs.join('\n'));
  await browser.close();
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
