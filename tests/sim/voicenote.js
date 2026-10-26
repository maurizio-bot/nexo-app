// Ronda 2781 (informe del dueño): notas de voz — PAUSAR/REANUDAR una grabación, BORRARLA antes de enviar, y que el
// audio que esté sonando se PARE al empezar a grabar o al entrar una llamada. A y B por Bluetooth.
//  1. A graba, pausa y reanuda; al enviar, a B le llega UNA nota de voz.
//  2. A graba otra y la BORRA (🗑): no se envía nada nuevo; la barra desaparece.
//  3. Al empezar a grabar se pide parar el audio que suena (window.__nexoVoiceStops sube), y un evento de llamada
//     entrante ('nexo:call' ringing) también lo pide.
// Uso: node voicenote.js <dir_build>
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
      win.navigator.mediaDevices = { getUserMedia: () => Promise.resolve({ getTracks: () => [{ stop() {} }] }) };
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
  const idA = A.win.bleInterface.localNexoId.toLowerCase(), idB = B.win.bleInterface.localNexoId.toLowerCase();
  const r = { build: path.basename(buildDir) };
  A.win.bleInterface.togglePanel(); let add = null;
  for (let i = 0; i < 400 && !add; i++) { await sleep(100); add = A.win.document.querySelector('#ble-new-device > div button'); if (!add && !A.win.bleInterface.isScanning) click(A.win, A.win.document.getElementById('ble-scan-btn')); }
  click(A.win, add); await sleep(1500);
  if (A.win.document.getElementById('ble-panel').classList.contains('active')) A.win.bleInterface.togglePanel();
  await openChatWith(A, 'B'); sendText(A, 'hola'); await sleep(2500);
  r.contactos = (await wait(async () => (await B.win.vaultLoadMessages(idA)).some((m) => m.content === 'hola'), 30)) !== null;

  // 1) Grabar → pausar → reanudar → enviar
  const stops0 = A.win.__nexoVoiceStops || 0;
  micTap(A); await sleep(600);
  r.barra_al_grabar = barVisible(A) && !!$(A, 'voice-cancel') && !!$(A, 'voice-pause') && !!$(A, 'voice-send');
  r.grabar_para_el_audio = (A.win.__nexoVoiceStops || 0) > stops0; // al grabar se pide parar lo que suena
  click(A.win, $(A, 'voice-pause')); await sleep(300);
  r.pausa = $(A, 'voice-pause').textContent === '▶';
  click(A.win, $(A, 'voice-pause')); await sleep(300);
  r.reanuda = $(A, 'voice-pause').textContent === '⏸';
  click(A.win, $(A, 'voice-send')); await sleep(1500);
  r.barra_oculta_tras_enviar = !barVisible(A);
  r.voz_llega_s = await wait(async () => (await B.win.vaultLoadMessages(idA)).filter(isVoice).length === 1, 40);

  // 2) Grabar otra y BORRAR: no se envía
  micTap(A); await sleep(600);
  r.barra_al_grabar_2 = barVisible(A);
  click(A.win, $(A, 'voice-cancel')); await sleep(1500);
  r.barra_oculta_tras_borrar = !barVisible(A);
  await sleep(1500);
  r.notas_en_B = (await B.win.vaultLoadMessages(idA)).filter(isVoice).length; // sigue habiendo solo 1

  // 3) Una llamada entrante también pide parar el audio
  const stops1 = A.win.__nexoVoiceStops || 0;
  A.win.dispatchEvent(new A.win.CustomEvent('nexo:call', { detail: { state: 'ringing' } }));
  await sleep(200);
  r.llamada_para_el_audio = (A.win.__nexoVoiceStops || 0) > stops1;

  r.errores = logs.filter((l) => / error: /.test(l) && !/JSDOMERROR|styles\.css|Not implemented/.test(l)).slice(0, 5);
  const ok = r.contactos && r.barra_al_grabar && r.grabar_para_el_audio && r.pausa && r.reanuda && r.barra_oculta_tras_enviar &&
    r.voz_llega_s !== null && r.barra_al_grabar_2 && r.barra_oculta_tras_borrar && r.notas_en_B === 1 && r.llamada_para_el_audio && !r.errores.length;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('VOICENOTE ' + JSON.stringify(r));
  if (!ok) fs.writeFileSync(path.join(__dirname, 'last_logs_voicenote.txt'), logs.join('\n'));
  process.exit(0);
})().catch((e) => { console.error('FALLO:', e.stack); fs.writeFileSync(path.join(__dirname, 'last_logs_voicenote.txt'), logs.join('\n')); process.exit(1); });
