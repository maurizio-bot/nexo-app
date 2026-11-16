// 3151 — RELÉ PROPIO (dueño 16-11: «NEXO tendrá su PROPIO servidor de relé, de pago, para que mensajes y archivos vayan tan rápido
// como WhatsApp; los públicos quedan de respaldo»; diagnósticos 15-11: archivos por relés a 9–25 KB/s, «internet listo» 13,7 s de
// media, de 15,5 MB bajados de los relés 12,7 MB eran eventos REPETIDOS). A y B solo por internet (sin Bluetooth entre ellos).
// Modelo (supuesto, no medido en servidores reales): 4 relés PÚBLICOS con lo típico de uno gratuito y cargado — tardan en abrir la
// conexión (1,2 a 4,5 s: TLS y servidor lejano), 200 ms de demora, 5 eventos/s por conexión (ráfaga 10; los de más: «rate-limited»),
// 128 KB/s por conexión y uno pide NIP-42 — y 1 relé PROPIO (strfry en un servidor alquilado): 300 ms en abrir, 40 ms, sin límite
// de ritmo, 1 MB/s por conexión (lo que daría el teléfono).
// El MISMO escenario dos veces (contraprueba): (1) sin relé propio (OWN_RELAYS vacío: lo de siempre) y (2) con él:
//  M1  los dos se ven en línea por internet (desde que arrancan las dos apps);
//  M2  un texto de A llega a B (3 textos, la mediana);
//  M3  un archivo de 2 MB de A llega entero a B (buzón de archivos);
//  M4  bytes de eventos REPETIDOS bajados (A + B; la línea «bajado de los relés» del diagnóstico);
//  con el propio debe ser claramente mejor: M1 y M2 menores, M3 y M4 ≤ la mitad. Además, con el propio:
//  P1  B lee del propio y de UN público (no de los 4); los trozos del archivo están solo en el propio y él va primero en el puntero;
//      una parte pesada (de llamada) va solo al propio;
//  P2  el propio se CAE: B pasa a leer de todos los públicos y un texto de A llega igual en pocos segundos; lo pesado va a los públicos;
//  P3  el propio VUELVE: los dos vuelven a él solos (≤ 20 s) y lo siguiente pasa por él.
// Sin propio, lo de siempre: los 4 públicos abiertos y suscritos, el archivo con réplica en ≥ 2.
// Uso: node releprop.js <dir_build>
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone, installWebCrypto } = require('./native_mock');
const { NostrRelay } = require('./nostr_relay');

const buildDir = path.resolve(process.argv[2] || path.join(__dirname, 'builds/wip'));
const base = { readsContentFallback: true, retain: ['onPayloadReceived', 'onLanMessage', 'onLanUp', 'onLanDown'], closeOnNoService: true, pace: [15, 15], ioDelay: 25, asymmetric: true, noL2: true, noTor: true };
const PUB_OPTS = (i) => ({ connectDelayMs: [1200, 2000, 3000, 4500][i], latencyMs: 200, rateLimit: { perSec: 5, burst: 10 }, bwBps: 128 * 1024, authRequired: i === 1 });
const OWN_OPTS = { connectDelayMs: 300, latencyMs: 40, bwBps: 1024 * 1024 };
const FILE_BYTES = 2 * 1024 * 1024;
let CFG = { pubs: [], own: [] };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
class DistLoader extends ResourceLoader {
  constructor(dir) { super(); this.dir = dir; }
  fetch(url) { const f = path.join(this.dir, decodeURIComponent(new URL(url).pathname)); return fs.existsSync(f) ? Promise.resolve(fs.readFileSync(f)) : Promise.reject(new Error('no existe ' + f)); }
}
const logs = [];
async function boot(name, native) {
  native.listeners = new Map();
  const vc = new VirtualConsole();
  ['log', 'warn', 'error'].forEach((l) => vc.on(l, (...a) => logs.push(`${new Date().toISOString().substring(14, 23)} [${name}] ${l}: ` + a.map(String).join(' ').substring(0, 300))));
  const dom = new JSDOM(fs.readFileSync(path.join(buildDir, 'dist', 'index.html'), 'utf8'), {
    url: 'https://' + name.toLowerCase() + '.nexo.test/index.html', runScripts: 'dangerously',
    resources: new DistLoader(path.join(buildDir, 'dist')), pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) { win.NEXO_NET_RELAYS = CFG.pubs; win.NEXO_SPARE_RELAYS = []; win.NEXO_OWN_RELAYS = CFG.own; win.CapacitorCustomPlatform = { name: 'android' }; installWebCrypto(win); win.Capacitor = { Plugins: { NexoBLE: native.plugin() } }; win.HTMLElement.prototype.scrollTo = function () {}; },
  });
  const win = dom.window;
  for (let i = 0; i < 100 && !(win.NEXO && win.NEXO.initialized); i++) await sleep(100);
  await sleep(800);
  return { name, native, win };
}
const click = (win, el) => el && el.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
async function openChatWith(p, name) {
  const row = Array.from(p.win.document.querySelectorAll('#main-contacts-list .ble-contact-row')).find((r) => (r.querySelector('.ble-contact-name') || {}).textContent === name);
  click(p.win, row); await sleep(500); return !!row;
}
function sendText(p, t) { const i = p.win.document.getElementById('message-input'); i.value = t; i.dispatchEvent(new p.win.Event('input', { bubbles: true })); click(p.win, p.win.document.getElementById('send-btn')); }
async function sendFile(p, name, bytes, seed) {
  const b = Buffer.alloc(bytes); let x = seed; for (let i = 0; i < b.length; i++) { x = (x * 1103515245 + 12345) & 0x7fffffff; b[i] = x & 255; }
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
async function waitFor(fn, ms, every) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return Math.round((Date.now() - t0) / 100) / 10; await sleep(every || 100); } return null; }
function shutdown(p) {
  try { p.win.bleInterface.net._closeAll(); p.win.bleInterface.net.relays.forEach((rl) => { rl.retryAt = Date.now() + 9e6; }); } catch (e) {}
  try { clearInterval(p.win.bleInterface.net._timer); } catch (e) {}
  p.win.close(); p.native.destroyActivity();
}
const net = (p) => p.win.bleInterface.net;
const sees = (p, nx) => !!(net(p) && net(p).canReach(nx));
// conexiones con la suscripción del buzón (públicas y la propia)
const subs = (p) => { const o = { pub: 0, own: 0, open: 0 }; net(p).relays.forEach((r, u) => { if (!r.open || r.gw) return; if (CFG.own.indexOf(u) >= 0) { if (r.sub) o.own++; return; } o.open++; if (r.sub) o.pub++; }); return o; };
const median = (a) => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };
async function hasText(p, from, txt) { return (await p.win.vaultLoadMessages(from)).some((m) => m.content === txt); }
async function findFile(p, chat, b64, own) {
  const list = await p.win.vaultLoadMessages(chat);
  return list.find((m) => !!m._own === !!own && m.attachmentType && !m.deleted && !m.hidden && (m.attachmentPayload || p.native.files.get(m.attachmentRef)) === b64) || null;
}

(async () => {
  const r = { prueba: 'releprop', build: path.basename(buildDir) };
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', Object.assign({}, base, { wifi: 'casa' }));
  const nB = new NativePhone('B', 'BB:BB:BB:BB:BB:02', Object.assign({}, base, { wifi: 'oficina' }));
  [nA, nB].forEach((n) => { radio.add(n); n.load(); });
  // Se conocen en persona (con un relé cualquiera para que los dos anuncien internet)
  const r0 = new NostrRelay();
  CFG = { pubs: [await r0.start()], own: [] };
  let A = await boot('A', nA), B = await boot('B', nB);
  const idA = A.win.bleInterface.localNexoId.toLowerCase(), idB = B.win.bleInterface.localNexoId.toLowerCase();
  A.win.bleInterface.togglePanel(); const pAB = await addFound(A, 'B'); A.win.bleInterface.togglePanel();
  if (!pAB) { console.log('RELEPROP ' + JSON.stringify({ prueba: 'releprop', resultado: 'FALLO', error: 'no empareja' })); process.exit(1); }
  await openChatWith(A, 'B'); sendText(A, 'hola B'); await sleep(2500);
  r.emparejados_en_linea_s = await waitFor(() => sees(A, idB) && sees(B, idA), 20000);
  shutdown(A); shutdown(B); await r0.stop();
  radio.block(nA, nB); // desde aquí, lejos: solo internet

  const modes = {};
  for (const mode of ['publicos', 'propio']) {
    const m = modes[mode] = {};
    const pubs = [0, 1, 2, 3].map((i) => new NostrRelay(PUB_OPTS(i))), own = new NostrRelay(OWN_OPTS);
    const PUB = []; for (const x of pubs) PUB.push(await x.start());
    const OWN = await own.start();
    CFG = { pubs: PUB, own: mode === 'propio' ? [OWN] : [] };
    // M1: arrancan las dos apps → se ven en línea por internet
    nA.load(); nB.load();
    const t0 = Date.now();
    [A, B] = await Promise.all([boot('A', nA), boot('B', nB)]);
    m.M1_en_linea_s = (await waitFor(() => sees(A, idB) && sees(B, idA), 60000)) === null ? null : Math.round((Date.now() - t0) / 100) / 10;
    await sleep(2000);
    m.reles = net(A).relayUrls().map((u) => (u === OWN ? 'propio' : 'p' + (PUB.indexOf(u) + 1))).join(',');
    // M2: textos
    await openChatWith(A, 'B');
    const tt = [];
    for (let i = 0; i < 3; i++) {
      const txt = 'texto ' + mode + ' ' + i, ts = Date.now();
      sendText(A, txt);
      tt.push((await waitFor(() => hasText(B, idA, txt), 20000)) === null ? 99999 : Date.now() - ts);
      await sleep(600);
    }
    m.M2_texto_ms = median(tt); m.M2_textos_ms = tt.join(',');
    // M3: archivo de 2 MB
    const tf = Date.now();
    const file = await sendFile(A, 'archivo_' + mode + '.bin', FILE_BYTES, mode === 'propio' ? 11 : 7); // otro contenido en cada vuelta (B ya tiene el de la anterior)
    const b64 = file.toString('base64');
    m.M3_archivo_s = (await waitFor(() => findFile(B, idA, b64, false).then((x) => !!x), 240000, 300)) === null ? null : Math.round((Date.now() - tf) / 100) / 10;
    const msgB = await findFile(B, idA, b64, false);
    const ptr = msgB && msgB.attachmentMeta && msgB.attachmentMeta.blobPtr; // el puntero que le llegó a B
    m.puntero_reles = ptr ? ptr.relays.map((u) => (u === OWN ? 'propio' : 'p' + (PUB.indexOf(u) + 1))).join(',') : null;
    m.trozos_por_rele = pubs.concat([own]).map((x) => x.events.filter((e) => e.kind === 1064).length).join(',');
    m.limitados_por_ritmo = pubs.reduce((n, x) => n + (x.stats.rateLimited || 0), 0);
    await sleep(3000);
    m.suscripciones_B = subs(B); // ya abiertos todos (el último público tarda 4,5 s en abrir)
    // M4: lo repetido (y todo) bajado de los relés por los dos
    const rx = (p) => (net(p)._rx && net(p)._rx.all) || { bytes: 0, dupBytes: 0, dup: 0 };
    m.M4_repetido_kb = Math.round((rx(A).dupBytes + rx(B).dupBytes) / 1024);
    m.bajado_kb = Math.round((rx(A).bytes + rx(B).bytes) / 1024);
    m.subido_a_reles_kb = Math.round(pubs.concat([own]).reduce((n, x) => n + (x.stats.bytesIn || 0), 0) / 1024);
    m.linea_diagnostico_B = net(B).rxLine().slice(0, 220);
    // Lo pesado (una parte de llamada): ¿a qué relés va?
    const sent = [];
    const pubOrig = net(A)._publish.bind(net(A));
    net(A)._publish = function(ev, only) { sent.push({ id: ev.id, only }); return pubOrig(ev, only); };
    const heavy = async () => {
      sent.length = 0;
      await net(A).send(idB, JSON.stringify({ type: 'vf', c: 'cs000000000000', s: 1, d: 'AAAA' })).catch(() => {});
      await sleep(800);
      const id = sent.length ? sent[0].id : null;
      return { propio: own.events.some((e) => e.id === id), publicos: pubs.filter((x) => x.events.some((e) => e.id === id)).length };
    };
    if (mode === 'propio') {
      // P1: B lee del propio y de un público; trozos solo en el propio; él primero en el puntero; lo pesado solo a él
      m.P1_ok = m.suscripciones_B.own === 1 && m.suscripciones_B.pub === 1 && m.suscripciones_B.open === 2;
      m.P1_trozos_solo_en_propio = own.events.filter((e) => e.kind === 1064).length > 0 && pubs.every((x) => x.events.filter((e) => e.kind === 1064).length === 0);
      m.P1_propio_primero_en_puntero = !!ptr && ptr.relays[0] === OWN;
      m.P1_pesado = await heavy();
      m.P1_pesado_solo_propio = m.P1_pesado.propio && m.P1_pesado.publicos === 0;
      // P2: el propio se cae
      const port = Number(OWN.split(':').pop());
      await own.stop();
      const td = Date.now();
      m.P2_B_lee_todos_los_publicos_s = await waitFor(() => { const s = subs(B); return s.own === 0 && s.open >= 2 && s.pub === s.open; }, 10000);
      const txt = 'durante la caída del propio', ts = Date.now();
      sendText(A, txt);
      m.P2_texto_por_publicos_s = await waitFor(() => hasText(B, idA, txt), 20000);
      m.P2_texto_desde_la_caida_s = m.P2_texto_por_publicos_s === null ? null : Math.round((Date.now() - td) / 100) / 10;
      m.P2_texto_ms = m.P2_texto_por_publicos_s === null ? null : Date.now() - ts;
      m.P2_pesado = await heavy();
      m.P2_pesado_a_publicos = !m.P2_pesado.propio && m.P2_pesado.publicos >= 2;
      await sleep(4000);
      // P3: vuelve
      await own.start(port);
      m.P3_vuelve_al_propio_s = await waitFor(() => { const a = subs(A), b = subs(B); return net(A)._ownHealthy() && net(B)._ownHealthy() && a.own === 1 && b.own === 1 && a.pub === 1 && b.pub === 1; }, 30000);
      await sleep(5500); // el aviso «leo del propio» sale como mucho cada 5 s
      const ev0 = own.stats.published, txt2 = 'de vuelta por el propio', ts2 = Date.now();
      sendText(A, txt2);
      m.P3_texto_ms = (await waitFor(() => hasText(B, idA, txt2), 20000)) === null ? null : Date.now() - ts2;
      m.P3_texto_paso_por_el_propio = own.stats.published > ev0 && own.events.length > 0;
      m.P3_pesado = await heavy();
      m.P3_pesado_solo_propio = m.P3_pesado.propio && m.P3_pesado.publicos === 0;
      m.registro_propio = logs.filter((l) => /Relé propio/.test(l)).length;
    } else {
      // Sin propio: lo de siempre (4 públicos abiertos y suscritos, réplica ≥ 2, lo pesado a todos)
      m.S_como_siempre = m.reles === 'p1,p2,p3,p4' && m.suscripciones_B.own === 0 && m.suscripciones_B.pub === 4 && m.suscripciones_B.open === 4;
      m.S_replica = !!ptr && ptr.relays.length >= 2 && ptr.chunks.every((c) => c.r.length >= 2);
      m.S_pesado = await heavy();
      m.S_pesado_a_todos = !m.S_pesado.propio && m.S_pesado.publicos === 4;
    }
    shutdown(A); shutdown(B);
    for (const x of pubs.concat([own])) { try { await x.stop(); } catch (e) {} }
    await sleep(500);
  }
  r.publicos = modes.publicos; r.propio = modes.propio;
  const P = modes.publicos, O = modes.propio;
  const num = (v) => typeof v === 'number';
  r.mejora = {
    en_linea: num(O.M1_en_linea_s) && num(P.M1_en_linea_s) && O.M1_en_linea_s < P.M1_en_linea_s,
    texto: num(O.M2_texto_ms) && O.M2_texto_ms < 99999 && O.M2_texto_ms < P.M2_texto_ms,
    archivo: num(O.M3_archivo_s) && num(P.M3_archivo_s) && O.M3_archivo_s <= P.M3_archivo_s / 2,
    repetido: num(O.M4_repetido_kb) && O.M4_repetido_kb <= P.M4_repetido_kb / 2,
  };
  r.respaldo = {
    caida: O.P2_B_lee_todos_los_publicos_s !== null && O.P2_texto_por_publicos_s !== null && O.P2_texto_desde_la_caida_s <= 10 && O.P2_pesado_a_publicos,
    vuelta: O.P3_vuelve_al_propio_s !== null && O.P3_vuelve_al_propio_s <= 20 && O.P3_texto_ms !== null && O.P3_texto_paso_por_el_propio && O.P3_pesado_solo_propio,
  };
  const ok = r.emparejados_en_linea_s !== null && P.S_como_siempre && P.S_replica && P.S_pesado_a_todos && O.P1_ok && O.P1_trozos_solo_en_propio && O.P1_propio_primero_en_puntero && O.P1_pesado_solo_propio &&
    Object.values(r.mejora).every((v) => v === true) && Object.values(r.respaldo).every((v) => v === true);
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('RELEPROP ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_releprop.txt'), logs.join('\n'));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('RELEPROP ' + JSON.stringify({ prueba: 'releprop', resultado: 'FALLO', error: String(e && e.message) })); console.error(e && e.stack); fs.writeFileSync(path.join(__dirname, 'last_logs_releprop.txt'), logs.join('\n')); process.exit(1); });
