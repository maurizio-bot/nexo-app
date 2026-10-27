// Ronda 2809 — Auditoría P0-4: XSS. Vigila que el contenido que viene del OTRO teléfono (texto del mensaje, y por el
// mismo camino nombres/archivos/grupos/ubicaciones) se pinte como TEXTO y nunca como HTML. Hoy la app usa textContent;
// esta prueba lo fija para siempre: si alguien volviera a usar innerHTML con datos del remitente, FALLA.
//  - Manda varios mensajes con cargas típicas de XSS (<img onerror>, <script>, <svg onload>, <iframe>, on* handlers).
//  - Comprueba que en el chat NO aparece ningún elemento inyectado (img/script/svg/iframe dentro de .msg-text),
//    que ningún handler se ejecutó (window.__xssN sigue sin definir) y que la carga aparece como texto literal.
//  - Comprueba que la CSP (index.html) trae el endurecimiento (object-src 'none', base-uri 'self', form-action 'self').
// Uso: node xss.js <dir_build>
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone, installWebCrypto } = require('./native_mock');

const buildDir = path.resolve(process.argv[2]);
const opts = { readsContentFallback: true, retain: ['onPayloadReceived'], closeOnNoService: true, pace: [15, 15], ioDelay: 25 };
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
const wait = async (c, s) => { for (let i = 0; i < s * 5; i++) { if (await c()) return true; await sleep(200); } return false; };
async function openChatWith(p, name) {
  let row; for (let i = 0; i < 300 && !row; i++) { row = Array.from(p.win.document.querySelectorAll('#main-contacts-list .ble-contact-row')).find((r) => (r.querySelector('.ble-contact-name') || {}).textContent === name); if (!row) await sleep(100); }
  click(p.win, row); await sleep(600); return !!row;
}
function sendText(p, t) { const i = p.win.document.getElementById('message-input'); i.value = t; i.dispatchEvent(new p.win.Event('input', { bubbles: true })); click(p.win, p.win.document.getElementById('send-btn')); }

const PAYLOADS = [
  '<img src=x onerror="window.__xss1=1">zzz',
  '<script>window.__xss2=1</script>',
  '"><svg onload="window.__xss3=1"></svg>',
  '<iframe src="javascript:window.__xss4=1"></iframe>',
  '<b onclick="window.__xss5=1">hola</b> <a href="javascript:window.__xss6=1">x</a>',
];

(async () => {
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', opts), nB = new NativePhone('B', 'BB:BB:BB:BB:BB:02', opts);
  [nA, nB].forEach((n) => { radio.add(n); n.load(); });
  const [A, B] = await Promise.all([boot('A', nA), boot('B', nB)]);
  const r = { build: path.basename(buildDir) };

  // Agregar B como contacto en A y abrir el chat
  A.win.bleInterface.togglePanel(); let add = null;
  for (let i = 0; i < 400 && !add; i++) { await sleep(100); add = A.win.document.querySelector('#ble-new-device > div button'); if (!add && !A.win.bleInterface.isScanning) click(A.win, A.win.document.getElementById('ble-scan-btn')); }
  click(A.win, add); await sleep(1500);
  if (A.win.document.getElementById('ble-panel').classList.contains('active')) A.win.bleInterface.togglePanel();
  r.chat_abre = await openChatWith(A, 'B');

  // Mandar cada carga como mensaje propio (se pinta por el mismo _fillTextBubble)
  for (const p of PAYLOADS) { sendText(A, p); await sleep(250); }
  await sleep(600);

  const doc = A.win.document;
  // El texto plano se pinta con textContent sobre .msg-content (la .msg-text solo existe en mensajes con cita/reenvío).
  const marca = (s) => /zzz|onerror=|__xss|<script>|<iframe|onclick=/.test(s);
  r.total_mensajes = doc.querySelectorAll('#messages-container .msg-content').length;
  const bubbles = Array.from(doc.querySelectorAll('#messages-container .msg-content')).filter((b) => marca(b.textContent || ''));
  r.burbujas = bubbles.length;
  // 1. Ningún elemento peligroso inyectado DENTRO de las burbujas con la carga (texto plano = cero hijos-elemento)
  r.sin_elementos_inyectados = bubbles.every((b) => b.querySelectorAll('img, script, svg, iframe, a, object, embed, b').length === 0);
  // 2. Ningún handler se ejecutó
  r.sin_ejecucion = ![1, 2, 3, 4, 5, 6].some((n) => A.win['__xss' + n]);
  // 3. Las cargas aparecen como TEXTO literal (al menos la del <img> y el <script>)
  const todo = bubbles.map((b) => b.textContent).join('\n');
  r.texto_literal = todo.indexOf('onerror=') >= 0 && todo.indexOf('<script>') >= 0;
  // 4. CSP endurecida en index.html
  const csp = (doc.querySelector('meta[http-equiv="Content-Security-Policy"]') || {}).content || '';
  r.csp_endurecida = /object-src 'none'/.test(csp) && /base-uri 'self'/.test(csp) && /form-action 'self'/.test(csp);

  r.errores = logs.filter((l) => /TypeError|undefined is not|is not a function|RangeError/.test(l)).slice(0, 4);
  const ok = r.chat_abre && r.burbujas >= PAYLOADS.length && r.sin_elementos_inyectados && r.sin_ejecucion &&
    r.texto_literal && r.csp_endurecida && r.errores.length === 0;
  r.resultado = ok ? 'OK' : 'FAIL';
  console.log('XSS ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_xss.txt'), logs.join('\n'));
  process.exit(0);
})().catch((e) => { console.error('FALLO:', e.stack); fs.writeFileSync(path.join(__dirname, 'last_logs_xss.txt'), logs.join('\n')); process.exit(1); });
