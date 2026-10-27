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

// Construye el trazo de una «N» (arriba-izq ↓ abajo-izq ↗ arriba-der ↓ abajo-der)
function pathN() {
  const p = [];
  for (let y = 100; y <= 300; y += 25) p.push({ x: 100, y });          // baja izquierda
  for (let t = 0; t <= 1.0001; t += 0.2) p.push({ x: 100 + 100 * t, y: 300 - 200 * t }); // sube a la derecha
  for (let y = 100; y <= 300; y += 25) p.push({ x: 200, y });          // baja derecha
  return p;
}
function pathLine() { const p = []; for (let y = 100; y <= 300; y += 15) p.push({ x: 100, y }); return p; } // recta vertical
function pathDiag() { const p = []; for (let t = 0; t <= 1.0001; t += 0.08) p.push({ x: 100 + 120 * t, y: 100 + 200 * t }); return p; } // diagonal

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

  // 4. Perfil abre; desde Perfil se abre Ajustes (⚙️) y el gesto de la «N» está cableado EN AJUSTES (ronda 2807)
  win.dispatchEvent(new win.Event('nexo:ui:profile'));
  await sleep(200);
  const perfil = win.document.getElementById('nexo-profile-sheet');
  r.perfil_abre = !!perfil;
  const btnAjustes = perfil && perfil.querySelector('#nexo-open-settings');
  if (btnAjustes) btnAjustes.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  await sleep(200);
  const sheet = win.document.getElementById('nexo-settings-sheet');
  r.ajustes_abre = !!sheet;
  r.gesto_cableado = !!(sheet && sheet.__nexoNWired);
  r.gesto_no_en_perfil = !(perfil && perfil.__nexoNWired); // el gesto NO debe estar en Perfil

  r.errores = logs.filter((l) => /TypeError|undefined is not|is not a function|RangeError/.test(l)).slice(0, 4);
  const ok = r.hay_api && r.N_aceptada && r.recta_rechazada && r.diagonal_rechazada && r.corto_rechazado &&
    r.clasifica_ordenada && r.clasifica_persiste && r.abre_overlay && r.cierra_overlay &&
    r.perfil_abre && r.ajustes_abre && r.gesto_cableado && r.gesto_no_en_perfil && r.errores.length === 0;
  r.resultado = ok ? 'OK' : 'FAIL';
  console.log('JUEGO ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_juego.txt'), logs.join('\n'));
  process.exit(0);
})().catch((e) => { console.error('FALLO:', e.stack); fs.writeFileSync(path.join(__dirname, 'last_logs_juego.txt'), logs.join('\n')); process.exit(1); });
