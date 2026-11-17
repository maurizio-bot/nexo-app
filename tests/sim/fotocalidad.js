// 3170 (usuarios 17-11: «las fotos se ven mal»): tamaño y calidad de la foto que RECIBE el otro, por cada camino. Hasta la 3169 una foto
// salía a 800 px de lado mayor y JPEG 65 % salvo con Wi-Fi Direct o la misma red Wi-Fi (1600 px, 85 %): por internet, por Bluetooth y en
// los grupos, 800 px. Ahora 1600 px y 82 % (como WhatsApp) si puede ir por un camino rápido (Wi-Fi Direct, misma red Wi-Fi o internet:
// en línea o al buzón de archivos); si el ÚNICO camino es Bluetooth (~12-16 KB/s), 1280 px y 75 %. En un grupo: si va al buzón de
// archivos, como internet; si no, manda el peor miembro.
// Chromium real (hace falta lienzo para comprimir y decodificar). A elige en la GALERÍA una foto de 4000x3000 (≤ 5 MB) y la manda; el
// otro la recibe, se DECODIFICA ahí (Image) y se lee su calidad JPEG de la tabla de cuantización (DQT). Escenarios:
//  bluetooth (solo Bluetooth, sin Wi-Fi ni relés) → 1280 px, ~75 %;   wifi_local (misma red, sin relés) → 1600 px, ~82 %;
//  internet (redes distintas, sin Bluetooth, relés del simulador) → 1600x1200, ~82 %;   wifi_direct (sin red ni relés) → 1600 px, ~82 %;
//  grupo_peor_bluetooth (B por la misma red, C solo por Bluetooth, sin relés) → 1280 px en los dos;
//  grupo_internet (con relés: el grupo manda por el buzón de archivos) → 1600 px;
//  internet_B_ausente (B apagado, A con internet: al buzón de archivos) → 1600 px (medida en la copia de A, la que sube).
// Además: la miniatura del chat (2987) se sigue haciendo con la foto nueva (lado ≤ 480 px) y la foto respeta el tope de 5 MB.
// Uso: node fotocalidad.js <dir_build>   (imprime FOTOCALIDAD {json} con "resultado":"OK"|"FALLO"; sale 0/1)
'use strict';
const fs = require('fs');
const path = require('path');
const { PW, bootPhone, sleep } = require('./pw_harness');
const { Radio, NativePhone } = require('./native_mock');
const { NostrRelay } = require('./nostr_relay');

const dist = path.resolve(process.argv[2], 'dist');
const logs = [];
const r = { prueba: 'fotocalidad', build: path.basename(process.argv[2]) };
const fin = (ok, extra) => {
  Object.assign(r, extra || {});
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('FOTOCALIDAD ' + JSON.stringify(r));
  try { fs.writeFileSync(path.join(__dirname, 'last_logs_fotocalidad.txt'), logs.join('\n')); } catch (e) {}
};
const base = { readsContentFallback: true, retain: ['onPayloadReceived', 'onLanMessage', 'onLanUp', 'onLanDown'], closeOnNoService: true, pace: [5, 5], ioDelay: 10, asymmetric: true, noTor: true, noL2: true };
const SEED = { A: 'Ana', B: 'Beto', C: 'Carla' };
const MAC = { A: 'AA:AA:AA:AA:AA:01', B: 'BB:BB:BB:BB:BB:02', C: 'CC:CC:CC:CC:CC:03' };
const waitFor = async (fn, ms) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return Math.round((Date.now() - t0) / 100) / 10; await sleep(250); } return null; };

// ---- JPEG: tamaño (SOF) y calidad estimada (tabla de luminancia DQT frente a la de IJG escalada; libjpeg/Skia la usan así) ----
const STD_LUM = [16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55, 14, 13, 16, 24, 40, 57, 69, 56, 14, 17, 22, 29, 51, 87, 80, 62,
  18, 22, 37, 56, 68, 109, 103, 77, 24, 35, 55, 64, 81, 104, 113, 92, 49, 64, 78, 87, 103, 121, 120, 101, 72, 92, 95, 98, 112, 100, 103, 99];
const lumSum = (q) => { const s = q < 50 ? Math.floor(5000 / q) : 200 - q * 2; return STD_LUM.reduce((a, v) => a + Math.min(255, Math.max(1, Math.floor((v * s + 50) / 100))), 0); };
function jpegInfo(b64) {
  const b = Buffer.from(b64, 'base64');
  if (b[0] !== 0xFF || b[1] !== 0xD8) return null;
  let i = 2, w = 0, h = 0, lum = null;
  while (i + 4 <= b.length) {
    if (b[i] !== 0xFF) { i++; continue; }
    const mk = b[i + 1], len = b.readUInt16BE(i + 2);
    if (mk === 0xDB) {
      let j = i + 4;
      while (j < i + 2 + len) { const pq = b[j] >> 4, tq = b[j] & 15; const n = pq ? 128 : 64; if (tq === 0 && !lum) { lum = []; for (let k = 0; k < 64; k++) lum.push(pq ? b.readUInt16BE(j + 1 + k * 2) : b[j + 1 + k]); } j += 1 + n; }
    } else if (mk >= 0xC0 && mk <= 0xC2) { h = b.readUInt16BE(i + 5); w = b.readUInt16BE(i + 7); }
    if (mk === 0xDA) break;
    i += 2 + len;
  }
  let q = null;
  if (lum) { const s = lum.reduce((a, v) => a + v, 0); let best = 1e9; for (let k = 1; k <= 100; k++) { const d = Math.abs(lumSum(k) - s); if (d < best) { best = d; q = k; } } }
  return { w, h, q, kb: Math.round(b.length / 1024) };
}

// ---- teléfonos ----
async function phone(browser, name, extra, relays) {
  const native = new NativePhone(name, MAC[name], Object.assign({}, base, extra || {}));
  // los relés del simulador (o ninguno: «sin internet») se fijan antes de que arranque la app
  const b2 = { newPage: async (o) => { const p = await browser.newPage(o); await p.addInitScript((rl) => { window.NEXO_NET_RELAYS = rl; }, relays || []); return p; } };
  return { name, native, boot: async () => (await bootPhone(b2, name, native, dist, { phone: true, logs, seedName: SEED[name], lang: 'es' })).page };
}
const idOf = (pg) => pg.evaluate(() => window.bleInterface.localNexoId.toLowerCase());
async function pair(pg, names) {
  await pg.evaluate(() => window.bleInterface.togglePanel());
  let ok = false;
  for (let i = 0; i < 200 && !ok; i++) {
    await sleep(150);
    ok = await pg.evaluate((ns) => {
      const row = Array.from(document.querySelectorAll('#ble-new-device > div')).find((d) => ns.indexOf(((d.querySelector('span') || {}).textContent || '').trim()) >= 0);
      const b = row && row.querySelector('button'); if (b) { b.click(); return true; }
      if (!window.bleInterface.isScanning) { const s = document.getElementById('ble-scan-btn'); if (s) s.click(); }
      return false;
    }, names);
  }
  await sleep(2000);
  await pg.evaluate(() => { if (document.getElementById('ble-panel').classList.contains('active')) window.bleInterface.togglePanel(); });
  return ok;
}
const openChat = async (pg, id) => { await pg.evaluate((x) => window.bleInterface.openChat(x).catch(() => {}), id); await sleep(700); };
const sendText = (pg, t) => pg.evaluate((s) => { const i = document.getElementById('message-input'); i.value = s; i.dispatchEvent(new Event('input', { bubbles: true })); document.getElementById('send-btn').click(); }, t);
// Galería: una foto de W x H (JPEG ≤ 5 MB) elegida y mandada con «Enviar (1)» en la revisión
function sendGalleryPhoto(pg, W, H) {
  return pg.evaluate(async ([W, H]) => {
    const c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d');
    const gr = g.createLinearGradient(0, 0, W, H); gr.addColorStop(0, '#2a6f97'); gr.addColorStop(0.5, '#f4a261'); gr.addColorStop(1, '#264653');
    g.fillStyle = gr; g.fillRect(0, 0, W, H);
    let s = 7; const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    for (let i = 0; i < 1500; i++) { g.fillStyle = 'hsla(' + Math.floor(rnd() * 360) + ',60%,' + Math.floor(30 + rnd() * 50) + '%,0.55)'; g.beginPath(); g.arc(rnd() * W, rnd() * H, 8 + rnd() * 160, 0, 7); g.fill(); }
    g.fillStyle = '#fff'; g.font = 'bold 220px sans-serif'; g.fillText('NEXO ' + W + 'x' + H, W * 0.1, H * 0.5);
    const d = g.getImageData(0, 0, W, H), px = d.data; for (let i = 0; i < px.length; i += 4) { const n = (rnd() - 0.5) * 18; px[i] += n; px[i + 1] += n; px[i + 2] += n; }
    g.putImageData(d, 0, 0);
    let blob = null; for (const q of [0.9, 0.8, 0.7]) { blob = await new Promise((res) => c.toBlob(res, 'image/jpeg', q)); if (blob.size <= 5 * 1024 * 1024) break; }
    const file = new File([blob], 'IMG_' + W + 'x' + H + '.jpg', { type: 'image/jpeg' });
    const before = new Set(document.querySelectorAll('input[type=file]'));
    document.querySelector('.attach-menu-item[data-type="gallery"]').click();
    let inp = null; for (let i = 0; i < 60 && !inp; i++) { await new Promise((r) => setTimeout(r, 50)); inp = Array.from(document.querySelectorAll('input[type=file]')).find((x) => !before.has(x)) || null; }
    if (!inp) return { error: 'sin selector' };
    const dt = new DataTransfer(); dt.items.add(file); inp.files = dt.files; inp.dispatchEvent(new Event('change'));
    let btn = null; for (let i = 0; i < 60 && !btn; i++) { await new Promise((r) => setTimeout(r, 50)); btn = document.querySelector('#nexo-gallery-review #nexo-grev-send'); }
    if (!btn) return { error: 'sin revisión' };
    btn.click();
    return { kb: Math.round(blob.size / 1024) };
  }, [W, H]);
}
// La última foto recibida en ese chat: su contenido (del mensaje o del archivo del teléfono)
async function lastPhoto(pg, native, chat) {
  const m = await pg.evaluate(async (c) => {
    const ms = (await window.vaultLoadMessages(c)) || [];
    const x = ms.filter((y) => y.attachmentType === 'image' && !y._own && !y.deleted).pop();
    if (!x) return null;
    const p = x.attachmentPayload;
    return { id: x.messageId || x.msgId, b64: typeof p === 'string' && p.length > 200 ? p : null, ref: x.attachmentRef || null };
  }, chat);
  if (!m) return null;
  const b64 = m.b64 || (m.ref && native.files.get(m.ref)) || null;
  return b64 ? { id: m.id, b64 } : null;
}
// Mide lo que RECIBIÓ el otro: decodificado ahí (Image) + calidad de su tabla DQT
async function measure(pg, native, chat, ms) {
  let got = null, t0 = Date.now();
  const s = await waitFor(async () => !!(got = await lastPhoto(pg, native, chat)), ms);
  if (!got) return { llega: false };
  const dec = await pg.evaluate((b) => new Promise((res) => { const im = new Image(); im.onload = () => res({ w: im.naturalWidth, h: im.naturalHeight }); im.onerror = () => res(null); im.src = 'data:image/jpeg;base64,' + b; }), got.b64);
  const info = jpegInfo(got.b64) || {};
  return { llega: true, s: s !== null ? s : Math.round((Date.now() - t0) / 100) / 10, ancho: dec && dec.w, alto: dec && dec.h, lado_mayor: dec ? Math.max(dec.w, dec.h) : 0, calidad: info.q, kb: info.kb, sof: info.w + 'x' + info.h, id: got.id };
}
// La miniatura del chat (2987) con la foto nueva: abrir el chat la crea (lado ≤ 480 px)
async function thumbOk(pg, native, chat, msgId) {
  await openChat(pg, chat);
  const name = 'nexo_thumb_' + String(msgId).replace(/[^A-Za-z0-9_-]/g, '_') + '.b64';
  await waitFor(() => native.files.has(name), 10000);
  const th = native.files.get(name);
  if (!th) return false;
  const d = await pg.evaluate((b) => new Promise((res) => { const im = new Image(); im.onload = () => res(Math.max(im.naturalWidth, im.naturalHeight)); im.onerror = () => res(0); im.src = 'data:image/jpeg;base64,' + b; }), th);
  return d > 0 && d <= 480;
}
const linkOf = (pg, id) => pg.evaluate((x) => window.bleInterface.linkOf(x), id);
// Por dónde salió de verdad (registros de A): Wi-Fi Direct, buzón de archivos (relés) o el enlace del chat
const rutaDe = (id, camino) => !id ? camino : logs.some((l) => l.indexOf('[A] [WIFI-DIRECT] Enviando ' + id) >= 0) ? 'wifi-direct'
  : logs.some((l) => l.indexOf('[A] [BLOB] ' + id) >= 0 || l.indexOf('[A] [BLOB] grupo ' + id) >= 0) ? 'buzón de archivos' : camino;
const closePages = async (...pgs) => { for (const p of pgs) { try { await p.context().close(); } catch (e) {} } };

// ---- escenarios ----
async function oneToOne(browser, key, optsA, optsB, relays, ready) {
  const radio = new Radio();
  const a = await phone(browser, 'A', optsA, relays), b = await phone(browser, 'B', optsB, relays);
  radio.add(a.native); radio.add(b.native); a.native.load(); b.native.load();
  const A = await a.boot(), B = await b.boot();
  const idA = await idOf(A), idB = await idOf(B);
  if (!(await pair(A, ['B', SEED.B]))) return { error: 'no empareja' };
  await openChat(A, idB); await sendText(A, 'hola'); await sleep(2500);
  await openChat(B, idA); await sendText(B, 'hola'); await sleep(2500);
  const out = { listo_s: await ready({ A, B, idA, idB, radio, a, b }) };
  out.camino = await linkOf(A, idB);
  const sent = await sendGalleryPhoto(A, 4000, 3000);
  out.original_kb = sent.kb; if (sent.error) out.error = sent.error;
  Object.assign(out, await measure(B, b.native, idA, 180000));
  out.ruta = rutaDe(out.id, out.camino);
  return { out, A, B, idA, idB, a, b, radio };
}

(async () => {
  const browser = await PW.chromium.launch();
  const okQ = (v, q) => typeof v === 'number' && Math.abs(v - q) <= 1;
  try {
    // 1) solo Bluetooth (sin Wi-Fi ni relés)
    let s = await oneToOne(browser, 'bluetooth', {}, {}, [], async () => 0);
    r.bluetooth = s.out;
    if (s.out.llega) r.bluetooth.miniatura_ok = await thumbOk(s.B, s.b.native, s.idA, s.out.id);
    await closePages(s.A, s.B);

    // 2) misma red Wi-Fi (sin relés)
    s = await oneToOne(browser, 'wifi_local', { wifi: 'casa' }, { wifi: 'casa' }, [], async ({ A, B, idA, idB }) => waitFor(async () => (await linkOf(A, idB)) === 'wifi' && (await linkOf(B, idA)) === 'wifi', 30000));
    r.wifi_local = s.out;
    await closePages(s.A, s.B);

    // 3) Wi-Fi Direct (sin red ni relés): Bluetooth directo + los dos con Wi-Fi Direct
    s = await oneToOne(browser, 'wifi_direct', { wifiDirect: true }, { wifiDirect: true }, [], async ({ A, idB }) => waitFor(() => A.evaluate((x) => !!(window.bleInterface.wifiDirect && window.bleInterface.wifiDirect.canReach(x)), idB), 30000));
    r.wifi_direct = s.out;
    await closePages(s.A, s.B);

    // 4) internet: redes distintas, sin Bluetooth, relés del simulador (la foto va al buzón de archivos) + grupo por el buzón
    const rl = [new NostrRelay(), new NostrRelay({ authRequired: true }), new NostrRelay()];
    const urls = []; for (const x of rl) urls.push(await x.start());
    s = await oneToOne(browser, 'internet', { wifi: 'casa' }, { wifi: 'oficina' }, urls, async ({ A, B, idA, idB, radio, a, b }) => {
      radio.block(a.native, b.native);
      await A.evaluate(() => window.bleInterface.net.tick()); await B.evaluate(() => window.bleInterface.net.tick());
      return waitFor(async () => (await linkOf(A, idB)) === 'internet' && (await linkOf(B, idA)) === 'internet', 60000);
    });
    r.internet = s.out;
    if (s.out.llega) r.internet.miniatura_ok = await thumbOk(s.B, s.b.native, s.idA, s.out.id);
    // grupo con internet: va al buzón de archivos (una subida) → como internet
    const gid = await s.A.evaluate((x) => window.bleInterface.groups.create('Fotos', [x]).id, s.idB);
    await s.A.evaluate((g) => window.NEXO_openGroupChat(g), gid); await sleep(600);
    await sendText(s.A, 'hola grupo');
    const gIn = await waitFor(() => s.B.evaluate((g) => !!window.bleInterface.groups.get(g), gid), 60000);
    const gs = await sendGalleryPhoto(s.A, 4000, 3000);
    r.grupo_internet = Object.assign({ grupo_en_B_s: gIn, original_kb: gs.kb }, gs.error ? { error: gs.error } : {}, await measure(s.B, s.b.native, gid, 120000));
    r.grupo_internet.ruta = rutaDe(String(r.grupo_internet.id || '').split('_')[0], 'sobre del grupo');
    // B apaga el teléfono (ausente por todos los caminos) y A, con internet, le manda otra: va al buzón de archivos → 1600 px.
    // Se mide la copia que guarda A (lo mismo que sube; B no vuelve en esta prueba)
    await closePages(s.B); s.b.native.destroyActivity();
    await s.A.evaluate((x) => { const p = window.bleInterface.net.peers.get(x); if (p) p.lastRx = 0; return window.bleInterface.net.tick(); }, s.idB);
    const aus = await waitFor(() => s.A.evaluate((x) => !window.bleInterface.net.canReach(x), s.idB), 15000);
    await openChat(s.A, s.idB);
    const as = await sendGalleryPhoto(s.A, 4000, 3000);
    let own = null;
    await waitFor(async () => !!(own = await s.A.evaluate(async (c) => { const ms = (await window.vaultLoadMessages(c)) || []; const x = ms.filter((y) => y.attachmentType === 'image' && y._own && !y.deleted).pop(); return x ? { id: x.messageId || x.msgId, b64: typeof x.attachmentPayload === 'string' && x.attachmentPayload.length > 200 ? x.attachmentPayload : null, ref: x.attachmentRef || null } : null; }, s.idB)) && !!own.id && own.id !== r.internet.id, 15000);
    const ob64 = own && (own.b64 || (own.ref && s.a.native.files.get(own.ref)));
    const oi = ob64 ? jpegInfo(ob64) : null;
    await waitFor(() => own && rutaDe(own.id, '') === 'buzón de archivos', 15000);
    r.internet_B_ausente = { ausente_s: aus, original_kb: as.kb, lado_mayor: oi ? Math.max(oi.w, oi.h) : 0, calidad: oi && oi.q, kb: oi && oi.kb, ruta: own ? rutaDe(own.id, 'pendiente') : null };
    await closePages(s.A);
    for (const x of rl) await x.stop();

    // 5) grupo sin internet: B por la misma red Wi-Fi, C solo por Bluetooth → manda el peor (Bluetooth)
    {
      const radio = new Radio();
      const a = await phone(browser, 'A', { wifi: 'casa' }, []), b = await phone(browser, 'B', { wifi: 'casa' }, []), c = await phone(browser, 'C', {}, []);
      [a, b, c].forEach((p) => { radio.add(p.native); p.native.load(); });
      const A = await a.boot(), B = await b.boot(), C = await c.boot();
      const idA = await idOf(A), idB = await idOf(B), idC = await idOf(C);
      const pB = await pair(A, ['B', SEED.B]), pC = await pair(A, ['C', SEED.C]);
      if (!pB || !pC) { r.grupo_peor_bluetooth = { error: 'no empareja' }; }
      else {
        for (const [p, id] of [[A, idB], [A, idC], [B, idA], [C, idA]]) { await openChat(p, id); await sendText(p, 'hola'); await sleep(2000); }
        const caminos = { B: await waitFor(async () => (await linkOf(A, idB)) === 'wifi', 30000), C: await linkOf(A, idC) };
        const g2 = await A.evaluate(([x, y]) => window.bleInterface.groups.create('Familia', [x, y]).id, [idB, idC]);
        await A.evaluate((g) => window.NEXO_openGroupChat(g), g2); await sleep(600);
        await sendText(A, 'hola familia');
        const gIn2 = await waitFor(async () => (await B.evaluate((g) => !!window.bleInterface.groups.get(g), g2)) && (await C.evaluate((g) => !!window.bleInterface.groups.get(g), g2)), 60000);
        const g2s = await sendGalleryPhoto(A, 4000, 3000);
        const mB = await measure(B, b.native, g2, 180000), mC = await measure(C, c.native, g2, 180000);
        r.grupo_peor_bluetooth = { caminos: { B: caminos.B !== null ? 'wifi' : await linkOf(A, idB), C: caminos.C }, grupo_en_B_y_C_s: gIn2, original_kb: g2s.kb, B: mB, C: mC };
      }
      await closePages(A, B, C);
    }
  } catch (e) {
    r.error = (e && e.stack || String(e)).substring(0, 400);
  }
  await browser.close().catch(() => {});

  const bt = r.bluetooth || {}, wl = r.wifi_local || {}, wd = r.wifi_direct || {}, net = r.internet || {}, gi = r.grupo_internet || {}, gb = r.grupo_peor_bluetooth || {};
  r.ok = {
    bluetooth_1280_75: bt.lado_mayor === 1280 && okQ(bt.calidad, 75),
    wifi_local_1600_82: wl.lado_mayor === 1600 && okQ(wl.calidad, 82),
    wifi_direct_1600_82: wd.lado_mayor === 1600 && okQ(wd.calidad, 82),
    internet_1600x1200_82: net.ancho === 1600 && net.alto === 1200 && okQ(net.calidad, 82),
    grupo_internet_1600_82: gi.lado_mayor === 1600 && okQ(gi.calidad, 82),
    ausente_buzon_1600_82: !!r.internet_B_ausente && r.internet_B_ausente.lado_mayor === 1600 && okQ(r.internet_B_ausente.calidad, 82) && r.internet_B_ausente.ruta === 'buzón de archivos',
    grupo_peor_bluetooth_1280_75: !!(gb.B && gb.C) && gb.B.lado_mayor === 1280 && gb.C.lado_mayor === 1280 && okQ(gb.B.calidad, 75) && okQ(gb.C.calidad, 75),
    miniaturas: bt.miniatura_ok === true && net.miniatura_ok === true,
    original_bajo_5MB: [bt, wl, wd, net, gi].every((x) => typeof x.original_kb === 'number' && x.original_kb <= 5 * 1024),
  };
  r.errores = logs.filter((l) => /PAGEERROR|Uncaught/.test(l)).slice(0, 5);
  const ok = !r.error && Object.values(r.ok).every(Boolean) && !r.errores.length;
  fin(ok);
  process.exit(ok ? 0 : 1);
})().catch((e) => { fin(false, { error: e && e.stack }); process.exit(1); });
