// Prueba de esfuerzo y rendimiento en Chromium real con la CPU frenada (como un teléfono de gama media).
// Tres teléfonos precargados (A con B y C; historial grande en B). Fases medidas por separado:
// arranque, reposo (con un contacto ausente), ráfaga de textos, multi-chat, fotos + textos, vídeo y
// abrir un chat con historial grande. Mide lag del hilo de la interfaz, tareas largas, CPU y entregas.
// Uso: node stress.js <dir_build> [--cpu=4] [--hist=400] [--idle=60] [--video-wait=200]
'use strict';
const fs = require('fs');
const path = require('path');
const { Radio, NativePhone } = require('./native_mock');
const { PW, bootPhone, phaseStart, phaseEnd, click, sleep } = require('./pw_harness');

const buildDir = path.resolve(process.argv[2]);
const dist = path.join(buildDir, 'dist');
const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith('--' + k)); if (!a) return d; const v = a.split('=')[1]; return v === undefined ? true : Number(v); };
const CPU = arg('cpu', 4), HIST = arg('hist', 400), IDLE = arg('idle', 60), VIDEO_WAIT = arg('video-wait', 200);
const opts = { readsContentFallback: true, retain: ['onPayloadReceived'], closeOnNoService: true, pace: [15, 15], ioDelay: 25, asymmetric: true, supervisionMs: 3000 };
const ID = { A: 'NXA0000001', B: 'NXB0000002', C: 'NXC0000003' };
const ADDR = { A: 'AA:AA:AA:AA:AA:01', B: 'BB:BB:BB:BB:BB:02', C: 'CC:CC:CC:CC:CC:03' };
const logs = [];

function contact(n) { const id = ID[n].toLowerCase(); return { nexoId: id, deviceUUID: id, name: n, deviceId: ADDR[n], addedAt: Date.now() - 86400000, lastSeen: 0, online: false, unreadCount: 0, lastMessage: '' }; }
function preload(native, me, others, history) {
  native.files.set('nexo_advertising_id.json', JSON.stringify({ nexoId: ID[me], createdAt: Date.now() - 86400000 }));
  native.files.set('nexo_vault_contacts.json', JSON.stringify({ contacts: others.map(contact), savedAt: Date.now() }));
  if (history) native.files.set('nexo_vault_msgs_v2_' + history.with.toLowerCase() + '.json', JSON.stringify({ messages: history.messages, savedAt: Date.now() }));
}

(async () => {
  const browser = await PW.chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const res = { build: path.basename(buildDir), cpu_frenada: CPU + 'x', historial_B: HIST };
  // Medios reales: foto JPEG (canvas) y clip de vídeo de 5 s (MediaRecorder), generados en Chromium
  const gen = await browser.newPage();
  await gen.goto('about:blank');
  const media = await gen.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 480; c.height = 360; const ctx = c.getContext('2d');
    for (let i = 0; i < 4000; i++) { ctx.fillStyle = `hsl(${i % 360},60%,${30 + (i % 40)}%)`; ctx.fillRect(Math.random() * 480, Math.random() * 360, 12, 12); }
    const jpeg = c.toDataURL('image/jpeg', 0.7).split(',')[1];
    const tc = document.createElement('canvas'); tc.width = 320; tc.height = 180; tc.getContext('2d').drawImage(c, 0, 0, 320, 180);
    const thumb = tc.toDataURL('image/jpeg', 0.6).split(',')[1];
    const v = document.createElement('canvas'); v.width = 1280; v.height = 720; const vx = v.getContext('2d');
    const s = v.captureStream(30); const ac = new AudioContext(); const o = ac.createOscillator(); const d = ac.createMediaStreamDestination(); o.connect(d); o.start(); s.addTrack(d.stream.getAudioTracks()[0]);
    const mime = ['video/mp4', 'video/webm;codecs=vp8,opus'].find((m) => MediaRecorder.isTypeSupported(m));
    const r = new MediaRecorder(s, { mimeType: mime, videoBitsPerSecond: 1500000 }); const parts = []; r.ondataavailable = (e) => parts.push(e.data);
    let f = 0; const iv = setInterval(() => { vx.fillStyle = `hsl(${(f * 7) % 360},70%,45%)`; vx.fillRect(0, 0, 1280, 720); vx.fillStyle = '#fff'; vx.font = '140px sans-serif'; vx.fillText('NEXO ' + f++, 120, 420); for (let i = 0; i < 300; i++) vx.fillRect(Math.random() * 1280, Math.random() * 720, 10, 10); }, 33);
    r.start(100); await new Promise((x) => setTimeout(x, 5000)); clearInterval(iv); await new Promise((x) => { r.onstop = x; r.stop(); });
    const blob = new Blob(parts, { type: mime.split(';')[0] });
    const b64 = await new Promise((x) => { const fr = new FileReader(); fr.onload = () => x(fr.result.split(',')[1]); fr.readAsDataURL(blob); });
    return { jpeg, thumb, video: b64, videoMime: mime.split(';')[0] };
  });
  await gen.close();
  res.medios = { foto_KB: Math.round(media.jpeg.length * 3 / 4 / 1024), video_KB: Math.round(media.video.length * 3 / 4 / 1024) };

  // Historial grande de B con A: textos, fotos y vídeos (como lo tendría un usuario real)
  const now = Date.now(), msgs = [];
  for (let i = 0; i < HIST; i++) {
    const own = i % 3 === 0, id = 'h' + i, ts = now - (HIST - i) * 60000;
    const m = { msgId: id, messageId: id, content: 'Mensaje de historial número ' + i + ' con algo de texto para que pese como uno real', senderNexoId: own ? ID.B.toLowerCase() : ID.A.toLowerCase(), timestamp: ts, seq: i + 1, status: own ? 'read' : 'delivered', _own: own };
    if (i % 50 === 25) Object.assign(m, { content: '[adjunto]', attachmentType: 'image', attachmentPayload: media.jpeg, attachmentMeta: { format: 'jpeg', mime: 'image/jpeg' } });
    if (i % 200 === 100) Object.assign(m, { content: '[adjunto]', attachmentType: 'video', attachmentPayload: media.video, attachmentMeta: { format: media.videoMime.indexOf('mp4') >= 0 ? 'mp4' : 'webm', mime: media.videoMime, thumb: media.thumb } });
    msgs.push(m);
  }
  const radio = new Radio();
  const nA = new NativePhone('A', ADDR.A, opts), nB = new NativePhone('B', ADDR.B, opts), nC = new NativePhone('C', ADDR.C, opts);
  preload(nA, 'A', ['B', 'C']); preload(nB, 'B', ['A'], { with: ID.A, messages: msgs }); preload(nC, 'C', ['A']);
  [nA, nB, nC].forEach((n) => { radio.add(n); n.load(); });
  const bo = { cpuThrottle: CPU, logs };
  let A, B, C;
  let ph = Date.now();
  [A, B, C] = await Promise.all([bootPhone(browser, 'A', nA, dist, bo), bootPhone(browser, 'B', nB, dist, bo), bootPhone(browser, 'C', nC, dist, bo)]);
  res.arranque_ms = { A: A.bootMs, B: B.bootMs, C: C.bootMs };
  const all = [A, B, C];
  const openChat = async (p, name) => {
    const t0 = Date.now();
    const ok = await p.page.evaluate((name) => { const r = Array.from(document.querySelectorAll('#main-contacts-list .ble-contact-row')).find((x) => (x.querySelector('.ble-contact-name') || {}).textContent === name); if (r) r.dispatchEvent(new MouseEvent('click', { bubbles: true })); return !!r; }, name);
    // Esperar a que el chat esté dibujado y la página libre (dos fotogramas)
    await p.page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    await sleep(200);
    return ok ? Date.now() - t0 : -1;
  };
  const closeChat = (p) => p.page.evaluate(() => { const b = document.getElementById('chat-back-btn'); if (b) b.dispatchEvent(new MouseEvent('click', { bubbles: true })); window.dispatchEvent(new CustomEvent('nexo:ble:closeChat', { detail: {} })); });
  // Enviar un texto y medir cuánto tarda la burbuja propia en aparecer (pulsar → pintado)
  const sendText = (p, t) => p.page.evaluate((t) => new Promise((resolve) => {
    const t0 = performance.now();
    const i = document.getElementById('message-input'); i.value = t; i.dispatchEvent(new Event('input', { bubbles: true }));
    document.getElementById('send-btn').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const check = () => { const ok = Array.from(document.querySelectorAll('#messages-container .message.own .msg-content')).some((e) => e.textContent === t); if (ok) requestAnimationFrame(() => resolve(Math.round(performance.now() - t0))); else if (performance.now() - t0 > 5000) resolve(-1); else setTimeout(check, 5); };
    check();
  }), t);
  const count = (p, prefix) => p.page.evaluate((prefix) => Array.from(document.querySelectorAll('#messages-container .message .msg-content')).filter((e) => e.textContent.indexOf(prefix) === 0).length, prefix);
  const vaultCount = (p, withId, prefix) => p.page.evaluate(async ([w, prefix]) => (await window.vaultLoadMessages(w.toLowerCase())).filter((m) => String(m.content || '').indexOf(prefix) === 0).length, [withId, prefix]);
  const run = async (name, fn) => { try { await fn(); } catch (e) { res[name] = { error: e.message.substring(0, 200) }; } };

  // Esperar a que se conecten solos (escaneo al arrancar)
  await sleep(12000);

  await run('reposo', async () => {
    const st = await phaseStart(all); const scans0 = [nA, nB, nC].map((n) => n.stats.scans || 0);
    await sleep(IDLE * 1000 / 2);
    nC.setOffline(true); // un contacto se va: re-búsquedas
    await sleep(IDLE * 1000 / 2);
    res.reposo = await phaseEnd(all, st);
    res.reposo.escaneos = { A: (nA.stats.scans || 0) - scans0[0], B: (nB.stats.scans || 0) - scans0[1], C: (nC.stats.scans || 0) - scans0[2] };
    nC.setOffline(false); await sleep(8000);
  });

  await run('rafaga_textos', async () => {
    await openChat(A, 'B'); await openChat(B, 'A');
    const st = await phaseStart([A, B]); const lat = [];
    for (let i = 0; i < 40; i++) { lat.push(await sendText(A, 'rafaga ' + i)); await sleep(150); }
    let got = 0; const t0 = Date.now();
    for (let i = 0; i < 120 && got < 40; i++) { await sleep(500); got = await vaultCount(B, ID.A, 'rafaga '); }
    res.rafaga_textos = await phaseEnd([A, B], st);
    lat.sort((a, b) => a - b);
    res.rafaga_textos.burbuja_propia_ms = { p50: lat[20], p95: lat[38], max: lat[39] };
    res.rafaga_textos.entregados = got + '/40'; res.rafaga_textos.todos_en_B_s = Math.round((Date.now() - t0) / 100) / 10;
  });

  await run('multichat', async () => {
    await openChat(C, 'A');
    const st = await phaseStart([A, B, C]); const sw = [];
    const sendLoop = async (p, prefix, n, gap) => { for (let i = 0; i < n; i++) { await sendText(p, prefix + i); await sleep(gap); } };
    const loops = Promise.all([sendLoop(B, 'deB ', 20, 200), sendLoop(C, 'deC ', 20, 250)]);
    for (let k = 0; k < 3; k++) { await sleep(1200); await closeChat(A); sw.push(await openChat(A, 'C')); await sleep(1200); await closeChat(A); sw.push(await openChat(A, 'B')); }
    await loops;
    let gB = 0, gC = 0;
    for (let i = 0; i < 60 && (gB < 20 || gC < 20); i++) { await sleep(500); gB = await vaultCount(A, ID.B, 'deB '); gC = await vaultCount(A, ID.C, 'deC '); }
    res.multichat = await phaseEnd([A, B, C], st);
    res.multichat.cambio_de_chat_ms = sw; res.multichat.recibidos_en_A = { deB: gB + '/20', deC: gC + '/20' };
  });

  await run('fotos_y_textos', async () => {
    await closeChat(A); await openChat(A, 'B');
    const st = await phaseStart([A, B]); const t0 = Date.now(); const lat = [];
    for (let k = 0; k < 2; k++) {
      await click(A.page, '.attach-menu-item[data-type="gallery"]'); await sleep(500);
      const inputs = await A.page.$$('input[type=file]');
      await inputs[inputs.length - 1].setInputFiles({ name: 'foto' + k + '.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(media.jpeg, 'base64') });
      await sleep(400);
      for (let i = 0; i < 3; i++) { lat.push(await sendText(A, 'durante foto ' + k + '-' + i)); await sleep(700); }
    }
    let imgs = 0, txt = 0;
    for (let i = 0; i < 180 && (imgs < 2 || txt < 6); i++) {
      await sleep(500);
      imgs = await B.page.evaluate(() => document.querySelectorAll('#messages-container .message img:not(.video-thumb)').length);
      txt = await count(B, 'durante foto');
    }
    res.fotos_y_textos = await phaseEnd([A, B], st);
    res.fotos_y_textos.fotos_en_B = imgs; res.fotos_y_textos.textos_en_B = txt + '/6';
    res.fotos_y_textos.total_s = Math.round((Date.now() - t0) / 100) / 10; res.fotos_y_textos.burbuja_propia_ms = lat;
  });

  await run('video', async () => {
    const st = await phaseStart([A, B]); const t0 = Date.now();
    await click(A.page, '.attach-menu-item[data-type="gallery"]'); await sleep(500);
    const inputs = await A.page.$$('input[type=file]');
    await inputs[inputs.length - 1].setInputFiles({ name: 'clip.mp4', mimeType: media.videoMime, buffer: Buffer.from(media.video, 'base64') });
    const lat = [];
    await sleep(1000); lat.push(await sendText(A, 'texto durante video 1'));
    let first = 0, hd = 0;
    for (let i = 0; i < VIDEO_WAIT && !hd; i++) {
      await sleep(1000);
      if (i === 8) lat.push(await sendText(A, 'texto durante video 2'));
      const st2 = await B.page.evaluate(async (w) => { const v = (await window.vaultLoadMessages(w)).filter((m) => m.attachmentType === 'video' && m.timestamp > Date.now() - 3600000); return { n: v.length, hd: v.some((m) => m.attachmentMeta && m.attachmentMeta.hd) }; }, ID.A.toLowerCase());
      if (st2.n && !first) first = Math.round((Date.now() - t0) / 1000);
      if (st2.hd) hd = Math.round((Date.now() - t0) / 1000);
      if (first && !st2.hd && i > first + 5 && !(await A.page.evaluate(() => document.body.innerHTML.indexOf('HD') >= 0))) break; // build sin HD
    }
    res.video = await phaseEnd([A, B], st);
    res.video.primer_video_en_B_s = first || 'NO'; res.video.HD_en_B_s = hd || 'sin HD'; res.video.burbuja_texto_ms = lat;
  });

  await run('abrir_historial', async () => {
    await closeChat(B); await sleep(1500);
    const st = await phaseStart([B]);
    const t1 = await openChat(B, 'A'); await sleep(1500);
    const n1 = await B.page.evaluate(() => document.querySelectorAll('#messages-container .message').length);
    await closeChat(B); await sleep(1500);
    const t2 = await openChat(B, 'A'); await sleep(1500);
    res.abrir_historial = await phaseEnd([B], st);
    res.abrir_historial.abrir_1_ms = t1; res.abrir_historial.abrir_2_ms = t2; res.abrir_historial.burbujas = n1;
  });

  res.errores_pagina = logs.filter((l) => /PAGEERROR/.test(l)).slice(0, 5);
  console.log('STRESS ' + JSON.stringify(res));
  fs.writeFileSync(process.env.SIM_LOG || path.join(__dirname, 'last_logs_stress.txt'), logs.join('\n'));
  await browser.close();
  process.exit(0);
})().catch((e) => { console.error('FALLO:', e.stack); fs.writeFileSync(path.join(__dirname, 'last_logs_stress.txt'), logs.join('\n')); process.exit(1); });
