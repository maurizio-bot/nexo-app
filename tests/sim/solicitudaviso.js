// 3190 (dueño 17-11: «hay que poner esa notificación: hay un contacto que te quiere agregar»). La parte nativa (NetBg) escucha ahora mi
// buzón de solicitudes de contacto con la app en segundo plano o cerrada y pone el aviso del teléfono (eso se prueba en Kotlin:
// NetBgReqTest, ReqNotifyPolicyTest). La solicitud NO se consume allí: la app la recibe al volver (netBgDrain). Esta prueba, la parte de
// la app (2 teléfonos solo por internet, sin conocerse):
//  S1 B a segundo plano: la app le pasa a la parte nativa lo que hace falta para el aviso (mi ID, mis contactos, a quién mandé yo una
//     solicitud, desde cuándo ya no escucha su buzón); A agrega a B por su NEXO ID; la app de B, dormida, no la recibe;
//  S2 B vuelve con los relés caídos: la solicitud que guardó la parte nativa entra en «Solicitudes para ti» en ≤ 3 s, aunque B no tenga
//     contactos por internet (antes la app no recogía lo de la parte nativa sin contactos por internet), con el aviso de dentro de la app;
//  S3 tocar el aviso del teléfono (destino nexo_requests) abre «Agregar» con la solicitud de A a la vista;
//  S4 el aviso de dentro de la app en los 5 idiomas y sin voseo; aceptar o eliminar ya no dicen «Alguien quiere agregarte»;
//  S5 una solicitud que la parte nativa guardó y la app recoge estando oculta (su buzón no está en reqTags) no se pierde;
//  S6 A, que mandó la solicitud, le dice a su parte nativa que espera la respuesta de B (su «acc» sale como «aceptó tu solicitud»).
// Contraprueba: la 3189 (base) falla S2 (sin contactos por internet no recoge), S3, S4, S5 y S1/S6 (no pasa nada para el aviso).
// Uso: node solicitudaviso.js <dir_build>
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone, installWebCrypto } = require('./native_mock');
const { NostrRelay } = require('./nostr_relay');
const { importSrc } = require('./srcmod');

const buildDir = path.resolve(process.argv[2] || path.join(__dirname, 'builds/wip'));
const base = { readsContentFallback: true, retain: ['onPayloadReceived', 'onNotificationOpened'], closeOnNoService: true, pace: [15, 15], ioDelay: 25, asymmetric: true, noTor: true };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
class DL extends ResourceLoader { constructor(d) { super(); this.d = d; } fetch(u) { const f = path.join(this.d, decodeURIComponent(new URL(u).pathname)); return fs.existsSync(f) ? Promise.resolve(fs.readFileSync(f)) : Promise.reject(new Error('x')); } }
const logs = [];
const T0 = Date.now();
const ts = () => String(((Date.now() - T0) / 1000).toFixed(1)).padStart(6) + 's';
async function boot(name, native, relays) {
  native.listeners = new Map();
  const vc = new VirtualConsole();
  ['log', 'warn', 'error'].forEach((l) => vc.on(l, (...a) => logs.push(`${ts()} [${name}] ${l}: ` + a.map(String).join(' ').substring(0, 260))));
  const dom = new JSDOM(fs.readFileSync(path.join(buildDir, 'dist', 'index.html'), 'utf8'), {
    url: 'https://' + name.toLowerCase() + '.nexo.test/index.html', runScripts: 'dangerously', resources: new DL(path.join(buildDir, 'dist')), pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) {
      win.NEXO_NET_RELAYS = relays; win.CapacitorCustomPlatform = { name: 'android' }; installWebCrypto(win);
      win.Capacitor = { Plugins: { NexoBLE: native.plugin() } }; win.HTMLElement.prototype.scrollTo = function () {}; win.HTMLElement.prototype.scrollIntoView = function () {};
    },
  });
  const win = dom.window;
  for (let i = 0; i < 100 && !(win.NEXO && win.NEXO.initialized); i++) await sleep(100);
  await sleep(800);
  return { name, native, win, bi: win.bleInterface };
}
async function waitFor(fn, ms) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return Math.round((Date.now() - t0) / 100) / 10; await sleep(100); } return null; }
function setVisible(p, vis) {
  const d = p.win.document; p._vis = vis ? 'visible' : 'hidden';
  if (!p._visDef) { Object.defineProperty(d, 'visibilityState', { configurable: true, get: () => p._vis }); Object.defineProperty(d, 'hidden', { configurable: true, get: () => p._vis === 'hidden' }); p._visDef = true; }
  d.dispatchEvent(new p.win.Event('visibilitychange'));
}
function shutdown(p) { try { p.bi.net._closeAll(); p.bi.net.relays.forEach((rl) => { rl.retryAt = Date.now() + 9e6; }); } catch (e) {} }
// los avisos de dentro de la app (_showToast) que salen al hacer fn()
function toastsOf(p, fn) {
  const before = new Set(Array.from(p.win.document.body.children));
  fn();
  return Array.from(p.win.document.body.children).filter((el) => !before.has(el) && el.style && String(el.style.zIndex) === '2147483647').map((el) => el.textContent);
}
// (con \b de JS «mirá» no se detecta: la á no cuenta como letra; por eso la frontera va con letras explícitas)
const VOSEO = /(^|[^a-záéíóúüñ])(mirá|confirmá|tocá|aceptá|abrí|podés|tenés|querés|vos)(?![a-záéíóúüñ])/i;

(async () => {
  const r = { prueba: 'solicitudaviso', build: path.basename(buildDir) };
  r.voseo_detecta = VOSEO.test('👋 Ana quiere agregarte — mirá «Solicitudes para ti»') && !VOSEO.test('👋 Ana quiere agregarte — mira «Solicitudes para ti»');
  const shared = await importSrc('net/net_link_shared.js');
  const r1 = new NostrRelay(), r2 = new NostrRelay({ authRequired: true });
  const RELAYS = [await r1.start(), await r2.start()];
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', Object.assign({}, base, { wifi: 'casa' })), nB = new NativePhone('B', 'BB:BB:BB:BB:BB:02', Object.assign({}, base, { wifi: 'oficina' }));
  [nA, nB].forEach((n) => { radio.add(n); n.load(); });
  radio.block(nA, nB); // solo por internet: no se conocen
  const A = await boot('A', nA, RELAYS), B = await boot('B', nB, RELAYS);
  const idA = A.bi.localNexoId.toLowerCase(), idB = B.bi.localNexoId.toLowerCase();
  r.en_internet = await waitFor(() => A.bi.net.online() && B.bi.net.online(), 20000) !== null;

  // S1: B a segundo plano (su app queda dormida: no vuelve a conectarse a los relés hasta volver)
  setVisible(B, false); shutdown(B);
  const netB = B.bi.net, realConnect = netB._connect; netB._connect = function () {};
  await sleep(800);
  const cfgB = nB.netBg || {};
  r.S1_config = { me: cfgB.me === idB, known: Array.isArray(cfgB.known), reqOut: Array.isArray(cfgB.reqOut), reqSince: typeof cfgB.reqSince === 'number' && cfgB.reqSince > Date.now() - 10 * 60000 && cfgB.reqSince < Date.now() };
  r.S1_ok = Object.values(r.S1_config).every(Boolean);
  let sent = false;
  try { await A.bi.addByNexoId(idB); sent = true; } catch (e) { logs.push('[A] addByNexoId: ' + (e && e.message)); }
  r.S1_enviada = sent;
  const tagB = shared._reqTagPub(idB, shared._day(0));
  const forB = () => { const ids = new Set(), out = []; r1.events.concat(r2.events).forEach((e) => { if (e && !ids.has(e.id) && (e.tags || []).some((t) => t[0] === 'p' && t[1] === tagB)) { ids.add(e.id); out.push(e); } }); return out; };
  r.S1_en_el_rele = await waitFor(() => forB().length > 0, 10000) !== null;
  await sleep(1000);
  r.S1_dormida_no_la_tiene = !B.bi.pendingRequests().some((x) => x.id === idA);

  // S2: lo que la parte nativa de B oyó en su buzón; los relés se caen; B vuelve
  nB.netBgInbox = forB().map((e) => JSON.stringify(e));
  await r1.stop(); await r2.stop();
  netB._connect = realConnect;
  netB.relays.forEach((rl) => { rl.retryAt = 0; });
  r.S2_contactos_por_internet_B = netB._netContacts().length;
  let toastS2 = [];
  const obs = new B.win.MutationObserver((ms) => ms.forEach((m) => m.addedNodes.forEach((n) => { if (n.style && String(n.style.zIndex) === '2147483647') toastS2.push(n.textContent); })));
  obs.observe(B.win.document.body, { childList: true });
  setVisible(B, true);
  r.S2_en_bandeja_s = await waitFor(() => B.bi.pendingRequests().some((x) => x.id === idA), 6000);
  obs.disconnect();
  r.S2_ok = r.S2_en_bandeja_s !== null && r.S2_en_bandeja_s <= 3;
  r.S2_aviso = toastS2.filter((x) => /👋|✅/.test(x));
  const nameA = (B.bi.pendingRequests().find((x) => x.id === idA) || {}).name || idA.toUpperCase();
  r.S2_aviso_ok = r.S2_aviso.length === 1 && r.S2_aviso[0] === '👋 ' + nameA + ' quiere agregarte — mira «Solicitudes para ti»';

  // S3: tocar el aviso del teléfono (el nativo manda onNotificationOpened con el destino nexo_requests)
  const panel = B.win.document.getElementById('ble-panel');
  r.S3_cerrado_antes = !!panel && !panel.classList.contains('active');
  nB.emit('onNotificationOpened', { deviceId: 'nexo_requests', source: 'notification' });
  r.S3_abre_s = await waitFor(() => {
    const box = B.win.document.getElementById('ble-requests'), list = B.win.document.getElementById('ble-requests-list');
    return panel.classList.contains('active') && box && box.style.display !== 'none' && list && list.textContent.indexOf(idA.toUpperCase()) >= 0;
  }, 8000);
  const rowTxt = (B.win.document.getElementById('ble-requests-list') || {}).textContent || '';
  r.S3_fila = rowTxt.slice(0, 120);
  r.S3_ok = r.S3_cerrado_antes && r.S3_abre_s !== null && !VOSEO.test(rowTxt) && rowTxt.indexOf('quiere agregarte') >= 0;

  // S4: el aviso de dentro de la app en los 5 idiomas (el idioma de B se cambia con la semilla del simulador), sin voseo
  r.S4 = {};
  let s4ok = true;
  const p = B;
  for (const l of ['es', 'it', 'en', 'pt', 'fr']) {
    p.win.NEXO_FORCE_LANG = l;
    const T = (await importSrc('ui/i18n/' + l + '.js')).default;
    const fire = (detail) => toastsOf(p, () => p.win.dispatchEvent(new p.win.CustomEvent('nexo:ble:reqIncoming', { detail })));
    const req = fire({ id: 'nx1a2b3c4d', name: 'Ana $& Co', count: 1, acc: false }); // «$&» tal cual (no es un patrón de replace)
    const acc = fire({ id: 'nx1a2b3c4e', name: 'Beto', count: 2, acc: true });
    const sinNombre = fire({ id: 'nx1a2b3c4f', name: '', count: 3, acc: false });
    const sinId = fire({ count: 0 }); // así avisan aceptar y eliminar
    const tr = (k, nm) => (typeof T[k] === 'string' ? T[k].split('{name}').join(nm) : '(falta la clave ' + k + ')');
    const want = [tr('req_toast', 'Ana $& Co'), tr('req_toast_acc', 'Beto'), tr('req_toast', 'NX1A2B3C4F')];
    const ok = req.length === 1 && req[0] === want[0] && acc.length === 1 && acc[0] === want[1] && sinNombre.length === 1 && sinNombre[0] === want[2] && sinId.length === 0 && !VOSEO.test(req.concat(acc).join(' '));
    r.S4[l] = ok ? req[0] : { req, acc, sinNombre, sinId, want };
    s4ok = s4ok && ok;
  }
  // S4b (3194): los botones de la bandeja (Aceptar/Eliminar; Confirmar para una aceptación) en el idioma de la app
  r.S4b = {};
  let s4bok = true;
  for (const l of ['es', 'it', 'en', 'pt', 'fr']) {
    p.win.NEXO_FORCE_LANG = l;
    const T = (await importSrc('ui/i18n/' + l + '.js')).default;
    try { B.bi.renderRequests(); } catch (e) {}
    const btns = Array.from((B.win.document.getElementById('ble-requests-list') || { querySelectorAll: () => [] }).querySelectorAll('button')).map((b) => b.textContent);
    const ok = btns.length >= 2 && btns.indexOf(T.req_btn_accept) >= 0 && btns.indexOf(T.req_btn_delete) >= 0 && !VOSEO.test(btns.join(' '));
    r.S4b[l] = ok ? btns.slice(0, 2).join(' · ') : { btns, quiero: [T.req_btn_accept, T.req_btn_delete] };
    s4bok = s4bok && ok;
  }
  r.S4b_ok = s4bok;
  p.win.NEXO_FORCE_LANG = 'es';
  try { B.bi.renderRequests(); } catch (e) {}
  r.S4_ok = s4ok && r.S4.es !== r.S4.it && r.S4.it !== r.S4.en;

  // S5: con la app oculta, lo que la parte nativa guardó entra igual (su buzón no está en reqTags con la app oculta)
  const { NetLink } = await importSrc('net/net_link.js');
  if (!global.window) global.window = { crypto: globalThis.crypto };
  const e2e = await importSrc('vault/e2e_crypto.js'); await e2e.initE2E();
  const other = new NetLink({ localNexoId: 'nx5555aaaa' }); other.online = () => true;
  let evC = null; other._publish = (e) => { evC = e; return Promise.resolve(); };
  await other.sendRequest(idB, 'req', 'Cinco', {});
  setVisible(B, false); // oculta
  await netB._refreshTags();
  r.S5_buzon_en_reqTags = netB.reqTags.size;
  nB.netBgInbox = [JSON.stringify(evC)];
  await netB._drainBg();
  r.S5_ok = r.S5_buzon_en_reqTags === 0 && B.bi.pendingRequests().some((x) => x.id === 'nx5555aaaa');

  // S6: A (mandó la solicitud a B) a segundo plano: su parte nativa sabe que espera la respuesta de B
  setVisible(A, false); await sleep(800);
  r.S6_ok = !!(nA.netBg && Array.isArray(nA.netBg.reqOut) && nA.netBg.reqOut.indexOf(idB) >= 0);

  r.errores = logs.filter((l) => / error: /.test(l) && !/JSDOMERROR|styles\.css|Not implemented|GLOBAL TIMEOUT|net::ERR|fetch|ECONNREFUSED|WebSocket/.test(l)).slice(0, 5);
  const ok = r.voseo_detecta && r.en_internet && r.S1_ok && r.S1_enviada && r.S1_en_el_rele && r.S1_dormida_no_la_tiene && r.S2_ok && r.S2_aviso_ok && r.S3_ok && r.S4_ok && r.S4b_ok && r.S5_ok && r.S6_ok && !r.errores.length;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('SOLICITUDAVISO ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_solicitudaviso.txt'), logs.join('\n'));
  [A, B].forEach(shutdown);
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('SOLICITUDAVISO ' + JSON.stringify({ prueba: 'solicitudaviso', resultado: 'FALLO', error: String(e && e.message).replace(/"/g, "'") })); console.error(e && e.stack); fs.writeFileSync(path.join(__dirname, 'last_logs_solicitudaviso.txt'), logs.join('\n')); process.exit(1); });
