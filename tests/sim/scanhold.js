// 3099 (diagnóstico automático S24 3054 14-11 17:48: «busqueda_frenada (48 min sin buscar a 16 contacto(s): transferencia en curso)»;
// el S23 en la 3048 le mandaba algo por Bluetooth a un trozo por segundo y, mientras, el S24 no buscaba a nadie: 14 contactos con
// pendientes esperando a ser vistos; además 46 de esos 48 min la app estaba en segundo plano y el aviso los contaba).
// Un teléfono con una transferencia que nunca acaba (llega un trozo cada segundo) y un contacto perdido:
//  H1  la re-búsqueda se aplaza por la transferencia, pero no para siempre: pasado el tope (aquí 20 s; en el teléfono 3 min) se
//      busca igual una vuelta, y otra tras otro tope (≥ 2 búsquedas en 70 s; antes 0);
//  H2  un hueco de 46 min entre vueltas (la app suspendida en segundo plano) no cuenta como «sin buscar»: ningún aviso de 40 min o
//      más (antes, «48 min sin buscar»).
// Uso: node scanhold.js <dir_build>
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone, installWebCrypto } = require('./native_mock');

const buildDir = path.resolve(process.argv[2]);
const base = { readsContentFallback: true, retain: ['onPayloadReceived'], closeOnNoService: true, pace: [15, 15], ioDelay: 0, asymmetric: true, noTor: true };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
class DL extends ResourceLoader { constructor(d) { super(); this.d = d; } fetch(u) { const f = path.join(this.d, decodeURIComponent(new URL(u).pathname)); return fs.existsSync(f) ? Promise.resolve(fs.readFileSync(f)) : Promise.reject(new Error('no existe ' + f)); } }
const logs = [];
(async () => {
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', base);
  radio.add(nA); nA.load();
  const vc = new VirtualConsole();
  ['log', 'warn', 'error'].forEach((l) => vc.on(l, (...a) => logs.push(`${new Date().toISOString().substring(14, 23)} [A] ${l}: ` + a.map(String).join(' ').substring(0, 250))));
  const dom = new JSDOM(fs.readFileSync(path.join(buildDir, 'dist', 'index.html'), 'utf8'), {
    url: 'https://a.nexo.test/index.html', runScripts: 'dangerously', resources: new DL(path.join(buildDir, 'dist')), pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) {
      win.NEXO_NET_RELAYS = []; win.CapacitorCustomPlatform = { name: 'android' }; installWebCrypto(win);
      win.NEXO_SCAN_HOLD_MAX_MS = 20000; // el tope (3 min en el teléfono) más corto para la prueba
      win.Capacitor = { Plugins: { NexoBLE: nA.plugin() } }; win.HTMLElement.prototype.scrollTo = function () {};
    },
  });
  const win = dom.window;
  for (let i = 0; i < 100 && !(win.NEXO && win.NEXO.initialized); i++) await sleep(100);
  await sleep(1500);
  const bi = win.bleInterface;
  const r = { prueba: 'scanhold', build: path.basename(buildDir) };
  const symptoms = [];
  win.addEventListener('nexo:diag:symptom', (e) => symptoms.push(e.detail || {}));
  // una transferencia que llega y no acaba: un trozo cada segundo (como el S23 a la 3048)
  const buf = { isChat: false, meta: { type: 'video' }, deviceId: 'BB:BB:BB:BB:BB:02', lastActivity: Date.now(), total: 8000, received: 0 };
  bi.ackSystem.incomingBuffers.set('fx_lento', buf);
  const feed = setInterval(() => { buf.lastActivity = Date.now(); buf.received++; }, 1000);
  let searches = 0;
  const orig = bi._autoScanForKnownContacts.bind(bi);
  bi._autoScanForKnownContacts = function (o) { searches++; return orig(o); };
  r.transferencia_vista = bi._transferActive(true);
  // un contacto perdido (como los 14 del S24 con pendientes)
  bi._markPeerLost('nx0perdid1');
  const k = logs.length;
  await sleep(70000);
  r.H1_aplazadas = logs.slice(k).filter((l) => /Re-búsqueda aplazada/.test(l)).length;
  r.H1_busquedas = searches;
  // H2: la app estuvo suspendida 46 min (sin vueltas) con la búsqueda aplazada desde hacía 48
  const s0 = symptoms.length;
  bi._scanHeldSince = Date.now() - 48 * 60000; bi._scanHeldLastAt = Date.now() - 46 * 60000; bi._scanHeldSaid = false;
  await sleep(20000);
  const nuevos = symptoms.slice(s0).filter((s) => s.kind === 'busqueda_frenada');
  r.H2_avisos = nuevos.map((s) => s.info);
  r.H2_aviso_largo = nuevos.some((s) => { const m = /^(\d+) min/.exec(String(s.info || '')); return m && Number(m[1]) >= 40; });
  clearInterval(feed);
  r.errores = logs.filter((l) => / error: /.test(l) && !/JSDOMERROR|styles\.css|Not implemented|net::ERR|fetch/.test(l)).slice(0, 5);
  const ok = r.transferencia_vista && r.H1_aplazadas >= 1 && r.H1_busquedas >= 2 && !r.H2_aviso_largo && !r.errores.length;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('SCANHOLD ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_scanhold.txt'), logs.join('\n'));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('SCANHOLD ' + JSON.stringify({ prueba: 'scanhold', resultado: 'FALLO', error: String(e && e.message) })); console.error(e); process.exit(1); });
