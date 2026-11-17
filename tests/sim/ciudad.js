// CIUDAD (dueño 17-11: «una simulación donde cada quien tenga un dispositivo y empiecen a realizar todas las funciones de NEXO
// el uno con el otro de forma masiva para ver qué pasa»). Muchos teléfonos (jsdom + native_mock + relés locales) en un MAPA:
// caminan, entran y salen del alcance Bluetooth (radio.block/unblock por distancia), entran en redes Wi-Fi (casa, oficina), su
// internet se va y vuelve, a ratos la app pasa a segundo plano, se duerme o se cierra y se reabre; uno o dos no tienen internet
// propio (puentes y Jump). Al principio se juntan para emparejarse (cada uno con varios contactos) y crear grupos; luego cada uno
// hace cosas AL AZAR con pesos: texto corto y largo, foto, archivo chico y mediano, nota de voz, «ver una vez», mensaje y adjunto
// de grupo, estado (publicar y me gusta), reacción, editar, borrar para todos, reenviar y abrir chats (el «leído»). Las llamadas
// NO (WebRTC no corre en jsdom). Al final, «todos juntos y con internet» unos minutos para que lo pendiente se entregue.
// El JUEZ registra cada envío (id, de, para/grupo, tipo, hash del contenido, hora) y al final mira lo GUARDADO (disco del
// nativo, tras volcar) de cada teléfono: llegó a cada destinatario exactamente una vez, contenido idéntico (hash), ediciones,
// borrados y reacciones iguales en los dos lados, estado del emisor ni ✗ ni ⏳ (y leído si el otro abrió el chat), grupos a todos
// los miembros, estados y «me gusta» entregados; ninguna excepción en los registros; como mucho un enlace Bluetooth por par;
// ningún mensaje reenviado sin límite; temporizadores de cada teléfono acotados. Estadísticas: % entregado, p50/p95 por camino,
// bytes de radio por byte útil. Misma semilla = mismo guion (mapa, caminos, cortes, acciones); los tiempos reales varían.
// Control del juez: --sabotaje=pierde|duplica|corrompe estropea A PROPÓSITO un mensaje recibido en el disco de un teléfono (lo
// quita, lo copia con otro id o cambia un byte) y lo reinicia: el juez TIENE que encontrarlo (si no, el juez está mal).
// Uso: node ciudad.js <dir_build> [--n=12] [--seed=1] [--min=10] [--final=4] [--ritmo=20] [--sabotaje=pierde|duplica|corrompe]
//      [--final-red=wifi|datos] [--logs=last_logs_ciudad.txt] [--solo-guion]   Salida: línea «CIUDAD {json}» y código 0 (OK) / 1 (FALLO).
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone, installWebCrypto, norm } = require('./native_mock');
const { NostrRelay } = require('./nostr_relay');

// ---------- parámetros ----------
const argv = process.argv.slice(2);
const flag = (k, d) => { const a = argv.find((x) => x === '--' + k || x.startsWith('--' + k + '=')); if (!a) return d; const v = a.split('=').slice(1).join('='); return v === '' ? true : v; };
const buildDir = path.resolve(argv.find((x) => !x.startsWith('--')) || path.join(__dirname, 'builds/wip'));
const N = Math.max(3, +flag('n', 12)), SEED = +flag('seed', 1) >>> 0, MIN = +flag('min', 10), FINAL_MIN = +flag('final', 4);
const RITMO = +flag('ritmo', 20);             // segundos medios entre acciones de un mismo teléfono
const SAB = String(flag('sabotaje', '') || '');
const FINAL_RED = String(flag('final-red', 'wifi'));   // fase final: 'wifi' (todos en el Wi-Fi «casa», con internet) o 'datos' (todos con datos móviles)
const LOGF = path.resolve(flag('logs', path.join(__dirname, 'last_logs_ciudad.txt')));
const ACT_S = MIN * 60, FIN_S = FINAL_MIN * 60;
const relB = path.relative(path.join(__dirname, '..', '..'), buildDir);
const CMD = 'node tests/sim/ciudad.js ' + (relB.startsWith('..') ? buildDir : relB) + ' --n=' + N + ' --seed=' + SEED + ' --min=' + MIN + ' --final=' + FINAL_MIN + (RITMO !== 20 ? ' --ritmo=' + RITMO : '') + (SAB ? ' --sabotaje=' + SAB : '') + (FINAL_RED !== 'wifi' ? ' --final-red=' + FINAL_RED : '');

// ---------- azar con semilla (mulberry32), un flujo por uso ----------
function mulberry32(a) { return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const rng = (k) => mulberry32((SEED * 2654435761 + k * 40503) >>> 0);
const RW = rng(1), RS = rng(2), RA = rng(3), RC = rng(4);
const pick = (r, a) => a[Math.floor(r() * a.length) % a.length];
const between = (r, a, b) => a + r() * (b - a);
const expo = (r, mean) => -Math.log(1 - r()) * mean;
const WORDS = 'casa sol luna mar río pan café verde rojo azul calle plaza perro gato libro mesa tren auto lluvia nube fiesta música baile cena hoy mañana tarde noche amigo hermana mamá papá trabajo escuela parque playa monte campo ciudad pueblo'.split(' ');
const words = (r, n) => Array.from({ length: n }, () => pick(r, WORDS)).join(' ');
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex').substring(0, 16);
const NAMES = ['Ana', 'Beto', 'Carla', 'Dani', 'Eva', 'Fede', 'Gabi', 'Hugo', 'Ines', 'Juan', 'Kike', 'Lola', 'Memo', 'Nora', 'Oscar', 'Paty', 'Quique', 'Rosa', 'Saul', 'Tere'];

// ---------- registro ----------
const T0 = Date.now();
const tsec = () => (Date.now() - T0) / 1000;
const ts = () => tsec().toFixed(1).padStart(7) + 's';
const LOG = [];
const LOGW = fs.createWriteStream(LOGF);   // a disco según pasa (si la máquina se reinicia, queda lo que hubo)
function log(name, lvl, msg) { const l = ts() + ' [' + name + '] ' + lvl + ': ' + msg; LOG.push(l); LOGW.write(l + '\n'); }
const sim = (msg) => log('SIM', 'info', msg);
process.on('unhandledRejection', (e) => log('NODE', 'UNHANDLED', String(e && (e.stack || e.message) || e).split('\n').slice(0, 3).join(' | ')));
process.on('uncaughtException', (e) => log('NODE', 'UNCAUGHT', String(e && (e.stack || e.message) || e).split('\n').slice(0, 3).join(' | ')));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TAG = (p) => 'p=' + p.name + '_';   // etiqueta de las conexiones a los relés de un teléfono (ver boot)
class DL extends ResourceLoader { constructor(d) { super(); this.d = d; } fetch(u) { const f = path.join(this.d, decodeURIComponent(new URL(u).pathname)); return fs.existsSync(f) ? Promise.resolve(fs.readFileSync(f)) : Promise.reject(new Error('x')); } }
class NoNetWS { constructor(u) { this.url = u; this.readyState = 0; setTimeout(() => { this.readyState = 3; if (this.onerror) this.onerror({}); if (this.onclose) this.onclose({ code: 1006 }); }, 30); } send() { throw new Error('sin red'); } close() {} addEventListener() {} removeEventListener() {} }

// ---------- el mundo ----------
const W = 160, H = 160, BT_RANGE = 40;
const PLACES = { casa: { x: 30, y: 30, r: 24, wifi: 'casa' }, oficina: { x: 130, y: 130, r: 24, wifi: 'oficina' }, plaza: { x: 130, y: 30, r: 15 }, parque: { x: 30, y: 130, r: 15 }, centro: { x: 80, y: 80, r: 12 } };
const base = { readsContentFallback: true, retain: ['onPayloadReceived', 'onLanMessage', 'onLanUp', 'onLanDown'], closeOnNoService: true, pace: [15, 15], ioDelay: 25, asymmetric: true, noTor: true };
let RELAYS = [], relays = [];
const radio = new Radio();
const phones = [];

function makeProfiles() {
  const noNet = N >= 10 ? [0, 7] : [0];
  for (let i = 0; i < N; i++) {
    const name = NAMES[i] || ('T' + i);
    const mac = 'C1:7A:00:00:' + (0x10 + i).toString(16).toUpperCase().padStart(2, '0') + ':' + (0x20 + i).toString(16).toUpperCase().padStart(2, '0');
    const sinNet = noNet.includes(i);
    const wifis = sinNet ? [] : [RS() < 0.6 ? 'casa' : null, RS() < 0.45 ? 'oficina' : null].filter(Boolean);
    const intermitente = !sinNet && RS() < 0.35;     // datos que se caen mucho (mitad del tiempo)
    phones.push({ i, name, mac, sinNet, datos: !sinNet, intermitente, wifis, contacts: new Set(), groups: new Set(), ls: {}, app: 'fg', vis: 'visible', noNet: true, net: { type: 'none', zone: null },
      tm: null, plan: [], dataOff: [], life: [], acts: [], busy: false, boots: 0, stats: { acciones: 0, omitidas: 0, fallidas: 0 }, attempts: new Map(), tmSamples: [] });
  }
}

// Caminos: de lugar en lugar (70 %) o a un punto al azar, a 1–2 m/s, con paradas de 20–120 s. Posición = función del tiempo.
function makePlans() {
  phones.forEach((p) => {
    let t = 0, x = PLACES.centro.x + between(RW, -10, 10), y = PLACES.centro.y + between(RW, -10, 10);
    p.plan.push({ t0: -1e9, t1: 0, x0: x, y0: y, x1: x, y1: y });
    while (t < ACT_S) {
      const stay = between(RW, 20, 120);
      p.plan.push({ t0: t, t1: t + stay, x0: x, y0: y, x1: x, y1: y }); t += stay;
      let nx, ny;
      if (RW() < 0.7) { const pl = PLACES[pick(RW, ['casa', 'casa', 'casa', 'oficina', 'oficina', 'oficina', 'plaza', 'plaza', 'parque', 'centro', 'centro'])]; nx = pl.x + between(RW, -pl.r * 0.7, pl.r * 0.7); ny = pl.y + between(RW, -pl.r * 0.7, pl.r * 0.7); }
      else { nx = between(RW, 5, W - 5); ny = between(RW, 5, H - 5); }
      const d = Math.hypot(nx - x, ny - y), v = between(RW, 1, 2), dur = Math.max(1, d / v);
      p.plan.push({ t0: t, t1: t + dur, x0: x, y0: y, x1: nx, y1: ny }); t += dur; x = nx; y = ny;
    }
  });
}
function posAt(p, t) {
  if (FINALE) return p.finalPos;
  const s = p.plan.find((q) => t >= q.t0 && t < q.t1) || p.plan[p.plan.length - 1];
  const f = s.t1 > s.t0 ? Math.min(1, Math.max(0, (t - s.t0) / (s.t1 - s.t0))) : 1;
  return { x: s.x0 + (s.x1 - s.x0) * f, y: s.y0 + (s.y1 - s.y0) * f };
}
// Internet de datos que se va y vuelve (15–80 s cada ~2 min); ciclo de la app: segundo plano, dormida (congelada) o cerrada
function makeSchedules() {
  phones.forEach((p) => {
    if (p.datos) { const gap = p.intermitente ? 60 : 120, lo = p.intermitente ? 30 : 15, hi = p.intermitente ? 120 : 80; let t = expo(RS, gap); while (t < ACT_S) { const d = between(RS, lo, hi); p.dataOff.push({ t0: t, t1: t + d }); t += d + expo(RS, gap); } }
    let t = 40 + expo(RS, 150);
    while (t < ACT_S - 30) {
      const k = RS(), kind = k < 0.45 ? 'fondo' : k < 0.7 ? 'dormida' : 'cerrada';
      const d = kind === 'fondo' ? between(RS, 20, 90) : kind === 'dormida' ? between(RS, 30, 90) : between(RS, 40, 150);
      p.life.push({ t0: t, t1: Math.min(t + d, ACT_S - 5), kind }); t += d + 20 + expo(RS, 180);
    }
  });
}
const KINDS = [['texto', 22], ['largo', 6], ['foto', 6], ['archivo', 5], ['archivo_mediano', 2], ['voz', 4], ['grupo_texto', 10], ['grupo_adjunto', 3],
  ['estado', 3], ['estado_ver', 4], ['reaccion', 6], ['editar', 4], ['borrar', 3], ['reenviar', 4], ['unavez', 2], ['abrir', 8]];
const KW = KINDS.reduce((s, k) => s + k[1], 0);
function makeActions() {
  phones.forEach((p) => {
    let t = 15 + p.i * 1.5 + expo(RA, RITMO / 2);
    while (t < ACT_S - 10) {
      let x = RA() * KW, kind = KINDS[0][0];
      for (const [k, w] of KINDS) { if (x < w) { kind = k; break; } x -= w; }
      p.acts.push({ t, kind, r: [RA(), RA(), RA(), RA(), RA(), RA()] });
      t += Math.max(3, expo(RA, RITMO));
    }
  });
}
// Contactos: anillo + cuerdas al azar (cada uno con 3–6); el de índice menor agrega al otro por Bluetooth
function makeContactGraph() {
  const E = new Set(), key = (a, b) => (a < b ? a + '-' + b : b + '-' + a);
  for (let i = 0; i < N; i++) E.add(key(i, (i + 1) % N));
  const deg = (i) => Array.from(E).filter((e) => e.split('-').map(Number).includes(i)).length;
  for (let i = 0; i < N; i++) {
    const want = 3 + Math.floor(RC() * 3);
    for (let tries = 0; deg(i) < want && tries < 30; tries++) { const j = Math.floor(RC() * N); if (j !== i && deg(j) < 6) E.add(key(i, j)); }
  }
  return Array.from(E).map((e) => e.split('-').map(Number)).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
}

// ---------- arrancar un teléfono (jsdom con el bundle real) ----------
let html = null;
async function boot(p) {
  if (!html) html = fs.readFileSync(path.join(buildDir, 'dist', 'index.html'), 'utf8');
  p.native.listeners = new Map();
  p.native.calls = { push() {}, length: 0, filter() { return []; }, slice() { return []; }, forEach() {}, map() { return []; }, some() { return false; }, find() { return undefined; } };
  const vc = new VirtualConsole();
  ['log', 'info', 'warn', 'error'].forEach((l) => vc.on(l, (...a) => log(p.name, l, a.map(String).join(' ').substring(0, 300))));
  vc.on('jsdomError', (e) => {
    const m = String((e && e.message) || e);
    if (/Could not load link|styles\.css|Not implemented|Could not parse CSS/.test(m)) return;
    const st = e && e.detail && (e.detail.stack || e.detail.message) ? String(e.detail.stack || e.detail.message) : '';
    log(p.name, 'PAGEERROR', m.substring(0, 200) + (st ? ' | ' + st.split('\n').slice(0, 3).join(' | ').substring(0, 300) : ''));
  });
  p.vis = 'visible';
  const dom = new JSDOM(html, {
    url: 'https://' + p.name.toLowerCase() + '.nexo.test/index.html', runScripts: 'dangerously', resources: new DL(path.join(buildDir, 'dist')), pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) {
      // Las mismas direcciones de relé para todos (como los relés públicos); la etiqueta del teléfono que ABRE la conexión va solo en
      // la conexión real (así el simulador corta/duerme las conexiones de ese teléfono y no las que otro abrió al mismo relé)
      win.NEXO_NET_RELAYS = RELAYS.slice();
      win.CapacitorCustomPlatform = { name: 'android' }; installWebCrypto(win);
      win.Capacitor = { Plugins: { NexoBLE: p.native.plugin() } };
      win.HTMLElement.prototype.scrollTo = function () {};
      try { Object.defineProperty(win.navigator, 'clipboard', { value: { writeText: async () => {} } }); } catch (e) {}
      Object.defineProperty(win.document, 'visibilityState', { configurable: true, get: () => p.vis });
      Object.defineProperty(win.document, 'hidden', { configurable: true, get: () => p.vis === 'hidden' });
      let nUrl = 0; win.URL.createObjectURL = () => 'blob:sim/' + (++nUrl); win.URL.revokeObjectURL = () => {};
      // Micrófono de mentira (como voicenote.js): la grabación entrega los bytes que la prueba dejó en p.nextVoice
      win.navigator.mediaDevices = { getUserMedia: () => Promise.resolve({ getTracks: () => [{ readyState: 'live', stop() {} }] }) };
      win.MediaRecorder = class {
        constructor() { this.state = 'inactive'; }
        static isTypeSupported(t) { return t === 'audio/webm'; }
        start() { this.state = 'recording'; }
        pause() { if (this.state === 'recording') this.state = 'paused'; }
        resume() { if (this.state === 'paused') this.state = 'recording'; }
        requestData() { if (this.ondataavailable && p.nextVoice) { const b = p.nextVoice; p.nextVoice = null; this.ondataavailable({ data: new win.Blob([b], { type: 'audio/webm' }) }); } }
        stop() { if (this.state !== 'inactive') this.requestData(); this.state = 'inactive'; if (this.onstop) this.onstop(); }
      };
      // Internet que se va y vuelve: sin red, ninguna conexión nueva a los relés abre
      const Real = win.WebSocket;
      const tagged = (u) => { try { const x = new URL(String(u)); if (x.hostname === '127.0.0.1') { x.searchParams.set('p', p.name + '_'); return x.toString(); } } catch (e) {} return u; };
      const WS = function (u, pr) { if (p.noNet) return new NoNetWS(u); return pr ? new Real(tagged(u), pr) : new Real(tagged(u)); };
      WS.CONNECTING = 0; WS.OPEN = 1; WS.CLOSING = 2; WS.CLOSED = 3; WS.prototype = Real.prototype;
      win.WebSocket = WS;
      // localStorage del teléfono: sigue tras cerrar y reabrir la app (en jsdom cada ventana empieza vacía)
      try { Object.keys(p.ls).forEach((k) => win.localStorage.setItem(k, p.ls[k])); } catch (e) {}
      // Temporizadores vivos de este teléfono (memoria acotada: no deben crecer sin fin)
      const tm = p.tm = { to: new Set(), iv: new Set() };
      const st0 = win.setTimeout, ct0 = win.clearTimeout, si0 = win.setInterval, ci0 = win.clearInterval;
      win.setTimeout = function (fn, ms, ...args) { let h = null; h = st0.call(win, function () { tm.to.delete(h); if (typeof fn === 'function') return fn.apply(this, args); }, ms); tm.to.add(h); return h; };
      win.clearTimeout = function (h) { tm.to.delete(h); tm.iv.delete(h); return ct0.call(win, h); };
      win.setInterval = function (fn, ms, ...args) { const h = si0.call(win, fn, ms, ...args); tm.iv.add(h); return h; };
      win.clearInterval = function (h) { tm.iv.delete(h); tm.to.delete(h); return ci0.call(win, h); };
    },
  });
  const win = dom.window;
  for (let i = 0; i < 150 && !(win.NEXO && win.NEXO.initialized); i++) await sleep(100);
  await sleep(800);
  p.win = win; p.boots++;
  const bi = win.bleInterface;
  p.nx = String(bi.localNexoId || '').toLowerCase();
  hookPhone(p);
  return p;
}
function setVis(p, active) { p.vis = active ? 'visible' : 'hidden'; try { p.win.document.dispatchEvent(new p.win.Event('visibilitychange')); } catch (e) {} p.native.setAppActive(active); }

// Ganchos del juez: por dónde llegó cada mensaje y cuántas veces sale cada uno
const ARRIVALS = new Map(); // phone|messageId → { t, via }
const VIA = new Map();      // phone|messageId → camino visto en _handlePayload
function viaOf(d) {
  if (!d) return '?';
  if (d.viaRelay) return 'jump';
  const id = String(d.deviceId || '');
  if (/^lan:/i.test(id)) return 'wifi';
  if (/^net:/i.test(id)) return d._blobResolved ? 'internet(buzón)' : 'internet';
  if (d.source === 'closed') return 'bluetooth(app cerrada)';
  if (!id) return 'reenviado (Jump/puente, sin dispositivo)';
  return /^[0-9a-f]{2}(:[0-9a-f]{2}){5}$/i.test(id) ? 'bluetooth' : 'otro:' + id.substring(0, 6);
}
function hookPhone(p) {
  const bi = p.win.bleInterface;
  const hp = bi._handlePayload;
  bi._handlePayload = function (d) {
    try { const c = String((d && (d.content || d.data)) || ''); const m = /"msgId":"([^"]{6,80})"/.exec(c); if (m && !VIA.has(p.name + '|' + m[1])) VIA.set(p.name + '|' + m[1], viaOf(d)); } catch (e) {}
    return hp.apply(this, arguments);
  };
  p.win.addEventListener('nexo:ble:messageReceived', (e) => {
    const d = (e && e.detail) || {}; const id = d.messageId; if (!id) return;
    const k = p.name + '|' + id;
    if (!ARRIVALS.has(k)) ARRIVALS.set(k, { t: tsec(), via: VIA.get(k) || viaOf(d) });
  });
  // Trazas del simulador (no cambian nada): acciones ocultas que salen y llegan, acuses de leído/entrega
  const tr = (m) => log(p.name, 'traza', m);
  const scm = bi.sendChatMessage;
  bi.sendChatMessage = function (to, content, id) {
    try { const c = String(content || ''); if (c.indexOf('"nexo_act"') >= 0) { const o = JSON.parse(c); if (o && /^(react|edit|del|st|sl)$/.test(o.act)) tr('acción→ ' + nameOf(to) + ' ' + o.act + ' ' + (o.id || o.sid || '') + ' (' + id + ')'); } } catch (e) {}
    return scm.apply(this, arguments);
  };
  const ack = bi.ackSystem;
  if (ack) {
    const srr = ack.sendReadReceipt;
    if (typeof srr === 'function') ack.sendReadReceipt = function (dev, id, route) { if (/^(msg|gm)/.test(String(id))) tr('leído→ ' + id + ' por ' + (route ? 'ruta ' + route : String(dev || 'sin camino'))); return srr.apply(this, arguments); };
    const pia = ack.processIncomingAck;
    if (typeof pia === 'function') ack.processIncomingAck = function (content) { try { const o = JSON.parse(String(content)); if (/^(msg|gm)/.test(String(o.msgId)) && (o.type === 'read_receipt' || o.type === 'ack')) tr((o.type === 'ack' ? 'entregado← ' : 'leído← ') + o.msgId + ' de ' + nameOf(o.from) + (o.a ? '' : ' (sin firma)')); } catch (e) {} return pia.apply(this, arguments); };
  }
  const hp2 = bi._handlePayload;
  bi._handlePayload = function (d) {
    try { const c = String((d && (d.content || d.data)) || ''); if (c.indexOf('nexo_act') >= 0) { const m = /act\\?":\\?"(react|edit|del|st|sl)\\?"(?:,\\?"(?:id|sid)\\?":\\?"([^"\\]+))?/.exec(c); if (m) tr('acción← ' + m[1] + ' ' + (m[2] || '') + ' por ' + viaOf(d)); } } catch (e) {}
    return hp2.apply(this, arguments);
  };
  const count = (fn, label) => { const o = bi[fn]; if (typeof o !== 'function') return; bi[fn] = function () { const id = fn === '_sendMessageNative' ? arguments[2] : arguments[2]; if (id && /^(msg|gm)/.test(String(id))) { const k = String(id); const c = p.attempts.get(k) || { n: 0, by: {} }; c.n++; c.by[label] = (c.by[label] || 0) + 1; p.attempts.set(k, c); } return o.apply(this, arguments); }; };
  count('_sendMessageNative', 'directo'); count('_sendViaRelay', 'jump'); count('_sendViaNetMailbox', 'buzón');
}

// ---------- red, alcance y ciclo de vida ----------
let FINALE = false;
function desiredNet(p, t) {
  const pos = posAt(p, t);
  if (FINALE) return FINAL_RED === 'datos' ? { type: 'cell', zone: null } : { type: 'wifi', zone: 'casa' };
  for (const z of p.wifis) { const pl = PLACES[z]; if (Math.hypot(pos.x - pl.x, pos.y - pl.y) <= pl.r) return { type: 'wifi', zone: z }; }
  if (p.datos && !p.dataOff.some((o) => t >= o.t0 && t < o.t1)) return { type: 'cell', zone: null };
  return { type: 'none', zone: null };
}
function applyNet(p, t, force) {
  const want = desiredNet(p, t);
  if (!force && want.type === p.net.type && want.zone === p.net.zone) return;
  const prev = p.net; p.net = want; WORLD.cambios_red++;
  relays.forEach((r) => r.muteTag(TAG(p)));      // las conexiones de la red anterior quedan colgadas (mudas)
  p.noNet = want.type === 'none';
  p.native.setNetwork(want.type, want.zone);                    // Kotlin onNetChange (+ Wi-Fi local de esa red)
  sim(p.name + ' red ' + (prev.type + (prev.zone ? ':' + prev.zone : '')) + ' → ' + (want.type + (want.zone ? ':' + want.zone : '')));
}
const blocked = new Set();
const WORLD = { alcance_pierde: 0, alcance_gana: 0, cambios_red: 0, app_fondo: 0, app_dormida: 0, app_cerrada: 0, app_reabre: 0 };
function applyRange(t) {
  for (let a = 0; a < N; a++) for (let b = a + 1; b < N; b++) {
    const A = phones[a], B = phones[b], pa = posAt(A, t), pb = posAt(B, t), d = Math.hypot(pa.x - pb.x, pa.y - pb.y), k = a + '-' + b;
    if (d > BT_RANGE && !blocked.has(k)) { blocked.add(k); WORLD.alcance_pierde++; radio.block(A.native, B.native); sim(A.name + '·' + B.name + ' fuera de alcance Bluetooth (' + Math.round(d) + ' m)'); }
    else if (d <= BT_RANGE && blocked.has(k)) { blocked.delete(k); WORLD.alcance_gana++; radio.unblock(A.native, B.native); sim(A.name + '·' + B.name + ' a alcance Bluetooth (' + Math.round(d) + ' m)'); }
  }
}
async function closeApp(p) {
  try { await p.win.vaultFlushAll(); } catch (e) {}
  try { const ls = p.win.localStorage; p.ls = {}; for (let i = 0; i < ls.length; i++) { const k = ls.key(i); p.ls[k] = ls.getItem(k); } } catch (e) {}
  relays.forEach((r) => r.muteTag(TAG(p)));
  try { p.win.bleInterface.net._closeAll(); } catch (e) {}
  try { p.win.close(); } catch (e) {}
  p.native.destroyActivity();
  p.win = null; p.app = 'cerrada';
}
async function openApp(p) { p.native.load(); p.noNet = p.net.type === 'none'; await boot(p); p.app = 'fg'; }
async function lifeStep(p, t) {
  if (FINALE || p.busy) return;
  const ep = p.life.find((e) => t >= e.t0 && t < e.t1);
  const cur = p.app;
  const want = ep ? ep.kind : 'fg';
  if (cur === want) return;
  p.busy = true;
  try {
    // salir del estado actual
    if (cur === 'fondo') setVis(p, true);
    else if (cur === 'dormida') { p.native.setFrozen(false); relays.forEach((r) => r.wakeTag(TAG(p))); setVis(p, true); }
    else if (cur === 'cerrada') { sim(p.name + ' reabre la app'); WORLD.app_reabre++; await openApp(p); }
    p.app = 'fg';
    // entrar en el nuevo
    if (want === 'fondo') { setVis(p, false); p.app = 'fondo'; }
    else if (want === 'dormida') { setVis(p, false); p.native.setFrozen(true); relays.forEach((r) => r.sleepTag(TAG(p))); p.app = 'dormida'; }
    else if (want === 'cerrada') { await closeApp(p); }
    if (want !== 'fg') { sim(p.name + ' app → ' + want); WORLD['app_' + want]++; }
    else if (cur !== 'cerrada') sim(p.name + ' app → primer plano');
  } finally { p.busy = false; }
}

// ---------- interfaz (lo que haría la persona) ----------
const click = (win, el) => el && el.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
const $ = (p, sel) => p.win.document.querySelector(sel);
async function openChat(p, cid) { try { await p.win.bleInterface.openChat(cid); } catch (e) {} await sleep(500); return String((p.win.NEXO.app.activeContact && (p.win.NEXO.app.activeContact.nexoId || p.win.NEXO.app.activeContact.id)) || p.win.bleInterface._activeChatDeviceId || '').toLowerCase(); }
async function closeChat(p) { p.win.dispatchEvent(new p.win.CustomEvent('nexo:ble:closeChat', { detail: {} })); await sleep(250); }
function typeSend(p, text) { const i = p.win.document.getElementById('message-input'); i.value = text; i.dispatchEvent(new p.win.Event('input', { bubbles: true })); click(p.win, p.win.document.getElementById('send-btn')); }
async function sendFileUi(p, name, buf, mime) {
  click(p.win, $(p, '.attach-menu-item[data-type="file"]')); await sleep(150);
  const fin = Array.from(p.win.document.querySelectorAll('input[type=file]')).pop();
  if (!fin) return false;
  Object.defineProperty(fin, 'files', { configurable: true, value: [new p.win.File([buf], name, { type: mime || 'application/octet-stream' })] });
  fin.dispatchEvent(new p.win.Event('change'));
  return true;
}
const ownIds = async (p, cid) => new Set((await p.win.vaultLoadMessages(cid)).filter((m) => m._own).map((m) => m.msgId));
async function newOwn(p, cid, before, pred, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < (ms || 6000)) {
    if (!p.win) return null;
    const l = (await p.win.vaultLoadMessages(cid)).filter((m) => m._own && !m.hidden && !before.has(m.msgId) && (!pred || pred(m)));
    if (l.length) return l[l.length - 1];
    await sleep(200);
  }
  return null;
}
function visibleText(content) {
  const s = String(content == null ? '' : content);
  if (s.charAt(0) === '{') { try { const o = JSON.parse(s); if (o && o.type === 'nexo_txt' && typeof o.t === 'string') return o.t; } catch (e) {} }
  return s;
}
const isUser = (m) => m && !m.hidden && /^(msg|gm)/.test(String(m.msgId || ''));
async function menuItem(p, cls) { for (let i = 0; i < 15; i++) { const b = $(p, '#nexo-msg-menu .' + cls); if (b) return b; await sleep(100); } return null; }
async function bubbleMenu(p, msgId) {
  const el = $(p, '.message[data-msg-id="' + msgId + '"]');
  if (!el) return false;
  (el.querySelector('.msg-content') || el).dispatchEvent(new p.win.MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
  await sleep(250);
  return !!$(p, '#nexo-msg-menu');
}
function dismissMenu(p) { const m = $(p, '#nexo-msg-menu'); if (m) { const ov = $(p, '#nexo-msg-menu-overlay'); try { (ov || m).click(); } catch (e) {} if (m.parentNode) m.remove(); } }

// ---------- registro de envíos (el juez) ----------
const SENDS = [];        // { id, kind, from, fromNx, chat, group, to:[nx], msgId, token, hash, size, t, vias, deleted, edits:[], once }
const STATUSES = [];     // { owner, sid, text, t }
const LIKES = [];        // { from, owner, sid, t }
const REACTS = [];       // { tel, msgId, chat, emo, fx, t }
let seq = 0;
const tok = (p) => { seq++; p.seq = (p.seq || 0) + 1; return 'cz' + SEED.toString(36) + p.name.substring(0, 2).toLowerCase() + p.seq.toString(36); };
function rec(p, o) {
  const r = Object.assign({ id: SENDS.length + 1, from: p.name, fromNx: p.nx, t: tsec(), edits: [], deleted: false }, o);
  r.vias = {}; (r.to || []).forEach((nx) => { try { r.vias[nx] = p.win.bleInterface.linkOf(nx) + (p.win.bleInterface.net && p.win.bleInterface.net.gwOnly && p.win.bleInterface.net.gwOnly() ? '+puente' : ''); } catch (e) { r.vias[nx] = '?'; } });
  SENDS.push(r);
  sim(p.name + ' envía #' + r.id + ' ' + r.kind + ' ' + r.msgId + ' a ' + (r.group ? 'grupo ' + r.group : nameOf(r.chat)) + ' por ' + Object.values(r.vias).join(','));
  return r;
}
const byNx = new Map();
const nameOf = (nx) => (byNx.get(String(nx || '').toLowerCase()) || {}).name || String(nx || '');
const GROUPS = []; // { gid, name, creator, members:[nx] }

// ---------- acciones ----------
function contactList(p) { return Array.from(p.contacts).sort(); }
function groupList(p) { return Array.from(p.groups).sort().filter((g) => { try { return !!(p.win && p.win.bleInterface.groups.isGroup(g)); } catch (e) { return false; } }); }
async function actText(p, a, long, inGroup) {
  const cid = inGroup ? pick(() => a.r[0], groupList(p)) : pick(() => a.r[0], contactList(p));
  if (!cid) return 'sin_chat';
  await openChat(p, cid);
  const token = tok(p);
  const text = long ? '[' + token + '] ' + words(rng(seq * 7 + 11), 260) : '[' + token + '] ' + words(rng(seq * 7 + 11), 3 + Math.floor(a.r[1] * 10));
  const before = await ownIds(p, cid);
  typeSend(p, text);
  const m = await newOwn(p, cid, before, (x) => visibleText(x.content).indexOf(token) >= 0);
  if (!m) return 'no_aparece';
  const g = inGroup ? GROUPS.find((x) => x.gid === cid) : null;
  rec(p, { kind: inGroup ? 'grupo_texto' : (long ? 'largo' : 'texto'), chat: cid, group: g ? cid : null, to: g ? g.members.filter((x) => x !== p.nx) : [cid], msgId: m.msgId, token, text, hash: sha(Buffer.from(text.trim())), size: Buffer.byteLength(text) });
  if (a.r[2] < 0.5) await closeChat(p);
  return 'ok';
}
function bytesFor(token, size, r) { const b = Buffer.alloc(size); const g = rng(Math.floor(r * 1e9)); for (let i = 0; i < size; i++) b[i] = Math.floor(g() * 256); Buffer.from(token).copy(b, 0); return b; }
async function actFile(p, a, kind) {
  const inGroup = kind === 'grupo_adjunto';
  const cid = inGroup ? pick(() => a.r[0], groupList(p)) : pick(() => a.r[0], contactList(p));
  if (!cid) return 'sin_chat';
  await openChat(p, cid);
  const token = tok(p);
  const photo = kind === 'foto' || kind === 'unavez' || (inGroup && a.r[3] < 0.5);
  const size = kind === 'archivo_mediano' ? Math.floor(between(() => a.r[1], 150, 350) * 1024) : photo ? Math.floor(between(() => a.r[1], 20, 90) * 1024) : Math.floor(between(() => a.r[1], 8, 60) * 1024);
  const buf = bytesFor(token, size, a.r[4]);
  const before = await ownIds(p, cid);
  let m;
  if (photo) {
    const meta = { format: 'jpeg', width: 640, height: 480 };
    if (kind === 'unavez') meta.once = true;
    p.win.NEXO_sendAttachment('image', buf.toString('base64'), meta);
    m = await newOwn(p, cid, before, (x) => x.attachmentType === 'image', 8000);
  } else {
    const fname = token + '.bin';
    if (!(await sendFileUi(p, fname, buf))) return 'sin_selector';
    m = await newOwn(p, cid, before, (x) => x.attachmentType && x.attachmentMeta && x.attachmentMeta.name === fname, 12000);
  }
  if (!m) return 'no_aparece';
  const g = inGroup ? GROUPS.find((x) => x.gid === cid) : null;
  rec(p, { kind: kind === 'unavez' ? 'unavez' : (inGroup ? 'grupo_adjunto' : (photo ? 'foto' : kind)), chat: cid, group: g ? cid : null, to: g ? g.members.filter((x) => x !== p.nx) : [cid], msgId: m.msgId, token, hash: sha(buf), size, once: kind === 'unavez', att: photo ? 'image' : 'file' });
  if (a.r[2] < 0.5) await closeChat(p);
  return 'ok';
}
async function actVoice(p, a) {
  const cid = pick(() => a.r[0], contactList(p)); if (!cid) return 'sin_chat';
  await openChat(p, cid);
  const token = tok(p);
  const buf = bytesFor(token, Math.floor(between(() => a.r[1], 4, 14) * 1024), a.r[4]);
  const before = await ownIds(p, cid);
  p.nextVoice = buf;
  const i = p.win.document.getElementById('message-input'); i.value = ''; i.dispatchEvent(new p.win.Event('input', { bubbles: true }));
  click(p.win, p.win.document.getElementById('send-btn')); await sleep(700);
  const vs = p.win.document.getElementById('voice-send');
  if (!vs) { p.nextVoice = null; return 'sin_grabadora'; }
  click(p.win, vs);
  const m = await newOwn(p, cid, before, (x) => x.attachmentType === 'audio', 8000);
  p.nextVoice = null;
  if (!m) return 'no_aparece';
  rec(p, { kind: 'voz', chat: cid, group: null, to: [cid], msgId: m.msgId, token, hash: sha(buf), size: buf.length, att: 'audio' });
  if (a.r[2] < 0.5) await closeChat(p);
  return 'ok';
}
async function actStatus(p, a) {
  const token = tok(p);
  const text = '[' + token + '] ' + words(rng(seq * 5 + 3), 4);
  const sid = p.win.NEXO_addMyStatus(text);
  if (!sid) return 'sin_sid';
  STATUSES.push({ owner: p.name, ownerNx: p.nx, sid, text, t: tsec() });
  sim(p.name + ' publica estado ' + sid + ' «' + text.substring(0, 30) + '»');
  return 'ok';
}
async function actLike(p, a) {
  const cands = contactList(p).filter((nx) => (p.win.NEXO_statusesOf(nx) || []).length);
  if (!cands.length) return 'sin_estados';
  const nx = pick(() => a.r[0], cands);
  const l = p.win.NEXO_statusesOf(nx); const it = l[l.length - 1];
  const ok = p.win.NEXO_likeStatus(nx, it.sid);
  if (!ok) return 'ya_gustado';
  LIKES.push({ from: p.name, fromNx: p.nx, ownerNx: nx, sid: it.sid, t: tsec() });
  sim(p.name + ' me gusta al estado ' + it.sid + ' de ' + nameOf(nx));
  return 'ok';
}
// Elige un mensaje dibujado en el chat abierto (de los últimos 8)
async function pickBubble(p, cid, a, pred) {
  const l = (await p.win.vaultLoadMessages(cid)).filter((m) => isUser(m) && !m.deleted && pred(m)).slice(-8).filter((m) => $(p, '.message[data-msg-id="' + m.msgId + '"]'));
  return l.length ? pick(() => a.r[1], l) : null;
}
async function actReact(p, a) {
  const cid = pick(() => a.r[0], contactList(p)); if (!cid) return 'sin_chat';
  await openChat(p, cid);
  const m = await pickBubble(p, cid, a, (x) => !(x.attachmentMeta && x.attachmentMeta.once));
  if (!m) return 'sin_mensaje';
  if (!(await bubbleMenu(p, m.msgId))) return 'sin_menu';
  const emo = pick(() => a.r[3], ['❤️', '😂', '👍', '😮', '😢', '🙏']);
  let b = null; for (let i = 0; i < 10 && !b; i++) { b = Array.from(p.win.document.querySelectorAll('#nexo-msg-menu .mm-react')).find((x) => x.textContent === emo); if (!b) await sleep(100); }
  if (!b) { dismissMenu(p); return 'sin_emoji'; }
  let fx = null; try { const c = (p.win.vaultLoadContacts() || []).find((x) => String(x.nexoId || x.deviceUUID || '').toLowerCase() === cid); fx = c ? (c.fx || 0) : 'sin contacto'; } catch (e) {}
  click(p.win, b); await sleep(600);
  REACTS.push({ tel: p.name, msgId: m.msgId, chat: cid, emo, fx, t: tsec() });
  sim(p.name + ' reacciona ' + emo + ' a ' + m.msgId + ' (chat con ' + nameOf(cid) + ', fx del contacto=' + fx + ')');
  if (a.r[2] < 0.5) await closeChat(p);
  return 'ok';
}
async function actEdit(p, a) {
  const cid = pick(() => a.r[0], contactList(p)); if (!cid) return 'sin_chat';
  await openChat(p, cid);
  const m = await pickBubble(p, cid, a, (x) => x._own && !x.attachmentType && SENDS.some((s) => s.msgId === x.msgId && !s.group && !s.sabo));
  if (!m) return 'sin_mensaje';
  const r = SENDS.find((s) => s.msgId === m.msgId);
  if (!(await bubbleMenu(p, m.msgId))) return 'sin_menu';
  const it = await menuItem(p, 'mm-edit'); if (!it) { dismissMenu(p); return 'sin_editar'; }
  click(p.win, it); await sleep(300);
  const token = tok(p);
  const nt = '[' + r.token + '] editado ' + token + ' ' + words(rng(seq * 3 + 1), 3);
  const inp = p.win.document.getElementById('message-input'); inp.value = nt; inp.dispatchEvent(new p.win.Event('input', { bubbles: true }));
  click(p.win, p.win.document.getElementById('send-btn')); await sleep(700);
  r.edits.push({ text: nt, t: tsec(), by: p.name });
  sim(p.name + ' edita #' + r.id + ' ' + r.msgId);
  if (a.r[2] < 0.5) await closeChat(p);
  return 'ok';
}
async function actDelete(p, a) {
  const cid = pick(() => a.r[0], contactList(p)); if (!cid) return 'sin_chat';
  await openChat(p, cid);
  const m = await pickBubble(p, cid, a, (x) => x._own && SENDS.some((s) => s.msgId === x.msgId && !s.group && !s.sabo));
  if (!m) return 'sin_mensaje';
  const r = SENDS.find((s) => s.msgId === m.msgId);
  if (!(await bubbleMenu(p, m.msgId))) return 'sin_menu';
  const it = await menuItem(p, 'mm-del-all'); if (!it) { dismissMenu(p); return 'sin_borrar'; }
  click(p.win, it); await sleep(500);
  r.deleted = tsec();
  sim(p.name + ' borra para todos #' + r.id + ' ' + r.msgId);
  if (a.r[2] < 0.5) await closeChat(p);
  return 'ok';
}
async function actForward(p, a) {
  const cs = contactList(p); if (cs.length < 2) return 'sin_chat';
  const cid = pick(() => a.r[0], cs);
  await openChat(p, cid);
  const m = await pickBubble(p, cid, a, (x) => !(x.attachmentMeta && x.attachmentMeta.once) && SENDS.some((s) => s.msgId === x.msgId && !s.deleted));
  if (!m) return 'sin_mensaje';
  const src = SENDS.find((s) => s.msgId === m.msgId);
  const target = pick(() => a.r[3], cs.filter((x) => x !== cid));
  if (!(await bubbleMenu(p, m.msgId))) return 'sin_menu';
  const it = await menuItem(p, 'mm-forward'); if (!it) { dismissMenu(p); return 'sin_reenviar'; }
  click(p.win, it); await sleep(300);
  const row = Array.from(p.win.document.querySelectorAll('#nexo-forward-sheet .fw-row')).find((x) => x.textContent === nameOf(target));
  if (!row) { const sh = $(p, '#nexo-forward-sheet'); if (sh) sh.remove(); return 'sin_destino'; }
  const cb = row.querySelector('input'); cb.checked = true; cb.dispatchEvent(new p.win.Event('change'));
  const before = await ownIds(p, target);
  click(p.win, $(p, '#nexo-forward-sheet .fw-send'));
  const fm = await newOwn(p, target, before, null, 8000);
  if (!fm) return 'no_aparece';
  const text = src.edits.length ? src.edits[src.edits.length - 1].text : src.text;
  rec(p, { kind: 'reenvio', chat: target, group: null, to: [target], msgId: fm.msgId, token: src.token, text: src.att ? undefined : text, hash: src.att ? src.hash : sha(Buffer.from(String(text).trim())), size: src.size, att: src.att, fwdOf: src.id });
  if (a.r[2] < 0.5) await closeChat(p);
  return 'ok';
}
async function actOpen(p, a) {
  const cs = contactList(p).concat(groupList(p)); if (!cs.length) return 'sin_chat';
  const cid = pick(() => a.r[0], cs);
  await openChat(p, cid); await sleep(1500);
  // ver una vez: tocar las que hay
  if (a.r[3] < 0.6) await tapOnce(p);
  if (a.r[2] < 0.6) await closeChat(p);
  return 'ok';
}
const ONCE_SEEN = new Set(); // phone|msgId que la persona abrió
async function tapOnce(p) {
  const bs = Array.from(p.win.document.querySelectorAll('#messages-container .message.other')).filter((m) => m.querySelector('.msg-once-tap'));
  for (const b of bs) { const id = b.dataset.msgId; click(p.win, b.querySelector('.msg-once-tap')); await sleep(400); ONCE_SEEN.add(p.name + '|' + id); const ov = $(p, '#fullscreen-media-overlay'); if (ov) ov.remove(); }
}
async function doAction(p, a) {
  switch (a.kind) {
    case 'texto': return actText(p, a, false, false);
    case 'largo': return actText(p, a, true, false);
    case 'grupo_texto': return actText(p, a, false, true);
    case 'foto': case 'archivo': case 'archivo_mediano': case 'grupo_adjunto': case 'unavez': return actFile(p, a, a.kind);
    case 'voz': return actVoice(p, a);
    case 'estado': return actStatus(p, a);
    case 'estado_ver': return actLike(p, a);
    case 'reaccion': return actReact(p, a);
    case 'editar': return actEdit(p, a);
    case 'borrar': return actDelete(p, a);
    case 'reenviar': return actForward(p, a);
    case 'abrir': return actOpen(p, a);
  }
  return 'desconocida';
}
const ACT_RES = {};
async function actor(p, tStart) {
  for (const a of p.acts) {
    const wait = tStart + a.t * 1000 - Date.now();
    if (wait > 0) await sleep(wait);
    if (FINALE) return;
    while (p.busy) await sleep(100);
    if (p.app !== 'fg' || !p.win) { p.stats.omitidas++; continue; }
    p.busy = true;
    let res;
    try { res = await doAction(p, a); } catch (e) { res = 'error: ' + String(e && e.message).substring(0, 80); log(p.name, 'SIMERR', a.kind + ' ' + String(e && e.stack).split('\n').slice(0, 2).join(' | ')); }
    finally { p.busy = false; }
    const k = a.kind + ':' + res; ACT_RES[k] = (ACT_RES[k] || 0) + 1;
    if (res === 'ok') p.stats.acciones++; else p.stats.fallidas++;
  }
}

// ---------- arranque: emparejar y grupos ----------
async function addFound(p, name) {
  let add = null;
  if (p.win.bleInterface.isScanning) { click(p.win, $(p, '#ble-scan-btn')); await sleep(300); }
  const find = () => { const row = Array.from(p.win.document.querySelectorAll('#ble-new-device > div')).find((d) => (d.querySelector('span') || {}).textContent === name); return row && row.querySelector('button'); };
  for (let i = 0; i < 300 && !add; i++) { await sleep(100); add = find(); if (!add && !p.win.bleInterface.isScanning) click(p.win, $(p, '#ble-scan-btn')); }
  if (!add) return false;
  click(p.win, add); await sleep(2200);
  return true;
}
const knows = (p, nx) => (p.win.bleInterface.getBLEContacts() || []).some((c) => String(c.nexoId || c.deviceUUID || '').toLowerCase() === nx);
async function pairAll(edges) {
  const byI = new Map();
  edges.forEach(([a, b]) => { if (!byI.has(a)) byI.set(a, []); byI.get(a).push(b); });
  const ok = [];
  for (const [a, list] of byI) {
    const A = phones[a];
    A.win.bleInterface.togglePanel(); await sleep(300);
    for (const b of list) { const B = phones[b]; let done = knows(A, B.nx) || (await addFound(A, B.name)); if (!done) done = await addFound(A, B.name); if (done) ok.push([a, b]); else sim('NO empareja ' + A.name + '→' + B.name); }
    if ($(A, '#ble-panel') && $(A, '#ble-panel').classList.contains('active')) A.win.bleInterface.togglePanel();
    await sleep(300);
  }
  // saludo: así el otro lo tiene de contacto (llega por Bluetooth)
  for (const [a, b] of ok) {
    const A = phones[a], B = phones[b];
    await openChat(A, B.nx);
    const token = tok(A), text = '[' + token + '] hola ' + B.name;
    const before = await ownIds(A, B.nx);
    typeSend(A, text);
    const m = await newOwn(A, B.nx, before, (x) => visibleText(x.content).indexOf(token) >= 0);
    if (m) rec(A, { kind: 'saludo', chat: B.nx, group: null, to: [B.nx], msgId: m.msgId, token, text, hash: sha(Buffer.from(text.trim())), size: Buffer.byteLength(text) });
    await sleep(700);
    await closeChat(A);
  }
  // esperar a que cada par se tenga de contacto en los dos sentidos
  const t0 = Date.now();
  while (Date.now() - t0 < 90000) { if (ok.every(([a, b]) => knows(phones[a], phones[b].nx) && knows(phones[b], phones[a].nx))) break; await sleep(1000); }
  const both = ok.filter(([a, b]) => knows(phones[a], phones[b].nx) && knows(phones[b], phones[a].nx));
  both.forEach(([a, b]) => { phones[a].contacts.add(phones[b].nx); phones[b].contacts.add(phones[a].nx); });
  return { pedidos: edges.length, agregados: ok.length, mutuos: both.length, faltan: edges.filter((e) => !both.some((o) => o[0] === e[0] && o[1] === e[1])).map(([a, b]) => phones[a].name + '-' + phones[b].name) };
}
async function makeGroups() {
  const nG = N >= 10 ? 3 : 2, made = [];
  const cands = phones.filter((p) => p.contacts.size >= 3);
  for (let g = 0; g < nG && cands.length; g++) {
    const C = cands[Math.floor(RC() * cands.length)];
    const cs = contactList(C); const k = Math.min(cs.length, 3 + Math.floor(RC() * 3));
    const mem = cs.slice().sort(() => RC() - 0.5).slice(0, k);
    click(C.win, $(C, '#nexo-new-group-btn')); await sleep(400);
    const sheet = $(C, '#nexo-group-sheet');
    if (!sheet) { sim('sin hoja de grupo en ' + C.name); continue; }
    sheet.querySelectorAll('.nexo-pick-row input').forEach((cb) => { if (mem.includes(cb.dataset.nx)) { cb.checked = true; cb.dispatchEvent(new C.win.Event('change')); } });
    const nm = sheet.querySelector('#nexo-group-name'); nm.value = 'Grupo ' + (g + 1); nm.dispatchEvent(new C.win.Event('input'));
    const before = new Set(Object.keys(C.win.bleInterface.groups.list));
    click(C.win, sheet.querySelector('#nexo-group-create')); await sleep(800);
    const gid = Object.keys(C.win.bleInterface.groups.list).find((x) => !before.has(x));
    if (!gid) { sim('no se creó el grupo ' + (g + 1)); continue; }
    const members = C.win.bleInterface.groups.get(gid).members.slice();
    GROUPS.push({ gid, name: 'Grupo ' + (g + 1), creator: C.name, members });
    members.forEach((nx) => { const P = byNx.get(nx); if (P) P.groups.add(gid); });
    sim(C.name + ' crea ' + gid + ' con ' + members.map(nameOf).join(', '));
    // el «Creó el grupo» también se juzga (llega a todos)
    const gm = (await C.win.vaultLoadMessages(gid)).filter((m) => m._own && !m.hidden).pop();
    if (gm) rec(C, { kind: 'grupo_crear', chat: gid, group: gid, to: members.filter((x) => x !== C.nx), msgId: gm.msgId, token: null, text: visibleText(gm.content), hash: sha(Buffer.from(visibleText(gm.content).trim())), size: Buffer.byteLength(String(gm.content)) });
    await closeChat(C);
    made.push(gid);
    await sleep(1500);
  }
  return made;
}

// ---------- sabotaje (control del juez) ----------
// Estropea en el DISCO del teléfono víctima un mensaje que ya le llegó (lo quita, lo duplica con otro id o cambia un byte del
// contenido) y reinicia su app para que lo cargue así. La app no puede saberlo; el juez sí debe verlo.
const SABO = { modo: SAB || null, hecho: null };
async function sabotage() {
  for (const vic of phones.filter((p) => p.app === 'fg' && p.win && !p.busy)) {
  try { await vic.win.vaultFlushAll(); } catch (e) {}
  await sleep(300);
  for (const r of SENDS.filter((s) => !s.group && !s.deleted && !s.edits.length && s.to[0] === vic.nx && s.kind !== 'saludo')) {
    // uno ya confirmado (✓✓) hace rato: el emisor no lo volverá a mandar
    const P = phones.find((x) => x.name === r.from);
    const own = P && P.win ? (await P.win.vaultLoadMessages(r.chat)).find((m) => m.msgId === r.msgId) : null;
    if (!own || !/delivered|read/.test(own.status) || tsec() - r.t < 30) continue;
    const f = MSGS_FILE(r.fromNx), raw = vic.native.files.get(f);
    if (!raw) continue;
    let j; try { j = JSON.parse(raw); } catch (e) { continue; }
    const i = (j.messages || []).findIndex((m) => m.msgId === r.msgId);
    if (i < 0) continue;
    const m = j.messages[i];
    if (SAB === 'pierde') j.messages.splice(i, 1);
    else if (SAB === 'duplica') j.messages.push(Object.assign({}, m, { msgId: m.msgId + 'b', messageId: m.msgId + 'b', timestamp: m.timestamp + 1 }));
    else if (SAB === 'corrompe') {
      if (m.attachmentRef && vic.native.files.get(m.attachmentRef)) { const b = Buffer.from(vic.native.files.get(m.attachmentRef), 'base64'); b[b.length >> 1] ^= 0x55; vic.native.files.set(m.attachmentRef, b.toString('base64')); }
      else if (m.attachmentPayload) { const b = Buffer.from(m.attachmentPayload, 'base64'); b[b.length >> 1] ^= 0x55; m.attachmentPayload = b.toString('base64'); }
      else { m.content = String(m.content).replace(/[a-z]/, (c) => (c === 'x' ? 'y' : 'x')); m.text = m.content; }
    } else return;
    // también la cola rápida (los últimos mensajes) para que al abrir el chat se vea lo mismo
    vic.native.files.set(f, JSON.stringify(j));
    const tf = vic.native.files.has(TAIL_FILE(r.fromNx)) ? TAIL_FILE(r.fromNx) : null;
    if (tf) { try { const tj = JSON.parse(vic.native.files.get(tf)); const arr = tj.messages || tj; if (Array.isArray(arr)) { const k = arr.findIndex((x) => x.msgId === r.msgId); if (k >= 0) { if (SAB === 'pierde') arr.splice(k, 1); else if (SAB === 'duplica') arr.push(Object.assign({}, arr[k], { msgId: r.msgId + 'b', messageId: r.msgId + 'b' })); else arr[k] = m; vic.native.files.set(tf, JSON.stringify(tj)); } } } catch (e) {} }
    r.sabo = true;
    SABO.hecho = { victima: vic.name, envio: r.id, msgId: r.msgId, de: r.from, tipo: r.kind, t: tsec() };
    sim('SABOTAJE ' + SAB + ' en el disco de ' + vic.name + ': #' + r.id + ' ' + r.msgId + ' (de ' + r.from + ')');
    // reiniciar la app de la víctima sin volcar (si no, la app reescribiría el archivo bueno desde su memoria)
    vic.busy = true;
    try { vic.native.files.set(f, JSON.stringify(j)); const w = vic.win; vic.win = null; try { w.close(); } catch (e) {} vic.native.destroyActivity(); relays.forEach((rl) => rl.muteTag(TAG(vic)));
      if (SAB === 'pierde' || SAB === 'duplica' || SAB === 'corrompe') vic.native.files.set(f, JSON.stringify(j));
      await openApp(vic); } finally { vic.busy = false; }
    return;
  }
  }
  sim('SABOTAJE: no encontré un mensaje que estropear');
}

// ---------- el juez ----------
const MSGS_FILE = (cid) => 'nexo_vault_msgs_v2_' + cid + '.json', TAIL_FILE = (cid) => 'nexo_vault_msgs_v2_' + cid + '.tail.json'; // vault_shared.js / vault_messages.js
const pct = (a, q) => { if (!a.length) return null; const s = a.slice().sort((x, y) => x - y); return Math.round(s[Math.min(s.length - 1, Math.floor(q * s.length))] * 10) / 10; };
function diskMsgs(p, cid) { const raw = p.native.files.get(MSGS_FILE(cid)); if (!raw) return []; try { const j = JSON.parse(raw); return Array.isArray(j.messages) ? j.messages : (Array.isArray(j) ? j : []); } catch (e) { return null; } }
function payloadOf(p, m) {
  if (m.attachmentPayload && typeof m.attachmentPayload === 'string') return m.attachmentPayload;
  if (m.attachmentRef && p.native.files.has(m.attachmentRef)) return p.native.files.get(m.attachmentRef);
  if (typeof m.content === 'string' && m.content.indexOf('"payload"') >= 0) { try { const o = JSON.parse(m.content); if (o && o.payload) return o.payload; } catch (e) {} }
  return null;
}
function excerpt(names, msgId, t, extra) {
  const ids = [msgId].concat(extra || []).filter(Boolean);
  const out = [], tagRe = new RegExp('\\[(' + names.join('|') + '|SIM)\\]');
  for (const l of LOG) {
    if (!tagRe.test(l)) continue;
    const lt = parseFloat(l);
    const hasId = ids.some((x) => l.indexOf(x) >= 0);
    const sim1 = l.indexOf('[SIM]') >= 0 && names.some((n) => l.indexOf(n) >= 0) && Math.abs(lt - t) < 30;
    if (hasId || sim1) out.push(l.substring(0, 230));
  }
  return out.length > 24 ? out.slice(0, 10).concat(['…'], out.slice(-13)) : out;
}
async function judge() {
  const F = [], S = { envios: SENDS.length, entregas_esperadas: 0, entregadas: 0, por_camino: {}, lat: {} };
  // volcar todo a disco y leer lo GUARDADO
  for (const p of phones) { try { await p.win.vaultFlushAll(); } catch (e) {} }
  await sleep(1500);
  const fail = (o) => { F.push(o); };
  const RANK = { failed: 0, pending: 1, sending: 2, sent: 3, delivered: 4, read: 5 };
  // índice de lo que cada teléfono guardó: chat → mensajes (disco) y caché
  const D = new Map(), C = new Map();
  for (const p of phones) {
    const chats = new Set(contactList(p).concat(groupList(p)));
    (p.win.bleInterface.getBLEContacts() || []).forEach((c) => chats.add(String(c.nexoId || c.deviceUUID || '').toLowerCase()));
    Object.keys(p.win.bleInterface.groups.list || {}).forEach((g) => chats.add(g));
    const dm = new Map(), cm = new Map();
    for (const cid of chats) { if (!cid) continue; const d = diskMsgs(p, cid); if (d === null) fail({ causa: 'disco_ilegible', telefono: p.name, chat: nameOf(cid) }); dm.set(cid, d || []); cm.set(cid, await p.win.vaultLoadMessages(cid)); }
    D.set(p.name, dm); C.set(p.name, cm);
  }
  // disco y memoria deben decir lo mismo (lo que la app muestra = lo que sobrevive a un reinicio)
  for (const p of phones) for (const [cid, cm] of C.get(p.name)) {
    const dm = D.get(p.name).get(cid) || [];
    const di = new Set(dm.filter(isUser).map((m) => m.msgId)), ci = new Set(cm.filter(isUser).map((m) => m.msgId));
    const soloMem = Array.from(ci).filter((x) => !di.has(x)), soloDisco = Array.from(di).filter((x) => !ci.has(x));
    if (soloMem.length || soloDisco.length) fail({ causa: 'disco_distinto_de_memoria', telefono: p.name, chat: nameOf(cid), solo_memoria: soloMem.slice(0, 4), solo_disco: soloDisco.slice(0, 4) });
  }
  const tokenCount = (p, token) => { let n = 0; for (const [, l] of D.get(p.name)) for (const m of l) if (!m._own && !m.hidden && ((typeof m.content === 'string' && m.content.indexOf(token) >= 0) || (m.attachmentMeta && JSON.stringify(m.attachmentMeta).indexOf(token) >= 0))) n++; return n; };
  const tokenHashCount = (p, hash) => { let n = 0; for (const [, l] of D.get(p.name)) for (const m of l) if (!m._own && !m.hidden && m.attachmentType) { const pl = payloadOf(p, m); if (pl && sha(Buffer.from(pl, 'base64')) === hash) n++; } return n; };
  const finalT = FINAL_OPEN_T;
  for (const r of SENDS) {
    const P = phones.find((x) => x.name === r.from);
    const own = (D.get(P.name).get(r.chat) || []).find((m) => m.msgId === r.msgId);
    const base = { semilla: SEED, envio: r.id, msgId: r.msgId, de: r.from, para: r.group ? 'grupo ' + r.group : nameOf(r.chat), tipo: r.kind, enviado_s: Math.round(r.t), camino_al_enviar: r.vias };
    if (!own && !r.deleted) fail(Object.assign({ causa: 'emisor_sin_su_mensaje' }, base));
    // estado del emisor
    if (own && !r.deleted) {
      const st = own.status;
      if ((RANK[st] || 0) < RANK.delivered) fail(Object.assign({ causa: (st === 'failed' ? 'estado_fallido_✗' : st === 'sent' ? 'sin_confirmar_✓' : 'atascado_⏳'), estado: st }, base));
    }
    for (const nx of r.to) {
      const R = byNx.get(nx); if (!R) continue;
      const wid = r.group ? r.msgId + '_' + nx.substring(2) : r.msgId;
      const l = D.get(R.name).get(r.group ? r.group : P.nx) || [];
      const hits = l.filter((m) => m.msgId === wid);
      const b2 = Object.assign({}, base, { para: R.name + (r.group ? ' (grupo ' + r.group + ')' : ''), msgId_receptor: wid });
      const arr = ARRIVALS.get(R.name + '|' + wid);
      if (!hits.length) {
        // borrado para todos ANTES de llegar: no tiene por qué estar (si llegó, debe quedar en blanco: «Se eliminó este mensaje»)
        if (r.deleted && !r.group && !arr) continue;
        S.entregas_esperadas++;
        fail(Object.assign({ causa: 'perdido' }, b2)); continue;
      }
      S.entregas_esperadas++; S.entregadas++;
      if (arr) { const via = arr.via || '?'; S.por_camino[via] = (S.por_camino[via] || 0) + 1; (S.lat[via] = S.lat[via] || []).push(arr.t - r.t); }
      const m = hits[0];
      if (hits.length > 1) fail(Object.assign({ causa: 'duplicado', copias: hits.length }, b2));
      // duplicado con otro id: el mismo contenido más veces de las que se le mandó
      if (r.token) {
        const expected = SENDS.filter((s) => s.token === r.token && s.to.includes(nx)).length;
        const got = tokenCount(R, r.token) + (r.att ? 0 : 0);
        const gotAtt = r.att ? tokenHashCount(R, r.hash) : 0;
        const n = r.att ? gotAtt : got;
        if (n > expected) fail(Object.assign({ causa: 'duplicado', copias: n, esperadas: expected }, b2));
      }
      // contenido
      if (r.deleted && !r.group) {
        if (!m.deleted || (m.content && m.content.indexOf(r.token || '\u0000') >= 0)) fail(Object.assign({ causa: 'borrado_no_aplicado' }, b2));
        continue;
      }
      if (r.att) {
        const consumed = m.onceSeen || ONCE_SEEN.has(R.name + '|' + wid);
        if (r.once && !(m.attachmentMeta && m.attachmentMeta.once)) fail(Object.assign({ causa: 'una_vez_sin_marca' }, b2));
        if (consumed) { if (payloadOf(R, m)) fail(Object.assign({ causa: 'una_vez_no_se_borra' }, b2)); continue; }
        const pl = payloadOf(R, m);
        if (!pl) fail(Object.assign({ causa: 'adjunto_sin_datos', ref: m.attachmentRef || null }, b2));
        else if (sha(Buffer.from(pl, 'base64')) !== r.hash) fail(Object.assign({ causa: 'corrupto', esperado: r.hash, llegó: sha(Buffer.from(pl, 'base64')), bytes: Buffer.from(pl, 'base64').length, bytes_esperados: r.size }, b2));
      } else {
        const want = r.edits.length ? r.edits[r.edits.length - 1].text : r.text;
        const got = visibleText(m.content);
        if (sha(Buffer.from(String(got).trim())) !== sha(Buffer.from(String(want).trim()))) fail(Object.assign({ causa: r.edits.length ? 'edicion_no_aplicada' : 'corrupto', esperado: String(want).substring(0, 60), llegó: String(got).substring(0, 60) }, b2));
        else if (r.edits.length && !m.edited) fail(Object.assign({ causa: 'edicion_sin_marca' }, b2));
      }
      // reacciones iguales en los dos lados (1-a-1)
      if (!r.group && own) {
        const ra = JSON.stringify(own.reactions || {}), rb = JSON.stringify(m.reactions || {});
        const norm2 = (o) => JSON.stringify(Object.keys(o || {}).sort().reduce((x, k) => { if (o[k]) x[k] = o[k]; return x; }, {}));
        if (norm2(own.reactions) !== norm2(m.reactions)) fail(Object.assign({ causa: 'reaccion_desigual', emisor: ra, receptor: rb, reacciones: REACTS.filter((x) => x.msgId === r.msgId).map((x) => x.tel + ' ' + x.emo + ' fx=' + x.fx + ' @' + Math.round(x.t) + 's') }, b2));
      }
      // leído: si el receptor abrió el chat después de que llegara (ronda final), el emisor debe verlo leído
      if (own && !r.group && arr && arr.t < finalT && own.status === 'delivered') fail(Object.assign({ causa: 'leido_no_vuelve', estado: own.status }, b2));
    }
  }
  // grupos: todos los miembros lo tienen, con la misma lista
  for (const g of GROUPS) for (const nx of g.members) { const P = byNx.get(nx); const gg = P && P.win.bleInterface.groups.get(g.gid); if (!gg) fail({ causa: 'grupo_no_llega', grupo: g.gid, telefono: P ? P.name : nx }); else if (gg.members.slice().sort().join() !== g.members.slice().sort().join()) fail({ causa: 'grupo_lista_distinta', grupo: g.gid, telefono: P.name }); }
  // estados y «me gusta»
  for (const s of STATUSES) {
    const O = byNx.get(s.ownerNx); const mine = (O.win.NEXO_myStatuses() || []).some((x) => x.sid === s.sid);
    if (!mine) continue; // reemplazado (más de 10) o quitado
    for (const nx of contactList(O)) { const R = byNx.get(nx); const l = R.win.NEXO_statusesOf(O.nx) || []; const it = l.find((x) => x.sid === s.sid); if (!it) fail({ causa: 'estado_no_llega', semilla: SEED, estado: s.sid, de: O.name, para: R.name, publicado_s: Math.round(s.t) }); else if (it.t !== s.text) fail({ causa: 'estado_distinto', estado: s.sid, de: O.name, para: R.name }); }
  }
  for (const lk of LIKES) {
    const O = byNx.get(lk.ownerNx); if (!(O.win.NEXO_myStatuses() || []).some((x) => x.sid === lk.sid)) continue;
    if (!(O.win.NEXO_whoLiked(lk.sid) || []).some((x) => x.nx === lk.fromNx)) fail({ causa: 'megusta_no_llega', semilla: SEED, estado: lk.sid, de: lk.from, para: O.name, t_s: Math.round(lk.t) });
  }
  // excepciones en los registros
  const exc = new Map();
  LOG.forEach((l) => { if (/ (PAGEERROR|UNHANDLED|UNCAUGHT|SIMERR): | Uncaught /.test(l)) { const k = l.replace(/^.*?\] /, '').replace(/[0-9a-f]{8,}|\d{4,}/g, '#').substring(0, 160); if (!exc.has(k)) exc.set(k, { n: 0, primera: l.substring(0, 300) }); exc.get(k).n++; } });
  exc.forEach((v, k) => fail({ causa: /SIMERR/.test(k) ? 'error_del_simulador' : 'excepcion', veces: v.n, linea: v.primera }));
  const errs = new Map();
  LOG.forEach((l) => { if (/\] error: /.test(l) && /TypeError|ReferenceError|is not a function|Cannot read|undefined is not/.test(l)) { const k = l.replace(/^.*?\] error: /, '').replace(/[0-9a-f]{8,}|\d{4,}/g, '#').substring(0, 140); if (!errs.has(k)) errs.set(k, { n: 0, primera: l.substring(0, 300) }); errs.get(k).n++; } });
  errs.forEach((v) => fail({ causa: 'error_js_en_consola', veces: v.n, linea: v.primera }));
  // como mucho un enlace Bluetooth por par
  const enlaces = [];
  for (let a = 0; a < N; a++) for (let b = a + 1; b < N; b++) {
    const A = phones[a].native, B = phones[b].native;
    const n = (A.clients.has(norm(B.address)) ? 1 : 0) + (B.clients.has(norm(A.address)) ? 1 : 0);
    if (n > 1) { enlaces.push(phones[a].name + '·' + phones[b].name); fail({ causa: 'enlace_bluetooth_doble', par: phones[a].name + '·' + phones[b].name }); }
  }
  // reenvíos sin límite: salidas por mensaje
  const att = [];
  phones.forEach((p) => p.attempts.forEach((c, id) => att.push({ tel: p.name, id, n: c.n, by: c.by })));
  att.sort((x, y) => y.n - x.n);
  S.salidas_por_mensaje = { mensajes: att.length, p50: pct(att.map((x) => x.n), 0.5), p95: pct(att.map((x) => x.n), 0.95), max: att.length ? att[0].n : 0, top: att.slice(0, 5).map((x) => x.tel + ' ' + x.id + ' ×' + x.n + ' ' + JSON.stringify(x.by)) };
  att.filter((x) => x.n > 60).forEach((x) => fail({ causa: 'reenvio_sin_limite', telefono: x.tel, msgId: x.id, salidas: x.n, por: x.by }));
  // memoria: temporizadores vivos por teléfono (al principio de la fase final y al final)
  S.temporizadores = phones.map((p) => ({ tel: p.name, intervalos: p.tm ? p.tm.iv.size : null, timeouts: p.tm ? p.tm.to.size : null, en_final: p.tmFinal || null, max: p.tmMax || null, archivos_kb: Math.round(Array.from(p.native.files.values()).reduce((s, v) => s + String(v).length, 0) / 1024) }));
  phones.forEach((p) => { if (p.tm && p.tmFinal && (p.tm.iv.size > p.tmFinal.iv + 15 || p.tm.to.size > Math.max(400, p.tmFinal.to * 3))) fail({ causa: 'temporizadores_crecen', telefono: p.name, inicio_final: p.tmFinal, fin: { iv: p.tm.iv.size, to: p.tm.to.size } }); if (p.tm && (p.tm.iv.size > 200 || p.tm.to.size > 3000)) fail({ causa: 'temporizadores_demasiados', telefono: p.name, iv: p.tm.iv.size, to: p.tm.to.size }); });
  // estadísticas
  S.pct_entregado = S.entregas_esperadas ? Math.round(1000 * S.entregadas / S.entregas_esperadas) / 10 : null;
  S.latencia_s = {}; Object.keys(S.lat).forEach((k) => { S.latencia_s[k] = { n: S.lat[k].length, p50: pct(S.lat[k], 0.5), p95: pct(S.lat[k], 0.95) }; }); delete S.lat;
  const useful = SENDS.reduce((s, r) => s + r.size * r.to.length, 0);
  const air = phones.reduce((s, p) => s + (p.native.stats.airBytes || 0), 0), lan = phones.reduce((s, p) => s + (p.native.stats.lanOutBytes || 0), 0), rel = relays.reduce((s, r) => s + (r.stats.bytesIn || 0), 0);
  S.bytes = { util: useful, bluetooth: air, wifi: lan, reles_subida: rel, bluetooth_por_util: useful ? Math.round(10 * air / useful) / 10 : null, total_por_util: useful ? Math.round(10 * (air + lan + rel) / useful) / 10 : null };
  S.enlaces_dobles = enlaces;
  // contactos que este teléfono cree que NO entienden acciones (fx=0): sus reacciones a ellos no salen (chat_actions._reactTo)
  S.contactos_sin_fx = phones.map((p) => { let l = []; try { l = (p.win.vaultLoadContacts() || []).filter((c) => contactList(p).includes(String(c.nexoId || c.deviceUUID || '').toLowerCase()) && !c.fx).map((c) => nameOf(String(c.nexoId || c.deviceUUID).toLowerCase())); } catch (e) {} return l.length ? p.name + '→' + l.join(',') : null; }).filter(Boolean);
  // extracto de registros para cada fallo de mensaje
  F.forEach((f) => { if (f.msgId) { const P = phones.find((x) => x.name === f.de), R = phones.find((x) => f.para && f.para.indexOf(x.name) === 0); f.extracto = excerpt([f.de].concat(R ? [R.name] : []), f.msgId, f.enviado_s || 0, f.msgId_receptor ? [f.msgId_receptor] : []); } });
  return { F, S };
}
let FINAL_OPEN_T = 0;

// ---------- la corrida ----------
(async () => {
  const out = { prueba: 'ciudad', build: path.basename(buildDir), n: N, semilla: SEED, min: MIN, final_min: FINAL_MIN, final_red: FINAL_RED, sabotaje: SAB || null, comando: CMD };
  makeProfiles(); makePlans(); makeSchedules(); makeActions();
  const edges = makeContactGraph();
  // huella del guion (misma semilla y parámetros = mismo mapa, caminos, cortes, ciclo de la app, acciones y contactos)
  out.guion_sha = sha(Buffer.from(JSON.stringify({ p: phones.map((p) => [p.name, p.sinNet, p.intermitente, p.wifis, p.plan, p.dataOff, p.life, p.acts]), edges })));
  if (argv.includes('--solo-guion')) { console.log('CIUDAD_GUION ' + JSON.stringify({ semilla: SEED, n: N, guion_sha: out.guion_sha, acciones: phones.reduce((n, p) => n + p.acts.length, 0), cortes: phones.reduce((n, p) => n + p.dataOff.length, 0), ciclo: phones.reduce((n, p) => n + p.life.length, 0), aristas: edges.length })); process.exit(0); }
  relays = [new NostrRelay(), new NostrRelay()];
  RELAYS = [await relays[0].start(), await relays[1].start()];
  // todos juntos en el centro, con internet (los que tienen), para emparejarse
  for (const p of phones) {
    p.native = new NativePhone(p.name, p.mac, Object.assign({}, base, { wifi: null }));
    radio.add(p.native); p.native.load();
    p.net = { type: p.datos ? 'cell' : 'none', zone: null }; p.noNet = !p.datos; p.native.netType = p.net.type;
  }
  for (const p of phones) { await boot(p); byNx.set(p.nx, p); }
  sim('arrancaron ' + N + ' teléfonos; perfiles: ' + phones.map((p) => p.name + (p.sinNet ? '(sin internet)' : '') + (p.wifis.length ? '[wifi ' + p.wifis.join('+') + ']' : '')).join(' '));
  out.perfiles = phones.map((p) => ({ tel: p.name, nx: p.nx, internet_propio: !p.sinNet, datos_intermitentes: !!p.intermitente, wifi: p.wifis, cortes_datos: p.dataOff.length, ciclo_app: p.life.map((e) => e.kind + '@' + Math.round(e.t0) + 's/' + Math.round(e.t1 - e.t0) + 's') }));
  out.emparejar = await pairAll(edges);
  out.grupos = await makeGroups();
  out.grupos = GROUPS.map((g) => ({ gid: g.gid, de: g.creator, miembros: g.members.map(nameOf) }));
  out.contactos = phones.map((p) => p.name + ':' + contactList(p).map(nameOf).join(','));
  await sleep(4000);
  sim('=== EMPIEZA LA ACTIVIDAD (' + MIN + ' min) ===');
  const tStart = Date.now();
  const tAct = () => (Date.now() - tStart) / 1000;
  // el mundo: cada segundo, posiciones → alcance Bluetooth; red; ciclo de la app
  let worldOn = true;
  const world = (async () => {
    while (worldOn) {
      const t = FINALE ? ACT_S : tAct();
      try { applyRange(t); } catch (e) { log('SIM', 'SIMERR', 'alcance ' + e.message); }
      for (const p of phones) { try { applyNet(p, t); } catch (e) { log('SIM', 'SIMERR', 'red ' + e.message); } lifeStep(p, t).catch((e) => log('SIM', 'SIMERR', 'ciclo ' + p.name + ' ' + e.message)); }
      await sleep(1000);
    }
  })();
  // muestreo de memoria
  const mem = [];
  const memT = setInterval(() => { const m = process.memoryUsage(); mem.push({ t: Math.round(tsec()), rss: Math.round(m.rss / 1e6), heap: Math.round(m.heapUsed / 1e6) }); phones.forEach((p) => { if (p.tm && p.win) { p.tmMax = p.tmMax || { iv: 0, to: 0 }; p.tmMax.iv = Math.max(p.tmMax.iv, p.tm.iv.size); p.tmMax.to = Math.max(p.tmMax.to, p.tm.to.size); } }); }, 15000);
  let sabT = null;
  if (SAB) sabT = setTimeout(() => { sabotage().catch((e) => log('SIM', 'SIMERR', 'sabotaje ' + e.message)); }, Math.max(60, ACT_S * 0.6) * 1000);
  await Promise.all(phones.map((p) => actor(p, tStart)));
  const rest = ACT_S * 1000 - (Date.now() - tStart); if (rest > 0) await sleep(rest);
  if (SAB && !SABO.hecho) { clearTimeout(sabT); await sabotage(); }
  // ---- fase final: todos juntos, con internet y con la app abierta ----
  sim('=== FASE FINAL: todos juntos (Bluetooth) y con internet' + (FINAL_RED === 'wifi' ? ' en el mismo Wi-Fi' : ' por datos móviles') + ' (' + FINAL_MIN + ' min) ===');
  while (phones.some((p) => p.busy)) await sleep(200);
  FINALE = true;
  phones.forEach((p, k) => { const a = 2 * Math.PI * k / N; p.finalPos = { x: PLACES.centro.x + 12 * Math.cos(a), y: PLACES.centro.y + 12 * Math.sin(a) }; });
  for (const p of phones) {
    p.busy = true;
    try {
      if (p.app === 'cerrada') { sim(p.name + ' reabre la app (final)'); await openApp(p); }
      else if (p.app === 'dormida') { p.native.setFrozen(false); relays.forEach((r) => r.wakeTag(TAG(p))); setVis(p, true); }
      else if (p.app === 'fondo') setVis(p, true);
      p.app = 'fg';
    } finally { p.busy = false; }
  }
  phones.forEach((p) => { p.datos = true; });
  const tFin = Date.now();
  await sleep(Math.min(60000, FIN_S * 1000 / 4));
  phones.forEach((p) => { p.tmFinal = p.tm ? { iv: p.tm.iv.size, to: p.tm.to.size } : null; });
  // cada uno abre todos sus chats (el «leído»), dos rondas
  for (let round = 0; round < 2; round++) {
    await Promise.all(phones.map(async (p) => { for (const cid of contactList(p).concat(groupList(p))) { if (!p.win) continue; await openChat(p, cid); await sleep(1200); await closeChat(p); } }));
    if (round === 0) { FINAL_OPEN_T = tsec(); await sleep(Math.max(5000, (FIN_S * 1000 - (Date.now() - tFin)) / 3)); }
  }
  const left = FIN_S * 1000 - (Date.now() - tFin); if (left > 0) await sleep(left);
  worldOn = false; clearInterval(memT); await world;
  sim('=== JUEZ ===');
  const { F, S } = await judge();
  S.acciones = ACT_RES;
  S.por_telefono = phones.map((p) => ({ tel: p.name, hechas: p.stats.acciones, omitidas_app_no_abierta: p.stats.omitidas, no_hechas: p.stats.fallidas, arranques: p.boots }));
  S.memoria_proceso_mb = mem.length ? { inicio: mem[0], max_rss: Math.max(...mem.map((m) => m.rss)), fin: mem[mem.length - 1] } : null;
  S.reles = relays.map((r) => ({ publicados: r.stats.published, rechazados: r.stats.rejected.length, conexiones: r.stats.conns }));
  S.estados = { publicados: STATUSES.length, megusta: LIKES.length };
  S.mundo = WORLD;
  out.estadisticas = S;
  if (SAB) out.control = { sabotaje: SAB, hecho: SABO.hecho, detectado: !!(SABO.hecho && F.some((f) => f.msgId === SABO.hecho.msgId || (f.solo_disco || []).concat(f.solo_memoria || []).some((x) => String(x).indexOf(SABO.hecho.msgId) === 0))) };
  // agrupar fallos por causa
  const porCausa = {}; F.forEach((f) => { porCausa[f.causa] = (porCausa[f.causa] || 0) + 1; });
  out.fallos_por_causa = porCausa;
  out.fallos = F.slice(0, 80);
  out.resultado = SAB ? (out.control.detectado ? 'OK' : 'FALLO') : (F.length ? 'FALLO' : 'OK');
  out.registros = path.relative(process.cwd(), LOGF) || LOGF;
  await new Promise((r) => LOGW.end(r));
  console.log('CIUDAD ' + JSON.stringify(out));
  phones.forEach((p) => { try { p.win.bleInterface.net._closeAll(); p.win.bleInterface.net.relays.forEach((rl) => { rl.retryAt = Date.now() + 9e6; }); } catch (e) {} });
  await Promise.all(relays.map((r) => r.stop()));
  process.exit(out.resultado === 'OK' ? 0 : 1);
})().catch((e) => { console.log('CIUDAD ' + JSON.stringify({ prueba: 'ciudad', resultado: 'FALLO', error: String(e && e.stack).substring(0, 400) })); try { LOGW.end(); } catch (e2) {} setTimeout(() => process.exit(1), 300); });
