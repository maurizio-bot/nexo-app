// Filtros del micrófono en las llamadas (ronda 2772, src/ui/call_voice_fx.js). Pedido del dueño (25-10): "aplicar
// filtros" y "si un usuario habla, el micrófono del otro se baja un porcentaje para evitar interferencias".
// Señales sintéticas a 48 kHz por bloques de 2048 muestras (como el micrófono de la llamada) y lo que sale:
//  eco_fuerte / eco_debil: suena la voz del otro y vuelve al micrófono (altavoz sin / con cancelación de eco del
//    teléfono): lo que sale debe bajar al menos 10 dB;
//  hablan_los_dos: con el eco de antes, uno habla a la vez (más fuerte que el eco): su voz debe pasar (como mucho −6 dB);
//  con_cascos: con cascos no hay eco del altavoz: lo del micrófono no se baja aunque suene el otro (como mucho −1 dB);
//  solo_yo: sin el otro, la voz pasa entera (como mucho −1,5 dB);
//  ruido_en_silencio: ruido de fondo bajo sin hablar: baja al menos 8 dB;
//  principio_de_palabra: tras un silencio, los primeros 20 ms de una palabra salen al menos al 70 %;
//  retumbo_30Hz: baja al menos 10 dB; voz_grave_120Hz y tono_1kHz: como mucho −1 y −0,5 dB; saturacion: el pico no
//    pasa de 1;
//  cpu: milisegundos de proceso por segundo de audio.
// Uso: node voicefx.js <dir_build>   (lee <dir_build>/src/ui/call_voice_fx.js; sin él, la build no tiene filtros)
'use strict';
const fs = require('fs');
const path = require('path');
const file = path.join(path.resolve(process.argv[2]), 'src', 'ui', 'call_voice_fx.js');
const RATE = 48000, BLOCK = 2048;
const r = { build: path.basename(path.resolve(process.argv[2])) };
if (!fs.existsSync(file)) { r.filtros = false; r.resultado = 'FALLO'; console.log('VOICEFX ' + JSON.stringify(r)); process.exit(1); }
const { createVoiceFx } = new Function(fs.readFileSync(file, 'utf8').replace(/^export /gm, '') + '\nreturn { createVoiceFx };')();

// Voz sintética: f0 y armónicos, con sílabas de duración y fuerza al azar (80–300 ms) y pausas (como el habla: sin
// ritmo fijo, para que la voz de uno no se parezca a la del otro)
function voice(f0, amp, seed) {
  let x = Math.floor(seed * 1e6) % 2147483646 + 1;
  const rnd = () => (x = (x * 48271) % 2147483647) / 2147483647;
  const segs = []; // [desde, hasta, fuerza]
  for (let t = 0; t < 30;) { const d = 0.08 + 0.22 * rnd(), on = rnd() > 0.25; segs.push([t, t + d, on ? 0.5 + 0.5 * rnd() : 0]); t += d; }
  const env = (t) => { const sg = segs.find((g) => t >= g[0] && t < g[1]); if (!sg || !sg[2]) return 0; return sg[2] * Math.sin(Math.PI * (t - sg[0]) / (sg[1] - sg[0])); };
  return (t) => {
    if (t < 0) return 0;
    const e = env(t); if (!e) return 0;
    let s = 0; for (let k = 1; k <= 12; k++) s += Math.sin(2 * Math.PI * f0 * k * t + k * seed) / k;
    return amp * 0.6 * s * e;
  };
}
let seedN = 1;
const noise = (amp) => () => amp * Math.sqrt(3) * (2 * ((seedN = (seedN * 16807) % 2147483647) / 2147483647) - 1);
const tone = (f, amp) => (t) => amp * Math.sin(2 * Math.PI * f * t);
const db = (a, b) => (a > 0 && b > 0 ? Math.round(20 * Math.log10(a / b) * 10) / 10 : null);

// Simula una llamada: farSig = lo que suena del otro (en el altavoz), mic(t) = lo que entra al micrófono
// Devuelve la energía de entrada y salida en [from, to] (segundos) y lo que sale en conjunto
function run({ seconds, farSig, mic, from, to, onlyNear, headset }) {
  const fx = createVoiceFx({ rate: RATE });
  if (headset) fx.setHeadset(true);
  const n = Math.round(seconds * RATE / BLOCK);
  let eIn = 0, eOut = 0, eNearIn = 0, cnt = 0, peak = 0;
  const out = [];
  for (let b = 0; b < n; b++) {
    const t0 = b * BLOCK / RATE, t1 = (b + 1) * BLOCK / RATE;
    // Lo que suena del otro, por trozos de 20 ms y con su hora (como call_media.js al reproducir)
    if (farSig) for (let s0 = t0; s0 < t1 - 1e-9; s0 += 0.02) { let e = 0; for (let i = 0; i < 960; i++) { const v = farSig(s0 + i / RATE); e += v * v; } fx.far(Math.sqrt(e / 960), s0, s0 + 0.02); }
    const buf = new Float32Array(BLOCK), near = new Float32Array(BLOCK);
    for (let i = 0; i < BLOCK; i++) { const t = t0 + i / RATE; buf[i] = mic(t); if (onlyNear) near[i] = onlyNear(t); }
    const inp = Float32Array.from(buf);
    fx.process(buf, t0, t1);
    for (let i = 0; i < BLOCK; i++) {
      const t = t0 + i / RATE; peak = Math.max(peak, Math.abs(buf[i])); out.push(buf[i]);
      if (t >= from && t < to) { eIn += inp[i] * inp[i]; eOut += buf[i] * buf[i]; if (onlyNear) eNearIn += near[i] * near[i]; cnt++; }
    }
  }
  return { in: Math.sqrt(eIn / (cnt || 1)), out: Math.sqrt(eOut / (cnt || 1)), nearIn: Math.sqrt(eNearIn / (cnt || 1)), peak, outArr: out, stats: fx.stats() };
}

const ECHO_MS = 0.12;
const farV = voice(140, 0.5, 0.3);
// 1. Eco fuerte (altavoz sin cancelación del teléfono: vuelve al 70 %) y débil (con cancelación: al 10 %)
for (const [k, g] of [['eco_fuerte', 0.7], ['eco_debil', 0.1]]) {
  const x = run({ seconds: 6, farSig: farV, mic: (t) => g * farV(t - ECHO_MS) + noise(0.001)(), from: 1, to: 6 });
  r[k] = { baja_dB: db(x.in, x.out) };
}
// 2. Los dos hablan: 3 s solo suena el otro (se mide el eco), luego uno habla a la vez (más fuerte que el eco)
{
  const nearV = voice(220, 0.35, 1.7);
  const x = run({ seconds: 7, farSig: farV, mic: (t) => 0.3 * farV(t - ECHO_MS) + (t >= 3 ? nearV(t) : 0), from: 3.5, to: 7, onlyNear: (t) => (t >= 3 ? nearV(t) : 0) });
  // ¿cuánto de la voz propia pasa? (lo que sale frente a la voz propia que entró)
  r.hablan_los_dos = { voz_propia_dB: db(x.out, x.nearIn), eco_medido: Math.round(x.stats.echo * 100) / 100 };
}
// 2b. Con cascos: suena el otro (no vuelve al micrófono) y uno habla: no se baja
{
  const nearV = voice(200, 0.3, 2.3);
  const x = run({ seconds: 5, farSig: farV, mic: nearV, from: 1, to: 5, headset: true });
  r.con_cascos = { baja_dB: db(x.in, x.out) };
}
// 3. Solo yo (sin el otro)
{
  const v = voice(180, 0.3, 0.9);
  const x = run({ seconds: 4, mic: v, from: 1, to: 4 });
  r.solo_yo = { baja_dB: db(x.in, x.out) };
}
// 4. Ruido de fondo en silencio (−54 dB)
{
  const x = run({ seconds: 5, mic: noise(0.002), from: 1.5, to: 5 });
  r.ruido_en_silencio = { baja_dB: db(x.in, x.out) };
}
// 5. Principio de palabra tras 2 s de silencio con ruido
{
  const v = tone(300, 0.3), onset = 2.0007; // a mitad de un bloque
  const x = run({ seconds: 2.5, mic: (t) => (t >= onset ? v(t) : 0) + noise(0.002)(), from: onset, to: onset + 0.02 });
  r.principio_de_palabra = { primeros_20ms: Math.round((x.out / x.in) * 100) / 100 };
}
// 6. Zumbido, tono de voz y saturación
{
  const h = run({ seconds: 2, mic: tone(30, 0.3), from: 0.5, to: 2 });
  const g = run({ seconds: 2, mic: tone(120, 0.3), from: 0.5, to: 2 });
  const k = run({ seconds: 2, mic: tone(1000, 0.3), from: 0.5, to: 2 });
  const s = run({ seconds: 1, mic: tone(440, 1.5), from: 0.2, to: 1 });
  r.retumbo_30Hz = { baja_dB: db(h.in, h.out) }; r.voz_grave_120Hz = { baja_dB: db(g.in, g.out) }; r.tono_1kHz = { baja_dB: db(k.in, k.out) }; r.saturacion = { pico: Math.round(s.peak * 1000) / 1000 };
}
// 7. Coste: 60 s de audio
{
  const fx = createVoiceFx({ rate: RATE }), buf = new Float32Array(BLOCK), v = voice(150, 0.3, 0.2);
  const src = new Float32Array(RATE); for (let i = 0; i < RATE; i++) src[i] = v(i / RATE); // (la voz se genera antes: solo cuenta el filtro)
  const t0 = process.hrtime.bigint();
  for (let b = 0; b < 60 * RATE / BLOCK; b++) {
    const ts = b * BLOCK / RATE;
    for (let s0 = ts; s0 < ts + BLOCK / RATE - 1e-9; s0 += 0.02) fx.far(0.1, s0, s0 + 0.02);
    for (let i = 0; i < BLOCK; i++) buf[i] = src[(b * BLOCK + i) % RATE];
    fx.process(buf, ts, ts + BLOCK / RATE);
  }
  r.cpu_ms_por_s = Math.round(Number(process.hrtime.bigint() - t0) / 1e6 / 60 * 100) / 100;
}
const ok = r.eco_fuerte.baja_dB >= 10 && r.eco_debil.baja_dB >= 10 && r.hablan_los_dos.voz_propia_dB >= -6 && r.con_cascos.baja_dB <= 1 && r.solo_yo.baja_dB <= 1.5 &&
  r.ruido_en_silencio.baja_dB >= 8 && r.principio_de_palabra.primeros_20ms >= 0.7 && r.retumbo_30Hz.baja_dB >= 10 && r.voz_grave_120Hz.baja_dB <= 1 && r.tono_1kHz.baja_dB <= 0.5 &&
  r.saturacion.pico <= 1;
r.resultado = ok ? 'OK' : 'FALLO';
console.log('VOICEFX ' + JSON.stringify(r));
process.exit(ok ? 0 : 1);
