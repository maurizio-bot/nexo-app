// 3032 — Estados v3 (dueño 12-11: «poder subir más estados», «que los estados se puedan comentar», «si me ponen me gusta
// pueda ver quién lo puso», «en Contactos con scroll abajo que actualice los estados»; decidió: hasta 10 y comentarios que ve
// SOLO el dueño). A publica 3 → B tiene los 3 y los recorre (1/3, 2/3…); me gusta y comentario por estado, A ve quién y qué
// (B no ve comentarios); quitar uno; tope de 10; deslizar hacia abajo recupera los estados; tras reiniciar sigue todo.
// Uso: node estados3.js <dir_build>
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone, installWebCrypto } = require('./native_mock');

const buildDir = path.resolve(process.argv[2]);
const opts = { readsContentFallback: true, retain: ['onPayloadReceived'], closeOnNoService: true, pace: [15, 15], ioDelay: 25, asymmetric: true };
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
  await sleep(800);
  return { name, native, win };
}
const click = (w, el) => el && el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
async function addFound(p) {
  let add = null;
  for (let i = 0; i < 400 && !add; i++) { await sleep(100); add = p.win.document.querySelector('#ble-new-device > div button'); if (!add && !p.win.bleInterface.isScanning) click(p.win, p.win.document.getElementById('ble-scan-btn')); }
  click(p.win, add); await sleep(2000); return !!add;
}
async function openChatWith(p, name) { let row; for (let i = 0; i < 300 && !row; i++) { row = Array.from(p.win.document.querySelectorAll('#main-contacts-list .ble-contact-row')).find((r) => (r.querySelector('.ble-contact-name') || {}).textContent === name); if (!row) await sleep(100); } click(p.win, row); await sleep(600); return !!row; }
async function closeChat(p) { p.win.dispatchEvent(new p.win.CustomEvent('nexo:ble:closeChat', { detail: {} })); await sleep(300); }
function sendText(p, t) { const i = p.win.document.getElementById('message-input'); i.value = t; i.dispatchEvent(new p.win.Event('input', { bubbles: true })); click(p.win, p.win.document.getElementById('send-btn')); }
const wait = async (c, s) => { for (let i = 0; i < s * 5; i++) { if (await c()) return true; await sleep(200); } return false; };
const chips = (p) => Array.from(p.win.document.querySelectorAll('#main-estados-strip .estado-chip'));

(async () => {
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', opts), nB = new NativePhone('B', 'BB:BB:BB:BB:BB:02', opts);
  [nA, nB].forEach((n) => { radio.add(n); n.load(); });
  let [A, B] = await Promise.all([boot('A', nA), boot('B', nB)]);
  const idA = A.win.bleInterface.localNexoId.toLowerCase(), idB = B.win.bleInterface.localNexoId.toLowerCase();
  const r = { build: path.basename(buildDir) };
  A.win.bleInterface.togglePanel(); if (!(await addFound(A))) { console.log('ESTADOS3 ' + JSON.stringify({ resultado: 'FAIL', error: 'no empareja' })); process.exit(0); } A.win.bleInterface.togglePanel();
  await openChatWith(A, 'B'); sendText(A, 'hola'); await sleep(2500); await closeChat(A);
  r.emparejados = await wait(async () => (await B.win.vaultLoadMessages(idA)).some((m) => m.content === 'hola'), 30);
  const ov = (p) => { const o = p.win.document.getElementById('estado-overlay'); if (o) o.remove(); };

  // 1. A publica TRES estados → B tiene los tres (antes: el último pisaba al anterior)
  const s1 = A.win.NEXO_addMyStatus('uno'), s2 = A.win.NEXO_addMyStatus('dos'), s3 = A.win.NEXO_addMyStatus('tres');
  r.tres_sids = !!(s1 && s2 && s3) && s1 !== s2 && s2 !== s3;
  r.B_tiene_tres = await wait(() => (B.win.NEXO_statusesOf(idA) || []).map((x) => x.t).join(',') === 'uno,dos,tres', 40);
  r.B_no_mensaje_visible = !(await B.win.vaultLoadMessages(idA)).some((m) => /nexo_act|"uno"/.test(m.content || ''));
  await sleep(400);
  const chipA = chips(B).find((c) => /\(3\)/.test(c.textContent));
  r.tira_cuenta_3 = !!chipA;

  // 2. B los ve uno a uno (1/3 → 2/3) y le da me gusta al 2.º → A sabe QUIÉN (B) y en cuál
  if (chipA) { click(B.win, chipA); await sleep(300); }
  const pos = () => (B.win.document.getElementById('estado-pos') || {}).textContent;
  r.visor_empieza_1 = pos() === '1/3' && /uno/.test((B.win.document.getElementById('estado-view') || {}).textContent || '');
  click(B.win, B.win.document.getElementById('estado-next')); await sleep(200);
  r.visor_siguiente_2 = pos() === '2/3' && /dos/.test(B.win.document.getElementById('estado-view').textContent);
  click(B.win, B.win.document.getElementById('estado-like')); await sleep(200);
  r.like_llega_con_quien = await wait(() => { const w = A.win.NEXO_whoLiked(s2); return w.length === 1 && w[0].nx === idB && w[0].name === 'B'; }, 30);
  r.like_solo_en_el_2 = A.win.NEXO_myLikes(s1) === 0 && A.win.NEXO_myLikes(s2) === 1 && A.win.NEXO_myLikes(s3) === 0;

  // 3. B comenta el 3.º → le llega SOLO a A (dueño), con el nombre de B
  click(B.win, B.win.document.getElementById('estado-next')); await sleep(200);
  const cin = B.win.document.getElementById('estado-comentar-input');
  if (cin) { cin.value = 'qué bonito'; click(B.win, B.win.document.getElementById('estado-comentar-btn')); }
  r.comentario_llega_a_A = await wait(() => { const c = A.win.NEXO_myComments(s3); return c.length === 1 && c[0].t === 'qué bonito' && c[0].name === 'B'; }, 30);
  r.comentario_no_en_otro = A.win.NEXO_myComments(s1).length === 0 && A.win.NEXO_myComments(s2).length === 0;
  r.B_no_ve_comentarios = !(B.win.NEXO_statusesOf(idA) || []).some((x) => x.comments && x.comments.length);
  ov(B);

  // 4. «Mis estados» en A: se ve quién dio me gusta y el comentario
  const miChip = chips(A).find((c) => /Tu estado/.test(c.textContent));
  if (miChip) { click(A.win, miChip); await sleep(300); }
  const mios = A.win.document.getElementById('estado-mios');
  r.mis_estados_abre = !!mios;
  const card2 = mios && mios.querySelector('.estado-mio[data-sid="' + s2 + '"]');
  const card3 = mios && mios.querySelector('.estado-mio[data-sid="' + s3 + '"]');
  r.mis_estados_quien_like = !!card2 && /B/.test((card2.querySelector('.estado-likes') || {}).textContent || '');
  r.mis_estados_comentario = !!card3 && /qué bonito/.test(card3.textContent);
  // 5. Quitar el 1.º desde «Mis estados» → B deja de tenerlo (los otros dos siguen)
  const card1 = mios && mios.querySelector('.estado-mio[data-sid="' + s1 + '"]');
  if (card1) click(A.win, card1.querySelector('.estado-quitar'));
  r.quitar_uno_en_B = await wait(() => (B.win.NEXO_statusesOf(idA) || []).map((x) => x.t).join(',') === 'dos,tres', 30);
  ov(A);

  // 6. Tope de 10: con 10 activos no se publica otro
  for (let i = 0; i < 8; i++) A.win.NEXO_addMyStatus('extra ' + i);
  r.diez_activos = A.win.NEXO_myStatuses().length === 10;
  r.once_rechazado = A.win.NEXO_addMyStatus('el once') === null && A.win.NEXO_myStatuses().length === 10;
  r.B_tiene_diez = await wait(() => (B.win.NEXO_statusesOf(idA) || []).length === 10, 60);

  // 7. Deslizar hacia abajo en Contactos (B): se piden los estados y vuelven (B los había perdido)
  B.win.NEXO_applyStatus(idA, { t: '', ts: Date.now() });   // como si B no tuviera ninguno
  r.B_sin_estados = (B.win.NEXO_statusesOf(idA) || []).length === 0;
  const cv = B.win.document.getElementById('contacts-view');
  const touch = (type, y) => { const ev = new B.win.Event(type, { bubbles: true }); Object.defineProperty(ev, 'touches', { value: y === null ? [] : [{ clientY: y }] }); cv.dispatchEvent(ev); };
  touch('touchstart', 100); touch('touchmove', 140); touch('touchmove', 220);
  r.indicador_soltar = /Suelta/.test((B.win.document.getElementById('estados-pull') || {}).textContent || '');
  touch('touchend', null);
  r.indicador_actualizando = /Actualizando/.test((B.win.document.getElementById('estados-pull') || {}).textContent || '');
  r.deslizar_recupera = await wait(() => (B.win.NEXO_statusesOf(idA) || []).length === 10, 60);

  // 8. A se reinicia: sus estados, quién dio me gusta y los comentarios siguen
  A.win.close(); nA.destroyActivity(); await sleep(1500); nA.load(); A = await boot('A', nA); await sleep(1500);
  r.tras_reiniciar = A.win.NEXO_myStatuses().length === 10 && A.win.NEXO_whoLiked(s2).length === 1 && A.win.NEXO_myComments(s3).length === 1;

  r.errores = logs.filter((l) => /TypeError|undefined is not|No se pudo descifrar/.test(l)).slice(0, 4);
  const ok = r.emparejados && r.tres_sids && r.B_tiene_tres && r.B_no_mensaje_visible && r.tira_cuenta_3 && r.visor_empieza_1 && r.visor_siguiente_2 &&
    r.like_llega_con_quien && r.like_solo_en_el_2 && r.comentario_llega_a_A && r.comentario_no_en_otro && r.B_no_ve_comentarios &&
    r.mis_estados_abre && r.mis_estados_quien_like && r.mis_estados_comentario && r.quitar_uno_en_B && r.diez_activos && r.once_rechazado && r.B_tiene_diez &&
    r.B_sin_estados && r.indicador_soltar && r.indicador_actualizando && r.deslizar_recupera && r.tras_reiniciar && r.errores.length === 0;
  r.resultado = ok ? 'OK' : 'FAIL';
  console.log('ESTADOS3 ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_estados3.txt'), logs.join('\n'));
  process.exit(0);
})().catch((e) => { console.log('ESTADOS3 ' + JSON.stringify({ resultado: 'FAIL', error: String(e && e.message) })); fs.writeFileSync(path.join(__dirname, 'last_logs_estados3.txt'), logs.join('\n')); process.exit(1); });
