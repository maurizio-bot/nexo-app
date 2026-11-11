// 3003 (diagnóstico automático del S24, build 3001, 11-11 03:42 UTC): la app ARRANCÓ TRES VECES en un minuto (21:41:28, 21:42:04 y
// 21:42:20 hora local) con un APK de 25 MB pendiente para tres contactos de internet. El registro muestra bloques de «Resume: N outgoing
// para …» (uno por contacto, 21 contactos) repetidos cada ~1 s y, tras cada uno, una lectura de ~450–750 ms de nexo_vault_outgoing_v2:
// cada «Reenviando pending para X» (ble_messages) y cada evento de enlace llamaba a resumeOutgoingTransfers(), que recorre TODOS los
// contactos leyendo el almacén de transferencias (que guarda los trozos base64 de los archivos grandes). Con N contactos reenviando
// a la vez eran N × 21 lecturas de cientos de MB en segundos → la memoria del WebView y reinicio. 2995 ya puso el reenvío de adjuntos
// grandes «de a uno», pero no esta tormenta de escaneos. 3003: resumeOutgoingTransfers se junta (coalesce): como mucho un escaneo en
// vuelo y uno más pendiente (al final, con un mínimo de espera entre escaneos).
// Prueba: un teléfono con 21 contactos falsos; se llama 12 veces seguidas a resumeOutgoingTransfers (una ráfaga de eventos de enlace)
// y se cuentan las lecturas del almacén. Antes: 12 × 21 = 252 lecturas. Ahora: ≤ 2 escaneos (≤ 42) y el último escaneo sí ocurre.
// Uso: node resumescan.js <dir_build>
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone, installWebCrypto } = require('./native_mock');

const buildDir = path.resolve(process.argv[2]);
const base = { readsContentFallback: true, retain: ['onPayloadReceived'], closeOnNoService: true, pace: [15, 15], ioDelay: 25, asymmetric: true, noL2: true, noTor: true };
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

(async () => {
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', Object.assign({}, base));
  radio.add(nA); nA.load();
  const A = await boot('A', nA);
  const bi = A.win.bleInterface, AS = bi.ackSystem;
  const r = { prueba: 'resumescan', build: path.basename(buildDir) };

  // 21 contactos falsos y un almacén de transferencias que cuenta cuántas veces se lee
  const fakes = []; for (let i = 0; i < 21; i++) fakes.push({ nexoId: 'nx0' + String(i).padStart(8, '0').slice(-8), deviceId: 'net:nx0' + String(i).padStart(8, '0').slice(-8) });
  bi.getBLEContacts = () => fakes;
  let reads = 0;
  A.win.vaultGetPendingOutgoingTransfers = () => { reads++; return Promise.resolve([]); };

  // una ráfaga de 12 llamadas seguidas (eventos de enlace + «Reenviando pending» de 12 contactos)
  for (let i = 0; i < 12; i++) AS.resumeOutgoingTransfers();
  await sleep(300);
  r.lecturas_en_rafaga = reads;                  // antes: 252
  r.escaneos_en_rafaga = Math.ceil(reads / 21);
  // el escaneo pendiente (el último) sí debe ocurrir, pero espaciado: dentro de ~4 s ya ocurrió
  await sleep(4000);
  r.lecturas_totales = reads;
  r.escaneos_totales = Math.ceil(reads / 21);
  // y una llamada suelta mucho después sigue funcionando (no se queda bloqueada)
  const antes = reads;
  await sleep(2500);
  AS.resumeOutgoingTransfers();
  await sleep(500);
  r.llamada_suelta_escanea = reads - antes >= 21;

  r.errores = logs.filter((l) => / error: /.test(l) && !/JSDOMERROR|styles\.css|Not implemented|GLOBAL TIMEOUT|net::ERR|fetch/.test(l)).slice(0, 5);
  const ok = r.escaneos_en_rafaga <= 2 && r.escaneos_totales >= 2 && r.escaneos_totales <= 3 && r.llamada_suelta_escanea && !r.errores.length;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('RESUMESCAN ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_resumescan.txt'), logs.join('\n'));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('RESUMESCAN ' + JSON.stringify({ prueba: 'resumescan', resultado: 'FALLO', error: String(e && e.message).replace(/"/g, "'") })); console.error(e && e.stack); process.exit(1); });
