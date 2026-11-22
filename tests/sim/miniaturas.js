// 3277 (dueño 22-11: «al pasar varias veces de pantalla normal a miniatura, que ya no haya problemas»; «al abrir la app aparecía el
// chat y la miniatura, pero la miniatura ya no respondía»; capturas: la ventanita del sistema con el chat apretado).
// Videollamada de verdad en Chromium (A y B, mismo Wi-Fi). El «teléfono» de A dice la verdad sobre la miniatura (nat.A.pipNow, lo que
// contesta el nativo en pipState) y los avisos de Android (window.__nexoPipChanged) se mandan, se pierden o llegan desordenados:
//  c  8 vueltas normal → miniatura → app: en la ventanita solo la imagen del otro (llena, sin botones ni textos) y la imagen sigue
//     llegando; al volver, la mini flotante encima de la app, que RESPONDE a un toque de verdad (pantalla completa con sus botones);
//     en las vueltas impares se vuelve a la miniatura desde la mini flotante; al final nada pegado y la llamada sigue en los dos;
//  s  avisos perdidos: entrar sin aviso (solo cambia la ventana) → igual queda como miniatura; salir sin aviso → mini flotante y la
//     app normal; con el nativo mudo y la marca pegada, el primer toque de verdad la corrige; avisos seguidos desordenados → manda
//     la verdad;
//  m  con la llamada minimizada (barra arriba) → la ventanita enseña la llamada, no la app con la barra; al volver, mini flotante;
//  t  la llamada termina con la mini flotante → el final no queda como mini y una llamada nueva nace a pantalla completa (Contestar a la vista);
//  f  la llamada termina EN la miniatura → se le pide al nativo cerrarla; después nada pegado;
//  z  la app se rehízo y el nativo aún cree que hay videollamada: en miniatura sin llamada se cierra (no queda el chat apretado en
//     la ventanita) y, fuera de ella, la marca vieja se quita sola.
//  g  3282 (dueño 22-11: «en un chat deslizo hacia arriba y, en vez de quedarse en segundo plano, crea la miniatura»): el GESTO de
//     irse solo pasa a la miniatura con una videollamada viva. Con la marca «al irse, pasar a miniatura» puesta de antes: en un chat
//     sin llamada el gesto NO la crea y la marca se quita sola; con una llamada de VOZ tampoco; al pasar a vídeo sí; y si el teléfono
//     la quitó con la videollamada viva, vuelve sola. (--nativo-viejo: el teléfono de antes, que solo miraba la marca)
// Uso: node miniaturas.js <dir_build>   (AV_SHOTS=<carpeta>: capturas)
'use strict';
const fs = require('fs');
const path = require('path');
const { callHarness, click, waitFor, clickRowNamed, closeChat, calls, media1, pipLook, sleep } = require('./callharness');

const buildDir = path.resolve(process.argv[2]);
const SHOTS = process.env.AV_SHOTS || '';
const FULL = { width: 384, height: 830 }, PIP = { width: 132, height: 236 };

(async () => {
  const r = { prueba: 'miniaturas', build: path.basename(buildDir), fases_con_error: {} };
  const H = await callHarness({ buildDir, names: ['A', 'B'], shots: SHOTS });
  const { P, nat, logs } = H;
  if (!(await H.pair('A', 'B'))) { console.log('MINIATURAS ' + JSON.stringify({ prueba: 'miniaturas', resultado: 'FALLO', error: 'no empareja' })); process.exit(1); }
  r.wifi_s = await H.wifiAll();
  const fase = async (n, fn) => { try { await fn(); } catch (e) { r.fases_con_error[n] = String(e && e.message).slice(0, 200); } try { nat.A.pipNow = false; await P.A.setViewportSize(FULL); await P.A.evaluate(() => window.__nexoPipChanged && window.__nexoPipChanged(false)); } catch (x) {} try { await H.hangAll(); } catch (x) {} };
  // Lo que hay en pantalla: marcas, la mini (dónde y si es lo de encima), botones a la vista, pantallas de llamada que existen
  const look = async () => Object.assign(await pipLook(P.A), await P.A.evaluate(() => {
    const el = document.getElementById('nexo-call-screen'), root = document.documentElement, b = el && el.getBoundingClientRect();
    const top = el && b.width > 1 ? document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2) : null;
    const mid = document.elementFromPoint(innerWidth / 2, innerHeight / 3), app = document.getElementById('app');
    return { nxpip: root.classList.contains('nx-pip'), hay: !!el, pantallas: document.querySelectorAll('#nexo-call-screen').length,
      mini: !!el && el.classList.contains('nc-appmini'), pipwin: !!el && el.classList.contains('nc-pipwin'), minimizada: !!el && el.classList.contains('nc-minimized'),
      barra: !!document.getElementById('nexo-call-bar') && document.getElementById('nexo-call-bar').checkVisibility(),
      caja: b ? [Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height)] : null, encima: !!top && el.contains(top), app_debajo: !!mid && !!app && app.contains(mid) };
  }));
  const enter = async (aviso) => { nat.A.pipNow = true; await P.A.setViewportSize(PIP); if (aviso) await P.A.evaluate(() => window.__nexoPipChanged(true)); await sleep(aviso ? 500 : 1300); };
  const leave = async (aviso) => { nat.A.pipNow = false; await P.A.setViewportSize(FULL); if (aviso) await P.A.evaluate(() => window.__nexoPipChanged(false)); await sleep(aviso ? 500 : 1300); };
  const tapMini = async () => { const b = await P.A.evaluate(() => { const x = document.getElementById('nexo-call-screen').getBoundingClientRect(); return [x.left + x.width / 2, x.top + x.height / 2]; }); await P.A.touchscreen.tap(b[0], b[1]); await sleep(500); };
  const llena = (l) => l.su_imagen.length === 1 && l.su_imagen[0][2] >= l.W - 2 && l.su_imagen[0][3] >= l.H - 2;
  const soloVideo = (l) => l.nxpip && l.botones === 0 && l.textos === 0 && l.mi_imagen === 0 && llena(l) && !l.mini && !l.barra;
  const esMini = (l) => !l.nxpip && !l.pipwin && l.mini && l.caja && l.caja[2] <= 130 && l.caja[3] <= 200 && l.encima && l.app_debajo && l.botones === 0;
  const completa = (l) => !l.nxpip && !l.pipwin && !l.mini && l.caja && l.caja[2] >= 380 && l.botones >= 7 && l.pantallas === 1;

  // ── c: 8 vueltas
  await fase('c', async () => {
    r.c_activa_s = await H.call('A', 'B', {});
    await waitFor(async () => (await media1(P.A)).video_recibido > 10, 15000);
    r.c_pip_pedido = nat.A.pipVideo === true;
    r.c_vueltas = [];
    for (let i = 0; i < 8; i++) {
      const g0 = (await media1(P.A)).video_recibido;
      await enter(true); await sleep(700);
      const en = await look(), g1 = (await media1(P.A)).video_recibido;
      if (SHOTS && i === 0) await P.A.screenshot({ path: path.join(SHOTS, 'mini_ventanita.png') });
      await leave(true);
      const al = await look();
      if (SHOTS && i === 0) await P.A.screenshot({ path: path.join(SHOTS, 'mini_flotante.png') });
      let tras = null;
      if (i % 2 === 0) { await tapMini(); tras = await look(); }
      r.c_vueltas.push({ ventanita: soloVideo(en), imagen_sigue: g1 - g0, mini: esMini(al), toque: tras ? completa(tras) : 'no se toca', detalle: soloVideo(en) && esMini(al) && (!tras || completa(tras)) ? undefined : { en, al, tras } });
    }
    await tapMini();
    r.c_final = await look();
    r.c_llamadas = { A: (await calls(P.A)).uno, B: (await calls(P.B)).uno };
  });

  // ── s: avisos perdidos
  await fase('s', async () => {
    await H.call('A', 'B', {});
    await waitFor(async () => (await media1(P.A)).video_recibido > 10, 15000);
    await enter(false); r.s_entra_sin_aviso = await look();
    await leave(false); r.s_sale_sin_aviso = await look();
    await enter(false); r.s_de_mini_a_ventanita = await look(); // desde la mini flotante, sin aviso: no queda la mini cortada con el chat
    await leave(false); await tapMini(); r.s_completa = await look();
    // el nativo no contesta (como una versión sin pipState) y el aviso de salida se pierde: la marca queda pegada… hasta el primer toque
    nat.A.pipNow = undefined;
    await P.A.evaluate(() => window.__nexoPipChanged(true)); await sleep(1200);
    r.s_pegada = await look();
    await P.A.touchscreen.tap(190, 300); await sleep(500);
    r.s_tras_toque = await look();
    await tapMini(); r.s_tras_mini = await look();
    // avisos seguidos y desordenados: manda la verdad (en miniatura)
    nat.A.pipNow = true; await P.A.setViewportSize(PIP);
    await P.A.evaluate(() => { window.__nexoPipChanged(true); window.__nexoPipChanged(false); window.__nexoPipChanged(true); window.__nexoPipChanged(false); });
    await sleep(1500); r.s_desorden_en = await look();
    nat.A.pipNow = false; await P.A.setViewportSize(FULL);
    await P.A.evaluate(() => { window.__nexoPipChanged(false); window.__nexoPipChanged(true); });
    await sleep(1500); r.s_desorden_fuera = await look();
  });

  // ── m: minimizada (barra) → miniatura
  await fase('m', async () => {
    await H.call('A', 'B', {});
    await waitFor(async () => (await media1(P.A)).video_recibido > 10, 15000);
    r.m_atras = await P.A.evaluate(() => window.__nexoHandleBack()); await sleep(600);
    r.m_barra = (await look()).barra;
    await enter(true); r.m_ventanita = await look();
    await leave(true); r.m_vuelve = await look();
    await tapMini(); r.m_completa = await look();
  });

  // ── t: termina con la mini flotante; la siguiente nace entera
  await fase('t', async () => {
    await H.call('A', 'B', {});
    await waitFor(async () => (await media1(P.A)).video_recibido > 10, 15000);
    await enter(true); await leave(true);
    r.t_mini = esMini(await look());
    await P.B.evaluate(() => window.bleInterface.calls.hangup());
    await waitFor(async () => (await calls(P.A)).uno === null, 10000); await sleep(200);
    r.t_final = await look(); // la pantalla del final («Llamada finalizada»), aún a la vista
    // B vuelve a llamar enseguida (antes de que se quite la pantalla del final)
    await clickRowNamed(P.B, '#main-contacts-list .ble-contact-row', 'A'); await sleep(300);
    await click(P.B, '#nexo-call-btn'); await closeChat(P.B);
    r.t_suena_s = await waitFor(async () => (await calls(P.A)).uno === 'ringing', 15000); await sleep(400);
    r.t_entrante = Object.assign(await look(), { contestar: await P.A.evaluate(() => { const b = document.querySelector('#nexo-call-screen .call-accept'); return !!b && b.checkVisibility(); }) });
  });

  // ── f: termina EN la miniatura
  await fase('f', async () => {
    await H.call('A', 'B', {});
    await waitFor(async () => (await media1(P.A)).video_recibido > 10, 15000);
    await enter(true);
    const cerradas0 = nat.A.pipClosed || 0;
    await P.B.evaluate(() => window.bleInterface.calls.hangup());
    await waitFor(async () => (await calls(P.A)).uno === null, 10000); await sleep(300);
    r.f_cerrada = (nat.A.pipClosed || 0) - cerradas0; r.f_pip_apagado = nat.A.pipVideo === false;
    await P.A.setViewportSize(FULL); await P.A.evaluate(() => window.__nexoPipChanged(false)); // (Android: la ventanita se cerró)
    await sleep(2500);
    r.f_despues = await look();
  });

  // ── z: la app se rehízo; el nativo aún cree que hay videollamada
  await fase('z', async () => {
    const cerradas0 = nat.A.pipClosed || 0;
    nat.A.pipVideo = true; nat.A.pipNow = true;
    await P.A.setViewportSize(PIP); await P.A.evaluate(() => window.__nexoPipChanged(true)); await sleep(800);
    r.z_cerrada = (nat.A.pipClosed || 0) - cerradas0; r.z_marca = nat.A.pipVideo;
    await P.A.setViewportSize(FULL); await P.A.evaluate(() => window.__nexoPipChanged(false)); await sleep(600);
    r.z_despues = await look();
    nat.A.pipVideo = true; nat.A.pipNow = false; // la marca vieja, sin estar en miniatura: se quita al mirar
    await P.A.evaluate(() => window.dispatchEvent(new Event('focus'))); await sleep(900);
    r.z_marca_vieja = nat.A.pipVideo;
  });

  // ── g: el gesto de irse y la marca «al irse, pasar a miniatura»
  // gesto() = lo que hace el teléfono al deslizar hacia arriba (MainActivity.onUserLeaveHint y la entrada automática de Android 12+):
  // pasa a miniatura con la marca puesta Y el audio de llamada en marcha (BleService.pipOnLeave); si no, la app va a segundo plano
  const viejo = process.argv.includes('--nativo-viejo');
  nat.A.opts.pipSticky = viejo;
  const gesto = () => nat.A.pipVideo === true && (viejo || nat.A.callAudioOn === true);
  await fase('g', async () => {
    await H.call('A', 'B', {}); await waitFor(async () => (await media1(P.A)).video_recibido > 10, 15000);
    r.g_videollamada_viva_gesto = gesto();            // con la videollamada viva, SÍ miniatura
    await H.hangAll();
    r.g_tras_colgar_gesto = gesto();
    // la marca quedó PUESTA de antes y el usuario está en un chat, sin llamada: el gesto no debe crear la miniatura
    await clickRowNamed(P.A, '#main-contacts-list .ble-contact-row', 'B'); await sleep(400);
    nat.A.pipVideo = true;
    r.g_chat_gesto = gesto();
    await P.A.evaluate(() => window.dispatchEvent(new Event('focus'))); await sleep(900);
    r.g_chat_marca = nat.A.pipVideo;                   // y la marca se quita sola
    await closeChat(P.A);
    // llamada de VOZ viva con la marca puesta de antes: se quita con el primer cambio de la llamada; el gesto no hace miniatura
    r.g_voz_activa_s = await H.call('A', 'B', { voice: true });
    nat.A.pipVideo = true;
    await P.A.evaluate(() => { const c = window.bleInterface.calls; c.mute(true); c.mute(false); }); await sleep(1300);
    r.g_voz_marca = nat.A.pipVideo;
    r.g_voz_gesto = gesto();
    // la llamada de voz PASA a vídeo: ahora sí
    await P.A.evaluate(() => window.bleInterface.calls.toVideo()); await sleep(1500);
    r.g_pasa_a_video_gesto = gesto();
    // el teléfono quitó la marca con la videollamada viva: vuelve sola al primer cambio
    nat.A.pipVideo = false;
    await P.A.evaluate(() => { const c = window.bleInterface.calls; c.mute(true); c.mute(false); }); await sleep(1300);
    r.g_marca_vuelve = nat.A.pipVideo;
    await H.hangAll();
    r.g_final_gesto = gesto();
  });

  r.avisos = logs.filter((l) => /\[A\] \[CALL\] (Miniatura|Mini flotante|Toque con la miniatura)/.test(l)).length;
  r.errores = logs.filter((l) => /PAGEERROR/.test(l)).slice(0, 5);
  const num = (v) => typeof v === 'number';
  const v = {}, chk = (fn) => { try { return !!fn(); } catch (e) { return false; } };
  v.c = chk(() => num(r.c_activa_s) && r.c_pip_pedido && r.c_vueltas.length === 8 && r.c_vueltas.every((x) => x.ventanita && x.imagen_sigue >= 5 && x.mini && (x.toque === true || x.toque === 'no se toca')) &&
    completa(r.c_final) && r.c_llamadas.A === 'active' && r.c_llamadas.B === 'active');
  v.s = chk(() => soloVideo(r.s_entra_sin_aviso) && esMini(r.s_sale_sin_aviso) && soloVideo(r.s_de_mini_a_ventanita) && completa(r.s_completa) &&
    r.s_pegada.nxpip && esMini(r.s_tras_toque) && completa(r.s_tras_mini) && soloVideo(r.s_desorden_en) && !r.s_desorden_fuera.nxpip && !r.s_desorden_fuera.pipwin);
  v.m = chk(() => r.m_atras === true && r.m_barra && soloVideo(r.m_ventanita) && !r.m_ventanita.minimizada && esMini(r.m_vuelve) && !r.m_vuelve.barra && completa(r.m_completa));
  v.t = chk(() => r.t_mini && !r.t_final.mini && num(r.t_suena_s) && !r.t_entrante.mini && !r.t_entrante.pipwin && r.t_entrante.contestar && r.t_entrante.caja[2] >= 380);
  v.f = chk(() => r.f_cerrada >= 1 && r.f_pip_apagado && !r.f_despues.hay && !r.f_despues.nxpip);
  v.z = chk(() => r.z_cerrada >= 1 && r.z_marca === false && !r.z_despues.nxpip && r.z_marca_vieja === false);
  v.g = chk(() => r.g_videollamada_viva_gesto === true && r.g_tras_colgar_gesto === false && r.g_chat_gesto === false && r.g_chat_marca === false && num(r.g_voz_activa_s) &&
    r.g_voz_marca === false && r.g_voz_gesto === false && r.g_pasa_a_video_gesto === true && r.g_marca_vuelve === true && r.g_final_gesto === false);
  r.casos = v;
  const ok = Object.values(v).every(Boolean) && !r.errores.length && !Object.keys(r.fases_con_error).length;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('MINIATURAS ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_miniaturas.txt'), logs.join('\n'));
  await H.close();
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('MINIATURAS ' + JSON.stringify({ prueba: 'miniaturas', resultado: 'FALLO', error: String(e && e.stack || e) })); process.exit(1); });
