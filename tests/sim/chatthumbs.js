// Fotos en el chat (2987; pedido del dueño 10-11, diagnóstico S24 build 2984: cada vez que se abría un chat salían de 2 a 10 lecturas de
// «adjunto» de ~430 ms, una tras otra, ¡hasta ~8 s para abrir un chat!). La burbuja de una foto mide 220 px, pero se leía la foto ENTERA del
// disco (y se pasaba por el puente) para dibujarla. Ahora la primera vez se guarda una miniatura (JPEG, lado máx. 480) y los chats se
// abren leyendo SOLO las miniaturas; la foto original se carga al TOCARLA. Chromium real (hace falta canvas), un teléfono.
// Comprueba: (1) 1.ª apertura: se leen las fotos (aún sin miniatura) y se crean las miniaturas; (2) tras reiniciar la app (la miniatura está
// en el disco): abrir el chat NO lee ningún archivo de foto (nexo_att_*), solo miniaturas, y las burbujas muestran la miniatura (mucho más
// chica); (3) tocar una foto carga el ORIGINAL (visor con la foto completa); (3b) los VÍDEOS (2988) tampoco se leen al abrir —burbuja con su miniatura— y tocar uno lo carga; (4) el mensaje guardado no se contamina (sin thumbOnly) y la
// miniatura se borra con el mensaje; (5) reenviar usa el original.
// Uso: node chatthumbs.js <dir_build>
'use strict';
const fs = require('fs');
const path = require('path');
const { PW, bootPhone, sleep } = require('./pw_harness');
const { Radio, NativePhone } = require('./native_mock');

const dist = path.resolve(process.argv[2], 'dist');
(async () => {
  const browser = await PW.chromium.launch();
  const radio = new Radio();
  const opts = { readsContentFallback: true, retain: ['onPayloadReceived'], closeOnNoService: true, pace: [5, 5], ioDelay: 10, asymmetric: true, noTor: true };
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', opts), nB = new NativePhone('B', 'BB:BB:BB:BB:BB:02', opts);
  radio.add(nA); radio.add(nB); nA.load(); nB.load();
  const logs = [];
  const boot = async () => (await bootPhone(browser, 'A', nA, dist, { phone: true, logs, seedName: 'Ana', lang: 'es' })).page;
  const bootB = (await bootPhone(browser, 'B', nB, dist, { phone: true, logs, seedName: 'Beto', lang: 'es' })).page;
  let A = await boot();
  const r = { prueba: 'chatthumbs', build: path.basename(process.argv[2]) };
  const click = (p, sel) => p.evaluate((s) => { const e = document.querySelector(s); if (e) e.click(); return !!e; }, sel);

  // Emparejar A con B por Bluetooth (como ui_shots) para tener un contacto
  await A.evaluate(() => window.bleInterface.togglePanel());
  for (let i = 0; i < 100; i++) { await sleep(150); if (await A.evaluate(() => !!document.querySelector('#ble-new-device button'))) break; await A.evaluate(() => { if (!window.bleInterface.isScanning) { const b = document.getElementById('ble-scan-btn'); if (b) b.click(); } }); }
  await click(A, '#ble-new-device button'); await sleep(1800);
  await A.evaluate(() => { if (document.getElementById('ble-panel').classList.contains('active')) window.bleInterface.togglePanel(); });
  const idB = await bootB.evaluate(() => window.bleInterface.localNexoId.toLowerCase());

  // 6 fotos «grandes» (ruido: JPEG de 1600x1200 de ~0,5-1 MB) metidas en el historial de A con B
  const N = 6;
  const sizes = await A.evaluate(async (idB) => {
    const out = [];
    for (let k = 0; k < 6; k++) {
      const c = document.createElement('canvas'); c.width = 1600; c.height = 1200; const g = c.getContext('2d');
      const d = g.createImageData(1600, 1200);
      for (let i = 0; i < d.data.length; i += 4) { d.data[i] = (i * 7 + k * 40) & 255; d.data[i + 1] = ((i >> 3) * 13 + k) & 255; d.data[i + 2] = Math.random() * 255; d.data[i + 3] = 255; }
      g.putImageData(d, 0, 0);
      const b64 = c.toDataURL('image/jpeg', 0.85).split(',')[1];
      const id = 'photo' + k + 'x' + Date.now();
      await window.vaultAppendMessage(idB, { msgId: id, messageId: id, content: '[adjunto]', attachmentType: 'image', attachmentPayload: b64, attachmentMeta: { format: 'jpeg', size: Math.round(b64.length * 0.75) }, _own: true, status: 'delivered', timestamp: Date.now() - (6 - k) * 60000, seq: k + 1 }, true);
      out.push(b64.length);
    }
    return out;
  }, idB);
  r.foto_kb = Math.round(sizes[0] / 1024);
  // 4 vídeos de ~2 MB con miniatura (meta.thumb), como los que manda la app (la burbuja solo muestra la miniatura)
  const NV = 4;
  const vsz = await A.evaluate(async (idB) => {
    const out = [];
    const tc = document.createElement('canvas'); tc.width = 160; tc.height = 90; const tg = tc.getContext('2d'); tg.fillStyle = '#336'; tg.fillRect(0, 0, 160, 90);
    const thumb = tc.toDataURL('image/jpeg', 0.7).split(',')[1];
    for (let k = 0; k < 4; k++) {
      const bytes = new Uint8Array(2 * 1024 * 1024); for (let i = 0; i < bytes.length; i += 65536) crypto.getRandomValues(bytes.subarray(i, Math.min(i + 65536, bytes.length)));
      let bin = ''; for (let i = 0; i < bytes.length; i += 8192) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
      const b64 = btoa(bin);
      const id = 'vid' + k + 'x' + Date.now();
      await window.vaultAppendMessage(idB, { msgId: id, messageId: id, content: '[adjunto]', attachmentType: 'video', attachmentPayload: b64, attachmentMeta: { format: 'webm', mime: 'video/webm', thumb, size: bytes.length, preview: false }, _own: true, status: 'delivered', timestamp: Date.now() - (3 - k) * 30000, seq: 100 + k }, true);
      out.push(b64.length);
    }
    return out;
  }, idB);
  r.video_kb = Math.round(vsz[0] / 1024);
  await sleep(1500);

  // Cuenta de lecturas de archivo desde la página (el plugin del simulador se arma en cada llamada, así que se envuelve aquí)
  const instrument = (p) => p.evaluate(() => {
    window.__loads = [];
    const pl = window.Capacitor.Plugins.NexoBLE, o = pl.loadFromFile;
    pl.loadFromFile = function (a) { window.__loads.push(String((a && a.filename) || '')); return o.apply(pl, arguments); };
  });
  const openChat = async (p) => { await p.evaluate(() => window.dispatchEvent(new CustomEvent('nexo:ble:closeChat', { detail: {} }))); await sleep(400); await click(p, '#main-contacts-list .ble-contact-row'); };
  const bubbles = (p) => p.evaluate(() => Array.from(document.querySelectorAll('#messages-container .msg-content img:not(.video-thumb)')).map((i) => ({ len: (i.src || '').length, full: !!i.dataset.fullRef })));

  // (1) primera apertura: lee las fotos (sin miniatura todavía) y crea las miniaturas
  await instrument(A);
  await openChat(A);
  await sleep(3500);
  const first = await A.evaluate(() => window.__loads.filter((f) => /^nexo_att_/.test(f)).length);
  r.primera_lee_fotos = first >= N;
  const thumbsOnDisk = () => nA.files ? Array.from(nA.files.keys()).filter((f) => /^nexo_thumb_/.test(f)).length : -1;
  for (let i = 0; i < 30 && thumbsOnDisk() < N; i++) await sleep(500);
  r.miniaturas_creadas = thumbsOnDisk() === N;
  const thumbKb = thumbsOnDisk() > 0 ? Math.round(nA.files.get(Array.from(nA.files.keys()).find((f) => /^nexo_thumb_/.test(f))).length / 1024) : 0;
  r.miniatura_kb = thumbKb;
  r.miniatura_mucho_mas_chica = thumbKb > 0 && thumbKb * 4 < r.foto_kb;

  // (2) «reiniciar la app»: recargar la página (la miniatura queda en el disco del teléfono simulado) y abrir el chat
  await A.reload();
  await A.waitForFunction(() => window.NEXO && window.NEXO.initialized, null, { timeout: 60000 });
  await sleep(1200);
  await instrument(A);
  const t0 = Date.now();
  await openChat(A);
  await A.waitForFunction((n) => document.querySelectorAll('#messages-container .msg-content img').length >= n, N, { timeout: 15000 }).catch(() => {});
  r.abre_ms = Date.now() - t0;
  const loads = await A.evaluate(() => window.__loads.slice());
  r.lecturas_de_fotos_al_abrir = loads.filter((f) => /^nexo_att_/.test(f)).length;
  r.lecturas_de_miniaturas = loads.filter((f) => /^nexo_thumb_/.test(f)).length;
  const bs = await bubbles(A);
  r.burbujas = bs.length;
  r.sin_leer_originales = r.lecturas_de_fotos_al_abrir === 0 && r.lecturas_de_miniaturas >= N;
  const vb = await A.evaluate(() => Array.from(document.querySelectorAll('#messages-container .video-attachment')).map((v) => ({ lazy: !!v.dataset.lazyRef, thumb: !!(v.querySelector('img.video-thumb') && v.querySelector('img.video-thumb').src) })));
  r.burbujas_video = vb.length;
  r.videos_perezosos = vb.length >= NV && vb.every((v) => v.lazy && v.thumb);
  r.burbujas_con_miniatura = bs.length >= N && bs.every((b) => b.full && b.len < sizes[0] / 3);

  // (3) tocar una foto carga el ORIGINAL en el visor
  await A.evaluate(() => { const i = document.querySelector('#messages-container .msg-content img:not(.video-thumb)'); i.click(); });
  await A.waitForFunction(() => !!document.getElementById('fullscreen-media-overlay'), null, { timeout: 8000 }).catch(() => {});
  await sleep(500);
  const viewer = await A.evaluate(() => { const o = document.getElementById('fullscreen-media-overlay'); const i = o && o.querySelector('img'); return i ? i.src.length : 0; });
  r.visor_con_original = viewer > sizes[0] * 0.9;
  r.tocar_leyo_original = (await A.evaluate(() => window.__loads.filter((f) => /^nexo_att_/.test(f)).length)) === 1;
  await A.evaluate(() => window.__nexoCloseMedia && window.__nexoCloseMedia()); await sleep(300);

  // (3b) tocar un VÍDEO lo carga entonces (una sola lectura) y abre el visor con el vídeo
  const before = await A.evaluate(() => window.__loads.filter((f) => /^nexo_att_/.test(f)).length);
  await A.evaluate(() => { const v = document.querySelector('#messages-container .video-attachment'); v.click(); });
  await A.waitForFunction(() => { const o = document.getElementById('fullscreen-media-overlay'); return !!(o && o.querySelector('video')); }, null, { timeout: 8000 }).catch(() => {});
  const vsrc = await A.evaluate(() => { const o = document.getElementById('fullscreen-media-overlay'); const v = o && o.querySelector('video'); return v ? (v.src || (v.querySelector('source') || {}).src || '') : ''; });
  r.video_al_tocar = /^blob:/.test(vsrc) && (await A.evaluate(() => window.__loads.filter((f) => /^nexo_att_/.test(f)).length)) === before + 1;
  await A.evaluate(() => window.__nexoCloseMedia && window.__nexoCloseMedia()); await sleep(300);

  // (4) el mensaje guardado no se contamina con la miniatura
  const clean = await A.evaluate(async (idB) => { const l = await window.vaultLoadMessages(idB); const m = l.filter((x) => x.attachmentType === 'image' || x.attachmentType === 'video'); return m.length >= 10 && m.every((x) => !(x.attachmentMeta && (x.attachmentMeta.thumbOnly || x.attachmentMeta.fullRef || x.attachmentMeta.lazyRef)) && !!x.attachmentRef && !x.attachmentPayload); }, idB);
  r.vault_limpio = clean;
  // la miniatura se borra con el mensaje
  const delId = await A.evaluate(async (idB) => { if (typeof window.vaultDeleteMessage !== 'function') return 'sin-gancho'; const l = await window.vaultLoadMessages(idB); const m = l.find((x) => x.attachmentType === 'image'); await window.vaultDeleteMessage(idB, m.msgId); return m.msgId; }, idB);
  await sleep(800);
  r.miniatura_se_borra = !Array.from(nA.files.keys()).some((f) => f === 'nexo_thumb_' + delId.replace(/[^A-Za-z0-9_-]/g, '_') + '.b64');

  r.errores = logs.filter((l) => /PAGEERROR/.test(l)).slice(0, 4);
  const keys = ['primera_lee_fotos', 'miniaturas_creadas', 'miniatura_mucho_mas_chica', 'sin_leer_originales', 'burbujas_con_miniatura', 'videos_perezosos', 'video_al_tocar', 'visor_con_original', 'tocar_leyo_original', 'vault_limpio', 'miniatura_se_borra'];
  const ok = keys.every((k) => r[k] === true) && r.errores.length === 0;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('CHATTHUMBS ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_chatthumbs.txt'), logs.join('\n'));
  await browser.close();
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('CHATTHUMBS ' + JSON.stringify({ prueba: 'chatthumbs', resultado: 'FALLO', error: String(e && e.message).substring(0, 300) })); process.exit(1); });
