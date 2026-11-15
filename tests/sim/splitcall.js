// #220 fase 1 (dueño 15-11: «al final estaba en dos llamadas diferentes al mismo tiempo… hay que hacer un arreglo de pantalla
// donde se puedan ver las dos pantallas al mismo tiempo, la pantalla dividida y con sus respectivos botones»). Con una llamada
// 1-a-1 y una de grupo a la vez, la pantalla de la 1-a-1 tapaba entera la de grupo. En Chromium (360, 384 y 412 de ancho), una
// videollamada 1-a-1 activa y una llamada de grupo activa a la vez:
//  S1  se ven las dos: la 1-a-1 arriba y la de grupo abajo, sin taparse (cada una en su mitad);
//  S2  cada una con sus botones dentro de su mitad y su «Colgar» entero a la vista;
//  S3  al colgar una, la otra vuelve a ocupar toda la pantalla.
// Uso: node splitcall.js <dir_build>   (SPLIT_SHOTS=<carpeta>: capturas)
'use strict';
const fs = require('fs');
const path = require('path');
const PW = (() => { try { return require('playwright'); } catch (e) { return require('/opt/node22/lib/node_modules/playwright'); } })();

const buildDir = path.resolve(process.argv[2]);
const dist = path.join(buildDir, 'dist');
const TYPES = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json', '.woff2': 'font/woff2' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const r = { prueba: 'splitcall', build: path.basename(buildDir), casos: {} };
  const browser = await PW.chromium.launch();
  const errs = [];
  for (const w of [360, 384, 412]) {
    const page = await browser.newPage({ viewport: { width: w, height: Math.round(w * 2.16) }, isMobile: true, hasTouch: true });
    page.on('pageerror', (e) => errs.push(e.message));
    await page.route('https://a.nexo.test/**', (route) => {
      const f = path.join(dist, decodeURIComponent(new URL(route.request().url()).pathname));
      if (fs.existsSync(f) && fs.statSync(f).isFile()) route.fulfill({ body: fs.readFileSync(f), contentType: TYPES[path.extname(f)] || 'application/octet-stream' });
      else route.fulfill({ status: 404, body: '' });
    });
    await page.addInitScript(() => { window.NEXO_FORCE_LANG = 'es'; });
    await page.goto('https://a.nexo.test/index.html').catch(() => {});
    await page.waitForFunction(() => window.NEXO && window.NEXO.initialized, null, { timeout: 20000 }).catch(() => {});
    await sleep(1200);
    const medir = () => page.evaluate(() => {
      const W = innerWidth, H = innerHeight;
      const box = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { top: Math.round(b.top), bottom: Math.round(b.bottom), left: Math.round(b.left), right: Math.round(b.right) }; };
      const one = document.getElementById('nexo-call-screen'), grp = document.getElementById('nexo-gcall-screen');
      const vis = (el) => !!el && getComputedStyle(el).display !== 'none' && getComputedStyle(el).visibility !== 'hidden';
      const hang = (scr, sel) => { const b = scr && scr.querySelector(sel); return b ? box(b.querySelector('.nc-ic') || b) : null; };
      const btnsIn = (scr, sel) => { if (!scr) return null; const s = scr.getBoundingClientRect(); return Array.from(scr.querySelectorAll(sel)).every((b) => { const x = b.getBoundingClientRect(); return x.top >= s.top - 0.5 && x.bottom <= s.bottom + 0.5 && x.left >= -0.5 && x.right <= W + 0.5; }); };
      // ¿se puede tocar? lo que hay en el centro del botón es el propio botón (no la otra pantalla encima)
      const tocable = (scr, sel) => { const b = scr && scr.querySelector(sel); if (!b) return false; const x = b.getBoundingClientRect(); const el = document.elementFromPoint(x.left + x.width / 2, x.top + x.height / 2); return !!el && b.contains(el); };
      return { W, H, uno: vis(one) ? box(one) : null, grupo: vis(grp) ? box(grp) : null,
        tocar_colgar_uno: tocable(one, '.call-hangup'), tocar_colgar_grupo: tocable(grp, '.call-hangup'),
        colgar_uno: hang(one, '.call-hangup'), colgar_grupo: hang(grp, '.call-hangup'),
        botones_uno_dentro: btnsIn(one, '.call-buttons .nc-btn'), botones_grupo_dentro: btnsIn(grp, '.gc-buttons button') };
    });
    await page.evaluate(() => {
      const bi = window.bleInterface;
      const me = String(bi.localNexoId || 'nx00000000').toLowerCase();
      // llamada de grupo y 1-a-1 de prueba (solo se mira la pantalla)
      bi.gcall = { state: () => null, shareScreen: () => Promise.resolve(true), mute() {}, camera() {}, flip() {}, hangup() {}, addMember: () => Promise.resolve(), videoViews: () => ({}) };
      const st1 = { state: 'active', id: 'c1', nx: 'nx33333333', video: true, startedAt: Date.now() - 20000, muted: false, cameraOff: false, camState: 'on', micState: 'on', speaker: true, facing: 'user' };
      bi.calls = Object.assign(bi.calls || {}, { call: { nx: st1.nx, state: 'active' }, state: () => st1, _link: () => 'lan:nx33333333', hangup() {}, mute() {}, camera() {}, flipCamera() {}, shareScreen: () => Promise.resolve(true), videoViews: () => ({}), remoteVideoLive: () => false, askCamPermission() {} });
      window.dispatchEvent(new CustomEvent('nexo:call', { detail: st1 }));
      const st = { state: 'active', gid: 'gc123', members: [me, 'nx11111111', 'nx22222222'], legs: [{ nx: 'nx11111111', state: 'active' }, { nx: 'nx22222222', state: 'active' }], muted: false, cameraOn: true, screen: false };
      window.dispatchEvent(new CustomEvent('nexo:gcall', { detail: st }));
    });
    await sleep(600);
    const m = await medir();
    const k = 'ancho ' + w;
    const dentro = (b) => !!b && b.left >= 0 && b.right <= m.W && b.top >= 0 && b.bottom <= m.H;
    const c = { dos: m };
    c.S1_se_ven_las_dos = !!(m.uno && m.grupo && m.uno.bottom <= m.grupo.top + 1 && m.uno.top >= -1 && m.grupo.bottom <= m.H + 1 && (m.uno.bottom - m.uno.top) > m.H * 0.3 && (m.grupo.bottom - m.grupo.top) > m.H * 0.3);
    c.S2_botones = !!(m.botones_uno_dentro && m.botones_grupo_dentro && dentro(m.colgar_uno) && dentro(m.colgar_grupo) && m.tocar_colgar_uno && m.tocar_colgar_grupo &&
      m.colgar_uno.bottom <= m.uno.bottom + 1 && m.colgar_grupo.top >= m.grupo.top - 1);
    if (process.env.SPLIT_SHOTS) {
      await page.evaluate(() => document.querySelectorAll('body > *:not(#nexo-call-screen):not(#nexo-gcall-screen)').forEach((e) => { e.style.visibility = 'hidden'; }));
      await page.screenshot({ path: path.join(process.env.SPLIT_SHOTS, 'split_' + w + '.png') });
    }
    // S3: cuelga la 1-a-1: la de grupo vuelve a toda la pantalla
    await page.evaluate(() => { const bi = window.bleInterface; bi.calls.call = null; bi.calls.state = () => null; window.dispatchEvent(new CustomEvent('nexo:call', { detail: { state: 'ended', reason: 'hangup', nx: 'nx33333333' } })); });
    await sleep(2000);
    const m3 = await medir();
    c.S3_grupo_entera = !!(m3.grupo && m3.grupo.top <= 1 && m3.grupo.bottom >= m3.H - 1 && !m3.uno);
    r.casos[k] = c;
    await page.close();
  }
  await browser.close();
  r.errores = errs.slice(0, 5);
  const ok = Object.values(r.casos).every((c) => c.S1_se_ven_las_dos && c.S2_botones && c.S3_grupo_entera) && !r.errores.length;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('SPLITCALL ' + JSON.stringify(r));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('SPLITCALL ' + JSON.stringify({ prueba: 'splitcall', resultado: 'FALLO', error: String(e && e.message) })); process.exit(1); });
