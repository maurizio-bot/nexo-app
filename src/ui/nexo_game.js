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
export function __recognizeN(pts) {
  if (!pts || pts.length < 8) return false;
  var xs = pts.map(function(p) { return p.x; });
  var ys = pts.map(function(p) { return p.y; });
  var minX = Math.min.apply(null, xs), maxX = Math.max.apply(null, xs);
  var minY = Math.min.apply(null, ys), maxY = Math.max.apply(null, ys);
  var w = maxX - minX, h = maxY - minY;
  if (h < 60 || w < 30) return false;      // tamaño mínimo: evita toques/roces pequeños
  if (h < w * 0.6) return false;           // una «N» es más alta que ancha; descarta trazos horizontales
  var cum = [0];
  for (var i = 1; i < pts.length; i++) {
    var dx = pts[i].x - pts[i - 1].x, dy = pts[i].y - pts[i - 1].y;
    cum.push(cum[i - 1] + Math.sqrt(dx * dx + dy * dy));
  }
  var L = cum[cum.length - 1];
  if (L < h) return false;
  var at = function(frac) {
    var target = L * frac, j = 1;
    while (j < cum.length && cum[j] < target) j++;
    if (j >= pts.length) return pts[pts.length - 1];
    var seg = cum[j] - cum[j - 1] || 1, t = (target - cum[j - 1]) / seg;
    return { x: pts[j - 1].x + (pts[j].x - pts[j - 1].x) * t, y: pts[j - 1].y + (pts[j].y - pts[j - 1].y) * t };
  };
  var A = at(0), B = at(1 / 3), C = at(2 / 3), D = at(1);
  var down1 = (B.y - A.y) > h * 0.3;                               // tramo 1: baja
  var up2 = (B.y - C.y) > h * 0.25 && (C.x - B.x) > w * 0.2;       // tramo 2: sube y va a la derecha
  var down3 = (D.y - C.y) > h * 0.3;                               // tramo 3: baja
  var goesRight = (D.x - A.x) > w * 0.3;                           // termina a la derecha
  return down1 && up2 && down3 && goesRight;
}

export function attachNexoUnlockGesture(el) {
  if (!el || el.__nexoNWired) return;
  el.__nexoNWired = true;
  var pts = null, drawing = false, t0 = 0, lock = 0; // lock: qué entrada manda el trazo (1=pointer, 2=touch)
  var start = function(x, y) { drawing = true; t0 = Date.now(); pts = [{ x: x, y: y }]; };
  var move = function(x, y) { if (drawing && pts) pts.push({ x: x, y: y }); };
  var end = function() {
    if (drawing && pts && Date.now() - t0 < 4000 && __recognizeN(pts)) { pts = null; drawing = false; openNexoGame(); return; }
    drawing = false; pts = null;
  };
  // Un solo tipo de entrada por trazo: en el teléfono pointer y touch se emiten a la vez; el que empieza manda.
  var begin = function(kind, x, y) { if (lock && lock !== kind) return; lock = kind; start(x, y); };
  var cont = function(kind, x, y) { if (lock === kind) move(x, y); };
  var finish = function(kind) { if (lock === kind) { end(); lock = 0; } };
  // Informe del dueño (28-10): dibujar la «N» en el espacio negro de Perfil NO abría el juego. La «N» es ALTA y el dedo
  // se salía de la zona (220 px): sin capturar el puntero, los `pointermove`/`pointerup` dejaban de llegar aquí y el
  // trazo quedaba incompleto → el reconocedor nunca veía una «N». setPointerCapture hace que TODOS los eventos de ese
  // dedo sigan llegando a la zona aunque se salga. Todo pasivo: no bloquea el scroll ni los toques normales.
  el.addEventListener('pointerdown', function(e) { try { el.setPointerCapture(e.pointerId); } catch (x) {} begin(1, e.clientX, e.clientY); }, { passive: true });
  el.addEventListener('pointermove', function(e) { cont(1, e.clientX, e.clientY); }, { passive: true });
  el.addEventListener('pointerup', function(e) { try { el.releasePointerCapture(e.pointerId); } catch (x) {} finish(1); }, { passive: true });
  el.addEventListener('pointercancel', function() { drawing = false; pts = null; lock = 0; }, { passive: true });
  // Respaldo por eventos táctiles (algún WebView no emite `pointermove` de forma fiable al arrastrar).
  el.addEventListener('touchstart', function(e) { var t = e.touches && e.touches[0]; if (t) begin(2, t.clientX, t.clientY); }, { passive: true });
  el.addEventListener('touchmove', function(e) { var t = e.touches && e.touches[0]; if (t) cont(2, t.clientX, t.clientY); }, { passive: true });
  el.addEventListener('touchend', function() { finish(2); }, { passive: true });
  el.addEventListener('touchcancel', function() { drawing = false; pts = null; lock = 0; }, { passive: true });
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
  closeBtn.textContent = '✕'; closeBtn.setAttribute('aria-label', 'Cerrar juego');
  closeBtn.style.cssText = 'position:absolute;top:10px;right:12px;width:40px;height:40px;border-radius:50%;border:none;background:rgba(255,255,255,0.12);color:#fff;font-size:18px;z-index:3;cursor:pointer;';
  ov.appendChild(closeBtn);
  document.body.appendChild(ov);

  var ctx = null;
  try { ctx = canvas.getContext && canvas.getContext('2d'); } catch (e) { ctx = null; }

  var G = {
    raf: 0, running: false, over: false, started: false, W: 0, H: 0,
    player: { x: 0, y: 0, r: 16 }, bullets: [], meteors: [], contacts: [], power: null, parts: [],
    score: 0, lives: 3, saved: 0, triple: 0, lastShot: 0, tMeteor: 0, tContact: 0, tPower: 0, last: 0, scores: null,
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
  var toLocal = function(e) { var r = canvas.getBoundingClientRect(); var t = (e.touches && e.touches[0]) || e; return { x: t.clientX - r.left, y: t.clientY - r.top }; };
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
  function restart() { G.bullets = []; G.meteors = []; G.contacts = []; G.parts = []; G.power = null; G.score = 0; G.lives = 3; G.saved = 0; G.triple = 0; G.over = false; G.started = true; G.running = true; G.tMeteor = G.tContact = G.tPower = 0; G.player.x = G.W / 2; G.player.y = G.H - 90; }

  function update(dt, now) {
    if (!G.running) return;
    if (G.triple > 0) G.triple -= dt;
    // disparo automático
    var rate = G.triple > 0 ? 260 : 380;
    if (now - G.lastShot >= rate) {
      G.lastShot = now; var cx = G.player.x, cy = G.player.y - 18;
      if (G.triple > 0) { G.bullets.push({ x: cx, y: cy, vx: 0 }, { x: cx, y: cy, vx: -120 }, { x: cx, y: cy, vx: 120 }); }
      else G.bullets.push({ x: cx, y: cy, vx: 0 });
    }
    G.tMeteor += dt; G.tContact += dt; G.tPower += dt;
    if (G.tMeteor > Math.max(0.45, 1.0 - G.score * 0.0006)) { G.tMeteor = 0; var r = 13 + Math.random() * 16; G.meteors.push({ x: r + Math.random() * (G.W - 2 * r), y: -r, r: r, vy: 70 + Math.random() * 55 + G.score * 0.015, vx: (Math.random() - 0.5) * 30 }); }
    if (G.tContact > 7) { G.tContact = 0; var nm = pickName(); G.contacts.push({ x: 20 + Math.random() * (G.W - 40), y: -18, r: 16, vy: 55 + Math.random() * 20, ini: initials(nm) }); }
    if (G.tPower > 13 && !G.power) { G.tPower = 0; G.power = { x: 20 + Math.random() * (G.W - 40), y: -14, r: 13, vy: 80 }; }

    var i, j;
    for (i = G.bullets.length - 1; i >= 0; i--) { var b = G.bullets[i]; b.y -= 520 * dt; b.x += (b.vx || 0) * dt; if (b.y < -20) G.bullets.splice(i, 1); }
    for (i = G.meteors.length - 1; i >= 0; i--) {
      var m = G.meteors[i]; m.y += m.vy * dt; m.x += m.vx * dt; if (m.x < m.r || m.x > G.W - m.r) m.vx *= -1;
      if (m.y > G.H + m.r) { G.meteors.splice(i, 1); continue; }
      if (hit(m.x, m.y, m.r, G.player.x, G.player.y, G.player.r)) { boom(G.player.x, G.player.y, '#ff5a5a'); G.meteors.splice(i, 1); G.lives--; if (G.lives <= 0) { gameOver(); } continue; }
      for (j = G.bullets.length - 1; j >= 0; j--) { if (hit(m.x, m.y, m.r, G.bullets[j].x, G.bullets[j].y, 4)) { G.bullets.splice(j, 1); boom(m.x, m.y, '#ff8a3d'); G.score += 10; G.meteors.splice(i, 1); break; } }
    }
    if (G.power) { G.power.y += G.power.vy * dt; if (G.power.y > G.H + 14) G.power = null; else if (hit(G.power.x, G.power.y, G.power.r, G.player.x, G.player.y, G.player.r)) { G.triple = 8; boom(G.power.x, G.power.y, '#00d4ff'); G.score += 5; G.power = null; } }
    for (i = G.contacts.length - 1; i >= 0; i--) {
      var c = G.contacts[i]; c.y += c.vy * dt;
      var lost = false; for (j = 0; j < G.meteors.length; j++) { if (hit(c.x, c.y, c.r, G.meteors[j].x, G.meteors[j].y, G.meteors[j].r)) { lost = true; break; } }
      if (lost) { boom(c.x, c.y, '#ff5a5a'); G.contacts.splice(i, 1); continue; }
      if (hit(c.x, c.y, c.r, G.player.x, G.player.y, G.player.r)) { boom(c.x, c.y, '#38e8a0'); G.saved++; G.score += 25; G.contacts.splice(i, 1); continue; }
      if (c.y > G.H + c.r) G.contacts.splice(i, 1);
    }
    for (i = G.parts.length - 1; i >= 0; i--) { var pt = G.parts[i]; pt.t += dt; pt.x += pt.vx * dt; pt.y += pt.vy * dt; if (pt.t > pt.life) G.parts.splice(i, 1); }
  }

  function draw() {
    if (!ctx) return;
    ctx.fillStyle = '#05060f'; ctx.fillRect(0, 0, G.W, G.H);
    G.contacts.forEach(function(c) { ctx.beginPath(); ctx.arc(c.x, c.y, c.r, 0, 7); ctx.fillStyle = '#143b33'; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = '#38e8a0'; ctx.stroke(); ctx.fillStyle = '#eafff5'; ctx.font = 'bold 12px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(c.ini, c.x, c.y); });
    G.meteors.forEach(function(m) { ctx.beginPath(); ctx.arc(m.x, m.y, m.r, 0, 7); ctx.fillStyle = '#ff8a3d'; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(255,180,120,0.5)'; ctx.stroke(); });
    if (G.power) { ctx.save(); ctx.translate(G.power.x, G.power.y); ctx.rotate(0.785); ctx.fillStyle = '#00d4ff'; ctx.fillRect(-9, -9, 18, 18); ctx.restore(); ctx.fillStyle = '#04121a'; ctx.font = 'bold 13px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('⚡', G.power.x, G.power.y); }
    ctx.fillStyle = '#aef'; G.bullets.forEach(function(b) { ctx.beginPath(); ctx.arc(b.x, b.y, 4, 0, 7); ctx.fill(); });
    var px = G.player.x, py = G.player.y; ctx.save(); ctx.shadowColor = '#00d4ff'; ctx.shadowBlur = 14; ctx.beginPath(); ctx.moveTo(px, py - 18); ctx.lineTo(px - 14, py + 14); ctx.lineTo(px + 14, py + 14); ctx.closePath(); ctx.fillStyle = '#00d4ff'; ctx.fill(); ctx.restore();
    G.parts.forEach(function(pt) { ctx.globalAlpha = Math.max(0, 1 - pt.t / pt.life); ctx.fillStyle = pt.color; ctx.fillRect(pt.x - 2, pt.y - 2, 4, 4); ctx.globalAlpha = 1; });
    ctx.fillStyle = '#eaf6ff'; ctx.font = 'bold 16px sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'top'; ctx.fillText('Puntos ' + G.score, 12, 12); ctx.fillText('Salvados ' + G.saved, 12, 34);
    ctx.textAlign = 'right'; ctx.fillText('♥'.repeat(Math.max(0, G.lives)), G.W - 12, 12);
    if (!G.started) overlayText(['DEFENSOR NEXO', '', 'Arrastra tu nave.', 'Destruye meteoros y salva a tus contactos.', '', 'Toca para empezar']);
    else if (G.over) { var ls = ['FIN', 'Puntos: ' + G.score + ' · Salvados: ' + G.saved, '', '— Clasificación —']; (G.scores || loadScores()).slice(0, 5).forEach(function(s, k) { ls.push((k + 1) + '.  ' + s.score + ' pts'); }); ls.push('', 'Toca para jugar de nuevo'); overlayText(ls); }
  }
  function overlayText(lines) {
    if (!ctx) return; ctx.fillStyle = 'rgba(5,6,15,0.82)'; ctx.fillRect(0, 0, G.W, G.H); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    var y = G.H / 2 - lines.length * 13;
    lines.forEach(function(t, k) { var big = k === 0; ctx.fillStyle = big ? '#00d4ff' : '#dfeaf2'; ctx.font = (big ? 'bold 28px' : '15px') + ' sans-serif'; ctx.fillText(t, G.W / 2, y); y += big ? 40 : 24; });
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
