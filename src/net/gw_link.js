/**
 * NEXO — PUENTE A INTERNET por un NEXO cercano (dueño 13-11, parte 1: solo textos)
 *
 * «Mando un mensaje y no tengo internet: sale por Bluetooth a alguien cercano que sí tiene, ese lo sube al buzón de
 * internet y le llega a mi contacto; la respuesta vuelve por ahí». Y la RED (dueño 13-11): si el puente de la ida ya no
 * está para el regreso, no se pierde nada — la respuesta queda en MI buzón de los relés y cualquier NEXO con internet
 * que esté cerca me la recoge («recoge lo mío»); se usan hasta 3 puentes a la vez. Sin ubicación (Bluetooth declara
 * neverForLocation): la cercanía la da el propio enlace.
 *
 * Cómo: el teléfono sin internet (A) usa al vecino (B) como si fuera un RELÉ más. Para net_link.js es una conexión de
 * relé «virtual» (clave gw:<nexoId de B>) cuyo «socket» manda cada frame NIP-01 por Bluetooth/Wi-Fi local a B; B abre
 * su PROPIA conexión al relé que A eligió (uno de los que B usa) y le pasa los frames en los dos sentidos. Todo lo de
 * net_link sigue igual por encima: el sobre va cifrado para el contacto (B no lo puede leer: ve un evento firmado con
 * una clave de un solo uso), la suscripción a MIS etiquetas es la que recoge lo mío, el saludo dice «en línea», el
 * ✓ es «un relé lo guardó» y el ✓✓ vuelve cuando lo confirma el contacto.
 *
 * Paquetes por Bluetooth ({v:1,type:'ig',op,from,s,…}; la parte nativa los ignora: BgInbox → IGNORE):
 *   A→B  q  ¿tienes internet para prestarme?          B→A  a  sí (u: relés que uso) / no (u: [])
 *   A→B  o  abre la sesión s con el relé u            B→A  k  abierta (ok:1) / no (ok:0)
 *   A→B  f  frame para el relé (d)                    B→A  e  frame del relé (d)
 *   A→B  c  cierra la sesión s                        B→A  x  la sesión s se cerró
 *   A→B  w  «toque» FCM al token t (el despertador del contacto también sale por el puente)
 *
 * Límites del que presta (para que no se abuse de su internet): solo eventos de mensajes privados (kind 1059) y trozos del
 * buzón de archivos (parte 3: fotos y notas de voz pequeñas, hasta GW_FILE_MAX_B64) firmados, suscripciones solo a esos
 * mensajes, pedir trozos por id (≤ 16), AUTH (NIP-42) y CLOSE; vídeos y archivos grandes quedan ⏳ (net_link.mailboxFilesOk).
 * Tope de BYTES por teléfono que pide (2 MB/h, 10 MB/día), de eventos por minuto y por día, pocas sesiones a la vez,
 * y nada con la batería baja (Jump.canRelay). SIN interruptor (dueño 13-11: «si alguien escoge NEXO es para estar comunicado,
 * no para romper esa red»): todo NEXO con internet presta el suyo, con estos topes.
 */
import { netEventValid } from './net_link.js';
import { BLOB_KIND, FETCH_BATCH } from './blob_mailbox.js';

var GW_KIND = 1059;                 // mensajes privados (el KIND de net_link)
var GW_AFTER_MS = 8000;             // sin relés propios al menos esto → buscar puente
var GW_MAX = 3;                     // puentes a la vez (dueño: «al menos dos opciones más»)
var GW_ASK_MS = 30000;              // a un mismo vecino se le pregunta como mucho cada 30 s (si no contesta: 1, 2, 4… hasta 5 min)
var GW_ASK_MAX_MS = 300000;
var GW_NO_MS = 120000;              // un vecino que dijo «no» no se vuelve a preguntar en 2 min
var GW_SEEK_MS = 30000;             // parte 2: sin puente y CON algo mío esperando, como mucho cada 30 s se prueba con NEXO desconocidos cercanos
var GW_SEEK_RECENT_MS = 60000;      // … sin nada que mandar pero con un puente usado hace < 30 min (espero respuestas): cada minuto
var GW_RECENT_MS = 30 * 60000;
var GW_SEEK_IDLE_MS = 10 * 60000;   // … si no, solo cada 10 min (para «recoge lo mío»): no gastar radio en un apagón general
var GW_NEED_MS = 3 * 60000;         // «algo mío esperando» = Jump buscó camino para un mensaje propio hace menos de 3 min
var GW_SEEK_N = 2;                  // … con 2 a la vez (los de mejor señal)
var GW_OFFER_TTL_MS = 90000;        // una oferta «sí» vale 90 s si no se usa
var GW_OPEN_MS = 10000;             // la sesión tiene que abrirse en 10 s
var GW_REAL_BACK_MS = 5000;         // volvió el internet propio y sigue 5 s → se sueltan los puentes
var SRV_MAX_SESSIONS = 4;           // sesiones a la vez en el que presta
var SRV_IDLE_MS = 10 * 60000;       // sesión callada 10 min → se cierra
var SRV_EV_PER_MIN = 40;            // eventos por minuto por sesión
var SRV_EV_PER_DAY = 1500;          // eventos por día por teléfono que pide
var SRV_UP_MAX = 70000;             // tamaño máximo de un frame que sube (un evento de texto cabe de sobra)
var SRV_DOWN_MAX = 200000;          // tamaño máximo de un frame que baja
var SRV_WAKE_MIN_MS = 8000;         // un toque por token cada 8 s como mucho
var SRV_WAKE_PER_HOUR = 60;
var TX_TRIES = 3;
// Parte 3 (dueño 13-11): FOTOS PEQUEÑAS por el puente. Los trozos del buzón de archivos (BLOB_KIND, ≤ 60 KB cada uno) pasan
// en los dos sentidos con un tope de BYTES por teléfono que pide; un adjunto de hasta GW_FILE_MAX_B64 caracteres (≈ 300 KB:
// una foto o una nota de voz del chat) sale por el puente; vídeos y archivos grandes siguen ⏳ hasta tener internet propio.
export var GW_FILE_MAX_B64 = 400 * 1024;
var SRV_BLOB_PER_HOUR = 2 * 1024 * 1024;  // bytes (subida + bajada) por teléfono que pide, por hora: todo lo que sube y lo que
var SRV_BLOB_PER_DAY = 10 * 1024 * 1024;  // baja de más de SRV_BYTES_MIN (un texto no cuenta; una foto, sí: buzón o en línea)
var SRV_BYTES_MIN = 4096;
// Puente por WI-FI DIRECT (dueño 13-11: «el cambio de Bluetooth/Wi-Fi Direct también al puente Bluetooth/internet, y que el
// cambio sea ágil»). Los TEXTOS siguen por Bluetooth (montar Wi-Fi Direct cuesta ~5 s); lo PESADO (los trozos del buzón de
// archivos de una foto/archivo) va en UN paquete por Wi-Fi Direct al puente, que lo mete en la sesión del relé de A (las
// confirmaciones vuelven por el camino de siempre); al bajar, el puente junta lo que pidió A y se lo devuelve por Wi-Fi Direct.
// Si Wi-Fi Direct no está o no contesta en GW_WD_OFFER_MS, ese mismo paquete sigue por Bluetooth al instante y Wi-Fi Direct
// con ese puente se aparta GW_WD_COOL_MS (sin esperas largas en cada envío).
export var GW_WD_FILE_MAX_B64 = Math.ceil(5 * 1024 * 1024 * 4 / 3) + 8; // con Wi-Fi Direct al puente: hasta 5 MB (el buzón de archivos)
var GW_WD_MIN = 60000;              // menos que esto (en caracteres) no compensa montar el Wi-Fi Direct: por Bluetooth
var GW_WD_OFFER_MS = 8000;          // el otro no monta el Wi-Fi Direct en este tiempo → por Bluetooth
var GW_WD_COOL_MS = 2 * 60000;      // falló con ese teléfono: lo pesado por Bluetooth estos minutos (sin esperas en cada envío)
var GW_WD_BUSY_MS = 4000;           // Wi-Fi Direct ocupado con otra cosa (un archivo con un contacto): esto como mucho, luego Bluetooth
var GW_BULK_WAIT_MS = 80;           // juntar los trozos que se publican a la vez en un paquete
export var GW_BULK_PAR = 24;        // trozos por paquete por Wi-Fi Direct (~1,3 MB); por Bluetooth, los de siempre (3)
export var GW_BULK_FETCH = 48;      // trozos que se piden por id de una vez por Wi-Fi Direct (por Bluetooth, 16)
var SRV_BULK_GAP_MS = 40;           // el puente mete los trozos del paquete en el relé espaciados (sin saturarlo)
var SRV_BULK_EOSE_MS = 6000;        // bajada en paquete: como mucho se junta esto y se manda lo que haya
var TX_BUSY_MS = 400, TX_BUSY_MAX_MS = 60000; // Bluetooth con la cola llena: se espera y se reintenta EN ORDEN (no se pierde)
var SRV_WIFI_PER_HOUR = 20 * 1024 * 1024, SRV_WIFI_PER_DAY = 100 * 1024 * 1024; // el que presta está en Wi-Fi (no gasta datos)

function _nid(id) { return (id || '').toString().toLowerCase().trim(); }
function _isNx(x) { return /^nx[0-9a-z]{8}$/.test(x); }
function _rid() { var a = new Uint8Array(6); crypto.getRandomValues(a); return Array.from(a, function(b) { return ('0' + b.toString(16)).slice(-2); }).join(''); }
function _host(u) { return String(u || '').replace(/^wss?:\/\//, '').replace(/\/.*$/, ''); }
function _disabled() { return typeof window !== 'undefined' && window.NEXO_GW === false; }

// ¿Este frame NIP-01 puede subir por el puente? (lo que A le pide al relé a través de B)
export function gwAllowUp(str) {
  if (typeof str !== 'string' || str.length > SRV_UP_MAX) return '';
  var m; try { m = JSON.parse(str); } catch (e) { return ''; }
  if (!Array.isArray(m) || typeof m[0] !== 'string') return '';
  if (m[0] === 'EVENT') {
    var ev = m[1];
    if (m.length !== 2 || !ev || !netEventValid(ev)) return '';
    if (ev.kind === GW_KIND) return 'EVENT';
    if (ev.kind === BLOB_KIND) return 'BLOB'; // parte 3: trozo del buzón de archivos (foto pequeña)
    return '';
  }
  if (m[0] === 'AUTH') { var ea = m[1]; return (m.length === 2 && ea && ea.kind === 22242 && netEventValid(ea)) ? 'AUTH' : ''; }
  if (m[0] === 'CLOSE') return (m.length === 2 && typeof m[1] === 'string' && m[1].length <= 64) ? 'CLOSE' : '';
  if (m[0] === 'REQ') {
    if (m.length !== 3 || typeof m[1] !== 'string' || m[1].length > 64) return '';
    var f = m[2];
    if (!f || typeof f !== 'object' || Array.isArray(f)) return '';
    var ks = Object.keys(f);
    for (var i = 0; i < ks.length; i++) {
      var k = ks[i], v = f[k];
      if (k === 'kinds') { if (!Array.isArray(v) || v.length !== 1 || v[0] !== GW_KIND) return ''; }
      else if (k === '#p') { if (!Array.isArray(v) || v.length > 400 || v.some(function(x) { return typeof x !== 'string' || !/^[0-9a-f]{64}$/.test(x); })) return ''; }
      else if (k === 'ids') { if (!Array.isArray(v) || !v.length || v.length > Math.max(FETCH_BATCH, GW_BULK_FETCH) || v.some(function(x) { return typeof x !== 'string' || !/^[0-9a-f]{64}$/.test(x); })) return ''; } // la comprobación (3011) y los trozos de una foto (parte 3)
      else if (k === 'since' || k === 'limit') { if (typeof v !== 'number' || !isFinite(v) || v < 0) return ''; }
      else return '';
    }
    // una suscripción de mensajes (kinds + #p) o la comprobación (ids): nada de «tráeme todo»
    if (!(f.kinds && f['#p']) && !f.ids) return '';
    return 'REQ';
  }
  return '';
}

// Socket «virtual»: lo que net_link manda al relé sale por Bluetooth hacia el puente
function VSock(gw, br, sid, url) {
  this.gw = gw; this.br = br; this.s = sid; this.url = url;
  this.onopen = null; this.onmessage = null; this.onclose = null; this.onerror = null;
  this._closed = false;
  var self = this;
  this._openTimer = setTimeout(function() { if (!self._opened) { console.warn('[GW] El puente ' + br.nx + ' no abrió la sesión a tiempo'); self._end(); } }, GW_OPEN_MS);
  gw._tx(br.dev, { op: 'o', s: sid, u: url, wd: gw._wdCan() ? 1 : 0 });
}
VSock.prototype.send = function(str) {
  if (this._closed) throw new Error('cerrado');
  str = String(str);
  if (this.gw._bulkUp(this, str)) return; // parte 4: un trozo de foto/archivo va en el paquete por Wi-Fi Direct
  var o = { op: 'f', s: this.s, d: str };
  if (this.gw._bulkReq(this, str)) o.b = 1; // parte 4: «tráeme estos trozos por Wi-Fi Direct»
  this.gw._tx(this.br.dev, o);
};
VSock.prototype.close = function() { if (this._closed) return; this.gw._tx(this.br.dev, { op: 'c', s: this.s }); this._end(); };
VSock.prototype._end = function() {
  if (this._closed) return;
  this._closed = true; clearTimeout(this._openTimer);
  if (this.bulk) { clearTimeout(this.bulk.timer); this.bulk = null; }
  this.gw.socks.delete(this.s);
  if (!this._opened) this.br.fails = (this.br.fails || 0) + 1; // un puente que no abre dos veces se suelta (tick)
  var fn = this.onclose; if (typeof fn === 'function') { try { fn(); } catch (e) {} }
};

export class GwLink {
  constructor(net) {
    this.net = net;
    // lado del que NO tiene internet (cliente)
    this.offers = new Map();   // nx del vecino → { dev, urls, at }
    this.asked = new Map();    // nx → hasta cuándo no se le vuelve a preguntar
    this.unanswered = new Map(); // nx → preguntas seguidas sin respuesta (espera creciente: no gastar batería en un vecino dormido)
    this.bridges = new Map();  // nx → { nx, dev, url, key }
    this.socks = new Map();    // sid → VSock
    this._realOffSince = 0;
    this._realOnSince = 0;
    // lado del que presta (servidor)
    this.sess = new Map();     // from|sid → { ws, dev, from, url, open, rxAt, evMin: [], buf: [] }
    this.daily = new Map();    // from → { day, n }
    this.blobBytes = new Map(); // parte 3: from → { h0, h, day, d } (bytes de lo grande, subida + bajada)
    this.wakes = new Map();    // token → cuándo; from → [tiempos]
    this.stats = { up: 0, down: 0, rejected: 0, sessions: 0, wd: 0, wdKB: 0, wdFail: 0 };
    // parte 4: los dos lados
    this.txq = new Map();      // dev → { items, busy } (envío en orden por Bluetooth)
    this.wdUntil = new Map();  // nx → hasta cuándo no se usa Wi-Fi Direct con él (falló)
    this._wdChain = null;      // una transferencia de Wi-Fi Direct del puente a la vez
  }

  ble() { return this.net && this.net.ble; }
  me() { return this.net ? this.net.me() : ''; }

  // Vecinos con enlace listo (Bluetooth o Wi-Fi local; nunca «net:», que sería internet sobre internet)
  _neighbors() {
    var ble = this.ble(), out = new Map();
    try {
      var rel = ble && ble.relay;
      var m = rel && typeof rel._computeNeighbors === 'function' ? rel._computeNeighbors() : (rel && rel.neighbors) || new Map();
      m.forEach(function(dev, nx) { if (_isNx(_nid(nx)) && !/^net/i.test(String(dev))) out.set(_nid(nx), dev); });
    } catch (e) {}
    return out;
  }

  // Parte 4: por Bluetooth, EN ORDEN y sin perder nada por la cola llena. Android acepta un mensaje entero o ninguno (cola de
  // ~500 trozos de radio; el frame de un trozo de foto son ~110): antes, con la cola llena se reintentaba 3 veces en 1 s y se
  // perdía, y un EOSE pequeño podía adelantarse a los trozos que bajaban (la foto quedaba incompleta).
  _tx(dev, o) {
    var ble = this.ble();
    if (!ble || typeof ble._sendMessageNative !== 'function' || !dev) return;
    var pkt = Object.assign({ v: 1, type: 'ig', from: this.me() }, o);
    try { if (ble.relay && typeof ble.relay._touch === 'function') ble.relay._touch(dev); } catch (e) {} // una conexión de paso en uso no se cierra
    var q = this.txq.get(dev);
    if (!q) { q = { items: [], busy: false }; this.txq.set(dev, q); }
    if (q.items.length >= 400) { if (!q.said) { q.said = true; console.warn('[GW] Cola de envío al vecino llena: se descarta'); } return; }
    q.items.push({ str: JSON.stringify(pkt), t0: Date.now(), tries: 0 });
    if (!q.busy) this._txPump(dev, q);
  }
  _txPump(dev, q) {
    var self = this, ble = this.ble(), it = q.items[0];
    if (!it || !ble) { q.busy = false; q.said = false; if (this.txq.get(dev) === q && !q.items.length) this.txq.delete(dev); return; }
    q.busy = true;
    ble._sendMessageNative(dev, it.str, null).then(function() { q.items.shift(); self._txPump(dev, q); }, function(e) {
      var busy = /BLE_BUSY|llena|busy/i.test(String((e && e.code) || '') + ' ' + String((e && e.message) || ''));
      it.tries++;
      if (busy ? Date.now() - it.t0 < TX_BUSY_MAX_MS : it.tries < TX_TRIES) { setTimeout(function() { self._txPump(dev, q); }, busy ? TX_BUSY_MS : 300 * it.tries); return; }
      q.items.shift(); self._txPump(dev, q);
    });
  }

  // ---------- entrada (ble_messages._prePayload) ----------
  handle(p, deviceId) {
    if (!p || p.type !== 'ig' || typeof p.op !== 'string') return false;
    if (_disabled()) return true;
    var from = _nid(p.from);
    if (!_isNx(from) || from === this.me()) return true;
    switch (p.op) {
      case 'q': this._srvAsk(from, deviceId); break;
      case 'o': this._srvOpen(from, deviceId, p); break;
      case 'f': this._srvUp(from, deviceId, p); break;
      case 'c': this._srvClose(from + '|' + p.s, 'el otro la cerró', true); break;
      case 'w': this._srvWake(from, p); break;
      case 'a': this._cliOffer(from, deviceId, p); break;
      case 'k': this._cliOpened(p); break;
      case 'e': this._cliFrame(p); break;
      case 'x': { var vs = this.socks.get(String(p.s)); if (vs) { console.log('[GW] El puente ' + from + ' cerró la sesión'); vs._end(); } break; }
    }
    return true;
  }

  // ---------- cliente: el teléfono SIN internet ----------
  _realOpen() { var n = 0; this.net.relays.forEach(function(r) { if (r.open && !r.gw) n++; }); return n; }

  tick() {
    if (_disabled()) return;
    var now = Date.now(), net = this.net, self = this;
    this._srvTick(now);
    var real = this._realOpen();
    if (real > 0) {
      this._realOffSince = 0; this._seekAt = 0; this._bridgeAt = 0;
      if (!this._realOnSince) this._realOnSince = now;
      if (this.bridges.size && now - this._realOnSince >= GW_REAL_BACK_MS) {
        console.log('[GW] Volvió el internet propio: suelto ' + this.bridges.size + ' puente(s)');
        this.bridges.forEach(function(b) { self._drop(b, null); });
      }
      return;
    }
    this._realOnSince = 0;
    if (!this._realOffSince) this._realOffSince = now;
    // Sin contactos por internet no hay nada que recoger ni mandar
    if (!net.inTags.size && !net.reqTags.size) return;
    if (now - this._realOffSince < GW_AFTER_MS) return;
    var nb = this._neighbors();
    // Puentes que ya no están cerca: se sueltan (lo mío sigue en el buzón; otro lo recoge)
    this.bridges.forEach(function(b) { if (nb.get(b.nx) !== b.dev && !nb.has(b.nx)) self._drop(b, 'ya no está cerca'); else if (nb.has(b.nx)) b.dev = nb.get(b.nx); });
    // Puentes caídos: se reabre la sesión (o se suelta si ya no ofrece)
    this.bridges.forEach(function(b) {
      if ((b.fails || 0) >= 2) { self.asked.set(b.nx, now + GW_NO_MS); self.offers.delete(b.nx); self._drop(b, 'no abre la sesión'); return; }
      var r = net.relays.get(b.key);
      if (r && !r.ws && now >= (r.retryAt || 0)) net._connect(b.key);
      else if (r && r.open && b.sock) b.fails = 0;
    });
    if (this.bridges.size) this._bridgeAt = now;
    if (this.bridges.size >= GW_MAX) return;
    // Ofertas vigentes → puentes nuevos (repartiendo los relés: cada puente a uno distinto si se puede)
    var used = new Set(); this.bridges.forEach(function(b) { used.add(b.url); });
    this.offers.forEach(function(o, nx) {
      if (self.bridges.size >= GW_MAX || self.bridges.has(nx) || !nb.has(nx) || now - o.at > GW_OFFER_TTL_MS || !o.urls.length) return;
      var url = o.urls.find(function(u) { return !used.has(u); }) || o.urls[self.bridges.size % o.urls.length];
      used.add(url);
      self._use(nx, nb.get(nx), url);
    });
    if (this.bridges.size >= GW_MAX) return;
    // Preguntar a los vecinos
    nb.forEach(function(dev, nx) {
      if (self.bridges.has(nx)) return;
      var t = self.asked.get(nx) || 0;
      if (now < t) return;
      var n = self.unanswered.get(nx) || 0;
      self.unanswered.set(nx, n + 1);
      self.asked.set(nx, now + Math.min(GW_ASK_MAX_MS, GW_ASK_MS * Math.pow(2, n)));
      self._tx(dev, { op: 'q' });
    });
    // Parte 2 (dueño 13-11: «cualquier NEXO cercano»): sin ningún puente, se conecta «de paso» (como Jump) con NEXO cercanos que
    // no son contactos —vistos al escanear por su NEXO ID o por su código rotativo— solo para preguntarles; los de mejor señal.
    // Parte 2 (dueño 13-11: «si el teléfono que hizo de puente ya no está para el regreso, ya no me van a encontrar»): ningún
    // vecino conectado presta internet → NEXO desconocidos cercanos, de paso. Con algo mío esperando, cada 30 s (Jump ya
    // conecta de paso por eso mismo); sin nada que mandar pero con un puente usado hace poco —espero la respuesta, que
    // quedó en MI buzón—, cada minuto; si no, cada 10 min. Por teléfono rige además la espera por fallos de Jump (1, 2, 4… min).
    var rel = this.ble() && this.ble().relay, need = !!(rel && now - (rel.needAt || 0) < GW_NEED_MS);
    var recent = !!this._bridgeAt && now - this._bridgeAt < GW_RECENT_MS;
    var every = need ? GW_SEEK_MS : recent ? GW_SEEK_RECENT_MS : GW_SEEK_IDLE_MS;
    var since = this._seekAt || (need || recent ? 0 : this._realOffSince);
    if (!this.bridges.size && now - since >= every) { this._seekAt = now; this._seekStrangers(nb, now); }
  }

  // again: segunda vuelta tras un escaneo propio (sin nada que mandar no hay re-búsqueda de contactos que escanee)
  _seekStrangers(nb, now, again) {
    var ble = this.ble(), rel = ble && ble.relay, self = this, tried = 0;
    if (!rel || typeof rel._connect !== 'function') return;
    var fresh = function(v) { return v && now - (v.ts || 0) < 60000; };
    var byRssi = function(a, b) { return (b.rssi || -100) - (a.rssi || -100); };
    var known = [];
    if (rel.nearby) rel.nearby.forEach(function(v, nx) {
      if (fresh(v) && !nb.has(nx) && now >= (self.asked.get(nx) || 0) && !(typeof rel._isContact === 'function' && rel._isContact(nx))) known.push({ nx: nx, dev: v.deviceId, rssi: v.rssi });
    });
    known.sort(byRssi).slice(0, GW_SEEK_N).forEach(function(c) { if (rel._connect(c.nx, c.dev)) tried++; });
    if (tried < GW_SEEK_N && rel.anon && typeof rel._connectAnon === 'function') {
      var an = []; rel.anon.forEach(function(a) { if (fresh(a)) an.push(a); });
      an.sort(byRssi).slice(0, GW_SEEK_N - tried).forEach(function(a) { if (rel._connectAnon(a.deviceId, true)) tried++; });
    }
    if (tried) console.log('[GW] Sin internet ni puente: pruebo con ' + tried + ' NEXO cercano(s) de paso');
    else if (!again && typeof rel._scan === 'function') {
      // Nadie visto en el último minuto: escaneo (como Jump al buscar camino) y pruebo con lo que aparezca
      rel._scan().then(function() { if (!self.bridges.size && !self._realOpen() && !_disabled()) self._seekStrangers(self._neighbors(), Date.now(), true); }).catch(function() {});
    }
  }
  // ¿Está este vecino haciendo de puente? (Jump no cierra su conexión de paso por falta de uso)
  isBridge(nx) { return this.bridges.has(_nid(nx)); }

  _cliOffer(from, dev, p) {
    this.unanswered.delete(from);
    var urls = Array.isArray(p.u) ? p.u.filter(function(u) { return typeof u === 'string' && /^wss?:\/\//.test(u) && u.length < 200; }).slice(0, 8) : [];
    if (!urls.length) { this.asked.set(from, Date.now() + GW_NO_MS); this.offers.delete(from); return; }
    // parte 4: ¿puede recibir/mandar lo pesado por Wi-Fi Direct? ¿está en Wi-Fi (no gasta sus datos)?
    this.offers.set(from, { dev: dev, urls: urls, at: Date.now(), wd: p.wd === 1, wifi: p.w === 1 });
    if (!this.bridges.has(from) && this.bridges.size < GW_MAX && !this._realOpen()) this.tick();
  }

  _use(nx, dev, url) {
    var self = this, net = this.net, key = 'gw:' + nx;
    var of = this.offers.get(nx) || {};
    var b = { nx: nx, dev: dev, url: url, key: key, wd: !!of.wd, wifi: !!of.wifi };
    this.bridges.set(nx, b);
    var r = net.relays.get(key) || { backoff: 2000, waits: new Map() };
    r.gw = nx; r.realUrl = url;
    r.factory = function() { var sid = _rid(); var vs = new VSock(self, b, sid, url); self.socks.set(sid, vs); b.sock = vs; return vs; };
    r.retryAt = 0;
    net.relays.set(key, r);
    console.log('[GW] Sin internet propio: uso a ' + nx + ' de puente (relé ' + _host(url) + '; ' + this.bridges.size + ' de ' + GW_MAX + ')' +
      (b.wd ? (this._wdCan() ? ', fotos y archivos por Wi-Fi Direct' : ', Wi-Fi Direct no disponible en este teléfono') : ''));
    net._connect(key);
  }

  _drop(b, why) {
    var net = this.net, r = net.relays.get(b.key);
    this.bridges.delete(b.nx);
    if (why) console.log('[GW] Suelto el puente ' + b.nx + ' (' + why + ')');
    if (r) { try { if (r.ws) r.ws.close(); } catch (e) {} net.relays.delete(b.key); }
  }

  _cliOpened(p) {
    var vs = this.socks.get(String(p.s));
    if (!vs || vs._closed) return;
    if (!p.ok) { console.warn('[GW] El puente ' + vs.br.nx + ' no pudo abrir la sesión' + (p.why ? ' (' + String(p.why).slice(0, 60) + ')' : '')); this.offers.delete(vs.br.nx); this.bridges.delete(vs.br.nx); this.net.relays.delete(vs.br.key); vs._end(); return; }
    vs._opened = true; clearTimeout(vs._openTimer);
    console.log('[GW] Conectado a internet por el puente ' + vs.br.nx + ' (relé ' + _host(vs.url) + ')');
    var fn = vs.onopen; if (typeof fn === 'function') { try { fn(); } catch (e) {} }
  }

  _cliFrame(p) {
    var vs = this.socks.get(String(p.s));
    if (!vs || vs._closed || !vs._opened || typeof p.d !== 'string') return;
    var fn = vs.onmessage; if (typeof fn === 'function') { try { fn({ data: p.d }); } catch (e) {} }
  }

  // El «toque» FCM del contacto (el despertador va por HTTPS, que este teléfono no tiene): lo pide un puente
  wake(token) {
    var it = this.bridges.values().next();
    if (it.done || !token) return false;
    this._tx(it.value.dev, { op: 'w', t: String(token) });
    return true;
  }

  // Para el diagnóstico y la interfaz
  summary() {
    var out = [];
    this.bridges.forEach(function(b) { out.push(b.nx + (b.sock && b.sock._opened ? '' : ' (abriendo)')); });
    return { bridges: out, serving: this.sess.size, stats: this.stats };
  }

  // ---------- parte 4: lo pesado por WI-FI DIRECT con el puente (los dos lados) ----------
  _wd() { var b = this.ble(); return b && b.wifiDirect; }
  // ¿Puede ESTE teléfono usar Wi-Fi Direct ahora? (permiso ya concedido: al que presta nunca se le pide nada)
  _wdCan() {
    var wd = this._wd();
    if (!wd || typeof wd.supported !== 'function' || !wd.supported() || typeof wd.send !== 'function') return false;
    var st = wd.status || {};
    return !!st.granted && st.wifiOn !== false;
  }
  _wdCooling(nx) { return Date.now() < (this.wdUntil.get(nx) || 0); }
  // Cliente: ¿lo pesado con este puente va por Wi-Fi Direct?
  wdUp(b) { return !!(b && b.wd && b.sock && b.sock._opened && !b.sock._closed && !this._wdCooling(b.nx) && this._wdCan()); }
  wdAny() { var self = this, any = false; this.bridges.forEach(function(b) { if (self.wdUp(b)) any = true; }); return any; }
  _bridgeOfRelay(r) { return r && r.gw ? this.bridges.get(r.gw) || null : null; }
  // Tamaño máximo de un adjunto por el puente: con Wi-Fi Direct y el que presta en Wi-Fi, lo del buzón de archivos (5 MB);
  // si no, fotos pequeñas (sus datos móviles no se gastan en vídeos)
  fileMaxB64() {
    var self = this, big = false;
    this.bridges.forEach(function(b) { if (b.wifi && self.wdUp(b)) big = true; });
    return big ? GW_WD_FILE_MAX_B64 : GW_FILE_MAX_B64;
  }
  // Para blob_mailbox (vía net_link): trozos a la vez y esperas cuando todo va por puentes
  blobPar() { return this.wdAny() ? GW_BULK_PAR : 0; }
  // ¿Este relé-puente sirve para publicar un trozo? Si algún puente tiene Wi-Fi Direct, solo esos (uno sin él cargaría la
  // radio Bluetooth con la tanda grande y haría esperar a todos)
  blobRelayOk(r) { var b = this._bridgeOfRelay(r); return !this.wdAny() || this.wdUp(b); }
  publishMs(t) { return this.wdAny() ? 180000 : Math.max(t || 0, 60000); } // por Bluetooth un trozo son ~3 s de radio
  fetchBatch(r) { return this.wdUp(this._bridgeOfRelay(r)) ? GW_BULK_FETCH : FETCH_BATCH; }
  fetchMs(r, t) { return this.wdUp(this._bridgeOfRelay(r)) ? 60000 : Math.max(t || 0, 30000); } // sin progreso tanto tiempo (net_link)

  // Cliente: un trozo del buzón que sale → al paquete (se manda a los GW_BULK_WAIT_MS o al juntar GW_BULK_PAR)
  _bulkUp(vs, str) {
    if (str.length < SRV_BYTES_MIN || str.indexOf('["EVENT"') !== 0 || str.indexOf('"kind":' + BLOB_KIND) < 0 || !this.wdUp(vs.br)) return false;
    var self = this, q = vs.bulk || (vs.bulk = { frames: [], timer: null });
    q.frames.push(str);
    if (q.frames.length >= GW_BULK_PAR) this._bulkFlush(vs);
    else if (!q.timer) q.timer = setTimeout(function() { self._bulkFlush(vs); }, GW_BULK_WAIT_MS);
    return true;
  }
  _bulkFlush(vs) {
    var q = vs.bulk, self = this;
    if (!q) return;
    clearTimeout(q.timer); q.timer = null;
    var frames = q.frames; q.frames = [];
    if (!frames.length || vs._closed) return;
    var total = 0; frames.forEach(function(f) { total += f.length; });
    var ble = function() { frames.forEach(function(f) { if (!vs._closed) self._tx(vs.br.dev, { op: 'f', s: vs.s, d: f }); }); };
    if (total < GW_WD_MIN) { ble(); return; }
    this._wdRun(vs.br.nx, vs.br.dev, 'u', 'gw1\n' + vs.s + '\n' + frames.join('\n'), frames.length).then(function(ok) { if (!ok) ble(); });
  }
  // Cliente: ¿pedir estos trozos «por Wi-Fi Direct»? (el puente junta lo que baja hasta el EOSE y lo manda en un paquete)
  _bulkReq(vs, str) { return str.indexOf('["REQ"') === 0 && str.indexOf('"ids":[') > 0 && this.wdUp(vs.br); }

  // Una transferencia de Wi-Fi Direct del puente a la vez. Resuelve true si llegó; false → el que llama manda por Bluetooth.
  _wdRun(nx, dev, dir, data, n) {
    var self = this, again = true;
    var job = function() {
      var wd = self._wd();
      if (!wd || !self._wdCan() || self._wdCooling(nx)) return Promise.resolve(false);
      return self._wdIdle(wd, GW_WD_BUSY_MS).then(function(idle) {
        if (!idle) { console.log('[GW] Wi-Fi Direct ocupado con otra transferencia: ' + n + ' trozo(s) por Bluetooth'); return false; }
        var id = 'gw' + dir + _rid(), t0 = Date.now();
        return wd.send(dev, id, data, { gw: dir }, { offerMs: GW_WD_OFFER_MS, gw: 1, nx: nx }).then(function() {
          var s = (Date.now() - t0) / 1000;
          self.stats.wd++; self.stats.wdKB += Math.round(data.length / 1024);
          console.log('[GW] Wi-Fi Direct ' + (dir === 'u' ? 'al puente ' : 'a ') + nx + ': ' + n + ' trozo(s), ' + Math.round(data.length / 1024) + ' KB en ' + s.toFixed(1) + ' s');
          return true;
        }, function(e) {
          // el otro está con otra transferencia (p. ej. la bajada mientras subo): un reintento en un momento, si no, Bluetooth
          if (/ocupado/i.test(String(e && e.message))) {
            if (again) { again = false; return new Promise(function(res) { setTimeout(res, 2500); }).then(job); }
            console.log('[GW] El otro tiene Wi-Fi Direct ocupado: ' + n + ' trozo(s) por Bluetooth'); return false;
          }
          self.stats.wdFail++;
          self.wdUntil.set(nx, Date.now() + GW_WD_COOL_MS);
          console.warn('[GW] Wi-Fi Direct con ' + nx + ' no funcionó (' + String(e && e.message).slice(0, 60) + '): lo pesado por Bluetooth ' + Math.round(GW_WD_COOL_MS / 60000) + ' min');
          return false;
        });
      });
    };
    var p = (this._wdChain || Promise.resolve()).then(job, job);
    this._wdChain = p.catch(function() {});
    return p.catch(function() { return false; });
  }
  _wdIdle(wd, ms) {
    if (!wd.busy && !(wd.incoming && wd.incoming.size)) return Promise.resolve(true);
    return new Promise(function(res) {
      var t0 = Date.now(), iv = setInterval(function() {
        if (!wd.busy && !(wd.incoming && wd.incoming.size)) { clearInterval(iv); res(true); }
        else if (Date.now() - t0 > ms) { clearInterval(iv); res(false); }
      }, 150);
    });
  }

  // Llegó un paquete del puente por Wi-Fi Direct (wifi_direct.js, meta.gw). 'u': soy el que presta (trozos para el relé);
  // 'd': soy el que pidió (lo que bajó del relé)
  wdIn(from, dev, data, dir) {
    from = _nid(from);
    if (_disabled() || typeof data !== 'string' || data.indexOf('gw1\n') !== 0) return false;
    var lines = data.split('\n'), sid = lines[1], frames = lines.slice(2), self = this;
    if (!/^[0-9a-f]{12}$/.test(sid || '') || !frames.length) return false;
    if (dir === 'u') {
      var s = this.sess.get(from + '|' + sid);
      if (!s || !s.open) return false;
      // al relé espaciados (como si hubieran llegado de uno en uno; los mismos filtros y topes de siempre)
      frames.forEach(function(f, i) { setTimeout(function() { if (self.sess.get(from + '|' + sid) === s) self._srvUp(from, s.dev, { s: sid, d: f }); }, i * SRV_BULK_GAP_MS); });
      return true;
    }
    if (dir === 'd') {
      var vs = this.socks.get(sid);
      if (!vs || vs._closed || !vs._opened || vs.br.nx !== from) return false;
      frames.forEach(function(f) { self._cliFrame({ s: sid, d: f }); });
      return true;
    }
    return false;
  }

  // Servidor: el que pide sabe usar Wi-Fi Direct y yo también (y no falló hace poco con él)
  _srvWdOk(s) { return !!(s.wd && this._wdCan() && !this._wdCooling(s.from)); }
  _bulkMark(s, str) {
    if (!this._srvWdOk(s)) return;
    var sub = ''; try { sub = JSON.parse(str)[1]; } catch (e) {}
    if (!sub || s.bulk.has(sub) || s.bulk.size >= 4) return;
    var self = this, e = { frames: [], bytes: 0 };
    e.timer = setTimeout(function() { self._bulkEnd(s, sub); }, SRV_BULK_EOSE_MS);
    s.bulk.set(sub, e);
  }
  _bulkDown(s, d) {
    var m = /^\["(EVENT|EOSE|CLOSED)","([^"\\]{1,64})"/.exec(d.slice(0, 90));
    var e = m && s.bulk.get(m[2]);
    if (!e || d.indexOf('\n') >= 0) return false;
    e.frames.push(d); e.bytes += d.length;
    if (m[1] !== 'EVENT') this._bulkEnd(s, m[2]);
    return true;
  }
  _bulkEnd(s, sub, drop) {
    var e = s.bulk.get(sub), self = this;
    if (!e) return;
    s.bulk.delete(sub); clearTimeout(e.timer);
    if (drop || !e.frames.length) return;
    var ble = function() { e.frames.forEach(function(f) { self._tx(s.dev, { op: 'e', s: s.sid, d: f }); }); };
    if (e.bytes < GW_WD_MIN || !this._srvWdOk(s)) { ble(); return; }
    this._wdRun(s.from, s.dev, 'd', 'gw1\n' + s.sid + '\n' + e.frames.join('\n'), e.frames.length).then(function(ok) { if (!ok) ble(); });
  }

  // ---------- servidor: el teléfono que PRESTA su internet ----------
  _canShare() {
    if (_disabled()) return '';
    if (!this._realOpen()) return 'sin internet';
    var rel = this.ble() && this.ble().relay;
    if (rel && typeof rel.canRelay === 'function' && !rel.canRelay()) return 'batería baja';
    return 'ok';
  }
  _realUrls() { var out = []; this.net.relays.forEach(function(r, u) { if (r.open && !r.gw) out.push(u); }); return out; }

  _srvAsk(from, dev) {
    var why = this._canShare();
    var ok = why === 'ok';
    this._tx(dev, { op: 'a', u: ok ? this._realUrls() : [], wd: ok && this._wdCan() ? 1 : 0, w: ok && this.net.wifi ? 1 : 0 });
  }

  _srvOpen(from, dev, p) {
    var self = this, sid = String(p.s || ''), key = from + '|' + sid, url = String(p.u || '');
    var no = function(why) { self.stats.rejected++; self._tx(dev, { op: 'k', s: sid, ok: 0, why: why }); };
    if (!/^[0-9a-f]{12}$/.test(sid)) return;
    var why = this._canShare();
    if (why !== 'ok') return no(why);
    if (this._realUrls().indexOf(url) < 0) return no('relé desconocido');
    // una sesión por teléfono que pide (la anterior se cierra) y pocas en total
    this.sess.forEach(function(s, k) { if (s.from === from) self._srvClose(k, 'sesión nueva', false); });
    if (this.sess.size >= SRV_MAX_SESSIONS) return no('ocupado');
    var ws;
    try { ws = new WebSocket(url); } catch (e) { return no('no conecta'); }
    var s = { ws: ws, dev: dev, from: from, sid: sid, url: url, open: false, rxAt: Date.now(), evMin: [], wd: p.wd === 1, bulk: new Map() };
    this.sess.set(key, s);
    this.stats.sessions++;
    ws.onopen = function() { s.open = true; s.rxAt = Date.now(); console.log('[GW] Presto internet a ' + from + ' (relé ' + _host(url) + ')'); self._tx(dev, { op: 'k', s: sid, ok: 1 }); };
    ws.onmessage = function(ev) {
      var d = ev && ev.data;
      if (typeof d !== 'string' || d.length > SRV_DOWN_MAX) return;
      // parte 3: lo grande que baja (una foto, un trozo de archivo) también gasta del tope de bytes de quien lo pidió
      if (d.length > SRV_BYTES_MIN && !self._blobSpend(from, d.length)) { self.stats.rejected++; return; }
      self.stats.down++;
      if (s.bulk.size && self._bulkDown(s, d)) return; // parte 4: trozos pedidos «por Wi-Fi Direct»: se juntan
      self._tx(s.dev, { op: 'e', s: sid, d: d });
    };
    ws.onclose = function() { if (self.sess.get(key) === s) { self.sess.delete(key); self._tx(s.dev, { op: s.open ? 'x' : 'k', s: sid, ok: 0 }); } };
    ws.onerror = function() {};
  }

  _srvUp(from, dev, p) {
    var key = from + '|' + String(p.s || ''), s = this.sess.get(key);
    if (!s || !s.open) return;
    s.dev = dev; s.rxAt = Date.now();
    var kind = gwAllowUp(p.d);
    if (!kind) { this.stats.rejected++; return; }
    if (kind === 'REQ' && p.b === 1) this._bulkMark(s, p.d);
    else if (kind === 'CLOSE' && s.bulk.size) { try { this._bulkEnd(s, JSON.parse(p.d)[1], true); } catch (e) {} }
    if ((kind === 'BLOB' || (kind === 'EVENT' && p.d.length > SRV_BYTES_MIN)) && !this._blobSpend(from, p.d.length)) {
      var bid = ''; try { bid = JSON.parse(p.d)[1].id; } catch (e) {}
      this.stats.rejected++;
      this._tx(s.dev, { op: 'e', s: s.sid, d: JSON.stringify(['OK', bid, false, 'rate-limited: tope de archivos del puente']) });
      return;
    }
    // los trozos de fotos/archivos los acota el tope de BYTES (parte 4: un archivo de 5 MB son ~95 trozos); los mensajes, esto
    if (kind === 'EVENT') {
      var now = Date.now(), id = '';
      try { id = JSON.parse(p.d)[1].id; } catch (e) {}
      s.evMin = s.evMin.filter(function(t) { return now - t < 60000; });
      var day = new Date().toISOString().substring(0, 10), d = this.daily.get(from);
      if (!d || d.day !== day) { d = { day: day, n: 0 }; this.daily.set(from, d); }
      if (s.evMin.length >= SRV_EV_PER_MIN || d.n >= SRV_EV_PER_DAY) {
        this.stats.rejected++;
        // se le contesta como un relé (rechazado): su envío falla enseguida y queda ⏳ (no espera 12 s)
        this._tx(s.dev, { op: 'e', s: s.sid, d: JSON.stringify(['OK', id, false, 'rate-limited: tope del puente']) });
        return;
      }
      s.evMin.push(now); d.n++;
    }
    try { s.ws.send(p.d); this.stats.up++; } catch (e) {}
  }

  // Parte 3: ¿le queda tope de bytes de archivos a este teléfono? (lo gasta si sí)
  _blobSpend(from, n) {
    var now = Date.now(), day = new Date().toISOString().substring(0, 10), b = this.blobBytes.get(from);
    if (!b) { b = { h0: now, h: 0, day: day, d: 0 }; this.blobBytes.set(from, b); }
    if (now - b.h0 >= 3600000) { b.h0 = now; b.h = 0; }
    if (b.day !== day) { b.day = day; b.d = 0; }
    var wifi = !!(this.net && this.net.wifi); // parte 4: en Wi-Fi no gasta datos del que presta: tope más alto
    if (b.h + n > (wifi ? SRV_WIFI_PER_HOUR : SRV_BLOB_PER_HOUR) || b.d + n > (wifi ? SRV_WIFI_PER_DAY : SRV_BLOB_PER_DAY)) {
      if (!b.said || now - b.said > 600000) { b.said = now; console.log('[GW] ' + from + ' llegó al tope de datos por el puente (' + Math.round(b.h / 1024) + ' KB esta hora, ' + Math.round(b.d / 1024) + ' KB hoy)'); }
      return false;
    }
    b.h += n; b.d += n;
    if (this.blobBytes.size > 200) this.blobBytes.delete(this.blobBytes.keys().next().value);
    return true;
  }

  _srvClose(key, why, quiet) {
    var s = this.sess.get(key);
    if (!s) return;
    this.sess.delete(key);
    if (s.bulk) { s.bulk.forEach(function(e) { clearTimeout(e.timer); }); s.bulk.clear(); }
    try { s.ws.onclose = null; s.ws.close(); } catch (e) {}
    if (!quiet) this._tx(s.dev, { op: 'x', s: s.sid });
    console.log('[GW] Dejo de prestar internet a ' + s.from + ' (' + why + ')');
  }

  _srvTick(now) {
    var self = this;
    if (!this.sess.size) return;
    var share = this._canShare();
    var nb = this._neighbors();
    this.sess.forEach(function(s, k) {
      if (share !== 'ok') self._srvClose(k, share, false);
      else if (now - s.rxAt > SRV_IDLE_MS) self._srvClose(k, 'sin actividad', false);
      else if (!nb.has(s.from) && now - s.rxAt > 60000) self._srvClose(k, 'ya no está cerca', true);
    });
  }

  _srvWake(from, p) {
    var t = String(p.t || ''), now = Date.now(), net = this.net;
    if (t.length < 20 || t.length > 4096 || this._canShare() !== 'ok') return;
    if (now - (this.wakes.get(t) || 0) < SRV_WAKE_MIN_MS) return;
    var hk = 'h|' + from, list = (this.wakes.get(hk) || []).filter(function(x) { return now - x < 3600000; });
    if (list.length >= SRV_WAKE_PER_HOUR) return;
    list.push(now); this.wakes.set(hk, list); this.wakes.set(t, now);
    if (this.wakes.size > 500) this.wakes.delete(this.wakes.keys().next().value);
    var url = net.senderUrl && net.senderUrl();
    if (!url || typeof fetch !== 'function') return;
    // SOLO el token (como el despertador normal), nunca contenido
    fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ to: t }) }).catch(function() {});
  }
}
