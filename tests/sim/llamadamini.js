// 3155 (pedidos del dueño 16-11, pantalla de la llamada). Llamadas de verdad en Chromium (cámara y micrófono de prueba, mismo Wi-Fi),
// A y B:
//  v  «Vídeo» en una llamada de VOZ: pasa a videollamada sin colgar (la misma llamada, sin «terminada»): A manda su imagen y B la ve;
//     B queda con su cámara apagada (el botón dice «Cámara no») y, al tocarlo, A ve la de B;
//  p  la videollamada en la ventanita (miniatura del sistema, PiP, o la app en una ventana pequeña): solo la imagen del otro, sin
//     botones ni textos ni la mía, también si el aviso del sistema no llega (antes, «todos los botones apretados en la ventanita»);
//     la videollamada deja pasar a la miniatura; al volver, todo otra vez;
//  b  «atrás» con la llamada a la vista (videollamada que no pasó a la miniatura, y de voz): barra arriba como la de WhatsApp («B · m:ss»,
//     Silenciar y Colgar) y la app usable debajo; la imagen del otro sigue llegando; Silenciar desde la barra; tocar la barra vuelve a la
//     llamada; Colgar desde la barra la termina en los dos;
//  r  mientras suena una entrante, «atrás» no la minimiza (se sigue viendo Contestar/Rechazar).
// Uso: node llamadamini.js <dir_build>   (AV_SHOTS=<carpeta>: capturas a 384 de ancho)
'use strict';
const fs = require('fs');
const path = require('path');
const { callHarness, click, waitFor, clickRowNamed, closeChat, calls, media1, shotOf, pipLook, barLook, sleep } = require('./callharness');

const buildDir = path.resolve(process.argv[2]);
const SHOTS = process.env.AV_SHOTS || '';

(async () => {
  const r = { prueba: 'llamadamini', build: path.basename(buildDir), fases_con_error: {} };
  const H = await callHarness({ buildDir, names: ['A', 'B'], shots: SHOTS });
  const { P, nat, id, logs } = H;
  if (!(await H.pair('A', 'B'))) { console.log('LLAMADAMINI ' + JSON.stringify({ prueba: 'llamadamini', resultado: 'FALLO', error: 'no empareja' })); process.exit(1); }
  r.wifi_s = await H.wifiAll();
  for (const n of ['A', 'B']) await P[n].evaluate(() => { window.__fin = []; window.addEventListener('nexo:call', (e) => { if (e.detail && e.detail.state === 'ended') window.__fin.push(e.detail.reason); }); });
  const fase = async (n, fn) => { try { await fn(); } catch (e) { r.fases_con_error[n] = String(e && e.message).slice(0, 200); try { await P.A.setViewportSize({ width: 384, height: 830 }); } catch (x) {} try { await H.hangAll(); } catch (x) {} } };
  const st1 = (p) => p.evaluate(() => { const c = window.bleInterface.calls, s = c.state(); return s ? { id: s.id, estado: s.state, video: !!s.video, camState: s.camState || '', cameraOff: !!s.cameraOff, muted: !!s.muted, suImagen: c.remoteVideoLive() && !!(c.videoViews().remote && c.videoViews().remote.width) } : null; });
  const label = (p, sel) => p.evaluate((s) => { const b = document.querySelector(s); return b ? b.textContent.trim() : null; }, sel);
  const fin = (p) => p.evaluate(() => window.__fin.slice());

  // ── v: de voz a vídeo sin colgar
  await fase('v', async () => {
    r.v_activa_s = await H.call('A', 'B', { voice: true });
    await sleep(1500);
    const a0 = await st1(P.A), b0 = await st1(P.B);
    r.v_boton = await label(P.A, '#nexo-call-screen .call-tovideo');
    await click(P.A, '#nexo-call-screen .call-tovideo');
    r.v_B_ve_a_A_s = await waitFor(async () => { const s = await st1(P.B); return s && s.video && s.suImagen; }, 15000);
    await sleep(1500);
    const a1 = await st1(P.A), b1 = await st1(P.B);
    r.v_A = Object.assign(await media1(P.A), { video: a1 && a1.video, misma_llamada: !!a1 && a1.id === a0.id && a1.estado === 'active' });
    r.v_B = { video: b1 && b1.video, misma_llamada: !!b1 && b1.id === b0.id && b1.estado === 'active', su_camara: b1 && b1.camState, boton_camara: await label(P.B, '#nexo-call-screen .call-camera') };
    r.v_pantalla_video = await P.A.evaluate(() => { const el = document.getElementById('nexo-call-screen'); return !!el && el.classList.contains('nc-video') && !!document.querySelector('#nexo-call-screen .call-local-video'); });
    if (SHOTS) { await shotOf(P.A, path.join(SHOTS, 'voz_a_video_A_384.png')); await shotOf(P.B, path.join(SHOTS, 'voz_a_video_B_384.png')); }
    await click(P.B, '#nexo-call-screen .call-camera');
    r.v_A_ve_a_B_s = await waitFor(async () => { const s = await st1(P.A); return s && s.suImagen; }, 15000);
    r.v_terminadas = { A: await fin(P.A), B: await fin(P.B) };
    r.v_pip_activo = nat.A.pipVideo === true;
  });

  // ── p: la videollamada en la ventanita (sigue la de v)
  await fase('p', async () => {
    await P.A.evaluate(() => document.getElementById('nexo-call-screen').classList.remove('nc-hide'));
    await P.A.setViewportSize({ width: 200, height: 356 }); await sleep(900); // sin el aviso del sistema: solo la ventana pequeña
    r.p_sin_aviso = await pipLook(P.A);
    await P.A.evaluate(() => window.__nexoPipChanged && window.__nexoPipChanged(true)); await sleep(600);
    r.p_con_aviso = await pipLook(P.A);
    if (SHOTS) await shotOf(P.A, path.join(SHOTS, 'pip_1a1.png'));
    await P.A.setViewportSize({ width: 384, height: 830 }); await P.A.evaluate(() => window.__nexoPipChanged && window.__nexoPipChanged(false)); await sleep(900);
    r.p_al_volver_mini = await pipLook(P.A); // la llamada queda como mini flotante encima de la app (lo de siempre)
    await click(P.A, '#nexo-call-screen'); await sleep(600);
    r.p_al_tocar = await pipLook(P.A);
  });

  // ── b (vídeo): «atrás» con la videollamada a la vista
  await fase('bv', async () => {
    await P.A.evaluate(() => document.getElementById('nexo-call-screen').classList.remove('nc-hide', 'nc-appmini'));
    const g0 = (await media1(P.A)).video_recibido;
    r.bv_atras = await P.A.evaluate(() => window.__nexoHandleBack());
    await sleep(2000);
    r.bv_barra = await barLook(P.A);
    r.bv_imagen_sigue = (await media1(P.A)).video_recibido - g0;
    await click(P.A, '#nexo-call-bar .ncb-name'); await sleep(600);
    r.bv_vuelve = await barLook(P.A);
    await H.hangAll();
  });

  // ── b (voz): barra, Silenciar, volver y Colgar desde la barra
  await fase('b', async () => {
    r.b_activa_s = await H.call('A', 'B', { voice: true });
    await sleep(2500);
    r.b_atras = await P.A.evaluate(() => window.__nexoHandleBack());
    await sleep(500);
    r.b_barra = await barLook(P.A);
    if (SHOTS) await P.A.screenshot({ path: path.join(SHOTS, 'barra_384.png') });
    await click(P.A, '#nexo-call-bar .ncb-mute'); await sleep(500);
    r.b_silencio = { llamada: (await st1(P.A)).muted, barra: (await barLook(P.A)).silenciado };
    await click(P.A, '#nexo-call-bar .ncb-name'); await sleep(600);
    r.b_vuelve = await barLook(P.A);
    await P.A.evaluate(() => window.__nexoHandleBack()); await sleep(500);
    await click(P.A, '#nexo-call-bar .ncb-hang');
    r.b_colgar_s = await waitFor(async () => (await calls(P.A)).uno === null && (await calls(P.B)).uno === null, 10000);
    await sleep(600);
    r.b_tras_colgar = await barLook(P.A);
    await H.hangAll();
  });

  // ── r: «atrás» mientras suena una entrante
  await fase('r', async () => {
    await clickRowNamed(P.A, '#main-contacts-list .ble-contact-row', 'B'); await sleep(500);
    await click(P.A, '#nexo-call-btn'); await closeChat(P.A);
    await waitFor(async () => (await calls(P.B)).uno === 'ringing', 15000);
    await P.B.evaluate(() => window.__nexoHandleBack()); await sleep(500);
    r.r_B = Object.assign(await barLook(P.B), { contestar: await P.B.evaluate(() => { const b = document.querySelector('#nexo-call-screen .call-accept'); return !!b && b.checkVisibility(); }) });
    await H.hangAll();
  });

  r.errores = logs.filter((l) => /PAGEERROR/.test(l)).slice(0, 5);
  const num = (v) => typeof v === 'number';
  const v = {}, chk = (fn) => { try { return !!fn(); } catch (e) { return false; } };
  const llena = (l) => l.su_imagen.length === 1 && l.su_imagen[0][2] >= l.W - 2 && l.su_imagen[0][3] >= l.H - 2;
  v.v = chk(() => r.v_boton === 'Vídeo' && num(r.v_B_ve_a_A_s) && r.v_A.video && r.v_A.misma_llamada && r.v_A.camara && r.v_A.video_enviado > 10 && r.v_pantalla_video &&
    r.v_B.video && r.v_B.misma_llamada && r.v_B.su_camara === 'off' && r.v_B.boton_camara === 'Cámara no' && num(r.v_A_ve_a_B_s) && !r.v_terminadas.A.length && !r.v_terminadas.B.length);
  v.p = chk(() => r.v_pip_activo && r.p_sin_aviso.botones === 0 && r.p_sin_aviso.textos === 0 && r.p_sin_aviso.mi_imagen === 0 && llena(r.p_sin_aviso) &&
    r.p_con_aviso.botones === 0 && r.p_con_aviso.textos === 0 && r.p_con_aviso.mi_imagen === 0 && llena(r.p_con_aviso) && r.p_al_volver_mini.botones === 0 && r.p_al_tocar.botones >= 7);
  v.bv = chk(() => r.bv_atras === true && r.bv_barra.barra && r.bv_barra.arriba && /^B · \d+:\d\d$/.test(r.bv_barra.texto) && !r.bv_barra.pantalla_llamada && r.bv_barra.app_debajo && r.bv_barra.app_baja &&
    r.bv_imagen_sigue >= 10 && !r.bv_vuelve.barra && r.bv_vuelve.pantalla_llamada);
  v.b = chk(() => num(r.b_activa_s) && r.b_atras === true && r.b_barra.barra && r.b_barra.arriba && /^B · \d+:\d\d$/.test(r.b_barra.texto) && r.b_barra.silenciar && r.b_barra.colgar && r.b_barra.app_debajo &&
    r.b_silencio.llamada === true && r.b_silencio.barra === true && !r.b_vuelve.barra && r.b_vuelve.pantalla_llamada && num(r.b_colgar_s) && !r.b_tras_colgar.barra);
  v.r = chk(() => !r.r_B.barra && r.r_B.contestar);
  r.casos = v;
  const ok = Object.values(v).every(Boolean) && !r.errores.length;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('LLAMADAMINI ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_llamadamini.txt'), logs.join('\n'));
  await H.close();
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('LLAMADAMINI ' + JSON.stringify({ prueba: 'llamadamini', resultado: 'FALLO', error: String(e && e.stack || e) })); process.exit(1); });
