// NEXO Touch (build 2968, dueño 09-11: «retroalimentación por vibración y visual… algo que el user diga: wow, qué bien se
// siente»). UN motor de presionado (src/ui/press.js) + háptica del sistema (src/ui/haptics.js). Comprueba, con un DOM de
// jsdom y la GEOMETRÍA REAL de la barra de escribir y la cabecera: (1) el botón se marca presionado en el MISMO instante
// del pointerdown, con la onda desde el punto exacto del dedo y UN tick háptico; (2) un toque fulminante se sostiene ≥120 ms
// y después suelta con el «pulso NEXO» (solo redondos); (3) deslizar >12 px o un scroll cancela sin pulso; (4) ráfagas:
// un tick cada 40 ms como mucho; (5) filas: escala suave, onda acotada, sin pulso; (6) deshabilitados/data-nopress/botón
// secundario no presionan; (7) ÁREAS DE TOQUE: enviar crece hasta 56 hacia el borde (0 hacia el textarea, que está a 8 px),
// adjuntar en espejo, y la cabecera crece sin que dos botones se pisen; (8) decisiones puras; (9) háptica: modos
// sistema/siempre/nunca, patrones del suplente y entrega al plugin nativo con kind+modo.
// Uso: node press.js [dir_build]
'use strict';
const { JSDOM } = require('jsdom');
const { importSrc } = require('./srcmod');

(async () => {
  const r = { prueba: 'press' };
  const P = await importSrc('ui/press.js');
  const H = await importSrc('ui/haptics.js');
  const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
  const dom = new JSDOM('<!doctype html><html><body>' +
    '<div id="hdr" style="position:relative"><button id="chat-back-btn">‹</button><button id="nexo-call-btn"></button><button id="nexo-video-btn"></button></div>' +
    '<div id="list"><div class="ble-contact-row" id="row1">A</div><div class="ble-contact-row" id="row2">B</div></div>' +
    '<div id="input-area"><button id="attach-btn" class="input-btn attach-btn">+</button><div class="input-wrapper"><textarea id="message-input"></textarea></div><button id="send-btn" class="input-btn send-btn">&gt;</button></div>' +
    '<button id="plain">x</button><button id="dis" disabled>d</button><div data-nopress><button id="nop">n</button></div>' +
    '<div id="scroller" style="overflow:auto;height:50px"><button id="inscroll">s</button></div>' +
    '</body></html>', { pretendToBeVisual: true, url: 'https://nexo.test/' });
  const win = dom.window, doc = win.document;
  const vib = [];
  Object.defineProperty(win.navigator, 'vibrate', { value: (p) => { vib.push(p); return true; }, configurable: true });
  Object.defineProperty(win, 'innerWidth', { value: 360, configurable: true });
  Object.defineProperty(win, 'innerHeight', { value: 800, configurable: true });
  H.hapticsUse(win);
  // Geometría REAL (jsdom no mide): barra de escribir con botones de 44, textarea entre ellos a 8 px; cabecera de 64 con
  // atrás (40) pegado al borde y llamar/video (40) con 10 px entre sí; filas de 66.
  const rects = { 'attach-btn': [12, 700, 44, 44], 'message-input': [64, 700, 232, 44], 'send-btn': [304, 700, 44, 44],
    'chat-back-btn': [8, 12, 40, 40], 'nexo-call-btn': [260, 12, 40, 40], 'nexo-video-btn': [310, 12, 40, 40], 'hdr': [0, 0, 360, 64],
    'input-area': [0, 690, 360, 68], 'plain': [100, 300, 100, 40], 'row1': [0, 100, 360, 66], 'row2': [0, 166, 360, 66], 'list': [0, 100, 360, 132] };
  Object.keys(rects).forEach((id) => { const el = doc.getElementById(id); const [x, y, w, h] = rects[id]; el.getBoundingClientRect = () => ({ left: x, top: y, right: x + w, bottom: y + h, width: w, height: h, x, y }); });
  const ev = (type, el, x, y, extra) => { const e = new win.MouseEvent(type, Object.assign({ bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 }, extra || {})); el.dispatchEvent(e); return e; };
  const prop = (el, k) => el.style.getPropertyValue(k);
  const hasChild = (el, cls) => Array.from(el.children).some((c) => c.classList.contains(cls));

  r.init_una_vez = P.initPress(doc) === true && P.initPress(doc) === false;
  if (doc.readyState === 'loading') await new Promise((res) => doc.addEventListener('DOMContentLoaded', res)); // jsdom termina de cargar en el siguiente tick (la app arranca con el DOM ya listo)
  r.marcados_antes_del_toque = doc.querySelectorAll('.nx-pressable').length >= 8 && doc.getElementById('row1').classList.contains('nx-pressable');

  // 1) presionar: al instante, con la onda desde el dedo y UN tick
  const send = doc.getElementById('send-btn');
  vib.length = 0;
  ev('pointerdown', send, 330, 720);
  const rip = Array.from(send.children).find((c) => c.classList.contains('nx-ripple'));
  r.presiona_al_instante = send.classList.contains('is-pressed') && !!rip && rip.classList.contains('on');
  r.onda_desde_el_dedo = prop(send, '--nx-px') === '26px' && prop(send, '--nx-py') === '20px' && parseInt(prop(send, '--nx-pr'), 10) >= 32;
  r.tick_una_vez = vib.length === 1 && vib[0] === 8;
  r.escala_redondo = prop(send, '--nx-press-scale') === '0.9';
  // 2) toque fulminante: se sostiene ≥120 ms, después suelta con pulso NEXO y la onda se apaga y se limpia
  await sleep(20); ev('pointerup', send, 330, 720);
  r.se_sostiene_120ms = send.classList.contains('is-pressed');
  await sleep(140);
  r.vuelve_con_pulso = !send.classList.contains('is-pressed') && hasChild(send, 'nx-pulse') && rip.classList.contains('out');
  await sleep(420);
  r.limpia_onda_y_pulso = !hasChild(send, 'nx-ripple') && !hasChild(send, 'nx-pulse');
  // 3) deslizar: 6 px no cancela; 15 px cancela YA y sin pulso
  vib.length = 0;
  ev('pointerdown', send, 330, 720); ev('pointermove', send, 336, 720);
  r.mover_poco_no_cancela = send.classList.contains('is-pressed');
  ev('pointermove', send, 345, 720);
  r.deslizar_cancela = !send.classList.contains('is-pressed');
  await sleep(10);
  r.cancelado_sin_pulso = !hasChild(send, 'nx-pulse') && vib.length === 1;
  await sleep(360);
  // 4) ráfaga: dos toques en <40 ms → un solo tick; separados → dos
  vib.length = 0;
  ev('pointerdown', send, 330, 720); ev('pointerup', send, 330, 720); ev('pointerdown', send, 330, 720); ev('pointerup', send, 330, 720);
  r.rafaga_un_tick = vib.length === 1;
  await sleep(60); ev('pointerdown', send, 330, 720); ev('pointerup', send, 330, 720);
  r.separados_dos_ticks = vib.length === 2;
  await sleep(200);
  r.rafaga_termina_limpia = !send.classList.contains('is-pressed');
  // 5) fila: escala suave, onda DENTRO de la fila (acotada), sin pulso
  const row = doc.getElementById('row1');
  ev('pointerdown', row, 180, 130);
  r.fila_escala_y_onda = prop(row, '--nx-press-scale') === '0.985' && hasChild(row, 'nx-ripple') && row.classList.contains('is-pressed');
  ev('pointerup', row, 180, 130); await sleep(150);
  r.fila_sin_pulso = !hasChild(row, 'nx-pulse') && !row.classList.contains('is-pressed');
  // 6) scroll cancela; deshabilitado / data-nopress / botón secundario no presionan ni vibran
  const plain = doc.getElementById('plain');
  ev('pointerdown', plain, 150, 320); doc.getElementById('scroller').dispatchEvent(new win.Event('scroll', { bubbles: true }));
  r.scroll_cancela = !plain.classList.contains('is-pressed');
  vib.length = 0; ev('pointerdown', doc.getElementById('dis'), 1, 1); ev('pointerdown', doc.getElementById('nop'), 1, 1); ev('pointerdown', plain, 150, 320, { button: 2 });
  r.ignora_deshabilitado_nopress_boton2 = !doc.getElementById('dis').classList.contains('is-pressed') && !doc.getElementById('nop').classList.contains('is-pressed') && !plain.classList.contains('is-pressed') && vib.length === 0;
  await sleep(10);
  // 7) áreas de toque con la geometría real
  const n = P.applyHitAreas(doc);
  const hs = (id) => ['l', 'r', 't', 'b'].map((k) => prop(doc.getElementById(id), '--hs-' + k)).join(' ');
  r.areas_aplicadas = n >= 5 && send.classList.contains('nx-hit');
  r.area_enviar_56_hacia_el_borde = hs('send-btn') === '0px 12px 6px 6px';
  r.area_adjuntar_espejo = hs('attach-btn') === '12px 0px 6px 6px';
  r.area_cabecera_sin_pisar = hs('nexo-video-btn') === '2px 6px 4px 4px' && hs('nexo-call-btn') === '6px 2px 4px 4px' && hs('chat-back-btn') === '8px 8px 8px 8px';
  r.posicionado_para_el_area = ['send-btn', 'nexo-call-btn'].every((id) => doc.getElementById(id).style.position === 'relative');
  // 8) decisiones puras
  const slop = P._hitSlop({ left: 100, right: 140, top: 100, bottom: 140, width: 40, height: 40 }, { left: 0, right: 360, top: 0, bottom: 800 }, [{ left: 100, right: 140, top: 150, bottom: 190 }], 48);
  r.hitslop_vecino_abajo = slop.b === 2 && slop.t === 6 && slop.l === 4 && slop.r === 4;
  const slop2 = P._hitSlop({ left: 0, right: 40, top: 0, bottom: 40, width: 40, height: 40 }, { left: 0, right: 40, top: 0, bottom: 40 }, [], 56);
  r.hitslop_sin_lugar_no_crece = slop2.l === 0 && slop2.r === 0 && slop2.t === 0 && slop2.b === 0;
  r.puras = P._pressMoved(0, 0, 8, 8) === false && P._pressMoved(0, 0, 9, 9) === true && P._pressReleaseDelay(1000, 1020) === 100 && P._pressReleaseDelay(1000, 1300) === 0 &&
    P._pressKind(send) === 'round' && P._pressKind(row) === 'row' && P._pressKind(plain) === 'btn' && P.PRESS_MIN_HOLD_MS === 120 && P.PRESS_SLOP_PX === 12;
  // 9) háptica: compuerta, patrones del suplente, modos y entrega al plugin
  r.gate = H._hapticGate('tick', 'system', 1000, 990) === false && H._hapticGate('tick', 'system', 1000, 950) === true && H._hapticGate('confirm', 'system', 1000, 999) === true &&
    H._hapticGate('tick', 'off', 1000, 0) === false && H._hapticGate('zumbido', 'on', 1000, 0) === false;
  r.patrones_cortos = H._fallbackPattern('tick') === 8 && H._fallbackPattern('confirm') === 16 && JSON.stringify(H._fallbackPattern('reject')) === '[18,50,18]' && H._fallbackPattern('gesture') === 10;
  vib.length = 0; H.setHapticMode('off');
  r.modo_off_silencio = H.haptic('confirm') === false && vib.length === 0 && H.hapticMode() === 'off';
  H.setHapticMode('on');
  r.modo_on_vibra = H.haptic('confirm') === true && vib.length === 1 && vib[0] === 16;
  r.modo_por_defecto = H.setHapticMode('raro') === 'system' && H.hapticMode() === 'system';
  const calls = []; win.Capacitor = { Plugins: { NexoBLE: { haptic: (o) => { calls.push(o); return Promise.resolve(); } } } };
  vib.length = 0; H.haptic('reject');
  r.plugin_recibe_kind_y_modo = calls.length === 1 && calls[0].kind === 'reject' && calls[0].mode === 'system' && vib.length === 0;
  delete win.Capacitor;

  const ok = Object.keys(r).filter((k) => k !== 'prueba' && k !== 'resultado').every((k) => r[k] === true);
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('PRESS ' + JSON.stringify(r));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('PRESS {"resultado":"FALLO","error":"' + String(e && e.message).replace(/"/g, "'") + '"}'); console.error(e && e.stack); process.exit(1); });
