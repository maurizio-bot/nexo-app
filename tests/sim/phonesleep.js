// COLA 22 (dueño 22-11): «App dormida o muerta por el sistema»: explicárselo al usuario. Con los motivos de cierre que ya entrega el
// nativo (getExitReasons, el simulador no lo trae: aquí se le pone a la medida) la app muestra UNA tarjeta fija en Contactos
// (src/ui/phone_sleep.js), no un aviso que desaparece:
//  S1  Motorola con la batería ya exenta y 3 «Foreground kill» hoy (+ un cierre del proceso que dibuja la pantalla, un FALLO y uno de hace
//      3 días, que NO cuentan): «cerró NEXO 3 veces hoy (… Foreground kill)», qué ajustar (Apps → NEXO → Batería) y «Abrir ajustes»
//      abre la ficha de la app; «Ahora no» la cierra y no vuelve el mismo día;
//  S2  ahorro de batería activo (Samsung) y 1 cierre «congelada por el sistema»: «cerró NEXO hoy», el botón «Quitar ahorro» abre la
//      pantalla de la batería; «No volver a mostrar» la apaga para siempre aunque pase el día;
//  S3  quitada de recientes («cerrada por el usuario»): tarjeta de aviso sin botón de ajustes, como mucho una al día;
//  S4  sin nada que explicar (fallo propio, falta de memoria, actualización, proceso de pantalla): ninguna tarjeta;
//  S5  una vez al día por causa (a mano con la marca del día), una sola tarjeta a la vez, y los textos en los 5 idiomas sin voseo.
// Contraprueba (build sin phone_sleep.js): FALLO en S1–S3. Imprime PHONESLEEP {json}. Uso: node phonesleep.js <dir_build>
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { NativePhone, Radio, installWebCrypto } = require('./native_mock');

const buildDir = path.resolve(process.argv[2] || path.join(__dirname, 'builds/wip'));
const base = { readsContentFallback: true, retain: ['onPayloadReceived'], closeOnNoService: true, pace: [15, 15], ioDelay: 25, asymmetric: true, noL2: true, noTor: true };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
class DL extends ResourceLoader { constructor(d) { super(); this.d = d; } fetch(u) { const f = path.join(this.d, decodeURIComponent(new URL(u).pathname)); return fs.existsSync(f) ? Promise.resolve(fs.readFileSync(f)) : Promise.reject(new Error('no existe ' + f)); } }
const logs = [];
const H = 3600 * 1000, NOW = Date.UTC(2026, 10, 22, 18, 0, 0);
const VOSEO = /(^|[^a-záéíóúüñ])(mirá|tocá|podés|tenés|querés|activá|quitá|abrí|vos)(?![a-záéíóúüñ])/i;
const ex = (ago, reason, label, o) => Object.assign({ t: NOW - ago, reason, label, problem: [3, 4, 5, 6, 7, 9].indexOf(reason) >= 0, fg: false }, o || {});

async function boot(name, alerts, exits) {
  const native = new NativePhone(name, 'AA:AA:AA:AA:AA:0' + name.length, Object.assign({}, base, { wifi: 'casa', alerts }));
  new Radio().add(native); native.load(); native.listeners = new Map();
  const vc = new VirtualConsole();
  ['log', 'warn', 'error'].forEach((l) => vc.on(l, (...a) => logs.push(`[${name}] ${l}: ` + a.map(String).join(' ').substring(0, 250))));
  const dom = new JSDOM(fs.readFileSync(path.join(buildDir, 'dist', 'index.html'), 'utf8'), {
    url: 'https://' + name.toLowerCase() + '.nexo.test/index.html', runScripts: 'dangerously', resources: new DL(path.join(buildDir, 'dist')), pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) {
      win.CapacitorCustomPlatform = { name: 'android' }; installWebCrypto(win);
      const pl = native.plugin();
      pl.getExitReasons = () => Promise.resolve({ sdk: 34, exits, maxMemMb: 512 });   // el simulador no trae los cierres: se le ponen
      win.Capacitor = { Plugins: { NexoBLE: pl } }; win.HTMLElement.prototype.scrollTo = function () {}; win.HTMLElement.prototype.scrollIntoView = function () {};
      win.NEXO_EXITS_NOW = () => NOW; win.NEXO_SLEEP_DELAY_MS = 1e9; win.NEXO_EXITS_DELAY_MS = 1e9; win.NEXO_FORCE_LANG = 'es';
    },
  });
  const win = dom.window;
  for (let i = 0; i < 100 && !(win.NEXO && win.NEXO.initialized); i++) await sleep(100);
  await sleep(500);
  return { name, native, win };
}
const $ = (p, s) => p.win.document.querySelector(s);
const click = (p, el) => el && el.dispatchEvent(new p.win.MouseEvent('click', { bubbles: true }));
const check = async (p) => { const f = p.win.__nexoPhoneSleep; return f ? f.check() : 'sin-modulo'; };
const card = (p) => { const c = $(p, '#nexo-sleep-card'); return c ? { cause: c.getAttribute('data-cause'), body: ($(p, '#nexo-sleep-card .nx-sleep-body') || {}).textContent, tip: ($(p, '#nexo-sleep-card .nx-sleep-tip') || {}).textContent, go: ($(p, '#nexo-sleep-go') || {}).textContent || null } : null; };

(async () => {
  const r = { build: path.basename(buildDir) };
  const fg = (ago) => ex(ago, 13, 'otro motivo del sistema', { desc: 'Foreground kill' });

  // S1: Motorola, batería exenta, 3 «Foreground kill» hoy
  const A = await boot('A', { battery: true }, [fg(1 * H), fg(5 * H), fg(9 * H), ex(2 * H, 13, 'x', { desc: '[ISOLATED NOT NEEDED]' }), ex(3 * H, 4, 'FALLO'), fg(72 * H)]);
  A.native.opts.vendor = 'motorola';
  r.S1_mostro = await check(A);
  const c1 = card(A); r.S1_tarjeta = c1;
  click(A, $(A, '#nexo-sleep-go')); await sleep(200);
  r.S1_abrio = (A.native.alertOpened || []).join(',');
  click(A, $(A, '#nexo-sleep-later')); await sleep(100);
  r.S1_cerro = !card(A); r.S1_no_repite = (await check(A)) === null && !card(A);
  r.S1_ok = r.S1_mostro === 'kill' && !!c1 && /3 veces hoy/.test(c1.body) && /Foreground kill/.test(c1.body) && /Apps → NEXO → Batería/.test(c1.tip) && c1.go === 'Abrir ajustes' && r.S1_abrio === 'app' && r.S1_cerro && r.S1_no_repite;

  // S2: ahorro de batería activo (Samsung), 1 cierre congelada; «No volver a mostrar»
  const B = await boot('B', { battery: false }, [ex(2 * H, 14, 'congelada por el sistema')]);
  B.native.opts.vendor = 'samsung';
  r.S2_mostro = await check(B);
  const c2 = card(B); r.S2_tarjeta = c2;
  click(B, $(B, '#nexo-sleep-go')); await sleep(200);
  r.S2_abrio = (B.native.alertOpened || []).join(',');
  click(B, $(B, '#nexo-sleep-never')); await sleep(100);
  B.win.localStorage.setItem('nexo_sleep_at_kill', String(NOW - 30 * H)); // «ya pasó el día»
  r.S2_nunca_mas = (await check(B)) === null && !card(B);
  r.S2_ok = r.S2_mostro === 'kill' && !!c2 && /cerró NEXO hoy/.test(c2.body) && /congel/.test(c2.body) && /ahorro de batería/.test(c2.tip) && c2.go === 'Quitar ahorro' && r.S2_abrio === 'battery' && r.S2_nunca_mas;

  // S3: quitada de recientes
  const C = await boot('C', { battery: true }, [ex(3 * H, 10, 'cerrada por el usuario (forzar cierre o recientes)')]);
  r.S3_mostro = await check(C);
  const c3 = card(C); r.S3_tarjeta = c3;
  click(C, $(C, '#nexo-sleep-later')); await sleep(100); // «Entendido»
  r.S3_no_repite = (await check(C)) === null && !card(C);
  C.win.localStorage.setItem('nexo_sleep_at_recents', String(NOW - 25 * H));
  r.S3_al_dia_siguiente = (await check(C)) === 'recents';
  r.S3_ok = r.S3_mostro === 'recents' && !!c3 && /recientes/.test(c3.body) && /deja de recibir/.test(c3.tip) && c3.go === null && r.S3_no_repite && r.S3_al_dia_siguiente;

  // S4: nada que explicar
  const D = await boot('D', { battery: true }, [ex(1 * H, 4, 'FALLO'), ex(2 * H, 3, 'sin memoria'), ex(3 * H, 16, 'actualización'), ex(4 * H, 13, 'x', { desc: '[ISOLATED NOT NEEDED]' })]);
  r.S4_nada = (await check(D)) === null && !card(D);
  r.S4_ok = r.S4_nada;

  // S5: una sola tarjeta a la vez (kill y recientes juntas: sale kill; la de recientes toca otro día) y textos en 5 idiomas
  const E = await boot('E', { battery: true }, [fg(1 * H), ex(2 * H, 10, 'usuario')]);
  r.S5_primera = await check(E);
  r.S5_una = E.win.document.querySelectorAll('#nexo-sleep-card').length === 1 && (await check(E)) === null;
  click(E, $(E, '#nexo-sleep-later')); await sleep(100);
  r.S5_luego_recientes = await check(E);
  const keys = ['sleep_why_fgkill', 'sleep_why_frozen', 'sleep_why_resources', 'sleep_why_system', 'sleep_fix_battery', 'sleep_btn_battery', 'sleep_fix_vendor', 'sleep_btn_open', 'sleep_fix_other', 'sleep_btn_later', 'sleep_btn_ok', 'sleep_btn_never', 'sleep_kill_one', 'sleep_kill_many', 'sleep_kill_tip', 'sleep_rec_text', 'sleep_rec_tip'];
  const tr = {};
  for (const l of ['es', 'it', 'en', 'pt', 'fr']) tr[l] = fs.readFileSync(path.join(buildDir, 'src/ui/i18n/' + l + '_b.js'), 'utf8');
  r.S5_idiomas = keys.every((k) => Object.keys(tr).every((l) => new RegExp('\\b' + k + ': "').test(tr[l]))) && !VOSEO.test(tr.es) && VOSEO.test('tocá') && !VOSEO.test('toca');
  r.S5_ok = r.S5_primera === 'kill' && r.S5_una && r.S5_luego_recientes === 'recents' && r.S5_idiomas;

  r.errores = logs.filter((l) => / error: /.test(l) && !/JSDOMERROR|styles\.css|Not implemented|GLOBAL TIMEOUT|net::ERR|fetch|micrófono|getUserMedia/.test(l)).slice(0, 5);
  const ok = r.S1_ok && r.S2_ok && r.S3_ok && r.S4_ok && r.S5_ok && !r.errores.length;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('PHONESLEEP ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_phonesleep.txt'), logs.join('\n'));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('PHONESLEEP ' + JSON.stringify({ prueba: 'phonesleep', resultado: 'FALLO', error: String(e && e.message).replace(/"/g, "'") })); console.error(e && e.stack); process.exit(1); });
