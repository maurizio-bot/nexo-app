// Arnés de llamadas en Chromium (3152/3155): varios teléfonos con la app real, cámara y micrófono de prueba de Chromium, el plugin
// NexoBLE puenteado al simulador nativo (native_mock.js) y todos en el mismo Wi-Fi. Lo usan agregarvideo.js y llamadamini.js.
//   const H = await callHarness({ buildDir, names: ['A', 'B'], shots: carpeta|'' });  → H.P[n] (página), H.nat[n], H.id[n], H.logs…
// Cada página puede simular la app en segundo plano: window.__setHidden(true) (visibilityState «hidden»; un getUserMedia pedido así
// no contesta nunca, como el S24 del 16-11) y apunta los pedidos de micrófono/cámara en window.__gum.
'use strict';
const fs = require('fs');
const path = require('path');
const { Radio, NativePhone } = require('./native_mock');
const PW = (() => { try { return require('playwright'); } catch (e) { return require('/opt/node22/lib/node_modules/playwright'); } })();

const TYPES = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json', '.woff2': 'font/woff2' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const BASE = { readsContentFallback: true, retain: ['onPayloadReceived'], closeOnNoService: true, pace: [15, 15], ioDelay: 25, supervisionMs: 3000, wifi: 'casa', asymmetric: true };

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
  return { estado: c.call ? c.call.state : null, voz_enviada: c.stats.sent || 0, video_enviado: c.stats.sentV || 0, video_recibido: c.stats.gotV || 0, micro: !!(st && st.mic), camara: !!(tr && tr.readyState === 'live'), pedidos: window.__gum.slice(-6) };
});
// 3155: lo que se ve en la ventanita (PiP): botones, textos, mi imagen y las imágenes de los demás (con su caja)
const pipLook = (page) => page.evaluate(() => {
  const W = innerWidth, H = innerHeight;
  const vis = (el) => { if (!el || !el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false; const b = el.getBoundingClientRect(); return b.width > 1 && b.height > 1 && b.right > 0 && b.bottom > 0 && b.left < W && b.top < H; };
  const all = (sel) => Array.from(document.querySelectorAll(sel)).filter(vis);
  const boxes = (els) => els.map((e) => { const b = e.getBoundingClientRect(); return [Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height)]; });
  return { W, H, botones: all('#nexo-call-screen .nc-btn, #nexo-call-screen .nc-min, #nexo-gcall-screen button').length,
    textos: all('#nexo-call-screen .nc-top, #nexo-call-screen .call-buttons, #nexo-gcall-screen .gcs-top, #nexo-gcall-screen .gcs-lab, #nexo-gcall-screen .gc-title, #nexo-gcall-screen .gcs-pst').length,
    mi_imagen: all('#nexo-call-screen .call-local-video, #nexo-gcall-screen .gcs-self').length,
    su_imagen: boxes(all('#nexo-call-screen .call-remote-video, #nexo-gcall-screen canvas.gcs-v')) };
});
// 3155: la llamada minimizada: barra arriba (con quién, cuánto, Silenciar, Colgar) y la app usable debajo
const barLook = (page) => page.evaluate(() => {
  const bar = document.getElementById('nexo-call-bar'), one = document.getElementById('nexo-call-screen'), grp = document.getElementById('nexo-gcall-screen');
  const vis = (el) => !!el && el.checkVisibility() && el.getBoundingClientRect().height > 1;
  const b = bar && bar.getBoundingClientRect();
  const mid = document.elementFromPoint(innerWidth / 2, innerHeight / 2), app = document.getElementById('app'), ab = app && app.getBoundingClientRect();
  const m = bar && bar.querySelector('.ncb-mute');
  return { barra: vis(bar), arriba: !!b && b.top <= 1 && b.height >= 40 && b.height <= 90, texto: bar ? bar.querySelector('.ncb-name').textContent : '',
    silenciar: !!m, silenciado: !!(m && m.classList.contains('ncb-on')), colgar: !!(bar && bar.querySelector('.ncb-hang')), pantalla_llamada: vis(one) || vis(grp),
    app_debajo: !!mid && !!app && app.contains(mid), app_baja: !!ab && !!b && ab.top < 1 && parseFloat(getComputedStyle(app).paddingTop) >= b.height - 1 };
});
// Captura solo de la pantalla de la llamada (lo de la app queda oculto un momento); keep: selectores que no se ocultan
async function shotOf(page, file, keep) {
  const k = (keep || ['#nexo-call-screen', '#nexo-gcall-screen']).map((s) => ':not(' + s + ')').join('');
  await page.evaluate((k) => document.querySelectorAll('body > *' + k).forEach((e) => { e.dataset.avv = e.style.visibility; e.style.visibility = 'hidden'; }), k);
  await page.screenshot({ path: file });
  await page.evaluate((k) => document.querySelectorAll('body > *' + k).forEach((e) => { e.style.visibility = e.dataset.avv || ''; }), k);
}

async function callHarness({ buildDir, names, shots }) {
  const dist = path.join(buildDir, 'dist');
  const logs = [], T0 = Date.now();
  const ts = () => String(((Date.now() - T0) / 1000).toFixed(1)).padStart(6) + 's';
  const browser = await PW.chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  async function boot(name, native) {
    const page = await browser.newPage({ viewport: { width: 384, height: 830 }, deviceScaleFactor: shots ? 2 : 1, isMobile: true, hasTouch: true });
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
  const radio = new Radio(), nat = {}, P = {}, id = {};
  names.forEach((n, i) => { const h = n.repeat(2); nat[n] = new NativePhone(n, [h, h, h, h, h, '0' + (i + 1)].join(':'), Object.assign({}, BASE)); radio.add(nat[n]); nat[n].load(); });
  for (const n of names) P[n] = await boot(n, nat[n]);
  for (const n of names) id[n] = await P[n].evaluate(() => String(window.bleInterface.localNexoId).toLowerCase());
  // Contacto entre x e y (escaneo y primer mensaje, con los demás fuera de alcance)
  async function pair(x, y) {
    const others = names.filter((n) => n !== x && n !== y);
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
  const lanOk = (x, y) => P[x].evaluate((nx) => !!window.bleInterface.calls.canVideo(nx) && !!(window.bleInterface.lan && window.bleInterface.lan.canReach(nx)), id[y]);
  async function wifiAll() {
    return waitFor(async () => { for (const x of names) for (const y of names) if (x !== y && !(await lanOk(x, y))) return false; return true; }, 60000);
  }
  // Llamada (vídeo o voz) de x a y; y contesta (o, con answerHidden, contesta con la app oculta, como desde el aviso)
  async function call(x, y, opt = {}) {
    await clickRowNamed(P[x], '#main-contacts-list .ble-contact-row', y); await sleep(500);
    await click(P[x], opt.voice ? '#nexo-call-btn' : '#nexo-video-btn');
    await closeChat(P[x]);
    if (opt.beforeAnswer) await opt.beforeAnswer();
    await waitFor(() => P[y].evaluate(() => !!(window.bleInterface.calls.call && window.bleInterface.calls.call.state === 'ringing')), 20000);
    if (opt.answerHidden) { await P[y].evaluate(() => window.__setHidden(true)); await sleep(300); await P[y].evaluate(() => window.bleInterface.calls.accept()); }
    else await click(P[y], '#nexo-call-screen .call-accept');
    return waitFor(async () => (await calls(P[x])).uno === 'active' && (await calls(P[y])).uno === 'active', 20000);
  }
  const hangAll = async () => {
    for (const n of names) await P[n].evaluate(() => { const bi = window.bleInterface; try { if (bi.calls.call) bi.calls.hangup(); } catch (e) {} try { if (bi.gcall.gc) { if (bi.gcall.gc.state === 'ringing') bi.gcall.reject(); else bi.gcall.hangup(); } } catch (e) {} });
    await waitFor(async () => { for (const n of names) { const c = await calls(P[n]); if (c.uno || c.grupo) return false; } return true; }, 15000);
    await sleep(2500);
  };
  return { browser, radio, nat, P, id, logs, pair, wifiAll, call, hangAll, close: () => browser.close() };
}

module.exports = { callHarness, click, waitFor, clickRowNamed, sendText, closeChat, calls, media1, shotOf, pipLook, barLook, sleep };
