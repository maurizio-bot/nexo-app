// Gestos del chat (3143, pedido del dueño 16-11): DESLIZAR PARA RESPONDER (un mensaje recibido y uno propio abren la respuesta
// con su cita en la barra sobre la caja; deslizar poco, en vertical o un gesto cancelado por el sistema NO responde; en diagonal
// moderada sí) y DESLIZAR PARA CANCELAR UNA NOTA DE VOZ (con el dedo en el botón de grabar, a la izquierda más de 100 px la nota
// se cancela y no se envía; soltar sin deslizar la deja como hoy y ➤ la envía). A y B por Bluetooth.
// Uso: node gestos.js <dir_build>
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone } = require('./native_mock');

const buildDir = path.resolve(process.argv[2]);
const opts = { readsContentFallback: true, retain: ['onPayloadReceived'], closeOnNoService: true, pace: [15, 15], ioDelay: 25, asymmetric: true };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
class DL extends ResourceLoader { constructor(d) { super(); this.d = d; } fetch(u) { const f = path.join(this.d, decodeURIComponent(new URL(u).pathname)); return fs.existsSync(f) ? Promise.resolve(fs.readFileSync(f)) : Promise.reject(new Error('x')); } }
const logs = [];
async function boot(name, native) {
  const vc = new VirtualConsole();
  ['log', 'warn', 'error'].forEach((l) => vc.on(l, (...a) => logs.push(`${new Date().toISOString().substring(14, 23)} [${name}] ${l}: ` + a.map(String).join(' ').substring(0, 250))));
  const dom = new JSDOM(fs.readFileSync(path.join(buildDir, 'dist', 'index.html'), 'utf8'), {
    url: 'https://' + name.toLowerCase() + '.nexo.test/index.html', runScripts: 'dangerously', resources: new DL(path.join(buildDir, 'dist')), pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) {
      win.CapacitorCustomPlatform = { name: 'android' }; require('./native_mock').installWebCrypto(win); win.Capacitor = { Plugins: { NexoBLE: native.plugin() } }; win.HTMLElement.prototype.scrollTo = function () {};
      win.URL.createObjectURL = () => 'blob:sim'; win.URL.revokeObjectURL = () => {};
      win.__gumCalls = 0; win.navigator.mediaDevices = { getUserMedia: () => { win.__gumCalls++; return Promise.resolve({ getTracks: () => [{ readyState: 'live', stop() {} }] }); } };
      // Micrófono de mentira con pausa/reanudación (ronda 2781)
      win.MediaRecorder = class {
        constructor() { this.state = 'inactive'; }
        static isTypeSupported(t) { return t === 'audio/webm'; }
        start() { this.state = 'recording'; }
        pause() { if (this.state === 'recording') this.state = 'paused'; }
        resume() { if (this.state === 'paused') this.state = 'recording'; }
        requestData() { if (this.ondataavailable) this.ondataavailable({ data: new win.Blob([Buffer.alloc(6000, 7)], { type: 'audio/webm' }) }); }
        stop() { this.state = 'inactive'; if (this.onstop) this.onstop(); }
      };
    },
  });
  const win = dom.window;
  for (let i = 0; i < 100 && !(win.NEXO && win.NEXO.initialized); i++) await sleep(100);
  await sleep(800);
  return { name, native, win };
}
const click = (w, el) => el && el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
async function openChatWith(p, name) {
  let row; for (let i = 0; i < 300 && !row; i++) { row = Array.from(p.win.document.querySelectorAll('#main-contacts-list .ble-contact-row')).find((r) => (r.querySelector('.ble-contact-name') || {}).textContent === name); if (!row) await sleep(100); }
  click(p.win, row); await sleep(600); return !!row;
}
function sendText(p, t) { const i = p.win.document.getElementById('message-input'); i.value = t; i.dispatchEvent(new p.win.Event('input', { bubbles: true })); click(p.win, p.win.document.getElementById('send-btn')); }
const isVoice = (m) => { if (m.attachmentType === 'audio') return true; try { const o = JSON.parse(m.content || ''); return !!(o && o.type === 'attachment' && o.attachmentType === 'audio' && o.payload); } catch (e) { return false; } };
const wait = async (c, s) => { const t0 = Date.now(); for (let i = 0; i < s * 5; i++) { if (await c()) return Math.round((Date.now() - t0) / 100) / 10; await sleep(200); } return null; };
const $ = (p, id) => p.win.document.getElementById(id);
// empezar a grabar: micrófono (send-btn con el texto vacío)
function micTap(p) { const i = p.win.document.getElementById('message-input'); i.value = ''; i.dispatchEvent(new p.win.Event('input', { bubbles: true })); click(p.win, p.win.document.getElementById('send-btn')); }
const barVisible = (p) => { const b = $(p, 'voice-bar'); return !!b && b.style.display !== 'none'; };

(async () => {
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', opts), nB = new NativePhone('B', 'BB:BB:BB:BB:BB:02', opts);
  [nA, nB].forEach((n) => { radio.add(n); n.load(); });
  const [A, B] = await Promise.all([boot('A', nA), boot('B', nB)]);
  const idA = A.win.bleInterface.localNexoId.toLowerCase();
  const r = { build: path.basename(buildDir) };
  A.win.bleInterface.togglePanel(); let add = null;
  for (let i = 0; i < 400 && !add; i++) { await sleep(100); add = A.win.document.querySelector('#ble-new-device > div button'); if (!add && !A.win.bleInterface.isScanning) click(A.win, A.win.document.getElementById('ble-scan-btn')); }
  click(A.win, add); await sleep(1500);
  if (A.win.document.getElementById('ble-panel').classList.contains('active')) A.win.bleInterface.togglePanel();
  await openChatWith(A, 'B'); sendText(A, 'hola'); await sleep(2500);
  r.contactos = (await wait(async () => (await B.win.vaultLoadMessages(idA)).some((m) => m.content === 'hola'), 30)) !== null;
  await openChatWith(B, 'A'); sendText(B, 'pregunta de B'); await sleep(2500);
  sendText(A, 'mensaje de A'); await sleep(2500);

  const bubbles = () => Array.from(A.win.document.querySelectorAll('#messages-container .message:not(.progress-placeholder)'));
  const bubbleWith = (t) => bubbles().find((m) => m.textContent.indexOf(t) >= 0);
  r.burbuja_recibida = !!bubbleWith('pregunta de B') && bubbleWith('pregunta de B').classList.contains('other');
  r.burbuja_propia = !!bubbleWith('mensaje de A') && bubbleWith('mensaje de A').classList.contains('own');
  // gesto con punteros: pasos = [[x,y],...]; fin = 'pointerup' | 'pointercancel' (el cancelado trae clientX = 0, como Android)
  const gesto = async (el, pasos, fin) => {
    const pe = (type, x, y) => el.dispatchEvent(new A.win.MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y }));
    pe('pointerdown', pasos[0][0], pasos[0][1]);
    for (const p of pasos.slice(1)) pe('pointermove', p[0], p[1]);
    const u = pasos[pasos.length - 1];
    if (fin === 'pointercancel') pe('pointercancel', 0, 0); else pe('pointerup', u[0], u[1]);
    await sleep(500);
  };
  const barra = () => A.win.document.getElementById('reply-bar');
  const limpiar = async () => { const x = A.win.document.querySelector('#reply-bar .reply-cancel'); if (x) click(A.win, x); await sleep(200); };
  const barraTxt = () => (barra() ? barra().textContent : '');

  // 1) Mensaje RECIBIDO: deslizar a la derecha → responde, con la cita (quién y el texto) y la ✕ en la barra
  await gesto(bubbleWith('pregunta de B'), [[100, 300], [140, 304], [190, 306]]);
  r.recibido_abre = !!barra();
  r.recibido_cita = /pregunta de B/.test(barraTxt()) && !!barra() && !!barra().querySelector('.reply-cancel');
  r.recibido_autor = /Respondiendo a/.test(barraTxt()) && !/Respondiendo a ti/.test(barraTxt());
  await limpiar(); r.x_quita_la_cita = !barra();
  // 2) Mensaje PROPIO: igual, la cita dice «ti»
  await gesto(bubbleWith('mensaje de A'), [[100, 300], [140, 304], [190, 306]]);
  r.propio_abre = !!barra();
  r.propio_cita = /mensaje de A/.test(barraTxt()) && /Respondiendo a ti/.test(barraTxt());
  await limpiar();
  // 3) Poco recorrido, vertical, y gesto cancelado por el sistema: NO responden
  await gesto(bubbleWith('pregunta de B'), [[100, 300], [115, 301], [130, 302]]);
  r.poco_no_responde = !barra(); await limpiar();
  await gesto(bubbleWith('pregunta de B'), [[100, 300], [104, 360], [108, 420]]);
  r.vertical_no_responde = !barra(); await limpiar();
  await gesto(bubbleWith('pregunta de B'), [[100, 300], [115, 302], [130, 303]], 'pointercancel');
  r.cancelado_no_responde = !barra(); await limpiar();
  // 4) Desliz algo diagonal (el pulgar baja un poco): responde
  await gesto(bubbleWith('pregunta de B'), [[100, 300], [130, 330], [195, 350]]);
  r.diagonal_responde = !!barra() && /pregunta de B/.test(barraTxt()); await limpiar();
  // 5) A la izquierda también (ya existía)
  await gesto(bubbleWith('mensaje de A'), [[250, 300], [210, 303], [150, 305]]);
  r.izquierda_responde = !!barra(); await limpiar();

  // 6) Nota de voz con el dedo en el botón: deslizar a la izquierda > 100 px cancela (no se envía)
  const btn = $(A, 'send-btn');
  const inp = A.win.document.getElementById('message-input'); inp.value = ''; inp.dispatchEvent(new A.win.Event('input', { bubbles: true })); await sleep(300);
  const touch = (type, x) => { const e = new A.win.Event(type, { bubbles: true, cancelable: true }); const t = [{ clientX: x, clientY: 600, identifier: 1, target: btn }]; Object.defineProperty(e, 'touches', { value: type === 'touchend' ? [] : t }); Object.defineProperty(e, 'changedTouches', { value: t }); btn.dispatchEvent(e); };
  r.boton_modo_mic = btn.classList.contains('mic-mode');
  const notas0 = (await B.win.vaultLoadMessages(idA)).filter(isVoice).length;
  touch('touchstart', 300); await sleep(900);                 // pulsación larga: empieza a grabar
  r.graba_al_mantener = barVisible(A);
  touch('touchmove', 250); await sleep(100);
  r.pista_visible = ($(A, 'voice-slide-hint') || {}).style && $(A, 'voice-slide-hint').style.display !== 'none' && /Desliza|Slide|Scorri|Deslize|Glisse/.test($(A, 'voice-slide-hint').textContent);
  r.poco_no_cancela = barVisible(A);
  touch('touchmove', 150); await sleep(100);                  // -150 px: pasa de 100
  touch('touchend', 150); await sleep(1800);
  r.cancelada_barra_oculta = !barVisible(A);
  await sleep(2500);
  r.cancelada_no_se_envia = (await B.win.vaultLoadMessages(idA)).filter(isVoice).length === notas0;
  // 7) 3145: mantener + soltar sin deslizar = la nota se envía sola
  touch('touchstart', 300); await sleep(1300);
  r.mantener_graba = barVisible(A);
  touch('touchmove', 280); touch('touchend', 280);
  r.suelta_envia = (await wait(async () => (await B.win.vaultLoadMessages(idA)).filter(isVoice).length === notas0 + 1, 40)) !== null;
  r.suelta_barra_oculta = !barVisible(A);
  // 8) mantener + deslizar a la izquierda + soltar: no se envía nada
  await sleep(1500);
  touch('touchstart', 300); await sleep(1300);
  touch('touchmove', 150); touch('touchend', 150); await sleep(4000);
  r.desliza_suelta_no_envia = (await B.win.vaultLoadMessages(idA)).filter(isVoice).length === notas0 + 1 && !barVisible(A);
  // 9) toque rápido: sigue grabando con su barra; ➤ la envía
  await sleep(500);
  const click0 = () => click(A.win, btn);
  touch('touchstart', 300); await sleep(100); touch('touchend', 300); click0(); await sleep(1500);
  r.toque_sigue_grabando = barVisible(A);
  click(A.win, $(A, 'voice-send'));
  r.voz_llega_s = await wait(async () => (await B.win.vaultLoadMessages(idA)).filter(isVoice).length === notas0 + 2, 40);

  r.errores = logs.filter((l) => / error: /.test(l) && !/JSDOMERROR|styles\.css|Not implemented/.test(l)).slice(0, 5);
  const keys = ['contactos', 'burbuja_recibida', 'burbuja_propia', 'recibido_abre', 'recibido_cita', 'recibido_autor', 'x_quita_la_cita', 'propio_abre', 'propio_cita', 'poco_no_responde', 'vertical_no_responde', 'cancelado_no_responde', 'diagonal_responde', 'izquierda_responde', 'boton_modo_mic', 'graba_al_mantener', 'pista_visible', 'poco_no_cancela', 'cancelada_barra_oculta', 'cancelada_no_se_envia', 'mantener_graba', 'suelta_envia', 'suelta_barra_oculta', 'desliza_suelta_no_envia', 'toque_sigue_grabando'];
  const ok = keys.every((k) => r[k] === true) && r.voz_llega_s !== null && !r.errores.length;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('GESTOS ' + JSON.stringify(r));
  if (!ok) fs.writeFileSync(path.join(__dirname, 'last_logs_gestos.txt'), logs.join('\n'));
  process.exit(0);
})().catch((e) => { console.error('FALLO:', e.stack); fs.writeFileSync(path.join(__dirname, 'last_logs_gestos.txt'), logs.join('\n')); process.exit(1); });
