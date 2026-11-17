// 3182 (dueño 17-11, jugando «Defensor NEXO»: «dependiendo de dónde pulso en la pantalla, ahí brincará mi navecita… puedo tocar
// directamente el contacto y salvarlo: es como hacer trampa, casi teletransportación»). Hasta la 3181 tocar ponía la nave EN el dedo
// y arrastrar la llevaba al instante a donde estuviera el dedo. Ahora se arrastra en relativo (tocar no la mueve) y vuela con
// velocidad máxima (SHIP_MAX_SPEED, 650 px/s).
// Chromium real (el juego dibuja en un lienzo): la posición de la nave se lee de su dibujo (el único moveTo del cuadro es la punta
// del triángulo), así la prueba vale igual con builds viejas (contraprueba) que no tienen gancho.
//  1. tocar lejos (arriba a la izquierda) NO mueve la nave;
//  2. arrastrar 100 px a la izquierda desde cualquier lado la mueve ~100 px a la izquierda (no salta al dedo);
//  3. un tirón de 250 px de golpe NO la teletransporta: a los ~50 ms avanzó poco y a los ~0,8 s ya llegó.
// Uso: node juegotrampa.js <dir_build>   (imprime JUEGOTRAMPA {json} con "resultado":"OK"|"FALLO"; sale 0/1)
'use strict';
const fs = require('fs');
const path = require('path');
const { PW, bootPhone, sleep } = require('./pw_harness');
const { Radio, NativePhone } = require('./native_mock');

const dist = path.resolve(process.argv[2], 'dist');
const logs = [];
const r = { prueba: 'juegotrampa', build: path.basename(process.argv[2]) };
const fin = (ok) => {
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('JUEGOTRAMPA ' + JSON.stringify(r));
  try { fs.writeFileSync(path.join(__dirname, 'last_logs_juegotrampa.txt'), logs.join('\n')); } catch (e) {}
};
const base = { readsContentFallback: true, retain: ['onPayloadReceived'], closeOnNoService: true, pace: [5, 5], ioDelay: 10, noTor: true, noL2: true };

(async () => {
  const browser = await PW.chromium.launch();
  try {
    const radio = new Radio();
    const native = new NativePhone('A', 'AA:AA:AA:AA:AA:01', Object.assign({}, base));
    radio.add(native); native.load();
    const page = (await bootPhone(browser, 'A', native, dist, { phone: true, logs, seedName: 'Ana', lang: 'es' })).page;
    // la nave es lo único que se dibuja con moveTo: su punta está 18 px arriba de su centro
    await page.evaluate(() => {
      const P = CanvasRenderingContext2D.prototype, mt = P.moveTo;
      P.moveTo = function(x, y) { window.__ship = { x: x, y: y + 18 }; return mt.call(this, x, y); };
    });
    await page.evaluate(() => window.__nexoOpenGame());
    await sleep(500);
    const rect = await page.evaluate(() => { const c = document.querySelector('#nexo-game-overlay canvas'); const b = c.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; });
    const ship = () => page.evaluate(() => window.__ship && { x: Math.round(window.__ship.x), y: Math.round(window.__ship.y) });
    const d = (a, b) => Math.round(Math.hypot(a.x - b.x, a.y - b.y));
    r.lienzo = rect;
    // empezar tocando justo sobre la nave (no la mueve en ninguna build)
    let p0 = await ship();
    await page.mouse.click(rect.x + p0.x, rect.y + p0.y);
    await sleep(400);
    p0 = await ship();
    // 1) tocar lejos
    await page.mouse.click(rect.x + 40, rect.y + 120);
    await sleep(400);
    const p1 = await ship();
    r.tocar_lejos = { antes: p0, despues: p1, movio_px: d(p0, p1) };
    // 2) arrastre relativo: 100 px a la izquierda desde la mitad derecha de la pantalla
    const sx = rect.x + rect.w - 60, sy = rect.y + rect.h / 2;
    await page.mouse.move(sx, sy); await page.mouse.down();
    for (let i = 1; i <= 10; i++) { await page.mouse.move(sx - i * 10, sy); await sleep(30); }
    await sleep(500);
    const p2 = await ship();
    await page.mouse.up();
    r.arrastre = { antes: p1, despues: p2, dx: p2.x - p1.x, dy: p2.y - p1.y };
    // 3) tirón de 250 px de golpe (hacia la derecha, dentro de la pantalla)
    await sleep(200);
    const p3 = await ship();
    const tx = rect.x + 30, ty = rect.y + rect.h / 2;
    const jump = Math.min(250, Math.round(rect.w - 16 - p3.x) - 2);
    await page.mouse.move(tx, ty); await page.mouse.down();
    await page.mouse.move(tx + jump, ty);
    await sleep(50);
    const p4 = await ship();
    await sleep(800);
    const p5 = await ship();
    await page.mouse.up();
    r.tiron = { pedido_px: jump, antes: p3, a_50ms: p4, a_850ms: p5, avanzo_50ms: p4.x - p3.x, avanzo_850ms: p5.x - p3.x };
    await page.context().close();
  } catch (e) {
    r.error = (e && e.stack || String(e)).substring(0, 400);
  }
  await browser.close().catch(() => {});
  const t = r.tiron || {}, a = r.arrastre || {}, tl = r.tocar_lejos || {};
  r.ok = {
    tocar_lejos_no_mueve: typeof tl.movio_px === 'number' && tl.movio_px <= 6,
    arrastre_relativo_100px: typeof a.dx === 'number' && Math.abs(a.dx + 100) <= 14 && Math.abs(a.dy) <= 14,
    tiron_sin_teletransporte: typeof t.avanzo_50ms === 'number' && t.avanzo_50ms < t.pedido_px * 0.5,
    tiron_llega: typeof t.avanzo_850ms === 'number' && Math.abs(t.avanzo_850ms - t.pedido_px) <= 8,
  };
  r.errores = logs.filter((l) => /PAGEERROR|Uncaught/.test(l)).slice(0, 5);
  const ok = !r.error && Object.values(r.ok).every(Boolean) && !r.errores.length;
  fin(ok);
  process.exit(ok ? 0 : 1);
})().catch((e) => { r.error = e && e.stack; fin(false); process.exit(1); });
