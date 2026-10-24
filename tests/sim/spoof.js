// Ronda 2768 (revisión de llamadas, seguridad): un teléfono ajeno M, cerca de B, escribe en su servidor Bluetooth
// (acepta escrituras de cualquiera) paquetes SIN cifrar que dicen ser de A, contacto de B. Con la 2767: el texto se
// guardaba y se mostraba como de A, una oferta de llamada falsa sonaba con el nombre de A (y la voz de B salía cifrada
// con la clave que eligió M), un "colgar" falso cortaba una llamada real y la conexión de A quedaba apuntada a M.
// Debe pasar: nada de eso (se descarta con aviso en el registro) y lo de verdad de A sigue llegando.
//  1. Texto corto, texto largo por trozos y foto por trozos, sin cifrar y "de A": ni se guardan ni se muestran.
//  2. Oferta de llamada sin cifrar "de A": B no suena.
//  3. La conexión de A en B sigue siendo la de A (no la de M).
//  4. En una llamada real A-B, un "colgar" sin cifrar con el id de la llamada (va en claro en la voz): no corta.
//  5. Un texto de verdad de A sigue llegando.
// Uso: node spoof.js <dir_build> [--io-delay=25]
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone } = require('./native_mock');

const buildDir = path.resolve(process.argv[2]);
const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith('--' + k)); if (!a) return d; const v = a.split('=')[1]; return v === undefined ? true : Number(v); };
const opts = { readsContentFallback: true, retain: ['onPayloadReceived'], closeOnNoService: true, pace: [15, 15], ioDelay: arg('io-delay', 25), asymmetric: true, supervisionMs: 3000 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
class DistLoader extends ResourceLoader {
  constructor(dir) { super(); this.dir = dir; }
  fetch(url) { const f = path.join(this.dir, decodeURIComponent(new URL(url).pathname)); return fs.existsSync(f) ? Promise.resolve(fs.readFileSync(f)) : Promise.reject(new Error('no existe ' + f)); }
}
const logs = [];
async function boot(name, native) {
  const vc = new VirtualConsole();
  ['log', 'warn', 'error'].forEach((l) => vc.on(l, (...a) => logs.push(`${new Date().toISOString().substring(14, 23)} [${name}] ${l}: ` + a.map(String).join(' ').substring(0, 250))));
  const dom = new JSDOM(fs.readFileSync(path.join(buildDir, 'dist', 'index.html'), 'utf8'), {
    url: 'https://' + name.toLowerCase() + '.nexo.test/index.html', runScripts: 'dangerously',
    resources: new DistLoader(path.join(buildDir, 'dist')), pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) {
      win.CapacitorCustomPlatform = { name: 'android' }; require('./native_mock').installWebCrypto(win); win.Capacitor = { Plugins: { NexoBLE: native.plugin() } }; win.HTMLElement.prototype.scrollTo = function () {};
      // Micrófono falso (como calls.js): un paquete de voz cada 100 ms
      win.NEXO_callMediaFactory = (o) => {
        let t = null, n = 0;
        return {
          start() { t = setInterval(() => { const f = new Uint8Array(42); f[0] = name.charCodeAt(0); f[1] = n & 255; f.fill(0x5a, 2); n++; const p = new Uint8Array(4 + f.length); p[0] = 1; p[1] = 1; p[2] = 0; p[3] = f.length; p.set(f, 4); o.onPacket(p); }, 100); return Promise.resolve({ codec: 'opus', video: false }); },
          play() {}, playVideo() {}, mute() {},
          stop() { clearInterval(t); }
        };
      };
    },
  });
  const win = dom.window;
  for (let i = 0; i < 100 && !(win.NEXO && win.NEXO.initialized); i++) await sleep(100);
  await sleep(800);
  return { name, native, win };
}
const click = (win, el) => el && el.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
async function openChat(p) { let row; for (let i = 0; i < 300 && !row; i++) { row = p.win.document.querySelector('#main-contacts-list .ble-contact-row'); if (!row) await sleep(100); } click(p.win, row); await sleep(400); }
function sendText(p, t) { const i = p.win.document.getElementById('message-input'); i.value = t; i.dispatchEvent(new p.win.Event('input', { bubbles: true })); click(p.win, p.win.document.getElementById('send-btn')); }
const wait = async (c, s) => { for (let i = 0; i < s * 5 && !(await c()); i++) await sleep(200); return !!(await c()); };
const callState = (p) => { const c = p.win.bleInterface.calls.call; return c ? c.state : null; };
// Comprobación de cada trozo (la de ble_ack.js: _chunkCheck)
function chunkCheck(o) {
  const s = [o.m, o.i, o.n, o.d, o.th || '', o.fn || ''].join('|');
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(36);
}

(async () => {
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', opts), nB = new NativePhone('B', 'BB:BB:BB:BB:BB:02', opts);
  [nA, nB].forEach((n) => { radio.add(n); n.load(); });
  const [A, B] = await Promise.all([boot('A', nA), boot('B', nB)]);
  A.win.bleInterface.togglePanel(); let add = null;
  for (let i = 0; i < 400 && !add; i++) { await sleep(100); add = A.win.document.querySelector('#ble-new-device > div button'); if (!add && !A.win.bleInterface.isScanning) click(A.win, A.win.document.getElementById('ble-scan-btn')); }
  click(A.win, add); await sleep(1500);
  if (A.win.document.getElementById('ble-panel').classList.contains('active')) A.win.bleInterface.togglePanel();
  await openChat(A); sendText(A, 'hola'); await sleep(3000); await openChat(B); await sleep(500);
  const idA = A.win.bleInterface.localNexoId.toLowerCase();
  const r = {};
  // M escribe en el servidor Bluetooth de B (dirección que B no conoce)
  const M = 'CC:CC:CC:CC:CC:03';
  const inject = (obj) => nB._processReceivedChunk(M, JSON.stringify(obj), 'gatt_server');
  const contactA = () => (B.win.bleInterface.getBLEContacts() || []).find((c) => String(c.nexoId || c.deviceUUID).toLowerCase() === idA) || {};
  const mapA0 = contactA().deviceId;
  const stored = async (t) => (await B.win.vaultLoadMessages(idA)).some((m) => String(m.content || '').indexOf(t) >= 0 || String(m.text || '').indexOf(t) >= 0);
  const shown = (t) => Array.from(B.win.document.querySelectorAll('#messages-container .message')).some((e) => (e.textContent || '').indexOf(t) >= 0);
  const now = Date.now();
  // 1a. Texto corto
  const corto = 'soy A, mandame el codigo ' + now;
  inject({ v: 1, type: 'chat', from: idA, to: '', ts: now, seq: 90, msgId: 'msgfalso' + now, payload: { text: corto, senderNexoId: idA, senderName: 'A', timestamp: now } });
  // 1b. Texto largo por trozos
  const largo = 'TEXTO LARGO FALSO ' + now + ' ' + 'x'.repeat(260);
  const lm = 'msglargo' + now, lparts = [largo.slice(0, 150), largo.slice(150)];
  lparts.forEach((d, i) => { const o = { v: 2, t: 'c', m: lm, i, n: lparts.length, d }; if (i === 0) Object.assign(o, { f: 'A', fr: idA, ts: now, seq: 91 }); o.k = chunkCheck(o); inject(o); });
  // 1c. Foto por trozos
  const foto = Buffer.from('FOTO FALSA ' + now + ' ' + 'y'.repeat(200)).toString('base64');
  const fm = 'filefalso' + now, fparts = [foto.slice(0, 160), foto.slice(160)];
  fparts.forEach((d, i) => { const o = { v: 2, t: 'f', m: fm, i, n: fparts.length, d }; if (i === 0) Object.assign(o, { f: 'A', fr: idA, ts: now, seq: 92, tp: 'image', mt: 'image/jpeg', fs: 220 }); o.k = chunkCheck(o); inject(o); });
  // 2. Oferta de llamada
  const key = require('crypto').randomBytes(32).toString('hex');
  inject({ v: 1, type: 'chat', from: idA, to: '', ts: now, seq: 93, msgId: 'csfalso' + now, payload: { text: JSON.stringify({ type: 'nexo_call', op: 'offer', id: 'clfalso' + now, ts: Date.now(), k: key, co: 'ulaw' }), senderNexoId: idA, senderName: 'A', timestamp: now } });
  r.B_suena_llamada_falsa = await wait(() => callState(B) === 'ringing', 5);
  await sleep(2000);
  r.texto_corto_guardado = await stored(corto);
  r.texto_largo_guardado = await stored('TEXTO LARGO FALSO ' + now);
  r.mostrado = shown(corto) || shown('TEXTO LARGO FALSO');
  const ids = new Set(['msgfalso' + now, lm, fm, 'csfalso' + now]);
  r.guardados_por_id = (await B.win.vaultLoadMessages(idA)).filter((m) => ids.has(m.msgId) || ids.has(m.messageId) || ids.has(m.id)).map((m) => m.msgId || m.messageId || m.id);
  // Se descartó cada cosa (y por eso no se ve): lo dice el registro
  const drop = (re) => logs.some((l) => /\[B\]/.test(l) && re.test(l));
  r.descartes = { corto: drop(/\[E2E\] Mensaje sin cifrar que dice ser de/), largo: drop(/\[E2E\] Texto largo sin cifrar que dice ser de/), foto: drop(/\[E2E\] Archivo sin cifrar que dice ser de/) };
  // 3. La conexión de A sigue siendo la suya
  r.conexion_de_A_intacta = contactA().deviceId === mapA0 && !B.win.bleInterface._macToNexoId.get('cccccccccc03');
  if (B.win.bleInterface.calls.call) B.win.bleInterface.calls.hangup();
  await sleep(2000);
  // 4. Llamada real y "colgar" falso con su id (leído del aire)
  click(A.win, A.win.document.getElementById('nexo-call-btn'));
  await wait(() => callState(B) === 'ringing', 20);
  click(B.win, B.win.document.querySelector('#nexo-call-screen .call-accept'));
  r.llamada_real = await wait(() => callState(A) === 'active' && callState(B) === 'active', 15);
  await sleep(1500);
  const air = nA.sent.map((s) => String(s.chunk)).join('');
  const vfs = air.match(/"type":"vf","c":"(cl[a-z0-9]+)"/g) || [];
  const callId = vfs.length ? /"c":"(cl[a-z0-9]+)"/.exec(vfs[vfs.length - 1])[1] : null;
  r.id_en_el_aire = !!callId && callId === (A.win.bleInterface.calls.call || {}).id;
  const t2 = Date.now();
  inject({ v: 1, type: 'chat', from: idA, to: '', ts: t2, seq: 94, msgId: 'csfalso2' + t2, payload: { text: JSON.stringify({ type: 'nexo_call', op: 'end', id: callId, ts: t2 }), senderNexoId: idA, senderName: 'A', timestamp: t2 } });
  await sleep(4000);
  r.sigue_la_llamada = callState(A) === 'active' && callState(B) === 'active';
  click(A.win, A.win.document.querySelector('#nexo-call-screen .call-hangup'));
  await wait(() => !B.win.bleInterface.calls.call, 10);
  await sleep(1500);
  // 5. Lo de verdad sigue llegando
  sendText(A, 'de verdad ' + now);
  r.texto_de_verdad_llega = await wait(() => stored('de verdad ' + now), 20);
  r.errores = logs.filter((l) => / error: /.test(l) && !/JSDOMERROR|styles\.css|Not implemented/.test(l)).slice(0, 5);
  const ok = r.B_suena_llamada_falsa === false && !r.texto_corto_guardado && !r.texto_largo_guardado && !r.mostrado && !r.guardados_por_id.length &&
    r.descartes.corto && r.descartes.largo && r.descartes.foto && r.conexion_de_A_intacta && r.llamada_real && r.id_en_el_aire &&
    r.sigue_la_llamada && r.texto_de_verdad_llega && !r.errores.length;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('SPOOF ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_spoof.txt'), logs.join('\n'));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error(e); fs.writeFileSync(path.join(__dirname, 'last_logs_spoof.txt'), logs.join('\n')); process.exit(1); });
