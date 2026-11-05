// Tetris (Fase A, modo solo). Prueba la LÓGICA de forma determinista (semilla) con los ganchos __nexoTetris*, sin
// depender del canvas (jsdom no lo dibuja): arranque limpio, mover/rotar, una línea completa se borra y suma, y el
// game over se detecta cuando una pieza nueva no entra. Uso: node tetris.js <dir_build>
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone, installWebCrypto } = require('./native_mock');

const buildDir = path.resolve(process.argv[2]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
class DL extends ResourceLoader { constructor(d) { super(); this.d = d; } fetch(u) { const f = path.join(this.d, decodeURIComponent(new URL(u).pathname)); return fs.existsSync(f) ? Promise.resolve(fs.readFileSync(f)) : Promise.reject(new Error('x')); } }
const logs = [];
async function boot(name, native) {
  const vc = new VirtualConsole();
  ['log', 'warn', 'error'].forEach((l) => vc.on(l, (...a) => logs.push(`[${name}] ${l}: ` + a.map(String).join(' ').substring(0, 200))));
  const dom = new JSDOM(fs.readFileSync(path.join(buildDir, 'dist', 'index.html'), 'utf8'), {
    url: 'https://' + name.toLowerCase() + '.nexo.test/index.html', runScripts: 'dangerously', resources: new DL(path.join(buildDir, 'dist')), pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) { win.CapacitorCustomPlatform = { name: 'android' }; installWebCrypto(win); win.Capacitor = { Plugins: { NexoBLE: native.plugin() } }; win.HTMLElement.prototype.scrollTo = function () {}; },
  });
  const win = dom.window;
  for (let i = 0; i < 100 && !(win.NEXO && win.NEXO.initialized); i++) await sleep(100);
  await sleep(600);
  return { name, native, win };
}
const full = '.IIIIIIIII';   // 9 llenas, col 0 vacía → NO completa fila (no se borra), sirve para apilar hasta arriba
const fullRow = 'IIIIIIIIII'; // fila completa (se borra)

(async () => {
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', { wifi: 'casa', ioDelay: 5 }); radio.add(nA); nA.load();
  const A = await boot('A', nA);
  const w = A.win;
  const r = { build: path.basename(buildDir) };

  // (1) arranque limpio
  r.hooks = typeof w.__nexoTetrisStart === 'function' && typeof w.__nexoTetrisState === 'function';
  w.__nexoTetrisStart(7);
  let s = w.__nexoTetrisState();
  r.inicio_vacio = !!s && s.over === false && s.score === 0 && s.lines === 0 && !!s.piece && /^[.]{10}$/.test(s.grid[19]) && /^[.]{10}$/.test(s.grid[0]);

  // (2) mover y rotar (en tablero vacío la pieza se mueve y rota sin reventar)
  let px0 = w.__nexoTetrisState().piece.x;
  let moved = w.__nexoTetrisMove(-1);
  let px1 = w.__nexoTetrisState().piece.x;
  r.mueve = moved === true && px1 === px0 - 1;
  r.rota = (function() { try { w.__nexoTetrisRotate(); return true; } catch (e) { return false; } })();

  // (3) una línea completa se borra y suma puntos
  w.__nexoTetrisStart(7);
  let rows = []; for (let i = 0; i < 20; i++) rows.push(i === 19 ? fullRow : '..........');
  w.__nexoTetrisSetGrid(rows);
  w.__nexoTetrisHardDrop();       // la pieza aterriza sobre la fila llena → al fijar, la fila 19 se borra
  s = w.__nexoTetrisState();
  r.linea_borra = s.lines === 1;
  r.linea_suma = s.score > 0;

  // (4) game over: tablero apilado hasta arriba (sin filas completas → no se borra), una pieza nueva no entra
  w.__nexoTetrisStart(3);
  let rows2 = []; for (let i = 0; i < 20; i++) rows2.push(full);
  w.__nexoTetrisSetGrid(rows2);
  w.__nexoTetrisHardDrop();        // fija la pieza y al pedir la siguiente, no entra → over
  s = w.__nexoTetrisState();
  r.game_over = s.over === true;

  r.errores = logs.filter((l) => /TypeError|undefined is not|is not a function/.test(l) && /error/.test(l)).slice(0, 4);
  const ok = r.hooks && r.inicio_vacio && r.mueve && r.rota && r.linea_borra && r.linea_suma && r.game_over && r.errores.length === 0;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('TETRIS ' + JSON.stringify(r));
  try { fs.writeFileSync(path.join(__dirname, 'last_logs_tetris.txt'), logs.join('\n')); } catch (e) {}
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error('FALLO:', e.stack); process.exit(1); });
