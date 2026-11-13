// Diagnóstico del dueño 13-11 (S24 APK 3030 con el Vivo …db61, 19:03–19:45): los textos al Vivo fallaban por Bluetooth una y
// otra vez («BT listo», ACK timeout 5/5) y el vigilante del enlace se saltó la comprobación TODO el rato («Supervisor:
// transferencia activa, skip ping/zombie para 45:73:F7:57:C2:3C» cada 6 s). Causa: un texto largo pendiente se reanudaba cada
// 10–30 s («START msgId=… lfor1cma» a las 19:44:13, :45, :56, 19:45:14…) y cada flujo nuevo trae su propia hora de inicio:
// hasActiveTransfer («> 20 s sin NINGÚN ACK ya no protege», 2973) contaba desde ESE inicio, así que nunca llegaba a 20 s.
// Arreglo: además del flujo, cuenta cuándo se oyó por última vez CUALQUIER cosa de ese teléfono: si lleva > 20 s callado, un
// flujo recién (re)empezado no protege el enlace → el vigilante pinga (y, sin respuesta, lo rehace).
// Prueba (un teléfono, en jsdom): flujos y «última vez oído» puestos a mano sobre el sistema de confirmaciones real.
// Uso: node xferstuck.js <dir_build>
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone, installWebCrypto } = require('./native_mock');

const buildDir = path.resolve(process.argv[2] || path.join(__dirname, 'builds/wip'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
class DL extends ResourceLoader { constructor(d) { super(); this.d = d; } fetch(u) { const f = path.join(this.d, decodeURIComponent(new URL(u).pathname)); return fs.existsSync(f) ? Promise.resolve(fs.readFileSync(f)) : Promise.reject(new Error('x')); } }
const logs = [];
(async () => {
  const r = { prueba: 'xferstuck', build: path.basename(buildDir) };
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', { readsContentFallback: true, retain: ['onPayloadReceived'] });
  radio.add(nA); nA.load();
  const vc = new VirtualConsole();
  ['log', 'warn', 'error'].forEach((l) => vc.on(l, (...a) => logs.push(`[A] ${l}: ` + a.map(String).join(' ').substring(0, 200))));
  const dom = new JSDOM(fs.readFileSync(path.join(buildDir, 'dist', 'index.html'), 'utf8'), {
    url: 'https://a.nexo.test/index.html', runScripts: 'dangerously', resources: new DL(path.join(buildDir, 'dist')), pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) { win.CapacitorCustomPlatform = { name: 'android' }; installWebCrypto(win); win.Capacitor = { Plugins: { NexoBLE: nA.plugin() } }; win.HTMLElement.prototype.scrollTo = function () {}; },
  });
  const win = dom.window;
  for (let i = 0; i < 100 && !(win.NEXO && win.NEXO.initialized); i++) await sleep(100);
  await sleep(500);
  const bi = win.bleInterface, ack = bi.ackSystem;
  const MAC = '45:73:F7:57:C2:3C', now = Date.now();
  const stream = (id, startAgo, ackAgo) => ({ deviceId: MAC, startTime: now - startAgo, lastAckAt: ackAgo == null ? 0 : now - ackAgo, aborted: false, abort() {} });
  const busy = (streams, heardAgo) => {
    ack.outgoingStreams.clear(); ack.incomingBuffers.clear();
    streams.forEach((s, i) => ack.outgoingStreams.set('m' + i, s));
    bi._lastPongTime.clear();
    if (heardAgo != null) bi._lastPongTime.set(MAC, now - heardAgo);
    const v = ack.hasActiveTransfer(MAC);
    ack.outgoingStreams.clear();
    return v;
  };
  // 1. el caso del Vivo: nada oído de él hace 60 s; el texto largo acaba de reanudarse (flujo nuevo de 2 s, sin ACK) → NO protege
  r.reanudado_callado = busy([stream('a', 2000, null)], 60000);
  // 2. enlace sano: se le oyó hace 3 s y el flujo empezó hace 2 s → protege
  r.nuevo_oido = busy([stream('a', 2000, null)], 3000);
  // 3. flujo con ACK hace 5 s → protege
  r.con_ack = busy([stream('a', 30000, 5000)], 5000);
  // 4. enlace recién hecho del que aún no se oyó nada (sin registro) y flujo de 2 s → protege (como antes)
  r.sin_registro = busy([stream('a', 2000, null)], null);
  // 5. flujo atascado de siempre (> 20 s sin ACK) → no protege (2973)
  r.atascado = busy([stream('a', 25000, null)], 25000);
  r.errores = logs.filter((l) => / error: /.test(l) && !/JSDOMERROR|styles\.css|Not implemented/.test(l)).slice(0, 5);
  const ok = r.reanudado_callado === false && r.nuevo_oido === true && r.con_ack === true && r.sin_registro === true && r.atascado === false && !r.errores.length;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('XFERSTUCK ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_xferstuck.txt'), logs.join('\n'));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('XFERSTUCK ' + JSON.stringify({ prueba: 'xferstuck', resultado: 'FALLO', error: String(e && e.message) })); process.exit(1); });
