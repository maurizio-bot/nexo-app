// Pedido del dueño (09-11): «los mensajes de voz que van seguidos, que se reproduzcan uno tras otro» (como WhatsApp).
// 2977: al terminar una nota de voz, si la burbuja SIGUIENTE del chat también es una nota de voz, arranca sola; un texto u otra
// cosa en medio corta la cadena. A y B por Bluetooth: A manda dos notas seguidas, un texto y una tercera nota. En B: ▶ en la
// primera → al terminar, la segunda suena sola (y la primera vuelve a ▶); al terminar la segunda, la tercera NO (hay un texto en
// medio). El <audio> de jsdom no reproduce: se simula play/pause y el evento 'ended'.
// 3131 (dueño 15-11: «el botón de ×1.5 y ×2 para acelerar al escuchar un audio»): cada nota tiene su botón de velocidad (1×); al
// tocarlo pasa a 1.5× en TODAS y la que suena se acelera; otra vez 2×, otra vez 1×; la siguiente en cadena arranca a la velocidad elegida.
// Uso: node voicechain.js <dir_build>
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone } = require('./native_mock');

const buildDir = path.resolve(process.argv[2]);
const opts = { readsContentFallback: true, retain: ['onPayloadReceived'], closeOnNoService: true, pace: [15, 15], ioDelay: 25, asymmetric: true, noTor: true };
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
      win.navigator.mediaDevices = { getUserMedia: () => Promise.resolve({ getTracks: () => [{ readyState: 'live', stop() {} }] }) };
      win.MediaRecorder = class {
        constructor() { this.state = 'inactive'; }
        static isTypeSupported(t) { return t === 'audio/webm'; }
        start() { this.state = 'recording'; }
        pause() { if (this.state === 'recording') this.state = 'paused'; }
        resume() { if (this.state === 'paused') this.state = 'recording'; }
        requestData() { if (this.ondataavailable) this.ondataavailable({ data: new win.Blob([Buffer.alloc(6000, 7)], { type: 'audio/webm' }) }); }
        stop() { this.state = 'inactive'; if (this.onstop) this.onstop(); }
      };
      // Reproductor de mentira: jsdom no reproduce; se anota qué <audio> está sonando y se puede disparar 'ended'
      win.__audios = [];
      const OA = win.Audio;
      win.Audio = function (src) { const a = new OA(src); a.__playing = false; win.__audios.push(a); return a; };
      win.HTMLMediaElement.prototype.play = function () { this.__playing = true; return Promise.resolve(); };
      win.HTMLMediaElement.prototype.pause = function () { this.__playing = false; };
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
function micTap(p) { const i = p.win.document.getElementById('message-input'); i.value = ''; i.dispatchEvent(new p.win.Event('input', { bubbles: true })); click(p.win, p.win.document.getElementById('send-btn')); }
async function sendVoice(p) { micTap(p); await sleep(500); click(p.win, $(p, 'voice-send')); await sleep(800); }

(async () => {
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', opts), nB = new NativePhone('B', 'BB:BB:BB:BB:BB:02', opts);
  [nA, nB].forEach((n) => { radio.add(n); n.load(); });
  const [A, B] = await Promise.all([boot('A', nA), boot('B', nB)]);
  const idA = A.win.bleInterface.localNexoId.toLowerCase();
  const r = { prueba: 'voicechain', build: path.basename(buildDir) };
  A.win.bleInterface.togglePanel(); let add = null;
  for (let i = 0; i < 400 && !add; i++) { await sleep(100); add = A.win.document.querySelector('#ble-new-device > div button'); if (!add && !A.win.bleInterface.isScanning) click(A.win, A.win.document.getElementById('ble-scan-btn')); }
  click(A.win, add); await sleep(1500);
  if (A.win.document.getElementById('ble-panel').classList.contains('active')) A.win.bleInterface.togglePanel();
  await openChatWith(A, 'B'); sendText(A, 'hola'); await sleep(2500);
  r.contactos = (await wait(async () => (await B.win.vaultLoadMessages(idA)).some((m) => m.content === 'hola'), 30)) !== null;

  // A: nota 1, nota 2 (seguidas), un texto, nota 3
  await sendVoice(A); await sendVoice(A);
  r.dos_notas_llegan_s = await wait(async () => (await B.win.vaultLoadMessages(idA)).filter(isVoice).length === 2, 40);
  sendText(A, 'y un texto en medio'); await sleep(1500);
  await sendVoice(A);
  r.tres_notas_llegan_s = await wait(async () => (await B.win.vaultLoadMessages(idA)).filter(isVoice).length === 3, 40);

  // B abre el chat: tres reproductores en orden
  await openChatWith(B, 'A'); await sleep(1500);
  const btns = () => Array.from(B.win.document.querySelectorAll('#messages-container .message button[id^="audio"][id$="_play"]'));
  r.reproductores = btns().length;
  const texto_entre = (() => { const ms = Array.from(B.win.document.querySelectorAll('#messages-container .message')); const i2 = ms.findIndex((m) => m.contains(btns()[1])), i3 = ms.findIndex((m) => m.contains(btns()[2])); return i3 - i2 > 1; })();
  r.texto_entre_2_y_3 = texto_entre;
  const audios = B.win.__audios;
  r.audios_creados = audios.length;

  // dueño 23-11: las tres recibidas, SIN escuchar (botón cian y punto)
  const unheard = () => btns().map((b) => !!(b.closest('.vn-wrap') && b.closest('.vn-wrap').classList.contains('vn-unheard')));
  r.H1_tres_sin_escuchar = JSON.stringify(unheard()) === '[true,true,true]';
  // ▶ en la primera → suena la primera
  click(B.win, btns()[0]); await sleep(400);
  r.primera_suena = btns()[0].innerHTML === '⏸' && audios.some((a) => a.__playing);
  const sonando1 = audios.filter((a) => a.__playing);
  // Termina la primera → la SEGUNDA arranca sola (antes: nada)
  sonando1.forEach((a) => a.dispatchEvent(new B.win.Event('ended'))); await sleep(900);
  r.primera_vuelve_a_play = btns()[0].innerHTML === '▶';
  r.segunda_arranca_sola = btns()[1].innerHTML === '⏸' && audios.filter((a) => a.__playing).length === 1 && !sonando1.some((a) => a.__playing);
  // Termina la segunda → la tercera NO (hay un texto en medio); nada suena
  audios.filter((a) => a.__playing).forEach((a) => a.dispatchEvent(new B.win.Event('ended'))); await sleep(900);
  r.tercera_no_arranca = btns()[2].innerHTML === '▶' && !audios.some((a) => a.__playing);
  r.H2_solo_falta_la_tercera = JSON.stringify(unheard()) === '[false,false,true]';
  // ▶ en la tercera a mano → suena (y termina sin más)
  click(B.win, btns()[2]); await sleep(400);
  r.tercera_a_mano = btns()[2].innerHTML === '⏸';
  r.H3_todas_escuchadas = JSON.stringify(unheard()) === '[false,false,false]';
  audios.filter((a) => a.__playing).forEach((a) => a.dispatchEvent(new B.win.Event('ended'))); await sleep(900);
  r.fin_limpio = !audios.some((a) => a.__playing) && btns().every((b) => b.innerHTML === '▶');

  // dueño 23-11: la bolita de la barra: tocar a la mitad → la bolita va a la mitad y el audio sigue desde ahí
  const seek = B.win.document.querySelectorAll('#messages-container .message .vn-seek')[0];
  r.S0_barra_y_bolita = !!(seek && seek.querySelector('.vn-thumb'));
  if (seek) {
    seek.getBoundingClientRect = () => ({ left: 100, width: 200, top: 0, height: 26, right: 300, bottom: 26 });
    const pev = (type, x) => { const e = new B.win.Event(type, { bubbles: true }); Object.defineProperty(e, 'clientX', { value: x }); Object.defineProperty(e, 'pointerId', { value: 1 }); seek.dispatchEvent(e); };
    const aud = audios.find((a) => a.__playing === false) || audios[0];
    pev('pointerdown', 200); pev('pointermove', 250); pev('pointerup', 250);
    await sleep(100);
    const th = seek.querySelector('.vn-thumb');
    r.S1_bolita_a_tres_cuartos = th.style.left === '75%';
    const painted = Array.from(seek.querySelectorAll('.wave-bar')).filter((b) => /0, 200, 255|#00c8ff|var\(--vn-played\)/i.test(b.style.background)).length;
    r.S2_onda_pintada_hasta_ahi = painted === 21;
    const t0 = audios.map((a) => a.currentTime);
    r.S3_audio_salta = audios.some((a) => a.currentTime > 0);
    r.S3_detalle = t0.map((x) => Math.round(x * 10) / 10);
    void aud;
  }
  // 3131: velocidad
  const rates = () => Array.from(B.win.document.querySelectorAll('#messages-container .message .vn-rate'));
  r.V1_boton_en_cada_nota = rates().length === 3 && rates().every((b) => b.textContent === '1×');
  click(B.win, btns()[0]); await sleep(400);
  click(B.win, rates()[0]); await sleep(200);
  const playingNow = () => audios.filter((a) => a.__playing);
  r.V2_a_1_5 = rates().every((b) => b.textContent === '1.5×') && playingNow().length === 1 && playingNow()[0].playbackRate === 1.5;
  // termina la primera → la segunda arranca sola a 1.5×
  playingNow().forEach((a) => a.dispatchEvent(new B.win.Event('ended'))); await sleep(900);
  r.V3_cadena_a_1_5 = playingNow().length === 1 && playingNow()[0].playbackRate === 1.5;
  click(B.win, rates()[1]); await sleep(200);
  r.V4_a_2 = rates().every((b) => b.textContent === '2×') && playingNow()[0].playbackRate === 2;
  click(B.win, rates()[1]); await sleep(200);
  r.V5_vuelve_a_1 = rates().every((b) => b.textContent === '1×') && playingNow()[0].playbackRate === 1;
  playingNow().forEach((a) => a.dispatchEvent(new B.win.Event('ended'))); await sleep(900);
  r.errores = logs.filter((l) => / error: /.test(l) && !/JSDOMERROR|styles\.css|Not implemented|GLOBAL TIMEOUT|net::ERR|fetch/.test(l)).slice(0, 5);
  const ok = r.contactos && r.dos_notas_llegan_s !== null && r.tres_notas_llegan_s !== null && r.reproductores === 3 && r.texto_entre_2_y_3 && r.primera_suena && r.primera_vuelve_a_play &&
    r.segunda_arranca_sola && r.tercera_no_arranca && r.tercera_a_mano && r.fin_limpio && r.H1_tres_sin_escuchar && r.H2_solo_falta_la_tercera && r.H3_todas_escuchadas && r.S0_barra_y_bolita && r.S1_bolita_a_tres_cuartos && r.S2_onda_pintada_hasta_ahi && r.S3_audio_salta && r.V1_boton_en_cada_nota && r.V2_a_1_5 && r.V3_cadena_a_1_5 && r.V4_a_2 && r.V5_vuelve_a_1 && !r.errores.length;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('VOICECHAIN ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_voicechain.txt'), logs.join('\n'));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('VOICECHAIN ' + JSON.stringify({ prueba: 'voicechain', resultado: 'FALLO', error: String(e && e.message).replace(/"/g, "'") })); console.error(e && e.stack); fs.writeFileSync(path.join(__dirname, 'last_logs_voicechain.txt'), logs.join('\n')); process.exit(1); });
