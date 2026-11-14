// 3082 (pendiente del realme 13-11, Bluetooth apagado; dueño 14-11: «el Bluetooth es la emergencia»). El aviso nativo de Bluetooth
// apagado/encendido (onBluetoothStateChanged) no tenía quien lo escuchara en la app y la respuesta de isBluetoothEnabled al
// arrancar no se usaba: la app solo se enteraba cuando fallaba un escaneo, y tras volver a encenderlo seguía sin buscar hasta 60 s.
// (btoff.js cubre la otra parte: con el Bluetooth apagado no se busca en bucle ni se da ningún «zombi».) A y B emparejados por
// Bluetooth y en internet; se cierra A, se le apaga el Bluetooth y se corta el internet; se abre A, manda un texto y un archivo de
// 60 KB, y a los 3 s vuelve el internet:
//  B1  la app sabe que el Bluetooth está apagado en ≤ 2 s tras abrir (registro «Bluetooth apagado»);
//  B2  mientras está apagado, ninguna escritura ni conexión Bluetooth hacia B;
//  B3  el texto y el archivo llegan por internet en ≤ 15 s tras volver el internet;
//  B4  B cierra su app (su Bluetooth sigue recibiendo) y cae el internet; A enciende el Bluetooth y manda un texto: sale por
//      Bluetooth (la emergencia) y llega en ≤ 20 s (la 3081: ~60 s, hasta que caducaba la marca de «apagado»).
// Uso: node btonoff.js <dir_build>
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone, installWebCrypto } = require('./native_mock');
const { NostrRelay } = require('./nostr_relay');

const buildDir = path.resolve(process.argv[2]);
const base = { readsContentFallback: true, retain: ['onPayloadReceived', 'onLanMessage', 'onLanUp', 'onLanDown'], closeOnNoService: true, pace: [15, 15], ioDelay: 25, asymmetric: true, noL2: true, noTor: true };
let RELAYS = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
class DistLoader extends ResourceLoader {
  constructor(dir) { super(); this.dir = dir; }
  fetch(url) { const f = path.join(this.dir, decodeURIComponent(new URL(url).pathname)); return fs.existsSync(f) ? Promise.resolve(fs.readFileSync(f)) : Promise.reject(new Error('no existe ' + f)); }
}
const logs = [];
async function boot(name, native) {
  native.listeners = new Map();
  native.btCalls = native.btCalls || [];
  const vc = new VirtualConsole();
  ['log', 'warn', 'error'].forEach((l) => vc.on(l, (...a) => logs.push(`${new Date().toISOString().substring(14, 23)} [${name}] ${l}: ` + a.map(String).join(' ').substring(0, 300))));
  const dom = new JSDOM(fs.readFileSync(path.join(buildDir, 'dist', 'index.html'), 'utf8'), {
    url: 'https://' + name.toLowerCase() + '.nexo.test/index.html', runScripts: 'dangerously',
    resources: new DistLoader(path.join(buildDir, 'dist')), pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) {
      win.NEXO_NET_RELAYS = RELAYS; win.CapacitorCustomPlatform = { name: 'android' }; installWebCrypto(win);
      const pl = native.plugin();
      // espía: toda llamada Bluetooth hacia un dispositivo (escritura de texto, trozo binario o conexión)
      ['sendMessage', 'sendBinary', 'connectToDevice'].forEach((k) => {
        const o = pl[k]; if (typeof o !== 'function') return;
        pl[k] = (a) => { try { native.btCalls.push({ t: Date.now(), k, id: String((a && (a.deviceId || a.address)) || ''), off: !!native.btOff }); } catch (e) {} return o(a); };
      });
      win.Capacitor = { Plugins: { NexoBLE: pl } }; win.HTMLElement.prototype.scrollTo = function () {};
    },
  });
  const win = dom.window;
  for (let i = 0; i < 1000 && !(win.NEXO && win.NEXO.initialized); i++) await sleep(10);
  await sleep(800);
  return { name, native, win };
}
const click = (win, el) => el && el.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
async function openChatWith(p, name) {
  const row = Array.from(p.win.document.querySelectorAll('#main-contacts-list .ble-contact-row')).find((r) => (r.querySelector('.ble-contact-name') || {}).textContent === name);
  click(p.win, row); await sleep(500); return !!row;
}
function sendText(p, t) { const i = p.win.document.getElementById('message-input'); i.value = t; i.dispatchEvent(new p.win.Event('input', { bubbles: true })); click(p.win, p.win.document.getElementById('send-btn')); }
function pickFile(p, name, b) {
  p.win.document.querySelector('.attach-menu-item[data-type="file"]').dispatchEvent(new p.win.MouseEvent('click', { bubbles: true }));
  const fin = Array.from(p.win.document.querySelectorAll('input[type=file]')).pop();
  Object.defineProperty(fin, 'files', { configurable: true, value: [new p.win.File([b], name, { type: 'application/octet-stream' })] });
  fin.dispatchEvent(new p.win.Event('change'));
}
async function addFound(p, name) {
  let add = null;
  const find = () => { const row = Array.from(p.win.document.querySelectorAll('#ble-new-device > div')).find((d) => (d.querySelector('span') || {}).textContent === name); return row && row.querySelector('button'); };
  for (let i = 0; i < 400 && !add; i++) { await sleep(100); add = find(); if (!add && !p.win.bleInterface.isScanning) click(p.win, p.win.document.getElementById('ble-scan-btn')); }
  click(p.win, add); await sleep(2000);
  return !!add;
}
async function waitFor(fn, ms) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return Math.round((Date.now() - t0) / 100) / 10; await sleep(200); } return null; }
const has = (p, from, pred) => p.win.vaultLoadMessages(from).then((l) => l.some(pred));

(async () => {
  const r = { prueba: 'btonoff', build: path.basename(buildDir) };
  const r1 = new NostrRelay(), r2 = new NostrRelay();
  RELAYS = [await r1.start(), await r2.start()];
  const ports = RELAYS.map((u) => Number(u.split(':').pop()));
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', Object.assign({}, base, { wifi: 'casa' })), nB = new NativePhone('B', 'BB:BB:BB:BB:BB:02', Object.assign({}, base));
  [nA, nB].forEach((n) => { radio.add(n); n.load(); });
  let A = await boot('A', nA); const B = await boot('B', nB);
  const idA = A.win.bleInterface.localNexoId.toLowerCase(), idB = B.win.bleInterface.localNexoId.toLowerCase();
  A.win.bleInterface.togglePanel(); const paired = await addFound(A, 'B'); A.win.bleInterface.togglePanel();
  if (!paired) { console.log('BTONOFF ' + JSON.stringify({ prueba: 'btonoff', resultado: 'FALLO', error: 'no empareja' })); process.exit(1); }
  await openChatWith(A, 'B'); sendText(A, 'hola B'); await sleep(3000);
  await openChatWith(B, 'A'); sendText(B, 'hola A'); await sleep(3000);
  A.win.bleInterface.net.tick(); B.win.bleInterface.net.tick();
  r.bt_y_internet = await waitFor(() => !!A.win.bleInterface._bleReadyFor(idB) && A.win.bleInterface.net.canReach(idB), 60000) !== null;

  // A cerrada; se le apaga el Bluetooth y se corta el internet (relés caídos); se abre otra vez
  A.win.close(); nA.destroyActivity();
  nA.setBt(false);
  await r1.stop(); await r2.stop();
  await sleep(1500);
  nA.load();
  const tOpen = Date.now(), logFrom = logs.length;
  A = await boot('A', nA);
  r.B1_sabe_apagado_s = await waitFor(() => logs.slice(logFrom).some((l) => /\[A\].*Bluetooth apagado/.test(l)), 10000);
  if (r.B1_sabe_apagado_s !== null) r.B1_sabe_apagado_s = Math.round((Date.now() - tOpen) / 100) / 10;
  await openChatWith(A, 'B');
  sendText(A, 'sin bluetooth');
  await sleep(300);
  pickFile(A, 'apagado.bin', Buffer.alloc(60000, 9));
  await sleep(3000);
  // vuelve el internet
  await r1.start(ports[0]); await r2.start(ports[1]);
  const tNet = Date.now();
  A.win.bleInterface.net.tick(); B.win.bleInterface.net.tick();
  let txtAt = 0, fileAt = 0;
  await waitFor(async () => {
    if (!txtAt && await has(B, idA, (m) => m.content === 'sin bluetooth')) txtAt = Date.now();
    if (!fileAt && await has(B, idA, (m) => m.attachmentType && !m._own && (m.attachmentMeta || {}).name === 'apagado.bin')) fileAt = Date.now();
    return txtAt && fileAt;
  }, 60000);
  r.B3_texto_s = txtAt ? Math.round((txtAt - tNet) / 100) / 10 : null;
  r.B3_archivo_s = fileAt ? Math.round((fileAt - tNet) / 100) / 10 : null;
  const offCalls = nA.btCalls.filter((c) => c.t >= tOpen && c.off && !/^(net|lan|wd):/i.test(c.id));
  r.B2_llamadas_bt_apagado = offCalls.length;
  r.B2_detalle = offCalls.slice(0, 4).map((c) => c.k + ' ' + c.id);

  // B4: B con la app CERRADA (su Bluetooth sigue recibiendo: BgInbox) y sin internet; A enciende el Bluetooth: solo A puede buscar
  // y conectar, así que la emergencia depende de que A se entere de que el Bluetooth volvió
  B.win.close(); nB.destroyActivity();
  await r1.stop(); await r2.stop();
  r.B4_sin_internet_s = await waitFor(() => !A.win.bleInterface.net.canReach(idB), 60000);
  await sleep(2000);
  nA.setBt(true);
  const tOn = Date.now();
  await openChatWith(A, 'B');
  sendText(A, 'bluetooth otra vez');
  await sleep(500);
  const own = (await A.win.vaultLoadMessages(idB)).find((m) => m._own && m.content === 'bluetooth otra vez');
  const mid = own && (own.msgId || own.messageId);
  r.B4_llega_s = mid ? await waitFor(() => (nB.bgInbox || []).some((x) => String(x.c || '').indexOf(mid) >= 0), 90000) : null;
  if (r.B4_llega_s !== null) r.B4_llega_s = Math.round((Date.now() - tOn) / 100) / 10;
  r.B4_encendido_visto = logs.slice(logFrom).some((l) => /\[A\].*Bluetooth encendido/.test(l));
  r.errores = logs.filter((l) => / error: /.test(l) && !/JSDOMERROR|styles\.css|Not implemented|net::ERR|fetch/.test(l)).slice(0, 5);
  const ok = r.bt_y_internet && r.B1_sabe_apagado_s !== null && r.B1_sabe_apagado_s <= 2 && r.B2_llamadas_bt_apagado === 0 &&
    r.B3_texto_s !== null && r.B3_archivo_s !== null && r.B3_archivo_s <= 15 && r.B3_texto_s <= 15 && r.B4_llega_s !== null && r.B4_llega_s <= 20 && !r.errores.length;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('BTONOFF ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_btonoff.txt'), logs.join('\n'));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('BTONOFF ' + JSON.stringify({ prueba: 'btonoff', resultado: 'FALLO', error: String(e && e.message) })); console.error(e); fs.writeFileSync(path.join(__dirname, 'last_logs_btonoff.txt'), logs.join('\n')); process.exit(1); });
