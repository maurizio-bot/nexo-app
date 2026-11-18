// 3214 (diagnóstico de Roberto, Motorola edge 40 neo, 17-11 14:48): tras apagar y encender el Bluetooth, el primer envío de cada
// enlace nuevo devolvía MTU 23 (aún sin negociar) → «W [MTU] … 23 (mínimo: Bluetooth muy lento con este teléfono)» y a los ~3 s
// «[MTU] … 517». El aviso era ruido en el diagnóstico. Ahora solo se avisa si a los 4 s el enlace SIGUE en 23 (el valor se anota
// al momento como antes: las decisiones de camino no cambian).
// Se reproduce la secuencia que devuelve sendMessage nativo (mtu de cada envío) con _noteMtu, como hace ble_send.
// Uso: node mtuaviso.js <dir_build>
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone, installWebCrypto } = require('./native_mock');

const buildDir = path.resolve(process.argv[2]);
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
const lowWarns = (mac, from) => logs.slice(from).filter((l) => /warn: \[MTU\]/.test(l) && l.toLowerCase().includes(mac.replace(/:/g, '').toLowerCase()) && /: 23 \(mínimo/.test(l)).length;

(async () => {
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', {});
  radio.add(nA); nA.load();
  const A = await boot('A', nA);
  const bi = A.win.bleInterface;
  const r = { prueba: 'mtuaviso', build: path.basename(buildDir) };
  if (!bi || typeof bi._noteMtu !== 'function') { r.resultado = 'FALLO'; r.error = 'sin _noteMtu'; console.log('MTUAVISO ' + JSON.stringify(r)); process.exit(0); }

  // M1: enlace nuevo: 23 en el primer envío y 517 a los 3 s (lo de Roberto) → ningún aviso de «muy lento»
  const d1 = '11:22:33:44:55:01';
  let mark = logs.length;
  bi._noteMtu(d1, 23);
  r.M1_anotado_al_momento = bi._mtuByDevice.get('112233445501');
  await sleep(3000);
  bi._noteMtu(d1, 517);
  await sleep(4500);
  r.M1_avisos_23 = lowWarns(d1, mark);
  r.M1_mtu_final = bi._mtuByDevice.get('112233445501');

  // M2: enlace que de verdad se queda en 23 (varios envíos a 23) → UN aviso, a los ~4 s
  const d2 = '11:22:33:44:55:02';
  mark = logs.length;
  bi._noteMtu(d2, 23);
  await sleep(1000); bi._noteMtu(d2, 23);
  await sleep(1000);
  r.M2_avisos_a_los_2s = lowWarns(d2, mark);
  await sleep(3500);
  r.M2_avisos_23 = lowWarns(d2, mark);

  // M3: enlace que iba a 512 y se rehace (se despertó el otro): 23 un momento y vuelve a 512 → sin aviso
  const d3 = '11:22:33:44:55:03';
  bi._noteMtu(d3, 512);
  mark = logs.length;
  bi._noteMtu(d3, 23);
  await sleep(1500);
  bi._noteMtu(d3, 512);
  await sleep(4500);
  r.M3_avisos_23 = lowWarns(d3, mark);

  r.errores = logs.filter((l) => /TypeError|undefined is not/.test(l)).slice(0, 4);
  const ok = r.M1_anotado_al_momento === 23 && r.M1_avisos_23 === 0 && r.M1_mtu_final === 517 &&
    r.M2_avisos_a_los_2s === 0 && r.M2_avisos_23 === 1 && r.M3_avisos_23 === 0 && r.errores.length === 0;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('MTUAVISO ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_mtuaviso.txt'), logs.join('\n'));
  process.exit(0);
})().catch((e) => { console.error('FALLO:', e.stack); fs.writeFileSync(path.join(__dirname, 'last_logs_mtuaviso.txt'), logs.join('\n')); process.exit(1); });
