/**
 * NEXO — juego secreto «Defensor NEXO» (pedido del dueño, 27-10; versión SENCILLA). Mini-arcade OCULTO: se abre dibujando
 * la letra «N» con el dedo en la pantalla de Ajustes (Perfil). Es puramente de interfaz (Canvas 2D): no toca mensajes,
 * red, vault ni seguridad; si no hay Canvas (p.ej. el simulador jsdom) no rompe nada (no arranca el bucle).
 *
 * El juego (simple a propósito): pilotas una nave NEXO que arrastras por la pantalla; caen METEOROS (amenazas) que se
 * destruyen de un disparo; aparecen CONTACTOS a los que hay que ALCANZAR para salvarlos; y cae una MEJORA (⚡ = disparo
 * triple un rato). Vidas, puntos y CLASIFICACIÓN (mejores puntajes) guardada en el teléfono.
 *
 * Exporta: attachNexoUnlockGesture(el), openNexoGame(), y __recognizeN/loadScores/addScore (para las pruebas, sin Canvas).
 */

import { t } from './i18n.js';

var LB_KEY = 'nexo_game_scores_v1';

// ---------- Clasificación (mejores puntajes, local al teléfono) ----------
export function loadScores() {
  try {
    var raw = window.localStorage && window.localStorage.getItem(LB_KEY);
    var arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.filter(function(e) { return e && typeof e.score === 'number'; }) : [];
  } catch (e) { return []; }
}
export function addScore(score, saved) {
  var list = loadScores();
  list.push({ score: Math.max(0, Math.floor(score) || 0), saved: Math.max(0, Math.floor(saved) || 0), ts: Date.now() });
  list.sort(function(a, b) { return b.score - a.score; });
  list = list.slice(0, 10);
  try { if (window.localStorage) window.localStorage.setItem(LB_KEY, JSON.stringify(list)); } catch (e) {}
  return list;
}

// ---------- Reconocedor del trazo «N» (puro, sin Canvas; probado en tests/sim/juego.js) ----------
// Una «N» son 3 tramos: baja (↓), sube hacia la derecha (↗), baja (↓). Se parte el trazo por longitud en 3 y se mira la
// dirección neta de cada tercio, con tolerancias generosas (es un gesto a mano).
// Reconoce una «N» dibujada de un trazo. El dueño (29-10) aclaró que la «N» se dibuja «ARRIBA ABAJO ARRIBA»: desde abajo
// sube, baja en diagonal y vuelve a subir (dos barras verticales + la diagonal). Antes el reconocedor exigía el sentido
// CONTRARIO (empezar arriba), así que una «N» real se rechazaba. Ahora es AGNÓSTICO al sentido del trazo: cuenta los
// «tramos» verticales (dos vueltas = tres tramos) sin importar si se empezó por arriba o por abajo, ni de izq→der o
// der→izq; sigue rechazando rayas, diagonales simples, «V» (una sola vuelta) y «M/W» (más de dos vueltas).
export function __recognizeN(pts) {
  if (!pts || pts.length < 6) return false;
  var xs = pts.map(function(p) { return p.x; });
  var ys = pts.map(function(p) { return p.y; });
  var minX = Math.min.apply(null, xs), maxX = Math.max.apply(null, xs);
  var minY = Math.min.apply(null, ys), maxY = Math.max.apply(null, ys);
  var w = maxX - minX, h = maxY - minY;
  if (h < 50 || w < 18) return false;      // tamaño mínimo: evita toques/roces pequeños
  if (h < w * 0.5) return false;           // una «N» es más alta que ancha; descarta trazos horizontales
  var cum = [0];
  for (var i = 1; i < pts.length; i++) {
    var dx = pts[i].x - pts[i - 1].x, dy = pts[i].y - pts[i - 1].y;
    cum.push(cum[i - 1] + Math.sqrt(dx * dx + dy * dy));
  }
  var L = cum[cum.length - 1];
  if (L < h * 1.3) return false;           // recorre 3 tramos (no una raya ni una sola diagonal ni una «V»)
  var at = function(frac) {
    var target = L * frac, j = 1;
    while (j < cum.length && cum[j] < target) j++;
    if (j >= pts.length) return pts[pts.length - 1];
    var seg = cum[j] - cum[j - 1] || 1, t = (target - cum[j - 1]) / seg;
    return { x: pts[j - 1].x + (pts[j].x - pts[j - 1].x) * t, y: pts[j - 1].y + (pts[j].y - pts[j - 1].y) * t };
  };
  var M = 32, s = [];
  for (var k = 0; k <= M; k++) s.push(at(k / M));
  if (s[0].x > s[M].x) s.reverse();        // normalizar el trazo a izquierda→derecha (agnóstico al sentido)
  var A = s[0], D = s[M];
  if (D.x - A.x < w * 0.45) return false;  // debe cruzar de un lado al otro (barras izq y der)
  // Extremos verticales con histéresis: inicio, cada vuelta y fin. Una «N» tiene 2 vueltas → 4 extremos alternando
  // arriba/abajo (por ejemplo abajo-arriba-abajo-arriba, que es «arriba abajo arriba» dibujando).
  var thr = h * 0.35, turns = [{ y: s[0].y, i: 0 }], dir = 0, ext = s[0].y, extIdx = 0;
  for (var n = 1; n <= M; n++) {
    var y = s[n].y;
    if (dir === 0) {
      if (y - s[0].y > thr) { dir = 1; ext = y; extIdx = n; }
      else if (s[0].y - y > thr) { dir = -1; ext = y; extIdx = n; }
    } else if (dir === 1) {                // bajando (y aumenta)
      if (y > ext) { ext = y; extIdx = n; }
      else if (ext - y > thr) { turns.push({ y: ext, i: extIdx }); dir = -1; ext = y; extIdx = n; }
    } else {                               // subiendo (y baja)
      if (y < ext) { ext = y; extIdx = n; }
      else if (y - ext > thr) { turns.push({ y: ext, i: extIdx }); dir = 1; ext = y; extIdx = n; }
    }
  }
  turns.push({ y: s[M].y, i: M });
  if (turns.length !== 4) return false;    // exactamente 2 vueltas (3 tramos) → descarta «V» (1) y «M/W» (3+)
  var isTop = function(t) { return t.y < minY + h * 0.4; };
  var isBot = function(t) { return t.y > minY + h * 0.6; };
  var p0 = turns[0], p1 = turns[1], p2 = turns[2], p3 = turns[3];
  var patA = isBot(p0) && isTop(p1) && isBot(p2) && isTop(p3); // empieza abajo (lo que describió el dueño)
  var patB = isTop(p0) && isBot(p1) && isTop(p2) && isBot(p3); // empieza arriba (el sentido inverso, también vale)
  if (!patA && !patB) return false;
  // La diagonal es el tramo del medio: entre la 1.ª y la 2.ª vuelta la x debe cruzar buena parte del ancho.
  if (Math.abs(s[p2.i].x - s[p1.i].x) < w * 0.4) return false;
  return true;
}

export function attachNexoUnlockGesture(el) {
  if (!el || el.__nexoNWired) return;
  el.__nexoNWired = true;
  var pts = null, drawing = false, t0 = 0;
  var start = function(x, y) { if (drawing) return; drawing = true; t0 = Date.now(); pts = [{ x: x, y: y }]; };
  var move = function(x, y) { if (drawing && pts && pts.length < 3000) pts.push({ x: x, y: y }); };
  var end = function() {
    if (drawing && pts && Date.now() - t0 < 6000 && __recognizeN(pts)) { pts = null; drawing = false; openNexoGame(); return; }
    drawing = false; pts = null;
  };
  var cancel = function() { drawing = false; pts = null; };
  // Informe del dueño (28-10 y 29-10): dibujar la «N» en el espacio negro de Perfil NO abría el juego.
  // (1) La «N» es ALTA y el dedo se salía de la zona (220 px) → setPointerCapture mantiene los eventos de ese dedo en la
  //     zona aunque se salga. (2) ANTES había un "lock" por tipo de entrada: si el WebView emitía `pointerdown` (fijaba el
  //     lock) pero luego NO mandaba `pointermove` de forma fiable, los `touchmove` quedaban BLOQUEADOS y el trazo se
  //     quedaba en 1 punto → nunca se reconocía la «N». AHORA pointer Y touch alimentan el MISMO trazo: se empieza con el
  //     primer "down" y se acumulan los "move" de cualquiera de los dos (sobran duplicados, pero nunca falta el trazo).
  //     Todo pasivo: no bloquea el scroll ni los toques normales (la zona ya tiene touch-action:none).
  el.addEventListener('pointerdown', function(e) { try { el.setPointerCapture(e.pointerId); } catch (x) {} start(e.clientX, e.clientY); }, { passive: true });
  el.addEventListener('pointermove', function(e) { move(e.clientX, e.clientY); }, { passive: true });
  el.addEventListener('pointerup', function(e) { try { el.releasePointerCapture(e.pointerId); } catch (x) {} end(); }, { passive: true });
  el.addEventListener('pointercancel', cancel, { passive: true });
  el.addEventListener('touchstart', function(e) { var t = e.touches && e.touches[0]; if (t) start(t.clientX, t.clientY); }, { passive: true });
  el.addEventListener('touchmove', function(e) { var t = e.touches && e.touches[0]; if (t) move(t.clientX, t.clientY); }, { passive: true });
  el.addEventListener('touchend', end, { passive: true });
  el.addEventListener('touchcancel', cancel, { passive: true });
}

// ---------- El juego (sencillo) ----------
export function openNexoGame() {
  if (document.getElementById('nexo-game-overlay')) return;
  var ov = document.createElement('div');
  ov.id = 'nexo-game-overlay';
  ov.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:#05060f;overflow:hidden;touch-action:none;';
  var canvas = document.createElement('canvas');
  canvas.style.cssText = 'display:block;width:100%;height:100%;';
  ov.appendChild(canvas);
  var closeBtn = document.createElement('button');
  closeBtn.textContent = '✕'; closeBtn.setAttribute('aria-label', t('misc_close_game', 'Cerrar juego'));
  closeBtn.style.cssText = 'position:absolute;top:10px;right:12px;width:40px;height:40px;border-radius:50%;border:none;background:rgba(255,255,255,0.12);color:#fff;font-size:18px;z-index:3;cursor:pointer;';
  ov.appendChild(closeBtn);
  document.body.appendChild(ov);

  var ctx = null;
  try { ctx = canvas.getContext && canvas.getContext('2d'); } catch (e) { ctx = null; }
  var MONO = "'Courier New', 'Courier', monospace"; // tipografía arcade (blanco y negro)

  var G = {
    raf: 0, running: false, over: false, started: false, W: 0, H: 0,
    player: { x: 0, y: 0, r: 16 }, bullets: [], meteors: [], contacts: [], power: null, parts: [],
    score: 0, lives: 3, saved: 0, triple: 0, lastShot: 0, tMeteor: 0, tContact: 0, tPower: 0, t: 0, last: 0, scores: null,
  };

  var contactNames = (function() {
    try {
      var bi = window.bleInterface;
      var cs = (bi && typeof bi.getContacts === 'function' && bi.getContacts()) || (window.NEXO && window.NEXO.contacts) || [];
      var names = (cs || []).map(function(c) { return String((c && (c.name || c.nombre)) || '').trim(); }).filter(Boolean);
      return names.length ? names : null;
    } catch (e) { return null; }
  })();
  var GENERIC = ['Ana', 'Beto', 'Caro', 'Dani', 'Eva', 'Fito', 'Gaby', 'Hugo'];
  var initials = function(n) { var w = String(n).split(/\s+/).filter(Boolean); return ((w[0] || '?').charAt(0) + (w[1] || '').charAt(0)).toUpperCase(); };
  var pickName = function() { var a = contactNames || GENERIC; return a[(Math.random() * a.length) | 0] || 'NEXO'; };

  function resize() {
    var dpr = Math.min(2, (window.devicePixelRatio || 1));
    G.W = ov.clientWidth || window.innerWidth || 360; G.H = ov.clientHeight || window.innerHeight || 640;
    canvas.width = Math.floor(G.W * dpr); canvas.height = Math.floor(G.H * dpr);
    if (ctx) { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.scale(dpr, dpr); }
    if (!G.started) { G.player.x = G.W / 2; G.player.y = G.H - 90; }
  }
  resize();
  window.addEventListener('resize', resize);

  var dragging = false;
  var toLocal = function(e) { var r = canvas.getBoundingClientRect(); var tp = (e.touches && e.touches[0]) || e; return { x: tp.clientX - r.left, y: tp.clientY - r.top }; };
  var onDown = function(e) {
    if (G.over) { restart(); return; }
    if (!G.started) { G.started = true; G.running = true; }
    dragging = true; var p = toLocal(e); G.player.x = p.x; G.player.y = Math.min(G.H - 30, p.y); e.preventDefault && e.preventDefault();
  };
  var onMove = function(e) { if (!dragging) return; var p = toLocal(e); G.player.x = Math.max(16, Math.min(G.W - 16, p.x)); G.player.y = Math.max(40, Math.min(G.H - 30, p.y)); e.preventDefault && e.preventDefault(); };
  var onUp = function() { dragging = false; };
  canvas.addEventListener('mousedown', onDown); canvas.addEventListener('mousemove', onMove); window.addEventListener('mouseup', onUp);
  canvas.addEventListener('touchstart', onDown, { passive: false }); canvas.addEventListener('touchmove', onMove, { passive: false }); window.addEventListener('touchend', onUp);

  function boom(x, y, color) { for (var i = 0; i < 7; i++) { var a = Math.random() * 6.28, s = 40 + Math.random() * 90; G.parts.push({ x: x, y: y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.45, t: 0, color: color }); } }
  function hit(ax, ay, ar, bx, by, br) { var dx = ax - bx, dy = ay - by; return (dx * dx + dy * dy) <= (ar + br) * (ar + br); }
  function gameOver() { G.over = true; G.running = false; G.scores = addScore(G.score, G.saved); }
  function restart() { G.bullets = []; G.meteors = []; G.contacts = []; G.parts = []; G.power = null; G.score = 0; G.lives = 3; G.saved = 0; G.triple = 0; G.over = false; G.started = true; G.running = true; G.tMeteor = G.tContact = G.tPower = G.t = 0; G.player.x = G.W / 2; G.player.y = G.H - 90; }

  function update(dt, now) {
    if (!G.running) return;
    G.t += dt; // tiempo jugando: la dificultad sube poco a poco con el tiempo (pedido del dueño: que no sea aburrido)
    if (G.triple > 0) G.triple -= dt;
    // disparo automático
    var rate = G.triple > 0 ? 260 : 380;
    if (now - G.lastShot >= rate) {
      G.lastShot = now; var cx = G.player.x, cy = G.player.y - 18;
      if (G.triple > 0) { G.bullets.push({ x: cx, y: cy, vx: 0 }, { x: cx, y: cy, vx: -120 }, { x: cx, y: cy, vx: 120 }); }
      else G.bullets.push({ x: cx, y: cy, vx: 0 });
    }
    G.tMeteor += dt; G.tContact += dt; G.tPower += dt;
    // Intervalo de aparición y velocidad de los meteoros: suben con el PUNTAJE y, además, poco a poco con el TIEMPO.
    if (G.tMeteor > Math.max(0.3, 1.0 - G.score * 0.0006 - G.t * 0.006)) { G.tMeteor = 0; var r = 13 + Math.random() * 16; G.meteors.push({ x: r + Math.random() * (G.W - 2 * r), y: -r, r: r, vy: 70 + Math.random() * 55 + G.score * 0.015 + G.t * 2.4, vx: (Math.random() - 0.5) * 30 }); }
    if (G.tContact > 7) { G.tContact = 0; var nm = pickName(); G.contacts.push({ x: 20 + Math.random() * (G.W - 40), y: -18, r: 16, vy: 55 + Math.random() * 20, ini: initials(nm) }); }
    if (G.tPower > 13 && !G.power) { G.tPower = 0; G.power = { x: 20 + Math.random() * (G.W - 40), y: -14, r: 13, vy: 80 }; }

    var i, j;
    for (i = G.bullets.length - 1; i >= 0; i--) { var b = G.bullets[i]; b.y -= 520 * dt; b.x += (b.vx || 0) * dt; if (b.y < -20) G.bullets.splice(i, 1); }
    for (i = G.meteors.length - 1; i >= 0; i--) {
      var m = G.meteors[i]; m.y += m.vy * dt; m.x += m.vx * dt; if (m.x < m.r || m.x > G.W - m.r) m.vx *= -1;
      if (m.y > G.H + m.r) { G.meteors.splice(i, 1); continue; }
      if (hit(m.x, m.y, m.r, G.player.x, G.player.y, G.player.r)) { boom(G.player.x, G.player.y, '#fff'); G.meteors.splice(i, 1); G.lives--; if (G.lives <= 0) { gameOver(); } continue; }
      for (j = G.bullets.length - 1; j >= 0; j--) { if (hit(m.x, m.y, m.r, G.bullets[j].x, G.bullets[j].y, 4)) { G.bullets.splice(j, 1); boom(m.x, m.y, '#fff'); G.score += 10; G.meteors.splice(i, 1); break; } }
    }
    if (G.power) { G.power.y += G.power.vy * dt; if (G.power.y > G.H + 14) G.power = null; else if (hit(G.power.x, G.power.y, G.power.r, G.player.x, G.player.y, G.player.r)) { G.triple = 8; boom(G.power.x, G.power.y, '#fff'); G.score += 5; G.power = null; } }
    for (i = G.contacts.length - 1; i >= 0; i--) {
      var c = G.contacts[i]; c.y += c.vy * dt;
      var lost = false; for (j = 0; j < G.meteors.length; j++) { if (hit(c.x, c.y, c.r, G.meteors[j].x, G.meteors[j].y, G.meteors[j].r)) { lost = true; break; } }
      if (lost) { boom(c.x, c.y, '#777'); G.contacts.splice(i, 1); continue; }
      if (hit(c.x, c.y, c.r, G.player.x, G.player.y, G.player.r)) { boom(c.x, c.y, '#fff'); G.saved++; G.score += 25; G.contacts.splice(i, 1); continue; }
      if (c.y > G.H + c.r) G.contacts.splice(i, 1);
    }
    for (i = G.parts.length - 1; i >= 0; i--) { var pt = G.parts[i]; pt.t += dt; pt.x += pt.vx * dt; pt.y += pt.vy * dt; if (pt.t > pt.life) G.parts.splice(i, 1); }
  }

  function draw() {
    if (!ctx) return;
    // Estilo ARCADE en BLANCO Y NEGRO (pedido del dueño): todo monocromo sobre fondo negro, tipografía monoespaciada.
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, G.W, G.H);
    // Contactos = disco BLANCO con iniciales negras (los amigos se ven claros). Meteoros = aro blanco con relleno oscuro.
    G.contacts.forEach(function(c) { ctx.beginPath(); ctx.arc(c.x, c.y, c.r, 0, 7); ctx.fillStyle = '#fff'; ctx.fill(); ctx.fillStyle = '#000'; ctx.font = 'bold 12px ' + MONO; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(c.ini, c.x, c.y); });
    G.meteors.forEach(function(m) { ctx.beginPath(); ctx.arc(m.x, m.y, m.r, 0, 7); ctx.fillStyle = '#111'; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = '#fff'; ctx.stroke(); });
    if (G.power) { ctx.save(); ctx.translate(G.power.x, G.power.y); ctx.rotate(0.785); ctx.fillStyle = '#fff'; ctx.fillRect(-9, -9, 18, 18); ctx.restore(); ctx.fillStyle = '#000'; ctx.font = 'bold 14px ' + MONO; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('+', G.power.x, G.power.y); }
    ctx.fillStyle = '#fff'; G.bullets.forEach(function(b) { ctx.fillRect(b.x - 2, b.y - 5, 4, 10); });
    var px = G.player.x, py = G.player.y; ctx.save(); ctx.shadowColor = '#fff'; ctx.shadowBlur = 8; ctx.beginPath(); ctx.moveTo(px, py - 18); ctx.lineTo(px - 14, py + 14); ctx.lineTo(px + 14, py + 14); ctx.closePath(); ctx.fillStyle = '#fff'; ctx.fill(); ctx.restore();
    G.parts.forEach(function(pt) { ctx.globalAlpha = Math.max(0, 1 - pt.t / pt.life); ctx.fillStyle = pt.color; ctx.fillRect(pt.x - 2, pt.y - 2, 4, 4); ctx.globalAlpha = 1; });
    ctx.fillStyle = '#fff'; ctx.font = 'bold 14px ' + MONO; ctx.textAlign = 'left'; ctx.textBaseline = 'top'; ctx.fillText(t('misc_game_points', 'PUNTOS ') + G.score, 12, 12); ctx.fillText(t('misc_game_saved', 'SALVADOS ') + G.saved, 12, 32);
    ctx.textAlign = 'right'; ctx.fillText('♥ ' + Math.max(0, G.lives), G.W - 12, 12);
    if (!G.started) overlayText([t('misc_game_title', 'DEFENSOR NEXO'), '', t('misc_game_drag', 'ARRASTRA TU NAVE'), t('misc_game_destroy', 'DESTRUYE METEOROS'), t('misc_game_save_contacts', 'Y SALVA A TUS CONTACTOS'), t('misc_game_speed', 'LA VELOCIDAD SUBE CON EL TIEMPO'), '', t('misc_game_tap_start', 'TOCA PARA EMPEZAR')]);
    else if (G.over) { var ls = [t('misc_game_over', 'GAME OVER'), t('misc_game_points', 'PUNTOS ') + G.score + t('misc_game_saved_sp', '  SALVADOS ') + G.saved, '', t('misc_game_best', '-- MEJORES --')]; (G.scores || loadScores()).slice(0, 5).forEach(function(s, k) { ls.push((k + 1) + '.  ' + s.score + t('misc_game_pts', ' PTS')); }); ls.push('', t('misc_game_tap_again', 'TOCA PARA JUGAR DE NUEVO')); overlayText(ls); }
  }
  function overlayText(lines) {
    if (!ctx) return; ctx.fillStyle = 'rgba(0,0,0,0.85)'; ctx.fillRect(0, 0, G.W, G.H); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    var y = G.H / 2 - lines.length * 12;
    lines.forEach(function(ln, k) { var big = k === 0; ctx.fillStyle = '#fff'; ctx.font = (big ? 'bold 26px ' : '14px ') + MONO; ctx.fillText(ln, G.W / 2, y); y += big ? 38 : 22; });
  }
  function frame(ts) {
    if (!document.getElementById('nexo-game-overlay')) return;
    var now = ts || (window.performance && performance.now()) || Date.now();
    var dt = G.last ? Math.min(0.05, (now - G.last) / 1000) : 0; G.last = now;
    update(dt, now); draw();
    G.raf = window.requestAnimationFrame ? window.requestAnimationFrame(frame) : 0;
  }
  function close() { G.running = false; if (G.raf && window.cancelAnimationFrame) window.cancelAnimationFrame(G.raf); window.removeEventListener('resize', resize); window.removeEventListener('mouseup', onUp); window.removeEventListener('touchend', onUp); if (ov.parentNode) ov.parentNode.removeChild(ov); }
  closeBtn.onclick = close; ov.__nexoClose = close;
  if (ctx && window.requestAnimationFrame) G.raf = window.requestAnimationFrame(frame);
  return ov;
}

// Acceso de respaldo y gancho para las pruebas (funciones puras, sin efectos; consistente con el resto de la app)
try { if (typeof window !== 'undefined') { window.__nexoOpenGame = openNexoGame; window.__nexoGame = { recognizeN: __recognizeN, loadScores: loadScores, addScore: addScore, open: openNexoGame }; } } catch (e) {}
