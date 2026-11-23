// COLA 31 (decidido por el dueño 23-11) — VISTA PREVIA REAL DE ENLACES. La baja el teléfono que RECIBE, directo del sitio y por Tor, en
// nativo (linkPreview: Kotlin LinkPreview.kt, probado aparte en tests/kotlin/LinkPreviewTest). Aquí, en Chromium real, el nativo
// simulado hace de «sitio + Tor» (opts.linkPreview) y se mira lo que ve B cuando A le manda:
//  P1  real: TikTok → imagen + título encima de la tarjeta, el dominio REAL (vm.tiktok.com) sigue a la vista, logo SVG del sitio, el
//      texto de la burbuja sigue siendo el mensaje tal cual; al nativo solo va { url };
//  P2  sin internet: Instagram → tarjeta segura (logo + dominio, sin vista previa); al volver la red (onNetChange) la vista previa aparece
//      SOLA, sin volver a abrir el chat;
//  P3  el sitio rechaza Tor (el nativo ya reintentó por otro circuito): tarjeta segura, nada inventado;
//  P4  imagen enorme (o que no es JPEG en base64): se descarta la imagen y queda el título;
//  P5  HTML raro / malicioso: el título con <img onerror>, marcas de dirección y controles se ve como TEXTO limpio; nada se ejecuta;
//  P6  redirección a otro dominio: sin vista previa, la tarjeta avisa «Lleva a otro sitio: malo.example.net» y abrir pide confirmación
//      (cancelar = no se abre; aceptar = se abre);
//  P7  dominio imitador (аpple.com con «а» cirílica → xn--): el enlace lleva ⚠ y abrir pide confirmación enseñando cómo se lee;
//  P8  un mensaje que trae campos de «vista previa» del emisor (prev/og/title/img): se ignoran; solo cuenta la URL del texto;
//  P9  http:// no se pide (por http la vista previa se podría falsificar en el camino).
//  P10 (dueño 23-11) cualquier sitio https de un contacto: tarjeta con su dominio real y la vista previa real.
// Contraprueba: en NEXOCHAT 2a14cb7e no hay linkPreview, logos ni avisos (fallan P1–P7; P8 y P9 pasan: allí no se pedía nada).
// Uso: node vistaprevia.js <dir_build>
'use strict';
const fs = require('fs');
const path = require('path');
const { PW, bootPhone, sleep } = require('./pw_harness');
const { Radio, NativePhone } = require('./native_mock');
const dist = path.resolve(process.argv[2], 'dist');
// JPEG real de 1×1 (lo que entregaría el nativo tras recomprimir)
const JPG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';
const M = {
  real: 'mira https://vm.tiktok.com/ZMreal1/',
  off: 'https://www.instagram.com/reel/OFF1/',
  rechaza: 'https://www.facebook.com/watch/R1',
  enorme: 'https://youtu.be/BIGIMG1',
  raro: 'https://www.tiktok.com/@x/video/RARO',
  redir: 'https://vm.tiktok.com/REDIR1/',
  imita: 'entra a https://аpple.com/login ya',
  http: 'http://www.tiktok.com/@x/video/2',
  web: 'nota https://www.periodico-ejemplo.mx/nota/77',
};
const FAKE = JSON.stringify({ type: 'nexo_txt', t: 'https://youtu.be/FAKE1', prev: { title: 'FALSO', image: JPG }, og: { title: 'FALSO2', image: JPG }, title: 'FALSO3', img: JPG, image: JPG });
const RARO_T = '<img src=x onerror="window.__xss=1"><script>window.__xss=2</script> ‮gnp.exe\u0000 Título\n\traro';
async function waitFor(fn, ms) { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (await fn()) return true; } catch (e) {} await sleep(200); } return false; }
(async () => {
  const r = { prueba: 'vistaprevia', build: path.basename(process.argv[2]) };
  const browser = await PW.chromium.launch();
  const radio = new Radio();
  const web = { online: true, asked: [] };
  const SITE = {
    'https://vm.tiktok.com/ZMreal1/': { status: 'ok', title: 'Baile real de Ana', image: JPG, host: 'vm.tiktok.com' },
    'https://www.instagram.com/reel/OFF1/': { status: 'ok', title: 'Reel sin red', image: JPG, host: 'www.instagram.com' },
    'https://www.facebook.com/watch/R1': { status: 'rechaza', host: 'www.facebook.com' },
    'https://youtu.be/BIGIMG1': { status: 'ok', title: 'Vídeo con imagen enorme', image: 'data:image/jpeg;base64,' + 'A'.repeat(600000), host: 'youtu.be' },
    'https://www.tiktok.com/@x/video/RARO': { status: 'ok', title: RARO_T, image: 'javascript:window.__xss=3', host: 'www.tiktok.com', extra: '<b>x</b>' },
    'https://vm.tiktok.com/REDIR1/': { status: 'redirige', to: 'malo.example.net', host: 'vm.tiktok.com' },
    'https://youtu.be/FAKE1': { status: 'sin_datos', host: 'youtu.be' },
    'https://www.periodico-ejemplo.mx/nota/77': { status: 'ok', title: 'Nota de cualquier sitio', image: JPG, host: 'www.periodico-ejemplo.mx' },
  };
  const linkPreview = async (a) => {
    web.asked.push(JSON.parse(JSON.stringify(a)));
    await sleep(300);
    if (!web.online) return { status: 'offline' };
    return SITE[a.url] || { status: 'sin_datos' };
  };
  const base = { readsContentFallback: true, closeOnNoService: true, pace: [5, 5], ioDelay: 10, asymmetric: true, noTor: true };
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', base), nB = new NativePhone('B', 'BB:BB:BB:BB:BB:02', Object.assign({ linkPreview }, base));
  radio.add(nA); radio.add(nB); nA.load(); nB.load();
  const logs = [];
  const A = (await bootPhone(browser, 'A', nA, dist, { phone: true, logs, seedName: 'Ana', lang: 'es' })).page;
  const B = (await bootPhone(browser, 'B', nB, dist, { phone: true, logs, seedName: 'Beto', lang: 'es' })).page;
  const dialogs = []; let acceptDialog = false;
  B.on('dialog', (d) => { dialogs.push(d.message()); (acceptDialog ? d.accept() : d.dismiss()).catch(() => {}); });

  // Emparejar y abrir el chat en los dos
  const click = (p, sel) => p.evaluate((s) => { const e = document.querySelector(s); if (e) e.click(); return !!e; }, sel);
  await A.evaluate(() => window.bleInterface.togglePanel());
  for (let i = 0; i < 100; i++) { await sleep(150); if (await A.evaluate(() => !!document.querySelector('#ble-new-device button'))) break; await A.evaluate(() => { if (!window.bleInterface.isScanning) { const b = document.getElementById('ble-scan-btn'); if (b) b.click(); } }); }
  await click(A, '#ble-new-device button'); await sleep(1800);
  await A.evaluate(() => { if (document.getElementById('ble-panel').classList.contains('active')) window.bleInterface.togglePanel(); });
  await A.evaluate(() => { const row = document.querySelector('#main-contacts-list .ble-contact-row'); if (row) row.click(); }); await sleep(800);
  const send = async (txt) => { await A.evaluate((t) => { const i = document.getElementById('message-input'); i.value = t; i.dispatchEvent(new Event('input', { bubbles: true })); document.getElementById('send-btn').click(); }, txt); await sleep(900); };
  await send('hola');
  await waitFor(() => B.evaluate(() => !!document.querySelector('#main-contacts-list .ble-contact-row')), 15000);
  await B.evaluate(() => { const row = document.querySelector('#main-contacts-list .ble-contact-row'); if (row) row.click(); }); await sleep(1200);

  // Lo que ve B en la burbuja que contiene `needle`
  const view = (needle) => B.evaluate((n) => {
    const m = Array.from(document.querySelectorAll('#messages-container .message')).find((x) => ((x.querySelector('.msg-content') || {}).textContent || '').indexOf(n) >= 0);
    if (!m) return null;
    const c = m.querySelector('.msg-content'), card = c.querySelector('.nx-link-card');
    const pc = (el) => (el ? (getComputedStyle(el, '::before').content || '').replace(/^"|"$/g, '').replace(/\\"/g, '"') : null);
    const img = card && card.querySelector('img.nx-lc-img');
    return {
      texto: c.textContent,
      tarjeta: !!card,
      logo: !!(card && card.querySelector('svg.nx-lc-svg')),
      sitio: card && pc(card.querySelector('.nx-lc-name')),
      dominio: card && pc(card.querySelector('.nx-lc-host')),
      titulo: card && pc(card.querySelector('.nx-lc-title')),
      aviso: card && pc(card.querySelector('.nx-lc-warn')),
      img: img ? img.getAttribute('src').slice(0, 30) : null,
      imgs: c.querySelectorAll('img').length,
      imgVisible: !!(img && img.getBoundingClientRect().width > 0),
      warnLink: !!c.querySelector('a.nx-link.nx-link-warn'),
      html: c.innerHTML.length,
    };
  }, needle);

  // P1 / P3 / P4 / P5 / P6 / P9 con internet
  for (const k of ['real', 'rechaza', 'enorme', 'raro', 'redir', 'imita', 'http']) await send(M[k]);
  await send(FAKE);
  await waitFor(async () => { const v = await view('ZMreal1'); return v && v.titulo; }, 8000);
  await sleep(1500);
  const v1 = await view('ZMreal1');
  r.P1 = v1;
  r.P1_real = !!v1 && v1.titulo === 'Baile real de Ana' && v1.img === JPG.slice(0, 30) && v1.imgVisible && v1.dominio === 'vm.tiktok.com' && v1.sitio === 'TikTok' && v1.logo && v1.texto === M.real;
  r.P1_solo_url = web.asked.length > 0 && web.asked.every((a) => Object.keys(a).join() === 'url');
  const v3 = await view('watch/R1');
  r.P3_rechaza_tarjeta_segura = !!v3 && v3.tarjeta && v3.logo && v3.sitio === 'Facebook' && v3.dominio === 'facebook.com' && !v3.titulo && v3.imgs === 0 && web.asked.some((a) => a.url === 'https://www.facebook.com/watch/R1');
  const v4 = await view('BIGIMG1');
  r.P4_imagen_enorme = !!v4 && v4.titulo === 'Vídeo con imagen enorme' && v4.imgs === 0 && v4.html < 5000;
  const v5 = await view('video/RARO');
  r.P5 = v5 && v5.titulo;
  r.P5_html_raro = !!v5 && v5.titulo === '<img src=x onerror="window.__xss=1"><script>window.__xss=2</script> gnp.exe Título raro' && v5.imgs === 0 &&
    (await B.evaluate(() => typeof window.__xss === 'undefined'));
  const v6 = await view('REDIR1');
  r.P6_aviso = !!v6 && !v6.titulo && v6.imgs === 0 && v6.aviso === '⚠ Lleva a otro sitio: malo.example.net';
  const v7 = await view('/login');
  r.P7_marca = !!v7 && v7.warnLink && !v7.tarjeta;
  r.P7_no_se_pide = !web.asked.some((a) => /xn--|pple/.test(a.url));
  const v8 = await view('FAKE1');
  r.P8 = v8;
  r.P8_ignora_emisor = !!v8 && v8.texto === 'https://youtu.be/FAKE1' && !v8.titulo && v8.imgs === 0 && v8.tarjeta &&
    !(await B.evaluate(() => /FALSO/.test(document.getElementById('messages-container').innerHTML)));
  const v9 = await view('video/2');
  r.P9_http_no_se_pide = !!v9 && v9.tarjeta && !v9.titulo && !web.asked.some((a) => /^http:/.test(a.url));

  // P6 / P7: abrir → confirmación (cancelar no abre; aceptar abre)
  const opened = () => nB.calls.filter((c) => c.name === 'openUrl').map((c) => c.args && c.args.url);
  const tap = async (needle, sel) => { await B.evaluate(([n, s]) => { const m = Array.from(document.querySelectorAll('#messages-container .message')).find((x) => ((x.querySelector('.msg-content') || {}).textContent || '').indexOf(n) >= 0); const e = m && m.querySelector(s); if (e) e.click(); }, [needle, sel]); await sleep(600); };
  await tap('REDIR1', '.nx-link-card');
  r.P6_cancelar = dialogs.length === 1 && /malo\.example\.net/.test(dialogs[0]) && opened().length === 0;
  acceptDialog = true;
  await tap('REDIR1', '.nx-link-card');
  r.P6_aceptar = dialogs.length === 2 && opened().length === 1 && opened()[0] === 'https://vm.tiktok.com/REDIR1/';
  acceptDialog = false;
  await tap('/login', 'a.nx-link');
  r.P7_dialogo = dialogs[2] || null;
  r.P7_confirmar = dialogs.length === 3 && /xn--pple-43d\.com/.test(dialogs[2]) && /аpple\.com/.test(dialogs[2]) && opened().length === 1;
  await tap('ZMreal1', '.nx-link-card');
  r.P1_abre_sin_preguntar = dialogs.length === 3 && opened().length === 2 && opened()[1] === 'https://vm.tiktok.com/ZMreal1/';

  // P2: sin internet → tarjeta segura; vuelve la red → aparece sola
  web.online = false; nB.setNetwork('none'); await sleep(500);
  await send(M.off);
  await sleep(1500);
  const v2a = await view('OFF1');
  r.P2_sin_red = v2a;
  r.P2_tarjeta_segura = !!v2a && v2a.tarjeta && v2a.logo && v2a.sitio === 'Instagram' && v2a.dominio === 'instagram.com' && !v2a.titulo && v2a.imgs === 0;
  web.online = true; nB.setNetwork('wifi');
  r.P2_aparece_sola = await waitFor(async () => { const v = await view('OFF1'); return v && v.titulo === 'Reel sin red' && v.imgs === 1; }, 8000);

  // P10 (dueño 23-11): cualquier sitio https de un CONTACTO → tarjeta con el dominio real y su vista previa
  await send(M.web);
  r.P10_cualquier_sitio = await waitFor(async () => { const v = await view('nota/77'); return v && v.tarjeta && v.sitio === 'periodico-ejemplo.mx' && v.dominio === 'periodico-ejemplo.mx' && v.titulo === 'Nota de cualquier sitio' && v.imgs === 1; }, 8000);
  r.errores = logs.filter((l) => /PAGEERROR|TypeError|is not a function|ReferenceError/.test(l)).slice(0, 4);
  const keys = ['P1_real', 'P1_solo_url', 'P1_abre_sin_preguntar', 'P2_tarjeta_segura', 'P2_aparece_sola', 'P3_rechaza_tarjeta_segura', 'P4_imagen_enorme', 'P5_html_raro',
    'P6_aviso', 'P6_cancelar', 'P6_aceptar', 'P7_marca', 'P7_no_se_pide', 'P7_confirmar', 'P8_ignora_emisor', 'P9_http_no_se_pide', 'P10_cualquier_sitio'];
  const ok = keys.every((k) => r[k] === true) && r.errores.length === 0;
  r.fallan = keys.filter((k) => r[k] !== true);
  r.resultado = ok ? 'OK' : 'FALLO';
  if (ok) { delete r.P1; delete r.P8; delete r.P2_sin_red; }
  console.log('VISTAPREVIA ' + JSON.stringify(r));
  try { fs.writeFileSync(path.join(__dirname, 'last_logs_vistaprevia.txt'), logs.join('\n')); } catch (e) {}
  await browser.close();
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('VISTAPREVIA ' + JSON.stringify({ prueba: 'vistaprevia', resultado: 'FALLO', error: String(e && e.stack).slice(0, 400) })); process.exit(1); });
