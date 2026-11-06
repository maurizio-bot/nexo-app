// Archivo GRANDE a un contacto alcanzable por Bluetooth Y por internet (diagnóstico del dueño 06-11): un APK de 25 MB a
// un contacto EN LÍNEA POR INTERNET se iba por BLUETOOTH (partido en 148 550 trozos) y NUNCA llegaba. Causa: el resolvedor
// prefería un Bluetooth listo antes que internet, y el freno de «archivo grande por Bluetooth» solo actuaba con MTU 23
// (este enlace tenía MTU sano). Arreglo: un archivo > tope de Bluetooth prefiere internet/Wi-Fi y NUNCA se arrastra por BT.
// Escenario: A (Wi-Fi) y B (datos móviles, sin Wi-Fi) se emparejan por Bluetooth (enlace vivo, MTU sano) y además están los
// dos en internet (relés). bothWifi(B)=false (B sin Wi-Fi). A manda un archivo de ~2,6 MB (> tope BLE). Debe irse por
// INTERNET (no por Bluetooth), llegar, y NO generar una tromba de escrituras Bluetooth.
// Uso: node bigroute.js <dir_build>
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone, installWebCrypto } = require('./native_mock');
const { NostrRelay } = require('./nostr_relay');

const buildDir = path.resolve(process.argv[2]);
const base = { readsContentFallback: true, retain: ['onPayloadReceived', 'onLanMessage', 'onLanUp', 'onLanDown'], closeOnNoService: true, pace: [15, 15], ioDelay: 25, asymmetric: true, noTor: true };
let RELAYS = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
class DistLoader extends ResourceLoader {
  constructor(dir) { super(); this.dir = dir; }
  fetch(url) { const f = path.join(this.dir, decodeURIComponent(new URL(url).pathname)); return fs.existsSync(f) ? Promise.resolve(fs.readFileSync(f)) : Promise.reject(new Error('no existe ' + f)); }
}
const logs = [];
async function boot(name, native) {
  native.listeners = new Map();
  const vc = new VirtualConsole();
  ['log', 'warn', 'error'].forEach((l) => vc.on(l, (...a) => logs.push(`${new Date().toISOString().substring(14, 23)} [${name}] ${l}: ` + a.map(String).join(' ').substring(0, 250))));
  const dom = new JSDOM(fs.readFileSync(path.join(buildDir, 'dist', 'index.html'), 'utf8'), {
    url: 'https://' + name.toLowerCase() + '.nexo.test/index.html', runScripts: 'dangerously',
    resources: new DistLoader(path.join(buildDir, 'dist')), pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) { win.NEXO_NET_RELAYS = RELAYS; win.CapacitorCustomPlatform = { name: 'android' }; installWebCrypto(win); win.Capacitor = { Plugins: { NexoBLE: native.plugin() } }; win.HTMLElement.prototype.scrollTo = function () {}; },
  });
  const win = dom.window;
  for (let i = 0; i < 100 && !(win.NEXO && win.NEXO.initialized); i++) await sleep(100);
  await sleep(800);
  return { name, native, win, bi: win.bleInterface };
}
const click = (win, el) => el && el.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
async function openChatWith(p, name) {
  const row = Array.from(p.win.document.querySelectorAll('#main-contacts-list .ble-contact-row')).find((r) => (r.querySelector('.ble-contact-name') || {}).textContent === name);
  click(p.win, row); await sleep(500); return !!row;
}
function sendText(p, t) { const i = p.win.document.getElementById('message-input'); i.value = t; i.dispatchEvent(new p.win.Event('input', { bubbles: true })); click(p.win, p.win.document.getElementById('send-btn')); }
async function sendFile(p, name, bytes) {
  const b = Buffer.alloc(bytes); for (let i = 0; i < b.length; i++) b[i] = (i * 31 + name.length * 7) & 255;
  click(p.win, p.win.document.querySelector('.attach-menu-item[data-type="file"]')); await sleep(100);
  const fin = Array.from(p.win.document.querySelectorAll('input[type=file]')).pop();
  Object.defineProperty(fin, 'files', { configurable: true, value: [new p.win.File([b], name, { type: 'application/octet-stream' })] });
  fin.dispatchEvent(new p.win.Event('change'));
  return b;
}
async function addFound(p, name) {
  let add = null;
  const find = () => { const row = Array.from(p.win.document.querySelectorAll('#ble-new-device > div')).find((d) => (d.querySelector('span') || {}).textContent === name); return row && row.querySelector('button'); };
  for (let i = 0; i < 400 && !add; i++) { await sleep(100); add = find(); if (!add && !p.win.bleInterface.isScanning) click(p.win, p.win.document.getElementById('ble-scan-btn')); }
  click(p.win, add); await sleep(2000);
  return !!add;
}
async function waitFor(fn, ms) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return Math.round((Date.now() - t0) / 100) / 10; await sleep(200); } return null; }

(async () => {
  const r1 = new NostrRelay(), r2 = new NostrRelay({ authRequired: true });
  RELAYS = [await r1.start(), await r2.start()];
  const radio = new Radio();
  // A con Wi-Fi; B SIN Wi-Fi (datos móviles) → bothWifi(B) será false, pero los dos llegan por internet (relés).
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', Object.assign({}, base, { wifi: 'casa' }));
  const nB = new NativePhone('B', 'BB:BB:BB:BB:BB:02', Object.assign({}, base, { wifi: null }));
  [nA, nB].forEach((n) => { radio.add(n); n.load(); });
  const A = await boot('A', nA), B = await boot('B', nB);
  const idA = A.bi.localNexoId.toLowerCase(), idB = B.bi.localNexoId.toLowerCase();
  const r = { build: path.basename(buildDir) };

  // Emparejar A y B por Bluetooth (enlace vivo, MTU sano por defecto en el mock) + saludo.
  A.bi.togglePanel(); const paired = await addFound(A, 'B'); A.bi.togglePanel();
  if (!paired) { console.log('BIGROUTE ' + JSON.stringify({ resultado: 'FALLO', error: 'no empareja' })); process.exit(0); }
  await openChatWith(A, 'B'); sendText(A, 'hola B'); await sleep(1500);
  await openChatWith(B, 'A'); sendText(B, 'hola A'); await sleep(1500);
  // Los dos en internet (relés); B sin Wi-Fi → no bothWifi, pero net.canReach(B) sí.
  A.bi.net.tick(); B.bi.net.tick();
  r.en_internet = await waitFor(() => A.bi.net && A.bi.net.canReach(idB) && B.bi.net.canReach(idA), 60000);
  r.ble_vivo = !!(A.bi._bleReadyFor && A.bi._bleReadyFor(idB));           // hay un Bluetooth LISTO con B (el que antes se elegía)
  r.no_bothwifi = !(A.bi.net.bothWifi && A.bi.net.bothWifi(idB));          // B sin Wi-Fi → el resolvedor NO cae en el atajo de bothWifi

  // (1) EL ARREGLO EN EL RESOLVEDOR (determinista): con un Bluetooth LISTO + internet alcanzable + B sin Wi-Fi (no
  //     bothWifi), SIN la pista (como antes) se elige BLUETOOTH; CON la pista de «archivo grande» (preferNet) se elige
  //     INTERNET. Esto es exactamente el bug del dueño (el APK se iba por el Bluetooth listo) y su arreglo.
  const isNet = (d) => typeof d === 'string' && /net/i.test(d);
  var devBle = A.bi._resolveDeviceIdForNexoId(idB, false);
  var devNet = A.bi._resolveDeviceIdForNexoId(idB, true);
  r.sin_preferNet_elige_bluetooth = !isNet(devBle);                        // sin la pista = Bluetooth (el camino viejo que fallaba)
  r.con_preferNet_elige_internet = isNet(devNet);                          // con la pista (archivo grande) = internet (el arreglo)

  // (2) DE PUNTA A PUNTA por el camino ChatStream (el que usó el APK del dueño): un base64 GRANDE (> tope BLE) por
  //     sendFile debe irse por INTERNET (al buzón de los relés, mailboxOk) y NO arrastrarse por Bluetooth, y llegar.
  await openChatWith(A, 'B');
  const bleBefore = nA.sent.length;
  const bigBuf = Buffer.alloc(2500000); for (let i = 0; i < bigBuf.length; i++) bigBuf[i] = (i * 17 + 3) & 255;
  const bigB64 = bigBuf.toString('base64');                                // ~3,33 M chars > 3,1 M (tope BLE)
  // sendFile rechaza al aplazar (el arreglo: «no por Bluetooth»); en la app real send.js lo captura y deja pendiente, y la
  // re-corrida (resumeOutgoingTransfers) lo manda por internet. Acá capturo igual el rechazo y dejo que la re-corrida actúe.
  try { var pBig = A.win.bleInterface.sendFile(idB, 'bigmsg1', bigB64, { type: 'file', to: idB, fileName: 'grande.bin' }); if (pBig && pBig.catch) pBig.catch(function (e) { logs.push('[A] sendFile big rechazado (esperado, aplazado): ' + (e && e.message)); }); } catch (e) { logs.push('[A] sendFile throw: ' + (e && e.message)); }
  const has = async (p, from, f) => (await p.win.vaultLoadMessages(from)).some(f);
  r.grande_llega_s = await waitFor(() => has(B, idA, (m) => !m._own && (m.attachmentPayload === bigB64 || m.msgId === 'bigmsg1')), 180000);
  r.ruteado_por_internet = logs.some((l) => /\[A\]/.test(l) && /sendFile START/.test(l) && /to=net/.test(l) && /type=file/.test(l));
  const bleDelta = nA.sent.length - bleBefore;
  r.escrituras_bluetooth_del_archivo = bleDelta;
  r.sin_tromba_bluetooth = bleDelta < 800;                                 // 2,5 MB por BLE serían miles de escrituras; por internet, casi 0

  r.errores = logs.filter((l) => / error: /.test(l) && !/JSDOMERROR|styles\.css|Not implemented/.test(l)).slice(0, 5);
  const ok = r.en_internet !== null && r.ble_vivo && r.no_bothwifi &&
    r.sin_preferNet_elige_bluetooth && r.con_preferNet_elige_internet &&
    r.grande_llega_s !== null && r.ruteado_por_internet && r.sin_tromba_bluetooth && r.errores.length === 0;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('BIGROUTE ' + JSON.stringify(r));
  if (!ok) console.log(logs.slice(-60).join('\n'));
  fs.writeFileSync(path.join(__dirname, 'last_logs_bigroute.txt'), logs.join('\n'));
  try { await r1.stop(); await r2.stop(); } catch (e) {}
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('BIGROUTE {"resultado":"FALLO","error":"' + String(e && e.message) + '"}'); console.log(logs.slice(-40).join('\n')); fs.writeFileSync(path.join(__dirname, 'last_logs_bigroute.txt'), logs.join('\n')); process.exit(1); });
