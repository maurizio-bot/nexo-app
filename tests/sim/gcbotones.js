// 3092 (tras el pedido del dueño 14-11 sobre la videollamada 1-a-1: «los botones de abajo quedan muy anchos y el de colgar ni se
// ve»): la llamada de GRUPO tenía botones de texto de 120 px que, con vídeo, en un teléfono de 360–412 de ancho ocupaban 4 filas
// (248 px de 778, casi un tercio de la pantalla). Ahora, la misma fila de círculos con nombre que la 1-a-1. En Chromium, la pantalla
// de la llamada de grupo activa con vídeo y los 7 botones (Silenciado, Agregar, Cámara no, Girar, Pantalla, Altavoz, Colgar), en
// español e italiano, a 360, 384 y 412 de ancho:
//  G1  una sola fila, que cabe en la pantalla, sin botones que se pisen;
//  G2  colgar se ve entero;
//  G3  círculos de 40 px o más y los nombres enteros (letra ≥ 8 px).
// Uso: node gcbotones.js <dir_build>   (GC_SHOTS=<carpeta>: capturas)
'use strict';
const fs = require('fs');
const path = require('path');
const PW = (() => { try { return require('playwright'); } catch (e) { return require('/opt/node22/lib/node_modules/playwright'); } })();

const buildDir = path.resolve(process.argv[2]);
const dist = path.join(buildDir, 'dist');
const TYPES = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json', '.woff2': 'font/woff2' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const r = { prueba: 'gcbotones', build: path.basename(buildDir), casos: {} };
  const browser = await PW.chromium.launch();
  const errs = [];
  for (const [lang, w] of [['es', 360], ['es', 384], ['es', 412], ['it', 360], ['it', 384]]) {
    const page = await browser.newPage({ viewport: { width: w, height: Math.round(w * 2.16) }, isMobile: true, hasTouch: true });
    page.on('pageerror', (e) => errs.push(e.message));
    await page.route('https://a.nexo.test/**', (route) => {
      const f = path.join(dist, decodeURIComponent(new URL(route.request().url()).pathname));
      if (fs.existsSync(f) && fs.statSync(f).isFile()) route.fulfill({ body: fs.readFileSync(f), contentType: TYPES[path.extname(f)] || 'application/octet-stream' });
      else route.fulfill({ status: 404, body: '' });
    });
    await page.addInitScript((l) => { window.NEXO_FORCE_LANG = l; }, lang);
    await page.goto('https://a.nexo.test/index.html').catch(() => {});
    await page.waitForFunction(() => window.NEXO && window.NEXO.initialized, null, { timeout: 20000 }).catch(() => {});
    await sleep(1200);
    const k = lang + ' ' + w;
    r.casos[k] = await page.evaluate(() => {
      const bi = window.bleInterface;
      if (!bi) return { error: 'sin bleInterface' };
      // llamada de grupo de prueba (la lógica real no hace falta: solo se mira la pantalla)
      bi.gcall = { state: () => null, shareScreen: () => Promise.resolve(true), mute() {}, camera() {}, flip() {}, hangup() {}, addMember: () => Promise.resolve(), videoViews: () => ({}) };
      const me = String(bi.localNexoId || 'nx00000000').toLowerCase();
      const st = { state: 'active', gid: 'gc123', members: [me, 'nx11111111', 'nx22222222'], legs: [{ nx: 'nx11111111', state: 'active' }, { nx: 'nx22222222', state: 'active' }], muted: true, cameraOn: true, screen: false };
      window.dispatchEvent(new CustomEvent('nexo:gcall', { detail: st }));
      const el = document.getElementById('nexo-gcall-screen');
      if (!el) return { error: 'sin pantalla de grupo' };
      const W = innerWidth, H = innerHeight;
      const bs = Array.from(el.querySelectorAll('.gc-buttons button'));
      const rs = bs.map((b) => b.getBoundingClientRect());
      const filas = new Set(rs.map((x) => Math.round(x.top))).size;
      const pisan = rs.some((a, i) => i > 0 && Math.round(a.top) === Math.round(rs[i - 1].top) && a.left < rs[i - 1].right - 0.5);
      const hang = bs[bs.length - 1];
      const hr = (hang.querySelector('.nc-ic') || hang).getBoundingClientRect();
      const labs = bs.map((b) => b.querySelector('span:last-child')).filter(Boolean);
      const ancho = (l) => { const rg = document.createRange(); rg.selectNodeContents(l); return rg.getBoundingClientRect().width; };
      const cortados = labs.filter((l) => ancho(l) > l.getBoundingClientRect().width + 0.05).map((l) => l.textContent);
      const ics = bs.map((b) => b.querySelector('.nc-ic')).filter(Boolean).map((x) => x.getBoundingClientRect().width);
      return {
        botones: bs.map((b) => b.textContent).join(' · '), n: bs.length, filas, alto_barra: Math.round(el.querySelector('.gc-buttons').getBoundingClientRect().height),
        caben: rs.every((x) => x.left >= -0.5 && x.right <= W + 0.5 && x.bottom <= H + 0.5) && !pisan,
        colgar_visible: /Colgar|Termina/.test(hang.textContent) && hr.left >= 0 && hr.right <= W && hr.top >= 0 && hr.bottom <= H,
        circulo_min: ics.length === bs.length ? Math.round(Math.min(...ics)) : 0,
        letra_min: labs.length ? Math.min(...labs.map((l) => parseFloat(getComputedStyle(l).fontSize))) : 0,
        nombres_cortados: cortados,
      };
    });
    if (process.env.GC_SHOTS) {
      await page.evaluate(() => document.querySelectorAll('body > *:not(#nexo-gcall-screen)').forEach((e) => { e.style.visibility = 'hidden'; }));
      await page.screenshot({ path: path.join(process.env.GC_SHOTS, 'gc_' + lang + '_' + w + '.png') });
    }
    await page.close();
  }
  await browser.close();
  r.errores = errs.slice(0, 5);
  const ok = Object.values(r.casos).every((c) => !c.error && c.n >= 7 && c.filas === 1 && c.caben && c.colgar_visible && c.circulo_min >= 40 && c.letra_min >= 8 && !c.nombres_cortados.length) && !r.errores.length;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('GCBOTONES ' + JSON.stringify(r));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('GCBOTONES ' + JSON.stringify({ prueba: 'gcbotones', resultado: 'FALLO', error: String(e && e.message) })); process.exit(1); });
