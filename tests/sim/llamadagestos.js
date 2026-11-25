// Gestos y pantalla de la videollamada (dueño 25-11; docs/PENDIENTES.md «Videollamada: 3 fallos de pantalla»). Chromium, A y B, videollamada real:
//  z  la pantalla de la llamada bloquea el zoom del WebView (touch-action: none); dos dedos hacen zoom 1–4× SOLO de la imagen del otro, sin salirse
//     de los bordes; con zoom, un dedo la mueve; la barra de botones no cambia de tamaño ni de sitio; dos dedos no cuentan como toque
//  t  un toque muestra/oculta la barra (tras ~300 ms); dos toques NO la hacen parpadear y cambian entera ↔ toda la pantalla; con zoom, dos toques
//     vuelven a tamaño normal
//  p  ventanita del sistema (html.nx-pip): con Perfil/Ajustes (z-index 2147483646/7) y una hoja abiertos, solo se ve la llamada y por encima
//  b  PiP → app → mini flotante → pantalla completa → tocar, varias veces: la barra siempre vuelve; con una marca sobrante (nc-pipwin fuera de la
//     ventanita) el toque la quita, el registro la apunta y se manda el diagnóstico «botones»
//  u  actualizador con llamada en curso: no baja ni abre el instalador; lo hace al colgar
// Uso: node llamadagestos.js <dir_build>
'use strict';
const fs = require('fs');
const path = require('path');
const { callHarness, click, waitFor, sleep, calls } = require('./callharness');

const buildDir = path.resolve(process.argv[2]);

(async () => {
  const r = { prueba: 'llamadagestos', build: path.basename(buildDir), fases_con_error: {} };
  const H = await callHarness({ buildDir, names: ['A', 'B'], shots: '' });
  const { P, logs } = H;
  if (!(await H.pair('A', 'B'))) { console.log('LLAMADAGESTOS ' + JSON.stringify({ prueba: 'llamadagestos', resultado: 'FALLO', error: 'no empareja' })); process.exit(1); }
  r.wifi_s = await H.wifiAll();
  const A = P.A;
  const fase = async (n, fn) => { try { await fn(); } catch (e) { r.fases_con_error[n] = String(e && e.message).slice(0, 200); } };
  // toques y dedos de verdad (TouchEvent) sobre la pantalla de la llamada
  await A.evaluate(() => {
    window.__ev = [];
    window.addEventListener('nexo:diag:symptom', (e) => window.__ev.push(e.detail));
    const scr = () => document.getElementById('nexo-call-screen');
    const mk = (id, x, y) => new Touch({ identifier: id, target: scr(), clientX: x, clientY: y });
    const send = (type, pts, changed) => scr().dispatchEvent(new TouchEvent(type, { bubbles: true, cancelable: true, touches: pts.map((p, i) => mk(i, p[0], p[1])), targetTouches: [], changedTouches: (changed || pts).map((p, i) => mk(i, p[0], p[1])) }));
    window.__pinch = async (d0, d1, cx, cy) => { // dos dedos que pasan de separación d0 a d1 (y vuelven a levantarse)
      send('touchstart', [[cx - d0 / 2, cy], [cx + d0 / 2, cy]]);
      for (let i = 1; i <= 6; i++) { const d = d0 + (d1 - d0) * i / 6; send('touchmove', [[cx - d / 2, cy], [cx + d / 2, cy]]); await new Promise((r) => setTimeout(r, 16)); }
      send('touchend', [], [[cx, cy]]);
    };
    window.__drag = async (x0, y0, x1, y1) => { // un dedo que se arrastra
      send('touchstart', [[x0, y0]]);
      for (let i = 1; i <= 6; i++) { send('touchmove', [[x0 + (x1 - x0) * i / 6, y0 + (y1 - y0) * i / 6]]); await new Promise((r) => setTimeout(r, 16)); }
      send('touchend', [], [[x1, y1]]);
    };
    window.__tap = () => scr().querySelector('.call-remote-video').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    window.__look = () => {
      const s = scr(), v = s.querySelector('.call-remote-video'), b = s.querySelector('.nc-bottom'), vr = v && v.getBoundingClientRect(), br = b && b.getBoundingClientRect();
      return { hide: s.classList.contains('nc-hide'), fill: s.classList.contains('nc-fill'), tf: v ? v.style.transform : null, W: innerWidth, H: innerHeight,
        img: vr && [Math.round(vr.left), Math.round(vr.top), Math.round(vr.right), Math.round(vr.bottom)], bar: br && [Math.round(br.left), Math.round(br.top), Math.round(br.width), Math.round(br.height)],
        marcas: ['nc-pipwin', 'nc-appmini', 'nc-hide'].filter((c) => s.classList.contains(c)).concat(document.documentElement.classList.contains('nx-pip') ? ['html.nx-pip'] : []).join(' ') };
    };
  });
  const look = () => A.evaluate(() => window.__look());
  const show = async () => { await A.evaluate(() => { const s = document.getElementById('nexo-call-screen'); s.classList.remove('nc-hide'); }); };

  r.activa_s = await H.call('A', 'B', {});
  await waitFor(() => A.evaluate(() => window.bleInterface.calls.remoteVideoLive() && !!document.querySelector('#nexo-call-screen .call-remote-video.nc-full')), 20000);
  await sleep(1000); await show();

  // ── z: zoom
  await fase('z', async () => {
    r.z_touchaction = await A.evaluate(() => ['#nexo-call-screen', '#nexo-call-screen .call-remote-video', '#nexo-call-screen .nc-btn'].map((s) => getComputedStyle(document.querySelector(s)).touchAction));
    const l0 = await look();
    await A.evaluate(() => window.__pinch(100, 900, 192, 415)); await sleep(100);
    const l1 = await look();
    r.z_zoom = { tf: l1.tf, img: l1.img, W: l1.W, H: l1.H };
    r.z_barra_igual = JSON.stringify(l0.bar) === JSON.stringify(l1.bar);
    r.z_cubre = l1.img[0] <= 1 && l1.img[1] <= 1 && l1.img[2] >= l1.W - 1 && l1.img[3] >= l1.H - 1;
    await A.evaluate(() => window.__drag(100, 300, 380, 700)); await sleep(100); // arrastre grande hacia un lado: nunca deja ver el fondo
    const l2 = await look();
    r.z_mueve = l2.tf !== l1.tf; r.z_mueve_cubre = l2.img[0] <= 1 && l2.img[1] <= 1 && l2.img[2] >= l2.W - 1 && l2.img[3] >= l2.H - 1;
    await A.evaluate(() => window.__drag(300, 700, 10, 10)); await sleep(100);
    const l3 = await look(); r.z_mueve2_cubre = l3.img[0] <= 1 && l3.img[1] <= 1 && l3.img[2] >= l3.W - 1 && l3.img[3] >= l3.H - 1;
    const hide0 = l3.hide;
    await A.evaluate(() => window.__tap()); await sleep(500); // el toque que sigue a mover la imagen no es un toque
    r.z_tras_mover_no_toque = (await look()).hide === hide0;
    await A.evaluate(() => window.__pinch(100, 20, 192, 415)); await sleep(100);
    const l4 = await look(); r.z_minimo = l4.tf; // volver a 1× devuelve la imagen a su sitio
    await A.evaluate(() => window.__pinch(100, 900, 192, 415)); await sleep(100);
    r.z_tras_pinch_no_toque = await A.evaluate(async () => { const h0 = window.__look().hide; window.__tap(); await new Promise((r) => setTimeout(r, 500)); return window.__look().hide === h0; });
    // con zoom, dos toques → tamaño normal (y la barra no parpadea)
    await sleep(5500); await show(); await sleep(600); // (pasados los 5 s de cualquier ocultado automático anterior)
    const cambios = await A.evaluate(async () => {
      const s = document.getElementById('nexo-call-screen'); let n = 0; const h0 = s.classList.contains('nc-hide');
      const mo = new MutationObserver(() => { if (s.classList.contains('nc-hide') !== h0) n++; }); mo.observe(s, { attributes: true, attributeFilter: ['class'] });
      window.__tap(); await new Promise((r) => setTimeout(r, 90)); window.__tap(); await new Promise((r) => setTimeout(r, 700)); mo.disconnect(); return n;
    });
    const l5 = await look(); r.z_doble_con_zoom = { tf: l5.tf, barra_igual: cambios === 0 };
  });

  // ── t: toques
  await fase('t', async () => {
    await show(); await sleep(400);
    const h0 = (await look()).hide;
    await A.evaluate(() => window.__tap()); await sleep(120);
    r.t_uno_espera = (await look()).hide === h0; // aún no: se espera para distinguir uno de dos
    await sleep(450);
    r.t_uno_oculta = (await look()).hide !== h0;
    await A.evaluate(() => window.__tap()); await sleep(600);
    r.t_otro_muestra = (await look()).hide === h0;
    // dos toques: sin parpadeo de la barra (se anota cada cambio de clase) y entera ↔ toda la pantalla
    const f0 = (await look()).fill;
    r.t_doble = await A.evaluate(async () => {
      const s = document.getElementById('nexo-call-screen'), seen = [];
      const h00 = s.classList.contains('nc-hide'), mo = new MutationObserver(() => seen.push(s.classList.contains('nc-hide')));
      mo.observe(s, { attributes: true, attributeFilter: ['class'] });
      const f0 = s.classList.contains('nc-fill');
      window.__tap(); await new Promise((r) => setTimeout(r, 100)); window.__tap();
      await new Promise((r) => setTimeout(r, 700)); mo.disconnect();
      const hides = seen.filter((x, i) => x !== (i ? seen[i - 1] : h00));
      return { cambia_fill: s.classList.contains('nc-fill') !== f0, cambios_hide: hides.length };
    });
    r.t_doble_vuelve = await A.evaluate(async () => { const s = document.getElementById('nexo-call-screen'), f0 = s.classList.contains('nc-fill'); window.__tap(); await new Promise((r) => setTimeout(r, 100)); window.__tap(); await new Promise((r) => setTimeout(r, 600)); return s.classList.contains('nc-fill') !== f0; });
    r.t_fill_inicial = f0;
  });

  // ── p: ventanita con Perfil/Ajustes encima
  await fase('p', async () => {
    await show();
    await A.evaluate(() => { // como Perfil, Ajustes y las hojas: z-index 2147483646/7, dentro del body
      for (const [id, z] of [['fakePerfil', 2147483646], ['fakeAjustes', 2147483647]]) { const d = document.createElement('div'); d.id = id; d.style.cssText = 'position:fixed;inset:0;background:#fff;z-index:' + z; d.textContent = id; document.body.appendChild(d); }
    });
    const tapaAntes = await A.evaluate(() => { const e = document.elementFromPoint(190, 400); return !!e && !e.closest('#nexo-call-screen'); });
    await A.setViewportSize({ width: 132, height: 236 }); await sleep(300);
    await A.evaluate(() => window.__nexoPipChanged && window.__nexoPipChanged(true)); await sleep(800);
    r.p = await A.evaluate(() => {
      const e = document.elementFromPoint(66, 118), v = document.querySelector('#nexo-call-screen .call-remote-video');
      return { arriba_es_llamada: !!e && !!e.closest('#nexo-call-screen'), perfil: getComputedStyle(document.getElementById('fakePerfil')).display, ajustes: getComputedStyle(document.getElementById('fakeAjustes')).display,
        app: getComputedStyle(document.getElementById('app')).display, imagen: !!v && v.getBoundingClientRect().width > 100 };
    });
    r.p_tapaba_antes = tapaAntes;
    await A.setViewportSize({ width: 384, height: 830 }); await A.evaluate(() => window.__nexoPipChanged && window.__nexoPipChanged(false)); await sleep(900);
    r.p_al_volver = await A.evaluate(() => ({ perfil: getComputedStyle(document.getElementById('fakePerfil')).display, mini: document.getElementById('nexo-call-screen').classList.contains('nc-appmini') }));
    await A.evaluate(() => { document.getElementById('fakePerfil').remove(); document.getElementById('fakeAjustes').remove(); });
  });

  // ── b: PiP → app → mini flotante → completa → tocar, varias veces
  await fase('b', async () => {
    r.b_vueltas = [];
    for (let i = 0; i < 4; i++) {
      await A.setViewportSize({ width: 132, height: 236 }); await A.evaluate(() => window.__nexoPipChanged && window.__nexoPipChanged(true)); await sleep(500);
      await A.setViewportSize({ width: 384, height: 830 }); await A.evaluate(() => window.__nexoPipChanged && window.__nexoPipChanged(false)); await sleep(700);
      const mini = (await look()).marcas;
      await A.evaluate(() => document.getElementById('nexo-call-screen').dispatchEvent(new MouseEvent('click', { bubbles: true }))); await sleep(300); // abre completa
      await A.evaluate(() => document.getElementById('nexo-call-screen').classList.add('nc-hide')); // (se ocultó sola a los 5 s)
      await A.evaluate(() => window.__tap()); await sleep(900);
      const l = await look();
      r.b_vueltas.push({ mini, marcas: l.marcas, barra: await A.evaluate(() => { const b = document.querySelector('#nexo-call-screen .nc-bottom'), cs = getComputedStyle(b); return cs.display !== 'none' && parseFloat(cs.opacity) > 0.5 && b.getBoundingClientRect().height > 20; }) });
    }
    // marca sobrante: nc-pipwin fuera de la ventanita + barra «mostrada» que no se ve
    await A.evaluate(() => { window.__ev.length = 0; const s = document.getElementById('nexo-call-screen'); s.classList.remove('nc-hide', 'nc-appmini'); s.classList.add('nc-pipwin'); s.classList.add('nc-hide'); });
    await sleep(200);
    await A.evaluate(() => window.__tap()); await sleep(1000);
    r.b_sobrante = await A.evaluate(() => { const s = document.getElementById('nexo-call-screen'), b = s.querySelector('.nc-bottom'), cs = getComputedStyle(b); return { pipwin: s.classList.contains('nc-pipwin'), barra: cs.display !== 'none' && parseFloat(cs.opacity) > 0.5, diag: window.__ev.filter((e) => e.kind === 'botones').length }; });
    r.b_registro = logs.some((l) => /\[A\] .*\[CALL\] Botones: la barra/.test(l)) && logs.some((l) => /\[A\] .*Toque en la pantalla: botones .* marcas: /.test(l));
  });

  // ── u: actualizador con llamada en curso
  await fase('u', async () => {
    r.u = await A.evaluate(async () => {
      const calls = [];
      const pl = window.Capacitor.Plugins.NexoBLE, orig = pl.updateInstall;
      pl.updateInstall = async (a) => { calls.push(a.mode); return a.mode === 'download' ? { ready: true } : { opened: true }; };
      window.NEXO_BUILD = '1';
      localStorage.setItem('nexo_upd_avail', JSON.stringify({ build: 99999, url: 'https://github.com/x/y/app.apk', at: Date.now() }));
      const u = window.__nexoUpdater;
      const d = await u.download(), i = await u.install();
      const enLlamada = { d: d && d.reason, i: i && i.reason, llamadas: calls.slice() };
      pl.__orig = orig; window.__updCalls = calls;
      return enLlamada;
    });
    await H.hangAll();
    r.u_al_colgar_s = await waitFor(() => A.evaluate(() => window.__updCalls.includes('download') || window.__updCalls.includes('open')), 15000);
  });

  r.errores = logs.filter((l) => /PAGEERROR/.test(l)).slice(0, 5);
  const v = {}, chk = (fn) => { try { return !!fn(); } catch (e) { return false; } };
  v.z = chk(() => r.z_touchaction.every((x) => x === 'none') && /scale\(4\)/.test(r.z_zoom.tf) && r.z_barra_igual && r.z_cubre && r.z_mueve && r.z_mueve_cubre && r.z_mueve2_cubre && r.z_tras_mover_no_toque &&
    !/scale\(\d/.test(r.z_minimo) && r.z_tras_pinch_no_toque && !/scale\(\d/.test(r.z_doble_con_zoom.tf) && r.z_doble_con_zoom.barra_igual);
  v.t = chk(() => r.t_uno_espera && r.t_uno_oculta && r.t_otro_muestra && r.t_doble.cambia_fill && r.t_doble.cambios_hide === 0 && r.t_doble_vuelve);
  v.p = chk(() => r.p_tapaba_antes && r.p.arriba_es_llamada && r.p.perfil === 'none' && r.p.ajustes === 'none' && r.p.app === 'none' && r.p.imagen && r.p_al_volver.perfil !== 'none' && r.p_al_volver.mini);
  v.b = chk(() => r.b_vueltas.length === 4 && r.b_vueltas.every((x) => x.barra) && !r.b_sobrante.pipwin && r.b_sobrante.barra && r.b_sobrante.diag >= 1 && r.b_registro);
  v.u = chk(() => r.u.d === 'in_call' && r.u.i === 'in_call' && r.u.llamadas.length === 0 && typeof r.u_al_colgar_s === 'number');
  r.casos = v;
  const ok = Object.values(v).every(Boolean) && !r.errores.length && !Object.keys(r.fases_con_error).length;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('LLAMADAGESTOS ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_llamadagestos.txt'), logs.join('\n'));
  await H.close();
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('LLAMADAGESTOS ' + JSON.stringify({ prueba: 'llamadagestos', resultado: 'FALLO', error: String(e && e.stack || e) })); process.exit(1); });
