// 3161 — ENLACES QUE SE TOCAN + NEXO EN EL MENÚ «COMPARTIR» (dueño 16-11: «compartir de forma práctica vídeos de TikTok, Facebook,
// Instagram (y YouTube) en el chat»). Hasta la 3160 un enlace llegaba como texto simple (no se podía tocar) y NEXO no salía en el menú
// «Compartir» de Android. Chromium real (CSS de la tarjeta y la acción por defecto de un clic en un enlace). A le manda a B:
//  L1  «mira https://vm.tiktok.com/ZMabc123/»: en B el enlace se toca (<a> con esa URL) y debajo la tarjeta «TikTok» (vm.tiktok.com),
//      sin imágenes descargadas; el texto de la burbuja (.msg-content) sigue siendo el mensaje tal cual (búsqueda, responder, pruebas);
//  L2  tocar el enlace (y la tarjeta) llama al abridor externo nativo (openUrl) con ESA URL exacta y el WebView no navega ni abre ventanas;
//  L3  «javascript:alert(1)», «intent://…», «file:///…» y «https://www.tiktok.com@malo.com/» (usuario@ engañoso) no se vuelven enlace;
//  L4  «https://ejemplo.com» se toca y, desde la 3309 (COLA 31: vista previa real de TODOS los sitios), lleva su tarjeta con su dominio;
//  L5  Instagram, Facebook (fb.watch) y YouTube (youtu.be, m.youtube.com entre paréntesis y con punto final) dan su tarjeta;
//  L6  pulsación larga sobre el enlace abre el menú de la burbuja (y no el enlace); doble toque en la burbuja reacciona ❤️; tocar dos
//      veces el enlace lo abre pero no cuenta como «doble toque»;
//  L7  en A (el que manda) el enlace también se toca;
//  S1  sin contactos: compartir un texto en NEXO da un aviso (no la hoja);
//  S2  app abierta: el nativo avisa onSharedText → hoja «Enviar a…» (con buscador) → tocar a A → su chat abierto con el texto YA en la caja;
//  S3  app cerrada: el nativo avisa ANTES de que arranque el JS (retenido) → igual, y un texto de 5000 caracteres llega cortado a 4000.
// Contraprueba: en la 3160 fallan L1–L7 y S1–S3 (texto simple; nadie escucha onSharedText).
// Uso: node enlaces.js <dir_build>
'use strict';
const fs = require('fs');
const path = require('path');
const { PW, bootPhone, sleep } = require('./pw_harness');
const { Radio, NativePhone } = require('./native_mock');
const dist = path.resolve(process.argv[2], 'dist');
const MSGS = {
  tt: 'mira https://vm.tiktok.com/ZMabc123/',
  malos: 'no son enlaces: javascript:alert(1) ni intent://scan/#Intent;scheme=zxing;end ni file:///sdcard/x ni https://www.tiktok.com@malo.com/',
  normal: 'https://ejemplo.com',
  ig: 'https://www.instagram.com/reel/Cxyz12/',
  fb: 'este https://fb.watch/abc123/',
  yt: 'https://youtu.be/dQw4w9WgXcQ',
  yt2: '(lo vi en https://m.youtube.com/watch?v=abc).',
};
async function waitFor(fn, ms) { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (await fn()) return true; } catch (e) {} await sleep(200); } return false; }
(async () => {
  const r = { prueba: 'enlaces', build: path.basename(process.argv[2]) };
  const browser = await PW.chromium.launch();
  const radio = new Radio();
  const opts = { readsContentFallback: true, retain: ['onPayloadReceived', 'onSharedText'], closeOnNoService: true, pace: [5, 5], ioDelay: 10, asymmetric: true, noTor: true };
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', opts), nB = new NativePhone('B', 'BB:BB:BB:BB:BB:02', opts);
  radio.add(nA); radio.add(nB); nA.load(); nB.load();
  const logs = [];
  const A = (await bootPhone(browser, 'A', nA, dist, { phone: true, logs, seedName: 'Ana', lang: 'es' })).page;
  let B = (await bootPhone(browser, 'B', nB, dist, { phone: true, logs, seedName: 'Beto', lang: 'es' })).page;
  const sheetRows = (p) => p.evaluate(() => { const s = document.getElementById('nexo-sendto-sheet'); return s ? Array.from(s.querySelectorAll('[data-chat-id]')).map((x) => x.getAttribute('data-chat-id')) : null; });

  // S1: sin contactos todavía → aviso, sin hoja
  nB.emit('onSharedText', { text: 'https://vm.tiktok.com/ZMsolo/' });
  r.S1_aviso_sin_contactos = await waitFor(() => B.evaluate(() => { const t = document.getElementById('perm-error-toast'); return !!t && /contacto/i.test(t.textContent) && !document.getElementById('nexo-sendto-sheet'); }), 5000);

  // Emparejar (A agrega a B) y abrir el chat en los dos
  const click = (p, sel) => p.evaluate((s) => { const e = document.querySelector(s); if (e) e.click(); return !!e; }, sel);
  await A.evaluate(() => window.bleInterface.togglePanel());
  for (let i = 0; i < 100; i++) { await sleep(150); if (await A.evaluate(() => !!document.querySelector('#ble-new-device button'))) break; await A.evaluate(() => { if (!window.bleInterface.isScanning) { const b = document.getElementById('ble-scan-btn'); if (b) b.click(); } }); }
  await click(A, '#ble-new-device button'); await sleep(1800);
  await A.evaluate(() => { if (document.getElementById('ble-panel').classList.contains('active')) window.bleInterface.togglePanel(); });
  await A.evaluate(() => { const row = document.querySelector('#main-contacts-list .ble-contact-row'); if (row) row.click(); }); await sleep(800);
  const idA = await A.evaluate(() => String(window.bleInterface.localNexoId || '').toLowerCase());
  const send = async (txt) => { await A.evaluate((t) => { const i = document.getElementById('message-input'); i.value = t; i.dispatchEvent(new Event('input', { bubbles: true })); document.getElementById('send-btn').click(); }, txt); await sleep(1000); };
  for (const k of Object.keys(MSGS)) await send(MSGS[k]);
  await sleep(2500);
  await waitFor(() => B.evaluate(() => !!document.querySelector('#main-contacts-list .ble-contact-row')), 15000);
  await B.evaluate(() => { const row = document.querySelector('#main-contacts-list .ble-contact-row'); if (row) row.click(); }); await sleep(1500);
  await waitFor(() => B.evaluate((n) => document.querySelectorAll('#messages-container .message .msg-content').length >= n, Object.keys(MSGS).length), 15000);

  // Lo que se ve en cada burbuja (marca data-prueba en las burbujas para tocarlas luego)
  const inspect = (p) => p.evaluate((M) => {
    const out = {};
    const all = Array.from(document.querySelectorAll('#messages-container .message'));
    Object.keys(M).forEach((k) => {
      const m = all.find((x) => (x.querySelector('.msg-content') || {}).textContent === M[k]);
      if (!m) { out[k] = null; return; }
      m.setAttribute('data-prueba', k);
      const c = m.querySelector('.msg-content');
      const card = c.querySelector('.nx-link-card');
      const nm = card && card.querySelector('.nx-lc-name'), host = card && card.querySelector('.nx-lc-host');
      out[k] = {
        enlaces: Array.from(c.querySelectorAll('a.nx-link')).map((a) => a.getAttribute('href')),
        anclas: c.querySelectorAll('a').length,
        tarjeta: card ? { sitio: (nm && getComputedStyle(nm, '::before').content || '').replace(/^"|"$/g, ''), dominio: (host && getComputedStyle(host, '::before').content || '').replace(/^"|"$/g, ''), href: card.getAttribute('href'), visible: card.getBoundingClientRect().width > 0, imgs: card.querySelectorAll('img').length, ancho: Math.round(card.getBoundingClientRect().width) } : null,
      };
    });
    return out;
  }, MSGS);
  const vB = await inspect(B), vA = await inspect(A);
  r.B = vB;
  const tt = vB.tt;
  r.L1_enlace_tocable = !!tt && tt.enlaces.length === 1 && tt.enlaces[0] === 'https://vm.tiktok.com/ZMabc123/';
  r.L1_tarjeta_tiktok = !!tt && !!tt.tarjeta && tt.tarjeta.sitio === 'TikTok' && tt.tarjeta.dominio === 'vm.tiktok.com' && tt.tarjeta.visible && tt.tarjeta.imgs === 0 && tt.tarjeta.ancho <= 300;
  r.L3_sin_enlaces_peligrosos = !!vB.malos && vB.malos.anclas === 0;
  r.L4_normal_sin_tarjeta = !!vB.normal && vB.normal.enlaces.length === 1 && vB.normal.enlaces[0] === 'https://ejemplo.com/' && !!vB.normal.tarjeta && vB.normal.tarjeta.dominio === 'ejemplo.com';
  const site = (x) => x && x.tarjeta && x.tarjeta.sitio;
  r.L5_tarjetas = { ig: site(vB.ig), fb: site(vB.fb), yt: site(vB.yt), yt2: site(vB.yt2) };
  r.L5_otros_sitios = site(vB.ig) === 'Instagram' && site(vB.fb) === 'Facebook' && site(vB.yt) === 'YouTube' && site(vB.yt2) === 'YouTube' &&
    !!vB.yt2 && vB.yt2.enlaces[0] === 'https://m.youtube.com/watch?v=abc';
  r.L7_A_tambien = !!vA.tt && vA.tt.enlaces.length === 1 && !!vA.tt.tarjeta;

  // L2: tocar el enlace y la tarjeta → openUrl con la URL exacta; el WebView no navega ni abre ventanas
  const nav = [], popups = [];
  await B.route(/tiktok\.com|instagram\.com|fb\.watch|youtu|ejemplo\.com|malo\.com/, (route) => { nav.push(route.request().url()); route.abort().catch(() => {}); });
  B.context().on('page', (p) => popups.push(p.url()));
  const opened = () => nB.calls.filter((c) => c.name === 'openUrl').map((c) => c.args && c.args.url);
  const urlBefore = B.url();
  try { await B.locator('[data-prueba="tt"] a.nx-link').first().tap({ timeout: 4000 }); } catch (e) { r.L2_error_toque = String(e.message).slice(0, 120); }
  await sleep(700);
  r.L2_abre_fuera = opened();
  try { await B.locator('[data-prueba="tt"] .nx-link-card').first().tap({ timeout: 4000 }); } catch (e) { r.L2_error_tarjeta = String(e.message).slice(0, 120); }
  await sleep(700);
  r.L2_abre_fuera = opened();
  r.L2_no_navega = nav.length === 0 && popups.length === 0 && B.url() === urlBefore;
  r.L2_ok = r.L2_abre_fuera.length === 2 && r.L2_abre_fuera.every((u) => u === 'https://vm.tiktok.com/ZMabc123/') && r.L2_no_navega;

  // L6: pulsación larga sobre el enlace → menú de la burbuja (sin abrir el enlace); doble toque en la burbuja → ❤️
  const nOpen = opened().length;
  await B.evaluate(async () => {
    const a = document.querySelector('[data-prueba="ig"] a.nx-link');
    if (!a) return;
    const b = a.getBoundingClientRect(), x = b.left + 5, y = b.top + b.height / 2;
    const pe = (type) => new PointerEvent(type, { bubbles: true, cancelable: true, isPrimary: true, pointerId: 7, pointerType: 'touch', clientX: x, clientY: y });
    a.dispatchEvent(pe('pointerdown'));
    await new Promise((res) => setTimeout(res, 700));
    a.dispatchEvent(pe('pointerup'));
    a.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: x, clientY: y }));
  });
  await sleep(800);
  r.L6_pulsacion_larga_menu = await B.evaluate(() => !!document.getElementById('nexo-msg-menu') && !!document.querySelector('#nexo-msg-menu .mm-copy'));
  r.L6_pulsacion_larga_no_abre = opened().length === nOpen && nav.length === 0;
  await B.evaluate(() => { const m = document.getElementById('nexo-msg-menu'); if (m) m.remove(); });
  const dbl = (k, onLink) => B.evaluate(async ([k, onLink]) => {
    const m = document.querySelector('[data-prueba="' + k + '"]');
    const el = m && (onLink ? m.querySelector('a.nx-link') : m.querySelector('.msg-meta'));
    if (!el) return;
    const b = el.getBoundingClientRect(), x = b.left + 3, y = b.top + b.height / 2;
    const pe = (type) => new PointerEvent(type, { bubbles: true, cancelable: true, isPrimary: true, pointerId: 9, pointerType: 'touch', clientX: x, clientY: y });
    for (let i = 0; i < 2; i++) { el.dispatchEvent(pe('pointerdown')); el.dispatchEvent(pe('pointerup')); if (onLink) el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: x, clientY: y })); await new Promise((res) => setTimeout(res, 80)); }
  }, [k, onLink]);
  const nOpen2 = opened().length;
  await dbl('fb', true); await sleep(1200);
  // (la burbuja se vuelve a pintar al reaccionar: se busca otra vez por su texto)
  const reactedText = (txt) => B.evaluate((t) => { const m = Array.from(document.querySelectorAll('#messages-container .message')).find((x) => (x.querySelector('.msg-content') || {}).textContent === t); const rr = m && m.querySelector('.msg-reactions'); return !!rr && /❤/.test(rr.textContent); }, txt);
  r.L6_doble_toque_en_enlace_abre = opened().length === nOpen2 + 2;
  r.L6_doble_toque_en_enlace_no_reacciona = !(await reactedText(MSGS.fb));
  await dbl('tt', false);
  r.L6_doble_toque_reacciona = await waitFor(() => reactedText(MSGS.tt), 4000);

  // S2: app abierta, en la lista de chats: el nativo avisa onSharedText → «Enviar a…» → A → su chat con el texto en la caja
  await B.evaluate(() => { const b = document.getElementById('chat-back-btn'); if (b) b.click(); }); await sleep(800);
  const T2 = 'Mira este vídeo https://vm.tiktok.com/ZMshare1/';
  nB.emit('onSharedText', { text: T2 });
  r.S2_hoja = await waitFor(async () => { const rows = await sheetRows(B); return !!rows && rows.indexOf(idA) >= 0; }, 6000);
  r.S2_buscador = await B.evaluate((id) => {
    const s = document.getElementById('nexo-sendto-sheet'); const q = s && s.querySelector('input');
    const row = s && s.querySelector('[data-chat-id="' + id + '"]');
    if (!q || !row) return 'sin buscador o sin fila';
    const nm = (row.querySelector('.nx-pick-name') || {}).textContent || '';
    q.value = 'zzzz'; q.dispatchEvent(new Event('input', { bubbles: true }));
    const none = s.querySelectorAll('[data-chat-id]').length === 0;
    q.value = nm.slice(0, 2).toLowerCase(); q.dispatchEvent(new Event('input', { bubbles: true }));
    return none && !!s.querySelector('[data-chat-id="' + id + '"]') ? true : ('nombre «' + nm + '»');
  }, idA);
  await B.evaluate((id) => { const row = document.querySelector('#nexo-sendto-sheet [data-chat-id="' + id + '"]'); if (row) row.click(); }, idA);
  const chatWithText = (p, txt) => p.evaluate(([id, t]) => {
    const act = String((window.NEXO && window.NEXO.app && window.NEXO.app.activeContact && window.NEXO.app.activeContact.nexoId) || '').toLowerCase();
    const i = document.getElementById('message-input');
    return !document.getElementById('nexo-sendto-sheet') && document.body.classList.contains('chat-view-active') && act === id && !!i && i.value === t;
  }, [idA, txt]);
  r.S2_chat_con_texto = await waitFor(() => chatWithText(B, T2), 6000);
  r.S2_no_se_envia_solo = await B.evaluate((t) => !Array.from(document.querySelectorAll('#messages-container .message.own .msg-content')).some((c) => c.textContent === t), T2);
  await B.evaluate(() => { const i = document.getElementById('message-input'); i.value = ''; i.dispatchEvent(new Event('input', { bubbles: true })); });

  // S3: app CERRADA: el nativo arranca (load) y avisa antes de que exista el JS → retenido hasta que el JS escucha
  await B.close();
  nB.destroyActivity(); nB.load();
  const T3 = 'https://youtu.be/abcdefghijk ' + 'x'.repeat(5000);
  nB.emit('onSharedText', { text: T3 });
  B = (await bootPhone(browser, 'B', nB, dist, { phone: true, logs, seedName: 'Beto', lang: 'es' })).page;
  r.S3_hoja_en_frio = await waitFor(async () => { const rows = await sheetRows(B); return !!rows && rows.indexOf(idA) >= 0; }, 15000);
  await B.evaluate((id) => { const row = document.querySelector('#nexo-sendto-sheet [data-chat-id="' + id + '"]'); if (row) row.click(); }, idA);
  r.S3_chat_con_texto_cortado = await waitFor(() => chatWithText(B, T3.slice(0, 4000)), 8000);
  r.S3_largo = await B.evaluate(() => (document.getElementById('message-input') || {}).value.length);

  r.errores = logs.filter((l) => /PAGEERROR|TypeError|is not a function|ReferenceError/.test(l)).slice(0, 4);
  const ok = r.L1_enlace_tocable && r.L1_tarjeta_tiktok && r.L2_ok && r.L3_sin_enlaces_peligrosos && r.L4_normal_sin_tarjeta && r.L5_otros_sitios &&
    r.L6_pulsacion_larga_menu && r.L6_pulsacion_larga_no_abre && r.L6_doble_toque_reacciona && r.L6_doble_toque_en_enlace_abre && r.L6_doble_toque_en_enlace_no_reacciona &&
    r.L7_A_tambien && r.S1_aviso_sin_contactos && r.S2_hoja && r.S2_buscador === true && r.S2_chat_con_texto && r.S2_no_se_envia_solo &&
    r.S3_hoja_en_frio && r.S3_chat_con_texto_cortado && r.errores.length === 0;
  r.resultado = ok ? 'OK' : 'FALLO';
  delete r.B; if (!ok) r.detalle_B = vB;
  console.log('ENLACES ' + JSON.stringify(r));
  try { fs.writeFileSync(path.join(__dirname, 'last_logs_enlaces.txt'), logs.join('\n')); } catch (e) {}
  await browser.close();
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('ENLACES ' + JSON.stringify({ prueba: 'enlaces', resultado: 'FALLO', error: String(e && e.stack).slice(0, 400) })); process.exit(1); });
