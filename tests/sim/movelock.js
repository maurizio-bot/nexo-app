// C-N6 (auditoría 23-11): «Pasar mi cuenta» con el bloqueo de NEXO puesto pide la huella/PIN (un «Aceptar» no basta), y los ganchos
// de prueba window.NEXO_moveSendTo / NEXO_moveReceive solo existen en compilaciones de desarrollo (sin número de build).
//  (1) bloqueo puesto + huella cancelada: no se abre el lector del código; (2) con la huella: sí; (3) sin bloqueo: solo «Aceptar»;
//  (4) APK con número (como la del CI): sin ganchos; desarrollo: con ganchos.
// Uso: node movelock.js <dir_build>
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone, installWebCrypto } = require('./native_mock');

const buildDir = path.resolve(process.argv[2]);
const base = { readsContentFallback: true, retain: ['onPayloadReceived'], closeOnNoService: true, pace: [15, 15], ioDelay: 25, asymmetric: true, noTor: true };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
class DL extends ResourceLoader { constructor(d) { super(); this.d = d; } fetch(u) { const f = path.join(this.d, decodeURIComponent(new URL(u).pathname)); return fs.existsSync(f) ? Promise.resolve(fs.readFileSync(f)) : Promise.reject(new Error('no existe ' + f)); } }
const logs = [];
const click = (w, el) => el && el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));

async function phone(name, build, lock) {
  const radio = new Radio();
  const n = new NativePhone(name, 'AA:AA:AA:AA:AA:0' + name.length, base);
  radio.add(n); n.load();
  if (lock) n.files.set('nexo_security.json', JSON.stringify({ v: 1, lock: true, lockAfterMs: 1800000, secure: false, faceFast: false }));
  const vc = new VirtualConsole();
  ['log', 'warn', 'error'].forEach((l) => vc.on(l, (...a) => logs.push(`[${name}] ${l}: ` + a.map(String).join(' ').substring(0, 250))));
  let html = fs.readFileSync(path.join(buildDir, 'dist', 'index.html'), 'utf8');
  if (build) html = html.replace(/__NEXO_BUILD__/g, build);
  const dom = new JSDOM(html, {
    url: 'https://' + name.toLowerCase() + '.nexo.test/index.html', runScripts: 'dangerously', resources: new DL(path.join(buildDir, 'dist')), pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) {
      win.CapacitorCustomPlatform = { name: 'android' }; installWebCrypto(win);
      const pl = n.plugin(); pl.updateCheck = async () => ({});
      win.Capacitor = { Plugins: { NexoBLE: pl } }; win.HTMLElement.prototype.scrollTo = function () {}; win.confirm = () => true;
    },
  });
  const win = dom.window;
  for (let i = 0; i < 100 && !(win.NEXO && win.NEXO.initialized); i++) await sleep(100);
  await sleep(1500);
  return { n, win };
}
async function tapSend(p) {
  const qr = p.win.document.getElementById('qr-scan-overlay'); if (qr) qr.remove();
  p.win.dispatchEvent(new p.win.CustomEvent('nexo:ui:settings')); await sleep(500);
  let b = p.win.document.getElementById('nexo-move-send');
  if (!b) { p.win.dispatchEvent(new p.win.CustomEvent('nexo:ui:profile')); await sleep(400); click(p.win, p.win.document.getElementById('nexo-open-settings')); await sleep(400); b = p.win.document.getElementById('nexo-move-send'); }
  if (!b) return null;
  click(p.win, b); await sleep(800);
  return !!p.win.document.getElementById('qr-scan-overlay');
}

(async () => {
  const r = { prueba: 'movelock', build: path.basename(buildDir) };
  // Con bloqueo (desarrollo)
  const A = await phone('A', null, true);
  r.A_desbloqueada = !A.win.document.getElementById('nexo-lock');
  const b0 = A.n.stats.bioAsked || 0;
  A.n.bioAnswer = false;
  const sinHuella = await tapSend(A);
  r.boton = sinHuella !== null;
  r.sin_huella_no_sigue = sinHuella === false && (A.n.stats.bioAsked || 0) === b0 + 1;
  A.n.bioAnswer = true;
  r.con_huella_sigue = (await tapSend(A)) === true && (A.n.stats.bioAsked || 0) === b0 + 2;
  r.dev_con_ganchos = typeof A.win.NEXO_moveSendTo === 'function' && typeof A.win.NEXO_moveReceive === 'function';
  A.win.close();
  // Sin bloqueo y con número de build (como la APK del CI)
  const C = await phone('CI', '3300', false);
  const bc = C.n.stats.bioAsked || 0;
  r.sin_bloqueo_solo_aceptar = (await tapSend(C)) === true && (C.n.stats.bioAsked || 0) === bc;
  r.apk_sin_ganchos = C.win.NEXO_BUILD === '3300' && C.win.NEXO_moveSendTo === undefined && C.win.NEXO_moveReceive === undefined;
  C.win.close();

  r.errores = logs.filter((l) => / error: /.test(l) && !/JSDOMERROR|styles\.css|Not implemented|net::ERR|fetch|getUserMedia|mediaDevices/.test(l)).slice(0, 5);
  const ok = r.A_desbloqueada && r.boton && r.sin_huella_no_sigue && r.con_huella_sigue && r.dev_con_ganchos && r.sin_bloqueo_solo_aceptar && r.apk_sin_ganchos && r.errores.length === 0;
  r.resultado = ok ? 'OK' : 'FAIL';
  console.log('MOVELOCK ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_movelock.txt'), logs.join('\n'));
  process.exit(0);
})().catch((e) => { console.error('FALLO:', e.stack); fs.writeFileSync(path.join(__dirname, 'last_logs_movelock.txt'), logs.join('\n')); process.exit(1); });
