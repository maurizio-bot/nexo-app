// #dueño 02-11 (fluidez, máxima prioridad): «los chats con el tiempo tardan más en cargar». Al abrir en frío,
// vaultLoadMessages leía+descifraba+parseaba el archivo ENTERO (hasta 2000 msg) → lento. Arreglo (2888): archivo de
// COLA pequeño (últimos TAIL_N=80); al abrir se lee ESE (rápido) y el completo se carga perezosamente. El archivo
// completo sigue siendo la FUENTE DE VERDAD intacta (la cola es solo caché aditiva).
//
// Esta prueba guarda 300 mensajes, REINICIA la app (caché en frío, archivos persisten en el teléfono simulado) y
// comprueba: (1) la apertura en frío lee SOLO la cola (≤80, no los 300); (2) CRÍTICO — no se pierde historial: tras
// leer la cola en frío y ENVIAR un mensaje, el disco conserva los 301 (no se trunca a la cola); (3) la cola en disco
// queda con los últimos 80 incluyendo el nuevo.
// Uso: node chatlento.js <dir_build>
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone } = require('./native_mock');

const buildDir = path.resolve(process.argv[2]);
const opts = { readsContentFallback: true, retain: ['onPayloadReceived'], closeOnNoService: true, pace: [15, 15], ioDelay: 10, noL2: true };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
class DL extends ResourceLoader { constructor(d) { super(); this.d = d; } fetch(u) { const f = path.join(this.d, decodeURIComponent(new URL(u).pathname)); return fs.existsSync(f) ? Promise.resolve(fs.readFileSync(f)) : Promise.reject(new Error('x')); } }
const logs = [];
async function boot(name, native) {
  const vc = new VirtualConsole();
  ['log', 'warn', 'error'].forEach((l) => vc.on(l, (...a) => logs.push(`[${name}] ${l}: ` + a.map(String).join(' ').substring(0, 200))));
  const dom = new JSDOM(fs.readFileSync(path.join(buildDir, 'dist', 'index.html'), 'utf8'), {
    url: 'https://' + name.toLowerCase() + '.nexo.test/index.html', runScripts: 'dangerously', resources: new DL(path.join(buildDir, 'dist')), pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) { win.CapacitorCustomPlatform = { name: 'android' }; require('./native_mock').installWebCrypto(win); win.Capacitor = { Plugins: { NexoBLE: native.plugin() } }; win.HTMLElement.prototype.scrollTo = function () {}; },
  });
  const win = dom.window;
  for (let i = 0; i < 100 && !(win.NEXO && win.NEXO.initialized); i++) await sleep(100);
  await sleep(500);
  return { dom, win };
}

(async () => {
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', opts);
  radio.add(nA); nA.load();
  const r = { build: path.basename(buildDir) };
  const cid = 'nx7777a8b8';
  const N = 300, BASE = 1700000000000;

  // ---- Arranque 1: guardar 300 mensajes (escribe el archivo completo + la cola) ----
  const A1 = await boot('A1', nA);
  if (typeof A1.win.vaultSaveMessages !== 'function') { console.log('CHATLENTO ' + JSON.stringify(Object.assign(r, { resultado: 'FALLO', why: 'sin vaultSaveMessages' }))); process.exit(1); }
  const msgs = [];
  for (let i = 0; i < N; i++) msgs.push({ msgId: 'm' + i, messageId: 'm' + i, text: 'hola ' + i, timestamp: BASE + i, direction: i % 2 ? 'out' : 'in', status: 'delivered' });
  await A1.win.vaultSaveMessages(cid, msgs);
  await sleep(300); // que drene la escritura de la cola
  r.tiene_vaultLoadRecent = typeof A1.win.vaultLoadRecent === 'function';
  A1.win.close(); // cerrar la ventana: la próxima arranca con caché EN FRÍO (los archivos persisten en nA)
  await sleep(200);

  // ---- Arranque 2: apertura EN FRÍO ----
  const A2 = await boot('A2', nA);

  // (1) Lectura en frío de la cola: aunque pida 200, solo puede devolver la cola (≤80), NO los 300 → leyó el archivo
  //     de cola, no el completo.
  const recent = await A2.win.vaultLoadRecent(cid, 200);
  r.recent_len = Array.isArray(recent) ? recent.length : -1;
  r.recent_es_cola = Array.isArray(recent) && recent.length === 80;                 // TAIL_N
  r.recent_ultimo_m299 = Array.isArray(recent) && recent[recent.length - 1] && recent[recent.length - 1].msgId === 'm299';
  r.recent_primero_m220 = Array.isArray(recent) && recent[0] && recent[0].msgId === 'm220'; // últimos 80: m220..m299

  // (2) CRÍTICO (sin pérdida): la caché sigue en frío (vaultLoadRecent NO cachea). Al ENVIAR un mensaje, el append
  //     debe cargar el historial COMPLETO primero y NO truncar a la cola.
  await A2.win.vaultAppendMessage(cid, { msgId: 'm_nuevo', messageId: 'm_nuevo', text: 'mensaje nuevo', timestamp: BASE + 100000, direction: 'out', status: 'sent' });
  await sleep(300);
  const full = await A2.win.vaultLoadMessages(cid);
  r.full_len = Array.isArray(full) ? full.length : -1;
  r.full_301 = Array.isArray(full) && full.length === N + 1;                         // 300 + 1, NO 81
  r.full_conserva_m0 = Array.isArray(full) && full.some((m) => m.msgId === 'm0');    // el más viejo sigue
  r.full_tiene_nuevo = Array.isArray(full) && full.some((m) => m.msgId === 'm_nuevo');

  // (3) En DISCO (nA.files): el completo tiene 301 y la cola 80 (últimos, con el nuevo) — leer directo del teléfono.
  let fullDisk = -1, tailDisk = -1, tailUltimo = null;
  for (const [k, v] of nA.files) {
    if (new RegExp(cid + '\\.json$').test(k) && !/\.tail\.json$/.test(k)) { try { fullDisk = JSON.parse(v).messages.length; } catch (e) {} }
    if (new RegExp(cid + '\\.tail\\.json$').test(k)) { try { const mm = JSON.parse(v).messages; tailDisk = mm.length; tailUltimo = mm[mm.length - 1] && mm[mm.length - 1].msgId; } catch (e) {} }
  }
  r.disco_completo_301 = fullDisk === N + 1;
  r.disco_cola_80 = tailDisk === 80;
  r.disco_cola_ultimo_nuevo = tailUltimo === 'm_nuevo';
  A2.win.close();

  r.errores = logs.filter((l) => / error: /.test(l) && !/JSDOMERROR|styles\.css|Not implemented/.test(l)).slice(0, 5);
  const ok = r.tiene_vaultLoadRecent && r.recent_es_cola && r.recent_ultimo_m299 && r.recent_primero_m220 &&
             r.full_301 && r.full_conserva_m0 && r.full_tiene_nuevo &&
             r.disco_completo_301 && r.disco_cola_80 && r.disco_cola_ultimo_nuevo && !r.errores.length;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('CHATLENTO ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_chatlento.txt'), logs.join('\n'));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error(e); fs.writeFileSync(path.join(__dirname, 'last_logs_chatlento.txt'), logs.join('\n')); process.exit(1); });
