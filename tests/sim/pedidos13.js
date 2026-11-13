// 3035 — pedidos del dueño 13-11:
//  S  stickers del pack: sin la «N» (nexo) en la rejilla y con las caritas nuevas 🥰🫡🤔😒😫🤬😋😘🤤 (😍 🤩 ya estaban); un
//     sticker «nexo» que llegue de otro teléfono se sigue viendo.
//  A  Ajustes: «Actualizaciones» es la PRIMERA sección («entrando uno actualiza»).
//  G  gesto atrás en todas las pantallas: menús (mensaje, grupo, adjuntar), hojas (reenviar, compartir, elegir contacto, cobrar,
//     ficha del grupo, fondo), juego NEXO, búsqueda del chat, guía de bienvenida y aviso de batería se cierran con «atrás».
//  V  estados con videos de otras apps (TikTok): un video de 8 MB se recodifica en 720p para caber (≤ 5 MB) en vez de la
//     previa de 240p; el recodificador recibe el tamaño objetivo.
// Uso: node pedidos13.js <dir_build>
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
const mkCalls = [];
async function boot(name, native) {
  const vc = new VirtualConsole();
  ['log', 'warn', 'error'].forEach((l) => vc.on(l, (...a) => logs.push(`[${name}] ${l}: ` + a.map(String).join(' ').substring(0, 250))));
  const dom = new JSDOM(fs.readFileSync(path.join(buildDir, 'dist', 'index.html'), 'utf8'), {
    url: 'https://' + name.toLowerCase() + '.nexo.test/index.html', runScripts: 'dangerously', resources: new DL(path.join(buildDir, 'dist')), pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) {
      win.CapacitorCustomPlatform = { name: 'android' }; installWebCrypto(win); win.Capacitor = { Plugins: { NexoBLE: native.plugin() } }; win.HTMLElement.prototype.scrollTo = function () {};
      // el simulador no tiene MediaRecorder: el recodificador devuelve una previa de 120 KB y un HD de 3 MB
      win.NEXO_makeVideoPreview = (f, dur, o) => {
        mkCalls.push(o || null);
        const pv = new win.Blob([new Uint8Array(120 * 1024).fill(3)], { type: 'video/webm' });
        pv.hd = new win.Blob([new Uint8Array(3 * 1024 * 1024).fill(4)], { type: 'video/webm' });
        return Promise.resolve(pv);
      };
    },
  });
  const win = dom.window;
  for (let i = 0; i < 100 && !(win.NEXO && win.NEXO.initialized); i++) await sleep(100);
  await sleep(600);
  return { name, native, win };
}
const click = (w, el) => el && el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));

(async () => {
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', opts);
  radio.add(nA); nA.load();
  const A = await boot('A', nA);
  const w = A.win, d = w.document;
  const r = { prueba: 'pedidos13', build: path.basename(buildDir) };

  // ---- S: stickers ----
  if (typeof w.__nexoOpenStickerPicker === 'function') {
    w.__nexoOpenStickerPicker('nx00000001', () => {}, () => {});
    await sleep(500);
    const ids = Array.from(d.querySelectorAll('#sticker-sheet .sticker-cell')).map((b) => b.getAttribute('aria-label')).filter(Boolean);
    r.S_sin_N = ids.indexOf('nexo') < 0;
    const nuevas = ['carinosa', 'saludo', 'pensando', 'fastidio', 'cansado', 'furia', 'rico', 'beso', 'babeo'];
    r.S_caritas_nuevas = nuevas.every((x) => ids.indexOf(x) >= 0);
    r.S_imagenes_existen = nuevas.every((x) => fs.existsSync(path.join(buildDir, 'dist', 'assets', 'stickers', x + '.png')));
    r.S_total = ids.length;
    const sh = d.getElementById('sticker-sheet'); if (sh) sh.remove();
  }
  r.S_nexo_recibido_se_ve = fs.existsSync(path.join(buildDir, 'dist', 'assets', 'stickers', 'nexo.png')) && /nexo:\s*'assets\/stickers\/nexo\.png'/.test(fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'ui', 'stickers.js'), 'utf8'));

  // ---- A: Actualizaciones primero en Ajustes ----
  w.dispatchEvent(new w.CustomEvent('nexo:ui:profile')); await sleep(400);
  const setBtn = Array.from(d.querySelectorAll('#nexo-profile-sheet button')).find((b) => /Ajustes|Settings|Impostazioni/.test(b.textContent || ''));
  click(w, setBtn); await sleep(500);
  const firstCard = d.querySelector('#nexo-settings-sheet .nx-card .nx-h');
  r.A_actualizaciones_primero = !!firstCard && /Actualizaciones/.test(firstCard.textContent || '');
  const ss = d.getElementById('nexo-settings-sheet'); if (ss) ss.remove();

  // ---- G: gesto atrás ----
  const back = () => (typeof w.__nexoHandleBack === 'function' ? w.__nexoHandleBack() : false);
  const ids = ['nexo-msg-menu', 'nexo-group-menu', 'nexo-contact-picker', 'cobro-sheet', 'nexo-forward-sheet', 'nexo-share-sheet', 'nexo-group-sheet', 'nexo-wp-sheet', 'nexo-game-overlay', 'nexo-welcome-overlay', 'nexo-bat-overlay'];
  r.G_cierra = {};
  for (const id of ids) {
    const el = d.createElement('div'); el.id = id; d.body.appendChild(el);
    const h = back();
    r.G_cierra[id] = h === true && !d.getElementById(id);
    const left = d.getElementById(id); if (left) left.remove();
  }
  { // menú de adjuntar visible
    let m = d.getElementById('attach-menu'); const made = !m;
    if (!m) { m = d.createElement('div'); m.id = 'attach-menu'; d.body.appendChild(m); }
    m.classList.remove('hidden'); m.classList.add('visible');
    r.G_cierra['attach-menu'] = back() === true && m.classList.contains('hidden') && !m.classList.contains('visible');
    if (made) m.remove();
  }
  r.G_busqueda = typeof w.__nexoCloseSearch === 'function';
  r.G_nada_abierto_sale = back() === false;
  r.G_todo = Object.values(r.G_cierra).every(Boolean);

  // ---- V: video de otra app (8 MB) en un estado ----
  if (typeof w.NEXO_composeStatus === 'function') {
    w.NEXO_composeStatus(); await sleep(400);
    const vin = Array.from(d.querySelectorAll('#estado-overlay input[type=file]')).find((i) => i.accept === 'video/*');
    const big = new w.File([new Uint8Array(8 * 1024 * 1024).fill(9)], 'tiktok.mp4', { type: 'video/mp4' });
    Object.defineProperty(vin, 'files', { configurable: true, value: [big] });
    vin.dispatchEvent(new w.Event('change'));
    await sleep(2500);
    click(w, d.getElementById('estado-publicar')); await sleep(1500);
    const mine = (w.NEXO_myStatuses() || []);
    const it = mine[mine.length - 1];
    r.V_objetivo_pasado = mkCalls.some((o) => o && o.hdTargetBytes > 4 * 1024 * 1024 && o.hdTargetBytes <= 5 * 1024 * 1024);
    r.V_usa_720p = !!(it && it.big && it.big.k === 'vid' && it.big.size > 2 * 1024 * 1024);
    r.V_tam_kb = it && it.big ? Math.round(it.big.size / 1024) : null;
  }
  r.errores = logs.filter((l) => / error: /.test(l) && !/JSDOMERROR|styles\.css|Not implemented/.test(l)).slice(0, 5);
  const ok = r.S_sin_N && r.S_caritas_nuevas && r.S_imagenes_existen && r.S_nexo_recibido_se_ve && r.A_actualizaciones_primero && r.G_todo && r.G_busqueda && r.G_nada_abierto_sale && r.V_objetivo_pasado && r.V_usa_720p && !r.errores.length;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('PEDIDOS13 ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_pedidos13.txt'), logs.join('\n'));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('PEDIDOS13 ' + JSON.stringify({ prueba: 'pedidos13', resultado: 'FALLO', error: String(e && e.message) })); console.error(e); fs.writeFileSync(path.join(__dirname, 'last_logs_pedidos13.txt'), logs.join('\n')); process.exit(1); });
