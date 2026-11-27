// 3169 — LOS ESTADOS EN SU PROPIA PANTALLA (dueño 17-11: «sacar los estados de arriba de Contactos y llevarlos a una pantalla nueva a
// la que se llega DESLIZANDO la pantalla de Contactos de derecha a izquierda»; SOLO GESTOS y pantalla limpia: nada de botones,
// pestañas, etiquetas ni puntitos; como ayuda, un aviso de texto UNA sola vez).
// Chromium real a 360 px, toques de verdad por CDP. A (Ana) y B (Beto; en la lista de A sale como «B») emparejados; B publica un estado.
//  E1  Contactos ya NO tiene la tira de estados (ni ningún estado) y la pantalla Estados no se ve
//  E2  la pantalla sigue al dedo; un desliz corto y lento vuelve a Contactos
//  E3  deslizar ← desde el centro abre Estados: «Mi estado» primero, el círculo de B, sin botones, cabe en 360 y (3230) el estado
//      de B ya se ve a pantalla completa sin tocar nada
//  E4  tocar el círculo de B lleva a su estado (sin ventana aparte: sigue en Estados); el aro pasa a «visto»
//  E5  deslizar hacia abajo en Estados actualiza («[ACTUALIZAR] Deslizar») y no cambia de pantalla
//  E6  deslizar → vuelve a Contactos (y vuelve el botón de agregar); el «atrás» de Android en Estados vuelve; sin nada abierto, false
//  E7  deslizar vertical en Contactos hace scroll y no cambia; un gesto que empieza a 10 px del borde derecho no abre Estados; deslizar
//      de lado en la tira «en línea» la mueve a ella y no abre Estados; en el chat, deslizar ← no abre Estados
//  E8  tocar el nombre en el visor abre el chat y se ve (Estados se quita)
//  E10 (26-11) estados nuevos → destello en el borde derecho; se va al primer toque; no vuelve por los mismos
//  E9  el aviso «Desliza a la izquierda…» sale la primera vez, se va al primer toque, y tras reiniciar no vuelve a salir
// Contraprueba: en la 3168 (b5b8628c) E1 y E3… fallan (la tira está en Contactos y no hay pantalla).
// Uso: node estadospantalla.js <dir_build> [dir_capturas]
'use strict';
const fs = require('fs');
const path = require('path');
if (!process.env.SHOTS_VIEWPORT) process.env.SHOTS_VIEWPORT = '360x740';
const { PW, bootPhone, sleep } = require('./pw_harness');
const { Radio, NativePhone } = require('./native_mock');

const dist = path.resolve(process.argv[2], 'dist');
const shots = process.argv[3] ? path.resolve(process.argv[3]) : '';
const logs = [];
const r = { prueba: 'estadospantalla', build: path.basename(process.argv[2]) };
const fin = (ok) => {
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('ESTADOSPANTALLA ' + JSON.stringify(r));
  try { fs.writeFileSync(path.join(__dirname, 'last_logs_estadospantalla.txt'), logs.join('\n')); } catch (e) {}
};

(async () => {
  const browser = await PW.chromium.launch();
  const radio = new Radio();
  const opts = { readsContentFallback: true, retain: ['onPayloadReceived'], closeOnNoService: true, pace: [5, 5], ioDelay: 10, asymmetric: true, noTor: true };
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', opts), nB = new NativePhone('B', 'BB:BB:BB:BB:BB:02', opts);
  radio.add(nA); radio.add(nB); nA.load(); nB.load();
  const phA = await bootPhone(browser, 'A', nA, dist, { phone: true, logs, seedName: 'Ana', lang: 'es' });
  const A = phA.page, cdp = phA.cdp;
  const shot = async (name) => { if (shots) { fs.mkdirSync(shots, { recursive: true }); await A.screenshot({ path: path.join(shots, name) }); } };
  const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
  const swipe = async (x0, y0, x1, y1, ms) => {
    const n = Math.max(3, Math.round(ms / 16));
    await touch('touchStart', x0, y0);
    for (let i = 1; i <= n; i++) { await sleep(ms / n); await touch('touchMove', x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n); }
    await touch('touchEnd');
  };
  const tap = async (x, y) => { await touch('touchStart', x, y); await sleep(50); await touch('touchEnd'); await sleep(500); };
  const st = () => A.evaluate(() => {
    const s = document.getElementById('estados-screen'), q = s && s.getBoundingClientRect(), a = document.getElementById('app').getBoundingClientRect();
    const fab = document.getElementById('ble-fab-btn');
    return { abierta: document.body.classList.contains('nx-est-on'), scr: q ? Math.round(q.left) : null, vis: s ? getComputedStyle(s).visibility : '', app: Math.round(a.left), W: innerWidth,
      fab: fab ? getComputedStyle(fab).opacity : '', chat: document.body.classList.contains('chat-view-active') };
  });
  const enEstados = (s) => s.abierta && s.scr === 0 && s.app <= -s.W + 1;
  const enContactos = (s) => !s.abierta && s.app === 0 && (s.scr === null || s.scr >= s.W || s.vis === 'hidden');
  const W = 360, CY = 420;

  // E9a: el aviso de una vez sale (texto, sin botón) y se va al primer toque
  let hint = null;
  for (let i = 0; i < 40 && !hint; i++) { hint = await A.evaluate(() => { const h = document.getElementById('nexo-est-hint'); return h ? { t: h.textContent, botones: h.querySelectorAll('button').length } : null; }); if (!hint) await sleep(200); }
  r.aviso = hint && hint.t;
  r.E9_aviso_sale = !!hint && /Desliza a la izquierda/.test(hint.t) && hint.botones === 0;
  if (hint) await shot('aviso_una_vez.png');
  await tap(120, 30);   // un toque en el título de Contactos
  await sleep(300);
  r.E9_aviso_se_va_al_tocar = !!hint && !(await A.evaluate(() => !!document.getElementById('nexo-est-hint')));

  // Emparejar A con B y que B publique un estado
  const phB = await bootPhone(browser, 'B', nB, dist, { phone: true, logs, seedName: 'Beto', lang: 'es' });
  const B = phB.page;
  await A.evaluate(() => window.bleInterface.togglePanel());
  for (let i = 0; i < 100; i++) { await sleep(150); if (await A.evaluate(() => !!document.querySelector('#ble-new-device button'))) break; await A.evaluate(() => { if (!window.bleInterface.isScanning) { const b = document.getElementById('ble-scan-btn'); if (b) b.click(); } }); }
  await A.evaluate(() => { const b = document.querySelector('#ble-new-device button'); if (b) b.click(); }); await sleep(1800);
  await A.evaluate(() => { if (document.getElementById('ble-panel').classList.contains('active')) window.bleInterface.togglePanel(); });
  const idB = await B.evaluate(() => window.bleInterface.localNexoId.toLowerCase());
  for (let i = 0; i < 60; i++) { if (await B.evaluate(() => !!document.querySelector('#main-contacts-list .ble-contact-row'))) break; await sleep(250); }
  await sleep(1500);
  await B.evaluate(() => window.NEXO_addMyStatus('hola desde Beto'));
  let llego = false;
  for (let i = 0; i < 100 && !llego; i++) { llego = await A.evaluate((id) => (window.NEXO_statusesOf(id) || []).some((x) => x.t === 'hola desde Beto'), idB); if (!llego) await sleep(250); }
  r.preparado = llego;
  await sleep(600);

  // E10 (26-11, dueño): estados NUEVOS → una rayita que late en el borde derecho; se va al primer toque; no vuelve por los mismos estados
  let edge = false;
  for (let i = 0; i < 30 && !edge; i++) { edge = await A.evaluate(() => { try { window.__nexoEdgeCheck(); } catch (e) {} const e = document.getElementById('nexo-est-edge'); return !!e && getComputedStyle(e).pointerEvents === 'none' && e.getBoundingClientRect().right >= innerWidth - 1; }); if (!edge) await sleep(300); }
  r.E10_destello_sale = edge;
  await shot('destello_borde.png');
  await tap(120, 30); await sleep(700);
  r.E10_se_va_al_tocar = edge && !(await A.evaluate(() => !!document.getElementById('nexo-est-edge')));
  await A.evaluate(() => { try { window.__nexoEdgeCheck(); } catch (e) {} }); await sleep(300);
  r.E10_no_vuelve_por_los_mismos = !(await A.evaluate(() => !!document.getElementById('nexo-est-edge')));
  // E11 (26-11, «lo intuitivo»): el botón de Estados está en la cabecera (visible, redondo como la lupa) y con puntito mientras hay estados sin ver
  r.E11_boton_visible = await A.evaluate(() => { const b = document.getElementById('nexo-estados-btn'), l = document.getElementById('nexo-contacts-search-btn'); if (!b || !l) return false; const q = b.getBoundingClientRect(), z = l.getBoundingClientRect(); return q.width === z.width && q.height === z.height && q.top === z.top && q.left > z.right - 1 && q.right <= innerWidth; });
  r.E11_puntito = await A.evaluate(() => { const b = document.getElementById('nexo-estados-btn'); return !!b && b.classList.contains('has-new'); });

  // E1: Contactos limpio
  const c1 = await A.evaluate(() => {
    const cv = document.getElementById('contacts-view');
    return { tira: !!document.getElementById('main-estados-strip'), chips: cv ? cv.querySelectorAll('.estado-chip').length : -1, fila: !!document.querySelector('#main-contacts-list .ble-contact-row') };
  });
  let s = await st();
  r.E1_contactos_sin_estados = !c1.tira && c1.chips === 0 && c1.fila && enContactos(s);
  await shot('contactos_limpio.png');

  // E2: sigue al dedo (72 px a la izquierda) y, soltado corto y lento, vuelve
  await touch('touchStart', 270, CY);
  for (let i = 1; i <= 6; i++) { await sleep(16); await touch('touchMove', 270 - 12 * i, CY); }
  await sleep(60);
  const mid = await st();
  await shot('arrastrando.png');
  await sleep(150); await touch('touchEnd'); await sleep(500);
  s = await st();
  r.arrastre = { scr: mid.scr, app: mid.app };
  r.E2_sigue_al_dedo = mid.scr !== null && Math.abs(mid.scr - (W - 72)) <= 4 && Math.abs(mid.app + 72) <= 4;
  r.E2_corto_vuelve = enContactos(s);

  // E3: deslizar ← desde el centro abre Estados
  await swipe(270, CY, 60, CY, 200); await sleep(500);
  s = await st();
  r.E3_abre_estados = enEstados(s);
  r.E3_sin_boton_agregar = s.fab === '0';
  const cont = await A.evaluate((id) => {
    const sc = document.getElementById('estados-screen'); if (!sc) return null;
    const rows = Array.from(sc.querySelectorAll('.estado-chip')), beto = rows.find((x) => x.getAttribute('data-nx') === id);
    const v = document.getElementById('estado-view'), q = v && v.getBoundingClientRect();
    return { primero_mi: !!rows[0] && /Mi estado/.test(rows[0].textContent), beto: !!beto, beto_sub: beto ? beto.textContent : '',
      botones: sc.querySelectorAll('button').length, cabe: sc.scrollWidth <= innerWidth && rows.every((x) => x.getBoundingClientRect().right <= innerWidth),
      a_la_vista: v ? v.textContent.slice(0, 40) : '', completa: !!q && q.width === innerWidth && q.height === innerHeight };
  }, idB);
  r.contenido = cont;
  r.E3_contenido = !!cont && cont.primero_mi && cont.beto && cont.botones === 0 && cont.cabe && /hola desde Beto/.test(cont.a_la_vista) && cont.completa;
  await shot('estados.png');

  // E4: tocar el círculo de Beto lleva a su estado, sin ventana aparte (sigue en Estados); el aro pasa a visto
  const pos = await A.evaluate((id) => { const b = document.querySelector('#estados-screen .estado-chip[data-nx="' + id + '"]'); if (!b) return null; const q = b.getBoundingClientRect(); return { x: q.left + q.width / 2, y: q.top + q.height / 2 }; }, idB);
  if (pos) await tap(pos.x, pos.y);
  r.E4_tocar_abre_visor = /hola desde Beto/.test(await A.evaluate(() => (document.getElementById('estado-view') || {}).textContent || ''));
  await shot('visor.png');
  s = await st();
  r.E4_atras_cierra_visor = !(await A.evaluate(() => !!document.getElementById('estado-overlay'))) && enEstados(s);
  r.E4_aro_visto = await A.evaluate((id) => { const b = document.querySelector('#estados-screen .estado-chip[data-nx="' + id + '"]'); const av = b && b.querySelector('.nx-est-av'); return !!av && av.classList.contains('visto'); }, idB);
  await shot('estados_visto.png');

  // E5: deslizar hacia abajo en Estados actualiza
  const mark = logs.length;
  await swipe(180, 160, 182, 420, 450); await sleep(900);
  s = await st();
  r.E5_abajo_actualiza = logs.slice(mark).some((l) => /\[A\] \[ACTUALIZAR\] Deslizar/.test(l));
  r.E5_abajo_no_cambia = enEstados(s);

  // E6: → vuelve; el «atrás» de Android en Estados vuelve; sin nada abierto da false
  await swipe(60, CY, 300, CY, 200); await sleep(500);
  s = await st();
  r.E6_derecha_vuelve = enContactos(s) && s.fab === '1';
  await swipe(270, CY, 60, CY, 200); await sleep(500);
  const abierta2 = enEstados(await st());
  const back2 = await A.evaluate(() => window.__nexoHandleBack());
  await sleep(500); s = await st();
  r.E6_atras_vuelve = abierta2 && back2 === true && enContactos(s);
  r.E6_atras_sin_nada_false = (await A.evaluate(() => window.__nexoHandleBack())) === false;

  // E7: vertical = scroll; borde derecho; tira «en línea»; en el chat
  await A.evaluate(() => { const d = document.createElement('div'); d.id = 't-alto'; d.style.height = '2400px'; document.getElementById('main-contacts-list').appendChild(d); });
  await swipe(200, 620, 180, 240, 300); await sleep(600);
  const scrolled = await A.evaluate(() => Math.max(document.getElementById('contacts-view').scrollTop, document.getElementById('main-contacts-list').scrollTop));
  s = await st();
  r.scroll_px = scrolled;
  r.E7_vertical_es_scroll = scrolled > 50 && enContactos(s);
  await A.evaluate(() => { const d = document.getElementById('t-alto'); if (d) d.remove(); document.getElementById('contacts-view').scrollTop = 0; document.getElementById('main-contacts-list').scrollTop = 0; });
  await sleep(300);
  await swipe(W - 10, CY, 60, CY, 200); await sleep(500);
  r.E7_borde_derecho_no = enContactos(await st());
  // la tira «en línea» se desliza de lado (aquí se le pone contenido ancho para que tenga por dónde): la tira se mueve y Estados no se abre
  // (26-11: si «en línea» se redibuja justo en ese momento, borra el contenido ancho y el desliz cae en el vacío: se vuelve a armar y a intentar, hasta 3 veces)
  let strip = null, stripX = 0;
  for (let k = 0; k < 3 && stripX <= 50; k++) {
    strip = await A.evaluate(() => {
      const e = document.getElementById('main-contacts-online-strip'); if (!e) return null;
      if (!document.getElementById('t-ancho')) { const d = document.createElement('div'); d.id = 't-ancho'; d.style.cssText = 'width:1600px;height:70px;flex-shrink:0;'; e.appendChild(d); }
      e.style.display = 'flex'; e.scrollLeft = 0;
      const q = e.getBoundingClientRect(); return { y: q.top + q.height / 2 };
    });
    if (!strip) break;
    await swipe(270, strip.y, 60, strip.y, 200); await sleep(500);
    stripX = await A.evaluate(() => { const e = document.getElementById('main-contacts-online-strip'); return e ? e.scrollLeft : 0; });
  }
  await A.evaluate(() => { const d = document.getElementById('t-ancho'); if (d) d.remove(); const e = document.getElementById('main-contacts-online-strip'); if (e) { e.scrollLeft = 0; e.style.display = ''; } });
  r.tira_scroll_px = stripX;
  r.E7_tira_en_linea_no = !!strip && stripX > 50 && enContactos(await st());
  await A.evaluate(() => { const row = document.querySelector('#main-contacts-list .ble-contact-row'); if (row) row.click(); }); await sleep(900);
  await swipe(280, CY, 60, CY, 200); await sleep(500);
  s = await st();
  r.E7_chat_no_abre_estados = s.chat && !s.abierta && s.vis !== 'visible';
  await A.evaluate(() => window.__nexoHandleBack()); await sleep(600);

  // E8: desde Estados, tocar el nombre en el visor abre el chat y se ve (Estados se quita)
  await swipe(270, CY, 60, CY, 200); await sleep(500);
  const pos2 = await A.evaluate((id) => { const b = document.querySelector('#estados-screen .estado-chip[data-nx="' + id + '"]'); if (!b) return null; const q = b.getBoundingClientRect(); return { x: q.left + q.width / 2, y: q.top + q.height / 2 }; }, idB);
  if (pos2) await tap(pos2.x, pos2.y);
  await A.evaluate(() => { const w = document.getElementById('estado-who'); if (w) w.click(); }); await sleep(900);
  s = await st();
  r.E8_nombre_abre_chat_visible = s.chat && !s.abierta && s.app === 0 && s.vis !== 'visible';
  await A.evaluate(() => window.__nexoHandleBack()); await sleep(600);

  // E11b: tocar el botón abre Estados (sin gesto) y volver lo cierra
  await A.evaluate(() => document.getElementById('nexo-estados-btn').click()); await sleep(700);
  r.E11_toca_abre = enEstados(await st());
  // dueño 26-11 (3160): el botón es una flecha y al tocarlo sale el letrero que enseña el gesto, encima de Estados, y se quita solo
  r.E11_flecha = await A.evaluate(() => { const p = document.querySelectorAll('#nexo-estados-btn svg path'); return p.length === 2 && !document.querySelector('#nexo-estados-btn svg rect'); });
  r.E11_letrero = await A.evaluate(() => { const h = document.getElementById('nexo-est-btnhint'); return !!h && /Desliza la pantalla hacia la izquierda/.test(h.textContent) && parseInt(getComputedStyle(h).zIndex, 10) > 2500; });
  await sleep(4200);
  r.E11_letrero_se_quita = await A.evaluate(() => !document.getElementById('nexo-est-btnhint'));
  await A.evaluate(() => window.__nexoHandleBack()); await sleep(700);
  r.E11_vuelve = enContactos(await st());

  // E9b: tras reiniciar la app, el aviso no vuelve
  await A.reload();
  await A.waitForFunction(() => window.NEXO && window.NEXO.initialized, null, { timeout: 60000 });
  let otra = false;
  for (let i = 0; i < 25 && !otra; i++) { otra = await A.evaluate(() => !!document.getElementById('nexo-est-hint')); if (!otra) await sleep(200); }
  r.E9_aviso_no_segunda = !otra;

  const ok = ['E1_contactos_sin_estados', 'E2_sigue_al_dedo', 'E2_corto_vuelve', 'E3_abre_estados', 'E3_sin_boton_agregar', 'E3_contenido', 'E4_tocar_abre_visor', 'E4_atras_cierra_visor', 'E4_aro_visto',
    'E5_abajo_actualiza', 'E5_abajo_no_cambia', 'E6_derecha_vuelve', 'E6_atras_vuelve', 'E6_atras_sin_nada_false', 'E7_vertical_es_scroll', 'E7_borde_derecho_no', 'E7_chat_no_abre_estados',
    'E7_tira_en_linea_no', 'E8_nombre_abre_chat_visible', 'E9_aviso_sale', 'E9_aviso_se_va_al_tocar', 'E9_aviso_no_segunda', 'E10_destello_sale', 'E10_se_va_al_tocar', 'E10_no_vuelve_por_los_mismos', 'E11_boton_visible', 'E11_puntito', 'E11_toca_abre', 'E11_vuelve', 'E11_flecha', 'E11_letrero', 'E11_letrero_se_quita'].every((k) => r[k] === true) && r.preparado;
  fin(ok);
  await browser.close();
  process.exit(ok ? 0 : 1);
})().catch((e) => { r.error = String(e && e.stack).slice(0, 500); fin(false); process.exit(1); });
