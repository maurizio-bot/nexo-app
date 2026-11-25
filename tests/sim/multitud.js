// Estudio EDC (dueño 17-11): MULTITUD por Bluetooth. El teléfono A (app real en Chromium, CPU frenada ×4 como uno de gama
// media) en medio de N teléfonos NEXO desconocidos que se anuncian. B (app real, contacto de A) está lejos con un mensaje
// pendiente y vuelve en medio de la multitud. Mide en A: lag del hilo de la interfaz, tareas largas, CPU, memoria del JS,
// tamaño de los mapas internos (todo Map/Set/array de bleInterface y de Jump), a quién intenta conectar, cuánto tarda en
// conectar y entregar a B, y qué pasa con «Agregar» abierto en la multitud.
//
// La multitud son «fantasmas» ligeros en Node (no corren la app): NativePhone del simulador que anuncian (con su NEXO ID
// visible —sin contactos o con «Agregar» abierto— o con código rotativo de clave real), con RSSI de −40 a −100 que varía,
// y algunos aparecen y desaparecen. Su «app» está dormida: el nativo contesta «quién soy» (setKxCard) y los pings, nada más
// (no hacen de puente Jump ni escriben). El escaneo los entrega como el Kotlin: uno por dispositivo y segundo
// (SCAN_DEBOUNCE_MS), repartidos en el segundo, y descarta los de RSSI < −95 (MIN_RSSI). Un escaneo dura 15 s
// (SCAN_TIMEOUT_MS; el simulador base usa 6).
//
// Modelo de la radio de Android (supuestos, ajustables): como mucho --max-links enlaces Bluetooth a la vez por teléfono
// (entrantes + salientes; Android ~7); con --serie, una conexión saliente a la vez (la siguiente espera a que termine la
// anterior); una conexión con quien ya no está (o con RSSI < −90) falla a los --fallo-ms (el Kotlin corta a los 15 s);
// una buena tarda --conn-ms.
//
// Uso: node multitud.js <dir_build> [--n=200] [--vis=0.2] [--flap=0.2] [--cerca=3] [--libreta=20] [--cpu=4] [--fase=40]
//        [--agregar=30] [--max-links=7] [--serie=1] [--conn-ms=800] [--fallo-ms=15000] [--scan-s=15] [--kx=1] [--multitud-b=1]
// --vueltas=3: veces que B se aleja y vuelve en la fase 2 (la 1.ª con un mensaje pendiente).
// --multitud-b=1: B también está en la multitud (su escaneo recibe a los mismos N); 0 = solo A la ve
// Salida: MULTITUD {json}
'use strict';
const fs = require('fs');
const path = require('path');
const nodeCrypto = require('crypto');
const { Radio, NativePhone } = require('./native_mock');
const { PW, bootPhone, cdpMetrics, phaseStart, phaseEnd, click, sleep } = require('./pw_harness');

const buildDir = path.resolve(process.argv[2] || path.join(__dirname, 'builds/wip'));
const dist = path.join(buildDir, 'dist');
const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith('--' + k + '=') || x === '--' + k); if (!a) return d; const v = a.split('=')[1]; return v === undefined ? true : Number(v); };
const N = arg('n', 200), VIS = arg('vis', 0.2), FLAP = arg('flap', 0.2), CERCA = arg('cerca', 3), LIBRETA = arg('libreta', 20);
const CPU = arg('cpu', 4), FASE = arg('fase', 40), AGREGAR = arg('agregar', 30), MAXL = arg('max-links', 7), SERIE = !!arg('serie', 1);
const CONN_MS = arg('conn-ms', 800), FALLO_MS = arg('fallo-ms', 15000), SCAN_S = arg('scan-s', 15), KX = !!arg('kx', 1), MIN_RSSI = arg('min-rssi', -95);
const SEED = arg('seed', 17), MULT_B = !!arg('multitud-b', 1), VUELTAS = arg('vueltas', 3);
// --b-dormido=1: B vuelve con el teléfono en el bolsillo (su app congelada: solo contesta su nativo y NO abre él el enlace): es A,
// con su cola de conexiones ocupada por la multitud, quien tiene que conectar. «Entregado» = la ✓✓ del nativo de B llega a A.
const B_DORMIDO = !!arg('b-dormido', 0);
const opts = { readsContentFallback: true, retain: ['onPayloadReceived'], closeOnNoService: true, pace: [15, 15], ioDelay: 25, asymmetric: true, supervisionMs: 3000 };
const logs = [];
const norm = (m) => String(m || '').replace(/[:\-.]/g, '').toLowerCase();
let _rnd = SEED >>> 0; const rnd = () => { _rnd = (_rnd * 1664525 + 1013904223) >>> 0; return _rnd / 4294967296; };
const B36 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const nxId = () => 'NX' + Array.from({ length: 8 }, () => B36[Math.floor(rnd() * 36)]).join('');
const mac = (i) => ['4E', (0x10 + (i >> 16 & 0xff)).toString(16).toUpperCase().padStart(2, '0').slice(-2), ((i >> 8) & 0xff).toString(16).toUpperCase().padStart(2, '0'), (i & 0xff).toString(16).toUpperCase().padStart(2, '0'), '5A', 'C3'].join(':');
function keyPair() { const e = nodeCrypto.createECDH('prime256v1'); e.generateKeys(); return e.getPublicKey().toString('base64'); }
const ridKeyOf = (pk) => nodeCrypto.createHash('sha256').update('nexo-rid-key|' + pk, 'utf8').digest('hex');
const q = (arr, x) => { if (!arr.length) return 0; const s = arr.slice().sort((a, b) => a - b); return Math.round(s[Math.min(s.length - 1, Math.floor(s.length * x))]); };

// ---- multitud ----
function makeGhost(radio, i, kind) {
  const id = nxId(), pk = keyPair();
  const g = new NativePhone('G' + i, mac(i + 1), { noRid: false });
  g.isGhost = true; g.kind = kind; g.pk = pk; g.nx = id;
  g.advertisingId = id; g.serviceRunning = false; // false: el escaneo base del simulador no los recorre (los entrega el emisor de abajo)
  g.serverUp = true; g.appActive = false;           // app dormida: el nativo contesta pings y «quién soy»
  g.calls = { push() {}, length: 0 };
  if (kind !== 'vis') { g.ridKey = ridKeyOf(pk); g.ridVisibleUntil = 0; g.ridEpochS = 900; }
  if (KX) g.kxCard = JSON.stringify({ v: 1, type: 'kx', from: id, pk, j: 1, fx: 3, ss: 1, nt: 1, bd: '3181', bf: 1, nm: 'Tel ' + i, bg: 1, nk: 1, lt: 1 });
  g.rssiBase = Math.round(-40 - rnd() * 60);  // −40 … −100
  g.flap = rnd() < FLAP;
  g.present = true;
  radio.add(g);
  return g;
}
function startCrowd(ghosts) {
  // aparecer / desaparecer (lo mismo para todos los que miran)
  const flapT = setInterval(() => {
    const now = Date.now();
    ghosts.forEach((g) => {
      if (!g.flap) return;
      if (!g.flipAt) g.flipAt = now + 8000 + rnd() * 22000;
      if (now < g.flipAt) return;
      g.present = !g.present; g.setOffline(!g.present);
      g.flipAt = now + (g.present ? 8000 + rnd() * 22000 : 5000 + rnd() * 20000);
    });
  }, 500);
  return () => clearInterval(flapT);
}
// Lo que el escaneo de un teléfono (A, y con --multitud-b también B) recibe de la multitud
function startEmitter(nA, ghosts, st) {
  const tokCache = new Map(), next = new Map();
  const advOf = (g) => {
    if (g.kind === 'vis') return g.nx;
    const ep = Math.floor(Date.now() / 1000 / 900), k = g.address + '|' + ep;
    let t = tokCache.get(k); if (!t) { t = g.advertised(); tokCache.set(k, t); }
    return t;
  };
  ghosts.forEach((g) => next.set(g, Date.now() + Math.floor(rnd() * 1000)));
  const emitT = setInterval(() => {
    const now = Date.now();
    if (!(nA.scanningUntil > now) || nA.offline) return;
    for (const g of ghosts) {
      if (next.get(g) > now) continue;
      next.set(g, now + 1000 + Math.floor(rnd() * 60) - 30); // SCAN_DEBOUNCE_MS: uno por segundo y dispositivo
      if (!g.present) continue;
      const rssi = Math.max(-104, Math.min(-35, g.rssiBase + Math.round((rnd() - 0.5) * 10)));
      if (nA.name === 'A') g.rssiNow = rssi;
      if (rssi < MIN_RSSI) { st.minRssiDrop = (st.minRssiDrop || 0) + 1; continue; } // Kotlin onScanResult: rssi < MIN_RSSI → fuera
      nA.scanned.add(norm(g.address));
      st.foundEv = (st.foundEv || 0) + 1;
      nA.emit('onDeviceFound', { deviceId: g.address, name: g.kind === 'vis' ? 'Tel ' + g.name.slice(1) : '', rssi, nexoId: advOf(g) });
    }
  }, 20);
  return () => clearInterval(emitT);
}

// ---- modelo de la radio de Android para los teléfonos con app (A y B) ----
function linkCount(n) { let c = 0; n.clients.forEach(() => c++); n.serverConnected.forEach(() => c++); return c; }
function installRadioModel(n, radio, st, classify) {
  const orig = NativePhone.prototype.plugin;
  let tail = Promise.resolve();
  // 3284: intentos en cola o en el aire; disconnectDevice los cancela (Kotlin: gatt.disconnect() + close() suelta el intento)
  const pend = new Map();
  n.calls = { push(c) { if (c && (c.name === 'startScan' || c.name === 'stopScan' || c.name === 'disconnectDevice')) st[c.name] = (st[c.name] || 0) + 1; }, length: 0, filter() { return []; }, slice() { return []; }, forEach() {}, map() { return []; }, some() { return false; }, find() { return undefined; } };
  n.plugin = function () {
    const api = orig.call(this);
    const oc = api.connectToDevice, os = api.startScan, od = api.disconnectDevice;
    api.disconnectDevice = (args = {}) => {
      const p = pend.get(norm(String(args.deviceId || args.address || '')));
      if (p && !p.cancelled) { p.cancelled = true; st.cancel = (st.cancel || 0) + 1; if (p.finish) p.finish(); }
      return od(args);
    };
    api.connectToDevice = (args = {}) => {
      const raw = String(args.deviceId || args.address || ''), m = norm(raw), peer = radio.byNorm(m);
      const kind = classify(peer, raw);
      st.conn[kind] = (st.conn[kind] || 0) + 1;
      st.connLog.push({ t: Date.now(), kind, rssi: peer && peer.rssiNow });
      const cl = n.clients.get(m);
      if (cl && (cl.state === 'connected' || cl.state === 'connecting')) return oc(args);
      const rec = { cancelled: false, finish: null };
      pend.set(m, rec);
      const run = () => new Promise((res0) => {
        const t0 = Date.now();
        let timer = null, done = false;
        const resolve = (v) => { if (done) return; done = true; if (pend.get(m) === rec) pend.delete(m); res0(v); };
        const gone = { connected: false, deviceId: raw, error: 'Connection cancelada (cede el paso)' };
        if (rec.cancelled) { resolve(gone); return; }
        rec.finish = () => { clearTimeout(timer); st.queueBusyMs += Date.now() - t0; resolve(gone); };
        const full = linkCount(n) >= MAXL || (peer && linkCount(peer) >= MAXL);
        if (MAXL && full) { st.rejTope++; setTimeout(() => resolve({ connected: false, deviceId: raw, error: 'Connection error 257 (tope de enlaces)' }), 300); return; }
        const absent = !peer || peer.offline || !radio.inRange(n, peer) || (peer.isGhost && (!peer.present || (peer.rssiNow || peer.rssiBase) < -90));
        if (absent) { timer = setTimeout(() => { st.fail++; st.queueBusyMs += Date.now() - t0; resolve({ connected: false, deviceId: raw, error: 'Connection error 133' }); }, FALLO_MS); return; }
        timer = setTimeout(() => { oc(args).then((r) => { st.queueBusyMs += Date.now() - t0; if (r && r.connected) st.ok++; resolve(r); }, (e) => resolve({ connected: false, deviceId: raw, error: String(e && e.message) })); }, CONN_MS);
      });
      if (!SERIE) return run();
      const qAt = Date.now();
      const p = tail.then(() => { st.queueWait.push(Date.now() - qAt); return run(); });
      tail = p.catch(() => {});
      return p;
    };
    // El Kotlin escanea 15 s (SCAN_TIMEOUT_MS) y avisa onScanStopped; el simulador base, 6 s
    api.startScan = (args = {}) => os(args).then((r) => {
      if (n.scanningUntil > Date.now()) {
        const until = Date.now() + SCAN_S * 1000; n.scanningUntil = until; clearTimeout(n._scanStopT);
        n._scanStopT = setTimeout(() => { if (n.scanningUntil === until) { n.scanningUntil = 0; n.scanned.clear(); n.emit('onScanStopped', { reason: 'timeout' }); } }, until - Date.now());
      }
      return r;
    });
    return api;
  };
  // el otro lado: una conexión ENTRANTE también ocupa un enlace del que la recibe
}

// ---- sondas dentro de la página de A ----
const SNAP = () => {
  const bi = window.bleInterface, r = (bi && bi.relay) || {};
  const sizes = {};
  const look = (o, pre) => { if (!o) return; Object.keys(o).forEach((k) => { let v; try { v = o[k]; } catch (e) { return; } if (v instanceof Map || v instanceof Set) sizes[pre + k] = v.size; else if (Array.isArray(v) && v.length > 0) sizes[pre + k] = v.length; }); };
  look(bi, ''); look(r, 'relay.'); if (bi && bi._ridBook) sizes['_ridBook.map'] = bi._ridBook.map.size;
  if (bi && bi.ackSystem) look(bi.ackSystem, 'ack.');
  const bar = document.getElementById('ble-new-device');
  return {
    sizes,
    dom: document.getElementsByTagName('*').length,
    filas_agregar: bar ? bar.querySelectorAll('.ble-found-row').length : 0,
    nota_identificando: (document.querySelector('#ble-new-device .ble-anon-note') || {}).textContent || '',
    escaneando: !!(bi && bi.isScanning),
  };
};

// Perfil por función (tiempo JS síncrono, inclusivo) de lo que el escaneo dispara en A
const PROF = () => {
  const bi = window.bleInterface, r = bi && bi.relay;
  window.__prof = {};
  const wrap = (obj, name, label) => { const f = obj && obj[name]; if (typeof f !== 'function') return; obj[name] = function () { const t = performance.now(); try { return f.apply(this, arguments); } finally { const p = window.__prof[label] || (window.__prof[label] = { n: 0, ms: 0 }); p.n++; p.ms += performance.now() - t; } }; };
  wrap(bi, '_onScanFound', '_onScanFound'); wrap(bi, 'onDeviceFound', 'onDeviceFound'); wrap(bi, 'renderNewDeviceBar', 'renderNewDeviceBar');
  wrap(bi, '_renderContactsListNow', 'renderContactsList'); wrap(bi, 'renderOnlineStrip', 'renderOnlineStrip'); wrap(bi, 'updateBadge', 'updateBadge');
  wrap(bi, 'renderPanelLists', 'renderPanelLists'); wrap(r, 'noteAnon', 'relay.noteAnon'); wrap(r, 'noteSeen', 'relay.noteSeen'); wrap(bi, '_identifyNearby', '_identifyNearby');
  return true;
};
const PROF_READ = () => JSON.parse(JSON.stringify(window.__prof || {}));

(async () => {
  const res = { prueba: 'multitud', build: path.basename(buildDir), n: N, visibles: VIS, intermitentes: FLAP, contactos_en_la_multitud: CERCA, libreta: LIBRETA, cpu_frenada: CPU + 'x', modelo: { max_enlaces: MAXL, conexiones_en_serie: SERIE, conn_ms: CONN_MS, fallo_ms: FALLO_MS, escaneo_s: SCAN_S, min_rssi: MIN_RSSI, fantasmas_contestan_quien_soy: KX }, B_tambien_en_la_multitud: MULT_B };
  const browser = await PW.chromium.launch();
  // SIN internet: lista de relés explícitamente vacía (si no, la app en Chromium sale a los relés públicos reales y lo
  // pendiente llega por internet en vez de por Bluetooth)
  const ctx = await browser.newContext();
  await ctx.addInitScript(() => { window.NEXO_NET_RELAYS = []; window.NEXO_SPARE_RELAYS = []; window.NEXO_OWN_RELAYS = []; });
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', opts), nB = new NativePhone('B', 'BB:BB:BB:BB:BB:02', opts);
  [nA, nB].forEach((n) => { radio.add(n); n.load(); });
  // Libreta de A: contactos de verdad (con clave pública) — CERCA de ellos estarán en la multitud, el resto lejos
  const contactGhosts = [];
  const book = [];
  for (let i = 0; i < CERCA + LIBRETA; i++) {
    const id = nxId(), pk = keyPair();
    book.push({ nexoId: id.toLowerCase(), deviceUUID: id.toLowerCase(), name: (i < CERCA ? 'Amigo ' : 'Libreta ') + i, publicKey: pk, addedAt: Date.now() - 86400000 * (i + 2), lastSeen: 0, online: false, unreadCount: 0, lastMessage: '', _id: id, _pk: pk });
  }
  nA.files.set('nexo_vault_contacts.json', JSON.stringify({ contacts: book.map((c) => { const o = Object.assign({}, c); delete o._id; delete o._pk; return o; }), savedAt: Date.now() }));
  const stA = { conn: {}, connLog: [], rejTope: 0, fail: 0, ok: 0, queueWait: [], queueBusyMs: 0, foundEv: 0, minRssiDrop: 0 };
  const stB = { conn: {}, connLog: [], rejTope: 0, fail: 0, ok: 0, queueWait: [], queueBusyMs: 0, foundEv: 0, minRssiDrop: 0 };
  const classify = (peer, raw) => {
    if (!peer) return /^(lan|net|wd)/i.test(raw) ? 'camino_no_bt' : 'desconocida';
    if (peer === nB) return 'contacto_B';
    if (peer === nA) return 'A';
    if (peer.isGhost) return peer.isContact ? 'contacto_en_multitud' : (peer.kind === 'vis' ? 'anonimo_visible' : 'anonimo_rotativo');
    return 'otro';
  };
  installRadioModel(nA, radio, stA, classify); installRadioModel(nB, radio, stB, classify);
  const bo = { cpuThrottle: CPU, logs, seedName: 'A' };
  const A = await bootPhone(ctx, 'A', nA, dist, bo);
  const B = await bootPhone(ctx, 'B', nB, dist, { logs, seedName: 'B', cpuThrottle: MULT_B ? CPU : 1 });
  res.arranque_A_ms = A.bootMs;
  const idB = (await B.page.evaluate(() => window.bleInterface.localNexoId)).toLowerCase();
  const idA = (await A.page.evaluate(() => window.bleInterface.localNexoId)).toLowerCase();
  // Emparejar A con B por la interfaz (como el usuario): «Agregar», buscar y «+»
  await A.page.evaluate(() => window.bleInterface.togglePanel());
  let paired = false;
  for (let i = 0; i < 200 && !paired; i++) {
    await sleep(250);
    paired = await A.page.evaluate(() => { const row = Array.from(document.querySelectorAll('#ble-new-device .ble-found-row')).find((r) => /(^|\s)B$/.test((r.querySelector('span') || {}).textContent || '')); const b = row && row.querySelector('button'); if (b) b.dispatchEvent(new MouseEvent('click', { bubbles: true })); return !!b; });
    if (!paired && !(await A.page.evaluate(() => window.bleInterface.isScanning))) await click(A.page, '#ble-scan-btn');
  }
  // (desde las solicitudes de contacto, 3190: «agregar» es pedir y que el otro acepte; se espera a que B esté de verdad en la lista)
  for (let i = 0; i < 120; i++) { await sleep(250); if (await A.page.evaluate(() => Array.from(document.querySelectorAll('#main-contacts-list .ble-contact-row')).some((x) => (x.querySelector('.ble-contact-name') || {}).textContent === 'B'))) break; }
  await sleep(1500);
  if (await A.page.evaluate(() => window.bleInterface.elements.panel.classList.contains('active'))) await A.page.evaluate(() => window.bleInterface.togglePanel());
  const openChat = (p, name) => p.page.evaluate((name) => { const r = Array.from(document.querySelectorAll('#main-contacts-list .ble-contact-row')).find((x) => (x.querySelector('.ble-contact-name') || {}).textContent === name); if (r) r.dispatchEvent(new MouseEvent('click', { bubbles: true })); return !!r; }, name);
  const closeChat = (p) => p.page.evaluate(() => { const b = document.getElementById('chat-back-btn'); if (b) b.dispatchEvent(new MouseEvent('click', { bubbles: true })); window.dispatchEvent(new CustomEvent('nexo:ble:closeChat', { detail: {} })); });
  const sendText = (p, t) => p.page.evaluate((t) => { const i = document.getElementById('message-input'); i.value = t; i.dispatchEvent(new Event('input', { bubbles: true })); document.getElementById('send-btn').dispatchEvent(new MouseEvent('click', { bubbles: true })); }, t);
  const inB = (prefix) => B.page.evaluate(async ([w, p]) => (await window.vaultLoadMessages(w)).some((m) => String(m.content || m.text || '').indexOf(p) === 0), [idA, prefix]);
  res.emparejado = paired && await openChat(A, 'B');
  await sleep(600); await sendText(A, 'hola B');
  let ok1 = false; for (let i = 0; i < 80 && !ok1; i++) { await sleep(250); ok1 = await inB('hola B'); }
  res.primer_mensaje_entregado = ok1;
  res.clave_de_B_en_A = await A.page.evaluate((idB) => !!(window.vaultLoadContacts() || []).find((c) => String(c.nexoId).toLowerCase() === idB && c.publicKey), idB);
  if (!ok1) { res.resultado = 'FALLO'; res.error = 'no empareja/entrega antes de la multitud'; console.log('MULTITUD ' + JSON.stringify(res)); fs.writeFileSync(path.join(__dirname, 'last_logs_multitud.txt'), logs.join('\n')); await browser.close(); process.exit(1); }
  await sleep(1000);
  // B se va lejos; A le escribe (queda pendiente) y vuelve a la lista
  radio.block(nA, nB);
  await sleep(1500);
  await sendText(A, 'pendiente para B'); await sleep(800); await closeChat(A); await sleep(1500);
  // La multitud
  const ghosts = [];
  for (let i = 0; i < N; i++) ghosts.push(makeGhost(radio, i, rnd() < VIS ? 'vis' : 'rot'));
  for (let i = 0; i < CERCA; i++) { // los contactos de A que están entre la multitud (anuncian con su código rotativo)
    const c = book[i], g = new NativePhone('K' + i, mac(900000 + i), {});
    g.isGhost = true; g.isContact = true; g.kind = 'rot'; g.nx = c._id; g.pk = c._pk; g.advertisingId = c._id; g.serviceRunning = false; g.serverUp = true; g.appActive = false;
    g.calls = { push() {}, length: 0 }; g.ridKey = ridKeyOf(c._pk); g.ridVisibleUntil = 0; g.ridEpochS = 900;
    if (KX) g.kxCard = JSON.stringify({ v: 1, type: 'kx', from: c._id, pk: c._pk, j: 1, fx: 3, ss: 1, nt: 1, bd: '3181', bf: 1, nm: c.name, bg: 1, nk: 1, lt: 1 });
    g.rssiBase = -55 - Math.round(rnd() * 20); g.flap = false; g.present = true;
    radio.add(g); ghosts.push(g); contactGhosts.push(g);
  }
  await A.page.evaluate(PROF);
  res.multitud = { anonimos_visibles: ghosts.filter((g) => !g.isContact && g.kind === 'vis').length, anonimos_rotativos: ghosts.filter((g) => !g.isContact && g.kind === 'rot').length, intermitentes: ghosts.filter((g) => g.flap).length, bajo_min_rssi: ghosts.filter((g) => g.rssiBase < MIN_RSSI).length };
  const stopFlap = startCrowd(ghosts), stopEmitA = startEmitter(nA, ghosts, stA), stopEmitB = MULT_B ? startEmitter(nB, ghosts, stB) : () => {};
  const stopCrowd = () => { stopFlap(); stopEmitA(); stopEmitB(); };
  // contar eventos que cruzan el puente hacia A
  const ev = {}; const oEmit = nA.emit.bind(nA); let bSeenAt = 0; nA.emit = (e, d) => { ev[e] = (ev[e] || 0) + 1; if (e === 'onDeviceFound' && !bSeenAt && d && norm(d.deviceId) === norm(nB.address) && radio.inRange(nA, nB)) bSeenAt = Date.now(); return oEmit(e, d); };
  const linksOf = (n) => { const o = {}; n.clients.forEach((cl) => { const k = classify(cl.peer, ''); o[k] = (o[k] || 0) + 1; }); n.serverConnected.forEach((p) => { const k = classify(p, ''); o[k] = (o[k] || 0) + 1; }); return o; };
  const phase = async (name, ms, during) => {
    const ev0 = Object.assign({}, ev), c0 = JSON.parse(JSON.stringify(stA.conn)), s0 = { scans: stA.startScan || 0, fail: stA.fail, rej: stA.rejTope, ok: stA.ok, qw: stA.queueWait.length, cancel: stA.cancel || 0 };
    const snap0 = await A.page.evaluate(SNAP); const prof0 = await A.page.evaluate(PROF_READ);
    const st = await phaseStart([A]);
    const samples = []; const t0 = Date.now(); let extra = null;
    const sampler = (async () => { while (Date.now() - t0 < ms) { await sleep(5000); samples.push({ t: Math.round((Date.now() - t0) / 1000), links: linksOf(nA), heap: Math.round((await cdpMetrics(A)).JSHeapUsedSize / 1048576 * 10) / 10 }); } })();
    if (during) extra = await during(t0);
    await sampler;
    const out = await phaseEnd([A], st);
    const snap1 = await A.page.evaluate(SNAP); const prof1 = await A.page.evaluate(PROF_READ);
    const r = Object.assign({}, out.A, { segundos: out.segundos });
    r.eventos_al_js = {}; Object.keys(ev).forEach((k) => { const d = ev[k] - (ev0[k] || 0); if (d) r.eventos_al_js[k] = d; });
    r.onDeviceFound_por_s = Math.round((r.eventos_al_js.onDeviceFound || 0) / out.segundos);
    if (r.eventos_al_js.onDeviceFound) r.js_us_por_evento = Math.round(r.js_s * 1e6 / r.eventos_al_js.onDeviceFound);
    r.conexiones_pedidas = {}; Object.keys(stA.conn).forEach((k) => { const d = stA.conn[k] - (c0[k] || 0); if (d) r.conexiones_pedidas[k] = d; });
    r.conexiones = { ok: stA.ok - s0.ok, fallidas_ausente_o_lejos: stA.fail - s0.fail, rechazadas_por_tope: stA.rejTope - s0.rej, ceden_el_paso: (stA.cancel || 0) - (s0.cancel || 0) };
    const qw = stA.queueWait.slice(s0.qw); r.espera_en_cola_conexion_ms = { n: qw.length, p50: q(qw, 0.5), p95: q(qw, 0.95), max: qw.length ? Math.max(...qw) : 0 };
    r.escaneos_iniciados = (stA.startScan || 0) - s0.scans;
    r.enlaces_de_A = samples.map((s) => s.links);
    r.heap_MB_serie = samples.map((s) => s.heap);
    // los mapas que más crecieron en la fase
    const grow = Object.keys(snap1.sizes).map((k) => [k, snap1.sizes[k], snap1.sizes[k] - (snap0.sizes[k] || 0)]).filter((x) => x[1] >= 20 || x[2] >= 10).sort((a, b) => b[1] - a[1]).slice(0, 18);
    r.mapas = Object.fromEntries(grow.map((x) => [x[0], x[1] + (x[2] ? ' (' + (x[2] > 0 ? '+' : '') + x[2] + ')' : '')]));
    r.perfil_js = {}; Object.keys(prof1).forEach((k) => { const n = prof1[k].n - ((prof0[k] || {}).n || 0), ms = prof1[k].ms - ((prof0[k] || {}).ms || 0); if (n) r.perfil_js[k] = { llamadas: n, ms: Math.round(ms) }; });
    r.dom_nodos = snap1.dom; r.filas_agregar = snap1.filas_agregar; if (snap1.nota_identificando) r.nota = snap1.nota_identificando;
    if (extra) Object.assign(r, extra);
    res[name] = r;
    console.log('MULTITUD_FASE ' + JSON.stringify({ fase: name, n: N, r })); // por si la app se cuelga y la prueba no llega al final
  };
  // F1: reposo en la multitud (lista de contactos, «Agregar» cerrado; A busca a B y a sus contactos)
  await phase('f1_reposo', FASE * 1000);
  // F2: B vuelve en medio de la multitud: ¿cuánto tarda A en tener enlace con B y entregarle lo pendiente?
  await phase('f2_contacto_vuelve', 0, async (t0) => {
    if (B_DORMIDO) { nB.setAppActive(false); nB.setFrozen(true); }
    nB.opts.rssi = -62; radio.unblock(nA, nB); bSeenAt = 0;
    let listo = null, entregado = null;
    const okEnA = () => A.page.evaluate(async (nx) => (await window.vaultLoadMessages(nx)).some((m) => m._own && String(m.content || m.text || '').indexOf('pendiente para B') === 0 && (m.status === 'delivered' || m.status === 'read')), idB);
    while (Date.now() - t0 < 120000 && entregado === null) {
      await sleep(250);
      if (listo === null && await A.page.evaluate((nx) => !!window.bleInterface._bleReadyFor(nx), idB)) listo = Date.now() - t0;
      if (entregado === null && (B_DORMIDO ? await okEnA() : await inB('pendiente para B'))) entregado = Date.now() - t0;
    }
    if (B_DORMIDO) { nB.setFrozen(false); nB.setAppActive(true); await sleep(1500); }
    const out = { B_visto_en_escaneo_s: bSeenAt ? Math.round((bSeenAt - t0) / 100) / 10 : 'NO', B_enlace_listo_s: listo === null ? 'NO (120 s)' : Math.round(listo / 100) / 10, B_pendiente_entregado_s: entregado === null ? 'NO (120 s)' : Math.round(entregado / 100) / 10 };
    // más vueltas: B se aleja 20 s y vuelve; ¿cuánto tarda el enlace? (varía según qué huecos y qué cola de conexión encuentra)
    out.vueltas_enlace_listo_s = [out.B_enlace_listo_s];
    for (let k = 2; k <= VUELTAS; k++) {
      radio.block(nA, nB); await sleep(20000);
      const t1 = Date.now(); radio.unblock(nA, nB); bSeenAt = 0; let l2 = null;
      while (Date.now() - t1 < 90000 && l2 === null) { await sleep(250); if (await A.page.evaluate((nx) => !!window.bleInterface._bleReadyFor(nx), idB)) l2 = Date.now() - t1; }
      out.vueltas_enlace_listo_s.push(l2 === null ? 'NO (90 s)' : Math.round(l2 / 100) / 10);
    }
    return out;
  });
  // contactos de A en la multitud: ¿enlazados?
  res.contactos_en_multitud_enlazados = await A.page.evaluate((ids) => ids.filter((nx) => !!window.bleInterface._bleReadyFor(nx)).length, contactGhosts.map((g) => g.nx.toLowerCase()));
  // F3: «Agregar» abierto en la multitud (escaneo del usuario, NEXO ID visible, identificar a los cercanos)
  await A.page.evaluate(() => window.bleInterface.togglePanel());
  await phase('f3_agregar_abierto', AGREGAR * 1000);
  await A.page.evaluate(() => window.bleInterface.togglePanel());
  stopCrowd();
  res.nativo_A = { scanned_en_curso: nA.scanned.size, eventos_onDeviceFound_total: ev.onDeviceFound || 0, descartados_por_min_rssi: stA.minRssiDrop };
  res.conexiones_B = { pedidas: stB.conn, ok: stB.ok, rechazadas_por_tope: stB.rejTope };
  res.contactos_vs_anonimos = { primeras_10_conexiones_de_A: stA.connLog.slice(0, 10).map((c) => c.kind) };
  res.errores_pagina = logs.filter((l) => /PAGEERROR/.test(l)).slice(0, 5);
  res.resultado = 'MEDIDO';
  console.log('MULTITUD ' + JSON.stringify(res));
  fs.writeFileSync(process.env.SIM_LOG || path.join(__dirname, 'last_logs_multitud.txt'), logs.join('\n'));
  await ctx.close(); await browser.close();
  process.exit(0);
})().catch((e) => { console.log('MULTITUD ' + JSON.stringify({ prueba: 'multitud', resultado: 'FALLO', error: String(e && e.message).substring(0, 300) })); console.error(e && e.stack); fs.writeFileSync(path.join(__dirname, 'last_logs_multitud.txt'), logs.join('\n')); process.exit(1); });
