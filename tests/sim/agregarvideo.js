// #224 (dueño 16-11: «cuando hago una videollamada con otro contacto y luego agrego un contacto a la videollamada, no debería
// quitarse toda la parte de video»). Antes, «Agregar» colgaba la videollamada y arrancaba una llamada de grupo DE VOZ: cámaras
// cerradas, la imagen del otro fuera, lista de nombres. Videollamadas de verdad en Chromium (cámara de prueba, mismo Wi-Fi), A, B y C:
//  a  A–B en videollamada; A agrega a C: la cámara de A y la de B siguen abiertas (la misma pista viva, sin pausa) y la imagen del
//     otro sigue en el MISMO elemento, sin salir de la pantalla y cambiando (en los dos); nada de pantalla de voz;
//  b  A ve dos mitades: arriba B (su imagen), abajo C esperando (su círculo, su nombre, «Llamando…» y «Cancelar» que se puede
//     tocar); la imagen de A pequeña; a C le suena;
//  c  «Cancelar»: a C le deja de sonar y A (y B) vuelven a la pantalla de 1-a-1 con la imagen del otro, que sigue cambiando;
//  d  A agrega otra vez a C y C contesta: abajo, la imagen de C (en A y en B);
//  e  dos toques en C: C a toda la pantalla y B pequeño flotando (sin tocar los botones); dos toques otra vez: mitades. Un toque
//     solo oculta / muestra los botones;
//  f  los botones caben en 360/384/412 de ancho (una fila, colgar entero y tocable, nombres enteros) en el orden de la 1-a-1.
// Y los dos fallos del diagnóstico del 16-11 (S24 y S23, APK 3073), en el mismo arnés:
//  z  (S23) la de grupo de «Agregar» quedaba viva sin nadie: A agrega a C, C no contesta, A cuelga → B también termina (antes B se
//     quedaba esperando a C para siempre, la ponía «en espera» con la siguiente llamada y volvía sola al colgarla);
//  m3 (S24) videollamada nueva justo después: micrófono y cámara abiertos en los dos, y B sin otra llamada (sin pantalla dividida);
//  m1 (S24) la app pasa a segundo plano mientras suena (getUserMedia con la app oculta no contesta): A ya tiene micrófono y cámara
//     (se abren al llamar) y el modo llamada del teléfono (servicio con micrófono) puesto antes de ocultarse; voz e imagen salen;
//  m2 contestar con la app oculta (desde el aviso): al volver a la app, el micrófono y la cámara se piden otra vez y salen.
// Uso: node agregarvideo.js <dir_build>   (AV_SHOTS=<carpeta>: capturas a 384 de ancho)
'use strict';
const fs = require('fs');
const path = require('path');
const { Radio, NativePhone } = require('./native_mock');
const PW = (() => { try { return require('playwright'); } catch (e) { return require('/opt/node22/lib/node_modules/playwright'); } })();

const buildDir = path.resolve(process.argv[2]);
const dist = path.join(buildDir, 'dist');
const opts = { readsContentFallback: true, retain: ['onPayloadReceived'], closeOnNoService: true, pace: [15, 15], ioDelay: 25, supervisionMs: 3000, wifi: 'casa', asymmetric: true };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const logs = [];
const T0 = Date.now();
const ts = () => String(((Date.now() - T0) / 1000).toFixed(1)).padStart(6) + 's';
const TYPES = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json', '.woff2': 'font/woff2' };
const SHOTS = process.env.AV_SHOTS || '';

async function boot(browser, name, native) {
  const page = await browser.newPage({ viewport: { width: 384, height: 830 }, deviceScaleFactor: SHOTS ? 2 : 1, isMobile: true, hasTouch: true });
  page.on('console', (m) => logs.push(`${ts()} [${name}] ${m.text()}`.substring(0, 400)));
  page.on('pageerror', (e) => logs.push(`${ts()} [${name}] PAGEERROR ${e.message}`));
  await page.route('https://' + name.toLowerCase() + '.nexo.test/**', (route) => {
    const f = path.join(dist, decodeURIComponent(new URL(route.request().url()).pathname));
    if (fs.existsSync(f) && fs.statSync(f).isFile()) route.fulfill({ body: fs.readFileSync(f), contentType: TYPES[path.extname(f)] || 'application/octet-stream' });
    else route.fulfill({ status: 404, body: '' });
  });
  const methods = Object.keys(native.plugin()).filter((k) => k !== 'addListener');
  const forwarded = new Set();
  await page.exposeFunction('__nexoCall', async (method, args) => {
    try { return { ok: await native.plugin()[method](args || {}) }; } catch (e) { return { err: e.message, code: e.code }; }
  });
  await page.exposeFunction('__nexoAddListener', (event) => {
    if (forwarded.has(event)) return;
    forwarded.add(event);
    native.plugin().addListener(event, (data) => { page.evaluate(([e, d]) => window.__nexoEmit(e, d), [event, data]).catch(() => {}); });
  });
  await page.addInitScript((methods) => {
    window.CapacitorCustomPlatform = { name: 'android' };
    window.NEXO_FORCE_LANG = 'es';
    const listeners = {};
    window.__nexoEmit = (e, d) => (listeners[e] || []).slice().forEach((cb) => { try { cb(d); } catch (x) { console.error('listener ' + e + ': ' + x.message); } });
    const plugin = {
      addListener(event, cb) {
        (listeners[event] = listeners[event] || []).push(cb);
        window.__nexoAddListener(event);
        const h = { remove: async () => { const l = listeners[event] || []; const i = l.indexOf(cb); if (i >= 0) l.splice(i, 1); } };
        const p = Promise.resolve(h); p.remove = h.remove; return p;
      },
    };
    methods.forEach((m) => { plugin[m] = async (args) => { const r = await window.__nexoCall(m, args); if (r.err) { const e = new Error(r.err); e.code = r.code; throw e; } return r.ok; }; });
    window.Capacitor = { Plugins: { NexoBLE: plugin } };
    // App en segundo plano (como el S24 del 16-11): la página se ve «oculta» y un getUserMedia pedido así no contesta nunca
    window.__hidden = false;
    Object.defineProperty(Document.prototype, 'visibilityState', { configurable: true, get() { return window.__hidden ? 'hidden' : 'visible'; } });
    Object.defineProperty(Document.prototype, 'hidden', { configurable: true, get() { return !!window.__hidden; } });
    window.__setHidden = (h) => { window.__hidden = !!h; document.dispatchEvent(new Event('visibilitychange')); };
    window.__gum = [];
    const md = navigator.mediaDevices, real = md && md.getUserMedia ? md.getUserMedia.bind(md) : null;
    if (md) md.getUserMedia = (c) => { const k = c && c.video ? 'cámara' : 'micrófono'; if (window.__hidden) { window.__gum.push(k + ' (oculta: no contesta)'); return new Promise(() => {}); } window.__gum.push(k); return real(c); };
  }, methods);
  await page.goto('https://' + name.toLowerCase() + '.nexo.test/index.html');
  await page.waitForFunction(() => window.NEXO && window.NEXO.initialized, null, { timeout: 20000 });
  // (la pantalla de «¿cómo te llamas?» del primer arranque queda encima de todo en el simulador: en el teléfono ya se puso el nombre)
  await page.addStyleTag({ content: '#nexo-name-overlay{display:none !important}' });
  await sleep(800);
  return page;
}

const click = (page, sel) => page.evaluate((s) => { const el = document.querySelector(s); if (el) el.dispatchEvent(new MouseEvent('click', { bubbles: true })); return !!el; }, sel);
async function waitFor(fn, ms) { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (await fn()) return Math.round((Date.now() - t0) / 100) / 10; } catch (e) {} await sleep(200); } return null; }
const clickRowNamed = (page, container, name, inner) => page.evaluate(([c, n, inner]) => {
  const row = Array.from(document.querySelectorAll(c)).find((r) => ((r.querySelector('.ble-contact-name') || r.querySelector('span') || {}).textContent || '').trim() === n);
  const target = row && (inner ? row.querySelector(inner) : row);
  if (target) target.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  return !!target;
}, [container, name, inner || '']);
async function sendText(page, t) {
  await page.evaluate((t) => { const i = document.getElementById('message-input'); i.value = t; i.dispatchEvent(new Event('input', { bubbles: true })); document.getElementById('send-btn').dispatchEvent(new MouseEvent('click', { bubbles: true })); }, t);
}
const closeChat = (page) => page.evaluate(() => window.dispatchEvent(new CustomEvent('nexo:ble:closeChat', { detail: {} })));

// Estado de las llamadas de un teléfono
const calls = (page) => page.evaluate(() => {
  const bi = window.bleInterface, c = bi.calls.call, g = bi.gcall.gc;
  return { uno: c ? c.state : null, grupo: g ? g.state : null, tramos: g ? Array.from(g.legs.entries()).map(([nx, l]) => nx + ':' + l.state).join(',') : '' };
});
// Medios de la llamada 1-a-1 (¿salen voz e imagen?)
const media1 = (page) => page.evaluate(() => {
  const c = window.bleInterface.calls, m = c.call && c.call.media, st = m && m.stats ? m.stats() : null;
  const lv = m && m.localVideo, tr = lv && lv.srcObject && lv.srcObject.getVideoTracks()[0];
  return { estado: c.call ? c.call.state : null, voz_enviada: c.stats.sent || 0, video_enviado: c.stats.sentV || 0, micro: !!(st && st.mic), camara: !!(tr && tr.readyState === 'live'), pedidos: window.__gum.slice(-6) };
});
// Lo que se ve en la pantalla de la llamada de grupo
const layout = (page) => page.evaluate(() => {
  const W = innerWidth, H = innerHeight;
  const box = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { x: Math.round(b.left), y: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height) }; };
  const tocable = (el) => { if (!el) return false; const b = el.getBoundingClientRect(); const e = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2); return !!e && el.contains(e); };
  const scr = document.getElementById('nexo-gcall-screen'), stage = scr && scr.querySelector('.gcs-stage');
  const mem = scr && scr.querySelector('.gc-members');
  const tiles = stage ? Array.from(stage.querySelectorAll('.gcs-tile')).map((t) => {
    const cb = t.querySelector('.gcs-cancel');
    return { nx: t.dataset.nx, pos: ['gcs-full', 'gcs-up', 'gcs-down', 'gcs-mini'].find((c) => t.classList.contains(c)) || '', espera: t.classList.contains('gcs-wait'),
      sin_imagen: t.classList.contains('gcs-novideo'), imagen: !!t.querySelector('canvas.gcs-v'), box: box(t), nombre: ((t.querySelector('.gcs-pname') || {}).textContent || ''),
      estado: ((t.querySelector('.gcs-pst') || {}).textContent || ''), circulo: !!t.querySelector('.nx-person-av'), cancelar: !!cb, cancelar_tocable: tocable(cb) };
  }) : [];
  const self = stage && stage.querySelector('.gcs-self');
  return { W, H, grupo: !!scr, modo_video: !!(scr && scr.classList.contains('gc-stagemode')), lista_de_voz: !!(mem && getComputedStyle(mem).display !== 'none'),
    pantalla_1a1: !!document.getElementById('nexo-call-screen'), dividida: document.documentElement.classList.contains('nc-split'), botones_ocultos: !!(scr && scr.classList.contains('gcs-hide')),
    tiles, yo: self && !self.classList.contains('gcs-off') && self.querySelector('video') ? box(self) : null };
});
// Botones de abajo (como gcbotones.js)
const buttons = (page) => page.evaluate(() => {
  const W = innerWidth, H = innerHeight, el = document.getElementById('nexo-gcall-screen');
  const bs = Array.from(el.querySelectorAll('.gc-buttons button')), rs = bs.map((b) => b.getBoundingClientRect());
  const filas = new Set(rs.map((x) => Math.round(x.top))).size;
  const pisan = rs.some((a, i) => i > 0 && a.left < rs[i - 1].right - 0.5);
  const hang = el.querySelector('.gc-buttons .call-hangup'), hr = hang && (hang.querySelector('.nc-ic') || hang).getBoundingClientRect();
  const hc = hr && document.elementFromPoint(hr.left + hr.width / 2, hr.top + hr.height / 2);
  const labs = bs.map((b) => b.querySelector('span:last-child')).filter(Boolean);
  const ancho = (l) => { const rg = document.createRange(); rg.selectNodeContents(l); return rg.getBoundingClientRect().width; };
  return { nombres: labs.map((l) => l.textContent).join(' · '), n: bs.length, filas, caben: rs.every((x) => x.left >= -0.5 && x.right <= W + 0.5 && x.bottom <= H + 0.5) && !pisan,
    colgar_entero_y_tocable: !!hr && hr.left >= 0 && hr.right <= W && hr.top >= 0 && hr.bottom <= H && !!hc && hang.contains(hc), encima_de_colgar: hc && !hang.contains(hc) ? (hc.id || String(hc.className && hc.className.baseVal !== undefined ? hc.className.baseVal : hc.className)) : '',
    circulo_min: Math.round(Math.min(...bs.map((b) => (b.querySelector('.nc-ic') || b).getBoundingClientRect().width))),
    letra_min: Math.min(...labs.map((l) => parseFloat(getComputedStyle(l).fontSize))), cortados: labs.filter((l) => ancho(l) > l.getBoundingClientRect().width + 0.05).map((l) => l.textContent) };
});
// Antes de «Agregar»: se apuntan mi imagen y la del otro y se vigila cada 50 ms que no salgan de la pantalla ni se paren
const watchStart = (page, peer) => page.evaluate((peer) => {
  const bi = window.bleInterface, v = bi.calls.call ? bi.calls.videoViews() : { local: bi.gcall.localVideoEl(), remote: bi.gcall.remoteVideoEl(peer) }, lv = v.local, rc = v.remote;
  const tr = lv && lv.srcObject && lv.srcObject.getVideoTracks()[0];
  window.__av = { lv, rc, pista: tr ? tr.id : '', n: 0, mi_imagen_fuera: 0, mi_imagen_pausada: 0, pista_muerta: 0, su_imagen_fuera: 0 };
  const m = window.__av;
  m.t = setInterval(() => { m.n++; if (!document.contains(lv)) m.mi_imagen_fuera++; if (lv.paused) m.mi_imagen_pausada++; const t = lv.srcObject && lv.srcObject.getVideoTracks()[0]; if (!t || t.readyState !== 'live') m.pista_muerta++; if (!document.contains(rc)) m.su_imagen_fuera++; }, 50);
  return !!(lv && rc);
}, peer);
const watchEnd = (page, peer) => page.evaluate(async (peer) => {
  const m = window.__av; clearInterval(m.t);
  const g = window.bleInterface.gcall;
  // ¿la imagen del otro sigue cambiando? (huella de una versión pequeña del lienzo cada 150 ms durante 2 s)
  const c = document.createElement('canvas'); c.width = 24; c.height = 18; const cx = c.getContext('2d');
  let last = '', cambios = 0;
  for (let i = 0; i < 14; i++) { try { cx.drawImage(m.rc, 0, 0, 24, 18); const d = cx.getImageData(0, 0, 24, 18).data; let h = 0; for (let k = 0; k < d.length; k += 4) h = (h * 31 + d[k] + d[k + 1] * 3 + d[k + 2] * 7) % 1000000007; const s = String(h); if (last && s !== last) cambios++; last = s; } catch (e) {} await new Promise((r) => setTimeout(r, 150)); }
  const tr = m.lv.srcObject && m.lv.srcObject.getVideoTracks()[0];
  return { vigilado_ms: m.n * 50, mi_imagen_fuera: m.mi_imagen_fuera, mi_imagen_pausada: m.mi_imagen_pausada, pista_muerta: m.pista_muerta, su_imagen_fuera: m.su_imagen_fuera,
    misma_pista: !!tr && tr.id === m.pista && tr.readyState === 'live', mi_imagen_ancho: m.lv.videoWidth, su_imagen_ancho: m.rc.width || 0, su_imagen_cambia: cambios,
    mismo_elemento_mio: !!g.localVideoEl && g.localVideoEl() === m.lv, mismo_elemento_suyo: !!g.remoteVideoEl && g.remoteVideoEl(peer) === m.rc };
}, peer);
const shot = async (page, name) => {
  if (!SHOTS) return;
  await page.evaluate(() => document.querySelectorAll('body > *:not(#nexo-gcall-screen)').forEach((e) => { e.dataset.avv = e.style.visibility; e.style.visibility = 'hidden'; }));
  await page.screenshot({ path: path.join(SHOTS, name) });
  await page.evaluate(() => document.querySelectorAll('body > *:not(#nexo-gcall-screen)').forEach((e) => { e.style.visibility = e.dataset.avv || ''; }));
};
const dblTap = (page, nx) => page.evaluate(async (nx) => {
  const t = document.querySelector('.gcs-tile[data-nx="' + nx + '"]'); if (!t) return false;
  t.dispatchEvent(new MouseEvent('click', { bubbles: true })); await new Promise((r) => setTimeout(r, 90)); t.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  return true;
}, nx);

(async () => {
  const r = { prueba: 'agregarvideo', build: path.basename(buildDir) };
  const browser = await PW.chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  const radio = new Radio(), nat = {}, P = {};
  ['A', 'B', 'C'].forEach((n, i) => { const h = n.repeat(2); nat[n] = new NativePhone(n, [h, h, h, h, h, '0' + (i + 1)].join(':'), Object.assign({}, opts)); radio.add(nat[n]); nat[n].load(); });
  for (const n of ['A', 'B', 'C']) P[n] = await boot(browser, n, nat[n]);
  const id = {}; for (const n of ['A', 'B', 'C']) id[n] = await P[n].evaluate(() => String(window.bleInterface.localNexoId).toLowerCase());
  // Contactos: A–B, A–C y B–C (la malla del grupo)
  async function pair(x, y) {
    const others = ['A', 'B', 'C'].filter((n) => n !== x && n !== y);
    others.forEach((o) => radio.block(nat[x], nat[o]));
    await P[x].evaluate(() => window.bleInterface.togglePanel());
    let ok = false;
    for (let i = 0; i < 300 && !ok; i++) { await sleep(150); ok = await clickRowNamed(P[x], '#ble-new-device > div', y, 'button'); if (!ok && !(await P[x].evaluate(() => window.bleInterface.isScanning))) await click(P[x], '#ble-scan-btn'); }
    await sleep(1800);
    await P[x].evaluate(() => window.bleInterface.togglePanel());
    await sleep(600);
    await clickRowNamed(P[x], '#main-contacts-list .ble-contact-row', y); await sleep(500);
    await sendText(P[x], 'hola ' + y);
    const keyOf = (a, b) => P[a].evaluate((b) => !!((window.vaultLoadContacts() || []).find((c) => c.name === b) || {}).publicKey, b);
    await waitFor(() => keyOf(x, y), 20000); await waitFor(() => keyOf(y, x), 20000);
    await closeChat(P[x]); await sleep(300);
    others.forEach((o) => radio.unblock(nat[x], nat[o]));
    return ok;
  }
  for (const [x, y] of [['A', 'B'], ['A', 'C'], ['B', 'C']]) if (!(await pair(x, y))) { console.log('AGREGARVIDEO ' + JSON.stringify({ prueba: 'agregarvideo', resultado: 'FALLO', error: 'no empareja ' + x + y })); process.exit(1); }
  const lanOk = (x, y) => P[x].evaluate((nx) => !!window.bleInterface.calls.canVideo(nx) && !!(window.bleInterface.lan && window.bleInterface.lan.canReach(nx)), id[y]);
  r.wifi_s = await waitFor(async () => (await lanOk('A', 'B')) && (await lanOk('A', 'C')) && (await lanOk('B', 'C')) && (await lanOk('B', 'A')) && (await lanOk('C', 'A')) && (await lanOk('C', 'B')), 60000);

  async function videoCall(x, y, opt = {}) {
    await clickRowNamed(P[x], '#main-contacts-list .ble-contact-row', y); await sleep(500);
    await click(P[x], '#nexo-video-btn');
    await closeChat(P[x]);
    if (opt.beforeAnswer) await opt.beforeAnswer();
    await waitFor(() => P[y].evaluate(() => !!(window.bleInterface.calls.call && window.bleInterface.calls.call.state === 'ringing')), 20000);
    if (opt.answerHidden) { await P[y].evaluate(() => window.__setHidden(true)); await sleep(300); await P[y].evaluate(() => window.bleInterface.calls.accept()); } // como «Contestar» en el aviso
    else await click(P[y], '#nexo-call-screen .call-accept');
    return waitFor(async () => (await calls(P[x])).uno === 'active' && (await calls(P[y])).uno === 'active', 20000);
  }
  const hangAll = async () => {
    for (const n of ['A', 'B', 'C']) await P[n].evaluate(() => { const bi = window.bleInterface; try { if (bi.calls.call) bi.calls.hangup(); } catch (e) {} try { if (bi.gcall.gc) { if (bi.gcall.gc.state === 'ringing') bi.gcall.reject(); else bi.gcall.hangup(); } } catch (e) {} });
    await waitFor(async () => { for (const n of ['A', 'B', 'C']) { const c = await calls(P[n]); if (c.uno || c.grupo) return false; } return true; }, 15000);
    await sleep(2500);
  };

  // ── m1: A llama y pasa a segundo plano mientras suena (2,5 s después, como el S24); B contesta
  let fgsAlOcultar = null;
  r.m1_activa_s = await videoCall('A', 'B', { beforeAnswer: async () => { await sleep(2500); fgsAlOcultar = nat.A.callFgs || null; await P.A.evaluate(() => window.__setHidden(true)); } });
  await sleep(4000);
  r.m1_A = await media1(P.A);
  r.m1_A.servicio_al_ocultarse = fgsAlOcultar;
  await P.A.evaluate(() => window.__setHidden(false));
  await hangAll();

  // ── a/b: A–B en videollamada; A agrega a C
  r.a_activa_s = await videoCall('A', 'B');
  await sleep(3000);
  r.a_antes = { A: await media1(P.A), B: await media1(P.B) };
  await watchStart(P.A, id.B); await watchStart(P.B, id.A);
  await click(P.A, '#nexo-call-screen .call-add');
  await waitFor(() => P.A.evaluate(() => !!document.getElementById('nexo-contact-picker')), 5000);
  await clickRowNamed(P.A, '#nexo-contact-picker .nx-person-row', 'C');
  r.b_C_suena_s = await waitFor(async () => (await calls(P.C)).grupo === 'ringing', 15000);
  r.b_B_dentro_s = await waitFor(async () => (await calls(P.B)).grupo === 'active', 15000);
  await sleep(1500);
  r.a_A = await watchEnd(P.A, id.B); r.a_B = await watchEnd(P.B, id.A);
  r.b_A = await layout(P.A); r.b_B = await layout(P.B);
  await shot(P.A, 'espera_384.png');
  // ── c: «Cancelar» en la baldosa de C
  await click(P.A, '.gcs-tile[data-nx="' + id.C + '"] .gcs-cancel');
  r.c_C_deja_de_sonar_s = await waitFor(async () => (await calls(P.C)).grupo === null, 8000);
  r.c_B_sin_C_s = await waitFor(async () => (await layout(P.B)).tiles.length === 1, 8000);
  await sleep(500);
  r.c_A = await layout(P.A); r.c_B = await layout(P.B);
  await watchStart(P.A, id.B); r.c_A_imagen = await watchEnd(P.A, id.B);
  // ── d: A agrega otra vez a C y C contesta
  await click(P.A, '#nexo-gcall-screen .gc-k-addp');
  await waitFor(() => P.A.evaluate(() => !!document.getElementById('nexo-contact-picker')), 5000);
  await clickRowNamed(P.A, '#nexo-contact-picker .nx-person-row', 'C');
  r.d_C_suena_s = await waitFor(async () => (await calls(P.C)).grupo === 'ringing', 15000);
  await click(P.C, '#nexo-gcall-screen .gc-green');
  const cVisto = (p) => async () => { const l = await layout(p); const t = l.tiles.find((x) => x.nx === id.C); return !!t && t.imagen && !t.sin_imagen && !t.espera; };
  r.d_A_ve_a_C_s = await waitFor(cVisto(P.A), 20000);
  r.d_B_ve_a_C_s = await waitFor(cVisto(P.B), 20000);
  r.d_A = await layout(P.A); r.d_B = await layout(P.B);
  await shot(P.A, 'dos_mitades_384.png');
  // ── e: dos toques en C (y un toque solo: botones)
  await dblTap(P.A, id.C); await sleep(500);
  r.e_doble = await layout(P.A);
  await shot(P.A, 'doble_toque_384.png');
  await dblTap(P.A, id.C); await sleep(500);
  r.e_doble_otra_vez = await layout(P.A);
  await click(P.A, '.gcs-tile[data-nx="' + id.B + '"]'); await sleep(120);
  const unoAntes = (await layout(P.A)).botones_ocultos; await sleep(400);
  const unoDespues = await layout(P.A);
  await click(P.A, '.gcs-tile[data-nx="' + id.B + '"]'); await sleep(450);
  r.e_un_toque = { al_instante: unoAntes, tras_300ms: unoDespues.botones_ocultos, mitades: unoDespues.tiles.map((t) => t.pos).join(','), otra_vez: (await layout(P.A)).botones_ocultos };
  // ── f: botones a 360/384/412
  r.f = {};
  for (const w of [360, 384, 412]) {
    await P.A.setViewportSize({ width: w, height: Math.round(w * 2.16) }); await P.A.evaluate(() => window.dispatchEvent(new Event('resize'))); await sleep(1200);
    const l = await layout(P.A);
    r.f['ancho ' + w] = Object.assign(await buttons(P.A), { mitades: l.tiles.map((t) => t.pos).join(','), mitad_arriba: (l.tiles[0] || {}).box });
  }
  await P.A.setViewportSize({ width: 384, height: 830 }); await sleep(300);
  // A cuelga: B y C siguen entre ellos; luego todo fuera
  await click(P.A, '#nexo-gcall-screen .gc-buttons .call-hangup');
  r.f_A_cuelga_B_y_C_siguen_s = await waitFor(async () => (await calls(P.A)).grupo === null && (await calls(P.B)).grupo === 'active' && (await layout(P.B)).tiles.length === 1, 10000);
  await hangAll();

  // ── z: A agrega a C, C no contesta y A cuelga: B tiene que terminar también
  r.z_activa_s = await videoCall('A', 'B');
  await sleep(2000);
  await click(P.A, '#nexo-call-screen .call-add');
  await waitFor(() => P.A.evaluate(() => !!document.getElementById('nexo-contact-picker')), 5000);
  await clickRowNamed(P.A, '#nexo-contact-picker .nx-person-row', 'C');
  await waitFor(async () => (await calls(P.C)).grupo === 'ringing' && (await calls(P.B)).grupo === 'active', 15000);
  await sleep(2000);
  await P.A.evaluate(() => window.bleInterface.gcall.hangup());
  r.z_B_termina_s = await waitFor(async () => (await calls(P.B)).grupo === null, 8000);
  r.z_C_deja_de_sonar_s = await waitFor(async () => (await calls(P.C)).grupo === null, 8000);
  r.z_B = await calls(P.B);
  // ── m3: videollamada nueva enseguida (3 s después)
  await sleep(1000);
  r.m3_activa_s = await videoCall('A', 'B');
  await sleep(4000);
  r.m3_A = await media1(P.A); r.m3_B = await media1(P.B);
  r.m3_B_llamadas = await calls(P.B); r.m3_B_dividida = (await layout(P.B)).dividida;
  await hangAll();
  await P.C.evaluate(() => { try { if (window.bleInterface.gcall.gc) window.bleInterface.gcall.reject(); } catch (e) {} });

  // ── m2: B contesta con la app oculta (desde el aviso) y vuelve a la app 2 s después
  r.m2_activa_s = await videoCall('A', 'B', { answerHidden: true });
  await sleep(2000);
  r.m2_B_oculta = await media1(P.B);
  await P.B.evaluate(() => window.__setHidden(false));
  r.m2_vuelve_s = await waitFor(async () => { const m = await media1(P.B); return m.micro && m.camara && m.voz_enviada > 5 && m.video_enviado > 5; }, 12000);
  r.m2_B = await media1(P.B);
  await hangAll();

  r.errores = logs.filter((l) => /PAGEERROR/.test(l)).slice(0, 5);
  // ── Veredicto
  const num = (v) => typeof v === 'number';
  const sigue = (w) => !!w && w.vigilado_ms >= 1000 && w.mi_imagen_fuera === 0 && w.mi_imagen_pausada === 0 && w.pista_muerta === 0 && w.su_imagen_fuera === 0 && w.misma_pista &&
    w.mi_imagen_ancho > 0 && w.su_imagen_ancho > 0 && w.su_imagen_cambia >= 3 && w.mismo_elemento_mio && w.mismo_elemento_suyo;
  const pos = (l, nx) => ((l.tiles || []).find((t) => t.nx === nx) || {}).pos;
  const tile = (l, nx) => (l.tiles || []).find((t) => t.nx === nx) || {};
  const pequeno = (b) => !!b && b.w > 40 && b.w <= 130 && b.h <= 170;
  const mitad = (l, nx, p) => { const b = tile(l, nx).box; return pos(l, nx) === p && !!b && Math.abs(b.h - l.H / 2) <= 3 && (p === 'gcs-up' ? b.y <= 1 : Math.abs(b.y - l.H / 2) <= 3); };
  const v = {};
  v.m1 = num(r.m1_activa_s) && r.m1_A.micro && r.m1_A.camara && r.m1_A.voz_enviada > 10 && r.m1_A.video_enviado > 10 && r.m1_A.servicio_al_ocultarse === 'micrófono';
  v.a = num(r.a_activa_s) && num(r.b_B_dentro_s) && sigue(r.a_A) && sigue(r.a_B) && r.b_A.modo_video && !r.b_A.lista_de_voz && !r.b_A.pantalla_1a1 && !r.b_A.dividida && r.b_B.modo_video && !r.b_B.lista_de_voz && !r.b_B.pantalla_1a1;
  const wC = tile(r.b_A, id.C);
  v.b = num(r.b_C_suena_s) && r.b_A.tiles.length === 2 && mitad(r.b_A, id.B, 'gcs-up') && tile(r.b_A, id.B).imagen && mitad(r.b_A, id.C, 'gcs-down') && wC.espera && wC.circulo && wC.nombre === 'C' &&
    /Llamando/.test(wC.estado) && wC.cancelar_tocable && pequeno(r.b_A.yo) && pos(r.b_B, id.A) === 'gcs-up' && tile(r.b_B, id.C).espera && !tile(r.b_B, id.C).cancelar;
  v.c = num(r.c_C_deja_de_sonar_s) && num(r.c_B_sin_C_s) && r.c_A.tiles.length === 1 && pos(r.c_A, id.B) === 'gcs-full' && tile(r.c_A, id.B).imagen && pequeno(r.c_A.yo) && r.c_A.modo_video &&
    r.c_B.tiles.length === 1 && pos(r.c_B, id.A) === 'gcs-full' && !!r.c_A_imagen && r.c_A_imagen.su_imagen_cambia >= 3 && r.c_A_imagen.mismo_elemento_suyo;
  v.d = num(r.d_C_suena_s) && num(r.d_A_ve_a_C_s) && num(r.d_B_ve_a_C_s) && mitad(r.d_A, id.B, 'gcs-up') && mitad(r.d_A, id.C, 'gcs-down') && tile(r.d_A, id.B).imagen && pequeno(r.d_A.yo);
  v.e = pos(r.e_doble, id.C) === 'gcs-full' && pos(r.e_doble, id.B) === 'gcs-mini' && pequeno(tile(r.e_doble, id.B).box) && !r.e_doble.botones_ocultos && pequeno(r.e_doble.yo) &&
    pos(r.e_doble_otra_vez, id.C) === 'gcs-down' && pos(r.e_doble_otra_vez, id.B) === 'gcs-up' && !r.e_doble_otra_vez.botones_ocultos &&
    r.e_un_toque.al_instante === false && r.e_un_toque.tras_300ms === true && r.e_un_toque.mitades === 'gcs-up,gcs-down' && r.e_un_toque.otra_vez === false;
  v.f = Object.values(r.f).every((b) => b.n >= 7 && b.filas === 1 && b.caben && b.colgar_entero_y_tocable && b.circulo_min >= 40 && b.letra_min >= 8 && !b.cortados.length &&
    /^Girar · Pantalla · Cámara no · Silenciar · Altavoz · Agregar · Colgar$/.test(b.nombres) && b.mitades === 'gcs-up,gcs-down') && num(r.f_A_cuelga_B_y_C_siguen_s);
  v.z = num(r.z_activa_s) && num(r.z_B_termina_s) && num(r.z_C_deja_de_sonar_s);
  v.m3 = num(r.m3_activa_s) && r.m3_A.micro && r.m3_A.camara && r.m3_A.video_enviado > 10 && r.m3_B.micro && r.m3_B.video_enviado > 10 && r.m3_B_llamadas.grupo === null && !r.m3_B_dividida;
  v.m2 = num(r.m2_activa_s) && num(r.m2_vuelve_s) && r.m2_B.micro && r.m2_B.camara;
  r.casos = v;
  const ok = Object.values(v).every(Boolean) && !r.errores.length;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('AGREGARVIDEO ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_agregarvideo.txt'), logs.join('\n'));
  await browser.close();
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('AGREGARVIDEO ' + JSON.stringify({ prueba: 'agregarvideo', resultado: 'FALLO', error: String(e && e.stack || e) })); fs.writeFileSync(path.join(__dirname, 'last_logs_agregarvideo.txt'), logs.join('\n')); process.exit(1); });
