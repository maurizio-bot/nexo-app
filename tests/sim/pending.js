// Ronda 2767 (revisión de mensajes y archivos): lo pendiente cuando el contacto vuelve. A y B por Bluetooth. B se va;
// A escribe textos cortos y largos y graba una nota de voz; la app de A se reinicia (el Vivo la cierra) y B vuelve.
//  1. Antes: al reconectar arrancaban a la vez varios reenvíos de lo pendiente y un texto largo salía 3–5 veces a la
//     vez, cada vez cifrado distinto; B mezclaba los trozos y no lo podía descifrar (se perdía) mientras A lo daba por
//     entregado, y al rato las burbujas pasaban a "!". Debe: todo llega una vez y legible, A ve ✓✓ y ninguna "!".
//  2. Antes: la nota de voz pendiente llegaba como el texto "[adjunto]". Debe: llega como nota de voz.
//  3. Antes: la sincronización al reconectar reenviaba lo pendiente a la vez que la vuelta de reenvíos y B lo guardaba
//     desordenado (s1, s2, L1…). Debe: en el orden en que se escribió.
// Uso: node pending.js <dir_build>
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
      win.URL.createObjectURL = () => 'blob:sim'; win.URL.revokeObjectURL = () => {}; // jsdom no los tiene (burbuja de audio)
      // Micrófono de mentira: la nota de voz son 6 KB de "audio"
      win.navigator.mediaDevices = { getUserMedia: () => Promise.resolve({ getTracks: () => [{ stop() {} }] }) };
      win.MediaRecorder = class {
        constructor() { this.state = 'inactive'; }
        static isTypeSupported(t) { return t === 'audio/webm'; }
        start() { this.state = 'recording'; }
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
async function recordVoice(p) {
  const i = p.win.document.getElementById('message-input'); i.value = ''; i.dispatchEvent(new p.win.Event('input', { bubbles: true }));
  click(p.win, p.win.document.getElementById('send-btn')); await sleep(1500);
  click(p.win, p.win.document.getElementById('send-btn')); await sleep(1500);
}
// El receptor guarda la nota de voz como el texto del adjunto (lo dibuja al mostrarlo)
const isVoice = (m) => { if (m.attachmentType === 'audio') return true; try { const o = JSON.parse(m.content || ''); return !!(o && o.type === 'attachment' && o.attachmentType === 'audio' && o.payload); } catch (e) { return false; } };
const wait = async (c, s) => { const t0 = Date.now(); for (let i = 0; i < s * 5; i++) { if (await c()) return Math.round((Date.now() - t0) / 100) / 10; await sleep(200); } return null; };

(async () => {
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', opts), nB = new NativePhone('B', 'BB:BB:BB:BB:BB:02', opts);
  [nA, nB].forEach((n) => { radio.add(n); n.load(); });
  let [A, B] = await Promise.all([boot('A', nA), boot('B', nB)]);
  const idA = A.win.bleInterface.localNexoId.toLowerCase(), idB = B.win.bleInterface.localNexoId.toLowerCase();
  const r = { build: path.basename(buildDir) };
  A.win.bleInterface.togglePanel(); let add = null;
  for (let i = 0; i < 400 && !add; i++) { await sleep(100); add = A.win.document.querySelector('#ble-new-device > div button'); if (!add && !A.win.bleInterface.isScanning) click(A.win, A.win.document.getElementById('ble-scan-btn')); }
  click(A.win, add); await sleep(1500);
  if (A.win.document.getElementById('ble-panel').classList.contains('active')) A.win.bleInterface.togglePanel();
  await openChatWith(A, 'B'); sendText(A, 'hola'); await sleep(2500);
  r.contactos = (await wait(async () => (await B.win.vaultLoadMessages(idA)).some((m) => m.content === 'hola'), 30)) !== null;

  // B se va; A escribe y graba
  nB.setOffline(true); await sleep(1500);
  const texts = ['s1 corto', 'L1 ' + 'abcdefghij'.repeat(300), 's2 corto', 'L2 ' + 'klmnopqrst'.repeat(300), 's3 corto', 'L3 ' + 'uvwxyz0123'.repeat(300)];
  for (const t of texts) { sendText(A, t); await sleep(400); }
  await recordVoice(A);
  await sleep(3000);
  // La app de A se reinicia y B vuelve
  A.win.close(); nA.destroyActivity(); await sleep(1500); nA.load(); A = await boot('A', nA); await sleep(1000);
  await openChatWith(A, 'B');
  const mark = logs.length;
  nB.setOffline(false);
  const short = (t) => t.substring(0, 2);
  r.todo_llega_s = await wait(async () => { const vb = await B.win.vaultLoadMessages(idA); return texts.every((t) => vb.some((m) => m.content === t)) && vb.some(isVoice); }, 120);
  await sleep(70000); // lo que quedara a medias acaba aquí (antes: las burbujas pasaban a "!")
  const vb = await B.win.vaultLoadMessages(idA), va = await A.win.vaultLoadMessages(idB);
  r.faltan_en_B = texts.filter((t) => !vb.some((m) => m.content === t)).map(short);
  r.repetidos_en_B = texts.filter((t) => vb.filter((m) => m.content === t).length > 1).map(short);
  r.nota_de_voz_en_B = vb.filter(isVoice).length;
  r.adjunto_como_texto_en_B = vb.filter((m) => !m.attachmentType && /\[adjunto\]/.test(m.content || '')).length;
  r.orden_en_B = vb.filter((m) => !m._own && m.content !== 'hola').map((m) => isVoice(m) ? 'voz' : short(String(m.content)));
  r.estado_en_A = texts.map((t) => { const m = va.find((x) => x.content === t); return short(t) + ':' + (m ? m.status : '?'); });
  const voz = va.find((m) => m._own && m.attachmentType === 'audio');
  r.estado_voz_en_A = voz ? voz.status : '?';
  r.burbujas_con_error_en_A = Array.from(A.win.document.querySelectorAll('#messages-container .message.own .msg-status')).filter((s) => /failed/.test(s.className)).length;
  const after = logs.slice(mark);
  r.B_no_descifra = after.filter((l) => / \[B\] /.test(l) && /No se pudo descifrar/.test(l)).length;
  const ids = {}; texts.filter((t) => t[0] === 'L').forEach((t) => { const m = va.find((x) => x.content === t); if (m) ids[short(t)] = m.msgId; });
  r.flujos_por_texto_largo = {}; Object.keys(ids).forEach((k) => { r.flujos_por_texto_largo[k] = after.filter((l) => / \[A\] /.test(l) && l.indexOf('[ChatStream] START msgId=' + ids[k] + ' ') >= 0).length; });
  r.errores = logs.filter((l) => / error: /.test(l) && !/JSDOMERROR|styles\.css|Not implemented/.test(l)).slice(0, 5);
  const ok = r.contactos && r.todo_llega_s !== null && !r.faltan_en_B.length && !r.repetidos_en_B.length && r.nota_de_voz_en_B === 1 && r.adjunto_como_texto_en_B === 0 &&
    r.estado_en_A.every((s) => /:(delivered|read)$/.test(s)) && /delivered|read/.test(r.estado_voz_en_A) && r.burbujas_con_error_en_A === 0 && r.B_no_descifra === 0 &&
    Object.values(r.flujos_por_texto_largo).every((n) => n <= 1) && r.orden_en_B.join(',') === 's1,L1,s2,L2,s3,L3,voz' && !r.errores.length;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('PENDING ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_pending.txt'), logs.join('\n'));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error(e); fs.writeFileSync(path.join(__dirname, 'last_logs_pending.txt'), logs.join('\n')); process.exit(1); });
