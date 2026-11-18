// 3230 — LOS ESTADOS COMO TIKTOK (dueño 17-11 23:40: «la escrita de "mi estado" va debajo de mi círculo… los contactos no deben estar
// en vertical, deben estar en horizontal al lado de mi círculo… no quiero tener que apretar un estado: a toda pantalla y se reproduce en
// automático al entrar; si yo no puse estado aparece el más viejo… al deslizar de abajo hacia arriba aparece el que sigue… cada estado
// que vea hace que el círculo pase de azul a blanco… doble tap para me gusta, deslizo horizontal si hay más de uno del mismo contacto…
// quitas los botones… el cuadro gris con el triángulo de play se debe eliminar… fotos y videos del tamaño total de la pantalla»).
// Chromium real a 360×740, toques de verdad por CDP. A (Ana) ve; B (Beto) publica un VIDEO y luego una FOTO; C (Carla), después, un
// texto con enlace.
//  T1  arriba, los círculos DE LADO en una fila: el mío primero con «Mi estado» DEBAJO del círculo; B y C con aro azul (sin ver)
//  T2  sin tocar nada, el estado se ve a TODA la pantalla (el estado y su video miden lo que la pantalla) y no hay ningún botón
//  T3  como yo no tengo estado, empieza por el MÁS VIEJO (el video de B)
//  T4  el video se reproduce SOLO, sin la portada gris del sistema (portada transparente)
//  T5  deslizar de lado → el otro estado de B (la foto, a toda la pantalla); el video queda en pausa
//  T6  vistos los dos de B, su aro pasa a BLANCO; el de C sigue azul
//  T7  deslizar de abajo hacia arriba → el estado de C (el texto con su enlace tocable)
//  T8  dos toques → me gusta (le llega a C; sale el corazón)
//  T9  de vuelta al video de B (abajo y de lado): un toque lo pausa; otro lo sigue
//  T10 publico uno: al salir y volver a entrar, el primero es EL MÍO a toda la pantalla (y mi círculo con aro)
//  T11 en el primero, deslizar → vuelve a Contactos y nada sigue sonando
//  T12 tocar mi círculo abre «publicar»; tocar el círculo de B lleva a los suyos
// Contraprueba: en la 3229 (lista vertical y visor con botones) T1, T2, T3, T4… fallan.
// Uso: node estadostiktok.js <dir_build> [dir_capturas]
'use strict';
const fs = require('fs');
const path = require('path');
if (!process.env.SHOTS_VIEWPORT) process.env.SHOTS_VIEWPORT = '360x740';
const { PW, bootPhone, sleep } = require('./pw_harness');
const { Radio, NativePhone } = require('./native_mock');

const dist = path.resolve(process.argv[2], 'dist');
const shots = process.argv[3] ? path.resolve(process.argv[3]) : '';
const logs = [];
const r = { prueba: 'estadostiktok', build: path.basename(process.argv[2]) };
const fin = (ok) => {
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('ESTADOSTIKTOK ' + JSON.stringify(r));
  try { fs.writeFileSync(path.join(__dirname, 'last_logs_estadostiktok.txt'), logs.join('\n')); } catch (e) {}
};

(async () => {
  const browser = await PW.chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });   // como el WebView de NEXO (Capacitor)
  const radio = new Radio();
  const opts = { readsContentFallback: true, retain: ['onPayloadReceived'], closeOnNoService: true, pace: [5, 5], ioDelay: 10, asymmetric: true, noTor: true };
  const nat = { A: new NativePhone('A', 'AA:AA:AA:AA:AA:01', opts), B: new NativePhone('B', 'BB:BB:BB:BB:BB:02', opts), C: new NativePhone('C', 'CC:CC:CC:CC:CC:03', opts) };
  Object.values(nat).forEach((n) => { radio.add(n); n.load(); });
  const phA = await bootPhone(browser, 'A', nat.A, dist, { phone: true, logs, seedName: 'Ana', lang: 'es' });
  const A = phA.page, cdp = phA.cdp;
  const B = (await bootPhone(browser, 'B', nat.B, dist, { phone: true, logs, seedName: 'Beto', lang: 'es' })).page;
  const C = (await bootPhone(browser, 'C', nat.C, dist, { phone: true, logs, seedName: 'Carla', lang: 'es' })).page;
  const shot = async (name) => { if (shots) { fs.mkdirSync(shots, { recursive: true }); await A.screenshot({ path: path.join(shots, name) }); } };
  const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
  const swipe = async (x0, y0, x1, y1, ms) => {
    const n = Math.max(3, Math.round(ms / 16));
    await touch('touchStart', x0, y0);
    for (let i = 1; i <= n; i++) { await sleep(ms / n); await touch('touchMove', x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n); }
    await touch('touchEnd');
  };
  const tap = async (x, y) => { await touch('touchStart', x, y); await sleep(40); await touch('touchEnd'); };
  const cur = () => A.evaluate(() => window.__nexoEstCur ? window.__nexoEstCur() : null);
  const W = 360, H = 740;
  // la contraprueba (build sin estados_feed) no tiene __nexoEstCur: todo lo que depende de él falla sin romper la prueba
  try {
    // ---- emparejar A con B y con C ----
    const pair = async (name) => {
      await A.evaluate(() => { if (!document.getElementById('ble-panel').classList.contains('active')) window.bleInterface.togglePanel(); });
      let ok = false;
      for (let i = 0; i < 120 && !ok; i++) {
        await sleep(150);
        ok = await A.evaluate((n) => { const row = Array.from(document.querySelectorAll('#ble-new-device > div')).find((d) => (d.querySelector('span') || {}).textContent === n); const b = row && row.querySelector('button'); if (b) b.click(); return !!b; }, name);
        if (!ok) await A.evaluate(() => { if (!window.bleInterface.isScanning) { const b = document.getElementById('ble-scan-btn'); if (b) b.click(); } });
      }
      await sleep(1800);
      await A.evaluate(() => { if (document.getElementById('ble-panel').classList.contains('active')) window.bleInterface.togglePanel(); });
      return ok;
    };
    r.empareja = (await pair('B')) && (await pair('C'));
    const idB = await B.evaluate(() => window.bleInterface.localNexoId.toLowerCase());
    const idC = await C.evaluate(() => window.bleInterface.localNexoId.toLowerCase());
    for (const P of [B, C]) for (let i = 0; i < 60; i++) { if (await P.evaluate(() => !!document.querySelector('#main-contacts-list .ble-contact-row'))) break; await sleep(250); }
    await sleep(1200);
    // ---- B: un video (pequeño, va dentro del estado) y luego una foto; C, después, un texto con enlace ----
    const vid = await B.evaluate(async () => {
      const c = document.createElement('canvas'); c.width = 96; c.height = 160; const ctx = c.getContext('2d');
      const rec = new MediaRecorder(c.captureStream(15), { mimeType: 'video/webm;codecs=vp8', videoBitsPerSecond: 40000 });
      const parts = []; rec.ondataavailable = (e) => { if (e.data && e.data.size) parts.push(e.data); };
      let n = 0; const draw = () => { ctx.fillStyle = 'hsl(' + (n * 25 % 360) + ',70%,45%)'; ctx.fillRect(0, 0, 96, 160); n++; };
      draw(); const iv = setInterval(draw, 66); rec.start(200);
      await new Promise((res) => setTimeout(res, 1500)); clearInterval(iv); await new Promise((res) => { rec.onstop = res; rec.stop(); });
      const b = new Blob(parts, { type: 'video/webm' });
      return await new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(b); });
    });
    r.video_kb = Math.round(vid.length * 0.75 / 1024);
    await B.evaluate((v) => window.NEXO_addMyStatus('', '', '', '', '', v.replace(/^data:video\/webm;[^,]*,/, 'data:video/webm;base64,'), 'video/webm'), vid);
    await sleep(300);
    const foto = await B.evaluate(() => { const c = document.createElement('canvas'); c.width = 120; c.height = 200; const x = c.getContext('2d'); x.fillStyle = '#e91e63'; x.fillRect(0, 0, 120, 200); x.fillStyle = '#fff'; x.fillRect(30, 60, 60, 80); return c.toDataURL('image/jpeg', 0.7); });
    await B.evaluate((f) => window.NEXO_addMyStatus('mi foto', f, 'image/jpeg'), foto);
    await sleep(300);
    await C.evaluate(() => window.NEXO_addMyStatus('mira esto https://example.com/nexo'));
    let llego = false;
    for (let i = 0; i < 160 && !llego; i++) {
      llego = await A.evaluate(([b, c]) => (window.NEXO_statusesOf(b) || []).length === 2 && (window.NEXO_statusesOf(c) || []).length === 1, [idB, idC]);
      if (!llego) await sleep(250);
    }
    r.preparado = llego;
    await sleep(600);

    // ---- entrar en Estados (deslizar ← desde media pantalla) ----
    await swipe(270, 420, 60, 420, 200); await sleep(900);
    r.abierta = await A.evaluate(() => document.body.classList.contains('nx-est-on'));
    // T1: la fila de círculos
    const fila = await A.evaluate(() => {
      const chips = Array.from(document.querySelectorAll('#estados-screen .estado-chip'));
      return chips.map((c) => {
        const av = c.querySelector('.nx-est-av') || c.querySelector('div'), q = c.getBoundingClientRect(), qa = av.getBoundingClientRect();
        const lab = c.querySelector('.nx-est-rname'), ql = lab ? lab.getBoundingClientRect() : null;
        return { nx: c.getAttribute('data-nx'), x: Math.round(q.left), y: Math.round(q.top), avBottom: Math.round(qa.bottom), labTop: ql ? Math.round(ql.top) : null, lab: lab ? lab.textContent : c.textContent, visto: av.classList.contains('visto'), borde: getComputedStyle(av).borderTopColor };
      });
    });
    r.fila = fila.map((f) => f.nx + '@' + f.x + ',' + f.y + (f.visto ? ' visto' : ''));
    const deLado = fila.length === 3 && fila.every((f) => Math.abs(f.y - fila[0].y) <= 2) && fila[0].x < fila[1].x && fila[1].x < fila[2].x;
    r.T1_fila_de_lado = deLado && fila[0].nx === 'me' && /Mi estado/.test(fila[0].lab) && fila[0].labTop !== null && fila[0].labTop >= fila[0].avBottom - 1 &&
      fila.slice(1).every((f) => !f.visto && /0, 200, 255|0, 191, 255|\b0, 1\d\d, 2\d\d/.test(f.borde));
    await shot('T1_entrar.png');
    // T2 y T3
    const vista = await A.evaluate(() => {
      const v = document.getElementById('estado-view'), m = v && v.querySelector('.nx-est-media'), q = v && v.getBoundingClientRect(), qm = m && m.getBoundingClientRect();
      return { v: q ? [Math.round(q.left), Math.round(q.top), Math.round(q.width), Math.round(q.height)] : null, m: qm ? [Math.round(qm.width), Math.round(qm.height)] : null, tag: m ? m.tagName.toLowerCase() : '',
        fit: m ? getComputedStyle(m).objectFit : '', botones: document.querySelectorAll('#estados-screen button').length, poster: m ? m.getAttribute('poster') || '' : '' };
    });
    r.vista = vista;
    r.T2_toda_la_pantalla_sin_botones = !!vista.v && vista.v[0] === 0 && vista.v[1] === 0 && vista.v[2] === W && vista.v[3] === H && !!vista.m && vista.m[0] === W && vista.m[1] === H && vista.fit === 'cover' && vista.botones === 0;
    let c0 = await cur();
    r.T3_empieza_por_el_mas_viejo = !!c0 && c0.nx === idB && c0.s === 0 && vista.tag === 'video';
    // T4: se reproduce solo
    let suena = null;
    for (let i = 0; i < 20; i++) { suena = await A.evaluate(() => { const m = document.getElementById('estado-video'); return m ? { paused: m.paused, t: m.currentTime, wait: m.classList.contains('nx-est-wait') } : null; }); if (suena && !suena.paused && suena.t > 0.1) break; await sleep(200); }
    r.suena = suena;
    r.T4_video_solo_sin_portada_gris = !!suena && !suena.paused && suena.t > 0.1 && !suena.wait && /^data:image\/gif;base64,R0lGODlhAQAB/.test(vista.poster);
    await shot('T4_video.png');
    // T5: de lado → la foto
    await swipe(300, 400, 40, 400, 220); await sleep(700);
    c0 = await cur();
    const t5 = await A.evaluate(() => {
      const v = document.getElementById('estado-view'), m = v && v.querySelector('img.nx-est-media'), q = m && m.getBoundingClientRect();
      const vids = Array.from(document.querySelectorAll('#estados-screen video')).filter((x) => !x.paused).length;
      return { img: q ? [Math.round(q.width), Math.round(q.height)] : null, sonando: vids, pie: (v && v.querySelector('.nx-est-cap') || {}).textContent || '' };
    });
    r.t5 = t5;
    r.T5_de_lado_la_foto = !!c0 && c0.nx === idB && c0.s === 1 && !!t5.img && t5.img[0] === W && t5.img[1] === H && t5.sonando === 0 && t5.pie === 'mi foto';
    await shot('T5_foto.png');
    // T6: el aro de B pasa a blanco; el de C sigue azul
    await sleep(400);
    const aros = await A.evaluate(([b, c]) => {
      const one = (nx) => { const av = document.querySelector('#estados-screen .estado-chip[data-nx="' + nx + '"] .nx-est-av'); return av ? { visto: av.classList.contains('visto'), borde: getComputedStyle(av).borderTopColor } : null; };
      return { B: one(b), C: one(c) };
    }, [idB, idC]);
    r.aros = aros;
    r.T6_aro_azul_a_blanco = !!aros.B && aros.B.visto && aros.B.borde === 'rgb(255, 255, 255)' && !!aros.C && !aros.C.visto;
    // T7: de abajo hacia arriba → C
    await swipe(180, 600, 180, 140, 220); await sleep(800);
    c0 = await cur();
    const t7 = await A.evaluate(() => { const v = document.getElementById('estado-view'); return { txt: v ? (v.querySelector('.nx-est-bigtxt') || {}).textContent || '' : '', link: !!(v && v.querySelector('.nx-est-bigtxt a')) }; });
    r.T7_arriba_el_siguiente = !!c0 && c0.nx === idC && /mira esto/.test(t7.txt) && t7.link;
    await shot('T7_texto.png');
    // T8: dos toques → me gusta
    await tap(180, 300); await sleep(120); await tap(180, 300); await sleep(200);
    const burst = await A.evaluate(() => !!document.querySelector('#estado-view .nx-est-burst'));
    let likeC = false;
    for (let i = 0; i < 60 && !likeC; i++) { likeC = await C.evaluate(() => window.NEXO_myLikes() === 1); if (!likeC) await sleep(250); }
    const corazon = await A.evaluate(() => !!document.querySelector('#estado-view .nx-est-heart.on'));
    r.T8_doble_toque_me_gusta = burst && likeC && corazon;
    // T9: abajo (B, en la foto) y de lado (el video): un toque pausa, otro sigue
    await swipe(180, 140, 180, 600, 220); await sleep(800);
    await swipe(60, 400, 320, 400, 220); await sleep(900);
    c0 = await cur();
    const enVideo = !!c0 && c0.nx === idB && c0.s === 0;
    await tap(180, 300); await sleep(700);
    const pausa = await A.evaluate(() => { const m = document.getElementById('estado-video'); return !!m && m.paused && document.getElementById('estado-view').classList.contains('nx-est-paused'); });
    await tap(180, 300); await sleep(700);
    const sigue = await A.evaluate(() => { const m = document.getElementById('estado-video'); return !!m && !m.paused; });
    r.t9 = { enVideo, pausa, sigue };
    r.T9_un_toque_pausa_y_sigue = enVideo && pausa && sigue;
    // T10: publico uno; al salir y volver, el primero es el mío
    await A.evaluate(() => window.NEXO_addMyStatus('mi estado de prueba'));
    await sleep(700);
    await A.evaluate(() => window.__nexoEstadosBack && window.__nexoEstadosBack()); await sleep(600);
    await swipe(270, 420, 60, 420, 200); await sleep(900);
    c0 = await cur();
    const t10 = await A.evaluate(() => {
      const v = document.getElementById('estado-view'), q = v && v.getBoundingClientRect(), mine = document.querySelector('#estados-screen .estado-chip.nx-est-mine .nx-est-av');
      return { txt: v ? v.textContent : '', full: !!q && q.width === innerWidth && q.height === innerHeight, aro: !!mine && mine.classList.contains('visto') };
    });
    r.T10_primero_el_mio = !!c0 && c0.nx === 'me' && /mi estado de prueba/.test(t10.txt) && t10.full && t10.aro;
    await shot('T10_mio.png');
    // T11: en el primero, deslizar → vuelve a Contactos y nada suena
    await swipe(90, 420, 320, 420, 200); await sleep(800);
    const t11 = await A.evaluate(() => ({ abierta: document.body.classList.contains('nx-est-on'), sonando: Array.from(document.querySelectorAll('video, audio')).filter((m) => !m.paused).length }));
    r.T11_vuelve_y_calla = !t11.abierta && t11.sonando === 0;
    // T12: mi círculo abre «publicar»; el de B lleva a los suyos
    await swipe(270, 420, 60, 420, 200); await sleep(900);
    await A.evaluate(() => { const c = document.querySelector('#estados-screen .estado-chip.nx-est-mine'); if (c) c.click(); }); await sleep(500);
    const publicar = await A.evaluate(() => !!document.getElementById('estado-overlay'));
    await A.evaluate(() => { const o = document.getElementById('estado-overlay'); if (o) o.remove(); }); await sleep(300);
    await A.evaluate((b) => { const c = document.querySelector('#estados-screen .estado-chip[data-nx="' + b + '"]'); if (c) c.click(); }, idB); await sleep(500);
    c0 = await cur();
    r.T12_circulos = publicar && !!c0 && c0.nx === idB;
  } catch (e) { r.error = String((e && e.message) || e).slice(0, 200); }
  r.errores = logs.filter((l) => /PAGEERROR|TypeError|is not a function/.test(l)).slice(0, 5);
  const keys = Object.keys(r).filter((k) => /^T\d+_/.test(k));
  await browser.close();
  fin(keys.length === 12 && keys.every((k) => r[k] === true) && r.errores.length === 0 && !r.error);
  process.exit(0);
})().catch((e) => { r.error = String((e && e.message) || e); fin(false); process.exit(0); });
