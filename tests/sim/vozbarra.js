// 3186 (revisión de botones 3181, 17-11): mientras se graba una nota de voz MANTENIENDO el micrófono y sale la pista «‹ Desliza para
// cancelar» (3143), la barra de grabación se ensanchaba más que la pantalla (415 px en español) y cortaba por los lados 🗑 y ➤
// (se veía en las capturas de pressall.js a 360 px).
// Chromium real con toques de verdad por CDP, A emparejado con B, en los 5 idiomas de la app (es, it, en, pt, fr) y a 360 y 320 px
// de ancho: se mantiene el micrófono (graba), se desliza 60 px a la izquierda (sale la pista) y luego 90 px (pista en rojo), y en
// los dos momentos se mira la barra:
//  B1 cabe en la pantalla (sus bordes dentro de 0…ancho) y no desborda (scrollWidth ≤ clientWidth);
//  B2 🗑, ⏸, ➤ (40 px) y el tiempo se ven ENTEROS, dentro de la barra y de la pantalla, sin pisarse, el tiempo sin cortar, y en
//     el centro de cada botón el que recibe el toque es él (elementFromPoint);
//  B3 la pista se ve (≥ 40 px de ancho, dentro de la barra) con el texto de su idioma (puede ir en dos líneas y acortarse con «…»);
//  y los gestos siguen como en 3143/3145: deslizar más de 100 px cancela (la barra se va y no se envía nada) y mantener, deslizar un
//  poco y soltar envía la nota.
// Contraprueba cce7565c (b3185): FALLO en los 10 casos (a 360 la barra va de -28 a 388 px en español; 🗑 y ➤ fuera de la pantalla en
// es, it, pt y fr, y en inglés a 320; en inglés a 360 se pasa 6 px).
// Uso: node vozbarra.js <dir_build>      (VOZBARRA_SHOTS=<carpeta>: captura a escala 1 de la barra con la pista, por idioma y ancho)
'use strict';
const fs = require('fs');
const path = require('path');
if (!process.env.SHOTS_VIEWPORT) process.env.SHOTS_VIEWPORT = '360x740';
const { PW, bootPhone, sleep } = require('./pw_harness');
const { Radio, NativePhone } = require('./native_mock');

const buildDir = path.resolve(process.argv[2]);
const dist = path.join(buildDir, 'dist');
const shots = process.env.VOZBARRA_SHOTS ? path.resolve(process.env.VOZBARRA_SHOTS) : '';
const LANGS = ['es', 'it', 'en', 'pt', 'fr'];
const WIDTHS = [360, 320];
const H = 740;
const logs = [];
const r = { prueba: 'vozbarra', build: path.basename(buildDir), casos: {} };
const fin = (ok) => {
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('VOZBARRA ' + JSON.stringify(r));
  try { fs.writeFileSync(path.join(__dirname, 'last_logs_vozbarra.txt'), logs.join('\n')); } catch (e) {}
};
// El texto de la pista en cada idioma, tal cual está en la build que se prueba
const hintText = (lang) => {
  try { const m = /voice_slide_cancel:\s*"([^"]+)"/.exec(fs.readFileSync(path.join(buildDir, 'src', 'ui', 'i18n', lang + '.js'), 'utf8')); return m ? m[1] : ''; } catch (e) { return ''; }
};

// Medida de la barra (dentro de la página)
function medir() {
  const W = document.documentElement.clientWidth;
  const bar = document.getElementById('voice-bar');
  if (!bar || bar.style.display === 'none') return { error: 'sin barra' };
  const q = (el) => { const b = el.getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top, b: b.bottom, w: b.width, h: b.height }; };
  const R = (x) => Math.round(x * 10) / 10;
  const br = q(bar);
  const out = { ancho_pantalla: W, barra: { izq: R(br.l), der: R(br.r), ancho: R(br.w) }, scroll: bar.scrollWidth, client: bar.clientWidth };
  out.B1 = br.l >= -0.5 && br.r <= W + 0.5 && bar.scrollWidth <= bar.clientWidth;
  // 🗑 · tiempo · ⏸ · ➤ (y el punto rojo): enteros, dentro de la barra y de la pantalla, tocables
  const ids = ['voice-cancel', 'voice-dot', 'voice-time', 'voice-pause', 'voice-send'];
  const piezas = {}; const malos = [];
  ids.forEach((id) => {
    const el = document.getElementById(id);
    if (!el) { malos.push(id + ' no está'); return; }
    const b = q(el);
    const p = { izq: R(b.l), der: R(b.r), ancho: R(b.w) };
    const dentro = b.l >= Math.max(0, br.l) - 0.5 && b.r <= Math.min(W, br.r) + 0.5 && b.t >= -0.5 && b.b <= innerHeight + 0.5;
    if (!dentro) malos.push(id + ' fuera');
    if (el.tagName === 'BUTTON' && b.w < 39.5) malos.push(id + ' encogido ' + R(b.w));
    if (id === 'voice-time' && el.scrollWidth > el.clientWidth) malos.push(id + ' cortado');
    if (id !== 'voice-dot') {
      const cx = Math.min(Math.max(b.l + b.w / 2, 0), W - 1), cy = b.t + b.h / 2;
      const hit = document.elementFromPoint(cx, cy);
      p.toque = !!hit && (hit === el || el.contains(hit));
      if (!p.toque) malos.push(id + ' no recibe el toque' + (hit ? ' (' + (hit.id || hit.tagName) + ')' : ''));
    }
    piezas[id] = p;
  });
  // sin pisarse (en el orden de la barra, solo lo que se ve)
  const vis = Array.from(bar.children).filter((c) => getComputedStyle(c).display !== 'none');
  for (let i = 1; i < vis.length; i++) { const a = q(vis[i - 1]), b = q(vis[i]); if (b.l < a.r - 0.5) malos.push((vis[i - 1].id || '?') + ' pisa ' + (vis[i].id || '?')); }
  out.piezas = piezas;
  out.B2 = !malos.length;
  out.malos = malos;
  const h = document.getElementById('voice-slide-hint');
  if (h && getComputedStyle(h).display !== 'none') {
    const b = q(h);
    const lh = parseFloat(getComputedStyle(h).lineHeight) || parseFloat(getComputedStyle(h).fontSize) * 1.2;
    out.pista = { texto: h.textContent, ancho: R(b.w), lineas: Math.max(1, Math.round(h.clientHeight / lh)), acortada: h.scrollWidth > h.clientWidth + 0.5 || h.scrollHeight > h.clientHeight + 0.5, letra: getComputedStyle(h).fontSize, color: getComputedStyle(h).color };
    out.B3_dentro = b.w >= 40 && b.l >= br.l - 0.5 && b.r <= br.r + 0.5;
  } else { out.pista = null; out.B3_dentro = false; }
  return out;
}

(async () => {
  const browser = await PW.chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  const radio = new Radio();
  const opts = { readsContentFallback: true, retain: ['onPayloadReceived'], closeOnNoService: true, pace: [5, 5], ioDelay: 10, asymmetric: true, noTor: true };
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', opts), nB = new NativePhone('B', 'BB:BB:BB:BB:BB:02', opts);
  radio.add(nA); radio.add(nB); nA.load(); nB.load();
  // A sin idioma fijo en el arnés (se pone por localStorage antes de cada recarga, como al cambiarlo en Ajustes)
  const phA = await bootPhone(browser, 'A', nA, dist, { phone: true, logs, seedName: 'Ana' });
  const phB = await bootPhone(browser, 'B', nB, dist, { phone: true, logs, seedName: 'Beto', lang: 'es' });
  const A = phA.page, cdp = phA.cdp;
  await A.context().grantPermissions(['microphone', 'camera']).catch(() => {});
  const ev = (fn, arg) => A.evaluate(fn, arg);
  const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: (type === 'touchEnd' || type === 'touchCancel') ? [] : [{ x, y }] });
  const barOn = () => ev(() => { const v = document.getElementById('voice-bar'); return !!v && v.style.display !== 'none'; });
  const nMsgs = () => ev(() => document.querySelectorAll('#messages-container .message').length);

  // ---------- A y B emparejados (como pressall.js) ----------
  await ev(() => window.bleInterface.togglePanel());
  for (let i = 0; i < 100; i++) { await sleep(150); if (await ev(() => !!document.querySelector('#ble-new-device button'))) break; await ev(() => { if (!window.bleInterface.isScanning) { const b = document.getElementById('ble-scan-btn'); if (b) b.click(); } }); }
  await ev(() => { const b = document.querySelector('#ble-new-device button'); if (b) b.click(); }); await sleep(1800);
  await ev(() => { if (document.getElementById('ble-panel').classList.contains('active')) window.bleInterface.togglePanel(); });
  for (let i = 0; i < 60; i++) { if (await ev(() => !!document.querySelector('#main-contacts-list .ble-contact-row'))) break; await sleep(250); }
  r.preparado = await ev(() => !!document.querySelector('#main-contacts-list .ble-contact-row'));

  const todos = [];
  for (const lang of LANGS) {
    // el idioma: se guarda y se recarga (lo mismo que hace Ajustes → Idioma)
    await ev((l) => localStorage.setItem('nexo_lang', l), lang);
    await A.reload();
    await A.waitForFunction(() => window.NEXO && window.NEXO.initialized, null, { timeout: 60000 });
    await sleep(1000);
    await A.context().grantPermissions(['microphone', 'camera']).catch(() => {});
    for (let i = 0; i < 60; i++) { if (await ev(() => !!document.querySelector('#main-contacts-list .ble-contact-row'))) break; await sleep(250); }
    await ev(() => { const row = document.querySelector('#main-contacts-list .ble-contact-row'); if (row) row.click(); });
    await sleep(1200);
    const esperado = hintText(lang);
    for (const w of WIDTHS) {
      const k = lang + ' ' + w;
      const c = { idioma_app: await ev(() => localStorage.getItem('nexo_lang')) };
      r.casos[k] = c;
      await A.setViewportSize({ width: w, height: H });
      await sleep(500);
      await ev(() => { const i = document.getElementById('message-input'); if (i) { i.value = ''; i.dispatchEvent(new Event('input', { bubbles: true })); i.blur(); } });
      await sleep(200);
      const mic = await ev(() => { const b = document.getElementById('send-btn'); if (!b) return null; const q = b.getBoundingClientRect(); return { mic: b.classList.contains('mic-mode'), cx: q.left + q.width / 2, cy: q.top + q.height / 2 }; });
      if (!mic || !mic.mic) { c.error = 'sin micrófono'; todos.push(c); continue; }

      // 1) mantener (graba), deslizar 60 px (sale la pista), 90 px (en rojo), y más de 100 px: cancela sin enviar
      const antes = await nMsgs();
      await touch('touchStart', mic.cx, mic.cy);
      let on = false; for (let i = 0; i < 40 && !on; i++) { await sleep(100); on = await barOn(); }
      c.graba = on;
      await sleep(300);
      for (let i = 1; i <= 6; i++) { await sleep(30); await touch('touchMove', mic.cx - 10 * i, mic.cy); }
      await sleep(250);
      c.pista_60 = await ev(medir);
      for (let i = 7; i <= 9; i++) { await sleep(30); await touch('touchMove', mic.cx - 10 * i, mic.cy); }
      await sleep(250);
      c.pista_90 = await ev(medir);
      if (shots) {
        fs.mkdirSync(shots, { recursive: true });
        const top = await ev(() => { const v = document.getElementById('voice-bar'); return v ? Math.max(0, Math.floor(v.getBoundingClientRect().top) - 16) : 560; });
        await A.screenshot({ path: path.join(shots, r.build + '_' + lang + '_' + w + '.png'), clip: { x: 0, y: top, width: w, height: Math.min(H - top, 150) }, scale: 'css' });
      }
      for (let i = 10; i <= 14; i++) { await sleep(30); await touch('touchMove', mic.cx - 10 * i, mic.cy); }
      let fuera = false; for (let i = 0; i < 20 && !fuera; i++) { await sleep(100); fuera = !(await barOn()); }
      await touch('touchEnd');
      await sleep(1500);
      c.deslizar_cancela = fuera;
      c.cancela_no_envia = (await nMsgs()) === antes;

      // 2) mantener, deslizar un poco (sale la pista) y soltar: se envía la nota (3145)
      const antes2 = await nMsgs();
      await touch('touchStart', mic.cx, mic.cy);
      on = false; for (let i = 0; i < 40 && !on; i++) { await sleep(100); on = await barOn(); }
      for (let i = 1; i <= 5; i++) { await sleep(30); await touch('touchMove', mic.cx - 10 * i, mic.cy); }
      await sleep(900);
      const m3 = await ev(medir);
      await touch('touchEnd');
      let enviada = false; for (let i = 0; i < 40 && !enviada; i++) { await sleep(150); enviada = (await nMsgs()) > antes2 && !(await barOn()); }
      c.soltar_envia = on && enviada;
      await sleep(600);

      const ok1 = (m) => !!m && !m.error && m.B1 && m.B2 && m.B3_dentro && !!m.pista && m.pista.texto === esperado;
      c.B1 = !!(c.pista_60.B1 && c.pista_90.B1 && m3.B1);
      c.B2 = !!(c.pista_60.B2 && c.pista_90.B2 && m3.B2);
      c.B3 = !!(c.pista_60.B3_dentro && c.pista_90.B3_dentro && c.pista_60.pista && c.pista_60.pista.texto === esperado);
      c.ok = c.idioma_app === lang && c.graba && ok1(c.pista_60) && ok1(c.pista_90) && ok1(m3) && c.deslizar_cancela && c.cancela_no_envia && c.soltar_envia;
      todos.push(c);
      const p = c.pista_60;
      console.log(k.padEnd(7), c.ok ? 'ok ' : 'MAL', JSON.stringify({ barra: p.barra, pantalla: p.ancho_pantalla, scroll: p.scroll + '/' + p.client, pista: p.pista, malos: p.malos, B1: c.B1, B2: c.B2, B3: c.B3, cancela: c.deslizar_cancela && c.cancela_no_envia, envia: c.soltar_envia }));
    }
  }
  // en el resultado, por caso, lo esencial
  const resumen = {};
  for (const [k, c] of Object.entries(r.casos)) {
    const p = c.pista_60 || {};
    resumen[k] = { ok: !!c.ok, barra: p.barra && (p.barra.izq + '…' + p.barra.der), pista: p.pista && (p.pista.lineas + ' línea(s)' + (p.pista.acortada ? ', acortada' : '') + ', ' + p.pista.ancho + ' px'), malos: p.malos, B1: c.B1, B2: c.B2, B3: c.B3, cancela: c.deslizar_cancela && c.cancela_no_envia, envia: c.soltar_envia, error: c.error };
  }
  r.casos = resumen;
  r.n = todos.length;
  r.malos = Object.entries(resumen).filter(([, v]) => !v.ok).map(([k]) => k);
  await browser.close();
  fin(r.preparado && r.n === LANGS.length * WIDTHS.length && !r.malos.length);
  process.exit(r.resultado === 'OK' ? 0 : 1);
})().catch((e) => { console.log('VOZBARRA ' + JSON.stringify({ prueba: 'vozbarra', resultado: 'FALLO', error: String(e && e.stack || e) })); process.exit(1); });
