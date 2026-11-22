// COLA 22 (dueño 22-11): «Tu teléfono silencia a NEXO» (src/ui/silenced.js). El nativo (SilencedPolicy.kt) dice si un canal de avisos está
// apagado o sin sonido y si hay «No molestar»; la app muestra UNA tarjeta fija en Contactos con el botón que abre ESE ajuste:
//  S1  avisos de mensajes apagados: «no te vas a enterar de los mensajes», botón abre el canal de mensajes; al arreglarlo (volver a la
//      app) la tarjeta desaparece sola; con todo bien no sale nada;
//  S2  canal de llamadas sin sonido: texto de llamadas y botón al canal de llamadas; «Ahora no» la cierra y no vuelve el mismo día,
//      pasado el día sí; «No volver a mostrar» la apaga para siempre;
//  S3  «No molestar»: no sale si lleva poco activo (reunión); sale tras un rato, UNA vez (no se repite hasta 14 días); botón abre sus ajustes;
//      si se apaga antes, se olvida;
//  S4  con el banner de avisos o la tarjeta «cerró NEXO» ya presentes no se pone otra; sin problema, ninguna;
//  S5  los textos están en los 5 idiomas y sin voseo.
// Contraprueba (build sin silenced.js): FALLO en S1–S3. Imprime SILENCIADO {json}. Uso: node silenciado.js <dir_build>
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
const H = 3600 * 1000, NOW0 = Date.UTC(2026, 10, 22, 18, 0, 0);
const VOSEO = /(^|[^a-záéíóúüñ])(mirá|tocá|podés|tenés|querés|activá|quitá|abrí|vos)(?![a-záéíóúüñ])/i;
let clock = NOW0;

async function boot(name, silenced) {
  const native = new NativePhone(name, 'AA:AA:AA:AA:AA:0' + name.length, Object.assign({}, base, { wifi: 'casa' }));
  native.silenced = silenced;
  new Radio().add(native); native.load(); native.listeners = new Map();
  const vc = new VirtualConsole();
  ['log', 'warn', 'error'].forEach((l) => vc.on(l, (...a) => logs.push(`[${name}] ${l}: ` + a.map(String).join(' ').substring(0, 250))));
  const dom = new JSDOM(fs.readFileSync(path.join(buildDir, 'dist', 'index.html'), 'utf8'), {
    url: 'https://' + name.toLowerCase() + '.nexo.test/index.html', runScripts: 'dangerously', resources: new DL(path.join(buildDir, 'dist')), pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) {
      win.CapacitorCustomPlatform = { name: 'android' }; installWebCrypto(win);
      win.Capacitor = { Plugins: { NexoBLE: native.plugin() } }; win.HTMLElement.prototype.scrollTo = function () {}; win.HTMLElement.prototype.scrollIntoView = function () {};
      win.NEXO_SILENCED_NOW = () => clock; win.NEXO_SILENCED_DELAY_MS = 1e9; win.NEXO_SLEEP_DELAY_MS = 1e9; win.NEXO_FORCE_LANG = 'es';
    },
  });
  const win = dom.window;
  for (let i = 0; i < 100 && !(win.NEXO && win.NEXO.initialized); i++) await sleep(100);
  await sleep(500);
  return { name, native, win };
}
const $ = (p, s) => p.win.document.querySelector(s);
const click = (p, el) => el && el.dispatchEvent(new p.win.MouseEvent('click', { bubbles: true }));
const check = async (p) => { const f = p.win.__nexoSilenced; return f ? f.check() : 'sin-modulo'; };
const card = (p) => { const c = $(p, '#nexo-silenced-card'); return c ? { cause: c.getAttribute('data-cause'), body: ($(p, '#nexo-silenced-card .nx-sil-body') || {}).textContent, tip: ($(p, '#nexo-silenced-card .nx-sil-tip') || {}).textContent, go: ($(p, '#nexo-silenced-go') || {}).textContent } : null; };

(async () => {
  const r = { build: path.basename(buildDir) };

  // S1: mensajes apagados → tarjeta, botón abre el canal de mensajes, se arregla y desaparece; todo bien → nada
  const A = await boot('A', { messages: 'off' });
  r.S1_mostro = await check(A); const c1 = card(A); r.S1_tarjeta = c1;
  r.S1_una = A.win.document.querySelectorAll('#nexo-silenced-card').length === 1 && (await check(A)) === null;
  click(A, $(A, '#nexo-silenced-go')); await sleep(2000);
  r.S1_abrio = (A.native.silencedOpened || []).join(',');
  r.S1_se_fue = !card(A); // el arreglo (mock) + la recomprobación al volver
  r.S1_sano = (await check(A)) === null && !card(A);
  r.S1_ok = r.S1_mostro === 'ch' && !!c1 && /apagados los avisos de mensajes/.test(c1.body) && /no te vas a enterar/.test(c1.body) && c1.go === 'Abrir el ajuste' && r.S1_una && r.S1_abrio === 'messages' && r.S1_se_fue && r.S1_sano;

  // S2: llamadas sin sonido; «Ahora no» y el día; «No volver a mostrar»
  const B = await boot('B', { calls: 'quiet' });
  r.S2_mostro = await check(B); const c2 = card(B); r.S2_tarjeta = c2;
  click(B, $(B, '#nexo-silenced-go')); await sleep(100);
  r.S2_abrio = (B.native.silencedOpened || []).join(',');
  B.native.silenced = { calls: 'quiet' }; // el usuario no lo arregló
  click(B, $(B, '#nexo-silenced-later')); await sleep(50);
  r.S2_cerro = !card(B); r.S2_no_repite = (await check(B)) === null;
  clock = NOW0 + 25 * H;
  r.S2_al_dia = (await check(B)) === 'ch';
  click(B, $(B, '#nexo-silenced-never')); await sleep(50);
  clock = NOW0 + 60 * H;
  r.S2_nunca = (await check(B)) === null && !card(B);
  r.S2_ok = r.S2_mostro === 'ch' && !!c2 && /llamadas/.test(c2.body) && r.S2_abrio === 'calls' && r.S2_cerro && r.S2_no_repite && r.S2_al_dia && r.S2_nunca;

  // S3: «No molestar»
  clock = NOW0;
  const C = await boot('C', { filter: 2 });
  C.win.NEXO_SILENCED_DND_MS = 30 * 60 * 1000;
  r.S3_poco = (await check(C)) === null && !card(C); // acaba de verse activo
  clock = NOW0 + 40 * 60 * 1000;
  r.S3_mostro = await check(C); const c3 = card(C); r.S3_tarjeta = c3;
  click(C, $(C, '#nexo-silenced-go')); await sleep(100);
  r.S3_abrio = (C.native.silencedOpened || []).join(',');
  C.native.silenced = { filter: 2 };
  click(C, $(C, '#nexo-silenced-later')); await sleep(50);
  clock = NOW0 + 6 * 24 * H;
  r.S3_una_vez = (await check(C)) === null;
  clock = NOW0 + 15 * 24 * H;
  r.S3_a_los_14 = (await check(C)) === 'dnd';
  // total, y si se apaga antes se olvida
  const D = await boot('D', { filter: 3 }); clock = NOW0 + 20 * 24 * H; D.win.NEXO_SILENCED_DND_MS = 30 * 60 * 1000;
  await check(D); D.native.silenced = { filter: 1 }; await check(D);
  clock += 2 * H; D.native.silenced = { filter: 3 };
  r.S3_se_olvida = (await check(D)) === null;
  clock += 40 * 60 * 1000; const tot = await check(D); const c4 = card(D);
  r.S3_total = tot === 'dnd' && !!c4 && /silencio total/.test(c4.body);
  r.S3_ok = r.S3_poco && r.S3_mostro === 'dnd' && !!c3 && /No molestar/.test(c3.body) && r.S3_abrio === 'dnd' && r.S3_una_vez && r.S3_a_los_14 && r.S3_se_olvida && r.S3_total;

  // S4: otro aviso ya presente / sin problema
  clock = NOW0;
  const E = await boot('E', { messages: 'off' });
  const ban = E.win.document.createElement('div'); ban.id = 'nexo-notif-banner'; E.win.document.getElementById('contacts-view').appendChild(ban);
  r.S4_con_banner = (await check(E)) === null && !card(E);
  const F = await boot('F', {});
  r.S4_sano = (await check(F)) === null && !card(F);
  r.S4_ok = r.S4_con_banner && r.S4_sano;

  // S5: idiomas
  const keys = ['silenced_both_off', 'silenced_msg_off', 'silenced_call_off', 'silenced_both_quiet', 'silenced_msg_quiet', 'silenced_call_quiet', 'silenced_ch_tip', 'silenced_btn_open', 'silenced_dnd_total', 'silenced_dnd_priority', 'silenced_dnd_tip', 'silenced_btn_dnd'];
  const tr = {};
  for (const l of ['es', 'it', 'en', 'pt', 'fr']) tr[l] = fs.readFileSync(path.join(buildDir, 'src/ui/i18n/' + l + '_b.js'), 'utf8');
  r.S5_ok = keys.every((k) => Object.keys(tr).every((l) => new RegExp('\\b' + k + ': "').test(tr[l]))) && !VOSEO.test(tr.es);

  r.errores = logs.filter((l) => / error: /.test(l) && !/JSDOMERROR|styles\.css|Not implemented|GLOBAL TIMEOUT|net::ERR|fetch|micrófono|getUserMedia/.test(l)).slice(0, 5);
  const ok = r.S1_ok && r.S2_ok && r.S3_ok && r.S4_ok && r.S5_ok && !r.errores.length;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('SILENCIADO ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_silenciado.txt'), logs.join('\n'));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('SILENCIADO ' + JSON.stringify({ prueba: 'silenciado', resultado: 'FALLO', error: String(e && e.message).replace(/"/g, "'") })); console.error(e && e.stack); process.exit(1); });
