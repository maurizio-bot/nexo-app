// 3181 (dueño 17-11: «revisa todos los botones que hay en la app y que todos tengan la misma retroalimentación visual. Los botones
// de videollamadas o de llamadas hay que revisarlos… como el botón de mandar audio (nota de voz): sale un cuadrado feo»).
// Chromium real a 360 px con toques de verdad por CDP. Recorre la app (Contactos, chat con su barra de escribir y el micrófono,
// menú «+», grabación de una nota de voz, cabecera, llamada y videollamada 1-a-1 —saliente, entrante, en curso—, la barra de la
// llamada minimizada, la llamada de grupo —entrante y en curso con vídeo—, Perfil, Ajustes, la cámara de NEXO, el visor de fotos,
// juegos, stickers, el menú de un mensaje —y su «Editar», 3195— y Estados) y, en cada pantalla, presiona con el dedo CADA cosa que se toca (sostenido, sin
// soltar: así no se dispara su acción) y mira lo que se ve:
//  P1 recibe el motor de press.js (se hunde: `scale` < 1, y el velo/onda está puesto);
//  P2 la onda/velo queda DENTRO del contorno que se ve (el del botón o, si lo dibuja un hijo —el círculo de los botones de llamada—,
//     el de ese hijo), con el mismo radio: los redondos, redondos. Además, en píxeles: lo que pinta la onda (captura con onda menos
//     captura sin onda, todo lo demás quieto) no se sale de ese contorno;
//  P3 al soltar, el «pulso NEXO» sale en TODO lo que se ve redondo (y solo ahí), con la forma y el tamaño de ese círculo;
//  P4 -webkit-tap-highlight-color transparente;
//  P5 con :focus y :active forzados por CDP (lo que deja un toque; :focus-visible no, que es del teclado): ni outline ni una regla
//     suelta que cambie fondo, sombra o borde (el velo es del motor, .is-pressed);
//  y la onda sigue puesta mientras se mantiene el dedo (en la barra de la llamada y la de grabación, que se repintan solas, 1,1 s más).
//  M  el micrófono: mantener (≥ 0,6 s, graba) sigue presionado y redondo, deslizar a la izquierda sigue cancelando la nota.
// Contraprueba 2884c687: FALLO en 47 de 134 (los 22 botones de llamada/videollamada/grupo con la onda en un rectángulo sobre círculo
// y nombre y el pulso un óvalo; 15 redondos sin pulso; la onda de «Silenciar» de la barra y de «pausa» de la grabación se borraba sola;
// Estados, la foto de Perfil y el aviso de cifrado sin respuesta; :active suelto en las 7 filas de Ajustes). El micrófono (M) ya
// estaba bien en Chromium. Capturas: PRESS_SHOTS=<carpeta> (durante el toque, a escala 1: las pantallas de llamada, la grabación,
// el chat y lo que pinte fuera de su contorno).
// Uso: node pressall.js <dir_build> [--inventario]
'use strict';
const fs = require('fs');
const path = require('path');
if (!process.env.SHOTS_VIEWPORT) process.env.SHOTS_VIEWPORT = '360x740';
const { PW, bootPhone, sleep } = require('./pw_harness');
const { Radio, NativePhone } = require('./native_mock');

const buildDir = path.resolve(process.argv[2]);
const dist = path.join(buildDir, 'dist');
const INV = process.argv.includes('--inventario');
const shots = process.env.PRESS_SHOTS ? path.resolve(process.env.PRESS_SHOTS) : '';
const SHOT_SCREENS = ['llamando', 'entrante', 'llamada_voz', 'videollamada', 'barra_llamada', 'grupo', 'grabando', 'chat'];
const logs = [];
const r = { prueba: 'pressall', build: path.basename(buildDir) };
const fin = (ok) => {
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('PRESSALL ' + JSON.stringify(r));
  try { fs.writeFileSync(path.join(__dirname, 'last_logs_pressall.txt'), logs.join('\n')); } catch (e) {}
};
// El selector del motor, tal cual está en la build que se prueba
const pressSrc = fs.readFileSync(path.join(buildDir, 'src', 'ui', 'press.js'), 'utf8');
const PRESS_SELECTOR = (/PRESS_SELECTOR\s*=\s*'([^']+)'/.exec(pressSrc) || [])[1] || 'button';

// ---------- lo que se mide dentro de la página ----------
function pageHelpers(SEL) {
  const alpha = (c) => { const m = /rgba?\(([^)]+)\)/.exec(c || ''); if (!m) return c === 'transparent' ? 0 : 1; const p = m[1].split(/[ ,/]+/).filter(Boolean); return p.length >= 4 ? parseFloat(p[3]) : 1; };
  const NX = '.nx-ripple, .nx-pulse';
  // ¿Este elemento pinta una superficie propia (fondo, borde o sombra)?
  const draws = (el) => {
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none') return false;
    if (alpha(cs.backgroundColor) > 0.02 || (cs.backgroundImage && cs.backgroundImage !== 'none')) return true;
    if (cs.boxShadow && cs.boxShadow !== 'none' && !/inset/.test(cs.boxShadow)) return true;
    if (cs.boxShadow && /inset/.test(cs.boxShadow)) return true;
    return ['Top', 'Right', 'Bottom', 'Left'].some((s) => parseFloat(cs['border' + s + 'Width']) > 0 && cs['border' + s + 'Style'] !== 'none' && alpha(cs['border' + s + 'Color']) > 0.02);
  };
  // El contorno que se VE al tocarlo: el propio elemento si pinta algo; si no, el hijo que pinta la superficie más grande
  // (el círculo de un botón de llamada); si ninguno, el propio elemento (texto suelto: el contorno es su caja).
  // Una FILA es su propia forma, como en el motor (press.js _pressKind 'row': su velo es su fondo y la onda va en ella, no en su círculo).
  // 3218: «yo» de la cabecera (.nx-me-chip: foto + nombre, sin caja, como la muestra aprobada) se presiona así: se vela entera la franja.
  const ROWS = '.ble-contact-row, .ble-menu-item, .mm-item, .nexo-pick-row, .fw-row, .game-pick-item, .nx-est-row, .nx-me-chip';
  const shapeOf = (el) => {
    if (el.matches(ROWS)) return el;
    if (draws(el)) return el;
    const er = el.getBoundingClientRect(); let best = null, area = 0;
    el.querySelectorAll('*').forEach((d) => {
      if (d.closest(NX) || d.tagName === 'svg' || d.closest('svg')) return;
      if (!draws(d)) return;
      const q = d.getBoundingClientRect(), a = q.width * q.height;
      if (a > area) { area = a; best = d; }
    });
    return best && area >= 0.2 * er.width * er.height ? best : el;
  };
  // radio (px) de la esquina de arriba a la izquierda, ya resuelto (los % contra su propia caja, sin la escala)
  const radius = (el) => {
    const cs = getComputedStyle(el), w = el.offsetWidth || el.getBoundingClientRect().width, h = el.offsetHeight || el.getBoundingClientRect().height;
    const one = (v, base) => { v = String(v || '0').trim().split(/\s+/)[0]; return /%$/.test(v) ? parseFloat(v) / 100 * base : parseFloat(v) || 0; };
    const parts = String(cs.borderTopLeftRadius || '0').split(/\s+/);
    const rx = one(parts[0], w), ry = one(parts[1] || parts[0], h);
    return Math.min(rx, ry, w / 2, h / 2);
  };
  const isRound = (el) => { const w = el.offsetWidth, h = el.offsetHeight; return w > 0 && h > 0 && Math.abs(w - h) <= 2 && radius(el) >= Math.min(w, h) / 2 - 1; };
  const visible = (el) => {
    const q = el.getBoundingClientRect();
    if (q.width < 6 || q.height < 6 || q.bottom <= 0 || q.right <= 0 || q.top >= innerHeight || q.left >= innerWidth) return false;
    for (let e = el; e && e.nodeType === 1; e = e.parentElement) { const cs = getComputedStyle(e); if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) < 0.05) return false; }
    const cx = Math.min(innerWidth - 1, Math.max(0, q.left + q.width / 2)), cy = Math.min(innerHeight - 1, Math.max(0, q.top + q.height / 2));
    const hit = document.elementFromPoint(cx, cy);
    return !!hit && (hit === el || el.contains(hit));
  };
  const name = (el) => {
    let s = el.tagName.toLowerCase();
    if (el.id) s += '#' + el.id;
    const cl = Array.from(el.classList).filter((c) => !/^(nx-pressable|nx-hit|is-pressed)$/.test(c)).slice(0, 3);
    if (cl.length) s += '.' + cl.join('.');
    const tx = (el.getAttribute('aria-label') || el.getAttribute('data-label') || el.getAttribute('title') || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 22);
    return tx ? s + ' «' + tx + '»' : s;
  };
  // Lo que se toca en `root`: lo del motor (SEL) y lo que tiene pinta de botón (cursor de mano / role / onclick), visible y arriba
  window.__pa = {
    SEL,
    cands(rootSel, skipSel) {
      const root = rootSel ? document.querySelector(rootSel) : document.body;
      if (!root) return [];
      const out = [], seen = new Set();
      [root].concat(Array.from(root.querySelectorAll('*'))).forEach((el) => {
        if (el.closest(NX) || el.closest('svg')) return;
        if (skipSel && el.closest(skipSel)) return;
        const inSel = el.matches(SEL);
        let touch = inSel || el.tagName === 'BUTTON' || el.getAttribute('role') === 'button' || typeof el.onclick === 'function';
        if (!touch) { const cs = getComputedStyle(el); touch = cs.cursor === 'pointer' && !(el.parentElement && getComputedStyle(el.parentElement).cursor === 'pointer'); }
        if (!touch || !visible(el)) return;
        { const q = el.getBoundingClientRect(); if (q.width * q.height > 0.5 * innerWidth * innerHeight) return; } // fondos que cierran al tocar fuera: no son botones
        // lo que está DENTRO de otro pulsable del motor ya lo cubre el de afuera (el motor busca el más cercano)
        const owner = el.closest(SEL);
        const key = owner || el;
        if (seen.has(key)) return; seen.add(key);
        if (!owner && el.parentElement && el.parentElement.closest('[data-pa-seen]')) return;
        const q = key.getBoundingClientRect();
        out.push({ path: window.__pa.mark(key), name: name(key), inSel: !!owner, cx: q.left + q.width / 2, cy: q.top + q.height / 2 });
      });
      return out;
    },
    _n: 0,
    mark(el) { if (!el.dataset.pa) el.dataset.pa = 'p' + (++window.__pa._n); return el.dataset.pa; },
    el(p) { return document.querySelector('[data-pa="' + p + '"]'); },
    // Durante el toque sostenido
    pressed(p) {
      const el = window.__pa.el(p); if (!el) return { error: 'no está' };
      const sh = shapeOf(el), cs = getComputedStyle(el), shs = getComputedStyle(sh);
      const rips = Array.from(document.querySelectorAll('.nx-ripple')).filter((x) => el.contains(x));
      const rip = rips[rips.length - 1] || null;
      const sr = sh.getBoundingClientRect();
      const o = {
        forma: sh === el ? 'propia' : 'hijo ' + name(sh), redondo: isRound(sh), radio_forma: Math.round(radius(sh) * 10) / 10,
        presionado: el.classList.contains('is-pressed'),
        escala: Math.min(parseFloat(cs.scale) || 1, parseFloat(shs.scale) || 1),
        tap: cs.webkitTapHighlightColor, tap_ok: alpha(cs.webkitTapHighlightColor) === 0,
        forma_rect: { x: sr.left, y: sr.top, w: sr.width, h: sr.height },
        caja: (() => { const q = el.getBoundingClientRect(); return { x: Math.min(q.left, sr.left), y: Math.min(q.top, sr.top), r: Math.max(q.right, sr.right), b: Math.max(q.bottom, sr.bottom) }; })(),
      };
      if (rip) {
        const q = rip.getBoundingClientRect();
        const bw = Math.max(parseFloat(shs.borderTopWidth) || 0, parseFloat(shs.borderLeftWidth) || 0);
        o.onda = { x: Math.round(q.left), y: Math.round(q.top), w: Math.round(q.width), h: Math.round(q.height), radio: Math.round(radius(rip) * 10) / 10, en: rip.parentElement === el ? 'propio' : name(rip.parentElement) };
        const k = sr.width ? q.width / Math.max(1, rip.offsetWidth) : 1; // escala aplicada (para comparar radios en pantalla)
        const near = (a, b, t) => Math.abs(a - b) <= t;
        const tol = bw + 1.5;
        o.onda_en_contorno = near(q.left, sr.left, tol) && near(q.top, sr.top, tol) && near(q.right, sr.right, tol) && near(q.bottom, sr.bottom, tol);
        o.onda_radio_ok = isRound(sh) ? isRound(rip) || radius(rip) >= Math.min(rip.offsetWidth, rip.offsetHeight) / 2 - 1 : near(radius(rip), Math.max(0, radius(sh) - bw), 1.5);
        o.onda_ok = o.onda_en_contorno && o.onda_radio_ok;
        void k;
      } else { o.onda = null; o.onda_ok = false; }
      return o;
    },
    // Lo que pintan sus reglas :focus/:active sueltas (se fuerzan por CDP; :focus-visible NO, que es solo del teclado)
    look(p) {
      const el = window.__pa.el(p); if (!el) return null;
      const cs = getComputedStyle(el);
      return { outline: cs.outlineStyle === 'none' || parseFloat(cs.outlineWidth) === 0 ? 'no' : cs.outlineStyle + ' ' + cs.outlineWidth + ' ' + cs.outlineColor,
        bg: cs.backgroundColor + '|' + cs.backgroundImage, sombra: cs.boxShadow, borde: cs.borderTopColor + ' ' + cs.borderTopWidth };
    },
    hideRipple(p, hide) { const el = window.__pa.el(p); if (!el) return; el.querySelectorAll('.nx-ripple').forEach((x) => { x.style.visibility = hide ? 'hidden' : ''; }); },
    freeze(on) { document.getAnimations().forEach((a) => { try { if (on) a.pause(); else a.play(); } catch (e) {} }); },
    // Al soltar (pointerup sintético con el mismo puntero: el motor suelta, pero sin «click» porque el toque real se cancela)
    release(p, pid) {
      const el = window.__pa.el(p); if (!el) return null;
      el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, pointerId: pid, isPrimary: true }));
      const sh = shapeOf(el), pulses = Array.from(el.querySelectorAll('.nx-pulse'));
      const pu = pulses[pulses.length - 1] || null;
      const o = { redondo: isRound(sh), pulso: !!pu };
      if (pu) {
        o.pulso_en = pu.parentElement === sh ? 'forma' : pu.parentElement === el ? 'propio' : name(pu.parentElement);
        // el pulso es la forma (su caja o, si tiene borde, la de dentro del borde: el mismo círculo), con su radio
        const bw = Math.max(parseFloat(getComputedStyle(sh).borderTopWidth) || 0, parseFloat(getComputedStyle(sh).borderLeftWidth) || 0);
        const near = (a, b) => Math.abs(a - b) <= 2 || Math.abs(a - (b - 2 * bw)) <= 2;
        o.pulso_tam = pu.offsetWidth + 'x' + pu.offsetHeight + ' vs ' + sh.offsetWidth + 'x' + sh.offsetHeight;
        o.pulso_ok = pu.parentElement === sh && near(pu.offsetWidth, sh.offsetWidth) && near(pu.offsetHeight, sh.offsetHeight) && (isRound(sh) ? radius(pu) >= Math.min(pu.offsetWidth, pu.offsetHeight) / 2 - 1 : Math.abs(radius(pu) - radius(sh)) <= 2 + bw);
      }
      o.ok = o.redondo ? !!pu && o.pulso_ok : (!pu || o.pulso_ok); // los redondos con su pulso; el resto, sin pulso o con su forma
      return o;
    },
    // Huella de la onda en píxeles: dos capturas (con y sin onda); cuenta lo pintado fuera del contorno redondeado
    async footprint(a64, b64, g) {
      const load = (b) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = 'data:image/png;base64,' + b; });
      const [ia, ib] = await Promise.all([load(a64), load(b64)]);
      const W = ia.width, H = ia.height, c = document.createElement('canvas'); c.width = W; c.height = H; const x = c.getContext('2d', { willReadFrequently: true });
      x.drawImage(ia, 0, 0); const da = x.getImageData(0, 0, W, H).data;
      x.clearRect(0, 0, W, H); x.drawImage(ib, 0, 0); const db = x.getImageData(0, 0, W, H).data;
      const inside = (px, py) => {
        const X = px + 0.5, Y = py + 0.5, L = g.x, T = g.y, R = g.x + g.w, B = g.y + g.h, rr = g.r, m = 1.6;
        if (X < L - m || X > R + m || Y < T - m || Y > B + m) return false;
        const cx = X < L + rr ? L + rr : X > R - rr ? R - rr : X, cy = Y < T + rr ? T + rr : Y > B - rr ? B - rr : Y;
        return Math.hypot(X - cx, Y - cy) <= rr + m;
      };
      let fuera = 0, dentro = 0;
      for (let py = 0; py < H; py++) for (let px = 0; px < W; px++) {
        const k = (py * W + px) * 4, d = Math.max(Math.abs(da[k] - db[k]), Math.abs(da[k + 1] - db[k + 1]), Math.abs(da[k + 2] - db[k + 2]));
        if (d <= 6) continue;
        if (inside(px, py)) dentro++; else fuera++;
      }
      return { fuera, dentro };
    },
  };
}

(async () => {
  const browser = await PW.chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  const radio = new Radio();
  const opts = { readsContentFallback: true, retain: ['onPayloadReceived'], closeOnNoService: true, pace: [5, 5], ioDelay: 10, asymmetric: true, noTor: true };
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', opts), nB = new NativePhone('B', 'BB:BB:BB:BB:BB:02', opts);
  radio.add(nA); radio.add(nB); nA.load(); nB.load();
  const phA = await bootPhone(browser, 'A', nA, dist, { phone: true, logs, seedName: 'Ana', lang: 'es' });
  const phB = await bootPhone(browser, 'B', nB, dist, { phone: true, logs, seedName: 'Beto', lang: 'es' });
  const A = phA.page, cdp = phA.cdp;
  await A.context().grantPermissions(['microphone', 'camera']).catch(() => {});
  await A.evaluate(pageHelpers, PRESS_SELECTOR);
  await cdp.send('DOM.enable'); await cdp.send('CSS.enable');
  await A.evaluate(() => { window.__paPid = null; document.addEventListener('pointerdown', (e) => { window.__paPid = e.pointerId; }, true); });
  const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: (type === 'touchEnd' || type === 'touchCancel') ? [] : [{ x, y }] });
  const ev = (fn, arg) => A.evaluate(fn, arg);
  const casos = []; // { pantalla, nombre, ... }
  const malos = [];

  // Presiona `c` con el dedo, mide, suelta sin click y mide el pulso
  const probe = async (pantalla, c, root, skip, hold) => {
    // la lista puede haberse vuelto a pintar (filas de contactos): se vuelve a buscar por su nombre
    if (!(await ev((p) => !!window.__pa.el(p), c.path))) {
      const again = await ev(([a, b]) => window.__pa.cands(a, b), [root || '', skip || '']);
      const same = again.find((x) => x.name === c.name);
      if (same) c = same;
    }
    await touch('touchStart', c.cx, c.cy);
    await sleep(300); // la onda ya llenó (260 ms) y el hundido terminó (70 ms)
    const m = await ev((p) => window.__pa.pressed(p), c.path);
    let fp = null;
    if (m && !m.error && m.presionado && m.onda) {
      await ev(() => window.__pa.freeze(true));
      // la captura abarca el botón entero (con su nombre) y la forma, con 10 px de margen
      const g = m.forma_rect, k = m.caja, pad = 10;
      const clip = { x: Math.max(0, Math.floor(k.x - pad)), y: Math.max(0, Math.floor(k.y - pad)) };
      clip.width = Math.min(360 - clip.x, Math.ceil(k.r + pad) - clip.x); clip.height = Math.min(740 - clip.y, Math.ceil(k.b + pad) - clip.y);
      if (clip.width > 4 && clip.height > 4) {
        const a = await A.screenshot({ clip, scale: 'css' });
        await ev(([p]) => window.__pa.hideRipple(p, true), [c.path]);
        const b = await A.screenshot({ clip, scale: 'css' });
        await ev(([p]) => window.__pa.hideRipple(p, false), [c.path]);
        fp = await ev(([a64, b64, gg]) => window.__pa.footprint(a64, b64, gg), [a.toString('base64'), b.toString('base64'), { x: g.x - clip.x, y: g.y - clip.y, w: g.w, h: g.h, r: m.radio_forma * (m.escala || 1) }]);
        // capturas (a escala 1, durante el toque): lo que se sale del contorno y, para comparar builds, los botones de llamada
        if (shots && (fp.fuera > 8 || SHOT_SCREENS.includes(pantalla))) { fs.mkdirSync(shots, { recursive: true }); fs.writeFileSync(path.join(shots, pantalla + '_' + c.name.replace(/[^a-z0-9#.-]+/gi, '_').slice(0, 40) + '.png'), a); }
      }
      await ev(() => window.__pa.freeze(false));
    }
    // P5: con :focus y :active forzados (lo que dejaría un toque), ni outline ni cambio de fondo/sombra/borde por una regla suelta
    let p5 = null;
    try {
      const doc = await cdp.send('DOM.getDocument', { depth: 0 });
      const q = await cdp.send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: '[data-pa="' + c.path + '"]' });
      if (q.nodeId) {
        const base = await ev((p) => window.__pa.look(p), c.path);
        await cdp.send('CSS.forcePseudoState', { nodeId: q.nodeId, forcedPseudoClasses: ['focus', 'active'] });
        const forced = await ev((p) => window.__pa.look(p), c.path);
        await cdp.send('CSS.forcePseudoState', { nodeId: q.nodeId, forcedPseudoClasses: [] });
        const dif = base && forced ? ['bg', 'sombra', 'borde'].filter((k) => base[k] !== forced[k]) : [];
        p5 = { outline: forced ? forced.outline : '?', reglas: dif.map((k) => k + ': ' + base[k] + ' → ' + forced[k]) };
      }
    } catch (e) { p5 = { error: String(e.message || e).slice(0, 80) }; }
    // la onda sigue puesta mientras se mantiene el dedo (lo que se repinta solo —un contador, un icono— no la borra)
    if (hold) await sleep(hold);
    const viva = await ev((p) => { const el = window.__pa.el(p); return !!el && !!el.querySelector('.nx-ripple'); }, c.path);
    const pid = await ev(() => window.__paPid);
    const rel = await ev(([p, id]) => window.__pa.release(p, id), [c.path, pid]);
    await touch('touchCancel');
    await sleep(420);
    const caso = { pantalla, nombre: c.name, motor: c.inSel };
    if (!m || m.error) { caso.error = (m && m.error) || 'sin medida'; casos.push(caso); malos.push(caso); return caso; }
    Object.assign(caso, { forma: m.forma, redondo: m.redondo, presionado: m.presionado, escala: m.escala, onda: m.onda, onda_ok: m.onda_ok, tap_ok: m.tap_ok, foco: p5, huella: fp, pulso: rel });
    caso.P1 = m.presionado && m.escala < 0.999;
    caso.onda_sigue = viva;
    caso.P2 = !!m.onda_ok && (!fp || fp.fuera <= 8) && viva;
    caso.P3 = !!(rel && rel.ok);
    caso.P4 = !!m.tap_ok; caso.P5 = !!p5 && p5.outline === 'no' && !(p5.reglas && p5.reglas.length);
    caso.ok = caso.P1 && caso.P2 && caso.P3 && caso.P4 && caso.P5;
    casos.push(caso);
    if (!caso.ok) malos.push(caso);
    return caso;
  };
  const scan = async (pantalla, root, skip, hold) => {
    await sleep(350);
    const cs = await ev(([a, b]) => window.__pa.cands(a, b), [root || '', skip || '']);
    const res = [];
    for (const c of cs) res.push(await probe(pantalla, c, root, skip, hold));
    if (INV) res.forEach((x) => console.log(pantalla.padEnd(14), (x.ok ? 'ok ' : 'MAL'), x.nombre.padEnd(46), JSON.stringify({ motor: x.motor, forma: x.forma, redondo: x.redondo, P1: x.P1, P2: x.P2, P3: x.P3, P4: x.P4, P5: x.P5, onda: x.onda, huella: x.huella, pulso: x.pulso, foco: x.foco, onda_sigue: x.onda_sigue, err: x.error })));
    return res;
  };

  // ---------- preparar: A y B emparejados ----------
  await A.evaluate(() => window.bleInterface.togglePanel());
  for (let i = 0; i < 100; i++) { await sleep(150); if (await ev(() => !!document.querySelector('#ble-new-device button'))) break; await ev(() => { if (!window.bleInterface.isScanning) { const b = document.getElementById('ble-scan-btn'); if (b) b.click(); } }); }
  await ev(() => { const b = document.querySelector('#ble-new-device button'); if (b) b.click(); }); await sleep(1800);
  await ev(() => { if (document.getElementById('ble-panel').classList.contains('active')) window.bleInterface.togglePanel(); });
  const idB = await phB.page.evaluate(() => window.bleInterface.localNexoId.toLowerCase());
  for (let i = 0; i < 60; i++) { if (await ev(() => !!document.querySelector('#main-contacts-list .ble-contact-row'))) break; await sleep(250); }
  await sleep(800);
  r.preparado = await ev(() => !!document.querySelector('#main-contacts-list .ble-contact-row'));

  // ---------- Contactos ----------
  await scan('contactos', '#app');

  // ---------- chat ----------
  await ev(() => document.querySelector('#main-contacts-list .ble-contact-row').click());
  await sleep(1200);
  await scan('chat', '#app', '#messages-container');
  await scan('chat_aviso', '#e2e-banner'); // el aviso «cifrado de extremo a extremo · toca para verificar»
  // menú «+»
  await ev(() => document.getElementById('attach-btn').click()); await sleep(500);
  await scan('menu_mas', '#attach-menu');
  await ev(() => document.getElementById('attach-btn').click()); await sleep(400);

  // ---------- el micrófono: mantener (graba), sigue presionado y redondo; deslizar a la izquierda cancela ----------
  {
    const mic = await ev(() => { const b = document.getElementById('send-btn'); const q = b.getBoundingClientRect(); return { mic: b.classList.contains('mic-mode'), cx: q.left + q.width / 2, cy: q.top + q.height / 2, path: window.__pa.mark(b) }; });
    const antes = await ev(() => document.querySelectorAll('#messages-container .message').length);
    await touch('touchStart', mic.cx, mic.cy);
    await sleep(300);
    const m1 = await ev((p) => window.__pa.pressed(p), mic.path);
    let grabando = false;
    for (let i = 0; i < 30 && !grabando; i++) { await sleep(100); grabando = await ev(() => { const v = document.getElementById('voice-bar'); return !!v && v.style.display !== 'none'; }); }
    const m2 = await ev((p) => window.__pa.pressed(p), mic.path);
    if (shots) { fs.mkdirSync(shots, { recursive: true }); await A.screenshot({ path: path.join(shots, 'mic_mantenido_grabando.png'), clip: { x: 0, y: 560, width: 360, height: 180 }, scale: 'css' }); }
    for (let i = 1; i <= 8; i++) { await sleep(30); await touch('touchMove', mic.cx - 16 * i, mic.cy); }
    let cancelada = false;
    for (let i = 0; i < 20 && !cancelada; i++) { await sleep(100); cancelada = await ev(() => { const v = document.getElementById('voice-bar'); return !v || v.style.display === 'none'; }); }
    await touch('touchEnd');
    await sleep(1500);
    const despues = await ev(() => document.querySelectorAll('#messages-container .message').length);
    r.M_mic = { modo_mic: mic.mic, presionado: m1.presionado && m1.escala < 0.999, onda_ok: m1.onda_ok, grabando, sigue_presionado_grabando: m2.presionado && m2.escala < 0.999 && m2.onda_ok, deslizar_cancela: cancelada, no_envia: despues === antes };
    r.M_ok = Object.values(r.M_mic).every((v) => v === true);
  }
  // barra de la grabación (🗑 ⏸ ➤): se graba con un toque y se borra al final
  await ev(() => { const i = document.getElementById('message-input'); i.value = ''; i.dispatchEvent(new Event('input', { bubbles: true })); });
  for (let k = 0; k < 3; k++) { // (tras mantener, el primer toque solo apaga la marca de pulsación larga, como en el teléfono)
    await ev(() => document.getElementById('send-btn').click());
    let on = false; for (let i = 0; i < 15 && !on; i++) { await sleep(100); on = await ev(() => { const v = document.getElementById('voice-bar'); return !!v && v.style.display !== 'none'; }); }
    if (on) break;
  }
  await sleep(1200);
  await scan('grabando', '#voice-bar', '', 1100); // (el tiempo se repinta cada 0,5 s)
  await ev(() => { const b = document.getElementById('voice-send'); if (b) b.click(); }); await sleep(2500);
  // la nota de voz enviada: su reproductor en la burbuja
  await scan('nota_voz', await ev(() => { const a = Array.from(document.querySelectorAll('#messages-container .message')).filter((m) => m.querySelector('audio, .audio-attachment, .voice-player, button')).pop(); return a ? '[data-pa="' + window.__pa.mark(a) + '"]' : ''; }));
  // enviar (con texto) y el menú de un mensaje
  await ev(() => { const i = document.getElementById('message-input'); i.value = 'hola botones'; i.dispatchEvent(new Event('input', { bubbles: true })); });
  await scan('chat_texto', '#input-area');
  await ev(() => document.getElementById('send-btn').click()); await sleep(1500);
  await ev(() => { const m = Array.from(document.querySelectorAll('#messages-container .message')).pop(); const c = m && (m.querySelector('.msg-content') || m); if (c) c.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 200, clientY: 300 })); });
  await sleep(500);
  await scan('menu_mensaje', '#nexo-msg-menu');
  // 3195 (dueño 17-11: editar un mensaje enviado): «Editar» del menú → la barra «Editando mensaje» con su ✕ (como la de responder)
  r.menu_editar = await ev(() => { const b = document.querySelector('#nexo-msg-menu .mm-edit'); if (b) b.click(); return !!b; });
  // (antes de la 3195 la barra quedaba DETRÁS de la barra de escribir y su ✕ no se podía tocar: aquí no salía ningún botón)
  if (r.menu_editar) { await sleep(400); r.barra_editar = (await scan('barra_editar', '#edit-bar')).length; await ev(() => { const x = document.querySelector('#edit-bar .edit-cancel'); if (x) x.click(); }); await sleep(300); }
  else { await ev(() => window.__nexoHandleBack && window.__nexoHandleBack()); await sleep(400); }
  // stickers y juegos (desde el menú «+»)
  await ev(() => { const it = document.querySelector('.attach-menu-item[data-type="sticker"]'); if (it) it.click(); }); await sleep(800);
  await scan('stickers', await ev(() => { const s = document.querySelector('.sticker-cell'); let e = s; while (e && e.parentElement && e.parentElement !== document.body) e = e.parentElement; return e && e.id ? '#' + e.id : ''; }));
  await ev(() => window.__nexoHandleBack && window.__nexoHandleBack()); await sleep(500);
  await ev(() => { const it = document.querySelector('.attach-menu-item[data-type="games"]'); if (it) it.click(); }); await sleep(800);
  await scan('juegos', await ev(() => { const s = document.querySelector('.game-pick-item'); let e = s; while (e && e.parentElement && e.parentElement !== document.body) e = e.parentElement; return e && e.id ? '#' + e.id : ''; }));
  await ev(() => window.__nexoHandleBack && window.__nexoHandleBack()); await sleep(500);

  // ---------- llamada y videollamada 1-a-1 (la pantalla de verdad, con la llamada simulada) ----------
  await ev(() => {
    const bi = window.bleInterface; window.__paRealCalls = bi.calls;
    // que los controles de la videollamada no se escondan solos mientras se prueban
    new MutationObserver(() => { const s = document.getElementById('nexo-call-screen'); if (s && s.classList.contains('nc-hide')) s.classList.remove('nc-hide'); }).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['class'] });
  });
  const llamada = async (st) => ev((st) => {
    const bi = window.bleInterface; st.startedAt = st.startedAt || Date.now();
    bi.calls = { call: { state: st.state, nx: st.nx, id: st.id }, state: () => st, videoViews: () => ({}), remoteVideoLive: () => false, _link: () => 'lan:1', flipCamera() {}, shareScreen: () => Promise.resolve(false),
      camera() {}, mute() {}, hangup() {}, accept() {}, reject() {}, toVideo: () => Promise.resolve(false), start: () => Promise.resolve(), askCamPermission() {}, handoff: () => null };
    window.dispatchEvent(new CustomEvent('nexo:call', { detail: st }));
  }, st);
  await llamada({ state: 'calling', nx: idB, id: 'pa1', video: true });
  await scan('llamando', '#nexo-call-screen');
  await llamada({ state: 'ringing', nx: idB, id: 'pa2', video: true });
  await scan('entrante', '#nexo-call-screen');
  await llamada({ state: 'active', nx: idB, id: 'pa3', video: false });
  await sleep(400);
  await scan('llamada_voz', '#nexo-call-screen');
  await llamada({ state: 'active', nx: idB, id: 'pa4', video: true, camState: 'on' });
  await sleep(400);
  await scan('videollamada', '#nexo-call-screen');
  // «Pantalla» pregunta antes; «Agregar» abre el selector de contactos
  await ev(() => { const b = document.querySelector('#nexo-call-screen .call-screen'); if (b) b.click(); }); await sleep(400);
  await scan('aviso_pantalla', '#nexo-scr-ask');
  await ev(() => { const b = document.querySelector('#nexo-scr-ask .nc-ask-no'); if (b) b.click(); }); await sleep(300);
  await ev(() => { const b = document.querySelector('#nexo-call-screen .call-add'); if (b) b.click(); }); await sleep(600);
  await scan('elegir_contacto', '#nexo-contact-picker');
  await ev(() => { const p = document.getElementById('nexo-contact-picker'); if (p) p.remove(); }); await sleep(300);
  // la barra de la llamada minimizada
  await ev(() => window.__nexoCallBack && window.__nexoCallBack()); await sleep(500);
  await scan('barra_llamada', '#nexo-call-bar', '', 1100); // (la barra se repinta cada 1 s)
  await ev(() => { const b = document.getElementById('nexo-call-bar'); if (b) b.click(); }); await sleep(300);
  await ev((nx) => { window.dispatchEvent(new CustomEvent('nexo:call', { detail: { state: 'ended', nx, id: 'pa4', reason: 'hangup' } })); window.bleInterface.calls = window.__paRealCalls; }, idB);
  await sleep(1800);

  // ---------- llamada de GRUPO (entrante y en curso con vídeo) ----------
  const grupo = async (st) => ev((st) => {
    const bi = window.bleInterface; if (!window.__paRealG) window.__paRealG = bi.gcall || null;
    bi.gcall = { gc: st, state: () => st, shareScreen: () => Promise.resolve(false), mute() {}, camera() {}, flip() {}, hangup() {}, accept() {}, reject() {}, cancelInvite() {}, addMember: () => Promise.resolve(), videoViews: () => ({}) };
    window.dispatchEvent(new CustomEvent('nexo:gcall', { detail: st }));
  }, st);
  const me = await ev(() => String(window.bleInterface.localNexoId || '').toLowerCase());
  await grupo({ state: 'ringing', gid: 'gpa1', host: idB, members: [me, idB, 'nx22222222'], legs: [{ nx: idB, state: 'active' }] });
  await scan('grupo_entrante', '#nexo-gcall-screen');
  await grupo({ state: 'active', gid: 'gpa2', members: [me, idB, 'nx22222222'], legs: [{ nx: idB, state: 'active' }, { nx: 'nx22222222', state: 'calling' }], muted: false, cameraOn: true, screen: false });
  await sleep(500);
  await scan('grupo', '#nexo-gcall-screen');
  await ev(() => { window.dispatchEvent(new CustomEvent('nexo:gcall', { detail: null })); window.bleInterface.gcall = window.__paRealG; });
  await sleep(600);

  // ---------- la cámara de NEXO ----------
  await ev(() => { const o = document.getElementById('camera-preview-overlay'); if (o) o.classList.remove('hidden'); });
  await scan('camara', '#camera-preview-overlay');
  await ev(() => { const o = document.getElementById('camera-preview-overlay'); if (o) o.classList.add('hidden'); });

  // ---------- visor de fotos ----------
  await ev(async (idB) => {
    const c = document.createElement('canvas'); c.width = 600; c.height = 450; const g = c.getContext('2d'); g.fillStyle = '#c33'; g.fillRect(0, 0, 600, 450);
    const p = c.toDataURL('image/jpeg', 0.8).split(',')[1], id = 'pafoto' + Date.now();
    await window.vaultAppendMessage(idB, { msgId: id, messageId: id, content: '[adjunto]', timestamp: Date.now(), seq: 99, _own: true, status: 'delivered', attachmentType: 'image', attachmentPayload: p, attachmentMeta: { format: 'jpeg', size: p.length } }, true);
    window.dispatchEvent(new CustomEvent('nexo:ble:closeChat', { detail: {} }));
  }, idB);
  await sleep(500);
  await ev(() => document.querySelector('#main-contacts-list .ble-contact-row').click()); await sleep(1500);
  await ev(() => { const im = Array.from(document.querySelectorAll('#messages-container .msg-content img')).pop(); if (im) im.click(); }); await sleep(900);
  await scan('visor', '#fullscreen-media-overlay');
  await ev(() => window.__nexoHandleBack && window.__nexoHandleBack()); await sleep(500);
  await ev(() => window.dispatchEvent(new CustomEvent('nexo:ble:closeChat', { detail: {} }))); await sleep(600);

  // ---------- menú de un contacto (⋮), Perfil y Ajustes ----------
  await ev(() => { const b = document.querySelector('#main-contacts-list .ble-btn-menu'); if (b) b.click(); }); await sleep(500);
  await scan('menu_contacto', await ev(() => { const s = document.querySelector('.ble-menu-item'); let e = s; while (e && e.parentElement && e.parentElement !== document.body) e = e.parentElement; return e && e.id ? '#' + e.id : ''; }));
  await ev(() => document.body.click()); await sleep(400);
  // agregar contactos (botón redondo de abajo)
  await ev(() => { const b = document.getElementById('ble-fab-btn'); if (b) b.click(); }); await sleep(600);
  // 3222: el botón redondo pregunta «Agregar contactos» / «Crear grupo»
  if (await ev(() => !!document.getElementById('nexo-fab-menu'))) { await scan('menu_agregar', '#nexo-fab-menu'); await ev(() => { const b = document.getElementById('nexo-fab-add'); if (b) b.click(); }); await sleep(800); }
  await scan('agregar', '#ble-panel');
  await ev(() => { if (document.getElementById('ble-panel').classList.contains('active')) window.bleInterface.togglePanel(); }); await sleep(600);
  // Estados (deslizar Contactos a la izquierda)
  { const n = 12; await touch('touchStart', 270, 420); for (let i = 1; i <= n; i++) { await sleep(16); await touch('touchMove', 270 - 210 * i / n, 420); } await touch('touchEnd'); await sleep(700); }
  await scan('estados', '#estados-screen');
  { const n = 12; await touch('touchStart', 90, 420); for (let i = 1; i <= n; i++) { await sleep(16); await touch('touchMove', 90 + 210 * i / n, 420); } await touch('touchEnd'); await sleep(700); }
  await ev(() => window.dispatchEvent(new CustomEvent('nexo:ui:profile'))); await sleep(800);
  await scan('perfil', '#nexo-profile-sheet');
  // 3218: Ajustes se abre con la ruedita de la cabecera (#nexo-settings-btn: por eso la hoja se busca por su id y no por «settings»)
  await ev(() => { const s = document.getElementById('nexo-profile-sheet'); if (s) s.remove(); const g = document.getElementById('nexo-settings-btn'); if (g) g.click(); else window.dispatchEvent(new CustomEvent('nexo:ui:settings')); }); await sleep(800);
  const ajustes = await ev(() => (document.getElementById('nexo-settings-sheet') ? '#nexo-settings-sheet' : ''));
  await scan('ajustes', ajustes);
  await ev(() => { const b = document.querySelector('.nx-set-row'); if (b) b.click(); }); await sleep(700);
  await scan('ajustes_seccion', await ev(() => (document.getElementById('nexo-settings-sheet') ? '#nexo-settings-sheet' : '')));

  console.log('casos', casos.length, 'malos', malos.length);
  r.casos = casos.length; r.malos = malos.map((x) => x.pantalla + ' ' + x.nombre + ' [' + ['P1', 'P2', 'P3', 'P4', 'P5'].filter((k) => !x[k]).join(',') + (x.error ? ' ' + x.error : '') + ']');
  await browser.close();
  fin(r.preparado && !malos.length && r.M_ok && r.menu_editar && r.barra_editar >= 1);
  process.exit(r.resultado === 'OK' ? 0 : 1);
})().catch((e) => { console.log('PRESSALL ' + JSON.stringify({ prueba: 'pressall', resultado: 'FALLO', error: String(e && e.stack || e) })); process.exit(1); });
