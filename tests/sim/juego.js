// Ronda 2806 (pedido del dueño): juego secreto «Defensor NEXO». Comprueba la LÓGICA (sin Canvas, que jsdom no tiene):
//  1. El reconocedor del trazo «N» acepta una «N» bien dibujada y rechaza una línea recta / un trazo pequeño / una diagonal.
//  2. La clasificación (mejores puntajes) se ordena de mayor a menor y se guarda.
//  3. Abrir el juego crea el overlay sin reventar (aunque no haya Canvas) y el botón de cerrar lo quita.
//  4. El gesto está cableado en la pantalla de Ajustes (attachNexoUnlockGesture marca la hoja).
// El juego REAL (nave, meteoros, dibujo) se ve en el teléfono; acá solo la lógica.
// Uso: node juego.js <dir_build>
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone, installWebCrypto } = require('./native_mock');

const buildDir = path.resolve(process.argv[2]);
const opts = { readsContentFallback: true, closeOnNoService: true, pace: [15, 15], ioDelay: 25 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
class DL extends ResourceLoader { constructor(d) { super(); this.d = d; } fetch(u) { const f = path.join(this.d, decodeURIComponent(new URL(u).pathname)); return fs.existsSync(f) ? Promise.resolve(fs.readFileSync(f)) : Promise.reject(new Error('x')); } }
const logs = [];
async function boot(name, native) {
  const vc = new VirtualConsole();
  ['log', 'warn', 'error'].forEach((l) => vc.on(l, (...a) => logs.push(`[${name}] ${l}: ` + a.map(String).join(' ').substring(0, 250))));
  const dom = new JSDOM(fs.readFileSync(path.join(buildDir, 'dist', 'index.html'), 'utf8'), {
    url: 'https://' + name.toLowerCase() + '.nexo.test/index.html', runScripts: 'dangerously', resources: new DL(path.join(buildDir, 'dist')), pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) { win.CapacitorCustomPlatform = { name: 'android' }; installWebCrypto(win); win.Capacitor = { Plugins: { NexoBLE: native.plugin() } }; win.HTMLElement.prototype.scrollTo = function () {}; },
  });
  const win = dom.window;
  for (let i = 0; i < 100 && !(win.NEXO && win.NEXO.initialized); i++) await sleep(100);
  await sleep(500);
  return { name, native, win };
}

// Trazo de una «N» como la dibuja el dueño (aclaración 29-10): ARRIBA ABAJO ARRIBA — desde abajo-izq SUBE, BAJA en
// diagonal a la derecha y vuelve a SUBIR (BL→TL→BR→TR). Diagonal real de la N (arriba-izq → abajo-der, «╲»).
function pathN() {
  const p = [];
  for (let y = 300; y >= 100; y -= 25) p.push({ x: 100, y });          // sube izquierda (BL→TL)
  for (let t = 0; t <= 1.0001; t += 0.2) p.push({ x: 100 + 100 * t, y: 100 + 200 * t }); // baja diagonal a la derecha (TL→BR)
  for (let y = 300; y >= 100; y -= 25) p.push({ x: 200, y });          // sube derecha (BR→TR)
  return p;
}
// La MISMA «N» dibujada al revés (empezando arriba-der, der→izq). El reconocedor es agnóstico al sentido: debe aceptarla.
function pathNrev() {
  const p = [];
  for (let y = 100; y <= 300; y += 25) p.push({ x: 200, y });          // baja derecha (TR→BR)
  for (let t = 0; t <= 1.0001; t += 0.2) p.push({ x: 200 - 100 * t, y: 300 - 200 * t }); // sube diagonal a la izquierda (BR→TL)
  for (let y = 100; y <= 300; y += 25) p.push({ x: 100, y });          // baja izquierda (TL→BL)
  return p;
}
function pathLine() { const p = []; for (let y = 100; y <= 300; y += 15) p.push({ x: 100, y }); return p; } // recta vertical
function pathDiag() { const p = []; for (let t = 0; t <= 1.0001; t += 0.08) p.push({ x: 100 + 120 * t, y: 100 + 200 * t }); return p; } // diagonal
// Variaciones REALES de una «N» (arriba-abajo-arriba) con el dedo: estrecha, ancha, de pocos puntos (dedo rápido) e
// inclinada. El reconocedor debe aceptarlas; una «V» (una sola vuelta) debe rechazarse.
function pathNnarrow() { const p = []; for (let y = 300; y >= 80; y -= 18) p.push({ x: 120, y }); for (let t = 0; t <= 1.0001; t += 0.12) p.push({ x: 120 + 55 * t, y: 80 + 220 * t }); for (let y = 300; y >= 80; y -= 18) p.push({ x: 175, y }); return p; }
function pathNwide() { const p = []; for (let y = 260; y >= 90; y -= 20) p.push({ x: 60, y }); for (let t = 0; t <= 1.0001; t += 0.1) p.push({ x: 60 + 200 * t, y: 90 + 170 * t }); for (let y = 260; y >= 90; y -= 20) p.push({ x: 260, y }); return p; }
function pathNfast() { return [{ x: 100, y: 300 }, { x: 100, y: 200 }, { x: 100, y: 100 }, { x: 150, y: 200 }, { x: 200, y: 300 }, { x: 200, y: 200 }, { x: 200, y: 100 }]; }
function pathNslant() { const p = []; for (let y = 300; y >= 100; y -= 20) p.push({ x: 100 + (300 - y) * 0.12, y }); for (let t = 0; t <= 1.0001; t += 0.12) p.push({ x: 124 + 110 * t, y: 100 + 200 * t }); for (let y = 300; y >= 100; y -= 20) p.push({ x: 234 + (300 - y) * 0.12, y }); return p; }
function pathV() { const p = []; for (let t = 0; t <= 1.0001; t += 0.08) p.push({ x: 100 + 60 * t, y: 100 + 200 * t }); for (let t = 0; t <= 1.0001; t += 0.08) p.push({ x: 160 + 60 * t, y: 300 - 200 * t }); return p; }

(async () => {
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', opts);
  radio.add(nA); nA.load();
  const [A] = await Promise.all([boot('A', nA)]);
  const r = { build: path.basename(buildDir) };
  const win = A.win;
  const g = win.__nexoGame;

  r.hay_api = !!(g && typeof g.recognizeN === 'function' && typeof g.addScore === 'function' && typeof g.open === 'function');

  // 1. Reconocedor de la «N»
  r.N_aceptada = !!(g && g.recognizeN(pathN()));
  r.recta_rechazada = !!(g && g.recognizeN(pathLine()) === false);
  r.diagonal_rechazada = !!(g && g.recognizeN(pathDiag()) === false);
  r.corto_rechazado = !!(g && g.recognizeN([{ x: 0, y: 0 }, { x: 1, y: 1 }]) === false);
  // Variaciones reales de la «N» (deben aceptarse) y una «V» (debe rechazarse)
  r.N_estrecha = !!(g && g.recognizeN(pathNnarrow()));
  r.N_ancha = !!(g && g.recognizeN(pathNwide()));
  r.N_rapida = !!(g && g.recognizeN(pathNfast()));
  r.N_inclinada = !!(g && g.recognizeN(pathNslant()));
  r.N_reves = !!(g && g.recognizeN(pathNrev())); // misma N al revés (agnóstico al sentido)
  r.V_rechazada = !!(g && g.recognizeN(pathV()) === false);

  // 2. Clasificación
  if (g) { g.addScore(100, 2); g.addScore(250, 5); g.addScore(50, 1); }
  const sc = (g && g.loadScores()) || [];
  r.clasifica_ordenada = sc.length >= 3 && sc[0].score === 250 && sc[sc.length - 1].score <= sc[0].score;
  r.clasifica_persiste = (g && g.loadScores().length === sc.length);

  // 3. Abrir / cerrar el juego (sin Canvas no debe reventar)
  let overlay = null;
  try { g && g.open(); overlay = win.document.getElementById('nexo-game-overlay'); } catch (e) { r.open_error = String(e && e.message); }
  r.abre_overlay = !!overlay;
  if (overlay) { const btn = overlay.querySelector('button'); if (btn) btn.dispatchEvent(new win.MouseEvent('click', { bubbles: true })); }
  await sleep(50);
  r.cierra_overlay = !win.document.getElementById('nexo-game-overlay');

  // 4. El gesto de la «N» vive en PERFIL, en la zona negra de abajo (ronda 2810: en Ajustes el scroll se lo comía).
  //    Ajustes se abre con ⚙️ pero NO lleva el gesto.
  win.dispatchEvent(new win.Event('nexo:ui:profile'));
  await sleep(200);
  const perfil = win.document.getElementById('nexo-profile-sheet');
  r.perfil_abre = !!perfil;
  const zona = perfil && perfil.querySelector('#nexo-gesture-zone');
  r.gesto_cableado = !!(zona && zona.__nexoNWired); // el gesto está en la zona de Perfil, con touch-action:none
  // 4b. El GESTO de verdad: dibujar la «N» con el dedo abre el juego (informe del dueño 28-10: no abría porque el
  //     dedo se salía de la zona y se perdían los pointermove/up; ahora se captura el puntero). Simula eventos de puntero.
  if (zona) {
    const pev = (type, pt) => zona.dispatchEvent(new win.MouseEvent(type, { clientX: pt.x, clientY: pt.y, bubbles: true }));
    const np = pathN();
    pev('pointerdown', np[0]);
    for (let i = 1; i < np.length; i++) pev('pointermove', np[i]);
    pev('pointerup', np[np.length - 1]);
    await sleep(120);
    const ov2 = win.document.getElementById('nexo-game-overlay');
    r.gesto_abre_juego = !!ov2;
    if (ov2) { const b = ov2.querySelector('button'); if (b) b.dispatchEvent(new win.MouseEvent('click', { bubbles: true })); await sleep(50); }
  } else { r.gesto_abre_juego = false; }
  // 4c. Caso del WebView real (informe del dueño 29-10): pointerdown SÍ llega pero los pointermove NO de forma fiable;
  //     los movimientos vienen por TOUCH. Antes el "lock" del pointer bloqueaba el touch → trazo de 1 punto → no abría.
  //     Ahora pointer y touch alimentan el mismo trazo y debe abrir.
  if (zona) {
    const tev = (type, pt) => { const e = new win.Event(type, { bubbles: true }); e.touches = [{ clientX: pt.x, clientY: pt.y }]; zona.dispatchEvent(e); };
    const mev = (type, pt) => zona.dispatchEvent(new win.MouseEvent(type, { clientX: pt.x, clientY: pt.y, bubbles: true }));
    const np = pathN();
    mev('pointerdown', np[0]);                                      // el pointer empieza el trazo
    for (let i = 1; i < np.length; i++) tev('touchmove', np[i]);    // pero los movimientos llegan por touch
    tev('touchend', np[np.length - 1]);
    await sleep(120);
    const ov3 = win.document.getElementById('nexo-game-overlay');
    r.gesto_mixto_abre = !!ov3;
    if (ov3) { const b = ov3.querySelector('button'); if (b) b.dispatchEvent(new win.MouseEvent('click', { bubbles: true })); await sleep(50); }
  } else { r.gesto_mixto_abre = false; }
  const btnAjustes = perfil && perfil.querySelector('#nexo-open-settings');
  if (btnAjustes) btnAjustes.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  await sleep(200);
  const sheet = win.document.getElementById('nexo-settings-sheet');
  r.ajustes_abre = !!sheet;
  r.gesto_no_en_ajustes = !(sheet && sheet.__nexoNWired); // el gesto NO debe estar en Ajustes (scroll)

  r.errores = logs.filter((l) => /TypeError|undefined is not|is not a function|RangeError/.test(l)).slice(0, 4);
  const ok = r.hay_api && r.N_aceptada && r.recta_rechazada && r.diagonal_rechazada && r.corto_rechazado &&
    r.N_estrecha && r.N_ancha && r.N_rapida && r.N_inclinada && r.N_reves && r.V_rechazada &&
    r.clasifica_ordenada && r.clasifica_persiste && r.abre_overlay && r.cierra_overlay &&
    r.perfil_abre && r.ajustes_abre && r.gesto_cableado && r.gesto_abre_juego && r.gesto_mixto_abre && r.gesto_no_en_ajustes && r.errores.length === 0;
  r.resultado = ok ? 'OK' : 'FAIL';
  console.log('JUEGO ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_juego.txt'), logs.join('\n'));
  process.exit(0);
})().catch((e) => { console.error('FALLO:', e.stack); fs.writeFileSync(path.join(__dirname, 'last_logs_juego.txt'), logs.join('\n')); process.exit(1); });
