// Arnés común para pruebas en Chromium real (Playwright): cada teléfono es una página con la app
// real; el plugin NexoBLE se puentea al simulador nativo en Node (native_mock.js).
// Incluye sondas de rendimiento: lag del hilo de la interfaz, tareas largas y métricas de CPU (CDP).
'use strict';
const fs = require('fs');
const path = require('path');
const PW = (() => { try { return require('playwright'); } catch (e) { return require('/opt/node22/lib/node_modules/playwright'); } })();

const TYPES = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json', '.woff2': 'font/woff2' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// opts: { cpuThrottle, logs: [] , quiet }
async function bootPhone(browser, name, native, dist, opts = {}) {
  const page = await browser.newPage();
  const logs = opts.logs || [];
  page.on('console', (m) => { if (!opts.quiet) logs.push(`${new Date().toISOString().substring(14, 23)} [${name}] ${m.text()}`.substring(0, 300)); });
  page.on('pageerror', (e) => logs.push(`[${name}] PAGEERROR ${e.message}`));
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
    // Sondas: lag del hilo (temporizador de 50 ms) y tareas largas (>50 ms)
    window.__perf = { lags: [], longs: [] };
    let last = performance.now();
    setInterval(() => { const now = performance.now(); window.__perf.lags.push(Math.max(0, now - last - 50)); last = now; }, 50);
    try { new PerformanceObserver((l) => l.getEntries().forEach((e) => window.__perf.longs.push(e.duration))).observe({ entryTypes: ['longtask'] }); } catch (e) {}
  }, methods);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  if (opts.cpuThrottle) await cdp.send('Emulation.setCPUThrottlingRate', { rate: opts.cpuThrottle });
  const t0 = Date.now();
  await page.goto('https://' + name.toLowerCase() + '.nexo.test/index.html');
  await page.waitForFunction(() => window.NEXO && window.NEXO.initialized, null, { timeout: 60000 });
  const bootMs = Date.now() - t0;
  await sleep(800);
  return { name, page, native, cdp, bootMs };
}

async function cdpMetrics(phone) {
  const r = await phone.cdp.send('Performance.getMetrics');
  const m = {}; r.metrics.forEach((x) => { m[x.name] = x.value; }); return m;
}

// Inicio de fase: reinicia sondas y toma métricas de CPU
async function phaseStart(phones) {
  const snap = {};
  for (const p of phones) {
    await p.page.evaluate(() => { window.__perf.lags = []; window.__perf.longs = []; });
    snap[p.name] = await cdpMetrics(p);
  }
  return { t0: Date.now(), snap };
}
// Fin de fase: lag p50/p95/max, tareas largas, CPU (s de hilo principal y % del tiempo de pared)
async function phaseEnd(phones, start) {
  const wall = (Date.now() - start.t0) / 1000;
  const out = { segundos: Math.round(wall * 10) / 10 };
  for (const p of phones) {
    const pf = await p.page.evaluate(() => ({ lags: window.__perf.lags.slice(), longs: window.__perf.longs.slice() }));
    const m = await cdpMetrics(p), s = start.snap[p.name];
    const lags = pf.lags.sort((a, b) => a - b);
    const q = (x) => lags.length ? Math.round(lags[Math.min(lags.length - 1, Math.floor(lags.length * x))]) : 0;
    const task = m.TaskDuration - s.TaskDuration;
    out[p.name] = {
      cpu_s: Math.round(task * 100) / 100, cpu_pct: Math.round(task / wall * 100),
      js_s: Math.round((m.ScriptDuration - s.ScriptDuration) * 100) / 100,
      layout_estilo_s: Math.round(((m.LayoutDuration - s.LayoutDuration) + (m.RecalcStyleDuration - s.RecalcStyleDuration)) * 100) / 100,
      lag_p50: q(0.5), lag_p95: q(0.95), lag_max: lags.length ? Math.round(lags[lags.length - 1]) : 0,
      largas: pf.longs.length, largas_ms: Math.round(pf.longs.reduce((a, b) => a + b, 0)),
      heap_MB: Math.round(m.JSHeapUsedSize / 1048576),
    };
  }
  return out;
}

const click = (page, sel) => page.evaluate((s) => { const el = document.querySelector(s); if (el) el.dispatchEvent(new MouseEvent('click', { bubbles: true })); return !!el; }, sel);

module.exports = { PW, bootPhone, cdpMetrics, phaseStart, phaseEnd, click, sleep };
