// Primer diagnóstico AUTOMÁTICO del dueño (S24, 09-11 16:01 UTC, build 2975, síntoma «pendiente_viejo … 1529 min, enlace internet»):
// un texto a un contacto SOLO INTERNET (identificador guardado «net:…», agregado por ID) llevaba 25 horas ⏳ y el aviso decía
// «enlace internet» aunque el registro mostraba «sin enlace ni ruta». Causa: linkOf devolvía «internet» en cuanto el identificador
// del contacto era net:…, estuviera o no en línea. Consecuencias reales: (a) _wakeSleepingPeer al abrir el chat no tocaba («ya hay
// enlace vivo»); (b) el bucle de toques por pendientes lo daba por «ya alcanzable» y BORRABA la entrada → ni un toque FCM en 25 h;
// (c) el subtítulo del chat decía «Internet» con el contacto apagado; (d) el diagnóstico automático lo contaba como alcanzable.
// 2976: «internet» solo si el contacto está EN LÍNEA (net.canReach); si no, puente Jump o «none».
// También: al ARRANCAR en frío en el teléfono real (WebView de Android, window.androidBridge), _foreground arranca del estado visible
// (antes quedaba undefined hasta el primer cambio de estado y el resume de Fénix salía con el usuario en pantalla).
// Uso: node netoffline.js <dir_build>
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
class DL extends ResourceLoader { constructor(d) { super(); this.d = d; } fetch(u) { const f = path.join(this.d, decodeURIComponent(new URL(u).pathname)); return fs.existsSync(f) ? Promise.resolve(fs.readFileSync(f)) : Promise.reject(new Error('x')); } }
const logs = [];
async function boot(name, native, nativePlatform) {
  native.listeners = new Map();
  const vc = new VirtualConsole();
  ['log', 'warn', 'error'].forEach((l) => vc.on(l, (...a) => logs.push(`${new Date().toISOString().substring(14, 23)} [${name}] ${l}: ` + a.map(String).join(' ').substring(0, 250))));
  const dom = new JSDOM(fs.readFileSync(path.join(buildDir, 'dist', 'index.html'), 'utf8'), {
    url: 'https://' + name.toLowerCase() + '.nexo.test/index.html', runScripts: 'dangerously', resources: new DL(path.join(buildDir, 'dist')), pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) {
      win.NEXO_NET_RELAYS = RELAYS; win.CapacitorCustomPlatform = { name: 'android' }; installWebCrypto(win);
      win.Capacitor = { Plugins: { NexoBLE: native.plugin() } };
      if (nativePlatform) win.NEXO_SIM_ANDROID_BRIDGE = true; // como en el teléfono real (window.androidBridge del WebView de Android)
      win.HTMLElement.prototype.scrollTo = function () {};
    },
  });
  const win = dom.window;
  for (let i = 0; i < 100 && !(win.NEXO && win.NEXO.initialized); i++) await sleep(100);
  await sleep(800);
  return { name, native, win };
}
const click = (win, el) => el && el.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
async function openChatWith(p, name) {
  const row = Array.from(p.win.document.querySelectorAll('#main-contacts-list .ble-contact-row')).find((r) => (r.querySelector('.ble-contact-name') || {}).textContent === name);
  click(p.win, row); await sleep(400); return !!row;
}
const rnd = (n, s) => { const b = Buffer.alloc(n); for (let i = 0; i < n; i++) b[i] = (i * 7919 + s) & 255; return b; };
function sendFile(p, name, type, bytes) {
  click(p.win, p.win.document.querySelector('.attach-menu-item[data-type="file"]'));
  const fin = Array.from(p.win.document.querySelectorAll('input[type=file]')).pop();
  Object.defineProperty(fin, 'files', { value: [new p.win.File([bytes], name, { type })], configurable: true }); fin.dispatchEvent(new p.win.Event('change'));
}
function sendText(p, t) { const i = p.win.document.getElementById('message-input'); i.value = t; i.dispatchEvent(new p.win.Event('input', { bubbles: true })); click(p.win, p.win.document.getElementById('send-btn')); }
async function addFound(p, name) {
  let add = null;
  const find = () => { const row = Array.from(p.win.document.querySelectorAll('#ble-new-device > div')).find((d) => (d.querySelector('span') || {}).textContent === name); return row && row.querySelector('button'); };
  for (let i = 0; i < 400 && !add; i++) { await sleep(100); add = find(); if (!add && !p.win.bleInterface.isScanning) click(p.win, p.win.document.getElementById('ble-scan-btn')); }
  click(p.win, add); await sleep(2000);
  return !!add;
}
async function waitFor(fn, ms) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return Math.round((Date.now() - t0) / 100) / 10; await sleep(200); } return null; }
function installFetchSpy(win) {
  const calls = [];
  win.fetch = function (url, opts) { let body = null; try { body = opts && opts.body ? JSON.parse(opts.body) : null; } catch (e) {} calls.push({ url: String(url), body }); return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true }) }); };
  return calls;
}

(async () => {
  const r1 = new NostrRelay(), r2 = new NostrRelay({ authRequired: true });
  RELAYS = [await r1.start(), await r2.start()];
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', Object.assign({}, base, { wifi: 'casa' })), nB = new NativePhone('B', 'BB:BB:BB:BB:BB:02', Object.assign({}, base, { wifi: 'oficina' }));
  [nA, nB].forEach((n) => { radio.add(n); n.load(); });
  const A = await boot('A', nA, false), B = await boot('B', nB, true);
  const biA = A.win.bleInterface, netA = biA.net, netB = B.win.bleInterface.net;
  const idA = biA.localNexoId.toLowerCase(), idB = B.win.bleInterface.localNexoId.toLowerCase();
  const TOKB = 'FCMTOK-B-0000000000000000000000000000';
  const r = { prueba: 'netoffline', build: path.basename(buildDir) };

  // (0) Arranque en frío: en el «teléfono real» (B, isNativePlatform) el primer plano se sabe desde el principio; en el simulador (A) no
  r.arranque_nativo_primer_plano = B.win.bleInterface._foreground === true;
  r.arranque_simulador_sin_senal = A.win.bleInterface._foreground !== true;

  // Se conocen por Bluetooth, se saludan, y cada uno a su casa (solo internet) → token FCM intercambiado
  biA.togglePanel(); const paired = await addFound(A, 'B'); biA.togglePanel();
  if (!paired) { console.log('NETOFFLINE ' + JSON.stringify(Object.assign(r, { resultado: 'FALLO', error: 'no empareja' }))); process.exit(1); }
  await openChatWith(A, 'B'); sendText(A, 'hola B'); await sleep(1500);
  await openChatWith(B, 'A'); sendText(B, 'hola A'); await sleep(1500);
  radio.block(nA, nB); netA.tick(); netB.tick();
  r.en_internet_s = await waitFor(() => biA.linkOf(idB) === 'internet', 60000);
  r.token_intercambiado_s = await waitFor(() => { const p = netA.peers.get(idB); return p && p.fcmToken === TOKB; }, 40000);
  const calls = installFetchSpy(A.win); netA.setSender('https://sender.test/wake');
  const nWake = () => calls.filter((c) => /sender\.test\/wake/.test(c.url)).length;

  // (1) El contacto se APAGA: su Bluetooth desaparece del todo y deja de estar en línea por internet; su identificador guardado
  //     es «net:…» (como un contacto agregado por ID, que nunca se vio por Bluetooth)
  nB.setOffline(true);
  r.bluetooth_caido_s = await waitFor(() => !biA._bleReadyFor(idB), 40000);
  try { B.win.close(); } catch (e) {} // la app de B se CIERRA del todo (sin relés, sin ACKs): como el contacto apagado del diagnóstico
  const oCan = netA.canReach.bind(netA), oBoth = netA.bothWifi ? netA.bothWifi.bind(netA) : null;
  netA.canReach = function (nx) { return String(nx).toLowerCase() === idB ? false : oCan(nx); };
  if (oBoth) netA.bothWifi = function (nx) { return String(nx).toLowerCase() === idB ? false : oBoth(nx); };
  const netIdB = 'net:' + idB;
  biA._nexoIdToMac.set(idB, netIdB.replace(/[:-]/g, '')); biA._macToNexoId.set(netIdB.replace(/[:-]/g, ''), idB);
  const c = (biA.getBLEContacts() || []).find((x) => String(x.nexoId || x.deviceUUID || '').toLowerCase() === idB); if (c) c.deviceId = netIdB;
  r.resuelve_a_net = /^net/i.test(String(biA._resolveDeviceIdForNexoId(idB) || ''));
  r.enlace_apagado = biA.linkOf(idB);                       // antes: 'internet' (mentira); ahora: 'none'
  r.enlace_apagado_no_internet = r.enlace_apagado !== 'internet';

  // (2) Algo que QUEDA pendiente ⏳ (una foto a un contacto sin buzón de archivos, como uno agregado por ID sin clave todavía):
  //     el bucle de toques por pendientes NO debe borrarlo («ya alcanzable») sino tocar
  const oMail = netA.mailboxOk.bind(netA); netA.mailboxOk = function (nx) { return String(nx).toLowerCase() === idB ? false : oMail(nx); };
  await openChatWith(A, 'B'); sendFile(A, 'foto.jpg', 'image/jpeg', rnd(300 * 1024, 3)); await sleep(2500);
  const mTxt = (await A.win.vaultLoadMessages(idB)).find((m) => m.attachmentType && m._own);
  r.foto_estado = mTxt ? String(mTxt.status) : 'no_existe';
  r.foto_queda_pendiente = !!mTxt && /pending|queued|sending|failed/.test(String(mTxt.status));
  biA._noteWakePending(idB);
  const pB = netA.peers.get(idB); if (pB) pB._wakeAt = 0; // sin el freno por par (un toque anterior no debe tapar la decisión)
  const w1 = nWake();
  biA._lastWakeTick = 0; if (biA._pendingWake && biA._pendingWake.get(idB)) biA._pendingWake.get(idB).nextAt = 0;
  biA._tickWakePending(); await sleep(1500);
  r.pendiente_sigue_en_toques = !!(biA._pendingWake && biA._pendingWake.has(idB)); // antes: borrado («ya alcanzable»)
  r.toque_por_pendiente = nWake() > w1;                                           // antes: ninguno

  // (3) Abrir el chat con el contacto apagado debe TOCARLO (P2): antes decía «ya hay enlace vivo» (el toque en sí puede ir
  //     frenado por el freno por par tras el anterior; lo que importa es la decisión)
  r.abrir_chat_toca = biA._wakeSleepingPeer(idB);           // antes: 'internet'; ahora: 'waking'
  netA.mailboxOk = oMail;

  // (4) El diagnóstico automático ya no lo cuenta como «alcanzable»: con el contacto apagado no hay «pendiente viejo» que avisar
  A.win.NEXO_AUTODIAG_OLD_MS = 1;
  const found = await (A.win.__nexoAutoDiag ? A.win.__nexoAutoDiag.scan() : Promise.resolve('sin_api'));
  r.autodiag_sin_falso_positivo = found === null;

  // (5) Vuelve a estar en línea (canReach otra vez): «internet» otra vez (no se rompe el caso normal)
  netA.canReach = function (nx) { return String(nx).toLowerCase() === idB ? true : oCan(nx); };
  r.en_linea_otra_vez = biA.linkOf(idB) === 'internet';
  netA.canReach = oCan; if (oBoth) netA.bothWifi = oBoth;

  r.errores = logs.filter((l) => / error: /.test(l) && !/JSDOMERROR|styles\.css|Not implemented|GLOBAL TIMEOUT|net::ERR|fetch/.test(l)).slice(0, 5);
  const ok = r.arranque_nativo_primer_plano && r.arranque_simulador_sin_senal && r.en_internet_s !== null && r.token_intercambiado_s !== null && r.bluetooth_caido_s !== null && r.resuelve_a_net &&
    r.enlace_apagado_no_internet && r.foto_queda_pendiente && r.abrir_chat_toca === 'waking' && r.pendiente_sigue_en_toques && r.toque_por_pendiente && r.autodiag_sin_falso_positivo && r.en_linea_otra_vez && !r.errores.length;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('NETOFFLINE ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_netoffline.txt'), logs.join('\n'));
  await r1.stop(); await r2.stop();
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('NETOFFLINE ' + JSON.stringify({ prueba: 'netoffline', resultado: 'FALLO', error: String(e && e.message).replace(/"/g, "'") })); console.error(e && e.stack); fs.writeFileSync(path.join(__dirname, 'last_logs_netoffline.txt'), logs.join('\n')); process.exit(1); });
