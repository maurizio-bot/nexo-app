/**
 * call_voice_fx.js v1.0 (ronda 2772) — Filtros del micrófono en las llamadas (lo usa call_media.js).
 * Pedido del dueño (25-10): "aplicar filtros" y "si un usuario habla, el micrófono del otro se baja un porcentaje para
 * evitar interferencias". Va después de lo que ya hace el teléfono (cancelación de eco, de ruido y ganancia del
 * sistema, pedidas en getUserMedia), por trozos de ~21 ms del micrófono (48 kHz, mono), en este orden:
 *  1. paso alto a 60 Hz: quita retumbos, golpes y viento (Chrome ya pone uno a 100 Hz con la supresión de ruido; este,
 *     más bajo, no adelgaza la voz y queda por si un teléfono no lo hace);
 *  2. supresor de eco: la voz del otro sale por el altavoz y vuelve al micrófono. Mientras suena el otro (y 200 ms más,
 *     la cola del eco), el micrófono baja 12 dB (queda al 25 %), salvo que uno hable a la vez claramente por encima del
 *     eco (los dos hablan: solo baja 3 dB durante al menos 200 ms, para no cortar a nadie: es lo que la norma P.340 llama
 *     conversación completa a la vez). Con cascos o Bluetooth no baja (no hay eco). Valores como los del cancelador de
 *     WebRTC (AEC3): detectar en ~20–50 ms, mantener 200 ms. El eco se mide solo: cada medio segundo se busca con qué
 *     retraso (0–600 ms) lo que
 *     entra al micrófono sigue a lo que suena del otro y cuánto vuelve (los últimos 3 s); sin medida aún, se supone
 *     fuerte; si suena el otro y el micrófono se queda en el ruido de fondo, es que casi no vuelve (el teléfono lo
 *     cancela bien) y el eco esperado baja;
 *  3. puerta de ruido suave: en silencio (cerca del ruido de fondo, que se mide solo) baja 10 dB; al hablar abre en
 *     ~5 ms (no se come el principio de las palabras) y cierra despacio;
 *  4. limitador: no satura nunca.
 * Lo que suena del otro se registra con far(nivel, desde, hasta) en el reloj del audio (AudioContext.currentTime) y
 * cada bloque del micrófono con process(muestras, desde, hasta) en el mismo reloj. Sin dependencias del navegador: se
 * prueba en Node (tests/sim/voicefx.js).
 */
var DEF = {
  rate: 48000,
  hpHz: 60,
  duckDb: -18,          // mientras suena el otro (ronda 2774: de -12 a -18; el dueño seguía oyendo eco. El micrófono
                        // queda al ~12 %: NEXO no usa WebRTC, así que el cancelador del navegador no "ve" lo que NEXO
                        // reproduce y este supresor propio tiene que quitar casi todo el eco)
  dtDb: -3,             // los dos hablan a la vez (no se toca: si no, se corta la voz propia)
  dtHoldMs: 200,        // hablando los dos: se mantiene al menos esto
  farHoldMs: 300,       // el otro dejó de sonar: se sigue bajando esto (cola del eco; ronda 2774: 200→300)
  gateDb: -34,          // silencio (ronda 2778, pedido del dueño: "el micro que no oye voz se silencia, no del todo";
                        // 26-10 lo volvió a pedir: más silencio cuando no hay voz). De -10 a -22 y ahora a -34 dB: en
                        // silencio el micrófono queda al ~2 %, así que el ruido de fondo (ventilador, calle, electrónica)
                        // casi no se transmite. No a cero, para que no suene cortado ni bombee; abre al instante al hablar
                        // (ataque de 2 ms, independiente de la profundidad, así que no se come el principio de la palabra)
                        // y se mantiene un rato tras la última sílaba
  farOn: 0.004,         // nivel del otro (RMS) desde el que cuenta como que suena
  maxDelay: 0.6,        // el eco llega como mucho 600 ms después de sonar (latencias de salida y entrada; cascos Bluetooth)
  frame: 1024,          // trozo de análisis (~21 ms)
  history: 3,           // segundos para medir el eco
  dtRatio: 2,           // hablar "por encima del eco": 6 dB más que el eco esperado
  attackMs: 8,          // bajar
  releaseMs: 80,        // volver a subir cuando el otro deja de sonar (rampa de 50–100 ms)
  talkUpMs: 10,         // volver a subir porque uno empieza a hablar mientras suena el otro (no comerse sílabas)
  gateOpenMs: 2,        // abrir la puerta (ronda 2778: de 5 a 2 ms; con la puerta más profunda, abrir más rápido para no
                        // comerse el principio de la palabra)
  gateCloseMs: 200,
  gateHoldMs: 220,      // tras la última sílaba la puerta se mantiene abierta esto (ronda 2778: 200→220, cola de la voz)
  limit: 0.9
};

export function createVoiceFx(o) {
  var c = {};
  Object.keys(DEF).forEach(function(k) { c[k] = o && o[k] !== undefined ? o[k] : DEF[k]; });
  var dbg = function(db) { return Math.pow(10, db / 20); };
  var duckG = dbg(c.duckDb), dtG = dbg(c.dtDb), gateG = dbg(c.gateDb);
  // Paso alto (Butterworth de 2.º orden)
  var w0 = 2 * Math.PI * c.hpHz / c.rate, cw = Math.cos(w0), al = Math.sin(w0) / Math.SQRT2, a0 = 1 + al;
  var b0 = (1 + cw) / 2 / a0, b1 = -(1 + cw) / a0, b2 = (1 + cw) / 2 / a0, a1 = -2 * cw / a0, a2 = (1 - al) / a0;
  var x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  var kAtt = Math.exp(-1000 / (c.attackMs * c.rate)), kRel = Math.exp(-1000 / (c.releaseMs * c.rate)), kTalk = Math.exp(-1000 / (c.talkUpMs * c.rate));
  var kOpen = Math.exp(-1000 / (c.gateOpenMs * c.rate)), kClose = Math.exp(-1000 / (c.gateCloseMs * c.rate));
  var fs = c.frame / c.rate, nLag = Math.ceil(c.maxDelay / fs) + 1, nHist = Math.round(c.history / fs);
  var far = [];                 // [desde, hasta, nivel] de lo que suena del otro (en orden)
  var hist = [];                // por trozo: [nivel del micrófono, niveles del otro con cada retraso]
  var lag = -1, erl = 0.5;      // eco: retraso (en trozos; -1 = sin medir) y cuánto vuelve (nivel micrófono / otro)
  var sinceFit = 0, farSeen = 0, lastGood = 0, quietFar = 0;
  var floor = 0.003, gHold = 0, gDuck = 1, gGate = 1, lastT = 0, farHold = 0, dtHold = 0, headset = false;
  var st = { frames: 0, duck: 0, dt: 0, gate: 0, limited: 0 };

  // Nivel de lo que sonaba del otro en el instante t
  function farAt(t) {
    for (var i = far.length - 1; i >= 0; i--) { var s = far[i]; if (s[0] <= t) return s[1] > t ? s[2] : 0; }
    return 0;
  }
  // Retraso y fuerza del eco: el retraso con el que el nivel del micrófono más se parece al del otro (correlación sin
  // la media: una voz propia que no tiene que ver no cuenta); la fuerza, la pendiente con ese retraso
  function fit() {
    if (hist.length < 40) return;
    var best = -1, bestR = 0, bestK = 0, n = hist.length;
    var mm = 0; for (var i = 0; i < n; i++) mm += hist[i][0]; mm /= n;
    for (var L = 0; L < nLag; L++) {
      var fm = 0; for (var j = 0; j < n; j++) fm += hist[j][1][L]; fm /= n;
      var sxy = 0, sxx = 0, syy = 0;
      for (var q = 0; q < n; q++) { var dx = hist[q][1][L] - fm, dy = hist[q][0] - mm; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; }
      if (sxx <= 1e-12 || syy <= 1e-12) continue;
      var rr = sxy / Math.sqrt(sxx * syy);
      if (rr > bestR) { bestR = rr; best = L; bestK = sxy / sxx; }
    }
    if (best >= 0 && bestR > 0.5) { lag = best; erl = Math.max(0.01, Math.min(4, bestK)); lastGood = farSeen; }
    // Mucho rato sonando el otro sin rastro de eco (buena cancelación del teléfono): el eco esperado baja
    else if (farSeen - lastGood > 3) { erl = Math.max(0.03, erl * 0.6); lastGood = farSeen; }
  }

  function frame(buf, off, n, tEnd) {
    var e = 0;
    for (var i = off; i < off + n; i++) {
      var x = buf[i], y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
      x2 = x1; x1 = x; y2 = y1; y1 = y; buf[i] = y; e += y * y;
    }
    var lvl = Math.sqrt(e / n), tMid = tEnd - n / c.rate / 2;
    var fl = new Array(nLag), fmax = 0;
    for (var L = 0; L < nLag; L++) { fl[L] = farAt(tMid - L * fs); if (fl[L] > fmax) fmax = fl[L]; }
    hist.push([lvl, fl]); if (hist.length > nHist) hist.shift();
    // ¿Suena el otro (con el retraso del eco) y cuánto eco se espera?
    var near = fmax;
    if (lag >= 0) { near = 0; for (var d = Math.max(0, lag - 2); d <= Math.min(nLag - 1, lag + 2); d++) if (fl[d] > near) near = fl[d]; }
    var farNow = near > c.farOn, expect = erl * near, fsec = n / c.rate;
    if (farNow) farHold = c.farHoldMs / 1000; else farHold = Math.max(0, farHold - fsec);
    var farOn = farNow || farHold > 0;
    if (farNow) farSeen += fsec;
    if (farNow && (sinceFit += fsec) >= 0.5) { sinceFit = 0; fit(); }
    // Ruido de fondo (sin el otro sonando): baja rápido, sube despacio (3 dB/s)
    if (!farOn && fmax <= c.farOn) {
      floor = lvl < floor ? floor * 0.5 + lvl * 0.5 : floor * Math.pow(10, 3 * (n / c.rate) / 20);
      floor = Math.max(1e-5, Math.min(0.05, floor));
    }
    var talk = lvl > floor * 2.5 && lvl > 0.0015;
    // Suena el otro y el micrófono sigue en el ruido de fondo ~1 s: casi no vuelve eco (lo cancela el teléfono)
    if (farNow) { quietFar = talk ? Math.max(0, quietFar - 1) : quietFar + 1; if (quietFar >= 40) { quietFar = 0; erl = Math.max(0.03, Math.min(erl, 2.5 * floor / near)); expect = erl * near; } }
    // Los dos hablan: el micrófono pasa claramente por encima del eco esperado (se mantiene 200 ms)
    if (farOn && talk && lvl > c.dtRatio * expect) dtHold = c.dtHoldMs / 1000; else dtHold = Math.max(0, dtHold - fsec);
    var both = farOn && dtHold > 0;
    var duckT = farOn && !headset ? (both ? dtG : duckG) : 1;
    if (talk) gHold = c.gateHoldMs / 1000; else gHold = Math.max(0, gHold - n / c.rate);
    var gateT = talk || gHold > 0 ? 1 : gateG;
    st.frames++; if (farOn && !both && !headset) st.duck++; if (both) st.dt++; if (gateT < 1) st.gate++;
    var lim = c.limit, kUp = both ? kTalk : kRel;
    for (var k = off; k < off + n; k++) {
      gDuck = duckT + (gDuck - duckT) * (duckT < gDuck ? kAtt : kUp);
      gGate = gateT + (gGate - gateT) * (gateT > gGate ? kOpen : kClose);
      var v = buf[k] * gDuck * gGate, a = v < 0 ? -v : v;
      if (a > lim) { st.limited++; v = (v < 0 ? -1 : 1) * (lim + (1 - lim) * Math.tanh((a - lim) / (1 - lim))); }
      buf[k] = v;
    }
  }

  return {
    // Lo que suena del otro: nivel RMS (0–1) entre desde y hasta (segundos, reloj del audio)
    far: function(level, t0, t1) {
      if (!(t1 > t0) || !(level >= 0)) return;
      var last = far[far.length - 1];
      if (last && t0 < last[0]) return; // (fuera de orden: no pasa al reproducir en orden)
      far.push([t0, t1, level]);
      if (far.length > 600) far.splice(0, far.length - 600);
    },
    // Un bloque del micrófono (se cambia en el sitio): sus muestras van de desde a hasta (reloj del audio)
    process: function(buf, t0, t1) {
      var n = buf.length;
      if (!n) return buf;
      if (!(t1 > t0)) { t0 = lastT; t1 = lastT + n / c.rate; }
      lastT = t1;
      while (far.length && far[0][1] < t0 - c.maxDelay - 1) far.shift();
      for (var off = 0; off < n; off += c.frame) {
        var m = Math.min(c.frame, n - off);
        frame(buf, off, m, t0 + (off + m) / c.rate);
      }
      return buf;
    },
    // Con cascos o Bluetooth (sin eco del altavoz): no se baja el micrófono por la voz del otro
    setHeadset: function(on) { headset = !!on; },
    // Para el diagnóstico: % del tiempo bajado por el otro, hablando los dos y en silencio; eco medido (fuerza y retraso
    // en ms, -1 sin medir); ruido de fondo
    stats: function() {
      var b = st.frames || 1;
      return { duck: st.duck / b, dt: st.dt / b, gate: st.gate / b, echo: erl, delayMs: lag >= 0 ? Math.round(lag * fs * 1000) : -1, floor: floor, limited: st.limited, headset: headset };
    }
  };
}
