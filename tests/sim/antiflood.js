// Anti-automatización / anti-IA (#dueño 07-11, plan de seguridad): hasta hoy NO había ningún freno a una INUNDACIÓN de
// solicitudes de contacto por internet. Como el NEXO ID es semi-público, una IA/bot podía dejar miles de solicitudes en el
// buzón de una víctima a velocidad de máquina → buzón lleno de basura + spam de avisos. Arreglo (ble_links.js `_reqFlood`,
// llamado al tope de `_onNetRequest`): dos topes, por ORIGEN (una cada REQ_MIN_MS) y GLOBAL (máx REQ_MAX por ventana), muy
// por encima del uso legítimo (unas pocas al día) y muy por debajo de un flood; una 'acc' a una solicitud MÍA saliente
// queda EXENTA del tope global. Solo descarta el exceso: no toca claves ni cifrado (lo prueba `reqadd.js`, que sigue verde).
// Esta prueba: (1) una inundación se corta en el tope global; (2) el mismo origen martillando se throttlea; (3) una
// solicitud legítima aislada pasa; (4) la 'acc' a una solicitud mía saliente no la frena el tope global. Uso: node antiflood.js
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone, installWebCrypto } = require('./native_mock');

const buildDir = path.resolve(process.argv[2]);
const base = { readsContentFallback: true, retain: ['onPayloadReceived'], closeOnNoService: true, pace: [15, 15], ioDelay: 25, noTor: true };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
class DistLoader extends ResourceLoader {
  constructor(dir) { super(); this.dir = dir; }
  fetch(url) { const f = path.join(this.dir, decodeURIComponent(new URL(url).pathname)); return fs.existsSync(f) ? Promise.resolve(fs.readFileSync(f)) : Promise.reject(new Error('no existe ' + f)); }
}
const logs = [];
async function boot(name, native) {
  native.listeners = new Map();
  const vc = new VirtualConsole();
  ['log', 'warn', 'error'].forEach((l) => vc.on(l, (...a) => logs.push(`[${name}] ${l}: ` + a.map(String).join(' ').substring(0, 200))));
  const dom = new JSDOM(fs.readFileSync(path.join(buildDir, 'dist', 'index.html'), 'utf8'), {
    url: 'https://' + name.toLowerCase() + '.nexo.test/index.html', runScripts: 'dangerously',
    resources: new DistLoader(path.join(buildDir, 'dist')), pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) { win.NEXO_NET_RELAYS = []; win.CapacitorCustomPlatform = { name: 'android' }; installWebCrypto(win); win.Capacitor = { Plugins: { NexoBLE: native.plugin() } }; win.HTMLElement.prototype.scrollTo = function () {}; },
  });
  const win = dom.window;
  for (let i = 0; i < 100 && !(win.NEXO && win.NEXO.initialized); i++) await sleep(100);
  await sleep(600);
  return { name, native, win, bi: win.bleInterface };
}
const pk88 = 'A'.repeat(88);                                   // base64 válido (relleno; para 'req' no se usa en cripto)
const idN = (i) => 'nx' + ('0000000' + i.toString(36)).slice(-8);

(async () => {
  const r = { prueba: 'antiflood' };
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', Object.assign({}, base, { wifi: 'casa' }));
  radio.add(nA); nA.load();
  const A = await boot('A', nA);
  const bi = A.bi;
  if (!bi || typeof bi._onNetRequest !== 'function' || typeof bi._reqFlood !== 'function') {
    console.log('ANTIFLOOD ' + JSON.stringify({ resultado: 'FALLO', error: 'sin _onNetRequest/_reqFlood' })); process.exit(1);
  }
  const reset = () => { bi._reqSeen = new Map(); bi._reqWin = []; };
  const setCfg = (c) => { A.win.NEXO_REQ_FLOOD = c; };
  const inboxLen = () => bi.pendingRequests().length;

  // (1) INUNDACIÓN cortada por el tope global: min:0 (el throttle por origen no estorba), max:5 → de 30 solicitudes de
  //     orígenes distintos, solo 5 entran al buzón. (Antes: las 30, sin límite.)
  try { A.win.localStorage.setItem('nexo_req_in', '[]'); } catch (e) {}
  reset(); setCfg({ min: 0, win: 999999, max: 5 });
  for (let i = 0; i < 30; i++) bi._onNetRequest({ id: idN(i), pk: pk88, name: 'bot' + i, kind: 'req' });
  r.flood_entraron = inboxLen();
  r.flood_cortado = r.flood_entraron === 5;

  // (2) MISMO ORIGEN martillando: min enorme → solo el primero pasa, el resto se descarta (tope global alto para aislar).
  reset(); setCfg({ min: 999999, win: 999999, max: 1000 });
  const mism = idN(100);
  const paso1 = bi._reqFlood(mism, false), paso2 = bi._reqFlood(mism, false), paso3 = bi._reqFlood(mism, false);
  r.origen_primero_pasa = paso1 === true;
  r.origen_repeticion_frenada = paso2 === false && paso3 === false;

  // (3) Solicitud LEGÍTIMA aislada (umbrales por defecto): pasa. No rompemos el uso normal.
  reset(); setCfg(undefined);
  r.legitima_pasa = bi._reqFlood(idN(200), false) === true;

  // (4) Una 'acc' a MI solicitud saliente queda EXENTA del tope global: con max:0 (todo lo nuevo bloqueado), lo normal se
  //     descarta pero la 'acc' que YO inicié pasa igual (exemptGlobal=true). Así aceptar lo que pediste nunca se frena.
  reset(); setCfg({ min: 0, win: 999999, max: 0 });
  r.acc_normal_bloqueado = bi._reqFlood(idN(300), false) === false;   // nuevo normal: bloqueado por el tope 0
  r.acc_mia_exenta = bi._reqFlood(idN(301), true) === true;           // 'acc' a solicitud mía: pasa igual

  const ok = r.flood_cortado && r.origen_primero_pasa && r.origen_repeticion_frenada &&
    r.legitima_pasa && r.acc_normal_bloqueado && r.acc_mia_exenta;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('ANTIFLOOD ' + JSON.stringify(r));
  if (!ok) { fs.writeFileSync(path.join(__dirname, 'last_logs_antiflood.txt'), logs.join('\n')); console.log(logs.slice(-25).join('\n')); }
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('ANTIFLOOD {"resultado":"FALLO","error":"' + String(e && e.message) + '"}'); console.log(logs.slice(-25).join('\n')); process.exit(1); });
