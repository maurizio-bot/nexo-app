// Ronda 2804 (auditoría, pruebas destructivas): un teléfono ajeno a alcance Bluetooth escribe en el servidor GATT
// (acepta escrituras de cualquiera, ANTES del cifrado de extremo a extremo) un trozo de archivo/chat con un 'n'
// (número total de trozos) desproporcionado. Con builds anteriores _handleIncomingChunk solo validaba
// total<=0 / idx<0 / idx>=total: aceptaba n=2.000.000.000 y luego _sendBlockAck recorría `for (i<buf.total)`
// ~2.000 millones de veces en el hilo principal (congelación de la interfaz → ANR en Android). Un trozo con idx
// enorme sin búfer previo hacía lo mismo construyendo el array de huecos (L557).
// Debe pasar (con el tope MAX_CHUNKS): el trozo con 'n' desproporcionado se ignora (ni búfer, ni block-ack, ni NACK
// gigante) y un trozo legítimo normal se sigue aceptando.
// Uso: node chunkdos.js <dir_build>
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone, installWebCrypto } = require('./native_mock');

const buildDir = path.resolve(process.argv[2]);
const opts = { readsContentFallback: true, closeOnNoService: true, pace: [15, 15], ioDelay: 25 };
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
  await sleep(500);
  return { name, native, win };
}

(async () => {
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', opts);
  radio.add(nA); nA.load();
  const [A] = await Promise.all([boot('A', nA)]);
  const r = { build: path.basename(buildDir) };

  const ack = A.win.bleInterface && A.win.bleInterface.ackSystem;
  r.hay_acksystem = !!ack;
  if (!ack) { console.log('CHUNKDOS ' + JSON.stringify(r)); process.exit(1); }

  // Espías: neutralizamos los bucles reales (para que la prueba no se congele ni agote memoria) y anotamos el mayor
  // tamaño que CADA operación habría llegado a recorrer. Con el fallo presente, un trozo malicioso dispara estos con
  // millones/miles de millones; con el tope, ni se llaman para lo malicioso.
  const spy = { ackMax: 0, nackMax: 0 };
  ack._sendBlockAck = function (deviceId, msgId, buf) { spy.ackMax = Math.max(spy.ackMax, (buf && buf.total) || 0); };
  ack._sendNack = function (deviceId, msgId, indices) { spy.nackMax = Math.max(spy.nackMax, (indices && indices.length) || 0); };

  const inject = (obj) => ack.processIncomingFragment({ deviceId: 'M', content: JSON.stringify(obj), ts: Date.now() });

  // Vector 1: trozo 0 con 'n' disparatado → ANTES: crea búfer con total=2e9 y agenda un block-ack que recorre 2e9.
  inject({ t: 'f', m: 'dos1', i: 0, n: 2000000000, d: 'x', a: '1' });
  // Vector 2: idx enorme sin búfer previo → ANTES: construye el array de huecos (L557) de millones de elementos.
  inject({ t: 'c', m: 'dos2', i: 4999999, n: 5000000, d: 'x' });
  // Esperamos a que venza el debounce del block-ack (150 ms): si se hubiera agendado, el espía ya lo anotó.
  await sleep(300);

  // Trozo legítimo normal: debe seguir aceptándose (el tope no estorba a un envío real).
  inject({ t: 'c', m: 'ok1', i: 0, n: 3, d: 'aaa', a: 'z' });

  r.dos1_sin_buffer = !ack.incomingBuffers.has('dos1');
  r.dos2_sin_buffer = !ack.incomingBuffers.has('dos2');
  r.sin_blockack_gigante = spy.ackMax < 1000000;   // ANTES: 2.000.000.000
  r.sin_nack_gigante = spy.nackMax < 1000000;       // ANTES: 5.000.000
  r.legitimo_ok = ack.incomingBuffers.has('ok1') && ack.incomingBuffers.get('ok1').total === 3;

  // 2805: mismo tope en el vault (vaultCreateTransfer/vaultAppendChunk, expuestos en window). Un totalChunks
  // disparatado debe rechazarse (null/false) y NO construir un array/cadena de miles de millones (congelación/OOM).
  r.hay_vault = typeof A.win.vaultCreateTransfer === 'function' && typeof A.win.vaultAppendChunk === 'function';
  if (r.hay_vault) {
    r.vault_create_rechaza = (await A.win.vaultCreateTransfer('NXAAAAAAAA', 'dosV1', 'chat', 2000000000, {})) === null;
    r.vault_append_rechaza = (await A.win.vaultAppendChunk('NXAAAAAAAA', 'dosV2', 0, 'x', 2000000000, {})) === false;
    // Y un transfer legítimo pequeño se sigue creando (el tope no estorba).
    var okT = await A.win.vaultCreateTransfer('NXAAAAAAAA', 'okV', 'chat', 3, {});
    r.vault_legitimo_ok = !!okT && okT.totalChunks === 3;
  }

  r.errores = logs.filter((l) => /TypeError|undefined is not|is not a function|RangeError/.test(l)).slice(0, 4);
  const ok = r.hay_acksystem && r.dos1_sin_buffer && r.dos2_sin_buffer && r.sin_blockack_gigante && r.sin_nack_gigante && r.legitimo_ok
    && r.hay_vault && r.vault_create_rechaza && r.vault_append_rechaza && r.vault_legitimo_ok && r.errores.length === 0;
  r.resultado = ok ? 'OK' : 'FAIL';
  console.log('CHUNKDOS ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_chunkdos.txt'), logs.join('\n'));
  process.exit(0);
})().catch((e) => { console.error('FALLO:', e.stack); fs.writeFileSync(path.join(__dirname, 'last_logs_chunkdos.txt'), logs.join('\n')); process.exit(1); });
